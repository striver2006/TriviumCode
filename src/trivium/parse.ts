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
export function extractJsonCandidate(
  text: string,
): { json: string; from: 'whole' | 'fence' | 'braces' } | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return { json: trimmed, from: 'whole' };

  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith('{')) return { json: inner, from: 'fence' };
  }

  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), from: 'braces' };
    }
  }
  return null;
}

/** 解析并校验审查结论 */
export function parseReview(text: string): ParseOutcome {
  const cand = extractJsonCandidate(text);
  if (!cand) {
    return { ok: false, reason: '回答中找不到 JSON 对象', errors: [], rawText: text };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(cand.json);
  } catch (e) {
    return {
      ok: false,
      reason: `JSON 语法错误：${(e as Error).message}`,
      errors: [],
      rawText: text,
    };
  }

  const validate = getValidator();
  if (!validate(obj)) {
    return {
      ok: false,
      reason: 'JSON 不符合 trivium.review.v1',
      errors: formatSchemaErrors(validate.errors),
      rawText: text,
    };
  }
  return { ok: true, review: obj, extractedFrom: cand.from };
}

export interface ReviewIntegrity {
  /** 编号前缀是否全部正确（两侧不得冲突，§6.5） */
  prefixOk: boolean;
  badIds: string[];
  /** 重复编号 */
  duplicateIds: string[];
  /** evidence 里引用了但没写进 consulted 的文件（§6.5 末句要求） */
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

  const consulted = new Set(review.consulted ?? []);
  const pathRe = /\b((?:src|lib|app|test|tests|doc|docs|packages|scripts)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b/g;
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
