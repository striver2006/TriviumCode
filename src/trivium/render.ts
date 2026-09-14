/**
 * `render`：Review → 人读 Markdown（设计 §6.5 的 front-matter 契约）。
 *
 * front-matter 不是装饰：AC-05 / AC-06 / AC-11 / AC-13 / AC-17 / AC-18 都要靠它机读核对。
 * 因此凡是「不可伪装」的事实（降级、解析降级、证据不足、漂移、路径 deny 是否生效、
 * 生效模型）都必须出现在文件头，而不是只藏在 `_meta/` 里。
 */
import YAML from 'yaml';
import type {
  CriticId, CriticResult, Review, Severity, Stage, Vendor,
} from './types.js';
import { CRITIC_VENDOR } from './types.js';
import { agentById } from './agents/registry.js';

const SEVERITY_ORDER: readonly Severity[] = ['blocker', 'major', 'minor', 'nit'];
const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: '阻断',
  major: '重要',
  minor: '次要',
  nit: '吹毛求疵',
};

export interface RenderInput {
  critic: CriticId;
  stage: Stage;
  topic: string;
  runId: string;
  rerunIndex: number;
  review: Review | null;
  /** 解析失败时的原文，与 review 二者必有其一 */
  rawText: string | null;
  result: CriticResult;
  modelRequested: string | null;
  effort?: string | null;
  snapshotHash: string;
  startedAt: string;
  finishedAt: string;
  /** 由 guard 判定后传入 */
  evidenceOk: boolean;
  projectReads: number;
  /**
   * 本轮**入选**的审核者集合，用于渲染中性的参与者事实。
   *
   * 与 `degraded` 是两件事，不可互相顶替：选 1 侧并成功是配置意图，
   * 此时 `degraded` 为 false 却仍该让读者看见「本轮只审了一侧」（AC-22）。
   */
  selectedCritics: readonly CriticId[];
  degraded: boolean;
  drift: boolean;
  /** 路径级 deny 是否实际生效（§10.2 要求逐侧标注） */
  peerDeny: boolean;
  consultedUnverified: boolean;
  heterogeneous: boolean;
  overrideReason?: string | null;
}

export function countSeverities(review: Review | null): Record<Severity, number> {
  const c: Record<Severity, number> = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of review?.findings ?? []) c[f.severity]++;
  return c;
}

/** 渲染 front-matter。字段名与设计 §6.5 逐一对应，不得随意增减 */
export function renderFrontMatter(input: RenderInput): string {
  const vendor: Vendor = CRITIC_VENDOR[input.critic];
  const parseFallback = input.review === null;

  const fm: Record<string, unknown> = {
    schema: 'trivium.review.v1',
    topic: input.topic,
    stage: input.stage,
    role: input.critic,
    vendor,
    /*
     * CLI 名取自注册表，不再从 vendor 三目算。
     * 原式 `vendor === 'antigravity' ? 'agy' : 'zcode'` 在两值时恰好穷尽，
     * 而 `Vendor` 放开成四值后它会把 codex / claude 静默记成 zcode——
     * front-matter 是审计凭证，写错不报错比报错更坏。
     */
    agent_cli: `${agentById(input.critic)?.cliName ?? input.critic}/${input.result.cli_version ?? 'unknown'}`,
    model_requested: input.modelRequested,
    // 回读值，不采信 Agent 自述（AC-13）
    model_effective: input.result.model_effective,
    model_effective_source: input.result.model_effective_source,
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.result.model_route ? { model_route: input.result.model_route } : {}),
    run_id: input.runId,
    rerun_index: input.rerunIndex,
    snapshot_hash: input.snapshotHash,
    blind: true,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    duration_s: Math.round(input.result.duration_s),
    tool_calls: { ...input.result.tool_calls, project_reads: input.projectReads },
    evidence_ok: input.evidenceOk,
    verdict: input.review?.verdict ?? 'request-changes',
    findings_count: countSeverities(input.review),
    degraded: input.degraded,
    parse_fallback: parseFallback,
    // 诚实边界：本机两侧路径级 deny 均不可用，这里如实记 false（§10.2）
    peer_deny: input.peerDeny,
    drift: input.drift,
    ...(input.consultedUnverified ? { consulted_unverified: true } : {}),
    heterogeneous: input.heterogeneous,
    ...(input.overrideReason ? { override_reason: input.overrideReason } : {}),
    ...(input.result.session_id ? { session_id: input.result.session_id } : {}),
  };

  return `---\n${YAML.stringify(fm, { lineWidth: 0 }).trimEnd()}\n---`;
}

const STAGE_LABEL: Record<Stage, string> = { plan: '计划审查', code: '代码审查', bug: '根因审查' };

/**
 * 审查文档抬头的人读全称，取自注册表。
 *
 * 此前是 `CRITIC_LABEL: Record<CriticId, string>` 的两键字面表——它**不带引号**，
 * 因此 grep 对账的字面量扫描抓不到它，白名单里也就没有它的条目：
 * 一个「白名单外无硬编码」的结论看着成立、实际有洞（M7b 第 2 步补的属性访问对账）。
 *
 * 未登记的 id 回落到 id 本身而不抛异常：抬头是人读文案，
 * 为它炸掉一次已经跑完、结论已在手里的审查不划算。
 */
function criticLabel(critic: CriticId): string {
  return agentById(critic)?.label ?? critic;
}

/** 渲染完整审查文档 */
export function renderReviewDoc(input: RenderInput): string {
  const parts: string[] = [renderFrontMatter(input)];
  const { review, result } = input;

  parts.push(`# ${STAGE_LABEL[input.stage]}：${input.topic}

> ${criticLabel(input.critic)} ｜ 模型 \`${result.model_effective ?? input.modelRequested ?? '未知'}\`
> ｜ 运行 \`${input.runId}\`${input.rerunIndex > 1 ? ` ｜ 第 ${input.rerunIndex} 轮` : ''}
> ｜ 本轮审核者 ${input.selectedCritics.join('、') || '（未记录）'}`);

  /*
   * 不可伪装的标记必须在正文顶部就能看见，而不是只在 front-matter 里。
   *
   * **参与者事实与降级警示分两处说**（设计 §3.4 / AC-22）：
   * 「本轮审核者」是中性陈述，始终渲染在抬头；下面的横幅只在真降级时出现。
   * 旧文案「另一侧未能完成」在两处都站不住：选 1 侧成功时它是假话（没有任何
   * 一侧失败），三审挂一侧时「另一侧」也指代不清。
   */
  const flags: string[] = [];
  if (input.degraded) {
    flags.push(
      '**本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。' +
        '实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。',
    );
  }
  if (review === null) flags.push('**解析降级**：本侧输出未能解析为结构化结论，下方为原文。该侧不参与阻断判定。');
  if (!input.evidenceOk) flags.push('**Agent 执行证据不足**：本侧不得计为合格双审的一半。');
  if (input.drift) flags.push('**审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。');
  if (!input.peerDeny) {
    flags.push(
      '**路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，' +
      '对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。',
    );
  }
  if (!input.heterogeneous) {
    flags.push(`**与主脑同源**：本侧使用了 Claude 系模型${input.overrideReason ? `（${input.overrideReason}）` : ''}。`);
  }
  if (flags.length > 0) parts.push(flags.map((f) => `> ⚠️ ${f}`).join('\n>\n'));

  if (review === null) {
    parts.push(`## 原始输出（未能结构化解析）

${'```'}
${(input.rawText ?? '').trim()}
${'```'}`);
    return parts.join('\n\n') + '\n';
  }

  parts.push(`## 总判断

${review.summary.trim()}

**结论**：\`${review.verdict}\``);

  if (review.findings.length === 0) {
    parts.push(`## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。`);
  } else {
    const counts = countSeverities(review);
    const dist = SEVERITY_ORDER.filter((s) => counts[s] > 0)
      .map((s) => `${SEVERITY_LABEL[s]} ${counts[s]}`)
      .join(' ｜ ');
    parts.push(`## 审查意见（共 ${review.findings.length} 条：${dist}）`);

    // 按严重度排序，最危险的在最前面
    const sorted = [...review.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted) {
      parts.push(`### ${f.id} · ${SEVERITY_LABEL[f.severity]}（${f.severity}）

| 项 | 内容 |
| :--- | :--- |
| 位置 | \`${f.location}\` |
| 类别 | ${f.kind} ｜ 层次 ${f.layer} |
| 置信度 | ${f.confidence} |

**问题**：${f.problem}

**依据**：${f.evidence}

**建议**：${f.suggestion}`);
    }
  }

  if ((review.agreed ?? []).length > 0) {
    parts.push(`## 认为正确的部分\n\n${review.agreed!.map((a) => `- ${a}`).join('\n')}`);
  }

  parts.push(`## 未覆盖范围（本侧盲区）

${(review.not_covered ?? []).length > 0
  ? review.not_covered!.map((n) => `- ${n}`).join('\n')
  : '（审查员未填写。这是应当补齐的项。）'}`);

  parts.push(`## 实际查阅的项目文件

${(review.consulted ?? []).length > 0
  ? review.consulted!.map((c) => `- \`${c}\``).join('\n')
  : '（审查员未填写 consulted，无法与工具轨迹交叉核对。）'}

> 编排器从工具轨迹中记录到的读取次数：${JSON.stringify({ ...result.tool_calls, project_reads: input.projectReads })}`);

  parts.push(`---

*本文档由 TriviumCode 编排器从 \`${input.critic}\` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*`);

  return parts.join('\n\n') + '\n';
}

/** 从 Markdown 文件头解析 front-matter（gate 与 report 机读用） */
export function parseFrontMatter(md: string): Record<string, unknown> | null {
  if (!md.startsWith('---')) return null;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return null;
  try {
    return (YAML.parse(md.slice(3, end)) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}
