/**
 * ZCode 0.16.9 provider 配置注入（坑 P-28 / P-29 / P-30）。
 *
 * 背景：0.16.9 的 `zcode.cjs` 按**入口目录**推算 `zcode-builtin.json`，应用包布局下推算不到，
 * 独立拉起时先于参数解析就报「无法定位 CLI ZCode Built-in Provider Config」退出。
 * 桌面端起 CLI 靠 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
 * 传路径；适配层此前只透传 `HOME`。
 *
 * 用例用一个**假入口脚本**（node 跑的 .cjs）按真实 CLI 的三种 stderr 形态应答，
 * 不碰真实 ZCode、不花配额：
 *   - 没拿到内置变量 → 打「Built-in Provider Config」那行，退 1（P-28 形态）
 *   - 拿到了且 argv 含被拒旗标 → 打 `Unknown option '<flag>'`（参数解析在配置定位之后）
 *   - 其余 → 打 `Error: Model creation failed`，退 1（空 HOME、无凭据的停点）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  invokeZcode,
  tildeHome,
  zcodeProviderConfigPaths,
  zcodeProviderEnv,
  zcodeStorageRedirectEnv,
  readonlyArgsFromProbe,
  ZCODE_BETA_ARGV_RE,
  ZCODE_BUILTIN_PROVIDER_ENV,
  ZCODE_CREDENTIAL_ENV_KEYS,
  ZCODE_DIR_ENV_KEYS,
  ZCODE_LANDING_SWITCH_ENV_KEYS,
  ZCODE_PERSONAL_PROVIDER_ENV,
  ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE,
} from '../../src/trivium/adapters/zcode.js';
import { probeReadonlyFlags, probeZcode, probeZcodeEntry, type FullCopyOverrideProbe, type ModelOverrideProbe, type RuntimeSelectionReadback, type VariantOutcome } from '../../src/trivium/probes/zcode.js';
import { runDoctor } from '../../src/trivium/doctor.js';
import { agentConfigOf, defaultConfig, defaultProbe } from '../../src/trivium/config.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';

// WIN_FILE_SKIP（Windows 移植）：zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）
// macOS/Linux 行为零变化。Windows 侧【无等价物】：本文件守的是 HOME 隔离夹具下的文件级语义
// （凭据值不出现在输出、选模落实、provider env 剥离），platform-win.test.ts 只覆盖平台原语、
// 覆盖不了这些——残余登记 Bug 清单 §3.1-2/6，适配前不要引用本文件作为 Windows 的覆盖证据。
if (process.platform === 'win32') {
  console.log('skip（win32）: zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）');
} else {

// doctor / preflight 的共享读取面扫描读空夹具，不读真实家目录（EV-240，计划双审 CODEX-01 / GLM-01）
isolateEntryScanHome();

const REAL_ENTRY = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';

/** 假入口：模拟 0.16.9 的「provider 配置定位 → 参数解析 → 模型创建」顺序，并把收到的 env 记到日志 */
const FAKE_ENTRY_SOURCE = `
const fs = require('node:fs');
const env = process.env;
if (env.FAKE_ZCODE_LOG) {
  fs.appendFileSync(env.FAKE_ZCODE_LOG, JSON.stringify({
    argv: process.argv.slice(2),
    builtin: env.${ZCODE_BUILTIN_PROVIDER_ENV} ?? null,
    personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null,
    home: env.HOME ?? null,
    dataBase: env.ZCODE_DATA_BASE_DIR ?? null,
    zhome: env.ZCODE_HOME ?? null,
    storage: env.ZCODE_STORAGE_DIR ?? null,
    logDir: env.ZCODE_LOG_DIR ?? null,
    apiKeyEnv: env.ZCODE_API_KEY ?? null,
    baseUrlEnv: env.ZCODE_BASE_URL ?? null,
    // EV-112：会话库两个别名、mailbox 根与四个落点开关键
    sessionDbPath: env.ZCODE_SESSION_DB_PATH ?? null,
    sessionDb: env.ZCODE_SESSION_DB ?? null,
    mailboxRoot: env.ZCODE_MAILBOX_ROOT ?? null,
    runtimeEnv: env.ZCODE_RUNTIME_ENV ?? null,
    beta: env.ZCODE_BETA ?? null,
    zenv: env.ZCODE_ENV ?? null,
    messageEnabled: env.ZCODE_MESSAGE_ENABLED ?? null,
  }) + '\\n');
}
const argv = process.argv.slice(2);
if (argv[0] === 'version') {
  // 版本子命令不读 provider 配置（0.16.9 实测，P-28）——探针也据此只清不给
  process.stdout.write('zcode 0.16.9\\n');
  process.exit(0);
}
if (!env.${ZCODE_BUILTIN_PROVIDER_ENV}) {
  process.stderr.write('无法定位 CLI ZCode Built-in Provider Config：/x/provider/zcode-builtin.json, /config/provider/zcode-builtin.json\\n');
  process.exit(1);
}
if (env.FAKE_LOCK_HOME) {
  // 删不掉的临时 HOME（EV-198 R1 / D19）：HOME 下一个只读子目录里放一个文件，七次拉起幂等。
  // 摆不出就退 3（计划 r2 §3.1 摆锁守则）：候选落成 indeterminate、删除照常成功，用例的提示断言随之红
  const locked = env.HOME + '/locked';
  try {
    if (!fs.existsSync(locked)) { fs.mkdirSync(locked); fs.writeFileSync(locked + '/f', 'x'); fs.chmodSync(locked, 0o500); }
  } catch (e) { process.stderr.write('FAKE_LOCK_HOME：摆不出删不掉的 HOME：' + e.message + '\\n'); process.exit(3); }
  if (!fs.existsSync(locked + '/f')) { process.stderr.write('FAKE_LOCK_HOME：锁目录里没有文件\\n'); process.exit(3); }
}
if (env.FAKE_ZCODE_FLAG_ZERO_EXIT) {
  // 旗标探针路径上退 0：零配额前提被打破的形态（本该停在模型层）
  process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'OK', usage: {}, eventCount: 1 }, null, 2) + '\\n');
  process.exit(0);
}
if (env.FAKE_ZCODE_WEIRD_FAIL) {
  // 「参数解析同样没发生」的未识别形态：既不报 Unknown option，也没有模型/凭据层停点
  process.stderr.write('Error: kernel panic in module loader\\n');
  process.exit(1);
}
for (const rejected of ['--max-turns', '--settings']) {
  if (argv.includes(rejected)) {
    process.stderr.write("Unknown option '" + rejected + "'. To specify a positional argument starting with a '-', place it at the end.\\n");
    process.exit(1);
  }
}
if (env.FAKE_ZCODE_NOISY_OK) {
  // 正常跑通、但 stderr 里出现同一个名词（诊断行）——退出码门控之前这会被判成布局失败
  process.stderr.write('debug: resolved CLI ZCode Built-in Provider Config from env\\n');
  process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'OK', usage: {}, eventCount: 1 }, null, 2) + '\\n');
  process.exit(0);
}
if (env.FAKE_ZCODE_ECHO_ENV) {
  process.stdout.write('AI SDK Warning: noise line\\n');
  process.stdout.write(JSON.stringify({
    sessionId: 'sess_fake',
    response: JSON.stringify({ builtin: env.${ZCODE_BUILTIN_PROVIDER_ENV}, personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null, home: env.HOME }),
    usage: {},
    eventCount: 1,
  }, null, 2) + '\\n');
  process.exit(0);
}
if (env.FAKE_ZCODE_SELECT_MODEL) {
  // 0.17.0 停点（2026-10-29 Windows 真机验收实测）：只给内置、空 HOME 时模型选择层前置，
  // 合法候选（未进上面 Unknown 拒绝表的）参数解析已过、停在这一行——属「接受」的正向证据
  process.stderr.write('Error: Select a model before sending a message (traceId: fake)\\n');
  process.exit(1);
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

/** 探针路径必须清掉的全部键——由适配器的两组常量 + 两个 provider 键派生，不手抄 */
const ALL_CLEARED_KEYS: readonly string[] = [
  ZCODE_BUILTIN_PROVIDER_ENV, ZCODE_PERSONAL_PROVIDER_ENV, ...ZCODE_DIR_ENV_KEYS, ...ZCODE_LANDING_SWITCH_ENV_KEYS, ...ZCODE_CREDENTIAL_ENV_KEYS,
];
/** 每个键在假入口日志里对应的字段名 */
const LOG_FIELD_OF: Record<string, string> = {
  [ZCODE_BUILTIN_PROVIDER_ENV]: 'builtin', [ZCODE_PERSONAL_PROVIDER_ENV]: 'personal',
  ZCODE_DATA_BASE_DIR: 'dataBase', ZCODE_HOME: 'zhome', ZCODE_STORAGE_DIR: 'storage', ZCODE_LOG_DIR: 'logDir',
  ZCODE_SESSION_DB_PATH: 'sessionDbPath', ZCODE_SESSION_DB: 'sessionDb', ZCODE_MAILBOX_ROOT: 'mailboxRoot',
  ZCODE_RUNTIME_ENV: 'runtimeEnv', ZCODE_BETA: 'beta', ZCODE_ENV: 'zenv', ZCODE_MESSAGE_ENABLED: 'messageEnabled',
  ZCODE_API_KEY: 'apiKeyEnv', ZCODE_BASE_URL: 'baseUrlEnv',
};
/**
 * EV-112 的十一键清除面，**逐字写出、不从常量派生**：从常量派生的话，常量里漏了一个键，期望值跟着漏，断言照绿（变异 M6 / M10）。
 * 七个目录 / 路径键 + 四个落点开关键，全部恒在场、恒 undefined。
 */
const ELEVEN_CLEARED: Record<string, undefined> = {
  ZCODE_DATA_BASE_DIR: undefined, ZCODE_HOME: undefined, ZCODE_STORAGE_DIR: undefined, ZCODE_LOG_DIR: undefined,
  ZCODE_SESSION_DB_PATH: undefined, ZCODE_SESSION_DB: undefined, ZCODE_MAILBOX_ROOT: undefined,
  ZCODE_RUNTIME_ENV: undefined, ZCODE_BETA: undefined, ZCODE_ENV: undefined, ZCODE_MESSAGE_ENABLED: undefined,
};

/**
 * 摆出应用包布局：`<root>/Resources/glm/zcode.cjs` 与 `<root>/Resources/config/provider/zcode-builtin.json`
 * 是兄弟目录。`withBuiltin=false` 时不放内置文件，模拟布局变了 / 文件丢了。
 */
async function layout(opts: { withBuiltin: boolean; withPersonal: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-zprov-'));
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, FAKE_ENTRY_SOURCE, 'utf8');
  const builtin = path.join(root, 'Resources/config/provider/zcode-builtin.json');
  if (opts.withBuiltin) {
    await fs.mkdir(path.dirname(builtin), { recursive: true });
    await fs.writeFile(builtin, '{}', 'utf8');
  }
  const userHome = path.join(root, 'home');
  const personal = path.join(userHome, '.zcode/v2/provider_config.json');
  if (opts.withPersonal) {
    await fs.mkdir(path.dirname(personal), { recursive: true });
    await fs.writeFile(personal, '{}', { encoding: 'utf8', mode: 0o600 });
  }
  const cwd = path.join(root, 'proj');
  await fs.mkdir(cwd, { recursive: true });
  return {
    root, entry, builtin, userHome, personal, cwd,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

// ── 路径派生：纯函数 ──

test('内置配置路径按入口派生：Resources/glm/zcode.cjs → Resources/config/provider/zcode-builtin.json', async () => {
  const p = await zcodeProviderConfigPaths(REAL_ENTRY, '/Users/u');
  assert.equal(p.builtin, '/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json');
  assert.equal(p.personal, '/Users/u/.zcode/v2/provider_config.json');
});

test('个人配置路径跟用户目录走，不跟入口走（config_copy 的假 HOME 下也要指向真实那份）', async () => {
  const p = await zcodeProviderConfigPaths('/opt/elsewhere/glm/zcode.cjs', '/home/real');
  assert.equal(p.builtin, '/opt/elsewhere/config/provider/zcode-builtin.json');
  assert.equal(p.personal, '/home/real/.zcode/v2/provider_config.json');
});

test('软链入口先 realpath 再取兄弟目录：派生落在真实安装布局上，不落在软链所在目录', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  try {
    // 形如 /usr/local/bin/zcode.cjs → <app>/Resources/glm/zcode.cjs
    const binDir = path.join(L.root, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const link = path.join(binDir, 'zcode.cjs');
    await fs.symlink(L.entry, link);
    const p = await zcodeProviderConfigPaths(link, '/home/real');
    assert.equal(p.builtin, await fs.realpath(L.builtin), '解软链后才是真实布局里的那份');
    assert.notEqual(p.builtin, path.join(L.root, 'config/provider/zcode-builtin.json'));
    // 相对入口按 cwd 解析后同样要解软链，不能落到 process.cwd()
    assert.deepEqual(
      await zcodeProviderConfigPaths(path.relative(process.cwd(), link), '/home/real'),
      p,
    );
  } finally {
    await L.cleanup();
  }
});

test('入口不存在（软链断了 / 布局变了）时回落到词法路径，不抛', async () => {
  const p = await zcodeProviderConfigPaths('/nonexistent-zcode/Resources/glm/zcode.cjs', '/home/real');
  assert.equal(p.builtin, '/nonexistent-zcode/Resources/config/provider/zcode-builtin.json');
});

// ── 存在性门控 ──

test('两份都在 → 两个变量都给，值为绝对路径', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: true });
  try {
    const env = await zcodeProviderEnv(L.entry, L.userHome);
    assert.deepEqual(env, {
      [ZCODE_BUILTIN_PROVIDER_ENV]: await fs.realpath(L.builtin),
      [ZCODE_PERSONAL_PROVIDER_ENV]: L.personal,
      // 目录 / 路径键与落点开关键恒在场、恒 undefined（r3 CODEX-02；EV-110 加 ZCODE_LOG_DIR；EV-112 扩到十一键）
      ...ELEVEN_CLEARED,
    });
  } finally {
    await L.cleanup();
  }
});

test('文件不在 → 该键值为 undefined（不是缺席）：宿主环境里预置的同名变量必须被删掉', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: false });
  try {
    const env = await zcodeProviderEnv(L.entry, L.userHome);
    assert.deepEqual(env, {
      [ZCODE_BUILTIN_PROVIDER_ENV]: undefined,
      [ZCODE_PERSONAL_PROVIDER_ENV]: undefined,
      ...ELEVEN_CLEARED,
    });
    // 键必须在场——`run()` 只对「值为 undefined 的键」执行删除，键缺席就是原样透传
    assert.ok(Object.hasOwn(env, ZCODE_BUILTIN_PROVIDER_ENV));
    assert.ok(Object.hasOwn(env, ZCODE_PERSONAL_PROVIDER_ENV));
    // 宿主预置 ZCODE_DATA_BASE_DIR 会让 CLI 把个人配置根推到副本之外（r3 CODEX-02）；EV-112 的七个键同理，只能靠删
    for (const k of Object.keys(ELEVEN_CLEARED)) assert.ok(Object.hasOwn(env, k), k);
  } finally {
    await L.cleanup();
  }
  const M = await layout({ withBuiltin: true, withPersonal: false });
  try {
    assert.deepEqual(await zcodeProviderEnv(M.entry, M.userHome), {
      [ZCODE_BUILTIN_PROVIDER_ENV]: await fs.realpath(M.builtin),
      [ZCODE_PERSONAL_PROVIDER_ENV]: undefined,
      ...ELEVEN_CLEARED,
    });
  } finally {
    await M.cleanup();
  }
});

// ── invokeZcode：唯一执行点真的把变量递给了子进程 ──

test('invokeZcode 把内置变量递给子进程，且 HOME 副本覆盖不影响它', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const fakeHome = path.join(L.root, 'run-home');
  await fs.mkdir(fakeHome, { recursive: true });
  process.env['FAKE_ZCODE_ECHO_ENV'] = '1';
  try {
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: ['--mode', 'plan'], homeDir: fakeHome, userHome: L.userHome, timeoutMs: 30_000,
    });
    assert.equal(out.failureKind, 'none');
    assert.ok(out.envelope, '假入口按真实形态先打一行告警再打 envelope，抠得出来');
    const seen = JSON.parse(out.envelope!.response) as { builtin: string; personal: string | null; home: string };
    assert.equal(seen.builtin, await fs.realpath(L.builtin), '内置路径按入口派生，是绝对路径');
    assert.equal(seen.personal, null, '个人那份不在 → 键被删；不传 userHome 时这里吃的是开发机真实存在的那份');
    assert.equal(seen.home, fakeHome, 'HOME 仍按 config_copy 档指向运行副本');
  } finally {
    delete process.env['FAKE_ZCODE_ECHO_ENV'];
    await L.cleanup();
  }
});

test('内置文件不在 → 不注入，CLI 原话进 failureKind=provider_config_unresolved（退出码非 0 且 stderr 命中）', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: false });
  try {
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, timeoutMs: 30_000,
    });
    assert.equal(out.failureKind, 'provider_config_unresolved');
    assert.equal(out.envelope, null);
    assert.match(out.stderr, ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
  } finally {
    await L.cleanup();
  }
});

test('退出码门控：正常退 0 而 stderr 里出现同一名词（诊断行）→ 不判成布局失败', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_NOISY_OK'] = '1';
  try {
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, timeoutMs: 30_000,
    });
    assert.equal(out.exitCode, 0);
    assert.match(out.stderr, ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE, '名词确实出现在 stderr 里');
    assert.equal(out.failureKind, 'none', '裸正则不看退出码时，这一次成功的调用会被判成 provider_config_unresolved');
  } finally {
    delete process.env['FAKE_ZCODE_NOISY_OK'];
    await L.cleanup();
  }
});

test('宿主环境预置了同名变量 → 子进程必须拿不到：只追加不清除等于原样透传', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: false });
  const log = path.join(L.root, 'calls.jsonl');
  process.env['FAKE_ZCODE_LOG'] = log;
  const decoyBuiltin = path.join(L.root, 'decoy-builtin.json');
  const decoyPersonal = path.join(L.root, 'decoy-personal.json');
  process.env[ZCODE_BUILTIN_PROVIDER_ENV] = decoyBuiltin;
  process.env[ZCODE_PERSONAL_PROVIDER_ENV] = decoyPersonal;
  try {
    // 两份都不在 → 两个键都被删；假入口据此走「定位不到」那一支，而不是拿着诱饵路径往下跑。
    // **必须传 userHome**：不传就吃真实 os.homedir()，开发机上个人那份真实存在，
    // 于是个人键是「被真实路径覆盖」而非「被删」，断言只靠内置那一半侥幸成立（r3 CODEX-F01-02）。
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, userHome: L.userHome, timeoutMs: 30_000,
    });
    assert.equal(out.failureKind, 'provider_config_unresolved');
    // 直接看子进程收到了什么：两个诱饵都不得出现
    const seen = JSON.parse((await fs.readFile(log, 'utf8')).trim()) as {
      builtin: string | null; personal: string | null;
    };
    assert.equal(seen.builtin, null, '内置诱饵必须被删，不是被覆盖');
    assert.equal(seen.personal, null, '个人诱饵必须被删——这一半正是旧用例没锁住的');
  } finally {
    delete process.env['FAKE_ZCODE_LOG'];
    delete process.env[ZCODE_BUILTIN_PROVIDER_ENV];
    delete process.env[ZCODE_PERSONAL_PROVIDER_ENV];
    await L.cleanup();
  }
});

// ── EV-112：落点键（计划 r3 §4.1～§4.4）──

test('U1 zcodeStorageRedirectEnv：恰好三键，布局与「HOME=<root> 时 CLI 的缺省值」逐字相同；入参是 .zcode 本身时抛错（含尾斜杠）', () => {
  const root = path.join(os.tmpdir(), 'side', 'home');
  assert.deepEqual(zcodeStorageRedirectEnv(root), {
    ZCODE_STORAGE_DIR: path.join(root, '.zcode'),
    ZCODE_SESSION_DB_PATH: path.join(root, '.zcode', 'cli', 'db', 'db.sqlite'),
    ZCODE_LOG_DIR: path.join(root, '.zcode', 'cli', 'log'),
  });
  // run() 回读用的 cliDir 是 path.join(root, '.zcode/cli')：日志目录必须就在它下面，两处不能各拼各的
  assert.equal(path.dirname(zcodeStorageRedirectEnv(root)['ZCODE_LOG_DIR']!), path.join(root, '.zcode/cli'));
  // 入参层级约定（AGY-02 / AGY-r2-01）：传 .zcode 会得到 .zcode/.zcode 嵌套且不报错，必须抛
  assert.throws(() => zcodeStorageRedirectEnv(path.join(root, '.zcode')), /不是 \.zcode 目录本身/);
  assert.throws(() => zcodeStorageRedirectEnv(path.join(root, '.zcode') + path.sep), /不是 \.zcode 目录本身/, '尾部分隔符不得绕过判断');
});

test('U2 invokeZcode 先清后设：宿主预置十一键诱饵 ⇒ 给落点根时子进程拿到编排器的三个值、其余八个为 null；不给时十一个全 null；HOME 不受落点根影响', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const log = path.join(L.root, 'calls.jsonl');
  const preset: Record<string, string> = { FAKE_ZCODE_LOG: log };
  for (const k of Object.keys(ELEVEN_CLEARED)) preset[k] = `host-preset-${k}`;
  // 先记宿主原值、finally 逐键还原（代码双审 r1 GLM-02）：本机宿主若预置了这些键，只删不还会改掉后续用例的底色
  const saved = Object.fromEntries(Object.keys(preset).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(preset)) process.env[k] = v;
  const landing = path.join(L.root, 'side', 'home');
  try {
    await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, userHome: L.userHome, storageRedirectRoot: landing, timeoutMs: 30_000,
    });
    await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, userHome: L.userHome, timeoutMs: 30_000,
    });
    const [withRoot, without] = (await fs.readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, string | null>);
    const want = zcodeStorageRedirectEnv(landing);
    assert.equal(withRoot!['storage'], want['ZCODE_STORAGE_DIR']);
    assert.equal(withRoot!['sessionDbPath'], want['ZCODE_SESSION_DB_PATH']);
    assert.equal(withRoot!['logDir'], want['ZCODE_LOG_DIR']);
    for (const k of Object.keys(ELEVEN_CLEARED).filter((k) => !(k in want))) {
      assert.equal(withRoot![LOG_FIELD_OF[k]!], null, `${k}：宿主诱饵必须被清掉（先清后设，变异 M2 / M10）`);
    }
    for (const k of Object.keys(ELEVEN_CLEARED)) assert.equal(without![LOG_FIELD_OF[k]!], null, `${k}：不给落点根时十一键全清`);
    // 落点根只管 CLI 产物，不改 HOME（无副本支的个人配置与凭据照旧从真实 HOME 来）
    assert.equal(withRoot!['home'], process.env['HOME'] ?? null);
    assert.equal(without!['home'], process.env['HOME'] ?? null);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await L.cleanup();
  }
});

test('ZCODE_BETA_ARGV_RE 与包内 RMi 同形：…/zcode-beta 结尾或后跟「.」命中，目录段 …/zcode-beta/… 不命中', () => {
  assert.equal(ZCODE_BETA_ARGV_RE.test('/Applications/zcode-beta.app/Contents/Resources/glm/zcode.cjs'), true);
  assert.equal(ZCODE_BETA_ARGV_RE.test('/opt/zcode-beta'), true);
  assert.equal(ZCODE_BETA_ARGV_RE.test('/opt/zcode-beta/glm/zcode.cjs'), false);
  assert.equal(ZCODE_BETA_ARGV_RE.test(REAL_ENTRY), false);
});

test('failureKind 的判据只认英文名词片段，中文前缀换了也认得出', () => {
  assert.match('无法定位 CLI ZCode Built-in Provider Config：a, b', ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
  assert.match('Cannot locate CLI ZCode Built-in Provider Config: a, b', ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
  assert.doesNotMatch('Error: Model creation failed (traceId: x)', ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
});

// ── probeReadonlyFlags：第三态与「只注入内置」 ──

test('P-29：provider 配置定位失败时七个候选全部 indeterminate，一个都不算接受', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: true });
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.accepted, [], '2026-09-19 那次 doctor 就是在这里把 7 个候选全记成了接受');
    assert.deepEqual(r.rejected, []);
    assert.equal(r.indeterminate.length, 7);
  } finally {
    await L.cleanup();
  }
});

test('0.17.0 停点：Select a model 是「参数已解析」的正向证据，五个合法候选判接受而非 indeterminate（2026-10-29 Windows 真机验收）', async () => {
  /*
   * 0.17.0 把无凭据停点从 `Model creation failed` 换成模型选择前置（Select a model）。
   * 实测该停点仍在参数解析之后：同环境 `--bogus-flag` 照报 Unknown option——
   * 与 P-29 的「provider 定位先于参数解析」不同族。不补进 ZCODE_ARGV_PARSED_RE 时，
   * 真机上三个候选全部 indeterminate、readonly_flags 判不出，glm 侧被 fail-closed 拒入。
   */
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_SELECT_MODEL'] = '1';
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.accepted, [
      '--mode plan',
      '--mode yolo',
      '--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash',
      '--allowed-tools Read,Grep,Glob',
      '--permission-mode plan',
    ]);
    // 假入口硬编码的两个拒绝候选不受开关影响：Unknown option 先于一切停点
    assert.deepEqual(r.rejected, ['--max-turns 40', '--settings /nonexistent-probe-settings.json']);
    assert.deepEqual(r.indeterminate, [], '0.17.0 停点被误判 indeterminate 会让 glm 侧整侧不可准入');
  } finally {
    delete process.env['FAKE_ZCODE_SELECT_MODEL'];
    await L.cleanup();
  }
});

test('旗标探针：宿主预置 ZCODE_DATA_BASE_DIR / ZCODE_API_KEY → 七次拉起的子进程一个都拿不到（代码双审 r1 codex 子项 01 ≡ AGY-01）', async () => {
  /*
   * 此前只解构内置键、手拼两键对象递给 run()，三个目录键被丢在解构之外——`run()` 只对「值为 undefined 的键」
   * 做删除，键缺席就是原样透传。宿主预置 ZCODE_DATA_BASE_DIR 时，0.16.9 的 FZi 会按它推出副本外的个人配置根，
   * 空 HOME 挡不住，七个候选变七次真实调用。这条用例锁的是「子进程拿不到」，与个人键那条同一口径。
   */
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const log = path.join(L.root, 'calls.jsonl');
  process.env['FAKE_ZCODE_LOG'] = log;
  // 预置表按两组常量**全量派生**（代码双审 r2 CODEX-05）：标题说七个键，就得七个键都预置、都断言
  for (const k of ALL_CLEARED_KEYS) process.env[k] = `host-preset-${k}`;
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.indeterminate, []);
    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n')
      .map((l) => JSON.parse(l) as Record<string, string | null>);
    assert.equal(calls.length, 7);
    const realBuiltin = await fs.realpath(L.builtin);
    for (const c of calls) {
      for (const [k, field] of Object.entries(LOG_FIELD_OF)) {
        if (k === ZCODE_BUILTIN_PROVIDER_ENV) {
          // 内置键是唯一要**给**的：宿主诱饵必须被派生路径覆盖，而不是被删
          assert.equal(c[field], realBuiltin, '内置变量每次都按安装布局派生，宿主预置值不生效');
          continue;
        }
        assert.equal(c[field], null, `${k} 必须被删掉（ZCODE_DATA_BASE_DIR 会让 FZi 把个人配置根推到副本之外；凭据键不该进探针路径）`);
      }
    }
  } finally {
    delete process.env['FAKE_ZCODE_LOG'];
    for (const k of ALL_CLEARED_KEYS) delete process.env[k];
    await L.cleanup();
  }
});

test('P-28 / P-30：内置文件在 → 参数解析结论可判；只注入内置那份、个人那份一次都不给', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: true });
  const log = path.join(L.root, 'calls.jsonl');
  process.env['FAKE_ZCODE_LOG'] = log;
  // 诱饵：宿主环境里预置两个路径。旧实现只追加不清除，个人那份会原样透传进空 HOME 的探针，
  // 而它自带默认模型——七个候选就是七次真实模型调用。断言的是「子进程拿不到」，不是「我没给」
  process.env[ZCODE_BUILTIN_PROVIDER_ENV] = path.join(L.root, 'decoy-builtin.json');
  process.env[ZCODE_PERSONAL_PROVIDER_ENV] = path.join(L.root, 'decoy-personal.json');
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.indeterminate, []);
    assert.deepEqual(
      r.rejected.sort(),
      ['--max-turns 40', '--settings /nonexistent-probe-settings.json'].sort(),
    );
    assert.ok(r.accepted.includes('--mode plan'));
    assert.ok(r.accepted.some((f) => f.startsWith('--disallowed-tools')));

    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n')
      .map((l) => JSON.parse(l) as { builtin: string | null; personal: string | null; home: string | null });
    assert.equal(calls.length, 7, '七个候选各拉起一次');
    const realBuiltin = await fs.realpath(L.builtin);
    for (const c of calls) {
      assert.equal(c.builtin, realBuiltin, '内置变量每次都给');
      assert.equal(c.personal, null, '个人配置自带默认模型，给了它空 HOME 就挡不住真实模型调用（P-30）');
      assert.notEqual(c.home, os.homedir(), 'HOME 仍指向空目录');
      assert.notEqual(c.home, L.userHome);
    }
  } finally {
    delete process.env['FAKE_ZCODE_LOG'];
    delete process.env[ZCODE_BUILTIN_PROVIDER_ENV];
    delete process.env[ZCODE_PERSONAL_PROVIDER_ENV];
    await L.cleanup();
  }
});

// ── 探针空壳 ──

test('defaultProbe 的 zcode 段带 provider_config: null（未探过 ≠ 未找到）', () => {
  assert.equal(defaultProbe().cli.zcode!.provider_config, null);
});

// ── 正向证据判据：判不出就不记接受（r4 CODEX-01）──

test('未识别的失败形态 → 全部 indeterminate，一条都不回落成接受', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_WEIRD_FAIL'] = '1';
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.accepted, [], '否定式判据会把这七个全记成接受——与 P-29 同类污染，只是换了成因');
    assert.deepEqual(r.rejected, []);
    assert.equal(r.indeterminate.length, 7);
    assert.match(r.indeterminate[0]!.why, /未识别的失败形态（退出码 1）/);
    assert.match(r.indeterminate[0]!.why, /kernel panic/, '成因要带上 stderr 首行，否则又得复跑一次探针才知道');
  } finally {
    delete process.env['FAKE_ZCODE_WEIRD_FAIL'];
    await L.cleanup();
  }
});

// ── 临时 HOME 删不掉（EV-198）──

const ROOT = process.getuid?.() === 0;

/** 把私有临时根下各探针目录里的 `locked` 解锁（用例收尾时调；解不开的忽略） */
async function unlockUnder(priv: string): Promise<void> {
  for (const e of await fs.readdir(priv).catch(() => [] as string[])) {
    await fs.chmod(path.join(priv, e, 'locked'), 0o700).catch(() => {});
  }
}

test('R1 旗标探针的空 HOME 删不掉：不抛、结论与不锁时相同、提示取「没有副本」档（EV-198）', { skip: ROOT }, async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const priv = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-r1-priv-'));
  const saved = process.env['TMPDIR'];
  try {
    const base = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.equal(base.tempDirResidue, null, '删成功时不带提示');
    process.env['TMPDIR'] = priv;
    process.env['FAKE_LOCK_HOME'] = '1';
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(
      { accepted: r.accepted, rejected: r.rejected, indeterminate: r.indeterminate, zeroExit: r.zeroExit },
      { accepted: base.accepted, rejected: base.rejected, indeterminate: base.indeterminate, zeroExit: base.zeroExit },
      '删除失败不改结论',
    );
    const left = (await fs.readdir(priv)).filter((e) => e.startsWith('trivium-flagprobe-'));
    assert.equal(left.length, 1, '本格就是要摆出删不掉：私有根下应恰有一个残留');
    assert.equal(
      r.tempDirResidue,
      `⚠️ 探针临时目录删除失败（EACCES）：${tildeHome(path.join(priv, left[0]!))} 仍在，其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除`,
    );
  } finally {
    delete process.env['FAKE_LOCK_HOME'];
    if (saved === undefined) delete process.env['TMPDIR']; else process.env['TMPDIR'] = saved;
    await unlockUnder(priv);
    await fs.rm(priv, { recursive: true, force: true });
    await L.cleanup();
  }
});

// ── doctor 的 warnings 档（r4 CODEX-03）──
//
// 放在本文件而不是新开一个：这两条要用上面的 layout() 与假入口摆形态，
// 而「旗标本轮未判定」正是本文件这套装置唯一能摆出来的场景。

async function doctorOnZcode(entry: string, projectRoot: string) {
  const cfg = defaultConfig();
  agentConfigOf(cfg, 'glm', 'zcode').entry = entry;
  const triviumDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-doctor-'));
  try {
    // triviumDir 下没有 bin/trivium ⇒ checkWrapper 返回空，不引入无关 blocker；
    // 探针结论写进这个临时目录，不碰真实仓库。
    // 两条模型覆盖臂注入合成配置与桩（代码双审 r2 CODEX-03）：否则在装了 ZCode 的机器上会读真实
    // ~/.zcode/cli/config.json 并真实拉起，同一用例在不同机器上走不同路径
    const cliConfigPath = path.join(triviumDir, 'cli-config.json');
    await fs.writeFile(cliConfigPath, '{"provider":{},"model":{}}', 'utf8');
    return await runDoctor({
      projectRoot, triviumDir, config: cfg, skipModelCalls: true, only: 'zcode',
      zcodeProbe: {
        cliConfigPath,
        modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩：本轮未判定' }),
        modelOverrideFullCopyProbe: async () => ({
          override: null, requested: null, observed: null, why: '桩：本轮未判定', replacedPaths: [], hostCredentialEnv: [],
        }),
      },
    });
  } finally {
    await fs.rm(triviumDir, { recursive: true, force: true });
  }
}

test('D19 旗标探针的空 HOME 删不掉：doctor 不崩、阻断与告警与不锁时相同、结论照常落盘，note 带残留提示（EV-198）', { skip: ROOT }, async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const priv = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-d19-priv-'));
  const saved = process.env['TMPDIR'];
  const run = async () => {
    const cfg = defaultConfig();
    agentConfigOf(cfg, 'glm', 'zcode').entry = L.entry;
    const triviumDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-doctor-'));
    const cliConfigPath = path.join(triviumDir, 'cli-config.json');
    await fs.writeFile(cliConfigPath, '{"provider":{},"model":{}}', 'utf8');
    const rep = await runDoctor({
      projectRoot: L.cwd, triviumDir, config: cfg, skipModelCalls: true, only: 'zcode',
      zcodeProbe: {
        cliConfigPath,
        modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩：本轮未判定' }),
        modelOverrideFullCopyProbe: async () => ({
          override: null, requested: null, observed: null, why: '桩：本轮未判定', replacedPaths: [], hostCredentialEnv: [],
        }),
      },
    });
    const persisted = await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8');
    await fs.rm(triviumDir, { recursive: true, force: true });
    return { rep, persisted };
  };
  try {
    const base = await run();
    process.env['TMPDIR'] = priv;
    process.env['FAKE_LOCK_HOME'] = '1';
    const { rep, persisted } = await run();
    assert.deepEqual(rep.blockers, base.rep.blockers);
    assert.deepEqual(rep.warnings, base.rep.warnings);
    assert.deepEqual(rep.probe.cli.zcode!.readonly_flags, base.rep.probe.cli.zcode!.readonly_flags);
    assert.ok(rep.probe.cli.zcode!.readonly_flags.includes('--mode plan'), '本轮旗标结论照常写入');
    assert.match(persisted, /--mode plan/, '结论照常落盘（checkpoint 没被删除失败截断）');
    // doctor 的 notes 按侧加了「[zcode] 」前缀
    const lines = rep.notes.filter((n) => n.startsWith('[zcode] ⚠️ 探针临时目录删除失败'));
    assert.equal(lines.length, 1, rep.notes.join('\n'));
    assert.match(lines[0]!, /trivium-flagprobe-.+ 仍在，其中没有 cli\/config\.json 副本/);
    assert.equal(base.rep.notes.some((n) => n.includes('临时目录删除失败')), false, '不锁时不出这一行');
  } finally {
    delete process.env['FAKE_LOCK_HOME'];
    if (saved === undefined) delete process.env['TMPDIR']; else process.env['TMPDIR'] = saved;
    await unlockUnder(priv);
    await fs.rm(priv, { recursive: true, force: true });
    await L.cleanup();
  }
});

test('旗标本轮未判定 → 出 warnings，而不是拦人', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_WEIRD_FAIL'] = '1';
  try {
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.equal(rep.warnings.length, 1, '唯一住户：本轮未判定');
    assert.match(rep.warnings[0]!, /本轮未判定/);
    assert.ok(
      !rep.blockers.some((b) => b.includes('未实测到任何可用的只读参数组合')),
      '旗标 blocker 只在判定完成时才拦——本轮没判成，拦它就是把布局/环境问题报成能力缺失',
    );
  } finally {
    delete process.env['FAKE_ZCODE_WEIRD_FAIL'];
    await L.cleanup();
  }
});

test('旗标探针退 0 → 仍记接受，但要出声（零配额前提被打破）', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_FLAG_ZERO_EXIT'] = '1';
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.equal(r.accepted.length, 7, '退 0 证明 argv 吃完了，结论照记接受');
    assert.deepEqual(r.zeroExit, r.accepted, '但七次全是靠退 0 判的——这在本探针里意味着配额被烧了');
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.ok(
      rep.warnings.some((w) => w.includes('退 0') && w.includes('零配额')),
      '成本异常要被看见：r3 给「turn 里不退」加了 killTree，「跑完并成功」此前无人说话',
    );
    assert.deepEqual(rep.blockers, [], '出声不等于拦人——结论本身是对的');
  } finally {
    delete process.env['FAKE_ZCODE_FLAG_ZERO_EXIT'];
    await L.cleanup();
  }
});

test('宿主预置两个 provider 变量 → doctor note 说明编排器独占（RUNBOOK 口径的运行时半边）', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env[ZCODE_BUILTIN_PROVIDER_ENV] = path.join(L.root, 'decoy-builtin.json');
  try {
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.ok(
      rep.notes.some((n) => n.includes('独占') && n.includes(ZCODE_BUILTIN_PROVIDER_ENV)),
      '独占口径哪天被改回「尊重宿主值」，这条要当场红——r4 §五 说「摆形态要改测试进程环境」不成立，' +
        '同文件的诱饵用例本来就在改它（r5 CODEX-05）',
    );
  } finally {
    delete process.env[ZCODE_BUILTIN_PROVIDER_ENV];
    await L.cleanup();
  }
});

test('warnings 不影响阻断判定：有告警但 blockers 为空', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_WEIRD_FAIL'] = '1';
  try {
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.ok(rep.warnings.length > 0);
    // cli.ts 的 ok 与退出码都取 `blockers.length === 0`：这条空断言就是那个档位定义。
    // 谁把告警塞进 blockers（或反过来把该拦的塞进 warnings），这里当场红。
    assert.deepEqual(rep.blockers, []);
  } finally {
    delete process.env['FAKE_ZCODE_WEIRD_FAIL'];
    await L.cleanup();
  }
});

test('version 探针：宿主预置的两个 provider 键、全部目录 / 路径键与落点开关键（EV-112 起十一个）、两个凭据键一律进不了子进程（代码双审 r1 codex 子项 06）', async () => {
  // 口径是「全部探针路径」而不是「两条主拉起路径」——P-29 已证明这个 CLI 会把 provider 定位往前挪
  const L = await layout({ withBuiltin: true, withPersonal: true });
  const log = path.join(L.root, 'calls.jsonl');
  const preset: Record<string, string> = { FAKE_ZCODE_LOG: log };
  for (const k of ALL_CLEARED_KEYS) preset[k] = `host-preset-${k}`;
  for (const [k, v] of Object.entries(preset)) process.env[k] = v;
  try {
    const r = await probeZcodeEntry(L.entry, process.execPath);
    assert.equal(r.version, '0.16.9');
    const call = JSON.parse((await fs.readFile(log, 'utf8')).trim().split('\n')[0]!) as Record<string, string | null>;
    for (const [k, field] of Object.entries(LOG_FIELD_OF)) assert.equal(call[field], null, k);
  } finally {
    for (const k of Object.keys(preset)) delete process.env[k];
    await L.cleanup();
  }
});

// ── probeZcode 接线（代码双审 r2 CODEX-04 ≡ AGY-01）：只读参数透传、null 不覆盖、global 出 ⚠️ ──

async function probeZcodeWithStubArm(armResult: ModelOverrideProbe, existingOverride: 'env' | 'config_copy' | 'global') {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  // 合成的 cli/config.json：只要「在」，探针臂就会被接线；内容不被桩臂读取
  const cliConfig = path.join(L.root, 'cli-config.json');
  await fs.writeFile(cliConfig, '{"provider":{},"model":{}}', 'utf8');
  const received: Parameters<typeof probeZcode>[2] extends infer _ ? { readonlyArgs?: readonly string[]; cliConfigPath?: string }[] : never = [];
  const existing = {
    entrypoint: L.entry, version: '0.16.9', version_probe: null, probed_at: new Date().toISOString(),
    readonly_flags: [], model_override: existingOverride,
    trace_source: null, trace_args_source: null, response_field: 'response',
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: [], coverage_complete: null, file_shape_verified: null },
    scratch_paths: [], isolation: 'home_copy' as const, model_id_form: null, models: [],
  };
  try {
    const out = await probeZcode(L.entry, process.execPath, {
      skipModelCalls: true,
      existing,
      cliConfigPath: cliConfig,
      modelOverrideProbe: async (_entry, _node, _cwd, opts) => { received.push({ ...opts }); return armResult; },
    });
    return { ...out, received };
  } finally {
    await L.cleanup();
  }
}

test('接线：probeZcode 把本轮 readonly_flags 经 readonlyArgsFromProbe 递给探针臂，并透传 cliConfigPath', async () => {
  const { probe, received } = await probeZcodeWithStubArm(
    { override: 'config_copy', requested: 'p/m', observed: 'p/m', why: '桩' }, 'env',
  );
  assert.equal(received.length, 1, '探针臂恰好被接线一次');
  // 旗标探针在假入口上实测出的 readonly_flags，经同一个派生函数得到的 argv 必须原样到达臂
  assert.deepEqual(received[0]!.readonlyArgs, readonlyArgsFromProbe(probe.readonly_flags));
  assert.ok(received[0]!.readonlyArgs!.includes('--disallowed-tools'), '完整 denylist 必须在——本地免密端点下这是唯一的护栏');
  assert.ok(received[0]!.cliConfigPath!.endsWith('cli-config.json'));
  assert.equal(probe.model_override, 'config_copy');
});

test('接线：探针臂判 null（未判定）→ 结论保留旧值、note 说明、不出 ⚠️', async () => {
  const { probe, notes } = await probeZcodeWithStubArm(
    { override: null, requested: 'p/m', observed: null, why: '桩：未判定' }, 'env',
  );
  assert.equal(probe.model_override, 'env', '未判定不得覆盖旧值');
  assert.ok(notes.some((n) => n.includes('未判定') && n.includes('桩：未判定')));
  assert.equal(notes.some((n) => n.includes('⚠️ 探针臂判 config_copy 档未生效')), false);
});

test('接线：探针臂判 global → 结论写 global 且出 ⚠️', async () => {
  const { probe, notes } = await probeZcodeWithStubArm(
    { override: 'global', requested: 'p/m', observed: 'p/first', why: '桩：回落' }, 'env',
  );
  assert.equal(probe.model_override, 'global');
  assert.ok(notes.some((n) => n.includes('⚠️ 探针臂判 config_copy 档未生效')));
});

// ── 同形第二臂的接线（EV-82 小主题第一段 r2 §3.4）：null 不覆盖、两臂不一致告警只比本轮都非 null 的值 ──

async function probeZcodeWithTwoArms(
  white: ModelOverrideProbe['override'],
  full: FullCopyOverrideProbe['override'],
  existingFullCopy?: 'config_copy' | 'global',
  runtime: {
    white?: RuntimeSelectionReadback;
    full?: RuntimeSelectionReadback;
    /** 置首支（doctor 第二次调同形臂，EV-82 第三段 r3 §3.3）的运行期读数与置首成因；缺省读数缺席 ⇒ 新事实判不出 */
    ro?: RuntimeSelectionReadback;
    roKind?: VariantOutcome['kind'];
    existingRuntimeSelection?: 'honored' | 'reorder_needed' | 'reorder_ineffective';
  } = {},
) {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const cliConfig = path.join(L.root, 'cli-config.json');
  await fs.writeFile(cliConfig, '{"provider":{},"model":{}}', 'utf8');
  const existing = {
    entrypoint: L.entry, version: '0.16.9', version_probe: null, probed_at: new Date().toISOString(),
    readonly_flags: [], model_override: 'env' as const,
    ...(existingFullCopy ? { model_override_full_copy: existingFullCopy } : {}),
    ...(runtime.existingRuntimeSelection ? { runtime_selection: runtime.existingRuntimeSelection } : {}),
    trace_source: null, trace_args_source: null, response_field: 'response',
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: [], coverage_complete: null, file_shape_verified: null },
    scratch_paths: [], isolation: 'home_copy' as const, model_id_form: null, models: [],
  };
  let fullCopyCalls = 0;
  const fullCopyOpts: Array<Record<string, unknown>> = [];
  try {
    const out = await probeZcode(L.entry, process.execPath, {
      skipModelCalls: true,
      existing,
      cliConfigPath: cliConfig,
      modelOverrideProbe: async () => ({ override: white, requested: 'p/m', observed: null, why: '桩：白名单臂', runtimeSelected: runtime.white }),
      modelOverrideFullCopyProbe: async (_entry, _node, _cwd, opts) => {
        fullCopyCalls += 1;
        fullCopyOpts.push({ ...opts });
        const base = { override: full, requested: 'p/m', observed: null, replacedPaths: ['a.apiKey'], hostCredentialEnv: [] };
        return opts?.variant === 'requested-first'
          ? { ...base, why: '桩：置首支', runtimeSelected: runtime.ro,
            variant: { variant: 'requested-first' as const, applied: (runtime.roKind ?? 'applied') === 'applied', kind: runtime.roKind ?? 'applied' } }
          : { ...base, why: '桩：同形臂', runtimeSelected: runtime.full, variant: { variant: 'as-is' as const, applied: true, kind: 'applied' as const } };
      },
    });
    return { ...out, fullCopyCalls, fullCopyOpts };
  } finally {
    await L.cleanup();
  }
}

const TWO_ARM_WARN = '两条探针臂在配置读取层结论不一致';

test('同形臂接线：与白名单臂同一门控；原样支一次、置首支一次（显式传 variant）；结论写进 model_override_full_copy', async () => {
  const { probe, notes, fullCopyCalls, fullCopyOpts } = await probeZcodeWithTwoArms('config_copy', 'config_copy');
  assert.equal(fullCopyCalls, 2, 'EV-82 第三段 r3 §3.3：doctor 拉起原样支与置首支两次');
  assert.equal(fullCopyOpts[0]!['variant'], undefined, '第一次是原样支（缺省）');
  assert.equal(fullCopyOpts[1]!['variant'], 'requested-first', '第二次必须显式传置首——缺省翻回原样会把正常形态误判成 reorder_ineffective');
  assert.equal(probe.model_override_full_copy, 'config_copy');
  assert.ok(notes.some((n) => n.includes('model_override_full_copy=config_copy') && n.includes('配置层结论只判配置读取层')));
  assert.equal(notes.some((n) => n.includes(TWO_ARM_WARN)), false, '两臂一致不告警');
});

test('同形臂接线：两臂本轮都非 null 且不同 ⇒ 出 EV-94 ② 不一致告警', async () => {
  const { notes } = await probeZcodeWithTwoArms('config_copy', 'global');
  assert.ok(notes.some((n) => n.includes(TWO_ARM_WARN)));
});

test('同形臂接线：本轮判不出 ⇒ 保留上一轮的值，且不拿旧值去比、不出不一致告警（CODEX-06）', async () => {
  const { probe, notes } = await probeZcodeWithTwoArms('config_copy', null, 'global');
  assert.equal(probe.model_override_full_copy, 'global', '未判定不得覆盖旧值');
  assert.ok(notes.some((n) => n.includes('model_override_full_copy=未判定')));
  assert.equal(notes.some((n) => n.includes(TWO_ARM_WARN)), false, '旧值 global 与本轮白名单 config_copy 不同，也不得告警');
});

// ── 运行期读数进 note（EV-82 第二段 r2 §3）──

const RUNTIME_WARN = '配置读取层写出了请求值';

test('运行期接线：两臂 note 各带运行期读数；配置层 config_copy 而运行期选了别的 ⇒ 按臂出 ⚠️', async () => {
  const { notes } = await probeZcodeWithTwoArms('config_copy', 'config_copy', undefined, {
    white: { cause: 'ok', model: 'p/first' },
    full: { cause: 'no_event', model: null },
  });
  assert.ok(notes.some((n) => n.startsWith('model_override=') && n.includes('运行期选定 p/first')));
  assert.ok(notes.some((n) => n.startsWith('model_override_full_copy=') && n.includes('运行期选定读不到：日志里没有启动事件')));
  assert.ok(notes.some((n) => n.includes('⚠️ 白名单臂') && n.includes(RUNTIME_WARN) && n.includes('p/first')));
  assert.equal(notes.some((n) => n.includes('⚠️ 同形臂') && n.includes(RUNTIME_WARN)), false, '读不到不算不一致');
});

test('运行期接线：运行期与请求 modelId 段一致、或配置层不是 config_copy ⇒ 不出运行期 ⚠️', async () => {
  const same = await probeZcodeWithTwoArms('config_copy', 'config_copy', undefined, {
    white: { cause: 'ok', model: 'other-provider/m' },
    full: { cause: 'ok', model: 'p/m' },
  });
  assert.equal(same.notes.some((n) => n.includes(RUNTIME_WARN)), false, '只比 modelId 段，与配置层判据同口径');
  const glob = await probeZcodeWithTwoArms('global', 'global', undefined, {
    white: { cause: 'ok', model: 'p/first' },
    full: { cause: 'ok', model: 'p/first' },
  });
  assert.equal(glob.notes.some((n) => n.includes(RUNTIME_WARN)), false, '配置层已判 global，已有 ⚠️，不叠加');
});

test('运行期接线：桩不给 runtimeSelected ⇒ note 写「未采集」', async () => {
  const { notes } = await probeZcodeWithTwoArms('config_copy', 'config_copy');
  assert.ok(notes.some((n) => n.startsWith('model_override=') && n.includes('运行期选定：未采集')));
});

test('运行期接线：config_copy 且启动阶段选定为空（no_model_field）⇒ 单列 ⚠️（代码双审 r1 CODEX-03）', async () => {
  const { notes } = await probeZcodeWithTwoArms('config_copy', 'config_copy', undefined, {
    white: { cause: 'no_model_field', model: null },
    full: { cause: 'no_log_dir', model: null },
  });
  assert.ok(notes.some((n) => n.includes('⚠️ 白名单臂') && n.includes('启动阶段选定为空')));
  assert.equal(notes.some((n) => n.includes('⚠️ 同形臂') && n.includes(RUNTIME_WARN)), false, '其余读不到的成因不算不一致');
});

test('运行期接线：配置层未判定（null）而运行期 ok≠请求 ⇒ 不叠加 ⚠️，但 note 带读数（代码双审 r1 GLM-02）', async () => {
  const { notes } = await probeZcodeWithTwoArms(null, null, undefined, {
    white: { cause: 'ok', model: 'p/first' },
    full: { cause: 'no_model_field', model: null },
  });
  assert.equal(notes.some((n) => n.includes(RUNTIME_WARN)), false);
  assert.ok(notes.some((n) => n.startsWith('model_override=') && n.includes('运行期选定 p/first')));
});

test('U7 宿主预置十一键中的任一个 ⇒ doctor 出信息级 note（EV-110 / EV-112），只报键名不报值、不再说「持久留存」；都不预置不出', async () => {
  const WARN = '所有拉起路径都已清掉它们';
  const saved = Object.fromEntries(Object.keys(ELEVEN_CLEARED).map((k) => [k, process.env[k]]));
  try {
    for (const k of Object.keys(ELEVEN_CLEARED)) delete process.env[k];
    // 逐个单独预置：note 的触发条件漏了哪个键，那一格当场红（变异 M8）
    for (const k of Object.keys(ELEVEN_CLEARED)) {
      process.env[k] = `host-value-of-${k}`;
      const on = await probeZcodeWithTwoArms('config_copy', 'config_copy');
      const hit = on.notes.filter((n) => n.includes(WARN));
      assert.equal(hit.length, 1, k);
      assert.ok(hit[0]!.includes(k), `${k}：note 要点名预置的键`);
      assert.equal(hit[0]!.startsWith('⚠️'), false, '所有路径都清之后不再是告警');
      assert.equal(hit[0]!.includes('host-value-of-'), false, '不打印值');
      assert.equal(hit[0]!.includes('持久留存'), false, 'EV-112 之后那句不再成立');
      delete process.env[k];
    }
    const off = await probeZcodeWithTwoArms('config_copy', 'config_copy');
    assert.equal(off.notes.some((n) => n.includes(WARN)), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('U7 探针入口命中 beta 改写的 argv 判据 ⇒ doctor 出信息级 note，只报命中、不报路径全文；不命中不出', async () => {
  const BETA = 'ZCode 入口在 beta 渠道路径下';
  const L = await layout({ withBuiltin: true, withPersonal: false });
  // 同一份假入口，放到 zcode-beta.app 下（与 ZCODE_BETA_ARGV_RE 同形：该段后紧跟「.」）
  const betaEntry = path.join(L.root, 'zcode-beta.app', 'Resources', 'glm', 'zcode.cjs');
  await fs.mkdir(path.dirname(betaEntry), { recursive: true });
  await fs.copyFile(L.entry, betaEntry);
  // cliConfigPath 指向不存在的文件：探针臂不接线，也不读真实 ~/.zcode/cli/config.json
  const noCli = path.join(L.root, 'no-cli-config.json');
  try {
    const hit = await probeZcode(betaEntry, process.execPath, { skipModelCalls: true, cliConfigPath: noCli });
    const notes = hit.notes.filter((n) => n.includes(BETA));
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.includes(L.root), false, '不报路径全文');
    const miss = await probeZcode(L.entry, process.execPath, { skipModelCalls: true, cliConfigPath: noCli });
    assert.equal(miss.notes.some((n) => n.includes(BETA)), false);
  } finally {
    await L.cleanup();
  }
});

// ── 新事实 zcode.runtime_selection 的接线（EV-82 第三段 r3 §4.2）──

test('runtime_selection 接线：原样支回落、置首支选中 ⇒ reorder_needed 写进结论，运行期 ⚠️ 由它那条 note 合并说明', async () => {
  const { probe, notes } = await probeZcodeWithTwoArms('config_copy', 'config_copy', undefined, {
    white: { cause: 'ok', model: 'p/first' },
    full: { cause: 'ok', model: 'p/first' },
    ro: { cause: 'ok', model: 'p/m' },
  });
  assert.equal(probe.runtime_selection, 'reorder_needed');
  assert.ok(notes.some((n) => n.startsWith('runtime_selection=reorder_needed')));
  assert.equal(notes.some((n) => n.includes(RUNTIME_WARN)), false, '判出值时不重复出运行期 ⚠️');
});

test('runtime_selection 接线：两支都没选中 ⇒ reorder_ineffective，note 带 ⚠️', async () => {
  const { probe, notes } = await probeZcodeWithTwoArms('config_copy', 'config_copy', undefined, {
    full: { cause: 'ok', model: 'p/first' },
    ro: { cause: 'ok', model: 'p/first' },
  });
  assert.equal(probe.runtime_selection, 'reorder_ineffective');
  assert.ok(notes.some((n) => n.startsWith('⚠️ runtime_selection=reorder_ineffective')));
});

test('runtime_selection 接线：判不出（置首支恒等）⇒ 不覆盖旧值，note 说明保留，运行期 ⚠️ 照旧', async () => {
  const { probe, notes } = await probeZcodeWithTwoArms('config_copy', 'config_copy', undefined, {
    full: { cause: 'ok', model: 'p/first' },
    ro: { cause: 'ok', model: 'p/m' },
    roKind: 'identity',
    existingRuntimeSelection: 'reorder_needed',
  });
  assert.equal(probe.runtime_selection, 'reorder_needed', '判不出不得覆盖旧值');
  assert.ok(notes.some((n) => n.startsWith('runtime_selection=未判定') && n.includes('"reorder_needed"') && n.includes('identity')));
  assert.ok(notes.some((n) => n.includes('⚠️ 同形臂') && n.includes(RUNTIME_WARN)), '判不出时运行期 ⚠️ 照旧出');
});

}
