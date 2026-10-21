/**
 * 计划定稿强制产出（EV-214，设计 §6.6 规则 9，计划 r2 §3.1）。
 *
 * 直接调 `checkAdjudication` / `loadRoundReviews` / `planSubjectRerunIndex`；布局建在 scratchDir 里，
 * 不起子进程、不碰真实 CLI。集成侧见 `test/integration/plan-final-gate.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  checkAdjudication, loadRoundReviews, mentionsFindingId, renderGateResult,
  type GateCheckResult, type PlanFinalInput,
} from '../../src/trivium/gate.js';
import { newRunMeta, readRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { planSubjectRerunIndex } from '../../src/trivium/review.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { localDate } from '../../src/trivium/naming.js';
import { stageDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { AgentId } from '../../src/trivium/agents/registry.js';
import type { CriticId, Finding, Review, Stage } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const DATE = '2026-10-05';
const TOPIC = '定稿样例';
const HEAD = `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |`;

async function layout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-pfinal-');
  return { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
}

function review(ids: string[]): Review {
  return {
    schema: 'trivium.review.v2', verdict: 'approve-after-changes',
    summary: '总判断若干字，足够长以通过完整性检查。',
    findings: ids.map((id): Finding => ({
      id, severity: 'major', layer: 'plan', kind: 'correctness',
      location: `plan §${id}`, problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high',
    })),
    not_covered: ['x'], consulted: ['src/a.ts'],
  };
}

/** 直接落文件（日期、轮次、后缀都要可控，不经 writeArtifact 的防覆盖抬升） */
async function put(l: ArchiveLayout, name: string, body: string, stage: Stage = 'plan'): Promise<void> {
  const dir = stageDir(l, stage);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), body, 'utf8');
}

function fileName(o: { r?: number; kind?: 'revised' | 'response'; role?: string; date?: string }): string {
  const parts = [TOPIC];
  if ((o.r ?? 1) > 1) parts.push(`r${o.r}`);
  if (o.kind) parts.push(o.kind);
  return `${o.date ?? DATE}-${parts.join('-')}-${o.role ?? 'claude'}.md`;
}

async function putDisposition(
  l: ArchiveLayout, rows: string[], o: { r?: number; driver?: AgentId; stage?: Stage } = {},
): Promise<void> {
  const stage = o.stage ?? 'plan';
  const kind = stage === 'code' ? 'response' : 'revised';
  const driver = o.driver ?? 'claude';
  await put(l, fileName({ r: o.r, kind, role: driver }), `---
schema: trivium.disposition.v1
topic: ${TOPIC}
stage: ${stage}
role: ${driver}
kind: ${kind}
run_id: R1
addresses:
  - ${DATE}-${TOPIC}-gemini.md
---

${HEAD}
${rows.join('\n')}
`, stage);
}

const acc = (id: string, src = 'gemini') => `| ${id} | ${src} | major | 接受 | 成立，按建议改 | 新一轮计划 §2 |`;
const rej = (id: string, src = 'glm') => `| ${id} | ${src} | minor | 驳回 | 上游已拒绝该分支 | 不改 |`;
const dfr = (id: string, src = 'glm') => `| ${id} | ${src} | minor | 暂缓 | 等依赖升级后再议 | 遗留风险 |`;

const PF = (subject: number | null = 1, later: number[] = []): PlanFinalInput =>
  ({ subjectRerunIndex: subject, laterSubjectRerunIndexes: later });

async function check(
  l: ArchiveLayout,
  o: {
    reviews: Partial<Record<CriticId, Review | null>>;
    planFinal: PlanFinalInput | null;
    rerunIndex?: number;
    driver?: AgentId;
    stage?: Stage;
    expectedFallbackIds?: string[];
  },
): Promise<GateCheckResult> {
  const cfg = defaultConfig();
  cfg.gate.allow_defer = true;
  return checkAdjudication({
    cfg, layout: l, stage: o.stage ?? 'plan', rerunIndex: o.rerunIndex ?? 1,
    reviews: o.reviews, degraded: false, expectedDegradedIds: [], reviewDocs: null,
    roundVerdict: null,
    driver: o.driver, planFinal: o.planFinal,
    ...(o.expectedFallbackIds ? { expectedFallbackIds: o.expectedFallbackIds } : {}),
  });
}

const codes = (r: GateCheckResult) => r.failures.map((f) => f.code);
const NEW = ['missing_next_plan', 'next_plan_missing_ids'];
const newFailures = (r: GateCheckResult) => r.failures.filter((f) => NEW.includes(f.code));

test('U1 有接受项、r2 引用齐全 → 通过，无新失败与新告警', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01'), acc('GLM-01', 'glm')]);
  await put(l, fileName({ r: 2 }), '# r2\n\n相对上一轮的改动：AGY-01 补并发回滚；GLM-01 补超时。\n');
  const r = await check(l, { reviews: { gemini: review(['AGY-01']), glm: review(['GLM-01']) }, planFinal: PF() });
  assert.equal(r.ok, true, renderGateResult(r));
  assert.equal(r.warnings.some((w) => w.code === 'next_plan_unchecked'), false);
});

test('U2 有接受项、没有新一轮计划 → missing_next_plan，给出应写文件名与接受编号', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01'), rej('GLM-01')]);
  const r = await check(l, { reviews: { gemini: review(['AGY-01']), glm: review(['GLM-01']) }, planFinal: PF() });
  assert.equal(r.ok, false);
  const f = r.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, renderGateResult(r));
  assert.match(f.message, new RegExp(`${localDate()}-${TOPIC}-r2-claude\\.md`));
  assert.deepEqual(f.ids, ['AGY-01'], '只列被接受的，驳回的 GLM-01 不在其中');
});

test('U3 新一轮计划缺一条编号 → next_plan_missing_ids 恰列缺的那条', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01'), acc('AGY-02'), acc('GLM-01', 'glm')]);
  await put(l, fileName({ r: 2 }), '# r2\n\n- AGY-01：补上\n- GLM-01：补上\n');
  const r = await check(l, { reviews: { gemini: review(['AGY-01', 'AGY-02']), glm: review(['GLM-01']) }, planFinal: PF() });
  const f = r.failures.find((x) => x.code === 'next_plan_missing_ids');
  assert.ok(f, renderGateResult(r));
  assert.deepEqual(f.ids, ['AGY-02']);
  assert.match(f.message, new RegExp(fileName({ r: 2 }).replace(/[.]/g, '\\.')));
});

test('U4 全部驳回 / 全部暂缓 → 不要求新一轮计划', async () => {
  for (const row of [rej, dfr]) {
    const l = await layout();
    await putDisposition(l, [row('AGY-01', 'gemini'), row('GLM-01')]);
    const r = await check(l, { reviews: { gemini: review(['AGY-01']), glm: review(['GLM-01']) }, planFinal: PF() });
    assert.equal(r.ok, true, renderGateResult(r));
    assert.deepEqual(newFailures(r), []);
  }
});

test('U5 零意见、空表 → 不要求', async () => {
  const l = await layout();
  await putDisposition(l, []);
  const r = await check(l, { reviews: { gemini: review([]), glm: review([]) }, planFinal: PF() });
  assert.equal(r.ok, true, renderGateResult(r));
});

test('U6 非缺省 Driver：别家后缀的 r2 不算，应写名取当轮 Driver 后缀', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')], { driver: 'codex' });
  await put(l, fileName({ r: 2, role: 'claude' }), '# r2\n\nAGY-01\n');
  const r1 = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(), driver: 'codex' });
  const f = r1.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, renderGateResult(r1));
  assert.match(f.message, /-r2-codex\.md/);
  await put(l, fileName({ r: 2, role: 'codex' }), '# r2\n\nAGY-01\n');
  const r2 = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(), driver: 'codex' });
  assert.equal(r2.ok, true, renderGateResult(r2));
});

test('U7 第 2 轮（被审对象 r2）：r2 不算新一轮，要 r3；补 r3 后通过', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')], { r: 2 });
  await put(l, fileName({ r: 2 }), '# r2\n\nAGY-01\n');
  const r1 = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(2), rerunIndex: 2 });
  const f = r1.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, renderGateResult(r1));
  assert.match(f.message, /-r3-claude\.md/);
  await put(l, fileName({ r: 3 }), '# r3\n\nAGY-01\n');
  const r2 = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(2), rerunIndex: 2 });
  assert.equal(r2.ok, true, renderGateResult(r2));
});

test('U8 第 1 轮但被审对象已是 r2（送审前就写了 r2）→ 要求 r3', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')]);
  await put(l, fileName({ r: 2 }), '# r2\n\nAGY-01\n');
  const r = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(2), rerunIndex: 1 });
  const f = r.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, renderGateResult(r));
  assert.match(f.message, /-r3-claude\.md/);
});

test('U9 旧运行（planFinal 为 null）有接受项 → 通过，出 next_plan_unchecked', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')]);
  const r = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: null });
  assert.equal(r.ok, true, renderGateResult(r));
  const w = r.warnings.find((x) => x.code === 'next_plan_unchecked');
  assert.ok(w);
  assert.deepEqual(w.ids, ['AGY-01']);
});

test('U10 bug / code 阶段即使传了 planFinal 也不校验', async () => {
  for (const stage of ['bug', 'code'] as const) {
    const l = await layout();
    await putDisposition(l, [acc('AGY-01')], { stage });
    const r = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(), stage });
    assert.deepEqual(newFailures(r), [], `${stage}：${renderGateResult(r)}`);
    assert.equal(r.warnings.some((w) => w.code === 'next_plan_unchecked'), false);
  }
});

test('U11 编号整词判据：GLM-010 不算 GLM-01；括号与冒号相邻算；被接受的虚拟编号必须出现', async () => {
  assert.equal(mentionsFindingId('见 GLM-010', 'GLM-01'), false);
  assert.equal(mentionsFindingId('XGLM-01', 'GLM-01'), false);
  assert.equal(mentionsFindingId('（GLM-01）', 'GLM-01'), true);
  assert.equal(mentionsFindingId('GLM-01：补上', 'GLM-01'), true);
  assert.equal(mentionsFindingId('GLM-01-② 那半', 'GLM-01'), true);

  const l = await layout();
  await putDisposition(l, [acc('GLM-01', 'glm'), `| GLM-F02 | fallback | - | 接受 | 回退侧这一条成立 | 新一轮计划 §3 |`]);
  await put(l, fileName({ r: 2 }), '# r2\n\n- GLM-010 不相干\n- GLM-F01 也不相干\n');
  const r = await check(l, {
    reviews: { glm: null }, planFinal: PF(), expectedFallbackIds: ['GLM-F01', 'GLM-F02'],
  });
  const f = r.failures.find((x) => x.code === 'next_plan_missing_ids');
  assert.ok(f, renderGateResult(r));
  assert.deepEqual(f.ids, ['GLM-F02']);
});

test('U12 顶着执笔方后缀的审查件不算候选', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')]);
  await put(l, fileName({ r: 2 }), '---\nschema: trivium.review.v1\nrole: claude\n---\n\nAGY-01\n');
  const r = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF() });
  assert.ok(r.failures.some((x) => x.code === 'missing_next_plan'), renderGateResult(r));
});

test('U13 在用的轮次核定稿（最大候选）：r2 齐、r3 缺 → 判缺；r3 补齐后通过', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01'), acc('AGY-02')]);
  await put(l, fileName({ r: 2 }), '# r2\n\nAGY-01 AGY-02\n');
  await put(l, fileName({ r: 3 }), '# r3\n\nAGY-01\n');
  const r1 = await check(l, { reviews: { gemini: review(['AGY-01', 'AGY-02']) }, planFinal: PF() });
  const f = r1.failures.find((x) => x.code === 'next_plan_missing_ids');
  assert.ok(f, renderGateResult(r1));
  assert.deepEqual(f.ids, ['AGY-02']);
  assert.match(f.message, /-r3-claude\.md/);
  await put(l, fileName({ r: 3 }), '# r3\n\nAGY-01 AGY-02\n');
  await put(l, fileName({ r: 2 }), '# r2\n\n什么都没引用\n');
  const r2 = await check(l, { reviews: { gemini: review(['AGY-01', 'AGY-02']) }, planFinal: PF() });
  assert.equal(r2.ok, true, renderGateResult(r2));
});

test('U14 既有失败与新失败同时存在：一次全报，新失败排在最后', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')]);
  const r = await check(l, { reviews: { gemini: review(['AGY-01', 'AGY-02']) }, planFinal: PF() });
  const c = codes(r);
  assert.ok(c.includes('missing_findings'), renderGateResult(r));
  assert.equal(c.at(-1), 'missing_next_plan');
  assert.ok(c.indexOf('missing_findings') < c.indexOf('missing_next_plan'));
});

test('U15 复审未修订原稿（rerun_index 2、被审对象 r1）→ 要求 r2 而非 r3', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')], { r: 2 });
  const r1 = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(1), rerunIndex: 2 });
  const f = r1.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, renderGateResult(r1));
  assert.match(f.message, /-r2-claude\.md/);
  assert.doesNotMatch(f.message, /-r3-/);
  await put(l, fileName({ r: 2 }), '# r2\n\nAGY-01\n');
  const r2 = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(1), rerunIndex: 2 });
  assert.equal(r2.ok, true, renderGateResult(r2));
});

test('U15b 被审对象在归档外（subject 为 null）→ 基准退回 rerun_index', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01')], { r: 2 });
  const r = await check(l, { reviews: { gemini: review(['AGY-01']) }, planFinal: PF(null), rerunIndex: 2 });
  const f = r.failures.find((x) => x.code === 'missing_next_plan');
  assert.ok(f, renderGateResult(r));
  assert.match(f.message, /-r3-claude\.md/);
});

test('U16 已被后续运行接手的轮次核紧随那份：r2 齐、r3 只引用后一轮编号 → 通过', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01'), acc('AGY-02')]);
  await put(l, fileName({ r: 2 }), '# r2\n\nAGY-01 AGY-02\n');
  await put(l, fileName({ r: 3 }), '# r3\n\n相对 r2：AGY-05\n');
  const r = await check(l, { reviews: { gemini: review(['AGY-01', 'AGY-02']) }, planFinal: PF(1, [2]) });
  assert.equal(r.ok, true, renderGateResult(r));
  // 后续运行的被审对象轮次不高于基准时不算接手：回到核定稿，r3 缺编号即红
  const r2 = await check(l, { reviews: { gemini: review(['AGY-01', 'AGY-02']) }, planFinal: PF(1, [1]) });
  assert.ok(r2.failures.some((x) => x.code === 'next_plan_missing_ids'), renderGateResult(r2));
});

test('U17 期望集外的接受编号只由 unknown_findings 报，不要求写进新一轮计划', async () => {
  const l = await layout();
  await putDisposition(l, [acc('AGY-01'), acc('GLM-99', 'glm')]);
  await put(l, fileName({ r: 2 }), '# r2\n\nAGY-01\n');
  const r = await check(l, { reviews: { gemini: review(['AGY-01']), glm: review([]) }, planFinal: PF() });
  assert.ok(codes(r).includes('unknown_findings'), renderGateResult(r));
  assert.deepEqual(newFailures(r), [], renderGateResult(r));
});

// ─────────────────── 标记的写侧与读侧 ───────────────────

const META_BASE = {
  topic: TOPIC, stage: 'plan' as const, rerunIndex: 1, command: 'x',
  promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'] as CriticId[],
  treeHash: 'h', gitHead: null, dirty: false,
  subjectSha256: 's', denyPaths: [], driftPolicy: 'warn' as const,
};

test('newRunMeta：带 planFinalCheck 写出字段、过契约、读得回；不带则不写', async () => {
  const l = await layout();
  const m = newRunMeta({ ...META_BASE, runId: '20261005T000001Z', planFinalCheck: { subject_rerun_index: 2 } });
  assert.deepEqual(m.plan_final_check, { subject_rerun_index: 2 });
  assert.deepEqual(validateRunMeta(m), []);
  await writeRunMeta(l, 'plan', m);
  assert.deepEqual((await readRunMeta(l, 'plan', '20261005T000001Z'))?.plan_final_check, { subject_rerun_index: 2 });

  const n = newRunMeta({ ...META_BASE, runId: '20261005T000002Z', planFinalCheck: { subject_rerun_index: null } });
  assert.deepEqual(validateRunMeta(n), []);
  const none = newRunMeta({ ...META_BASE, runId: '20261005T000003Z' });
  assert.equal('plan_final_check' in none, false);
});

test('run.v2 契约：plan_final_check 形状错即校验不过', () => {
  const m = newRunMeta({ ...META_BASE, runId: '20261005T000004Z' });
  for (const bad of [{ subject_rerun_index: 0 }, { subject_rerun_index: 1, extra: true }, {}, { subject_rerun_index: 'r2' }]) {
    const x = { ...m, plan_final_check: bad } as unknown;
    assert.notDeepEqual(validateRunMeta(x), [], JSON.stringify(bad));
  }
});

test('loadRoundReviews：带标记的计划阶段给出 planFinal（含更晚运行的被审对象轮次）；无标记或代码阶段为 null', async () => {
  const l = await layout();
  const mk = (runId: string, subject: number | null | undefined, stage: Stage = 'plan') =>
    newRunMeta({
      ...META_BASE, stage, runId,
      ...(subject !== undefined ? { planFinalCheck: { subject_rerun_index: subject } } : {}),
    });
  await writeRunMeta(l, 'plan', mk('20261005T010000Z', 1));
  await writeRunMeta(l, 'plan', mk('20261005T000000Z', 7)); // 更早：不收
  await writeRunMeta(l, 'plan', mk('20261005T020000Z', 2));
  await writeRunMeta(l, 'plan', mk('20261005T030000Z', null)); // 被审对象没有轮次：不收
  await writeRunMeta(l, 'plan', mk('20261005T040000Z', undefined)); // 没有标记：不收
  await fs.writeFile(path.join(stageDir(l, 'plan'), '_meta', 'run-20261005T050000Z.json'), '{坏'); // 读不出：跳过

  const pf = (await loadRoundReviews(l, 'plan', '20261005T010000Z')).planFinal;
  assert.deepEqual(pf, { subjectRerunIndex: 1, laterSubjectRerunIndexes: [2] });
  assert.equal((await loadRoundReviews(l, 'plan', '20261005T040000Z')).planFinal, null);

  // 代码阶段的运行元数据即使带了标记（构造出来的），也不给 planFinal
  const lc = await layout();
  await writeRunMeta(lc, 'code', mk('20261005T010000Z', 1, 'code'));
  assert.equal((await loadRoundReviews(lc, 'code', '20261005T010000Z')).planFinal, null);
});

test('planSubjectRerunIndex：plan 根下当轮 Driver 的原稿取轮次，其余为 null', async () => {
  const l = await layout();
  const dir = stageDir(l, 'plan');
  assert.equal(planSubjectRerunIndex(l, path.join(dir, fileName({ r: 2 })), 'claude'), 2);
  assert.equal(planSubjectRerunIndex(l, path.join(dir, fileName({})), 'claude'), 1);
  assert.equal(planSubjectRerunIndex(l, path.join(dir, fileName({ r: 2 })), 'codex'), null, '别家后缀');
  assert.equal(planSubjectRerunIndex(l, path.join(dir, fileName({ kind: 'revised' })), 'claude'), null, '裁决件');
  assert.equal(planSubjectRerunIndex(l, path.join(l.archiveRoot, '..', 'doc', 'plan.md'), 'claude'), null, '归档外');
  assert.equal(planSubjectRerunIndex(l, path.join(stageDir(l, 'bug'), fileName({ r: 2 })), 'claude'), null, '别的阶段');
  assert.equal(
    planSubjectRerunIndex(l, path.join(dir, `${DATE}-别的主题-r2-claude.md`), 'claude'), null, '别的主题',
  );
});
