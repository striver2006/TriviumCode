/**
 * `meta`：`run-<run_id>.json` 与 `task.json` 的读写（设计 §6.7 / NFR-05 / FR-24）。
 *
 * 这两份文件是「可观测」的机读落点：每次运行必须可核对主题、阶段、两侧实际模型、
 * 起止时间、成功/失败/单审降级。写入一律「读 → 改 → 原子替换」，且只在持锁时进行
 * （§12.6），避免 `-r<N>` 计算与状态更新竞争。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  AgentId, CriticId, LegacyReviewMode, RunMeta, Stage, StageOrVerify, CommandEntry,
} from './types.js';
import { writeAtomic } from './util/fsx.js';
import { topicDir, type ArchiveLayout } from './archive.js';
import { withTopicLock } from './lock.js';
import { validateRunMeta, validateRunMetaV1 } from './schemas.js';
import { DEFAULT_DRIVER } from './agents/registry.js';

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
    /**
     * 本轮完成度。**联合里带着 v1 的旧取值**（`dual` / `single`）：
     * `task.json` 仍是 `trivium.task.v1`，既有文件里存着它们，而本字段
     * 目前只写不读（没有任何消费点），没有理由为了收窄类型去改写历史留痕。
     * 真要判完成度请读 `run-<id>.json`——那里的 v1 记录有正式的迁移路径。
     */
    review_mode: RunMeta['review_mode'] | LegacyReviewMode;
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
  /**
   * 共同阻断这一档的**最终三态**，由 `gate --check` 落（§6.6 规则 7 / §12.1）。
   *
   * **为什么不写回 run.json**：那份是运行事实、只写一次，而这一档要等裁决表齐备
   * 才判得了——run.json 落的是 `pending`。两者分工是「运行期记它能知道的，
   * 校验期记它才知道的」，不是同一个字段的两次写。
   *
   * 没有这个持久面时，`checked-found`（查过、确有共同项）**永久不可达**：
   * 它只在 `gate --check` 的内存里存在过，任何事后读留痕的人都看不到它。
   * 三态于是在留痕面上塌回两态——而这一档的全部意义就是三态。
   *
   * 每轮一条，按 `run_id` 覆盖：`--check` 可以反复跑，同一轮的结论以最后一次为准。
   */
  joint_checks?: {
    run_id: string;
    stage: Stage;
    rerun_index: number;
    state: 'checked-none' | 'checked-found' | 'skipped-insufficient-sides';
    effective_sides: number;
    /** 有效侧不足时的成因（作废排除 / 无结构化结论 / 两者） */
    reason?: 'voided' | 'no-structured-review' | 'both';
    at: string;
  }[];
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
  /** 当轮发起方。省略时取注册表的 `DEFAULT_DRIVER`（M7b 恒为 claude） */
  driver?: AgentId;
  /** 本轮入选的审核者集合。**必填**：它是「本该跑几侧」的唯一事实来源 */
  criticsSelected: readonly CriticId[];
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
    schema: 'trivium.run.v2',
    run_id: i.runId,
    topic: i.topic,
    stage: i.stage,
    rerun_index: i.rerunIndex,
    command: i.command,
    prompt_hint: i.promptHint,
    task_goal: i.taskGoal,
    entry: i.entry ?? null,
    driver: i.driver ?? DEFAULT_DRIVER,
    critics_selected: [...i.criticsSelected],
    snapshot: {
      git_head: i.gitHead,
      tree_hash: i.treeHash,
      dirty: i.dirty,
      subject_sha256: i.subjectSha256,
      drift: { changed: false, files: [], policy: i.driftPolicy },
    },
    started_at: new Date().toISOString(),
    finished_at: null,
    /*
     * 骨架先记 `full`：此刻还没有任何一侧失败。
     * 真值由 `review.ts` 在 `decideMode` 之后回填（入选侧全成功才留 `full`）。
     */
    review_mode: 'full',
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
  // 写前按 trivium.run.v2 校验：不合契约的运行元数据是程序缺陷，宁可在这里炸也不落盘
  const problems = validateRunMeta(meta);
  if (problems.length > 0) {
    throw new Error(`run.json 不符合 trivium.run.v2：${problems.join('；')}`);
  }
  // 走 archive 是纪律（§16.2 纪律 2），但 run.json 不含审查正文、
  // 且 archive.writeMeta 已含密钥扫描，这里直接复用它
  const { writeMeta } = await import('./archive.js');
  const w = await writeMeta(l, stage, runMetaFileName(meta.run_id), JSON.stringify(meta, null, 2) + '\n');
  return w.absPath;
}

/**
 * 把一份 `trivium.run.v1` 记录映射为**内存中的 v2 形状**（设计 §6.7.1）。
 *
 * 落盘的 v1 文件原样不动——它是不可变工件（P6），迁移只发生在读进内存这一刻。
 * 映射规则由 §6.7.1 钉死：
 *   · `dual → full`、`single → partial`；
 *   · `driver` 缺省 `claude`（v1 时代 Driver 是系统常量，不存在别的可能）；
 *   · `critics_selected` 由 `critics` 的实有键推导。
 *
 * **最后一条是有损的**：v1 里「入选但整侧失联」与「压根没入选」本来就分不开，
 * 键集是当时能拿到的最好近似。迁移不会把信息变多，只是把旧事实放进新形状——
 * 调用方据此判缺件时，对 v1 记录的结论仍然只有 v1 那么准。
 */
export function migrateRunMetaV1(raw: unknown): RunMeta {
  const v1 = raw as Omit<RunMeta, 'schema' | 'driver' | 'critics_selected' | 'review_mode'> & {
    schema: 'trivium.run.v1';
    review_mode: LegacyReviewMode;
  };
  return {
    ...v1,
    schema: 'trivium.run.v2',
    driver: DEFAULT_DRIVER,
    critics_selected: Object.keys(v1.critics ?? {}) as CriticId[],
    review_mode: v1.review_mode === 'single' ? 'partial' : 'full',
  };
}

/**
 * 读回一份审查阶段的运行元数据，**按 schema 精确分发**（设计 §6.7.1 读侧）。
 *
 * 此前这里是 `JSON.parse` 直转、零校验：`schema` 字段写成任何字符串都能读出来，
 * 而返回值会被 `gate` 与 `report` 当成事实用。改为只认两种形状：
 *   · `trivium.run.v1` → v1 校验器通过后映射为内存 v2；
 *   · `trivium.run.v2` → v2 校验器；
 *   · 其余（含 `schema` 缺失）→ `null`，与「文件不存在」同等对待。
 *
 * 注意本函数只服务审查阶段（签名即是 `Stage`）。verify 阶段另有形状，
 * 它的分支在 `archive.ts` 的 `listRecordedRuns` 里——那条分支写错会让归档中
 * 全部 verify 历史记录被判不可读，进而**永久拦死本仓库的每一次提交**（§6.7.1 的方框）。
 */
export async function readRunMeta(
  l: ArchiveLayout,
  stage: Stage,
  runId: string,
): Promise<RunMeta | null> {
  const { metaDir } = await import('./archive.js');
  let raw: unknown;
  try {
    const p = path.join(metaDir(l, stage), runMetaFileName(runId));
    raw = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
  const schema = (raw as { schema?: unknown } | null)?.schema;
  if (schema === 'trivium.run.v2') {
    return validateRunMeta(raw).length === 0 ? (raw as RunMeta) : null;
  }
  if (schema === 'trivium.run.v1') {
    return validateRunMetaV1(raw).length === 0 ? migrateRunMetaV1(raw) : null;
  }
  return null;
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
    /*
     * 参与者事实与降级警示**分开说**（设计 §3.4 / AC-22）。
     * 「入选 1 侧并成功」是配置意图，不该看起来像出了事；而只印 `full`
     * 又看不出本轮到底审了谁——两件事各占一句，谁也不顶替谁。
     */
    `状态 ${meta.status} ｜ 完成度 ${meta.review_mode}` +
      `${meta.degraded_reason ? `（降级：${meta.degraded_reason}）` : ''}`,
    `本轮审核者：${meta.critics_selected.join('、') || '（无）'} ｜ 发起方 ${meta.driver}`,
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
