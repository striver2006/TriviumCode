/**
 * 逐条降级在闸门侧的表达（设计 §6.5 / §8.6；计划 `.reviews/解析回退逐条降级/plan/` r2 §3.4、§3.6、§5.1 G 组）。
 *
 * 降级意见**不在** `reviews` 里（失去阻断资格的全部实现），按原编号经 `expectedDegradedIds` 进期望集。
 * 名字带〔回归〕的格在改前构建上也必须绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkAdjudication, loadRoundReviews, renderGateResult } from '../../src/trivium/gate.js';
import { newRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { writeArtifact, writeMeta, type ArchiveLayout } from '../../src/trivium/archive.js';
import { CRITIC_VENDOR, type CriticId, type Finding, type Review, type RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const DATE = '2026-09-10';
const TOPIC = '降级闸门';

async function layout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-gate-degrade-');
  return { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
}

function finding(over: Partial<Finding> & { id: string }): Finding {
  return {
    severity: 'major', layer: 'plan', kind: 'correctness',
    location: 'plan §1', problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high',
    ...over,
  };
}

function review(ids: (Partial<Finding> & { id: string })[]): Review {
  return {
    schema: 'trivium.review.v1', verdict: 'request-changes',
    summary: '总判断若干字，足够长以通过完整性检查。',
    findings: ids.map(finding),
    not_covered: ['x'], consulted: ['src/a.ts'],
  };
}

async function putDisposition(l: ArchiveLayout, rows: string[], runId = 'R1'): Promise<void> {
  const md = [
    '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan', 'role: claude', 'kind: revised',
    `run_id: ${runId}`, 'addresses:', `  - ${DATE}-${TOPIC}-gemini.md`, '---', '', '# 修订计划', '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |', '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...rows, '',
  ].join('\n');
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: md, date: DATE });
}

const base = {
  cfg: defaultConfig(), stage: 'plan' as const, rerunIndex: 1, degraded: false, reviewDocs: null,
};

test('G1 降级编号没有裁决 ⇒ missing_findings 点名它', async () => {
  const l = await layout();
  await putDisposition(l, ['| AGY-01 | gemini | major | 接受 | 成立 | §1 |']);
  const r = await checkAdjudication({
    ...base, layout: l, reviews: { gemini: review([{ id: 'AGY-01' }]) }, expectedDegradedIds: ['AGY-02'],
  });
  assert.equal(r.ok, false, renderGateResult(r));
  const f = r.failures.find((x) => x.code === 'missing_findings');
  assert.deepEqual(f?.ids, ['AGY-02']);
});

test('G2 降级编号有裁决 ⇒ 通过；不在合格 ∪ 降级里的编号仍报多余', async () => {
  const l = await layout();
  await putDisposition(l, [
    '| AGY-01 | gemini | major | 接受 | 成立 | §1 |',
    '| AGY-02 | gemini | minor | 驳回 | 与事实不符 | 不改 |',
  ]);
  const ok = await checkAdjudication({
    ...base, layout: l, reviews: { gemini: review([{ id: 'AGY-01' }]) }, expectedDegradedIds: ['AGY-02'],
  });
  assert.equal(ok.ok, true, renderGateResult(ok));
  assert.deepEqual(ok.degradedIds, ['AGY-02']);
  assert.match(renderGateResult(ok), /1 条逐条降级/);

  const l2 = await layout();
  await putDisposition(l2, [
    '| AGY-01 | gemini | major | 接受 | 成立 | §1 |',
    '| AGY-02 | gemini | minor | 驳回 | 与事实不符 | 不改 |',
    '| AGY-09 | gemini | minor | 驳回 | 抄错 | 不改 |',
  ]);
  const bad = await checkAdjudication({
    ...base, layout: l2, reviews: { gemini: review([{ id: 'AGY-01' }]) }, expectedDegradedIds: ['AGY-02'],
  });
  assert.deepEqual(bad.failures.find((x) => x.code === 'unknown_findings')?.ids, ['AGY-09']);
});

test('G3 降级意见「接受」也要写落点', async () => {
  const l = await layout();
  await putDisposition(l, [
    '| AGY-01 | gemini | major | 接受 | 成立 | §1 |',
    '| AGY-02 | gemini | minor | 接受 | 成立 |  |',
  ]);
  const r = await checkAdjudication({
    ...base, layout: l, reviews: { gemini: review([{ id: 'AGY-01' }]) }, expectedDegradedIds: ['AGY-02'],
  });
  assert.deepEqual(r.failures.find((x) => x.code === 'missing_action')?.ids, ['AGY-02']);
  // 只该有这一项：降级编号在期望集里，不能同时被当成多余裁决（改前闸门两项都报）
  assert.deepEqual(r.failures.map((x) => x.code), ['missing_action'], renderGateResult(r));
});

test('G4 一侧全部降级、没有 F 单元、裁决表为空 ⇒ unparsable_table（计划双审 r1 AGY-02）', async () => {
  const l = await layout();
  await putDisposition(l, []);
  const r = await checkAdjudication({
    ...base, layout: l, reviews: { gemini: review([]) }, expectedDegradedIds: ['AGY-01', 'AGY-02'],
  });
  const f = r.failures.find((x) => x.code === 'unparsable_table');
  assert.ok(f, renderGateResult(r));
  assert.match(f!.message, /共有 2 条意见需要裁决/);
  assert.match(f!.message, /含 2 条逐条降级/);
});

test('G5〔回归〕两侧同位置的 blocker 其一降级 ⇒ 不算共同来源，双双驳回也不触发共同阻断', async () => {
  const cfg = defaultConfig();
  cfg.gate.joint_blocker_policy = 'hard';
  const rows = [
    '| AGY-01 | gemini | blocker | 驳回 | 不成立 | 不改 |',
    '| GLM-01 | glm | blocker | 驳回 | 不成立 | 不改 |',
  ];
  // 对照：两条都合格 ⇒ 共同阻断被驳回，硬失败
  const l0 = await layout();
  await putDisposition(l0, rows);
  const both = await checkAdjudication({
    ...base, cfg, layout: l0, expectedDegradedIds: [],
    reviews: { gemini: review([{ id: 'AGY-01', severity: 'blocker', location: 'X' }]), glm: review([{ id: 'GLM-01', severity: 'blocker', location: 'X' }]) },
  });
  assert.ok(both.failures.some((x) => x.code === 'joint_blocker_rejected'), '对照格应触发共同阻断');
  // glm 那条降级：不在 reviews 里 ⇒ 不是第二个独立来源
  const l1 = await layout();
  await putDisposition(l1, rows);
  const one = await checkAdjudication({
    ...base, cfg, layout: l1, expectedDegradedIds: ['GLM-01'],
    reviews: { gemini: review([{ id: 'AGY-01', severity: 'blocker', location: 'X' }]), glm: review([]) },
  });
  assert.equal(one.failures.some((x) => x.code === 'joint_blocker_rejected'), false, renderGateResult(one));
});

test('G6 有降级意见 ⇒ degraded_findings 告警列全编号，并说清不参与阻断', async () => {
  const l = await layout();
  await putDisposition(l, [
    '| AGY-01 | gemini | major | 接受 | 成立 | §1 |',
    '| AGY-02 | gemini | minor | 驳回 | 不成立 | 不改 |',
    '| GLM-03 | glm | minor | 驳回 | 不成立 | 不改 |',
  ]);
  const r = await checkAdjudication({
    ...base, layout: l, expectedDegradedIds: ['GLM-03', 'AGY-02'],
    reviews: { gemini: review([{ id: 'AGY-01' }]), glm: review([]) },
  });
  const w = r.warnings.find((x) => x.code === 'degraded_findings');
  assert.ok(w, renderGateResult(r));
  assert.deepEqual(w!.ids, ['AGY-02', 'GLM-03']);
  assert.match(w!.message, /不参与阻断与共同阻断/);
});

// ── loadRoundReviews：降级编号的来源与旧留痕重试（计划 r2 §3.4、§3.6） ──

function runMeta(runId: string, critics: Partial<Record<CriticId, Partial<RunMeta['critics'][CriticId]>>>): RunMeta {
  const m = newRunMeta({
    runId, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'x', promptHint: null, taskGoal: null,
    criticsSelected: Object.keys(critics) as CriticId[], treeHash: 'h', gitHead: null, dirty: false,
    subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  for (const [c, over] of Object.entries(critics)) {
    m.critics[c as CriticId] = {
      vendor: CRITIC_VENDOR[c as CriticId], status: 'ok', duration_s: 1, tool_calls: {}, evidence_ok: true, heterogeneous: true,
      exit_code: 0, cli_version: null, model_requested: null, model_effective: null, model_effective_source: 'unverified',
      profile_requested: null, model_provider: null,
      ...over,
    } as RunMeta['critics'][CriticId];
  }
  return m;
}

test('G7 降级编号取自 run.json 的 findings_degraded', async () => {
  const l = await layout();
  await writeRunMeta(l, 'plan', runMeta('RD1', { gemini: { findings_degraded: ['AGY-02', 'AGY-03'] } }));
  await writeMeta(l, 'plan', 'review-gemini-RD1.json', JSON.stringify(review([{ id: 'AGY-01' }])));
  const lr = await loadRoundReviews(l, 'plan', 'RD1');
  assert.deepEqual(lr.expectedDegradedIds, ['AGY-02', 'AGY-03']);
  assert.deepEqual(lr.reviews.gemini?.findings.map((f) => f.id), ['AGY-01']);
  assert.ok(lr.notes.some((n) => n.includes('逐条降级')), lr.notes.join('\n'));
});

test('G8 run.json 读不出时退而读旁路 .degraded.json', async () => {
  const l = await layout();
  await writeMeta(l, 'plan', 'review-gemini-RD2.json', JSON.stringify(review([{ id: 'AGY-01' }])));
  await writeMeta(l, 'plan', 'review-gemini-RD2.degraded.json', JSON.stringify({
    critic: 'gemini', run_id: 'RD2',
    findings: [{ index: 1, id: 'AGY-02', problems: [{ field: 'confidence', kind: 'missing', message: 'm' }], raw: {} }],
  }));
  const lr = await loadRoundReviews(l, 'plan', 'RD2');
  assert.deepEqual(lr.expectedDegradedIds, ['AGY-02']);
});

function fallbackJson(raw: string): string {
  return JSON.stringify({ parse_fallback: true, raw });
}

const ECHOED = JSON.stringify({ ...review([{ id: 'GLM-01' }, { id: 'GLM-02' }]), topic: TOPIC, stage: 'plan', role: 'glm' });
const PARTIAL = JSON.stringify({
  ...review([{ id: 'GLM-01' }]),
  findings: [finding({ id: 'GLM-01' }), { ...finding({ id: 'GLM-02' }), confidence: undefined, severity: 'medium' }],
});

test('G9 旧留痕重试：只因回显字段回退的结论 ⇒ 全合格，按结构化校验（既有行为）', async () => {
  const l = await layout();
  await writeRunMeta(l, 'plan', runMeta('RF1', { glm: { status: 'parse_fallback', parse_fallback: true } }));
  await writeMeta(l, 'plan', 'review-glm-RF1.json', fallbackJson(ECHOED));
  await writeMeta(l, 'plan', 'review-glm-RF1.fallback-items.md', '# x\n\n- GLM-F01: 一段\n- GLM-F02: 两段\n');
  const lr = await loadRoundReviews(l, 'plan', 'RF1');
  assert.deepEqual(lr.reviews.glm?.findings.map((f) => f.id), ['GLM-01', 'GLM-02']);
  assert.deepEqual(lr.expectedFallbackIds, []);
  assert.ok(lr.notes.some((n) => n.includes('口径差')), lr.notes.join('\n'));
});

test('G10〔回归〕旧留痕重试：部分合格 ⇒ 仍按 F 编号（该轮没有逐条降级留痕）', async () => {
  const l = await layout();
  await writeRunMeta(l, 'plan', runMeta('RF2', { glm: { status: 'parse_fallback', parse_fallback: true } }));
  await writeMeta(l, 'plan', 'review-glm-RF2.json', fallbackJson(PARTIAL));
  await writeMeta(l, 'plan', 'review-glm-RF2.fallback-items.md', '# x\n\n- GLM-F01: 一段\n- GLM-F02: 两段\n');
  const lr = await loadRoundReviews(l, 'plan', 'RF2');
  assert.equal(lr.reviews.glm, null);
  assert.deepEqual(lr.expectedFallbackIds, ['GLM-F01', 'GLM-F02']);
  assert.deepEqual(lr.expectedDegradedIds ?? [], [], '旧留痕不产生降级期望');
});

test('G10′ 部分合格维持回退口径时 note 说清原因', async () => {
  const l = await layout();
  await writeRunMeta(l, 'plan', runMeta('RF3', { glm: { status: 'parse_fallback', parse_fallback: true } }));
  await writeMeta(l, 'plan', 'review-glm-RF3.json', fallbackJson(PARTIAL));
  await writeMeta(l, 'plan', 'review-glm-RF3.fallback-items.md', '# x\n\n- GLM-F01: 一段\n');
  const lr = await loadRoundReviews(l, 'plan', 'RF3');
  assert.ok(lr.notes.some((n) => n.includes('1 条逐条降级') && n.includes('维持回退口径')), lr.notes.join('\n'));
});

test('G11 旧留痕重试：解析得出但编号前缀不属于本侧 ⇒ 仍按 F 编号（与 review.ts 同一道后盾）', async () => {
  const l = await layout();
  await writeRunMeta(l, 'plan', runMeta('RF4', { glm: { status: 'parse_fallback', parse_fallback: true } }));
  await writeMeta(l, 'plan', 'review-glm-RF4.json', fallbackJson(JSON.stringify(review([{ id: 'AGY-01' }]))));
  await writeMeta(l, 'plan', 'review-glm-RF4.fallback-items.md', '# x\n\n- GLM-F01: 一段\n');
  const lr = await loadRoundReviews(l, 'plan', 'RF4');
  assert.equal(lr.reviews.glm, null, '冒名编号不得经重试进结构化期望集');
  assert.deepEqual(lr.expectedFallbackIds, ['GLM-F01']);
});
