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
import type { Config, CriticId, CriticRequest, Ctx, Stage } from './types.js';
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
import { agyAdapter } from './adapters/agy.js';
import { zcodeAdapter } from './adapters/zcode.js';
import type { AdapterContext } from './adapters/base.js';
import { ensureDir, exists } from './util/fsx.js';
import { processAlive, processStartTime, spawnDetached } from './util/exec.js';
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
      ...(h.options.assetRoot ? { assetRoot: h.options.assetRoot } : {}),
    } satisfies ReviewOptions,
    cfg: ctx.config,
    ctx,
    stage: h.stage,
    ref,
    adapterCtx,
    adapters: { gemini: agyAdapter, glm: zcodeAdapter },
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
    await lock.release();
    throw e;
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
    // 只刷心跳，不改语义。--wait 靠它判定「还活着」
    void patchStatus(runDir, () => {});
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
      for (const c of rc.sides) {
        if (s.sides[c]) s.sides[c]!.state = 'ok';
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
    // 释放锁：工作进程是最终持有者
    const cur = await inspectLock(ctx.triviumDir, (await readStatus(runDir))?.topic ?? '');
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
export async function cancelRun(ctx: Ctx, runId: string): Promise<number> {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const s = await readStatus(runDir);
  const pid =
    s?.worker_pid ??
    (await fs
      .readFile(workerPidPath(runDir), 'utf8')
      .then((t) => Number.parseInt(t, 10) || null)
      .catch(() => null));

  if (pid !== null) {
    const live = await processAlive(pid, s?.worker_started_at ?? null);
    if (live.alive && live.sameProcess) {
      step(`向工作进程 ${pid} 发送 SIGTERM`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* 已退出 */
      }
      // 宽限 5s 后 SIGKILL
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!(await processAlive(pid, s?.worker_started_at ?? null)).alive) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if ((await processAlive(pid, s?.worker_started_at ?? null)).alive) {
        warn(`工作进程 ${pid} 未响应 SIGTERM，发送 SIGKILL`);
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* ignore */
        }
      }
    } else {
      step(`工作进程 ${pid} 已不存在，仅做状态与锁的清理`);
    }
  }

  await patchStatus(runDir, (st) => {
    st.phase = 'cancelled';
    st.exit_code = EXIT.FAIL;
    st.message = '被 --cancel 取消';
  });

  // 回收锁：走 rename → 复验 → 删除，不直接 unlink
  const topic = s?.topic;
  if (topic) {
    const existing = await inspectLock(ctx.triviumDir, topic);
    if (existing && existing.run_id === runId) {
      await reclaimStaleLock(path.join(ctx.triviumDir, 'lock', `${topic}.lock`), existing);
      say(`已回收主题「${topic}」的锁`);
    }
  }
  say(`运行 ${runId} 已取消`);
  return EXIT.OK;
}
