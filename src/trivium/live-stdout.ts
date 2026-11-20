/** 审查 stdout 的展示副本。判定仍消费 run 返回的原有内存缓冲。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pemContinuesAfter, redactSecrets } from './secrets.js';
import { run, type RunOptions, type RunResult } from './util/exec.js';
import { renameOverwriting } from './util/fsx.js';
import { warn } from './util/log.js';

export interface StdoutTarget {
  path: string;
  attempt: number;
  /** 适配器已经按凭据优先、最长优先筛出的原串。 */
  replace?: readonly string[];
}
export interface StdoutAudit {
  redacted: Record<string, number>;
  actualPath?: string;
  seal?: (scrubOk: boolean, rewritten: boolean) => Promise<void>;
}
export const stdoutAudit = new AsyncLocalStorage<StdoutAudit>();
export const STDOUT_FILES: readonly string[] = ['stdout.json', 'stdout.jsonl'];
export const STDOUT_INFO = 'stdout-live.json';
const LIMIT = 256 * 1024;
const BATCH = 32 * 1024;
type State = 'streaming' | 'deferred' | 'complete' | 'recovered' | 'incomplete';

async function publish(file: string, data: string): Promise<void> {
  const tmp = file + '.tmp-' + randomUUID();
  try {
    await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
    await renameOverwriting(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function sanitize(raw: string, target: StdoutTarget) {
  for (const value of target.replace ?? []) raw = raw.split(value).join('<redacted-env>');
  return redactSecrets(raw);
}

/**
 * 真换行使单个 token 终止。仍可能跨行的只有逐值替换、赋值键与 PEM。
 * 未决的 PEM 或多行原串走有界暂缓；跨行赋值用现有规则自身检查两种延续，
 * 不在这里抄键名。普通 JSON 记录以右大括号收束，直接走快路径。
 */
function safeBoundary(record: string, target: StdoutTarget): boolean {
  // 与 secrets.ts 的 RULES 及跨块样本保持同一脱敏边界。
  if (pemContinuesAfter(record) || target.replace?.some(s => /[\r\n]/.test(s))) return false;
  if (/[}\]);!.0-9]\s*$/.test(record)) return true;
  const probe = 'CanaryForBoundaryProbe0123456789';
  return [' = ', ''].every(prefix =>
    redactSecrets(record + prefix + probe).content.endsWith(probe));
}

/** 返回值 null 表示该侧超过安全尾段上限，须由原结果收尾。 */
export class StdoutRedactor {
  redactions = 0;
  private pending = '';
  private pendingBytes = 0;
  constructor(private readonly target: StdoutTarget) {}

  push(chunk: string): string | null {
    this.pendingBytes += Buffer.byteLength(chunk);
    if (this.pendingBytes > LIMIT) { this.pending = ''; return null; }
    this.pending += chunk;
    // 右花括号和分号同时终止凭据与声明上下文，允许没有换行的 JSON 逐段显示。
    // 网关字面原串可以含这些字符，该侧只在真实换行处切分。
    let last = this.pending.lastIndexOf('\n');
    if (!this.target.replace?.length && !this.pending.includes('-----BEGIN'))
      last = Math.max(last, this.pending.lastIndexOf('}'), this.pending.lastIndexOf(';'));
    if (last < 0) return '';
    const end = last + 1;
    const records = this.pending.slice(0, end);
    if (!safeBoundary(records, this.target)) return '';
    this.pending = this.pending.slice(end);
    this.pendingBytes = Buffer.byteLength(this.pending);
    const result = sanitize(records, this.target);
    this.redactions += result.count;
    return result.content;
  }

  finish(): string {
    const last = sanitize(this.pending, this.target);
    this.redactions += last.count;
    this.pending = '';
    this.pendingBytes = 0;
    return last.content;
  }
}

async function preservePrevious(target: StdoutTarget, info: string): Promise<void> {
  if (target.attempt === 1) return;
  let previous: { attempt?: number; file?: string };
  try { previous = JSON.parse(await fs.readFile(info, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  if (!Number.isSafeInteger(previous.attempt) || previous.attempt! < 1 || previous.attempt! >= target.attempt ||
      previous.file !== path.basename(target.path)) throw new Error('unexpected_attempt');
  const dir = path.join(path.dirname(info), 'attempt-' + previous.attempt);
  await fs.mkdir(dir, { mode: 0o700 });
  await renameOverwriting(info, path.join(dir, STDOUT_INFO));
  await renameOverwriting(target.path, path.join(dir, previous.file));
}

const active = new Set<LiveStdout>();

/** worker 按组结束子进程以后，只刷新已经过安全边界的输出，保留未确认状态。 */
export async function interruptStdout(): Promise<void> {
  await Promise.all([...active].map(stream => stream.interrupt()));
}

class LiveStdout {
  private file: string;
  private info: string;
  private readonly identity = randomUUID();
  private handle?: FileHandle;
  private readonly redactor: StdoutRedactor;
  private queue = '';
  private queuedBytes = 0;
  private writingBytes = 0;
  private writing?: Promise<void>;
  private batchTimer?: NodeJS.Timeout;
  private reason: string | null = null;
  private ownsOutput = false;
  private ended = false;
  private confirmed = 0;
  private ino = '';
  private dev = '';
  private notes = Promise.resolve();
  private truncation?: 'capture_limit' | 'pipe_open';

  constructor(private readonly target: StdoutTarget) {
    this.file = target.path;
    this.redactor = new StdoutRedactor(target);
    this.info = path.join(path.dirname(target.path), STDOUT_INFO);
  }

  private state(state: State): Promise<void> {
    if (!this.ownsOutput) return Promise.resolve();
    const data = JSON.stringify({ schema: 'trivium.stdout.v1', attempt: this.target.attempt,
      file: path.basename(this.file), identity: this.identity, dev: this.dev, ino: this.ino, state, reason: this.reason, bytes: this.confirmed });
    this.notes = this.notes.then(() => publish(this.info, data)).catch(e =>
      warn('实时 stdout 状态写入失败：' + ((e as NodeJS.ErrnoException).code ?? 'io')));
    return this.notes;
  }

  async start(): Promise<void> {
    try {
      await preservePrevious(this.target, this.info);
      this.handle = await fs.open(this.file, 'wx', 0o600);
      this.ownsOutput = true;
      const stat = await this.handle.stat({ bigint: true });
      this.dev = String(stat.dev);
      this.ino = String(stat.ino);
      await this.state('streaming');
    } catch { this.defer('open_failed'); }
  }

  private defer(reason: string): void {
    if (this.reason) return;
    this.reason = reason;
    this.queue = '';
    this.queuedBytes = 0;
    clearTimeout(this.batchTimer);
    warn('实时 stdout 暂缓：' + reason);
    void this.state('deferred');
  }

  markTruncated(reason: 'capture_limit' | 'pipe_open'): void { this.truncation ??= reason; }

  push = (chunk: string): void => {
    if (this.reason || this.ended) return;
    const safe = this.redactor.push(chunk);
    if (safe === null) this.defer('pending_limit');
    else this.enqueue(safe);
  };

  private enqueue(s: string): void {
    if (!s || this.reason) return;
    this.queuedBytes += Buffer.byteLength(s);
    if (this.queuedBytes + this.writingBytes > LIMIT) { this.defer('slow_disk'); return; }
    this.queue += s;
    if (this.queuedBytes >= BATCH) this.flush();
    else if (!this.batchTimer) this.batchTimer = setTimeout(() => this.flush(), 100);
  }

  private flush(): void {
    clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    if (!this.handle || this.writing || !this.queue || this.reason) return;
    const handle = this.handle;
    const bytes = Buffer.from(this.queue);
    this.queue = '';
    this.queuedBytes = 0;
    this.writingBytes = bytes.length;
    const slow = setTimeout(() => this.defer('slow_disk'), 1000);
    this.writing = (async () => {
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
        if (!bytesWritten) throw new Error('short_write');
        offset += bytesWritten;
      }
      if (this.handle === handle) this.confirmed += offset;
    })().catch(() => this.defer('write_failed')).finally(() => {
      clearTimeout(slow);
      this.writingBytes = 0;
      this.writing = undefined;
      if (!this.reason && this.queue) this.flush();
    });
  }

  /** 正常收尾和取消均有界等待；放弃的句柄晚到时不能改写新身份或计数。 */
  private async drain(limit: number): Promise<void> {
    this.flush();
    const deadline = Date.now() + limit;
    while (this.writing && !this.reason) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([this.writing, new Promise<void>(resolve => {
        timer = setTimeout(() => { this.defer('slow_disk'); resolve(); }, Math.max(0, deadline - Date.now()));
      })]);
      clearTimeout(timer);
    }
  }

  private closeHandle(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    return (this.writing ?? Promise.resolve()).then(() => handle?.close());
  }

  async interrupt(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.drain(200);
    this.reason = 'interrupted';
    void this.closeHandle().catch(() => undefined);
    await this.state('incomplete');
  }

  private async recoverOpen(): Promise<void> {
    // 局部打开失败时在 EOF 再试一次。旧路径被占用则独占本次尝试的备用目录。
    try { this.handle = await fs.open(this.file, 'wx', 0o600); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const dir = path.join(path.dirname(this.file), 'attempt-' + this.target.attempt);
      await fs.mkdir(dir, { mode: 0o700 });
      const file = path.join(dir, path.basename(this.file));
      this.handle = await fs.open(file, 'wx', 0o600);
      this.file = file;
      this.info = path.join(dir, STDOUT_INFO);
    }
    this.ownsOutput = true;
    await this.closeHandle();
  }

  async finish(raw: string, result: RunResult | null): Promise<void> {
    this.ended = true;
    if (!this.reason) this.enqueue(this.redactor.finish());
    await this.drain(1050);
    const closing = this.closeHandle();
    if (this.reason) void closing.catch(() => undefined);
    else await closing.catch(() => this.defer('close_failed'));
    const audit = stdoutAudit.getStore();
    if (!this.ownsOutput) {
      try { await this.recoverOpen(); }
      catch {
        if (audit) audit.actualPath = '';
        warn('实时 stdout 打开失败，收尾亦未能建立本次尝试的输出文件');
        return;
      }
    }
    if (audit) audit.actualPath = this.file;
    let state: State = 'complete';
    if (this.reason) {
      try {
        // 写盘故障时原子换 inode，使未返回的旧写入始终只作用于旧文件。
        const recovered = sanitize(raw, this.target);
        this.redactor.redactions = recovered.count;
        const content = recovered.content;
        if (this.reason === 'pending_limit' && !this.writing) {
          // 安全后缀超限不代表磁盘故障。核对既有字节，只把未发布的尾段补到同一 inode。
          await closing;
          const bytes = Buffer.from(content);
          const fh = await fs.open(this.file, 'r+');
          try {
            const st = await fh.stat({ bigint: true });
            if (String(st.dev) !== this.dev || String(st.ino) !== this.ino || Number(st.size) !== this.confirmed)
              throw new Error('identity_changed');
            const chunk = Buffer.alloc(Math.min(this.confirmed, BATCH));
            for (let off = 0; off < this.confirmed;) {
              const n = Math.min(chunk.length, this.confirmed - off);
              const { bytesRead } = await fh.read(chunk, 0, n, off);
              if (!bytesRead || !chunk.subarray(0, bytesRead).equals(bytes.subarray(off, off + bytesRead)))
                throw new Error('prefix_mismatch');
              off += bytesRead;
            }
            for (let off = this.confirmed; off < bytes.length;) {
              const { bytesWritten } = await fh.write(bytes, off, Math.min(BATCH, bytes.length - off), off);
              if (!bytesWritten) throw new Error('short_write');
              off += bytesWritten;
            }
          } finally { await fh.close(); }
        } else await publish(this.file, content);
        const stat = await fs.stat(this.file, { bigint: true });
        this.dev = String(stat.dev);
        this.ino = String(stat.ino);
        this.confirmed = Buffer.byteLength(content);
        state = 'recovered';
      } catch {
        state = 'incomplete';
        warn('实时 stdout 最终文件恢复失败');
      }
    }
    if (this.truncation || !result?.spawned || result.timedOut || result.signal || result.earlyStopped) {
      this.reason = this.truncation ?? (result?.timedOut ? 'timeout' :
        result?.signal || result?.earlyStopped ? 'interrupted' : 'not_started');
      state = 'incomplete';
    }
    if (!audit) { await this.state(state); return; }
    const relative = path.relative(path.dirname(path.dirname(this.target.path)), this.file);
    if (this.redactor.redactions) audit.redacted[relative] = this.redactor.redactions;
    audit.seal = async (scrubOk, rewritten) => {
      const stat = await fs.lstat(this.file, { bigint: true }).catch(() => null);
      if (scrubOk && rewritten && stat?.isFile()) {
        this.dev = String(stat.dev);
        this.ino = String(stat.ino);
        this.confirmed = Number(stat.size);
        this.reason = 'scrub_rewritten';
        state = 'incomplete';
        warn('实时 stdout 在事后清扫时发生额外脱敏，已更新文件身份，展示一致性未通过');
      } else if (!scrubOk || !stat?.isFile() || String(stat.ino) !== this.ino || String(stat.dev) !== this.dev || Number(stat.size) !== this.confirmed) {
        this.reason ??= 'verification_failed';
        state = 'incomplete';
      }
      await this.state(state);
    };
  }
}

export async function runReviewProcess(target: StdoutTarget | undefined, bin: string, args: readonly string[],
  opts: RunOptions): Promise<RunResult> {
  if (!target || !STDOUT_FILES.includes(path.basename(target.path))) return run(bin, args, opts);
  if (process.env.TRIVIUM_LIVE_STDOUT === '0') {
    const result = await run(bin, args, opts);
    const cleaned = sanitize(result.stdout, target);
    await publish(target.path, cleaned.content);
    const audit = stdoutAudit.getStore();
    if (audit && cleaned.count) audit.redacted[path.join('out', path.basename(target.path))] = cleaned.count;
    return result;
  }
  const stream = new LiveStdout(target);
  await stream.start();
  let result: RunResult | null = null;
  active.add(stream);
  try {
    result = await run(bin, args, { ...opts, onStdoutChunk: stream.push, onStdoutTruncated: reason => stream.markTruncated(reason) });
    return result;
  } finally {
    try { await stream.finish(result?.stdout ?? '', result); }
    finally { active.delete(stream); }
  }
}
