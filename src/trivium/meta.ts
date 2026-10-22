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
  AgentId, CriticId, LegacyReviewMode, PlanFinalCheck, ReviewLoop, RunMeta, RunTermination, Stage, StageOrVerify, CommandEntry,
} from './types.js';
import { describeDriftUnknown } from './types.js';
// gate.ts 的静态依赖闭包不含本文件（EV-224 编码时核过），不成环
import { readonlyBreachLabel } from './gate.js';
import { embeddedBuildStamp, type BuildStamp } from './build-stamp.js';
import { writeAtomic } from './util/fsx.js';
import { metaDir as metaDirOf, topicDir, type ArchiveLayout } from './archive.js';
import { withTopicLock } from './lock.js';
import { validateRunMeta, validateRunMetaV1 } from './schemas.js';
import { DEFAULT_DRIVER, type GuardLevel } from './agents/registry.js';
import { warn } from './util/log.js';
import { envError } from './exit-codes.js';

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
export const taskLockName = (topic: string): string => `.task-${topic}`;

/** run_id 形如 20260910T142310Z：UTC 紧凑时间戳，可排序、可做文件名 */
export function newRunId(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** `allocateRunId` 往后抬的次数上限：一秒一次，120 次即两分钟——正常使用到不了，用尽说明留痕异常 */
export const RUN_ID_MAX_BUMPS = 120;

const RUN_ID_STAGES: readonly StageOrVerify[] = ['plan', 'code', 'bug', 'verify'];

/**
 * 分配一个本主题内不撞名的 run_id（EV-147）。
 *
 * `newRunId` 只到秒，`writeMeta` 对 `_meta/` 覆盖写、`registerRun` 按 run_id 替换登记——同一秒起的第二轮会把
 * 第一轮的 run.json 与登记整份盖掉（准备阶段失败是亚秒级的，紧接着重跑就撞）。这里不改格式：从 `newRunId(now)`
 * 起，已被占用就往后抬一秒。「占用」= task.json `runs[]` 已有这个 run_id（各阶段共用一个键空间），或任一阶段
 * `_meta/run-<id>.json` 已存在；task.json 读不出时只看文件。
 *
 * **运行目录**（EV-218）：运行目录是 `<运行根>/<repoId>/<runId>`，按仓库分、不按主题分；两个主题各持各的主题锁，
 * 同一秒起跑会分到同一个 run_id、共用一个运行目录（实测后到的那一轮被静默吞掉）。给了 `claimRunDirIn`（本仓库的桶）
 * 时，对每个本主题未占用的候选 id 再做**非 recursive** 的 `mkdir <桶>/<id>`：建成即占到（目录由本次运行独占），
 * `EEXIST` 即别的运行已占用、往后抬一秒——排他靠文件系统的原子 mkdir，不靠事先查看。审查运行（`prepareRun`）传它；
 * `verify` 不建运行目录，不传。
 *
 * 抬出来的 id 仍是定宽 UTC 形态且大于被占用者，`latestRunMeta` 的「字典序即时序」照旧成立；代价是 run_id 不再
 * 保证等于开始时刻的秒，开始时刻以 `started_at` 为准。归档那一半的检查与随后的写入之间不加锁：审查运行在主题锁内
 * 分配，先后两轮不会撞；不持主题锁的 verify 与审查运行**同一秒并发**分配时仍可能撞，这一格不在本函数的承诺里。
 */
export async function allocateRunId(
  l: ArchiveLayout,
  now: Date = new Date(),
  maxBumps: number = RUN_ID_MAX_BUMPS,
  opts: {
    claimRunDirIn?: string;
    /** 占到运行目录时回调：`created` 为真是本次建的，为假是测试开关下接管的已有目录（调用方失败时只删前者） */
    onRunDirClaimed?: (dir: string, created: boolean) => void;
  } = {},
): Promise<string> {
  const { task, state } = await readTaskStrict(l);
  const registered = new Set(state === 'ok' && Array.isArray(task.runs) ? task.runs.map((r) => r.run_id) : []);
  const fileTaken = async (id: string): Promise<boolean> => {
    for (const stage of RUN_ID_STAGES) {
      try {
        await fs.lstat(path.join(metaDirOf(l, stage), runMetaFileName(id)));
        return true;
      } catch {
        // 不存在或读不到：看下一个阶段
      }
    }
    return false;
  };
  const bucket = opts.claimRunDirIn ?? null;
  if (bucket !== null) await fs.mkdir(bucket, { recursive: true });
  /** 占运行目录：建成或（测试开关下）接管已存在的 ⇒ true；被别的运行占着 ⇒ false */
  const claimRunDir = async (id: string): Promise<boolean> => {
    if (bucket === null) return true;
    const dir = path.join(bucket, id);
    try {
      await fs.mkdir(dir);
      opts.onRunDirClaimed?.(dir, true);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e;
      if (process.env[ADOPT_PRECREATED_RUN_DIR_ENV] !== '1') return false;
      opts.onRunDirClaimed?.(dir, false);
      return true;
    }
  };
  for (let i = 0; i <= maxBumps; i++) {
    const id = newRunId(new Date(now.getTime() + i * 1000));
    if (!registered.has(id) && !(await fileTaken(id)) && (await claimRunDir(id))) return id;
  }
  throw envError(
    `主题「${l.topic}」从 ${newRunId(now)} 起连续 ${maxBumps + 1} 个 run_id 都已被占用（task.json 登记或 _meta/run-*.json` +
      `${bucket !== null ? '，或运行目录已存在' : ''}）：留痕可能异常，请检查该主题的归档后重试`,
  );
}

/**
 * **只给故障注入用例用的测试开关**（EV-218，用户 2026-10-06 定候选 A）：设为 `1` 时，`allocateRunId` 把已存在的
 * 运行目录当作可占用（接管），不往后抬。
 *
 * 用途只有一个：`gate-loop` 里 EV-145 / EV-150 那几格预建运行目录、在里面做手脚（目录只读、把 `worker.pid` 摆成目录），
 * 制造「落骨架之后写盘失败」。没有这个开关，排他占用会把预建目录当成别的运行的、绕开它们，那几格就测不到原本要测的东西。
 * 生产与其余用例一律不设；设了就失去跨主题同秒的保护。接管的目录不是本进程建的，`prepareRun` 失败时也不删它。
 */
export const ADOPT_PRECREATED_RUN_DIR_ENV = 'TRIVIUM_TEST_ADOPT_PRECREATED_RUN_DIR';

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
  driverModel?: string | null;
  driverProvider?: string | null;
  runId: string;
  topic: string;
  stage: Stage;
  rerunIndex: number;
  command: string;
  promptHint: string | null;
  /** 本次运行实际送进 BRIEF 第 4 段的任务目标（已解析，可能来自 task.json 或本主题计划定稿） */
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
  /**
   * 计划定稿校验标记（EV-214）：计划阶段由 `prepareRun` 传入，代码与 bug 阶段不传、不写。
   * 不在这里按阶段补一个默认值——缺失即「这一轮不按 EV-214 的规则判」，替没算过的运行作证等于追溯历史。
   */
  planFinalCheck?: PlanFinalCheck;
  /**
   * 轮次链位置（EV-247）：计划与代码阶段由 `prepareRun` 传入，bug 阶段与跳过轮不传、不写。
   * 理由同 `planFinalCheck`：缺失即「这一轮不按多轮循环的规则判」，不在这里按阶段补默认值。
   */
  reviewLoop?: ReviewLoop;
  /**
   * 本轮实际使用的档位表名（`--profile` 覆盖后的 `active_profile`，M11 第 6 步，设计 6.7.1 顶层 `profile`）。
   * `review` 的准备阶段恒传；可选只是为了不逼几十处只关心别的字段的测试夹具一起改——
   * 生产写侧不存在「没传」这条路，所以缺席仍只表示 M11 第 6 步之前的旧留痕。
   */
  profile?: string;
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
    schema: 'trivium.run.v3',
    driver_declaration: { model: i.driverModel ?? null, provider: i.driverProvider ?? null,
      source: i.driverModel || i.driverProvider ? 'declared' : null },
    family_comparisons: [],
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
    ...(i.planFinalCheck !== undefined ? { plan_final_check: { subject_rerun_index: i.planFinalCheck.subject_rerun_index } } : {}),
    ...(i.reviewLoop !== undefined ? { review_loop: { round: i.reviewLoop.round, max_rounds: i.reviewLoop.max_rounds } } : {}),
    ...(i.profile !== undefined ? { profile: i.profile } : {}),
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
    requested_routes: {},
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
  // 写前按声明的v2/v3契约校验；新运行只写v3，历史收尾保留原形状。
  const problems = validateRunMeta(meta);
  if (problems.length > 0) {
    throw new Error(`run.json 不符合 ${meta.schema}：${problems.join('；')}`);
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
 * 而返回值会被 `gate` 与 `report` 当成事实用。只认三种形状：
 *   · `trivium.run.v1` → v1 校验器通过后映射为内存 v2；
 *   · `trivium.run.v2` → v2 校验器；
 *   · `trivium.run.v3` → v3 校验器（当前写形）；
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
 * （EV-73 起这一格不再发生：`cmdGate` 与 `resolveStageDriver` 一样，`unreadable` 非空即硬失败，
 * 本函数的「往下试」只为把最新一份可读的交给调用方点名；告警照旧。）
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

// ─────────────────────── 运行留痕读不出时的出口（EV-148 文案部分） ───────────────────────

/**
 * 运行留痕读不出时，七处拒绝文案**共用的出口段**（留痕读不出的出口计划 r2 §2.1）。
 *
 * 七处是：Driver 判定的四个消费点（`review --start`、`topic claim`、`topic resolve`、`hook-pre-write`，
 * 都撞 `resolveStageDriver` 的 `corrupt`），`gate` 扫到的运行元数据一份都读不出，以及
 * `verifyRoundForApproval` 读不出本轮运行元数据时 `--await-approval` 与 `approve` 各自的出口。
 * 各处只写自己的前半句（什么判不了、为什么不按缺省），出口一律以本段收尾——
 * 上一版七处各写一句，全都写成「重跑一次该阶段双审」，而那条路在 `review --start` 入口就被
 * 同一个 `corrupt` 判定拒绝（重跑到不了先落骨架那一步），出口指回自己。
 * 此后 `gate` 又有两处同状态的拒绝接上本段：`--run-id` 钉住的那一份读不出（代码双审 r1 GLM-01），
 * 以及取到了可读的一份、但比它更新的读不出（EV-73，与 `resolveStageDriver` 的 `corrupt` 同口径）。
 *
 * 第八个消费点（v1.3.88，EV-210）是 `review.ts` 的 `resolvePlanFinal`，也是**唯一不拒绝**的一处：
 * 代码阶段判不出计划阶段的执笔方时，只是不列计划定稿、出一条告警，本轮照常审查——
 * 本段接在它的告警前半句之后，改措辞时别只按「拒绝文案」来读。
 *
 * ## 成因只有三档（计划 r2 §1.4，逐格零配额实测）
 *
 * - **① 版本落后**：写入方比读取方新，留痕里有读取方不认的取值。run.v2 顶层允许未知字段，
 *   真正的落差在 `additionalProperties: false` 的子树里（实测例：`termination.by = sync_exception`，
 *   `e49279a` 之前的构建读不懂）。这一格的 `git status` 往往是干净的。
 * - **② 已提交、工作树里被改坏**：由用户在终端 `git restore`。只能在终端——恢复命令的参数正是
 *   `_meta/` 下的受保护路径，会话里会被 `hook-pre-bash` 拦下。
 * - **③ 其余**（从未提交，或已提交的版本本身就读不出）：工具内没有出口。本工具自己写不出
 *   读不出的 run.json——所有写入都经 `writeRunMeta` 写前校验、`writeAtomic` 原子落盘——所以这一格
 *   只可能来自工具之外的改动。真正的解法（人工确认出口）留在 EV-148。
 *
 * **运行中途被打断不在其列**：rename 之前被打断只留 `run-<id>.json.tmp-…`，`latestRunMeta` 的
 * 文件名正则不认它；rename 之后就是完整、可读的骨架。按「打断 = 读不出」去处置是找错了方向。
 *
 * **删除不是出口**：删掉之后 `latestRunMeta` 扫不到它、判定放行。`task.json.runs[]` 登记过它的，
 * 提交锚以「运行清单已丢失」拦下 git commit——只是把拒绝挪到提交时（计划 r2 §1.4 B 格实测）；
 * **没登记的**（`writeRunMeta` 写完骨架、`registerRun` 之前失败留下的那一种）删掉之后**没有任何锚会拦**，
 * 判定悄悄降级成「取更旧的可读份」或「按声明 / 缺省」——正是 `corrupt` 一档要挡的两种降级
 * （代码双审 r1 CODEX-01；这一格的缺口登记 EV-183）。所以两种都不要删。
 *
 * 固定段不带参数，测试按子串逐字断言；文件列表与本工具的构建标识由 `unreadableRunMetaExit` 拼在前面。
 */
export const UNREADABLE_RUN_META_EXIT_BODY =
  '  重跑该阶段双审不是出口：review --start 在冻结送审包之前就按同一判定拒绝，新运行落不下来。按成因处置：\n' +
  '  ① 本工具版本落后于写下它的版本（它含本工具不认的 schema 或取值；常见于装好的副本比写入方旧，' +
  '此时 git status 往往是干净的，判别见上面那行构建标识）：按 MANUAL §3.6「升级」更新并重装本工具后重试。\n' +
  "  ② 它已提交过，工作树里的这一份与提交的版本不同（git -c core.quotePath=false status --porcelain -- '<路径>' 显示 M）：" +
  "由用户在终端执行 git restore -- '<上面列出的路径>' 恢复后重试。" +
  '这一步只能由用户在终端做——会话里的恢复命令会被 Hook 拦下，换写法绕过属于违规。\n' +
  '  ③ 其余情形——从未提交（同一条命令显示 ??），或已提交的版本本身就读不出——且排除了①：' +
  '工具内没有出口。没有可恢复的副本，也没有跳过这条判定的入口（BACKLOG EV-148 的剩余项）；' +
  '本工具写入前会按契约校验，这一格只可能来自工具之外的改动。请停下，保留文件，交由用户人工判断。\n' +
  '  无论哪种成因，都不要删除或改写这些 run-*.json：删掉后这条判定会放行——' +
  '登记过的运行，提交时的留痕核对会以「运行清单已丢失」拦下 git commit；没登记的删掉则无从追查、判定悄悄降级；' +
  '改写同样会被拦。';

/**
 * 读不出的那几份运行留痕的**绝对路径**——`unreadableRunMetaExit` 的输入。
 *
 * 用绝对路径而不是相对项目根（计划 r2 §2.1，计划双审 CODEX-02）：七处都拿得到 `ArchiveLayout`
 * （其 `archiveRoot` 是绝对路径），而 `gate.ts` 那两处拿不到项目根；归档根又可配，读者拼不出来。
 * ② 档要用户原样复制给 `git restore`，路径必须现成。
 */
export function runMetaPaths(l: ArchiveLayout, stage: Stage, runIds: readonly string[]): string[] {
  return runIds.map((id) => path.join(metaDirOf(l, stage), runMetaFileName(id)));
}

/** 共用出口里至多列出几份文件；① 是整批读不出，清单不封顶会反复进 Hook 的 deny 理由（代码双审 r1 CODEX-03） */
export const UNREADABLE_RUN_META_LIST_LIMIT = 5;

/**
 * 共用出口：先列出涉及的文件（一次常报多份，成因可能各不相同——计划双审 CODEX-07；至多
 * `UNREADABLE_RUN_META_LIST_LIMIT` 份，其余报数），再给读取方自己的构建标识（判别 ① 用——
 * 代码双审 r1 CODEX-02：① 与「已提交的版本本身就读不出」的 `git status` 都是干净的，按工作树状态分不开，
 * 而写入方的构建记在 run.json 的 `snapshot.build`），最后接固定段 `UNREADABLE_RUN_META_EXIT_BODY`。
 *
 * `build` 缺省取本进程内嵌的构建标识；单测可传入固定值。各处请用 `unreadableRunMetaExitAt`。
 */
export function unreadableRunMetaExit(
  files: readonly string[],
  build: BuildStamp | null = embeddedBuildStamp(),
): string {
  const shown = files.slice(0, UNREADABLE_RUN_META_LIST_LIMIT);
  const rest = files.length - shown.length;
  return (
    '  涉及的运行留痕（逐份判断成因，每份可能不同）：\n' +
    shown.map((f) => `    · ${f}\n`).join('') +
    (rest > 0 ? `    · 另有 ${rest} 份同状态未列出（同在该阶段 _meta/ 下）\n` : '') +
    (build
      ? `  判别 ①：本工具的构建是 ${build.git_head.slice(0, 7)}（${build.built_at}）；` +
        '能以 JSON 打开的 run.json 看它的 snapshot.build.git_head——比本工具新即属 ①。\n'
      : '  判别 ①：本工具的构建标识缺失（构建时取不到 git），只能对照 run.json 的 snapshot.build 与安装来源自行判断。\n') +
    UNREADABLE_RUN_META_EXIT_BODY
  );
}

/**
 * 七处（连同 `gate --run-id` 钉住读不出那一格）的**单入口**：按布局与 run_id 拼出绝对路径再给共用出口
 * （代码双审 r1 GLM-02：两步配对重复多处，把 id 数组直接当路径传入类型系统不拦）。
 *
 * 空列表是程序缺陷：没有文件可判成因时不该给这一段（GLM-03）——调用方自己给普通说明。
 */
export function unreadableRunMetaExitAt(l: ArchiveLayout, stage: Stage, runIds: readonly string[]): string {
  if (runIds.length === 0) {
    throw new Error('unreadableRunMetaExitAt：没有读不出的 run_id——这一段只给有文件可判成因的拒绝');
  }
  return unreadableRunMetaExit(runMetaPaths(l, stage, runIds));
}

export async function readRunMeta(
  l: ArchiveLayout,
  stage: Stage,
  runId: string,
): Promise<RunMeta | null> {
  const r = await readRunMetaDetailed(l, stage, runId);
  return r.ok ? r.meta : null;
}

/**
 * 一份 run.json 读不出的成因（EV-04）。`readRunMeta` 把它们回落成同一个 `null`；
 * 要向用户说清是哪一种的出口改调 `readRunMetaDetailed`。
 *
 * - `missing`：文件不存在（`ENOENT`）；
 * - `io`：文件在但读不了（权限、是目录等），`detail` 是错误消息的首行（以错误码开头）；
 * - `unparsable`：读得到但不是合法 JSON，`detail` 是解析器消息的首行；
 * - `contract`：是 JSON，但 `schema` 不识或不合 run.v1/v2/v3 契约，`detail` 是首条校验错误。
 */
export type RunMetaUnreadableCause =
  | { kind: 'missing' }
  | { kind: 'io' | 'unparsable' | 'contract'; detail: string };

/**
 * 成功分支的 `sourceSchema`（M11 第 7 步）：落盘原件的 schema。v1 读进内存后已迁移成 v2 形状
 * （`driver` 补为缺省 Driver），复盘要据它标出「这一轮的 Driver 来自 v1 迁移」，否则分不出。只增不改判定。
 */
export type RunMetaReadResult =
  | { ok: true; meta: RunMeta; sourceSchema: 'trivium.run.v1' | 'trivium.run.v2' | 'trivium.run.v3' }
  | { ok: false; cause: RunMetaUnreadableCause };

/** 成因细节只取首行、封顶这么多字：解析器消息会带上一段原文，整段回显没有用 */
const CAUSE_DETAIL_MAX = 160;

function causeDetail(s: string): string {
  const line = s.split('\n')[0] ?? '';
  return line.length > CAUSE_DETAIL_MAX ? `${line.slice(0, CAUSE_DETAIL_MAX)}…` : line;
}

/**
 * `readRunMeta` 的带成因版本（EV-04，候选 B）：同一条读取路径，失败时说清是哪一档。
 * 成功时的结果与 `readRunMeta` 完全相同（v1 同样迁移成内存形状）。
 */
export async function readRunMetaDetailed(
  l: ArchiveLayout,
  stage: Stage,
  runId: string,
): Promise<RunMetaReadResult> {
  const { metaDir } = await import('./archive.js');
  const p = path.join(metaDir(l, stage), runMetaFileName(runId));
  let text: string;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { ok: false, cause: { kind: 'missing' } };
    // Node 的 fs 错误消息本身以错误码开头（如「EISDIR: illegal operation…」），不再另拼
    return { ok: false, cause: { kind: 'io', detail: causeDetail(String((e as Error)?.message ?? e)) } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, cause: { kind: 'unparsable', detail: causeDetail(String((e as Error)?.message ?? e)) } };
  }
  const schema = (raw as { schema?: unknown } | null)?.schema;
  const contract = (problems: string[]): RunMetaReadResult =>
    ({ ok: false, cause: { kind: 'contract', detail: causeDetail(problems[0] ?? '校验不过') } });
  if (schema === 'trivium.run.v2' || schema === 'trivium.run.v3') {
    const problems = validateRunMeta(raw);
    return problems.length === 0 ? { ok: true, meta: raw as RunMeta, sourceSchema: schema } : contract(problems);
  }
  if (schema === 'trivium.run.v1') {
    const problems = validateRunMetaV1(raw);
    return problems.length === 0 ? { ok: true, meta: migrateRunMetaV1(raw), sourceSchema: schema } : contract(problems);
  }
  return contract([`schema 字段是 ${causeDetail(JSON.stringify(schema) ?? 'undefined')}，不是 trivium.run.v1 / v2 / v3`]);
}

/**
 * 成因写成一句（不带句号），供出口在原有文字之后加一行「本次判定：…」（EV-04 候选 B）。
 * 只陈述这一次读到的情形，不替代共用出口段的三档处置。
 */
export function describeRunMetaCause(c: RunMetaUnreadableCause): string {
  switch (c.kind) {
    case 'missing':
      return '文件不存在';
    case 'io':
      return `文件在但读不了（${c.detail}）`;
    case 'unparsable':
      return `文件在但不是合法 JSON（${c.detail}）`;
    case 'contract':
      return `文件是 JSON，但不合 run.v1/v2/v3 契约（${c.detail}）`;
  }
}

// ─────────────────────── 事后收尾：--cancel（EV-128）、worker 异常与 worker_lost（EV-142） ───────────────────────

/** 事后收尾每一步的结果；`error` 为真表示是异常转成的跳过 */
export type FinalizeStep =
  | { kind: 'written' }
  | { kind: 'skipped'; why: string; error?: boolean };

/** 事后收尾能写的两种终态。`success` 只由 worker 正常收尾写 */
type UnfinishedTerminal = 'cancelled' | 'failed';

const skipped = (why: string): FinalizeStep => ({ kind: 'skipped', why });
const skippedFromError = (what: string, e: unknown): FinalizeStep => ({
  kind: 'skipped',
  why: `${what}出错：${String((e as Error)?.message ?? e).split('\n')[0]}`,
  error: true,
});

interface FinalizeInput {
  layout: ArchiveLayout;
  stage: Stage;
  runId: string;
  lock: TaskLock;
  /**
   * 「没有另一个写者」：别的进程调用时传「工作进程已确认退出」的结论（`cancelRun` 传 `workerConfirmedGone(...).gone`，
   * `waitRun` 传改写 status.json 之前的判定）；worker 自己在异常分支调用时恒传 true——它就是那个写者；
   * 准备阶段（`prepareRun` 写完骨架之后、`startRun` 在子进程诞生之前）与同步路径在本进程里调用时也恒传 true——
   * 还没有、也不会有 worker；`--cancel` / `--wait` 常常拿不到身份，拿到了也没有 pid、判「未确认退出」而跳过，
   * 本进程写完之后 run.json 又已是终态、按前提 4 不追溯改写（EV-145，事后收尾余项计划 r2 §3.5，代码双审 r1 CODEX-05）；
   * `--start` 在子进程诞生之后失败时也传 true——依据是父进程按子进程句柄**观察到**的退出，不是推断
   * （EV-150，派生后失败的孤儿worker计划 r2 §3.5；确认不了退出时根本不调本函数）；
   * `--cancel` 结束失联后仍挂着的工作进程（EV-146）也传 true——依据是它按 pid + 启动时刻**观察到**的退出
   * （失联后取消挂住的worker计划 r2 §4.4 第 4 步；确认不了退出时同样不调本函数）。
   * 显式入参，接线才有用例守得住。
   */
  workerGone: boolean;
}

/**
 * 把被 `review --cancel` 的运行在归档侧收尾（EV-128，计划 r2 §3.2）。签名与行为自 EV-128 起不变。
 *
 * 取消轮从来走不到 worker 的收尾：worker 被杀在收尾之前，run.json 停在骨架的 `running`。
 * 这里补上它**唯一一次**终态写入，写完同样不再更新——与 EV-133「收尾后不再更新」不冲突。
 * 不写 `termination`：`status: cancelled` 已说明来路。
 */
export function finalizeCancelledRunMeta(i: FinalizeInput): Promise<{ runMeta: FinalizeStep; task: FinalizeStep }> {
  return finalizeUnfinishedRunMeta({ ...i, terminal: 'cancelled' });
}

/**
 * 把没走到 worker 收尾就失败的运行在归档侧收尾为 `failed`（EV-142，计划 r2 §3.2 / §3.3；EV-145）。
 * 八个调用方：worker 的异常分支（`termination.by = worker_exception`）、`--wait` 判 `worker_lost`
 * 且确认工作进程已退出（`worker_lost`）、`prepareRun` 写完骨架之后失败与 `startRun` 在子进程诞生之前失败
 * （都是 `prepare_exception`）、同步路径 `executeRun` 抛错（`sync_exception`）、`startRun` 在子进程诞生之后失败
 * 并终止工作进程、确认退出之后（`post_spawn_exception`，EV-150）、`--cancel` 在 `--wait` 判 heartbeat_stale 之后
 * 结束仍挂着的工作进程并确认退出之后（沿用 `worker_lost` / `heartbeat_stale`，EV-146）、`--cancel` 在
 * `--wait` 判 heartbeat_stale 之后发现工作进程已不在（同样沿用 `worker_lost` / `heartbeat_stale`，EV-159，
 * 经 `run-protocol.ts` 的 `finalizeLostAndReclaimLock`）。
 */
export function finalizeFailedRunMeta(
  i: FinalizeInput & { termination: RunTermination },
): Promise<{ runMeta: FinalizeStep; task: FinalizeStep }> {
  return finalizeUnfinishedRunMeta({ ...i, terminal: 'failed' });
}

/**
 * 事后收尾一步 → 一句话。异常转成的跳过要把后果说出来，而后果因调用方的处境而异（有没有 status.json、
 * 随后会发生什么），所以那半句由调用方传入（事后收尾余项计划 r2 §3.6）。同族措辞的唯一来源，三个使用者：
 * `run-protocol.ts` 的 `reportFinalizeStep`（`--cancel`，再按 step / warn 分流）与 `describeFinalizeStep`
 * （worker 异常分支、`--wait` 判失联），以及下面的 `finalizeLines`（准备阶段与同步路径）（代码双审 r1 CODEX-06）。
 */
export function describeFinalizeStepWith(r: FinalizeStep, done: string, notDone: string, noSecondChance: string): string {
  if (r.kind === 'written') return done;
  if (r.error) return `${notDone}：${r.why}——${noSecondChance}`;
  return `${notDone}：${r.why}`;
}

/**
 * 准备阶段与同步路径的收尾播报：两步各一句（EV-145，事后收尾余项计划 r2 §3.6，计划双审 r1 AGY-01）。
 * `scene` 由调用方给（「准备阶段失败」或「同步路径异常」）——`FinalizeStep` 本身不带场景信息。
 * 这两处没有 status.json、也没有补齐入口，调用方随即以原错误退出，异常转成的跳过没有第二次机会。
 */
export function finalizeLines(fin: { runMeta: FinalizeStep; task: FinalizeStep }, runId: string, scene: string): string[] {
  const noSecondChance = '这一步不会再有第二次机会：本进程随即以原错误退出，请人工核对归档 run.json 与 task.json 的运行登记';
  return [
    describeFinalizeStepWith(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 failed（${scene}）`, `归档 run-${runId}.json 未回写`, noSecondChance),
    describeFinalizeStepWith(fin.task, `已把 task.json 的运行登记同步为 failed（${scene}）`, 'task.json 的运行登记未改', noSecondChance),
  ];
}

/**
 * 事后收尾的通用体：按「目标终态」参数化（计划 r2 §3.1，D4 取 (a)）。
 *
 * **两步各自独立判定，对进程中断可重入**：调用方都把本函数排在把 status.json 落终态之前，
 * 进程死在任意两次写之间时 status.json 仍非终态，再跑一次 `--cancel` / `--wait` 会把没做完的那一步补上
 * （EV-128 上一版排在 `patchStatus` 之后，中断即永久停在 running——计划双审 r1 CODEX-01 ≡ GLM-01）。
 * **对单步写失败不可重入**（代码双审 r1 CODEX-01）：异常转成 skipped 后调用方照常落终态，
 * 这一步没有第二次机会——调用方的告警会当场说出来，要人工对账。
 *
 * **自身不抛**：两步各包一层捕获，任何异常都转成该步的 skipped。只设这一道——
 * 调用方不再另包，免得两层互为冗余（r1 CODEX-02 ≡ AGY-01 ≡ GLM-02）。
 * 归档侧失败不得连坐锁与闸门回收：闸门卡在 running 会把 Driver 永久锁在一个已经不存在的运行上。
 *
 * **调用次序按「有没有下一次补齐的入口」分两种**（事后收尾余项计划 r2 §3.2，计划双审 r1 CODEX-01）：
 * - `--cancel` / `--wait` / worker 异常分支：本函数排在 status.json 落终态**之前**，锁与闸门回收排在它**之后**——
 *   进程中断时 status.json 仍非终态，下一次调用能把没做完的一步补上；
 * - 准备阶段与同步路径：没有 status.json，`--cancel` / `--wait` 也够不着，收尾只有这一次机会，
 *   所以**先回收闸门、再调本函数**（进程死在两步之间时，闸门停在 running 会拦住全部业务写入到 TTL，
 *   run.json 停在 running 只是留痕不准），主题锁仍在本函数之后放。
 *   `--start` 在子进程诞生之后失败（EV-150）也按这一组排：它有 status.json，但 pid 可能没落盘，
 *   下一次 `--wait` / `--cancel` 未必补得齐；另多一条——先终止工作进程并确认退出，再回收闸门。
 */
async function finalizeUnfinishedRunMeta(
  i: FinalizeInput & { terminal: UnfinishedTerminal; termination?: RunTermination },
): Promise<{ runMeta: FinalizeStep; task: FinalizeStep }> {
  const runMeta = await unfinishedRunMetaStep(i).catch((e: unknown) => skippedFromError('回写 run.json ', e));
  const task = await unfinishedTaskEntryStep(i).catch((e: unknown) => skippedFromError('同步 task.json ', e));
  return { runMeta, task };
}

/**
 * 第一步：run.json。四个前提任一不满足即跳过、不改文件：
 *   1. 没有另一个写者（`workerGone`）——没确认到就可能还有写者（进程组里的后代、正要收尾的 worker），两个写者会互相覆盖；
 *   2. 主题与阶段已知（由调用方给出）；
 *   3. 原始 JSON 是 run.v2——`readRunMeta` 读进来的 v1 是**迁移后的内存形状**，写回会把历史文件改成 v2；
 *   4. 合契约且仍为 `running`——已是终态（含 worker 先写完 run.json、status.json 还没改的窗口，
 *      以及 worker 在 `executeRun` 收尾写完 run.json 终态之后才抛的异常）一律不动。
 *
 * **读 → 判 → 写整段在主题任务锁里**（EV-142，计划 r2 §3.4）：事后写者有三个（`--cancel`、worker 异常分支、
 * `--wait` 判失联），`--cancel` 与 `--wait` 可能在 worker 死后同时读到 running；不进锁就会两边都写、后写者改掉
 * 前者的 `status` / `finished_at`。锁与 task.json 同一把（`taskLockName`，与 worker 长持的运行锁不同名、不会自锁），
 * 两步各取一次、不嵌套。争用重试用尽即抛、转成带异常的跳过。
 *
 * 更新终态、结束时间与 gate.state，并以 partial 和原因表达未全部完成；给了 termination 再加这一键。artifacts[] 原样——
 * 提交锚对 HEAD 为 running 的 run.json 只查 `run_id` 与已登记条目（`hooks.ts` `runningRewriteViolation`），
 * 所以「运行中途提交过、之后被取消 / 失败」也能正常提交。`gate.warnings` 不追加：它会被回灌成 `run_warning`（EV-133）。
 */
async function unfinishedRunMetaStep(i: {
  layout: ArchiveLayout; stage: Stage; runId: string; lock: TaskLock; workerGone: boolean;
  terminal: UnfinishedTerminal; termination?: RunTermination;
}): Promise<FinalizeStep> {
  if (!i.workerGone) {
    return skipped('工作进程未确认退出，不写归档 run.json（可能还有写者，两边会互相覆盖）');
  }
  const { metaDir } = await import('./archive.js');
  const p = path.join(metaDir(i.layout, i.stage), runMetaFileName(i.runId));
  return withTopicLock(
    { triviumDir: i.lock.triviumDir, topic: taskLockName(i.layout.topic), heartbeatStaleMs: i.lock.heartbeatStaleMs },
    async (): Promise<FinalizeStep> => {
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
      if (schema !== 'trivium.run.v2' && schema !== 'trivium.run.v3') {
        return skipped(`schema 为 ${JSON.stringify(schema)}，只收尾 run.v2 / run.v3（保留原契约形状）`);
      }
      if (validateRunMeta(raw).length > 0) return skipped('不合所声明的 run.v2 / run.v3 契约，不动它');
      const meta = raw as RunMeta;
      if (meta.status !== 'running') return skipped(`已是终态（${meta.status}），不追溯改写`);

      meta.status = i.terminal;
      meta.review_mode = 'partial';
      meta.degraded_reason = i.terminal === 'cancelled' ? '运行被取消，入选审核者未全部完成' : '运行异常收尾，入选审核者未全部完成';
      meta.finished_at = new Date().toISOString();
      meta.gate.state = i.terminal;
      if (i.termination) meta.termination = i.termination;
      await writeRunMeta(i.layout, i.stage, meta);
      return { kind: 'written' };
    },
  );
}

/**
 * 第二步：task.json 的运行登记。**不依赖第一步这一次写没写**——run.json 已是**本次目标终态**
 * （这一次或上一次写的）、登记仍为 `running` 就补上，于是两次写之间被打断也能由下一次调用补齐。
 *
 * 只认目标终态、不照抄别的终态（计划 r2 §3.1）：放宽成「run.json 是任一终态就照抄」会让
 * 「run.json 已 success ⇒ 登记不改」（R2）换语义。run.json 已终态、登记停在 running 的另两种形态
 * （worker 写完 success 后 `registerRun` 抛错；`--cancel` 撞进 worker 异常分支的两次写之间）如实保留，见计划 §6.2。
 *
 * 按 run_id 精确匹配；找不到就跳过——`prepareRun` 先写 run.json、后登记，中间被打断会留下这种形态，
 * 这里不新建条目、不取末条（r1 CODEX-04 ≡ AGY-03）。只改这一条的 `status`，不走 `registerRun` 的整条覆盖。
 */
async function unfinishedTaskEntryStep(i: {
  layout: ArchiveLayout; stage: Stage; runId: string; lock: TaskLock; terminal: UnfinishedTerminal;
}): Promise<FinalizeStep> {
  const m = await readRunMeta(i.layout, i.stage, i.runId);
  if (m?.status !== i.terminal) {
    return skipped(`归档 run.json 不是 ${i.terminal}（${m ? m.status : '读不到'}），不改登记`);
  }
  let outcome: FinalizeStep = skipped('task.json 无此运行的登记（不新建条目）');
  await updateTaskAsync(i.layout, async (t) => {
    const entry = t.runs.find((r) => r.run_id === i.runId);
    if (!entry) return false;
    if (entry.status !== 'running') {
      outcome = skipped(`登记已是 ${entry.status}，不改`);
      return false;
    }
    entry.status = i.terminal;
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
  const unknownReason = meta.snapshot.drift.unknown_reason;
  if (unknownReason) {
    // 比不了（EV-139）：「0 个文件」会读成「没改什么」，换成说明原因的一行
    lines.push(`  ⚠️ 漂移无法判定：${describeDriftUnknown(unknownReason)}（策略 ${meta.snapshot.drift.policy}）`);
  } else if (meta.snapshot.drift.changed) {
    lines.push(`  ⚠️ 漂移：${meta.snapshot.drift.files.length} 个文件（策略 ${meta.snapshot.drift.policy}）`);
  }
  // 按跑后复算分档说，与 report 旗标同一来源（EV-224）
  if (meta.guard.readonly_breach) lines.push(`  ⚠️ ${readonlyBreachLabel(meta.snapshot.drift)}`);
  if (meta.guard.peer_artifact_read) lines.push('  ⚠️ 读到对方产出');
  // 作废重跑（EV-225），与 report 旗标同一判据：有 attempts 即重跑过
  const reran = Object.entries(meta.critics).filter(([, m]) => m?.attempts !== undefined).map(([c]) => c);
  if (reran.length > 0) lines.push(`  ⚠️ 作废重跑：${reran.join('、')}（首次尝试读到对端产物，明细见 critics.<侧>.attempts）`);
  return lines.join('\n');
}
