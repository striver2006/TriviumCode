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
import type { BuildStamp } from './build-stamp.js';
import { writeAtomic } from './util/fsx.js';
import { topicDir, type ArchiveLayout } from './archive.js';
import { withTopicLock } from './lock.js';
import { validateRunMeta, validateRunMetaV1 } from './schemas.js';
import { DEFAULT_DRIVER, type GuardLevel } from './agents/registry.js';
import { warn } from './util/log.js';

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
    /**
     * 当轮 Driver（M9 第 5 步）。**可选**：早于该步的记录没有这个字段。
     *
     * 设计 §5.2 把 `--driver` 的留痕面写成三处——`run.json.driver`、
     * `task.json.runs[]`、`state.json` 闸门项。第 5 步一开始只落了第一处，
     * 代码双审 CODEX-06 按设计原文核出偏离；这里补齐第二处。
     */
    driver?: AgentId;
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
  /**
   * **按阶段**的 Driver 声明（M10a 第 1 步，EV-72）。**可选**：缺该字段 = 「未声明」。
   *
   * ## 为什么需要它
   *
   * plan / bug 原稿在 `review --start` **之前**由 Driver 写出，那一刻该阶段零留痕，
   * `resolveRoundDriver` 回落 `DEFAULT_DRIVER`，于是非缺省 Driver 的 `-<id>.md` 原稿
   * 被 `isForgedRoleFile` 判成伪造件退 2——**它连自己的原稿都写不出来**。
   * 声明补的正是「留痕诞生之前」这一段。
   *
   * ## 为什么按阶段而不按主题
   *
   * 它要与 `resolveRoundDriver` 第 1 级「该**阶段**最新 `run.json.driver`」同构。
   * 主题级单值会**精确覆盖跨阶段换 Driver 发生的那一刻**（plan 由 claude 执笔、
   * code 换 glm 接手是合法链路），而那一刻正是本字段唯一有用的时候。
   *
   * ## `history[]` 为什么是追加式
   *
   * `drivers[stage]` 是单值、改写即覆盖。而这里的「谁在何时认领过」是**审计面**：
   * 撤回是本字段唯一允许改写既有声明的口子，它的审计面不该最弱。
   * 同文件的 `approvals` / `degradations` / `disputes` 三个数组都是追加式，
   * 先例 `ApprovalRecord.session_id` 的要义恰恰是把「谁干的」持久写进 task.json。
   * 只往 stderr 打一行日志等于撤回史不落任何持久载体（计划双审 r6 GLM-04）。
   *
   * schema 仍是 `trivium.task.v1`——additive 可选字段，旧文件读得动，读侧缺失即「未声明」。
   */
  drivers?: {
    [stage in Stage]?: StageDriverClaim;
  };
}

/** 某一阶段的 Driver 声明（见 {@link TaskMeta.drivers}） */
export interface StageDriverClaim {
  driver: AgentId;
  claimed_at: string;
  /**
   * 谁声明的。**自声明边界的控制点**——本字段之后「当轮 Driver」第一次由
   * 被保护方自己说了算，而它直接决定 Write / Edit 侧的保护集
   * （`hooks.ts` 规则 1：保护集 = 全集减当轮 Driver）。
   *
   * **先例 `ApprovalRecord.session_id` 不能照搬**（计划双审 r6 CODEX-02）：
   * 那个自声明只影响事后对账，**不改变任何保护集**；这个改变保护集。
   * 两者档位不同，故本字段之外另加两重约束——声明一旦被使用即锁死
   * （见 `driver-claim.ts` 分支 3′）、每次撤回入 `history[]`。
   */
  claimed_by: string;
  /** 被撤回的历史声明，**追加不覆盖** */
  history?: (Omit<StageDriverClaim, 'history'> & { revoked_at: string })[];
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
  return updateTaskAsync(l, (t) => Promise.resolve(mutate(t)), lock);
}

/**
 * `updateTask` 的 async 版：**回调可以做 I/O，而且仍在同一个临界区内**。
 *
 * 存在的理由是一次真实的丢更新（代码双审 r1 CODEX-06 ≡ GLM-02）：`topic claim`
 * 的判定要读该阶段子树（判「这个后缀用过没有」），同步回调做不到，于是上一版把
 * **读与判定放在锁外**、只把落盘放进来。并发认领时后写者覆盖前者，
 * 且被覆盖的那条既不在当前值、也不进任何人的 `history`——
 * 「读-改-写在同一临界区」这条前提被绕过了一半。
 *
 * **`mutate` 返回 `false` 表示「不写盘」**：幂等档与被拒档都需要「读了、判了、不改」，
 * 而在锁外先判一次再决定要不要进锁，等于把判据又挪回锁外。
 */
export async function updateTaskAsync(
  l: ArchiveLayout,
  mutate: (t: TaskMeta) => Promise<void | false>,
  lock: TaskLock,
): Promise<TaskMeta> {
  return withTopicLock(
    { triviumDir: lock.triviumDir, topic: taskLockName(l.topic), heartbeatStaleMs: lock.heartbeatStaleMs },
    async () => {
      const t = await readTask(l);
      const r = await mutate(t);
      if (r === false) return t;
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
  /** 当轮发起方。省略时取注册表的 `DEFAULT_DRIVER` */
  driver?: AgentId;
  /**
   * 该 Driver 当时是否**已启用为 Driver**（M9 第 5 步）。
   *
   * M9 的 `--driver` 只校验「已登记」，`driverEnabled === false` 照样放行——
   * 校验它会让第 6 步验收跑不成（当前只有 claude 启用为 Driver，而验收恰恰要
   * claude 当审核者）。放行的代价由这个字段兜住：事后能对出「这一轮声明的
   * Driver 当时还没启用」。M10a 第 3 步已在入口（`resolveDriver`）收紧为退 64，
   * 新运行这里恒为 true；历史留痕仍要能读回，所以它是**可选**字段、
   * 不进 `required`、不加 `if/then`。
   */
  driverEnabled?: boolean;
  /**
   * 当轮 Driver 的有效护栏等级（M10b 第 3 步 B1）。可选：旧调用方与测试夹具不传时不写这个字段，
   * 留痕里「缺失」即「无从得知」——不在这里替它补一个 L1，那等于替没检查过的运行作证。
   */
  driverGuardLevel?: GuardLevel;
  /** 本轮入选的审核者集合。**必填**：它是「本该跑几侧」的唯一事实来源 */
  criticsSelected: readonly CriticId[];
  treeHash: string;
  gitHead: string | null;
  dirty: boolean;
  subjectSha256: string;
  denyPaths: string[];
  driftPolicy: 'warn' | 'fail';
  /** 编排器自带的构建标识（`build-stamp.ts` 的 `embeddedBuildStamp()`）；缺省按 null 记 */
  build?: BuildStamp | null;
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
    // 恒写：缺省 Driver 那一路也要有值，否则「字段缺失」既可能是旧留痕、
    // 也可能是本步漏传，事后分不开（口径与 profile_requested / model_provider 同源）
    driver_enabled: i.driverEnabled ?? true,
    ...(i.driverGuardLevel !== undefined ? { driver_guard_level: i.driverGuardLevel } : {}),
    critics_selected: [...i.criticsSelected],
    snapshot: {
      git_head: i.gitHead,
      tree_hash: i.treeHash,
      dirty: i.dirty,
      subject_sha256: i.subjectSha256,
      drift: { changed: false, files: [], policy: i.driftPolicy },
      // 恒写（null 也写）：缺席只留给本字段之前的旧留痕，与 driver_enabled 同一口径
      build: i.build ?? null,
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
      // 保留字段（EV-137）：run.v1 / v2 必填，写侧恒 false，不代表检测过
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
/**
 * 该阶段**最新一轮**的运行元数据 —— 当轮 Driver 与轮次的**权威来源**（M9 第 5 步）。
 *
 * ## 为什么需要它：后缀反推有循环依赖
 *
 * 闸门区此前靠 `inferLatestRunId`（M10a 第 4 步按 EV-64 删除）/ `resolveRerunIndex`
 * 从**工件后缀**反推，而两者都要先知道当轮 Driver 才能「跳过 Driver 自己的产出」——
 * driver 又只记在运行元数据里。于是形成死循环：
 * 非缺省 Driver 且 `--critics claude` 时，本轮审查件全是 `-claude.md`，
 * 按缺省 Driver 推会把它们**整批跳过**，当时的 `inferLatestRunId` 会返回 null，
 * 命令以「请先跑一次双审」硬失败——而双审明明已经跑完。
 *
 * 曾经想过「先按缺省猜一次、读到元数据后再复算」，那只是把循环包了一层：
 * 裁决件尚未写出时第一趟就断了（而那恰是 `gate --check` 最常用的状态），
 * 且存在可构造的 2-循环。
 *
 * **正解是根本不反推**：run_id 就是文件名，而 `run.v2` 把 `driver` 与
 * `rerun_index` 列为必填。直读即可，一次到位。
 *
 * ## 排序依据
 *
 * `newRunId()` 是 `toISOString()` 去掉分隔符与毫秒，即 `YYYYMMDDTHHMMSSZ`——
 * **定宽 UTC**，所以字典序即时序，这是构造保证而非经验规律
 * （无时区、无变长、无前导零问题）。实测归档内 84 份留痕全部符合该形态。
 *
 * ## 读不出来的怎么办
 *
 * 逐个往下试，直到拿到一份合契约的，**并把跳过的逐个 warn 点名**
 * （代码双审 CODEX-02）：跳过本身是合理的兜底，但静默跳过不是——
 * 最新那条坏掉时闸门会据此把轮次与 run_id 一并变旧，若上一轮本就裁决齐备，
 * `--check` 会返回 ok 而**最新一轮落盘的审查件从未被裁决检查过**。
 * 提交时 `checkRunManifests` 会拦下这种归档（所以不是静默放行），
 * 但闸门自身不留痕迹的话，人看到的只是「第 N-1 轮通过了」。
 *
 * **「一份都没有」与「有但全读不出」是两回事**（代码双审 AGY-01 / GLM-02）：
 * 前者是正常的「还没跑过」，后者是留痕被搅坏。上一版把两者压成同一个 `null`，
 * 于是调用方只能给出同一句「请先跑一次双审」，而 `--check-artifacts` 那一格
 * 更是直接按缺省 Driver 继续——**回落把「留痕坏了」悄悄变成「按 claude 判」，
 * 正是本函数要消灭的形态在自己身上留的一个角**。所以返回体要带上扫描事实。
 */
export interface LatestRunMetaResult {
  /** 最新一份**可读**的运行元数据；一份都读不出来时为 null */
  meta: RunMeta | null;
  /** 该阶段 `_meta/` 下扫到的 `run-*.json` 总数（含读不出来的） */
  scanned: number;
  /** 读不出来的 run_id，按字典序倒序（即从新到旧） */
  unreadable: string[];
}

export async function latestRunMeta(l: ArchiveLayout, stage: Stage): Promise<LatestRunMetaResult> {
  const { metaDir } = await import('./archive.js');
  let files: string[];
  try {
    files = await fs.readdir(metaDir(l, stage));
  } catch {
    // 目录不存在 = 这个阶段还没跑过，属正常，不是异常
    return { meta: null, scanned: 0, unreadable: [] };
  }
  const ids = files
    .map((f) => /^run-(.+)\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .sort()
    .reverse();
  const unreadable: string[] = [];
  for (const id of ids) {
    const m = await readRunMeta(l, stage, id);
    if (m) return { meta: m, scanned: ids.length, unreadable };
    unreadable.push(id);
    // 点名而不是静默跳过：与 run-protocol 的 handoffDriver 同构
    warn(`运行元数据 ${id}（${stage} 阶段）读不出来，已跳过——留痕可能被改坏或不合契约`);
  }
  return { meta: null, scanned: ids.length, unreadable };
}

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

// ─────────────────────── --cancel 的归档侧收尾（EV-128） ───────────────────────

/** `finalizeCancelledRunMeta` 每一步的结果；`error` 为真表示是异常转成的跳过 */
export type FinalizeStep =
  | { kind: 'written' }
  | { kind: 'skipped'; why: string; error?: boolean };

const skipped = (why: string): FinalizeStep => ({ kind: 'skipped', why });
const skippedFromError = (what: string, e: unknown): FinalizeStep => ({
  kind: 'skipped',
  why: `${what}出错：${String((e as Error)?.message ?? e).split('\n')[0]}`,
  error: true,
});

/**
 * 把被 `review --cancel` 的运行在归档侧收尾（EV-128，计划 r2 §3.2）。
 *
 * 取消轮从来走不到 worker 的收尾：worker 被杀在收尾之前，run.json 停在骨架的 `running`。
 * 这里补上它**唯一一次**终态写入，写完同样不再更新——与 EV-133「收尾后不再更新」不冲突。
 *
 * **两步各自独立判定，对进程中断可重入**：`cancelRun` 把本函数排在 `patchStatus` 之前，
 * 进程死在任意两次写之间时 status.json 仍非终态，再跑一次 `--cancel` 会把没做完的那一步补上
 * （上一版排在 `patchStatus` 之后，中断即永久停在 running——计划双审 r1 CODEX-01 ≡ GLM-01）。
 * **对单步写失败不可重入**（代码双审 r1 CODEX-01）：异常转成 skipped 后 `cancelRun` 照常落终态，
 * 之后 `--cancel` 在终态分支早退，这一步没有第二次机会——`cancelRun` 的告警会当场说出来，要人工对账。
 *
 * **自身不抛**：两步各包一层捕获，任何异常都转成该步的 skipped。只设这一道——
 * 调用方不再另包，免得两层互为冗余（r1 CODEX-02 ≡ AGY-01 ≡ GLM-02）。锁与闸门回收排在它之后，
 * 归档侧失败不得连坐那两项：闸门卡在 running 会把 Driver 永久锁在一个已经不存在的运行上。
 */
export async function finalizeCancelledRunMeta(i: {
  layout: ArchiveLayout;
  stage: Stage;
  runId: string;
  lock: TaskLock;
  /** `cancelRun` 传 `workerConfirmedGone(...).gone`；显式入参，接线才有用例守得住 */
  workerGone: boolean;
}): Promise<{ runMeta: FinalizeStep; task: FinalizeStep }> {
  const runMeta = await cancelRunMetaStep(i).catch((e: unknown) => skippedFromError('回写 run.json ', e));
  const task = await cancelTaskEntryStep(i).catch((e: unknown) => skippedFromError('同步 task.json ', e));
  return { runMeta, task };
}

/**
 * 第一步：run.json。四个前提任一不满足即跳过、不改文件：
 *   1. 工作进程已确认退出——没确认到就可能还有写者（进程组里的后代、正要收尾的 worker），两个写者会互相覆盖；
 *   2. 主题与阶段已知（由调用方给出）；
 *   3. 原始 JSON 是 run.v2——`readRunMeta` 读进来的 v1 是**迁移后的内存形状**，写回会把历史文件改成 v2；
 *   4. 合契约且仍为 `running`——已是终态（含 worker 先写完 run.json、status.json 还没改的窗口）一律不动。
 *
 * 只改三格：`status`、`finished_at`、`gate.state`。`artifacts[]` 原样——提交锚对 HEAD 为 running 的
 * run.json 只查 `run_id` 与已登记条目（`hooks.ts` `runningRewriteViolation`），所以「运行中途提交过、之后被取消」
 * 也能正常提交。`gate.warnings` 不追加：它会被回灌成 `run_warning`（EV-133）。
 */
async function cancelRunMetaStep(i: {
  layout: ArchiveLayout; stage: Stage; runId: string; workerGone: boolean;
}): Promise<FinalizeStep> {
  if (!i.workerGone) {
    return skipped('工作进程未确认退出，不写归档 run.json（可能还有写者，两边会互相覆盖）');
  }
  const { metaDir } = await import('./archive.js');
  const p = path.join(metaDir(i.layout, i.stage), runMetaFileName(i.runId));
  let text: string;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch {
    return skipped(`归档里没有 ${runMetaFileName(i.runId)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return skipped(`${runMetaFileName(i.runId)} 不可解析，不动它`);
  }
  const schema = (raw as { schema?: unknown } | null)?.schema;
  if (schema !== 'trivium.run.v2') {
    return skipped(`schema 为 ${JSON.stringify(schema)}，只回写 run.v2（不改历史形状）`);
  }
  if (validateRunMeta(raw).length > 0) return skipped('不合 trivium.run.v2 契约，不动它');
  const meta = raw as RunMeta;
  if (meta.status !== 'running') return skipped(`已是终态（${meta.status}），不追溯改写`);

  meta.status = 'cancelled';
  meta.finished_at = new Date().toISOString();
  meta.gate.state = 'cancelled';
  await writeRunMeta(i.layout, i.stage, meta);
  return { kind: 'written' };
}

/**
 * 第二步：task.json 的运行登记。**不依赖第一步这一次写没写**——run.json 已是 `cancelled`
 * （这一次或上一次写的）、登记仍为 `running` 就补上，于是两次写之间被打断也能由下一次 `--cancel` 补齐。
 *
 * 按 run_id 精确匹配；找不到就跳过——`prepareRun` 先写 run.json、后登记，中间被打断会留下这种形态，
 * 这里不新建条目、不取末条（r1 CODEX-04 ≡ AGY-03）。只改这一条的 `status`，不走 `registerRun` 的整条覆盖。
 */
async function cancelTaskEntryStep(i: {
  layout: ArchiveLayout; stage: Stage; runId: string; lock: TaskLock;
}): Promise<FinalizeStep> {
  const m = await readRunMeta(i.layout, i.stage, i.runId);
  if (m?.status !== 'cancelled') {
    return skipped(`归档 run.json 不是 cancelled（${m ? m.status : '读不到'}），不改登记`);
  }
  let outcome: FinalizeStep = skipped('task.json 无此运行的登记（不新建条目）');
  await updateTaskAsync(i.layout, async (t) => {
    const entry = t.runs.find((r) => r.run_id === i.runId);
    if (!entry) return false;
    if (entry.status !== 'running') {
      outcome = skipped(`登记已是 ${entry.status}，不改`);
      return false;
    }
    entry.status = 'cancelled';
    outcome = { kind: 'written' };
    return undefined;
  }, i.lock);
  return outcome;
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
      // 与 run.json.driver 同源：设计 §5.2 要求这一处也记（代码双审 CODEX-06）
      driver: meta.driver,
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
