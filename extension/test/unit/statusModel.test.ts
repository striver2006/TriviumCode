/** status.json 渲染模型单测（N3 幂等 + 未知态透传 + 心跳计算） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus, heartbeatStale, sideStateLabel, phaseLabel } from '../../src/monitor/statusModel';

const VALID = JSON.stringify({
  schema: 'trivium.status.v1',
  run_id: '20261106T000000Z',
  topic: 'T',
  stage: 'plan',
  phase: 'running',
  heartbeat_at: '2026-11-06T00:00:00.000Z',
  sides: { claude: { state: 'ok', model: 'k3.1-pro', attempt: 1, elapsed_s: 100 } },
  artifacts: [],
  message: null,
});

test('合法快照解析', () => {
  const { render, schemaReason } = parseStatus(VALID);
  assert.equal(schemaReason, null);
  assert.equal(render!.phase, 'running');
  assert.equal(render!.terminal, false);
  assert.equal(render!.sides[0]!.state, 'ok');
});

test('坏 JSON / 半截写入 → render=null（丢弃不报错，N3）', () => {
  assert.equal(parseStatus('{"schema": "trivium.status.v1", "phase": "run').render, null);
  assert.equal(parseStatus('').render, null);
});

test('schema 主版本不符 → 丢弃并给出原因', () => {
  const { render, schemaReason } = parseStatus(VALID.replace('status.v1', 'status.v9'));
  assert.equal(render, null);
  assert.match(schemaReason!, /status/);
});

test('未知侧状态原样透传（不报错）', () => {
  const text = VALID.replace('"ok"', '"consulted"');
  assert.equal(parseStatus(text).render!.sides[0]!.state, 'consulted');
  assert.equal(sideStateLabel('consulted'), 'consulted');
});

test('终态集合判定', () => {
  for (const p of ['success', 'failed', 'cancelled']) {
    assert.equal(parseStatus(VALID.replace('"running"', `"${p}"`)).render!.terminal, true);
  }
});

test('心跳失联计算（含时钟语义）', () => {
  const t0 = Date.parse('2026-11-06T00:00:00.000Z');
  assert.equal(heartbeatStale('2026-11-06T00:00:00.000Z', t0 + 30_000, 120), false);
  assert.equal(heartbeatStale('2026-11-06T00:00:00.000Z', t0 + 121_000, 120), true);
  assert.equal(heartbeatStale(null, t0, 120), false);
  assert.equal(heartbeatStale('garbage', t0, 120), false);
});

test('phase/侧状态中文标签', () => {
  assert.equal(phaseLabel('archiving'), '归档中');
  assert.equal(sideStateLabel('ok'), '已完成');
});
