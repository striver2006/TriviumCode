import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

/**
 * 闸门闭环（AC-01 / AC-02 / AC-12 / 设计 §8.5）：
 * 双审完成 → 两个 Hook 拦住提交与收工 → 裁决齐备 → 闸门放行 → Hook 放行。
 *
 * ## 为什么这个用例必须存在
 *
 * 实测发现过：`review` 只把闸门状态写进 `run.json`，而四个 Hook 全是读
 * `state.json`（listOpenGates）判定的。于是 `state.json` 压根没被创建，
 * `hook-pre-write` / `hook-pre-commit` / `hook-stop` **三个 Hook 一律退 0**——
 * 「裁决未齐备不得提交、不得收工」这条整条流水线最核心的护栏静默失效，
 * 而单元测试全绿（它们直接调 hookXxx 并手工 setGate，绕过了这个缺口）。
 *
 * 所以这里必须走真实 CLI，从 review 一路验到 Hook 的退出码。
 */

const TOPIC = '闸门闭环';
const SESSION = 'S-闭环';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

/** 以 Hook 身份调用，从 stdin 喂事件 JSON */
async function hook(root: string, name: string, input: unknown) {
  const { run } = await import('../../src/trivium/util/exec.js');
  const { BUNDLE, ASSET_ROOT } = await import('../helpers/fixture.js');
  return run(process.execPath, [BUNDLE, 'gate', name], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, CLAUDE_SESSION_ID: SESSION, TRIVIUM_STUB_CRITIC: undefined },
    stdin: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}

const commitEvent = {
  session_id: SESSION,
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m x' },
};
const writeEvent = (p: string) => ({
  session_id: SESSION,
  tool_name: 'Write',
  tool_input: { file_path: p },
});

async function runPlan(root: string) {
  const started = await cli(
    root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    STUB,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '20'], STUB, 60_000);
    code = w.code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK);
  return js.run_id;
}

/** 按桩产出的编号写一份合规裁决件 */
async function writeDisposition(stageDir: string, runId: string) {
  await fs.writeFile(
    path.join(stageDir, `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 同一处问题，一并补上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );
}

test('review 必须把闸门写进 state.json，否则四个 Hook 全都无事可判', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root);

  const state = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string; session_id: string | null; run_id: string | null }>;
  };
  const gate = state.gates[`${TOPIC}/plan`];
  assert.ok(gate, `state.json 里没有闸门条目：${JSON.stringify(state.gates)}`);
  assert.equal(gate.state, 'review_done_awaiting_disposition');
  assert.equal(gate.session_id, SESSION, '缺会话 id 时写锁作用域判不出来，护栏会静默失效');
  assert.ok(gate.run_id);
});

test('裁决未齐备 → hook-pre-commit 退 2 并点名主题（AC-12）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root);

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `应拦下提交：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, new RegExp(TOPIC), '必须说清是哪个主题挡住的');
  assert.match(r.stderr, /gate --stage <阶段> --check/, '必须给出解法');
});

test('裁决未齐备 → hook-stop 阻止收工（AC-02）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root);

  const r = await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' });
  assert.equal(r.code, EXIT.GATE_BLOCK);
  const out = JSON.parse(r.stdout.trim().split('\n')[0]!) as { decision: string; reason: string };
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /未逐条裁决/);
});

test('裁决齐备并通过校验 → 闸门回 idle，两个 Hook 一起放行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root);
  await writeDisposition(fx.stageDir, runId);

  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `裁决校验应通过：\n${check.stdout}${check.stderr}`);

  const state = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(
    state.gates[`${TOPIC}/plan`]?.state,
    'idle',
    '校验通过后必须放行——否则补齐裁决的人依然被拦，只能去关 Hook',
  );

  for (const [name, ev] of [['hook-pre-commit', commitEvent], ['hook-stop', { session_id: SESSION }]] as const) {
    const r = await hook(fx.root, name, ev);
    assert.equal(r.code, EXIT.OK, `${name} 应放行：\n${r.stdout}${r.stderr}`);
  }

  // AC-01：四件套齐备
  const arts = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check-artifacts']);
  assert.equal(arts.code, EXIT.OK, `${arts.stdout}${arts.stderr}`);
});

test('裁决件不完整 → 校验不放行，闸门保持拦截', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root);

  // 只裁决了 AGY-01，漏掉 GLM-01
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 补上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );

  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.GATE_BLOCK);
  assert.match(check.stdout + check.stderr, /GLM-01/, '必须点名漏掉的编号');

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, '校验没过就不该放行');
});

test('审查进行中禁写业务文件，但归档内的裁决件不拦（§8.5）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });

  // 只 --start，不 --wait：此时闸门处于 running
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    // 注入超时让 worker 挂着，闸门停在 running
    { gemini: { mode: 'timeout' }, glm: { mode: 'timeout' } },
  );
  assert.equal(started.code, EXIT.OK);

  const state = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(state.gates[`${TOPIC}/plan`]?.state, 'running');

  const biz = await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.root, 'src/a.ts')));
  assert.equal(biz.code, EXIT.GATE_BLOCK, `审查期改业务文件会造成快照漂移：\n${biz.stdout}${biz.stderr}`);

  // 裁决件要写进归档，绝不能拦——否则 Driver 无路可走
  const disp = await hook(
    fx.root, 'hook-pre-write',
    writeEvent(path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`)),
  );
  assert.equal(disp.code, EXIT.OK, '归档内的写入不受闸门写锁约束');
});

test('伪造角色后缀文件一律拦下，与闸门状态无关（AC-07）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // 全新仓库，没有任何闸门
  for (const name of [`${today()}-${TOPIC}-gemini.md`, `${today()}-${TOPIC}-glm.md`]) {
    const r = await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.stageDir, name)));
    assert.equal(r.code, EXIT.GATE_BLOCK, `${name} 只能由编排器落盘`);
    assert.match(r.stderr, /不得自行产出/);
  }
});

// ── 留痕完整性：删不掉也改不掉（§17.3 剧本 5 / P5 / P6）──

/** 跑完一轮 plan 并补齐裁决，把闸门推回 idle */
async function completedRound(root: string, stageDir: string) {
  const runId = await runPlan(root);
  await writeDisposition(stageDir, runId);
  const check = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);
  const ok = await hook(root, 'hook-pre-commit', commitEvent);
  assert.equal(ok.code, EXIT.OK, `基线状态应放行：\n${ok.stdout}${ok.stderr}`);
  return runId;
}

test('删掉一份审查文档后提交被拦（§17.3 剧本 5）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);

  const victim = path.join(fx.stageDir, `${today()}-${TOPIC}-gemini.md`);
  const saved = await fs.readFile(victim);
  await fs.rm(victim);

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  /*
   * 这条路径**不可能**靠闸门状态拦住：裁决已通过，闸门早回了 idle。
   * 删掉一份不顺眼的审查再提交，在修复前是一路绿灯的。
   */
  assert.equal(r.code, EXIT.GATE_BLOCK, `应拦下：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /已丢失/);
  assert.match(r.stderr, new RegExp(`${TOPIC}/plan/.*-gemini\\.md`));
  assert.match(r.stderr, /git checkout|git restore/, '必须给出恢复办法');
  assert.match(r.stderr, /dual-abandon/, '必须给出「确实要作废」的正当出口');

  // 恢复即放行
  await fs.writeFile(victim, saved);
  const after = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(after.code, EXIT.OK, `恢复后应放行：\n${after.stderr}`);
});

test('改动已落盘的审查文档后提交同样被拦', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);

  const victim = path.join(fx.stageDir, `${today()}-${TOPIC}-glm.md`);
  await fs.appendFile(victim, '\n<!-- 偷偷加一行 -->\n', 'utf8');

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `内容变了也要拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /已被改动/);
  // 报出前后哈希，让人能确认到底改了什么
  assert.match(r.stderr, /记录 [0-9a-f]{12}，现为 [0-9a-f]{12}/);
});

test('重跑抬升的新工件不会被误判——旧工件仍在即放行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);

  // 第二轮：产出 -r2，第一轮文件字节不变
  const runId2 = await runPlan(fx.root);
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-r2-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId2}`,
      'addresses:',
      `  - ${today()}-${TOPIC}-r2-gemini.md`, `  - ${today()}-${TOPIC}-r2-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 第二轮仍需补 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 同上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.OK, `两轮工件都在，应放行：\n${r.stderr}`);
});

test('尚未落盘的工件不算「丢失」——只拦记录在案的', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // 从没跑过任何审查：归档里只有原稿。这不是留痕缺失，不该拦
  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.OK, `没有任何记录在案的工件时不该拦：\n${r.stderr}`);
});

test('gate.block_commit 为 false 时完全不拦（用户显式关掉的开关要生效）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);
  await fs.rm(path.join(fx.stageDir, `${today()}-${TOPIC}-gemini.md`));

  await fs.appendFile(
    path.join(fx.root, '.trivium/config.yaml'),
    'gate:\n  block_commit: false\n',
    'utf8',
  );
  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.OK, '配置关掉了拦截就该真的不拦——护栏也要可被知情地关掉');
});
