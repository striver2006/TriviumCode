/**
 * 运行元数据 v2：写侧形状、注册表身份校验、v1 → v2 内存迁移、读侧按 schema 分发。
 *
 * 对应设计 §6.7.1（M7b 第 3 步）。`listRecordedRuns` 那一侧的按阶段分发在
 * `archive.test.ts`——两者是同一条规格的两个消费者：前者服务 gate / report，
 * 后者服务提交完整性锚。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { newRunMeta, migrateRunMetaV1, readRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { validateRunMeta, validateRunMetaV1 } from '../../src/trivium/schemas.js';
import { checkStageArtifacts, metaDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import { DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { CRITICS, CRITIC_VENDOR, type CriticId, type RunMeta } from '../../src/trivium/types.js';

async function tmpLayout(): Promise<ArchiveLayout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-runmeta-'));
  return { archiveRoot: path.join(root, '.reviews'), topic: '登录重构' };
}

const skeleton = (over: Partial<Parameters<typeof newRunMeta>[0]> = {}): RunMeta =>
  newRunMeta({
    runId: 'R1', topic: '登录重构', stage: 'plan', rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
    denyPaths: [], driftPolicy: 'warn',
    ...over,
  });

/** 一份合法的逐侧运行事实，vendor 取自注册表而不是写死 */
function sideMeta(c: CriticId): NonNullable<RunMeta['critics'][CriticId]> {
  return {
    vendor: CRITIC_VENDOR[c],
    cli_version: '1.0',
    model_requested: 'm', model_effective: 'm', model_effective_source: 'envelope',
    status: 'ok', exit_code: 0, duration_s: 1,
    tool_calls: {}, evidence_ok: true, heterogeneous: true,
  };
}

// ─────────────────────────── 写侧形状 ───────────────────────────

test('骨架写的是 run.v2，且带上 driver 与入选集合', () => {
  const meta = skeleton();
  assert.equal(meta.schema, 'trivium.run.v2');
  assert.equal(meta.driver, DEFAULT_DRIVER);
  assert.deepEqual(meta.critics_selected, [...CRITICS]);
  assert.deepEqual(validateRunMeta(meta), []);
});

test('骨架的完成度是 full：此刻还没有任何一侧失败', () => {
  assert.equal(skeleton().review_mode, 'full');
});

test('入选集合按传入值落盘，不回落到当前启用集合', () => {
  const only = CRITICS[0]!;
  const meta = skeleton({ criticsSelected: [only] });
  assert.deepEqual(meta.critics_selected, [only]);
  assert.deepEqual(validateRunMeta(meta), [], '选 1 审是配置意图，必须是合法形状');
});

test('入选集合为空 → 校验不过（一次审查至少要有一个审核者）', () => {
  assert.ok(validateRunMeta({ ...skeleton(), critics_selected: [] }).length > 0);
});

test('完成度只收 full / partial，v1 的旧取值一律拒绝', () => {
  for (const bad of ['dual', 'single', 'whatever']) {
    assert.ok(
      validateRunMeta({ ...skeleton(), review_mode: bad }).length > 0,
      `${bad} 不该被 v2 接受`,
    );
  }
});

test('critics 接受动态键：不再是 v1 那种「恰两键」', () => {
  const meta = skeleton();
  for (const c of CRITICS) meta.critics[c] = sideMeta(c);
  assert.deepEqual(validateRunMeta(meta), []);
});

// ─────────────── 注册表身份校验（ajv 之后的第二段）───────────────

/*
 * 这一段不能塞进 JSON schema：Agent id 与厂商的唯一来源是注册表（纪律 7），
 * 在 schema 里再抄一份就制造第二个来源，新增一家时改一漏二不会报错。
 * v1 的 schema 正是那么写死两家的，也正是本次必须升版的直接原因。
 */
test('driver 不是已登记 Agent → 校验不过', () => {
  assert.ok(validateRunMeta({ ...skeleton(), driver: 'nobody' }).length > 0);
});

test('入选集合含未登记 id → 校验不过', () => {
  assert.ok(validateRunMeta({ ...skeleton(), critics_selected: ['nobody'] }).length > 0);
});

test('critics 的键是未登记 id → 校验不过', () => {
  const meta = skeleton() as unknown as { critics: Record<string, unknown> };
  meta.critics['nobody'] = sideMeta(CRITICS[0]!);
  assert.ok(validateRunMeta(meta).length > 0);
});

/*
 * `critics` 的键必须取自 `critics_selected`（设计 6.7.1，审查意见 AGY-02）。
 *
 * 这是条跨字段约束，JSON schema 表达不了——正是两段式校验该兜住的那类缺口。
 * 下面两条是成对的：**子集成立、相等不成立**，缺了后一条就会有人把它写成相等，
 * 而那会把「入选却整侧失联」这种合法留痕判成非法。
 */
test('critics 的键不在入选集合里 → 校验不过（跑出结果的一侧必定是入选的）', () => {
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  const meta = skeleton({ criticsSelected: [a] });
  meta.critics[b] = sideMeta(b);
  const problems = validateRunMeta(meta);
  assert.ok(problems.length > 0, '自相矛盾的留痕必须被拒');
  assert.ok(problems.some((p) => p.includes(b)), `报错应点名是哪一侧，实得：${problems.join('；')}`);
});

test('入选却整侧失联：critics 少一个键仍合法（只断言子集，不断言相等）', () => {
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  const meta = skeleton({ criticsSelected: [a, b] });
  meta.critics[a] = sideMeta(a); // b 侧连结果条目都没有
  assert.deepEqual(
    validateRunMeta(meta), [],
    '那种轮次由 gate 判缺件，不该在 schema 层被拒——写成相等就会把它误判成非法留痕',
  );
});

/*
 * 校的是「与该 id 登记的厂商相符」，不只是「是个已知厂商」。
 * 只校后者的话，把某侧的 vendor 换成另一家的照样通过——而 vendor 是适配器路由
 * 与禁读矩阵的依据，写错的留痕会把事后对账引到错误的一侧。
 */
test('某侧 vendor 与注册表登记的不符 → 校验不过', () => {
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  const meta = skeleton();
  meta.critics[a] = { ...sideMeta(a), vendor: CRITIC_VENDOR[b] };
  const problems = validateRunMeta(meta);
  assert.ok(problems.length > 0, '张冠李戴的 vendor 必须被拒');
  assert.ok(problems.some((p) => p.includes(a)), `报错应点名是哪一侧，实得：${problems.join('；')}`);
});

// ─────────────────── v1 → v2 内存迁移（只在读侧）───────────────────

const v1Raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'trivium.run.v1',
  run_id: 'RV1', topic: '登录重构', stage: 'plan', rerun_index: 1, command: 'x',
  prompt_hint: null, task_goal: null,
  snapshot: {
    git_head: null, tree_hash: 'h', dirty: false, subject_sha256: 's',
    drift: { changed: false, files: [], policy: 'warn' },
  },
  started_at: 'x', finished_at: 'y',
  review_mode: 'dual', degraded_reason: null,
  critics: {},
  deny_paths: [],
  guard: { readonly_breach: false, peer_artifact_read: false, peer_deny_applied: {}, forged_role_file: false },
  artifacts: [], gate: { adjudication_complete: false, state: 'running' }, status: 'success',
  ...over,
});

test('迁移：dual → full、single → partial', () => {
  assert.equal(migrateRunMetaV1(v1Raw({ review_mode: 'dual' })).review_mode, 'full');
  assert.equal(migrateRunMetaV1(v1Raw({ review_mode: 'single' })).review_mode, 'partial');
});

test('迁移：driver 缺省为 claude（v1 时代 Driver 是系统常量）', () => {
  assert.equal(migrateRunMetaV1(v1Raw()).driver, DEFAULT_DRIVER);
});

test('迁移：入选集合由 critics 的实有键推导', () => {
  const only = CRITICS[0]!;
  const m = migrateRunMetaV1(v1Raw({ critics: { [only]: sideMeta(only) } }));
  assert.deepEqual(m.critics_selected, [only]);
});

/*
 * 迁移**不会把信息变多**。v1 里「入选但整侧失联」与「压根没入选」本就分不开，
 * 键集是当时能拿到的最好近似——调用方据此判缺件时，对 v1 记录的结论仍只有 v1 那么准。
 * 把这条写成用例，是免得日后有人以为迁移能补回历史留痕缺失的事实。
 */
test('迁移是有损的：v1 没跑出结果的一侧，迁移后同样不在入选集合里', () => {
  assert.deepEqual(migrateRunMetaV1(v1Raw({ critics: {} })).critics_selected, []);
});

test('迁移产出的形状本身合 v2 契约（除非源记录缺了 v2 的必填项）', () => {
  const only = CRITICS[0]!;
  const m = migrateRunMetaV1(v1Raw({ critics: { [only]: sideMeta(only) } }));
  assert.deepEqual(validateRunMeta(m), []);
});

test('落盘的 v1 原件仍按 v1 契约成立——迁移只发生在内存里', () => {
  assert.deepEqual(validateRunMetaV1(v1Raw()), []);
});

// ─────────────────── 读侧按 schema 分发（readRunMeta）───────────────────

async function putRaw(l: ArchiveLayout, runId: string, body: unknown): Promise<void> {
  const dir = metaDir(l, 'plan');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `run-${runId}.json`), JSON.stringify(body));
}

test('读侧：写进去的 v2 原样读回来', async () => {
  const l = await tmpLayout();
  const meta = skeleton({ runId: 'RW' });
  await writeRunMeta(l, 'plan', meta);
  const back = await readRunMeta(l, 'plan', 'RW');
  assert.equal(back?.schema, 'trivium.run.v2');
  assert.deepEqual(back?.critics_selected, [...CRITICS]);
});

test('读侧：历史 v1 读回来已是 v2 形状', async () => {
  const l = await tmpLayout();
  const only = CRITICS[0]!;
  await putRaw(l, 'RV1', v1Raw({ review_mode: 'single', critics: { [only]: sideMeta(only) } }));
  const back = await readRunMeta(l, 'plan', 'RV1');
  assert.equal(back?.schema, 'trivium.run.v2');
  assert.equal(back?.review_mode, 'partial');
  assert.deepEqual(back?.critics_selected, [only]);
});

/*
 * 此前这里是 `JSON.parse` 直转、**零校验**：`schema` 写成任何字符串都能读出来，
 * 而返回值会被 gate 与 report 当成事实用。
 */
test('读侧：未知 schema 返回 null，不当成事实用', async () => {
  const l = await tmpLayout();
  await putRaw(l, 'RX', { ...v1Raw(), schema: 'trivium.run.v9' });
  assert.equal(await readRunMeta(l, 'plan', 'RX'), null);
});

test('读侧：自称 v2 却不合契约 → null', async () => {
  const l = await tmpLayout();
  await putRaw(l, 'RY', { ...skeleton(), critics_selected: [] });
  assert.equal(await readRunMeta(l, 'plan', 'RY'), null);
});

test('读侧：自称 v1 却不合 v1 契约 → null', async () => {
  const l = await tmpLayout();
  await putRaw(l, 'RZ', { schema: 'trivium.run.v1', run_id: 'RZ', status: 'success' });
  assert.equal(await readRunMeta(l, 'plan', 'RZ'), null);
});

test('读侧：文件不存在仍返回 null（与「读不出来」同等对待）', async () => {
  const l = await tmpLayout();
  assert.equal(await readRunMeta(l, 'plan', 'NOPE'), null);
});

// ────────── 入选集合 vs 键集：工件校验的判缺口径（本步的实质行为变化）──────────

/*
 * 这一组是**成对**的，缺了任何一半都证明不了什么。
 *
 * `gate --check-artifacts` 要知道「本轮本该有谁的审查文档」。两个候选事实来源：
 *   · `critics_selected`：本该跑谁 ← 本步改用这个；
 *   · `critics` 的键集：实际产出了结果的 ← 第 2 步只能读这个，那时字段还不存在。
 *
 * 两者在正常轮次上**完全一致**，所以只测正常轮次是测不出差别的。
 * 差别只在一种形态下显形：某侧入选却整侧失联，连一条结果都没记上——
 * 键集里没有它，于是校验压根不去找那一侧的文档，**真实缺件被静默放过**。
 */
test('入选集合口径：整侧失联时，缺件仍被判出来', async () => {
  const l = await tmpLayout();
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  const meta = skeleton({ runId: 'RLOST', criticsSelected: [a, b] });
  meta.critics[a] = sideMeta(a); // b 侧整侧失联：连结果条目都没有
  await writeRunMeta(l, 'plan', meta);

  const back = await readRunMeta(l, 'plan', 'RLOST');
  assert.deepEqual(back?.critics_selected, [a, b], '入选事实不受「跑没跑出来」影响');

  const c = await checkStageArtifacts(l, 'plan', 1, back!.critics_selected);
  assert.equal(c.ok, false);
  assert.ok(
    c.missing.some((m) => m.includes(b)),
    `失联侧的缺件必须被点名，实得：${c.missing.join(', ')}`,
  );
});

test('键集口径（第 2 步的旧依据）：同一轮次里失联侧的缺件被静默放过', async () => {
  const l = await tmpLayout();
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  const meta = skeleton({ runId: 'RLOST', criticsSelected: [a, b] });
  meta.critics[a] = sideMeta(a);
  await writeRunMeta(l, 'plan', meta);
  const back = await readRunMeta(l, 'plan', 'RLOST');

  // 刻意按旧依据取集合，锁住「两种口径确有差别」
  const byKeys = Object.keys(back!.critics) as CriticId[];
  const c = await checkStageArtifacts(l, 'plan', 1, byKeys);
  assert.ok(
    !c.missing.some((m) => m.includes(b)),
    '旧口径下失联侧压根不进校验——这正是被修掉的漏判',
  );
});
