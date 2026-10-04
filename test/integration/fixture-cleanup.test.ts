import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { KEEP_FIXTURES_ENV, REPO_ROOT } from '../helpers/fixture.js';
import { run } from '../../src/trivium/util/exec.js';

/**
 * EV-207：`makeFixture` 的夹具收尾（行为级）。
 *
 * 此前夹具根从不删、运行根是兄弟目录 `<夹具根>-runs`，系统临时目录里堆了几万个 `trivium-fx-*`。
 * 现在 mkdtemp 建父目录、夹具仓库 `repo/` 与运行根 `runs/` 都在其下，父目录一建好就登记，**测试文件进程退出时**整个删掉。
 *
 * 收尾挂在进程退出上，所以只能在子进程里测：每格写一个最小测试文件，以绝对 file URL import 编译后的 helper，
 * 用 `node --test` 跑它（与 `npm test` 同一种进程隔离），`TMPDIR` 钉到本格私有目录，子进程退出后数私有目录里还剩什么。
 *
 * 四格：FC1 退出后父目录不在（含只读子目录、父目录自身只读、用例自己先删掉、无手脚四种夹具）；
 * FC2 设保留变量时都还在并列出路径；FC3 两个都删不掉时逐个打一行、不改退出码；FC4 建到一半抛出也删。
 * 涉及权限的格 root 下跳过。用例只删本格 mkdtemp 的返回值。
 */

const ROOT = process.getuid?.() === 0;
const HELPER_URL = pathToFileURL(path.join(REPO_ROOT, 'dist/test/test/helpers/fixture.js')).href;

/** 子测试文件正文：按 FC_MODE 分格，把建出来的父目录写进 FC_REPORT */
const CHILD = `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { makeFixture } from ${JSON.stringify(HELPER_URL)};

const mode = process.env.FC_MODE;
const parents = [];
const note = async () => fs.writeFile(process.env.FC_REPORT, JSON.stringify(parents), 'utf8');

async function shaped(topic) {
  const fx = await makeFixture({ topic });
  const parent = path.dirname(fx.root);
  assert.equal(path.dirname(fx.runRoot), parent, '运行根与夹具仓库同父');
  assert.equal(path.basename(fx.root), 'repo');
  assert.equal(path.basename(fx.runRoot), 'runs');
  const cfg = await fs.readFile(path.join(fx.root, '.trivium/config.yaml'), 'utf8');
  assert.equal(/^\\s*run_root: (.+)$/m.exec(cfg)?.[1], fx.runRoot, '配置里的 run_root 就是 fx.runRoot');
  parents.push(parent);
  return fx;
}

async function readonlyDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'f'), 'x', 'utf8');
  await fs.chmod(dir, 0o555);
}

test('child', async () => {
  if (mode === 'clean') {
    const a = await shaped('收尾一');
    await readonlyDir(path.join(a.runRoot, 'bucket', 'locked'));
    await readonlyDir(path.join(a.root, 'locked'));
    const b = await shaped('收尾二');
    await fs.chmod(path.dirname(b.root), 0o500);
    const c = await shaped('收尾三');
    await fs.rm(path.dirname(c.root), { recursive: true, force: true });
    await shaped('收尾四');
  } else if (mode === 'keep') {
    await shaped('保留一');
    await shaped('保留二');
  } else if (mode === 'stuck') {
    await shaped('删不掉一');
    await shaped('删不掉二');
    await fs.chmod(process.env.TMPDIR, 0o555);
  } else if (mode === 'half') {
    await assert.rejects(makeFixture({ topic: 'a\\u0000b' }), (e) => e.code === 'ERR_INVALID_ARG_VALUE',
      '前提：topic 含 NUL 时 stageDir 写盘必抛——不抛是注入手段失效，不是被测改动的问题');
  } else {
    throw new Error('未知 FC_MODE ' + mode);
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
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `trivium-fcl-${tag}-`)));
  const tmp = path.join(base, 'tmp');
  await fs.mkdir(tmp);
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
    console.warn(`fixture-cleanup：私有目录没删掉，请手工删除 ${base}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
  });
}

async function runChild(c: Cell, mode: string, extraEnv: Record<string, string | undefined> = {}) {
  const r = await run(process.execPath, ['--test', path.join(c.base, 'child.test.mjs')], {
    cwd: c.base,
    /*
     * 去掉 NODE_TEST_CONTEXT：本文件自己跑在 node --test 的子进程里，这个变量会被继承，
     * 子进程的 `node --test` 见到它就判为递归调用、跳过全部文件且退 0——用例会对着一个什么都没跑的子进程断言。
     */
    env: { TMPDIR: c.tmp, FC_MODE: mode, FC_REPORT: c.report, NODE_TEST_CONTEXT: undefined, [KEEP_FIXTURES_ENV]: undefined, ...extraEnv },
    timeoutMs: 120_000,
  });
  return { code: r.code, out: `${r.stdout}\n${r.stderr}` };
}

async function fxEntries(tmp: string): Promise<string[]> {
  return (await fs.readdir(tmp)).filter((n) => n.startsWith('trivium-fx-')).sort();
}

/** 子用例写下的父目录清单；读不到说明子用例没跑到结尾，把子进程输出带进失败信息 */
async function reported(c: Cell, out: string): Promise<string[]> {
  const text = await fs.readFile(c.report, 'utf8').catch(() => assert.fail(`子用例没写出报告（没跑到结尾）：\n${out}`));
  return JSON.parse(text) as string[];
}

test('FC1 退出后父目录不在：只读子目录、父目录自身只读、已被用例删掉、无手脚，四个都收干净且不误报', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const c = await cell('fc1');
  try {
    const r = await runChild(c, 'clean');
    assert.equal(r.code, 0, `子用例应通过：\n${r.out}`);
    assert.equal((await reported(c, r.out)).length, 4, '前提：子用例建了四个夹具');
    assert.deepEqual(await fxEntries(c.tmp), [], `夹具父目录应全部删掉：\n${r.out}`);
    assert.doesNotMatch(r.out, /没删掉|不像夹具目录/, '不该有删除失败的提示（含已被删掉的那个）');
  } finally {
    await drop(c.base);
  }
});

test('FC2 设保留变量时父目录都还在，并打一行列出路径', async () => {
  const c = await cell('fc2');
  try {
    const r = await runChild(c, 'keep', { [KEEP_FIXTURES_ENV]: '1' });
    assert.equal(r.code, 0, `子用例应通过：\n${r.out}`);
    const parents = await reported(c, r.out);
    assert.equal(parents.length, 2);
    for (const p of parents) await fs.access(path.join(p, 'repo', '.trivium', 'config.yaml'));
    assert.match(r.out, new RegExp(`makeFixture：${KEEP_FIXTURES_ENV}=1，保留本进程的 2 个夹具目录：`));
    for (const p of parents) assert.ok(r.out.includes(p), `保留提示里应有 ${p}：\n${r.out}`);
  } finally {
    await drop(c.base);
  }
});

/**
 * 两个夹具都删不掉（`TMPDIR` 只读，父目录本身 rmdir 撞 EACCES）：逐个兜底时各打一行。
 * 代码双审 GLM-03：只建一个时，兜底被挪到循环外（第一个删不掉就中断整批）也照样绿。
 */
test('FC3 删不掉时逐个打一行（路径与错误码）、一个删不掉不中断后面的，不改子进程的退出码', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const c = await cell('fc3');
  try {
    const r = await runChild(c, 'stuck');
    assert.equal(r.code, 0, `删不掉不该把通过的测试文件翻成失败：\n${r.out}`);
    const parents = await reported(c, r.out);
    assert.equal(parents.length, 2, '前提：子用例建了两个夹具');
    for (const p of parents) await fs.access(p);
    const hit = [...r.out.matchAll(/makeFixture：夹具目录没删掉，请手工删除 (\S+)（(EACCES|EPERM)）/g)].map((m) => m[1]);
    assert.deepEqual(hit.sort(), [...parents].sort(), `每个删不掉的父目录都应各打一行：\n${r.out}`);
  } finally {
    await drop(c.base);
  }
});

test('FC4 建到一半抛出也删：mkdtemp 一返回就登记，退出时照样收尾', async () => {
  const c = await cell('fc4');
  try {
    const r = await runChild(c, 'half');
    assert.equal(r.code, 0, `子用例应通过（它断言 makeFixture 确实抛了）：\n${r.out}`);
    assert.deepEqual(await fxEntries(c.tmp), [], `建到一半的父目录应被删掉：\n${r.out}`);
  } finally {
    await drop(c.base);
  }
});
