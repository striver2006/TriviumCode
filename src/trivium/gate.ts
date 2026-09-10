/**
 * `gate`：闸门状态机与裁决完整性校验（设计 §8.4 / §8.6）。
 *
 * §8.6 的算法是六项硬失败 + 两项默认 warning。按修订计划 §2.2（意见 AGY-04）
 * 补上**校验集合的拆分顺序**：先滤除 `parse_fallback` 的虚拟编号再做差集，
 * 否则那些合法的 `<前缀>-F<n>` 会被判成「多余 id」；并显式支持 `findings: []`。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config, CriticId, Disposal, DispositionRow, Review, Stage } from './types.js';
import { isFallbackId, parseDisposition, type ParsedDisposition } from './disposition.js';
import { listStageArtifacts, metaDir, type ArchiveLayout } from './archive.js';
import { dispositionKindForStage } from './naming.js';
import { parseFrontMatter } from './render.js';
import { parseReview } from './parse.js';

// ─────────────────────── 校验结果 ───────────────────────

export type GateFailureCode =
  | 'missing_disposition'
  | 'bad_front_matter'
  | 'unparsable_table'
  | 'missing_findings'
  | 'unknown_findings'
  | 'bad_verdict'
  | 'defer_not_allowed'
  | 'empty_reason'
  | 'missing_action'
  | 'joint_blocker_rejected';

export interface GateFailure {
  code: GateFailureCode;
  message: string;
  /** 相关意见编号，供 Driver 直接定位修补 */
  ids?: string[];
  line?: number;
}

export interface GateWarning {
  code: 'weak_reason' | 'joint_blocker_rejected' | 'parse_problem';
  message: string;
  ids?: string[];
}

export interface GateCheckResult {
  ok: boolean;
  failures: GateFailure[];
  warnings: GateWarning[];
  /** 本轮涉及的意见编号（结构化 + fallback） */
  structuredIds: string[];
  fallbackIds: string[];
  dispositionPath: string | null;
  rows: DispositionRow[];
}

/** 空洞理由词表（§6.6 规则 5）。命中且无其它内容才算空洞 */
const HOLLOW_PATTERNS = [
  /^无需修改$/, /^不适用$/, /^已知悉$/, /^没问题$/, /^不需要$/, /^ok$/i, /^n\/?a$/i,
];

export function isHollowReason(reason: string): boolean {
  const r = reason.replace(/[。.，,；;、\s]/g, '');
  if (r.length === 0) return false; // 空理由由 empty_reason 单独管
  return HOLLOW_PATTERNS.some((p) => p.test(r));
}

// ─────────────────────── 核心算法（§8.6） ───────────────────────

export interface GateCheckInput {
  cfg: Config;
  layout: ArchiveLayout;
  stage: Stage;
  rerunIndex: number;
  /** 本轮两侧的结构化结论。parse_fallback 侧传 null */
  reviews: Partial<Record<CriticId, Review | null>>;
  /** 单审降级时缺失的一侧，需已在 run 元数据标记 */
  degraded: boolean;
}

export async function checkAdjudication(input: GateCheckInput): Promise<GateCheckResult> {
  const { cfg, layout, stage, rerunIndex, reviews } = input;
  const failures: GateFailure[] = [];
  const warnings: GateWarning[] = [];

  // 第 1 步：收集本轮结构化意见编号
  const structuredIds: string[] = [];
  for (const c of Object.keys(reviews) as CriticId[]) {
    for (const f of reviews[c]?.findings ?? []) structuredIds.push(f.id);
  }

  // 第 2 步：定位本轮裁决件
  const kind = dispositionKindForStage(stage);
  const items = await listStageArtifacts(layout, stage);
  const hit = items.find(
    (i) => i.parsed.role === 'claude' && i.parsed.kind === kind && i.parsed.rerunIndex === rerunIndex,
  );
  if (!hit) {
    return {
      ok: false,
      failures: [
        {
          code: 'missing_disposition',
          message:
            `找不到第 ${rerunIndex} 轮的裁决件（应为 …-${rerunIndex > 1 ? `r${rerunIndex}-` : ''}${kind}-claude.md）。` +
            `${stage === 'code' ? '代码审' : '计划/根因审'}必须产出裁决件，即使全部驳回也要写明「无修改及原因」（§6.6 规则 6）。`,
        },
      ],
      warnings,
      structuredIds,
      fallbackIds: [],
      dispositionPath: null,
      rows: [],
    };
  }
  const dispositionPath = path.join(layout.archiveRoot, layout.topic, stage, hit.fileName);
  const md = await fs.readFile(dispositionPath, 'utf8');
  const parsed: ParsedDisposition = parseDisposition(md);

  // 第 3 步：front-matter 必须与本轮匹配
  const fm = parsed.frontMatter;
  if (!fm) {
    failures.push({ code: 'bad_front_matter', message: '裁决件缺少可解析的 front-matter' });
  } else {
    const mismatches: string[] = [];
    if (fm.schema !== 'trivium.disposition.v1') mismatches.push(`schema=${fm.schema}`);
    if (fm.topic !== layout.topic) mismatches.push(`topic=${fm.topic}（应为 ${layout.topic}）`);
    if (fm.stage !== stage) mismatches.push(`stage=${fm.stage}（应为 ${stage}）`);
    if (fm.kind !== kind) mismatches.push(`kind=${fm.kind}（${stage} 阶段应为 ${kind}）`);
    if (!Array.isArray(fm.addresses) || fm.addresses.length === 0) {
      mismatches.push('addresses 为空（必须列出本件应答的审查文档）');
    }
    if (mismatches.length > 0) {
      failures.push({
        code: 'bad_front_matter',
        message: `裁决件 front-matter 与本轮不匹配：${mismatches.join('；')}`,
      });
    }
  }

  for (const p of parsed.problems) {
    warnings.push({ code: 'parse_problem', message: `第 ${p.line} 行：${p.message}` });
  }
  if (parsed.rows.length === 0) {
    // 结构化意见为空时，空表是合法的（双侧都无意见）
    if (structuredIds.length > 0) {
      failures.push({
        code: 'unparsable_table',
        message:
          '裁决表为空或无法解析，但两侧共有 ' + structuredIds.length + ' 条意见需要裁决。' +
          parsed.problems.map((p) => `\n    第 ${p.line} 行：${p.message}`).join(''),
      });
    }
  }

  // 第 4 步：映射 DEC，并**先拆分** fallback 虚拟编号（AGY-04）
  const rows = parsed.rows;
  const fallbackRows = rows.filter((r) => isFallbackId(r.id));
  const structuredRows = rows.filter((r) => !isFallbackId(r.id));
  const fallbackIds = fallbackRows.map((r) => r.id);

  const decKeys = new Set(structuredRows.map((r) => r.id));
  const idsSet = new Set(structuredIds);

  // 第 5 步 a：缺裁决
  const missing = [...idsSet].filter((id) => !decKeys.has(id)).sort();
  if (missing.length > 0) {
    failures.push({
      code: 'missing_findings',
      message: `下列意见没有裁决，必须逐条给出（禁止静默忽略，FR-14）`,
      ids: missing,
    });
  }
  // 第 5 步 b：多余裁决——fallback 编号已在上一步拆出，不会误判
  const unknown = [...decKeys].filter((id) => !idsSet.has(id)).sort();
  if (unknown.length > 0) {
    failures.push({
      code: 'unknown_findings',
      message: '下列编号不在本轮两侧的审查结论中，请核对是否抄错或跨轮次混用',
      ids: unknown,
    });
  }

  // 第 5 步 c/d/e/f：逐行语义校验（结构化行与 fallback 行都要过 e，f 只对结构化行）
  const emptyReason: string[] = [];
  const weakReason: string[] = [];
  const deferNotAllowed: string[] = [];
  const missingAction: string[] = [];

  const checkRow = (r: DispositionRow, requireAction: boolean) => {
    if (r.reason.length === 0) emptyReason.push(r.id);
    else if (isHollowReason(r.reason)) weakReason.push(r.id);
    if (r.disposal === '暂缓' && !cfg.gate.allow_defer) deferNotAllowed.push(r.id);
    if (requireAction && r.disposal === '接受' && r.action.length === 0) missingAction.push(r.id);
  };
  for (const r of structuredRows) checkRow(r, true);
  // fallback 侧只校验「有裁决与理由」（§6.6 规则 8），不要求落点
  for (const r of fallbackRows) checkRow(r, false);

  if (emptyReason.length > 0) {
    failures.push({
      code: 'empty_reason',
      message: '下列意见的裁决没有写理由。三种裁决都必须有非空理由（§6.6 规则 3）',
      ids: emptyReason.sort(),
    });
  }
  if (deferNotAllowed.length > 0) {
    failures.push({
      code: 'defer_not_allowed',
      message: '当前配置 gate.allow_defer=false，不接受「暂缓」',
      ids: deferNotAllowed.sort(),
    });
  }
  if (missingAction.length > 0) {
    failures.push({
      code: 'missing_action',
      message:
        '下列意见被「接受」但没有写落点。接受必须指向具体去处' +
        `（${stage === 'code' ? '文件或修改计划' : '修订件章节'}，§6.6 规则 4）`,
      ids: missingAction.sort(),
    });
  }
  if (weakReason.length > 0) {
    const msg = `下列意见的理由只有空洞措辞：${weakReason.sort().join(', ')}`;
    if (cfg.gate.reason_policy === 'hard') {
      failures.push({ code: 'empty_reason', message: msg, ids: weakReason.sort() });
    } else {
      warnings.push({ code: 'weak_reason', message: msg, ids: weakReason.sort() });
    }
  }

  // 第 5 步 g：双方共同 blocker 被驳回
  const joint = findJointRejectedBlockers(reviews, structuredRows);
  if (joint.length > 0) {
    const msg =
      '下列 blocker 被**双方**同时提出却被驳回：' +
      joint.map((j) => `${j.ids.join('+')}@${j.location}`).join('；');
    if (cfg.gate.joint_blocker_policy === 'hard') {
      failures.push({
        code: 'joint_blocker_rejected',
        message: msg,
        ids: joint.flatMap((j) => j.ids),
      });
    } else {
      warnings.push({
        code: 'joint_blocker_rejected',
        message: msg,
        ids: joint.flatMap((j) => j.ids),
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    structuredIds,
    fallbackIds,
    dispositionPath,
    rows,
  };
}

/**
 * 找出「双方都提的同一个 blocker 却被驳回」。
 *
 * 判定只用 `location` **精确相同**——设计 §6.6 规则 7 明确：相似度判定永远只到
 * warning，不能因启发式误判卡死闸门。因此这里不做文本相似度。
 */
export function findJointRejectedBlockers(
  reviews: Partial<Record<CriticId, Review | null>>,
  rows: readonly DispositionRow[],
): { location: string; ids: string[] }[] {
  const byLocation = new Map<string, { critic: CriticId; id: string }[]>();
  for (const c of Object.keys(reviews) as CriticId[]) {
    for (const f of reviews[c]?.findings ?? []) {
      if (f.severity !== 'blocker') continue;
      const key = f.location.trim();
      const list = byLocation.get(key) ?? [];
      list.push({ critic: c, id: f.id });
      byLocation.set(key, list);
    }
  }
  const rejected = new Set(rows.filter((r) => r.disposal === '驳回').map((r) => r.id));
  const out: { location: string; ids: string[] }[] = [];
  for (const [location, list] of byLocation) {
    const critics = new Set(list.map((x) => x.critic));
    if (critics.size < 2) continue; // 不是双方共同提的
    if (list.every((x) => rejected.has(x.id))) {
      out.push({ location, ids: list.map((x) => x.id) });
    }
  }
  return out;
}

/** 人读渲染：失败时要能让 Driver 直接照着补（§8.6 第 6 步） */
export function renderGateResult(r: GateCheckResult): string {
  const lines: string[] = [];
  if (r.ok) {
    lines.push(`✓ 裁决完整性校验通过（${r.rows.length} 条裁决，含 ${r.fallbackIds.length} 条降级编号）`);
  } else {
    lines.push(`✗ 裁决完整性校验未通过，共 ${r.failures.length} 项：`);
    for (const f of r.failures) {
      lines.push(`  [${f.code}] ${f.message}`);
      if (f.ids && f.ids.length > 0) lines.push(`      涉及：${f.ids.join(', ')}`);
    }
  }
  for (const w of r.warnings) {
    lines.push(`  ⚠️ [${w.code}] ${w.message}`);
  }
  return lines.join('\n');
}

// ─────────────────────── 读取本轮结构化结论 ───────────────────────

/**
 * 从归档 `_meta/` 读回本轮两侧的结构化结论。
 *
 * 对 `parse_fallback` 侧会用**当前**解析器重试一次原文。理由：解析降级往往是
 * 解析器一侧的缺陷（本项目就踩过一次——厂商往结构化输出注入了自己的字段，
 * 导致一份完全合格的结论被判死）。解析器修好后，重试能让既有归档追溯地变成机读的，
 * 而不必重跑一次双审。重试仍失败才按 fallback 语义处理。
 */
export async function loadRoundReviews(
  layout: ArchiveLayout,
  stage: Stage,
  runId: string,
): Promise<{ reviews: Partial<Record<CriticId, Review | null>>; notes: string[] }> {
  const reviews: Partial<Record<CriticId, Review | null>> = {};
  const notes: string[] = [];
  const dir = metaDir(layout, stage);

  for (const c of ['gemini', 'glm'] as CriticId[]) {
    const p = path.join(dir, `review-${c}-${runId}.json`);
    try {
      const raw = JSON.parse(await fs.readFile(p, 'utf8')) as
        | Review
        | { parse_fallback: true; raw: string | null };
      if ('parse_fallback' in raw && raw.parse_fallback) {
        const retry = raw.raw ? parseReview(raw.raw) : null;
        if (retry?.ok) {
          reviews[c] = retry.review;
          notes.push(
            `${c} 侧当时被判 parse_fallback，但用当前解析器重试成功（${retry.review.findings.length} 条意见）——` +
              '按结构化结论校验',
          );
        } else {
          reviews[c] = null;
          notes.push(`${c} 侧为 parse_fallback，其意见按 <前缀>-F<n> 编号校验`);
        }
      } else {
        reviews[c] = raw as Review;
      }
    } catch {
      // 该侧可能失败了（单审降级），或本轮没跑这一侧
      const failed = path.join(dir, `review-${c}-${runId}.failed.json`);
      if (await fileExists(failed)) {
        notes.push(`${c} 侧本轮失败，未产出结论（单审降级）`);
      } else {
        notes.push(`读不到 ${c} 侧的结构化结论：${path.relative(layout.archiveRoot, p)}`);
      }
    }
  }
  return { reviews, notes };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 从审查文档 front-matter 读回本轮的 run_id（`gate --check` 不必要求人传） */
export async function inferLatestRunId(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
): Promise<string | null> {
  const items = await listStageArtifacts(layout, stage);
  for (const i of items) {
    if (i.parsed.rerunIndex !== rerunIndex) continue;
    if (i.parsed.role === 'claude') continue;
    const p = path.join(layout.archiveRoot, layout.topic, stage, i.fileName);
    const fm = parseFrontMatter(await fs.readFile(p, 'utf8'));
    const runId = fm?.['run_id'];
    if (typeof runId === 'string') return runId;
  }
  return null;
}

export type { Disposal };
