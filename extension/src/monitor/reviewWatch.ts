/**
 * `.reviews/<topic>/<stage>/` 目录监视（CLAUDE-06：侧完成即归档该侧审查件）。
 *
 * status.json 的 artifacts 仅整 run 终态填写；侧完成即时的正文入口来自归档目录
 * 的新文件（编排器 archive.ts 在每侧完成时立即落盘）。
 */
import * as vscode from 'vscode';
import path from 'node:path';

export interface ReviewFile {
  /** 绝对路径 */
  absPath: string;
  /** 文件名 */
  name: string;
  /** 从 front-matter 解析的作者角色（解析不到为 null，如 verify 件） */
  role: string | null;
}

export function parseRoleFromDoc(content: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return null;
  const m = /^role:\s*(\S+)$/m.exec(fm[1]!);
  return m?.[1] ?? null;
}

export class ReviewWatch implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly listeners = new Set<(files: ReviewFile[]) => void>();
  private disposed = false;

  constructor(
    private readonly stageDir: string,
    private readonly readFile: (p: string) => Promise<string> = (p) =>
      Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.file(p)).then((b) => Buffer.from(b).toString('utf8'))),
  ) {
    // 只看本阶段目录下的 md（_meta 除外）
    this.watcher = vscode.workspace.createFileSystemWatcher(
      vscode.Uri.file(path.join(stageDir, '*.md')).fsPath,
    );
    this.watcher.onDidChange(() => void this.rescan());
    this.watcher.onDidCreate(() => void this.rescan());
    this.watcher.onDidDelete(() => void this.rescan());
    void this.rescan();
  }

  async rescan(): Promise<void> {
    if (this.disposed) return;
    const { promises: fs } = await import('node:fs');
    let names: string[];
    try {
      names = await fs.readdir(this.stageDir);
    } catch {
      return;
    }
    const files: ReviewFile[] = [];
    for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
      const absPath = path.join(this.stageDir, name);
      let role: string | null = null;
      try {
        role = parseRoleFromDoc(await this.readFile(absPath));
      } catch {
        /* 读不到 front-matter 就不带角色 */
      }
      files.push({ absPath, name, role });
    }
    for (const l of this.listeners) l(files);
  }

  onChange(listener: (files: ReviewFile[]) => void): void {
    this.listeners.add(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.watcher.dispose();
    this.listeners.clear();
  }
}
