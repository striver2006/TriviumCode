/** 退出码语义映射单测 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainExitCode } from '../../src/cli/exitCodes';

test('已知退出码有中文语义与建议', () => {
  assert.equal(explainExitCode(0).label, '成功');
  assert.match(explainExitCode(64).hint, /旗标/);
  assert.match(explainExitCode(65).label, /前置产物/);
  assert.match(explainExitCode(69).hint, /doctor/);
  assert.equal(explainExitCode(70).label, '主题被锁');
  assert.equal(explainExitCode(73).label, '运行仍在进行');
});

test('未知退出码原样显示', () => {
  assert.match(explainExitCode(99).label, /99/);
});
