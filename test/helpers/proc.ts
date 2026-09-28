/**
 * 按进程表认进程组（EV-152，取消够不到审查员CLI；代码双审 r1 CODEX-04 抽出）。
 *
 * 「按标记找组 → 数组成员」是 I1 / I2 / U7 / U9 与零配额验收判「组空」的承重判据。它原先在三个集成测试里各抄一份、
 * 字段集已经开始分叉；字段形态一改，漏改的那份不会报错，只会让判据静默变松。所以测试进程里一律用这一份。
 *
 * 两处副本刻意保留、与本文件同源：`worker-detach.test.ts` 的场景子进程脚本串（在子进程里跑，必须自包含）、
 * `doc/05_testing/evidence/cancel-cli-reach-20260928/acceptance.mjs`（要能脱离测试构建单独跑）。字段集以本文件为准。
 */
import { execFileSync } from 'node:child_process';

/** 命令行里含 `mark` 的进程所在的组号（去重） */
export function groupsWithMark(mark: string): number[] {
  const out = execFileSync('/bin/ps', ['-axo', 'pgid=,command='], { encoding: 'utf8' });
  const set = new Set<number>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && m[2]!.includes(mark)) set.add(Number(m[1]));
  }
  return [...set];
}

/** 进程组 `pgid` 现有的成员数 */
export function groupMemberCount(pgid: number): number {
  const out = execFileSync('/bin/ps', ['-axo', 'pgid='], { encoding: 'utf8' });
  let n = 0;
  for (const line of out.split('\n')) if (Number(line.trim()) === pgid) n++;
  return n;
}

/** 按组号结束（SIGKILL）；组号 ≤ 1 或已不在时静默跳过 */
export function killGroup(pgid: number): void {
  if (pgid <= 1) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    /* 已不在 */
  }
}
