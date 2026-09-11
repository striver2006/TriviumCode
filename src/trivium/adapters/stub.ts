/**
 * 桩适配器与跨进程注入（设计 §17.1 集成层，按修订版 M3 计划 §5 实现）。
 *
 * ## 为什么需要跨进程机制
 *
 * `review --start` 会 `spawnDetached` 一个独立的 `trivium review --worker <runId>` 进程，
 * 而 `rebuildContext` 在那个进程里**硬编码**真实适配器：
 *
 * ```ts
 * adapters: { gemini: agyAdapter, glm: zcodeAdapter }
 * ```
 *
 * 因此「只在测试主进程里替换 `CriticAdapter.run`」对派生的 worker **完全无效**——
 * 故障注入会静默失效，测试看似通过实则什么都没注入（审查意见 AGY-05）。
 *
 * 解法是环境变量：`spawnDetached` 继承环境变量，worker 里的适配器工厂读到它就返回桩。
 *
 * ## 安全边界
 *
 * 生产路径若检测到这个变量会打**醒目告警**——它能伪造「审查通过」，
 * 绝不能在真实审查里生效而无人知晓。
 */
import type { CriticId, CriticRequest, CriticResult } from '../types.js';
import { failedResult, type AdapterContext, type CriticAdapter } from './base.js';
import { warn } from '../util/log.js';

export const STUB_ENV_VAR = 'TRIVIUM_STUB_CRITIC';

/** 可注入的故障形态，对应 §17.2 的必测用例 */
export type StubMode =
  /** 正常返回一份合规结论 */
  | 'ok'
  /** 超时（对应「一侧进程被杀」） */
  | 'timeout'
  /** 返回非 JSON（对应「一侧返回非 JSON」） */
  | 'dirty_output'
  /** exit 0 但零工具调用（对应 Antigravity 软拒绝 / 纯 LLM 冒充 Agent） */
  | 'no_tools'
  /** 只读了送审包与被审对象，未读任何项目文件 */
  | 'no_project_reads'
  /** 向项目写文件（对应「审查中写入业务文件」） */
  | 'write_breach'
  /** 读取了禁读清单里的文件（对应「读到对方产出」） */
  | 'peer_leak'
  /** 进程级失败 */
  | 'fail';

export interface StubSpec {
  mode: StubMode;
  /** `ok` / `no_project_reads` 等模式下要产出的意见数 */
  findings?: number;
  /** 覆盖回读到的生效模型，用于 AC-13 的用例 */
  modelEffective?: string;
  note?: string;
}

export type StubConfig = Partial<Record<CriticId, StubSpec>>;

/** 从环境变量读注入配置。解析失败即视为未注入——绝不因它出错而影响生产路径 */
export function readStubConfig(env: NodeJS.ProcessEnv = process.env): StubConfig | null {
  const raw = env[STUB_ENV_VAR];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StubConfig;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    warn(`${STUB_ENV_VAR} 不是合法 JSON，已忽略`);
    return null;
  }
}

/** 序列化，供测试设置环境变量 */
export const encodeStubConfig = (c: StubConfig): string => JSON.stringify(c);

function sampleReview(critic: CriticId, n: number): string {
  const prefix = critic === 'gemini' ? 'AGY' : 'GLM';
  const findings = Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    severity: i === 0 ? 'blocker' : 'minor',
    layer: 'plan',
    kind: 'correctness',
    location: `src/stub.ts:${10 + i}`,
    problem: `桩注入的第 ${i + 1} 条问题`,
    evidence: '读了 src/stub.ts',
    suggestion: '这是桩数据，不代表真实审查结论',
    confidence: 'high',
  }));
  return JSON.stringify({
    schema: 'trivium.review.v1',
    verdict: n > 0 ? 'request-changes' : 'approve',
    summary: '桩适配器产出的结论，仅用于故障注入测试。',
    findings,
    agreed: [],
    not_covered: ['这是桩数据'],
    consulted: ['src/stub.ts'],
  });
}

function baseResult(critic: CriticId, req: CriticRequest, spec: StubSpec): CriticResult {
  const n = spec.findings ?? 1;
  return {
    critic,
    status: 'ok',
    exit_code: 0,
    duration_s: 1,
    raw_stdout_path: `${req.out_dir}/stub-stdout.json`,
    trace_path: `${req.out_dir}/stub-trace.json`,
    review_json: null,
    raw_response_text: sampleReview(critic, n),
    model_effective: spec.modelEffective ?? req.model,
    model_effective_source: 'envelope',
    tool_calls: { read: 6, grep: 2, glob: 1, run_command: 0 },
    // 4 条项目内读取：min_project_reads 默认下限是 3，留一点余量
    read_paths: [
      `${req.project_root}/src/a.ts`,
      `${req.project_root}/src/b.ts`,
      `${req.project_root}/src/c.ts`,
      `${req.project_root}/README.md`,
    ],
    write_events: [],
    evidence_ok: false, // 由 guard 判定
    fail_reason: null,
    session_id: 'stub-session',
    cli_version: 'stub/0.0.0',
    peer_deny_applied: false,
    command_line: `<stub ${critic} mode=${spec.mode}>`,
  };
}

/** 造一个按 spec 行事的桩适配器 */
export function makeStubAdapter(critic: CriticId, spec: StubSpec): CriticAdapter {
  return {
    critic,
    availability: () => ({ ok: true }),
    async run(_ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
      switch (spec.mode) {
        case 'timeout':
          return failedResult(critic, {
            status: 'timeout',
            reason: `桩注入超时（${req.timeout_s}s）`,
            durationS: req.timeout_s,
          });
        case 'fail':
          return failedResult(critic, {
            status: 'failed',
            reason: spec.note ?? '桩注入的进程级失败',
            exitCode: 1,
          });
        case 'dirty_output':
          return {
            ...baseResult(critic, req, spec),
            raw_response_text: '我觉得这个计划挺好的，没什么大问题。（桩注入的非结构化输出）',
          };
        case 'no_tools':
          return {
            ...baseResult(critic, req, spec),
            tool_calls: {},
            read_paths: [],
          };
        case 'no_project_reads':
          return {
            ...baseResult(critic, req, spec),
            // 工具调用数达标，但读的全是送审材料自己
            tool_calls: { read: 10 },
            read_paths: [req.subject_path, req.brief_path],
          };
        case 'write_breach':
          return {
            ...baseResult(critic, req, spec),
            write_events: [`write_to_file(${req.project_root}/src/injected.ts)`],
          };
        case 'peer_leak':
          return {
            ...baseResult(critic, req, spec),
            read_paths: [
              ...baseResult(critic, req, spec).read_paths,
              ...req.deny_paths.map((p) => `${req.project_root}/${p}`),
            ],
          };
        case 'ok':
        default:
          return baseResult(critic, req, spec);
      }
    },
  };
}

/**
 * 适配器工厂：**唯一**决定用真实适配器还是桩的地方。
 *
 * 所有拉起审查的路径（同步 `review`、worker 的 `rebuildContext`）都必须经这里，
 * 否则跨进程注入就会漏掉那条路径。
 */
export function resolveAdapters(
  real: Record<CriticId, CriticAdapter>,
  env: NodeJS.ProcessEnv = process.env,
): Record<CriticId, CriticAdapter> {
  const stub = readStubConfig(env);
  if (!stub) return real;

  warn(
    `⚠️ 检测到 ${STUB_ENV_VAR}：正在使用**桩适配器**，产出的不是真实审查结论。\n` +
      `  注入配置：${JSON.stringify(stub)}\n` +
      '  这只应出现在测试里。若这是真实审查，请立即清除该环境变量并重跑。',
  );

  const out = { ...real };
  for (const critic of Object.keys(stub) as CriticId[]) {
    const spec = stub[critic];
    if (spec) out[critic] = makeStubAdapter(critic, spec);
  }
  return out;
}
