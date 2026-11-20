/** 每个运行独立读取核心已经脱敏的 stdout。文件不存在时绝不猜测旧版输出的安全状态。 */
import { constants, promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { SideRender } from './statusModel';

interface Cursor {
  attempt: number; identity: string; offset: number; decoder: StringDecoder; note: string;
}
export interface StdoutPatch {
  critic: string; attempt: number; identity: string; reset: boolean;
  start: number; end: number; text: string; note: string; clipped: boolean; canOpen: boolean;
}
interface Info {
  schema: string; attempt: number; file: string; identity: string; dev: string; ino: string;
  state: string; reason: string | null; bytes: number;
}

async function regular(dir: string, name: string) {
  if (await fs.realpath(dir) !== dir) throw new Error('目录已改变');
  const file = path.join(dir, name);
  const st = await fs.lstat(file, { bigint: true });
  if (!st.isFile()) throw new Error('仅支持普通文件');
  const fh = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await fh.stat({ bigint: true });
    if (actual.ino !== st.ino || actual.dev !== st.dev || !actual.isFile() || await fs.realpath(dir) !== dir)
      throw new Error('文件身份已改变');
    return { fh, stat: actual };
  } catch (e) { await fh.close(); throw e; }
}
async function infoAt(dir: string, attempt: number): Promise<Info> {
  const { fh, stat } = await regular(dir, 'stdout-live.json');
  try {
    if (stat.size > 2048n) throw new Error('实时输出记录超出大小限制');
    const info = JSON.parse(await fh.readFile('utf8')) as Info;
    if (info.schema !== 'trivium.stdout.v1' || info.attempt !== attempt ||
        !['stdout.jsonl', 'stdout.json'].includes(info.file) || !/^[0-9a-f-]{36}$/.test(info.identity) ||
        !['streaming', 'deferred', 'complete', 'recovered', 'incomplete'].includes(info.state) ||
        !Number.isSafeInteger(info.bytes) || info.bytes < 0) throw new Error('实时输出记录不可用');
    return info;
  } finally { await fh.close(); }
}

async function currentInfo(out: string, attempt: number) {
  try { return { dir: out, info: await infoAt(out, attempt) }; }
  catch (primary) {
    const dir = path.join(out, 'attempt-' + attempt);
    try { return { dir, info: await infoAt(dir, attempt) }; }
    catch { throw primary; }
  }
}

function label(info: Info, terminal: boolean, sideState: string, size: number): string {
  if (info.reason === 'timeout' || sideState === 'timeout') return '进程超时，显示已记录的输出';
  if (sideState === 'cancelled') return '进程已取消，显示已记录的输出';
  if (info.state === 'complete' && info.bytes === size) return size ? '输出已完整记录' : '进程已结束，无 stdout';
  if (info.state === 'recovered' && info.bytes === size) return '实时输出曾暂缓，最终文件已恢复';
  if (info.reason === 'interrupted') return '进程中断，显示已记录的输出';
  if (info.reason === 'capture_limit') return '超过核心收集上限，输出已截断';
  if (info.reason === 'not_started') return '进程未启动，无可确认的 stdout';
  if (info.reason === 'scrub_rewritten') return '事后清扫更新了输出，实时内容一致性未通过';
  if (info.reason === 'pipe_open') return '子进程已退出，输出管道未在宽限期内关闭';
  if (info.state === 'deferred' && info.reason === 'pending_limit') return '等待安全脱敏边界，收尾时核对';
  if (info.state === 'deferred') return '实时写入暂缓，等待核对最终文件';
  if (terminal || info.state === 'incomplete' || info.state === 'complete' || info.state === 'recovered')
    return '输出完整性未确认';
  return size ? '正在接收输出' : '等待该侧输出';
}

export class StdoutTail {
  private readonly cursors = new Map<string, Cursor>();
  private readonly infos = new Map<string, { dir: string; info: Info; checked: number }>();
  private readonly changed = new Set<string>();
  private visible = false;
  private sides: SideRender[] = [];
  private phase = '';
  private terminal = false;
  private generation = 0;
  private disposed = false;
  private timer?: NodeJS.Timeout;
  private due = 0;
  private nextSweep = 0;
  private readonly watches = new Map<string, FSWatcher>();
  private busy = false;
  private pending = false;
  private readonly root: Promise<string>;

  constructor(runDir: string, private readonly limit: number,
    private readonly send: (patch: StdoutPatch) => PromiseLike<boolean>) {
    // 允许 /tmp 与 /private/tmp 的系统别名，只把已确认的运行根作为信任锚。
    this.root = fs.realpath(runDir);
    void this.root.catch(() => undefined);
  }

  update(sides: SideRender[], phase: string, terminal: boolean): void {
    this.nextSweep = 0;
    this.changed.clear();
    this.infos.clear();
    this.sides = sides;
    this.phase = phase;
    this.terminal = terminal;
    this.schedule(0);
  }

  show(visible: boolean, reset = false): void {
    if (visible === this.visible && !reset) return;
    this.visible = visible;
    this.generation++;
    this.cursors.clear();
    this.nextSweep = 0;
    this.changed.clear();
    this.infos.clear();
    this.closeWatches();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (!this.visible || this.disposed || !this.sides.length) return;
    if (this.busy) { this.pending = true; return; }
    if (this.timer) {
      if (this.due <= Date.now() + ms) return;
      clearTimeout(this.timer);
    }
    this.due = Date.now() + ms;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, ms);
  }

  private closeWatches(): void {
    for (const watcher of this.watches.values()) watcher.close();
    this.watches.clear();
  }

  private watchSide(file: string, critic: string): void {
    if (this.terminal || this.watches.has(critic) || !this.visible || this.disposed) return;
    const watcher = watch(file, { persistent: false }, event => {
      this.changed.add(critic);
      if (event === 'rename') {
        this.infos.delete(critic);
        watcher.close();
        this.watches.delete(critic);
      }
      this.schedule(12);
    });
    watcher.on('error', () => {
      watcher.close();
      this.watches.delete(critic);
      this.schedule(200);
    });
    this.watches.set(critic, watcher);
  }

  private async tick(): Promise<void> {
    this.busy = true;
    const generation = this.generation;
    const terminal = this.terminal;
    const now = Date.now();
    const sweep = now >= this.nextSweep;
    const changed = sweep ? new Set<string>() : new Set(this.changed);
    if (sweep) this.nextSweep = now + (this.watches.size === this.sides.length ? 400 : 120);
    this.changed.clear();
    try {
      await Promise.all(this.sides.map(async side => {
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(side.critic)) return;
        if (!terminal && changed.size && !changed.has(side.critic)) return;
        const attempt = Math.max(1, side.attempt ?? 1);
        const key = side.critic;
        const previous = this.cursors.get(key);
        const old = previous?.attempt === attempt ? previous : undefined;
        let delta: StdoutPatch;
        let cursor: Cursor;
        try {
          const out = path.join(await this.root, key, 'out');
          if (generation !== this.generation) return;
          const cached = this.infos.get(key);
          const reuse = !terminal && cached?.info.attempt === attempt && Date.now() - cached.checked < 400;
          const { dir, info } = reuse ? cached : await currentInfo(out, attempt);
          if (generation !== this.generation) return;
          if (!reuse) this.infos.set(key, { dir, info, checked: Date.now() });
          // 元数据读取时已验证父目录。每一次都对打开的内容句柄再次核对设备与 inode。
          const fh = await fs.open(path.join(dir, info.file), constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
          try {
            const stat = await fh.stat({ bigint: true });
            if (!stat.isFile() || String(stat.dev) !== info.dev || String(stat.ino) !== info.ino) throw new Error('输出文件身份待复核');
            if (generation !== this.generation) return;
            if (old && old.identity !== info.identity + '/' + info.ino || previous && !old) {
              this.watches.get(key)?.close();
              this.watches.delete(key);
            }
            this.watchSide(path.join(dir, info.file), key);
            const size = Number(stat.size);
            const identity = info.identity + '/' + info.ino;
            const reset = !old || old.identity !== identity || size < old.offset || size - old.offset > this.limit;
            const start = reset ? Math.max(0, size - this.limit) : old.offset;
            const note = label(info, terminal, this.phase === 'cancelled' ? this.phase : side.state, size);
            if (!reset && start === size && old.note === note) return;
            const buf = Buffer.alloc(size - start);
            const { bytesRead } = buf.length ? await fh.read(buf, 0, buf.length, start) : { bytesRead: 0 };
            const decoder = reset ? new StringDecoder('utf8') : old.decoder;
            let first = 0;
            if (reset && start > 0) while (first < bytesRead && (buf[first]! & 0xc0) === 0x80) first++;
            cursor = { attempt, identity, offset: start + bytesRead, decoder, note };
            delta = { critic: key, attempt, identity, reset, start, end: cursor.offset,
              text: decoder.write(buf.subarray(first, bytesRead)), note, clipped: start > 0 && reset,
              canOpen: (info.state === 'complete' || info.state === 'recovered') && info.bytes === size };
          } finally { await fh.close(); }
        } catch (e) {
          this.infos.delete(key);
          let note = '实时输出记录不可读，完整性未确认';
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') note = '此尝试未提供实时 stdout 记录';
          if (this.phase === 'cancelled') note += ' · 运行已取消';
          else if (side.state === 'timeout') note += ' · 本侧超时';
          else if (terminal || side.state === 'failed') note += ' · 本侧已结束';
          const identity = old?.identity ?? '';
          if (old?.note === note && !this.pending) return;
          cursor = { attempt, identity, note, offset: old?.offset ?? 0, decoder: old?.decoder ?? new StringDecoder('utf8') };
          delta = { critic: key, attempt, identity, reset: !old, start: cursor.offset, end: cursor.offset,
            text: '', note, clipped: false, canOpen: false };
        }
        if (this.disposed || generation !== this.generation) return;
        if (await this.send(delta) && generation === this.generation) this.cursors.set(key, cursor);
        else if (generation === this.generation) this.cursors.delete(key);
      }));
    } finally {
      this.busy = false;
      if (this.pending) { this.pending = false; this.schedule(0); }
      else if (!this.terminal) this.schedule(Math.max(0, this.nextSweep - Date.now()));
      if (this.terminal) this.closeWatches();
    }
  }

  async completePath(critic: string, attempt: number): Promise<string | undefined> {
    if (!this.sides.some(s => s.critic === critic) || !/^[a-z][a-z0-9_-]{0,63}$/.test(critic) ||
        !Number.isSafeInteger(attempt) || attempt < 1) return;
    const base = await this.root.catch(() => undefined);
    if (!base) return;
    const out = path.join(base, critic, 'out');
    const voided = path.join(base, 'voided', critic);
    const name = 'attempt-' + attempt;
    const moved = await fs.readdir(voided, { withFileTypes: true }).catch(() => []);
    const dirs = [out, path.join(out, name), path.join(voided, name)];
    for (const entry of moved) {
      if (entry.isDirectory() && /^attempt-[1-9][0-9]*$/.test(entry.name)) dirs.push(path.join(voided, entry.name, name));
    }
    for (const dir of dirs) {
      try {
        const info = await infoAt(dir, attempt);
        if (info.state !== 'complete' && info.state !== 'recovered') continue;
        const { fh, stat } = await regular(dir, info.file);
        await fh.close();
        if (String(stat.ino) === info.ino && String(stat.dev) === info.dev && Number(stat.size) === info.bytes)
          return path.join(dir, info.file);
      } catch { /* 已轮转或清理，继续查本次尝试的归档位置。 */ }
    }
    return;
  }

  dispose(): void { this.disposed = true; this.show(false); }
}
