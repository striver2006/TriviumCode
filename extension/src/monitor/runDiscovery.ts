/**
 * run 目录定位（r2 计划 D4″ + 代码审 CODEX-02）。
 *
 * 不复制核心的 repoId 推导（命名是核心内部约定）：按 run_id 在
 * `<run_root>/<桶>/<run_id>/` 浅扫描。**run_id 是秒级时间戳，不同仓库可能同秒
 * 撞号**——定位必须校验归属：先按桶名前缀（= 工作区目录名）过滤，再用候选
 * status.json 的 topic 与闸门主题比对；无法唯一确定即不接管并明示，绝不取
 * 跨桶首个同名目录。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface RetryPolicy {
  intervalMs: number;
  rounds: number;
}

export interface LocateOptions {
  /** 工作区目录名（桶名前缀提示，如 TriviumCode-2217d505 的 TriviumCode） */
  repoHint?: string;
  /** 期望主题（来自闸门 gates 条目）；候选 status.json 的 topic 与之比对 */
  expectTopic?: string;
  /** 读文件失败时的提示（注入以便测试） */
  readFile?: (p: string) => Promise<string>;
}

/** 列出全部命中桶（不判归属） */
async function listCandidates(runRoot: string, runId: string): Promise<string[]> {
  let buckets: string[];
  try {
    buckets = await fs.readdir(runRoot);
  } catch {
    return [];
  }
  const hits: string[] = [];
  for (const bucket of buckets) {
    const candidate = path.join(runRoot, bucket, runId);
    try {
      const st = await fs.stat(candidate);
      if (st.isDirectory()) hits.push(candidate);
    } catch {
      /* 下一个桶 */
    }
  }
  return hits;
}

async function readTopicOf(dir: string, opts: LocateOptions): Promise<string | null> {
  const read = opts.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const text = await read(path.join(dir, 'status.json'));
    const obj = JSON.parse(text) as { topic?: unknown };
    return typeof obj.topic === 'string' ? obj.topic : null;
  } catch {
    return null;
  }
}

/**
 * 归属感知定位（CLAUDE-02/CODEX-02 收紧版）：
 * 1. 给了 repoHint：桶前缀过滤；**零命中即不接管**（本仓目录尚未建，等下一轮——
 *    绝不把他仓候选当兜底）；
 * 2. 给了 expectTopic：命中池必须过 topic 比对，matched==0 或 >1 都不接管
 *    （status.json 未建时读不到 topic，同样不接管，等目录就绪）；
 * 3. 两者都没给：仅单候选时直取（兼容旧调用），多候选不接管。
 */
export async function locateRunDir(runRoot: string, runId: string, opts: LocateOptions = {}): Promise<string | null> {
  const candidates = await listCandidates(runRoot, runId);
  if (candidates.length === 0) return null;

  let pool = candidates;
  if (opts.repoHint) {
    const hinted = candidates.filter((c) => path.basename(path.dirname(c)).startsWith(`${opts.repoHint}-`));
    if (hinted.length === 0) return null; // 本仓桶未建：不接管他仓候选
    pool = hinted;
  }

  if (opts.expectTopic) {
    const matched: string[] = [];
    for (const c of pool) {
      if ((await readTopicOf(c, opts)) === opts.expectTopic) matched.push(c);
    }
    if (matched.length !== 1) return null; // 0=本仓未就绪或他仓撞号；>1=歧义
    return matched[0]!;
  }

  return pool.length === 1 ? pool[0]! : null;
}

/**
 * 带重试的定位：闸门已 running 而运行目录尚未落盘时按策略重试。
 * sleep 可注入（单测不真等）。
 */
export async function locateRunDirWithRetry(
  runRoot: string,
  runId: string,
  policy: RetryPolicy,
  opts: LocateOptions = {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  onRetry?: (round: number) => void,
): Promise<string | null> {
  for (let round = 0; round <= policy.rounds; round++) {
    const dir = await locateRunDir(runRoot, runId, opts);
    if (dir) return dir;
    if (round === policy.rounds) break;
    onRetry?.(round + 1);
    await sleep(policy.intervalMs);
  }
  return null;
}
