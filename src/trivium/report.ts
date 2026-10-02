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
import { promises as fs } from 'node:fs';
import { DEFAULT_DRIVER, type AgentId, type GuardLevel } from './agents/registry.js';
import { listStageArtifacts, metaDir, type ArchiveLayout } from './archive.js';
import { readRunMeta, readTask, type TaskMeta } from './meta.js';
import { loadRoundReviews } from './gate.js';
import { parseDisposition } from './disposition.js';
import { measureAllPairs, type DivergenceReport } from './divergence.js';
import { summarizeVerify, type VerifyRecord } from './verify.js';
import { CRITICS, DEFAULT_CRITICS, STAGES, describeDriftUnknown, EVIDENCE_UNTRUSTED_CAUSE_TEXT, type CriticId, type Disposal, type RunMeta, type Severity, type Stage } from './types.js';

const SEVERITIES: readonly Severity[] = ['blocker', 'major', 'minor', 'nit'];
const DISPOSALS: readonly Disposal[] = ['接受', '驳回', '暂缓'];

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
   * 当轮 Driver 在这次运行时的有效护栏等级（M10b 第 3 步 B1，`run.v2` 的可选字段 `driver_guard_level`）。
   * 早于该步的留痕没有它，记 null、渲染为「—」——不补成 L1，缺失即「无从得知」。
   */
  driverGuardLevel: GuardLevel | null;
  degradedReason: string | null;
  /** 逐侧：生效模型、状态、耗时、意见数 */
  sides: {
    critic: CriticId;
    status: string;
    modelEffective: string | null;
    modelRequested: string | null;
    durationS: number;
    findings: number | null;
    /**
     * 逐条降级的意见数（设计 §6.5），取自 run.json 的 `critics[c].findings_degraded`；早于该字段的留痕与
     * 未解析成功的侧为 0。`findings` 只数合格意见，这一格不并进去——降级意见不参与严重度统计。
     */
    findingsDegraded: number;
    evidenceOk: boolean;
    failReason: string | null;
  }[];
  /** 两侧合计的严重度分布 */
  severity: Record<Severity, number>;
  /** 裁决分布；裁决件缺失时为 null */
  disposals: Record<Disposal, number> | null;
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
}

const zeroSeverity = (): Record<Severity, number> => ({ blocker: 0, major: 0, minor: 0, nit: 0 });

/** 枚举某阶段所有已产出审查工件的轮次与其 run_id */
async function enumerateRounds(
  layout: ArchiveLayout,
  stage: Stage,
  /** 当轮 Driver：它的产出（原稿与裁决件）不定义轮次（审查意见 AGY-04 / GLM-06） */
  driver: AgentId = DEFAULT_DRIVER,
): Promise<{ rerunIndex: number; runId: string | null }[]> {
  const items = await listStageArtifacts(layout, stage);
  const byRound = new Map<number, string | null>();
  for (const i of items) {
    if (i.parsed.role === driver) continue; // 原稿与裁决件不定义轮次
    if (!byRound.has(i.parsed.rerunIndex)) byRound.set(i.parsed.rerunIndex, null);
  }

  // run_id 从 _meta/run-*.json 反查：文件名里带，比解析 front-matter 更直接
  const dir = metaDir(layout, stage);
  let metaFiles: string[] = [];
  try {
    metaFiles = await fs.readdir(dir);
  } catch {
    /* 阶段还没跑过 */
  }
  for (const f of metaFiles.sort()) {
    const m = /^run-(.+)\.json$/.exec(f);
    if (!m) continue;
    const runId = m[1]!;
    const meta = await readRunMeta(layout, stage, runId);
    if (meta && byRound.has(meta.rerun_index)) byRound.set(meta.rerun_index, runId);
  }

  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rerunIndex, runId]) => ({ rerunIndex, runId }));
}

/** 找本轮的裁决件（`-revised-claude.md` 或 `-response-claude.md`） */
async function loadDisposition(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  notes: string[],
  /** 裁决件后缀 = 当轮 Driver（审查意见 AGY-04 / GLM-06） */
  driver: AgentId = DEFAULT_DRIVER,
): Promise<{ disposals: Record<Disposal, number>; contested: RoundReport['contested'] } | null> {
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
    return null;
  }
  const parsed = parseDisposition(md);
  const disposals: Record<Disposal, number> = { 接受: 0, 驳回: 0, 暂缓: 0 };
  const contested: RoundReport['contested'] = [];
  for (const r of parsed.rows) {
    disposals[r.disposal]++;
    if (r.disposal !== '接受') {
      contested.push({ id: r.id, disposal: r.disposal, severity: r.severity, reason: r.reason });
    }
  }
  return { disposals, contested };
}

async function buildRound(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  runId: string | null,
): Promise<RoundReport> {
  const notes: string[] = [];
  const base: RoundReport = {
    stage,
    rerunIndex,
    runId: runId ?? '（读不到 run_id）',
    startedAt: null,
    finishedAt: null,
    status: null,
    reviewMode: null,
    criticsSelected: [],
    driver: null,
    driverGuardLevel: null,
    degradedReason: null,
    sides: [],
    severity: zeroSeverity(),
    disposals: null,
    contested: [],
    divergences: [],
    guardFlags: [],
    tokens: {},
    notes,
  };

  if (!runId) {
    notes.push('该轮有审查文档但找不到对应的 `_meta/run-*.json`，元数据部分无法呈现');
    return base;
  }

  const meta = await readRunMeta(layout, stage, runId);
  if (!meta) {
    notes.push(`\`_meta/run-${runId}.json\` 读取失败`);
    return base;
  }

  base.startedAt = meta.started_at;
  base.finishedAt = meta.finished_at;
  base.status = meta.status;
  base.reviewMode = meta.review_mode;
  base.criticsSelected = [...meta.critics_selected];
  base.driver = meta.driver;
  base.driverGuardLevel = meta.driver_guard_level ?? null;
  base.degradedReason = meta.degraded_reason;

  const { reviews, notes: reviewNotes } = await loadRoundReviews(layout, stage, runId);
  notes.push(...reviewNotes);

  for (const c of Object.keys(meta.critics) as CriticId[]) {
    const m = meta.critics[c]!;
    const review = reviews[c] ?? null;
    base.sides.push({
      critic: c,
      status: m.status,
      modelEffective: m.model_effective,
      modelRequested: m.model_requested,
      durationS: m.duration_s,
      findings: review ? review.findings.length : null,
      findingsDegraded: m.findings_degraded?.length ?? 0,
      evidenceOk: m.evidence_ok,
      failReason: m.fail_reason ?? null,
    });
    for (const f of review?.findings ?? []) {
      if (SEVERITIES.includes(f.severity)) base.severity[f.severity]++;
    }
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

  if (meta.guard.readonly_breach) base.guardFlags.push('只读失守');
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
   * `peer_deny_applied` 读的是探针格，对本次注入的规则一无所知。于是
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

  const disp = await loadDisposition(layout, stage, rerunIndex, notes);
  if (disp) {
    base.disposals = disp.disposals;
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
    const meta = await readRunMeta(layout, stage, runId);
    if (!meta) {
      notes.push(`\`${stage}/_meta/${f}\` 读不出来（不可解析或不合契约），未列入报告`);
      continue;
    }
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
    const enumerated = await enumerateRounds(layout, stage);
    for (const { rerunIndex, runId } of enumerated) {
      rounds.push(await buildRound(layout, stage, rerunIndex, runId));
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
  };
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
  L.push('## 四、生效模型（AC-13 / AC-18 核对）', '', '| 阶段/轮 | 侧 | 请求 | 实际生效 | 证据 |', '| :--- | :--- | :--- | :--- | :--- |');
  for (const d of r.rounds) {
    for (const s of d.sides) {
      const mismatch = s.modelEffective && s.modelRequested && !s.modelEffective.endsWith(s.modelRequested);
      L.push(
        `| ${d.stage} r${d.rerunIndex} | ${s.critic} | ${s.modelRequested ?? '—'} | ` +
          `${s.modelEffective ?? '**未回读到**'}${mismatch ? ' ⚠️' : ''} | ${s.evidenceOk ? 'ok' : '不足'} |`,
      );
    }
  }
  L.push('', '> `未回读到` 表示生效模型无法核实，一律不用请求值顶替（AC-13）。', '');

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
