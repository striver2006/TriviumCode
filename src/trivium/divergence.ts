/**
 * 双审退化指标（设计 §9.3）。
 *
 * 若两侧 `findings` 的位置集合 Jaccard 相似度长期 > 0.8，说明两侧在看同一批地方，
 * 差异化镜头没起作用——`report` 会输出「双审退化」提示（不是报错）。
 *
 * **必须先归一化**（审查意见 AGY-06）：`location` 是自由字符串，两家格式各异
 * （`src/a.ts:88` vs `src/a.ts:85-92`，`plan §3.2` vs `§3.2`）。
 * 直接算原始字符串交集会失真——M3 那轮双审实测原始 Jaccard = **0.00**，
 * 而两侧明明有概念重叠（AGY-01 与 GLM-03 讲同一件事）。
 */
import type { Review } from './types.js';

export interface NormalizedLocation {
  /** 文件相对路径，或章节标记（形如 `§3.2`） */
  anchor: string;
  /** 行区间，[start, end]；无行号时为 null */
  lines: [number, number] | null;
  raw: string;
}

/**
 * 归一化一条 `location`。
 *
 * 三种形态：
 *   `src/a.ts:88`      → { anchor: 'src/a.ts', lines: [88, 88] }
 *   `src/a.ts:85-92`   → { anchor: 'src/a.ts', lines: [85, 92] }
 *   `plan §3.2` / `§3.2` → { anchor: '§3.2', lines: null }
 */
export function normalizeLocation(raw: string): NormalizedLocation {
  const s = raw.trim();

  /*
   * 章节标记：去掉 plan/code/bug 之类的前缀，只留 §x.y。
   *
   * 一条 location 有时会点到多个章节（实测出现过 `plan §1 & §6 R-B`）。
   * 这里只取**第一个**——一条意见挂在多处时，「它到底算哪一处」本身没有唯一答案，
   * 而重合度只需要一个稳定的代表锚点。取第一个是确定性的，也和人读时的主锚点一致。
   */
  const section = /§\s*([\d.]+)/.exec(s);
  if (section) {
    return { anchor: `§${section[1]!.replace(/\.$/, '')}`, lines: null, raw };
  }

  // 路径 + 行号/行区间
  const withLines = /^(.*?):(\d+)(?:\s*[-–~]\s*(\d+))?\s*$/.exec(s);
  if (withLines) {
    const anchor = normalizePath(withLines[1]!);
    const a = Number.parseInt(withLines[2]!, 10);
    const b = withLines[3] ? Number.parseInt(withLines[3], 10) : a;
    return { anchor, lines: [Math.min(a, b), Math.max(a, b)], raw };
  }

  return { anchor: normalizePath(s), lines: null, raw };
}

/** 去掉开头的 ./ 与项目前缀差异，统一分隔符 */
function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\s+/g, '');
}

/** 两条归一化位置是否指向同一处：anchor 相同，且行区间有重合（或都无行号） */
export function sameLocation(a: NormalizedLocation, b: NormalizedLocation): boolean {
  if (a.anchor !== b.anchor) return false;
  if (a.lines === null || b.lines === null) return true; // 一方未给行号 → 视为同一处
  return a.lines[0] <= b.lines[1] && b.lines[0] <= a.lines[1];
}

export interface DivergenceReport {
  /** 归一化后的 Jaccard 相似度，0~1 */
  jaccard: number;
  /** 未归一化的对照值，便于看出归一化到底起了多少作用 */
  rawJaccard: number;
  /** 两侧都覆盖到的位置 */
  overlap: string[];
  onlyA: string[];
  onlyB: string[];
  /** 是否触发「双审退化」提示 */
  degenerate: boolean;
  threshold: number;
}

/**
 * 计算两侧的镜头重合度。
 *
 * 用**区间重合**而非字符串相等做匹配，因此不能直接套集合运算：
 * 交集大小 = A 中能在 B 里找到同一处的条目数。
 */
/**
 * 同侧内部去重：设计说的是「位置**集合**」的 Jaccard，不是多重集。
 *
 * 同一侧完全可能有两条意见落在同一处（实测 `plan §1` 与 `plan §1 & §6 R-B` 都归一到 §1），
 * 若不折叠，重合数会被同侧的重复项抬高，指标随「一处提了几条」浮动而非随覆盖面浮动。
 * 用贪心聚类而非按 key 去重，因为「同一处」的判据是区间重合，不是相等。
 */
function dedupe(locs: NormalizedLocation[]): NormalizedLocation[] {
  const out: NormalizedLocation[] = [];
  for (const x of locs) {
    if (!out.some((y) => sameLocation(x, y))) out.push(x);
  }
  return out;
}

export function measureDivergence(
  a: Review | null,
  b: Review | null,
  threshold = 0.8,
): DivergenceReport {
  const la = dedupe((a?.findings ?? []).map((f) => normalizeLocation(f.location)));
  const lb = dedupe((b?.findings ?? []).map((f) => normalizeLocation(f.location)));

  const overlap: string[] = [];
  const onlyA: string[] = [];
  for (const x of la) {
    if (lb.some((y) => sameLocation(x, y))) overlap.push(x.raw);
    else onlyA.push(x.raw);
  }
  const onlyB = lb.filter((y) => !la.some((x) => sameLocation(x, y))).map((y) => y.raw);

  // 并集 = 重合处（按 A 侧计一次）+ 各自独有
  const union = overlap.length + onlyA.length + onlyB.length;
  const jaccard = union === 0 ? 0 : overlap.length / union;

  // 对照值同样按集合算，两者才可比
  const rawA = new Set((a?.findings ?? []).map((f) => f.location.trim()));
  const rawB = new Set((b?.findings ?? []).map((f) => f.location.trim()));
  const rawInter = [...rawA].filter((x) => rawB.has(x)).length;
  const rawUnion = new Set([...rawA, ...rawB]).size;

  return {
    jaccard,
    rawJaccard: rawUnion === 0 ? 0 : rawInter / rawUnion,
    overlap,
    onlyA,
    onlyB,
    // 两侧都没意见时不该判退化——那是「都认为没问题」，不是「看了同一批地方」
    degenerate: union > 0 && jaccard > threshold,
    threshold,
  };
}

export function renderDivergence(d: DivergenceReport): string {
  const lines = [
    `镜头重合度 Jaccard = ${d.jaccard.toFixed(2)}（未归一化 ${d.rawJaccard.toFixed(2)}，阈值 ${d.threshold}）`,
    `  两侧共同覆盖 ${d.overlap.length} 处 ｜ 仅 gemini ${d.onlyA.length} 处 ｜ 仅 glm ${d.onlyB.length} 处`,
  ];
  if (d.degenerate) {
    lines.push(
      '  ⚠️ 双审退化：两侧在看同一批地方，差异化镜头没起作用。',
      '     建议调整 lenses.yaml 的镜头或改用差异更大的模型组合。',
    );
  }
  return lines.join('\n');
}
