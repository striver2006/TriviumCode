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

export const statusPath = (runDir: string): string => path.join(runDir, 'status.json');

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

export async function patchStatus(
  runDir: string,
  mutate: (s: RunStatus) => void,
): Promise<RunStatus | null> {
  const s = await readStatus(runDir);
  if (!s) return null;
  mutate(s);
  await writeStatus(runDir, s);
  return s;
}

export const TERMINAL_PHASES: readonly RunPhase[] = ['success', 'failed', 'cancelled'];
export const isTerminal = (p: RunPhase): boolean => TERMINAL_PHASES.includes(p);

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

/** 人读进度摘要（`--wait` 每次返回时打印，§13.2 第 1 处落点） */
export function renderProgress(s: RunStatus, now: number = Date.now()): string {
  const elapsed = Math.round((now - new Date(s.started_at).getTime()) / 1000);
  const beat = Math.round((now - new Date(s.heartbeat_at).getTime()) / 1000);
  const lines = [
    `运行 ${s.run_id} ｜ 主题 ${s.topic} ｜ 阶段 ${s.stage} ｜ 阶段状态 ${s.phase}`,
    `已用时 ${elapsed}s ｜ 最近心跳 ${beat}s 前`,
  ];
  for (const [c, side] of Object.entries(s.sides)) {
    if (!side) continue;
    lines.push(
      `  ${c}: ${side.state}` +
        `${side.model ? ` ｜ ${side.model}` : ''}` +
        `${side.attempt > 0 ? ` ｜ 第 ${side.attempt} 次尝试` : ''}` +
        `${side.elapsed_s > 0 ? ` ｜ ${Math.round(side.elapsed_s)}s` : ''}` +
        `${side.note ? ` ｜ ${side.note}` : ''}`,
    );
  }
  return lines.join('\n');
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
