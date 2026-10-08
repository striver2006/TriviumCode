import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  acceptanceRate,
  aggregateByCritic,
  aggregateByDriver,
  buildTopicReport,
  effortMismatch,
  renderEffortEffective,
  renderEffortRequested,
  renderTopicReport,
  type TopicReport,
} from '../../src/trivium/report.js';
import { newRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { metaDir, stageDir, writeMeta, type ArchiveLayout } from '../../src/trivium/archive.js';
import { buildArtifactName, localDate } from '../../src/trivium/naming.js';
import type { AgentId } from '../../src/trivium/agents/registry.js';
import type { CriticId, CriticRunMeta, Review, Stage } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

/**
 * 复盘报告的双维度聚合（设计 13.2.1，M11 第 7 步；计划 `.reviews/M11-复盘报告双维度聚合/plan/` r2 §4.1）。
 *
 * 一个主题、三阶段混排：多 Driver（同一阶段 claude → codex）、claude 作审核者、读不到 Driver 的轮次、
 * 新旧留痕混合（思考等级字段缺席 / null / 有值）、整份回退编号、未进时间线的运行、run.v1 迁移。
 * 和 `report.test.ts` 一样**真的把归档摆出来再读回**——串档根因在枚举与定位那一层，手造 RoundReport 测不到。
 */

const TOPIC = '聚合主题';
const DATE = localDate();

async function archive(): Promise<ArchiveLayout> {
  const root = await fs.realpath(await scratchDir('trivium-report-agg-'));
  const l = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
  for (const s of ['plan', 'code', 'bug'] as const) await fs.mkdir(metaDir(l, s), { recursive: true });
  return l;
}

/** 直接按命名规则落一个阶段文件（裁决件后缀须是当轮 Driver，`writeArtifact` 只认缺省 Driver，故不走它） */
async function put(
  l: ArchiveLayout, stage: Stage, role: AgentId, rerunIndex: number, content: string,
  kind: 'revised' | 'response' | null = null,
): Promise<void> {
  const name = buildArtifactName({ date: DATE, topic: TOPIC, rerunIndex, kind, role }, role);
  await fs.writeFile(path.join(stageDir(l, stage), name), content, 'utf8');
}

const reviewDoc = (role: string): string => `---\nschema: trivium.review.v1\nrole: ${role}\n---\n\n# ${role} 审查\n`;

function disposition(stage: Stage, driver: AgentId, kind: 'revised' | 'response', rows: [string, string, string, string][]): string {
  return [
    '---',
    'schema: trivium.disposition.v1',
    `topic: ${TOPIC}`,
    `stage: ${stage}`,
    `role: ${driver}`,
    `kind: ${kind}`,
    'run_id: X',
    'addresses: []',
    '---',
    '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...rows.map(([id, src, sev, d]) => `| ${id} | ${src} | ${sev} | ${d} | 理由 | 落点 |`),
    '',
  ].join('\n');
}

function review(prefix: string, items: [string, string][]): Review {
  return {
    schema: 'trivium.review.v1',
    verdict: 'request-changes',
    summary: 's',
    findings: items.map(([location, severity], i) => ({
      id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      severity, layer: 'plan', kind: 'correctness', location,
      problem: 'p', evidence: 'e', suggestion: 'g', confidence: 'high',
    })),
  } as unknown as Review;
}

/** 一侧的 run.json 条目。`effort` 传 undefined 即不写那几个键（旧留痕形状） */
function side(
  c: CriticId, status: CriticRunMeta['status'],
  effort?: { requested: string | null; effective: string | null; source: 'envelope' | 'unverified' | null },
  legacy?: string,
): CriticRunMeta {
  return {
    vendor: ({ claude: 'anthropic', codex: 'openai', gemini: 'antigravity', glm: 'zcode' } as const)[c],
    cli_version: '1.0', profile_requested: null, model_provider: null,
    model_requested: `${c}-m`, model_effective: status === 'ok' ? `${c}-m` : null,
    model_effective_source: status === 'ok' ? 'envelope' : 'unverified',
    status, exit_code: status === 'ok' ? 0 : 1, duration_s: 10,
    tool_calls: { read: 3 }, evidence_ok: status === 'ok', heterogeneous: true,
    ...(status === 'ok' ? { findings_degraded: [] } : {}),
    ...(legacy !== undefined ? { effort: legacy } : {}),
    ...(effort
      ? { effort_requested: effort.requested, effort_effective: effort.effective, effort_effective_source: effort.source }
      : {}),
  } as CriticRunMeta;
}

async function seedRun(
  l: ArchiveLayout,
  o: {
    stage: Stage; rerunIndex: number; runId: string; driver: AgentId;
    sides: Partial<Record<CriticId, CriticRunMeta>>;
    reviews?: Partial<Record<CriticId, Review>>;
    status?: 'success' | 'cancelled';
  },
): Promise<void> {
  const meta = newRunMeta({
    runId: o.runId, topic: TOPIC, stage: o.stage, rerunIndex: o.rerunIndex, command: 'test',
    promptHint: null, taskGoal: null, criticsSelected: Object.keys(o.sides) as CriticId[],
    treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
    driver: o.driver,
  });
  meta.critics = o.sides;
  for (const [c, rv] of Object.entries(o.reviews ?? {})) {
    await writeMeta(l, o.stage, `review-${c}-${o.runId}.json`, JSON.stringify(rv) + '\n');
  }
  meta.status = o.status ?? 'success';
  await writeRunMeta(l, o.stage, meta);
}

/** run.v1 留痕（照 `run-meta.test.ts` 的最小合法形状）：读进内存后 driver 由迁移补为 claude */
async function seedV1(l: ArchiveLayout, stage: Stage, runId: string): Promise<void> {
  const raw = {
    schema: 'trivium.run.v1',
    run_id: runId, topic: TOPIC, stage, rerun_index: 1, command: 'x', prompt_hint: null, task_goal: null,
    snapshot: {
      git_head: null, tree_hash: 'h', dirty: false, subject_sha256: 's',
      drift: { changed: false, files: [], policy: 'warn' },
    },
    started_at: 'x', finished_at: 'y', review_mode: 'dual', degraded_reason: null, critics: {}, deny_paths: [],
    guard: { readonly_breach: false, peer_artifact_read: false, peer_deny_applied: {}, forged_role_file: false },
    artifacts: [], gate: { adjudication_complete: false, state: 'running' }, status: 'success',
  };
  await fs.writeFile(path.join(metaDir(l, stage), `run-${runId}.json`), JSON.stringify(raw), 'utf8');
}

/** 计划 r2 §4.1 的夹具表，逐行摆出 */
async function seedTopic(l: ArchiveLayout): Promise<void> {
  // plan r1：claude 当 Driver；旧留痕形状（思考等级五键缺席，gemini 只有旧名 effort）
  await put(l, 'plan', 'claude', 1, '# 原稿\n');
  await seedRun(l, {
    stage: 'plan', rerunIndex: 1, runId: '20260101T000001Z', driver: 'claude',
    sides: { gemini: side('gemini', 'ok', undefined, 'high'), glm: side('glm', 'ok') },
    reviews: { gemini: review('AGY', [['a:1', 'major'], ['b:1', 'minor']]), glm: review('GLM', [['a:1', 'minor']]) },
  });
  await put(l, 'plan', 'gemini', 1, reviewDoc('gemini'));
  await put(l, 'plan', 'glm', 1, reviewDoc('glm'));
  await put(l, 'plan', 'claude', 1, disposition('plan', 'claude', 'revised', [
    ['AGY-01', 'gemini', 'major', '接受'], ['AGY-02', 'gemini', 'minor', '驳回'], ['GLM-01', 'glm', 'minor', '接受'],
  ]), 'revised');

  // plan r2：换 codex 当 Driver，claude 作审核者；新留痕形状
  await put(l, 'plan', 'codex', 2, '# codex 的 r2 计划\n');
  await seedRun(l, {
    stage: 'plan', rerunIndex: 2, runId: '20260101T000002Z', driver: 'codex',
    sides: {
      gemini: side('gemini', 'ok', { requested: 'medium', effective: 'high', source: 'envelope' }),
      glm: side('glm', 'ok', { requested: null, effective: null, source: null }),
      claude: side('claude', 'ok', { requested: 'max', effective: null, source: 'unverified' }),
    },
    reviews: {
      gemini: review('AGY', [['c:1', 'minor']]),
      glm: review('GLM', [['c:1', 'nit']]),
      claude: review('CLAUDE', [['d:1', 'blocker']]),
    },
  });
  for (const c of ['gemini', 'glm', 'claude'] as const) await put(l, 'plan', c, 2, reviewDoc(c));
  await put(l, 'plan', 'codex', 2, disposition('plan', 'codex', 'revised', [
    ['AGY-01', 'gemini', 'minor', '暂缓'], ['GLM-01', 'glm', 'nit', '驳回'], ['CLAUDE-01', 'claude', 'blocker', '接受'],
  ]), 'revised');
  // plan r3：codex 的新一轮计划，送审后被取消（有 run.json、没有审查文档）——原稿按该轮 driver 排除，不定义 r3
  await put(l, 'plan', 'codex', 3, '# codex 的 r3 计划\n');
  await seedRun(l, {
    stage: 'plan', rerunIndex: 3, runId: '20260101T000003Z', driver: 'codex', status: 'cancelled',
    sides: { claude: side('claude', 'ok') },
  });

  // plan r4：审查文档无 front-matter、没有 run.json（gemini 不在排除集 ⇒ 后缀兜底认它）
  await put(l, 'plan', 'gemini', 4, '# 孤立的审查文档\n');
  // plan r5：claude 是唯一产出方、没有 run.json，但审查文档 front-matter 完好（内容谓词认它，AGY-01）
  await put(l, 'plan', 'claude', 5, reviewDoc('claude'));
  // plan r6：codex 的原稿，没有 run.json、无 front-matter——codex 在本阶段当过 Driver，后缀兜底排除它，不造幽灵轮次
  await put(l, 'plan', 'codex', 6, '# codex 的 r6 计划\n');

  // code r1：claude 当 Driver；codex 整份回退
  await seedRun(l, {
    stage: 'code', rerunIndex: 1, runId: '20260101T000011Z', driver: 'claude',
    sides: {
      codex: side('codex', 'parse_fallback', { requested: 'xhigh', effective: null, source: 'unverified' }),
      glm: side('glm', 'ok', { requested: null, effective: null, source: null }),
    },
    reviews: { glm: review('GLM', [['e:1', 'major']]) },
  });
  await put(l, 'code', 'codex', 1, reviewDoc('codex'));
  await put(l, 'code', 'glm', 1, reviewDoc('glm'));
  await put(l, 'code', 'claude', 1, disposition('code', 'claude', 'response', [
    ['CODEX-F01', 'fallback', 'minor', '接受'], ['GLM-01', 'glm', 'major', '接受'],
  ]), 'response');

  // code 未进时间线：glm 当 Driver 发起、被取消，gemini 侧 failed
  await seedRun(l, {
    stage: 'code', rerunIndex: 2, runId: '20260101T000012Z', driver: 'glm', status: 'cancelled',
    sides: { gemini: side('gemini', 'failed'), codex: side('codex', 'ok') },
  });

  // bug r1：run.v1 迁移
  await seedV1(l, 'bug', '20260101T000021Z');
  await put(l, 'bug', 'gemini', 1, reviewDoc('gemini'));
  await put(l, 'bug', 'claude', 1, disposition('bug', 'claude', 'revised', [['AGY-01', 'gemini', 'minor', '接受']]), 'revised');
}

let cached: Promise<TopicReport> | null = null;
const report = (): Promise<TopicReport> =>
  (cached ??= (async () => {
    const l = await archive();
    await seedTopic(l);
    return buildTopicReport(l);
  })());

const round = (r: TopicReport, stage: Stage, n: number) => r.rounds.find((x) => x.stage === stage && x.rerunIndex === n)!;

// ── A1 / A1b：轮次枚举与裁决件按当轮 Driver ──

test('A1 换了 Driver 的轮次读得到它自己的裁决件；codex 的原稿不定义幽灵轮次（r3 有 run.json、r6 没有）', async () => {
  const r = await report();
  assert.deepEqual(r.rounds.filter((x) => x.stage === 'plan').map((x) => x.rerunIndex), [1, 2, 4, 5]);
  assert.deepEqual(r.unlistedRuns.map((u) => [u.stage, u.rerunIndex, u.driver]), [['plan', 3, 'codex'], ['code', 2, 'glm']]);
  const r2 = round(r, 'plan', 2);
  assert.equal(r2.driver, 'codex');
  assert.deepEqual(r2.disposals, { 接受: 1, 驳回: 1, 暂缓: 1 }, 'r2 的裁决件是 -r2-revised-codex，不是 -claude');
  assert.ok(!r2.notes.some((n) => /尚无裁决件/.test(n)));
});

test('A1b 没有 run.json 的轮次：claude 是唯一产出方、front-matter 完好 ⇒ 仍在时间线', async () => {
  const r = await report();
  const r5 = round(r, 'plan', 5);
  assert.ok(r5, '内容谓词认出了审查文档，不因后缀落在排除集而消失');
  assert.equal(r5.driver, null);
  assert.equal(r5.driverUnknownReason, '找不到对应的 run.json');
});

// ── A2 / A3：按 Driver ──

test('A2 按 Driver 各算各的；读不到 Driver 的轮次单独成组、不归给缺省 Driver', async () => {
  const r = await report();
  const { byDriver, unknownDriver } = r.aggregates;
  const pick = (d: string, s: string) => byDriver.find((x) => x.driver === d && x.stage === s);
  assert.deepEqual(
    byDriver.map((x) => `${x.driver}/${x.stage}`),
    ['claude/plan', 'claude/code', 'claude/bug', 'claude/all', 'codex/plan', 'codex/all', 'glm/code', 'glm/all'],
  );
  assert.deepEqual(pick('claude', 'plan')!.disposals, { 接受: 2, 驳回: 1, 暂缓: 0 });
  assert.equal(pick('claude', 'plan')!.rounds, 1, 'plan r2 是 codex 发起的，不进 claude');
  assert.equal(pick('claude', 'plan')!.findings, 3);
  assert.deepEqual(pick('codex', 'plan')!.disposals, { 接受: 1, 驳回: 1, 暂缓: 1 });
  assert.equal(pick('codex', 'plan')!.unlistedRuns, 1);
  assert.equal(pick('codex', 'plan')!.findings, 3, 'claude 作审核者提的那条算在 codex 发起的轮次里');
  assert.deepEqual(
    [pick('glm', 'code')!.rounds, pick('glm', 'code')!.unlistedRuns],
    [0, 1],
    '只有未进时间线运行的（Driver, 阶段）也成行，轮次写 0',
  );
  assert.equal(pick('claude', 'all')!.v1Rounds, 1);
  assert.equal(pick('claude', 'all')!.rounds, 3);
  assert.equal(unknownDriver.rounds, 2);
  assert.deepEqual(
    unknownDriver.items.map((i) => [i.stage, i.rerunIndex, i.runId, i.reason]),
    [['plan', 4, null, '找不到对应的 run.json'], ['plan', 5, null, '找不到对应的 run.json']],
  );

  const md = renderTopicReport(r);
  assert.match(md, /\| 读不到 Driver \| — \| 2 \| — \| — \| — \| — \| — \| — \| — \| — \|/, '该组意见、裁决、采纳率是「—」不是 0');
  assert.match(md, /plan r4（找不到对应的 run\.json）；plan r5（找不到对应的 run\.json）/);
  assert.match(md, /\| claude（其中 1 轮为 run\.v1 迁移） \| \*\*合计\*\* \|/);
});

test('A3 不变式：各已知 Driver 合计的裁决之和 = 全主题采纳率的分子分母', async () => {
  const r = await report();
  const all = r.aggregates.byDriver.filter((x) => x.stage === 'all');
  const sum = (k: '接受' | '驳回' | '暂缓') => all.reduce((a, x) => a + x.disposals[k], 0);
  const { accepted, total } = acceptanceRate(r.rounds);
  assert.equal(sum('接受'), accepted);
  assert.equal(sum('接受') + sum('驳回') + sum('暂缓'), total);
  assert.deepEqual([accepted, total], [6, 9]);
});

// ── A4：按审核者 ──

test('A4 按审核者：意见归提出方，回退编号按前缀，codex 同时出现在两张表', async () => {
  const r = await report();
  const c = (id: string) => r.aggregates.byCritic.find((x) => x.critic === id)!;
  assert.deepEqual(r.aggregates.byCritic.map((x) => x.critic), ['claude', 'codex', 'gemini', 'glm']);

  assert.deepEqual([c('claude').selectedRounds, c('claude').concludedRounds, c('claude').findings], [1, 1, 1]);
  assert.equal(c('claude').severity!.blocker, 1);
  assert.deepEqual(c('claude').disposals, { 接受: 1, 驳回: 0, 暂缓: 0 });

  // codex：code r1 整份回退——入选 1、产出结论 0、整份回退 1；CODEX-F01 归它
  assert.deepEqual([c('codex').selectedRounds, c('codex').concludedRounds, c('codex').parseFallback], [1, 0, 1]);
  assert.deepEqual(c('codex').fallback, { ids: 1, disposals: { 接受: 1, 驳回: 0, 暂缓: 0 } });
  assert.deepEqual(c('codex').disposals, { 接受: 1, 驳回: 0, 暂缓: 0 }, '回退编号照常计入（D-1）');
  assert.ok(r.aggregates.byDriver.some((x) => x.driver === 'codex'), 'R23：同一 id 也在 Driver 表');

  // gemini：入选轮次只数时间线（plan r1、r2）；未进时间线的取消运行只进失败专列
  assert.equal(c('gemini').selectedRounds, 2);
  assert.equal(c('gemini').unlistedFailed, 1);
  assert.equal(c('gemini').findings, 3);
  assert.deepEqual(c('gemini').severity, { blocker: 0, major: 1, minor: 2, nit: 0 });
  assert.deepEqual(c('gemini').disposals, { 接受: 2, 驳回: 1, 暂缓: 1 });

  // glm 与 gemini 在 plan r1 对同一位置 a:1 各提一条：各计一条，不去重
  assert.equal(c('glm').findings, 3);
  assert.equal(c('glm').selectedRounds, 3);

  const total = r.aggregates.byCritic.reduce((a, x) => a + x.disposals['接受'] + x.disposals['驳回'] + x.disposals['暂缓'], 0);
  assert.equal(total, acceptanceRate(r.rounds).total, '审核者分摊之和等于裁决行总数');
});

test('A4 来源判不出的裁决行单列「来源不明」，不猜', () => {
  const base = {
    stage: 'plan' as const, rerunIndex: 1, runId: 'R', startedAt: null, finishedAt: null, status: null,
    reviewMode: null, criticsSelected: [], driver: 'claude' as const, driverSource: 'run.v2' as const,
    driverUnknownReason: null, driverGuardLevel: null, degradedReason: null, sides: [],
    severity: { blocker: 0, major: 0, minor: 0, nit: 0 }, disposals: { 接受: 1, 驳回: 0, 暂缓: 0 }, dispositionUnreadable: false,
    disposalsBySource: { unknown: { 接受: 1, 驳回: 0, 暂缓: 0 } }, fallbackDisposalsBySource: {},
    contested: [], divergences: [], guardFlags: [], tokens: {}, notes: [],
  };
  const rows = aggregateByCritic([base], []);
  assert.deepEqual(rows.map((x) => x.critic), ['unknown']);
  assert.equal(rows[0]!.findings, null, '非裁决格写 null，不是 0');
  assert.deepEqual(aggregateByDriver([base], []).byDriver.find((x) => x.stage === 'all')!.disposals, { 接受: 1, 驳回: 0, 暂缓: 0 });
});

test('A4 早期留痕：状态记整份回退却仍有可读结论 ⇒ 产出结论与整份回退两格都计（判据是结论读不读得到）', () => {
  const r = {
    stage: 'plan' as const, rerunIndex: 1, runId: 'R', startedAt: null, finishedAt: null, status: null,
    reviewMode: null, criticsSelected: ['gemini' as const], driver: 'claude' as const, driverSource: 'run.v1' as const,
    driverUnknownReason: null, driverGuardLevel: null, degradedReason: null,
    sides: [{
      critic: 'gemini' as const, status: 'parse_fallback', modelEffective: 'g', modelRequested: 'g', durationS: 1,
      findings: 6, findingsDegraded: 0, evidenceOk: true, failReason: null,
      severity: { blocker: 2, major: 2, minor: 2, nit: 0 },
    }],
    severity: { blocker: 2, major: 2, minor: 2, nit: 0 }, disposals: null, dispositionUnreadable: false,
    disposalsBySource: {}, fallbackDisposalsBySource: {},
    contested: [], divergences: [], guardFlags: [], tokens: {}, notes: [],
  };
  const g = aggregateByCritic([r], [])[0]!;
  assert.deepEqual([g.concludedRounds, g.findings, g.parseFallback], [1, 6, 1]);
  assert.equal(aggregateByDriver([r], []).byDriver.find((x) => x.stage === 'all')!.findings, 6);
});

// ── A5 / A6：第四节两列与 JSON 三态 ──

test('A5 第四节：缺席写「—」、null 按语义写，生效列从不拿请求值顶替', async () => {
  const md = renderTopicReport(await report());
  assert.match(md, /\| plan r1 \| gemini \| gemini-m \| gemini-m \| —（旧名 effort：high） \| — \| ok \|/);
  assert.match(md, /\| plan r1 \| glm \| glm-m \| glm-m \| — \| — \| ok \|/);
  assert.match(md, /\| plan r2 \| gemini \| gemini-m \| gemini-m \| medium \| high ⚠️ \| ok \|/, '两值不等加 ⚠️');
  assert.match(md, /\| plan r2 \| claude \| claude-m \| claude-m \| max \| \*\*未回读到\*\* \| ok \|/);
  assert.match(md, /\| plan r2 \| glm \| glm-m \| glm-m \| （未请求） \| （无此概念） \| ok \|/);
  assert.doesNotMatch(md, /\| plan r2 \| claude \|[^\n]*\| max \| max/, 'claude 生效列不得出现请求值 max');
});

test('A6 JSON：缺席的键不出现，null 照写 null；aggregates 三键齐全', async () => {
  const j = JSON.parse(JSON.stringify(await report())) as Record<string, unknown> & TopicReport;
  const s = (stage: Stage, n: number, c: string) =>
    (j.rounds.find((x) => x.stage === stage && x.rerunIndex === n)!.sides.find((x) => x.critic === c)!) as unknown as Record<string, unknown>;
  assert.ok(!('effortEffective' in s('plan', 1, 'gemini')));
  assert.ok(!('effortRequested' in s('plan', 1, 'gemini')));
  assert.equal(s('plan', 1, 'gemini')['effortLegacy'], 'high');
  assert.ok('effortEffective' in s('plan', 2, 'glm'));
  assert.equal(s('plan', 2, 'glm')['effortEffective'], null);
  assert.equal(s('plan', 2, 'glm')['effortEffectiveSource'], null);
  assert.deepEqual(Object.keys(j.aggregates).sort(), ['byCritic', 'byDriver', 'unknownDriver']);
  const u = j.unlistedRuns.find((x) => x.stage === 'code')!;
  assert.equal(u.driver, 'glm');
  assert.deepEqual(u.sideStatuses, { gemini: 'failed', codex: 'ok' });
});

test('A6 审核者表 B：缺席与 null 分开计次', async () => {
  const r = await report();
  const g = r.aggregates.byCritic.find((x) => x.critic === 'glm')!;
  assert.deepEqual(g.effortRequested, { values: {}, absent: 1, unrequested: 2, legacy: {} });
  assert.deepEqual(g.effortEffective, { values: {}, absent: 1, unverified: 0, noConcept: 2 });
  const gm = r.aggregates.byCritic.find((x) => x.critic === 'gemini')!;
  assert.deepEqual(gm.effortRequested, { values: { medium: 1 }, absent: 1, unrequested: 0, legacy: { high: 1 } });
  assert.deepEqual(gm.effortEffective, { values: { high: 1 }, absent: 1, unverified: 0, noConcept: 0 });
  // claude 请求了 max、回读不到：生效一格只记「未回读到」，不把请求值算进生效计次
  const cl = r.aggregates.byCritic.find((x) => x.critic === 'claude')!;
  assert.deepEqual(cl.effortRequested!.values, { max: 1 });
  assert.deepEqual(cl.effortEffective, { values: {}, absent: 0, unverified: 1, noConcept: 0 });
  const md = renderTopicReport(r);
  assert.match(md, /\| glm \| 0 \| 0 \| 0 \| 0 \| glm-m ×3 \| （未请求） ×2、— ×1 \| （无此概念） ×2、— ×1 \|/);
});

// ── A7：v1 迁移 ──

test('A7 run.v1 迁移的轮次归 claude，并标出来源', async () => {
  const r = await report();
  const b = round(r, 'bug', 1);
  assert.equal(b.driver, 'claude');
  assert.equal(b.driverSource, 'run.v1');
  assert.equal(round(r, 'plan', 1).driverSource, 'run.v2');
  assert.equal(r.aggregates.byDriver.find((x) => x.driver === 'claude' && x.stage === 'bug')!.v1Rounds, 1);
});

// ── A8：纯函数表驱动 ──

test('A8 请求列映射', () => {
  assert.equal(renderEffortRequested({}), '—');
  assert.equal(renderEffortRequested({ effortLegacy: 'high' }), '—（旧名 effort：high）');
  assert.equal(renderEffortRequested({ effortRequested: null }), '（未请求）');
  assert.equal(renderEffortRequested({ effortRequested: null, effortLegacy: 'high' }), '（未请求）', '在场时不看旧名');
  assert.equal(renderEffortRequested({ effortRequested: 'xhigh' }), 'xhigh');
});

test('A8 生效列映射：只看回读两格', () => {
  assert.equal(renderEffortEffective({}), '—');
  assert.equal(renderEffortEffective({ effortEffectiveSource: 'unverified' }), '—', '值缺席即缺席，不看来源');
  assert.equal(renderEffortEffective({ effortEffective: null, effortEffectiveSource: 'unverified' }), '**未回读到**');
  assert.equal(renderEffortEffective({ effortEffective: null, effortEffectiveSource: null }), '（无此概念）');
  assert.equal(renderEffortEffective({ effortEffective: null }), '**未回读到**', '来源缺席按读不到');
  assert.equal(renderEffortEffective({ effortEffective: 'high', effortEffectiveSource: 'envelope' }), 'high');
  // 传入带请求值的整侧对象，结果也只由回读两格决定
  const sideLike = { effortRequested: 'max', effortEffective: null, effortEffectiveSource: 'unverified' as const };
  assert.equal(renderEffortEffective(sideLike), '**未回读到**');
});

test('A8 对比标记：两值都是字符串且不等才为真', () => {
  assert.equal(effortMismatch({ effortRequested: 'medium', effortEffective: 'high' }), true);
  assert.equal(effortMismatch({ effortRequested: 'high', effortEffective: 'high' }), false);
  assert.equal(effortMismatch({ effortRequested: 'max', effortEffective: null }), false);
  assert.equal(effortMismatch({ effortEffective: 'high' }), false);
  assert.equal(effortMismatch({}), false);
});

// ── B：代码三审补的四格（代码三审 run 20261008T070253Z） ──

test('B1 本阶段有读不出的 run.json ⇒ 原因不说「找不到」，如实说无法判断是否属于本轮（CODEX-01 ≡ AGY-01）', async () => {
  const l = await archive();
  await put(l, 'plan', 'gemini', 1, '# 孤立的审查文档\n');
  await fs.writeFile(path.join(metaDir(l, 'plan'), 'run-20260101T000099Z.json'), '{ 坏掉的', 'utf8');
  const r = await buildTopicReport(l);
  const r1 = round(r, 'plan', 1);
  assert.equal(r1.driver, null);
  assert.equal(r1.driverUnknownReason, '没有可读的 run.json（本阶段另有 1 份读不出，无法判断是否属于本轮，成因见主题告警）');
  assert.deepEqual(r.aggregates.unknownDriver.items.map((i) => i.runId), [null]);
  assert.ok(r.notes.some((n) => /读不出来/.test(n)), '那份 run.json 的成因照旧进主题告警');
});

test('B2 同一轮次号作废后换 Driver 重跑：前一次运行的原稿不造幽灵轮次（CODEX-02）', async () => {
  const l = await archive();
  await put(l, 'plan', 'claude', 1, '# claude 的原稿\n');
  await seedRun(l, {
    stage: 'plan', rerunIndex: 1, runId: '20260101T000101Z', driver: 'claude', status: 'cancelled',
    sides: { gemini: side('gemini', 'failed') },
  });
  await put(l, 'plan', 'codex', 1, '# codex 的原稿\n');
  await seedRun(l, {
    stage: 'plan', rerunIndex: 1, runId: '20260101T000102Z', driver: 'codex', status: 'cancelled',
    sides: { glm: side('glm', 'failed') },
  });
  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 0, 'claude 的原稿不因后一次运行的 driver 是 codex 而被当审查文档');
  assert.deepEqual(r.unlistedRuns.map((u) => u.driver), ['claude', 'codex']);
});

test('B3 裁决件定位得到却读不出：计未裁决并单记一笔，不再说「尚无裁决件」（GLM-02）', async () => {
  const l = await archive();
  await seedRun(l, {
    stage: 'plan', rerunIndex: 1, runId: '20260101T000201Z', driver: 'claude',
    sides: { gemini: side('gemini', 'ok') }, reviews: { gemini: review('AGY', [['a:1', 'minor']]) },
  });
  await put(l, 'plan', 'gemini', 1, reviewDoc('gemini'));
  // 裁决件的位置放一个目录：定位得到，readFile 必然失败
  await fs.mkdir(path.join(stageDir(l, 'plan'), buildArtifactName({ date: DATE, topic: TOPIC, rerunIndex: 1, kind: 'revised', role: 'claude' })));
  const r = await buildTopicReport(l);
  const r1 = round(r, 'plan', 1);
  assert.equal(r1.dispositionUnreadable, true);
  assert.equal(r1.disposals, null);
  assert.ok(r1.notes.some((n) => /裁决件读取失败/.test(n)));
  assert.ok(!r1.notes.some((n) => /尚无裁决件/.test(n)), '裁决件在、只是读不出，不能说「尚无」');
  const row = r.aggregates.byDriver.find((x) => x.driver === 'claude' && x.stage === 'plan')!;
  assert.deepEqual([row.unadjudicatedRounds, row.dispositionUnreadableRounds], [1, 1]);
  assert.match(renderTopicReport(r), /\| claude \| plan \| 1 \| 0 \| 1（其中 1 轮裁决件读不出） \|/);
});

test('B4 只在未进时间线运行里出现过、也没失败的审核者同样成行，各格为 0（GLM-04）', () => {
  const rows = aggregateByCritic([], [{
    stage: 'code', runId: 'U', rerunIndex: 1, status: 'cancelled', startedAt: 'x', finishedAt: null,
    termination: null, registeredReviewDocs: 0, label: '被 review --cancel 取消',
    driver: 'claude', sideStatuses: { codex: 'ok', glm: 'timeout' },
  }]);
  assert.deepEqual(rows.map((x) => [x.critic, x.selectedRounds, x.unlistedFailed]), [['codex', 0, 0], ['glm', 0, 1]]);
});
