#!/usr/bin/env node
/**
 * 满载运行器（并发写闸门偶发红，EV-153）：probe-inproc.mjs 开 L 路并发、每路 R 轮；可选同时在同一构建树上跑全量测试
 * （`node --test dist/test/**∕*.test.js`，探针跑完前全量跑完就再起一遍）当背景负载。汇总各路读数，红轮全文保留。
 *
 * 用法：node load-run.mjs --root 〈构建树根〉 --out 〈JSON〉 [--lanes 8] [--rounds 60] [--mode natural]
 *                         [--hold-ms 0] [--psfail-rate 0.3] [--with-suite] [--burn 0]
 *   --burn N：另起 N 个纯 CPU 忙循环的 node 进程，探针跑完即结束（按 pid 逐个 SIGKILL）。
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg('root', process.cwd()));
const OUT = arg('out', null);
const LANES = Number(arg('lanes', '8'));
const ROUNDS = arg('rounds', '60');
const MODE = arg('mode', 'natural');
const HOLD = arg('hold-ms', '0');
const RATE = arg('psfail-rate', '0.3');
const WITH_SUITE = process.argv.includes('--with-suite');
const BURN = Number(arg('burn', '0'));
if (!OUT) throw new Error('缺 --out');

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev153-load-'));
const run = (args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  });

let lanesDone = false;
const suiteRuns = [];
const suite = (async () => {
  if (!WITH_SUITE) return;
  while (!lanesDone) {
    const t0 = Date.now();
    const r = await run(['--test', 'dist/test/**/*.test.js'], { cwd: ROOT });
    const tail = (k) => (r.out.match(new RegExp(`^ℹ ${k} (\\d+)$`, 'm')) ?? [])[1] ?? null;
    // 失败时截失败用例块全文（汇总段 ✖ failing tests: 之后），不只存计数
    const failing = r.code !== 0 ? (r.out.split('✖ failing tests:')[1] ?? r.out.slice(-6000)).slice(0, 12000) : undefined;
    suiteRuns.push({ code: r.code, s: Math.round((Date.now() - t0) / 1000), tests: tail('tests'), fail: tail('fail'), finished_after_lanes: lanesDone, failing });
  }
})();

const burners = Array.from({ length: BURN }, () =>
  spawn(process.execPath, ['-e', 'for(;;){}', '--', 'trivium-ev153-burn'], { stdio: 'ignore' }),
);
const t0 = Date.now();
const lanes = await Promise.all(
  Array.from({ length: LANES }, async (_, lane) => {
    const out = path.join(tmpDir, `lane-${lane}.json`);
    const r = await run([
      path.join(HERE, 'probe-inproc.mjs'), '--root', ROOT, '--rounds', ROUNDS, '--mode', MODE,
      '--hold-ms', HOLD, '--psfail-rate', RATE, '--lane', String(lane), '--out', out,
    ]);
    if (r.code !== 0) return { lane, error: r.out.slice(-2000) };
    return JSON.parse(await fs.readFile(out, 'utf8'));
  }),
);
lanesDone = true;
for (const b of burners) b.kill('SIGKILL');
const laneSeconds = Math.round((Date.now() - t0) / 1000);
await suite;

const sum = { rounds: 0, red_rounds: 0, overlap_rounds: 0, by_class: {}, attempts_hist: {}, max_attempts: 0, round_ms_max: 0, ps: { spawned: 0, failed: 0, injected: 0, max_ms: 0 } };
const reds = [];
const greensWithReclaim = [];
const errors = [];
for (const l of lanes) {
  if (l.error) {
    errors.push(l);
    continue;
  }
  sum.rounds += l.rounds;
  sum.red_rounds += l.red_rounds;
  sum.overlap_rounds += l.overlap_rounds;
  for (const [k, v] of Object.entries(l.by_class)) sum.by_class[k] = (sum.by_class[k] ?? 0) + v;
  for (const [k, v] of Object.entries(l.attempts_hist)) sum.attempts_hist[k] = (sum.attempts_hist[k] ?? 0) + v;
  sum.max_attempts = Math.max(sum.max_attempts, l.max_attempts);
  sum.round_ms_max = Math.max(sum.round_ms_max, l.round_ms.max);
  for (const k of ['spawned', 'failed', 'injected']) sum.ps[k] += l.ps[k];
  sum.ps.max_ms = Math.max(sum.ps.max_ms, l.ps.max_ms);
  for (const r of l.reds) reds.push({ lane: l.lane, ...r });
  for (const g of l.greens_with_reclaim) greensWithReclaim.push({ lane: l.lane, ...g });
}
const summary = {
  root: ROOT,
  node: process.version,
  at: new Date().toISOString(),
  lanes: LANES,
  rounds_per_lane: Number(ROUNDS),
  mode: MODE,
  hold_ms: Number(HOLD),
  ...(MODE === 'psfail' ? { psfail_rate: Number(RATE) } : {}),
  with_suite: WITH_SUITE,
  burn: BURN,
  lane_elapsed_s: laneSeconds,
  suite_runs: suiteRuns,
  ...sum,
  lane_errors: errors,
  reds,
  greens_with_reclaim: greensWithReclaim,
};
await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
await fs.rm(tmpDir, { recursive: true, force: true });
const { reds: _r, greens_with_reclaim: _g, ...brief } = summary;
console.log(JSON.stringify(brief));
