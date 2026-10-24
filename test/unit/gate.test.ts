import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  APPROVAL_CHECK_META_UNREADABLE, APPROVAL_CHECK_NO_RUN_ID,
  checkAdjudication, classifyReadonlyBreach, findJointRejectedBlockers, formatJointGroups, readonlyBreachLabel, jointCheckState, isHollowReason, loadRoundReviews, renderGateResult,
  verifyRoundForApproval,
} from '../../src/trivium/gate.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { newRunMeta, summarizeRun, writeRunMeta } from '../../src/trivium/meta.js';
import { CRITICS } from '../../src/trivium/types.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { writeArtifact, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { Finding, Review } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const DATE = '2026-09-10';
const TOPIC = '登录重构';
/** 编排器状态文件名（`state.ts` 的落点），用作「告警档」分类的样本路径 */
const STATE_FILE = 'state.json';

async function layout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-gate-');
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

/** 落一份裁决件到 plan 阶段 */
async function putDisposition(l: ArchiveLayout, table: string, rerunIndex = 1, fmOver = ''): Promise<void> {
  const md = `---
schema: trivium.disposition.v1
topic: ${TOPIC}
stage: plan
role: claude
kind: revised
run_id: R1
addresses:
  - ${DATE}-${TOPIC}-gemini.md
${fmOver}---

# 修订计划

${table}
`;
  await writeArtifact({
    layout: l, stage: 'plan', role: 'claude', writer: 'driver',
    kind: 'revised', rerunIndex, content: md, date: DATE,
  });
}

const HEAD = `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |`;

test('全部裁决齐备 → 通过', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 确认成立 | §3.2 |
| GLM-01 | glm | minor | 驳回 | 上游已拒绝该分支 | 不改 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]), glm: review([{ id: 'GLM-01', severity: 'minor' }]) },
    degraded: false,
  });
  assert.equal(r.ok, true, renderGateResult(r));
});

test('缺裁决件 → missing_disposition，并提示即使全驳回也要产出', async () => {
  const l = await layout();
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.failures[0]?.code, 'missing_disposition');
  assert.match(r.failures[0]!.message, /无修改及原因/);
});

test('删掉一条裁决 → missing_findings 并列出编号（AC-12）', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }, { id: 'AGY-02' }]) }, degraded: false,
  });
  assert.equal(r.ok, false);
  const f = r.failures.find((x) => x.code === 'missing_findings');
  assert.deepEqual(f?.ids, ['AGY-02']);
});

/*
 * EV-30 ⑤（M11 第 8 步，2026-10-08）：`gate.require_adjudication` 删除——它从未被读取，接线等于给闸门核心判据
 * 加一个关闭开关。schema 仍接受它，所以旧配置里可能还写着 false；这一格锁住「写了 false 也不放松」。
 */
test('EV-30 ⑤：旧配置里 gate.require_adjudication: false 不放松逐条裁决——漏裁照样 missing_findings', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const cfg = structuredClone(defaultConfig());
  (cfg.gate as unknown as Record<string, unknown>)['require_adjudication'] = false;
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }, { id: 'AGY-02' }]) }, degraded: false,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.find((x) => x.code === 'missing_findings')?.ids, ['AGY-02']);
});

test('裁决了不存在的编号 → unknown_findings', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |
| AGY-99 | gemini | major | 接受 | 抄错了 | §4 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  const f = r.failures.find((x) => x.code === 'unknown_findings');
  assert.deepEqual(f?.ids, ['AGY-99']);
});

test('AGY-04 的关键点：fallback 虚拟编号不被判「多余 id」', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |
| GLM-F01 | fallback | — | 接受 | 降级侧第一条意见，确认成立 | — |
| GLM-F02 | fallback | — | 驳回 | 降级侧第二条，已被上游覆盖 | — |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    // glm 侧 parse_fallback，没有结构化 findings
    reviews: { gemini: review([{ id: 'AGY-01' }]), glm: null }, degraded: false,
    expectedFallbackIds: ['GLM-F01', 'GLM-F02'],
  });
  assert.equal(r.ok, true, renderGateResult(r));
  assert.deepEqual(r.fallbackIds.sort(), ['GLM-F01', 'GLM-F02']);
});

/*
 * ── fallback 编号也要逐条对账（§6.6 规则 8）──
 *
 * 原先 fallback 行只在出现时被校验、从不被要求出现：两侧都解析降级时
 * structuredIds 为空，一张只有表头的裁决表就能过闸——而「两侧都降级」恰恰是
 * 最容易被制造出来的状态。
 */
test('fallback 单元少裁一条 → missing_findings 点名 <前缀>-F<n>', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| GLM-F01 | fallback | — | 接受 | 确认成立 | — |
| GLM-F02 | fallback | — | 驳回 | 上游已覆盖 | — |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { glm: null }, degraded: false,
    expectedFallbackIds: ['GLM-F01', 'GLM-F02', 'GLM-F03'],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.find((x) => x.code === 'missing_findings')?.ids, ['GLM-F03']);
});

test('关键用例：两侧都 parse_fallback 时空裁决表不得通过', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: null, glm: null }, degraded: false,
    expectedFallbackIds: ['AGY-F01', 'GLM-F01'],
  });
  assert.equal(r.ok, false, '两侧共 2 条降级单元待裁决，空表必须失败');
  assert.ok(r.failures.some((x) => x.code === 'unparsable_table'), renderGateResult(r));
  assert.match(renderGateResult(r), /含 2 条降级编号/);
});

test('裁了清单之外的 fallback 编号 → unknown_findings', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| GLM-F01 | fallback | — | 接受 | 确认成立 | — |
| GLM-F07 | fallback | — | 驳回 | 编号抄错了 | — |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { glm: null }, degraded: false, expectedFallbackIds: ['GLM-F01'],
  });
  assert.deepEqual(r.failures.find((x) => x.code === 'unknown_findings')?.ids, ['GLM-F07']);
});

test('run.json 记录已产出结论、结构化结论却读不到 → missing_review_json', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
    missingSides: ['glm'],
  });
  assert.equal(r.ok, false, '结论文件是唯一事实来源，缺了不能当「该侧无意见」放行');
  const f = r.failures.find((x) => x.code === 'missing_review_json');
  assert.match(f!.message, /glm/);
  /*
   * 恢复与重跑两个出口都要给（M10a 第 2 步 EV-55 §3.2.2；代码双审 r2 CODEX-04
   * 推翻了「只留重跑一轮」）：该文件登记在本 run 的 artifacts[] 里，重跑解不开
   * 提交锚②，恢复是必经步骤——恢复命令的目标含 `_meta`，所以要明说在终端执行。
   */
  assert.match(f!.message, /git restore/);
  assert.match(f!.message, /终端/);
  assert.match(f!.message, /重跑一轮/);
  assert.match(f!.message, /解不开提交锚/);
});

test('run.json 的 gate.warnings 作为 run_warning 透传，缺裁决件的早退路径也带着（代码双审 r2 GLM-04）', async () => {
  const l = await layout();
  const notice = '本轮原稿不在保护集：/proj/doc/x.md 不在归档根内，提交锚不覆盖它';
  // 没有裁决件：checkAdjudication 走 missing_disposition 早退
  const early = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
    runWarnings: [notice],
  });
  assert.equal(early.failures[0]?.code, 'missing_disposition');
  assert.deepEqual(early.warnings.filter((w) => w.code === 'run_warning').map((w) => w.message), [notice]);

  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const full = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
    runWarnings: [notice],
  });
  assert.equal(full.ok, true, JSON.stringify(full.failures));
  assert.deepEqual(full.warnings.filter((w) => w.code === 'run_warning').map((w) => w.message), [notice]);
});

test('AGY-04 的关键点：fallback 侧只要求有裁决与理由，不要求落点', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| GLM-F01 | fallback | — | 接受 | 确认成立 | |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { glm: null }, degraded: false, expectedFallbackIds: ['GLM-F01'],
  });
  assert.equal(r.ok, true, `fallback 侧不应因缺落点而失败：${renderGateResult(r)}`);
});

test('AGY-04 的关键点：findings 为空数组显式合法', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| — | — | — | — | 两侧均未发现问题，无需裁决 | — |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([]), glm: review([]) }, degraded: false,
  });
  assert.equal(r.ok, true, `空审不应判失败：${renderGateResult(r)}`);
  assert.deepEqual(r.structuredIds, []);
});

test('理由为空 → empty_reason（三种裁决都要理由）', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 驳回 |  | 不改 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.deepEqual(r.failures.find((x) => x.code === 'empty_reason')?.ids, ['AGY-01']);
});

test('接受但无落点 → missing_action', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 确认成立 | |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.deepEqual(r.failures.find((x) => x.code === 'missing_action')?.ids, ['AGY-01']);
});

test('驳回不要求落点', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 驳回 | 上游已处理，证据 src/x.ts:31 | |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.equal(r.ok, true, renderGateResult(r));
});

test('空洞理由默认只 warn（reason_policy=warn）', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 驳回 | 无需修改 | |`);
  const cfg = defaultConfig();
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.equal(r.ok, true, '默认策略下空洞理由不阻断');
  assert.ok(r.warnings.some((w) => w.code === 'weak_reason'));
});

test('reason_policy=hard 时空洞理由升级为失败', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 驳回 | 不适用 | |`);
  const cfg = defaultConfig();
  cfg.gate.reason_policy = 'hard';
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.equal(r.ok, false);
});

test('allow_defer=false 时「暂缓」被拒', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 暂缓 | 等依赖升级 | 遗留风险 |`);
  const cfg = defaultConfig();
  cfg.gate.allow_defer = false;
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.deepEqual(r.failures.find((x) => x.code === 'defer_not_allowed')?.ids, ['AGY-01']);
});

test('裁决件的 run_id 与本轮不符 → bad_front_matter（不得复用上一轮的裁决件）', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, runId: 'R2',
  });
  const f = r.failures.find((x) => x.code === 'bad_front_matter');
  assert.ok(f, renderGateResult(r));
  assert.match(f!.message, /run_id=R1/);
  assert.match(f!.message, /R2/);
});

test('front-matter 与本轮不匹配 → bad_front_matter', async () => {
  const l = await layout();
  const md = `---
schema: trivium.disposition.v1
topic: 别的主题
stage: code
role: claude
kind: response
run_id: R1
addresses: []
---

${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |
`;
  await writeArtifact({
    layout: l, stage: 'plan', role: 'claude', writer: 'driver',
    kind: 'revised', rerunIndex: 1, content: md, date: DATE,
  });
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  const f = r.failures.find((x) => x.code === 'bad_front_matter');
  assert.ok(f, renderGateResult(r));
  assert.match(f!.message, /topic=别的主题/);
  assert.match(f!.message, /stage=code/);
  assert.match(f!.message, /kind=response/);
  assert.match(f!.message, /addresses 为空/);
});

/*
 * ───────── N-2：放宽 role 之后，作者身份只剩这一道判据 ─────────
 *
 * EV-66 把 `disposition.v1.json` 的 `role` 从 `const: "claude"` 放宽成
 * 「任意已登记 Agent」。放宽前后各有一句容易说错的话，先把它们摆正：
 *
 *   · **不是「两道锁变一道」。** schema 的 `const` 从来不证明作者是谁——
 *     它只是逼非缺省 Driver 谎报。放宽后「声明的作者 == 当轮 Driver」
 *     这条性质完整保留（`gate.ts` 的 role↔driver 比对），并新增了
 *     「声明的作者必须是已登记 Agent」（`validateDispositionFrontMatter`）。
 *   · **真正变了的是验证覆盖。** 那条比对是上一个主题第 3 轮才写的，
 *     此前只被 T-11 一条集成用例验过，本文件 30 余条用例**无一条传 `driver`**
 *     （全走缺省回落，缺省下 role 恒等于 driver，比对永远成立）。
 *     所以下面两格补的是**验证缺口**，不是补一道消失的锁（计划双审 CODEX-F01 第 1 条附带纠正）。
 *
 * 两格都**显式传 `driver`**：`GateCheckInput.driver` 今天仍是可选项、缺省回落
 * 缺省 Driver，依赖回落会让本用例在「判据没跑」时照样绿（同文件 `voidedSides`
 * 那次教训的形状）。可选参数本身已登记 BACKLOG，这里先不依赖它。
 */

/**
 * 直写一份裁决件，**文件名后缀与 front-matter 的 role 分别可控**。
 *
 * 不走 `writeArtifact`：它按 `roleIsAllowedForWriter` 校后缀，而那个判据的
 * `driver` 参数在 `archive.ts` 的调用点没传、恒取缺省值，落不出 `-revised-codex.md`
 * （EV-55 族，不在本步范围）。T-11 出于同样的原因也是直写。
 */
async function putDispositionAs(
  l: ArchiveLayout,
  opts: { suffix: string; fmRole: string; table: string; runId?: string },
): Promise<void> {
  const dir = path.join(l.archiveRoot, l.topic, 'plan');
  await fs.mkdir(dir, { recursive: true });
  const md = `---
schema: trivium.disposition.v1
topic: ${TOPIC}
stage: plan
role: ${opts.fmRole}
kind: revised
run_id: ${opts.runId ?? 'R1'}
addresses:
  - ${DATE}-${TOPIC}-gemini.md
---

# 修订计划

${opts.table}
`;
  await fs.writeFile(path.join(dir, `${DATE}-${TOPIC}-revised-${opts.suffix}.md`), md, 'utf8');
}

const ROW_OK = `| AGY-01 | gemini | major | 接受 | 成立 | §3 |`;

test('N-2：文件名后缀是当轮 Driver、front-matter 的 role 是另一个已登记 id → bad_front_matter', async () => {
  const l = await layout();
  await putDispositionAs(l, { suffix: 'codex', fmRole: 'glm', table: `${HEAD}\n${ROW_OK}` });
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1, driver: 'codex',
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, runId: 'R1',
  });
  const f = r.failures.find((x) => x.code === 'bad_front_matter');
  assert.ok(
    f,
    '这份裁决件的文件名说是 codex 写的、front-matter 说是 glm 写的，作者身份自相矛盾却通过了闸门。' +
      `放宽 role 之后这是唯一在看这件事的判据。\n${renderGateResult(r)}`,
  );
  assert.match(
    f!.message, /role=glm/,
    '失败原因里没点名 role：本格要证的正是作者身份这一格被验到了，失败在别处等于没验到',
  );
});

test('N-2 正例：非缺省 Driver 诚实写自己的 id → 通过（EV-66 的全部目的）', async () => {
  const l = await layout();
  await putDispositionAs(l, { suffix: 'codex', fmRole: 'codex', table: `${HEAD}\n${ROW_OK}` });
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1, driver: 'codex',
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, runId: 'R1',
  });
  assert.deepEqual(
    r.failures, [],
    '非缺省 Driver 诚实写出的裁决件必须过闸门。过不了就说明放宽没落到实处——' +
      `它只剩谎报或产出定位不到两条路，而闸门闭环一次都跑不完。\n${renderGateResult(r)}`,
  );
});

/*
 * 这一格锁的是「闸门对未登记 id 仍 fail-closed」，**不是「注册表校验跑了」**。
 *
 * 区别是**双向实测**出来的，两次变异各跑一遍：
 *   · 删掉 `checkDispositionRole` → N-1 两格红，**本格绿**（role↔driver 比对拦的）；
 *   · 删掉 `gate.ts` 的 role↔driver 比对 → N-2 第一格与 T-11 第 2 格红，**本格还是绿**
 *     （`checkDispositionRole` 拦的）。
 * 也就是说未登记 id 这条路径上**两道判据完全冗余**，删任何一道本格都绿。
 * 它因此证不了任何**单一**机制在工作——只证得了「两道之中至少还有一道活着」。
 *
 * 那它还有没有价值？有，但要如实说清：它守的是**结果**（未登记 id 进不了闸门），
 * 而不是**机制**（哪一道拦的）。机制那一格由 `config-schema.test.ts` 的 N-1 守，
 * 那里直接调校验函数、没有 driver 比对在旁边。
 * 写成「本格证明注册表校验生效」就是把断言的适用范围悄悄扩大了。
 */
test('N-2 边界：role 是未登记的 id → bad_front_matter（闸门层 fail-closed，不区分是哪道判据拦的）', async () => {
  const l = await layout();
  await putDispositionAs(l, { suffix: 'codex', fmRole: 'nobody', table: `${HEAD}\n${ROW_OK}` });
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1, driver: 'codex',
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, runId: 'R1',
  });
  const f = r.failures.find((x) => x.code === 'bad_front_matter');
  assert.ok(f, `role 写了个注册表里没有的名字，仍然过闸门——契约就是净放松的\n${renderGateResult(r)}`);
  assert.match(f!.message, /role/, f!.message);
});

// ── 共同 blocker（§6.6 规则 7）──

test('双方共同 blocker 被驳回：默认只 warn，且只用 location 精确相同判定', () => {
  const reviews = {
    gemini: review([{ id: 'AGY-01', severity: 'blocker' as const, location: 'src/a.ts:88' }]),
    glm: review([{ id: 'GLM-01', severity: 'blocker' as const, location: 'src/a.ts:88' }]),
  };
  const rows = [
    { id: 'AGY-01', source: 'gemini' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
    { id: 'GLM-01', source: 'glm' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
  ];
  const joint = findJointRejectedBlockers(reviews, rows);
  assert.equal(joint.length, 1);
  assert.deepEqual(joint[0]?.ids.sort(), ['AGY-01', 'GLM-01']);
});

test('位置不同的 blocker 不算共同（不做文本相似度，避免启发式误判卡死闸门）', () => {
  const reviews = {
    gemini: review([{ id: 'AGY-01', severity: 'blocker' as const, location: 'src/a.ts:88' }]),
    glm: review([{ id: 'GLM-01', severity: 'blocker' as const, location: 'src/a.ts:89' }]),
  };
  const rows = [
    { id: 'AGY-01', source: 'gemini' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
    { id: 'GLM-01', source: 'glm' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
  ];
  assert.deepEqual(findJointRejectedBlockers(reviews, rows), []);
});

/*
 * ── 作废侧不计入独立来源，以及「没做」必须与「做了没发现」分开 ──
 *
 * 不排除作废侧会出现方向完全相反的后果：**一个本应作废的审查员反而获得了
 * 逼停流水线的否决权**——它提的 blocker 与另一侧凑成「共同」，Driver 驳回时闸门当场拦人。
 *
 * 而排除之后有效侧可能不足两家，`critics.size < 2` 让这一档恒返回空集。
 * 若不记三态，「查过、没有共同项」与「有效侧不足、根本没做」在留痕里完全一样
 * ——三态纪律在本主题内的第四次复发。
 */

const TWO_SIDED = {
  gemini: review([{ id: 'AGY-01', severity: 'blocker' as const, location: 'src/a.ts:88' }]),
  glm: review([{ id: 'GLM-01', severity: 'blocker' as const, location: 'src/a.ts:88' }]),
};
const TWO_ROWS = [
  { id: 'AGY-01', source: 'gemini' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
  { id: 'GLM-01', source: 'glm' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
];

test('作废侧不计入独立来源——否则它反而获得了逼停流水线的否决权', () => {
  const joint = findJointRejectedBlockers(TWO_SIDED, TWO_ROWS, ['glm']);
  assert.deepEqual(
    joint,
    [],
    '排除 glm 后只剩一个独立来源，不构成「两家共同提出」——' +
      '被判泄漏的一侧不该还能靠「另一侧也这么说」把闸门拦死',
  );
});

test('三态：两家有效且有共同项 → checked-found', () => {
  const joint = findJointRejectedBlockers(TWO_SIDED, TWO_ROWS);
  const s = jointCheckState(TWO_SIDED, joint);
  assert.equal(s.state, 'checked-found');
  assert.equal(s.effective_sides, 2);
});

test('三态：两家有效但无共同项 → checked-none（查过、没发现）', () => {
  const reviews = {
    gemini: review([{ id: 'AGY-01', severity: 'blocker' as const, location: 'src/a.ts:88' }]),
    glm: review([{ id: 'GLM-01', severity: 'blocker' as const, location: 'src/b.ts:1' }]),
  };
  const joint = findJointRejectedBlockers(reviews, TWO_ROWS);
  const s = jointCheckState(reviews, joint);
  assert.equal(s.state, 'checked-none');
  assert.equal(s.effective_sides, 2);
});

test('三态：排除作废侧后不足两家 → skipped，与「查过没发现」分得开', () => {
  const joint = findJointRejectedBlockers(TWO_SIDED, TWO_ROWS, ['glm']);
  const s = jointCheckState(TWO_SIDED, joint, ['glm']);
  assert.equal(
    s.state,
    'skipped-insufficient-sides',
    '这一档根本没做。若与 checked-none 落成同一个观测，' +
      '留痕里就看不出本轮少了一层防线——那正是本主题要修的病',
  );
  assert.equal(s.effective_sides, 1);
});

test('三态：阈值不随入选总数上调——三家里的两家仍是两个独立来源', () => {
  const three = {
    ...TWO_SIDED,
    codex: review([{ id: 'CODEX-01', severity: 'minor' as const, location: 'src/z.ts:1' }]),
  };
  const joint = findJointRejectedBlockers(three, TWO_ROWS, ['codex']);
  const s = jointCheckState(three, joint, ['codex']);
  assert.equal(s.state, 'checked-found', '三家排除一家后仍有两个独立来源，这一档照常做');
  assert.equal(s.effective_sides, 2);
});

test('共同 blocker 只要有一条被接受就不算「被驳回」', () => {
  const reviews = {
    gemini: review([{ id: 'AGY-01', severity: 'blocker' as const, location: 'L' }]),
    glm: review([{ id: 'GLM-01', severity: 'blocker' as const, location: 'L' }]),
  };
  const rows = [
    { id: 'AGY-01', source: 'gemini' as const, severity: 'blocker' as const, disposal: '接受' as const, reason: 'r', action: '§1' },
    { id: 'GLM-01', source: 'glm' as const, severity: 'blocker' as const, disposal: '驳回' as const, reason: 'r', action: '' },
  ];
  assert.deepEqual(findJointRejectedBlockers(reviews, rows), []);
});

test('joint_blocker_policy=hard 时升级为失败', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | blocker | 驳回 | 我不同意这条 | |
| GLM-01 | glm | blocker | 驳回 | 我也不同意 | |`);
  const cfg = defaultConfig();
  cfg.gate.joint_blocker_policy = 'hard';
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: {
      gemini: review([{ id: 'AGY-01', severity: 'blocker', location: 'src/a.ts:88' }]),
      glm: review([{ id: 'GLM-01', severity: 'blocker', location: 'src/a.ts:88' }]),
    },
    degraded: false,
  });
  assert.ok(r.failures.some((x) => x.code === 'joint_blocker_rejected'), renderGateResult(r));
  assert.equal(r.disputedJointBlockers, undefined, 'hard 阻断不放行，不给要写进争议明细的那一组（发版-02）');
});

// ── 被放行的共同驳回（发版-02）──

test('formatJointGroups：组内 + 连接、组间「；」连接', () => {
  assert.equal(
    formatJointGroups([
      { location: 'src/a.ts:1', ids: ['AGY-01', 'GLM-01'] },
      { location: 'src/b.ts:2', ids: ['CODEX-02', 'GLM-03', 'AGY-04'] },
    ]),
    'AGY-01+GLM-01@src/a.ts:1；CODEX-02+GLM-03+AGY-04@src/b.ts:2',
  );
  assert.equal(formatJointGroups([]), '');
});

async function jointRun(disposals: [string, string], policy: 'warn' | 'hard' = 'warn') {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | blocker | ${disposals[0]} | 我不同意这条 | ${disposals[0] === '接受' ? '§1' : ''} |
| GLM-01 | glm | blocker | ${disposals[1]} | 我也不同意 | ${disposals[1] === '接受' ? '§1' : ''} |`);
  const cfg = defaultConfig();
  cfg.gate.joint_blocker_policy = policy;
  return checkAdjudication({
    planFinal: null,
    expectedDegradedIds: [],
    reviewDocs: null,
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: {
      gemini: review([{ id: 'AGY-01', severity: 'blocker', location: 'src/a.ts:88' }]),
      glm: review([{ id: 'GLM-01', severity: 'blocker', location: 'src/a.ts:88' }]),
    },
    degraded: false,
  });
}

test('warn 下共同驳回 ⇒ disputedJointBlockers 给出分组，告警文案与 note 同一写法', async () => {
  const r = await jointRun(['驳回', '驳回']);
  assert.deepEqual(r.disputedJointBlockers, [{ location: 'src/a.ts:88', ids: ['AGY-01', 'GLM-01'] }]);
  const w = r.warnings.find((x) => x.code === 'joint_blocker_rejected');
  assert.ok(w?.message.endsWith('AGY-01+GLM-01@src/a.ts:88'), w?.message);
});

test('没有共同驳回 ⇒ disputedJointBlockers 缺席', async () => {
  const r = await jointRun(['接受', '驳回']);
  assert.equal(r.disputedJointBlockers, undefined);
});

// ── 空洞理由词表 ──

test('空洞词表判定：只有整条理由都是空洞词才算', () => {
  assert.equal(isHollowReason('无需修改'), true);
  assert.equal(isHollowReason('不适用。'), true);
  assert.equal(isHollowReason('已知悉'), true);
  assert.equal(isHollowReason('N/A'), true);
  assert.equal(isHollowReason('无需修改，因为该分支在 src/x.ts:31 已被上游拒绝'), false);
  assert.equal(isHollowReason(''), false, '空理由由 empty_reason 单独管');
});

test('渲染结果在失败时列出编号，便于 Driver 直接照着补', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }, { id: 'AGY-02' }, { id: 'AGY-03' }]) },
    degraded: false,
  });
  const out = renderGateResult(r);
  assert.match(out, /missing_findings/);
  assert.match(out, /AGY-02, AGY-03/);
});

/*
 * ── 降级轮次的显形（M7b 第 1 步 §2.2）──
 *
 * 这两例针对的是本轮改动**自身**的测试盲区：`degraded` 此前生产侧算死值
 * （`Object.values(reviews).some((r) => r === undefined)` 恒为 false）、消费侧不读，
 * 而既有 21 个 checkAdjudication 用例**一律传 `degraded: false`**——
 * 把整段 degraded_round 逻辑删掉，测试照样全绿（审查意见 AGY-01）。
 */

test('降级轮次出 warning 而非 failure：闸门仍放行，但审计面上看得见', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 确认成立 | §3.2 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) },
    degraded: true,
  });

  /*
   * `ok` 必须仍为 true：降级是关于**运行**的事实，Driver 改裁决件修不掉它。
   * 这条断言锁住的是那个刻意的强弱选择——日后若有人把它改成 failure，
   * 合法的 degrade / --allow-single 路径会变成不可满足的死闸门。
   */
  assert.equal(r.ok, true, renderGateResult(r));
  assert.ok(
    r.warnings.some((w) => w.code === 'degraded_round'),
    `降级轮次必须留下 degraded_round 警告，实得：${JSON.stringify(r.warnings)}`,
  );
});

test('非降级轮次不得凭空冒出 degraded_round 警告', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 确认成立 | §3.2 |`);
  const r = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) },
    degraded: false,
  });
  assert.equal(r.ok, true, renderGateResult(r));
  assert.ok(!r.warnings.some((w) => w.code === 'degraded_round'));
});

/*
 * ── voidedSides 必须由 loadRoundReviews 从 run 元数据派生 ──
 *
 * 它初版是 `checkAdjudication` 的一个**可选参数**，而两个生产调用点都没传，
 * 于是「作废侧不计入共同阻断」整段从未生效——**而纯函数单测全绿**：
 * 可选参数的默认值让漏传静默成功。r1 三侧独立判为阻断，其中一侧的原话是
 * 「纯函数单测守不住『参数没接上』这一形态」。
 *
 * 所以判据改成在 `loadRoundReviews` 里派生（调用方想漏都漏不掉），
 * 而本用例守的就是那次派生——把派生删掉，它必须红。
 */
test('readonly_breach 从 run 元数据带出并进 gate --check 失败面（AD-06；M9 第 6 步代码双审 CODEX-02 ≡ AGY-02 ≡ GLM-02）', async () => {
  /*
   * 此前这一格只有渲染面：M9 第 6 步验收 run 20260919T120643Z 的 guard.readonly_breach
   * 为 true，同一轮 gate --check 照样 ok:true——真失守与假失守走同一条路。
   * 只读失守未确证改动放行（2026-10-06）起，失败面只收跑后复算确证改动的那一格。
   */
  const base = {
    topic: TOPIC, stage: 'plan' as const, rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false,
    subjectSha256: 's', denyPaths: [], driftPolicy: 'warn' as const,
  };
  const table = `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`;

  // ① 失守 + 复算确证改动 → loadRoundReviews 带出调用记录与 drift；checkAdjudication 判 failure
  const l1 = await layout();
  const m1 = newRunMeta({ ...base, runId: 'RB1' });
  m1.guard.readonly_breach = true;
  m1.guard.breached_files = ['Write(/p/breach.txt)'];
  m1.snapshot.drift = { changed: true, files: ['breach.txt'], policy: 'warn' };
  await writeRunMeta(l1, 'plan', m1);
  const rb1 = (await loadRoundReviews(l1, 'plan', 'RB1')).readonlyBreach;
  assert.deepEqual(rb1, {
    hit: true, files: ['Write(/p/breach.txt)'], drift: { changed: true, files: ['breach.txt'], policy: 'warn' },
  });
  await putDisposition(l1, table);
  const r1 = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l1, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, readonlyBreach: rb1,
  });
  assert.equal(r1.ok, false, '确证改动的只读失守必须是 failure，不是 warning——失守侧的结论不可采信');
  const f = r1.failures.find((x) => x.code === 'readonly_breach');
  assert.ok(f, renderGateResult(r1));
  assert.match(f!.message, /breach\.txt/, '按 AD-06 列出受影响的调用与复算检出的文件');
  assert.ok(f!.message.includes('复算检出：1 个文件改动：breach.txt'), f!.message);
  assert.ok(f!.message.includes('git status / git diff'), '确证格给核对清理的处置');
  assert.ok(f!.message.includes('要重跑须先作废这一轮'), f!.message);
  assert.ok(!r1.warnings.some((w) => w.code === 'readonly_breach_unconfirmed'), '确证格不再出放行告警');

  /*
   * ①′ 失守 + 复算无变化 → 放行，降为 warning（用户决策 2026-10-06）。
   *
   * 原先 :815 的正向锁 `/snapshot\.drift/` 守的是 base.ts 误杀排障指纹（`rm -rf <项目内不存在目录>`
   * 那一形态没有工作树改动，drift 为 false）。新规则下那一形态归放行格，指纹随之迁到这里：
   * 放行告警必须写出「snapshot.drift.changed 为 false」（计划双审 AGY-02 ≡ GLM-01）。
   */
  const l1b = await layout();
  const m1b = newRunMeta({ ...base, runId: 'RB1B' });
  m1b.guard.readonly_breach = true;
  m1b.guard.breached_files = ['Write(/p/breach.txt)'];
  await writeRunMeta(l1b, 'plan', m1b);
  const rb1b = (await loadRoundReviews(l1b, 'plan', 'RB1B')).readonlyBreach;
  assert.equal(rb1b.hit, true);
  await putDisposition(l1b, table);
  const r1b = await checkAdjudication({
    planFinal: null, expectedDegradedIds: [], reviewDocs: null,
    cfg: defaultConfig(), layout: l1b, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, readonlyBreach: rb1b,
  });
  assert.equal(r1b.ok, true, renderGateResult(r1b));
  assert.ok(!r1b.failures.some((x) => x.code === 'readonly_breach'));
  const w = r1b.warnings.find((x) => x.code === 'readonly_breach_unconfirmed');
  assert.ok(w, renderGateResult(r1b));
  assert.ok(w!.message.includes('snapshot.drift.changed 为 false'), '排障指纹迁到放行告警（AGY-02 ≡ GLM-01）');
  assert.ok(w!.message.includes('Write(/p/breach.txt)'), '放行告警也列调用记录');
  assert.ok(w!.message.includes('本轮结论照常进入审批'), w!.message);
  /*
   * 原否定式锁守的是「不得暗示复算能证明没写」（r3 CODEX-r3-01）。drift 单向用的口径已被用户决策推翻，
   * 但这层意思留着：放行告警必须逐条点明决策二的盲区，且不得出现「没有改动则是误报」式反推。
   */
  for (const blind of ['被 .gitignore 忽略的文件', '归档根与 .trivium/', '改了又改回', '写到项目外', 'MCP 执行型调用的任意写']) {
    assert.ok(w!.message.includes(blind), `放行告警要点名盲区「${blind}」：\n${w!.message}`);
  }
  assert.ok(w!.message.includes('未检出不等于没写'), w!.message);
  assert.doesNotMatch(w!.message, /(没有|无)改动.{0,6}(就|则|即).{0,4}(是|按).{0,6}误报/);
  // 同一否定式锁法（留痕与文案小修 r2 D6）：workTreeHash 含未忽略的未跟踪文件，「只看已跟踪」与实现相反
  assert.doesNotMatch(w!.message, /已跟踪文件被改/, 'drift 的盲区是被 .gitignore 忽略的文件，不是未跟踪文件');

  // ② 字段在场且为 false（newRunMeta 缺省）→ hit:false，闸门不失败。
  //    注意这**不是**「旧留痕无字段」：该字段两版契约必填，writeRunMeta 写前按 run.v2 校验、
  //    readRunMeta 校验不过即 null——「无字段」那格不可达（第 2 轮 CODEX-F01-②）；
  //    读不出的留痕由 missingSides 用例守，不在这里。
  const l2 = await layout();
  await writeRunMeta(l2, 'plan', newRunMeta({ ...base, runId: 'RB2' }));
  const rb2 = (await loadRoundReviews(l2, 'plan', 'RB2')).readonlyBreach;
  assert.deepEqual(rb2, { hit: false, files: [] });
  await putDisposition(l2, table);
  const r2 = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l2, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false, readonlyBreach: rb2,
  });
  assert.equal(r2.ok, true, renderGateResult(r2));
  assert.ok(!r2.warnings.some((x) => x.code === 'readonly_breach_unconfirmed'), '未失守不出放行告警');

  // ③ 漏传（可选参数缺省）→ 与 ② 同：守的是「缺省不误拦」，接线由 cli 侧两处调用点负责
  const r3 = await checkAdjudication({
    planFinal: null, // 与计划定稿无关的用例（EV-214）
    expectedDegradedIds: [],
    reviewDocs: null, // 与 addresses 无关的用例：只核非空（EV-134）
    cfg: defaultConfig(), layout: l2, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
  });
  assert.equal(r3.ok, true);
});

/*
 * 判据单点（只读失守未确证改动放行计划 r2 §2.1）：`checkAdjudication` 与 Hook 的 `roundBreach` 共用。
 * 变异 M1（不看 changed）与 M2（不看 unknown_reason）各在这张表里至少红一行。
 */
test('classifyReadonlyBreach 真值表：只有 changed 且无 unknown_reason 才是确证', () => {
  const unknown = { cause: 'object_gone' as const, detail: 'tree 已不在' };
  assert.equal(classifyReadonlyBreach({ changed: false }), 'unconfirmed_unchanged');
  assert.equal(classifyReadonlyBreach({ changed: true }), 'confirmed');
  assert.equal(classifyReadonlyBreach({ changed: true, unknown_reason: unknown }), 'unconfirmed_unknown');
  // 写侧不产出这一格（unknown_reason 只在 changed:true 时写）；手改留痕时按更弱的「比不了」说
  assert.equal(classifyReadonlyBreach({ changed: false, unknown_reason: unknown }), 'unconfirmed_unknown');
});

/*
 * EV-224：复盘面（report 旗标、summarizeRun）的失守一行按同一判据分档，文字只有 `readonlyBreachLabel` 一份。
 * 期望串写字面量；summarizeRun 那一格守接线（它不经 report，单独调标签函数）。
 */
test('EV-224：readonlyBreachLabel 三档逐字，summarizeRun 按同轮 drift 分档、未失守不出', () => {
  const unknown = { cause: 'timeout' as const, detail: 'diff-tree 超时' };
  const rows = [
    { drift: { changed: true, files: ['a.ts'], policy: 'warn' as const }, want: '只读失守（复算确证改动：裁决不得进入审批）' },
    { drift: { changed: false, files: [], policy: 'warn' as const }, want: '只读失守（复算无变化：告警放行，复算有盲区）' },
    { drift: { changed: true, files: [], policy: 'warn' as const, unknown_reason: unknown }, want: '只读失守（复算比不了：告警放行）' },
  ];
  for (const r of rows) {
    assert.equal(readonlyBreachLabel(r.drift), r.want);
    const meta = newRunMeta({
      runId: '20261007T000000Z', topic: 't', stage: 'plan', rerunIndex: 1, command: 'x', promptHint: null, taskGoal: null,
      criticsSelected: CRITICS, treeHash: 'T', gitHead: null, dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
    });
    meta.snapshot.drift = r.drift;
    assert.ok(!summarizeRun(meta).includes('只读失守'), '未失守不出失守行');
    meta.guard.readonly_breach = true;
    const s = summarizeRun(meta);
    assert.ok(s.includes(`  ⚠️ ${r.want}`), s);
    assert.equal(s.split('只读失守').length - 1, 1, '失守行恰一行');
  }
});

test('只读失守三档的 gate --check 文案：确证判失败；复算无变化与比不了各说各的、互不串（计划 r2 §2.4）', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  const run = (drift: { changed: boolean; files: string[]; unknown_reason?: { cause: 'timeout'; detail: string } }) =>
    checkAdjudication({
      planFinal: null, expectedDegradedIds: [], reviewDocs: null,
      cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
      reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
      readonlyBreach: { hit: true, files: ['W(x)'], drift },
    });

  // 确证但文件清单为空（被审对象漂移 / 有侧无法归因）：摘要如实说清单不在 drift.files 里
  const c = await run({ changed: true, files: [] });
  assert.equal(c.ok, false);
  assert.ok(
    c.failures.find((x) => x.code === 'readonly_breach')?.message.includes(
      '复算检出：有改动，文件清单未记入 snapshot.drift.files（本轮有侧无法归因时清单在 guard.unattributed_drift_files）',
    ),
    renderGateResult(c),
  );

  const unchanged = await run({ changed: false, files: [] });
  const unknown = await run({ changed: true, files: [], unknown_reason: { cause: 'timeout', detail: 'diff-tree 超时' } });
  for (const r of [unchanged, unknown]) {
    assert.equal(r.ok, true, renderGateResult(r));
    assert.deepEqual(r.failures, []);
  }
  const wu = unchanged.warnings.find((x) => x.code === 'readonly_breach_unconfirmed')!.message;
  const wk = unknown.warnings.find((x) => x.code === 'readonly_breach_unconfirmed')!.message;
  assert.ok(wk.includes('但跑后复算比不了（git 超时：diff-tree 超时），未能确证改动。'), wk);
  assert.ok(wk.includes('连一般的项目文件改动也没有核过'), wk);
  assert.ok(wk.includes('本轮结论照常进入审批'), wk);
  // 两种说法互不串（变异 M5：对调即红）
  assert.ok(!wu.includes('比不了'), wu);
  assert.ok(!wk.includes('snapshot.drift.changed 为 false'), wk);
  assert.ok(!wk.includes('未检出不等于没写'), wk);
});

/*
 * 处置句 `READONLY_BREACH_TRIAGE` 供两处 Hook 共用（收工闸门文案区分只读失守计划 r2 §2.3）。
 * 原 U15 锁的是「抽常量只搬位置、与 364ef0f 逐字相同」；只读失守未确证改动放行（2026-10-06）
 * 有意改写了确证格的文案，这里改锁新文案逐字。期望串写成字面量，不从源码引用。
 */
test('U15 readonly_breach（确证）的 message 逐字（截断与空记录两格）', async () => {
  const WANT = (records: string): string =>
    '本轮轨迹记录到审查员调用了白名单外的工具（写事件记录），且跑后复算确证审查期间工作树有改动，裁决不得进入审批。' +
    '复算检出：2 个文件改动：src/a.ts、src/b.ts。' +
    '处置：用 git status / git diff 核对这些改动是否出自审查员并清理。' +
    '复算只能确证「有改动」，归不了因——审查期间别处的手改同样会落进这一格，拦截照旧。' +
    '要重跑须先作废这一轮。' +
    '调用记录（非文件路径）：' + records;
  const nine = Array.from({ length: 9 }, (_, i) => `W${i + 1}(x)`);
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |`);
  for (const [files, want] of [
    [nine, nine.slice(0, 8).join('、') + '…'],
    [[] as string[], '（run 元数据未记录）'],
  ] as const) {
    const r = await checkAdjudication({
      planFinal: null, // 与计划定稿无关的用例（EV-214）
      expectedDegradedIds: [], reviewDocs: null,
      cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
      reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
      readonlyBreach: { hit: true, files: [...files], drift: { changed: true, files: ['src/a.ts', 'src/b.ts'] } },
    });
    assert.equal(r.failures.find((x) => x.code === 'readonly_breach')?.message, WANT(want));
  }
});

test('voidedSides 从 run 元数据的两条泄漏通道派生（守的是接线，不是纯函数）', async () => {
  const base = {
    topic: TOPIC, stage: 'plan' as const, rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false,
    subjectSha256: 's', denyPaths: [], driftPolicy: 'warn' as const,
  };

  // ① 路径通道命中**作废类** → 该侧进 voidedSides
  const l1 = await layout();
  const m1 = newRunMeta({ ...base, runId: 'RV1' });
  m1.guard.peer_leak_via_path = {
    gemini: { hit: true, hits: [{ path: '.reviews/t/plan/x-glm.md', category: 'peer-artifact' }] },
    glm: { hit: false, hits: [] },
  };
  await writeRunMeta(l1, 'plan', m1);
  assert.deepEqual((await loadRoundReviews(l1, 'plan', 'RV1')).voidedSides, ['gemini']);

  // ② 路径通道只命中**告警类** → 不作废
  const l2 = await layout();
  const m2 = newRunMeta({ ...base, runId: 'RV2' });
  m2.guard.peer_leak_via_path = {
    gemini: {
      hit: true,
      hits: [{ path: `.trivium/${STATE_FILE}`, category: 'orchestrator-state' }],
    },
  };
  await writeRunMeta(l2, 'plan', m2);
  assert.deepEqual(
    (await loadRoundReviews(l2, 'plan', 'RV2')).voidedSides,
    [],
    '读编排器状态文件不损害独立性——这一族正是四次实测误伤的全部',
  );

  // ③ 命令通道的旧记录（没有 hits）→ 作废：回退 hit 口径（旧口径，2026-09-17 之前的 run.json 只有 commands）
  const l3 = await layout();
  const m3 = newRunMeta({ ...base, runId: 'RV3' });
  m3.guard.peer_leak_via_command = { glm: { hit: true, commands: ['cat .reviews/peer-review.md'] } };
  await writeRunMeta(l3, 'plan', m3);
  assert.deepEqual((await loadRoundReviews(l3, 'plan', 'RV3')).voidedSides, ['glm']);

  // ④ 旧留痕（两条通道都没有）→ 空数组，维持旧行为、不追溯改判
  const l4 = await layout();
  await writeRunMeta(l4, 'plan', newRunMeta({ ...base, runId: 'RV4' }));
  assert.deepEqual((await loadRoundReviews(l4, 'plan', 'RV4')).voidedSides, []);

  /*
   * ⑤～⑦ 命令通道带逐条类别时按类别判（BACKLOG EV-239）。
   * 闸门曾对命令通道一律按 hit 作废，⑤ 这种只提到编排器状态目录的命令（M11 第 12 步 B2 原样）
   * 因此让该侧作废，两审形态下共同阻断静默不执行。
   */
  const b2Command = 'find . -name "*.js" -not -path "./.trivium/*"';
  // ⑤ 命令通道 hits 只有告警类 → 不作废
  const l5 = await layout();
  const m5 = newRunMeta({ ...base, runId: 'RV5' });
  m5.guard.peer_leak_via_command = {
    glm: { hit: true, commands: [b2Command], hits: [{ command: b2Command, path: '.trivium', category: 'orchestrator-state' }] },
  };
  await writeRunMeta(l5, 'plan', m5);
  assert.deepEqual(
    (await loadRoundReviews(l5, 'plan', 'RV5')).voidedSides,
    [],
    '命令里只提到编排器状态目录：hit 为真只说明扫到了东西，类别是告警级，不判作废',
  );

  // ⑥ 命令通道 hits 含作废类 → 作废
  const l6 = await layout();
  const m6 = newRunMeta({ ...base, runId: 'RV6' });
  const peerCmd = 'git show HEAD:.reviews/t/plan/x-gemini.md';
  m6.guard.peer_leak_via_command = {
    glm: { hit: true, commands: [peerCmd], hits: [{ command: peerCmd, path: '.reviews/t/plan/x-gemini.md', category: 'peer-artifact' }] },
  };
  await writeRunMeta(l6, 'plan', m6);
  assert.deepEqual((await loadRoundReviews(l6, 'plan', 'RV6')).voidedSides, ['glm']);

  // ⑦ 同一条命令同时撞告警类与作废类 → 作废（取最重档）
  const l7 = await layout();
  const m7 = newRunMeta({ ...base, runId: 'RV7' });
  const mixed = 'diff .trivium/lock/x runs/p/r/gemini/out/result.json';
  m7.guard.peer_leak_via_command = {
    gemini: {
      hit: true,
      commands: [mixed],
      hits: [
        { command: mixed, path: '.trivium/lock/x', category: 'orchestrator-state' },
        { command: mixed, path: 'runs/p/r/gemini/out/result.json', category: 'peer-run-output' },
      ],
    },
  };
  await writeRunMeta(l7, 'plan', m7);
  assert.deepEqual((await loadRoundReviews(l7, 'plan', 'RV7')).voidedSides, ['gemini']);

  /*
   * ⑧ 作废侧重跑（EV-225，代码双审 GLM-01）：闸门只看最终尝试——
   * gemini 的 `attempts[0]` 作废、最终尝试干净（`guard` 记的是最终那次）⇒ 不排出；
   * glm 最终 `guard` 作废、没有 `attempts`（旧记录形态）⇒ 照旧排出。闸门若改去读 `attempts`，这格当场红。
   */
  const l8 = await layout();
  const m8 = newRunMeta({ ...base, runId: 'RV8' });
  const side = {
    vendor: 'antigravity', cli_version: '1.0',
    model_requested: 'm', model_effective: 'm', model_effective_source: 'envelope',
    profile_requested: null, model_provider: null,
    access: { requested_mode: 'standard', profile: null, launcher_requested: null, launcher_effective: null,
      wrapper_sha256: null, configuration_sha256: null, provider_declared: null, provider_declared_source: null,
      provider_effective: null, provider_effective_source: null },
    status: 'ok', exit_code: 0, duration_s: 1, tool_calls: {}, evidence_ok: true, heterogeneous: 'unknown',
  };
  const voidedHit = { path: 'runs/p/r/glm/out/result.json', category: 'peer-run-output' as const };
  (m8.critics as Record<string, unknown>)['gemini'] = {
    ...side,
    attempts: [
      { n: 1, started_at: 't1', duration_s: 1, status: 'ok', voided: true,
        peer_leak_via_path: { hit: true, hits: [voidedHit] }, peer_leak_via_command: { hit: false, commands: [], hits: [] },
        output_dir: 'voided/gemini/attempt-1', fail_reason: null },
      { n: 2, started_at: 't2', duration_s: 1, status: 'ok', voided: false,
        peer_leak_via_path: { hit: false, hits: [] }, peer_leak_via_command: { hit: false, commands: [], hits: [] }, fail_reason: null },
    ],
  };
  m8.guard.peer_leak_via_path = {
    gemini: { hit: false, hits: [] },
    glm: { hit: true, hits: [{ path: '.reviews/t/plan/x-gemini.md', category: 'peer-artifact' }] },
  };
  await writeRunMeta(l8, 'plan', m8);
  assert.deepEqual((await loadRoundReviews(l8, 'plan', 'RV8')).voidedSides, ['glm'], '闸门只看最终尝试，不读 attempts');
});

test('loadRoundReviews 的 degraded 取自 run 元数据的 degraded_reason，不从 reviews 反推', async () => {
  const base = {
    topic: TOPIC, stage: 'plan' as const, rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false,
    subjectSha256: 's', denyPaths: [], driftPolicy: 'warn' as const,
  };

  // ① 有降级原因 → true
  const lDeg = await layout();
  const degraded = newRunMeta({ ...base, runId: 'RDEG' });
  degraded.review_mode = 'partial';
  degraded.degraded_reason = 'glm: timeout（超时）';
  await writeRunMeta(lDeg, 'plan', degraded);
  const deg = await loadRoundReviews(lDeg, 'plan', 'RDEG');
  assert.equal(deg.degraded, true);

  // ② 无降级原因 → false
  const lOk = await layout();
  const clean = newRunMeta({ ...base, runId: 'ROK' });
  await writeRunMeta(lOk, 'plan', clean);
  const ok = await loadRoundReviews(lOk, 'plan', 'ROK');
  assert.equal(ok.degraded, false, '没有 degraded_reason 就不是降级轮次');
});

// ─────────── 审批前复核：两个抛错分支的「错误身份」（M10a 第 3 步，计划 r3 §4.1）───────────

/*
 * 只断言「会抛错」是不够的（计划双审 r1 CODEX-04）：`readRunMeta` 读文件失败一律返回 null，
 * 于是第 1 步（runId 为 null 即拒绝）失效时，null 会落到第 2 步、照样抛——
 * 只看「抛了」的单测照样绿，r7 §4.3 列为验收项的那条判定就没有任何锁。
 * 所以两格各断言**自己那句判别文字在、对方那句不在**。判别文字取导出常量，
 * 不在这里再抄一遍（计划 r2 就是两处各抄、一处带 Markdown 星号，基线即红）。
 *
 * 本组是变异 M3a（只让第 1 步失效）与 M3b（整个校验体包进 if (runId)）的鉴别用例。
 */
const RECOVERY = { missingRunId: '【出口-缺 run_id】', unreadableRunMeta: '【出口-元数据读不出】' };

test('审批前复核：runId 为 null ⇒ 第 1 步拒绝（退 65），且不是落到第 2 步才被拦下', async () => {
  const l = await layout();
  await assert.rejects(
    verifyRoundForApproval({
      cfg: defaultConfig(), layout: l, stage: 'plan',
      runId: null, runIdPinned: true, runIdSource: '本机闸门记录', recovery: RECOVERY,
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT);
      assert.ok(e.message.includes(APPROVAL_CHECK_NO_RUN_ID), `缺第 1 步的判别文字：${e.message}`);
      assert.ok(e.message.includes('本机闸门记录'), '要说清 run_id 是从哪儿推断的');
      assert.ok(e.message.includes(RECOVERY.missingRunId), '出口文案由调用方给，要原样带出');
      assert.ok(
        !e.message.includes(APPROVAL_CHECK_META_UNREADABLE),
        `出现了第 2 步的判别文字——说明第 1 步没拦住、null 落到了读元数据那一步：${e.message}`,
      );
      return true;
    },
  );
});

test('审批前复核：runId 非空但本轮运行元数据读不出 ⇒ 第 2 步拒绝（退 65），不回落缺省 Driver', async () => {
  const l = await layout();
  await assert.rejects(
    verifyRoundForApproval({
      cfg: defaultConfig(), layout: l, stage: 'plan',
      runId: '20990101T000000Z', runIdPinned: true, runIdSource: '本机闸门记录', recovery: RECOVERY,
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT);
      assert.ok(e.message.includes(APPROVAL_CHECK_META_UNREADABLE), `缺第 2 步的判别文字：${e.message}`);
      assert.ok(e.message.includes('20990101T000000Z'), '要点名是哪一轮');
      assert.ok(e.message.includes(RECOVERY.unreadableRunMeta));
      /*
       * 「不要删除或改写」那一句不再内联在本函数里：它并进了两个调用点共用的出口段
       * （`meta.ts` 的 `UNREADABLE_RUN_META_EXIT_BODY`，留痕读不出的出口计划 r2 §2.2，计划双审 CODEX-03），
       * 由 `unreadable-run-exit.test.ts` 的 U3 用真实的两个出口构造函数断言它仍然可达。
       */
      assert.ok(!e.message.includes(APPROVAL_CHECK_NO_RUN_ID));
      return true;
    },
  );
});

test('审批前复核：两句判别文字互不包含、都是纯文本（不带 Markdown 记号）', () => {
  assert.ok(!APPROVAL_CHECK_NO_RUN_ID.includes(APPROVAL_CHECK_META_UNREADABLE));
  assert.ok(!APPROVAL_CHECK_META_UNREADABLE.includes(APPROVAL_CHECK_NO_RUN_ID));
  for (const t of [APPROVAL_CHECK_NO_RUN_ID, APPROVAL_CHECK_META_UNREADABLE]) {
    // 只查星号与反引号：`run_id` 这种词内下划线不构成强调，r2 撞上的正是 `**不会**` 这种星号
    assert.doesNotMatch(t, /[*`]/, `判别文字里有 Markdown 记号，渲染与子串匹配会对不上：${t}`);
  }
});
