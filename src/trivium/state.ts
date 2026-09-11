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
import { withGlobalLock } from './lock.js';
import { writeAtomic } from './util/fsx.js';

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
   * 触发该闸门的 Claude Code 会话 id。
   *
   * `approval_lock_scope: session` 下，写锁只对**本会话**生效：
   * 其它会话的闸门只提醒不加锁，因为 PRD 4.4 约束的是流水线不得自动继续，
   * 不是开发者在同一仓库里的其它编辑（审核意见 RV-05）。
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
  try {
    return JSON.parse(await fs.readFile(statePath(triviumDir), 'utf8')) as StateFile;
  } catch {
    return empty();
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

  if (opts.scope === 'session') {
    if (gate.session_id === null) {
      return { lock: false, reason: '闸门未记录触发会话，无法判定作用域，不加锁' };
    }
    if (gate.session_id !== opts.currentSessionId) {
      return { lock: false, reason: '闸门由其它会话触发，仅提醒不加锁' };
    }
  }

  return {
    lock: true,
    reason:
      gate.state === 'running'
        ? `主题「${gate.topic}」的 ${gate.stage} 阶段双审进行中，此时不得修改业务文件`
        : `主题「${gate.topic}」的 ${gate.stage} 阶段闸门未审批`,
  };
}
