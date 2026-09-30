#!/usr/bin/env node
/**
 * 移植验收（并发写闸门偶发红，EV-153，计划 r2 §5.4）：把改后的测试文件拷进旧树（3e38d29）与改前树（7c6959e），
 * 连同改后仓库本身，各跑一遍 lock.test 与 state.test，并把目标用例「并发 setGate 不丢更新」单独重复 R 次。
 * 拷入前后记 sha256；输出里**正面断言**新用例名出现且计入执行数（漏移植时读数不会静默成「0 红」）。
 *
 * 用法：node acceptance.mjs --old 〈旧树根〉 --pre 〈改前树根〉 [--repeat 30] [--out acceptance-readout.json]
 *   两棵树由 `git archive 〈提交〉 | tar -x`、node_modules 软链回仓库搭成（见 trees.md）；本脚本负责拷入与 --tests-only 构建。
 */
import { spawnSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const OLD = path.resolve(arg('old'));
const PRE = path.resolve(arg('pre'));
const REPEAT = Number(arg('repeat', '30'));
const OUT = path.resolve(HERE, arg('out', 'acceptance-readout.json'));
const PORTED = ['test/unit/lock.test.ts', 'test/unit/state.test.ts', 'test/helpers/ps-stub.ts'];
const TARGET = '并发 setGate 不丢更新（经短临界区串行化，GLM-08）';
const EV153 = [
  'EV-153 U1a', 'EV-153 U1b', 'EV-153 U1c / U1d', 'EV-153 U1e', 'EV-153 U2', 'EV-153 U3',
];
// 期望：改前与旧构建上 D1 缺席 ⇒ ps 取不到即判 pid_reused，U1a～U1d、U2、U3 红；U1e（真复用）三份都绿
const EXPECT = {
  new: { 'EV-153 U1a': '✔', 'EV-153 U1b': '✔', 'EV-153 U1c / U1d': '✔', 'EV-153 U1e': '✔', 'EV-153 U2': '✔', 'EV-153 U3': '✔' },
  pre: { 'EV-153 U1a': '✖', 'EV-153 U1b': '✖', 'EV-153 U1c / U1d': '✖', 'EV-153 U1e': '✔', 'EV-153 U2': '✖', 'EV-153 U3': '✖' },
  old: { 'EV-153 U1a': '✖', 'EV-153 U1b': '✖', 'EV-153 U1c / U1d': '✖', 'EV-153 U1e': '✔', 'EV-153 U2': '✖', 'EV-153 U3': '✖' },
};

const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

function runTest(root, file, extra = []) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=120000', ...extra, file], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  });
}

/**
 * spec 报告器：顶层用例一行一个 ✔ / ✖（汇总段之前）；失败详情在「✖ failing tests:」汇总段里，
 * 每块从 ✖ 行起到下一个 ✖ 行或输出结尾
 */
function parse(out) {
  const [body, tail = ''] = out.split('✖ failing tests:');
  const lines = [...body.matchAll(/^([✔✖]) (.+?) \(\d[\d.]*ms\)$/gm)].map((m) => ({ mark: m[1], name: m[2] }));
  const blocks = Object.fromEntries(
    [...tail.matchAll(/^✖ (.+?) \(\d[\d.]*ms\)\n([\s\S]*?)(?=^✖ |$(?![\s\S]))/gm)].map((m) => [m[1], m[2].slice(0, 6000)]),
  );
  return { lines, blocks };
}

async function tree(label, root, port) {
  const r = { label, root, lock_js_sha256: null, ported: [], build: null, lock_test: {}, state_test: {}, target_repeat: null };
  if (port) {
    for (const f of PORTED) {
      const src = path.join(REPO, f);
      const dst = path.join(root, f);
      const before = await sha(dst).catch(() => null);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      r.ported.push({ file: f, repo_sha256: await sha(src), before_sha256: before, after_sha256: await sha(dst) });
    }
  }
  const b = spawnSync(process.execPath, ['scripts/build.mjs', '--tests-only'], { cwd: root, encoding: 'utf8' });
  r.build = { code: b.status, tail: (b.stdout + b.stderr).trim().split('\n').slice(-1)[0] };
  r.lock_js_sha256 = await sha(path.join(root, 'dist/test/src/trivium/lock.js'));

  const lt = parse((await runTest(root, 'dist/test/test/unit/lock.test.js')).out);
  for (const k of EV153) {
    const hit = lt.lines.find((l) => l.name.startsWith(k + '：'));
    r.lock_test[k] = hit
      ? { mark: hit.mark, expected: EXPECT[label][k], ok: hit.mark === EXPECT[label][k], fail_block: lt.blocks[hit.name] ?? null }
      : { mark: null, expected: EXPECT[label][k], ok: false, fail_block: '用例未出现在输出里（漏移植？）' };
  }
  const st = parse((await runTest(root, 'dist/test/test/unit/state.test.js')).out);
  const t = st.lines.find((l) => l.name === TARGET);
  r.state_test = t ? { mark: t.mark, fail_block: st.blocks[TARGET] ?? null } : { mark: null, fail_block: '目标用例未出现' };

  const reps = { runs: 0, red: 0, executed: 0, reasons: {}, samples: [] };
  for (let i = 0; i < REPEAT; i++) {
    const p = parse((await runTest(root, 'dist/test/test/unit/state.test.js', ['--test-name-pattern', '并发 setGate'])).out);
    const hit = p.lines.find((l) => l.name === TARGET);
    reps.runs++;
    if (hit) reps.executed++;
    if (hit?.mark === '✖') {
      reps.red++;
      const block = p.blocks[TARGET] ?? '';
      const msg = (block.match(/(有写者失败|个并发写入应全部保留|同进程写者不得)[^\n]*/) ?? ['其他'])[0].slice(0, 40);
      reps.reasons[msg] = (reps.reasons[msg] ?? 0) + 1;
      if (reps.samples.length < 3) reps.samples.push(block);
    }
  }
  r.target_repeat = reps;
  return r;
}

const t0 = Date.now();
const trees = [await tree('new', REPO, false), await tree('pre', PRE, true), await tree('old', OLD, true)];
const cells = trees.flatMap((t) => Object.entries(t.lock_test).map(([k, v]) => ({ tree: t.label, test: k, ...v })));
const summary = {
  at: new Date().toISOString(),
  node: process.version,
  elapsed_s: Math.round((Date.now() - t0) / 1000),
  cells_ok: `${cells.filter((c) => c.ok).length}/${cells.length}`,
  all_ported_tests_executed: trees.every((t) => Object.values(t.lock_test).every((v) => v.mark !== null) && t.target_repeat.executed === REPEAT),
  trees,
};
await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({
  cells_ok: summary.cells_ok,
  all_ported_tests_executed: summary.all_ported_tests_executed,
  per_tree: trees.map((t) => ({
    tree: t.label, lock_js_sha256: t.lock_js_sha256.slice(0, 12),
    marks: Object.fromEntries(Object.entries(t.lock_test).map(([k, v]) => [k, `${v.mark}${v.ok ? '' : '（不符期望）'}`])),
    state_test: t.state_test.mark,
    target_repeat: `${t.target_repeat.red}/${t.target_repeat.runs} 红`, reasons: t.target_repeat.reasons,
  })),
}, null, 2));
