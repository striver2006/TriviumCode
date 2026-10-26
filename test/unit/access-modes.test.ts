import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, mergeConfigLayer } from '../../src/trivium/config.js';
import { resolveTier, failedResult } from '../../src/trivium/adapters/base.js';
import { AGENTS } from '../../src/trivium/agents/registry.js';
import { realAdapters } from '../../src/trivium/adapters/index.js';
import { assertTierFlags, collectTierFlags } from '../../src/trivium/tier-flags.js';
import { claudeProfileMetadata, claudeRouteEnv } from '../../src/trivium/adapters/claude-route.js';
import { compareRunModels, modelFamily, familyWarnings } from '../../src/trivium/model-family.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { effectiveAccess } from '../../src/trivium/access.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { historicalRunMeta } from '../helpers/legacy-run-meta.js';
import { run, withLaunchBudget, LaunchBudgetExceeded } from '../../src/trivium/util/exec.js';
import { probeAuth } from '../../src/trivium/preflight.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scratchDir } from '../helpers/scratch.js';
import { codexRouteEnv, codexRouteEnvKey, codexNativeRouteIssue } from '../../src/trivium/adapters/codex-home.js';
import type { Ctx } from '../../src/trivium/types.js';

test('接入优先级与显式清空独立于模型/effort；native 与 profile 冲突退64', () => {
  const cfg = defaultConfig();
  const agent = cfg.agents.claude;
  assert.ok(agent?.vendor === 'anthropic');
  agent.profile = 'qwen'; agent.tiers = { high: { model: 'qwen3.8-max', effort: 'high', profile: null }, low: { model: 'qwen3.8-flash' } };
  const tier = resolveTier(cfg, 'claude', 'code', { tier: 'high' });
  assert.equal(tier.vendorProfile, null);
  assert.equal(resolveTier(cfg, 'claude', 'code', { tier: 'low' }).vendorProfile, 'qwen');
  const cli = resolveTier(cfg, 'claude', 'code', { tier: 'high', vendorProfile: 'kimi' });
  assert.equal(cli.vendorProfile, 'kimi'); assert.equal(cli.model, tier.model); assert.equal(cli.effort, tier.effort);
  const native = assertTierFlags(cfg, 'codex', collectTierFlags(n => n === 'native-claude' ? 'true' : undefined), ['claude']);
  assert.deepEqual(native.claude, { vendorProfile: null });
  assert.throws(() => assertTierFlags(cfg, 'codex', { tier: {}, effort: {}, profile: { claude: 'qwen' }, native: { claude: 'true' } }, ['claude']), /不能同时/);
  for (const id of ['claude', 'codex'] as const) {
    const shared = mergeConfigLayer(cfg, { agents: { [id]: { profile: 'qwen' } } });
    const local = mergeConfigLayer(shared, { agents: { [id]: { profile: null } } });
    assert.equal(resolveTier(local, id, 'plan').vendorProfile, null, '四级配置的null不能被深合并吞掉');
    assert.equal(resolveTier(shared, id, 'plan').vendorProfile, 'qwen', '不改变下层配置');
  }
});

test('注册表 profile 能力必须由适配器兑现，非能力侧不拥有该钩子', () => {
  const adapters = realAdapters();
  for (const agent of AGENTS) if (agent.criticEnabled) {
    assert.equal(typeof adapters[agent.id]?.vendorProfilesFor === 'function', agent.supportsProfiles === true, agent.id);
    if (agent.supportsProfiles) assert.equal(typeof adapters[agent.id]?.accessFor, 'function', agent.id);
  }
});

test('profile 元数据只取静态模型，不执行插值；认证环境只作用于子进程', () => {
  const meta = claudeProfileMetadata('export ANTHROPIC_MODEL="qwen3.8-flash"\nexport ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3.8-max\nexport ANTHROPIC_MODEL="$DYNAMIC"\nexport ANTHROPIC_AUTH_TOKEN="placeholder"');
  assert.deepEqual(meta.models, ['qwen3.8-flash', 'qwen3.8-max']);
  const parent = { ANTHROPIC_MODEL: 'other', ANTHROPIC_AUTH_TOKEN: 'placeholder', CLAUDE_CODE_OAUTH_TOKEN: 'placeholder', CLAUDE_CODE_USE_VERTEX: '1', PATH: '/bin' };
  assert.deepEqual(Object.keys(claudeRouteEnv('qwen', parent)).sort(), Object.keys(parent).filter(k => k !== 'PATH').sort());
  assert.ok(!('CLAUDE_CODE_OAUTH_TOKEN' in claudeRouteEnv(null, parent)));
  assert.equal(parent.ANTHROPIC_MODEL, 'other');
});

test('profile 元数据：三种形态都收末尾一个上下文窗口后缀，方括号在别处 / 两个后缀 / 内容不符一律不收（EV-258）', () => {
  const meta = claudeProfileMetadata([
    'export ANTHROPIC_MODEL="qwen3.8-max[1m]"',
    "export ANTHROPIC_DEFAULT_SONNET_MODEL='qwen3.8-flash[200k]'",
    'export ANTHROPIC_DEFAULT_OPUS_MODEL=glm-4.6[1m]',
  ].join('\n'));
  assert.deepEqual(meta.models, ['qwen3.8-max[1m]', 'qwen3.8-flash[200k]', 'glm-4.6[1m]']);
  // 第一轮这里的 `qwen3.8-max[1M]` 是反例；第二轮单位大小写不敏感（CC Switch 写的是大写，Windows 码点实测），换成 `[1G]`
  for (const v of ['qwen[1m]-max', 'qwen3.8-max[1m][1m]', 'qwen3.8-max[abc]', 'qwen3.8-max[1G]', 'qwen3.8-max[0m]']) {
    for (const line of [`export ANTHROPIC_MODEL="${v}"`, `export ANTHROPIC_MODEL='${v}'`, `export ANTHROPIC_MODEL=${v}`]) {
      assert.deepEqual(claudeProfileMetadata(line).models, [], `${line} 不应收`);
    }
  }
});

test('profile 元数据：大写单位后缀三种形态都收；其它单位字母、混入字符、小写键名一律不收（EV-258 第二轮）', () => {
  const meta = claudeProfileMetadata([
    'export ANTHROPIC_MODEL="qwen3.8-max[1M]"',
    "export ANTHROPIC_DEFAULT_SONNET_MODEL='qwen3.8-flash[200K]'",
    'export ANTHROPIC_DEFAULT_OPUS_MODEL=glm-4.6[1M]',
  ].join('\n'));
  assert.deepEqual(meta.models, ['qwen3.8-max[1M]', 'qwen3.8-flash[200K]', 'glm-4.6[1M]']);
  for (const v of ['qwen3.8-max[1G]', 'qwen3.8-max[1MB]', 'qwen3.8-max[1mM]', 'qwen3.8-max[1M][1M]', 'qwen3.8-max[1K]']) {
    for (const line of [`export ANTHROPIC_MODEL="${v}"`, `export ANTHROPIC_MODEL='${v}'`, `export ANTHROPIC_MODEL=${v}`]) {
      assert.deepEqual(claudeProfileMetadata(line).models, [], `${line} 不应收`);
    }
  }
  // 放宽只落在单位那一个字符位：键名判据仍区分大小写（片段用显式字符类、没给整行正则加 i 旗标）
  for (const line of ['export anthropic_model="qwen3.8-max[1M]"', 'export Anthropic_Model=qwen3.8-max']) {
    assert.deepEqual(claudeProfileMetadata(line).models, [], `${line} 不应收`);
  }
});

test('spawn失败保留请求命令但实际入口为空；被终止的已启动进程保留入口', async () => {
  const out = await run('/trivium-fixture-missing-entry', [], { timeoutMs: 1000 });
  assert.equal(out.spawned, false);
  assert.ok(out.commandLine);
  const request = { ...realAdapters().codex!.accessFor!(defaultConfig(), null), launcher_requested: process.execPath };
  const result = failedResult('codex', { status: 'failed', reason: 'fixture', commandLine: out.commandLine,
    exitCode: out.code, processStarted: out.spawned });
  assert.equal(effectiveAccess(request, result).launcher_effective, null);
  const alive = await run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30, killGraceMs: 50 });
  assert.equal(alive.spawned, true);
  assert.equal(effectiveAccess(request, { ...result, process_started: alive.spawned }).launcher_effective, request.launcher_requested);
});

test('模型族只采信声明和回读；工具/供应商不能证明异构，别名为unknown', () => {
  const result = { ...failedResult('claude', { status: 'failed', reason: 'x' }), model_effective: 'qwen3.8-max', model_effective_source: 'envelope' as const };
  const qwen = compareRunModels('codex', { model: 'qwen3.8-flash', provider: 'other', source: 'declared' }, ['claude'], { claude: result });
  assert.equal(qwen[0]!.status, 'same-family');
  assert.equal(compareRunModels('codex', { model: 'gpt-6', provider: 'qwen', source: 'declared' }, ['claude'], { claude: result })[0]!.status, 'different-family');
  assert.equal(compareRunModels('codex', undefined, ['claude'], { claude: result })[0]!.status, 'unknown');
  assert.equal(compareRunModels('codex', { model: 'qwen3.8-flash', provider: null, source: 'declared' }, ['claude'], { claude: { ...result, model_effective_source: 'requested' } })[0]!.status, 'unknown');
  for (const id of ['opus', 'sonnet', 'default', 'custom']) assert.equal(modelFamily(id), null);
  assert.equal(modelFamily('k3'), 'kimi'); assert.equal(modelFamily('vendor/GLM-5.3'), 'glm');
  assert.equal(familyWarnings(qwen).length, 1);
});

test('Codex 子进程清理冲突变量且所选认证变量轮换使缓存指纹失效', async () => {
  const home = await scratchDir('trivium-access_env-');
  const previousHome = process.env['CODEX_HOME'];
  const previousKey = process.env['OPENAI_API_KEY'];
  try {
    process.env['CODEX_HOME'] = home;
    await fs.writeFile(path.join(home, 'config.toml'), 'model_provider="openai"\n[model_providers.other]\nenv_key="OTHER_PROVIDER_TOKEN"\n');
    await fs.writeFile(path.join(home, 'qwen.config.toml'), 'model_provider="qwen"\n[model_providers.qwen]\nenv_key="OPENAI_API_KEY"\n');
    assert.equal(await codexRouteEnvKey(home, null), null);
    assert.equal(await codexRouteEnvKey(home, 'qwen'), 'OPENAI_API_KEY');
    assert.ok('OPENAI_API_KEY' in await codexRouteEnv(home, null));
    const env = await codexRouteEnv(home, 'qwen');
    assert.ok(!('OPENAI_API_KEY' in env));
    assert.equal(env['OPENAI_BASE_URL'], undefined);
    assert.ok('OPENAI_BASE_URL' in env);
    assert.ok('OTHER_PROVIDER_TOKEN' in env);
    const auth = realAdapters().codex!.authProbe!({ cfg: defaultConfig(), nodePath: process.execPath }, home,
      { vendorProfile: 'qwen', model: 'qwen3.8-flash', effort: null });
    process.env['OPENAI_API_KEY'] = 'fixture-before';
    const before = await auth.fingerprint();
    process.env['OPENAI_API_KEY'] = 'fixture-after';
    assert.notEqual(await auth.fingerprint(), before);
    assert.ok(!String(await auth.fingerprint()).includes('fixture-after'));
  } finally {
    if (previousHome === undefined) delete process.env['CODEX_HOME']; else process.env['CODEX_HOME'] = previousHome;
    if (previousKey === undefined) delete process.env['OPENAI_API_KEY']; else process.env['OPENAI_API_KEY'] = previousKey;
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Codex 原生路线不能以供应商配置或API凭据冒充官方订阅', async () => {
  const home = await scratchDir('trivium-access_env-');
  await fs.writeFile(path.join(home,'config.toml'),'model_provider="qwen"\n');
  assert.match(codexNativeRouteIssue(home)!, /其它provider/);
  await fs.writeFile(path.join(home,'config.toml'),'model_provider="openai"\n[model_providers.openai]\nbase_url="https://fixture.invalid/v1"\n');
  assert.match(codexNativeRouteIssue(home)!, /非官方/);
  await fs.writeFile(path.join(home,'config.toml'),'model_provider="openai"\n');
  await fs.writeFile(path.join(home,'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'fixture-key' }));
  assert.match(codexNativeRouteIssue(home)!, /API凭据/);
  await fs.writeFile(path.join(home,'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { access_token: 'fixture-token' } }));
  assert.equal(codexNativeRouteIssue(home), null);
});

test('Codex 原生配置或认证载体不可读取时返回环境成因，不抛内部错误', async () => {
  for (const name of ['config.toml', 'auth.json']) {
    const home = await scratchDir('trivium-access-io-');
    await fs.mkdir(path.join(home, name));
    assert.match(codexNativeRouteIssue(home)!, /无法读取/);
  }
});

test('v3 新写契约严格拒绝布尔判定与请求冒充；v2 历史布尔继续合法', () => {
  const input = { runId: 'R', topic: 't', stage: 'code' as const, rerunIndex: 1, command: 'x', promptHint: null, taskGoal: null,
    criticsSelected: ['claude'] as const, driver: 'codex' as const, treeHash: 'T', gitHead: null, dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn' as const };
  const meta = newRunMeta(input);
  assert.equal(meta.schema, 'trivium.run.v3'); assert.deepEqual(validateRunMeta(meta), []);
  meta.critics.claude = { vendor: 'anthropic', status: 'failed', duration_s: 0, tool_calls: {}, evidence_ok: false, cli_version: null,
    model_requested: 'qwen3.8-flash', model_effective: null, profile_requested: 'qwen', model_provider: null, exit_code: null,
    heterogeneous: 'unknown', access: { requested_mode: 'profile', profile: 'qwen', launcher_requested: '/wrapper', launcher_effective: null,
      wrapper_sha256: null, configuration_sha256: null, provider_declared: 'qwen', provider_declared_source: 'profile', provider_effective: null, provider_effective_source: null } };
  assert.deepEqual(validateRunMeta(meta), []);
  meta.critics.claude.heterogeneous = true;
  assert.ok(validateRunMeta(meta).length);
  const legacy = historicalRunMeta(input);
  legacy.critics.claude = { ...meta.critics.claude };
  delete legacy.critics.claude.access;
  assert.deepEqual(validateRunMeta(legacy), []);
});

test('启动上限在真实子进程前计数，失败照计且额度耗尽后不会启动', async () => {
  const budget = { limit: 2, used: 0, launches: [] as string[], exhausted: false };
  await withLaunchBudget(budget, () => true, async () => {
    const a = await run(process.execPath, ['-e', 'process.exit(7)']); assert.equal(a.code, 7);
    await run(process.execPath, ['-e', 'process.stdout.write("OK")']);
    await assert.rejects(run(process.execPath, ['-e', 'process.exit(0)']), LaunchBudgetExceeded);
  });
  assert.equal(budget.used, 2); assert.equal(budget.launches.length, 2); assert.equal(budget.exhausted, true);
});

test('认证缓存按实际组合隔离，同组合命中、模型/effort/profile/指纹变化均重新探活', async () => {
  const cfg = defaultConfig();
  const ctx: Ctx = { config: cfg, projectRoot: '/fixture', archiveRoot: '/fixture/.reviews', triviumDir: '/fixture/.trivium', sources: [] };
  let calls = 0; let fingerprint = 'wrapper-v1';
  const adapter = { ...realAdapters().claude!, authProbe: () => ({ fingerprint: async () => fingerprint,
    probe: async () => { calls++; return { ok: true, detail: 'fixture' }; } }) };
  const combo = { vendorProfile: 'qwen', model: 'qwen3.8-flash', effort: null };
  const opts = { ctx, scope: 'code' as const };
  const first = await probeAuth(ctx, 'claude', adapter, opts, combo);
  assert.ok(first.cache && first.cacheKey);
  cfg.probe.auth_routes = { [first.cacheKey]: first.cache };
  await probeAuth(ctx, 'claude', adapter, opts, combo); assert.equal(calls, 1);
  for (const change of [{ model: 'qwen3.8-max' }, { effort: 'high' }, { vendorProfile: 'kimi' }, { vendorProfile: null }]) {
    await probeAuth(ctx, 'claude', adapter, opts, { ...combo, ...change });
  }
  assert.equal(calls, 5);
  fingerprint = 'wrapper-v2';
  await probeAuth(ctx, 'claude', adapter, opts, combo); assert.equal(calls, 6);
});
