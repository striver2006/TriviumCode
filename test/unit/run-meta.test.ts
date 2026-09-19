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
import { latestRunMeta, newRunMeta, migrateRunMetaV1, readRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { validateRunMeta, validateRunMetaV1, validateDispositionFrontMatter } from '../../src/trivium/schemas.js';
import { checkStageArtifacts, metaDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import { parseArtifactName } from '../../src/trivium/naming.js';
import { parseDisposition } from '../../src/trivium/disposition.js';
import { DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { CRITICS, CRITIC_VENDOR, type CriticId, type RunMeta } from '../../src/trivium/types.js';
import { REPO_ROOT } from '../helpers/fixture.js';

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
    profile_requested: null, model_provider: null,
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

// ── driver_enabled：M9 第 5 步「放行但如实标注」的留痕落点（T-8）──

test('driver_enabled 恒写：缺省 Driver 那一路也要有值', () => {
  /*
   * 恒写而不是条件展开。缺失时既可能是旧留痕、也可能是本步漏传，事后分不开——
   * 与 `profile_requested` / `model_provider` 恒写是同一条口径。
   */
  assert.equal(skeleton().driver_enabled, true);
  assert.deepEqual(validateRunMeta(skeleton()), []);
});

test('driver_enabled: false 是合法留痕——M9 只校验「已登记」，不校验 driverEnabled', () => {
  /*
   * 这正是本步刻意接受的形态：校验 `driverEnabled` 会让第 6 步验收跑不成
   * （当前只有 claude 启用为 Driver，而验收恰恰要 claude 当审核者）。
   * 放行的代价由这个字段兜住，所以它必须能通过校验、而不是被判成坏留痕。
   */
  const meta = skeleton({ driver: 'gemini', driverEnabled: false, criticsSelected: ['glm'] });
  assert.equal(meta.driver, 'gemini');
  assert.equal(meta.driver_enabled, false);
  assert.deepEqual(validateRunMeta(meta), [], 'driver_enabled: false 必须是合法留痕');
});

// ── latestRunMeta：闸门区 driver 与轮次的权威来源（M9 第 5 步）──

test('latestRunMeta：按 run_id 取最新一条，字典序即时序是构造保证', async () => {
  /*
   * `newRunId()` 是 `toISOString()` 去掉分隔符与毫秒，即 `YYYYMMDDTHHMMSSZ`——
   * **定宽 UTC**，所以字典序即时序：没有时区、没有变长、没有前导零问题。
   * 这是构造保证而非经验规律，所以这里可以放心按字符串排序取最新。
   */
  const layout = await tmpLayout();
  for (const [id, driver] of [
    ['20260101T000000Z', DEFAULT_DRIVER],
    ['20260918T160720Z', 'gemini'],
    ['20260301T120000Z', 'glm'],
  ] as const) {
    await writeRunMeta(layout, 'plan', skeleton({ runId: id, driver, criticsSelected: ['codex'] }));
  }
  const r = await latestRunMeta(layout, 'plan');
  assert.equal(r.meta?.run_id, '20260918T160720Z', '取的应当是时间最晚的那一条');
  assert.equal(r.meta?.driver, 'gemini', 'driver 要由留痕权威给出，而不是按后缀反推');
  assert.equal(r.scanned, 3);
  assert.deepEqual(r.unreadable, [], '三份都读得出来，不该有跳过记录');
});

test('latestRunMeta：读不出来的那条往下跳，不是整个返回 null', async () => {
  const layout = await tmpLayout();
  await writeRunMeta(layout, 'plan', skeleton({ runId: '20260101T000000Z', criticsSelected: ['codex'] }));
  // 搅坏最新那一份：契约不认（不是合法 run.v2/v1）
  await fs.writeFile(path.join(metaDir(layout, 'plan'), 'run-20260918T160720Z.json'), '{"schema":"???"}');
  const r = await latestRunMeta(layout, 'plan');
  assert.equal(
    r.meta?.run_id, '20260101T000000Z',
    '最新那条读不出来时应当往下试，而不是让整个闸门失去依据',
  );
  /*
   * **跳过要留下痕迹**（代码双审 CODEX-02）：静默跳过会让闸门把轮次与 run_id
   * 一并变旧，若上一轮本就裁决齐备，--check 会返回 ok，而最新一轮落盘的审查件
   * 从未被裁决检查过——人看到的只是「第 N-1 轮通过了」。
   */
  assert.deepEqual(r.unreadable, ['20260918T160720Z'], '被跳过的那份要能被调用方看见');
});

test('latestRunMeta：区分「一份都没有」与「有但全读不出」', async () => {
  /*
   * 两者压成同一个 null 时，调用方只能给出同一句「请先跑一次双审」，
   * 而 `--check-artifacts` 更是直接按缺省 Driver 继续——回落把「留痕坏了」
   * 悄悄变成「按 claude 判」（代码双审 AGY-01 / GLM-02）。
   */
  const empty = await tmpLayout();
  const a = await latestRunMeta(empty, 'plan');
  assert.deepEqual(
    { meta: a.meta, scanned: a.scanned }, { meta: null, scanned: 0 },
    '目录不存在 = 还没跑过，属正常',
  );

  const broken = await tmpLayout();
  await writeRunMeta(broken, 'plan', skeleton({ runId: '20260101T000000Z', criticsSelected: ['codex'] }));
  await fs.writeFile(path.join(metaDir(broken, 'plan'), 'run-20260101T000000Z.json'), '{"schema":"???"}');
  const b = await latestRunMeta(broken, 'plan');
  assert.equal(b.meta, null);
  assert.equal(b.scanned, 1, '扫到过文件——调用方据此硬失败，而不是按「还没跑过」处理');
  assert.deepEqual(b.unreadable, ['20260101T000000Z']);
});

test('历史留痕没有 driver_enabled 也必须读得回（M10 收紧校验之后仍要成立）', () => {
  /*
   * **本步唯一真正不可逆的选择**：归档里会出现 `driver_enabled: false` 的留痕。
   * 反过来，早于本步的留痕整个字段缺失——缺失即「无从得知」，不等于 false。
   * 所以它不进 `required`、不加 `if/then`；这条用例是那个决定的回归锁。
   */
  const meta = skeleton() as unknown as Record<string, unknown>;
  delete meta['driver_enabled'];
  assert.deepEqual(
    validateRunMeta(meta), [],
    'driver_enabled 一旦被当成必填，全部历史留痕会集体读不回',
  );
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
  /*
   * 取 **v1 契约认得的那一家**，写死 `gemini` 而不是从任何当代集合里取。
   *
   * v1 是历史契约：它的 `critics` 只声明 gemini / glm 两个属性、`vendor` 只枚举两值
   * （见 run.v1.json）。codex 到 M8 才启用，**不可能出现在任何历史 v1 记录里**，
   * 拿它构造 v1 夹具会被 ajv 如实拒掉——那不是缺陷，是契约边界。
   *
   * 本行原写 `DEFAULT_CRITICS[0]`，理由与上面那段完全一致、**取值方式却与它相悖**：
   * 缺省集合是**当代**概念，会随注册表变（D4-4 把 codex 纳入缺省后，它就排到了第一位，
   * 夹具当场被 ajv 拒）。历史契约的夹具只能用历史契约里存在的身份——
   * 这个身份不会再变，写死才是对的。
   */
  const only = 'gemini' as const;
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

/**
 * 真实语料回归：**归档里已有的运行元数据必须都还读得回**（第 2 轮 GLM-01②）。
 *
 * ## 为什么要有这一条
 *
 * `cmdGate` 现在把「扫到但一份都读不出」判成硬失败——方向是对的，但它的代价是：
 * 某个阶段的历史留痕一旦集体失校，那个主题的三条子命令会**一起锁死**，
 * 而用户手上没有任何合法自救手段（改或删 run-*.json 会撞提交锚）。
 *
 * 触发条件不是假想：本仓把 schema 收严当常规动作（给 run.v2 加 required、
 * 改注册表的 vendor / id、调 `checkAgentIdentities`），每一次都可能让老留痕失校。
 * 而在这条用例之前，对「契约演进不得锁死老主题」只有**纪律**和 `driver_enabled`
 * 一个字段的回归锁——覆盖面远不够。
 *
 * 本条把纪律换成机制：任何未来的收紧，在合入当场就红，而不是等到某个老主题
 * 的闸门被锁死时才发现。这与本仓「靠记性的纪律换成不依赖记性的机制」同源。
 *
 * ## 论域
 *
 * 只收 plan / code / bug 三个阶段——那正是 `latestRunMeta` 读的那三个。
 * verify 阶段不在其内（归档里已知有一份 v1 形状的记录缺 7 个字段，
 * 它不进 `latestRunMeta`，锁它只会把无关的历史包袱变成红灯）。
 */
test('真实语料：归档里 plan/code/bug 三阶段的运行元数据必须都还读得回', async () => {
  const archiveRoot = path.join(REPO_ROOT, '.reviews');
  let topics: string[];
  try {
    topics = (await fs.readdir(archiveRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // 全新仓库还没有归档，本条无语料可测
  }

  const bad: string[] = [];
  let scanned = 0;
  for (const topic of topics) {
    const l: ArchiveLayout = { archiveRoot, topic };
    for (const stage of ['plan', 'code', 'bug'] as const) {
      let files: string[];
      try {
        files = await fs.readdir(metaDir(l, stage));
      } catch {
        continue;
      }
      for (const f of files) {
        const id = /^run-(.+)\.json$/.exec(f)?.[1];
        if (!id) continue;
        scanned++;
        if (!(await readRunMeta(l, stage, id))) bad.push(`${topic}/${stage}/${id}`);
      }
    }
  }

  assert.ok(scanned > 0, `.reviews 下一份运行元数据都没扫到（${topics.length} 个主题）——本条失去语料`);
  assert.deepEqual(
    bad, [],
    '下列历史留痕按当前契约读不回来了。\n' +
      '  这不是「那些文件坏了」，而是**契约收紧把老主题锁死了**：\n' +
      '  cmdGate 对「扫到但全读不出」是硬失败，那几个主题的 gate 三条子命令会一起失效，\n' +
      '  而用户改不得也删不得（run-*.json 是提交时的完整性锚）。\n' +
      '  要么让新契约兼容旧形状（加可选字段、不进 required、不加 enum），\n' +
      '  要么给一条显式迁移；不要直接放宽本条。\n' +
      `  读不回的：${bad.join('、')}`,
  );
});

/*
 * ───────── N-3：契约放宽也不得让存量留痕失校（EV-66）─────────
 *
 * 上一条守的是运行元数据，这条守裁决件的 front-matter，形状同构、理由同源。
 *
 * 触发它的是一次**放松**（`role` 由 `const: "claude"` 改为「任意已登记 Agent」），
 * 而放松方向按说不会让老件失校。那为什么还要锁？因为放宽的同时**补了一段新校验**
 * （注册表身份检查）——净效果不是纯放松，而是「换了一格守法」。
 * 归档里每一份裁决件的 `role` 都是 `claude`，它必须仍然是已登记 Agent；
 * 哪天有人从注册表里摘掉一家（或改了 id 的拼法），这些历史留痕会集体失校，
 * 而症状与上一条一样：那些主题的闸门锁死，用户改不得也删不得。
 *
 * **两条断言，少一条都不成立**（计划双审 CODEX-F01 第 6 条）：
 *   · `scanned > 0` —— 论域下限。发现式写错、归档改名或移动，都会让扫描
 *     零命中而用例照常绿。本仓已经记过四次「论域悄悄缩小、测试照常全绿」。
 *   · 后缀 == `fm.role` —— 这才是作者身份那道锁在**全量历史**上的投影。
 *     只校 schema 的话，一份「文件名 -revised-codex.md + front-matter role: claude」
 *     的自相矛盾件在这里看不出来，而那正是「作者身份自相矛盾」的定义。
 *     后缀一律走 `parseArtifactName` 解析，不另写正则——那会变成第二份命名规则。
 */
test('真实语料：归档里全部裁决件的 front-matter 仍过 disposition.v1（含作者身份）', async () => {
  const archiveRoot = path.join(REPO_ROOT, '.reviews');
  let topics: string[];
  try {
    topics = (await fs.readdir(archiveRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // 全新仓库还没有归档，本条无语料可测
  }

  const bad: string[] = [];
  let scanned = 0;
  for (const topic of topics) {
    for (const stage of ['plan', 'code', 'bug'] as const) {
      const dir = path.join(archiveRoot, topic, stage);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        const parsed = parseArtifactName(f);
        if (!parsed || parsed.kind === null) continue; // 只收裁决件（revised / response）
        scanned++;
        const md = await fs.readFile(path.join(dir, f), 'utf8');
        const fm = parseDisposition(md).frontMatter;
        if (!fm) {
          bad.push(`${topic}/${stage}/${f}：front-matter 解析不出`);
          continue;
        }
        const problems = validateDispositionFrontMatter(fm);
        if (problems.length > 0) bad.push(`${topic}/${stage}/${f}：${problems.join('；')}`);
        if (fm.role !== parsed.role) {
          bad.push(`${topic}/${stage}/${f}：文件名后缀是 ${parsed.role}、front-matter 的 role 是 ${String(fm.role)}`);
        }
      }
    }
  }

  assert.ok(scanned > 0, `.reviews 下一份裁决件都没扫到（${topics.length} 个主题）——本条失去语料`);
  assert.deepEqual(
    bad, [],
    '下列历史裁决件按当前契约不再合法。\n' +
      '  归档是不可变工件：契约演进不得让老主题的闸门读不回自己的留痕。\n' +
      '  若是身份校验判的，先确认注册表里是不是摘掉/改名了某一家；\n' +
      '  若是后缀与 role 不符，那份件的作者身份本身就是矛盾的，要查它是怎么落盘的。\n' +
      `  ${bad.join('\n  ')}`,
  );
});
