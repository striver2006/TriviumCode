/**
 * status.json 渲染模型（纯函数，FR-4 / N3 幂等）。
 *
 * 编排器契约 `trivium.status.v1`：phase / sides / heartbeat_at / artifacts /
 * exit_code / message。已知竞态窗口（2026-11-03 分析 §3.5）：读到旧快照或半截
 * JSON 一律**丢弃不报错**，终态以 `--status` 复核为准（N3）。
 */
import { checkSchema } from '../env/versionCheck';

export const TERMINAL_PHASES = new Set(['success', 'failed', 'cancelled']);

export interface SideRender {
  critic: string;
  state: string;
  model: string | null;
  attempt: number | null;
  elapsedS: number | null;
}

export interface StatusRender {
  runId: string | null;
  topic: string | null;
  stage: string | null;
  phase: string;
  terminal: boolean;
  sides: SideRender[];
  heartbeatAt: string | null;
  startedAt: string | null;
  artifacts: string[];
  exitCode: number | null;
  message: string | null;
}

export interface ParseOutcome {
  /** null = 本次快照不可用（丢弃，保留上次渲染） */
  render: StatusRender | null;
  /** schema 不兼容说明（附在渲染上，由 UI 决定降级提示） */
  schemaReason: string | null;
}

export function parseStatus(text: string): ParseOutcome {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { render: null, schemaReason: null };
  }
  const schema = typeof obj['schema'] === 'string' ? obj['schema'] : null;
  const verdict = checkSchema(schema, 'status');
  if (verdict.kind === 'incompatible') {
    return { render: null, schemaReason: verdict.reason };
  }
  const phase = typeof obj['phase'] === 'string' ? obj['phase'] : 'unknown';
  const sidesRaw = obj['sides'];
  const sides: SideRender[] = [];
  if (sidesRaw && typeof sidesRaw === 'object') {
    for (const [critic, v] of Object.entries(sidesRaw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      sides.push({
        critic,
        state: typeof s['state'] === 'string' ? s['state'] : 'unknown',
        model: typeof s['model'] === 'string' ? s['model'] : null,
        attempt: typeof s['attempt'] === 'number' ? s['attempt'] : null,
        elapsedS: typeof s['elapsed_s'] === 'number' ? s['elapsed_s'] : null,
      });
    }
  }
  return {
    render: {
      runId: str(obj['run_id']),
      topic: str(obj['topic']),
      stage: str(obj['stage']),
      phase,
      terminal: TERMINAL_PHASES.has(phase),
      sides,
      heartbeatAt: str(obj['heartbeat_at']),
      startedAt: str(obj['started_at']),
      artifacts: Array.isArray(obj['artifacts']) ? (obj['artifacts'] as string[]) : [],
      exitCode: typeof obj['exit_code'] === 'number' ? obj['exit_code'] : null,
      message: str(obj['message']),
    },
    schemaReason: verdict.kind === 'unknown' ? verdict.reason : null,
  };
}

/** 心跳失联判定（纯函数：D5′；stale 只提示，不判死） */
export function heartbeatStale(
  heartbeatAt: string | null,
  nowMs: number,
  staleS: number,
): boolean {
  if (!heartbeatAt) return false;
  const t = Date.parse(heartbeatAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleS * 1000;
}

/** 侧状态 → 中文标签（未知态原样返回，不报错） */
export function sideStateLabel(state: string): string {
  const map: Record<string, string> = {
    ok: '已完成',
    running: '审查中',
    failed: '失败',
    timeout: '超时',
    cancelled: '已取消',
    pending: '排队中',
  };
  return map[state] ?? state;
}

export function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    starting: '启动中',
    running: '审查中',
    parsing: '解析归档中',
    archiving: '归档中',
    success: '成功',
    failed: '失败',
    cancelled: '已取消',
  };
  return map[phase] ?? phase;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
