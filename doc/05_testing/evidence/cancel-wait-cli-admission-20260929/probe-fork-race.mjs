// 探针：detached `sh -c 'sleep …'` 派生后立刻按组 SIGKILL，组里会不会有 fork 出来的 sleep 活下来（夹具 goneGroup 的偶发红）。
// 第 2 版：派生后随机等 0～60 ms 再发（夹具在一次 ps 之后才发）。只对本脚本自己派生的组发信号；不写盘。用法：node probe-fork-race.mjs [次数] [并发]
import { spawn, execFileSync } from 'node:child_process';

const N = Number(process.argv[2] ?? 300);
const P = Number(process.argv[3] ?? 8);
const MARK = `probe-fork-race-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const members = () => {
  const out = execFileSync('/bin/ps', ['-axo', 'pgid=,stat=,command='], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.includes(MARK) && !/^\s*\d+\s+Z/.test(l));
};

async function once() {
  const c = spawn('/bin/sh', ['-c', 'sleep 30; : "$0"', MARK], { detached: true, stdio: 'ignore' });
  const exited = new Promise((r) => c.once('exit', r));
  const pgid = c.pid;
  await sleep(Math.floor(Math.random() * 60));
  try { process.kill(-pgid, 'SIGKILL'); } catch { /* 已不在 */ }
  await exited;
  return pgid;
}

let done = 0;
const pgids = [];
while (done < N) {
  const batch = [];
  for (let k = 0; k < P && done < N; k++, done++) batch.push(once());
  pgids.push(...(await Promise.all(batch)));
}
await sleep(1500);
const left = members();
console.log(JSON.stringify({ runs: N, concurrency: P, survivors: left.length, sample: left.slice(0, 3) }));
for (const g of new Set(left.map((l) => Number(l.trim().split(/\s+/)[0])))) {
  if (pgids.includes(g)) try { process.kill(-g, 'SIGKILL'); } catch { /* 已不在 */ }
}
