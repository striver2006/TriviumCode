/**
 * 平台差异的落点（Windows 移植，设计 §7.1）。
 *
 * 本模块只收「同一件事在两个平台上的不同做法」：进程表枚举、进程树终止、sh 解析。
 * Agent 差异不在这里（那是 `agents/registry.ts` 的事），厂商 CLI 布局差异在各自探针里。
 * POSIX 路径上除 `IS_WIN` 外不被调用，macOS 行为零变化。
 *
 * 为什么不走 `util/exec.ts` 的 `run()`：exec 依赖本模块做平台分派，反向依赖会成环；
 * 且 `run()` 在「终止中」（`shutdownTrackedTrees` 置位后）不再派生——而取消收尾恰恰
 * 在终止中**最需要**读进程表确认身份，这里的枚举必须绕开那道冻结（只读、无外部落地）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const IS_WIN = process.platform === 'win32';

/** 进程表的一行：pid、父 pid、创建时刻（UTC ISO；个别系统进程取不到时为空串） */
export interface WinProcRow {
  pid: number;
  ppid: number;
  creation: string;
}

/*
 * 实测（2026-10-18，win32）：`Get-CimInstance Win32_Process` 单查与全量枚举同价（约 0.7–0.9 s，
 * 成本在 PowerShell 启动），因此一律全量枚举 + 短 TTL 缓存——终止轮询每拍新起一个 PowerShell 不可接受。
 * CreationDate 在 CIM 里已转为 DateTime，`.ToUniversalTime()` 后显式格式化，与环境 TZ / 区域设置无关
 * （`Get-Process` 的 StartTime 是本地化字符串，不能用作身份源）。
 */
const ENUM_TTL_MS = 400;
const ENUM_TIMEOUT_MS = 15_000;
const ENUM_COMMAND =
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  "$c = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') } else { '' }; " +
  '"{0},{1},{2}" -f $_.ProcessId, $_.ParentProcessId, $c }';

let enumCache: { at: number; rows: WinProcRow[] } | null = null;
let enumInflight: Promise<WinProcRow[] | null> | null = null;

function parseEnumOutput(out: string): WinProcRow[] {
  const rows: WinProcRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^(\d+),(\d+),(.*)$/.exec(line.trim());
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), creation: m[3] ?? '' });
  }
  return rows;
}

/**
 * 全量枚举 Windows 进程表（含内核侧条目）。失败（PowerShell 不可用、超时、解析为空）返回 null——
 * 调用方按「判不了」处置，与 POSIX 侧 `ps` 失败返回 null 同口径。
 */
export function enumerateWinProcesses(o: { fresh?: boolean } = {}): Promise<WinProcRow[] | null> {
  if (!IS_WIN) return Promise.resolve(null);
  if (!o.fresh && enumCache && Date.now() - enumCache.at < ENUM_TTL_MS) return Promise.resolve(enumCache.rows);
  if (enumInflight) return enumInflight;
  enumInflight = new Promise<WinProcRow[] | null>((resolve) => {
    let settled = false;
    const finish = (rows: WinProcRow[] | null): void => {
      if (settled) return;
      settled = true;
      resolve(rows);
    };
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ENUM_COMMAND],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      finish(enumCache?.rows ?? null);
    }, ENUM_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { out += c; });
    child.on('error', () => {
      clearTimeout(timer);
      finish(enumCache?.rows ?? null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || out.length === 0) {
        finish(enumCache?.rows ?? null);
        return;
      }
      const rows = parseEnumOutput(out);
      if (rows.length === 0) {
        finish(enumCache?.rows ?? null);
        return;
      }
      enumCache = { at: Date.now(), rows };
      finish(rows);
    });
  }).finally(() => {
    enumInflight = null;
  });
  return enumInflight;
}

/**
 * 进程创建时刻（`processStartTime` 的 Windows 实现）：UTC ISO，天然环境无关，
 * canonical 与缺省形态同值。进程不在或枚举失败返回 null。
 */
export async function winProcessCreation(pid: number): Promise<string | null> {
  const rows = await enumerateWinProcesses();
  if (!rows) return null;
  const c = rows.find((r) => r.pid === pid)?.creation;
  return c && c.length > 0 ? c : null;
}

/**
 * 以 `rootPid` 为根的**仍在表的**后代数（`processGroupMemberCount` 的 Windows 等价，设计 §7.1）。
 *
 * POSIX 按 PGID 数组员；Windows 无进程组概念，等价判据是父链后代闭包：组长活着时它与其后代即
 * 原「组」的成员（组长计入，与 POSIX「组长在自己组里」同形）。组长退出后其子进程的 PPID 残留仍指向它，
 * 计数继续成立——对应 POSIX「组长已退、组员仍在」的孤儿判定；Windows 无僵尸概念，退出即从表中消失。
 * 枚举失败返回 null（判不了，不去猜）。
 */
export async function winTreeMemberCount(rootPid: number): Promise<number | null> {
  const rows = await enumerateWinProcesses();
  if (!rows) return null;
  const children = new Map<number, number[]>();
  let rootPresent = false;
  for (const r of rows) {
    if (r.pid === rootPid) rootPresent = true;
    const list = children.get(r.ppid);
    if (list) list.push(r.pid);
    else children.set(r.ppid, [r.pid]);
  }
  let n = rootPresent ? 1 : 0;
  const seen = new Set<number>([rootPid]);
  const queue = [rootPid];
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

/**
 * `killProcessTree` 的 Windows 实现：`taskkill /T` 树杀。
 *
 * `force=false` 是软步（发 WM_CLOSE；控制台进程常无效——如实保留，凭据安全由我方 worker 的
 * 取消标记路径保障）；`force=true` 是硬步（`/T /F`，TerminateProcess 整棵树）。
 * 返回值语义与 POSIX 侧对齐：硬步以 taskkill 成败为准；软步只要命令执行过就算「已送达尝试」
 * （目标拒绝优雅关闭时 taskkill 退 1，那是送达后的结果，不是没送达；进程不存在退 128 才算没有目标）。
 */
export function winTaskkillTree(pid: number, force: boolean): boolean {
  const r = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
    { stdio: 'ignore', windowsHide: true });
  if (r.error) return false;
  if (force) return r.status === 0;
  return r.status === 0 || r.status === 1;
}

let posixShellCache: string | null | undefined;

function firstExistingSh(candidates: string[]): string | null {
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function shFromGitExecPath(): string | null {
  const r = spawnSync('git', ['--exec-path'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const out = r.stdout ?? '';
  if (r.error || r.status !== 0 || out.trim().length === 0) return null;
  // 形如 D:/Program Files/Git/ucrt64/libexec/git-core（或 mingw64/纯 libexec 布局）：向上找 <git-root>\usr\bin\sh.exe
  let dir = path.dirname(out.trim());
  for (let i = 0; i < 4; i++) {
    const hit = firstExistingSh([path.join(dir, 'usr', 'bin', 'sh.exe'), path.join(dir, 'bin', 'sh.exe')]);
    if (hit) return hit;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 定位 POSIX sh（verify 命令、verify 探针、Hook 守卫在 Windows 上的统一执行载体，设计 §7.1）。
 *
 * Git for Windows 是硬依赖（Git ≥2.20），其 sh.exe 一定存在，但 npm 从 cmd/PowerShell 启动时
 * `usr/bin` 不在 PATH 上，`where sh` 常落空——所以以 `git --exec-path` 上溯为主判据，
 * `where` 与常见安装路径为兜底。POSIX 平台恒为 `/bin/sh`。结果缓存；找不到返回 null，调用方报
 * 「需要 Git for Windows」。
 */
export function resolvePosixShellSync(): string | null {
  if (!IS_WIN) return '/bin/sh';
  if (posixShellCache !== undefined) return posixShellCache;
  let hit: string | null = null;
  const where = spawnSync('where.exe', ['sh'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const whereOut = where.status === 0 ? (where.stdout ?? '') : '';
  hit = firstExistingSh(whereOut.split(/\r?\n/).filter((l: string) => l.trim().length > 0));
  hit ??= shFromGitExecPath();
  hit ??= firstExistingSh([
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'sh.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'sh.exe'),
  ]);
  posixShellCache = hit;
  return hit;
}
