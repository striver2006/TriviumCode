// 录制一份带真实僵尸的 `ps -axo pgid=,stat=` 样本（EV-169）。只读系统状态，不删不写系统文件；输出写到参数给的目录。
// 造法：detached 起 `sh -c 'sleep 0 & exec sleep 30'`——sh 先派生 `sleep 0`，再 exec 成 `sleep 30`；
// `sleep 30` 不会 wait，于是已退出的 `sleep 0` 留成僵尸，且与组长同在 sh 那个进程组里。
// 录完按组结束这一组（组号 = 本脚本刚拉起的子进程 pid，不来自任何外部输入）。
// 用法：node record-ps-zombie.mjs 〈输出目录〉
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node record-ps-zombie.mjs 〈输出目录〉');
const child = spawn('/bin/sh', ['-c', 'sleep 0 & exec sleep 30'], { detached: true, stdio: 'ignore' });
const pgid = child.pid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let out = '';
  let zombies = [];
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    out = execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' });
    const detail = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8' });
    zombies = detail.split('\n').filter((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/.exec(l);
      return m && Number(m[3]) === pgid;
    });
    if (zombies.some((l) => /^\s*\d+\s+\d+\s+\d+\s+Z/.test(l))) break;
  }
  const groupLines = out.split('\n').filter((l) => {
    const m = /^\s*(\d+)\s+(\S+)/.exec(l);
    return m && Number(m[1]) === pgid;
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ps-pgid-stat.txt'), out);
  fs.writeFileSync(
    path.join(OUT, 'ps-sample-meta.json'),
    JSON.stringify({
      recorded_at: new Date().toISOString(), platform: process.platform, pgid,
      group_lines_pgid_stat: groupLines, group_detail_pid_ppid_pgid_stat_comm: zombies,
      total_lines: out.split('\n').filter(Boolean).length,
    }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ pgid, groupLines, detail: zombies }, null, 2));
} finally {
  try { process.kill(-pgid, 'SIGKILL'); } catch { /* 已不在 */ }
}
