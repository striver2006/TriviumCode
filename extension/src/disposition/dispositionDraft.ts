/**
 * disposition 草稿生成与落盘（FR-8，计划 r2 §D1；纯函数 + 注入 fs）。
 *
 * 契约对齐（skills/dual-critic/schema/disposition.v1.json + src/trivium/disposition.ts）：
 * - front-matter 七必填字段，经 yaml 库序列化（代码审 r1 CLAUDE-10：`[abc]` 类合法
 *   主题名裸插值会被 YAML 解析成数组，自由字符串必须走可靠序列化）；
 * - kind：plan/bug→revised、code→response；表头六列：code「修改计划」/ plan·bug「落点」；
 * - 落盘：起草 `wx` 独占创建（EEXIST 不抬升——编排器的重试语义不在插件重复）；修复
 *   走**原文手术**（代码审 r1 CLAUDE-04/CODEX-08：只替换被修复行、追加新增行、剔除
 *   删除行，front-matter 与表外正文原样保留，不整份重写审计件），写回前比对载入时
 *   内容 hash（防并发覆盖）。
 *
 * 本模块不复制闸门校验逻辑——正确性由编排器 `gate --check` 兜底。
 */
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import type { Verdict, ParsedDocRow } from './gateGapModel';

export type DispositionKind = 'revised' | 'response';

/** 注入的文件系统面 */
export interface DraftFs {
  readFile(p: string): Promise<string>;
  /** 独占创建（'wx'）；返回 null 表示已存在（EEXIST），不抛错 */
  createExclusive(p: string, text: string): Promise<boolean>;
  /** 原子替换写回（tmp+rename 同目录） */
  replaceExclusive(p: string, text: string): Promise<void>;
}

export interface DraftRow {
  id: string;
  critic: string | null;
  severity: string | null;
  verdict: Verdict;
  reason: string;
  action: string | null;
}

/** 阶段 → kind（naming.ts dispositionKindForStage 同映射） */
export function dispositionKindForStage(stage: string): DispositionKind {
  return stage === 'code' ? 'response' : 'revised';
}

/** `<本地日期 YYYY-MM-DD>-<主题>[-rN(rerun>1)]-<kind>-<driver>.md`（本地时区，对齐 naming.ts localDate） */
export function draftFileName(args: { topic: string; rerunIndex: number | null; stage: string; driver: string; now?: Date }): string {
  const d = args.now ?? new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const bump = args.rerunIndex !== null && args.rerunIndex > 1 ? `-r${args.rerunIndex}` : '';
  return `${date}-${args.topic}${bump}-${dispositionKindForStage(args.stage)}-${args.driver}.md`;
}

/** 单元格安全化：`|` 破坏列切分、换行破坏行结构（disposition.ts 按 | 切列、按行切行） */
export function safeCell(text: string): string {
  return text.replace(/\|/g, '｜').replace(/\r?\n/g, ' ').trim();
}

/** 归一化用户裁决词（「采纳/同意」→「接受」等；与 normalizeDisposal 同义集的展示层归一） */
export function normalizeVerdict(text: string): Verdict | null {
  const t = text.replace(/[。.、]/g, '').trim();
  if (/^(接受|采纳|同意|accept)/i.test(t)) return '接受';
  if (/^(驳回|不接受|拒绝|否决|reject)/i.test(t)) return '驳回';
  if (/^(暂缓|搁置|推迟|defer)/i.test(t)) return '暂缓';
  return null;
}

// ── front-matter 与表格渲染 ─────────────────────────────────────────────

/** front-matter 七字段 → yaml 文本（`---` 包裹；字段序对齐真实件） */
export function renderFrontMatter(input: { topic: string; stage: string; runId: string; driver: string; addresses: string[] }): string {
  const doc = new YAML.Document({
    schema: 'trivium.disposition.v1',
    topic: input.topic,
    stage: input.stage,
    role: input.driver,
    kind: dispositionKindForStage(input.stage),
    run_id: input.runId,
    addresses: input.addresses,
  });
  // 强制保持插入序（yaml 缓存键序可能重排 map）；列表项两空格缩进对齐真实件
  return doc.toString({ lineWidth: 0, indentSeq: true }).trimEnd();
}

export interface RenderInput {
  topic: string;
  stage: string;
  runId: string;
  driver: string;
  addresses: string[];
  rows: DraftRow[];
  /** 起草模式无只读行（全量新建）；修复模式只读行以原文行保留（见 renderRepaired） */
  titleNote: string;
}

/** 生成完整裁决件文本（起草模式：front-matter + 表格全新生成） */
export function renderDisposition(input: RenderInput): string {
  const fm = renderFrontMatter(input);
  const header = actionHeader(input.stage);
  const align = '| :--- | :--- | :--- | :--- | :--- | :--- |';
  const rows = input.rows.map(rowLine);
  return [
    '---',
    fm,
    '---',
    '',
    `# ${input.titleNote}（Driver：${input.driver}）`,
    '',
    `共 ${rows.length} 条：接受 ${count(rows, '接受')} ｜ 驳回 ${count(rows, '驳回')} ｜ 暂缓 ${count(rows, '暂缓')}。`,
    '',
    header,
    align,
    ...rows,
    '',
  ].join('\n');
}

function actionHeader(stage: string): string {
  const last = stage === 'code' ? '修改计划' : '落点';
  return `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | ${last} |`;
}

function count(rowTexts: string[], v: Verdict): number {
  return rowTexts.filter((l) => l.includes(`| ${v} |`)).length;
}

function rowLine(r: { id: string; critic?: string | null; severity?: string | null; verdict: Verdict; reason: string; action: string | null }): string {
  return `| ${safeCell(r.id)} | ${safeCell(r.critic ?? '—')} | ${safeCell(r.severity ?? '—')} | ${r.verdict} | ${safeCell(r.reason)} | ${safeCell(r.action ?? '—')} |`;
}

// ── 现有裁决件解析（修复模式预填 + 原文手术定位） ─────────────────────────

export interface ParsedDisposition {
  frontMatter: Record<string, string | string[]>;
  rows: ParsedDocRow[];
  /** 原文手术面（无表格时 null） */
  surgery: {
    lines: string[];
    /** 表头行 index */
    headerLine: number;
    /** 表格末行 index（追加新行的落点） */
    lastRowLine: number;
    /** id → 行 index（被修复行/删除行定位） */
    rowLineOf: Map<string, number>;
    /** 原表列数与各语义列下标（被修复行按原列结构逐列替换，r2 CODEX-07） */
    cols: string[];
    idAt: number;
    verdictAt: number;
    reasonAt: number;
    actionAt: number | null;
    criticAt: number | null;
    severityAt: number | null;
  } | null;
}

/**
 * 解析现有裁决件：front-matter（yaml）+ 裁决表数据行（含行定位，供原文手术）。
 * 表头行识别：以 `|` 开头、能认全 意见编号/裁决/理由 三列（同义词集对齐 disposition.ts）。
 * 任何坏形态都返回部分结果而非抛错——修复入口的正确性由 gate --check 兜底。
 */
export function parseDispositionDoc(text: string): ParsedDisposition {
  const fm: Record<string, string | string[]> = {};
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fmMatch) {
    try {
      const parsed = YAML.parse(fmMatch[1]!) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) fm[k] = v.map(String);
          else fm[k] = v === null || v === undefined ? '' : String(v);
        }
      }
    } catch {
      // 坏 front-matter：保持空 map，结构修复路径重建
    }
  }
  const lines = text.split(/\r?\n/);
  const header = findHeader(lines);
  const rows: ParsedDocRow[] = [];
  if (!header) return { frontMatter: fm, rows, surgery: null };
  const idRe = /^[A-Z][A-Z0-9]{1,15}-(?:r\d+-)?(?:F)?\d+$/i;
  const rowLineOf = new Map<string, number>();
  let lastRowLine = header.line;
  for (let i = header.line + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim().startsWith('|')) continue;
    const cols = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cols.length < header.cols.length) continue;
    const id = cols[header.idAt] ?? '';
    if (!idRe.test(id)) continue;
    const verdict = normalizeVerdict(cols[header.verdictAt] ?? '');
    rows.push({
      id,
      verdict,
      reason: unescapeCell(cols[header.reasonAt] ?? ''),
      action: header.actionAt !== null ? unescapeCell(cols[header.actionAt] ?? '') || null : null,
    });
    if (!rowLineOf.has(id)) rowLineOf.set(id, i);
    lastRowLine = i;
  }
  return {
    frontMatter: fm,
    rows,
    surgery: { lines, headerLine: header.line, lastRowLine, rowLineOf, cols: header.cols, idAt: header.idAt, verdictAt: header.verdictAt, reasonAt: header.reasonAt, actionAt: header.actionAt, criticAt: header.criticAt, severityAt: header.severityAt },
  };
}

const ALIAS_ID = ['意见编号', '编号', 'id'];
const ALIAS_VERDICT = ['裁决', '处置', '结论', 'disposal'];
const ALIAS_REASON = ['理由', '原因', 'reason'];

function normalizeCellKey(cell: string): string {
  return cell.replace(/[\s\u3000]/g, '').replace(/：/g, ':').toLowerCase();
}

/** 找表头行并返回三列下标（含行号与对齐行号）；找不到返回 null */
function findHeader(lines: string[]): { line: number; cols: string[]; idAt: number; verdictAt: number; reasonAt: number; actionAt: number | null; criticAt: number | null; severityAt: number | null } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim().startsWith('|')) continue;
    const cols = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cols.length < 3) continue;
    const normed = cols.map(normalizeCellKey);
    const idAt = normed.findIndex((c) => ALIAS_ID.includes(c));
    const verdictAt = normed.findIndex((c) => ALIAS_VERDICT.includes(c));
    const reasonAt = normed.findIndex((c) => ALIAS_REASON.includes(c));
    if (idAt < 0 || verdictAt < 0 || reasonAt < 0) continue;
    const actionAt = normed.findIndex((c) => ['落点', '落地点', '修改点', '修改计划', '计划', '动作', 'action'].includes(c));
    const criticAt = normed.findIndex((c) => ['来源', '来自', 'source'].includes(c));
    const severityAt = normed.findIndex((c) => ['严重度', '严重性', 'severity'].includes(c));
    return { line: i, cols, idAt, verdictAt, reasonAt, actionAt: actionAt >= 0 ? actionAt : null, criticAt: criticAt >= 0 ? criticAt : null, severityAt: severityAt >= 0 ? severityAt : null };
  }
  return null;
}

function unescapeCell(s: string): string {
  return s === '—' ? '' : s;
}

// ── 原文手术（修复模式渲染） ─────────────────────────────────────────────

export interface SurgeryOps {
  /** 被修复行的结构化新值（按原表列结构逐列替换——原列序/额外列原样保留，r2 CODEX-07） */
  replaceRows: Map<string, { verdict: string; reason: string; action: string | null }>;
  /** 删除行编号（unknown_findings 等） */
  removeIds: Set<string>;
  /** 追加的新行文本（missing_findings 新增行；按原表列数生成） */
  appendLines: string[];
  /** front-matter 需重建时给新值（bad_front_matter）；null = 保留原 front-matter 原文 */
  newFrontMatter: string | null;
  /** 表头需重建（unparsable_table） */
  newHeaderLines: string[] | null;
}

/** 按原表列结构对一行做逐列替换（原列序、额外列、id/来源/严重度列原样保留） */
function replaceRowInPlace(origLine: string, sg: NonNullable<ParsedDisposition['surgery']>, next: { verdict: string; reason: string; action: string | null }): string {
  const parts = origLine.split('|'); // parts[0] 是 '|' 前空串
  const setCol = (at: number | null, v: string) => {
    if (at === null || at + 1 >= parts.length) return;
    parts[at + 1] = ' ' + safeCell(v) + ' ';
  };
  setCol(sg.verdictAt, next.verdict);
  setCol(sg.reasonAt, next.reason);
  setCol(sg.actionAt, next.action ?? '');
  return parts.join('|');
}

/**
 * 原文手术：基于既有件全文做行级 patch——front-matter 与表外正文原样保留
 * （CLAUDE-04/CODEX-08：不整份重写审计件）。
 */
export function renderRepaired(parsed: ParsedDisposition, ops: SurgeryOps): string {
  const sg = parsed.surgery!;
  const lines = [...sg.lines];
  // 1) 行替换（按原列结构逐列替换）
  for (const [id, next] of ops.replaceRows) {
    const at = sg.rowLineOf.get(id);
    if (at !== undefined) lines[at] = replaceRowInPlace(lines[at]!, sg, next);
  }
  // 2) 删除行——**先于**表头替换按原下标完成（r3 CLAUDE-02：换表头会改变行数，
  //    之后再按旧下标过滤会错位误删）
  const removeAt = new Set<number>();
  for (const id of ops.removeIds) {
    const at = sg.rowLineOf.get(id);
    if (at !== undefined) removeAt.add(at);
  }
  const afterRemove = lines.filter((_, idx) => !removeAt.has(idx));
  // 3) 追加新行（finishRepair 内按已知行锚定插入）
  const appended = ops.appendLines.length > 0 ? [...ops.appendLines] : [];
  // 追加锚点用的已知行原文（未被删除、未被替换的行）
  const knownRowTexts = [...sg.rowLineOf.entries()]
    .filter(([id]) => !removeAt.has(sg.rowLineOf.get(id)!) && !ops.replaceRows.has(id))
    .map(([id]) => lines[sg.rowLineOf.get(id)!]!);
  // 4) 表头重建（仅调用方判定需要时——unparsable 但表头可识别的形态不换表头，
  //    只修行；r4 CODEX-05）
  let out: string[];
  if (ops.newHeaderLines) {
    const headIdx = afterRemove.indexOf(lines[sg.headerLine]!); // 删除后重定位表头行
    const head = headIdx >= 0 ? headIdx : sg.headerLine;
    out = [...afterRemove.slice(0, head), ...ops.newHeaderLines, ...afterRemove.slice(head + 1)];
  } else {
    out = afterRemove;
  }
  return finishRepair(out, appended, ops, knownRowTexts);
}

/** 按原表列结构生成一行（追加行与替换行同列序，r3 CODEX-04：短表/重排列不失位） */
export function appendRowByColumns(sg: NonNullable<ParsedDisposition['surgery']>, row: { id: string; verdict: string; reason: string; action: string | null; critic?: string | null; severity?: string | null }): string {
  const cells = sg.cols.map(() => '—');
  const set = (at: number | null, v: string) => {
    if (at !== null && at < cells.length) cells[at] = safeCell(v);
  };
  set(sg.idAt, row.id);
  set(sg.criticAt, row.critic ?? '—');
  set(sg.severityAt, row.severity ?? '—');
  set(sg.verdictAt, row.verdict);
  set(sg.reasonAt, row.reason);
  set(sg.actionAt, row.action ?? '');
  return '| ' + cells.join(' | ') + ' |';
}

function finishRepair(out: string[], appended: string[], ops: SurgeryOps, knownRowTexts: string[]): string {
  let text = out.join('\n');
  // 4) 追加行：插到表格末行后。锚定优先用**解析时已知的数据行原文**（r4 CODEX-03：
  //    编号列可能不在第一列、对齐行形态不一，正则假定会插错位）；已知行都找不到再
  //    回落「最后一个 | 起始行」的启发式
  if (appended.length > 0) {
    const lines2 = text.split('\n');
    let lastTable = -1;
    for (const known of knownRowTexts) {
      const at = lines2.indexOf(known);
      if (at > lastTable) lastTable = at;
    }
    if (lastTable < 0) {
      for (let i = 0; i < lines2.length; i++) {
        if ((lines2[i] ?? '').trim().startsWith('|')) lastTable = i;
      }
    }
    lines2.splice(lastTable + 1, 0, ...appended);
    text = lines2.join('\n');
  }
  // 5) front-matter 重建（bad_front_matter）：
  //    完整首对分隔符 → 原位替换；缺失/未闭合（正则无匹配）→ 文首插入新块
  //    （r2 CLAUDE-02/CODEX-08：replace 无匹配静默返回原文 = 永修不好的缺口）
  if (ops.newFrontMatter !== null) {
    const block = `---\n${ops.newFrontMatter}\n---\n`;
    if (/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
      text = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${ops.newFrontMatter}\n---`);
    } else {
      text = block + text.replace(/^---[^\n]*\n?/, ''); // 清掉残缺的起始分隔符行再插入
    }
  }
  return text;
}

// ── 落盘 ─────────────────────────────────────────────────────────────────

export type SaveOutcome =
  | { ok: true; path: string; mode: 'create' | 'replace' }
  | { ok: false; error: 'exists'; path: string; hint: string }
  | { ok: false; error: 'conflict'; path: string; hint: string }
  | { ok: false; error: 'io'; path: string; hint: string };

/**
 * 起草：独占创建（EEXIST 不抬升 -rN——编排器的重试语义不在插件重复；如实转修复提示）。
 * 修复：写回前比对载入时内容 hash 与当前盘上内容，不一致拒写（防并发覆盖）。
 */
export async function saveDraft(
  fs: DraftFs,
  absPath: string,
  text: string,
  mode: { kind: 'create' } | { kind: 'replace'; loadedText: string },
): Promise<SaveOutcome> {
  try {
    if (mode.kind === 'create') {
      const created = await fs.createExclusive(absPath, text);
      if (!created) {
        return { ok: false, error: 'exists', path: absPath, hint: '文件已存在：可能是上一份草稿或手工件，请在裁决台以修复模式读取它。' };
      }
      return { ok: true, path: absPath, mode: 'create' };
    }
    let current = '';
    try {
      current = await fs.readFile(absPath);
    } catch {
      return { ok: false, error: 'io', path: absPath, hint: '目标文件读不出，无法做并发冲突比对。' };
    }
    if (sha1(current) !== sha1(mode.loadedText)) {
      return { ok: false, error: 'conflict', path: absPath, hint: '文件在载入后已被外部修改：请重新拉取缺口再生成，避免覆盖他人改动。' };
    }
    // 冲突检测语义（r3 CLAUDE-08 / r4 CLAUDE-03，如实标注）：**检测而非防覆盖**——
    // 比对与 rename 之间仍存在竞态窗口（原子 rename 只保证不半写，不保证比对与
    // 替换不可分割）。彻底消除需协作锁，超出插件集成面承诺；残余窗口在交付说明声明。
    await fs.replaceExclusive(absPath, text);
    return { ok: true, path: absPath, mode: 'replace' };
  } catch (e) {
    return { ok: false, error: 'io', path: absPath, hint: `落盘失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

function sha1(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex');
}
