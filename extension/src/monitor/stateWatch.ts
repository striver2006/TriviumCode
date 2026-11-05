/**
 * state.json 监视（FR-4 / M3，r2 计划 D4′/D4″）。
 *
 * 解析与 diff 在纯函数模块 stateModel.ts（单测覆盖）；本模块只挂 watcher 与
 * 激活期初始扫描。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { parseGates, diffRunEnded, type StateSnapshot, type RunEndedEvent } from './stateModel';

export { ACTIVE_GATE_STATES } from './stateModel';
export type { GateRef, StateSnapshot, RunEndedEvent } from './stateModel';

export class StateWatch implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly statePath: string;
  private readonly listeners = new Set<(snap: StateSnapshot, ended: RunEndedEvent[]) => void>();
  private last: StateSnapshot | null = null;
  private disposed = false;

  constructor(
    workspaceRoot: string,
    private readonly readFile: (p: string) => Promise<string> = (p) =>
      Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.file(p)).then((b) => Buffer.from(b).toString('utf8'))),
  ) {
    this.statePath = path.join(workspaceRoot, '.trivium', 'state.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(vscode.Uri.file(this.statePath).fsPath);
    this.watcher.onDidChange(() => void this.rescan());
    this.watcher.onDidCreate(() => void this.rescan());
    void this.rescan();
  }

  /** 激活期初始扫描（CODEX-02：不依赖事件先看一眼） */
  async rescan(): Promise<void> {
    if (this.disposed) return;
    let text: string;
    try {
      text = await this.readFile(this.statePath);
    } catch {
      return;
    }
    const snap = parseGates(text);
    const ended = diffRunEnded(this.last, snap);
    this.last = snap;
    for (const l of this.listeners) l(snap, ended);
  }

  /**
   * 订阅状态变化。**立即回放最近有效快照**（CODEX-03：晚订阅者不丢初始扫描），
   * 并返回可释放句柄（CLAUDE-07：驾驶舱关闭时退订，避免泄漏广播）。
   */
  onChange(listener: (snap: StateSnapshot, ended: RunEndedEvent[]) => void): vscode.Disposable {
    this.listeners.add(listener);
    if (this.last) {
      // 回放不产生回落事件（ended 属于增量语义）
      listener(this.last, []);
    }
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  /** 测试可观测面：当前订阅数（生命周期断言用） */
  get listenerCount(): number {
    return this.listeners.size;
  }

  dispose(): void {
    this.disposed = true;
    this.watcher.dispose();
    this.listeners.clear();
  }
}
