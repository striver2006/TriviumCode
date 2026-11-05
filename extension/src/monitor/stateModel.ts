/**
 * state.json 纯函数模型（FR-4 / D4′）。
 *
 * 与 watcher（stateWatch.ts）分离：本模块不依赖 vscode，单测直接覆盖。
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
}

export interface StateSnapshot {
  gates: GateRef[];
  active: GateRef[];
  /** schema 不兼容说明（null 表示正常） */
  schemaReason: string | null;
}

export interface RunEndedEvent {
  key: string;
  topic: string;
  stage: string;
  runId: string;
  /** 回落后的终态（idle/approved/rejected/abandoned） */
  endState: string;
}

export function parseGates(text: string): StateSnapshot {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { gates: [], active: [], schemaReason: null };
  }
  const schema = typeof obj['schema'] === 'string' ? obj['schema'] : null;
  const verdict = checkSchema(schema, 'state');
  const schemaReason =
    verdict.kind === 'incompatible' || verdict.kind === 'unknown' ? verdict.reason : null;
  const gatesRaw = obj['gates'];
  const gates: GateRef[] = [];
  if (gatesRaw && typeof gatesRaw === 'object') {
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
      });
    }
  }
  const active = gates.filter((g) => ACTIVE_GATE_STATES.has(g.state) && g.runId !== '');
  return { gates, active, schemaReason };
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
