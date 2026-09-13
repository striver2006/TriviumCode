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
import { agentByFindingId, findingPrefixAlternation } from './agents/registry.js';
import { CRITICS, type CriticId, type Disposal, type DispositionRow, type Severity, type Stage } from './types.js';

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
  /*
   * 「修改计划」必须在列：设计 §8.2 S7、`.reviews/README.md` 与随仓库分发的
   * `templates/response.md.template` 都用这个词称呼代码应答件的这一列。
   * 漏了它，照着自己的模板写出来的应答件会被自己的闸门判成「接受但没写落点」——
   * 实测踩到过一次。
   */
  action: ['落点', '落地点', '修改点', '修改计划', '计划', '动作', 'action'],
};

function matchColumn(header: string): keyof typeof COLUMN_ALIASES | null {
  const h = normalizeCell(header).toLowerCase();
  // 先精确匹配，再包含匹配：`id` 的包含匹配会命中 `evidence`，一列 Evidence 排在编号列前面就整表取错
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => h === a.toLowerCase())) return key as keyof typeof COLUMN_ALIASES;
  }
  // 包含匹配跳过 `id` 这类超短 ASCII 别名（会命中 evidence）；中文两字别名（落点 / 裁决）照常
  const shortAscii = (a: string): boolean => a.length <= 2 && /^[\x00-\x7f]+$/.test(a);
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => !shortAscii(a) && h.includes(a.toLowerCase()))) return key as keyof typeof COLUMN_ALIASES;
  }
  return null;
}

/** 去掉编号上的装饰：`**AGY-01**`、`` `AGY-01` ``、`AGY-01（blocker）` 都还原成 AGY-01 */
export function stripIdDecoration(cell: string): string {
  return cell.replace(/[*`_]/g, '').replace(/[（(].*$/, '').trim();
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
  // 先认 fallback：它不是 Agent，且「fallback」不会与任何 Agent id 冲突
  if (s.includes('fallback')) return 'fallback';
  // 按注册表逐项匹配，而非字面 if 链（计划 §2.1）
  for (const c of CRITICS) {
    if (s.includes(c)) return c;
  }
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

    const idCell = stripIdDecoration(normalizeCell(cells[idx('id')] ?? ''));
    if (idCell.length === 0) continue; // 空行，跳过
    // 只收形如 AGY-01 / GLM-r2-03 / AGY-F01 的编号，避免把小结行当数据；
    // 但单元格里明明含编号却不在行首（如「见 AGY-01」）要报出来，而不是静默丢弃后让 gate 报「缺裁决」
    if (!new RegExp(`^(?:${findingPrefixAlternation()})-`).test(idCell)) {
      /*
       * 第二重检测**不限于已登记前缀**（审查意见 GLM-05）。
       *
       * 收行（上一行）用登记集是对的——只有登记前缀才算合法数据行。但「这一格
       * 看着像个编号却没被收」的告警若也限定登记集，未登记的前缀（人写错拼、
       * 第五家接入前的编号）就两重都不命中，照旧静默 continue，下游 gate 报
       * 「缺裁决」而根因完全误导。这正是 B-7 要消除的形态，只做前半等于没做。
       */
      if (/\b[A-Z][A-Z0-9]{1,15}-(?:r\d+-)?(?:F)?\d+/.test(idCell)) {
        problems.push({ line: lineNo, message: `第一列「${idCell}」含意见编号但不以编号开头，本行被忽略——编号列只写编号本身` });
      }
      continue;
    }

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

    const source = (srcIdx >= 0 ? normalizeSource(cells[srcIdx] ?? '') : null) ?? inferSource(idCell);
    if (source === null) {
      // 不静默兜底到任一审核者（A-1）：来源判不出就如实报出来，让 Driver 补「来源」列
      problems.push({
        line: lineNo,
        message: `意见 ${idCell} 的来源无法判定：「来源」列未填或不可识别，且${unknownSourceReason(idCell)}`,
      });
    }

    rows.push({
      id: idCell,
      source,
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

/**
 * 编号前缀能反推来源，`来源` 列缺失或写错时兜底。
 *
 * **无匹配返回 null，禁止三目兜底**（计划 §2.2 / A-1）。重构前末行是
 * `id.startsWith('AGY-') ? 'gemini' : 'glm'`——第三家的 `CODEX-03` 会被
 * 静默归给 glm。双侧下它恰好正确（只有两种可能），是「靠巧合正确」。
 */
function inferSource(id: string): CriticId | 'fallback' | null {
  if (isFallbackId(id)) return 'fallback';
  const agent = agentByFindingId(id);
  if (!agent) return null;
  return CRITICS.includes(agent.id as CriticId) ? (agent.id as CriticId) : null;
}

/**
 * 来源判不出时的**准确**说法（审查意见 AGY-05）。
 *
 * 「查不到」与「查到了但当前没启用为审核者」是两回事：`CODEX-03` 的前缀
 * 确实登记在注册表里，只是该 Agent 还没作为审核者启用。笼统说「不属于任何
 * 已登记 Agent」与事实冲突，会把排查引向错误方向。
 */
function unknownSourceReason(id: string): string {
  const agent = agentByFindingId(id);
  if (agent) {
    return `编号前缀属于已登记的 ${agent.display}（${agent.id}），但它当前未启用为审核者`;
  }
  return '编号前缀不属于任何已登记 Agent';
}

/** 是否为 parse_fallback 的虚拟编号（`<前缀>-F<序号>`，§6.6 规则 8） */
export function isFallbackId(id: string): boolean {
  return new RegExp(`^(?:${findingPrefixAlternation()})-F\\d+$`).test(id);
}
