/**
 * `render`：Review → 人读 Markdown（设计 §6.5 的 front-matter 契约）。
 *
 * front-matter 不是装饰：AC-05 / AC-06 / AC-11 / AC-13 / AC-17 / AC-18 都要靠它机读核对。
 * 因此凡是「不可伪装」的事实（降级、解析降级、证据不足、漂移、路径 deny 是否生效、
 * 生效模型）都必须出现在文件头，而不是只藏在 `_meta/` 里。
 */
import YAML from 'yaml';
import type {
  CriticId, CriticResult, DegradedFinding, DenyCategory, DriftUnknownReason, EffortEffectiveSource, EvidenceUntrusted,
  AccessMeta, FamilyComparison, FamilyStatus, FallbackCause, ParseRepairs, Review, Severity, Stage, TierName, TierSource, Vendor,
} from './types.js';
import { CRITIC_VENDOR, describeDriftUnknown, EVIDENCE_UNTRUSTED_CAUSE_TEXT, REVIEW_SCHEMA_ID } from './types.js';
import { VERDICT_LABEL } from './round-verdict.js';
import { agentById } from './agents/registry.js';
import { FINDING_FIELDS, VENDOR_NOISE_KEYS } from './parse.js';

/**
 * 整份回退成因的人读名（设计 §6.5）。横幅、`.fallback-items.md` 抬头与 review.ts 的告警共用这一份，
 * 三处各写一份文案就会漂。
 */
export const FALLBACK_CAUSE_LABEL: Record<FallbackCause, string> = {
  no_json_object: '回答里没有 JSON 对象',
  json_syntax: 'JSON 语法错误，按字面还原非法转义后仍无法解析',
  root_invalid: 'JSON 根对象不符合 trivium.review.v2（缺必填字段、取值不合，或带了不属于结论的字段）',
  finding_unaddressable: '有意见的编号不可用（缺 id、形状不合或不是对象），无法逐条降级',
  foreign_prefix: '意见编号前缀不属于本侧',
};

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
  /**
   * 逐条降级的意见（设计 §6.5）。**省略 = 没有**：它们不在 `review.findings` 里，
   * 单列在「不合格意见」一节，保留原编号、标出不合格的字段。
   */
  degradedFindings?: readonly DegradedFinding[];
  /** 所选候选在校验前做过的无损修复；零值或省略都不渲染 */
  parseRepairs?: ParseRepairs;
  /** 整份回退的成因（`review === null` 时才有意义） */
  parseFallbackCause?: FallbackCause;
  result: CriticResult;
  modelRequested: string | null;
  /** 旧名：思考等级请求值，有值时才写（M11 第 6 步起与 `effortRequested` 同值） */
  effort?: string | null;
  /*
   * 档位与思考等级一组（M11 第 6 步，设计 6.5 / 6.7.1）：与 run.json 同一次计算、同值，渲染时恒写（null 也写）。
   * **必填**：调用方要显式给 null，不留「没传」这一态——front-matter 里的缺席只属于 M11 第 6 步之前渲染的旧件。
   */
  effortRequested: string | null;
  effortEffective: string | null;
  effortEffectiveSource: EffortEffectiveSource | null;
  tier: TierName | null;
  tierSource: TierSource | null;
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
  /**
   * 跑后复算比不了改了哪些文件（EV-139）：给了就把正文旗标换成「漂移无法判定」并带原因。
   * 只影响正文，front-matter 仍只写 `drift`，不加新键（回显键表与渲染绑定不动）。
   */
  driftUnknown?: DriftUnknownReason;
  /** 路径级 deny 是否实际生效（§10.2 要求逐侧标注） */
  peerDeny: boolean;
  consultedUnverified: boolean;
  /**
   * 本侧两条核验通道的降级档位（§11.1，M8 第 2 步）。
   * 省略时按「两条都可用」渲染——结构化轨迹两家的现状，行为等价。
   */
  verification?: {
    readonly: 'ok' | 'unavailable';
    path: 'ok' | 'partial' | 'unavailable';
    /** `unavailable` 的成因——三种成因的横幅文案各不相同，见下方渲染处 */
    pathCause?: 'command-trace' | 'no-counts' | 'no-path-bearing-calls';
    /** 证据不可信（EV-188）：只在成立时给，front-matter 条件键与横幅各一处 */
    untrusted?: EvidenceUntrusted;
  };
  /**
   * 禁读核验的结论（设计 §10.1.1）。
   *
   * **与 `peerDeny` 正交**，不可混用：后者说的是「路径级 deny 这个机制有没有生效」
   * （本机两家恒 false），本字段说的是「这一侧实际有没有碰到禁读面」。
   * 此前 front-matter 与横幅里只有前者，于是「碰没碰」在文档上无处可查——
   * 而那恰恰是裁决者最需要知道的一件事。
   *
   * `voiding` 决定横幅说哪一句：命中对端产物（第①②类）说「本侧结论作废」，
   * 命中编排器状态或凭据文件说「记一笔、不影响结论」。
   * 省略本字段 = 该侧没扫或没命中，两者都不渲染横幅。
   */
  peerLeak?: {
    hit: boolean;
    /** 走哪条通道命中的：读取路径、命令文本，还是两条都有 */
    via: 'path' | 'command' | 'both';
    /** 最重的那一类（同一侧一轮可命中多类，处置取最重档） */
    category: DenyCategory;
    /** 是否属于会让该侧结论作废的类别 */
    voiding: boolean;
    paths: string[];
    /** 命令通道的命中原文。`command-trace` 一族只有这一项，`paths` 恒空 */
    commands: string[];
  };
  /**
   * 共同阻断这一档本轮的执行状态（§6.6 规则 7 / §12.1）。
   *
   * 渲染发生在运行结束时，那时裁决表还没写——所以这里只可能是
   * `pending`（够两家、等裁决表）或 `skipped-insufficient-sides`（不够、这一档不做）。
   * 只有后者进 front-matter：它意味着裁决者本轮少一层防线，必须看得见。
   */
  jointCheck?: {
    state: 'pending' | 'checked-none' | 'checked-found' | 'skipped-insufficient-sides';
    effective_sides: number;
  };
  heterogeneous: boolean | FamilyStatus;
  access?: AccessMeta;
  familyComparisons?: FamilyComparison[];
  overrideReason?: string | null;
}

function degradedCount(input: Pick<RenderInput, 'degradedFindings'>): number {
  return input.degradedFindings?.length ?? 0;
}

/**
 * 这次修复里有没有**审查员造成的**那一类：剥掉了编排器回显字段，或还原了非法转义。
 *
 * 厂商注入字段（agy 的 `toolAction` / `toolSummary`）的剥离是常态——实测 agy 每轮都注入——
 * 它照样恒写进 run.json 的 `parse_repairs`，但不进文档横幅与 front-matter：每份 gemini 文档都挂一条
 * 修复警示，会稀释真正要看见的那一行（与 `verification` 档位只在降级时渲染同口径）。
 */
function hasReviewerRepairs(r: ParseRepairs | undefined): r is ParseRepairs {
  if (!r) return false;
  const vendor = new Set<string>(VENDOR_NOISE_KEYS);
  return r.unescaped_backslashes > 0 || r.stripped_fields.some((k) => !vendor.has(k));
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
    schema: REVIEW_SCHEMA_ID,
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
    model_effective: ['requested', 'unverified'].includes(input.result.model_effective_source) ? null : input.result.model_effective,
    model_effective_source: input.result.model_effective_source === 'requested' ? 'unverified' : input.result.model_effective_source,
    ...(input.result.native_model ? { native_model: input.result.native_model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    // 档位与思考等级一组（M11 第 6 步）：恒写；生效值只取回读（`effortReadback`），codex / claude 恒 null + unverified
    effort_requested: input.effortRequested,
    effort_effective: input.effortEffective,
    effort_effective_source: input.effortEffectiveSource,
    tier: input.tier,
    tier_source: input.tierSource,
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
    /*
     * 整份回退的一侧没有结论，如实写 null（EV-247）。此前补一个 `request-changes`——v1 时代无人消费、只是失实；
     * v2 起结论要计票，伪造的一票会改变整轮判定，计票只读结构化结论（`round-verdict.ts`），这里也不再伪造。
     */
    verdict: input.review?.verdict ?? null,
    // 只数合格意见；逐条降级的条数另记在 findings_degraded（它们的 severity 可能正是不合格的那个字段）
    findings_count: countSeverities(input.review),
    /*
     * 解析与降级的三个键（设计 §6.5；解析回退逐条降级计划 r2 §3.5），与 `consulted_unverified`
     * 同款条件展开：常态不出现，出现就是要看见的那一行。三个键同批进 `parse.ts` 的
     * `ECHOED_ORCHESTRATOR_KEYS`——审查员照着落盘文档回显它们时要被剥掉，而不是整份判死。
     */
    // 编号数组，与 run.json 的 critics[c].findings_degraded 同型（代码双审 r1 CODEX-03：此前是条数，同名异型）
    ...(degradedCount(input) > 0 ? { findings_degraded: input.degradedFindings!.map((d) => d.id) } : {}),
    degraded: input.degraded,
    parse_fallback: parseFallback,
    ...(parseFallback && input.parseFallbackCause ? { parse_fallback_cause: input.parseFallbackCause } : {}),
    ...(hasReviewerRepairs(input.parseRepairs) ? { parse_repairs: input.parseRepairs } : {}),
    // 诚实边界：本机两侧路径级 deny 均不可用，这里如实记 false（§10.2）
    peer_deny: input.peerDeny,
    drift: input.drift,
    ...(input.consultedUnverified ? { consulted_unverified: true } : {}),
    /*
     * 降级档位只在**降级时**出现——与 `consulted_unverified` 同款条件展开。
     * front-matter 是审计凭证，恒出现的 `ok` 会稀释真正要看见的那一行。
     */
    ...(input.verification?.readonly === 'unavailable' ? { readonly_verification: 'unavailable' } : {}),
    ...(input.verification?.path === 'unavailable' ? { path_verification: 'unavailable' } : {}),
    ...(input.verification?.path === 'partial' ? { path_verification: 'partial' } : {}),
    // 证据不可信（EV-188，设计 §6.5 登记）：同款条件展开，同批进 parse.ts 的 ECHOED_ORCHESTRATOR_KEYS
    ...(input.verification?.untrusted ? { evidence_untrusted: { cause: input.verification.untrusted.cause, tools: input.verification.untrusted.tools } } : {}),
    /*
     * 禁读核验结论（设计 §6.5 / §10.1.1）。与 `peer_deny` **正交**——
     * 后者只说「路径级 deny 有没有生效」，不说「有没有泄漏」；
     * 此前 front-matter 里只有前者，于是「这一侧碰没碰禁读面」在文档上无处可查。
     */
    ...(input.peerLeak && input.peerLeak.hit
      ? {
          peer_leak: {
            hit: true,
            via: input.peerLeak.via,
            category: input.peerLeak.category,
            paths: input.peerLeak.paths,
            ...(input.peerLeak.commands.length > 0 ? { commands: input.peerLeak.commands } : {}),
          },
        }
      : {}),
    /*
     * 共同阻断这一档本轮做没做（设计 §6.6 规则 7 / §12.1）。
     *
     * **上一轮承诺补、没补**——裁决件写着「已加」而代码里只加了 `commands`。
     * 补的理由：裁决者读的是这份单侧文档，而「本轮有效侧不足、这一档没做」
     * 直接决定他还剩几层防线。它在 run.json 里有、在人读面上没有，
     * 等于要求裁决者去翻机读留痕才知道自己少了什么。
     *
     * 只在**不是常态**时渲染：`pending`（够两家、等裁决表）是正常路径，
     * 恒出现会稀释真正要看见的那一行——与上面两个 `verification` 档位同口径。
     */
    ...(input.jointCheck && input.jointCheck.state !== 'pending'
      ? {
          joint_check: {
            state: input.jointCheck.state,
            effective_sides: input.jointCheck.effective_sides,
          },
        }
      : {}),
    heterogeneous: input.heterogeneous,
    ...(input.access ? { access: input.access } : {}),
    ...(input.familyComparisons ? { family_comparisons: input.familyComparisons } : {}),
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

> ${criticLabel(input.critic)} ｜ 回读模型 \`${['requested', 'unverified'].includes(result.model_effective_source) ? '未知' : result.model_effective ?? '未知'}\` ｜ 请求模型 \`${input.modelRequested ?? '未指定'}\`
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
  if (review === null) {
    flags.push(
      '**解析降级**：本侧输出未能解析为结构化结论，下方为原文。该侧不参与阻断判定。' +
        (input.parseFallbackCause ? `成因：${FALLBACK_CAUSE_LABEL[input.parseFallbackCause]}。` : ''),
    );
  }
  const nDegraded = degradedCount(input);
  if (review !== null && nDegraded > 0) {
    flags.push(
      `**逐条降级**：本侧有 ${nDegraded} 条意见不合 schema，单列在「不合格意见」一节，` +
        '保留原编号、须逐条裁决，但不参与阻断与共同阻断判定。',
    );
  }
  if (review !== null && hasReviewerRepairs(input.parseRepairs)) {
    const parts: string[] = [];
    if (input.parseRepairs.stripped_fields.length > 0) {
      parts.push(`剥掉根字段 ${input.parseRepairs.stripped_fields.map((k) => `\`${k}\``).join('、')}`);
    }
    if (input.parseRepairs.unescaped_backslashes > 0) {
      parts.push(`按字面还原非法转义 ${input.parseRepairs.unescaped_backslashes} 处`);
    }
    flags.push(`**解析前做了无损修复**：${parts.join('；')}（详见 front-matter 的 \`parse_repairs\`）。`);
  }
  if (!input.evidenceOk) flags.push('**Agent 执行证据不足**：本侧不得计为合格双审的一半。');
  if (input.driftUnknown) {
    flags.push(
      `**审查期间的工作树漂移无法判定**（${describeDriftUnknown(input.driftUnknown)}）：` +
        '比不了改了哪些文件，按 on_drift_related 处置。本结论对应送审时刻的快照。',
    );
  } else if (input.drift) {
    flags.push('**审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。');
  }
  if (!input.peerDeny) {
    flags.push(
      '**路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，' +
      '对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。',
    );
  }
  if (input.peerLeak?.hit && input.peerLeak.voiding) {
    /*
     * **命令通道说「提到」，不说「读到」**（r2 代码双审 GLM-06 ≡ CODEX-06）。
     *
     * 措施 b 的判据是「命令原文里出现了禁读条目的拼写」——`git show HEAD:<file>`
     * 走 git 对象库，文件系统上根本没有发生读取；命令也可能失败、被拒、
     * 或那个路径只是作为参数被提及。处置相同（提到即作废，因为证明不了没读到），
     * 但**留痕不能把判据说成比它实际更强的事实**：
     * 事后复盘的人据此写裁决，而「读到了」与「提到了」是两个不同的断言。
     */
    const viaText =
      input.peerLeak.via === 'command'
        ? '命令文本里**提到**了对方产出（措施 b：提到即作废——经 git 对象库等方式取值不留文件系统读取痕迹，证明不了没读到）'
        : input.peerLeak.via === 'both'
          ? '轨迹中**读到**了对方产出，命令文本里也提到了（两条通道同时命中）'
          : '轨迹中**读到**了对方产出（措施 a：读取路径通道）';
    flags.push(
      `**本侧结论作废**：${viaText}。` +
        '它作为「第二只独立眼睛」的身份已不可采信——**这与它每条意见是否属实无关**：' +
        '意见仍需逐条裁决，但不得以「另一侧也这么说」为由采信本侧结论，' +
        '本侧也不计入共同阻断的独立来源。命中明细见 front-matter 的 `peer_leak`。',
    );
  } else if (input.peerLeak?.hit) {
    const verb = input.peerLeak.via === 'command' ? '命令文本里提到了' : '读到了';
    flags.push(
      `**${verb}禁读清单内的文件，但不影响本侧结论**：命中的是编排器状态文件或凭据文件，` +
        '不含任何审查意见，因此不损害背靠背独立性。记此一笔供审计，无需处置。',
    );
  }
  if (input.verification?.readonly === 'unavailable') {
    flags.push(
      '**只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。' +
        '只读保障从三重降到两重（指纹比对仍有效）。',
    );
  }
  if (input.verification?.path === 'unavailable') {
    /*
     * **三种成因各说各的**（r2 代码双审 GLM-03 ≡ CODEX-07）。
     *
     * 上一版只有一句话，写的是 `command-trace` 那一种的成因（「读取路径只存在于
     * 命令文本里」），而另外两种走到这里会读到一句与自己无关的解释：
     * 适配器没采集计数、以及本轮压根没有必带路径的调用。
     * 前者要修代码、后者根本不是缺陷——同一句话把三件事说成了一件。
     */
    flags.push(
      input.verification.pathCause === 'no-counts'
        ? '**路径核验档位不可判**：本侧没有报出「必带路径的读调用」计数——' +
            '要么这份留痕早于该计数接线，要么该侧适配器没采集。' +
            '这不是「核验通过」也不是「核验失败」，是**没测**：请核对该侧适配器的覆盖率采集。'
        : input.verification.pathCause === 'no-path-bearing-calls'
          ? '**路径核验本轮无探测面**：本侧一次「必然带路径」的读调用都没有（纯搜索/列目录轮次），' +
            '措施 a 没有可核验的对象。**这不是缺陷**——但也不能算核验通过：没测到不等于测出来没有。'
          : '**路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，' +
            '禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。',
    );
  }
  if (input.verification?.untrusted) {
    /*
     * 证据不可信（EV-188）：不作废、不判失守，但裁决者读的是这份单侧文档——两条阴性结论打了折这件事要在文档上看得见，
     * 不能只躺在 run.json 里。
     */
    // 文案按成因取（代码双审 CODEX-F01 原文 CODEX-02）
    const ut = EVIDENCE_UNTRUSTED_CAUSE_TEXT[input.verification.untrusted.cause];
    flags.push(
      `**证据不可信（${ut.label}）**：本侧${ut.what} ${input.verification.untrusted.tools.map((t) => `\`${t}\``).join('、')}。` +
        `${ut.blind}——` +
        `本侧「没命中禁读面」「没有写事件」两条阴性结论打折。结论保留、不作废，意见照常逐条裁决；明细见该侧 trace.json 的 \`${ut.where}\`。`,
    );
  }
  if (input.verification?.path === 'partial') {
    flags.push(
      '**路径提取不完整**：本侧「必然带路径」的读调用里，有一部分提不出路径——' +
        '通常意味着厂商改了工具的参数名，而我们的提取器还没跟上。' +
        '本侧的禁读核验因此**不完整**：没命中不等于没读过。请核对适配器的路径键名表。',
    );
  }
  if (typeof input.heterogeneous === 'boolean') {
    flags.push(`**旧版名义族判定**：${input.heterogeneous ? '异族' : '同族'}（旧版启发式，不按新判据解释）。`);
  } else if (input.heterogeneous !== 'different-family') {
    flags.push(
      `**模型族 ${input.heterogeneous}**${input.overrideReason ? `：${input.overrideReason}` : ''}；告警继续。`,
    );
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

**结论**：${review.schema === REVIEW_SCHEMA_ID ? `${VERDICT_LABEL[review.verdict]}（\`${review.verdict}\`）` : `\`${review.verdict}\``}`);

  if (review.findings.length === 0 && nDegraded > 0) {
    // 交了意见、只是全部降级：不能说「未发现问题」（解析回退逐条降级计划 r2 §3.5）
    parts.push(`## 审查意见

合格意见 0 条；本侧另有 ${nDegraded} 条意见逐条降级，见下方「不合格意见」。`);
  } else if (review.findings.length === 0) {
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

  if (nDegraded > 0) parts.push(renderDegradedSection(input.degradedFindings!));

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

/** 「不合格意见」表格单元格的长度上限 */
const CELL_MAX = 200;

const PROBLEM_KIND_LABEL: Record<DegradedFinding['problems'][number]['kind'], string> = {
  missing: '缺失',
  invalid: '取值不合法',
  extra: '多余字段',
};

/**
 * 「不合格意见」一节（设计 §6.5；解析回退逐条降级计划 r2 §3.5）。
 *
 * **原值照录、不改写**：缺的写「（缺失）」，不合法的值原样列出并标「（不合法）」，非字符串值 JSON 化。
 * 裁决者要据此判断这条意见本身成不成立——它只是某个字段不合 schema，内容仍是审查员的原话。
 */
function renderDegradedSection(items: readonly DegradedFinding[]): string {
  const out: string[] = [
    `## 不合格意见（逐条降级，共 ${items.length} 条）

> 下列意见不合 \`${REVIEW_SCHEMA_ID}\`：保留原编号、**仍须逐条裁决**（接受要写落点），
> 但**不参与阻断与共同阻断判定**——其中声称 blocker 的，被驳回也不会触发共同阻断告警。`,
  ];
  for (const d of items) {
    const bad = new Map<string, string>();
    for (const p of d.problems) if (!bad.has(p.field)) bad.set(p.field, PROBLEM_KIND_LABEL[p.kind]);
    const raw = d.raw;
    const str = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
    /*
     * 表格单元格：值是形状不合 schema 的原文，可能含竖线、反引号、换行或很长（代码双审 r1 CODEX-05 ≡ GLM-02）。
     * 竖线转义、不用反引号包裹（值里的反引号会截断包裹）、换行压平、超长截断并指向旁路文件；
     * 段落（问题 / 依据 / 建议）不截断——那是审查员的原话，裁决者要读全文。
     */
    const cell = (k: string): string => {
      if (!(k in raw)) return '（缺失）';
      let v = str(raw[k]).replace(/\s*\n\s*/g, ' ');
      if (v.length > CELL_MAX) v = `${v.slice(0, CELL_MAX)}…（全文见 .degraded.json）`;
      v = v.replace(/\|/g, '\\|');
      return bad.has(k) ? `${v}（不合法）` : v;
    };
    const para = (k: string): string => {
      if (!(k in raw)) return '（缺失）';
      return bad.has(k) ? `${str(raw[k])}（不合法）` : str(raw[k]);
    };
    const known = new Set(FINDING_FIELDS);
    const extras = Object.keys(raw).filter((k) => !known.has(k));
    out.push(`### ${d.id} · 不合格

**不合格之处**：
${d.problems.map((p) => `- \`${p.field}\`：${PROBLEM_KIND_LABEL[p.kind]}（${p.message}）`).join('\n')}

| 项 | 内容 |
| :--- | :--- |
| 严重度 | ${cell('severity')} |
| 位置 | ${cell('location')} |
| 类别 | ${cell('kind')} ｜ 层次 ${cell('layer')} |
| 置信度 | ${cell('confidence')} |

**问题**：${para('problem')}

**依据**：${para('evidence')}

**建议**：${para('suggestion')}${
      extras.length > 0 ? `\n\n**多余字段**：${extras.map((k) => `\`${k}\` = ${str(raw[k])}`).join('；')}` : ''
    }`);
  }
  return out.join('\n\n');
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
