/**
 * EV-134：裁决件 `addresses` 由「只核非空」收紧为真判据（计划 r2 §6.4，用户 2026-09-26 定 (a) 严格）。
 *
 * 判据：每项都指向本轮某个有效侧的审查文档、不重复、份数 = 有效侧数；写法接受文件名，或以
 * `<主题>/<阶段>/<文件名>` 结尾的路径。期望集为空（run 元数据读不出 / 没有一侧落了审查文档）时退回只核非空并告警。
 *
 * 历史背景：本仓 154 份裁决件里 65 份把**意见编号**填进 addresses 照样过闸（入口资产从没说过该填什么），
 * 而按模板照填文件名的 glm / codex 反而是对的那一方——这正是收紧前「名存实亡」的形状。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkAdjudication, expectedReviewDocs } from '../../src/trivium/gate.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { writeArtifact, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { Review, RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '登录重构';
const DATE = '2026-09-10';
const GEM = `${DATE}-${TOPIC}-gemini.md`;
const GLM = `${DATE}-${TOPIC}-glm.md`;
const COD = `${DATE}-${TOPIC}-codex.md`;

async function layout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-addr-');
  return { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
}

const review = (id: string): Review => ({
  schema: 'trivium.review.v1', verdict: 'approve-with-nits', summary: '总判断若干字，足够长以通过完整性检查。',
  findings: [{ id, severity: 'minor', layer: 'plan', kind: 'correctness', location: 'plan §1', problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high' }],
  not_covered: ['x'], consulted: ['src/a.ts'],
});

/** 落一份裁决件：addresses 由调用方给，裁决表恒齐备——只让 addresses 这一格决定成败 */
async function putDisposition(l: ArchiveLayout, addresses: string[]): Promise<void> {
  const md = [
    '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan', 'role: claude', 'kind: revised', 'run_id: R1',
    'addresses:', ...addresses.map((a) => `  - ${a}`), '---', '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |', '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| AGY-01 | gemini | minor | 接受 | 确认成立 | §1 |', '| GLM-01 | glm | minor | 接受 | 确认成立 | §2 |', '',
  ].join('\n');
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: md, date: DATE });
}

async function check(addresses: string[], reviewDocs: readonly string[] | null) {
  const l = await layout();
  await putDisposition(l, addresses);
  return checkAdjudication({
    expectedDegradedIds: [],
    cfg: defaultConfig(), layout: l, stage: 'plan', rerunIndex: 1,
    reviews: { gemini: review('AGY-01'), glm: review('GLM-01') },
    degraded: false, reviewDocs,
  });
}

const addrFailure = (r: Awaited<ReturnType<typeof check>>) =>
  r.failures.find((f) => f.code === 'bad_front_matter' && f.message.includes('addresses'));

// ── checkAdjudication 的判据 ──

test('契约形态（两份审查文档文件名）⇒ 通过', async () => {
  const r = await check([GEM, GLM], [GEM, GLM]);
  assert.equal(r.ok, true, JSON.stringify(r.failures));
});

test('意见编号形态 ⇒ bad_front_matter，文案点名期望的文件名并给两档出口', async () => {
  const r = await check(['AGY-01', 'GLM-01'], [GEM, GLM]);
  const f = addrFailure(r);
  assert.ok(f, JSON.stringify(r.failures));
  assert.match(f!.message, /不是本轮的审查文档：AGY-01、GLM-01/);
  assert.ok(f!.message.includes(`${GEM}、${GLM}`), '要列出期望的文件名，在途轮次才照得着改');
  assert.match(f!.message, /已提交的历史轮次，不要改已提交的裁决件/);
  assert.match(f!.message, /在途轮次，把 addresses 改成上面这些文件名后重跑 --check/);
});

test('少一份 ⇒ 红，点名缺哪份', async () => {
  const f = addrFailure(await check([GEM], [GEM, GLM]));
  assert.ok(f);
  assert.match(f!.message, new RegExp(`缺：${GLM.replace(/\./g, '\\.')}`));
});

test('多列一份不属本轮的文档（上一轮的名字）⇒ 红', async () => {
  const f = addrFailure(await check([GEM, GLM, `${DATE}-${TOPIC}-r2-glm.md`], [GEM, GLM]));
  assert.ok(f);
  assert.match(f!.message, /不是本轮的审查文档：.*-r2-glm\.md/);
});

test('重复 ⇒ 红', async () => {
  const f = addrFailure(await check([GEM, GEM, GLM], [GEM, GLM]));
  assert.ok(f);
  assert.match(f!.message, /重复：/);
});

test('项目根相对路径（glm 按模板照填的形态）⇒ 通过；指到别的阶段 ⇒ 红', async () => {
  const ok = await check([`.reviews/${TOPIC}/plan/${GEM}`, `${TOPIC}/plan/${GLM}`], [GEM, GLM]);
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));
  const bad = addrFailure(await check([`.reviews/${TOPIC}/code/${GEM}`, GLM], [GEM, GLM]));
  assert.ok(bad, '同名文件在别的阶段目录下，不是本轮的审查文档');
});

test('期望集为空（运行元数据读不出 / 没有一侧落了审查文档）⇒ 只核非空并告警，不判红', async () => {
  for (const docs of [null, []] as const) {
    const r = await check(['随便写什么'], docs);
    assert.equal(addrFailure(r), undefined, `${JSON.stringify(docs)}：期望集为空时严格判没有任何诚实写法能过（CODEX-02）`);
    assert.ok(r.warnings.some((w) => w.code === 'addresses_unchecked'), JSON.stringify(r.warnings));
  }
  // 非空这一格仍在
  const empty = await check([], [GEM, GLM]);
  assert.ok(empty.failures.some((f) => f.message.includes('addresses 为空')));
});

// ── expectedReviewDocs：期望集从 run.json 派生 ──

function meta(critics: Record<string, string>, artifacts: string[]): RunMeta {
  return {
    critics_selected: Object.keys(critics),
    critics: Object.fromEntries(Object.entries(critics).map(([c, status]) => [c, { status }])),
    artifacts: artifacts.map((p) => ({ path: p, sha256: 'x' })),
  } as unknown as RunMeta;
}

const LAYOUT: ArchiveLayout = { archiveRoot: '/a/.reviews', topic: TOPIC };
const at = (f: string, stage = 'plan') => `${TOPIC}/${stage}/${f}`;

test('期望集：ok 与 parse_fallback 侧计入，failed / timeout 侧不计（单审降级只列幸存侧）', () => {
  const m = meta({ codex: 'failed', gemini: 'ok', glm: 'parse_fallback' }, [at(GEM), at(GLM), at(`_meta/review-gemini-R1.json`)]);
  assert.deepEqual(expectedReviewDocs(LAYOUT, 'plan', m), [GEM, GLM]);
  const t = meta({ codex: 'timeout', gemini: 'ok' }, [at(GEM)]);
  assert.deepEqual(expectedReviewDocs(LAYOUT, 'plan', t), [GEM]);
  /*
   * 以状态为准，不以「artifacts 里有没有」为准（变异 M10 第一轮没咬住后补）：上面两格里失败侧本就没有登记文档，
   * 「把失败 / 超时侧也算进有效侧」观测不到差别。这里构造失败侧名下登记了一份文档——那一侧没有结构化结论、
   * 闸门不要求裁决它的意见，addresses 也就不该被要求列它。
   */
  const stray = meta({ codex: 'failed', gemini: 'ok' }, [at(COD), at(GEM)]);
  assert.deepEqual(expectedReviewDocs(LAYOUT, 'plan', stray), [GEM]);
});

test('期望集：Driver 原稿、裁决件、_meta、别的阶段一律不算；撞名抬升与跨零点按登记的实际名字', () => {
  const m = meta({ codex: 'ok', gemini: 'ok' }, [
    at(`${DATE}-${TOPIC}-claude.md`), // Driver 原稿（后缀不属有效侧）
    at(`${DATE}-${TOPIC}-revised-codex.md`), // 裁决件形态（kind 非空）
    at(`_meta/brief-codex-R1.md`),
    at(COD, 'code'), // 别的阶段
    at(`${DATE}-${TOPIC}-r2-codex.md`), // 撞名抬升后的实际落盘名
    at(`2026-09-11-${TOPIC}-gemini.md`), // 跨零点：文件名日期与 run 日期不同
  ]);
  assert.deepEqual(expectedReviewDocs(LAYOUT, 'plan', m), [`${DATE}-${TOPIC}-r2-codex.md`, `2026-09-11-${TOPIC}-gemini.md`]);
});

test('期望集：没有一侧落了审查文档（全侧失败 / 跳过轮 / 骨架）⇒ 空集', () => {
  assert.deepEqual(expectedReviewDocs(LAYOUT, 'plan', meta({ codex: 'failed', gemini: 'timeout' }, [])), []);
  assert.deepEqual(expectedReviewDocs(LAYOUT, 'plan', meta({}, [])), []);
});
