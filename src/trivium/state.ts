/**
 * `state.json`：流水线闸门状态（设计 §8.4 第 1 层）。
 *
 * 闸门「真正停住」靠三层：状态层（本文件）、提示层（skill 话术）、
 * 强制层（Claude Code Hook）。本文件是前者。
 *
 * 写入纪律（审查意见 GLM-08）：**所有**读改写都经主题锁的短临界区。
 * 原子替换只防撕裂不防丢更新，而 `gate` / `approve` / `abandon` / `hook-stop`
 * 都在 review 工作进程释放长持锁之后才写这个文件。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Stage } from './types.js';
import type { AgentId } from './agents/registry.js';
import { withGlobalLock } from './lock.js';
import { writeAtomic } from './util/fsx.js';
import { EXIT, TriviumError } from './exit-codes.js';

/**
 * `state.json` **存在但读不出来**。
 *
 * 它是四个 Hook 的唯一判定依据。原先解析失败静默回落成空状态——`echo x > state.json`
 * 就能让全部 awaiting_approval / review_done / running 闸门瞬间消失，写锁、收工拦截、
 * 提交拦截同时解除。与 `readTaskStrict` 区分「不存在」与「存在但坏了」是同一条纪律：
 * 不存在是正常（还没跑过），坏了必须按违例处理。退出码 2：Hook 收到就是拦截。
 */
export class StateCorruptError extends TriviumError {
  constructor(p: string, cause: string) {
    super(
      EXIT.GATE_BLOCK,
      `闸门状态文件不可读：${p}（${cause}）。它是所有 Hook 的唯一依据，坏了不能当成没有闸门。\n` +
        '  若确认其中没有进行中的运行，删除该文件即可重建；否则请先修复 JSON。',
    );
  }
}

export type GateState =
  | 'idle'
  /** 双审已完成、裁决件未齐——`hook-stop` 应阻止收工 */
  | 'review_done_awaiting_disposition'
  /** 裁决已校验通过、等人工审批——`hook-pre-write` 应锁业务写入 */
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'abandoned'
  | 'running';

export interface GateEntry {
  topic: string;
  stage: Stage;
  state: GateState;
  run_id: string | null;
  rerun_index: number;
  since: string;
  /**
   * 当轮 Driver（M9 第 5 步）。**可选**：早于该步立起的闸门项没有这个字段，
   * 缺失即「无从得知」，不等于缺省 Driver。
   *
   * 设计 §5.2 / §9.2 把它列为 `--driver` 三处留痕面之一（另两处是
   * `run.json.driver` 与 `task.json.runs[]`）。
   *
   * ## 它**不是** Hook 的 Driver 来源（EV-68，M9 第 6 步前置）
   *
   * 曾经打算让 `hooks.ts` 读这里，计划双审两侧独立打穿：`review.ts` 的四处
   * `setGateChecked` 全都不传 driver，唯一写它的是 `cli.ts` 两处
   * `awaiting_approval`，而那以「裁决件已落盘」为前置——**Driver 写裁决件
   * 正发生在那之前**。更糟的是下面 `upsert` 的「沿用前一条的值」：
   * 同槽位重跑换 Driver 时，这里留着的是**上一轮**的 driver，
   * 采信它会让当轮判定反向。所以 Hook 的权威来源是 `run.json.driver`
   * （`latestRunMeta`），与设计 §6.2 和 `cmdGate` 同源；本字段维持纯留痕面。
   *
   * ## 「缺失」的语义没有变
   *
   * 上面那句「缺失即『无从得知』，不等于缺省 Driver」**仍然为真**。
   * Hook 侧在无从得知时按缺省 Driver 判定并在拦截文案里注明，
   * 那是论证过的可用性取舍（plan/bug 原稿写在 `review --start` 之前，
   * 那一刻该阶段一份留痕都没有，fail-closed 会锁死整条流水线），
   * **不是**把「缺失」重定义成「缺省」。两层语义分工见 `hooks.ts`
   * 的 `resolveRoundDriver`（计划双审 GLM-03）。
   */
  driver?: AgentId;
  /**
   * 触发该闸门的 Claude Code 会话 id。
   *
   * `approval_lock_scope: session` 下，写锁只对**本会话**生效：
   * 其它会话的闸门只提醒不加锁，因为 PRD 4.4 约束的是流水线不得自动继续，
   * 不是开发者在同一仓库里的其它编辑（审核意见 RV-05）。
   *
   * **为 null 时按「本会话」处理**（保守方向）。会话 id 只能靠 `--session-id` 或
   * `CLAUDE_SESSION_ID` 环境变量传入，而 Claude Code 并不向 Bash 工具注入后者——
   * 于是 skill 正常走一遍，闸门几乎总是 null。原先把 null 判为「无法判定作用域，不加锁」，
   * 结果是写锁与收工拦截在默认路径上从未生效过（本仓库自己的 state.json 三个真实闸门
   * 全是 null）。拿不准是不是别人的会话时，宁可多拦一会儿（还有 TTL 兜底）。
   */
  session_id: string | null;
}

export interface StateFile {
  schema: 'trivium.state.v1';
  updated_at: string;
  /** 按 `<topic>/<stage>` 索引 */
  gates: Record<string, GateEntry>;
}

const statePath = (triviumDir: string): string => path.join(triviumDir, 'state.json');
export const gateKey = (topic: string, stage: Stage): string => `${topic}/${stage}`;

function empty(): StateFile {
  return { schema: 'trivium.state.v1', updated_at: new Date().toISOString(), gates: {} };
}

export async function readState(triviumDir: string): Promise<StateFile> {
  const p = statePath(triviumDir);
  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return empty(); // 还没跑过：正常
    throw new StateCorruptError(p, (e as Error).message);
  }
  try {
    const s = JSON.parse(raw) as StateFile;
    if (!s || typeof s !== 'object' || typeof s.gates !== 'object' || s.gates === null) {
      throw new Error('缺少 gates 对象');
    }
    return s;
  } catch (e) {
    throw new StateCorruptError(p, (e as Error).message);
  }
}

/**
 * 读改写。**必须**在短临界区内进行，而且必须是**全局**锁而非主题锁：
 * `state.json` 是全局单文件，两个不同主题并发写会各拿自己的主题锁、
 * 同时读改写同一个文件而丢更新（GLM-08）。
 *
 * `topic` 参数保留下来只为可读性与将来的审计，不参与加锁。
 */
export async function updateState(
  triviumDir: string,
  topic: string,
  heartbeatStaleMs: number,
  mutate: (s: StateFile) => void,
): Promise<StateFile> {
  void topic;
  return withGlobalLock({ triviumDir, heartbeatStaleMs }, async () => {
    const s = await readState(triviumDir);
    mutate(s);
    s.updated_at = new Date().toISOString();
    await writeAtomic(statePath(triviumDir), JSON.stringify(s, null, 2) + '\n');
    return s;
  });
}

export interface SetGateInput {
  triviumDir: string;
  topic: string;
  stage: Stage;
  state: GateState;
  runId?: string | null;
  rerunIndex?: number;
  sessionId?: string | null;
  /** 当轮 Driver（M9 第 5 步）。只记不读，见 GateEntry.driver */
  driver?: AgentId;
  heartbeatStaleMs: number;
  /**
   * 条件迁移：只有当前闸门满足 `expect` 时才写入（审查意见 GLM-r2-01）。
   *
   * `state.json` 每个 `<主题>/<阶段>` 只有**一个槽位**，而无条件覆盖会让三种
   * 正常操作序列把**正在跑的那一轮**的护栏悄悄清掉：
   *   ① 对旧一轮 `gate --check` 放行 → 把新一轮的 `running` 覆写成 `idle`；
   *   ② `--cancel` 一个早已失联的旧 run → 连带清掉新一轮的护栏
   *      （「先取消旧的再起新的」是正常序列）；
   *   ③ 旧一轮尚未裁决就直接重跑 → 待裁决状态被无声抹掉，旧轮从此逃过裁决。
   *
   * 对照：`cancelRun` 回收**锁**时一直有 `existing.run_id === runId` 守卫，
   * 回收闸门却没有——同一个函数里两套标准。
   */
  expect?: {
    /** 当前状态必须是其中之一；省略表示不限 */
    state?: readonly GateState[];
    /** 当前 run_id 必须等于它；`null` 表示「必须没有 run_id」 */
    runId?: string | null;
    /** 闸门不存在时是否放行。默认 true——首次置 running 时槽位本来就是空的 */
    allowMissing?: boolean;
  };
}

export interface SetGateResult {
  /** 是否真的写入了 */
  applied: boolean;
  /** 写入后的条目；未写入时是原样的当前条目（可能为 null） */
  entry: GateEntry | null;
  /** 未写入的原因，供调用方决定是告警还是静默 */
  skipped?: string;
}

/**
 * 写闸门。带 `expect` 时是**比较-交换**，比较与写入都在同一把全局锁内完成，
 * 因此不存在 check-then-act 的竞态窗口。
 */
export async function setGateChecked(i: SetGateInput): Promise<SetGateResult> {
  const key = gateKey(i.topic, i.stage);
  let result: SetGateResult = { applied: false, entry: null };

  await updateState(i.triviumDir, i.topic, i.heartbeatStaleMs, (s) => {
    const prev = s.gates[key] ?? null;

    if (i.expect) {
      if (!prev) {
        if (i.expect.allowMissing === false) {
          result = { applied: false, entry: null, skipped: '闸门不存在' };
          return;
        }
      } else {
        if (i.expect.state && !i.expect.state.includes(prev.state)) {
          result = {
            applied: false, entry: prev,
            skipped: `当前状态为 ${prev.state}，不在期望的 ${i.expect.state.join('/')} 之内`,
          };
          return;
        }
        if (i.expect.runId !== undefined && prev.run_id !== i.expect.runId) {
          result = {
            applied: false, entry: prev,
            skipped: `闸门当前记着 run ${prev.run_id ?? '（无）'}，不是 ${i.expect.runId ?? '（无）'}`,
          };
          return;
        }
      }
    }

    const entry: GateEntry = {
      topic: i.topic,
      stage: i.stage,
      state: i.state,
      run_id: i.runId ?? prev?.run_id ?? null,
      rerun_index: i.rerunIndex ?? prev?.rerun_index ?? 1,
      since: new Date().toISOString(),
      // 会话 id 一旦记下就不因后续状态变化而丢——写锁的作用域判定要用它
      session_id: i.sessionId ?? prev?.session_id ?? null,
      // driver 同理：记下就不丢，后续状态迁移沿用前一条的值
      ...((i.driver ?? prev?.driver) ? { driver: (i.driver ?? prev?.driver)! } : {}),
    };
    s.gates[key] = entry;
    result = { applied: true, entry };
  });

  return result;
}

/** 无条件写入。只用于「这一步就是要覆盖」的场合，其余一律走 `setGateChecked` */
export async function setGate(i: SetGateInput): Promise<GateEntry> {
  const r = await setGateChecked(i);
  return r.entry!;
}

/**
 * 回收某次运行留下的 `running` 闸门：置回 `idle`（审查意见 GLM-r2-02 ≡ AGY-01 起的既有语义）。
 *
 * 只回收**仍记着本 `runId` 且仍是 `running`** 的闸门：新一轮若已接管，那是它的护栏。
 * 槽位不存在时**不**凭空造一条 idle 记录（审查意见 AGY-02）——`allowMissing` 缺省为 true
 * 对「首次置 running」合适，对回收则不然。
 *
 * 自身不抛：回收失败不该盖过调用方手里真正的错误——闸门还有 TTL 兜底，而错误信息只有一次机会。
 *
 * 放在这里而不是 `run-protocol.ts`：`prepareRun`（`review.ts`）置闸门之后失败也要回收
 * （EV-109 / EV-145 ①，闸门拦截不留骨架计划 r2 §3.2），而 `review.ts` 不依赖 `run-protocol.ts`。
 * `run-protocol.ts` 的 `releaseRunningGate` 委托本函数，三处调用点语义不变。
 *
 * `review.ts` 的 `runReviewLocked` 里另有一份同形的内联回收（同步路径 `executeRun` 抛错时），
 * **改一处须改两处**（代码双审 r1 CODEX-05）。
 */
export async function releaseRunningGateEntry(i: {
  triviumDir: string;
  topic: string;
  stage: Stage;
  runId: string;
  heartbeatStaleMs: number;
}): Promise<void> {
  try {
    await setGateChecked({
      triviumDir: i.triviumDir,
      topic: i.topic, stage: i.stage, state: 'idle', runId: i.runId,
      heartbeatStaleMs: i.heartbeatStaleMs,
      expect: { state: ['running'], runId: i.runId, allowMissing: false },
    });
  } catch {
    // 见文档块：不盖过真正的错误
  }
}

export async function getGate(
  triviumDir: string,
  topic: string,
  stage: Stage,
): Promise<GateEntry | null> {
  const s = await readState(triviumDir);
  return s.gates[gateKey(topic, stage)] ?? null;
}

/**
 * 全部**未关闭**的闸门。
 *
 * 必须包含 `running`：设计 §8.5 要求双审进行中也拦业务写入（就地模式下审查员正在读
 * 真实工作树，此时 Driver 改代码会造成漂移）。第一版漏了这个状态，
 * 导致 hook-pre-write 根本看不到进行中的运行——被用例抓到。
 */
const OPEN_STATES: readonly GateState[] = [
  'awaiting_approval',
  'review_done_awaiting_disposition',
  'running',
];

export async function listOpenGates(triviumDir: string): Promise<GateEntry[]> {
  const s = await readState(triviumDir);
  return Object.values(s.gates).filter((g) => OPEN_STATES.includes(g.state));
}

/**
 * 闸门是否应对**当前会话**的业务写入加锁（设计 §8.4 第 3 层）。
 *
 * 三个条件同时成立才加锁：
 *   1. 状态为 `awaiting_approval`（或运行中）；
 *   2. 作用域匹配——`session` 下要求触发会话与当前会话相同；
 *   3. 未超过 TTL。
 *
 * 任一不成立都只提醒不加锁：把无关会话或过期闸门也锁上，会锁死开发者在同一仓库
 * 里的其它编辑（审核意见 RV-05）。
 *
 * **`reason` 只陈述状态，后果由调用方拼**（EV-129）：Write 拦截接「此时不得修改业务文件」，
 * Bash 拦截接「此时不得用 Bash 改动工作树」。此前审查中那一支自带后果句，两处拦截各自再拼一次，
 * 用户看到的是「……双审进行中，此时不得修改业务文件，此时不得修改业务文件。」
 */
export function shouldLockWrites(
  gate: GateEntry | null,
  opts: {
    currentSessionId: string | null;
    scope: 'session' | 'global';
    ttlHours: number;
    now?: number;
  },
): { lock: boolean; reason: string } {
  if (!gate) return { lock: false, reason: '无闸门' };
  if (gate.state !== 'awaiting_approval' && gate.state !== 'running') {
    return { lock: false, reason: `闸门状态为 ${gate.state}，不加锁` };
  }

  const ageH = ((opts.now ?? Date.now()) - new Date(gate.since).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH)) return { lock: false, reason: '闸门时间戳不可解析，不加锁' };
  if (ageH > opts.ttlHours) {
    return { lock: false, reason: `闸门已超过 ${opts.ttlHours}h TTL（${ageH.toFixed(1)}h），不加锁` };
  }

  /*
   * 作用域判定：只有**明确记录了别的会话**才不加锁。
   * `session_id` 为 null 意味着无从证明它是别人的——按本会话处理（见 GateEntry.session_id）。
   * 反过来写成「null 就不加锁」，护栏会在最常见的路径上静默失效。
   */
  if (opts.scope === 'session' && gate.session_id !== null && gate.session_id !== opts.currentSessionId) {
    return { lock: false, reason: '闸门由其它会话触发，仅提醒不加锁' };
  }

  return {
    lock: true,
    reason:
      gate.state === 'running'
        ? `主题「${gate.topic}」的 ${gate.stage} 阶段双审进行中`
        : `主题「${gate.topic}」的 ${gate.stage} 阶段闸门未审批`,
  };
}
