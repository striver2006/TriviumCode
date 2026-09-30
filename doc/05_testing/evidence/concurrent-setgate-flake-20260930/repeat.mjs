#!/usr/bin/env node
/**
 * 高并发重复（并发写闸门偶发红，EV-153）：同一份 state.test 测试产物 K 路并发、每路 R 次，数每条用例的红次数，
 * 存下每次红的**完整**失败块（spec 报告器里该用例 ✖ 行之后到下一条用例之前的全部文本，不过滤行）。
 * 改自 evidence/lock-reclaim-enoent-20260930/repeat.mjs。
 *
 * 用法：node repeat.mjs --root 〈构建树根〉 [--parallel 8] [--runs 30] [--file dist/test/test/unit/state.test.js]
 *                       [--with-suite] [--out 〈JSON〉]
 *   --with-suite：同时在同一构建树上循环跑全量测试当背景负载（与 load-run.mjs 同）。
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg('root', process.cwd()));
const PARALLEL = Number(arg('parallel', '8'));
const RUNS = Number(arg('runs', '30'));
const OUT = arg('out', null);
const FILE = arg('file', 'dist/test/test/unit/state.test.js');
const WITH_SUITE = process.argv.includes('--with-suite');

const run = (args) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  });

let done = false;
const suiteRuns = [];
const suite = (async () => {
  if (!WITH_SUITE) return;
  while (!done) {
    const t0 = Date.now();
    const r = await run(['--test', 'dist/test/**/*.test.js']);
    const tail = (k) => (r.out.match(new RegExp(`^ℹ ${k} (\\d+)$`, 'm')) ?? [])[1] ?? null;
    const failing = r.code !== 0 ? (r.out.split('✖ failing tests:')[1] ?? r.out.slice(-6000)).slice(0, 12000) : undefined;
    suiteRuns.push({ code: r.code, s: Math.round((Date.now() - t0) / 1000), tests: tail('tests'), fail: tail('fail'), failing });
  }
})();

const t0 = Date.now();
const perTest = {};
const failures = [];
let total = 0;
let redRuns = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async (_, lane) => {
    for (let k = 0; k < RUNS; k++) {
      const { code, out } = await run(['--test', '--test-reporter=spec', '--test-timeout=120000', FILE]);
      total++;
      if (code !== 0) redRuns++;
      // spec 报告器：顶层用例一行一个 ✔ / ✖；失败汇总段会重复 ✖ 行，只取汇总段之前的
      const body = out.split('✖ failing tests:')[0];
      for (const m of body.matchAll(/^([✔✖]) (.+?) \((\d[\d.]*)ms\)$/gm)) {
        const t = (perTest[m[2]] ??= { pass: 0, fail: 0, max_ms: 0 });
        if (m[1] === '✔') t.pass++;
        else t.fail++;
        t.max_ms = Math.max(t.max_ms, Math.round(Number(m[3])));
      }
      if (code !== 0) {
        const blocks = [...body.matchAll(/^✖ (.+?) \((\d[\d.]*)ms\)\n([\s\S]*?)(?=^[✔✖] |\nℹ )/gm)].map((m) => ({
          test: m[1],
          ms: Number(m[2]),
          text: m[3].slice(0, 8000),
        }));
        // 用例体之外的 stderr（告警）也留：spec 报告器把它们放在用例行之前
        const stderrLines = out.split('\n').filter((l) => l.includes('回收主题') || l.includes('放不回'));
        failures.push({ lane, k, code, blocks, warnings: stderrLines, raw_tail: blocks.length === 0 ? out.slice(-4000) : undefined });
      }
    }
  }),
);
done = true;
const laneSeconds = Math.round((Date.now() - t0) / 1000);
await suite;
const summary = {
  root: ROOT,
  file: FILE,
  node: process.version,
  at: new Date().toISOString(),
  parallel: PARALLEL,
  runs_per_lane: RUNS,
  with_suite: WITH_SUITE,
  total_runs: total,
  red_runs: redRuns,
  elapsed_s: laneSeconds,
  suite_runs: suiteRuns,
  per_test: perTest,
  failures,
};
if (OUT) await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
const { failures: _f, per_test: pt, ...brief } = summary;
const focus = Object.fromEntries(Object.entries(pt).filter(([k, v]) => v.fail > 0 || k.includes('并发 setGate')));
console.log(JSON.stringify({ ...brief, per_test_focus: focus }));
