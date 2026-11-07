/** state.json 纯函数单测：白名单 + 历史残留 + 回落事件（CLAUDE-04/AGY-04/CODEX-02） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGates, diffRunEnded } from '../../src/monitor/stateModel';

const STATE = (gates: Record<string, unknown>) => JSON.stringify({ schema: 'trivium.state.v1', updated_at: 'x', gates });

test('活跃白名单：running/awaiting 进，approved/rejected/abandoned/idle 不进', () => {
  const snap = parseGates(
    STATE({
      'T1/plan': { topic: 'T1', stage: 'plan', state: 'running', run_id: 'r1' },
      'T2/code': { topic: 'T2', stage: 'code', state: 'awaiting_approval', run_id: 'r2' },
      'T3/plan': { topic: 'T3', stage: 'plan', state: 'approved', run_id: 'r3' },
      'T4/plan': { topic: 'T4', stage: 'plan', state: 'rejected', run_id: 'r4' },
      'T5/plan': { topic: 'T5', stage: 'plan', state: 'abandoned', run_id: null },
      'T6/plan': { topic: 'T6', stage: 'plan', state: 'idle', run_id: 'r6' },
    }),
  );
  assert.deepEqual(snap.active.map((g) => g.key), ['T1/plan', 'T2/code']);
});

test('活跃但 run_id 为空 → 不进活跃（防空扫描）', () => {
  const snap = parseGates(STATE({ 'T/plan': { topic: 'T', stage: 'plan', state: 'running', run_id: '' } }));
  assert.equal(snap.active.length, 0);
});

test('坏 JSON → 空快照不报错', () => {
  assert.equal(parseGates('{"schema": ').active.length, 0);
});

test('schema 不符 → 标注原因（不崩）', () => {
  const snap = parseGates(STATE({}).replace('state.v1', 'state.v9'));
  assert.match(snap.schemaReason!, /state/);
});

test('活跃→回落 diff：失败运行回 idle 也能被发现', () => {
  const prev = parseGates(STATE({ 'T/plan': { topic: 'T', stage: 'plan', state: 'running', run_id: 'r1' } }));
  const next = parseGates(STATE({ 'T/plan': { topic: 'T', stage: 'plan', state: 'idle', run_id: 'r1' } }));
  const events = diffRunEnded(prev, next);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.runId, 'r1');
  assert.equal(events[0]!.endState, 'idle');
});

test('仍在活跃 → 无回落事件', () => {
  const prev = parseGates(STATE({ 'T/plan': { topic: 'T', stage: 'plan', state: 'running', run_id: 'r1' } }));
  const next = parseGates(STATE({ 'T/plan': { topic: 'T', stage: 'plan', state: 'review_done_awaiting_disposition', run_id: 'r1' } }));
  assert.equal(diffRunEnded(prev, next).length, 0);
});

test('代码审 r1 CLAUDE-09：JSON 根为 null/标量/数组 → unreadable（不静默、不抛异常）', () => {
  for (const bad of ['null', '123', '"x"', '[]']) {
    const snap = parseGates(bad);
    assert.equal(snap.unreadable, true, `根 ${bad} 应按不可读处理`);
    assert.equal(snap.gates.length, 0);
  }
});
