/**
 * 运行目录的保留期清理（设计 §6.2 / RUNBOOK：「默认保留 30 天」）。
 *
 * `retention.run_dir_days` 原先只有配置与文档、没有任何实现：`~/.trivium/runs`
 * 无限增长（审核时已 3400 个目录、580MB，每次运行还各留两份 zcode 凭据副本）。
 *
 * 只清理**本项目**的桶 `<run_root>/<repoId>/`：别的项目的运行目录是别人的。
 * 判据：运行已终态（或 worker 已不在）且最后活动时间早于保留期。进行中的运行
 * （status 非终态且 worker 进程还活着）一律不动，哪怕它很老。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config } from './types.js';
import { runRoot } from './config.js';
import { repoId } from './review.js';
import { isTerminal, readStatus, workerConfirmedGone } from './status.js';
import { processAlive } from './util/exec.js';
import { RUN_DIR_FILES } from './run-files.js';
import { scrubDidWork, scrubRunDir, type AdapterLookup } from './scrub.js';

/** 读运行目录那一层的 `worker.pid`：`status.json` 缺失或没记 pid 时的同源兜底 */
async function readWorkerPid(dir: string): Promise<number | null> {
  try {
    const n = Number.parseInt(await fs.readFile(path.join(dir, RUN_DIR_FILES.workerPid), 'utf8'), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export interface PruneResult {
  removed: string[];
  kept: number;
  /** 本次抹除了凭据副本的运行目录（未到期、已终态或 worker 已死） */
  scrubbed: string[];
  /** 抹除失败的运行目录与首个原因——要进人读输出，不能只躺在哨兵里 */
  scrubFailed: { dir: string; reason: string }[];
  /** `status.json` 读不到（缺失或损坏）、因此**没做**不可逆抹除的目录 */
  unknown: string[];
  /** 抹过但没扫完（有超大 / 二进制 / 读不了的文件被跳过）——那几份仍未脱敏 */
  incomplete: string[];
}

/**
 * 两件事，两套判据：
 *
 * - **到期整删**：沿用原判据（终态或 worker 已死，且最后活动早于保留期；status 读不到按 mtime）。
 *   `run_dir_days <= 0` 关闭这一支。
 * - **凭据抹除**（EV-20，挂载点 ④）：对**未到期**的目录逐侧调适配器抹载体。
 *   与整删解耦——它是安全底线，不该挂在一个可以关掉的档位上（计划双审 CODEX-04）；
 *   判据比整删**更严**：抹除不可逆，`status.json` 读不到（缺失或损坏）一律**跳过并计数**，
 *   `starting`（worker_pid 尚为 null 的拉起瞬间）也跳过（CODEX-05 ≡ AGY-04）。
 *   传 `adapters` 才做；不传（旧调用形态）行为与原先一致。
 */
export async function pruneRunDirs(
  cfg: Config,
  projectRoot: string,
  opts: { now?: number; dryRun?: boolean; adapters?: AdapterLookup } = {},
): Promise<PruneResult> {
  const days = cfg.retention.run_dir_days;
  const out: PruneResult = { removed: [], kept: 0, scrubbed: [], scrubFailed: [], unknown: [], incomplete: [] };
  const bucket = path.join(runRoot(cfg), repoId(projectRoot));
  let entries: string[];
  try {
    entries = await fs.readdir(bucket);
  } catch {
    return out;
  }
  const now = opts.now ?? Date.now();
  const ttlMs = days * 86_400_000;

  for (const name of entries) {
    const dir = path.join(bucket, name);
    let st: import('node:fs').Stats;
    try {
      st = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const status = await readStatus(dir);
    let lastActive = st.mtimeMs;
    /** 非终态且 worker 确认还活着（pid 同一进程） */
    let alive = false;
    if (status) {
      const hb = new Date(status.heartbeat_at).getTime();
      if (Number.isFinite(hb)) lastActive = Math.max(lastActive, hb);
      if (!isTerminal(status.phase) && status.worker_pid) {
        const a = await processAlive(status.worker_pid, status.worker_started_at ?? null);
        alive = a.alive && a.sameProcess;
      }
    }
    if (alive) {
      out.kept++;
      continue; // 还在跑，无论多老都不动
    }

    // ── 到期整删 ──
    if (days > 0 && now - lastActive > ttlMs) {
      if (!opts.dryRun) await fs.rm(dir, { recursive: true, force: true });
      out.removed.push(dir);
      continue;
    }
    out.kept++;

    // ── 未到期：凭据抹除 ──
    if (!opts.adapters || opts.dryRun) continue;
    /*
     * 准入判据与 `waitRun` / `cancelRun` 共用 `workerConfirmedGone`（代码双审 r2 三侧收敛）。
     * 终态也要看进程：`waitRun` 判 `heartbeat_stale` 时会把**活着的**进程写成 failed。
     */
    const gone = await workerConfirmedGone(status, await readWorkerPid(dir));
    if (!gone.gone) {
      // 「没有证据说它死了」与「它还活着」是两回事：前者要让人知道，后者是正常状态
      if (!status) out.unknown.push(dir);
      continue;
    }
    let sides;
    try {
      sides = await scrubRunDir(dir, opts.adapters); // 非 force：哨兵已记 ok 的侧跳过
    } catch (e) {
      out.scrubFailed.push({ dir, reason: (e as Error).message });
      continue;
    }
    const outcomes = Object.values(sides).filter((o) => o !== undefined);
    const failed = outcomes.find((o) => !o.ok);
    if (failed) out.scrubFailed.push({ dir, reason: failed.errors[0] ?? '原因未记录' });
    // 只有真删了/真抹了才算 scrubbed：「没得抹」的空目录不能报成「已抹除」（代码双审 r1 GLM-05）
    else if (outcomes.some((o) => !o.skipped && scrubDidWork(o))) out.scrubbed.push(dir);
    // 扫完了没有是另一问：跳过的那几份仍未脱敏，人得知道（代码双审 r2 AGY-02 ≡ CODEX-06 ≡ GLM-05）
    if (outcomes.some((o) => o.complete === false)) out.incomplete.push(dir);
  }
  return out;
}
