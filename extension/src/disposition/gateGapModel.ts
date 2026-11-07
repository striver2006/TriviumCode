/**
 * gate 缺口 → 裁决台 UI 模型（FR-8，计划 r2 §D1；纯函数，不依赖 vscode）。
 *
 * 两形态（CLAUDE-07/CODEX-02：missing_disposition 提前返回时 fallback_ids 恒空、
 * 无 missing_findings，首写与修复必须分别建表）：
 * - 起草（draft）：disposition 为 null。待裁集 = structured_ids ∪ degraded_ids ∪
 *   fallback 期望集（由 runMeta 从 .fallback-items.md 读出，**不是** check.fallback_ids）。
 * - 修复（repair）：disposition 非 null。新增行 = missing_findings.ids；
 *   修复行 = empty_reason ∪ defer_not_allowed ∪ missing_action ∪ unknown_findings（删行）
 *   ∪ joint_blocker_rejected（hard 策略下的 failure）的 ids——这些行已在裁决表里，预填现有内容；
 *   只读行 = 期望集 − 新增 − 修复。
 */
import type { GateCheckOutput, GateWarningItem } from '../cli/commands';
import { criticOfId, isFallbackId, type RunMetaInfo } from './runMeta';

export type Verdict = '接受' | '驳回' | '暂缓';

/** 表单一行（新增或修复；渲染与草稿生成共用） */
export interface GapItem {
  id: string;
  critic: string | null;
  origin: 'structured' | 'degraded' | 'fallback';
  severity: string | null;
  /** 结构化行的接受项落点必填（missing_action 契约）；fallback 行可选（checkRow 第二参数） */
  requireAction: boolean;
  /** defer_not_allowed 命中 → 禁选暂缓 */
  deferAllowed: boolean;
  /** unknown_findings 命中 → 该行应从裁决表删除（代码审 r1 CLAUDE-02/AGY-01/CODEX-06） */
  removeable: boolean;
  /** 该行当前的失败原因（修复行有值：如「理由为空」） */
  problemNote: string | null;
  /** 修复行预填的现有内容（draft 形态为 null） */
  existing: { verdict: Verdict; reason: string; action: string } | null;
}

/** 修复形态下已合法、保留原文的行 */
export interface ReadonlyRow {
  id: string;
  verdict: Verdict;
  reason: string;
  action: string | null;
}

export interface StructuralGap {
  code: string;
  message: string;
}

export interface PlanGap {
  code: string;
  message: string;
  ids: string[];
}

export interface GapModel {
  form: 'draft' | 'repair';
  dispositionPath: string | null;
  topic: string;
  stage: string;
  runId: string;
  rerunIndex: number | null;
  driver: { driver: string; source: string } | null;
  addresses: string[];
  items: GapItem[];
  readonlyRows: ReadonlyRow[];
  structural: StructuralGap[];
  planGaps: PlanGap[];
  warnings: GateWarningItem[];
  roundLine: string | null;
  nextAction: string | null;
}

export interface ParsedDocRow {
  id: string;
  verdict: Verdict | null;
  reason: string;
  action: string | null;
}

export interface BuildGapInput {
  check: GateCheckOutput;
  topic: string;
  stage: string;
  meta: RunMetaInfo | null;
  /** runMeta.allFallbackIds 的产出（首写形态的 fallback 期望集） */
  fallbackExpected: string[];
  driver: { driver: string; source: string } | null;
  addresses: string[];
  /** 修复形态：现有裁决件的解析行（dispositionDraft.parseDispositionDoc.rows） */
  existingRows: ParsedDocRow[];
}

/** 各逐条类 failure code 的中文化说明（展示层，不改判语义） */
const FIX_NOTE: Record<string, string> = {
  empty_reason: '理由为空或被判空洞，需补写非空理由',
  defer_not_allowed: '该编号不允许暂缓（本轮策略），请改选接受/驳回',
  missing_action: '接受项缺少落点（修改计划）',
  unknown_findings: '编号不在本轮期望集，应从裁决表删除该行',
  joint_blocker_rejected: '两家共同提出的 blocker 被驳回（hard 策略），需复议或改判',
};

function verdictOf(v: string | null | undefined): Verdict | null {
  if (v === '接受' || v === '驳回' || v === '暂缓') return v;
  return null;
}

/** 一个编号的归属集合（新/修/只读）判定用中间结构 */
interface FixIds {
  newIds: Set<string>;
  fixIds: Map<string, string[]>; // id → 命中的 failure codes
}

function collectFixIds(check: GateCheckOutput): FixIds {
  const fixIds = new Map<string, string[]>();
  const newIds = new Set<string>();
  for (const f of check.failures) {
    if (!f.ids) continue;
    for (const id of f.ids) {
      if (f.code === 'missing_findings') {
        newIds.add(id);
        continue;
      }
      if (!(f.code in FIX_NOTE)) continue;
      const list = fixIds.get(id) ?? [];
      list.push(f.code);
      fixIds.set(id, list);
    }
  }
  return { newIds, fixIds };
}

function itemOf(
  id: string,
  origin: GapItem['origin'],
  fixCodes: string[],
  existingRows: ParsedDocRow[],
): GapItem {
  const existing = existingRows.find((r) => r.id === id);
  const verdict = existing?.verdict ?? null;
  return {
    id,
    critic: criticOfId(id),
    origin,
    severity: null, // 展示层从批注数据面取（cockpit 组装时回填）
    requireAction: !isFallbackId(id),
    deferAllowed: !fixCodes.includes('defer_not_allowed'),
    removeable: fixCodes.includes('unknown_findings'),
    problemNote: fixCodes.length > 0 ? fixCodes.map((c) => FIX_NOTE[c] ?? c).join('；') : null,
    existing:
      verdict !== null
        ? { verdict, reason: existing?.reason ?? '', action: existing?.action ?? '' }
        : null,
  };
}

export function buildGapModel(input: BuildGapInput): GapModel {
  const { check, existingRows } = input;
  const isRepair = check.disposition !== null;
  const { newIds, fixIds } = collectFixIds(check);
  const planGaps: PlanGap[] = [];
  const structural: StructuralGap[] = [];

  for (const f of check.failures) {
    if (f.code === 'missing_next_plan' || f.code === 'next_plan_missing_ids') {
      planGaps.push({ code: f.code, message: f.message, ids: f.ids ?? [] });
    } else if (!f.ids && !['missing_findings'].includes(f.code) && !(f.code in FIX_NOTE)) {
      // 无 ids 的整卡类（missing_disposition/bad_front_matter/unparsable_table/missing_review_json/task_unreadable/readonly_breach…）
      structural.push({ code: f.code, message: f.message });
    }
  }

  const items: GapItem[] = [];
  const readonlyRows: ReadonlyRow[] = [];

  if (!isRepair) {
    // 起草形态：全部期望编号进表单（structured ∪ degraded ∪ fallback 期望集）
    const seen = new Set<string>();
    for (const id of check.structured_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(itemOf(id, 'structured', [], existingRows));
    }
    for (const id of check.degraded_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(itemOf(id, 'degraded', [], existingRows));
    }
    for (const id of input.fallbackExpected) {
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(itemOf(id, 'fallback', [], existingRows));
    }
  } else {
    // 修复形态：新增 + 修复进表单；其余已裁行只读保留
    const editable = new Set<string>([...newIds, ...fixIds.keys()]);
    const expected = new Set([...check.structured_ids, ...check.degraded_ids, ...input.fallbackExpected, ...check.fallback_ids]);
    // 期望集之外已在表里的行 = unknown_findings（可编辑删行）——fixIds 已含
    for (const id of newIds) {
      items.push(itemOf(id, criticOfId(id) ? 'structured' : 'structured', fixIds.get(id) ?? [], existingRows));
    }
    for (const [id, codes] of fixIds) {
      if (newIds.has(id)) continue;
      items.push(itemOf(id, 'structured', codes, existingRows));
    }
    for (const r of existingRows) {
      if (editable.has(r.id)) continue;
      if (!expected.has(r.id) && r.verdict === null) continue; // 解析不出的行不冒充合法
      const v = verdictOf(r.verdict);
      if (v === null) continue;
      readonlyRows.push({ id: r.id, verdict: v, reason: r.reason, action: r.action });
    }
  }

  items.sort((a, b) => a.id.localeCompare(b.id));

  // 文件名轮次的第一事实源是 gate 输出的 rerun_index（与校验所用轮次同源，
  // cli.ts:1674-1685）；run 元数据仅作后备（代码审 r1 CLAUDE-11：旧运行 review_loop
  // 为 null、meta 缺失时不能丢 -rN 中缀——否则第二轮撞首轮文件名）
  const rerunIndex = (typeof check.rerun_index === 'number' && check.rerun_index > 0 ? check.rerun_index : null) ?? input.meta?.rerunIndex ?? null;

  return {
    form: isRepair ? 'repair' : 'draft',
    dispositionPath: check.disposition,
    topic: input.topic,
    stage: input.stage,
    runId: check.run_id,
    rerunIndex,
    driver: input.driver,
    addresses: input.addresses,
    items,
    readonlyRows,
    structural,
    planGaps,
    warnings: check.warnings,
    roundLine: check.round_line,
    nextAction: check.next_action,
  };
}
