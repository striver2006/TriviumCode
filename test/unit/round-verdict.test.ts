/**
 * 审查结论三档计票与多轮评审循环（EV-247，计划 §二 / §四 / §七）。
 *
 * 纯函数一层：计票规则（用户 2026-10-22 定的四条）、下一步判定、轮次链推导、最大轮次取值；
 * 外加 review.v2 的两处读取侧——解析口径（新产出只认 v2、其余两版都认）与「这是审查件」的判据
 * （漏认 v2 时禁读静默失效，所以单独钉一格）。端到端的闸门迁移在 `test/integration/review-loop.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ballotOf, decideOutcome, deriveReviewLoop, maxRoundsProblem, newChainMaxRounds, nextAction, renderRoundLine, tallyRound,
  REVIEW_LOOP_DEFAULT_ROUNDS, REVIEW_LOOP_MAX_ROUNDS, type PrevRoundFacts, type SideBallot,
} from '../../src/trivium/round-verdict.js';
import { parseReview } from '../../src/trivium/parse.js';
import { isReviewArtifact } from '../../src/trivium/archive.js';
import { enumerateDenyPaths } from '../../src/trivium/freeze.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { resolveTopicArgs } from '../../src/trivium/topic-args.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { validateConfig, validateRunMeta } from '../../src/trivium/schemas.js';
import { isReviewSchemaId, type Ctx, type ReviewVerdict, type ReviewV1, type ReviewV2 } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const counts = (pass: number, pac: number, reject: number): Record<ReviewVerdict, number> =>
  ({ pass, 'pass-after-changes': pac, reject });

// ── 计票规则 ──

test('R1 不通过 ≥ 50% ⇒ 不通过：两家一票不通过即达半数', () => {
  assert.equal(decideOutcome(counts(1, 0, 1)), 'reject');
  assert.equal(decideOutcome(counts(0, 1, 1)), 'reject');
  assert.equal(decideOutcome(counts(0, 0, 2)), 'reject');
  assert.equal(decideOutcome(counts(2, 0, 2)), 'reject', '四家二比二：不通过先判');
  assert.equal(decideOutcome(counts(0, 0, 1)), 'reject', '单侧（降级）只剩一票');
});

test('R2 不通过不到半数、修改后通过 ≥ 50% ⇒ 修改后通过', () => {
  assert.equal(decideOutcome(counts(1, 1, 0)), 'pass-after-changes', '两家一通过一修改后通过：修改后通过先判');
  assert.equal(decideOutcome(counts(1, 2, 0)), 'pass-after-changes');
  assert.equal(decideOutcome(counts(0, 2, 1)), 'pass-after-changes', '三家一票不通过只占三分之一');
});

test('R3 前两档都不到半数、通过 ≥ 50% ⇒ 通过（四家「1 不 1 修 2 通」按用户规则判通过）', () => {
  assert.equal(decideOutcome(counts(2, 0, 0)), 'pass');
  assert.equal(decideOutcome(counts(2, 1, 1)), 'pass');
  assert.equal(decideOutcome(counts(3, 1, 0)), 'pass');
});

test('R4 三档都不到半数（三家各投一档）⇒ 修改后通过；一票都没有 ⇒ undetermined', () => {
  assert.equal(decideOutcome(counts(1, 1, 1)), 'pass-after-changes');
  assert.equal(decideOutcome(counts(0, 0, 0)), 'undetermined');
});

test('R5 下一步：不通过且未到上限 ⇒ rerun；到上限 ⇒ human_review；通过两档 ⇒ proceed；无结论 ⇒ human_review', () => {
  assert.equal(nextAction('reject', { round: 1, max_rounds: 3 }), 'rerun');
  assert.equal(nextAction('reject', { round: 2, max_rounds: 3 }), 'rerun');
  assert.equal(nextAction('reject', { round: 3, max_rounds: 3 }), 'human_review');
  assert.equal(nextAction('reject', { round: 1, max_rounds: 1 }), 'human_review', '上限 1：第一轮不通过即停');
  assert.equal(nextAction('reject', { round: 9, max_rounds: 10 }), 'rerun');
  assert.equal(nextAction('reject', { round: 10, max_rounds: 10 }), 'human_review');
  assert.equal(nextAction('pass', { round: 3, max_rounds: 3 }), 'proceed');
  assert.equal(nextAction('pass-after-changes', { round: 1, max_rounds: 3 }), 'proceed');
  assert.equal(nextAction('undetermined', { round: 1, max_rounds: 3 }), 'human_review');
});

const v2 = (verdict: ReviewVerdict): ReviewV2 => ({ schema: 'trivium.review.v2', verdict, summary: 's', findings: [] });
const v1: ReviewV1 = { schema: 'trivium.review.v1', verdict: 'block', summary: 's', findings: [] };

test('R6 选票：作废优先于结论；回退、缺件、旧契约都不计票', () => {
  assert.deepEqual(ballotOf(v2('reject'), true), { excluded: 'voided' });
  assert.deepEqual(ballotOf(null, false), { excluded: 'parse_fallback' });
  assert.deepEqual(ballotOf(undefined, false), { excluded: 'missing' });
  assert.deepEqual(ballotOf(v1, false), { excluded: 'legacy_schema' });
  assert.deepEqual(ballotOf(v2('pass'), false), { verdict: 'pass' });
});

test('R7 tallyRound：不计票的侧不进分母（一侧回退、另一侧不通过 ⇒ 1/1 不通过）', () => {
  const ballots: Record<string, SideBallot> = { gemini: { excluded: 'parse_fallback' }, glm: { verdict: 'reject' } };
  const rv = tallyRound(ballots, { round: 1, max_rounds: 3 });
  assert.deepEqual(rv.sides, { glm: 'reject' });
  assert.deepEqual(rv.excluded, { gemini: 'parse_fallback' });
  assert.deepEqual(rv.counts, counts(0, 0, 1));
  assert.equal(rv.outcome, 'reject');
  assert.equal(rv.next_action, 'rerun');
  const line = renderRoundLine({ round: 1, max_rounds: 3 }, rv);
  assert.match(line, /^第 1\/3 轮 · 计票：0 通过 \/ 0 修改后通过 \/ 1 不通过（另有 1 侧不计票，由 1\/2 侧定论） → 不通过 · 下一步：按裁决修改后自动重审$/);
});

test('R8 tallyRound：全部不计票 ⇒ undetermined、停下人工审核', () => {
  const rv = tallyRound({ gemini: { excluded: 'failed' }, glm: { excluded: 'voided' } }, { round: 1, max_rounds: 3 });
  assert.equal(rv.outcome, 'undetermined');
  assert.equal(rv.next_action, 'human_review');
  assert.match(renderRoundLine({ round: 1, max_rounds: 3 }, rv), /有效结论不足 · 下一步：停下人工审核$/);
});

test('R18 有效票下限（D-5）：有效票 × 2 < 入选侧数 ⇒ undetermined；双审剩一票仍可定论', () => {
  const loop = { round: 1, max_rounds: 3 };
  const three = tallyRound({ codex: { excluded: 'parse_fallback' }, gemini: { excluded: 'voided' }, glm: { verdict: 'pass' } }, loop);
  assert.equal(three.outcome, 'undetermined', '三审两侧不计票、剩一票 pass：不能放行');
  assert.equal(three.next_action, 'human_review');
  assert.match(renderRoundLine(loop, three), /由 1\/3 侧定论） → 有效结论不足/);

  const twoOfThree = tallyRound({ codex: { excluded: 'failed' }, gemini: { verdict: 'pass' }, glm: { verdict: 'pass' } }, loop);
  assert.equal(twoOfThree.outcome, 'pass', '三审两票有效：照常判');

  assert.equal(decideOutcome(counts(0, 0, 1), 2), 'reject', '双审剩一票：1×2 不小于 2，可定论');
  assert.equal(decideOutcome(counts(1, 0, 0), 3), 'undetermined');
  assert.equal(decideOutcome(counts(1, 1, 0), 4), 'pass-after-changes', '四审两票：恰好半数，可定论');
  assert.equal(decideOutcome(counts(1, 0, 0), 4), 'undetermined');
});

// ── 最大轮次 ──

test('R9 maxRoundsProblem：1～10 的整数合法，其余给出点名旗标的文案', () => {
  for (const ok of ['1', '3', '10']) assert.equal(maxRoundsProblem(ok, '--max-rounds'), null);
  assert.match(maxRoundsProblem('0', '--max-rounds')!, /--max-rounds 取 1～10，收到 0/);
  assert.match(maxRoundsProblem('11', '--max-rounds-code')!, /--max-rounds-code 取 1～10，收到 11/);
  assert.match(maxRoundsProblem('2.5', '--max-rounds')!, /要一个整数/);
  assert.match(maxRoundsProblem('-1', '--max-rounds')!, /要一个整数/);
  assert.equal(REVIEW_LOOP_DEFAULT_ROUNDS, 3);
  assert.equal(REVIEW_LOOP_MAX_ROUNDS, 10);
});

// ── 轮次链 ──

const rerunPrev = (over: Partial<PrevRoundFacts> = {}): PrevRoundFacts => ({
  run_id: '20261022T000000Z',
  review_loop: { round: 1, max_rounds: 3 },
  round_verdict: tallyRound({ glm: { verdict: 'reject' } }, { round: 1, max_rounds: 3 }),
  closed: false,
  ...over,
});

test('R10 新链：没有上一轮 / 上一轮不是 rerun / 旧运行 / 已人工表态 ⇒ 第 1 轮，上限取显式值或缺省', () => {
  assert.deepEqual(deriveReviewLoop(null, null), { ok: true, loop: { round: 1, max_rounds: 3, max_rounds_source: 'default' }, continued: false });
  assert.deepEqual(deriveReviewLoop(null, 7), { ok: true, loop: { round: 1, max_rounds: 7, max_rounds_source: 'flag' }, continued: false });
  const proceeded = rerunPrev({ round_verdict: tallyRound({ glm: { verdict: 'pass' } }, { round: 1, max_rounds: 3 }) });
  assert.deepEqual(deriveReviewLoop(proceeded, 5), { ok: true, loop: { round: 1, max_rounds: 5, max_rounds_source: 'flag' }, continued: false });
  const legacy: PrevRoundFacts = { run_id: 'x', closed: false };
  assert.deepEqual(deriveReviewLoop(legacy, null), { ok: true, loop: { round: 1, max_rounds: 3, max_rounds_source: 'default' }, continued: false });
  assert.deepEqual(deriveReviewLoop(rerunPrev({ closed: true }), 2), { ok: true, loop: { round: 1, max_rounds: 2, max_rounds_source: 'flag' }, continued: false });
});

test('R11 续链：上一轮 rerun 且未表态 ⇒ 轮次 +1、上限沿用链首；显式给相同值也行，给不同值拒绝', () => {
  assert.deepEqual(deriveReviewLoop(rerunPrev(), null), { ok: true, loop: { round: 2, max_rounds: 3 }, continued: true });
  assert.deepEqual(deriveReviewLoop(rerunPrev(), 3), { ok: true, loop: { round: 2, max_rounds: 3 }, continued: true });
  const r = deriveReviewLoop(rerunPrev(), 5);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /上限沿用 3，不能中途改成 5/);
});

// ── 轮次上限配置项（双平台统一时由 Windows 线吸收 review.plan_rounds / code_rounds） ──

test('R21 新链上限取值顺序：旗标 → 配置 → 缺省 3，并记下来源', () => {
  assert.deepEqual(newChainMaxRounds(4, 6), { max_rounds: 4, max_rounds_source: 'flag' }, '旗标优先于配置');
  assert.deepEqual(newChainMaxRounds(null, 6), { max_rounds: 6, max_rounds_source: 'config' }, '配置优先于缺省');
  assert.deepEqual(newChainMaxRounds(null, null), { max_rounds: REVIEW_LOOP_DEFAULT_ROUNDS, max_rounds_source: 'default' });
  assert.deepEqual(deriveReviewLoop(null, null, 6), { ok: true, loop: { round: 1, max_rounds: 6, max_rounds_source: 'config' }, continued: false });
  assert.deepEqual(deriveReviewLoop(null, 2, 6), { ok: true, loop: { round: 1, max_rounds: 2, max_rounds_source: 'flag' }, continued: false });
});

test('R22 续链不读配置：上限与来源沿用链首；链首没有来源（旧运行）就不补', () => {
  const head = rerunPrev({ review_loop: { round: 1, max_rounds: 3, max_rounds_source: 'config' } });
  assert.deepEqual(deriveReviewLoop(head, null, 8), { ok: true, loop: { round: 2, max_rounds: 3, max_rounds_source: 'config' }, continued: true },
    '配置在链中途改成 8，不影响还剩几轮');
  assert.deepEqual(deriveReviewLoop(rerunPrev(), null, 8), { ok: true, loop: { round: 2, max_rounds: 3 }, continued: true });
});

test('R23 配置键 review.plan_rounds / code_rounds 按 1～10 校验，缺席合法', () => {
  const cfg = defaultConfig();
  assert.equal(cfg.review.plan_rounds, undefined, '缺省不写进配置：init 冻进项目配置的整份缺省里没有它，来源才分得出「缺省」');
  assert.deepEqual(validateConfig(cfg), []);
  assert.deepEqual(validateConfig({ ...cfg, review: { ...cfg.review, plan_rounds: 5, code_rounds: 10 } }), []);
  for (const bad of [0, 11, 2.5]) {
    assert.ok(validateConfig({ ...cfg, review: { ...cfg.review, code_rounds: bad } }).length > 0, `code_rounds=${bad} 要被拒`);
  }
});

test('R24 run.json review_loop.max_rounds_source 只认三个值，缺席合法（旧运行）', () => {
  const base = newRunMeta({
    runId: '20261024T000000Z', topic: 'T', stage: 'plan', rerunIndex: 1, command: 'fixture-only',
    promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  for (const src of ['flag', 'config', 'default'] as const) {
    assert.deepEqual(validateRunMeta({ ...base, review_loop: { round: 1, max_rounds: 3, max_rounds_source: src } }), []);
  }
  assert.deepEqual(validateRunMeta({ ...base, review_loop: { round: 1, max_rounds: 3 } }), []);
  assert.ok(validateRunMeta({ ...base, review_loop: { round: 1, max_rounds: 3, max_rounds_source: 'cli' } }).length > 0);
});

test('R19 上一轮停在人工审核：未表态 ⇒ 拒绝起链（由归档正本把守）；已表态 ⇒ 新链', () => {
  const held = rerunPrev({
    review_loop: { round: 3, max_rounds: 3 },
    round_verdict: tallyRound({ glm: { verdict: 'reject' } }, { round: 3, max_rounds: 3 }),
  });
  assert.equal(held.round_verdict!.next_action, 'human_review');
  for (const requested of [null, 3, 5]) {
    const r = deriveReviewLoop(held, requested);
    assert.equal(r.ok, false, `显式上限 ${requested} 也不能绕过`);
    if (!r.ok) assert.match(r.message, /已停在人工审核[\s\S]*\/dual-approve/);
  }
  const undetermined = rerunPrev({ round_verdict: tallyRound({ glm: { excluded: 'failed' } }, { round: 1, max_rounds: 3 }) });
  assert.equal(deriveReviewLoop(undetermined, null).ok, false, '有效结论不足的第 1 轮同样停住');
  assert.deepEqual(deriveReviewLoop({ ...held, closed: true }, null), { ok: true, loop: { round: 1, max_rounds: 3, max_rounds_source: 'default' }, continued: false });
});

test('R20 run.json 的 round_verdict 两组键按注册表与入选集合校验', () => {
  const base = newRunMeta({
    runId: '20261022T000000Z', topic: 'T', stage: 'plan', rerunIndex: 1, command: 'fixture-only',
    promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
    treeHash: 't', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  const withVerdict = (sides: Record<string, string>, excluded: Record<string, string>): unknown => ({
    ...base,
    review_loop: { round: 1, max_rounds: 3 },
    round_verdict: { sides, excluded, counts: counts(1, 0, 0), outcome: 'pass', next_action: 'proceed' },
  });
  assert.deepEqual(validateRunMeta(withVerdict({ gemini: 'pass' }, { glm: 'failed' })), []);
  assert.ok(validateRunMeta(withVerdict({ nobody: 'pass' }, {})).some((p) => /round_verdict\.sides 含未登记审核者：nobody/.test(p)));
  assert.ok(validateRunMeta(withVerdict({ gemini: 'pass' }, { codex: 'failed' })).some((p) => /round_verdict\.excluded\.codex 不在入选集合/.test(p)));
  assert.ok(validateRunMeta(withVerdict({ gemini: 'pass' }, { gemini: 'voided' })).some((p) => /gemini 同时计了票又列为不计票/.test(p)));
});

// ── review.v2 的读取侧 ──

const sampleJson = (schema: string, verdict: string): string => JSON.stringify({
  schema, verdict, summary: '通读后的总判断，足够长。', findings: [], not_covered: ['x'], consulted: [],
});

test('R12 解析口径：新产出（current）只认 v2，v1 形态判根不合；缺省口径两版都认', () => {
  const cur = parseReview(sampleJson('trivium.review.v2', 'reject'), { accept: 'current' });
  assert.equal(cur.ok, true);
  if (cur.ok) assert.equal(cur.review.verdict, 'reject');

  const legacyStrict = parseReview(sampleJson('trivium.review.v1', 'approve'), { accept: 'current' });
  assert.equal(legacyStrict.ok, false);
  if (!legacyStrict.ok) assert.equal(legacyStrict.cause, 'root_invalid');

  const legacyAny = parseReview(sampleJson('trivium.review.v1', 'approve'));
  assert.equal(legacyAny.ok, true);
  if (legacyAny.ok) assert.equal(legacyAny.review.schema, 'trivium.review.v1');

  // v2 的 schema 配 v1 的取值：哪一版都不合
  assert.equal(parseReview(sampleJson('trivium.review.v2', 'approve')).ok, false);
});

test('R13 「这是审查件」的判据认 v1 ∪ v2，其余一概不认', () => {
  assert.equal(isReviewSchemaId('trivium.review.v1'), true);
  assert.equal(isReviewSchemaId('trivium.review.v2'), true);
  assert.equal(isReviewSchemaId('trivium.review.v3'), false);
  assert.equal(isReviewSchemaId('trivium.disposition.v1'), false);
  assert.equal(isReviewSchemaId(undefined), false);
});

test('R14 v2 审查件：不能当被审原稿；顶着当轮 Driver 后缀也照样进别家的禁读集（漏认即禁读失效）', async () => {
  const root = await scratchDir('trivium-rv2-');
  const archiveRoot = path.join(root, '.reviews');
  const dir = path.join(archiveRoot, 'T', 'plan');
  await fs.mkdir(dir, { recursive: true });
  // 换过 Driver 的主题：codex 当审核者时写下的审查件，本轮 codex 是 Driver——后缀等于当轮 Driver
  const name = ['2026-10-01', 'T', 'codex'].join('-') + '.md';
  const file = path.join(dir, name);
  await fs.writeFile(file, '---\nschema: trivium.review.v2\nrole: codex\nverdict: reject\n---\n\n# 审查意见\n', 'utf8');
  assert.equal(await isReviewArtifact(file), true);

  const deny = await enumerateDenyPaths(defaultConfig(), root, archiveRoot, 'gemini', 'codex', 'T');
  assert.ok(deny.some((p) => p.endsWith(name)), `v2 审查件应进 gemini 的禁读集：${JSON.stringify(deny)}`);
});

// ── topic resolve 的三个轮次旗标 ──

async function fakeCtx(): Promise<Ctx> {
  const root = await scratchDir('trivium-rounds-');
  await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(root);
  return {
    config: defaultConfig(), projectRoot: root, archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'), sources: ['<test>'],
  };
}

test('R15 命令 A：两阶段分别指定；--max-rounds 同时作用、专属的优先；都不写为 null', async () => {
  const ctx = await fakeCtx();
  const a = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做点事', '--topic', 'T', '--max-rounds-plan', '2', '--max-rounds-code', '5'] });
  assert.deepEqual(a.max_rounds, { plan: 2, code: 5 });
  const b = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做点事', '--topic', 'T', '--max-rounds', '4', '--max-rounds-code', '6'] });
  assert.deepEqual(b.max_rounds, { plan: 4, code: 6 });
  const c = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做点事', '--topic', 'T'] });
  assert.deepEqual(c.max_rounds, { plan: null, code: null });
  assert.equal(c.task_goal, '做点事', '旗标不被吞进正文');
  assert.deepEqual(c.max_rounds_effective, { plan: 3, code: 3 }, '播报用的生效值：都没写即缺省 3');
});

test('R25 命令 A 的播报生效值按「旗标 → 配置 → 缺省」算，透传值仍只认旗标', async () => {
  const ctx = await fakeCtx();
  ctx.config.review.plan_rounds = 5;
  ctx.config.review.code_rounds = 7;
  const a = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做点事', '--topic', 'T', '--max-rounds-code', '2'] });
  assert.deepEqual(a.max_rounds, { plan: null, code: 2 }, '透传只认旗标：null 不传，起链时由编排器读配置，来源才记得准');
  assert.deepEqual(a.max_rounds_effective, { plan: 5, code: 2 });
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const b = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['看安全', '--topic', 'T'] });
  assert.deepEqual(b.max_rounds_effective, { plan: null, code: 7 }, '本命令不涉及的阶段为 null');
});

test('R16 越界退 64；命令 C 只认 --max-rounds、写阶段专属旗标退 64', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做点事', '--topic', 'T', '--max-rounds-plan', '11'] }),
    (e: { code?: number; message: string }) => e.code === EXIT.USAGE && /--max-rounds-plan 取 1～10/.test(e.message),
  );
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const ok = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['看安全', '--topic', 'T', '--max-rounds', '2'] });
  assert.deepEqual(ok.max_rounds, { plan: null, code: 2 });
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['看安全', '--topic', 'T', '--max-rounds-code', '2'] }),
    (e: { code?: number; message: string }) => e.code === EXIT.USAGE && /请改用 --max-rounds/.test(e.message),
  );
});

test('R17 根因审不进循环：任一轮次旗标都退 64', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, 'T', 'bug');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ['2026-10-01', 'T', 'claude'].join('-') + '.md'), '# 根因\n', 'utf8');
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'bug', rawArgs: ['看根因', '--topic', 'T', '--max-rounds', '2'] }),
    (e: { code?: number; message: string }) => e.code === EXIT.USAGE && /根因审不进多轮评审循环/.test(e.message),
  );
});
