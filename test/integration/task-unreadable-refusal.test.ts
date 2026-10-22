/**
 * 审批正本读不出拒写 · 调用链（EV-248，计划 r2 §五 I1～I13）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。逐个调用方构造「正本读不出」：截断 JSON、位置是目录、形状不对（`{}`），
 * 断言退 2、正本字节原样、闸门不动、不留半截工件；新主题首次写入不受影响（I10）；
 * worker 跑到一半正本才坏的竞态（I11）由既有异常收尾兜住、坏件不被覆盖。
 * 写入口一层与 `recordApproval` 的补偿在 `test/unit/meta-task-write.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, listFiles, makeFixture, today, type Fixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { setGate } from '../../src/trivium/state.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;
const PASS: StubConfig = { gemini: { mode: 'ok', verdict: 'pass' }, glm: { mode: 'ok', verdict: 'pass-after-changes' } };
const DRIVER = 'claude';
const BROKEN = '{ "schema": "trivium.task.v1", "approvals": [';

type Stage = 'plan' | 'code';
type CheckJson = { ok: boolean; failures: { code: string; message: string }[]; next_action: string | null };

const taskFile = (fx: Fixture) => path.join(fx.archiveRoot, fx.topic, 'task.json');
const stageDirOf = (fx: Fixture, stage: Stage) => path.join(fx.archiveRoot, fx.topic, stage);
const json = <T>(stdout: string): T => JSON.parse(extractJsonCandidate(stdout)!.json) as T;

/** 拒写文案的共同部分：点名绝对路径、给 Git 出口 */
function assertExitText(out: string, fx: Fixture): void {
  assert.ok(out.includes(taskFile(fx)), `文案应点名正本绝对路径：\n${out}`);
  assert.match(out, /git restore --source=HEAD/);
  assert.match(out, /由用户在终端执行/);
}

async function gateOf(fx: Fixture, stage: Stage): Promise<{ state: string; run_id: string | null } | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'state.json'), 'utf8')) as {
      gates: Record<string, { state: string; run_id: string | null }>;
    };
    return raw.gates[`${fx.topic}/${stage}`];
  } catch {
    return undefined;
  }
}

async function runIdsOf(fx: Fixture, stage: Stage): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(stageDirOf(fx, stage), '_meta'))).filter((f) => /^run-.+\.json$/.test(f)).sort();
  } catch {
    return [];
  }
}

/** 起一轮并等到收尾 */
async function runRound(fx: Fixture, stage: Stage, entry: 'A' | 'B' | 'C', stub: StubConfig = PASS, extra: string[] = []): Promise<string> {
  const started = await cli(
    fx.root, ['review', '--start', '--stage', stage, '--topic', fx.topic, '--focus', 'x', '--entry', entry, ...extra, '--json'], stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const { run_id } = json<{ run_id: string }>(started.stdout);
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(fx.root, ['review', '--wait', run_id, '--timeout', '20', '--json'], stub, 60_000);
    code = w.code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${run_id} 没有成功收尾`);
  return run_id;
}

/** 合规裁决件；`reject` 为真时两条共同 blocker 都驳回（命中共同阻断被驳回 ⇒ 争议标记） */
async function writeDisposition(fx: Fixture, stage: Stage, runId: string, reject = false): Promise<void> {
  const kind = stage === 'plan' ? 'revised' : 'response';
  const row = (id: string, src: string) =>
    reject ? `| ${id} | ${src} | blocker | 驳回 | 上游 src/x.ts:31 已拒绝该路径 | |` : `| ${id} | ${src} | blocker | 接受 | 确实漏了这一处 | src/a.ts |`;
  await fs.writeFile(
    path.join(stageDirOf(fx, stage), `${today()}-${fx.topic}-${kind}-${DRIVER}.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, `stage: ${stage}`,
      `role: ${DRIVER}`, `kind: ${kind}`, `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${fx.topic}-gemini.md`, `  - ${today()}-${fx.topic}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      row('AGY-01', 'gemini'), row('GLM-01', 'glm'), '',
    ].join('\n'),
    'utf8',
  );
  if (stage === 'plan') {
    await fs.writeFile(
      path.join(stageDirOf(fx, 'plan'), `${today()}-${fx.topic}-r2-${DRIVER}.md`),
      ['# 计划 r2', '', '相对上一轮的改动：', ...(reject ? ['- 本轮无改动'] : ['- AGY-01：补上', '- GLM-01：补上']), ''].join('\n'),
      'utf8',
    );
  }
}

/** 跑完一轮计划审、裁决齐，返回 run_id（`--check` 由调用方决定跑不跑） */
async function adjudicatedPlan(fx: Fixture, entry: 'A' | 'B', reject = false): Promise<string> {
  const runId = await runRound(fx, 'plan', entry);
  await writeDisposition(fx, 'plan', runId, reject);
  return runId;
}

async function corrupt(fx: Fixture, content = BROKEN): Promise<Buffer> {
  await fs.writeFile(taskFile(fx), content, 'utf8');
  return fs.readFile(taskFile(fx));
}

test('I1 · gate --check（B，本轮已审批）读不出 ⇒ 退 2、只出一份带 task_unreadable 的结果、正本与闸门都不动', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i1' });
  await adjudicatedPlan(fx, 'B');
  const c1 = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--json']);
  assert.equal(c1.code, EXIT.OK, `${c1.stdout}${c1.stderr}`);
  const ap = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan']);
  assert.equal(ap.code, EXIT.OK, `${ap.stdout}${ap.stderr}`);
  assert.match(`${ap.stdout}${ap.stderr}`, /工作树改动/, '前提：正常审批会打印工作树改动摘要（I4 据此判先判的位置）');
  assert.equal((await gateOf(fx, 'plan'))?.state, 'approved');

  const before = await corrupt(fx);
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--json']);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assert.equal((r.stdout.match(/"failures"/g) ?? []).length, 1, `只输出一次结果：\n${r.stdout}`);
  const js = json<CheckJson>(r.stdout);
  assert.equal(js.ok, false);
  const f = js.failures.find((x) => x.code === 'task_unreadable');
  assert.ok(f, r.stdout);
  assertExitText(f.message, fx);
  assert.deepEqual(await fs.readFile(taskFile(fx)), before, '坏件不得被覆盖');
  assert.equal((await gateOf(fx, 'plan'))?.state, 'approved', '已放行的闸门不得被打回');
});

test('I2 · gate --check（A，未表态）读不出 ⇒ 退 2、闸门停在待裁决、阻断计数不归零', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i2' });
  const runId = await adjudicatedPlan(fx, 'A');
  assert.equal((await gateOf(fx, 'plan'))?.state, 'review_done_awaiting_disposition');
  // 摆一份阻断计数：放行分支会归零它（删目录），读不出时不该走到那里
  const counter = path.join(fx.root, '.trivium', 'lock', `stopblock-${fx.topic}-plan`);
  await fs.mkdir(counter, { recursive: true });

  const before = await corrupt(fx);
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check']);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assertExitText(`${r.stdout}${r.stderr}`, fx);
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
  const g = await gateOf(fx, 'plan');
  assert.equal(g?.state, 'review_done_awaiting_disposition', '不得回 idle');
  assert.equal(g?.run_id, runId);
  await fs.access(counter);
});

test('I3 · 共同 blocker 被驳回（争议标记）时读不出 ⇒ 退 2、disputed 没被写进新正本', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i3' });
  await adjudicatedPlan(fx, 'A', true);
  const before = await corrupt(fx);
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--json']);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /joint_blocker_rejected/, '前提：确实命中了争议判据');
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});

test('I4 · approve 读不出 ⇒ 退 2、闸门仍等待审批、正本原样', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i4' });
  await adjudicatedPlan(fx, 'B');
  assert.equal((await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check'])).code, EXIT.OK);
  assert.equal((await gateOf(fx, 'plan'))?.state, 'awaiting_approval');

  const before = await corrupt(fx);
  const r = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan']);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assertExitText(r.stderr, fx);
  assert.match(r.stderr, /未记录审批，闸门保持不变/);
  // 先判在复核与工作树摘要之前（计划 r2 §三.2）：判在后面的话，人会先看完一屏摘要再被拒
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /工作树改动/);
  assert.equal((await gateOf(fx, 'plan'))?.state, 'awaiting_approval');
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});

test('I5 · 拒绝与不带 --stage 的放弃（两个阶段都有开放闸门）读不出 ⇒ 退 2、两道闸门都不动', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i5' });
  const runId = await adjudicatedPlan(fx, 'B');
  assert.equal((await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check'])).code, EXIT.OK);
  await setGate({
    triviumDir: path.join(fx.root, '.trivium'), topic: fx.topic, stage: 'code',
    state: 'review_done_awaiting_disposition', runId: 'R-CODE', heartbeatStaleMs: 120_000,
  });
  const before = await corrupt(fx);

  const rj = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan', '--reject', '--reason', '重来']);
  assert.equal(rj.code, EXIT.GATE_BLOCK, `${rj.stdout}${rj.stderr}`);
  const ab = await cli(fx.root, ['abandon', '--topic', fx.topic]);
  assert.equal(ab.code, EXIT.GATE_BLOCK, `${ab.stdout}${ab.stderr}`);
  assertExitText(ab.stderr, fx);

  const plan = await gateOf(fx, 'plan');
  assert.equal(plan?.state, 'awaiting_approval');
  assert.equal(plan?.run_id, runId);
  assert.equal((await gateOf(fx, 'code'))?.state, 'review_done_awaiting_disposition');
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});

test('I6 · topic claim 时正本位置是目录 ⇒ 退 2、目录原样', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i6' });
  await fs.mkdir(taskFile(fx));
  await fs.writeFile(path.join(taskFile(fx), 'sentinel'), 'x');
  const r = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', 'code', '--driver', DRIVER, '--json']);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assertExitText(r.stderr, fx);
  assert.ok((await fs.stat(taskFile(fx))).isDirectory());
  assert.deepEqual(await fs.readdir(taskFile(fx)), ['sentinel']);
});

test('I7 · verify 读不出 ⇒ 退 2、一条命令都不跑、不写验证记录', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i7', extraVerify: ['  build:', '    - echo ran > verify-ran', '  test: []'] });
  const before = await corrupt(fx);
  const r = await cli(fx.root, ['verify', '--topic', fx.topic]);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assertExitText(r.stderr, fx);
  assert.match(r.stderr, /未执行任何编译测试命令/);
  await assert.rejects(fs.access(path.join(fx.root, 'verify-ran')), '命令不得被执行');
  assert.deepEqual(await listFiles(path.join(fx.archiveRoot, fx.topic, 'verify')), []);
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});

test('I14 · verify 命令跑完、登记时正本才坏 ⇒ 退 2、记录保留、文案写明命令结论（代码双审 GLM-01）', { skip }, async () => {
  // build 命令自己把正本写坏：开跑前的先判过得去，登记时才读不出——确定性地造出竞态那一格
  const fx = await makeFixture({ topic: 'tur-i14', extraVerify: ['  build:', '    - echo x > .reviews/tur-i14/task.json', '  test: []'] });
  const c = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', 'plan', '--driver', DRIVER, '--json']);
  assert.equal(c.code, EXIT.OK, `前提：正本先可读：${c.stdout}${c.stderr}`);
  const r = await cli(fx.root, ['verify', '--topic', fx.topic]);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /编译测试已执行完（结论：全部命令通过）/);
  assertExitText(r.stderr, fx);
  const files = await listFiles(path.join(fx.archiveRoot, fx.topic, 'verify'));
  assert.ok(files.some((f) => f.endsWith('-verify.md')), `验证记录保留：${files.join(', ')}`);
  assert.ok(files.some((f) => /^_meta[/\\]verify-.+\.json$/.test(f)), files.join(', '));
  assert.ok(files.some((f) => /^_meta[/\\]run-.+\.json$/.test(f)), files.join(', '));
  const rec = files.find((f) => f.endsWith('-verify.md'))!;
  assert.ok(r.stderr.includes(path.join(fx.archiveRoot, fx.topic, 'verify', rec)), '文案点名记录路径');
  assert.equal(await fs.readFile(taskFile(fx), 'utf8'), 'x\n', '正本是命令写下的坏件，没被覆盖');
});

test('I8 · review --start（新阶段第一轮，没有前序轮次）读不出 ⇒ 退 2、零工件、闸门未置 running', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i8' });
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
  const before = await corrupt(fx);
  const bucketBefore = await listFiles(fx.runRoot);
  const r = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', fx.topic, '--focus', 'x', '--entry', 'C', '--json'], PASS);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assertExitText(r.stderr, fx);
  assert.match(r.stderr, /未开始本轮审查/);
  assert.deepEqual(await runIdsOf(fx, 'code'), []);
  assert.deepEqual(await listFiles(path.join(stageDirOf(fx, 'code'), '_meta')), [], '没有 brief、补丁或骨架');
  assert.deepEqual(await listFiles(fx.runRoot), bucketBefore, '运行桶里没有新目录');
  assert.equal(await gateOf(fx, 'code'), undefined);
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});

test('I9 · 纯文档跳过轮读不出 ⇒ 退 2、不留跳过轮的 run.json', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i9' });
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');
  const before = await corrupt(fx);
  const r = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', fx.topic, '--focus', 'x', '--entry', 'C', '--json'], PASS);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /finished_inline/);
  assert.deepEqual(await runIdsOf(fx, 'code'), []);
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});

test('I10 · 新主题、正本不存在：topic claim、review、verify 首次写入照常', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i10', extraVerify: ['  build:', '    - "true"', '  test: []'] });
  await assert.rejects(fs.access(taskFile(fx)), '前提：正本还不存在');
  const c = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', 'plan', '--driver', DRIVER, '--json']);
  assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
  const runId = await runRound(fx, 'plan', 'B');
  const v = await cli(fx.root, ['verify', '--topic', fx.topic]);
  assert.equal(v.code, EXIT.OK, `${v.stdout}${v.stderr}`);
  const t = JSON.parse(await fs.readFile(taskFile(fx), 'utf8')) as {
    schema: string; drivers?: Record<string, { driver: string }>; runs: { run_id: string; stage: string }[];
  };
  assert.equal(t.schema, 'trivium.task.v1');
  assert.equal(t.drivers?.['plan']?.driver, DRIVER);
  assert.ok(t.runs.some((x) => x.run_id === runId && x.stage === 'plan'));
  assert.ok(t.runs.some((x) => x.stage === 'verify'));
});

test('I11 · 运行中正本才坏（worker 收尾登记被拒）⇒ 运行失败、文案点名正本、闸门已回收、坏件不被覆盖', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i11' });
  // gemini 起一个 3 秒后自然结束的 CLI（按超时失败），glm 正常；允许单侧降级，运行照常走到收尾登记
  const stub: StubConfig = { gemini: { mode: 'hang_cli', sleepS: 3 }, glm: { mode: 'ok', verdict: 'pass' } };
  const started = await cli(
    fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'B', '--allow-single', '--json'], stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const { run_id } = json<{ run_id: string }>(started.stdout);
  const before = await corrupt(fx);

  let last = { code: EXIT.STILL_RUNNING as number, stdout: '' };
  for (let i = 0; i < 12 && last.code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(fx.root, ['review', '--wait', run_id, '--timeout', '20', '--json'], stub, 60_000);
    last = { code: w.code ?? EXIT.FAIL, stdout: w.stdout };
  }
  assert.notEqual(last.code, EXIT.OK, `收尾登记被拒，运行不得报成功：\n${last.stdout}`);
  assert.notEqual(last.code, EXIT.STILL_RUNNING);
  const w = json<{ message: string | null }>(last.stdout);
  assert.ok((w.message ?? '').includes(taskFile(fx)), `status 的 message 应点名正本：${w.message}`);
  assert.notEqual((await gateOf(fx, 'plan'))?.state, 'running', '闸门已回收');
  assert.deepEqual(await fs.readFile(taskFile(fx)), before, '坏件不得被覆盖');
});

test('I12 · gate --await-approval 读不出 ⇒ 退 2、ok:false、闸门不变（计划双审 AGY-01）', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i12' });
  const runId = await adjudicatedPlan(fx, 'A');
  await corrupt(fx);
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--await-approval', '--json']);
  assert.equal(r.code, EXIT.GATE_BLOCK, `${r.stdout}${r.stderr}`);
  const js = json<{ ok: boolean; state: string; message: string }>(r.stdout);
  assert.equal(js.ok, false);
  assert.equal(js.state, 'unchanged');
  assertExitText(js.message, fx);
  const g = await gateOf(fx, 'plan');
  assert.equal(g?.state, 'review_done_awaiting_disposition');
  assert.equal(g?.run_id, runId);
});

test('I13 · 正本是合法 JSON 但形状不对（{}）⇒ approve 与 gate --check 都退 2 而不是 1（计划双审 AGY-02）', { skip }, async () => {
  const fx = await makeFixture({ topic: 'tur-i13' });
  await adjudicatedPlan(fx, 'B');
  assert.equal((await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check'])).code, EXIT.OK);
  const before = await corrupt(fx, '{}');
  const a = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan']);
  assert.equal(a.code, EXIT.GATE_BLOCK, `${a.stdout}${a.stderr}`);
  assert.match(a.stderr, /schema 不是 trivium\.task\.v1/);
  const c = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check']);
  assert.equal(c.code, EXIT.GATE_BLOCK, `${c.stdout}${c.stderr}`);
  assert.equal((await gateOf(fx, 'plan'))?.state, 'awaiting_approval');
  assert.deepEqual(await fs.readFile(taskFile(fx)), before);
});
