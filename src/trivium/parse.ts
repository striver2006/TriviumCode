/**
 * `parse`：把 Agent 的自由文本回答变成经 schema 校验的 `Review`（设计 §6.5 / AD-08）。
 *
 * 降级策略（AD-08 / §12.1）：解析失败不是致命错误——该侧标 `parse_fallback`，
 * 原文保留，且**不参与阻断判定**。但裁决件仍必须逐条应答它的意见（§6.6 规则 8）。
 *
 * schema 通过 `resolveJsonModule` 内联进打包产物，运行期零 `node_modules`（AD-12）。
 */
// 必须用 Ajv2020：schema 声明的是 draft 2020-12，而 ajv 的默认入口只带 draft-07
// 的元 schema，用它会报 no schema with key or ref "…/draft/2020-12/schema"。
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import reviewSchema from '../../skills/dual-critic/schema/review.v1.json' with { type: 'json' };
import type { CriticId, Review } from './types.js';
import { CRITIC_PREFIX } from './types.js';

export type ParseOutcome =
  | { ok: true; review: Review; extractedFrom: 'whole' | 'fence' | 'braces' }
  | { ok: false; reason: string; errors: string[]; rawText: string };

let cachedValidator: ValidateFunction<Review> | undefined;

function getValidator(): ValidateFunction<Review> {
  if (cachedValidator) return cachedValidator;
  // allErrors：一次把所有问题告诉模型，重试时才能一次改对（§12.3 只重试一次）
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  cachedValidator = ajv.compile<Review>(reviewSchema as object);
  return cachedValidator;
}

/** 把 ajv 错误渲染成可回喂给模型的可读文本 */
export function formatSchemaErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((e) => {
    const at = e.instancePath || '(根对象)';
    const extra =
      e.params && Object.keys(e.params).length > 0 ? ` ${JSON.stringify(e.params)}` : '';
    return `${at} ${e.message ?? '不合法'}${extra}`;
  });
}

/**
 * 从回答里抠出 JSON。三种形态按可靠性排序：
 *   1. 整段就是 JSON（`--json-schema` 生效时的常态）；
 *   2. 包在 ```json 代码围栏里（模型的常见习惯）；
 *   3. 从第一个 `{` 做括号配平扫描（兜底）。
 */
export type JsonCandidate = { json: string; from: 'whole' | 'fence' | 'braces' };

/** 扫出文本里**全部**顶层花括号配平的片段 */
function scanBalancedObjects(text: string): string[] {
  const out: string[] = [];
  let start = -1;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/**
 * 从回答里抠出**全部**候选 JSON，按可靠性排序。
 *
 * 为什么要返回多个而不是一个：实测 agy 1.2.0 会输出**两个首尾相接的 JSON 对象**
 * （内容完全相同，疑似流式收尾重复了一次）。此时整段文本仍然「以 { 开头、以 } 结尾」，
 * 旧实现据此当成一个整体返回，`JSON.parse` 在第二个对象的起始处报语法错误，
 * 于是一份完全合格的审查结论**每次**都被降级成 parse_fallback、失去阻断资格。
 *
 * 顺序：整段 → 代码围栏（可能多个）→ 逐个顶层配平片段。
 */
export function extractJsonCandidates(text: string): JsonCandidate[] {
  const out: JsonCandidate[] = [];
  const seen = new Set<string>();
  const push = (json: string, from: JsonCandidate['from']): void => {
    const t = json.trim();
    if (t.length === 0 || seen.has(t)) return;
    seen.add(t);
    out.push({ json: t, from });
  };

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) push(trimmed, 'whole');

  for (const m of text.matchAll(/```(?:json|JSON)?\s*\n([\s\S]*?)\n```/g)) {
    const inner = m[1]?.trim();
    if (inner?.startsWith('{')) push(inner, 'fence');
  }

  for (const frag of scanBalancedObjects(text)) push(frag, 'braces');

  /*
   * 再按行取一遍。配平扫描有个硬伤：**首个对象被截断**（未闭合的 `{`）会让深度
   * 再也回不到 0，后面所有完整对象一起被吞掉。而 agy 的 stream-json 本来就是
   * 行分隔的，逐行捡「以 { 开头、以 } 结尾」的行能从截断中恢复。
   */
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) push(t, 'braces');
  }
  return out;
}

/** 首个候选。保留给只需要「大致抠一段 JSON」的调用方 */
export function extractJsonCandidate(text: string): JsonCandidate | null {
  return extractJsonCandidates(text)[0] ?? null;
}

/**
 * 厂商注入的噪音字段。
 *
 * M0 之后的实跑发现：即使用了 `--json-schema`，Antigravity 仍会往结构化输出的
 * **根对象**塞 `toolAction` 与 `toolSummary` 两个自己的字段。审查内容本身完全合格，
 * 但 schema 的 `additionalProperties: false` 会把整份结论判死并降级成 parse_fallback。
 *
 * 处理方式是在校验**之前**剥掉这些已知的厂商字段，而不是放宽 schema——
 * 放宽会同时失去「字段名写错时能被发现」的保护。
 */
const VENDOR_NOISE_KEYS = ['toolAction', 'toolSummary'] as const;

function stripVendorNoise(obj: Record<string, unknown>): { cleaned: Record<string, unknown>; stripped: string[] } {
  const stripped: string[] = [];
  const cleaned = { ...obj };
  for (const k of VENDOR_NOISE_KEYS) {
    if (k in cleaned) {
      delete cleaned[k];
      stripped.push(k);
    }
  }
  return { cleaned, stripped };
}

/** 解析并校验审查结论 */
export function parseReview(text: string): ParseOutcome {
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) {
    return { ok: false, reason: '回答中找不到 JSON 对象', errors: [], rawText: text };
  }

  const validate = getValidator();
  /*
   * 逐个候选试，取**首个既能解析又通过校验**的。
   *
   * 不是「取第一个能解析的」：agy 的重复输出里两个对象都合法，但若第一个恰好
   * 是残缺的流式片段，只试一次就会白白降级。也不是「取最后一个」：那会让
   * 厂商在结论之后追加的任何东西顶掉真正的结论。
   */
  let lastReason = '回答中找不到可用的 JSON 对象';
  let lastErrors: string[] = [];

  for (const cand of candidates) {
    let obj: unknown;
    try {
      obj = JSON.parse(cand.json);
    } catch (e) {
      lastReason = `JSON 语法错误：${(e as Error).message}`;
      lastErrors = [];
      continue;
    }

    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      obj = stripVendorNoise(obj as Record<string, unknown>).cleaned;
    }

    if (validate(obj)) return { ok: true, review: obj as Review, extractedFrom: cand.from };

    lastReason = 'JSON 不符合 trivium.review.v1';
    lastErrors = formatSchemaErrors(validate.errors);
  }

  return { ok: false, reason: lastReason, errors: lastErrors, rawText: text };
}

export interface ReviewIntegrity {
  /** 编号前缀是否全部正确（两侧不得冲突，§6.5） */
  prefixOk: boolean;
  badIds: string[];
  /** 重复编号 */
  duplicateIds: string[];
  /**
   * evidence 里引用了但没写进 consulted 的文件（§6.5 末句要求）。
   * 只核「整段以九个常见根目录起头的 ASCII 路径」，口径见 `checkReviewIntegrity` 里的 `pathRe`。
   */
  evidenceNotInConsulted: string[];
  /** 无意见但也没说明检查了什么 */
  emptyWithoutExplanation: boolean;
}

/**
 * schema 之外的语义校验。
 *
 * schema 能保证「字段都在」，但保证不了「编号前缀属于本侧」「evidence 引用的文件
 * 出现在 consulted 里」这类跨字段约束。这些是 §6.5 的明文要求。
 */
export function checkReviewIntegrity(review: Review, critic: CriticId): ReviewIntegrity {
  const prefix = `${CRITIC_PREFIX[critic]}-`;
  const badIds = review.findings.filter((f) => !f.id.startsWith(prefix)).map((f) => f.id);

  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const f of review.findings) {
    if (seen.has(f.id)) duplicateIds.push(f.id);
    seen.add(f.id);
  }

  // 与抽取侧同一口径去掉前导 `./`：两侧都写 `./src/…` 时不该对不上（代码双审 r1 CODEX-02）
  const stripDotSlash = (p: string): string => p.replace(/^(?:\.\/)+/, '');
  const consulted = new Set((review.consulted ?? []).map(stripDotSlash));
  /*
   * 路径必须**整段**以已知根目录起头（EV-127）：前一个字符不能是字母、数字、`_`、`-`、`.`、`/`，
   * 允许前导 `./`（去掉后再比）。
   *
   * 上一版用 `\b` 起匹配，而 `-`、`.`、`/` 都不是单词字符，根目录名出现在路径**中段**时也会起匹配：
   * `skills-src/commands/run.contract.md` 被截成 `src/commands/run.contract.md`，`dist/test/…` 截成
   * `test/…`，`ZCode.app/Contents/…` 截成 `app/Contents/…`。本仓 383 份历史审查件实测，这类截断
   * 误报 56 条，报出的都是另一个文件名；改后只少不多、新报 0 条。
   *
   * 不在核对范围（漏报方向，BACKLOG 已登记）：不以这九个根目录起头的路径（如 `skills-src/`、
   * `dist/`）、`../` 与绝对路径、非 ASCII 文件名。这一项只进告警，不改判定。
   */
  const pathRe =
    /(?<![A-Za-z0-9_./-])(?:\.\/)*((?:src|lib|app|test|tests|doc|docs|packages|scripts)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/g;
  const missing = new Set<string>();
  for (const f of review.findings) {
    pathRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(f.evidence)) !== null) {
      const p = m[1]!;
      if (!consulted.has(p)) missing.add(p);
    }
  }

  const emptyWithoutExplanation =
    review.findings.length === 0 &&
    (review.summary.trim().length < 10 || (review.not_covered ?? []).length === 0);

  return {
    prefixOk: badIds.length === 0,
    badIds,
    duplicateIds,
    evidenceNotInConsulted: [...missing].sort(),
    emptyWithoutExplanation,
  };
}

/**
 * 解析失败时，从原文里把「看起来像意见」的段落切出来并编号（§6.6 规则 8）。
 *
 * 目的不是复原结构，而是让 Driver 有可逐条裁决的最小单元——
 * 否则 `parse_fallback` 侧的意见会被静默丢弃，违反 P5「不可伪装」。
 */
export function enumerateFallbackFindings(rawText: string, critic: CriticId): string[] {
  const prefix = CRITIC_PREFIX[critic];
  const blocks = rawText
    .split(/\n\s*(?:\n|(?=[-*]\s)|(?=\d+[.)]\s)|(?=#{1,6}\s))/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 20);
  return blocks.map((b, i) => `${prefix}-F${String(i + 1).padStart(2, '0')}: ${b}`);
}
