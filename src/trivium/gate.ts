/**
 * `gate`：闸门状态机与裁决完整性校验（设计 §8.4 / §8.6）。
 *
 * §8.6 的算法是六项硬失败 + 两项默认 warning。按修订计划 §2.2（意见 AGY-04）
 * 补上**校验集合的拆分顺序**：先滤除 `parse_fallback` 的虚拟编号再做差集，
 * 否则那些合法的 `<前缀>-F<n>` 会被判成「多余 id」；并显式支持 `findings: []`。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DEFAULT_DRIVER, findingPrefixAlternation, type AgentId } from './agents/registry.js';
import { DEFAULT_CRITICS, VOIDING_DENY_CATEGORIES, type Config, type CriticId, type Disposal, type DispositionRow, type Review, type RunMeta, type Stage } from './types.js';
import { isFallbackId, parseDisposition, type ParsedDisposition } from './disposition.js';
import { listStageArtifacts, metaDir, type ArchiveLayout } from './archive.js';
import { dispositionKindForStage } from './naming.js';
import { parseFrontMatter } from './render.js';
import { parseReview } from './parse.js';
import { validateDispositionFrontMatter } from './schemas.js';

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
  | 'joint_blocker_rejected'
  | 'missing_review_json';

export interface GateFailure {
  code: GateFailureCode;
  message: string;
  /** 相关意见编号，供 Driver 直接定位修补 */
  ids?: string[];
  line?: number;
}

export interface GateWarning {
  code:
    | 'weak_reason'
    | 'joint_blocker_rejected'
    | 'parse_problem'
    | 'degraded_round'
    /** 排除作废侧后有效侧不足两家，共同阻断这一档**未执行**（设计 §12.1 的过渡处置） */
    | 'joint_check_degraded';
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
  /**
   * 共同阻断这一档的**最终三态**（§6.6 规则 7 / §12.1）。
   *
   * 返回给调用方是为了让它落进 `task.json.joint_checks`：run.json 只到 `pending`
   * （运行期读不到裁决表），这一档的结论若不落盘，`checked-found` 永久只存在于
   * 本次进程的内存里——留痕面上三态塌回两态，而这一档的全部意义就是三态。
   *
   * **可缺席**：裁决件都还没有时这一档无从谈起，三个取值一个都对不上，
   * 那就不给——调用方据此也不往 `task.json` 里写。
   */
  jointCheck?: {
    state: 'checked-none' | 'checked-found' | 'skipped-insufficient-sides';
    effective_sides: number;
    reason?: 'voided' | 'no-structured-review' | 'both';
  };
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
  /**
   * 本轮是否为降级轮次（有入选侧未成功），取自 run 元数据的 `degraded_reason`。
   *
   * **务必传真实值。** 此前调用方一律写
   * `Object.values(reviews).some((r) => r === undefined)`——而 `reviews` 只在
   * 读到结论时才建键，`Object.values` 永远拿不到 `undefined`，那个表达式**恒为 false**。
   * 生产侧算的是死值、消费侧又不读，本字段两头都是死的。
   */
  degraded: boolean;
  /**
   * 本轮**被判作废**的侧（禁读命中第①②类，设计 §10.1.1）。
   *
   * 取自 run 元数据的 `guard.peer_leak_via_path` / `peer_leak_via_command`。
   * 作用有二：作废侧不计入共同阻断的独立来源；有效侧不足两家时出具名告警。
   *
   * **缺省空数组是有意的**：旧留痕没有分类信息，那时的口径是「命中即作废」，
   * 无从区分哪几侧因哪一类命中。对旧轮次按「无作废侧」处理 = 维持旧行为，
   * 不追溯改判历史结论。
   */
  voidedSides?: readonly CriticId[];
  /**
   * parse_fallback 侧落盘的待裁决单元编号（`<前缀>-F<n>`，来自 `.fallback-items.md`）。
   * 提供时**逐条要求**出现在裁决表里（§6.6 规则 8）；不提供则只校验出现的 fallback 行。
   */
  expectedFallbackIds?: string[];
  /** run.json 记录跑过、却读不到结构化结论的一侧——那是留痕被动过，必须失败 */
  missingSides?: CriticId[];
  /** 本轮 run_id：裁决件 front-matter 的 run_id 必须与之一致，否则把上一轮的裁决件抄过来也能过 */
  runId?: string;
  /**
   * 当轮 Driver。裁决件后缀与它一致（计划 §9.1）。
   * 缺省 `claude` 与重构前行为逐项相同，为 M10 的 Driver 任意化预留。
   */
  driver?: AgentId;
}

export async function checkAdjudication(input: GateCheckInput): Promise<GateCheckResult> {
  const { cfg, layout, stage, rerunIndex, reviews } = input;
  const voidedSides = input.voidedSides ?? [];
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
  const driver = input.driver ?? DEFAULT_DRIVER;
  const hit = items.find(
    (i) => i.parsed.role === driver && i.parsed.kind === kind && i.parsed.rerunIndex === rerunIndex,
  );
  if (!hit) {
    return {
      ok: false,
      failures: [
        {
          code: 'missing_disposition',
          message:
            `找不到第 ${rerunIndex} 轮的裁决件（应为 …-${rerunIndex > 1 ? `r${rerunIndex}-` : ''}${kind}-${driver}.md）。` +
            `${stage === 'code' ? '代码审' : '计划/根因审'}必须产出裁决件，即使全部驳回也要写明「无修改及原因」（§6.6 规则 6）。`,
        },
      ],
      warnings,
      structuredIds,
      fallbackIds: [],
      dispositionPath: null,
      rows: [],
      /*
       * 裁决件还没有，这一档**无从谈起**——判据的一半（哪些被驳回）就在那份文件里。
       * 三个取值里没有一个能表达这件事：`checked-none` 是「做了、没发现」，
       * `skipped-insufficient-sides` 是「侧数不够」，而这里两者都不是。
       *
       * 所以**不给结论**，让字段整个缺席，调用方也就不会往 `task.json` 里写。
       * 这正是三态纪律本身：说不出口的时候就别说，而不是挑个最近的取值填上。
       */
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
    // 先过 trivium.disposition.v1（形状与必填），再做本轮特有的一致性比对
    const mismatches: string[] = [...validateDispositionFrontMatter(fm)];
    if (fm.schema !== 'trivium.disposition.v1') mismatches.push(`schema=${fm.schema}`);
    if (fm.topic !== layout.topic) mismatches.push(`topic=${fm.topic}（应为 ${layout.topic}）`);
    if (fm.stage !== stage) mismatches.push(`stage=${fm.stage}（应为 ${stage}）`);
    if (fm.kind !== kind) mismatches.push(`kind=${fm.kind}（${stage} 阶段应为 ${kind}）`);
    if (input.runId && fm.run_id !== input.runId) {
      mismatches.push(`run_id=${String(fm.run_id)}（本轮应为 ${input.runId}；不得复用上一轮的裁决件）`);
    }
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

  /*
   * 降级轮次显形。
   *
   * 本函数校验的是「裁决是否齐备」，而齐备与否的基准是**本轮实际产出的结论**。
   * 一个降级轮次（一侧失败）只要幸存侧被逐条裁决就会通过——这没错，但
   * `gate --check` 的输出此前完全看不出「这一轮只有一侧」，事后复核容易把它
   * 当成完整双审。出 warning 而不是 failure：降级是关于**运行**的事实，
   * 不是 Driver 改裁决件能修的东西，报 failure 会变成无法满足的闸门。
   */
  if (input.degraded) {
    warnings.push({
      code: 'degraded_round',
      message:
        '本轮是降级轮次（有入选审核者未成功产出结论），裁决完整性是**对幸存侧**校验的。' +
        '复核时请一并核对 run 元数据的 degraded_reason。',
    });
  }

  /*
   * run.json 说这一侧跑过且有结论，结构化结论却读不到：那不是「本轮没跑这一侧」，
   * 而是 `_meta/review-*.json` 被删或被搅坏。它是本函数唯一的事实来源——
   * 缺了就没有任何东西可以校验，只能失败，不能当成「该侧无意见」放行。
   */
  const missingSides = input.missingSides ?? [];
  if (missingSides.length > 0) {
    failures.push({
      code: 'missing_review_json',
      message:
        `读不到 ${missingSides.join('、')} 侧的结构化结论（_meta/review-<侧>-<run_id>.json），` +
        '而 run.json 记录该侧已产出结论。结论文件是裁决校验的唯一事实来源，请用 git restore 恢复，或重跑一轮。',
    });
  }

  const expectedFallback = input.expectedFallbackIds ?? null;
  const expectedCount = structuredIds.length + (expectedFallback?.length ?? 0);
  if (parsed.rows.length === 0) {
    // 两侧都确无意见（结构化为空且无待裁决的降级单元）时，空表是合法的
    if (expectedCount > 0) {
      failures.push({
        code: 'unparsable_table',
        message:
          '裁决表为空或无法解析，但本轮共有 ' + expectedCount + ' 条意见需要裁决' +
          (expectedFallback && expectedFallback.length > 0 ? `（含 ${expectedFallback.length} 条降级编号）` : '') + '。' +
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

  /*
   * fallback 编号同样要逐条对账（§6.6 规则 8）。原先 fallback 行只在**出现时**被校验、
   * 从不被**要求**出现：两侧都解析降级时 structuredIds 为空，一张只有表头的裁决表就能过闸。
   * `.fallback-items.md` 是编排器落盘的待裁决单元清单，拿它当期望集。
   */
  const fallbackSet = new Set(fallbackIds);
  const missingFallback = expectedFallback ? expectedFallback.filter((id) => !fallbackSet.has(id)) : [];
  const unknownFallback = expectedFallback
    ? fallbackIds.filter((id) => !expectedFallback.includes(id))
    : [];

  // 第 5 步 a：缺裁决
  const missing = [...[...idsSet].filter((id) => !decKeys.has(id)), ...missingFallback].sort();
  if (missing.length > 0) {
    failures.push({
      code: 'missing_findings',
      message: `下列意见没有裁决，必须逐条给出（禁止静默忽略，FR-14）`,
      ids: missing,
    });
  }
  // 第 5 步 b：多余裁决——fallback 编号已在上一步拆出，只与降级单元清单比对
  const unknown = [...[...decKeys].filter((id) => !idsSet.has(id)), ...unknownFallback].sort();
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

  /*
   * 第 5 步 g：**至少两个独立来源**共同提出的 blocker 被驳回。
   *
   * 「双方」这个措辞随 N 审泛化为「两家」——阈值 2 的语义是「两个独立来源」，
   * 与入选总数无关（设计 §6.6 规则 7）。被判作废的侧不计入独立来源。
   */
  const joint = findJointRejectedBlockers(reviews, structuredRows, voidedSides);
  if (joint.length > 0) {
    const msg =
      '下列 blocker 被**两家**同时提出却被驳回：' +
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

  /*
   * 有效侧不足两家时，上面那一档**根本没做**——必须说出来，不能静默返回空集。
   *
   * 这正是本主题要修的那一族：阴性结论（查过、没有共同项）与「没做」
   * 在留痕里落成同一个观测。告警而不是失败：作废本身已有各自的处置，
   * 这里要表达的是「本轮不再享有共同阻断这一档的保护」，
   * 让裁决者知道自己少了一层防线（设计 §12.1 的过渡处置）。
   */
  const jc = jointCheckState(reviews, joint, voidedSides);
  if (jc.state === 'skipped-insufficient-sides') {
    warnings.push({
      code: 'joint_check_degraded',
      message:
        `共同阻断这一档**未执行**：有效侧只剩 ${jc.effective_sides} 家（需要 2 家）` +
        `——${
          jc.reason === 'voided'
            ? '有侧因禁读命中被判作废'
            : jc.reason === 'both'
              ? '既有侧被判作废，也有侧未产出结构化结论'
              : '有侧未产出结构化结论（解析降级或失败）'
        }。` +
        '本轮不享有「两家同时提出的 blocker 被驳回即报」这层保护——' +
        '这不是「查过、没发现」，是「没查」。',
      ids: [],
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    structuredIds,
    fallbackIds,
    dispositionPath,
    rows,
    jointCheck: jc,
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
  /**
   * 被判作废的侧（设计 §10.1.1 第①②类命中）——**不计入独立来源**。
   *
   * 一侧读了对端产物，它作为「第二只独立眼睛」的身份就不可采信，
   * 与它每条意见是否属实无关。不排除的话会出现方向完全相反的后果：
   * **一个本应作废的审查员反而获得了逼停流水线的否决权**——它提的 blocker
   * 与另一侧凑成「共同」，Driver 驳回时闸门当场拦人。
   *
   * 排除的代价见 `jointCheckState`：有效侧可能不足两家，那时这一档**不做**，
   * 而「不做」必须与「做了、没发现」分开记。
   */
  voidedSides: readonly CriticId[] = [],
): { location: string; ids: string[] }[] {
  const voided = new Set(voidedSides);
  const byLocation = new Map<string, { critic: CriticId; id: string }[]>();
  for (const c of Object.keys(reviews) as CriticId[]) {
    if (voided.has(c)) continue;
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
    if (critics.size < 2) continue; // 不足两个独立来源
    if (list.every((x) => rejected.has(x.id))) {
      out.push({ location, ids: list.map((x) => x.id) });
    }
  }
  return out;
}

/**
 * 共同阻断这一档**到底做没做**（设计 §6.6 规则 7 / §12.1）。
 *
 * ## 为什么必须记
 *
 * 排除作废侧之后，有效侧可能不足两家，而 `findJointRejectedBlockers` 的判据是
 * `critics.size < 2`——**恒返回空集**。于是「查过、没有共同项」与「有效侧不足、
 * 这一项根本没做」在留痕里完全一样。这是本项目三态纪律
 * （「没测到」≠「测出来没有」）在本主题内的第四次复发形态。
 *
 * ## 它是过渡处置，不是补偿
 *
 * 设计 §12.1 规定的补偿是「作废侧重跑一次」（补齐侧数），那一条尚待实施。
 * 在它就绪之前，本字段**只保证失效可见，不恢复交叉验证**——
 * 一侧被判泄漏时，本轮确实不再享有共同阻断这一档的保护，
 * 而这件事必须让人看见，不能静默。
 *
 * ## 阈值为什么不随入选总数上调
 *
 * 阈值 2 的语义是「至少两个互相独立的来源指出同一处」，与总数无关：
 * 三家里的两家仍然是两个独立来源。
 */
export function jointCheckState(
  reviews: Partial<Record<CriticId, Review | null>>,
  joint: readonly { location: string; ids: string[] }[],
  voidedSides: readonly CriticId[] = [],
): {
  state: 'checked-none' | 'checked-found' | 'skipped-insufficient-sides';
  effective_sides: number;
  /**
   * 有效侧不足时**为什么**不足（r1 AGY-06）。
   *
   * 初版的告警文案一律写「排除作废侧后…」，而有效侧也可能是因为某侧
   * `parse_fallback`（没有结构化结论）而不足——把「违反独立性被作废」
   * 与「解析降级」混为一谈，审计时会指向错误的根因。
   */
  reason?: 'voided' | 'no-structured-review' | 'both';
} {
  const voided = new Set(voidedSides);
  const effective = (Object.keys(reviews) as CriticId[]).filter(
    (c) => !voided.has(c) && reviews[c] !== undefined && reviews[c] !== null,
  ).length;

  if (effective < 2) {
    return { state: 'skipped-insufficient-sides', effective_sides: effective, reason: whyInsufficient(reviews, voided) };
  }
  return {
    state: joint.length > 0 ? 'checked-found' : 'checked-none',
    effective_sides: effective,
  };
}

/** 有效侧不足的成因：作废排除、无结构化结论，还是两者都有 */
function whyInsufficient(
  reviews: Partial<Record<CriticId, Review | null>>,
  voided: Set<CriticId>,
): 'voided' | 'no-structured-review' | 'both' {
  const ids = Object.keys(reviews) as CriticId[];
  const hasVoided = ids.some((c) => voided.has(c));
  const hasNoReview = ids.some((c) => !voided.has(c) && (reviews[c] === null || reviews[c] === undefined));
  if (hasVoided && hasNoReview) return 'both';
  return hasVoided ? 'voided' : 'no-structured-review';
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
 * 本轮实际入选的审核者集合。
 *
 * 事实来源是 `run.json.critics_selected`（M7b 第 3 步起）——它记的是
 * 「这一轮本该跑谁」，与当前配置启用了谁无关（历史轮次可能跑过现已停用的 Agent）。
 *
 * 此前读的是 `critics` 的**键集**，那是「实际产出了结果的」：入选却整侧失联时
 * 它就少一个键，于是「压根没入选」与「计划跑但一条结果都没有」不可区分——
 * 后者本该被判成缺件，却因为键集里没有它而静默通过。`readRunMeta` 会把历史
 * v1 记录迁移成 v2 形状，其 `critics_selected` 正是由键集推导，因此旧归档的
 * 判读结论保持不变（迁移不会把信息变多，见 `migrateRunMetaV1`）。
 *
 * run.json 读不到、或迁移后集合为空时回落到**缺省**集合，保持旧归档可读。
  * **回落值取缺省集合而非启用全集**（M8 第 3 步）：codex 启用后，
  * 「能跑的」是三家而「默认跑的」是两家，按前者回落会对每一个两侧轮次报假缺口。
  * 读不到记录时，最合理的猜测是「跑了默认那几家」。
 */
function criticsOf(runMeta: RunMeta | null): readonly CriticId[] {
  const selected = runMeta?.critics_selected ?? [];
  return selected.length > 0 ? selected : DEFAULT_CRITICS;
}

/**
 * 从归档 `_meta/` 读回本轮各审核者的结构化结论。
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
): Promise<{
  reviews: Partial<Record<CriticId, Review | null>>;
  notes: string[];
  /** parse_fallback 侧待裁决单元的编号（读自 .fallback-items.md） */
  expectedFallbackIds: string[];
  /** run.json 记录已产出结论、结构化结论却读不到的一侧 */
  missingSides: CriticId[];
  /**
   * 本轮被判作废的侧（禁读命中第①②类，设计 10.1.1）。
   *
   * 在这里派生而不是让调用方传：它初版是 `checkAdjudication` 的可选参数，
   * 两个生产调用点都没传，于是整段没生效而纯函数单测全绿。
   */
  voidedSides: CriticId[];
  /**
   * 本轮是否为降级轮次，读自 run 元数据的 `degraded_reason`。
   *
   * 由本函数一并返回而不是让调用方自己算：`runMeta` 已经在这里读过了，
   * 调用方手上只有 `reviews`，从它推不出降级——两处 `gate --check` 此前
   * 各自用 `Object.values(reviews).some((r) => r === undefined)` 推，恒为 false。
   */
  degraded: boolean;
}> {
  const reviews: Partial<Record<CriticId, Review | null>> = {};
  const notes: string[] = [];
  const expectedFallbackIds: string[] = [];
  const missingSides: CriticId[] = [];
  const dir = metaDir(layout, stage);
  const { readRunMeta } = await import('./meta.js');
  const runMeta = await readRunMeta(layout, stage, runId);

  /*
   * 遍历范围取自本轮实际入选的审核者，而非字面两家（计划 §2.1 / B-5）。
   *
   * 这是两侧审查里最严重的一处：写死 `['gemini','glm']` 时，第三家的
   * `review-<c>-<runId>.json` 永远不会被读取——它的意见对 gate **整体不可见**，
   * 闸门会放行一个从未被裁决的审核者。故障形态是静默漏裁，不是报错。
   *
   * `criticsOf` 优先读 run.json 的记录，缺失时回落到当前启用集合（历史工件兼容）。
   */
  for (const c of criticsOf(runMeta)) {
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
          expectedFallbackIds.push(...(await readFallbackIds(path.join(dir, `review-${c}-${runId}.fallback-items.md`))));
          notes.push(`${c} 侧为 parse_fallback，其意见按 <前缀>-F<n> 编号逐条校验`);
        }
      } else {
        reviews[c] = raw as Review;
      }
    } catch {
      const failed = path.join(dir, `review-${c}-${runId}.failed.json`);
      if (await fileExists(failed)) {
        notes.push(`${c} 侧本轮失败，未产出结论（单审降级）`);
        continue;
      }
      /*
       * 读不到结论也没有失败记录：要么本轮没跑这一侧（`--only`），要么结论文件被动过。
       * 以 run.json 为准；run.json 自己也读不到时同样按「被动过」处理——
       * 它本就是留痕核对的锚，缺了不能当成没跑。
       */
      const ran = runMeta === null || (runMeta.critics[c]?.status === 'ok' || runMeta.critics[c]?.status === 'parse_fallback');
      if (ran) {
        missingSides.push(c);
        notes.push(`读不到 ${c} 侧的结构化结论：${path.relative(layout.archiveRoot, p)}`);
      } else {
        notes.push(`本轮未跑 ${c} 侧`);
      }
    }
  }
  /*
   * 降级事实取自 run 元数据，不从 `reviews` 反推。
   *
   * `degraded_reason` 是 `decideMode` 判定降级时写进去的唯一凭据；run.json 读不到时
   * 保守记 false——此时 `missingSides` 已经在上面把「留痕被动过」判成失败，
   * 不需要再叠一层猜测。
   */
  const degraded = runMeta?.degraded_reason != null;

  /*
   * 本轮被判作废的侧（设计 10.1.1 的第①②类命中）。
   *
   * 从 run 元数据的两条泄漏通道派生，而不是让调用方各自去算：
   * `voidedSides` 初版是 `checkAdjudication` 的一个可选参数，**两个生产调用点
   * 都没传**，于是「作废侧不计入共同阻断」整段从未生效，而纯函数单测全绿——
   * 可选参数的默认值让漏传静默成功（r1 三侧独立判为阻断）。
   * 在这里派生，调用方想漏都漏不掉。
   *
   * 读不到 run 元数据时返回空数组：那是旧归档，当时的口径是「命中即作废」、
   * 无从区分哪几侧因哪一类命中，按「无作废侧」处理即维持旧行为，不追溯改判。
   */
  const voidedSides: CriticId[] = [];
  for (const c of criticsOf(runMeta)) {
    const viaPath = runMeta?.guard?.peer_leak_via_path?.[c]?.hits ?? [];
    const viaCmd = runMeta?.guard?.peer_leak_via_command?.[c];
    // 路径通道逐条带类，只有作废类才算；命令通道没有类别信息，命中即算
    const pathVoiding = viaPath.some((h) => VOIDING_DENY_CATEGORIES.includes(h.category));
    if (pathVoiding || viaCmd?.hit === true) voidedSides.push(c);
  }

  return { reviews, notes, expectedFallbackIds, missingSides, degraded, voidedSides };
}

/** 从 `.fallback-items.md` 读回编排器编好号的待裁决单元（每行 `- <前缀>-F<n>: …`） */
async function readFallbackIds(p: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = new RegExp(`^-\\s+((?:${findingPrefixAlternation()})-F\\d+):`).exec(line.trim());
    if (m) out.push(m[1]!);
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从审查文档 front-matter 读回本轮的 run_id（`gate --check` 不必要求人传）。
 *
 * 跳过的是**当轮 Driver 的产出**（原稿与裁决件不带审查侧的 run_id），
 * 而不是字面的 claude（计划 §2.1 / B-4）——Claude 作为审核者时，
 * 写死跳过会让反查恒返回 null。
 */
export async function inferLatestRunId(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  driver: AgentId = DEFAULT_DRIVER,
): Promise<string | null> {
  const items = await listStageArtifacts(layout, stage);
  for (const i of items) {
    if (i.parsed.rerunIndex !== rerunIndex) continue;
    if (i.parsed.role === driver) continue;
    const p = path.join(layout.archiveRoot, layout.topic, stage, i.fileName);
    const fm = parseFrontMatter(await fs.readFile(p, 'utf8'));
    const runId = fm?.['run_id'];
    if (typeof runId === 'string') return runId;
  }
  return null;
}

export type { Disposal };
