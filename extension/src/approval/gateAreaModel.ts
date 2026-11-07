/**
 * 闸门区模型（FR-9，计划 r2 §D2；纯函数）。
 *
 * 感知：StateWatch 快照里 awaiting_approval / review_done_awaiting_disposition 的闸门。
 * 计票：gate --check --json 的 round_verdict **原样消费**（编排器从本轮 review-*.json
 * 派生、run.v3 同字段——与历史树 verdict 同一事实源，不构成第二份计票）。
 * round_verdict 为 null（bug 阶段/旧运行/无轮次链）时如实降级，不从其它字段补算（CLAUDE-12）。
 * warnings 一等展示（CLAUDE-10）：与 failures 分区、逐条 code+message，不静默丢弃。
 */
import type { GateCheckOutput, GateWarningItem, RoundVerdict } from '../cli/commands';

export type GateAreaMode = 'raf' | 'aa';

export interface VoteBlock {
  sides: Array<{ critic: string; verdict: string }>;
  counts: { pass: number; 'pass-after-changes': number; reject: number };
  outcome: string;
  roundLine: string | null;
}

export interface GateCardModel {
  key: string;
  topic: string;
  stage: string;
  state: string;
  runId: string;
  since: string | null;
  rerunIndex: number | null;
  mode: GateAreaMode;
  /** 计票（null = 无计票信息，UI 降级文案） */
  vote: VoteBlock | null;
  /** gate --check 退 2 时的缺口摘要（aa 态异常：如裁决被外部改动） */
  failureSummary: Array<{ code: string; message: string }>;
  warnings: GateWarningItem[];
  /** 拒绝理由（UI 输入态镜像，空 = 未填；必填校验在前端） */
  rejectReason: string;
}

/** StateWatch 快照 → 闸门区卡（不含 gate --check 结果：那由宿主异步补齐经 mergeGateCheck 合入） */
export function gateCardsOf(
  gates: Array<{ key: string; topic: string; stage: string; state: string; runId: string; since: string | null; rerunIndex: number | null }>,
): Array<Omit<GateCardModel, 'vote' | 'failureSummary' | 'warnings' | 'rejectReason'>> {
  const out: Array<Omit<GateCardModel, 'vote' | 'failureSummary' | 'warnings' | 'rejectReason'>> = [];
  for (const g of gates) {
    if (g.state !== 'awaiting_approval' && g.state !== 'review_done_awaiting_disposition') continue;
    if (!g.runId) continue;
    out.push({
      key: g.key,
      topic: g.topic,
      stage: g.stage,
      state: g.state,
      runId: g.runId,
      since: g.since,
      rerunIndex: g.rerunIndex,
      mode: g.state === 'awaiting_approval' ? 'aa' : 'raf',
    });
  }
  out.sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''));
  return out;
}

/** gate --check 输出 → 卡片合并片段（aa 态应退 0；退 2 时如实展示缺口并引导裁决台） */
export function mergeGateCheck(check: GateCheckOutput | null): Pick<GateCardModel, 'vote' | 'failureSummary' | 'warnings'> {
  if (!check) {
    return { vote: null, failureSummary: [{ code: 'unavailable', message: 'gate --check 调用失败（读不到输出）：可点刷新重试。' }], warnings: [] };
  }
  return {
    vote: voteBlockOf(check.round_verdict, check.round_line),
    failureSummary: check.ok ? [] : check.failures.map((f) => ({ code: f.code, message: f.message })),
    warnings: check.warnings ?? [],
  };
}

export function voteBlockOf(rv: RoundVerdict | null, roundLine: string | null): VoteBlock | null {
  if (!rv) return null;
  return {
    sides: Object.entries(rv.sides ?? {}).map(([critic, verdict]) => ({ critic, verdict })),
    counts: {
      pass: rv.counts?.pass ?? 0,
      'pass-after-changes': rv.counts?.['pass-after-changes'] ?? 0,
      reject: rv.counts?.reject ?? 0,
    },
    outcome: rv.outcome ?? '',
    roundLine,
  };
}

/** 计票 verdict → 中文标签（reviewParse.verdictLabel 同文案，展示层复用口径） */
export function verdictText(v: string): string {
  const map: Record<string, string> = {
    pass: '通过',
    'pass-after-changes': '修改后通过',
    reject: '不通过',
    'approve-with-nits': '带微瑕通过',
    'request-changes': '要求修改',
  };
  return map[v] ?? v;
}

/** 无计票形态的降级文案（不从其它字段补算） */
export function noVoteNote(): string {
  return '无计票信息（旧运行或 bug 阶段）：以各侧审查正文为准。';
}
