/**
 * 计划定稿复核 · 调用链（EV-215，计划定稿复核计划 r2 §3.2）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。计划阶段用 `review --start --entry A` 跑出带 `plan_final_check` 的真实运行
 * （桩两侧各出一条意见：AGY-01、GLM-01），写裁决件与新一轮计划；再改一个源文件，跑代码阶段。
 * 覆盖：定稿合入全部接受编号无告警；闸门通过后另写缺编号的更高轮次计划 ⇒ 告警走三个出口、代码 `gate --check` 以
 * run_warning 回灌；没有新一轮计划；最新一轮全部驳回；旧运行；非缺省执笔方；剔除告警在场时的顺序。
 * 纯函数一层在 `test/unit/plan-final-recheck.test.ts`。
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
const STUB3: StubConfig = { codex: { mode: 'ok' }, gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

const RECHECK = '计划定稿未通过复核';
const MARK = '⚠️ ';

type StartJson = { run_id: string; warnings: { name: string; detail: string }[] };

const stageDirOf = (fx: Fixture, stage: string) => path.join(fx.archiveRoot, fx.topic, stage);
const metaDirOf = (fx: Fixture, stage: string) => path.join(stageDirOf(fx, stage), '_meta');
const runJsonPath = (fx: Fixture, stage: string, runId: string) => path.join(metaDirOf(fx, stage), `run-${runId}.json`);

async function readRun(fx: Fixture, stage: string, runId: string): Promise<Record<string, unknown> & { gate: { warnings?: string[] } }> {
  return JSON.parse(await fs.readFile(runJsonPath(fx, stage, runId), 'utf8'));
}

/** `--start --json` 后等到终态；断言各入选侧走了桩（桩指纹只可能由执行适配器的进程写入） */
async function startAndFinish(fx: Fixture, args: string[], stub: StubConfig, sides: string[]): Promise<StartJson> {
  const r = await cli(fx.root, ['review', '--start', ...args, '--json'], stub);
  assert.equal(r.code, EXIT.OK, `--start 失败：\n${r.stdout}\n${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson;
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub, 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${js.run_id} 没有成功收尾（退 ${code}）`);
  const stage = args[args.indexOf('--stage') + 1]!;
  const meta = (await readRun(fx, stage, js.run_id)) as unknown as { critics: Record<string, { cli_version?: string }> };
  for (const side of sides) assert.equal(meta.critics[side]?.cli_version, 'stub/0.0.0', `${side} 侧必须走桩`);
  return js;
}

/** 计划阶段一轮（命令 A），返回 run_id */
async function runPlan(fx: Fixture, extra: string[] = []): Promise<string> {
  const js = await startAndFinish(fx, ['--stage', 'plan', '--topic', fx.topic, '--focus', 'x', '--entry', 'A', ...extra], STUB, ['gemini', 'glm']);
  return js.run_id;
}

/** 计划阶段裁决件：`accept` 里的编号判接受，其余驳回 */
async function writeDisposition(fx: Fixture, runId: string, o: { r?: number; accept: string[]; driver?: string }): Promise<void> {
  const driver = o.driver ?? 'claude';
  const r = o.r ?? 1;
  const seg = r > 1 ? `r${r}-` : '';
  const row = (id: string, src: string) => o.accept.includes(id)
    ? `| ${id} | ${src} | blocker | 接受 | 确实漏了这一处，需要补 | 新一轮计划 §1 |`
    : `| ${id} | ${src} | blocker | 驳回 | 该分支上游已拒绝，证据见 src/a.ts | 不改 |`;
  await fs.writeFile(
    path.join(stageDirOf(fx, 'plan'), `${today()}-${fx.topic}-${seg}revised-${driver}.md`),
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
    path.join(stageDirOf(fx, 'plan'), name),
    ['# 计划 r' + r, '', '相对上一轮的改动：', ...ids.map((id) => `- ${id}：按建议补上`), ''].join('\n'),
    'utf8',
  );
  return name;
}

async function planGateOk(fx: Fixture): Promise<void> {
  const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--json']);
  assert.equal(r.code, EXIT.OK, `计划闸门应通过：\n${r.stdout}\n${r.stderr}`);
}

/** 让代码阶段的补丁非空 */
const touchSource = (fx: Fixture) => fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');

const planRel = (fx: Fixture, name: string) => `.reviews/${fx.topic}/plan/${name}`;
const section4 = (b: string): string => b.slice(b.indexOf('## 4. '), b.indexOf('## 5. '));
const briefOf = (fx: Fixture, critic: string, runId: string) =>
  fs.readFile(path.join(metaDirOf(fx, 'code'), `brief-${critic}-${runId}.md`), 'utf8');

const CODE_ARGS = (fx: Fixture) => ['--entry', 'C', '--stage', 'code', '--topic', fx.topic, '--focus', 'x'];

/** 第 1 轮两条全接受、r2 齐全、计划闸门通过 */
async function planPassed(fx: Fixture): Promise<string> {
  const runId = await runPlan(fx);
  await writeDisposition(fx, runId, { accept: ['AGY-01', 'GLM-01'] });
  await writePlan(fx, 2, ['AGY-01', 'GLM-01']);
  await planGateOk(fx);
  return runId;
}

test('C1 · 定稿合入了全部接受编号 ⇒ 代码 --start 无复核告警，第 4 段列 r2，run.json 无该条', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c1' });
  await planPassed(fx);
  await touchSource(fx);
  const js = await startAndFinish(fx, CODE_ARGS(fx), STUB, ['gemini', 'glm']);
  assert.deepEqual(js.warnings.filter((w) => w.name === RECHECK), [], JSON.stringify(js.warnings));
  assert.ok(section4(await briefOf(fx, 'gemini', js.run_id)).includes(planRel(fx, `${today()}-${fx.topic}-r2-claude.md`)));
  assert.ok(!((await readRun(fx, 'code', js.run_id)).gate.warnings ?? []).some((w) => w.includes('复核')));
});

test('C2 · 闸门通过后另写 r3 漏 GLM-01 ⇒ --start 告警、run.json 留痕、代码 gate --check 以 run_warning 回灌；第 4 段照常列 r3、无标注', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c2' });
  const planRun = await planPassed(fx);
  const r3 = await writePlan(fx, 3, ['AGY-01']);
  await touchSource(fx);
  const js = await startAndFinish(fx, CODE_ARGS(fx), STUB, ['gemini', 'glm']);

  const w = js.warnings.filter((x) => x.name === RECHECK);
  assert.equal(w.length, 1, JSON.stringify(js.warnings));
  const d = w[0]!.detail;
  assert.ok(d.startsWith(MARK), d);
  assert.ok(d.includes(`本主题计划定稿 ${planRel(fx, r3)} 没有通过复核`), d);
  assert.ok(d.includes(`计划阶段第 1 轮（run ${planRun}）`), d);
  assert.ok(d.includes('涉及编号：GLM-01。'), '只列缺的编号');

  const plain = d.slice(MARK.length);
  assert.ok((await readRun(fx, 'code', js.run_id)).gate.warnings?.includes(plain), 'run.json gate.warnings 要留这一笔（去掉前缀）');

  const s4 = section4(await briefOf(fx, 'gemini', js.run_id));
  assert.ok(s4.includes(planRel(fx, r3)), `定稿照常列入：\n${s4}`);
  assert.ok(!s4.includes('复核') && !s4.includes('GLM-01'), `第 4 段不标注、不带编号：\n${s4}`);

  // 还没写应答件：gate --check 判缺裁决件，但运行期标注排在一切早退之前，照样回灌
  const g = await cli(fx.root, ['gate', '--stage', 'code', '--topic', fx.topic, '--check', '--json']);
  const gj = JSON.parse(extractJsonCandidate(g.stdout)!.json) as { warnings: { code: string; message: string }[] };
  assert.ok(gj.warnings.some((x) => x.code === 'run_warning' && x.message === plain), JSON.stringify(gj.warnings));
});

test('C3 · 同 C2 走同步 review --stage code：同步输出与 run.json 都有该条', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c3' });
  await planPassed(fx);
  const r3 = await writePlan(fx, 3, ['AGY-01']);
  await touchSource(fx);
  const r = await cli(fx.root, ['review', '--stage', 'code', '--topic', fx.topic, '--focus', 'x', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, `同步 review 失败：\n${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(extractJsonCandidate(r.stdout)!.json) as { warnings: string[] };
  const w = out.warnings.filter((x) => x.includes('没有通过复核'));
  assert.equal(w.length, 1, JSON.stringify(out.warnings));
  assert.ok(w[0]!.includes(planRel(fx, r3)) && w[0]!.includes('涉及编号：GLM-01。'), w[0]);
  assert.ok(!w[0]!.startsWith(MARK), '同步通道是纯文本（去前缀）');
  const runs = (await fs.readdir(metaDirOf(fx, 'code'))).filter((f) => /^run-.+\.json$/.test(f));
  assert.equal(runs.length, 1, runs.join(', '));
  const meta = JSON.parse(await fs.readFile(path.join(metaDirOf(fx, 'code'), runs[0]!), 'utf8')) as { gate: { warnings?: string[] } };
  assert.ok(meta.gate.warnings?.includes(w[0]!), JSON.stringify(meta.gate.warnings));
});

test('C4 · 有接受项、没有任何新一轮计划 ⇒ 告警点名应写的 r2 与两条编号', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c4' });
  const runId = await runPlan(fx);
  await writeDisposition(fx, runId, { accept: ['AGY-01', 'GLM-01'] });
  await touchSource(fx);
  const js = await startAndFinish(fx, CODE_ARGS(fx), STUB, ['gemini', 'glm']);
  const w = js.warnings.filter((x) => x.name === RECHECK);
  assert.equal(w.length, 1, JSON.stringify(js.warnings));
  assert.ok(w[0]!.detail.includes(`请写 ${today()}-${fx.topic}-r2-claude.md`), w[0]!.detail);
  assert.ok(w[0]!.detail.includes('涉及编号：AGY-01、GLM-01。'), w[0]!.detail);
  assert.ok(w[0]!.detail.includes(planRel(fx, `${today()}-${fx.topic}-claude.md`)), '点名代码阶段实际读到的定稿（原稿）');
});

test('C5 · 第 1 轮接受且 r2 齐、第 2 轮全部驳回，之后写 r3 漏编号 ⇒ 不复核、无告警', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c5' });
  await planPassed(fx);
  const run2 = await runPlan(fx);
  assert.deepEqual((await readRun(fx, 'plan', run2))['plan_final_check'], { subject_rerun_index: 2 });
  await writeDisposition(fx, run2, { r: 2, accept: [] });
  await planGateOk(fx);
  await writePlan(fx, 3, []);
  await touchSource(fx);
  const js = await startAndFinish(fx, CODE_ARGS(fx), STUB, ['gemini', 'glm']);
  assert.deepEqual(js.warnings.filter((w) => w.name === RECHECK), [], JSON.stringify(js.warnings));
});

test('C6 · 旧运行（run.json 没有标记）有接受项、没有 r2 ⇒ 不复核、无告警', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c6' });
  const runId = await runPlan(fx);
  const meta = await readRun(fx, 'plan', runId);
  delete meta['plan_final_check'];
  await fs.writeFile(runJsonPath(fx, 'plan', runId), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await writeDisposition(fx, runId, { accept: ['AGY-01'] });
  await touchSource(fx);
  const js = await startAndFinish(fx, CODE_ARGS(fx), STUB, ['gemini', 'glm']);
  assert.deepEqual(js.warnings.filter((w) => w.name === RECHECK), [], JSON.stringify(js.warnings));
});

test('C7 · 计划与代码阶段都由 codex 执笔：claude 后缀的 r2 齐全不算，告警点名漏编号的 -r2-codex.md', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c7', draft: false });
  await fs.mkdir(stageDirOf(fx, 'plan'), { recursive: true });
  await fs.writeFile(path.join(stageDirOf(fx, 'plan'), `${today()}-${fx.topic}-codex.md`), '# codex 执笔的原稿\n', 'utf8');
  for (const stage of ['plan', 'code']) {
    const c = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', stage, '--driver', 'codex', '--json']);
    assert.equal(c.code, EXIT.OK, c.stderr);
  }
  const runId = await runPlan(fx, ['--driver', 'codex', '--critics', 'gemini,glm']);
  await writeDisposition(fx, runId, { accept: ['AGY-01'], driver: 'codex' });
  await writePlan(fx, 2, ['AGY-01'], 'claude');
  const codexR2 = await writePlan(fx, 2, [], 'codex');
  await touchSource(fx);
  const js = await startAndFinish(fx, [...CODE_ARGS(fx), '--driver', 'codex', '--critics', 'gemini,glm'], STUB, ['gemini', 'glm']);
  const w = js.warnings.filter((x) => x.name === RECHECK);
  assert.equal(w.length, 1, JSON.stringify(js.warnings));
  assert.ok(w[0]!.detail.includes(`本主题计划定稿 ${planRel(fx, codexR2)} 没有通过复核`), w[0]!.detail);
  assert.ok(w[0]!.detail.includes('$dual-review-plan'), '处置写法按代码阶段 Driver（codex）');
  assert.ok(!w[0]!.detail.includes('-r2-claude.md'), w[0]!.detail);
});

test('C8 · 计划 codex、代码 claude：复核告警排第一，其后是 gemini / glm 两侧对计划定稿的剔除告警（计划双审 CODEX-01）', { skip }, async () => {
  const fx = await makeFixture({ topic: 'pfr-c8', draft: false });
  await fs.mkdir(stageDirOf(fx, 'plan'), { recursive: true });
  await fs.writeFile(path.join(stageDirOf(fx, 'plan'), `${today()}-${fx.topic}-codex.md`), '# codex 执笔的原稿\n', 'utf8');
  const c = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', 'plan', '--driver', 'codex', '--json']);
  assert.equal(c.code, EXIT.OK, c.stderr);
  const runId = await runPlan(fx, ['--driver', 'codex', '--critics', 'gemini,glm']);
  await writeDisposition(fx, runId, { accept: ['AGY-01', 'GLM-01'], driver: 'codex' });
  const codexR2 = await writePlan(fx, 2, ['AGY-01'], 'codex');
  await touchSource(fx);
  const js = await startAndFinish(
    fx, [...CODE_ARGS(fx), '--driver', 'claude', '--critics', 'codex,gemini,glm'], STUB3, ['codex', 'gemini', 'glm'],
  );
  const entry = planRel(fx, codexR2);
  assert.ok(js.warnings.length >= 2, JSON.stringify(js.warnings));
  assert.equal(js.warnings[0]!.name, RECHECK, JSON.stringify(js.warnings.map((w) => w.name)));
  assert.ok(js.warnings[0]!.detail.includes('涉及编号：GLM-01。'), js.warnings[0]!.detail);
  const prunedIdx = js.warnings.findIndex((w) => w.name === '必读清单剔除' && w.detail.includes(`「${entry}」（来源：本主题计划定稿）`));
  assert.ok(prunedIdx > 0, `剔除告警要在场且排在复核告警之后：${JSON.stringify(js.warnings.map((w) => w.name))}`);
  const gw = (await readRun(fx, 'code', js.run_id)).gate.warnings ?? [];
  assert.ok(gw[0]?.includes('没有通过复核') && gw.some((x) => x.includes(`「${entry}」（来源：本主题计划定稿）`)), JSON.stringify(gw));
});
