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
import { isTerminal, readStatus } from './status.js';
import { processAlive } from './util/exec.js';

export interface PruneResult {
  removed: string[];
  kept: number;
}

export async function pruneRunDirs(
  cfg: Config,
  projectRoot: string,
  opts: { now?: number; dryRun?: boolean } = {},
): Promise<PruneResult> {
  const days = cfg.retention.run_dir_days;
  const out: PruneResult = { removed: [], kept: 0 };
  if (!(days > 0)) return out; // 0 = 不清理
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
    if (status) {
      const hb = new Date(status.heartbeat_at).getTime();
      if (Number.isFinite(hb)) lastActive = Math.max(lastActive, hb);
      if (!isTerminal(status.phase) && status.worker_pid) {
        const alive = await processAlive(status.worker_pid, status.worker_started_at ?? null);
        if (alive.alive && alive.sameProcess) {
          out.kept++;
          continue; // 还在跑，无论多老都不动
        }
      }
    }
    if (now - lastActive <= ttlMs) {
      out.kept++;
      continue;
    }
    if (!opts.dryRun) await fs.rm(dir, { recursive: true, force: true });
    out.removed.push(dir);
  }
  return out;
}
