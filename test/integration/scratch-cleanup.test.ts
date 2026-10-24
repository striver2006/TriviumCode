import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { KEEP_FIXTURES_ENV, REPO_ROOT } from '../helpers/fixture.js';
import { run } from '../../src/trivium/util/exec.js';
import { IS_WIN, skipOnWin } from '../helpers/platform.js';

/**
 * EV-208：通用测试临时目录 helper `test/helpers/scratch.ts` 的收尾（行为级）。
 *
 * `scratchDir` / `scratchDirSync` 在 mkdtemp 一返回就登记，**测试文件进程退出时**统一删（EV-207 给 `makeFixture` 做的那套，本题抽成通用）。
 * 收尾挂在进程退出上，所以只能在子进程里测：写法照 `fixture-cleanup.test.ts` 的 FC 组——每格写一个最小测试文件，
 * 以绝对 file URL import 编译后的 helper，用 `node --test` 跑它，`TMPDIR` 钉到本格私有目录，子进程退出后看还剩什么。
 *
 * 六格：SC1 退出后都不在（只读子目录、自身只读、用例已删、无手脚、同步版、带尾斜杠的 TMPDIR、相对路径的 TMPDIR 后再换 cwd）；
 * SC2 保留变量；SC3 删不掉逐个打一行、不改退出码；SC4 用例失败时照样删、失败不被翻成通过；
 * SC5 与 `makeFixture` 同进程时按调用方分组提示、`makeFixture` 那行与 EV-207 逐字相同；SC6 前缀不合规时 mkdtemp 之前就拒绝。
 * `makeFixture` 自己的行为不变由 FC1～FC4 原样照跑来证。涉及权限的格 root 下跳过。
 * 本文件的私有根自带收尾（不用被测的 helper 收尾自己，EV-207 代码双审 GLM-02 的同一理由），登记在 `scratch-guard` 的豁免表里。
 */

const ROOT = process.getuid?.() === 0;
const SCRATCH_URL = pathToFileURL(path.join(REPO_ROOT, 'dist/test/test/helpers/scratch.js')).href;
const FIXTURE_URL = pathToFileURL(path.join(REPO_ROOT, 'dist/test/test/helpers/fixture.js')).href;

/** 子测试文件正文：按 SC_MODE 分格，把建出来的目录（解析成绝对路径）写进 SC_REPORT */
const CHILD = `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { scratchDir, scratchDirSync } from ${JSON.stringify(SCRATCH_URL)};
import { makeFixture } from ${JSON.stringify(FIXTURE_URL)};

const mode = process.env.SC_MODE;
const tmp = process.env.TMPDIR;
const made = [];
const note = async () => fs.writeFile(process.env.SC_REPORT, JSON.stringify(made), 'utf8');

async function readonlyDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'f'), 'x', 'utf8');
  await fs.chmod(dir, 0o555);
}

test('child', async () => {
  if (mode === 'clean') {
    const a = await scratchDir('trivium-sc-a-');
    await readonlyDir(path.join(a, 'x', 'locked'));
    const b = await scratchDir('trivium-sc-b-');
    await fs.writeFile(path.join(b, 'f'), 'x', 'utf8');
    await fs.chmod(b, 0o500);
    const c = await scratchDir('trivium-sc-c-');
    await fs.rm(c, { recursive: true, force: true });
    const d = await scratchDir('trivium-sc-d-');
    const e = scratchDirSync('trivium-sc-e-');
    // 带尾斜杠的 TMPDIR：os.tmpdir() 会去掉尾斜杠，登记的父目录照样对得上。
    // 三个键一起设：win32 的 os.tmpdir() 只认 TMP/TEMP、不认 TMPDIR（Bug 清单 §3.1 第 13 条），POSIX 反之。
    const setTmpEnv = (v) => { process.env.TMPDIR = v; process.env.TMP = v; process.env.TEMP = v; };
    setTmpEnv(path.join(tmp, 'inner') + '/');
    const f = await scratchDir('trivium-sc-f-');
    assert.equal(path.dirname(f), path.join(tmp, 'inner'), '前提：目录建在 inner 下');
    // 相对路径的 TMPDIR：mkdtemp 返回相对路径；随后换 cwd，退出时仍要删的是当初那一个。
    // win32 的 os.tmpdir() 对 TEMP/TMP 做 path.resolve（恒绝对），相对形态结构上测不到——只验建目录，POSIX 保持全断言。
    setTmpEnv('rel/');
    const g = await scratchDir('trivium-sc-g-');
    if (!(${IS_WIN})) assert.ok(!path.isAbsolute(g), '前提：相对 TMPDIR 下 mkdtemp 返回相对路径——不是的话这一格测不到登记时解析');
    const gAbs = path.resolve(g);
    process.chdir(tmp);
    made.push(a, b, c, d, e, f, gAbs);
  } else if (mode === 'keep') {
    made.push(await scratchDir('trivium-sc-k-'), scratchDirSync('trivium-sc-k-'));
  } else if (mode === 'stuck') {
    made.push(await scratchDir('trivium-sc-s-'), await scratchDir('trivium-sc-s-'));
    await fs.chmod(tmp, 0o555);
  } else if (mode === 'throw') {
    made.push(await scratchDir('trivium-sc-t-'));
    await note();
    throw new Error('故意失败：收尾不该把失败翻成通过');
  } else if (mode === 'mixed') {
    const fx = await makeFixture({ topic: '混合' });
    made.push(path.dirname(fx.root), await scratchDir('trivium-sc-m-'));
  } else if (mode === 'prefix') {
    // 末两个是形状边界（代码双审 GLM-01）：trivium- 之后为空、没有尾连字符
    for (const p of ['../x-', '/abs-', 'foo-', 'trivium-a/b-', 'trivium-', 'trivium-a']) {
      await assert.rejects(scratchDir(p), TypeError, 'scratchDir 应以 TypeError 拒绝 ' + p);
      assert.throws(() => scratchDirSync(p), TypeError, 'scratchDirSync 应同步抛 TypeError ' + p);
    }
    assert.deepEqual((await fs.readdir(tmp)).filter((n) => n !== 'inner'), [], '被拒的前缀不该建出任何目录（inner/ 是本格预建的）');
    made.push(await scratchDir('trivium-a_b-'));
  } else {
    throw new Error('未知 SC_MODE ' + mode);
  }
  await note();
});
`;

interface Cell {
  base: string;
  tmp: string;
  report: string;
}

async function cell(tag: string): Promise<Cell> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `trivium-scc-${tag}-`)));
  const tmp = path.join(base, 'tmp');
  await fs.mkdir(path.join(tmp, 'inner'), { recursive: true });
  await fs.mkdir(path.join(base, 'rel'));
  await fs.writeFile(path.join(base, 'child.test.mjs'), CHILD, 'utf8');
  return { base, tmp, report: path.join(base, 'report.json') };
}

/** 先逐层恢复权限（每层先 chmod 自身再列目录）再整删本格私有目录；删不掉打一行，不吞 */
async function drop(base: string): Promise<void> {
  const walk = async (d: string): Promise<void> => {
    await fs.chmod(d, 0o700).catch(() => {});
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) await walk(path.join(d, e.name));
  };
  await walk(base);
  await fs.rm(base, { recursive: true, force: true, maxRetries: 3 }).catch((e: unknown) => {
    console.warn(`scratch-cleanup：私有目录没删掉，请手工删除 ${base}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
  });
}

async function runChild(c: Cell, mode: string, extraEnv: Record<string, string | undefined> = {}) {
  const r = await run(process.execPath, ['--test', path.join(c.base, 'child.test.mjs')], {
    cwd: c.base,
    // 去掉 NODE_TEST_CONTEXT：继承下去子进程的 node --test 会判为递归调用、跳过全部文件且退 0（EV-207 撞过）。
    // TMP 三键齐设：win32 的 os.tmpdir() 只认 TMP/TEMP，单设 TMPDIR 时子进程全建到真实临时目录（Bug 清单 §3.1 第 13 条）
    env: { TMPDIR: c.tmp, TMP: c.tmp, TEMP: c.tmp, SC_MODE: mode, SC_REPORT: c.report, NODE_TEST_CONTEXT: undefined, [KEEP_FIXTURES_ENV]: undefined, ...extraEnv },
    timeoutMs: 120_000,
  });
  return { code: r.code, out: `${r.stdout}\n${r.stderr}` };
}

/** 子用例写下的目录清单；读不到说明子用例没跑到结尾，把子进程输出带进失败信息 */
async function reported(c: Cell, out: string): Promise<string[]> {
  const text = await fs.readFile(c.report, 'utf8').catch(() => assert.fail(`子用例没写出报告（没跑到结尾）：\n${out}`));
  return JSON.parse(text) as string[];
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function scratchEntries(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).filter((n) => n.startsWith('trivium-')).sort();
}

test('SC1 退出后都不在：只读子目录、自身只读、已被用例删掉、无手脚、同步版、带尾斜杠与相对路径的 TMPDIR，且不误报', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const c = await cell('sc1');
  try {
    const r = await runChild(c, 'clean');
    assert.equal(r.code, 0, `子用例应通过：\n${r.out}`);
    const made = await reported(c, r.out);
    assert.equal(made.length, 7, '前提：子用例建了七个目录');
    for (const p of made) assert.equal(await exists(p), false, `${p} 应已删掉：\n${r.out}`);
    for (const d of [c.tmp, path.join(c.tmp, 'inner'), path.join(c.base, 'rel')]) {
      assert.deepEqual(await scratchEntries(d), [], `${d} 下不该剩临时目录：\n${r.out}`);
    }
    assert.doesNotMatch(r.out, /没删掉|不像/, '不该有删除失败或防呆的提示（含已被删掉的那个）');
  } finally {
    await drop(c.base);
  }
});

test('SC2 设保留变量时都还在，并打一行列出路径', async () => {
  const c = await cell('sc2');
  try {
    const r = await runChild(c, 'keep', { [KEEP_FIXTURES_ENV]: '1' });
    assert.equal(r.code, 0, `子用例应通过：\n${r.out}`);
    const made = await reported(c, r.out);
    assert.equal(made.length, 2);
    for (const p of made) assert.equal(await exists(p), true, `${p} 应保留`);
    assert.match(r.out, new RegExp(`scratchDir：${KEEP_FIXTURES_ENV}=1，保留本进程的 2 个测试临时目录：`));
    for (const p of made) assert.ok(r.out.includes(p), `保留提示里应有 ${p}：\n${r.out}`);
  } finally {
    await drop(c.base);
  }
});

test('SC3 删不掉时逐个打一行（路径与错误码）、一个删不掉不中断后面的，不改子进程的退出码', {
  skip: (ROOT && 'root 下只读目录锁不住') || skipOnWin(
    'win32 上无可靠「删不掉」构造（Bug 清单 §3.1 第 13 条）：NTFS + Node 24 的 POSIX 删除语义下，实测只读目录、'
      + '目录内只读文件、父目录只读、被打开句柄四种形态全部删除成功，chmod(0o555) 锁不住、收尾路径无法触发',
  ),
}, async () => {
  const c = await cell('sc3');
  try {
    const r = await runChild(c, 'stuck');
    assert.equal(r.code, 0, `删不掉不该把通过的测试文件翻成失败：\n${r.out}`);
    const made = await reported(c, r.out);
    assert.equal(made.length, 2, '前提：子用例建了两个目录');
    for (const p of made) assert.equal(await exists(p), true);
    const hit = [...r.out.matchAll(/scratchDir：测试临时目录没删掉，请手工删除 (\S+)（(EACCES|EPERM)）/g)].map((m) => m[1]);
    assert.deepEqual(hit.sort(), [...made].sort(), `每个删不掉的目录都应各打一行：\n${r.out}`);
  } finally {
    await drop(c.base);
  }
});

test('SC4 用例失败时照样删，失败不被收尾翻成通过', async () => {
  const c = await cell('sc4');
  try {
    const r = await runChild(c, 'throw');
    assert.notEqual(r.code, 0, `子用例故意失败，退出码应非零：\n${r.out}`);
    assert.match(r.out, /故意失败/, '前提：失败的确是子用例自己抛的');
    const made = await reported(c, r.out);
    assert.equal(made.length, 1);
    assert.equal(await exists(made[0]!), false, `失败的用例建的目录也应删掉：\n${r.out}`);
  } finally {
    await drop(c.base);
  }
});

test('SC5 与 makeFixture 同进程：都删；保留时按调用方各打一行，makeFixture 那行与 EV-207 逐字相同', async () => {
  const c = await cell('sc5');
  try {
    const r = await runChild(c, 'mixed');
    assert.equal(r.code, 0, `子用例应通过：\n${r.out}`);
    const made = await reported(c, r.out);
    assert.equal(made.length, 2);
    for (const p of made) assert.equal(await exists(p), false, `${p} 应已删掉：\n${r.out}`);
    assert.doesNotMatch(r.out, /没删掉|不像/);

    await fs.rm(c.report, { force: true });
    const k = await runChild(c, 'mixed', { [KEEP_FIXTURES_ENV]: '1' });
    assert.equal(k.code, 0, `子用例应通过：\n${k.out}`);
    const [fxParent, dir] = await reported(c, k.out);
    const lines = k.out.split('\n').filter((l) => l.includes(`${KEEP_FIXTURES_ENV}=1`));
    assert.deepEqual(
      lines,
      [
        `makeFixture：${KEEP_FIXTURES_ENV}=1，保留本进程的 1 个夹具目录：${fxParent}`,
        `scratchDir：${KEEP_FIXTURES_ENV}=1，保留本进程的 1 个测试临时目录：${dir}`,
      ],
      `应按调用方各打一行：\n${k.out}`,
    );
  } finally {
    await drop(c.base);
  }
});

test('SC6 前缀不合规时在 mkdtemp 之前拒绝（异步版被拒、同步版同步抛），合规的下划线前缀照常建出并删掉', async () => {
  const c = await cell('sc6');
  try {
    const r = await runChild(c, 'prefix');
    assert.equal(r.code, 0, `子用例应通过（它断言了拒绝形态与零条目）：\n${r.out}`);
    const made = await reported(c, r.out);
    assert.equal(made.length, 1);
    assert.match(path.basename(made[0]!), /^trivium-a_b-/);
    assert.equal(await exists(made[0]!), false, `合规前缀的目录退出后应删掉：\n${r.out}`);
    assert.deepEqual(await scratchEntries(c.tmp), []);
    assert.deepEqual((await fs.readdir(c.base)).filter((n) => n.startsWith('x-')), [], "'../x-' 不该在私有根里建出目录");
  } finally {
    await drop(c.base);
  }
});
