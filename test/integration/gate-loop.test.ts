import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, listFiles, makeFixture, today, type Fixture } from '../helpers/fixture.js';
import { groupMemberCount, groupsWithMark, killGroup, leaderGroupsWithMark } from '../helpers/proc.js';
import { ENV_R, ENV_W, assertEnvPairDistinct, withEnv } from '../helpers/start-env.js';
import { processStartTime } from '../../src/trivium/util/exec.js';
import {
  ORPHAN_KILL_CONFIRM_MS, WORKER_TERM_GRACE_MS, WORKER_TREE_GRACE_MS, WORKER_TREE_KILL_WAIT_MS,
} from '../../src/trivium/run-protocol.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { APPROVAL_CHECK_META_UNREADABLE, APPROVAL_CHECK_NO_RUN_ID } from '../../src/trivium/gate.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';
import { assertUnreadableExit } from '../helpers/unreadable-exit.js';
import { ADOPT_PRECREATED_RUN_DIR_ENV } from '../../src/trivium/meta.js';

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

async function runPlan(root: string, entry?: 'A' | 'B' | 'C' | 'D', stub: StubConfig = STUB) {
  const started = await cli(
    root,
    [
      'review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x',
      ...(entry ? ['--entry', entry] : []),
      '--session-id', SESSION, '--json',
    ],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '20'], stub, 60_000);
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
  await writeNextPlan(stageDir, 2, ['AGY-01', 'GLM-01']);
}

/**
 * 有接受项时执笔方的新一轮计划（EV-214，§6.6 规则 9）：新运行带 `plan_final_check`，
 * 闸门要求它存在、且逐字引用每条被接受的编号。轮次 = 本轮被审对象的轮次 + 1。
 */
async function writeNextPlan(stageDir: string, rerunIndex: number, ids: string[], topic = TOPIC, role = 'claude') {
  await fs.writeFile(
    path.join(stageDir, `${today()}-${topic}-r${rerunIndex}-${role}.md`),
    [`# 计划 r${rerunIndex}`, '', '相对上一轮的改动：', ...ids.map((id) => `- ${id}：按建议补上`), ''].join('\n'),
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
  await writeNextPlan(fx.stageDir, 2, ['AGY-01']);
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
 * EV-133：run.json 收尾后不再更新——这是有意的不变量，不是漏写。
 *
 * 设计原文要 `--check` 通过时回写 `gate.adjudication_complete=true`（含 warnings），但①已提交的 run.json
 * 受提交锚①保护，收尾后的回写会把下一次提交拦下；②`gate.warnings` 是运行期标注通道，会被回灌成 run_warning。
 * 用户 2026-09-26 定取 ②：不回写、注明语义（types.ts `RunMeta.gate` 注释、run.v1 / run.v2 schema）。
 * 以后有人想「顺手补上回写」，先在这里红，并看到上面两条理由。
 */
test('EV-133：--check 通过、--await-approval、approve 三步之后 run.json 都逐字节不变（不回写 adjudication_complete）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * 注释、schema 与设计宣称的是三条路径都不回写（代码双审 r1 CODEX-03 ≡ GLM-03：第一版只钉了 --check 一条）。
   * 走命令 B 的 entry 才立得起审批停点；首次提交之前的这段窗口提交锚管不到，正是最需要用例钉住的时段。
   */
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'B');
  await writeDisposition(fx.stageDir, runId);
  const runJson = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  const before = await fs.readFile(runJson, 'utf8');
  assert.equal((JSON.parse(before) as { gate: { adjudication_complete: boolean } }).gate.adjudication_complete, false);

  const steps: Array<[string, string[]]> = [
    ['gate --check', ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]],
    ['gate --await-approval', ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--session-id', SESSION]],
    ['approve', ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION]],
  ];
  for (const [name, args] of steps) {
    const r = await cli(fx.root, args);
    assert.equal(r.code, EXIT.OK, `${name} 应成功：\n${r.stdout}${r.stderr}`);
    assert.equal(await fs.readFile(runJson, 'utf8'), before, `${name} 之后 run.json 被改写了`);
  }
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
  // 第一轮写了 r2（被第二轮送审），第二轮的接受项合进 r3（EV-214）
  await writeNextPlan(fx.stageDir, 3, ['AGY-01', 'GLM-01']);
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
  const runId = await runPlan(fx.root); // r1 审完，闸门停在 review_done_awaiting_disposition

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

  /*
   * B2（EV-109 / EV-145 ①，闸门拦截不留骨架计划 r2 §4.2）：被拦文案给的出路必须走得通。
   *
   * 此前被拦那次在闸门判定之前已写下 run.json 骨架（rerun_index 2），`latestRunMeta` 取它当最新留痕，
   * 于是补上第 1 轮裁决件之后，不带 --run-id 的 `gate --check` 仍去查第 2 轮、退 2「缺裁决件」。
   * 现在被拦时一个文件都不写，最新留痕仍是第 1 轮。
   */
  await writeDisposition(fx.stageDir, runId);
  const check = await cli(
    fx.root,
    ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION],
  );
  assert.equal(check.code, EXIT.OK, `补齐第 1 轮裁决件后，不带 --run-id 的 gate --check 应通过：\n${check.stdout}${check.stderr}`);
  const cj = JSON.parse(extractJsonCandidate(check.stdout)!.json) as { run_id: string; rerun_index: number };
  assert.equal(cj.run_id, runId, '校验的必须是第 1 轮，而不是被拦的那一次');
  assert.equal(cj.rerun_index, 1);
  // runPlan 不带 --entry：通过后按 entry 缺席回 idle（B/C/D 才立 awaiting_approval）
  const st2 = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string; run_id: string }>;
  };
  assert.equal(st2.gates[`${TOPIC}/plan`]?.state, 'idle');
  assert.equal(st2.gates[`${TOPIC}/plan`]?.run_id, runId);
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

/*
 * ── 只读失守时两个 Hook 说出真因与出口（EV-98 文案部分，收工闸门文案区分只读失守计划 r2 §3.2）──
 *
 * 单测直调 hookXxx 并手工落留痕；这里走真实 CLI 与打包产物：review 的收尾把失守记进 run.json、
 * 闸门项的 run_id 指向它，Hook 按那个 run_id 直读——接线断在任何一处，这里都说回「未逐条裁决」。
 *
 * 只读失守未确证改动放行（2026-10-06，计划 r2 §6.1）起分三格，即决策七的读数格：
 * - B 真改项目文件（`write_breach_applied`）：跑后复算确证改动 ⇒ 照旧拦；
 * - A 只产写事件不落盘（`write_breach`）：复算无变化 ⇒ 告警放行；
 * - C 比不了 + 写事件（`prune_objects` + `write_breach`，`on_drift_related: warn`）⇒ 告警放行。
 */
const BREACH_STUB: StubConfig = { gemini: { mode: 'write_breach_applied' }, glm: { mode: 'ok' } };
const BREACH_EVENT_ONLY_STUB: StubConfig = { gemini: { mode: 'write_breach' }, glm: { mode: 'ok' } };

/** 读本轮 run.json 的 guard 与 drift（只读） */
async function breachFacts(stageDir: string, runId: string) {
  const m = JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${runId}.json`), 'utf8')) as {
    guard: { readonly_breach: boolean; breached_files: string[] };
    snapshot: { drift: { changed: boolean; files: string[]; unknown_reason?: { cause: string } } };
  };
  return { guard: m.guard, drift: m.snapshot.drift };
}

async function gateState(root: string): Promise<string | undefined> {
  const st = JSON.parse(await fs.readFile(path.join(root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string }>;
  };
  return st.gates[`${TOPIC}/plan`]?.state;
}

test('B 只读失守且复算确证改动、裁决件齐备 → gate --check 仍失败，两个 Hook 说失守与出口；不作废不能重跑，作废后放行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'A', BREACH_STUB);
  const facts = await breachFacts(fx.stageDir, runId);
  assert.equal(facts.guard.readonly_breach, true);
  assert.equal(facts.drift.changed, true, '桩真的落了盘，复算应检出改动');
  assert.equal(facts.drift.unknown_reason, undefined);
  assert.ok(facts.drift.files.includes('src/injected.ts'), JSON.stringify(facts.drift));
  await writeDisposition(fx.stageDir, runId);

  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION]);
  assert.notEqual(check.code, EXIT.OK, `确证改动的失守轮裁决齐备也不得放行：\n${check.stdout}${check.stderr}`);
  const cj = JSON.parse(extractJsonCandidate(check.stdout)!.json) as { failures: { code: string; message: string }[] };
  assert.deepEqual(cj.failures.map((x) => x.code), ['readonly_breach'], '失败只来自失守，裁决件本身齐备');
  assert.ok(cj.failures[0]!.message.includes('复算检出：1 个文件改动：src/injected.ts'), cj.failures[0]!.message);
  const st = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')) as {
    gates: Record<string, { state: string; run_id: string }>;
  };
  assert.equal(st.gates[`${TOPIC}/plan`]?.state, 'review_done_awaiting_disposition', '闸门停在原地（与 A 格对偶）');
  assert.equal(st.gates[`${TOPIC}/plan`]?.run_id, runId);

  const stop = await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' });
  assert.equal(stop.code, EXIT.GATE_BLOCK, '拦截行为不变');
  const out = JSON.parse(stop.stdout.trim().split('\n')[0]!) as { decision: string; reason: string };
  assert.equal(out.decision, 'block');
  assert.match(out.reason, new RegExp(`^本轮审查记录到只读失守：${TOPIC}/plan。`));
  assert.ok(out.reason.includes('write_to_file('), out.reason);
  assert.ok(out.reason.includes('快照漂移：检出 1 个文件改动：src/injected.ts'), out.reason);
  assert.ok(out.reason.includes(`/dual-abandon --topic ${TOPIC} --stage plan`), out.reason);
  assert.doesNotMatch(out.reason, /未逐条裁决/);

  const commit = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(commit.code, EXIT.GATE_BLOCK);
  assert.match(commit.stderr, new RegExp(`以下阶段的审查记录到只读失守，提交被拦下：${TOPIC}/plan`));
  assert.ok(commit.stderr.includes('write_to_file('), commit.stderr);
  assert.doesNotMatch(commit.stderr, /尚未逐条裁决/);

  // 文案说「要重跑须先作废」：不作废直接重跑确实被拒（计划 r2 §7）
  const again = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION],
    STUB,
  );
  assert.equal(again.code, EXIT.GATE_BLOCK, `待裁决的失守轮不作废不能重跑：\n${again.stdout}${again.stderr}`);

  // 出口：作废后两个 Hook 放行，之后可以重跑
  const ab = await cli(fx.root, ['abandon', '--topic', TOPIC, '--stage', 'plan', '--reason', '失守轮作废']);
  assert.equal(ab.code, EXIT.OK, `${ab.stdout}${ab.stderr}`);
  assert.equal((await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' })).code, EXIT.OK);
  assert.equal((await hook(fx.root, 'hook-pre-commit', commitEvent)).code, EXIT.OK);
  assert.ok(await runPlan(fx.root, 'A'), '作废之后应能重跑');
});

test('B′ 确证改动的失守而裁决件还没写 → 两个 Hook 同样说失守（gate --check 此时先报缺件、看不到失守）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await runPlan(fx.root, 'A', BREACH_STUB);

  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  const cj = JSON.parse(extractJsonCandidate(check.stdout)!.json) as { failures: { code: string }[] };
  assert.deepEqual(cj.failures.map((x) => x.code), ['missing_disposition'], '前提：缺件早退，gate --check 看不到失守（计划 r2 §1.3）');

  const stop = await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' });
  const out = JSON.parse(stop.stdout.trim().split('\n')[0]!) as { reason: string };
  assert.match(out.reason, /只读失守/);
  assert.ok(out.reason.includes('write_to_file('), 'Hook 自己列调用记录，不依赖 gate --check');
  const commit = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.match(commit.stderr, /只读失守/);
});

test('A 只产写事件不落盘（复算无变化）→ 两个 Hook 按普通轮说未裁决；裁决齐后 gate --check 告警放行、闸门迁到 idle、Hook 放行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'A', BREACH_EVENT_ONLY_STUB);
  const facts = await breachFacts(fx.stageDir, runId);
  assert.equal(facts.guard.readonly_breach, true, '前提：写事件照样判失守（guard 判定不改）');
  assert.equal(facts.drift.changed, false, '前提：桩不落盘，复算无变化');

  // 裁决件未齐：两处 Hook 按普通轮出原文案——此时补裁决件确实解得开
  const stop0 = await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' });
  assert.equal(stop0.code, EXIT.GATE_BLOCK);
  const out0 = JSON.parse(stop0.stdout.trim().split('\n')[0]!) as { reason: string };
  assert.match(out0.reason, new RegExp(`^还有未逐条裁决的审查意见：${TOPIC}/plan。`));
  assert.doesNotMatch(out0.reason, /只读失守/);
  const commit0 = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(commit0.code, EXIT.GATE_BLOCK);
  assert.match(commit0.stderr, new RegExp(`^以下阶段的审查意见尚未逐条裁决，提交被拦下：${TOPIC}/plan`));
  assert.doesNotMatch(commit0.stderr, /只读失守/);

  await writeDisposition(fx.stageDir, runId);
  assert.equal(await gateState(fx.root), 'review_done_awaiting_disposition', '前提：check 之前停在待裁决');
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `未确证改动的失守轮应放行：\n${check.stdout}${check.stderr}`);
  const cj = JSON.parse(extractJsonCandidate(check.stdout)!.json) as {
    ok: boolean; failures: { code: string }[]; warnings: { code: string; message: string }[];
  };
  assert.equal(cj.ok, true);
  assert.deepEqual(cj.failures, []);
  const w = cj.warnings.find((x) => x.code === 'readonly_breach_unconfirmed');
  assert.ok(w, JSON.stringify(cj.warnings));
  assert.ok(w!.message.includes('snapshot.drift.changed 为 false'), w!.message);
  assert.ok(w!.message.includes('write_to_file('), w!.message);
  // 放行是真的状态迁移，不是 Hook 恰好没拦（计划双审 CODEX-01）：--entry A 的轮次 --check 通过后回 idle
  assert.equal(await gateState(fx.root), 'idle');
  assert.equal((await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' })).code, EXIT.OK);
  assert.equal((await hook(fx.root, 'hook-pre-commit', commitEvent)).code, EXIT.OK);
});

test('C 比不了 + 写事件（on_drift_related: warn）→ gate --check 以「比不了」的说法告警放行，审批停点带出该告警', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC, extraReview: ['on_drift_related: warn'] });
  /*
   * 放一个未跟踪的业务文件：夹具建仓时全部提交，干净工作树的 tree 就是 HEAD 的 tree（可达、清理不掉），
   * prune 之后照样比得了（同 fault-injection 的 EV-139 两格）。
   */
  await fs.writeFile(path.join(fx.root, 'src/untracked-seed.ts'), 'export const seed = 1;\n', 'utf8');
  const runId = await runPlan(fx.root, 'A', { gemini: { mode: 'write_breach' }, glm: { mode: 'prune_objects' } });
  const facts = await breachFacts(fx.stageDir, runId);
  assert.equal(facts.guard.readonly_breach, true, '前提：写事件判失守');
  assert.equal(facts.drift.unknown_reason?.cause, 'object_gone', `前提：复算比不了：${JSON.stringify(facts.drift)}`);
  await writeDisposition(fx.stageDir, runId);

  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `比不了的失守轮应放行：\n${check.stdout}${check.stderr}`);
  const cj = JSON.parse(extractJsonCandidate(check.stdout)!.json) as { warnings: { code: string; message: string }[] };
  const w = cj.warnings.find((x) => x.code === 'readonly_breach_unconfirmed');
  assert.ok(w, JSON.stringify(cj.warnings));
  assert.ok(w!.message.includes('但跑后复算比不了（对象已不在：'), w!.message);
  assert.ok(!w!.message.includes('snapshot.drift.changed 为 false'), w!.message);

  // 审批停点带出该告警：审批人在表态那一格看得见（计划 r2 §2.4）
  const hold = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--session-id', SESSION]);
  assert.equal(hold.code, EXIT.OK, `${hold.stdout}${hold.stderr}`);
  assert.ok(hold.stdout.includes('[readonly_breach_unconfirmed]'), hold.stdout);
  assert.ok(hold.stdout.includes('但跑后复算比不了'), hold.stdout);
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

/*
 * EV-128 E4：运行中途已提交 → --cancel 回写 → 再提交，提交锚放行；终态之后再改被拦。
 *
 * 提交锚对 HEAD 为 running 的 run.json 只查 run_id 与已登记条目（hooks.ts runningRewriteViolation），
 * 回写只改 status / finished_at / gate.state 三格、artifacts[] 原样，所以这条最容易撞锚的序列也能正常提交。
 * HEAD 已是终态（cancelled）时，锚拦任何改动——取消回写是唯一一次终态写入，之后同样不可改。
 */
test('EV-128 E4：running 的 run.json 已入库、--cancel 回写后提交锚放行；入库的 cancelled 版本再改被拦', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    // hang：worker 一直挂着，--cancel 之前它确实还在跑（timeout 模式立刻返回，赶不赶得上全凭时序）
    { gemini: { mode: 'hang' }, glm: { mode: 'hang' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  const runPath = path.join(fx.stageDir, '_meta', `run-${js.run_id}.json`);
  assert.equal((JSON.parse(await fs.readFile(runPath, 'utf8')) as { status: string }).status, 'running');

  const { run } = await import('../../src/trivium/util/exec.js');
  const commit = async (msg: string) => {
    await run('git', ['add', '-A', '--', '.reviews'], { cwd: fx.root, timeoutMs: 30_000 });
    await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg, '--no-verify'], {
      cwd: fx.root, timeoutMs: 30_000,
    });
  };
  await commit('运行中途入库');
  const headArtifacts = (JSON.parse(await fs.readFile(runPath, 'utf8')) as { artifacts: unknown[] }).artifacts;

  const c = await cli(fx.root, ['review', '--cancel', js.run_id]);
  assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
  const after = JSON.parse(await fs.readFile(runPath, 'utf8')) as { status: string; artifacts: unknown[] };
  assert.equal(after.status, 'cancelled', `${c.stdout}${c.stderr}`);
  assert.deepEqual(after.artifacts, headArtifacts);

  const ok = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(ok.code, EXIT.OK, `取消回写是正常收尾，提交锚应放行：\n${ok.stdout}${ok.stderr}`);

  await commit('取消后入库');
  await fs.writeFile(runPath, (await fs.readFile(runPath, 'utf8')).replace('"cancelled"', '"success"'), 'utf8');
  const blocked = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(blocked.code, EXIT.GATE_BLOCK, `入库的终态 run.json 再改必须被拦：\n${blocked.stdout}${blocked.stderr}`);
});

/*
 * EV-128 E5：取消轮仍是该阶段「最新可读留痕」——gate 的当轮 Driver 与轮次读数不看 status（计划 r2 C7）。
 * 本主题只让 run.json 如实记下 cancelled，不改 latestRunMeta 的取舍。
 */
test('EV-128 E5：取消轮回写为 cancelled 后，gate 仍把它当最新一轮（run_id / 轮次不变）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    { gemini: { mode: 'hang' }, glm: { mode: 'hang' } },
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  await cli(fx.root, ['review', '--cancel', js.run_id]);
  const runPath = path.join(fx.stageDir, '_meta', `run-${js.run_id}.json`);
  assert.equal((JSON.parse(await fs.readFile(runPath, 'utf8')) as { status: string }).status, 'cancelled');

  const g = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION, '--json']);
  const out = JSON.parse(extractJsonCandidate(g.stdout)!.json) as { run_id?: string; rerun_index?: number };
  assert.equal(out.run_id, js.run_id, `gate 应仍取取消轮为最新留痕：\n${g.stdout}${g.stderr}`);
  assert.equal(out.rerun_index, 1);
});

/*
 * ── EV-142：worker 异常与 worker_lost 的归档侧收尾（计划 r2 §4.2 W1 / W2 / X1 / X2）──
 */

/** 循环 --wait 直到不再是 73；返回最后一次的结果 */
async function waitUntilDone(root: string, runId: string, stub: StubConfig | null, json = false) {
  let w = await cli(root, ['review', '--wait', runId, '--timeout', '20', ...(json ? ['--json'] : [])], stub, 60_000);
  for (let i = 0; i < 10 && w.code === EXIT.STILL_RUNNING; i++) {
    w = await cli(root, ['review', '--wait', runId, '--timeout', '20', ...(json ? ['--json'] : [])], stub, 60_000);
  }
  return w;
}

test('EV-142 W1 / W2：worker 写审查文档时抛异常 ⇒ 归档 run.json 收尾为 failed、带 termination，且先于 status.json 写', { skip: (bundleMissing && bundleSkipReason) || (process.getuid?.() === 0 && 'root 下只读目录拦不住写入') }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // 审查文档写不进阶段目录（EACCES），_meta/ 仍可写：worker 在收尾前抛异常（与本仓那份历史留痕同形——落盘被拒）
  await fs.mkdir(path.join(fx.stageDir, '_meta'), { recursive: true });
  await fs.chmod(fx.stageDir, 0o555);
  try {
    const started = await cli(
      fx.root,
      ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
      STUB,
    );
    assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
    const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; run_dir: string };
    const runPath = path.join(fx.stageDir, '_meta', `run-${js.run_id}.json`);
    const skeleton = JSON.parse(await fs.readFile(runPath, 'utf8')) as { artifacts: unknown[] };

    const w = await waitUntilDone(fx.root, js.run_id, STUB, true);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    const out = JSON.parse(extractJsonCandidate(w.stdout)!.json) as { message: string | null };
    assert.match(out.message ?? '', /工作进程异常/);
    assert.match(out.message ?? '', /已把归档里的 run-\S+\.json 收尾为 failed/, 'worker.log 没人看，收尾结果要进 message');

    const after = JSON.parse(await fs.readFile(runPath, 'utf8')) as {
      status: string; gate: { state: string }; termination?: unknown; artifacts: unknown[];
    };
    assert.equal(after.status, 'failed');
    assert.equal(after.gate.state, 'failed');
    assert.deepEqual(after.termination, { by: 'worker_exception', exit_code: EXIT.FAIL });
    assert.deepEqual(after.artifacts, skeleton.artifacts, 'artifacts[] 必须原样');
    const task = JSON.parse(await fs.readFile(path.join(fx.root, '.reviews', TOPIC, 'task.json'), 'utf8')) as {
      runs: { run_id: string; status: string }[];
    };
    assert.equal(task.runs.find((r) => r.run_id === js.run_id)?.status, 'failed');

    // W2：归档侧先于 status.json 落终态（前提：纳秒级时间戳；粗粒度文件系统上假红、不会假绿）
    const mt = async (p: string) => (await fs.stat(p, { bigint: true })).mtimeNs;
    assert.ok((await mt(runPath)) < (await mt(path.join(js.run_dir, 'status.json'))), 'run.json 应先于 status.json 写');
  } finally {
    await fs.chmod(fx.stageDir, 0o755);
  }
});

test('EV-142 X1：running 的 run.json 已入库、worker 被杀后 --wait 收尾为 failed ⇒ 提交锚放行；随后 --cancel 终态早退、run.json 不动', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const HANG: StubConfig = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    HANG,
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; worker_pid: number };
  const runPath = path.join(fx.stageDir, '_meta', `run-${js.run_id}.json`);

  const { run, killProcessTree } = await import('../../src/trivium/util/exec.js');
  await run('git', ['add', '-A', '--', '.reviews'], { cwd: fx.root, timeoutMs: 30_000 });
  await run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', '运行中途入库', '--no-verify'], {
    cwd: fx.root, timeoutMs: 30_000,
  });

  killProcessTree(js.worker_pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 500));
  const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], null, 60_000);
  assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
  const after = JSON.parse(await fs.readFile(runPath, 'utf8')) as { status: string; termination?: unknown };
  assert.equal(after.status, 'failed', `${w.stdout}${w.stderr}`);
  assert.deepEqual(after.termination, { by: 'worker_lost', reason: 'pid_gone' });

  const ok = await hook(fx.root, 'hook-pre-commit', commitEvent);
  assert.equal(ok.code, EXIT.OK, `失联收尾是正常的唯一一次终态写入，提交锚应放行：\n${ok.stdout}${ok.stderr}`);

  const before = await fs.readFile(runPath, 'utf8');
  const c = await cli(fx.root, ['review', '--cancel', js.run_id]);
  assert.equal(c.code, EXIT.OK);
  assert.match(c.stdout + c.stderr, /已处于终态（failed）/);
  assert.equal(await fs.readFile(runPath, 'utf8'), before, '失联之后再 --cancel 不得改写 run.json');
});

test('EV-142 X2：先 --cancel 后 --wait ⇒ --wait 按终态返回、不进失联分支，run.json 仍是 cancelled 且逐字节不变', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const HANG: StubConfig = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    HANG,
  );
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  const runPath = path.join(fx.stageDir, '_meta', `run-${js.run_id}.json`);
  const c = await cli(fx.root, ['review', '--cancel', js.run_id]);
  assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
  const before = await fs.readFile(runPath, 'utf8');
  assert.equal((JSON.parse(before) as { status: string }).status, 'cancelled');

  const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], null, 60_000);
  assert.doesNotMatch(w.stdout + w.stderr, /失联|worker_lost/);
  assert.equal(await fs.readFile(runPath, 'utf8'), before);
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
  /*
   * **只点名 run.json、不再点名 gemini.md**（M10a 第 2 步代码双审 r2 CODEX-03 删掉提交锚后缀支之后）。
   *
   * 上一版这条链有两道独立信号：后缀支按文件名拦审查文档、位置判据拦 run.json。
   * 后缀支删掉后（它让非缺省 Driver 的原稿 / 裁决件被判伪造），审查文档的不可变性只由
   * 锚②按登记核对——而这条链恰好把登记里的 sha 一起改了，锚②自证清白。
   * **拦住它的是 run.json 本身**：收尾后的 run-*.json 位于 `_meta/` 内，改它即拦；
   * 已提交版本仍为 running 时，改写已登记条目同样被拦（r3 CODEX-01 收窄，只许追加）。
   * 代价是冗余从两道降为一道、诊断少点名一个文件。
   *
   * **这不是确定性保证**（r3 CODEX-01 指出上一版这里写成了「改锚必被拦」）。剩余边界：
   *   · 收尾**新追加**的条目在追加那一刻仍可被同步改写——那段窗口由写侧承担
   *     （Write/Edit 精确拦、Bash 启发式拦）；
   *   · 审查文档已落盘、收尾登记未发生时进程崩溃，且该状态被提交（r3 GLM-02）：
   *     这批文档既不在 `_meta/` 也不在登记里，提交锚两层都够不着，只剩写侧。
   * 两格已登记 BACKLOG EV-55。
   */
  assert.match(r.stderr, new RegExp(`run-${runId}\\.json`));
  assert.match(r.stderr, /运行清单是留痕核对的锚/);
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
  const runJson = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  const runBefore = await fs.readFile(runJson, 'utf8');
  const r = await cli(fx.root, ['review', '--cancel', runId]);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.stdout + r.stderr, /已处于终态/);
  // EV-128 E2：终态运行的归档 run.json 同样不追溯改写
  assert.equal(await fs.readFile(runJson, 'utf8'), runBefore, '已终态运行的 run.json 必须逐字节不变');
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

    // 第 3 格：补齐**诚实**的裁决件（front-matter 的 run_id 要对得上），连同当轮 Driver 后缀的新一轮计划（EV-214）
    await fs.writeFile(dispositionPath, dispositionBody(driver), 'utf8');
    await writeNextPlan(stageDir, 2, [`${DEFAULT_DRIVER.toUpperCase()}-01`], DRIVER_TOPIC, driver);
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
    /*
     * 出口（留痕读不出的出口计划 r2 §5.2，EV-148）：上一版这里断言的是「给了重跑」——
     * 而重跑在 `review --start` 入口就被同一个 `corrupt` 判定拒绝，那条出口指回自己。
     * 现在要求：以共用出口段收尾（按成因三档，含「别动那几份运行清单」），逐行列出两份的绝对路径，
     * 不出现循环出口。
     */
    const realDir = await fs.realpath(dir);
    const files = ['run-20260102T000000Z.json', 'run-20260101T000000Z.json'].map((f) => path.join(realDir, f));
    assertUnreadableExit(out, files, 'gate --check');
    assert.match(
      out, /不要删除或改写/,
      '没提醒「别动那几份运行清单」：它们是提交时留痕核对的锚，删改会让 git commit 被拦下',
    );

    // 同一口径要覆盖三条子命令，不能只在 --check 上说对
    for (const sub of ['--check-artifacts', '--await-approval']) {
      const r2 = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', CORRUPT_TOPIC, sub], STUB);
      const o2 = r2.stdout + r2.stderr;
      assert.equal(r2.code, EXIT.MISSING_ARTIFACT, `${sub} 没有同款硬失败：${o2}`);
      assert.match(o2, /一份都读不出来/, `${sub} 的文案与 --check 不同口径`);
      assertUnreadableExit(o2, files, `gate ${sub}`);
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
    // 归属无误时它与另外七处同状态：同样以共用出口段收尾，只列钉住的那一份（代码双审 r1 GLM-01）
    assertUnreadableExit(pinned.stdout + pinned.stderr, [files[1]!], 'gate --check --run-id（钉住读不出）');
    assert.ok(!(pinned.stdout + pinned.stderr).includes(files[0]!), '只列钉住的那一份');

    /*
     * EV-04 候选 B：原有两行之后、共用出口段之前加一行「本次判定」，说清这一次是哪一档。
     * 钉住的那份 schema 是 trivium.run.v99 ⇒ 不合契约；钉一个不存在的 run_id ⇒ 文件不存在（同样硬失败、同一出口）。
     */
    const pinnedOut = pinned.stdout + pinned.stderr;
    const judged = pinnedOut.indexOf('  本次判定：文件是 JSON，但不合 run.v1/v2/v3 契约（schema 字段是 "trivium.run.v99"');
    assert.ok(judged > pinnedOut.indexOf('按下列成因处置。\n'), `缺本次判定一行，或不在原文之后：${pinnedOut}`);
    assert.ok(judged < pinnedOut.indexOf('  涉及的运行留痕'), `本次判定要在共用出口段之前：${pinnedOut}`);
    const absent = await cli(
      fx.root,
      ['gate', '--stage', 'plan', '--topic', CORRUPT_TOPIC, '--check', '--run-id', '20260103T000000Z'],
      STUB,
    );
    const absentOut = absent.stdout + absent.stderr;
    assert.equal(absent.code, EXIT.MISSING_ARTIFACT, '钉到不存在的 run_id 同样硬失败，退出码不动');
    assert.match(absentOut, /\n {2}本次判定：文件不存在。\n/, absentOut);
    assert.match(absentOut, /运行元数据读不出来（文件缺失、内容损坏，或 schema 不识）。\n/, '原文不动');
  },
);

/*
 * ───────── T-12b：最新一份读不出、较旧一份可读（EV-73，用户 2026-10-06 定取 A）─────────
 *
 * 此前 `gate` 静默采信较旧那份：driver、轮次与 run_id 一并变旧，`--check` / `--await-approval`
 * 对上一轮做裁决校验、立停点，唯一的迹象是一行 stderr。Driver 判定的四个消费点早已把这一格判坏，
 * 现在 gate 同口径：三条子命令都退 65、以共用出口段收尾、带「本次判定」一行；
 * 查看上一轮改走 `--run-id` 钉住可读的那一份——它不扫目录，仍然走得通。
 */
test(
  'T-12b：最新一份读不出、较旧一份可读时，gate 三条子命令都硬失败；--run-id 钉住可读那份仍可查看',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { metaDir } = await import('../../src/trivium/archive.js');
    const fx = await makeFixture({ topic: TOPIC });
    const runId = await runPlan(fx.root);
    await writeDisposition(fx.stageDir, runId);

    // 比任何真实 run_id 都新的一份坏留痕（字典序即时序）
    const dir = metaDir({ archiveRoot: path.join(fx.root, '.reviews'), topic: TOPIC }, 'plan');
    const badId = '29991231T235959Z';
    await fs.writeFile(path.join(dir, `run-${badId}.json`), '{ 这不是 JSON', 'utf8');
    const badFile = path.join(await fs.realpath(dir), `run-${badId}.json`);

    for (const sub of ['--check', '--check-artifacts', '--await-approval']) {
      const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, sub, '--session-id', SESSION], STUB);
      const out = r.stdout + r.stderr;
      assert.equal(r.code, EXIT.MISSING_ARTIFACT, `${sub}：最新一份读不出时应硬失败，不得采信上一轮：${out}`);
      assert.match(out, new RegExp(`plan 阶段最新的 1 份运行元数据读不出来（${badId}），可读的最新一份是更早的 ${runId}。\n`), `${sub}：${out}`);
      assert.match(out, /不能按那一份继续/, `${sub}：要说清为什么不按上一轮继续：${out}`);
      assert.match(out, new RegExp(`只想查看上一轮的，可用 --run-id ${runId} 钉住那一份。\n`), `${sub}：要给出查看旧轮的出路：${out}`);
      const judged = out.indexOf(`  本次判定：${badId} 文件在但不是合法 JSON（`);
      assert.ok(judged > out.indexOf('钉住那一份。\n'), `${sub}：缺本次判定一行，或不在原文之后：${out}`);
      assert.ok(judged < out.indexOf('  涉及的运行留痕'), `${sub}：本次判定要在共用出口段之前：${out}`);
      assertUnreadableExit(out, [badFile], `gate ${sub}（最新一份读不出）`);
      // 只列读不出的那一份，可读的旧份不进出口段的路径列表
      assert.ok(!out.includes(`    · ${path.join(await fs.realpath(dir), `run-${runId}.json`)}\n`), `${sub}：把可读的旧份也列进去了：${out}`);
    }
    // 硬失败之前不立停点：--check 与 --await-approval 都没把闸门推到上一轮的等待审批
    const gates = await gatesOf(fx.root).catch(() => ({} as Record<string, { state: string; run_id: string | null }>));
    for (const [k, g] of Object.entries(gates)) {
      assert.notEqual(g.state, 'awaiting_approval', `硬失败的同时立了停点（${k}）：${JSON.stringify(g)}`);
    }

    // 钉住可读的那一份：不扫目录，照常对那一轮校验
    for (const sub of ['--check-artifacts', '--check']) {
      const p = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, sub, '--run-id', runId, '--session-id', SESSION], STUB);
      assert.equal(p.code, EXIT.OK, `${sub} --run-id 钉住可读的旧份应仍可用：${p.stdout + p.stderr}`);
      assert.doesNotMatch(p.stdout + p.stderr, /读不出来/, `${sub} --run-id：钉住时不扫目录，不该提那份坏的：${p.stdout + p.stderr}`);
    }
  },
);

// ─────────── approve 通过前复核（M10a 第 3 步，M10 计划 r7 §4.3 / §4.4 / §4.5，计划 r3 §4.1）───────────
/*
 * 停点立起来之后（`--check` 自动立、或 `--await-approval`），approve 此前不做任何复核：
 * 裁决件被删改、审查工件被改，approve 照样放行。现在 approved 前与 `--await-approval`
 * 共用一份判定：裁决齐备 + 本轮登记工件的 sha256 抽核。拒绝与放弃不复核。
 *
 * A1～A3 是变异 M1（approve 跳过复核）的鉴别用例；A3 / A3′ 是 M2（跳过 sha256 抽核）的。
 * **A3 改的必须是渲染出的 .md 审查文档**（计划双审 r1 GLM-01）：结构化结论 JSON 也在登记里，
 * 但 `loadRoundReviews` 只读它——改它会先因解析失败被判红，M2 就鉴别不出来了。
 */

/** 本机闸门状态文件（编排器维护；测试夹具里直接读写以构造分叉），写法同本文件既有用例 */
const LOCAL_STATE = ['.trivium/state.json'] as const;
/** 审批正本（归档主题目录下） */
const TASK_NAME = 'task.json';

const gatesOf = async (root: string) =>
  (JSON.parse(await fs.readFile(path.join(root, ...LOCAL_STATE), 'utf8')) as {
    gates: Record<string, { state: string; run_id: string | null }>;
  }).gates;

const approvalsOf = async (archiveRoot: string) =>
  (JSON.parse(await fs.readFile(path.join(archiveRoot, TOPIC, TASK_NAME), 'utf8')) as {
    approvals: { decision: string; run_id: string }[];
  }).approvals;

type Fx = Awaited<ReturnType<typeof makeFixture>>;

/** 跑完一轮并经 `--check` 立起停点（B/C/D 自动立） */
async function toAwaitingApproval(fx: Fx): Promise<string> {
  const runId = await runPlan(fx.root, 'C');
  await writeDisposition(fx.stageDir, runId);
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'awaiting_approval', '前提：停点已立');
  return runId;
}

const approveNow = (root: string) =>
  cli(root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION]);

const awaitNow = (root: string) =>
  cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval']);

async function assertNotApproved(fx: Fx) {
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'awaiting_approval', '复核未过，闸门必须保持等待审批');
  assert.ok(
    !(await approvalsOf(fx.archiveRoot)).some((a) => a.decision === 'approved'),
    '复核未过，不得留下「已通过」的审批记录',
  );
}

/** 本轮渲染出的某一侧审查文档（只受哈希保护，`loadRoundReviews` 不读它） */
const reviewDoc = (side: string) => `${today()}-${TOPIC}-${side}.md`;

test('A1：停点之后裁决件少了一条 ⇒ approve 退 2，闸门保持等待', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  const disp = path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`);
  const text = await fs.readFile(disp, 'utf8');
  await fs.writeFile(disp, text.split('\n').filter((l) => !l.startsWith('| GLM-01 ')).join('\n'), 'utf8');

  const r = await approveNow(fx.root);
  assert.equal(r.code, EXIT.GATE_BLOCK, `裁决缺一条仍放行了：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /GLM-01/, '要点名缺的是哪一条');
  assert.match(r.stdout + r.stderr, /通过前复核未过/);
  await assertNotApproved(fx);
});

test('A2：--await-approval 通过后删掉裁决件 ⇒ approve 仍退 2', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  const aw = await awaitNow(fx.root);
  assert.equal(aw.code, EXIT.OK, `${aw.stdout}${aw.stderr}`);
  await fs.rm(path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`));

  const r = await approveNow(fx.root);
  assert.equal(r.code, EXIT.GATE_BLOCK, `裁决件没了仍放行：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /裁决件/);
  await assertNotApproved(fx);
});

test('A3：--await-approval 通过后改了渲染出的审查文档 ⇒ approve 退 2，点名该文件', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  const aw = await awaitNow(fx.root);
  assert.equal(aw.code, EXIT.OK, `${aw.stdout}${aw.stderr}`);
  const doc = reviewDoc('gemini');
  await fs.appendFile(path.join(fx.stageDir, doc), '\n（停点之后追加的一行）\n', 'utf8');

  const r = await approveNow(fx.root);
  const out = r.stdout + r.stderr;
  assert.equal(r.code, EXIT.GATE_BLOCK, `审查文档被改仍放行：\n${out}`);
  assert.ok(out.includes(doc), `要点名被改的文件：${out}`);
  assert.match(out, /已被改动/);
  /*
   * 出口要走得通（代码双审 r4 CODEX-02）：这份文档从未提交过——停点上的常态——
   * 只给 `git restore` 的话照做必然失败。必须同时给出「作废后重跑」这一档。
   */
  assert.match(out, /dual-abandon/, `未提交工件的出口没给：${out}`);
  assert.match(out, /尚未提交过的/, '要说清哪一档适用于未提交的工件');
  await assertNotApproved(fx);
});

test('A3′：--await-approval 之前审查文档已被改 ⇒ --await-approval 退 2（抽核两处都补了）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  const doc = reviewDoc('gemini');
  await fs.appendFile(path.join(fx.stageDir, doc), '\n（停点之前追加的一行）\n', 'utf8');

  const aw = await awaitNow(fx.root);
  const out = aw.stdout + aw.stderr;
  assert.equal(aw.code, EXIT.GATE_BLOCK, `--await-approval 没有做 sha256 抽核：\n${out}`);
  assert.ok(out.includes(doc), `要点名被改的文件：${out}`);
  assert.match(out, /已被改动/);
});

/*
 * A4 / A4′：本机闸门项与归档分叉。approve 那一格的出口单独写（计划 r3 §3.2）：
 * approve 没有 --run-id，`review --start` 不抢占 awaiting_approval 的槽位，
 * `--check` / `--await-approval` 不改写别的运行的闸门项——只有 abandon 后重跑走得通。
 * **按出口走一遍**：给出的出口必须真的走得通（cli.ts 里「留痕读不出」那一格被打穿过一次）。
 */
async function setGateRunId(root: string, runId: string | null) {
  const p = path.join(root, ...LOCAL_STATE);
  const st = JSON.parse(await fs.readFile(p, 'utf8')) as { gates: Record<string, { run_id: string | null }> };
  st.gates[`${TOPIC}/plan`]!.run_id = runId;
  await fs.writeFile(p, JSON.stringify(st, null, 2), 'utf8');
}

async function walkAbandonExit(fx: Fx) {
  const ab = await cli(fx.root, ['abandon', '--topic', TOPIC, '--stage', 'plan', '--reason', '本机闸门项与归档分叉']);
  assert.equal(ab.code, EXIT.OK, `给出的出口 abandon 走不通：\n${ab.stdout}${ab.stderr}`);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'abandoned');
  // 出口的后半：重跑该阶段双审能抢占槽位
  const rerun = await runPlan(fx.root, 'C');
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.run_id, rerun, '重跑后闸门应指向新一轮');
}

test('A4：闸门项没有 run_id ⇒ approve 退 65（第 1 步拒绝、不跳过复核），出口 abandon 后重跑走得通', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  await setGateRunId(fx.root, null);

  const r = await approveNow(fx.root);
  const out = r.stdout + r.stderr;
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `推断不出 run_id 仍放行或退错码：\n${out}`);
  assert.ok(out.includes(APPROVAL_CHECK_NO_RUN_ID), `缺第 1 步的判别文字：${out}`);
  assert.ok(!out.includes(APPROVAL_CHECK_META_UNREADABLE));
  assert.match(out, /dual-abandon/, 'approve 这一格的出口是 abandon 后重跑');
  assert.doesNotMatch(out, /用 --run-id/, 'approve 没有 --run-id，不能把它当出口给出去');
  await assertNotApproved(fx);
  await walkAbandonExit(fx);
});

test('A4′：闸门项指向不存在的运行 ⇒ approve 退 65（第 2 步拒绝），出口同样走得通', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  await setGateRunId(fx.root, '20990101T000000Z');

  const r = await approveNow(fx.root);
  const out = r.stdout + r.stderr;
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `运行元数据读不出仍放行或退错码：\n${out}`);
  assert.ok(out.includes(APPROVAL_CHECK_META_UNREADABLE), `缺第 2 步的判别文字：${out}`);
  assert.ok(!out.includes(APPROVAL_CHECK_NO_RUN_ID));
  assert.match(out, /20990101T000000Z/);
  assert.match(out, /dual-abandon/);
  // 读不出那一条先给恢复、再给 abandon，并以共用出口段收尾（留痕读不出的出口计划 r2 §2.2，AGY-01）
  assertApproveForkExit(out, path.join(fx.stageDir, '_meta', 'run-20990101T000000Z.json'));
  await assertNotApproved(fx);
  await walkAbandonExit(fx);
});

/** approve 读不出那一条的出口形态：恢复在前、abandon 在后、条件句在、以共用出口段收尾 */
function assertApproveForkExit(out: string, file: string) {
  const restore = out.indexOf('恢复后直接重新 approve');
  const abandon = out.indexOf('dual-abandon');
  assert.ok(restore >= 0, `没给「先恢复、恢复后直接重新 approve」：\n${out}`);
  assert.ok(abandon > restore, `abandon 排在了恢复之前——会作废一轮有效的审查结论（AGY-01）：\n${out}`);
  assert.match(out, /重跑同样会被拒绝/, 'abandon 之后的重跑是有条件的，要说清');
  assertUnreadableExit(out, [file], 'approve（闸门项的 run_id 读不出）');
}

/*
 * A4″（E2）：闸门项指向的正是该阶段**最新且读不出**的那一份（留痕读不出的出口计划 r2 §1.4 E2 / §5.2）。
 * 上一版出口是「abandon 后重跑」：abandon 走得通，重跑却撞 `review --start` 的 `corrupt` 判定退 2——
 * **按出口走一遍**，走到的应当是共用出口段说的那一步，而不是又一次「重跑」。
 */
test('A4″：闸门项指向最新且读不出的运行 ⇒ approve 退 65；abandon 走得通，重跑仍被拒且给同一段出口', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await toAwaitingApproval(fx);
  const file = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  await fs.writeFile(file, '{}\n', 'utf8');

  const r = await approveNow(fx.root);
  const out = r.stdout + r.stderr;
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `运行元数据读不出仍放行或退错码：\n${out}`);
  assert.ok(out.includes(APPROVAL_CHECK_META_UNREADABLE), out);
  assertApproveForkExit(out, file);
  await assertNotApproved(fx);

  const ab = await cli(fx.root, ['abandon', '--topic', TOPIC, '--stage', 'plan', '--reason', '留痕读不出']);
  assert.equal(ab.code, EXIT.OK, `abandon 应当总走得通（它不读这份留痕）：\n${ab.stdout}${ab.stderr}`);
  const rerun = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--entry', 'C', '--session-id', SESSION, '--json'],
    STUB,
  );
  assert.equal(rerun.code, EXIT.GATE_BLOCK, `读不出的正是最新一份，重跑应被 corrupt 判定拒绝：\n${rerun.stdout}${rerun.stderr}`);
  assertUnreadableExit(rerun.stderr, [file], 'review --start（abandon 之后重跑）');
});

/*
 * A4‴（E3，计划双审 AGY-01）：同 E2，但这份留痕已提交过——② 档的出口是用户在终端 `git restore`，
 * 恢复之后**直接重新 approve**：复核没过时闸门保持等待审批，这一轮的审查结论照样有效，不必 abandon 重跑。
 * 夹具里由用例代为执行 restore（真实场景是用户在终端里做，会话里会被 Hook 拦下）。
 */
test('A4‴：已提交的运行留痕在工作树里被改坏 ⇒ approve 退 65；restore 之后直接重新 approve 即通过', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await toAwaitingApproval(fx);
  const { run } = await import('../../src/trivium/util/exec.js');
  const git = (args: string[]) => run('git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args], { cwd: fx.root, timeoutMs: 30_000 });
  assert.equal((await git(['add', '-A'])).code, 0);
  assert.equal((await git(['commit', '-q', '--no-verify', '-m', '归档'])).code, 0);

  const file = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  await fs.writeFile(file, '{}\n', 'utf8');
  const r = await approveNow(fx.root);
  const out = r.stdout + r.stderr;
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, out);
  assertApproveForkExit(out, file);
  await assertNotApproved(fx);

  const restored = await git(['restore', file]);
  assert.equal(restored.code, 0, `${restored.stdout}${restored.stderr}`);
  const again = await approveNow(fx.root);
  assert.equal(again.code, EXIT.OK, `恢复后重新 approve 应当通过：\n${again.stdout}${again.stderr}`);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'approved');
});

test('拒绝与放弃不复核：停点之后裁决件被删，reject 照常生效', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  await fs.rm(path.join(fx.stageDir, `${today()}-${TOPIC}-revised-claude.md`));
  const rej = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reject', '--reason', '方向不对']);
  assert.equal(rej.code, EXIT.OK, `拒绝不该被复核挡住：\n${rej.stdout}${rej.stderr}`);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'rejected');
});

// ─────────── 审批时的工作树改动摘要（EV-132 候选 ② 折中版，计划 `.reviews/审批前工作树摘要/plan/` r2 §3.2）───────────
/*
 * 闸门期改业务文件，审批前复核看不见（M10b 第 4 步 3-4：终端改 NOTES.md 后 approve 退 0）。
 * 折中版只**告知**：approve 与停点把「自审查收尾以来工作树变了什么」打印出来，退出码与闸门迁移一律不变。
 * W1～W8 钉的是两件事：列得出来；列不出来时不假称「无改动」、也不挡审批。
 */

/** 带额外环境变量调 CLI（摘要预算注入用，同 `TRIVIUM_STUB_CRITIC` 的注入惯例） */
async function cliEnv(root: string, args: string[], extra: Record<string, string>) {
  const { run } = await import('../../src/trivium/util/exec.js');
  const { BUNDLE, ASSET_ROOT } = await import('../helpers/fixture.js');
  return run(process.execPath, [BUNDLE, ...args], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, TRIVIUM_STUB_CRITIC: undefined, ...extra },
    timeoutMs: 120_000,
  });
}

const approveJson = (root: string) =>
  cli(root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION, '--json']);

type SummaryJson = { run_id: string; available: boolean; reason: string | null; total: number; truncated: boolean; baseline_tree: string | null; files: { status: string; path: string }[]; budget_ms: number; budget_overridden: boolean };

const approvedLast = async (fx: Fx) => (await approvalsOf(fx.archiveRoot)).at(-1)?.decision === 'approved';

test('W1：闸门期新建 NOTES.md ⇒ approve 仍退 0、照常落审批，输出里列出 NOTES.md', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  await fs.writeFile(path.join(fx.root, 'NOTES.md'), '闸门期追加的一行\n', 'utf8');
  const r = await approveNow(fx.root);
  assert.equal(r.code, EXIT.OK, `摘要只告知，不得挡审批：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /工作树改动摘要（只告知，不影响审批结论）/);
  assert.match(r.stdout, /\n {2}A {2}NOTES\.md\n/);
  // 先打印摘要、再落审批（计划双审 CODEX-03）
  assert.ok(r.stdout.indexOf('工作树改动摘要') < r.stdout.indexOf('已通过'), r.stdout);
  assert.ok(await approvedLast(fx), '审批照常落盘');
});

test('W2：闸门期没有改动 ⇒ approve 退 0，输出「无改动」一行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  const r = await approveNow(fx.root);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /未被 \.gitignore 忽略的文件无改动/);
});

test('W3：approve --json 带 worktree_summary（按阶段），含 total 与 truncated', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await toAwaitingApproval(fx);
  await fs.writeFile(path.join(fx.root, 'NOTES.md'), 'x\n', 'utf8');
  const r = await approveJson(fx.root);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as { decision: string; worktree_summary: Record<string, SummaryJson> };
  assert.equal(js.decision, 'approved');
  const s = js.worktree_summary['plan']!;
  assert.equal(s.run_id, runId);
  assert.equal(s.available, true);
  assert.deepEqual(s.files, [{ status: 'A', path: 'NOTES.md' }]);
  assert.equal(s.total, 1);
  assert.equal(s.truncated, false);
  assert.equal(s.budget_ms, 20_000);
  assert.equal(s.budget_overridden, false);
});

test('W4：停点出口也打印摘要——--check 自动立停点与 --await-approval 都列出改动', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'C');
  await writeDisposition(fx.stageDir, runId);
  await fs.writeFile(path.join(fx.root, 'NOTES.md'), '裁决期改的\n', 'utf8');
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);
  assert.match(check.stdout, /\n {2}A {2}NOTES\.md\n/, check.stdout);
  assert.match(check.stdout, /审批时会再列出一次/);

  const aw = await awaitNow(fx.root);
  assert.equal(aw.code, EXIT.OK, `${aw.stdout}${aw.stderr}`);
  assert.match(aw.stdout, /\n {2}A {2}NOTES\.md\n/, aw.stdout);

  const awj = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--json']);
  assert.equal(awj.code, EXIT.OK, `${awj.stdout}${awj.stderr}`);
  const js = JSON.parse(extractJsonCandidate(awj.stdout)!.json) as { worktree_summary: SummaryJson };
  assert.deepEqual(js.worktree_summary.files, [{ status: 'A', path: 'NOTES.md' }]);
});

test('W5：基线被 git 清理 ⇒ approve 仍退 0、照常落审批，报「取不到」而不是「无改动」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  /*
   * 收尾基线要不等于 HEAD 的 tree，才是不可达对象、gc 能清掉。EV-221 起归档根与 .trivium/ 不进 tree，
   * 只有归档件变化时基线就是 HEAD 的 tree（可达，gc 清不掉）；所以审查前放一个未跟踪的业务文件，
   * 它进送审快照与收尾基线（两边都有，不算漂移）。
   */
  await fs.writeFile(path.join(fx.root, 'scratch-note.txt'), '让收尾基线不等于 HEAD 的 tree\n', 'utf8');
  await toAwaitingApproval(fx);
  const { run } = await import('../../src/trivium/util/exec.js');
  const gc = await run('git', ['gc', '-q', '--prune=now'], { cwd: fx.root, timeoutMs: 60_000 });
  assert.equal(gc.code, 0, gc.stderr);
  const r = await approveNow(fx.root);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /工作树改动摘要取不到：基线对象已不在对象库/);
  assert.doesNotMatch(r.stdout + r.stderr, /无改动/);
  assert.ok(await approvedLast(fx), '摘要取不到也不影响落审批');
});

test('W6：审查收尾把 after_tree_hash 落进 run.json，且过 run.v2 schema', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const runId = await runPlan(fx.root, 'C');
  const meta = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), 'utf8')) as {
    snapshot: { tree_hash: string; after_tree_hash?: string };
  };
  assert.match(meta.snapshot.after_tree_hash ?? '', /^[0-9a-f]{40}$/);
  const { validateRunMeta } = await import('../../src/trivium/schemas.js');
  assert.deepEqual(validateRunMeta(meta), []);
});

test('W7：摘要超时 ⇒ approve 退 0、照常落审批，报超时（先打印再落审批不让摘要挡住审批）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  const { SUMMARY_BUDGET_ENV } = await import('../../src/trivium/worktree-summary.js');
  const r = await cliEnv(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION], { [SUMMARY_BUDGET_ENV]: '1' });
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /工作树改动摘要取不到：工作树摘要超时（超过 1 毫秒）。/);
  // 代码双审 r1 CODEX-02：注入生效要自我暴露，不与真实超时同形
  assert.match(r.stderr, new RegExp(`预算被 ${SUMMARY_BUDGET_ENV} 覆盖为 1 毫秒，这只应出现在测试里`));
  assert.ok(await approvedLast(fx), '摘要超时也不影响落审批');
});

test('W8：同阶段重跑一轮后审批 ⇒ 摘要的 run id 与基线都取自闸门项指向的新一轮（计划双审 CODEX-09）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await toAwaitingApproval(fx);
  assert.equal((await approveNow(fx.root)).code, EXIT.OK);

  const runId2 = await runPlan(fx.root, 'C');
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-r2-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId2}`,
      'addresses:', `  - ${today()}-${TOPIC}-r2-gemini.md`, `  - ${today()}-${TOPIC}-r2-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 第二轮仍需补 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 同上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );
  // 第一轮写了 r2（被第二轮送审），第二轮的接受项合进 r3（EV-214）
  await writeNextPlan(fx.stageDir, 3, ['AGY-01', 'GLM-01']);
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.run_id, runId2, '前提：闸门项指向新一轮');

  await fs.writeFile(path.join(fx.root, 'NOTES.md'), 'y\n', 'utf8');
  const r = await approveJson(fx.root);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const s = (JSON.parse(extractJsonCandidate(r.stdout)!.json) as { worktree_summary: Record<string, SummaryJson> }).worktree_summary['plan']!;
  assert.equal(s.run_id, runId2);
  const meta2 = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId2}.json`), 'utf8')) as {
    snapshot: { after_tree_hash: string };
  };
  assert.equal(s.baseline_tree, meta2.snapshot.after_tree_hash);
  assert.deepEqual(s.files.map((f) => f.path), ['NOTES.md']);
});

// ── 闸门拦截不留骨架（EV-109 / EV-145 ①，计划 r2 §4.2 B5～B7）：置闸门之后的失败由 prepareRun 自己回收 ──

const NOT_ROOT_SKIP = (bundleMissing && bundleSkipReason) || (process.getuid?.() === 0 && 'root 下只读目录拦不住写入');

/** 主题目录只读（阶段目录仍可写）：brief 与骨架写得进去，task.json 的原子写（同目录临时文件）写不进 ⇒ registerRun 抛 */
async function startWithTopicDirReadonly(root: string, archiveRoot: string) {
  const topicDir = path.join(archiveRoot, TOPIC);
  await fs.chmod(topicDir, 0o555);
  try {
    return await cli(
      root,
      ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
      STUB,
    );
  } finally {
    await fs.chmod(topicDir, 0o755);
  }
}

/** run.json 里本组用例要看的几项 */
interface RunMetaLike {
  status: string;
  finished_at: string | null;
  gate: { state: string };
  termination?: unknown;
  artifacts: { path: string }[];
}
const readRunJson = async (stageDir: string, runId: string) =>
  JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${runId}.json`), 'utf8')) as RunMetaLike;

/** report --json 里某次运行在「未进时间线的运行」表中的说明 */
async function unlistedLabelOf(root: string, runId: string): Promise<string | undefined> {
  const rep = await cli(root, ['report', '--topic', TOPIC, '--json']);
  const rj = JSON.parse(extractJsonCandidate(rep.stdout)!.json) as { unlistedRuns: { runId: string; label: string }[] };
  return rj.unlistedRuns.find((u) => u.runId === runId)?.label;
}

const runMetaIds = async (stageDir: string) =>
  (await fs.readdir(path.join(stageDir, '_meta')).catch(() => [] as string[]))
    .map((n) => /^run-(.+)\.json$/.exec(n)?.[1])
    .filter((x): x is string => x !== undefined)
    .sort();

test('事后收尾余项 P1（原闸门拦截不留骨架 B5）：置闸门之后登记失败 ⇒ 闸门回收为 idle、锁已放、骨架收尾为 failed（prepare_exception）；重跑前不带 --run-id 的 gate 仍指向它', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const r = await startWithTopicDirReadonly(fx.root, fx.archiveRoot);
  assert.notEqual(r.code, EXIT.OK, `登记写不进时 --start 应失败：\n${r.stdout}${r.stderr}`);

  const ids = await runMetaIds(fx.stageDir);
  assert.equal(ids.length, 1, `骨架写在登记之前，应恰有一份：${ids.join(', ')}`);
  const skeletonId = ids[0]!;
  const g = (await gatesOf(fx.root))[`${TOPIC}/plan`];
  assert.ok(g, '首轮置过闸门，回收后留一条 idle 条目（计划 r2 §3.2 / D2）');
  assert.equal(g.state, 'idle', '置闸门之后的失败必须回收，不能停在 running 直到 TTL');
  assert.equal(g.run_id, skeletonId);
  const lockDir = path.join(fx.root, '.trivium', 'lock');
  assert.ok(!(await fs.readdir(lockDir).catch(() => [] as string[])).includes(`${TOPIC}.lock`), '主题锁必须已释放');

  // 事后收尾余项计划 r2 §3.2：写完骨架之后才失败的，回收闸门之后由 prepareRun 自己把骨架收尾为 failed
  // （闸门拦截不留骨架计划 r2 D3 当时只回收闸门、骨架留 running，EV-145 余项在这里落地）
  const skeleton = await readRunJson(fx.stageDir, skeletonId);
  assert.equal(skeleton.status, 'failed');
  assert.equal(skeleton.gate.state, 'failed');
  assert.ok(skeleton.finished_at, 'finished_at 应写上');
  assert.deepEqual(skeleton.termination, { by: 'prepare_exception', exit_code: EXIT.FAIL });
  assert.deepEqual(
    skeleton.artifacts.map((a) => path.basename(a.path)).sort(),
    [`brief-gemini-${skeletonId}.md`, `brief-glm-${skeletonId}.md`],
    'artifacts 原样',
  );
  assert.equal(await fs.stat(path.join(fx.archiveRoot, TOPIC, TASK_NAME)).catch(() => null), null, '登记没写成：主题任务文件不存在，收尾也不新建');
  assert.match(r.stderr, /收尾为 failed（准备阶段失败）/, r.stderr);

  // 计划 r2 D5：不改 latestRunMeta——到下一次成功重跑之前，不带 --run-id 的 gate 仍指向这份（已收尾的）骨架
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION]);
  const cj = JSON.parse(extractJsonCandidate(check.stdout)!.json) as { run_id: string };
  assert.equal(cj.run_id, skeletonId);

  // report 的说明写清「没拉起审查员」
  assert.equal(await unlistedLabelOf(fx.root, skeletonId), '准备阶段失败，未拉起审查员（退出码 1）');
});

test('闸门拦截不留骨架 B6：上一轮已审批（槽位 approved）时置闸门之后失败 ⇒ 回收为 idle，不恢复成 approved（D2 (a)）', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const r1 = await runPlan(fx.root, 'B');
  await writeDisposition(fx.stageDir, r1);
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
  assert.equal(check.code, EXIT.OK, `${check.stdout}${check.stderr}`);
  const ok = await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION]);
  assert.equal(ok.code, EXIT.OK, `${ok.stdout}${ok.stderr}`);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'approved', '前提：槽位已是 approved');

  await new Promise((res) => setTimeout(res, 1100)); // 避开 run_id 同秒撞名（计划 r2 §2.3）
  const r = await startWithTopicDirReadonly(fx.root, fx.archiveRoot);
  assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const ids = await runMetaIds(fx.stageDir);
  const g = (await gatesOf(fx.root))[`${TOPIC}/plan`];
  assert.equal(g?.state, 'idle');
  assert.equal(g?.run_id, ids.at(-1), '回收后的条目记的是失败那一次');
});

test('闸门拦截不留骨架 B7：置闸门之后重置收工阻断计数失败 ⇒ 同样回收闸门、锁已放、零工件', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // resetStopBlockCount 递归删除 lock/stopblock-<主题>-<阶段>：里面放一个只读子目录和一个文件，删除必 EACCES；lock/ 本身仍可写
  const blockDir = path.join(fx.root, '.trivium', 'lock', `stopblock-${TOPIC}-plan`);
  const sub = path.join(blockDir, 'sub');
  await fs.mkdir(sub, { recursive: true });
  await fs.writeFile(path.join(sub, 'n'), '1\n', 'utf8');
  await fs.chmod(sub, 0o555);
  const before = await listFiles(fx.archiveRoot);
  let stderr = '';
  try {
    const r = await cli(
      fx.root,
      ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
      STUB,
    );
    assert.notEqual(r.code, EXIT.OK, `计数删不掉时 --start 应失败：\n${r.stdout}${r.stderr}`);
    stderr = r.stderr;
  } finally {
    await fs.chmod(sub, 0o755);
  }
  const g = (await gatesOf(fx.root))[`${TOPIC}/plan`];
  assert.ok(g, '闸门置过，回收后留一条 idle');
  assert.equal(g.state, 'idle', '重置计数排在 try 里：抛了也要回收闸门（r1 AGY-02 ≡ GLM-02）');
  assert.ok(!(await fs.readdir(path.join(fx.root, '.trivium', 'lock'))).includes(`${TOPIC}.lock`), '主题锁必须已释放');
  assert.deepEqual(await listFiles(fx.archiveRoot), before, '重置计数在落盘段之前，失败时 .reviews/ 不得多出文件');
  // 事后收尾余项计划 r2 §3.2 / §4.2：骨架还没写就失败，不进收尾（否则只会多一行「归档里没有」）
  assert.doesNotMatch(stderr, /收尾为 failed|未回写/, stderr);
});

// ── 事后收尾余项（EV-145 余项，计划 r2 §4.2 P2～P6）：准备阶段与同步路径的本进程收尾 ──

type TaskRunLike = { run_id: string; status: string };
const taskRunsOf = async (archiveRoot: string): Promise<TaskRunLike[] | null> =>
  fs.readFile(path.join(archiveRoot, TOPIC, TASK_NAME), 'utf8')
    .then((t) => (JSON.parse(t) as { runs: TaskRunLike[] }).runs)
    .catch(() => null);

/**
 * 预建运行目录（计划 r2 §4.2，r1 CODEX-02）：run_id 只到秒、生成时刻不可预知，所以把从现在起 60 秒内每一秒
 * 可能用到的运行目录都建出来，交给 `prep` 做手脚。夹具根已 realpath（`makeFixture`），CLI 算 repoId 用的是同一个。
 * 60 秒远大于满载下一次 `--start` 从这里到落骨架的耗时；用例里只起一次 `--start`，不存在误命中第二次运行的问题。
 * EV-218 起分配 run_id 会排他占运行目录、绕开已存在的目录，所以这几格经 `startPlan` 带测试开关接管预建目录。
 */
async function precreateRunDirs(fx: Fixture, prep: (dir: string) => Promise<void>): Promise<{ ids: Set<string>; dirs: string[] }> {
  const { repoId } = await import('../../src/trivium/review.js');
  const { newRunId } = await import('../../src/trivium/meta.js');
  const base = path.join(fx.runRoot, repoId(fx.root));
  const ids = new Set<string>();
  const dirs: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const id = newRunId(new Date(t0 + i * 1000));
    ids.add(id);
    const d = path.join(base, id);
    await fs.mkdir(d, { recursive: true });
    await prep(d);
    dirs.push(d);
  }
  return { ids, dirs };
}

/**
 * 命中前置断言：本次 `--start` 写下的唯一一份骨架必须落在预建集合里。不命中就以明确文案失败、不进后续断言——
 * 免得把「窗口没命中」读成变异逃逸或反向误红（r1 CODEX-02）。
 */
async function hitRunId(stageDir: string, ids: Set<string>): Promise<string> {
  const all = await runMetaIds(stageDir);
  assert.equal(all.length, 1, `预建窗口未命中：_meta 里应恰有一份本次的骨架，实为 ${all.join(', ') || '无'}`);
  assert.ok(ids.has(all[0]!), `预建窗口未命中：run ${all[0]} 不在预建集合里`);
  return all[0]!;
}

/** 结束预建集合里任何 run_id 的残留 worker（P4 必做；命中断言失败时也要跑，§2.3 附记的教训） */
async function killWorkersOf(ids: Set<string>): Promise<number[]> {
  const { run, killProcessTree } = await import('../../src/trivium/util/exec.js');
  const ps = await run('/bin/ps', ['-axo', 'pid=,command='], { timeoutMs: 10_000 });
  const pids: number[] = [];
  for (const line of ps.stdout.split('\n')) {
    const m = /review --worker (\S+)/.exec(line);
    if (m && ids.has(m[1]!)) {
      const pid = Number.parseInt(line.trim(), 10);
      if (pid > 0) {
        pids.push(pid);
        killProcessTree(pid, 'SIGKILL');
      }
    }
  }
  return pids;
}

/**
 * 只给本节预建运行目录的故障注入用例用：带 `TRIVIUM_TEST_ADOPT_PRECREATED_RUN_DIR=1`（EV-218 候选 A）。
 * EV-218 起 `allocateRunId` 排他占运行目录，预建的目录会被当成别的运行的而绕开；开关让它接管预建目录，这几格才测得到
 * 「落骨架之后写盘失败」。其余用例不设这个开关。
 */
const startPlan = (root: string, stub: StubConfig = STUB) =>
  cli(
    root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    stub,
    120_000,
    { [ADOPT_PRECREATED_RUN_DIR_ENV]: '1' },
  );

const syncPlan = (root: string) =>
  cli(root, ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION], STUB);

test('事后收尾余项 P2：第 1 轮已审批后第 2 轮登记失败 ⇒ 第 2 轮骨架收尾为 prepare_exception；主题任务文件与第 1 轮 run.json 逐字节不变', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const r1 = await runPlan(fx.root, 'B');
  await writeDisposition(fx.stageDir, r1);
  assert.equal((await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION])).code, EXIT.OK);
  assert.equal((await cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--session-id', SESSION])).code, EXIT.OK);
  const taskBefore = await fs.readFile(path.join(fx.archiveRoot, TOPIC, TASK_NAME));
  const r1Before = await fs.readFile(path.join(fx.stageDir, '_meta', `run-${r1}.json`));

  await new Promise((res) => setTimeout(res, 1100)); // 避开 run_id 同秒撞名（EV-147）
  const r = await startWithTopicDirReadonly(fx.root, fx.archiveRoot);
  assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const r2 = (await runMetaIds(fx.stageDir)).at(-1)!;
  assert.notEqual(r2, r1);
  const m2 = await readRunJson(fx.stageDir, r2);
  assert.equal(m2.status, 'failed');
  assert.deepEqual(m2.termination, { by: 'prepare_exception', exit_code: EXIT.FAIL });
  assert.deepEqual(await fs.readFile(path.join(fx.archiveRoot, TOPIC, TASK_NAME)), taskBefore, '本次条目不存在：第二步跳过、不新建');
  assert.deepEqual(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${r1}.json`)), r1Before, '第 1 轮不受影响');
  assert.match(r.stderr, /task\.json 的运行登记未改：task\.json 无此运行的登记/, r.stderr);
});

test('事后收尾余项 P3：startRun 派生前失败（写交接文件 EACCES）⇒ 骨架与登记收尾为 failed（prepare_exception），闸门 idle、锁已放', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const { ids, dirs } = await precreateRunDirs(fx, (d) => fs.chmod(d, 0o555));
  let r: Awaited<ReturnType<typeof cli>>;
  try {
    r = await startPlan(fx.root);
  } finally {
    for (const d of dirs) await fs.chmod(d, 0o755).catch(() => {});
  }
  assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const runId = await hitRunId(fx.stageDir, ids);
  const m = await readRunJson(fx.stageDir, runId);
  assert.equal(m.status, 'failed');
  assert.deepEqual(m.termination, { by: 'prepare_exception', exit_code: EXIT.FAIL });
  assert.deepEqual((await taskRunsOf(fx.archiveRoot))?.map((t) => [t.run_id, t.status]), [[runId, 'failed']]);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'idle');
  assert.ok(!(await fs.readdir(path.join(fx.root, '.trivium', 'lock'))).includes(`${TOPIC}.lock`), '主题锁必须已释放');
  assert.match(r.stderr, /收尾为 failed（准备阶段失败）/, r.stderr);
});

test('事后收尾余项 P3b：spawnDetached 内部、子进程诞生之前失败（开日志文件 EISDIR）⇒ 同样收尾为 prepare_exception，且没有 worker', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const { ids } = await precreateRunDirs(fx, (d) => fs.mkdir(path.join(d, 'worker.log')));
  try {
    const r = await startPlan(fx.root);
    assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
    const runId = await hitRunId(fx.stageDir, ids);
    const m = await readRunJson(fx.stageDir, runId);
    assert.equal(m.status, 'failed', '计划 r2 §3.3（r1 CODEX-03 ≡ GLM-02）：子进程没诞生，这一格归派生前、要收尾');
    assert.deepEqual(m.termination, { by: 'prepare_exception', exit_code: EXIT.FAIL });
    assert.deepEqual((await taskRunsOf(fx.archiveRoot))?.map((t) => t.status), ['failed']);
  } finally {
    assert.deepEqual(await killWorkersOf(ids), [], '子进程诞生之前失败，不应有 worker');
  }
});

// ── EV-150（派生后失败的孤儿worker计划 r2 §4.2 P4 / P4b / P4c）：子进程诞生之后失败 ⇒ 终止 worker 并收尾 ──

const HANG: StubConfig = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };

/** 运行目录里的 status.json（夹具运行根是 `fx.runRoot`，见 precreateRunDirs） */
async function statusJsonOf(fx: Fixture, runId: string): Promise<{ phase: string; worker_pid: number | null } | null> {
  const { repoId } = await import('../../src/trivium/review.js');
  return fs.readFile(path.join(fx.runRoot, repoId(fx.root), runId, 'status.json'), 'utf8')
    .then((t) => JSON.parse(t) as { phase: string; worker_pid: number | null })
    .catch(() => null);
}

test('派生后失败的孤儿worker P4：子进程诞生之后才失败（写 worker.pid EISDIR，hang 桩）⇒ 终止 worker 并收尾为 post_spawn_exception，--wait / --cancel 按终态处理，没有残留 worker', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const { ids } = await precreateRunDirs(fx, (d) => fs.mkdir(path.join(d, 'worker.pid')));
  try {
    const r = await startPlan(fx.root, HANG);
    assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
    const runId = await hitRunId(fx.stageDir, ids);
    const m = await readRunJson(fx.stageDir, runId);
    assert.equal(m.status, 'failed', 'EV-150：worker 已被终止并确认退出，本进程是唯一写者');
    assert.equal(m.gate.state, 'failed');
    assert.deepEqual(m.termination, { by: 'post_spawn_exception', exit_code: EXIT.FAIL });
    assert.deepEqual((await taskRunsOf(fx.archiveRoot))?.map((t) => [t.run_id, t.status]), [[runId, 'failed']]);
    assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'idle');
    assert.ok(!(await fs.readdir(path.join(fx.root, '.trivium', 'lock'))).includes(`${TOPIC}.lock`), '主题锁必须已释放');
    const st = await statusJsonOf(fx, runId);
    assert.equal(st?.phase, 'failed');
    assert.ok(st?.worker_pid, 'status.json 应补记 worker_pid');
    assert.match(r.stderr, /已终止工作进程组/, r.stderr);
    assert.match(r.stderr, /收尾为 failed（派生后启动未完成）/, r.stderr);

    const w = await cli(fx.root, ['review', '--wait', runId, '--timeout', '5'], HANG);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    assert.doesNotMatch(`${w.stdout}${w.stderr}`, /失联/, '按终态返回，不走失联路径');
    const c = await cli(fx.root, ['review', '--cancel', runId], HANG);
    assert.match(`${c.stdout}${c.stderr}`, /已处于终态/);
    assert.deepEqual(await readRunJson(fx.stageDir, runId), m, '--wait / --cancel 之后 run.json 不再被改');
  } finally {
    assert.deepEqual(await killWorkersOf(ids), [], 'EV-150：--start 非零退出时不得留下孤儿 worker');
  }
});

test('派生后失败的孤儿worker P4b：同一构造换 ok 桩 ⇒ 3 秒后闸门仍 idle、run.json 仍 failed、没有审查文档（孤儿不会事后改写）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const { ids } = await precreateRunDirs(fx, (d) => fs.mkdir(path.join(d, 'worker.pid')));
  try {
    const r = await startPlan(fx.root, STUB);
    assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
    const runId = await hitRunId(fx.stageDir, ids);
    const docsBefore = (await fs.readdir(fx.stageDir)).filter((n) => n.endsWith('.md')).sort();
    await new Promise((res) => setTimeout(res, 3000)); // 今天的孤儿约 0.3 s 就跑完（计划 r2 §2.2）
    const g = (await gatesOf(fx.root))[`${TOPIC}/plan`];
    assert.equal(g?.state, 'idle', '今天这里会被孤儿置成 review_done_awaiting_disposition');
    const m = await readRunJson(fx.stageDir, runId);
    assert.equal(m.status, 'failed', '今天这里会被孤儿改写成 success');
    assert.deepEqual(m.termination, { by: 'post_spawn_exception', exit_code: EXIT.FAIL });
    assert.deepEqual((await fs.readdir(fx.stageDir)).filter((n) => n.endsWith('.md')).sort(), docsBefore, '不应出现审查文档');
  } finally {
    assert.deepEqual(await killWorkersOf(ids), [], 'EV-150：--start 非零退出时不得留下孤儿 worker');
  }
});

test('派生后失败的孤儿worker P4c：失败之后同阶段再 --start ⇒ 正常起跑，进程表里只有新一轮的 worker（不再有两个并发）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const { ids, dirs } = await precreateRunDirs(fx, (d) => fs.mkdir(path.join(d, 'worker.pid')));
  let second: string | null = null;
  try {
    const r = await startPlan(fx.root, HANG);
    assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
    const first = await hitRunId(fx.stageDir, ids);
    for (const d of dirs) if (path.basename(d) !== first) await fs.rm(d, { recursive: true, force: true });
    await new Promise((res) => setTimeout(res, 1100)); // 避开 run_id 同秒撞名（EV-147）
    const r2 = await startPlan(fx.root, HANG);
    assert.equal(r2.code, EXIT.OK, `${r2.stdout}${r2.stderr}`);
    second = (JSON.parse(r2.stdout.slice(r2.stdout.indexOf('{'))) as { run_id: string }).run_id;
    assert.notEqual(second, first);
    const { run } = await import('../../src/trivium/util/exec.js');
    const ps = await run('/bin/ps', ['-axo', 'pid=,command='], { timeoutMs: 10_000 });
    const workers = ps.stdout.split('\n').map((l) => /review --worker (\S+)/.exec(l)?.[1]).filter((x) => x === first || x === second);
    assert.deepEqual(workers, [second], '只应有新一轮的 worker');
  } finally {
    // 只做清理、不断言：--cancel 刚发完信号，进程表未必已刷新
    if (second) await cli(fx.root, ['review', '--cancel', second], HANG);
    await killWorkersOf(new Set([...ids, ...(second ? [second] : [])]));
  }
});

test('事后收尾余项 P5：同步路径 executeRun 抛错（写审查文档 EACCES）⇒ 骨架与登记收尾为 failed（sync_exception），闸门 idle', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await fs.mkdir(path.join(fx.stageDir, '_meta'), { recursive: true });
  await fs.chmod(fx.stageDir, 0o555); // 审查文档写不进阶段目录；_meta 仍可写
  let r: Awaited<ReturnType<typeof cli>>;
  try {
    r = await syncPlan(fx.root);
  } finally {
    await fs.chmod(fx.stageDir, 0o755);
  }
  assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const ids = await runMetaIds(fx.stageDir);
  assert.equal(ids.length, 1);
  const m = await readRunJson(fx.stageDir, ids[0]!);
  assert.equal(m.status, 'failed');
  assert.equal(m.gate.state, 'failed');
  assert.deepEqual(m.termination, { by: 'sync_exception', exit_code: EXIT.FAIL });
  assert.deepEqual((await taskRunsOf(fx.archiveRoot))?.map((t) => t.status), ['failed']);
  assert.equal((await gatesOf(fx.root))[`${TOPIC}/plan`]?.state, 'idle');
  assert.match(r.stderr, /收尾为 failed（同步路径异常）/, r.stderr);
  assert.equal(await unlistedLabelOf(fx.root, ids[0]!), '同步路径异常（退出码 1）');
});

test('事后收尾余项 P6：同步路径在准备阶段就失败（登记写不进）⇒ 只由 prepareRun 收尾一次（prepare_exception），同步路径的 catch 不再收', { skip: NOT_ROOT_SKIP }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const topicDir = path.join(fx.archiveRoot, TOPIC);
  await fs.chmod(topicDir, 0o555);
  let r: Awaited<ReturnType<typeof cli>>;
  try {
    r = await syncPlan(fx.root);
  } finally {
    await fs.chmod(topicDir, 0o755);
  }
  assert.notEqual(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const ids = await runMetaIds(fx.stageDir);
  assert.equal(ids.length, 1);
  const m = await readRunJson(fx.stageDir, ids[0]!);
  assert.deepEqual(m.termination, { by: 'prepare_exception', exit_code: EXIT.FAIL });
  assert.equal((r.stderr.match(/收尾为 failed/g) ?? []).length, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /同步路径异常/, r.stderr);
});

/*
 * ── EV-152：--cancel 结束 worker 以 killTree 拉起的审查员 CLI（取消够不到审查员CLI计划 r2 §5.2 I1 / I2）──
 *
 * 桩 `hang_cli` 以仓库的 run() 按 killTree 真实拉起 `sh -c 'sleep 600; : "$0"' trivium-stub-cli:<out_dir>`：
 * 组长 sh 带标记，组员 sleep 不带。判据是「按组号枚举，成员为零」，不是「带标记的那层没了」（计划双审 r1 CODEX-03）。
 * 「未响应 SIGTERM」出自 warn，恒写 stderr（GLM-02）。
 */

async function cancelReachesCli(stub: StubConfig) {
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; run_dir: string };
  const mark = `trivium-stub-cli:${js.run_dir}`;
  let groups: number[] = [];
  try {
    for (let i = 0; i < 100 && groups.length < 2; i++) {
      groups = leaderGroupsWithMark(mark);
      if (groups.length < 2) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(groups.length, 2, '桩 CLI 没起来：两侧的组长都应出现，用例前提不成立');
    for (const g of groups) assert.equal(groupMemberCount(g), 2, `组 ${g} 应有 sh 与 sleep 两个成员，用例前提不成立`);

    const t0 = Date.now();
    const c = await cli(fx.root, ['review', '--cancel', js.run_id]);
    const ms = Date.now() - t0;
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    await new Promise((r) => setTimeout(r, 100));
    const counts = groups.map((g) => groupMemberCount(g));
    const workerLog = await fs.readFile(path.join(js.run_dir, 'worker.log'), 'utf8').catch(() => '');
    const status = JSON.parse(await fs.readFile(path.join(js.run_dir, 'status.json'), 'utf8')) as { phase: string };
    const meta = await readRunJson(fx.stageDir, js.run_id);
    return { fx, js, c, ms, counts, workerLog, status, meta };
  } finally {
    // 残留按组号结束；今天（无处理器）这里会找到两组
    const left = groupsWithMark(mark);
    for (const g of [...new Set([...groups, ...left])]) killGroup(g);
  }
}

test('EV-152 I1：--cancel 结束 worker 以 killTree 拉起的两侧审查员 CLI（整组），归档仍由 cancelRun 收尾为 cancelled', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await cancelReachesCli({ gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } });
  assert.deepEqual(r.counts, [0, 0], `两组都应已空：\n${r.workerLog}`);
  assert.doesNotMatch(r.c.stderr, /未响应 SIGTERM/, 'worker 应在宽限内自己退出，不被升级 SIGKILL');
  assert.match(r.workerLog, /收到 SIGTERM：已按组终止审查员 CLI/);
  assert.equal(r.status.phase, 'cancelled');
  assert.equal(r.meta.status, 'cancelled', '冻结没让 worker 抢先把归档写成 failed（EV-128 语义不变）');
  assert.equal((await gatesOf(r.fx.root))[`${TOPIC}/plan`]?.state, 'idle');
});

test('EV-152 I2：一侧 CLI 忽略 SIGTERM——worker 在宽限内升级 SIGKILL 结束它，--cancel 不被升级', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await cancelReachesCli({ gemini: { mode: 'hang_cli', ignoreTerm: true }, glm: { mode: 'hang_cli' } });
  assert.deepEqual(r.counts, [0, 0], `两组都应已空：\n${r.workerLog}`);
  // 主判据是因果的：stderr 不含「未响应 SIGTERM」即 worker 在宽限内自己退了（计划双审 r1 CODEX-05）
  assert.doesNotMatch(r.c.stderr, /未响应 SIGTERM/);
  assert.match(r.workerLog, /（SIGTERM、SIGKILL）/, '忽略 SIGTERM 的那一组应被升级 SIGKILL');
  assert.equal(r.meta.status, 'cancelled');
  // 计时只防挂住，不承担判据：主判据是上面 stderr 的因果断言（变异 M5 靠它咬住）。实测约 3.6 s；
  // 上界放宽到宽限 + 2 s，满载下也不该假红（代码双审 r1 CODEX-05 ≡ GLM-03）。若因果判据成立而这条超界，按 EV-149 口径先存读数
  assert.ok(r.ms < WORKER_TERM_GRACE_MS + 2000, `--cancel 耗时 ${r.ms} ms（因果判据已过；超界先存读数、别当实现回归）`);
});

/*
 * ── EV-154：worker 跑不到自己的 SIGTERM 处理器的那几格，--cancel 按 status.json 的逐侧 CLI 记录结束 CLI
 *    （CLI进程组记录计划 r2 §5.2 I3～I7）──
 *
 * 判据沿用 I1 / I2：按标记认出两侧组长、按组号枚举成员判「组空」。记录本身也是断言对象：
 * 组号集合必须正是按标记找到的那两组、启动时刻必须已记下。
 */

type SideCli = { pgid: number; started_at: string | null } | null | undefined;

async function sidesCliOf(runDir: string): Promise<Record<string, SideCli>> {
  const s = JSON.parse(await fs.readFile(path.join(runDir, 'status.json'), 'utf8')) as {
    sides: Record<string, { cli?: SideCli }>;
  };
  return Object.fromEntries(Object.entries(s.sides).map(([k, v]) => [k, v.cli]));
}

const pidGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'EPERM';
  }
};

/**
 * 起一轮两侧 hang_cli，等两组组长出现、等 status.json 两侧都记下组号与启动时刻。
 * `extraReview` 透传给夹具的 `review:` 段（EV-146 J 组用它把 `heartbeat_stale_s` 调小）
 */
async function startWithRecordedClis(stub: StubConfig, extraReview?: string[], extraEnv: Record<string, string | undefined> = {}) {
  const fx = await makeFixture({ topic: TOPIC, ...(extraReview ? { extraReview } : {}) });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    stub,
    120_000,
    extraEnv,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; run_dir: string; worker_pid: number };
  const mark = `trivium-stub-cli:${js.run_dir}`;
  let groups: number[] = [];
  for (let i = 0; i < 100 && groups.length < 2; i++) {
    groups = leaderGroupsWithMark(mark);
    if (groups.length < 2) await new Promise((r) => setTimeout(r, 100));
  }
  let rec: Record<string, SideCli> = {};
  for (let i = 0; i < 100; i++) {
    rec = await sidesCliOf(js.run_dir).catch(() => ({}));
    const vals = Object.values(rec);
    if (vals.length === 2 && vals.every((v) => v && v.started_at)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { fx, js, mark, groups, rec };
}

/** 按组 SIGKILL worker 并等它确认不在（它不是本进程的子进程，由 init 回收） */
async function killWorker(pid: number): Promise<void> {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* 已不在 */
  }
  for (let i = 0; i < 100 && !pidGone(pid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(pidGone(pid), `worker ${pid} 应已不在（用例前提）`);
}

function assertRecorded(r: Awaited<ReturnType<typeof startWithRecordedClis>>): void {
  assert.equal(r.groups.length, 2, '桩 CLI 没起来：两侧的组长都应出现，用例前提不成立');
  const pgids = Object.values(r.rec).map((v) => v?.pgid).sort();
  assert.deepEqual(pgids, [...r.groups].sort(), `status.json 两侧的记录应正是这两组：${JSON.stringify(r.rec)}`);
  for (const [side, v] of Object.entries(r.rec)) assert.ok(v?.started_at, `${side} 侧的启动时刻应已记下：${JSON.stringify(r.rec)}`);
}

function cleanupGroups(r: { mark: string; groups: number[] }): void {
  for (const g of [...new Set([...r.groups, ...groupsWithMark(r.mark)])]) killGroup(g);
}

test('EV-154 I3：worker 先被强杀，再 --cancel ⇒ 按记录逐组结束两侧 CLI（忽略 SIGTERM 的那组升级 SIGKILL），收尾 cancelled 并清掉已结束的记录', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis({ gemini: { mode: 'hang_cli', ignoreTerm: true }, glm: { mode: 'hang_cli' } });
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `worker 被强杀后组 ${g} 仍应活着（用例前提）`);

    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    assert.equal((c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, 2, c.stderr);
    assert.match(c.stderr, /gemini 侧进程组 \d+（SIGTERM、SIGKILL）/, c.stderr);
    assert.match(c.stderr, /glm 侧进程组 \d+（SIGTERM）/, c.stderr);
    assert.doesNotMatch(c.stderr, /没有在跑的审查员 CLI 记录|判不了|读不懂|组里还有/, c.stderr);
    const status = JSON.parse(await fs.readFile(path.join(r.js.run_dir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(status.phase, 'cancelled');
    assert.equal((await readRunJson(r.fx.stageDir, r.js.run_id)).status, 'cancelled', 'worker 已确认不在，EV-128 收尾照走');
    assert.deepEqual(await sidesCliOf(r.js.run_dir), { gemini: null, glm: null }, '已确认结束的记录清成 null（计划双审 r1 AGY-02）');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-154 I4：worker 的事件循环被堵住 ⇒ --cancel 升级 SIGKILL，随后按记录结束两侧 CLI', { skip: bundleMissing && bundleSkipReason }, async () => {
  // 桩先等两侧记录（含启动时刻）都落盘、再过 300 ms 才堵住，不与补写赛跑（计划双审 r1 CODEX-04、代码双审 r1 CODEX-03）
  const r = await startWithRecordedClis({ gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } });
  try {
    assert.equal(r.groups.length, 2, '桩 CLI 没起来，用例前提不成立');
    for (const [side, v] of Object.entries(r.rec)) {
      assert.ok(v?.started_at, `${side} 侧的启动时刻没记下：块先于补写落地（f′ 格），用例前提不成立`);
    }
    await new Promise((res) => setTimeout(res, 1000)); // 等块生效（记录落盘后 300 ms 堵住）
    const t0 = Date.now();
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    const ms = Date.now() - t0;
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.match(c.stderr, /未响应 SIGTERM/, '升级确实发生（堵住的 worker 跑不到处理器）');
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    assert.equal((c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, 2, c.stderr);
    // 计时只防挂住：宽限 5 s + CLI 宽限链 3 s + 余量
    const bound = WORKER_TERM_GRACE_MS + WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 3000;
    assert.ok(ms < bound, `--cancel 耗时 ${ms} ms，上界 ${bound}`);
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

test('EV-154 I5：worker 被强杀后 --wait 先判失联（不结束进程），之后 --cancel 在终态早退分支里按记录结束 CLI、不改 status.json', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis({ gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } });
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '20'], null, 60_000);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    assert.match(w.stderr, /失联/);
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `--wait 不结束进程（用户决策 5）：组 ${g} 应仍活着`);

    const sp = path.join(r.js.run_dir, 'status.json');
    const before = await fs.readFile(sp, 'utf8');
    assert.equal((JSON.parse(before) as { phase: string }).phase, 'failed');
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /已处于终态（failed），无需取消/);
    assert.equal((c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, 2, c.stderr);
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    assert.equal(await fs.readFile(sp, 'utf8'), before, '终态早退分支不写 status.json（不追溯改写）');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-154 I6：worker 已死而 CLI 还活着 ⇒ 会话启动清扫不结束进程、也不抹凭据副本（EV-38）；CLI 结束后再清扫即抹', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis({ gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } });
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    const carrier = path.join(r.js.run_dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
    await fs.mkdir(path.dirname(carrier), { recursive: true });
    await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');

    const h1 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h1.code, 0, `${h1.stdout}${h1.stderr}`);
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `会话启动清扫不结束进程（用户决策 5）：组 ${g} 应仍活着`);
    await fs.access(carrier); // CLI 还活着：不抹

    for (const g of r.groups) killGroup(g);
    for (let i = 0; i < 40 && r.groups.some((g) => groupMemberCount(g) > 0); i++) await new Promise((res) => setTimeout(res, 50));
    const h2 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h2.code, 0, `${h2.stdout}${h2.stderr}`);
    await assert.rejects(fs.access(carrier), 'CLI 结束之后清扫放行');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-154 I7：CLI 自然结束 ⇒ status.json 里该侧的记录清成 null', { skip: bundleMissing && bundleSkipReason }, async () => {
  const stub: StubConfig = { gemini: { mode: 'hang_cli', sleepS: 1 }, glm: { mode: 'hang_cli', sleepS: 1 } };
  const fx = await makeFixture({ topic: TOPIC });
  const started = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string; run_dir: string };
  try {
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) {
      seen = Object.values(await sidesCliOf(js.run_dir).catch(() => ({}))).some((v) => v && v.pgid);
      if (!seen) await new Promise((res) => setTimeout(res, 50));
    }
    assert.ok(seen, '运行中应能看到记录（用例前提）');
    await waitUntilDone(fx.root, js.run_id, stub);
    assert.deepEqual(await sidesCliOf(js.run_dir), { gemini: null, glm: null });
  } finally {
    for (const g of groupsWithMark(`trivium-stub-cli:${js.run_dir}`)) killGroup(g);
  }
});

/*
 * ── EV-146：--wait 判 heartbeat_stale 之后 --cancel 结束仍挂着的 worker（失联后取消挂住的worker计划 r2 §5.2 J1～J3）──
 *
 * `heartbeat_stale_s: 2` 而 worker 心跳 30 s 一次：记录落盘之后 2 s 不写即判失联。J1 / J3 让 gemini 侧 `blockAfterMs`
 * 把 worker 的事件循环堵住（SIGTERM 处理器跑不到）；J2 不堵，是「心跳只是慢」那一格（计划 r2 §2 P1）。
 */

const STALE_2S = ['heartbeat_stale_s: 2'];

/** 起两侧 hang_cli、等记录落盘、等心跳过期，跑 --wait 判 heartbeat_stale；返回判失联之后的现场 */
async function lostHungRun(stub: StubConfig) {
  const r = await startWithRecordedClis(stub, STALE_2S);
  assertRecorded(r);
  await new Promise((res) => setTimeout(res, 3000)); // 记录落盘后 300 ms 堵住（J1 / J3）；3 s 足以越过 2 s 阈值
  const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '10'], null, 60_000);
  return { ...r, w, wOut: w.stdout + w.stderr };
}

const taskRunStatus = async (archiveRoot: string, runId: string) =>
  (JSON.parse(await fs.readFile(path.join(archiveRoot, TOPIC, 'task.json'), 'utf8')) as {
    runs: { run_id: string; status: string }[];
  }).runs.find((x) => x.run_id === runId)?.status;

const lockPathOf = (root: string) => path.join(root, '.trivium', 'lock', `${TOPIC}.lock`);

test('EV-146 J1：worker 事件循环被堵住、--wait 判 heartbeat_stale ⇒ --cancel 升级 SIGKILL 结束它、按记录结束两侧 CLI、补收 run.json 与登记、回收锁；status.json 与闸门不动，之后能重新起跑', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await lostHungRun({ gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } });
  let restarted: { run_id: string; run_dir: string } | null = null;
  try {
    // 前提：判的是心跳过期、worker 与两组都还活着、锁挂在它名下（EV-146 原文的死路）
    assert.equal(r.w.code, EXIT.FAIL, r.wOut);
    assert.match(r.wOut, /worker_lost|失联（heartbeat_stale）/, r.wOut);
    assert.match(r.wOut, /判定依据：工作进程 \d+ 仍在.*——阈值不大于心跳间隔：健康的工作进程也会被判失联/, r.wOut);
    assert.match(r.wOut, new RegExp(`trivium review --cancel ${r.js.run_id}`), r.wOut);
    assert.ok(!pidGone(r.js.worker_pid), 'heartbeat_stale 时 worker 应仍活着（用例前提）');
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `组 ${g} 应仍活着（用例前提）`);
    const blocked = await cli(r.fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'], STUB);
    assert.equal(blocked.code, EXIT.LOCKED, `锁被挂住的 worker 持着，新 --start 退 70（用例前提）：${blocked.stdout}${blocked.stderr}`);

    const sp = path.join(r.js.run_dir, 'status.json');
    const statusBefore = await fs.readFile(sp, 'utf8');
    assert.equal((JSON.parse(statusBefore) as { lost?: { reason?: string } }).lost?.reason, 'heartbeat_stale');
    const gateBefore = (await gatesOf(r.fx.root))[`${TOPIC}/plan`];

    const t0 = Date.now();
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    const ms = Date.now() - t0;
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.match(c.stderr, /未响应 SIGTERM/, '升级确实发生（堵住的 worker 跑不到处理器）');
    assert.match(c.stderr, /工作进程组 \d+ 已结束（SIGTERM、SIGKILL）/, c.stderr);
    assert.equal((c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, 2, c.stderr);
    assert.match(c.stdout, /已结束仍挂着的工作进程 \d+/, c.stdout);
    assert.ok(pidGone(r.js.worker_pid), 'worker 应已不在');
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    const meta = await readRunJson(r.fx.stageDir, r.js.run_id);
    assert.equal(meta.status, 'failed');
    assert.deepEqual(meta.termination, { by: 'worker_lost', reason: 'heartbeat_stale' });
    assert.equal(await taskRunStatus(r.fx.archiveRoot, r.js.run_id), 'failed');
    await assert.rejects(fs.access(lockPathOf(r.fx.root)), '锁应已回收');
    assert.equal(await fs.readFile(sp, 'utf8'), statusBefore, 'status.json 一个字节都不写');
    assert.deepEqual((await gatesOf(r.fx.root))[`${TOPIC}/plan`], gateBefore, '闸门不动');
    /*
     * 计时只防挂死（计划双审 r1 CODEX-03、代码双审 r1 CODEX-04）：主判据是上面的信号序列、组成员数与 run.json 三格。
     * 常量之和约 13 s（宽限 + SIGKILL 后确认 + CLI 宽限链），但每轮轮询都要起 ps、单次 ps 上限 10 s，满载下不是常量之和；
     * 上界取 60 s，只拦「挂住不返回」。实测耗时见实施报告
     */
    const hangBound = 60_000;
    assert.ok(ms < hangBound, `--cancel 耗时 ${ms} ms，超过防挂死上界 ${hangBound}（常量之和 ${WORKER_TERM_GRACE_MS + ORPHAN_KILL_CONFIRM_MS + WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS} ms）`);

    // 死路解开：同阶段能重新起跑
    const again = await cli(r.fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'], STUB);
    assert.equal(again.code, EXIT.OK, `${again.stdout}${again.stderr}`);
    restarted = JSON.parse(extractJsonCandidate(again.stdout)!.json) as { run_id: string; run_dir: string };
    await waitUntilDone(r.fx.root, restarted.run_id, STUB);
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

test('EV-146 J2：心跳只是慢（事件循环没堵住）也被判 heartbeat_stale ⇒ --cancel 不升级，worker 的处理器自己收拾 CLI 并退出；输出如实说「可能只是心跳慢」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await lostHungRun({ gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } });
  try {
    assert.equal(r.w.code, EXIT.FAIL, r.wOut);
    assert.match(r.wOut, /heartbeat_stale/, `前提：健康的 worker 也被判心跳过期（计划 r2 §2 P1）：${r.wOut}`);
    assert.ok(!pidGone(r.js.worker_pid), '用例前提：worker 活着');
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.doesNotMatch(c.stderr, /未响应 SIGTERM/, '事件循环没堵住：宽限内自己退出，不升级');
    assert.match(c.stderr, /工作进程在宽限内响应 SIGTERM 退出（SIGTERM）——它的事件循环没有被堵住，失联判定可能只是心跳慢/, c.stderr);
    const workerLog = await fs.readFile(path.join(r.js.run_dir, 'worker.log'), 'utf8').catch(() => '');
    assert.match(workerLog, /收到 SIGTERM：已按组终止审查员 CLI/, '处理器自己收拾 CLI 的因果证据');
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}\n${workerLog}`);
    const meta = await readRunJson(r.fx.stageDir, r.js.run_id);
    assert.equal(meta.status, 'failed');
    assert.deepEqual(meta.termination, { by: 'worker_lost', reason: 'heartbeat_stale' });
    await assert.rejects(fs.access(lockPathOf(r.fx.root)), '锁应已回收');
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

test('EV-146 J3：本格不抹凭据副本（用户决策 7）——--wait 与 --cancel 之后载体仍在；worker 与 CLI 都结束之后，会话启动清扫放行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis({ gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } }, STALE_2S);
  try {
    assertRecorded(r);
    const carrier = path.join(r.js.run_dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
    await fs.mkdir(path.dirname(carrier), { recursive: true });
    await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
    await new Promise((res) => setTimeout(res, 3000));
    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '10'], null, 60_000);
    assert.match(w.stdout + w.stderr, /heartbeat_stale/, `前提：${w.stdout}${w.stderr}`);
    await fs.access(carrier); // --wait：worker 仍在，不抹（既有行为）

    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.ok(pidGone(r.js.worker_pid), '前提：worker 已被本格结束');
    await fs.access(carrier); // 本格不抹，留给会话启动清扫

    const h = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h.code, 0, `${h.stdout}${h.stderr}`);
    await assert.rejects(fs.access(carrier), 'worker 与 CLI 都已不在，admitScrub 放行');
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

/*
 * ── EV-159：失联worker退出后补收（失联worker退出后补收计划 r2 §4.2 G1～G2）──
 *
 * 复用 J1 的 heartbeat_stale 现场，但不经 --cancel 结束 worker——直接按组 SIGKILL（模拟终端手工结束），
 * 两侧 CLI 组因此真的成为孤儿（手工结束不经 EV-152 的 SIGTERM 转发链）；随后跑 --cancel，落 gone 格。
 */

test('EV-159 G1：worker 被手工结束（未经 --cancel）⇒ --cancel 落 gone 格：按记录结束两侧 CLI、补收 run.json 与登记、回收锁；CLI 结束先于归档补收播报', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await lostHungRun({ gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } });
  try {
    assert.equal(r.w.code, EXIT.FAIL, r.wOut);
    assert.match(r.wOut, /worker_lost|失联（heartbeat_stale）/, r.wOut);
    assert.ok(!pidGone(r.js.worker_pid), 'heartbeat_stale 时 worker 应仍活着（用例前提）');
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `组 ${g} 应仍活着（用例前提）`);

    process.kill(-r.js.worker_pid, 'SIGKILL');
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(pidGone(r.js.worker_pid), '前提：worker 已被手工结束');
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `组 ${g} 应仍是孤儿、还活着（手工结束够不到 CLI，用例前提）`);

    const sp = path.join(r.js.run_dir, 'status.json');
    const statusBefore = await fs.readFile(sp, 'utf8');
    const gateBefore = (await gatesOf(r.fx.root))[`${TOPIC}/plan`];

    const t0 = Date.now();
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    const ms = Date.now() - t0;
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    const merged = c.stdout + c.stderr;
    assert.equal((merged.match(/按记录结束审查员 CLI/g) ?? []).length, 2, merged);
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${merged}`);
    const meta = await readRunJson(r.fx.stageDir, r.js.run_id);
    assert.equal(meta.status, 'failed');
    assert.deepEqual(meta.termination, { by: 'worker_lost', reason: 'heartbeat_stale' });
    assert.equal(await taskRunStatus(r.fx.archiveRoot, r.js.run_id), 'failed');
    await assert.rejects(fs.access(lockPathOf(r.fx.root)), '锁应已回收');
    assert.equal(await fs.readFile(sp, 'utf8'), statusBefore, 'status.json 一个字节都不写');
    assert.deepEqual((await gatesOf(r.fx.root))[`${TOPIC}/plan`], gateBefore, '闸门不动');
    assert.doesNotMatch(c.stdout, /无需取消/, c.stdout);
    assert.match(c.stdout, /工作进程 \d+ 已不在。/, c.stdout);

    // 顺序断言（计划双审 r1 CODEX-03 ≡ GLM-04）：CLI 结束先于归档补收，防 finalizeGoneWorker 被误挪到 CLI 结束块之前
    const cliIdx = merged.indexOf('按记录结束审查员 CLI');
    const archiveIdx = merged.indexOf(`已把归档里的 run-${r.js.run_id}.json 收尾为 failed`);
    assert.ok(cliIdx >= 0 && archiveIdx >= 0 && cliIdx < archiveIdx, `CLI 结束应先于归档补收播报：\n${merged}`);

    // 计时只防挂死：本格不走 SIGTERM 宽限链（worker 已死），只有 CLI 宽限链 + 归档写入
    const hangBound = 30_000;
    assert.ok(ms < hangBound, `--cancel 耗时 ${ms} ms，超过防挂死上界 ${hangBound}`);
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

test('EV-159 G2：G1 场景上 --cancel 之后再跑一次 ⇒ 幂等，run.json / task.json / status.json 均逐字节不变，输出不再说「已把归档……收尾为 failed」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await lostHungRun({ gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } });
  try {
    process.kill(-r.js.worker_pid, 'SIGKILL');
    await new Promise((res) => setTimeout(res, 300));
    const first = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(first.code, EXIT.OK, `${first.stdout}${first.stderr}`);

    const sp = path.join(r.js.run_dir, 'status.json');
    const runJsonPath = path.join(r.fx.stageDir, '_meta', `run-${r.js.run_id}.json`);
    const [statusAfter, runAfter, taskAfter] = await Promise.all([
      fs.readFile(sp, 'utf8'),
      fs.readFile(runJsonPath, 'utf8'),
      fs.readFile(path.join(r.fx.archiveRoot, TOPIC, 'task.json'), 'utf8'),
    ]);

    const second = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(second.code, EXIT.OK, `${second.stdout}${second.stderr}`);
    const merged2 = second.stdout + second.stderr;
    assert.doesNotMatch(merged2, /已把归档里的 run-.+\.json 收尾为 failed/, merged2);
    assert.match(merged2, /已是终态（failed），不追溯改写/, merged2);
    assert.doesNotMatch(merged2, /无需取消/, merged2);

    assert.equal(await fs.readFile(sp, 'utf8'), statusAfter, 'status.json 逐字节不变');
    assert.equal(await fs.readFile(runJsonPath, 'utf8'), runAfter, 'run.json 逐字节不变');
    assert.equal(await fs.readFile(path.join(r.fx.archiveRoot, TOPIC, 'task.json'), 'utf8'), taskAfter, 'task.json 逐字节不变');
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

/*
 * ── EV-158：写者与读者的 TZ / 区域设置不同（worker启动时刻规范化计划 r2 §5.2 I1～I7）──
 *
 * `--start` 在 W 下跑、被测读者在 R 下跑（`test/helpers/start-env.ts`）；每格先对 worker pid 做 P0（两个环境的缺省形态
 * 确实不同、且都不等于规范化形态，计划双审 r1 CODEX-02）。两侧都是 hang_cli：worker 与 CLI 一直活着，读者误判就会动手。
 */

const HANG2: StubConfig = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };

/** 以 Hook 身份在给定环境里调用 */
async function hookIn(root: string, name: string, input: unknown, extraEnv: Record<string, string | undefined>) {
  const { run } = await import('../../src/trivium/util/exec.js');
  const { BUNDLE, ASSET_ROOT } = await import('../helpers/fixture.js');
  return run(process.execPath, [BUNDLE, 'gate', name], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, CLAUDE_SESSION_ID: SESSION, TRIVIUM_STUB_CRITIC: undefined, ...extraEnv },
    stdin: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}

test('EV-158 I1～I5：--start 在 W 下写两种启动时刻；R 下的 --wait、会话启动清扫、trivium scrub、同阶段 --start 都认得活 worker，R 下的 --cancel 对它发 SIGTERM 并收尾', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2, undefined, ENV_W);
  try {
    assertRecorded(r);
    const wpid = r.js.worker_pid;
    const forms = await assertEnvPairDistinct(wpid);

    // I1：写者——两种形态同指 worker；缺省形态的取法没变（W 下）
    const status = JSON.parse(await fs.readFile(path.join(r.js.run_dir, 'status.json'), 'utf8')) as Record<string, unknown>;
    const lockBefore = await fs.readFile(lockPathOf(r.fx.root), 'utf8');
    const lock = JSON.parse(lockBefore) as Record<string, unknown>;
    assert.equal(status['worker_started_at_canonical'], forms.canonical, 'status.json 的规范化启动时刻应是 worker 的');
    assert.equal(status['worker_started_at'], forms.w, '缺省字段仍按 --start 的环境取');
    assert.equal(lock['pid'], wpid);
    assert.equal(lock['pid_started_at_canonical'], forms.canonical, '锁的规范化启动时刻应是 worker 的');
    assert.equal(lock['pid_started_at'], forms.w);

    // I2（C1）：R 下 --wait ⇒ 仍在跑，不判失联
    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '3'], null, 60_000, ENV_R);
    assert.equal(w.code, EXIT.STILL_RUNNING, `b 格：R 下 --wait 不应判失联：${w.stdout}${w.stderr}`);
    assert.equal((JSON.parse(await fs.readFile(path.join(r.js.run_dir, 'status.json'), 'utf8')) as { phase: string }).phase, 'running');
    assert.equal((await readRunJson(r.fx.stageDir, r.js.run_id)).status, 'running', 'run.json 不被写成 failed');

    // I3（C2 / C3）：R 下会话启动清扫与 trivium scrub ⇒ 副本不抹、计 alive、闸门不回收
    const carrier = path.join(r.js.run_dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
    await fs.mkdir(path.dirname(carrier), { recursive: true });
    await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
    const h = await hookIn(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' }, ENV_R);
    assert.equal(h.code, EXIT.OK, `${h.stdout}${h.stderr}`);
    assert.doesNotMatch(h.stdout, /已回收/, h.stdout);
    await fs.access(carrier);
    const sc = await cli(r.fx.root, ['scrub', '--json'], null, 60_000, ENV_R);
    assert.equal(sc.code, EXIT.OK, `${sc.stdout}${sc.stderr}`);
    const scj = JSON.parse(extractJsonCandidate(sc.stdout)!.json) as { alive: number; scrubbed: string[]; eligible: string[] };
    assert.equal(scj.alive, 1, `b 格：跨仓清扫应把它计为进行中：${sc.stdout}`);
    assert.deepEqual(scj.scrubbed, []);
    await fs.access(carrier);
    assert.equal((await gatesOf(r.fx.root))[`${TOPIC}/plan`]?.state, 'running', '闸门不被当遗留回收');

    // I4（C4）：R 下同阶段再 --start ⇒ 退 70，锁逐字节不变
    const again = await cli(r.fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'], STUB, 120_000, ENV_R);
    assert.equal(again.code, EXIT.LOCKED, `b 格：R 下的 --start 不应回收活 worker 的锁：${again.stdout}${again.stderr}`);
    assert.equal(await fs.readFile(lockPathOf(r.fx.root), 'utf8'), lockBefore);

    // I5（C5 / C6）：R 下 --cancel ⇒ 向活 worker 发 SIGTERM，worker 与两组都结束，收尾 cancelled
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id], null, 120_000, ENV_R);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.match(c.stderr, new RegExp(`向工作进程组 ${wpid} 发送 SIGTERM`), c.stderr);
    assert.doesNotMatch(c.stderr, /已不存在，仅做状态与锁的清理/, c.stderr);
    for (let i = 0; i < 40 && !pidGone(wpid); i++) await new Promise((res) => setTimeout(res, 50));
    assert.ok(pidGone(wpid), 'worker 应已结束');
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    assert.equal((JSON.parse(await fs.readFile(path.join(r.js.run_dir, 'status.json'), 'utf8')) as { phase: string }).phase, 'cancelled');
    assert.equal((await readRunJson(r.fx.stageDir, r.js.run_id)).status, 'cancelled');
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

test('EV-158 I6（C7 / C8）：--wait 在 W 下判 heartbeat_stale，--cancel 在 R 下 ⇒ 入失联后取消那一格（不再判 mismatch），结束 worker 与两侧 CLI、补收 run.json 为 failed', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis({ gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } }, STALE_2S, ENV_W);
  try {
    assertRecorded(r);
    await assertEnvPairDistinct(r.js.worker_pid);
    await new Promise((res) => setTimeout(res, 3000));
    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '10'], null, 60_000, ENV_W);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    assert.match(w.stdout + w.stderr, /heartbeat_stale/, '前提：判的是心跳过期');

    const t0 = Date.now();
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id], null, 120_000, ENV_R);
    const ms = Date.now() - t0;
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.doesNotMatch(c.stderr, /启动时刻与 status\.json 的(规范化)?记录不符/, `b 格：R 下不应判 mismatch：${c.stderr}`);
    assert.match(c.stdout, /已结束仍挂着的工作进程 \d+/, c.stdout);
    assert.ok(pidGone(r.js.worker_pid), 'worker 应已不在');
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    const meta = await readRunJson(r.fx.stageDir, r.js.run_id);
    assert.equal(meta.status, 'failed');
    assert.deepEqual(meta.termination, { by: 'worker_lost', reason: 'heartbeat_stale' });
    assert.ok(ms < 60_000, `--cancel 耗时 ${ms} ms，超过防挂死上界（同 EV-146 J1）`);
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

test('EV-158 I7（d 格回归）：删掉 status.json 里的规范化字段（模拟旧版写下；--wait 不读锁）⇒ R 下 --wait 仍判失联 pid_gone，与今天相同', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2, undefined, ENV_W);
  try {
    assertRecorded(r);
    await assertEnvPairDistinct(r.js.worker_pid);
    const sp = path.join(r.js.run_dir, 'status.json');
    // worker 的读改写可能与本次改写交错：改完回读确认键已不在
    for (let i = 0; i < 5; i++) {
      const s = JSON.parse(await fs.readFile(sp, 'utf8')) as Record<string, unknown>;
      delete s['worker_started_at_canonical'];
      await fs.writeFile(sp, JSON.stringify(s, null, 2) + '\n', 'utf8');
      await new Promise((res) => setTimeout(res, 100));
      if (!('worker_started_at_canonical' in (JSON.parse(await fs.readFile(sp, 'utf8')) as object))) break;
    }
    assert.ok(!('worker_started_at_canonical' in (JSON.parse(await fs.readFile(sp, 'utf8')) as object)), '前提：新字段已删');
    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '3'], null, 60_000, ENV_R);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    assert.match(w.stdout + w.stderr, /失联（pid_gone）/, 'd 格：旧记录在异环境下仍判失联（EV-158 的残余，升级窗口）');
    // 同一份旧记录在 W 下就判得对：只是按缺省环境比较
    assert.equal(
      await withEnv(ENV_W, () => processStartTime(r.js.worker_pid)),
      (JSON.parse(await fs.readFile(sp, 'utf8')) as { worker_started_at: string }).worker_started_at,
    );
  } finally {
    try {
      process.kill(-r.js.worker_pid, 'SIGKILL');
    } catch {
      /* 已不在 */
    }
    cleanupGroups(r);
  }
});

/*
 * ── EV-157：--cancel 与 --wait 判失联自己的凭据准入核审查员 CLI（取消与失联的凭据准入核CLI计划 r2 §4.2 K1～K4）──
 *
 * 两侧 hang_cli，按组 SIGKILL worker（它的 SIGTERM 处理器跑不到，两组 CLI 过继给 init 继续活着），glm 侧放一份 zcode 载体。
 * 「留给会话启动清扫」的交接载荷是 status.json 里被挡侧的 cli 记录（计划双审 r1 GLM-03）：结束两组之前先跑一次会话启动
 * Hook、断言载体仍在，再结束两组验放行——记录若被过早清掉，第一次 Hook 就会把载体抹掉。
 */

async function plantCarrier(runDir: string): Promise<string> {
  const carrier = path.join(runDir, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  return carrier;
}

const carrierExists = (p: string) => fs.access(p).then(() => true, () => false);

async function endGroupsAndWait(groups: number[]): Promise<void> {
  for (const g of groups) killGroup(g);
  for (let i = 0; i < 40 && groups.some((g) => groupMemberCount(g) > 0); i++) await new Promise((res) => setTimeout(res, 50));
  assert.deepEqual(groups.map((g) => groupMemberCount(g)), [0, 0], '两组应已结束（用例前提）');
}

/**
 * 等 `pgid` 组内派生出子进程（`hang_cli` 的 `sh` 组长 fork `sleep` 需要一点时间）——杀组长之前必须等到，否则组长
 * 还没来得及 fork 子进程就被 SIGKILL 会把整个组一起端掉，之后等「成员数变为非零」的循环毫无意义只会白等到超时
 * （代码双审 r1 AGY-01 核出：`killLeaderOnly` 调用前缺这一步，与 `test/unit/scrub-admission.test.ts` 的
 * `orphanedGroup` 已经修过的同一形态竞态不一致）。
 */
async function untilTwoMembers(pgid: number): Promise<void> {
  for (let i = 0; i < 100 && groupMemberCount(pgid) < 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(groupMemberCount(pgid), 2, `组 ${pgid} 派生子进程后应有两个成员（用例前提）`);
}

/**
 * 单 pid（非组）SIGKILL 组长，制造「组长已退、组员仍在」（EV-165 K5/K6）——只杀 `pgid` 这一个进程，不带负号；
 * `hang_cli` 桩以 `sh`（组长）+ `sleep`（子进程，同组）两层构造，杀掉 `sh` 不影响 `sleep`。
 *
 * **前提是 worker 已经不在**（计划双审 r1 CODEX-01≡CODEX-02≡AGY-02≡GLM-03）：worker 存活时，它跟踪的直接子进程
 * （这里的 `sh`）一退出就会触发 `liveTrees` 的 `'exit'` 监听、把该侧记录清成 null——组员是否存活与此无关，worker 完全
 * 不知道孙辈的存在。所以本函数只能在 `killWorker` 之后调用，让记录原样留在 status.json 上。
 */
async function killLeaderOnly(pgid: number): Promise<void> {
  try {
    process.kill(pgid, 'SIGKILL');
  } catch {
    /* 已不在 */
  }
  for (let i = 0; i < 100 && !pidGone(pgid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(pidGone(pgid), `组长 ${pgid} 应已不在（用例前提）`);
}

test('EV-157 K1：worker 已死而两侧 CLI 仍活 ⇒ --wait 判失联不抹、正文逐侧带组号、不结束进程、记录留存；会话启动清扫同样挡住；CLI 结束后清扫即抹', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    const carrier = await plantCarrier(r.js.run_dir);

    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '20'], null, 60_000);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    const out = w.stdout + w.stderr;
    assert.match(out, /失联（pid_gone）/);
    const line = out.split('\n').find((l) => l.includes('凭据副本未抹')) ?? '';
    assert.match(line, new RegExp(`工作进程 ${r.js.worker_pid} 已不存在，但审查员 CLI 未确认结束——`), out);
    for (const [side, v] of Object.entries(r.rec)) {
      assert.ok(line.includes(`${side} 侧审查员 CLI 进程组 ${v!.pgid} 仍在`), `${side} 侧要带组号\n${out}`);
    }
    assert.match(line, /（pid_gone），留给会话启动清扫$/, out);
    assert.match(out, new RegExp(`其中仍在的审查员 CLI 可用 trivium review --cancel ${r.js.run_id} 按记录结束`), '给出 --cancel 出口（代码双审 r1 CODEX-02）');
    assert.ok(await carrierExists(carrier), 'CLI 仍活：副本不抹');
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `--wait 不结束进程：组 ${g} 应仍活着`);
    assert.deepEqual(await sidesCliOf(r.js.run_dir), r.rec, '被挡侧记录原样留存（GLM-03）');

    const h1 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h1.code, 0, `${h1.stdout}${h1.stderr}`);
    assert.ok(await carrierExists(carrier), '会话启动清扫据留存的记录同样挡住');

    await endGroupsAndWait(r.groups);
    const h2 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h2.code, 0, `${h2.stdout}${h2.stderr}`);
    assert.ok(!(await carrierExists(carrier)), 'CLI 结束之后清扫放行');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-157 K2：worker 与两侧 CLI 都已结束 ⇒ --wait 判失联照抹，正文没有「凭据副本未抹」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    await endGroupsAndWait(r.groups);
    const carrier = await plantCarrier(r.js.run_dir);
    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '20'], null, 60_000);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    assert.doesNotMatch(w.stdout + w.stderr, /凭据副本未抹/);
    assert.ok(!(await carrierExists(carrier)), 'CLI 已结束：照抹');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-157 K3：worker 已死、两侧记录判不了（启动时刻没记下）⇒ --cancel 不发信号也不抹、一行告警逐侧列出、记录留存、归档照收尾；会话启动清扫同样挡住；CLI 结束后即抹', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    // worker 已死，没有并发写者：把两侧记录的启动时刻抹成 null（C 格）
    const sp = path.join(r.js.run_dir, 'status.json');
    const s = JSON.parse(await fs.readFile(sp, 'utf8')) as { sides: Record<string, { cli?: { started_at: string | null } }> };
    for (const v of Object.values(s.sides)) v.cli!.started_at = null;
    await fs.writeFile(sp, JSON.stringify(s, null, 2) + '\n', 'utf8');
    const recC = await sidesCliOf(r.js.run_dir);
    const carrier = await plantCarrier(r.js.run_dir);

    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.equal((c.stderr.match(/判不了是不是同一进程，不发信号/g) ?? []).length, 2, c.stderr);
    const lines = c.stderr.split('\n').filter((l) => l.includes('凭据副本未抹'));
    assert.equal(lines.length, 1, c.stderr);
    for (const [side, v] of Object.entries(recC)) {
      assert.ok(lines[0]!.includes(`${side} 侧审查员 CLI 进程组 ${v!.pgid} 仍有活进程、启动时刻没记下：判不了`), c.stderr);
    }
    assert.match(lines[0]!, /——留给会话启动清扫$/);
    assert.ok(await carrierExists(carrier), '判不了：副本不抹');
    for (const g of r.groups) assert.equal(groupMemberCount(g), 2, `判不了的组不发信号：组 ${g} 应仍活着`);
    assert.equal((await readRunJson(r.fx.stageDir, r.js.run_id)).status, 'cancelled', '归档收尾只看 worker 一半（D5）');
    assert.deepEqual(await sidesCliOf(r.js.run_dir), recC, '被挡侧记录原样留存（GLM-03）');

    const h1 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h1.code, 0, `${h1.stdout}${h1.stderr}`);
    assert.ok(await carrierExists(carrier), '会话启动清扫据留存的记录同样挡住');

    await endGroupsAndWait(r.groups);
    const h2 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h2.code, 0, `${h2.stdout}${h2.stderr}`);
    assert.ok(!(await carrierExists(carrier)), 'CLI 结束之后清扫放行');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-157 K4：worker 已死、两侧 CLI 仍活 ⇒ --cancel 按记录结束两组之后照抹，没有「凭据副本未抹」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    const carrier = await plantCarrier(r.js.run_dir);
    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.equal((c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, 2, c.stderr);
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(r.groups.map((g) => groupMemberCount(g)), [0, 0], `两组都应已空：\n${c.stderr}`);
    assert.doesNotMatch(c.stderr, /凭据副本未抹/, '准入判的是按记录结束之后的事实');
    assert.ok(!(await carrierExists(carrier)), '照抹');
  } finally {
    cleanupGroups(r);
  }
});

/*
 * ── EV-165：组长已退组员仍在的准入（组长已退组员仍在的准入计划 r2 §3.2 K5/K6）──
 *
 * 前提沿用 K1～K4 的夹具，额外在 worker 已死之后对 glm 侧单 pid SIGKILL 组长（`gemini` 侧组长保持存活作对照）：
 * 记录原样留在 status.json 上（组长已死这一刻 worker 已经不在，不会有观察者把它清成 null），组号下的 `sleep`
 * 仍然存活——这正是 `judgeCliGroup` 新增的 `orphaned` 阻挡态。
 */

test('EV-165 K5：worker 已死、glm 侧组长已退但组员仍在（gemini 侧组长仍活）⇒ --wait 判失联两侧都不抹、glm 侧正文带精确成员数、都不结束进程；会话启动清扫同样挡住；组员结束后清扫即抹', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    const carrier = await plantCarrier(r.js.run_dir);
    const glmPgid = r.rec.glm!.pgid;
    const gemPgid = r.rec.gemini!.pgid;

    await untilTwoMembers(glmPgid);
    await killLeaderOnly(glmPgid);
    const n = groupMemberCount(glmPgid);
    assert.ok(n > 0, `glm 侧组 ${glmPgid} 应仍有非僵尸成员（用例前提）：${n}`);
    assert.equal(groupMemberCount(gemPgid), 2, 'gemini 侧组长应仍活着（对照，用例前提）');

    const w = await cli(r.fx.root, ['review', '--wait', r.js.run_id, '--timeout', '20'], null, 60_000);
    assert.equal(w.code, EXIT.FAIL, `${w.stdout}${w.stderr}`);
    const out = w.stdout + w.stderr;
    assert.match(out, /失联（pid_gone）/);
    const line = out.split('\n').find((l) => l.includes('凭据副本未抹')) ?? '';
    assert.ok(
      line.includes(`glm 侧审查员 CLI 进程组 ${glmPgid} 的组长已退出，组里还有 ${n} 个成员`),
      `glm 侧要带「组长已退出」与精确成员数\n${out}`,
    );
    assert.ok(line.includes(`gemini 侧审查员 CLI 进程组 ${gemPgid} 仍在`), `gemini 侧仍走既有 alive 文案\n${out}`);
    assert.match(
      out,
      new RegExp(`其中仍在的审查员 CLI 可用 trivium review --cancel ${r.js.run_id} 按记录结束`),
      '出口提示对 alive 与 orphaned 都成立',
    );
    assert.ok(await carrierExists(carrier), 'CLI 仍在（含 orphaned）：副本不抹');
    assert.equal(groupMemberCount(gemPgid), 2, '--wait 不结束进程：gemini 侧组长应仍活着');
    assert.ok(groupMemberCount(glmPgid) > 0, '--wait 不结束进程：glm 侧组员应仍活着');

    const h1 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h1.code, 0, `${h1.stdout}${h1.stderr}`);
    assert.ok(await carrierExists(carrier), '会话启动清扫据 orphaned 记录同样挡住');

    await endGroupsAndWait([glmPgid, gemPgid]);
    const h2 = await hook(r.fx.root, 'hook-session-start', { hook_event_name: 'SessionStart' });
    assert.equal(h2.code, 0, `${h2.stdout}${h2.stderr}`);
    assert.ok(!(await carrierExists(carrier)), '组员结束之后清扫放行');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-165 K6：worker 已死、glm 侧组长已退但组员仍在 ⇒ --cancel 按组结束组员（组信号打到 pgid 仍有效）之后照抹；gemini 侧走既有 alive 路径不受影响', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG2);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    const carrier = await plantCarrier(r.js.run_dir);
    const glmPgid = r.rec.glm!.pgid;
    const gemPgid = r.rec.gemini!.pgid;

    await untilTwoMembers(glmPgid);
    await killLeaderOnly(glmPgid);
    assert.ok(groupMemberCount(glmPgid) > 0, `glm 侧组 ${glmPgid} 应仍有非僵尸成员（用例前提）`);

    const c = await cli(r.fx.root, ['review', '--cancel', r.js.run_id]);
    assert.equal(c.code, EXIT.OK, `${c.stdout}${c.stderr}`);
    assert.equal((c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, 2, `两侧都应按记录结束（alive 与 orphaned 都发信号）：\n${c.stderr}`);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(groupMemberCount(glmPgid), 0, 'glm 侧组员应已被组信号结束（组号仍有效，打到了 sleep 头上）');
    assert.equal(groupMemberCount(gemPgid), 0, 'gemini 侧（既有 alive 路径）应已结束');
    assert.doesNotMatch(c.stderr, /凭据副本未抹/, '两侧都已结束：照抹');
    assert.ok(!(await carrierExists(carrier)), '照抹');
    assert.deepEqual(await sidesCliOf(r.js.run_dir), { gemini: null, glm: null }, 'settledCliSides：两侧记录都应清成 null');
  } finally {
    cleanupGroups(r);
  }
});

/*
 * ── EV-151：回收遗留锁时给上一轮收尾（候选 A 并含同步路径扩展）──
 *
 * 改前：工作进程被强杀（或同步 review 被强杀）之后再起一轮，`acquireLock` 只回收锁、告警一行，旧运行的 run.json 与登记一直停在 running。
 * 进程内各格见 `reclaimed-lock-settle.test.ts`；这里经真实 bundle 各走一遍两条取锁路径。
 */

const HANG_CLI: StubConfig = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };
const settleLine = (runId: string) =>
  new RegExp(`上一轮运行 ${runId}（plan 阶段）的持锁进程 \\d+ 已不在、归档仍为 running：按失联收尾（worker_lost / pid_gone）`);

test('EV-151 G1：--start 的工作进程被强杀后再 --start ⇒ 新一轮回收遗留锁时把上一轮收尾为 failed（worker_lost / pid_gone），新一轮照常跑完', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await startWithRecordedClis(HANG_CLI);
  try {
    assertRecorded(r);
    await killWorker(r.js.worker_pid);
    cleanupGroups(r);
    assert.equal((await readRunJson(r.fx.stageDir, r.js.run_id)).status, 'running', '前提：强杀之后上一轮停在 running');

    const s2 = await cli(
      r.fx.root,
      ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION, '--json'],
      STUB,
    );
    assert.equal(s2.code, EXIT.OK, `${s2.stdout}${s2.stderr}`);
    assert.match(s2.stderr, /回收主题「闸门闭环」的遗留锁（原因 pid_gone/, s2.stderr);
    assert.match(s2.stderr, settleLine(r.js.run_id), s2.stderr);
    const old = await readRunJson(r.fx.stageDir, r.js.run_id);
    assert.equal(old.status, 'failed');
    assert.deepEqual(old.termination, { by: 'worker_lost', reason: 'pid_gone' });
    assert.equal((await taskRunsOf(r.fx.archiveRoot))?.find((t) => t.run_id === r.js.run_id)?.status, 'failed');

    const js2 = JSON.parse(extractJsonCandidate(s2.stdout)!.json) as { run_id: string };
    assert.notEqual(js2.run_id, r.js.run_id);
    const w = await cli(r.fx.root, ['review', '--wait', js2.run_id, '--timeout', '60'], STUB, 120_000);
    assert.equal(w.code, EXIT.OK, `${w.stdout}${w.stderr}`);
    assert.equal((await readRunJson(r.fx.stageDir, js2.run_id)).status, 'success');
  } finally {
    cleanupGroups(r);
  }
});

test('EV-151 G2：同步 review 被强杀后再跑同步 review ⇒ 锁里补写的 run_id 让新一轮定位到上一轮并收尾为 failed', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { spawn } = await import('node:child_process');
  const { BUNDLE, ASSET_ROOT } = await import('../helpers/fixture.js');
  const { encodeStubConfig, STUB_ENV_VAR } = await import('../../src/trivium/adapters/stub.js');
  const fx = await makeFixture({ topic: TOPIC });
  const mark = `trivium-stub-cli:${fx.runRoot}`;
  const args = ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--session-id', SESSION];
  const child = spawn(process.execPath, [BUNDLE, ...args], {
    cwd: fx.root,
    env: { ...process.env, TRIVIUM_ASSET_ROOT: ASSET_ROOT, [STUB_ENV_VAR]: encodeStubConfig(HANG_CLI) },
    detached: true,
    stdio: 'ignore',
  });
  const exited = new Promise((res) => child.once('exit', res));
  const lockFile = path.join(fx.root, '.trivium', 'lock', `${TOPIC}.lock`);
  let oldId: string | null = null;
  try {
    // 等锁里补上 run_id、骨架 run.json 落盘、两侧桩 CLI 起来（20 s 上界，超时即用例前提不成立）
    for (let i = 0; i < 200; i++) {
      const lock = await fs.readFile(lockFile, 'utf8').then((t) => JSON.parse(t) as { run_id: string | null }).catch(() => null);
      if (lock?.run_id && groupsWithMark(mark).length >= 2) {
        const ok = await fs.access(path.join(fx.stageDir, '_meta', `run-${lock.run_id}.json`)).then(() => true, () => false);
        if (ok) { oldId = lock.run_id; break; }
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.ok(oldId, '前提：同步路径应已把 run_id 写进主题锁、骨架 run.json 已落盘、两侧桩 CLI 已起来');
    process.kill(-child.pid!, 'SIGKILL');
    await exited;
    for (const g of groupsWithMark(mark)) killGroup(g);
    assert.equal((await readRunJson(fx.stageDir, oldId)).status, 'running', '前提：强杀之后上一轮停在 running');

    const r2 = await cli(fx.root, args, STUB);
    assert.equal(r2.code, EXIT.OK, `${r2.stdout}${r2.stderr}`);
    assert.match(r2.stderr, settleLine(oldId), r2.stderr);
    const old = await readRunJson(fx.stageDir, oldId);
    assert.equal(old.status, 'failed');
    assert.deepEqual(old.termination, { by: 'worker_lost', reason: 'pid_gone' });
    assert.equal((await taskRunsOf(fx.archiveRoot))?.find((t) => t.run_id === oldId)?.status, 'failed');
    const newer = (await taskRunsOf(fx.archiveRoot))?.filter((t) => t.run_id !== oldId) ?? [];
    assert.deepEqual(newer.map((t) => t.status), ['success'], '新一轮照常跑完');
  } finally {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* 已不在 */ }
    for (const g of groupsWithMark(mark)) killGroup(g);
  }
});
