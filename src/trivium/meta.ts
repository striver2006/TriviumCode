/**
 * `meta`：`run-<run_id>.json` 与 `task.json` 的读写（设计 §6.7 / NFR-05 / FR-24）。
 *
 * 这两份文件是「可观测」的机读落点：每次运行必须可核对主题、阶段、两侧实际模型、
 * 起止时间、成功/失败/单审降级。写入一律「读 → 改 → 原子替换」，且只在持锁时进行
 * （§12.6），避免 `-r<N>` 计算与状态更新竞争。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CriticId, RunMeta, Stage, StageOrVerify, CommandEntry } from './types.js';
import { writeAtomic } from './util/fsx.js';
import { topicDir, type ArchiveLayout } from './archive.js';
import { withTopicLock } from './lock.js';
import { validateRunMeta } from './schemas.js';

/** `updateTask` 的短临界区参数 */
export interface TaskLock {
  triviumDir: string;
  heartbeatStaleMs: number;
}

/**
 * task.json 的临界区用**独立**锁名，不复用主题锁 `<主题>.lock`：
 * 后者由 review worker 以长持锁形式占着，worker 自己收尾时要写 task.json，
 * 复用会自锁。`.` 开头保证不与任何主题撞名（§6.1 禁止主题以 `.` 开头），
 * `hook-session-start` 枚举锁目录时也会跳过它。
 */
const taskLockName = (topic: string): string => `.task-${topic}`;

/** run_id 形如 20260910T142310Z：UTC 紧凑时间戳，可排序、可做文件名 */
export function newRunId(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export const runMetaFileName = (runId: string): string => `run-${runId}.json`;

// ─────────────────────────── task.json ───────────────────────────

export interface ApprovalRecord {
  at: string;
  stage: Stage;
  run_id: string;
  decision: 'approved' | 'rejected' | 'abandoned';
  reason: string | null;
  /**
   * 发起这次审批的会话 id，`null` 表示没传（审查意见 GLM-05）。
   *
   * 「谁解的闸」是整条链子上最该留痕的事件，原先却是唯一不留痕的：
   * `ApprovalInput.sessionId` 从 CLI 就没传进来、`recordApproval` 也不用它。
   * 事后无法回答「这次 approve 是人发的还是模型发的」。
   */
  session_id?: string | null;
  /** 是否校验过审批确认码。`approved` 恒为 true（不带码根本进不来），其余为 false */
  code_verified?: boolean;
}

export interface TaskMeta {
  schema: 'trivium.task.v1';
  topic: string;
  /**
   * 任务目标原文（设计 §9.4）：这次到底想达成什么。
   *
   * 与 `prompt_hint`（本次审查焦点，RV-19）是两回事，不可互相顶替。
   * 主题级持久化：首次由 `/dual-run <任务目标>` 落下，之后 code / bug 阶段直接复用——
   * 否则审查员只知道「改了什么」，不知道「想达成什么」，判不了改没改偏（FR-03）。
   */
  goal: string | null;
  created_at: string;
  updated_at: string;
  /** 每阶段每轮的运行指针，形成可回溯的版本链（FR-25） */
  runs: {
    run_id: string;
    /**
     * `verify` 也在内（审查意见 GLM-r2-08）：验证记录是 AC-10 的对账凭证，
     * 必须和三个审查阶段一样受留痕核对保护，那就得先在这里登记。
     */
    stage: StageOrVerify;
    rerun_index: number;
    status: RunMeta['status'];
    review_mode: RunMeta['review_mode'];
    started_at: string;
  }[];
  /** 当前闸门状态 */
  gate: { stage: Stage | null; state: string; since: string | null; run_id: string | null };
  approvals: ApprovalRecord[];
  /** 降级事件（§12.4 要求 task.json 记录） */
  degradations: { run_id: string; stage: Stage; reason: string; at: string }[];
  /** 双方共同 blocker 被驳回等争议项（§6.6 规则 7） */
  disputed: boolean;
  disputes: { run_id: string; finding_ids: string[]; note: string }[];
}

const taskPath = (l: ArchiveLayout): string => path.join(topicDir(l), 'task.json');

export function emptyTask(topic: string, now = new Date().toISOString()): TaskMeta {
  return {
    schema: 'trivium.task.v1',
    topic,
    goal: null,
    created_at: now,
    updated_at: now,
    runs: [],
    gate: { stage: null, state: 'idle', since: null, run_id: null },
    approvals: [],
    degradations: [],
    disputed: false,
    disputes: [],
  };
}

/**
 * 读 `task.json`，**区分「不存在」与「存在但读不出来」**（审查意见 AGY-01 ≡ GLM-02）。
 *
 * 这两种情况对不同调用方意味着完全相反的事：
 *   · `report`：都算「没有可用数据」，宽松降级即可；
 *   · **留痕核对**：`task.json` 是外部锚。「不存在」是正常（主题刚建、还没跑过），
 *     「存在但损坏」却意味着**锚本身被搅坏了**——静默回落 `emptyTask` 等于让
 *     核对失去全部对象，删掉或搅坏它就能整枝绕过。
 *
 * 我上一批刚修掉「清单来自被核对对象自身」，却让新加的锚重蹈了同样的覆辙。
 */
export async function readTaskStrict(
  l: ArchiveLayout,
): Promise<{ task: TaskMeta; state: 'ok' | 'missing' | 'unreadable'; error?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(taskPath(l), 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { task: emptyTask(l.topic), state: 'missing' };
    return { task: emptyTask(l.topic), state: 'unreadable', error: (e as Error).message };
  }
  try {
    return { task: JSON.parse(raw) as TaskMeta, state: 'ok' };
  } catch (e) {
    return { task: emptyTask(l.topic), state: 'unreadable', error: (e as Error).message };
  }
}

/** 宽松版：读不到就当空。只给「缺数据也能继续」的调用方用（如 report） */
export async function readTask(l: ArchiveLayout): Promise<TaskMeta> {
  return (await readTaskStrict(l)).task;
}

/**
 * 读 → 改 → 原子替换，**在短临界区内**（§12.6 / GLM-08）。
 *
 * 原子替换只防撕裂不防丢更新：worker 收尾的 `registerRun`、`trivium verify` 的
 * `registerVerifyRun`、`/dual-approve` 的审批记录，三者互不持锁时会互相覆盖——
 * 丢一条 run 指针，那个 run 的 run.json 就失去了外部锚。头注释「调用方须持有主题锁」
 * 原先无人遵守（`withTopicLock` 全仓零调用），现在由本函数自己加锁。
 */
export async function updateTask(
  l: ArchiveLayout,
  mutate: (t: TaskMeta) => void,
  lock: TaskLock,
): Promise<TaskMeta> {
  return withTopicLock(
    { triviumDir: lock.triviumDir, topic: taskLockName(l.topic), heartbeatStaleMs: lock.heartbeatStaleMs },
    async () => {
      const t = await readTask(l);
      mutate(t);
      t.updated_at = new Date().toISOString();
      await writeAtomic(taskPath(l), JSON.stringify(t, null, 2) + '\n');
      return t;
    },
  );
}

// ─────────────────────────── run.json ───────────────────────────

export interface NewRunMetaInput {
  runId: string;
  topic: string;
  stage: Stage;
  rerunIndex: number;
  command: string;
  promptHint: string | null;
  /** 本次运行实际送进 BRIEF 第 4 段的任务目标（已解析，可能来自 task.json 或 plan 原稿） */
  taskGoal: string | null;
  /** 发起本次运行的斜杠命令（A/B/C/D），手工调用为 null */
  entry?: CommandEntry | null;
  treeHash: string;
  gitHead: string | null;
  dirty: boolean;
  subjectSha256: string;
  denyPaths: string[];
  driftPolicy: 'warn' | 'fail';
}

/** 运行开始时先写一份 `status: running` 的骨架，便于 `--wait` 与崩溃后取证 */
export function newRunMeta(i: NewRunMetaInput): RunMeta {
  return {
    schema: 'trivium.run.v1',
    run_id: i.runId,
    topic: i.topic,
    stage: i.stage,
    rerun_index: i.rerunIndex,
    command: i.command,
    prompt_hint: i.promptHint,
    task_goal: i.taskGoal,
    entry: i.entry ?? null,
    snapshot: {
      git_head: i.gitHead,
      tree_hash: i.treeHash,
      dirty: i.dirty,
      subject_sha256: i.subjectSha256,
      drift: { changed: false, files: [], policy: i.driftPolicy },
    },
    started_at: new Date().toISOString(),
    finished_at: null,
    review_mode: 'dual',
    degraded_reason: null,
    critics: {},
    deny_paths: i.denyPaths,
    guard: {
      readonly_breach: false,
      peer_artifact_read: false,
      peer_deny_applied: {},
      forged_role_file: false,
    },
    artifacts: [],
    gate: { adjudication_complete: false, state: 'running' },
    status: 'running',
  };
}

export async function writeRunMeta(
  l: ArchiveLayout,
  stage: Stage,
  meta: RunMeta,
): Promise<string> {
  // 写前按 trivium.run.v1 校验：不合契约的运行元数据是程序缺陷，宁可在这里炸也不落盘
  const problems = validateRunMeta(meta);
  if (problems.length > 0) {
    throw new Error(`run.json 不符合 trivium.run.v1：${problems.join('；')}`);
  }
  // 走 archive 是纪律（§16.2 纪律 2），但 run.json 不含审查正文、
  // 且 archive.writeMeta 已含密钥扫描，这里直接复用它
  const { writeMeta } = await import('./archive.js');
  const w = await writeMeta(l, stage, runMetaFileName(meta.run_id), JSON.stringify(meta, null, 2) + '\n');
  return w.absPath;
}

export async function readRunMeta(
  l: ArchiveLayout,
  stage: Stage,
  runId: string,
): Promise<RunMeta | null> {
  const { metaDir } = await import('./archive.js');
  try {
    const p = path.join(metaDir(l, stage), runMetaFileName(runId));
    return JSON.parse(await fs.readFile(p, 'utf8')) as RunMeta;
  } catch {
    return null;
  }
}

/** 把一次运行登记进 task.json（幂等：同 run_id 覆盖而非追加） */
export async function registerRun(l: ArchiveLayout, meta: RunMeta, lock: TaskLock): Promise<void> {
  await updateTask(l, (t) => {
    const entry = {
      run_id: meta.run_id,
      stage: meta.stage,
      rerun_index: meta.rerun_index,
      status: meta.status,
      review_mode: meta.review_mode,
      started_at: meta.started_at,
    };
    const at = t.runs.findIndex((r) => r.run_id === meta.run_id);
    if (at === -1) t.runs.push(entry);
    else t.runs[at] = entry;

    if (meta.degraded_reason) {
      const already = t.degradations.some((d) => d.run_id === meta.run_id);
      if (!already) {
        t.degradations.push({
          run_id: meta.run_id,
          stage: meta.stage,
          reason: meta.degraded_reason,
          at: new Date().toISOString(),
        });
      }
    }
  }, lock);
}

/** 人读的运行摘要（命令输出用，对应 §13.2 第 1 处落点） */
export function summarizeRun(meta: RunMeta): string {
  const lines: string[] = [
    `主题 ${meta.topic} ｜ 阶段 ${meta.stage} ｜ 第 ${meta.rerun_index} 轮 ｜ 运行 ${meta.run_id}`,
    `状态 ${meta.status} ｜ 模式 ${meta.review_mode}${meta.degraded_reason ? `（降级：${meta.degraded_reason}）` : ''}`,
  ];
  for (const c of Object.keys(meta.critics) as CriticId[]) {
    const m = meta.critics[c]!;
    lines.push(
      `  ${c}: ${m.status} ｜ 模型 ${m.model_effective ?? '未回读到'}` +
        `（请求 ${m.model_requested ?? '—'}，来源 ${m.model_effective_source ?? '—'}）` +
        ` ｜ ${Math.round(m.duration_s)}s ｜ 证据 ${m.evidence_ok ? 'ok' : '不足'}` +
        ` ｜ 工具 ${JSON.stringify(m.tool_calls)}`,
    );
  }
  if (meta.snapshot.drift.changed) {
    lines.push(`  ⚠️ 漂移：${meta.snapshot.drift.files.length} 个文件（策略 ${meta.snapshot.drift.policy}）`);
  }
  if (meta.guard.readonly_breach) lines.push('  ⚠️ 只读失守');
  if (meta.guard.peer_artifact_read) lines.push('  ⚠️ 读到对方产出');
  return lines.join('\n');
}
