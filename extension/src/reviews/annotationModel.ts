/**
 * 批注装配模型（FR-6b/6c 的纯函数层，r2 计划 D3′）。
 *
 * 输入已解析锚点的 findings，输出线程/诊断描述模型——VS Code 对象
 * （CommentThread/Diagnostic/Range）由 AnnotationHub 装配，保证 thread.range
 * 与 diagnostic.range **同源**（CLAUDE-05：[start,end] 区间贯通，多行 location
 * 不折叠）。漂移/降级统一「⚠」标签；severity 映射 blocker/major→Error、
 * minor→Warning、nit→Information（FR-6c）。
 *
 * 纯函数模块：不 import vscode。
 */
import type { ParsedReview, ReviewFinding, FindingSeverity } from './reviewParse';
import type { LocationResolution } from './locationResolve';

/** severity → 诊断档位（FR-6c 映射；thread label 复用同一映射来源） */
export type DiagLevel = 'error' | 'warning' | 'information';

export function severityToDiagLevel(s: FindingSeverity): DiagLevel {
  if (s === 'blocker' || s === 'major') return 'error';
  if (s === 'minor') return 'warning';
  return 'information';
}

/** 单条意见的解析结果（Hub 逐 finding 解析后进入本层） */
export interface ResolvedFinding {
  critic: string;
  runId: string;
  finding: ReviewFinding;
  resolution: LocationResolution;
}

export interface CommentModel {
  critic: string;
  findingId: string;
  severity: FindingSeverity;
  /** markdown 正文（problem + 建议 + 证据截断 + 漂移标注） */
  body: string;
}

export interface ThreadModel {
  /** 工作区相对路径 */
  file: string;
  /** 主锚点区间（1 起始） */
  startLine: number;
  endLine: number;
  label: string;
  comments: CommentModel[];
  /** 漂移/一致性标注（线程级聚合） */
  driftNotes: string[];
}

export interface DiagnosticModel {
  file: string;
  startLine: number;
  endLine: number;
  level: DiagLevel;
  message: string;
  code: string;
}

export interface BuildResult {
  threads: ThreadModel[];
  diagnostics: DiagnosticModel[];
  /** 单文件线程超限溢出（仅诊断，CLAUDE-04/D8′ 量级控制） */
  overflow: Array<{ file: string; count: number }>;
  /** 总量超限 → 线程整体折叠为仅诊断（CLAUDE-11：用户可见提示的依据） */
  totalSuppressed: boolean;
  /** 只进意见列表、不建 thread/诊断的 finding（doc/outside/missing-file） */
  listOnly: Array<{ critic: string; findingId: string; reason: string }>;
}

export interface BuildOptions {
  /** 逐家开关：null/空集合 = 全部启用 */
  enabledCritics: Set<string> | null;
  /** 单文件线程上限（缺省 200） */
  maxThreadsPerFile: number;
  /** scope 总量上限：超过则全部仅诊断（缺省 2000） */
  maxTotalFindings: number;
}

const EVIDENCE_TRUNCATE = 500;

/** finding 的漂移/一致性标注（列表、线程、诊断三处统一） */
export function driftNotesOf(rf: ResolvedFinding): string[] {
  const notes: string[] = [];
  const primary = rf.resolution.anchors[0];
  if (primary?.label) notes.push(primary.label);
  if (primary?.drift) notes.push(`漂移：${primary.drift}`);
  const c = rf.resolution.consistency;
  if (c.state === 'mismatch') notes.push('⚠ 与送审版本不一致');
  if (c.state === 'edited') notes.push('⚠ 文件已在批注挂载后被编辑');
  return notes;
}

function commentBody(rf: ResolvedFinding, notes: string[]): string {
  const f = rf.finding;
  const parts: string[] = [];
  if (notes.length > 0) parts.push(notes.join(' ｜ '));
  parts.push(f.problem);
  // CLAUDE-03：次级锚点（逗号多区间/分号多文件的其余位置）在批注正文完整列出
  const secondary = rf.resolution.anchors.slice(1).map((a) => a.label ?? a.relPath);
  if (secondary.length > 0) parts.push(`**其余位置**：${secondary.join('；')}`);
  parts.push(`**建议**：${f.suggestion}`);
  if (f.evidence.length > EVIDENCE_TRUNCATE) {
    parts.push(`**证据**：${f.evidence.slice(0, EVIDENCE_TRUNCATE)}…（截断）`);
  } else {
    parts.push(`**证据**：${f.evidence}`);
  }
  parts.push(`（置信度 ${f.confidence}）`);
  return parts.join('\n\n');
}

/**
 * 装配线程与诊断模型。
 *
 * - thread 粒度 (file, 主锚点起始行)：同行多 finding → 同 thread 多 comment（分层）；
 * - 文件级/漂移 → 线程挂文件首行、诊断 range 首行，均带 ⚠ 标注；
 * - doc/outside/missing-file → listOnly（意见列表展示，不建 VS Code 对象）。
 */
export function buildAnnotationModels(findings: ResolvedFinding[], opts: BuildOptions): BuildResult {
  const enabled = (critic: string): boolean => !opts.enabledCritics || opts.enabledCritics.size === 0 || opts.enabledCritics.has(critic);

  const total = findings.filter((rf) => enabled(rf.critic));
  const threadsOnlyDiagnostics = total.length > opts.maxTotalFindings;

  // 按 (file, 起始行) 分组；文件级归到起始行 1
  const byThread = new Map<string, { file: string; start: number; end: number; comments: CommentModel[]; notes: string[]; hasLine: boolean }>();
  const diagnostics: DiagnosticModel[] = [];
  const listOnly: BuildResult['listOnly'] = [];

  for (const rf of total) {
    const f = rf.finding;
    const notes = driftNotesOf(rf);
    const primary = rf.resolution.anchors[0];

    if (rf.resolution.kind !== 'file' || !primary) {
      const reason = rf.resolution.kind === 'doc' ? '非文件位置（文档引用）' : rf.resolution.kind === 'outside' ? '路径越界（工作区外）' : `文件缺失：${rf.resolution.missingRelPath}`;
      listOnly.push({ critic: rf.critic, findingId: f.id, reason });
      continue;
    }

    const line = primary.level === 'line' && primary.line ? primary.line : null;
    const start = line ? line.start : 1;
    const end = line ? line.end : 1;
    const key = `${primary.relPath}#${start}`;
    let slot = byThread.get(key);
    if (!slot) {
      slot = { file: primary.relPath, start, end, comments: [], notes: [], hasLine: line !== null };
      byThread.set(key, slot);
    }
    slot.comments.push({ critic: rf.critic, findingId: f.id, severity: f.severity, body: commentBody(rf, notes) });
    for (const n of notes) if (!slot.notes.includes(n)) slot.notes.push(n);
    if (line && end > slot.end) slot.end = end;

    // 诊断逐 finding 一条（与 thread 同源区间；文件级 range 首行）
    const prefix = notes.length > 0 ? `${notes.join(' ｜ ')} ｜ ` : '';
    diagnostics.push({
      file: primary.relPath,
      startLine: start,
      endLine: end,
      level: severityToDiagLevel(f.severity),
      message: `${prefix}${f.id} · ${firstLine(f.problem)}`,
      code: f.id,
    });
  }

  // 单文件线程上限：超出部分仅诊断
  const perFileCount = new Map<string, number>();
  const threads: ThreadModel[] = [];
  const overflow: BuildResult['overflow'] = [];
  for (const slot of byThread.values()) {
    const count = (perFileCount.get(slot.file) ?? 0) + 1;
    perFileCount.set(slot.file, count);
    if (count > opts.maxThreadsPerFile) {
      const of = overflow.find((o) => o.file === slot.file);
      if (of) of.count++;
      else overflow.push({ file: slot.file, count: 1 });
      continue;
    }
    threads.push(threadModelOf(slot));
  }

  return {
    threads: threadsOnlyDiagnostics ? [] : threads,
    diagnostics,
    overflow,
    totalSuppressed: threadsOnlyDiagnostics,
    listOnly,
  };
}

function threadModelOf(slot: { file: string; start: number; end: number; comments: CommentModel[]; notes: string[]; hasLine: boolean }): ThreadModel {
  const sevCounts = new Map<string, number>();
  for (const c of slot.comments) sevCounts.set(c.severity, (sevCounts.get(c.severity) ?? 0) + 1);
  const sevPart = [...sevCounts.entries()].map(([s, n]) => `${s}×${n}`).join(' ');
  const criticCounts = new Map<string, number>();
  for (const c of slot.comments) criticCounts.set(c.critic, (criticCounts.get(c.critic) ?? 0) + 1);
  const criticPart = [...criticCounts.entries()].map(([c, n]) => `${c} ${n} 条`).join(' ｜ ');
  const label = `${slot.hasLine ? '' : '⚠ 文件级 ｜ '}[${sevPart}] ${criticPart}`;
  return {
    file: slot.file,
    startLine: slot.start,
    endLine: slot.end,
    label,
    comments: slot.comments,
    driftNotes: slot.notes,
  };
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

/** 一组解析件的逐侧摘要（findingsSummary：驾驶舱 run 卡与历史树共用） */
export function findingsSummary(reviews: ParsedReview[]): Array<{ critic: string; verdict: string | null; counts: Record<FindingSeverity, number>; state: string; notice: string | null }> {
  return reviews.map((r) => ({
    critic: r.status.critic,
    verdict: r.verdict,
    counts: {
      blocker: r.findings.filter((f) => f.severity === 'blocker').length,
      major: r.findings.filter((f) => f.severity === 'major').length,
      minor: r.findings.filter((f) => f.severity === 'minor').length,
      nit: r.findings.filter((f) => f.severity === 'nit').length,
    },
    state: r.status.state,
    notice: r.status.notice,
  }));
}
