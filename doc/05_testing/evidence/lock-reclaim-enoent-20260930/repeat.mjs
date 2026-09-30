#!/usr/bin/env node
/**
 * 高并发重复（锁回收误判已删锁文件计划 r2 §6.3，辅助信号）：同一份 lock-cross-process 测试产物 K 路并发、每路 R 次，
 * 数每条用例的红次数，存下每次红的失败文案（不只存用例名）。
 *
 * 用法：node repeat.mjs --root 〈构建树根〉 [--parallel 8] [--runs 30] [--out 〈JSON 路径〉]
 *   构建树根下要有 dist/test/test/integration/lock-cross-process.test.js（先 --tests-only）。
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
const FILE = 'dist/test/test/integration/lock-cross-process.test.js';

function once() {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=120000', FILE], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  });
}

const t0 = Date.now();
const perTest = {};
const failures = [];
let total = 0;
let redRuns = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async (_, lane) => {
    for (let k = 0; k < RUNS; k++) {
      const { code, out } = await once();
      total++;
      if (code !== 0) redRuns++;
      // spec 报告器：顶层用例一行一个 ✔ / ✖；失败汇总段会重复 ✖ 行，只取汇总段之前的
      const body = out.split('✖ failing tests:')[0];
      for (const m of body.matchAll(/^([✔✖]) (.+?) \(\d[\d.]*ms\)$/gm)) {
        const t = (perTest[m[2]] ??= { pass: 0, fail: 0 });
        if (m[1] === '✔') t.pass++;
        else t.fail++;
      }
      if (code !== 0) {
        const msgs = [...body.matchAll(/^✖ (.+?) \(\d[\d.]*ms\)\n([\s\S]*?)(?=^[✔✖] |\nℹ )/gm)].map((m) => ({
          test: m[1],
          text: m[2].split('\n').filter((l) => /Error|assert|回收|赢家|重叠|unparsable|actual|expected/.test(l)).slice(0, 6).join('\n').slice(0, 1500),
        }));
        failures.push({ lane, k, code, msgs });
      }
    }
  }),
);
const summary = {
  root: ROOT,
  file: FILE,
  node: process.version,
  parallel: PARALLEL,
  runs_per_lane: RUNS,
  total_runs: total,
  red_runs: redRuns,
  elapsed_s: Math.round((Date.now() - t0) / 1000),
  per_test: perTest,
  failures,
};
if (OUT) await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
const { failures: _f, ...brief } = summary;
console.log(JSON.stringify(brief, null, 2));
