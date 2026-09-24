/**
 * ZCode 0.16.9 的模型覆盖落点（EV-82，计划双审 r1 + r3）。
 *
 * 根因：CLI 的模型选择链里，个人 provider 配置文件**存在就直接用、不做 legacy 导入**；
 * **不存在**才从 `<HOME>/.zcode/cli/config.json` 导入并把 `model.main` 转成默认模型选择。
 * EV-81 注入了指向用户真实个人文件的变量，个人文件「存在」，副本里的 `model.main` 就没人读了。
 * 修法：副本 HOME 下**不注入**个人键（与旗标探针同形），模型限定按副本源自己的 provider 键做。
 *
 * 本文件全部用**临时目录里的合成配置**，不碰真实 `~/.zcode/**`、不拉起真实 CLI、零配额。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  decideModelOverride,
  invokeZcode,
  legacyProviderMembers,
  prepareZcodeHome,
  qualifyAgainstCliConfig,
  scrubZcodeHome,
  zcodeHomeUnder,
  zcodeModelTail,
  zcodeProviderEnv,
  zcodeStorageRedirectEnv,
  ZCODE_BUILTIN_PROVIDER_ENV,
  ZCODE_DIR_ENV_KEYS,
  ZCODE_LANDING_SWITCH_ENV_KEYS,
  ZCODE_PERSONAL_PROVIDER_ENV,
} from '../../src/trivium/adapters/zcode.js';
import {
  buildProbeCliConfig,
  pickNonFirstModel,
  probeModelOverride,
  ZCODE_PROBE_SENTINEL_KEY,
} from '../../src/trivium/probes/zcode.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'trivium-zcode-model-'));

/** 一份形态与本机一致的 `cli/config.json`（凭据位用假值） */
function cliConfigFixture(): Record<string, unknown> {
  return {
    model: { main: 'bigmodel-coding-plan/GLM-5.3', lite: 'bigmodel-coding-plan/GLM-5.3-Flash' },
    provider: {
      'bigmodel-coding-plan': {
        name: 'BigModel Coding Plan',
        kind: 'anthropic',
        source: 'custom',
        enabled: true,
        options: {
          apiKey: 'fake-id.fake-secret',
          baseURL: 'https://example.invalid',
          // 两种 apiKey 之外的凭据形态——黑名单替换会把它们原样带进探针副本（代码双审 r1 codex 子项 03 ≡ AGY-02）
          headers: { Authorization: 'Bearer REAL-BEARER-SECRET' },
          token: 'REAL-TOKEN-SECRET',
        },
        models: { 'GLM-5.3': {}, 'GLM-5.3-Flash': {} },
      },
      'other-vendor': {
        name: 'Other',
        kind: 'openai-compatible',
        source: 'custom',
        enabled: true,
        options: { apiKey: 'fake-other' },
        models: { 'qwen3.8-max': {} },
      },
    },
  };
}

async function userHomeWithCliConfig(cfg: unknown = cliConfigFixture()): Promise<{ home: string; cliConfig: string }> {
  const home = await tmp();
  const dir = path.join(home, '.zcode/cli');
  await fs.mkdir(dir, { recursive: true });
  const cliConfig = path.join(dir, 'config.json');
  await fs.writeFile(cliConfig, JSON.stringify(cfg), { encoding: 'utf8', mode: 0o600 });
  return { home, cliConfig };
}

// ── qualifyAgainstCliConfig：限定只认副本源自己的 provider 键（r3 CODEX-03）──

test('限定：裸名在恰好一个 provider 下 → 补该 provider 键', () => {
  const q = qualifyAgainstCliConfig('GLM-5.3-Flash', cliConfigFixture());
  assert.equal(q.qualified, 'bigmodel-coding-plan/GLM-5.3-Flash');
});

test('限定：裸名没有任何 provider 提供 → null 并说明', () => {
  const q = qualifyAgainstCliConfig('nope', cliConfigFixture());
  assert.equal(q.qualified, null);
  assert.match((q as { reason: string }).reason, /没有任何 provider 提供/);
});

test('限定：裸名在多个 provider 下都有 → null，要求写全限定', () => {
  const cfg = cliConfigFixture();
  (cfg['provider'] as Record<string, { models: Record<string, unknown> }>)['other-vendor']!.models['GLM-5.3'] = {};
  const q = qualifyAgainstCliConfig('GLM-5.3', cfg);
  assert.equal(q.qualified, null);
  assert.match((q as { reason: string }).reason, /多个 provider/);
});

test('限定：全限定形态原样通过', () => {
  const q = qualifyAgainstCliConfig('bigmodel-coding-plan/GLM-5.3-Flash', cliConfigFixture());
  assert.equal(q.qualified, 'bigmodel-coding-plan/GLM-5.3-Flash');
});

test('限定：全限定但 provider 键不在副本源里 → null（探针 model_id_form 的 UUID 形态就是这种输入）', () => {
  // 本机此刻 model_id_form 是 `<providerUUID>/qwen3.8-max`——拿它补前缀会拼出注册表里不存在的键
  const q = qualifyAgainstCliConfig('84044858-4e28-432b-bbbd-7e2d624e39ff/GLM-5.3-Flash', cliConfigFixture());
  assert.equal(q.qualified, null);
  assert.match((q as { reason: string }).reason, /没有 provider/);
});

test('限定：provider 在、模型不在其 models 里 → null', () => {
  const q = qualifyAgainstCliConfig('bigmodel-coding-plan/GLM-9', cliConfigFixture());
  assert.equal(q.qualified, null);
  assert.match((q as { reason: string }).reason, /models 里没有/);
});

test('限定：空段一律判不成立', () => {
  for (const m of ['/GLM-5.3', 'bigmodel-coding-plan/', '  /  ']) {
    assert.equal(qualifyAgainstCliConfig(m, cliConfigFixture()).qualified, null, m);
  }
});

// ── prepareZcodeHome：副本写 model.main，限定失败仍建副本但不覆盖 ──

test('副本：限定成功 → route config_copy，model.main/lite 写请求模型，其余键原样', async () => {
  const { cliConfig } = await userHomeWithCliConfig();
  const runDir = await tmp();

  const prep = await prepareZcodeHome(runDir, 'GLM-5.3-Flash', { srcConfig: cliConfig });

  assert.equal(prep.route, 'config_copy');
  assert.equal(prep.qualified, 'bigmodel-coding-plan/GLM-5.3-Flash');
  assert.equal(prep.homeDir, zcodeHomeUnder(runDir));
  const copy = JSON.parse(await fs.readFile(path.join(prep.homeDir!, '.zcode/cli/config.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(copy['model'], { main: 'bigmodel-coding-plan/GLM-5.3-Flash', lite: 'bigmodel-coding-plan/GLM-5.3-Flash' });
  assert.deepEqual(copy['provider'], cliConfigFixture()['provider']);
  const st = await fs.stat(path.join(prep.homeDir!, '.zcode/cli/config.json'));
  assert.equal(st.mode & 0o777, 0o600);
});

test('副本：限定失败 → 仍建副本（隔离照做）、model 段不动、route global 并给理由', async () => {
  const { cliConfig } = await userHomeWithCliConfig();
  const runDir = await tmp();

  const prep = await prepareZcodeHome(runDir, '84044858-fake/GLM-5.3-Flash', { srcConfig: cliConfig });

  assert.equal(prep.route, 'global');
  assert.equal(prep.qualified, null);
  assert.match(prep.reason ?? '', /副本已建但不做模型覆盖/);
  assert.ok(prep.homeDir, '隔离仍要做');
  const copy = JSON.parse(await fs.readFile(path.join(prep.homeDir!, '.zcode/cli/config.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(copy['model'], cliConfigFixture()['model']);
});

test('副本：未指定模型 / 源文件不存在 → 不建副本', async () => {
  const { cliConfig } = await userHomeWithCliConfig();
  const a = await prepareZcodeHome(await tmp(), null, { srcConfig: cliConfig });
  assert.equal(a.homeDir, null);
  assert.equal(a.route, 'global');
  const b = await prepareZcodeHome(await tmp(), 'GLM-5.3', { srcConfig: path.join(await tmp(), 'nope.json') });
  assert.equal(b.homeDir, null);
  assert.match(b.reason ?? '', /未找到/);
});

// ── zcodeProviderEnv：省略个人键 + 目录键恒清（r3 CODEX-02；EV-110 起四键）──

test('注入：omitPersonal 为真时个人键恒 undefined，即使真实用户目录下个人文件存在', async () => {
  const userHome = await tmp();
  await fs.mkdir(path.join(userHome, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(userHome, '.zcode/v2/provider_config.json'), '{}', 'utf8');

  const env = await zcodeProviderEnv('/nonexistent/entry.cjs', userHome, { omitPersonal: true });

  assert.ok(ZCODE_PERSONAL_PROVIDER_ENV in env, '键必须出现（值 undefined 才会让 run() 删掉宿主同名变量）');
  assert.equal(env[ZCODE_PERSONAL_PROVIDER_ENV], undefined);
});

test('注入：不省略时仍按真实用户目录派生（探活与探针走这条）', async () => {
  const userHome = await tmp();
  await fs.mkdir(path.join(userHome, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(userHome, '.zcode/v2/provider_config.json'), '{}', 'utf8');

  const env = await zcodeProviderEnv('/nonexistent/entry.cjs', userHome);

  assert.equal(env[ZCODE_PERSONAL_PROVIDER_ENV], path.join(userHome, '.zcode/v2/provider_config.json'));
});

test('注入：门控仍是逐键——个人在、内置不在时，个人照常注入（撤回 D-3 的守卫）', async () => {
  const userHome = await tmp();
  await fs.mkdir(path.join(userHome, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(userHome, '.zcode/v2/provider_config.json'), '{}', 'utf8');

  const env = await zcodeProviderEnv('/nonexistent/entry.cjs', userHome);

  assert.equal(env[ZCODE_BUILTIN_PROVIDER_ENV], undefined);
  assert.equal(typeof env[ZCODE_PERSONAL_PROVIDER_ENV], 'string');
});

test('注入：七个目录 / 路径键与四个落点开关键恒出现且为 undefined——宿主预置也进不了子进程（EV-110 加 ZCODE_LOG_DIR；EV-112 扩到十一键）', async () => {
  const env = await zcodeProviderEnv('/nonexistent/entry.cjs', await tmp());
  for (const k of [...ZCODE_DIR_ENV_KEYS, ...ZCODE_LANDING_SWITCH_ENV_KEYS]) {
    assert.ok(k in env, `${k} 必须出现`);
    assert.equal(env[k], undefined);
  }
  // 键集逐字锁住：常量里漏了一个键，这里当场红
  assert.deepEqual([...ZCODE_DIR_ENV_KEYS].sort(), [
    'ZCODE_DATA_BASE_DIR', 'ZCODE_HOME', 'ZCODE_LOG_DIR', 'ZCODE_MAILBOX_ROOT', 'ZCODE_SESSION_DB', 'ZCODE_SESSION_DB_PATH', 'ZCODE_STORAGE_DIR',
  ]);
  assert.deepEqual([...ZCODE_LANDING_SWITCH_ENV_KEYS].sort(), ['ZCODE_BETA', 'ZCODE_ENV', 'ZCODE_MESSAGE_ENABLED', 'ZCODE_RUNTIME_ENV']);
});

// ── 端到端（假入口）：审查运行形态下子进程拿到的 env ──

/** 假入口：把收到的相关 env 键回显进 envelope，不读任何文件 */
const ECHO_ENTRY = `
const env = process.env;
process.stdout.write(JSON.stringify({
  sessionId: 'sess_fake',
  response: JSON.stringify({
    builtin: env.${ZCODE_BUILTIN_PROVIDER_ENV} ?? null,
    personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null,
    dataBase: env.ZCODE_DATA_BASE_DIR ?? null,
    zhome: env.ZCODE_HOME ?? null,
    storage: env.ZCODE_STORAGE_DIR ?? null,
    logDir: env.ZCODE_LOG_DIR ?? null,
    sessionDbPath: env.ZCODE_SESSION_DB_PATH ?? null,
    sessionDb: env.ZCODE_SESSION_DB ?? null,
    mailboxRoot: env.ZCODE_MAILBOX_ROOT ?? null,
    runtimeEnv: env.ZCODE_RUNTIME_ENV ?? null,
    beta: env.ZCODE_BETA ?? null,
    zenv: env.ZCODE_ENV ?? null,
    messageEnabled: env.ZCODE_MESSAGE_ENABLED ?? null,
    home: env.HOME ?? null,
  }),
  usage: {}, eventCount: 1,
}) + '\\n');
process.exit(0);
`;

test('端到端：omitPersonalProviderConfig + 宿主预置十一个目录 / 路径键与落点开关键 → 子进程一个都拿不到（EV-110、EV-112）', async () => {
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, ECHO_ENTRY, 'utf8');
  const userHome = await tmp();
  await fs.mkdir(path.join(userHome, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(userHome, '.zcode/v2/provider_config.json'), '{}', 'utf8');
  const fakeHome = await tmp();

  const preset = {
    ZCODE_DATA_BASE_DIR: '/host/preset', ZCODE_HOME: '/host/zh', ZCODE_STORAGE_DIR: '/host/st', ZCODE_LOG_DIR: '/host/log',
    ZCODE_SESSION_DB_PATH: '/host/db.sqlite', ZCODE_SESSION_DB: '/host/db2.sqlite', ZCODE_MAILBOX_ROOT: '/host/mail',
    ZCODE_RUNTIME_ENV: 'development', ZCODE_BETA: '1', ZCODE_ENV: 'beta', ZCODE_MESSAGE_ENABLED: '1',
  };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(preset)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    const out = await invokeZcode({
      entry, node: process.execPath, cwd: root, prompt: 'ok', readonlyArgs: [],
      homeDir: fakeHome, userHome, omitPersonalProviderConfig: true, timeoutMs: 20_000,
    });
    assert.ok(out.envelope, `要有 envelope，stderr=${out.stderr}`);
    const seen = JSON.parse(out.envelope.response) as Record<string, string | null>;
    assert.equal(seen['personal'], null, '个人键必须被删掉');
    assert.equal(seen['dataBase'], null);
    assert.equal(seen['zhome'], null);
    assert.equal(seen['storage'], null);
    assert.equal(seen['logDir'], null, 'EV-110：审查运行也清 ZCODE_LOG_DIR');
    for (const f of ['sessionDbPath', 'sessionDb', 'mailboxRoot', 'runtimeEnv', 'beta', 'zenv', 'messageEnabled']) {
      assert.equal(seen[f], null, `EV-112：${f} 对应的键宿主预置也进不了子进程`);
    }
    assert.equal(seen['home'], fakeHome);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ── zcodeAdapter.run() 端到端：EV-82 根因本体——副本 HOME 下不得注入个人键 ──

/**
 * `prepareZcodeHome` 读 `os.homedir()`，POSIX 下它读 `$HOME`：把 `HOME` 指向临时用户目录，
 * 里面同时摆 `cli/config.json`（副本源）**和**一份个人文件——后者是关键：不摆它，
 * 「个人键被删」与「个人文件本来就不在」两种世界的观测相同，M1 那条变异就抓不到。
 */
test('run()：副本 HOME 下拉起时个人键被删（即使真实用户目录下个人文件存在），route 记 config_copy', async () => {
  const { defaultConfig } = await import('../../src/trivium/config.js');
  const { zcodeAdapter } = await import('../../src/trivium/adapters/zcode.js');

  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, ECHO_ENTRY, 'utf8');
  await fs.mkdir(path.join(root, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(root, 'Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');

  const { home: userHome } = await userHomeWithCliConfig();
  await fs.mkdir(path.join(userHome, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(userHome, '.zcode/v2/provider_config.json'), '{}', 'utf8');

  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode!.entrypoint = entry;
  cfg.probe.cli.zcode!.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit,Bash'];
  cfg.probe.cli.zcode!.response_field = 'response';

  const runDir = await tmp();
  const outDir = path.join(runDir, 'out');
  const req = {
    run_id: 'r', topic: 't', stage: 'code' as const, critic: 'glm' as const,
    project_root: root, subject_path: path.join(root, 's.md'), deny_paths: [],
    out_dir: outDir, brief_path: path.join(root, 'b.md'), brief_text: 'ok',
    model: 'GLM-5.3-Flash', timeout_s: 20, schema_path: path.join(root, 'schema.json'),
    min_tool_calls: 0, min_project_reads: 0, profile_requested: null,
  };

  const savedHome = process.env['HOME'];
  process.env['HOME'] = userHome;
  try {
    const result = await zcodeAdapter.run({ cfg, nodePath: process.execPath }, req as never);
    assert.equal(result.status, 'ok', result.fail_reason ?? '');
    const seen = JSON.parse(result.raw_response_text ?? '{}') as Record<string, string | null>;
    assert.equal(seen['personal'], null, '副本 HOME 下个人键必须被删——否则 CLI 跳过 legacy 导入，model.main 没人读（EV-82 根因）');
    assert.equal(seen['home'], zcodeHomeUnder(runDir));
    assert.equal(seen['dataBase'], null);
    // U5（EV-112 计划 r3 §4.2 D2-(a)）：副本支也设三个落点键，取值与 HOME=<副本> 时的缺省相同；其余八键为 null
    const want = zcodeStorageRedirectEnv(zcodeHomeUnder(runDir));
    assert.equal(seen['storage'], want['ZCODE_STORAGE_DIR'], '副本支不设落点根 ⇒ 变异 M3');
    assert.equal(seen['sessionDbPath'], want['ZCODE_SESSION_DB_PATH']);
    assert.equal(seen['logDir'], want['ZCODE_LOG_DIR']);
    for (const f of ['zhome', 'sessionDb', 'mailboxRoot', 'runtimeEnv', 'beta', 'zenv', 'messageEnabled']) assert.equal(seen[f], null, f);
    // ECHO_ENTRY 不写日志与 rollout ⇒ 自检两项都为 false；副本支不做反向核 ⇒ 无 leaked_to_home 键
    assert.deepEqual(result.carriers_landed, { log: false, rollout: false });
    assert.equal(result.model_route, 'config_copy');
    // 没有日志可回读 → 尝试了覆盖但判不出 → 字段产出且为 null
    assert.equal(result.model_override_applied, null);
    const copy = JSON.parse(await fs.readFile(path.join(zcodeHomeUnder(runDir), '.zcode/cli/config.json'), 'utf8')) as Record<string, { main: string }>;
    assert.equal(copy['model']!.main, 'bigmodel-coding-plan/GLM-5.3-Flash');
  } finally {
    if (savedHome === undefined) delete process.env['HOME']; else process.env['HOME'] = savedHome;
  }
});

/** 假入口：回显 env，且按 FAKE_MODEL 写一份会话日志（context.model）——让 run() 的轨迹回读拿到生效模型 */
const ECHO_WITH_LOG_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env;
if (env.FAKE_MODEL) {
  const dir = path.join(env.HOME, '.zcode/cli/log');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'zcode-2026-09-21.jsonl'),
    JSON.stringify({ sessionId: 'sess_fake', event: 'turn.completed', context: { model: env.FAKE_MODEL } }) + '\\n');
}
process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'ok', usage: {}, eventCount: 1 }) + '\\n');
process.exit(0);
`;

async function runWithFakeEntry(entrySource: string, model: string, fakeModel: string | null) {
  const { defaultConfig } = await import('../../src/trivium/config.js');
  const { zcodeAdapter } = await import('../../src/trivium/adapters/zcode.js');
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, entrySource, 'utf8');
  await fs.mkdir(path.join(root, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(root, 'Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');
  const { home: userHome } = await userHomeWithCliConfig();
  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode!.entrypoint = entry;
  cfg.probe.cli.zcode!.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit,Bash'];
  cfg.probe.cli.zcode!.response_field = 'response';
  const runDir = await tmp();
  const req = {
    run_id: 'r', topic: 't', stage: 'code' as const, critic: 'glm' as const,
    project_root: root, subject_path: path.join(root, 's.md'), deny_paths: [],
    out_dir: path.join(runDir, 'out'), brief_path: path.join(root, 'b.md'), brief_text: 'ok',
    model, timeout_s: 20, schema_path: path.join(root, 'schema.json'),
    min_tool_calls: 0, min_project_reads: 0, profile_requested: null,
  };
  const savedHome = process.env['HOME'];
  const savedModel = process.env['FAKE_MODEL'];
  process.env['HOME'] = userHome;
  if (fakeModel) process.env['FAKE_MODEL'] = fakeModel; else delete process.env['FAKE_MODEL'];
  try {
    return await zcodeAdapter.run({ cfg, nodePath: process.execPath }, req as never);
  } finally {
    if (savedHome === undefined) delete process.env['HOME']; else process.env['HOME'] = savedHome;
    if (savedModel === undefined) delete process.env['FAKE_MODEL']; else process.env['FAKE_MODEL'] = savedModel;
  }
}

test('run() 负格：请求模型不在副本源目录 → route global，且 model_override_applied **缺席**（不是 null）', async () => {
  // 代码双审 r1 codex 子项 05 ≡ AGY-03：产出闸门此前零用例，去掉门恒写 null 全量照绿
  const result = await runWithFakeEntry(ECHO_WITH_LOG_ENTRY, 'nope-model', null);
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.equal(result.model_route, 'global');
  assert.equal('model_override_applied' in result, false, '没有覆盖尝试就没有「是否落实」这个问题——字段必须缺席');
});

test('run() 正格：回读生效模型与请求一致 → true；不一致 → false', async () => {
  const ok = await runWithFakeEntry(ECHO_WITH_LOG_ENTRY, 'GLM-5.3-Flash', 'bigmodel-coding-plan/GLM-5.3-Flash');
  assert.equal(ok.model_route, 'config_copy');
  assert.equal(ok.model_effective, 'bigmodel-coding-plan/GLM-5.3-Flash');
  assert.equal(ok.model_override_applied, true);

  const bad = await runWithFakeEntry(ECHO_WITH_LOG_ENTRY, 'GLM-5.3-Flash', '84044858-fake/qwen3.8-max');
  assert.equal(bad.model_route, 'config_copy');
  assert.equal(bad.model_override_applied, false, 'EV-82 现场：请求 GLM、跑的是 qwen');
});

test('run() 正格：回读 providerId 是 UUID 形态、modelId 一致 → 仍 true，trace.json 记形态差（r2 AGY-03）', async () => {
  // run() 内部若误用整串判等，这条会翻红；decideModelOverride 的单测覆盖不到 run() 这一层
  const r = await runWithFakeEntry(ECHO_WITH_LOG_ENTRY, 'GLM-5.3-Flash', '84044858-fake/GLM-5.3-Flash');
  assert.equal(r.model_override_applied, true);
  const trace = JSON.parse(await fs.readFile(r.trace_path!, 'utf8')) as { modelSelection: { note?: string } };
  assert.match(trace.modelSelection.note ?? '', /providerId 形态不同/);
});

// ── zcodeModelTail / decideModelOverride：守卫的判据面 ──

test('比对判据只取 modelId 段：两种 providerId 形态并存时不得判成未生效（P-31）', () => {
  assert.equal(zcodeModelTail('84044858-fake/GLM-5.3-Flash'), zcodeModelTail('bigmodel-coding-plan/GLM-5.3-Flash'));
  assert.notEqual(zcodeModelTail('84044858-fake/qwen3.8-max'), zcodeModelTail('bigmodel-coding-plan/GLM-5.3-Flash'));
  assert.equal(zcodeModelTail('GLM-5.3'), 'GLM-5.3');
});

test('比对：一致 → true；providerId 形态不同 → 仍 true 只记 note；模型不同 → false', () => {
  assert.deepEqual(
    decideModelOverride(true, 'bigmodel-coding-plan/GLM-5.3-Flash', 'bigmodel-coding-plan/GLM-5.3-Flash'),
    { applied: true, note: null },
  );
  const v = decideModelOverride(true, 'bigmodel-coding-plan/GLM-5.3-Flash', '84044858-fake/GLM-5.3-Flash');
  assert.equal(v.applied, true);
  assert.match(v.note ?? '', /providerId 形态不同/);
  assert.equal(decideModelOverride(true, 'bigmodel-coding-plan/GLM-5.3-Flash', '84044858-fake/qwen3.8-max').applied, false);
});

test('比对：尝试了但没回读到 → 不产出 true/false 带 note；没尝试 / 没请求 → 静默', () => {
  const v = decideModelOverride(true, 'x/GLM-5.3-Flash', null);
  assert.equal(v.applied, undefined);
  assert.match(v.note ?? '', /未回读到生效模型/);
  assert.deepEqual(decideModelOverride(false, 'x/GLM-5.3', 'x/GLM-5.3'), { applied: undefined, note: null });
  assert.deepEqual(decideModelOverride(true, null, 'x/qwen3.8-max'), { applied: undefined, note: null });
});

// ── 清扫：三份载体 ──

test('清扫：三份已知凭据载体全部按名整删，各自计入 deleted（AGY-05）', async () => {
  const home = await tmp();
  await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await fs.mkdir(path.join(home, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/cli/config.json'), '{"provider":{}}', 'utf8');
  // 路线 L 下这份由 CLI legacy 导入后自写（apiKey 随导入带过去），编排器不写它
  await fs.writeFile(path.join(home, '.zcode/v2/provider_config.json'), '{"schemaVersion":1}', 'utf8');
  await fs.writeFile(path.join(home, '.zcode/v2/credentials.json'), '{"k":"v"}', 'utf8');

  const out = await scrubZcodeHome(home);

  const base = path.basename(home);
  assert.deepEqual(out.deleted.sort(), [
    path.join(base, '.zcode/cli/config.json'),
    path.join(base, '.zcode/v2/credentials.json'),
    path.join(base, '.zcode/v2/provider_config.json'),
  ].sort());
  assert.equal(out.errors.length, 0);
});

test('清扫：载体不在就跳过，不报错也不虚报删除（幂等）', async () => {
  const home = await tmp();
  await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/cli/config.json'), '{"provider":{}}', 'utf8');
  const out = await scrubZcodeHome(home);
  assert.deepEqual(out.deleted, [path.join(path.basename(home), '.zcode/cli/config.json')]);
  const again = await scrubZcodeHome(home);
  assert.deepEqual(again.deleted, []);
  assert.equal(again.errors.length, 0);
});

// ── 探针臂 probeModelOverride：零配额实测 config_copy 档 ──

test('探针辅助：buildProbeCliConfig 按白名单重建——apiKey 是哨兵，headers/token 等一律不带，baseURL 与目录保留', () => {
  const src = cliConfigFixture();
  const out = buildProbeCliConfig(src as never, 'bigmodel-coding-plan/GLM-5.3-Flash');
  const p = out['provider'] as Record<string, { options: Record<string, unknown>; models: Record<string, unknown> }>;
  assert.equal(p['bigmodel-coding-plan']!.options['apiKey'], ZCODE_PROBE_SENTINEL_KEY);
  assert.equal(p['bigmodel-coding-plan']!.options['baseURL'], 'https://example.invalid');
  assert.deepEqual(Object.keys(p['bigmodel-coding-plan']!.options).sort(), ['apiKey', 'baseURL']);
  assert.deepEqual(Object.keys(p['bigmodel-coding-plan']!.models), ['GLM-5.3', 'GLM-5.3-Flash']);
  assert.deepEqual(out['model'], { main: 'bigmodel-coding-plan/GLM-5.3-Flash', lite: 'bigmodel-coding-plan/GLM-5.3-Flash' });
  // 关键断言：夹具源里任何非白名单的字符串值都不得出现在副本里（不是只查 apiKey）
  const json = JSON.stringify(out);
  for (const leaked of ['fake-id.fake-secret', 'REAL-BEARER-SECRET', 'REAL-TOKEN-SECRET', 'fake-other', 'Authorization']) {
    assert.equal(json.includes(leaked), false, `副本里不得出现 ${leaked}`);
  }
});

test('探针辅助：pickNonFirstModel 挑第一个有两个以上模型的 provider 的第二个模型', () => {
  assert.equal(pickNonFirstModel(cliConfigFixture() as never), 'bigmodel-coding-plan/GLM-5.3-Flash');
  assert.equal(pickNonFirstModel({ provider: { a: { models: { only: {} } } } }), null);
});

/**
 * 假入口：模拟 0.16.9 的 legacy 导入链——个人文件不在就读 `$HOME/.zcode/cli/config.json`、把
 * `model.main` 写成 `$HOME/.zcode/v2/provider_config.json` 的 defaultModelSelection，然后停在鉴权层退 1。
 * 同时把收到的 argv 记进 FAKE_ZCODE_LOG（断言只读参数透传），并断言副本里每个 provider 的 options
 * 只有 baseURL 与哨兵 apiKey（见到任何别的键或非哨兵值就退 99：那是真实凭据泄漏）。
 *   FAKE_IGNORE_MAIN：模拟「model.main 没人读」——写首位模型（回落形态）；
 *   FAKE_NO_IMPORT：跑到模型层但不写 v2（导入没发生）；
 *   FAKE_CRASH：无输出直接退 137（拉起没跑到配置读取阶段）。
 */
const LEGACY_IMPORT_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env;
if (env.FAKE_ZCODE_LOG) fs.appendFileSync(env.FAKE_ZCODE_LOG, JSON.stringify({ argv: process.argv.slice(2), apiKeyEnv: env.ZCODE_API_KEY ?? null, baseUrlEnv: env.ZCODE_BASE_URL ?? null }) + '\\n');
if (env.FAKE_CRASH) process.exit(137);
if (env.FAKE_HANG) { setTimeout(function () { process.exit(1); }, 10000); return; }
if (!env.${ZCODE_BUILTIN_PROVIDER_ENV}) { process.stderr.write('无法定位 CLI ZCode Built-in Provider Config\\n'); process.exit(1); }
if (env.${ZCODE_PERSONAL_PROVIDER_ENV}) { process.stderr.write('personal injected: import skipped\\n'); process.exit(1); }
const home = env.HOME;
const cfg = JSON.parse(fs.readFileSync(path.join(home, '.zcode/cli/config.json'), 'utf8'));
for (const p of Object.values(cfg.provider || {})) {
  // 白名单：apiKey（哨兵）、baseURL、apiKeyRequired（布尔，决定导入成败，r3 CODEX-01）——其它键一律视为凭据泄漏
  const keys = Object.keys(p.options || {}).filter(function (k) { return k !== 'apiKeyRequired'; }).sort().join(',');
  if ((keys !== 'apiKey,baseURL' && keys !== 'apiKey') || p.options.apiKey !== '${ZCODE_PROBE_SENTINEL_KEY}') {
    process.stderr.write('REAL CREDENTIAL LEAKED: ' + keys + '\\n'); process.exit(99);
  }
}
if (env.FAKE_NO_IMPORT) { process.stderr.write('Error: Model creation failed (traceId: fake)\\n'); process.exit(1); }
// Fqa 语义：provider 显式声明 apiKeyRequired:false ⇒ Oqa 抛 ikt ⇒ skt 整份返回 null ⇒ 没有导入、没有 v2
for (const p of Object.values(cfg.provider || {})) {
  if (p.options && p.options.apiKeyRequired === false) { process.stderr.write('Error: Model creation failed (traceId: fake)\\n'); process.exit(1); }
}
let sel;
if (env.FAKE_UUID_PREFIX) {
  // CLI 把 providerId 写成 UUID 形态、modelId 仍是请求值（P-31 两形态并存）
  const main = typeof cfg.model === 'string' ? cfg.model : cfg.model.main;
  sel = { providerId: '84044858-fake-uuid', modelId: main.slice(main.indexOf('/') + 1) };
} else if (env.FAKE_IGNORE_MAIN) {
  const [pid, pv] = Object.entries(cfg.provider)[0];
  sel = { providerId: pid, modelId: Object.keys(pv.models)[0] };
} else {
  const main = typeof cfg.model === 'string' ? cfg.model : cfg.model.main;
  const i = main.indexOf('/');
  sel = { providerId: main.slice(0, i), modelId: main.slice(i + 1) };
}
fs.mkdirSync(path.join(home, '.zcode/v2'), { recursive: true });
fs.writeFileSync(path.join(home, '.zcode/v2/provider_config.json'),
  JSON.stringify({ schemaVersion: 1, config: { providerConfigRules: {}, modelConfigRules: {}, defaultModelSelection: sel } }));
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

async function legacyLayout(opts: { withBuiltin?: boolean } = {}): Promise<{ entry: string; cwd: string; cliConfig: string; root: string }> {
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, LEGACY_IMPORT_ENTRY, 'utf8');
  if (opts.withBuiltin !== false) {
    const builtin = path.join(root, 'Resources/config/provider/zcode-builtin.json');
    await fs.mkdir(path.dirname(builtin), { recursive: true });
    await fs.writeFile(builtin, '{}', 'utf8');
  }
  const { cliConfig } = await userHomeWithCliConfig();
  const cwd = path.join(root, 'proj');
  await fs.mkdir(cwd, { recursive: true });
  return { entry, cwd, cliConfig, root };
}

/** 跑探针臂并在 finally 把注入的假环境变量清干净 */
async function probeWith(flags: Record<string, string>, opts: Parameters<typeof probeModelOverride>[3]) {
  const L = await legacyLayout();
  for (const [k, v] of Object.entries(flags)) process.env[k] = v;
  try {
    return { r: await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.cliConfig, ...opts }), L };
  } finally {
    for (const k of Object.keys(flags)) delete process.env[k];
  }
}

test('探针臂：CLI 读到副本 model.main（非首位模型）→ config_copy；副本里绝无真实凭据（假入口见到就退 99）', async () => {
  const { r } = await probeWith({}, {});
  assert.equal(r.override, 'config_copy', r.why);
  assert.equal(r.requested, 'bigmodel-coding-plan/GLM-5.3-Flash');
  assert.equal(r.observed, r.requested);
});

test('探针臂：写出的 providerId 是 UUID 形态、modelId 仍是请求值 → config_copy，形态差只进 why（r2 CODEX-03）', async () => {
  const { r } = await probeWith({ FAKE_UUID_PREFIX: '1' }, {});
  assert.equal(r.override, 'config_copy', r.why);
  assert.equal(r.observed, '84044858-fake-uuid/GLM-5.3-Flash');
  assert.match(r.why, /providerId 形态与副本源不同/);
});

test('探针臂：CLI 没读 model.main、回落首位模型 → global（非首位请求才分得出来）', async () => {
  const { r } = await probeWith({ FAKE_IGNORE_MAIN: '1' }, {});
  assert.equal(r.override, 'global', r.why);
  assert.equal(r.observed, 'bigmodel-coding-plan/GLM-5.3');
});

test('探针臂：CLI 跑到模型层却没写 v2 → global（导入确实没发生）', async () => {
  const { r } = await probeWith({ FAKE_NO_IMPORT: '1' }, {});
  assert.equal(r.override, 'global', r.why);
  // 文案不承诺 CLI 行为（r2 CODEX-02）：两种成因都要写出来
  assert.match(r.why, /没有触发 legacy 导入/);
  assert.match(r.why, /探针裁剪掉了导入需要的键/);
});

test('探针臂：拉起崩溃（无输出退 137）→ null 未判定，不得记成有定论的 global（codex 子项 02）', async () => {
  const { r } = await probeWith({ FAKE_CRASH: '1' }, {});
  assert.equal(r.override, null, r.why);
  assert.match(r.why, /未判定/);
});

test('探针臂：拉起超时被杀 → null 未判定（timedOut 那一支，不得记成 global）', async () => {
  const { r } = await probeWith({ FAKE_HANG: '1' }, { timeoutMs: 500 });
  assert.equal(r.override, null, r.why);
  assert.match(r.why, /未判定/);
  assert.match(r.why, /超时/);
});

test('探针臂：内置 provider 配置定位失败（P-28 形态）→ null 未判定', async () => {
  const L = await legacyLayout({ withBuiltin: false });
  const r = await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.cliConfig });
  assert.equal(r.override, null, r.why);
  assert.match(r.why, /定位失败/);
});

test('探针臂：只读参数透传到 argv，且宿主的 ZCODE_API_KEY / ZCODE_BASE_URL 进不了子进程（AGY-02 / 子项 03）', async () => {
  const L = await legacyLayout();
  const log = path.join(L.root, 'calls.jsonl');
  process.env['FAKE_ZCODE_LOG'] = log;
  process.env['ZCODE_API_KEY'] = 'host.key';
  process.env['ZCODE_BASE_URL'] = 'https://host.invalid';
  try {
    const r = await probeModelOverride(L.entry, process.execPath, L.cwd, {
      cliConfigPath: L.cliConfig, readonlyArgs: ['--mode', 'plan', '--disallowed-tools', 'Write,Edit,Bash'],
    });
    assert.equal(r.override, 'config_copy', r.why);
    const call = JSON.parse((await fs.readFile(log, 'utf8')).trim().split('\n')[0]!) as { argv: string[]; apiKeyEnv: string | null; baseUrlEnv: string | null };
    assert.ok(call.argv.includes('--mode') && call.argv.includes('plan'), '只读参数要递到 CLI');
    assert.ok(call.argv.includes('--disallowed-tools'));
    assert.equal(call.apiKeyEnv, null);
    assert.equal(call.baseUrlEnv, null);
  } finally {
    delete process.env['FAKE_ZCODE_LOG'];
    delete process.env['ZCODE_API_KEY'];
    delete process.env['ZCODE_BASE_URL'];
  }
});

test('探针臂：副本 HOME 跑后被清（只认 makeTempDir 的返回值）', async () => {
  // 私有 TMPDIR：公共 tmpdir 里别的用例文件（node --test 并行）也会建同前缀目录，扫公共目录会互相误判
  const L = await legacyLayout();
  const privateTmp = await tmp();
  const saved = process.env['TMPDIR'];
  process.env['TMPDIR'] = privateTmp;
  try {
    const r = await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.cliConfig });
    assert.equal(r.override, 'config_copy', r.why);
    assert.deepEqual(await fs.readdir(privateTmp), [], '探针的副本 HOME 必须被清掉');
  } finally {
    if (saved === undefined) delete process.env['TMPDIR']; else process.env['TMPDIR'] = saved;
  }
});

test('探针臂：源里有免密 provider（apiKeyRequired:false）→ 探针副本带上该键、导入被拒、如实 global（r3 CODEX-01）', async () => {
  // 此前白名单裁掉了 apiKeyRequired：探针副本不触发 Fqa、判 config_copy，而审查运行的整份拷贝会被整份拒掉——探针对运行假乐观
  const cfg = cliConfigFixture();
  (cfg['provider'] as Record<string, Record<string, unknown>>)['local-free'] = {
    name: 'Local', kind: 'openai-compatible', source: 'custom', enabled: true,
    options: { apiKey: 'x', apiKeyRequired: false, baseURL: 'http://127.0.0.1:1' },
    models: { 'local-a': {}, 'local-b': {} },
  };
  const { entry, cwd } = await legacyLayout();
  const { cliConfig } = await userHomeWithCliConfig(cfg);
  const r = await probeModelOverride(entry, process.execPath, cwd, { cliConfigPath: cliConfig });
  assert.equal(r.override, 'global', r.why);
  assert.match(r.why, /没有触发 legacy 导入/);
  // 白名单必须带上 apiKeyRequired（布尔），否则假入口看不到它、会照常导入
  const copy = buildProbeCliConfig(cfg as never, 'bigmodel-coding-plan/GLM-5.3-Flash');
  const opts = (copy['provider'] as Record<string, { options: Record<string, unknown> }>)['local-free']!.options;
  assert.equal(opts['apiKeyRequired'], false);
});

test('成员规则与导入器同源：deleted 成员不计、modelId 取 id 而非键名、account:/builtin: 与非 custom 的 provider 不进注册表（r3 CODEX-02）', () => {
  const cfg = {
    provider: {
      'bigmodel-coding-plan': {
        source: 'custom',
        models: { 'GLM-5.3': {}, 'GLM-5.3-Flash': { deleted: true }, 'glm-key': { id: 'GLM-5.4' } },
      },
      'account:bigmodel-individual-coding-plan': { source: 'custom', models: { 'glm-5.3': {} } },
      'builtin:zai': { models: { 'x': {} } },
      'managed': { source: 'managed', models: { 'GLM-5.3': {} } },
    },
  };
  const members = legacyProviderMembers(cfg as never);
  assert.deepEqual([...members.keys()], ['bigmodel-coding-plan']);
  assert.deepEqual([...members.get('bigmodel-coding-plan')!], ['GLM-5.3', 'GLM-5.4']);
  // 被删成员：限定失败而不是写进副本后运行期配不上
  assert.equal(qualifyAgainstCliConfig('GLM-5.3-Flash', cfg as never).qualified, null);
  // id 与键名不同：认 id
  assert.equal(qualifyAgainstCliConfig('GLM-5.4', cfg as never).qualified, 'bigmodel-coding-plan/GLM-5.4');
  assert.equal(qualifyAgainstCliConfig('bigmodel-coding-plan/glm-key', cfg as never).qualified, null);
  // 探针挑选跳过被删成员：第二个成员是 GLM-5.4，不是被删的 Flash
  assert.equal(pickNonFirstModel(cfg as never), 'bigmodel-coding-plan/GLM-5.4');
  // 裸名恰好只在一个会进注册表的 provider 下：managed 那份不计
  assert.equal(qualifyAgainstCliConfig('GLM-5.3', cfg as never).qualified, 'bigmodel-coding-plan/GLM-5.3');
});

test('切分与包内 okt 同规则——第一个 /：模型键名含 / 时限定与比对都不切错（r3 CODEX-03）', () => {
  const cfg = { provider: { p: { source: 'custom', models: { 'org/model-x': {}, 'plain': {} } } } };
  assert.equal(qualifyAgainstCliConfig('p/org/model-x', cfg as never).qualified, 'p/org/model-x');
  // 裸写 `org/model-x` 会被当成 provider `org`——与 okt 一致，这种模型名只能写全限定
  assert.equal(qualifyAgainstCliConfig('org/model-x', cfg as never).qualified, null);
  assert.equal(zcodeModelTail('p/org/model-x'), 'org/model-x');
  assert.equal(zcodeModelTail('84044858-fake/org/model-x'), 'org/model-x');
  assert.equal(decideModelOverride(true, 'p/org/model-x', '84044858-fake/org/model-x').applied, true);
});

test('探针臂：目录里没有非首位模型 → 未判定（null），不写结论', async () => {
  const { entry, cwd } = await legacyLayout();
  const { cliConfig } = await userHomeWithCliConfig({ provider: { a: { source: 'custom', options: { apiKey: 'x' }, models: { only: {} } } } });
  const r = await probeModelOverride(entry, process.execPath, cwd, { cliConfigPath: cliConfig });
  assert.equal(r.override, null);
  assert.match(r.why, /非首位/);
});

// ── 守卫：覆盖没落实要响亮 ──

async function resultWith(applied: boolean | null | undefined) {
  const { failedResult } = await import('../../src/trivium/adapters/base.js');
  const base = failedResult('glm', { status: 'failed', reason: '夹具' });
  return applied === undefined ? base : { ...base, model_override_applied: applied };
}

async function verdictOf(applied: boolean | null | undefined) {
  const { judgeSide } = await import('../../src/trivium/guard.js');
  const { defaultConfig } = await import('../../src/trivium/config.js');
  const { TOOL_TRACE_CAPABILITY } = await import('../../src/trivium/adapters/base.js');
  const req = {
    critic: 'glm' as const, stage: 'code' as const, model: 'GLM-5.3', effort: null,
    brief_text: '', brief_path: '/proj/b.md', subject_path: '/proj/s.md',
    project_root: '/proj', out_dir: '/tmp/out', timeout_s: 60,
    min_tool_calls: 0, min_project_reads: 0, deny_paths: [],
  };
  return judgeSide(defaultConfig(), 'glm', await resultWith(applied), null, req as never, {
    archiveRootAbs: '/proj/.reviews', projectRoot: '/proj',
    triviumDir: '/proj/.trivium', runRoot: '/tmp/runs',
    capability: TOOL_TRACE_CAPABILITY,
  });
}

async function warningsFor(applied: boolean | null | undefined): Promise<string[]> {
  const { renderGuardWarnings } = await import('../../src/trivium/guard.js');
  return renderGuardWarnings({
    sides: { glm: await verdictOf(applied) }, drift: { changed: false, files: [], related: [] },
    driftAction: 'ok', fingerprintChangedFiles: [], unattributedDriftFiles: [],
  } as never);
}

test('守卫：judgeSide 原样透传四种情况，本层不做归一', async () => {
  assert.equal((await verdictOf(true)).modelOverrideApplied, true);
  assert.equal((await verdictOf(false)).modelOverrideApplied, false);
  assert.equal((await verdictOf(null)).modelOverrideApplied, null);
  assert.equal('modelOverrideApplied' in (await verdictOf(undefined)), false);
});

test('守卫：覆盖没落实 → 播报一条，点明 FR-06 / NFR-06 失效；其余三种不出声', async () => {
  const notes = await warningsFor(false);
  assert.ok(notes.some((n) => n.includes('没有生效') && n.includes('FR-06') && n.includes('NFR-06')), notes.join(' / '));
  for (const v of [true, null, undefined] as const) {
    assert.equal((await warningsFor(v)).some((n) => n.includes('没有生效')), false, String(v));
  }
});

test('守卫：不判失守、不动证据判定', async () => {
  const v = await verdictOf(false);
  const ok = await verdictOf(true);
  assert.equal(v.readonlyBreach, ok.readonlyBreach);
  assert.equal(v.evidenceOk, ok.evidenceOk);
});
