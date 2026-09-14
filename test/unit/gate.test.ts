import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  checkAdjudication, findJointRejectedBlockers, isHollowReason, loadRoundReviews, renderGateResult,
} from '../../src/trivium/gate.js';
import { newRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { CRITICS } from '../../src/trivium/types.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { writeArtifact, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { Finding, Review } from '../../src/trivium/types.js';

const DATE = '2026-09-10';
const TOPIC = '登录重构';

async function layout(): Promise<ArchiveLayout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-gate-'));
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
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]), glm: review([{ id: 'GLM-01', severity: 'minor' }]) },
    degraded: false,
  });
  assert.equal(r.ok, true, renderGateResult(r));
});

test('缺裁决件 → missing_disposition，并提示即使全驳回也要产出', async () => {
  const l = await layout();
  const r = await checkAdjudication({
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
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }, { id: 'AGY-02' }]) }, degraded: false,
  });
  assert.equal(r.ok, false);
  const f = r.failures.find((x) => x.code === 'missing_findings');
  assert.deepEqual(f?.ids, ['AGY-02']);
});

test('裁决了不存在的编号 → unknown_findings', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| AGY-01 | gemini | major | 接受 | 成立 | §3 |
| AGY-99 | gemini | major | 接受 | 抄错了 | §4 |`);
  const r = await checkAdjudication({
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
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) }, degraded: false,
    missingSides: ['glm'],
  });
  assert.equal(r.ok, false, '结论文件是唯一事实来源，缺了不能当「该侧无意见」放行');
  const f = r.failures.find((x) => x.code === 'missing_review_json');
  assert.match(f!.message, /glm/);
  assert.match(f!.message, /git restore/);
});

test('AGY-04 的关键点：fallback 侧只要求有裁决与理由，不要求落点', async () => {
  const l = await layout();
  await putDisposition(l, `${HEAD}
| GLM-F01 | fallback | — | 接受 | 确认成立 | |`);
  const r = await checkAdjudication({
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
    cfg, layout: l, stage: 'plan', rerunIndex: 1,
    reviews: {
      gemini: review([{ id: 'AGY-01', severity: 'blocker', location: 'src/a.ts:88' }]),
      glm: review([{ id: 'GLM-01', severity: 'blocker', location: 'src/a.ts:88' }]),
    },
    degraded: false,
  });
  assert.ok(r.failures.some((x) => x.code === 'joint_blocker_rejected'), renderGateResult(r));
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
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review([{ id: 'AGY-01' }]) },
    degraded: false,
  });
  assert.equal(r.ok, true, renderGateResult(r));
  assert.ok(!r.warnings.some((w) => w.code === 'degraded_round'));
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
