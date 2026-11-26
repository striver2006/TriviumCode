/**
 * location 归一与行号校验（FR-6b 前置，r2 计划 D2′）。
 *
 * 归一：分号多文件位置拆分；单位置行号部分支持逗号多区间（真实工件实测
 * `cockpit.ts:418-424,524-530,533-546`，AGY-02）；剥引号/`./` 前缀；绝对路径
 * 截取工作区相对段；统一 path.resolve 后 containment 判定防 `..` 逃逸（CLAUDE-07）。
 *
 * 行号校验：行号有效性由**文件一致性判据**承担（静态 git blob 比对在 Hub 层、
 * 动态 hash 重校验在 Hub 层，此处只接收结果）；锚文本（反引号片段）仅在
 * **确认失配**（越界/文件已变）后作重定位启发式，比对空白归一化（AGY-03）；
 * 多处命中判歧义降文件级（CLAUDE-08）；无行号/非法行号 → 文件级「未给行号」。
 *
 * 纯函数模块：不 import vscode，readFile 由调用方注入。
 */
import path from 'node:path';

/** 单文件的逗号多区间（1 起始，含端点） */
export interface LineRange {
  start: number;
  end: number;
}

/** 归一后的单个文件位置 */
export interface FileAnchor {
  relPath: string;
  /** 主锚点在前；无行号为空数组 */
  ranges: LineRange[];
}

export type NormalizedLocation =
  | { kind: 'file'; anchors: FileAnchor[] }
  | { kind: 'doc'; text: string }
  | { kind: 'outside'; text: string };

/** 文件级一致性结论（静态/动态判据的输出，resolveAnchor 的输入） */
export interface FileConsistency {
  state: 'unknown' | 'consistent' | 'mismatch' | 'edited';
  note: string | null;
}

export const CONSISTENCY_UNKNOWN: FileConsistency = { state: 'unknown', note: null };

/** 单个锚点的解析结果 */
export interface AnchorResolution {
  relPath: string;
  /** 原始行号（无则 null） */
  raw: LineRange | null;
  level: 'line' | 'file';
  /** 最终采用的行区间（level=file 时为 null） */
  line: LineRange | null;
  drift: 'nearby' | 'out-of-range' | 'line-lost' | 'multi-hit' | null;
  /** UI 标注（如「未给行号」） */
  label: string | null;
}

/** 一个 finding 的全部锚点解析结果（主锚点在前） */
export interface LocationResolution {
  kind: 'file' | 'doc' | 'outside' | 'missing-file';
  /** kind=file：文件存在时的锚点；kind=missing-file：未解析的 relPath */
  anchors: AnchorResolution[];
  /** missing-file 时指向未能打开的相对路径 */
  missingRelPath: string | null;
  consistency: FileConsistency;
}

// ── 归一 ───────────────────────────────────────────────────────────────────

/** 行号部分：`88` / `23-29` / `418-424,524-530,533` → 区间列表；不匹配/含 0 或负数返回 null（CLAUDE-09/AGY-02） */
export function parseRanges(part: string): LineRange[] | null {
  if (!/^[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*$/.test(part)) return null;
  const out: LineRange[] = [];
  for (const seg of part.split(',')) {
    const [a, b] = seg.split('-');
    const start = Number(a);
    const end = b === undefined ? start : Number(b);
    out.push({ start: Math.min(start, end), end: Math.max(start, end) });
  }
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * 单段位置 → {relPath, ranges} 或 null（非文件形态）。
 * relPath 已过 containment 判定；越界由调用方标 outside。
 */
function normalizeSegment(seg: string, workspaceRoot: string): { relPath: string | null; ranges: LineRange[] | null; doc: boolean } {
  let s = stripQuotes(seg.trim());
  if (s.length === 0) return { relPath: null, ranges: null, doc: true };
  while (s.startsWith('./')) s = s.slice(2);

  // 拆 path:lines（找最后一个冒号，其后是合法行号形态才算）
  let relPath = s;
  let ranges: LineRange[] | null = null;
  const colon = s.lastIndexOf(':');
  if (colon > 0) {
    const parsed = parseRanges(s.slice(colon + 1).trim());
    if (parsed !== null) {
      relPath = s.slice(0, colon);
      ranges = parsed;
    } else if (/^:[^/.\s]+$/.test(s.slice(colon))) {
      // 非法行号尾巴（`:-1`、`:0`、`:abc` 等数字/字母/混合形态）：剥离后按无行号
      // 处理（CLAUDE-09/AGY-02/CLAUDE-04）；尾巴含 `/` 或 `.` 的按路径保留（URL 等）
      relPath = s.slice(0, colon);
    }
  }
  relPath = stripQuotes(relPath.trim());

  // 绝对路径 → 工作区相对段（不含工作区则越界）
  if (path.isAbsolute(relPath)) {
    const norm = path.resolve(relPath);
    const root = path.resolve(workspaceRoot) + path.sep;
    if (!(norm + path.sep).startsWith(root)) {
      return { relPath: null, ranges: null, doc: false }; // 调用方按 outside 处理
    }
    relPath = norm.slice(root.length).split(path.sep).join('/');
  } else {
    // 相对路径统一 resolve 后 containment（防 ../ 逃逸，CLAUDE-07；符号链接不解析——登记边界）
    const resolved = path.resolve(workspaceRoot, relPath);
    const root = path.resolve(workspaceRoot) + path.sep;
    if (!(resolved + path.sep).startsWith(root)) {
      return { relPath: null, ranges: null, doc: false };
    }
    relPath = resolved.slice(root.length).split(path.sep).join('/');
  }

  // 非文件形态判定（如 plan §3.2、设计 §16.2）：含空格 → doc；扩展名须字母开头
  // （排除 §3.2 的 .2 这类数字尾）；裸词（无斜杠无点，如 README）试文件——
  // missing-file 兜底标注比「文档引用」更有信息量
  if (/\s/.test(relPath) && ranges === null) {
    return { relPath: null, ranges: null, doc: true };
  }
  const hasSlash = relPath.includes('/');
  const letterExt = /\.[A-Za-z][A-Za-z0-9_-]*$/.test(relPath);
  const noDot = !relPath.includes('.');
  if (!hasSlash && !letterExt && !noDot && ranges === null) {
    return { relPath: null, ranges: null, doc: true }; // 如 v1.2（版本号引用）
  }
  return { relPath, ranges, doc: false };
}

/** location 归一入口：分号（中英文）拆多文件位置 */
export function normalizeLocation(loc: string, workspaceRoot: string): NormalizedLocation {
  const segs = loc.split(/[；;]/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (segs.length === 0) return { kind: 'doc', text: loc };
  const anchors: FileAnchor[] = [];
  for (const seg of segs) {
    const r = normalizeSegment(seg, workspaceRoot);
    if (r.doc) return { kind: 'doc', text: loc };
    if (r.relPath === null) return { kind: 'outside', text: loc };
    anchors.push({ relPath: r.relPath, ranges: r.ranges ?? [] });
  }
  return { kind: 'file', anchors };
}

// ── 锚文本提取（AGY-03：仅失配后的重定位启发式） ──────────────────────────

const ANCHOR_MIN_LEN = 8;

/** 反引号片段 ≥8 字符；排除路径形态（含 / 或以 . 开头的配置串）与纯数字 */
export function extractAnchorTexts(problem: string, evidence: string): string[] {
  const out: string[] = [];
  for (const src of [problem, evidence]) {
    for (const m of src.matchAll(/`([^`\n]{8,})`/g)) {
      const t = m[1]!.trim();
      if (t.length < ANCHOR_MIN_LEN) continue;
      if (t.includes('/') || /^\d+([.\-_]\d+)*$/.test(t)) continue;
      if (!out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 4);
}

/** 空白归一化（`pool.length===1` 与 `pool.length === 1` 视为同一串，AGY-03） */
function squash(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 在窗口内找唯一包含任一锚文本（空白归一化）的行；返回行号或 null（多命中 → -1） */
function findUniqueAnchorLine(lines: string[], from: number, to: number, anchors: string[]): number | -1 | null {
  if (anchors.length === 0) return null;
  let hit: number | null = null;
  for (let i = from; i <= to && i < lines.length; i++) {
    const squashed = squash(lines[i] ?? '');
    if (squashed.length === 0) continue;
    if (anchors.some((a) => squashed.includes(squash(a)))) {
      if (hit !== null) return -1; // 多处命中：歧义（CLAUDE-08）
      hit = i;
    }
  }
  return hit;
}

// ── 行号校验 ───────────────────────────────────────────────────────────────

export interface ResolveOptions {
  /** 读文件内容（默认按 fs 注入；测试可传内存映射或编辑器缓冲区） */
  readFile: (relPath: string) => Promise<string | null>;
  /** 文件一致性结论（静态 git blob 比对 / 动态 hash 重校验的输出；缺省 unknown） */
  consistency?: (relPath: string) => FileConsistency;
  /** 失配重定位用的锚文本（调用方从 finding 语境提取；缺省无锚可用） */
  anchorTexts?: string[];
}

const NEARBY_WINDOW = 20;

/**
 * 解析一个 finding 的全部锚点。
 * 规则（r2 计划 D2′）：
 * - 文件读不到 → missing-file（只进意见列表，不建 thread/诊断）；
 * - 无行号/非法 → 文件级「未给行号」（区别于漂移）；
 * - 行号界内 → 行级（一致性标注由 consistency 携带，不在此判漂移）；
 * - 行号越界 → 锚文本邻近搜索：唯一命中 → 行级 nearby；多命中 → 文件级 multi-hit；
 *   无锚/未命中 → 文件级 out-of-range（找不到锚时）/line-lost（有锚没搜到）。
 */
export async function resolveLocation(loc: string, workspaceRoot: string, opts: ResolveOptions): Promise<LocationResolution> {
  const norm = normalizeLocation(loc, workspaceRoot);
  if (norm.kind !== 'file') {
    return { kind: norm.kind, anchors: [], missingRelPath: null, consistency: CONSISTENCY_UNKNOWN };
  }
  // 以主锚点文件为一致性载体；读不到主文件 → missing-file
  const primary = norm.anchors[0]!;
  const primaryText = await opts.readFile(primary.relPath);
  if (primaryText === null) {
    return { kind: 'missing-file', anchors: [], missingRelPath: primary.relPath, consistency: CONSISTENCY_UNKNOWN };
  }
  const consistency = opts.consistency?.(primary.relPath) ?? CONSISTENCY_UNKNOWN;
  const lines = primaryText.split('\n');
  const lineCount = lines.length;

  const anchors: AnchorResolution[] = [];
  for (let i = 0; i < norm.anchors.length; i++) {
    const a = norm.anchors[i]!;
    const raw = a.ranges.length > 0 ? a.ranges[0]! : null;
    if (i > 0) {
      // 次级锚点：只保留归一结果（正文可引用），不做行号校验（不套用主文件行数）
      anchors.push({ relPath: a.relPath, raw, level: 'file', line: null, drift: null, label: `次级位置${raw ? ` L${raw.start}${raw.end !== raw.start ? `-${raw.end}` : ''}` : ''}` });
      continue;
    }
    if (raw === null || raw.start < 1) {
      anchors.push({ relPath: a.relPath, raw: null, level: 'file', line: null, drift: null, label: '未给行号' });
      continue;
    }
    const secondaryRanges = a.ranges.slice(1); // AGY-01/CODEX-03：先主后次——anchors[0] 恒为主区间
    if (raw.start > lineCount) {
      // 越界：邻近搜索（失配重定位，AGY-03 启发式）
      const anchorTexts = opts.anchorTexts ?? [];
      const from = Math.max(0, Math.min(raw.start - 1, lineCount - 1) - NEARBY_WINDOW);
      const to = Math.min(lineCount - 1, raw.end - 1 + NEARBY_WINDOW);
      const hit = findUniqueAnchorLine(lines, from, to, anchorTexts);
      if (hit === null || hit === -1) {
        anchors.push({
          relPath: a.relPath, raw, level: 'file', line: null,
          drift: hit === -1 ? 'multi-hit' : anchorTexts.length > 0 ? 'line-lost' : 'out-of-range',
          label: hit === -1 ? '多处命中，降为文件级' : anchorTexts.length > 0 ? '行号越界且锚文本未命中，降为文件级' : '行号越界（超出文件行数），降为文件级',
        });
      } else {
        anchors.push({ relPath: a.relPath, raw, level: 'line', line: { start: hit + 1, end: hit + 1 }, drift: 'nearby', label: `原 L${raw.start}，按锚文本邻近命中 L${hit + 1}` });
      }
      for (const extra of secondaryRanges) {
        anchors.push({ relPath: a.relPath, raw: extra, level: extra.start >= 1 && extra.start <= lineCount ? 'line' : 'file', line: extra.start >= 1 && extra.start <= lineCount ? { start: extra.start, end: Math.min(extra.end, lineCount) } : null, drift: null, label: extra.start >= 1 && extra.start <= lineCount ? `次级区间 L${extra.start}` : `次级区间 L${extra.start} 越界，未挂行` });
      }
      continue;
    }
    // 界内：信任行号（有效性由一致性判据承担）
    anchors.push({ relPath: a.relPath, raw, level: 'line', line: { start: raw.start, end: Math.min(raw.end, lineCount) }, drift: null, label: null });
    // 同文件逗号多区间的次级区间（AGY-02/CLAUDE-08）：主锚点入列后再展开
    for (const extra of secondaryRanges) {
      if (extra.start >= 1 && extra.start <= lineCount) {
        anchors.push({ relPath: a.relPath, raw: extra, level: 'line', line: { start: extra.start, end: Math.min(extra.end, lineCount) }, drift: null, label: `次级区间 L${extra.start}${extra.end !== extra.start ? `-${extra.end}` : ''}` });
      } else {
        anchors.push({ relPath: a.relPath, raw: extra, level: 'file', line: null, drift: null, label: `次级区间 L${extra.start} 越界，未挂行` });
      }
    }
  }
  return { kind: 'file', anchors, missingRelPath: null, consistency };
}
