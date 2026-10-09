/**
 * `parse`：把 Agent 的自由文本回答变成经 schema 校验的 `Review`（设计 §6.5 / AD-08）。
 *
 * 降级策略（AD-08 / §6.5 / §12.1），两档：
 *   - **逐条降级**：根对象拿得到、根字段合法、`findings` 是数组，只是个别意见不合 schema——
 *     只把那几条降级（保留原编号、逐条进裁决、不参与阻断与共同阻断），合格意见照常；
 *   - **整份回退**：连根对象都拿不到（没有 JSON 对象、语法修不好、根字段不合、有意见编号不可用）——
 *     该侧标 `parse_fallback`，原文保留、**不参与阻断判定**，裁决件按 `<前缀>-F<n>` 逐条应答（§6.6 规则 8）。
 * 校验之前做两类无损修复并留痕：剥厂商注入与编排器回显的根字段；还原字符串里的非法转义。
 *
 * schema 通过 `resolveJsonModule` 内联进打包产物，运行期零 `node_modules`（AD-12）。
 */
// 必须用 Ajv2020：schema 声明的是 draft 2020-12，而 ajv 的默认入口只带 draft-07
// 的元 schema，用它会报 no schema with key or ref "…/draft/2020-12/schema"。
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import reviewSchema from '../../skills/dual-critic/schema/review.v1.json' with { type: 'json' };
import type { CriticId, DegradedFinding, FallbackCause, ParseRepairs, Review } from './types.js';
import { CRITIC_PREFIX } from './types.js';

/**
 * 解析结果（设计 §6.5「解析与降级」）。
 *
 * - 成功：`review` 只含**合格**意见；`degraded` 是逐条降级的意见（根合法、这一条不合 schema），
 *   合格时为 `[]`；`repairs` 是**所选候选**在校验前做过的无损修复。
 * - 失败：整份回退，`cause` 说明走到了哪一步（没有 JSON 对象 / 语法修不好 / 根字段不合 / 有意见编号不可用）。
 */
export type ParseOutcome =
  | {
      ok: true;
      review: Review;
      extractedFrom: 'whole' | 'fence' | 'braces';
      degraded: DegradedFinding[];
      repairs: ParseRepairs;
    }
  | { ok: false; cause: Exclude<FallbackCause, 'foreign_prefix'>; reason: string; errors: string[]; rawText: string };

let cachedValidators: { full: ValidateFunction<Review>; item: ValidateFunction } | undefined;

/**
 * 整份与单条两个校验器，**同一个 ajv 实例、同一份 `review.v1.json`**——单条那个取自
 * `properties.findings.items`，不在代码里抄第二份意见 schema。
 */
function getValidators(): { full: ValidateFunction<Review>; item: ValidateFunction } {
  if (cachedValidators) return cachedValidators;
  // allErrors：一次把所有问题告诉模型，重试时才能一次改对（§12.3 只重试一次）
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = reviewSchema as { properties: { findings: { items: object } } };
  cachedValidators = {
    full: ajv.compile<Review>(reviewSchema as object),
    item: ajv.compile(schema.properties.findings.items),
  };
  return cachedValidators;
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
export const VENDOR_NOISE_KEYS = ['toolAction', 'toolSummary'] as const;

/**
 * 编排器**自己会写进审查文档 front-matter** 的键（`render.ts` 的 `renderFrontMatter`，含全部条件分支），
 * 减去 `review.v1` 的根属性（`schema` / `verdict` 与 schema 同名同义，不剥）。
 *
 * 审查员照着落盘文档的形态反推、以为结论 JSON 也该带这些键（EV-10：glm 侧反复带
 * `topic` / `stage` / `role` / `run_id` / `rerun_index` / `evidence_ok`），撞 `additionalProperties: false`
 * 整份判死。它们的值编排器自己会写，审查员填的值没有任何消费方——剥掉是无损的，剥了什么进 `repairs` 留痕。
 *
 * **清单的判据是「编排器自己会写的」这一条可核的事实**，不是「样本里见过的」：后者会漏掉同族的其余键，
 * 下一次换一个键又整份回退。`reviewer` / `addresses` 之类不在 front-matter 里的键不剥，拼错的键
 * （`toppic`）也不剥——两者都照旧撞 `additionalProperties: false`，那层「字段名写错能被发现」的保护不丢。
 *
 * 与 `renderFrontMatter` 由契约用例**逐项相等**绑定（`parse-degrade.test.ts` 的 P9 与 P9′）：P9 比全开渲染的键集，
 * P9′ 从 `render.ts` 源码静态枚举键集（新条件键而夹具没跟时 P9 会假绿，P9′ 不会；代码双审 r1 CODEX-02）。
 * front-matter 加键而这里没跟，当场红。这两条断言不许放宽成子集——它们是这份清单的机械守卫。
 */
export const ECHOED_ORCHESTRATOR_KEYS: readonly string[] = [
  'topic', 'stage', 'role', 'vendor', 'agent_cli', 'model_requested', 'model_effective', 'model_effective_source',
  'access', 'family_comparisons',
  'effort', 'effort_requested', 'effort_effective', 'effort_effective_source', 'tier', 'tier_source',
  'model_route', 'run_id', 'rerun_index', 'snapshot_hash', 'blind', 'started_at', 'finished_at',
  'duration_s', 'tool_calls', 'evidence_ok', 'findings_count', 'findings_degraded', 'degraded', 'parse_fallback',
  'parse_fallback_cause', 'parse_repairs', 'peer_deny', 'drift', 'consulted_unverified', 'readonly_verification',
  'path_verification', 'evidence_untrusted', 'peer_leak', 'joint_check', 'heterogeneous', 'override_reason', 'session_id',
];

/** 剥掉厂商注入与编排器回显的根字段。返回剥到的键（厂商在前，各按清单顺序） */
function stripKnownRootKeys(obj: Record<string, unknown>): { cleaned: Record<string, unknown>; stripped: string[] } {
  const stripped: string[] = [];
  const cleaned = { ...obj };
  for (const k of [...VENDOR_NOISE_KEYS, ...ECHOED_ORCHESTRATOR_KEYS]) {
    if (Object.prototype.hasOwnProperty.call(cleaned, k)) {
      delete cleaned[k];
      stripped.push(k);
    }
  }
  return { cleaned, stripped };
}

/**
 * 把 JSON 字符串字面量里的**非法转义**按字面还原：反斜杠后跟的不是 `" \ / b f n r t` 之一、
 * 也不是 `u` 加恰好四位十六进制时，把这个反斜杠自身转义（值里保留字面的反斜杠与后随字符）。
 *
 * 实测形态是 Markdown 的竖线转义（反斜杠 + `|`）与 Windows 路径（反斜杠 + `users`）：审查员要表达的
 * 就是字面字符，JSON 不认这种转义。**只动字符串内部**，结构字符一概不碰；调用方只在 `JSON.parse`
 * 失败时才调它，修后仍失败照旧按语法错回退——缺逗号、缺括号这类要猜结构的错误不在这里修。
 */
export function repairInvalidEscapes(json: string): { text: string; count: number } {
  let out = '';
  let inStr = false;
  let count = 0;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      const next = json[i + 1];
      if (next !== undefined && '"\\/bfnrt'.includes(next)) {
        out += ch + next;
        i++;
        continue;
      }
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))) {
        out += json.slice(i, i + 6);
        i += 5;
        continue;
      }
      out += '\\\\';
      count++;
      continue;
    }
    if (ch === '"') inStr = false;
    out += ch;
  }
  return { text: out, count };
}

/** 单条意见的全部字段名，取自 schema 本身（渲染「不合格意见」时区分多余字段用） */
export const FINDING_FIELDS: readonly string[] = Object.keys(
  (reviewSchema as { properties: { findings: { items: { properties: Record<string, unknown> } } } })
    .properties.findings.items.properties,
);

/** 意见编号的形状判据，取自 schema 本身（不抄第二份） */
const FINDING_ID_RE = new RegExp(
  (reviewSchema as { properties: { findings: { items: { properties: { id: { pattern: string } } } } } })
    .properties.findings.items.properties.id.pattern,
);

/** ajv 对单条意见的报错 → 逐字段问题（缺失 / 不合法 / 多余） */
function problemsOf(errors: readonly ErrorObject[] | null | undefined): DegradedFinding['problems'] {
  const out: DegradedFinding['problems'] = [];
  for (const e of errors ?? []) {
    const message = formatSchemaErrors([e])[0]!;
    const params = e.params as { missingProperty?: string; additionalProperty?: string };
    if (e.keyword === 'required' && params.missingProperty) {
      out.push({ field: params.missingProperty, kind: 'missing', message });
    } else if (e.keyword === 'additionalProperties' && params.additionalProperty) {
      out.push({ field: params.additionalProperty, kind: 'extra', message });
    } else {
      out.push({ field: e.instancePath.split('/')[1] || '(意见本身)', kind: 'invalid', message });
    }
  }
  return out;
}

/** 单个候选走到哪一步。`rank` 越大走得越远，整份回退时取走得最远的那一格报成因 */
type CandidateVerdict =
  | { stage: 'fail'; rank: 1 | 2 | 3; cause: 'json_syntax' | 'root_invalid' | 'finding_unaddressable'; reason: string; errors: string[] }
  | { stage: 'skip' }
  | {
      stage: 'ok';
      review: Review;
      degraded: DegradedFinding[];
      repairs: ParseRepairs;
      /** 本候选的全部编号（合格 ∪ 降级），供「覆盖才替换」 */
      ids: string[];
    };

function evaluateCandidate(json: string): CandidateVerdict {
  const { full, item } = getValidators();

  // ① 语法；失败才试还原非法转义
  let obj: unknown;
  let unescaped = 0;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    const original = (e as Error).message;
    const rep = repairInvalidEscapes(json);
    if (rep.count === 0) return { stage: 'fail', rank: 1, cause: 'json_syntax', reason: `JSON 语法错误：${original}`, errors: [] };
    try {
      obj = JSON.parse(rep.text);
      unescaped = rep.count;
    } catch {
      return {
        stage: 'fail', rank: 1, cause: 'json_syntax',
        reason: `JSON 语法错误：${original}`,
        errors: [`已按字面还原 ${rep.count} 处非法转义，仍无法解析`],
      };
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return { stage: 'skip' };

  // ② 剥厂商注入与编排器回显
  const { cleaned, stripped } = stripKnownRootKeys(obj as Record<string, unknown>);
  const repairs: ParseRepairs = { stripped_fields: stripped, unescaped_backslashes: unescaped };

  // ③ 整份合格
  if (full(cleaned)) {
    const review = cleaned as unknown as Review;
    return { stage: 'ok', review, degraded: [], repairs, ids: review.findings.map((f) => f.id) };
  }

  // ④ 根：findings 是数组，且把它换成 [] 后整份合格
  const findings = cleaned['findings'];
  const rootOk = full({ ...cleaned, findings: [] });
  if (!Array.isArray(findings) || !rootOk) {
    const errors = [
      ...(Array.isArray(findings) ? [] : ['/findings 不是数组']),
      ...(rootOk ? [] : formatSchemaErrors(full.errors)),
    ];
    return { stage: 'fail', rank: 2, cause: 'root_invalid', reason: 'JSON 根对象不符合 trivium.review.v1', errors };
  }

  // ⑤ 逐条：合格的留在 review 里，不合格的降级；降级意见的编号必须可用
  const qualified: unknown[] = [];
  const degraded: DegradedFinding[] = [];
  const unaddressable: string[] = [];
  findings.forEach((f, index) => {
    if (item(f)) {
      qualified.push(f);
      return;
    }
    const problems = problemsOf(item.errors);
    const isObj = typeof f === 'object' && f !== null && !Array.isArray(f);
    const id = isObj ? (f as Record<string, unknown>)['id'] : undefined;
    if (!isObj || typeof id !== 'string' || !FINDING_ID_RE.test(id)) {
      unaddressable.push(`/findings/${index} 编号不可用（${isObj ? `id=${JSON.stringify(id)}` : '不是对象'}）`);
      return;
    }
    degraded.push({ index, id, problems, raw: f as Record<string, unknown> });
  });
  if (unaddressable.length > 0) {
    return {
      stage: 'fail', rank: 3, cause: 'finding_unaddressable',
      reason: 'JSON 不符合 trivium.review.v1：有意见的编号不可用，无法逐条降级',
      errors: unaddressable,
    };
  }
  const review = { ...cleaned, findings: qualified } as unknown as Review;
  return {
    stage: 'ok', review, degraded, repairs,
    ids: [...review.findings.map((f) => f.id), ...degraded.map((d) => d.id)],
  };
}

/**
 * 解析并校验审查结论（设计 §6.5「解析与降级」）。
 *
 * 逐候选：语法（失败才试还原非法转义）→ 剥厂商与回显根字段 → 整份校验 → 根校验 → 逐条校验。
 *
 * **选取——覆盖才替换**（计划双审 r1 CODEX-01）：
 *   - 首个根合格的候选（全合格或部分合格）为**默认**；它全合格就立即返回；
 *   - 默认是部分合格时继续看：后面的**全合格**候选只在编号集**覆盖默认候选的全部编号**（合格 ∪ 降级）
 *     时才替换它——那是 agy「同一份结论重发一次、这次写对了」的形态（`extractJsonCandidates` 的注释）；
 *   - 其余一律不替换。一份排在后面、意见更少的全合格对象（草稿、示例、截短的副本）不能顶掉前面那份
 *     结论：被顶掉的合格意见与降级意见会一起静默消失，而降级意见同样要逐条裁决。
 *
 * 不是「取最后一个」：那会让厂商在结论之后追加的任何东西顶掉真正的结论。
 *
 * `repairs` 与 `degraded` **只随所选候选**（计划双审 r1 GLM-03）；未入选候选的修复不留痕。
 * 一个根合格候选都没有时整份回退，成因取**走得最远**的那一格（编号不可用 > 根不合 > 语法错 >
 * 没有 JSON 对象）——改前取的是最后一个候选的错误，逐行候选常把更有信息量的围栏候选盖掉。
 */
export function parseReview(text: string): ParseOutcome {
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) {
    return { ok: false, cause: 'no_json_object', reason: '回答中找不到 JSON 对象', errors: [], rawText: text };
  }

  let chosen: (Extract<CandidateVerdict, { stage: 'ok' }> & { from: JsonCandidate['from'] }) | null = null;
  let deepest: Extract<CandidateVerdict, { stage: 'fail' }> | null = null;

  for (const cand of candidates) {
    const v = evaluateCandidate(cand.json);
    if (v.stage === 'skip') continue;
    if (v.stage === 'fail') {
      if (!deepest || v.rank > deepest.rank) deepest = v;
      continue;
    }
    if (!chosen) {
      chosen = { ...v, from: cand.from };
      if (v.degraded.length === 0) break;
      continue;
    }
    if (v.degraded.length === 0) {
      const mine = new Set(v.ids);
      if (chosen.ids.every((id) => mine.has(id))) {
        chosen = { ...v, from: cand.from };
        break;
      }
    }
  }

  if (chosen) {
    return { ok: true, review: chosen.review, extractedFrom: chosen.from, degraded: chosen.degraded, repairs: chosen.repairs };
  }
  if (!deepest) {
    return { ok: false, cause: 'no_json_object', reason: '回答中找不到可用的 JSON 对象', errors: [], rawText: text };
  }
  return { ok: false, cause: deepest.cause, reason: deepest.reason, errors: deepest.errors, rawText: text };
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
export function checkReviewIntegrity(
  review: Review,
  critic: CriticId,
  /**
   * 逐条降级的意见（`parseReview` 的 `degraded`，取 `id` 与原值 `raw`）。**必填、无默认值**（计划双审 r1 GLM-01）：
   * 漏传会让前缀归属与撞号检查静默退回只看合格编号——异前缀的降级编号就以「可裁决」身份进期望集，
   * review.ts 前缀硬失败那段注释论证的冒名 / 死锁后果对降级编号同样成立。没有降级意见就传 `[]`。
   * evidence-consulted 核对同样并入它们（代码双审 r1 GLM-01）：缺 `confidence` 而降级的意见 evidence 完好，
   * 照样要逐条裁决，§6.5 末句「evidence 引用的文件必须出现在 consulted」对它同样成立。
   */
  degraded: readonly Pick<DegradedFinding, 'id' | 'raw'>[],
): ReviewIntegrity {
  const prefix = `${CRITIC_PREFIX[critic]}-`;
  const allIds = [...review.findings.map((f) => f.id), ...degraded.map((d) => d.id)];
  const badIds = allIds.filter((id) => !id.startsWith(prefix));

  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of allIds) {
    if (seen.has(id)) duplicateIds.push(id);
    seen.add(id);
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
  const evidences = [
    ...review.findings.map((f) => f.evidence),
    ...degraded.map((d) => d.raw['evidence']).filter((e): e is string => typeof e === 'string'),
  ];
  for (const evidence of evidences) {
    pathRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(evidence)) !== null) {
      const p = m[1]!;
      if (!consulted.has(p)) missing.add(p);
    }
  }

  // 交了意见、只是全部降级的一侧不是「空结论」
  const emptyWithoutExplanation =
    review.findings.length === 0 &&
    degraded.length === 0 &&
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
 *
 * **对象拿得到时按意见逐条出单元**（解析回退逐条降级代码双审 r1 CODEX-01）：整份回退的成因里，
 * `root_invalid` / `finding_unaddressable` / `foreign_prefix` 三种都已解析出根对象与 `findings` 数组，
 * 只是它不合格。按散文边界切的话，一个 JSON 对象里没有空行、列表或标题，整侧意见塌成**一个**
 * F 单元——正是「逐条」要消灭的形态。这时每条意见一个单元（正文是那一条的原文），无损。
 * 拿不到对象（`no_json_object`、语法修不好）时照旧按原文段落切。
 */
export function enumerateFallbackFindings(rawText: string, critic: CriticId): string[] {
  const prefix = CRITIC_PREFIX[critic];
  const blocks =
    findingsOfFirstObject(rawText) ??
    rawText
      .split(/\n\s*(?:\n|(?=[-*]\s)|(?=\d+[.)]\s)|(?=#{1,6}\s))/)
      .map((b) => b.trim())
      .filter((b) => b.length >= 20);
  return blocks.map((b, i) => `${prefix}-F${String(i + 1).padStart(2, '0')}: ${b}`);
}

/** 首个根为对象、`findings` 为非空数组的候选（语法与 `parseReview` 同口径：失败才试还原非法转义），逐条序列化 */
function findingsOfFirstObject(rawText: string): string[] | null {
  for (const cand of extractJsonCandidates(rawText)) {
    let obj: unknown;
    try {
      obj = JSON.parse(cand.json);
    } catch {
      const rep = repairInvalidEscapes(cand.json);
      if (rep.count === 0) continue;
      try {
        obj = JSON.parse(rep.text);
      } catch {
        continue;
      }
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) continue;
    const findings = (obj as Record<string, unknown>)['findings'];
    if (!Array.isArray(findings) || findings.length === 0) continue;
    return findings.map((f) => (typeof f === 'string' ? f : JSON.stringify(f)));
  }
  return null;
}
