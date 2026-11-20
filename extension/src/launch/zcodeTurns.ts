// ZCode 0.17.1 的 TUI 在最后一次工具调用之后收到输入时，可能在轮末丢下队列。
// 每个协同终端有独立的原生日志目录；只消费主会话的轮次事件，不读取模型对话。
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export class ZcodeTurns {
  private readonly offsets = new Map<string, number>();
  private startupComplete = false;
  get started(): boolean { return this.startupComplete; }
  private sessionId?: string;
  private activeTurn?: string;
  private lastFinished?: string;
  private submittedAfter?: string;

  constructor(readonly dir: string) {}

  async refresh(): Promise<void> {
    const files = (await readdir(this.dir)).filter(name => /^zcode-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
    for (const name of files) {
      const file = join(this.dir, name);
      const end = (await stat(file)).size;
      const start = this.offsets.get(name) ?? 0;
      if (end <= start) continue;
      let partial = '';
      let consumed = start;
      for await (const chunk of createReadStream(file, { start, end: end - 1, encoding: 'utf8' })) {
        const lines = (partial + chunk).split('\n');
        partial = lines.pop()!;
        for (const line of lines) {
          this.observe(line);
          consumed += Buffer.byteLength(line) + 1;
        }
      }
      // 文件末行可能尚未写完。按完整行的字节数前进，下一次从该行行首读。
      this.offsets.set(name, consumed);
    }
  }

  private observe(line: string): void {
    if (!/"event"\s*:\s*"(?:bootstrap\.app\.startup\.completed|turn\.(?:started|completed|failed))"/.test(line)) return;
    let e;
    try { e = JSON.parse(line); } catch { return; }
    if (!e || typeof e !== 'object') return;
    if (e.module === 'bootstrap' && e.event === 'bootstrap.app.startup.completed') {
      this.startupComplete = true;
      return;
    }
    if (e.module !== 'core.runtime' || typeof e.sessionId !== 'string' || typeof e.turnId !== 'string') return;
    if (e.event === 'turn.started') this.sessionId ??= e.sessionId;
    if (e.sessionId !== this.sessionId) return;
    if (e.event === 'turn.started') this.activeTurn = e.turnId;
    else if ((e.event === 'turn.completed' || e.event === 'turn.failed') && e.turnId === this.activeTurn) {
      this.activeTurn = undefined;
      this.lastFinished = e.turnId;
    }
  }

  get busy(): boolean { return this.activeTurn !== undefined; }
  get ready(): boolean { return !this.busy && this.lastFinished !== this.submittedAfter; }
  submitted(): void { this.submittedAfter = this.lastFinished; }
}
