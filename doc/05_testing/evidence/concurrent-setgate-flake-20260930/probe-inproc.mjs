#!/usr/bin/env node
/**
 * 零配额探针 · 同进程并发写闸门（并发写闸门偶发红，EV-153）。
 *
 * 形状与 `test/unit/state.test.ts`「并发 setGate 不丢更新」逐字相同：同一进程、新建的 trivium 目录、N（缺省 8）个
 * `setGate` 同时发起、`heartbeatStaleMs` 120 s。循环 R 轮，每轮记下：每个写者的结局（兑现 / 拒绝的退出码与**完整**文案）、
 * 抢锁尝试次数与撞 EEXIST 次数、耗时、它名下打出的告警；状态文件「读 → 写回」区间是否交叠（交叠即两个写者同时在临界区）；
 * 最终闸门集合与缺失的键。不改 src——只在本进程里给 `fs.promises` 与 `child_process.spawn` 打桩计数 / 注入。
 *
 * 用法：node probe-inproc.mjs --root 〈构建树根〉 [--rounds 200] [--writers 8] [--mode natural|widen|psfail]
 *                              [--psfail-rate 0.3] [--out 〈JSON〉] [--lane 0]
 *   构建树根下要有 dist/test/src/trivium/state.js（先 `node scripts/build.mjs --tests-only`）。
 *
 * 三种模式：
 * - natural：不注入，只计数（含 `ps` 派生次数、失败次数、最长耗时）。负载由外部给（多路并发、与全量并行）。
 * - widen：撞 EEXIST 之后读锁文件的那一次（旧构建 readFile、新构建 open）前随机等 0～3 ms——只拉宽「持有者恰在此刻释放」
 *   的时间窗，放大③（EV-173 同进程形态），不改任何判定。
 * - psfail：以 --psfail-rate 的概率让 `/bin/ps` 派生失败（改派生一个不存在的可执行文件，`run()` 得 code null），
 *   模拟满载下派生失败（EAGAIN 等）；验证④：同进程活锁因取不到启动时刻被判 `pid_reused` 回收。
 * 另可叠加 --hold-ms X（任一模式）：写者读完状态文件后随机等 0～X ms 再写回——模拟满载下临界区 I/O 变慢，
 *   只拉长持锁时长，不改判定；持有者临界区不再快过等待者的判定时，回收才可能落在活锁上。
 */
import path from 'node:path';
import os from 'node:os';
import fsMod, { promises as fs } from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg('root', process.cwd()));
const ROUNDS = Number(arg('rounds', '200'));
const WRITERS = Number(arg('writers', '8'));
const MODE = arg('mode', 'natural');
const PSFAIL_RATE = Number(arg('psfail-rate', '0.3'));
const OUT = arg('out', null);
const LANE = Number(arg('lane', '0'));
const HOLD_MS = Number(arg('hold-ms', '0'));
const STALE = 120_000;
if (!['natural', 'widen', 'psfail'].includes(MODE)) throw new Error(`未知模式 ${MODE}`);

const als = new AsyncLocalStorage();

// ── child_process.spawn：计数 `ps`，psfail 模式下按概率注入失败。exec.ts 用具名导入，靠 syncBuiltinESMExports 让绑定生效 ──
const ps = { spawned: 0, failed: 0, injected: 0, max_ms: 0, total_ms: 0 };
const origSpawn = cp.spawn;
cp.spawn = function (bin, args, opts) {
  if (bin !== '/bin/ps') return origSpawn.call(this, bin, args, opts);
  ps.spawned++;
  const t0 = Date.now();
  const inject = MODE === 'psfail' && als.getStore() !== undefined && Math.random() < PSFAIL_RATE;
  if (inject) ps.injected++;
  const child = origSpawn.call(this, inject ? '/nonexistent/trivium-probe-ps' : bin, args, opts);
  let done = false;
  const end = (bad) => {
    if (done) return;
    done = true;
    const ms = Date.now() - t0;
    ps.total_ms += ms;
    if (ms > ps.max_ms) ps.max_ms = ms;
    if (bad) ps.failed++;
  };
  child.on('error', () => end(true));
  child.on('close', (code) => end(code !== 0));
  return child;
};
syncBuiltinESMExports();

const state = await import(path.join(ROOT, 'dist/test/src/trivium/state.js'));
const { EXIT } = await import(path.join(ROOT, 'dist/test/src/trivium/exit-codes.js'));

// ── fs.promises 桩：按写者记 link 尝试、EEXIST、状态文件读改写区间；widen 模式拉宽读锁前的窗口 ──
const P = fsMod.promises;
const orig = { link: P.link, readFile: P.readFile, open: P.open, rename: P.rename };
let ctx = null; // 本轮：{ lockPath, statePath, active:Set, overlaps:[] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

P.link = async function (src, dst, ...rest) {
  const w = als.getStore();
  if (!w || !ctx || dst !== ctx.lockPath) return orig.link.call(this, src, dst, ...rest);
  w.attempts++;
  try {
    const r = await orig.link.call(this, src, dst, ...rest);
    w.acquired_at_ms = Date.now() - ctx.t0;
    return r;
  } catch (e) {
    if (e?.code === 'EEXIST') w.eexist++;
    throw e;
  }
};
const beforeLockRead = async (p) => {
  const w = als.getStore();
  if (MODE === 'widen' && w && ctx && p === ctx.lockPath) await sleep(Math.floor(Math.random() * 4));
};
P.open = async function (p, ...rest) {
  await beforeLockRead(p);
  return orig.open.call(this, p, ...rest);
};
P.readFile = async function (p, ...rest) {
  await beforeLockRead(p);
  const w = als.getStore();
  if (w && ctx && p === ctx.statePath) {
    // 状态文件读：进入读改写区间
    ctx.active.add(w.id);
    w.rmw_enter++;
    if (ctx.active.size > 1) ctx.overlaps.push({ at_ms: Date.now() - ctx.t0, writers: [...ctx.active] });
  }
  const r = await orig.readFile.call(this, p, ...rest);
  if (HOLD_MS > 0 && w && ctx && p === ctx.statePath) await sleep(Math.floor(Math.random() * (HOLD_MS + 1)));
  return r;
};
P.rename = async function (src, dst, ...rest) {
  const w = als.getStore();
  const tracked = w && ctx && dst === ctx.statePath;
  try {
    return await orig.rename.call(this, src, dst, ...rest);
  } catch (e) {
    if (tracked) w.rename_errors.push(e?.code ?? String(e));
    throw e;
  } finally {
    if (tracked) ctx.active.delete(w.id); // 写回结束（成功或失败）：离开读改写区间
  }
};

// ── stderr：告警按写者归属 ──
const origWrite = process.stderr.write.bind(process.stderr);
let captured = null;
process.stderr.write = (chunk, ...rest) => {
  if (captured) {
    const w = als.getStore();
    for (const line of String(chunk).split('\n')) if (line.trim()) captured.push({ writer: w?.id ?? null, line });
    return true;
  }
  return origWrite(chunk, ...rest);
};

function classify(r) {
  const reclaim = r.warnings.filter((x) => x.line.includes('回收主题'));
  const reasons = [...new Set(reclaim.map((x) => (x.line.match(/原因 (\w+)/) ?? [])[1] ?? '其他'))];
  const rejected = r.writers.filter((w) => w.outcome === 'rejected');
  const red = rejected.length > 0 || r.missing.length > 0;
  // 红轮按本轮出现过的回收原因组合标注：unparsable ⇒ ③（EEXIST 后锁恰被释放的误判），pid_reused / pid_gone ⇒ ④（取不到启动时刻）
  const tags = [];
  if (reasons.includes('unparsable')) tags.push('③');
  if (reasons.includes('pid_reused') || reasons.includes('pid_gone')) tags.push('④');
  let cls;
  if (!red) cls = reclaim.length > 0 ? 'green_with_reclaim' : 'green';
  else if (reclaim.length > 0) cls = `${tags.join('+') || '?'} 回收（${[...reasons].sort().join('+')}）`;
  else if (rejected.length > 0 && rejected.every((w) => w.code === EXIT.LOCKED)) cls = '① 预算耗尽抛 70';
  else if (rejected.length === 0) cls = '② 无告警丢更新';
  else cls = '其他拒绝';
  return { red, cls, reasons };
}

async function round(k) {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-setgate-')));
  ctx = {
    t0: Date.now(),
    lockPath: path.join(d, 'lock', '.global-state.lock'),
    statePath: path.join(d, 'state.json'),
    active: new Set(),
    overlaps: [],
  };
  captured = [];
  const ws = Array.from({ length: WRITERS }, (_, i) => ({
    id: i, attempts: 0, eexist: 0, rmw_enter: 0, rename_errors: [], acquired_at_ms: null,
    outcome: null, code: null, message: null, elapsed_ms: null,
  }));
  const t0 = Date.now();
  await Promise.all(
    ws.map((w) =>
      als.run(w, async () => {
        try {
          await state.setGate({
            triviumDir: d, topic: `T${w.id}`, stage: 'plan', state: 'awaiting_approval', heartbeatStaleMs: STALE,
          });
          w.outcome = 'fulfilled';
        } catch (e) {
          w.outcome = 'rejected';
          w.code = e?.code ?? null;
          w.message = String(e?.stack ?? e?.message ?? e);
        } finally {
          w.elapsed_ms = Date.now() - t0;
        }
      }),
    ),
  );
  const elapsed = Date.now() - t0;
  const warnings = captured;
  captured = null;
  let keys = [];
  let readError = null;
  try {
    keys = Object.keys((await state.readState(d)).gates).sort();
  } catch (e) {
    readError = String(e?.message ?? e);
  }
  const expected = ws.map((w) => `T${w.id}/plan`);
  const missing = expected.filter((x) => !keys.includes(x));
  const leftovers = (await fs.readdir(path.join(d, 'lock')).catch(() => [])).filter((n) => n !== '.global-state.lock' || true);
  const r = { k, elapsed_ms: elapsed, writers: ws, warnings, keys, missing, read_error: readError, overlaps: ctx.overlaps, lock_dir_after: leftovers };
  ctx = null;
  await fs.rm(d, { recursive: true, force: true });
  return { ...r, ...classify(r) };
}

const t0 = Date.now();
const byClass = {};
const reds = [];
const greensWithReclaim = [];
const attemptsHist = {};
const elapsed = [];
let overlapRounds = 0;
for (let k = 0; k < ROUNDS; k++) {
  const r = await round(k);
  byClass[r.cls] = (byClass[r.cls] ?? 0) + 1;
  elapsed.push(r.elapsed_ms);
  if (r.overlaps.length > 0) overlapRounds++;
  for (const w of r.writers) attemptsHist[w.attempts] = (attemptsHist[w.attempts] ?? 0) + 1;
  if (r.red) reds.push(r);
  else if (r.cls === 'green_with_reclaim') greensWithReclaim.push({ k: r.k, warnings: r.warnings, overlaps: r.overlaps });
}
elapsed.sort((a, b) => a - b);
const pct = (q) => elapsed[Math.min(elapsed.length - 1, Math.floor(q * elapsed.length))];
const summary = {
  root: ROOT,
  node: process.version,
  lane: LANE,
  mode: MODE,
  hold_ms: HOLD_MS,
  ...(MODE === 'psfail' ? { psfail_rate: PSFAIL_RATE } : {}),
  rounds: ROUNDS,
  writers: WRITERS,
  elapsed_s: Math.round((Date.now() - t0) / 1000),
  by_class: byClass,
  red_rounds: reds.length,
  overlap_rounds: overlapRounds,
  max_attempts: Math.max(...Object.keys(attemptsHist).map(Number)),
  attempts_hist: attemptsHist,
  round_ms: { p50: pct(0.5), p95: pct(0.95), max: elapsed.at(-1) },
  ps,
  reds,
  greens_with_reclaim: greensWithReclaim,
};
process.stderr.write = origWrite;
const text = JSON.stringify(summary, null, 2) + '\n';
if (OUT) await fs.writeFile(OUT, text);
const { reds: _r, greens_with_reclaim: _g, ...brief } = summary;
console.log(JSON.stringify(brief));
