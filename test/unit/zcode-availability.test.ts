import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zcodeAdapter } from '../../src/trivium/adapters/zcode.js';
import { defaultConfig } from '../../src/trivium/config.js';

function ctxWith(flags: string[]) {
  const cfg = defaultConfig();
  // probed_at 必填：适配器以它区分「没探过」与「探过但没找到入口」（AGY-01）。
  // 不设的话下面每条用例拿到的都会是「尚未探测」，测不到只读参数那一层。
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode!.entrypoint = '/x/zcode.cjs';
  cfg.probe.cli.zcode!.readonly_flags = flags;
  cfg.probe.cli.zcode!.response_field = 'response';
  return { cfg, nodePath: process.execPath };
}

/*
 * ── 「未探过」与「探过但没找到入口」必须答不同的话（审查意见 AGY-01）──
 *
 * 这两条直测的是**注释曾宣称、实现却没兑现**的那条分支。
 * 原判据写的是 `if (!p)`，而 `defaultProbe()` 为全部已登记 CLI 预填空壳、
 * `patchProbe` 又按 default 补齐——`p` 恒非空，那一支恒不可达，两态永远答同一句。
 * 光跑整体流程发现不了：两种情形都会「不可用」，只是理由指错了方向。
 */

test('未探过时答「尚未探测」，而不是「未找到入口」', () => {
  const cfg = defaultConfig();
  // 默认空壳：probed_at 与 entrypoint 都是 null
  const a = zcodeAdapter.availability({ cfg, nodePath: process.execPath });
  assert.equal(a.ok, false);
  assert.match(a.reason ?? '', /尚未探测/);
  assert.doesNotMatch(
    a.reason ?? '', /未找到/,
    '没探过就说「未找到入口」会把人引去查环境，而该做的是跑 doctor',
  );
});

test('探过但入口丢失时答「未找到入口」，而不是「尚未探测」', () => {
  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode!.entrypoint = null; // 探过了，但那次没找到
  const a = zcodeAdapter.availability({ cfg, nodePath: process.execPath });
  assert.equal(a.ok, false);
  assert.match(a.reason ?? '', /未找到/);
  assert.doesNotMatch(
    a.reason ?? '', /尚未探测/,
    '探过了就别再说「尚未探测」——重跑 doctor 也不会变，真实原因是这台机器上没装',
  );
});

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
