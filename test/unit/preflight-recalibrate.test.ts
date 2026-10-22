/**
 * EV-251：预检失败项的机读校准字段与汇总（预检失败自动校准计划 r2 D1 / D2 / D5；第三节 U2 / U3 / U4）。
 *
 * 零配额：`skipAuthCheck`，入口一律指向不存在的路径或本进程的 node（只判「在不在」、不调）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildRecalibration, recalTargets, runPreflight, type CheckResult } from '../../src/trivium/preflight.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { realAdapters } from '../../src/trivium/adapters/index.js';
import { ALL_CLI_NAMES } from '../../src/trivium/agents/registry.js';
import { DEADLINE_MAX_S, DEADLINE_MIN_S, doctorToolTimeoutMs } from '../../src/trivium/doctor-deadline.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { bashTimeoutFor } from '../../src/trivium/run-protocol.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Config, CriticId, Ctx, Stage, StageModel, TierEntry, TierName } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';

isolateEntryScanHome();

type Agents = Record<string, Record<string, unknown>>;

function setTiers(c: Config, id: string, tiers: Partial<Record<TierName, TierEntry>>, def?: TierName): void {
  const a = (c.agents as unknown as Agents)[id]!;
  a['tiers'] = tiers;
  if (def) a['default_tier'] = def;
}
function setCell(c: Config, id: string, stage: Stage, v: StageModel | undefined): void {
  const row = ((c.profiles[c.active_profile] as Record<string, Record<string, unknown>>)[id] ??= {});
  if (v === undefined) delete row[stage];
  else row[stage] = v;
}

/** 与 preflight.test 的 freshProbe 同形：四家结论新鲜、两家只读能力齐备 */
function freshProbe(cfg: Config): void {
  const now = new Date().toISOString();
  cfg.probe.generated_at = now;
  const agy = cfg.probe.cli.agy!;
  Object.assign(agy, {
    entrypoint: process.execPath, version: '1.2.0', probed_at: now,
    models: ['gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low'],
    headless_read_ok: true, agent: 'trivium-critic',
  });
  const zcode = cfg.probe.cli.zcode!;
  Object.assign(zcode, {
    entrypoint: process.execPath, version: '0.16.5', probed_at: now,
    models: ['GLM-5.3', 'GLM-5.3-Flash', 'bigmodel/GLM-5.3', 'bigmodel/GLM-5.3-Flash'],
    model_id_form: 'bigmodel/GLM-5.3', readonly_flags: ['--mode plan', '--disallowed-tools Write,Edit'],
    response_field: '.response',
  });
}

async function ctxOf(mutate?: (c: Config) => void): Promise<Ctx> {
  const root = await scratchDir('trivium-recal-');
  await fs.writeFile(path.join(root, 'x.ts'), 'export const x = 1;\n');
  await initFixtureRepo(root);
  const cfg = defaultConfig();
  freshProbe(cfg);
  mutate?.(cfg);
  return { config: cfg, projectRoot: root, archiveRoot: path.join(root, '.reviews'), triviumDir: path.join(root, '.trivium'), sources: ['<test>'] };
}

const failedOf = (checks: readonly CheckResult[]): CheckResult => checks.find((c) => !c.ok)!;

// ── U2 目标展开（计划三审 CODEX-04 / CODEX-05） ──

test('U2 不读覆盖的段只给 --only：agy / zcode 的探测用固定口径', () => {
  const c = defaultConfig();
  assert.deepEqual(recalTargets(c, 'gemini', { scope: 'all' }), [{ only: 'agy', flags: [] }]);
  assert.deepEqual(recalTargets(c, 'glm', { scope: 'all', modelOverrides: { glm: 'GLM-5.3-Flash' } }), [{ only: 'zcode', flags: [] }]);
});

test('U2 读覆盖的段给全组合：stage all 下 plan / code 两条路线、各带自己的模型与思考等级，显式原生带 --native', () => {
  const c = defaultConfig();
  setTiers(c, 'codex', {
    low: { model: 'native-m', profile: null },
    high: { model: 'deepseek-v4-pro', effort: 'max', profile: 'deepseek' },
  });
  setCell(c, 'codex', 'plan', { tier: 'high' });
  setCell(c, 'codex', 'code', { tier: 'low' });
  setCell(c, 'codex', 'bug', { tier: 'low' });
  const ts = recalTargets(c, 'codex', { scope: 'all' });
  assert.deepEqual(ts, [
    { only: 'codex', flags: ['--profile-codex', 'deepseek', '--model-codex', 'deepseek-v4-pro', '--effort-codex', 'max'] },
    { only: 'codex', flags: ['--native-codex', '--model-codex', 'native-m'] },
  ], '同侧两个组合是两个目标；bug 与 code 同组合去重');
  // 只看 plan：只剩那一条
  assert.equal(recalTargets(c, 'codex', { scope: 'plan' }).length, 1);
  // 按路线过滤
  assert.deepEqual(recalTargets(c, 'codex', { scope: 'all' }, null), [ts[1]]);
  assert.deepEqual(recalTargets(c, 'codex', { scope: 'all' }, 'deepseek'), [ts[0]]);
});

test('U2 命令行模型覆盖进目标（与预检同一次解析）', () => {
  const c = defaultConfig();
  const [t] = recalTargets(c, 'codex', { scope: 'plan', modelOverrides: { codex: 'qwen3.8-flash' } });
  assert.ok(t);
  const i = t.flags.indexOf('--model-codex');
  assert.equal(t.flags[i + 1], 'qwen3.8-flash');
});

test('U2 探针从未生成：目标是入选各侧，eligible，按 ALL_CLI_NAMES 排序、照抄即可执行的 args', async () => {
  const ctx = await ctxOf((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['glm', 'gemini'] });
  assert.equal(r.exitCode, EXIT.ENV);
  assert.equal(failedOf(r.checks).recalibrate?.fixable, true);
  assert.equal(r.recalibration?.eligible, true);
  assert.deepEqual(r.recalibration?.invocations.map((i) => i.only), ['agy', 'zcode']);
  assert.deepEqual(r.recalibration?.invocations[0]?.args, ['doctor', '--only', 'agy', '--deadline-s', '900', '--json']);
  assert.equal(r.recalibration?.invocations[0]?.bash_timeout_ms, 960_000, '缺省 15 分钟（用户 2026-10-22 定），工具超时加 60 s');
});

test('U2 全部过期：目标只取入选且过期的侧，未入选的过期家不进清单（计划三审 AGY-03 驳回理由的落点）', async () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const ctx = await ctxOf((c) => {
    for (const p of Object.values(c.probe.cli)) if (p) p.probed_at = old;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'] });
  assert.equal(failedOf(r.checks).name, '探针结论未过期');
  assert.deepEqual(r.recalibration?.invocations.map((i) => i.only), ['agy'], '只跑入选的那一家');
});

test('U2 入口不在：可修，目标是该侧', async () => {
  const ctx = await ctxOf((c) => {
    c.probe.cli.agy!.entrypoint = '/nonexistent/agy';
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'] });
  const f = failedOf(r.checks);
  assert.match(f.name, /可调用/);
  assert.deepEqual(f.recalibrate, { fixable: true, targets: [{ only: 'agy', flags: [] }] });
  assert.equal(r.recalibration?.eligible, true);
});

test('U2 不能修的失败项（归档不可写之类）补成 fixable: false，汇总不 eligible 并点名', async () => {
  const ctx = await ctxOf();
  ctx.archiveRoot = '/nonexistent-root-for-trivium-test/.reviews';
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'] });
  const f = failedOf(r.checks);
  assert.equal(f.name, '归档与 git 可用');
  assert.deepEqual(f.recalibrate, { fixable: false });
  assert.equal(r.recalibration?.eligible, false);
  assert.match(r.recalibration!.why, /归档与 git 可用/);
  assert.deepEqual(r.recalibration?.invocations, []);
});

test('U2 预检通过：不出 recalibration', async () => {
  const ctx = await ctxOf();
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini', 'glm'] });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.recalibration, null);
  assert.ok(r.checks.every((c) => c.recalibrate === undefined), '通过项不带 recalibrate');
});

// ── U3 汇总判据 ──

const fail = (name: string, recalibrate?: CheckResult['recalibrate']): CheckResult => ({ name, ok: false, detail: '', exitCode: EXIT.ENV, ...(recalibrate ? { recalibrate } : {}) });

test('U3 全可修 ⇒ eligible，按（only, flags）去重、按 ALL_CLI_NAMES 排序；工具超时按 bashTimeoutFor 推出', () => {
  const p = buildRecalibration({
    ok: false, exitCode: EXIT.ENV, checks: [
      fail('a', { fixable: true, targets: [{ only: 'zcode', flags: [] }, { only: 'codex', flags: ['--native-codex'] }] }),
      fail('b', { fixable: true, targets: [{ only: 'agy', flags: [] }, { only: 'zcode', flags: [] }] }),
    ],
  }, 300)!;
  assert.equal(p.eligible, true);
  const order = ALL_CLI_NAMES.filter((n) => ['agy', 'zcode', 'codex'].includes(n));
  assert.deepEqual(p.invocations.map((i) => i.only), order, '按注册表次序，不按写入序；zcode 只一次');
  assert.deepEqual(p.invocations.find((i) => i.only === 'codex')!.args, ['doctor', '--only', 'codex', '--native-codex', '--deadline-s', '300', '--json']);
  assert.equal(p.invocations[0]!.deadline_s, 300);
  assert.equal(p.invocations[0]!.bash_timeout_ms, 360_000);
  assert.equal(buildRecalibration({ ok: false, exitCode: EXIT.ENV, checks: [fail('a', { fixable: true, targets: [{ only: 'agy', flags: [] }] })] }, 900)!
    .invocations[0]!.bash_timeout_ms, 960_000, '时限上限 900 s 时工具超时 960 s（不再按 --wait 的 600 s 封顶）');
  assert.equal(doctorToolTimeoutMs(5000), 960_000, '封顶在时限上限加余量');
  assert.equal(bashTimeoutFor(900), 600_000, '--wait 的工具超时照旧封顶 600 s，不受影响');
});

test('U3 混入一条不能修（或没标）⇒ 不 eligible，why 点名那一项；退 64 不在范围；通过返回 null；目标为空不 eligible', () => {
  const mixed = buildRecalibration({
    ok: false, exitCode: EXIT.ENV,
    checks: [fail('能修', { fixable: true, targets: [{ only: 'agy', flags: [] }] }), fail('Codex 已认证')],
  }, 480)!;
  assert.equal(mixed.eligible, false);
  assert.match(mixed.why, /「Codex 已认证」不能由 doctor 修复/);
  const usage = buildRecalibration({ ok: false, exitCode: EXIT.USAGE, checks: [fail('模型 slug 合法', { fixable: true, targets: [] })] }, 480)!;
  assert.equal(usage.eligible, false);
  assert.match(usage.why, /64/);
  assert.equal(buildRecalibration({ ok: true, exitCode: EXIT.OK, checks: [] }, 480), null);
  assert.equal(buildRecalibration({ ok: false, exitCode: EXIT.ENV, checks: [fail('x', { fixable: true, targets: [] })] }, 480)!.eligible, false);
});

test('U3‴ 取值范围两处对账：schema 的 minimum / maximum 等于 DEADLINE_MIN_S / DEADLINE_MAX_S，缺省值落在范围内（代码审第 2 轮 GLM-02）', async () => {
  const schema = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'skills/dual-critic/schema/config.v2.json'), 'utf8')) as {
    properties: { preflight: { properties: { recalibrate_deadline_s: { minimum: number; maximum: number } } } };
  };
  const k = schema.properties.preflight.properties.recalibrate_deadline_s;
  assert.equal(k.minimum, DEADLINE_MIN_S, 'schema 下限与 CLI 旗标下限不一致：配置合法而照抄的调用会被 CLI 退 64');
  assert.equal(k.maximum, DEADLINE_MAX_S, 'schema 上限与 CLI 旗标上限不一致：配置合法而照抄的调用会被 CLI 退 64');
  const d = defaultConfig().preflight.recalibrate_deadline_s;
  assert.ok(d >= DEADLINE_MIN_S && d <= DEADLINE_MAX_S, `缺省值 ${d} 不在范围内`);
});

test('U3 配置键 preflight.recalibrate_deadline_s 进 invocations（计划三审 AGY-05）', async () => {
  const ctx = await ctxOf((c) => {
    c.probe.generated_at = null;
    c.preflight.recalibrate_deadline_s = 300;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'] });
  assert.equal(r.recalibration?.invocations[0]?.deadline_s, 300);
  assert.equal(r.recalibration?.invocations[0]?.bash_timeout_ms, 360_000);
  assert.ok(r.recalibration?.invocations[0]?.args.includes('300'));
});

// ── U4 适配器 availability() 的 fix 标注与只读能力一格的聚合 ──

test('U4 四个适配器：「没探过 / 没找到入口 / 读取能力没跑完」标 doctor，实测否定与配置问题不标', () => {
  const a = realAdapters();
  const ctxFor = (mut: (c: Config) => void) => {
    const cfg = defaultConfig();
    freshProbe(cfg);
    mut(cfg);
    return { cfg, nodePath: process.execPath };
  };
  const cases: Array<[CriticId, (c: Config) => void, 'doctor' | undefined]> = [
    ['gemini', (c) => { c.probe.cli.agy!.probed_at = null; }, 'doctor'],
    ['gemini', (c) => { c.probe.cli.agy!.entrypoint = null; }, 'doctor'],
    ['gemini', (c) => { c.probe.cli.agy!.headless_read_ok = null; }, 'doctor'],
    ['gemini', (c) => { c.probe.cli.agy!.headless_read_ok = false; }, undefined],
    ['glm', (c) => { c.probe.cli.zcode!.probed_at = null; }, 'doctor'],
    ['glm', (c) => { c.probe.cli.zcode!.entrypoint = null; }, 'doctor'],
    ['glm', (c) => { c.probe.cli.zcode!.readonly_flags = []; }, undefined],
    ['glm', (c) => { c.probe.cli.zcode!.response_field = null; }, undefined],
    ['codex', (c) => { c.probe.cli.codex!.probed_at = null; }, 'doctor'],
    ['claude', (c) => { c.probe.cli.claude!.probed_at = null; }, 'doctor'],
  ];
  for (const [id, mut, want] of cases) {
    // 传一条原生路线：claude 按路线逐条判，传空数组等于一条都不判
    const v = a[id]!.availability(ctxFor(mut), { vendorProfiles: [null] });
    assert.equal(v.ok, false, `${id} ${mut.toString()}`);
    assert.equal(v.fix, want, `${id} ${mut.toString()}：${v.reason}`);
  }
  // codex 只读旗标为空（可能是沙箱失守）：不标
  const codexEmpty = a['codex']!.availability(ctxFor((c) => {
    Object.assign(c.probe.cli.codex!, { probed_at: new Date().toISOString(), entrypoint: process.execPath, readonly_flags: [] });
  }), { vendorProfiles: [null] });
  assert.equal(codexEmpty.ok, false);
  assert.equal(codexEmpty.fix, undefined);
});

test('U4 只读能力一格：每个不可用侧都可修才可修（目标为这几侧）；一侧可修一侧失守 ⇒ 整项不可修（计划三审 AGY-04）', async () => {
  const both = await ctxOf((c) => {
    c.probe.cli.agy!.headless_read_ok = null;
  });
  const r1 = await runPreflight({ ctx: both, scope: 'plan', skipAuthCheck: true, critics: ['gemini', 'glm'] });
  const f1 = failedOf(r1.checks);
  assert.equal(f1.name, '只读能力可用');
  assert.deepEqual(f1.recalibrate, { fixable: true, targets: [{ only: 'agy', flags: [] }] });

  const mixed = await ctxOf((c) => {
    c.probe.cli.agy!.headless_read_ok = null;
    c.probe.cli.zcode!.readonly_flags = [];
  });
  const r2 = await runPreflight({ ctx: mixed, scope: 'plan', skipAuthCheck: true, critics: ['gemini', 'glm'] });
  const f2 = failedOf(r2.checks);
  assert.equal(f2.name, '只读能力可用');
  assert.deepEqual(f2.recalibrate, { fixable: false });
  assert.equal(r2.recalibration?.eligible, false);
});
