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
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  catalogFirstNote,
  describeRuntimeSelection,
  probeModelOverride,
  probeModelOverrideFullCopy,
  readRuntimeSelectedModel,
  reorderRequestedFirst,
} from '../../src/trivium/probes/zcode.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'trivium-runtimesel-test-'));
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
  assert.deepEqual(outcome, { variant: 'requested-first', applied: true });
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
  const cases: Array<[string, Cfg, string, string, RegExp]> = [
    ['无 provider', twoProviders(), 'nope', 'B', /没有 provider/],
    ['无成员', twoProviders(), 'bp', 'Z', /没有 id 为 Z/],
    ['只剩 deleted', { provider: { bp: { models: { a: {}, B: { deleted: true } } } } }, 'bp', 'B', /没有 id 为 B/],
    ['恒等', { provider: { bp: { models: { B: {}, A: {} } } } }, 'bp', 'B', /恒等/],
    ['整数样键名', { provider: { bp: { models: { '1': {}, '2': {} } } } }, 'bp', '2', /整数样键名/],
  ];
  for (const [name, cfg, pk, mid, why] of cases) {
    const { copy, outcome } = reorderRequestedFirst(cfg, pk, mid);
    assert.equal(outcome.applied, false, name);
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
  assert.deepEqual(r.variant, { variant: 'as-is', applied: true });
});

test('同形臂 requested-first：只挪顺序，运行期回落就落在请求模型上', async () => {
  const L = await fakeLayout();
  const r = await withEnv({ FAKE_RUNTIME_FALLBACK: '1' }, () =>
    probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: REQ, variant: 'requested-first' }));
  assert.equal(r.override, 'config_copy', r.why);
  assert.deepEqual(r.variant, { variant: 'requested-first', applied: true });
  assert.deepEqual(r.runtimeSelected, { cause: 'ok', model: REQ });
});

test('同形臂 requested-first 挪不动（请求本就在首位）⇒ applied:false 带原因，照常拉起', async () => {
  const L = await fakeLayout();
  const r = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'other/x', variant: 'requested-first' });
  assert.equal(r.variant?.applied, false);
  assert.match(r.variant?.reason ?? '', /恒等/);
  assert.equal(r.runtimeSelected?.cause, 'ok');
});

test('同形臂 requested-first 限定失败 ⇒ 不拉起，variant 带原因、运行期 not_launched', async () => {
  const L = await fakeLayout();
  const r = await probeModelOverrideFullCopy(L.entry, process.execPath, L.cwd, { cliConfigPath: L.src, model: 'nope/none', variant: 'requested-first' });
  assert.equal(r.override, null);
  assert.equal(r.variant?.applied, false);
  assert.match(r.variant?.reason ?? '', /限定失败/);
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
