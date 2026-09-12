/**
 * 子进程执行：超时、流式 stdout、伪终端包装。
 *
 * 本机实测（M0）：macOS 默认**没有** `timeout` / `gtimeout`（那是 GNU coreutils），
 * 因此超时一律在 Node 内实现（定时器 → SIGTERM → 宽限期 → SIGKILL），
 * 绝不 shell out 到 `timeout`。这同时也是设计 §12.2「脚本级 timeout」的落点。
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  /** 追加/覆盖到 process.env 之上的环境变量；值为 undefined 表示删除该变量 */
  env?: Record<string, string | undefined>;
  /** 超时毫秒。0 或省略表示不限时 */
  timeoutMs?: number;
  /** SIGTERM 之后等多久再 SIGKILL */
  killGraceMs?: number;
  /** 写入子进程 stdin 后关闭 */
  stdin?: string;
  /** 每读到一行 stdout 调用一次（用于 stream-json 增量解析） */
  onStdoutLine?: (line: string) => void;
  /** 用 `script -q /dev/null` 包一层伪终端（应对 agy 在管道下丢 stdout，probe.agy.pty_required） */
  pty?: boolean;
  /** 输出上限，超出即截断，防止把整个仓库读进内存 */
  maxBufferBytes?: number;
  /**
   * 超时时杀**整棵进程树**而不只是直接子进程。
   *
   * 实现是让子进程成为自己进程组的组长（`detached: true`），超时按进程组发信号。
   * 厂商 CLI 都会再派生子进程（pty 模式下直接子进程更只是 `script` 包装），
   * 只 `kill(pid)` 会把真正烧配额的那个遗弃给 init。适配器一律打开它。
   */
  killTree?: boolean;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** 因超时被杀 */
  timedOut: boolean;
  /** 因超出 maxBufferBytes 而截断 */
  truncated: boolean;
  /** 实际执行的命令行（人读，用于写进 run.json 与坑清单） */
  commandLine: string;
}

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

/** 供人读/归档的命令行拼装，含最小引号处理。不用于实际执行（执行一律走 argv 数组，无 shell） */
export function formatCommand(bin: string, args: readonly string[]): string {
  const q = (s: string) => (/^[A-Za-z0-9_\-./:=@]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [bin, ...args].map(q).join(' ');
}

/**
 * 执行一个子进程并等待结束。
 *
 * 不使用 shell：全部参数以 argv 数组传递，避免注入与引号地狱。
 * 伪终端模式下改为执行 `script -q /dev/null <bin> <args...>`（macOS BSD script 语法）。
 */
export function run(bin: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  const {
    cwd,
    env,
    timeoutMs = 0,
    killGraceMs = 5_000,
    stdin,
    onStdoutLine,
    pty = false,
    maxBufferBytes = DEFAULT_MAX_BUFFER,
    killTree = false,
  } = opts;

  const realBin = pty ? 'script' : bin;
  const realArgs = pty ? ['-q', '/dev/null', bin, ...args] : [...args];
  const commandLine = formatCommand(realBin, realArgs);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env ?? {})) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }

  const spawnOpts: SpawnOptions = {
    cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(killTree ? { detached: true } : {}),
  };

  return new Promise<RunResult>((resolve) => {
    const startedAt = Date.now();
    const child = spawn(realBin, realArgs, spawnOpts);

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let lineBuf = '';
    let softTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    let exitTimer: NodeJS.Timeout | undefined;

    const appendOut = (chunk: string) => {
      if (stdout.length + chunk.length > maxBufferBytes) {
        stdout += chunk.slice(0, Math.max(0, maxBufferBytes - stdout.length));
        truncated = true;
      } else {
        stdout += chunk;
      }
      if (!onStdoutLine) return;
      lineBuf += chunk;
      let nl: number;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl);
        lineBuf = lineBuf.slice(nl + 1);
        if (line.length > 0) onStdoutLine(line);
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', appendOut);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => {
      if (stderr.length + c.length <= maxBufferBytes) stderr += c;
      else truncated = true;
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (softTimer) clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (exitTimer) clearTimeout(exitTimer);
      if (lineBuf.length > 0 && onStdoutLine) onStdoutLine(lineBuf);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
        commandLine,
      });
    };

    child.on('error', (err) => {
      stderr += `\n[spawn error] ${(err as Error).message}`;
      finish(null, null);
    });
    child.on('close', finish);
    /*
     * `close` 要等**全部 stdio 管道**关闭。子进程退出后若留下继承了 stdout 管道的
     * 孙进程（`sleep 30 &` 之类），管道不闭合，`close` 永不触发，本 Promise 永不 resolve——
     * 上层的 runOneSide 挂死，`--wait` 永远 73。因此 `exit` 之后给一个短兜底：
     * 已退出的进程不会再产出输出，两秒后没等到 close 就按已收到的输出收尾。
     */
    child.on('exit', (code, signal) => {
      exitTimer = setTimeout(() => finish(code, signal), 2_000);
    });

    const signalChild = (sig: NodeJS.Signals) => {
      if (killTree && child.pid) killProcessTree(child.pid, sig);
      else child.kill(sig);
    };
    if (timeoutMs > 0) {
      softTimer = setTimeout(() => {
        timedOut = true;
        signalChild('SIGTERM');
        hardTimer = setTimeout(() => signalChild('SIGKILL'), killGraceMs);
      }, timeoutMs);
    }

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }
  });
}

/** 只关心是否成功执行的轻量封装（版本探测等） */
export async function tryRun(
  bin: string,
  args: readonly string[],
  opts: RunOptions = {},
): Promise<RunResult & { ok: boolean }> {
  const r = await run(bin, args, opts);
  return { ...r, ok: r.code === 0 && !r.timedOut };
}


// ─────────────────── 派生脱离父进程的工作进程 ───────────────────

export interface SpawnDetachedOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** 日志文件路径。stdout/stderr 都重定向到它 */
  logFile: string;
}

export interface SpawnDetachedResult {
  pid: number;
  commandLine: string;
}

/**
 * 派生一个**脱离父进程**的工作进程（修订版 M2 计划 §2.1）。
 *
 * 唯一机制是 Node `spawn` 的 `detached` 选项——它本身就完成 POSIX `setsid`。
 * **不使用** shell 层的 `setsid`（macOS 无此命令，同 M0 坑 P-01），
 * 也**不存在**「双 fork」这一步（那是 C 时代守护进程技巧，Node 里无对应物）。
 *
 * `stdio` 必须重定向到文件，这一条是成败关键，双审两侧从不同角度都指出过：
 *   - 继承父进程管道时，父进程退出后管道破裂，worker 死于 SIGPIPE（AGY-01）；
 *   - 管道 EOF 不闭合会让派生方的调用一直挂到 worker 退出，
 *     违反「`--start` 立即返回」的契约（GLM-03）。
 */
export async function spawnDetached(
  bin: string,
  args: readonly string[],
  opts: SpawnDetachedOptions,
): Promise<SpawnDetachedResult> {
  const { promises: fsp } = await import('node:fs');
  await fsp.mkdir(pathDirname(opts.logFile), { recursive: true });
  // 'a' 而非 'w'：重试或多次派生时不覆盖既有日志
  const handle = await fsp.open(opts.logFile, 'a');

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }

  try {
    const child = spawn(bin, [...args], {
      cwd: opts.cwd,
      env: childEnv,
      detached: true,
      stdio: ['ignore', handle.fd, handle.fd],
    });
    if (child.pid === undefined) throw new Error('spawn 未返回 pid');
    // spawn 失败时 Node 会**异步**再发一次 'error'；没有监听者就是未捕获异常，
    // 会盖掉上面那条本该返回的退出码
    child.once('error', () => { /* 已由 pid 缺失路径报告 */ });
    // 父进程不等它，也不因它而延迟退出
    child.unref();
    return { pid: child.pid, commandLine: formatCommand(bin, args) };
  } finally {
    // fd 已交给子进程，父进程这一份可以关掉
    await handle.close();
  }
}

/** 避免为一个 dirname 引入 node:path 的顶层依赖（本文件其余部分不需要它） */
function pathDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/**
 * 进程是否存活，且**是不是同一个进程**。
 *
 * 单看 `kill(pid, 0)` 不够：macOS 的 PID 复用很频繁，worker 异常死后其 PID
 * 可能被无关进程占用，此时 `kill` 成功会让遗留锁永不回收、主题被永久锁死
 * （审查意见 GLM-04）。因此要比对进程的**启动时刻**。
 */
export async function processAlive(
  pid: number,
  expectedStartedAt?: string | null,
): Promise<{ alive: boolean; sameProcess: boolean; startedAt: string | null }> {
  let alive: boolean;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (e) {
    // EPERM 表示进程存在但不属于当前用户——仍算存活
    alive = (e as NodeJS.ErrnoException).code === 'EPERM';
  }
  if (!alive) return { alive: false, sameProcess: false, startedAt: null };

  const startedAt = await processStartTime(pid);
  if (!expectedStartedAt) return { alive: true, sameProcess: true, startedAt };
  return {
    alive: true,
    sameProcess: startedAt !== null && startedAt === expectedStartedAt,
    startedAt,
  };
}

/** 取进程启动时刻。macOS/BSD 与 Linux 的 ps 都支持 `-o lstart=` */
export async function processStartTime(pid: number): Promise<string | null> {
  const r = await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeoutMs: 10_000 });
  if (r.code !== 0) return null;
  const t = r.stdout.trim();
  return t.length > 0 ? t : null;
}

/**
 * 向工作进程**及其全部后代**发信号。
 *
 * `spawnDetached` 用 `detached: true`（即 POSIX `setsid`），所以工作进程是自己
 * 进程组的组长、pgid 等于它的 pid，它拉起的 agy / zcode 也在同一组里。
 * 只 `kill(pid)` 的话，两侧厂商进程会被**遗弃给 init 继续跑**——实测确认过：
 * `--cancel` 之后 `zcode-cli` 的 PPID 变成 1 且仍在消耗配额。
 * 取消的意义就是停止花钱，所以必须按进程组发。
 *
 * 返回是否至少送达了一个目标。组不存在（ESRCH）时退回单进程，
 * 因为组可能已经空了、也可能这个 pid 压根不是组长。
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  // 绝不对自己发组信号：`kill(-pid)` 以 pid 为组号，pid 等于自身时就是自杀
  if (pid === process.pid) return false;

  try {
    process.kill(-pid, signal); // 负数 = 整个进程组
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false; // 已经退出了
    }
  }
}

