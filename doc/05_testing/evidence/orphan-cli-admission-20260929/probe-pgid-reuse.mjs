#!/usr/bin/env node
/**
 * EV-165 前置探针（零配额）：macOS 上，组长已退出而组里还有成员时，这个组号（= 组长原 pid）会不会被分给新进程？
 *
 * 做法：
 *   1. 造 G 个孤儿组：detached `sh -c '〈node 常驻成员〉 & sleep 0.3'`，sh 是组长、0.3 s 后退出；成员是带标记的 node 常驻进程，
 *      过继给 launchd 后仍留在原组里。确认每组「组长 pid 已不在、组号下有 1 个带标记的成员」。
 *   2. 连续派生短命进程（/usr/bin/true），记下每个 pid，直到 pid 回绕一整圈并越过全部孤儿组号（或达到上限）。
 *   3. 看有没有新进程的 pid 等于某个孤儿组号；再确认孤儿组的成员仍在、组号未变。
 *   4. 收尾：只按标记结束本探针的成员（逐个 pid，SIGKILL）；不删任何文件。
 *
 * 用法：node probe-pgid-reuse.mjs [孤儿组数=30] [派生上限=260000] [并发=32]
 */
import { spawn, execFileSync } from 'node:child_process';

// 代码双审 r1 CODEX-02：前提是 XNU 的 pid/pgid 分配行为，与 Node 版本无关，补记系统版本供日后核对是否需要重测
const sysVersion = (bin, args) => { try { return execFileSync(bin, args, { encoding: 'utf8' }).trim(); } catch { return null; } };
const macosProductVersion = sysVersion('/usr/bin/sw_vers', ['-productVersion']);
const kernelRelease = sysVersion('/usr/bin/uname', ['-r']);

const G = Number(process.argv[2] ?? 30);
const LIMIT = Number(process.argv[3] ?? 260_000);
const CONC = Number(process.argv[4] ?? 32);
const MARK = `probe-pgid-reuse-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const rows = () => execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean)
  .map((m) => ({ pid: +m[1], pgid: +m[2], stat: m[3], cmd: m[4] }));

// ── 1. 孤儿组 ──
const member = `${process.execPath} -e 'setTimeout(function(){},1800000)' ${MARK}`;
const groups = [];
for (let i = 0; i < G; i++) {
  const c = spawn('/bin/sh', ['-c', `${member} & sleep 0.3`], { detached: true, stdio: 'ignore' });
  groups.push(c.pid);
  await new Promise((r) => c.once('exit', r));
}
await sleep(500);
const before = rows();
const setup = groups.map((g) => ({
  pgid: g,
  leaderAlive: alive(g),
  members: before.filter((r) => r.pgid === g && r.cmd.includes(MARK) && !r.stat.startsWith('Z')).map((r) => r.pid),
}));
const okSetup = setup.filter((s) => !s.leaderAlive && s.members.length === 1).map((s) => s.pgid);
const orphan = new Set(okSetup);
const maxOrphan = Math.max(...okSetup);

// ── 2. 派生到 pid 回绕并越过全部孤儿组号 ──
let spawned = 0, wrapped = false, lastPid = 0, minSeen = Infinity, maxSeen = 0;
const hits = [];
const t0 = Date.now();
async function one() {
  const c = spawn('/usr/bin/true', [], { stdio: 'ignore' });
  const pid = c.pid;
  await new Promise((r) => { c.once('exit', r); c.once('error', r); });
  return pid;
}
while (spawned < LIMIT) {
  const batch = [];
  for (let k = 0; k < CONC; k++) batch.push(one());
  for (const pid of await Promise.all(batch)) {
    spawned++;
    if (pid === undefined) continue;
    if (orphan.has(pid)) hits.push(pid);
    if (lastPid && pid + 50_000 < lastPid) wrapped = true;
    lastPid = pid; minSeen = Math.min(minSeen, pid); maxSeen = Math.max(maxSeen, pid);
  }
  if (wrapped && lastPid > maxOrphan + 1000) break;
}
const ms = Date.now() - t0;

// ── 3. 孤儿组仍完好吗 ──
const after = rows();
const intact = okSetup.filter((g) => after.some((r) => r.pgid === g && r.cmd.includes(MARK) && !r.stat.startsWith('Z')));

// ── 4. 收尾：只按标记逐个结束本探针的成员 ──
for (const r of after) if (r.cmd.includes(MARK) && r.pid !== process.pid) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* 已不在 */ } }
await sleep(300);
const leftover = rows().filter((r) => r.cmd.includes(MARK) && !r.stat.startsWith('Z')).length;

console.log(JSON.stringify({
  node: process.version, macosProductVersion, kernelRelease, orphanGroupsRequested: G, orphanGroupsValid: okSetup.length, orphanPgids: okSetup,
  spawned, wrapped, pidRange: [minSeen, maxSeen], ms,
  pidEqualsLiveOrphanPgid: hits, orphanGroupsIntactAfter: intact.length, leftover,
  verdict: !wrapped ? '未回绕，结论不成立（上限太小）'
    : hits.length === 0 && intact.length === okSetup.length ? '回绕一整圈，没有新进程拿到仍有成员的组号'
    : '有新进程拿到了仍有成员的组号，或孤儿组在期间被破坏',
}, null, 2));
