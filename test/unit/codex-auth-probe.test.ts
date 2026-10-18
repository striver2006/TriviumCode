/**
 * EV-200：codex 认证探活的临时目录删除收尾与副本准备失败。
 *
 * 此前 `probe()` 的结果在 try 里直接 return、finally 裸删：删不掉（ENOTEMPTY / EBUSY / EACCES）就顶替探活结果，
 * 穿过无兜底的 `probeAuth` 把预检崩成内部错误，含真实凭据的副本（`codexhome/` 下的 auth.json 与 toml）留在系统临时目录。
 * 副本准备本身抛错同样穿透。
 *
 * 用例用假入口（一个可执行的 node 脚本）替身 codex，零配额：`invokeCodex` 只拉起 bin、经 `CODEX_HOME` 与 `HOME` 指向副本。
 * 合成源目录钉在 mkdtemp 的假家目录下（`CODEX_HOME` 指过去），三份载体全是假值；`TMPDIR` 钉到本格私有根，残留落在里面。
 *
 * 摆锁守则（同 EV-197 / EV-198）：涉及权限的格 root 下跳过；假入口摆不出现场就退 3，让用例红而不是静默通过；
 * 锁的是凭据所在的 `codexhome/`，只有副本已全删的那格才锁兄弟目录（递归删除的先后顺序不定，EV-197 踩过）。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../../src/trivium/config.js';
import { codexAdapter, codexTempDirResidueText } from '../../src/trivium/adapters/codex.js';
import { codexCredentialCopies, isCredentialCarrier, prepareCodexHome } from '../../src/trivium/adapters/codex-home.js';
import { tryRemoveTempDir } from '../../src/trivium/util/fsx.js';

// WIN_FILE_SKIP（Windows 移植）：断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物');
} else {

const tmp = (p: string) => fs.mkdtemp(path.join(os.tmpdir(), p));
const ROOT = process.getuid?.() === 0;

/** 各格的 world 目录（假入口、假家目录）在文件结束时整删，不在系统临时目录里堆积（EV-198 代码双审后补的同类收尾） */
const CREATED: string[] = [];
after(async () => {
  for (const d of CREATED) await fs.rm(d, { recursive: true, force: true });
});

/*
 * 假入口。先写观测文件、再按 FAKE_LOCK 摆现场：
 *   codexhome   ：`$CODEX_HOME` 改 0o500——里面的凭据副本 unlink 不掉，三个位置仍可 stat
 *   keep:<名>   ：删掉另两份凭据副本，再同上锁 `$CODEX_HOME`（留下的那份必然在场）
 *   gone        ：删掉全部凭据副本，在临时根下建 locked/、放文件 f、再改 0o500（空的只读目录锁不住）
 *   unreadable  ：`$CODEX_HOME` 改 0o000（查不了）
 * FAKE_EXIT=1 时输出一条顶层 error 事件后退 1；否则输出一轮完整的成功事件流。
 * 脚本里那份 isCarrier 是生产 `isCredentialCarrier` 的手抄（子进程里引不到它），只用于摆现场与「三份齐全」的自检，
 * 摆不出即退 3；口径对账由 C7 用生产谓词做（代码双审 CODEX-01）。
 */
const ENTRY = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
try { fs.readFileSync(0); } catch {}
const env = process.env;
const ch = env.CODEX_HOME;
fs.writeFileSync(env.FAKE_OBSERVE, JSON.stringify({ codexHome: ch ?? null, home: env.HOME ?? null }));
const isCarrier = (n) => n === 'config.toml' || n.endsWith('.config.toml') || n === 'auth.json';
const fail = (m) => { process.stderr.write('FAKE_LOCK：' + m + '\\n'); process.exit(3); };
const lock = env.FAKE_LOCK;
if (lock) {
  if (!ch || !fs.existsSync(ch)) fail('拿不到 CODEX_HOME');
  const carriers = fs.readdirSync(ch).filter(isCarrier);
  if (carriers.length !== 3) fail('副本里的凭据载体不是三份：' + carriers.join(','));
  if (lock === 'codexhome') {
    fs.chmodSync(ch, 0o500);
  } else if (lock.startsWith('keep:')) {
    const keep = lock.slice(5);
    if (!carriers.includes(keep)) fail('要留的那份不在：' + keep);
    for (const n of carriers) if (n !== keep) fs.unlinkSync(path.join(ch, n));
    fs.chmodSync(ch, 0o500);
  } else if (lock === 'gone') {
    for (const n of carriers) fs.unlinkSync(path.join(ch, n));
    const locked = path.join(path.dirname(ch), 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'f'), 'x');
    fs.chmodSync(locked, 0o500);
    if (fs.readdirSync(ch).some(isCarrier) || !fs.existsSync(path.join(locked, 'f'))) fail('gone 摆不出');
  } else if (lock === 'unreadable') {
    fs.chmodSync(ch, 0o000);
  } else {
    fail('未知摆法 ' + lock);
  }
}
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
if (env.FAKE_EXIT === '1') { emit({ type: 'error', message: 'fake auth failure' }); process.exit(1); }
emit({ type: 'thread.started', thread_id: 'fake-thread' });
emit({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'OK' } });
emit({ type: 'turn.completed', usage: {} });
process.exit(0);
`;

// 凭据键分段拼接：完整形态的凭据字面量会被 contract/fixture-credentials 拦下（夹具一律运行时拼接）
const BEARER_KEY = ['experimental_bearer', '_token'].join('');
const CONFIG_TOML = `model = "fake-model"
model_provider = "fake"
notify = ["/bin/true"]

[model_providers.fake]
name = "fake"
base_url = "https://example.invalid/v1"
${BEARER_KEY} = "fake-bearer-value"
`;
const PROFILE_TOML = `model = "fake-model-2"\nmodel_provider = "fake"\n`;
const AUTH_JSON = JSON.stringify({ OPENAI_API_KEY: 'fake-api-key' });

async function world(opts: { configTomlAsDir?: boolean } = {}) {
  const root = await tmp('trivium-cauth-root-');
  const entry = path.join(root, 'bin/codex');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, ENTRY, { mode: 0o755 });

  const home = await tmp('trivium-cauth-home-');
  CREATED.push(root, home);
  const src = path.join(home, '.codex');
  await fs.mkdir(src, { recursive: true });
  if (opts.configTomlAsDir) await fs.mkdir(path.join(src, 'config.toml'));
  else await fs.writeFile(path.join(src, 'config.toml'), CONFIG_TOML, { mode: 0o600 });
  // 缺省档 codex profile 是 qwen（config.ts 的 agents.codex.profile）
  await fs.writeFile(path.join(src, 'qwen.config.toml'), PROFILE_TOML, { mode: 0o600 });
  await fs.writeFile(path.join(src, 'auth.json'), AUTH_JSON, { mode: 0o600 });

  const cfg = defaultConfig();
  cfg.probe.cli.codex!.probed_at = new Date().toISOString();
  cfg.probe.cli.codex!.entrypoint = entry;
  cfg.probe.cli.codex!.readonly_flags = ['-s', 'read-only'];
  return { root, home, src, cfg, observe: path.join(root, 'observe.json') };
}

const ctxOf = (cfg: ReturnType<typeof defaultConfig>) => ({ cfg, nodePath: process.execPath });

/**
 * 钉住 HOME / CODEX_HOME / TMPDIR 与假入口的旗标跑一次探活。期望的残留提示在钉住的环境里算（家目录归一用当时的 HOME）。
 * 结束恢复 `codexhome/` 与 `locked/` 的权限、整删私有根。
 */
async function probeIn(w: Awaited<ReturnType<typeof world>>, fake: { lock?: string; exit?: 0 | 1 } = {}) {
  const priv = await tmp('trivium-cauth-priv-');
  const keys = ['HOME', 'CODEX_HOME', 'TMPDIR', 'FAKE_OBSERVE', 'FAKE_LOCK', 'FAKE_EXIT'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env['HOME'] = w.home;
  process.env['CODEX_HOME'] = w.src;
  process.env['TMPDIR'] = priv;
  process.env['FAKE_OBSERVE'] = w.observe;
  if (fake.lock) process.env['FAKE_LOCK'] = fake.lock;
  else delete process.env['FAKE_LOCK'];
  process.env['FAKE_EXIT'] = String(fake.exit ?? 0);
  try {
    const r = await codexAdapter.authProbe!(ctxOf(w.cfg), w.root).probe();
    const left = (await fs.readdir(priv)).filter((e) => e.startsWith('trivium-codex-auth-'));
    const dir = path.join(priv, left[0] ?? '?');
    const want = { copies: codexTempDirResidueText(dir, 'EACCES', true), none: codexTempDirResidueText(dir, 'EACCES', false) };
    const homeAbs = w.home;
    return { r, left, want, homeAbs };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    /*
     * 残留目录名在这里重新读：probe() 抛出时（如变异退回裸删）上面的 left 还没算，
     * 不恢复权限私有根就删不掉、留在系统临时目录（本题变异预跑实遇）。
     */
    const all = await fs.readdir(priv).catch(() => [] as string[]);
    for (const d of all) {
      for (const sub of ['codexhome', 'locked']) await fs.chmod(path.join(priv, d, sub), 0o700).catch(() => {});
    }
    await fs.rm(priv, { recursive: true, force: true });
  }
}

const observed = (w: Awaited<ReturnType<typeof world>>) => fs.stat(w.observe).then(() => true, () => false);

test('C1 探活通过 + 凭据副本删不掉：不抛、结论仍通过、详情末尾说「含真实凭据」', { skip: ROOT }, async () => {
  const w = await world();
  const { r, left, want } = await probeIn(w, { lock: 'codexhome' });
  assert.equal(left.length, 1, '本格就是要摆出删不掉：私有根下应恰有一个残留');
  assert.equal(r.ok, true, r.detail);
  assert.ok(r.detail.startsWith('探活通过（'), r.detail);
  // 字面断言，不只比函数输出
  assert.match(r.detail, /；⚠️ 探活临时目录删除失败（EACCES）：.+ 仍在，其中的 codexhome 凭据副本（auth\.json 与 toml）含真实凭据，请手工删除$/);
  assert.ok(r.detail.endsWith(`；${want.copies}`), r.detail);
});

test('C2 探活失败 + 凭据副本删不掉：不抛、结论仍失败、详情末尾同样说「含真实凭据」', { skip: ROOT }, async () => {
  const w = await world();
  const { r, left, want } = await probeIn(w, { lock: 'codexhome', exit: 1 });
  assert.equal(left.length, 1);
  assert.equal(r.ok, false);
  // 摆锁失败时入口退 3、详情是 FAKE_LOCK 的 stderr；以 CLI 的错误事件开头才说明走的是本格的失败支
  assert.ok(r.detail.startsWith('探活失败：fake auth failure。'), r.detail);
  assert.ok(r.detail.endsWith(`；${want.copies}`), r.detail);
});

test('C3 目录删不掉而凭据副本已都不在：说「没有凭据副本」，不说「含真实凭据」', { skip: ROOT }, async () => {
  const w = await world();
  const { r, left, want } = await probeIn(w, { lock: 'gone' });
  assert.equal(left.length, 1);
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /其中没有凭据副本，剩下的是本次探活的临时文件，请手工删除$/);
  assert.doesNotMatch(r.detail, /含真实凭据/);
  assert.ok(r.detail.endsWith(`；${want.none}`), r.detail);
});

test('C3b 三份凭据副本只留任何一份：都说「含真实凭据」——现场查的是三个位置', { skip: ROOT }, async () => {
  for (const keep of ['config.toml', 'qwen.config.toml', 'auth.json']) {
    const w = await world();
    const { r, left, want } = await probeIn(w, { lock: `keep:${keep}` });
    assert.equal(left.length, 1, keep);
    assert.equal(r.ok, true, `${keep}：${r.detail}`);
    assert.ok(r.detail.endsWith(`；${want.copies}`), `只留 ${keep}：${r.detail}`);
  }
});

test('C4 凭据目录查不了：按在说「含真实凭据」', { skip: ROOT }, async () => {
  const w = await world();
  const { r, left, want } = await probeIn(w, { lock: 'unreadable' });
  assert.equal(left.length, 1);
  assert.equal(r.ok, true, r.detail);
  assert.ok(r.detail.endsWith(`；${want.copies}`), r.detail);
});

test('C5a 副本准备失败（源 config.toml 是个目录）：落成可读的失败、写明哪一步，不拉起 CLI、不留残留', async () => {
  const w = await world({ configTomlAsDir: true });
  const { r, left } = await probeIn(w);
  assert.equal(r.ok, false);
  assert.match(r.detail, /^准备 codex 隔离副本失败（裁剪 config\.toml）：EISDIR/);
  assert.equal(await observed(w), false, '副本没备好就不该拉起 CLI');
  assert.equal(left.length, 0, '准备失败也要删掉临时目录');
});

test('C5b 副本准备失败（源 auth.json 读不了）：写明哪一步，家目录归一成 ~', { skip: ROOT }, async () => {
  const w = await world();
  const auth = path.join(w.src, 'auth.json');
  await fs.chmod(auth, 0o000);
  try {
    const { r, left, homeAbs } = await probeIn(w);
    assert.equal(r.ok, false);
    assert.match(r.detail, /^准备 codex 隔离副本失败（拷入 auth\.json）：EACCES/);
    assert.ok(r.detail.includes('~/.codex/auth.json'), r.detail);
    assert.ok(!r.detail.includes(homeAbs), `详情不得带出家目录绝对路径：${r.detail}`);
    assert.equal(await observed(w), false);
    assert.equal(left.length, 0);
  } finally {
    await fs.chmod(auth, 0o600);
  }
});

test('C6 删除成功：两句详情与改动前逐字节相同，不接任何提示', async () => {
  const w = await world();
  const ok = await probeIn(w);
  assert.equal(ok.r.ok, true, ok.r.detail);
  // 时长 N 是唯一变量；锚到结尾，同时证明没有接残留后缀
  assert.match(ok.r.detail, /^探活通过（\d+s）$/);
  assert.equal(ok.left.length, 0);

  const w2 = await world();
  const bad = await probeIn(w2, { exit: 1 });
  assert.equal(bad.r.ok, false);
  assert.equal(bad.r.detail, '探活失败：fake auth failure。\n  请确认 profile「qwen」对应的 provider 凭据可用。');
  assert.equal(bad.left.length, 0);
});

test('C7 codexCredentialCopies 与 prepareCodexHome 的写入面一致', async () => {
  for (const profile of ['qwen', null]) {
    const w = await world();
    const run = await tmp('trivium-cauth-prep-');
    try {
      const prep = await prepareCodexHome(run, { profile, projectRoot: w.root, sourceHome: w.src });
      // 口径单源（代码双审 CODEX-01）：写入面按生产谓词过滤，清单里的每个名字也必须被它认作载体
      const written = (await fs.readdir(prep.codexHome)).filter(isCredentialCarrier).sort();
      const listed = codexCredentialCopies(prep.codexHome, profile).map((p) => path.basename(p)).sort();
      assert.deepEqual(written, listed, `profile=${profile}`);
      for (const n of listed) assert.ok(isCredentialCarrier(n), `${n} 不被 isCredentialCarrier 认作载体`);
      for (const p of codexCredentialCopies(prep.codexHome, profile)) assert.equal(path.dirname(p), prep.codexHome);
    } finally {
      await fs.rm(run, { recursive: true, force: true });
    }
  }
});

test('C8 残留提示两档字面；两档都把家目录归一成 ~', () => {
  const dir = '/x/trivium-codex-auth-x';
  assert.equal(
    codexTempDirResidueText(dir, 'EBUSY', true),
    '⚠️ 探活临时目录删除失败（EBUSY）：/x/trivium-codex-auth-x 仍在，其中的 codexhome 凭据副本（auth.json 与 toml）含真实凭据，请手工删除',
  );
  assert.equal(
    codexTempDirResidueText(dir, 'EBUSY', false),
    '⚠️ 探活临时目录删除失败（EBUSY）：/x/trivium-codex-auth-x 仍在，其中没有凭据副本，剩下的是本次探活的临时文件，请手工删除',
  );
  const underHome = path.join(os.homedir(), 'tmp/d');
  for (const has of [true, false]) {
    const t = codexTempDirResidueText(underHome, 'EACCES', has);
    assert.ok(t.includes(`~${path.sep}tmp${path.sep}d`), t);
    assert.ok(!t.includes(os.homedir()), t);
  }
});

test('F1 tryRemoveTempDir：删成功返回 null；失败时 ENOENT 不算在、在的算在；不给位置就不查', async () => {
  const ok = await tmp('trivium-cauth-f1-');
  await fs.writeFile(path.join(ok, 'a'), 'x');
  assert.equal(await tryRemoveTempDir(ok, [path.join(ok, 'a')]), null);
  assert.equal(await fs.stat(ok).then(() => true, () => false), false);
  if (ROOT) return;

  const d = await tmp('trivium-cauth-f1-');
  const sub = path.join(d, 'sub');
  await fs.mkdir(sub);
  await fs.writeFile(path.join(sub, 'f'), 'x');
  await fs.chmod(sub, 0o500);
  try {
    const left = await tryRemoveTempDir(d, [path.join(sub, 'f'), path.join(d, 'nope')]);
    assert.ok(left, '摆的是删不掉的目录');
    assert.equal(left.code, 'EACCES');
    assert.deepEqual(left.remaining, [path.join(sub, 'f')]);
    const none = await tryRemoveTempDir(d, []);
    assert.ok(none);
    assert.deepEqual(none.remaining, []);
  } finally {
    await fs.chmod(sub, 0o700);
    await fs.rm(d, { recursive: true, force: true });
  }
});

}
