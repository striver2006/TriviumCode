/**
 * Antigravity `--output-format stream-json` 事件解析（纯函数，无 I/O）。
 *
 * M0 实测确立的事实：**`stream-json` 本身就是工具轨迹来源**，不需要另找日志文件。
 * 这同时服务三件事：AC-05 的 Agent 执行证据、AC-11 的 `project_reads` 下限、
 * 以及 §10.1 第 ③ 道的 `deny_paths` 事后轨迹核验。
 *
 * 事件形状（agy 1.2.0 实测）：
 *   {"event":"init","conversation_id":…,"init":{model,cwd,tools[],permission_mode}}
 *   {"event":"step_update","step_update":{step_index,state,step_type,tool_name,tool_info{parameters,error},duration_seconds,usage}}
 *   {"event":"result","result":{status,response,duration_seconds,num_turns,usage,denied_actions[]}}
 */

export type ToolState = 'ACTIVE' | 'DONE' | 'ERROR' | string;

export interface AgyToolCall {
  stepIndex: number;
  toolName: string;
  state: ToolState;
  parameters: Record<string, unknown>;
  /** 从参数里提取出的文件路径（绝对路径，agy 的文件工具只接受绝对路径） */
  path: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
}

export interface AgyDeniedAction {
  action: string;
  display_name?: string;
}

export interface AgyStreamResult {
  conversationId: string | null;
  /** init 事件上报的 cwd（只读上报，不是我们设的） */
  cwd: string | null;
  model: string | null;
  /** init 上报的是**完整工具注册表**而非 Agent 白名单——不得用它证明只读（M0 坑） */
  registryTools: string[];
  permissionMode: string | null;
  toolCalls: AgyToolCall[];
  status: string | null;
  response: string;
  numTurns: number | null;
  durationSeconds: number | null;
  usage: Record<string, number>;
  /** 官方机读的软拒绝信号（1.1.27 引入）。非空即说明有工具被静默拒了 */
  deniedActions: AgyDeniedAction[];
  /** 无法解析为 JSON 的行，用于诊断 */
  malformedLines: number;
}

/** agy 文件类工具的参数里，路径可能叫这几个名字 */
const PATH_KEYS = ['AbsolutePath', 'SearchDirectory', 'DirectoryPath', 'Path', 'File', 'TargetFile'];

/** 只读工具集：出现在轨迹里表示「读了东西」 */
export const AGY_READ_TOOLS = new Set(['view_file', 'grep_search', 'find_by_name', 'list_dir']);

/** 写类工具/命令：出现在轨迹里即 readonly_breach（FR-15 / AC-08） */
export const AGY_WRITE_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'sed_file',
  'notebook_edit',
  'run_command',
]);

function extractPath(params: Record<string, unknown>): string | null {
  for (const k of PATH_KEYS) {
    const v = params[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export function parseAgyStream(stdout: string): AgyStreamResult {
  const out: AgyStreamResult = {
    conversationId: null,
    cwd: null,
    model: null,
    registryTools: [],
    permissionMode: null,
    toolCalls: [],
    status: null,
    response: '',
    numTurns: null,
    durationSeconds: null,
    usage: {},
    deniedActions: [],
    malformedLines: 0,
  };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      out.malformedLines++;
      continue;
    }

    const kind = ev['event'];

    if (kind === 'init') {
      out.conversationId = (ev['conversation_id'] as string | undefined) ?? null;
      const init = (ev['init'] ?? {}) as Record<string, unknown>;
      out.cwd = (init['cwd'] as string | undefined) ?? null;
      out.model = (init['model'] as string | undefined) ?? null;
      out.registryTools = Array.isArray(init['tools']) ? (init['tools'] as string[]) : [];
      out.permissionMode = (init['permission_mode'] as string | undefined) ?? null;
      continue;
    }

    if (kind === 'step_update') {
      const s = (ev['step_update'] ?? {}) as Record<string, unknown>;
      if (s['step_type'] !== 'tool') continue;
      const info = (s['tool_info'] ?? {}) as Record<string, unknown>;
      const params = (info['parameters'] ?? {}) as Record<string, unknown>;
      const err = info['error'] as Record<string, unknown> | undefined;
      out.toolCalls.push({
        stepIndex: typeof s['step_index'] === 'number' ? (s['step_index'] as number) : -1,
        toolName: (s['tool_name'] as string | undefined) ?? (info['name'] as string | undefined) ?? '',
        state: (s['state'] as string | undefined) ?? '',
        parameters: params,
        path: extractPath(params),
        errorMessage: (err?.['message'] as string | undefined) ?? null,
        durationSeconds:
          typeof s['duration_seconds'] === 'number' ? (s['duration_seconds'] as number) : null,
      });
      continue;
    }

    if (kind === 'result') {
      const r = (ev['result'] ?? {}) as Record<string, unknown>;
      out.status = (r['status'] as string | undefined) ?? null;
      out.response = (r['response'] as string | undefined) ?? '';
      out.numTurns = typeof r['num_turns'] === 'number' ? (r['num_turns'] as number) : null;
      out.durationSeconds =
        typeof r['duration_seconds'] === 'number' ? (r['duration_seconds'] as number) : null;
      if (r['usage'] && typeof r['usage'] === 'object') {
        out.usage = r['usage'] as Record<string, number>;
      }
      if (Array.isArray(r['denied_actions'])) {
        out.deniedActions = r['denied_actions'] as AgyDeniedAction[];
      }
      if (!out.conversationId && typeof r['conversation_id'] === 'string') {
        out.conversationId = r['conversation_id'];
      }
    }
  }

  return out;
}

/** 只统计**成功完成**的工具调用——ERROR 状态的调用没有真的读到东西，不能算证据 */
export function successfulToolCalls(r: AgyStreamResult): AgyToolCall[] {
  return r.toolCalls.filter((t) => t.state === 'DONE');
}

/** 轨迹中成功读取过的绝对路径去重集合 */
export function readPaths(r: AgyStreamResult): string[] {
  const set = new Set<string>();
  for (const t of successfulToolCalls(r)) {
    if (AGY_READ_TOOLS.has(t.toolName) && t.path) set.add(t.path);
  }
  return [...set];
}

/** 轨迹中出现的写事件（无论成功与否——尝试写本身就是失守信号） */
export function writeEvents(r: AgyStreamResult): string[] {
  return r.toolCalls
    .filter((t) => AGY_WRITE_TOOLS.has(t.toolName))
    .map((t) => `${t.toolName}(${t.path ?? JSON.stringify(t.parameters).slice(0, 80)})`);
}
