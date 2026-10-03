/**
 * `gate`：闸门状态机与裁决完整性校验（设计 §8.4 / §8.6）。
 *
 * §8.6 的算法是六项硬失败 + 两项默认 warning。按修订计划 §2.2（意见 AGY-04）
 * 补上**校验集合的拆分顺序**：先滤除 `parse_fallback` 的虚拟编号再做差集，
 * 否则那些合法的 `<前缀>-F<n>` 会被判成「多余 id」；并显式支持 `findings: []`。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { agentById, DEFAULT_DRIVER, entryCommandOf, findingPrefixAlternation, type AgentId } from './agents/registry.js';
import { DEFAULT_CRITICS, VOIDING_DENY_CATEGORIES, type Config, type CriticId, type Disposal, type DispositionRow, type Review, type RunMeta, type Stage } from './types.js';
import { isFallbackId, parseDisposition, type ParsedDisposition } from './disposition.js';
import { checkRecordedArtifacts, listStageArtifacts, metaDir, type ArchiveLayout, type TamperedArtifact } from './archive.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { dispositionKindForStage, parseArtifactName } from './naming.js';
import { checkReviewIntegrity, parseReview } from './parse.js';
import { validateDispositionFrontMatter } from './schemas.js';

// ─────────────────────── 只读失守的处置句（单一来源） ───────────────────────

/**
 * `readonly_breach` 那条 failure 的处置判据句，**`gate --check` 与两处 Hook 共用这一份**
 * （收工闸门文案区分只读失守计划 r2 §2.3，计划双审 CODEX-01）。
 *
 * 这句话的上下文与历次更正记在 `checkAdjudication` 推这条 failure 的地方；它被单点改过四次，
 * 让 Hook 另抄一份就会在无人察觉时分叉。改它即同时改了 `gate --check` 的输出与
 * `hook-stop` / `hook-pre-commit` 的失守段——这正是要的。
 *
 * 两处 Hook 失守段里「gate --check 对只读失守一律判失败」那半句，陈述的是 `checkAdjudication`
 * 对 `readonlyBreach.hit` 无条件推 failure 这件事；将来若加豁免出口，那半句要同改
 * （`hooks.ts` 的 `BREACH_UNFIXABLE` 旁有互指注释，`gate-loop` 集成用例会先红）。
 */
export const READONLY_BREACH_TRIAGE =
  '处置：先核对 run 元数据的 snapshot.drift 与工作区是否确有改动——确有则清理后重跑审查。' +
  'drift 为 false 只排除了「未被 .gitignore 忽略的文件被改」，不足以判定误报：git 树比对看不见被 ignore 的产物目录，' +
  '还须核调用记录本身是否真的写入、目标是否存在、是否被 ignore，确认后再按 BACKLOG EV-75 登记重跑。';

/** 失守调用记录的展示：至多 8 条、超出加「…」，为空写「（run 元数据未记录）」。与 Hook 失守段同一口径 */
export function breachRecordsText(files: readonly string[]): string {
  return files.length > 0 ? files.slice(0, 8).join('、') + (files.length > 8 ? '…' : '') : '（run 元数据未记录）';
}

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
  | 'missing_review_json'
  | 'readonly_breach';

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
    | 'joint_check_degraded'
    /** 运行期写进 run.json `gate.warnings` 的标注，原样透传（如「本轮原稿不在保护集」） */
    | 'run_warning'
    /** 本轮期望的审查文档集为空（run 元数据读不出，或没有一侧落了审查文档），`addresses` 只核非空（EV-134） */
    | 'addresses_unchecked'
    /** 本轮有逐条降级的意见：仍须逐条裁决，但不参与阻断与共同阻断判定（设计 §6.5） */
    | 'degraded_findings';
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
  /** 本轮逐条降级的意见编号（按原编号进期望集，不在 `structuredIds` 里——那里只有合格意见） */
  degradedIds: string[];
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
  /**
   * 本轮逐条降级的意见编号（设计 §6.5；解析回退逐条降级计划 r2 §3.4），由 `loadRoundReviews` 取自
   * run.json 的 `critics[c].findings_degraded`。它们**不在** `reviews` 里（失去阻断资格的全部实现），
   * 却按原编号逐条进期望集：缺裁决、多余裁决、空表守卫都按「合格 ∪ 降级」判。
   *
   * **必填**：做成可选参数，漏传就静默退回只核合格编号——降级意见整批掉出期望集而闸门照绿，
   * 正是 `voidedSides` / `reviewDocs` 两处注释记着的那个教训。没有就传 `[]`。
   */
  expectedDegradedIds: readonly string[];
  /** run.json 记录跑过、却读不到结构化结论的一侧——那是留痕被动过，必须失败 */
  missingSides?: CriticId[];
  /** 本轮 run_id：裁决件 front-matter 的 run_id 必须与之一致，否则把上一轮的裁决件抄过来也能过 */
  runId?: string;
  /**
   * 本轮**期望**裁决件 `addresses` 应答的审查文档文件名（EV-134，由 `loadRoundReviews` 派生，见 `expectedReviewDocs`）。
   *
   * **必填、可为 null**：做成可选参数，漏传就静默退回「只核非空」——本文件 `voidedSides` 那段注释记着同一个教训。
   * null 或空数组都表示「期望集为空」（run 元数据读不出，或本轮没有一侧落了审查文档），此时只核非空并出一条告警。
   */
  reviewDocs: readonly string[] | null;
  /**
   * 本轮轮次是否由用户用 `--run-id` **钉住**（第 3 轮 GLM-04）。
   *
   * 只影响 `missing_disposition` 的文案分档：没钉住时，轮次取自「最新一次运行」，
   * 而那可能是一份 worker 崩溃前落下的、什么裁决件都不会有的骨架——此时该提示
   * 用 `--run-id` 指回更早的完整轮次，否则会把「其实想验上一轮」的人
   * 引去补一份不必要的裁决件。**钉住了就不提**：那时 rerunIndex 恰恰来自
   * 他给的那份留痕，再劝他用同一个旗标是把人推向已经用过的路
   * （第 2 轮 CODEX-06 的同款）。
   */
  runIdPinned?: boolean;
  /**
   * 当轮 Driver。裁决件后缀与它一致（计划 §9.1）。
   * 缺省 `claude` 与重构前行为逐项相同；M10a 第 3 步起四家均可为 Driver，由调用方按留痕传入。
   */
  driver?: AgentId;
  /**
   * 本轮是否检出**只读失守**（run 元数据 `guard.readonly_breach`）及受影响文件。
   *
   * 由 `loadRoundReviews` 一并带出（与 `voidedSides` 同理：可选参数让漏传静默成功）。
   * 此前这一格只有渲染面（`summarizeRun` / `report` / console 告警），没有任何
   * 失败面消费它——真失守与假失守走同一条路，闸门都绿（M9 第 6 步验收留痕实证；
   * 代码双审 CODEX-02 ≡ AGY-02 ≡ GLM-02）。设计 §1.2 与 AD-06 写的落点就是这里。
   *
   * **只看轨迹确诊的阳性**（`write_events` 非空）：指纹漂移那类「无法归因」的疑似
   * 本来就不进这个布尔位，仍走告警。
   *
   * 该字段在 run.v1 / run.v2 两版契约里都**必填**，`readRunMeta` 校验不过即 null——
   * 所以不存在「旧留痕缺字段」这一格（第 2 轮 CODEX-F01-②）：历史轮次按当年刻下的布尔判；
   * 留痕整份读不出时 `missingSides` 先行兜底。漏传本参数才按不拦处理，接线由 cli 两处调用点负责。
   */
  readonlyBreach?: { hit: boolean; files: string[] };
  /**
   * run.json `gate.warnings` 里运行期写下的标注，原样作为 `run_warning` 告警透传
   * （M10a 第 2 步代码双审 r2 GLM-04：此前该字段只写不读，「如实标注」没有读者）。
   * 由 `loadRoundReviews` 带出，接线同 `readonlyBreach`。
   */
  runWarnings?: string[];
}

export async function checkAdjudication(input: GateCheckInput): Promise<GateCheckResult> {
  const { cfg, layout, stage, rerunIndex, reviews } = input;
  const voidedSides = input.voidedSides ?? [];
  const failures: GateFailure[] = [];
  const warnings: GateWarning[] = [];
  // 排在一切早退之前：缺裁决件那一格也要看得见运行期标注
  for (const w of input.runWarnings ?? []) warnings.push({ code: 'run_warning', message: w });

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
            `${stage === 'code' ? '代码审' : '计划/根因审'}必须产出裁决件，即使全部驳回也要写明「无修改及原因」（§6.6 规则 6）。` +
            (input.runIdPinned
              ? ''
              : '\n  轮次取自最新一次运行。若那一轮尚未产出工件（例如 worker 中途崩溃），' +
                '可用 --run-id <id> 指回更早的完整轮次，而不是在这一轮补一份裁决件。'),
        },
      ],
      warnings,
      structuredIds,
      fallbackIds: [],
      degradedIds: [...input.expectedDegradedIds],
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
    /*
     * 先过 `trivium.disposition.v1`（形状与必填），再做本轮特有的一致性比对。
     *
     * **`schema` 与 `addresses` 两格与 ajv 有意重叠**，这是闸门层的双重防御，
     * 不是漏改（代码双审 AGY-05 要求标注、GLM-05 判「存量、本步不必处理」）：
     * ajv 那边报的是机读路径（`schema must be equal to constant`），
     * 这边报的是「哪一格不对、应该是什么」，闸门的失败消息要能让 Driver 直接照着补。
     * 代价是一份两处都错的件会各出一行。
     *
     * 同族的一处记在 `schemas.ts` 的 `checkDispositionRole`：`role` 的空串曾经也双报，
     * 那一处**改掉了**（交给 ajv 的 `minLength` 独占）——区别在于那里没有「点名哪一格」
     * 的额外价值，纯冗余；这里有。清理这两格属存量重构，不在 EV-66 范围。
     */
    const mismatches: string[] = [...validateDispositionFrontMatter(fm)];
    if (fm.schema !== 'trivium.disposition.v1') mismatches.push(`schema=${fm.schema}`);
    if (fm.topic !== layout.topic) mismatches.push(`topic=${fm.topic}（应为 ${layout.topic}）`);
    if (fm.stage !== stage) mismatches.push(`stage=${fm.stage}（应为 ${stage}）`);
    if (fm.kind !== kind) mismatches.push(`kind=${fm.kind}（${stage} 阶段应为 ${kind}）`);
    /*
     * ── role 必须与当轮 Driver 一致（第 2 轮 CODEX-04）──
     *
     * 「这份裁决件是谁写的」此前有**两个互不校验的来源**：
     *   · 文件名后缀 —— `listStageArtifacts` 解析出 parsed.role，上面第 2 步按 driver 定位；
     *   · front-matter 的 role —— 只过 validateDispositionFrontMatter。
     *
     * 两者之间没有任何机器判据，于是「文件名 -revised-codex.md + front-matter
     * role: claude」这份**自相矛盾**的件会通过闸门，且没有一处会发现。
     *
     * 那不是构造出来的形态：**EV-66 落地之前**，资产面写死的正是 `role: claude`
     * （`disposition.md.template`），三份 SKILL.md 与 `templates/README.md` 也都写
     * `…-revised-claude.md`，所以非缺省 Driver 照着资产写、再把文件名改对，
     * 得到的恰好就是这一份。
     *
     * ## 本条的地位在 EV-66 之后变了（M9 第 6 步前置，2026-09-19）
     *
     * 那一步把 `role` 从 `{"const":"claude"}` 放宽成「任意已登记 Agent」并补了注册表
     * 身份校验，资产面也改成了按当轮 Driver 取后缀。于是三条路的结局是：
     *   · 照资产写（名与 role 都是缺省 Driver）→ 第 2 步定位不到，报 missing_disposition；
     *   · 改名不改 role（谎报）              → 本条当场判红；
     *   · 诚实写 role: <当轮 Driver>          → **通过**（EV-66 之前卡在 schema 的 const）。
     *
     * 本条一个字都没改，却从「三道里的一道」变成了**作者身份唯一的判据**——
     * schema 的 const 从来不证明作者是谁，它只是逼非缺省 Driver 谎报。
     * 独立单测见 `gate.test.ts` 的 N-2 三格（删掉本条，N-2 第一格与 T-11 第 2 格同时红）。
     *
     * 上一版注释以现在时写着「资产面今天写死的正是 role: claude」「schema 仍把 role
     * 钉成 claude」——EV-66 落地后那两句成了失实留痕，本次一并改为过去时
     * （代码双审 GLM-01：删断言时立的「不留不存在的边界」原则，对注释同样成立）。
     */
    if (fm.role !== driver) {
      mismatches.push(
        `role=${String(fm.role)}（当轮 Driver 是 ${driver}；` +
          '文件名后缀与 front-matter 的 role 必须同指一人，否则这份留痕的作者身份自相矛盾）',
      );
    }
    if (input.runId && fm.run_id !== input.runId) {
      mismatches.push(`run_id=${String(fm.run_id)}（本轮应为 ${input.runId}；不得复用上一轮的裁决件）`);
    }
    if (!Array.isArray(fm.addresses) || fm.addresses.length === 0) {
      mismatches.push('addresses 为空（必须列出本件应答的审查文档）');
    } else {
      const a = checkAddresses(fm.addresses, input.reviewDocs, layout, stage);
      if (a.mismatch) mismatches.push(a.mismatch);
      if (a.warning) warnings.push(a.warning);
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
  /*
   * 只读失守 = 审查员写了工作树（AD-06：主仓库被写入即中止并列出受影响文件）。
   * 它是关于**运行**的事实，Driver 改裁决件修不了——但与 `degraded_round` 不同，
   * 这里必须是 failure 而不是 warning：失守侧的结论不可采信，放它进审批等于
   * 让一份可能被自己改过的代码通过闸门。处置是清理工作区后重跑审查。
   */
  if (input.readonlyBreach?.hit) {
    const files = input.readonlyBreach.files;
    /*
     * 文案与判据对齐（第 2 轮 CODEX-F01-①）：判据是「轨迹里出现白名单外的工具调用」，
     * 不是「工作区确有改动」——两者要分开说。`breached_files` 装的是 `工具名(参数)` 形式的
     * 调用记录，不是文件路径；该判据有过误报（M9 第 6 步 run 20260919T120643Z：
     * 五条记录全是 `StructuredOutput(...)`，`snapshot.drift.changed: false`），
     * 所以处置分两步：先看 `snapshot.drift` 与工作区，确有改动才谈清理。
     *
     * **`drift` 只能单向用**（EV-79 代码双审 r2 CODEX-09、r3 CODEX-r3-01）：
     * `judgeDrift` 是 git 树比对：`workTreeHash` 走临时索引 `add -A`，已跟踪文件与**未被忽略的**未跟踪文件
     * 都在内，**看不见被 `.gitignore` 忽略的文件**，`ownPrefixes` 还显式排除归档根与 `.trivium/`。
     * （此前这里写「只看已跟踪文件」，与实现相反；留痕与文案小修计划双审 r1 CODEX-01 ≡ AGY-01 更正。）
     * 于是 `dist/` 这类在 `.gitignore` 里的目录被真实递归删除同样 drift=false。
     * 所以 drift=false **只排除了「未被忽略的文件被改」这一种失守**，不足以推出误报——
     * 还要核调用记录本身是不是真的写、目标是否真实存在、是否被 ignore。
     * 拿 drift=false 直接判误报会把真失守降级，这正是本判据要防的事。
     *
     * 整跑布尔说不出是哪一侧（EV-75②），这里不暗示可以按侧清理。
     */
    failures.push({
      code: 'readonly_breach',
      message:
        '本轮轨迹记录到审查员调用了白名单外的工具（写事件记录），裁决不得进入审批。' +
        READONLY_BREACH_TRIAGE +
        '调用记录（非文件路径）：' +
        breachRecordsText(files),
    });
  }

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
        '而 run.json 记录该侧已产出结论。结论文件是裁决校验的唯一事实来源。' +
        /*
         * **恢复与重跑两个出口都要给，且说清重跑替代不了恢复**（M10a 第 2 步
         * EV-55 §3.2.2；代码双审 r2 CODEX-04 推翻了「只留重跑一轮」的简化）：
         * 该结论文件登记在本 run 的 `artifacts[]` 里，重跑只产生新 run，提交锚②
         * 会一直以「已丢失」拦下任何提交。恢复命令的目标含 `_meta`，会话里的常规写法
         * 会被 hook-pre-bash 拦下，所以明说在终端执行——措辞与 `checkArchiveIntegrity`
         * 的恢复指引同源。
         */
        '该文件已丢失或被改动：请在终端里用 `git restore <路径>` 恢复（会话里的常规写法会被 Hook 拦下）。' +
        // 调用写法按当轮 Driver（代码双审 r3 GLM-03）
        `也可以重跑一轮（既有工件不受影响，\`-r<N>\` 自动抬升），但重跑与 \`${entryCommandOf(input.driver, 'dual-abandon')}\` ` +
        '都解不开提交锚（它们不动已登记的工件），恢复仍是必经步骤。',
    });
  }

  const expectedFallback = input.expectedFallbackIds ?? null;
  const degradedIds = [...new Set(input.expectedDegradedIds)];
  /*
   * 逐条降级的编号同样计数（计划双审 r1 AGY-02）：一侧全部降级、又没有 F 单元时，漏计它们会让
   * 一张空裁决表过这一格。
   */
  const expectedCount = structuredIds.length + (expectedFallback?.length ?? 0) + degradedIds.length;
  if (parsed.rows.length === 0) {
    // 各侧都确无意见（合格与降级都为空、且无待裁决的回退单元）时，空表是合法的
    if (expectedCount > 0) {
      failures.push({
        code: 'unparsable_table',
        message:
          '裁决表为空或无法解析，但本轮共有 ' + expectedCount + ' 条意见需要裁决' +
          (expectedFallback && expectedFallback.length > 0 ? `（含 ${expectedFallback.length} 条降级编号）` : '') +
          (degradedIds.length > 0 ? `（含 ${degradedIds.length} 条逐条降级）` : '') + '。' +
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
  // 期望集 = 合格 ∪ 逐条降级（后者按原编号，同走下面的缺裁决 / 多余裁决与逐行校验，接受照样要落点）
  const idsSet = new Set([...structuredIds, ...degradedIds]);

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

  /*
   * 逐条降级的意见不在 `reviews` 里，上面的共同阻断一行不改即把它们排除在外——这件事必须说出来：
   * 裁决者要知道其中声称 blocker 的那几条被驳回，不会有任何告警。
   */
  if (degradedIds.length > 0) {
    warnings.push({
      code: 'degraded_findings',
      message:
        '下列意见不合 trivium.review.v1，已逐条降级：仍须逐条裁决，但不参与阻断与共同阻断判定' +
        '——其中声称 blocker 的，被驳回不会触发共同阻断告警',
      ids: [...degradedIds].sort(),
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    structuredIds,
    fallbackIds,
    degradedIds,
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
    lines.push(
      `✓ 裁决完整性校验通过（${r.rows.length} 条裁决，含 ${r.fallbackIds.length} 条降级编号` +
        `${r.degradedIds.length > 0 ? `、${r.degradedIds.length} 条逐条降级` : ''}）`,
    );
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
 * 本轮裁决件 `addresses` **应当**应答的审查文档文件名（EV-134，计划 r2 §6.4）。
 *
 * - **有效侧** = 入选侧里 `critics[c].status ∈ {ok, parse_fallback}` 的那些——审查文档落了盘的侧
 *   （`review.ts` 对每个走到渲染的侧都 `writeArtifact`，失败 / 超时侧只落 `_meta/…failed.json`）。
 *   解析回退侧、被判作废的侧、只读失守轮的各侧文档都在、意见也都要裁决，一律计入。
 * - **文件名取自 `run.json.artifacts[]`**，不按日期现拼：审查文档的日期取落盘时的本地日期、会跨零点，
 *   轮次撞名时实际落在抬升后的名字上；`artifacts[]` 登记的正是实际落盘名。
 *   只取位于 `<主题>/<阶段>/` 根（不在 `_meta/`）、非裁决件、后缀属于有效侧的条目——
 *   有效侧永远不含当轮 Driver，Driver 自己的原稿因此自然排除。
 *
 * 历史 171 份运行元数据复算过「有效侧数 = 阶段根登记文档数」零处不符（计划双审 r1 codex 侧）。
 */
export function expectedReviewDocs(layout: ArchiveLayout, stage: Stage, runMeta: RunMeta): string[] {
  const effective = criticsOf(runMeta).filter((c) => {
    const s = runMeta.critics[c]?.status;
    return s === 'ok' || s === 'parse_fallback';
  });
  const roles = new Set<string>(effective.map((c) => agentById(c)?.suffix ?? c));
  const stageRel = `${layout.topic}/${stage}`;
  const out: string[] = [];
  for (const a of runMeta.artifacts) {
    const rel = a.path.split(path.sep).join('/');
    if (path.posix.dirname(rel) !== stageRel) continue;
    const base = path.posix.basename(rel);
    const parsed = parseArtifactName(base);
    if (!parsed || parsed.kind !== null || !roles.has(parsed.role)) continue;
    if (!out.includes(base)) out.push(base);
  }
  return out;
}

/**
 * `addresses` 的判据（EV-134 (a) 严格档，计划 r2 §6.4）：每项都指向本轮某个有效侧的审查文档、不重复、
 * 份数 = 有效侧数。写法接受文件名，或以 `<主题>/<阶段>/<文件名>` 结尾的路径（glm 按模板照填的项目根相对路径）。
 *
 * 期望集为空（run 元数据读不出，或本轮没有一侧落了审查文档——纯文档跳过、全侧失败、停在 running 的骨架）时
 * **退回只核非空**并出告警：schema 要求 `addresses` 至少一项，严格判在那种轮次上没有任何诚实的写法能过
 * （计划双审 r1 CODEX-02）。
 */
function checkAddresses(
  addresses: readonly unknown[],
  expected: readonly string[] | null,
  layout: ArchiveLayout,
  stage: Stage,
): { mismatch: string | null; warning: GateWarning | null } {
  if (!expected || expected.length === 0) {
    return {
      mismatch: null,
      warning: {
        code: 'addresses_unchecked',
        message:
          '本轮没有可比对的审查文档（运行元数据读不出，或没有一侧落了审查文档），addresses 只核了非空。',
      },
    };
  }
  const stageTail = `${layout.topic}/${stage}/`;
  const seen = new Set<string>();
  const bad: string[] = [];
  const dup: string[] = [];
  for (const raw of addresses) {
    const item = String(raw).trim().split('\\').join('/');
    const base = path.posix.basename(item);
    const pathOk = item === base || item === `${stageTail}${base}` || item.endsWith(`/${stageTail}${base}`);
    if (!pathOk || !expected.includes(base)) {
      bad.push(String(raw));
      continue;
    }
    if (seen.has(base)) dup.push(String(raw));
    seen.add(base);
  }
  const missing = expected.filter((e) => !seen.has(e));
  if (bad.length === 0 && dup.length === 0 && missing.length === 0) return { mismatch: null, warning: null };

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`缺：${missing.join('、')}`);
  if (bad.length > 0) parts.push(`不是本轮的审查文档：${bad.slice(0, 6).join('、')}${bad.length > 6 ? ` 等 ${bad.length} 项` : ''}`);
  if (dup.length > 0) parts.push(`重复：${dup.join('、')}`);
  return {
    mismatch:
      `addresses 与本轮审查文档不符（${parts.join('；')}；份数 ${addresses.length}，本轮落了审查文档的有效侧 ${expected.length} 份）。` +
      `addresses 应逐一列出本轮每个出了结论的审核者的审查文档文件名（不是意见编号）：${expected.join('、')}。` +
      '若这是已提交的历史轮次，不要改已提交的裁决件——它按当时口径已审批，这条判据是 EV-134 之后才有的；' +
      '若是在途轮次，把 addresses 改成上面这些文件名后重跑 --check',
    warning: null,
  };
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
  /** 逐条降级的意见编号（读自 run.json 的 `findings_degraded`；run.json 读不出时读旁路 `.degraded.json`） */
  expectedDegradedIds: string[];
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
  /**
   * 只读失守（run 元数据 `guard.readonly_breach` + `breached_files`）。
   * 在这里带出而不是让调用方读：理由同 `voidedSides`——两个 `--check` 调用点
   * 各自去读就会各自漏。字段在两版契约里必填，读得出来的留痕都带它；
   * 留痕整份读不出（`runMeta` 为 null）时给 `{ hit: false, files: [] }`，
   * 那一格由 `missingSides` 判失败，不靠这里。
   */
  readonlyBreach: { hit: boolean; files: string[] };
  /** run.json `gate.warnings`（读不到 run.json 时为空） */
  runWarnings: string[];
  /**
   * 本轮期望 `addresses` 应答的审查文档文件名（EV-134）；run.json 读不到时为 null。
   * 在这里派生而不是让调用方算——理由同 `voidedSides`：两个 `--check` 调用点各自去算就会各自漏。
   */
  reviewDocs: string[] | null;
}> {
  const reviews: Partial<Record<CriticId, Review | null>> = {};
  const notes: string[] = [];
  const expectedFallbackIds: string[] = [];
  const expectedDegradedIds: string[] = [];
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
        /*
         * 重试结果三分（解析回退逐条降级计划 r2 §3.6）：
         *   · 全合格（含靠两类无损修复才合格的）⇒ 按结构化校验——既有行为；
         *   · **部分合格 ⇒ 仍按 F 编号**：这一轮当时判的是整份回退，run.json 里没有 `findings_degraded`，
         *     按结构化校验的话降级意见会**静默掉出期望集**——正是本主题要防的那一类；
         *   · 仍失败 ⇒ 按 F 编号——既有行为。
         * 重试同样要过前缀归属（与 review.ts 同一道后盾）：异前缀的结论按结构化校验会让冒名编号进期望集。
         */
        const prefixOk = retry?.ok ? checkReviewIntegrity(retry.review, c, retry.degraded).prefixOk : false;
        if (retry?.ok && retry.degraded.length === 0 && prefixOk) {
          reviews[c] = retry.review;
          notes.push(
            `${c} 侧当时被判 parse_fallback，但用当前解析器重试成功（${retry.review.findings.length} 条意见）——` +
              '按结构化结论校验。若该轮当时按 <前缀>-F<n> 裁决，这里报的缺裁决是口径差，不是漏裁',
          );
        } else {
          reviews[c] = null;
          expectedFallbackIds.push(...(await readFallbackIds(path.join(dir, `review-${c}-${runId}.fallback-items.md`))));
          notes.push(
            retry?.ok && retry.degraded.length > 0
              ? `${c} 侧当时被判 parse_fallback；用当前解析器重试得到 ${retry.degraded.length} 条逐条降级，` +
                  '该轮没有逐条降级留痕，维持回退口径：其意见按 <前缀>-F<n> 编号逐条校验'
              : `${c} 侧为 parse_fallback，其意见按 <前缀>-F<n> 编号逐条校验`,
          );
        }
      } else {
        reviews[c] = raw as Review;
        /*
         * 逐条降级的编号（设计 §6.5）：以 run.json 的 `findings_degraded` 为准（只写一次、在提交锚保护下）；
         * run.json 读不出时退而读旁路文件（尽力；那一格已由 missingSides 与审批路径的「留痕读不出即拒」兜底）。
         */
        const fromMeta = runMeta?.critics[c]?.findings_degraded;
        const ids = fromMeta ?? (runMeta ? [] : await readDegradedIds(path.join(dir, `review-${c}-${runId}.degraded.json`)));
        if (ids.length > 0) {
          expectedDegradedIds.push(...ids);
          notes.push(`${c} 侧有 ${ids.length} 条意见逐条降级（${ids.join(', ')}），按原编号逐条校验、不参与阻断`);
        }
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

  const readonlyBreach = {
    hit: runMeta?.guard?.readonly_breach === true,
    files: [...(runMeta?.guard?.breached_files ?? [])],
  };

  const runWarnings = [...(runMeta?.gate?.warnings ?? [])];
  const reviewDocs = runMeta ? expectedReviewDocs(layout, stage, runMeta) : null;

  return {
    reviews, notes, expectedFallbackIds, expectedDegradedIds, missingSides, degraded, voidedSides, readonlyBreach, runWarnings, reviewDocs,
  };
}

/**
 * 审批前复核两个抛错分支的**判别文字**（M10a 第 3 步，计划 r3 §3.1）。
 *
 * 导出成常量，函数与测试引用同一份：测试靠它们区分「第 1 步拒绝」与「第 2 步拒绝」，
 * 两处各抄一遍就会像计划 r2 那样一处带 Markdown 星号、一处不带，基线即红
 * （计划双审 r2 CODEX-02 ≡ AGY-01 ≡ GLM-01）。
 *
 * **唯一性的口径**：在本函数的各抛错分支之间唯一；作为全仓字面，靠的是落笔时 grep
 * 零命中，**不是机制保证**——以后别处写出同一串，判别只在本函数范围内仍成立。
 */
export const APPROVAL_CHECK_NO_RUN_ID = '推断不出 run_id 时不跳过复核';
export const APPROVAL_CHECK_META_UNREADABLE = '本轮运行元数据读不出，复核无从进行';

export interface ApprovalCheckInput {
  cfg: Config;
  layout: ArchiveLayout;
  stage: Stage;
  /** 要复核的那一轮。**null ⇒ 抛错拒绝，绝不跳过** */
  runId: string | null;
  /**
   * 该 run_id 是否由调用方钉住，原样透传给 `checkAdjudication`：
   * 它决定 `missing_disposition` 要不要提示「用 --run-id 指回更早轮次」（见 `GateCheckInput.runIdPinned`）。
   * approve 没有 `--run-id`、轮次取自闸门记录，传 true 以压掉那句不适用的提示。
   */
  runIdPinned: boolean;
  /** run_id 从哪儿来，进报错（如「最新一次运行」「本机闸门记录」） */
  runIdSource: string;
  /**
   * 两个抛错分支的出口文案，**由调用方给**（计划 r3 §3.2，计划双审 r1 CODEX-02）。
   *
   * 判定只有一份，出口却因调用点而异：`--await-approval` 缺 run_id 时可以「用 --run-id 指定」，
   * approve 没有 `--run-id`、`review --start` 也不抢占 awaiting_approval 的槽位。照搬一份文案
   * 就会给出走不通的出口。两个调用点的出口由下面的 `awaitApprovalRecovery` / `approveForkRecovery`
   * 构造（留痕读不出的出口计划 r2 §2.2）；读不出那一条都以 `meta.ts` 的共用出口段收尾。
   * 它只进报错文字，**不参与判定**。
   *
   * 排版：`missingRunId` 是首行不缩进的一段（本函数在前面补两格）；`unreadableRunMeta` 是
   * 每行自带缩进的整段（本函数原样接在后面）——共用出口段本身就是逐行缩进的。
   */
  recovery: { missingRunId: string; unreadableRunMeta: string };
}

/**
 * `gate --await-approval` 的两条出口（留痕读不出的出口计划 r2 §2.2）。
 *
 * 抽到这里而不是留在 `cli.ts`：`cli.ts` 末尾直接执行 `main`，测试导不进来；而读不出那一条
 * 只在竞态下可达（runId 取自 `latestRunMeta` 读得出的那份；`--run-id` 读不出在更早处硬失败；
 * 一份都读不出先撞 `cmdGate` 自己那一格），不抽出来就没有用例能咬住它的接线。
 * 上一版读不出这一条写的是「重跑一次该阶段双审」——重跑在 `review --start` 入口就被同一个
 * `corrupt` 判定拒绝，所以改成共用出口段。
 */
export async function awaitApprovalRecovery(
  layout: ArchiveLayout,
  stage: Stage,
  runId: string | null,
): Promise<ApprovalCheckInput['recovery']> {
  const { unreadableRunMetaExitAt } = await import('./meta.js');
  return {
    missingRunId: '用 --run-id <id> 显式指定，或先跑一次双审。',
    unreadableRunMeta: runId ? unreadableRunMetaExitAt(layout, stage, [runId]) : NO_RUN_ID_NO_FILE,
  };
}

/**
 * runId 为 null 时读不出那一条的占位（代码双审 r1 GLM-03）：今天被 `verifyRoundForApproval` 第 1 步先挡住、不可达，
 * 但不能拼共用出口段——没有文件可判成因，② 档「restore 上面列出的路径」会指向一份不存在的清单。
 */
const NO_RUN_ID_NO_FILE = '  没有 run_id，定位不到运行留痕文件，无从按成因处置。';

/**
 * `approve` 通过前复核的两条出口：本机闸门项与归档分叉的那一格（计划 r3 §3.2；
 * 留痕读不出的出口计划 r2 §2.2，计划双审 AGY-01 / AGY-04）。
 *
 * **两条分开写**：闸门项没有 run_id 时没有任何文件可判成因，拼三档成因文不对题（AGY-04），
 * 维持「abandon 后重跑」；闸门项的 run_id 读不出时，**先恢复、恢复后直接重新 approve**——
 * 复核没过时闸门保持等待审批，① 升级重装、② 终端 restore 之后这一轮的审查结论照样有效；
 * 上一版先给 abandon，会作废一轮有效的结论（AGY-01）。恢复不了才 abandon：它以闸门自己的
 * run_id 做比较-交换、不读这份留痕，总走得通；但 abandon 之后能不能重跑取决于该阶段最新一份
 * 留痕可不可读——读不出的若正是它，重跑同样撞 `review --start` 的 `corrupt` 判定。
 */
export async function approveForkRecovery(i: {
  layout: ArchiveLayout;
  topic: string;
  stage: Stage;
  /** 按闸门项记下的 Driver 选的 abandon 调用写法（`entryCommandOf`） */
  abandonCmd: string;
  runId: string | null;
}): Promise<ApprovalCheckInput['recovery']> {
  const { unreadableRunMetaExitAt } = await import('./meta.js');
  const abandon = `${i.abandonCmd} --topic ${i.topic} --stage ${i.stage} --reason '<说明分叉>'`;
  return {
    missingRunId:
      '本机闸门项没有记下 run_id：归档是正本、本机闸门是副本，两者已经分叉。\n' +
      '  approve 不接受 --run-id；--check 与 --await-approval 不会改写属于别的运行的闸门项。\n' +
      `  出口：${abandon}，然后重跑该阶段双审。\n` +
      '  这会留下一条 run_id 为空的放弃记录，请在 reason 里写明缘由。',
    unreadableRunMeta:
      '  本机闸门项指向的这一轮运行留痕读不出（归档是正本、本机闸门是副本）。' +
      'approve 不接受 --run-id；--check 与 --await-approval 不会改写属于别的运行的闸门项。\n' +
      '  先把它恢复成可读，恢复后直接重新 approve——复核没过时闸门仍在等待审批，这一轮的审查结论照样有效：' +
      "文件在而读不出，按下列成因处置；文件不在而 git -c core.quotePath=false status --porcelain -- '<路径>' 显示 D，" +
      "由用户在终端 git restore -- '<路径>' 后重新 approve。\n" +
      `  确认恢复不了（或文件从未有过，即本机闸门与归档分叉），才用 ${abandon} 作废这道闸门：` +
      '它不读这份留痕，总走得通，会留下一条 run_id 为那个读不出的值的放弃记录；' +
      '作废之后能否重跑取决于该阶段最新一份留痕可不可读——读不出的若正是它，重跑同样会被拒绝。\n' +
      (i.runId ? unreadableRunMetaExitAt(i.layout, i.stage, [i.runId]) : NO_RUN_ID_NO_FILE),
  };
}

export interface ApprovalCheckResult {
  /** 裁决齐备且本轮登记工件无一缺失或改动 */
  ok: boolean;
  runId: string;
  rerunIndex: number;
  result: GateCheckResult;
  tampered: TamperedArtifact[];
}

/**
 * 审批前复核：`approve`（通过）与 `gate --await-approval` **共用的唯一一份判定**
 * （M10a 第 3 步，M10 计划 r7 §4.3 / §4.4，演进设计 §9.4）。
 *
 * 顺序执行，**任何一步都没有跳过路径**：
 *
 *   1. runId 为 null ⇒ 抛错拒绝；
 *   2. 本轮运行元数据读不出 ⇒ 抛错拒绝（拿不到 driver 与轮次，不回落缺省 Driver）；
 *   3. `loadRoundReviews` + `checkAdjudication`（driver / 轮次取自该轮留痕）；
 *   4. `checkRecordedArtifacts`：**本轮** run.json 登记工件的 sha256 抽核；
 *   5. 两者都过才算 ok。
 *
 * ## 它保什么、不保什么
 *
 * 保「本轮裁决齐备」与「本轮登记工件未缺失、未改动」。**抽核范围只到本轮**：更早轮次的登记
 * 由 `hook-pre-commit` 的锚②在每次提交时全量核对，这里不重复——是取舍，不是完备核对。
 * **不保「审批来自人」**：approve 不校验调用来源（`approval.ts` 头注释）。
 */
export async function verifyRoundForApproval(i: ApprovalCheckInput): Promise<ApprovalCheckResult> {
  const { cfg, layout, stage, runId } = i;
  /*
   * 推断不出 runId 就**拒绝**，而不是跳过检查（审查意见 AGY-05 ≡ GLM-03，原在 cli.ts 的
   * `--await-approval` 分支，M10a 第 3 步随抽取原样带过来）。
   * `if (runId)` 那种写法等于留了个后门：只要让 runId 推断失败，
   * 整段裁决完整性校验就被绕过。
   */
  if (!runId) {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `找不到 ${stage} 阶段要复核的 run_id（来源：${i.runIdSource}），无法校验裁决完整性。\n` +
        `  ${APPROVAL_CHECK_NO_RUN_ID}——那等于给「跳过裁决直接审批」留后门。\n` +
        `  ${i.recovery.missingRunId}`,
    );
  }

  const { readRunMeta } = await import('./meta.js');
  const runMeta = await readRunMeta(layout, stage, runId);
  if (!runMeta) {
    /*
     * 比 `loadRoundReviews` 的宽松口径严（计划 r3 §5 偏差 5）：那里 run.json 读不到时
     * 交给 `missingSides` 判，这里连 driver 与轮次都拿不到，审批停点不该按猜测放行。
     * 本函数只点名；出口（含「别动锚」那一句）由调用方给，两个调用点都以 `meta.ts` 的共用出口段收尾
     * ——上一版这里内联的「不要删除或改写」已并进共用段（留痕读不出的出口计划 r2 §2.2，计划双审 CODEX-03）。
     */
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `${stage} 阶段 run ${runId}（来源：${i.runIdSource}）：${APPROVAL_CHECK_META_UNREADABLE}` +
        '（文件缺失、内容损坏，或不合 run.v1/v2 契约）。\n' +
        i.recovery.unreadableRunMeta,
    );
  }

  const { reviews, expectedFallbackIds, expectedDegradedIds, missingSides, degraded, voidedSides, readonlyBreach, runWarnings, reviewDocs } =
    await loadRoundReviews(layout, stage, runId);
  const result = await checkAdjudication({
    cfg, layout, stage, rerunIndex: runMeta.rerun_index, reviews,
    driver: runMeta.driver,
    runIdPinned: i.runIdPinned,
    degraded, voidedSides, readonlyBreach, runWarnings,
    expectedFallbackIds, expectedDegradedIds, missingSides, runId, reviewDocs,
  });
  const tampered = await checkRecordedArtifacts(layout, [
    { run_id: runId, stage, artifacts: runMeta.artifacts },
  ]);
  return { ok: result.ok && tampered.length === 0, runId, rerunIndex: runMeta.rerun_index, result, tampered };
}

/**
 * 本轮登记工件的抽核结果，人读渲染。
 *
 * 与 `hooks.ts` 提交锚②的两行同义（计划 r3 §5 偏差 3）：刻意不去改那个安全关键文件，
 * 代价是这两行展示文案有第二份。它不是判据，判据只在 `checkRecordedArtifacts`。
 *
 * **恢复出口分两档**（M10a 第 3 步代码双审 r4 CODEX-02）：审批停点上本轮工件通常还没提交，
 * 只给 `git restore` 的话照做必然失败、`missing` 那一格更无副本——唯一走得通的是作废后重跑。
 * 这里拿不到 git 状态，所以两档并列写清，不猜。提交锚那份文案面对的是「已提交」为主的时点，
 * 两份措辞因此不同，分叉登记在 M10a 第 3 步测试报告偏差 3。
 */
export function renderTamperedArtifacts(
  tampered: readonly TamperedArtifact[],
  /** 当轮 Driver：出口里的调用写法按它取（代码双审 r3 GLM-03）；缺省按缺省 Driver */
  driver?: string | null,
): string {
  if (tampered.length === 0) return '';
  const lines = tampered.map((t) =>
    t.kind === 'missing'
      ? `  · 已丢失：${t.relPath}（run ${t.runId} 记录过它，sha256 ${t.recordedSha256.slice(0, 12)}）`
      : `  · 已被改动：${t.relPath}（run ${t.runId} 记录 ${t.recordedSha256.slice(0, 12)}，现为 ${t.actualSha256?.slice(0, 12)}）`,
  );
  return (
    '本轮登记的审查工件与留痕不符（sha256 抽核，只核本轮）：\n' +
    lines.join('\n') +
    '\n  已落盘的审查工件不得删除或改动。出口按工件在 git 里的状态分两档（这里拿不到 git 状态，两档都写）：' +
    '\n  · **尚未提交过的（审批停点上的常态）或已丢失的**：没有副本可恢复——`git restore` 对未跟踪路径会直接失败。' +
    `\n    出口是 \`${entryCommandOf(driver, 'dual-abandon')}\` 作废这一轮后重跑；重跑按 -r<N> 抬升，既有工件一律不覆盖，不需要先删。` +
    '\n  · **已提交过的**：可用 `git restore <路径>` 恢复，**这一步请在终端里手动执行**——常规写法在会话里' +
    '\n    会被 hook-pre-bash 拦下；那条判据是按命令形态的启发式、并不完备，但换写法绕过它属于违规，不是出口。'
  );
}

/**
 * 从旁路 `.degraded.json` 读回逐条降级的编号——**只在 run.json 读不出时**才用（尽力而为）。
 * 读不到或形状不对即空：那一格的失败由 `missingSides` 与审批路径的「留痕读不出即拒」承担。
 */
async function readDegradedIds(p: string): Promise<string[]> {
  try {
    const j = JSON.parse(await fs.readFile(p, 'utf8')) as { findings?: { id?: unknown }[] };
    return (j.findings ?? []).map((f) => f.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
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

export type { Disposal };
