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
/*
 * 失败路径的陈旧兜底上限（1.2.2，审查 CLAUDE-03）：超时 / error / 解析失败原先回退
 * 「上一次成功的表」且无龄期约束——pid 复用叠加旧表 CreationDate 恰好吻合时，身份判定
 * 会把复用 pid 判成「同一进程」，进而 taskkill 无辜进程树。陈旧缓存不是 null，是另一种猜；
 * 只接受数秒内的表（400ms TTL 服务吞吐，这里服务失败兜底，两者量级分开）。
 */
const ENUM_STALE_MAX_MS = 3_000;

/** 失败路径唯一可用的兜底：缓存存在且在显式龄期内才回给调用方，否则视同失败（null） */
export function cachedEnumRows(cache: { at: number; rows: WinProcRow[] } | null, now: number = Date.now()): WinProcRow[] | null {
  if (!cache || now - cache.at >= ENUM_STALE_MAX_MS) return null;
  return cache.rows;
}

/** 测试专用：清枚举缓存。ps 桩要模拟「取不到」，TTL 缓存会让装好的桩仍命中旧表（1.2.5） */
export function resetEnumCacheForTest(): void {
  enumCache = null;
}
const ENUM_COMMAND =
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  "$c = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ') } else { '' }; " +
  '"{0},{1},{2}" -f $_.ProcessId, $_.ParentProcessId, $c }';

let enumCache: { at: number; rows: WinProcRow[] } | null = null;
let enumInflight: Promise<WinProcRow[] | null> | null = null;
/** 在飞那趟的启程时刻（spawn 同一拍记下）：fresh 请求据此判断它能不能搭这趟 */
let enumInflightSince = 0;

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
 *
 * 在飞枚举有单飞去重，`fresh` 请求的搭车判据是**启程时刻**（1.2.8）：在飞那趟启程不早于本次请求 ⇒
 * 它拍的表不早于本次请求，对本次已是新表，直接搭（省一趟 PowerShell——`processStartTimes` 两形态并发取值
 * 时两路 fresh 共享同一趟，这正是缺省路径的时序）；启程更早的那趟可能拍在关注进程派生之前（1.2.6 的场景），
 * 等它落地后自起一趟，期间别家起了更新的就搭那趟。非 fresh 一律搭在飞的那趟（吞吐优先）。
 */
export async function enumerateWinProcesses(o: { fresh?: boolean } = {}): Promise<WinProcRow[] | null> {
  if (!IS_WIN) return Promise.resolve(null);
  const t0 = Date.now();
  if (!o.fresh && enumCache && t0 - enumCache.at < ENUM_TTL_MS) return enumCache.rows;
  if (enumInflight) {
    const prev = enumInflight;
    if (!o.fresh || enumInflightSince >= t0) return prev;
    await prev;
    if (enumInflight && enumInflight !== prev) return enumInflight;
  }
  enumInflightSince = Date.now();
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
      finish(cachedEnumRows(enumCache));
    }, ENUM_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { out += c; });
    child.on('error', () => {
      clearTimeout(timer);
      finish(cachedEnumRows(enumCache));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || out.length === 0) {
        finish(cachedEnumRows(enumCache));
        return;
      }
      const rows = parseEnumOutput(out);
      if (rows.length === 0) {
        finish(cachedEnumRows(enumCache));
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
 *
 * **缓存命中但 pid 缺席时强制重枚举一次**（1.2.6 实测缺陷）：TTL 缓存的快照拍在派生之前时，
 * 刚 spawn 的进程对身份判定不可见（0ms 即 null）——spawn 后立刻核对身份的场景（测试夹具、
 * 派生后记录）会被判「判不了」。缺席先重枚举，仍在才判不在；真不在的 pid 每次付一次
 * 真枚举的代价，换来「不在」结论的可信。
 */
export async function winProcessCreation(pid: number): Promise<string | null> {
  let rows = await enumerateWinProcesses();
  /*
   * 第一趟失败（null）也要 fresh 重试一趟（win32 实测，Bug 清单 §3.1 第 13 条）：PowerShell 在
   * 子进程风暴下偶发退出非 0 / 空输出，且 3 秒龄的失败兜底缓存常已过期——单趟失败直接判 null 会让
   * `--cancel` / 心跳 / 失联判定随机「判不了」，集成测试每轮换一批红格。重试只在失败路径上多花
   * 一个 PowerShell 周期；持续失败仍 null，「判不了」语义不变。
   */
  if (!rows) rows = (await enumerateWinProcesses({ fresh: true })) ?? null;
  if (rows) {
    const hit = rows.find((r) => r.pid === pid)?.creation;
    if (hit && hit.length > 0) return hit;
    rows = (await enumerateWinProcesses({ fresh: true })) ?? null;
  }
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
 * 派生时刻与进程表 CreationDate 比较时的容差：两者同取系统时钟，CIM 精度到微秒；
 * 只防 `Date.now()` 取在 spawn 之前那几毫秒与时钟粒度，1 秒足够且不会把早已存在的进程收进来。
 */
export const SPAWN_CLOCK_SKEW_MS = 1_000;

/** doctor 探针段一个「组」在 Windows 进程表里的样子（`groupSnapshot` 的 win32 等价，双平台统一时加） */
export interface WinSectionSnapshot {
  /** 本组仍在表的成员数：组长在表时按组长计（含组长）；组长不在表时为孤儿后代闭包的大小 */
  members: number;
  /** 表里有 pid 等于组号的进程 */
  leaderPresent: boolean;
  /** 组长不在表时，认定为本组的直接子进程（逐个树杀它们即结束本组）；组长在表时为空 */
  orphanRoots: number[];
}

/**
 * 从进程表里取 doctor 探针段一个组的快照（纯函数，便于喂录制样本）。
 *
 * POSIX 按 PGID 数组员；Windows 没有进程组，`detached` 派生的组长与其后代靠父链相连。组长退出后其子进程的
 * PPID 仍指向它，但这个号可能已被别的进程复用、复用者又有自己的子进程——所以孤儿只认
 * 「父 pid 等于组号、且创建不早于我方派生时刻（减 `SPAWN_CLOCK_SKEW_MS`）」的直接子进程及其后代。
 * 创建时刻取不到（空串）的不认，宁可漏杀不误杀。
 *
 * 表里有 pid 等于组号的进程时只报 `leaderPresent`：调用方已按子进程句柄知道我方组长退了，
 * 这个进程只能是复用者，判复用、不发信号（与 POSIX 侧同一条规则，代码三审 CODEX-01）。
 */
export function winSectionSnapshotFrom(rows: readonly WinProcRow[], rootPid: number, spawnedAtMs: number): WinSectionSnapshot {
  if (rows.some((r) => r.pid === rootPid)) return { members: 1, leaderPresent: true, orphanRoots: [] };
  const floor = spawnedAtMs - SPAWN_CLOCK_SKEW_MS;
  const orphanRoots = rows
    .filter((r) => r.ppid === rootPid && r.creation.length > 0 && Date.parse(r.creation) >= floor)
    .map((r) => r.pid);
  const children = new Map<number, number[]>();
  for (const r of rows) {
    const list = children.get(r.ppid);
    if (list) list.push(r.pid);
    else children.set(r.ppid, [r.pid]);
  }
  const seen = new Set<number>(orphanRoots);
  const queue = [...orphanRoots];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const c of children.get(cur) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      queue.push(c);
    }
  }
  return { members: seen.size, leaderPresent: false, orphanRoots };
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
