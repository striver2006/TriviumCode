/**
 * `runner`：两侧真并行、超时、瞬时故障重试一次（设计 §5.1 / §12.2 / §12.3 / NFR-02）。
 *
 * 只负责「把两侧跑起来并收回结果」。只读校验、漂移判定、证据下限一律不在这里
 * ——那是 `guard` 的职责。
 */
import type { CriticAdapter, AdapterContext } from './adapters/base.js';
import type { CriticId, CriticRequest, CriticResult } from './types.js';
import { step, warn } from './util/log.js';

/**
 * 是否属于**瞬时**故障（§12.3）。
 *
 * 只有瞬时故障才重试。业务性失败（认证失败、模型非法、只读失守、二次读到对方产出）
 * 不重试——重试它们只是把同一个错误再犯一遍，白烧配额。
 */
export function isTransientFailure(r: CriticResult): boolean {
  if (r.status === 'ok') return false;
  if (r.status === 'timeout') return false; // 超时重试大概率再超时，交给失败策略

  const reason = (r.fail_reason ?? '').toLowerCase();

  // 明确的业务性失败，不重试
  const permanent = [
    'provider_not_configured',
    'model config is missing',
    '鉴权',
    'authentication',
    'unauthorized',
    '模型',
    'entry 未探测到',
    'bin 未探测到',
  ];
  if (permanent.some((p) => reason.includes(p))) return false;

  // 空输出、非 TTY 丢 stdout、429/网络抖动、schema 校验失败、证据不足
  const transient = ['429', 'rate limit', 'econnreset', 'etimedout', 'socket hang up',
    '空输出', 'empty', 'parse', 'schema', 'insufficient_evidence', 'no_project_context', 'no_trace'];
  return transient.some((t) => reason.includes(t));
}

export interface RunnerInput {
  ctx: AdapterContext;
  adapters: Record<CriticId, CriticAdapter>;
  requests: Partial<Record<CriticId, CriticRequest>>;
  /** 重试前对 BRIEF 追加提示（如 schema 错误清单、「你未读取任何项目文件」） */
  onRetryBrief?: (critic: CriticId, previous: CriticResult) => string | null;
  maxTransientRetries: number;
}

export interface RunnerOutput {
  results: Partial<Record<CriticId, CriticResult>>;
  /** 每侧实际尝试次数，写进元数据便于审计 */
  attempts: Partial<Record<CriticId, number>>;
}

/** 跑一侧，含瞬时故障重试 */
async function runOneSide(
  input: RunnerInput,
  critic: CriticId,
  req: CriticRequest,
): Promise<{ result: CriticResult; attempts: number }> {
  const adapter = input.adapters[critic];
  let attempts = 0;
  let last: CriticResult;

  for (;;) {
    attempts++;
    step(`[${critic}] 第 ${attempts} 次尝试，模型 ${req.model}，上限 ${req.timeout_s}s`);
    last = await adapter.run(input.ctx, req);

    if (last.status === 'ok') return { result: last, attempts };
    if (attempts > input.maxTransientRetries) break;
    if (!isTransientFailure(last)) {
      step(`[${critic}] 失败原因判定为业务性，不重试：${last.fail_reason}`);
      break;
    }

    warn(`[${critic}] 瞬时故障，重试一次：${last.fail_reason}`);
    const extra = input.onRetryBrief?.(critic, last);
    if (extra) {
      // 把失败原因追加进 BRIEF，让模型知道上一次哪里不对
      req = { ...req, brief_text: `${req.brief_text}\n\n---\n\n${extra}` };
    }
  }

  return { result: last, attempts };
}

/**
 * 两侧**真并行**。
 *
 * 用 allSettled 而不是 all：一侧抛异常不能连带取消另一侧——
 * 另一侧的结果照样要落盘并标降级（AC-06，绝不改名冒充对方）。
 */
export async function runBothSides(input: RunnerInput): Promise<RunnerOutput> {
  const sides = (Object.keys(input.requests) as CriticId[]).filter((c) => input.requests[c]);

  const settled = await Promise.allSettled(
    sides.map((c) => runOneSide(input, c, input.requests[c]!)),
  );

  const results: Partial<Record<CriticId, CriticResult>> = {};
  const attempts: Partial<Record<CriticId, number>> = {};

  settled.forEach((s, i) => {
    const critic = sides[i]!;
    if (s.status === 'fulfilled') {
      results[critic] = s.value.result;
      attempts[critic] = s.value.attempts;
    } else {
      // 适配器本身抛异常（不该发生，但不能因此丢掉另一侧）
      results[critic] = {
        critic,
        status: 'failed',
        exit_code: null,
        duration_s: 0,
        raw_stdout_path: '',
        trace_path: null,
        review_json: null,
        raw_response_text: null,
        model_effective: null,
        model_effective_source: 'unverified',
        tool_calls: {},
        read_paths: [],
        write_events: [],
        evidence_ok: false,
        fail_reason: `适配器异常：${String(s.reason)}`,
        session_id: null,
        cli_version: null,
        peer_deny_applied: false,
        command_line: '',
      };
      attempts[critic] = 1;
    }
  });

  return { results, attempts };
}

export type ReviewMode = 'dual' | 'single';

export interface ModeDecision {
  mode: ReviewMode;
  /** 严格模式下是否应中止整次运行 */
  abort: boolean;
  degradedReason: string | null;
  okSides: CriticId[];
  failedSides: CriticId[];
}

/**
 * 按失败策略决定继续还是中止（设计 §12.4 / AD-09）。
 *
 * 铁律：**绝不**把单审改名冒充双审（AC-06）。幸存侧的文件照常落盘并标 degraded。
 */
export function decideMode(
  results: Partial<Record<CriticId, CriticResult>>,
  failurePolicy: 'strict' | 'degrade',
): ModeDecision {
  const all = Object.keys(results) as CriticId[];
  const okSides = all.filter((c) => results[c]?.status === 'ok' || results[c]?.status === 'parse_fallback');
  const failedSides = all.filter((c) => !okSides.includes(c));

  if (failedSides.length === 0) {
    return { mode: 'dual', abort: false, degradedReason: null, okSides, failedSides };
  }

  const reason = failedSides
    .map((c) => `${c}: ${results[c]?.status}（${results[c]?.fail_reason ?? '未记录原因'}）`)
    .join('；');

  // 两侧都失败：无论什么策略都无法继续
  if (okSides.length === 0) {
    return { mode: 'single', abort: true, degradedReason: reason, okSides, failedSides };
  }

  return {
    mode: 'single',
    abort: failurePolicy === 'strict',
    degradedReason: reason,
    okSides,
    failedSides,
  };
}
