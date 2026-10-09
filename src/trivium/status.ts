/**
 * `status.json`：工作进程的心跳与状态（设计 §7.5，按修订版 M2 计划 §2.1 实现）。
 *
 * `--wait` 的**全部**判定都压在这个文件上，因此它的生命周期必须定义清楚——
 * 原稿把这一点留空了（审查意见 GLM-06）：
 *   - **文件不存在** ≠ 失败。它意味着「尚未产生有效心跳」，要与「进程是否存活」
 *     合并判定：进程活 → 继续等；进程死 → `worker_lost`。
 *   - **解析失败**（读到写了一半的 JSON）≠ 失败。本次轮询无效、继续等，
 *     并计入 `--timeout` 预算。
 *
 * 写入走与 `state.json` / `task.json` 相同的「临时文件 + rename」原子替换纪律，
 * 使撕裂读在正常情况下根本不会发生；上面那条解析失败的兜底是防御性的。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CriticId, Stage } from './types.js';
import { writeAtomic, exists } from './util/fsx.js';
import { RUN_DIR_FILES } from './run-files.js';
import {
  processGroupMemberCount, processMatchesRecord, processStartTime, type RecordedStart, type TrackedTree,
} from './util/exec.js';

export type RunPhase =
  | 'starting'
  | 'running'
  | 'parsing'
  | 'archiving'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface SideStatus {
  state: 'pending' | 'running' | 'ok' | 'failed' | 'timeout' | 'parse_fallback';
  /** 路由后的请求模型，运行状态本身不提供模型回读。 */
  model: string | null;
  attempt: number;
  elapsed_s: number;
  note?: string | null;
  /**
   * 该侧正在跑的审查员 CLI 进程组（EV-154，CLI进程组记录计划 r2 §4.3）。worker 从 `liveTrees` 派生、派生当时即写，
   * CLI 退出时清成 null。缺席（旧版 worker 写的）与 null 读者一律当「没有记录」；旧版读者忽略这个键。
   */
  cli?: CliGroupRecord | null;
}

/** 一侧审查员 CLI 的进程组记录（EV-154） */
export interface CliGroupRecord {
  /** 进程组号 = 组长 pid（`killTree` ⇒ `detached` ⇒ 组长） */
  pgid: number;
  /** 组长的规范化启动时刻（`processStartTime(…, { canonical: true })`）；null = 尚未取到或取不到 */
  started_at: string | null;
}

export interface RunStatus {
  schema: 'trivium.status.v1';
  run_id: string;
  topic: string;
  stage: Stage;
  phase: RunPhase;
  /** 工作进程 pid 与其启动时刻（`--start` 的缺省环境下取）——判定失联时要能识别 PID 复用 */
  worker_pid: number | null;
  worker_started_at: string | null;
  /**
   * 工作进程的**规范化**启动时刻（`processStartTime(…, { canonical: true })`，EV-158，worker启动时刻规范化计划 r2 §4.1），
   * 与 `worker_pid` / `worker_started_at` 同一次写入。null = 写时取不到；缺席 = 旧版写的。有它时身份判据只按它比
   * （`processMatchesRecord`），与 `--start` 和读者各自的 TZ / 区域设置无关；旧版读者忽略这个键。
   * `--wait --json` 与 `--status --json` 整份透出 status，这个键因此也是对外 JSON 形状的加法。
   */
  worker_started_at_canonical?: string | null;
  started_at: string;
  /** 每次心跳更新，`--wait` 据此判定失联 */
  heartbeat_at: string;
  sides: Partial<Record<CriticId, SideStatus>>;
  /** 终态时填：落盘的工件相对路径 */
  artifacts: string[];
  /** 终态时填：退出码，供 `--wait` 原样透出 */
  exit_code: number | null;
  message: string | null;
  /**
   * `--wait` 判 `worker_lost` 时记下的结构化事实（EV-146，失联后取消挂住的worker计划 r2 §4.1）：原因与判定时刻，
   * 与 `phase: failed`、`message` 在同一次写入里落盘。`--cancel` 据它判「失联后仍挂着的 worker」那一格，不读 `message`。
   * 缺席（旧版 `--wait` 写的、或不是 `--wait` 判失联写的终态）与 null 读者一律当「没有」；旧版读者忽略这个键。
   * worker 恢复后自己的写入会保留它（读改写不删不认识的键），所以它说的是「曾被判失联」，不是「现在仍失联」。
   * `--wait --json` 与 `--status --json` 整份透出 status，这个键因此也是对外 JSON 形状的加法。
   */
  lost?: WorkerLostRecord | null;
}

/** status.json `lost` 的形状（EV-146） */
export interface WorkerLostRecord {
  reason: WorkerLostReason;
  /** 判定时刻（ISO 8601） */
  at: string;
}

export const statusPath = (runDir: string): string => path.join(runDir, RUN_DIR_FILES.status);

export function newStatus(i: {
  runId: string;
  topic: string;
  stage: Stage;
  sides: CriticId[];
  models: Partial<Record<CriticId, string>>;
}): RunStatus {
  const now = new Date().toISOString();
  const sides: Partial<Record<CriticId, SideStatus>> = {};
  for (const c of i.sides) {
    sides[c] = { state: 'pending', model: i.models[c] ?? null, attempt: 0, elapsed_s: 0 };
  }
  return {
    schema: 'trivium.status.v1',
    run_id: i.runId,
    topic: i.topic,
    stage: i.stage,
    phase: 'starting',
    worker_pid: null,
    worker_started_at: null,
    worker_started_at_canonical: null,
    started_at: now,
    heartbeat_at: now,
    sides,
    artifacts: [],
    exit_code: null,
    message: null,
  };
}

/** 原子写。心跳时间戳每次都刷新 */
export async function writeStatus(runDir: string, s: RunStatus): Promise<void> {
  s.heartbeat_at = new Date().toISOString();
  await writeAtomic(statusPath(runDir), JSON.stringify(s, null, 2) + '\n');
}

export async function readStatus(runDir: string): Promise<RunStatus | null> {
  const p = statusPath(runDir);
  if (!(await exists(p))) return null;
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as RunStatus;
  } catch {
    return null; // 撕裂读或损坏：由 interpretStatus 归入「本次轮询无效」
  }
}

/**
 * 读改写。**同一进程内按 runDir 串行化**。
 *
 * worker 里心跳定时器与终态写入在同一个事件循环里交错：心跳在终态写入之前读、
 * 之后写，终态就被回滚成 running，`--wait` 只能等到心跳过期判 worker_lost，
 * 把一次成功的运行报成失联。两者都在同一进程，一条 promise 链就能消掉这个窗口。
 */
const patchQueues = new Map<string, Promise<unknown>>();

export async function patchStatus(
  runDir: string,
  mutate: (s: RunStatus) => void,
): Promise<RunStatus | null> {
  const prev = patchQueues.get(runDir) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const s = await readStatus(runDir);
      if (!s) return null;
      mutate(s);
      await writeStatus(runDir, s);
      return s;
    });
  patchQueues.set(runDir, next);
  try {
    return await next;
  } finally {
    if (patchQueues.get(runDir) === next) patchQueues.delete(runDir);
  }
}

/**
 * status.json 里工作进程的身份记录（EV-158）：规范化启动时刻与缺省环境下的启动时刻，交给 `processMatchesRecord`。
 * 身份消费方（`workerConfirmedGone`、`interpretStatus`、`workerStillAlive`、`--cancel` 主路径与失联后取消那一格）都经它取，
 * 两个字段不会各取各的。取不到启动时刻（活着而 `ps` 失败）时各自的处置按 `RecordMatch.identity` 分（EV-175）。
 */
export function workerStartOf(s: RunStatus, legacyFallback: string | null = null): RecordedStart {
  return { canonical: s.worker_started_at_canonical, legacy: s.worker_started_at ?? legacyFallback };
}

export const TERMINAL_PHASES: readonly RunPhase[] = ['success', 'failed', 'cancelled'];
export const isTerminal = (p: RunPhase): boolean => TERMINAL_PHASES.includes(p);

/**
 * 「工作进程确认已经不在了」——**不可逆动作的唯一准入判据**（BACKLOG EV-20）。
 *
 * 抹除凭据副本是不可逆的：抹早了，正在跑的那一侧会以莫名的鉴权错误失败。所以判据必须是
 * **确认不在**，而不是「没看到它在」。三处调用点（`waitRun` 的 `worker_lost`、`cancelRun`、
 * 会话启动清扫）共用这一个函数——代码双审 r2 三侧各自从不同角度指出它们此前**并不同源**：
 *
 * - 终态（`phase: failed` 等）此前被直接当作「已死」。而 `waitRun` 判 `heartbeat_stale` 时
 *   正是**把活着的进程写成 failed**，于是「留给会话启动清扫」这句承诺反过来变成了
 *   「下次会话启动无条件抹」（AGY-01）。终态同样要看进程。
 * - `status.json` 读不到、或里面没有 pid 时，此前有的地方当「已死」直接抹、有的地方跳过
 *   （CODEX-05 ≡ GLM-02）。没有 pid 就是**没有证据**，一律不抹。
 * - `starting` 是副本正在写下的窗口，任何情况下都不抹。
 * - 进程活着而取不到它的启动时刻（`identity: 'unverifiable'`，EV-175）是**判不了**，不算已不在：满载下 `ps` 派生失败或
 *   超时时，此前这一格读成「不是同一进程」而判「已不存在」，于是抹掉活 worker 的凭据副本、补收它的 run.json、
 *   按记录结束它名下的 CLI（取不到启动时刻当不在计划 r2 §2 探针 G-running / C-wait / G-cancel-terminal）。
 *
 * `fallbackPid` 是 `worker.pid` 文件——`interpretStatus` 自己就用它兜底，这里同源复用。
 */
export async function workerConfirmedGone(
  status: RunStatus | null,
  fallbackPid: number | null = null,
): Promise<{ gone: boolean; why: string }> {
  if (!status) return { gone: false, why: 'status.json 读不到：没有任何证据' };
  if (status.phase === 'starting') {
    return { gone: false, why: '运行处于 starting：副本可能正在写下' };
  }
  const pid = status.worker_pid ?? fallbackPid;
  if (pid !== null && pid !== undefined) {
    const live = await processMatchesRecord(pid, workerStartOf(status));
    if (live.alive && live.sameProcess) return { gone: false, why: `工作进程 ${pid} 仍在` };
    if (live.identity === 'unverifiable') {
      return { gone: false, why: `工作进程 ${pid} 仍在，但取不到它的启动时刻：判不了是不是 status.json 记录的那个进程` };
    }
    return { gone: true, why: `工作进程 ${pid} 已不存在` };
  }
  /*
   * 拿不到 pid：只有**终态**才敢下「已经不在」的结论。
   *
   * 终态且从未记下 pid ⇒ worker 压根没起来（`--start` 早退），没有活进程会用那份副本。
   * 非终态（running / parsing / archiving）而 pid 不见了 ⇒ 它可能正在跑，只是 pid 没落盘——
   * 这一档没有证据，不抹（代码双审 r2 CODEX-05 ≡ GLM-02）。
   */
  if (isTerminal(status.phase)) return { gone: true, why: '运行已终态且从未记下 worker_pid' };
  return { gone: false, why: `运行处于 ${status.phase} 却拿不到 worker_pid：判不了` };
}

// ─────────────────────── 审查员 CLI 进程组记录（EV-154） ───────────────────────

/**
 * 把 `liveTrees` 的投影写成逐侧记录（worker 的观察者在 `patchStatus` 的 mutate 里调，CLI进程组记录计划 r2 §4.3）。
 *
 * 每侧取 tag 等于侧名、**最近登记**的那一个；没有则 null（用户决策 1「每侧一份」）。今天每侧同一时刻只有一个
 * `killTree` 的 `run()`；日后若并发派生两个，记录取后登记的，它退出后投影回落到前一个。tag 为 null（侧外派生）
 * 或不在 `sides` 里的条目忽略。mutate 在写之前同步读快照，所以不论通知与写入怎么交错，最后写下去的都是当时的投影。
 */
export function syncCliRecords(s: RunStatus, trees: readonly TrackedTree[]): void {
  for (const [critic, side] of Object.entries(s.sides) as Array<[CriticId, SideStatus | undefined]>) {
    if (!side) continue;
    const t = trees.filter((x) => x.tag === critic).at(-1);
    side.cli = t ? { pgid: t.pgid, started_at: t.startedAt } : null;
  }
}

/**
 * 读逐侧记录，三态（计划双审 r1 GLM-02）：键缺席或 null ⇒ 没有记录；形状合法 ⇒ `records`；
 * 键在而形状不合法（手改坏的、未来版本改了形状）⇒ `malformed`——取消侧不发信号，准入侧判不可抹（读不懂就是判不了）。
 * pgid 必须是 >1 的整数：`kill(-1)` 是发给全部进程，`kill(-0)` 是发给自己的组。
 */
export function cliRecordsOf(s: RunStatus | null): {
  records: Array<{ side: CriticId } & CliGroupRecord>;
  malformed: CriticId[];
} {
  const records: Array<{ side: CriticId } & CliGroupRecord> = [];
  const malformed: CriticId[] = [];
  const sides = s?.sides;
  if (!sides || typeof sides !== 'object') return { records, malformed };
  for (const [critic, side] of Object.entries(sides) as Array<[CriticId, SideStatus | undefined]>) {
    const cli: unknown = side?.cli;
    if (cli === undefined || cli === null) continue;
    const r = cli as { pgid?: unknown; started_at?: unknown };
    const okPgid = typeof r.pgid === 'number' && Number.isInteger(r.pgid) && r.pgid > 1;
    const okStart = r.started_at === null || typeof r.started_at === 'string';
    if (typeof cli === 'object' && okPgid && okStart) {
      records.push({ side: critic, pgid: r.pgid as number, started_at: r.started_at as string | null });
    } else {
      malformed.push(critic);
    }
  }
  return { records, malformed };
}

/** 某侧 `cli` 键的原始值（JSON，截断到 200 字），供形状坏时如实带出（代码双审 r1 CODEX-04） */
export function rawCliOf(s: RunStatus | null, side: CriticId): string {
  let t: string;
  try {
    t = JSON.stringify((s?.sides?.[side] as { cli?: unknown } | undefined)?.cli) ?? 'undefined';
  } catch {
    t = '（无法序列化）';
  }
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

export type CliGroupVerdict = 'alive' | 'gone' | 'reused' | 'unverifiable' | 'orphaned' | 'orphan_unverifiable';

/**
 * 一条 CLI 记录现在指向什么（EV-165 起：组长不在时不再直接放行，改按组号下的非僵尸成员数判；代码双审 r1 CODEX-01
 * 核出下面三分法此前被误写成两分法——`reused` 放行准入、`unverifiable` 阻挡准入，两者语义相反，不能合并）：
 * 组长在——`started_at` 为 null ⇒ `unverifiable`（判不了）；规范化启动时刻取不到、复检后组长仍在 ⇒ 同样 `unverifiable`
 * （判不了，与「启动时刻没记下」同一档，**不是** `reused`）；规范化启动时刻不符 ⇒ `reused`（组号已被复用）；
 * 相符 ⇒ `alive`。组长不在（含「复检确认组长已退出」这条路径，与 `!alive` 分支是同一个事实、必须共用同一判据）——
 * 非僵尸成员数为 0 ⇒ `gone`（视同已结束）；> 0 ⇒ `orphaned`（组号仍有效，只是组长换了后代占着，不是新的复用）；
 * 成员数取不到（`ps` 失败）⇒ `orphan_unverifiable`（判不了，按挡住处理，不去猜）。
 *
 * 组员仍在时组号不会被复用（零配额实测，`doc/05_testing/evidence/orphan-cli-admission-20260929/`：连续造 30/40 个
 * 「组长已退、只剩带标记非僵尸成员」的孤儿组，派生进程到 pid 空间回绕一整圈，零个新进程拿到仍有成员的组号）——
 * 这正是 EV-154 用户决策 4「组长已退出而组员还在的那一格如实保留……不去猜组号是否已被接手」的前提被推翻之处：
 * 不需要猜，组号下的非僵尸成员必是原组的后代。
 *
 * 不借 `processAlive` 的 `sameProcess`：`started_at` 为 null 时它给 true（等于「缺失 = 相符」），而且它取启动时刻不带
 * 规范化环境。`unverifiable` 在 pid 被复用且占有者活着期间一直是 `unverifiable`——没有比对基准就判不出 `reused`（AGY-01）。
 */
export async function judgeCliGroup(
  r: CliGroupRecord,
  o: { memberCountOf?: (pgid: number) => Promise<number | null>; out?: { membersLeft?: number | null } } = {},
): Promise<CliGroupVerdict> {
  const memberCountOf = o.memberCountOf ?? processGroupMemberCount;
  /** 组长确认不在（无论从哪条路径发现的）：按非僵尸成员数判 gone / orphaned / orphan_unverifiable，只数、不猜 */
  const leaderGone = async (): Promise<CliGroupVerdict> => {
    const n = await memberCountOf(r.pgid);
    if (o.out) o.out.membersLeft = n;
    if (n === null) return 'orphan_unverifiable';
    return n > 0 ? 'orphaned' : 'gone';
  };
  let alive: boolean;
  try {
    process.kill(r.pgid, 0);
    alive = true;
  } catch (e) {
    alive = (e as NodeJS.ErrnoException).code === 'EPERM';
  }
  if (!alive) return leaderGone();
  if (r.started_at === null) return 'unverifiable';
  const now = await processStartTime(r.pgid, { canonical: true });
  if (now === null) {
    // 取 ps 的这一刻进程恰好退出，或 ps 本身失败：再看一次存活，确认组长已不在就与 !alive 分支同源处理
    try {
      process.kill(r.pgid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') return leaderGone();
    }
    return 'unverifiable';
  }
  return now === r.started_at ? 'alive' : 'reused';
}

/** 挡住凭据抹除 / 到期整删的一条 CLI 记录（EV-157，取消与失联的凭据准入核CLI计划 r2 §3.1） */
export interface CliBlocker {
  side: CriticId;
  /** 形状坏的记录没有可信的组号，为 null */
  pgid: number | null;
  kind: 'alive' | 'orphaned' | 'unverifiable' | 'malformed';
  /** 单条的事实句：哪一侧、哪个进程组、为什么挡住 */
  detail: string;
}

/**
 * 凭据清扫准入里「CLI 那一半」（EV-38，CLI进程组记录计划 r2 §4.5；EV-165 起 `orphaned` 同样阻挡）：任一记录判
 * `alive`、`orphaned`、`orphan_unverifiable`（按 `unverifiable` 归档），或有形状坏的记录 ⇒ 不可抹。`reused` 与
 * `gone` 放行——前者组号已不是那一组，后者组长已退出且组号下已没有非僵尸成员（视同已结束）。
 *
 * **唯一来源**（EV-157）：凭据抹除的三处准入经 `scrubAdmission` 问它，`pruneRunDirs` 的到期整删直接问它。
 * 逐条判完、收齐 `blockers`（形状坏的在前，其余按记录顺序），供 `--cancel` / `--wait` 的告警逐侧列出；
 * `why` 逐字保持 EV-157 之前「读到第一个阻挡项即返回」的文字——它经 `admitScrub` 进 `trivium scrub` 与会话启动的人读输出，
 * 用户决策「清扫子命令的输出格式不改」（计划 r2 §3.1）。
 * 形状坏的措辞因此有两份，是有意的（代码双审 r1 CODEX-06）：`why` 把全部形状坏的侧合成一句（旧文字，冻结面），
 * `detail` 是新告警里的逐侧单句；二者都由 scrub-admission U1 逐字钉住。
 * `orphan_unverifiable` 复用 `kind: 'unverifiable'`——对下游（`--cancel` 出口提示、清扫的 `deferredCli`）处置相同，
 * 只有 `detail` 文案不同（组长已退出，成员数取不到，与「组长在、启动时刻没记下」是两种不同的判不了成因）。
 *
 * `o.memberCountOf` 只为单测零配额构造 `orphan_unverifiable` 而开（穿到 `judgeCliGroup`，见其文档块），
 * 生产路径不传、缺省走真实 `processGroupMemberCount`。
 */
export async function cliGroupsConfirmedGone(
  s: RunStatus | null,
  o: { memberCountOf?: (pgid: number) => Promise<number | null> } = {},
): Promise<{ gone: boolean; why: string; blockers: CliBlocker[] }> {
  const { records, malformed } = cliRecordsOf(s);
  const blockers: CliBlocker[] = malformed.map((side) => ({
    side, pgid: null, kind: 'malformed', detail: `${side} 侧的 CLI 记录读不懂（${rawCliOf(s, side)}）：判不了`,
  }));
  for (const r of records) {
    const out: { membersLeft?: number | null } = {};
    const v = await judgeCliGroup(r, { out, ...(o.memberCountOf ? { memberCountOf: o.memberCountOf } : {}) });
    if (v === 'alive') {
      blockers.push({ side: r.side, pgid: r.pgid, kind: 'alive', detail: `${r.side} 侧审查员 CLI 进程组 ${r.pgid} 仍在` });
    } else if (v === 'unverifiable') {
      blockers.push({
        side: r.side, pgid: r.pgid, kind: 'unverifiable',
        detail: `${r.side} 侧审查员 CLI 进程组 ${r.pgid} 仍有活进程、启动时刻没记下：判不了`,
      });
    } else if (v === 'orphaned') {
      blockers.push({
        side: r.side, pgid: r.pgid, kind: 'orphaned',
        detail: `${r.side} 侧审查员 CLI 进程组 ${r.pgid} 的组长已退出，组里还有 ${out.membersLeft} 个成员`,
      });
    } else if (v === 'orphan_unverifiable') {
      blockers.push({
        side: r.side, pgid: r.pgid, kind: 'unverifiable',
        detail: `${r.side} 侧审查员 CLI 进程组 ${r.pgid} 的组长已退出，组里的非僵尸成员数取不到：判不了`,
      });
    }
  }
  if (blockers.length === 0) return { gone: true, why: '记录里没有仍在的审查员 CLI', blockers };
  const why =
    malformed.length > 0
      ? `CLI 记录读不懂（${malformed.map((side) => `${side}：${rawCliOf(s, side)}`).join('；')}）：判不了`
      : blockers[0]!.detail;
  return { gone: false, why, blockers };
}

/** 凭据抹除的准入结果（EV-157，计划 r2 §3.1） */
export interface ScrubAdmission {
  admit: boolean;
  /** worker 一半，原样是 `workerConfirmedGone` 的结果——`cancelRun` 的归档收尾只用这一半（D5） */
  worker: { gone: boolean; why: string };
  /** CLI 一半；worker 一半未通过时不判（null），与 EV-157 之前 `admitScrub` 只在 gone 之后才问一致 */
  cli: { gone: boolean; why: string; blockers: CliBlocker[] } | null;
}

/**
 * 凭据副本抹除的准入——**唯一来源**（EV-20 + EV-38 + EV-157）：会话启动清扫与 `trivium scrub`（`admitScrub`）、
 * `review --cancel` 的挂载点 ③、`review --wait` 判失联的挂载点 ② 共用。worker 确认已不在（`workerConfirmedGone`），
 * 且 status.json 记录里的审查员 CLI 进程组没有仍在、判不了或读不懂的（`cliGroupsConfirmedGone`），才准入。
 *
 * worker 已不在而 CLI 还活着时抹副本，CLI 会以鉴权错误失败，或把凭据写回侧目录而哨兵已记 ok、之后的清扫跳过该侧
 * （EV-157）。只读进程表，不结束任何进程（用户决策）。到期整删的 worker 一半是 `workerStillAlive`、不走这里，
 * CLI 一半与这里同一个函数（计划 r2 D2）。
 */
export async function scrubAdmission(status: RunStatus | null, fallbackPid: number | null): Promise<ScrubAdmission> {
  const worker = await workerConfirmedGone(status, fallbackPid);
  if (!worker.gone) return { admit: false, worker, cli: null };
  const cli = await cliGroupsConfirmedGone(status);
  return { admit: cli.gone, worker, cli };
}

/**
 * 未准入时的事实句（`--cancel` 的告警、`--wait` 的报错正文共用，计划 r2 §3.6 D4）：
 * worker 一半未过 ⇒ `worker.why` 原样（EV-157 之前的输出逐字不变）；CLI 挡住 ⇒ 逐侧列出全部阻挡项。
 */
export function scrubHoldWhy(a: ScrubAdmission): string {
  if (!a.worker.gone || !a.cli || a.cli.gone) return a.worker.why;
  return `${a.worker.why}，但审查员 CLI 未确认结束——${a.cli.blockers.map((b) => b.detail).join('；')}`;
}

/**
 * `worker_lost` 的三种原因——**唯一来源**（EV-142，计划双审 r1 CODEX-04）。
 *
 * 同一组值还出现在 run.v2 schema 的 `termination.reason` 枚举里：`--wait` 判失联后把原因写进归档 run.json。
 * schema 是 JSON、引用不了这里，所以由 `run-meta-strict.test.ts` 的 S2 守住两边逐项相等——
 * 在这里加第四种原因而漏改 schema，写出的 run.json 会不合契约、被 `readRunMeta` 读成 null。
 */
export const WORKER_LOST_REASONS = ['no_status_file', 'heartbeat_stale', 'pid_gone'] as const;
export type WorkerLostReason = (typeof WORKER_LOST_REASONS)[number];

/**
 * 读 status.json 的 `lost`（EV-146）：形状合法（`reason` ∈ `WORKER_LOST_REASONS`、`at` 为非空字符串）才返回，否则 null。
 * 读不懂就当没有——`--cancel` 据它决定要不要对一个已判终态的运行发信号，fail-safe 方向是「不杀」
 * （与 `cliRecordsOf` 对形状坏的 CLI 记录不发信号同一口径）。
 */
export function lostOf(s: RunStatus | null): WorkerLostRecord | null {
  const v: unknown = s?.lost;
  if (v === null || typeof v !== 'object') return null;
  const r = v as { reason?: unknown; at?: unknown };
  const okReason = typeof r.reason === 'string' && (WORKER_LOST_REASONS as readonly string[]).includes(r.reason);
  const okAt = typeof r.at === 'string' && r.at.trim().length > 0;
  return okReason && okAt ? { reason: r.reason as WorkerLostReason, at: r.at as string } : null;
}

/**
 * worker 刷新 status.json 心跳的间隔：设计 §7.5 规定 30 s。
 * EV-160 起从 `run-protocol.ts` 挪到这里共享——worker 的心跳定时器、`--wait` 判 heartbeat_stale 的报错、
 * 预检与 `--start` 的「失联阈值」只警告项都取它。
 * **它同时是短临界区锁的持有超时下限**（`lock.ts` `criticalHoldTimeoutMs`，EV-161）：改这个值会连带移动锁下限，
 * 须按「下限要覆盖最长临界区（JSON 读改写，至多一次阶段目录扫描）」重新论证（代码双审 r1 CODEX-01）。
 */
export const WORKER_HEARTBEAT_MS = 30_000;

/**
 * 失联阈值没有盖住一个心跳周期（EV-160，心跳阈值事前告警计划 r2 §2）：健康的 worker 两次心跳之间的未更新时长
 * 每个周期都会越过它，`--wait` 轮询到就判 heartbeat_stale。只凭配置就能下的确定结论，所以**不留余量**
 * （阈值只比间隔大一点时，要一次心跳迟到才会被判——那取决于运行期，配置层判不出来，计划 r2 D1）。
 * **30 s 这一格属保守多告警的一侧**（代码双审 r1 CODEX-01）：失联判定是严格大于，等于间隔时未更新时长只在心跳回调延迟与
 * 一次读写耗时那几毫秒里越过阈值，`--wait` 每 2 s 一次的轮询很少碰上；「没盖住一个周期」仍只凭配置成立，所以照样算。
 *
 * `--wait` 的判定依据行与预检 / `--start` 的只警告项（`checkHeartbeatThreshold`）都经这里判，不得各写一份。
 * 比较在毫秒上做：`30` ⇒ true（等于间隔），`30.001` ⇒ false。
 */
export function staleThresholdWithinHeartbeat(heartbeatStaleS: number): boolean {
  return heartbeatStaleS * 1000 <= WORKER_HEARTBEAT_MS;
}

export type StatusReading =
  /** 已完成（成功或失败），可以收工 */
  | { kind: 'terminal'; status: RunStatus }
  /** 仍在进行，继续等 */
  | { kind: 'running'; status: RunStatus }
  /** 本次轮询拿不到有效信息，但工作进程还活着 → 继续等 */
  | { kind: 'inconclusive'; reason: 'no_status_file' | 'unparsable' }
  /** 工作进程没了却没留下终态 → worker_lost */
  | { kind: 'worker_lost'; reason: WorkerLostReason };

/**
 * 解释一次轮询结果。这是 `--wait` 的唯一判定入口。
 *
 * @param workerPid `--start` 记录的 pid。status.json 还没生成时也要能查进程存活。
 */
export async function interpretStatus(
  runDir: string,
  opts: {
    heartbeatStaleMs: number;
    /** status.json 尚未出现时的兜底 pid 来源（`--start` 写的 worker.pid） */
    fallbackPid?: number | null;
    /**
     * 兜底 pid 的启动时刻：**调用方自己环境下取的缺省形态**，只供同进程构造（单测）。按读者缺省环境比，是规范化读法
     * （`processMatchesRecord`）之外的入口——生产代码不传，也不得传锁或 status.json 里别的进程写下的启动时刻：
     * 跨进程的身份一律经 status.json 的两个字段（EV-158，worker启动时刻规范化代码双审 r1 CODEX-01）。
     * 活着而取不到启动时刻时与活着同处置（EV-175）。生产调用方（`waitRun`）不传它，期望值为 null 时只看存活，不受 `ps` 影响。
     */
    fallbackPidStartedAt?: string | null;
    now?: number;
  },
): Promise<StatusReading> {
  const raw = await readStatus(runDir);

  // ── 情形 A：文件不存在 ──
  if (raw === null) {
    const hasFile = await exists(statusPath(runDir));
    const reason = hasFile ? 'unparsable' : 'no_status_file';

    const pid = opts.fallbackPid ?? null;
    if (pid === null) {
      // 连 pid 都不知道：只能判失联，否则会无限等一个可能根本没起来的进程
      return { kind: 'worker_lost', reason: 'no_status_file' };
    }
    // 没有规范化键即退回 processAlive(pid, legacy)，与此前逐字同一判据，多拿到三态结论（EV-175）
    const live = await processMatchesRecord(pid, { legacy: opts.fallbackPidStartedAt ?? null });
    // 取不到启动时刻是判不了，与活着同处置：本次轮询不下结论
    if ((live.alive && live.sameProcess) || live.identity === 'unverifiable') return { kind: 'inconclusive', reason };
    return { kind: 'worker_lost', reason: 'pid_gone' };
  }

  // ── 情形 B：已是终态 ──
  if (isTerminal(raw.phase)) return { kind: 'terminal', status: raw };

  // ── 情形 C：非终态，检查心跳与进程 ──
  const age = (opts.now ?? Date.now()) - new Date(raw.heartbeat_at).getTime();
  const stale = Number.isFinite(age) && age > opts.heartbeatStaleMs;

  const pid = raw.worker_pid ?? opts.fallbackPid ?? null;
  if (pid !== null) {
    // 有规范化启动时刻只按它比；没有（旧版写的）退回缺省比较（EV-158）
    const live = await processMatchesRecord(pid, workerStartOf(raw, opts.fallbackPidStartedAt ?? null));
    /*
     * 进程没了（或已不是同一进程）却没留终态 → 失联（无论心跳是否还新鲜）。
     * 活着而取不到启动时刻是判不了（EV-175）：不判 pid_gone，交给下面的心跳判据——新鲜仍算运行中、过期判 heartbeat_stale。
     */
    if (live.identity !== 'unverifiable' && (!live.alive || !live.sameProcess)) {
      return { kind: 'worker_lost', reason: 'pid_gone' };
    }
  }
  // 进程活着但心跳过期 → 也算失联（卡死在某处不再更新）
  if (stale) return { kind: 'worker_lost', reason: 'heartbeat_stale' };

  return { kind: 'running', status: raw };
}

/*
 * ───────────────────────── 进度渲染 ─────────────────────────
 *
 * 用户在等待期间只能看到这里渲染出来的东西。原先它只回答「跑了多久」，
 * 不回答「还要多久」——已用时没有分母，看到 612s 无从判断是正常还是快卡死。
 * `ProgressBudget` 补的就是那个分母。
 */

/** 状态词的中文译表。集中一处，避免散落在渲染点各写各的 */
const SIDE_STATE_CN: Record<SideStatus['state'], string> = {
  pending: '待启动',
  running: '审查中',
  ok: '已完成',
  failed: '失败',
  timeout: '超时',
  parse_fallback: '解析回退',
};

const PHASE_CN: Record<RunPhase, string> = {
  starting: '启动中',
  running: '审查中',
  parsing: '解析中',
  archiving: '归档中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 秒数人读化：`612` → `10m12s`，`45` → `45s`。612s 读起来要心算 */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

/** 渲染期待值所需的预算参数。全部可选传入——不传就退回「只说已用时」的老输出 */
export interface ProgressBudget {
  /** 本阶段单侧超时（`review.timeout_s[stage]`），`pct` 的分母 */
  stageTimeoutS: number;
  /** 每次 `--wait` 的窗口，用于推算「第几次等待」 */
  waitTimeoutS: number;
  /** 循环上限（`computeMaxWaits` 的结果），「共几次」 */
  maxWaits: number;
}

/**
 * 已用时相对预算的换算。
 *
 * `pct` 的分母有意用**单阶段超时**而非 `computeMaxWaits` 那个含重试的总预算：
 * 绝大多数运行不重试、一侧几百秒就收，用最坏预算做分母会让它们永远显示成
 * 一成多，那个数字对「还要多久」没有指导意义。代价是重试时会超 100%，
 * 所以超出后不再显示百分比，改说一句解释——那一刻用户要的本就是解释。
 */
export function budgetOf(rawElapsedS: number, b: ProgressBudget, attempt = 0) {
  /*
   * 先钳非负（审查意见 GLM-07）：时钟回拨（NTP 校正）会让 started_at 落在 now
   * 之后，elapsed 为负就会渲染出「（-3%）」与「第 0/32 次等待」——后者正是
   * 「第 0 次」那个刚修掉的毛病。与 fmtDuration 同口径。
   */
  const elapsedS = Math.max(0, rawElapsedS);
  const over = elapsedS > b.stageTimeoutS;
  const pct = Math.min(100, Math.round((elapsedS / Math.max(1, b.stageTimeoutS)) * 100));
  // 从 1 起算：elapsed 为 0 时人在等的是「第 1 次」，不是「第 0 次」
  const waitsDone = Math.floor(elapsedS / Math.max(1, b.waitTimeoutS)) + 1;
  const span = over
    ? `已超单次预算 · 重试收尾中${attempt > 0 ? `（第 ${attempt} 次尝试）` : ''}`
    : `已用 ${fmtDuration(elapsedS)} / 预算 ${fmtDuration(b.stageTimeoutS)}（${pct}%）`;
  return { elapsedS, over, pct, waitsDone, span };
}

/**
 * 结构化进度视图，供 CLI **原样透出**。
 *
 * 导出它是为了消掉第二份真相：CLI 曾按自己的 `Date.now()` 手写重算 pct 与
 * waits_done，两份时间戳在窗口边界会差一次进位，且改了这里的舍入规则 CLI 会
 * 静默漂移（审查意见 GLM-05）。文字与字段现在同源同一刻。
 */
export interface ProgressView {
  elapsed_s: number;
  pct: number;
  waits_done: number;
}

export function progressViewOf(
  s: RunStatus,
  now: number = Date.now(),
  budget?: ProgressBudget,
): ProgressView | null {
  if (!budget) return null;
  const v = budgetOf(Math.round((now - new Date(s.started_at).getTime()) / 1000), budget, maxAttempt(s));
  return { elapsed_s: v.elapsedS, pct: v.pct, waits_done: v.waitsDone };
}

/** 两侧里最大的尝试次数——超预算文案要说清是第几次重试 */
function maxAttempt(s: RunStatus): number {
  let m = 0;
  for (const side of Object.values(s.sides)) if (side && side.attempt > m) m = side.attempt;
  return m;
}

/** 人读进度摘要（`--wait` 每次返回时打印，§13.2 第 1 处落点） */
export function renderProgress(
  s: RunStatus,
  now: number = Date.now(),
  budget?: ProgressBudget,
): string {
  const elapsed = Math.round((now - new Date(s.started_at).getTime()) / 1000);
  const beat = Math.round((now - new Date(s.heartbeat_at).getTime()) / 1000);
  const lines = [
    `运行 ${s.run_id} ｜ 主题 ${s.topic} ｜ 阶段 ${s.stage} ｜ 阶段状态 ${PHASE_CN[s.phase] ?? s.phase}`,
  ];
  if (budget) {
    const b = budgetOf(elapsed, budget, maxAttempt(s));
    lines.push(`${b.span} ｜ 第 ${b.waitsDone}/${budget.maxWaits} 次等待 ｜ 最近心跳 ${beat}s 前`);
  } else {
    lines.push(`已用时 ${elapsed}s ｜ 最近心跳 ${beat}s 前`);
  }
  for (const [c, side] of Object.entries(s.sides)) {
    if (!side) continue;
    lines.push(
      `  ${c}: ${SIDE_STATE_CN[side.state] ?? side.state}` +
        `${side.model ? ` ｜ 请求模型 ${side.model}` : ''}` +
        `${side.attempt > 0 ? ` ｜ 第 ${side.attempt} 次尝试` : ''}` +
        `${side.elapsed_s > 0 ? ` ｜ ${fmtDuration(side.elapsed_s)}` : ''}` +
        `${side.note ? ` ｜ ${side.note}` : ''}`,
    );
  }
  return lines.join('\n');
}

/**
 * 单行进度摘要，供 skill **原样念给用户**。
 *
 * 给成品而不是给原料：让 Driver 自己从 `progress` 里组织语言，每次说法都不一样，
 * 用户反而更难看出「和上次比变了什么」。
 */
export function renderProgressBrief(
  s: RunStatus,
  now: number = Date.now(),
  budget?: ProgressBudget,
): string {
  const elapsed = Math.round((now - new Date(s.started_at).getTime()) / 1000);
  const head = `${s.stage} ${PHASE_CN[s.phase] ?? s.phase}`;
  const span = budget
    ? budgetOf(elapsed, budget, maxAttempt(s)).span
    : `已用 ${fmtDuration(elapsed)}`;
  const sides = Object.entries(s.sides)
    .filter(([, side]) => side)
    .map(([c, side]) => `${c} ${SIDE_STATE_CN[side!.state] ?? side!.state}`)
    .join(' · ');
  return sides ? `${head} ｜ ${span} ｜ ${sides}` : `${head} ｜ ${span}`;
}

/**
 * `--wait` 的循环次数上限（`--start` 返回给 skill 用）。
 *
 * 总上限 = 单侧超时 × (1 + 重试次数)，再按每次 `--wait` 的窗口切分，加 2 次余量
 * 覆盖启动与收尾。
 */
export function computeMaxWaits(
  stageTimeoutS: number,
  waitTimeoutS: number,
  transientRetries: number,
): number {
  const total = stageTimeoutS * (1 + Math.max(0, transientRetries));
  return Math.ceil(total / Math.max(1, waitTimeoutS)) + 2;
}
