/**
 * 运行历史数据面（FR-7，r2 计划 D6′：第一事实源版）。
 *
 * 完结运行以 `.reviews/<主题>/<阶段>/_meta/run-<runId>.json` 为第一事实源
 * （AGY-05：run_root 是 30 天轮转清理的临时区，多机克隆必缺）；task.json 提供
 * 时间线主轴（run_id/stage/rerun_index/status/driver/started_at）；review-*.json
 * 提供逐侧 verdict + severity 统计与逐文件降级状态。run_root 仅在活跃运行或
 * 归档缺失时探测（复用 runDiscovery 归属纪律：桶前缀过滤 + topic 比对，
 * 不唯一不接管）。
 *
 * IO 全部注入（fsApi），可单测。
 */
import type { ParsedReview, FindingSeverity } from '../reviews/reviewParse';
import { parseReviewFile } from '../reviews/reviewParse';
import { locateRunDir } from '../monitor/runDiscovery';

export interface FsApi {
  readdir(p: string): Promise<string[]>;
  readFile(p: string): Promise<string>;
}

export interface TopicSummary {
  topic: string;
  createdAt: string | null;
  updatedAt: string | null;
  runCount: number;
  lastStatus: string | null;
  drivers: string[];
}

export interface RunSideStat {
  critic: string;
  verdict: string | null;
  counts: Record<FindingSeverity, number>;
  state: string;
  notice: string | null;
}

export interface RunSummary {
  runId: string;
  stage: string;
  rerunIndex: number | null;
  status: string | null;
  driver: string | null;
  startedAt: string | null;
  /** run.v3 归档元数据读到时补充 */
  finishedAt: string | null;
  criticsSelected: string[];
  /** 归档是否齐全（run-*.json 在 _meta）：齐全则不探 run_root（AGY-05） */
  metaLocated: boolean;
  sides: RunSideStat[];
}

interface TaskRun {
  run_id?: string;
  stage?: string;
  rerun_index?: number;
  status?: string;
  review_mode?: string;
  started_at?: string;
  driver?: string;
}

interface TaskJson {
  topic?: string;
  created_at?: string;
  updated_at?: string;
  runs?: TaskRun[];
  drivers?: Record<string, { driver?: string }>;
}

interface RunMetaJson {
  run_id?: string;
  stage?: string;
  rerun_index?: number;
  driver?: string;
  critics_selected?: string[];
  started_at?: string;
  finished_at?: string;
}

async function readJson(fs: FsApi, p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(p)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 扫 `.reviews/` 下有 task.json 的主题目录 → 主题摘要列表 */
export async function listTopics(fs: FsApi, reviewsRoot: string): Promise<TopicSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(reviewsRoot);
  } catch {
    return [];
  }
  const out: TopicSummary[] = [];
  for (const topic of entries) {
    const task = (await readJson(fs, `${reviewsRoot}/${topic}/task.json`)) as TaskJson | null;
    if (!task || typeof task.topic !== 'string') continue;
    const runs = Array.isArray(task.runs) ? task.runs : [];
    const drivers = new Map<string, boolean>();
    for (const [, d] of Object.entries(task.drivers ?? {})) {
      if (typeof d?.driver === 'string') drivers.set(d.driver, true);
    }
    out.push({
      topic: task.topic,
      createdAt: task.created_at ?? null,
      updatedAt: task.updated_at ?? null,
      runCount: runs.length,
      lastStatus: runs.length > 0 ? (runs[runs.length - 1]?.status ?? null) : null,
      drivers: [...drivers.keys()],
    });
  }
  out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return out;
}

/**
 * 一个主题的运行列表：task.json 时间线 + 逐 run 归档元数据/意见统计合并。
 *
 * `probeRunRoot`：归档缺失（metaLocated=false）时用于探测 run 目录的回调
 * （注入 locateRunDir 的包装；探测失败保持 metaLocated=false，不接管——跨仓
 * 撞号纪律，见 runDiscovery.ts）。
 */
export async function listRuns(
  fs: FsApi,
  reviewsRoot: string,
  topic: string,
  probeRunDir: (runId: string) => Promise<string | null>,
): Promise<RunSummary[]> {
  const task = (await readJson(fs, `${reviewsRoot}/${topic}/task.json`)) as TaskJson | null;
  const runsFromTask = Array.isArray(task?.runs) ? task!.runs : [];

  // 各阶段目录的 _meta 归档（第一事实源）
  const stages = await listStages(fs, reviewsRoot, topic);
  const runMetas = new Map<string, { stage: string; meta: RunMetaJson }>();
  const runReviews = new Map<string, Map<string, ParsedReview>>();
  for (const stage of stages) {
    const metaDir = `${reviewsRoot}/${topic}/${stage}/_meta`;
    let names: string[];
    try {
      names = await fs.readdir(metaDir);
    } catch {
      continue;
    }
    for (const n of names) {
      const rm = /^run-(\d{8}T\d{6}Z)\.json$/.exec(n);
      if (rm) {
        const meta = (await readJson(fs, `${metaDir}/${n}`)) as RunMetaJson | null;
        if (meta) runMetas.set(rm[1]!, { stage, meta });
      }
      const rv = /^review-.+-(\d{8}T\d{6}Z)\.json$/.exec(n);
      if (rv) {
        let byCritic = runReviews.get(rv[1]!);
        if (!byCritic) {
          byCritic = new Map();
          runReviews.set(rv[1]!, byCritic);
        }
        try {
          const parsed = parseReviewFile(n, await fs.readFile(`${metaDir}/${n}`));
          if (parsed.status.state !== 'unrecognized') byCritic.set(parsed.status.critic, parsed);
        } catch {
          /* 单件坏文件：该侧统计缺失，不阻断列表 */
        }
      }
    }
  }

  // 时间线合并：task.json 的 runs 为主轴；仅有归档而无 task 记录的 run 追加（防御）
  const seen = new Set<string>();
  const out: RunSummary[] = [];
  for (const r of runsFromTask) {
    const runId = typeof r.run_id === 'string' ? r.run_id : '';
    if (!runId || seen.has(runId)) continue;
    seen.add(runId);
    out.push(await buildRunSummary(fs, runId, r, runMetas, runReviews, probeRunDir));
  }
  for (const runId of runMetas.keys()) {
    if (seen.has(runId)) continue;
    seen.add(runId);
    out.push(await buildRunSummary(fs, runId, null, runMetas, runReviews, probeRunDir));
  }
  out.sort((a, b) => (b.startedAt ?? b.runId).localeCompare(a.startedAt ?? a.runId));
  return out;
}

async function listStages(fs: FsApi, reviewsRoot: string, topic: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(`${reviewsRoot}/${topic}`);
    return entries.filter((e) => ['plan', 'code', 'bug', 'verify'].includes(e));
  } catch {
    return [];
  }
}

async function buildRunSummary(
  fs: FsApi,
  runId: string,
  taskRun: TaskRun | null,
  runMetas: Map<string, { stage: string; meta: RunMetaJson }>,
  runReviews: Map<string, Map<string, ParsedReview>>,
  probeRunDir: (runId: string) => Promise<string | null>,
): Promise<RunSummary> {
  const archived = runMetas.get(runId) ?? null;
  const reviews = runReviews.get(runId) ?? new Map<string, ParsedReview>();
  const sides: RunSideStat[] = [...reviews.values()].map((r) => ({
    critic: r.status.critic,
    verdict: r.verdict,
    counts: {
      blocker: r.findings.filter((f) => f.severity === 'blocker').length,
      major: r.findings.filter((f) => f.severity === 'major').length,
      minor: r.findings.filter((f) => f.severity === 'minor').length,
      nit: r.findings.filter((f) => f.severity === 'nit').length,
    },
    state: r.status.state,
    notice: r.status.notice,
  }));
  sides.sort((a, b) => a.critic.localeCompare(b.critic));

  const summary: RunSummary = {
    runId,
    stage: (typeof taskRun?.stage === 'string' ? taskRun.stage : null) ?? archived?.stage ?? 'plan',
    rerunIndex: typeof taskRun?.rerun_index === 'number' ? taskRun.rerun_index : archived?.meta.rerun_index ?? null,
    status: typeof taskRun?.status === 'string' ? taskRun.status : null,
    driver: (typeof taskRun?.driver === 'string' ? taskRun.driver : null) ?? archived?.meta.driver ?? null,
    startedAt: (typeof taskRun?.started_at === 'string' ? taskRun.started_at : null) ?? archived?.meta.started_at ?? null,
    finishedAt: archived?.meta.finished_at ?? null,
    criticsSelected: archived?.meta.critics_selected ?? [],
    metaLocated: archived !== null,
    sides,
  };

  // 归档缺失 → 探测 run_root（AGY-05：仅此场景探测；失败不接管）
  if (!summary.metaLocated) {
    const dir = await probeRunDir(runId);
    if (dir) {
      const status = await readJson(fs, `${dir}/status.json`);
      summary.status = summary.status ?? (typeof status?.['phase'] === 'string' ? (status['phase'] as string) : null);
      summary.metaLocated = status !== null; // 探到目录且有 status.json 才算定位成功
    }
  }
  return summary;
}

/** 便捷工厂：run_root 探测回调（归属纪律：桶前缀过滤 + topic 比对） */
export function makeRunRootProber(runRoot: string, workspaceName: string, topic: string): (runId: string) => Promise<string | null> {
  return (runId) => locateRunDir(runRoot, runId, { repoHint: workspaceName, expectTopic: topic });
}
