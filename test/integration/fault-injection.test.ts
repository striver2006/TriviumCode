import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  bundleMissing,
  bundleSkipReason,
  cli,
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
): Promise<{ root: string; stageDir: string; exitCode: number; meta: RunMeta; waitOut: string }> {
  const { root, stageDir } = await makeFixture({
    topic: TOPIC,
    ...(extraReview.length > 0 ? { extraReview } : {}),
  });

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

test('读到禁读清单内的文件 → peer_artifact_read', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { meta } = await runInjected({ gemini: { mode: 'peer_leak' }, glm: { mode: 'ok' } });
  assert.ok(meta.deny_paths.length > 0, '夹具里的 .env 命中 sensitive_globs，禁读清单不该是空的');
  assert.equal(meta.guard.peer_artifact_read, true);
});

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
