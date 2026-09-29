/**
 * 门面文档版本指针的对账清单与判定函数（EV-167，计划 `.reviews/门面文档版本指针/plan/` r2）。
 *
 * ## 为什么要有这张清单
 *
 * 设计索引、PROTOCOL / QUICKSTART / MANUAL 的「依据」行、PRD 的「设计依据见」这类门面指针
 * 曾经写死目标文档的版本号，而它们不在任何主题的「文档同步」清单里——主设计 §24.2 记着设计索引
 * 被人工「跟」过七次、漏过一次，到 `79d2ed4` 时已落后 19 个版本（EV-167）。现在这些行只链接
 * 目标文档并注明「当前版本见其文档头」，本文件把它们钉住，防止回潮。
 *
 * ## 两层守法
 *
 * - **逐行清单**（`POINTERS`）：每条是一个当前版本指针。所在行不得含版本号、必须含标记短语
 *   `MARKER` 与目标文件名。反向绑定：门面论域里凡「标记短语与指向会升版文档的链接同行」的行
 *   都必须是某条清单项（`findUnlistedMarkers`）——所以从清单删掉任何一项都会红，而不是悄悄少守一处。
 *   只引述标记短语、不带这类链接的叙述句（报告索引、规范正文）不算指针用法，不报；
 *   变更记录形态的行（`CHANGELOG_LINE_RE`）也不报（代码双审 r1 CODEX-06）。
 * - **全局规则**（`scanGlobalRules`）：门面论域里任何非变更记录行都不得出现
 *   「本版（v…」这种自指版本，也不得出现随代码或随主题增长的计数（模块数、行数、
 *   现状缺口 / 已知限制 / 执行流 / 日常场景的条数）。这类位置不以清单项表示：
 *   清单项可以被删，规则没有「项」可删（计划双审 r1 AGY-01）。
 *   **计数只认 `STAT_RES` 已列举的量词形态**：新的增长型计数（「N 个消费点」之类）要先把形态
 *   加进 `STAT_RES` 才会红，此前靠自觉（代码双审 r1 CODEX-07）。
 *
 * **历史样本**（`HISTORICAL_SAMPLES`）的锚点多数含版本号：有人把样本行里的版本号「顺手修掉」，
 * 会先报 `anchor_missing` 而不是 `forbidden`——这是有意的，历史语境的版本号本就不该删
 * （代码双审 r1 CODEX-01）。
 *
 * **只守已知形态。** 有人在别处照旧习惯新写一个带版本号、又不带标记短语的指针，这里看不见——
 * 那是 EV-171 登记的缺口，不是本文件的承诺。
 *
 * 本文件不依赖 `src/`，只以回调读文件与列目录，供契约测试与 evidence 下的证据脚本共用
 * （证据脚本导入测试构建产物 `dist/test/test/helpers/facade-pointers.js`）。
 */

/** 当前版本指针的标记短语。一行两个目标时写「两者的当前版本见其文档头」，仍含本短语 */
export const MARKER = '当前版本见其文档头';

/** 写死的版本号形态 */
export const VERSION_RE = /\bv\d+\.\d+(?:\.\d+)?\b/;

/** 自指版本：「截至本版（v1.4.8）」这类——「本版」恒为文档头的当前版本，括号里的数字只会过期 */
export const SELF_VERSION_RE = /本版\s*[（(]\s*v\d/;

/**
 * 随代码或随主题增长的计数。模块数与行数只认阿拉伯数字（避开「一个模块一件事」这类单数说法）；
 * 条目类计数同时认阿拉伯与汉字数字（计划双审 r1 AGY-02）。
 *
 * 不在此列的计数是有意保留的：「三个核心状态机」「五条实现约束」「七条命令」「五道护栏」
 * 写进了目标文档的章标题，改结构必改标题，不会单边漂（计划 r2 §3.2）。
 */
export const STAT_RES: readonly RegExp[] = [
  /\d[\d,]*\s*个模块/,
  /\d[\d,]*\s*行\s?(?:代码|TypeScript)/,
  /(?:\d+|[零一二两三四五六七八九十百千]+)\s*(?:条现状缺口|条已知限制|条执行流|个日常场景)/,
];

/**
 * 变更记录形态的行不参与标记绑定与全局规则：变更记录记的是当时的事实，
 * 本主题自己的变更记录也会转述这些措辞。两种形态：PRD / LLD 文档头的「变更说明」条目，
 * 主设计 §21 那种以版本号起头的表格行。
 */
export const CHANGELOG_LINE_RE = /^\s*(?:>\s*-\s*\*\*变更说明\*\*|\|\s*\*{0,2}v\d)/;

const DESIGN = '2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
const PRD = 'PRD_driver_dual_critic.md';

/** 有版本字段、会随主题升版的四份文档（文件名）；门面指针指向的就是它们 */
export const VERSIONED_DOCS: readonly string[] = [DESIGN, PRD, 'LLD_orchestrator.md', 'MANUAL_user.md'];

/** 该行是否含指向 `VERSIONED_DOCS` 之一的 Markdown 链接 */
export function linksVersionedDoc(line: string): boolean {
  for (const m of line.matchAll(/\]\(([^)]*)\)/g)) {
    const target = m[1] ?? '';
    if (VERSIONED_DOCS.some((d) => target.includes(d))) return true;
  }
  return false;
}

export interface PointerEntry {
  /** 计划 r2 §3.1 的编号 */
  id: string;
  /** 相对仓库根 */
  file: string;
  /** 该行里改前改后都在、且不含版本号的一段原文；全文件恰好出现一次 */
  anchor: string;
  /** 该行必须仍含的目标文件名（防止连链接一起删掉也算绿） */
  links: readonly string[];
}

/** 当前版本指针（计划 r2 §3.1 P1～P9） */
export const POINTERS: readonly PointerEntry[] = [
  { id: 'P1', file: 'doc/02_design/README.md', anchor: '**Driver-DualCritic 主攻双审流水线总体架构与详细设计**', links: [DESIGN, PRD] },
  { id: 'P2', file: 'doc/02_design/README.md', anchor: '**编排器详细设计说明书**', links: ['LLD_orchestrator.md'] },
  { id: 'P3', file: 'doc/07_manuals/README.md', anchor: '**使用手册**', links: ['MANUAL_user.md'] },
  { id: 'P4', file: 'doc/03_api/PROTOCOL_dual_critic_relay.md', anchor: '第 6、7、9 章与', links: [DESIGN, PRD] },
  { id: 'P5', file: 'doc/07_manuals/QUICKSTART.md', anchor: '依据 [设计', links: [DESIGN, PRD] },
  { id: 'P6', file: 'doc/07_manuals/MANUAL_user.md', anchor: '16.1 与 §24 台账', links: [DESIGN] },
  { id: 'P7', file: `doc/01_requirements/${PRD}`, anchor: '五条演进需求的设计依据见', links: [DESIGN] },
  { id: 'P8', file: '.reviews/README.md', anchor: '规范依据：', links: [PRD, DESIGN] },
  { id: 'P9', file: `doc/02_design/${DESIGN}`, anchor: '> - **需求依据**', links: [PRD] },
];

export interface HistoricalSample {
  id: string;
  file: string;
  anchor: string;
  /** 为何是历史语境（计划 r2 §4） */
  why: string;
}

/**
 * 历史语境与冻结件的代表行：它们**确含版本号**且必须留着。用例断言它们不落在任何清单项的行上、
 * 也不被全局规则命中——「不误报」要在含版本号的行上才有意义。
 */
export const HISTORICAL_SAMPLES: readonly HistoricalSample[] = [
  { id: 'H-idx-28', file: 'doc/02_design/README.md', anchor: 'v1.3.43 起本句由', why: '历史叙述：读法句在哪一版改过' },
  { id: 'H-idx-48', file: 'doc/02_design/README.md', anchor: '（**v1.0.0**，状态：**正式 · 受控增量规范**', why: '冻结件：演进设计自 v1.0.0 起冻结正文' },
  { id: 'H-prd-106', file: `doc/01_requirements/${PRD}`, anchor: '截至 v1.4.8，S6、S7 已可用', why: '时点记述' },
  { id: 'H-prd-433', file: `doc/01_requirements/${PRD}`, anchor: '截至 v1.4.8：AC-20 已达成', why: '时点记述（P10 由自指改来，与 :106 同形）' },
  { id: 'H-prd-203', file: `doc/01_requirements/${PRD}`, anchor: 'v1.0.0（受控增量规范）', why: '冻结件的版本' },
  { id: 'H-lld-157', file: 'doc/02_design/LLD_orchestrator.md', anchor: '设计依据见[设计 v1.3.6]', why: '事件所在版本：M7b 第 6 步放开两处收窄时的设计' },
  { id: 'H-adr2-7', file: 'doc/02_design/ADR_002_multicritic_isolation.md', anchor: '**关联**：[设计 v1.3.6]', why: 'ADR 关联行，决策时的设计版本' },
  { id: 'H-proto-31', file: 'doc/03_api/PROTOCOL_dual_critic_relay.md', anchor: '设计 v1.3.45 / EV-134', why: '出处标注：行为从哪一版起' },
  { id: 'H-manual-652', file: 'doc/07_manuals/MANUAL_user.md', anchor: 'v1.0.5 起，设计 v1.3.47', why: '出处标注' },
  { id: 'H-design-50', file: `doc/02_design/${DESIGN}`, anchor: '> - **演进依据**', why: '冻结件的版本' },
  { id: 'H-testidx-46', file: 'doc/05_testing/README.md', anchor: '主设计 v1.3.43、PRD v1.4.8、LLD v1.1.3、MANUAL v1.0.3', why: '报告索引记当时的版本' },
];

/**
 * 门面论域的根级文件。`CLAUDE.md` 是用户的项目指令文件，本仓不改它（BACKLOG EV-138），
 * 纳入论域只是读（代码双审 r1 GLM-02）。
 */
export const ROOT_FACADE_FILES: readonly string[] = ['README.md', 'AGENTS.md', 'CLAUDE.md', '.reviews/README.md'];

/**
 * `doc/` 下不属门面的部分：报告与证据（记当时的事实）、项目日志（BACKLOG 与台账只追加）、
 * 参考答卷（冻结的设计输入）、演进设计（冻结正文）。
 */
export const NON_FACADE_DOC_RE = /^doc\/(?:05_testing\/(?:REPORT_|evidence\/)|08_project\/|02_design\/reference\/|02_design\/2026-09-13-通用Agent编排与动态多审设计\.md$)/;

/** 某个仓库相对路径是否属门面论域 */
export function isFacadeDoc(rel: string): boolean {
  if (ROOT_FACADE_FILES.includes(rel)) return true;
  return rel.startsWith('doc/') && rel.endsWith('.md') && !NON_FACADE_DOC_RE.test(rel);
}

/** 从候选路径（根级文件 + `doc/` 下全部文件）求门面论域；按目录规则求，不手抄 */
export function facadeCorpus(candidates: readonly string[]): string[] {
  return [...new Set(candidates.filter(isFacadeDoc))].sort();
}

export interface DirEntryLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/** 列候选路径所需的文件系统操作；契约测试与证据脚本各自注入真实 fs */
export interface CandidateIO {
  exists(rel: string): boolean;
  readdir(rel: string): readonly DirEntryLike[];
}

/**
 * 候选路径：存在的根级门面文件 + `doc/` 下全部文件（递归）。与 `facadeCorpus` 合起来就是门面论域的
 * 唯一求法——契约测试与证据脚本都走这里，不各写一份（代码双审 r1 CODEX-05）。
 */
export function facadeCandidates(io: CandidateIO): string[] {
  const out = ROOT_FACADE_FILES.filter((f) => io.exists(f));
  const walk = (rel: string): void => {
    for (const d of io.readdir(rel)) {
      const child = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(child);
      else if (d.isFile()) out.push(child);
    }
  };
  walk('doc');
  return out;
}

export type ProblemKind =
  | 'file_missing'
  | 'anchor_missing'
  | 'anchor_ambiguous'
  | 'forbidden'
  | 'link_missing'
  | 'marker_missing'
  | 'unlisted_marker'
  | 'not_in_corpus'
  | 'sample_on_pointer'
  | 'self_version'
  | 'stat_count';

export interface Problem {
  kind: ProblemKind;
  file: string;
  /** 清单项或样本的编号；论域扫描的问题没有 */
  id?: string;
  /** 1 起 */
  line?: number;
  detail: string;
}

/** 读仓库相对路径；读不到返回 null */
export type ReadFn = (rel: string) => string | null;

export interface Located {
  /** 锚点在全文件的出现次数 */
  count: number;
  /** 首次出现所在行，0 起；count 为 0 时为 -1 */
  index: number;
  lines: string[];
}

export function locate(text: string, anchor: string): Located {
  const lines = text.split('\n');
  const count = anchor === '' ? 0 : text.split(anchor).length - 1;
  const index = lines.findIndex((l) => l.includes(anchor));
  return { count, index, lines };
}

function lineOf(entry: { file: string; anchor: string }, read: ReadFn): { text: string | null; loc: Located | null } {
  const text = read(entry.file);
  return { text, loc: text === null ? null : locate(text, entry.anchor) };
}

/**
 * 逐条核对清单项；逐条收集全部问题，找不到一律报错，不静默跳过。
 *
 * 版本号按**整行**禁，是刻意从严：清单行只放指针，史实陈述（「v1.1.0 按 RV-01～RV-26 修订」）
 * 另起一行。这里红了，该做的是拆行，不是删史实里的版本号（代码双审 r1 CODEX-09）。
 */
export function checkPointers(entries: readonly PointerEntry[], read: ReadFn): Problem[] {
  const out: Problem[] = [];
  for (const e of entries) {
    const { loc } = lineOf(e, read);
    const base = { id: e.id, file: e.file };
    if (loc === null) {
      out.push({ ...base, kind: 'file_missing', detail: `文件读不到：${e.file}` });
      continue;
    }
    if (loc.count === 0) {
      out.push({ ...base, kind: 'anchor_missing', detail: `锚点找不到：「${e.anchor}」` });
      continue;
    }
    if (loc.count > 1) {
      out.push({ ...base, kind: 'anchor_ambiguous', detail: `锚点出现 ${loc.count} 次，不唯一：「${e.anchor}」` });
      continue;
    }
    const line = loc.lines[loc.index] ?? '';
    const at = { ...base, line: loc.index + 1 };
    const v = line.match(VERSION_RE);
    if (v) out.push({ ...at, kind: 'forbidden', detail: `写死了版本号「${v[0]}」：${line}` });
    for (const l of e.links) {
      if (!line.includes(l)) out.push({ ...at, kind: 'link_missing', detail: `缺目标链接「${l}」：${line}` });
    }
    if (!line.includes(MARKER)) out.push({ ...at, kind: 'marker_missing', detail: `缺标记短语「${MARKER}」：${line}` });
  }
  return out;
}

/** 清单项所在行的「文件 + 行号」键；定位失败的项不产出 */
function listedLineKeys(entries: readonly PointerEntry[], read: ReadFn): Set<string> {
  const keys = new Set<string>();
  for (const e of entries) {
    const { loc } = lineOf(e, read);
    if (loc && loc.count === 1) keys.add(`${e.file}\n${loc.index}`);
  }
  return keys;
}

/**
 * 反向绑定：论域里凡「标记短语与指向会升版文档的链接同行」的非变更记录行，都必须是某条清单项的锚点行；
 * 另核每条清单项的文件都在论域内（论域规则把门面文件排除掉时先红）。
 */
export function findUnlistedMarkers(corpus: readonly string[], entries: readonly PointerEntry[], read: ReadFn): Problem[] {
  const out: Problem[] = [];
  const inCorpus = new Set(corpus);
  for (const e of entries) {
    if (!inCorpus.has(e.file)) {
      out.push({ kind: 'not_in_corpus', id: e.id, file: e.file, detail: `清单项的文件不在门面论域内：${e.file}` });
    }
  }
  const keys = listedLineKeys(entries, read);
  for (const f of corpus) {
    const text = read(f);
    if (text === null) {
      out.push({ kind: 'file_missing', file: f, detail: `论域文件读不到：${f}` });
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (!line.includes(MARKER) || CHANGELOG_LINE_RE.test(line) || !linksVersionedDoc(line)) return;
      if (!keys.has(`${f}\n${i}`)) {
        out.push({ kind: 'unlisted_marker', file: f, line: i + 1, detail: `带标记短语却不在清单里：${line}` });
      }
    });
  }
  return out;
}

/** 全局规则：论域里任何非变更记录行不得有自指版本与增长型计数 */
export function scanGlobalRules(corpus: readonly string[], read: ReadFn): Problem[] {
  const out: Problem[] = [];
  for (const f of corpus) {
    const text = read(f);
    if (text === null) {
      out.push({ kind: 'file_missing', file: f, detail: `论域文件读不到：${f}` });
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (CHANGELOG_LINE_RE.test(line)) return;
      const self = line.match(SELF_VERSION_RE);
      if (self) out.push({ kind: 'self_version', file: f, line: i + 1, detail: `自指版本「${self[0]}」：${line}` });
      for (const re of STAT_RES) {
        for (const m of line.matchAll(new RegExp(re.source, 'g'))) {
          out.push({ kind: 'stat_count', file: f, line: i + 1, detail: `写死了计数「${m[0]}」：${line}` });
        }
      }
    });
  }
  return out;
}

/** 历史样本的问题：定位失败、所在行不含版本号、与清单项同行、被全局规则命中 */
export function checkHistoricalSamples(
  samples: readonly HistoricalSample[],
  entries: readonly PointerEntry[],
  read: ReadFn,
): Problem[] {
  const out: Problem[] = [];
  const keys = listedLineKeys(entries, read);
  for (const s of samples) {
    const { text, loc } = lineOf(s, read);
    const base = { id: s.id, file: s.file };
    if (text === null || loc === null) {
      out.push({ ...base, kind: 'file_missing', detail: `文件读不到：${s.file}` });
      continue;
    }
    if (loc.count !== 1) {
      out.push({ ...base, kind: loc.count === 0 ? 'anchor_missing' : 'anchor_ambiguous', detail: `历史样本锚点出现 ${loc.count} 次：「${s.anchor}」` });
      continue;
    }
    const line = loc.lines[loc.index] ?? '';
    const at = { ...base, line: loc.index + 1 };
    if (!VERSION_RE.test(line)) {
      out.push({ ...at, kind: 'forbidden', detail: `历史样本不再含版本号——历史语境的版本号不该被改掉（${s.why}）：${line}` });
    }
    if (keys.has(`${s.file}\n${loc.index}`)) {
      out.push({ ...at, kind: 'sample_on_pointer', detail: `历史样本与清单项落在同一行：${line}` });
    }
    const hit = scanGlobalRules([s.file], (f) => (f === s.file ? line : null));
    for (const p of hit) out.push({ ...p, ...at, detail: `历史样本被全局规则命中：${p.detail}` });
  }
  return out;
}

/** 失败文案：一行一个问题 */
export function formatProblems(ps: readonly Problem[]): string {
  return ps.map((p) => `  [${p.kind}] ${p.id ? `${p.id} ` : ''}${p.file}${p.line ? `:${p.line}` : ''} ${p.detail}`).join('\n');
}
