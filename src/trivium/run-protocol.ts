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
import type { Config, CriticId, CriticRequest, Ctx, Stage, CommandEntry } from './types.js';
import { EXIT, TriviumError, envError, missingArtifact } from './exit-codes.js';
import { runRoot } from './config.js';
import { RUN_DIR_FILES } from './run-files.js';
import { acquireLock, inspectLock, reclaimStaleLock } from './lock.js';
import {
  computeMaxWaits, interpretStatus, newStatus, patchStatus, readStatus,
  renderProgress, renderProgressBrief, progressViewOf, workerConfirmedGone, writeStatus,
  type ProgressBudget, type ProgressView, type RunStatus,
} from './status.js';
import {
  executeRun, prepareRun, repoId, type PreparedRun, type ReviewOptions, type RunContext,
} from './review.js';
import { resolveTopic } from './topic.js';
import { finalizeCancelledRunMeta, finalizeFailedRunMeta, readRunMeta, type FinalizeStep } from './meta.js';
import { type AgentId } from './agents/registry.js';
import { setGateChecked } from './state.js';
import type { AdapterContext } from './adapters/base.js';
import { resolveAdapters } from './adapters/stub.js';
import { realAdapters, wiredAdapter } from './adapters/index.js';
import { scrubRunDir } from './scrub.js';
import { ensureDir, exists } from './util/fsx.js';
import { killProcessTree, processAlive, processStartTime, spawnDetached } from './util/exec.js';
import { fail, say, step, warn } from './util/log.js';
import { checkModelOverrideSource, collectWarnings, type PreflightWarning } from './preflight.js';

/** 心跳间隔：设计 §7.5 规定 30s */
const HEARTBEAT_MS = 30_000;

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
  snapshots: PreparedRun['snapshots'];
  meta_paths: string[];
  /** 重建 ReviewOptions 所需的字段（ctx 由工作进程自己 loadCtx 得到） */
  options: {
    promptHint: string | null;
    contextPaths: string[];
    subjectFile: string | null;
    modelOverrides: Partial<Record<CriticId, string>>;
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

async function writeHandoff(rc: RunContext): Promise<void> {
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
    snapshots: rc.snapshots,
    meta_paths: rc.metaPaths,
    options: {
      promptHint: rc.opts.promptHint,
      contextPaths: rc.opts.contextPaths,
      subjectFile: rc.opts.subjectFile,
      modelOverrides: rc.opts.modelOverrides,
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

  const adapterCtx: AdapterContext = {
    cfg: ctx.config,
    nodePath: ctx.config.runtime.node ?? process.execPath,
  };

  const primary = h.snapshots[h.sides[0]!];
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
    snapshots: h.snapshots,
    primarySnap: primary,
    metaPaths: h.meta_paths,
    meta,
    /*
     * worker 不重复冻结：补丁已由 --start 落盘，跳过判定若为「跳过」也根本不会
     * 走到派生 worker 这一步——startRun 在派生前就已收口。
     */
    pendingDiff: null,
    skipVerdict: null,
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
   * 拉起前按**当轮入选侧**复查出的只警告项（EV-123），**恒存在**。
   * 在派生**之后**才随返回值交到调用方——拦不住拉起，价值是开场播报时就能看到、可以立即 `--cancel`。
   * `finishedInline` 时不计算（没有审查员会被拉起），为 `[]`。
   */
  warnings: PreflightWarning[];
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

  let rc: RunContext;
  try {
    rc = await prepareRun(opts);
  } catch (e) {
    await lock.release(); // 准备失败就别占着锁
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
   */
  let warnings: PreflightWarning[];
  try {
    warnings = collectWarnings(await checkModelOverrideSource(rc.sides, rc.adapters));
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
      { cwd: ctx.projectRoot, logFile: workerLogPath(rc.runDirBase) },
    );
    await fs.writeFile(workerPidPath(rc.runDirBase), `${spawned.pid}\n`, 'utf8');

    // 锁改记工作进程的 pid：从此刻起锁的持有者是它，不是 --start
    const workerStartedAt = await processStartTime(spawned.pid);
    await fs.writeFile(
      lock.path,
      JSON.stringify(
        { ...lock.content, run_id: rc.runId, pid: spawned.pid, pid_started_at: workerStartedAt },
        null,
        2,
      ) + '\n',
      'utf8',
    );

    await patchStatus(rc.runDirBase, (s) => {
      s.worker_pid = spawned.pid;
      s.worker_started_at = workerStartedAt;
      s.phase = 'running';
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
       * 模型是 profile 与 --model-* 覆盖路由后的**生效值**，让 skill 文档
       * 自己写死等于让它随配置漂移成错误播报。
       */
      stageTimeoutS: cfg.review.timeout_s[rc.stage],
      models: Object.fromEntries(
        Object.entries(rc.requests)
          .filter(([, r]) => r)
          .map(([c, r]) => [c, r!.model]),
      ) as Partial<Record<CriticId, string>>,
    };
  } catch (e) {
    // prepareRun 之后才失败：闸门已经是 running，必须连它一起回收
    await releaseRunningGate(ctx, rc.runId, rc.ref.topic, rc.stage);
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
 */
async function releaseRunningGate(
  ctx: Ctx,
  runId: string,
  topic: string | undefined,
  stage: Stage | undefined,
): Promise<void> {
  if (!topic || !stage) return;
  try {
    await setGateChecked({
      triviumDir: ctx.triviumDir,
      topic, stage, state: 'idle', runId,
      heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
      // 槽位不存在时**不要**凭空造一条 idle 记录（审查意见 AGY-02）：
      // allowMissing 默认 true 对 prepareRun（首轮槽位本就是空的）合适，对回收则不然
      expect: { state: ['running'], runId, allowMissing: false },
    });
  } catch {
    // 回收失败不该盖过真正的错误——闸门还有 TTL 兜底，但错误信息只有一次机会
  }
}

// ─────────────────────── worker ───────────────────────

/**
 * `review --worker <runId>`：工作进程本体。**不应由人直接调用**。
 *
 * 它继承 `--start` 已经冻结好的送审包，跑完 `executeRun` 后写终态并释放锁。
 */
export async function workerMain(ctx: Ctx, runId: string): Promise<number> {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const heartbeat = setInterval(() => {
    // 只刷心跳，不改语义。--wait 靠它判定「还活着」。
    // 必须 catch：Node ≥ 18 默认 unhandled rejection 即崩，磁盘满 / 目录被删时
    // 一次心跳写失败就会在两侧配额中段把整个 worker 炸掉
    patchStatus(runDir, () => {}).catch((e: unknown) => {
      if (process.env['TRIVIUM_DEBUG']) console.error('[heartbeat]', e);
    });
  }, HEARTBEAT_MS);

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
    const exitCode = e instanceof TriviumError ? e.code : EXIT.FAIL;
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
      await fs.rm(path.join(ctx.triviumDir, 'lock', `${cur.topic}.lock`), { force: true });
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
      return {
        exitCode: code,
        status: reading.status,
        progress: renderProgress(reading.status, at, budget),
        progressBrief: renderProgressBrief(reading.status, at, budget),
        budget,
        view: progressViewOf(reading.status, at, budget),
      };
    }
    if (reading.kind === 'worker_lost') {
      /*
       * 归档侧收尾（EV-142，计划 r2 §3.3）：确认工作进程已退出时，把仍为 running 的 run.json 收尾为 failed。
       *
       * **用改写 status.json 之前的事实判「已退出」**：此刻 phase 非终态，`workerConfirmedGone` 走不到
       * 「终态且从未记下 pid」那一支，判「已退出」只剩「有 pid 且进程确已不在」一种依据。下面抹凭据副本前的
       * `workerConfirmedGone(meta0, …)` 那次判定读的是本函数自己刚写成 failed 的 status.json，拿不到 pid 时会下「已不在」的结论——那次只管抹凭据副本（EV-20），不动它。
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
      await patchStatus(runDir, (s) => {
        s.phase = 'failed';
        s.exit_code = EXIT.FAIL;
        s.message = `worker_lost（${reading.reason}）`;
      });
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
       * 此刻整删载体会让该侧以莫名的鉴权错误失败。不可逆动作的准入判据与 ④ 清扫同源：
       * pid 现势不活（或已非同一进程）才抹；否则只记一句，留给会话启动清扫。
       * 失败不改变本分支的结论（本来就是失联），只在报错里附一句。
       */
      let scrubNote = '';
      // 准入判据与会话启动清扫同源；pid 取不到时回落 worker.pid，两者都没有就不抹（代码双审 r2）
      const gone = await workerConfirmedGone(meta0, fallbackPid);
      if (!gone.gone) {
        scrubNote = `\n  凭据副本未抹：${gone.why}（${reading.reason}），留给会话启动清扫`;
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
          `\n  日志：${workerLogPath(runDir)}` + archiveNote + scrubNote,
      );
    }
    if (reading.kind === 'running') last = reading.status;

    if (Date.now() >= deadline) {
      // 本次窗口用尽但运行仍在继续：这是**预期**返回，不是失败
      const starting = `运行 ${runId} 仍在启动中（尚无有效心跳）`;
      const at = Date.now();
      return {
        exitCode: EXIT.STILL_RUNNING,
        status: last,
        progress: last ? renderProgress(last, at, budget) : starting,
        progressBrief: last ? renderProgressBrief(last, at, budget) : starting,
        budget,
        view: last ? progressViewOf(last, at, budget) : null,
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
  const budget = budgetFor(ctx.config, s.stage);
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
 * 归档侧收尾每一步的播报：写了、按前提跳过用 step；异常转成的跳过用 warn。
 *
 * 异常那一档要把后果说出来（代码双审 r1 CODEX-01）：「中断后再跑 --cancel 可补齐」只对**进程中断**成立。
 * 单步写失败时本进程照常往下走、把 status.json 落终态，之后再跑 --cancel 会在终态分支早退，这一步没有第二次机会。
 */
function reportFinalizeStep(r: FinalizeStep, done: string, notDone: string): void {
  if (r.kind === 'written') step(done);
  else if (r.error) {
    warn(
      `${notDone}：${r.why}——这一步不会再有第二次机会：status.json 随后落终态，再跑 --cancel 会早退，` +
        '请人工核对归档 run.json 与 task.json 的运行登记',
    );
  } else step(`${notDone}：${r.why}`);
}

/**
 * 事后收尾每一步的一句话说明，给 worker 异常分支（拼进 status.json message）与 `--wait` 失联分支（拼进报错正文）用
 * （EV-142）。这两处都只有一个出口，所以返回字符串、不自己打印；`--cancel` 仍走上面的 `reportFinalizeStep`。
 * 异常转成的跳过同样要把后果说出来：调用方随后就把 status.json 落终态，这一步没有第二次机会。
 */
function describeFinalizeStep(r: FinalizeStep, done: string, notDone: string): string {
  if (r.kind === 'written') return done;
  if (r.error) {
    return `${notDone}：${r.why}——这一步不会再有第二次机会：status.json 随后落终态，请人工核对归档 run.json 与 task.json 的运行登记`;
  }
  return `${notDone}：${r.why}`;
}

export async function cancelRun(ctx: Ctx, runId: string): Promise<number> {
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
  if (s && ['success', 'failed', 'cancelled'].includes(s.phase)) {
    say(`运行 ${runId} 已处于终态（${s.phase}），无需取消。`);
    say('  已完成的运行不会被追溯改写——归档里的事实就是当时发生的事实。');
    return EXIT.OK;
  }
  const pid =
    s?.worker_pid ??
    (await fs
      .readFile(workerPidPath(runDir), 'utf8')
      .then((t) => Number.parseInt(t, 10) || null)
      .catch(() => null));

  if (pid !== null) {
    const live = await processAlive(pid, s?.worker_started_at ?? null);
    if (live.alive && live.sameProcess) {
      // 按**进程组**发：只杀 worker 会把 agy / zcode 遗弃给 init 继续烧配额
      step(`向工作进程组 ${pid} 发送 SIGTERM（含两侧厂商子进程）`);
      killProcessTree(pid, 'SIGTERM');
      // 宽限 5s 后 SIGKILL
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!(await processAlive(pid, s?.worker_started_at ?? null)).alive) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if ((await processAlive(pid, s?.worker_started_at ?? null)).alive) {
        warn(`工作进程组 ${pid} 未响应 SIGTERM，发送 SIGKILL`);
        killProcessTree(pid, 'SIGKILL');
      }
    } else {
      step(`工作进程 ${pid} 已不存在，仅做状态与锁的清理`);
    }
  }

  /*
   * 凭据抹除的挂载点 ③（EV-20）：`--cancel` 是 SIGKILL 的唯一入口，runner 的 finally
   * 在这条路上跑不到。准入判据与另两处同源——SIGKILL 之后再确认一次，没确认到就不抹
   * （进程组里可能还有没收到信号的后代，代码双审 r2）。
   */
  const goneNow = await workerConfirmedGone(await readStatus(runDir), pid);
  if (goneNow.gone) {
    const scrubbed = await scrubRunDir(runDir, wiredAdapter).catch(() => null);
    for (const [side, o] of Object.entries(scrubbed?.sides ?? {})) {
      if (o && !o.ok) warn(`${side} 侧凭据副本抹除失败：${o.errors[0] ?? '原因未记录'}（下次会话启动会重试）`);
    }
    // 运行目录那一层没有哨兵可留，不在这里报就是三条通道全灭
    for (const e of scrubbed?.runDir.errors ?? []) warn(`运行目录层脱敏失败：${e}`);
  } else {
    warn(`凭据副本未抹：${goneNow.why}——留给会话启动清扫`);
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

  const patched = await patchStatus(runDir, (st) => {
    st.phase = 'cancelled';
    st.exit_code = EXIT.FAIL;
    st.message = '被 --cancel 取消';
  });
  if (!patched) warn(`运行 ${runId} 没有 status.json，终态未落盘；仅回收锁与闸门`);

  // 回收锁：走 rename → 复验 → 删除，不直接 unlink
  const topic = identity?.topic;
  const stage = identity?.stage;
  if (topic) {
    const existing = await inspectLock(ctx.triviumDir, topic);
    if (existing && existing.run_id === runId) {
      await reclaimStaleLock(path.join(ctx.triviumDir, 'lock', `${topic}.lock`), existing);
      say(`已回收主题「${topic}」的锁`);
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
