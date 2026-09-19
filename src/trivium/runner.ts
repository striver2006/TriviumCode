/**
 * `runner`：两侧真并行、超时、瞬时故障重试一次（设计 §5.1 / §12.2 / §12.3 / NFR-02）。
 *
 * 只负责「把两侧跑起来并收回结果」。只读校验、漂移判定、证据下限一律不在这里
 * ——那是 `guard` 的职责。
 */
import path from 'node:path';
import type { AdapterTable, AdapterContext } from './adapters/base.js';
import type { CriticId, CriticRequest, CriticResult, ReviewMode, ScrubOutcome } from './types.js';
import { clearScrubSentinel, describeScrubFailure, scrubSideDir } from './scrub.js';
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

/**
 * 单侧进展的增量快照。
 *
 * 存在的理由：没有它时，等待期的 `status.json` 从头到尾只有「两侧 running」——
 * `workerMain` 在 executeRun 之前一次性置 running、之后一次性写终态，中间没人
 * 回写。于是 `--wait` 每次返回的两侧状态恒定不变、`attempt` 恒为 0，
 * 「一侧先跑完」「正在重试」这些**用户最想知道的事**全都看不见（审查意见 AGY-01）。
 */
export interface SideProgress {
  state?: 'running' | 'ok' | 'failed' | 'timeout' | 'parse_fallback';
  /** 第几次尝试，从 1 起算 */
  attempt?: number;
  /** 本侧已耗时（秒） */
  elapsed_s?: number;
  note?: string | null;
}

export interface RunnerInput {
  ctx: AdapterContext;
  adapters: AdapterTable;
  requests: Partial<Record<CriticId, CriticRequest>>;
  /** 重试前对 BRIEF 追加提示（如 schema 错误清单、「你未读取任何项目文件」） */
  onRetryBrief?: (critic: CriticId, previous: CriticResult) => string | null;
  /**
   * 单侧进展回调，供工作进程把状态刷进 `status.json`。
   * **回调不得影响审查本身**：抛异常一律吞掉（见 emitProgress）。
   */
  onSideProgress?: (critic: CriticId, patch: SideProgress) => void;
  maxTransientRetries: number;
}

export interface RunnerOutput {
  results: Partial<Record<CriticId, CriticResult>>;
  /** 每侧实际尝试次数，写进元数据便于审计 */
  attempts: Partial<Record<CriticId, number>>;
}

/**
 * 发一次进展回调。**吞掉一切异常**：进度是附加品，写它出问题不该连累审查。
 * 回调实现里会碰文件系统（patchStatus），不吞的话一次瞬时 EBUSY 就能毁掉整轮。
 */
function emitProgress(input: RunnerInput, critic: CriticId, patch: SideProgress): void {
  try {
    input.onSideProgress?.(critic, patch);
  } catch {
    /* 进度回写失败不影响审查 */
  }
}

/** 把适配器结果的状态映射成 status.json 的侧状态词 */
function sideStateOf(r: CriticResult): NonNullable<SideProgress['state']> {
  if (r.status === 'ok') return 'ok';
  if (r.status === 'timeout') return 'timeout';
  return 'failed';
}

/** 跑一侧，含瞬时故障重试 */
async function runOneSide(
  input: RunnerInput,
  critic: CriticId,
  req: CriticRequest,
): Promise<{ result: CriticResult; attempts: number }> {
  const adapter = input.adapters[critic];
  // 查表可缺（见 AdapterTable 的说明）。缺了就在这里说清是谁缺，
  // 而不是让 `adapter.run` 崩出一条与原因无关的 TypeError。
  if (!adapter) throw new Error(`没有 ${critic} 侧的适配器，无法执行该侧审查。`);
  const startedAt = Date.now();
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
  let attempts = 0;
  let last: CriticResult;

  /*
   * 凭据抹除的挂载点 ①（BACKLOG EV-20，`scrub.ts` 文件头）。
   *
   * 该侧目录 = `path.dirname(req.out_dir)`：适配器把凭据副本写在那一层
   * （codex 的 `codexhome/`、zcode 的 `home/`）。挂在这里而不在各适配器里，
   * 是为了让 `adapter.run` **整个**被 `finally` 包住——含准备副本中途失败的早退
   * （GLM-05）与适配器抛异常的路径；且每次重试各抹一次，而重试会重新准备副本，
   * 所以跑之前先删旧哨兵（CODEX-02 ≡ GLM-02）。
   *
   * 抹除失败不判该侧失败：结果已产出、配额已烧。失败挂到结果的 `scrub` 上，
   * 由 worker 写进 status.json 的侧 note，`--wait` 会渲染出来（CODEX-10 ≡ AGY-06）。
   */
  const sideDir = path.dirname(req.out_dir);

  for (;;) {
    attempts++;
    step(`[${critic}] 第 ${attempts} 次尝试，模型 ${req.model}，上限 ${req.timeout_s}s`);
    // 尝试开始：让等待中的用户看见「第几次尝试」，重试尤其要看得见
    emitProgress(input, critic, { state: 'running', attempt: attempts, elapsed_s: elapsed() });
    // 删失败不改变流程（① 走 force 不看哨兵），但要留痕：残留的旧 ok 哨兵会让 ④ 跳过本轮的新副本（CODEX-06）
    await clearScrubSentinel(sideDir).catch((e: unknown) => {
      warn(`[${critic}] 旧哨兵删不掉：${(e as Error).message}——本轮若被强杀，会话启动清扫可能误判已抹`);
    });
    let thrown: unknown;
    let hasThrown = false;
    let attemptResult: CriticResult | undefined;
    try {
      attemptResult = await adapter.run(input.ctx, req);
    } catch (e) {
      thrown = e;
      hasThrown = true;
    }
    const scrub: ScrubOutcome = await scrubSideDir(adapter, sideDir, { force: true });
    const failure = describeScrubFailure(scrub);
    if (failure) {
      warn(`[${critic}] ${failure}`);
      emitProgress(input, critic, { note: failure });
    }
    if (hasThrown) {
      // 适配器抛异常这条出口上，抹除结果也要跟着结果走到终态 message（代码双审 r1 GLM-04）
      const err = thrown instanceof Error ? thrown : new Error(String(thrown));
      throw Object.assign(err, { scrub });
    }
    last = attemptResult!;
    last.scrub = scrub;

    if (last.status === 'ok') {
      // 本侧收口：另一侧还在跑时，这一刻的「已完成」正是用户最想看到的变化
      emitProgress(input, critic, { state: 'ok', attempt: attempts, elapsed_s: elapsed() });
      return { result: last, attempts };
    }
    if (attempts > input.maxTransientRetries) break;
    if (!isTransientFailure(last)) {
      step(`[${critic}] 失败原因判定为业务性，不重试：${last.fail_reason}`);
      break;
    }

    warn(`[${critic}] 瞬时故障，重试一次：${last.fail_reason}`);
    emitProgress(input, critic, {
      state: 'running',
      attempt: attempts,
      elapsed_s: elapsed(),
      note: '瞬时故障，重试中',
    });
    const extra = input.onRetryBrief?.(critic, last);
    if (extra) {
      // 把失败原因追加进 BRIEF，让模型知道上一次哪里不对
      req = { ...req, brief_text: `${req.brief_text}\n\n---\n\n${extra}` };
    }
  }

  emitProgress(input, critic, {
    state: sideStateOf(last),
    attempt: attempts,
    elapsed_s: elapsed(),
    note: last.fail_reason ?? null,
  });
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
        model_provider: null,
        /*
         * 回读值确实没走到；**请求值从镜像取**（代码双审 CODEX-01）。
         * 恒写 null 会把「该族没有 profile 概念」与「这次抛异常没采到」
         * 压成同一个观测——正是该字段声明「必填而非可选」要避免的那一格。
         */
        profile_requested: input.requests[critic]?.profile_requested ?? null,
        tool_calls: {},
        read_paths: [],
        search_hit_paths: null,
        write_events: [],
        command_texts: [],
        evidence_ok: false,
        fail_reason: `适配器异常：${String(s.reason)}`,
        session_id: null,
        cli_version: null,
        peer_deny_applied: false,
        /*
        * 该侧不注入 `--settings`（无路径级 deny 机制），**恒为 0 且这是能说明理由的零**：
        * 含义是「没有这种概念」，不是「注入了但一条都没跳过」。
        */
        deny_skipped: 0,
        deny_rule_count: 0,
        deny_bytes: 0,
        command_line: '',
        // runOneSide 把本次尝试的抹除结果挂在异常上带出来（GLM-04）
        ...((s.reason as { scrub?: ScrubOutcome } | null)?.scrub ? { scrub: (s.reason as { scrub: ScrubOutcome }).scrub } : {}),
      };
      attempts[critic] = 1;
    }
  });

  return { results, attempts };
}

export interface ModeDecision {
  /**
   * 本轮完成度，**不表达参与者基数**。
   *
   * 它只回答「入选的各侧是否都成功了」：全成功 `full`，有失败 `partial`。
   * 想知道「本轮该跑几侧、实际是哪几侧」，看 `selectedSides` / `okSides`。
   *
   * 第 1 步时这里还叫 `dual` / `single`，因为 `run.v1` 的 enum 就那两值：
   * 记 `single` 会被读成降级（与「选 1 审是配置意图」冲突）、记 `full` 通不过校验，
   * 三个取值在 v1 契约层都不可达。第 3 步升 `run.v2` 后这个约束才解除，
   * 内存层判定与落盘值自此同名同义（设计 §6.7.1）。
   */
  mode: ReviewMode;
  /** 严格模式下是否应中止整次运行 */
  abort: boolean;
  degradedReason: string | null;
  okSides: CriticId[];
  failedSides: CriticId[];
  /**
   * 本轮**入选**的审核者集合——即「本该跑几侧」。
   *
   * 这是本函数此前完全缺失的输入。没有它，`--only gemini` 成功跑完与双侧全成功
   * 的返回值**逐字段相同**，留痕里查不出本轮只审了一侧（AC-06）。
   */
  selectedSides: CriticId[];
  /** 入选却连一条结果都没产出的一侧。正常不可达；可达即说明装配链断了 */
  missingSides: CriticId[];
  /**
   * 真实降级判定：**入选的侧里有没有没成功的**。
   *
   * 与 `mode` 解耦是有意的——`mode === 'single'` 此前被当成降级的同义词
   * （`review.ts` 与 `gate.ts` 各自重算一遍），而「显式只选一侧并成功」
   * 不是降级、不该打降级横幅（设计 AC-22：选 1 审是配置意图）。
   */
  degraded: boolean;
}

/**
 * 按失败策略决定继续还是中止（设计 §12.4 / AD-09）。
 *
 * 铁律：**绝不**把单审改名冒充双审（AC-06）。幸存侧的文件照常落盘并标 degraded。
 *
 * `selected` 是必填的：把它做成可选参数等于允许调用方沿用「只看跑过的」的旧语义，
 * 而那正是本次要修的缺陷——判定必须同时知道「该跑哪几侧」与「跑出了什么」。
 *
 * **前置条件**：`results` 的键集应是 `selected` 的子集。
 * 多出来的键会被**忽略**（不参与判定），少的键进 `missingSides`。
 * 忽略而不是抛异常，是因为本函数在判定路径上，多余键本身不构成安全问题，
 * 为它炸掉一次本可继续的运行不划算。
 */
export function decideMode(
  results: Partial<Record<CriticId, CriticResult>>,
  failurePolicy: 'strict' | 'degrade',
  selected: readonly CriticId[],
): ModeDecision {
  const selectedSides = [...selected];
  /*
   * 先与入选集合求交：判定的**论域就是入选集合**，两个方向都设防。
   *
   * 只防 `selected ∖ ran`（下面的 missingSides）而不防 `ran ∖ selected`，
   * 会留下一个不对称的洞：未入选侧的失败结果一旦混进 results，
   * 就会把 mode 判成 single、degraded 置 true，strict 下还会 abort。
   * 当前唯一生产调用点受 `runBothSides` 的装配契约保护、该形态不可达，
   * 但本函数是**导出的纯函数**、测试直接调用，且 M7b 第 3 步起调用方会增多——
   * 一个纯函数的输入契约不该靠调用方的装配事实来保证（审查意见 AGY-02 ≡ GLM-02）。
   */
  const ran = (Object.keys(results) as CriticId[]).filter((c) => selectedSides.includes(c));

  const okSides = ran.filter(
    (c) => results[c]?.status === 'ok' || results[c]?.status === 'parse_fallback',
  );
  /*
   * 入选却没有结果条目的一侧，此前从判定里整个消失：`Object.keys(results)` 见不到它，
   * 于是「少跑了一侧」与「全成功」不可区分。并进 failedSides 才能让它显形。
   */
  const missingSides = selectedSides.filter((c) => !ran.includes(c));
  const failedSides = [...ran.filter((c) => !okSides.includes(c)), ...missingSides];

  if (failedSides.length === 0) {
    return {
      mode: 'full',
      abort: false,
      degradedReason: null,
      okSides,
      failedSides,
      selectedSides,
      missingSides,
      degraded: false,
    };
  }

  const reason = failedSides
    .map((c) =>
      missingSides.includes(c)
        ? `${c}: 入选但未产出任何结果`
        : `${c}: ${results[c]?.status}（${results[c]?.fail_reason ?? '未记录原因'}）`,
    )
    .join('；');

  // 入选侧全军覆没：无论什么策略都无法继续
  const abort = okSides.length === 0 ? true : failurePolicy === 'strict';

  return {
    mode: 'partial',
    abort,
    degradedReason: reason,
    okSides,
    failedSides,
    selectedSides,
    missingSides,
    degraded: true,
  };
}
