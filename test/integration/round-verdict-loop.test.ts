/**
 * 整体三态判定与多轮评审循环 · 集成（2026-10-22 特性）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额），verdict 由桩注入（`StubSpec.verdict`）。
 * 覆盖：A 入口「fail 未用尽回 idle → 第二轮 pass」的多轮循环、`round_verdict` 输出与
 * task.json 留痕、轮次用尽的人工审批停点（含 A 入口——PRD 4.4 修订后的新停点）、
 * 超上限重发的机械拦截、零接受项 + 判定非 pass 的 next-plan 强化（端到端）、
 * B 入口 fail 未用尽不立停点的行为变化。纯函数层见 test/unit/round-verdict.test.ts。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today, type Fixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig, StubSpec } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;

type CheckJson = {
  ok: boolean;
  round_verdict: null | {
    decision: 'pass' | 'pass_after_changes' | 'fail';
    round: number;
    limit: number;
    effective_sides: number;
    tallies: { approve: number; approve_after_changes: number; reject: number };
  };
  failures: { code: string; message: string }[];
};

const both = (v: StubSpec['verdict']): StubConfig => ({ gemini: { mode: 'ok', verdict: v }, glm: { mode: 'ok', verdict: v } });

const planDir = (fx: Fixture) => path.join(fx.archiveRoot, fx.topic, 'plan');

async function runPlan(fx: Fixture, entry: 'A' | 'B', stub: StubConfig, extra: string[] = []): Promise<string> {
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', entry, ...extra, '--json'],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub, 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${js.run_id} 没有成功收尾（退 ${code}）`);
  return js.run_id;
}

/** 裁决件：`accept` 里的编号判接受，其余驳回；`r` 是本轮轮次（决定文件名的 -rN 段） */
async function writeDisposition(fx: Fixture, runId: string, r: number, accept: string[]): Promise<void> {
  const seg = r > 1 ? `r${r}-` : '';
  const row = (id: string, src: string) => accept.includes(id)
    ? `| ${id} | ${src} | blocker | 接受 | 确实漏了这一处，需要补 | 新一轮计划 §1 |`
    : `| ${id} | ${src} | blocker | 驳回 | 上游已有等价处理，证据见 src/a.ts | 不改 |`;
  await fs.writeFile(
    path.join(planDir(fx), `${today()}-${fx.topic}-${seg}revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
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

async function writePlan(fx: Fixture, r: number, ids: string[]): Promise<void> {
  await fs.writeFile(
    path.join(planDir(fx), `${today()}-${fx.topic}-r${r}-claude.md`),
    [`# 计划 r${r}`, '', '相对上一轮的改动：', ...ids.map((id) => `- ${id}：按建议补上`), ''].join('\n'),
    'utf8',
  );
}

async function check(fx: Fixture): Promise<{ code: number | null; js: CheckJson; raw: string }> {
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--json']);
  const raw = `${r.stdout}${r.stderr}`;
  return { code: r.code, js: JSON.parse(extractJsonCandidate(r.stdout)!.json) as CheckJson, raw };
}

async function gateState(fx: Fixture): Promise<string | null> {
  type StateFile = { gates: Record<string, { state: string } | undefined> };
  const s = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as StateFile;
  return s.gates[`${fx.topic}/plan`]?.state ?? null;
}

test('L1 · 命令 A：第 1 轮判 fail（未用尽）回 idle → 修订重审 → 第 2 轮判 pass；round_verdict 与 task.json 留痕', { skip }, async () => {
  const fx = await makeFixture({ topic: 'rvl-a' });

  const run1 = await runPlan(fx, 'A', both('reject'));
  const meta1 = JSON.parse(
    await fs.readFile(path.join(planDir(fx), '_meta', `run-${run1}.json`), 'utf8'),
  ) as { review_rounds: { limit: number; source: string }; rerun_index: number };
  assert.deepEqual(meta1.review_rounds, { limit: 3, source: 'config' }, '缺省回落 config、上限 3');
  assert.equal(meta1.rerun_index, 1);

  await writeDisposition(fx, run1, 1, []); // 全驳回
  await writePlan(fx, 2, []); // 判定非 pass：零接受也要有新一轮计划
  const c1 = await check(fx);
  assert.equal(c1.code, EXIT.OK, c1.raw);
  assert.equal(c1.js.ok, true, c1.raw);
  assert.ok(c1.js.round_verdict, c1.raw);
  assert.equal(c1.js.round_verdict!.decision, 'fail');
  assert.equal(c1.js.round_verdict!.round, 1);
  assert.equal(c1.js.round_verdict!.limit, 3);
  assert.deepEqual(c1.js.round_verdict!.tallies, { approve: 0, approve_after_changes: 0, reject: 2 });
  assert.equal(await gateState(fx), 'idle', 'fail 且轮次未用尽：闸门放行回 idle，给修订重审让路');

  // 修订后的 r2 计划自动成为第 2 轮被审对象；桩换 approve
  const run2 = await runPlan(fx, 'A', both('approve'));
  const meta2 = JSON.parse(
    await fs.readFile(path.join(planDir(fx), '_meta', `run-${run2}.json`), 'utf8'),
  ) as { rerun_index: number };
  assert.equal(meta2.rerun_index, 2, '新轮次自动抬升');
  await writeDisposition(fx, run2, 2, []);
  const c2 = await check(fx);
  assert.equal(c2.code, EXIT.OK, c2.raw);
  assert.equal(c2.js.round_verdict!.decision, 'pass');
  assert.equal(c2.js.round_verdict!.round, 2);
  assert.equal(await gateState(fx), 'idle', 'A 入口判 pass：不设人工闸门（PRD 4.4 常规路径）');

  const task = JSON.parse(await fs.readFile(path.join(planDir(fx), '..', 'task.json'), 'utf8')) as {
    round_verdicts: { run_id: string; decision: string; rerun_index: number }[];
  };
  assert.deepEqual(
    task.round_verdicts.map((x) => [x.run_id, x.decision, x.rerun_index]),
    [[run1, 'fail', 1], [run2, 'pass', 2]],
  );
});

test('L2 · 命令 A：--plan-rounds 1 且判 fail → 轮次用尽，A 入口也立人工审批停点；approve 放行', { skip }, async () => {
  const fx = await makeFixture({ topic: 'rvl-b' });
  const run1 = await runPlan(fx, 'A', both('reject'), ['--plan-rounds', '1']);
  const meta1 = JSON.parse(
    await fs.readFile(path.join(planDir(fx), '_meta', `run-${run1}.json`), 'utf8'),
  ) as { review_rounds: { limit: number; source: string } };
  assert.deepEqual(meta1.review_rounds, { limit: 1, source: 'flag' }, '旗标覆盖记 flag');

  await writeDisposition(fx, run1, 1, []);
  await writePlan(fx, 2, []);
  const c = await check(fx);
  assert.equal(c.code, EXIT.OK, c.raw);
  assert.equal(c.js.round_verdict!.decision, 'fail');
  assert.equal(c.js.round_verdict!.round, 1);
  assert.equal(c.js.round_verdict!.limit, 1);
  assert.equal(await gateState(fx), 'awaiting_approval', '轮次用尽且判 fail：任何 entry 都停下人工审批（含 A）');

  const ap = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan']);
  assert.equal(ap.code, EXIT.OK, `${ap.stdout}${ap.stderr}`);
  assert.equal(await gateState(fx), 'approved', '人工通过＝放行，闸门进 approved');
});

test('L3 · 超上限的重发被机械拦下：预置 r4 审查件 → 默认上限 3 → --start 退 2，显式提高后放行', { skip }, async () => {
  const fx = await makeFixture({ topic: 'rvl-c' });
  // 预置带 -r4 后缀的两侧审查件：resolveRerunIndex 数到 4，下一轮是 5
  for (const side of ['gemini', 'glm']) {
    await fs.writeFile(
      path.join(planDir(fx), `${today()}-${fx.topic}-r4-${side}.md`),
      ['---', 'schema: trivium.review.v2', `topic: ${fx.topic}`, 'stage: plan', `role: ${side}`, '---', '', '历史轮的审查件。', ''].join('\n'),
      'utf8',
    );
  }
  const blocked = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'A', '--json'], both('approve'));
  assert.equal(blocked.code, EXIT.GATE_BLOCK, `${blocked.stdout}${blocked.stderr}`);
  assert.match(`${blocked.stdout}${blocked.stderr}`, /评审轮次已用尽：上限 3 轮，再发将是第 5 轮/);
  assert.match(`${blocked.stdout}${blocked.stderr}`, /--plan-rounds <1~10>/);

  // 逃生门：显式提高上限（旗标覆盖 config 缺省）
  const ok = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'A', '--plan-rounds', '6', '--json'], both('approve'));
  assert.equal(ok.code, EXIT.OK, `${ok.stdout}${ok.stderr}`);
  const js = JSON.parse(extractJsonCandidate(ok.stdout)!.json) as { run_id: string };
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], both('approve'), 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK);
});

test('L4 · 判 fail 且零接受、没写新一轮计划 → gate 报 missing_next_plan（端到端强化）；补上后通过', { skip }, async () => {
  const fx = await makeFixture({ topic: 'rvl-d' });
  const run1 = await runPlan(fx, 'A', both('reject'));
  await writeDisposition(fx, run1, 1, []); // 全驳回，不写 r2
  const c1 = await check(fx);
  assert.notEqual(c1.code, EXIT.OK, c1.raw);
  const f = c1.js.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, c1.raw);
  assert.ok(f.message.includes('即使没有接受项也必须产出新一轮完整计划'), f.message);

  await writePlan(fx, 2, []);
  const c2 = await check(fx);
  assert.equal(c2.code, EXIT.OK, c2.raw);
});

test('L5 · 命令 B：判 fail 且未用尽 → 不立 awaiting_approval（回 idle 重审），判 pass 才立停点', { skip }, async () => {
  const fx = await makeFixture({ topic: 'rvl-e' });

  const run1 = await runPlan(fx, 'B', both('reject'));
  await writeDisposition(fx, run1, 1, []);
  await writePlan(fx, 2, []);
  const c1 = await check(fx);
  assert.equal(c1.code, EXIT.OK, c1.raw);
  assert.equal(c1.js.round_verdict!.decision, 'fail');
  assert.equal(c1.js.round_verdict!.round, 1);
  assert.equal(await gateState(fx), 'idle', 'B 判 fail 未用尽：不停人审，回 idle 让 Driver 修订重发（行为变化，2026-10-22）');

  // 第 2 轮判 pass：B 的常规停点恢复
  const run2 = await runPlan(fx, 'B', both('approve'));
  await writeDisposition(fx, run2, 2, []);
  const c2 = await check(fx);
  assert.equal(c2.code, EXIT.OK, c2.raw);
  assert.equal(c2.js.round_verdict!.decision, 'pass');
  assert.equal(await gateState(fx), 'awaiting_approval', 'B 判 pass：停点是命令 B 的定义，照旧立起');
});
