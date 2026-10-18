/**
 * 档位命令行旗标的端到端（M11 第 5 步，设计 7.1「档位旗标」；计划 r2 §3.1）。
 *
 * 走真实打包产物：`topic resolve` 的输出字段、写了不给值的空值格（计划三审 AGY-02）、
 * 以及「resolve 输出照抄进 preflight 与 `review --start`」——三处同一组值时预检通过、`--start` 能启动、
 * 请求模型真的取自所选的档。第 5 步时两处都念「留痕空窗」告警（用户 2026-10-08 定 ②）；M11 第 6 步 tier / tier_source
 * 入档后该告警拆除，这里反转为「不念」，并在 T5 核 run.json 里真的记下了档位名与来源。
 * 非法旗标的零工件格在 `no-artifacts.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, seedFakeProbes } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const TOPIC = '档位旗标端到端';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const parse = <T>(stdout: string): T => JSON.parse(extractJsonCandidate(stdout)!.json) as T;
type Warning = { name: string; detail: string };
type Resolved = { tiers: Record<string, string>; efforts: Record<string, string>; vendor_profiles: Record<string, string>; critics: string[] };

/** 给 gemini 配一档 low（只写 model），追加在夹具配置末尾 */
async function withGeminiTier(root: string, model: string): Promise<void> {
  await fs.appendFile(
    path.join(root, '.trivium', 'config.yaml'),
    `agents:\n  gemini:\n    tiers:\n      low: { model: ${model} }\n`,
    'utf8',
  );
}

async function resolve(root: string, extra: string[]) {
  const r = await cli(root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', '做个功能', '--topic', TOPIC, '--focus', 'x', ...extra]);
  return { r, json: r.code === EXIT.OK ? parse<Resolved>(r.stdout) : null };
}

/** 把 resolve 输出照抄成旗标——命令 A 的 S0.6 / S2 / S6 就是这样做的 */
function relay(j: Resolved): string[] {
  return [
    '--critics', j.critics.join(','),
    ...Object.entries(j.tiers).flatMap(([id, v]) => [`--tier-${id}`, v]),
    ...Object.entries(j.efforts).flatMap(([id, v]) => [`--effort-${id}`, v]),
    ...Object.entries(j.vendor_profiles).flatMap(([id, v]) => [`--profile-${id}`, v]),
  ];
}

test('T1 resolve 输出三字段：只含本轮入选侧，没写时为空对象', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const none = await resolve(fx.root, []);
  assert.equal(none.r.code, EXIT.OK, none.r.stdout + none.r.stderr);
  assert.deepEqual([none.json!.tiers, none.json!.efforts, none.json!.vendor_profiles], [{}, {}, {}]);

  const some = await resolve(fx.root, ['--tier-gemini', 'low', '--effort-glm', 'whatever']);
  assert.equal(some.r.code, EXIT.OK, some.r.stdout + some.r.stderr);
  assert.deepEqual(some.json!.tiers, { gemini: 'low' });
  assert.deepEqual(some.json!.efforts, { glm: 'whatever' }, '取值的形状这里只查非空，枚举与过渡闸在预检');
  assert.deepEqual(some.json!.vendor_profiles, {});
});

test('T2 resolve：写了不给值（后面紧跟另一个旗标）⇒ 退 64，不静默丢弃（计划三审 AGY-02）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const r = await cli(fx.root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', '做个功能', '--topic', TOPIC, '--tier-gemini', '--focus', 'x']);
  assert.equal(r.code, EXIT.USAGE, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /--tier-gemini 需要一个值/);
});

test('T3 resolve 输出照抄进 preflight：通过，且不再念留痕空窗告警（M11 第 6 步反转）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await seedFakeProbes(fx.root);
  await withGeminiTier(fx.root, 'gemini-3.8-flash-high');
  const { json } = await resolve(fx.root, ['--critics', 'gemini', '--tier-gemini', 'low']);
  assert.ok(json, '前提：resolve 通过');
  const r = await cli(fx.root, ['preflight', '--stage', 'plan', ...relay(json!), '--skip-auth-check', '--json'], null, 180_000);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const js = parse<{ ok: boolean; warnings: Warning[] }>(r.stdout);
  assert.ok(!js.warnings.some((w) => /尚未入档|M11 第 6 步/.test(w.detail)), JSON.stringify(js.warnings));
});

/*
 * worker 从交接文件读到档位旗标（计划 r2 §2.4）：选一个与当轮 Driver 同族的档位模型，跑完核 run.json 的
 * override_reason 认得 `--tier-gemini`——不认就会归因成「档位表默认模型」，把命令行的选择记到配置头上。
 * 旧形状交接文件（不带 tierFlags）由其余全部 worker 用例覆盖：没写档位旗标时交接文件不含这个键。
 */
test('T5 --tier 与Driver声明跨worker保留，同族按声明与回读判定', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await withGeminiTier(fx.root, 'claude-tier-x');
  const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--critics', 'gemini,glm', '--tier-gemini', 'low', '--driver-model', 'claude-4.5', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const runId = parse<{ run_id: string }>(r.stdout).run_id;
  let code: number = EXIT.FAIL;
  for (let i = 0; i < 10; i++) {
    code = (await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000)).code ?? EXIT.FAIL;
    if (code !== 73) break;
  }
  assert.equal(code, EXIT.OK, `运行没有正常结束（退 ${code}）`);
  const meta = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), 'utf8')) as {
    profile?: string;
    critics: Record<string, { heterogeneous?: string; override_reason?: string | null; tier?: string | null; tier_source?: string | null }>;
  };
  assert.equal(meta.critics['gemini']?.heterogeneous, 'same-family', '前提：回读模型与 Driver 声明同族');
  assert.match(meta.critics['gemini']?.override_reason ?? '', /claude/);
  // M11 第 6 步：留痕空窗补上——档位名与来源入档；没选档的一侧照实记裸 slug 的 legacy
  assert.equal(meta.critics['gemini']?.tier, 'low');
  assert.equal(meta.critics['gemini']?.tier_source, 'cli');
  assert.equal(meta.critics['glm']?.tier, null);
  assert.equal(meta.critics['glm']?.tier_source, 'legacy');
  assert.equal(meta.profile, 'default', '顶层记本轮档位表名');
});

test('T4 resolve 输出照抄进 review --start：能启动、请求模型取自所选的档、warnings 不再念留痕空窗（M11 第 6 步反转）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await withGeminiTier(fx.root, 'g-tier-low');
  const { json } = await resolve(fx.root, ['--tier-gemini', 'low']);
  assert.ok(json, '前提：resolve 通过');
  const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', ...relay(json!), '--json'], STUB);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const js = parse<{ run_id: string; models: Record<string, string>; warnings: Warning[] }>(r.stdout);
  try {
    assert.equal(js.models['gemini'], 'g-tier-low', '--tier-gemini low 选出的模型要真的进请求');
    assert.ok(!js.warnings.some((w) => /尚未入档|M11 第 6 步/.test(w.detail)), JSON.stringify(js.warnings));
  } finally {
    await cli(fx.root, ['review', '--cancel', js.run_id], STUB);
  }
});

/*
 * **EV-228（M12 批次 4）：`--model-〈id〉` 写了不给值，四个入口都退 64**。
 * `topic resolve` 三种形态（`=` 空、紧跟已知旗标、位于末尾）此前静默丢弃；`review` / `preflight` / `doctor`
 * 此前只有 `=` 空一种被静默丢弃（另两种 `flagString` 早已退 64，文案不变）。同一入口内与档位旗标逐字同源。
 */
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

test('T6 resolve：--model-glm 三种空值形态都退 64，文案与 --tier-glm 同形态同源', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const forms: [string, string[]][] = [['=', []], ['', ['--critics', 'gemini,glm']], ['', []]];
  for (const [suffix, rest] of forms) {
    const model = await resolve(fx.root, [`--model-glm${suffix}`, ...rest]);
    assert.equal(model.r.code, EXIT.USAGE, out(model.r));
    assert.match(out(model.r), /--model-glm 需要一个值，但没有给出。/);
    const tier = await resolve(fx.root, [`--tier-glm${suffix}`, ...rest]);
    assert.equal(tier.r.code, EXIT.USAGE, out(tier.r));
    assert.match(out(tier.r), /--tier-glm 需要一个值，但没有给出。/, '同形态的档位旗标同一条文案');
  }
});

test('T7 preflight：--model-glm= 退 64、与 --tier-glm= 同文案；紧跟旗标仍是 flagString 的文案（不变）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const model = await cli(fx.root, ['preflight', '--stage', 'plan', '--model-glm=', '--json']);
  assert.equal(model.code, EXIT.USAGE, out(model));
  assert.match(out(model), /--model-glm 需要一个值，但没有给出。/);
  const tier = await cli(fx.root, ['preflight', '--stage', 'plan', '--tier-glm=', '--json']);
  assert.equal(tier.code, EXIT.USAGE, out(tier));
  assert.match(out(tier), /--tier-glm 需要一个值，但没有给出。/);
  const followed = await cli(fx.root, ['preflight', '--stage', 'plan', '--model-glm', '--json']);
  assert.equal(followed.code, EXIT.USAGE, out(followed));
  assert.match(out(followed), /--model-glm 需要一个值，但它后面跟的是另一个旗标（或什么都没有）/);
});

test('T8 doctor 与 review --start：--model-glm= 退 64（doctor 只跑环境段、不调模型；--start 不起运行）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const doc = await cli(fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--model-glm=', '--json']);
  assert.equal(doc.code, EXIT.USAGE, out(doc));
  assert.match(out(doc), /--model-glm 需要一个值，但没有给出。/);
  const start = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--model-glm=', '--json'], STUB);
  assert.equal(start.code, EXIT.USAGE, out(start));
  assert.match(out(start), /--model-glm 需要一个值，但没有给出。/);
  const metaDir = path.join(fx.stageDir, '_meta');
  const runs = (await fs.readdir(metaDir).catch(() => [] as string[])).filter((n) => n.startsWith('run-'));
  assert.deepEqual(runs, [], '退 64 在冻结之前，不留运行记录');
});

test('T9 doctor：写给 doctor 不消费的家的覆盖 ⇒ 退 0、JSON 顶层键集合不变、warnings 恰多末尾一条提示；人读模式同样出现（EV-245）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const base = ['doctor', '--only', 'env', '--no-model-calls'];
  const flags = ['--model-gemini', 'x', '--tier-glm', 'high', '--effort-glm', 'high'];
  const plain = await cli(fx.root, [...base, '--json']);
  const hinted = await cli(fx.root, [...base, ...flags, '--json']);
  assert.equal(plain.code, EXIT.OK, out(plain));
  assert.equal(hinted.code, EXIT.OK, out(hinted));
  type DoctorJson = { ok: boolean; warnings: string[]; blockers: string[] } & Record<string, unknown>;
  const p = parse<DoctorJson>(plain.stdout);
  const h = parse<DoctorJson>(hinted.stdout);
  // 不写死键数：directoryEvidence 只在跑过 Claude 目录探针时出现（计划双审 GLM-01）
  assert.deepEqual(Object.keys(h).sort(), Object.keys(p).sort(), '--json 顶层字段不变');
  assert.equal(h.ok, p.ok);
  assert.deepEqual(h.blockers, p.blockers);
  assert.deepEqual(h.warnings.slice(0, -1), p.warnings, '其余告警逐项不变');
  const hint = h.warnings.at(-1)!;
  assert.ok(hint.startsWith('以下命令行覆盖本次没有用上'), hint);
  assert.match(hint, /--model-gemini、--tier-glm、--effort-glm：本次 --only env/);

  const human = await cli(fx.root, [...base, ...flags]);
  assert.equal(human.code, EXIT.OK, out(human));
  assert.match(out(human), /以下命令行覆盖本次没有用上/);
  assert.doesNotMatch(out(await cli(fx.root, base)), /以下命令行覆盖本次没有用上/);
});
