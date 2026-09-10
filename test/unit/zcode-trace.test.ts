import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonEnvelope,
  parseZcodeEnvelope,
  parseZcodeTrace,
} from '../../src/trivium/adapters/zcode-trace.js';

/** M0 实测：stdout 前面会有 AI SDK 告警行，envelope 不是从第一个字符开始的 */
const NOISY_STDOUT = `AI SDK Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.
{
  "sessionId": "sess_d86d26fb-7141-425e-9974-e1a9916b934e",
  "traceId": "050bb0c9-9ef6-49d3-93d4-0f4a2eb40869",
  "turnId": "turn_48d58f74-c5e0-4890-9b1a-c6a99e3dec90",
  "response": "已读取 README.md，第一行是 SENTINEL_OPEN_7f3a2b open file",
  "usage": { "inputTokens": 100, "outputTokens": 20 },
  "eventCount": 12,
  "projection": {}
}
`;

test('抠 envelope：容忍前置告警行（不能用 JSON.parse(trim) ）', () => {
  assert.equal(JSON.parse.bind(null, NOISY_STDOUT.trim()) instanceof Function, true);
  assert.throws(() => JSON.parse(NOISY_STDOUT.trim()), '直接 parse 必然失败——这就是本函数存在的理由');
  const o = extractJsonEnvelope(NOISY_STDOUT);
  assert.ok(o);
  assert.equal(o!['sessionId'], 'sess_d86d26fb-7141-425e-9974-e1a9916b934e');
});

test('抠 envelope：字符串里的花括号不破坏配平', () => {
  const s = 'noise\n{"a":"} { not real","b":{"c":1}}\ntrailing';
  const o = extractJsonEnvelope(s);
  assert.deepEqual(o, { a: '} { not real', b: { c: 1 } });
});

test('抠 envelope：转义引号不破坏配平', () => {
  const o = extractJsonEnvelope('x {"a":"say \\"hi\\" }","b":2}');
  assert.deepEqual(o, { a: 'say "hi" }', b: 2 });
});

test('抠 envelope：无 JSON 时返回 null 而非抛异常', () => {
  assert.equal(extractJsonEnvelope('Error: something went wrong\n'), null);
  assert.equal(extractJsonEnvelope('{ 不完整'), null);
});

test('解析 envelope：正文在 .response，且记录全部字段名', () => {
  const e = parseZcodeEnvelope(NOISY_STDOUT);
  assert.ok(e);
  assert.ok(e!.response.includes('SENTINEL_OPEN_7f3a2b'));
  assert.equal(e!.sessionId, 'sess_d86d26fb-7141-425e-9974-e1a9916b934e');
  assert.equal(e!.eventCount, 12);
  assert.deepEqual(e!.keys, [
    'sessionId', 'traceId', 'turnId', 'response', 'usage', 'eventCount', 'projection',
  ]);
});

/** M0 实测的真实日志形状（已裁剪） */
const TRACE = [
  '{"timestamp":"t1","level":"info","event":"tool.call.started","sessionId":"S1","context":{"model":"bigmodel-coding-plan/GLM-5.3","toolName":"ReadSessionContext"}}',
  '{"timestamp":"t2","level":"error","event":"tool.call.failed","sessionId":"S1","context":{"model":"bigmodel-coding-plan/GLM-5.3","toolName":"ReadSessionContext"}}',
  '{"timestamp":"t3","level":"info","event":"tool.call.started","sessionId":"S1","context":{"model":"bigmodel-coding-plan/GLM-5.3","toolName":"Grep"}}',
  '{"timestamp":"t4","level":"info","event":"tool.call.completed","sessionId":"S1","context":{"model":"bigmodel-coding-plan/GLM-5.3","toolName":"Grep","filePath":"README.md"}}',
  '{"timestamp":"t5","level":"info","event":"tool.call.completed","sessionId":"S1","context":{"model":"bigmodel-coding-plan/GLM-5.3","toolName":"Read","filePath":"src/hello.ts"}}',
  // 另一个会话的行，必须被 sessionId 过滤掉
  '{"timestamp":"t6","level":"info","event":"tool.call.completed","sessionId":"S2","context":{"model":"other/MODEL","toolName":"Read","filePath":"secret.ts"}}',
  '{"timestamp":"t7","level":"info","event":"turn.completed","sessionId":"S1","context":{"toolCallCount":4}}',
].join('\n');

test('回读生效模型：envelope 没有 model 字段，只能从日志 context.model 取（AC-13）', () => {
  const t = parseZcodeTrace(TRACE, 'S1');
  assert.equal(t.modelEffective, 'bigmodel-coding-plan/GLM-5.3');
});

test('按 sessionId 过滤：共享 HOME 下多会话交织不得混入', () => {
  const t = parseZcodeTrace(TRACE, 'S1');
  assert.ok(!t.readPaths.includes('secret.ts'), '不得读到别的会话的路径');
  assert.deepEqual(t.readPaths.sort(), ['README.md', 'src/hello.ts']);
});

test('只统计 completed 的工具调用，failed 不算证据', () => {
  const t = parseZcodeTrace(TRACE, 'S1');
  assert.equal(t.toolCalls.read, 1);
  assert.equal(t.toolCalls.grep, 1);
  // ReadSessionContext 只有 started + failed，不计入
  assert.equal(t.toolCalls.run_command, 0);
});

test('写工具与 Bash 计入 writeEvents（只读失守信号）', () => {
  const withWrite =
    TRACE +
    '\n{"level":"info","event":"tool.call.started","sessionId":"S1","context":{"toolName":"Bash","path":"rm -rf x"}}' +
    '\n{"level":"info","event":"tool.call.completed","sessionId":"S1","context":{"toolName":"Write","filePath":"src/x.ts"}}';
  const t = parseZcodeTrace(withWrite, 'S1');
  assert.equal(t.writeEvents.length, 2);
  assert.ok(t.writeEvents.some((e) => e.startsWith('Bash')));
  assert.ok(t.writeEvents.some((e) => e.includes('src/x.ts')));
});

test('解析 turn.failed 的结构化根因', () => {
  const failed =
    '{"level":"error","event":"turn.failed","sessionId":"S1","message":"Turn failed",' +
    '"error":{"message":"Turn execution failed","cause":{"message":"Provider authentication failed.","code":"provider_not_configured"}}}';
  const t = parseZcodeTrace(failed, 'S1');
  assert.equal(t.turnFailed, true);
  assert.equal(t.failureCause, 'Provider authentication failed.');
});

test('sessionId 传 null 时全收（独立 HOME 下日志天然隔离）', () => {
  const t = parseZcodeTrace(TRACE, null);
  assert.ok(t.readPaths.includes('secret.ts'));
});

// ─────────────────── rollout 解析（M0 实测形状） ───────────────────

const ROLLOUT = [
  JSON.stringify({
    completedAt: '2026-09-10T21:34:57.809Z',
    requestId: 'r1',
    model: { modelId: 'GLM-5.3', providerId: 'bigmodel-coding-plan', role: 'main', source: 'config' },
    request: { body: { model: 'GLM-5.3', tools: [] } },
    response: {
      finishReason: 'tool-calls',
      toolCalls: [{ id: 'call_1', name: 'ReadSessionContext', input: { sessionId: 'invalid', query: 'invalid' } }],
    },
    sessionId: 'S1',
  }),
  JSON.stringify({
    requestId: 'r2',
    model: { modelId: 'GLM-5.3', providerId: 'bigmodel-coding-plan', role: 'main', source: 'config' },
    response: {
      toolCalls: [
        { id: 'call_2', name: 'Read', input: { file_path: '/proj/README.md' } },
        { id: 'call_3', name: 'Grep', input: { pattern: 'SENTINEL', path: '/proj/src' } },
      ],
    },
    sessionId: 'S1',
  }),
].join('\n');

test('rollout：工具参数里的路径可提取（标准日志没有这个信息）', async () => {
  const { parseZcodeRollout } = await import('../../src/trivium/adapters/zcode-trace.js');
  const r = parseZcodeRollout(ROLLOUT);
  assert.equal(r.toolCalls.length, 3);
  assert.deepEqual(r.readPaths.sort(), ['/proj/README.md', '/proj/src']);
});

test('rollout：回读生效模型的全限定形态与来源档位', async () => {
  const { parseZcodeRollout } = await import('../../src/trivium/adapters/zcode-trace.js');
  const r = parseZcodeRollout(ROLLOUT);
  assert.equal(r.modelEffective, 'bigmodel-coding-plan/GLM-5.3');
  // source=config 印证模型覆盖走的是 config_copy 档（设计 §11.3）
  assert.equal(r.modelSource, 'config');
});

test('rollout：写工具与 Bash 计入 writeEvents', async () => {
  const { parseZcodeRollout } = await import('../../src/trivium/adapters/zcode-trace.js');
  const withWrite =
    ROLLOUT +
    '\n' +
    JSON.stringify({
      response: { toolCalls: [{ id: 'c4', name: 'Write', input: { file_path: '/proj/x.ts', content: 'x' } }] },
    }) +
    '\n' +
    JSON.stringify({
      response: { toolCalls: [{ id: 'c5', name: 'Bash', input: { command: 'rm -rf /proj/y' } }] },
    });
  const r = parseZcodeRollout(withWrite);
  assert.equal(r.writeEvents.length, 2);
  assert.ok(r.writeEvents.some((e) => e.includes('/proj/x.ts')));
  assert.ok(r.writeEvents.some((e) => e.startsWith('Bash')));
});

test('rollout：坏行与无 toolCalls 的行被跳过而非抛异常', async () => {
  const { parseZcodeRollout } = await import('../../src/trivium/adapters/zcode-trace.js');
  const r = parseZcodeRollout('{不是 JSON\n{"response":{}}\n' + ROLLOUT);
  assert.equal(r.toolCalls.length, 3);
});
