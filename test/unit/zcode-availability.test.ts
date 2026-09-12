import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zcodeAdapter } from '../../src/trivium/adapters/zcode.js';
import { defaultConfig } from '../../src/trivium/config.js';

function ctxWith(flags: string[]) {
  const cfg = defaultConfig();
  cfg.probe.zcode.entry = '/x/zcode.cjs';
  cfg.probe.zcode.readonly_flags = flags;
  cfg.probe.zcode.response_field = 'response';
  return { cfg, nodePath: process.execPath };
}

/*
 * --disallowed-tools 是硬前置（审核 M18）：`--mode plan` 并不阻止命令执行，
 * 原先只要 readonly_flags 非空就判可用，某个版本把 --disallowed-tools 改名后
 * 审查员会在没有任何工具级 denylist 的情况下跑起来。
 */
test('只有 --mode plan 时不可用，并说明原因', () => {
  const a = zcodeAdapter.availability(ctxWith(['--mode plan']));
  assert.equal(a.ok, false);
  assert.match(a.reason ?? '', /--disallowed-tools/);
});

test('有 --disallowed-tools 即可用', () => {
  assert.equal(zcodeAdapter.availability(ctxWith(['--mode plan', '--disallowed-tools Write,Edit,Bash'])).ok, true);
});
