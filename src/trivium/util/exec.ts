/**
 * 子进程执行：超时、流式 stdout、伪终端包装。
 *
 * 本机实测（M0）：macOS 默认**没有** `timeout` / `gtimeout`（那是 GNU coreutils），
 * 因此超时一律在 Node 内实现（定时器 → SIGTERM → 宽限期 → SIGKILL），
 * 绝不 shell out 到 `timeout`。这同时也是设计 §12.2「脚本级 timeout」的落点。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

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
  /**
   * 每读到一行 stderr 调用一次。
   *
   * 与 `onStdoutLine` 对称。加它是因为有些 CLI 把**生效配置**打在 stderr 上
   * （codex 0.154.0 的 exec header 就是），而那正是探针要的东西。
   */
  onStderrLine?: (line: string) => void;
  /**
   * 回调里调用它即**立刻终止子进程**（按 `killTree` 的设置决定杀谁）。
   *
   * 这是手工 `cmd | head -N` 靠 SIGPIPE 中断的代码内等价物：
   * 拿到想要的几行就走人，不必等进程自己结束、也不必赌一个固定超时。
   * 对会烧配额的 CLI 尤其要紧——**固定超时无论调到多少，都只是在赌
   * 「请求还没发出去」**，而早退能把那个窗口压到接近零。
   *
   * 早退终止的结果里 `timedOut` 为 false、`earlyStopped` 为 true：
   * 两者必须分得开，否则调用方无从判断输出是不是完整的。
   */
  stopEarly?: (stop: () => void) => void;
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
   *
   * 这样拉起的子进程还会登记进本进程的 `liveTrees`：它不在调用方的进程组里，调用方被按组杀时够不到它，
   * 所以 worker 收到 SIGTERM 时要靠 `shutdownTrackedTrees` 按组终止它们（EV-152）。
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
  /** 因调用方在流式回调里主动早退而被杀（不是超时，输出是「够用了」而非「被截断」） */
  earlyStopped: boolean;
  /** 因超出 maxBufferBytes 而截断 */
  truncated: boolean;
  /** 实际执行的命令行（人读，用于写进 run.json 与坑清单） */
  commandLine: string;
}

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * 本进程以 `killTree` 拉起、尚未观察到退出的子进程（EV-152，取消够不到审查员CLI计划 r2 §4.1）。
 * 键是 pid，也是它的进程组号（`detached` ⇒ 组长）。只在本进程内有意义：worker 收到 SIGTERM 时据此按组终止它们。
 */
const liveTrees = new Map<number, ChildProcess>();

/**
 * 置位后本进程进入「终止中」：`run()` 不再派生，已在跑的 `run()` 不再兑现。只由 `shutdownTrackedTrees` 置位，不复位——
 * 置位的调用方必须随后结束本进程（见 `shutdownTrackedTrees` 文档块首句）。
 *
 * **对全部 `run()` 生效，不只是 `killTree` 派生的**（显式决定，计划双审 r1 CODEX-04）：worker 一旦进入终止中，
 * 就不该再有任何外部落地。代价是收尾路径上不带 `killTree` 的调用（`processStartTime` 的 `ps`、git 等）也会悬空，
 * 由 worker 的重新自杀与看门狗兜底——**日后在 worker 侧新增的 `run()` 调用者须知晓：终止中它不会跑完**。
 */
let treeShutdown = false;

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
  // 终止中（EV-152）：不再派生，也不兑现——进程随即退出，悬着的 Promise 无害（见 shutdownTrackedTrees）
  if (treeShutdown) return new Promise<RunResult>(() => {});
  const {
    cwd,
    env,
    timeoutMs = 0,
    killGraceMs = 5_000,
    stdin,
    onStdoutLine,
    onStderrLine,
    stopEarly,
    pty = false,
    maxBufferBytes = DEFAULT_MAX_BUFFER,
    killTree = false,
  } = opts;

  // BSD script（macOS）：`script -q /dev/null <cmd…>`；util-linux script：`script -q -c "<cmd>" /dev/null`
  const realBin = pty ? 'script' : bin;
  const realArgs = pty
    ? process.platform === 'linux'
      ? ['-q', '-c', formatCommand(bin, args), '/dev/null']
      : ['-q', '/dev/null', bin, ...args]
    : [...args];
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
    // 登记与派生之间插不进别的 JS（spawn 是同步的），所以 SIGTERM 处理器看得到每一个已派生的组
    if (killTree && child.pid !== undefined) {
      const pid = child.pid;
      liveTrees.set(pid, child);
      child.once('exit', () => {
        if (liveTrees.get(pid) === child) liveTrees.delete(pid);
      });
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let earlyStopped = false;
    let settled = false;
    let lineBuf = '';
    let errLineBuf = '';
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
      if (!onStderrLine) return;
      errLineBuf += c;
      let nl: number;
      while ((nl = errLineBuf.indexOf('\n')) !== -1) {
        const line = errLineBuf.slice(0, nl);
        errLineBuf = errLineBuf.slice(nl + 1);
        if (line.length > 0) onStderrLine(line);
      }
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (softTimer) clearTimeout(softTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (exitTimer) clearTimeout(exitTimer);
      // 终止中不兑现：兑现了调用方就会往下走（抹副本、重试、写归档终态），取消就不再由 cancelRun 收尾（EV-152）
      if (treeShutdown) return;
      if (lineBuf.length > 0 && onStdoutLine) onStdoutLine(lineBuf);
      if (errLineBuf.length > 0 && onStderrLine) onStderrLine(errLineBuf);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        earlyStopped,
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
    /*
     * 早退句柄：调用方在流式回调里判断「够了」就调它。
     * 与超时走同一条 SIGTERM → 宽限 → SIGKILL 链路，区别只在标记哪个字段——
     * 两者必须分得开，否则调用方无从判断输出是「够用了」还是「被截断了」。
     */
    stopEarly?.(() => {
      if (settled || earlyStopped) return;
      earlyStopped = true;
      signalChild('SIGTERM');
      hardTimer = setTimeout(() => signalChild('SIGKILL'), killGraceMs);
    });

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
  /**
   * 子进程**已诞生**（拿到 pid）时同步回调一次，在函数返回与 `finally` 关日志句柄之前（EV-145，事后收尾余项计划 r2 §3.3）。
   *
   * 调用方据此区分「失败时子进程有没有起来」：建日志目录、开日志文件、`spawn` 没拿到 pid 这三处失败都在子进程诞生之前，
   * 回调不会被调；而 `finally` 里的 `handle.close()` 在子进程已起之后仍可能抛——所以「本函数有没有返回」不能当判据，
   * 「有没有调用本函数」也不准。回调自身抛错被吞掉，不影响已派生的子进程与返回值。
   *
   * 第二个参数是子进程句柄的退出观察（EV-150，派生后失败的孤儿worker计划 r2 §3.2）：调用方在本函数抛错之后
   * 仍能据它确认子进程是否已退出——`handle.close()` 那一格拿不到返回值，只有这里交得出去。
   */
  onSpawned?: (pid: number, watch: DetachedChildWatch) => void;
}

/**
 * 父进程对一个已派生子进程的退出观察（EV-150）。
 *
 * **为什么能拿它防 PID 复用**：本进程是子进程的父进程。Node 的 libuv 在 SIGCHLD 时 `waitpid` 回收子进程，
 * 并在同一个回调里置上 `exitCode` / `signalCode`、发出 `'exit'`；JS 单线程，两者之间插不进别的 JS。
 * 所以在 JS 看来 `hasExited()` 为假 ⇒ 子进程还没被回收（活着或是僵尸）⇒ 它的 pid 与以它为组号的进程组号
 * 都不可能被别的进程占用。这比比对启动时刻强，也不依赖 `processStartTime`（它可能取不到）。
 * 实测范围：Node v25.2.1 / macOS（计划 r2 §2.1 K2）。
 */
export interface DetachedChildWatch {
  /** 父进程已观察到子进程退出（'exit' 事件已到） */
  hasExited(): boolean;
  /** 'exit' 事件到达时兑现 */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
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
    /*
     * spawn 失败时 Node 会**异步**再发一次 'error'；没有监听者就是未捕获异常，
     * 会盖掉下面那条本该抛出的错误、让调用方的 catch 一行都跑不到。
     * 监听必须挂在 pid 检查**之前**：原先挂在检查之后，pid 缺失时直接抛、监听从没挂上，
     * 二进制不存在（ENOENT）即整个进程崩溃退 1（事后收尾余项实施时实测）。
     *
     * 监听还要把错误对象留住（代码双审 r1 CODEX-01）：只挡住崩溃而把错误吞掉，现场就只剩「没拿到 pid」
     * 与一份空日志，看不出是哪个可执行文件不在——而 `runtime.node` / wrapper 里钉死的 node 路径随升级消失，
     * 正是这一格的常见触发面。成因只进报错正文与 `worker.log`，不进归档（`termination` 只存结构化字段）。
     */
    const seen: { err?: NodeJS.ErrnoException } = {};
    const errorArrived = new Promise<void>((resolve) => {
      child.once('error', (err: NodeJS.ErrnoException) => {
        seen.err = err;
        resolve();
      });
    });
    if (child.pid === undefined) {
      // 'error' 在下一拍才到：等它（至多 1 秒，防它不来），把成因带进报错与日志
      await Promise.race([errorArrived, new Promise<void>((r) => setTimeout(r, 1000))]);
      const cause = seen.err
        ? [seen.err.code, seen.err.message].filter(Boolean).join(' ')
        : '成因未知：1 秒内没等到 error 事件';
      const msg = `spawn 未返回 pid：${bin}（${cause}）`;
      await handle.write(`[spawnDetached ${new Date().toISOString()}] ${msg}\n`).catch(() => undefined);
      throw new Error(msg);
    }
    // 'exit' 是异步发出的，在这里同步挂上不会漏；子进程正常长跑时这个 Promise 一直悬着，无害（句柄已 unref）
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const watch: DetachedChildWatch = {
      hasExited: () => child.exitCode !== null || child.signalCode !== null,
      exited,
    };
    try {
      opts.onSpawned?.(child.pid, watch);
    } catch {
      /* 回调出错不改变「子进程已诞生」这一事实，也不连累返回值 */
    }
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
 * 向一个进程**及其同组后代**发信号。
 *
 * `spawnDetached` 用 `detached: true`（即 POSIX `setsid`），所以工作进程是自己
 * 进程组的组长、pgid 等于它的 pid；它以**不带** `killTree` 的 `run()` 拉起的子进程与它同组。
 * 只 `kill(pid)` 的话，同组的子进程会被**遗弃给 init 继续跑**——`5476238` 实测过：
 * `--cancel` 之后 `zcode-cli` 的 PPID 变成 1 且仍在消耗配额（那时它还在 worker 的组里）。
 *
 * **按组发够不到的**：审查员适配器以 `run(…, { killTree: true })` 拉起厂商 CLI，那会让 CLI 以 `detached`
 * 自成一组（`2b460ad` 起）；按 worker 的组发的信号到不了它们（零配额实测：worker 被按组 SIGTERM 后退出，
 * `killTree` 拉起的子进程过继给 init 继续活着，派生后失败的孤儿worker计划 r2 §2.1）。
 * 自 EV-152 起由 worker 自己的 SIGTERM 处理器转发（`shutdownTrackedTrees`）；worker 被 SIGKILL、崩溃或事件循环
 * 堵住时处理器跑不到，那几格仍够不到（取消够不到审查员CLI计划 r2 §3.2，BACKLOG EV-154）。
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

export interface TerminateOptions {
  /** 「确认已退出」的判据，由调用方给（父进程用子进程句柄；别的进程用 pid + 启动时刻） */
  isGone: () => boolean | Promise<boolean>;
  /** SIGTERM 之后至多等多久再升级 SIGKILL */
  graceMs: number;
  /** SIGKILL 之后至多等多久确认退出；0 = 不等 */
  killWaitMs: number;
  /** 轮询间隔，缺省 250 ms */
  pollMs?: number;
  /** 升级到 SIGKILL 之前回调一次（`cancelRun` 用它打那行 warn） */
  onEscalate?: () => void;
  /** 发信号的实现，缺省 `killProcessTree`；只为单测计数而开 */
  signal?: (pid: number, sig: NodeJS.Signals) => boolean;
}

/**
 * 按进程组终止并等待确认退出：SIGTERM → 宽限 → SIGKILL → 等待（EV-150，派生后失败的孤儿worker计划 r2 §3.2）。
 *
 * `review --cancel` 与 `--start` 派生后失败的收尾共用这一条链；判据由调用方给，两处不同：
 * `--start` 是父进程，按子进程句柄判（不会误判复用）；`--cancel` 是别的进程，按 pid 加启动时刻判。
 *
 * **每次发信号之前先问 `isGone()`**：已退出就不再发。对按句柄判的调用方，这保证不会向一个已被回收、
 * 可能已被复用的号发组信号。
 *
 * 只管这一个进程组：适配器以 `killTree` 拉起的厂商 CLI 自成一组，按 worker 的组发够不到它们——由 worker 的
 * SIGTERM 处理器经 `shutdownTrackedTrees` 转发；升级到 SIGKILL 时处理器跑不到（见 `killProcessTree`，EV-152）。
 */
export async function terminateProcessGroup(
  pid: number,
  o: TerminateOptions,
): Promise<{ gone: boolean; escalated: boolean; signals: NodeJS.Signals[] }> {
  // 实际发过的信号（按发出顺序）：调用方的播报要按事实说——一个都没发、发了却没确认退出，都不能说成「已终止」
  // （EV-150 代码双审 r1 CODEX-01 ≡ GLM-01）
  const signals: NodeJS.Signals[] = [];
  const send = (p: number, sig: NodeJS.Signals): void => {
    signals.push(sig);
    (o.signal ?? killProcessTree)(p, sig);
  };
  const pollMs = o.pollMs ?? 250;
  const waitGone = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await o.isGone()) return true;
      await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    }
    return o.isGone();
  };

  if (await o.isGone()) return { gone: true, escalated: false, signals };
  send(pid, 'SIGTERM');
  if (await waitGone(o.graceMs)) return { gone: true, escalated: false, signals };

  o.onEscalate?.();
  send(pid, 'SIGKILL');
  if (o.killWaitMs <= 0) return { gone: await o.isGone(), escalated: true, signals };
  return { gone: await waitGone(o.killWaitMs), escalated: true, signals };
}

export interface TreeShutdownOptions {
  /** 每组 SIGTERM 之后至多等多久再升级 SIGKILL */
  graceMs: number;
  /** SIGKILL 之后至多再等多久 */
  killWaitMs: number;
  /** 轮询间隔，缺省 50 ms */
  pollMs?: number;
  /** 发信号的实现，缺省 `killProcessTree`；只为单测计数而开 */
  signal?: (pid: number, sig: NodeJS.Signals) => boolean;
}

export interface TreeShutdownResult {
  /** 开始时在登记里、尚未退出的组 */
  groups: number[];
  /** 每组实际发过的信号（按发出顺序） */
  signals: Record<number, NodeJS.Signals[]>;
  /** 预算用尽仍未观察到组长退出的组 */
  remaining: number[];
}

/**
 * **调用即本进程进入终止中，不可撤销：此后 `run()` 不再派生、已在跑的不再兑现；调用方必须随后结束本进程。**
 * 否则本进程会带着一地永不兑现的 Promise 活下去（代码双审 r1 CODEX-02）。今天唯一的调用方是 worker 的
 * SIGTERM 处理器（`installWorkerSigtermForwarding`，随后必重新自杀）；日后复用它的入口（如 BACKLOG EV-155 的前台路径）
 * 同样要守这条。不设复位口：复位口只为测试开，却会给生产代码一个能把冻结撤掉的入口。
 *
 * 冻结本进程并按组终止登记里尚未退出的 `killTree` 子进程（EV-152，取消够不到审查员CLI计划 r2 §4.1）。
 *
 * - **进门同步置位冻结**：此后 `run()` 不再派生、已在跑的不再兑现。被杀的 CLI 一 `'close'`，`run()` 若照常兑现，
 *   runner 就会抹副本、判重试（重试会再派生一个 CLI），两侧都结束后 `executeRun` 写归档终态——`--cancel` 看到的
 *   就成了 worker 写下的终态，取消不再由 `cancelRun` 收尾（EV-128）。
 * - **判退出用父进程句柄**（`exitCode` / `signalCode`）：本进程是这些 CLI 的父进程，未观察到 `'exit'` ⇒ 未被回收
 *   ⇒ pid 与同号进程组不会被复用（与 `DetachedChildWatch` 同一论证），不需要启动时刻。
 * - **并行**终止各组：串行时两组都忽略 SIGTERM，耗时翻倍，会击穿 `--cancel` 的 5 s 宽限（计划双审 r1 AGY-05）。
 * - 组长退出之后不再对该组发信号：本进程判不了组是否已空，空了之后组号可能被复用。**组长一退出（含处理器运行之前
 *   已自己正常退出），该组就从 `liveTrees` 删掉、不在遍历面上——同组遗留的后代一律收不到信号，与它们是否忽略 SIGTERM
 *   无关**（覆盖矩阵 h 格，如实保留；代码双审 r1 CODEX-01 ≡ GLM-02）。组长还活着时，首个 SIGTERM 按组发，组员与组长同时收到。
 * - 登记为空时立即返回，一个信号都不发。
 */
export async function shutdownTrackedTrees(o: TreeShutdownOptions): Promise<TreeShutdownResult> {
  treeShutdown = true;
  const pending: Array<[number, ChildProcess]> = [];
  for (const [pid, child] of liveTrees) {
    if (child.exitCode === null && child.signalCode === null) pending.push([pid, child]);
  }
  const signals: Record<number, NodeJS.Signals[]> = {};
  const outcomes = await Promise.all(
    pending.map(async ([pid, child]) => {
      const t = await terminateProcessGroup(pid, {
        isGone: () => child.exitCode !== null || child.signalCode !== null,
        graceMs: o.graceMs,
        killWaitMs: o.killWaitMs,
        pollMs: o.pollMs ?? 50,
        ...(o.signal ? { signal: o.signal } : {}),
      });
      signals[pid] = t.signals;
      return { pid, gone: t.gone };
    }),
  );
  return {
    groups: pending.map(([pid]) => pid),
    signals,
    remaining: outcomes.filter((x) => !x.gone).map((x) => x.pid),
  };
}

