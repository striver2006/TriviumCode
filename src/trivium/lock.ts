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
import type { FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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

/**
 * 读一次锁文件的结局（锁回收误判已删锁文件计划 r2 D1）。
 *
 * - `missing`：文件不存在（持有者恰已释放，或别人刚回收走）——**不是**「内容坏了」。原先两者都读成 null、判 `unparsable`，
 *   再由按路径 `stat` 的年龄得 +∞ 越过 2 s 防御，打出失实的「回收遗留锁」告警，回收时还会把刚建好的活锁挪走（EV-173 / EV-149）；
 * - `present`：文件在。`content` 读不出或解析失败时为 null（与原先「读不了 ⇒ 不可解析」同义）；`identity` / `mtimeMs` 取自
 *   **读内容的同一个描述符**的 `fstat`，`fstat` 失败才为 null。`identity` 是 `dev:ino:mtimeNs`——只比 inode 不够，
 *   ext4 等会把刚释放的 inode 号立刻分给下一个新文件；`rename` 不改 inode 与 mtime，回收前后比得上。
 */
type LockFileRead =
  | { state: 'missing' }
  | { state: 'present'; content: LockContent | null; identity: string | null; mtimeMs: number | null };

async function readLockFile(p: string): Promise<LockFileRead> {
  let fh: FileHandle;
  try {
    fh = await fs.open(p, 'r');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    return { state: 'present', content: null, identity: null, mtimeMs: null };
  }
  const got: { content: LockContent | null; identity: string | null; mtimeMs: number | null } = {
    content: null,
    identity: null,
    mtimeMs: null,
  };
  try {
    const st = await fh.stat({ bigint: true });
    got.identity = `${st.dev}:${st.ino}:${st.mtimeNs}`;
    got.mtimeMs = Number(st.mtimeMs);
    got.content = JSON.parse(await fh.readFile('utf8')) as LockContent;
  } catch {
    // 读不了或解析失败：不可解析，已取到的身份与修改时刻照给
  } finally {
    await fh.close().catch(() => undefined);
  }
  return { state: 'present', ...got };
}

async function readLock(p: string): Promise<LockContent | null> {
  const r = await readLockFile(p);
  return r.state === 'missing' ? null : r.content;
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
 * `pid_reused` 只在**取到了**持有者的启动时刻且与记录不符时成立（EV-153，并发写闸门偶发红计划 r2 D1）。持有者活着而 `ps` 取不到
 * 它的启动时刻（满载下派生失败、10 s 超时）是「判不了」：原先读成「不是同一进程」，会把一把活锁当遗留锁回收——同进程的两个
 * `setGate` 由此同时读改写 `state.json` 而丢更新，跨进程则是 `--start` 回收活 worker 的运行锁。现在往下走终态与年龄判据：
 * 短临界区锁持有超时后仍判 `heartbeat_dead`；其余不回收，等待者按原预算重试，耗满即 70（本次调用等不到年龄兜底）。
 * 本函数按 `startedAt !== null` 判，不读 `RecordMatch.identity`（两者对这一格等价）；其余消费方经 `identity` 同一口径区分
 * 「判不了」（EV-175，取不到启动时刻当不在）。
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
  // PID 存在、**取到了**启动时刻且不符 → 是被复用的无关进程，不是原持有者。
  // 取不到（`ps` 派生失败或超时，startedAt 为 null）是「判不了」，不是「不符」：往下走终态与年龄判据（EV-153 D1）
  if (!live.sameProcess && live.startedAt !== null) return 'pid_reused';

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
 * 回收遗留锁：**预检 → rename → 复验 → 删除**。返回 true 当且仅当删掉的正是判定为遗留的那一份。
 *
 * 直接 unlink 有竞态：两个并发者都判定为遗留时，第二个可能删掉第一个刚创建的新锁
 * （审查意见 GLM-04）。rename 是原子的，只有一个能成功。
 *
 * 但 rename 会把 `p` 上**此刻**的文件整个挪走——判定与 rename 之间若已换了人（慢回收者判的是旧遗留锁、快回收者已建好新锁），
 * 挪走的就是一把活锁，`p` 上随即出现空档，空档里 `link` 成功的第三者与被挪走的原持有者同时持锁；这在「放回」之前就已成立，
 * 放回方式救不回来（锁回收误判已删锁文件计划 r2 §2.1 P2，EV-149）。所以先**预检**：rename 之前再读一次 `p`，
 * 不是判定的那一份就不动它。
 *
 * 光有预检不够（实施期读数，报告 §3 偏离 D8）：两个回收者对**同一份**遗留锁都过了预检，先 rename 的一挪走它，
 * 非回收者立刻 `link` 进空档，后一个的 rename 挪走的就是那把活锁——只要一次 rename 加一次 link 落在两次系统调用之间，
 * 压测下约千分之一。所以回收前先**认领**：按判定的那份锁的身份命名一个认领文件，以 `O_EXCL` 创建，同一份遗留锁同一时刻
 * 只有一个回收者动手；认领到手后再核一次身份（拿认领之前上一个认领者可能已收掉了它）。认领期间锁路径上的这份文件
 * 只有认领者会挪；剩下的只有非回收者的删除（活持有者被误判后自己 release、`--cancel` 等收尾）——那一格由复验与放回兜住。
 * 认领只存在于几次系统调用之间；超过 `RECLAIM_CLAIM_STALE_MS` 还在只可能是认领者中途死了，按年龄清掉，交下一轮重来。
 *
 * 「是判定的那一份」的谓词（r2 D3）：
 * - 给了 `identity`（`acquireLock` 传判定那次读到的 `dev:ino:mtimeNs`）：身份相等；
 * - 没给（`run-protocol.ts` 的三处收尾，先 `inspectLock` 复核过内容）：`expected === null` ⇒ 此刻仍不可解析；
 *   否则此刻**可解析**且 pid 与 `acquired_at` 都相符。不容忍「此刻读不出」：rename 之前读不出说明有人正在改写这份锁
 *   （`workerLockContent` 的两处调用方以非原子 `writeFile` 落盘），之后读不出说明有人正往这个 inode 里写，删它等于删活锁（计划双审 AGY-01）。
 *
 * 预检、认领后的复查与复验用同一个谓词：复验防的是复查之后才换人的格。
 */
export async function reclaimStaleLock(p: string, expected: LockContent | null, identity?: string): Promise<boolean> {
  const isJudged = (r: LockFileRead): boolean => {
    if (r.state === 'missing') return false;
    if (identity !== undefined) return r.identity !== null && r.identity === identity;
    if (expected === null) return r.content === null;
    return r.content !== null && r.content.pid === expected.pid && r.content.acquired_at === expected.acquired_at;
  };
  // 预检：已不在（别人先回收了）或已换成别的锁，都不动
  const first = await readLockFile(p);
  if (!isJudged(first)) return false;
  // 认领按判定的那份锁的身份命名；外部调用方不传身份，取预检这一次读到的。取不到身份（fstat 失败）就没法认领，退回只靠预检
  const id = identity ?? (first.state === 'present' ? first.identity : null);
  const claim = id === null ? null : `${p}.reclaim-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
  if (claim !== null) {
    try {
      await fs.writeFile(claim, `${process.pid}\n`, { flag: 'wx' });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // 别的回收者正在收这一份；认领放了太久只可能是它中途死了——清掉，交调用方下一轮重来
        // （只在同身份的后来者撞上时才清得到，崩溃残件没有通用清扫，EV-174）
        const age = await fileAgeMs(claim);
        if (age !== null && age > RECLAIM_CLAIM_STALE_MS) await fs.rm(claim, { force: true }).catch(() => undefined);
      } else {
        // 其余失败同样不回收（fail-closed），但留痕：否则「回收永远不发生」无从追因（代码双审 GLM-02）
        warn(`回收主题「${path.basename(p, '.lock')}」的遗留锁时认领失败（${code ?? String(e)}），本轮不回收`);
      }
      return false;
    }
  }
  try {
    if (claim !== null) {
      // 认领之后再核一次：拿到认领之前，上一个认领者可能已经收掉了这一份（此刻锁路径上是别人的新锁或空）
      const again = await readLockFile(p);
      if (!isJudged(again) || again.state !== 'present' || again.identity !== id) return false;
    }
    return await renameAndVerify(p, isJudged);
  } finally {
    // 清理失败最多留一个残件，不该改变回收结果的类型（代码双审 CODEX-04）
    if (claim !== null) await fs.rm(claim, { force: true }).catch(() => undefined);
  }
}

/** 回收认领的遗留判据（D8）：认领只在几次系统调用之间存在，毫秒级；10 s 还在只可能是认领者中途死了 */
const RECLAIM_CLAIM_STALE_MS = 10_000;

/** 回收的后半段：rename → 复验 → 删除；复验不符则 `link` 放回（r2 D3 / D4） */
async function renameAndVerify(p: string, isJudged: (r: LockFileRead) => boolean): Promise<boolean> {
  // 随机段：同进程同一毫秒的两个回收者不得撞同一个 tmp 名（r2 D6）
  const tmp = `${p}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fs.rename(p, tmp);
  } catch {
    return false; // 别人先动手了
  }
  try {
    // 复验：拿到手的确实是我们判定为遗留的那一份
    if (isJudged(await readLockFile(tmp))) return true;
    /*
     * 不是那一份：复查之后、rename 之前换了人，挪走的是**别人的新锁**。认领之后只剩非回收者的删除能造成这一格（活持有者被误判后
     * 自己 release、`--cancel` 等收尾；取不到身份而没认领时还有并发回收者）。放回用 `link`——目标已存在就原子失败，
     * 不覆盖空档里又建好的锁（原先用 rename 放回会静默盖掉它）。放不回时两个持有者已经并存（r2 D4：成立在放回之前），
     * 救不回来，只能留痕；由持有者 release 时的「只删自己的锁」规则兜住收尾。
     */
    try {
      await fs.link(tmp, p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        warn(`回收主题「${path.basename(p, '.lock')}」的锁时挪走了一把新建的锁且放不回，可能有两个持有者`);
      }
    }
    return false;
  } finally {
    // 无论相符、放回成功还是放不回：link 不像 rename 会移走源，tmp 一律删（计划双审 AGY-02）；
    // 删不掉（例如 rename 走的是一个占着锁路径的目录）只留残件，不抛给调用方（代码双审 CODEX-04）
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/**
 * 锁文件距上次修改多久（毫秒），只给 `readLockFile` 取不到修改时刻的那一格兜底（r2 D2）。
 * 文件已不在返回 null（调用方按「锁已释放」重试）——原先得 +∞，越过 2 s 防御把一次正常释放读成遗留锁（EV-173）；
 * 其余读不到仍视为无穷久（存在而连 stat 都不行，与原先一样可回收，否则永久锁死）。
 */
async function fileAgeMs(p: string): Promise<number | null> {
  try {
    return Date.now() - (await fs.stat(p)).mtimeMs;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : Number.POSITIVE_INFINITY;
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
    const seen = await readLockFile(p);
    // 持有者恰在 EEXIST 与读锁之间释放：锁已不在，不是遗留锁——立刻重试 link，不判定、不告警、不回收（EV-173）
    if (seen.state === 'missing') continue;
    const existing = seen.content;
    const terminal = opts.runTerminal ? await opts.runTerminal(existing?.run_id ?? null) : false;
    let stale = await judgeStale(existing, {
      heartbeatStaleMs: opts.heartbeatStaleMs,
      runTerminal: terminal,
    });
    // 防御：不可解析但刚写下不久的文件，可能是别的工具正在写——别抢，重试。年龄取自判定的同一个 inode（r2 D2）
    if (stale === 'unparsable') {
      const age = seen.mtimeMs !== null ? Date.now() - seen.mtimeMs : await fileAgeMs(p);
      if (age === null) continue; // 兜底 stat 时锁已不在：同上
      if (age < 2_000) stale = null;
    }

    if (stale !== null) {
      // 只在真回收了判定的那一份之后告警：预检不符 / 别人先动手时什么都没回收（r2 D5）
      if (await reclaimStaleLock(p, existing, seen.identity ?? undefined)) {
        warn(`回收主题「${opts.topic}」的遗留锁（原因 ${stale}，原持有者 pid ${existing?.pid ?? '?'}）`);
        continue; // 立刻重试创建
      }
      // 没回收成（别人先动手 / 预检不符 / 认领被占）：隔一个间隔再来。认领者中途崩溃时认领要 10 s 才清得掉，
      // 不隔就是每轮两次 ps 派生的空转（代码双审 CODEX-02）。预算与间隔取值不变，只在这一路补上间隔
      await new Promise((r) => setTimeout(r, delay));
      continue;
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
