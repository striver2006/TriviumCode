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

    if (timeoutMs > 0) {
      softTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        hardTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
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
