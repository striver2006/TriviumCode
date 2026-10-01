/**
 * `doc/` 下各目录 README「当前已归档文件」一节的对账判定（EV-172，计划 `.reviews/测试报告索引补齐/plan/` r2）。
 *
 * ## 为什么要有它
 *
 * `doc/05_testing/README.md` 的报告索引靠记性维护：它不在任何主题的「文档同步」清单里，各主题只补自己那一行，
 * 到 `466bb59` 时盘上 46 份报告只收了 27 份（与 EV-167 同形）。本文件把「目录里的文件」与「该节的条目」
 * 双向对账：缺登、悬空、重复、逆序都报，失败文案点名 README 与文件。
 *
 * ## 口径（计划 r2 §3）
 *
 * - **论域**：`doc/` 下每个一级目录的 `README.md`，含一行 `## 当前已归档文件` 的即入论域（按规则求，不手抄）；
 *   `KNOWN_INDEXED_DIRS` 是下限——改了节标题而掉出论域的目录先报 `not_in_domain`。
 * - **节**：节标题下一行到下一个 `# ` / `## ` 标题之前；`###` 及更深的小标题把节分成组（02_design 靠它按类别组织）。
 *   围栏代码块内的行一概不看。
 * - **条目**：节内顶格以 `- [` 起头、紧跟 `](目标)` 的列表项，目标取该项第一条链接；其余链接是行内链接。
 *   不起头于链接的列表项（05_testing 的 `evidence/` 目录说明）不是条目。缩进或 `* ` 起头的项也不是——
 *   它指向的文件因此报 `missing`，逼作者按顶格 `- [` 写（fail-closed）。
 * - **覆盖**：目录的每个顶层文件（`README.md` 自身、目录、`.` 起头的隐藏项除外）恰被一条本目录条目指向；
 *   **含非 `.md` 文件**——顶层只该放 `.md` 文档（`doc/README.md` 编写规范第 1、2 条），别的文件出现在这里就该暴露。
 *   **断链软链也算**（列得出名字、`kind` 为 null）：没进索引报 `missing`、进了索引报 `dangling`，两条路都红（代码双审 CODEX-02）。
 *   fifo、套接字这类非常规文件（`kind` 为 `other`）不算——它们不是文档，也不会被当作文档提交。
 *   跨目录条目（02_design 指向 05_testing 的 M0 报告）只判悬空，不计入任何目录的覆盖。
 * - **顺序**：按组、只看本目录条目，逐条与本组上一条含日期条目比——不含日期的条目排在含日期条目之后报一条，
 *   含日期条目的 (日期, 完整文件名码点序) 不严格大于上一条报一条。每条条目至多报一条 `order`，
 *   不数全部 i<j 违序对（计划双审 GLM-01）：修好一处就少一条，读数可对账。无日期条目之间不排序。
 *
 * **不核条目描述与报告是否相符**——那靠写的人与代码双审（计划 r2 §6 ②）。
 *
 * 本文件不依赖 `src/`；判定函数只经 `IndexIO` 三个回调接触文件系统，契约测试与
 * `doc/05_testing/evidence/doc-archive-index-20261001/` 下的证据脚本（git 读法）共用。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** 索引节的标题行（整行、去首尾空白后相等） */
export const SECTION_HEADING = '## 当前已归档文件';

/** 论域下限：`466bb59` 上带该节的六个目录。只减不增——新目录带了这一节会按规则自动入论域 */
export const KNOWN_INDEXED_DIRS: readonly string[] = [
  'doc/02_design',
  'doc/03_api',
  'doc/04_development',
  'doc/05_testing',
  'doc/06_deployment',
  'doc/07_manuals',
];

/** `null` = 不存在 */
export type PathKind = 'file' | 'dir' | 'other' | null;

/** 仓库相对路径（POSIX 分隔） */
export interface IndexIO {
  /** 读文件文本；读不到返回 null */
  read(rel: string): string | null;
  /** 目录的直接子项名（不递归）；读不到返回 null */
  list(rel: string): readonly string[] | null;
  /** 跟随软链判类型 */
  kind(rel: string): PathKind;
}

/** 工作树读法：`kind` 用 `statSync`（跟随软链）。契约测试与证据脚本共用这一份 */
export function fsIndexIO(root: string): IndexIO {
  const abs = (rel: string): string => path.join(root, ...rel.split('/'));
  return {
    read(rel) {
      try {
        return readFileSync(abs(rel), 'utf8');
      } catch {
        return null;
      }
    },
    list(rel) {
      try {
        return readdirSync(abs(rel));
      } catch {
        return null;
      }
    },
    kind(rel) {
      try {
        const s = statSync(abs(rel));
        return s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other';
      } catch {
        return null;
      }
    },
  };
}

export interface ParsedLink {
  /** 1 起 */
  line: number;
  /** 链接原文 */
  raw: string;
}

export interface ParsedEntry extends ParsedLink {
  /** 所在组（节内第几个小标题之后），0 起 */
  group: number;
}

export interface ParsedSection {
  /** 节标题出现次数（围栏外） */
  headingCount: number;
  /** 首个节标题所在行，1 起；没有为 -1 */
  headingLine: number;
  entries: ParsedEntry[];
  inline: ParsedLink[];
}

const ENTRY_RE = /^- \[[^\]]*\]\(([^)\s]+)\)/;
const LINK_RE = /\]\(([^)\s]+)\)/g;
const FENCE_RE = /^\s*(```|~~~)/;
const SECTION_END_RE = /^#{1,2}\s/;
const GROUP_RE = /^#{3,6}\s/;

/** 解析 README 的索引节；只看围栏外的行 */
export function parseSection(text: string): ParsedSection {
  const lines = text.split('\n');
  const fenced: boolean[] = [];
  let inFence = false;
  for (const l of lines) {
    if (FENCE_RE.test(l)) {
      fenced.push(true);
      inFence = !inFence;
    } else {
      fenced.push(inFence);
    }
  }
  const heads = lines.flatMap((l, i) => (!fenced[i] && l.trim() === SECTION_HEADING ? [i] : []));
  const out: ParsedSection = { headingCount: heads.length, headingLine: heads.length ? heads[0]! + 1 : -1, entries: [], inline: [] };
  if (!heads.length) return out;
  let group = 0;
  for (let i = heads[0]! + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (fenced[i]) continue;
    if (SECTION_END_RE.test(l)) break;
    if (GROUP_RE.test(l)) {
      group++;
      continue;
    }
    const links = [...l.matchAll(LINK_RE)].map((m) => m[1]!);
    const e = l.match(ENTRY_RE);
    if (e) {
      out.entries.push({ line: i + 1, raw: e[1]!, group });
      links.shift();
    }
    for (const raw of links) out.inline.push({ line: i + 1, raw });
  }
  return out;
}

/**
 * 链接目标 → 仓库相对路径：去 `#片段`、去尾斜杠、百分号解码（失败用原文）、相对 README 所在目录求 POSIX 路径。
 * 带协议（`https:`、`mailto:` …）与纯锚点返回 null。
 */
export function resolveTarget(readmeDir: string, raw: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  let t = raw.split('#')[0]!.replace(/\/+$/, '');
  if (t === '') return null;
  try {
    t = decodeURIComponent(t);
  } catch {
    // 原文不是合法的百分号编码：按原文求路径
  }
  return path.posix.normalize(path.posix.join(readmeDir, t));
}

/**
 * 文件名起头的日期：`YYYY-MM-DD` 位于文件名开头（可带一个大写前缀加下划线，如 `REPORT_`），其后紧跟 `_` 或 `-`，
 * 且月为 01～12、日为 01～31；不满足返回 null，按「无日期」处理——错打日期的报告因此会被「非报告文件在前」那条判红
 * （代码双审 CODEX-03）。
 */
export function dateOf(basename: string): string | null {
  const m = basename.match(/^(?:[A-Z]+_)?(\d{4})-(\d{2})-(\d{2})(?=[_-])/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export type ProblemKind = 'not_in_domain' | 'section_ambiguous' | 'missing' | 'duplicate' | 'dangling' | 'inline_dangling' | 'order';

export interface Problem {
  kind: ProblemKind;
  /** README 的仓库相对路径 */
  readme: string;
  /** 1 起 */
  line?: number;
  detail: string;
}

/** 论域：`doc/` 下一级目录里含索引节的 README，按路径排序 */
export function indexedReadmes(io: IndexIO): string[] {
  const out: string[] = [];
  for (const name of io.list('doc') ?? []) {
    const dir = `doc/${name}`;
    if (io.kind(dir) !== 'dir') continue;
    const text = io.read(`${dir}/README.md`);
    if (text !== null && parseSection(text).headingCount > 0) out.push(`${dir}/README.md`);
  }
  return out.sort();
}

/** 下限清单里的目录必须都在论域内 */
export function checkDomain(domain: readonly string[], known: readonly string[] = KNOWN_INDEXED_DIRS): Problem[] {
  return known
    .filter((d) => !domain.includes(`${d}/README.md`))
    .map((d) => ({ kind: 'not_in_domain' as const, readme: `${d}/README.md`, detail: `该 README 不在论域内（没有「${SECTION_HEADING}」一节，或节标题被改了）` }));
}

interface Resolved {
  readme: string;
  dir: string;
  section: ParsedSection;
  entries: Array<ParsedEntry & { target: string | null }>;
}

function load(readme: string, io: IndexIO): Resolved | Problem[] {
  const text = io.read(readme);
  if (text === null) return [{ kind: 'not_in_domain', readme, detail: `README 读不到：${readme}` }];
  const section = parseSection(text);
  if (section.headingCount !== 1) {
    return [{ kind: section.headingCount === 0 ? 'not_in_domain' : 'section_ambiguous', readme, detail: `「${SECTION_HEADING}」出现 ${section.headingCount} 次` }];
  }
  const dir = path.posix.dirname(readme);
  return { readme, dir, section, entries: section.entries.map((e) => ({ ...e, target: resolveTarget(dir, e.raw) })) };
}

/** 覆盖、重复、悬空、行内悬空 */
export function checkIndex(readme: string, io: IndexIO): Problem[] {
  const r = load(readme, io);
  if (Array.isArray(r)) return r;
  const out: Problem[] = [];
  const own = new Map<string, number[]>();
  for (const e of r.entries) {
    if (e.target === null || io.kind(e.target) !== 'file') {
      out.push({ kind: 'dangling', readme, line: e.line, detail: `条目目标不是存在的文件：${e.raw}` });
    }
    // 悬空条目若指向本目录，仍算「已登记」：断链软链只报这一条 dangling，不再连带报 missing
    if (e.target === null || path.posix.dirname(e.target) !== r.dir) continue;
    const name = path.posix.basename(e.target);
    own.set(name, [...(own.get(name) ?? []), e.line]);
  }
  for (const [name, lines] of own) {
    if (lines.length > 1) out.push({ kind: 'duplicate', readme, line: lines[0], detail: `${name} 有 ${lines.length} 条条目（第 ${lines.join('、')} 行）` });
  }
  const coverable = (k: PathKind): boolean => k === 'file' || k === null;
  const files = (io.list(r.dir) ?? [])
    .filter((n) => n !== 'README.md' && !n.startsWith('.') && coverable(io.kind(`${r.dir}/${n}`)))
    .sort();
  for (const f of files) {
    if (!own.has(f)) out.push({ kind: 'missing', readme, detail: `${r.dir}/${f} 没有进「${SECTION_HEADING}」一节` });
  }
  for (const l of r.section.inline) {
    const t = resolveTarget(r.dir, l.raw);
    if (t !== null && io.kind(t) === null) out.push({ kind: 'inline_dangling', readme, line: l.line, detail: `行内链接目标不存在：${l.raw}` });
  }
  return out;
}

/** 组内顺序：无日期条目在前；含日期条目按 (日期, 文件名) 严格升序，逐条与本组上一条含日期条目比 */
export function checkOrder(readme: string, io: IndexIO): Problem[] {
  const r = load(readme, io);
  if (Array.isArray(r)) return r;
  const out: Problem[] = [];
  let group = -1;
  let last: { date: string; name: string; line: number } | null = null;
  for (const e of r.entries) {
    if (e.target === null || path.posix.dirname(e.target) !== r.dir) continue;
    if (e.group !== group) {
      group = e.group;
      last = null;
    }
    const name = path.posix.basename(e.target);
    const date = dateOf(name);
    if (date === null) {
      if (last) out.push({ kind: 'order', readme, line: e.line, detail: `无日期的 ${name} 排在含日期的 ${last.name}（第 ${last.line} 行）之后——非报告文件要排在报告之前` });
      continue;
    }
    if (last && !(date > last.date || (date === last.date && name > last.name))) {
      out.push({ kind: 'order', readme, line: e.line, detail: `${name} 应排在 ${last.name}（第 ${last.line} 行）之前——按（日期, 文件名）升序` });
    }
    last = { date, name, line: e.line };
  }
  return out;
}

/** 失败文案：一行一个问题 */
export function formatProblems(ps: readonly Problem[]): string {
  return ps.map((p) => `  [${p.kind}] ${p.readme}${p.line ? `:${p.line}` : ''} ${p.detail}`).join('\n');
}
