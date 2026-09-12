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
import { acquireLock, inspectLock, reclaimStaleLock } from './lock.js';
import {
  computeMaxWaits, interpretStatus, newStatus, patchStatus, readStatus,
  renderProgress, writeStatus, type RunStatus,
} from './status.js';
import {
  executeRun, prepareRun, repoId, type PreparedRun, type ReviewOptions, type RunContext,
} from './review.js';
import { resolveTopic } from './topic.js';
import { readRunMeta } from './meta.js';
import { setGateChecked } from './state.js';
import { agyAdapter } from './adapters/agy.js';
import { zcodeAdapter } from './adapters/zcode.js';
import type { AdapterContext } from './adapters/base.js';
import { resolveAdapters } from './adapters/stub.js';
import { ensureDir, exists } from './util/fsx.js';
import { killProcessTree, processAlive, processStartTime, spawnDetached } from './util/exec.js';
import { fail, say, step, warn } from './util/log.js';

/** 心跳间隔：设计 §7.5 规定 30s */
const HEARTBEAT_MS = 30_000;

export const runDirFor = (cfg: Config, projectRoot: string, runId: string): string =>
  path.join(runRoot(cfg), repoId(projectRoot), runId);

const requestPath = (runDir: string): string => path.join(runDir, 'request.json');
const workerPidPath = (runDir: string): string => path.join(runDir, 'worker.pid');
const workerLogPath = (runDir: string): string => path.join(runDir, 'worker.log');

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
    onlyCritic: CriticId | null;
    assetRoot?: string;
    /** 会话 id 与临时降级开关必须一起交接：worker 是另一个进程，读不到 --start 的 argv */
    sessionId: string | null;
    allowSingle: boolean;
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
      onlyCritic: rc.opts.onlyCritic ?? null,
      sessionId: rc.opts.sessionId ?? null,
      allowSingle: rc.opts.allowSingle === true,
      entry: rc.opts.entry ?? null,
      ...(rc.opts.assetRoot ? { assetRoot: rc.opts.assetRoot } : {}),
    },
  };
  await fs.writeFile(requestPath(rc.runDirBase), JSON.stringify(h, null, 2) + '\n', 'utf8');
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
      onlyCritic: h.options.onlyCritic,
      sessionId: h.options.sessionId ?? null,
      allowSingle: h.options.allowSingle === true,
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
    adapters: resolveAdapters({ gemini: agyAdapter, glm: zcodeAdapter }),
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

export interface StartOutcome {
  runId: string;
  /** skill 侧的 `--wait` 循环上限 */
  maxWaits: number;
  /** 每次 `--wait` 应传的秒数 */
  waitTimeoutS: number;
  /** skill 必须为每次 --wait 的 Bash 调用设置的工具级超时（毫秒） */
  bashTimeoutMs: number;
  workerPid: number;
  runDir: string;
  /**
   * 本次运行在同步窗口内就已完成，**没有**派生 worker，调用方不必再 `--wait`。
   * 目前唯一的来源是 FR-23 的纯文档跳过。
   */
  finishedInline?: boolean;
  /** finishedInline 时的人读说明 */
  inlineNotice?: string;
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
        bashTimeoutMs: 600_000,
        workerPid: process.pid,
        runDir: rc.runDirBase,
        finishedInline: true,
        inlineNotice: out.warnings.join('\n'),
      };
    } finally {
      await lock.release(); // 没有 worker 接手，锁必须在这里还
    }
  }

  try {
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
      // 每次 --wait 的 Bash 调用必须显式抬到 600s 上限：默认 120s 会把它杀掉
      // （审查意见 GLM-02，也是 M2 完成判据 6）
      bashTimeoutMs: 600_000,
      workerPid: spawned.pid,
      runDir: rc.runDirBase,
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
    fail(msg);
    // 终态必须写下来，否则 --wait 只能等到心跳过期才判失联
    await patchStatus(runDir, (s) => {
      s.phase = 'failed';
      s.exit_code = e instanceof TriviumError ? e.code : EXIT.FAIL;
      s.message = msg;
    });
    return e instanceof TriviumError ? e.code : EXIT.FAIL;
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
      return {
        exitCode: code,
        status: reading.status,
        progress: renderProgress(reading.status),
      };
    }
    if (reading.kind === 'worker_lost') {
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
      throw new TriviumError(
        EXIT.FAIL,
        `运行 ${runId} 的工作进程失联（${reading.reason}）。` +
          `\n  日志：${workerLogPath(runDir)}`,
      );
    }
    if (reading.kind === 'running') last = reading.status;

    if (Date.now() >= deadline) {
      // 本次窗口用尽但运行仍在继续：这是**预期**返回，不是失败
      return {
        exitCode: EXIT.STILL_RUNNING,
        status: last,
        progress: last
          ? renderProgress(last)
          : `运行 ${runId} 仍在启动中（尚无有效心跳）`,
      };
    }
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}

/** `review --status <runId>`：只读一次，不等待 */
export async function statusRun(ctx: Ctx, runId: string): Promise<{ exitCode: number; status: RunStatus | null; progress: string }> {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const s = await readStatus(runDir);
  if (!s) {
    return {
      exitCode: EXIT.MISSING_ARTIFACT,
      status: null,
      progress: `找不到运行 ${runId} 的状态文件（${runDir}）`,
    };
  }
  const code =
    s.phase === 'success' ? EXIT.OK
    : s.phase === 'failed' ? EXIT.FAIL
    : s.phase === 'cancelled' ? EXIT.FAIL
    : EXIT.STILL_RUNNING;
  return { exitCode: code, status: s, progress: renderProgress(s) };
}

/**
 * `review --cancel <runId>`：SIGTERM → 宽限 → SIGKILL，标 `cancelled`，回收锁。
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
