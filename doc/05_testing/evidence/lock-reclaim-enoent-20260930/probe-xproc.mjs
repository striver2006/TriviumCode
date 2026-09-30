#!/usr/bin/env node
/**
 * 零配额探针 · 多进程统计（锁回收误判已删锁文件，EV-173 / EV-149）。
 *
 * 在临时目录里按 lock-cross-process.test.ts 两条用例的原形状反复起真进程抢锁，K 轮并发制造满载，记下：
 *   - e149：每个进程的启动时刻、起跑时刻、拿到/释放时刻与 stderr；判「两个赢家」属于哪一种——
 *           持锁区间重叠（真双持有）还是先后不重叠（晚启动者在赢家释放后合法拿锁，用例误判）；
 *   - x1：亚秒阈值（50 ms）下 withTopicLock 慢临界区，数「回收主题」告警及其原因、区内最大人数、计数是否丢更新。
 * 不改 src；每轮只写自己的 mkdtemp。
 *
 * 用法：node probe-xproc.mjs --scenario e149|x1 --rounds N --parallel K [--lock 〈lock.js 路径〉]
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SCENARIO = arg('scenario', 'e149');
const ROUNDS = Number(arg('rounds', '40'));
const PARALLEL = Number(arg('parallel', '8'));
const LOCK_MODULE = path.resolve(arg('lock', path.join(ROOT, 'dist/test/src/trivium/lock.js')));
const TOPIC = '跨进程抢锁';

const WORKER = `
import { performance } from 'node:perf_hooks';
const [LOCK, dir, startAtRaw, idRaw, scenario] = process.argv.slice(2);
const bootAt = performance.timeOrigin;
const startAt = Number(startAtRaw);
const id = Number(idRaw);
const lock = await import(LOCK);
const readyAt = Date.now();
while (Date.now() < startAt) {}
const now = () => performance.timeOrigin + performance.now();
let out;
try {
  if (scenario === 'e149') {
    const h = await lock.acquireLock({ triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, runId: 'R-' + id,
      kind: 'run', heartbeatStaleMs: 120000, retries: 0 });
    const acq = now();
    await new Promise((r) => setTimeout(r, 900));
    const rel = now();
    await h.release();
    out = { ok: true, acq, rel };
  } else {
    const { appendFileSync, promises: fsp } = await import('node:fs');
    const counter = dir + '/counter.json';
    const trace = dir + '/trace.log';
    await lock.withTopicLock({ triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, heartbeatStaleMs: 50, retries: 200, retryDelayMs: 50 },
      async () => {
        appendFileSync(trace, '+' + id + '\\n');
        const cur = JSON.parse(await fsp.readFile(counter, 'utf8'));
        await new Promise((r) => setTimeout(r, 250));
        await fsp.writeFile(counter, JSON.stringify({ n: cur.n + 1 }));
        appendFileSync(trace, '-' + id + '\\n');
      });
    out = { ok: true };
  }
} catch (e) {
  out = { ok: false, code: e && e.code, message: String(e && e.message).split('\\n')[0] };
}
process.stdout.write(JSON.stringify({ id, bootAt, readyAt, startAt, ...out }) + '\\n');
process.exit(0);
`;

function runNode(args, cwd) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '';
    let se = '';
    c.stdout.on('data', (d) => (so += d));
    c.stderr.on('data', (d) => (se += d));
    c.on('close', (code) => resolve({ code, stdout: so, stderr: se }));
  });
}

async function oneRound(idx) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-xproc-')));
  try {
    const script = path.join(dir, 'worker.mjs');
    await fs.writeFile(script, WORKER, 'utf8');
    const n = SCENARIO === 'e149' ? 5 : 4;
    if (SCENARIO === 'e149') {
      await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
      const dead = {
        topic: TOPIC, stage: 'code', run_id: 'R-DEAD', pid: 2 ** 22, pid_started_at: null,
        acquired_at: new Date(Date.now() - 60_000).toISOString(), kind: 'run',
      };
      await fs.writeFile(path.join(dir, 'lock', `${TOPIC}.lock`), JSON.stringify(dead, null, 2) + '\n');
    } else {
      await fs.writeFile(path.join(dir, 'counter.json'), JSON.stringify({ n: 0 }));
    }
    const startAt = Date.now() + 700;
    const res = await Promise.all(
      Array.from({ length: n }, (_, i) => runNode([script, LOCK_MODULE, dir, String(startAt), String(i), SCENARIO], dir)),
    );
    const workers = res.map((r, i) => {
      const line = r.stdout.trim().split('\n').filter(Boolean).pop();
      const j = line ? JSON.parse(line) : { id: i, ok: false, message: '无输出' };
      const reasons = [...r.stderr.matchAll(/遗留锁（原因 (\w+)/g)].map((m) => m[1]);
      // 修后 reclaimStaleLock 复验不符、link 放不回时的告警（计划 r2 D4）：命中残余窗口的直接证据
      for (const _ of r.stderr.matchAll(/挪走了一把新建的锁且放不回/g)) reasons.push('displaced_unrestorable');
      return { ...j, reclaim_reasons: reasons };
    });
    const round = { idx, workers };
    if (SCENARIO === 'e149') {
      const winners = workers.filter((w) => w.ok);
      round.winners = winners.length;
      let overlap = false;
      for (let a = 0; a < winners.length; a++)
        for (let b = a + 1; b < winners.length; b++)
          if (winners[a].acq < winners[b].rel && winners[b].acq < winners[a].rel) overlap = true;
      round.overlap = overlap;
      round.late_boot = workers.filter((w) => w.readyAt > w.startAt).map((w) => w.id);
    } else {
      const lines = (await fs.readFile(path.join(dir, 'trace.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
      let inside = 0;
      let maxInside = 0;
      for (const l of lines) {
        inside += l.startsWith('+') ? 1 : -1;
        maxInside = Math.max(maxInside, inside);
      }
      round.max_inside = maxInside;
      round.final_n = JSON.parse(await fs.readFile(path.join(dir, 'counter.json'), 'utf8')).n;
      round.all_ok = workers.every((w) => w.ok);
    }
    return round;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const t0 = Date.now();
const rounds = [];
let next = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (next < ROUNDS) {
      const i = next++;
      rounds.push(await oneRound(i));
    }
  }),
);
rounds.sort((a, b) => a.idx - b.idx);

const reasonCount = {};
for (const r of rounds) for (const w of r.workers) for (const x of w.reclaim_reasons) reasonCount[x] = (reasonCount[x] ?? 0) + 1;
const summary = {
  scenario: SCENARIO,
  lock_module: path.relative(ROOT, LOCK_MODULE),
  rounds: ROUNDS,
  parallel: PARALLEL,
  elapsed_s: Math.round((Date.now() - t0) / 1000),
  reclaim_reason_counts: reasonCount,
};
if (SCENARIO === 'e149') {
  const bad = rounds.filter((r) => r.winners !== 1);
  summary.rounds_multi_winner = bad.length;
  summary.rounds_multi_winner_overlapping = bad.filter((r) => r.overlap).length;
  summary.rounds_multi_winner_sequential = bad.filter((r) => !r.overlap && r.winners > 1).length;
  summary.rounds_zero_winner = rounds.filter((r) => r.winners === 0).length;
  summary.rounds_with_unparsable_warn = rounds.filter((r) => r.workers.some((w) => w.reclaim_reasons.includes('unparsable'))).length;
  summary.rounds_with_late_boot = rounds.filter((r) => r.late_boot.length > 0).length;
  summary.bad_rounds = bad;
} else {
  summary.rounds_with_reclaim_warn = rounds.filter((r) => r.workers.some((w) => w.reclaim_reasons.length > 0)).length;
  summary.rounds_max_inside_gt1 = rounds.filter((r) => r.max_inside > 1).length;
  summary.rounds_lost_update = rounds.filter((r) => r.final_n !== 4).length;
  summary.rounds_not_all_ok = rounds.filter((r) => !r.all_ok).length;
  summary.bad_rounds = rounds.filter((r) => r.workers.some((w) => w.reclaim_reasons.length > 0) || r.max_inside > 1 || r.final_n !== 4 || !r.all_ok);
}
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
