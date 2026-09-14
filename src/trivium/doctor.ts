/**
 * `trivium doctor`：本机能力探针总编排（设计 §3.5 / 里程碑 M0）。
 *
 * 设计原则 P7「能力靠探针，不靠记忆」：三家 CLI 的参数与行为随版本漂移，
 * 实现代码一律读这里回填的结论，**不得把设计文档里的命令行硬编码进适配层**。
 *
 * 输出两份：
 *   - 机读：`.trivium/config.local.yaml` 的 `probe:` 段；
 *   - 人读：stdout 的分项报告（`--json` 时改为结构化输出）。
 */
import path from 'node:path';
import YAML from 'yaml';
import { agentConfigOf, defaultProbe, patchProbe } from './config.js';
import { EXIT } from './exit-codes.js';
import { probeEnv } from './probes/env.js';
import { probeVerifyCommands } from './probes/verify-commands.js';
import { probeAgy } from './probes/agy.js';
import { probeZcode } from './probes/zcode.js';
import { probeCodex } from './probes/codex.js';
import type { CodexProbe, Config, ProbeSection } from './types.js';
import { ALL_CLI_NAMES, agentByCliName } from './agents/registry.js';
import { say, step, warn } from './util/log.js';

export interface DoctorOptions {
  projectRoot: string;
  triviumDir: string;
  config: Config;
  /** 跳过一切消耗厂商配额的模型调用，只做静态探测 */
  skipModelCalls?: boolean;
  /**
   * 只跑某一段：任一 `cliName`，或 `env`。
   *
   * 取值集合由注册表派生（`isDoctorOnly`），不在类型里枚举——
   * 枚举过一次，结果是 `doctor --only codex` 在进 doctor 之前就被
   * `cli.ts` 的三值白名单退 64（审查意见 AGY-03 / GLM-06）。
   */
  only?: string | null;
}

/** `--only` 的合法取值：全部已登记 CLI，外加环境段 */
export const DOCTOR_ONLY_ENV = 'env' as const;

/** 合法 `--only` 取值清单，供 cli.ts 校验与 USAGE 文案共用 —— 两处不得各写各的 */
export function doctorOnlyChoices(): string[] {
  return [...ALL_CLI_NAMES, DOCTOR_ONLY_ENV];
}

export function isDoctorOnly(v: string): boolean {
  return doctorOnlyChoices().includes(v);
}

export interface DoctorReport {
  probe: ProbeSection;
  notes: string[];
  /** 阻断级问题：非空则 preflight 必然失败 */
  blockers: string[];
}

/** 一条诊断结论：进 blockers 还是只进 notes */
export interface SeverityLine {
  level: 'blocker' | 'note';
  message: string;
}

/**
 * codex 探针结论 → 诊断严重度（审查意见 GLM-03 / AGY-01 / GLM-01）。
 *
 * **抽成纯函数是为了能测**：这里有一条安全判定（沙箱失守），
 * 而它原先埋在 `runDoctor` 里、要真跑 codex 才走得到，等于没有测试守着。
 *
 * 三种失败不是一回事，原实现把它们压成了一档、而且压反了：
 * 「读不到文件」是 blocker，「沙箱失守」只是一条 note——后者意味着
 * 这一侧当审查员时**能写项目文件**，严重得多，却让 doctor 照常报
 * 「✓ 未发现阻断级问题」。
 *
 *   | 情形                | 未启用为审核者 | 已启用 |
 *   | 没装                | note           | blocker |
 *   | 装了但读不到文件    | note           | blocker |
 *   | 装了但**沙箱失守**  | blocker        | blocker |
 *
 * 末行不分档：失守说明这台机器上的 codex 现在就是不安全的，
 * 与「我们打不打算用它当审核者」无关。
 *
 * 前两行按 `criticEnabled` 分档的理由：codex 现在是 false，而全量 `doctor`
 * 会因 blockers 非空退非零码——**没装 codex 的用户什么都没做错，却会被硬阻断**。
 * 只有他显式 `--only codex` 时，「没装」才是他正想知道的答案。
 */
export function codexSeverity(
  probe: CodexProbe,
  ctx: { enabled: boolean; asked: boolean; skipModelCalls: boolean },
): SeverityLine[] {
  const gate = (message: string): SeverityLine =>
    ctx.enabled || ctx.asked
      ? { level: 'blocker', message }
      : { level: 'note', message: `${message}（该侧尚未启用为审核者，故不阻断）` };

  if (!probe.entrypoint) return [gate('未找到 codex 可执行文件')];

  /*
   * 只读负对照失守：**恒 blocker**，不看 criticEnabled、不看是否点名。
   * 判据要排除 skipModelCalls——那时负对照根本没跑，readonly_flags
   * 保留的是上一次结论，空集不代表失守。
   */
  if (!ctx.skipModelCalls && probe.readonly_flags.length === 0) {
    return [
      {
        level: 'blocker',
        message:
          'codex 只读沙箱负对照失败：-s read-only 下文件仍被创建，该侧不可用于审查。' +
          '在沙箱修好之前不要把它接入任何审查链路。',
      },
    ];
  }

  if (probe.exec_headless_read_ok === false) {
    return [
      gate(
        'codex exec headless 读不到文件——该侧无法作为审查员使用。' +
          '请确认 provider 凭据已配置（config.toml 的 model_providers.<name>.env_key）。',
      ),
    ];
  }

  /*
   * 第三态不静默放行：null 是「没测出结论」，与「测了没问题」必须
   * 在报告里长得不一样，否则三态改造就白做了。
   */
  if (probe.exec_headless_read_ok === null && !ctx.skipModelCalls) {
    return [
      {
        level: 'note',
        message:
          '⚠️ 读文件探针未得出结论（超时、进程报错或事件流里没有最终回复）——' +
          '这既不是通过也不是失败。请重跑 `trivium doctor --only codex`。',
      },
    ];
  }
  return [];
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  // 以**已落盘的探针结论**为基线，只覆盖本次真正探测过的段落。
  // 否则 `--only zcode` 会把上一轮的 agy 结论一并清空（探针结论是增量积累的）。
  const base = defaultProbe();
  const loaded = structuredClone(opts.config.probe ?? {}) as Partial<ProbeSection>;
  const probe: ProbeSection = {
    ...base,
    ...loaded,
    /*
     * `cli` 要**逐键合并**，不能靠外层展开。
     * 外层展开时盘上的 `cli` 会整体顶掉 `defaultProbe()` 的那份，
     * 于是本次新登记、盘上还没有的 CLI（M6 之后就是 codex / claude）
     * 连空壳都没有——后面 `probe.cli[name] = …` 写得进去，但读侧
     * `cli[name]?.version` 在探测前一律是 undefined，报告里会少掉整段。
     */
    cli: { ...base.cli, ...(loaded.cli ?? {}) },
  };
  const notes: string[] = [];
  const blockers: string[] = [];
  const only = opts.only ?? null;

  // ── 环境 ────────────────────────────────────────────────────────────
  step('探测运行环境…');
  const env = await probeEnv();
  probe.host = {
    platform: env.platform,
    arch: env.arch,
    has_timeout_bin: env.hasTimeoutBin,
    git_version: env.gitVersion,
  };
  notes.push(`node=${env.nodePath ?? '未找到'} ${env.nodeVersion ?? ''}`.trim());
  notes.push(`git=${env.gitVersion ?? '未找到'}`);
  if (!env.nodeOk) blockers.push('Node.js 不可用或版本低于 18');
  if (!env.gitOk) blockers.push('git 不可用或版本过低');
  // wrapper 自身在、里面写死的 node / bundle 却没了：每次 Hook 都会报 127
  const { checkWrapper } = await import('./init.js');
  for (const w of await checkWrapper(opts.triviumDir)) blockers.push(w);
  if (!env.hasTimeoutBin) {
    notes.push(
      '本机无 GNU coreutils 的 timeout/gtimeout —— 编排器的超时全部在 Node 内实现，' +
        '不依赖外部命令（这是预期行为，非问题）',
    );
  }

  // 落盘契约保持 {build, test}：candidates 只活在内存里供 --suggest-verify 展示来源
  const sug = await probeVerifyCommands(opts.projectRoot);
  probe.verify_suggestion = { build: sug.build, test: sug.test };
  notes.push(
    `编译测试命令候选：build=${JSON.stringify(sug.build)} ` +
      `test=${JSON.stringify(sug.test)}（仅候选，需人确认后写入 verify 才会执行）`,
  );
  notes.push(...sug.notes.map((n) => `[verify-probe] ${n}`));
  if (sug.truncated) notes.push('[verify-probe] 候选数已达上限，可能有子项目未列出');

  /*
   * ── 分段落盘（审查意见 GLM-08）──
   *
   * 每探完一段就写一次，而不是攒到最后一次性写。
   *
   * agy 与 zcode 两段各要真实调用厂商模型若干次。若只在末尾落盘，一次 Ctrl+C、
   * 一次网络中断、或第二段抛异常，前面已经烧掉的配额就全白费——下次重跑还得再烧一遍。
   * 探针结论是**增量事实**，探到多少存多少才对。
   *
   * 用 patchProbe 而非 persistProbe：它在全局锁内重读再合并，
   * 不会把并发的另一次 doctor（比如 --only 另一侧）的结论覆盖掉。
   */
  /**
   * 本次真正探过的段。没探过的段一个字节都不碰。
   *
   * 元素是 `cliName` 或 `DOCTOR_ONLY_ENV`——集合由运行期决定，
   * 不再是写死的三值联合类型（否则加一家 CLI 就要改这里）。
   */
  const probedSections = new Set<string>();

  /**
   * @param label 本次新探完的段；传 `null` 表示**不新增任何段**，
   *   只把已探过的段与 `generated_at` 再落一次（末尾补写用）。
   */
  const checkpoint = async (label: string | null): Promise<void> => {
    if (label !== null) probedSections.add(label);
    try {
      /*
       * patchProbe 的回调是**原地修改**、返回 void。写成
       * `(cur) => ({ ...cur, ...probe })` 的话返回值会被丢弃，实际一个字节都不写。
       *
       * 并且只写**探过的段**，不能 Object.assign 整个对象：`--only agy` 时
       * probe.cli.zcode 还是调用方传进来的那份，整段覆盖会把盘上更新的 zcode 结论
       * 擦成旧值——这正是 GLM-08 当初修掉的问题，整段覆盖会把它带回来。
       */
      await patchProbe(opts.triviumDir, (cur) => {
        if (probedSections.has(DOCTOR_ONLY_ENV)) {
          if (probe.host) cur.host = probe.host;
          cur.verify_suggestion = probe.verify_suggestion;
        }
        // 按本次探过的 CLI 逐键写回。遍历 probedSections 而不是遍历全部 CLI：
        // 后者会把没探过的键也写一遍，正是上一行注释警告的那种整段覆盖。
        for (const name of probedSections) {
          if (name === DOCTOR_ONLY_ENV) continue;
          const probed = probe.cli[name];
          if (probed) cur.cli[name] = probed;
        }
        if (probe.auth) cur.auth = { ...cur.auth, ...probe.auth };
        if (probe.generated_at) cur.generated_at = probe.generated_at;
      });
    } catch (e) {
      // 中途落盘失败不该中断探测：结论仍在内存里，末尾还会再写一次（那一次失败才算真失败）
      notes.push(
        `[warn] ${label ?? '收尾'} 阶段的中途落盘失败（不影响继续探测）：${(e as Error).message}`,
      );
    }
  };
  await checkpoint(DOCTOR_ONLY_ENV);

  // ── Antigravity ─────────────────────────────────────────────────────
  if (only === null || only === 'agy') {
    step('探测 Antigravity（agy）…');
    const r = await probeAgy(agentConfigOf(opts.config, 'gemini', 'antigravity').bin, agentConfigOf(opts.config, 'gemini', 'antigravity').agent, {
      skipModelCalls: opts.skipModelCalls ?? false,
      existing: probe.cli.agy,
    });
    probe.cli.agy = r.probe;
    notes.push(...r.notes.map((n) => `[agy] ${n}`));
    await checkpoint('agy'); // 这一段已经烧过配额，先存下来
    if (!r.probe.entrypoint) blockers.push('未找到 agy 可执行文件');
    else if (r.probe.headless_read_ok === false) {
      blockers.push(
        'agy headless 无法读取文件（issue #548）。请确认只读审查 Agent 已安装到 ' +
          '~/.gemini/config/agents/trivium-critic/agent.md',
      );
    }
  }

  // ── ZCode ───────────────────────────────────────────────────────────
  if (only === null || only === 'zcode') {
    step('探测 ZCode（zcode.cjs）…');
    const r = await probeZcode(agentConfigOf(opts.config, 'glm', 'zcode').entry, env.nodePath ?? process.execPath, {
      skipModelCalls: opts.skipModelCalls ?? false,
      existing: probe.cli.zcode,
    });
    probe.cli.zcode = r.probe;
    notes.push(...r.notes.map((n) => `[zcode] ${n}`));
    await checkpoint('zcode');
    if (!r.probe.entrypoint) blockers.push('未找到 zcode.cjs 入口');
    else if (r.probe.response_field === null && !opts.skipModelCalls) {
      blockers.push(
        'ZCode headless 未跑通。注意：CLI 的模型 provider 配置独立于桌面端，' +
          '「已登录」不等于「可用」——请确认 ~/.zcode/cli/config.json 存在。',
      );
    }
  }

  // ── Codex ───────────────────────────────────────────────────────────
  if (only === null || only === 'codex') {
    step('探测 Codex（codex exec）…');
    const r = await probeCodex(null, {
      skipModelCalls: opts.skipModelCalls ?? false,
      existing: probe.cli.codex,
    });
    probe.cli.codex = r.probe;
    notes.push(...r.notes.map((n) => `[codex] ${n}`));
    await checkpoint('codex');
    for (const line of codexSeverity(r.probe, {
      enabled: agentByCliName('codex')?.criticEnabled === true,
      asked: only === 'codex',
      skipModelCalls: opts.skipModelCalls ?? false,
    })) {
      if (line.level === 'blocker') blockers.push(line.message);
      else notes.push(`[codex] ${line.message}`);
    }
  }

  /*
   * ── 已登记但尚无探针实现的 CLI ──
   *
   * 判据 J1 要求 `doctor --only codex` 给出**确定结论**。在此之前它退 64
   * （`cli.ts` 三值白名单），而 64 的语义是「你的参数写错了」——可 codex
   * 明明在注册表里登记着，用户没写错任何东西。
   *
   * 这里给的是第三种答复：**登记了、但本轮没有可跑的探针**。它不是失败
   * （不进 blockers、不影响退出码），也不是静默通过——名字与原因都说出来。
   * 判据用「盘上有没有结论」而不是维护一张「哪几家已实现」的清单：
   * 后者是又一处要随实现进度手工同步的枚举，而探针实现一旦接上，
   * `probed_at` 自然就有值了。
   */
  for (const name of ALL_CLI_NAMES) {
    if (probedSections.has(name)) continue; // 本次刚探过
    if (only !== null && only !== name) continue; // 用户没点名这一侧
    if (probe.cli[name]?.probed_at) continue; // 盘上有旧结论，不是「无实现」
    const agent = agentByCliName(name);
    notes.push(
      `[${name}] 已在注册表登记（${agent?.display ?? name}），但尚无探针实现，` +
        '本次未产生任何结论——这是确定答复而非失败。探针随 M6 第 2 / 3 步接入。',
    );
  }

  probe.generated_at = new Date().toISOString();

  /*
   * 末尾再写一次，只为补上 generated_at 并确保前面每一段都落了盘。
   * 走 patchProbe（锁内读-改-写）而不是 persistProbe（整体替换）——
   * 后者会把并发的另一次 doctor（例如 `--only` 另一侧）的结论覆盖掉。
   *
   * **传 null，不借用任何厂商标签**（审查意见 GLM-03）。原实现写的是
   * `checkpoint(only === null ? 'zcode' : only === 'agy' ? 'agy' : 'zcode')`：
   * `--only env` 时那个三元会落到 `'zcode'` 上，于是把本次**根本没探过**的
   * zcode 段按起点 clone 整段写回——与 checkpoint 自己「没探过的段一个字节都不碰」
   * 的注释直接矛盾，并发 doctor 下会丢更新。
   */
  await checkpoint(null);
  const written = path.join(opts.triviumDir, 'config.local.yaml');
  notes.push(`探针结论已写入 ${written}`);

  return { probe, notes, blockers };
}

/** 人读渲染 */
export function renderDoctorReport(report: DoctorReport): void {
  say('');
  say('TriviumCode 本机能力探测');
  say('─'.repeat(60));
  for (const n of report.notes) say(`  ${n}`);
  say('');
  if (report.blockers.length === 0) {
    say('✓ 未发现阻断级问题');
  } else {
    say(`✗ 发现 ${report.blockers.length} 项阻断级问题：`);
    for (const b of report.blockers) warn(b);
  }
  say('');
}

/**
 * `doctor --suggest-verify`（设计 §14.1）。
 *
 * 只**展示**探测到的候选命令并给出可粘贴的 YAML，**绝不自行写入配置**。
 *
 * 这不是偷懒。`scripts.test` 完全可能耗时极长、依赖外部服务、或有副作用
 * （清库、发请求、改远端状态）。§14.1 的原话是「逐条展示给用户确认后才写入」——
 * 「确认」的意思是人点头，不是程序代人点头。
 */
export async function suggestVerify(projectRoot: string): Promise<number> {
  const s = await probeVerifyCommands(projectRoot);

  say('');
  say('编译测试命令候选（探测所得，**尚未**写入任何配置）');
  say('────────────────────────────────────────────────────────────');
  if (s.build.length === 0 && s.test.length === 0) {
    say('  未探测到任何候选。这不是错误——本项目可能用的是探测器不认识的工具链。');
    say('  请手工把命令写进 .trivium/config.yaml 的 verify.build / verify.test。');
  } else {
    // 对齐来源列：命令长度参差时右侧仍成列
    const w = Math.max(...s.candidates.map((c) => c.cmd.length));
    for (const c of s.candidates) {
      say(`  ${c.group.padEnd(5)}  ${c.cmd.padEnd(w)}  ← ${c.source}`);
    }
  }
  for (const n of s.notes) say(`  · ${n}`);
  if (s.truncated) say('  · 候选数已达上限，可能有子项目未列出');
  say('');
  say('逐条确认后，把下面这段写进 .trivium/config.yaml（删掉你不要的行）：');
  say('');
  /*
   * 用 YAML.stringify 而非手工拼 `'${c}'`：命令里只要出现单引号
   * （目录名含引号时 cd 前缀就会带上）手工拼法即产出非法 YAML，
   * 用户粘进 config.yaml 会解析失败。
   */
  say(YAML.stringify({ verify: { build: s.build, test: s.test } }, { lineWidth: 0 }).trimEnd());
  say('');
  warn(
    '这些命令会被 `trivium verify` **真实执行**。请先自己确认每一条：\n' +
      '  · 它耗时多久？\n' +
      '  · 它依赖外部服务或网络吗？\n' +
      '  · 它有副作用吗（清库、写远端、发通知）？\n' +
      '编排器绝不替你决定执行什么——未经你写入配置的候选永不执行（§14.1）。',
  );
  return EXIT.OK;
}
