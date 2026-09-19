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

async function runPlan(root: string, entry?: 'A' | 'B' | 'C' | 'D') {
  const started = await cli(
    root,
    [
      'review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x',
      ...(entry ? ['--entry', entry] : []),
      '--session-id', SESSION, '--json',
    ],
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

test('双方共同 blocker 被驳回 → task.json 记 disputed，status 显示争议（§6.6 规则 7）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root);
  // 桩两侧的第 1 条都是 blocker 且 location 相同（src/stub.ts:10）：全部驳回即命中判据 g
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 驳回 | 该路径已被上游 src/x.ts:31 拒绝 | |',
      '| GLM-01 | glm | blocker | 驳回 | 同上，上游已处理 | |',
      '',
    ].join('\n'),
    'utf8',
  );
  const g = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  assert.equal(g.code, EXIT.OK, `默认 warn 策略下不阻断：\n${g.stdout}${g.stderr}`);
  assert.match(g.stdout, /joint_blocker_rejected/);

  const task = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), 'utf8')) as {
    disputed: boolean;
    joint_checks?: { run_id: string; state: string; effective_sides: number }[];
  };
  assert.equal(task.disputed, true, '设计明文要求记 disputed: true，原先从未写入');

  /*
   * 共同阻断三态的**持久面**（r2 代码双审 GLM-02 ≡ CODEX-04）。
   *
   * `checked-found` 只可能在这里出现：run.json 落的是 `pending`（运行期读不到裁决表）。
   * 没有这个落点时，这一态永久只存在于 `gate --check` 的进程内存里——
   * 留痕面上三态塌回两态，而这一档的全部意义就是三态。
   */
  const jc = task.joint_checks?.find((x) => x.run_id === runId);
  assert.equal(jc?.state, 'checked-found', `查过、确有共同项——实得：${JSON.stringify(jc)}`);
  assert.equal(jc?.effective_sides, 2);

  const st = await cli(fx.root, ['status', '--topic', TOPIC, '--json']);
  assert.match(st.stdout, /"disputed":\s*true/);
});

test('无共同驳回 → 三态落 checked-none；run.json 那一侧只到 pending', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * 与上一条互为对照，守的是**三态没有再塌缩**：
   * 「查过、没有共同项」必须与「查过、有共同项」「没查」各占一个取值。
   *
   * 同时咬住运行期那一半：run.json 里这一档只能是 `pending`——
   * 运行结束时裁决表还没写，写 `checked-none` 就是一句给不出的断言
   * （上一版正是这么写的，而它读起来像是查过了）。
   */
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root);
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实是缺陷 | src/a.ts:10 |',
      '| GLM-01 | glm | blocker | 驳回 | 上游已处理 | |',
      '',
    ].join('\n'),
    'utf8',
  );
  const g = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  assert.equal(g.code, EXIT.OK, `${g.stdout}${g.stderr}`);

  const task = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), 'utf8')) as {
    joint_checks?: { run_id: string; state: string }[];
  };
  assert.equal(
    task.joint_checks?.find((x) => x.run_id === runId)?.state,
    'checked-none',
    '两条共同 blocker 里有一条被接受 → 不成立共同驳回，但这一档确实查过了',
  );

  const runMeta = JSON.parse(
    await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), 'utf8'),
  ) as { guard: { joint_check?: { state: string; effective_sides: number } } };
  assert.equal(
    runMeta.guard.joint_check?.state,
    'pending',
    '运行期给不出最终结论：判据的一半在裁决件里，而那时它还没写',
  );
  assert.equal(runMeta.guard.joint_check?.effective_sides, 2);
});

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

/*
 * AGY-02：停点不能靠 Driver 记得走完流程。
 *
 * 原先 `gate --check` 通过后一律落回 idle，把「推进到人工审批态」交给随后那一步
 * `--await-approval`——而那只是 skill 文档里的一行字。Driver 省略它，闸门就停在
 * idle，四个 Hook 全部放行，人工审批被静默旁路；用户此时再走 /dual-approve
 * 反而会因为状态是 idle 被拒。现在按 run.json 的 entry 分流，B/C/D 直接立起闸门。
 */
test('AGY-02：命令 B/C/D 的 check 通过后闸门立起来，省略 --await-approval 也旁路不了', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'C');
  await writeDisposition(fx.stageDir, runId);

  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `裁决校验应通过：\n${check.stdout}${check.stderr}`);

  const gates = () => fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')
    .then((s) => (JSON.parse(s) as { gates: Record<string, { state: string }> }).gates);
  assert.equal((await gates())[`${TOPIC}/plan`]?.state, 'awaiting_approval', '停点必须由机制立起来，不能指望执笔者记得');

  // 此刻业务写入仍被拦
  const denied = await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.root, 'src/a.ts')));
  assert.equal(denied.code, EXIT.GATE_BLOCK, `等待审批期间不得改业务文件：\n${denied.stdout}${denied.stderr}`);

  // 审批后解锁；审批记录留下会话来源（GLM-05）
  const approved = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION]);
  assert.equal(approved.code, EXIT.OK, `${approved.stdout}${approved.stderr}`);
  assert.equal((await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.root, 'src/a.ts')))).code, EXIT.OK, '审批后应解锁');

  const task = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), 'utf8')) as {
    approvals: { decision: string; session_id?: string | null }[];
  };
  assert.equal(task.approvals.at(-1)?.decision, 'approved');
  assert.equal(task.approvals.at(-1)?.session_id, SESSION, '谁解的闸要留痕——这是审批唯一的事后对账手段');
});

test('AGY-05：通过审批必须显式指定 --stage，不能批量放行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'C');
  await writeDisposition(fx.stageDir, runId);
  await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);

  const r = await cli(fx.root, ['approve', '--topic', TOPIC]);
  assert.equal(r.code, EXIT.USAGE, `缺 --stage 应退 64：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /必须显式指定 --stage/);
  // 放弃则允许省略 --stage（收紧动作，语义不同）
  const a = await cli(fx.root, ['abandon', '--topic', TOPIC]);
  assert.equal(a.code, EXIT.OK, `${a.stdout}${a.stderr}`);
});

/*
 * ── EV-24：审批命令不再静默吞掉多余的位置参数与布尔旗标的值 ──
 *
 * 2026-09-16 实撞：`approve … 这是一串决策说明` 退 0，那串文字既没报错也没落盘，
 * 审批记录的 reason 仍是 null。同族：`--reject 理由` 让 reject 拿到字符串、`=== true` 判假，
 * 拒绝静默变通过；`--reject=true` 走 `=` 分支同样判假（计划双审 CODEX-07 ≡ AGY-07 ≡ GLM-04）。
 */
test('EV-24：多余位置参数 / --reject 带值 → 退 64 并指向 --reason；附言经 --reason 落盘', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'C');
  await writeDisposition(fx.stageDir, runId);
  await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);

  const extra = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '决策：按推荐项执行', '附言第二段']);
  assert.equal(extra.code, EXIT.USAGE, `多余位置参数应退 64：\n${extra.stdout}${extra.stderr}`);
  assert.match(extra.stdout + extra.stderr, /多余的位置参数/);
  assert.match(extra.stdout + extra.stderr, /决策：按推荐项执行/, '要把被丢的内容原样列出来');
  assert.match(extra.stdout + extra.stderr, /--reason/, '要指向正确写法');

  const rejectValue = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reject', '理由文字']);
  assert.equal(rejectValue.code, EXIT.USAGE, `--reject 不吃后面的 token，「理由文字」落成多余位置参数退 64：\n${rejectValue.stdout}${rejectValue.stderr}`);

  const rejectEq = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reject=true']);
  assert.equal(rejectEq.code, EXIT.USAGE);
  assert.match(rejectEq.stdout + rejectEq.stderr, /拒绝审批必须给出 --reason/, '--reject=true 必须被识别成拒绝——退 64 的理由得是「缺 reason」而不是被当成通过');

  const badBool = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reject=maybe']);
  assert.equal(badBool.code, EXIT.USAGE);
  assert.match(badBool.stdout + badBool.stderr, /只接受 true\/false/);

  /*
   * 同族第三格（代码双审 r2 CODEX-03）：附言本身以 `--` 开头时，此前 `--reason` 被静默降级成
   * 布尔 true、`flagString` 返回 null、命令退 0 而 reason 落 null——而 skill 正教用户把原文整段
   * 传给 `--reason`，本项目的附言极可能在谈论某个旗标。
   */
  const dashValue = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reason', '--focus 的默认取值说明不准']);
  assert.equal(dashValue.code, EXIT.USAGE, `值以 -- 开头不得静默丢弃：\n${dashValue.stdout}${dashValue.stderr}`);
  assert.match(dashValue.stdout + dashValue.stderr, /--reason=<值>/, '要给出可用的写法');


  // 闸门此刻仍在等待：上面几条都没有放行
  const state = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(state.gates[`${TOPIC}/plan`]?.state, 'awaiting_approval');

  const okRun = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reason', '决策：按推荐项执行', '--session-id', SESSION]);
  assert.equal(okRun.code, EXIT.OK, `${okRun.stdout}${okRun.stderr}`);
  const task = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), 'utf8')) as {
    approvals: { decision: string; reason: string | null }[];
  };
  assert.equal(task.approvals.at(-1)?.decision, 'approved');
  assert.equal(task.approvals.at(-1)?.reason, '决策：按推荐项执行', '附言必须进留痕');
});

test('EV-24：--reason=<值> 是那条报错给的出口，必须真能用且原样落盘（CODEX-03）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'C');
  await writeDisposition(fx.stageDir, runId);
  await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);

  const reason = '--focus 的默认取值说明不准';
  const r = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', `--reason=${reason}`, '--session-id', SESSION]);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const task = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), 'utf8')) as {
    approvals: { reason: string | null }[];
  };
  assert.equal(task.approvals.at(-1)?.reason, reason, '以 -- 开头的附言要逐字落盘');
});

test('EV-24：help / version 豁免上限表；topic 与 gate 各接受恰好一个位置参数（CODEX-11）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  assert.equal((await cli(fx.root, ['help', 'topic'])).code, EXIT.OK);
  assert.equal((await cli(fx.root, ['version', 'whatever'])).code, EXIT.OK);
  const t = await cli(fx.root, ['topic', 'resolve', 'extra', '--stage', 'plan', '--', 'x']);
  assert.equal(t.code, EXIT.USAGE);
  assert.match(t.stdout + t.stderr, /多余的位置参数/);
  const s = await cli(fx.root, ['status', 'extra']);
  assert.equal(s.code, EXIT.USAGE);
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

/*
 * **当轮 Driver 判定走真实 Hook 进程**（EV-68，计划双审 CODEX-03）。
 *
 * 本文件头部记着的那条教训正对着这里：单元测试直接调 `hookXxx` 并手工种夹具，
 * 绕得过「真实留痕在那一刻长什么样」这个问题——而 EV-68 的第一版计划
 * （把 `state.json` 的闸门项当作 driver 来源）恰恰就是被这种形状的用例放过去的。
 * 所以这一格必须走 `hook()` 的真子进程路径，读真实落盘的 `_meta/run-*.json`。
 *
 * 顺带说明：子进程跑的是 **BUNDLE**，改完 `src/` 不重新构建，这条用例测的还是旧代码。
 *
 * ## 对计划措辞的偏离，以及为什么接受（代码双审 GLM-04）
 *
 * 计划 §2.5 写的是「夹具先落一轮真实留痕，**再以另一 Driver 起一轮**」，
 * 而这里是用写侧 `newRunMeta` 手写一份 `run-*.json` 直落 `_meta/`，没有真起 review 轮。
 * 取舍理由：真实起轮要给本轮入选的**每一侧**点名桩配置（见 `driver-flag.test.ts` 头部的
 * 配额注记），否则每次 `npm run check` 会真拉厂商 CLI，成本与这一格要证的东西不相称。
 *
 * **因此它只解了 CODEX-03 关切的一半**：读侧走的是真子进程、真文件、真 schema 校验
 * （`readRunMeta` 会按 `trivium.run.v2` 校验，形状不合就返回 null），
 * 但「那份留痕是不是真实流水线产出的」这一半仍由测试自己保证。
 */
test('当轮 Driver 按真实留痕判定：非缺省 Driver 交得了卷，审核者产出仍受保护', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { newRunMeta } = await import('../../src/trivium/meta.js');
  const fx = await makeFixture({ topic: TOPIC });

  const metaDir = path.join(fx.stageDir, '_meta');
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(
    path.join(metaDir, 'run-RDRV.json'),
    JSON.stringify(newRunMeta({
      runId: 'RDRV', topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'x',
      promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
      treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
      denyPaths: [], driftPolicy: 'warn', driver: 'codex',
    })),
  );

  // 方向①：codex 是当轮 Driver，它要写得出自己的裁决件
  const own = await hook(
    fx.root, 'hook-pre-write',
    writeEvent(path.join(fx.stageDir, `${today()}-${TOPIC}-revised-codex.md`)),
  );
  assert.equal(own.code, EXIT.OK, `非缺省 Driver 交不了卷：\n${own.stdout}${own.stderr}`);

  // 方向②：同一轮里 claude 是审核者，Driver 不得手写它的产出
  const forged = await hook(
    fx.root, 'hook-pre-write',
    writeEvent(path.join(fx.stageDir, `${today()}-${TOPIC}-claude.md`)),
  );
  assert.equal(forged.code, EXIT.GATE_BLOCK, '当轮 Driver 是 codex 时 -claude.md 是审核者产出');
  assert.match(forged.stderr, /codex/, '拦截文案要说清本轮 Driver 判定成了谁');
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

// ── 闸门状态机的三种绕过序列（审查意见 GLM-r2-01）──

test('旧轮未裁决就重跑 → 拒绝启动，并指出两条正当出路', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root); // r1 审完，闸门停在 review_done_awaiting_disposition

  const again = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION],
    STUB,
  );
  /*
   * 无条件覆盖会把 r1 的待裁决状态无声抹掉，而 gate --check 只校验最新轮——
   * r1 从此既逃过裁决、也不再拦提交。
   */
  assert.equal(again.code, EXIT.GATE_BLOCK, `应拒绝启动：\n${again.stdout}${again.stderr}`);
  const out = again.stdout + again.stderr;
  assert.match(out, /尚未裁决/);
  assert.match(out, /gate .*--check/, '要给出补裁决这条路');
  assert.match(out, /abandon/, '也要给出显式作废这条路');

  // 闸门没被动过
  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(st.gates[`${TOPIC}/plan`]?.state, 'review_done_awaiting_disposition');
});

test('显式 abandon 之后可以重跑', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root);

  const ab = await cli(fx.root, ['abandon', '--topic', TOPIC, '--stage', 'plan', '--reason', '换个焦点重来']);
  assert.equal(ab.code, EXIT.OK, `${ab.stdout}${ab.stderr}`);

  const again = await runPlan(fx.root);
  assert.ok(again, '作废之后应能正常重跑');
  // 首轮工件仍在：abandon 只解闸门、不动工件
  const docs = await fs.readdir(fx.stageDir);
  assert.ok(docs.some((f) => f.endsWith('-gemini.md') && !f.includes('-r2-')));
  assert.ok(docs.some((f) => f.includes('-r2-')));
});

test('gate --check 放行只动本轮闸门，不清掉已接管的新一轮', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root);
  await writeDisposition(fx.stageDir, runId);

  // 手工把闸门改成「新一轮 R-NEW 正在跑」，模拟 r2 已 --start
  const statePath = path.join(fx.root, '.trivium/state.json');
  const st = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string; run_id: string; since: string }>;
  };
  st.gates[`${TOPIC}/plan`]!.state = 'running';
  st.gates[`${TOPIC}/plan`]!.run_id = 'R-NEW';
  st.gates[`${TOPIC}/plan`]!.since = new Date().toISOString();
  await fs.writeFile(statePath, JSON.stringify(st, null, 2));

  // 对**旧**一轮跑 gate --check：校验本身应通过，但不能把 R-NEW 的护栏清掉
  const check = await cli(
    fx.root,
    ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--run-id', runId, '--session-id', SESSION],
  );
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);

  const after = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string; run_id: string }>;
  };
  assert.equal(after.gates[`${TOPIC}/plan`]?.state, 'running', '新一轮的 running 不得被旧轮放行清掉');
  assert.equal(after.gates[`${TOPIC}/plan`]?.run_id, 'R-NEW');
});

test('--cancel 旧 run 不清掉新一轮的闸门', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    { gemini: { mode: 'timeout' }, glm: { mode: 'timeout' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };

  // 模拟新一轮已接管
  const statePath = path.join(fx.root, '.trivium/state.json');
  const st = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string; run_id: string }>;
  };
  st.gates[`${TOPIC}/plan`]!.run_id = 'R-NEW';
  await fs.writeFile(statePath, JSON.stringify(st, null, 2));

  // 凭据抹除的挂载点 ③（EV-20）：--cancel 是 SIGKILL 的唯一入口，runner 的 finally 跑不到
  const runDir = (JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_dir: string }).run_dir;
  const leakLog = path.join(runDir, 'glm', 'out', 'stdout.json');
  const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join(''); // 运行时拼接：本文件会进送审包
  await fs.mkdir(path.dirname(leakLog), { recursive: true });
  await fs.writeFile(leakLog, `{"r":"api_key = \\"${FAKE_CRED}${FAKE_CRED}\\""}`, 'utf8');

  await cli(fx.root, ['review', '--cancel', js.run_id]);

  assert.ok(!(await fs.readFile(leakLog, 'utf8')).includes(FAKE_CRED), '--cancel 之后该运行目录必须已抹');
  await fs.access(path.join(runDir, 'glm', 'scrub.json'));

  const after = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string; run_id: string }>;
  };
  /*
   * 「先 --cancel 旧的，再 --start 新的」是正常序列。不比对 run_id 的话，
   * 取消一个早已失联的旧 run 会把正在跑的新一轮护栏一并清掉。
   */
  assert.equal(after.gates[`${TOPIC}/plan`]?.state, 'running', '新一轮护栏不得被旧 run 的取消清掉');
  assert.equal(after.gates[`${TOPIC}/plan`]?.run_id, 'R-NEW');
});

// ── worker 异常路径回收闸门（审查意见 GLM-r2-02 ≡ AGY-01）──

test('心跳过期但进程仍在的 worker_lost：不做不可逆抹除，留给会话启动清扫（代码双审 r1 CODEX-01）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * `heartbeat_stale` 这一档的语义是「进程活着但心跳过期」——它可能只是被同步段堵住，
   * codex/zcode 子进程还在用那份副本。用 SIGSTOP 把 worker 冻在 running 中途（心跳随之停），
   * stale 阈值压到 2s，于是 --wait 必判 heartbeat_stale 而进程确实还在：此时副本必须原样留着。
   */
  const fx = await makeFixture({ topic: TOPIC, extraReview: ['heartbeat_stale_s: 2'] });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    { gemini: { mode: 'timeout' }, glm: { mode: 'timeout' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; worker_pid: number; run_dir: string };
  // 等 worker 把 phase 写成 running（status 还没落盘时 --wait 会判「启动中」而不是失联），随即冻住它
  for (let i = 0; i < 100; i++) {
    const st = await fs.readFile(path.join(js.run_dir, 'status.json'), 'utf8').then((s) => JSON.parse(s) as { phase: string }).catch(() => null);
    if (st?.phase === 'running') break;
    await new Promise((r) => setTimeout(r, 30));
  }
  process.kill(js.worker_pid, 'SIGSTOP');
  const leakLog = path.join(js.run_dir, 'glm', 'out', 'stdout.json');
  const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join('');
  await fs.mkdir(path.dirname(leakLog), { recursive: true });
  await fs.writeFile(leakLog, `{"r":"api_key = \\"${FAKE_CRED}${FAKE_CRED}\\""}`, 'utf8');
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '10'], null, 60_000);
    assert.notEqual(w.code, EXIT.OK);
    assert.match(w.stdout + w.stderr, /heartbeat_stale/, `前提：判的是心跳过期：\n${w.stdout}${w.stderr}`);
    assert.match(w.stdout + w.stderr, /凭据副本未抹.*仍在/, '要说明为什么没抹');
    assert.ok((await fs.readFile(leakLog, 'utf8')).includes(FAKE_CRED), '进程还活着，不得动它的副本');
    await assert.rejects(fs.access(path.join(js.run_dir, 'glm', 'scrub.json')), '不该写哨兵');
  } finally {
    const { killProcessTree } = await import('../../src/trivium/util/exec.js');
    try { process.kill(js.worker_pid, 'SIGCONT'); } catch { /* 已不在 */ }
    killProcessTree(js.worker_pid, 'SIGKILL');
  }
});

test('worker 被杀后 --wait 判 worker_lost，并回收 running 闸门', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    // 让 worker 挂着，好在它干活时把它杀掉
    { gemini: { mode: 'timeout' }, glm: { mode: 'timeout' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as {
    run_id: string; worker_pid: number; run_dir: string;
  };

  const statePath = path.join(fx.root, '.trivium/state.json');
  const before = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(before.gates[`${TOPIC}/plan`]?.state, 'running');

  /*
   * 凭据抹除的挂载点 ②（EV-20，计划双审 AGY-02）：worker 没了，runner 的 finally 也就没跑，
   * 副本只能靠 `--wait` 判 worker_lost 时就地抹。往 glm 侧目录放一份带 token 的日志，
   * 强杀后看它有没有被脱敏、哨兵有没有落盘。
   */
  const sideDir = path.join(js.run_dir, 'glm');
  const leakLog = path.join(sideDir, 'out', 'stdout.json');
  const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join(''); // 运行时拼接：本文件会进送审包
  await fs.mkdir(path.dirname(leakLog), { recursive: true });
  await fs.writeFile(leakLog, `{"r":"api_key = \\"${FAKE_CRED}${FAKE_CRED}\\""}`, 'utf8');

  // 硬杀整个进程组，模拟崩溃/断电——不给 worker 任何收尾机会
  const { killProcessTree } = await import('../../src/trivium/util/exec.js');
  killProcessTree(js.worker_pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 500));

  const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], null, 60_000);
  assert.notEqual(w.code, EXIT.OK);
  assert.match(w.stdout + w.stderr, /失联|worker_lost/);

  assert.ok(!(await fs.readFile(leakLog, 'utf8')).includes(FAKE_CRED), 'worker_lost 分支必须就地抹该运行目录（AGY-02）');
  const sentinel = JSON.parse(await fs.readFile(path.join(sideDir, 'scrub.json'), 'utf8')) as { ok: boolean };
  assert.equal(sentinel.ok, true);

  const after = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  /*
   * 不回收的话，业务写锁要一直挂到 24h TTL——正是 executeRun 注释里写的
   * 「比不拦更糟，因为人会去改配置绕开 Hook」的形态。
   */
  assert.equal(after.gates[`${TOPIC}/plan`]?.state, 'idle', 'worker 没了就该回收闸门');

  // 回收之后业务写入立刻恢复
  const write = await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.root, 'src/a.ts')));
  assert.equal(write.code, EXIT.OK, `闸门已回收，写入应放行：\n${write.stderr}`);
});

// ── --await-approval 不能绕过裁决（审查意见 AGY-02）──

test('裁决未齐备时 --await-approval 被拒，堵死「跳过裁决直接审批」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root); // 审完，但不写裁决件

  const aw = await cli(
    fx.root,
    ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--session-id', SESSION],
  );
  /*
   * 原先这里只 setGate、不做任何检查：直接 --await-approval 再 approve，
   * 就能把逐条裁决与工件核验整段跳过。人工审批是加在「机器已确认裁决齐备」之上的
   * 一道，不是它的替代品。
   */
  assert.equal(aw.code, EXIT.GATE_BLOCK, `应被拒：\n${aw.stdout}${aw.stderr}`);
  assert.match(aw.stdout + aw.stderr, /裁决尚未齐备/);

  // 闸门没被改成 awaiting_approval
  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(st.gates[`${TOPIC}/plan`]?.state, 'review_done_awaiting_disposition');
});

test('裁决齐备后 --await-approval 正常置闸门', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root);
  await writeDisposition(fx.stageDir, runId);

  const aw = await cli(
    fx.root,
    ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--session-id', SESSION],
  );
  assert.equal(aw.code, EXIT.OK, `${aw.stdout}${aw.stderr}`);
  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(st.gates[`${TOPIC}/plan`]?.state, 'awaiting_approval');
});

// ── 留痕核对的外部锚（审查意见 GLM-r2-03 ≡ AGY-04）──

test('删掉 run.json 本身也拦——清单不能是被核对对象自己', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  /*
   * 最省事的绕过方式：连同不顺眼的审查文档一起，把记录它的 run.json 也删掉。
   * 旧实现的清单只来自 run-*.json，删了就失去对象，一路放行。
   * 现在 task.json.runs[] 是外部锚：它登记过的 run，run.json 就必须在。
   */
  await fs.rm(path.join(fx.stageDir, '_meta', `run-${runId}.json`));
  await fs.rm(path.join(fx.stageDir, `${today()}-${TOPIC}-gemini.md`));

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `应拦下：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /运行清单已丢失/);
  assert.match(r.stderr, new RegExp(runId));
});

test('把 run.json 搅坏也拦，而不是静默跳过', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  await fs.writeFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), '{ 这不是 JSON', 'utf8');

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `损坏的清单必须按违例处理：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /运行清单不可读/);
});

test('被审补丁与送审包也在保护集内（审查意见 GLM-r2-05）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  // brief 是「审的是什么」的一半：以前它不受保护，删了也不拦
  const brief = path.join(fx.stageDir, '_meta', `brief-gemini-${runId}.md`);
  const saved = await fs.readFile(brief);
  await fs.rm(brief);

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `送审包被删也该拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /brief-gemini/);

  await fs.writeFile(brief, saved);
  assert.equal((await hook(fx.root, 'hook-pre-commit', commitEvent)).code, EXIT.OK);
});

test('已提交的归档文件被删 → git 锚捕获（整目录删除/改名的情形）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);

  // 提交进 git，模拟「归档已入库」
  const { run } = await import('../../src/trivium/util/exec.js');
  await run('git', ['add', '-A', '--', '.reviews'], { cwd: fx.root, timeoutMs: 30_000 });
  await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', '归档', '--no-verify'], {
    cwd: fx.root, timeoutMs: 30_000,
  });
  assert.equal((await hook(fx.root, 'hook-pre-commit', commitEvent)).code, EXIT.OK, '提交后应放行');

  /*
   * 把整个主题目录删掉：task.json 也一起没了，基于 run.json 的核对彻底失去对象。
   * 只有 git 索引还记得这些文件曾经存在。
   */
  await fs.rm(path.join(fx.archiveRoot, TOPIC), { recursive: true });
  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `删掉整个主题目录必须被拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /已提交的归档文件被删除/);
});

test('verify 记录也受保护（审查意见 GLM-r2-08）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC,
    extraVerify: ["  build: ['echo ok']", '  test: []'],
  });
  await completedRound(fx.root, fx.stageDir);

  const v = await cli(fx.root, ['verify', '--topic', TOPIC]);
  assert.equal(v.code, EXIT.OK, `${v.stdout}${v.stderr}`);
  assert.equal((await hook(fx.root, 'hook-pre-commit', commitEvent)).code, EXIT.OK);

  // verify 记录是 AC-10 的对账凭证，删它必须被拦
  const verifyDir = path.join(fx.archiveRoot, TOPIC, 'verify');
  const doc = (await fs.readdir(verifyDir)).find((f) => f.endsWith('-verify.md'))!;
  await fs.rm(path.join(verifyDir, doc));

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `验证记录被删必须拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /verify/);
});

test('改审查文档并同步改写 run.json 的 sha → git 锚拦下（锚与被核对对象同域）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  const { run } = await import('../../src/trivium/util/exec.js');
  await run('git', ['add', '-A', '--', '.reviews'], { cwd: fx.root, timeoutMs: 30_000 });
  await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', '归档', '--no-verify'], {
    cwd: fx.root, timeoutMs: 30_000,
  });

  /*
   * 完整的篡改链：改掉一份审查文档里不顺眼的意见，再把 run.json 里它的 sha256 改成新值。
   * run.json 锚自证清白；原先 git 锚刻意只看删除，两处都是 M → 全程放行。
   */
  const { createHash } = await import('node:crypto');
  const doc = path.join(fx.stageDir, `${today()}-${TOPIC}-gemini.md`);
  await fs.appendFile(doc, '\n（偷偷删掉了一条 blocker）\n', 'utf8');
  const newSha = createHash('sha256').update(await fs.readFile(doc)).digest('hex');
  const runPath = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  const meta = JSON.parse(await fs.readFile(runPath, 'utf8')) as { artifacts: { path: string; sha256: string }[] };
  const rel = path.relative(fx.archiveRoot, doc);
  const entry = meta.artifacts.find((a) => a.path === rel);
  assert.ok(entry, `run.json 应登记 ${rel}`);
  entry!.sha256 = newSha;
  await fs.writeFile(runPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `改锚绕过必须被拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /不可变工件被改动/);
  assert.match(r.stderr, /gemini\.md/);
  assert.match(r.stderr, new RegExp(`run-${runId}\\.json`));
});

test('结构化结论 review-*.json 在保护集内：改成空意见即拦，删掉则 gate --check 失败', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  /*
   * `_meta/review-<c>-<runId>.json` 是 gate --check 唯一的事实来源。
   * 原先它既不受写锁保护也不在保护集内：改成 findings: [] 就能让空裁决表过闸，
   * 提交时也无人核对——纯用 Write 工具即可，连 Bash 都不需要。
   */
  const rj = path.join(fx.stageDir, '_meta', `review-gemini-${runId}.json`);
  const saved = await fs.readFile(rj);
  const empty = { ...(JSON.parse(saved.toString('utf8')) as Record<string, unknown>), findings: [] };
  await fs.writeFile(rj, JSON.stringify(empty, null, 2) + '\n', 'utf8');

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `结论被改必须拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, new RegExp(`review-gemini-${runId}\\.json`));

  // 删掉它：gate --check 不能把该侧当成「无意见」放行
  await fs.rm(rj);
  const g = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  assert.equal(g.code, EXIT.GATE_BLOCK, `结论缺失时 --check 必须失败：\n${g.stdout}${g.stderr}`);
  assert.match(g.stdout, /missing_review_json/);

  await fs.writeFile(rj, saved);
  assert.equal((await hook(fx.root, 'hook-pre-commit', commitEvent)).code, EXIT.OK);
});

test('首次提交之前删掉整个主题目录 → state.json 锚拦下', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);

  /*
   * 归档还全是未跟踪文件：git 锚没有基线；task.json 与 run.json 一起被删，
   * 锚 ①② 同时失去对象，listTopics 也枚举不到它。只剩 .trivium/state.json 还记得
   * 这个主题跑过——而「提交这一次」恰恰是工件首次进入版本管理的时刻。
   */
  await fs.rm(path.join(fx.archiveRoot, TOPIC), { recursive: true });
  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `首次提交前删主题也该拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /主题归档已消失/);
  assert.match(r.stderr, new RegExp(TOPIC));
});

test('hook-pre-write 拒绝 Driver 写 _meta/ 与 task.json（真实 CLI）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);
  for (const p of [
    path.join(fx.stageDir, '_meta', `review-gemini-${runId}.json`),
    path.join(fx.archiveRoot, TOPIC, 'task.json'),
  ]) {
    const r = await hook(fx.root, 'hook-pre-write', writeEvent(p));
    assert.equal(r.code, EXIT.GATE_BLOCK, `${p} 是留痕的锚，Driver 不得手工改：\n${r.stderr}`);
  }
  // 裁决件照常放行
  const ok = await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.stageDir, `${today()}-${TOPIC}-r2-revised-claude.md`)));
  assert.equal(ok.code, EXIT.OK);
});

test('git 锚：task.json 与裁决件的正常改动不得误伤，不可变工件的改动才拦', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  const { run } = await import('../../src/trivium/util/exec.js');
  await run('git', ['add', '-A', '--', '.reviews'], { cwd: fx.root, timeoutMs: 30_000 });
  await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', '归档', '--no-verify'], {
    cwd: fx.root, timeoutMs: 30_000,
  });

  /*
   * 两类本就该可变的已提交归档文件：
   *   · task.json —— 编排器每次运行都要更新它；
   *   · 裁决件 —— Driver 本就该修订它（S9 追加实施记录就是这么做的）。
   * 若 git 锚连这两类也拦，正常工作会被一路误伤，人的第一反应就是关掉 Hook。
   * 不可变的是审查文档、_meta/ 审计材料与运行清单——见上一条用例。
   */
  await fs.appendFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`),
    '\n## 实施记录\n\n已按接受项改完。\n',
    'utf8',
  );
  const taskPath = path.join(fx.archiveRoot, TOPIC, 'task.json');
  const task = JSON.parse(await fs.readFile(taskPath, 'utf8')) as { updated_at: string };
  task.updated_at = new Date().toISOString();
  await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

  assert.equal(
    (await hook(fx.root, 'hook-pre-commit', commitEvent)).code,
    EXIT.OK,
    'task.json 与裁决件的改动是正常工作，不得拦',
  );

  // 但审查文档的内容改动仍由 run.json 的 sha256 精确拦下
  await fs.appendFile(path.join(fx.stageDir, `${today()}-${TOPIC}-glm.md`), '\n偷改一行\n', 'utf8');
  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `审查文档被改仍须拦：\n${r.stderr}`);
  assert.match(r.stderr, /已被改动/);
  assert.ok(runId);
});

// ── 锚自身也要可信（审查意见 AGY-01 ≡ GLM-02 / GLM-08）──

test('搅坏 task.json → 按违例拦截，而不是静默当成空', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await completedRound(fx.root, fx.stageDir);

  /*
   * task.json 是外部锚。`readTask` 原先对损坏一律静默回落 emptyTask，
   * 于是搅坏它就能让锚失去全部对象——正是我上一批刚修掉的「清单来自被核对对象
   * 自身」的同一个毛病，只不过换了个地方重演。
   */
  await fs.writeFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), '{ 这不是 JSON', 'utf8');

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `锚被搅坏必须拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /主题元数据不可读/);
});

test('task.json 不存在是正常的，不拦', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // 主题刚建、还没跑过任何审查：没有 task.json 是常态
  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.OK, `「不存在」与「被搅坏」必须区别对待：\n${r.stderr}`);
});

test('把 run.json 挪到别的阶段目录也拦（审查意见 GLM-08）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await completedRound(fx.root, fx.stageDir);

  // 只按 run_id 匹配的话，跨阶段挪动照样命中，期望路径与实际位置对不上却无人发现
  const src = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  const bugMeta = path.join(fx.archiveRoot, TOPIC, 'bug', '_meta');
  await fs.mkdir(bugMeta, { recursive: true });
  await fs.rename(src, path.join(bugMeta, `run-${runId}.json`));

  const r = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(r.code, EXIT.GATE_BLOCK, `清单位置不符也该拦：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /运行清单已丢失/);
});

// ── 生命周期与后门（AGY-02 / AGY-05≡GLM-03 / AGY-06 / GLM-04 / GLM-06）──

test('推断不出 runId 时 --await-approval 拒绝，而不是跳过校验', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // 从没跑过审查：推断不出 runId
  const r = await cli(
    fx.root,
    ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--session-id', SESSION],
  );
  /*
   * 原先是 `if (runId) { 校验 }`——只要让 runId 推断失败，整段裁决完整性校验
   * 就被绕过，闸门照样被置成 awaiting_approval。那是个后门。
   */
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `应拒绝：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /--run-id/, '要告诉人怎么显式指定');

  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8').catch(() => '{"gates":{}}')) as {
    gates: Record<string, { state: string }>;
  };
  assert.notEqual(st.gates[`${TOPIC}/plan`]?.state, 'awaiting_approval');
});

test('--cancel 已终态的运行：不改写历史、不动闸门（审查意见 GLM-04）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root); // 跑完，status 已是 success

  const statusPath = path.join(
    process.env['HOME'] ?? '', '.trivium', 'runs',
  );
  const r = await cli(fx.root, ['review', '--cancel', runId]);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.stdout + r.stderr, /已处于终态/);
  assert.match(r.stdout + r.stderr, /不会被追溯改写/);

  // 闸门仍停在「审完待裁决」——不该因为一次误敲的 --cancel 就被清掉
  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(st.gates[`${TOPIC}/plan`]?.state, 'review_done_awaiting_disposition');
  assert.ok(statusPath);
});

test('hook-session-start 回收「worker 已死但闸门还挂着」的遗留状态（GLM-06）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    { gemini: { mode: 'timeout' }, glm: { mode: 'timeout' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { worker_pid: number };

  const statePath = path.join(fx.root, '.trivium/state.json');
  assert.equal(
    (JSON.parse(await fs.readFile(statePath, 'utf8')) as { gates: Record<string, { state: string }> })
      .gates[`${TOPIC}/plan`]?.state,
    'running',
  );

  // 硬杀 worker，且**不**跑 --wait：原先这种情况下闸门会一直挂到 24h TTL
  const { killProcessTree } = await import('../../src/trivium/util/exec.js');
  killProcessTree(js.worker_pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 500));

  const r = await hook(fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.stdout, /已回收/, `会话开始时应清扫：\n${r.stdout}${r.stderr}`);

  const after = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(after.gates[`${TOPIC}/plan`]?.state, 'idle');

  // 回收之后业务写入恢复
  assert.equal(
    (await hook(fx.root, 'hook-pre-write', writeEvent(path.join(fx.root, 'src/a.ts')))).code,
    EXIT.OK,
  );
});

test('worker 还活着时 hook-session-start 绝不回收', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    { gemini: { mode: 'timeout' }, glm: { mode: 'timeout' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; worker_pid: number };

  const r = await hook(fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
  assert.doesNotMatch(r.stdout, /已回收/, 'worker 还在跑就撤护栏，比不拦更危险');

  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  assert.equal(st.gates[`${TOPIC}/plan`]?.state, 'running');

  const { killProcessTree } = await import('../../src/trivium/util/exec.js');
  killProcessTree(js.worker_pid, 'SIGKILL');
});

/*
 * ───────── T-11：非缺省 Driver 的闸门闭环（M9 第 5 步，完成判据 C4 / V9）─────────
 *
 * ## 为什么必须是运行期用例
 *
 * 本步的存在理由就是计划第 2 轮的阻断：非缺省 Driver 且 `--critics claude` 时，
 * 闸门按工件后缀反推 driver，把本轮的 `-claude.md` 审查件整批跳过，
 * 以「请先跑一次双审」硬失败——而双审明明跑完了。
 *
 * `driver-wiring.test.ts` 对闸门区只做源码扫描。它抓得住「接线被字面删除」，
 * **抓不住语义级回归**：`latestRunMeta` 选错来源、pinned 与 latest 的优先级颠倒、
 * gateDriver 与 rerun_index 的组合错位——扫描全绿时这些照样可以坏
 * （代码双审 GLM-01 / AGY-02 / CODEX-05，三侧一致判必须补）。
 *
 * ## 桩配置必须点名 claude
 *
 * `resolveAdapters` 只替换 `Object.keys(stub)` 里点到的侧，没点到的照旧落到真适配器。
 * 本文件顶部的 `STUB` 是 `{gemini, glm}`，而这条用例选的是 claude——
 * 不点名就会在每次 `npm run check` 里真拉一次 Claude CLI，
 * 而且只有**调用之后**才由指纹断言暴露：钱已经花了（R-8 / CODEX-08）。
 */
const DRIVER_TOPIC = '闸门闭环-非缺省Driver';

test(
  'T-11：非缺省 Driver 下 gate --check 找的是 -revised-<真Driver>.md，不是缺省的',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { SELECTABLE, assertSelectableUsable } = await import('../helpers/critic-fixtures.js');
    const { DEFAULT_DRIVER } = await import('../../src/trivium/agents/registry.js');
    assertSelectableUsable();
    const driver = SELECTABLE[0]!;
    // 桩点名本轮入选的每一侧——这里入选的是缺省 Driver 那一家
    const stub: StubConfig = { [DEFAULT_DRIVER]: { mode: 'ok' } };

    const fx = await makeFixture({ topic: DRIVER_TOPIC });
    const stageDir = path.join(fx.root, '.reviews', DRIVER_TOPIC, 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    /*
     * 先删掉夹具预置的缺省 Driver 后缀原稿。
     *
     * 它与 **claude 作为审核者**产出的审查件**同名**（都是
     * `<日期>-<主题>-claude.md`）：留着它，`writeArtifact` 的 `O_EXCL` 会把整轮
     * 顶到 r2，本用例要验的东西就被轮次噪声盖住了。
     * 这不是缺陷，是「Driver 换人之后，同一后缀在两种角色间复用」的正常后果——
     * R-1 那条逃生门要防的也正是这个形态。
     */
    await fs.rm(path.join(stageDir, `${today()}-${DRIVER_TOPIC}-${DEFAULT_DRIVER}.md`), { force: true });
    // 原稿要带当轮 Driver 的后缀——driver 不只决定谁能入选，也决定原稿是谁的
    await fs.writeFile(path.join(stageDir, `${today()}-${DRIVER_TOPIC}-${driver}.md`), '# 原稿\n', 'utf8');

    const started = await cli(
      fx.root,
      [
        'review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', DRIVER_TOPIC,
        '--focus', 'x', '--driver', driver, '--critics', DEFAULT_DRIVER,
        '--session-id', SESSION, '--json',
      ],
      stub,
    );
    assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
    const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
    let code: number = EXIT.STILL_RUNNING;
    for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
      const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub, 60_000);
      code = w.code ?? EXIT.FAIL;
    }
    assert.equal(code, EXIT.OK, '非缺省 Driver 的一轮应当正常跑完');

    /*
     * 第 1 格：**裁决件尚未写出**——这正是计划第 2 轮阻断的那一格。
     * 旧实现在这里会以「请先跑一次双审」硬失败；正确行为是报缺裁决件，
     * 且文案要点名 `-revised-<真Driver>.md` 而不是缺省 Driver 的那份。
     */
    const before = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', DRIVER_TOPIC, '--check'], stub);
    const out = before.stdout + before.stderr;
    assert.notEqual(before.code, EXIT.OK, '裁决件还没写，不该通过');
    assert.doesNotMatch(
      out, /请先跑一次双审/,
      '双审明明跑完了却说没跑——这正是 r2 判为阻断的那个症状（按后缀反推 run_id 失败）',
    );
    assert.match(
      out, new RegExp(`revised-${driver}`),
      `缺件文案要点名 -revised-${driver}.md；点成缺省 Driver 那份说明 driver 没传到 checkAdjudication`,
    );
    /*
     * 缺裁决件的文案要按**轮次是否被钉住**分档（第 3 轮 GLM-04）。
     *
     * 没钉住时轮次取自「最新一次运行」，而那可能是一份 worker 崩溃前落下的、
     * 什么裁决件都不会有的骨架——此时该提示用 `--run-id` 指回更早的完整轮次，
     * 否则会把「其实想验上一轮」的人引去补一份不必要的裁决件。
     */
    assert.match(
      out, /--run-id/,
      '未钉住轮次时，缺裁决件的文案要给出 --run-id 这条出口——' +
        '否则遇上崩溃骨架的人只会去补一份不该补的裁决件',
    );
    /*
     * 反过来：钉住了就**不许再提**。那时 rerunIndex 恰恰来自他给的那份留痕，
     * 再劝他用同一个旗标是把人推向已经用过的路（第 2 轮 CODEX-06 的同款）。
     */
    const pinnedBefore = await cli(
      fx.root,
      ['gate', '--stage', 'plan', '--topic', DRIVER_TOPIC, '--check', '--run-id', js.run_id],
      stub,
    );
    const pinnedOut = pinnedBefore.stdout + pinnedBefore.stderr;
    assert.notEqual(pinnedBefore.code, EXIT.OK, '裁决件还没写，钉住轮次也不该通过');
    assert.doesNotMatch(
      pinnedOut, /--run-id/,
      '已经给了 --run-id，文案却还在劝用 --run-id：轮次本来就取自他钉的那份留痕。\n' +
        `  实际输出：${pinnedOut}`,
    );

    /*
     * 第 2 格：**谎报件不得静默通过**（第 2 轮 CODEX-04）。
     *
     * 「这份裁决件是谁写的」有两个来源——文件名后缀（闸门按它定位）与
     * front-matter 的 `role`。补这条判据之前，两者之间**没有任何机器判据**，
     * 于是下面这份自相矛盾的件会通过闸门，且没有一处会发现。
     *
     * 而它恰恰是**照 EV-66 落地前的资产面**写出来的那一份：那时
     * `disposition.md.template` 写死 `role: claude`，三份 SKILL 与
     * `templates/README.md` 也都写 `-revised-claude.md`（schema 那边的 `role`
     * 还钉着 `const: claude`）。非缺省 Driver 的人照着模板写、再把文件名改对，
     * 得到的就是这个。
     *
     * 所以 EV-66 原先记的那一格（「非缺省 Driver 写不出合法裁决件」）是记错了：
     * 写得出来，只是**必须是谎报的**。
     *
     * **本格在 EV-66 之后一字未改，地位却升了**：schema 的 const 不再挡着，
     * 它成了作者身份唯一的判据。下一格（第 3 格）那句「非缺省 Driver 的闸门闭环
     * 第一次真正走通」能成立，靠的正是本格仍然判红——能过的只有诚实的那一份。
     * 上一版这段以现在时写「资产面今天写死的正是 role: claude」，EV-66 落地后
     * 成了失实留痕，本次改为过去时（代码双审 GLM-01）。
     */
    const dispositionPath = path.join(stageDir, `${today()}-${DRIVER_TOPIC}-revised-${driver}.md`);
    const dispositionBody = (role: string): string => [
      '---', 'schema: trivium.disposition.v1', `topic: ${DRIVER_TOPIC}`, 'stage: plan',
      `role: ${role}`, 'kind: revised', `run_id: ${js.run_id}`,
      'addresses:', `  - ${today()}-${DRIVER_TOPIC}-${DEFAULT_DRIVER}.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      `| ${DEFAULT_DRIVER.toUpperCase()}-01 | ${DEFAULT_DRIVER} | blocker | 接受 | 确实漏了这一处 | §1 |`,
      '',
    ].join('\n');

    await fs.writeFile(dispositionPath, dispositionBody(DEFAULT_DRIVER), 'utf8');
    const lied = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', DRIVER_TOPIC, '--check', '--json'], stub);
    const lieOut = lied.stdout + lied.stderr;
    assert.notEqual(
      lied.code, EXIT.OK,
      '文件名说是 ' + driver + ' 写的、front-matter 说是 ' + DEFAULT_DRIVER + ' 写的，' +
        '这份自相矛盾的裁决件通过了闸门——作者身份没有任何机器判据在看着',
    );
    assert.match(
      lieOut, /role=/,
      '失败原因里没点名 role：本格要证的正是「文件名后缀与 front-matter 的 role 必须同指一人」，' +
        `失败在别的地方说明这一格没被真正验到。\n  实际输出：${lieOut}`,
    );

    // 第 3 格：补齐**诚实**的裁决件（front-matter 的 run_id 要对得上）
    await fs.writeFile(dispositionPath, dispositionBody(driver), 'utf8');
    const after = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', DRIVER_TOPIC, '--check', '--json'], stub);
    /*
     * ## 非缺省 Driver 的闸门闭环，这是它第一次真正走通（EV-66 已结案）
     *
     * 本格此前锁的是一条**已知边界**：`disposition.v1.json` 把 `role` 钉死成
     * `{ "const": "claude" }`，于是诚实写自己 id 的那份过不了 schema——
     * 文件名对了，front-matter 的 role 不合契约。上一版的断言是 `notEqual(OK)`
     * 外加一句「EV-66 若已修复，请把本断言改成期望通过」。**现在就是那一刻。**
     *
     * 放宽之后三条路的结局变了，值得逐条对照着看：
     *   · 照资产写（名与 role 都是缺省 Driver）→ 仍然定位不到，`missing_disposition`；
     *   · 改名不改 role（谎报）              → 仍然被上一格的 role 比对判红；
     *   · 诚实写 role                        → **通过**（本格）。
     * 前两格一个字没动，正说明放宽没有顺手松掉别的东西：能过的只有诚实的那一份。
     *
     * 那条 `/bad_front_matter|role/` 断言**已删除**——它描述的是被修掉的失败形态，
     * 留着只会在下一次有人读这段时把人引向一个不存在的边界。
     *
     * 反向的变异验证在别处：把 `role` 改回 const 会让本格当场红，
     * 删掉 `gate.ts` 的 role↔driver 比对会让上一格与 `gate.test.ts` 的 N-2 同时红。
     */
    assert.equal(
      after.code, EXIT.OK,
      '非缺省 Driver 诚实写出的裁决件仍然过不了闸门——EV-66 的全部目的就是这一格。\n' +
        `  实际输出：${after.stdout + after.stderr}`,
    );
  },
);

/*
 * ───────── T-12：「扫到留痕，但一份都读不出」那一格 ─────────
 * （第 2 轮 CODEX-03 ≡ AGY-01 ≡ GLM-01）
 *
 * 三侧同时打中同一处：这条硬失败的方向对，但它给的两条自救路**在该状态的定义下
 * 都走不通**——`--run-id` 读的是同一批文件（同样读不出），而「修复或移除」会撞上
 * 提交锚（运行清单一经登记即不可删、已提交的不可改）。
 *
 * 这条分支此前**全仓零覆盖**：codex 实测 grep 那句文案只命中 src/。
 * 一条既无出路又无测试的新失败路径是本步引入的——所以补这一条。
 *
 * 触发面不是假想：本仓把 schema 收严当常规动作，一旦某阶段的历史留痕集体失校，
 * 那个主题的 gate 三条子命令会一起锁死。`run-meta.test.ts` 的「真实语料回归」
 * 守的是「不要让它发生」，本条守的是「真发生时，话得说对」。
 */
const CORRUPT_TOPIC = '留痕全坏-闸门话术';

test(
  'T-12：留痕全部读不出时，硬失败的文案必须给出走得通的出口',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { metaDir } = await import('../../src/trivium/archive.js');
    const fx = await makeFixture({ topic: CORRUPT_TOPIC });
    const dir = metaDir(
      { archiveRoot: path.join(fx.root, '.reviews'), topic: CORRUPT_TOPIC },
      'plan',
    );
    await fs.mkdir(dir, { recursive: true });

    // 两份「扫得到、读不出」的留痕：schema 不识 + 内容损坏，各一种
    await fs.writeFile(
      path.join(dir, 'run-20260101T000000Z.json'),
      JSON.stringify({ schema: 'trivium.run.v99', run_id: '20260101T000000Z' }), 'utf8',
    );
    await fs.writeFile(path.join(dir, 'run-20260102T000000Z.json'), '{ 这不是 JSON', 'utf8');

    const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', CORRUPT_TOPIC, '--check'], STUB);
    const out = r.stdout + r.stderr;

    assert.equal(r.code, EXIT.MISSING_ARTIFACT, `应当硬失败而不是按缺省 Driver 继续：${out}`);
    assert.match(out, /一份都读不出来/, '要说清是「有但读不出」，不是「还没跑过」');
    assert.match(out, /20260101T000000Z/, '要点名读不出的是哪几份，否则用户无从下手');

    /*
     * 核心：**不得再把用户推向 `--run-id`**。
     *
     * 该状态的定义就是「扫到的全都读不出」，而 `--run-id` 走同一个 readRunMeta，
     * 必然返回 null 并撞上另一条硬失败——按构造不可实现。
     * 文案里可以说明它「没有用」，但不能把它当成出口来建议。
     */
    assert.doesNotMatch(
      out, /用 --run-id 指定一份可读的运行/,
      '文案又在建议 --run-id 了：这一格里它读的是同一批文件，必然也读不出——' +
        '把排障的人推去试一条按构造必败的路',
    );
    assert.match(
      out, /重跑/,
      '没给出走得通的出口：新运行会落一份可读的运行元数据（prepareRun 先写骨架），闸门随即恢复',
    );
    assert.match(
      out, /不要删除或改写|提交/,
      '没提醒「别动那几份运行清单」：它们是提交时留痕核对的锚，删改会让 git commit 被拦下',
    );

    // 同一口径要覆盖三条子命令，不能只在 --check 上说对
    for (const sub of ['--check-artifacts', '--await-approval']) {
      const r2 = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', CORRUPT_TOPIC, sub], STUB);
      const o2 = r2.stdout + r2.stderr;
      assert.equal(r2.code, EXIT.MISSING_ARTIFACT, `${sub} 没有同款硬失败：${o2}`);
      assert.match(o2, /一份都读不出来/, `${sub} 的文案与 --check 不同口径`);
    }

    /*
     * 并且钉死「--run-id 在这一格确实没用」——这是上面那条 doesNotMatch 的理由。
     * 光说不练的话，下一个人会觉得删掉那句建议只是无谓的谨慎。
     */
    const pinned = await cli(
      fx.root,
      ['gate', '--stage', 'plan', '--topic', CORRUPT_TOPIC, '--check', '--run-id', '20260101T000000Z'],
      STUB,
    );
    assert.equal(pinned.code, EXIT.MISSING_ARTIFACT, '--run-id 指到一份读不出的留痕，同样要硬失败');
    assert.match(
      pinned.stdout + pinned.stderr, /读不出来/,
      '--run-id 这条路的失败理由也要说清，不能静默按缺省继续',
    );
  },
);
