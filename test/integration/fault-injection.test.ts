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
} from '../helpers/fixture.js';
import { type StubConfig } from '../../src/trivium/adapters/stub.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';

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
): Promise<{ root: string; stageDir: string; exitCode: number; meta: RunMeta; waitOut: string }> {
  const { root, stageDir } = await makeFixture({
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
  return { root, stageDir, exitCode, meta, waitOut };
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

test('审查中写项目文件 → readonly_breach', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({ gemini: { mode: 'write_breach' }, glm: { mode: 'ok' } });
  assert.equal(meta.guard.readonly_breach, true, '审查员写文件必须被判只读违规');
});

/*
 * ── 分档后的两条端到端用例（设计 §10.1.1）──
 *
 * 这条用例原先只有一个断言：「读到禁读清单内任何文件 → 作废」。
 * 而夹具的禁读集里只有 `.env`（凭据类），于是它实际测的是
 * **「读凭据文件 → 作废」**——那正是本批要改掉的口径：
 * 凭据文件不含任何审查意见，读它不损害背靠背独立性。
 *
 * 拆成两条，各测一档。两条都是**端到端**的（经真实 CLI 与落盘的 run.json），
 * 不是纯函数——r1 代码双审的阻断一正是「纯函数测对了、接线处错了」，
 * 而纯函数测试天然看不见接线。
 */

test(
  '读到凭据文件 → 记一笔，但**不判作废**（分档：安全告警线）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { meta } = await runInjected({ gemini: { mode: 'peer_leak' }, glm: { mode: 'ok' } });
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
     * 桩的 `peer_leak` 模式读禁读集里的全部条目，于是这一份会被读到。
     *
     * 这份文件必须在 `--start` **之前**就位：禁读集在冻结送审包时枚举一次，
     * 之后不再变。放晚了它不会进 deny_paths，用例会以「命中里没有对端产物」失败——
     * 那种失败看起来像判定坏了，其实是夹具没摆好，排查起来很费时间。
     */
    const { meta } = await runInjected(
      { gemini: { mode: 'peer_leak' }, glm: { mode: 'ok' } },
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

test('缺省（不给 --critics）：仍按 default_critics 跑满两侧',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    // 与上一条成对：只有单侧用例的话，「永远只跑第一侧」的实现也能过
    const { meta } = await runInjected({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
    assert.deepEqual(meta.critics_selected, ['gemini', 'glm']);
    assert.deepEqual(Object.keys(meta.critics).sort(), ['gemini', 'glm']);
    assert.equal(meta.review_mode, 'full');
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
async function resolveThenStart(userArgs: string): Promise<{ code: number | null; out: string }> {
  const { root } = await makeFixture({ topic: TOPIC });
  const stub = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };

  const r = await cli(root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', userArgs], stub);
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
    const { code, out } = await resolveThenStart(`看并发 --topic ${TOPIC} --critics glm`);
    assert.equal(code, EXIT.OK, `照抄 resolve 输出不该失败：\n${out}`);
  });

test('跨命令：resolve(--only) 的输出照抄进 --start 也能启动（旧别名不得必败）',
  { skip: bundleMissing && bundleSkipReason }, async () => {
    /*
     * 设计 7.1 承诺 `--only` **长期保留为别名**，理由是旧 SKILL.md 可能未同步升级。
     * 修复前这条必退 64，且报错说「你不能同时给两个」——而用户根本没写 `--critics`。
     */
    const { code, out } = await resolveThenStart(`看并发 --topic ${TOPIC} --only glm`);
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
