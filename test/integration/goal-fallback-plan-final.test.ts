/**
 * 任务目标第三级回退取计划定稿 · 调用链（EV-212，目标回退取计划定稿计划 r2 §4.2）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。全部格子都不带 `--goal`、任务文件无目标，于是第 4 段的任务目标
 * 只能来自第三级：本主题计划定稿（`resolvePlanFinal`：计划阶段执笔方、轮次最大的一份）的首个标题/首段。
 * - G1 / G2：计划阶段 codex、代码 / bug 阶段 claude ⇒ 取到 codex 那份定稿的标题（修前静默为空）；
 * - G3：计划与代码同为 codex ⇒ 照旧取到，不取 claude 后缀那份；
 * - G4：缺省执笔方 ⇒ 取 r2 标题（与修前同值）；
 * - G5：计划阶段留痕读不出 ⇒ 不取、不拒跑，bug 阶段不补告警，代码阶段告警不叠加；
 * - G6：计划阶段 codex、目录里只有 claude 后缀那份 ⇒ 不取（修前会误取）。
 * 纯函数一层在 `test/unit/task-goal.test.ts`（T1～T7）。
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
/** 夹具钉的缺省入选侧（`default_critics: [gemini, glm]`） */
const TWO = ['gemini', 'glm'] as const;

type StartJson = { run_id: string; warnings: { name: string; detail: string }[] };

/**
 * `--start --json` 成功后把运行等到终态，再逐个入选侧断言桩指纹（代码双审 CODEX-02）：本套件的断言面
 * （第 4 段目标行、run.json `task_goal`、warnings）都在审查员执行之前由编排器写出，桩注入静默失效时真实 CLI 跑完退 0
 * 也会让它们照过——只有指纹能证明没有拉起真实审查员。
 */
async function startAndFinish(fx: Fixture, stage: string, critics: readonly string[], args: string[], stub: StubConfig = STUB): Promise<StartJson> {
  const r = await cli(fx.root, ['review', '--start', ...args, '--json'], stub);
  assert.equal(r.code, EXIT.OK, `--start 失败：\n${r.stdout}\n${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson;
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${js.run_id} 没有成功收尾（退 ${code}）`);
  const meta = JSON.parse(await fs.readFile(path.join(metaDirOf(fx, stage), `run-${js.run_id}.json`), 'utf8')) as {
    critics: Record<string, { cli_version?: string }>;
  };
  assert.deepEqual(Object.keys(meta.critics).sort(), [...critics].sort(), '入选侧与预期不符');
  for (const side of critics) assert.equal(meta.critics[side]?.cli_version, 'stub/0.0.0', `${side} 侧必须走桩`);
  return js;
}

const metaDirOf = (fx: Fixture, stage: string) => path.join(fx.archiveRoot, fx.topic, stage, '_meta');
const briefOf = (fx: Fixture, stage: string, critic: string, runId: string) =>
  fs.readFile(path.join(metaDirOf(fx, stage), `brief-${critic}-${runId}.md`), 'utf8');
const section4 = (b: string): string => b.slice(b.indexOf('## 4. '), b.indexOf('## 5. '));
const runTaskGoal = async (fx: Fixture, stage: string, runId: string) =>
  (JSON.parse(await fs.readFile(path.join(metaDirOf(fx, stage), `run-${runId}.json`), 'utf8')) as { task_goal: string | null }).task_goal;
const taskGoalOnDisk = async (fx: Fixture) =>
  (JSON.parse(await fs.readFile(path.join(fx.archiveRoot, fx.topic, 'task.json'), 'utf8')) as { goal: string | null }).goal;

async function claim(fx: Fixture, stage: string, driver: string): Promise<void> {
  const r = await cli(fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', stage, '--driver', driver, '--json']);
  assert.equal(r.code, EXIT.OK, r.stderr);
}

async function writePlanFiles(fx: Fixture, files: Record<string, string>): Promise<void> {
  const dir = path.join(fx.archiveRoot, fx.topic, 'plan');
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), body);
  }
}

/**
 * 代码阶段夹具：不预置原稿；`planDriver` 非空时先声明计划阶段（在写计划文件之前，免得撞上别家后缀退 64），
 * 再写计划目录，最后改一个源文件让 `git diff` 非空。
 */
async function codeFixture(topic: string, planFiles: Record<string, string>, planDriver: string | null = null): Promise<Fixture> {
  const fx = await makeFixture({ topic, draft: false });
  if (planDriver) await claim(fx, 'plan', planDriver);
  await writePlanFiles(fx, planFiles);
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
  return fx;
}

/** bug 阶段夹具：bug 目录预置 claude 的根因原稿，其余同上 */
async function bugFixture(topic: string, planFiles: Record<string, string>, planDriver: string | null = null): Promise<Fixture> {
  const fx = await makeFixture({ topic, draftStage: 'bug' });
  if (planDriver) await claim(fx, 'plan', planDriver);
  await writePlanFiles(fx, planFiles);
  return fx;
}

const GOAL_LINE = '任务目标：';

async function assertGoal(fx: Fixture, stage: string, runId: string, critics: readonly string[], expected: string | null) {
  for (const c of critics) {
    const s4 = section4(await briefOf(fx, stage, c, runId));
    if (expected === null) {
      assert.ok(!s4.includes(GOAL_LINE), `${c} 侧第 4 段不该有任务目标行：\n${s4}`);
    } else {
      assert.ok(s4.includes(`${GOAL_LINE}${expected}\n`), `${c} 侧第 4 段要取到「${expected}」：\n${s4}`);
    }
  }
  assert.equal(await runTaskGoal(fx, stage, runId), expected, 'run.json task_goal 要与第 4 段同值');
  assert.equal(await taskGoalOnDisk(fx), null, '推导出的目标不得写回任务文件');
}

const codexPlan = (topic: string) => ({
  [`${today()}-${topic}-codex.md`]: '# codex 原稿标题\n',
  [`${today()}-${topic}-r2-codex.md`]: '# codex 定稿标题\n\n正文\n',
});

test('G1 · 计划 codex、代码 claude、无目标 ⇒ 三侧第 4 段取到 codex 那份定稿的标题', { skip }, async () => {
  const topic = 'tgp-g1';
  const fx = await codeFixture(topic, codexPlan(topic), 'codex');
  const js = await startAndFinish(
    fx,
    'code',
    ['codex', 'gemini', 'glm'],
    ['--entry', 'C', '--stage', 'code', '--topic', topic, '--focus', 'x', '--driver', 'claude', '--critics', 'codex,gemini,glm'],
    STUB3,
  );
  await assertGoal(fx, 'code', js.run_id, ['codex', 'gemini', 'glm'], 'codex 定稿标题');
});

test('G2 · 计划 codex、bug 阶段 claude、无目标 ⇒ 两侧第 4 段取到同一标题，不出计划定稿相关告警', { skip }, async () => {
  const topic = 'tgp-g2';
  const fx = await bugFixture(topic, codexPlan(topic), 'codex');
  const js = await startAndFinish(fx, 'bug', TWO, ['--entry', 'D', '--stage', 'bug', '--topic', topic, '--focus', 'x']);
  await assertGoal(fx, 'bug', js.run_id, ['gemini', 'glm'], 'codex 定稿标题');
  assert.deepEqual(js.warnings.filter((w) => w.detail.includes('计划定稿')), [], JSON.stringify(js.warnings));
});

test('G3 · 计划与代码同为 codex ⇒ 照旧取 codex 定稿，不取 claude 后缀那份', { skip }, async () => {
  const topic = 'tgp-g3';
  const fx = await codeFixture(topic, { ...codexPlan(topic), [`${today()}-${topic}-r2-claude.md`]: '# 别家后缀\n' }, 'codex');
  await claim(fx, 'code', 'codex');
  const js = await startAndFinish(fx, 'code', TWO, ['--entry', 'C', '--stage', 'code', '--topic', topic, '--focus', 'x', '--driver', 'codex', '--critics', 'gemini,glm']);
  await assertGoal(fx, 'code', js.run_id, ['gemini', 'glm'], 'codex 定稿标题');
});

const claudePlan = (topic: string) => ({
  [`${today()}-${topic}-claude.md`]: '# claude 原稿标题\n',
  [`${today()}-${topic}-r2-claude.md`]: '# claude 定稿标题\n',
});

test('G4 · 缺省执笔方：代码与 bug 阶段都取 r2 标题（与修前同值）', { skip }, async () => {
  const c = await codeFixture('tgp-g4c', claudePlan('tgp-g4c'));
  const jc = await startAndFinish(c, 'code', TWO, ['--entry', 'C', '--stage', 'code', '--topic', c.topic, '--focus', 'x']);
  await assertGoal(c, 'code', jc.run_id, ['gemini', 'glm'], 'claude 定稿标题');

  const b = await bugFixture('tgp-g4b', claudePlan('tgp-g4b'));
  const jb = await startAndFinish(b, 'bug', TWO, ['--entry', 'D', '--stage', 'bug', '--topic', b.topic, '--focus', 'x']);
  await assertGoal(b, 'bug', jb.run_id, ['gemini', 'glm'], 'claude 定稿标题');
});

const corruptPlan = (topic: string) => ({
  [`${today()}-${topic}-r2-claude.md`]: '# 不该被取到\n',
  '_meta/run-20261005T000000Z.json': '{ 坏',
});

test('G5 · 计划阶段留痕读不出：bug 阶段照常跑完、无目标行、无告警；代码阶段无目标行、告警只有既有一条', { skip }, async () => {
  const b = await bugFixture('tgp-g5b', corruptPlan('tgp-g5b'));
  const jb = await startAndFinish(b, 'bug', TWO, ['--entry', 'D', '--stage', 'bug', '--topic', b.topic, '--focus', 'x']);
  await assertGoal(b, 'bug', jb.run_id, ['gemini', 'glm'], null);
  assert.deepEqual(jb.warnings.filter((w) => w.detail.includes('计划定稿')), [], JSON.stringify(jb.warnings));

  const c = await codeFixture('tgp-g5c', corruptPlan('tgp-g5c'));
  const jc = await startAndFinish(c, 'code', TWO, ['--entry', 'C', '--stage', 'code', '--topic', c.topic, '--focus', 'x']);
  await assertGoal(c, 'code', jc.run_id, ['gemini', 'glm'], null);
  const planWarnings = jc.warnings.filter((w) => w.detail.includes('计划定稿'));
  assert.equal(planWarnings.length, 1, JSON.stringify(jc.warnings));
  assert.equal(planWarnings[0]!.name, '必读清单未列计划定稿');
});

test('G6 · 别家后缀不误取：计划 codex、目录里只有 claude 后缀那份 ⇒ 代码阶段无目标行', { skip }, async () => {
  const topic = 'tgp-g6';
  const fx = await codeFixture(topic, { [`${today()}-${topic}-claude.md`]: '# 别家后缀的计划\n' }, 'codex');
  const js = await startAndFinish(fx, 'code', TWO, ['--entry', 'C', '--stage', 'code', '--topic', topic, '--focus', 'x', '--driver', 'claude']);
  await assertGoal(fx, 'code', js.run_id, ['gemini', 'glm'], null);
});
