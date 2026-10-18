/**
 * 按进程表认进程组（EV-152，取消够不到审查员CLI；代码双审 r1 CODEX-04 抽出）。
 *
 * 「按标记找组 → 数组成员」是 I1 / I2 / U7 / U9 与零配额验收判「组空」的承重判据。它原先在三个集成测试里各抄一份、
 * 字段集已经开始分叉；字段形态一改，漏改的那份不会报错，只会让判据静默变松。所以测试进程里一律用这一份。
 *
 * 两处副本刻意保留、与本文件同源：`worker-detach.test.ts` 的场景子进程脚本串（在子进程里跑，必须自包含）、
 * `doc/05_testing/evidence/cancel-cli-reach-20260928/acceptance.mjs`（要能脱离测试构建单独跑）。字段集以本文件为准。
 *
 * Windows（设计 §7.1）：无进程组概念，等价判据映射到「组长 pid + 父链后代闭包」——与产品侧
 * `util/platform.ts` 的 `winTreeMemberCount` 同一语义（组号即组长 pid；成员即其后代）。
 * 标记查找用 WMI CommandLine（桩 CLI 的标记走 argv，命令行里可见）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { IS_WIN } from '../../src/trivium/util/platform.js';

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'] as const;
const PS_PID_COMMANDLINE = 'Get-CimInstance Win32_Process | ForEach-Object { "{0},{1}" -f $_.ProcessId, ($_.CommandLine -replace "[\\r\\n]+", " ") }';
const PS_PID_PPID = 'Get-CimInstance Win32_Process | ForEach-Object { "{0},{1}" -f $_.ProcessId, $_.ParentProcessId }';

function winPsRows(command: string): Array<{ pid: number; rest: string }> {
  const r = spawnSync('powershell.exe', [...PS_ARGS, command], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return [];
  const rows: Array<{ pid: number; rest: string }> = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^(\d+),(.*)$/.exec(line.trim());
    if (m) rows.push({ pid: Number(m[1]), rest: m[2] ?? '' });
  }
  return rows;
}

/** 命令行里含 `mark` 的进程所在的组号（去重）。Windows 上即带标记进程的 pid（组长模型） */
export function groupsWithMark(mark: string): number[] {
  if (IS_WIN) {
    const set = new Set<number>();
    for (const row of winPsRows(PS_PID_COMMANDLINE)) {
      if (row.rest.includes(mark)) set.add(row.pid);
    }
    return [...set];
  }
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
 *
 * Windows 上两者天然同集（组长 pid 即「组号」，无 setsid 窗口），保留独立函数是为了调用方语义不变。
 */
export function leaderGroupsWithMark(mark: string): number[] {
  if (IS_WIN) return groupsWithMark(mark);
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' });
  const set = new Set<number>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m && m[1] === m[2] && m[3]!.includes(mark)) set.add(Number(m[2]));
  }
  return [...set];
}

/** 进程组 `pgid` 现有的成员数。Windows：以组长 pid 为根的父链后代闭包大小（含组长） */
export function groupMemberCount(pgid: number): number {
  if (IS_WIN) {
    const rows = winPsRows(PS_PID_PPID);
    const children = new Map<number, number[]>();
    let rootPresent = false;
    for (const r of rows) {
      if (r.pid === pgid) rootPresent = true;
      const ppid = Number(r.rest);
      if (!Number.isInteger(ppid)) continue;
      const list = children.get(ppid);
      if (list) list.push(r.pid);
      else children.set(ppid, [r.pid]);
    }
    let n = rootPresent ? 1 : 0;
    const seen = new Set<number>([pgid]);
    const queue = [pgid];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const c of children.get(cur) ?? []) {
        if (seen.has(c)) continue;
        seen.add(c);
        n++;
        queue.push(c);
      }
    }
    return n;
  }
  const out = execFileSync('/bin/ps', ['-axo', 'pgid='], { encoding: 'utf8' });
  let n = 0;
  for (const line of out.split('\n')) if (Number(line.trim()) === pgid) n++;
  return n;
}

/** 按组号结束（SIGKILL）；组号 ≤ 1 或已不在时静默跳过。Windows：taskkill /T /F 树杀组长 */
export function killGroup(pgid: number): void {
  if (pgid <= 1) return;
  if (IS_WIN) {
    try {
      spawnSync('taskkill.exe', ['/PID', String(pgid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* 已不在 */
    }
    return;
  }
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    /* 已不在 */
  }
}
