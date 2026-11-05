/**
 * 单个 run 的监控会话（FR-4，r2 计划 D5′）。
 *
 * status.json watcher（幂等渲染，N3）+ 独立周期心跳重估定时器（worker 停写
 * 场景仍能发现失联，CLAUDE-05/CODEX-03）+ 终态 `--status` 复核（不一致以 CLI
 * 为准）+ Disposable（终态复核完成即清理，AGY-05）。
 *
 * 运行目录在 run_root（工作区之外）：用 node fs.watch 做目录级监听——一次
 * 覆盖 status.json / worker.log 的创建与原子替换；VS Code FileSystemWatcher
 * 对 workspace 外路径的事件不可靠（集成测试实测）。目录尚不存在（闸门先行
 * 窗口）时按 2s 重试挂载（CODEX-02）。
 */
import * as vscode from 'vscode';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { heartbeatStale, parseStatus, TERMINAL_PHASES, type StatusRender } from './statusModel';

export interface RunWatchEvents {
  onRender: (render: StatusRender, extra: { stale: boolean; note: string | null }) => void;
  /**
   * 终态复核完成（CODEX-04：render 已按 CLI 复核结果修正；此后本监控会话
   * 自动 dispose）。
   */
  onFinal: (render: StatusRender, note: string | null) => void;
  /** status.json 的 schema 不兼容/未知（CODEX-07：上报驾驶舱统一降级判定） */
  onSchemaIssue?: (reason: string) => void;
  onLog?: (tail: string) => void;
}

export interface RunWatchOptions {
  runDir: string;
  runId: string;
  heartbeatStaleS: number;
  /** 心跳重估周期（秒） */
  heartbeatIntervalS: number;
  logTailBytes: number;
  /** 终态复核：调 review --status 的函数（注入以便测试） */
  statusProbe: (runId: string) => Promise<{ phase: string | null; artifacts: string[] | null } | null>;
}

export class RunWatch implements vscode.Disposable {
  private dirWatcher: FSWatcher | null = null;
  private mountTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastRender: StatusRender | null = null;
  private stale = false;
  private crossChecked = false;
  private disposed = false;
  /** 复核期间收到的文件事件（恢复监控时补读，CODEX-03） */
  private pendingRefresh = false;
  /** 目录事件去抖（原子替换会产生连续事件） */
  private refreshTimer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: RunWatchOptions,
    private readonly events: RunWatchEvents,
    private readonly readFile: (p: string) => Promise<string> = async (p) => {
      const { promises: fs } = await import('node:fs');
      return fs.readFile(p, 'utf8');
    },
  ) {
    this.mountWatcher();
    // 独立于文件事件的周期重估（D5′）
    this.heartbeatTimer = setInterval(() => this.reassess(), Math.max(5, opts.heartbeatIntervalS) * 1000);
    void this.refresh();
    void this.tailLog();
  }

  /**
   * 挂载目录级 watcher；目录未建（闸门先行窗口）按 2s 重试。
   * 重试任务**单例**（CODEX-04）：失败不叠加 interval，成功即停，dispose 全清。
   */
  private mountWatcher(): void {
    const attempt = (): boolean => {
      try {
        this.dirWatcher = watch(this.opts.runDir, { persistent: false }, (_event, filename) => {
          const name = filename ?? '';
          if (name === '' || name === 'status.json' || name.endsWith('.tmp-')) this.scheduleRefresh();
          if (name === '' || name === 'worker.log' || name.endsWith('.tmp-')) this.scheduleLog();
        });
        return true;
      } catch {
        return false;
      }
    };
    if (attempt()) return;
    if (this.mountTimer) return; // 已有重试任务在跑
    this.mountTimer = setInterval(() => {
      if (this.disposed) {
        this.stopMount();
        return;
      }
      if (attempt()) {
        this.stopMount();
        void this.refresh();
        void this.tailLog();
      }
    }, 2_000);
  }

  private stopMount(): void {
    if (this.mountTimer) {
      clearInterval(this.mountTimer);
      this.mountTimer = null;
    }
  }

  private scheduleRefresh(): void {
    this.stopMount(); // 已能收到事件：挂载重试使命完成
    if (this.refreshTimer || this.disposed) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 200);
  }

  private scheduleLog(): void {
    if (this.logTimer || this.disposed) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      void this.tailLog();
    }, 300);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.crossChecked) {
      // 复核期间不丢事件（CODEX-03）：恢复监控时补读最新快照
      this.pendingRefresh = true;
      return;
    }
    let text: string;
    try {
      text = await this.readFile(path.join(this.opts.runDir, 'status.json'));
    } catch {
      return;
    }
    const { render, schemaReason } = parseStatus(text);
    if (schemaReason) this.events.onSchemaIssue?.(schemaReason); // CODEX-07：上报统一降级
    if (!render) return; // 旧快照/半截 JSON/不兼容：丢弃，保留上次渲染（N3）
    this.lastRender = render;
    this.stale = heartbeatStale(render.heartbeatAt, Date.now(), this.opts.heartbeatStaleS);
    this.events.onRender(render, {
      stale: this.stale,
      note: this.stale ? this.staleNote() : null,
    });
    if (render.terminal) void this.crossCheck(render);
  }

  /** 周期重估：无文件事件也能发现失联（终态后停表） */
  private reassess(): void {
    if (this.disposed || !this.lastRender || this.lastRender.terminal) return;
    const nowStale = heartbeatStale(this.lastRender.heartbeatAt, Date.now(), this.opts.heartbeatStaleS);
    if (nowStale !== this.stale) {
      this.stale = nowStale;
      this.events.onRender(this.lastRender, { stale: nowStale, note: nowStale ? this.staleNote() : null });
    }
  }

  private staleNote(): string {
    return `心跳超过 ${this.opts.heartbeatStaleS}s 未更新：worker 可能失联（--wait 的失联收尾语义适用）。worker.log：${path.join(this.opts.runDir, 'worker.log')}`;
  }

  /**
   * 终态复核（CODEX-04 三态，以 review --status 为准）：
   * 1. CLI 也是终态 → 用 CLI 的 phase/artifacts 修正终稿 → onFinal → dispose；
   * 2. CLI 仍在运行（文件快照竞态抢先）→ 恢复监控，以下次终态再复核，不 dispose；
   * 3. 复核调用失败 → 文件快照作为终稿 + 注明（诚实降级），dispose。
   */
  private async crossCheck(render: StatusRender): Promise<void> {
    if (this.crossChecked || this.disposed) return;
    this.crossChecked = true;
    let probe: { phase: string | null; artifacts: string[] | null } | null = null;
    let probeFailed = false;
    try {
      probe = await this.opts.statusProbe(this.opts.runId);
    } catch {
      probeFailed = true;
    }
    if (probe && probe.phase && TERMINAL_PHASES.has(probe.phase)) {
      const phaseChanged = probe.phase !== render.phase;
      const artifacts = probe.artifacts && probe.artifacts.length > 0 ? probe.artifacts : render.artifacts;
      const artifactsChanged = JSON.stringify(artifacts) !== JSON.stringify(render.artifacts);
      const finalRender: StatusRender = phaseChanged || artifactsChanged
        ? { ...render, phase: probe.phase, terminal: true, artifacts }
        : render;
      this.lastRender = finalRender;
      this.events.onFinal(
        finalRender,
        phaseChanged || artifactsChanged ? '文件快照已按 --status 复核修正（以 CLI 为准）' : null,
      );
      this.dispose();
      return;
    }
    if (probe && probe.phase && !TERMINAL_PHASES.has(probe.phase)) {
      // 文件抢跑：CLI 权威仍在运行 → 恢复监控（并补读复核期间落盘的快照，CODEX-03）
      this.crossChecked = false;
      this.lastRender = { ...render, phase: probe.phase, terminal: false };
      this.events.onRender(this.lastRender, {
        stale: this.stale,
        note: '文件快照显示终态，但 --status 复核仍在运行：已恢复监控，以下次终态为准',
      });
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        void this.refresh();
      }
      return;
    }
    this.events.onFinal(render, probeFailed ? '终态复核调用失败：以文件快照为准展示' : '终态复核无有效结果：以文件快照为准展示');
    this.dispose();
  }

  private async tailLog(): Promise<void> {
    if (this.disposed || !this.events.onLog) return;
    try {
      const { open } = await import('node:fs/promises');
      const fh = await open(path.join(this.opts.runDir, 'worker.log'), 'r');
      try {
        const size = (await fh.stat()).size;
        const start = Math.max(0, size - this.opts.logTailBytes);
        const buf = Buffer.alloc(size - start);
        await fh.read(buf, 0, buf.length, start);
        this.events.onLog(buf.toString('utf8'));
      } finally {
        await fh.close();
      }
    } catch {
      /* worker.log 尚未创建：忽略 */
    }
  }

  get current(): StatusRender | null {
    return this.lastRender;
  }

  get isCrossChecked(): boolean {
    return this.crossChecked;
  }

  /** 测试可观测面：挂载重试任务是否仍在（CODEX-04 断言用） */
  get hasMountRetry(): boolean {
    return this.mountTimer !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMount();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.logTimer) clearTimeout(this.logTimer);
    try {
      this.dirWatcher?.close();
    } catch {
      /* 已关 */
    }
    this.dirWatcher = null;
  }
}
