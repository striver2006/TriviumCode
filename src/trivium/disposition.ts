/**
 * 裁决件解析（设计 §6.6，按修订计划 R-C 加固）。
 *
 * 裁决表来自 Driver 手写的 Markdown，因此解析器必须对**人写出来的样子**宽容：
 * 全角/半角标点混用、列顺序调换、单元格里换行、表格前后有正文。
 * 但对**语义**必须严格：缺一条裁决就要报出具体编号，不能含糊过去。
 *
 * 失败时报**具体行号**而不是笼统「解析失败」——否则 Driver 无从修补（R-C）。
 */
import YAML from 'yaml';
import type { CriticId, Disposal, DispositionRow, Severity, Stage } from './types.js';

export interface DispositionFrontMatter {
  schema: string;
  topic: string;
  stage: Stage;
  role: string;
  kind: 'revised' | 'response';
  run_id: string;
  addresses: string[];
}

export interface ParsedDisposition {
  frontMatter: DispositionFrontMatter | null;
  rows: DispositionRow[];
  /** 解析过程中的问题，带行号 */
  problems: { line: number; message: string }[];
}

/** 全角 → 半角，去掉零宽字符。列名与裁决词都先过这一步 */
export function normalizeCell(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/[｜]/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 列名归一：允许若干同义写法，避免因表头措辞不同而整表解析失败 */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  id: ['意见编号', '编号', 'id'],
  source: ['来源', '来自', 'source'],
  severity: ['严重度', '严重性', 'severity'],
  disposal: ['裁决', '处置', '结论', 'disposal'],
  reason: ['理由', '原因', 'reason'],
  action: ['落点', '落地点', '修改点', '动作', 'action'],
};

function matchColumn(header: string): keyof typeof COLUMN_ALIASES | null {
  const h = normalizeCell(header).toLowerCase();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => h === a.toLowerCase() || h.includes(a.toLowerCase()))) {
      return key as keyof typeof COLUMN_ALIASES;
    }
  }
  return null;
}

/** 裁决词归一。§6.6 规则 2：「不接受」归一化为「驳回」后接受 */
export function normalizeDisposal(raw: string): Disposal | null {
  const s = normalizeCell(raw).replace(/[。.、]/g, '');
  if (/^(接受|采纳|同意|accept)/.test(s)) return '接受';
  if (/^(驳回|不接受|拒绝|否决|reject)/.test(s)) return '驳回';
  if (/^(暂缓|搁置|推迟|defer)/.test(s)) return '暂缓';
  return null;
}

const SEVERITIES: readonly Severity[] = ['blocker', 'major', 'minor', 'nit'];

function normalizeSeverity(raw: string): Severity | null {
  const s = normalizeCell(raw).toLowerCase();
  return SEVERITIES.find((x) => s.includes(x)) ?? null;
}

function normalizeSource(raw: string): CriticId | 'fallback' | null {
  const s = normalizeCell(raw).toLowerCase();
  if (s.includes('gemini')) return 'gemini';
  if (s.includes('glm')) return 'glm';
  if (s.includes('fallback')) return 'fallback';
  return null;
}

/** 拆一行 Markdown 表格。转义的 `\|` 不算分隔符 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let escaped = false;
  for (const ch of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      cur += ch;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.replace(/\\\|/g, '|').trim());
}

const SEPARATOR_ROW = /^\|?[\s:|-]+\|[\s:|-]*$/;

/**
 * 解析裁决件。
 *
 * 表格识别方式：找到**列名能匹配上**的表头行，其后连续的表格行即为裁决表。
 * 这样表格前后有正文、文中有其它表格都不影响——只认列名对得上的那一张。
 */
export function parseDisposition(md: string): ParsedDisposition {
  const problems: { line: number; message: string }[] = [];
  const lines = md.split('\n');

  // ── front-matter ──
  let frontMatter: DispositionFrontMatter | null = null;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end === -1) {
      problems.push({ line: 1, message: 'front-matter 未闭合（缺少结尾的 ---）' });
    } else {
      try {
        frontMatter = YAML.parse(lines.slice(1, end).join('\n')) as DispositionFrontMatter;
      } catch (e) {
        problems.push({ line: 1, message: `front-matter 不是合法 YAML：${(e as Error).message}` });
      }
    }
  } else {
    problems.push({ line: 1, message: '缺少 front-matter（裁决件必须以 --- 开头）' });
  }

  // ── 定位裁决表 ──
  let headerIdx = -1;
  let colMap: (keyof typeof COLUMN_ALIASES | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trimStart().startsWith('|')) continue;
    const cells = splitTableRow(l);
    // 最小合法表只有三列（编号/裁决/理由）——用 < 4 过滤会把它整张跳过
    if (cells.length < 3) continue;
    const mapped = cells.map(matchColumn);
    // 至少要认出编号、裁决、理由三列，否则不是裁决表
    const need: (keyof typeof COLUMN_ALIASES)[] = ['id', 'disposal', 'reason'];
    if (need.every((n) => mapped.includes(n))) {
      headerIdx = i;
      colMap = mapped;
      break;
    }
  }

  if (headerIdx === -1) {
    problems.push({
      line: 1,
      message:
        '找不到裁决表。表头至少需包含「意见编号」「裁决」「理由」三列' +
        '（列名可用同义写法，顺序不限）',
    });
    return { frontMatter, rows: [], problems };
  }

  const idx = (key: keyof typeof COLUMN_ALIASES): number => colMap.indexOf(key);

  // ── 逐行解析 ──
  const rows: DispositionRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trimStart().startsWith('|')) break; // 表格结束
    if (SEPARATOR_ROW.test(raw.trim())) continue; // |:---|:---| 分隔行
    const cells = splitTableRow(raw);
    const lineNo = i + 1;

    const idCell = normalizeCell(cells[idx('id')] ?? '');
    if (idCell.length === 0) continue; // 空行，跳过
    // 只收形如 AGY-01 / GLM-r2-03 / AGY-F01 的编号，避免把小结行当数据
    if (!/^(AGY|GLM)-/.test(idCell)) continue;

    const disposalRaw = cells[idx('disposal')] ?? '';
    const disposal = normalizeDisposal(disposalRaw);
    if (disposal === null) {
      problems.push({
        line: lineNo,
        message: `意见 ${idCell} 的裁决「${normalizeCell(disposalRaw)}」不可识别；只接受 接受 / 驳回 / 暂缓（「不接受」会归一化为「驳回」）`,
      });
      continue;
    }

    const sevIdx = idx('severity');
    const actIdx = idx('action');
    const srcIdx = idx('source');

    rows.push({
      id: idCell,
      source: (srcIdx >= 0 ? normalizeSource(cells[srcIdx] ?? '') : null) ?? inferSource(idCell),
      severity: sevIdx >= 0 ? normalizeSeverity(cells[sevIdx] ?? '') : null,
      disposal,
      reason: normalizeCell(cells[idx('reason')] ?? ''),
      action: actIdx >= 0 ? normalizeCell(cells[actIdx] ?? '') : '',
    });
  }

  if (rows.length === 0) {
    problems.push({ line: headerIdx + 1, message: '裁决表存在但没有任何可解析的数据行' });
  }
  return { frontMatter, rows, problems };
}

/** 编号前缀能反推来源，`来源` 列缺失或写错时兜底 */
function inferSource(id: string): CriticId | 'fallback' {
  if (/^AGY-F/.test(id) || /^GLM-F/.test(id)) return 'fallback';
  return id.startsWith('AGY-') ? 'gemini' : 'glm';
}

/** 是否为 parse_fallback 的虚拟编号（`<前缀>-F<序号>`，§6.6 规则 8） */
export function isFallbackId(id: string): boolean {
  return /^(AGY|GLM)-F\d+$/.test(id);
}
