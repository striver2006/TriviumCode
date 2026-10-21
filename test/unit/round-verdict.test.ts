/**
 * 整体三态判定（2026-10-22 多轮评审特性）的纯函数层。
 *
 * 聚合规则（fail-closed）逐格：50% 恰好、三档皆不达的兜底取保守档（用户 2026-10-21 拍板，
 * 取代初版「兜底判 fail 烧轮」）、verdict 不可读计 reject、作废侧剔除分母、missingSides 计 reject、
 * 空集判 fail。`checkNextPlan` 的判定强化（非 pass 时零接受也要求新一轮计划）走盘上布局，
 * 与 test/unit/plan-final-gate.test.ts 同款（不起子进程）。集成侧见 round-verdict-loop.test.ts。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { aggregateRoundVerdict, checkNextPlan } from '../../src/trivium/gate.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { stageDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { CriticId, Finding, Review } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '三态判定';
const DATE = '2026-10-22';

function review(verdict: Review['verdict']): Review {
  return {
    schema: 'trivium.review.v2', verdict,
    summary: '总判断若干字，足够长以通过完整性检查。',
    findings: [] as Finding[],
    not_covered: ['x'], consulted: ['src/a.ts'],
  };
}

const agg = (o: {
  reviews: Partial<Record<CriticId, Review | null>>;
  missingSides?: CriticId[];
  voidedSides?: CriticId[];
  rerunIndex?: number;
  limit?: number;
}) => aggregateRoundVerdict({
  reviews: o.reviews,
  missingSides: o.missingSides ?? [],
  voidedSides: o.voidedSides ?? [],
  rerunIndex: o.rerunIndex ?? 1,
  limit: o.limit ?? 3,
});

test('RV1 · reject 恰 50% 即判 fail（优先级最高，两家一对一也是不通过）', () => {
  const r = agg({ reviews: { gemini: review('reject'), glm: review('approve') } });
  assert.equal(r.decision, 'fail');
  assert.deepEqual(r.tallies, { approve: 1, approve_after_changes: 0, reject: 1 });
  assert.equal(r.effective_sides, 2);
});

test('RV2 · reject 不足 50%、approve-after-changes 恰 50% → pass_after_changes', () => {
  const r = agg({ reviews: { gemini: review('approve-after-changes'), glm: review('approve') } });
  assert.equal(r.decision, 'pass_after_changes');
});

test('RV3 · 三档皆不达 50%（3 家 1:1:1）→ 兜底取保守档 pass_after_changes，不烧轮', () => {
  const r = agg({
    reviews: { gemini: review('reject'), glm: review('approve-after-changes'), claude: review('approve') },
  });
  assert.equal(r.decision, 'pass_after_changes');
  assert.equal(r.effective_sides, 3);
});

test('RV4 · approve 过半 → pass', () => {
  const r = agg({
    reviews: { gemini: review('approve'), glm: review('approve'), claude: review('reject') },
  });
  assert.equal(r.decision, 'pass');
});

test('RV5 · verdict 不可读（parse_fallback / null）计入分母且计为 reject，并点名', () => {
  const r = agg({ reviews: { gemini: review('approve'), glm: null } });
  assert.equal(r.decision, 'fail'); // 1/2 reject = 50%
  assert.deepEqual(r.unreadable_as_reject, ['glm']);
});

test('RV6 · 作废侧剔除分母：一家 reject 被判作废后，另一家 approve 即 pass', () => {
  const r = agg({ reviews: { gemini: review('reject'), glm: review('approve') }, voidedSides: ['gemini'] });
  assert.equal(r.decision, 'pass');
  assert.equal(r.effective_sides, 1);
});

test('RV7 · 结论读不到的侧（missingSides）计 reject——留痕被动过不等于没人反对', () => {
  const r = agg({ reviews: { gemini: review('approve') }, missingSides: ['glm'] });
  assert.equal(r.decision, 'fail');
  assert.deepEqual(r.unreadable_as_reject, ['glm']);
});

test('RV8 · 有效侧为空（全作废）→ fail（0≥0 命中第一档）', () => {
  const r = agg({ reviews: { gemini: review('approve'), glm: review('approve') }, voidedSides: ['gemini', 'glm'] });
  assert.equal(r.decision, 'fail');
  assert.equal(r.effective_sides, 0);
});

test('RV9 · 单侧（--allow-single 类形态）：一侧 approve-after-changes 即 pass_after_changes', () => {
  const r = agg({ reviews: { gemini: review('approve-after-changes') } });
  assert.equal(r.decision, 'pass_after_changes');
});

test('RV10 · 轮次与上限原样透传（round/limit 供停点分叉与输出用）', () => {
  const r = agg({ reviews: { gemini: review('reject') }, rerunIndex: 3, limit: 10 });
  assert.equal(r.round, 3);
  assert.equal(r.limit, 10);
});

// ─────────────── checkNextPlan 的判定强化（盘上，零接受项分支） ───────────────

async function layout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-rv-');
  const l = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
  await fs.mkdir(stageDir(l, 'plan'), { recursive: true });
  return l;
}

test('RV11 · 整体判 fail 且零接受项 → 仍要求新一轮完整计划（missing_next_plan）', async () => {
  const l = await layout();
  const np = await checkNextPlan({
    layout: l, driver: 'claude', rerunIndex: 1, acceptedIds: [],
    planFinal: { subjectRerunIndex: 1, laterSubjectRerunIndexes: [] },
    decision: 'fail',
  });
  assert.equal(np.failures[0]?.code, 'missing_next_plan');
  assert.ok(np.failures[0]!.message.includes('即使没有接受项也必须产出新一轮完整计划'), np.failures[0]!.message);
});

test('RV12 · 判 pass_after_changes 且零接受项 → 同样要求（保守档也要按意见修订）', async () => {
  const l = await layout();
  const np = await checkNextPlan({
    layout: l, driver: 'claude', rerunIndex: 1, acceptedIds: [],
    planFinal: { subjectRerunIndex: 1, laterSubjectRerunIndexes: [] },
    decision: 'pass_after_changes',
  });
  assert.equal(np.failures[0]?.code, 'missing_next_plan');
});

test('RV13 · 判 pass 且零接受项 → 不要求（全部驳回、计划原样进实施＝旧行为）', async () => {
  const l = await layout();
  const np = await checkNextPlan({
    layout: l, driver: 'claude', rerunIndex: 1, acceptedIds: [],
    planFinal: { subjectRerunIndex: 1, laterSubjectRerunIndexes: [] },
    decision: 'pass',
  });
  assert.equal(np.failures.length, 0);
});

test('RV14 · decision 缺席（历史轮次）且零接受项 → 不要求（不追溯）', async () => {
  const l = await layout();
  const np = await checkNextPlan({
    layout: l, driver: 'claude', rerunIndex: 1, acceptedIds: [],
    planFinal: { subjectRerunIndex: 1, laterSubjectRerunIndexes: [] },
    decision: null,
  });
  assert.equal(np.failures.length, 0);
});

test('RV15 · 判 fail、零接受项、新一轮计划在 → 通过（不因零接受转红）', async () => {
  const l = await layout();
  await fs.writeFile(
    path.join(stageDir(l, 'plan'), `${DATE}-${TOPIC}-r2-claude.md`),
    ['# 计划 r2', '', '相对上一轮的改动：按整体意见演进。', ''].join('\n'),
    'utf8',
  );
  const cfg = defaultConfig();
  void cfg; // checkNextPlan 不读配置，占位保持与其它用例同构
  const np = await checkNextPlan({
    layout: l, driver: 'claude', rerunIndex: 1, acceptedIds: [],
    planFinal: { subjectRerunIndex: 1, laterSubjectRerunIndexes: [] },
    decision: 'fail',
  });
  assert.equal(np.failures.length, 0);
  assert.equal(np.warnings.length, 0);
});
