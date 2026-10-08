import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * 演进并入台账的结构对账（EV-14 的结构层，M11 第 9 步，上位计划 `.reviews/M11-档位全链路与文档收口/plan/` r3 §4.9、D-11）。
 *
 * 对账锚是演进设计 §17.2 的清单表，被核对面是主设计 §24 的两张表（主设计 §24 引言、演进设计 §17.3 第 2 条）：
 * - ① §17.2 每行在 §24 有对应行：第 1 行（主设计本身）对应 24.1 整张表；第 2～19 行按文档键对应 24.2 的行。
 *   方向只核 §17.2 → §24，§24 多出来的行（标「原清单未列」的那些）不报。
 * - ② §24 两张表的状态列只用封闭字形集 ✅ / ◐ / ⏳（去掉加粗后的首个字符）。
 * - ③ §24 无 ◐ / ⏳——第 12 步 M11 收口时启用，之前显式跳过。
 *
 * 语义一致性（同一议题在 §16.1 / §18.1 / §24.1 的状态相容、同表多行状态相容）不在这里判，仍登记在 BACKLOG EV-14。
 *
 * 文档键：两份文档都在 `doc/02_design/` 下，链接按同一基准解析成仓库相对路径后比对——四个同名 README 只按文件名
 * 匹配会张冠李戴。没有链接的单元格走 `LINKLESS_KEYS` 的显式键（去掉加粗与 ★ 后逐字比对），改了这些单元格的措辞
 * 要同步改表；取不到键的单元格当对账失败报出，不静默跳过。列一律按表头名取，不按列序号。
 */

const EVOLUTION_DOC = 'doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md';
const MAIN_DOC = 'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
const LINK_BASE = 'doc/02_design';

const ANCHOR_17_2 = /^### 17\.2 /;
const ANCHOR_24_1 = /^### 24\.1 /;
const ANCHOR_24_2 = /^### 24\.2 /;

/** §17.2 冻结在 19 行；§24 两表只设下限防空转（下限低于现状，缺一行由 ① 点名，不被下限抢先报）。 */
const ROWS_17_2 = 19;
const MIN_ROWS_24_1 = 20;
const MIN_ROWS_24_2 = 10;

const GLYPHS: readonly string[] = ['✅', '◐', '⏳'];
const PENDING_GLYPHS: readonly string[] = ['◐', '⏳'];

/** 没有链接的单元格：键 → 两侧可接受的单元格文本（`normCell` 之后）。 */
const LINKLESS_KEYS: ReadonlyArray<{ key: string; texts: readonly string[] }> = [
  // §17.2 第 2 行只写「PRD」；24.2 那行带链接、走链接键
  { key: 'doc/01_requirements/PRD_driver_dual_critic.md', texts: ['PRD'] },
  { key: 'doc/02_design/ADR_002_multicritic_isolation.md', texts: ['`ADR_002_multicritic_isolation.md`（新建）', '`ADR_002_multicritic_isolation.md`'] },
  { key: 'CLAUDE.md', texts: ['仓库根 `CLAUDE.md`'] },
  { key: 'skills/', texts: ['`skills/` 资产（12 份）'] },
];

/** 第 12 步 M11 收口时改为 false 启用 ③。 */
const NO_PENDING_SKIP: string | false = '第 12 步 M11 收口时启用；今天有五行未绿，第 10 步逐行翻绿';

type Row = ReadonlyMap<string, string>;

interface Table {
  label: string;
  header: readonly string[];
  rows: readonly Row[];
}

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/** 按未转义的 `|` 切单元格（§17.2 第 19 行的 `{claude\|gemini\|glm}` 不能被切开）。 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '\\' && line.charAt(i + 1) === '|') {
      cur += '\\|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  // 首尾的 `|` 各切出一个空格
  return cells.slice(1, -1);
}

/** 取锚点标题下的第一张表；锚点不唯一、表格缺失、分隔行缺失或某行格数与表头不符都抛出并点名。 */
function tableAfter(doc: string, docLabel: string, anchor: RegExp, label: string): Table {
  const lines = doc.split('\n');
  const hits = lines.flatMap((l, i) => (anchor.test(l) ? [i] : []));
  const at = hits[0];
  if (hits.length !== 1 || at === undefined) throw new Error(`${docLabel}：${label} 的锚点 ${anchor} 命中 ${hits.length} 处（应恰一处）`);
  let i = at + 1;
  for (; i < lines.length && !(lines[i] ?? '').startsWith('|'); i++) {
    if (/^#{1,6} /.test(lines[i] ?? '')) throw new Error(`${docLabel}：${label} 锚点下、下一个标题「${lines[i]}」之前没有表格`);
  }
  if (i >= lines.length) throw new Error(`${docLabel}：${label} 锚点下没有表格`);
  const header = splitRow(lines[i] ?? '');
  if (!/^\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1] ?? '')) throw new Error(`${docLabel}：${label} 表头下一行不是分隔行`);
  const rows: Row[] = [];
  for (let j = i + 2; j < lines.length && (lines[j] ?? '').startsWith('|'); j++) {
    const cells = splitRow(lines[j] ?? '');
    if (cells.length !== header.length) {
      throw new Error(`${docLabel}：${label} 第 ${j + 1} 行有 ${cells.length} 格，表头 ${header.length} 列（单元格里有未转义的 | ？）`);
    }
    rows.push(new Map(header.map((h, k) => [h, cells[k] ?? ''])));
  }
  return { label, header, rows };
}

/** 按表头名取格；表头里没有这一列就抛出并列出表头。 */
function cell(t: Table, row: Row, name: string): string {
  const v = row.get(name);
  if (v === undefined) throw new Error(`${t.label} 没有名为「${name}」的列（表头：${t.header.join(' / ')}）`);
  return v;
}

/** 行的称呼：首列文本。 */
function rowName(t: Table, row: Row): string {
  return normCell(cell(t, row, t.header[0] ?? ''));
}

/** 去掉加粗、★ 与多余空白。 */
function normCell(s: string): string {
  return s.split('**').join('').split('★').join('').replace(/\s+/g, ' ').trim();
}

/** 文档键：有链接取首个链接按 `doc/02_design/` 解析；没链接查显式键表；都没有返回 null。 */
function docKey(text: string): string | null {
  const target = /\]\(([^)\s]+)\)/.exec(text)?.[1]?.split('#')[0];
  if (target !== undefined) {
    const key = path.posix.normalize(path.posix.join(LINK_BASE, target));
    return target.endsWith('/') && !key.endsWith('/') ? `${key}/` : key;
  }
  const n = normCell(text);
  return LINKLESS_KEYS.find((e) => e.texts.includes(n))?.key ?? null;
}

function firstGlyph(text: string): string {
  return [...normCell(text)][0] ?? '';
}

/** 三条断言共用的解析与防空转：§17.2 恰 19 行、# 列为 1～19，§24 两表不少于下限。 */
function parseAll(): { t17: Table; t241: Table; t242: Table } {
  const t17 = tableAfter(read(EVOLUTION_DOC), '演进设计', ANCHOR_17_2, '§17.2 清单表');
  const main = read(MAIN_DOC);
  const t241 = tableAfter(main, '主设计', ANCHOR_24_1, '§24.1 表');
  const t242 = tableAfter(main, '主设计', ANCHOR_24_2, '§24.2 表');
  assert.equal(t17.rows.length, ROWS_17_2, `§17.2 清单表解析出 ${t17.rows.length} 行，应为 ${ROWS_17_2}（演进设计正文冻结）`);
  assert.deepEqual(
    t17.rows.map((r) => cell(t17, r, '#')),
    Array.from({ length: ROWS_17_2 }, (_, k) => String(k + 1)),
    `§17.2 清单表的 # 列不是 1～${ROWS_17_2}`,
  );
  assert.ok(t241.rows.length >= MIN_ROWS_24_1, `§24.1 表只解析出 ${t241.rows.length} 行（下限 ${MIN_ROWS_24_1}）`);
  assert.ok(t242.rows.length >= MIN_ROWS_24_2, `§24.2 表只解析出 ${t242.rows.length} 行（下限 ${MIN_ROWS_24_2}）`);
  return { t17, t241, t242 };
}

/** §24 两表中状态首字形落在 `glyphs` 之外（`inside = false`）或之内（`inside = true`）的行。 */
function statusRows(tables: readonly Table[], glyphs: readonly string[], inside: boolean): string[] {
  const out: string[] = [];
  for (const t of tables) {
    for (const r of t.rows) {
      const s = cell(t, r, '状态');
      const g = firstGlyph(s);
      if (glyphs.includes(g) === inside) out.push(`${t.label}「${rowName(t, r)}」状态以「${g}」开头：${normCell(s).slice(0, 40)}`);
    }
  }
  return out;
}

test('① §17.2 每行在 §24 有对应行（第 1 行对 24.1 整表，第 2～19 行按文档键对 24.2）', () => {
  const { t17, t241, t242 } = parseAll();
  const [first, ...rest] = t17.rows;
  assert.ok(first !== undefined);
  assert.equal(normCell(cell(t17, first, '文档')), '主设计', '§17.2 第 1 行的文档列不是「主设计」');
  assert.ok(t241.rows.length > 0, '§17.2 第 1 行（主设计）在 §24 没有对应：24.1 表为空');

  const keys242 = new Set<string>();
  const keyless242: string[] = [];
  for (const r of t242.rows) {
    const doc = cell(t242, r, '目标文档');
    const k = docKey(doc);
    if (k === null) keyless242.push(normCell(doc));
    else keys242.add(k);
  }

  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const r of rest) {
    const n = cell(t17, r, '#');
    const doc = cell(t17, r, '文档');
    const k = docKey(doc);
    if (k === null) {
      problems.push(`§17.2 #${n}「${normCell(doc)}」取不到文档键（没有链接，也不在显式键表）`);
      continue;
    }
    const dup = seen.get(k);
    if (dup !== undefined) problems.push(`§17.2 #${n} 与 #${dup} 文档键相同：${k}`);
    seen.set(k, n);
    if (!keys242.has(k)) problems.push(`§17.2 #${n}「${normCell(doc)}」（键 ${k}）在 §24.2 找不到对应行`);
  }
  if (problems.length > 0 && keyless242.length > 0) {
    problems.push(`另：§24.2 有 ${keyless242.length} 行取不到文档键：${keyless242.join(' ｜ ')}`);
  }
  assert.deepEqual(problems, [], `§17.2 → §24 对账不齐：\n${problems.join('\n')}`);
});

test('② §24 两张表的状态列只用 ✅ / ◐ / ⏳ 开头', () => {
  const { t241, t242 } = parseAll();
  const bad = statusRows([t241, t242], GLYPHS, false);
  assert.deepEqual(bad, [], `状态字形越出 ✅ / ◐ / ⏳：\n${bad.join('\n')}`);
});

test('③ §24 无 ◐ / ⏳（M11 完成判据，主设计 24.3 第 2 条）', { skip: NO_PENDING_SKIP }, () => {
  const { t241, t242 } = parseAll();
  const pending = statusRows([t241, t242], PENDING_GLYPHS, true);
  assert.deepEqual(pending, [], `§24 还有 ${pending.length} 行未绿：\n${pending.join('\n')}`);
});
