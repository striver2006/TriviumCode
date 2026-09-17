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
import { processAlive } from './util/exec.js';

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
  model: string | null;
  attempt: number;
  elapsed_s: number;
  note?: string | null;
}

export interface RunStatus {
  schema: 'trivium.status.v1';
  run_id: string;
  topic: string;
  stage: Stage;
  phase: RunPhase;
  /** 工作进程 pid 与其启动时刻——判定失联时要能识别 PID 复用 */
  worker_pid: number | null;
  worker_started_at: string | null;
  started_at: string;
  /** 每次心跳更新，`--wait` 据此判定失联 */
  heartbeat_at: string;
  sides: Partial<Record<CriticId, SideStatus>>;
  /** 终态时填：落盘的工件相对路径 */
  artifacts: string[];
  /** 终态时填：退出码，供 `--wait` 原样透出 */
  exit_code: number | null;
  message: string | null;
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
    const live = await processAlive(pid, status.worker_started_at ?? null);
    if (live.alive && live.sameProcess) return { gone: false, why: `工作进程 ${pid} 仍在` };
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

export type StatusReading =
  /** 已完成（成功或失败），可以收工 */
  | { kind: 'terminal'; status: RunStatus }
  /** 仍在进行，继续等 */
  | { kind: 'running'; status: RunStatus }
  /** 本次轮询拿不到有效信息，但工作进程还活着 → 继续等 */
  | { kind: 'inconclusive'; reason: 'no_status_file' | 'unparsable' }
  /** 工作进程没了却没留下终态 → worker_lost */
  | { kind: 'worker_lost'; reason: 'no_status_file' | 'heartbeat_stale' | 'pid_gone' };

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
    const live = await processAlive(pid, opts.fallbackPidStartedAt ?? null);
    if (live.alive && live.sameProcess) return { kind: 'inconclusive', reason };
    return { kind: 'worker_lost', reason: 'pid_gone' };
  }

  // ── 情形 B：已是终态 ──
  if (isTerminal(raw.phase)) return { kind: 'terminal', status: raw };

  // ── 情形 C：非终态，检查心跳与进程 ──
  const age = (opts.now ?? Date.now()) - new Date(raw.heartbeat_at).getTime();
  const stale = Number.isFinite(age) && age > opts.heartbeatStaleMs;

  const pid = raw.worker_pid ?? opts.fallbackPid ?? null;
  if (pid !== null) {
    const live = await processAlive(pid, raw.worker_started_at ?? opts.fallbackPidStartedAt ?? null);
    // 进程没了却没留终态 → 失联（无论心跳是否还新鲜）
    if (!live.alive || !live.sameProcess) return { kind: 'worker_lost', reason: 'pid_gone' };
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
        `${side.model ? ` ｜ ${side.model}` : ''}` +
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
