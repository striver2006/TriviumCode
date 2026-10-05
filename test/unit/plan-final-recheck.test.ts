/**
 * 计划定稿复核（EV-215，设计 §6.6 规则 9 边界④，计划定稿复核计划 r2 §3.1）。
 *
 * 直接调 `recheckPlanFinal` / `acceptedIdsForNextPlan` / `planFinalRecheckWarning` / `composeMustReadWarnings`；
 * 布局建在 scratchDir 里，run.json 用 `newRunMeta` + `writeRunMeta` 造，不起子进程、不碰真实 CLI。
 * 调用链（`--start` / 同步 `review --stage code` / 代码阶段 `gate --check` 回灌）见 `test/integration/plan-final-recheck.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  acceptedIdsForNextPlan, checkAdjudication, collectStructuredIds, expectedFindingIds, loadRoundReviews, recheckPlanFinal,
  renderGateResult, type PlanFinalRecheck,
} from '../../src/trivium/gate.js';
import { newRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import {
  composeMustReadWarnings, planFinalRecheckWarning, PLAN_FINAL_RECHECK_WARNING,
} from '../../src/trivium/review.js';
import {
  MUST_READ_PRUNED_DISPLAY_MAX, MUST_READ_PRUNED_WARNING, renderPrunedWarnings, WARNING_MARK, type PrunedEntry,
} from '../../src/trivium/brief.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { localDate } from '../../src/trivium/naming.js';
import { metaDir, stageDir, writeMeta, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { AgentId } from '../../src/trivium/agents/registry.js';
import { CRITIC_VENDOR, type CriticId, type DispositionRow, type Finding, type Review, type RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const DATE = '2026-10-05';
const TOPIC = '复核样例';
const HEAD = `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |`;

async function layout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-pfrecheck-');
  return { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
}

function review(ids: string[]): Review {
  return {
    schema: 'trivium.review.v1', verdict: 'request-changes',
    summary: '总判断若干字，足够长以通过完整性检查。',
    findings: ids.map((id): Finding => ({
      id, severity: 'major', layer: 'plan', kind: 'correctness',
      location: `plan §${id}`, problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high',
    })),
    not_covered: ['x'], consulted: ['src/a.ts'],
  };
}

async function put(l: ArchiveLayout, name: string, body: string): Promise<void> {
  await fs.mkdir(stageDir(l, 'plan'), { recursive: true });
  await fs.writeFile(path.join(stageDir(l, 'plan'), name), body, 'utf8');
}

const planName = (r: number, role: string = 'claude') => `${DATE}-${TOPIC}${r > 1 ? `-r${r}` : ''}-${role}.md`;
const dispName = (r: number, role: string = 'claude') => `${DATE}-${TOPIC}${r > 1 ? `-r${r}` : ''}-revised-${role}.md`;

/** 新一轮计划：开头逐条引用给定编号 */
const putPlan = (l: ArchiveLayout, r: number, ids: string[], role = 'claude') =>
  put(l, planName(r, role), ['# 计划 r' + r, '', '相对上一轮的改动：', ...ids.map((id) => `- ${id}：按建议补上`), ''].join('\n'));

const acc = (id: string, src = 'gemini') => `| ${id} | ${src} | major | 接受 | 成立，按建议改 | 新一轮计划 §2 |`;
const rej = (id: string, src = 'glm') => `| ${id} | ${src} | minor | 驳回 | 上游已拒绝该分支 | 不改 |`;

interface RoundSpec {
  runId: string;
  r?: number;
  driver?: AgentId;
  /** 标记里的被审对象轮次；`false` = 旧运行，不写标记 */
  subject?: number | null | false;
  /** 各侧结构化结论的编号；值为 null 表示该侧整份回退（parse_fallback） */
  sides?: Partial<Record<CriticId, string[] | null>>;
  /** 逐条降级的编号（记在 run.json 该侧的 findings_degraded） */
  degraded?: Partial<Record<CriticId, string[]>>;
  /** 整份回退侧 `.fallback-items.md` 的虚拟编号 */
  fallbackItems?: Partial<Record<CriticId, string[]>>;
  /** 裁决表行；undefined = 不写裁决件（失败轮 / 骨架） */
  rows?: string[];
}

/** 一轮计划双审的留痕：run.json + 各侧结论 + （可选）裁决件 */
async function round(l: ArchiveLayout, o: RoundSpec): Promise<void> {
  const r = o.r ?? 1;
  const driver = o.driver ?? 'claude';
  const sides = o.sides ?? { gemini: ['AGY-01'], glm: ['GLM-01'] };
  const m = newRunMeta({
    runId: o.runId, topic: TOPIC, stage: 'plan', rerunIndex: r, command: 'x', promptHint: null, taskGoal: null,
    driver, criticsSelected: Object.keys(sides) as CriticId[], treeHash: 'h', gitHead: null, dirty: false,
    subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
    ...(o.subject === false ? {} : { planFinalCheck: { subject_rerun_index: o.subject === undefined ? r : o.subject } }),
  });
  for (const [c, ids] of Object.entries(sides) as [CriticId, string[] | null][]) {
    m.critics[c] = {
      vendor: CRITIC_VENDOR[c], status: ids === null ? 'parse_fallback' : 'ok', duration_s: 1, tool_calls: {},
      evidence_ok: true, heterogeneous: true, exit_code: 0, cli_version: null, model_requested: null,
      model_effective: null, model_effective_source: 'unverified', profile_requested: null, model_provider: null,
      ...(ids === null ? { parse_fallback: true } : {}),
      ...(o.degraded?.[c] ? { findings_degraded: o.degraded[c] } : {}),
    } as RunMeta['critics'][CriticId];
    if (ids === null) {
      await writeMeta(l, 'plan', `review-${c}-${o.runId}.json`, JSON.stringify({ parse_fallback: true, raw: null }));
      const items = (o.fallbackItems?.[c] ?? []).map((id) => `- ${id}: 一段原文`).join('\n');
      await writeMeta(l, 'plan', `review-${c}-${o.runId}.fallback-items.md`, `# 待裁决单元\n\n${items}\n`);
    } else {
      await writeMeta(l, 'plan', `review-${c}-${o.runId}.json`, JSON.stringify(review(ids)));
    }
  }
  await writeRunMeta(l, 'plan', m);
  if (o.rows) {
    await put(l, dispName(r, driver), `---
schema: trivium.disposition.v1
topic: ${TOPIC}
stage: plan
role: ${driver}
kind: revised
run_id: ${o.runId}
addresses:
  - ${DATE}-${TOPIC}-gemini.md
---

${HEAD}
${o.rows.join('\n')}
`);
  }
}

const finalRel = (l: ArchiveLayout, name: string) => path.join(path.relative(path.dirname(l.archiveRoot), stageDir(l, 'plan')), name);

function failed(r: PlanFinalRecheck): Extract<PlanFinalRecheck, { kind: 'failed' }> {
  assert.equal(r.kind, 'failed', JSON.stringify(r));
  return r as Extract<PlanFinalRecheck, { kind: 'failed' }>;
}

// ─────────────────────────── recheckPlanFinal ───────────────────────────

test('R1 第 1 轮带标记、两条接受、r2 齐全 ⇒ passed；告警为 null', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', rows: [acc('AGY-01'), acc('GLM-01', 'glm')] });
  await putPlan(l, 1, []);
  await putPlan(l, 2, ['AGY-01', 'GLM-01']);
  assert.deepEqual(await recheckPlanFinal(l, planName(2)), { kind: 'passed', runId: '20261005T010000Z', rerunIndex: 1 });
  assert.equal(await planFinalRecheckWarning(l, finalRel(l, planName(2)), 'claude'), null);
});

test('R2 闸门通过后另写 r3 漏 GLM-01 ⇒ failed 点名 r3、ids 恰为 GLM-01；告警含路径、编号与两条处置', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', rows: [acc('AGY-01'), acc('GLM-01', 'glm')] });
  await putPlan(l, 2, ['AGY-01', 'GLM-01']);
  await putPlan(l, 3, ['AGY-01']);
  const f = failed(await recheckPlanFinal(l, planName(3)));
  assert.equal(f.failure.code, 'next_plan_missing_ids');
  assert.ok(f.failure.message.includes(planName(3)), f.failure.message);
  assert.deepEqual(f.failure.ids, ['GLM-01']);

  const rel = finalRel(l, planName(3));
  const w = await planFinalRecheckWarning(l, rel, 'claude');
  assert.ok(w, '要出告警');
  assert.equal(w.name, PLAN_FINAL_RECHECK_WARNING);
  assert.ok(w.detail.startsWith(WARNING_MARK), w.detail);
  assert.ok(w.detail.includes(`本主题计划定稿 ${rel} 没有通过复核`), w.detail);
  assert.ok(w.detail.includes('计划阶段第 1 轮（run 20261005T010000Z）'), w.detail);
  assert.ok(w.detail.includes(f.failure.message), '失败消息原文要嵌进来');
  assert.ok(w.detail.includes('涉及编号：GLM-01。'), w.detail);
  assert.ok(w.detail.includes('① 把这些接受项合进计划定稿') && w.detail.includes('重跑代码双审'), w.detail);
  assert.ok(w.detail.includes('② 把这份定稿送一轮计划双审（/dual-review-plan）'), w.detail);
  // 处置写法按代码阶段 Driver
  const wc = await planFinalRecheckWarning(l, rel, 'codex');
  assert.ok(wc?.detail.includes('$dual-review-plan'), wc?.detail);
});

test('R3 有接受项、没有任何新一轮计划 ⇒ missing_next_plan，给出应写的 r2 文件名', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', rows: [acc('AGY-01'), acc('GLM-01', 'glm')] });
  await putPlan(l, 1, []);
  const f = failed(await recheckPlanFinal(l, planName(1)));
  assert.equal(f.failure.code, 'missing_next_plan');
  assert.ok(f.failure.message.includes(`${localDate()}-${TOPIC}-r2-claude.md`), f.failure.message);
  assert.deepEqual(f.failure.ids, ['AGY-01', 'GLM-01']);
  const w = await planFinalRecheckWarning(l, finalRel(l, planName(1)), 'claude');
  assert.ok(w?.detail.includes('涉及编号：AGY-01、GLM-01。'), w?.detail);
});

test('R4 最新一轮全部驳回 ⇒ skipped（即使此后写了不引用任何编号的 r3）', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', rows: [acc('AGY-01'), acc('GLM-01', 'glm')] });
  await putPlan(l, 2, ['AGY-01', 'GLM-01']);
  await round(l, { runId: '20261005T020000Z', r: 2, subject: 2, rows: [rej('AGY-01', 'gemini'), rej('GLM-01')] });
  await putPlan(l, 3, []);
  assert.deepEqual(await recheckPlanFinal(l, planName(3)), { kind: 'skipped' });
});

test('R5 旧运行（无标记）有接受项、没有 r2 ⇒ skipped', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', subject: false, rows: [acc('AGY-01')] });
  await putPlan(l, 1, []);
  assert.deepEqual(await recheckPlanFinal(l, planName(1)), { kind: 'skipped' });
  assert.equal(await planFinalRecheckWarning(l, finalRel(l, planName(1)), 'claude'), null);
});

test('R6 执笔方 codex：别家后缀的更高轮次不是候选；codex 那份缺编号即点名它', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', driver: 'codex', rows: [acc('AGY-01')] });
  await putPlan(l, 2, ['AGY-01'], 'codex');
  await putPlan(l, 3, [], 'claude');
  assert.equal((await recheckPlanFinal(l, planName(2, 'codex'))).kind, 'passed');
  await putPlan(l, 2, [], 'codex');
  const f = failed(await recheckPlanFinal(l, planName(2, 'codex')));
  assert.ok(f.failure.message.includes(planName(2, 'codex')), f.failure.message);
});

test('R7 最新一轮失败无裁决件 ⇒ 退回上一轮；恒核最大候选（r3），不因后续运行转去核 r2', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z', rows: [acc('GLM-01', 'glm')] });
  await putPlan(l, 2, ['GLM-01']);
  // 第 2 轮送审 r2 后失败：有标记（被审对象 r2）、没有裁决件
  await round(l, { runId: '20261005T020000Z', r: 2, subject: 2 });
  await putPlan(l, 3, []);
  const f = failed(await recheckPlanFinal(l, planName(3)));
  assert.equal(f.runId, '20261005T010000Z');
  assert.equal(f.failure.code, 'next_plan_missing_ids');
  assert.ok(f.failure.message.includes(planName(3)), f.failure.message);
  assert.deepEqual(f.failure.ids, ['GLM-01']);
});

test('R8 没有 _meta、或有运行但没有一轮有裁决件 ⇒ skipped', async () => {
  const l = await layout();
  await putPlan(l, 1, []);
  assert.deepEqual(await recheckPlanFinal(l, planName(1)), { kind: 'skipped' });
  await round(l, { runId: '20261005T010000Z' });
  await round(l, { runId: '20261005T020000Z', r: 2 });
  assert.deepEqual(await recheckPlanFinal(l, planName(1)), { kind: 'skipped' });
});

test('R9 无从复核：途中读不出的留痕 / 执笔方与定稿后缀不同 / 入参不是可解析的文件名', async () => {
  // ① 最新一份没有裁决件，更旧一份读不出
  const a = await layout();
  await round(a, { runId: '20261005T020000Z', r: 2 });
  await fs.writeFile(path.join(metaDir(a, 'plan'), 'run-20261005T010000Z.json'), '{ 坏', 'utf8');
  await putPlan(a, 2, []);
  const ra = await recheckPlanFinal(a, planName(2));
  assert.equal(ra.kind, 'unverifiable');
  assert.ok(ra.kind === 'unverifiable' && ra.reason.includes('run-20261005T010000Z.json 读不出'), JSON.stringify(ra));
  const wa = await planFinalRecheckWarning(a, finalRel(a, planName(2)), 'claude');
  assert.equal(wa?.name, PLAN_FINAL_RECHECK_WARNING);
  assert.ok(wa?.detail.includes('无从复核') && wa.detail.includes('需人工核对'), wa?.detail);

  // ② 那一轮的执笔方是 codex，定稿后缀是 claude
  const b = await layout();
  await round(b, { runId: '20261005T010000Z', driver: 'codex', rows: [acc('AGY-01')] });
  await putPlan(b, 2, ['AGY-01']);
  const rb = await recheckPlanFinal(b, planName(2));
  assert.ok(rb.kind === 'unverifiable' && rb.reason.includes('执笔方是 codex') && rb.reason.includes('后缀 claude'), JSON.stringify(rb));

  // ③ 传了路径而不是文件名（计划双审 AGY-01）
  const c = await layout();
  await round(c, { runId: '20261005T010000Z', rows: [acc('AGY-01')] });
  const bad = finalRel(c, planName(2));
  const rc = await recheckPlanFinal(c, bad);
  assert.ok(rc.kind === 'unverifiable' && rc.reason === `定稿文件名 ${bad} 解析不出执笔方`, JSON.stringify(rc));
});

test('R11 一侧整份回退：被接受的虚拟编号按清单进接受集合，r2 没写它即点名', async () => {
  const l = await layout();
  await round(l, {
    runId: '20261005T010000Z',
    sides: { gemini: ['AGY-01'], glm: null },
    fallbackItems: { glm: ['GLM-F01', 'GLM-F02'] },
    rows: [acc('AGY-01'), acc('GLM-F01', 'glm'), rej('GLM-F02')],
  });
  await putPlan(l, 2, ['AGY-01']);
  const f = failed(await recheckPlanFinal(l, planName(2)));
  assert.deepEqual(f.failure.ids, ['GLM-F01']);
});

test('R13 复核出错（裁决件位置是个目录，读文件抛出）⇒ unverifiable「复核出错」，不抛（计划双审 CODEX-02）', async () => {
  const l = await layout();
  await round(l, { runId: '20261005T010000Z' });
  await fs.mkdir(path.join(stageDir(l, 'plan'), dispName(1)), { recursive: true });
  await putPlan(l, 2, []);
  const r = await recheckPlanFinal(l, planName(2));
  assert.ok(r.kind === 'unverifiable' && r.reason.startsWith('复核出错：'), JSON.stringify(r));
  const w = await planFinalRecheckWarning(l, finalRel(l, planName(2)), 'claude');
  assert.ok(w?.detail.includes('无从复核：复核出错：'), w?.detail);
});

// ─────────────────────────── 接受集合（与闸门共用） ───────────────────────────

const row = (id: string, disposal: DispositionRow['disposal']): DispositionRow =>
  ({ id, source: null, severity: 'major', disposal, reason: '理由', action: '落点' });

test('R10 acceptedIdsForNextPlan：期望集内、裁为接受、去重排序；虚拟编号按清单或按表', () => {
  const reviews = { gemini: review(['AGY-02', 'AGY-01']), glm: review([]) };
  assert.deepEqual(collectStructuredIds(reviews), ['AGY-02', 'AGY-01']);
  assert.deepEqual([...expectedFindingIds(['AGY-01'], ['GLM-03'])].sort(), ['AGY-01', 'GLM-03']);

  const rows = [
    row('AGY-02', '接受'), row('AGY-01', '接受'), row('AGY-01', '接受'), // 重复
    row('GLM-03', '接受'),            // 逐条降级：收
    row('GLM-99', '接受'),            // 期望集外：不收
    row('AGY-03', '驳回'), row('GLM-04', '暂缓'),
    row('CODEX-F01', '接受'), row('CODEX-F02', '接受'), row('CODEX-F03', '驳回'),
  ];
  const base = { reviews, expectedDegradedIds: ['GLM-03', 'GLM-03'], rows };
  assert.deepEqual(
    acceptedIdsForNextPlan({ ...base, expectedFallbackIds: ['CODEX-F01', 'CODEX-F03'] }),
    ['AGY-01', 'AGY-02', 'CODEX-F01', 'GLM-03'],
  );
  assert.deepEqual(
    acceptedIdsForNextPlan({ ...base, expectedFallbackIds: null }),
    ['AGY-01', 'AGY-02', 'CODEX-F01', 'CODEX-F02', 'GLM-03'],
  );
  assert.deepEqual(acceptedIdsForNextPlan({ ...base, expectedFallbackIds: [] }), ['AGY-01', 'AGY-02', 'GLM-03']);
});

test('R12 闸门等价：同一布局上 checkAdjudication 与 recheckPlanFinal 的失败码与 ids 一致（含逐条降级与整份回退）', async () => {
  const cases: { name: string; spec: Omit<RoundSpec, 'runId'>; plans: [number, string[]][]; final: number }[] = [
    { name: '齐全', spec: { rows: [acc('AGY-01'), acc('GLM-01', 'glm')] }, plans: [[2, ['AGY-01', 'GLM-01']]], final: 2 },
    { name: '缺编号', spec: { rows: [acc('AGY-01'), acc('GLM-01', 'glm')] }, plans: [[2, ['AGY-01']]], final: 2 },
    { name: '缺计划', spec: { rows: [acc('AGY-01'), rej('GLM-01')] }, plans: [[1, []]], final: 1 },
    {
      name: '整份回退',
      spec: { sides: { gemini: ['AGY-01'], glm: null }, fallbackItems: { glm: ['GLM-F01'] }, rows: [acc('AGY-01'), acc('GLM-F01', 'glm')] },
      plans: [[2, ['AGY-01']]], final: 2,
    },
    {
      name: '逐条降级',
      spec: { sides: { gemini: ['AGY-01'], glm: [] }, degraded: { glm: ['GLM-02'] }, rows: [rej('AGY-01', 'gemini'), acc('GLM-02', 'glm')] },
      plans: [[2, []]], final: 2,
    },
  ];
  for (const c of cases) {
    const l = await layout();
    const runId = '20261005T010000Z';
    await round(l, { runId, ...c.spec });
    for (const [r, ids] of c.plans) await putPlan(l, r, ids);
    const lr = await loadRoundReviews(l, 'plan', runId);
    const cfg = defaultConfig();
    const g = await checkAdjudication({
      cfg, layout: l, stage: 'plan', rerunIndex: 1, reviews: lr.reviews, degraded: false,
      expectedFallbackIds: lr.expectedFallbackIds, expectedDegradedIds: lr.expectedDegradedIds,
      reviewDocs: null, planFinal: lr.planFinal, runId,
    });
    const gateNew = g.failures.filter((f) => f.code === 'missing_next_plan' || f.code === 'next_plan_missing_ids');
    const rc = await recheckPlanFinal(l, planName(c.final));
    if (gateNew.length === 0) {
      assert.equal(rc.kind, 'passed', `${c.name}：闸门无新失败，复核也该通过；${renderGateResult(g)}`);
    } else {
      const f = failed(rc);
      assert.equal(f.failure.code, gateNew[0]!.code, c.name);
      assert.deepEqual(f.failure.ids, gateNew[0]!.ids, c.name);
      assert.equal(f.failure.message, gateNew[0]!.message, `${c.name}：消息逐字相同`);
    }
  }
});

// ─────────────────────────── 告警拼接（顺序与封顶） ───────────────────────────

test('R14 composeMustReadWarnings：计划定稿告警排第一、不占剔除封顶名额（计划双审 CODEX-01）', () => {
  const pf = { name: PLAN_FINAL_RECHECK_WARNING, detail: `${WARNING_MARK}定稿未通过复核` };
  const pruned: PrunedEntry[] = Array.from({ length: 7 }, (_, i) => ({
    critic: 'gemini', source: 'suggested', entry: `doc/x${i}.md`,
    conflicts: [{ entry: `doc/x${i}.md`, denyEntry: `doc/x${i}.md`, category: 'sensitive', direction: 'under' }],
  }));
  const sides: CriticId[] = ['gemini', 'glm'];
  const { all, display } = composeMustReadWarnings([pf], pruned, sides);
  assert.equal(all[0], pf);
  assert.equal(all.length, 1 + 7);
  assert.ok(all.slice(1).every((w) => w.name === MUST_READ_PRUNED_WARNING));
  assert.equal(display[0], pf);
  assert.equal(display.length, 1 + MUST_READ_PRUNED_DISPLAY_MAX, '剔除部分照旧封顶 5 条，计划定稿那条不占名额');
  assert.deepEqual(display.slice(1), renderPrunedWarnings(pruned, sides, MUST_READ_PRUNED_DISPLAY_MAX));
  // 没有计划定稿告警时与 renderPrunedWarnings 逐项相同
  const none = composeMustReadWarnings([], pruned, sides);
  assert.deepEqual(none.all, renderPrunedWarnings(pruned, sides));
  assert.deepEqual(none.display, renderPrunedWarnings(pruned, sides, MUST_READ_PRUNED_DISPLAY_MAX));
});
