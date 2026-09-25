/**
 * 项目内 Hook 配置的渲染、合并与在场判定（M10b 第 3 步，计划 r10 §3.1.2、§3.2、§3.3；r9 §3.4）。
 *
 * **单一来源**：两家的 Hook 都由运行时根里的 `hooks/hooks.json`（Claude Code 形态）派生。
 * 注册表的 `hookConfigTarget` 登记每家落在哪个文件、是什么形态；本模块按形态渲染：
 *
 *   claude-settings  原样合并进 `.claude/settings.json` 的 `hooks.<事件>[]`
 *   zcode-config     合并进 `.zcode/config.json` 的 `hooks.events.<事件>[]`：
 *                    matcher 只留 ZCode 工具注册表里有的名字（`NotebookEdit` 不在其中）；
 *                    超时 `timeout`（秒）换成 `timeoutMs`（毫秒）；护栏失效提示里的配置文件名换成本家的
 *
 * **只增不删、不覆盖用户已有的 Hook**（两家同口径）：按事件追加；同一条 TriviumCode Hook 以它调用的
 * `gate hook-<name>` 识别，命令文本变了就原位替换旧条目（升级），而不是叠加第二条。
 *
 * 本模块**只渲染与安装，不参与任何判定**（r5 §6.1「通过时」）：拦不拦由 `hooks.ts` 决定，
 * 装没装上由 {@link hookConfigPresent} 回答，给 `preflight` 定当轮护栏等级用（B1，r10 §3.3）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  type AgentDescriptor, type GuardLevel, type GuardProfile, type HookConfigFormat, guardProfileOf,
} from './agents/registry.js';
import { ensureDir, exists, writeAtomic } from './util/fsx.js';
import { warn } from './util/log.js';
import { run } from './util/exec.js';

/** `hooks/hooks.json` 里的一条事件条目（Claude Code 形态） */
export interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

export interface HookSource {
  hooks: Record<string, HookEntry[]>;
}

/** 与 `init.ts` 的 `InitReport` 同形：`hooks` 命令与 `init` 共用同一份汇报 */
export interface HookMergeReport {
  created: string[];
  updated: string[];
  skipped: string[];
  notes: string[];
}

/** 一条 hooks 条目里调用了哪些 `gate hook-<name>`（TriviumCode 的 Hook 身份） */
export function hookNamesOf(entry: unknown): Set<string> {
  const out = new Set<string>();
  for (const m of JSON.stringify(entry).matchAll(/gate hook-([a-z-]+)/g)) out.add(m[1]!);
  return out;
}

export async function loadHookSource(hooksJsonPath: string): Promise<HookSource | null> {
  if (!(await exists(hooksJsonPath))) return null;
  return JSON.parse(await fs.readFile(hooksJsonPath, 'utf8')) as HookSource;
}

// ─────────────────────────── 渲染 ───────────────────────────

/**
 * ZCode 工具注册表里、本仓 Hook 要挂的那几个工具名（第 1 步报告 §3.2 来源 ①）。
 *
 * matcher 只写精确名单（r10 §3.2.2）：ZCode 对「只含字母数字下划线与 `|`」的 matcher 按 `|` 拆成精确名，
 * 否则当**不锚定**的正则——`Write` 会误匹配 `TodoWrite`。`NotebookEdit` 不在 ZCode 注册表里，渲染时去掉；
 * `ApplyPatch` 经 ZCode 的 matcher 别名会被 `Write|Edit` 覆盖，但路径嵌在 `operation.path`、
 * `extractTargetPath` 取不到（报告 §3.2 第 3 条），是登记在案的已知边界，不在这里补。
 */
const ZCODE_HOOK_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'Bash']);

/** 护栏失效提示里点名的配置文件：渲染到别家时要换成别家的，否则提示把人指到一个不起作用的文件 */
const CLAUDE_SETTINGS_MENTION = '.claude/settings.json 中的 TriviumCode Hook';

function toZcodeEntry(entry: HookEntry, targetPath: string): HookEntry {
  let matcher: string | undefined;
  if (entry.matcher !== undefined) {
    const kept = entry.matcher.split('|').filter((n) => ZCODE_HOOK_TOOLS.has(n));
    if (kept.length === 0) {
      // 源里新加了一条 ZCode 没有的工具名：静默丢掉整条就是「装上了却不拦」，当场抛
      throw new Error(`hooks.json 的 matcher「${entry.matcher}」在 ZCode 上一个工具名都不剩，无法渲染`);
    }
    matcher = kept.join('|');
  }
  return {
    ...(matcher !== undefined ? { matcher } : {}),
    hooks: entry.hooks.map((h) => {
      const { timeout, ...rest } = h;
      const command = h.command.includes(CLAUDE_SETTINGS_MENTION)
        ? h.command.split(CLAUDE_SETTINGS_MENTION).join(`${targetPath} 中的 TriviumCode Hook`)
        : h.command;
      return {
        ...rest,
        command,
        ...(timeout !== undefined ? { timeoutMs: timeout * 1000 } : {}),
      } as HookEntry['hooks'][number];
    }),
  };
}

/**
 * ZCode 的 Hook 事件枚举（第 1 步报告 §3.1 静态读数：`SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest /
 * PostToolUse / PostToolUseFailure / Stop`）。
 *
 * 与工具名同一条理由设守卫（代码双审 r3 GLM-04）：`hooks.json` 将来新加一个 ZCode 不认的事件，原样写进去就是
 * 「装上了却不触发」。今天源里只用 `PreToolUse` / `Stop` / `SessionStart`，都在枚举内。
 */
const ZCODE_HOOK_EVENTS: ReadonlySet<string> = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop',
]);

/** 按形态渲染出「事件 → 条目列表」。ZCode 事件名与 Claude Code 同名，但只认 {@link ZCODE_HOOK_EVENTS} 里的 */
export function renderHookEvents(
  format: HookConfigFormat,
  source: HookSource,
  targetPath: string,
): Record<string, HookEntry[]> {
  if (format === 'claude-settings') return source.hooks;
  const out: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(source.hooks)) {
    if (!ZCODE_HOOK_EVENTS.has(event)) {
      throw new Error(
        `hooks.json 的事件「${event}」不在 ZCode 的事件枚举里，无法渲染——` +
          '核对 hook-config.ts 的 ZCODE_HOOK_EVENTS 与第 1 步报告 §3.1 的事件读数',
      );
    }
    out[event] = entries.map((e) => toZcodeEntry(e, targetPath));
  }
  return out;
}

// ─────────────────────────── 合并 ───────────────────────────

/** 按事件追加、按 `gate hook-<name>` 原位替换；返回改动计数（两家共用） */
function mergeEvents(
  existing: Record<string, unknown[]>,
  incoming: Record<string, HookEntry[]>,
): { added: number; replaced: number } {
  let added = 0;
  let replaced = 0;
  for (const [event, entries] of Object.entries(incoming)) {
    const cur = Array.isArray(existing[event]) ? existing[event] : [];
    for (const entry of entries) {
      const sig = JSON.stringify(entry);
      const mine = hookNamesOf(entry);
      /*
       * 同一条 TriviumCode Hook 的识别依据是它调用的 `gate hook-<name>`，不是命令全文。
       * 命令文本或超时一变就按全文比，重跑会在同一事件下叠加第二条、每次工具调用双倍执行。
       * 升级时应当**替换**旧条目，而不是跳过或叠加。
       */
      const at = cur.findIndex((c) => [...hookNamesOf(c)].some((n) => mine.has(n)));
      if (at === -1) {
        cur.push(entry);
        added++;
      } else if (JSON.stringify(cur[at]) !== sig) {
        cur[at] = entry;
        replaced++;
      }
    }
    existing[event] = cur;
  }
  return { added, replaced };
}

async function readJsonObject(
  target: string,
  report: HookMergeReport,
): Promise<{ ok: true; had: boolean; raw: string | null; value: Record<string, unknown> } | { ok: false }> {
  if (!(await exists(target))) return { ok: true, had: false, raw: null, value: {} };
  const raw = await fs.readFile(target, 'utf8');
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('不是 JSON 对象');
    return { ok: true, had: true, raw, value: value as Record<string, unknown> };
  } catch {
    warn(`${target} 不是合法的 JSON 对象，为避免破坏内容，跳过 Hook 合并。请手工合并。`);
    report.notes.push(`${target} 解析失败，未合并 Hook`);
    return { ok: false };
  }
}

/**
 * 把本仓 Hook 合并进 `agent` 的项目内配置文件。`agent.hookConfigTarget` 为 null 时什么都不做。
 *
 * 写前备份为 `<文件>.trivium-backup`；全部条目已就位时不写、记一条「已就位」。
 */
export async function mergeAgentHooks(
  projectRoot: string,
  agent: AgentDescriptor,
  source: HookSource,
  report: HookMergeReport,
  dryRun: boolean,
): Promise<void> {
  const spec = agent.hookConfigTarget;
  if (!spec) return;
  const target = path.join(projectRoot, spec.path);
  const read = await readJsonObject(target, report);
  if (!read.ok) return;
  const { had, raw, value: config } = read;

  /*
   * 嵌套键的形态也要校验（代码双审 r3 GLM-02）：只校验顶层时，`"hooks": [...]` 会让合并结果落在数组的
   * 非下标属性上、序列化即丢，却报 created / updated；`"hooks": "x"` 在严格模式下直接抛 TypeError，
   * init 断在 wrapper 已写、Hook 未并的半途。与顶层同一口径：畸形就不动，原样保留、记一条说明。
   */
  const isObj = (v: unknown): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
  const hooksRaw = config['hooks'];
  const eventsRaw = isObj(hooksRaw) ? (hooksRaw as Record<string, unknown>)['events'] : undefined;
  if (
    (hooksRaw !== undefined && !isObj(hooksRaw)) ||
    (spec.format === 'zcode-config' && eventsRaw !== undefined && !isObj(eventsRaw))
  ) {
    const key = hooksRaw !== undefined && !isObj(hooksRaw) ? 'hooks' : 'hooks.events';
    warn(`${target} 的 ${key} 不是 JSON 对象，为避免破坏内容，跳过 Hook 合并。请手工合并。`);
    report.notes.push(`${target} 的 ${key} 形态不对（应为对象），未合并 Hook，文件原样保留`);
    return;
  }

  let changed: { added: number; replaced: number };
  let enabledNote: string | null = null;
  /** ZCode 形态：本次把缺席的 `hooks.enabled` 补成了 true（条目都已就位时也要写盘） */
  let enabledSet = false;
  if (spec.format === 'claude-settings') {
    const existing = (config['hooks'] ?? {}) as Record<string, unknown[]>;
    changed = mergeEvents(existing, renderHookEvents(spec.format, source, spec.path));
    config['hooks'] = existing;
  } else {
    const hooks = (config['hooks'] ?? {}) as Record<string, unknown>;
    const events = (hooks['events'] ?? {}) as Record<string, unknown[]>;
    changed = mergeEvents(events, renderHookEvents(spec.format, source, spec.path));
    hooks['events'] = events;
    /*
     * `enabled` 缺省为 false（ZCode 自己的缺省），不开就一条都不跑。
     * **只在缺席时置 true**：用户显式写了 false 是「停用」这一态（r10 §3.2.3），重跑 init 不该把它翻回来。
     */
    if (hooks['enabled'] === undefined) {
      hooks['enabled'] = true;
      enabledSet = true;
    } else if (hooks['enabled'] === false) {
      enabledNote = `${target} 的 hooks.enabled 为 false：TriviumCode Hook 已写入但不会运行（停用态，按你的设置保留）`;
    }
    config['hooks'] = hooks;
  }
  if (enabledNote) report.notes.push(enabledNote);

  if (changed.added === 0 && changed.replaced === 0 && !enabledSet) {
    report.skipped.push(`${target}（Hook 已就位）`);
    return;
  }
  /*
   * 预演不落任何东西，连目录也不建；汇报用「将……」措辞（代码双审 r3 CODEX-04）：`--json` 的 notes 会被
   * skill 原样念给用户，说「已写入 / 已备份」而其实没发生，就是在汇报两件没发生的事。
   */
  if (!dryRun) {
    await ensureDir(path.dirname(target));
    if (had && raw !== null) await fs.writeFile(`${target}.trivium-backup`, raw, 'utf8');
    await writeAtomic(target, JSON.stringify(config, null, 2) + '\n');
  }
  const done = dryRun ? '将' : '已';
  (had ? report.updated : report.created).push(target);
  if (changed.replaced > 0) report.notes.push(`${done}把 ${target} 里 ${changed.replaced} 条旧版 TriviumCode Hook 替换为当前版本`);
  if (had) report.notes.push(`${done}备份原 ${path.basename(target)} 到 ${path.basename(target)}.trivium-backup`);
  if (spec.format === 'zcode-config') {
    /*
     * 工作区 Hook 要在 ZCode 桌面端信任后才跑，声明一变就退回待信任（静态 `stale_digest`）；
     * 信任待定期间写工具照常执行、Hook 不跑，对模型与用户都不可见（报告 §3.1.1）。不提示就等于没装。
     * init 对每个项目都会走到这里，所以加一句「不用 ZCode 可忽略」（代码双审 r3 CODEX-03）。
     */
    report.notes.push(
      `${done}写入 ${target}：请在 ZCode 桌面端重新信任该工作区，信任前 Hook 不跑（不用 ZCode 可忽略本条）。` +
        '命令行（--prompt）模式下工作区 Hook 整体关闭；子代理里的工具调用不过工作区 Hook（尽力拦截，不兜底）',
    );
    /*
     * 分发语义如实说（代码双审 r3 CODEX-03 ≡ GLM-05）：很多项目整目录忽略 `.zcode/`（本仓自己就是），
     * 那样这份 Hook 只对本机生效、协作者克隆后拿不到。**不替用户开白名单**：ZCode 项目配置里可能还有个人设置，
     * 它的个人 / 共享分层本仓没核过；只在被忽略时说清楚，放不放行由用户定。
     */
    if (await gitIgnores(projectRoot, target)) {
      report.notes.push(
        `${target} 被 .gitignore 忽略：这份 Hook 只对本机生效、不随仓库分发；要分发请自行放行 ${spec.path}`,
      );
    }
  }
}

/** `target` 在 `projectRoot` 所在仓库里是否被 .gitignore 忽略。不是 git 仓库或判不了时返回 false（不猜） */
async function gitIgnores(projectRoot: string, target: string): Promise<boolean> {
  const r = await run('git', ['check-ignore', '-q', target], { cwd: projectRoot });
  return r.code === 0;
}

// ─────────────────────────── 在场判定与有效等级 ───────────────────────────

/**
 * 定级要求在场的 Hook（B1）：**L1 承诺覆盖的四道**，按事件查。
 *
 * 不只「写入」两道（代码双审 r3 CODEX-01）：L1 的入口资产同一段还承诺「裁决未完成不得收工……由 Hook 强制」，
 * 那是 `Stop` 上的 `hook-stop`；裁决期提交拦截与留痕完整性校验是 `hook-pre-commit`。缺任一道而仍判 L1，
 * 执笔者就被告知有 Hook 兜着而实际没有。`hook-session-start` 只注入待办、不拦任何东西，不进必需集。
 */
const REQUIRED_FOR_GUARD: readonly { event: string; name: string }[] = [
  { event: 'PreToolUse', name: 'pre-write' },
  { event: 'PreToolUse', name: 'pre-bash' },
  { event: 'PreToolUse', name: 'pre-commit' },
  { event: 'Stop', name: 'stop' },
];

/** 取一个 JSON 对象里的对象形态字段；缺席或形态不对都返回 null（调用方按「不在场」处理） */
function objectField(o: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = o[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function readJsonObjectQuiet(p: string): Promise<Record<string, unknown> | null> {
  try {
    const v = JSON.parse(await fs.readFile(p, 'utf8')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 该家的 TriviumCode Hook 配置**当前**是否在场：文件在、是合法 JSON 对象，且 {@link REQUIRED_FOR_GUARD} 四道各有一条。
 * ZCode 形态另要求 `hooks.enabled === true`（缺省 false 即一条都不跑）；
 * Claude 形态另看 `disableAllHooks`（代码双审 r3 GLM-01，官方文档：「To temporarily disable all hooks without
 * removing them, set `"disableAllHooks": true` in your settings file」）——同目录 `settings.local.json` 优先于项目文件，
 * 与 Claude Code 的设置优先级一致；任一层的有效值为 true 即不在场。
 *
 * **边界，两个方向都如实写**：
 * - **只看存在性，不看内容**（r5 §6.2 边界 R-r）：命令被改成放行、matcher 被缩窄、wrapper 或全局副本被替换，这里都看不见；
 * - **只读注册表登记的那一个项目内文件**（代码双审 r3 CODEX-02 ≈ GLM-01 ②）：Claude Code 会把 user 级、项目、local 各层的
 *   Hook 合并，落在 user 级或 `settings.local.json` 里的同一份这里看不见，会误判为「不在场」——偏保守，不会把没拦的说成拦。
 *   user 级的 `disableAllHooks` 也不读（项目外、因人而异；项目层的 false 本就会覆盖它）。
 */
export async function hookConfigPresent(projectRoot: string, agent: AgentDescriptor): Promise<boolean> {
  const spec = agent.hookConfigTarget;
  if (!spec) return false;
  const target = path.join(projectRoot, spec.path);
  const config = await readJsonObjectQuiet(target);
  if (!config) return false;
  let events: Record<string, unknown> | null;
  if (spec.format === 'claude-settings') {
    const local = await readJsonObjectQuiet(path.join(path.dirname(target), 'settings.local.json'));
    const localFlag = local?.['disableAllHooks'];
    const disabled = typeof localFlag === 'boolean' ? localFlag : config['disableAllHooks'] === true;
    if (disabled) return false;
    events = objectField(config, 'hooks');
  } else {
    const hooks = objectField(config, 'hooks');
    if (!hooks || hooks['enabled'] !== true) return false;
    events = objectField(hooks, 'events');
  }
  if (!events) return false;
  return REQUIRED_FOR_GUARD.every(({ event, name }) => {
    const entries = events![event];
    return Array.isArray(entries) && entries.some((e) => hookNamesOf(e).has(name));
  });
}

export interface EffectiveGuard {
  /** 本次运行实际成立的等级 */
  level: GuardLevel;
  /** 注册表登记的等级 */
  registered: GuardLevel;
  profile: GuardProfile;
  /** 登记为 L1 却因 Hook 配置不在场降为 L2 */
  downgraded: boolean;
}

/**
 * 当轮 Driver 的**有效**护栏等级（B1，r10 §3.3 收窄后的口径）。
 *
 * 只对**登记为 L1** 的载体判「Hook 配置当前是否在场」，不在场即降 L2；登记为 L2 的直接返回 L2，
 * 不再读任何探针字段（D-3 撤回了 `hooks_deny_ok`）。
 */
export async function effectiveGuardLevel(projectRoot: string, agent: AgentDescriptor): Promise<EffectiveGuard> {
  const profile = guardProfileOf(agent);
  if (agent.guardLevel !== 'L1') {
    return { level: agent.guardLevel, registered: agent.guardLevel, profile, downgraded: false };
  }
  const present = await hookConfigPresent(projectRoot, agent);
  return {
    level: present ? 'L1' : 'L2',
    registered: 'L1',
    profile,
    downgraded: !present,
  };
}

/**
 * 闸门停点那一句「在此期间不得修改业务文件」的后半句，按当轮 Driver 的**有效**护栏等级措辞（M10b 第 3 步）。
 *
 * 此前一律写「（Hook 会拦下）」：对 glm（L2，尽力拦截）、codex / gemini（L2，没有 Hook）以及 Hook 配置不在场的
 * claude 都不成立（第 2 步薄冒烟核出）。说「会拦下」而实际不拦，比不说更糟——执笔者会放心去写。
 */
export function gateHoldNotice(g: EffectiveGuard): string {
  const tail = '越界不会被事前拦下，会在审批前复核与跑后漂移复算时暴露。';
  /*
   * L1 档也登记超时这一例外（代码双审 r3 GLM-06）：官方文档「A timed-out … hook doesn't block the tool call」。
   * 本仓 Hook 是毫秒级脚本、每条挂 15 / 30 秒超时，正常碰不到，但「会拦下」不写成无例外的断言。
   */
  if (g.level === 'L1') return '在此期间不得修改业务文件（Hook 会拦下；Hook 超时即放行，本仓 Hook 是毫秒级、正常碰不到）。';
  if (g.downgraded) return `在此期间不得修改业务文件——本项目的 Hook 配置不在场（登记 L1，本次按 L2 计），靠你自觉；${tail}`;
  if (g.profile === 'l2-hook') return `在此期间不得修改业务文件——本载体的 Hook 只作尽力拦截、不兜底（L2），靠你自觉；${tail}`;
  return `在此期间不得修改业务文件——本载体没有 Hook 拦截（L2），全靠你自觉；${tail}`;
}

/**
 * 护栏等级的人读文案（与入口资产注入段同源：都按 {@link GuardProfile} 分三档，r10 §3.1.3）。
 * glm 打印「L2，有尽力拦截 Hook，不兜底」，不再有「L2 = 无事前写拦截」这种与 glm 实况相反的说法。
 */
export function describeGuard(agent: AgentDescriptor, g: EffectiveGuard): string {
  const target = agent.hookConfigTarget?.path ?? '';
  if (g.downgraded) {
    return `L2（登记 L1，但 ${target} 里的 TriviumCode Hook 不在场，本次按 L2 计：写入没有事前拦截，` +
      '靠审批前复核、_meta 唯一事实、防覆盖与跑后复算兜底；修复：trivium init 或 trivium hooks --agent ' + agent.id + '）';
  }
  switch (g.profile) {
    case 'l1-hook':
      return `L1（${target} 的 Hook 兜得住写入）`;
    case 'l2-hook':
      return `L2（有尽力拦截的 Hook：${target}，不兜底——只在桌面端、已信任、主代理、matcher 覆盖、不超时时生效）`;
    case 'l2-none':
      return 'L2（该载体没有 Hook 机制，写入没有事前拦截，靠审批前复核、_meta 唯一事实、防覆盖与跑后复算兜底）';
  }
}
