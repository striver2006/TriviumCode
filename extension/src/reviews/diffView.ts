/**
 * Diff 视图打开（FR-6d 的 VS Code 侧，r2 计划 D5′：冻结基线版）。
 *
 * 解析在 diffParse.ts（纯函数）；本模块负责打开与降级：左侧 = 该 run 冻结
 * head sha（CODEX-01/CLAUDE-02），右侧 = 当前工作区文件并在标题明示；新增 →
 * 打开文件 + 提示（AGY-06）；删除 → 打开 sha 侧只读基线；head 对象缺失或
 * git 扩展不可用 → 降级打开文件 + 明示原因（不静默）。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import type { ParsedChangesDiff } from './diffParse';
import { diffMember, resolveBaseRef } from './diffParse';

/** 内置 git 扩展公开 API 的最小形态（vscode.git@1；缺省可用，禁用/缺失则降级） */
export interface GitApiShape {
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

let gitApiCache: GitApiShape | null | undefined;
/** 测试注入口：设置后恒定返回该值（真实扩展探测被绕过；undefined = 恢复真实探测） */
let gitApiOverride: GitApiShape | null | undefined;

async function getGitApi(): Promise<GitApiShape | null> {
  if (gitApiOverride !== undefined) return gitApiOverride;
  if (gitApiCache !== undefined) return gitApiCache;
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) {
      gitApiCache = null;
      return null;
    }
    const exports = (await ext.activate()) as { getAPI?: (v: number) => GitApiShape };
    gitApiCache = typeof exports.getAPI === 'function' ? exports.getAPI(1) : null;
  } catch {
    gitApiCache = null;
  }
  return gitApiCache;
}

export interface OpenDiffOutcome {
  opened: 'diff' | 'file';
  note: string;
}

/**
 * 打开意见关联变更的 Diff（冻结基线）。降级路径全部明示原因。
 */
export async function openDiffFor(
  workspaceRoot: string,
  diff: ParsedChangesDiff | null,
  relPath: string,
  reveal?: { startLine: number; endLine: number },
): Promise<OpenDiffOutcome> {
  const abs = path.join(workspaceRoot, relPath);
  const fileUri = vscode.Uri.file(abs);
  const member = diff ? diffMember(diff, relPath) : null;
  if (!diff || !member) {
    await showFile(fileUri, reveal);
    return { opened: 'file', note: diff ? '该文件不在本轮变更集，直接打开' : '该轮无 changes.diff（plan 阶段或工件缺失），直接打开' };
  }
  if (member.added) {
    await showFile(fileUri, reveal);
    return { opened: 'file', note: '本轮新增文件，无基线版本，直接打开' };
  }
  // CLAUDE-05：被审 base 的冻结提交身份——base 字面 HEAD → 用 head sha；
  // 40 位 sha → 直接用；其它 ref 字面量无法冻结 → 降级明示
  const baseRef = resolveBaseRef(diff);
  const api = await getGitApi();
  if (!api || !baseRef) {
    const reason = !api
      ? '内置 git 扩展不可用，无法对比基线'
      : diff.base !== 'HEAD' && !/^[0-9a-f]{40}$/.test(diff.base ?? '')
        ? `自定义 base「${diff.base}」未能冻结为提交身份，无法对比基线`
        : 'changes.diff 无冻结 head，无法对比基线';
    if (member.deleted) {
      // CLAUDE-06：删除文件无工作区路径可打开——仅明示，不 showFile
      vscode.window.showWarningMessage(`Trivium Diff：本轮已删除 ${relPath}；${reason}`);
      return { opened: 'file', note: `本轮已删除该文件；${reason}` };
    }
    await showFile(fileUri, reveal);
    return { opened: 'file', note: `${reason}，直接打开` };
  }
  const gitUri = api.toGitUri(fileUri, baseRef);
  // base 对象存在性探测（GC/浅克隆缺失 → 降级）
  let baseReadable = true;
  try {
    await vscode.workspace.fs.readFile(gitUri);
  } catch {
    baseReadable = false;
  }
  if (member.deleted) {
    // CLAUDE-06：删除分支独立处理——只读基线可开则开，否则仅明示（绝不打开工作区路径）
    if (baseReadable) {
      await vscode.window.showTextDocument(gitUri, { preview: true });
      return { opened: 'file', note: `本轮已删除该文件，打开被审基线 ${baseRef.slice(0, 8)}（只读）` };
    }
    vscode.window.showWarningMessage(`Trivium Diff：本轮已删除 ${relPath}；被审基线 ${baseRef.slice(0, 8)} 对象不可读（可能已被 GC）`);
    return { opened: 'file', note: '本轮已删除该文件，被审基线对象不可读' };
  }
  if (!baseReadable) {
    await showFile(fileUri, reveal);
    return { opened: 'file', note: `被审基线 ${baseRef.slice(0, 8)} 对象不可读（可能已被 GC），直接打开` };
  }
  const title = `${path.basename(relPath)}（Trivium 审查 · ${diff.runId ?? ''} · 右侧为当前文件）`;
  await vscode.commands.executeCommand('vscode.diff', gitUri, fileUri, title, { preview: true });
  if (reveal) {
    // diff 布局就绪是异步的：轮询等右侧（工作区文件）成为活动编辑器再定位
    for (let i = 0; i < 20; i++) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.toString() === fileUri.toString()) {
        revealRange(editor, reveal);
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return { opened: 'diff', note: `被审基线 ${baseRef.slice(0, 8)} 对比当前文件` };
}

function revealRange(editor: vscode.TextEditor, reveal: { startLine: number; endLine: number }): void {
  const line = Math.max(0, Math.min(reveal.startLine - 1, editor.document.lineCount - 1));
  const endLine = Math.max(line, Math.min(reveal.endLine - 1, editor.document.lineCount - 1));
  editor.revealRange(new vscode.Range(line, 0, endLine, 0), vscode.TextEditorRevealType.InCenter);
  editor.selection = new vscode.Selection(line, 0, endLine, 0);
}

async function showFile(uri: vscode.Uri, reveal?: { startLine: number; endLine: number }): Promise<void> {
  const editor = await vscode.window.showTextDocument(uri, { preview: true });
  if (reveal) revealRange(editor, reveal);
}

/** 测试复位：git 扩展 API 缓存与注入 */
export function resetGitApiCacheForTest(override?: GitApiShape | null): void {
  gitApiCache = undefined;
  gitApiOverride = override;
}
