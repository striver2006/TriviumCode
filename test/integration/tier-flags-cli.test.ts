/**
 * 档位命令行旗标的端到端（M11 第 5 步，设计 7.1「档位旗标」；计划 r2 §3.1）。
 *
 * 走真实打包产物：`topic resolve` 的输出字段、写了不给值的空值格（计划三审 AGY-02）、
 * 以及「resolve 输出照抄进 preflight 与 `review --start`」——三处同一组值时预检通过、`--start` 能启动、
 * 请求模型真的取自所选的档，且两处都念出留痕空窗告警（用户 2026-10-08 定 ②）。
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

test('T3 resolve 输出照抄进 preflight：通过，并念出留痕空窗告警', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await seedFakeProbes(fx.root);
  await withGeminiTier(fx.root, 'gemini-3.8-flash-high');
  const { json } = await resolve(fx.root, ['--critics', 'gemini', '--tier-gemini', 'low']);
  assert.ok(json, '前提：resolve 通过');
  const r = await cli(fx.root, ['preflight', '--stage', 'plan', ...relay(json!), '--skip-auth-check', '--json'], null, 180_000);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const js = parse<{ ok: boolean; warnings: Warning[] }>(r.stdout);
  assert.ok(js.warnings.some((w) => /本轮档位名与来源尚未入档.*--tier-gemini low/.test(w.detail)), JSON.stringify(js.warnings));
});

/*
 * worker 从交接文件读到档位旗标（计划 r2 §2.4）：选一个与当轮 Driver 同族的档位模型，跑完核 run.json 的
 * override_reason 认得 `--tier-gemini`——不认就会归因成「档位表默认模型」，把命令行的选择记到配置头上。
 * 旧形状交接文件（不带 tierFlags）由其余全部 worker 用例覆盖：没写档位旗标时交接文件不含这个键。
 */
test('T5 --tier 选出的同族模型：override_reason 认得 --tier（worker 经交接文件拿到档位旗标）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await withGeminiTier(fx.root, 'claude-tier-x');
  const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--critics', 'gemini,glm', '--tier-gemini', 'low', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const runId = parse<{ run_id: string }>(r.stdout).run_id;
  let code: number = EXIT.FAIL;
  for (let i = 0; i < 10; i++) {
    code = (await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000)).code ?? EXIT.FAIL;
    if (code !== 73) break;
  }
  assert.equal(code, EXIT.OK, `运行没有正常结束（退 ${code}）`);
  const meta = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), 'utf8')) as {
    critics: Record<string, { heterogeneous?: boolean; override_reason?: string | null }>;
  };
  assert.equal(meta.critics['gemini']?.heterogeneous, false, '前提：档位模型与当轮 Driver 同族');
  assert.match(meta.critics['gemini']?.override_reason ?? '', /用户经 --tier-gemini low 选出了与当轮 Driver（.+）同族的模型/);
});

test('T4 resolve 输出照抄进 review --start：能启动、请求模型取自所选的档、warnings 念出留痕空窗', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await withGeminiTier(fx.root, 'g-tier-low');
  const { json } = await resolve(fx.root, ['--tier-gemini', 'low']);
  assert.ok(json, '前提：resolve 通过');
  const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', ...relay(json!), '--json'], STUB);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const js = parse<{ run_id: string; models: Record<string, string>; warnings: Warning[] }>(r.stdout);
  try {
    assert.equal(js.models['gemini'], 'g-tier-low', '--tier-gemini low 选出的模型要真的进请求');
    assert.ok(js.warnings.some((w) => /本轮档位名与来源尚未入档.*--tier-gemini low/.test(w.detail)), JSON.stringify(js.warnings));
  } finally {
    await cli(fx.root, ['review', '--cancel', js.run_id], STUB);
  }
});
