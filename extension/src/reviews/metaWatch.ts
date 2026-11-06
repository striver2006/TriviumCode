/**
 * `_meta/` 目录监视（r2 计划 D4′/D7′：CODEX-03/AGY-01 服务级持有）。
 *
 * 监听 `.reviews/<主题>/<阶段>/_meta/` 下 review-*.json 与 changes-*.diff 的
 * 落盘/变更（侧完成即归档，CLAUDE-06 第一批），事件触发全量 rescan（幂等）。
 *
 * 用 node `fs.watch`（目录级，吃原子替换 tmp+rename）而非 vscode FileSystemWatcher：
 * 归档根可能不在 VS Code workspace 内（多根/子目录场景），workspace 外路径的
 * vscode watcher 事件不可靠——第一批 RunWatch 已实测踩坑（交付说明平台事实 3）。
 * 生命周期归 AnnotationHub（随 scope 启停）——独立于驾驶舱面板。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';

export interface MetaFile {
  absPath: string;
  name: string;
}

export class MetaWatch implements vscode.Disposable {
  private watcher: FSWatcher | null = null;
  private readonly listeners = new Set<(files: MetaFile[]) => void>();
  private disposed = false;

  constructor(
    private readonly metaDir: string,
    private readonly listDir: (p: string) => Promise<string[]> = defaultListDir,
  ) {
    this.mount();
    void this.rescan();
  }

  /** 目录级监听；目录被重建（原子替换整目录的场景）时重挂 */
  private mount(): void {
    if (this.disposed) return; // CODEX-05：已释放实例不再持有任何 fs 句柄
    try {
      this.watcher = watch(this.metaDir, { persistent: false }, () => void this.rescan());
    } catch {
      // 目录尚不存在：AnnotationsHub 在 scope 建立时会先 ingest（读到空），
      // 目录由编排器创建后无事件——由 Hub 的 setActiveRun/ingest 补扫兜底
      this.watcher = null;
    }
  }

  async rescan(): Promise<void> {
    if (this.disposed) return;
    let names: string[];
    try {
      names = await this.listDir(this.metaDir);
    } catch {
      return;
    }
    if (this.disposed) return; // CODEX-05：读取期间 dispose → 不再补挂
    // 挂载失败的目录此刻可能已建：补挂
    if (!this.watcher) this.mount();
    const files = names
      .filter((n) => /^review-.+\.json$/.test(n) || /^changes-.*\.diff$/.test(n))
      .sort()
      .map((name) => ({ absPath: path.join(this.metaDir, name), name }));
    for (const l of this.listeners) l(files);
  }

  onChange(listener: (files: MetaFile[]) => void): void {
    this.listeners.add(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
  }
}

async function defaultListDir(p: string): Promise<string[]> {
  const { promises: fs } = await import('node:fs');
  return fs.readdir(p);
}
