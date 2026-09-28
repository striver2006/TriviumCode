#!/usr/bin/env node
/**
 * 只读实测（零配额，不碰真实 HOME、不改本仓）：取消够不到审查员CLI（EV-152）计划 §2。
 *
 *   P 系列：被遗弃的「CLI」在 stdout / stderr 管道断开之后会不会自行退出。
 *     照生产形状搭：spawnDetached 派生一个 node「worker」，它用仓库构建的 run() 以 killTree:true
 *     （适配器的写法）拉起一个假 CLI；然后照 cancelRun 的杀法 killProcessTree(worker, SIGTERM)，
 *     之后 1 s / 3 s / 6 s 看假 CLI 所在的进程组还有没有成员。
 *   H 系列：修法 ① 的原型——worker 装 SIGTERM 处理器，转发给自己拉起的 CLI 进程组
 *     （宽限 1.5 s 后 SIGKILL），确认退出后以 SIGTERM 重新自杀；
 *     H1 按组 SIGTERM（处理器会跑），H2 按组 SIGKILL（处理器跑不到）。
 *
 * 用法：node probe-pipe-break.mjs <仓库根>
 * 收尾：只结束命令行里带本次随机标记的进程（按进程组结束）；只删 mkdtemp 的返回值。
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(process.argv[2] ?? '.');
const EXEC = path.join(ROOT, 'dist/test/src/trivium/util/exec.js');
const { spawnDetached, killProcessTree } = await import(EXEC);
const MARK = 'probe-pipe-break-' + randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function psRows() {
  const text = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,ppid=,stat=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(raw);
    if (m) rows.push({ pid: +m[1], pgid: +m[2], ppid: +m[3], stat: m[4], cmd: m[5] });
  }
  return rows;
}
function groupMembers(pgid) {
  const out = [];
  for (const r of psRows()) if (r.pgid === pgid) out.push({ pid: r.pid, ppid: r.ppid, stat: r.stat, cmd: r.cmd.replace(MARK, '<MARK>').slice(0, 70) });
  return out;
}
function mine() {
  const out = [];
  for (const r of psRows()) if (r.cmd.includes(MARK) && !r.cmd.includes('probe-pipe-break.mjs')) out.push(r);
  return out;
}

// ── 假 CLI（tag 进命令行，供 ps 认出）──
const nodeCli = (tag, body) => ({ bin: process.execPath, args: ['-e', `${body} // ${MARK}-${tag}`] });
const shCli = (tag, body) => ({ bin: '/bin/sh', args: ['-c', `${body}; : ${MARK}-${tag}`] });
const CASES = [
  { id: 'P1', what: 'sh 每 0.5 s 往 stdout 写一行', cli: shCli('P1', 'while :; do echo tick; sleep 0.5; done') },
  { id: 'P2', what: 'node 每 0.5 s 往 stdout 写一行（不接 error）', cli: nodeCli('P2', "setInterval(function(){process.stdout.write('tick\\n')},500)") },
  { id: 'P3', what: 'node 每 0.5 s 往 stdout 写一行，吞掉 stdout 的 error', cli: nodeCli('P3', "process.stdout.on('error',function(){});setInterval(function(){process.stdout.write('tick\\n')},500)") },
  { id: 'P4', what: 'node 每 0.5 s 只往 stderr 写一行（不接 error）', cli: nodeCli('P4', "setInterval(function(){process.stderr.write('tick\\n')},500)") },
  { id: 'P5', what: 'node 静默（不写输出，模拟长时间等模型回包）', cli: nodeCli('P5', 'setInterval(function(){},1000)') },
  { id: 'P6', what: 'sh 忽略 SIGPIPE 后每 0.5 s 往 stdout 写一行（写失败即忽略）', cli: shCli('P6', "trap '' PIPE; while :; do echo tick 2>/dev/null; sleep 0.5; done") },
  { id: 'P7', what: 'pty 包装（script）下 sh 每 0.5 s 写一行', cli: shCli('P7', 'while :; do echo tick; sleep 0.5; done'), pty: true },
  { id: 'P8', what: 'pty 包装（script）下 sh 静默', cli: shCli('P8', 'sleep 120'), pty: true },
];

async function runPCase(base, c) {
  const workerJs = path.join(base, `worker-${c.id}.mjs`);
  await fs.writeFile(workerJs, [
    `import { run } from ${JSON.stringify(EXEC)};`,
    `// ${MARK}-worker-${c.id}`,
    `void run(${JSON.stringify(c.cli.bin)}, ${JSON.stringify(c.cli.args)}, { killTree: true, timeoutMs: 600000${c.pty ? ', pty: true' : ''} });`,
    'setInterval(function(){}, 1000);',
  ].join('\n'));
  // worker 的 argv 带标记：否则它不进收尾清单（第 1 版 P7/P8 走早退分支时留下了 worker，按进程组补结束）
  const w = await spawnDetached(process.execPath, [workerJs, `${MARK}-worker-${c.id}`], { cwd: base, logFile: path.join(base, `worker-${c.id}.log`) });
  let cli = null;
  for (let i = 0; i < 50 && !cli; i++) {
    await sleep(100);
    cli = psRows().find(function (r) { return r.cmd.includes(`${MARK}-${c.id}`) && r.ppid === w.pid; }) ?? null;
  }
  if (!cli) {
    killProcessTree(w.pid, 'SIGKILL');
    const log = await fs.readFile(path.join(base, `worker-${c.id}.log`), 'utf8').catch(function () { return ''; });
    return { id: c.id, what: c.what, pty: c.pty === true, error: '假 CLI 没起来', workerLog: log.slice(0, 300) };
  }
  await sleep(1200); // 让写者先正常写几行
  const taggedBefore = [];
  for (const r of mine()) if (r.cmd.includes(`${MARK}-${c.id}`)) taggedBefore.push({ pid: r.pid, pgid: r.pgid, ppid: r.ppid, cmd: r.cmd.replace(MARK, '<MARK>').slice(0, 70) });
  const before = { worker: w.pid, cliPid: cli.pid, cliPgid: cli.pgid, members: groupMembers(cli.pgid), tagged: taggedBefore };
  killProcessTree(w.pid, 'SIGTERM');
  const t0 = Date.now();
  const probes = {};
  for (const at of [1000, 3000, 6000]) {
    while (Date.now() - t0 < at) await sleep(50);
    // pty 包装下内层进程由 script 另起会话、不在 script 的组里：按标记另列一份
    const tagged = [];
    for (const r of mine()) if (r.cmd.includes(`${MARK}-${c.id}`)) tagged.push({ pid: r.pid, pgid: r.pgid, ppid: r.ppid, stat: r.stat, cmd: r.cmd.replace(MARK, '<MARK>').slice(0, 70) });
    probes[`${at / 1000}s`] = { workerAlive: alive(w.pid), groupMembers: groupMembers(cli.pgid), tagged };
  }
  return { id: c.id, what: c.what, pty: c.pty === true, before, after: probes };
}

async function runHCase(base, id, sig) {
  const workerJs = path.join(base, `worker-${id}.mjs`);
  await fs.writeFile(workerJs, [
    "import { spawn } from 'node:child_process';",
    `import { killProcessTree } from ${JSON.stringify(EXEC)};`,
    `// ${MARK}-worker-${id}`,
    'const kids = [];',
    'function launch(cmd) {',
    "  const c = spawn('/bin/sh', ['-c', cmd], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });",
    "  c.stdout.resume(); c.stderr.resume(); c.stdin.end();",
    '  kids.push(c);',
    '}',
    `launch('sleep 120; : ${MARK}-${id}-plain');`,
    `launch("trap '' TERM; sleep 120; : ${MARK}-${id}-ignterm");`,
    'function gone(c) { return c.exitCode !== null || c.signalCode !== null; }',
    'function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }',
    "process.once('SIGTERM', async function () {",
    '  const t0 = Date.now();',
    "  for (const c of kids) if (!gone(c)) killProcessTree(c.pid, 'SIGTERM');",
    '  while (Date.now() - t0 < 1500 && !kids.every(gone)) await wait(50);',
    "  for (const c of kids) if (!gone(c)) killProcessTree(c.pid, 'SIGKILL');",
    '  while (Date.now() - t0 < 2500 && !kids.every(gone)) await wait(50);',
    "  process.kill(process.pid, 'SIGTERM');",
    '});',
    'setInterval(function(){}, 1000);',
  ].join('\n'));
  let watchRef = null;
  const w = await spawnDetached(process.execPath, [workerJs, `${MARK}-worker-${id}`], {
    cwd: base, logFile: path.join(base, `worker-${id}.log`),
    onSpawned: function (_pid, watch) { watchRef = watch; },
  });
  let rows = [];
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    rows = mine().filter(function (r) { return r.cmd.includes(`${MARK}-${id}-`) && r.cmd.startsWith('/bin/sh'); });
    if (rows.length === 2) break;
  }
  const kids = rows.map(function (r) { return { pid: r.pid, pgid: r.pgid, tag: r.cmd.includes('ignterm') ? 'ignterm' : 'plain' }; });
  await sleep(300);
  const t0 = Date.now();
  killProcessTree(w.pid, sig);
  const ev = await Promise.race([watchRef.exited.then(function (e) { return { ...e, ms: Date.now() - t0 }; }), sleep(8000).then(function () { return null; })]);
  await sleep(300);
  const after = {};
  for (const k of kids) after[k.tag] = groupMembers(k.pgid);
  return { id, workerSignal: sig, workerExit: ev, kids, kidGroupsAfter: after };
}

const out = { node: process.version, platform: process.platform, P: [], H: [] };
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-pipe-break-'));
try {
  for (const c of CASES) out.P.push(await runPCase(base, c));
  out.H.push(await runHCase(base, 'H1', 'SIGTERM'));
  out.H.push(await runHCase(base, 'H2', 'SIGKILL'));
} finally {
  const seen = new Set();
  for (const r of mine()) {
    if (seen.has(r.pgid)) continue;
    seen.add(r.pgid);
    process.stderr.write(`收尾：结束进程组 ${r.pgid}（${r.cmd.replace(MARK, '<MARK>').slice(0, 60)}）\n`);
    try { process.kill(-r.pgid, 'SIGKILL'); } catch { try { process.kill(r.pid, 'SIGKILL'); } catch { /* 已不在 */ } }
  }
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
