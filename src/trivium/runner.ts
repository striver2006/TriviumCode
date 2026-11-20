import { stdoutAudit, type StdoutAudit } from './live-stdout.js';
/**
 * `runner`：两侧真并行、超时、瞬时故障重试一次（设计 §5.1 / §12.2 / §12.3 / NFR-02）。
 *
 * 只负责「把两侧跑起来并收回结果」。只读校验、漂移判定、证据下限一律不在这里
 * ——那是 `guard` 的职责。
 */
import path from 'node:path';
import type { AdapterTable, AdapterContext, EvidenceCheck } from './adapters/base.js';
import type { AttemptRecord, CriticId, CriticRequest, CriticResult, FailurePolicy, ReviewMode, ScrubOutcome } from './types.js';
import type { RoundQualifications, SideLeakVerdict } from './guard.js';
import { clearScrubSentinel, describeScrubFailure, scrubSideDir } from './scrub.js';
import { step, warn } from './util/log.js';
import { withTreeTag } from './util/exec.js';

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
  /**
   * 该侧这一轮发生了作废重跑（EV-225）。只会置真、不会清：等待预算要一直把重跑那一段算进去
   * （`status.ts` 的 `budgetFor`）。
   */
  voidRerun?: true;
}

/** 每侧每次运行至多作废重跑几次（用户 D-7 定死 1 次，不做成配置） */
export const MAX_VOID_RERUNS = 1;

/** 作废重跑期间该侧的进度说明 */
export const VOID_RERUN_NOTE = '上一次尝试读到对端产物，作废重跑中';

export interface RunnerInput {
  ctx: AdapterContext;
  adapters: AdapterTable;
  requests: Partial<Record<CriticId, CriticRequest>>;
  /** 重试前对 BRIEF 追加提示（如 schema 错误清单、「你未读取任何项目文件」） */
  onRetryBrief?: (critic: CriticId, previous: CriticResult, evidence: EvidenceCheck | undefined, nextAttempt: number) => string | null;
  /**
   * 单侧进展回调，供工作进程把状态刷进 `status.json`。
   * **回调不得影响审查本身**：抛异常一律吞掉（见 emitProgress）。
   */
  onSideProgress?: (critic: CriticId, patch: SideProgress) => void;
  maxTransientRetries: number;
  /*
   * ── 作废重跑的三个钩子（BACKLOG EV-225，M12 批次 3）──
   *
   * 作废判定挪到「该侧刚跑完」那一刻、在该侧自己的 promise 里决定重跑：另一侧不读、不等、不改任何共享状态。
   * 三个都不传时行为与本步之前逐值相同（单测直接调 runBothSides 时多半不传）。
   */
  /** 单侧泄漏判定（`guard.ts` 的 `makeSideLeakJudge`）。返回 null = 没判（失败 / 超时） */
  judgeLeak?: (critic: CriticId, result: CriticResult) => SideLeakVerdict | null;
  /** 把这次的原始输出挪出该侧子树；返回新位置（运行目录相对），挪失败返回 null。不得抛 */
  stashVoided?: (critic: CriticId, attemptNo: number) => Promise<string | null>;
  /** 重跑任务书最前面的点名段（`brief.ts` 的 `renderVoidRerunBanner`） */
  voidRerunBanner?: (critic: CriticId, verdict: SideLeakVerdict) => string;
}

export interface RunnerOutput {
  results: Partial<Record<CriticId, CriticResult>>;
  evidence: Partial<Record<CriticId, EvidenceCheck>>;
  priorWriteEvents: string[];
  /** 每侧实际尝试次数，写进元数据便于审计 */
  attempts: Partial<Record<CriticId, number>>;
  /**
   * 每侧的逐次尝试记录（EV-225）。**只有发生过作废重跑的侧有键**：没发生时 run.json 逐字不变。
   * 记法分层见 `AttemptRecord`。
   */
  attemptLog: Partial<Record<CriticId, AttemptRecord[]>>;
  /** 每侧最后一次重跑时追加在任务书最前面的点名段原文（要落盘进 `_meta/`，审计材料与实际送审一致） */
  rerunBanners: Partial<Record<CriticId, string>>;
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
) {
  const adapter = input.adapters[critic];
  // 查表可缺（见 AdapterTable 的说明）。缺了就在这里说清是谁缺，
  // 而不是让 `adapter.run` 崩出一条与原因无关的 TypeError。
  if (!adapter) throw new Error(`没有 ${critic} 侧的适配器，无法执行该侧审查。`);
  const startedAt = Date.now();
  const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
  let attempts = 0;
  let last: CriticResult;
  /*
   * 瞬时重试用独立计数（EV-225）。原判据是 `attempts > maxTransientRetries`；没有作废重跑时
   * `transientUsed === attempts - 1`，两者逐值等价。有作废重跑时瞬时额度在整侧内共用、不因重跑而重置——
   * 等待预算（`computeMaxWaits` 的基础值 + 一份重跑）正是按这条链算的。
   */
  let transientUsed = 0;
  let evidenceRetryUsed = 0;
  let voidReruns = 0;
  const priorWriteEvents: string[] = [];
  /** 逐次尝试记录；只在发生过作废重跑时交出去 */
  const log: AttemptRecord[] = [];
  let rerunBanner: string | null = null;
  /** 发生过作废重跑之后，终态事件要显式带 note，否则「作废重跑中」会一直挂在 status.json 上（计划双审 AGY-02） */
  const finalNote = (n: string | null): { note?: string | null } => (voidReruns > 0 || transientUsed > 0 ? { note: n } : {});
  const out = (r: CriticResult, evidence?: EvidenceCheck) =>
    ({ result: r, evidence, priorWriteEvents, attempts, attemptLog: voidReruns > 0 ? log : null, rerunBanner });

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
    const attemptStartedAt = new Date().toISOString();
    const audit: StdoutAudit = { redacted: {} };
    try {
      // 侧归属（EV-154）：适配器在这里面以 killTree 拉起的 CLI 带上侧名，worker 据此写 status.json 的 sides[c].cli
      attemptResult = await stdoutAudit.run(audit, () =>
        withTreeTag(critic, () => adapter.run({ ...input.ctx, attempt: attempts }, req)));
    } catch (e) {
      thrown = e;
      hasThrown = true;
    }
    const scrub: ScrubOutcome = await scrubSideDir(adapter, sideDir, { force: true, preRedacted: audit.redacted });
    if (attemptResult && audit.actualPath !== undefined) attemptResult.raw_stdout_path = audit.actualPath;
    if (audit.seal && audit.actualPath) {
      const key = path.relative(sideDir, audit.actualPath);
      const rewritten = (scrub.logs_redacted[key] ?? 0) > (audit.redacted[key] ?? 0);
      await audit.seal(scrub.ok && scrub.complete === true, rewritten);
    }
    const failure = describeScrubFailure(scrub);
    if (failure) {
      warn(`[${critic}] ${failure}`);
      emitProgress(input, critic, { note: failure });
    }
    if (hasThrown) {
      // 适配器抛异常这条出口上，抹除结果也要跟着结果走到终态 message（代码双审 r1 GLM-04）
      const err = thrown instanceof Error ? thrown : new Error(String(thrown));
      /*
       * 作废重跑之后才抛的（EV-225 代码双审 GLM-02）：逐次记录与已送出的点名段同款挂在错误上带出去，
       * 否则 status.json 记着重跑过、run.json 一字不提，点名段也进不了 `_meta/`。抛异常的那次补一条 failed 条目。
       */
      if (voidReruns > 0) {
        log.push({ n: attempts, started_at: attemptStartedAt, duration_s: elapsed(), status: 'failed', voided: null, fail_reason: `适配器异常：${err.message}` });
      }
      throw Object.assign(err, { scrub, attempts, priorWriteEvents, attemptLog: voidReruns > 0 ? log : null, rerunBanner });
    }
    last = attemptResult!;
    last.scrub = scrub;
    const rec: AttemptRecord = {
      n: attempts,
      started_at: attemptStartedAt,
      duration_s: last.duration_s,
      // 适配器层结果（分层记法）：二次命中那一条也记 ok，侧级改判在下面另写
      status: last.status === 'ok' ? 'ok' : last.status === 'timeout' ? 'timeout' : 'failed',
      voided: null,
      fail_reason: last.fail_reason,
    };
    log.push(rec);

    let evidence: EvidenceCheck | undefined;
    if (last.status === 'ok') {
      /*
       * ── 作废判定（EV-225）：该侧刚跑完、还没解析就判 ──
       *
       * 与终判（`judgeRun`）、闸门调同一个谓词（`judgeSide` → `leakRecordVoids`）。判定器抛异常按「未判出作废」
       * 收口、不重跑：那是编程错误，不该把一次真实审查判成失败；终判仍会照常判，确实作废就落回旧的「作废但 ok」处置，
       * 闸门照样把它排出共同阻断，且这条告警会跟着 worker 日志走。
       */
      let leak: SideLeakVerdict | null = null;
      let judgmentFailed = false;
      try {
        leak = input.judgeLeak?.(critic, last) ?? null;
      } catch (e) {
        judgmentFailed = true;
        warn(`[${critic}] 尝试判定抛出，交由终判核验：${(e as Error).message}`);
      }
      if (leak) {
        rec.voided = leak.voided;
        rec.peer_leak_via_path = { hit: leak.path.hit, hits: [...leak.path.hits] };
        rec.peer_leak_via_command = { hit: leak.command.hit, commands: [...leak.command.commands], hits: [...leak.command.hits] };
      }
      if (leak?.voided && voidReruns < MAX_VOID_RERUNS) {
        voidReruns++;
        rec.output_dir = input.stashVoided ? await input.stashVoided(critic, attempts) : null;
        warn(`[${critic}] 第 ${attempts} 次尝试读到对端产物，该次结论作废，同一次运行内重跑一次（上限 ${req.timeout_s}s）`);
        emitProgress(input, critic, {
          state: 'running', attempt: attempts, elapsed_s: elapsed(), note: VOID_RERUN_NOTE, voidRerun: true,
        });
        const banner = input.voidRerunBanner?.(critic, leak) ?? null;
        if (banner) {
          rerunBanner = banner;
          // 点名段插在**最前面**，原任务书逐字跟在后面；瞬时重试的提示仍追加在末尾，两者不冲突
          req = { ...req, brief_text: `${banner}\n\n---\n\n${req.brief_text}` };
        }
        continue;
      }
      if (leak?.voided) {
        /*
         * 二次命中：**侧级**改判失败，之后按现有失败侧规则走（strict 整次失败、显式允许降级时 partial）。
         * 不进瞬时重试判定——读到对方产出不是瞬时故障。条目里仍记适配器层的 ok（分层记法，计划双审 GLM-04）。
         */
        const n = leak.path.hits.length + leak.command.hits.length;
        last.status = 'failed';
        last.fail_reason = `peer_leak：重跑后仍读到对端产物（${n} 处命中）`;
        warn(`[${critic}] ${last.fail_reason}，该侧判失败`);
        emitProgress(input, critic, { state: 'failed', attempt: attempts, elapsed_s: elapsed(), note: last.fail_reason });
        return out(last);
      }
      evidence = leak?.evidence;
      if (!evidence || evidence.ok) {
        if (!judgmentFailed) emitProgress(input, critic, { state: 'ok', attempt: attempts, elapsed_s: elapsed(), ...finalNote(null) });
        return out(last, evidence);
      }
      rec.fail_reason = evidence.reasons.join('；');
      if (transientUsed >= input.maxTransientRetries || evidenceRetryUsed > 0) {
        emitProgress(input, critic, { state: 'failed', attempt: attempts, elapsed_s: elapsed(), note: rec.fail_reason });
        return out(last, evidence);
      }
      evidenceRetryUsed++;
      priorWriteEvents.push(...last.write_events);
    } else {
      if (transientUsed >= input.maxTransientRetries) break;
      if (!isTransientFailure(last)) {
        step(`[${critic}] 失败原因判定为业务性，不重试：${last.fail_reason}`);
        break;
      }
    }
    transientUsed++;

    const retryReason = evidence ? '执行证据不足' : '瞬时故障';
    warn(`[${critic}] ${retryReason}，重试一次：${rec.fail_reason}`);
    step(`[${critic}] 共享瞬时重试预算：已用 ${transientUsed}/${input.maxTransientRetries}`);
    emitProgress(input, critic, {
      state: 'running',
      attempt: attempts,
      elapsed_s: elapsed(),
      note: `${retryReason}，重试中`,
    });
    const extra = input.onRetryBrief?.(critic, last, evidence, attempts + 1);
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
  return out(last);
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
  const evidence: RunnerOutput['evidence'] = {};
  const priorWriteEvents: string[] = [];
  const attempts: Partial<Record<CriticId, number>> = {};
  const attemptLog: Partial<Record<CriticId, AttemptRecord[]>> = {};
  const rerunBanners: Partial<Record<CriticId, string>> = {};

  settled.forEach((s, i) => {
    const critic = sides[i]!;
    if (s.status === 'fulfilled') {
      results[critic] = s.value.result;
      if (s.value.evidence) evidence[critic] = s.value.evidence;
      priorWriteEvents.push(...s.value.priorWriteEvents);
      attempts[critic] = s.value.attempts;
      if (s.value.attemptLog) attemptLog[critic] = s.value.attemptLog;
      if (s.value.rerunBanner) rerunBanners[critic] = s.value.rerunBanner;
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
      // 作废重跑之后才抛的：逐次记录与点名段照样交回（与 fulfilled 分支同口径，只在发生过重跑时有键）
      const carried = s.reason as { attempts?: number; priorWriteEvents?: string[]; attemptLog?: AttemptRecord[] | null; rerunBanner?: string | null } | null;
      attempts[critic] = carried?.attempts ?? 1;
      if (carried?.priorWriteEvents) priorWriteEvents.push(...carried.priorWriteEvents);
      if (carried?.attemptLog) {
        attemptLog[critic] = carried.attemptLog;
      }
      if (carried?.rerunBanner) rerunBanners[critic] = carried.rerunBanner;
    }
  });

  return { results, evidence, priorWriteEvents, attempts, attemptLog, rerunBanners };
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
  results: Partial<Record<CriticId, { status: CriticResult['status']; fail_reason?: string | null }>>,
  failurePolicy: FailurePolicy,
  selected: readonly CriticId[],
  qualifications: RoundQualifications,
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

  const okSides = ran.filter((c) => qualifications[c]?.canProceed);
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
