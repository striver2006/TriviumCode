/** 闸门区模型单测（r2 计划 D9）：卡片筛选/排序、计票原样消费、null 降级、warnings 一等展示 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateCardsOf, mergeGateCheck, voteBlockOf, noVoteNote, verdictText } from '../../src/approval/gateAreaModel';
import type { GateCheckOutput } from '../../src/cli/commands';

const GATES = [
  { key: 'A/code', topic: 'A', stage: 'code', state: 'awaiting_approval', runId: 'r2', since: '2026-11-07T02:00:00Z', rerunIndex: 2 },
  { key: 'B/plan', topic: 'B', stage: 'plan', state: 'review_done_awaiting_disposition', runId: 'r1', since: '2026-11-07T01:00:00Z', rerunIndex: 1 },
  { key: 'C/plan', topic: 'C', stage: 'plan', state: 'running', runId: 'r3', since: 'x', rerunIndex: 1 }, // 运行中不进闸门区
  { key: 'D/plan', topic: 'D', stage: 'plan', state: 'approved', runId: 'r4', since: 'y', rerunIndex: null }, // 终态不进
  { key: 'E/plan', topic: 'E', stage: 'plan', state: 'awaiting_approval', runId: '', since: 'z', rerunIndex: null }, // 无 runId 不进
];

test('卡片筛选：仅 aa/raf 且有 runId；按 since 降序', () => {
  const cards = gateCardsOf(GATES);
  assert.deepEqual(cards.map((c) => c.key), ['A/code', 'B/plan']);
  assert.equal(cards[0]!.mode, 'aa');
  assert.equal(cards[1]!.mode, 'raf');
});

test('计票：round_verdict 原样消费（sides/counts/outcome/round_line）', () => {
  const check: GateCheckOutput = {
    ok: true, stage: 'code', rerun_index: 2, run_id: 'r2',
    failures: [], warnings: [{ code: 'degraded_round', message: '本轮有一侧降级' }],
    structured_ids: [], fallback_ids: [], degraded_ids: [], disposition: '/x',
    review_loop: { round: 2, max_rounds: 5 },
    round_verdict: {
      sides: { claude: 'pass-after-changes', gemini: 'pass', codex: 'reject' },
      excluded: {},
      counts: { pass: 1, 'pass-after-changes': 1, reject: 1 },
      outcome: 'pass-after-changes', next_action: 'proceed',
    },
    next_action: 'proceed', round_line: '第 2/5 轮 · 计票：1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过',
  };
  const merged = mergeGateCheck(check);
  assert.equal(merged.vote!.sides.length, 3);
  assert.equal(merged.vote!.counts.reject, 1);
  assert.equal(merged.vote!.roundLine, '第 2/5 轮 · 计票：1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过');
  assert.deepEqual(merged.warnings.map((w) => w.code), ['degraded_round'], 'warnings 一等展示不丢弃');
  assert.equal(merged.failureSummary.length, 0);
});

test('round_verdict null → 降级文案，不补算（CLAUDE-12）', () => {
  const check: GateCheckOutput = {
    ok: true, stage: 'bug', rerun_index: 1, run_id: 'r9',
    failures: [], warnings: [], structured_ids: [], fallback_ids: [], degraded_ids: [], disposition: '/x',
    review_loop: null, round_verdict: null, next_action: null, round_line: null,
  };
  const merged = mergeGateCheck(check);
  assert.equal(merged.vote, null);
  assert.ok(noVoteNote().includes('无计票信息'));
});

test('gate 退 2（aa 态异常）：failures 摘要原样展示', () => {
  const check: GateCheckOutput = {
    ok: false, stage: 'code', rerun_index: 1, run_id: 'r2',
    failures: [{ code: 'readonly_breach', message: '只读失守且复算确证' }],
    warnings: [], structured_ids: [], fallback_ids: [], degraded_ids: [], disposition: '/x',
    review_loop: null, round_verdict: null, next_action: null, round_line: null,
  };
  const merged = mergeGateCheck(check);
  assert.deepEqual(merged.failureSummary, [{ code: 'readonly_breach', message: '只读失守且复算确证' }]);
});

test('调用失败（无输出）：如实提示可重试', () => {
  const merged = mergeGateCheck(null);
  assert.ok(merged.failureSummary[0]!.message.includes('刷新重试'));
});

test('verdictText 中文标签与 voteBlockOf 组装', () => {
  assert.equal(verdictText('pass-after-changes'), '修改后通过');
  assert.equal(verdictText('reject'), '不通过');
  const v = voteBlockOf({ sides: { a: 'pass' }, excluded: null, counts: { pass: 1, 'pass-after-changes': 0, reject: 0 }, outcome: 'pass', next_action: 'proceed' }, null);
  assert.equal(v!.sides[0]!.critic, 'a');
});
