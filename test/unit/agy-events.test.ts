import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgyStream,
  readPaths,
  writeEvents,
  successfulToolCalls,
} from '../../src/trivium/adapters/agy-events.js';

/** 取自 M0 实测的真实 agy 1.2.0 stream-json 形状（路径已改写为夹具路径） */
const SAMPLE = [
  '{"event":"init","conversation_id":"2e38b1a1-2f45-4c6b-8cd8-7a2f7c378b88","init":{"model":"gemini-3.8-flash-low","cwd":"/tmp/fix","tools":["view_file","run_command","write_to_file"],"permission_mode":"request-review"}}',
  '{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}',
  '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","duration_seconds":1.97,"usage":{"total_tokens":21078}}}',
  '{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/tmp/fix/README.md"}}}}',
  '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"view_file","duration_seconds":0.08,"tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/tmp/fix/README.md"}}}}',
  '{"event":"result","result":{"conversation_id":"2e38b1a1-2f45-4c6b-8cd8-7a2f7c378b88","status":"SUCCESS","response":"SENTINEL_OPEN_7f3a2b themis fixture readme\\n","duration_seconds":2.02,"num_turns":1,"usage":{"total_tokens":21078}}}',
].join('\n');

/** 软拒绝样本：exit 0 但零文件读取，issue #548 的实际表现 */
const DENIED_SAMPLE = [
  '{"event":"init","conversation_id":"c1","init":{"model":"gemini-3.8-flash-low","cwd":"/tmp/fix","tools":[],"permission_mode":"request-review"}}',
  '{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"pwd"}}}}',
  '{"event":"step_update","step_update":{"step_index":2,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"pwd"},"error":{"type":"TOOL_ERROR","message":"permission check failed for command \\"pwd\\""}}}}',
  '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"","duration_seconds":2.0,"num_turns":1,"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}',
].join('\n');

test('解析 init 事件', () => {
  const r = parseAgyStream(SAMPLE);
  assert.equal(r.conversationId, '2e38b1a1-2f45-4c6b-8cd8-7a2f7c378b88');
  assert.equal(r.cwd, '/tmp/fix');
  assert.equal(r.model, 'gemini-3.8-flash-low');
  assert.equal(r.permissionMode, 'request-review');
  assert.deepEqual(r.registryTools, ['view_file', 'run_command', 'write_to_file']);
});

test('只收 step_type=tool 的事件，忽略 user_input / agent_response', () => {
  const r = parseAgyStream(SAMPLE);
  assert.equal(r.toolCalls.length, 2, 'ACTIVE + DONE 两条 tool 事件');
  assert.ok(r.toolCalls.every((t) => t.toolName === 'view_file'));
});

test('只有 DONE 状态才算成功的工具调用', () => {
  assert.equal(successfulToolCalls(parseAgyStream(SAMPLE)).length, 1);
  assert.equal(successfulToolCalls(parseAgyStream(DENIED_SAMPLE)).length, 0);
});

test('提取读取路径用于 deny 核验与 consulted 交叉核对', () => {
  assert.deepEqual(readPaths(parseAgyStream(SAMPLE)), ['/tmp/fix/README.md']);
});

test('解析 result 与哨兵', () => {
  const r = parseAgyStream(SAMPLE);
  assert.equal(r.status, 'SUCCESS');
  assert.ok(r.response.includes('SENTINEL_OPEN_7f3a2b'));
  assert.equal(r.numTurns, 1);
  assert.equal(r.usage['total_tokens'], 21078);
});

test('识别软拒绝：exit 0 + status SUCCESS 但 denied_actions 非空且零读取', () => {
  const r = parseAgyStream(DENIED_SAMPLE);
  assert.equal(r.status, 'SUCCESS', 'issue #548 的表现就是 status 仍为 SUCCESS');
  assert.equal(r.response, '');
  assert.equal(r.deniedActions.length, 1);
  assert.equal(r.deniedActions[0]?.action, 'command');
  assert.deepEqual(readPaths(r), [], '一个文件都没读到');
});

test('写事件即失守信号，ERROR 状态的写尝试也要计入', () => {
  const withWrite =
    SAMPLE +
    '\n{"event":"step_update","step_update":{"step_index":3,"state":"ERROR","step_type":"tool","tool_name":"write_to_file","tool_info":{"parameters":{"AbsolutePath":"/tmp/fix/x.ts"}}}}';
  const events = writeEvents(parseAgyStream(withWrite));
  assert.equal(events.length, 1);
  assert.ok(events[0]?.includes('write_to_file'));
  assert.ok(events[0]?.includes('/tmp/fix/x.ts'));
});

test('坏行被计数而非抛异常', () => {
  const r = parseAgyStream(SAMPLE + '\n{不是合法 JSON\n\n');
  assert.equal(r.malformedLines, 1);
  assert.equal(r.status, 'SUCCESS', '坏行不影响其余解析');
});
