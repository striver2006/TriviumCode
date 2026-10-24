/**
 * 长时调用协议：`--start` / `--wait` / `--status` / `--cancel`
 * （设计 §7.5 / AD-03，按修订版 M2 计划 §2.1 实现四件套而非两件套）。
 *
 * 存在理由：Driver 的 Bash 工具有工具级超时（默认 120s，上限 600s），而双审单侧
 * 上限 900~1200s、可重试一次，一次运行墙钟可达 30~40 分钟。同步调用必被杀——
 * 本项目在 M1 的首次真实双审里亲历过一次（被 600s 工具超时移到后台）。
 *
 * 工作进程的生命周期**等于一次运行**，跑完即退，不监听、不接受新任务，
 * 因此不是 PRD Non-Goal 所指的常驻 Daemon。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config, CriticId, CriticRequest, Ctx, Stage, CommandEntry, ReviewLoop, RoundVerdict } from './types.js';
import { EXIT, TriviumError, envError, exitCodeOf, missingArtifact } from './exit-codes.js';
import { runRoot } from './config.js';
import { RUN_DIR_FILES } from './run-files.js';
import {
  acquireLock, inspectLock, lockPathFor, reclaimStaleLock, workerLockContent, type LockHandle, type ReclaimedLock,
} from './lock.js';
import {
  budgetForStatus, cliRecordsOf, computeMaxWaits, interpretStatus, isTerminal, judgeCliGroup, lostOf, newStatus, patchStatus, rawCliOf, readStatus,
  renderProgress, renderProgressBrief, progressViewOf, scrubAdmission, scrubHoldWhy, staleThresholdWithinHeartbeat, syncCliRecords,
  workerConfirmedGone, workerStartOf, writeStatus, WORKER_HEARTBEAT_MS,
  type CliGroupRecord, type CliGroupVerdict, type ProgressBudget, type ProgressView, type RunStatus, type WorkerLostRecord,
} from './status.js';
import type { ArchiveLayout } from './archive.js';
import {
  executeRun, prepareRun, repoId, type PreparedRun, type ReviewOptions, type RunContext,
} from './review.js';
import { resolveTopic } from './topic.js';
import {
  describeFinalizeStepWith, describeRunMetaCause, finalizeCancelledRunMeta, finalizeFailedRunMeta, finalizeLines, readRunMeta,
  readRunMetaDetailed, type FinalizeStep,
} from './meta.js';
import { type AgentId } from './agents/registry.js';
import { releaseRunningGateEntry, setGateChecked } from './state.js';
import type { AdapterContext } from './adapters/base.js';
import { resolveAdapters } from './adapters/stub.js';
import { realAdapters, wiredAdapter } from './adapters/index.js';
import { scrubRunDir } from './scrub.js';
import { ensureDir, exists, sha256 } from './util/fsx.js';
import { IS_WIN } from './util/platform.js';
import {
  canonicalStartOf, processAlive, processGroupMemberCount, processMatchesRecord, processStartTime, processStartTimes,
  shutdownTrackedTrees, spawnDetached, terminateProcessGroup, trackedTrees, watchTrackedTrees, type DetachedChildWatch,
  type GoneJudgment, type RecordedStart, type TerminateResult,
} from './util/exec.js';
import { fail, say, step, warn } from './util/log.js';
import {
  checkHeartbeatThreshold,
  checkModelOverrideSource,
  checkSharedReadRoots,
  checkTierCombos,
  collectWarnings,
  type PreflightWarning,
} from './preflight.js';
import type { TierFlagValues } from './tier-flags.js';

/**
 * 向工作进程组发 SIGTERM 之后等多久再升级 SIGKILL：`--cancel` 与 `--start` 派生后失败的收尾共用（EV-152 起具名）。
 * worker 的 SIGTERM 处理器必须在这之内做完（转发给 CLI 并重新自杀），否则被升级 SIGKILL、处理器跑不到。
 */
export const WORKER_TERM_GRACE_MS = 5000;
/** worker 收到 SIGTERM 后，转发给它拉起的 CLI 进程组，等多久再 SIGKILL（EV-152） */
export const WORKER_TREE_GRACE_MS = 2000;
/** 对 CLI 进程组发 SIGKILL 之后至多再等多久（EV-152） */
export const WORKER_TREE_KILL_WAIT_MS = 1000;
/**
 * 对工作进程组发 SIGKILL 之后至多再等多久确认退出。三个使用方：`--start` 派生后失败的收尾（EV-150 起就是 5 s，EV-152
 * 代码双审 r1 CODEX-06 起具名）、失联后取消挂住的 worker（`cancelLostWorker`，EV-146）与 `--cancel` 主路径（EV-176 起；
 * 此前 EV-150 定为 SIGKILL 之后不等、收尾照做，未确认也回收锁与闸门）——三处之后的步骤都以「确认退出」为前提，
 * 确认就在这里做，等不到即按未确认处置（主路径以 69 退出、什么收尾都不做）。
 * 与 `WORKER_TERM_GRACE_MS` 数值相同、语义无关——那个是 SIGTERM 之后的宽限。
 * 设计 7.5 `review --start` 行「失败路径最长约 20 s」= 宽限 5 s + 本常量 5 s + 取启动时刻的 `ps` 至多 10 s。
 */
export const ORPHAN_KILL_CONFIRM_MS = 5000;

export const runDirFor = (cfg: Config, projectRoot: string, runId: string): string =>
  path.join(runRoot(cfg), repoId(projectRoot), runId);

/*
 * 文件名取自 `run-files.ts`，不写字面量：禁读分类要靠同一份清单认出「己方运行时材料」，
 * 而依赖方向让它引不到本模块——两处各抄一份，改名时不会报错，只会让审查员
 * 读自己那轮的材料时被判作废（r2 AGY-05 ≡ GLM-07）。
 */
const requestPath = (runDir: string): string => path.join(runDir, RUN_DIR_FILES.request);
const workerPidPath = (runDir: string): string => path.join(runDir, RUN_DIR_FILES.workerPid);
const workerLogPath = (runDir: string): string => path.join(runDir, RUN_DIR_FILES.workerLog);
const cancelRequestPath = (runDir: string): string => path.join(runDir, RUN_DIR_FILES.cancelRequest);

/**
 * 写 Windows 的 worker 优雅取消标记（设计 §7.1）。POSIX 上是 no-op——SIGTERM 本身可达，
 * macOS 行为零变化。写在终止阶梯的软步**之前**：worker 轮询到标记即走 `shutdownTrackedTrees`
 * 后按 143 退出，宽限期内通常无需升级硬步。写失败只告警不阻断——硬步（`taskkill /T /F`）仍在后面兜底。
 */
async function requestWorkerCancel(runDir: string): Promise<void> {
  if (!IS_WIN) return;
  try {
    await fs.writeFile(cancelRequestPath(runDir), `${new Date().toISOString()}\n`, 'utf8');
  } catch (e) {
    warn(`写取消标记失败（${(e as Error)?.message ?? e}）：worker 的优雅收尾可能走不到，宽限期满将直接强杀`);
  }
}

// ─────────────────────── 交接结构 ───────────────────────

/**
 * `--start` 写给工作进程的交接文件。
 *
 * 工作进程**不重新 prepare**——那会重新冻结快照，得到与送审包不一致的哈希。
 * 它必须原样接过 `--start` 已经冻结好的那一份。
 */
interface Handoff {
  schema: 'trivium.handoff.v1';
  run_id: string;
  rerun_index: number;
  topic: string;
  stage: Stage;
  subject_path: string;
  run_dir: string;
  sides: CriticId[];
  requests: Partial<Record<CriticId, CriticRequest>>;
  /** 落盘形态：code 阶段各侧 `diffText` 为 null、正文在 {@link Handoff.frozen_diff}（EV-236 A2）；读回经 `unpackSnapshots` 还原 */
  snapshots: PreparedRun['snapshots'];
  /**
   * code 阶段冻结补丁的**唯一一份**（EV-236 A2，M12 批次 5）。**可选**：旧交接文件没有它，
   * 那时各侧快照各带一份 `diffText`，原样读出。schema 名不变（计划 r2 T-7）：各侧 `diffText`
   * 冻结之后没有读者，旧版 worker 读新文件只是拿到 null。
   */
  frozen_diff?: FrozenDiff;
  meta_paths: string[];
  /** 重建 ReviewOptions 所需的字段（ctx 由工作进程自己 loadCtx 得到） */
  options: {
    promptHint: string | null;
    contextPaths: string[];
    subjectFile: string | null;
    modelOverrides: Partial<Record<CriticId, string>>;
    /**
     * 档位命令行旗标（M11 第 5 步）。**可选**：旧交接文件没有它，读侧缺席即空。
     * worker 用它保留同一份档位请求；族比较依据本轮声明与回读。回滚方向的降级（旧版 worker 读新交接文件会忽略它）
     * 不改 run.v2 无解，见计划 r2 §5 第 4 条。
     */
    tierFlags?: Partial<Record<CriticId, TierFlagValues>>;
    driverModel?: string | null;
    driverProvider?: string | null;
    command: string;
    /** 本轮入选的审核者集合。worker 是另一个进程，必须随交接文件带过去 */
    critics: CriticId[];
    assetRoot?: string;
    /** 会话 id 与临时降级开关必须一起交接：worker 是另一个进程，读不到 --start 的 argv */
    sessionId: string | null;
    allowSingle: boolean;
    /**
     * 当轮 Driver（M9 第 5 步）。**必填**——与 `critics` / `sessionId` / `allowSingle` 同列。
     *
     * 声明成必填而不是可选，是为了让「类型上加了、`writeHandoff` 里忘了写值」
     * 这条静默路径在**编译期**就不可达：`ReviewOptions.driver` 本身是可选的，
     * 若这里也可选，漏写两处都过 typecheck，只能靠测试去兜。
     *
     * 注意这道保险**只在同版本进程内成立**：`rebuildContext` 读的是
     * `JSON.parse(...) as Handoff`，旧版写出的交接文件没有这个字段，
     * 类型必填而运行期 undefined——所以那里另有一道运行期校验。
     */
    driver: AgentId;
    /** 发起命令（A/B/C/D）同样只有 --start 知道，要随交接文件带给 worker */
    entry?: CommandEntry | null;
  };
}

/** 交接文件里那一份冻结补丁 */
export interface FrozenDiff {
  sha256: string;
  text: string;
}

type Snapshots = PreparedRun['snapshots'];

/**
 * 写交接文件前把各侧同一份补丁收成一份（EV-236 A2）。
 *
 * code 阶段 `prepareRun` 只算一次补丁、逐侧透传给 `freeze`，于是每侧快照的 `diffText` 都是同一份正文，
 * 原样写盘就是 N 份（10-11 那份 148.8 MB 的 `request.json` 里快照占了 145.4 MB）。
 * 只在**侧数 ≥ 1、首侧有正文、各侧逐字相同**时收（计划双审 AGY-03）；否则（plan / bug 全为 null，
 * 或防御性地出现不一致）原样返回、不出 `frozen_diff`。**不改入参**：`--start` 同进程后面看到的仍是原对象。
 */
export function packSnapshots(snapshots: Snapshots): { snapshots: Snapshots; frozen_diff?: FrozenDiff } {
  const sides = Object.keys(snapshots) as CriticId[];
  const first = sides.length > 0 ? snapshots[sides[0]!]?.diffText : null;
  if (typeof first !== 'string' || !sides.every((c) => snapshots[c]?.diffText === first)) return { snapshots };
  const packed: Snapshots = {};
  for (const c of sides) packed[c] = { ...snapshots[c]!, diffText: null };
  return { snapshots: packed, frozen_diff: { sha256: sha256(first), text: first } };
}

/**
 * worker 读回交接文件时按引用还原各侧补丁（EV-236 A2）。按序判，任一不过即 `envError`（交接文件坏了，拒绝执行）：
 *
 * 1. 没有 `frozen_diff`：code 阶段却有一侧 `diffText` 为 null ⇒ 新格式丢了正文；否则是旧格式，**原样返回**；
 * 2. 有 `frozen_diff` 而不是 code 阶段（计划双审 AGY-02）；
 * 3. `frozen_diff` 形态不合：不是对象、`text` / `sha256` 不是字符串（AGY-02）；
 * 4. 正文与自带的 sha256 对不上；
 * 5. 某侧 `diffText` 不是 null，或该侧 `subjectSha256` 与这份补丁对不上；
 *
 * 然后把各侧 `diffText` 还原为同一份正文——与去重前的内存对象逐字段相等。
 * 这些拒绝只作用于新格式，旧格式（各侧各带正文、没有 `frozen_diff`）一条都不受，没有放宽任何既有判据。
 */
export function unpackSnapshots(
  h: { stage: Stage; snapshots: Snapshots; frozen_diff?: unknown },
  runId: string,
): Snapshots {
  const sides = Object.keys(h.snapshots) as CriticId[];
  const bad = (why: string): TriviumError => envError(`运行 ${runId} 的交接文件已损坏：${why}，拒绝执行`);
  if (h.frozen_diff === undefined) {
    if (h.stage === 'code' && sides.some((c) => h.snapshots[c]?.diffText === null)) {
      throw bad('code 阶段有一侧快照没有补丁正文，也没有共享的那一份');
    }
    return h.snapshots;
  }
  if (h.stage !== 'code') throw bad(`${h.stage} 阶段不该带冻结补丁`);
  const fd = h.frozen_diff as Partial<FrozenDiff> | null;
  if (fd === null || typeof fd !== 'object' || typeof fd.text !== 'string' || typeof fd.sha256 !== 'string') {
    throw bad('冻结补丁的形态不对');
  }
  if (sha256(fd.text) !== fd.sha256) throw bad('冻结补丁的正文与它的 sha256 对不上');
  const out: Snapshots = {};
  for (const c of sides) {
    const snap = h.snapshots[c]!;
    if (snap.diffText !== null) throw bad(`${c} 侧快照既带补丁正文、又有共享的那一份`);
    if (snap.subjectSha256 !== fd.sha256) throw bad(`${c} 侧快照的被审对象哈希与冻结补丁对不上`);
    out[c] = { ...snap, diffText: fd.text };
  }
  return out;
}

async function writeHandoff(rc: RunContext): Promise<void> {
  const packed = packSnapshots(rc.snapshots);
  const h: Handoff = {
    schema: 'trivium.handoff.v1',
    run_id: rc.runId,
    rerun_index: rc.rerunIndex,
    topic: rc.ref.topic,
    stage: rc.stage,
    subject_path: rc.subjectPath,
    run_dir: rc.runDirBase,
    sides: rc.sides,
    requests: rc.requests,
    snapshots: packed.snapshots,
    ...(packed.frozen_diff ? { frozen_diff: packed.frozen_diff } : {}),
    meta_paths: rc.metaPaths,
    options: {
      promptHint: rc.opts.promptHint,
      contextPaths: rc.opts.contextPaths,
      subjectFile: rc.opts.subjectFile,
      modelOverrides: rc.opts.modelOverrides,
      driverModel: rc.meta.driver_declaration?.model ?? null,
      driverProvider: rc.meta.driver_declaration?.provider ?? null,
      ...(rc.opts.tierFlags && Object.keys(rc.opts.tierFlags).length > 0 ? { tierFlags: rc.opts.tierFlags } : {}),
      command: rc.opts.command,
      critics: [...rc.sides],
      sessionId: rc.opts.sessionId ?? null,
      allowSingle: rc.opts.allowSingle === true,
      /*
       * 取值来自**运行元数据**，不是在这里重算一遍 `rc.opts.driver ?? DEFAULT_DRIVER`。
       *
       * 上一版就是那么写的。今天两者恒等（`prepareRun` 算的也是这个式子），
       * 所以不是 bug——但它是**同一个派生的第二份实现**：`rc.opts` 是未归一化的原始入参，
       * 一旦 `prepareRun` 的归一化口径变了（比如 driver 改从别处取），交接文件会
       * 无声地分叉，而 worker 是另一个进程，分叉了也没人看得见。
       *
       * `rc.meta.driver` 是这一轮已经落盘的权威值，与下面 `handoffDriver` 的回落
       * 口径同源（那段注释写的就是「回落取 meta.driver 而不是 DEFAULT_DRIVER」）。
       *
       * 这一处是扫描判据加上「实参块里不得出现 DEFAULT_DRIVER」之后浮出来的
       * （第 2 轮 CODEX-01 ≡ GLM-02③）——那条判据要防的正是「形对值错」。
       */
      driver: rc.meta.driver,
      entry: rc.opts.entry ?? null,
      ...(rc.opts.assetRoot ? { assetRoot: rc.opts.assetRoot } : {}),
    },
  };
  await fs.writeFile(requestPath(rc.runDirBase), JSON.stringify(h, null, 2) + '\n', 'utf8');
}

/**
 * 交接文件里的当轮 Driver，缺失时回落并**打一条可见告警**。
 *
 * `Handoff.options.driver` 在类型上是必填的，但 `rebuildContext` 读的是
 * `JSON.parse(...) as Handoff`——那是**断言，不是校验**。用
 * `review --worker <runId>` 恢复一份**旧版写出的**交接文件时，类型必填而运行期
 * 是 undefined：静默回落缺省 Driver 会让非缺省 Driver 的那一轮被按 claude 重跑，
 * 产物后缀与轮次都记错，且全程不报错。
 *
 * 回落取 `meta.driver` 而**不是** `DEFAULT_DRIVER`：运行元数据是这一轮 Driver 的
 * 权威记录，而且它就在调用处手边——没有理由去猜一个可能错的值。
 */
function handoffDriver(h: Handoff, meta: { driver: AgentId }, runId: string): AgentId {
  const v = h.options.driver as AgentId | undefined;
  if (v) return v;
  warn(
    `运行 ${runId} 的交接文件没有 driver 字段（早于 M9 第 5 步写出）：` +
      `按运行元数据记录的「${meta.driver}」继续`,
  );
  return meta.driver;
}

/** 工作进程侧：从交接文件重建执行上下文 */
async function rebuildContext(ctx: Ctx, runId: string): Promise<RunContext> {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const p = requestPath(runDir);
  if (!(await exists(p))) {
    throw missingArtifact(`找不到运行 ${runId} 的交接文件：${p}`);
  }
  const h = JSON.parse(await fs.readFile(p, 'utf8')) as Handoff;

  const ref = await resolveTopic(ctx, h.topic, h.stage);
  const meta = await readRunMeta(ref.layout, h.stage, runId);
  if (!meta) throw missingArtifact(`找不到运行 ${runId} 的 run.json`);
  if (meta.schema !== 'trivium.run.v3') {
    throw envError('旧版运行交接不能由v3 worker重新执行；历史读取与取消仍支持，请用原版本收尾后新开一轮');
  }
  for (const c of h.sides) {
    const request = h.requests[c];
    const frozen = meta.requested_routes?.[c];
    const current = request ? { model: request.model, effort: request.effort ?? null,
      tier: request.tier, tier_source: request.tier_source, access: request.access } : null;
    if (!frozen || JSON.stringify(current) !== JSON.stringify(frozen) || request?.profile_requested !== frozen.access.profile) {
      throw envError(`${c} 的执行交接与运行记录请求路线不一致，拒绝重新解析或替换组合`);
    }
  }

  const adapterCtx: AdapterContext = {
    cfg: ctx.config,
    nodePath: ctx.config.runtime.node ?? process.execPath,
  };

  // 新格式按引用还原各侧补丁、旧格式原样（EV-236 A2）；之后的逻辑看到的快照与去重前逐字段相同
  const snapshots = unpackSnapshots(h, runId);
  const primary = snapshots[h.sides[0]!];
  if (!primary) throw envError(`交接文件缺少 ${h.sides[0]} 侧的快照`);

  return {
    opts: {
      ctx,
      stage: h.stage,
      topic: h.topic,
      promptHint: h.options.promptHint,
      contextPaths: h.options.contextPaths,
      subjectFile: h.options.subjectFile,
      modelOverrides: h.options.modelOverrides,
      tierFlags: h.options.tierFlags ?? {},
      driverModel: h.options.driverModel ?? null,
      driverProvider: h.options.driverProvider ?? null,
      command: h.options.command,
      critics: h.options.critics,
      sessionId: h.options.sessionId ?? null,
      allowSingle: h.options.allowSingle === true,
      driver: handoffDriver(h, meta, runId),
      entry: h.options.entry ?? null,
      ...(h.options.assetRoot ? { assetRoot: h.options.assetRoot } : {}),
    } satisfies ReviewOptions,
    cfg: ctx.config,
    ctx,
    stage: h.stage,
    ref,
    adapterCtx,
    /*
     * worker 进程独立重建上下文，必须**同样**经工厂取适配器。
     * 只在测试主进程里替换适配器对派生 worker 无效——故障注入会静默失效（审查意见 AGY-05）。
     */
    adapters: resolveAdapters(realAdapters()),
    sides: h.sides,
    runId: h.run_id,
    rerunIndex: h.rerun_index,
    subjectPath: h.subject_path,
    runDirBase: h.run_dir,
    requests: h.requests,
    snapshots,
    primarySnap: primary,
    metaPaths: h.meta_paths,
    meta,
    /*
     * worker 不重复冻结：补丁已由 --start 落盘，跳过判定若为「跳过」也根本不会
     * 走到派生 worker 这一步——startRun 在派生前就已收口。
     */
    pendingDiff: null,
    skipVerdict: null,
    // 任务书已在 --start 时渲染进交接文件、剔除告警已随 --start 返回；这里给空，--wait 终态里不重复（EV-02）
    mustReadPruned: [],
  };
}

// ─────────────────────── --start ───────────────────────

/**
 * 每次 `--wait` 的 Bash 调用应设的工具级超时。
 *
 * Bash 工具默认 120s、上限 600s，而 `--wait` 会等满 `waitTimeoutS`——不显式抬高
 * 就必被工具超时杀掉（审查意见 GLM-02，也是 M2 完成判据 6）。原先固定取上限值，
 * 但窗口调小后那就成了「卡死也要干等 10 分钟」：改成贴着窗口留 60s 余量，
 * 余量覆盖进程启动与收尾，与原先 600-540 的余量等价。窗口若仍是 540s，结果不变。
 */
export function bashTimeoutFor(waitTimeoutS: number): number {
  return Math.min(600_000, waitTimeoutS * 1000 + 60_000);
}

export interface StartOutcome {
  runId: string;
  /** skill 侧的 `--wait` 循环上限 */
  maxWaits: number;
  /** 每次 `--wait` 应传的秒数 */
  waitTimeoutS: number;
  /** skill 必须为每次 --wait 的 Bash 调用设置的工具级超时（毫秒） */
  bashTimeoutMs: number;
  /** 本阶段单侧超时，供 skill 的开场播报说明「预算多久」 */
  stageTimeoutS: number;
  /** 两侧**生效**模型（已过 profile 与 --model-* 覆盖），供开场播报 */
  models: Partial<Record<CriticId, string>>;
  workerPid: number;
  runDir: string;
  /**
   * 本次运行在同步窗口内就已完成，**没有**派生 worker，调用方不必再 `--wait`。
   * 目前唯一的来源是 FR-23 的纯文档跳过。
   */
  finishedInline?: boolean;
  /** finishedInline 时的人读说明 */
  inlineNotice?: string;
  /**
   * 拉起前按**当轮入选侧**复查出的只警告项（EV-123；共享读取面一项另含当轮 Driver，EV-246），**恒存在**；
   * 末尾另追加准备阶段从各侧任务书第 4 段剔除的自动条目（EV-02，`RunContext.mustReadPruned`）。
   * 在派生**之后**才随返回值交到调用方——拦不住拉起，价值是开场播报时就能看到、可以立即 `--cancel`。
   * `finishedInline` 时不计算（没有审查员会被拉起），为 `[]`。
   */
  warnings: PreflightWarning[];
  /** 本轮在轮次链里的位置（EV-247）；bug 阶段与纯文档跳过轮为 null */
  reviewLoop: ReviewLoop | null;
}

/**
 * 回收了上一轮遗留的运行锁之后，给那一轮收尾（EV-151，候选 A 并含同步路径扩展）。`startRun` 与同步 `runReview`
 * 取到锁、准备新一轮之前各调一次，入参是 `acquireLock` 交还的 `reclaimed`。
 *
 * **只收「持锁进程已确认不在」的运行锁**：原因为 `pid_gone` / `pid_reused`（按 pid + 启动时刻判，与 `--wait` 判 `pid_gone`
 * 同一判据）、`kind: 'run'`、带 `run_id` 与 `stage`。锁里记的是那一轮唯一的写者——`--start` 派生之后改写成的工作进程，
 * 或同步路径分配 run_id 之后补写了 run_id 的同步 CLI 自己——它不在，就满足 EV-142「没有另一个写者」的前提。
 * - 归档 run.json 不存在（同步路径分配 run_id 之后、写骨架之前就中断）⇒ 什么都不做；读不出 ⇒ 告警一行、不收；
 *   已是终态 ⇒ 什么都不做（正常结束的运行释放了锁，走不到这里；这一格是「写完终态之后、放锁之前被中断」）；
 * - 运行目录的 status.json 记了 `worker_pid` 而与锁里的 pid 不同 ⇒ 不收：锁记的不是那一轮的工作进程，按 `--wait` 判；
 *   status.json 不在（同步运行）或还没补 `worker_pid`（`--start` 改写锁与补写之间）⇒ 以锁为准；
 * - 否则先回收该轮仍为 running 的闸门项（比 run_id），再 `finalizeFailedRunMeta`（`worker_lost` / `pid_gone`），逐步播报。
 *   顺序同同步路径的收尾：没有下一次补齐的入口时先放闸门（`meta.ts` `finalizeUnfinishedRunMeta` 文档块）。
 * status.json 不写（工作进程那一轮之后 `--wait` 仍判 `pid_gone`、不再改写已终态的 run.json）。
 *
 * 带 `kind: 'run'` 却没有 `run_id` 的遗留锁——`--start` 在改写之前中断（EV-150 那个窗口，工作进程可能还活着），
 * 或本版之前的同步运行——定位不到那一轮，只多告警一句，不收。
 */
export async function settleReclaimedRunLocks(ctx: Ctx, reclaimed: readonly ReclaimedLock[]): Promise<void> {
  for (const r of reclaimed) {
    const c = r.content;
    if (!c || c.kind !== 'run' || (r.reason !== 'pid_gone' && r.reason !== 'pid_reused')) continue;
    if (!c.run_id || !c.stage) {
      warn(
        `被回收的遗留锁里没有记 ${c.run_id ? '阶段' : 'run_id'}（派生工作进程之前就中断，或本版之前的同步运行）：` +
          '定位不到上一轮，不替它收尾；它的归档若停在 running，请人工核对',
      );
      continue;
    }
    try {
      await settleReclaimedRun(ctx, c.topic, c.stage, c.run_id, c.pid);
    } catch (err) {
      warn(`给上一轮运行 ${c.run_id} 收尾时出错：${String((err as Error)?.message ?? err).split('\n')[0]}——不影响本轮，请人工核对它的归档`);
    }
  }
}

async function settleReclaimedRun(ctx: Ctx, topic: string, stage: Stage, runId: string, pid: number): Promise<void> {
  const layout: ArchiveLayout = { archiveRoot: ctx.archiveRoot, topic };
  const read = await readRunMetaDetailed(layout, stage, runId);
  if (!read.ok) {
    if (read.cause.kind !== 'missing') {
      warn(`上一轮运行 ${runId}（${stage} 阶段）的归档 run.json 读不出（${describeRunMetaCause(read.cause)}），不替它收尾`);
    }
    return;
  }
  if (read.meta.status !== 'running') return;
  const st = await readStatus(runDirFor(ctx.config, ctx.projectRoot, runId)).catch(() => null);
  if (typeof st?.worker_pid === 'number' && st.worker_pid !== pid) {
    warn(
      `上一轮运行 ${runId} 的归档仍为 running，但遗留锁记的 pid ${pid} 不是 status.json 记的工作进程 ${st.worker_pid}：` +
        `不替它收尾，请 trivium review --wait ${runId} 判定`,
    );
    return;
  }
  const heartbeatStaleMs = ctx.config.review.heartbeat_stale_s * 1000;
  step(`上一轮运行 ${runId}（${stage} 阶段）的持锁进程 ${pid} 已不在、归档仍为 running：按失联收尾（worker_lost / pid_gone）`);
  await releaseRunningGateEntry({ triviumDir: ctx.triviumDir, topic, stage, runId, heartbeatStaleMs }); // 自身不抛
  const fin = await finalizeFailedRunMeta({
    layout, stage, runId,
    lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs },
    workerGone: true,
    termination: { by: 'worker_lost', reason: 'pid_gone' },
  });
  const noRetry =
    '这一步不会自动重试（遗留锁已回收）：请人工核对归档 run.json 与 task.json 的运行登记' +
    '（工作进程那一轮还可以 trivium review --wait 补收，同步运行没有这个入口）';
  reportFinalizeStep(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 failed`, `归档 run-${runId}.json 未回写`, noRetry);
  reportFinalizeStep(fin.task, '已把 task.json 的运行登记同步为 failed', 'task.json 的运行登记未改', noRetry);
}

/**
 * `review --start`：准备 → 派生工作进程 → **立即返回**。
 *
 * 锁的所有权在这里有个要点：`--start` 进程拿到锁后**不能** release——
 * 锁要由工作进程继续持有到运行结束。因此锁内容记的是**工作进程**的 pid，
 * 由 `--start` 在派生后改写。
 */
export async function startRun(opts: ReviewOptions): Promise<StartOutcome> {
  const { ctx } = opts;
  const cfg = ctx.config;

  // 先占锁再 prepare：否则两个并发 --start 会各自冻结一份快照后才发现冲突
  const lock = await acquireLock({
    triviumDir: ctx.triviumDir,
    topic: opts.topic,
    stage: opts.stage,
    kind: 'run',
    heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
    runTerminal: async (runId) => {
      if (!runId) return false;
      const ref = await resolveTopic(ctx, opts.topic, opts.stage);
      const m = await readRunMeta(ref.layout, opts.stage, runId);
      return m !== null && m.status !== 'running';
    },
  });
  // 回收了上一轮遗留的运行锁时给那一轮收尾（EV-151）。本函数自身不抛；放在 try 之前，不进本轮的失败收尾
  await settleReclaimedRunLocks(ctx, lock.reclaimed);

  let rc: RunContext;
  try {
    rc = await prepareRun(opts);
  } catch (e) {
    // 准备失败就别占着锁。闸门不用管：prepareRun 抛错时闸门不归本轮——被拦时没置上，
    // 置上之后的失败它自己回收（闸门拦截不留骨架计划 r2 §3.2）
    await lock.release();
    throw e;
  }

  /*
   * ── 纯文档跳过必须在**派生之前**收口（FR-23 / §6.4）──
   *
   * 跳过判定只存在于 prepareRun 的返回值里，而 worker 是另一个进程、
   * 自己 rebuildContext，拿不到它。若在这里不收口，`--start --stage code`
   * 对纯文档变更会照样派生一个 worker 去跑完整双审——判定形同失效，
   * 而且白烧两侧配额。
   */
  if (rc.skipVerdict?.skipped) {
    try {
      const out = await executeRun(rc); // 不碰任何适配器，立即返回
      return {
        runId: rc.runId,
        maxWaits: 0,
        waitTimeoutS: cfg.review.wait_timeout_s,
        bashTimeoutMs: bashTimeoutFor(cfg.review.wait_timeout_s),
        stageTimeoutS: cfg.review.timeout_s[rc.stage],
        models: {},
        workerPid: process.pid,
        runDir: rc.runDirBase,
        finishedInline: true,
        inlineNotice: out.warnings.join('\n'),
        warnings: [],
        reviewLoop: null,
      };
    } finally {
      await lock.release(); // 没有 worker 接手，锁必须在这里还
    }
  }

  /*
   * ── 副本源复查（EV-123）：与预检 ④″ 是**同一个函数**，这里按当轮 `sides` 再调一次 ──
   *
   * 预检按它自己的选侧（skill 第 1 步不传 `--critics`，取缺省集合），时点也早于这里
   * （命令 A 的 S0.6 预检与 S2 之间隔着起草）。决定烧不烧配额的是这里，所以在跳过分支之后、派生之前复查。
   * `rc.adapters` 已过 `resolveAdapters`，桩注入在这里同样生效。
   * 同步 `review --stage` 不走这里、不做这项复查：手工调试入口，skill 不走它；收尾 guard 仍在。
   *
   * **必须在主 `try` 之内**（代码双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-01）：此刻 `prepareRun` 已把闸门置成
   * `running`，失败要连闸门一起回收——那正是主 `catch` 做的事。上一版单独包了一个只放锁的 `catch`，
   * 抛错时闸门会停到 `approval_lock_ttl_h`，而清扫此时拿不到 `worker_pid`、要过 TTL 才回收。
   *
   * **失联阈值（EV-160）同一次汇总**：与预检 ④‴ 同一个 `checkHeartbeatThreshold`，顺序与预检相同（副本源在前、阈值在后）。
   * 只读配置、不抛。FR-23 跳过分支（上方 `finishedInline`）不走这里：那一支没有 worker、没有 `--wait`，`warnings` 仍为 `[]`。
   *
   * **共享读取面（EV-246）同一次汇总**，排在档位组合之后、必读剔除之前：与预检 ④⁵ 同一个 `checkSharedReadRoots`，
   * 看当轮 Driver ∪ `sides`，正文结尾的场合词换成「本次运行」。
   */
  let warnings: PreflightWarning[];
  /*
   * 子进程**已诞生**（`spawnDetached` 拿到 pid 时经 `onSpawned` 置位）。主 `catch` 据此决定收不收归档 run.json
   * （EV-145，事后收尾余项计划 r2 §3.3，计划双审 r1 CODEX-03 ≡ GLM-02）：
   * - 为假：还没有 worker，写者就是本进程，把骨架收尾为 failed（`prepare_exception`）。这一侧含 `spawnDetached`
   *   内部建日志目录、开日志文件、`spawn` 没拿到 pid 三处失败——它们都在子进程诞生之前；
   * - 为真：先终止 worker 并按子进程句柄确认退出，再收尾（`post_spawn_exception`）——见 `settleOrphanedStart`
   *   （EV-150，派生后失败的孤儿worker计划 r2 §3.4）。此前这一格只放锁、回收闸门，孤儿 worker 照常跑完、
   *   事后把已回收的闸门置成待裁决，或与下一轮并发。
   * 不用「`spawnDetached` 有没有返回」判：它的 `finally` 在子进程已起之后仍可能因关日志句柄而抛。
   * `spawnState.born` 与 `childBorn` 同时置位；前者多带子进程句柄，那一格拿不到返回值，只能从回调里留下
   * （用对象持有：在回调里赋值的 `let` 会被控制流分析在 catch 里收窄成 null）。
   */
  let childBorn = false;
  const spawnState: { born: { pid: number; watch: DetachedChildWatch } | null } = { born: null };
  // 提到 try 之外：派生后失败时收尾要用（失败点在取到它之前则为 null）。两种形态同一次取、同一处写（EV-158）
  let workerStartedAt: string | null = null;
  let workerStartedAtCanonical: string | null = null;
  try {
    const heartbeatWarn = checkHeartbeatThreshold(cfg);
    // 档位组合的告警（M11 第 4 步）：准备阶段已判过 ok（不 ok 早已退 64），这里只为把告警念出来；纯函数、不抛
    const tierCombos = checkTierCombos(cfg, rc.stage, rc.opts.modelOverrides, rc.sides, rc.opts.tierFlags);
    /*
     * 共享读取面（EV-246）：与预检 ④⁵ 同一个函数、同一口径（当轮 Driver ∪ 入选审核者），只告警、不阻断；
     * 终端直接跑 `--start` 或 skill 漏跑预检时也看得到。没有问题时返回 null、不追加，输出与此前逐字节相同。
     * 扫描异常在函数内吞成一条告警，不会走到主 `catch`。
     */
    const sharedRoots = await checkSharedReadRoots([rc.meta.driver, ...rc.sides], undefined, '本次运行');
    warnings = [
      ...collectWarnings([
        ...(await checkModelOverrideSource(rc.sides, rc.adapters)),
        ...(heartbeatWarn ? [heartbeatWarn] : []),
        tierCombos,
        ...(sharedRoots ? [sharedRoots] : []),
      ]),
      // 准备阶段从各侧任务书第 4 段剔除的自动条目（EV-02），追加在后、既有两项顺序不变
      ...rc.mustReadPruned,
    ];
    await ensureDir(rc.runDirBase);
    await writeHandoff(rc);

    const status = newStatus({
      runId: rc.runId,
      topic: rc.ref.topic,
      stage: rc.stage,
      sides: rc.sides,
      models: Object.fromEntries(
        rc.sides.map((c) => [c, rc.requests[c]?.model ?? null]),
      ) as Partial<Record<CriticId, string>>,
    });
    await writeStatus(rc.runDirBase, status);

    // 派生工作进程。stdio 重定向到 worker.log，绝不继承父进程管道
    const selfScript = process.argv[1];
    if (!selfScript) throw envError('无法定位编排器自身脚本路径，无法派生工作进程');
    const spawned = await spawnDetached(
      ctx.config.runtime.node ?? process.execPath,
      [selfScript, 'review', '--worker', rc.runId],
      {
        cwd: ctx.projectRoot,
        logFile: workerLogPath(rc.runDirBase),
        onSpawned: (pid, watch) => {
          childBorn = true;
          spawnState.born = { pid, watch };
        },
      },
    );
    await fs.writeFile(workerPidPath(rc.runDirBase), `${spawned.pid}\n`, 'utf8');

    /*
     * 锁改记工作进程的 pid：从此刻起锁的持有者是它，不是 --start。
     * 启动时刻两种形态同一次取（EV-158）：缺省形态的取法不变，规范化形态是新字段；锁与 status.json 各写一份、同指这个 pid。
     * 锁的改写经 workerLockContent：lock.content 带着 --start 自己的规范化启动时刻，必须显式覆盖（计划 r2 D4）。
     * 非原子写：并发者撕裂读判 unparsable，由 acquireLock 的 2 s 新鲜度防御兜住、不回收（计划 r2 §7.5，代码双审 r1 CODEX-03）。
     */
    ({ legacy: workerStartedAt, canonical: workerStartedAtCanonical } = await processStartTimes(spawned.pid));
    await fs.writeFile(
      lock.path,
      JSON.stringify(
        workerLockContent(lock.content, {
          runId: rc.runId, pid: spawned.pid, startedAt: workerStartedAt, startedAtCanonical: workerStartedAtCanonical,
        }),
        null,
        2,
      ) + '\n',
      'utf8',
    );

    await patchStatus(rc.runDirBase, (s) => {
      s.worker_pid = spawned.pid;
      s.worker_started_at = workerStartedAt;
      s.worker_started_at_canonical = workerStartedAtCanonical;
      // 终态不得碾压（1.2.8 实测竞态）：桩侧极快时 worker 可能在本条身份记录落地之前就已完成并写下终态
      // （success/failed）——身份字段照补（--wait 与清扫此后都读它们），phase 若已终态就不再改回 running，
      // 否则刚完成的运行会被 --wait 按「running + 进程已退」判成 worker_lost（pid_gone）。
      if (!isTerminal(s.phase)) s.phase = 'running';
    });

    const waitTimeoutS = cfg.review.wait_timeout_s;
    return {
      runId: rc.runId,
      maxWaits: computeMaxWaits(
        cfg.review.timeout_s[rc.stage],
        waitTimeoutS,
        cfg.review.retry.transient_max,
      ),
      waitTimeoutS,
      bashTimeoutMs: bashTimeoutFor(waitTimeoutS),
      workerPid: spawned.pid,
      runDir: rc.runDirBase,
      warnings,
      /*
       * 开场播报要用的两项（审查意见 GLM-02）。skill 被要求在 --start 之后
       * 立刻告诉用户「两侧是谁、预算多久」，而这两项原先只有编排器知道：
       * 模型是 profile 与 --model-* 覆盖路由后的**请求值（尚未回读）**，让 skill 文档
       * 自己写死等于让它随配置漂移成错误播报。
       */
      stageTimeoutS: cfg.review.timeout_s[rc.stage],
      models: Object.fromEntries(
        Object.entries(rc.requests)
          .filter(([, r]) => r)
          .map(([c, r]) => [c, r!.model]),
      ) as Partial<Record<CriticId, string>>,
      reviewLoop: rc.meta.review_loop ?? null,
    };
  } catch (e) {
    /*
     * 子进程已诞生（EV-150）：worker 在跑，先终止它、按句柄确认退出，再回收闸门、收尾、处理 status.json、放锁。
     * 次序的要点是「终止在回收闸门之前」：反过来，孤儿收尾时 `expect: { runId }` 只比 run_id，
     * 会把刚回收成 idle 的本轮闸门置成待裁决（计划 r2 §2.2 / D4）。确认不了退出时一概不回收（D5）。
     */
    const born = spawnState.born;
    if (born) {
      await settleOrphanedStart({
        ctx, topic: rc.ref.topic, stage: rc.stage, runId: rc.runId, layout: rc.ref.layout,
        runDir: rc.runDirBase, lock, born, workerStartedAt, workerStartedAtCanonical, error: e,
      });
      throw e;
    }
    // prepareRun 之后、子进程诞生之前失败：闸门已经是 running，必须连它一起回收——排第一（见 meta.ts 通用体文档块的两种次序）
    await releaseRunningGate(ctx, rc.runId, rc.ref.topic, rc.stage);
    if (!childBorn) {
      /*
       * 子进程诞生之前失败：没有 worker；`--cancel` / `--wait` 要么拿不到身份，要么拿到身份却没有 pid、判「未确认退出」，
       * 本进程写完之后 run.json 又已是终态（前提 4 不追溯改写），所以不会有第二个写者（计划 r2 §3.5，代码双审 r1 CODEX-05）。
       * 收尾只有这一次机会，放锁排在收尾之后：放锁前把留痕写完。这段时间里新 `--start` 拿不到锁即退 70——
       * 本把运行锁获取时没带 run_id（run_id 只在派生之后随 worker pid 写进锁内容），`judgeStale` 的「运行已终态」判据用不上，
       * 持锁进程又活着；保守、无害。计划 r2 §3.3 写的「尾窗里新 --start 可按 runTerminal 接过锁」不成立（代码双审 r1 CODEX-02）。
       */
      const fin = await finalizeFailedRunMeta({
        layout: rc.ref.layout,
        stage: rc.stage,
        runId: rc.runId,
        lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000 },
        workerGone: true,
        termination: { by: 'prepare_exception', exit_code: exitCodeOf(e) },
      });
      for (const line of finalizeLines(fin, rc.runId, '准备阶段失败')) warn(line);
    }
    await lock.release();
    throw e;
  }
}

/**
 * 回收某次运行留下的 `running` 闸门（审查意见 GLM-r2-02 ≡ AGY-01）。
 *
 * `prepareRun` 一置 `running`，业务写锁就生效了。此后**三条异常路径**原先都不回收它：
 * worker 内 `executeRun` 中途抛错、`startRun` 在 prepareRun 之后失败、
 * `--wait` 判定 `worker_lost`。三种情况下闸门停在 `running`，同会话的业务写入
 * 一直被拦到 24h TTL——正是 `executeRun` 自己注释里写的
 * 「比不拦更糟，因为人会去改配置绕开 Hook」的形态。
 *
 * 对照：`workerMain` 的 finally 一直会释放主题**锁**。锁想到了，闸门漏了。
 *
 * 只回收仍记着本 `runId` 且仍是 `running` 的闸门：新一轮若已接管，那是它的护栏。
 * 不区分异常种类——没有 worker 接手的 `running` 一律回收。
 *
 * 实现在 `state.ts` 的 `releaseRunningGateEntry`（`prepareRun` 置闸门之后失败也用它，
 * 闸门拦截不留骨架计划 r2 §3.2）；这里只补「身份不全就不动」这一层，三处调用点不变。
 */
async function releaseRunningGate(
  ctx: Ctx,
  runId: string,
  topic: string | undefined,
  stage: Stage | undefined,
): Promise<void> {
  if (!topic || !stage) return;
  await releaseRunningGateEntry({
    triviumDir: ctx.triviumDir,
    topic, stage, runId,
    heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
  });
}

export interface OrphanedStartInput {
  ctx: Ctx;
  topic: string;
  stage: Stage;
  runId: string;
  layout: ArchiveLayout;
  runDir: string;
  /** `startRun` 开头拿到的运行锁（内容可能已被「锁改记工作进程的 pid」一段改写成 worker 的） */
  lock: LockHandle;
  born: { pid: number; watch: DetachedChildWatch };
  /** `startRun` 已取到的 worker 启动时刻；失败点在取到它之前为 null */
  workerStartedAt: string | null;
  /** `startRun` 已取到的 worker 规范化启动时刻（EV-158）；失败点在取到它之前、或取不到时为 null；缺省视同 null */
  workerStartedAtCanonical?: string | null;
  error: unknown;
  /** 单测注入：缺省按子进程句柄终止并确认（`terminateProcessGroup`，宽限 5 s、SIGKILL 后再等 5 s） */
  terminate?: () => Promise<{ gone: boolean; escalated: boolean; signals: NodeJS.Signals[] }>;
  /** 单测注入：缺省 `processStartTime` */
  startTimeOf?: (pid: number) => Promise<string | null>;
  /** 单测注入：缺省 `processStartTime(pid, { canonical: true })`（EV-158） */
  canonicalStartTimeOf?: (pid: number) => Promise<string | null>;
}

/**
 * `review --start` 在子进程诞生之后失败时的收尾（EV-150，派生后失败的孤儿worker计划 r2 §3.4）。
 *
 * 目标不变量：`--start` 非零退出 ⇔ 没有 worker 在跑，锁、闸门、留痕都已收拾好。按顺序：
 *   1. 终止 worker 所在的进程组，按父进程手里的子进程句柄确认退出（不依赖启动时刻，它可能取不到）；
 *   2. 确认不了退出（D5）：闸门、run.json、status.json 的 phase 一概不动——孤儿若还活着就是写者；只尽力把
 *      pid 与启动时刻补记进 status.json、把仍是本进程内容的锁改写成 worker 的，让 `--cancel` 找得到它、
 *      锁跟着它走（计划双审 r1 CODEX-02、AGY-01）。不放锁；
 *   3. 回收闸门——**排在终止之后**：反过来排，孤儿收尾时会把刚回收的闸门置成待裁决（D4）；
 *   4. 把 run.json 与登记收尾为 failed（`post_spawn_exception`）；run.json 已被 worker 写成终态的不追溯改写，只指路；
 *   5. status.json：已终态不动；run.json 属本进程收尾的落 failed；worker 已写 run.json 终态而 status.json 未到的、
 *      以及回读 run.json 读不出的，只补 pid、不落 phase（计划双审 r1 AGY-02 ≡ GLM-01；代码双审 r1 CODEX-03）；
 *   6. 放锁：`release()` 删仍是本进程内容的锁；已改写成本轮 worker 的，按 run_id + pid 复核后回收。
 *      锁已改写那一格，worker 被终止后新 `--start` 可按 pid_gone 当场接管——四道守卫保证两轮不串写
 *      （按 run_id 回收闸门、按 run_id 收尾、这里的双条件复核、reclaimStaleLock 的复验；计划双审 r1 CODEX-01 ≡ GLM-05）。
 * 每一步各自吞错、打 warn：调用方随即抛原错误，本函数不得改掉退出码。凭据副本不在这里抹（计划 r2 §3.4 末段）。
 */
export async function settleOrphanedStart(i: OrphanedStartInput): Promise<void> {
  const { ctx, born } = i;
  const heartbeatStaleMs = ctx.config.review.heartbeat_stale_s * 1000;
  const soft = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      warn(`${what}失败：${String((err as Error)?.message ?? err).split('\n')[0]}`);
    }
  };

  // 1. 终止并确认（Windows：先写取消标记，刚派生的 worker 若已装上 watcher 即走优雅收尾，设计 §7.1）
  await requestWorkerCancel(i.runDir);
  let t: { gone: boolean; escalated: boolean; signals: NodeJS.Signals[] } | null;
  try {
    t = await (i.terminate ?? (() => terminateProcessGroup(born.pid, {
      isGone: born.watch.hasExited, graceMs: WORKER_TERM_GRACE_MS, killWaitMs: ORPHAN_KILL_CONFIRM_MS,
    })))();
  } catch (err) {
    warn(`终止工作进程组 ${born.pid} 时出错：${String((err as Error)?.message ?? err).split('\n')[0]}`);
    t = null; // 发过哪些信号不得而知：下面只按句柄判退出，不再补「已终止」
  }
  const gone = t ? t.gone : born.watch.hasExited();
  /*
   * 播报按事实分句（代码双审 r1 CODEX-01 ≡ GLM-01）：一个信号都没发、发了却没确认退出、终止本身出错，
   * 都不能说成「已终止」——MANUAL 正教用户按这些字样分辨结局。
   */
  const sent = t?.signals.join('、') ?? '';
  if (t && gone && t.signals.length === 0) {
    warn(`--start 在派生工作进程之后失败：工作进程 ${born.pid} 在被终止之前已自行退出`);
  } else if (t && gone) {
    warn(`--start 在派生工作进程之后失败：已终止工作进程组 ${born.pid}（${sent}）`);
  } else if (t) {
    warn(`--start 在派生工作进程之后失败：已向工作进程组 ${born.pid} 发送 ${sent || '（无）'}，未能确认退出`);
  } else if (gone) {
    warn(`--start 在派生工作进程之后失败：工作进程 ${born.pid} 已退出（终止过程出错，见上一行）`);
  }

  // 2. 确认不了退出：留给它，不回收
  if (!gone) {
    const startedAt = i.workerStartedAt ?? (await (i.startTimeOf ?? processStartTime)(born.pid).catch(() => null));
    const startedAtCanonical =
      i.workerStartedAtCanonical ??
      (await (i.canonicalStartTimeOf ?? ((p: number) => processStartTime(p, { canonical: true })))(born.pid).catch(() => null));
    await soft('补记 status.json 的 worker_pid', () =>
      patchStatus(i.runDir, (s) => {
        s.worker_pid ??= born.pid;
        s.worker_started_at ??= startedAt;
        s.worker_started_at_canonical ??= startedAtCanonical;
      }),
    );
    /*
     * 改写锁的结果要记下来，末句按它说（代码双审 r1 GLM-01 第 2 点）：改写失败或锁已不归本进程时
     * 还说「已记在它名下」，恰在用户要照着手工处理的这条路上误导。
     */
    let lockOutcome: 'rewritten' | 'already_worker' | 'foreign' | 'failed' = 'failed';
    try {
      const cur = await inspectLock(ctx.triviumDir, i.topic);
      if (cur && cur.pid === i.lock.content.pid && cur.acquired_at === i.lock.content.acquired_at) {
        // 经 workerLockContent：i.lock.content 带着本进程的规范化启动时刻，必须显式覆盖（EV-158 计划 r2 D4）。
        // 非原子写，撕裂读由 acquireLock 的 2 s 新鲜度防御兜住（计划 r2 §7.5，代码双审 r1 CODEX-03）
        await fs.writeFile(
          i.lock.path,
          JSON.stringify(
            workerLockContent(i.lock.content, {
              runId: i.runId, pid: born.pid, startedAt, startedAtCanonical,
            }),
            null,
            2,
          ) + '\n',
          'utf8',
        );
        lockOutcome = 'rewritten';
      } else if (cur && cur.run_id === i.runId && cur.pid === born.pid) {
        lockOutcome = 'already_worker';
      } else {
        lockOutcome = 'foreign';
      }
    } catch (err) {
      warn(`把主题锁改记到工作进程名下失败：${String((err as Error)?.message ?? err).split('\n')[0]}`);
    }
    const lockLine =
      lockOutcome === 'rewritten' || lockOutcome === 'already_worker'
        ? '主题锁已记在它名下'
        : `主题锁${lockOutcome === 'foreign' ? '当前不归本进程也不归它' : '仍是本进程的内容'}——本进程退出后可能按 pid_gone 被回收，它若还活着会与新一轮并发`;
    warn(
      `工作进程 ${born.pid} 未能确认退出：闸门与归档 run.json 留给它（它若还活着就是写者），${lockLine}。` +
        `请 trivium review --cancel ${i.runId}，或手工结束进程组 ${born.pid} 之后 trivium review --wait ${i.runId}`,
    );
    return;
  }

  // 3. 回收闸门（终止之后）
  await soft('回收闸门', () =>
    releaseRunningGateEntry({ triviumDir: ctx.triviumDir, topic: i.topic, stage: i.stage, runId: i.runId, heartbeatStaleMs }),
  );

  // 4. 收尾 run.json 与登记（自身不抛）
  const fin = await finalizeFailedRunMeta({
    layout: i.layout, stage: i.stage, runId: i.runId,
    lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs },
    workerGone: true,
    termination: { by: 'post_spawn_exception', exit_code: exitCodeOf(i.error) },
  });
  for (const line of finalizeLines(fin, i.runId, '派生后启动未完成')) warn(line);
  const meta = await readRunMeta(i.layout, i.stage, i.runId).catch(() => null);
  /*
   * 回读读不出（`readRunMeta` 对读不到、不合契约都返回 null）是第三态，不并进「本进程收尾」：
   * 盘上可能是 worker 写下的终态，此时把 status.json 落成 failed 会与它结论相反（代码双审 r1 CODEX-03）。
   */
  const metaUnreadable = meta === null;
  const workerWroteTerminal =
    meta !== null && meta.status !== 'running' &&
    !(meta.status === 'failed' && meta.termination?.by === 'post_spawn_exception');
  const st = await readStatus(i.runDir);
  if (metaUnreadable) {
    warn(`归档 run-${i.runId}.json 读不出：status.json 的 phase 不替它下结论，请人工核对归档 run.json 与 task.json 的运行登记`);
  }
  if (workerWroteTerminal) {
    warn(
      st && isTerminal(st.phase)
        ? `工作进程在被终止之前已跑完：用 trivium review --wait ${i.runId} 取结果`
        : `工作进程在被终止之前已写下归档终态（${meta!.status}），审查文档已落盘，以归档 run.json 为准；` +
            `此时 --wait 会判失联（pid_gone），但不改写 run.json`,
    );
  }

  // 5. status.json：已终态不动
  if (st && !isTerminal(st.phase)) {
    await soft('写 status.json 终态', () =>
      patchStatus(i.runDir, (s) => {
        if (isTerminal(s.phase)) return;
        s.worker_pid ??= born.pid;
        s.worker_started_at ??= i.workerStartedAt;
        s.worker_started_at_canonical ??= i.workerStartedAtCanonical ?? null;
        if (workerWroteTerminal || metaUnreadable) return; // phase 该由 worker 写 / 读不出，本进程不替它下结论
        s.phase = 'failed';
        s.exit_code = exitCodeOf(i.error);
        s.message = `启动未完成：已终止工作进程 ${born.pid}`;
      }),
    );
  }

  // 6. 放锁
  await soft('释放主题锁', () => i.lock.release());
  await soft('回收已改记到工作进程名下的主题锁', async () => {
    const cur = await inspectLock(ctx.triviumDir, i.topic);
    if (cur && cur.run_id === i.runId && cur.pid === born.pid) {
      await reclaimStaleLock(i.lock.path, cur);
    }
  });
}

/**
 * `--cancel` 主路径「工作进程已退出」的判据（`terminateProcessGroup` 的 `isGone`）：不存活，**或不是同一进程**
 * （EV-150，计划双审 r1 AGY-04，用户审批并入）；**活着而取不到启动时刻 ⇒ `'unverifiable'`**（EV-176，取消宽限期判不了仍放锁
 * 计划 r2 D2）。
 *
 * 只看存活的话，宽限期内 PID 若被复用，会把复用者当成 worker、升级 SIGKILL；而 `kill(-pid)` 在复用者不是组长时
 * ESRCH、退回 `kill(pid)`，信号就打到了无关进程。「判不了」此前并入「不是同一进程」算已退出：发 SIGTERM 之前的首检取不到
 * 就一个信号都不发、宽限期里取不到就停止升级，而收尾照样写 cancelled、回收锁与闸门——活 worker 脱锁（EV-176 探针 Z1 / G1 / G2）。
 * 现在三态分开：`same` ⇒ false、`different`（不在，或取到了且不符）⇒ true，与此前逐字相同；`unverifiable` 交给
 * `terminateProcessGroup` 按「不算已退出、也不对它发下一个信号」处置，`cancelRun` 见 `!t.gone` 即不收尾、以 69 退出。
 * 身份按 status.json 的记录比（`processMatchesRecord`，EV-158）：有规范化启动时刻只按它比，与主路径判存活那一处同一份记录。
 */
export async function workerGoneForCancel(pid: number, rec: RecordedStart): Promise<GoneJudgment> {
  const p = await processMatchesRecord(pid, rec);
  if (p.identity === 'unverifiable') return 'unverifiable';
  return !p.alive || !p.sameProcess;
}

// ─────────────────────── 按记录结束审查员 CLI（EV-154） ───────────────────────

export interface RecordedCliGroupOutcome {
  side: CriticId;
  pgid: number;
  verdict: CliGroupVerdict;
  /** 实际发过的信号（按发出顺序）；只有判 alive 的组才会发 */
  signals: NodeJS.Signals[];
  /** 组长已确认退出（没发信号的组：verdict 为 gone 时为真） */
  gone: boolean;
  /** 收尾后该组号下仍有的非僵尸成员数（组长已退出而组员还在，计划双审 r1 GLM-01）；没发信号或取不到时为 null */
  membersLeft: number | null;
}

export interface RecordedCliOutcome {
  groups: RecordedCliGroupOutcome[];
  /** status.json 里 cli 键在而形状读不懂的侧（GLM-02）：不发信号 */
  malformed: CriticId[];
  /** 形状坏的侧读到的原始值（截断），播报时如实带出（代码双审 r1 CODEX-04） */
  malformedRaw: Partial<Record<CriticId, string>>;
}

/**
 * 按 status.json 的逐侧记录结束审查员 CLI 进程组（EV-154，CLI进程组记录计划 r2 §4.4）。`--cancel` 在 worker 跑不到
 * 自己的 SIGTERM 处理器的那几格用它：worker 被升级 SIGKILL、worker 此前已不在（含 status 已被 `--wait` 判失联写成终态）。
 *
 * - **对判 `alive` 或 `orphaned` 的组发信号**（EV-165 起：组长活着且规范化启动时刻相符，或组长已退出但组号下还有
 *   非僵尸成员——两者都通过组号仍然有效）；`reused` / `unverifiable` / `orphan_unverifiable` / 形状坏的一个信号都不发。
 * - 宽限链与 worker 处理器同一组常量（`WORKER_TREE_GRACE_MS` → SIGKILL → `WORKER_TREE_KILL_WAIT_MS`，用户决策 5），
 *   `isGone` 每次发信号前复核组长与启动时刻；各组并行（串行时两组都忽略 SIGTERM 会让耗时翻倍，EV-152 AGY-05）。
 * - **`isGone` 只认 `gone` 与 `reused`**（代码双审 r1 GLM-01）：入判 `alive` 或 `orphaned` 时身份已确认，轮询中组号
 *   仍有非僵尸成员就不可能被复用（EV-165 实测），此时 `unverifiable` / `orphan_unverifiable` 只意味着 `ps` 这一次
 *   没取到，继续按原链升级；原先写成 `!== 'alive'`，`ps` 瞬时失败会提前收手、不升级 SIGKILL，随后「组长已退出」的
 *   告警与事实不符。入判就不是 `alive`/`orphaned` 的记录在上面一步已返回，一个信号都不发。
 * - **`alive` 来源不再只按组长判**（EV-165 前的旧语义：组长服从 SIGTERM 即判终止条件成立、不管组员；代码双审 r1
 *   AGY-02≡GLM-01 核出这句旧文案残留自相矛盾，已改准）：组长退出但组员仍在非僵尸存活时，`judge` 现在返回 `orphaned`
 *   而不是 `gone`，`isGone`（只认 `gone`/`reused`）仍为假，宽限耗尽会继续升级到 SIGKILL 直至成员归零——组长退出、
 *   组员忽略 SIGTERM 不再是终止条件。对 `orphaned` 来源（组长一开始就不在），`isGone` 等的同样是成员数归零（`gone`）
 *   或组号被复用（`reused`，理论上因组员仍在而不会发生，见 EV-165 实测）。收尾后数一次组成员，交给调用方如实报——
 *   组员仍未清零（宽限耗尽仍未确认退出）时走既有「未能确认退出」告警。
 */
export async function terminateRecordedCliGroups(
  s: RunStatus | null,
  o: {
    signal?: (pid: number, sig: NodeJS.Signals) => boolean;
    graceMs?: number;
    killWaitMs?: number;
    pollMs?: number;
    /** 判定实现，缺省 `judgeCliGroup`；只为单测模拟「ps 瞬时失败」而开（GLM-01） */
    judge?: (r: CliGroupRecord) => Promise<CliGroupVerdict>;
  } = {},
): Promise<RecordedCliOutcome> {
  const { records, malformed } = cliRecordsOf(s);
  const judge = o.judge ?? judgeCliGroup;
  const groups = await Promise.all(
    records.map(async (r): Promise<RecordedCliGroupOutcome> => {
      const verdict = await judge(r);
      if (verdict !== 'alive' && verdict !== 'orphaned') {
        return { side: r.side, pgid: r.pgid, verdict, signals: [], gone: verdict === 'gone', membersLeft: null };
      }
      const t = await terminateProcessGroup(r.pgid, {
        isGone: async () => {
          const v = await judge(r);
          return v === 'gone' || v === 'reused';
        },
        graceMs: o.graceMs ?? WORKER_TREE_GRACE_MS,
        killWaitMs: o.killWaitMs ?? WORKER_TREE_KILL_WAIT_MS,
        pollMs: o.pollMs ?? 250,
        ...(o.signal ? { signal: o.signal } : {}),
      });
      const membersLeft = t.gone ? await processGroupMemberCount(r.pgid) : null;
      return { side: r.side, pgid: r.pgid, verdict, signals: t.signals, gone: t.gone, membersLeft };
    }),
  );
  const malformedRaw: Partial<Record<CriticId, string>> = {};
  for (const side of malformed) malformedRaw[side] = rawCliOf(s, side);
  return { groups, malformed, malformedRaw };
}

/**
 * 按事实播报 `terminateRecordedCliGroups` 的结果（step / warn 都写 stderr）。
 * `quietWhenEmpty`：终态早退分支里一条记录都没有时不出声，那一支原有的输出保持逐行不变。
 */
function reportRecordedCliGroups(r: RecordedCliOutcome, quietWhenEmpty: boolean, runDir: string): void {
  if (r.groups.length === 0 && r.malformed.length === 0) {
    if (!quietWhenEmpty) {
      warn(
        'status.json 里没有在跑的审查员 CLI 记录——CLI 已先结束，或派生后来不及记下；后者本命令够不到，' +
          '请用 ps 核对 ppid 为 1 的 CLI 进程（设计 7.5「审查员 CLI 进程组记录」的如实保留清单）',
      );
    }
    return;
  }
  for (const g of r.groups) {
    if (g.verdict === 'gone') continue; // 记录是旧的，CLI 已自己结束
    if (g.verdict === 'reused') {
      step(`${g.side} 侧记录的进程组 ${g.pgid} 已被别的进程占用，不发信号`);
      continue;
    }
    if (g.verdict === 'unverifiable') {
      warn(`${g.side} 侧审查员 CLI 进程组 ${g.pgid} 的启动时刻没记下，判不了是不是同一进程，不发信号——请用 ps 核对`);
      continue;
    }
    if (g.verdict === 'orphan_unverifiable') {
      warn(`${g.side} 侧审查员 CLI 进程组 ${g.pgid} 的组长已退出，组里的非僵尸成员数取不到，判不了是否还有遗留，不发信号——请用 ps 核对`);
      continue;
    }
    step(`按记录结束审查员 CLI：${g.side} 侧进程组 ${g.pgid}（${g.signals.join('、') || '未发信号'}）`);
    if (!g.gone) warn(`${g.side} 侧审查员 CLI 进程组 ${g.pgid} 未能确认退出——请用 ps 核对`);
    else if (g.membersLeft !== null && g.membersLeft > 0) {
      warn(
        `${g.side} 侧审查员 CLI 进程组 ${g.pgid} 的组长已退出，组里还有 ${g.membersLeft} 个成员，未对它们发信号——请用 ps 核对`,
      );
    }
  }
  for (const side of r.malformed) {
    // 带上定位与原始值（代码双审 r1 CODEX-04）：这一格不自愈，出口只有人把该侧 cli 改回 null——到期整删也保留它（EV-157）
    warn(`${side} 侧的 CLI 记录读不懂（${r.malformedRaw[side] ?? '?'}，${path.join(runDir, RUN_DIR_FILES.status)}），不发信号——请用 ps 核对`);
  }
}

/**
 * 已确认结束、可以从 status.json 清掉的侧记录（AGY-02）：判 gone 的，或发过信号后组长（`alive` 来源）／组号
 * （`orphaned` 来源）确认清空且组里没有遗留成员的。
 *
 * **已与凭据准入的口径收口**（EV-165）：`judgeCliGroup` 现在同时判组长与非僵尸成员数，`orphaned` 与准入侧的
 * `cliGroupsConfirmedGone` 用的是同一个判据，不再像 EV-154 时那样「组长已退、组员仍在」被准入放行、这里却要
 * 求成员归零才清记录——两处现在口径一致：只有组真的确认清空（`gone`）才会既放行抹除凭据、也清掉记录。
 */
function settledCliSides(r: RecordedCliOutcome | null): Map<CriticId, number> {
  const m = new Map<CriticId, number>();
  for (const g of r?.groups ?? []) {
    if (g.verdict === 'gone' || ((g.verdict === 'alive' || g.verdict === 'orphaned') && g.gone && g.membersLeft === 0)) {
      m.set(g.side, g.pgid);
    }
  }
  return m;
}

// ─────────────────────── worker ───────────────────────

/**
 * 装上 worker 的 SIGTERM 处理器，返回卸载函数（EV-152，取消够不到审查员CLI计划 r2 §4.2）。
 * `workerMain` 第一行装、`finally` 卸；U9 在子进程里直接装它。
 *
 * 为什么要它：适配器以 `killTree` 拉起的厂商 CLI 自成进程组，`--cancel` 按 worker 的组发的 SIGTERM 到不了它们；
 * 没有处理器时 worker 按缺省动作立刻死掉，CLI 过继给 init、超时计时器随 worker 一起没了，静默阶段的 CLI 会一直跑、
 * 配额照烧（计划 r2 §2.2）。处理器：
 *   1. 只处理第一次（`process.on` + 进门标志，不用 `once`：第二次 SIGTERM 若走缺省动作，会在转发中途把 worker 杀掉）；
 *   2. 起看门狗，预算 `WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 500` ms，到点无条件退出；
 *   3. `shutdownTrackedTrees`：冻结经 `run()` 的链路，并行按组终止登记的 CLI（按父进程句柄判退出），结果写 worker.log；
 *   4. `exitOnce`：防重入 → 清看门狗 → 移除监听 → 以 SIGTERM 重新自杀（退出形态与今天相同）→ 1 s 后仍在才 `exit(143)`。
 * 保证范围：自处理器首行起经 `run()` 的链路不再推进。信号到达与处理器执行之间至多一次事件循环迭代，其间已就绪的回调
 * 可先行——今天（缺省动作）这段窗口为零，落在归档终态写入最后一步上时归档可能不是 cancelled（计划 r2 §4.4 a″，如实保留）。
 * worker 被 SIGKILL、崩溃或事件循环堵住时处理器跑不到（覆盖矩阵 b / c / d 格）。
 */
/**
 * worker 优雅取消的公共主体（Windows 移植自 `installWorkerSigtermForwarding` 抽出，设计 §7.1）：
 * 只处理第一次、起看门狗、`shutdownTrackedTrees` 按组终止登记的 CLI（按父进程句柄判退出）、
 * 结果写 worker.log、随后以 143 形态退出。POSIX 由 SIGTERM 处理器触发；Windows 由取消标记 watcher 触发
 * （win32 跨进程发不出可捕获 SIGTERM，TerminateProcess 即强杀，处理器跑不到）。
 *
 * `detach` 在退出前调用（SIGTERM 形态必须先摘掉自己的监听器——监听器还在时 `kill(self, SIGTERM)`
 * 只会再次进本控制器并被 `handling` 挡住，缺省处置不恢复、进程死不掉；原实现里这是 exitOnce 的第一步）。
 * 两个入口各自构造一份，一次性状态互不干扰；`began()` 供卸载判据用（原 `handling` 标志的等价物）。
 */
function makeWorkerShutdownController(o: { detach: () => void }): { began(): boolean; begin(trigger: string): void } {
  let handling = false;
  let exiting = false;
  let detached = false;
  let watchdog: NodeJS.Timeout | undefined;
  const detachOnce = (): void => {
    if (detached) return;
    detached = true;
    o.detach();
  };
  const exitOnce = (): void => {
    if (exiting) return;
    exiting = true;
    if (watchdog) clearTimeout(watchdog);
    if (IS_WIN) {
      // Windows 无信号式终止：直接以 143 退出（POSIX 侧先重发 SIGTERM 走缺省处置、退出形态为信号终止）
      process.exit(143);
    }
    detachOnce();
    process.kill(process.pid, 'SIGTERM');
    // 病态兜底：移除最后一个监听后缺省处置应已恢复、上一行即结束进程（计划 r2 §2.5 实测）；不同步调用
    setTimeout(() => process.exit(143), 1000);
  };
  return {
    began: () => handling,
    begin(trigger: string): void {
      if (handling) return;
      handling = true;
      watchdog = setTimeout(exitOnce, WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 500);
      void (async () => {
        try {
          const r = await shutdownTrackedTrees({ graceMs: WORKER_TREE_GRACE_MS, killWaitMs: WORKER_TREE_KILL_WAIT_MS });
          if (r.groups.length === 0) {
            process.stderr.write(`[worker] 收到 ${trigger}：没有在跑的审查员 CLI\n`);
          } else {
            const seq = r.groups.map((g) => `${g}（${(r.signals[g] ?? []).join('、') || '无'}）`).join('，');
            process.stderr.write(`[worker] 收到 ${trigger}：已按组终止审查员 CLI ${seq}\n`);
            if (r.remaining.length > 0) process.stderr.write(`[worker] 未能确认退出：${r.remaining.join('，')}\n`);
          }
        } catch (e) {
          process.stderr.write(`[worker] 转发 ${trigger} 出错：${(e as Error)?.message ?? String(e)}\n`);
        } finally {
          exitOnce();
        }
      })();
    },
  };
}

export function installWorkerSigtermForwarding(): () => void {
  const onTerm = (): void => shutdown.begin('SIGTERM');
  const shutdown = makeWorkerShutdownController({ detach: () => process.removeListener('SIGTERM', onTerm) });
  process.on('SIGTERM', onTerm);
  return () => {
    if (!shutdown.began()) process.removeListener('SIGTERM', onTerm);
  };
}

/**
 * Windows 的 worker 取消标记 watcher（设计 §7.1）：250 ms 轮询 `<runDir>/cancel.requested`，
 * 出现即触发与 SIGTERM 同一条优雅取消链。POSIX 上不装——SIGTERM 可达，多一层轮询只会
 * 改变 macOS 行为。返回卸载函数。
 *
 * **只认比自己启动更晚写入的标记**：`--cancel` 写下的标记不随运行清除，而
 * `review --worker <id>` 可被人工对同一 run 重启——陈旧标记必须忽略，否则重启的 worker
 * 不跑业务逻辑、一律以 143 收场（access-v3 提前取消用例钉住这一格）。
 *
 * 基线取「安装时刻 − 保守回退量」（1.2.2，审查 CLAUDE-02）：spawn（onSpawned 记诞生）到
 * 本函数安装之间隔着模块全量加载，窗口内写入的旗标（`--start` 派生失败收尾、极快的
 * `--cancel`）按安装时刻判旧会被永久忽略，worker 丢优雅收尾只剩硬杀；回退量同时覆盖
 * FAT/exFAT 的 2 秒级 mtime 粒度。判旧的旗标留一条 stderr 痕迹（worker.log 收集），
 * 「旗标被吞」不再无从排查。
 */
export const CANCEL_FLAG_BASELINE_BACKOFF_MS = 15_000;

export function installWorkerCancelFlagWatcher(runDir: string): () => void {
  let stopped = false;
  const baselineMs = Date.now() - CANCEL_FLAG_BASELINE_BACKOFF_MS;
  let staleNoted = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void fs.stat(cancelRequestPath(runDir)).then((st) => {
      if (stopped) return;
      if (st.mtimeMs < baselineMs) {
        if (!staleNoted) {
          staleNoted = true;
          process.stderr.write(`[worker] 取消旗标存在但 mtime 早于基线（回退量 ${CANCEL_FLAG_BASELINE_BACKOFF_MS}ms），按陈旧忽略\n`);
        }
        return;
      }
      stopped = true;
      shutdown.begin('取消标记（cancel.requested）');
    }).catch(() => undefined);
  }, 250);
  timer.unref();
  const shutdown = makeWorkerShutdownController({ detach: () => {
    stopped = true;
    clearInterval(timer);
  } });
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * 前台入口的中断转发（EV-155）：同步 `review --stage`、`doctor`、`preflight` 在前台进程里以 `killTree` 拉起审查员 CLI /
 * 探针子进程，它们自成进程组，终端 Ctrl-C 的 SIGINT 够不到；不装处理器时前台进程按缺省处置退出，子进程过继给 init、
 * 超时计时器随之没了（零配额实测见 `doc/05_testing/evidence/foreground-interrupt-20261006/`）。处理器：
 *   1. 接 SIGINT 与 SIGTERM，只处理第一次；本进程没有登记中的进程树时立即以同一信号重新自杀（与缺省处置同形）；
 *   2. 有登记树时播报一行、起看门狗，`shutdownTrackedTrees` 按组结束它们（参数同 worker 处理器），然后以同一信号重新自杀；
 *   3. 第二次信号不再等，立即退出（用户坚持要走，CLI 可能留下——播报里写明）。
 * `shutdownTrackedTrees` 的契约是「调用即进入终止中、调用方必须随后退出」：本处理器调用后必定退出，满足它。
 * worker 不装（它有自己的 SIGTERM 处理器 `installWorkerSigtermForwarding`）。中断后的留痕（run.json 仍为 running）不在这里收：同步路径已把 run_id 写进主题锁，由同主题下一次取锁回收遗留锁时收（`settleReclaimedRunLocks`，EV-151）。
 */
export function installForegroundInterruptForwarding(): () => void {
  const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  let handling = false;
  let exiting = false;
  let received: NodeJS.Signals = 'SIGINT';
  let watchdog: NodeJS.Timeout | undefined;
  const exitOnce = (): void => {
    if (exiting) return;
    exiting = true;
    if (watchdog) clearTimeout(watchdog);
    for (const s of SIGNALS) process.removeListener(s, onSignal);
    process.kill(process.pid, received);
    // 病态兜底：移除监听后缺省处置应已恢复、上一行即结束进程；不同步调用
    setTimeout(() => process.exit(received === 'SIGINT' ? 130 : 143), 1000);
  };
  const onSignal = (sig: NodeJS.Signals): void => {
    if (handling) {
      exitOnce();
      return;
    }
    handling = true;
    received = sig;
    if (trackedTrees().length === 0) {
      exitOnce();
      return;
    }
    const budgetMs = WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 500;
    watchdog = setTimeout(exitOnce, budgetMs);
    process.stderr.write(
      `收到 ${sig}：正在结束本进程拉起的审查员 CLI（至多约 ${Math.ceil(budgetMs / 1000)} s；再按一次立即退出，CLI 可能留下）\n`,
    );
    void (async () => {
      try {
        const r = await shutdownTrackedTrees({ graceMs: WORKER_TREE_GRACE_MS, killWaitMs: WORKER_TREE_KILL_WAIT_MS });
        if (r.remaining.length > 0) process.stderr.write(`未能确认退出的进程组：${r.remaining.join('，')}\n`);
      } catch (e) {
        process.stderr.write(`结束审查员 CLI 时出错：${(e as Error)?.message ?? String(e)}\n`);
      } finally {
        exitOnce();
      }
    })();
  };
  for (const s of SIGNALS) process.on(s, onSignal);
  return () => {
    if (!handling) for (const s of SIGNALS) process.removeListener(s, onSignal);
  };
}

/**
 * `review --worker <runId>`：工作进程本体。**不应由人直接调用**。
 *
 * 它继承 `--start` 已经冻结好的送审包，跑完 `executeRun` 后写终态并释放锁。
 */
export async function workerMain(ctx: Ctx, runId: string): Promise<number> {
  // 第一件事装 SIGTERM 处理器（EV-152）：此后以 killTree 拉起的 CLI 都在它的登记里
  const uninstallSigterm = installWorkerSigtermForwarding();
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  /*
   * Windows：跨进程 SIGTERM 到不了 worker，取消改由标记文件触发（设计 §7.1）；POSIX 上不装。
   * 安装前先物理清除可能遗留的标记（win32 实测，Bug 清单 §3.1 第 13 条）：`--cancel` 写下的标记不随运行清除，
   * `review --worker` 对同一 run 人工重启时，仅靠 watcher 的 mtime 回退判新旧的窗口（15 s）在慢机器上不够——
   * 从上轮取消到本轮重启不足回退量时，陈旧标记被当新标记，重启的 worker 不跑业务逻辑、一律以 143 收场。
   * 重启语义本就该清场：此刻之前的标记都是对上一轮 worker 的，删掉不影响此后写入的新标记（watcher 仍认得到）。
   */
  if (IS_WIN) await fs.rm(cancelRequestPath(runDir), { force: true }).catch(() => undefined);
  const uninstallCancelWatch = IS_WIN ? installWorkerCancelFlagWatcher(runDir) : null;
  /*
   * CLI 进程组记录（EV-154，CLI进程组记录计划 r2 §4.3）：liveTrees 一变（派生、取到启动时刻、退出）就把它的投影写进
   * status.json 的 sides[c].cli。必须在任何 CLI 派生之前装上；投影在 mutate 里现取，写下去的总是那一刻的登记。
   * 不挪进 SIGTERM 处理器：终止中 run() 悬空，取启动时刻的 ps 跑不完（用户决策 3）。
   */
  const unwatchTrees = watchTrackedTrees(() => {
    patchStatus(runDir, (s) => syncCliRecords(s, trackedTrees())).catch((e: unknown) => {
      if (process.env['TRIVIUM_DEBUG']) console.error('[cli-record]', e);
    });
  });
  const heartbeat = setInterval(() => {
    // 只刷心跳，不改语义。--wait 靠它判定「还活着」。
    // 必须 catch：Node ≥ 18 默认 unhandled rejection 即崩，磁盘满 / 目录被删时
    // 一次心跳写失败就会在两侧配额中段把整个 worker 炸掉
    patchStatus(runDir, () => {}).catch((e: unknown) => {
      if (process.env['TRIVIUM_DEBUG']) console.error('[heartbeat]', e);
    });
  }, WORKER_HEARTBEAT_MS);

  try {
    const rc = await rebuildContext(ctx, runId);
    await patchStatus(runDir, (s) => {
      s.phase = 'running';
      for (const c of rc.sides) if (s.sides[c]) s.sides[c]!.state = 'running';
    });

    /*
     * 逐侧进展回写（审查意见 AGY-01）。
     *
     * 没有它时，等待期的 status.json 从头到尾只有上面那次「两侧 running」，
     * 直到下面写终态——`--wait` 每次返回的两侧状态恒定不变，「一侧先跑完」
     * 与「正在重试」这些用户最想知道的事一个也看不见。
     *
     * 回调是同步的而 patchStatus 是异步的：不 await，靠 patchStatus 自身按
     * runDir 串行化的 promise 链保序（status.ts 的 patchQueues）。
     * 失败由 runner 的 emitProgress 吞掉，不连累审查。
     */
    rc.onSideProgress = (critic, p) => {
      void patchStatus(runDir, (s) => {
        const side = s.sides[critic];
        if (!side) return;
        if (p.state !== undefined) side.state = p.state;
        if (p.attempt !== undefined) side.attempt = p.attempt;
        if (p.elapsed_s !== undefined) side.elapsed_s = p.elapsed_s;
        if (p.note !== undefined) side.note = p.note;
        // 作废重跑（EV-225）：只置真、不清，等待预算据它追加一份
        if (p.voidRerun === true) side.void_rerun = true;
      });
    };

    const outcome = await executeRun(rc);

    await patchStatus(runDir, (s) => {
      s.phase = outcome.exitCode === EXIT.OK ? 'success' : 'failed';
      s.exit_code = outcome.exitCode;
      s.artifacts = outcome.artifacts;
      s.message = outcome.warnings.length > 0 ? outcome.warnings.join(' ｜ ') : null;
      /*
       * 写**真实**的逐侧状态，不是一律 'ok'。
       *
       * 硬编码 'ok' 会让一侧非零退出时，`--wait` / `--status` 仍显示
       * 「gemini: ok」，而 run.json 里明明是 failed——操作者据此以为两侧都跑成了，
       * 直到去翻元数据才发现相反。实测踩到过一次。
       */
      for (const c of rc.sides) {
        const side = s.sides[c];
        if (side) side.state = outcome.sideStatuses[c] ?? 'failed';
      }
    });
    return outcome.exitCode;
  } catch (e) {
    const msg = e instanceof TriviumError ? e.message : `工作进程异常：${(e as Error).message}`;
    const exitCode = exitCodeOf(e);
    fail(msg);
    /*
     * 归档侧收尾（EV-142，计划 r2 §3.2）：把仍为 running 的 run.json 收尾为 failed，并同步 task.json 的运行登记。
     *
     * - `workerGone: true`：此刻的写者就是 worker 自己；另两个事后写者（`--cancel`、`--wait` 判失联）都要求确认 worker
     *   已退出才写，worker 活着的这段时间里它是唯一写者。
     * - 仍为 running 才写（函数内前提 4）：异常可能晚于 executeRun 收尾时的 run.json 终态写入（其后的 registerRun /
     *   闸门写入 / 播报都可能抛），那时 run.json 已是 success / failed，不追溯改写。
     * - **排在 patchStatus 之前**：worker 若死在两次写之间，status.json 仍非终态，之后 `--wait` 判 pid_gone 会补齐；
     *   反过来排，`--wait` 按终态直接返回、`--cancel` 终态早退，run.json 永远停在 running（与 EV-128 同一理由）。
     * 结果追加进 status.json 的 message：worker.log 没人看，`--wait --json` 会原样带出 message。
     */
    const notes: string[] = [];
    const st0 = await readStatus(runDir);
    const id0 = st0 ? { topic: st0.topic, stage: st0.stage } : await readHandoffIdentity(runDir);
    if (id0) {
      const fin = await finalizeFailedRunMeta({
        layout: { archiveRoot: ctx.archiveRoot, topic: id0.topic },
        stage: id0.stage,
        runId,
        lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000 },
        workerGone: true,
        termination: { by: 'worker_exception', exit_code: exitCode },
      });
      notes.push(
        describeFinalizeStep(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 failed`, `归档 run-${runId}.json 未回写`),
        describeFinalizeStep(fin.task, '已把 task.json 的运行登记同步为 failed', 'task.json 的运行登记未改'),
      );
    }
    // 终态必须写下来，否则 --wait 只能等到心跳过期才判失联
    await patchStatus(runDir, (s) => {
      s.phase = 'failed';
      s.exit_code = exitCode;
      s.message = [msg, ...notes].join(' ｜ ');
    });
    return exitCode;
  } finally {
    // 收到 SIGTERM 且有 CLI 在跑时本函数被冻结、走不到这里；没有 CLI 时进程在处理器的微任务里就结束了——卸载不会抢在转发之前
    uninstallSigterm();
    uninstallCancelWatch?.();
    unwatchTrees();
    clearInterval(heartbeat);
    const st = await readStatus(runDir);
    // status 读不到（被清理工具删了）时从交接文件取身份，否则锁与闸门都漏回收
    const id = st ? { topic: st.topic, stage: st.stage } : await readHandoffIdentity(runDir);
    /*
     * 闸门与锁一起回收。executeRun 正常收尾时已把闸门置成终态，
     * 此处的 expect 会因状态不再是 running 而跳过；只有异常路径才真正命中。
     */
    await releaseRunningGate(ctx, runId, id?.topic, id?.stage);
    // 释放锁：工作进程是最终持有者
    const cur = await inspectLock(ctx.triviumDir, id?.topic ?? '');
    if (cur && cur.pid === process.pid) {
      await fs.rm(lockPathFor(ctx.triviumDir, cur.topic), { force: true });
    }
  }
}

// ─────────────────────── --wait / --status / --cancel ───────────────────────

export interface WaitOutcome {
  exitCode: number;
  status: RunStatus | null;
  /** 人读进度，供 skill 原样转述 */
  progress: string;
  /**
   * 单行摘要，供 skill **原样念给用户**。
   *
   * `status` 为 null（窗口用尽且全程无有效心跳）时退化为与 `progress` 同一句
   * 启动提示——渲染要 RunStatus，那时没有（审查意见 AGY-05 ≡ GLM-06）。
   */
  progressBrief: string;
  /** 本次渲染用的预算参数，供 CLI 透出结构化字段 */
  budget: ProgressBudget;
  /**
   * 算好的结构化进度，CLI **原样透出**、不再自算（审查意见 GLM-05）。
   * `status` 为 null 时为 null。
   */
  view: ProgressView | null;
}

/**
 * 从配置装配进度预算。`--wait` 与 `--status` 共用，两处显示的期待值才会一致。
 *
 * `waitTimeoutS` 可显式传入**本次实际生效的窗口**：`--timeout` 能覆盖配置值，
 * 而「第 N/M 次等待」若还按配置窗口算，就与用户看到的等待节奏脱节（审查意见 AGY-02）。
 */
export function budgetFor(cfg: Config, stage: Stage, waitTimeoutSOverride?: number): ProgressBudget {
  const waitTimeoutS = waitTimeoutSOverride ?? cfg.review.wait_timeout_s;
  return {
    stageTimeoutS: cfg.review.timeout_s[stage],
    waitTimeoutS,
    maxWaits: computeMaxWaits(cfg.review.timeout_s[stage], waitTimeoutS, cfg.review.retry.transient_max),
  };
}

/**
 * `review --wait <runId> --timeout <s>`：轮询到完成或超出本次窗口。
 *
 * 返回 `73`（仍在运行）不是失败——skill 应打印进度后继续下一次 `--wait`。
 */
export async function waitRun(ctx: Ctx, runId: string, timeoutS: number): Promise<WaitOutcome> {
  const cfg = ctx.config;
  const runDir = runDirFor(cfg, ctx.projectRoot, runId);
  if (!(await exists(runDir))) {
    throw missingArtifact(`找不到运行 ${runId} 的运行目录：${runDir}`);
  }

  // status.json 尚未出现时的兜底 pid 来源
  let fallbackPid: number | null = null;
  try {
    fallbackPid = Number.parseInt(await fs.readFile(workerPidPath(runDir), 'utf8'), 10) || null;
  } catch {
    fallbackPid = null;
  }

  /*
   * 预算要按**本次运行的阶段**取（plan/code/bug 的超时差一倍以上）。status.json
   * 还没落地时从交接文件取身份——它在 `--start` 的同步窗口里就写好了，比 status 早。
   */
  const stage0 =
    (await readStatus(runDir))?.stage ?? (await readHandoffIdentity(runDir))?.stage ?? 'plan';
  // 用**本次实际生效**的窗口，而不是配置值——`--timeout` 能覆盖它（AGY-02）
  const budget = budgetFor(cfg, stage0, timeoutS);

  const deadline = Date.now() + timeoutS * 1000;
  const pollMs = 2000;
  let last: RunStatus | null = null;

  for (;;) {
    const reading = await interpretStatus(runDir, {
      heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
      fallbackPid,
    });

    if (reading.kind === 'terminal') {
      const code = reading.status.exit_code ?? EXIT.OK;
      // 同一刻算出文字与字段，两者不会在秒边界互相打架
      const at = Date.now();
      // 预算按刚读到的 status 现算：某侧作废重跑时追加一份（EV-225）
      const b = budgetForStatus(budget, reading.status);
      return {
        exitCode: code,
        status: reading.status,
        progress: renderProgress(reading.status, at, b),
        progressBrief: renderProgressBrief(reading.status, at, b),
        budget: b,
        view: progressViewOf(reading.status, at, b),
      };
    }
    if (reading.kind === 'worker_lost') {
      /*
       * 归档侧收尾（EV-142，计划 r2 §3.3）：确认工作进程已退出时，把仍为 running 的 run.json 收尾为 failed。
       *
       * **用改写 status.json 之前的事实判「已退出」**：此刻 phase 非终态，`workerConfirmedGone` 走不到
       * 「终态且从未记下 pid」那一支，判「已退出」只剩「有 pid 且进程确已不在」一种依据。下面抹凭据副本前的
       * `scrubAdmission(meta0, …)`（worker 一半即 `workerConfirmedGone`）那次判定读的是本函数自己刚写成 failed 的 status.json，拿不到 pid 时会下「已不在」的结论——那次只管抹凭据副本（EV-20），不动它。
       * status.json 读不到而 worker.pid 已知时（worker 在第一次写 status.json 之前就死了），`workerConfirmedGone(null)`
       * 首行即判「否」、不看 worker.pid，而 `interpretStatus` 正是拿 worker.pid 判出「已死」才报 pid_gone——
       * 证据在手，这里用同源的 `processAlive` 单独判（计划双审 r1 CODEX-01 ≡ GLM-01 ≡ AGY-02）：不存在才算已退出，
       * 进程在（含 PID 被复用成别的活进程）照样不写。
       * **排在 patchStatus 之前**：本进程若死在两次写之间，下一次 `--wait` 仍会判失联并补齐；反过来排就没有第二次机会。
       * 结果只拼进下面抛出的报错正文（唯一的播报通道，r1 AGY-01）。
       */
      const pre = await readStatus(runDir);
      const goneForArchive =
        pre !== null
          ? (await workerConfirmedGone(pre, fallbackPid)).gone
          : fallbackPid !== null && !(await processAlive(fallbackPid, null)).alive;
      const id0 = pre
        ? { topic: pre.topic, stage: pre.stage }
        : last
          ? { topic: last.topic, stage: last.stage }
          : await readHandoffIdentity(runDir);
      let archiveNote = '';
      if (id0) {
        const fin = await finalizeFailedRunMeta({
          layout: { archiveRoot: ctx.archiveRoot, topic: id0.topic },
          stage: id0.stage,
          runId,
          lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000 },
          workerGone: goneForArchive,
          termination: { by: 'worker_lost', reason: reading.reason },
        });
        archiveNote =
          `\n  ${describeFinalizeStep(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 failed`, `归档 run-${runId}.json 未回写`)}` +
          `\n  ${describeFinalizeStep(fin.task, '已把 task.json 的运行登记同步为 failed', 'task.json 的运行登记未改')}`;
      }
      /*
       * 失联的结构化事实 `lost` 与 failed 同一次写入（EV-146，计划 r2 §4.1）：`--cancel` 据它判「失联后仍挂着的 worker」
       * 那一格，不读 message。`no_status_file` 时没有 status.json，patchStatus 不执行 mutate，这一条只进报错正文。
       */
      await patchStatus(runDir, (s) => {
        s.phase = 'failed';
        s.exit_code = EXIT.FAIL;
        s.message = `worker_lost（${reading.reason}）`;
        s.lost = { reason: reading.reason, at: new Date().toISOString() };
      });
      /*
       * heartbeat_stale 而 worker 仍在：先列判定依据、再给 --cancel 出口（EV-146，计划 r2 §4.2，计划双审 r1 CODEX-01）。
       * 这是工具第一次向人推荐一个会结束进程的动作，「卡死」与「只是慢」要在推荐的同一屏里分得清：心跳年龄、生效阈值、
       * 心跳间隔；阈值不大于心跳间隔时健康的 worker 也会被判失联。这一句的判据是共享的 `staleThresholdWithinHeartbeat`，
       * 与预检 / `--start` 的「失联阈值」只警告项同一来源（EV-160，心跳阈值事前告警计划 r2 §3.3）。
       * heartbeat_stale 只出自情形 C（status.json 可读），所以 pre 不为 null。
       */
      let cancelHint = '';
      if (reading.reason === 'heartbeat_stale' && !goneForArchive) {
        const lostPid = pre?.worker_pid ?? fallbackPid;
        const ageMs = pre ? Date.now() - new Date(pre.heartbeat_at).getTime() : Number.NaN;
        const staleS = cfg.review.heartbeat_stale_s;
        cancelHint =
          `\n  判定依据：工作进程 ${lostPid ?? '?'} 仍在，status.json 已 ${Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : '?'} s 未更新` +
          `（失联阈值 heartbeat_stale_s = ${staleS} s；工作进程的心跳间隔是 ${WORKER_HEARTBEAT_MS / 1000} s）` +
          (staleThresholdWithinHeartbeat(staleS) ? '——阈值不大于心跳间隔：健康的工作进程也会被判失联' : '') +
          `\n  若确认它卡死、要结束这一轮：trivium review --cancel ${runId}——会结束它与它拉起的审查员 CLI，并补收归档 run.json；` +
          '它若只是慢，这样做会结束一个仍在推进的轮次';
      }
      /*
       * worker 没了就不会再有人回收闸门，只能在这里收。
       * 主题/阶段从 status.json 现读，不能用 `last`——worker 若在第一次
       * `running` 读数之前就被杀掉，`last` 是 null，回收会被静默跳过。
       */
      const meta0 = await readStatus(runDir);
      await releaseRunningGate(ctx, runId, meta0?.topic ?? last?.topic, meta0?.stage ?? last?.stage);
      /*
       * 凭据抹除的挂载点 ②（EV-20，计划双审 AGY-02）：worker 没了，runner 的 finally 也就没跑，
       * 副本会一直躺到下次会话启动的清扫。这里是同会话内唯一知道「它死了」的时刻。
       *
       * **动手前复核进程确实不在**（代码双审 r1 CODEX-01）：`heartbeat_stale` 这一档的语义是
       * 「进程活着但心跳过期」——它可能只是被同步段堵住了，codex/zcode 子进程还在用那份副本，
       * 此刻整删载体会让该侧以莫名的鉴权错误失败。不可逆动作的准入判据与 ④ 清扫同一个函数（`scrubAdmission`）：
       * pid 现势不活（或已非同一进程），且 status.json 记录里的审查员 CLI 进程组没有仍在、判不了或读不懂的才抹
       * （EV-157：worker 被强杀之后它拉起的 CLI 常常还活着，本命令不结束任何进程）；否则只记一句，留给会话启动清扫——
       * 挡住准入的记录原样留在 status.json 里（下面那次 patchStatus 不动 cli），会话启动清扫据它重判。
       * 失败不改变本分支的结论（本来就是失联），只在报错里附一句。
       */
      let scrubNote = '';
      // pid 取不到时回落 worker.pid，两者都没有就不抹（代码双审 r2）
      const adm = await scrubAdmission(meta0, fallbackPid);
      if (!adm.admit) {
        scrubNote = `\n  凭据副本未抹：${scrubHoldWhy(adm)}（${reading.reason}），留给会话启动清扫`;
        /*
         * 出口（代码双审 r1 CODEX-02；EV-165 起把 `orphaned` 也算进「--cancel 能处理」）：会话启动清扫不结束进程，
         * 记录里仍在的 CLI 只有 `--cancel` 能按记录结束——终态早退分支对「工作进程确认已不在且有记录」逐组结束
         * （EV-154 D3），组长已退出但组号下还有非僵尸成员的组（`orphaned`）同样按组结束（EV-165）。只对判「仍在」
         * 或「组长已退、组员仍在」的组成立：判不了、读不懂的 `--cancel` 同样不发信号，那两种时不给这句。
         * 本命令仍不结束任何进程。
         */
        if (adm.cli?.blockers.some((b) => b.kind === 'alive' || b.kind === 'orphaned')) {
          scrubNote +=
            `\n  其中仍在的审查员 CLI 可用 trivium review --cancel ${runId} 按记录结束（本命令不结束任何进程）；` +
            '结束之后下一次会话启动清扫会重判，放行即抹副本';
        }
      } else {
        const scrubbed = await scrubRunDir(runDir, wiredAdapter).catch(() => null);
        const scrubFailed = Object.values(scrubbed?.sides ?? {}).filter((o) => o && !o.ok).length;
        if (scrubFailed > 0) scrubNote = `\n  另：${scrubFailed} 侧的凭据副本抹除失败，见该侧目录的哨兵；下次会话启动会重试`;
        // 运行目录那一层没有哨兵，不在这里报就没有第二次机会（`request.json` 含整份送审包）
        const layerErr = scrubbed?.runDir.errors[0];
        if (layerErr !== undefined) scrubNote += `\n  另：运行目录层脱敏失败：${layerErr}`;
      }
      throw new TriviumError(
        EXIT.FAIL,
        `运行 ${runId} 的工作进程失联（${reading.reason}）。` +
          `\n  日志：${workerLogPath(runDir)}` + archiveNote + cancelHint + scrubNote,
      );
    }
    if (reading.kind === 'running') last = reading.status;

    if (Date.now() >= deadline) {
      // 本次窗口用尽但运行仍在继续：这是**预期**返回，不是失败
      const starting = `运行 ${runId} 仍在启动中（尚无有效心跳）`;
      const at = Date.now();
      const b = budgetForStatus(budget, last);
      return {
        exitCode: EXIT.STILL_RUNNING,
        status: last,
        progress: last ? renderProgress(last, at, b) : starting,
        progressBrief: last ? renderProgressBrief(last, at, b) : starting,
        budget: b,
        view: last ? progressViewOf(last, at, b) : null,
      };
    }
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}

/**
 * `review --status <runId>`：只读一次，不等待。
 *
 * 返回形状与 `waitRun` 对齐（审查意见 AGY-03 ≡ GLM-02）：设计 7.5 表里
 * `--status` 行的返回写的是「同上」，`--wait` 既然给了结构化进度，这里也得给，
 * 否则按「同上」写客户端的人会拿到一半字段。
 */
export async function statusRun(
  ctx: Ctx,
  runId: string,
): Promise<{
  exitCode: number;
  status: RunStatus | null;
  progress: string;
  progressBrief: string;
  budget: ProgressBudget | null;
  view: ProgressView | null;
}> {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const s = await readStatus(runDir);
  if (!s) {
    const miss = `找不到运行 ${runId} 的状态文件（${runDir}）`;
    return {
      exitCode: EXIT.MISSING_ARTIFACT,
      status: null,
      progress: miss,
      progressBrief: miss,
      budget: null,
      view: null,
    };
  }
  const code =
    s.phase === 'success' ? EXIT.OK
    : s.phase === 'failed' ? EXIT.FAIL
    : s.phase === 'cancelled' ? EXIT.FAIL
    : EXIT.STILL_RUNNING;
  /*
   * 手工自查看到的期待值要与自动等待循环一致，否则同一次运行在两个地方
   * 显示成两个样子（审查意见 AGY-03）。budget 的两项数据 `ctx.config` 与
   * `s.stage` 都在手上，没有拿不到的问题。
   */
  // 与 `--wait` 同口径：某侧作废重跑时追加一份（EV-225）
  const budget = budgetForStatus(budgetFor(ctx.config, s.stage), s);
  const at = Date.now();
  return {
    exitCode: code,
    status: s,
    progress: renderProgress(s, at, budget),
    progressBrief: renderProgressBrief(s, at, budget),
    budget,
    view: progressViewOf(s, at, budget),
  };
}

/**
 * `review --cancel <runId>`：SIGTERM → 宽限 → SIGKILL → 归档 run.json 与 task.json 登记标 `cancelled`
 * （工作进程已确认退出且仍为 running 时，EV-128）→ status.json 标 `cancelled` → 回收锁与闸门。
 *
 * 这是 GLM-04 场景（进程活着但不再进展）唯一的工具化恢复路径。
 *
 * 已终态的运行不追溯改写，只有两格例外：`alive` 格（EV-146）——`--wait` 判 heartbeat_stale 写成 failed、而工作进程
 * 仍是同一活进程，由 `cancelLostWorker` 结束它与它拉起的审查员 CLI、补收归档 run.json、回收锁；`gone` 格（EV-159）——
 * 工作进程已确认不在（自己死了、被手工结束，或 `cancelLostWorker` 确认退出之后被中断），由 `finalizeGoneWorker`
 * 补收归档 run.json、回收锁（不发信号，本来就没有活进程可杀）。两格 status.json 都不写（见 `classifyLostCancel`）。
 */
/** status.json 读不到时，从交接文件取主题与阶段（它在派生前就写好了） */
async function readHandoffIdentity(runDir: string): Promise<{ topic: string; stage: Stage } | null> {
  try {
    const h = JSON.parse(await fs.readFile(requestPath(runDir), 'utf8')) as Partial<Handoff>;
    return h.topic && h.stage ? { topic: h.topic, stage: h.stage } : null;
  } catch {
    return null;
  }
}

/**
 * 本次运行的轮次链位置与计票结果（EV-247），给 `--wait` / `--status` 透出，skill 据此播报与分支。
 *
 * 取自归档 run.json（计票只在那里落），主题与阶段取自交接文件。任何一步读不到都返回 null——
 * 透出层把 null 照写成字段值，「没有」与「读不到」由调用方按 `review_loop` 在不在区分，这里不猜。
 */
export async function readRoundFacts(
  ctx: Ctx,
  runId: string,
): Promise<{ review_loop: ReviewLoop | null; round_verdict: RoundVerdict | null } | null> {
  const id = await readHandoffIdentity(runDirFor(ctx.config, ctx.projectRoot, runId));
  if (!id) return null;
  const { resolveTopicReadOnly } = await import('./topic.js');
  const ref = await resolveTopicReadOnly(ctx, id.topic, id.stage);
  const meta = await readRunMeta(ref.layout, id.stage, runId);
  if (!meta) return null;
  return { review_loop: meta.review_loop ?? null, round_verdict: meta.round_verdict ?? null };
}

/**
 * 归档侧收尾每一步的播报：写了、按前提跳过用 step；异常转成的跳过用 warn。
 *
 * 异常那一档要把后果说出来（代码双审 r1 CODEX-01）：「中断后再跑 --cancel 可补齐」只对**进程中断**成立。
 * 单步写失败时本进程照常往下走、把 status.json 落终态，之后再跑 --cancel 会在终态分支早退，这一步没有第二次机会。
 */
function reportFinalizeStep(
  r: FinalizeStep,
  done: string,
  notDone: string,
  /**
   * 「没有第二次机会」那半句：后果因处境而异。缺省是主路径的处境（主路径输出逐字不变）；
   * 失联后取消那一格传自己的（status.json 早已是终态，EV-146，计划双审 r1 AGY-03）
   */
  noSecondChance = '这一步不会再有第二次机会：status.json 随后落终态，再跑 --cancel 会早退，请人工核对归档 run.json 与 task.json 的运行登记',
): void {
  // 文案经 meta.ts 的 describeFinalizeStepWith 出（三处同族措辞的唯一来源，代码双审 r1 CODEX-06），这里只分流 step / warn
  const line = describeFinalizeStepWith(r, done, notDone, noSecondChance);
  if (r.kind === 'skipped' && r.error) warn(line);
  else step(line);
}

/**
 * 事后收尾每一步的一句话说明，给 worker 异常分支（拼进 status.json message）与 `--wait` 失联分支（拼进报错正文）用
 * （EV-142）。这两处都只有一个出口，所以返回字符串、不自己打印；`--cancel` 仍走上面的 `reportFinalizeStep`。
 * 异常转成的跳过同样要把后果说出来：调用方随后就把 status.json 落终态，这一步没有第二次机会。
 */
function describeFinalizeStep(r: FinalizeStep, done: string, notDone: string): string {
  return describeFinalizeStepWith(
    r, done, notDone,
    '这一步不会再有第二次机会：status.json 随后落终态，请人工核对归档 run.json 与 task.json 的运行登记',
  );
}

// ─────────────────────── 失联后取消挂住的 worker（EV-146） ───────────────────────

/**
 * `--cancel` 碰到终态运行时先判的格（EV-146，失联后取消挂住的worker计划 r2 §4.3）。只有 `alive` 一格会发信号。
 *
 * - `none`：不是「status.json 为 failed + `lost.reason` 为 heartbeat_stale」——走原有终态早退；
 * - `no_identity`：是，但 status.json 里的身份两项不合形状（pid 须为 > 1 的整数、启动时刻须为非空字符串），或
 *   pid 合法但两种启动时刻都缺失且进程还在（判不了是不是同一进程）——判不了就不发信号；
 * - `gone`：是，pid 上已没有活进程（含「pid 合法但两种启动时刻都缺失、进程也不在」，EV-159 收窄）——
 *   按 EV-142 的前提补收 run.json 与登记，锁按 alive 格同一复核回收（EV-159）；
 * - `mismatch`：是，pid 上有活进程而启动时刻不符——`basis` 为 canonical 时是 PID 复用或本次取不到启动时刻；为 legacy
 *   （旧版写下、没有规范化启动时刻的记录）时还可能是本命令的 TZ / 区域设置与 `--start` 不同（EV-158 的残余）；
 * - `alive`：本格，交给 `cancelLostWorker`。
 */
export type LostCancelCell =
  | { kind: 'none' }
  | { kind: 'no_identity' }
  | { kind: 'gone'; pid: number }
  | { kind: 'mismatch'; pid: number; basis: 'canonical' | 'legacy' }
  | { kind: 'alive'; pid: number; rec: RecordedStart; lost: WorkerLostRecord };

/**
 * 判格。判据全取 status.json 的结构化字段与进程事实，**不读 message**（用户决策 2）：
 * `phase === 'failed'`、`lostOf(s).reason === 'heartbeat_stale'`、`worker_pid` / `worker_started_at`、`processAlive`。
 *
 * - **类型守卫**（计划双审 r1 AGY-02 ≡ GLM-02）：`processAlive` 对假值启动时刻给 `sameProcess: true`，空串会被当成
 *   「有身份且相符」；pid 为 1 是 init / launchd；status.json 只有 TS 接口、`readStatus` 不校验。
 *   自 EV-158 起两种形态有其一即可（worker启动时刻规范化计划 r2 D7）：规范化启动时刻有（`canonicalStartOf`），或缺省形态是非空字符串。
 * - **只认 status.json 的记录**：不回落 `worker.pid` 文件（那里没有启动时刻，等于「身份缺失 = 相符」），也不取锁里的
 *   启动时刻——`startRun` 用同一次取值写两处，`ps` 失败时同为 null，不是第二份证据（计划双审 r1 CODEX-04 驳回的理由）。
 * - 身份判据经 `processMatchesRecord`（与主路径、锁同一读法，EV-158）：有规范化启动时刻只按它比，没有才退回缺省环境比较。
 * - **pid 合法但两种启动时刻都缺失时改判「在不在」**（EV-159，失联worker退出后补收计划 r2 §3.1）：这只挡住了
 *   「是不是同一进程」的判断，不挡「在不在」——`processAlive(pid)` 不传期望启动时刻，只取 `.alive`（不受
 *   「期望为假值即相符」那个 quirk 影响，quirk 只作用于 `.sameProcess`）；进程不在就归 `gone`（一并补收），
 *   进程还在则仍是 `no_identity`（判不了身份，不发信号，维持现状——PID 有可能已被别的进程复用）。
 */
export async function classifyLostCancel(s: RunStatus): Promise<LostCancelCell> {
  const lost = lostOf(s);
  if (s.phase !== 'failed' || lost?.reason !== 'heartbeat_stale') return { kind: 'none' };
  const pid: unknown = s.worker_pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) {
    return { kind: 'no_identity' };
  }
  const legacy: unknown = s.worker_started_at;
  const legacyOk = typeof legacy === 'string' && legacy.trim().length > 0;
  if (canonicalStartOf(s.worker_started_at_canonical) === null && !legacyOk) {
    return (await processAlive(pid)).alive ? { kind: 'no_identity' } : { kind: 'gone', pid };
  }
  const rec: RecordedStart = { canonical: s.worker_started_at_canonical, legacy: legacyOk ? (legacy as string) : null };
  const live = await processMatchesRecord(pid, rec);
  if (!live.alive) return { kind: 'gone', pid };
  if (!live.sameProcess) return { kind: 'mismatch', pid, basis: live.basis };
  return { kind: 'alive', pid, rec, lost };
}

/**
 * 本格「工作进程已退出」的严格判据（EV-146，代码双审 r1 GLM-01）的纯函数核：
 * 进程不存在 ⇒ 已退出；存在且取到的启动时刻与记录不同 ⇒ 已退出（pid 已被别的进程占用）；
 * 存在而**启动时刻取不到**（`ps` 瞬时失败）⇒ **未退出**。
 *
 * 立本判据时（EV-146），共享的 `workerGoneForCancel` 把「取不到」并入「不是同一进程」算已退出，而本格随后要补收 run.json、
 * 回收锁，那样会在 worker 其实还活着时破坏 EV-142「没有另一个写者」的前提，所以另立了严格判据。EV-176 起共享判据已三态化，
 * 对判不了返回 `'unverifiable'`、不算已退出；本格仍保留自己的判据（布尔，判不了即「仍在」）——两者对「判不了算不算已退出」
 * 已一致。宽限期满判不了是否升级 SIGKILL 这一处差别已由 EV-177 ① 收口（本格结束工作进程改用三态的 `lostWorkerGoneJudgment`，
 * 它与 `lostWorkerGone` 共用本函数；`lostWorkerGone` 的布尔口径只剩抛错后的复判在用）；未确认时的退出码也已由 EV-177 ② 改为与主路径同为 69（代码双审 r1 CODEX-03 指出的那一处）。
 * 与 EV-154 代码双审 r1 GLM-01 对 CLI 那一侧的收紧同一取向：轮询中判不了不算已不在。
 */
export function lostWorkerGoneFrom(p: { alive: boolean; startedAt: string | null }, expectedStartedAt: string): boolean {
  if (!p.alive) return true;
  return p.startedAt !== null && p.startedAt !== expectedStartedAt;
}

/**
 * `lostWorkerGoneFrom` 接上 `processMatchesRecord`：`cancelLostWorker` 里 `terminateProcessGroup` 抛错后的复判用它
 * （`isGone` 自 EV-177 ① 起改用三态的 `lostWorkerGoneJudgment`）。
 * 取到的形态与记录值出自同一 basis（EV-158）：判格按规范化判了 `alive`，这里也按规范化判退出，不会拿缺省形态去配规范化记录。
 * `expected` 为 null 只可能出自「判格之后记录被改成两种形态都没有」，按严格判据无从比较：只认「不在」。
 */
export async function lostWorkerGone(
  pid: number,
  rec: RecordedStart,
  o: { canonicalStartTimeOf?: (pid: number) => Promise<string | null> } = {},
): Promise<boolean> {
  const m = await processMatchesRecord(pid, rec, o);
  if (m.expected === null) return !m.alive;
  return lostWorkerGoneFrom(m, m.expected);
}

/**
 * 失联那一格 `terminateProcessGroup` 的 `isGone`（EV-177 ①）：判据同 `lostWorkerGone`，只把「活着而取不到启动时刻」
 * （`identity === 'unverifiable'`）报成 `'unverifiable'`——首检判不了一个信号都不发、宽限期满判不了不升级 SIGKILL，
 * 与主路径的 `workerGoneForCancel`（EV-176）同口径。`lostWorkerGone` 本身不动：抛错后的复判仍用它的布尔口径（判不了即「仍在」）。
 */
export async function lostWorkerGoneJudgment(
  pid: number,
  rec: RecordedStart,
  o: { canonicalStartTimeOf?: (pid: number) => Promise<string | null> } = {},
): Promise<GoneJudgment> {
  const m = await processMatchesRecord(pid, rec, o);
  if (m.identity === 'unverifiable') return 'unverifiable';
  if (m.expected === null) return !m.alive;
  return lostWorkerGoneFrom(m, m.expected);
}

/** `cancelRun` 的可选参数：只给单测替换个别步骤 */
export interface CancelOptions {
  /**
   * 替换**失联后取消那一格**（`cancelLostWorker`）「结束工作进程」这一步（与 `settleOrphanedStart` 的 `terminate` 注入同形）。
   * 只作用于那一格：主路径不经它（EV-176 起如实写明范围）。
   */
  terminateWorker?: (pid: number, rec: RecordedStart) => Promise<TerminateResult>;
  /**
   * 主路径 b / c 格按记录结束 CLI 的实现，缺省 `terminateRecordedCliGroups`。只为单测造「发了信号而未确认退出、组仍活着」
   * ——真实进程在 SIGKILL 之下必死，零配额造不出（取消与失联的凭据准入核CLI计划 r2 §3.8 D6）
   */
  terminateCli?: (s: RunStatus | null) => Promise<RecordedCliOutcome>;
}

/**
 * 按 EV-142 的前提把仍为 running 的 run.json 与 task.json 登记补收为 failed（termination 固定
 * worker_lost / heartbeat_stale），再按 run_id + pid 复核回收主题锁——alive 格（`cancelLostWorker`，EV-146）
 * 与 gone 格（`finalizeGoneWorker`，EV-159）的第 4、5 步逐字相同，抽成一份（失联worker退出后补收计划 r2 §3.2）。
 * 返回两步的 `FinalizeStep`，供单测直接钉住每一步的结果；**调用方的结论句一律不复述这两步的结果，只说
 * 「见上方输出」**——`reportFinalizeStep` 已经把结果如实播报在前面几行，在结论句里再断言一次会在「已是终态」
 * 「归档里没有文件」这两种非错误跳过情形下说假话（计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02）。
 */
async function finalizeLostAndReclaimLock(
  ctx: Ctx,
  runId: string,
  s: RunStatus,
  pid: number,
): Promise<{ runMeta: FinalizeStep; task: FinalizeStep }> {
  const fin = await finalizeFailedRunMeta({
    layout: { archiveRoot: ctx.archiveRoot, topic: s.topic },
    stage: s.stage,
    runId,
    lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000 },
    workerGone: true,
    termination: { by: 'worker_lost', reason: 'heartbeat_stale' },
  });
  const noSecondChance =
    '这一步可以再跑一次 --cancel 重试：只要 run.json 仍为 running，再跑一次会落进会重试这一步的格' +
    '（本次工作进程已被结束过，下一次判格时它已经不在了，通常是 gone 格；EV-159 起 gone 格与 alive 格一样会重试这一步）。' +
    '若这次写失败的原因是持续性故障（比如目录只读），重试不会自愈，请人工核对归档 run.json 与 task.json 的运行登记';
  reportFinalizeStep(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 failed`, `归档 run-${runId}.json 未回写`, noSecondChance);
  reportFinalizeStep(fin.task, '已把 task.json 的运行登记同步为 failed', 'task.json 的运行登记未改', noSecondChance);

  // 按 run_id + pid 复核回收主题锁：本格可能发生在 --start 之后很久，锁若已被新一轮接管或改写，都不是本运行 worker 的
  const existing = await inspectLock(ctx.triviumDir, s.topic);
  if (existing && existing.run_id === runId && existing.pid === pid) {
    if (await reclaimStaleLock(lockPathFor(ctx.triviumDir, s.topic), existing)) {
      say(`已回收主题「${s.topic}」的锁`);
    } else {
      step('主题锁在回收时已被别的进程动过，未回收');
    }
  } else if (existing) {
    step(`主题锁已不归本运行的工作进程（run_id ${existing.run_id ?? '无'}，pid ${existing.pid}），不动`);
  }
  return fin;
}

/**
 * gone 格：--wait 判 heartbeat_stale 之后，工作进程确认已不在（EV-159，失联worker退出后补收计划 r2 §3.3）。
 * 形态：worker 自己死了、被手工结束，或 `cancelLostWorker` 确认退出之后、补收之前本进程被中断。
 * 只做 `finalizeLostAndReclaimLock` 那一步——不发信号（本来就没有活进程可杀）。status.json 不写、
 * 闸门不动、凭据副本不抹，与 alive 格同口径；CLI 记录的结束在调用方已经做过（`cancelRun` 终态分支里
 * `workerConfirmedGone` 守卫的那段——`gone` 格的各种形态下该判据必为真），本函数不重复。**只对 gone 格成立**：
 * `alive` 格在 `cancelRun` 里更早 `return` 进 `cancelLostWorker`，到不了那段共享块，它的 CLI 结束是
 * `cancelLostWorker` 第 3 步自己无条件做的，两者不是同一处（代码双审 r1 GLM-01）。
 *
 * 结论句沿用 `cancelLostWorker` 的范式——不复述 `finalizeLostAndReclaimLock` 两步的结果，只说「见上方输出」：
 * 可重入（已是终态）与归档缺失（没有 run.json）都走 skip、由 `reportFinalizeStep` 在前面如实播报，结论句里
 * 再断言一次「已补收」会在这两种情形下说假话（计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02）。
 */
async function finalizeGoneWorker(ctx: Ctx, runId: string, s: RunStatus, cell: { pid: number }): Promise<number> {
  await finalizeLostAndReclaimLock(ctx, runId, s, cell.pid);
  say(`运行 ${runId} 已被 --wait 判为失联（heartbeat_stale）：工作进程 ${cell.pid} 已不在。`);
  say('  status.json 的 phase 与 message 保持失联判定时的样子（不追溯改写）；归档 run.json 与运行登记见上方输出。');
  return EXIT.OK;
}

/**
 * 失联后取消挂住的 worker（EV-146，计划 r2 §4.4）：status.json 已被 `--wait` 判 heartbeat_stale 写成 failed，
 * 而工作进程仍是同一活进程（多半是事件循环被堵住，SIGTERM 处理器跑不到）。按用户决策 3 的次序：
 *   1. 开场先列事实（判定时刻、status.json 最近一次写入；判定之后又写过就说它可能只是慢——在发信号之前说，计划双审 r1 CODEX-01）；
 *   2. 按组结束工作进程：宽限同主路径，SIGKILL 之后**等确认**（`ORPHAN_KILL_CONFIRM_MS`）——后面几步都以「确认退出」为前提；
 *   3. 按 status.json 的记录结束审查员 CLI（没确认退出也照做，与主路径 b 格同口径，D4）；
 *   4. 确认退出后按 EV-142 的前提补收 run.json 与登记为 failed（`termination` 同 `--wait`：worker_lost / heartbeat_stale，D5）；
 *   5. 确认退出后按 run_id + pid 复核回收主题锁（D10）。
 * **不做**：status.json 一个字节都不写（phase / message 不改写、CLI 记录也不清——终态分支不追溯改写，也让本格可重入：
 * 未确认退出后再跑一次仍入本格）；闸门不动（`--wait` 判失联时已回收）；凭据副本不抹（留给会话启动清扫，EV-157 范围不动）。
 * 退出码：确认退出、补收之后退 0；未确认退出（仍是同一进程、判不了身份、首检即判不了零信号）以 69 退出，与 EV-176 起的主路径同口径
 * （EV-177 ②；EV-146 D6 原定两种结局都退 0，前提「与当时的主路径同口径」已不成立）。结局仍写在 stdout 的结论句里，播报文字不变。
 * 宽限期满判不了时不升级 SIGKILL、首检判不了零信号，与主路径同口径（EV-177 ①）。
 */
async function cancelLostWorker(
  ctx: Ctx,
  runId: string,
  runDir: string,
  s: RunStatus,
  cell: { pid: number; rec: RecordedStart; lost: WorkerLostRecord },
  o: CancelOptions,
): Promise<number> {
  const { pid, rec, lost } = cell;
  step(
    `运行 ${runId} 已被 --wait 判为失联（heartbeat_stale，判定于 ${lost.at}；status.json 最近一次写入于 ${s.heartbeat_at}），` +
      `但工作进程 ${pid} 仍是同一进程：按取消意图结束它——向工作进程组发送 SIGTERM`,
  );
  // `--wait` 自己那次写入会把 heartbeat_at 刷成判定后几毫秒，所以留 1 s 余量；只影响这一句的措辞
  const lostAtMs = Date.parse(lost.at);
  const lastWriteMs = Date.parse(s.heartbeat_at);
  if (Number.isFinite(lostAtMs) && Number.isFinite(lastWriteMs) && lastWriteMs - lostAtMs > 1000) {
    warn('失联判定之后工作进程又写过 status.json，它可能只是心跳慢；仍按取消结束它');
  }

  // 2. 按组结束工作进程并确认退出（Windows：先写取消标记让 worker 走优雅收尾，设计 §7.1）
  await requestWorkerCancel(runDir);
  let t: TerminateResult | null;
  try {
    t = await (o.terminateWorker ?? ((p: number, r: RecordedStart) => terminateProcessGroup(p, {
      // 三态：判不了不算已退出、也不升级 SIGKILL（EV-177 ①）
      isGone: () => lostWorkerGoneJudgment(p, r),
      graceMs: WORKER_TERM_GRACE_MS,
      killWaitMs: ORPHAN_KILL_CONFIRM_MS,
      pollMs: 250,
      onEscalate: () => warn(IS_WIN
        ? `工作进程 ${p} 未退出（事件循环被堵住时标记 watcher 跑不到），强制结束其进程树（taskkill /T /F）`
        : `工作进程组 ${p} 未响应 SIGTERM（事件循环被堵住时处理器跑不到），发送 SIGKILL`),
    })))(pid, rec);
  } catch (err) {
    warn(`结束工作进程组 ${pid} 时出错：${String((err as Error)?.message ?? err).split('\n')[0]}`);
    t = null;
  }
  const gone = t ? t.gone : await lostWorkerGone(pid, rec).catch(() => false);
  const sent = t?.signals.join('、') || '（无）';
  /*
   * 播报按三态分（代码双审 r1 CODEX-01 ≡ GLM-01）：`terminateProcessGroup` 首检即「已不在」时一个信号都没发
   * （判格之后它自己退出了，或 pid 已被别的进程占用），不能说成「响应 SIGTERM」「处理器已收拾 CLI」「仍挂着」。
   */
  const noSignalSent = t !== null && t.signals.length === 0;
  const handlerRan = gone && t !== null && !t.escalated && !noSignalSent;
  if (gone && noSignalSent) {
    step(`未及发信号，工作进程 ${pid} 已不在（在判格之后自己退出了，或它的 pid 已被别的进程占用）`);
  } else if (handlerRan) {
    step(
      `工作进程在宽限内响应 SIGTERM 退出（${sent}）——它的事件循环没有被堵住，失联判定可能只是心跳慢；` +
        '它的 SIGTERM 处理器已按自己的登记结束审查员 CLI（见 worker.log）',
    );
  } else if (gone) {
    step(`工作进程组 ${pid} 已结束（${sent}）`);
  } else {
    // 判不了的两种（EV-177 ①）：零信号（首检即判不了）不能说「发送 （无）」；宽限期满判不了要说清为什么没升级
    const head = t?.unverifiable && noSignalSent
      ? `取不到工作进程 ${pid} 的启动时刻（ps 未返回），判不了它是不是 status.json 记录的那个工作进程：未发信号，未能确认退出`
      : t?.unverifiable && !t.escalated
        ? `已向工作进程组 ${pid} 发送 ${sent}，宽限 ${WORKER_TERM_GRACE_MS / 1000} s 期满时取不到它的启动时刻、判不了身份：` +
          '不升级 SIGKILL（不向身份判不了的进程发），未能确认退出'
        : `已向工作进程组 ${pid} 发送 ${sent}，未能确认退出`;
    warn(
      `${head}：归档 run.json、主题任务文件的运行登记与主题锁都不动（它若还活着就是写者）。` +
        '可以再跑一次 --cancel（仍会入这一格，再次尝试结束）；若改为在终端手工结束它，之后再跑 --cancel 会判它已不在' +
        '（gone 格），按前提补收归档 run.json 与运行登记（EV-159）',
    );
  }

  // 3. 按记录结束 CLI（没确认退出也照做，D4）。只有 worker 的处理器确实跑过（发了 SIGTERM、宽限内退出）时无记录才不出声——
  //    零信号那一格正是 worker 被外部结束、CLI 可能成孤儿的形态，要照常提示（代码双审 r1 CODEX-01）
  reportRecordedCliGroups(await terminateRecordedCliGroups(await readStatus(runDir)), handlerRan, runDir);

  if (!gone) {
    say(`运行 ${runId} 已被 --wait 判为失联（heartbeat_stale）：未能确认工作进程 ${pid} 退出，归档与主题锁未动。`);
    // 69 与主路径未确认退出同码：这次没做收尾、状态原样、可重试（EV-177 ②）
    return EXIT.ENV;
  }

  // 4、5. 补收 run.json 与登记、按 run_id + pid 复核回收主题锁——与 gone 格（EV-159）共用，见 finalizeLostAndReclaimLock
  await finalizeLostAndReclaimLock(ctx, runId, s, pid);

  // 结论按三态说（代码双审 r1 CODEX-01）：「已结束仍挂着的」只在确实发过信号时说
  say(
    noSignalSent
      ? `运行 ${runId} 已被 --wait 判为失联（heartbeat_stale）：工作进程 ${pid} 在发信号之前已不在，未对它发信号。`
      : `运行 ${runId} 已被 --wait 判为失联（heartbeat_stale）：已结束仍挂着的工作进程 ${pid}。`,
  );
  say('  status.json 的 phase 与 message 保持失联判定时的样子（不追溯改写）；归档 run.json 与运行登记见上方输出。');
  return EXIT.OK;
}

/** `ps` 持续取不到时的手工出路（EV-175 入口格与 EV-176 未确认格共用一句，计划 r2 D3） */
function manualCancelWayOut(pid: number, runId: string): string {
  return (
    `一直取不到时：先在终端确认 ${pid} 的命令行含 review --worker ${runId}` +
    `（ps -p ${pid} -o command=），确认是它、要结束这一轮，就在终端按组结束它（kill -TERM -${pid}），` +
    '之后再跑一次 --cancel，会按「已不存在」回收锁与闸门、按记录结束审查员 CLI'
  );
}

/**
 * 判不了、一个信号都没发时的 69 正文：主路径入口判不了（EV-175）与入口之后首检才判不了的零信号格（EV-176）同一句，
 * 两处共用这一份，不出现两份字面量（计划 r2 D3 第 4 点）。
 */
function unverifiableCancelMessage(pid: number, runId: string): string {
  return (
    `取不到工作进程 ${pid} 的启动时刻（ps 未返回），判不了它是不是 status.json 记录的那个工作进程：本次不取消——` +
    '未发信号，status.json、主题锁、闸门、归档与凭据副本都没动。请稍后重试 ' +
    `trivium review --cancel ${runId}。${manualCancelWayOut(pid, runId)}`
  );
}

/**
 * 发过信号而未确认工作进程退出时的 69 正文（EV-176，计划 r2 D3 第 4 点）：按最后一次判定分两种——判不了（宽限期满、
 * 或 SIGKILL 之后的等待窗里）与仍是同一进程（SIGKILL 之后等满仍在）。按实际发出的信号序列说，公共尾句相同。
 */
/**
 * 发过信号之后判不了时的手工出路（EV-176 代码双审 r1 CODEX-01 ≡ GLM-01）：SIGTERM 已经按组发过而它没在宽限内退出，
 * 再发 SIGTERM 多半无效，所以终端里按组 SIGKILL。入口格与零信号格没发过信号，仍用 `manualCancelWayOut`（逐字不变）。
 */
function manualKillWayOut(pid: number, runId: string): string {
  return (
    `一直取不到时：先在终端确认 ${pid} 的命令行含 review --worker ${runId}` +
    `（ps -p ${pid} -o command=），确认是它、要结束这一轮——SIGTERM 已经发过而它没有退出，就在终端按组强制结束它` +
    `（kill -KILL -${pid}），之后再跑一次 --cancel，会按「已不存在」回收锁与闸门、按记录结束审查员 CLI`
  );
}

function unconfirmedCancelMessage(pid: number, runId: string, t: TerminateResult): string {
  const escalated = t.signals.includes('SIGKILL');
  const what = t.unverifiable
    ? escalated
      ? `SIGKILL 之后等 ${ORPHAN_KILL_CONFIRM_MS / 1000} s 仍取不到它的启动时刻，判不了它是否已退出`
      : `宽限 ${WORKER_TERM_GRACE_MS / 1000} s 期满时仍取不到它的启动时刻，判不了它是否已退出；不升级 SIGKILL（不向身份判不了的进程发）`
    : `SIGKILL 之后等 ${ORPHAN_KILL_CONFIRM_MS / 1000} s 仍是同一进程，未确认退出`;
  const next = t.unverifiable
    ? manualKillWayOut(pid, runId)
    : `仍不退出时请在终端核对它的状态（ps -p ${pid} -o stat=,command=）`;
  // 「没动」限定为本命令的动作（代码双审 r1 CODEX-01）：这几格都按记录结束了 CLI，工作进程若仍在，看到它们退出后
  // 可能自己收尾（写 failed、放锁）——跨进程验收里实测过
  return (
    `已向工作进程组 ${pid} 发送 ${t.signals.join('、')}，${what}：本次不收尾——` +
    '本命令没有动 status.json、主题锁、闸门、归档与凭据副本；按记录结束的审查员 CLI 见上方输出' +
    '（工作进程若仍在，看到它们退出后可能自己收尾：写 failed、放锁——那是它自己的收尾）。请稍后重试 ' +
    `trivium review --cancel ${runId}。${next}`
  );
}

export async function cancelRun(ctx: Ctx, runId: string, o: CancelOptions = {}): Promise<number> {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const s = await readStatus(runDir);
  /*
   * status.json 读不到（刚派生还没落盘、或运行目录被清了）时原先：patchStatus 静默不写、
   * 锁与闸门因为拿不到 topic 全部跳过，最后仍打印「已取消」。交接文件里有主题与阶段，拿它兜底；
   * 两者都没有就如实说找不到，而不是宣称取消成功。
   */
  const identity = s ? { topic: s.topic, stage: s.stage } : await readHandoffIdentity(runDir);
  if (!s && !identity) {
    throw missingArtifact(`找不到运行 ${runId} 的状态文件与交接文件（${runDir}），无法取消；若它仍在跑，请用 trivium status 查看主题锁`);
  }

  /*
   * 已经结束的运行不能被「取消」（审查意见 GLM-04）。
   *
   * 原先无条件把 status 改写成 cancelled——那是**改写历史**：一次已经 success 的
   * 运行事后被记成取消，归档里的事实就不再是当时发生的事实（P6 只追加不覆盖）。
   * 也不该动闸门：那一轮的闸门可能正等着裁决，凭什么因为一次误敲的 --cancel 就清掉。
   */
  const pidFromFile = await fs
    .readFile(workerPidPath(runDir), 'utf8')
    .then((t) => Number.parseInt(t, 10) || null)
    .catch(() => null);
  if (s && ['success', 'failed', 'cancelled'].includes(s.phase)) {
    /*
     * 失联后仍挂着的 worker（EV-146，计划 r2 §4.3）：status.json 为 failed、`lost.reason` 为 heartbeat_stale、worker 仍是
     * 同一活进程——这是终态分支里唯一会对工作进程发信号的一格，交给 cancelLostWorker。
     */
    const cell = await classifyLostCancel(s);
    if (cell.kind === 'alive') return cancelLostWorker(ctx, runId, runDir, s, cell, o);
    /*
     * 终态早退分支里的 CLI（EV-154 D3，CLI进程组记录计划 r2 §4.4 第 3 处）：worker 被强杀后 `--wait` 判 `pid_gone`，
     * 会先于用户的 `--cancel` 把 status 写成 failed——只做非终态分支的话，「worker 已不在」这一格在实际序列里多半走不到。
     * worker 确认已不在、且还有记录时按记录结束 CLI。**只结束进程**：status.json、归档、锁与闸门一概不写（不追溯改写）。
     * 失联后身份判不上（mismatch）时**跳过**（代码双审 r1 CODEX-02）：workerConfirmedGone 对「活着而启动时刻不符」同样判
     * 「已不存在」，会按记录结束一个可能还活着的 worker 名下的 CLI；而 --wait 判 heartbeat_stale 那一刻身份是对得上的，
     * 此刻对不上更可能是本命令的环境与 --start 不同（EV-158），不是 worker 死后 pid 被复用——一个信号都不发，让人先核对环境。
     * EV-158 之后环境差异只对旧版写下、没有规范化启动时刻的记录成立；规范化记录不符的成因是复用或本次取不到启动时刻，
     * 后者照「取不到时保持今天口径」同样不发（worker启动时刻规范化计划 r2 D6）。
     * 一条记录都没有时不出声。
     */
    const recs = cliRecordsOf(s);
    if (
      cell.kind !== 'mismatch' &&
      recs.records.length + recs.malformed.length > 0 && (await workerConfirmedGone(s, pidFromFile)).gone
    ) {
      reportRecordedCliGroups(await terminateRecordedCliGroups(s), true, runDir);
    }
    /*
     * gone 格（EV-159，失联worker退出后补收计划 r2 §3.4）：工作进程已确认不在——按 EV-142 的前提补收 run.json
     * 与登记。排在 CLI 结束块之后：两段各自的 stdout/stderr 顺序与 alive 格「先报 worker 结束、再报 CLI 结束、
     * 再报补收」的顺序呼应。
     */
    if (cell.kind === 'gone') return finalizeGoneWorker(ctx, runId, s, cell);
    /*
     * 失联判定之后身份判不上 / 身份没记下（EV-146，计划双审 r1 AGY-01）：不跌回「无需取消」——worker 可能还挂着、
     * 锁与归档都没动，结论要如实说。
     */
    if (cell.kind === 'mismatch') {
      /*
       * 告警按比对依据分写（EV-158，计划 r2 D6），处置不变：两种依据下都一个信号都不发、也不结束 CLI。
       * 规范化记录不符时环境差异已不可能是成因，只剩 PID 复用与「本次取不到启动时刻」；后者照 §4.6 不改口径，所以不放开结束 CLI。
       */
      warn(
        cell.basis === 'canonical'
          ? `工作进程 ${cell.pid} 上有活进程，但启动时刻与 status.json 的规范化记录不符：PID 已被复用，或本次取不到它的启动时刻` +
              '——不对它发信号，本次也未结束它名下的审查员 CLI；请用 ps 核对它与 ppid 为 1 的审查员 CLI'
          : // 旧版写下的记录：原句逐字保留（EV-146 起的输出与用例不变），句末补一句成因
            `工作进程 ${cell.pid} 上有活进程，但启动时刻与 status.json 的记录不符：可能是 PID 已被复用，` +
              '也可能是本命令的 TZ / 区域设置与 --start 不同（BACKLOG EV-158）——不对它发信号，本次也未结束它名下的审查员 CLI。' +
              '若确认是后者，请在与 --start 相同的环境里再跑一次 --cancel；若确认是前者，请用 ps 核对 ppid 为 1 的审查员 CLI' +
              '（这份记录没有规范化启动时刻——由升级前的旧版写下，或写时取不到——所以只能按缺省环境比较）',
      );
      say(`运行 ${runId} 已被 --wait 判为失联（heartbeat_stale），但工作进程的身份与记录不符，未对工作进程与它名下的审查员 CLI 发信号；归档 run.json 与主题锁未动。`);
      // 69 与 alive 格未确认退出、主路径判不了身份同码：这次没做收尾、状态原样、可重试（EV-177 ② 补，用户 2026-10-06 定）
      return EXIT.ENV;
    }
    if (cell.kind === 'no_identity') {
      warn('status.json 里工作进程的 pid 或启动时刻缺失 / 形状不对，判不了是不是同一进程，不发信号——请用 ps 核对');
      say(`运行 ${runId} 已被 --wait 判为失联（heartbeat_stale），但 status.json 没记下可核对的工作进程身份，未对工作进程发信号；归档 run.json 与主题锁未动。`);
      // 同上一格：69（EV-177 ② 补）
      return EXIT.ENV;
    }
    say(`运行 ${runId} 已处于终态（${s.phase}），无需取消。`);
    say('  已完成的运行不会被追溯改写——归档里的事实就是当时发生的事实。');
    return EXIT.OK;
  }
  const pid = s?.worker_pid ?? pidFromFile;

  /** worker 的处理器跑不到的那几格里按记录结束 CLI 的结果；主路径收尾时据它清掉已确认结束的记录（AGY-02） */
  let cliOutcome: RecordedCliOutcome | null = null;
  if (pid !== null) {
    // 身份按 status.json 的记录比：有规范化启动时刻只按它比，没有（旧版写的）退回缺省比较（EV-158）
    const rec: RecordedStart = s ? workerStartOf(s) : { legacy: null };
    const live = await processMatchesRecord(pid, rec);
    /*
     * 活着而取不到它的启动时刻（EV-175，取不到启动时刻当不在计划 r2 §3 D6）：判不了是不是记录里的那个工作进程。
     * 此前读成「已不存在」，只清状态与锁、不发信号——活 worker 脱锁，同主题下一次 --start 能拿到锁、两条流水线同时跑
     * （计划 r2 §2 探针 K-main）；而 EV-153 之后等待者耗满预算抛 70，70 的正文正指向这里。
     * 现在**什么都不动**：不发信号（worker 与 CLI 都不）、不写 status.json、不回收锁与闸门、不抹、不补收，以 69 退出。
     * 69（环境或预检失败）而不是 70 / 1：70 会把人从 --cancel 指回 --cancel；1 分不出「什么都没做、可重试」（计划 r2 D6 论证）。
     * `ps` 持续取不到时工具自己结束不了这一轮（R4），正文给出确定性的手工出路（计划双审 r1 CODEX-01 ≡ GLM-03）：
     * 工作进程被人结束后 kill(0) 即失败、identity 为 different，再跑一次就走下面「已不存在」那一格收尾。
     * s 为 null 时记录无期望值，只看存活，落不进这一格。
     */
    if (live.identity === 'unverifiable') throw envError(unverifiableCancelMessage(pid, runId));
    if (live.alive && live.sameProcess) {
      /*
       * 按**进程组**发：只杀 worker 会把与它同组的子进程遗弃给 init。适配器以 `killTree` 拉起的厂商 CLI
       * 自成一组，按组发到不了它们——由 worker 的 SIGTERM 处理器转发（`installWorkerSigtermForwarding`，EV-152）；
       * 升级到 SIGKILL 时处理器跑不到，随后按 status.json 的逐侧记录结束（EV-154）。
       * SIGTERM → 宽限 5 s（每 250 ms 看一次）→ SIGKILL → 至多再等 5 s 确认退出（`ORPHAN_KILL_CONFIRM_MS`）：与 `--start`
       * 派生后失败的收尾共用 `terminateProcessGroup`（EV-150）。宽限期判据是「不存活或不是同一进程」——此前只看存活，
       * PID 被复用时会把 SIGKILL 打到无关进程（计划双审 r1 AGY-04，用户审批并入）。
       *
       * EV-176（取消宽限期判不了仍放锁计划 r2 D3）：入口判过同一进程之后身份仍可能转为「判不了」（`workerGoneForCancel`
       * 返回 `'unverifiable'`）。此前它并入「已退出」、SIGKILL 之后也不等（EV-150 定的形态），收尾照写 cancelled、回收锁与闸门，
       * 工作进程若还活着就脱了锁（探针 Z1 / G1 / G2 / K1）。现在：
       * - 「发送 SIGTERM」只在确实要发时播报（`onTerm`）；首检即判不了 ⇒ 一个信号都没发，与入口判不了同处置（69、什么都不动）；
       * - 宽限期满仍判不了 ⇒ 不升级 SIGKILL；升级过 SIGKILL 或扣下了 SIGKILL，都按记录结束 CLI——判不了的两种真相
       *   （仍是它 / 它已退出而 pid 被占）下结束它名下的 CLI 都符合取消意图，CLI 组各自核身份（计划双审 r1 CODEX-02）；
       * - **未确认退出（仍是同一进程或判不了）⇒ 69、不收尾**：不抹、不补收归档、不写 status.json、不回收锁与闸门。
       *   退出码与入口判不了同码（计划 r2 D4）：「这次没做收尾、状态原样、可重试」对两者都成立，形态差异写在正文里。
       */
      // Windows：先写取消标记，worker 的 watcher 据此走优雅收尾（软步的 WM_CLOSE 对控制台进程常无效，设计 §7.1）；POSIX 上 no-op
      await requestWorkerCancel(runDir);
      const t = await terminateProcessGroup(pid, {
        isGone: () => workerGoneForCancel(pid, rec),
        graceMs: WORKER_TERM_GRACE_MS,
        killWaitMs: ORPHAN_KILL_CONFIRM_MS,
        pollMs: 250,
        onTerm: () => step(IS_WIN
          ? `向工作进程 ${pid} 发送关闭请求（taskkill /T；已先写取消标记，worker 将自行收尾）`
          : `向工作进程组 ${pid} 发送 SIGTERM`),
        onEscalate: () =>
          warn(IS_WIN
            ? `工作进程 ${pid} 未退出，强制结束其进程树（taskkill /T /F）——随后按 status.json 的记录结束它拉起的审查员 CLI`
            : `工作进程组 ${pid} 未响应 SIGTERM，发送 SIGKILL——随后按 status.json 的记录结束它拉起的审查员 CLI`),
      });
      // 零信号格：首检即判不了（不可能是别的——首检判已退出时 gone 为真）
      if (!t.gone && t.signals.length === 0) throw envError(unverifiableCancelMessage(pid, runId));
      if (t.unverifiable && !t.escalated) {
        warn(
          `宽限 ${WORKER_TERM_GRACE_MS / 1000} s 期满时仍取不到工作进程 ${pid} 的启动时刻，判不了它是否已退出：不升级 SIGKILL` +
            '——随后按 status.json 的记录结束它拉起的审查员 CLI',
        );
      }
      if (t.escalated || t.unverifiable) {
        // b 格（EV-154）：worker 的处理器没跑成（或判不了它跑没跑成，EV-176），记录是它最后写下的样子
        cliOutcome = await (o.terminateCli ?? terminateRecordedCliGroups)(await readStatus(runDir));
        reportRecordedCliGroups(cliOutcome, false, runDir);
      }
      if (!t.gone) throw envError(unconfirmedCancelMessage(pid, runId, t));
    } else {
      step(`工作进程 ${pid} 已不存在，仅做状态与锁的清理`);
      // c 格（EV-154）：worker 在本次取消之前已退出（被强杀、崩溃）
      cliOutcome = await (o.terminateCli ?? terminateRecordedCliGroups)(await readStatus(runDir));
      reportRecordedCliGroups(cliOutcome, false, runDir);
    }
  }

  /*
   * 凭据抹除的挂载点 ③（EV-20）：`--cancel` 是 SIGKILL 的唯一入口，runner 的 finally
   * 在这条路上跑不到。准入与另两处同一个函数（`scrubAdmission`）——SIGKILL 之后再确认一次，没确认到就不抹
   * （进程组里可能还有没收到信号的后代，代码双审 r2）。CLI 一半判的是上面按记录结束**之后**的事实（EV-157）：
   * 已结束的组判 gone 放行；判不了、读不懂（没发信号）与未确认退出的组挡住——它们不在 settledCliSides 里，
   * 下面收尾那次 patchStatus 不清，原样留给会话启动清扫重判。
   * 归档收尾只看 worker 一半（`adm.worker`，计划 r2 D5）：run.json 的 cancelled 说的是 worker 的事实。
   * 已收口（EV-165）：`judgeCliGroup` 现在同时判组长与非僵尸成员数，组长已退出但组号下还有非僵尸成员的组
   * （`orphaned`）与准入侧同源阻挡，不再与 `settledCliSides` 分叉——上面已经按组结束过这类组，这里的复判
   * 读到的是结束之后的事实。
   */
  const adm = await scrubAdmission(await readStatus(runDir), pid);
  const goneNow = adm.worker;
  if (adm.admit) {
    const scrubbed = await scrubRunDir(runDir, wiredAdapter).catch(() => null);
    for (const [side, o] of Object.entries(scrubbed?.sides ?? {})) {
      if (o && !o.ok) warn(`${side} 侧凭据副本抹除失败：${o.errors[0] ?? '原因未记录'}（下次会话启动会重试）`);
    }
    // 运行目录那一层没有哨兵可留，不在这里报就是三条通道全灭
    for (const e of scrubbed?.runDir.errors ?? []) warn(`运行目录层脱敏失败：${e}`);
  } else {
    warn(`凭据副本未抹：${scrubHoldWhy(adm)}——留给会话启动清扫`);
  }

  /*
   * 归档侧收尾（EV-128）：把仍为 running 的 run.json 标为 cancelled，并同步 task.json 的运行登记。
   *
   * **必须排在 patchStatus 之前**（计划双审 r1 CODEX-01 ≡ GLM-01）：status.json 一旦是终态，
   * 再跑 --cancel 会在上面的终态分支早退。排在后面的话，本进程死在两次写之间，run.json 就永远停在 running。
   * 排在前面，中断后 status.json 仍非终态，再跑一次会把没做完的那一步补上（两步各自可重入）。
   *
   * 函数自身不抛（异常转成 skipped），所以不再另包一层；锁与闸门回收照常在后面执行。
   * layout 直接由 status.json / 交接文件里的主题构造：那是 startRun 解析好的主题名，不再过一遍会抛错的解析。
   */
  if (identity) {
    const fin = await finalizeCancelledRunMeta({
      layout: { archiveRoot: ctx.archiveRoot, topic: identity.topic },
      stage: identity.stage,
      runId,
      lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000 },
      workerGone: goneNow.gone,
    });
    reportFinalizeStep(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 cancelled`, `归档 run-${runId}.json 未回写`);
    reportFinalizeStep(fin.task, '已把 task.json 的运行登记同步为 cancelled', 'task.json 的运行登记未改');
  }

  const settled = settledCliSides(cliOutcome);
  const patched = await patchStatus(runDir, (st) => {
    st.phase = 'cancelled';
    st.exit_code = EXIT.FAIL;
    st.message = '被 --cancel 取消';
    /*
     * 已确认结束的 CLI 记录清成 null（计划双审 r1 AGY-02）：不留一个陈旧组号让之后的清扫反复核对进程表。
     * 判不了、未确认退出、组员残留、形状坏的原样保留——它们是之后清扫准入的依据。只清与本次所判同一组号的那一侧。
     */
    for (const [side, pgid] of settled) {
      const cur = st.sides[side];
      if (cur?.cli && cur.cli.pgid === pgid) cur.cli = null;
    }
  });
  if (!patched) warn(`运行 ${runId} 没有 status.json，终态未落盘；仅回收锁与闸门`);

  // 回收锁：走 rename → 复验 → 删除，不直接 unlink
  const topic = identity?.topic;
  const stage = identity?.stage;
  if (topic) {
    const existing = await inspectLock(ctx.triviumDir, topic);
    if (existing && existing.run_id === runId) {
      // 按回收结果播报（锁回收误判已删锁文件计划 r2 D7）：回收前预检不符时什么都没回收，原先照样说「已回收」
      if (await reclaimStaleLock(lockPathFor(ctx.triviumDir, topic), existing)) {
        say(`已回收主题「${topic}」的锁`);
      } else {
        step('主题锁在回收时已被别的进程动过，未回收');
      }
    }
    /*
     * 闸门也要一并回到 idle。取消后若还留着 `running`，Driver 会被一个已经不存在的
     * 运行永久锁住业务写入——人的第一反应是去关 Hook，护栏就此报废。
     */
    if (stage) {
      /*
       * 只回收**本 run** 的闸门（审查意见 GLM-r2-01 ②）。
       * 「先 --cancel 旧 run，再 --start 新一轮」是正常序列；若不比对 run_id，
       * 取消一个早已失联的旧 run 会把正在跑的新一轮护栏一并清掉。
       * 回收锁时一直有 `existing.run_id === runId` 守卫，闸门这里以前漏了。
       */
      const g = await setGateChecked({
        triviumDir: ctx.triviumDir, topic, stage, state: 'idle',
        runId, sessionId: process.env['CLAUDE_SESSION_ID'] ?? null,
        heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
        expect: { runId, allowMissing: false },
      });
      if (!g.applied && g.entry) step(`闸门未回收：${g.skipped}`);
    }
  }
  say(`运行 ${runId} 已取消`);
  return EXIT.OK;
}
