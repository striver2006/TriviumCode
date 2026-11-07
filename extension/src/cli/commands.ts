/**
 * CLI 子命令的类型化封装（仅覆盖插件需要的最小面）。
 *
 * 参数一律以数组透传给 wrapper（shell:false），不存在 shell 注入面。
 */
import type { TriviumCli } from './triviumCli';

// ── 输出形状（只声明插件消费的字段；多余字段忽略） ──────────────────────────

export interface TopicResolveOutput {
  ok: boolean;
  topic: string;
  topic_inferred: boolean;
  task_goal: string | null;
  prompt_hint: string | null;
  critics: string[];
  max_rounds: { plan: number | null; code: number | null } | null;
  notes: string[] | null;
  driver: string;
}

export interface TopicClaimOutput {
  ok: boolean;
  topic: string;
  stage: string;
  driver: string;
  outcome: string;
}

export interface PreflightOutput {
  ok: boolean;
  checks: { name: string; ok: boolean; warn: boolean; detail: string }[] | null;
  warnings: { name: string; detail: string }[] | null;
  exit_code: number;
}

export interface ReviewStatusOutput {
  ok: boolean;
  run_id: string;
  /** 根上的 phase（CLI 实际把完整状态放嵌套 status 内，两处都读，防御式双取） */
  phase: string | null;
  message: string | null;
  sides: Record<string, { state: string; model: string | null; attempt: number | null }> | null;
  artifacts: string[] | null;
  /** 嵌套 status 对象（--status 的权威形状：phase/artifacts/sides 在这里面） */
  status: {
    phase?: string;
    artifacts?: string[];
    sides?: Record<string, { state?: string; model?: string; attempt?: number }>;
    message?: string;
  } | null;
}

export interface DoctorOutput {
  ok: boolean;
  blockers: unknown[] | null;
  warnings: unknown[] | null;
}

export interface VersionOutput {
  version: string;
}

// ── Phase 3（FR-8/FR-9）：gate 与审批输出形状 ─────────────────────────────

/** gate --check --json 的 failures/warnings 单条形态（契约见 src/trivium/gate.ts） */
export interface GateFailureItem {
  code: string;
  message: string;
  ids?: string[];
  line?: number;
}

export interface GateWarningItem {
  code: string;
  message: string;
  ids?: string[];
}

export interface RoundVerdict {
  sides: Record<string, string>;
  excluded: Record<string, string> | null;
  counts: { pass: number; 'pass-after-changes': number; reject: number };
  outcome: string;
  next_action: string;
}

/** gate --check --json 顶层（cli.ts cmdGate 的 --check 分支）。无 topic 字段——那是调用方传的 --topic */
export interface GateCheckOutput {
  ok: boolean;
  stage: string;
  rerun_index: number;
  run_id: string;
  failures: GateFailureItem[];
  warnings: GateWarningItem[];
  structured_ids: string[];
  fallback_ids: string[];
  degraded_ids: string[];
  disposition: string | null;
  review_loop: { round: number; max_rounds: number } | null;
  round_verdict: RoundVerdict | null;
  next_action: string | null;
  round_line: string | null;
}

/** approve --json 输出里的权威工作树摘要（worktree-summary.ts 同形状；仅 approved 时携带） */
export interface WorkTreeSummary {
  available: boolean;
  reason: string | null;
  run_id: string;
  baseline: string;
  baseline_tree: string | null;
  current_tree: string | null;
  total: number;
  truncated: boolean;
  files: Array<{ status: string; path: string }>;
  excluded_prefixes: string[];
  budget_ms: number;
  budget_overridden: boolean;
}

export interface ApproveOutput {
  ok: boolean;
  topic: string;
  stages: string[];
  decision: string;
  worktree_summary?: Record<string, WorkTreeSummary>;
}

export interface AbandonOutput {
  ok: boolean;
  topic: string;
  stages?: string[];
  decision?: string;
  message?: string;
}

// ── 命令封装 ──────────────────────────────────────────────────────────────

export class TriviumCommands {
  constructor(private readonly cli: TriviumCli) {}

  async version(): Promise<string | null> {
    const r = await this.cli.run(['--version'], 15_000);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /**
   * topic resolve：正文是**单个 argv 项**（数组透传即天然安全，无需引号）。
   * `--` 之后 CLI 按 argv 逐 token 解析。
   */
  async topicResolve(args: {
    stage: string;
    body: string;
    flags: string[];
  }): Promise<{ code: number | null; out: TopicResolveOutput | null; stderr: string; stdout: string }> {
    const r = await this.cli.runJson<TopicResolveOutput>([
      'topic',
      'resolve',
      '--stage',
      args.stage,
      '--json',
      '--',
      args.body,
      ...args.flags,
    ]);
    return { code: r.code, out: r.json, stderr: r.stderr, stdout: r.stdout };
  }

  async topicClaim(topic: string, stage: string, driver: string): Promise<{ code: number | null; out: TopicClaimOutput | null; stderr: string }> {
    const r = await this.cli.runJson<TopicClaimOutput>([
      'topic',
      'claim',
      '--topic',
      topic,
      '--stage',
      stage,
      '--driver',
      driver,
      '--json',
    ]);
    return { code: r.code, out: r.json, stderr: r.stderr };
  }

  /**
   * preflight：预检的是本轮实际入选的那几侧与**实际运行配置**（CLAUDE-03）。
   * flags 传与 resolve 同源的运行旗标（--profile、--model-XX、--tier-XX、
   * --effort-XX、--profile-XX、--native-XX）；--topic、--max-rounds、--context
   * 不属预检面，不传。
   */
  async preflight(args: { stage: string; driver: string; critics: string[]; flags?: string[] }): Promise<{ code: number | null; out: PreflightOutput | null; stderr: string }> {
    const r = await this.cli.runJson<PreflightOutput>([
      'preflight',
      '--stage',
      args.stage,
      '--driver',
      args.driver,
      '--critics',
      args.critics.join(','),
      ...(args.flags ?? []),
      '--json',
    ], 120_000);
    return { code: r.code, out: r.json, stderr: r.stderr };
  }

  async reviewStatus(runId: string): Promise<{ code: number | null; out: ReviewStatusOutput | null }> {
    const r = await this.cli.runJson<ReviewStatusOutput>(['review', '--status', runId, '--json']);
    return { code: r.code, out: r.json };
  }

  async reviewCancel(runId: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const r = await this.cli.run(['review', '--cancel', runId], 120_000);
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  }

  /** 静态 doctor（--no-model-calls：不消耗厂商配额），用于健康面板手动刷新 */
  async doctorStatic(): Promise<{ code: number | null; out: DoctorOutput | null }> {
    const r = await this.cli.runJson<DoctorOutput>(['doctor', '--json', '--no-model-calls'], 300_000);
    return { code: r.code, out: r.json };
  }

  /**
   * FR-8：裁决完整性校验。退出码 0=通过 / 2=未通过（failures 非空）——两者都返回输出，
   * 缺口模型按 failures 消费；读不出 JSON（如 task_unreadable 时也可能有 JSON）返回 null。
   */
  async gateCheck(topic: string, stage: string): Promise<{ code: number | null; out: GateCheckOutput | null; stderr: string }> {
    const r = await this.cli.runJson<GateCheckOutput>(['gate', '--stage', stage, '--topic', topic, '--check', '--json'], 120_000);
    return { code: r.code, out: r.json, stderr: r.stderr };
  }

  /**
   * FR-9：人工审批。批准不带 --reject；拒绝必须 --reject --reason（理由必填由调用方
   * 在 UI 层先行拦截，CLI 侧 64 是兜底）。点击动作经宿主直发，不经过任何模型上下文。
   */
  async approve(args: {
    topic: string;
    stage: string;
    /** 批准时的附言（可选） */
    reason?: string;
    /** 拒绝（必填理由） */
    reject?: boolean;
    rejectReason?: string;
  }): Promise<{ code: number | null; out: ApproveOutput | null; stderr: string; stdout: string }> {
    const argv = ['approve', '--topic', args.topic, '--stage', args.stage];
    if (args.reject) {
      argv.push('--reject', '--reason', args.rejectReason ?? '');
    } else if (args.reason) {
      argv.push('--reason', args.reason);
    }
    argv.push('--json');
    const r = await this.cli.runJson<ApproveOutput>(argv, 120_000);
    return { code: r.code, out: r.json, stderr: r.stderr, stdout: r.stdout };
  }

  /**
   * FR-9：放弃闸门。显式传 --stage——省略会批量放弃该主题全部开放闸门（非单卡本意）。
   */
  async abandon(topic: string, stage: string): Promise<{ code: number | null; out: AbandonOutput | null; stderr: string; stdout: string }> {
    const r = await this.cli.runJson<AbandonOutput>(['abandon', '--topic', topic, '--stage', stage, '--json'], 120_000);
    return { code: r.code, out: r.json, stderr: r.stderr, stdout: r.stdout };
  }
}
