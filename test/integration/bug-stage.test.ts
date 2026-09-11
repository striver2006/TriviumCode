import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

/**
 * `bug` 阶段（命令 D，FR-22 / AC-14 / AC-15）。
 *
 * 结构上与 plan 同构（被审对象都是一份 `-claude.md` 原稿），所以这些用例的重点
 * 不是「能不能跑」，而是**它确实是独立的一条阶段**：
 * 工件落在 `bug/`、裁决件后缀是 `-revised-`、闸门按 bug 阶段单独校验。
 * §FR-22 明确要求命令 D 不得由 A 或 C 代替，而「代替」在实现上的样子就是
 * 工件落错目录或闸门查错阶段。
 */

const TOPIC = '根因主题';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

async function bugFixture() {
  const fx = await makeFixture({ topic: TOPIC, draftStage: 'bug' });
  return { ...fx, bugDir: path.join(fx.archiveRoot, TOPIC, 'bug') };
}

async function runStage(root: string, stage: string, stageDir: string) {
  const started = await cli(
    root,
    ['review', '--start', '--stage', stage, '--topic', TOPIC, '--focus', '查根因', '--json'],
    STUB,
  );
  assert.equal(started.code, EXIT.OK, `--start 失败：\n${started.stdout}\n${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };

  let exitCode: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '20'], STUB, 60_000);
    exitCode = w.code ?? EXIT.FAIL;
  }
  const meta = JSON.parse(
    await fs.readFile(path.join(stageDir, '_meta', `run-${js.run_id}.json`), 'utf8'),
  ) as RunMeta;
  return { exitCode, meta, runId: js.run_id };
}

test('bug 阶段双审：工件落 bug/，不串到 plan/', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await bugFixture();
  const { exitCode, meta } = await runStage(fx.root, 'bug', fx.bugDir);

  assert.equal(exitCode, EXIT.OK);
  assert.equal(meta.stage, 'bug');

  const docs = await fs.readdir(fx.bugDir);
  assert.ok(docs.some((f) => f.endsWith('-gemini.md')), `实际：${docs.join(', ')}`);
  assert.ok(docs.some((f) => f.endsWith('-glm.md')));

  // plan/ 目录根本不该被创建——命令 D 是独立阶段，不借道 plan
  await assert.rejects(
    () => fs.readdir(path.join(fx.archiveRoot, TOPIC, 'plan')),
    /ENOENT/,
    'bug 阶段不得在 plan/ 下产生任何东西',
  );
});

test('缺根因原稿 → 退 65，提示用 --rca-file', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC, draft: false });
  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'bug', '--topic', TOPIC, '--focus', 'x'],
    STUB,
  );
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /--rca-file/);
});

test('bug 阶段的最低工件集：缺裁决件即退 65，补上即通过（AC-15）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await bugFixture();
  await runStage(fx.root, 'bug', fx.bugDir);

  const before = await cli(fx.root, ['gate', '--stage', 'bug', '--topic', TOPIC, '--check-artifacts']);
  assert.equal(before.code, EXIT.MISSING_ARTIFACT, '此时还没有裁决件');
  assert.match(before.stdout + before.stderr, /revised-claude/);

  // 补一份修订根因件。注意后缀是 -revised-（code 阶段才是 -response-）
  await fs.writeFile(
    path.join(fx.bugDir, `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: bug',
      'role: claude', 'kind: revised', 'run_id: R', 'addresses: []', '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了并发路径 | §二 补充 |',
      '',
    ].join('\n'),
    'utf8',
  );

  const after = await cli(fx.root, ['gate', '--stage', 'bug', '--topic', TOPIC, '--check-artifacts']);
  assert.equal(after.code, EXIT.OK, `${after.stdout}${after.stderr}`);
});

test('原稿不被修订件覆盖，字节不变（AC-15）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await bugFixture();
  const draft = path.join(fx.bugDir, `${today()}-${TOPIC}-claude.md`);
  const before = await fs.readFile(draft);

  await runStage(fx.root, 'bug', fx.bugDir);
  assert.deepEqual(await fs.readFile(draft), before, '根因原稿必须逐字节不变');
});

test('bug 阶段重跑抬升 -r2，原文件不覆盖', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await bugFixture();
  await runStage(fx.root, 'bug', fx.bugDir);
  const first = path.join(fx.bugDir, `${today()}-${TOPIC}-gemini.md`);
  const bytes = await fs.readFile(first);

  await runStage(fx.root, 'bug', fx.bugDir);
  assert.deepEqual(await fs.readFile(first), bytes);
  const docs = await fs.readdir(fx.bugDir);
  assert.ok(docs.includes(`${today()}-${TOPIC}-r2-gemini.md`), `实际：${docs.join(', ')}`);
});

test('三个阶段的闸门各自独立——bug 齐备不代表 plan 齐备', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await bugFixture();
  await runStage(fx.root, 'bug', fx.bugDir);

  // plan 阶段什么都没有，闸门必须仍然报缺
  const plan = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check-artifacts']);
  assert.equal(plan.code, EXIT.MISSING_ARTIFACT, 'bug 阶段的工件不能算到 plan 头上');
});
