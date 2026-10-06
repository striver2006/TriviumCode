/**
 * `trivium init`：在目标项目内布置运行时（设计 §5.3 / 交付物 #8）。
 *
 * 产出：
 *   `.trivium/bin/trivium`  wrapper，内含 doctor 探测到的 **node 绝对路径**
 *   `.trivium/config.yaml`  团队共享策略（进 Git）
 *   Hook 配置             按注册表 `hookConfigTarget` 合并进每一家登记了目标的项目配置
 *                         （今天是 `.claude/settings.json` 与 `.zcode/config.json`；按事件名追加，不替换用户既有 hooks）
 *   `.gitignore`            幂等追加 `.trivium/` 规则，并修正整体忽略 `.claude/` 的写法
 *   协议片段              按注册表 `instructionFiles` 分发（CLAUDE.md / AGENTS.md / GEMINI.md），两段式
 *
 * 全部操作**幂等**：重复运行不重复追加、不覆盖用户内容。
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import { AGENTS, type AgentDescriptor } from './agents/registry.js';
import type { Ctx } from './types.js';
import { CONFIG_SCHEMA_ID, CONFIG_SCHEMA_ID_V1, defaultConfig, migrateConfigV1, resolveAssetRoot } from './config.js';
import { createExclusive, ensureDir, exists, writeAtomic } from './util/fsx.js';
import { say, step, warn } from './util/log.js';
import { hookNamesOf, loadHookSource, mergeAgentHooks } from './hook-config.js';

const MARKER_BEGIN = '<!-- BEGIN TriviumCode -->';
const MARKER_END = '<!-- END TriviumCode -->';
const GITIGNORE_MARKER = '# TriviumCode 编排器运行时目录 (.trivium/)';

export interface InitOptions {
  ctx: Ctx;
  /** skill 资产根，默认用户级安装位置 */
  assetRoot?: string;
  /** node 绝对路径。省略时取当前进程的 */
  nodePath?: string;
  /** 只报告将要做什么，不落盘 */
  dryRun?: boolean;
  /** 已确认的编译测试命令。未确认时不写入 verify（§14.1：未经确认的候选永不执行） */
  verify?: { build: string[]; test: string[] };
}

export interface InitReport {
  created: string[];
  updated: string[];
  skipped: string[];
  notes: string[];
}

/**
 * 协议片段两段式（M10b 第 2 步；演进设计 §7.5，计划 r2 §3.3）：【审查员身份】+【Driver 协议】。
 *
 * 每个项目记忆文件（注册表 `instructionFiles`）带哪几段，**由读它的那几家派生**：
 *   · 有一家能作审核者、且作审核者时读得到项目记忆 ⇒ 带【审查员身份】，放在最前——首段按身份分流；
 *   · 有一家能作 Driver ⇒ 带【Driver 协议】。
 * claude 作审核者以 `--restricted` 拉起、读不到项目记忆（EV-44），所以 CLAUDE.md 不带审查员段。
 */
export type ProtocolSection = 'critic' | 'driver';

export interface ProtocolPlanItem {
  file: string;
  sections: ProtocolSection[];
}

export function protocolPlan(agents: readonly AgentDescriptor[] = AGENTS): ProtocolPlanItem[] {
  const files = [...new Set(agents.flatMap((a) => a.instructionFiles))];
  return files
    .map((file) => {
      const readers = agents.filter((a) => a.instructionFiles.includes(file));
      const sections: ProtocolSection[] = [];
      if (readers.some((a) => a.criticEnabled && a.criticReadsInstructionFiles)) sections.push('critic');
      if (readers.some((a) => a.driverEnabled)) sections.push('driver');
      return { file, sections };
    })
    .filter((p) => p.sections.length > 0);
}

/** 片段文件名（相对资产根） */
const SECTION_FILE: Readonly<Record<ProtocolSection, string>> = {
  critic: 'protocol/critic.snippet',
  driver: 'protocol/driver.snippet',
};

/** 拼出一个文件的标记内正文；缺片段文件返回 null（调用方记 notes 并跳过） */
export async function composeProtocol(assetRoot: string, sections: readonly ProtocolSection[]): Promise<string | null> {
  const parts: string[] = [];
  for (const s of sections) {
    const p = path.join(assetRoot, SECTION_FILE[s]);
    if (!(await exists(p))) return null;
    parts.push((await fs.readFile(p, 'utf8')).trim());
  }
  return parts.join('\n\n');
}

/**
 * 历代协议片段的指纹：sha256（标记内正文 trim 之后），**按指令文件分档**。
 *
 * 单段时代取自 git 历史里 `protocol/CLAUDE.md.snippet` 的 11 个版本与 `protocol/AGENTS.md.snippet` 的 1 个版本
 * （M10b 第 2 步删除这两个文件时逐版算出）。标记内正文命中**本文件那一档**的其一 ⇒ 用户没动过，
 * 可以整段换成当前版；不命中 ⇒ 多半手工改过，**不替换**，提示手工合并（r2 §3.3 登记的未覆盖项）。
 *
 * ## 为什么按文件分档（M10b 第 2 步代码双审 r2 CODEX-02）
 *
 * 三类正文同时存在：审查员段单独（= 旧 AGENTS.md 片段）、Driver 段单独（CLAUDE.md 当前版）、两段拼合
 * （AGENTS.md / GEMINI.md 当前版）。不分文件查一张总表时，用户在 AGENTS.md 里**删掉其中一段**，
 * 剩下的正文恰好等于另一类文件的已知正文，就会被判「已知旧版」而原位复原——用户的删除被静默撤销。
 * 那不是哈希碰撞，是真相等。所以「命中已知版本」只在**本文件发出过的形状**里才等于「用户没动过」。
 * 表里没有的文件（将来新登记的指令文件）一律按「不认识」处理：只追加、不替换。
 *
 * **分档也消不掉的一格**：AGENTS.md 里用户删掉 Driver 段、只留审查员段——剩下的正文与旧版 init
 * 给 AGENTS.md 写的那一版逐字相同，「用户删过」与「旧版项目」在盘上是同一个状态，无从区分。
 * 这里按旧版升级（后者远为常见）；想长期只留审查员段的用户，改一个字就不会再被认成旧版。
 *
 * ## 这张表**只追加、含当前版**（代码双审 r1 GLM-03）
 *
 * 每一档登记的是「这个文件发出去过的每一版标记内正文」，**包括当前这一版**。维护不靠记性：
 * `init.test.ts` 断言当前 `protocolPlan()` 给每个文件拼出的正文指纹都在**该文件那一档**里——改了
 * `driver.snippet` / `critic.snippet` 就当场变红，照提示把新值追加进对应的档即可。
 * 旧值不用「挪」：它还是当前版时就已经在档里了。
 *
 * **改 `driver.snippet` 时另有一格人工核对：本仓根 `CLAUDE.md`**（BACKLOG EV-138，用户 2026-10-06 定维持手工维护）。
 * 它的标记内是手工演进的旧形态、不在 `CLAUDE.md` 那一档的任何一版里，`init` 对它恒走「未替换、提示手工合并」，
 * 所以 `driver.snippet` 的演进不会自动进这份文件——而它正是本仓缺省 Driver 读的指令文件。改完片段后对照一遍，
 * 需要同步的内容请用户决定、由用户改（它同时是用户的项目指令文件）；不要为了让 `init` 接管而把它登记进上面的档。
 *
 * 当前版也在档里不影响判定：标记内正文等于当前正文时先走「已是当前版本」那一格。
 */
export const KNOWN_PROTOCOL_SHA256: Readonly<Record<string, ReadonlySet<string>>> = {
  'CLAUDE.md': new Set([
    'c820483df2fddd16cccd8c4fc3b7a69d30be36a1d21dbcad4d11ed15b331731b', // CLAUDE.md.snippet @10d388d
    '2cf4f59ee9f1d1a8cd088fe97904beb79191226b358bebee347242024abf8a7c', // @82773dc
    'dc45d7443edb3417075e2fd10959d2064e4a8532b614d9607060de3f75f83f0f', // @f4f3970
    'bd36c8411e68468dc9de33126e7c95ebc9ff3ab42c5f4d94f9d94d549505b3cc', // @6177d26
    'c5aa08dbed3b2aca59887056e70eb6ee9e31ffa5ae12c90df0cfec47ea0883b1', // @c16d044
    'ef6c0e1efae32aa51f1100ed302843336b5b3ac33940d06ccbd89bd504c9a5e6', // @b4fe405
    '106bf9fa983db22d935844dc66415ece9ec978ecb1c6679eba33674ada4ea1cf', // @4c2b309
    '93dc3e8779d1f495dded7cb0f346d18b4875abe3b4e3b72647c73663fd129f36', // @6129058
    '38024021ca10ccbf276622a601ef90a7ef7726cf969b20b5ee799f18ac967e38', // @d2b34cb
    'd8f3fc036302afb43366fd5a6d1122aef67fba9008d8463d20e4ffb79f0fcf53', // @5a5ef19
    'ca0fdd052d101a3a063b34d0c2e03844291339baa7804b04e5c7d317f463e562', // @2d7cbbc
    // ── 两段式（M10b 第 2 步起）：CLAUDE.md 只写 Driver 段 ──
    'c93b609aa97a2601f06e98d656cfeec8173e082ccd8ecff0858a676f4cffd02d', // driver
    '4b7f566f042998201ffcd882af88fd4ef711df01969e8bc3ed18e836dcee34e0', // driver · EV-132 按时点写实 L2 事后覆盖面
    'e92ddb2fbfdd2905853262a5b1b98039e9435f553b6fb584aa7920463bb7d0cd', // driver · EV-132 ② 折中版：闸门期审批时打印工作树摘要
  ]),
  'AGENTS.md': new Set([
    '4aa6b8bc34f8f8f14156ee2dd3891dc758964c64f7843fb81ed5ba819761aa78', // AGENTS.md.snippet @2d7cbbc
    // ── 两段式（M10b 第 2 步起）──
    '6c284393db5cd8198c5b9509035c4f5a4444d2671f16eb0ae26d4e05f68c6204', // critic + driver
    'b8e7fadf1e997cea8357308e33104b686241d54ad197348ceca67831c60886a3', // critic + driver · EV-132
    'c3926a651c052011c1eb5bb7aabdc4cd01565a72eb2bdb3e3cb5aae73b6f9483', // critic + driver · EV-132 ② 折中版
  ]),
  // M10b 第 2 步新登记的指令文件：没有单段时代
  'GEMINI.md': new Set([
    '6c284393db5cd8198c5b9509035c4f5a4444d2671f16eb0ae26d4e05f68c6204', // critic + driver
    'b8e7fadf1e997cea8357308e33104b686241d54ad197348ceca67831c60886a3', // critic + driver · EV-132
    'c3926a651c052011c1eb5bb7aabdc4cd01565a72eb2bdb3e3cb5aae73b6f9483', // critic + driver · EV-132 ② 折中版
  ]),
};

/** 目标文件发出过的某一版正文？只查该文件那一档（见 KNOWN_PROTOCOL_SHA256） */
export function isKnownProtocolBody(file: string, interior: string): boolean {
  return KNOWN_PROTOCOL_SHA256[path.basename(file)]?.has(protocolFingerprint(interior)) ?? false;
}

export const protocolFingerprint = (body: string): string =>
  createHash('sha256').update(body.trim()).digest('hex');

/**
 * 写入或升级带标记的协议块。
 *
 *   无标记               → 追加（原有内容一字不动）；
 *   标记内 = 当前正文     → 跳过（幂等）；
 *   标记内 = 本文件的已知旧版 → **原位替换**成当前正文（旧单段 → 新两段），不追加第二块；
 *                          别的文件的已知正文不算（删掉一段后恰好等于它，见 KNOWN_PROTOCOL_SHA256）；
 *   标记内是别的          → **不动**，提示手工合并：宁可停在旧版，也不覆盖用户的手工修改；
 *   只有开始标记没有结束 → 不动，提示。
 */
export async function upsertProtocolBlock(
  target: string,
  body: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  const existing = (await exists(target)) ? await fs.readFile(target, 'utf8') : '';
  const begin = existing.indexOf(MARKER_BEGIN);
  if (begin === -1) {
    const block = `\n${MARKER_BEGIN}\n${body.trim()}\n${MARKER_END}\n`;
    if (!dryRun) await writeAtomic(target, existing + block);
    (existing.length > 0 ? report.updated : report.created).push(target);
    return;
  }
  const end = existing.indexOf(MARKER_END, begin);
  if (end === -1) {
    report.skipped.push(`${target}（TriviumCode 片段只有开始标记、没有结束标记）`);
    report.notes.push(`${target} 的 TriviumCode 片段标记不完整，未改动；请手工修正后重跑 init`);
    return;
  }
  const interior = existing.slice(begin + MARKER_BEGIN.length, end).trim();
  if (interior === body.trim()) {
    report.skipped.push(`${target}（TriviumCode 片段已是当前版本）`);
    return;
  }
  if (!isKnownProtocolBody(target, interior)) {
    report.skipped.push(`${target}（TriviumCode 片段与任何已知版本都不同，未替换）`);
    report.notes.push(
      `${target} 的 TriviumCode 片段与任何已知版本都不同（多半手工改过），未替换。\n` +
        '  新版正文由资产根 protocol/ 下的片段拼成；请把标记内内容手工合并到新版。',
    );
    return;
  }
  const next = `${existing.slice(0, begin)}${MARKER_BEGIN}\n${body.trim()}\n${existing.slice(end)}`;
  if (!dryRun) await writeAtomic(target, next);
  report.updated.push(target);
  report.notes.push(`已把 ${target} 的 TriviumCode 片段从已知旧版升级为当前版本（审查员身份 / Driver 协议两段）`);
}

/**
 * 修正 `.gitignore`。
 *
 * 两件事：追加 `.trivium/` 规则；把整体忽略 `.claude/` 改为白名单写法——
 * 否则随仓库分发的 Hook `settings.json` 会被一并忽略（审核意见 RV-06）。
 */
export async function fixGitignore(
  projectRoot: string,
  snippetPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  const p = path.join(projectRoot, '.gitignore');
  let content = (await exists(p)) ? await fs.readFile(p, 'utf8') : '';
  let changed = false;

  // ① 整体忽略 .claude/ → 白名单
  const lines = content.split('\n');
  const bad = lines.findIndex((l) => l.trim() === '.claude/' || l.trim() === '/.claude/');
  if (bad !== -1) {
    lines.splice(
      bad,
      1,
      '# Claude Code：忽略个人状态，但保留随仓库分发的 Hook 配置（TriviumCode 需要）',
      '.claude/*',
      '!.claude/settings.json',
      '.claude/settings.local.json',
    );
    content = lines.join('\n');
    changed = true;
    report.notes.push(
      '已把整体忽略 `.claude/` 改为白名单写法——否则随仓库分发的 Hook settings.json 会被忽略',
    );
  }

  // ② 追加 .trivium/ 规则（幂等）
  if (!content.includes(GITIGNORE_MARKER)) {
    if (await exists(snippetPath)) {
      content = content.replace(/\n*$/, '\n') + (await fs.readFile(snippetPath, 'utf8'));
      changed = true;
    }
  }

  if (!changed) {
    report.skipped.push(`${p}（无需修改）`);
    return;
  }
  if (!dryRun) await writeAtomic(p, content);
  report.updated.push(p);
}

/**
 * 合并 Hook 进 Claude Code 形态的项目配置（`.claude/settings.json`）。
 *
 * **按事件名追加而非替换**（风险 R-D）：用户可能已有自己的 hooks。写前备份；已就位时跳过（幂等）。
 * 渲染、合并与去重的实现在 `hook-config.ts`（M10b 第 3 步起两家共用）；本函数保留原签名，
 * 只合并登记为 `claude-settings` 形态的那一家。两家一起合并用 {@link mergeAllHooks}。
 */
export async function mergeHooks(
  projectRoot: string,
  hooksJsonPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  const source = await loadHookSource(hooksJsonPath);
  if (!source) {
    report.notes.push(`缺少 ${hooksJsonPath}，跳过 Hook 合并`);
    return;
  }
  for (const agent of AGENTS.filter((a) => a.hookConfigTarget?.format === 'claude-settings')) {
    await mergeAgentHooks(projectRoot, agent, source, report, dryRun);
  }
}

/**
 * 把本仓 Hook 合并进每一家登记了 `hookConfigTarget` 的项目配置（M10b 第 3 步，r5 §6.1「`trivium init` 同时合并两家」）。
 *
 * `only` 给定时只合并这几家（`trivium hooks --agent <id>`）；它们必须都登记了 Hook 目标，由调用方先校验。
 */
export async function mergeAllHooks(
  projectRoot: string,
  hooksJsonPath: string,
  report: InitReport,
  dryRun: boolean,
  only?: readonly AgentDescriptor[],
): Promise<void> {
  const source = await loadHookSource(hooksJsonPath);
  if (!source) {
    report.notes.push(`缺少 ${hooksJsonPath}，跳过 Hook 合并`);
    return;
  }
  for (const agent of only ?? AGENTS.filter((a) => a.hookConfigTarget !== null)) {
    await mergeAgentHooks(projectRoot, agent, source, report, dryRun);
  }
}

/** 一条 hooks 条目里调用了哪些 `gate hook-<name>`（实现在 `hook-config.ts`，这里保留导出给既有调用方） */
export { hookNamesOf };

/**
 * 把 Homebrew Cellar 的版本化路径换成稳定入口。
 *
 * `process.execPath` 在 Homebrew 下解析为 `/opt/homebrew/Cellar/node/25.2.1/bin/node`，
 * `brew upgrade node` 后该路径消失；hooks.json 的守卫只检查 wrapper 自身可执行，
 * 于是每次 Edit / Write / Bash / Stop 都报一次 127。`<prefix>/opt/node[@N]/bin/node`
 * 是 Homebrew 维护的稳定符号链接，升级后仍然有效。
 */
export async function stableNodePath(
  execPath: string,
  existsFn: (p: string) => Promise<boolean> = exists,
): Promise<string> {
  const m = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(execPath);
  if (!m) return execPath;
  const stable = `${m[1]}/opt/${m[2]}/bin/node`;
  return (await existsFn(stable)) ? stable : execPath;
}

/**
 * 校验 wrapper 指向的 node 与 bundle 是否仍然存在（供 doctor / init 报告）。
 * wrapper 自身在、里面写死的路径却失效，是 `brew upgrade node` 或重装 skill 之后的常见形态。
 */
export async function checkWrapper(triviumDir: string): Promise<string[]> {
  const p = path.join(triviumDir, 'bin/trivium');
  if (!(await exists(p))) return [];
  const script = await fs.readFile(p, 'utf8');
  const m = /^exec "([^"]+)" "([^"]+)"/m.exec(script);
  if (!m) return [`${p} 不是 trivium init 生成的 wrapper 形态，请重跑 trivium init`];
  const problems: string[] = [];
  if (!(await exists(m[1]!))) problems.push(`wrapper 写死的 node 已不存在：${m[1]}（brew upgrade node 之后常见）。请重跑 trivium init`);
  if (!(await exists(m[2]!))) problems.push(`wrapper 指向的 bundle 已不存在：${m[2]}。请重新安装 skill 后重跑 trivium init`);
  return problems;
}

/** wrapper 内写死 node 绝对路径：GUI 进程不读 ~/.zshrc（设计 §10.5） */
export async function writeWrapper(
  triviumDir: string,
  nodePath: string,
  assetRoot: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  const p = path.join(triviumDir, 'bin/trivium');
  const script =
    `#!/bin/sh\n` +
    `# 由 \`trivium init\` 生成。node 路径写死是刻意的：\n` +
    `# GUI 进程（VS Code）不读 ~/.zshrc，依赖 PATH 会在插件里失效（设计 §10.5）。\n` +
    `exec "${nodePath}" "${path.join(assetRoot, 'scripts/trivium.cjs')}" "$@"\n`;
  const had = await exists(p);
  await ensureDir(path.dirname(p));
  if (!dryRun) {
    await writeAtomic(p, script);
    await fs.chmod(p, 0o755);
  }
  (had ? report.updated : report.created).push(p);
}

/**
 * `config.yaml` 的 v1 → v2 一次性磁盘改写（设计 §13.1.1，M7b 第 4 步）。
 *
 * 返回是否真的改写了。**这是可选优化，不是必要步骤**：`loadCtx` 的内存迁移
 * 已经让旧配置照常可用，所以这里的每一条失败路径都选择「放弃改写并说明」，
 * 而不是让 `init` 整个失败——为一个锦上添花的动作打断初始化不划算。
 *
 * 失败路径纪律（计划 §3.2 逐条钉死）：
 *   · 备份用 `O_CREAT|O_EXCL`，已存在即放弃——与归档的防覆盖铁律同纪律，
 *     决不覆盖一份可能是上一次改写留下的、唯一的原文；
 *   · 已是 v2 则幂等 no-op；
 *   · 新文件走临时文件 + `rename` 原子替换（`writeAtomic`），不留半份。
 *
 * **注释保留是尽力项，不是验收项**：YAML 往返会丢掉原文件里的解释性注释。
 * 原文完整保留在备份里，这一点会在报告里对用户说明。
 */
async function rewriteConfigToV2(
  cfgPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(cfgPath, 'utf8');
  } catch (e) {
    report.notes.push(`${cfgPath} 读取失败，跳过 v2 改写：${(e as Error).message}`);
    return false;
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    report.notes.push(`${cfgPath} 不是合法 YAML，跳过 v2 改写（内存迁移不受影响）：${(e as Error).message}`);
    return false;
  }

  const { config: migrated, note } = migrateConfigV1(parsed);
  if (!note) return false; // 已是 v2，或没有任何可迁移的东西：幂等 no-op

  const backup = `${cfgPath}.trivium-backup`;
  if (!dryRun) {
    try {
      // O_EXCL：备份已存在就放弃。宁可不改，也不覆盖唯一的原文
      await createExclusive(backup, raw);
    } catch (e) {
      const why = (e as NodeJS.ErrnoException).code === 'EEXIST'
        ? `${path.basename(backup)} 已存在`
        : (e as Error).message;
      report.notes.push(
        `跳过 config.yaml 的 v2 改写：备份写不成（${why}）。\n` +
          '  旧配置仍可用——每次运行会在内存里迁移，只是每次都会打一行提示。',
      );
      return false;
    }
    const header =
      '# TriviumCode 项目配置（进 Git，团队共享）\n' +
      '# 本机绝对路径与探针结论在 config.local.yaml（不进 Git）\n' +
      '# verify.build / verify.test 只执行此处显式声明的命令——编排器不猜测执行（§14.1）\n' +
      `# 本文件由 trivium init 从 ${CONFIG_SCHEMA_ID_V1} 改写而来，原文见 ` +
      `${path.basename(backup)}（YAML 往返会丢失注释，原注释在备份里）\n\n`;
    await writeAtomic(cfgPath, header + YAML.stringify(migrated, { lineWidth: 0 }));
  }

  report.updated.push(cfgPath);
  /*
   * dry-run 用将来时（审查意见 GLM-08）：那条路径不写备份也不写新文件，
   * 用完成时态点名一个**不存在的备份文件**会误导，而该陈述还会进 `--json` 机读输出。
   */
  report.notes.push(
    dryRun
      ? `将把 ${cfgPath} 改写为 ${CONFIG_SCHEMA_ID}，原文将备份到 ${path.basename(backup)}。\n` +
          '  注意：YAML 往返会丢掉原文件里的注释，原注释将完整保留在备份中。'
      : `已把 ${cfgPath} 改写为 ${CONFIG_SCHEMA_ID}，原文备份到 ${path.basename(backup)}。\n` +
          '  注意：YAML 往返会丢掉原文件里的注释，原注释完整保留在备份中。',
  );
  return true;
}

export async function runInit(opts: InitOptions): Promise<InitReport> {
  const { ctx } = opts;
  const assetRoot = resolveAssetRoot(opts.assetRoot);
  const nodePath = opts.nodePath ?? ctx.config.runtime.node ?? (await stableNodePath(process.execPath));
  const dryRun = opts.dryRun ?? false;
  const report: InitReport = { created: [], updated: [], skipped: [], notes: [] };

  if (!(await exists(path.join(assetRoot, 'scripts/trivium.cjs')))) {
    report.notes.push(
      `⚠️ 找不到 ${path.join(assetRoot, 'scripts/trivium.cjs')}。` +
        `请先在 TriviumCode 仓库执行 \`npm run build && node dist/install.cjs\`。`,
    );
  }

  await ensureDir(ctx.triviumDir);

  // ── config.yaml（团队共享策略，进 Git）──
  const cfgPath = path.join(ctx.triviumDir, 'config.yaml');
  if (await exists(cfgPath)) {
    const rewritten = await rewriteConfigToV2(cfgPath, report, dryRun);
    if (!rewritten) report.skipped.push(`${cfgPath}（已存在，不覆盖）`);
  } else {
    const base = defaultConfig();
    // probe 段属本机结论，落在 config.local.yaml，不进这份
    const { probe: _probe, ...shared } = base;
    const shareable = {
      ...shared,
      verify: opts.verify ?? { build: [], test: [] },
    };
    const header =
      '# TriviumCode 项目配置（进 Git，团队共享）\n' +
      '# 本机绝对路径与探针结论在 config.local.yaml（不进 Git）\n' +
      '# verify.build / verify.test 只执行此处显式声明的命令——编排器不猜测执行（§14.1）\n\n';
    if (!dryRun) await writeAtomic(cfgPath, header + YAML.stringify(shareable, { lineWidth: 0 }));
    report.created.push(cfgPath);
  }

  await writeWrapper(ctx.triviumDir, nodePath, assetRoot, report, dryRun);
  // 两家一起合并（M10b 第 3 步）：claude 进 .claude/settings.json，glm 进 .zcode/config.json（尽力拦截，不兜底）
  await mergeAllHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, dryRun);
  await fixGitignore(
    ctx.projectRoot,
    path.join(assetRoot, 'protocol/gitignore.snippet'),
    report,
    dryRun,
  );
  // 协议片段：按注册表 instructionFiles 分发（EV-06 结案的「接上」分支；替换原先写死的两处调用）
  for (const item of protocolPlan()) {
    const body = await composeProtocol(assetRoot, item.sections);
    if (body === null) {
      report.notes.push(`资产根 ${assetRoot} 缺少协议片段（protocol/*.snippet），跳过 ${item.file}`);
      continue;
    }
    await upsertProtocolBlock(path.join(ctx.projectRoot, item.file), body, report, dryRun);
  }

  // 归档根与 README
  const reviewsReadme = path.join(ctx.archiveRoot, 'README.md');
  if (!(await exists(reviewsReadme))) {
    await ensureDir(ctx.archiveRoot);
    if (!dryRun) {
      await writeAtomic(
        reviewsReadme,
        '# 多智能体协同审计与留痕目录 (.reviews)\n\n' +
          '本目录由 TriviumCode 编排器写入，是双审流水线对外的事实来源。\n' +
          '命名规范见 `<日期>-<主题>[-r<N>][-revised|-response]-<角色>.md`。\n',
      );
    }
    report.created.push(reviewsReadme);
  }

  /*
   * 判据取磁盘上的**实际配置**（ctx.config 已由 loadCtx 合并 config.yaml
   * 与 config.local.yaml），而非本次入参：config.yaml 已存在时 init 不覆盖它，
   * 若只看 opts.verify，重跑 init 会对一份配好的项目误报「留空」。
   * opts.verify 仍优先——它代表本次刚确认并写入的候选（§14.1）。
   */
  const effectiveVerify = opts.verify ?? ctx.config.verify;
  if (effectiveVerify.build.length === 0 && effectiveVerify.test.length === 0) {
    report.notes.push(
      'verify.build / verify.test 留空：编排器**只执行**显式配置的命令，不猜测执行（§14.1）。' +
        '请把 `trivium doctor` 探测到的候选逐条确认后写入 .trivium/config.yaml。' +
        '命令 A（/dual-run）在两者皆空时会拒绝启动。',
    );
  }

  return report;
}

export function renderInitReport(r: InitReport, dryRun: boolean): void {
  say('');
  say(dryRun ? 'TriviumCode 初始化（预演，未落盘）' : 'TriviumCode 初始化完成');
  say('─'.repeat(60));
  for (const c of r.created) say(`  + ${c}`);
  for (const u of r.updated) say(`  ~ ${u}`);
  for (const s of r.skipped) step(`  = ${s}`);
  if (r.notes.length > 0) {
    say('');
    for (const n of r.notes) warn(n);
  }
  say('');
}
