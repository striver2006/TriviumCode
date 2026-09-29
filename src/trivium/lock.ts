/**
 * 主题锁（设计 §12.6，按修订版 M2 计划 §2.5 实现）。
 *
 * 两类用途：
 *   - **长持锁**：`review --start` 派生的工作进程持锁到运行结束，同主题再次 `--start`
 *     返回退出码 70；
 *   - **短临界区**：任何对 `state.json` / `task.json` 的「读 → 改 → 写」都要经它。
 *     原子替换只防撕裂**不防丢更新**——`gate` / `approve` / `abandon` 都在长持锁
 *     释放之后写这两个文件，两个并发写者会互相覆盖（审查意见 GLM-08）。
 *
 * 遗留锁回收的判据是**三条取任一**，而不是设计原文的「PID 不存在**且**时间戳过期」：
 * 后者在 macOS 上不可靠（PID 复用）且会造成早期猝死时最长 120s 的死锁窗口
 * （审查意见 GLM-04 / AGY-06）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Stage } from './types.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { ensureDir, exists } from './util/fsx.js';
import { processMatchesRecord, processStartTime } from './util/exec.js';
import { warn } from './util/log.js';
import { WORKER_HEARTBEAT_MS } from './status.js';

export interface LockContent {
  topic: string;
  stage: Stage | null;
  run_id: string | null;
  pid: number;
  /** 持锁进程的启动时刻（持锁进程的缺省环境下取），用于识别 PID 复用（GLM-04） */
  pid_started_at: string | null;
  /**
   * 持锁进程的**规范化**启动时刻（`processStartTime(…, { canonical: true })`，EV-158，worker启动时刻规范化计划 r2 §4.1）。
   * null = 写时取不到；缺席 = 旧版写的。有它时 `judgeStale` 只按它比，与持锁者、判定者各自的 TZ / 区域设置无关；旧版读者忽略这个键。
   */
  pid_started_at_canonical?: string | null;
  acquired_at: string;
  /** 长持锁（工作进程）还是短临界区（状态文件读改写） */
  kind: 'run' | 'critical';
}

/**
 * 把 `--start` 拿到的锁内容改写成工作进程的（EV-158，计划 r2 §4.2 D4）。`startRun` 与 `settleOrphanedStart` 两处都经它。
 *
 * **四个键都显式覆盖，新字段值为 null 也写 null**：入参 `content` 是 `--start` 自己 `acquireLock` 写下的，带着 `--start` 进程的
 * `pid_started_at_canonical`。只覆盖 `pid_started_at` 的话，锁就成了「worker 的 pid + `--start` 的规范化启动时刻」——
 * `judgeStale` 按规范化比、判 `pid_reused`，下一个 `--start` 会把活 worker 的锁当遗留锁回收。
 * 两处调用方都以非原子的 `fs.writeFile` 落盘：并发者撕裂读判 `unparsable`，由 `acquireLock` 对修改不足 2 s 的不可解析锁
 * 不回收的防御兜住（计划 r2 §7.5，代码双审 r1 CODEX-03）。
 */
export function workerLockContent(
  content: LockContent,
  w: { runId: string; pid: number; startedAt: string | null; startedAtCanonical: string | null },
): LockContent {
  return {
    ...content,
    run_id: w.runId,
    pid: w.pid,
    pid_started_at: w.startedAt,
    pid_started_at_canonical: w.startedAtCanonical,
  };
}

/**
 * 本进程的规范化启动时刻，进程内缓存（EV-158，计划 r2 §4.2 D5）：`withGlobalLock` 争用时每次尝试都重建锁内容，
 * 不缓存就是每次多一次 `ps` 派生。进程的启动时刻终生不变、规范化形态与环境无关，缓存不改语义；取不到（null）不缓存。
 * 缺省形态**不**缓存——它随 `process.env` 变，缓存就改了今天的行为。
 */
let selfCanonicalCache: string | null = null;
async function selfCanonicalStartTime(): Promise<string | null> {
  if (selfCanonicalCache !== null) return selfCanonicalCache;
  const t = await processStartTime(process.pid, { canonical: true }).catch(() => null);
  if (t !== null) selfCanonicalCache = t;
  return t;
}

export interface LockHandle {
  path: string;
  content: LockContent;
  release: () => Promise<void>;
}

const lockDir = (triviumDir: string): string => path.join(triviumDir, 'lock');
/** 主题名允许中文与 `.`，但不允许路径分隔符（topic 校验已保证），可直接做文件名 */
const lockPath = (triviumDir: string, topic: string): string =>
  path.join(lockDir(triviumDir), `${topic}.lock`);
/**
 * 主题锁文件的路径——锁名规则的唯一来源，供本模块之外需要直接回收 / 删除锁文件的地方用
 * （`run-protocol.ts` 的 worker 收尾、`--cancel` 两处；失联后取消挂住的worker 代码双审 r1 CODEX-05）
 */
export const lockPathFor = lockPath;

async function readLock(p: string): Promise<LockContent | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as LockContent;
  } catch {
    return null;
  }
}

export type StaleReason =
  | 'pid_gone'
  | 'pid_reused'
  | 'heartbeat_dead'
  | 'unparsable'
  | null;

/**
 * 短临界区锁（`kind: 'critical'`）的持有超时：`max(heartbeat_stale_s, worker 心跳间隔)`（EV-161，临界区锁超时下限计划 r2 §3）。
 *
 * 临界区持有期间不写心跳，正常时长是毫秒到数十毫秒；原先直接拿 `heartbeat_stale_s` 当持有超时，配置只约束 `> 0`，
 * 配到亚秒（如 `0.05`）时一次正常的慢写就会被并发者判 `heartbeat_dead` 回收 ⇒ 两个持有者并存、丢更新，而且静默。
 * 下限就是 `WORKER_HEARTBEAT_MS`（不另起常量）：阈值 ≥ 30 s（含缺省 120）时取阈值本身，判定与原先逐字相同；
 * 只有更小的阈值在锁这一面被抬到 30 s。**只用于锁**——同一个阈值还原样喂 `interpretStatus` 判 worker 失联，那一面不取下限，
 * 所以下限落在这里而不是各调用方或配置读取层（计划 r2 §3.2）。非有限值与原先同为「不回收」（`age > NaN` 为假）。
 */
export function criticalHoldTimeoutMs(heartbeatStaleMs: number): number {
  return Math.max(heartbeatStaleMs, WORKER_HEARTBEAT_MS);
}

/**
 * 判定既有锁是否为遗留锁。三条判据**取任一**成立即可回收。
 *
 * @param heartbeatStaleMs 调用方传入的 `heartbeat_stale_s × 1000`；对 `critical` 锁的年龄判据经 `criticalHoldTimeoutMs`
 *                         取 30 s 下限（EV-161），`run` 锁不走年龄判据。
 * @param runTerminal 该 `run_id` 是否已被标为终态（由调用方查 `run.json` 得出）。
 *                    这一条让早期猝死不必等满心跳 TTL（AGY-06）。
 */
export async function judgeStale(
  lock: LockContent | null,
  opts: { heartbeatStaleMs: number; runTerminal?: boolean; now?: number },
): Promise<StaleReason> {
  // 锁文件存在但内容坏了：无法判定持有者，只能视为遗留（否则永久锁死）
  if (!lock) return 'unparsable';

  // 有规范化启动时刻就只按它比，没有（旧版写的）退回缺省环境比较（EV-158）
  const live = await processMatchesRecord(lock.pid, {
    canonical: lock.pid_started_at_canonical,
    legacy: lock.pid_started_at,
  });
  if (!live.alive) return 'pid_gone';
  // PID 存在但启动时刻不符 → 是被复用的无关进程，不是原持有者
  if (!live.sameProcess) return 'pid_reused';

  // 进程确实还活着：只有在「运行已终态」时才认为锁该收
  if (opts.runTerminal === true) return 'heartbeat_dead';

  const age = (opts.now ?? Date.now()) - new Date(lock.acquired_at).getTime();
  if (Number.isFinite(age) && age > criticalHoldTimeoutMs(opts.heartbeatStaleMs) && lock.kind === 'critical') {
    // 短临界区本应毫秒级完成，持有超过持有超时（阈值与心跳间隔取大，EV-161）说明持有者卡死了
    return 'heartbeat_dead';
  }
  return null;
}

/**
 * 回收遗留锁：**rename → 复验 → 删除**。
 *
 * 直接 unlink 有竞态：两个并发者都判定为遗留时，第二个可能删掉第一个刚创建的新锁
 * （审查意见 GLM-04）。rename 是原子的，只有一个能成功。
 */
export async function reclaimStaleLock(p: string, expected: LockContent | null): Promise<boolean> {
  const tmp = `${p}.stale-${process.pid}-${Date.now()}`;
  try {
    await fs.rename(p, tmp);
  } catch {
    return false; // 别人先动手了
  }
  // 复验：拿到手的确实是我们判定为遗留的那一份
  const got = await readLock(tmp);
  const same =
    expected === null
      ? got === null // 原本就不可解析：此刻若已是合法锁，那是别人刚建的
      : got === null || (got.pid === expected.pid && got.acquired_at === expected.acquired_at);
  if (same) {
    await fs.rm(tmp, { force: true });
    return true;
  }
  /*
   * 不是那一份：原持有者已 release、别人已重新持有，我们 rename 走的是**别人的新锁**。
   * 原先这里照样 rm——复验结论既不影响删除、调用方也忽略返回值，头注释承诺的
   * 「防第二个删掉第一个刚创建的新锁」从未兑现，结果是两个进程同时「持锁」。
   * 放回去；放不回（此刻又冒出一把新锁）只能丢弃这一份，由持有者 release 时的
   * 「只删自己的锁」规则兜底。
   */
  try {
    await fs.rename(tmp, p);
  } catch {
    await fs.rm(tmp, { force: true });
  }
  return false;
}

/** 锁文件距上次修改多久（毫秒）；读不到视为无穷久 */
async function fileAgeMs(p: string): Promise<number> {
  try {
    return Date.now() - (await fs.stat(p)).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface AcquireOptions {
  triviumDir: string;
  topic: string;
  stage?: Stage | null;
  runId?: string | null;
  kind?: 'run' | 'critical';
  /** `heartbeat_stale_s × 1000`，只交给 `judgeStale`；对 `critical` 锁的年龄判据取 30 s 下限（`criticalHoldTimeoutMs`，EV-161） */
  heartbeatStaleMs: number;
  /** 该 run_id 是否已终态，交给 judgeStale 的第 3 条判据 */
  runTerminal?: (runId: string | null) => Promise<boolean>;
  /** 拿不到锁时的重试（短临界区用）。0 表示不重试，直接抛 70 */
  retries?: number;
  retryDelayMs?: number;
}

/** 获取锁。拿不到且不重试时抛 `EXIT.LOCKED`（70），并带上现有 run_id 供人排查 */
export async function acquireLock(opts: AcquireOptions): Promise<LockHandle> {
  const p = lockPath(opts.triviumDir, opts.topic);
  await ensureDir(lockDir(opts.triviumDir));

  const retries = opts.retries ?? 0;
  const delay = opts.retryDelayMs ?? 200;

  for (let attempt = 0; ; attempt++) {
    const content: LockContent = {
      topic: opts.topic,
      stage: opts.stage ?? null,
      run_id: opts.runId ?? null,
      pid: process.pid,
      pid_started_at: await processStartTime(process.pid),
      pid_started_at_canonical: await selfCanonicalStartTime(),
      acquired_at: new Date().toISOString(),
      kind: opts.kind ?? 'critical',
    };

    /*
     * 先把完整内容写进临时文件，再 `link` 进位：`link` 在目标已存在时原子地失败（EEXIST），
     * 成功时目标文件**一出现就是完整内容**。原先是 `open('wx')` 之后再 `writeFile`，
     * 两步之间存在一个空文件窗口——并发者此时 readLock 得 null、judgeStale 判 `unparsable`、
     * 立刻把一把活锁当遗留锁回收掉。withGlobalLock 默认 40×100ms 重试，两个会话同时写
     * state.json 时这个窗口会被反复命中。
     */
    const tmp = `${p}.tmp-${process.pid}-${randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(content, null, 2) + '\n');
    try {
      await fs.link(tmp, p);
      return {
        path: p,
        content,
        release: async () => {
          // 只删自己的锁：内容不符说明已被回收并被别人重新持有
          const cur = await readLock(p);
          if (cur && cur.pid === content.pid && cur.acquired_at === content.acquired_at) {
            await fs.rm(p, { force: true });
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    } finally {
      await fs.rm(tmp, { force: true });
    }

    // 已被占用：看是不是遗留锁
    const existing = await readLock(p);
    const terminal = opts.runTerminal ? await opts.runTerminal(existing?.run_id ?? null) : false;
    let stale = await judgeStale(existing, {
      heartbeatStaleMs: opts.heartbeatStaleMs,
      runTerminal: terminal,
    });
    // 防御：不可解析但刚写下不久的文件，可能是别的工具正在写——别抢，重试
    if (stale === 'unparsable' && (await fileAgeMs(p)) < 2_000) stale = null;

    if (stale !== null) {
      warn(`回收主题「${opts.topic}」的遗留锁（原因 ${stale}，原持有者 pid ${existing?.pid ?? '?'}）`);
      await reclaimStaleLock(p, existing);
      continue; // 立刻重试创建
    }

    if (attempt >= retries) {
      throw new TriviumError(
        EXIT.LOCKED,
        `主题「${opts.topic}」已被占用：run_id ${existing?.run_id ?? '未知'}` +
          `（pid ${existing?.pid ?? '?'}，自 ${existing?.acquired_at ?? '?'} 起）。\n` +
          `  若确认该运行已卡死，可用 \`trivium review --cancel <run_id>\` 取消。`,
      );
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}

/**
 * 在短临界区内执行一次「读 → 改 → 写」。
 *
 * 所有 `state.json` / `task.json` 的写入都必须经这里（GLM-08）——包括 `gate`、
 * `/dual-approve`、`/dual-abandon` 这些在长持锁释放之后才发生的写者。
 */
export async function withTopicLock<T>(
  opts: Omit<AcquireOptions, 'kind'> & { retries?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await acquireLock({
    ...opts,
    kind: 'critical',
    retries: opts.retries ?? 20,
    retryDelayMs: opts.retryDelayMs ?? 150,
  });
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

/**
 * 全局短临界区。
 *
 * `state.json` 是**全局单文件**（`.trivium/state.json`），因此按主题加锁**不够**：
 * 两个不同主题并发写会各拿到自己的锁、同时读改写同一个文件而丢更新
 * （审查意见 GLM-08 说的正是这件事，本实现的第一版就这样错了，被并发用例抓到）。
 * `task.json` 按主题存放（`.reviews/<主题>/task.json`），用主题锁是对的。
 *
 * 锁文件名以 `.` 开头，而主题名禁止以 `.` 开头（§6.1），因此不可能与主题锁撞名。
 */
const GLOBAL_LOCK_TOPIC = '.global-state';

export async function withGlobalLock<T>(
  opts: { triviumDir: string; heartbeatStaleMs: number; retries?: number; retryDelayMs?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await acquireLock({
    triviumDir: opts.triviumDir,
    topic: GLOBAL_LOCK_TOPIC,
    kind: 'critical',
    heartbeatStaleMs: opts.heartbeatStaleMs,
    retries: opts.retries ?? 40,
    retryDelayMs: opts.retryDelayMs ?? 100,
  });
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

/** 只读查询：主题当前是否被占用（`status` 与 `hook-session-start` 用） */
export async function inspectLock(
  triviumDir: string,
  topic: string,
): Promise<LockContent | null> {
  const p = lockPath(triviumDir, topic);
  if (!(await exists(p))) return null;
  return readLock(p);
}

/**
 * `hook-stop` 的每阶段阻断计数。
 *
 * 不走主题锁：hook 只有 30s 超时预算，等锁不合适（审查意见 GLM-08）。
 *
 * 实现上**不能**用「读文件 → 加一 → 写回」——那不是原子操作，两个并发 hook
 * 会都读到 N 再都写 N+1，计数丢失（本实现的第一版真的这样错了，被并发用例抓到）。
 * 改为「每次自增就用 `O_EXCL` 建一个唯一命名的空文件，计数 = 目录条目数」：
 * 创建唯一文件天然无冲突，计数是纯读取，全程无需互斥。
 */

const stopBlockDir = (triviumDir: string, topic: string, stage: Stage): string =>
  path.join(triviumDir, 'lock', `stopblock-${topic}-${stage}`);

export async function bumpStopBlockCount(
  triviumDir: string,
  topic: string,
  stage: Stage,
  max: number,
): Promise<{ count: number; exceeded: boolean }> {
  const dir = stopBlockDir(triviumDir, topic, stage);
  await ensureDir(dir);
  // 唯一命名 + O_EXCL：两个并发者不可能撞车，因此不会丢计数
  const fh = await fs.open(path.join(dir, `${Date.now()}-${randomUUID()}`), 'wx');
  await fh.close();

  const count = (await fs.readdir(dir)).length;
  return { count, exceeded: count > max };
}

export async function resetStopBlockCount(
  triviumDir: string,
  topic: string,
  stage: Stage,
): Promise<void> {
  await fs.rm(stopBlockDir(triviumDir, topic, stage), { recursive: true, force: true });
}
