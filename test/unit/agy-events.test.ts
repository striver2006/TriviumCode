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

/*
 * ── grep 通道的路径必须提得出来（EV-28）──
 *
 * `PATH_KEYS` 此前不含 `SearchPath`，而 `grep_search` 的目录参数就叫这个名字
 * （`Query` 是搜索词）。于是措施 a 对 grep 通道**恒盲**：2026-09-16 实测
 * 某轮 15 次 `grep_search`（全部 `DONE`）提出 **0 条**路径，而计数通道照常把它们
 * 计进 `grep`——看起来一切正常。
 *
 * 这条缺口格外要命，因为 grep 正是探针记录里写明的**绕过通道**：
 * 另两家 CLI 都实测过「显式 deny 该路径后，模型改用 Grep 读到了目标文件」。
 * 最可能被用来绕过的那条路，检测面上是空的。
 *
 * 下面的参数形态取自真实轨迹，不是构造的。
 */
const GREP_SAMPLE = [
  '{"event":"init","conversation_id":"g1","init":{"model":"gemini-3.8-flash-high","cwd":"/tmp/fix","tools":["grep_search"],"permission_mode":"request-review"}}',
  '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"grep_search","tool_info":{"name":"grep_search","parameters":{"Query":"peer_leak","SearchPath":"/tmp/fix/src"}}}}',
  '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"tool","tool_name":"grep_search","duration_seconds":0.3,"tool_info":{"name":"grep_search","parameters":{"Query":"peer_leak","SearchPath":"/tmp/fix/src"}}}}',
  '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"find_by_name","duration_seconds":0.1,"tool_info":{"name":"find_by_name","parameters":{"Pattern":"*.ts","SearchDirectory":"/tmp/fix/test"}}}}',
  '{"event":"result","result":{"conversation_id":"g1","status":"SUCCESS","response":"done","duration_seconds":1.0,"num_turns":1}}',
].join('\n');

test('EV-28：grep 的目录参数（SearchPath）必须进 readPaths，否则措施 a 对该通道恒盲', () => {
  const paths = readPaths(parseAgyStream(GREP_SAMPLE));
  assert.ok(
    paths.includes('/tmp/fix/src'),
    `grep_search 的 SearchPath 没被提取——禁读核验对 grep 通道失明。实得：${JSON.stringify(paths)}`,
  );
  assert.ok(
    paths.includes('/tmp/fix/test'),
    'find_by_name 的 SearchDirectory 也要提得出来（它本来就在键名表里，这里一并锁住）',
  );
});

test('EV-28：搜索词不是路径——Query/Pattern 不得被当成读取路径', () => {
  const paths = readPaths(parseAgyStream(GREP_SAMPLE));
  assert.ok(!paths.includes('peer_leak'), 'Query 是搜索词');
  assert.ok(!paths.includes('*.ts'), 'Pattern 是文件名模式');
  assert.equal(paths.length, 2, `只该有两条真实目录，实得：${JSON.stringify(paths)}`);
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
