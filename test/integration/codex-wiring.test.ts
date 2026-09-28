/**
 * codex 接线的**端到端**判据（M8 第 3 步，计划双审 AGY-05）。
 *
 * ## 为什么必须走真实子进程
 *
 * 本步的两条完成判据是 CLI 级的：`doctor --only codex` 要给出确定结论、
 * `preflight --critics codex,glm` 要真把 codex 检查一遍。而单元测试测的是
 * `availability()` / `probeCodexProviders()` 这些函数——**函数对了不等于调用链对了**。
 *
 * M7b 第 5 步的原案就栽在这里：把 `opts.critics ?? …` 改成永远取配置默认值
 * （模拟接线漏传），全量 873 条测试无一变红——`--critics` 的调用链当时是零覆盖的。
 * 本步的 `preflight --critics` 透传是**同一形状的新接线**，所以它必须有这条用例守着。
 *
 * ## 不烧配额
 *
 * `doctor` 走 `--no-model-calls`，`preflight` 走 `--skip-auth-check`——
 * 两者跳过的恰好是全部需要真实厂商调用的步骤。因此本文件不依赖本机是否装了 codex：
 * 没装时探针记 `entrypoint: null`，判据照样成立（可用性为否，且理由说得出）。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bundleMissing, bundleSkipReason, cli, makeFixture, seedFakeProbes } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

const TOPIC = 'codex接线';
let root = '';

before(async () => {
  if (bundleMissing) return;
  const fx = await makeFixture({ topic: TOPIC });
  root = fx.root;
});

/** 探针夹具已收进 helpers（`seedFakeProbes`，代码双审 r1 CODEX-02）；这里只绑定本文件的夹具根 */
const seedProbes = (over: Record<string, unknown> = {}): Promise<void> => seedFakeProbes(root, over);

test('doctor --only codex 是合法取值，且给出确定结论', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * M6 第 1 步之前它退 64（「你的参数写错了」），而 codex 明明已在注册表登记。
   * 本条守的是：这个取值合法、且跑完能落盘一份结论——不是「没探过」那种半截状态。
   */
  const r = await cli(root, ['doctor', '--only', 'codex', '--no-model-calls'], null, 180_000);
  assert.ok(r.code === EXIT.OK || r.code === EXIT.ENV, `不该是参数错误，实得 ${r.code}：${r.stderr.slice(0, 200)}`);
  assert.match(r.stdout + r.stderr, /codex/, '输出里要点名这一侧');
});

test('preflight --critics codex,glm：codex 侧真的被检查到', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * **这条守的是接线，不是判据**。`cmdPreflight` 若不把 `--critics` 传进
   * `runPreflight`，预检会按 `default_critics`（两家，不含 codex）检查，
   * 而用户下一步选的是 codex —— 被选中那一侧的可用性在预检阶段静默漏检。
   * 漏传不会报错、不会退非零码，只是少查了一侧：正是 M7b 第 5 步那个形状。
   */
  await seedProbes();
  const r = await cli(root, ['preflight', '--stage', 'plan', '--critics', 'codex,glm', '--skip-auth-check', '--json'], null, 180_000);
  const out = JSON.parse(r.stdout) as { checks: { name: string; detail: string }[] };
  const readonly = out.checks.find((c) => c.name === '只读能力可用');
  assert.ok(readonly, '预检应当有只读能力这一项');
  assert.match(readonly.detail, /Codex/, 'codex 入选却没在只读能力检查里露面 ⇒ --critics 没透传进预检');
});

test('preflight：没选 codex 时不因它的环境未配而失败', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * D-1 的连带保护：codex 启用为审核者之后，**没选它的运行不该被它拖累**。
   * 按注册表全集检查就会——那正是把 `checkReadonlyCapability` 等三项
   * 改成按入选集合检查的理由。
   */
  await seedProbes({ exec_headless_read_ok: false, readonly_flags: [] });
  const r = await cli(root, ['preflight', '--stage', 'plan', '--skip-auth-check', '--json'], null, 180_000);
  const out = JSON.parse(r.stdout) as { ok: boolean; checks: { name: string; detail: string }[] };
  const readonly = out.checks.find((c) => c.name === '只读能力可用');
  assert.ok(readonly, '预检应当有只读能力这一项');
  assert.doesNotMatch(readonly.detail, /Codex/, '默认两家的运行里不该出现 codex——它没入选');
});

test('preflight --critics 选了环境未配的 codex → 如实拦下并说明原因', { skip: bundleMissing && bundleSkipReason }, async () => {
  // AC-20 末条要的就是这个：家族未配置 ⇒ **预检即拒绝启动**，而不是跑到一半才失败
  await seedProbes({
    providers: [{ profile: 'qwen', provider: 'qwen', model: 'qwen3.8-max', credentialed: false }],
  });
  const r = await cli(root, ['preflight', '--stage', 'plan', '--critics', 'codex,glm', '--skip-auth-check', '--json'], null, 180_000);
  const out = JSON.parse(r.stdout) as { ok: boolean; checks: { name: string; detail: string }[] };
  assert.equal(out.ok, false, '凭据未配却放行，用户会在跑到一半时才发现');
  const readonly = out.checks.find((c) => c.name === '只读能力可用');
  assert.match(readonly!.detail, /凭据/, '要说清缺的是什么');
  assert.match(readonly!.detail, /model_providers/, '要给出可粘贴的落点');
});

test('review --start：非默认侧的非法 slug 必须被拦（第五处回落的锁例）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * r9 双审 AGY-04：`checkModelSlugs` 曾在 `sides` 解析**之前**被调用且不传第四个参数，
   * 于是第四个参数落到缺省集合——`--critics codex --model-codex <非法>` 完全不被校验，
   * 非法 slug 漏到运行中段才以业务失败暴露（白烧配额）。
   *
   * 这条必须走真实子进程：单测直调 `checkModelSlugs` 传什么参数都对，
   * 守不住「调用点传没传、排在 sides 前面还是后面」。
   */
  await seedProbes();
  const r = await cli(
    root,
    ['review', '--start', '--entry', 'C', '--stage', 'code', '--topic', TOPIC,
     '--focus', 'x', '--critics', 'codex', '--model-codex', 'no-such-model-9.9', '--json'],
    null, 180_000,
  );
  assert.equal(r.code, EXIT.USAGE, `非法 slug 应退 64，实得 ${r.code}`);
  assert.match(r.stdout + r.stderr, /no-such-model-9\.9/, '要点名是哪个 slug');
});

test('preflight：未入选侧的版本漂移只提示，不让本次运行失败', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * r9 双审 GLM-08：`checkCliVersions` 遍历全部已探 CLI 且一律判失败，
   * 而 `doctor` 默认会探测四家——于是 codex 自升级后，默认两侧的运行也被它拦下，
   * 与 runPreflight 自述的「按入选侧检查」原则打架。
   */
  await seedProbes({ version: '0.0.1-drifted' }); // 探针记的版本与假 CLI 实际输出不符
  const r = await cli(root, ['preflight', '--stage', 'plan', '--skip-auth-check', '--json'], null, 180_000);
  const out = JSON.parse(r.stdout) as { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };
  assert.equal(out.ok, true, '没选 codex 的运行不该因它的版本漂移而失败');
  const drift = out.checks.find((c) => c.detail.includes('仅提示'));
  assert.ok(drift, '漂移本身仍要说出来（有排查价值），只是不计失败');
});

test('preflight --json：warnings 键恒在，warn 项在 checks[] 里带 warn 并逐条进 warnings（EV-123）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * skill 一律走 `--json`，人读渲染在那条路上根本不被调用——本题真正承重的只有 `cli.ts`
   * 那段**手写**的 JSON 映射。漏加 `warnings` 时 skill 的转述句静默不触发（r1 双审 CODEX-04）。
   * `--skip-auth-check` 让「探活 已跳过」那条 warn 必然出现：映射断了这里就红。
   */
  await seedProbes();
  const r = await cli(root, ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'], null, 180_000);
  const out = JSON.parse(r.stdout) as {
    ok: boolean;
    checks: { name: string; ok: boolean; warn?: boolean; detail: string }[];
    warnings?: { name: string; detail: string }[];
  };
  assert.ok(Array.isArray(out.warnings), `warnings 键必须恒在：\n${r.stdout}`);
  assert.equal(out.ok, true, `本用例要走到探活那一步：\n${r.stdout}`);
  const skipped = out.checks.find((c) => c.name === '探活');
  assert.equal(skipped?.warn, true, '「探活 已跳过」在 checks[] 里必须带 warn');
  assert.ok(out.warnings!.some((w) => w.name === '探活'), '并且进 warnings');
  assert.deepEqual(
    out.warnings,
    out.checks.filter((c) => c.warn).map((c) => ({ name: c.name, detail: c.detail })),
  );
  for (const c of out.checks.filter((x) => !x.warn)) assert.equal('warn' in c, false, `「${c.name}」不该带 warn 键`);
});
