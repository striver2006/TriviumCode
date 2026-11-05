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
}
