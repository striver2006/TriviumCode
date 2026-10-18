/**
 * EV-202：预检探活一层兜住适配器抛出（`probeAuth` / `probeAuthAll`）。
 *
 * 此前构造、`fingerprint()`、`probe()` 任一抛出都会穿过 `Promise.all` 把整个预检崩成「内部错误」、退 1。
 * codex 指纹（三处读盘）与 agy 指纹（`agent.md`）都是先 `exists` 再读、没有 try：文件在而读不了就抛。
 *
 * G 系列用假适配器（只实现 `authProbe` 的两个方法）直接调 `probeAuth` / `probeAuthAll`，零配额。
 * 缓存条目一律摆成「若进了缓存判据就会命中」：版本一致、刚写入、指纹 null——
 * 这样「指纹读不了时不查缓存」才有对照（读不了若被折成 null，null 等于 null 就命中了）。
 *
 * R 系列用真实的 codex / agy 适配器摆读不了的文件，入口指到不存在的路径或置空：
 * codex 在副本准备那一步就落成失败、agy 在入口检查就返回，都到不了真实调用。
 * 摆锁守则同 `codex-auth-probe.test.ts`：权限格 root 下跳过；收尾在 finally 里按目录重新列、恢复权限再整删。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../../src/trivium/config.js';
import { probeAuth, probeAuthAll, type PreflightOptions } from '../../src/trivium/preflight.js';
import { codexAdapter } from '../../src/trivium/adapters/codex.js';
import { agyAdapter } from '../../src/trivium/adapters/agy.js';
import type { AdapterTable, CriticAdapter } from '../../src/trivium/adapters/base.js';
import type { Config, CriticId, Ctx } from '../../src/trivium/types.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

// WIN_FILE_SKIP（Windows 移植）：夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）');
} else {

const ROOT = process.getuid?.() === 0;
const tmp = (p: string) => fs.mkdtemp(path.join(os.tmpdir(), p));

const CREATED: string[] = [];
after(async () => {
  for (const d of CREATED) {
    await restorePerms(d);
    await fs.rm(d, { recursive: true, force: true });
  }
});

/** 递归把目录与文件权限放开（收尾用：只读锁会挡住整删）。按目录重新列，不依赖被测函数的返回值 */
async function restorePerms(p: string): Promise<void> {
  const st = await fs.lstat(p).catch(() => null);
  if (!st) return;
  if (st.isDirectory()) {
    await fs.chmod(p, 0o700).catch(() => {});
    for (const e of await fs.readdir(p).catch(() => [] as string[])) await restorePerms(path.join(p, e));
  } else if (st.isFile()) {
    await fs.chmod(p, 0o600).catch(() => {});
  }
}

function cfgWithVersions(): Config {
  const cfg = defaultConfig();
  for (const cli of Object.values(cfg.probe.cli)) if (cli) cli.version = '9.9.9';
  return cfg;
}

const ctxOf = (cfg: Config): Ctx => ({
  config: cfg,
  projectRoot: os.tmpdir(),
  archiveRoot: path.join(os.tmpdir(), 'unused-archive'),
  triviumDir: path.join(os.tmpdir(), 'unused-trivium'),
  sources: [],
});

/** 一条「若进了缓存判据就会命中」的缓存条目：版本一致、刚写入、指纹 null */
function seedNullCache(cfg: Config, critic: CriticId): void {
  cfg.probe.auth = {
    ...(cfg.probe.auth ?? {}),
    [critic]: { checked_at: new Date().toISOString(), cli_version: '9.9.9', fingerprint: null, ok: true },
  };
}

interface Fake {
  adapter: CriticAdapter;
  calls: { probe: number };
}

function fake(critic: CriticId, o: {
  fingerprint?: () => Promise<string | null>;
  probe?: () => Promise<{ ok: boolean; detail: string }>;
  construct?: () => never;
}): Fake {
  const calls = { probe: 0 };
  const adapter = {
    critic,
    authProbe() {
      if (o.construct) o.construct();
      return {
        fingerprint: o.fingerprint ?? (async () => 'fp-a'),
        async probe() {
          calls.probe += 1;
          return (o.probe ?? (async () => ({ ok: true, detail: '探活通过（1s）' })))();
        },
      };
    },
  } as unknown as CriticAdapter;
  return { adapter, calls };
}

const opts = (cfg: Config, extra: Partial<PreflightOptions> = {}): PreflightOptions =>
  ({ ctx: ctxOf(cfg), scope: 'plan', ...extra });

/** 在 TRIVIUM_DEBUG 已清除的环境里跑（宿主置位会把栈刷进测试输出） */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env['TRIVIUM_DEBUG'];
  delete process.env['TRIVIUM_DEBUG'];
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env['TRIVIUM_DEBUG'];
    else process.env['TRIVIUM_DEBUG'] = saved;
  }
}

const HOME = os.homedir();
const NOTE_TAIL = '，本次未用缓存、也不写缓存';

test('G1 正常路径不变：详情逐字等于 probe 详情，缓存记下本次指纹', async () => {
  const cfg = cfgWithVersions();
  const f = fake('codex', {});
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'codex', f.adapter, opts(cfg)));
  assert.equal(f.calls.probe, 1);
  assert.equal(o.result.ok, true);
  assert.equal(o.result.detail, '探活通过（1s）');
  assert.equal(o.cache?.fingerprint, 'fp-a');
  assert.equal(o.cache?.cli_version, '9.9.9');
});

test('G2 指纹抛错：不查缓存（本可命中）、照常探活、通过也不写缓存，详情末尾注明且家目录归一', async () => {
  const cfg = cfgWithVersions();
  seedNullCache(cfg, 'codex');
  const f = fake('codex', {
    fingerprint: async () => { throw new Error(`EACCES: permission denied, open '${HOME}/x'`); },
  });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'codex', f.adapter, opts(cfg)));
  assert.equal(f.calls.probe, 1, '读不了时不该命中缓存');
  assert.equal(o.result.ok, true, o.result.detail);
  assert.equal(o.cache, null, '指纹不可知，不写缓存');
  assert.equal(
    o.result.detail,
    `探活通过（1s）；⚠️ 指纹读不了：EACCES: permission denied, open '~/x'${NOTE_TAIL}`,
  );
  assert.ok(!o.result.detail.includes(HOME), o.result.detail);
});

test('G3 指纹抛错 + probe 失败：该侧失败 69，详情 = probe 详情 + 注明', async () => {
  const cfg = cfgWithVersions();
  seedNullCache(cfg, 'gemini');
  const f = fake('gemini', {
    fingerprint: async () => { throw new Error('EISDIR: illegal operation on a directory, read'); },
    probe: async () => ({ ok: false, detail: '探活失败（status=ERROR）' }),
  });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'gemini', f.adapter, opts(cfg)));
  assert.equal(f.calls.probe, 1);
  assert.equal(o.result.ok, false);
  assert.equal(o.result.exitCode, EXIT.ENV);
  assert.equal(o.result.detail, `探活失败（status=ERROR）；⚠️ 指纹读不了：EISDIR: illegal operation on a directory, read${NOTE_TAIL}`);
  assert.equal(o.cache, null);
});

test('G4 probe 抛错：不抛，该侧失败 69，详情「探活内部失败：原因」且家目录归一', async () => {
  const cfg = cfgWithVersions();
  const f = fake('codex', { probe: async () => { throw new Error(`boom ${HOME}/y`); } });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'codex', f.adapter, opts(cfg)));
  assert.equal(o.result.ok, false);
  assert.equal(o.result.exitCode, EXIT.ENV);
  assert.equal(o.result.detail, '探活内部失败：boom ~/y');
  assert.equal(o.cache, null);
});

test('G5 authProbe 构造抛错：同 G4 形状，probe 不调用', async () => {
  const cfg = cfgWithVersions();
  const f = fake('glm', { construct: () => { throw new Error('bad config'); } });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'glm', f.adapter, opts(cfg)));
  assert.equal(f.calls.probe, 0);
  assert.equal(o.result.ok, false);
  assert.equal(o.result.exitCode, EXIT.ENV);
  assert.equal(o.result.detail, '探活内部失败：bad config');
  assert.equal(o.result.name, 'ZCode 已认证');
  assert.equal(o.cache, null);
});

test('G6 probeAuthAll 两侧并行、一侧 probe 抛错：不抛，另一侧照常出结论并带缓存', async () => {
  const cfg = cfgWithVersions();
  const bad = fake('codex', { probe: async () => { throw new Error('boom'); } });
  const good = fake('glm', {});
  const table = { codex: bad.adapter, glm: good.adapter } as unknown as AdapterTable;
  const outs = await quiet(() => probeAuthAll(ctxOf(cfg), ['codex', 'glm'], table, opts(cfg)));
  assert.equal(outs.length, 2);
  const byId = Object.fromEntries(outs.map((x) => [x.critic, x]));
  assert.equal(byId['codex']!.result.ok, false);
  assert.equal(byId['codex']!.result.exitCode, EXIT.ENV);
  assert.equal(byId['codex']!.result.detail, '探活内部失败：boom');
  assert.equal(byId['glm']!.result.ok, true);
  assert.equal(byId['glm']!.result.detail, '探活通过（1s）');
  assert.notEqual(byId['glm']!.cache, null);
});

test('G7 指纹 null + 缓存指纹 null（现状一格）：照契约命中缓存、不探活——本题不改这条语义', async () => {
  const cfg = cfgWithVersions();
  seedNullCache(cfg, 'codex');
  const f = fake('codex', { fingerprint: async () => null });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'codex', f.adapter, opts(cfg)));
  assert.equal(f.calls.probe, 0);
  assert.equal(o.result.ok, true);
  assert.ok(o.result.detail.startsWith('缓存有效（'), o.result.detail);
  assert.equal(o.cache, null);
});

test('G8 refreshAuth + 指纹抛错：照常探活、注明照接、不写缓存', async () => {
  const cfg = cfgWithVersions();
  const f = fake('codex', { fingerprint: async () => { throw new Error('gone'); } });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'codex', f.adapter, opts(cfg, { refreshAuth: true })));
  assert.equal(f.calls.probe, 1);
  assert.equal(o.result.ok, true);
  assert.equal(o.result.detail, `探活通过（1s）；⚠️ 指纹读不了：gone${NOTE_TAIL}`);
  assert.equal(o.cache, null);
});

test('G9 指纹抛 + probe 也抛：内部失败在前、指纹注明在后，逐字', async () => {
  const cfg = cfgWithVersions();
  const f = fake('codex', {
    fingerprint: async () => { throw new Error(`fp ${HOME}/a`); },
    probe: async () => { throw new Error(`boom ${HOME}/b`); },
  });
  const o = await quiet(() => probeAuth(ctxOf(cfg), 'codex', f.adapter, opts(cfg)));
  assert.equal(o.result.ok, false);
  assert.equal(o.result.exitCode, EXIT.ENV);
  assert.equal(o.result.detail, `探活内部失败：boom ~/b；⚠️ 指纹读不了：fp ~/a${NOTE_TAIL}`);
  assert.equal(o.cache, null);
});

// ─────────────── R 系列：真实适配器 ───────────────

const CONFIG_TOML = `model = "fake-model"\nmodel_provider = "fake"\n\n[model_providers.fake]\nname = "fake"\nbase_url = "https://example.invalid/v1"\n`;

/** 钉住 HOME / CODEX_HOME / TMPDIR 跑一次，结束复原环境、恢复权限、整删本格目录 */
async function pinned<T>(env: Record<string, string>, dirs: string[], fn: () => Promise<T>): Promise<T> {
  const keys = ['HOME', 'CODEX_HOME', 'TMPDIR', 'TRIVIUM_DEBUG'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env['TRIVIUM_DEBUG'];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of dirs) {
      await restorePerms(d);
      await fs.rm(d, { recursive: true, force: true });
    }
  }
}

async function codexWorld(lock: 'configDir' | 'authUnreadable') {
  const home = await tmp('trivium-fpg-home-');
  const priv = await tmp('trivium-fpg-priv-');
  CREATED.push(home, priv);
  const src = path.join(home, '.codex');
  await fs.mkdir(src, { recursive: true });
  if (lock === 'configDir') await fs.mkdir(path.join(src, 'config.toml'));
  else await fs.writeFile(path.join(src, 'config.toml'), CONFIG_TOML, { mode: 0o600 });
  await fs.writeFile(path.join(src, 'qwen.config.toml'), 'model = "fake-model-2"\n', { mode: 0o600 });
  await fs.writeFile(path.join(src, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fake' }), { mode: 0o600 });
  if (lock === 'authUnreadable') await fs.chmod(path.join(src, 'auth.json'), 0o000);
  const cfg = cfgWithVersions();
  cfg.probe.cli.codex!.probed_at = new Date().toISOString();
  // 不存在的入口：即便副本准备意外通过，拉起也只会落成失败，不会真调 codex
  cfg.probe.cli.codex!.entrypoint = path.join(home, 'no-such-codex');
  cfg.probe.cli.codex!.readonly_flags = ['-s', 'read-only'];
  return { home, priv, src, cfg };
}

test('R1 codex 真实适配器：基底 config.toml 是目录（EISDIR）——预检不崩，副本准备失败 + 指纹注明', async () => {
  const w = await codexWorld('configDir');
  const o = await pinned({ HOME: w.home, CODEX_HOME: w.src, TMPDIR: w.priv }, [w.priv], () =>
    probeAuth(ctxOf(w.cfg), 'codex', codexAdapter, opts(w.cfg)));
  assert.equal(o.result.ok, false);
  assert.equal(o.result.exitCode, EXIT.ENV);
  assert.ok(o.result.detail.startsWith('准备 codex 隔离副本失败'), o.result.detail);
  assert.match(o.result.detail, /；⚠️ 指纹读不了：EISDIR[^；]*，本次未用缓存、也不写缓存$/);
  assert.equal(o.cache, null);
});

test('R2 codex 真实适配器：auth.json 不可读（EACCES）——预检不崩，家目录归一', { skip: ROOT }, async () => {
  const w = await codexWorld('authUnreadable');
  const o = await pinned({ HOME: w.home, CODEX_HOME: w.src, TMPDIR: w.priv }, [w.priv], () =>
    probeAuth(ctxOf(w.cfg), 'codex', codexAdapter, opts(w.cfg)));
  assert.equal(o.result.ok, false);
  assert.ok(o.result.detail.startsWith('准备 codex 隔离副本失败'), o.result.detail);
  assert.match(o.result.detail, /；⚠️ 指纹读不了：EACCES[^；]*~\/\.codex\/auth\.json[^；]*，本次未用缓存、也不写缓存$/);
  assert.ok(!o.result.detail.includes(w.home), o.result.detail);
  assert.equal(o.cache, null);
});

test('R3 agy 真实适配器：agent.md 不可读（EACCES）——预检不崩，入口未记录 + 指纹注明', { skip: ROOT }, async () => {
  const home = await tmp('trivium-fpg-agyhome-');
  CREATED.push(home);
  const dir = path.join(home, '.gemini/config/agents/trivium-critic');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'agent.md'), '---\nname: trivium-critic\n---\n', { mode: 0o600 });
  await fs.chmod(path.join(dir, 'agent.md'), 0o000);
  const cfg = cfgWithVersions();
  cfg.probe.cli.agy!.entrypoint = null; // 入口检查即返回，到不了真实调用
  const o = await pinned({ HOME: home }, [], () => probeAuth(ctxOf(cfg), 'gemini', agyAdapter, opts(cfg)));
  assert.equal(o.result.ok, false);
  assert.equal(o.result.exitCode, EXIT.ENV);
  assert.match(
    o.result.detail,
    /^agy 路径未记录；⚠️ 指纹读不了：EACCES[^；]*~\/\.gemini\/config\/agents\/trivium-critic\/agent\.md[^；]*，本次未用缓存、也不写缓存$/,
  );
  assert.ok(!o.result.detail.includes(home), o.result.detail);
  assert.equal(o.cache, null);
});

}
