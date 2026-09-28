/**
 * EV-160：`review.heartbeat_stale_s` 不大于 worker 心跳间隔（30 s）时，预检与 `review --start` 各出一条只警告项「失联阈值」
 * （心跳阈值事前告警计划 r2 §6.2，I1～I6）。
 *
 * 走真实 bundle + 桩（零配额）：`--start` 的警告汇总在 `startRun` 里、`preflight` 的 JSON 映射在 `cli.ts` 里，
 * 进程内调函数验不到这两段接线。
 *
 * 前提写在夹具里而不是断言里（计划双审 r1 CODEX-01、GLM-04）：
 * - 桩不声明 `modelOverrideSource`，所以不会冒出 EV-123 的副本源项——`--start` 的 `warnings` 里只可能有本主题这一项；
 * - 预检格先种一份新鲜探针（假 CLI 用真文件，`helpers/fixture.ts` 的 `seedFakeProbes`，代码双审 r1 CODEX-02 起共用），否则 ① 探针新鲜度先失败，
 *   ④‴ 挂在短路之后根本到不了；一律 `--skip-auth-check`，不探活、不花配额。
 *
 * 2 s 阈值下 worker 很快会被 `--wait` 判失联，所以 `--start` 之后不等，直接 `--cancel` 收尾，再核它的进程已不在。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, seedFakeProbes } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';
import { run } from '../../src/trivium/util/exec.js';

const TOPIC = '心跳阈值告警';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const NAME = '失联阈值';

type Warning = { name: string; detail: string };
type StartJson = { run_id: string; worker_pid?: number; finished_inline?: boolean; warnings?: Warning[] };
type PreflightJson = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string; warn?: boolean }>; warnings: Warning[] };

const staleLine = (s: number): string => `heartbeat_stale_s: ${s}`;
const parse = <T>(stdout: string): T => JSON.parse(extractJsonCandidate(stdout)!.json) as T;

/** 该运行的 worker（argv 带 run_id）已不在；--cancel 之后至多等 15 s */
async function assertWorkerGone(runId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const ps = await run('ps', ['-Ao', 'pid=,command='], { timeoutMs: 10_000 });
    const left = ps.stdout.split('\n').filter((l) => l.includes('review --worker') && l.includes(runId));
    if (left.length === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.fail(`运行 ${runId} 的 worker 在 --cancel 之后仍在`);
}

/** 起一轮 `--start`，拿到输出后立即 `--cancel`，并核 worker 已不在 */
async function startAndCancel(staleS: number, json = true) {
  const fx = await makeFixture({ topic: TOPIC, extraReview: [staleLine(staleS)] });
  const args = ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', ...(json ? ['--json'] : [])];
  const r = await cli(fx.root, args, STUB);
  assert.equal(r.code, EXIT.OK, `--start 失败：\n${r.stdout}\n${r.stderr}`);
  const runId = json ? parse<StartJson>(r.stdout).run_id : /已启动运行 (\S+)（/.exec(r.stdout)![1]!;
  const c = await cli(fx.root, ['review', '--cancel', runId], STUB);
  assert.equal(c.code, EXIT.OK, `--cancel 失败：\n${c.stdout}\n${c.stderr}`);
  await assertWorkerGone(runId);
  return r;
}

async function preflightAt(staleS: number) {
  const fx = await makeFixture({ topic: TOPIC, extraReview: [staleLine(staleS)] });
  await seedFakeProbes(fx.root);
  const r = await cli(fx.root, ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'], null, 180_000);
  return { r, js: parse<PreflightJson>(r.stdout) };
}

test('EV-160 I1：阈值 2 s ⇒ --start 退 0、warnings 恰一项「失联阈值」，worker 照常拉起', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startAndCancel(2);
  const js = parse<StartJson>(r.stdout);
  assert.equal(typeof js.worker_pid, 'number', '只警告、不拦截：worker 照常拉起');
  assert.equal(js.warnings?.length, 1, JSON.stringify(js.warnings));
  const [w] = js.warnings!;
  assert.equal(w!.name, NAME);
  assert.ok(w!.detail.startsWith('⚠️ review.heartbeat_stale_s = 2 s，不大于工作进程的心跳间隔 30 s'), w!.detail);
});

test('EV-160 I2：阈值 120 s ⇒ --start 的 warnings 为空数组（键仍在）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startAndCancel(120);
  assert.deepEqual(parse<StartJson>(r.stdout).warnings, []);
});

test('EV-160 I3：预检 2 s 出「失联阈值」、120 s 不出；去掉这一项后两次的 checks 逐项相同', { skip: bundleMissing && bundleSkipReason }, async () => {
  const low = await preflightAt(2);
  assert.equal(low.r.code, EXIT.OK, `${low.r.stdout}\n${low.r.stderr}`);
  assert.equal(low.js.ok, true, '只警告、不拒跑');
  const item = low.js.checks.find((c) => c.name === NAME);
  assert.ok(item, `2 s 必须出项：${low.js.checks.map((c) => c.name).join('、')}`);
  assert.equal(item!.warn, true, 'checks[] 单项带 warn');
  assert.ok(low.js.warnings.some((w) => w.name === NAME), '并且进 warnings');

  const high = await preflightAt(120);
  assert.equal(high.r.code, EXIT.OK, `${high.r.stdout}\n${high.r.stderr}`);
  assert.equal(high.js.checks.some((c) => c.name === NAME), false, '120 s 不出项');
  const shape = (cs: PreflightJson['checks']) => cs.filter((c) => c.name !== NAME).map((c) => [c.name, c.ok, c.warn ?? false]);
  assert.deepEqual(shape(low.js.checks), shape(high.js.checks), '除这一项外，两次预检的项目与结论相同');
});

test('EV-160 I4：同步 review --stage 不做这项复查——2 s 阈值下输出里没有「失联阈值」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC, extraReview: [staleLine(2)] });
  const r = await cli(fx.root, ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--critics', 'gemini', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, `同步 review 失败：\n${r.stdout}\n${r.stderr}`);
  const all = r.stdout + r.stderr;
  assert.doesNotMatch(all, /失联阈值|不大于工作进程的心跳间隔/, all);
  const js = parse<{ warnings?: unknown[] }>(r.stdout);
  assert.ok(!JSON.stringify(js.warnings ?? []).includes(NAME), JSON.stringify(js.warnings));
});

test('EV-160 I5：人读模式 --start 逐条打印警告行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startAndCancel(2, false);
  assert.match(r.stdout, /^ {2}⚠️ review\.heartbeat_stale_s = 2 s，不大于工作进程的心跳间隔 30 s/m, r.stdout);
});

test('EV-160 I6：2 s 阈值 + 纯文档跳过 ⇒ finished_inline，warnings 仍为空数组（那一支没有 worker 与 --wait）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC, draft: false,
    extraReview: ['skip_doc_only_review: true', staleLine(2)],
  });
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');
  const r = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const js = parse<StartJson>(r.stdout);
  assert.equal(js.finished_inline, true, '前提：走的是 FR-23 跳过分支');
  assert.deepEqual(js.warnings, [], 'finished_inline 支不带阈值项');
});
