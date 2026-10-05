/**
 * 计划定稿强制产出 · 调用链（EV-214，计划 r2 §3.2）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。桩两侧各出一条意见（AGY-01、GLM-01）。
 * 覆盖：新运行写标记、`gate --check` 两种失败与通过、命令 B 的审批前复核（`approve` 与 `--await-approval`）、
 * 第二轮取对轮次且回看第 1 轮不转红、旧运行（无标记）只告警、非缺省执笔方、复审未修订原稿。
 * 纯函数一层在 `test/unit/plan-final-gate.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today, type Fixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

type CheckJson = {
  ok: boolean;
  failures: { code: string; message: string; ids?: string[] }[];
  warnings: { code: string; message: string; ids?: string[] }[];
};

async function runPlan(fx: Fixture, entry: 'A' | 'B', extra: string[] = []): Promise<string> {
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', entry, ...extra, '--json'],
    STUB,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], STUB, 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${js.run_id} 没有成功收尾（退 ${code}）`);
  // 桩指纹只可能由执行适配器的进程写入：这是子进程真的用了桩的直接证据（代码双审 GLM-01）
  const meta = JSON.parse(
    await fs.readFile(path.join(fx.archiveRoot, fx.topic, 'plan', '_meta', `run-${js.run_id}.json`), 'utf8'),
  ) as { critics: Record<string, { cli_version?: string }> };
  for (const side of ['gemini', 'glm']) {
    assert.equal(meta.critics[side]?.cli_version, 'stub/0.0.0', `${side} 侧必须走桩`);
  }
  return js.run_id;
}

const planDir = (fx: Fixture) => path.join(fx.archiveRoot, fx.topic, 'plan');
const runJsonPath = (fx: Fixture, runId: string) => path.join(planDir(fx), '_meta', `run-${runId}.json`);

async function runMeta(fx: Fixture, runId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(runJsonPath(fx, runId), 'utf8')) as Record<string, unknown>;
}

/** 裁决件：`accept` 为 true 的编号判接受，其余驳回 */
async function writeDisposition(
  fx: Fixture, runId: string, o: { r?: number; accept: string[]; driver?: string },
): Promise<void> {
  const driver = o.driver ?? 'claude';
  const r = o.r ?? 1;
  const seg = r > 1 ? `r${r}-` : '';
  const row = (id: string, src: string) => o.accept.includes(id)
    ? `| ${id} | ${src} | blocker | 接受 | 确实漏了这一处，需要补 | 新一轮计划 §1 |`
    : `| ${id} | ${src} | blocker | 驳回 | 该分支上游已拒绝，证据见 src/a.ts | 不改 |`;
  await fs.writeFile(
    path.join(planDir(fx), `${today()}-${fx.topic}-${seg}revised-${driver}.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, 'stage: plan',
      `role: ${driver}`, 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${fx.topic}-${seg}gemini.md`, `  - ${today()}-${fx.topic}-${seg}glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      row('AGY-01', 'gemini'),
      row('GLM-01', 'glm'),
      '',
    ].join('\n'),
    'utf8',
  );
}

async function writePlan(fx: Fixture, r: number, ids: string[], driver = 'claude'): Promise<string> {
  const name = `${today()}-${fx.topic}-r${r}-${driver}.md`;
  await fs.writeFile(
    path.join(planDir(fx), name),
    ['# 计划 r' + r, '', '相对上一轮的改动：', ...ids.map((id) => `- ${id}：按建议补上`), ''].join('\n'),
    'utf8',
  );
  return name;
}

async function check(fx: Fixture, extra: string[] = []): Promise<{ code: number | null; js: CheckJson; raw: string }> {
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', ...extra, '--json']);
  const raw = `${r.stdout}${r.stderr}`;
  return { code: r.code, js: JSON.parse(extractJsonCandidate(r.stdout)!.json) as CheckJson, raw };
}

const failure = (js: CheckJson, code: string) => js.failures.find((f) => f.code === code);

test('I1 · 命令 A 新运行写标记；有接受项、没有新一轮计划 → missing_next_plan 并给出应写文件名', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i1' });
  const runId = await runPlan(fx, 'A');
  assert.deepEqual((await runMeta(fx, runId))['plan_final_check'], { subject_rerun_index: 1 });
  await writeDisposition(fx, runId, { accept: ['AGY-01', 'GLM-01'] });
  const c = await check(fx);
  assert.notEqual(c.code, EXIT.OK, c.raw);
  const f = failure(c.js, 'missing_next_plan');
  assert.ok(f, c.raw);
  assert.ok(f.message.includes(`${today()}-${fx.topic}-r2-claude.md`), f.message);
  assert.deepEqual(f.ids, ['AGY-01', 'GLM-01']);
});

test('I2 · 新一轮计划漏一条 → next_plan_missing_ids；补齐后通过', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i2' });
  const runId = await runPlan(fx, 'A');
  await writeDisposition(fx, runId, { accept: ['AGY-01', 'GLM-01'] });
  await writePlan(fx, 2, ['AGY-01']);
  const c1 = await check(fx);
  assert.notEqual(c1.code, EXIT.OK, c1.raw);
  assert.deepEqual(failure(c1.js, 'next_plan_missing_ids')?.ids, ['GLM-01'], c1.raw);
  await writePlan(fx, 2, ['AGY-01', 'GLM-01']);
  const c2 = await check(fx);
  assert.equal(c2.code, EXIT.OK, c2.raw);
  assert.equal(c2.js.ok, true);
});

test('I3 · 命令 B：通过后立停点，新一轮计划被挪走 → approve 与 --await-approval 的复核都拦下', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i3' });
  const runId = await runPlan(fx, 'B');
  await writeDisposition(fx, runId, { accept: ['AGY-01'] });
  const name = await writePlan(fx, 2, ['AGY-01']);
  const c = await check(fx);
  assert.equal(c.code, EXIT.OK, c.raw);
  const state = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(state.gates[`${fx.topic}/plan`]?.state, 'awaiting_approval');

  await fs.rename(path.join(planDir(fx), name), path.join(fx.root, name));
  const ap = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan']);
  assert.notEqual(ap.code, EXIT.OK, `${ap.stdout}${ap.stderr}`);
  assert.match(`${ap.stdout}${ap.stderr}`, /missing_next_plan/);
  const aw = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--await-approval']);
  assert.equal(aw.code, EXIT.GATE_BLOCK, `${aw.stdout}${aw.stderr}`);
  assert.match(`${aw.stdout}${aw.stderr}`, /missing_next_plan/);

  // 放回去之后审批放行：复核拦的正是这一格，不是别的
  await fs.rename(path.join(fx.root, name), path.join(planDir(fx), name));
  const ok = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan']);
  assert.equal(ok.code, EXIT.OK, `${ok.stdout}${ok.stderr}`);
});

test('I4 · 第二轮：被审对象是 r2、要求 r3；用 --run-id 回看第 1 轮仍通过（已被接手，核 r2）', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i4' });
  const run1 = await runPlan(fx, 'A');
  await writeDisposition(fx, run1, { accept: ['AGY-01', 'GLM-01'] });
  await writePlan(fx, 2, ['AGY-01', 'GLM-01']);
  assert.equal((await check(fx)).code, EXIT.OK);

  const run2 = await runPlan(fx, 'A');
  const m2 = await runMeta(fx, run2);
  assert.equal(m2['rerun_index'], 2);
  assert.deepEqual(m2['plan_final_check'], { subject_rerun_index: 2 });
  await writeDisposition(fx, run2, { r: 2, accept: ['AGY-01'] });
  const c1 = await check(fx);
  const f = failure(c1.js, 'missing_next_plan');
  assert.ok(f, c1.raw);
  assert.ok(f.message.includes(`-r3-claude.md`), f.message);

  // 第 1 轮已被第 2 轮接手：核紧随它的 r2（齐全），不核定稿——回看不转红
  await writePlan(fx, 3, ['AGY-01']);
  const back = await check(fx, ['--run-id', run1]);
  assert.equal(back.code, EXIT.OK, back.raw);
  assert.equal((await check(fx)).code, EXIT.OK);
});

test('I5 · 旧运行（run.json 没有标记）有接受项、没有新一轮计划 → 通过并出 next_plan_unchecked', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i5' });
  const runId = await runPlan(fx, 'A');
  const meta = await runMeta(fx, runId);
  delete meta['plan_final_check'];
  await fs.writeFile(runJsonPath(fx, runId), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await writeDisposition(fx, runId, { accept: ['AGY-01'] });
  const c = await check(fx);
  assert.equal(c.code, EXIT.OK, c.raw);
  assert.deepEqual(c.js.warnings.find((w) => w.code === 'next_plan_unchecked')?.ids, ['AGY-01'], c.raw);
});

test('I6 · 非缺省执笔方 codex：应写名为 -r2-codex.md，别家后缀的 r2 不算', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i6', draft: false });
  await fs.mkdir(planDir(fx), { recursive: true });
  await fs.writeFile(path.join(planDir(fx), `${today()}-${fx.topic}-codex.md`), '# codex 执笔的原稿\n', 'utf8');
  const claim = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', 'plan', '--driver', 'codex', '--json']);
  assert.equal(claim.code, EXIT.OK, claim.stderr);
  const runId = await runPlan(fx, 'A', ['--driver', 'codex', '--critics', 'gemini,glm']);
  assert.deepEqual((await runMeta(fx, runId))['plan_final_check'], { subject_rerun_index: 1 });
  await writeDisposition(fx, runId, { accept: ['AGY-01'], driver: 'codex' });
  await writePlan(fx, 2, ['AGY-01'], 'claude');
  const c1 = await check(fx);
  const f = failure(c1.js, 'missing_next_plan');
  assert.ok(f, c1.raw);
  assert.ok(f.message.includes(`${today()}-${fx.topic}-r2-codex.md`), f.message);
  await writePlan(fx, 2, ['AGY-01'], 'codex');
  assert.equal((await check(fx)).code, EXIT.OK);
});

test('I7 · 第 1 轮全部驳回、不写 r2；复审未修订原稿（rerun_index 2、被审对象 r1）有接受 → 要求 r2', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfg-i7' });
  const run1 = await runPlan(fx, 'A');
  await writeDisposition(fx, run1, { accept: [] });
  assert.equal((await check(fx)).code, EXIT.OK);

  const run2 = await runPlan(fx, 'A');
  const m2 = await runMeta(fx, run2);
  assert.equal(m2['rerun_index'], 2);
  assert.deepEqual(m2['plan_final_check'], { subject_rerun_index: 1 });
  await writeDisposition(fx, run2, { r: 2, accept: ['GLM-01'] });
  const c1 = await check(fx);
  const f = failure(c1.js, 'missing_next_plan');
  assert.ok(f, c1.raw);
  assert.ok(f.message.includes(`${today()}-${fx.topic}-r2-claude.md`), f.message);
  await writePlan(fx, 2, ['GLM-01']);
  assert.equal((await check(fx)).code, EXIT.OK);
});
