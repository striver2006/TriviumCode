#!/usr/bin/env node
/**
 * 移植验收（取不到启动时刻当不在，计划 r2 §5.2，计划双审 r1 GLM-01）：把改后的新用例文件与扩过的 `ps-stub.ts`
 * 拷进一份 `git archive c4d082e` 的树，`--tests-only` 重编后单跑该文件，逐格对期望：
 * 新行为格（改前应红）红、回归格（名字带「回归」，改前改后都应绿）绿；文件在改前树**能加载**（不静态导入新导出）。
 * 同一文件在工作树（改后）上全绿。拷入前后 sha256 进读数。
 *
 * 用法（仓库根）：node port-acceptance.mjs 〈改前树（会被写入：拷入两文件并重编测试产物）〉 [输出 JSON]
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const TREE = path.resolve(process.argv[2] ?? '');
const OUT = process.argv[3] ?? null;
const FILES = ['test/integration/unverifiable-start.test.ts', 'test/helpers/ps-stub.ts'];
const TEST_JS = 'dist/test/test/integration/unverifiable-start.test.js';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** 期望：改前树上各用例（按名字前缀）红还是绿 */
const EXPECT_PRE = {
  'EV-175 U1a': 'fail', 'EV-175 U1b': 'fail', 'EV-175 U1c（回归）': 'pass',
  'EV-175 U2：': 'fail', 'EV-175 U2′（回归）': 'pass',
  'EV-175 U3：': 'fail', 'EV-175 U3′（回归）': 'pass',
  'EV-175 U4：': 'fail', 'EV-175 U4′（回归）': 'pass',
  'EV-175 U5：': 'fail',
  'EV-175 U6：': 'fail', 'EV-175 U6′（回归）': 'pass',
  'EV-175 U7：': 'fail', 'EV-175 U8：': 'fail',
};

async function runFile(tree) {
  let stdout = '';
  try {
    stdout = (await pexec(process.execPath, ['--test', '--test-reporter=spec', path.join(tree, TEST_JS)], { cwd: tree, maxBuffer: 64 << 20, timeout: 600_000 })).stdout;
  } catch (e) {
    stdout = e.stdout ?? '';
  }
  const results = {};
  const summaryAt = stdout.indexOf('ℹ tests');
  for (const line of stdout.slice(0, summaryAt < 0 ? undefined : summaryAt).split('\n')) {
    const m = /^([✔✖]) (EV-175 .*?) \(\d/.exec(line);
    if (m && !(m[2] in results)) results[m[2]] = m[1] === '✔' ? 'pass' : 'fail';
  }
  // 失败详情：spec 报告器把它放在「✖ failing tests:」之后
  const failBlock = stdout.includes('✖ failing tests:') ? stdout.slice(stdout.indexOf('✖ failing tests:')) : '';
  return { results, failBlock: failBlock.slice(0, 20_000), counts: /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(stdout)?.slice(1).map(Number) ?? null };
}

const ported = [];
for (const f of FILES) {
  const src = path.join(ROOT, f);
  const dst = path.join(TREE, f);
  const before = await fs.access(dst).then(() => sha(dst), () => null);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  ported.push({ file: f, repo_sha: sha(src), tree_before: before, tree_after: sha(dst) });
}
await pexec(process.execPath, ['scripts/build.mjs', '--tests-only'], { cwd: TREE, maxBuffer: 64 << 20 });

const pre = await runFile(TREE);
const post = await runFile(ROOT);
const cells = [];
for (const [prefix, want] of Object.entries(EXPECT_PRE)) {
  const name = Object.keys(pre.results).find((n) => n.startsWith(prefix));
  const nameP = Object.keys(post.results).find((n) => n.startsWith(prefix));
  const got = name ? pre.results[name] : 'missing';
  const gotP = nameP ? post.results[nameP] : 'missing';
  cells.push({ case: prefix, pre_expected: want, pre_got: got, post_got: gotP, ok: got === want && gotP === 'pass' });
}
const readout = {
  tree: TREE, node: process.version, at: new Date().toISOString(), ported,
  pre_counts: pre.counts, post_counts: post.counts, cells,
  pass: cells.filter((c) => c.ok).length, total: cells.length,
  pre_fail_block: pre.failBlock,
};
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
for (const c of cells) console.log(`${c.ok ? '✓' : '✖'} ${c.case} 改前 ${c.pre_got}（期望 ${c.pre_expected}）｜改后 ${c.post_got}`);
console.log(`改前 tests/pass/fail = ${pre.counts}；改后 = ${post.counts}；${readout.pass} / ${readout.total}`);
process.exitCode = readout.pass === readout.total ? 0 : 1;
