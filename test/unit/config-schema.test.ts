import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { defaultConfig, loadCtx } from '../../src/trivium/config.js';
import { validateConfig, validateRunMeta, validateDispositionFrontMatter } from '../../src/trivium/schemas.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { CRITICS } from '../../src/trivium/types.js';
import { AGENTS } from '../../src/trivium/agents/registry.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

/*
 * 配置原先完全不校验（审核 M12）：写错字段名只会静默落到默认值，写错枚举值
 * 会把闸门悄悄关掉。这里的每条用例都是一种「静默 fail-open」的形状。
 */

async function projectWith(configYaml: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cfg-'));
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), configYaml, 'utf8');
  return root;
}

test('内置默认配置本身合法', () => {
  assert.deepEqual(validateConfig(defaultConfig()), []);
});

test('gate: "off" 用标量顶掉整个对象 → 退 69 并点名', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngate: "off"\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.ENV);
    assert.match(e.message, /配置不合法/);
    assert.match(e.message, /gate/);
    return true;
  });
});

test('拼错枚举值（approval_lock_scope: sesion）→ 报错列出可选值，而不是反向按 global 加锁', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngate:\n  approval_lock_scope: sesion\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), (e: { message: string }) => {
    assert.match(e.message, /approval_lock_scope/);
    assert.match(e.message, /session/);
    return true;
  });
});

test('stop_hook_max_blocks: 0 会让收工拦截一次都不生效 → 拒绝', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngate:\n  stop_hook_max_blocks: 0\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /stop_hook_max_blocks/);
});

test('未知顶层字段（gates: 拼错）→ 报「未知字段」，不再静默忽略', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngates:\n  block_commit: false\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /未知字段「gates」/);
});

test('heartbeat_stale_s 写成字符串 → 拒绝（否则 NaN 让陈旧锁永不回收）', async () => {
  const root = await projectWith('schema: trivium.config.v1\nreview:\n  heartbeat_stale_s: "120"\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /heartbeat_stale_s/);
});

test('archive_root 逃出项目根 → 拒绝', async () => {
  const root = await projectWith('schema: trivium.config.v1\narchive_root: ../../tmp\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /archive_root/);
});

test('合法的覆盖（本项目自己的 config.yaml 形状）照常通过', async () => {
  const root = await projectWith([
    'schema: trivium.config.v1',
    'review:',
    '  timeout_s:',
    '    plan: 1500',
    '    code: 2700',
    '    bug: 1200',
    'profiles:',
    '  flash:',
    '    gemini: { plan: a, code: b, bug: c }',
    'verify:',
    '  build: [npm run build]',
    '  test: []',
    '',
  ].join('\n'));
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.equal(ctx.config.review.timeout_s.code, 2700);
});

// ── run.v1 与 disposition.v1 从此真的被加载（审核 M13）──

test('newRunMeta 产出的骨架符合 trivium.run.v2', () => {
  const meta = newRunMeta({
    runId: 'R1', topic: 't', stage: 'plan', rerunIndex: 1, command: 'x', promptHint: null, taskGoal: null,
    criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  assert.deepEqual(validateRunMeta(meta), []);
  assert.ok(validateRunMeta({ ...meta, status: 'weird' }).length > 0);
});

test('裁决件 front-matter 按 disposition.v1 校验', () => {
  assert.deepEqual(validateDispositionFrontMatter({
    schema: 'trivium.disposition.v1', topic: 't', stage: 'plan', role: 'claude', kind: 'revised', run_id: 'R1', addresses: ['a'],
  }), []);
  const bad = validateDispositionFrontMatter({ schema: 'trivium.disposition.v1', topic: 't', stage: 'plan', role: 'gemini', kind: 'revised', run_id: 'R1', addresses: [] });
  assert.ok(bad.some((m) => m.includes('role')), JSON.stringify(bad));
  assert.ok(bad.some((m) => m.includes('addresses')), JSON.stringify(bad));
});

/*
 * ── 「哪些厂商已有配置形状」只许有一份来源（M7b 第 6 步）──
 *
 * `schemas.ts` 此前手写 `new Set(['antigravity','zcode'])`，注释里还把
 * 「新增一家时两处要一起改」当纪律写着。那是一个第二事实源：
 *   · 只改 schema 不改它 → 配置段被 ajv 放行，再被它以「形状尚未定义」拒掉，
 *     用户拿到一条自相矛盾的报错；
 *   · 只改它不改 schema → 反过来。
 * 现在从 `config.v2.json` 的 `agents.additionalProperties.oneOf` 现取。
 */
test('可配置厂商集合从 schema 现取：oneOf 里有几支，就认几家', async () => {
  const schema = JSON.parse(
    await fs.readFile(
      path.join(REPO_ROOT, 'skills/dual-critic/schema/config.v2.json'), 'utf8',
    ),
  ) as { properties: { agents: { additionalProperties: { oneOf: { properties: { vendor: { const: string } } }[] } } } };
  const declared = schema.properties.agents.additionalProperties.oneOf
    .map((b) => b.properties.vendor.const)
    .sort();

  /*
   * 正向：schema 里声明过形状的厂商，其配置段必须能过校验。
   * 用注册表里 vendor 命中 declared 的 Agent 去构造，而不是写死 gemini / glm——
   * 写死的话这条断言自己就成了第三个事实源。
   */
  for (const vendor of declared) {
    const agent = AGENTS.find((a) => a.vendor === vendor);
    assert.ok(agent, `schema 声明了 ${vendor} 的形状，注册表里却没有这个厂商的 Agent`);
    const cfg = defaultConfig();
    assert.ok(
      cfg.agents[agent.id],
      `内置默认配置应当含 agents.${agent.id}——它是 declared 厂商，本用例靠它取到一份合法段`,
    );
    assert.deepEqual(validateConfig(cfg), [], `agents.${agent.id} 的合法配置不该被拒`);
  }

  /*
   * 反向：注册表里登记、但 schema 没给形状的厂商，配置段必须被**明确**拒绝，
   * 且报错要说清是「形状尚未定义」而不是别的——用户照着这条话才知道该等哪个里程碑。
   */
  const pending = AGENTS.filter((a) => !declared.includes(a.vendor));
  assert.ok(pending.length > 0, '注册表里应当至少有一个形状未定义的 Agent（当前是 claude / codex）');
  /*
   * **逐个**查，不是查第一个。只查 `find()` 的话，这条断言只覆盖 AGENTS 里最靠前的
   * 那一家——往手写集合里错加一个别的厂商，它照样全绿。实测确认过：
   * 把 openai 塞回手写集合时，只查首项的版本一声不吭。
   */
  for (const agent of pending) {
    const cfg = defaultConfig();
    (cfg.agents as Record<string, unknown>)[agent.id] = { vendor: agent.vendor };
    const problems = validateConfig(cfg);
    assert.ok(problems.length > 0, `agents.${agent.id} 的形状还没定义，不该被放行`);
    assert.ok(
      problems.some((p) => p.includes('形状尚未定义')),
      `agents.${agent.id} 的报错要说清真实原因（形状尚未定义），实际是：\n${problems.join('\n')}`,
    );
  }
});

/*
 * ── 探针段键集的身份校验：两段式的第二段（审查意见 GLM-08）──
 *
 * M6 第 1 步给 `probe.cli` 加了 ajv 的 `commonProbe` 形状校验——那是第一段。
 * 只有第一段的后果不是报错而是**静默不生效**：一个形状完整的未登记键
 * （例如从 zcode 段复制改名）过得了 ajv，`preflight` / `doctor` 按注册表遍历时
 * 把它忽略，而 `guard` 若按盘上实有键遍历还会消费它的 scratch_paths——
 * 一个没人登记的键能影响只读失守判定。`agents` 段的未登记键是明确报错的，
 * 两处防护强度不该差这么多。
 */

test('探针段出现未登记的 CLI 名时明确报错，而不是静默忽略', async () => {
  const { defaultProbe } = await import('../../src/trivium/config.js');
  const cfg = defaultConfig();
  // 形状完整——只有键名没登记。这正是 ajv 拦不住的那一类。
  (cfg.probe.cli as Record<string, unknown>)['zcodee'] = defaultProbe().cli.zcode;

  const problems = validateConfig(cfg);
  assert.ok(problems.length > 0, '形状再完整，键名没登记也不该放行');
  assert.ok(
    problems.some((p) => p.includes('probe.cli.zcodee')),
    `报错要点名是哪个键，实际是：\n${problems.join('\n')}`,
  );
  assert.ok(
    problems.some((p) => p.includes('registry')),
    '要指明键集的唯一来源是注册表，否则用户不知道该去哪儿加',
  );
});

test('探针段的合法键集恒等于注册表 cliName 全集', async () => {
  const { ALL_CLI_NAMES } = await import('../../src/trivium/agents/registry.js');
  // 逐个查而不是查第一个——理由同上面那条（只查首项的版本对错加的厂商一声不吭）。
  for (const name of ALL_CLI_NAMES) {
    const cfg = defaultConfig();
    assert.ok(cfg.probe.cli[name], `defaultProbe 应当为已登记的 ${name} 预留段`);
    assert.deepEqual(
      validateConfig(cfg).filter((p) => p.includes(`probe.cli.${name}`)),
      [],
      `${name} 已在注册表登记，不该被校验拒绝`,
    );
  }
});
