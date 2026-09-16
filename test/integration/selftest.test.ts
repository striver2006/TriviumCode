import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { ASSET_ROOT, BUNDLE, bundleMissing, bundleSkipReason } from '../helpers/fixture.js';
import { run } from '../../src/trivium/util/exec.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { STUB_ENV_VAR } from '../../src/trivium/adapters/stub.js';
import { DEFAULT_CRITICS } from '../../src/trivium/types.js';

/**
 * `doctor --selftest` 本身的回归（交付物 8）。
 *
 * 它是新用户装完之后唯一能问「到底装好了没有」的命令，所以它自己坏了必须被发现：
 * 一个永远报通过的自检比没有自检更糟。
 */

async function selftest(args: string[] = [], env: Record<string, string | undefined> = {}) {
  return run(process.execPath, [BUNDLE, 'doctor', '--selftest', ...args], {
    // 故意不在项目根跑：selftest 用自己的临时夹具，不该依赖当前目录是不是已 init
    cwd: '/tmp',
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, [STUB_ENV_VAR]: undefined, ...env },
    timeoutMs: 300_000,
  });
}

test('自检整体通过，且每一步都被列出', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await selftest();
  assert.equal(r.code, EXIT.OK, `自检应通过：\n${r.stdout}\n${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /自检：✅ 通过（(\d+)\/\1 步）/, '通过时分子分母必须相等');

  /*
   * 逐条点名几个最关键的不变量，防止步骤被悄悄删掉而自检仍然「通过」。
   *
   * **这里的措辞不得写死侧数**：原先点的是「两侧审查文档均已落盘」，
   * 而 selftest 的步骤名随缺省集合派生（r12 CODEX-04 ≡ GLM-03 改的就是这个）。
   * 缺省集合一变，这条断言会因为一个纯文案差异变红，掩盖它真正要守的东西
   * ——「落盘核验这一步还在不在」。
   */
  for (const key of [
    '双审启动', '双审收敛', '审查文档均已落盘',
    '裁决未齐备时禁止提交', '裁决未齐备时禁止收工',
    '裁决完整性校验通过', '工件齐备', '裁决齐备后放行提交',
    '禁止主脑自行产出', '编译测试出口真实执行', '复盘可生成', '重跑抬升 -r2',
  ]) {
    assert.match(out, new RegExp(key), `自检必须覆盖「${key}」`);
  }

  /*
   * 落盘核验必须**逐侧**点名，不能只看那一行在不在。
   *
   * r12 三侧独立指出：该步骤曾只断言两个写死的后缀，缺省集合的首侧没落盘也照样绿。
   * 这条断言锁住修复本身——步骤名里的家数得跟缺省集合对得上。
   */
  assert.match(
    out,
    new RegExp(`工件齐备（AC-01：原稿 \\+ ${DEFAULT_CRITICS.length} 侧审查 \\+ 裁决件`),
    `工件计数必须随缺省集合派生（当前 ${DEFAULT_CRITICS.length} 侧），不得停在「四件套」`,
  );
});

test('必须写明未覆盖的边界——别让人把它读成「那几家 CLI 能用」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await selftest();
  const out = r.stdout + r.stderr;
  assert.match(out, /本次自检\*\*未\*\*覆盖/);
  assert.match(out, /桩适配器/);
  assert.match(out, /trivium doctor.*trivium preflight|preflight/s, '必须指向真正能验各侧 CLI 的命令');
});

test('不在项目根、当前项目未 init 也能跑', { skip: bundleMissing && bundleSkipReason }, async () => {
  // cwd 是 /tmp，那里没有 .trivium/config.yaml。装完还没 init 的时刻正是最需要它的时候
  const r = await selftest();
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /不在 git 仓库|尚未初始化/);
});

test('通过时清理夹具，--keep-fixture 时保留', { skip: bundleMissing && bundleSkipReason }, async () => {
  const clean = await selftest();
  const m = /夹具已清理/.exec(clean.stdout);
  assert.ok(m, `通过时应清理夹具：\n${clean.stdout}`);

  const kept = await selftest(['--keep-fixture']);
  const p = /夹具保留在 (\S+)/.exec(kept.stdout);
  assert.ok(p, `--keep-fixture 应保留并给出路径：\n${kept.stdout}`);
  const root = p[1]!;
  assert.ok((await fs.stat(root)).isDirectory());
  // 夹具必须真是「故意留洞」的项目（§17.3），否则拿去手工验收没有意义
  const payment = await fs.readFile(`${root}/src/payment.ts`, 'utf8');
  assert.match(payment, /故意留的洞/);
  assert.match(payment, /幂等/);
  await fs.rm(root, { recursive: true, force: true });
});

test('环境坏掉时如实报失败并保留夹具，绝不假装通过', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await selftest([], { TRIVIUM_ASSET_ROOT: '/nonexistent/assets' });
  assert.equal(r.code, EXIT.FAIL, '资产根不存在时必须失败');
  const out = r.stdout + r.stderr;
  assert.match(out, /自检：❌ 未通过/);
  assert.match(out, /lenses\.yaml/, '要指出具体缺什么');

  const p = /夹具保留在 (\S+)/.exec(out);
  assert.ok(p, '失败时必须保留夹具供排查');
  await fs.rm(p[1]!, { recursive: true, force: true });
});
