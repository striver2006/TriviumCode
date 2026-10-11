/**
 * 主题级复盘报告（设计 §5.1 `report`、§9.3、§15.2）。
 *
 * 输出：时间线、每轮意见数与严重度分布、采纳率、被驳回项与理由、
 * 降级与告警清单、耗时与 token 汇总、多审退化提示。
 *
 * ## 数据源只有 `.reviews/`
 *
 * 报告**不**重新调用任何 Agent、不读 `~/.trivium/runs/`（那是本机临时物，
 * 30 天后就没了），只读归档目录——这是 P4「工件即接口」的直接后果：
 * 换一台机器、换一个人，拿着同一份 `.reviews/` 必须能得出同一份报告。
 *
 * ## 读不到就说读不到
 *
 * 缺件、解析失败、单侧降级一律**如实列出**，不静默跳过也不补零。
 * 一份把缺失渲染成「0 条意见」的复盘会让人以为那一轮很干净（P5 不可伪装）。
 */
import path from 'node:path';
import type { AccessMeta, DriverDeclaration, FamilyComparison } from './types.js';
import { promises as fs } from 'node:fs';
import { ALL_AGENT_IDS, DEFAULT_DRIVER, agentByFindingId, type AgentId, type GuardLevel } from './agents/registry.js';
import { isReviewArtifact, listStageArtifacts, metaDir, stageDir, type ArchiveLayout } from './archive.js';
import { describeRunMetaCause, readRunMeta, readRunMetaDetailed, readTask, type TaskMeta } from './meta.js';
import { loadRoundReviews, readonlyBreachLabel } from './gate.js';
import { isFallbackId, parseDisposition } from './disposition.js';
import { measureAllPairs, type DivergenceReport } from './divergence.js';
import { summarizeVerify, type VerifyRecord } from './verify.js';
import { CRITICS, DEFAULT_CRITICS, STAGES, describeDriftUnknown, EVIDENCE_UNTRUSTED_CAUSE_TEXT, type CriticId, type Disposal, type EffortEffectiveSource, type RunMeta, type Severity, type Stage } from './types.js';

const SEVERITIES: readonly Severity[] = ['blocker', 'major', 'minor', 'nit'];
const DISPOSALS: readonly Disposal[] = ['接受', '驳回', '暂缓'];

/**
 * 逐侧思考等级一组（设计 13.2.1，M11 第 7 步）。**可选键照抄 run.json 的在场性**：
 * 键缺席 = 留痕早于 M11 第 6 步（旧留痕），`null` = 该侧没有这项事实——两态不得合流，
 * 所以这里不写 `undefined` 值、不做任何回落；JSON 输出里缺席的键也就不出现。
 */
export interface EffortFields {
  effortRequested?: string | null;
  effortEffective?: string | null;
  effortEffectiveSource?: EffortEffectiveSource | null;
  /** 旧名 `effort`（第 6 步之前只有 antigravity 侧写，是**请求值**）；只作请求列的注记，生效列从不读它 */
  effortLegacy?: string;
}

/** 一轮（同一 run_id）的复盘数据 */
export interface RoundReport {
  stage: Stage;
  rerunIndex: number;
  runId: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RunMeta['status'] | null;
  reviewMode: RunMeta['review_mode'] | null;
  /**
   * 本轮入选的审核者。与 `reviewMode` 分列渲染：前者答「审了谁」，
   * 后者答「入选的都成了吗」——把两件事挤进一列，就看不出 `full` 到底是
   * 三侧全成还是只选了一侧（AC-22）。
   */
  criticsSelected: CriticId[];
  /** 当轮 Driver（留痕原值；读不到元数据时为 null） */
  driver: AgentId | null;
  /**
   * `driver` 出自哪一版留痕（设计 13.2.1，M11 第 7 步）：`run.v1` 读进内存时 driver 由迁移补为缺省 Driver
   * ——v1 时代 Driver 是系统常量，这是事实而非回落，但聚合要注明「其中 N 轮为 run.v1 迁移」。读不到元数据时为 null。
   */
  driverSource: 'run.v3' | 'run.v2' | 'run.v1' | null;
  driverDeclaration?: DriverDeclaration;
  familyComparisons?: FamilyComparison[];
  requestedRoutes?: RunMeta['requested_routes'];
  /** 读不到 Driver 的原因（找不到 run.json / 读不出）；读得到时为 null。这类轮次在聚合里单独成组，不归给任何 Driver */
  driverUnknownReason: string | null;
  /**
   * 当轮 Driver 在这次运行时的有效护栏等级（M10b 第 3 步 B1，`run.v2` 的可选字段 `driver_guard_level`）。
   * 早于该步的留痕没有它，记 null、渲染为「—」——不补成 L1，缺失即「无从得知」。
   */
  driverGuardLevel: GuardLevel | null;
  degradedReason: string | null;
  /** 逐侧：生效模型、状态、耗时、意见数 */
  sides: ({
    critic: CriticId;
    status: string;
    modelEffective: string | null;
    modelRequested: string | null;
    access?: AccessMeta;
    familyStatus?: string;
    modelSource?: string;
    durationS: number;
    findings: number | null;
    /**
     * 逐条降级的意见数（设计 §6.5），取自 run.json 的 `critics[c].findings_degraded`；早于该字段的留痕与
     * 未解析成功的侧为 0。`findings` 只数合格意见，这一格不并进去——降级意见不参与严重度统计。
     */
    findingsDegraded: number;
    evidenceOk: boolean;
    failReason: string | null;
    /** 该侧合格意见的严重度分布；结论读不到时为 null（不是全 0） */
    severity: Record<Severity, number> | null;
  } & EffortFields)[];
  /** 两侧合计的严重度分布 */
  severity: Record<Severity, number>;
  /** 裁决分布；裁决件缺失时为 null */
  disposals: Record<Disposal, number> | null;
  /** 裁决件定位得到却读不出（此时 `disposals` 也为 null）；与「没有裁决件」分开记（代码三审 GLM-02） */
  dispositionUnreadable: boolean;
  /**
   * 裁决按**提出意见的审核者**分摊（设计 13.2.1）：来源取裁决行的「来源」，回退编号按前缀归属；
   * 判不出的记 `unknown`。裁决件缺失时为空对象。
   */
  disposalsBySource: Partial<Record<CriticId | 'unknown', Record<Disposal, number>>>;
  /** 其中整份回退编号（`<前缀>-F<n>`）的裁决，按前缀归属；它们照常计入上面那一格与采纳率（D-1） */
  fallbackDisposalsBySource: Partial<Record<CriticId, Record<Disposal, number>>>;
  /** 被驳回与暂缓的条目，带理由——复盘最该被人读到的部分 */
  contested: { id: string; disposal: Disposal; severity: Severity | null; reason: string }[];
  /** 本轮各**对**审核者的重合度。两侧时恰好一项；三审时三项（逐对） */
  divergences: DivergenceReport[];
  guardFlags: string[];
  /**
   * 逐侧 token 用量。**不跨厂商相加**：两家的字段名体系不同
   * （agy 用 `input_tokens`，zcode 用 `inputTokens`），相加只会得出一个
   * 谁都对不上的数。也只收数值字段——实测 `usage` 里混有字符串（如 `source`），
   * 直接累加会得出 `00provider` 这种东西。
   */
  tokens: Partial<Record<CriticId, Record<string, number>>>;
  /** 本轮读取归档时遇到的问题，原样呈现 */
  notes: string[];
}

/**
 * 没进时间线的运行（EV-144，计划 r2 §3.6）：该阶段 `_meta/` 下可读的 run.json 里，时间线没选中的那些。
 *
 * 时间线按审查文档枚举轮次（`enumerateRounds`），没产出审查文档的运行——被取消、worker 异常 / 失联、
 * 入选侧全部失败、纯文档跳过、以及没走到收尾的旧留痕——在那里整个看不见。它们也**不占轮次号**
 * （`resolveRerunIndex` 只看审查文档），之后的重跑沿用同一个号，所以这里记的是「预定轮次」。
 */
export interface UnlistedRun {
  requestedRoutes?: RunMeta['requested_routes'];
  stage: Stage;
  runId: string;
  /** 预定轮次：这次运行开始时算出的轮次号，之后的重跑可能沿用同一个号 */
  rerunIndex: number;
  status: RunMeta['status'];
  startedAt: string;
  finishedAt: string | null;
  termination: RunMeta['termination'] | null;
  /** artifacts[] 里登记的、属于本轮入选审核者的审查文档条数；正常为 0，非 0 说明时间线选错了 */
  registeredReviewDocs: number;
  /** 按事实给的一句说明，不推测 */
  label: string;
  /** 发起方（run.json 的 `driver`）：未进时间线的运行都有可读 run.json，所以恒有值（设计 13.2.1） */
  driver: AgentId;
  /** 逐侧状态，供按审核者聚合的「未进时间线运行中失败」一格 */
  sideStatuses: Partial<Record<CriticId, string>>;
}

export interface TopicReport {
  topic: string;
  generatedAt: string;
  task: TaskMeta;
  rounds: RoundReport[];
  /** 没进时间线的运行（EV-144） */
  unlistedRuns: UnlistedRun[];
  verify: VerifyRecord | null;
  /** 最近一份 verify 记录存在但读不出来——与「从未验证」必须区分开 */
  verifyUnreadable: string | null;
  /** 主题级问题（缺 task.json、阶段目录读不到等） */
  notes: string[];
  /** 按 Driver 与按审核者的聚合（设计 13.2.1，M11 第 7 步） */
  aggregates: {
    byDriver: DriverAggregateRow[];
    unknownDriver: UnknownDriverGroup;
    byCritic: CriticAggregateRow[];
  };
}

/** 按 Driver 聚合的一行：（Driver, 阶段），`stage: 'all'` 为该 Driver 的合计行（设计 13.2.1） */
export interface DriverAggregateRow {
  driver: AgentId;
  stage: Stage | 'all';
  /** 时间线轮次数 */
  rounds: number;
  adjudicatedRounds: number;
  unadjudicatedRounds: number;
  /** 未裁决轮次里裁决件定位得到却读不出的那几轮（代码三审 GLM-02） */
  dispositionUnreadableRounds: number;
  /** 合格意见数（各轮各侧之和，不跨侧去重；结论读不到的侧不贡献） */
  findings: number;
  findingsDegraded: number;
  /** 已裁决轮次的裁决表行数之和（整份回退编号照常计入，D-1）；采纳率由它派生 */
  disposals: Record<Disposal, number>;
  /** 该 Driver 发起、没产出审查文档的运行数 */
  unlistedRuns: number;
  /** 其中由 run.v1 迁移的时间线轮次数（v1 时代 Driver 恒为 claude，D-3） */
  v1Rounds: number;
}

/** 读不到 Driver 的轮次：单独成组，不归给缺省 Driver、也不归给认领声明 */
export interface UnknownDriverGroup {
  rounds: number;
  items: { stage: Stage; rerunIndex: number; runId: string | null; reason: string }[];
}

/** 逐值计次（取值 → 次数） */
export type ValueCounts = Record<string, number>;

/**
 * 按审核者聚合的一行（设计 13.2.1）。一条意见按**提出它的审核者**计；`critic: 'unknown'` 是来源判不出的裁决行，
 * 只有裁决两格有值，其余为 null（不是 0）。
 */
export interface CriticAggregateRow {
  critic: CriticId | 'unknown';
  /** 只数时间线轮次：本轮 `critics_selected` 里有它，或 run.json 有它的条目 */
  selectedRounds: number | null;
  /**
   * 有可读合格结论的轮次（零意见的空审查算）。判据是结论读不读得到、不是状态字：早期留痕里状态记
   * `parse_fallback` 却仍落了可读结论的侧照计，同时 `parseFallback` 也照记一次（设计 13.2.1）
   */
  concludedRounds: number | null;
  findings: number | null;
  severity: Record<Severity, number> | null;
  findingsDegraded: number | null;
  disposals: Record<Disposal, number>;
  /** 其中整份回退编号：个数与其裁决 */
  fallback: { ids: number; disposals: Record<Disposal, number> } | null;
  failed: number | null;
  parseFallback: number | null;
  degradedRounds: number | null;
  /** 未进时间线运行里该侧 `failed` / `timeout` 的次数（不看运行顶层状态） */
  unlistedFailed: number | null;
  models: { values: ValueCounts; unverified: number } | null;
  effortRequested: { values: ValueCounts; absent: number; unrequested: number; legacy: ValueCounts } | null;
  effortEffective: { values: ValueCounts; absent: number; unverified: number; noConcept: number } | null;
}

const zeroSeverity = (): Record<Severity, number> => ({ blocker: 0, major: 0, minor: 0, nit: 0 });
const zeroDisposals = (): Record<Disposal, number> => ({ 接受: 0, 驳回: 0, 暂缓: 0 });
/** 读不到 Driver 的原因之一：该轮有审查文档、本阶段也没有读不出的 run.json（其余情形见 `buildRound`） */
const NO_RUN_JSON = '找不到对应的 run.json';
/** 读不到 run_id 时 `RoundReport.runId` 的占位；聚合与 JSON 里据它写 null */
const RUN_ID_UNKNOWN = '（读不到 run_id）';
const bump = (m: ValueCounts, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

/**
 * 枚举某阶段所有已产出审查工件的轮次与其 run_id。
 *
 * **原稿与裁决件按该轮 run.json 的 `driver` 排除**（设计 13.2，M11 第 7 步）。此前写死缺省 Driver：
 * 同一阶段换成 codex 当 Driver 后，codex 的新一轮计划 `…-r3-codex.md` 被当审查文档、定义出幽灵轮次，
 * 而 claude 作为审核者写的审查文档反被当原稿排除——闸门侧早已按当轮 driver 定位（`gate.ts`），报告是唯一没跟上的读侧。
 *
 * 没有可读 run.json 的轮次号拿不到当轮 driver，先看内容：front-matter 为 `trivium.review.v1` 即审查文档
 * （`isReviewArtifact`，计划三审 AGY-01）；为假再按后缀兜底——后缀不属于「本阶段记过的 driver ∪ 缺省 Driver」才算。
 * 兜底不能省：front-matter 缺失 / 损坏的真审查件内容谓词判假（EV-63），「有工件就得出现」要靠它。
 * 这一规则只用于枚举，该轮 Driver 记为读不到（`buildRound`）。
 *
 * **同一轮次号有多份可读 run.json 时，排除其中每一份的 driver**（代码三审 CODEX-02）：作废后换 Driver 沿用同号重跑，
 * 只看最后一份会把前一次运行的 Driver 原稿当审查文档、造出挂在后一次运行上的幽灵轮次。
 *
 * 另返回本阶段读不出的 run.json 个数（代码三审 CODEX-01 ≡ AGY-01）：读不出就拿不到它的 `rerun_index`，
 * 无从判断它属于哪一轮，所以「读不到 Driver」的原因只能按阶段事实分写，见 `buildRound`。
 */
async function enumerateRounds(
  layout: ArchiveLayout,
  stage: Stage,
): Promise<{ rounds: { rerunIndex: number; runId: string | null }[]; unreadableMeta: number }> {
  // run_id 从 _meta/run-*.json 反查：文件名里带，比解析 front-matter 更直接。同号后写覆盖（文件名按时间排序）
  const dir = metaDir(layout, stage);
  let metaFiles: string[] = [];
  try {
    metaFiles = await fs.readdir(dir);
  } catch {
    /* 阶段还没跑过 */
  }
  const runByRound = new Map<number, string>();
  const driversByRound = new Map<number, Set<AgentId>>();
  const seenDrivers = new Set<AgentId>([DEFAULT_DRIVER]);
  let unreadableMeta = 0;
  for (const f of metaFiles.sort()) {
    const m = /^run-(.+)\.json$/.exec(f);
    if (!m) continue;
    const runId = m[1]!;
    const meta = await readRunMeta(layout, stage, runId);
    if (!meta) {
      unreadableMeta++;
      continue;
    }
    runByRound.set(meta.rerun_index, runId);
    let ds = driversByRound.get(meta.rerun_index);
    if (!ds) driversByRound.set(meta.rerun_index, (ds = new Set()));
    ds.add(meta.driver);
    seenDrivers.add(meta.driver);
  }

  const items = await listStageArtifacts(layout, stage);
  const byRound = new Map<number, string | null>();
  for (const i of items) {
    if (i.parsed.kind !== null) continue; // 裁决件不定义轮次
    const drivers = driversByRound.get(i.parsed.rerunIndex);
    const isReviewDoc = drivers
      ? !drivers.has(i.parsed.role as AgentId)
      : (await isReviewArtifact(path.join(stageDir(layout, stage), i.fileName))) ||
        !seenDrivers.has(i.parsed.role as AgentId);
    if (!isReviewDoc) continue; // 原稿不定义轮次
    byRound.set(i.parsed.rerunIndex, runByRound.get(i.parsed.rerunIndex) ?? null);
  }

  return {
    rounds: [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rerunIndex, runId]) => ({ rerunIndex, runId })),
    unreadableMeta,
  };
}

/**
 * 裁决行归给哪个审核者（设计 13.2.1）：来源列 / 前缀反查给出的审核者优先；回退编号的来源记作 `fallback`，
 * 按编号前缀归属；都判不出记 `unknown`，不猜。
 */
function dispositionOwner(row: { id: string; source: CriticId | 'fallback' | null }): CriticId | 'unknown' {
  if (row.source !== null && row.source !== 'fallback') return row.source;
  const agent = row.source === 'fallback' ? agentByFindingId(row.id) : null;
  return agent && CRITICS.includes(agent.id as CriticId) ? (agent.id as CriticId) : 'unknown';
}

/** 找本轮的裁决件（`-revised-<当轮 Driver>.md` 或 `-response-<当轮 Driver>.md`） */
async function loadDisposition(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  notes: string[],
  /** 裁决件后缀 = 当轮 Driver（审查意见 AGY-04 / GLM-06）；M11 第 7 步起调用方必传该轮 run.json 的 driver */
  driver: AgentId,
): Promise<
  | {
      disposals: Record<Disposal, number>;
      disposalsBySource: RoundReport['disposalsBySource'];
      fallbackDisposalsBySource: RoundReport['fallbackDisposalsBySource'];
      contested: RoundReport['contested'];
    }
  /** 定位得到却读不出（代码三审 GLM-02）：与「没有裁决件」分开，调用方据此不说「尚无裁决件」 */
  | 'unreadable'
  | null
> {
  const items = await listStageArtifacts(layout, stage);
  const hit = items.find(
    (i) => i.parsed.role === driver && i.parsed.kind !== null && i.parsed.rerunIndex === rerunIndex,
  );
  if (!hit) return null;

  /*
   * 读不到就说读不到（审查意见 GLM-r2-09）。
   * 原先这里的 readFile 未捕获：单个裁决件因权限或竞态读失败，会让**整份复盘**
   * 崩溃退出，与本模块其余位置「缺件一律进 notes」的降级风格自相矛盾。
   */
  let md: string;
  try {
    md = await fs.readFile(path.join(layout.archiveRoot, layout.topic, stage, hit.fileName), 'utf8');
  } catch (e) {
    notes.push(`裁决件读取失败（${hit.fileName}）：${(e as Error).message}`);
    return 'unreadable';
  }
  const parsed = parseDisposition(md);
  const disposals = zeroDisposals();
  const disposalsBySource: RoundReport['disposalsBySource'] = {};
  const fallbackDisposalsBySource: RoundReport['fallbackDisposalsBySource'] = {};
  const contested: RoundReport['contested'] = [];
  for (const r of parsed.rows) {
    disposals[r.disposal]++;
    const owner = dispositionOwner(r);
    (disposalsBySource[owner] ??= zeroDisposals())[r.disposal]++;
    // 回退编号照常计入上面两格与采纳率（D-1），另在这里单记一笔；按前缀归属，判不出的已落在 unknown
    if (isFallbackId(r.id) && owner !== 'unknown') (fallbackDisposalsBySource[owner] ??= zeroDisposals())[r.disposal]++;
    if (r.disposal !== '接受') {
      contested.push({ id: r.id, disposal: r.disposal, severity: r.severity, reason: r.reason });
    }
  }
  return { disposals, disposalsBySource, fallbackDisposalsBySource, contested };
}

async function buildRound(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  runId: string | null,
  /** 本阶段读不出的 run.json 个数（`enumerateRounds` 给出），只用来写准「读不到 Driver」的原因 */
  unreadableMetaInStage = 0,
): Promise<RoundReport> {
  const notes: string[] = [];
  const base: RoundReport = {
    stage,
    rerunIndex,
    runId: runId ?? RUN_ID_UNKNOWN,
    startedAt: null,
    finishedAt: null,
    status: null,
    reviewMode: null,
    criticsSelected: [],
    driver: null,
    driverSource: null,
    driverUnknownReason: null,
    driverGuardLevel: null,
    degradedReason: null,
    sides: [],
    severity: zeroSeverity(),
    disposals: null,
    dispositionUnreadable: false,
    disposalsBySource: {},
    fallbackDisposalsBySource: {},
    contested: [],
    divergences: [],
    guardFlags: [],
    tokens: {},
    notes,
  };

  if (!runId) {
    notes.push('该轮有审查文档但找不到对应的 `_meta/run-*.json`，元数据部分无法呈现');
    /*
     * 本阶段有读不出的 run.json 时不能说「找不到」——那份可能就是本轮的，只是读不出（代码三审 CODEX-01 ≡ AGY-01）。
     * 也不能说「读不出」：读不出就拿不到它的轮次号，无从判断它属于哪一轮。所以按阶段事实如实写两种说法。
     */
    base.driverUnknownReason =
      unreadableMetaInStage > 0
        ? `没有可读的 run.json（本阶段另有 ${unreadableMetaInStage} 份读不出，无法判断是否属于本轮，成因见主题告警）`
        : NO_RUN_JSON;
    return base;
  }

  const read = await readRunMetaDetailed(layout, stage, runId);
  if (!read.ok) {
    // 「本次判定」是 EV-04 候选 B 补的成因，原文不动
    notes.push(`\`_meta/run-${runId}.json\` 读取失败（本次判定：${describeRunMetaCause(read.cause)}）`);
    base.driverUnknownReason = `run.json 读不出（${describeRunMetaCause(read.cause)}）`;
    return base;
  }
  const meta = read.meta;

  base.startedAt = meta.started_at;
  base.finishedAt = meta.finished_at;
  base.status = meta.status;
  base.reviewMode = meta.review_mode;
  base.criticsSelected = [...meta.critics_selected];
  base.driver = meta.driver;
  base.driverSource = read.sourceSchema === 'trivium.run.v1' ? 'run.v1' : read.sourceSchema === 'trivium.run.v2' ? 'run.v2' : 'run.v3';
  if (meta.driver_declaration) base.driverDeclaration = meta.driver_declaration;
  if (meta.family_comparisons) base.familyComparisons = meta.family_comparisons;
  if (meta.requested_routes) base.requestedRoutes = meta.requested_routes;
  for (const [id, route] of Object.entries(meta.requested_routes ?? {})) {
    if (route && !meta.critics[id as CriticId]) notes.push(`${id} 未产出结果；请求路线 ${route.access.requested_mode} / ${route.access.profile ?? '原生'}，模型 ${route.model ?? '未指定'}，effort ${route.effort ?? '未指定'}；实际启动及回读未知`);
  }
  base.driverGuardLevel = meta.driver_guard_level ?? null;
  base.degradedReason = meta.degraded_reason;

  const { reviews, notes: reviewNotes } = await loadRoundReviews(layout, stage, runId);
  notes.push(...reviewNotes);

  for (const c of Object.keys(meta.critics) as CriticId[]) {
    const m = meta.critics[c]!;
    const review = reviews[c] ?? null;
    const sideSeverity = review ? zeroSeverity() : null;
    for (const f of review?.findings ?? []) {
      if (SEVERITIES.includes(f.severity)) {
        base.severity[f.severity]++;
        sideSeverity![f.severity]++;
      }
    }
    base.sides.push({
      critic: c,
      status: m.status,
      modelEffective: m.model_effective,
      modelRequested: m.model_requested,
      ...(m.access ? { access: m.access } : {}),
      familyStatus: typeof m.heterogeneous === 'boolean' ? `旧版名义族判定：${m.heterogeneous ? '异族' : '同族'}` : m.heterogeneous,
      modelSource: m.model_effective_source,
      durationS: m.duration_s,
      findings: review ? review.findings.length : null,
      findingsDegraded: m.findings_degraded?.length ?? 0,
      evidenceOk: m.evidence_ok,
      failReason: m.fail_reason ?? null,
      severity: sideSeverity,
      // 在场性逐键照抄（设计 13.2.1）：键缺席 = 旧留痕，不写 undefined、不回落
      ...('effort_requested' in m ? { effortRequested: m.effort_requested ?? null } : {}),
      ...('effort_effective' in m ? { effortEffective: m.effort_effective ?? null } : {}),
      ...('effort_effective_source' in m ? { effortEffectiveSource: m.effort_effective_source ?? null } : {}),
      ...(typeof m.effort === 'string' ? { effortLegacy: m.effort } : {}),
    });
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(m.usage ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) numeric[k] = v;
    }
    if (Object.keys(numeric).length > 0) base.tokens[c] = numeric;
  }

  /*
   * 逐对计算，而不是写死 `reviews.gemini × reviews.glm`——那个写法在三审时
   * 会把第三家静默丢掉。论域取本轮 run.json 实际登记的审核者，
   * 不取当前启用集合：复盘读的是**历史**轮次，那时的入选集合可能与现在不同。
   */
  base.divergences = measureAllPairs(reviews, Object.keys(meta.critics) as CriticId[]);

  // 按跑后复算分档说（EV-224）：只说「只读失守」分不出那一轮是被挡了还是告警放行了
  if (meta.guard.readonly_breach) base.guardFlags.push(readonlyBreachLabel(meta.snapshot.drift));
  if (meta.guard.peer_artifact_read) base.guardFlags.push('读到对方产出');
  /*
   * `guard.forged_role_file` 不读（EV-137）：它是保留字段，写侧恒 false，全仓没有检测去置它。
   * 据它打「角色后缀伪造」旗标，这一格永远不会亮，却让读报告的人以为检测过。
   * 这件事实际由写入前 Hook、`gate --check-artifacts` 的未登记审查件判据与提交锚承担。
   */
  const driftUnknown = meta.snapshot.drift.unknown_reason;
  if (driftUnknown) {
    /*
     * 比不了（EV-139）：两个桶恒空，走下面那一支会因 `shown === 0` 一声不吭——
     * 正是本主题要修的「判不了就说没漂移」在报告层的同形。单独推一条说明原因的旗标。
     */
    base.guardFlags.push(`漂移无法判定（${describeDriftUnknown(driftUnknown)}，${meta.snapshot.drift.policy}）`);
  } else if (meta.snapshot.drift.changed) {
    /*
     * 两个桶合并展示。归因分流激活时 `drift.files` 恒空（**扣除确诊失守后的余批**
     * 移进了 `unattributed_drift_files`），单看这一行会打出「漂移 0 个文件」，
     * 而同屏还有「N 个无法归因」——并排读起来像计数 bug，
     * 正是本步在 `evidence_threshold` 上专门防过的那类人读陷阱（r6 双审 GLM-08）。
     */
    const un = (meta.guard.unattributed_drift_files ?? []).length;
    const shown = meta.snapshot.drift.files.length + un;
    const suffix = un > 0 ? `，其中 ${un} 个无法归因` : '';
    /*
     * `shown === 0` 时不推这一行：全部漂移文件都已确诊失守（被 `attributedToBreach`
     * 扣除）时两个桶都空，而 `drift.changed` 仍为真——照推就会打出
     * 「漂移 0 个文件（warn）」，与同屏的「只读失守」旗标并排，是纯噪音（r8 AGY-01）。
     * 那种情形下失守旗标已经把事说清了。
     */
    if (shown > 0) {
      base.guardFlags.push(`漂移 ${shown} 个文件（${meta.snapshot.drift.policy}${suffix}）`);
    }
  }
  for (const c of Object.keys(meta.guard.peer_deny_applied) as CriticId[]) {
    if (meta.guard.peer_deny_applied[c] === false) {
      base.guardFlags.push(`${c} 侧路径级 deny 未生效（第 ③ 道屏蔽降级）`);
    }
  }
  /*
   * **跳过项与「未生效」同档**（代码双审 r2 CODEX-01）。
   *
   * Claude合取原逐文件事实与实际压缩工具已验证不变式；其他侧仍消费原探针格。合取不证明每条本次规则。于是
   * 「主题名带一个括号 ⇒ 这一次每一条对端产出都被跳过」这种情形，
   * 在上面那个循环里**完全看不见**：它仍是 true，不推任何旗标。
   * 而那一刻 CLI 层屏蔽对「对端产出」已经整批失效，只剩提示语与事后轨迹核验。
   *
   * 此前唯一的记录在 `trace.json` 且全仓无消费方——`guard.ts` 自己写过
   * 「宣称了不存在的消费方正是 EV-06 记的那个形态」。这里就是那个消费方。
   */
  for (const [c, n] of Object.entries(meta.guard.deny_skipped ?? {}) as [CriticId, number][]) {
    if (n > 0) {
      base.guardFlags.push(
        `${c} 侧有 ${n} 条禁读路径拼不出规则、已跳过（第 ③ 道屏蔽对这些路径降级）`,
      );
    }
  }

  /*
   * 两条核验通道的降级（§11.1，M8 第 2 步）——留痕五面里的复盘面。
   *
   * 与上面的「路径级 deny 未生效」同格式但**不是同一件事**：那条说的是 CLI 级
   * 拦截有没有注入生效，这两条说的是事后轨迹核验有没有能力/输入去核验。
   */
  const degraded = meta.guard.verification_degraded ?? {};
  for (const c of Object.keys(degraded) as CriticId[]) {
    const d = degraded[c];
    if (!d) continue;
    if (d.readonly === 'unavailable') {
      base.guardFlags.push(
        `${c} 侧只读核验不可用（被拒的写不留痕，只读保障从三重降到两重，指纹比对仍有效）`,
      );
    }
    /*
     * **三种 `unavailable` 各一句，外加 `partial`**（r2 代码双审 GLM-03 ≡ CODEX-08）。
     *
     * 上一版只有一句「无结构化输入」，那是 `command-trace` 那一种的成因；
     * 另外两种（该侧没报计数 / 本轮零必带路径调用）会读到一句与自己无关的解释。
     * 而 `partial` 这一档 2026-09-16 就加进了判定，报告里一直没有——
     * 也就是说「提取器已经退化」这件事，从报告面上一次都没露过头。
     */
    if (d.path === 'unavailable') {
      base.guardFlags.push(
        d.path_cause === 'no-counts'
          ? `${c} 侧路径核验档位不可判（该侧没报必带路径的调用计数——旧留痕或适配器没采集，属「没测」而非「测过没事」）`
          : d.path_cause === 'no-path-bearing-calls'
            ? `${c} 侧本轮无路径探测面（一次必带路径的读调用都没有，措施 a 没有可核验的对象——不是缺陷，但也不算核验通过）`
            : `${c} 侧路径核验无结构化输入（措施 a 无通道，deny 核验只剩措施 b）`,
      );
    }
    if (d.path === 'partial') {
      base.guardFlags.push(
        `${c} 侧路径提取不完整（「必带路径」的读调用里有一部分提不出路径，` +
          '通常是厂商改了参数名而提取器没跟上：该侧禁读核验不完整，没命中不等于没读过)',
      );
    }
    // 证据不可信（EV-188）：复盘面那一句；不进闸门，但报告里要看得见是哪几个工具
    if (d.evidence_untrusted) {
      base.guardFlags.push(
        `${c} 侧证据不可信（${EVIDENCE_UNTRUSTED_CAUSE_TEXT[d.evidence_untrusted.cause].label}：${d.evidence_untrusted.tools.join('、')}；结论保留，「没命中禁读面」「没有写事件」两条阴性结论打折）`,
      );
    }
  }
  /*
   * 「无法归因」**只在上面的漂移行内以 suffix 展示**，这里不再单独推一条。
   *
   * 两条并存时数值并不重复计数（`shown` 已把两个桶相加），但同一信息在
   * `guardFlags` 里并排出现两次，正是 r6 GLM-08 要防的那类人读噪音——
   * 它在 r7 复审里又被两侧同时抓到（AGY-02 ≡ GLM-03）。
   */

  // 裁决件按该轮 run.json 的 driver 定位（设计 13.2，M11 第 7 步）：写死缺省 Driver 时换过 Driver 的轮次读不到裁决
  const disp = await loadDisposition(layout, stage, rerunIndex, notes, meta.driver);
  if (disp === 'unreadable') {
    // 裁决件在、只是读不出：上面已记成因，不再补一句失实的「尚无裁决件」（代码三审 GLM-02）
    base.dispositionUnreadable = true;
  } else if (disp) {
    base.disposals = disp.disposals;
    base.disposalsBySource = disp.disposalsBySource;
    base.fallbackDisposalsBySource = disp.fallbackDisposalsBySource;
    base.contested = disp.contested;
  } else if (meta.status === 'success') {
    notes.push('本轮尚无裁决件——审查已完成但意见未逐条裁决');
  }

  return base;
}

/** 读该主题最近一次 verify 记录 */
async function loadLatestVerify(
  layout: ArchiveLayout,
  notes: string[],
): Promise<{ record: VerifyRecord | null; unreadable: string | null }> {
  const dir = metaDir(layout, 'verify');
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { record: null, unreadable: null }; // 目录不存在 = 确实从未验证过，这不是降级
  }
  const candidates = files.filter((f) => /^verify-.+\.json$/.test(f)).sort();
  const last = candidates.at(-1);
  if (!last) return { record: null, unreadable: null };
  try {
    return {
      record: JSON.parse(await fs.readFile(path.join(dir, last), 'utf8')) as VerifyRecord,
      unreadable: null,
    };
  } catch (e) {
    /*
     * 解析失败**不能**返回 null（审查意见 GLM-r2-09）：那会渲染成
     * 「尚无 verify 记录」，把「记录损坏」伪装成「从未验证」——
     * 恰好是本模块自述要防的 P5 误读。
     */
    notes.push(`最近一份 verify 记录损坏（${last}）：${(e as Error).message}`);
    return { record: null, unreadable: last };
  }
}

/** 一次没进时间线的运行的说明（EV-144）。只按留痕里的事实写，分不出的就说分不出 */
function unlistedLabel(meta: RunMeta, failedSides: number, registeredReviewDocs: number): string {
  let label: string;
  if (meta.status === 'cancelled') label = '被 review --cancel 取消';
  else if (meta.status === 'failed' && meta.termination?.by === 'worker_exception') {
    label = `worker 异常（退出码 ${meta.termination.exit_code}）`;
  } else if (meta.status === 'failed' && meta.termination?.by === 'prepare_exception') {
    // 准备阶段写完骨架之后失败、或 startRun 在子进程诞生之前失败：审查员一个都没拉起、没花配额（EV-145）
    label = `准备阶段失败，未拉起审查员（退出码 ${meta.termination.exit_code}）`;
  } else if (meta.status === 'failed' && meta.termination?.by === 'sync_exception') {
    label = `同步路径异常（退出码 ${meta.termination.exit_code}）`;
  } else if (meta.status === 'failed' && meta.termination?.by === 'post_spawn_exception') {
    // review --start 在子进程诞生之后失败，工作进程已被终止并确认退出（EV-150）
    label = `派生工作进程之后启动未完成，工作进程已终止（退出码 ${meta.termination.exit_code}）`;
  } else if (meta.status === 'failed' && meta.termination?.by === 'worker_lost') {
    label = `worker 失联（${meta.termination.reason}）`;
  } else if (meta.status === 'failed' && failedSides > 0 && registeredReviewDocs === 0) label = '入选侧全部失败';
  else if (meta.gate.state === 'skipped_doc_only') label = '纯文档跳过（FR-23）';
  // report 只读归档、不读本机运行目录（P4），分不出「真在跑」与「没走到收尾」，两种都说
  else if (meta.status === 'running') label = '进行中，或没走到收尾';
  else label = `${meta.status}（gate.state=${meta.gate.state}）`;
  if (registeredReviewDocs > 0) label += '；登记了审查文档却未进时间线，请核对';
  return label;
}

/**
 * 列出该阶段没进时间线的运行（EV-144，计划 r2 §3.6）：`_meta/` 下所有可读 run.json 减去时间线选中的那几份。
 * 读不出的 run.json 记进 notes——`enumerateRounds` 那里是静默跳过的。
 */
async function collectUnlistedRuns(
  layout: ArchiveLayout,
  stage: Stage,
  listed: ReadonlySet<string>,
  notes: string[],
): Promise<UnlistedRun[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(metaDir(layout, stage));
  } catch {
    return []; // 阶段还没跑过
  }
  const out: UnlistedRun[] = [];
  for (const f of files.sort()) {
    const runId = /^run-(.+)\.json$/.exec(f)?.[1];
    if (runId === undefined || listed.has(runId)) continue;
    const read = await readRunMetaDetailed(layout, stage, runId);
    if (!read.ok) {
      // 「本次判定」是 EV-04 候选 B 补的成因，原文不动
      notes.push(
        `\`${stage}/_meta/${f}\` 读不出来（不可解析或不合契约），未列入报告（本次判定：${describeRunMetaCause(read.cause)}）`,
      );
      continue;
    }
    const meta = read.meta;
    const names = meta.artifacts.map((a) => path.basename(a.path));
    const failedSides = names.filter((n) => n.endsWith('.failed.json')).length;
    // 只数本轮入选审核者后缀的审查文档：plan / bug 成功轮还会登记 Driver 自己的原稿，那不是审查文档
    const registeredReviewDocs = meta.artifacts.filter(
      (a) => !a.path.includes('/_meta/') && meta.critics_selected.some((c) => a.path.endsWith(`-${c}.md`)),
    ).length;
    out.push({
      stage,
      runId,
      rerunIndex: meta.rerun_index,
      status: meta.status,
      startedAt: meta.started_at,
      finishedAt: meta.finished_at,
      termination: meta.termination ?? null,
      registeredReviewDocs,
      label: unlistedLabel(meta, failedSides, registeredReviewDocs),
      driver: meta.driver,
      sideStatuses: Object.fromEntries(
        (Object.keys(meta.critics) as CriticId[]).map((c) => [c, meta.critics[c]!.status]),
      ),
      ...(meta.requested_routes ? { requestedRoutes: meta.requested_routes } : {}),
    });
  }
  return out;
}

export async function buildTopicReport(layout: ArchiveLayout): Promise<TopicReport> {
  const notes: string[] = [];
  const task = await readTask(layout);
  const rounds: RoundReport[] = [];
  const unlistedRuns: UnlistedRun[] = [];

  for (const stage of STAGES) {
    const { rounds: enumerated, unreadableMeta } = await enumerateRounds(layout, stage);
    for (const { rerunIndex, runId } of enumerated) {
      rounds.push(await buildRound(layout, stage, rerunIndex, runId, unreadableMeta));
    }
    const listed = new Set(enumerated.map((r) => r.runId).filter((x): x is string => x !== null));
    unlistedRuns.push(...(await collectUnlistedRuns(layout, stage, listed, notes)));
  }

  if (rounds.length === 0) {
    notes.push(
      '该主题下没有任何已产出审查工件的轮次' +
        (unlistedRuns.length > 0 ? `（另有 ${unlistedRuns.length} 次运行未产出审查文档，见时间线下方）` : ''),
    );
  }

  return {
    topic: layout.topic,
    generatedAt: new Date().toISOString(),
    task,
    rounds,
    unlistedRuns,
    ...(await (async () => {
      const v = await loadLatestVerify(layout, notes);
      return { verify: v.record, verifyUnreadable: v.unreadable };
    })()),
    notes,
    aggregates: {
      ...aggregateByDriver(rounds, unlistedRuns),
      byCritic: aggregateByCritic(rounds, unlistedRuns),
    },
  };
}

// ─────────────────────────── 聚合（设计 13.2.1，M11 第 7 步） ───────────────────────────

/**
 * 按 Driver 聚合。分组键是 run.json 的 `driver`（发起方）；**读不到 Driver 的轮次单独成组**，
 * 不归给缺省 Driver、也不归给该阶段的认领声明——声明说明谁声明要写，不说明那一轮是谁发起的。
 * 行集 =（时间线轮次 ∪ 未进时间线运行）出现过的（Driver, 阶段），每个 Driver 再加一行合计。
 */
export function aggregateByDriver(
  rounds: readonly RoundReport[],
  unlistedRuns: readonly UnlistedRun[],
): { byDriver: DriverAggregateRow[]; unknownDriver: UnknownDriverGroup } {
  const cells = new Map<string, DriverAggregateRow>();
  const cell = (driver: AgentId, stage: Stage | 'all'): DriverAggregateRow => {
    const key = `${driver}\u0000${stage}`;
    let row = cells.get(key);
    if (!row) {
      row = {
        driver, stage, rounds: 0, adjudicatedRounds: 0, unadjudicatedRounds: 0, dispositionUnreadableRounds: 0,
        findings: 0, findingsDegraded: 0, disposals: zeroDisposals(), unlistedRuns: 0, v1Rounds: 0,
      };
      cells.set(key, row);
    }
    return row;
  };
  const unknownDriver: UnknownDriverGroup = { rounds: 0, items: [] };

  for (const r of rounds) {
    if (r.driver === null) {
      unknownDriver.rounds++;
      unknownDriver.items.push({
        stage: r.stage,
        rerunIndex: r.rerunIndex,
        runId: r.runId === RUN_ID_UNKNOWN ? null : r.runId,
        reason: r.driverUnknownReason ?? '读不到 run.json',
      });
      continue;
    }
    for (const row of [cell(r.driver, r.stage), cell(r.driver, 'all')]) {
      row.rounds++;
      if (r.driverSource === 'run.v1') row.v1Rounds++;
      for (const s of r.sides) {
        if (s.findings !== null) row.findings += s.findings;
        row.findingsDegraded += s.findingsDegraded;
      }
      if (r.disposals) {
        row.adjudicatedRounds++;
        for (const d of DISPOSALS) row.disposals[d] += r.disposals[d];
      } else {
        row.unadjudicatedRounds++;
        if (r.dispositionUnreadable) row.dispositionUnreadableRounds++;
      }
    }
  }
  for (const u of unlistedRuns) {
    cell(u.driver, u.stage).unlistedRuns++;
    cell(u.driver, 'all').unlistedRuns++;
  }

  const order: (Stage | 'all')[] = [...STAGES, 'all'];
  const byDriver: DriverAggregateRow[] = [];
  for (const d of ALL_AGENT_IDS) {
    for (const st of order) {
      const row = cells.get(`${d}\u0000${st}`);
      if (row) byDriver.push(row);
    }
  }
  return { byDriver, unknownDriver };
}

/**
 * 按审核者聚合。一条意见按**提出它的审核者**计，不跨侧去重；论域只取有可读 run.json 的时间线轮次
 * 与未进时间线运行——读不到 Driver 的轮次没有 run.json，不知道入选了谁，不计入任何审核者。
 */
export function aggregateByCritic(
  rounds: readonly RoundReport[],
  unlistedRuns: readonly UnlistedRun[],
): CriticAggregateRow[] {
  const rows = new Map<CriticId, CriticAggregateRow>();
  const row = (c: CriticId): CriticAggregateRow => {
    let x = rows.get(c);
    if (!x) {
      x = {
        critic: c, selectedRounds: 0, concludedRounds: 0, findings: 0, severity: zeroSeverity(),
        findingsDegraded: 0, disposals: zeroDisposals(), fallback: { ids: 0, disposals: zeroDisposals() },
        failed: 0, parseFallback: 0, degradedRounds: 0, unlistedFailed: 0,
        models: { values: {}, unverified: 0 },
        effortRequested: { values: {}, absent: 0, unrequested: 0, legacy: {} },
        effortEffective: { values: {}, absent: 0, unverified: 0, noConcept: 0 },
      };
      rows.set(c, x);
    }
    return x;
  };
  const unknown = zeroDisposals();
  let unknownSeen = false;

  for (const r of rounds) {
    if (r.driver === null) continue;
    const selected = new Set<CriticId>([...r.criticsSelected, ...r.sides.map((s) => s.critic)]);
    for (const c of selected) row(c).selectedRounds!++;
    for (const s of r.sides) {
      const x = row(s.critic);
      if (s.findings !== null) {
        x.concludedRounds!++;
        x.findings! += s.findings;
      }
      if (s.severity) for (const k of SEVERITIES) x.severity![k] += s.severity[k];
      x.findingsDegraded! += s.findingsDegraded;
      if (s.findingsDegraded > 0) x.degradedRounds!++;
      if (s.status === 'failed' || s.status === 'timeout') x.failed!++;
      if (s.status === 'parse_fallback') x.parseFallback!++;
      if (s.modelEffective === null) x.models!.unverified++;
      else bump(x.models!.values, s.modelEffective);
      const req = x.effortRequested!;
      if (s.effortRequested === undefined) {
        req.absent++;
        if (s.effortLegacy !== undefined) bump(req.legacy, s.effortLegacy);
      } else if (s.effortRequested === null) req.unrequested++;
      else bump(req.values, s.effortRequested);
      // 生效值只读回读字段，从不看请求值（AC-13、AC-23）
      const eff = x.effortEffective!;
      if (s.effortEffective === undefined) eff.absent++;
      else if (s.effortEffective !== null) bump(eff.values, s.effortEffective);
      else if (s.effortEffectiveSource === null) eff.noConcept++;
      else eff.unverified++;
    }
    for (const [owner, d] of Object.entries(r.disposalsBySource) as [CriticId | 'unknown', Record<Disposal, number>][]) {
      if (owner === 'unknown') {
        unknownSeen = true;
        for (const k of DISPOSALS) unknown[k] += d[k];
        continue;
      }
      for (const k of DISPOSALS) row(owner).disposals[k] += d[k];
    }
    for (const [owner, d] of Object.entries(r.fallbackDisposalsBySource) as [CriticId, Record<Disposal, number>][]) {
      const fb = row(owner).fallback!;
      for (const k of DISPOSALS) {
        fb.disposals[k] += d[k];
        fb.ids += d[k];
      }
    }
  }
  for (const u of unlistedRuns) {
    for (const [c, st] of Object.entries(u.sideStatuses) as [CriticId, string][]) {
      const x = row(c); // 只在未进时间线运行里出现过、也没失败的审核者同样成行，各格为 0（设计 13.2.1，代码三审 GLM-04）
      if (st === 'failed' || st === 'timeout') x.unlistedFailed!++;
    }
  }

  const out: CriticAggregateRow[] = CRITICS.filter((c) => rows.has(c)).map((c) => rows.get(c)!);
  if (unknownSeen) {
    out.push({
      critic: 'unknown', selectedRounds: null, concludedRounds: null, findings: null, severity: null,
      findingsDegraded: null, disposals: unknown, fallback: null, failed: null, parseFallback: null,
      degradedRounds: null, unlistedFailed: null, models: null, effortRequested: null, effortEffective: null,
    });
  }
  return out;
}

const EFFORT_ABSENT = '—';
const EFFORT_UNREQUESTED = '（未请求）';
const EFFORT_UNVERIFIED = '**未回读到**';
const EFFORT_NO_CONCEPT = '（无此概念）';

/** 第四节「思考等级请求」一格（设计 13.2.1）：只读 `effort_requested`，旧名 `effort` 只作缺席时的注记 */
export function renderEffortRequested(x: Pick<EffortFields, 'effortRequested' | 'effortLegacy'>): string {
  if (x.effortRequested === undefined) {
    return x.effortLegacy !== undefined ? `${EFFORT_ABSENT}（旧名 effort：${x.effortLegacy}）` : EFFORT_ABSENT;
  }
  return x.effortRequested === null ? EFFORT_UNREQUESTED : x.effortRequested;
}

/**
 * 第四节「思考等级生效」一格（设计 13.2.1）。**入参类型不含请求值**：生效值只取回读，
 * 「拿请求值顶替」在这里写不出来（AC-13、AC-23；照 M11 第 6 步 `effortReadback` 的做法）。
 */
export function renderEffortEffective(x: Pick<EffortFields, 'effortEffective' | 'effortEffectiveSource'>): string {
  if (x.effortEffective === undefined) return EFFORT_ABSENT;
  if (x.effortEffective !== null) return x.effortEffective;
  // 来源 null = 该侧无此概念；unverified 或来源字段缺席（只可能来自手改）一律按读不到
  return x.effortEffectiveSource === null ? EFFORT_NO_CONCEPT : EFFORT_UNVERIFIED;
}

/** 请求值与生效值都是字符串且不等（两列的对比标记，只在第四节行级拼装处用；不是生效列的取值来源） */
export function effortMismatch(x: Pick<EffortFields, 'effortRequested' | 'effortEffective'>): boolean {
  return typeof x.effortRequested === 'string' && typeof x.effortEffective === 'string' &&
    x.effortRequested !== x.effortEffective;
}

// ─────────────────────────── 渲染 ───────────────────────────

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

/** 采纳率 = 接受 / 已裁决总数。只统计有裁决件的轮次 */
export function acceptanceRate(rounds: RoundReport[]): { accepted: number; total: number } {
  let accepted = 0;
  let total = 0;
  for (const r of rounds) {
    if (!r.disposals) continue;
    accepted += r.disposals['接受'];
    total += DISPOSALS.reduce((a, d) => a + r.disposals![d], 0);
  }
  return { accepted, total };
}

/**
 * 逐值计次渲染成「值 ×n、值 ×n」。键按**码点序**（P4：同一份归档同一份报告）——`localeCompare` 随 ICU 默认 locale
 * 的排序规则变，换台机器次序可能不同（代码三审 CODEX-03）
 */
function renderCounts(values: ValueCounts, extra: [string, number][] = []): string {
  const parts = Object.entries(values)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => `${k} ×${n}`);
  for (const [label, n] of extra) if (n > 0) parts.push(`${label} ×${n}`);
  return parts.length > 0 ? parts.join('、') : '—';
}

const disposalsCells = (d: Record<Disposal, number>): string => DISPOSALS.map((k) => d[k]).join(' | ');

/** 第二节末尾的两张聚合表（设计 13.2.1）：不新增一级节、不改既有节号 */
function renderAggregates(L: string[], r: TopicReport): void {
  const { byDriver, unknownDriver, byCritic } = r.aggregates;

  // ── 按 Driver ──
  L.push('### 按 Driver 聚合', '');
  if (byDriver.length === 0 && unknownDriver.rounds === 0) {
    L.push('（无数据）', '');
  } else {
    L.push(
      // 末列名不写成「未进时间线的运行」：那几个字留给时间线下方那张表，没有这类运行时全文不得出现（EV-144 V7 防噪）
      '| Driver | 阶段 | 轮次 | 已裁决 | 未裁决 | 意见数 | 接受 | 驳回 | 暂缓 | 采纳率 | 未进时间线 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    );
    for (const x of byDriver) {
      const total = DISPOSALS.reduce((a, k) => a + x.disposals[k], 0);
      const driverCell =
        x.stage === 'all' && x.v1Rounds > 0 ? `${x.driver}（其中 ${x.v1Rounds} 轮为 run.v1 迁移）` : x.driver;
      L.push(
        `| ${driverCell} | ${x.stage === 'all' ? '**合计**' : x.stage} | ${x.rounds} | ${x.adjudicatedRounds} | ` +
          `${x.unadjudicatedRounds}${x.dispositionUnreadableRounds > 0 ? `（其中 ${x.dispositionUnreadableRounds} 轮裁决件读不出）` : ''} | ${x.findings}${x.findingsDegraded > 0 ? `（另 ${x.findingsDegraded} 条逐条降级）` : ''} | ` +
          `${disposalsCells(x.disposals)} | ${pct(x.disposals['接受'], total)} | ${x.unlistedRuns} |`,
      );
    }
    if (unknownDriver.rounds > 0) {
      L.push(`| 读不到 Driver | — | ${unknownDriver.rounds} | — | — | — | — | — | — | — | — |`);
    }
    L.push('');
    if (unknownDriver.rounds > 0) {
      L.push(
        '> 读不到 Driver 的轮次单独成组，不归给缺省 Driver、也不归给认领声明：' +
          unknownDriver.items.map((i) => `${i.stage} r${i.rerunIndex}（${i.reason}）`).join('；') +
          '。读不到 Driver 就不知道该找谁的裁决件，意见与裁决一律写「—」；' +
          '未进时间线的运行都有可读 run.json，不存在读不到 Driver 的这一类。',
        '',
      );
    }
    L.push(
      '> 采纳率 = 接受 ÷（接受 + 驳回 + 暂缓），只算有裁决件的轮次；未裁决轮次的意见计入意见数、不进采纳率。',
      '> 意见数是各侧合格意见之和，不跨侧去重。',
      '',
    );
  }

  // ── 按审核者 ──
  L.push('### 按审核者聚合', '');
  if (byCritic.length === 0) {
    L.push('（无数据）', '');
    return;
  }
  const n = (v: number | null): string => (v === null ? '—' : String(v));
  L.push(
    '| 审核者 | 入选轮次 | 产出结论轮次 | 合格意见 | blocker | major | minor | nit | 逐条降级 | 接受 | 驳回 | 暂缓 | 其中整份回退编号 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  );
  for (const x of byCritic) {
    const fb = x.fallback;
    const fbCell = fb === null ? '—' : fb.ids === 0 ? '0' : `${fb.ids}（${DISPOSALS.map((k) => `${k} ${fb.disposals[k]}`).join(' / ')}）`;
    L.push(
      `| ${x.critic === 'unknown' ? '来源不明' : x.critic} | ${n(x.selectedRounds)} | ${n(x.concludedRounds)} | ${n(x.findings)} | ` +
        `${SEVERITIES.map((s) => (x.severity ? x.severity[s] : '—')).join(' | ')} | ${n(x.findingsDegraded)} | ` +
        `${disposalsCells(x.disposals)} | ${fbCell} |`,
    );
  }
  L.push(
    '',
    '| 审核者 | 失败 | 整份回退 | 逐条降级轮次 | 未进时间线运行中失败 | 生效模型 | 思考等级请求 | 思考等级生效 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  );
  for (const x of byCritic) {
    if (x.critic === 'unknown') continue;
    const req = x.effortRequested!;
    const eff = x.effortEffective!;
    const legacy = Object.keys(req.legacy).length > 0 ? `（其中旧名 effort：${renderCounts(req.legacy)}）` : '';
    const reqCell = renderCounts(req.values, [[EFFORT_UNREQUESTED, req.unrequested]]);
    const reqAbsent = req.absent > 0 ? `${reqCell === '—' ? '' : `${reqCell}、`}${EFFORT_ABSENT} ×${req.absent}${legacy}` : reqCell;
    const effCell = renderCounts(eff.values, [
      [EFFORT_UNVERIFIED, eff.unverified],
      [EFFORT_NO_CONCEPT, eff.noConcept],
    ]);
    const effAll = eff.absent > 0 ? `${effCell === '—' ? '' : `${effCell}、`}${EFFORT_ABSENT} ×${eff.absent}` : effCell;
    L.push(
      `| ${x.critic} | ${n(x.failed)} | ${n(x.parseFallback)} | ${n(x.degradedRounds)} | ${n(x.unlistedFailed)} | ` +
        `${renderCounts(x.models!.values, [['**未回读到**', x.models!.unverified]])} | ${reqAbsent} | ${effAll} |`,
    );
  }
  L.push(
    '',
    '> 一条意见按**提出它的审核者**计（裁决行按「来源」，整份回退编号按前缀），重复意见不去重；',
    '> 意见数来自结论、裁决数来自裁决表，两者可以不等。同一 Agent 可同时出现在 Driver 表与本表（R23：后缀是产出方、driver 是发起方）。',
    '> 只计有可读 run.json 的轮次；入选轮次只数时间线轮次，未进时间线运行的失败单列。',
    '',
  );
}

export function renderTopicReport(r: TopicReport): string {
  const L: string[] = [
    `# 复盘 · ${r.topic}`,
    '',
    `- **生成时间**：${r.generatedAt}`,
    `- **主题创建**：${r.task.created_at}`,
    `- **当前闸门**：${r.task.gate.state}${r.task.gate.stage ? `（${r.task.gate.stage}）` : ''}`,
    `- **轮次总数**：${r.rounds.length}` +
      (r.unlistedRuns.length > 0 ? `（另有 ${r.unlistedRuns.length} 次运行未产出审查文档，见时间线下方）` : ''),
    '',
    '> 数据源只有 `.reviews/`。报告不重新调用任何 Agent，也不依赖本机临时目录——',
    '> 换一台机器、拿同一份归档，应得出同一份报告（设计原则 P4）。',
    '',
  ];

  if (r.notes.length > 0) {
    L.push('> ⚠️ ' + r.notes.join('\n> ⚠️ '), '');
  }

  // ── 一、时间线 ──
  L.push(
    '## 一、时间线',
    '',
    '| 阶段 | 轮 | 运行 | 起始 | 状态 | Driver（护栏） | 审核者 | 完成度 | 耗时（较慢侧） |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  );
  for (const d of r.rounds) {
    const slowest = d.sides.reduce((a, s) => Math.max(a, s.durationS), 0);
    L.push(
      `| ${d.stage} | r${d.rerunIndex} | \`${d.runId}\` | ${d.startedAt ?? '—'} | ` +
        `${d.status ?? '—'} | ${d.driver ?? '—'}（${d.driverGuardLevel ?? '—'}） | ` +
        `${d.criticsSelected.join('、') || '—'} | ` +
        `${d.reviewMode ?? '—'}${d.degradedReason ? `（${d.degradedReason}）` : ''} | ` +
        `${Math.round(slowest)}s |`,
    );
  }
  L.push('');

  /*
   * 没进时间线的运行（EV-144）。时间线与轮次口径不动，另列一张表：「轮次总数：0」不该被读成「这个阶段没跑过」。
   * 没有这类运行时整节不渲染，免得每份报告都多一块空表。
   */
  if (r.unlistedRuns.length > 0) {
    L.push(
      '### 未进时间线的运行（没有产出审查文档）',
      '',
      '| 阶段 | 预定轮次 | 运行 | 起始 | 结束 | 状态 | 说明 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    );
    for (const u of r.unlistedRuns) {
      L.push(
        `| ${u.stage} | r${u.rerunIndex} | \`${u.runId}\` | ${u.startedAt} | ${u.finishedAt ?? '—'} | ` +
          `${u.status} | ${u.label} |`,
      );
    }
    for (const u of r.unlistedRuns) for (const [id, request] of Object.entries(u.requestedRoutes ?? {})) {
      if (request) L.push('', `> ${u.runId} / ${id} 请求：${request.access.requested_mode} / ${request.access.profile ?? '原生'}，模型 ${request.model ?? '未指定'}，effort ${request.effort ?? '未指定'}；此处仅记录请求。`);
    }
    L.push(
      '',
      '> 这些运行不占轮次号：之后的重跑沿用同一个号，所以同一轮次号可能在上下两张表里各出现一次。',
      '',
    );
  }

  // ── 二、每轮意见与裁决 ──
  L.push('## 二、每轮意见数、严重度分布与裁决', '');
  if (r.rounds.length === 0) {
    L.push('（无数据）', '');
  } else {
    /*
     * 审核者列取**本主题实际参与过的侧**（各轮 sides 的并集），而不是当前启用集合。
     *
     * 原写法用 `CRITICS`，注释说「列数随启用集合变化」——那句话在启用集合与
     * 缺省集合同集时成立，而 M8 第 3 步把两者拆开了（codex 启用但默认不入选）：
     * 此后每个默认两侧轮次都会多出一个恒为「—」的 codex 列，而「—」在本表里
     * 已经用来表示「该侧没参与这一轮」，读者分不清是没入选还是没提意见（r9 双审 GLM-09）。
     *
     * 并集为空时回落到缺省集合，让空报告仍有表头。
     */
    const seen = new Set<CriticId>();
    for (const d of r.rounds) for (const x of d.sides) seen.add(x.critic);
    const cols: CriticId[] = seen.size > 0 ? CRITICS.filter((c) => seen.has(c)) : [...DEFAULT_CRITICS];

    L.push(
      `| 阶段/轮 | ${cols.join(' | ')} | blocker | major | minor | nit | 接受 | 驳回 | 暂缓 |`,
      `| :--- ${cols.map(() => '| :--- ').join('')}| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
    );
    for (const d of r.rounds) {
      const side = (c: CriticId): string => {
        const s = d.sides.find((x) => x.critic === c);
        if (!s) return '—';
        // 失败/降级侧显示原因而不是 0：0 会被读成「没提意见」
        if (s.findings === null) return `（${s.status}）`;
        // 逐条降级的另记一笔：只写合格数会把「交了 5 条、4 条不合格」读成「只提了 1 条」
        return s.findingsDegraded > 0 ? `${s.findings}（另 ${s.findingsDegraded} 条逐条降级）` : String(s.findings);
      };
      const dz = d.disposals;
      L.push(
        `| ${d.stage} r${d.rerunIndex} | ${cols.map(side).join(' | ')} | ` +
          SEVERITIES.map((s) => d.severity[s]).join(' | ') +
          ' | ' +
          (dz ? DISPOSALS.map((x) => dz[x]).join(' | ') : '— | — | —') +
          ' |',
      );
    }
    const { accepted, total } = acceptanceRate(r.rounds);
    L.push(
      '',
      `**采纳率**：${accepted} / ${total} = ${pct(accepted, total)}` +
        (total === 0 ? '（尚无裁决件）' : ''),
      '',
      '> 失败或降级侧显示状态而非 `0`：`0` 会被读成「该侧认为没问题」，两者不是一回事。',
      '',
    );
  }
  renderAggregates(L, r);

  // ── 三、被驳回与暂缓 ──
  L.push('## 三、被驳回与暂缓的意见', '');
  const contested = r.rounds.flatMap((d) =>
    d.contested.map((c) => ({ ...c, stage: d.stage, rerunIndex: d.rerunIndex })),
  );
  if (contested.length === 0) {
    L.push('（无——全部意见均被接受，或尚无裁决件）', '');
  } else {
    L.push('| 阶段/轮 | 编号 | 严重度 | 裁决 | 理由 |', '| :--- | :--- | :--- | :--- | :--- |');
    for (const c of contested) {
      L.push(
        `| ${c.stage} r${c.rerunIndex} | ${c.id} | ${c.severity ?? '—'} | ${c.disposal} | ` +
          `${c.reason.replace(/\|/g, '\\|') || '（未写理由）'} |`,
      );
    }
    L.push('', '> 这一节是复盘的重点：被驳回的意见与其理由，是下一轮最值得回看的地方。', '');
  }

  // ── 四、生效模型 ──
  L.push('## 四、生效模型与思考等级（AC-13 / AC-18 / AC-23 核对）', '');
  for (const d of r.rounds) {
    if (d.driverDeclaration) L.push(`Driver 会话声明（${d.stage} r${d.rerunIndex}）：模型 ${d.driverDeclaration.model ?? '未声明'}，供应商 ${d.driverDeclaration.provider ?? '未声明'}。`, '');
    for (const s of d.sides) {
      const a = s.access;
      if (a) L.push(`接入（${s.critic}）：${a.requested_mode} / ${a.profile ?? '无 profile'}；入口 ${a.launcher_effective ?? '未启动'}；供应商声明 ${a.provider_declared ?? '未知'}，供应商回读 ${a.provider_effective ?? '未回读'}。`, '');
      if (s.modelSource === 'requested') L.push(`历史注记（${s.critic}）：旧版请求回填，不是模型回读。`, '');
      if (!d.familyComparisons) L.push(`${s.critic}：${s.familyStatus ?? '旧版判定缺失'}。`, '');
    }
    for (const pair of d.familyComparisons ?? []) L.push(`${pair.left}/${pair.right}：${pair.status}（${pair.reason}；来源 ${pair.left_source ?? '无'}/${pair.right_source ?? '无'}）。`, '');
  }
  L.push(
    '',
    '| 阶段/轮 | 侧 | 请求 | 实际生效 | 思考等级请求 | 思考等级生效 | 证据 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  );
  for (const d of r.rounds) {
    for (const s of d.sides) {
      const mismatch = s.modelEffective && s.modelRequested && !s.modelEffective.endsWith(s.modelRequested);
      // ⚠️ 是两列的对比标记，在这里行级拼装；生效列的取值只来自 renderEffortEffective（设计 13.2.1）
      L.push(
        `| ${d.stage} r${d.rerunIndex} | ${s.critic} | ${s.modelRequested ?? '—'} | ` +
          `${s.modelEffective ?? '**未回读到**'}${mismatch ? ' ⚠️' : ''} | ` +
          `${renderEffortRequested(s)} | ${renderEffortEffective(s)}${effortMismatch(s) ? ' ⚠️' : ''} | ` +
          `${s.evidenceOk ? 'ok' : '不足'} |`,
      );
    }
  }
  L.push(
    '',
    '> `未回读到` 表示生效模型或生效思考等级无法核实，一律不用请求值顶替（AC-13、AC-23）。',
    '> 思考等级的「—」表示该轮留痕早于思考等级字段（缺席）；「（未请求）」「（无此概念）」与加粗的「未回读到」',
    '> 表示留痕里明确记了空值——两者不是一回事。',
    '',
  );

  // ── 五、降级、告警与隔离 ──
  L.push('## 五、降级、告警与隔离结论', '');
  const alerts: string[] = [];
  for (const d of r.rounds) {
    if (d.degradedReason) alerts.push(`${d.stage} r${d.rerunIndex}：降级——${d.degradedReason}`);
    for (const g of d.guardFlags) alerts.push(`${d.stage} r${d.rerunIndex}：${g}`);
    for (const s of d.sides) {
      if (s.failReason) alerts.push(`${d.stage} r${d.rerunIndex} ${s.critic}：${s.status}——${s.failReason}`);
    }
    for (const n of d.notes) alerts.push(`${d.stage} r${d.rerunIndex}：${n}`);
  }
  for (const dg of r.task.degradations) alerts.push(`task.json 记录的降级：${dg.stage} ${dg.run_id}——${dg.reason}`);
  if (r.task.disputed) {
    for (const dp of r.task.disputes) {
      alerts.push(`争议项：${dp.finding_ids.join('、')}——${dp.note}`);
    }
  }
  L.push(alerts.length === 0 ? '（无）' : alerts.map((a) => `- ${a}`).join('\n'), '');

  // ── 六、多审退化 ──
  L.push('## 六、多审退化指标（§9.3）', '');
  const withDiv = r.rounds.filter((d) => d.divergences.length > 0);
  if (withDiv.length === 0) {
    L.push('（无可比对的轮次：需要至少两侧都产出结构化结论）', '');
  } else {
    // 表头不再写死两侧名：配对身份随每行给出，三审时会有三行
    L.push('| 阶段/轮 | 配对 | Jaccard（归一化） | 未归一化 | 共同覆盖 | 仅前者 | 仅后者 |', '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const d of withDiv) {
      for (const v of d.divergences) {
        L.push(
          `| ${d.stage} r${d.rerunIndex} | ${v.a} × ${v.b} | ${v.jaccard.toFixed(2)}${v.degenerate ? ' ⚠️' : ''} | ` +
            `${v.rawJaccard.toFixed(2)} | ${v.overlap.length} | ${v.onlyA.length} | ${v.onlyB.length} |`,
        );
      }
    }
    const degenerate = withDiv.filter((d) => d.divergences.some((v) => v.degenerate));
    L.push('');
    if (degenerate.length > 0) {
      L.push(
        `> ⚠️ 有 ${degenerate.length} 轮存在重合度超过阈值的配对：那两家在看同一批地方，差异化镜头没起作用。`,
        '> 建议调整 `lenses.yaml` 的镜头，或改用差异更大的模型组合。**这是提示，不是错误。**',
        '',
      );
    }
    L.push(
      '> 位置先归一化再比（行区间重合、章节前缀、路径前缀），否则指标恒为 0——',
      '> 实测过两侧概念重叠而原始 Jaccard 为 0.00 的情形。',
      '',
    );
  }

  // ── 七、耗时与 token ──
  L.push('## 七、耗时与 token 汇总', '');
  const perSide: Partial<Record<CriticId, Record<string, number>>> = {};
  let totalSeconds = 0;
  for (const d of r.rounds) {
    totalSeconds += d.sides.reduce((a, s) => Math.max(a, s.durationS), 0);
    for (const c of Object.keys(d.tokens) as CriticId[]) {
      const acc = (perSide[c] ??= {});
      for (const [k, v] of Object.entries(d.tokens[c]!)) acc[k] = (acc[k] ?? 0) + v;
    }
  }
  L.push(`- **墙钟合计**（各轮取较慢侧）：${Math.round(totalSeconds)}s`, '');
  const sidesWithTokens = Object.keys(perSide) as CriticId[];
  if (sidesWithTokens.length === 0) {
    L.push('- **token**：厂商未在产物中提供用量，无法汇总（不估算）', '');
  } else {
    for (const c of sidesWithTokens) {
      const entries = Object.entries(perSide[c]!).sort(([a], [b]) => a.localeCompare(b));
      L.push(`- **${c} token**：${entries.map(([k, v]) => `${k} ${v}`).join(' ｜ ')}`);
    }
    L.push(
      '',
      '> 两侧**不合计**：agy 用 `input_tokens` 一套字段名，zcode 用 `inputTokens` 另一套，',
      '> 相加只会得出一个谁都对不上的数。也只收数值字段，厂商混进来的字符串（如 `source`）一律丢弃。',
      '',
    );
  }

  // ── 八、编译测试出口 ──
  L.push('## 八、编译测试出口', '');
  if (r.verify) {
    L.push(`- ${summarizeVerify(r.verify)}（运行 \`${r.verify.run_id}\`）`, '');
  } else if (r.verifyUnreadable) {
    // 「记录损坏」渲染成「尚无记录」就是把失败伪装成没发生过（P5）
    L.push(
      `- ⚠️ **最近一份 verify 记录损坏**（\`${r.verifyUnreadable}\`），无法判断是否通过。`,
      '  这**不等于**从未验证——请检查该文件，必要时重跑 `trivium verify`。',
      '',
    );
  } else {
    L.push('- 尚无 verify 记录', '');
  }

  // ── 九、审批 ──
  L.push('## 九、审批记录', '');
  if (r.task.approvals.length === 0) {
    L.push('（无）', '');
  } else {
    L.push('| 时间 | 阶段 | 运行 | 结论 | 理由 |', '| :--- | :--- | :--- | :--- | :--- |');
    for (const a of r.task.approvals) {
      L.push(
        `| ${a.at} | ${a.stage} | \`${a.run_id}\` | ${a.decision} | ` +
          `${(a.reason ?? '').replace(/\|/g, '\\|')} |`,
      );
    }
    L.push('');
  }

  return L.join('\n') + '\n';
}
