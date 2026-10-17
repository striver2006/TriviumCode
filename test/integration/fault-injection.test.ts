import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  bundleMissing,
  bundleSkipReason,
  cli,
  listFiles,
  makeFixture,
  today,
} from '../helpers/fixture.js';
import { sha256File } from '../../src/trivium/util/fsx.js';
import { type StubConfig, type StubSpec } from '../../src/trivium/adapters/stub.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { CriticId, RunMeta } from '../../src/trivium/types.js';
import { AGENTS, DEFAULT_DRIVER, entryCommandOf, guardProfileOf } from '../../src/trivium/agents/registry.js';
import { loadCtx } from '../../src/trivium/config.js';
import { hookPreCommit } from '../../src/trivium/hooks.js';
import { headSha } from '../../src/trivium/util/git.js';
import { setGate } from '../../src/trivium/state.js';
import type { Ctx } from '../../src/trivium/types.js';

/**
 * 故障注入（设计 §17.2，修订版 M3 计划 §5 与 §7）。
 *
 * ## 为什么走真实子进程而不是在进程内替换适配器
 *
 * `review --start` 会派生一个**独立的** `trivium review --worker <runId>` 进程，
 * 那个进程自己 `rebuildContext`、自己构造适配器。在测试主进程里替换
 * `CriticAdapter` 对它毫无影响——注入会静默失效，测试通过而什么都没测到
 * （审查意见 AGY-05）。
 *
 * 所以本文件调用**打包后的真实 CLI**，靠环境变量 `TRIVIUM_STUB_CRITIC` 跨进程注入，
 * 并且每个用例都断言「产出里带着桩的指纹」——即证明 worker 进程真的用了桩。
 * 桩的指纹是 `cli_version: 'stub/0.0.0'`，它只可能由**执行适配器的那个进程**写入
 * （`--start` 的父进程只做冻结与渲染，从不调用 `adapter.run`）。
 *
 * 全程不触碰任何厂商 CLI，不消耗配额。
 */

const TOPIC = '故障注入';

/**
 * 有接受项时执笔方的新一轮计划（EV-214，§6.6 规则 9）：新运行带 `plan_final_check`，
 * 闸门要求它存在、且逐字引用每条被接受的编号。本文件的计划阶段都只跑一轮，轮次恒为 r2。
 */
async function writeNextPlan(planDir: string, ids: string[], role: string = DEFAULT_DRIVER): Promise<void> {
  await fs.writeFile(
    path.join(planDir, `${today()}-${TOPIC}-r2-${role}.md`),
    ['# 计划 r2', '', '相对上一轮的改动：', ...ids.map((id) => `- ${id}：按建议补上`), ''].join('\n'),
    'utf8',
  );
}

/** 跑完整 --start → --wait 循环，返回最终退出码与 run.json */
async function runInjected(
  stub: StubConfig,
  extraArgs: string[] = [],
  extraReview: string[] = [],
  /**
   * 在 `--start` **之前**往夹具里补文件。
   *
   * 禁读集在冻结送审包时枚举一次，之后不再变——要让某份文件进 deny_paths，
   * 只能在这一步放。`makeFixture` 之后、`--start` 之前是唯一的窗口。
   */
  seed?: (root: string) => Promise<void>,
): Promise<{ root: string; stageDir: string; runRoot: string; exitCode: number; meta: RunMeta; waitOut: string }> {
  const { root, stageDir, runRoot } = await makeFixture({
    topic: TOPIC,
    ...(extraReview.length > 0 ? { extraReview } : {}),
  });
  if (seed) await seed(root);

  const started = await cli(
    root,
    [
      'review', '--start', '--stage', 'plan', '--topic', TOPIC,
      '--focus', '注入用例', '--json', ...extraArgs,
    ],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `--start 应成功：\n${started.stdout}\n${started.stderr}`);
  // --json 输出是缩进过的多行 JSON，按行挑「以 { 开头的最后一行」会只拿到那个左花括号
  const candidate = extractJsonCandidate(started.stdout);
  assert.ok(candidate, `--start --json 未产出可解析的 JSON：\n${started.stdout}`);
  const startJson = JSON.parse(candidate.json) as {
    run_id: string;
    worker_pid: number;
  };
  const runId: string = startJson.run_id;
  assert.ok(runId, '--start 必须回 run_id');
  assert.ok(
    startJson.worker_pid !== process.pid,
    '工作进程必须是另一个进程，否则「跨进程注入」这件事无从验证',
  );

  // --wait 轮询到终态。桩瞬时返回，一两轮就够；上限防死循环
  let exitCode: number = EXIT.STILL_RUNNING;
  // 从 --start 的输出攒起：prepareRun 阶段的告警（如「忽略 --allow-single」）只打在那里
  let waitOut = started.stdout + started.stderr;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], stub, 60_000);
    exitCode = w.code ?? EXIT.FAIL;
    waitOut += w.stdout + w.stderr;
  }
  assert.notEqual(exitCode, EXIT.STILL_RUNNING, `--wait 未在上限内收敛：\n${waitOut}`);

  const metaPath = path.join(stageDir, '_meta', `run-${runId}.json`);
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as RunMeta;
  return { root, stageDir, runRoot, exitCode, meta, waitOut };
}

/**
 * 把本主题 plan 闸门推到「等待审批」，让提交锚只剩留痕完整性这一层在判。
 *
 * 成功收尾后闸门停在「等待裁决」，`hookPreCommit` 会先以「裁决未完成」早退，
 * 根本走不到锚②——不先推开这一层，下面的「不点名」断言会因早退而空转。
 */
async function releaseAdjudication(ctx: Ctx): Promise<void> {
  await setGate({
    triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan',
    state: 'awaiting_approval', sessionId: 'S', heartbeatStaleMs: 120_000,
  });
}


test('桩经环境变量跨进程注入，worker 真的用了桩（AGY-05）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({ gemini: { mode: 'ok' }, glm: { mode: 'ok', findings: 2 } });

  for (const side of ['gemini', 'glm'] as const) {
    assert.equal(
      meta.critics[side]?.cli_version,
      'stub/0.0.0',
      `${side} 侧的 cli_version 必须是桩指纹——这只可能由执行适配器的 worker 进程写入`,
    );
    assert.equal(meta.critics[side]?.status, 'ok');
  }
  assert.equal(meta.review_mode, 'full');
  assert.equal(meta.status, 'success');
});

test('plan 原稿在成功收尾后进 meta.artifacts（M10a 第 2 步 EV-55 §3.1.1）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root, meta } = await runInjected({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
  assert.equal(meta.status, 'success');

  // makeFixture 在 plan 阶段目录下种的原稿：<topic>/plan/<today>-<topic>-claude.md
  const relSubject = `${TOPIC}/plan/${today()}-${TOPIC}-claude.md`;
  const entry = meta.artifacts.find((a) => a.path === relSubject);
  assert.ok(
    entry,
    `原稿应当登记进 artifacts[]（相对归档根的路径 ${relSubject}），实际 artifacts：` +
      JSON.stringify(meta.artifacts),
  );

  // 登记的 sha256 必须能还原：path.join(archiveRoot, entry.path) 解析回真实文件、哈希一致
  const archiveRoot = path.join(root, '.reviews');
  const absSubject = path.join(archiveRoot, entry!.path);
  assert.equal(await sha256File(absSubject), entry!.sha256, 'path.join(archiveRoot, path) 必须解析回原稿真实位置');
  // 登记的是冻结值（计划 §7.3 R-j，代码双审 r2 GLM-03），与 run.json 的快照哈希同一个值
  assert.equal(entry!.sha256, meta.snapshot.subject_sha256, '登记哈希应取冻结时的 subject_sha256');

  /*
   * 登记是锚② 生效的**前提**，前提链要端到端验一次（代码双审 r2 AGY-01 ① ≡ GLM-02 (d)）：
   * 成功收尾后原地改原稿，提交锚必须把它作为「已被改动」列出来。
   */
  const ctx = await loadCtx({ cwd: root });
  await releaseAdjudication(ctx);
  const before = await hookPreCommit(ctx, { session_id: 'S' });
  assert.equal(before.exitCode, EXIT.OK, `改稿之前提交锚应放行（否则下面的拦截证明不了什么）：\n${before.stderr}`);
  await fs.appendFile(absSubject, '\n审后改稿\n', 'utf8');
  const after = await hookPreCommit(ctx, { session_id: 'S' });
  assert.equal(after.exitCode, EXIT.GATE_BLOCK);
  assert.ok(
    (after.stderr ?? '').includes(`已被改动：${relSubject}`),
    `已登记原稿被改动，锚② 必须把它列出来：\n${after.stderr}`,
  );

  /*
   * 审查文档的不可变性同样由锚② 承接（代码双审 r2 CODEX-03：提交锚的后缀支已删）。
   * 它们自 M1 起就登记在 artifacts[] 里——这里端到端证明删支后保护没丢。
   */
  const relReview = `${TOPIC}/plan/${today()}-${TOPIC}-gemini.md`;
  const reviewEntry = meta.artifacts.find((a) => a.path === relReview);
  assert.ok(reviewEntry, `审查文档应已登记：${JSON.stringify(meta.artifacts)}`);
  /*
   * 登记的是写入时的哈希（代码双审 r3 CODEX-04）。正常运行里它与此刻重算的值相同——
   * 这条断言锁的是「登记值可还原回文件」，**区分不了**冻结口径与收尾重算口径，别当成变异锁。
   */
  assert.equal(reviewEntry!.sha256, await sha256File(path.join(archiveRoot, relReview)));
  await fs.appendFile(path.join(archiveRoot, relReview), '\n伪造一条意见\n', 'utf8');
  const forged = await hookPreCommit(ctx, { session_id: 'S' });
  assert.ok(
    (forged.stderr ?? '').includes(`已被改动：${relReview}`),
    `已登记的审查文档被改动，锚② 必须把它列出来：\n${forged.stderr}`,
  );
});

test('作废轮（subject_drift）不登记原稿，之后原地改稿不触发锚②（EV-55 §3.1.1 时点）', { skip: bundleMissing && bundleSkipReason }, async () => {
  // 桩在审查期间改写原稿本身 ⇒ 被审对象漂移 ⇒ 整轮作废
  const relSubject = `${TOPIC}/plan/${today()}-${TOPIC}-claude.md`;
  const { root, meta } = await runInjected({
    gemini: { mode: 'mutate_file', note: `.reviews/${relSubject}` },
    glm: { mode: 'ok' },
  });
  assert.equal(meta.status, 'failed', '原稿在送审窗口内被改，整轮必须作废');
  assert.equal(
    meta.artifacts.some((a) => a.path === relSubject),
    false,
    `作废轮不得登记原稿（登记时点移回 --start 时这里会红）：${JSON.stringify(meta.artifacts)}`,
  );

  const ctx = await loadCtx({ cwd: root });
  await releaseAdjudication(ctx);
  await fs.appendFile(path.join(root, '.reviews', relSubject), '\n作废后继续改稿\n', 'utf8');
  const r = await hookPreCommit(ctx, { session_id: 'S' });
  assert.equal(r.exitCode, EXIT.OK, `作废轮之后改稿应可提交：\n${r.stderr}`);
});

test('归档外被审对象（--plan-file doc/…）不登记，run.json 与 gate --check 都有标注（EV-55 §3.1.1 域）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const docRel = 'doc/design-under-review.md';
  const { root, meta } = await runInjected(
    { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
    ['--plan-file', docRel],
    [],
    async (r) => {
      await fs.mkdir(path.join(r, 'doc'), { recursive: true });
      await fs.writeFile(path.join(r, docRel), '# 归档外的设计文档\n', 'utf8');
    },
  );
  assert.equal(meta.status, 'success');
  assert.equal(
    meta.artifacts.some((a) => a.path.includes('design-under-review.md')),
    false,
    `归档外文档不得进 artifacts[]：${JSON.stringify(meta.artifacts)}`,
  );
  assert.ok(
    (meta.gate.warnings ?? []).some((w) => w.includes('本轮原稿不在保护集')),
    `run.json 的 gate.warnings 必须如实标注：${JSON.stringify(meta.gate.warnings)}`,
  );

  // 标注要有读者（代码双审 r2 GLM-04）：gate --check --json 透传
  const chk = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  const cand = extractJsonCandidate(chk.stdout);
  assert.ok(cand, `gate --check --json 未产出 JSON：\n${chk.stdout}\n${chk.stderr}`);
  const js = JSON.parse(cand.json) as { warnings: Array<{ code: string; message: string }> };
  assert.ok(
    js.warnings.some((w) => w.code === 'run_warning' && w.message.includes('本轮原稿不在保护集')),
    `gate --check 必须透传 run.json 的 gate.warnings：${JSON.stringify(js.warnings)}`,
  );

  // 审批停点同样要看得见（代码双审 r3 CODEX-03 ≡ GLM-04）：补齐裁决件后走 --await-approval 成功路径
  await fs.writeFile(
    path.join(root, '.reviews', TOPIC, 'plan', `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${meta.run_id}`,
      // EV-134：列审查文档文件名，不是意见编号
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
  // 被审对象在归档外（没有轮次）⇒ 基准退回 rerun_index，新一轮计划同样是归档内的 r2
  await writeNextPlan(path.join(root, '.reviews', TOPIC, 'plan'), ['AGY-01', 'GLM-01']);
  const aw = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--json']);
  assert.equal(aw.code, EXIT.OK, `--await-approval 应成功：\n${aw.stdout}\n${aw.stderr}`);
  const awCand = extractJsonCandidate(aw.stdout);
  assert.ok(awCand, `--await-approval --json 未产出 JSON：\n${aw.stdout}`);
  const awJs = JSON.parse(awCand.json) as {
    state: string; message: string; warnings?: Array<{ code: string; message: string }>;
  };
  assert.equal(awJs.state, 'awaiting_approval');
  /*
   * 停点话术按当轮 Driver 的有效护栏等级措辞（M10b 第 3 步）：缺省 Driver 登记 L1，
   * 但夹具没有 `.claude/settings.json`，本次按 L2 计——不得再说「Hook 会拦下」。
   */
  assert.doesNotMatch(awJs.message, /Hook 会拦下/, `Hook 配置不在场时不得宣称会拦：\n${awJs.message}`);
  assert.match(awJs.message, /Hook 配置不在场（登记 L1，本次按 L2 计）/);
  assert.match(awJs.message, new RegExp(`通过：${entryCommandOf(DEFAULT_DRIVER, 'dual-approve').replace('$', '\\$')} --topic`));
  assert.ok(
    (awJs.warnings ?? []).some((w) => w.code === 'run_warning' && w.message.includes('本轮原稿不在保护集')),
    `审批停点必须带出运行期告警：${JSON.stringify(awJs.warnings)}`,
  );

  // 随后改它：提交锚不点名这份文档
  const ctx = await loadCtx({ cwd: root });
  await releaseAdjudication(ctx);
  await fs.appendFile(path.join(root, docRel), '\n审后回补修订\n', 'utf8');
  const r = await hookPreCommit(ctx, { session_id: 'S' });
  assert.equal(r.exitCode, EXIT.OK, `归档外文档审后可改、可提交：\n${r.stderr}`);
});

test('未设注入变量时，绝不会用到桩', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root } = await makeFixture({ topic: TOPIC });
  // 不给探针结论，两侧适配器的 availability 应判不可用 → 退 69，而不是悄悄走桩
  const r = await cli(root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'], null);
  assert.equal(r.code, EXIT.ENV, `应因两侧不可用退 69，实际 ${r.code}：\n${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /stub/i, '不得出现任何桩的痕迹');
});

test('生产路径检出注入变量会打醒目告警', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root } = await makeFixture({ topic: TOPIC });
  const r = await cli(root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'], {
    gemini: { mode: 'ok' },
  });
  assert.match(
    r.stdout + r.stderr,
    /TRIVIUM_STUB_CRITIC/,
    '桩能伪造「审查通过」，它在场时必须有明确告警，不能静默生效',
  );
  assert.match(r.stdout + r.stderr, /桩适配器/);
});

test('一侧超时 → 降级单审，失败侧留 .failed.json 而非消失（AC-06）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { stageDir, meta } = await runInjected({
    gemini: { mode: 'timeout' },
    glm: { mode: 'ok' },
  });

  assert.equal(meta.critics.gemini?.status, 'timeout');
  assert.match(meta.critics.gemini?.fail_reason ?? '', /超时/);
  assert.equal(meta.critics.glm?.status, 'ok');
  assert.equal(meta.critics.glm?.cli_version, 'stub/0.0.0', 'glm 侧仍须走桩');
  assert.equal(meta.review_mode, 'partial', '一侧失败即降级续跑');
  assert.ok(meta.degraded_reason, '降级必须写明原因');

  // P5 不可伪装：失败侧不能靠删文件假装没跑
  const metaFiles = await fs.readdir(path.join(stageDir, '_meta'));
  assert.ok(
    metaFiles.some((f) => f.startsWith('review-gemini-') && f.endsWith('.failed.json')),
    `失败侧必须留 .failed.json，实际 _meta/ 内容：${metaFiles.join(', ')}`,
  );
  assert.ok(metaFiles.some((f) => f.startsWith('review-glm-') && f.endsWith('.json')));

  // 成功侧的 Markdown 照常落盘
  const docs = await fs.readdir(stageDir);
  assert.ok(docs.some((f) => f.endsWith('-glm.md')), `实际产出：${docs.join(', ')}`);
});

test('两侧返回非 JSON → 双双 parse_fallback，仍落盘', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { stageDir, meta } = await runInjected({
    gemini: { mode: 'dirty_output' },
    glm: { mode: 'dirty_output' },
  });

  for (const side of ['gemini', 'glm'] as const) {
    assert.equal(meta.critics[side]?.status, 'parse_fallback', `${side} 侧应降级为 parse_fallback`);
    assert.equal(meta.critics[side]?.parse_fallback, true);
  }
  const docs = await fs.readdir(stageDir);
  assert.ok(docs.some((f) => f.endsWith('-gemini.md')));
  assert.ok(docs.some((f) => f.endsWith('-glm.md')), '解析失败也要留痕，不能丢原文');
});

test('exit 0 但零工具调用 → 证据不足', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({ gemini: { mode: 'no_tools' }, glm: { mode: 'ok' } });
  assert.equal(meta.critics.gemini?.evidence_ok, false, '零工具调用不能算有效审查');
  assert.equal(meta.critics.glm?.evidence_ok, true);
});

test('只读了送审材料自己 → 判 no_project_context', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({ gemini: { mode: 'no_project_reads' }, glm: { mode: 'ok' } });
  assert.equal(
    meta.critics.gemini?.evidence_ok,
    false,
    '把 BRIEF 与被审对象反复读 N 遍不构成项目上下文',
  );
});

// ── 跑后复算的漂移判定（设计 §9.2 第 3 步）──

test('审查期间无关业务文件被改 → unrelated，默认 warn，运行仍成功', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { exitCode, meta } = await runInjected({
    gemini: { mode: 'mutate_file', note: 'src/b.ts' }, glm: { mode: 'ok' },
  });
  assert.equal(exitCode, EXIT.OK, '无关漂移默认只告警');
  assert.equal(meta.status, 'success');
  assert.equal(meta.snapshot.drift.changed, true);
  assert.deepEqual(meta.snapshot.drift.files, ['src/b.ts']);
  assert.equal(meta.snapshot.drift.policy, 'warn');
  assert.equal(meta.guard.readonly_breach, false, '轨迹无写事件：这是开发者手改，不是审查员失守');
});

test('审查期间 --context 涉及的文件被改 → related，默认 fail', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { exitCode, meta } = await runInjected(
    { gemini: { mode: 'mutate_file', note: 'src/a.ts' }, glm: { mode: 'ok' } },
    ['--context', 'src'],
  );
  assert.notEqual(exitCode, EXIT.OK, '相关漂移默认判失败');
  assert.equal(meta.status, 'failed');
  assert.equal(meta.snapshot.drift.policy, 'fail');
  assert.deepEqual(meta.snapshot.drift.files, ['src/a.ts']);
});

/*
 * EV-139：审查期间送审快照的 tree 被立即清理 ⇒ 比不了 ⇒ unknown，按 on_drift_related 处置。
 *
 * seed 加一个未跟踪文件：夹具初始化时全部提交，干净工作树的 tree 就是 HEAD 的 tree（可达、清理不掉），
 * 那样 prune 之后照样比得了、判成 unrelated，这条用例就测不到「比不了」。
 */
const seedUntracked = async (root: string): Promise<void> => {
  await fs.writeFile(path.join(root, 'src/untracked-seed.ts'), 'export const seed = 1;\n', 'utf8');
};

/**
 * 终态的护栏告警：worker 把它写进 status.json 的 message，`--wait --json` 原样带出（人读 `--wait` 只打进度）。
 * 运行已到终态，这一次 `--wait` 立即返回。
 */
async function terminalMessage(root: string, runId: string, stub: StubConfig): Promise<string> {
  const w = await cli(root, ['review', '--wait', runId, '--timeout', '5', '--json'], stub, 60_000);
  const c = extractJsonCandidate(w.stdout);
  assert.ok(c, `--wait --json 未产出可解析的 JSON：\n${w.stdout}`);
  return (JSON.parse(c.json) as { message: string | null }).message ?? '';
}

test('EV-139 I1：审查期间送审快照被清理 → 比不了，缺省按 on_drift_related=fail 判失败并留痕原因', { skip: bundleMissing && bundleSkipReason }, async () => {
  const stub: StubConfig = { gemini: { mode: 'prune_objects' }, glm: { mode: 'ok' } };
  const { root, exitCode, meta, stageDir } = await runInjected(stub, [], [], seedUntracked);
  assert.equal(meta.critics.gemini?.cli_version, 'stub/0.0.0', '桩指纹：worker 真的用了桩');
  assert.equal(meta.critics.gemini?.status, 'ok', `桩在夹具内应执行成功：${meta.critics.gemini?.fail_reason ?? ''}`);
  assert.equal(exitCode, EXIT.FAIL, '比不了按 on_drift_related（缺省 fail）判失败');
  assert.equal(meta.status, 'failed');
  assert.equal(meta.snapshot.drift.changed, true);
  assert.deepEqual(meta.snapshot.drift.files, []);
  assert.equal(meta.snapshot.drift.policy, 'fail', 'policy 取本轮实际适用的 on_drift_related');
  assert.equal(meta.snapshot.drift.unknown_reason?.cause, 'object_gone');
  assert.match(meta.snapshot.drift.unknown_reason?.detail ?? '', /送审快照的 tree [0-9a-f]{12} 在审查期间被清理/);
  const message = await terminalMessage(root, meta.run_id, stub);
  assert.match(message, /审查期间工作树有变动，但比不了改了哪些文件/, '告警要随 --wait --json 的终态 message 透出');
  assert.match(message, /按 on_drift_related 处置（策略 fail）/);
  assert.match(message, /对象已不在：送审快照的 tree [0-9a-f]{12} 在审查期间被清理/);

  const doc = (await listFiles(stageDir)).find((f) => f.endsWith('-gemini.md'));
  assert.ok(doc, 'gemini 审查文档应已落盘');
  assert.match(await fs.readFile(path.join(stageDir, doc!), 'utf8'), /审查期间的工作树漂移无法判定/);
});

test('EV-139 I2：on_drift_related=warn 时比不了只告警，运行成功、原因照样留痕', { skip: bundleMissing && bundleSkipReason }, async () => {
  const stub: StubConfig = { gemini: { mode: 'prune_objects' }, glm: { mode: 'ok' } };
  const { root, exitCode, meta, waitOut } = await runInjected(stub, [], ['on_drift_related: warn'], seedUntracked);
  assert.equal(exitCode, EXIT.OK, `比不了在 warn 档只告警：\n${waitOut}`);
  assert.equal(meta.status, 'success');
  assert.equal(meta.snapshot.drift.policy, 'warn');
  assert.equal(meta.snapshot.drift.unknown_reason?.cause, 'object_gone');
  assert.match(await terminalMessage(root, meta.run_id, stub), /本轮照常结束，但漂移是否涉及被审范围无从判断/);
});

test('审查中真写项目文件 → readonly_breach 且复算确证改动，gate --check 判失败（接线端到端）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * 只读失守未确证改动放行（2026-10-06）起，闸门只拦复算确证改动的失守：桩换成真落盘的
   * `write_breach_applied`。只产写事件不落盘的 `write_breach` 那一半归放行格（gate-loop A 格）。
   */
  const { root, stageDir, meta } = await runInjected({ gemini: { mode: 'write_breach_applied' }, glm: { mode: 'ok' } });
  assert.equal(meta.guard.readonly_breach, true, '审查员写文件必须被判只读违规');
  assert.equal(meta.snapshot.drift.changed, true, '桩真的落了盘，复算应检出改动');
  assert.equal(meta.snapshot.drift.unknown_reason, undefined);
  assert.ok(meta.snapshot.drift.files.includes('src/injected.ts'), JSON.stringify(meta.snapshot.drift));

  /*
   * 续到闸门（M9 第 6 步代码双审第 2 轮 GLM-02）：gate.test 只测 loadRoundReviews 与
   * checkAdjudication 两个纯环节，cli.ts 的「解构→透传」段被变异时全仓照绿——
   * 正是本文件上面总结过的「纯函数测对了、接线处错了」。这里经真实 CLI 走一遍：
   * 先落一份把桩产出的编号全部裁决掉的合规裁决件（否则 missing_disposition 早退，
   * 走不到 readonly_breach 那一格——顺带锁住这个顺序事实），再断言失败码在场。
   */
  const metaDir = path.join(stageDir, '_meta');
  const ids: { id: string; side: string }[] = [];
  for (const f of await fs.readdir(metaDir)) {
    const m = /^review-(gemini|glm)-.*\.json$/.exec(f);
    if (!m) continue;
    const r = JSON.parse(await fs.readFile(path.join(metaDir, f), 'utf8')) as { findings?: { id: string }[] };
    for (const x of r.findings ?? []) ids.push({ id: x.id, side: m[1]! });
  }
  assert.ok(ids.length > 0, '桩至少产出一条意见，否则裁决表为空、本用例测不到闸门主路径');
  await fs.writeFile(
    path.join(stageDir, `${today()}-${TOPIC}-revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${meta.run_id}`,
      'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ...ids.map((x) => `| ${x.id} | ${x.side} | minor | 接受 | 用例只为走到失守那一格，逐条接受 | §1 |`),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeNextPlan(stageDir, ids.map((x) => x.id));
  const g = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  assert.notEqual(g.code, EXIT.OK, `只读失守必须让 gate --check 失败：\n${g.stdout}${g.stderr}`);
  const out = JSON.parse(extractJsonCandidate(g.stdout)!.json) as { ok: boolean; failures: { code: string; message: string }[] };
  assert.equal(out.ok, false);
  const f = out.failures.find((x) => x.code === 'readonly_breach');
  assert.ok(f, `失败面必须含 readonly_breach，实得：${JSON.stringify(out.failures)}`);
  assert.ok(f!.message.includes('跑后复算确证审查期间工作树有改动'), f!.message);
  assert.doesNotMatch(out.failures.map((x) => x.code).join(','), /missing_disposition/, '裁决件已落，失败必须来自失守本身而不是缺件早退');
});

/*
 * ── 分档后的端到端用例（设计 §10.1.1）──
 *
 * 这组用例原先只有一个断言：「读到禁读清单内任何文件 → 作废」。
 * 而夹具的禁读集里只有 `.env`（凭据类），于是它实际测的是
 * **「读凭据文件 → 作废」**——那正是本批要改掉的口径：
 * 凭据文件不含任何审查意见，读它不损害背靠背独立性。
 *
 * 拆成四条，各测一档。四条都是**端到端**的（经真实 CLI 与落盘的 run.json），
 * 不是纯函数——r1 代码双审的阻断一正是「纯函数测对了、接线处错了」，
 * 而纯函数测试天然看不见接线。
 *
 * **每条注入都只做一件事**（`peer_leak` 的条目筛选 / `run_material_leak` 的两侧）。
 * 上一版让桩「读禁读集里的全部条目」，而修好路径拼接之后那必定包含整棵运行根
 * ——最重的那一档——于是四档一律作废，其余三档再也测不到。
 * 一次注入混多类，等于让最重的那一档吃掉全部信息。
 */

test(
  '读到凭据文件 → 记一笔，但**不判作废**（分档：安全告警线）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { meta } = await runInjected({
      gemini: { mode: 'peer_leak', note: '.env' },
      glm: { mode: 'ok' },
    });
    assert.ok(meta.deny_paths.length > 0, '夹具里的 .env 命中 sensitive_globs，禁读清单不该是空的');

    assert.equal(
      meta.guard.peer_artifact_read,
      false,
      '凭据文件不含审查意见，读它不损害独立性——按旧口径这里会作废，那是本批要修的误伤',
    );
    const viaPath = meta.guard.peer_leak_via_path?.gemini;
    assert.equal(viaPath?.hit, true, '不作废不等于不记：命中仍要进留痕');
    assert.ok(
      viaPath?.hits.some((h) => h.category === 'sensitive'),
      `命中要逐条带类，实得：${JSON.stringify(viaPath?.hits)}`,
    );
    assert.equal(
      meta.guard.peer_leak_via_command?.gemini?.hit, false,
      '措施 a 命中时措施 b 不该跟着亮：两条通道要能分得开，否则单边失效看不出来',
    );
  },
);

test(
  '读到对端审查产出 → 判作废（分档：会作废的那一档）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * 往夹具里放一份**对端**的历史审查件，它才是「读了就该作废」的那一类。
     * 注入按文件名后缀筛，于是**只有**这一份会被读到——不筛的话，
     * 运行根（同属作废档）也会命中，`peer_artifact_read` 为真就不再能归因到这一份。
     *
     * 这份文件必须在 `--start` **之前**就位：禁读集在冻结送审包时枚举一次，
     * 之后不再变。放晚了它不会进 deny_paths，用例会以「命中里没有对端产物」失败——
     * 那种失败看起来像判定坏了，其实是夹具没摆好，排查起来很费时间。
     */
    const { meta } = await runInjected(
      { gemini: { mode: 'peer_leak', note: '-glm.md' }, glm: { mode: 'ok' } },
      [],
      [],
      async (root) => {
        const dir = path.join(root, '.reviews', TOPIC, 'plan');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, `2026-01-01-${TOPIC}-glm.md`),
          [
            '---',
            'schema: trivium.review.v1',
            `topic: ${TOPIC}`,
            'stage: plan',
            'role: glm',
            'verdict: request-changes',
            '---',
            '',
            '# 上一轮 glm 侧的审查意见（对端产出，本侧禁读）',
          ].join('\n'),
          'utf8',
        );
      },
    );

    assert.equal(
      meta.guard.peer_artifact_read,
      true,
      '读到对端产出必须作废——这一档是三层屏蔽的存在理由',
    );
    const viaPath = meta.guard.peer_leak_via_path?.gemini;
    assert.ok(
      viaPath?.hits.some((h) => h.category === 'peer-artifact'),
      `命中里必须有对端产物那一类，实得：${JSON.stringify(viaPath?.hits)}`,
    );
  },
);

/*
 * ── 运行根这棵混合树的两侧（设计 §10.1.1 的 ②′ 与 ②）──
 *
 * 这两条是**同一个 deny 条目**（整棵运行根）下的两个子树，处置相反。
 * 它们咬住的正是 r1 与 r2 两轮阻断反复复发的那个点：分档要在**命中**上做，
 * 不是在**条目**上做。只要哪天分类退回按条目判，第一条当场红——
 * 整棵运行根按根自己分类必然落到「对端输出」。
 */

test(
  '读自己那一侧的运行材料 → 完全不算命中（分档：②′ 己方材料）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { meta } = await runInjected({
      gemini: { mode: 'run_material_leak', note: 'own' },
      glm: { mode: 'ok' },
    });
    assert.equal(
      meta.guard.peer_artifact_read,
      false,
      '读自己那份产出与编排器的 request 包是编排器要求它做的事，判作废是纯误伤',
    );
    const viaPath = meta.guard.peer_leak_via_path?.gemini;
    assert.equal(
      viaPath?.hit,
      false,
      `己方材料连「记一笔」都不该有——必经动作填满告警档，告警就不再是告警。实得：${
        JSON.stringify(viaPath?.hits)
      }`,
    );
  },
);

test(
  '读对端那一侧的运行输出 → 判作废（分档：② 对端输出）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * 对端**点名**为 glm（M11 第 3 步）。此前桩的裸 `'peer'` 取注册表里第一个非己方的审核者——
     * M9 第 4 步启用 claude 当审核者之后恒是 claude，于是这条用例读的其实是**未入选**的 claude 侧目录：
     * 照样判作废（第三段不是己方），一直是绿的，测的却不是「读到真正参审的对端」。
     */
    const { meta } = await runInjected({
      gemini: { mode: 'run_material_leak', note: 'peer:glm' },
      glm: { mode: 'ok' },
    });
    assert.equal(
      meta.guard.peer_artifact_read,
      true,
      '对方本轮的原始输出实时写在运行目录里，读到它就是背靠背失效',
    );
    const viaPath = meta.guard.peer_leak_via_path?.gemini;
    assert.ok(
      viaPath?.hits.some((h) => h.category === 'peer-run-output'),
      `命中要落在对端运行输出那一类，实得：${JSON.stringify(viaPath?.hits)}`,
    );
  },
);

test(
  '命令里提到禁读条目、文件系统无对应读取 → 措施 b 命中（§10.1 / EV-01）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * **这条用例是变异验证逼出来的。**
     *
     * 起草时我给 judgeSide 接了 `peer.leaked || peerCmd.leaked`，单测覆盖了
     * `checkPeerLeakViaCommand` 本身，全量 1002 条也全绿。
     * 然后把那个 `|| peerCmd.leaked` 删掉——**一条都没红**：接线处没有任何断言守着。
     *
     * 这是本项目第五次「绿测试证明不了任何事」。判据函数测得再细，
     * 也不能替代「它真的被接上了」这条断言。
     */
    const { meta } = await runInjected({
      gemini: { mode: 'peer_leak_via_command' },
      glm: { mode: 'ok' },
    });
    assert.ok(meta.deny_paths.length > 0, '禁读清单不该是空的');
    const viaCmd = meta.guard.peer_leak_via_command;
    assert.equal(viaCmd?.gemini?.hit, true, '命令通道必须命中');
    assert.ok(
      (viaCmd?.gemini?.commands.length ?? 0) > 0,
      '要留下命中的命令原文，否则排查时看不出是经哪条通道漏的',
    );
    assert.match(
      viaCmd?.gemini?.commands[0] ?? '', /^git show HEAD:/,
      '桩走的是 git 对象库形态（F-3）——措施 a 看不见的那条',
    );
    /*
     * 逐侧留痕（GLM-06）：另一侧正常跑完、扫过、没命中——它必须有自己的键且 hit=false。
     * 合并成一个布尔时这条断言写不出来：两侧的结论会被压成一个值。
     */
    assert.equal(viaCmd?.glm?.hit, false, '对侧扫过没命中，要单独记而不是被合并掉');
    assert.equal(
      meta.guard.peer_artifact_read, true,
      '与路径命中**同等处置**：措施 b 单独命中也要把该侧判作废',
    );
    /*
     * 命中逐条带类，与路径通道同构（r2 AGY-04 ≡ GLM-05）。
     * 补这个之前，命令通道只落命令原文：分档结果一个字都不进留痕，
     * 而命令通道是 `command-trace` 一族**唯一**的通道。
     */
    assert.ok(
      (viaCmd?.gemini?.hits?.length ?? 0) > 0,
      `命令通道的命中也要带类，实得：${JSON.stringify(viaCmd?.gemini?.hits)}`,
    );
  },
);

test(
  '命令里提到的是**自己那一侧**的运行材料 → 不作废（两条通道同一个谓词）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * 这条守的是 r2 阻断一：命令通道的分类要喂**命令里那个路径**，
     * 不是被撞上的那个条目。
     *
     * 命令提到的路径在整棵运行根（一个 deny 条目）之下，而它属己方材料。
     * 按条目分类的话，运行根整棵是「对端输出」——该侧当场作废，
     * 且与路径通道对同一份材料的结论正好相反。
     */
    const { meta } = await runInjected({
      gemini: { mode: 'peer_leak_via_command', note: 'own-run' },
      glm: { mode: 'ok' },
    });
    const viaCmd = meta.guard.peer_leak_via_command;
    assert.equal(
      meta.guard.peer_artifact_read,
      false,
      '审查员读自己那份产出是编排器要求它做的事，经命令通道碰到同样不该作废',
    );
    assert.equal(
      viaCmd?.gemini?.hit,
      false,
      `己方材料不进命中集，命令通道与路径通道同口径。实得：${
        JSON.stringify(viaCmd?.gemini?.hits)
      }`,
    );
  },
);

/*
 * ── AC-25：三审形态的路径通道检测收口（M11 第 3 步，计划 r2 §2.3）──
 *
 * 上面那组分档用例都是两侧形态。这一组把同一条判定链放到三审下：三侧入选，
 * 一侧（或两侧）伪造读取另两方的产物，断言**只有**它被判作废、按侧留痕可复核、
 * 另两侧不受牵连；再走到闸门，断言作废侧的意见仍须逐条裁决（差集覆盖三家前缀），
 * 而共同阻断只按有效侧计算。
 *
 * **期望一律从种子清单与注入配置推出**，不从 `run.json.deny_paths` 或判定输出反推：
 * 禁读集漏一条时，桩会少读一条——期望若也取自禁读集，就跟着少一条，用例永绿。
 *
 * **严格策略钉住的是现行行为**（计划 r2 §1.4）：作废不改各侧 `status`，`decideMode` 只看失败 / 超时，
 * 于是 strict 下一侧作废，运行照常 `success`、退出 0。原设想的「二次命中 `failed(peer_leak)`、
 * strict 下整次中止」以重跑为前提，随 BACKLOG EV-225 一并定——那时这几条断言要跟着改。
 *
 * 种下的上一轮审查件会把本轮抬成第 2 轮（`resolveRerunIndex` 取非 Driver 产出的最大轮次加 1），
 * 正是「同主题重跑」的真实形态；裁决件名与审查文档名按 `run.json` 取，不写死。
 */

const THREE: readonly CriticId[] = ['codex', 'gemini', 'glm'];
/** 上一轮的 run_id：只用来给种下的 `_meta` 件取名，与本轮无关 */
const PRIOR_RUN = '20260101T000000Z';

const prefixOf = (c: CriticId): string => {
  const a = AGENTS.find((x) => x.id === c);
  assert.ok(a, `注册表里没有 ${c}`);
  return a.findingPrefix;
};

/**
 * 某家「上一轮」留下的产物（项目相对路径）：审查件正文 + `_meta` 四件（结构化意见、两种回退件、失败记录）。
 * `.failed.json` 也种上（代码双审 GLM-01）：`_meta` 判据按文件名整体命中，它同在覆盖内；
 * 「失败记录只是错误信息」恰是最可能被单独开特例的一种，不种就没有断言替它把关。
 */
const priorRoundOf = (c: CriticId): string[] => [
  `.reviews/${TOPIC}/plan/2026-01-01-${TOPIC}-${c}.md`,
  ...['.json', '.fallback-items.md', '.degraded.json', '.failed.json'].map((k) => `.reviews/${TOPIC}/plan/_meta/review-${c}-${PRIOR_RUN}${k}`),
];

/** run.json 里的命中路径：项目内的记项目相对路径、项目外（运行根下）的记绝对路径——统一成项目相对形态再比 */
const relHit = (root: string, p: string): string => (path.isAbsolute(p) ? path.relative(root, p) : p);

/** 在 `--start` 之前种下这几家的上一轮产物（禁读集在冻结时枚举一次，放晚了进不了 deny_paths） */
async function seedPriorRound(root: string, sides: readonly CriticId[]): Promise<void> {
  for (const c of sides) {
    const [md, ...metas] = priorRoundOf(c);
    await fs.mkdir(path.dirname(path.join(root, metas[0]!)), { recursive: true });
    await fs.writeFile(
      path.join(root, md!),
      ['---', 'schema: trivium.review.v1', `topic: ${TOPIC}`, 'stage: plan', `role: ${c}`, 'verdict: request-changes', '---', '',
        `# 上一轮 ${c} 侧的审查意见（对端产出，另两侧禁读）`].join('\n'),
      'utf8',
    );
    for (const m of metas) await fs.writeFile(path.join(root, m), '{"findings":[]}\n', 'utf8');
  }
}

/** 三侧都桩两条意见（第 1 条恒为 `blocker@src/stub.ts:10`，三侧同位——共同阻断才有料），再叠加本格的注入 */
function stubOf(sides: readonly CriticId[], inject: Partial<Record<CriticId, Pick<StubSpec, 'mode' | 'note'>>>): StubConfig {
  return Object.fromEntries(sides.map((c) => [c, { mode: 'ok', ...inject[c], findings: 2 }])) as StubConfig;
}

/** 本轮某侧审查文档的归档相对路径，取自 `run.json.artifacts[]`（实际落盘名，不按日期现拼） */
function reviewDocOf(meta: RunMeta, c: CriticId): string {
  const p = meta.artifacts.map((a) => a.path).find((x) => !x.includes('/_meta/') && x.endsWith(`-${c}.md`));
  assert.ok(p, `run.json.artifacts 里没有 ${c} 侧的审查文档：${JSON.stringify(meta.artifacts)}`);
  return p;
}

/**
 * 配置前提与严格策略（计划双审 CODEX-01：两个配置依赖都显形）。
 * 缺省值将来变了，用例红在这里的前置核上，而不是红在 AC-25 的断言上、把排查带偏。
 */
async function assertStrictRunUnaffected(
  r: { root: string; exitCode: number; meta: RunMeta; waitOut: string },
  sides: readonly CriticId[],
  extraArgs: readonly string[],
): Promise<void> {
  const ctx = await loadCtx({ cwd: r.root });
  assert.equal(ctx.config.review.failure_policy, 'strict', '前置：夹具缺省应为严格策略，否则「strict 下不中止」无从谈起');
  assert.equal(ctx.config.gate.joint_blocker_policy, 'warn', '前置：共同阻断被驳回只告警——闸门通过那条断言依赖它');
  assert.ok(!extraArgs.includes('--allow-single'), '前置：本格不得传 --allow-single，否则测的是降级策略');

  assert.equal(r.exitCode, EXIT.OK, `strict 下一侧作废不触发整次中止（作废不改 status，中止只由失败 / 超时触发）：\n${r.waitOut}`);
  assert.equal(r.meta.status, 'success');
  assert.equal(r.meta.review_mode, 'full', '作废侧不是失败侧，review_mode 不降级');
  assert.equal(r.meta.degraded_reason, null);
  for (const c of sides) {
    assert.equal(r.meta.critics[c]?.cli_version, 'stub/0.0.0', `${c} 侧必须带桩指纹——证明 worker 真的用了桩`);
    assert.equal(r.meta.critics[c]?.status, 'ok', `${c} 侧 status 应仍为 ok：作废是结论层面的处置，不是该侧失败`);
  }
}

/** 按侧留痕：只有 `voided` 里的侧路径通道命中、审查文档带 peer_leak 与作废横幅；命令通道三侧都没亮 */
async function assertOnlyVoided(
  r: { root: string; meta: RunMeta },
  sides: readonly CriticId[],
  voided: readonly CriticId[],
): Promise<void> {
  assert.equal(r.meta.guard.peer_artifact_read, true, '有侧读到对端产出，全局作废位必须为真');
  for (const c of sides) {
    const viaPath = r.meta.guard.peer_leak_via_path?.[c];
    const viaCmd = r.meta.guard.peer_leak_via_command?.[c];
    assert.equal(viaCmd?.hit, false, `${c} 侧：本组只走路径通道，命令通道不该亮——两条通道要分得开`);
    const doc = await fs.readFile(path.join(r.root, '.reviews', reviewDocOf(r.meta, c)), 'utf8');
    const fm = doc.slice(0, doc.indexOf('\n---', 4));
    if (voided.includes(c)) {
      assert.equal(viaPath?.hit, true, `${c} 侧伪造了读取，路径通道必须命中`);
      assert.match(fm, /^peer_leak:/m, `${c} 侧审查文档的 front-matter 必须带 peer_leak 明细`);
      assert.ok(doc.includes('本侧结论作废'), `${c} 侧审查文档必须有「本侧结论作废」横幅`);
    } else {
      assert.equal(viaPath?.hit, false, `${c} 侧没有伪造读取，不得被另一侧牵连：${JSON.stringify(viaPath?.hits)}`);
      assert.doesNotMatch(fm, /^peer_leak:/m, `${c} 侧审查文档不该带 peer_leak`);
      assert.ok(!doc.includes('本侧结论作废'), `${c} 侧审查文档不该有作废横幅`);
    }
  }
}

/** 写本轮裁决件：`sides` 的 `-01` blocker 全驳回、`-02` 接受；`addresses` 恒列三份审查文档 */
async function writeThreeDisposition(r: { stageDir: string; meta: RunMeta }, all: readonly CriticId[], sides: readonly CriticId[]): Promise<void> {
  const n = r.meta.rerun_index;
  await fs.writeFile(
    path.join(r.stageDir, `${today()}-${TOPIC}-${n > 1 ? `r${n}-` : ''}revised-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${r.meta.run_id}`,
      'addresses:', ...all.map((c) => `  - ${path.basename(reviewDocOf(r.meta, c))}`),
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ...sides.flatMap((c) => [
        `| ${prefixOf(c)}-01 | ${c} | blocker | 驳回 | 桩意见，用例借三家同位的 blocker 检验共同阻断只按有效侧计算 | — |`,
        `| ${prefixOf(c)}-02 | ${c} | minor | 接受 | 桩意见，逐条接受以走到闸门主路径 | §1 |`,
      ]),
      '',
    ].join('\n'),
    'utf8',
  );
}

type GateJson = {
  ok: boolean;
  failures: { code: string; ids?: string[] }[];
  warnings: { code: string; ids?: string[] }[];
  structured_ids: string[];
};

async function gateCheck(root: string): Promise<GateJson> {
  const g = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  const cand = extractJsonCandidate(g.stdout);
  assert.ok(cand, `gate --check --json 未产出 JSON：\n${g.stdout}\n${g.stderr}`);
  return JSON.parse(cand.json) as GateJson;
}

async function jointCheckEntry(root: string, runId: string): Promise<{ state: string; effective_sides: number; reason?: string } | undefined> {
  const t = JSON.parse(await fs.readFile(path.join(root, '.reviews', TOPIC, 'task.json'), 'utf8')) as {
    joint_checks?: { run_id: string; state: string; effective_sides: number; reason?: string }[];
  };
  return t.joint_checks?.find((x) => x.run_id === runId);
}

for (const x of THREE) {
  test(
    `AC-25 三审 · 归档通道：${x} 侧读另两方的审查件正文与结构化意见 → 只有它作废；闸门差集仍含它的编号、共同阻断只按另两侧算`,
    { skip: bundleMissing && bundleSkipReason },
    async () => {
      const others = THREE.filter((c) => c !== x);
      const args = ['--critics', THREE.join(',')];
      // note 只筛归档内条目：不碰 .env（凭据档）、.trivium（编排器档）与运行根（另一格测）
      const r = await runInjected(stubOf(THREE, { [x]: { mode: 'peer_leak', note: '.reviews/' } }), args, [], (root) => seedPriorRound(root, THREE));

      await assertStrictRunUnaffected(r, THREE, args);
      assert.equal(r.meta.rerun_index, 2, '前置：种下的上一轮审查件让本轮成为第 2 轮');

      // ① 命中逐条：恰为另两家上一轮的 1 份审查件正文 + 4 件 _meta（共 10 条），全部是第①类
      const hits = r.meta.guard.peer_leak_via_path?.[x]?.hits ?? [];
      assert.deepEqual(
        hits.map((h) => relHit(r.root, h.path)).sort(),
        others.flatMap(priorRoundOf).sort(),
        `${x} 侧的命中与「另两家的审查件正文 + _meta 四件」不符——多一条是误伤，少一条是禁读集漏了：${JSON.stringify(hits)}`,
      );
      assert.ok(hits.every((h) => h.category === 'peer-artifact'), `每条命中都应是第①类（对端产物，作废档）：${JSON.stringify(hits)}`);

      // ② ④ 按侧留痕：只有 x 作废，另两侧不受牵连
      await assertOnlyVoided(r, THREE, [x]);

      // ③ 运行期只到 pending：有效侧（未作废且有结构化结论）还剩两家
      assert.deepEqual(r.meta.guard.joint_check, { state: 'pending', effective_sides: 2 });

      // ⑥ 闸门差集：漏裁作废侧的两条照样拦——作废是「不可采信」，不是「不用裁」
      await writeNextPlan(r.stageDir, THREE.map((c) => `${prefixOf(c)}-02`));
      await writeThreeDisposition(r, THREE, others);
      const g1 = await gateCheck(r.root);
      assert.equal(g1.ok, false, '漏裁作废侧的意见，gate --check 必须失败');
      assert.deepEqual(g1.failures.map((f) => f.code), ['missing_findings'], JSON.stringify(g1.failures));
      assert.deepEqual(g1.failures[0]!.ids, [`${prefixOf(x)}-01`, `${prefixOf(x)}-02`], '缺的恰是作废侧的两条');
      assert.deepEqual(
        [...new Set(g1.structured_ids.map((id) => id.slice(0, id.lastIndexOf('-'))))].sort(),
        THREE.map(prefixOf).sort(),
        '闸门期望集必须覆盖三家前缀，作废侧不例外',
      );

      // ⑦ 共同阻断按有效侧算：三条 -01 全驳回，告警只点另两家的
      await writeThreeDisposition(r, THREE, THREE);
      const g2 = await gateCheck(r.root);
      assert.equal(g2.ok, true, `裁决齐备后闸门应通过：${JSON.stringify(g2.failures)}`);
      const joint = g2.warnings.find((w) => w.code === 'joint_blocker_rejected');
      assert.ok(joint, `三家同位 blocker 全被驳回，有效的两家应报共同阻断：${JSON.stringify(g2.warnings)}`);
      assert.deepEqual(
        [...(joint.ids ?? [])].sort(),
        others.map((c) => `${prefixOf(c)}-01`).sort(),
        `作废侧的 blocker 不得计入「两家」：${JSON.stringify(joint)}`,
      );
      assert.ok(!g2.warnings.some((w) => w.code === 'joint_check_degraded'), '有效侧还剩两家，共同阻断这一档做了，不该报未执行');
      const jc = await jointCheckEntry(r.root, r.meta.run_id);
      assert.deepEqual(jc && { state: jc.state, effective_sides: jc.effective_sides }, { state: 'checked-found', effective_sides: 2 });
    },
  );
}

for (const x of THREE) {
  test(
    `AC-25 三审 · 运行根通道：${x} 侧读另两方本轮的原始输出 → 只有它作废（第②类）`,
    { skip: bundleMissing && bundleSkipReason },
    async () => {
      const others = THREE.filter((c) => c !== x);
      const args = ['--critics', THREE.join(',')];
      const r = await runInjected(stubOf(THREE, { [x]: { mode: 'run_material_leak', note: `peer:${others.join(',')}` } }), args);

      await assertStrictRunUnaffected(r, THREE, args);
      assert.ok(
        r.meta.deny_paths.includes(r.runRoot),
        `前置：运行根应作为整棵目录条目在禁读集里——命中要经它判出：${JSON.stringify(r.meta.deny_paths)}`,
      );

      // 命中恰为另两家各自的 out/result.json（运行根下 〈项目槽〉/〈runId〉/〈侧〉/out/result.json）
      const hits = r.meta.guard.peer_leak_via_path?.[x]?.hits ?? [];
      const segs = hits.map((h) => path.relative(r.runRoot, h.path).split(path.sep));
      assert.equal(hits.length, 2, `应恰好两条命中：${JSON.stringify(hits)}`);
      for (const s of segs) {
        assert.ok(s.length === 5 && s[0] !== '..' && s[1] === r.meta.run_id && s[3] === 'out' && s[4] === 'result.json', `命中不在本轮运行目录的对端子树里：${s.join('/')}`);
      }
      assert.deepEqual(segs.map((s) => s[2]).sort(), [...others].sort(), '命中应恰为另两家（真正参审的对端）');
      assert.ok(hits.every((h) => h.category === 'peer-run-output'), `运行根下对端输出是第②类：${JSON.stringify(hits)}`);

      await assertOnlyVoided(r, THREE, [x]);
      assert.deepEqual(r.meta.guard.joint_check, { state: 'pending', effective_sides: 2 });
    },
  );
}

test(
  'AC-25 三审 · 两侧作废：有效侧只剩一家，共同阻断记「未执行」并告警，严格策略下仍不中止',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const voided: CriticId[] = ['codex', 'gemini'];
    const args = ['--critics', THREE.join(',')];
    const r = await runInjected(
      stubOf(THREE, { codex: { mode: 'peer_leak', note: '.reviews/' }, gemini: { mode: 'peer_leak', note: '.reviews/' } }),
      args, [], (root) => seedPriorRound(root, THREE),
    );

    await assertStrictRunUnaffected(r, THREE, args);
    await assertOnlyVoided(r, THREE, voided);
    assert.deepEqual(r.meta.guard.joint_check, { state: 'skipped-insufficient-sides', effective_sides: 1 });

    await writeNextPlan(r.stageDir, THREE.map((c) => `${prefixOf(c)}-02`));
    await writeThreeDisposition(r, THREE, THREE);
    const g = await gateCheck(r.root);
    assert.equal(g.ok, true, `裁决齐备后闸门应通过：${JSON.stringify(g.failures)}`);
    assert.ok(g.warnings.some((w) => w.code === 'joint_check_degraded'), `有效侧不足两家必须明说「没查」：${JSON.stringify(g.warnings)}`);
    assert.ok(!g.warnings.some((w) => w.code === 'joint_blocker_rejected'), '只剩一家有效侧，不可能有「两家同时提出」');
    const jc = await jointCheckEntry(r.root, r.meta.run_id);
    assert.deepEqual(jc && { state: jc.state, effective_sides: jc.effective_sides, reason: jc.reason }, {
      state: 'skipped-insufficient-sides', effective_sides: 1, reason: 'voided',
    });
  },
);

test(
  'EV-239 两审 · 命令里只提到编排器状态目录 → 不作废：run.json 与闸门同口径，共同阻断照常执行',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * M11 第 12 步 Z2 / B2 的形态：审核者的命令文本里出现编排器状态目录（排除式 find、--exclude-dir），
     * 没读任何编排器状态。守卫与 run.json 一直把它判告警级；闸门曾对命令通道一律按 hit 作废，
     * 两审形态下有效侧只剩一家、报 joint_check_degraded，同一轮两份留痕给出不同的有效侧数。
     */
    const TWO: CriticId[] = ['gemini', 'glm'];
    const r = await runInjected(stubOf(TWO, { gemini: { mode: 'peer_leak_via_command', note: 'orchestrator-state' } }));

    const viaCmd = r.meta.guard.peer_leak_via_command?.gemini;
    assert.equal(viaCmd?.hit, true, `前提：命令通道扫到了编排器状态目录。实得：${JSON.stringify(viaCmd)}`);
    assert.ok((viaCmd?.hits?.length ?? 0) > 0, '前提：命中逐条带类');
    assert.ok(
      viaCmd!.hits!.every((h) => h.category === 'orchestrator-state'),
      `两条命令都只碰编排器状态目录，命中应全是告警级：${JSON.stringify(viaCmd?.hits)}`,
    );
    assert.equal(r.meta.guard.peer_artifact_read, false, '守卫：告警级命中不判作废');
    assert.deepEqual(r.meta.guard.joint_check, { state: 'pending', effective_sides: 2 }, 'run.json：两家都有效');

    // 闸门：两条 -01 blocker 同位且都被驳回 —— 有效侧是两家，共同阻断真的执行并报出来
    await writeNextPlan(r.stageDir, TWO.map((c) => `${prefixOf(c)}-02`));
    await writeThreeDisposition(r, TWO, TWO);
    const g = await gateCheck(r.root);
    assert.equal(g.ok, true, `裁决齐备后闸门应通过：${JSON.stringify(g.failures)}`);
    assert.ok(
      !g.warnings.some((w) => w.code === 'joint_check_degraded'),
      `告警级命中不该让一侧被排出共同阻断：${JSON.stringify(g.warnings)}`,
    );
    assert.ok(
      g.warnings.some((w) => w.code === 'joint_blocker_rejected'),
      `两家同位 blocker 都被驳回，共同阻断应执行并报出：${JSON.stringify(g.warnings)}`,
    );
    const jc = await jointCheckEntry(r.root, r.meta.run_id);
    assert.deepEqual(
      jc && { state: jc.state, effective_sides: jc.effective_sides },
      { state: 'checked-found', effective_sides: 2 },
      'task.json 与 run.json 记同一个有效侧数',
    );
  },
);

test(
  'AC-25 三审 · Driver 轮换：Driver=glm、claude 当审核者读另两方产出 → 只有 claude 作废，glm 原稿不在任何命中里',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const sides: CriticId[] = ['claude', 'codex', 'gemini'];
    const args = ['--critics', sides.join(','), '--driver', 'glm'];
    const draftRel = `.reviews/${TOPIC}/plan/${today()}-${TOPIC}-glm.md`;
    const r = await runInjected(stubOf(sides, { claude: { mode: 'peer_leak', note: '.reviews/' } }), args, [], async (root) => {
      // 夹具缺省写的是 claude 原稿：换成 glm 执笔。先认领再种别家产物——认领撞上别家后缀的文件会退 64
      await fs.rm(path.join(root, '.reviews', TOPIC, 'plan', `${today()}-${TOPIC}-claude.md`));
      await fs.writeFile(path.join(root, draftRel), '# glm 执笔的原稿\n', 'utf8');
      const claim = await cli(root, ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm', '--json']);
      assert.equal(claim.code, EXIT.OK, `认领失败：\n${claim.stdout}\n${claim.stderr}`);
      await seedPriorRound(root, sides);
    });

    await assertStrictRunUnaffected(r, sides, args);
    const hits = r.meta.guard.peer_leak_via_path?.claude?.hits ?? [];
    assert.deepEqual(
      hits.map((h) => relHit(r.root, h.path)).sort(),
      (['codex', 'gemini'] as const).flatMap((c) => priorRoundOf(c)).sort(),
      `claude 侧的命中应恰为 codex、gemini 上一轮的产物：${JSON.stringify(hits)}`,
    );
    for (const c of sides) {
      assert.ok(
        !(r.meta.guard.peer_leak_via_path?.[c]?.hits ?? []).some((h) => relHit(r.root, h.path) === draftRel),
        `${c} 侧的命中里出现了当轮 Driver 原稿——它被误放进了禁读集`,
      );
    }
    await assertOnlyVoided(r, sides, ['claude']);
  },
);

test('回读到的生效模型与请求不符时如实记录（AC-13）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({
    gemini: { mode: 'ok', modelEffective: '别的模型-不是请求的那个' },
    glm: { mode: 'ok' },
  });
  assert.equal(meta.critics.gemini?.model_effective, '别的模型-不是请求的那个');
  assert.notEqual(
    meta.critics.gemini?.model_effective,
    meta.critics.gemini?.model_requested,
    '生效模型取自回读，不能用请求值顶替',
  );
});

// ── --allow-single（§12.4）──

test('默认 strict：一侧失败即整次中止（退 75）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { exitCode, meta } = await runInjected({
    gemini: { mode: 'fail', note: '桩注入的进程级失败' },
    glm: { mode: 'ok' },
  });
  assert.equal(exitCode, EXIT.STRICT_ABORT, 'strict 下必须以 75 中止');
  assert.equal(meta.status, 'failed');
  assert.equal(meta.review_mode, 'partial');
  assert.ok(meta.degraded_reason, '降级原因必须留痕（AC-06）');
});

test('--allow-single：一侧失败不中止，产出单审并标降级', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { exitCode, meta, stageDir, waitOut } = await runInjected(
    { gemini: { mode: 'fail' }, glm: { mode: 'ok' } },
    ['--allow-single'],
  );
  assert.equal(exitCode, EXIT.OK, `应放行：\n${waitOut}`);
  assert.equal(meta.status, 'success');
  assert.equal(meta.review_mode, 'partial');
  assert.ok(meta.degraded_reason, '降级即便被允许也必须留痕');

  // 幸存侧照常落盘，失败侧留 .failed.json——不靠删文件假装没跑（P5）
  const docs = await fs.readdir(stageDir);
  assert.ok(docs.some((f) => f.endsWith('-glm.md')));
  assert.ok(!docs.some((f) => f.endsWith('-gemini.md')));
  const metas = await fs.readdir(path.join(stageDir, '_meta'));
  assert.ok(metas.some((f) => f.startsWith('review-gemini-') && f.endsWith('.failed.json')));
});

test('配置关掉 allow_single_flag 时，命令行也开不回来', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { exitCode, waitOut } = await runInjected(
    { gemini: { mode: 'fail' }, glm: { mode: 'ok' } },
    ['--allow-single'],
    ['allow_single_flag: false'],
  );
  assert.equal(exitCode, EXIT.STRICT_ABORT, '配置层关掉的东西，命令行不该能开回来');
  assert.match(waitOut, /忽略 --allow-single/);
});

test('两侧都失败：无论什么策略都中止', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { exitCode } = await runInjected(
    { gemini: { mode: 'fail' }, glm: { mode: 'timeout' } },
    ['--allow-single'],
  );
  assert.notEqual(exitCode, EXIT.OK, '没有任何一侧成功时不存在「单审结果」可言');
});

// ─────────────── `--critics` 的调用链（M7b 第 5 步）───────────────

/*
 * **这组必须走真实子进程，纯函数测试证明不了它。**
 *
 * `resolveCriticSelection` 的单测只说明「判定函数返回了什么」；本组说明
 * 「那个返回值一路走到了落盘」。两者的差别不是理论上的：实施时做过一次变异——
 * 把 `review.ts` 的 `opts.critics ?? …` 改成永远取配置默认值（模拟接线漏传），
 * **全量 873 条测试无一变红**。调用链当时是零覆盖的。
 *
 * 第 3 步刚记下「函数对了不等于调用链对了」，这里是同一课的第二次。
 */
test('--critics 单侧：真的只跑那一侧，且不记降级（AC-22 的核心断言）',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    const { exitCode, meta, stageDir } = await runInjected(
      { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
      ['--critics', 'glm'],
    );

    assert.equal(exitCode, EXIT.OK);
    assert.deepEqual(meta.critics_selected, ['glm'], '入选集合要如实记录用户的选择');
    assert.deepEqual(
      Object.keys(meta.critics), ['glm'],
      '未入选的一侧不该被跑起来——这正是漏传 critics 时会失守的地方',
    );

    /*
     * **选 1 侧是配置意图，不是降级**（FR-29 / AC-22）。
     * 第 3 步把 `review_mode: full|partial` 与 `critics_selected` 分开，
     * 就是为了让这一刻成立：单侧成功记 `full`、不写降级原因。
     */
    assert.equal(meta.review_mode, 'full', '选 1 侧并成功不是降级');
    assert.equal(meta.degraded_reason, null);

    // 只数**审查文档**：阶段目录里还有 Driver 的原稿（plan 阶段的被审对象）
    const reviews = (await fs.readdir(stageDir))
      .filter((f) => f.endsWith('.md') && !f.endsWith('-claude.md'));
    assert.deepEqual(
      reviews.map((f) => f.slice(f.lastIndexOf('-') + 1)), ['glm.md'],
      `只该落 glm 一侧的审查文档，实得：${reviews.join('、')}`,
    );
  });

/*
 * 停点话术按**当轮 Driver** 措辞（M10b 第 3 步；第 2 步薄冒烟核出：对 glm 仍写「Hook 会拦下」，
 * 对 codex 仍写 `/dual-approve`）。取一家调用写法**不是** `/` 起头、且没有 Hook 的 Driver
 * （由注册表派生，今天是 codex），走一整轮到停点：两处都必须换成它的。
 */
test('停点话术：调用写法与「不得修改业务文件」都按当轮 Driver（非缺省、无 Hook、非斜杠写法）',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    const drv = AGENTS.find((a) => a.driverEnabled && !a.entryInvocation.startsWith('/') && guardProfileOf(a) === 'l2-none');
    assert.ok(drv, '前提：注册表里有一家非斜杠写法、没有 Hook 的 Driver');
    const { root, meta } = await runInjected(
      { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
      ['--driver', drv.id],
      [],
      async (r) => {
        const planDir = path.join(r, '.reviews', TOPIC, 'plan');
        /*
         * 夹具的缺省原稿带缺省 Driver 的后缀；换了 Driver 之后它不是本轮原稿，会被当成一份他家工件、
         * 把轮次抬成 r2（driver-flag 的用例因同一原因用 `draft: false`）。这里换成当轮 Driver 的原稿。
         */
        await fs.rm(path.join(planDir, `${today()}-${TOPIC}-${DEFAULT_DRIVER}.md`));
        await fs.writeFile(path.join(planDir, `${today()}-${TOPIC}-${drv.id}.md`), `# ${drv.id} 执笔的原稿\n`, 'utf8');
      },
    );
    assert.equal(meta.driver, drv.id);
    assert.equal(meta.driver_guard_level, 'L2');
    await fs.writeFile(
      path.join(root, '.reviews', TOPIC, 'plan', `${today()}-${TOPIC}-revised-${drv.id}.md`),
      [
        '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
        `role: ${drv.id}`, 'kind: revised', `run_id: ${meta.run_id}`,
        // EV-134：列审查文档文件名，不是意见编号
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
    await writeNextPlan(path.join(root, '.reviews', TOPIC, 'plan'), ['AGY-01', 'GLM-01'], drv.id);
    const aw = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--await-approval', '--json']);
    assert.equal(aw.code, EXIT.OK, `--await-approval 应成功：\n${aw.stdout}\n${aw.stderr}`);
    const msg = (JSON.parse(extractJsonCandidate(aw.stdout)!.json) as { message: string }).message;
    const approve = entryCommandOf(drv.id, 'dual-approve');
    assert.ok(!approve.startsWith('/'), approve);
    assert.ok(msg.includes(`通过：${approve} --topic`), `调用写法要换成当轮 Driver 的：\n${msg}`);
    assert.ok(msg.includes(`放弃：${entryCommandOf(drv.id, 'dual-abandon')} --topic`), msg);
    assert.doesNotMatch(msg, /\/dual-approve/, '不得残留斜杠写法');
    assert.doesNotMatch(msg, /Hook 会拦下/, '没有 Hook 的载体不得宣称会拦');
    assert.match(msg, /本载体没有 Hook 拦截（L2），全靠你自觉/);
  });

test('缺省（不给 --critics）：仍按 default_critics 跑满两侧',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    // 与上一条成对：只有单侧用例的话，「永远只跑第一侧」的实现也能过
    const { meta } = await runInjected({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
    assert.deepEqual(meta.critics_selected, ['gemini', 'glm']);
    assert.deepEqual(Object.keys(meta.critics).sort(), ['gemini', 'glm']);
    assert.equal(meta.review_mode, 'full');
    /*
     * 有效护栏等级落进留痕（M10b 第 3 步 B1）：缺省 Driver 登记 L1，但夹具没有 `.claude/settings.json`，
     * Hook 配置不在场 ⇒ 本次运行记 L2。钉的是「真实运行路径上写了这个字段、而且写的是运行时的事实」。
     */
    assert.equal(meta.driver_guard_level, 'L2');
  });

/*
 * **跨命令串联：`topic resolve` 的输出照抄进 `--start` 必须能启动**
 * （审查意见 AGY-03 ≡ GLM-01 的测试面）。
 *
 * 上面三条用例都是 `--start` **直调**——它们挡住了「接线漏传」，却挡不住「接线拼错」。
 * 而真实链路是 `resolve → Driver 按 SKILL 拼装 → --start`，M7b 第 5 步的 major
 * 恰恰出在拼装那一步：resolve 对 `--only` 同时输出 `critics` 与 `only` 两个字段，
 * skill 又让 Driver 两个都传，于是 `--only` 场景**整条链路必退 64**。
 * 当时全量测试无一变红——这一段从未被覆盖过。
 */
/*
 * `userArgs` 是 `--` 之后的 argv **数组**（EV-18 之后 resolve 不再拼串重切）：
 * 正文是一个元素（用户在 shell 里用单引号包住它），旗标各自独立。
 */
async function resolveThenStart(userArgs: string[]): Promise<{ code: number | null; out: string }> {
  const { root } = await makeFixture({ topic: TOPIC });
  const stub = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };

  const r = await cli(root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', ...userArgs], stub);
  assert.equal(r.code, EXIT.OK, `resolve 应成功：\n${r.stdout}\n${r.stderr}`);
  const cand = extractJsonCandidate(r.stdout);
  assert.ok(cand, `resolve --json 未产出可解析 JSON：\n${r.stdout}`);
  const res = JSON.parse(cand.json) as {
    topic: string; prompt_hint: string | null; critics: string[];
    only: string | null; allow_single: boolean;
  };

  /*
   * **照 SKILL.md 的透传规则拼装**：critics 无条件传、`--only` 不传。
   * 这个函数就是 Driver 那一步的机器复刻——它拼错，这里就红。
   */
  assert.equal(res.only, null, 'resolve 不该再输出可传的 only：它已并入 critics');
  const args = [
    'review', '--start', '--stage', 'plan', '--topic', res.topic,
    '--focus', res.prompt_hint ?? 'x', '--entry', 'B',
    '--critics', res.critics.join(','),
    ...(res.allow_single ? ['--allow-single'] : []),
    '--json',
  ];
  const s = await cli(root, args, stub);
  return { code: s.code ?? EXIT.FAIL, out: s.stdout + s.stderr };
}

test('跨命令：resolve(--critics) 的输出照抄进 --start 能启动',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    const { code, out } = await resolveThenStart(['看并发', '--topic', TOPIC, '--critics', 'glm']);
    assert.equal(code, EXIT.OK, `照抄 resolve 输出不该失败：\n${out}`);
  });

test('跨命令：resolve(--only) 的输出照抄进 --start 也能启动（旧别名不得必败）',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    /*
     * 设计 7.1 承诺 `--only` **长期保留为别名**，理由是旧 SKILL.md 可能未同步升级。
     * 修复前这条必退 64，且报错说「你不能同时给两个」——而用户根本没写 `--critics`。
     */
    const { code, out } = await resolveThenStart(['看并发', '--topic', TOPIC, '--only', 'glm']);
    assert.equal(code, EXIT.OK, `旧别名经 resolve 后必须仍能走通：\n${out}`);
  });

test('--critics 拼错：退 64 且不产生任何工件',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const r = await cli(
      root,
      ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--critics', 'gemmini'],
      {},
    );
    assert.equal(r.code, EXIT.USAGE, '参数错误一律退 64');
    /*
     * 「零工件」是设计 §12 对参数错误的硬要求：失败得早，别留半套目录。
     * 这里查阶段目录压根没被建出来。
     */
    await assert.rejects(
      fs.access(path.join(root, '.reviews', TOPIC, 'plan', '_meta')),
      '退 64 的路径不该留下任何运行痕迹',
    );
  });

/*
 * ── 前缀归属的执行权重（审查意见 AGY-01 ≡ GLM-02，两侧独立收敛）──
 *
 * M7b 第 6 步把 `review.v1.json` 的编号 pattern 由 `^(AGY|GLM)-` 放开成只校形状，
 * 身份改由注册表判定。方向对，但当时**只比较了两道检查的判定语义、没比较执行后果**：
 *
 *   放开前：非法前缀被 ajv 拒 → 整份作废 → parse_fallback → 用本侧合法前缀重编号 → 可裁决
 *   放开后：非法前缀是 schema 合法的结构化结论，prefixOk 只进 guard 的告警文本
 *
 * 下游两条后果都实际可达：未登记前缀会让 `gate --check` 陷入解不开的「缺裁决」
 * （裁决件的收行正则只认已登记前缀，Driver 怎么填都收不进去，而报错指向的是
 * 一个错误的原因）；冒名前缀会被 gate 的 Set 与对侧合并，裁决一次即过闸。
 *
 * 这两条用例锁的是「被撤走的后盾被接回了等价位置」。
 */

test('冒用对侧前缀 → 该侧转 parse_fallback，不得作为结构化结论落盘', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({
    gemini: { mode: 'wrong_prefix' }, // 默认冒用另一侧的前缀
    glm: { mode: 'ok' },
  });

  assert.equal(
    meta.critics.gemini?.status,
    'parse_fallback',
    '前缀不属于本侧的结论必须被挡在结构化通道之外——否则它会与对侧的编号在闸门差集里碰撞，' +
      '裁决一次即过闸，跨侧意见静默合并',
  );
  assert.match(
    meta.critics.gemini?.fail_reason ?? '',
    /前缀不属于本侧/,
    '失败原因要说清真实根因，而不是笼统的「解析失败」',
  );
  // 对侧不受连累：一侧的完整性问题不该毁掉另一侧
  assert.equal(meta.critics.glm?.status, 'ok');
});

test('自造未登记前缀 → 同样转 parse_fallback，且重编号用本侧合法前缀', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta, stageDir } = await runInjected({
    gemini: { mode: 'wrong_prefix', note: 'FOO' },
    glm: { mode: 'ok' },
  });

  assert.equal(meta.critics.gemini?.status, 'parse_fallback');

  /*
   * 只断言 status 不够。转 fallback 之后，该侧意见由 `enumerateFallbackFindings`
   * 用**本侧合法前缀**重新编号，于是重新可裁决——那正是被撤走的后盾原本的效果。
   * 若重编号仍带 `FOO-`，死锁照旧，status 却已经是 parse_fallback 了。
   */
  const metaDirAbs = path.join(stageDir, '_meta');
  const metaFiles = await listFiles(metaDirAbs);
  const fallbackFile = metaFiles.find((f) => f.includes('fallback') && f.includes('gemini'));
  assert.ok(fallbackFile, `未找到 gemini 侧的 fallback 编号件：\n${metaFiles.join('\n')}`);
  const body = await fs.readFile(path.join(metaDirAbs, fallbackFile), 'utf8');
  /*
   * 盯的是**单元编号**（行首 `- <编号>:`），不是全文。
   * 原始结论会被整段引用进单元正文里——那是对的，Driver 需要看见审查员究竟说了什么；
   * 关键在于可裁决的那个编号是本侧合法前缀。第一版断言写成「全文不得出现 FOO-」，
   * 把「引用它」误当成「用它编号」，是过严而非过松，实测当场红。
   */
  const unitIds = [...body.matchAll(/^- ([A-Za-z0-9-]+):/gm)].map((m) => m[1]!);
  assert.ok(unitIds.length > 0, `fallback 件里没有可裁决单元：\n${body}`);
  for (const id of unitIds) {
    assert.match(
      id, /^AGY-F\d+$/,
      `可裁决单元的编号必须用本侧合法前缀，实际是「${id}」——否则裁决行照样收不进去，闸门死锁`,
    );
  }
});

/*
 * ── 逐条降级的端到端格（设计 §6.5；解析回退逐条降级计划 r2 §5.1 I 组）──
 *
 * 纯函数单测只证明 `parseReview` 分对了；这两格证明它**真的被接上**：经 worker 落进 run.json 三格、
 * 旁路文件进保护集、审查文档有不合格一节、`gate --check` 按原编号要求逐条裁决。
 */
test('I1 部分意见不合 schema → 该侧仍 ok，只把那几条逐条降级，gate 按原编号要求裁决', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root, stageDir, meta } = await runInjected({
    gemini: { mode: 'partial_schema' },
    glm: { mode: 'ok' },
  });

  const g = meta.critics.gemini!;
  assert.equal(g.status, 'ok', '根对象合法时不整份回退');
  assert.equal(g.parse_fallback, false);
  assert.deepEqual(g.findings_degraded, ['AGY-03', 'AGY-04']);
  assert.deepEqual([...(g.parse_repairs?.stripped_fields ?? [])].sort(), ['run_id', 'stage', 'topic']);
  assert.equal(g.parse_repairs?.unescaped_backslashes, 1);
  assert.equal(g.empty_review, false);
  assert.equal('parse_fallback_cause' in g, false);
  // 对侧：解析成功的侧恒写两格零值
  assert.deepEqual(meta.critics.glm?.findings_degraded, []);
  assert.deepEqual(meta.critics.glm?.parse_repairs, { stripped_fields: [], unescaped_backslashes: 0 });

  // 结构化结论只含合格意见；旁路文件原样保留降级意见并进保护集
  const metaDirAbs = path.join(stageDir, '_meta');
  const rj = JSON.parse(await fs.readFile(path.join(metaDirAbs, `review-gemini-${meta.run_id}.json`), 'utf8')) as { findings: { id: string }[] };
  assert.deepEqual(rj.findings.map((f) => f.id), ['AGY-01', 'AGY-02']);
  const side = `review-gemini-${meta.run_id}.degraded.json`;
  const dj = JSON.parse(await fs.readFile(path.join(metaDirAbs, side), 'utf8')) as { findings: { id: string; raw: Record<string, unknown> }[] };
  assert.deepEqual(dj.findings.map((f) => f.id), ['AGY-03', 'AGY-04']);
  assert.equal(dj.findings[1]!.raw['severity'], 'medium', '原值照录');
  assert.ok(meta.artifacts.some((a) => a.path.endsWith(side)), '旁路文件要进 run.json.artifacts 保护集');

  // 审查文档
  const doc = await fs.readFile(path.join(stageDir, `${today()}-${TOPIC}-gemini.md`), 'utf8');
  assert.match(doc, /^findings_degraded:\n  - AGY-03\n  - AGY-04$/m);
  assert.match(doc, /^parse_repairs:$/m);
  assert.match(doc, /## 不合格意见（逐条降级，共 2 条）/);

  // gate：只裁合格意见 ⇒ 缺降级编号；补齐后通过，并带 degraded_findings 告警
  const glmIds = (JSON.parse(await fs.readFile(path.join(metaDirAbs, `review-glm-${meta.run_id}.json`), 'utf8')) as { findings: { id: string }[] })
    .findings.map((f) => f.id);
  const disp = async (ids: string[]): Promise<void> => {
    await fs.writeFile(
      path.join(stageDir, `${today()}-${TOPIC}-revised-claude.md`),
      [
        '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
        'role: claude', 'kind: revised', `run_id: ${meta.run_id}`,
        'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
        '---', '',
        '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
        ...ids.map((id) => `| ${id} | ${id.startsWith('AGY') ? 'gemini' : 'glm'} | minor | 接受 | 用例逐条接受 | §1 |`),
        '',
      ].join('\n'),
      'utf8',
    );
    await writeNextPlan(stageDir, ids);
  };
  await disp(['AGY-01', 'AGY-02', ...glmIds]);
  const c1 = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  const o1 = JSON.parse(extractJsonCandidate(c1.stdout)!.json) as { ok: boolean; failures: { code: string; ids?: string[] }[] };
  assert.equal(o1.ok, false);
  assert.deepEqual(o1.failures.find((f) => f.code === 'missing_findings')?.ids, ['AGY-03', 'AGY-04']);

  await disp(['AGY-01', 'AGY-02', 'AGY-03', 'AGY-04', ...glmIds]);
  const c2 = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
  const o2 = JSON.parse(extractJsonCandidate(c2.stdout)!.json) as {
    ok: boolean; degraded_ids?: string[]; warnings: { code: string }[]; failures: unknown[];
  };
  assert.equal(o2.ok, true, JSON.stringify(o2.failures));
  assert.deepEqual(o2.degraded_ids, ['AGY-03', 'AGY-04']);
  assert.ok(o2.warnings.some((w) => w.code === 'degraded_findings'));
});

test('I2 全部意见都降级的一侧不是空结论（empty_review: false），整份回退的一侧记成因', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({
    gemini: { mode: 'partial_schema', note: 'all' },
    glm: { mode: 'dirty_output' },
  });
  const g = meta.critics.gemini!;
  assert.equal(g.status, 'ok');
  assert.deepEqual(g.findings_degraded, ['AGY-01', 'AGY-02', 'AGY-03', 'AGY-04']);
  assert.equal(g.empty_review, false, '交了四条意见、只是全部降级，不是空结论');

  const l = meta.critics.glm!;
  assert.equal(l.status, 'parse_fallback');
  assert.equal(l.parse_fallback_cause, 'no_json_object');
  assert.match(l.fail_reason ?? '', /^\[no_json_object\] /);
  assert.equal('findings_degraded' in l, false, '回退侧不写降级两格');
});

/*
 * ── 构建标识的收尾接线（EV-82 小主题第一段，代码双审 r2 CODEX-06）──
 *
 * 纯函数单测只证明 `collectBuildStampNotices` 返回了什么；这条证明它**真的被接上**：
 * 告警落进 run.json 的 `gate.warnings`，并经 `gate --check` 转述为 run_warning。
 *
 * 怎么让夹具进入本仓模式而不开测试后门：打包产物里注入的是本仓真实的构建标识，
 * 夹具的根提交与它不同 ⇒ 默认判非本仓、零告警。把夹具标成浅克隆（git 的正规机制 `.git/shallow`），
 * 根提交就取不到，判定按规则退到包名兜底；再把包名设成 triviumcode ⇒ 本仓模式成立。
 * 此后夹具的作用面与本仓构建时必然不同，收尾必出「不是当前工作树构建的」，HEAD 那条随之照出
 * （EV-111 起 HEAD 只在指纹未判定一致时才比）；构建时工作树脏还会多一条 dirty。
 * 2026-09-24 实跑读数正是这三条（dirty 那条因当时工作树有未提交改动）——走的是生产路径的每一步。
 */
test('构建标识告警经收尾接线落进 run.json 的 gate.warnings，gate --check 转述为 run_warning（r2 CODEX-06）',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    const { root, meta } = await runInjected(
      { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
      [],
      [],
      async (r) => {
        await fs.writeFile(path.join(r, 'package.json'), JSON.stringify({ name: 'triviumcode' }), 'utf8');
        const head = await headSha(r);
        assert.ok(head, '夹具应是有提交的 git 仓库');
        await fs.writeFile(path.join(r, '.git', 'shallow'), `${head}\n`, 'utf8');
      },
    );
    assert.equal(meta.status, 'success');
    const stampWarnings = (meta.gate.warnings ?? []).filter((w) => /构建标识|安装副本|构建时工作树/.test(w));
    assert.ok(stampWarnings.length > 0, `本仓模式下收尾必须写出构建标识告警：${JSON.stringify(meta.gate.warnings)}`);

    const chk = await cli(root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json']);
    const cand = extractJsonCandidate(chk.stdout);
    assert.ok(cand, `gate --check --json 未产出 JSON：\n${chk.stdout}\n${chk.stderr}`);
    const js = JSON.parse(cand.json) as { warnings: Array<{ code: string; message: string }> };
    assert.ok(
      js.warnings.some((w) => w.code === 'run_warning' && stampWarnings.includes(w.message)),
      `gate --check 必须转述构建标识告警：${JSON.stringify(js.warnings)}`,
    );
  });
