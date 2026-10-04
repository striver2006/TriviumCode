/**
 * EV-199：探针夹具与 codex 隔离探针的临时目录删除收尾。
 *
 * 此前两个夹具工厂的 `cleanup` 与 `probeCodexIsolation` 的 finally 都是裸 `fs.rm({ recursive: true, force: true })`，
 * `force` 只吞 ENOENT：ENOTEMPTY / EBUSY / EACCES 从各侧探针的外层 finally 抛出、顶替探针返回值，穿过 `runDoctor`，
 * 本轮已探的结论在 checkpoint 前丢失，doctor 崩成「内部错误」。现在删不掉不抛、提示进该侧 notes，结论不变。
 *
 * 四组，全部零配额：
 *   F：两个夹具工厂直测（只用本机 git 建仓）；
 *   I：`probeCodexIsolation` 直测，假入口替身 `codex debug models`；
 *   E：四个探针函数经假入口（zcode 经 `invoke` 注入口）端到端跑到外层 finally——五处调用点与隔离探针的接线
 *      都在这里被行为级地咬住（计划双审 r1 CODEX-01：r1 以为「要拉真实 CLI 才走得到 finally」，与仓库事实相反）；
 *   W：源码结构断言作补充——论域从 `src/trivium/probes/` 派生（CODEX-03），清零守卫按括号配平截取实参（GLM-01）。
 *
 * 摆锁法（E / I 组通用）：假入口被调到时扫 `$TMPDIR`（钉到本格私有根）下名字以 `FAKE_LOCK` 所列前缀开头、
 * 还没有 `locked/` 的目录，在里面建 `locked/`、放文件 `f`、改 0o500（空的只读目录锁不住）。不靠 cwd 找夹具：
 * claude 的主夹具与记忆夹具先后存在，各自活着时被调到就各自上锁。开了锁却一个也没锁到就退 3，用例据此红。
 * 涉及权限的格 root 下跳过；收尾在 finally 里**重新列** `$TMPDIR` 恢复权限再整删私有根
 * （EV-200 变异预跑踩过：被测函数抛出时，依赖它返回后才算的变量收不了尾）。
 *
 * 覆盖边界（计划双审 r1 CODEX-06）：摆锁拿到的都是 EACCES，而 `fs.rm` 的 `maxRetries` 只对
 * EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM 重试——这些用例测到的是「不抛 + 提示带错误码」，不是「重试三次」。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { REPO_ROOT } from '../helpers/fixture.js';
import { countRecursiveRm, tsFiles } from '../helpers/recursive-rm.js';
import { createFixture, createMemoryFixture, fixtureResidueText } from '../../src/trivium/probes/fixture.js';
import { codexIsolationResidueText, probeCodex, probeCodexIsolation } from '../../src/trivium/probes/codex.js';
import { probeClaude } from '../../src/trivium/probes/claude.js';
import { probeAgy } from '../../src/trivium/probes/agy.js';
import { probeZcode } from '../../src/trivium/probes/zcode.js';
import { ZCODE_BUILTIN_PROVIDER_ENV, type ZcodeInvokeOptions, type ZcodeInvokeOutcome } from '../../src/trivium/adapters/zcode.js';

/** 模块加载时的系统临时目录：各格的私有根建在它下面，用例里的 `os.tmpdir()` 则被钉到私有根下的 `home/tmp` */
const SYSTEM_TMP = os.tmpdir();
const ROOT = process.getuid?.() === 0;
const FIXTURE_PREFIX = 'trivium-probe-';
const MEM_PREFIX = 'trivium-probe-mem-';
const ISO_PREFIX = 'trivium-codexhome-';

/**
 * 各格的私有根：文件结束时兜底整删（每格自己的 finally 已删，这里只防中途崩）。
 * 删不掉就打出来、不吞（代码双审 r1 CODEX-05）：静默漏出的残留正是系统临时目录里那批堆积的成因形态。
 */
const CREATED: string[] = [];
after(async () => {
  for (const d of CREATED) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 3 }).catch((e: unknown) => {
      console.warn(`probe-fixture-cleanup：私有根没删掉，请手工删除 ${d}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
    });
  }
});

interface World {
  base: string;
  home: string;
  /** 钉成 TMPDIR 的目录，在假家目录下——家目录归一能测出 `~/tmp/…` */
  tmp: string;
  bin: string;
}

async function world(): Promise<World> {
  const base = await fs.mkdtemp(path.join(SYSTEM_TMP, 'trivium-pfc-'));
  CREATED.push(base);
  const home = path.join(base, 'home');
  const tmp = path.join(home, 'tmp');
  const bin = path.join(base, 'bin');
  await fs.mkdir(tmp, { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  return { base, home, tmp, bin };
}

/**
 * 钉住 HOME / TMPDIR 与额外环境变量跑 fn；结束还原环境、**重新列** TMPDIR 把 `locked/` 恢复成 0o700，再整删私有根。
 * 期望的提示要在 fn 里算（家目录归一用当时的 HOME）。
 */
async function inWorld<T>(w: World, extra: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const keys = ['HOME', 'TMPDIR', ...Object.keys(extra)];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env['HOME'] = w.home;
  process.env['TMPDIR'] = w.tmp;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const all = await fs.readdir(w.tmp).catch(() => [] as string[]);
    for (const d of all) await fs.chmod(path.join(w.tmp, d, 'locked'), 0o700).catch(() => {});
    // 删不掉就抛、让本格红（看得见）；after 钩子再兜一次并打出路径
    await fs.rm(w.base, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** TMPDIR 下以 prefix 开头的条目（记忆夹具也以 `trivium-probe-` 开头，主夹具要排掉它） */
async function left(w: World, prefix: string, exclude?: string): Promise<string[]> {
  const all = await fs.readdir(w.tmp);
  const out: string[] = [];
  for (const e of all) {
    if (e.startsWith(prefix) && !(exclude && e.startsWith(exclude))) out.push(path.join(w.tmp, e));
  }
  return out;
}

/** 在目录下摆一个删不掉的只读子目录（里面先放文件，空的只读目录锁不住） */
async function lockDir(dir: string): Promise<void> {
  const locked = path.join(dir, 'locked');
  await fs.mkdir(locked);
  await fs.writeFile(path.join(locked, 'f'), 'x');
  await fs.chmod(locked, 0o500);
}

const residueNotes = (notes: readonly string[]): string[] => notes.filter((n) => n.includes('删除失败'));

/** 假入口里的摆锁函数（子进程里引不到测试代码，以源码串注入；与上面的 lockDir 同一摆法） */
const LOCK_JS = `
function lockUnder(prefixes) {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const tmp = os.tmpdir();
  let n = 0;
  for (const e of fs.readdirSync(tmp)) {
    if (!prefixes.some(function (p) { return e.startsWith(p); })) continue;
    const locked = path.join(tmp, e, 'locked');
    if (!fs.existsSync(locked)) {
      fs.mkdirSync(locked);
      fs.writeFileSync(path.join(locked, 'f'), 'x');
      fs.chmodSync(locked, 0o500);
    }
    n++;
  }
  if (n === 0) { process.stderr.write('FAKE_LOCK：没锁到任何目录（' + prefixes.join(',') + '）\\n'); process.exit(3); }
}
const LOCK = process.env.FAKE_LOCK ? process.env.FAKE_LOCK.split(',') : null;
`;

async function writeEntry(w: World, name: string, body: string): Promise<string> {
  const p = path.join(w.bin, name);
  await fs.writeFile(p, `#!${process.execPath}\n${LOCK_JS}\n${body}`, { mode: 0o755 });
  return p;
}

// ─────────────────────────── F：夹具工厂直测 ───────────────────────────

const MAIN_RE =
  /^⚠️ 探针夹具删除失败（EACCES）：~\/tmp\/trivium-probe-[^/]+ 仍在，其中剩下的只会是探针写的夹具文件（哨兵、虚构的对方审查件与假 \.env）与本次探测的临时文件，探针没有往里放真实凭据，请手工删除$/;
const MEM_RE =
  /^⚠️ 探针夹具删除失败（EACCES）：~\/tmp\/trivium-probe-mem-[^/]+ 仍在，其中剩下的只会是探针写的夹具文件（哨兵与项目记忆 CLAUDE\.md）与本次探测的临时文件，探针没有往里放真实凭据，请手工删除$/;

test('F1 主夹具删成功：cleanup 返回 null、根目录不在', async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const fx = await createFixture();
    assert.ok(path.basename(fx.root).startsWith(FIXTURE_PREFIX));
    assert.equal(await fx.cleanup(), null);
    await assert.rejects(fs.stat(fx.root), { code: 'ENOENT' });
  });
});

test('F2 主夹具删不掉：不抛、返回整句提示（家目录归一 ~）、根目录仍在', { skip: ROOT }, async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const fx = await createFixture();
    await lockDir(fx.root);
    const text = await fx.cleanup();
    assert.ok(text !== null, '删不掉时应返回提示');
    assert.match(text, MAIN_RE);
    assert.equal(text, fixtureResidueText('main', fx.root, 'EACCES'));
    await fs.stat(fx.root);
  });
});

test('F3 记忆夹具删不掉：内容说明是记忆夹具那一句、不提 .env', { skip: ROOT }, async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const fx = await createMemoryFixture();
    assert.ok(path.basename(fx.root).startsWith(MEM_PREFIX));
    await lockDir(fx.root);
    const text = await fx.cleanup();
    assert.ok(text !== null);
    assert.match(text, MEM_RE);
    assert.doesNotMatch(text, /\.env/, '记忆夹具里没有 .env');
    assert.equal(text, fixtureResidueText('memory', fx.root, 'EACCES'));
  });
});

test('F4 记忆夹具删成功：cleanup 返回 null、根目录不在', async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const fx = await createMemoryFixture();
    assert.equal(await fx.cleanup(), null);
    await assert.rejects(fs.stat(fx.root), { code: 'ENOENT' });
  });
});

test('F5 删不掉之后恢复权限再 cleanup 一次：返回 null、收干净（幂等）', { skip: ROOT }, async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const fx = await createFixture();
    await lockDir(fx.root);
    assert.notEqual(await fx.cleanup(), null);
    await fs.chmod(path.join(fx.root, 'locked'), 0o700);
    assert.equal(await fx.cleanup(), null);
    await assert.rejects(fs.stat(fx.root), { code: 'ENOENT' });
  });
});

// ─────────────────────── I：codex 隔离探针直测 ───────────────────────

/**
 * 假 codex。`debug models` 时：`CODEX_HOME` 含隔离前缀即对照那次（记 iso、按 FAKE_LOCK 摆锁、退 FAKE_ISO_EXIT），
 * 否则是基线（记 base、退 FAKE_BASE_EXIT，退 0 时吐一份可解析的模型目录）。`--version` 答版本；带 `--help` 的答用法；
 * 其余（exec 一类）按 FAKE_LOCK 摆锁后退 1——停在模型层之前，零配额。
 */
const CODEX_BODY = `
const fs = require('node:fs');
const argv = process.argv.slice(2);
const env = process.env;
if (argv[0] === '--version') { process.stdout.write('codex-cli 0.160.0\\n'); process.exit(0); }
if (argv[0] === 'debug' && argv[1] === 'models') {
  const iso = (env.CODEX_HOME || '').includes('${ISO_PREFIX}');
  if (env.FAKE_OBSERVE) fs.appendFileSync(env.FAKE_OBSERVE, (iso ? 'iso' : 'base') + '\\n');
  if (iso) {
    if (LOCK) lockUnder(LOCK);
    process.exit(Number(env.FAKE_ISO_EXIT || '1'));
  }
  const code = Number(env.FAKE_BASE_EXIT || '0');
  if (code === 0) process.stdout.write(JSON.stringify({ models: [{ slug: 'fake-model', visibility: 'list' }] }));
  process.exit(code);
}
if (argv.includes('--help')) { process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n'); process.exit(0); }
if (LOCK) lockUnder(LOCK);
// 吐一段最小 header：probeCodexHeader 的 50ms 轮询只在见到 header 时清掉，不吐就要等它 31 秒的兜底（既有行为，本题不改）
process.stderr.write('model: fake-model\\n--------\\nfake codex: refused\\n');
process.exit(1);
`;

async function isoIn(w: World, env: { base?: string; iso?: string; lock?: boolean }) {
  const entry = await writeEntry(w, 'codex', CODEX_BODY);
  const observe = path.join(w.base, 'observe.txt');
  return inWorld(
    w,
    {
      FAKE_OBSERVE: observe,
      FAKE_BASE_EXIT: env.base ?? '0',
      FAKE_ISO_EXIT: env.iso ?? '1',
      FAKE_LOCK: env.lock ? ISO_PREFIX : undefined,
      CODEX_HOME: path.join(w.home, '.codex'),
    },
    async () => {
      const r = await probeCodexIsolation(entry);
      const dirs = await left(w, ISO_PREFIX);
      const calls = (await fs.readFile(observe, 'utf8').catch(() => '')).split('\n').filter(Boolean);
      const want = dirs.length === 1 ? codexIsolationResidueText(dirs[0]!, 'EACCES') : null;
      return { r, dirs, calls, want };
    },
  );
}

const ISO_RE =
  /^⚠️ codex 隔离探针临时目录删除失败（EACCES）：~\/tmp\/trivium-codexhome-[^/]+ 仍在，其中剩下的只会是探针写的 config\.toml 与本次探测的临时文件，没有拷入凭据，请手工删除$/;

test('I1 基线通、对照翻转、删成功：home_copy，无提示、无残留', async () => {
  const w = await world();
  const { r, dirs, calls } = await isoIn(w, {});
  assert.deepEqual(r, { isolation: 'home_copy', tempDirResidue: null });
  assert.deepEqual(dirs, []);
  assert.deepEqual(calls, ['base', 'iso']);
});

test('I2 对照翻转 + 目录删不掉：不抛、结论仍 home_copy、提示整句（家目录归一 ~）', { skip: ROOT }, async () => {
  const w = await world();
  const { r, dirs, want } = await isoIn(w, { lock: true });
  assert.equal(dirs.length, 1, '本格就是要摆出删不掉：私有 TMPDIR 下应恰有一个残留');
  assert.equal(r.isolation, 'home_copy');
  assert.ok(r.tempDirResidue !== null);
  assert.match(r.tempDirResidue, ISO_RE);
  assert.equal(r.tempDirResidue, want);
});

test('I3 对照不翻转 + 目录删不掉：结论仍 shared（不因删不掉而改）、提示同 I2', { skip: ROOT }, async () => {
  const w = await world();
  const { r, dirs, want } = await isoIn(w, { iso: '0', lock: true });
  assert.equal(dirs.length, 1);
  assert.equal(r.isolation, 'shared');
  assert.equal(r.tempDirResidue, want);
  assert.match(r.tempDirResidue ?? '', ISO_RE);
});

test('I4 基线不通：shared、对照那次没跑、目录已删', async () => {
  const w = await world();
  const { r, dirs, calls } = await isoIn(w, { base: '1' });
  assert.deepEqual(r, { isolation: 'shared', tempDirResidue: null });
  assert.deepEqual(calls, ['base'], '基线不通时不该跑对照');
  assert.deepEqual(dirs, []);
});

test('I5 入口不存在：shared、不抛、目录已删（原 catch 语义不变）', async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const r = await probeCodexIsolation(path.join(w.base, 'no-such-codex'));
    assert.deepEqual(r, { isolation: 'shared', tempDirResidue: null });
    assert.deepEqual(await left(w, ISO_PREFIX), []);
  });
});

// ─────────────────── E：四个探针经假入口跑到外层 finally ───────────────────

/** 假 claude：`--version` 答版本；其余等 stdin 结束（`run()` 恒关闭 stdin）后按 FAKE_LOCK 摆锁、回一轮通用成功事件 */
const CLAUDE_BODY = `
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude)\\n'); process.exit(0); }
function emit(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
process.stdin.on('data', function () {});
process.stdin.on('end', function () {
  if (LOCK) lockUnder(LOCK);
  emit({ type: 'system', subtype: 'init', tools: ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.001, session_id: 'fake-session' });
  process.exit(0);
});
process.stdin.resume();
`;

async function claudeIn(w: World, lock: boolean) {
  const entry = await writeEntry(w, 'claude', CLAUDE_BODY);
  return inWorld(w, { FAKE_LOCK: lock ? FIXTURE_PREFIX : undefined }, async () => {
    // 资产根指到不存在的位置：结构化臂按「资产根缺失」跳过，与本题无关的那一次调用不发生
    const { notes } = await probeClaude(entry, { assetRoot: path.join(w.base, 'no-assets') });
    const main = await left(w, FIXTURE_PREFIX, MEM_PREFIX);
    const mem = await left(w, MEM_PREFIX);
    const want = main.length === 1 && mem.length === 1
      ? [fixtureResidueText('main', main[0]!, 'EACCES'), fixtureResidueText('memory', mem[0]!, 'EACCES')]
      : null;
    return { notes, main, mem, want };
  });
}

test('E1 probeClaude：主夹具与记忆夹具都删不掉——不抛，两条提示各一、逐字等于各自那句', { skip: ROOT }, async () => {
  const w = await world();
  const { notes, main, mem, want } = await claudeIn(w, true);
  assert.equal(main.length, 1, `主夹具应恰有一个残留：${main.join(',')}`);
  assert.equal(mem.length, 1, `记忆夹具应恰有一个残留：${mem.join(',')}`);
  assert.deepEqual(residueNotes(notes), want, notes.join('\n'));
});

test('E1b probeClaude 对照：删成功时 notes 里没有删除失败字样、无残留', async () => {
  const w = await world();
  const { notes, main, mem } = await claudeIn(w, false);
  assert.deepEqual(residueNotes(notes), []);
  assert.deepEqual([...main, ...mem], []);
});

/** 假 agy：`--version`、`models` 应答；其余（headless 读一类）按 FAKE_LOCK 摆锁、吐一行、退 1 */
const AGY_BODY = `
const argv = process.argv.slice(2);
if (argv[0] === '--version') { process.stdout.write('1.2.16\\n'); process.exit(0); }
if (argv[0] === 'models') { process.stdout.write('fake-model\\tFake Model\\n'); process.exit(0); }
if (LOCK) lockUnder(LOCK);
process.stdout.write('fake agy: refused\\n');
process.exit(1);
`;

async function agyIn(w: World, lock: boolean) {
  const entry = await writeEntry(w, 'agy', AGY_BODY);
  return inWorld(w, { FAKE_LOCK: lock ? FIXTURE_PREFIX : undefined }, async () => {
    const { notes } = await probeAgy(entry, 'trivium-critic');
    const main = await left(w, FIXTURE_PREFIX);
    return { notes, main, want: main.length === 1 ? [fixtureResidueText('main', main[0]!, 'EACCES')] : null };
  });
}

test('E2 probeAgy：夹具删不掉——不抛，恰一条主夹具提示', { skip: ROOT }, async () => {
  const w = await world();
  const { notes, main, want } = await agyIn(w, true);
  assert.equal(main.length, 1);
  assert.deepEqual(residueNotes(notes), want, notes.join('\n'));
});

test('E2b probeAgy 对照：删成功时无提示、无残留', async () => {
  const w = await world();
  const { notes, main } = await agyIn(w, false);
  assert.deepEqual(residueNotes(notes), []);
  assert.deepEqual(main, []);
});

/** 假 zcode 入口（只给旗标探针与版本探针用；headless 走 invoke 桩）：照 zcode-doctor-probe-home 的形态 */
const ZCODE_ENTRY = `
const env = process.env;
const argv = process.argv.slice(2);
if (argv[0] === 'version') { process.stdout.write('zcode 0.16.9\\n'); process.exit(0); }
if (!env.${ZCODE_BUILTIN_PROVIDER_ENV}) { process.stderr.write('无法定位 CLI ZCode Built-in Provider Config：/x\\n'); process.exit(1); }
for (const rejected of ['--max-turns', '--settings']) {
  if (argv.includes(rejected)) { process.stderr.write("Unknown option '" + rejected + "'.\\n"); process.exit(1); }
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

const ZCODE_CLI_CONFIG = {
  model: { main: 'bigmodel-coding-plan/GLM-5.3', lite: 'bigmodel-coding-plan/GLM-5.3' },
  provider: {
    'bigmodel-coding-plan': {
      name: 'BigModel Coding Plan', kind: 'anthropic', source: 'custom', enabled: true,
      options: { apiKey: 'fake-id.fake-secret', baseURL: 'https://example.invalid' },
      models: { 'GLM-5.3': {} },
    },
  },
};

async function zcodeIn(w: World, lock: boolean) {
  const entry = path.join(w.base, 'app/Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, ZCODE_ENTRY, 'utf8');
  await fs.mkdir(path.join(w.base, 'app/Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(w.base, 'app/Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');
  const cliConfigPath = path.join(w.base, 'cli-config.json');
  await fs.writeFile(cliConfigPath, JSON.stringify(ZCODE_CLI_CONFIG), { mode: 0o600 });
  let invoked = 0;
  /** headless 的桩：在夹具活着时摆锁，然后答失败——探针当场返回，外层 finally 照走 */
  const invoke = async (_o: ZcodeInvokeOptions): Promise<ZcodeInvokeOutcome> => {
    invoked++;
    if (lock) {
      const fixtures = await left(w, FIXTURE_PREFIX);
      assert.equal(fixtures.length, 1, '桩被调到时夹具应已建好');
      await lockDir(fixtures[0]!).catch(() => {});
    }
    return {
      envelope: null, exitCode: 1, timedOut: false, stdout: '', stderr: 'Error: Model creation failed (traceId: fake)',
      commandLine: 'stub', durationMs: 5, failureKind: 'other',
    };
  };
  return inWorld(w, {}, async () => {
    const { notes } = await probeZcode(entry, process.execPath, {
      cliConfigPath,
      launchModel: null,
      modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩' }),
      modelOverrideFullCopyProbe: async () => ({
        override: null, requested: null, observed: null, why: '桩', replacedPaths: [], hostCredentialEnv: [],
      }),
      invoke,
    });
    const main = await left(w, FIXTURE_PREFIX);
    return { notes, main, invoked, want: main.length === 1 ? [fixtureResidueText('main', main[0]!, 'EACCES')] : null };
  });
}

test('E3 probeZcode：夹具删不掉——不抛，恰一条主夹具提示', { skip: ROOT }, async () => {
  const w = await world();
  const { notes, main, invoked, want } = await zcodeIn(w, true);
  assert.ok(invoked > 0, 'headless 桩没被调到：夹具段没走到');
  assert.equal(main.length, 1);
  assert.deepEqual(residueNotes(notes), want, notes.join('\n'));
});

test('E3b probeZcode 对照：删成功时无提示、无残留', async () => {
  const w = await world();
  const { notes, main, invoked } = await zcodeIn(w, false);
  assert.ok(invoked > 0);
  assert.deepEqual(residueNotes(notes), []);
  assert.deepEqual(main, []);
});

async function codexIn(w: World, lock: boolean) {
  const entry = await writeEntry(w, 'codex', CODEX_BODY);
  const codexHome = path.join(w.home, '.codex');
  await fs.mkdir(codexHome, { recursive: true });
  // 一份 profile：探针要在它的目录里挑到可用模型，才会在夹具活着时走进 exec 段
  await fs.writeFile(path.join(codexHome, 'fake.config.toml'), 'model = "fake-model"\nmodel_provider = "fake"\n', { mode: 0o600 });
  return inWorld(
    w,
    { CODEX_HOME: codexHome, FAKE_LOCK: lock ? `${FIXTURE_PREFIX},${ISO_PREFIX}` : undefined, FAKE_BASE_EXIT: '0', FAKE_ISO_EXIT: '1', FAKE_OBSERVE: undefined },
    async () => {
      const { probe, notes } = await probeCodex(entry);
      const main = await left(w, FIXTURE_PREFIX);
      const iso = await left(w, ISO_PREFIX);
      const want = main.length === 1 && iso.length === 1
        ? [codexIsolationResidueText(iso[0]!, 'EACCES'), fixtureResidueText('main', main[0]!, 'EACCES')]
        : null;
      return { probe, notes, main, iso, want };
    },
  );
}

test('E4 probeCodex：夹具与隔离探针目录都删不掉——不抛，两条提示各一，isolation 仍 home_copy', { skip: ROOT }, async () => {
  const w = await world();
  const { probe, notes, main, iso, want } = await codexIn(w, true);
  assert.equal(main.length, 1, `夹具应恰有一个残留：${notes.join('\n')}`);
  assert.equal(iso.length, 1, `隔离探针目录应恰有一个残留：${notes.join('\n')}`);
  // 隔离探针在 try 里先推、夹具在 finally 里后推
  assert.deepEqual(residueNotes(notes), want, notes.join('\n'));
  assert.equal(probe.isolation, 'home_copy', '结论不因删不掉而改变');
});

test('E4b probeCodex 对照：删成功时无提示、无残留，isolation 照常 home_copy', async () => {
  const w = await world();
  const { probe, notes, main, iso } = await codexIn(w, false);
  assert.deepEqual(residueNotes(notes), []);
  assert.deepEqual([...main, ...iso], []);
  assert.equal(probe.isolation, 'home_copy', `探针没走到隔离探针那一步：${notes.join('\n')}`);
});

// ─────────────────────────── W：源码结构断言 ───────────────────────────

const PROBES_DIR = path.join(REPO_ROOT, 'src/trivium/probes');
const ADAPTERS_DIR = path.join(REPO_ROOT, 'src/trivium/adapters');

const count = (src: string, needle: string): number => src.split(needle).length - 1;

test('W1 probes 目录下每一处 .cleanup() 调用都接住提示并推进 notes（论域从目录派生）', async () => {
  const files = await tsFiles(PROBES_DIR);
  const wellFormed = /const fixtureResidue = await \w+\.cleanup\(\);\s*if \(fixtureResidue\) notes\.push\(fixtureResidue\);/g;
  let total = 0;
  for (const { name, src } of files) {
    const calls = count(src, '.cleanup()');
    const good = [...src.matchAll(wellFormed)].length;
    assert.equal(good, calls, `${name}：${calls} 处 .cleanup() 调用里只有 ${good} 处接住提示并推进 notes——删不掉的提示会被丢掉`);
    const built = count(src, 'await createFixture(') + count(src, 'await createMemoryFixture(');
    assert.ok(good >= built, `${name}：建了 ${built} 个夹具、只收了 ${good} 个`);
    total += calls;
  }
  assert.ok(total > 0, '一处 .cleanup() 都没扫到——扫描写错了会让本条永绿');
});

test('W2 probeCodex 取隔离探针的结论落盘、提示推进 notes', async () => {
  const src = await fs.readFile(path.join(PROBES_DIR, 'codex.ts'), 'utf8');
  assert.equal(count(src, 'probeCodexIsolation(bin)'), 1, '隔离探针的调用点应恰一处');
  assert.match(
    src,
    /const iso = await probeCodexIsolation\(bin\);\s*probe\.isolation = iso\.isolation;\s*if \(iso\.tempDirResidue\) notes\.push\(iso\.tempDirResidue\);/,
  );
});

test('W3 自测：配平截取认得出嵌套括号与各种拼写的递归删除，单文件 force 删除不误报', () => {
  assert.equal(countRecursiveRm('await fs.rm(path.join(a, b), { recursive: true, force: true });'), 1);
  assert.equal(countRecursiveRm('await fs.rm(path.join(codexHome, name), { force: true });'), 0);
  assert.equal(countRecursiveRm('await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });'), 1, '本函数只数形态，maxRetries 的豁免不在这里');
  assert.equal(countRecursiveRm('await fsp.rm(dir, { recursive: true });'), 1, '别名导入');
  assert.equal(countRecursiveRm('fs.rmSync(dir, { recursive: true, force: true });'), 1, '同步形态');
  assert.equal(countRecursiveRm('await fs.promises.rm(dir, { force: true, recursive });'), 1, '速记写法');
  assert.equal(countRecursiveRm('await rm(dir, { recursive: true });'), 1, '解构导入的裸调用');
  assert.equal(countRecursiveRm(' * 不在就跳过——`fs.rm({force:true})` 对不存在是静默成功'), 0, '注释里的单文件示意串');
});

test('W3 probes 与 adapters 两目录下没有裸递归删除：删临时目录一律经 tryRemoveTempDir', async () => {
  const hits: string[] = [];
  for (const dir of [PROBES_DIR, ADAPTERS_DIR]) {
    for (const { name, src } of await tsFiles(dir)) {
      const k = countRecursiveRm(src);
      if (k > 0) hits.push(`${name}×${k}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    'src/trivium/probes 与 src/trivium/adapters 两目录里出现了递归删除（rm / rmdir / rmSync 带 recursive）——删不掉会从 finally 抛出、' +
      '顶替探针结论（EV-199）。改调 util/fsx.ts 的 tryRemoveTempDir。本条只管这两个目录；src/ 全树守卫见 temp-index-cleanup.test.ts 的 W 组（EV-204）',
  );
});
