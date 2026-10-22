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
import { agentConfigOf, defaultProbe, deprecatedConfigNotice, patchProbe, resolveAssetRoot } from './config.js';
import { EXIT } from './exit-codes.js';
import { probeEnv } from './probes/env.js';
import { probeVerifyCommands } from './probes/verify-commands.js';
import { probeAgy } from './probes/agy.js';
import { probeZcode, ZCODE_HEADLESS_UNREFRESHED, type ZcodeHeadlessUnrefreshed } from './probes/zcode.js';
import { probeCodex } from './probes/codex.js';
import { probeClaude, withClaudeProbeRoute, type StructuredArmCause } from './probes/claude.js';
import { claudeProbeForRoute, claudeRouteKey, resolveClaudeRoute, type ClaudeRoute } from './adapters/claude-route.js';
import { resolveTier, type TierOverrides } from './adapters/base.js';
import type { TierFlagValues } from './tier-flags.js';
import { ProbeFixtureError } from './probes/fixture.js';
import type { ClaudeProbe, CodexProbe, Config, CriticId, ProbeSection } from './types.js';
import { realAdapters } from './adapters/index.js';
// 同源文案：blocker 与 `availability()` 对同一现象只能有一种说法（r2 AGY-04）
import { ZCODE_HEADLESS_NOT_OK_HINT, ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT, zcodeProbeModel } from './adapters/zcode.js';
import type { TraceCapability } from './adapters/base.js';
import { AGENTS, ALL_CLI_NAMES, agentByCliName, type AgentDescriptor } from './agents/registry.js';
import {
  describeSharedRootProblems, entryScanEnv, scanEntryCollisions, sharedReadRootTargets, type EntryScanEnv,
} from './entry-collisions.js';
import { say, step, warn } from './util/log.js';
import { formatCommand, newProbeSection, withProbeSection, type ProbeSectionScope } from './util/exec.js';
import { observeTempDirs } from './util/fsx.js';
import {
  DEADLINE_UNWIND_MS, DeadlineController, TempDirLedger, sweepDoctorLedgers, unfinishedSectionNote,
  type DeadlineSectionState, type DoctorDeadline,
} from './doctor-deadline.js';

/** `doctor --deadline-s` 的接线（EV-251，预检失败自动校准计划 r2 D3） */
export interface DoctorDeadlineOptions {
  /** 总时限（毫秒） */
  ms: number;
  /** 到点后等段退出来的兜底时长，缺省 `DEADLINE_UNWIND_MS`；只为可测性 */
  unwindMs?: number;
  /** 按组结束的宽限链：cli 传 worker 处理器那一组常量（doctor 不引 run-protocol） */
  graceMs: number;
  killWaitMs: number;
  /** 接管 SIGINT / SIGTERM（CLI 传 true） */
  handleSignals: boolean;
  /** 只为可测性：拿到控制器（用例借它模拟信号） */
  onController?: (c: DeadlineController) => void;
}

/**
 * doctor 里经 `overridesFor` 读命令行覆盖的段（cliName）。预检据此决定自动校准的调用带不带
 * `--model-<id>` / `--effort-<id>` / 路线旗标：不读覆盖的段带了只会换来末尾一条「覆盖没用上」（EV-245）。
 * 与下面各段是否调 `overridesFor` 由 `doctor-override-sections` 测试按源码对账。
 */
const OVERRIDE_CONSUMING_SECTIONS: ReadonlySet<string> = new Set(['codex', 'claude']);

export function doctorSectionConsumesOverrides(cliName: string): boolean {
  return OVERRIDE_CONSUMING_SECTIONS.has(cliName);
}

/** doctor 的段次序（与 `runDoctor` 里各段的先后一致） */
const DOCTOR_SECTION_ORDER: readonly string[] = ['agy', 'zcode', 'codex', 'claude'];

export interface DoctorOptions {
  tierFlags?: Partial<Record<CriticId, TierFlagValues>>;
  /** 明确的模型覆盖，与CLI同源，不藏在tierFlags的未声明键中。 */
  modelOverrides?: Partial<Record<CriticId, string>>;
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
  /**
   * 透传给 `probeZcode` 的注入口（代码双审 r2 CODEX-03），与 `probeZcode` 自己的注入口同形。
   * 只为可测性：不开这个口子，经 `runDoctor` 走探针的用例在装了 ZCode 的机器上会读真实
   * `~/.zcode/cli/config.json`、真实拉起两条模型覆盖臂。生产路径不传。
   * `invoke`（EV-194）替换 headless 与 path_deny 两次真实调用，让用例咬住「doctor 把档位模型传进了探针」。
   */
  zcodeProbe?: Pick<
    NonNullable<Parameters<typeof probeZcode>[2]>,
    'cliConfigPath' | 'modelOverrideProbe' | 'modelOverrideFullCopyProbe' | 'invoke'
  >;
  /**
   * codex / claude 段的入口路径注入口（EV-209），同 `zcodeProbe` 只为可测性，生产路径不传（即原来写死的 null）。
   * 两段把入口交给各自的候选表找，而 codex 的候选表里 `/opt/homebrew/bin/codex` 排在家目录之前——
   * 不开这个口子，经 `runDoctor` 走 codex 段的用例在装了 codex 的机器上会拉起真实 CLI、花配额。
   */
  probeBins?: { codex?: string; claude?: string };
  /** 目录后置臂失败回归的注入口；生产路径不传。 */
  claudeDirectoryProbe?: NonNullable<Parameters<typeof probeClaude>[1]>['directoryProbe'];
  /**
   * 共享读取面检查（EV-240）读哪个家目录。**只为可测性**，生产路径不传，
   * 由 `entryScanEnv()` 取 `TRIVIUM_ENTRY_SCAN_HOME` 或 `os.homedir()`。
   */
  entryScanEnv?: EntryScanEnv;
  /** 总时限（EV-251）：不给时行为逐字不变 */
  deadline?: DoctorDeadlineOptions;
  /**
   * 临时目录台账所在目录（`run_root` 展开后，EV-251）。给了就在启动时补删已退出的 doctor 留下的台账条目（每次都做，
   * 与带不带时限无关，代码三审 CODEX-04 ≡ GLM-03）；带时限时本进程的临时目录也记进这里。不给不碰台账。
   */
  ledgerDir?: string | null;
  /**
   * 只为可测性（EV-251）：给了时段作用域内、探针之前先等它（环境段传 `env`，各家传 cliName）。用例借它造
   * 「段卡在不经 `run()` 的 await 上」（兜底路径）与「段内不带 killTree 的派生」。生产路径不传。
   */
  sectionPrelude?: (cli: string) => Promise<void>;
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

/** {@link describeUnusedOverrides} 的入参：用户写了什么、本次哪几家的覆盖被读过、哪几段跑过 */
export interface UnusedOverridesInput {
  tierFlags?: Partial<Record<CriticId, TierFlagValues>>;
  modelOverrides?: Partial<Record<CriticId, string>>;
  /** 覆盖被读过的 Agent id（`runDoctor` 的 `overridesFor` 记下） */
  consumed: ReadonlySet<string>;
  /** 本次跑过的段（cliName）：探完的，加上夹具没建起来的 */
  ran: ReadonlySet<string>;
  only: string | null;
  /** 只为可测性（第五家的桩描述符），生产路径不传 */
  agents?: readonly AgentDescriptor[];
}

/** 一家写了哪些覆盖旗标，按 `--model` / `--tier` / `--effort` / `--profile` / `--native` 的顺序 */
function overrideFlagNames(id: string, input: UnusedOverridesInput): string[] {
  const tf = input.tierFlags?.[id as CriticId];
  return [
    ...(input.modelOverrides?.[id as CriticId] !== undefined ? [`--model-${id}`] : []),
    ...(tf?.tier !== undefined ? [`--tier-${id}`] : []),
    ...(tf?.effort !== undefined ? [`--effort-${id}`] : []),
    ...(typeof tf?.vendorProfile === 'string' ? [`--profile-${id}`] : []),
    ...(tf?.vendorProfile === null ? [`--native-${id}`] : []),
  ];
}

/**
 * 写了却没用上的命令行覆盖（EV-245）：返回一条提示，全部用上时返回 `null`。**只提示**，调用方放进 warnings、
 * 不进 blockers——退出码与探测结论都不受影响（用户 2026-10-18 定）。
 *
 * 「用上没有」按运行期记录判，不维护「哪几家消费覆盖」的清单、不写任何 Agent id：哪一段经 `overridesFor`
 * 读了覆盖，那一家就算用上。没用上的按下列次序归因，先中先归（计划 r2 D-3）：
 *   ② `--only` 滤掉了该家的段；① 该段跑了但不读覆盖（探测用的是固定口径）；③ 其余——doctor 里还没有这一家的段。
 * 第五家登记之后落进哪一格，由它在 doctor 里有没有段、段里经不经 `overridesFor` 决定，这里不用改。
 */
export function describeUnusedOverrides(input: UnusedOverridesInput): string | null {
  const groups: Record<'fixed' | 'filtered' | 'noProbe', { flags: string[]; agents: AgentDescriptor[] }> = {
    fixed: { flags: [], agents: [] },
    filtered: { flags: [], agents: [] },
    noProbe: { flags: [], agents: [] },
  };
  for (const a of input.agents ?? AGENTS) {
    if (input.consumed.has(a.id)) continue;
    const flags = overrideFlagNames(a.id, input);
    if (flags.length === 0) continue;
    const g =
      input.only !== null && input.only !== a.cliName ? groups.filtered
        : input.ran.has(a.cliName) ? groups.fixed
          : groups.noProbe;
    g.flags.push(...flags);
    g.agents.push(a);
  }
  const names = (as: readonly AgentDescriptor[]): string => as.map((a) => a.display).join('、');
  const lines: string[] = [];
  if (groups.fixed.flags.length > 0) {
    lines.push(`  · ${groups.fixed.flags.join('、')}：${names(groups.fixed.agents)} 的探测不读命令行覆盖值，用的是各自固定的探测口径`);
  }
  if (groups.filtered.flags.length > 0) {
    lines.push(`  · ${groups.filtered.flags.join('、')}：本次 --only ${input.only}，没有探测 ${names(groups.filtered.agents)}`);
  }
  if (groups.noProbe.flags.length > 0) {
    lines.push(`  · ${groups.noProbe.flags.join('、')}：doctor 尚无 ${names(groups.noProbe.agents)} 的探针`);
  }
  if (lines.length === 0) return null;
  return ['以下命令行覆盖本次没有用上（只是提示，退出码与探测结论不受影响）：', ...lines].join('\n');
}

export interface DoctorReport {
  /** 新目录臂的脱敏原始证据，随doctor既有输出出口落盘，不嵌入配置。 */
  directoryEvidence?: Awaited<ReturnType<typeof probeClaude>>['directoryEvidence'];
  probe: ProbeSection;
  notes: string[];
  /** 阻断级问题：非空则 preflight 必然失败 */
  blockers: string[];
  /**
   * 告警级问题：**不影响退出码**，但要从 notes 里拎出来单独渲染（r3 CODEX-F01-03）。
   *
   * 存在的理由是「有些事实既不该拦人、又不该被划过」。第一个住户是旗标第三态：
   * 本轮没判成时不能拦（拦了就是把布局问题报成能力缺失），可它同时意味着落盘的
   * `readonly_flags` 是上一轮的旧值——读的人必须知道，否则 preflight 那头的
   * 「无可用只读旗标」会把他引向升级 ZCode。
   */
  warnings: string[];
  /** 只在给了 `--deadline-s` 时出现（EV-251） */
  deadline?: DoctorDeadline;
}

/**
 * 给用户在终端（项目根）复制的重跑命令（EV-251）：`--only` 加该段读的那几个覆盖旗标，原样取自本次收到的值；
 * 不带 `--deadline-s` 与 `--json`（终端里不受工具超时约束）。
 */
export function doctorRerunCommand(cli: string, opts: Pick<DoctorOptions, 'tierFlags' | 'modelOverrides'>): string {
  const args = ['doctor', '--only', cli];
  const id = agentByCliName(cli)?.id as CriticId | undefined;
  if (id && doctorSectionConsumesOverrides(cli)) {
    const model = opts.modelOverrides?.[id];
    const tf = opts.tierFlags?.[id];
    if (typeof tf?.vendorProfile === 'string') args.push(`--profile-${id}`, tf.vendorProfile);
    if (tf?.vendorProfile === null) args.push(`--native-${id}`);
    if (model !== undefined) args.push(`--model-${id}`, model);
    if (tf?.tier !== undefined) args.push(`--tier-${id}`, tf.tier);
    if (tf?.effort !== undefined) args.push(`--effort-${id}`, tf.effort);
  }
  // 前缀是项目里的入口：`trivium` 有意不在 PATH 上，照抄 `trivium …` 会 command not found（代码三审 GLM-02）
  return formatCommand(DOCTOR_RERUN_ENTRY, args);
}

/** 终端重跑命令的入口，与用户手册里终端命令的写法同形 */
export const DOCTOR_RERUN_ENTRY = '.trivium/bin/trivium';

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
  ctx: {
    enabled: boolean;
    asked: boolean;
    skipModelCalls: boolean;
    /** 只读负对照本轮判不了（EV-25）：`readonly_flags` 是保留的旧值，为空也不报失守，改由 doctor 出 warning */
    readonlyIndeterminate?: boolean;
  },
): SeverityLine[] {
  const gate = (message: string): SeverityLine =>
    ctx.enabled || ctx.asked
      ? { level: 'blocker', message }
      : { level: 'note', message: `${message}（该侧尚未启用为审核者，故不阻断）` };

  if (!probe.entrypoint) return [gate('未找到 codex 可执行文件')];

  /*
   * 只读负对照失守：**恒 blocker**，不看 criticEnabled、不看是否点名。
   * 判据要排除 skipModelCalls——那时负对照根本没跑，readonly_flags
   * 保留的是上一次结论，空集不代表失守。本轮负对照判不了时同理（EV-25）。
   */
  if (!ctx.skipModelCalls && !ctx.readonlyIndeterminate && probe.readonly_flags.length === 0) {
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

/**
 * codex 只读负对照本轮判不了时的 warning（EV-25，用户 2026-10-06 定取 A，仿 zcode P-29）。
 *
 * 有上一次的结论：写明保留的是哪一份——它既不是「失守」，也没有被这一轮重新确认。
 * 没有上一次的结论（首次探测就判不了）：`readonly_flags` 为空、该侧仍不可用，但说法是「未判定」而不是「失守」。
 */
export function codexReadonlyIndeterminateWarning(why: string, flags: readonly string[]): string {
  return flags.length > 0
    ? `codex 只读负对照本轮未判定（${why}）：readonly_flags 保留的是上一次的结论 ${JSON.stringify(flags)}——` +
        '这不是「沙箱失守」，也没有重新确认沙箱可信。请重跑 trivium doctor --only codex。'
    : `codex 只读负对照未判定（${why}），且没有上一次的结论：readonly_flags 为空，该侧仍不可用——` +
        '这是「未判定」，不是「沙箱失守」。请重跑 trivium doctor --only codex。';
}

/**
 * **能力声明 ↔ 探针实测的对账**（M8 第 3 步，清偿 EV-06）。
 *
 * `CodexProbe.trace_path_structured` 与 `.rejected_command_in_trace` 两个字段的
 * 类型注释里，登记的消费方就是「M8 第 3 步起：doctor 的能力对账」——
 * 而第 2 步落地 `TraceCapability` 时明写「对账代码还不存在」。这里把它补上。
 *
 * ## 对账的是什么
 *
 * 适配器**声明**自己的轨迹形状（`capability`），探针**实测**这台机器上的真实行为。
 * 两者本该一致；不一致意味着其一过时了——CLI 升级换了事件流，或声明抄错了。
 * 判定层按声明分档，所以声明与事实脱节时，判定会**按一个不存在的事实**工作：
 * 声明 `tool-trace` 而实际是命令轨迹 ⇒ 路径回填不发生、证据恒不达标；
 * 声明 `rejectionRecorded: true` 而实际被拒不留痕 ⇒ 阴性结论被当成可信。
 *
 * ## 为什么是 note 而不是 blocker
 *
 * 对账不符**不代表这台机器不安全**，代表我们的登记该更新了。判 blocker 会让
 * 一次 CLI 升级把所有人的 `doctor` 打红；判静默通过则让这个字段继续白登记。
 * 所以点名，不阻断——与 `checkModelSlugs` 的「第三态」同一取向。
 */
export function capabilityParity(
  probe: { trace_path_structured: boolean | null; rejected_command_in_trace: boolean | null },
  cap: TraceCapability,
  cliName: string,
): SeverityLine[] {
  const out: SeverityLine[] = [];

  if (probe.trace_path_structured !== null) {
    const declaredStructured = cap.traceShape === 'tool-trace';
    if (probe.trace_path_structured !== declaredStructured) {
      out.push({
        level: 'note',
        message:
          `能力对账不符：适配器声明 ${cliName} 的轨迹形状为 ${cap.traceShape}` +
          `（即读取路径${declaredStructured ? '有' : '没有'}结构化字段），` +
          `而探针实测 trace_path_structured=${probe.trace_path_structured}。` +
          '判定层按声明分档，声明过时会让证据核验按不存在的事实工作——请核对适配器声明或重跑探针。',
      });
    }
  }

  if (probe.rejected_command_in_trace !== null) {
    if (probe.rejected_command_in_trace !== cap.rejectionRecorded) {
      out.push({
        level: 'note',
        message:
          `能力对账不符：适配器声明 ${cliName} 的 rejectionRecorded=${cap.rejectionRecorded}，` +
          `而探针实测 rejected_command_in_trace=${probe.rejected_command_in_trace}。` +
          (probe.rejected_command_in_trace === false
            ? '实测更悲观：被拒的操作不留痕，阴性结论不可信，而声明说它可信。'
            : '实测更乐观：被拒的操作会留痕，可以把降级标记去掉了。'),
      });
    }
  }

  return out;
}

/**
 * 结构化臂成因 → `DoctorReport.warnings` 文案（EV-74 计划 §3.7，GLM-03）。
 *
 * 抽成纯函数是为了让 §5 用例 7 能直接断言映射本身，不必真跑一次 `probeClaude`
 * 或 `runDoctor`——与本文件其余 `judge*`/`*Severity` 一律抽纯函数同一条理由。
 *
 * **只读 `structuredArmCause`**，不读 `json_schema_ok` 的值、也不读 notes 文本
 * （§3.4.2 已定「不做文案匹配」）。`'carried-over'`（早退轮）与
 * `'asset-root-missing'`（可见性已归 note 的指路句）都返回 `null`——
 * 覆盖面严格等于「结构化臂真跑过且落 null」+ 干净拒绝，三类成因各自独立文案，
 * 不共用「模型未合规」字样：那正是 §3.4.1 刚在 note 侧修掉的失实归因，
 * 不能在 warning 侧复发。
 */
export function claudeStructuredArmWarning(cause: StructuredArmCause): string | null {
  switch (cause) {
    case 'clean-reject':
      return 'claude CLI 拒绝了本仓审查契约文件（--json-schema），已降级为提示词约定 + 宽松解析。';
    case 'not-completed':
      return 'claude 结构化输出本轮探测未跑完（撞闸或未获模型答复），非模型不合规。';
    case 'model-noncompliant':
      return 'claude 模型未按契约给出合规的结构化输出，需重测（探针档位为 haiku）。';
    case 'ok':
    case 'carried-over':
    case 'asset-root-missing':
      return null;
  }
}

/**
 * claude 探针结论 → 诊断严重度（与 `codexSeverity` 同构）。
 *
 * 抽成纯函数的理由同上一步：这里有一条**安全判定**（只读失守），
 * 埋在 `runDoctor` 里就要真跑才走得到，等于没有断言守着。
 *
 * 判据字段与 codex 不同——claude 的只读靠**工具白名单**而不是沙箱，
 * 所以失守的形态是「工具面混入了写工具」或「负对照真落了文件」，
 * 两者都反映在 `readonly_flags` 被清空上。
 */
export function claudeSeverity(
  probe: ClaudeProbe,
  ctx: { enabled: boolean; asked: boolean; skipModelCalls: boolean },
): SeverityLine[] {
  const gate = (message: string): SeverityLine =>
    ctx.enabled || ctx.asked
      ? { level: 'blocker', message }
      : { level: 'note', message: `${message}（该侧尚未启用为审核者，故不阻断）` };

  if (!probe.entrypoint) return [gate('未找到 claude 可执行文件')];

  /*
   * ── 判定顺序（审查意见 AGY-01 ≡ GLM-01，r4 复审后重排）──
   *
   * **确证的事实排在推断之前；特化诊断排在泛化之前。**
   *
   * r3 修「没测到被判失守」时我做了两步：加 `tool_surface_checked` 前置条件、
   * 再把 null note 提到失守判据之前。**第一步就够了**——init 缺失时
   * `checked === false`，失守判据根本不触发。第二步是多余的，而且开了反方向的洞：
   * 已核实的失守在读探针没跑到 result 时被「请重跑」压掉，blocker 进不了 blockers。
   *
   * 关键在于**这些事实彼此独立**：`system/init` 在事件流前部就到、
   * `breach.txt` 在不在是文件系统事实——两者都不依赖 result 事件。
   * **「读探针没跑完」不等于「什么都没测到」。**
   */

  // ① 负对照真落了文件：最硬的证据，独立于读探针跑没跑完（GLM-01 路径②）
  if (probe.readonly_breach === true) {
    return [
      {
        level: 'blocker',
        message:
          'claude 只读负对照失败：只读白名单下文件仍被创建，该侧不可用于审查。' +
          '在修好之前不要把它接入任何审查链路。',
      },
    ];
  }

  // ② 工具面核对过且不干净：同样是已核实的失守
  if (
    !ctx.skipModelCalls &&
    probe.tool_surface_checked === true &&
    probe.readonly_flags.length === 0
  ) {
    return [
      {
        level: 'blocker',
        message:
          'claude 只读保障不成立：工具面混入了白名单外的工具。' +
          '请确认 --restricted 与 --strict-mcp-config 都生效；在修好之前不要把它接入审查链路。',
      },
    ];
  }

  /*
   * ②' MCP 硬前置缺席：**已核实的失守**，与 ② 同档，排在一切「没测到」之前。
   *
   * 与 ② 的分工：② 问「工具面脏不脏」，这条问「落盘的只读组合里那条硬前置在不在」。
   * `readonly_flags` 的契约允许是**子集**（见 `ClaudeProbe.strict_mcp_config_applied`），
   * 真出现子集时只有这条拦得住。
   *
   * ## 三道前置缺一不可（代码双审 AGY-01 ≡ GLM-01 ≡ CODEX-01）
   *
   * 初版只判 `=== false`，于是**什么都没测到**的机器（未登录、断网、spawn 报错）
   * 被判成已核实的安全失守、恒 blocker，还把下面 ③ 的信任提示整条截住，
   * 而给出的建议（「请重跑 doctor」）**必然复现**。根因在产出侧
   * （`[].includes(x)` 算出 `false`），已随 `judgeStrictMcpConfig` 修掉；
   * 这里同步把门关严，**不靠上游一处正确**：
   *
   *   · `!skipModelCalls`：跳过模型调用时这一项保留上一轮结论，不据此判失守（同 ②）；
   *   · `tool_surface_checked === true`：没核对成就不是「已核实」，归 ⑥（同 ②）；
   *   · `readonly_flags.length > 0`：**只判真子集**。数组为空有三个更硬的成因
   *     （breach → ①、工具面脏 → ②、读回为空 → ⑥），各自的诊断更准；
   *     让 ②' 也去认领它们，只会把成因说错。
   *
   * `null` 同样不走这条：那是「没测到」，归 ⑤/⑥ 的泛化 note。
   */
  if (
    !ctx.skipModelCalls &&
    probe.tool_surface_checked === true &&
    probe.readonly_flags.length > 0 &&
    probe.strict_mcp_config_applied === false
  ) {
    return [
      {
        level: 'blocker',
        message:
          'claude 落盘的只读组合里缺 MCP 硬前置旗标：MCP 的写工具（发信、云盘创建与共享）' +
          '会进入审查会话工具面——那是能越出项目边界的失守面，且单次成本约 24 倍。' +
          '请重跑 `trivium doctor --only claude`；在修好之前不要把它接入审查链路。',
      },
    ];
  }

  /*
   * ③ 信任提示：**特化**诊断，必须排在泛化的 null 之前。
   *
   * 它的产出前提正是 `!read.completed`，而那时 `headless_read_ok` 必为 null——
   * 泛化 note 排前面的话，这条永远被截住（r3 修好了探针侧的不可达，
   * r4 发现 doctor 侧又把它挡住了，同一个字段连着两轮不可达）。
   */
  if (probe.trust_prompt_required === true) {
    return [
      {
        level: 'note',
        message:
          '⚠️ headless 在新目录首跑需要人工信任——该侧对「新克隆的仓库」不可用，' +
          '接入前要在用户文档里写明这条限制。',
      },
    ];
  }

  // ④ 读探针有结论且是否定：能力缺陷
  if (probe.headless_read_ok === false) {
    return [gate('claude headless 读不到文件——该侧无法作为审查员使用')];
  }

  // ⑤ 泛化的「没测到」：排在全部确证判据之后
  if (probe.headless_read_ok === null && !ctx.skipModelCalls) {
    return [
      {
        level: 'note',
        message:
          '⚠️ 读文件探针未得出结论（超时、进程报错，或事件流里没有 result）——' +
          '这既不是通过也不是失败。常见原因：登录态过期、网络不通，' +
          '或在新目录首跑时需要人工信任。请重跑 `trivium doctor --only claude`。',
      },
    ];
  }

  // ⑥ 工具面没核对成：同样是「没测到」，不当失守
  if (!ctx.skipModelCalls && probe.tool_surface_checked === false) {
    return [
      {
        level: 'note',
        message:
          '⚠️ 工具面未核对（读探针没拿到 system/init）——只读保障**未得出结论**，' +
          '既不能算通过也不能算失守。请重跑 `trivium doctor --only claude`。',
      },
    ];
  }

  return [];
}

/**
 * doctor 的 zcode headless 探针本轮进了真实调用、却没刷新 response_field 时的 warning（EV-196）。
 *
 * 不拦（决策一）：一次临时失败就拦下全量 doctor、并让 `availability()` 判该侧不可用，力度过头。
 * 也不能只留一条 note——结论从既有值克隆，旧的 `response_field` 让 headless blocker 不触发，此前全量 doctor
 * 退 0、blockers 与 warnings 都为空。EV-194 起探针与审查运行同一选模路径，这里失败就意味着审查大概率同样跑不通。
 * 「哪一支、根因在哪条 note、哪几项沿用旧值」都取自探针侧的同一张表，与 note 的字面不会各改各的。
 */
export function zcodeHeadlessUnrefreshedWarning(u: ZcodeHeadlessUnrefreshed): string {
  const b = ZCODE_HEADLESS_UNREFRESHED[u.branch];
  return (
    `ZCode headless 探针本轮进了真实调用，但没刷新 response_field（${b.what}）：` +
    `${u.carried.join(' / ')} 沿用的是上一次的结论（首次探测则为空），不是本轮探到的。` +
    `审查运行走同一条选模路径，大概率同样跑不通——根因见含「${b.noteKey}」的那条 [zcode] note。`
  );
}

/** 「显示名（cli 名）」：注册表取不到显示名时只用 cli 名 */
function cliLabel(cli: string): string {
  const display = agentByCliName(cli)?.display;
  return display ? `${display}（${cli}）` : cli;
}

/**
 * 某侧的探针夹具没建起来时的 blocker（EV-209）。导出供单测逐字比对。
 *
 * 不按 `criticEnabled` 分档：建不起夹具是本机环境问题（git 坏、临时目录不可写），与该侧启不启用无关，
 * 且四侧共用同一个夹具工厂。`err.message` 已以「建探针夹具失败：」开头，原因与残留提示都在里面。
 * 「从未探过则仍为空」：首次探测时盘上没有该侧结论，「原样保留」要对这种情形也成立（计划双审 GLM-02）。
 */
export function probeFixtureBlocker(cli: string, err: ProbeFixtureError): string {
  return (
    `${cliLabel(cli)}本轮没有探测成：${err.message}。` +
    `该侧落盘的探针结论原样保留（从未探过则仍为空），修好后重跑 trivium doctor --only ${cli}`
  );
}

/**
 * claude 的记忆夹具没建起来时的 warning（EV-209）。导出供单测逐字比对。
 *
 * 不拦（计划双审 AGY-01）：`project_memory_blocked` 不进 `availability()` 与 preflight，记 blocker 会让 doctor 退非零、
 * 而紧接着的 preflight 照样放行；主夹具各格已刷新，只有这一格没刷新——与 EV-196「单格本轮未刷新」同档。
 */
export function memoryFixtureWarning(msg: string): string {
  return (
    `${cliLabel('claude')}项目记忆一格本轮没有探测成：${msg}。` +
    '其余各格已刷新；project_memory_blocked 沿用的是上一次的结论（从未探过则仍为空），修好后重跑 trivium doctor --only claude'
  );
}

/**
 * 跑一段探针，只接住「夹具没建起来」（EV-209）。导出供单测直测。
 *
 * 接住时调 `onFail(blocker)`、返回 null——调用方据此不赋 `probe.cli[name]`、不 checkpoint，该侧落盘结论一个字节不动：
 * 主夹具失败时探针还没跑任何模型调用，已算出的只有静态结论与提前打的 `probed_at`，落盘会造出「戳是新的、能力是旧的」
 * 的混合段，而 `probed_at` 按键判 TTL。**别的异常原样重抛**：内部错误照旧是内部错误，不被这里吞掉。
 */
export async function guardFixture<T>(
  cli: string,
  fn: () => Promise<T>,
  onFail: (blocker: string) => void,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ProbeFixtureError)) throw e;
    onFail(probeFixtureBlocker(cli, e));
    return null;
  }
}

/** 本体与外层竞速之间的接头（EV-251）：本体把收尾函数与控制器交出来，兜底路径据此出结果 */
interface DoctorCoreHooks {
  finalize?: (stuck?: boolean) => Promise<DoctorReport>;
  controller?: DeadlineController;
  ready?: () => void;
}

/**
 * 不给 `deadline` 时就是本体本身。给了时与控制器的兜底竞速（计划三审 AGY-02）：到点后段在兜底时长内没退出来，
 * 不等挂住的 await，按控制器记的段状态收尾、出结果（`deadline.stuck: true`）；调用方随后须自行结束进程。
 */
export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  if (!opts.deadline) return runDoctorCore(opts, null);
  const hooks: DoctorCoreHooks = {};
  const ready = new Promise<void>((r) => {
    hooks.ready = r;
  });
  // 本体抛出（内部错误）时停掉计时器与信号接管、卸下台账观察者，否则计时器会把进程拖到时限
  const core = runDoctorCore(opts, hooks).catch((e: unknown) => {
    hooks.controller?.stop();
    observeTempDirs(null);
    throw e;
  });
  const stuck = (async (): Promise<DoctorReport> => {
    await ready;
    await hooks.controller!.stuck;
    return hooks.finalize!(true);
  })();
  return Promise.race([core, stuck]);
}

async function runDoctorCore(opts: DoctorOptions, hooks: DoctorCoreHooks | null): Promise<DoctorReport> {
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
  let directoryEvidence: DoctorReport['directoryEvidence'];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const only = opts.only ?? null;
  /** 本轮探针夹具没建起来的侧（EV-209）：末尾「尚无探针实现」那一圈要跳过它们，否则 blocker 之外再收一句自相矛盾的 note */
  const fixtureFailed = new Set<string>();
  /** 本次 doctor 已到点或收到信号（EV-251）：读控制器的中止令牌，不给时限时恒为假 */
  const aborted = (): boolean => dl?.token.aborted === true;
  const guard = <T>(cli: string, fn: () => Promise<T>): Promise<T | null> =>
    guardFixture(cli, fn, (blocker) => {
      // 中止派生之后夹具建不起来是我们打断的，不是本机环境问题（EV-251）：不记 blocker，该段按未探完交代
      if (aborted()) return;
      fixtureFailed.add(cli);
      blockers.push(blocker);
    });

  /*
   * ── 总时限（EV-251，计划 r2 D3）──
   * 不给 `deadline` 时下面这些一概不启用，各段照旧直接调用，行为逐字不变。
   */
  const dlo = opts.deadline ?? null;
  const dl = dlo
    ? new DeadlineController({
        ms: dlo.ms,
        unwindMs: dlo.unwindMs ?? DEADLINE_UNWIND_MS,
        graceMs: dlo.graceMs,
        killWaitMs: dlo.killWaitMs,
        handleSignals: dlo.handleSignals,
      })
    : null;
  // 本进程的台账只在带时限时记；补删（扫已退出进程的台账）每次 doctor 都做，见交出接头之后（代码三审 CODEX-04 ≡ GLM-03）
  const ledger = dlo && opts.ledgerDir ? new TempDirLedger(opts.ledgerDir) : null;
  let sweepResidue: string[] = [];
  /** 环境段跑完并落盘了；到点时还没跑完（含挂在不经 `run()` 的 await 上），收尾时写进 residue（代码三审 CODEX-02） */
  let envDone = false;
  ledger?.install();
  /** 本次要探的每一段的状态，`deadline.sections` 由它给出 */
  const sectionStates = new Map<string, { state: DeadlineSectionState; scope: ProbeSectionScope | null }>(
    DOCTOR_SECTION_ORDER.filter((cli) => only === null || only === cli).map((cli) => [cli, { state: 'not_started', scope: null }]),
  );
  const ABORTED = Symbol('aborted');
  /**
   * 段包装：在段作用域里跑 fn（作用域内派生一律自成一组、记进段）。中止派生之后返回的结果作废——
   * 合成结果与被杀的调用会被探针读成各种否定结论，落盘就是把「被我们打断」写成「能力缺失」；
   * 这时段里抛出的任何异常也接住（计划三审 AGY-01），未中止时原样重抛。
   */
  const inSection = async <T>(cli: string, fn: () => Promise<T>): Promise<T | typeof ABORTED> => {
    if (!dl) return fn();
    if (aborted()) return ABORTED;
    const scope = newProbeSection(cli, dl.token);
    dl.scopes.push(scope);
    sectionStates.set(cli, { state: 'in_progress', scope });
    try {
      const r = await withProbeSection(scope, async () => {
        await opts.sectionPrelude?.(cli);
        return fn();
      });
      return aborted() ? ABORTED : r;
    } catch (e) {
      if (aborted()) return ABORTED;
      throw e;
    }
  };
  const markFinished = (cli: string): void => {
    const s = sectionStates.get(cli);
    if (s) s.state = 'finished';
  };
  if (dl) {
    dlo?.onController?.(dl);
    dl.start();
  }
  /**
   * 命令行覆盖（模型、档位、思考等级、厂商 profile）的**唯一读点**（EV-245）：读的同时记下这一家的覆盖用上了，
   * 末尾据此给 `describeUnusedOverrides` 提示。各段不得绕过它直接读 `opts.tierFlags` / `opts.modelOverrides`——
   * 绕过了，用上的覆盖会被报成没用上（`doctor-unused-overrides` 按源码守着）。
   */
  const consumedOverrides = new Set<string>();
  const overridesFor = (id: CriticId): TierOverrides => {
    consumedOverrides.add(id);
    const model = opts.modelOverrides?.[id];
    return { ...opts.tierFlags?.[id], ...(model ? { model } : {}) };
  };

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
    if (!dl) return writeCheckpoint(label);
    // 到点收尾要等在写的这一次写完（EV-251）
    const p = writeCheckpoint(label);
    dl.track(p);
    return p;
  };
  const writeCheckpoint = async (label: string | null): Promise<void> => {
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
  /**
   * 收尾（只执行一次）：正常路径在各段之后调；带时限时兜底路径也调它（EV-251），那时段可能还挂着，
   * 这里只读已记下的状态，不等段。
   */
  let finalized: Promise<DoctorReport> | null = null;
  const finalize = (stuck = false): Promise<DoctorReport> => (finalized ??= (async (): Promise<DoctorReport> => {
    /*
     * 带时限时收尾的每一步都限时（代码三审 CODEX-03）：预算是控制器的剩余预算（到点后是「到点时刻 + 兜底时长」，
     * 未到点是「总时限 + 兜底时长」），兜底路径进来时预算已近于零，给每步至少 FINALIZE_STEP_FLOOR_MS——
     * 合计仍在 skill 的工具超时（总时限加 60 s）之内。没做完的如实写进 residue，台账保留给下一次 doctor。
     * 控制器在收尾末尾才停：收尾途中到点照样能出兜底结果。
     */
    const residueLate: string[] = [];
    const limited = async <T>(p: Promise<T>, what: string): Promise<T | undefined> => {
      if (!dl) return p;
      // 与兜底竞速：正常收尾进行中收到信号时，正在等的这一步不按旧预算等下去（代码审第 2 轮 CODEX-01）
      const r = await dl.limitStep(p);
      if (r.ok) return r.value;
      residueLate.push(`${what}在时限内没做完`);
      return undefined;
    };
    const term = dl?.termination ? await limited(dl.termination, '按组结束本次拉起的子进程') : null;

    // 写了却没用上的命令行覆盖（EV-245）：只进 warnings，退出码不变。跑过的段 = 探完的 + 夹具没建起来的
    const unusedOverrides = describeUnusedOverrides({
      tierFlags: opts.tierFlags,
      modelOverrides: opts.modelOverrides,
      consumed: consumedOverrides,
      ran: new Set([...probedSections, ...fixtureFailed]),
      only,
    });
    if (unusedOverrides !== null) warnings.push(unusedOverrides);

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
     *
     * 到点时作废的段不在 probedSections 里，这一次不会写它；被作废那一家下一次预检仍按路线探针新鲜度退 69，
     * 因为 `cliProbeIsFresh` 按各家自己的 probed_at 判、不看全局 generated_at（EV-251，计划三审 GLM-02）。
     */
    await limited(checkpoint(null), '末次落盘（补 generated_at）');
    const written = path.join(opts.triviumDir, 'config.local.yaml');
    notes.push(`探针结论已写入 ${written}`);

    let deadline: DoctorDeadline | undefined;
    if (dlo && dl) {
      const ledgerResidue = ledger ? await limited(ledger.finish(), '探针临时目录收尾（台账保留，下一次 doctor 启动时补删）') : [];
      const residue = [
        ...sweepResidue,
        ...(dl.reason !== null && !envDone ? ['环境段在时限内没跑完：本次没有刷新环境结论，也没有据它报阻断项'] : []),
        ...(term?.remaining ?? []).map((g) => `进程组 ${g} 在宽限链之后仍未确认结束（或成员数取不到）`),
        ...(term?.reused ?? []).map((g) => `进程组 ${g} 的组长已退出、组号已被别的进程复用，没有对它发信号`),
        ...(ledgerResidue ?? []),
        ...residueLate,
      ];
      deadline = {
        limit_s: Math.round(dlo.ms / 1000),
        hit: dl.reason !== null,
        reason: dl.reason,
        // 兜底触发过就记 stuck，不论是哪条路径先调的收尾（正常收尾途中被兜底打断也算）
        stuck: stuck || dl.stuckFired,
        sections: [...sectionStates].map(([cli, s]) => {
          const launches = s.scope?.launches ?? 0;
          return {
            only: cli,
            state: s.state,
            launches,
            notes: notes.filter((n) => n.startsWith(`[${cli}] `)),
            rerun: doctorRerunCommand(cli, opts),
            ...(s.state === 'finished' ? {} : { note: unfinishedSectionNote(launches) }),
          };
        }),
        residue,
      };
    }
    dl?.stop();
    return { probe, notes, blockers, warnings, directoryEvidence, ...(deadline ? { deadline } : {}) };
  })());
  if (hooks) {
    hooks.finalize = finalize;
    if (dl) hooks.controller = dl;
    hooks.ready?.();
  }
  // ↑ 收尾函数与控制器在第一个 await 之前交出：之后任何一步挂住，到点都能由兜底出结果（代码三审 CODEX-02）

  if (opts.ledgerDir) {
    sweepResidue = await sweepDoctorLedgers(opts.ledgerDir);
    // 不带时限时没有 deadline 段可放，残留进 warnings（不影响退出码）
    if (!dl) warnings.push(...sweepResidue);
  }

  // ── 环境 ────────────────────────────────────────────────────────────
  /*
   * 带时限时环境段也在段作用域里跑（代码三审 CODEX-02）：构建标识、版本探测里的 git / node 子进程到点同样按组结束。
   * 它不进 `deadline.sections`（那是「该跑哪一家」的清单）；到点时环境段的结论不落盘、它产出的阻断项撤回，残留里记一句。
   */
  const blockersBeforeEnv = blockers.length;
  const envScope = dl ? newProbeSection(DOCTOR_ONLY_ENV, dl.token) : null;
  if (dl && envScope) dl.scopes.push(envScope);
  const inEnv = <T>(fn: () => Promise<T>): Promise<T> => (envScope ? withProbeSection(envScope, fn) : fn());
  step('探测运行环境…');
  const env = await inEnv(async () => {
    await opts.sectionPrelude?.(DOCTOR_ONLY_ENV);
    return probeEnv();
  });
  probe.host = {
    platform: env.platform,
    arch: env.arch,
    has_timeout_bin: env.hasTimeoutBin,
    git_version: env.gitVersion,
  };
  notes.push(`node=${env.nodePath ?? '未找到'} ${env.nodeVersion ?? ''}`.trim());
  notes.push(`git=${env.gitVersion ?? '未找到'}`);
  // 构建标识（EV-82 小主题第一段）：只读、出错不影响 doctor
  try {
    const { describeBuildStamp } = await import('./build-stamp.js');
    notes.push(await inEnv(() => describeBuildStamp(opts.projectRoot)));
  } catch (e) {
    notes.push(`编排器构建标识：读取失败（${(e as Error).message}）`);
  }
  /*
   * 已废弃配置键（EV-30 ① / EV-15）：只告警、不影响退出码。放在环境段，与 `--only` 无关——
   * 它说的是配置本身，哪一段都该看见。正文与判定和预检同源（`deprecatedConfigNotice`），不带 ⚠️（`warn()` 自带）。
   */
  const deprecatedNotice = deprecatedConfigNotice(opts.config);
  if (deprecatedNotice !== null) warnings.push(deprecatedNotice);
  /*
   * 共享读取面里的同名入口（EV-240 方案 A，用户 D-11）：全量列出、给出口，**只进 warnings、不进 blockers**，
   * 退出码不受影响。与 `--only` 无关（同上一条：说的是本机环境）。判定与安装器同一份实现（`entry-collisions.ts`），
   * 只扫各家的额外读取根，不扫安装根（计划 r2 T-3）。扫描出错也只记一条告警。
   */
  {
    const se = entryScanEnv(opts.entryScanEnv);
    try {
      const listed = describeSharedRootProblems(await scanEntryCollisions(sharedReadRootTargets(AGENTS, se)), se.home);
      if (listed !== null) warnings.push(listed);
    } catch (e) {
      warnings.push(`共享读取面检查没做成：${(e as Error).message}`);
    }
  }
  if (!env.nodeOk) blockers.push('Node.js 不可用或版本低于 18');
  if (!env.gitOk) blockers.push('git 不可用或版本过低');
  // wrapper 自身在、里面写死的 node / bundle 却没了：每次 Hook 都会报 127
  const { checkWrapper } = await import('./init.js');
  for (const w of await inEnv(() => checkWrapper(opts.triviumDir))) blockers.push(w);
  if (!env.hasTimeoutBin) {
    notes.push(
      '本机无 GNU coreutils 的 timeout/gtimeout —— 编排器的超时全部在 Node 内实现，' +
        '不依赖外部命令（这是预期行为，非问题）',
    );
  }

  // 落盘契约保持 {build, test}：candidates 只活在内存里供 --suggest-verify 展示来源
  const sug = await inEnv(() => probeVerifyCommands(opts.projectRoot));
  probe.verify_suggestion = { build: sug.build, test: sug.test };
  notes.push(
    `编译测试命令候选：build=${JSON.stringify(sug.build)} ` +
      `test=${JSON.stringify(sug.test)}（仅候选，需人确认后写入 verify 才会执行）`,
  );
  notes.push(...sug.notes.map((n) => `[verify-probe] ${n}`));
  if (sug.truncated) notes.push('[verify-probe] 候选数已达上限，可能有子项目未列出');

  if (aborted()) {
    // 环境段在时限内没跑完：被打断的调用会读成「node / git 不可用」之类，不据它报阻断、不落盘
    blockers.length = blockersBeforeEnv;
  } else {
    await checkpoint(DOCTOR_ONLY_ENV);
    envDone = true;
  }

  // ── Antigravity ─────────────────────────────────────────────────────
  if (only === null || only === 'agy') {
    step('探测 Antigravity（agy）…');
    // 夹具没建起来时 r 为 null（EV-209）：该侧不赋值、不 checkpoint，blocker 已由 guard 推入
    const got = await inSection('agy', () => guard('agy', () =>
      probeAgy(agentConfigOf(opts.config, 'gemini', 'antigravity').bin, agentConfigOf(opts.config, 'gemini', 'antigravity').agent, {
        skipModelCalls: opts.skipModelCalls ?? false,
        existing: probe.cli.agy,
      }),
    ));
    // 中止派生之后返回的段作废、一个字节都不落（EV-251）
    const r = got === ABORTED ? null : got;
    if (got !== ABORTED) markFinished('agy');
    if (r) {
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
  }

  // ── ZCode ───────────────────────────────────────────────────────────
  if (only === null || only === 'zcode') {
    step('探测 ZCode（zcode.cjs）…');
    const got = await inSection('zcode', () => guard('zcode', () =>
      probeZcode(agentConfigOf(opts.config, 'glm', 'zcode').entry, env.nodePath ?? process.execPath, {
        skipModelCalls: opts.skipModelCalls ?? false,
        existing: probe.cli.zcode,
        // headless 与 path_deny 请求的模型：与认证探活同一定义（EV-194），探的是审查运行那条选模路径
        launchModel: zcodeProbeModel(opts.config),
        ...(opts.zcodeProbe ?? {}),
      }),
    ));
    const r = got === ABORTED ? null : got;
    if (got !== ABORTED) markFinished('zcode');
    if (r) {
      probe.cli.zcode = r.probe;
      notes.push(...r.notes.map((n) => `[zcode] ${n}`));
      await checkpoint('zcode');
      if (!r.probe.entrypoint) blockers.push('未找到 zcode.cjs 入口');
      else {
        /*
         * 布局与旗标两条 blocker **不借道 `response_field`**（r2 CODEX-06 ≡ AGY-05）。
         * 原先只有一支 `response_field === null && !skipModelCalls`，它在最该出现的两条路径上不可达：
         * ① 回归形态下探针 `failureKind !== 'none'` 时只 push note 就 return，`response_field` 保留旧值，
         *    全量 doctor 退 0、blockers 为空；② `--no-model-calls` 下整支被跳过，而 RUNBOOK 恰恰
         *    建议用这条命令排障——内置文件缺失 + 旗标全未判定时，它 0 blocker 通过。
         * 这两件事都与模型调用无关，判据也就不该挂在模型调用的结论上。
         */
        if (r.probe.provider_config?.builtin_file === null) blockers.push(ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT);
        // 只在**判定完成**时才拦：本轮未判定（P-29）时 readonly_flags 是保留的旧值，
        // 它为空只说明「没探出来过」，拦它给的是误导性结论（见 probes/zcode.ts 的第三态注释）
        if (r.flagsIndeterminate.length === 0 && r.probe.readonly_flags.length === 0) {
          blockers.push(
            '探针未实测到任何可用的只读参数组合，无法保障审查员只读——请重跑 trivium doctor 或升级 ZCode',
          );
        }
        if (r.flagsZeroExit.length > 0) {
          // 成本异常要被看见，但不拦：结论本身是对的（退 0 证明 argv 已解析完），
          // 异常的是这个探针本该零配额（r5 CODEX-02）
          warnings.push(
            `ZCode 旗标探针出现 ${r.flagsZeroExit.length} 次退 0——该探针本应零配额` +
              '（空 HOME 停在模型层，P-30），退 0 意味着真实模型调用已发生。请核对停点形态与配额消耗。',
          );
        }
        if (r.flagsIndeterminate.length > 0) {
          /*
           * 不拦，但也不能只留一条 note（r3 CODEX-F01-03）：落盘的 `readonly_flags` 是**上一轮的**，
           * 而 preflight 那头一旦读到空集就会报「无可用只读旗标、请升级 ZCode」——
           * 那是把布局问题报成能力缺失，人会往一个永远查不到的方向走。
           */
          warnings.push(
            `ZCode 旗标本轮未判定（${r.flagsIndeterminate.length} 个候选在参数解析前就退出，P-29）：` +
              `readonly_flags 保留的是上一次的结论 ${JSON.stringify(r.probe.readonly_flags)}。` +
              '先核对 ZCode 安装布局与 provider 配置定位，再谈旗标——这不是「探针没探到能力」。',
          );
        }
        // 本轮进了真实调用段却没刷新 response_field（EV-196）：与旗标未判定同档，出 warning、不拦。
        // 不与下面那条 blocker 互斥——blocker 说「没跑通」，这条说「哪一支、根因在哪、哪几项是旧的」
        if (r.headlessUnrefreshed) warnings.push(zcodeHeadlessUnrefreshedWarning(r.headlessUnrefreshed));
        if (r.probe.response_field === null && !opts.skipModelCalls) blockers.push(ZCODE_HEADLESS_NOT_OK_HINT);
      }
    }
  }

  // ── Codex ───────────────────────────────────────────────────────────
  if (only === null || only === 'codex') {
    step('探测 Codex（codex exec）…');
    const selected = resolveTier(opts.config, 'codex', 'code', overridesFor('codex'));
    const got = await inSection('codex', () => guard('codex', () =>
      probeCodex(opts.probeBins?.codex ?? (opts.config.agents.codex?.vendor === 'openai' ? opts.config.agents.codex.bin ?? null : null), {
        skipModelCalls: opts.skipModelCalls ?? false,
        existing: probe.cli.codex,
        selected,
      }),
    ));
    const r = got === ABORTED ? null : got;
    if (got !== ABORTED) markFinished('codex');
    if (r) {
      probe.cli.codex = r.probe;
      notes.push(...r.notes.map((n) => `[codex] ${n}`));
      await checkpoint('codex');
      /*
       * 能力对账（EV-06 的清偿）：只在该侧已接线时做——没有适配器就没有「声明」，
       * 拿不存在的声明去对账只会产生噪音。
       */
      const codexAdapter = realAdapters()[agentByCliName('codex')?.id ?? 'codex'];
      if (codexAdapter) {
        for (const line of capabilityParity(r.probe, codexAdapter.capability, 'codex')) {
          notes.push(`[codex] ${line.message}`);
        }
      }

      for (const line of codexSeverity(r.probe, {
        enabled: agentByCliName('codex')?.criticEnabled === true,
        asked: only === 'codex',
        skipModelCalls: opts.skipModelCalls ?? false,
        readonlyIndeterminate: r.readonlyIndeterminate !== null,
      })) {
        if (line.level === 'blocker') blockers.push(line.message);
        else notes.push(`[codex] ${line.message}`);
      }
      // 负对照本轮判不了（EV-25）：不拦，但要让人看见保留的是旧结论（仿 zcode P-29 的未判定 warning）
      if (r.readonlyIndeterminate !== null) {
        warnings.push(codexReadonlyIndeterminateWarning(r.readonlyIndeterminate, r.probe.readonly_flags));
      }
    }
  }

  // ── Claude Code ─────────────────────────────────────────────────────
  if (only === null || only === 'claude') {
    const selected = resolveTier(opts.config, 'claude', 'code', overridesFor('claude'));
    const canProbeModel = !opts.skipModelCalls && selected.model !== null;
    if (selected.model === null) notes.push('[claude] 未解析出本轮模型，跳过付费能力探针，不写路线准入结论');
    step(`探测 Claude Code（${selected.vendorProfile === null ? '原生' : `profile:${selected.vendorProfile}`}）…`);
    let routeBefore: ClaudeRoute | undefined;
    const got = await inSection('claude', () => guard('claude', async () => {
      const route = resolveClaudeRoute(opts.config, selected.vendorProfile);
      routeBefore = route;
      notes.push(`[claude] 配置声明模型：${route.modelsDeclared.join('、') || '未声明'}；不代表完整服务端目录`);
      return withClaudeProbeRoute(route, selected.model, selected.effort, () => probeClaude(opts.probeBins?.claude ?? route.nativeBin, {
        skipModelCalls: !canProbeModel,
        existing: claudeProbeForRoute(opts.config, selected.vendorProfile),
        assetRoot: resolveAssetRoot(),
        config: opts.config,
        directoryProbe: opts.claudeDirectoryProbe,
      }));
    }));
    const r = got === ABORTED ? null : got;
    if (got !== ABORTED) markFinished('claude');
    if (r) {
      const routes = { ...probe.cli.claude?.routes };
      directoryEvidence = r.directoryEvidence;
      const snapshot = { ...r.probe, route_profile: selected.vendorProfile };
      delete snapshot.routes;
      let stable = false;
      try { stable = routeBefore?.fingerprint === resolveClaudeRoute(opts.config, selected.vendorProfile).fingerprint; }
      catch { /* 消失或权限变化同样使本轮结论失效 */ }
      if (!stable) {
        delete routes[claudeRouteKey(selected.vendorProfile)];
        snapshot.readonly_flags = [];
        snapshot.tool_surface_checked = false;
        snapshot.directory_deny_verified = {};
        snapshot.directory_deny_fingerprint = null;
        snapshot.directory_deny_sensitive_globs_sha256 = null;
        snapshot.directory_deny_shape = null;
        snapshot.directory_deny_probed_at = null;
        blockers.push('Claude 路线在探测期间发生变化，本轮能力结论失效。请重跑 doctor。');
      } else if (canProbeModel && snapshot.probed_at !== null) {
        const cfg = { ...opts.config, probe: { ...probe, cli: { ...probe.cli, claude: snapshot } } };
        routes[claudeRouteKey(selected.vendorProfile)] = { profile: selected.vendorProfile,
          fingerprint: resolveClaudeRoute(cfg, selected.vendorProfile, snapshot.version).fingerprint, probe: snapshot };
      } else {
        const key = claudeRouteKey(selected.vendorProfile);
        const existing = routes[key];
        if (existing) routes[key] = { ...existing, probe: { ...existing.probe, directory_deny_verified: {},
          directory_deny_probed_at: null, directory_deny_fingerprint: null,
          directory_deny_sensitive_globs_sha256: null, directory_deny_shape: null } };
      }
      probe.cli.claude = { ...snapshot, routes };
      const routeCapability = realAdapters().claude?.capabilityFor?.({ ...opts.config, probe }, selected.vendorProfile);
      if (routeCapability?.rejectionRecorded === false) {
        warnings.push(`Claude ${selected.vendorProfile ?? 'native'} 被拒操作留痕未证实，阴性轨迹不能证明未尝试写；漂移按保守能力归因`);
      }
      notes.push(...r.notes.map((n) => `[claude] ${n}`));
      await checkpoint('claude');
      const claudeWarning = claudeStructuredArmWarning(r.structuredArmCause);
      if (claudeWarning) warnings.push(claudeWarning);
      // 记忆夹具没建起来（EV-209）：只有这一格没刷新，出 warning、不拦（计划双审 AGY-01）
      if (r.memoryFixtureFailure) warnings.push(memoryFixtureWarning(r.memoryFixtureFailure));
      for (const line of claudeSeverity(r.probe, {
        enabled: agentByCliName('claude')?.criticEnabled === true,
        asked: only === 'claude',
        skipModelCalls: !canProbeModel,
      })) {
        if (line.level === 'blocker') blockers.push(line.message);
        else notes.push(`[claude] ${line.message}`);
      }
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
    if (fixtureFailed.has(name)) continue; // 本次探了、夹具没建起来：已有 blocker，不是「尚无探针实现」（EV-209）
    // 到点时没探完或没开始的段：由 deadline.sections 交代，不是「尚无探针实现」（EV-251）
    if (dl?.reason && sectionStates.has(name) && sectionStates.get(name)!.state !== 'finished') continue;
    if (only !== null && only !== name) continue; // 用户没点名这一侧
    if (probe.cli[name]?.probed_at) continue; // 盘上有旧结论，不是「无实现」
    const agent = agentByCliName(name);
    notes.push(
      `[${name}] 已在注册表登记（${agent?.display ?? name}），但尚无探针实现，` +
        '本次未产生任何结论——这是确定答复而非失败。探针随 M6 第 2 / 3 步接入。',
    );
  }

  return finalize();
}

/** 人读渲染 */
export function renderDoctorReport(report: DoctorReport): void {
  say('');
  say('TriviumCode 本机能力探测');
  say('─'.repeat(60));
  for (const n of report.notes) say(`  ${n}`);
  say('');
  // 告警在阻断之前渲染且不影响退出码：它要被看见，但不该让 doctor 退非零
  for (const w of report.warnings) warn(w);
  if (report.warnings.length > 0) say('');
  if (report.blockers.length === 0) {
    say('✓ 未发现阻断级问题');
  } else {
    say(`✗ 发现 ${report.blockers.length} 项阻断级问题：`);
    for (const b of report.blockers) warn(b);
  }
  say('');
  const d = report.deadline;
  if (d) {
    const done = d.sections.filter((s) => s.state === 'finished').map((s) => s.only);
    const left = d.sections.filter((s) => s.state !== 'finished');
    say(
      `本次时限 ${d.limit_s} 秒，${d.hit ? (d.reason === 'signal' ? '收到信号' : '已到点') : '未到点'}` +
        `：已探完 ${done.join('、') || '无'}；未探完 ${left.map((s) => s.only).join('、') || '无'}`,
    );
    for (const s of left) say(`  请在终端单独跑：${s.rerun}`);
    for (const r of d.residue) warn(r);
    say('');
  }
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
