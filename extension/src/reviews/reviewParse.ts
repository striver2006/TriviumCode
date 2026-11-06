/**
 * review.v2 审查正本解析（FR-6a 数据面，r2 计划 D1′）。
 *
 * 消费 `.reviews/<主题>/<阶段>/_meta/review-<critic>-<runId>.json`：
 * - 文件名解析出 critic/runId（不匹配命名模式 → unrecognized，不出意见）；
 * - 逐文件降级：JSON 坏 → parse-error；schema 非 v2 → unsupported-schema（携带实际串）；
 * - finding 级容错：单条缺必填字段/枚举外值 → 跳过并计数（不整份丢弃）；
 * - 全部状态进 ReviewFileStatus，供驾驶舱与历史树共同消费（CLAUDE-06）。
 *
 * 纯函数模块：不 import vscode，readFile 由调用方注入。
 */
import { checkSchema } from '../env/versionCheck';

/** review.v2 契约的 severity 四档 */
export type FindingSeverity = 'blocker' | 'major' | 'minor' | 'nit';
/** review.v2 契约的 verdict 三档 */
export type ReviewVerdict = 'pass' | 'pass-after-changes' | 'reject';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  layer: string;
  kind: string;
  location: string;
  problem: string;
  evidence: string;
  suggestion: string;
  confidence: string;
}

/** 逐文件状态（CLAUDE-06：贯穿驾驶舱与历史树的降级可见性） */
export interface ReviewFileStatus {
  critic: string;
  runId: string;
  state: 'ok' | 'partial-skipped' | 'parse-error' | 'unsupported-schema' | 'unrecognized';
  /** 实际读到的 schema 串（parse-error 时为 null） */
  actualSchema: string | null;
  /** 被跳过的 finding 条数（仅 partial-skipped） */
  skippedCount: number;
  /** 可读的降级原因（UI 直接展示） */
  notice: string | null;
}

export interface ParsedReview {
  status: ReviewFileStatus;
  verdict: ReviewVerdict | null;
  summary: string | null;
  findings: ReviewFinding[];
  agreed: string[];
  notCovered: string[];
  consulted: string[];
}

const SEVERITIES: readonly string[] = ['blocker', 'major', 'minor', 'nit'];
/** review.v2 契约的 layer/kind/confidence 枚举（CLAUDE-10：表外值同样计入跳过） */
const LAYERS: readonly string[] = ['requirement', 'plan', 'code', 'rca'];
const KINDS: readonly string[] = ['correctness', 'security', 'concurrency', 'contract', 'test-gap', 'maintainability', 'scope-drift', 'performance'];
const CONFIDENCES: readonly string[] = ['high', 'medium', 'low'];
const VERDICTS: readonly string[] = ['pass', 'pass-after-changes', 'reject'];

/** `review-<critic>-<runId>.json` 文件名解析；不匹配返回 null */
export function parseReviewFileName(name: string): { critic: string; runId: string } | null {
  const m = /^review-([A-Za-z0-9_]+)-(\d{8}T\d{6}Z)\.json$/.exec(name);
  return m ? { critic: m[1]!, runId: m[2]! } : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function statusOf(critic: string, runId: string, state: ReviewFileStatus['state'], actualSchema: string | null, skippedCount: number, notice: string | null): ParsedReview {
  return { status: { critic, runId, state, actualSchema, skippedCount, notice }, verdict: null, summary: null, findings: [], agreed: [], notCovered: [], consulted: [] };
}

/**
 * 解析一份审查正本。任何降级路径都不抛异常：坏输入返回带状态的空意见。
 */
export function parseReviewFile(fileName: string, text: string): ParsedReview {
  const ident = parseReviewFileName(fileName);
  if (!ident) {
    return statusOf('', '', 'unrecognized', null, 0, `文件名不匹配 review-<审查者>-<runId>.json：${fileName}`);
  }
  const { critic, runId } = ident;

  let obj: unknown;
  try {
    obj = JSON.parse(text) as unknown;
  } catch (e) {
    return statusOf(critic, runId, 'parse-error', null, 0, `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return statusOf(critic, runId, 'parse-error', null, 0, '根元素不是对象');
  }
  const root = obj as Record<string, unknown>;
  const actualSchema = isNonEmptyString(root['schema']) ? root['schema'] : null;

  const verdict = checkSchema(actualSchema, 'review');
  if (verdict.kind !== 'ok') {
    return statusOf(critic, runId, 'unsupported-schema', actualSchema, 0, `该侧工件版本不支持（${verdict.reason}），未展示意见`);
  }

  // 根字段校验（CLAUDE-06）：findings 数组 / verdict / summary 损坏 → 整件 parse-error 明示，
  // 不静默当空意见展示
  const rootProblems: string[] = [];
  if (!Array.isArray(root['findings'])) rootProblems.push('findings 缺失或非数组');
  if (!VERDICTS.includes(root['verdict'] as string)) rootProblems.push('verdict 缺失或表外');
  if (!isNonEmptyString(root['summary'])) rootProblems.push('summary 缺失');
  if (rootProblems.length > 0) {
    return statusOf(critic, runId, 'parse-error', actualSchema, 0, `根字段损坏：${rootProblems.join('；')}`);
  }

  const findingsRaw = Array.isArray(root['findings']) ? root['findings'] : [];
  const findings: ReviewFinding[] = [];
  let skipped = 0;
  for (const item of findingsRaw) {
    if (typeof item !== 'object' || item === null) {
      skipped++;
      continue;
    }
    const f = item as Record<string, unknown>;
    const required: Array<keyof ReviewFinding> = ['id', 'severity', 'layer', 'kind', 'location', 'problem', 'evidence', 'suggestion', 'confidence'];
    const missing = required.filter((k) => !isNonEmptyString(f[k]));
    if (missing.length > 0) {
      skipped++;
      continue;
    }
    // 枚举校验：severity/layer/kind/confidence 表外值跳过（review.v2 契约，CLAUDE-10）
    if (
      !SEVERITIES.includes(f['severity'] as string) ||
      !LAYERS.includes(f['layer'] as string) ||
      !KINDS.includes(f['kind'] as string) ||
      !CONFIDENCES.includes(f['confidence'] as string)
    ) {
      skipped++;
      continue;
    }
    findings.push({
      id: f['id'] as string,
      severity: f['severity'] as FindingSeverity,
      layer: f['layer'] as string,
      kind: f['kind'] as string,
      location: f['location'] as string,
      problem: f['problem'] as string,
      evidence: f['evidence'] as string,
      suggestion: f['suggestion'] as string,
      confidence: String(f['confidence']),
    });
  }

  const out = statusOf(critic, runId, skipped > 0 ? 'partial-skipped' : 'ok', actualSchema, skipped, skipped > 0 ? `${skipped} 条意见缺必填字段或枚举外值，已跳过` : null);
  out.findings = findings;
  out.verdict = VERDICTS.includes(root['verdict'] as string) ? (root['verdict'] as ReviewVerdict) : null;
  out.summary = isNonEmptyString(root['summary']) ? root['summary'] : null;
  out.agreed = Array.isArray(root['agreed']) ? root['agreed'].filter(isNonEmptyString) : [];
  out.notCovered = Array.isArray(root['not_covered']) ? root['not_covered'].filter(isNonEmptyString) : [];
  out.consulted = Array.isArray(root['consulted']) ? root['consulted'].filter(isNonEmptyString) : [];
  return out;
}

/** severity → 中文标签（UI 徽标用） */
export function severityLabel(s: FindingSeverity): string {
  return { blocker: '阻断', major: '重要', minor: '次要', nit: '微瑕' }[s];
}

/** verdict → 中文标签 */
export function verdictLabel(v: ReviewVerdict | null): string {
  if (v === 'pass') return '通过';
  if (v === 'pass-after-changes') return '修改后通过';
  if (v === 'reject') return '不通过';
  return '未知';
}

/** 一组解析件的 severity 计数（findingsSummary / 历史树统计用） */
export function countSeverities(reviews: ParsedReview[]): Record<FindingSeverity, number> {
  const out: Record<FindingSeverity, number> = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const r of reviews) for (const f of r.findings) out[f.severity]++;
  return out;
}
