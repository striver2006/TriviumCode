import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
const TASK_LOCK_DIR = mkdtempSync(joinPath(tmpdir(), 'trivium-report-lock-'));
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { acceptanceRate, buildTopicReport, renderTopicReport, type RoundReport } from '../../src/trivium/report.js';
import { newRunMeta, writeRunMeta, registerRun, type TaskMeta } from '../../src/trivium/meta.js';
import { writeArtifact, writeMeta, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { Review } from '../../src/trivium/types.js';

/**
 * 主题级复盘（设计 §5.1 / §9.3 / §15.2）。
 *
 * 报告只读 `.reviews/`，所以这些用例的做法是**真的把归档摆出来**再读回，
 * 而不是往渲染函数里塞手造对象——后者测不出「归档里缺件时会怎样」，
 * 而那恰恰是复盘最容易骗人的地方。
 */

const TOPIC = '复盘主题';

async function archive(): Promise<ArchiveLayout & { root: string }> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-report-'));
  const root = await fs.realpath(raw);
  const archiveRoot = path.join(root, '.reviews');
  await fs.mkdir(path.join(archiveRoot, TOPIC, 'plan', '_meta'), { recursive: true });
  return { archiveRoot, topic: TOPIC, root };
}

/**
 * 造一份合规结论。编号必须是 `AGY-NN` / `GLM-NN`：
 * schema 的 id pattern 是 `^(AGY|GLM)-(r\\d+-)?\\d{2,}$`，
 * 裁决件解析器也据此过滤（免得把表格里的小结行当数据行）。
 */
function review(locations: string[], severities: string[] = [], prefix = 'AGY'): Review {
  return {
    schema: 'trivium.review.v1',
    verdict: 'request-changes',
    summary: 's',
    findings: locations.map((location, i) => ({
      id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      severity: severities[i] ?? 'minor',
      layer: 'plan',
      kind: 'correctness',
      location,
      problem: 'p',
      evidence: 'e',
      suggestion: 'g',
      confidence: 'high',
    })),
  } as unknown as Review;
}

/** 摆一轮完整归档：两侧审查文档 + 两份 review json + run.json */
async function seedRound(
  l: ArchiveLayout,
  opts: {
    rerunIndex: number;
    runId: string;
    gemini?: Review | null;
    glm?: Review | null;
    glmFailed?: boolean;
    usage?: Record<string, unknown>;
    drift?: boolean;
  },
) {
  const meta = newRunMeta({
    runId: opts.runId, topic: l.topic, stage: 'plan', rerunIndex: opts.rerunIndex,
    command: 'test', promptHint: '焦点', taskGoal: null,
    treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn',
  });
  if (opts.drift) meta.snapshot.drift = { changed: true, files: ['x.ts'], policy: 'warn' };

  for (const [c, rv] of [['gemini', opts.gemini], ['glm', opts.glm]] as const) {
    if (c === 'glm' && opts.glmFailed) {
      meta.critics.glm = {
        vendor: 'zcode', cli_version: null, model_requested: 'GLM-x', model_effective: null,
        model_effective_source: 'unverified', status: 'timeout', exit_code: null, duration_s: 900,
        tool_calls: {}, evidence_ok: false, heterogeneous: true, fail_reason: '脚本级超时（900s）',
      };
      await writeMeta(l, 'plan', `review-glm-${opts.runId}.failed.json`,
        JSON.stringify({ critic: 'glm', status: 'timeout', fail_reason: '脚本级超时（900s）' }) + '\n');
      meta.review_mode = 'single';
      meta.degraded_reason = 'glm: timeout';
      continue;
    }
    if (!rv) continue;
    meta.critics[c] = {
      vendor: c === 'gemini' ? 'antigravity' : 'zcode',
      cli_version: '1.0', model_requested: c === 'gemini' ? 'gemini-x' : 'GLM-x',
      model_effective: c === 'gemini' ? 'gemini-x' : 'provider/GLM-x',
      model_effective_source: 'envelope', status: 'ok', exit_code: 0, duration_s: c === 'gemini' ? 100 : 200,
      tool_calls: { read: 9 }, evidence_ok: true, heterogeneous: true,
      ...(opts.usage ? { usage: opts.usage as Record<string, number> } : {}),
    };
    await writeMeta(l, 'plan', `review-${c}-${opts.runId}.json`, JSON.stringify(rv) + '\n');
    await writeArtifact({
      layout: l, stage: 'plan', role: c, writer: c,
      rerunIndex: opts.rerunIndex, content: `# ${c} 审查\n\nrun_id: ${opts.runId}\n`,
    });
  }

  meta.status = 'success';
  await writeRunMeta(l, 'plan', meta);
  await registerRun(l, meta, { triviumDir: TASK_LOCK_DIR, heartbeatStaleMs: 120_000 });
  return meta;
}

// ── 空主题 ──

test('空主题：如实说「没有轮次」，不渲染成一份看起来干净的报告', async () => {
  const l = await archive();
  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 0);
  assert.ok(r.notes.some((n) => /没有任何已产出审查工件/.test(n)));
  const md = renderTopicReport(r);
  assert.match(md, /没有任何已产出审查工件/);
  assert.match(md, /（无数据）/);
});

// ── 正常一轮 ──

test('一轮双审：时间线、意见数、严重度分布、生效模型齐备', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['src/a.ts:10', 'src/b.ts:20'], ['blocker', 'major']),
    glm: review(['src/a.ts:8-12'], ['minor'], 'GLM'),
  });

  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 1);
  const d = r.rounds[0]!;
  assert.equal(d.runId, 'R1');
  assert.equal(d.reviewMode, 'dual');
  assert.deepEqual(
    d.sides.map((s) => [s.critic, s.findings]).sort(),
    [['gemini', 2], ['glm', 1]],
  );
  assert.deepEqual(d.severity, { blocker: 1, major: 1, minor: 1, nit: 0 });

  const md = renderTopicReport(r);
  assert.match(md, /plan r1/);
  assert.match(md, /provider\/GLM-x/, '生效模型须是回读值');
});

test('归一化后的重合度进表，且未归一化值一并给出', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['src/a.ts:10']),
    glm: review(['src/a.ts:8-12'], [], 'GLM'),
  });
  const r = await buildTopicReport(l);
  // 两侧时恰好一对，与旧行为等价；配对身份随项给出（M7b 第 2 步）
  assert.equal(r.rounds[0]!.divergences.length, 1, '两侧应恰好产出一对');
  const v = r.rounds[0]!.divergences[0]!;
  assert.deepEqual([v.a, v.b], ['gemini', 'glm'], '配对身份要如实记，渲染侧不再靠默契补名字');
  assert.equal(v.jaccard, 1, ':10 落在 :8-12 内，是同一处');
  assert.equal(v.rawJaccard, 0, '原始字符串不相等');
  assert.equal(v.degenerate, true);
  assert.match(renderTopicReport(r), /退化|重合度超过阈值/);
});

// ── 降级与缺件 ──

test('单侧超时：显示状态而非 0，并进降级清单', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['src/a.ts:1']),
    glmFailed: true,
  });

  const r = await buildTopicReport(l);
  const d = r.rounds[0]!;
  const glm = d.sides.find((s) => s.critic === 'glm')!;
  assert.equal(glm.findings, null, '失败侧的意见数必须是 null，不能是 0');
  assert.equal(glm.status, 'timeout');
  assert.equal(d.reviewMode, 'single');
  assert.deepEqual(d.divergences, [], '只有一侧有结论时不算重合度');

  const md = renderTopicReport(r);
  assert.match(md, /（timeout）/, '表里显示状态');
  assert.match(md, /脚本级超时/);
  assert.match(md, /0.*会被读成「该侧认为没问题」/s);
});

test('审查完成但无裁决件 → 明确点出，采纳率不按 0 算', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const r = await buildTopicReport(l);
  assert.equal(r.rounds[0]!.disposals, null);
  assert.ok(r.rounds[0]!.notes.some((n) => /尚无裁决件/.test(n)));
  assert.deepEqual(acceptanceRate(r.rounds), { accepted: 0, total: 0 });
  assert.match(renderTopicReport(r), /尚无裁决件/);
});

// ── 裁决与驳回 ──

test('裁决件被解析：采纳率与被驳回项带理由', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['a:1', 'a:2']), glm: review(['b:1'], [], 'GLM'),
  });
  await writeArtifact({
    layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1,
    content: [
      '# 修订计划', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了 | §3 |',
      '| AGY-02 | gemini | major | 驳回 | 与 ADR-001 冲突，镜像树已被推翻 | — |',
      '| GLM-01 | glm | minor | 暂缓 | 依赖上游探针结论，M4 再定 | — |',
      '',
    ].join('\n'),
  });

  const r = await buildTopicReport(l);
  const d = r.rounds[0]!;
  assert.deepEqual(d.disposals, { 接受: 1, 驳回: 1, 暂缓: 1 });
  assert.deepEqual(acceptanceRate(r.rounds), { accepted: 1, total: 3 });
  assert.equal(d.contested.length, 2, '驳回与暂缓都算争议项');

  const md = renderTopicReport(r);
  assert.match(md, /1 \/ 3 = 33%/);
  assert.match(md, /与 ADR-001 冲突/, '驳回理由必须出现在报告里');
  assert.match(md, /M4 再定/);
});

// ── token 与告警 ──

test('token 逐侧列出，字符串字段被丢弃而不是累加成垃圾', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM'),
    // 实测 zcode 的 usage 里混了字符串 source 字段
    usage: { input_tokens: 100, output_tokens: 20, source: 'provider' },
  });
  const r = await buildTopicReport(l);
  const md = renderTopicReport(r);
  assert.match(md, /input_tokens 100/);
  assert.doesNotMatch(md, /0provider|source provider/, '字符串字段不得进汇总');
  assert.match(md, /两侧\*\*不合计\*\*/);
});

test('漂移与路径 deny 降级进告警清单', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM'), drift: true });
  const r = await buildTopicReport(l);
  assert.ok(r.rounds[0]!.guardFlags.some((g) => /漂移 1 个文件/.test(g)));
  assert.match(renderTopicReport(r), /漂移 1 个文件/);
});

// ── 多轮 ──

test('多轮按轮次升序，采纳率跨轮累计', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  await seedRound(l, { rerunIndex: 2, runId: 'R2', gemini: review(['c:1']), glm: review(['d:1'], [], 'GLM') });

  const r = await buildTopicReport(l);
  assert.deepEqual(r.rounds.map((d) => d.rerunIndex), [1, 2]);
  assert.deepEqual(r.rounds.map((d) => d.runId), ['R1', 'R2']);

  const rounds: RoundReport[] = r.rounds.map((d) => ({
    ...d, disposals: { 接受: 2, 驳回: 1, 暂缓: 0 },
  }));
  assert.deepEqual(acceptanceRate(rounds), { accepted: 4, total: 6 });
});

test('缺 run.json 的轮次照样出现在报告里，并说明元数据缺失', async () => {
  const l = await archive();
  // 只放一份审查文档，不放 run.json
  await writeArtifact({
    layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1,
    content: '# 孤立的审查文档\n',
  });
  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 1, '有工件就得出现，不能因为缺元数据就当它不存在');
  assert.ok(r.rounds[0]!.notes.some((n) => /找不到对应的/.test(n)));
  assert.match(renderTopicReport(r), /找不到对应的/);
});

test('task.json 的降级与争议项被带进报告', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const taskPath = path.join(l.archiveRoot, l.topic, 'task.json');
  const task = JSON.parse(await fs.readFile(taskPath, 'utf8')) as TaskMeta;
  task.disputed = true;
  task.disputes = [{ run_id: 'R1', finding_ids: ['X-1', 'Y-2'], note: '双方共同 blocker 被驳回' }];
  await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

  const md = renderTopicReport(await buildTopicReport(l));
  assert.match(md, /双方共同 blocker 被驳回/);
  assert.match(md, /X-1、Y-2/);
});

// ── 降级纪律：读不到就说读不到（审查意见 GLM-r2-09）──

test('verify 记录损坏 → 如实说损坏，不伪装成「从未验证」', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const vdir = path.join(l.archiveRoot, TOPIC, 'verify', '_meta');
  await fs.mkdir(vdir, { recursive: true });
  await fs.writeFile(path.join(vdir, 'verify-R9.json'), '{ 这不是 JSON', 'utf8');

  const r = await buildTopicReport(l);
  assert.ok(
    r.notes.some((n) => /verify 记录损坏/.test(n)),
    `应如实报损坏，实际 notes：${r.notes.join(' | ')}`,
  );
  const md = renderTopicReport(r);
  assert.match(md, /verify 记录损坏/);
  // 「记录损坏」被渲染成「尚无记录」恰是 P5 要防的误读
  assert.doesNotMatch(md, /- 尚无 verify 记录/);
});

test('裁决件读不到不让整份复盘崩溃', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  // 写一份裁决件，然后把它变成目录——readFile 必然失败
  const p = path.join(l.archiveRoot, TOPIC, 'plan', `${new Date().toISOString().slice(0, 10)}-${TOPIC}-revised-claude.md`);
  await fs.mkdir(p, { recursive: true });

  const r = await buildTopicReport(l); // 不该抛
  assert.ok(
    r.rounds[0]!.notes.some((n) => /裁决件读取失败/.test(n)),
    `应进 notes，实际：${r.rounds[0]!.notes.join(' | ')}`,
  );
  assert.equal(r.rounds[0]!.disposals, null);
});
