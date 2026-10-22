/**
 * 多轮评审循环 · 调用链（EV-247，计划 §二 / §三 / §七）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。桩按侧指定三档结论（`verdict`），两侧各出一条意见（AGY-01、GLM-01）。
 * 覆盖：计票与下一步落进 run.json 并经 `--wait` / `gate --check` 透出；`rerun` 让 B / C 的闸门回 idle、可直接续轮；
 * 续链轮次 +1、上限沿用链首、中途改上限退 64 且零工件；到上限仍不通过 A / B 都立人工停点；
 * 越界与 bug 阶段退 64；代码阶段两轮循环；审查员给出旧契约结论时该侧整份回退、不计票；
 * 续链判定的拒跑（人工审核未表态、运行留痕或审批正本读不出）与纯文档跳过轮不断链；两侧都回退 ⇒ 有效结论不足。
 * 纯函数一层在 `test/unit/round-verdict.test.ts`。
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
const REJECT: StubConfig = { gemini: { mode: 'ok', verdict: 'reject' }, glm: { mode: 'ok', verdict: 'reject' } };
const PASS: StubConfig = { gemini: { mode: 'ok', verdict: 'pass' }, glm: { mode: 'ok', verdict: 'pass-after-changes' } };
const DRIVER = 'claude';

type Stage = 'plan' | 'code';
type WaitJson = { run_id: string; next_action: string | null; round_line: string | null; review_loop: unknown };
type CheckJson = { ok: boolean; next_action: string | null; round_line: string | null; failures: { code: string }[] };

const join = (...parts: string[]) => parts.join('-');
const stageDirOf = (fx: Fixture, stage: Stage) => path.join(fx.archiveRoot, fx.topic, stage);

async function runMeta(fx: Fixture, stage: Stage, runId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(stageDirOf(fx, stage), '_meta', `run-${runId}.json`), 'utf8')) as Record<string, unknown>;
}

/** 起一轮并等到收尾，返回最后一次 `--wait` 的 JSON（含计票透出） */
async function runRound(fx: Fixture, stage: Stage, entry: 'A' | 'B' | 'C', stub: StubConfig, extra: string[] = []): Promise<WaitJson> {
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', stage, '--topic', fx.topic, '--focus', 'x', '--entry', entry, ...extra, '--json'],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; review_loop: unknown };
  let last = { code: EXIT.STILL_RUNNING as number, stdout: '' };
  for (let i = 0; i < 12 && last.code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20', '--json'], stub, 60_000);
    last = { code: w.code ?? EXIT.FAIL, stdout: w.stdout };
  }
  assert.equal(last.code, EXIT.OK, `运行 ${js.run_id} 没有成功收尾：${last.stdout}`);
  const out = JSON.parse(extractJsonCandidate(last.stdout)!.json) as WaitJson;
  assert.deepEqual(out.review_loop, js.review_loop, '--start 与 --wait 给出的轮次链位置一致');
  return out;
}

/** 合规裁决件：两条都接受（计划阶段 `revised`、代码阶段 `response`） */
async function writeDisposition(fx: Fixture, stage: Stage, runId: string, r: number): Promise<void> {
  const seg = r > 1 ? `r${r}-` : '';
  const kind = stage === 'plan' ? 'revised' : 'response';
  await fs.writeFile(
    path.join(stageDirOf(fx, stage), `${today()}-${fx.topic}-${seg}${kind}-${DRIVER}.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, `stage: ${stage}`,
      `role: ${DRIVER}`, `kind: ${kind}`, `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${fx.topic}-${seg}gemini.md`, `  - ${today()}-${fx.topic}-${seg}glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | src/a.ts |',
      '| GLM-01 | glm | blocker | 接受 | 同一处，一并补上 | src/a.ts |',
      '',
    ].join('\n'),
    'utf8',
  );
}

/** 新一轮完整计划（EV-247：每轮都写） */
async function writeNextPlan(fx: Fixture, r: number): Promise<void> {
  await fs.writeFile(
    path.join(stageDirOf(fx, 'plan'), join(today(), fx.topic, `r${r}`, DRIVER) + '.md'),
    [`# 计划 r${r}`, '', '相对上一轮的改动：', '- AGY-01：按建议补上', '- GLM-01：按建议补上', ''].join('\n'),
    'utf8',
  );
}

async function check(fx: Fixture, stage: Stage): Promise<CheckJson> {
  const r = await cli(fx.root, ['gate', '--stage', stage, '--topic', fx.topic, '--check', '--json']);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as CheckJson;
  assert.equal(r.code, EXIT.OK, `裁决校验应通过：\n${r.stdout}${r.stderr}`);
  return js;
}

async function gateState(fx: Fixture, stage: Stage): Promise<string | undefined> {
  const raw = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  return raw.gates[`${fx.topic}/${stage}`]?.state;
}

async function runIds(fx: Fixture, stage: Stage): Promise<string[]> {
  return (await fs.readdir(path.join(stageDirOf(fx, stage), '_meta'))).filter((f) => /^run-.+\.json$/.test(f)).sort();
}

test('L1 · 命令 B 计划审：不通过 ⇒ rerun、闸门回 idle、续链第 2 轮；到上限仍不通过 ⇒ 人工停点', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l1' });

  const w1 = await runRound(fx, 'plan', 'B', REJECT, ['--max-rounds', '2']);
  assert.equal(w1.next_action, 'rerun');
  assert.match(w1.round_line ?? '', /^第 1\/2 轮 · 计票：0 通过 \/ 0 修改后通过 \/ 2 不通过 → 不通过/);
  const m1 = await runMeta(fx, 'plan', w1.run_id);
  assert.deepEqual(m1['review_loop'], { round: 1, max_rounds: 2 });
  assert.deepEqual(
    m1['round_verdict'],
    {
      sides: { gemini: 'reject', glm: 'reject' }, excluded: {},
      counts: { pass: 0, 'pass-after-changes': 0, reject: 2 }, outcome: 'reject', next_action: 'rerun',
    },
  );

  await writeDisposition(fx, 'plan', w1.run_id, 1);
  await writeNextPlan(fx, 2);
  const c1 = await check(fx, 'plan');
  assert.equal(c1.next_action, 'rerun');
  assert.equal(await gateState(fx, 'plan'), 'idle', '中间轮不立人工停点：B 的闸门回 idle，才能直接重审');

  // 续链：不再给 --max-rounds，上限沿用链首；被审对象自动换成 r2
  const w2 = await runRound(fx, 'plan', 'B', REJECT);
  const m2 = await runMeta(fx, 'plan', w2.run_id);
  assert.deepEqual(m2['review_loop'], { round: 2, max_rounds: 2 });
  assert.deepEqual(m2['plan_final_check'], { subject_rerun_index: 2 });
  assert.equal(w2.next_action, 'human_review');

  await writeDisposition(fx, 'plan', w2.run_id, 2);
  await writeNextPlan(fx, 3);
  const c2 = await check(fx, 'plan');
  assert.equal(c2.next_action, 'human_review');
  assert.equal(await gateState(fx, 'plan'), 'awaiting_approval');

  const hold = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--await-approval']);
  assert.equal(hold.code, EXIT.OK, `${hold.stdout}${hold.stderr}`);
  assert.match(hold.stdout, /评审循环已到最大轮次仍判不通过/);
  assert.match(hold.stdout, /第 2\/2 轮 · 计票/);
});

test('L2 · 命令 A：上限 1、第一轮不通过 ⇒ 立人工停点（命令 A 唯一的停点）；通过两档照旧回 idle', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l2' });
  const w = await runRound(fx, 'plan', 'A', REJECT, ['--max-rounds', '1']);
  assert.equal(w.next_action, 'human_review');
  await writeDisposition(fx, 'plan', w.run_id, 1);
  await writeNextPlan(fx, 2);
  assert.equal((await check(fx, 'plan')).next_action, 'human_review');
  assert.equal(await gateState(fx, 'plan'), 'awaiting_approval');

  const fx2 = await makeFixture({ topic: 'loop-l2b' });
  const p = await runRound(fx2, 'plan', 'A', PASS);
  assert.equal(p.next_action, 'proceed');
  assert.match(p.round_line ?? '', /1 通过 \/ 1 修改后通过 \/ 0 不通过 → 修改后通过/);
  await writeDisposition(fx2, 'plan', p.run_id, 1);
  await writeNextPlan(fx2, 2);
  assert.equal((await check(fx2, 'plan')).next_action, 'proceed');
  assert.equal(await gateState(fx2, 'plan'), 'idle');
});

test('L3 · 续链中途改上限退 64、零工件；越界退 64；bug 阶段给 --max-rounds 退 64', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l3' });
  const w1 = await runRound(fx, 'plan', 'B', REJECT, ['--max-rounds', '2']);
  await writeDisposition(fx, 'plan', w1.run_id, 1);
  await writeNextPlan(fx, 2);
  await check(fx, 'plan');
  const before = await runIds(fx, 'plan');

  const changed = await cli(
    fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', '--max-rounds', '3', '--json'], REJECT,
  );
  assert.equal(changed.code, EXIT.USAGE, `${changed.stdout}${changed.stderr}`);
  assert.match(changed.stderr, /上限沿用 2，不能中途改成 3/);
  assert.deepEqual(await runIds(fx, 'plan'), before, '拒绝发生在分配 run_id 之前，不留运行留痕');
  assert.equal(await gateState(fx, 'plan'), 'idle');

  for (const bad of ['0', '11', 'x']) {
    const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--max-rounds', bad, '--json'], REJECT);
    assert.equal(r.code, EXIT.USAGE, `--max-rounds ${bad}：${r.stdout}${r.stderr}`);
  }
  const bug = await cli(fx.root, ['review', '--start', '--stage', 'bug', '--topic', fx.topic, '--focus', 'x', '--max-rounds', '2', '--json'], REJECT);
  assert.equal(bug.code, EXIT.USAGE, `${bug.stdout}${bug.stderr}`);
  assert.match(bug.stderr, /根因审不进循环/);
});

test('L4 · 命令 C 代码审：第 1 轮不通过、按裁决改码后续轮；第 2 轮通过 ⇒ 立审批停点', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l4' });
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');

  const w1 = await runRound(fx, 'code', 'C', REJECT);
  assert.deepEqual((await runMeta(fx, 'code', w1.run_id))['review_loop'], { round: 1, max_rounds: 3 });
  assert.equal(w1.next_action, 'rerun');
  await writeDisposition(fx, 'code', w1.run_id, 1);
  // 按裁决直接改码：放在校验之前（校验通过后闸门可能立起停点）
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 3;\n');
  assert.equal((await check(fx, 'code')).next_action, 'rerun');
  assert.equal(await gateState(fx, 'code'), 'idle');

  const w2 = await runRound(fx, 'code', 'C', PASS);
  assert.deepEqual((await runMeta(fx, 'code', w2.run_id))['review_loop'], { round: 2, max_rounds: 3 });
  assert.equal(w2.next_action, 'proceed');
  await writeDisposition(fx, 'code', w2.run_id, 2);
  assert.equal((await check(fx, 'code')).next_action, 'proceed');
  assert.equal(await gateState(fx, 'code'), 'awaiting_approval');

  // 先改码再立停点：审批照常通过（复核看的是归档工件，不是工作树相对送审时刻的改动）
  const ok = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'code', '--reason', '代码已按裁决改好']);
  assert.equal(ok.code, EXIT.OK, `${ok.stdout}${ok.stderr}`);
  assert.equal(await gateState(fx, 'code'), 'approved');
});

test('L6 · 续轮那次运行失败（没有计票）不消耗轮次：重试仍是同一轮，上限不被重置', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l6' });
  const w1 = await runRound(fx, 'plan', 'B', REJECT, ['--max-rounds', '2']);
  await writeDisposition(fx, 'plan', w1.run_id, 1);
  await writeNextPlan(fx, 2);
  assert.equal((await check(fx, 'plan')).next_action, 'rerun');

  // 第 2 轮：一侧进程级失败，strict 下整次中止（退 75），run.json 有轮次链、没有计票
  const FAIL: StubConfig = { gemini: { mode: 'fail' }, glm: { mode: 'ok', verdict: 'reject' } };
  const started = await cli(
    fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', '--json'], FAIL,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const failedId = (JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string }).run_id;
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', failedId, '--timeout', '20'], FAIL, 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.STRICT_ABORT);
  const mf = await runMeta(fx, 'plan', failedId);
  assert.deepEqual(mf['review_loop'], { round: 2, max_rounds: 2 });
  assert.equal(mf['round_verdict'], undefined, '没跑成的一轮不计票');

  // 重试：仍是第 2/2 轮（跳过失败的那次、续的是第 1 轮的链），不是新链第 1/3 轮
  const w2 = await runRound(fx, 'plan', 'B', REJECT);
  assert.deepEqual((await runMeta(fx, 'plan', w2.run_id))['review_loop'], { round: 2, max_rounds: 2 });
  assert.equal(w2.next_action, 'human_review');
});

test('L7 · 上一轮停在人工审核、尚未表态：本机闸门状态被删也拒绝起链（归档正本把守）、零工件', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l7' });
  const w = await runRound(fx, 'plan', 'B', REJECT, ['--max-rounds', '1']);
  assert.equal(w.next_action, 'human_review');
  await writeDisposition(fx, 'plan', w.run_id, 1);
  await writeNextPlan(fx, 2);
  await check(fx, 'plan');
  assert.equal(await gateState(fx, 'plan'), 'awaiting_approval');

  // 跨克隆 / 本机状态丢失：闸门槽位缺失时 --start 的比较-交换会放行，只剩归档这一道
  await fs.rm(path.join(fx.root, '.trivium', 'state.json'));
  const before = await runIds(fx, 'plan');
  for (const extra of [[], ['--max-rounds', '3']]) {
    const r = await cli(
      fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', ...extra, '--json'], REJECT,
    );
    assert.equal(r.code, EXIT.USAGE, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /已停在人工审核/);
  }
  assert.deepEqual(await runIds(fx, 'plan'), before, '拒绝发生在分配 run_id 之前');
});

test('L8 · 最新一份是失败轮、更早一份运行留痕读不出 ⇒ 拒跑，不静默新起一链', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l8' });
  const w1 = await runRound(fx, 'plan', 'B', REJECT, ['--max-rounds', '2']);
  await writeDisposition(fx, 'plan', w1.run_id, 1);
  await writeNextPlan(fx, 2);
  assert.equal((await check(fx, 'plan')).next_action, 'rerun');

  const FAIL: StubConfig = { gemini: { mode: 'fail' }, glm: { mode: 'ok', verdict: 'reject' } };
  const started = await cli(
    fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', '--json'], FAIL,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const failedId = (JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string }).run_id;
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', failedId, '--timeout', '20'], FAIL, 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.STRICT_ABORT);

  // 链首那份写坏：入口的 Driver 判定只看最新可读的那份（失败轮），挡不住它
  await fs.writeFile(path.join(stageDirOf(fx, 'plan'), '_meta', `run-${w1.run_id}.json`), '{', 'utf8');
  const before = await runIds(fx, 'plan');
  const r = await cli(
    fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', '--json'], REJECT,
  );
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, new RegExp(`无法判定轮次链[\\s\\S]*${w1.run_id}`));
  assert.deepEqual(await runIds(fx, 'plan'), before, '拒跑不留运行留痕');
});

test('L9 · 纯文档跳过轮不消耗轮次：rerun → 跳过 → 再送审仍是第 2 轮', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l9', extraReview: ['skip_doc_only_review: true'] });
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
  const w1 = await runRound(fx, 'code', 'C', REJECT);
  assert.equal(w1.next_action, 'rerun');
  await writeDisposition(fx, 'code', w1.run_id, 1);
  assert.equal((await check(fx, 'code')).next_action, 'rerun');

  // 改动收成只剩文档：本次判纯文档跳过，不拉起审查员
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');
  const skipped = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', fx.topic, '--focus', 'x', '--entry', 'C', '--json'], REJECT);
  assert.equal(skipped.code, EXIT.OK, `${skipped.stdout}${skipped.stderr}`);
  const sj = JSON.parse(extractJsonCandidate(skipped.stdout)!.json) as { run_id: string; finished_inline?: boolean; review_loop: unknown };
  assert.equal(sj.finished_inline, true);
  assert.equal(sj.review_loop, null);

  // 再改代码送审：续的仍是第 1 轮那条链
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 3;\n');
  const w2 = await runRound(fx, 'code', 'C', PASS);
  assert.deepEqual((await runMeta(fx, 'code', w2.run_id))['review_loop'], { round: 2, max_rounds: 3 });
});

test('L10 · 上一轮停在人工审核、审批正本读不出 ⇒ 拒跑，不按「已表态」新起一链（代码双审 r2 GLM-01）', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l10' });
  const w = await runRound(fx, 'plan', 'B', REJECT, ['--max-rounds', '1']);
  assert.equal(w.next_action, 'human_review');
  await writeDisposition(fx, 'plan', w.run_id, 1);
  await writeNextPlan(fx, 2);

  // 本机闸门状态也删掉：只剩归档这一道，而正本写坏了
  await fs.rm(path.join(fx.root, '.trivium', 'state.json'));
  await fs.writeFile(path.join(fx.archiveRoot, fx.topic, 'task.json'), '{', 'utf8');
  const before = await runIds(fx, 'plan');
  for (const extra of [[], ['--max-rounds', '3']]) {
    const r = await cli(
      fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', ...extra, '--json'], REJECT,
    );
    assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /无法判定轮次链[\s\S]*task\.json 读不出来/);
  }
  assert.deepEqual(await runIds(fx, 'plan'), before, '拒跑不留运行留痕');

  // 停点命令照旧按已表态保守处理，但不说「有人表过态」（代码双审 r3 GLM-03）。
  // 不用 `--check` 断言：它在判定之前就经宽松读写了一次正本（joint_checks），坏件已被覆盖（EV-248）
  const c = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--await-approval']);
  const out = `${c.stdout}${c.stderr}`;
  assert.match(out, /审批正本 task\.json 读不出，按已表态保守处理/);
  assert.doesNotMatch(out, /已有人工审批记录/);
  await assert.rejects(fs.access(path.join(fx.root, '.trivium', 'state.json')), '闸门状态保持不变：不立停点');
});

test('L11 · 两侧都整份回退 ⇒ 有效结论不足、停下人工审核，未表态时拒绝起链', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l11' });
  const stub: StubConfig = { gemini: { mode: 'ok', legacySchema: true }, glm: { mode: 'ok', legacySchema: true } };
  const w = await runRound(fx, 'plan', 'B', stub);
  const rv = (await runMeta(fx, 'plan', w.run_id))['round_verdict'] as { excluded: Record<string, string>; outcome: string; next_action: string };
  assert.deepEqual(rv.excluded, { gemini: 'parse_fallback', glm: 'parse_fallback' });
  assert.equal(rv.outcome, 'undetermined');
  assert.equal(rv.next_action, 'human_review');
  assert.equal(w.next_action, 'human_review', '--wait 透出下一步');

  // 有效结论不足同样立人工停点（代码双审 r3 GLM-01）。闸门重读归档两版都认，回退侧照结构化编号裁决
  await writeDisposition(fx, 'plan', w.run_id, 1);
  await writeNextPlan(fx, 2);
  assert.equal((await check(fx, 'plan')).next_action, 'human_review');
  assert.equal(await gateState(fx, 'plan'), 'awaiting_approval');

  await fs.rm(path.join(fx.root, '.trivium', 'state.json'));
  const before = await runIds(fx, 'plan');
  const r = await cli(
    fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', '--json'], stub,
  );
  assert.equal(r.code, EXIT.USAGE, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /已停在人工审核/);
  assert.deepEqual(await runIds(fx, 'plan'), before);
});

test('L5 · 审查员给出旧契约 v1 结论 ⇒ 该侧整份回退、不计票；另一侧不通过即 1/1 不通过', { skip }, async () => {
  const fx = await makeFixture({ topic: 'loop-l5' });
  const stub: StubConfig = { gemini: { mode: 'ok', legacySchema: true }, glm: { mode: 'ok', verdict: 'reject' } };
  const w = await runRound(fx, 'plan', 'B', stub);
  const m = await runMeta(fx, 'plan', w.run_id);
  const critics = m['critics'] as Record<string, { status: string }>;
  assert.equal(critics['gemini']?.status, 'parse_fallback', '新产出只认 v2：v1 形态按根不合整份回退');
  const rv = m['round_verdict'] as { excluded: Record<string, string>; counts: Record<string, number>; outcome: string };
  assert.deepEqual(rv.excluded, { gemini: 'parse_fallback' });
  assert.deepEqual(rv.counts, { pass: 0, 'pass-after-changes': 0, reject: 1 });
  assert.equal(rv.outcome, 'reject');
});
