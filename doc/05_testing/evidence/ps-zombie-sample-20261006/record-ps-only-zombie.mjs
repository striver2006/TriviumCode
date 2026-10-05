// 录制「组里只剩僵尸」的真实 `ps -axo pgid=,stat=` 样本（EV-169）。只读系统状态；输出写到参数给的目录。
// 造法：detached 起一个 perl 父进程（自成组 A）；它 fork 出子进程，子进程 setsid 自成组 B（组号 = 子进程 pid）后立即退出；
// 父进程循环 sleep、从不 wait——子进程留成僵尸，组 B 里只有这一个僵尸，父进程在组 A，不在组 B。
// 录完按组结束父进程那一组（组号 = 本脚本刚拉起的子进程 pid）；父进程一死，僵尸由 launchd 回收。
// 用法：node record-ps-only-zombie.mjs 〈输出目录〉
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node record-ps-only-zombie.mjs 〈输出目录〉');
const perl = 'use POSIX (); my $c = fork(); if ($c == 0) { POSIX::setsid(); POSIX::_exit(0); } print "$c\\n"; $| = 1; while (1) { sleep 30 }';
const parent = spawn('/usr/bin/perl', ['-e', perl], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const childPid = await new Promise((resolve, reject) => {
    let buf = '';
    parent.stdout.on('data', (c) => {
      buf += c;
      const m = /^(\d+)\n/.exec(buf);
      if (m) resolve(Number(m[1]));
    });
    setTimeout(() => reject(new Error('perl 没报子进程 pid')), 10_000);
  });
  parent.stdout.destroy();
  let out = '';
  let detail = [];
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    out = execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' });
    detail = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8' })
      .split('\n').filter((l) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/.exec(l);
        return m && (Number(m[3]) === childPid || Number(m[3]) === parent.pid);
      });
    if (detail.some((l) => new RegExp(`^\\s*${childPid}\\s+\\d+\\s+${childPid}\\s+Z`).test(l))) break;
  }
  const groupLines = out.split('\n').filter((l) => {
    const m = /^\s*(\d+)\s+(\S+)/.exec(l);
    return m && Number(m[1]) === childPid;
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ps-pgid-stat.txt'), out);
  fs.writeFileSync(
    path.join(OUT, 'ps-sample-meta.json'),
    JSON.stringify({
      recorded_at: new Date().toISOString(), platform: process.platform, pgid: childPid, parent_pgid: parent.pid,
      group_lines_pgid_stat: groupLines, detail_pid_ppid_pgid_stat_comm: detail,
      total_lines: out.split('\n').filter(Boolean).length,
    }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ pgid: childPid, parent: parent.pid, groupLines, detail }, null, 2));
} finally {
  try { process.kill(-parent.pid, 'SIGKILL'); } catch { /* 已不在 */ }
}
