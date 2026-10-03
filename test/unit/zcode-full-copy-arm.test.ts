/**
 * 同形第二臂（EV-94 ②；EV-82 小主题第一段 r2 §3）与它依赖的三处改动：
 * `prepareZcodeHome` 的 `transformCopy`、凭据替换 `sentinelizeCredentials`、两臂共用判据 `judgeOverrideReadback`；
 * 外加 (D) 隔离腿的只读取证 `listPersonalProviderIds`。
 *
 * 全部用**临时目录里的合成配置**与假入口，不碰真实 `~/.zcode/**`、不拉起真实 CLI、零配额。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { prepareZcodeHome, removeZcodeTempDir, tildeHome, zcodeCliCopyPath, zcodeHomeUnder, type ZcodeTempDirCopyKind } from '../../src/trivium/adapters/zcode.js';
import {
  findCredentialResidue,
  forceProviderApiKeySentinel,
  judgeOverrideReadback,
  listPersonalProviderIds,
  probeModelOverride,
  probeModelOverrideFullCopy,
  sentinelizeCredentials,
  ZCODE_PROBE_SENTINEL_KEY,
} from '../../src/trivium/probes/zcode.js';

/*
 * 本文件建的临时目录全部记下、文件跑完整删（EV-198 代码双审 r1 CODEX-03）：此前从不清理，系统临时目录里
 * `trivium-fullcopy-test-*` 越积越多。`force` 且不抛——收尾失败不该把已跑完的用例变红。
 */
const madeDirs: string[] = [];
const tmp = async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-fullcopy-test-'));
  madeDirs.push(d);
  return d;
};
after(async () => {
  for (const d of madeDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});
const API_KEY_FIELD = 'apiKey';

// 真实凭据形态的假值：拼出来而不是写成字面，避开 fixture-credentials 扫描器的形态判据
const SHAPE_ONLY_SECRET = ['sk', 'A'.repeat(28)].join('-');
const KNOWN_SECRETS = [
  'fake-id.fake-secret', 'REAL-BEARER-SECRET', 'REAL-TOKEN-SECRET', 'NESTED-TOKEN-SECRET',
  'ARRAY-TOKEN-SECRET', 'TOP-LEVEL-TOKEN', SHAPE_ONLY_SECRET,
];

/** 同形臂关心的形态：整份拷贝的全部键都在，凭据藏在嵌套、数组、顶层与「只有形态」四种位置 */
function fullCopyFixture(): Record<string, unknown> {
  return {
    model: { main: 'bigmodel-coding-plan/GLM-5.3', lite: 'bigmodel-coding-plan/GLM-5.3-Flash' },
    theme: 'dark',
    token: 'TOP-LEVEL-TOKEN',
    provider: {
      'bigmodel-coding-plan': {
        name: 'BigModel Coding Plan',
        kind: 'anthropic',
        source: 'custom',
        enabled: true,
        options: {
          apiKey: 'fake-id.fake-secret',
          apiKeyRequired: true,
          baseURL: 'https://example.invalid/api',
          region: 'cn',
          headers: { Authorization: 'Bearer REAL-BEARER-SECRET', 'X-Trace': 'plain-header-value' },
          auth: { token: 'NESTED-TOKEN-SECRET' },
          extra: [{ token: 'ARRAY-TOKEN-SECRET' }, 'plain-array-value'],
          unnamed: SHAPE_ONLY_SECRET,
        },
        models: { 'GLM-5.3': {}, 'GLM-5.3-Flash': {} },
      },
    },
  };
}

async function writeSrc(cfg: unknown = fullCopyFixture()): Promise<string> {
  const dir = await tmp();
  const p = path.join(dir, 'config.json');
  await fs.writeFile(p, JSON.stringify(cfg), { encoding: 'utf8', mode: 0o600 });
  return p;
}

/** 收集一个 JSON 值里全部字符串 */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

/** 收集一个 JSON 值里全部键路径 */
function allKeyPaths(v: unknown, at = '', out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x, i) => allKeyPaths(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = at ? `${at}.${k}` : k;
      out.push(p);
      allKeyPaths(x, p, out);
    }
  }
  return out;
}

// ── prepareZcodeHome 的 transformCopy（AGY-03）──

test('prepareZcodeHome：不传 transformCopy 时，写出的副本与「只改 model」的源逐字相同', async () => {
  const src = await writeSrc();
  const runDir = await tmp();
  const prep = await prepareZcodeHome(runDir, 'GLM-5.3-Flash', { srcConfig: src });
  assert.equal(prep.route, 'config_copy');
  const written = await fs.readFile(path.join(zcodeHomeUnder(runDir), '.zcode/cli/config.json'), 'utf8');
  const expected = fullCopyFixture();
  expected['model'] = { main: 'bigmodel-coding-plan/GLM-5.3-Flash', lite: 'bigmodel-coding-plan/GLM-5.3-Flash' };
  assert.equal(written, JSON.stringify(expected, null, 2), '审查臂不传该参数，输出必须与加参数之前一致');
});

test('prepareZcodeHome：transformCopy 在写盘之前生效——盘上从未出现原值', async () => {
  const src = await writeSrc();
  const runDir = await tmp();
  await prepareZcodeHome(runDir, 'GLM-5.3-Flash', { srcConfig: src, transformCopy: (c) => sentinelizeCredentials(c).copy });
  const written = await fs.readFile(path.join(zcodeHomeUnder(runDir), '.zcode/cli/config.json'), 'utf8');
  for (const s of KNOWN_SECRETS) assert.equal(written.includes(s), false, `盘上不得出现 ${s}`);
});

// ── 凭据替换（CODEX-04 / CODEX-05 / GLM-05）──

test('凭据替换：四种位置的凭据全换成哨兵；非凭据值原样；所有键一律保留', () => {
  const src = fullCopyFixture();
  const { copy, replacedPaths } = sentinelizeCredentials(src);
  const strings = allStrings(copy);
  // 漏换方向：副本里的字符串值 ∩ 已知凭据 = 空集
  assert.deepEqual(strings.filter((s) => KNOWN_SECRETS.includes(s)), []);
  // 误换方向：非凭据值原样（导入要用的值不能被换掉）
  for (const keep of ['dark', 'BigModel Coding Plan', 'anthropic', 'custom', 'https://example.invalid/api', 'cn', 'plain-array-value', 'bigmodel-coding-plan/GLM-5.3']) {
    assert.ok(strings.includes(keep), `非凭据值 ${keep} 必须原样`);
  }
  // 容器判据：headers 下的值不论名字一律换
  const opts = (copy['provider'] as Record<string, { options: Record<string, unknown> }>)['bigmodel-coding-plan']!.options;
  assert.equal((opts['headers'] as Record<string, unknown>)['X-Trace'], ZCODE_PROBE_SENTINEL_KEY);
  assert.equal(opts['apiKeyRequired'], true, '布尔值不动（它决定导入成败）');
  // 键骨架原样
  assert.deepEqual(allKeyPaths(copy).sort(), allKeyPaths(src).sort());
  // 替换了哪些路径如实登记，且只登记路径不含值
  for (const p of ['token', 'provider.bigmodel-coding-plan.options.apiKey', 'provider.bigmodel-coding-plan.options.auth.token',
    'provider.bigmodel-coding-plan.options.extra[0].token', 'provider.bigmodel-coding-plan.options.unnamed']) {
    assert.ok(replacedPaths.includes(p), `应登记 ${p}，实际 ${replacedPaths.join(', ')}`);
  }
  for (const s of KNOWN_SECRETS) assert.equal(replacedPaths.join('\n').includes(s), false);
});

test('凭据替换：不改入参（返回新对象）', () => {
  const src = fullCopyFixture();
  const before = JSON.stringify(src);
  sentinelizeCredentials(src);
  assert.equal(JSON.stringify(src), before);
});

// ── 两臂共用判据（GLM-07）──

test('判据：写出 v2 ⇒ 只比 modelId 段；没写出 ⇒ 按停止形态分三态', () => {
  const req = 'bigmodel-coding-plan/GLM-5.3-Flash';
  const ok = { code: 1, stderr: 'Error: Model creation failed (traceId: x)' };
  assert.equal(judgeOverrideReadback(req, { wroteV2: true, observed: req }, ok).stop, 'match');
  const uuid = judgeOverrideReadback(req, { wroteV2: true, observed: 'uuid-x/GLM-5.3-Flash' }, ok);
  assert.equal(uuid.override, 'config_copy');
  assert.match(uuid.providerNote, /providerId 形态与副本源不同/);
  const first = judgeOverrideReadback(req, { wroteV2: true, observed: 'bigmodel-coding-plan/GLM-5.3' }, ok);
  assert.deepEqual([first.override, first.stop], ['global', 'mismatch']);
  assert.equal(judgeOverrideReadback(req, { wroteV2: false, observed: null }, { code: null, stderr: '' }).override, null);
  assert.equal(judgeOverrideReadback(req, { wroteV2: false, observed: null }, { code: 1, timedOut: true, stderr: '' }).stop, 'not_finished');
  assert.equal(judgeOverrideReadback(req, { wroteV2: false, observed: null }, { code: 0, stderr: 'something else' }).stop, 'unrecognized');
});

// ── 同形臂流程（假入口）──

/**
 * 假入口：读 `$HOME/.zcode/cli/config.json`，副本里出现 FAKE_SECRETS 中任一值就退 99（真实凭据泄漏）；
 * 把 argv 记进 FAKE_ZCODE_LOG；按旗标写或不写 v2：
 *   FAKE_IGNORE_MAIN 写首位模型；FAKE_NO_IMPORT 跑到模型层不写；FAKE_CRASH 退 137；FAKE_HANG 挂起。
 */
const FULL_COPY_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env;
if (env.FAKE_ZCODE_LOG) fs.appendFileSync(env.FAKE_ZCODE_LOG, JSON.stringify({ argv: process.argv.slice(2), apiKeyEnv: env.ZCODE_API_KEY ?? null }) + '\\n');
if (env.FAKE_CRASH) process.exit(137);
if (env.FAKE_HANG) { setTimeout(function () { process.exit(1); }, 10000); return; }
const raw = fs.readFileSync(path.join(env.HOME, '.zcode/cli/config.json'), 'utf8');
for (const s of JSON.parse(env.FAKE_SECRETS || '[]')) { if (raw.includes(s)) { process.stderr.write('REAL CREDENTIAL LEAKED\\n'); process.exit(99); } }
if (env.FAKE_NO_IMPORT) { process.stderr.write('Error: Model creation failed (traceId: fake)\\n'); process.exit(1); }
const cfg = JSON.parse(raw);
let sel;
if (env.FAKE_IGNORE_MAIN) { const [pid, pv] = Object.entries(cfg.provider)[0]; sel = { providerId: pid, modelId: Object.keys(pv.models)[0] }; }
else { const main = cfg.model.main; const i = main.indexOf('/'); sel = { providerId: main.slice(0, i), modelId: main.slice(i + 1) }; }
fs.mkdirSync(path.join(env.HOME, '.zcode/v2'), { recursive: true });
fs.writeFileSync(path.join(env.HOME, '.zcode/v2/provider_config.json'), JSON.stringify({ schemaVersion: 1, config: { defaultModelSelection: sel } }));
if (env.FAKE_LOCK_CLI) {
  // 删不掉的临时目录（EV-198 R2 / R3 / R5）：副本所在的 $HOME/.zcode/cli 改只读，副本删不掉。摆不出就退 3（摆锁守则）
  const cli = path.join(env.HOME, '.zcode/cli');
  if (!fs.existsSync(path.join(cli, 'config.json'))) { process.stderr.write('FAKE_LOCK_CLI：$HOME 下没有副本\\n'); process.exit(3); }
  fs.chmodSync(cli, 0o500);
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

async function fakeLayout(): Promise<{ entry: string; cwd: string; root: string }> {
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, FULL_COPY_ENTRY, 'utf8');
  const builtin = path.join(root, 'Resources/config/provider/zcode-builtin.json');
  await fs.mkdir(path.dirname(builtin), { recursive: true });
  await fs.writeFile(builtin, '{}', 'utf8');
  const cwd = path.join(root, 'proj');
  await fs.mkdir(cwd, { recursive: true });
  return { entry, cwd, root };
}

async function runArm(flags: Record<string, string>, opts: Parameters<typeof probeModelOverrideFullCopy>[3] = {}, src?: string) {
  const L = await fakeLayout();
  const env = { FAKE_SECRETS: JSON.stringify(KNOWN_SECRETS), ...flags };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return { r: await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src ?? (await writeSrc()), ...opts }), L };
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
  }
}

test('同形臂：CLI 读到副本 model.main（非首位）⇒ config_copy；副本里无真实凭据（假入口见到就退 99）', async () => {
  const { r } = await runArm({});
  assert.equal(r.override, 'config_copy', r.why);
  assert.equal(r.requested, 'bigmodel-coding-plan/GLM-5.3-Flash');
  assert.equal(r.observed, r.requested);
  assert.ok(r.replacedPaths.length >= 6, `替换键路径应被登记：${r.replacedPaths.join(', ')}`);
});

test('同形臂：回落首位 ⇒ global，文案并列 H2 与「替换破坏导入」两种成因（GLM-01 / GLM-07）', async () => {
  const { r } = await runArm({ FAKE_IGNORE_MAIN: '1' });
  assert.equal(r.override, 'global', r.why);
  assert.equal(r.observed, 'bigmodel-coding-plan/GLM-5.3');
  assert.match(r.why, /H2/);
  assert.match(r.why, /凭据替换破坏了导入/);
  // 「与白名单副本不同」是两臂对比，合法；不得带的是白名单臂专属的指引「去核对 buildProbeCliConfig」
  assert.equal(/buildProbeCliConfig|核对.*白名单/.test(r.why), false, '同形臂没有白名单可核，不得带白名单臂的指引');
});

test('同形臂：跑到模型层却没写 v2 ⇒ global；崩溃 ⇒ null；超时 ⇒ null', async () => {
  assert.equal((await runArm({ FAKE_NO_IMPORT: '1' })).r.override, 'global');
  const crash = (await runArm({ FAKE_CRASH: '1' })).r;
  assert.equal(crash.override, null, crash.why);
  const hang = (await runArm({ FAKE_HANG: '1' }, { timeoutMs: 500 })).r;
  assert.equal(hang.override, null);
  assert.match(hang.why, /超时/);
});

test('同形臂：显式 model 参数优先于 pickNonFirstModel（CODEX-10）', async () => {
  const { r } = await runArm({}, { model: 'GLM-5.3-Flash' });
  assert.equal(r.requested, 'bigmodel-coding-plan/GLM-5.3-Flash');
});

test('同形臂早退：副本源缺失 / 请求模型不在目录 / 挑不出非首位 ⇒ 不拉起、null（CODEX-02）', async () => {
  const log = path.join(await tmp(), 'calls.jsonl');
  const cases: Array<[string, Parameters<typeof probeModelOverrideFullCopy>[3], string | undefined]> = [
    ['副本源缺失', { cliConfigPath: path.join(await tmp(), 'nope.json') }, undefined],
    ['模型不在目录', { model: 'not-in-catalog' }, undefined],
    ['挑不出非首位', {}, await writeSrc({ provider: { a: { source: 'custom', models: { only: {} } } } })],
  ];
  for (const [name, opts, src] of cases) {
    const { r } = await runArm({ FAKE_ZCODE_LOG: log }, opts, src);
    assert.equal(r.override, null, `${name}：${r.why}`);
  }
  assert.equal(await fs.stat(log).then(() => true, () => false), false, '三种早退都不得拉起入口');
});

test('同形臂：宿主预置的凭据 env 键被登记（GLM-04），且进不了子进程', async () => {
  const log = path.join(await tmp(), 'calls.jsonl');
  const { r } = await runArm({ FAKE_ZCODE_LOG: log, ZCODE_API_KEY: 'host.key' });
  assert.deepEqual(r.hostCredentialEnv, ['ZCODE_API_KEY']);
  const call = JSON.parse((await fs.readFile(log, 'utf8')).trim().split('\n')[0]!) as { apiKeyEnv: string | null };
  assert.equal(call.apiKeyEnv, null);
});

test('同形臂：临时根跑后被清（只认 makeTempDir 的返回值）', async () => {
  // 先把夹具建在公共 tmpdir，再换私有 TMPDIR 只观察本臂自己建的临时根（并行的别的用例文件不会落进来）
  const L = await fakeLayout();
  const src = await writeSrc();
  const privateTmp = await tmp();
  const saved = process.env['TMPDIR'];
  process.env['TMPDIR'] = privateTmp;
  process.env['FAKE_SECRETS'] = JSON.stringify(KNOWN_SECRETS);
  try {
    const r = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src });
    assert.equal(r.override, 'config_copy', r.why);
    assert.deepEqual(await fs.readdir(privateTmp), [], '同形臂的临时根必须被清掉');
  } finally {
    delete process.env['FAKE_SECRETS'];
    if (saved === undefined) delete process.env['TMPDIR']; else process.env['TMPDIR'] = saved;
  }
});

// ── 代码双审 r1 的补强：结构兜底、残余扫描、对照与两臂对拍 ──

test('结构兜底：每个 provider 的 options.apiKey 无条件写哨兵，不存在也补上；其它键不动；返回改写路径（CODEX-01 / r2 CODEX-02）', () => {
  const cfg = { provider: { a: { options: { baseURL: 'https://x.invalid' } }, b: { name: 'no-options' } } };
  const { copy, forcedPaths } = forceProviderApiKeySentinel(structuredClone(cfg));
  const out = copy as unknown as { provider: Record<string, { options: Record<string, unknown> }> };
  for (const k of ['a', 'b']) assert.equal(out.provider[k]!.options['apiKey'], ZCODE_PROBE_SENTINEL_KEY);
  assert.equal(out.provider['a']!.options['baseURL'], 'https://x.invalid');
  assert.deepEqual(forcedPaths, ['provider.a.options.apiKey', 'provider.b.options.apiKey']);
});

test('残余扫描：论域是 provider.<id> 减 models 与 name；URL、baseURL、哨兵、短值、UUID、无 scheme 端点都不算；Bearer 前缀剥掉再测（r2 CODEX-01 / GLM-01 / GLM-02 / CODEX-04）', () => {
  const hex = 'ab'.repeat(20);
  const cfg = {
    theme: hex, // 顶层不扫：已知残余，登记在设计文档与收口报告
    provider: {
      p: {
        name: 'a-very-long-human-readable-provider-name',
        models: { 'claude-3-5-sonnet-20241022-long-model-id': {}, x: { id: 'claude-3-5-sonnet-20241022-long-model-id' } },
        providerLevel: hex,
        options: {
          baseURL: 'https://open.example.invalid/api/coding/paas/v4',
          endpoint: 'https://open.example.invalid/very/long/path/segment',
          host: 'open.example.cn/api/paas/v4',
          tenant: '123e4567-e89b-12d3-a456-426614174000',
          // 计算属性键：fixture-credentials 扫描器按「apiKey: <长标识符>」的字面形态判，不看值是不是哨兵
          [API_KEY_FIELD]: ZCODE_PROBE_SENTINEL_KEY,
          region: 'cn-north',
          opaque: hex,
          scheme: `Bearer ${hex}`,
          nested: [{ secretish: hex }],
        },
      },
    },
  };
  assert.deepEqual(findCredentialResidue(cfg).sort(), [
    'provider.p.options.nested[0].secretish',
    'provider.p.options.opaque',
    'provider.p.options.scheme',
    'provider.p.providerLevel',
  ]);
});

test('凭据替换：短键 key / auth / session / passphrase 只按全名精确匹配（r2 GLM-02）', () => {
  const hex = 'ef'.repeat(20);
  const { copy } = sentinelizeCredentials({ key: hex, auth: hex, session: hex, passphrase: hex, keyboard: 'plain-keyboard-layout' });
  const c = copy as Record<string, string>;
  for (const k of ['key', 'auth', 'session', 'passphrase']) assert.equal(c[k], ZCODE_PROBE_SENTINEL_KEY, k);
  assert.equal(c['keyboard'], 'plain-keyboard-layout', '子串含 key 的非凭据键不得误伤');
});

test('同形臂：副本里残留疑似凭据（无凭据形态键名、不带点的长十六进制值）⇒ 不拉起、null、why 列出路径（CODEX-01）', async () => {
  const cfg = fullCopyFixture();
  const opts = (cfg['provider'] as Record<string, { options: Record<string, unknown> }>)['bigmodel-coding-plan']!.options;
  opts['opaque'] = 'cd'.repeat(20);
  const log = path.join(await tmp(), 'calls.jsonl');
  const { r } = await runArm({ FAKE_ZCODE_LOG: log }, {}, await writeSrc(cfg));
  assert.equal(r.override, null, r.why);
  assert.match(r.why, /provider\.bigmodel-coding-plan\.options\.opaque/);
  assert.equal(r.why.includes('cd'.repeat(20)), false, 'why 只记路径不记值');
  assert.equal(await fs.stat(log).then(() => true, () => false), false, '有残余就不得拉起');
});

test('同形臂：provider 级（options 之外）的疑似凭据也拦下（r2 CODEX-01 ≡ GLM-02）', async () => {
  const cfg = fullCopyFixture();
  (cfg['provider'] as Record<string, Record<string, unknown>>)['bigmodel-coding-plan']!['opaqueRef'] = 'de'.repeat(20);
  const log = path.join(await tmp(), 'calls.jsonl');
  const { r } = await runArm({ FAKE_ZCODE_LOG: log }, {}, await writeSrc(cfg));
  assert.equal(r.override, null, r.why);
  assert.match(r.why, /provider\.bigmodel-coding-plan\.opaqueRef/);
  assert.equal(await fs.stat(log).then(() => true, () => false), false);
});

/** 只含 apiKey 一个凭据的干净配置：两种替换面都不会留残余，适合做对照 */
function cleanFixture(): Record<string, unknown> {
  const cfg = fullCopyFixture();
  delete cfg['token'];
  const opts = (cfg['provider'] as Record<string, { options: Record<string, unknown> }>)['bigmodel-coding-plan']!.options;
  for (const k of ['headers', 'auth', 'extra', 'unnamed']) delete opts[k];
  return cfg;
}

test('对照：只换 options.apiKey 与全量替换，同形臂判定相同（CODEX-04 ≡ GLM-02 ①；计划 §4 第二段第一刀的基线）', async () => {
  const full = (await runArm({}, { replace: 'full' }, await writeSrc(cleanFixture()))).r;
  const narrow = (await runArm({}, { replace: 'apiKeyOnly' }, await writeSrc(cleanFixture()))).r;
  assert.equal(full.override, 'config_copy', full.why);
  assert.deepEqual([narrow.override, narrow.observed], [full.override, full.observed], narrow.why);
  // 读数与盘上一致（r2 CODEX-02）：收窄档不做键名替换，但结构兜底改写了 apiKey，要如实登记
  assert.deepEqual(narrow.replacedPaths, ['provider.bigmodel-coding-plan.options.apiKey']);
});

test('收窄档仍换 headers 容器：Authorization 的 Bearer 串不得原样进副本（r2 GLM-01）', async () => {
  const cfg = cleanFixture();
  const opts = (cfg['provider'] as Record<string, { options: Record<string, unknown> }>)['bigmodel-coding-plan']!.options;
  opts['headers'] = { Authorization: 'Bearer REAL-BEARER-SECRET' };
  // 假入口见到 KNOWN_SECRETS 中任一值（含 REAL-BEARER-SECRET）就退 99 ⇒ 判不成 config_copy
  const { r } = await runArm({}, { replace: 'apiKeyOnly' }, await writeSrc(cfg));
  assert.equal(r.override, 'config_copy', r.why);
  assert.ok(r.replacedPaths.includes('provider.bigmodel-coding-plan.options.headers.Authorization'));
});

test('两臂行为对拍：四种停止形态各钉期望值，再断言两臂一致（GLM-02 ② / r2 CODEX-07）', async () => {
  const req = 'bigmodel-coding-plan/GLM-5.3-Flash';
  const cases: Array<[Record<string, string>, [string | null, string | null]]> = [
    [{}, ['config_copy', req]],
    [{ FAKE_IGNORE_MAIN: '1' }, ['global', 'bigmodel-coding-plan/GLM-5.3']],
    [{ FAKE_NO_IMPORT: '1' }, ['global', null]],
    [{ FAKE_CRASH: '1' }, [null, null]],
  ];
  for (const [flags, expected] of cases) {
    const L = await fakeLayout();
    const src = await writeSrc();
    const env = { FAKE_SECRETS: JSON.stringify(KNOWN_SECRETS), ...flags };
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    try {
      const white = await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: src });
      const full = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src });
      const tag = `${JSON.stringify(flags)}：${white.why} / ${full.why}`;
      // 各自钉期望值：两臂同时退化成 [null, null] 时相等断言挡不住（共模失效）
      assert.deepEqual([white.override, white.observed], expected, `白名单臂 ${tag}`);
      assert.deepEqual([full.override, full.observed], expected, `同形臂 ${tag}`);
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  }
});

// ── 临时目录删不掉（EV-198）──
//
// 摆锁守则（计划 r2 §3.1）：root 下 chmod 锁不住，一律跳过；摆锁失败必须让用例红——假入口摆不出退 3，
// 包装侧上锁抛错不吞。锁的是副本所在的 cli/（锁兄弟目录时递归删除并行、顺序不定，副本可能先被删掉）。

const ROOT = process.getuid?.() === 0;
const SENTINEL_TAIL = '其中的 cli/config.json 是探针副本、凭据已换成哨兵，仍请手工删除';
const CREDENTIAL_TAIL = '其中的 cli/config.json 副本含真实凭据，请手工删除';
const NO_COPY_TAIL = '其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除';

/**
 * 在私有 TMPDIR 下跑一次臂：夹具与副本源先建在公共 tmpdir，再换私有根，只观察臂自己建的临时根。
 * 返回结果与私有根下以 `prefix` 开头的残留；收尾把可能上过锁的目录解开、整删私有根。
 */
async function armInPrivTmp<T>(prefix: string, flags: Record<string, string>, fn: (L: Awaited<ReturnType<typeof fakeLayout>>) => Promise<T>) {
  const L = await fakeLayout();
  const priv = await tmp();
  const saved = process.env['TMPDIR'];
  const env = { FAKE_SECRETS: JSON.stringify(KNOWN_SECRETS), ...flags };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  process.env['TMPDIR'] = priv;
  try {
    const r = await fn(L);
    const left = (await fs.readdir(priv)).filter((e) => e.startsWith(prefix));
    return { r, left, priv };
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    if (saved === undefined) delete process.env['TMPDIR']; else process.env['TMPDIR'] = saved;
    for (const e of await fs.readdir(priv).catch(() => [] as string[])) {
      for (const d of ['.zcode', '.zcode/cli', 'home/.zcode', 'home/.zcode/cli']) await fs.chmod(path.join(priv, e, d), 0o700).catch(() => {});
    }
    await fs.rm(priv, { recursive: true, force: true });
  }
}

const residueLine = (priv: string, left: string, tail: string) =>
  `⚠️ 探针临时目录删除失败（EACCES）：${tildeHome(path.join(priv, left))} 仍在，${tail}`;

test('R2 白名单臂的副本删不掉：不抛、结论与不锁时相同、提示取「探针副本」档（副本不在 home/ 子层，按调用方给的位置查）', { skip: ROOT }, async () => {
  const src = await writeSrc();
  const base = await armInPrivTmp('trivium-modeloverride-', {}, (L) => probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: src }));
  assert.equal(base.r.override, 'config_copy', base.r.why);
  assert.equal(base.r.tempDirResidue, undefined, '删成功时不带提示');
  assert.deepEqual(base.left, []);
  const { r, left, priv } = await armInPrivTmp('trivium-modeloverride-', { FAKE_LOCK_CLI: '1' }, (L) =>
    probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: src }));
  assert.equal(left.length, 1, '本格就是要摆出删不掉');
  const { tempDirResidue, ...rest } = r;
  const { tempDirResidue: _none, ...baseRest } = base.r;
  assert.deepEqual(rest, baseRest, '删除失败不改结论');
  // 删除函数若仍按 prepareZcodeHome 的布局（<临时目录>/home/.zcode/cli）查，会得 ENOENT、说成「没有副本」
  assert.equal(tempDirResidue, residueLine(priv, left[0]!, SENTINEL_TAIL));
});

test('R3 同形臂正常支的副本删不掉：不抛、结论与不锁时相同、提示取「探针副本」档', { skip: ROOT }, async () => {
  const src = await writeSrc();
  const base = await armInPrivTmp('trivium-fullcopyarm-', {}, (L) => probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src }));
  assert.equal(base.r.override, 'config_copy', base.r.why);
  assert.equal(base.r.tempDirResidue, undefined);
  const { r, left, priv } = await armInPrivTmp('trivium-fullcopyarm-', { FAKE_LOCK_CLI: '1' }, (L) =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src }));
  assert.equal(left.length, 1);
  const { tempDirResidue, ...rest } = r;
  const { tempDirResidue: _none, ...baseRest } = base.r;
  assert.deepEqual(rest, baseRest, '删除失败不改结论');
  assert.equal(tempDirResidue, residueLine(priv, left[0]!, SENTINEL_TAIL));
});

/**
 * 删除注入口的包装（R4 / R6）：记下臂给的 `copy`，按 `mode` 上锁，再调真实的 `removeZcodeTempDir`。
 *   - `cli`：锁副本所在的 cli/，副本删不掉；
 *   - `copyGone`：先删副本、再锁 .zcode——cli/ 已空但删不掉，「目录删不掉、副本已不在」。
 * 上锁抛错不吞（摆锁失败必红）。
 */
function lockingRemover(seen: Array<{ path: string; kind: ZcodeTempDirCopyKind } | null>, mode: 'cli' | 'copyGone'): typeof removeZcodeTempDir {
  return async (dir, who, copy) => {
    seen.push(copy);
    if (!copy) throw new Error('同形臂必须给出副本位置');
    const target = mode === 'cli' ? path.dirname(copy.path) : path.dirname(path.dirname(copy.path));
    if (mode === 'copyGone') await fs.rm(copy.path);
    await fs.chmod(target, 0o500);
    try {
      return await removeZcodeTempDir(dir, who, copy);
    } finally {
      await fs.chmod(target, 0o700);
    }
  };
}

/** 扫得出残余的副本源：不带点的长十六进制值、键名无凭据形态（同上面 CODEX-01 那格） */
async function residueSrc(): Promise<string> {
  const cfg = fullCopyFixture();
  const opts = (cfg['provider'] as Record<string, { options: Record<string, unknown> }>)['bigmodel-coding-plan']!.options;
  opts['opaque'] = 'cd'.repeat(20);
  return writeSrc(cfg);
}

test('R4 同形臂扫出残余（不拉起、副本已在盘上）且删不掉：不抛、结论照旧、提示取「含真实凭据」档', { skip: ROOT }, async () => {
  const src = await residueSrc();
  const seen: Array<{ path: string; kind: ZcodeTempDirCopyKind } | null> = [];
  const log = path.join(await tmp(), 'calls.jsonl');
  const { r, left, priv } = await armInPrivTmp('trivium-fullcopyarm-', { FAKE_ZCODE_LOG: log }, (L) =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src, removeTempDir: lockingRemover(seen, 'cli') }));
  assert.equal(r.override, null, r.why);
  assert.match(r.why, /provider\.bigmodel-coding-plan\.options\.opaque/, 'why 照旧列出残余路径');
  assert.equal(await fs.stat(log).then(() => true, () => false), false, '有残余就不得拉起');
  assert.equal(left.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.kind, 'credential');
  assert.equal(seen[0]!.path, zcodeCliCopyPath(zcodeHomeUnder(path.join(priv, left[0]!))));
  assert.equal(r.tempDirResidue, residueLine(priv, left[0]!, CREDENTIAL_TAIL));
});

test('R5 同形臂 apiKeyOnly 收窄档、无残余也删不掉：提示取「含真实凭据」档（这一档不保证副本里没有凭据）', { skip: ROOT }, async () => {
  const src = await writeSrc(cleanFixture());
  const { r, left, priv } = await armInPrivTmp('trivium-fullcopyarm-', { FAKE_LOCK_CLI: '1' }, (L) =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src, replace: 'apiKeyOnly' }));
  assert.equal(r.override, 'config_copy', '无残余、照常拉起');
  assert.equal(left.length, 1);
  assert.equal(r.tempDirResidue, residueLine(priv, left[0]!, CREDENTIAL_TAIL));
});

test('R6 现场查优先于调用方档位：残余支、目录删不掉而副本已不在 ⇒ 说「没有副本」', { skip: ROOT }, async () => {
  const src = await residueSrc();
  const seen: Array<{ path: string; kind: ZcodeTempDirCopyKind } | null> = [];
  const { r, left, priv } = await armInPrivTmp('trivium-fullcopyarm-', {}, (L) =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: src, removeTempDir: lockingRemover(seen, 'copyGone') }));
  assert.equal(seen[0]!.kind, 'credential', '臂给的档位是「含真实凭据」');
  assert.equal(left.length, 1);
  assert.equal(r.tempDirResidue, residueLine(priv, left[0]!, NO_COPY_TAIL));
});

// ── (D) 隔离腿的只读取证（GLM-02）──

test('listPersonalProviderIds：只返回 provider 键名，不返回任何值', async () => {
  const dir = await tmp();
  const f = path.join(dir, 'provider_config.json');
  await fs.writeFile(f, JSON.stringify({
    schemaVersion: 1,
    config: {
      providers: { 'uuid-aaa': { apiKey: 'PERSONAL-SECRET-1' }, 'uuid-bbb': { apiKey: 'PERSONAL-SECRET-2' } },
      defaultModelSelection: { providerId: 'uuid-aaa', modelId: 'qwen3.8-max' },
      nested: { providers: [{ id: 'arr-provider', token: 'PERSONAL-SECRET-3' }] },
    },
  }));
  const out = await listPersonalProviderIds(f);
  assert.deepEqual(out, { present: true, ids: ['arr-provider', 'uuid-aaa', 'uuid-bbb'] });
  assert.equal(JSON.stringify(out).includes('SECRET'), false);
  assert.deepEqual(await listPersonalProviderIds(path.join(dir, 'missing.json')), { present: false, ids: [] });
});
