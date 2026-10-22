/**
 * 本轮整体结论的计票与多轮评审循环判定（EV-247）。
 *
 * 每个审核者在 `trivium.review.v2` 里给出三档结论之一：通过 / 修改后通过 / 不通过。
 * 编排器按侧计票、判本轮整体结论，再结合轮次链（第几轮、最多几轮）决定下一步：
 * 自动重审、进入下一阶段，还是停下人工审核。**全部是纯函数**——计票只看结构化结论，
 * 不看 Driver 的裁决：裁决决定改什么，结论决定还要不要再审。
 *
 * 判定规则（用户 2026-10-22 定）：
 *   - 不通过 ≥ 50% → 不通过（改后重审）；
 *   - 否则修改后通过 ≥ 50% → 修改后通过；
 *   - 否则通过 ≥ 50% → 通过；
 *   - 三档都不到 50%（如三家各投一档）→ 修改后通过。
 * 分母只收给出了有效结构化结论的侧：失败、超时、整份回退、作废、旧契约的结论都不计票，列进 `excluded`。
 * 有效票不到入选侧数的一半（`2n < 入选侧数`，一票都没有是其特例）时判 `undetermined`，停下人工审核——
 * 没有足够的结论不能当成通过（计划 r2 D-5，用户 2026-10-22 确认）：双审剩一票仍可定论，三审及以上剩一票不行。
 */
import type {
  CriticId, NextAction, Review, ReviewLoop, ReviewVerdict, RoundOutcome, RoundVerdict, VerdictExclusion,
} from './types.js';
import { REVIEW_SCHEMA_ID, REVIEW_VERDICTS } from './types.js';

export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  pass: '通过',
  'pass-after-changes': '修改后通过',
  reject: '不通过',
};

/** 三档的判法，进任务书输出契约（`brief.ts`），审查员据此选档 */
export const VERDICT_MEANING: Record<ReviewVerdict, string> = {
  pass: '可以直接按它实施，意见只是改进建议',
  'pass-after-changes': '按你的意见修改后即可实施，不需要再审一轮',
  reject: '存在必须修改、且修改后需要重新评审的问题',
};

/** 每个阶段的缺省最大轮次 */
export const REVIEW_LOOP_DEFAULT_ROUNDS = 3;
/** 最大轮次的上限 */
export const REVIEW_LOOP_MAX_ROUNDS = 10;

// run.json 的形状（ReviewLoop / RoundVerdict 等）定义在 types.ts，与其余留痕契约放在一处

export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  rerun: '按裁决修改后自动重审',
  proceed: '按裁决修改后进入下一阶段',
  human_review: '停下人工审核',
};

export const EXCLUSION_LABEL: Record<VerdictExclusion, string> = {
  failed: '本轮失败或超时，没有结论',
  parse_fallback: '结论无法结构化解析（整份回退）',
  voided: '读到对端产物，本轮作废',
  legacy_schema: '结论是旧契约 trivium.review.v1，不计票',
  missing: '读不到结构化结论',
};

/** 一侧的选票：有效结论，或不计票的原因 */
export type SideBallot = { verdict: ReviewVerdict } | { excluded: VerdictExclusion };

/**
 * 一侧的结构化结论 → 选票。作废优先于结论（作废侧的结论本身不可信）；
 * `review` 为 null 是整份回退，`undefined` 是没有结论文件。
 */
export function ballotOf(review: Review | null | undefined, voided: boolean): SideBallot {
  if (voided) return { excluded: 'voided' };
  if (review === null) return { excluded: 'parse_fallback' };
  if (review === undefined) return { excluded: 'missing' };
  if (review.schema !== REVIEW_SCHEMA_ID) return { excluded: 'legacy_schema' };
  return { verdict: review.verdict };
}

/**
 * 计数 → 整体结论。整数比较 `2k ≥ n`，不做浮点。
 * `selected` 是本轮入选侧数（含不计票的侧），缺省等于有效票数；有效票 × 2 < `selected` 即有效结论不足（D-5）。
 */
export function decideOutcome(counts: Record<ReviewVerdict, number>, selected?: number): RoundOutcome {
  const n = REVIEW_VERDICTS.reduce((s, v) => s + counts[v], 0);
  if (n === 0 || 2 * n < (selected ?? n)) return 'undetermined';
  const half = (k: number): boolean => 2 * k >= n;
  if (half(counts.reject)) return 'reject';
  if (half(counts['pass-after-changes'])) return 'pass-after-changes';
  if (half(counts.pass)) return 'pass';
  return 'pass-after-changes';
}

export function nextAction(outcome: RoundOutcome, loop: ReviewLoop): NextAction {
  if (outcome === 'undetermined') return 'human_review';
  if (outcome !== 'reject') return 'proceed';
  return loop.round < loop.max_rounds ? 'rerun' : 'human_review';
}

export function tallyRound(ballots: Partial<Record<CriticId, SideBallot>>, loop: ReviewLoop): RoundVerdict {
  const sides: RoundVerdict['sides'] = {};
  const excluded: RoundVerdict['excluded'] = {};
  const counts: Record<ReviewVerdict, number> = { pass: 0, 'pass-after-changes': 0, reject: 0 };
  for (const [critic, b] of Object.entries(ballots) as [CriticId, SideBallot | undefined][]) {
    if (!b) continue;
    if ('verdict' in b) {
      sides[critic] = b.verdict;
      counts[b.verdict]++;
    } else {
      excluded[critic] = b.excluded;
    }
  }
  // 收尾处每个入选侧都有一项（有票或不计票原因），键数即入选侧数
  const selected = Object.keys(sides).length + Object.keys(excluded).length;
  const outcome = decideOutcome(counts, selected);
  return { sides, excluded, counts, outcome, next_action: nextAction(outcome, loop) };
}

export function outcomeLabel(o: RoundOutcome): string {
  return o === 'undetermined' ? '有效结论不足' : VERDICT_LABEL[o];
}

/** 一行播报：「第 2/3 轮 · 计票：1 通过 / 0 修改后通过 / 1 不通过 → 不通过 · 下一步：按裁决修改后自动重审」 */
export function renderRoundLine(loop: ReviewLoop, rv: RoundVerdict): string {
  const c = rv.counts;
  const ex = Object.keys(rv.excluded).length;
  const n = Object.keys(rv.sides).length;
  return (
    `第 ${loop.round}/${loop.max_rounds} 轮 · 计票：${c.pass} 通过 / ${c['pass-after-changes']} 修改后通过 / ${c.reject} 不通过` +
    (ex > 0 ? `（另有 ${ex} 侧不计票，由 ${n}/${n + ex} 侧定论）` : '') +
    ` → ${outcomeLabel(rv.outcome)} · 下一步：${NEXT_ACTION_LABEL[rv.next_action]}`
  );
}

/**
 * 最大轮次的取值校验。合法返回 null，否则返回给用户看的错误文案（调用方按用法错误退 64）。
 * `flag` 只用于文案，如 `--max-rounds`、`--max-rounds-code`。
 */
export function maxRoundsProblem(raw: string, flag: string): string | null {
  if (!/^[0-9]+$/.test(raw)) return `${flag} 要一个整数，收到 ${JSON.stringify(raw)}`;
  const n = Number.parseInt(raw, 10);
  if (n < 1 || n > REVIEW_LOOP_MAX_ROUNDS) {
    return `${flag} 取 1～${REVIEW_LOOP_MAX_ROUNDS}，收到 ${n}`;
  }
  return null;
}

/** 上一轮（同主题同阶段、最近一次运行）与续链有关的事实 */
export interface PrevRoundFacts {
  run_id: string;
  review_loop?: ReviewLoop;
  round_verdict?: RoundVerdict;
  /** 该轮已有人工审批记录（批准或拒绝），或已被显式作废——两者都会打断轮次链 */
  closed: boolean;
}

/**
 * 推导本轮在轮次链里的位置（`review --start`）。
 *
 * 上一轮判了 `rerun` 且没被人工表态 / 作废 ⇒ 续链：轮次 +1，上限沿用链首的值；
 * 此时显式给了不同的上限 ⇒ 拒绝（循环中途改上限会让「还剩几轮」失去意义）。
 * 上一轮判了 `human_review` 且没被人工表态 ⇒ 拒绝：「停下人工审核」由归档正本把守，
 * 不只靠本机闸门状态的比较-交换——槽位缺失（跨克隆、本机状态被删）时那道比较会放行（代码双审 r1 GLM-01）。
 * 其余情形（没有上一轮、上一轮是 `proceed`、旧运行没有轮次链、已表态）⇒ 新链：第 1 轮，上限取显式值或缺省 3。
 */
export function deriveReviewLoop(
  prev: PrevRoundFacts | null,
  requested: number | null,
): { ok: true; loop: ReviewLoop; continued: boolean } | { ok: false; message: string } {
  const open = prev !== null && !prev.closed && prev.review_loop !== undefined;
  if (open && prev.round_verdict?.next_action === 'human_review') return humanReviewPending(prev.run_id, prev.review_loop!);
  const continues = open && prev.round_verdict?.next_action === 'rerun';
  if (!continues) {
    return { ok: true, loop: { round: 1, max_rounds: requested ?? REVIEW_LOOP_DEFAULT_ROUNDS }, continued: false };
  }
  const head = prev.review_loop!;
  if (requested !== null && requested !== head.max_rounds) {
    return {
      ok: false,
      message:
        `上一轮（run ${prev.run_id}，第 ${head.round}/${head.max_rounds} 轮）判了不通过、本轮是同一条轮次链的续轮，` +
        `上限沿用 ${head.max_rounds}，不能中途改成 ${requested}。\n` +
        '  去掉 --max-rounds（或给相同的值）即可续跑；确实要换上限，先让上一轮经人工审批或作废，再重新起链。',
    };
  }
  const round = head.round + 1;
  // 防御：按 `nextAction` 的构造，到上限的那一轮只会给 human_review，走不到这里
  if (round > head.max_rounds) return humanReviewPending(prev.run_id, head);
  return { ok: true, loop: { round, max_rounds: head.max_rounds }, continued: true };
}

function humanReviewPending(runId: string, loop: ReviewLoop): { ok: false; message: string } {
  return {
    ok: false,
    message:
      `上一轮（run ${runId}，第 ${loop.round}/${loop.max_rounds} 轮）已停在人工审核，不能再自动重审或重新起链。\n` +
      '  请人工审核：用 /dual-approve 审批（或 /dual-abandon 作废）上一轮之后，再决定是否重新起链。',
  };
}
