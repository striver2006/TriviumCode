/**
 * EV-82 第二段（运行期选模观测，r2 §3 / §4 / §7）：
 * 运行期读数 `readRuntimeSelectedModel`、置首变体 `reorderRequestedFirst`、两臂接入 `runtimeSelected`。
 *
 * 全部用**临时目录里的合成配置**与假入口，不碰真实 `~/.zcode/**`、不拉起真实 CLI、零配额。
 * 事件名在本文件里**写字面**、不 import 常量：读错事件名的变异要能被这里咬住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { prepareZcodeHome, zcodeHomeUnder } from '../../src/trivium/adapters/zcode.js';
import { reorderHint } from '../../src/trivium/guard.js';
import {
  catalogFirstNote,
  describeRuntimeSelection,
  judgeRuntimeSelection,
  probeModelOverride,
  probeModelOverrideFullCopy,
  readRuntimeSelectedModel,
  reorderRequestedFirst,
  type VariantKind,
} from '../../src/trivium/probes/zcode.js';
import { scratchDir } from '../helpers/scratch.js';

// WIN_FILE_SKIP（Windows 移植）：zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）
// macOS/Linux 行为零变化。Windows 侧【无等价物】：本文件守的是 HOME 隔离夹具下的文件级语义
// （凭据值不出现在输出、选模落实、provider env 剥离），platform-win.test.ts 只覆盖平台原语、
// 覆盖不了这些——残余登记 Bug 清单 §3.1-2/6，适配前不要引用本文件作为 Windows 的覆盖证据。
if (process.platform === 'win32') {
  console.log('skip（win32）: zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）');
} else {

const tmp = () => scratchDir('trivium-runtimesel-test-');
const EVENT = 'bootstrap.app.startup.runtime_config.completed';

async function homeWithLog(files: Record<string, string>): Promise<string> {
  const home = await tmp();
  const dir = path.join(home, '.zcode/cli/log');
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), body, 'utf8');
  return home;
}

const line = (o: unknown) => JSON.stringify(o) + '\n';
const startup = (model?: unknown) => line({ event: EVENT, context: model === undefined ? {} : { model } });

// ── 运行期读数：六种成因（CODEX-02）──

test('运行期读数：无日志目录 ⇒ no_log_dir', async () => {
  assert.deepEqual(await readRuntimeSelectedModel(await tmp()), { cause: 'no_log_dir', model: null });
});

test('运行期读数：目录在、没有 .jsonl ⇒ no_log_file', async () => {
  const home = await homeWithLog({ 'note.txt': startup('p/m') });
  assert.deepEqual(await readRuntimeSelectedModel(home), { cause: 'no_log_file', model: null });
});

test('运行期读数：有日志、没有启动事件 ⇒ no_event（事件名只出现在别的字段里也不算）', async () => {
  const home = await homeWithLog({ 'a.jsonl': line({ event: 'other.event' }) + line({ event: 'x', message: EVENT, context: { model: 'p/m' } }) });
  assert.deepEqual(await readRuntimeSelectedModel(home), { cause: 'no_event', model: null });
});

test('运行期读数：启动事件在、context.model 缺失或为空串 ⇒ no_model_field', async () => {
  for (const m of [undefined, '', 42]) {
    const home = await homeWithLog({ 'a.jsonl': startup(m) });
    assert.deepEqual(await readRuntimeSelectedModel(home), { cause: 'no_model_field', model: null }, `model=${JSON.stringify(m)}`);
  }
});

test('运行期读数：正常 ⇒ ok，只返回 context.model 一个字段', async () => {
  const home = await homeWithLog({ 'a.jsonl': line({ event: EVENT, context: { model: 'p/m', prompt: 'SECRET-PROMPT' }, extra: 'x' }) });
  const r = await readRuntimeSelectedModel(home);
  assert.deepEqual(r, { cause: 'ok', model: 'p/m' });
  assert.equal(JSON.stringify(r).includes('SECRET-PROMPT'), false);
});

test('运行期读数：多文件取排序最新的一份', async () => {
  const home = await homeWithLog({
    '2026-09-24T01-00-00.jsonl': startup('p/new'),
    '2026-09-23T23-00-00.jsonl': startup('p/old'),
  });
  assert.equal((await readRuntimeSelectedModel(home)).model, 'p/new');
});

test('运行期读数：同一文件多条启动事件取最后一条', async () => {
  const home = await homeWithLog({ 'a.jsonl': startup('p/first') + line({ event: 'mid' }) + startup('p/last') });
  assert.equal((await readRuntimeSelectedModel(home)).model, 'p/last');
});

test('运行期读数：末行截断（超时被杀）跳过，不抛、不影响前面的读数', async () => {
  const truncated = JSON.stringify({ event: EVENT, context: { model: 'p/cut' } }).slice(0, -8);
  const home = await homeWithLog({ 'a.jsonl': startup('p/whole') + truncated });
  assert.deepEqual(await readRuntimeSelectedModel(home), { cause: 'ok', model: 'p/whole' });
});

test('describeRuntimeSelection：每种成因各有一句，ok 带模型', () => {
  assert.match(describeRuntimeSelection({ cause: 'ok', model: 'p/m' }), /运行期选定 p\/m/);
  assert.match(describeRuntimeSelection(undefined), /未采集/);
  const causes = ['not_launched', 'no_log_dir', 'no_log_file', 'no_event', 'no_model_field'] as const;
  const texts = causes.map((c) => describeRuntimeSelection({ cause: c, model: null }));
  assert.equal(new Set(texts).size, causes.length, '成因之间不得共用同一句');
  for (const t of texts) assert.match(t, /读不到：\S/);
});

// ── 置首变体（CODEX-04 / AGY-03 / GLM-08）──

type Cfg = { model?: unknown; provider: Record<string, { name?: string; models: Record<string, unknown> }> };

function twoProviders(): Cfg {
  return {
    model: { main: 'bp/B' },
    provider: {
      other: { name: 'Other', models: { x: {}, y: {} } },
      bp: { name: 'BP', models: { A: { ctx: 1 }, B: { ctx: 2 }, C: { ctx: 3 } } },
    },
  };
}

test('置首：provider 与成员都挪到首位；只动顺序——键集合、每个值、嵌套原样；不改入参', () => {
  const src = twoProviders();
  const before = JSON.stringify(src);
  const { copy, outcome } = reorderRequestedFirst(src, 'bp', 'B');
  assert.deepEqual(outcome, { variant: 'requested-first', applied: true, kind: 'applied' });
  assert.deepEqual(Object.keys(copy.provider), ['bp', 'other']);
  assert.deepEqual(Object.keys(copy.provider['bp']!.models), ['B', 'A', 'C']);
  assert.deepEqual(copy, src, 'deepEqual 不看键序：值与结构必须完全相同');
  assert.equal(JSON.stringify(src), before, '入参不得被改');
});

test('置首：成员 id 与键名不同时按 id 定位；id 带首尾空白按 trim 后比', () => {
  const cfg: Cfg = { provider: { bp: { models: { k1: { id: 'A' }, k2: { id: ' B ' } } } } };
  const { copy, outcome } = reorderRequestedFirst(cfg, 'bp', 'B');
  assert.equal(outcome.applied, true, outcome.reason);
  assert.deepEqual(Object.keys(copy.provider['bp']!.models), ['k2', 'k1']);
});

test('置首：跳过 deleted 成员；重复 id 取第一个匹配键（导入器先到先得）', () => {
  const cfg: Cfg = {
    provider: { bp: { models: { a: {}, gone: { id: 'B', deleted: true }, first: { id: 'B' }, second: { id: 'B' } } } },
  };
  const { copy, outcome } = reorderRequestedFirst(cfg, 'bp', 'B');
  assert.equal(outcome.applied, true, outcome.reason);
  assert.equal(Object.keys(copy.provider['bp']!.models)[0], 'first');
});

test('置首挪不动不当成功：找不到 provider / 成员、恒等、整数样键名 ⇒ applied:false 带原因，原样返回', () => {
  const cases: Array<[string, Cfg, string, string, RegExp, string]> = [
    ['无 provider', twoProviders(), 'nope', 'B', /没有 provider/, 'not_movable'],
    ['无成员', twoProviders(), 'bp', 'Z', /没有 id 为 Z/, 'not_movable'],
    ['只剩 deleted', { provider: { bp: { models: { a: {}, B: { deleted: true } } } } }, 'bp', 'B', /没有 id 为 B/, 'not_movable'],
    ['恒等', { provider: { bp: { models: { B: {}, A: {} } } } }, 'bp', 'B', /恒等/, 'identity'],
    ['整数样键名', { provider: { bp: { models: { '1': {}, '2': {} } } } }, 'bp', '2', /整数样键名/, 'not_movable'],
  ];
  for (const [name, cfg, pk, mid, why, kind] of cases) {
    const { copy, outcome } = reorderRequestedFirst(cfg, pk, mid);
    assert.equal(outcome.applied, false, name);
    assert.equal(outcome.kind, kind, `${name}：结构化成因（第三段 r3 §3.1）`);
    assert.match(outcome.reason ?? '', why, name);
    assert.equal(copy, cfg, `${name}：挪不动时原样返回`);
  }
});

test('置首：provider 键带首尾空白也能定位，重建时保留原始键（代码双审 r1 CODEX-02 ≡ GLM-03）', () => {
  const cfg: Cfg = { provider: { other: { models: { x: {} } }, ' bp ': { models: { A: {}, B: {} } } } };
  const { copy, outcome } = reorderRequestedFirst(cfg, 'bp', 'B');
  assert.equal(outcome.applied, true, outcome.reason);
  assert.deepEqual(Object.keys(copy.provider), [' bp ', 'other']);
  assert.deepEqual(Object.keys(copy.provider[' bp ']!.models), ['B', 'A']);
});

test('置首：多个 provider 键 trim 后同名 ⇒ 挪不动（导入器取哪个未核实，不猜）', () => {
  const cfg: Cfg = { provider: { other: { models: { x: {} } }, bp: { models: { A: {}, B: {} } }, ' bp': { models: { B: {} } } } };
  const { copy, outcome } = reorderRequestedFirst(cfg, 'bp', 'B');
  assert.equal(outcome.applied, false);
  assert.match(outcome.reason ?? '', /trim 后都是 bp/);
  assert.equal(outcome.kind, 'not_movable');
  assert.equal(copy, cfg);
});

test('catalogFirstNote：只在请求 modelId 段等于首个有成员 provider 的首个成员时标注（代码双审 r1 CODEX-04）', () => {
  const cfg = {
    provider: {
      empty: { source: 'custom', models: {} },
      p: { source: 'custom', models: { gone: { deleted: true }, A: {}, B: {} } },
    },
  };
  assert.match(catalogFirstNote(cfg, 'p/A'), /请求为目录首位/);
  assert.match(catalogFirstNote(cfg, 'other-form/A'), /请求为目录首位/, '只比 modelId 段，与判据同口径');
  assert.equal(catalogFirstNote(cfg, 'p/B'), '');
  assert.equal(catalogFirstNote(cfg, 'p/gone'), '', 'deleted 成员不算首位');
  assert.equal(catalogFirstNote({ provider: {} }, 'p/A'), '');
});

// ── 两臂流程（假入口模拟「默认选择不可选 ⇒ 运行期回落 models 第一个」）──

/**
 * 假入口：配置读取层照 `model.main` 写出 v2（与真实 CLI 的 legacy 导入同形）；
 * 运行期选定写进 `${ZCODE_LOG_DIR ?? HOME/.zcode/cli/log}` 的启动事件：
 *   FAKE_RUNTIME_FALLBACK 时回落「第一个 provider 的第一个未删成员」（EV-82 静态佐证的形态），否则取 model.main；
 *   FAKE_NO_LOG 不写日志。
 */
const RUNTIME_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env;
if (env.FAKE_ZCODE_LOG) fs.appendFileSync(env.FAKE_ZCODE_LOG, JSON.stringify({ logDirEnv: env.ZCODE_LOG_DIR ?? null }) + '\\n');
const cfg = JSON.parse(fs.readFileSync(path.join(env.HOME, '.zcode/cli/config.json'), 'utf8'));
const main = cfg.model.main; const i = main.indexOf('/');
fs.mkdirSync(path.join(env.HOME, '.zcode/v2'), { recursive: true });
fs.writeFileSync(path.join(env.HOME, '.zcode/v2/provider_config.json'),
  JSON.stringify({ schemaVersion: 1, config: { defaultModelSelection: { providerId: main.slice(0, i), modelId: main.slice(i + 1) } } }));
let rt = main;
if (env.FAKE_RUNTIME_FALLBACK) {
  const [pid, pv] = Object.entries(cfg.provider)[0];
  const [mk, mv] = Object.entries(pv.models).find(([, m]) => !(m && m.deleted === true));
  rt = pid + '/' + ((mv && typeof mv.id === 'string') ? mv.id : mk).trim();
}
if (!env.FAKE_NO_LOG) {
  const dir = env.ZCODE_LOG_DIR || path.join(env.HOME, '.zcode/cli/log');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-09-24T00-00-00.jsonl'),
    JSON.stringify({ event: 'bootstrap.other' }) + '\\n' + JSON.stringify({ event: '${EVENT}', context: { model: rt } }) + '\\n');
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

/** 两个 provider，请求的那个排第二、请求的模型排第二：置首要同时挪 provider 与成员才能落到请求值 */
function catalog(): Record<string, unknown> {
  return {
    model: { main: 'other/x', lite: 'other/x' },
    provider: {
      other: { name: 'Other', kind: 'anthropic', source: 'custom', options: { baseURL: 'https://other.invalid/api', apiKeyRequired: true }, models: { x: {}, y: {} } },
      'bigmodel-coding-plan': {
        name: 'BigModel Coding Plan', kind: 'anthropic', source: 'custom',
        options: { baseURL: 'https://example.invalid/api', apiKeyRequired: true },
        models: { 'GLM-5.3': {}, 'GLM-5.3-Flash': {}, 'GLM-5.3-Air': {} },
      },
    },
  };
}

const REQ = 'bigmodel-coding-plan/GLM-5.3-Flash';

async function fakeLayout(): Promise<{ entry: string; cwd: string; src: string }> {
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, RUNTIME_ENTRY, 'utf8');
  const builtin = path.join(root, 'Resources/config/provider/zcode-builtin.json');
  await fs.mkdir(path.dirname(builtin), { recursive: true });
  await fs.writeFile(builtin, '{}', 'utf8');
  const cwd = path.join(root, 'proj');
  await fs.mkdir(cwd, { recursive: true });
  const src = path.join(root, 'config.json');
  await fs.writeFile(src, JSON.stringify(catalog()), { encoding: 'utf8', mode: 0o600 });
  return { entry, cwd, src };
}

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('同形臂 as-is：配置读取层写出请求值（config_copy），运行期却回落首位——两层分开报', async () => {
  const L = await fakeLayout();
  const r = await withEnv({ FAKE_RUNTIME_FALLBACK: '1' }, () =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ }));
  assert.equal(r.override, 'config_copy', r.why);
  assert.equal(r.observed, REQ);
  assert.deepEqual(r.runtimeSelected, { cause: 'ok', model: 'other/x' }, '读取发生在清理之前，才读得到');
  assert.deepEqual(r.variant, { variant: 'as-is', applied: true, kind: 'applied' });
});

test('同形臂 requested-first：只挪顺序，运行期回落就落在请求模型上', async () => {
  const L = await fakeLayout();
  const r = await withEnv({ FAKE_RUNTIME_FALLBACK: '1' }, () =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ, variant: 'requested-first' }));
  assert.equal(r.override, 'config_copy', r.why);
  assert.deepEqual(r.variant, { variant: 'requested-first', applied: true, kind: 'applied' });
  assert.deepEqual(r.runtimeSelected, { cause: 'ok', model: REQ });
});

test('同形臂 requested-first 挪不动（请求本就在首位）⇒ applied:false 带原因，照常拉起', async () => {
  const L = await fakeLayout();
  const r = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'other/x', variant: 'requested-first' });
  assert.equal(r.variant?.applied, false);
  assert.equal(r.variant?.kind, 'identity');
  assert.match(r.variant?.reason ?? '', /恒等/);
  assert.equal(r.runtimeSelected?.cause, 'ok');
});

test('同形臂 requested-first 限定失败 ⇒ 不拉起，variant 带原因、运行期 not_launched', async () => {
  const L = await fakeLayout();
  const r = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'nope/none', variant: 'requested-first' });
  assert.equal(r.override, null);
  assert.equal(r.variant?.applied, false);
  assert.match(r.variant?.reason ?? '', /限定失败/);
  assert.equal(r.variant?.kind, 'qualify_failed');
  assert.deepEqual(r.runtimeSelected, { cause: 'not_launched', model: null });
});

test('白名单臂：显式 opts.model 优先于 pickNonFirstModel，运行期读数接入', async () => {
  const L = await fakeLayout();
  const r = await withEnv({ FAKE_RUNTIME_FALLBACK: '1' }, () =>
    probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'bigmodel-coding-plan/GLM-5.3-Air' }));
  assert.equal(r.requested, 'bigmodel-coding-plan/GLM-5.3-Air', '缺省会挑 other/y');
  assert.equal(r.override, 'config_copy', r.why);
  assert.deepEqual(r.runtimeSelected, { cause: 'ok', model: 'other/x' });
});

test('两臂早退 ⇒ runtimeSelected 为 not_launched', async () => {
  const L = await fakeLayout();
  const white = await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'nope/none' });
  const full = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'nope/none' });
  assert.deepEqual([white.runtimeSelected?.cause, full.runtimeSelected?.cause], ['not_launched', 'not_launched']);
});

test('拉起了但没写日志 ⇒ no_log_dir（与 not_launched 区分）', async () => {
  const L = await fakeLayout();
  const r = await withEnv({ FAKE_NO_LOG: '1' }, () =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ }));
  assert.equal(r.override, 'config_copy', r.why);
  assert.deepEqual(r.runtimeSelected, { cause: 'no_log_dir', model: null });
});

test('宿主预置 ZCODE_LOG_DIR：两臂都清掉它，日志仍落进副本 HOME、宿主目录不被写', async () => {
  const L = await fakeLayout();
  const hostLogDir = await tmp();
  const calls = path.join(await tmp(), 'calls.jsonl');
  const [white, full] = await withEnv({ ZCODE_LOG_DIR: hostLogDir, FAKE_ZCODE_LOG: calls }, async () => [
    await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ }),
    await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ }),
  ]);
  assert.deepEqual(white.runtimeSelected, { cause: 'ok', model: REQ });
  assert.deepEqual(full.runtimeSelected, { cause: 'ok', model: REQ });
  assert.deepEqual(await fs.readdir(hostLogDir), [], '宿主日志目录不得被写');
  const seen = (await fs.readFile(calls, 'utf8')).trim().split('\n').map((l) => (JSON.parse(l) as { logDirEnv: string | null }).logDirEnv);
  assert.deepEqual(seen, [null, null], '子进程看不到 ZCODE_LOG_DIR');
});

test('两臂：显式请求目录首位 ⇒ 结论照出、why 标注无判别力；非首位不标（代码双审 r1 CODEX-04）', async () => {
  const L = await fakeLayout();
  const first = await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'other/x' });
  assert.equal(first.override, 'config_copy', '结论照出，不改');
  assert.match(first.why, /请求为目录首位/);
  const fullFirst = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'other/x' });
  assert.match(fullFirst.why, /请求为目录首位/);
  const nonFirst = await probeModelOverride(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ });
  assert.equal(/请求为目录首位|按构造失明/.test(nonFirst.why), false);
});

test('同形臂：置首生效 ⇒ why 标注配置层判据按构造失明；原样不标', async () => {
  const L = await fakeLayout();
  const moved = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ, variant: 'requested-first' });
  assert.equal(moved.variant?.applied, true);
  assert.match(moved.why, /置首后请求就在首位，配置层判据按构造失明/);
  const asIs = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ });
  assert.equal(/按构造失明/.test(asIs.why), false);
});

// ── 第三段（置首修法，r3）：副本构造的置首选项、审查臂流程、守卫分句、新事实判定 ──

async function userHomeWith(cfgObj: unknown): Promise<string> {
  const home = await tmp();
  await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/cli/config.json'), JSON.stringify(cfgObj), { encoding: 'utf8', mode: 0o600 });
  return home;
}

test('prepareZcodeHome requestedFirst：transformCopy 收到的已是置首后的对象，盘上键序与 prep.reorder 一致', async () => {
  const src = path.join(await userHomeWith(catalog()), '.zcode/cli/config.json');
  const runDir = await tmp();
  const seen: string[][] = [];
  const prep = await prepareZcodeHome(runDir, REQ, {
    srcConfig: src,
    requestedFirst: true,
    transformCopy: (c) => {
      const pv = c.provider as Record<string, { models: Record<string, unknown> }>;
      seen.push(Object.keys(pv), Object.keys(pv['bigmodel-coding-plan']!.models));
      return c;
    },
  });
  assert.deepEqual(prep.reorder, { variant: 'requested-first', applied: true, kind: 'applied' });
  assert.deepEqual(seen, [['bigmodel-coding-plan', 'other'], ['GLM-5.3-Flash', 'GLM-5.3', 'GLM-5.3-Air']], '置首在 transformCopy 之前（锁实现顺序：残余扫描面对最终落盘的副本）');
  const disk = JSON.parse(await fs.readFile(path.join(zcodeHomeUnder(runDir), '.zcode/cli/config.json'), 'utf8')) as {
    provider: Record<string, { models: Record<string, unknown> }>;
  };
  assert.deepEqual(Object.keys(disk.provider), ['bigmodel-coding-plan', 'other']);
  assert.deepEqual(Object.keys(disk.provider['bigmodel-coding-plan']!.models), ['GLM-5.3-Flash', 'GLM-5.3', 'GLM-5.3-Air']);
});

test('prepareZcodeHome：不传 requestedFirst ⇒ reorder 为 null、键序原样；限定失败 ⇒ reorder 为 null、照常建副本', async () => {
  const src = path.join(await userHomeWith(catalog()), '.zcode/cli/config.json');
  const plain = await prepareZcodeHome(await tmp(), REQ, { srcConfig: src });
  assert.equal(plain.reorder, null);
  const disk = JSON.parse(await fs.readFile(path.join(plain.homeDir!, '.zcode/cli/config.json'), 'utf8')) as { provider: Record<string, unknown> };
  assert.deepEqual(Object.keys(disk.provider), ['other', 'bigmodel-coding-plan']);
  const bad = await prepareZcodeHome(await tmp(), 'nope/none', { srcConfig: src, requestedFirst: true });
  assert.equal(bad.route, 'global');
  assert.notEqual(bad.homeDir, null);
  assert.equal(bad.reorder, null);
});

/**
 * 审查臂假入口：配置读取层照 model.main 导入；运行期回落「第一个 provider 的第一个未删成员」（第二段实验 (F1) 的形态），
 * 把运行期选定写进会话日志（带 sessionId，审查臂的 modelFromLog 读它）。
 */
const REVIEW_ARM_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env;
const cfg = JSON.parse(fs.readFileSync(path.join(env.HOME, '.zcode/cli/config.json'), 'utf8'));
const [pid, pv] = Object.entries(cfg.provider)[0];
const [mk, mv] = Object.entries(pv.models).find(([, m]) => !(m && m.deleted === true));
const rt = pid + '/' + ((mv && typeof mv.id === 'string') ? mv.id : mk).trim();
const dir = path.join(env.HOME, '.zcode/cli/log');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'zcode-2026-09-24.jsonl'),
  JSON.stringify({ sessionId: 'sess_fake', event: '${EVENT}', context: { model: rt } }) + '\\n');
process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'ok', usage: {}, eventCount: 1 }) + '\\n');
process.exit(0);
`;

async function runReviewArm(model: string) {
  const { defaultConfig } = await import('../../src/trivium/config.js');
  const { zcodeAdapter } = await import('../../src/trivium/adapters/zcode.js');
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, REVIEW_ARM_ENTRY, 'utf8');
  await fs.mkdir(path.join(root, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(root, 'Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');
  const userHome = await userHomeWith(catalog());
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
  return withEnv({ HOME: userHome }, async () => {
    const result = await zcodeAdapter.run({ cfg, nodePath: process.execPath }, req as never);
    const trace = JSON.parse(await fs.readFile(result.trace_path!, 'utf8')) as {
      modelSelection: { requested: string; effective: string | null; reorder?: { applied: boolean; kind: string; reason?: string }; note?: string };
    };
    return { result, trace };
  });
}

test('审查臂：非首位请求 ⇒ 置首后运行期回落正好落在请求上；trace 记 reorder 与「请求模型已置首」事实句；守卫字段 kind=applied', async () => {
  const { result, trace } = await runReviewArm(REQ);
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.equal(result.model_effective, REQ, '不置首时假入口会回落到 other/x');
  assert.equal(result.model_override_applied, true);
  assert.deepEqual(result.model_override_reorder, { applied: true, kind: 'applied' });
  assert.deepEqual(trace.modelSelection.reorder, { applied: true, kind: 'applied' });
  assert.match(trace.modelSelection.note ?? '', /请求模型已置首，读回的正是它；是否靠置首不可分/);
  assert.equal(/靠置首达成/.test(trace.modelSelection.note ?? ''), false, '不替收窄后的字段下因果判断（代码双审 r1 CODEX-03）');
});

test('审查臂：请求本在首位（恒等路径）⇒ kind=identity、覆盖照样落实、不写置首事实句、守卫不告警', async () => {
  const { result, trace } = await runReviewArm('other/x');
  assert.equal(result.model_effective, 'other/x');
  assert.equal(result.model_override_applied, true);
  assert.equal(result.model_override_reorder?.kind, 'identity');
  assert.equal(trace.modelSelection.reorder?.kind, 'identity');
  assert.equal(/请求模型已置首/.test(trace.modelSelection.note ?? ''), false);
});

test('reorderHint：缺席 ⇒ 空串（告警维持原文）；在场按 kind 分三句，不看 reason 文案', () => {
  assert.equal(reorderHint(undefined), '');
  assert.match(reorderHint({ applied: true, kind: 'applied' }), /置首已生效仍回落.*runtime_selection/);
  assert.match(reorderHint({ applied: false, kind: 'identity', reason: '随便什么文案' }), /请求本在首位/);
  for (const kind of ['not_movable', 'qualify_failed'] as const) {
    assert.match(reorderHint({ applied: false, kind, reason: 'R' }), /置首没做成：R/);
  }
  for (const r of [{ applied: true, kind: 'applied' as const }, { applied: false, kind: 'identity' as const }]) {
    assert.match(reorderHint(r), /^先看 trace\.json 的 `modelSelection\.reorder`/);
  }
});

type Arm = Parameters<typeof judgeRuntimeSelection>[0];
const arm = (model: string | null, over: Partial<Arm> = {}): Arm => ({
  override: 'config_copy', requested: REQ, observed: REQ, why: '', replacedPaths: [], hostCredentialEnv: [],
  runtimeSelected: model === null ? { cause: 'no_event', model: null } : { cause: 'ok', model },
  variant: { variant: 'as-is', applied: true, kind: 'applied' },
  ...over,
});
const roArm = (model: string | null, kind: VariantKind = 'applied', over: Partial<Arm> = {}) =>
  arm(model, { variant: { variant: 'requested-first', applied: kind === 'applied', kind }, ...over });

test('judgeRuntimeSelection：按序五格（r3 §4.2），只比 modelId 段', () => {
  const FIRST = 'other/x';
  // ① 前提
  assert.equal(judgeRuntimeSelection(arm(null), roArm(REQ)).value, null, '原样支读数不 ok');
  assert.equal(judgeRuntimeSelection(arm(FIRST), roArm(null)).value, null, '置首支读数不 ok');
  assert.equal(judgeRuntimeSelection(arm(FIRST), roArm(REQ, 'identity')).value, null, '置首支恒等也记 null');
  assert.equal(judgeRuntimeSelection(arm(FIRST), roArm(REQ, 'not_movable')).value, null);
  assert.equal(judgeRuntimeSelection(arm(FIRST), roArm(REQ, 'applied', { requested: 'bigmodel-coding-plan/GLM-5.3-Air' })).value, null, '两支请求不同');
  // ②～⑤
  assert.equal(judgeRuntimeSelection(arm(REQ), roArm(REQ)).value, 'honored');
  assert.equal(judgeRuntimeSelection(arm(FIRST), roArm(REQ)).value, 'reorder_needed');
  assert.equal(judgeRuntimeSelection(arm('bigmodel-coding-plan/GLM-5.3-Air'), roArm(REQ)).value, 'reorder_needed', '第三个模型值落进 ③');
  assert.equal(judgeRuntimeSelection(arm(FIRST), roArm(FIRST)).value, 'reorder_ineffective');
  assert.equal(judgeRuntimeSelection(arm(REQ), roArm(FIRST)).value, null, '⑤ 冲突不收录');
  assert.equal(judgeRuntimeSelection(arm('uuid-p/GLM-5.3-Flash'), roArm(REQ)).value, 'honored', 'providerId 形态不同不算不同');
});

test('同形臂：doctor 的两支——原样支 variant 由臂自行合成，置首支 kind=applied（本机形态）', async () => {
  const L = await fakeLayout();
  const [asIs, moved] = await withEnv({ FAKE_RUNTIME_FALLBACK: '1' }, async () => [
    await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src }),
    await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, variant: 'requested-first' }),
  ]);
  assert.deepEqual(asIs.variant, { variant: 'as-is', applied: true, kind: 'applied' });
  assert.equal(moved.variant?.kind, 'applied');
  assert.equal(judgeRuntimeSelection(asIs, moved).value, 'reorder_needed', '本机形态（E2）');
});

}
