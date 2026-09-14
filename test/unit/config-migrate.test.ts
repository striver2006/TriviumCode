/**
 * 配置 v1 → v2：内存迁移、两段式校验、`init` 的一次性磁盘改写。
 *
 * 对应设计 §13.1.1（M7b 第 4 步）。
 *
 * 本组用例存在的理由：**旧配置不改也能跑**是这一步的核心承诺。
 * 若它失守，每个已初始化的项目都会在升级编排器的瞬间硬失败——
 * 而那种失败发生在用户机器上、在他们没做任何改动的时候。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import {
  CONFIG_SCHEMA_ID,
  CONFIG_SCHEMA_ID_V1,
  deepMerge,
  defaultConfig,
  loadCtx,
  migrateConfigV1,
} from '../../src/trivium/config.js';
import { validateConfig } from '../../src/trivium/schemas.js';
import { runInit } from '../../src/trivium/init.js';
import { CRITICS } from '../../src/trivium/types.js';

async function projectWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-mig-'));
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(root, '.trivium', name), body, 'utf8');
  }
  return root;
}

/** 一份最小但完整的 v1 配置 */
const v1Yaml = (extra = ''): string =>
  [
    `schema: ${CONFIG_SCHEMA_ID_V1}`,
    'review:',
    '  allow_single_flag: false',
    'critics:',
    '  gemini:',
    '    vendor: antigravity',
    '    bin: /custom/agy',
    '  glm:',
    '    vendor: zcode',
    '    max_turns: 99',
    extra,
    '',
  ].join('\n');

// ─────────────────────── 纯函数：migrateConfigV1 ───────────────────────

test('迁移：critics.* 搬到 agents.*，schema 标识改写为 v2', () => {
  const { config, note } = migrateConfigV1(YAML.parse(v1Yaml()));
  const c = config as Record<string, unknown>;
  assert.equal(c['schema'], CONFIG_SCHEMA_ID);
  assert.ok(c['agents'], 'critics 应已搬成 agents');
  assert.equal(c['critics'], undefined, '旧键必须移除，否则会被 v2 的未知字段校验拒掉');
  assert.ok(note, '有实质变化就要告诉用户');
});

test('迁移：allow_single_flag 搬到 allow_partial_flag，值保持不变', () => {
  const { config } = migrateConfigV1(YAML.parse(v1Yaml()));
  const review = (config as { review: Record<string, unknown> }).review;
  assert.equal(review['allow_partial_flag'], false, '值要搬过去，不是重置为默认');
  assert.equal(review['allow_single_flag'], undefined);
});

/*
 * 两个名字同时在场时**以新名为准**，并把这件事写进告警。
 * 静默取其一是最坏的选择：用户改了旧名却不生效，而且无从察觉。
 */
test('迁移：新旧名同时在场 → 以新名为准，且告警点出这件事', () => {
  const raw = YAML.parse(v1Yaml());
  raw.review.allow_partial_flag = true; // 与旧名的 false 冲突
  const { config, note } = migrateConfigV1(raw);
  const review = (config as { review: Record<string, unknown> }).review;
  assert.equal(review['allow_partial_flag'], true, '新名优先');
  assert.match(note ?? '', /同时写了/, '冲突必须说出来，不能静默取一个');
});

/*
 * **迁移不补 `default_critics`**（审查意见 AGY-01 ≡ GLM-01，两侧独立判 major）。
 *
 * 这条用例的前身断言的是「取 agents 的实有键」，理由写着「只配了一家的项目，
 * 迁移后不该被悄悄加上第二家」——**那把错误行为锁成了期望值**，比没有用例更糟。
 *
 * 错在前提：它以为 v1 的 `critics` 键集表达了「选哪几侧」。并不是。
 * `review.ts` 的选侧是 `opts.onlyCritic ? [opts.onlyCritic] : [...CRITICS]`，
 * v1 运行时走注册表全集，与配置里写了几家无关。所以「只配一家」的项目
 * 一直在跑两家；迁移后记成一家是**缩小**审查面，违反「行为不变」。
 */
test('迁移：不补 default_critics（让它自然继承默认值，不改变审查面）', () => {
  const raw = YAML.parse(v1Yaml());
  delete raw.critics.glm; // 旧配置只写了一家
  const { config } = migrateConfigV1(raw);
  const review = (config as { review: Record<string, unknown> }).review;
  assert.equal(
    review['default_critics'], undefined,
    '迁移不该凭空造出这个键——它一旦出现在片段里，deepMerge 的数组整体替换就会顶掉默认值',
  );
});

test('迁移幂等：v2 输入原样返回，不再告警', () => {
  const { config, note } = migrateConfigV1(defaultConfig());
  assert.equal(note, null);
  assert.deepEqual(validateConfig(config), []);
});

test('迁移：非对象输入不炸（YAML 可能解析出标量或 null）', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.doesNotThrow(() => migrateConfigV1(bad));
  }
});

/*
 * 覆盖片段（config.local.yaml）通常**没有 schema 字段**，却完全可能写着
 * `critics.gemini.bin` 这种本机路径覆盖。只按 schema 字段判定的话，它不会被迁移，
 * 那个 critics 段会原样穿过合并、被 v2 的未知字段校验拒掉——
 * 用户看到「你的本机配置不合法」，而真正的原因是我们改了键名。
 */
test('迁移：没有 schema 字段但有 critics 段的覆盖片段，照样迁移', () => {
  const { config, note } = migrateConfigV1({ critics: { glm: { vendor: 'zcode', max_turns: 7 } } });
  const c = config as Record<string, unknown>;
  assert.ok(c['agents'], '覆盖片段也要迁移');
  assert.equal(c['critics'], undefined);
  assert.ok(note);
});

test('迁移：只有 allow_single_flag 的覆盖片段也认得出来', () => {
  const { config, note } = migrateConfigV1({ review: { allow_single_flag: true } });
  const review = (config as { review: Record<string, unknown> }).review;
  assert.equal(review['allow_partial_flag'], true);
  assert.ok(note);
});

/*
 * 两段并存时旧段会被丢掉，**必须说出来**（审查意见 AGY-02 ≡ GLM-03）。
 * 现实触发形态：手工升级时抄入了默认 agents 段，却忘了删自己原有的 critics 覆盖。
 */
test('迁移：critics 与 agents 并存 → 以 agents 为准，且告警点出旧段被丢弃', () => {
  const raw = YAML.parse(v1Yaml());
  raw.agents = { glm: { vendor: 'zcode', max_turns: 7 } };
  const { config, note } = migrateConfigV1(raw);
  const c = config as Record<string, unknown>;
  assert.deepEqual(c['agents'], { glm: { vendor: 'zcode', max_turns: 7 } }, '以 agents 为准');
  assert.equal(c['critics'], undefined);
  assert.match(
    note ?? '', /同时写了 critics 与 agents/,
    '静默丢弃用户的自定义值是最坏的选择——它无声、且无从察觉',
  );
});

test('迁移：与 v1 无关的片段原样返回，不打扰用户', () => {
  const { config, note } = migrateConfigV1({ review: { wait_timeout_s: 60 } });
  assert.equal(note, null);
  assert.deepEqual(config, { review: { wait_timeout_s: 60 } });
});

// ─────────────── loadCtx：迁移在合并之前（顺序错了会静默失效）───────────────

/*
 * **本组最重要的一条。**
 *
 * `defaultConfig()` 已是 v2 形状（带 `agents`）。若先 deepMerge 再迁移，
 * 磁盘上的 `critics` 段只会作为一个额外的键并排落在结果里，而 `agents` 仍是内置默认——
 * 用户配的 bin / max_turns **一个都不生效，且没有任何报错**。
 * 断言「用户配的值真的生效了」，才能锁住这个顺序。
 */
test('loadCtx：v1 配置里的自定义值真的生效（锁住「先迁移、后合并」）', async () => {
  const root = await projectWith({ 'config.yaml': v1Yaml() });
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });

  assert.equal(ctx.config.schema, CONFIG_SCHEMA_ID);
  const glm = ctx.config.agents.glm;
  assert.ok(glm && glm.vendor === 'zcode');
  assert.equal(glm.max_turns, 99, '顺序错了这里会是内置默认 40，且不报错');
  const gemini = ctx.config.agents.gemini;
  assert.ok(gemini && gemini.vendor === 'antigravity');
  assert.equal(gemini.bin, '/custom/agy');
  assert.equal(ctx.config.review.allow_partial_flag, false);
});

test('loadCtx：config.local.yaml 的 v1 覆盖片段同样生效', async () => {
  const root = await projectWith({
    'config.yaml': v1Yaml(),
    'config.local.yaml': 'critics:\n  glm:\n    max_turns: 123\n',
  });
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  const glm = ctx.config.agents.glm;
  assert.ok(glm && glm.vendor === 'zcode');
  assert.equal(glm.max_turns, 123, '本机覆盖片段没被迁移的话，这里会停在 99');
});

/*
 * major 的回归锁（AGY-01 ≡ GLM-01）。**这是最贴近真实用户的一条**：
 * `config.local.yaml` 最典型的内容就是单侧本机覆盖（只改一家的 agent 名或可执行路径）。
 *
 * 修复前实测得到 `["gemini"]`——迁移给片段补上 `default_critics: ['gemini']`，
 * 而 `deepMerge` 对数组是整体替换，另一家被静默清除。
 * 本步无消费端所以不影响运行，但错值已经在配置里；第 5 步接线后就是静默单审。
 */
test('loadCtx：local 只覆盖单侧时，default_critics 仍是两家（不被片段顶掉）', async () => {
  const root = await projectWith({
    'config.yaml': v1Yaml(),
    'config.local.yaml': 'critics:\n  gemini:\n    agent: my-critic\n',
  });
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.deepEqual(
    ctx.config.review.default_critics, [...CRITICS],
    '单侧本机覆盖不该缩小审查面——设计 13.1.1：默认值维持两家',
  );
  const gemini = ctx.config.agents.gemini;
  assert.ok(gemini && gemini.vendor === 'antigravity');
  assert.equal(gemini.agent, 'my-critic', '覆盖本身要照常生效');
});

test('loadCtx：主配置只写一侧时，default_critics 同样保持全集', async () => {
  const raw = YAML.parse(v1Yaml());
  delete raw.critics.glm;
  const root = await projectWith({ 'config.yaml': YAML.stringify(raw) });
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.deepEqual(
    ctx.config.review.default_critics, [...CRITICS],
    'v1 的 critics 键集不是选侧机制，运行时本来就走全集——迁移不得改变这一点',
  );
});

test('loadCtx：磁盘文件不被改动（内存迁移的核心性质）', async () => {
  const root = await projectWith({ 'config.yaml': v1Yaml() });
  const before = await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8');
  await loadCtx({ cwd: root, allowUninitialized: true });
  const after = await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8');
  assert.equal(after, before, 'loadCtx 只读不写——磁盘改写是 init 的事');
});

// ─────────────── 两段式校验：注册表身份与跨字段规则 ───────────────

test('校验：agents 的键不是已登记 Agent → 报错并列出已登记的', () => {
  const cfg = defaultConfig() as unknown as { agents: Record<string, unknown> };
  cfg.agents['nobody'] = { vendor: 'zcode', entry: null, max_turns: 1, unsupported_override: 'reject' };
  const problems = validateConfig(cfg);
  assert.ok(problems.some((p) => p.includes('nobody')), problems.join('；'));
});

test('校验：agents.<id>.vendor 与注册表不符 → 报错（路由错配会发给另一家 CLI）', () => {
  const cfg = JSON.parse(JSON.stringify(defaultConfig()));
  cfg.agents.glm.vendor = 'antigravity';
  const problems = validateConfig(cfg);
  assert.ok(problems.some((p) => p.includes('vendor')), problems.join('；'));
});

/*
 * `criticEnabled` 的约束点在 default_critics，**不在 agents 的键上**（设计 13.1.1）：
 * Driver 自身也需要配置容身之处。M7b 计划稿 §3.2 写的是「agents 的键必须 criticEnabled」，
 * 那条会把未来的 Driver 段一并拒掉，已按设计纠正。
 */
test('校验：登记但未启用为审核者的 Agent 出现在 default_critics → 报错，不静默忽略', () => {
  const cfg = JSON.parse(JSON.stringify(defaultConfig()));
  cfg.review.default_critics = ['codex'];
  const problems = validateConfig(cfg);
  assert.ok(
    problems.some((p) => p.includes('codex')),
    `静默忽略会让用户以为第三家已经在跑了，实得：${problems.join('；')}`,
  );
});

/*
 * 「已登记」不等于「能配置」（审查意见 GLM-04）。
 *
 * 修复前这条链路会把用户引向下一个错误：配了未登记 id 得到「已登记：claude、codex、
 * gemini、glm」，照着改成 claude，却撞上 ajv oneOf 的机读错误——真正的原因
 * （形状要等 M9/M10 才定义）一个字都没说。
 */
test('校验：配了已登记但形状未定义的 Agent → 说清「形状尚未定义」，不是机读错误', () => {
  const cfg = defaultConfig() as unknown as { agents: Record<string, unknown> };
  cfg.agents['claude'] = { vendor: 'anthropic' };
  const problems = validateConfig(cfg);
  assert.ok(
    problems.some((p) => p.includes('claude') && p.includes('形状尚未定义')),
    `要让用户看懂为什么不能配，实得：${problems.join('；')}`,
  );
});

test('校验：未登记 id 的报错要区分「当前可配置」与「已登记但还配不了」', () => {
  const cfg = defaultConfig() as unknown as { agents: Record<string, unknown> };
  cfg.agents['nobody'] = { vendor: 'zcode', entry: null, max_turns: 1, unsupported_override: 'reject' };
  const problems = validateConfig(cfg);
  const hit = problems.find((p) => p.includes('nobody'));
  assert.ok(hit, problems.join('；'));
  assert.match(hit, /当前可配置/, '只列「已登记」会把用户引向下一个错误');
  assert.match(hit, /尚未定义/, '要点明哪几家虽已登记但还配不了');
});

test('校验：default_critics 里的 Agent 在 agents 中没有配置段 → 报错', () => {
  const cfg = JSON.parse(JSON.stringify(defaultConfig()));
  delete cfg.agents[CRITICS[0]!];
  const problems = validateConfig(cfg);
  assert.ok(problems.some((p) => p.includes('没有配置段')), problems.join('；'));
});

test('校验：default_critics 超过 max_critics → 报错', () => {
  const cfg = JSON.parse(JSON.stringify(defaultConfig()));
  cfg.review.max_critics = 1;
  cfg.review.default_critics = [...CRITICS];
  const problems = validateConfig(cfg);
  assert.ok(problems.some((p) => p.includes('max_critics')), problems.join('；'));
});

test('校验：迁移产出的配置本身是合法 v2', () => {
  const { config } = migrateConfigV1(YAML.parse(v1Yaml()));
  // 用 deepMerge 而不是展开运算符：后者会把 review 整段替换成迁移片段里的几个键
  assert.deepEqual(validateConfig(deepMerge(defaultConfig(), config)), []);
});

// ─────────────────── init：一次性磁盘改写 ───────────────────

async function initOn(root: string): Promise<{ report: Awaited<ReturnType<typeof runInit>>; text: string }> {
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  const report = await runInit({ ctx, assetRoot: path.join(root, 'no-assets') });
  const text = await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8');
  return { report, text };
}

test('init：把 v1 的 config.yaml 改写为 v2，并备份原文', async () => {
  const root = await projectWith({ 'config.yaml': v1Yaml() });
  const original = await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8');
  const { report, text } = await initOn(root);

  const parsed = YAML.parse(text);
  assert.equal(parsed.schema, CONFIG_SCHEMA_ID);
  assert.ok(parsed.agents, '改写后应是 agents');
  assert.equal(parsed.critics, undefined);
  assert.equal(parsed.agents.glm.max_turns, 99, '用户的自定义值必须原样保留');

  const backup = await fs.readFile(path.join(root, '.trivium/config.yaml.trivium-backup'), 'utf8');
  assert.equal(backup, original, '备份必须是逐字原文——注释只存在于这里');
  assert.ok(report.notes.some((n) => n.includes('备份')), report.notes.join('；'));
});

test('init：已是 v2 时幂等 no-op，不产生备份', async () => {
  const root = await projectWith({
    'config.yaml': YAML.stringify({ ...defaultConfig(), probe: undefined }),
  });
  const { report } = await initOn(root);
  assert.equal(
    await fs.access(path.join(root, '.trivium/config.yaml.trivium-backup')).then(() => true, () => false),
    false,
    '没有可迁移的东西就不该动磁盘',
  );
  assert.ok(report.skipped.some((s) => s.includes('config.yaml')));
});

/*
 * 备份已存在即放弃改写——与归档的防覆盖铁律同纪律：宁可不改，
 * 也不覆盖一份可能是上一次改写留下的、唯一的原文。
 * 放弃后必须**照常完成 init**：内存迁移已经让旧配置可用，
 * 为一个可选优化打断初始化不划算。
 */
test('init：备份已存在 → 放弃改写但不中断 init，并说明原因', async () => {
  const root = await projectWith({
    'config.yaml': v1Yaml(),
    'config.yaml.trivium-backup': '# 上一次改写留下的原文\n',
  });
  const original = await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8');
  const { report, text } = await initOn(root);

  assert.equal(text, original, '备份写不成时，原文件必须原样不动');
  assert.equal(
    await fs.readFile(path.join(root, '.trivium/config.yaml.trivium-backup'), 'utf8'),
    '# 上一次改写留下的原文\n',
    '既有备份不得被覆盖',
  );
  assert.ok(
    report.notes.some((n) => n.includes('跳过') && n.includes('备份')),
    `要说清为什么没改，实得：${report.notes.join('；')}`,
  );
});

/*
 * dry-run 不得落盘，报告也不得用完成时态点名一个不存在的备份（审查意见 GLM-08）。
 * 那条陈述会进 `--json` 机读输出。
 */
test('init --dry-run：不写任何文件，报告用将来时', async () => {
  const root = await projectWith({ 'config.yaml': v1Yaml() });
  const original = await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8');
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  const report = await runInit({ ctx, assetRoot: path.join(root, 'no-assets'), dryRun: true });

  assert.equal(
    await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8'), original,
    'dry-run 不得改动原文件',
  );
  assert.equal(
    await fs.access(path.join(root, '.trivium/config.yaml.trivium-backup')).then(() => true, () => false),
    false,
    'dry-run 不得产生备份',
  );
  const note = report.notes.find((n) => n.includes('config.yaml'));
  assert.ok(note, report.notes.join('；'));
  assert.match(note, /将把|将备份/, '不得用完成时态描述一个没发生的动作');
});

test('init：改写后的配置能被 loadCtx 直接加载，且不再触发迁移告警', async () => {
  const root = await projectWith({ 'config.yaml': v1Yaml() });
  await initOn(root);
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.equal(ctx.config.schema, CONFIG_SCHEMA_ID);
  assert.equal(ctx.config.agents.glm?.vendor, 'zcode');
  assert.equal(migrateConfigV1(YAML.parse(await fs.readFile(path.join(root, '.trivium/config.yaml'), 'utf8'))).note, null);
});

/*
 * ── 探针段形状迁移（M6 第 1 步，审查意见 AGY-03）──
 *
 * 本组存在的理由与上面那组一样：**旧盘不改也能跑**。
 *
 * 起草时这里是空的——我只做了真机验证，而真机恰恰只有一种形态
 * （本机 agy / zcode 两段都有真结论）。下面第 2、3 条命中的两个缺陷，
 * 真机一个都撞不上。「跑一遍真的」不能替代单测：真实环境只有一种形态，
 * 缺陷藏在其它形态里。
 */

test('探针迁移：旧平铺改为按 CLI 索引，bin / entry 统一成 entrypoint', async () => {
  const { migrateProbeSection } = await import('../../src/trivium/config.js');
  const now = new Date().toISOString();
  const { probe, note } = migrateProbeSection({
    generated_at: now,
    agy: { bin: '/x/agy', version: '1.2.2', models: ['m1'] },
    zcode: { entry: '/x/zcode.cjs', version: '0.16.5' },
  });
  const p = probe as Record<string, any>;

  assert.ok(note, '发生迁移时必须给出人读说明');
  assert.equal(p.agy, undefined, '旧的平铺键要被搬走，不能两种形状并存');
  assert.equal(p.zcode, undefined);
  assert.equal(p.cli.agy.entrypoint, '/x/agy');
  assert.equal(p.cli.zcode.entrypoint, '/x/zcode.cjs');
  assert.equal(p.cli.agy.bin, undefined, '旧名不保留——同一个事实不留两个字段');
  assert.equal(p.cli.zcode.entry, undefined);
  assert.equal(p.cli.agy.probed_at, now, '有入口的段回落到 generated_at');
  assert.deepEqual(p.cli.zcode.models, [], '缺失的共有字段补默认值');
});

test('探针迁移：从没探到入口的旧段不得被盖上时间戳', async () => {
  /*
   * AGY-02 的回归。旧盘上只跑过 `doctor --only zcode` 就是这个形态：
   * generated_at 是新鲜的，而 agy 段的 bin 为 null。
   *
   * 无条件回填 generated_at 会让这个**从没探到任何东西**的段冒充「探过」，
   * 于是 preflight 的 `if (!probe?.probed_at) continue`（没探过就跳过）失效，
   * checkProbeFreshness 还会把它报成「新鲜」——一个事实层面的错。
   */
  const { migrateProbeSection } = await import('../../src/trivium/config.js');
  const now = new Date().toISOString();
  const { probe } = migrateProbeSection({
    generated_at: now,
    agy: { bin: null, version: null },
    zcode: { entry: '/x/zcode.cjs', version: '0.16.5' },
  });
  const p = probe as Record<string, any>;

  assert.equal(p.cli.agy.probed_at, null, '没探到入口 = 没探过，不能盖时间戳');
  assert.equal(p.cli.zcode.probed_at, now, '探到了的那侧照常回落');
});

test('探针迁移：YAML 空值段不被当成旧段', async () => {
  /*
   * GLM-04 的回归。`typeof null === 'object'` 会让盘上的 `probe.agy:`（空值）
   * 通过「是对象吗」的判据，展开得 {}，再补默认字段就成了一个凭空造出来的完整段。
   */
  const { migrateProbeSection } = await import('../../src/trivium/config.js');
  const { probe, note } = migrateProbeSection({
    generated_at: new Date().toISOString(),
    agy: null,
    zcode: { entry: '/x/zcode.cjs' },
  });
  const p = probe as Record<string, any>;

  assert.equal(p.cli.agy, undefined, '空值键不该被造成一个完整探针段');
  assert.ok(p.cli.zcode, '同段里真实存在的旧结论仍要迁移');
  assert.ok(note);
});

test('探针迁移：对新形状幂等', async () => {
  const { migrateProbeSection } = await import('../../src/trivium/config.js');
  const already = {
    generated_at: new Date().toISOString(),
    cli: { agy: { entrypoint: '/x/agy', version: '1.2.2', probed_at: '2026-09-14T00:00:00.000Z' } },
  };
  const { probe, note } = migrateProbeSection(already);
  assert.equal(note, null, '已是新形状时不得报「已迁移」——那会每次 CLI 调用都打一条假告警');
  assert.deepEqual(probe, already, '原样返回');
});

test('探针迁移：已有新形状的键不被同名旧段覆写', async () => {
  /*
   * AGY-02 第三点。两种形状并存的文件（迁移写了一半、或人手工改过）
   * 若让旧段整体覆盖，新数据就丢了。
   */
  const { migrateProbeSection } = await import('../../src/trivium/config.js');
  const { probe } = migrateProbeSection({
    generated_at: new Date().toISOString(),
    agy: { bin: '/old/agy', version: '1.0.0' },
    cli: { agy: { entrypoint: '/new/agy', version: '1.2.2', probed_at: '2026-09-14T00:00:00.000Z' } },
  });
  const p = probe as Record<string, any>;
  assert.equal(p.cli.agy.entrypoint, '/new/agy', '新形状优先');
  assert.equal(p.cli.agy.version, '1.2.2');
});

test('探针迁移：不凭空造 version_probe', async () => {
  /*
   * 这条守的是一个**刻意的保守选择**：迁移无从知道该怎么取版本，
   * 编造一条可能把错误命令落成事实。缺口由预检的「无法校验」第三态点名。
   * 写成用例是为了防止日后有人「顺手补上」——那看起来像改进，实则是伪造探测结果。
   */
  const { migrateProbeSection } = await import('../../src/trivium/config.js');
  const { probe } = migrateProbeSection({
    generated_at: new Date().toISOString(),
    agy: { bin: '/x/agy', version: '1.2.2' },
  });
  const p = probe as Record<string, any>;
  assert.equal(
    p.cli.agy.version_probe, undefined,
    '迁移不得编造取版本的方式；该缺口由 preflight 的第三态如实点名',
  );
});
