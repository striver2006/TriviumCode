/**
 * EV-136：glm 认证探活要探**审查运行将要用的那条选模路径**。
 *
 * 此前探活以 `homeDir: null` 拉起，个人 provider 配置被注入，0.16.9 直接用它的 `defaultModelSelection`——
 * 探的是个人缺省模型；审查运行（EV-82 起）走副本 HOME、不注入个人配置、用 `cli/config.json` 的 `model.main`。
 * 2026-09-26 个人缺省指向已停用的 provider，探活连报 `Model creation failed`，而审查要用的 GLM 订阅完好。
 *
 * 用例用假入口回显子进程看到的环境与副本里的 `model.main`，写到 `FAKE_OBSERVE` 指的文件里。
 * 每条用例都把 `HOME` 钉到 mkdtemp 的临时目录并在里面**摆一份个人配置**——不摆的话，
 * 「注入个人配置」与「不注入」在这台机器之外观测相同，退回旧写法的变异杀不死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../../src/trivium/config.js';
import { ZCODE_PERSONAL_PROVIDER_ENV, zcodeAdapter, zcodeTempDirResidueText, type ZcodeTempDirCopyKind } from '../../src/trivium/adapters/zcode.js';

const tmp = (p: string) => fs.mkdtemp(path.join(os.tmpdir(), p));

const OBSERVE_ENTRY = (exitCode: number, stderrLine = 'Error: Model creation failed (traceId: fake)') => `
const fs = require('node:fs'), path = require('node:path');
const env = process.env;
let modelMain = null;
try { modelMain = JSON.parse(fs.readFileSync(path.join(env.HOME, '.zcode/cli/config.json'), 'utf8')).model.main; } catch {}
fs.writeFileSync(env.FAKE_OBSERVE, JSON.stringify({
  home: env.HOME ?? null,
  personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null,
  storage: env.ZCODE_STORAGE_DIR ?? null,
  modelMain,
}));
// 删不掉的临时目录（EV-197）。摆不出就退非 0，让用例红而不是静默通过：
//   sibling：落点根下一个只读子目录里放一个文件；cli：副本所在的 <落点根>/cli 改只读，副本删不掉
if (env.FAKE_LOCK) {
  if (!env.ZCODE_STORAGE_DIR) { process.stderr.write('FAKE_LOCK：拿不到 ZCODE_STORAGE_DIR，摆不出删不掉的临时目录\\n'); process.exit(3); }
  if (env.FAKE_LOCK === 'cli') {
    const cli = path.join(env.ZCODE_STORAGE_DIR, 'cli');
    if (!fs.existsSync(path.join(cli, 'config.json'))) { process.stderr.write('FAKE_LOCK=cli：落点根下没有副本\\n'); process.exit(3); }
    fs.chmodSync(cli, 0o500);
  } else {
    const locked = path.join(env.ZCODE_STORAGE_DIR, 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'f'), 'x');
    fs.chmodSync(locked, 0o500);
  }
}
if (${exitCode} !== 0) { process.stderr.write(${JSON.stringify(stderrLine)} + '\\n'); process.exit(${exitCode}); }
process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'OK', usage: {}, eventCount: 1 }) + '\\n');
process.exit(0);
`;

const CLI_CONFIG = {
  model: { main: 'bigmodel-coding-plan/GLM-5.3-Flash', lite: 'bigmodel-coding-plan/GLM-5.3-Flash' },
  provider: {
    'bigmodel-coding-plan': {
      name: 'BigModel Coding Plan', kind: 'anthropic', source: 'custom', enabled: true,
      options: { apiKey: 'fake-id.fake-secret', baseURL: 'https://example.invalid' },
      models: { 'GLM-5.3': {}, 'GLM-5.3-Flash': {} },
    },
  },
};

interface Seen { home: string | null; personal: string | null; storage: string | null; modelMain: string | null }

async function world(opts: {
  cliConfig: boolean;
  /** 副本源的原始文本；给了就不用 CLI_CONFIG（用来摆损坏的 JSON 或特殊形状） */
  cliConfigRaw?: string;
  exitCode?: number;
  stderrLine?: string;
  /** 档位 glm.plan：字符串 ⇒ 改成它；null ⇒ 删掉（档位无模型） */
  glmPlanModel?: string | null;
}) {
  const root = await tmp('trivium-auth-root-');
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, OBSERVE_ENTRY(opts.exitCode ?? 0, opts.stderrLine), 'utf8');
  await fs.mkdir(path.join(root, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(root, 'Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');

  const home = await tmp('trivium-auth-home-');
  // 个人配置恒摆着：旧写法会把它注入，新写法在副本支必须省略
  await fs.mkdir(path.join(home, '.zcode/v2'), { recursive: true });
  const personal = path.join(home, '.zcode/v2/provider_config.json');
  await fs.writeFile(personal, '{}', { mode: 0o600 });
  if (opts.cliConfig) {
    await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
    await fs.writeFile(path.join(home, '.zcode/cli/config.json'), opts.cliConfigRaw ?? JSON.stringify(CLI_CONFIG), { mode: 0o600 });
  }

  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode!.entrypoint = entry;
  cfg.probe.cli.zcode!.readonly_flags = ['--mode plan'];
  if (opts.glmPlanModel === null) delete cfg.profiles[cfg.active_profile]!.glm!.plan;
  else if (opts.glmPlanModel) cfg.profiles[cfg.active_profile]!.glm!.plan = opts.glmPlanModel;
  const observe = path.join(root, 'observe.json');
  return { root, home, personal, cfg, observe };
}

async function withEnv<T>(home: string, observe: string, fn: () => Promise<T>): Promise<T> {
  const saved = { HOME: process.env['HOME'], FAKE_OBSERVE: process.env['FAKE_OBSERVE'] };
  process.env['HOME'] = home;
  process.env['FAKE_OBSERVE'] = observe;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const ctxOf = (cfg: ReturnType<typeof defaultConfig>) => ({ cfg, nodePath: process.execPath });

test('副本源在：探活走副本 HOME、不注入个人配置、落点根在副本下，模型按档位覆盖（EV-136）', async () => {
  const w = await world({ cliConfig: true });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  const seen = JSON.parse(await fs.readFile(w.observe, 'utf8')) as Seen;

  assert.equal(r.ok, true, r.detail);
  assert.equal(seen.personal, null, '注入了个人配置 ⇒ CLI 用个人缺省模型，探的不是审查那条路径（EV-136 根因）');
  assert.notEqual(seen.home, w.home, '仍在真实 HOME 下拉起 ⇒ 没走副本');
  assert.ok(seen.home?.startsWith(os.tmpdir()) || seen.home?.startsWith(await fs.realpath(os.tmpdir())), String(seen.home));
  assert.ok(seen.storage && seen.storage.startsWith(path.dirname(seen.home!)), '落点根要在副本运行目录下，不落真实 HOME');
  // 缺省档 glm plan = GLM-5.3，副本源里 model.main 原是 Flash：看到 GLM-5.3 才说明按档位覆盖了
  const want = defaultConfig().profiles['default']!.glm!.plan!;
  assert.equal(seen.modelMain, `bigmodel-coding-plan/${want}`);
  assert.ok(r.detail.includes(want), `详情要写明探的是哪个模型：${r.detail}`);
  // 副本里有凭据：探完必须删掉
  assert.equal(await fs.stat(seen.home!).then(() => true, () => false), false, '临时副本 HOME 未清理');
});

/** 退路支的共同断言：真实 HOME、注入个人配置、落点根仍在临时目录下（与 run() 无副本支同形，代码双审 r1 CODEX-02 ≡ GLM-02） */
function assertFallback(w: Awaited<ReturnType<typeof world>>, seen: Seen, detail: string) {
  assert.equal(seen.home, w.home);
  assert.equal(seen.personal, w.personal);
  assert.ok(seen.storage, '退路支也要设落点根，否则 CLI 产物落进真实 HOME');
  assert.ok(!seen.storage!.startsWith(w.home), `落点根不得在真实 HOME 下：${seen.storage}`);
  // 不一律说成「个人缺省」：个人配置不在时 CLI 会 legacy 导入 cli/config.json（GLM-05）
  assert.match(detail, /真实 HOME 下 ZCode 自选的缺省模型/);
  assert.ok(!detail.includes(w.home), `详情不得带出家目录绝对路径（GLM-01）：${detail}`);
}

test('副本源缺失：与审查运行同一退路——真实 HOME、注入个人配置、落点根照设，详情不带家目录', async () => {
  const w = await world({ cliConfig: false });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  const seen = JSON.parse(await fs.readFile(w.observe, 'utf8')) as Seen;
  assert.equal(r.ok, true, r.detail);
  assertFallback(w, seen, r.detail);
  assert.match(r.detail, /未找到 ~\/\.zcode\/cli\/config\.json/, '家目录要归一成 ~，而不是整段丢掉原因');
});

test('档位无模型：走同一退路，详情写明原因（AGY-01 ≡ GLM-05）', async () => {
  const w = await world({ cliConfig: true, glmPlanModel: null });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  const seen = JSON.parse(await fs.readFile(w.observe, 'utf8')) as Seen;
  assert.equal(r.ok, true, r.detail);
  assertFallback(w, seen, r.detail);
  assert.match(r.detail, /本次未指定模型/);
});

test('副本源不是合法 JSON：落成一条可读的失败，不抛（CODEX-01 ≡ GLM-04）', async () => {
  const w = await world({ cliConfig: true, cliConfigRaw: '{ 半截' });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  assert.equal(r.ok, false);
  assert.match(r.detail, /副本源 ~\/\.zcode\/cli\/config\.json 读取或解析失败/);
  assert.equal(await fs.stat(w.observe).then(() => true, () => false), false, '副本没备好就不该拉起 CLI');
});

test('副本源读不了：指纹返回 null 而不是抛，交给探活报失败（CODEX-01）', { skip: process.getuid?.() === 0 }, async () => {
  const w = await world({ cliConfig: true });
  const src = path.join(w.home, '.zcode/cli/config.json');
  await fs.chmod(src, 0o000);
  try {
    const fp = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).fingerprint());
    assert.equal(fp, null);
    const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
    assert.equal(r.ok, false);
    assert.match(r.detail, /读取或解析失败/);
  } finally {
    await fs.chmod(src, 0o600);
  }
});

test('置首挪不动：详情注明请求模型可能没生效（CODEX-03）', async () => {
  // JS 对象恒把整数样键名排在前面：provider「123」永远在首位，请求的 bigmodel 挪不上去
  const shape = {
    model: CLI_CONFIG.model,
    provider: { '123': { name: 'n', kind: 'anthropic', enabled: true, options: {}, models: { X: {} } }, ...CLI_CONFIG.provider },
  };
  const w = await world({ cliConfig: true, cliConfigRaw: JSON.stringify(shape) });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /模型 bigmodel-coding-plan\/GLM-5\.3（置首未生效：.+；实际生效模型未核）/);
});

test('副本支报 model_config_missing：不说「缺文件」，说文件在而 provider 不可用（GLM-06）', async () => {
  const w = await world({ cliConfig: true, exitCode: 1, stderrLine: 'Error: Model config is missing' });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  assert.equal(r.ok, false);
  assert.match(r.detail, /副本源 ~\/\.zcode\/cli\/config\.json 在，但 CLI 报模型配置缺失/);
  assert.match(r.detail, /模型 bigmodel-coding-plan\/GLM-5\.3/, '失败详情也要说探的是哪条路径');
  assert.doesNotMatch(r.detail, /^缺 ~/);
});

test('限定失败（档位模型不在副本源里）：仍走副本、不注入个人配置，详情不把请求模型冒充成实际模型', async () => {
  const w = await world({ cliConfig: true, glmPlanModel: 'NOPE-9' });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  const seen = JSON.parse(await fs.readFile(w.observe, 'utf8')) as Seen;
  assert.equal(r.ok, true, r.detail);
  assert.equal(seen.personal, null, '限定失败与 run() 同：副本照建、个人配置照样不注入');
  assert.equal(seen.modelMain, CLI_CONFIG.model.main, '不改 model.main');
  assert.ok(!r.detail.includes('NOPE-9') || r.detail.includes('原有的 model.main'), r.detail);
  assert.match(r.detail, /原有的 model\.main/);
});

test('探活失败：详情带上探的是哪条路径，CLI 原话照旧附上', async () => {
  const w = await world({ cliConfig: true, exitCode: 1 });
  const r = await withEnv(w.home, w.observe, () => zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe());
  assert.equal(r.ok, false);
  assert.match(r.detail, /探活失败（other，模型 bigmodel-coding-plan\/GLM-5\.3）/);
  assert.match(r.detail, /Model creation failed/);
});

test('指纹带上探活模型：换档位模型后缓存失效', async () => {
  const a = await world({ cliConfig: true });
  const b = await world({ cliConfig: true, glmPlanModel: 'GLM-5.3-Flash' });
  // 两个世界的副本源逐字相同，只差档位模型
  const fa = await withEnv(a.home, a.observe, () => zcodeAdapter.authProbe!(ctxOf(a.cfg), a.root).fingerprint());
  const fb = await withEnv(b.home, b.observe, () => zcodeAdapter.authProbe!(ctxOf(b.cfg), b.root).fingerprint());
  assert.ok(fa && fb);
  assert.notEqual(fa, fb);
});

// ── EV-197：临时目录删不掉时不抛、结论不变、详情末尾说清残留 ─────────────────

/**
 * 钉住 HOME / TMPDIR / FAKE_LOCK 跑一次探活（计划双审 GLM-03：与 doctor 侧 D10 同法，残留落在本用例私有根里）。
 * 结束恢复只读子目录的权限、整删私有根；观测文件只用来断言「残留确在」，不承担清理。
 */
async function probeLocked(w: Awaited<ReturnType<typeof world>>, lock: 'sibling' | 'cli') {
  const priv = await tmp('trivium-auth-priv-');
  const saved = { HOME: process.env['HOME'], FAKE_OBSERVE: process.env['FAKE_OBSERVE'], TMPDIR: process.env['TMPDIR'], FAKE_LOCK: process.env['FAKE_LOCK'] };
  process.env['HOME'] = w.home;
  process.env['FAKE_OBSERVE'] = w.observe;
  process.env['TMPDIR'] = priv;
  process.env['FAKE_LOCK'] = lock;
  try {
    const r = await zcodeAdapter.authProbe!(ctxOf(w.cfg), w.root).probe();
    const left = (await fs.readdir(priv)).filter((e) => e.startsWith('trivium-zcode-auth-'));
    // 期望的残留提示在同一环境下算（家目录归一用的是当时的 HOME）
    const want = (copy: ZcodeTempDirCopyKind | null) => zcodeTempDirResidueText('探活', path.join(priv, left[0] ?? '?'), 'EACCES', copy);
    return { r, left, want };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const seen = await fs.readFile(w.observe, 'utf8').then((t) => JSON.parse(t) as Seen, () => null);
    for (const d of seen?.storage ? [path.join(seen.storage, 'cli'), path.join(seen.storage, 'locked')] : []) {
      await fs.chmod(d, 0o700).catch(() => {});
    }
    await fs.rm(priv, { recursive: true, force: true });
  }
}

const ROOT = process.getuid?.() === 0;

test('A1 副本支探活通过 + 副本删不掉：不抛、结论仍通过、详情末尾说清残留与副本凭据', { skip: ROOT }, async () => {
  const w = await world({ cliConfig: true });
  const { r, left, want } = await probeLocked(w, 'cli');
  assert.equal(left.length, 1, '本格就是要摆出删不掉：私有根下应恰有一个残留');
  assert.equal(r.ok, true, r.detail);
  assert.ok(r.detail.startsWith('探活通过（'), r.detail);
  // 字面断言（计划双审 CODEX-03：不只比函数输出）
  assert.match(r.detail, /；⚠️ 探活临时目录删除失败（EACCES）：.+ 仍在，其中的 cli\/config\.json 副本含真实凭据，请手工删除$/);
  assert.ok(r.detail.endsWith(`；${want('credential')}`), r.detail);
});

test('A2 副本支探活失败 + 副本删不掉：不抛、结论仍失败、详情末尾同样说清残留', { skip: ROOT }, async () => {
  const w = await world({ cliConfig: true, exitCode: 1 });
  const { r, left, want } = await probeLocked(w, 'cli');
  assert.equal(left.length, 1);
  assert.equal(r.ok, false);
  assert.ok(r.detail.startsWith('探活失败（other，'), r.detail);
  assert.match(r.detail, /含真实凭据，请手工删除$/);
  assert.ok(r.detail.endsWith(`；${want('credential')}`), r.detail);
});

test('A3 删除失败提示两侧同源：只差主语，三档措辞各自属实', () => {
  const dir = '/x/trivium-zcode-x';
  for (const copy of ['credential', 'sentinel', null] as const) {
    const a = zcodeTempDirResidueText('探针', dir, 'EACCES', copy);
    const b = zcodeTempDirResidueText('探活', dir, 'EACCES', copy);
    assert.equal(a.replace('探针', '探活'), b);
  }
  // credential 与 null 两档与 EV-197 时的 true / false 逐字相同（EV-198 计划 r2 §2.1）：字面写死，不由函数自比
  assert.equal(
    zcodeTempDirResidueText('探活', dir, 'EBUSY', 'credential'),
    '⚠️ 探活临时目录删除失败（EBUSY）：/x/trivium-zcode-x 仍在，其中的 cli/config.json 副本含真实凭据，请手工删除',
  );
  assert.equal(
    zcodeTempDirResidueText('探活', dir, 'EBUSY', null),
    '⚠️ 探活临时目录删除失败（EBUSY）：/x/trivium-zcode-x 仍在，其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除',
  );
  assert.equal(zcodeTempDirResidueText('探针', path.join(os.homedir(), 'tmp/d'), 'EACCES', 'credential').includes(`~${path.sep}tmp`), true, '家目录归一成 ~');
});

test('R7 第三档「探针副本、凭据已换成哨兵」逐字（EV-198 计划 r2 §2.1）', () => {
  assert.equal(
    zcodeTempDirResidueText('探针', '/x/trivium-modeloverride-x', 'EACCES', 'sentinel'),
    '⚠️ 探针临时目录删除失败（EACCES）：/x/trivium-modeloverride-x 仍在，其中的 cli/config.json 是探针副本、凭据已换成哨兵，仍请手工删除',
  );
});

test('A4 退路支（档位无模型）+ 删不掉：没有副本就不说「含真实凭据」（计划双审 GLM-02）', { skip: ROOT }, async () => {
  const w = await world({ cliConfig: true, glmPlanModel: null });
  const { r, left, want } = await probeLocked(w, 'sibling');
  assert.equal(left.length, 1, '退路支也设落点根，同样摆得出删不掉');
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /真实 HOME 下 ZCode 自选的缺省模型/, '本格摆的是退路支');
  assert.match(r.detail, /其中没有 cli\/config\.json 副本，是本次探测的 CLI 产物，请手工删除$/);
  assert.doesNotMatch(r.detail, /含真实凭据/);
  assert.ok(r.detail.endsWith(`；${want(null)}`), r.detail);
});
