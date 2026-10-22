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

/**
 * 只认**组长**带标记的组：命令行含 `mark`、且 pid 等于 pgid 的进程的组号（去重）。
 *
 * 用在「这几组都起来了、正是这几组」一类的**采样判据**上；收尾清理仍用宽口径的 `groupsWithMark`。
 *
 * ## 为什么不能直接用 `groupsWithMark`（BACKLOG EV-193）
 *
 * `ps` 的组号与命令行不是同一时刻取的。detached 派生的子进程在 `setsid` 之前沿用父进程的组号，
 * 采样恰好落在这个窗口、而读命令行时它已 exec 成带标记的 `sh`，就会出现一行
 * 「带标记、组号却是父进程（worker）的组」。`groupsWithMark` 把它当成一组，凑满两组就停止采样，
 * 于是 I6 拿到 `[worker 组, 一侧 CLI 组]`，与 status.json 正确记下的两侧组号对不上（2026-10-02、10-16 各红一次）。
 * 零配额并发实验存档三轮共约 2.6 万次派生撞上 2 次，错配行 pid≠pgid、pgid 等于派生方所在的组
 * （`doc/05_testing/evidence/ev193-pgid-race-20261016/`）。
 * 桩 CLI 由 `run()` 以 killTree（detached）拉起，带标记的 `sh` 必是组长，所以按 pid===pgid 过滤不丢真组。
 */
export function leaderGroupsWithMark(mark: string): number[] {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' });
  const set = new Set<number>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && m[1] === m[2] && m[3]!.includes(mark)) set.add(Number(m[2]));
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

/**
 * 收尾兜底：按组结束带标记的组，再逐个 SIGKILL 仍带标记的进程（落在本测试进程组里、`killGroup` 跳过的那些）。
 * 只杀命令行含 `mark` 的进程，不碰本进程。
 */
export function killMarked(mark: string): void {
  for (const g of groupsWithMark(mark)) killGroup(g);
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m || !m[2]!.includes(mark) || Number(m[1]) === process.pid) continue;
    try {
      process.kill(Number(m[1]), 'SIGKILL');
    } catch {
      /* 已不在 */
    }
  }
}

let ownGroup: number | null = null;

/** 本测试进程所在的进程组号（取一次缓存） */
function ownPgid(): number {
  ownGroup ??= Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
  return ownGroup;
}

/**
 * 按组号结束（SIGKILL）；组号 ≤ 1、是本测试进程自己所在的组、或已不在时静默跳过。
 *
 * 不对自己的组发（EV-251 变异预跑撞过）：被测代码一旦不再让子进程自成一组（正是某些变异要造的形态），
 * 带标记的子进程就落在测试进程的组里，按标记找到的组号即测试运行器、变异脚本乃至外层 shell 所在的组——
 * 一发 SIGKILL 连变异脚本一起杀掉，它的恢复步骤跑不到，变异留在工作树上。
 */
export function killGroup(pgid: number): void {
  if (pgid <= 1 || pgid === ownPgid()) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    /* 已不在 */
  }
}
