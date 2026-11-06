/**
 * changes-<runId>.diff 解析（FR-6d，r2 计划 D5′；纯函数，不 import vscode）。
 *
 * 流式行状态机：`#` 头部（run_id/base/head——**冻结身份在此**，CODEX-01/
 * CLAUDE-02）、`diff --git a/… b/…`（及 `+++ b/…` 兜底）文件分界（AGY-04）、
 * `@@ -a,b +c,d @@` hunk 归属与**正文行收集**（CLAUDE-02：静态一致性比对需要
 * 「base blob + 补丁段 → 送审工作树内容」重建，正文行是必要输入）、
 * `/dev/null` 判新增/删除（AGY-06；无 --git 头的简化 patch 用 pendingAdded，
 * AGY-03）。
 * 内存面：只保留文件分界与 hunk 头+正文（不建全仓全文模型，D8′）。
 */

/** changes.diff 解析结果 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** hunk 正文行（原样含前导 +/-/空格；`\` 行剔除） */
  lines: string[];
}

export interface DiffFileInfo {
  relPath: string;
  /** `--- /dev/null` → 本轮新增（无基线） */
  added: boolean;
  /** `+++ /dev/null` → 本轮删除 */
  deleted: boolean;
  hunks: DiffHunk[];
}

export interface ParsedChangesDiff {
  runId: string | null;
  /** 字面 HEAD 或自定义 ref/sha（`resolveBaseRef` 消费，CLAUDE-05） */
  base: string | null;
  /** 补丁生成时的 HEAD 提交 sha（base 为字面 HEAD 时即被审 base 的冻结身份） */
  head: string | null;
  files: DiffFileInfo[];
}

/**
 * 解析 changes.diff 全文。坏输入尽力返回已解析部分（不抛异常）。
 */
export function parseChangesDiff(text: string): ParsedChangesDiff {
  const lines = text.split('\n');
  const result: ParsedChangesDiff = { runId: null, base: null, head: null, files: [] };

  // 头部字段（连续 # 注释段的 `# key: value` 形态）
  for (const raw of lines) {
    if (!raw.startsWith('#')) break;
    const m = /^#\s*(\w+):\s*(.+)$/.exec(raw);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'run_id') result.runId = value!.trim();
    else if (key === 'base') result.base = value!.trim();
    else if (key === 'head') result.head = value!.trim();
  }

  const byPath = new Map<string, DiffFileInfo>();
  let current: DiffFileInfo | null = null;
  let pendingAdded = false; // AGY-03：无 --git 头的简化 patch，--- /dev/null 先于 +++ 出现
  let hunk: DiffHunk | null = null;
  let oldCnt = 0;
  let newCnt = 0;

  for (const raw of lines) {
    if (hunk !== null && raw.startsWith('\\')) {
      continue; // `\ No newline at end of file`：修饰前一行的标记，跳过且不结束 hunk（AGY-02/CODEX-04）
    }
    if (hunk !== null) {
      // hunk 正文收集：按行首字符计数，两侧行数收满即结束
      if ((raw.startsWith(' ') || raw.startsWith('+') || raw.startsWith('-')) && !(oldCnt >= hunk.oldLines && newCnt >= hunk.newLines)) {
        hunk.lines.push(raw);
        if (!raw.startsWith('+')) oldCnt++;
        if (!raw.startsWith('-')) newCnt++;
        continue;
      }
      hunk = null; // 收满或遇标记行：结束当前 hunk，继续按标记处理本行
    }
    // 文件分界（AGY-04）：diff --git a/x b/x 是权威分界；+++ b/x 兜底
    let m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
    if (m) {
      current = ensureFile(byPath, result, m[2]!);
      pendingAdded = false;
      continue;
    }
    if (/^--- \/dev\/null/.test(raw)) {
      if (current) current.added = true;
      else pendingAdded = true; // AGY-03：简化 patch 的下一 +++ 行建文件时赋予
      continue;
    }
    m = /^\+\+\+ (?:b\/)?(.+)$/.exec(raw);
    if (m && m[1] !== '/dev/null') {
      const relPath = m[1]!.replace(/\t.*$/, '');
      current = byPath.get(relPath) ?? ensureFile(byPath, result, relPath);
      if (pendingAdded) {
        current.added = true;
        pendingAdded = false;
      }
      continue;
    }
    if (/^\+\+\+ \/dev\/null/.test(raw) && current) {
      current.deleted = true;
      continue;
    }
    // hunk 头：@@ -a[,b] +c[,d] @@ —— 归属当前文件
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h && current) {
      hunk = {
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        lines: [],
      };
      oldCnt = 0;
      newCnt = 0;
      current.hunks.push(hunk);
    }
  }
  return result;
}

function ensureFile(byPath: Map<string, DiffFileInfo>, result: ParsedChangesDiff, relPath: string): DiffFileInfo {
  let f = byPath.get(relPath);
  if (!f) {
    f = { relPath, added: false, deleted: false, hunks: [] };
    byPath.set(relPath, f);
    result.files.push(f);
  }
  return f;
}

/** 变更集成员判定：relPath 是否在该轮变更集内 */
export function diffMember(diff: ParsedChangesDiff, relPath: string): DiffFileInfo | null {
  return diff.files.find((f) => f.relPath === relPath) ?? null;
}

/**
 * 被审 base 的**冻结提交身份**（CLAUDE-05）：
 * - `base === 'HEAD'`（缺省）→ 补丁生成时的 HEAD 即被审 base，用冻结 head sha；
 * - base 为 40 位 sha → 直接用；
 * - 其它 ref 字面量（分支名等）→ 无法冻结（回放时 ref 可能已移动）→ null（降级明示）。
 */
export function resolveBaseRef(diff: ParsedChangesDiff): string | null {
  if (!diff.base || !diff.head) return null;
  if (diff.base === 'HEAD') return diff.head;
  if (/^[0-9a-f]{40}$/.test(diff.base)) return diff.base;
  return null;
}

/** 意见行是否位于被审变更的 head 侧区间内（辅助提示用，宽松判定） */
export function lineInHunks(info: DiffFileInfo, startLine: number): boolean {
  return info.hunks.some((h) => startLine >= h.newStart && startLine <= h.newStart + Math.max(h.newLines - 1, 0));
}

/**
 * 把补丁段应用到 base 内容，重建**送审工作树内容**（CLAUDE-02：静态一致性
 * 的正确基线是送审工作树，不是 base 提交也不是 head 提交）。
 * hunks 须按文件内顺序（解析顺序即如此）；行尾统一 \n。
 */
export function applyHunks(baseContent: string, hunks: DiffHunk[]): string {
  const base = baseContent.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let cursor = 0; // base 侧行游标（0 起）
  for (const h of hunks) {
    const startIdx = Math.max(0, h.oldStart - 1);
    if (startIdx > cursor) out.push(...base.slice(cursor, startIdx));
    cursor = startIdx;
    for (const line of h.lines) {
      if (line.startsWith('+')) {
        out.push(line.slice(1));
        // '+' 行不消耗 base 游标
      } else if (line.startsWith('-')) {
        cursor++; // '-' 行消耗一行 base，不产出
      } else {
        out.push(line.slice(1)); // context 行
        cursor++;
      }
    }
  }
  if (cursor < base.length) out.push(...base.slice(cursor));
  return out.join('\n');
}
