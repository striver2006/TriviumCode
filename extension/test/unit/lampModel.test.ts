/** 三色灯全映射单测（r2 计划 D9：七态 × 多闸门 × unreadable） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lampOf, guardLevelOf } from '../../src/approval/lampModel';

test('无闸门 → 绿（自由编辑）', () => {
  const s = lampOf({ activeStates: [], unreadable: false });
  assert.equal(s.color, 'green');
  assert.equal(guardLevelOf(s.color), 'free');
});

test('终态不亮灯：approved/rejected/abandoned/idle 均不在活跃集 → 绿', () => {
  assert.equal(lampOf({ activeStates: [], unreadable: false }).color, 'green');
});

test('running → 红（任一即锁闭，多闸门并存时最高级别胜）', () => {
  assert.equal(lampOf({ activeStates: ['running'], unreadable: false }).color, 'red');
  assert.equal(lampOf({ activeStates: ['awaiting_approval', 'running'], unreadable: false }).color, 'red');
});

test('raf / awaiting_approval（无 running）→ 黄', () => {
  assert.equal(lampOf({ activeStates: ['review_done_awaiting_disposition'], unreadable: false }).color, 'yellow');
  assert.equal(lampOf({ activeStates: ['awaiting_approval'], unreadable: false }).color, 'yellow');
});

test('unreadable（state.json 存在但解析失败）→ 红且提示不可读（CLAUDE-02 保守降级）', () => {
  const s = lampOf({ activeStates: [], unreadable: true });
  assert.equal(s.color, 'red');
  assert.ok(s.tooltip.includes('解析失败'));
  assert.ok(s.label.includes('状态不可读'));
});

test('黄灯也走防护（guarded）：闸门期保存受警示', () => {
  assert.equal(guardLevelOf('yellow'), 'guarded');
  assert.equal(guardLevelOf('red'), 'guarded');
});
