/**
 * EV-188 的 zcode 轨迹样本（计划 `.reviews/MCP执行工具调用检测/plan/` r2 §3.1）：照真实形态构造的 rollout 行与会话日志行。
 *
 * 形态取自 run `20261001T092816Z` 的 glm 侧：rollout 行的顶层键（completedAt / durationMs / requestId / attempt / model / request /
 * response / sessionId / querySource / startedAt / traceId / turnId / type）、`model`、`request.toolNames`、`response.toolCalls[]`
 * 元素 `{id, name, input}`、node_repl 的 `input`（`code` / `timeout_ms` / `title`）；日志行的顶层键（含 `toolCallId`）与 `context`
 * 七个键。正文一律是合成内容。单测、适配器级用例与 `doc/05_testing/evidence/mcp-exec-detect-20261002/` 的对照脚本共用。
 */

export const SAMPLE_SID = 'sess_716f0d37-acc3-42d6-916e-12f704c5f44b';

export type SampleCall = { id: string; name: string; input: Record<string, unknown> };

const TOOL_NAMES = ['Agent', 'AskUserQuestion', 'Glob', 'Grep', 'Read', 'mcp__node_repl__js', 'mcp__zread__read_file'];

/** 一行 rollout（一次模型请求/响应） */
export function rolloutLine(calls: SampleCall[], i = 0, sid = SAMPLE_SID): string {
  return JSON.stringify({
    completedAt: `2026-10-01T09:30:${String(10 + i).padStart(2, '0')}.000Z`,
    durationMs: 1200,
    requestId: `req_${i}`,
    attempt: 1,
    model: { modelId: 'GLM-5.3', providerId: 'bigmodel-coding-plan' },
    request: {
      body: { model: 'GLM-5.3', tools: TOOL_NAMES.map((name) => ({ name, description: '…', input_schema: {} })) },
      headers: {},
      messages: [],
      toolNames: TOOL_NAMES,
      messageCount: 1,
      messagesKind: 'full',
      messageOffset: 0,
    },
    response: {
      finishReason: calls.length > 0 ? 'tool-calls' : 'stop',
      headers: {},
      modelId: 'GLM-5.3',
      providerMetadata: {},
      reasoningText: '',
      responseId: `resp_${i}`,
      text: '',
      toolCalls: calls,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    sessionId: sid,
    querySource: 'main_turn',
    startedAt: `2026-10-01T09:30:${String(9 + i).padStart(2, '0')}.000Z`,
    traceId: 'trace_x',
    turnId: 'turn_x',
    type: 'model_io',
  });
}

/** 一行会话日志的 tool.call.* 事件：`toolCallId` 在顶层，`context` 七个键 */
export function logLine(
  event: 'tool.call.started' | 'tool.call.completed' | 'tool.call.failed',
  toolName: string,
  toolCallId: string | null,
  sid = SAMPLE_SID,
): string {
  return JSON.stringify({
    timestamp: '2026-10-01T09:30:11.000Z',
    level: 'info',
    event,
    module: 'tool',
    message: event,
    traceId: 'trace_x',
    spanId: 'span_x',
    parentSpanId: 'span_p',
    sessionId: sid,
    turnId: 'turn_x',
    ...(toolCallId ? { toolCallId } : {}),
    status: event.slice('tool.call.'.length),
    context: {
      queryId: 'query_0c2a476c-fcd7-4ba7-b198-ba247dbea9be', turnNumber: 0, providerId: 'bigmodel-coding-plan',
      modelId: 'GLM-5.3', iteration: 3, querySource: 'main_turn', toolName,
    },
  });
}

/** 启动事件：带 `context.model`，生效模型从这里读回 */
export function bootLine(sid = SAMPLE_SID): string {
  return JSON.stringify({
    timestamp: '2026-10-01T09:30:00.000Z', level: 'info', event: 'bootstrap.app.startup.runtime_config.completed',
    sessionId: sid, context: { model: 'bigmodel-coding-plan/GLM-5.3' },
  });
}

/** 一次完整调用在日志里的两行（started + completed） */
export const logCall = (toolName: string, id: string | null, sid = SAMPLE_SID): string[] => [
  logLine('tool.call.started', toolName, id, sid),
  logLine('tool.call.completed', toolName, id, sid),
];

export const repl = (id: string, code: string): SampleCall => ({
  id, name: 'mcp__node_repl__js', input: { code, timeout_ms: 60000, title: '核对' },
});
export const read = (id: string, p: string): SampleCall => ({ id, name: 'Read', input: { file_path: p } });

/**
 * 三种整轮样本（改前改后对照与适配器级用例共用）：同一组读取，外加执行型 / 名单外 / 无 MCP 三种变化。
 * `projectRoot` 是 Read 路径的前缀。返回 `{ rollout, log }` 两份文件正文。
 */
export function roundSample(kind: 'exec' | 'untrusted' | 'none', projectRoot: string, sid = SAMPLE_SID): { rollout: string; log: string } {
  const reads = [read('call_r1', `${projectRoot}/src/a.ts`), read('call_r2', `${projectRoot}/src/b.ts`), read('call_r3', `${projectRoot}/README.md`)];
  const extra: SampleCall[] =
    kind === 'exec'
      ? [repl('call_m1', 'const r = 17 * 23;\nr')]
      : kind === 'untrusted'
        ? [{ id: 'call_m1', name: 'mcp__zread__read_file', input: { repo_name: 'x/y', file_path: 'README.md' } }]
        : [];
  const rollout = [rolloutLine(reads, 0, sid), rolloutLine(extra, 1, sid), rolloutLine([], 2, sid)].join('\n') + '\n';
  const log = [
    bootLine(sid),
    ...reads.flatMap((c) => logCall(c.name, c.id, sid)),
    ...extra.flatMap((c) => logCall(c.name, c.id, sid)),
  ].join('\n') + '\n';
  return { rollout, log };
}
