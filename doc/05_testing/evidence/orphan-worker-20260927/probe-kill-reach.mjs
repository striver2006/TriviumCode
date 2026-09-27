#!/usr/bin/env node
/**
 * 只读实测（不碰真实 HOME、不改本仓）：派生后失败的孤儿 worker（EV-150）计划 §2 的两格。
 *
 *   K1 杀法够不够得到：按 spawnDetached 派生一个「worker」，它用 run() 以 killTree:true（审查员适配器的写法）
 *      与不带 killTree 各拉起一个子进程；然后照 cancelRun 的杀法 killProcessTree(worker, SIGTERM)，
 *      宽限 5 s 后看三者谁还活着、各自的进程组号。
 *   K2 父进程手里的子进程句柄：detached + unref 之后，exitCode / signalCode 在被回收之前是否恒为 null，
 *      按进程组发 SIGTERM 后 'exit' 事件是否到达、多久到达。
 *
 * 用法：node probe-kill-reach.mjs <仓库根>
 * 收尾：只结束命令行里带本次随机标记的进程；只删 mkdtemp 的返回值。
 */
import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(process.argv[2] ?? '.');
const EXEC = path.join(ROOT, 'dist/test/src/trivium/util/exec.js');
const { spawnDetached, killProcessTree } = await import(EXEC);
const MARK = 'probe-kill-reach-' + randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const psRows = () =>
  execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && { pid: +m[1], pgid: +m[2], ppid: +m[3], cmd: m[4] }; })
    .filter(Boolean);
const mine = () => psRows().filter((r) => r.cmd.includes(MARK) && !r.cmd.includes('probe-kill-reach.mjs'));

const out = { node: process.version, platform: process.platform };
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-kill-reach-'));
try {
  // ── K1 ──
  const workerJs = path.join(base, 'worker.mjs');
  await fs.writeFile(workerJs, [
    `import { run } from ${JSON.stringify(EXEC)};`,
    `// ${MARK}-worker`,
    `void run('/bin/sh', ['-c', 'sleep 120; : ${MARK}-tree'], { killTree: true, timeoutMs: 600000 });`,
    `void run('/bin/sh', ['-c', 'sleep 120; : ${MARK}-plain'], { timeoutMs: 600000 });`,
    `setInterval(() => {}, 1000);`,
  ].join('\n'));
  const w = await spawnDetached(process.execPath, [workerJs, MARK + '-worker'], { cwd: base, logFile: path.join(base, 'worker.log') });
  let rows = [];
  for (let i = 0; i < 40; i++) {
    rows = mine();
    if (rows.some((r) => r.cmd.includes(MARK + '-tree')) && rows.some((r) => r.cmd.includes(MARK + '-plain'))) break;
    await sleep(100);
  }
  const pick = (tag) => rows.find((r) => r.cmd.includes(`${MARK}-${tag}`) && r.cmd.startsWith('/bin/sh'));
  const before = { worker: rows.find((r) => r.pid === w.pid) ?? null, tree: pick('tree') ?? null, plain: pick('plain') ?? null };
  out.K1_before = {
    worker: before.worker && { pid: before.worker.pid, pgid: before.worker.pgid },
    treeChild: before.tree && { pid: before.tree.pid, pgid: before.tree.pgid, ppid: before.tree.ppid },
    plainChild: before.plain && { pid: before.plain.pid, pgid: before.plain.pgid, ppid: before.plain.ppid },
  };
  // 照 cancelRun：SIGTERM 进程组 → 宽限 5 s（worker 一退即止）
  out.K1_killDelivered = killProcessTree(w.pid, 'SIGTERM');
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && alive(w.pid)) await sleep(100);
  await sleep(500);
  const after = mine();
  out.K1_after = {
    workerAlive: alive(w.pid),
    workerGoneMs: Date.now() - t0,
    treeChildAlive: before.tree ? alive(before.tree.pid) : null,
    treeChildPpidNow: before.tree ? after.find((r) => r.pid === before.tree.pid)?.ppid ?? null : null,
    plainChildAlive: before.plain ? alive(before.plain.pid) : null,
    survivors: after.map((r) => ({ pid: r.pid, pgid: r.pgid, ppid: r.ppid, cmd: r.cmd.replace(MARK, '<MARK>').slice(0, 80) })),
  };

  // ── K2 ──
  const k2 = spawn(process.execPath, ['-e', `setInterval(()=>{},1000) // ${MARK}-k2`], { detached: true, stdio: 'ignore' });
  k2.unref();
  const exited = new Promise((resolve) => k2.once('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  await sleep(300);
  out.K2_beforeKill = { pid: k2.pid, exitCode: k2.exitCode, signalCode: k2.signalCode, alive: alive(k2.pid) };
  const t1 = Date.now();
  process.kill(-k2.pid, 'SIGTERM');
  const ev = await Promise.race([exited, sleep(3000).then(() => null)]);
  out.K2_afterKill = {
    exitEvent: ev && { code: ev.code, signal: ev.signal, ms: ev.at - t1 },
    exitCode: k2.exitCode, signalCode: k2.signalCode, alive: alive(k2.pid),
  };
} finally {
  for (const r of mine()) {
    process.stderr.write(`收尾：结束 ${r.pid}（${r.cmd.replace(MARK, '<MARK>').slice(0, 60)}）\n`);
    // 按进程组结束：sh 名下的 sleep 与它同组（组号 = sh 的 pid，K1_before 已记下）
    try { process.kill(-r.pgid, 'SIGKILL'); } catch { try { process.kill(r.pid, 'SIGKILL'); } catch { /* 已不在 */ } }
  }
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
