/**
 * M1 终端协同（FR-5，r2 计划 D2′/D3′）。
 *
 * - 拉起：direct（entrypoint 为可执行，作 shellPath）或 shellCommand（zcode 的
 *   .cjs 脚本：由 Node 解释器直接启动，AGY-02）；
 * - 身份：内部键 `agent|topic|entry`（CLAUDE-07），显示名只作展示；同键存活终端
 *   复用聚焦，不同键永不复用；
 * - 注入：就绪延迟（无事件驱动，D3′）→ 分段 sendText → 回车语义三模式；
 * - 失败兜底由驾驶舱的命令条承担（本模块不做「无变化=失败」推断）；
 * - 关闭：onDidCloseTerminal → 通知驾驶舱降级 M3。
 */
import * as vscode from 'vscode';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { ZcodeTurns } from './zcodeTurns';
import type { AgentId } from './carriers';

export type SendMode = 'execute' | 'split' | 'manual';

export interface LaunchOptions {
  agentId: AgentId;
  display: string;
  /** resolve 后的主题（含推导值）；点火前必须已 resolve（否则传 '?' 占位并禁止复用命中） */
  topic: string;
  entry: string;
  entrypoint: string;
  launchMode: 'direct' | 'shellCommand';
  cwd: string;
  /** shellCommand 模式的解释器绝对路径（探针 runner 或 wrapper 内嵌 node） */
  nodePath?: string | null;
  scriptEnv?: Record<string, string>;
  waitForZcodeTurn?: boolean;
}

export interface LaunchSettings {
  readyDelayMs: number;
  sendMode: SendMode;
  segmentBytes: number;
  waitForZcodeTurn?: boolean;
}

interface Session {
  key: string;
  terminal: vscode.Terminal;
  /** 注入进行中（供 UI 提示，不做硬锁） */
  injecting: boolean;
  turns?: ZcodeTurns;
  pending?: Promise<void>;
}

export const terminalKey = (agentId: string, topic: string, entry: string): string =>
  `${agentId}|${topic}|${entry}`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TerminalRelay implements vscode.Disposable {
  private readonly sessions = new Map<string, Session>();
  private readonly closeListener: vscode.Disposable;
  private readonly closeHandlers = new Set<(key: string) => void>();

  constructor(private readonly logRoot?: string) {
    this.closeListener = vscode.window.onDidCloseTerminal((t) => {
      for (const [key, s] of this.sessions) {
        if (s.terminal === t) {
          this.sessions.delete(key);
          for (const h of this.closeHandlers) h(key);
          return;
        }
      }
    });
  }

  onSessionClosed(handler: (key: string) => void): vscode.Disposable {
    this.closeHandlers.add(handler);
    return new vscode.Disposable(() => this.closeHandlers.delete(handler));
  }

  find(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  /** 取同键存活会话（复用）或创建新终端 */
  async ensureSession(opts: LaunchOptions): Promise<Session> {
    const key = terminalKey(opts.agentId, opts.topic, opts.entry);
    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.terminal.exitStatus !== undefined) {
        // 终端进程已退出（AGY-03）：旧记录失效，移除后新建
        this.sessions.delete(key);
      } else {
        existing.terminal.show();
        return existing;
      }
    }
    const name = `Trivium · ${opts.display} · ${opts.topic}`;
    let terminal: vscode.Terminal;
    let turns: ZcodeTurns | undefined;
    if (opts.launchMode === 'direct') {
      terminal = vscode.window.createTerminal({ name, shellPath: opts.entrypoint, cwd: opts.cwd });
    } else {
      // 让终端生命周期绑定到解释器。TUI 退出后不会退回可继续接收续话的 shell。
      if (!opts.nodePath) throw new Error('脚本入口需要 Node 解释器路径');
      if (opts.waitForZcodeTurn && this.logRoot) {
        mkdirSync(this.logRoot, { recursive: true });
        turns = new ZcodeTurns(mkdtempSync(join(this.logRoot, 'zcode-')));
      }
      const env = turns ? { ...opts.scriptEnv, ZCODE_LOG_DIR: turns.dir } : opts.scriptEnv;
      terminal = vscode.window.createTerminal({ name, shellPath: opts.nodePath, shellArgs: [opts.entrypoint], cwd: opts.cwd, env });
    }
    terminal.show();
    const session: Session = { key, terminal, injecting: false, turns };
    this.sessions.set(key, session);
    return session;
  }

  /**
   * 就绪延迟后注入文本。
   * 返回注入所用设置（供 UI 展示）；延迟由调用方配置注入（此方法内不再等待）。
   */
  async injectText(
    session: Session,
    text: string,
    settings: LaunchSettings,
    readyDelayMs: number,
  ): Promise<boolean> {
    session.injecting = true;
    try {
      await sleep(Math.max(0, readyDelayMs));
      if (this.sessions.get(session.key) !== session || session.terminal.exitStatus !== undefined) {
        return false;
      }
      if (session.turns) {
        await session.turns.refresh();
        session.turns.submitted();
      }
      await this.sendWithMode(session.terminal, text, settings);
      return this.sessions.get(session.key) === session && session.terminal.exitStatus === undefined;
    } finally {
      session.injecting = false;
    }
  }

  /** 续话中继：整段 + 回车（尽力而为；TUI 兼容性差的载体由用户改在终端直输） */
  async relay(session: Session, text: string, settings: LaunchSettings): Promise<void> {
    const send = () => this.sendWithMode(session.terminal, text, {
      ...settings, sendMode: settings.sendMode === 'manual' ? 'execute' : settings.sendMode,
    });
    const turns = session.turns;
    if (!turns || !settings.waitForZcodeTurn) return send();
    const deliver = async () => {
      const started = Date.now();
      while (this.sessions.get(session.key) === session && session.terminal.exitStatus === undefined) {
        await turns.refresh();
        if (turns.ready) {
          turns.submitted();
          await send();
          return;
        }
        if (!turns.busy && Date.now() - started > 30000) throw new Error('未读到 ZCode 的轮次事件，请查看原生终端。');
        await sleep(250);
      }
      throw new Error('原协同终端已关闭。');
    };
    session.pending = (session.pending ?? Promise.resolve()).then(deliver, deliver);
    await session.pending;
  }

  private async sendWithMode(terminal: vscode.Terminal, text: string, s: LaunchSettings): Promise<void> {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > s.segmentBytes) {
      // 长文分段：按字节安全切分（UTF-8 多字节字符不截断），段间 80ms
      const segments = splitUtf8(text, s.segmentBytes);
      for (let i = 0; i < segments.length; i++) {
        const last = i === segments.length - 1;
        if (last && s.sendMode === 'execute') {
          terminal.sendText(segments[i]!, true);
        } else {
          terminal.sendText(segments[i]!, false);
          await sleep(80);
        }
      }
      if (s.sendMode === 'split') {
        await sleep(150);
        terminal.sendText('', true);
      }
      // manual：只粘贴不回车，用户手按
      return;
    }
    if (s.sendMode === 'execute') {
      terminal.sendText(text, true);
    } else if (s.sendMode === 'split') {
      terminal.sendText(text, false);
      await sleep(150);
      terminal.sendText('', true);
    } else {
      terminal.sendText(text, false);
    }
  }

  dispose(): void {
    this.closeListener.dispose();
    this.sessions.clear();
  }
}

/** UTF-8 安全分段：切点回退到字符边界 */
export function splitUtf8(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let buf = '';
  let size = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (size + b > maxBytes && buf !== '') {
      out.push(buf);
      buf = '';
      size = 0;
    }
    buf += ch;
    size += b;
  }
  if (buf !== '') out.push(buf);
  return out;
}
