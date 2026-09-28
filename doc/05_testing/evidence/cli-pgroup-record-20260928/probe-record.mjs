#!/usr/bin/env node
// CLI进程组记录 计划期零配额探针（Node / macOS）。
//   Q1 AsyncLocalStorage：在 als.run 里经多层 await / setTimeout / 事件回调之后派生，派生点拿得到 store
//   Q2 ps lstart：detached 子进程在父进程被 SIGKILL、过继给 init 之后，lstart 不变、ppid = 1
//   Q3 事件循环被 Atomics.wait 堵住：装了 SIGTERM 监听的进程收到 SIGTERM 不退出、处理器不执行；SIGKILL 才退
//   Q4 ps lstart 随 TZ / 区域设置变化；LC_ALL=C TZ=UTC0 下与调用方环境无关（计划双审 r1 CODEX-01 之后补）
// 用法：node probe-record.mjs <仓库根>；输出 JSON。只写 mkdtemp，只按本次随机标记结束进程组。
import { spawn, execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARK = `trivium-probe-rec-${process.pid}-${Date.now()}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'probe-rec-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lstart = (pid) => { try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() || null; } catch { return null; } };
const ppid = (pid) => { try { return Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim()); } catch { return null; } };
const groupsWithMark = () => {
  const out = execFileSync('/bin/ps', ['-axo', 'pgid=,command='], { encoding: 'utf8' });
  const s = new Set();
  for (const l of out.split('\n')) { const m = /^\s*(\d+)\s+(.*)$/.exec(l); if (m && m[2].includes(MARK)) s.add(Number(m[1])); }
  return [...s];
};
const out = { node: process.version, platform: process.platform };

try {
  // ── Q1 ──
  const als = new AsyncLocalStorage();
  const seen = [];
  const fakeRun = () => new Promise((resolve) => {
    seen.push(als.getStore() ?? null);
    const c = spawn('/bin/sh', ['-c', 'exit 0'], { detached: true, stdio: 'ignore' });
    c.once('exit', () => { seen.push(als.getStore() ?? null); resolve(); });
  });
  const adapterLike = async () => { await sleep(10); await new Promise((r) => setImmediate(r)); await fakeRun(); await sleep(5); await fakeRun(); };
  await Promise.all([als.run('gemini', adapterLike), als.run('glm', adapterLike), fakeRun()]);
  out.Q1 = { seen, ok: seen.filter((x) => x === 'gemini').length === 4 && seen.filter((x) => x === 'glm').length === 4 && seen.filter((x) => x === null).length === 2 };

  // ── Q2 ──
  const workerSrc = path.join(tmp, 'w.mjs');
  writeFileSync(workerSrc, `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const c = spawn('/bin/sh', ['-c', 'sleep 60; : "$0"', ${JSON.stringify(MARK)}], { detached: true, stdio: ['pipe','pipe','pipe'] });
    writeFileSync(${JSON.stringify(path.join(tmp, 'cli.pid'))}, String(c.pid));
    setInterval(() => {}, 1000);
  `);
  const w = spawn(process.execPath, [workerSrc, MARK], { detached: true, stdio: 'ignore' });
  for (let i = 0; i < 50 && !existsSync(path.join(tmp, 'cli.pid')); i++) await sleep(50);
  const cliPid = Number(readFileSync(path.join(tmp, 'cli.pid'), 'utf8'));
  await sleep(200);
  const before = { lstart: lstart(cliPid), ppid: ppid(cliPid) };
  process.kill(-w.pid, 'SIGKILL');
  await sleep(500);
  const after = { lstart: lstart(cliPid), ppid: ppid(cliPid) };
  out.Q2 = { workerPid: w.pid, cliPid, before, after, ok: before.lstart !== null && before.lstart === after.lstart && before.ppid === w.pid && after.ppid === 1 };
  try { process.kill(-cliPid, 'SIGKILL'); } catch {}

  // ── Q3 ──
  const blockSrc = path.join(tmp, 'b.mjs');
  writeFileSync(blockSrc, `
    import { appendFileSync } from 'node:fs';
    const log = ${JSON.stringify(path.join(tmp, 'b.log'))};
    process.on('SIGTERM', () => { appendFileSync(log, 'handler\\n'); process.exit(0); });
    appendFileSync(log, 'ready\\n');
    setTimeout(() => { appendFileSync(log, 'blocking\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); }, 100);
  `);
  const b = spawn(process.execPath, [blockSrc, MARK], { detached: true, stdio: 'ignore' });
  const bExit = new Promise((r) => b.once('exit', (code, signal) => r({ code, signal, at: Date.now() })));
  await sleep(600);
  process.kill(-b.pid, 'SIGTERM');
  await sleep(1500);
  const aliveAfterTerm = b.exitCode === null && b.signalCode === null;
  const t0 = Date.now();
  process.kill(-b.pid, 'SIGKILL');
  const ex = await bExit;
  out.Q3 = { aliveAfterTerm, exit: { code: ex.code, signal: ex.signal, afterKillMs: ex.at - t0 }, log: readFileSync(path.join(tmp, 'b.log'), 'utf8').trim().split('\n'), ok: aliveAfterTerm && ex.signal === 'SIGKILL' && !readFileSync(path.join(tmp, 'b.log'), 'utf8').includes('handler') };

  // ── Q4（计划双审 r1 CODEX-01 之后补）：同一进程的 lstart 随 TZ / 区域设置变化；LC_ALL=C TZ=UTC0 下与调用方环境无关 ──
  const envs = { default: {}, TZ_UTC: { TZ: 'UTC' }, TZ_Tokyo: { TZ: 'Asia/Tokyo' }, LC_fr: { LC_ALL: 'fr_FR.UTF-8' }, LC_TIME_zh: { LC_TIME: 'zh_CN.UTF-8' }, canonical: { LC_ALL: 'C', TZ: 'UTC0' }, canonical_from_tokyo_fr: { TZ: 'UTC0', LC_ALL: 'C', LANG: 'fr_FR.UTF-8' } };
  const q4 = {};
  for (const [k, e] of Object.entries(envs)) q4[k] = execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8', env: { ...process.env, ...e } }).trim();
  const distinct = new Set(['default', 'TZ_UTC', 'TZ_Tokyo', 'LC_fr', 'LC_TIME_zh'].map((k) => q4[k])).size;
  out.Q4 = { lstart: q4, ok: distinct >= 4 && q4.canonical === q4.canonical_from_tokyo_fr };
} finally {
  for (const g of groupsWithMark()) { try { process.kill(-g, 'SIGKILL'); } catch {} }
  await sleep(200);
  out.leftover = groupsWithMark();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
