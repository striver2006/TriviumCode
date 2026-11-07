/**
 * state.json 纯函数模型（FR-4 / D4′；Phase 3 扩展：unreadable 通道 + rerunIndex/driver）。
 *
 * 与 watcher（stateWatch.ts）分离：本模块不依赖 vscode，单测直接覆盖。
 *
 * Phase 3（计划 r2 §D4 状态面）：解析失败与「文件不存在」严格分流——
 * 文件存在但 JSON 坏 / gates 非对象 → `unreadable: true`（CLAUDE-02：损坏不能
 * 当「无闸门」静默绿灯，灯与保存防护按锁闭保守处理）。「文件不存在」由 watcher
 * 层判定（ENOENT 属正常：还没跑过），仍产出空快照。
 */
import { checkSchema } from '../env/versionCheck';

export const ACTIVE_GATE_STATES = new Set([
  'running',
  'review_done_awaiting_disposition',
  'awaiting_approval',
]);

export interface GateRef {
  key: string; // "<topic>/<stage>"
  topic: string;
  stage: string;
  state: string;
  runId: string;
  since: string | null;
  /** 闸门项记录的轮次（Phase 3：裁决文件名 -rN 用；缺省 null） */
  rerunIndex: number | null;
  /**
   * 闸门项 driver（Phase 3 起解析，但**不作为当轮身份源**——state.ts 只在
   * awaiting_approval 迁移时写入，raf 阶段沿用旧值；仅作展示比对，见 runMeta.resolveDriverId）
   */
  driver: string | null;
}

export interface StateSnapshot {
  gates: GateRef[];
  active: GateRef[];
  /** schema 不兼容说明（null 表示正常） */
  schemaReason: string | null;
  /** 文件存在但解析失败（Phase 3：保守锁闭依据；文件不存在不算） */
  unreadable: boolean;
}

export interface RunEndedEvent {
  key: string;
  topic: string;
  stage: string;
  runId: string;
  /** 回落后的终态（idle/approved/rejected/abandoned） */
  endState: string;
}

function emptySnapshot(unreadable = false): StateSnapshot {
  return { gates: [], active: [], schemaReason: null, unreadable };
}

export function parseGates(text: string): StateSnapshot {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return emptySnapshot(true);
  }
  // 根值防御（代码审 r1 CLAUDE-09）：JSON 根为 null/标量/数组时按 unreadable 处理，
  // 不让 TypeError 外溢成静默失败
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return emptySnapshot(true);
  }
  const gatesRaw = (obj as Record<string, unknown>)['gates'];
  if (!gatesRaw || typeof gatesRaw !== 'object' || Array.isArray(gatesRaw)) {
    return emptySnapshot(true);
  }
  const schema = typeof (obj as Record<string, unknown>)['schema'] === 'string' ? ((obj as Record<string, unknown>)['schema'] as string) : null;
  const verdict = checkSchema(schema, 'state');
  const schemaReason =
    verdict.kind === 'incompatible' || verdict.kind === 'unknown' ? verdict.reason : null;
  const gates: GateRef[] = [];
  for (const [key, v] of Object.entries(gatesRaw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const g = v as Record<string, unknown>;
    gates.push({
      key,
      topic: typeof g['topic'] === 'string' ? g['topic'] : key,
      stage: typeof g['stage'] === 'string' ? g['stage'] : '',
      state: typeof g['state'] === 'string' ? g['state'] : 'unknown',
      runId: typeof g['run_id'] === 'string' ? g['run_id'] : '',
      since: typeof g['since'] === 'string' ? g['since'] : null,
      rerunIndex: typeof g['rerun_index'] === 'number' ? (g['rerun_index'] as number) : null,
      driver: typeof g['driver'] === 'string' ? (g['driver'] as string) : null,
    });
  }
  const active = gates.filter((g) => ACTIVE_GATE_STATES.has(g.state) && g.runId !== '');
  return { gates, active, schemaReason, unreadable: false };
}

/** 由上一次快照与本帧快照推出「活跃→回落」事件（CODEX-02：失败回 idle 也能被看见） */
export function diffRunEnded(prev: StateSnapshot | null, next: StateSnapshot): RunEndedEvent[] {
  if (!prev) return [];
  const prevActive = new Map(prev.active.map((g) => [g.key, g]));
  const nextByKey = new Map(next.gates.map((g) => [g.key, g]));
  const events: RunEndedEvent[] = [];
  for (const [key, g] of prevActive) {
    const now = nextByKey.get(key);
    if (!now) continue;
    if (!ACTIVE_GATE_STATES.has(now.state)) {
      events.push({ key, topic: g.topic, stage: g.stage, runId: g.runId, endState: now.state });
    }
  }
  return events;
}
