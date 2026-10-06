/**
 * `review`：一次双审运行的编排（设计 §8.2 S2 / 第 9~11 章）。
 *
 * 顺序有讲究，不能调：
 *   冻结 → 生成两侧送审包 → 置闸门 running → 写 run.json 骨架 → **并行**拉起两侧 →
 *   复算快照 → 解析 → guard 判定 → 两侧齐备后**同时**落盘 → 收尾元数据
 *
 * 「两侧齐备后同时落盘」是背靠背隔离的第 ② 道（§10.1）：审查进行中，对方本次结论
 * 在项目树内**物理不存在**（原始输出在 `~/.trivium/runs/` 下，项目外），
 * 因此不需要靠提示词去要求对方「别看」。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  Config, CriticId, CriticRequest, CriticResult, Ctx, DenyCategory, Review, Stage, CommandEntry,
  DegradedFinding, FallbackCause, ParseRepairs,
} from './types.js';
import { CRITIC_PREFIX, CRITIC_VENDOR, VOIDING_DENY_CATEGORIES } from './types.js';
import { DEFAULT_DRIVER, agentById, type AgentId } from './agents/registry.js';
import {
  isHeterogeneous,
  routeModel,
  type AdapterContext,
  type AdapterTable,
} from './adapters/base.js';
import { resolveAdapters } from './adapters/stub.js';
import { realAdapters } from './adapters/index.js';
import { freeze } from './freeze.js';
import {
  buildMustReadList,
  denyContextFor,
  excerptSubject,
  extractPathReferences,
  findDenyConflicts,
  loadLenses,
  loadStagePrompt,
  MUST_READ_PRUNED_DISPLAY_MAX,
  plainWarningText,
  renderBrief,
  renderContextConflicts,
  renderPrunedWarnings,
  TASK_GOAL_MAX,
  WARNING_MARK,
  type MustReadSource,
  type PrunedEntry,
  type SideConflicts,
} from './brief.js';
import { parseReview, checkReviewIntegrity, enumerateFallbackFindings } from './parse.js';
import { decideMode, runBothSides, type SideProgress } from './runner.js';
import { judgeRun, renderGuardWarnings, type SideVerdict } from './guard.js';
import { FALLBACK_CAUSE_LABEL, renderReviewDoc, type RenderInput } from './render.js';
import { resolveTopicReadOnly, locateSubject } from './topic.js';
import { parseArtifactName, shellQuoteArg } from './naming.js';
import {
  buildDiffHeader,
  classifyDiff,
  diffExcludePrefixes,
  diffFileName,
  filesInDiff,
  parseFrozenDiff,
  renderSkipNotice,
  summarizeDiff,
  type SkipVerdict,
} from './code-stage.js';
import { diffAgainst, headSha } from './util/git.js';
import { collectBuildStampNotices, embeddedBuildStamp } from './build-stamp.js';
import { firstFreeRerunIndex, resolveRerunIndex, stageDir, writeArtifact, writeMeta, metaDir, type ArchiveLayout } from './archive.js';
import {
  RUN_ID_MAX_BUMPS, allocateRunId, finalizeFailedRunMeta, finalizeLines, newRunMeta, readRunMeta, readTask, registerRun, summarizeRun, writeRunMeta,
  type TaskLock,
} from './meta.js';
import { acquireLock, type LockHandle } from './lock.js';
import { measureAllPairs, renderDivergence } from './divergence.js';
import { agentConfigOf, resolveAssetRoot, resolveReviewSchemaPath, runRoot, vendorProfileOf } from './config.js';
import { resolveCriticSelection } from './critics.js';
import { releaseRunningGateEntry, setGateChecked } from './state.js';
import { ensureDir, sha256, sha256File } from './util/fsx.js';
import { workTreeHash } from './util/git.js';
import {
  EXIT,
  envError,
  exitCodeOf,
  missingArtifact as missingArtifactError,
  usageError,
  TriviumError,
} from './exit-codes.js';
import { checkModelSlugs } from './preflight.js';
import { assertNoSecrets } from './secrets.js';
import { say, step, warn } from './util/log.js';
import { effectiveGuardLevel } from './hook-config.js';

/**
 * 把单侧判定里的禁读结论整理成渲染层要的形状（设计 §10.1.1）。
 *
 * 三件事在这里定：
 *   - **走哪条通道**：两条通道分列而不是并成一个布尔，排查时才看得出
 *     「读了那个文件」与「跑了一条提到它的命令」的区别；
 *   - **取最重的那一类**：同一侧一轮内可同时命中多类（例如既读了对端审查件、
 *     又列了编排器目录），处置按最重档走，而 front-matter 的 `paths` 仍逐条带类；
 *   - **作废与否**：只有对端产物那两类会让该侧结论作废。
 */
/**
 * 共同阻断这一档的**运行期事实**（设计 §6.6 规则 7 / §12.1）。
 *
 * ## 运行期只到 `pending`
 *
 * 这一档的判据是「两侧同时提出的 blocker 被 Driver 驳回」——而裁决表要到运行
 * 结束之后才写。运行期知道的只有一件事：排除作废侧与无结构化结论的侧之后，
 * **还够不够两家**。
 *
 * 上一版在够两家时落 `checked-none`（「查过、没有共同项」），那是一句运行期给不出
 * 的断言：这一档当时根本还没查。三态里最要紧的那一态被一句伪阴性顶掉了——
 * 正是本主题一路在修的形态，而这次它出现在**本主题自己的交付物**里。
 *
 * 最终三态由 `gate --check` 判、落 `task.json.joint_checks`。
 *
 * ## 为什么独立成函数
 *
 * `run.json` 与单侧审查文档的 front-matter 都要用它。上一版只有前者，
 * 补 front-matter 时若各算各的，两处的分母会漂——而这个数正是「还剩几层防线」，
 * 两份留痕给出不同的数，对账时无从判断哪个算数。
 */
function jointCheckRunState(
  sides: readonly CriticId[],
  verdict: { sides: Partial<Record<CriticId, SideVerdict>> },
  reviews: Partial<Record<CriticId, Review | null>>,
): { state: 'pending' | 'skipped-insufficient-sides'; effective_sides: number } {
  const effective = sides.filter(
    (c) =>
      verdict.sides[c] !== undefined &&
      !verdict.sides[c]!.peerArtifactRead &&
      /*
       * 分母与 `jointCheckState` **对齐**：那边数的是「未作废且有结构化结论」的侧，
       * 判据是 `reviews[c]` 非空——`gate` 拿到的正是这张表。
       *
       * 上一版这里只排作废，于是同一个 `effective_sides` 在 run.json 与告警文案里
       * 可以是两个数。起草这次对齐时我先用了 `results[c].review_json`：
       * 那个字段在运行期恒为 null（`CriticResult` 的注释就写着「由 parse 填充」，
       * 而填的是 `reviews`，不是回写结果对象），于是两侧全被排除、
       * 这一档恒记「有效侧不足」——把要修的三态塌缩换了个方向再犯一次。
       * 是新补的那条端到端用例当场逮住的。
       */
      reviews[c] != null,
  ).length;
  return effective < 2
    ? { state: 'skipped-insufficient-sides', effective_sides: effective }
    : { state: 'pending', effective_sides: effective };
}

function peerLeakOf(side: SideVerdict): NonNullable<RenderInput['peerLeak']> | undefined {
  const viaPath = side.peerHits.length > 0;
  const viaCmd = side.peerCommandHits.length > 0;
  const noted = side.notedCategories.length > 0;
  if (!viaPath && !viaCmd && !noted) return undefined;

  /*
   * 类别取**实际命中里最重的那一个**，不是写死的字面量（r1 三侧独立指出）。
   *
   * 初版写的是 `viaPath || viaCmd ? 'peer-artifact' : notedCategories[0]`：
   * 命中第②类（运行根下对端输出）时 front-matter 仍报第①类，
   * 而同一条留痕里 `paths` 又是逐条带类的——**头档不带类、路径带类，自相矛盾**；
   * 非作废侧取数组第一个（Map 插入序）同样失真，「取最重档」在两条路径上都没实现。
   */
  const severity = (c: DenyCategory): number => {
    switch (c) {
      case 'peer-artifact': return 4;
      case 'peer-run-output': return 3;
      case 'sensitive': return 2;
      case 'orchestrator-state': return 1;
      case 'own-run-material': return 0;
    }
  };
  const voiding = viaPath || viaCmd;
  /*
   * 两条通道的命中**都**进 pool（r2 代码双审 AGY-04）。
   *
   * 上一版只取 `typedHits`（路径通道），命令通道单独命中时 pool 为空、
   * 回落到写死的 `peer-artifact`——而命令通道现在也逐条带类，
   * 它命中的可能是第②类（运行根下的对端输出）。回落等于把第②类报成第①类，
   * 与「类别取实际命中里最重的那一个」这条刚立的规矩直接冲突。
   */
  const pool: DenyCategory[] = voiding
    ? [...side.typedHits, ...side.typedCommandHits]
        .filter((h) => VOIDING_DENY_CATEGORIES.includes(h.category))
        .map((h) => h.category)
    : [...side.notedCategories];
  /*
   * 兜底只在「命中了但一条明细都没有」时触发——接线正确时不可达。
   * 保留它是为了不让渲染层因为空数组抛异常，不是为了填一个像样的值。
   */
  const category: DenyCategory =
    pool.length > 0
      ? pool.reduce((a, b) => (severity(b) > severity(a) ? b : a))
      : (voiding ? 'peer-artifact' : 'orchestrator-state');

  /*
   * **`via` 按实际渲染的那一档取**（r2 代码双审 GLM-06 ≡ CODEX-06）。
   *
   * 上一版只看作废类的两个数组，于是告警档（只记一笔那一档）恒报 `via: 'path'`——
   * 哪怕命中完全来自命令通道。留痕里「经哪条通道漏的」是排查的起点，
   * 而这个字段在告警档上一直是个常量。
   */
  const paths = voiding ? side.peerHits : side.notedPaths;
  const commands = voiding ? side.peerCommandHits : side.notedCommands;

  return {
    hit: true,
    via: paths.length > 0 && commands.length > 0 ? 'both' : commands.length > 0 ? 'command' : 'path',
    category,
    voiding,
    paths,
    // 命令通道的命中原文——作废与告警两档都要能复盘「到底碰了什么」
    commands,
  };
}

/**
 * 任务目标的折叠规则：所有空白折成一个空格、去首尾。**只此一份**——`clampGoal` 与附录判定共用
 * （任务目标全文送审计划 r2 §2.1，计划双审 CODEX-03）：各写一份，改了一处另一处静默分叉。
 */
function foldGoal(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 第 4 段的任务目标摘要：折叠后超过 `TASK_GOAL_MAX`（声明在 `brief.ts`）就截断加「…」。
 * 任务文件的 `goal` 与运行元数据的 `task_goal` 存的也是它（设计 §6.7）。
 */
function clampGoal(raw: string | null | undefined): string | null {
  const t = foldGoal(raw);
  if (t.length === 0) return null;
  return t.length > TASK_GOAL_MAX ? `${t.slice(0, TASK_GOAL_MAX)}…` : t;
}

/**
 * 计划阶段附录要给出的任务目标原文；不出附录时返回 null（设计 §9.4，EV-210，任务目标全文送审计划 r2 §2.2）。
 *
 * 只在**计划阶段**、本次**显式** `--goal` 的摘要真被截了一刀时给出：
 *   - 判「被截断」与 `clampGoal` 同口径（同一个 `foldGoal`、同一单位）——200 字以内但含换行的目标，
 *     摘要折掉了换行却没丢内容，不出附录，任务书逐字不变；
 *   - 只认 `rawGoal`（`opts.taskGoal`，本次命令行的原文）：目标来自任务文件或计划定稿时它为空，自然不出；
 *   - 代码阶段只出摘要：那一阶段的依据是计划定稿（`resolvePlanFinal`），用户原话里的决策已被计划双审裁过。
 *
 * 原文只做两处规整：`\r\n` → `\n`、去首尾空白；其余逐字。附录的上限在 `brief.ts` 渲染时按码点截。
 */
export function taskGoalAppendix(stage: Stage, rawGoal: string | null | undefined): string | null {
  if (stage !== 'plan') return null;
  if (foldGoal(rawGoal).length <= TASK_GOAL_MAX) return null;
  return (rawGoal ?? '').replace(/\r\n/g, '\n').trim();
}

/**
 * 计划阶段被审对象的轮次，写进 run.json `plan_final_check.subject_rerun_index`（EV-214，计划 r2 §2.6）。
 *
 * 只认**本主题 `plan/` 根下、当轮 Driver 的原稿形态**：文件名可解析、主题相同、后缀为当轮 Driver、
 * 无 `-revised` / `-response` 中缀——与 `locateSubject` 自动候选的筛法同一口径。其余（归档外的 `--plan-file`、
 * 名字不合规、别家后缀、裁决件）一律 null：闸门据此退回 `rerun_index` 当基准，不猜一个轮次。
 *
 * 纯函数、不碰文件系统：被审对象此刻已由 `locateSubject` 定位并读过，是不是审查件那道剔除已在那里做完。
 */
export function planSubjectRerunIndex(layout: ArchiveLayout, subjectPath: string, driver: AgentId): number | null {
  if (path.resolve(path.dirname(subjectPath)) !== path.resolve(stageDir(layout, 'plan'))) return null;
  const parsed = parseArtifactName(path.basename(subjectPath));
  if (!parsed || parsed.topic !== layout.topic || parsed.role !== driver || parsed.kind !== null) return null;
  return parsed.rerunIndex;
}

/** 计划阶段留痕读不出、没能列入计划定稿时的告警名（与「必读清单剔除」同形、同三个出口） */
export const PLAN_FINAL_UNLISTED_WARNING = '必读清单未列计划定稿';

/**
 * 代码阶段要列入必读的本主题计划定稿（设计 §9.4 第 4 条，EV-210，任务目标全文送审计划 r2 §2.4）。
 *
 * 取法：先用全仓唯一的三级判定 `resolveStageDriver` 定**计划阶段**的执笔方（不是代码阶段的——
 * 两个阶段可以分属两家），再用 `locateSubject` 按它的后缀取非裁决件、轮次最大的一份：
 * 有修订稿（`-r2-`…）取最新修订稿，没有取原稿。裁决件不列（计划 r2 §2.5：它逐条复述别的审查员的意见）。
 *
 * - 计划阶段最新留痕读不出（`corrupt`）⇒ 不列，返回一条告警；不拒跑：这是自动条目，用户此刻改不了它（同 EV-02）。
 * - `locateSubject` 抛出（没有计划目录、或没有该执笔方的原稿）⇒ 不列、无告警：「本主题没有计划阶段」是正常情况。
 *
 * 返回项目相对路径；列进第 4 段后照常过本侧交集判定（撞上禁读集即剔除并告警）。
 * `resolveTaskGoal` 第三级就取这里的结果（EV-212）：全仓只留这一处「哪份是计划定稿」的判定。
 */
export async function resolvePlanFinal(
  ref: { topic: string; layout: ArchiveLayout },
  projectRoot: string,
): Promise<{ path: string | null; warning: { name: string; detail: string } | null }> {
  const { resolveStageDriver } = await import('./driver-claim.js');
  const resolution = await resolveStageDriver(ref.layout, 'plan');
  if (resolution.kind === 'corrupt') {
    const { unreadableRunMetaExitAt } = await import('./meta.js');
    return {
      path: null,
      warning: {
        name: PLAN_FINAL_UNLISTED_WARNING,
        detail:
          `${WARNING_MARK}本主题计划阶段的运行留痕读不出（${resolution.unreadable.join('、')}），判不出计划阶段的执笔方，` +
          '任务书第 4 段没有列入本主题计划定稿；本轮照常审查。\n' +
          unreadableRunMetaExitAt(ref.layout, 'plan', resolution.unreadable),
      },
    };
  }
  try {
    // driver-wiring.test.ts 按锚点 `planStageRef` 核这一处 driver 的取值：改变量名要同步护栏表
    const planStageRef = { topic: ref.topic, layout: ref.layout, stage: 'plan' as const,
      stageDirAbs: stageDir(ref.layout, 'plan') };
    const abs = await locateSubject(planStageRef, null, projectRoot, resolution.driver);
    return { path: path.relative(projectRoot, abs), warning: null };
  } catch {
    /*
     * 阶段目录 `readdir` 失败也落到这里：`locateSubject` 把它当空目录、随后抛 65，与「没有计划阶段」同归一处
     * （代码双审 GLM-03）。有意不收窄：收窄会让自动条目的意外形态上抛、拦住整轮代码审，与「自动条目不拒跑」相悖。
     */
    return { path: null, warning: null };
  }
}

/** 计划定稿没合入计划阶段最新一轮接受项（或无从复核）时的告警名（EV-215；与「必读清单未列计划定稿」同形、同三个出口） */
export const PLAN_FINAL_RECHECK_WARNING = '计划定稿未通过复核';

/**
 * 代码阶段计划定稿复核的告警（设计 §6.6 规则 9 边界④，EV-215，计划定稿复核计划 r2 §2.5）；通过或不复核时返回 null。
 *
 * 判据在 `gate.ts` 的 `recheckPlanFinal`（与计划阶段闸门同一份），这里只管措辞。失败时把 `checkNextPlan` 的失败消息
 * **原文**嵌进来：判据一份、措辞也只留一份，两种消息分别给出应写的文件名与核对的文件，正是要点名的东西。
 *
 * 不拒跑、不剔除、任务书第 4 段也不标注（计划 r2 §2.6）：处置在 Driver 手里，告警经三个出口到达 Driver 与裁决时的
 * `gate --check`；带编号的标注会把裁决信息推进各侧（FR-10）。
 *
 * `finalPath` 是 `resolvePlanFinal` 给出的项目相对路径；`codeDriver` 只用来写处置里的调用写法。
 */
export async function planFinalRecheckWarning(
  layout: ArchiveLayout,
  finalPath: string,
  codeDriver: AgentId,
): Promise<{ name: string; detail: string } | null> {
  const { recheckPlanFinal } = await import('./gate.js');
  // 传文件名而不是路径：parseArtifactName 锚定日期开头（计划双审 AGY-01）
  const r = await recheckPlanFinal(layout, path.basename(finalPath));
  if (r.kind === 'skipped' || r.kind === 'passed') return null;
  if (r.kind === 'unverifiable') {
    return {
      name: PLAN_FINAL_RECHECK_WARNING,
      detail:
        `${WARNING_MARK}本主题计划定稿 ${finalPath} 无从复核：${r.reason}。` +
        '本轮照常审查；定稿是否合入了计划阶段最新一轮被接受的意见，需人工核对。',
    };
  }
  const { entryCommandOf } = await import('./agents/registry.js');
  return {
    name: PLAN_FINAL_RECHECK_WARNING,
    detail:
      `${WARNING_MARK}本主题计划定稿 ${finalPath} 没有通过复核：计划阶段第 ${r.rerunIndex} 轮（run ${r.runId}）有被接受的意见，` +
      `按 §6.6 规则 9 的同一份判据核对——${r.failure.message}\n` +
      `  涉及编号：${(r.failure.ids ?? []).join('、')}。本轮照常审查，代码审查员读到的仍是这份定稿。\n` +
      '  处置二选一：① 把这些接受项合进计划定稿（没有新一轮计划时按上面的文件名写一份；编号逐条写进开头的「相对上一轮的改动」）后，' +
      '重跑代码双审；' +
      `② 把这份定稿送一轮计划双审（${entryCommandOf(codeDriver, 'dual-review-plan')}），按那一轮的裁决定稿后再跑代码双审。`,
  };
}

/**
 * 任务书第 4 段的告警拼接（EV-210 / EV-215；计划定稿复核计划 r2 §2.5，计划双审 CODEX-01 抽成纯函数以便单测顺序与封顶）。
 *
 * 计划定稿的两条告警（「未列入」与「未通过复核」，互斥、合起来至多一条）排在剔除告警之前，**不计入剔除封顶**：
 * 封顶管的是「按侧 × 条目」可能很长的那一串，计划定稿是主题级的单条事实。`all` 进 run.json 的 `gate.warnings`，
 * `display` 进 `--start` 与同步路径的播报。
 */
export function composeMustReadWarnings(
  planFinalWarnings: readonly { name: string; detail: string }[],
  pruned: readonly PrunedEntry[],
  sides: readonly CriticId[],
): { all: Array<{ name: string; detail: string }>; display: Array<{ name: string; detail: string }> } {
  return {
    all: [...planFinalWarnings, ...renderPrunedWarnings(pruned, sides)],
    display: [...planFinalWarnings, ...renderPrunedWarnings(pruned, sides, MUST_READ_PRUNED_DISPLAY_MAX)],
  };
}

/**
 * 从本主题计划定稿里取任务目标：第一个 Markdown 标题，取不到就取第一段正文。
 *
 * 跳过 YAML front matter 与围栏代码块——否则 `---` 或 ```lang 会被当成标题行。
 */
function goalFromPlanDoc(text: string): string | null {
  const lines = text.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const t = line.trim();
    if (t.length === 0) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(t);
    return clampGoal(h ? h[1]! : t);
  }
  return null;
}

/** `resolvePlanFinal` 的结果：计划定稿的项目相对路径（取不到为 null）与至多一条告警 */
export type PlanFinal = Awaited<ReturnType<typeof resolvePlanFinal>>;

/**
 * 解析本次要送进 BRIEF 第 4 段的任务目标（设计 §9.4）。
 *
 * 三级来源，取第一个非空：
 *   1. 显式 `--goal`（`/dual-run <任务目标>` 透传而来）
 *   2. `task.json` 的 `goal`——主题首次跑时落下的摘要（`clampGoal` 之后的值，不是原文；设计 §6.7），后续阶段复用
 *   3. 本主题计划定稿（`resolvePlanFinal`：计划阶段执笔方、轮次最大的一份）的首个标题/首段
 *
 * 都取不到就返回 null，该行不渲染（保持既有行为，不硬造一个目标去误导审查员）。
 * 刻意**不**兜底到主题名：主题是个短标签，当任务目标只会给审查员噪音。
 *
 * 两侧共用同一个结果——和「补丁只算一次」同理，否则两位审查员可能看到不同的目标。
 *
 * **`planFinal` 必填**（EV-212）：第三级曾自己用本轮 Driver 的后缀找计划文档，计划与代码 / bug 阶段分属两家时
 * 静默取空或取到别家后缀的文件。现在只认 `resolvePlanFinal` 那一处判定；做成可选参数的话，漏传会静默退回某种
 * 旧取法——正是本题要堵的那一类。它只在第三级真正走到时调用、至多一次：代码阶段由 `prepareRun` 传入已算好的结果，
 * bug 阶段走到时才现算。
 */
export async function resolveTaskGoal(
  opts: Pick<ReviewOptions, 'taskGoal' | 'stage'>,
  ref: { topic: string; layout: ArchiveLayout },
  projectRoot: string,
  planFinal: () => Promise<PlanFinal>,
): Promise<string | null> {
  const explicit = clampGoal(opts.taskGoal);
  if (explicit) return explicit;

  const persisted = clampGoal((await readTask(ref.layout)).goal);
  if (persisted) return persisted;

  /*
   * plan 阶段不走这条回退：它的被审对象**就是**那份计划文档，
   * 再把自己的标题当成任务目标塞回第 4 段，是同义反复。
   */
  if (opts.stage === 'plan') return null;

  try {
    const final = await planFinal();
    /*
     * `path` 为 null 有两种：本主题没有计划阶段（无告警，正常），或计划阶段留痕读不出（带告警）。
     * 后者的告警在这里**有意丢弃**（EV-212 决策二）：代码阶段 `prepareRun` 已把同一份结果的告警送进三个出口，
     * 这里再报是重复；bug 阶段要同时满足「bug 阶段、两级都没有目标、计划阶段留痕读不出」才走到，而留痕读不出
     * 本身已被计划阶段各入口与提交时的留痕核对拒绝——不另起告警、不拒跑，取不到目标与「没有计划阶段」同样不渲染。
     */
    if (!final.path) return null;
    // 项目相对路径按同一个 projectRoot 还原，不能按进程 cwd 读
    return goalFromPlanDoc(await fs.readFile(path.resolve(projectRoot, final.path), 'utf8'));
  } catch {
    /*
     * 读件失败（竞态删除等），或 bug 阶段现算 `resolvePlanFinal` 时意外抛出：静默跳过，与旧第三级同口径。
     * try 包住 `planFinal()` 本身是为 bug 阶段——那次调用是新增的，不能借它给 bug 阶段添一个拒跑面。
     */
    return null;
  }
}

/**
 * `heterogeneous: false` 那一格的成因说明（EV-54）。
 *
 * ## 为什么必须有写入方
 *
 * `run.v2` 的散文契约写着「false 时必须有 `override_reason`」，而承接侧
 * （`render.ts` 的声明、落盘、渲染三处）**早就接通了，一直没有人传值**。
 * M9 第 4 步推后它的理由是「claude 一次也选不上，补的写入方没有任何路径能端到端
 * 验证」——那条理由被第 5 步的 `--driver` 当场消灭：`--driver <非 claude> --critics claude`
 * 之后 claude 真能入选，而 `isHeterogeneous` 对 claude 系模型**恒返回 false**。
 * 不补的话，第 6 步验收产出的那份留痕必然自相矛盾，而它要作为达成证据进台账。
 *
 * ## 取值来源写死在这里，不留给调用点各写一份
 *
 * 只有两种成因：用户显式指定，或档位默认落在了与当轮 Driver 同族的模型上。两个写点
 * （审查文档 front-matter 与运行元数据）**共用本函数**——各写一份文案就会
 * 踩破「两处同值」这条判据本身。
 *
 * **只补写入方，不升 schema 的 `if/then` 机器判据**：那会让历史留痕集体读不回。
 *
 * ## M10a 第 4 步的变化（EV-62）
 *
 * 判据改为按**当轮 Driver 厂商的名义模型族**判定（`VENDOR_MODEL_FAMILY`，启发式），
 * 上面「恒返回 false」一句是 M9 时点的叙事，保留原文。文案随之不再写死「Claude 系」，
 * 改为点名当轮 Driver；历史留痕里的旧文案不回改，新旧两种说法并存。
 *
 * `agentById(driver)!` 的非空断言依赖的是 **run.v2 校验**：`driver` 取自 `meta.driver`，
 * 而 `meta` 在两条路径上都过了 `validateRunMeta` → `checkAgentIdentities`（要求 driver
 * 为已登记 id）——同步路径是 `prepareRun` 里 `writeRunMeta` 落盘之前，worker 路径是
 * `rebuildContext` 里 `readRunMeta` 读回之时（读不过即抛）。两个写点都在 `executeRun` 里，
 * 排在这两处之后。**不是「入口的 `resolveDriver` 已经拦过」**：worker 分支根本不经过它
 * （代码双审 r5 CODEX-01）。本函数自己不做这个判定。
 */
function overrideReasonFor(
  c: CriticId,
  model: string | null,
  modelOverrides: Partial<Record<CriticId, string>>,
  profileRequested: string | null,
  driver: AgentId,
): string | null {
  const desc = agentById(driver)!;
  if (isHeterogeneous(model, desc.vendor)) return null;
  return modelOverrides[c]
    ? `用户经 --model-${c} 显式指定了与当轮 Driver（${desc.display}）同族的模型`
    : `档位 ${profileRequested ?? '（缺省）'} 的默认模型与当轮 Driver（${desc.display}）同族`;
}

/** 运行目录按仓库路径哈希分桶，避免不同项目互相覆盖 */
export function repoId(projectRoot: string): string {
  return `${path.basename(projectRoot)}-${sha256(projectRoot).slice(0, 8)}`;
}

export interface ReviewOptions {
  ctx: Ctx;
  stage: Stage;
  topic: string;
  promptHint: string | null;
  /**
   * 任务目标原文：这次到底想达成什么（设计 §9.4，进 BRIEF 第 4 段）。
   *
   * **不要拿 `promptHint` 顶替它**（RV-19）：那是「本次审查焦点」，语义不同且已独占第 2 段。
   * 不传时由 `resolveTaskGoal` 回退到 task.json / 本主题计划定稿。
   */
  taskGoal?: string | null;
  /**
   * 发起本次运行的斜杠命令（A/B/C/D），记入 run.json 供留痕；手工调用为 null。
   * 也决定 `--focus` 是否必填：只有命令 A 的焦点是可选补充（PRD 第 8 章）。
   */
  entry?: CommandEntry | null;
  /** Driver 指明的相关路径（UR-01），并入必读清单 */
  contextPaths: string[];
  /** plan/bug 的被审对象显式路径 */
  subjectFile: string | null;
  modelOverrides: Partial<Record<CriticId, string>>;
  command: string;
  /**
   * 本轮**入选**的审核者集合（M7b 第 5 步）。
   *
   * 由调用方经 `resolveCriticSelection` 解析并校验完再传进来——本模块不再自己
   * 推导「跑哪几侧」。省略时回落到配置的 `review.default_critics`（同一个判定处），
   * 使手工构造 `ReviewOptions` 的调用点（测试、selftest）不必逐个补这个字段。
   */
  critics?: readonly CriticId[] | null;
  /**
   * 当轮 Driver（M9 第 5 步）。省略即注册表缺省值。
   *
   * 它在本模块决定四件事：轮次怎么算（`resolveRerunIndex`）、原稿是谁的后缀
   * （`locateSubject`）、禁读集怎么剪（`freeze`）、以及留痕里记的发起方（`newRunMeta`）。
   * **四个消费方都在 `prepareRun`，即 `--start` 侧**；`executeRun` 今天不读它。
   */
  driver?: AgentId;
  /** 覆盖 skill 资产根（默认取安装位置） */
  assetRoot?: string;
  /** code 阶段的 diff 基线，默认 HEAD */
  diffBase?: string | null;
  /**
   * 触发本次运行的 Claude Code 会话 id。
   *
   * 闸门写锁的作用域默认是「同会话」（RV-05）。传了才能区分「别的会话」；
   * 不传时闸门记 null，`shouldLockWrites` 按本会话保守加锁（不会静默失效）。
   */
  sessionId?: string | null;
  /**
   * 本次运行临时降级：一侧失败时不中止，产出单审结果并留痕（§12.4）。
   *
   * 受 `review.allow_partial_flag` 约束——配置里关掉这个开关，命令行也不能降级，
   * 否则「默认 strict」就成了纸面规定。
   */
  allowSingle?: boolean;
  /**
   * `prepareRun` 分配完 run_id、写骨架 run.json 之前调用（EV-151，同步路径扩展）。
   *
   * 只有同步路径传：它借此把 run_id 写进自己持有的主题锁（与 worker 锁同形），进程被 SIGKILL / Ctrl-C 中断之后，
   * 下一次取锁回收这把遗留锁时能定位到这一轮并收尾。`--start` **不传**——派生之前锁记的是 `--start` 自己，
   * 此时带上 run_id，`--start` 死在派生之后、改写成工作进程之前（EV-150 那个窗口）会把一个活工作进程的运行判成可收尾。
   * 回调自己负责吞错：写不进锁只是退回此前「定位不到」的形态，不该挡住本轮。
   */
  onRunIdAllocated?: (runId: string) => Promise<void>;
}

export interface ReviewOutcome {
  runId: string;
  rerunIndex: number;
  artifacts: string[];
  metaPaths: string[];
  warnings: string[];
  exitCode: number;
  /**
   * 逐侧真实状态。
   *
   * 工作进程要拿它去写 `status.json`——此前那里**硬编码 `'ok'`**，
   * 于是一侧硬失败时 `--wait` / `--status` 仍显示「gemini: ok」，
   * 操作者看到的状态与 run.json 相反。
   */
  sideStatuses: Partial<Record<CriticId, CriticResult['status']>>;
}

/**
 * 逐侧取思考等级。**按 vendor 分派，不按 Agent 身份穷尽。**
 *
 * 演化到第三版，每一版治的是上一版的病：
 *
 *   v1 三目：`critic === 'gemini' ? … : undefined`。非 gemini 的一切取值静默落进
 *   undefined，第三家接入后思考等级无声丢失——不抛异常、不退非零，只是那一侧
 *   按厂商默认档跑。
 *
 *   v2 `switch` + `never`（M7b 第 1 步）：把静默换成编译期硬阻塞。两值时无懈可击，
 *   但它把「哪几家有思考等级」钉成一张**按身份**的表，于是注册表加一家这里当场
 *   编译不过，而修法只有「再加一个 case」——「新增 Agent 只需接入套件」那句话
 *   就此不成立，第 6 步的零改动验收会被自己打红（计划 §3.5 / GLM-03 警告的形态）。
 *
 *   v3（本版）：判据改回**厂商**。`effort` 本来就是 antigravity 形状配置段的字段，
 *   ZCode 0.16.5 实测无等价旗标（M0 坑清单 C-07）——它是厂商事实，不是身份事实。
 *   而 vendor 随新 Agent 一起进注册表（接入套件第 ① 件），所以按它分派不必改这里。
 *
 * vendor 取**注册表登记的**，不取配置段里自称的：后者是被校验的一方，
 * 拿它当判据等于让被校验方自己决定走哪条分支。用注册表还能保住
 * `agentConfigOf` 的「缺段即就地失败」——若写成 `cfg.agents[critic]?.vendor === …`，
 * 配置缺了 `agents.gemini` 会静默返回 undefined，思考等级无声降级成默认档，
 * 而留痕里看不出配置有洞。
 */
function effortFor(
  cfg: Config,
  critic: CriticId,
  stage: Stage,
): 'low' | 'medium' | 'high' | undefined {
  if (agentById(critic)?.vendor === 'antigravity') {
    return agentConfigOf(cfg, critic, 'antigravity').effort[stage];
  }
  // 其余厂商形状不存在「思考等级」这个概念。是「本侧没有此概念」，不是「忘了传」。
  return undefined;
}

/** 一次运行的准备产物：`--start` 与同步路径共用，也是交接给工作进程的全部上下文 */
export interface PreparedRun {
  runId: string;
  rerunIndex: number;
  topic: string;
  stage: Stage;
  runDirBase: string;
  sides: CriticId[];
  requests: Partial<Record<CriticId, CriticRequest>>;
  snapshots: Partial<Record<CriticId, Awaited<ReturnType<typeof freeze>>>>;
  subjectPath: string;
  metaPaths: string[];
  layoutTopic: string;
}

/**
 * 一次运行的**内存上下文**。`--start` 与同步路径共用；工作进程从 `request.json`
 * 重建它（不可序列化的部分——适配器实例、配置对象——由 `ctx` 现场重建）。
 */
export interface RunContext {
  opts: ReviewOptions;
  cfg: Config;
  ctx: Ctx;
  stage: Stage;
  ref: Awaited<ReturnType<typeof resolveTopicReadOnly>>;
  adapterCtx: AdapterContext;
  adapters: AdapterTable;
  sides: CriticId[];
  runId: string;
  rerunIndex: number;
  subjectPath: string;
  runDirBase: string;
  requests: Partial<Record<CriticId, CriticRequest>>;
  snapshots: Partial<Record<CriticId, Awaited<ReturnType<typeof freeze>>>>;
  primarySnap: Awaited<ReturnType<typeof freeze>>;
  metaPaths: string[];
  meta: Awaited<ReturnType<typeof newRunMeta>>;
  /** code 阶段：待落盘的补丁（与 brief 一样推迟到写入阶段） */
  pendingDiff: { fileName: string; text: string } | null;
  /** code 阶段：FR-23 的跳过判定 */
  skipVerdict: SkipVerdict | null;
  /**
   * 准备阶段从各侧任务书第 4 段剔除的自动条目（EV-02，必读交集校验计划 r2 §2.5），按条目聚合的只警告项，
   * 播报用的封顶版（`MUST_READ_PRUNED_DISPLAY_MAX`，代码双审 CODEX-06；run.json 写的是全量，不经这里）。
   *
   * 两个播报出口：`--start` 的 `warnings`（`startRun` 追加）、同步路径（`executeRun` 并入）；
   * 第三个出口 run.json 的 `gate.warnings` 由 `prepareRun` 写骨架时直接写全量。工作进程从交接文件重建时给 `[]`：
   * 任务书已在 `--start` 时渲染好、告警已随 `--start` 返回，`--wait` 终态里不重复。
   */
  mustReadPruned: Array<{ name: string; detail: string }>;
  /**
   * 单侧进展回调，由工作进程注入以把状态刷进 `status.json`（审查意见 AGY-01）。
   * 同步路径（手工调试）不注入——那条路上没有人在 `--wait`，写了也没人看。
   */
  onSideProgress?: (critic: CriticId, patch: SideProgress) => void;
}

/**
 * plan / bug 原稿相对归档根的登记路径（M10a 第 2 步 EV-55 §3.1.1 域约束）。
 *
 * 抽成纯函数是为了能被单测直接咬住——埋在 `executeRun` 里要真跑一次审查才走得到。
 * 返回 `null` 表示 `subjectPath` 越出归档根（如 `--plan-file doc/…` 这类归档外
 * 文档），调用方据此判定「不登记」，不是把 `null` 当成某种路径值写进去。
 *
 * 排除条件与同仓 `hooks.isOrchestratorOwned` 同形（代码双审 r2 AGY-02 / GLM-06）：
 * 空串是**归档根本身**，不是可登记的工件路径——登记了会让锚② 对一个目录求哈希；
 * 结果为绝对路径（跨盘符等）同样视为域外。
 *
 * **纯词法**：两侧的软链归一化由调用方先做（见 `resolveSubjectArtifactRelPath`）。
 */
export function subjectArtifactRelPath(archiveRoot: string, subjectPath: string): string | null {
  const rel = path.relative(archiveRoot, subjectPath);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * 域判定前先把两侧解到真实路径（代码双审 r2 CODEX-08）。
 *
 * 纯词法比较对软链写法敏感：macOS 的 `/var` → `/private/var`、工程目录本身是软链时，
 * 同一个归档内文件会被判「越出归档根」而**静默失去保护**。解不开（不存在等）就退回
 * 原值——`locateSubject` 已验过存在性，这里失败只可能是竞态，按词法判即可。
 */
export async function resolveSubjectArtifactRelPath(archiveRoot: string, subjectPath: string): Promise<string | null> {
  const real = async (p: string): Promise<string> => fs.realpath(p).catch(() => p);
  return subjectArtifactRelPath(await real(archiveRoot), await real(subjectPath));
}

/**
 * 准备阶段：可用性检查 → 定位被审对象 → 冻结 → 渲染两侧送审包 → 置闸门 running → 写 run.json 骨架。
 *
 * 这一段**不拉起任何 Agent**，因此可以在 `--start` 的同步窗口内完成并秒级返回。
 *
 * 被闸门拦下（上一轮未裁决直接重跑，退 2）时**不写任何审查工件与留痕**——brief、补丁与便利副本、run.json、
 * task.json 登记、运行目录一概不写；闸门状态文件只有那次判负的比较-交换，它也会刷新 `updated_at`，闸门项不变
 * （代码双审 r1 GLM-01）。置闸门（含比较-交换本身）之后的任何失败由本函数回收闸门，
 * 所以对调用方而言「抛错 ⇒ 闸门不归本轮」（EV-109 / EV-145 ①，闸门拦截不留骨架计划 r2 §3.1 / §3.2，r1 CODEX-01）。
 * 写完 run.json 骨架之后才失败的，回收闸门之后再把骨架收尾为 `failed`（`termination.by = prepare_exception`，
 * EV-145，事后收尾余项计划 r2 §3.2）。
 */
/** 分配 run_id 时占到的运行目录（EV-218）：`dir` 只记本次新建的；`landed` 表示已走到落盘段原本建目录的那一步 */
interface RunDirClaim {
  dir: string | null;
  landed: boolean;
}

/**
 * 准备一次审查运行。外层只负责一件事（EV-218）：分配 run_id 时已排他建好了运行目录（`allocateRunId` 的
 * `claimRunDirIn`），而建目录原本推迟在落盘段（GLM-04「零工件」）——落盘段之前的任何失败（原稿缺失、必读与禁读相交、
 * 上一轮未裁决……）都要把这个还空着的目录删掉，被拒时才不在项目外留下运行目录。只删本次新建的（测试开关下接管的
 * 已有目录不删），只用非 recursive 的 `rmdir`（目录里一旦有东西就不删）。落盘段之后的失败照旧由内层处理。
 */
export async function prepareRun(opts: ReviewOptions): Promise<RunContext> {
  const claim: RunDirClaim = { dir: null, landed: false };
  try {
    return await prepareRunClaimed(opts, claim);
  } catch (e) {
    if (claim.dir !== null && !claim.landed) {
      await fs.rmdir(claim.dir).catch((err: NodeJS.ErrnoException) => {
        if (err?.code !== 'ENOENT') warn(`运行目录 ${claim.dir} 是本次占的、还没用上，删不掉（${err?.code ?? err}）——请手工删除这个空目录`);
      });
    }
    throw e;
  }
}

async function prepareRunClaimed(opts: ReviewOptions, claim: RunDirClaim): Promise<RunContext> {
  const { ctx, stage } = opts;
  const cfg: Config = ctx.config;
  const assetRoot = resolveAssetRoot(opts.assetRoot);
  const schemaPath = resolveReviewSchemaPath(assetRoot);
  const lensesPath = path.join(assetRoot, 'lenses.yaml');

  // 经工厂取适配器：TRIVIUM_STUB_CRITIC 在场时换成桩（测试用，生产路径会打醒目告警）
  const adapters = resolveAdapters(realAdapters());
  const adapterCtx: AdapterContext = {
    cfg,
    nodePath: cfg.runtime.node ?? process.execPath,
  };

  // ── 可用性检查：不可用就别开工，避免产生半套工件（AC-16 的精神）──
  /*
   * 入选集合：调用方给了就用它，没给就走同一个判定处取配置默认值。
   *
   * **不再回落到 `CRITICS` 全集**（M7b 第 5 步）——那是 v1 时代「配置不表达选侧」
   * 留下的写法。现在 `review.default_critics` 才是默认值的所在。
   */
  /*
   * 当轮 Driver：本函数里四个消费方（轮次、原稿定位、禁读剪枝、留痕）都用它。
   * `driverEnabled` **就地由注册表派生**，不进 ReviewOptions 也不进交接文件——
   * 它是 id 的属性，不是调用方的选择；让它随参数传递就多了一个能传错的地方。
   *
   * **这里只查表、不校验**（只用于留痕）：未启用为 Driver 的拦截在入口的
   * `resolveDriver`（M10a 第 3 步起退 64），本函数依赖的是「入口已经拦过」。
   */
  const driver: AgentId = opts.driver ?? DEFAULT_DRIVER;
  const driverAgent = agentById(driver);
  const driverEnabled = driverAgent?.driverEnabled ?? false;

  // 回落分支也要传 driver：否则「没给 critics」这条路上 Driver 排除按缺省判，
  // 非缺省 Driver 会被漏放进入选集合（计划双审 r2 CODEX-11）
  const sides: CriticId[] = [...(opts.critics ?? resolveCriticSelection(cfg, { driver }))];
  /*
   * ── slug 校验内嵌于此（审查意见 GLM-01）──
   *
   * 独立的 `preflight` 命令只校验调用方传给它的 --model-* 覆盖值——命令 A 的 S0.6 与 B/C/D 的第 2 步
   * （EV-126 起）会传同一组，但 skill 漏传、或在终端直接跑 `--start` 时它看不到这一步的覆盖值，
   * 而 routeModel 只透传不校验。若不在这里校验，非法 slug 会漏到运行中段才
   * 以业务性失败暴露——白烧配额且 strict 下整次中止。
   * §7.3 承诺的「退 64 并列出可用值」正是在这一处才真正成立。
   *
   * **必须传 `sides`，而且必须排在它解析之后**（r9 双审 AGY-04）。
   * 本调用曾在 `sides` 之前、只传三个参数，于是第四个参数落到缺省集合：
   * `--critics <非默认侧> --model-<该侧> <非法 slug>` 完全不被校验，
   * 而缺省侧的无效配置反过来会拦住一次压根没选它的运行。
   * M8 第 3 步给这个函数加第四个参数时只改了 preflight 那处调用，漏了这里——
   * 而这里才是真正决定烧不烧配额的地方。
   */
  {
    const slug = checkModelSlugs(cfg, stage, opts.modelOverrides, sides);
    if (!slug.ok) throw usageError(`模型 slug 不合法：\n  ${slug.detail}`);
  }
  /*
   * **空集合要在这里就失败**（审查意见 GLM-05）。
   *
   * `??` 只对 null / undefined 回落，不防空数组：直传 `critics: []` 会得到零侧运行，
   * 而下游一路绿灯——可用性检查空转、`decideMode` 对空入选集按「全成功」记 `full`、
   * 闸门按空集校验通过。**一次什么都没审的运行会成功过闸**，这是最坏的一类空真。
   *
   * 生产路径当前不可达（两个 CLI 入口都经 `resolveCriticSelection`，它保证非空；
   * worker 从交接文件拷贝）。但上面那段注释**恰恰邀请手工构造的调用方**省略该字段，
   * 那正是最可能传错的调用方。判定处的非空不变式要延伸到直接传参的路径。
   */
  if (sides.length === 0) {
    throw usageError('入选审核者集合为空：一次审查至少要有一个审核者。');
  }
  /*
   * **Driver 不得在入选集合里**——与上面那条空集合兜底同构、同理由。
   *
   * 判定处（`resolveCriticSelection`）已经拦过一道，但 `opts.critics` 一旦给了值
   * 就**整个绕过判定处**：worker 从交接文件拷贝、测试与 selftest 手工构造，三条都能绕。
   * 「自己审自己」是比空集合更硬的安全不变量（P1：独立二次审查），
   * 判定处的不变式同样要延伸到直传参数的路径。
   *
   * 这里只兜「直传 critics」这一种形态——没给 critics 的回落分支上面已经传了 driver。
   */
  if (sides.includes(driver)) {
    throw usageError(
      `入选审核者里含当轮 Driver「${driver}」：它是本次运行的执笔者，不能同时充当独立审查员。\n` +
        '  自己审自己不构成二次审查——这条流水线存在的理由就是避免它。',
    );
  }
  for (const c of sides) {
    const adapter = adapters[c];
    /*
     * 入选却没有适配器 = 注册表与接线表不一致，属**程序缺陷**而非环境问题。
     * `realAdapters()` 已在取表时挡过一道（`criticEnabled` 却缺接线即抛），
     * 这里是第二道：`--critics` 让入选集合第一次由外部输入决定，
     * 而它校验的是「是否已启用为审核者」，与「是否接了线」不是同一件事。
     */
    if (!adapter) {
      throw new Error(
        `入选审核者 ${c} 没有对应的适配器。\n` +
          '  这说明注册表与 adapters/index.ts 的接线表不一致——属程序缺陷，不是配置问题。',
      );
    }
    const av = adapter.availability(adapterCtx);
    if (!av.ok) throw envError(`${c} 侧不可用：${av.reason}`);
  }
  if (sides.length < 2) {
    /*
     * 中性陈述，**不断言降级**（审查意见 AGY-01 ≡ GLM-01，两侧独立收敛）。
     *
     * 原文案写的是「结果会被标为降级」。M7b 第 3 步之后那是假话：单侧入选且成功时
     * `review_mode` 记 `full`、不写 `degraded_reason`、渲染也不打降级横幅
     * （FR-29 / AC-22：选 1 个审核者是配置意图，不是降级）。照那句话去找降级标记会找不到。
     *
     * 这条漏改本身值得记：改语义时，**凡断言该语义的文案都要一并过一遍**——
     * 文档有 §24 台账看着，而代码里的 warn 文案没有任何对账清单。
     */
    warn(
      `本轮只跑 ${sides.join('/')} 一侧：结论没有交叉验证，不构成多审。` +
        '这是配置意图而非降级，留痕里不会有降级标记——参与者事实见审查文档抬头与 run 元数据的 critics_selected。',
    );
  }
  if (opts.allowSingle) {
    if (cfg.review.allow_partial_flag) {
      warn(
        '已启用 --allow-single：一侧失败时不中止，产出单审结果。' +
          '单审的交叉验证价值远低于双审，结果会在元数据与文档头标为降级（AC-06）。',
      );
    } else {
      warn(
        '配置 review.allow_partial_flag（旧名 allow_single_flag）为 false，' +
          '忽略 --allow-single，仍按 strict 执行。' +
          '这是刻意的：配置层关掉的东西，命令行不该能开回来。',
      );
    }
  }

  /*
   * ── 零工件：先全部算、再统一写（审查意见 GLM-04）──
   *
   * 原先的顺序是「建阶段目录 → 逐侧冻结并**立即**写 brief」，于是
   * locateSubject 抛 65、或第二侧 routeModel 抛 69 时，第一侧的 brief 已经落盘，
   * 留下「目录 + 单侧 brief + 运行目录」的半套工件。
   * review.ts 自己那句「不可用就别开工，避免产生半套工件」的注释因此没有兑现。
   *
   * 现在改为：全部计算在内存里完成，只有都成功了才开始落盘。
   */
  const ref = await resolveTopicReadOnly(ctx, opts.topic, stage);
  /*
   * 轮次也要按当轮 Driver 算（M9 第 5 步补漏——步骤表的落点表没列这一处）。
   *
   * 漏传时它按缺省 Driver 跳过产出：非缺省 Driver 下本轮的 `-claude.md` 审查件
   * 会被当成 Driver 自己的产出跳过，max 偏小。代价不是「元数据与文件名分叉」
   * （`firstFreeRerunIndex` 抬升时会同步改写 `meta.rerun_index`，两者始终一致），
   * 而是骨架运行元数据短暂记错轮次 + 必然触发一次抬升告警。
   */
  const rerunIndex = await resolveRerunIndex(ref.layout, stage, driver);
  /*
   * 分配 run_id 的同时排他占下运行目录（EV-218）：运行目录按仓库分桶、不按主题分，两个主题同一秒起跑会分到同一个 id。
   * 占到的目录记进 claim，落盘段之前失败由外层 `prepareRun` 删掉（守 GLM-04 的零工件）。
   */
  const runId = await allocateRunId(ref.layout, new Date(), RUN_ID_MAX_BUMPS, {
    claimRunDirIn: path.join(runRoot(cfg), repoId(ctx.projectRoot)),
    onRunDirClaimed: (dir, created) => { if (created) claim.dir = dir; },
  });
  if (opts.onRunIdAllocated) await opts.onRunIdAllocated(runId);

  /*
   * ── 被审对象 ──
   *
   * plan / bug 的被审对象是一份现成的 Markdown 原稿；code 没有，它的被审对象是
   * **一段变更**，必须先物化成 `code/_meta/changes.diff`。
   *
   * 补丁在这里算**一次**并透传给逐侧的 freeze：若每侧各自 git diff，两次之间
   * 工作树一有变动，两侧就会审到不同的东西。落盘同样推迟到写入阶段（GLM-04）。
   */
  let subjectPath: string;
  let subjectText: string;
  let pendingDiff: { fileName: string; text: string } | null = null;
  let frozenDiffText: string | null = null;
  let skipVerdict: SkipVerdict | null = null;

  if (stage === 'code') {
    const base = opts.diffBase ?? 'HEAD';
    const excludes = diffExcludePrefixes(
      path.relative(ctx.projectRoot, ctx.archiveRoot) || cfg.archive_root,
    );
    // 敏感文件不进补丁（M17）：它们只该出现在禁读清单里，不该经被审对象本身送出去
    const body = await diffAgainst(ctx.projectRoot, base, excludes, cfg.review.sensitive_globs);
    if (body.trim().length === 0) {
      throw missingArtifactError(
        `\`git diff ${base}\` 为空：没有待审变更。\n` +
          '  代码审的被审对象是一段变更，没有变更就没有可审之物——\n' +
          '  请先完成编码，或用 --base <ref> 指定正确的比较基线。',
      );
    }
    const files = filesInDiff(body);
    frozenDiffText = buildDiffHeader({ runId, base, head: await headSha(ctx.projectRoot), files }) + body;
    subjectText = frozenDiffText;
    /*
     * ── 补丁按轮次命名（审查意见 GLM-01，blocker）──
     *
     * 原先固定叫 `changes.diff`。它既被登进留痕保护集（GLM-r2-05），又走覆盖写，
     * 于是同主题第二次代码审一覆盖，上一轮 run.json 记录的 sha256 就**永远**对不上，
     * `hook-pre-commit` 永久拦截且无法恢复——原文件已被覆盖，谁也拿不回来。
     * 我加的护栏会误伤正常工作，比不加更糟。
     *
     * 带 run_id 之后每一轮的被审对象各自独立、互不覆盖，与两侧审查文档一样受保护。
     */
    subjectPath = path.join(metaDir(ref.layout, stage), diffFileName(runId));
    pendingDiff = { fileName: diffFileName(runId), text: frozenDiffText };

    // FR-23：判定由程序做，不由模型做（§6.4）
    skipVerdict = classifyDiff(cfg, files);
  } else {
    subjectPath = await locateSubject(ref, opts.subjectFile, ctx.projectRoot, driver);
    subjectText = await fs.readFile(subjectPath, 'utf8');
  }
  // 计划定稿校验标记（EV-214）：只在计划阶段写，存在即本轮按 §6.6 规则 9 判；bug 阶段同为文件型被审对象，但不在本规则论域
  const planFinalCheck = stage === 'plan'
    ? { subject_rerun_index: planSubjectRerunIndex(ref.layout, subjectPath, driver) }
    : undefined;

  step(`主题 ${ref.topic} ｜ 阶段 ${stage} ｜ 第 ${rerunIndex} 轮 ｜ run ${runId}`);
  step(`被审对象 ${path.relative(ctx.projectRoot, subjectPath)}`);
  if (stage === 'code' && frozenDiffText) {
    // head 从补丁头部回读，别再传 null——此前摘要里 HEAD 恒显示为「—」
    const headLine = /^# head: (.+)$/m.exec(frozenDiffText);
    step(
      summarizeDiff({
        path: subjectPath, sha256: '', files: filesInDiff(frozenDiffText),
        base: opts.diffBase ?? 'HEAD',
        head: headLine?.[1]?.startsWith('(') ? null : (headLine?.[1] ?? null),
        bytes: Buffer.byteLength(frozenDiffText, 'utf8'),
      }),
    );
  }

  // ── 运行目录（项目外，§10.1 第 ② 道）──
  // 运行目录在分配 run_id 时已排他占下（EV-218）；落盘段照旧 ensureDir 一次，之前失败由外层删掉（GLM-04）
  const runDirBase = path.join(runRoot(cfg), repoId(ctx.projectRoot), runId);

  const lenses = await loadLenses(lensesPath);
  // 阶段专属审查要点。缺文件返回 null，旧版安装不至于跑不起来
  const stagePrompt = await loadStagePrompt(assetRoot, stage);
  // 代码阶段必读本主题计划定稿（EV-210）；其余阶段不找
  const planFinal = stage === 'code'
    ? await resolvePlanFinal(ref, ctx.projectRoot)
    : { path: null, warning: null };
  /*
   * 列入了计划定稿就用计划阶段闸门的同一份判据复核一次（EV-215）：闸门通过之后再写的、没送审的更高轮次计划
   * 会原样成为定稿。只读、从不抛出、不拒跑；没列入时（留痕读不出 / 没有计划阶段）无从复核，与「未列入」告警互斥。
   */
  const planFinalRecheck = planFinal.path
    ? await planFinalRecheckWarning(ref.layout, planFinal.path, driver)
    : null;
  const mustRead = await buildMustReadList(cfg, ctx.projectRoot, ref.topic, opts.contextPaths, planFinal.path);
  const suggestedRead = extractPathReferences(subjectText);
  const excerpt = excerptSubject(subjectText);
  // 两侧共用同一个任务目标：逐侧各解析一次，可能因中途写入而拿到不同结果
  // 第三级的计划定稿：代码阶段复用上面已算好的、不判第二次；bug 阶段走到第三级时才现算（EV-212）；计划阶段不走第三级
  const taskGoal = await resolveTaskGoal(opts, ref, ctx.projectRoot,
    stage === 'code' ? async () => planFinal : () => resolvePlanFinal(ref, ctx.projectRoot));
  // 附录原文同样只算一次、各侧共用；只认本次命令行的显式原文（EV-210）
  const goalAppendix = taskGoalAppendix(stage, opts.taskGoal);
  /*
   * 附录原文单独按 full 模式整份扫密钥（代码双审 GLM-01）。
   *
   * 任务书落盘走 `scan: 'added-lines'`（`scanDiffSecrets`）：它为第 3 段的补丁节选按 hunk 判，见到 `@@ ` 开头的行
   * 就把其后以 `-`、空格、反斜杠开头的行与空行整行移出扫描论域。附录是开发者原文，完全可能有这种行——
   * 修前实测：「`@@ ` 开头行 + 连字符开头行」夹带的凭据形态照常进了任务书。所以附录不能交给那套判据。
   * 放在计算段（置闸门与任何落盘之前）：命中即抛（与归档拒绝同码同文案），零工件、闸门不用回收。
   * 定位标签让行号读作原文的第几行；文案只给打码后的预览，不回显原文。
   */
  if (goalAppendix) assertNoSecrets(goalAppendix, `${ref.topic}/plan 任务目标原文（--goal）`, 'full');

  // ── 冻结 + 送审包（禁读清单逐侧不同：屏蔽的是**对方**的历史产出）──
  const snapshots: Partial<Record<CriticId, Awaited<ReturnType<typeof freeze>>>> = {};
  const requests: Partial<Record<CriticId, CriticRequest>> = {};
  const metaPaths: string[] = [];
  /** 两侧的 brief 先攒在这里，全部算完才落盘（GLM-04） */
  const pendingBriefs: { fileName: string; text: string }[] = [];

  /*
   * ── 三段：冻结 → `--context` 交集校验 → 渲染（EV-02，必读交集校验计划 r2 §2.3）──
   *
   * 校验要等**全部**侧的禁读集都算出来，才能一次点名所有撞上的侧；又必须在置闸门与任何落盘之前，
   * 拒跑才是零工件。于是原先「冻结 → 路由 → 渲染」的单个循环拆成两段，中间夹校验。
   * 次序上的代价：第二侧 `routeModel` 的 69 原先可能先于这里的 64，现在 64 在前——两者都在零工件区。
   */
  for (const critic of sides) {
    const snap = await freeze({
      cfg,
      projectRoot: ctx.projectRoot,
      archiveRoot: ctx.archiveRoot,
      stage,
      critic,
      /*
       * **`topic` 必须传**（代码双审 r1 CODEX-01）。
       *
       * 漏传它，`enumerateDenyPaths` 的主题剪枝就退回**全归档扫描**——
       * 而这正是本文件唯一的 `freeze()` 调用入口，于是那条剪枝在真实流水线上
       * **从未生效过**。本主题 code 阶段实测：禁读集 270 条，**只有 4 条属于本主题**，
       * 其余 266 条是别的主题的历史产出。
       *
       * 后果两重：①注入侧——claude 的 `--settings` 按这个集合逐条生成，
       * 规模放大一个数量级（实测 1620 条规则 / 202,785 字节 / 占 ARG_MAX 的 19.3%）；
       * ②隔离侧——`freeze.ts` 自己写明剪枝的理由是「非 Claude Driver 下，全仓其它主题的
       * `-claude.md` 原稿整批进禁读集，审核者正常读取即 peer_leak 作废重跑」，
       * 那条被点名要防的**误伤面此刻是敞开的**。
       *
       * **这是同一个错误的第二次**：下面 `driver` 字段的注释记的就是第一次
       * （`enumerateDenyPaths` 加了参数而唯一调用入口没跟着加）。那次立的对策
       * 「测试要覆盖调用链，不只是函数」没拦住这一次——所以本次补的是
       * `test/unit/deny-matrix.test.ts` 里一条**扫调用点源码**的用例，
       * 而不是又一条只测被调函数的用例。
       */
      topic: ref.topic,
      /*
       * 这就是上面注释里说的「第一次」：`enumerateDenyPaths` 加了 driver 参数，
       * 而这个唯一调用入口一直没传——M9 第 5 步补上。
       *
       * 漏传时禁读集按缺省 Driver 剪：非 Claude Driver 的原稿会整批进禁读集，
       * 审核者正常读取即判 peer_leak、整次运行作废重跑。
       */
      driver,
      subjectPath,
      ...(opts.diffBase ? { base: opts.diffBase } : {}),
      ...(frozenDiffText !== null ? { diffText: frozenDiffText } : {}),
    });
    // code 阶段 freeze 只能给出占位路径，真实路径在 _meta/ 下，这里回填
    if (stage === 'code') snap.subjectPath = subjectPath;
    snapshots[critic] = snap;
  }

  /*
   * ── `--context` 与禁读集相交 ⇒ 拒跑（退 64）──
   *
   * 判的是用户的**原始写法**，不是 `buildMustReadList` 的产物：后者会静默丢掉绝对路径与 `~/…`（EV-185），
   * 也会按字符串把 `--context CLAUDE.md` 并进公约条目。用户写了它就是要审查员读——丢不丢、并不并，
   * 都不改变「这个请求一面要读、一面禁读」。也不看存在性：指向一个尚不存在的对端审查件路径，同样是写错了。
   */
  const contextConflicts: SideConflicts[] = sides.map((critic) => {
    const denyCtx = denyContextFor(cfg, ctx.projectRoot, critic);
    const denyPaths = snapshots[critic]!.denyPaths;
    return { critic, conflicts: opts.contextPaths.flatMap((c) => findDenyConflicts(c, denyPaths, denyCtx)) };
  });
  if (contextConflicts.some((s) => s.conflicts.length > 0)) {
    throw usageError(renderContextConflicts(opts.contextPaths, contextConflicts));
  }

  /** 从各侧第 4 段剔除的自动条目（这里不可能有 `--context` 的——上一段已经拦下） */
  const pruned: PrunedEntry[] = [];

  for (const critic of sides) {
    const snap = snapshots[critic]!;
    const denyCtx = denyContextFor(cfg, ctx.projectRoot, critic);
    /*
     * 自动条目（公约、关键词、建议核实、己方历史）撞上本侧禁读集 ⇒ 只从**本侧**第 4 段剔除，不拒跑：
     * 用户改不了它们，拒跑等于没有出口。剔除原因不进第 4 段（决策四），进告警与 run.json。
     */
    const keep = <T>(items: readonly T[], pathOf: (t: T) => string, sourceOf: (t: T) => MustReadSource): T[] =>
      items.filter((it) => {
        const conflicts = findDenyConflicts(pathOf(it), snap.denyPaths, denyCtx);
        if (conflicts.length === 0) return true;
        pruned.push({ critic, source: sourceOf(it), entry: pathOf(it), conflicts });
        return false;
      });
    const sideMustRead = keep(mustRead, (e) => e.path, (e) => e.source).map((e) => e.path);
    const sideSuggested = keep(suggestedRead, (p) => p, () => 'suggested');

    const routed = routeModel(cfg, critic, stage, { cli: opts.modelOverrides[critic] ?? null });
    if (!routed.model) {
      throw envError(
        `${critic} 侧没有可用模型：profile「${cfg.active_profile}」未定义 ${stage} 阶段的模型，` +
          `且未通过命令行指定。`,
      );
    }

    // 己方历史同在第 4 段：非 claude Driver 下它会收进禁读集里的旧裁决件（EV-186），同样过剔除
    const ownHistory = keep(
      await listOwnHistory(ref.stageDirAbs, ctx.projectRoot, critic),
      (p) => p,
      () => 'own-history',
    );

    const briefText = renderBrief({
      cfg, critic, stage, topic: ref.topic, runId,
      projectRoot: ctx.projectRoot,
      snapshot: snap,
      promptHint: opts.promptHint,
      subjectExcerpt: excerpt,
      mustRead: sideMustRead, suggestedRead: sideSuggested, ownHistory,
      schemaPath, lenses, stagePrompt,
      taskGoal,
      taskGoalAppendix: goalAppendix,
      minToolCalls: cfg.review.min_tool_calls[stage],
      minProjectReads: cfg.review.min_project_reads[stage],
      /*
       * 第 7 节按该侧能力二选一（EV-95）。取适配器的声明，不按侧名查表、不从 `capability.traceShape` 推导；
       * 入选各侧的适配器在上方可用性检查里已逐个判过非空，`!` 有前置保证。
       */
      commandExecution: adapters[critic]!.commandExecution,
      // 第 7 节点名禁用执行型 MCP 工具（EV-191）：同样取适配器的声明；不声明的侧传空，第 7 节逐字不变
      mcpExecPrefixes: adapters[critic]!.mcpExecPrefixes ?? [],
    });

    // 先不落盘：brief 暂存内存，等两侧都算完再统一写（GLM-04）
    const briefFile = `brief-${critic}-${runId}.md`;
    const briefAbs = path.join(metaDir(ref.layout, stage), briefFile);
    pendingBriefs.push({ fileName: briefFile, text: briefText });

    requests[critic] = {
      run_id: runId, topic: ref.topic, stage, critic,
      project_root: ctx.projectRoot,
      subject_path: subjectPath,
      deny_paths: snap.denyPaths,
      out_dir: path.join(runDirBase, critic, 'out'),
      brief_path: briefAbs,
      brief_text: briefText,
      model: routed.model,
      effort: effortFor(cfg, critic, stage),
      timeout_s: cfg.review.timeout_s[stage],
      schema_path: schemaPath,
      min_tool_calls: cfg.review.min_tool_calls[stage],
      min_project_reads: cfg.review.min_project_reads[stage],
      profile_requested: vendorProfileOf(cfg, critic),
    };
  }

  const primarySnap = snapshots[sides[0]!]!;
  /** 全量进 run.json；播报通道（`--start` / 同步路径）用封顶后的那份（代码双审 CODEX-06） */
  /*
   * 计划定稿的告警——没能列入（EV-210）或没通过复核（EV-215），两者互斥、合起来至多一条——排在剔除告警之前，
   * 不受剔除封顶影响（`composeMustReadWarnings`）；走同样三个出口：`--start` 的 warnings、同步路径的 warnings、
   * run.json 的 gate.warnings（代码阶段 `gate --check` 以 run_warning 回灌）。
   */
  const planFinalWarnings = [planFinal.warning, planFinalRecheck].filter((w): w is { name: string; detail: string } => w !== null);
  const { all: mustReadPrunedAll, display: mustReadPruned } = composeMustReadWarnings(planFinalWarnings, pruned, sides);

  /*
   * ── 闸门在第一次落盘之前置 running（EV-109 / EV-145 ①，闸门拦截不留骨架计划 r2 §3.1）──
   *
   * 闸门状态必须写进 state.json，不能只写进 run.json：四个 Hook 都是读 `state.json` 判定的（listOpenGates）。
   * 原先 review 只在 run.json 里记 `gate.state`，state.json 压根没被创建，于是
   * `hook-pre-write`（审查期禁写）、`hook-pre-commit`（裁决未齐备禁提交）、
   * `hook-stop`（裁决未齐备禁收工）**三个 Hook 全部无事可判、一律退 0**。
   * 那是整条流水线最核心的护栏（AC-02 / AC-12 / §8.5），实测确认过是静默失效的。
   *
   * 置 running 前先确认槽位不是**别的 run** 的待裁决状态（审查意见 GLM-r2-01 ③）。
   * `state.json` 每个 <主题>/<阶段> 只有一个槽位。旧一轮审完未裁决就直接重跑，
   * 无条件覆盖会把待裁决状态无声抹掉，而 `gate --check` 只校验最新轮——
   * 旧那一轮从此既逃过裁决、也不再拦提交。
   *
   * **位置**：在 skipVerdict 之后（跳过轮不置闸门），在第一次落盘之前。此前它排在落盘段之后，
   * 被拦时已写下 brief、补丁与便利副本 `changes.diff`、run.json 骨架、task.json 登记与运行目录（EV-109）；
   * 那份骨架又被 `latestRunMeta` 当成最新留痕，不带 --run-id 的 gate 随之指向一轮从未开跑的运行，
   * 被拦文案给的出路「补齐裁决件并通过 gate --check」走不通。比较-交换是唯一判定点，
   * 不另加只读预查：两处判定同一个状态集合，将来改一处漏一处（计划 r2 D1）。
   *
   * **比较-交换本身也在 try 里**（代码双审 r1 CODEX-01）：它经 `withGlobalLock` 写盘，写盘之后放锁若抛错，
   * 闸门已是本轮的 running 而异常绕过回收；并入 try 后由下面的 catch 一并回收。被拦时抛的 GATE_BLOCK
   * 同样进 catch，回收按 `expect: { state: ['running'], runId: 本轮 }` 比较——槽位是别的 run 的待裁决状态，
   * 什么都不改，报错原样抛出。
   */
  const holdsGate = !skipVerdict?.skipped;
  const taskLock: TaskLock = { triviumDir: ctx.triviumDir, heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000 };
  /** 骨架已写成：之后的失败要把它收尾为 failed；之前的失败没有 run.json 可收（EV-145，事后收尾余项计划 r2 §3.2） */
  let skeletonWritten = false;
  try {
    if (holdsGate) {
      const g = await setGateChecked({
        triviumDir: ctx.triviumDir,
        topic: ref.topic, stage,
        state: 'running',
        runId, rerunIndex,
        sessionId: opts.sessionId ?? null,
        heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
        expect: { state: ['idle', 'running', 'approved', 'rejected', 'abandoned'] },
      });
      if (!g.applied) {
        throw new TriviumError(
          EXIT.GATE_BLOCK,
          `上一轮（run ${g.entry?.run_id ?? '未知'}，第 ${g.entry?.rerun_index ?? '?'} 轮）的审查意见尚未裁决，不能直接重跑。\n` +
            `  ${g.skipped ?? ''}\n` +
            `  补齐裁决件并通过 \`trivium gate --stage ${stage} --topic ${shellQuoteArg(ref.topic)} --check\` 后再来，\n` +
            `  或用 \`trivium abandon --topic ${shellQuoteArg(ref.topic)} --stage ${stage}\` 显式作废那一轮（工件保留）。`,
        );
      }
    }

    /*
     * ── 到这里为止**不写任何审查工件与留痕**（brief、补丁与便利副本、run.json、task.json 登记、运行目录里的文件；
     * 运行目录本身在分配 run_id 时已排他占下、还是空的，这之前失败由外层 `prepareRun` 删掉，EV-218）；
     * 闸门状态文件只多了上面那次比较-交换（判负时也会刷新 `updated_at`，闸门项不变——代码双审 r1 GLM-01）。
     * 闸门已归本轮（跳过轮除外），从这里开始才落盘。──
     * 顺序：重置收工阻断计数 → 建阶段目录 → 写补丁与 brief → 建运行目录 → 写 run.json → 登记
     *
     * 置闸门之后的任何失败都由这里回收闸门，调用方的契约「prepareRun 抛错 ⇒ 闸门不归本轮」因此不变：
     * `startRun` 的 prepare catch 只放锁、同步路径的 prepareRun 在 executeRun 的 try 之外（计划 r2 §3.2）。
     * 写完骨架之后才失败（登记、任务目标落盘）时，回收闸门之后再把骨架收尾为 failed（事后收尾余项计划 r2 §3.2；
     * 闸门拦截不留骨架计划 r2 D3 当时只回收闸门、骨架留 running，留给 EV-145 余项）。
     */
    // 新一轮开始，上一轮的收工阻断计数作废（否则跨轮累积后首次 Stop 就超限放行）。
    // 它会抛（目录里有删不掉的东西），所以放在 try 里，抛了也经下面的回收（计划 r2 §3.1，r1 AGY-02 ≡ GLM-02）
    if (holdsGate) {
      const { resetStopBlockCount } = await import('./lock.js');
      await resetStopBlockCount(ctx.triviumDir, ref.topic, stage);
    }
    await ensureDir(ref.stageDirAbs);
    /*
     * `_meta/` 里的被审补丁与两份 brief 也要进 `run.json.artifacts`（审查意见 GLM-r2-05）。
     *
     * 原先保护集只有两份渲染后的审查文档，于是「审查文档删不掉也改不掉」，
     * 但「**审的是什么**」既不受核对保护、又在重跑时被同名覆盖——
     * hook 文案承诺的范围与实现不符。
     */
    const metaArtifacts: { path: string; sha256: string }[] = [];
    // 补丁先写：两侧 brief 都引用它的路径，落盘顺序上它该在前
    if (pendingDiff) {
      /*
       * 补丁按**新增行**扫密钥（`scanDiffSecrets` 的文件头写了理由）：删除行与上下文行的内容
       * 已经在 HEAD 里，扫它们只会让路过密钥夹具的改动送不进审查、让删除凭据的提交过不了检查。
       */
      const w = await writeMeta(ref.layout, stage, pendingDiff.fileName, pendingDiff.text, { scan: 'added-lines' });
      metaPaths.push(w.absPath);
      metaArtifacts.push({ path: w.relPath, sha256: w.sha256 });
      /*
       * 另留一份 `changes.diff` 便于人读（`.reviews/README.md` 记载的就是这个名字）。
       * 它**不进保护集**：它只是指向最新一轮的便利副本，会被下一轮覆盖，
       * 受保护的是上面那份带 run_id 的。补丁头部自带 run_id，不会认错是哪一轮。
       */
      const alias = await writeMeta(ref.layout, stage, 'changes.diff', pendingDiff.text, { scan: 'added-lines' });
      metaPaths.push(alias.absPath);
    }
    for (const b of pendingBriefs) {
      /*
       * BRIEF 把补丁节选逐字嵌在散文中间，所以同样按 hunk 分档扫（散文整份扫、hunk 内只看新增行）。
       * 少了这一条，放宽只是把拒绝点从补丁搬到 BRIEF——报错还指向一个开发者没亲手写过的文件，
       * 而且此时补丁已经落盘，留下半套 `_meta` 工件（代码双审 r2 CODEX-07）。
       */
      const w = await writeMeta(ref.layout, stage, b.fileName, b.text, { scan: 'added-lines' });
      metaPaths.push(w.absPath);
      metaArtifacts.push({ path: w.relPath, sha256: w.sha256 });
    }
    await ensureDir(runDirBase);
    claim.landed = true;

    // ── run.json 骨架（status: running），崩溃后也能取证 ──
    const meta = newRunMeta({
      runId, topic: ref.topic, stage, rerunIndex,
      command: opts.command,
      promptHint: opts.promptHint,
      taskGoal,
      entry: opts.entry ?? null,
      /*
       * 入选集合就是 `sides`——`--only` 收窄后的那一份，不是当前启用的全集。
       * 两者分开记，`gate` 才能把「入选但失败」与「压根没入选」判成两回事（§6.7.1）。
       */
      criticsSelected: sides,
      /*
       * 发起方与它的启用状态一起落盘（M9 第 5 步）。
       *
       * `driver_enabled: false` 是 M9 刻意接受的形态：那时只校验「已登记」，
       * 不校验 `driverEnabled`（校验了 M9 第 6 步就跑不成），放行的代价由留痕兜住。
       * M10a 第 3 步起入口的 `resolveDriver` 对未启用者退 64，新运行这里恒为 true；
       * 历史归档里的 false 仍是合法留痕。
       */
      driver,
      driverEnabled,
      /*
       * 有效护栏等级（M10b 第 3 步 B1）：登记为 L1 而 Hook 配置当前不在场即记 L2。
       * 在这里取，而不是信预检那一次：预检与 `--start` 之间配置可能被改，留痕要记的是**本次运行时**的事实。
       */
      ...(driverAgent ? { driverGuardLevel: (await effectiveGuardLevel(ctx.projectRoot, driverAgent)).level } : {}),
      ...(planFinalCheck ? { planFinalCheck } : {}),
      treeHash: primarySnap.treeHash,
      gitHead: primarySnap.gitHead,
      dirty: primarySnap.dirty,
      subjectSha256: primarySnap.subjectSha256,
      denyPaths: primarySnap.denyPaths,
      build: embeddedBuildStamp(),
      driftPolicy: cfg.review.on_drift,
    });
    meta.artifacts = [...metaArtifacts];

    // FR-23：跳过也要留痕，且必须写明命中的规则供人复核（§6.4）
    if (skipVerdict?.skipped) {
      meta.skipped = true;
      meta.skip_reason = skipVerdict.reasons.join('；');
    }
    if (mustReadPrunedAll.length > 0) {
      /*
       * 剔除要留痕（EV-02，计划双审 r1 CODEX-01）：`_meta/brief-*.md` 落盘的是剔除**后**的版本，
       * 不记这一笔，事后看不出第 4 段少过什么。`gate.warnings` 是现成字段，`gate --check` 回灌为
       * `run_warning`——只告警、不阻断。存全量（播报通道才封顶，见 `capPrunedWarnings`）。
       *
       * **跳过轮同样记**（代码双审 CODEX-03）：落盘段对 brief 是无条件写的，跳过轮的归档里同样有一份
       * 剔除后的任务书；「没有审查员会被拉起」只解释得了不播报（`--start` 的 `finished_inline` 与
       * 同步路径的跳过分支都不带它），解释不了不留痕。
       */
      meta.gate.warnings = [...(meta.gate.warnings ?? []), ...mustReadPrunedAll.map((w) => plainWarningText(w.detail))];
    }
    await writeRunMeta(ref.layout, stage, meta);
    skeletonWritten = true;
    await registerRun(ref.layout, meta, taskLock);

    /*
     * 任务目标落进 task.json，供本主题后续阶段复用——但**只落显式传入的那一个**。
     *
     * 从计划定稿推导出来的值不写回：它是个尽力而为的猜测（一个标题而已），
     * 一旦持久化就会永久占位，把日后真正传进来的 `--goal` 挡在门外——
     * 上面那条「已有则不覆盖」的规则会站在错误的一边。推导每次现算即可，成本几乎为零。
     *
     * 同理只在首次落：`/dual-run <任务目标>` 说的那句话是主题存在的理由，
     * 后续各阶段带着各自的 --focus 跑，不该把它一次次冲刷掉。
     */
    if (clampGoal(opts.taskGoal)) {
      const { updateTask } = await import('./meta.js');
      await updateTask(ref.layout, (t) => {
        if (!t.goal) t.goal = taskGoal;
      }, taskLock);
    }

    return {
      opts, cfg, ctx, stage, ref, adapterCtx, adapters, sides,
      runId, rerunIndex, subjectPath, runDirBase,
      requests, snapshots, primarySnap, metaPaths, meta,
      pendingDiff, skipVerdict, mustReadPruned,
    };
  } catch (e) {
    // 比较-交换起的任何失败：闸门由本函数回收（只回收仍记着本 runId 且仍是 running 的——被拦时槽位是别的 run，不动）
    if (holdsGate) {
      await releaseRunningGateEntry({
        triviumDir: ctx.triviumDir, topic: ref.topic, stage, runId,
        heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
      });
    }
    /*
     * 写完骨架之后才失败（登记、任务目标落盘）：把骨架收尾为 failed（EV-145，事后收尾余项计划 r2 §3.2）。
     *
     * - 写者就是本进程：还没派生任何 worker；`--cancel` / `--wait` 靠 status.json 或交接文件拿身份，此刻两份都不存在（计划 r2 §3.5）。
     * - 排在闸门回收**之后**，与 `--cancel` / `--wait` / worker 那三条相反：这里没有 status.json、没有补齐入口，
     *   收尾只有这一次机会，进程若死在两步之间，宁可 run.json 留痕不准，也不让闸门停在 running 拦住全部业务写入到 TTL。
     * - 骨架之前的失败（重置计数、补丁 / brief 的密钥扫描、骨架自己的写前校验）没有 run.json 可收，不调——调了只多一行「归档里没有」。
     * - 主题锁由调用方在本函数抛出之后放（`startRun` 的 prepare catch、同步路径 `runReview` 的 finally）。
     */
    if (skeletonWritten) {
      const fin = await finalizeFailedRunMeta({
        layout: ref.layout, stage, runId, lock: taskLock,
        workerGone: true,
        termination: { by: 'prepare_exception', exit_code: exitCodeOf(e) },
      });
      for (const line of finalizeLines(fin, runId, '准备阶段失败')) warn(line);
    }
    throw e;
  }
}

/**
 * 执行阶段：并行拉起两侧 → 复算快照 → 解析 → guard 判定 → 齐备后同时落盘 → 收尾。
 *
 * 同步路径直接调用它；`--start` 派生的工作进程也调用它（先从 `request.json` 重建上下文）。
 */
export async function executeRun(rc: RunContext): Promise<ReviewOutcome> {
  const {
    opts, cfg, ctx, stage, ref, adapterCtx, adapters, sides,
    runId, rerunIndex, subjectPath, requests, primarySnap, metaPaths, meta, skipVerdict,
  } = rc;

  /*
   * ── FR-23：纯文档变更跳过代码审（§6.4）──
   *
   * 一个 Agent 都不拉起，也**不生成任何审查文档**。伪造两份「无问题」的结论
   * 会让 gate --check-artifacts 以为这一轮审过了，那比不审更危险（P5）。
   */
  if (skipVerdict?.skipped) {
    meta.status = 'success';
    meta.finished_at = new Date().toISOString();
    meta.gate.state = 'skipped_doc_only';
    meta.gate.adjudication_complete = true; // 没有意见可裁决
    await writeRunMeta(ref.layout, stage, meta);
    await registerRun(ref.layout, meta, { triviumDir: ctx.triviumDir, heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000 });
    // 跳过等于这一轮没有待裁决的意见，闸门直接回 idle——但只回收属于本 run 的那个
    await setGateChecked({
      triviumDir: ctx.triviumDir, topic: ref.topic, stage, state: 'idle',
      runId, rerunIndex, sessionId: opts.sessionId ?? null,
      heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
      expect: { runId },
    });

    const notice = renderSkipNotice(skipVerdict);
    say('');
    say(notice);
    return {
      runId, rerunIndex, artifacts: [], metaPaths,
      warnings: [notice], exitCode: EXIT.OK,
      sideStatuses: {},
    };
  }
  // ── 并行拉起两侧 ──
  const startedAt = new Date().toISOString();
  say(`开始双审：${sides.map((c) => `${c}(${requests[c]!.model})`).join(' ‖ ')}，单侧上限 ${cfg.review.timeout_s[stage]}s`);

  /** 重试时追加进 BRIEF 的提示。归档里的 brief-* 是第一次那份，追加内容也要留痕，否则审计材料与实际送审不符 */
  const retryHints: Partial<Record<CriticId, string[]>> = {};
  const { results, attempts } = await runBothSides({
    ctx: adapterCtx,
    adapters,
    requests,
    maxTransientRetries: cfg.review.retry.transient_max,
    onRetryBrief: (critic, prev) => {
      const hint = buildRetryHint(critic, prev);
      (retryHints[critic] ??= []).push(hint);
      return hint;
    },
    // 等待期的逐侧进展回写。只有工作进程会传它；同步路径不传，行为不变（AGY-01）
    onSideProgress: rc.onSideProgress,
  });
  const finishedAt = new Date().toISOString();

  // ── 复算快照，判漂移 ──
  // 与送审冻结同一份排除（EV-221）：归档根、.trivium/、.git 不进 tree；code 阶段重取补丁也用它
  const ownExcludes = diffExcludePrefixes(path.relative(ctx.projectRoot, ctx.archiveRoot) || cfg.archive_root);
  const afterTreeHash = await workTreeHash(ctx.projectRoot, { exclude: ownExcludes });
  /*
   * 被审对象的复算必须**重新取一次**，不能重读冻结文件。
   *
   * plan / bug 的被审对象是工作树里的原稿，`sha256File` 重读就是复算。
   * code 的被审对象是「相对 base 的变更」，冻结件 `_meta/changes-<run_id>.diff` 只是它的
   * 快照——重读快照永远等于快照自己，`subject_drift` 在 code 阶段就从未触发过：
   * 审查期间改了被审代码，run.json 照样写 drift: false（设计 §9.2 第 2 步失效）。
   * 现在头部逐字复用、正文此刻重新 `git diff <base>`，与冻结值比对。
   */
  let afterSubjectSha: string;
  let diffFiles: string[] = [];
  if (stage === 'code') {
    const frozen = parseFrozenDiff(await fs.readFile(subjectPath, 'utf8'));
    diffFiles = frozen.files;
    const nowBody = await diffAgainst(ctx.projectRoot, frozen.base ?? opts.diffBase ?? 'HEAD', ownExcludes, cfg.review.sensitive_globs);
    afterSubjectSha = sha256(frozen.header + nowBody);
  } else {
    afterSubjectSha = await sha256File(subjectPath);
  }

  // ── 解析 ──
  const reviews: Partial<Record<CriticId, Review | null>> = {};
  const fallbackText: Partial<Record<CriticId, string>> = {};
  /** 逐条降级的意见（根合法、这一条不合 schema）。只在解析成功的侧有键，无降级即 [] */
  const degraded: Partial<Record<CriticId, DegradedFinding[]>> = {};
  /** 所选候选在校验前做过的无损修复。只在解析成功的侧有键 */
  const repairs: Partial<Record<CriticId, ParseRepairs>> = {};
  /** 整份回退的成因。只在 parse_fallback 侧有键 */
  const fallbackCause: Partial<Record<CriticId, FallbackCause>> = {};
  for (const c of sides) {
    const r = results[c];
    if (!r || r.status !== 'ok' || !r.raw_response_text) {
      reviews[c] = null;
      continue;
    }
    const p = parseReview(r.raw_response_text);
    /*
     * 形状过了之后**立刻**验编号前缀归属，不合即按解析失败处置（审查意见 AGY-01 ≡ GLM-02）。
     *
     * ## 为什么这一步必须在这里、而且必须是阻断的
     *
     * M7b 第 6 步把 `review.v1.json` 的 `findings[].id` pattern 由 `^(AGY|GLM)-`
     * 放开成只校形状，身份交给注册表判定。方向是对的（schema 不该是第二事实源），
     * 但**我当时只比较了两道检查的判定语义，没比较它们的执行后果**：
     *
     *   · 放开前：非法前缀被 ajv 拒 → 整份候选作废 → 走下面的 fallback → 由
     *     `enumerateFallbackFindings` 用**本侧合法前缀**重新编号 → 可裁决。**硬失败。**
     *   · 放开后：非法前缀是 schema 合法的结构化结论，`checkReviewIntegrity` 的
     *     `prefixOk` 只进 `guard` 的告警文本——不改 status、不进 run.json、
     *     不进审查文档、`gate` 也不复核。**等于没有后盾。**
     *
     * 两条下游后果都实际可达：
     *   ① **死锁**——未登记前缀（`FOO-01`）照常进裁决差集，而 `disposition.ts`
     *      的收行正则只认已登记前缀，那一行永远收不进去；`gate --check` 报的是
     *      误导性的「缺裁决」，Driver 怎么填都过不去。
     *   ② **冒名**——某侧产出另一侧的前缀（gemini 出 `GLM-01`），`gate` 的 Set
     *      去重把它与对侧合并，裁决一次即过闸，跨侧意见静默碰撞。
     *
     * 另有第三条：这份 schema 同时是 `agy --json-schema` 的**生成约束**，放开后
     * 受限解码允许模型产出任意大写前缀，而 schema 错误重试通道不再能纠正它。
     *
     * 所以这里不是「再加一道保险」，而是**把被撤走的那道后盾接回等价位置**。
     * 撤掉一道防线时要问的是「被撤的那道产生什么后果、留下的那道产生什么后果」，
     * 两者不相等就不是等价替换——这条纪律是本轮双审换来的。
     *
     * **只拦前缀归属**：重复编号与 evidence-consulted 两项在改动前就只是告警，
     * 未因本次改动变化，不在此处顺手收严（那属独立取舍，要单独论证）。
     *
     * **逐条降级的编号同样过这道**（解析回退逐条降级计划 r2 §3.3）：降级意见照样按原编号进裁决期望集，
     * 冒名 / 死锁两条后果对它一样成立，所以异前缀的降级编号也让整份回退，成因记 `foreign_prefix`。
     */
    const integrity = p.ok ? checkReviewIntegrity(p.review, c, p.degraded) : null;
    if (p.ok && integrity!.prefixOk) {
      reviews[c] = p.review;
      degraded[c] = p.degraded;
      repairs[c] = p.repairs;
      if (p.degraded.length > 0) {
        warn(
          `${c} 侧有 ${p.degraded.length} 条意见不合 trivium.review.v1，逐条降级（仍须逐条裁决，不参与阻断）：` +
            p.degraded.map((d) => `${d.id}[${d.problems.map((x) => `${x.field}:${x.kind}`).join(',')}]`).join('、'),
        );
      }
    } else {
      const cause: FallbackCause = p.ok ? 'foreign_prefix' : p.cause;
      const reason = p.ok
        ? `编号前缀不属于本侧（应为 ${CRITIC_PREFIX[c]}-）：${integrity!.badIds.join(', ')}`
        : `${p.reason}${p.errors.length > 0 ? `：${p.errors.slice(0, 5).join('; ')}` : ''}`;
      reviews[c] = null;
      fallbackText[c] = r.raw_response_text;
      fallbackCause[c] = cause;
      r.status = 'parse_fallback';
      r.fail_reason = `[${cause}] ${reason}`;
      warn(`${c} 侧输出未能结构化解析，转 parse_fallback（${FALLBACK_CAUSE_LABEL[cause]}）：${reason}`);
    }
  }

  // ── guard 判定 ──
  const verdict = await judgeRun({
    cfg,
    projectRoot: ctx.projectRoot,
    archiveRootAbs: ctx.archiveRoot,
    archiveRootRel: path.relative(ctx.projectRoot, ctx.archiveRoot) || cfg.archive_root,
    triviumDirRel: path.relative(ctx.projectRoot, ctx.triviumDir) || '.trivium',
    before: primarySnap,
    afterTreeHash,
    afterSubjectSha256: afterSubjectSha,
    // 「相关」= --context 指明的路径 **与 diff 涉及文件**（设计 §9.2 第 3.c 步，freeze.ts 注释同）
    relatedPaths: [...opts.contextPaths, ...diffFiles],
    results, reviews, requests,
    degraded: Object.fromEntries(sides.map((c) => [c, degraded[c] ?? []])),
    /*
     * 逐侧能力声明从适配器表取——**这是它唯一的起源**，`judgeRun` 自己拿不到。
     * 漏传会让 `command-trace` 侧按结构化轨迹判定，证据恒不达标（响亮失败），
     * 不会静默放行；但那种失败的原因与现象离得很远，所以这一行不能省。
     */
    capabilities: Object.fromEntries(
      sides.flatMap((c) => {
        const cap = adapters[c]?.capability;
        return cap ? [[c, cap] as const] : [];
      }),
    ),
  });

  /*
   * 失败策略：配置给默认值，`--allow-single` 只在 allow_partial_flag 允许时才能覆盖。
   * 若配置关掉了开关而命令行仍传了它，照 strict 执行——已在 prepareRun 里告警过。
   */
  const effectivePolicy: 'strict' | 'degrade' =
    opts.allowSingle && cfg.review.allow_partial_flag ? 'degrade' : cfg.review.failure_policy;
  const mode = decideMode(results, effectivePolicy, sides);
  /*
   * 准备阶段的必读剔除告警排在 guard 告警之前（EV-02，计划双审 r1 AGY-01）：同步路径的人读输出
   * 只靠本函数末尾的 `warn` 循环，CLI 人读模式不打印 `ReviewOutcome.warnings`——并入晚了就没人看见。
   * 工作进程重建的上下文里它是 `[]`（已随 `--start` 返回），这里不会重复。
   */
  const warnings = [...rc.mustReadPruned.map((w) => plainWarningText(w.detail)), ...renderGuardWarnings(verdict)];
  /*
   * 凭据副本抹除失败要进 warnings（EV-20）：它随 `ReviewOutcome.warnings` 落进
   * `status.json.message`，`--wait` 的终态返回会原样透出——哨兵在无人读的目录里，
   * 光写哨兵等于换个方式静默（计划双审 CODEX-10 ≡ AGY-06）。不改变 exitCode。
   */
  for (const c of sides) {
    const s = results[c]?.scrub;
    if (s && !s.ok) warnings.push(`${c} 侧凭据副本抹除失败：${s.errors[0] ?? '原因未记录'}（下次会话启动会重试）`);
  }

  // ── 两侧齐备后同时落盘（§10.1 第 ② 道）──
  /*
   * 先定一个两侧**共用**的轮次。`writeArtifact` 命中已存在时逐侧独立抬升，
   * 会分叉成 -r2-gemini.md 配 -r3-glm.md（archive.ts 头注释的不变式被打破），
   * `gate --check-artifacts` 与 report 按单一轮次找就对不上。正常情况下等于
   * prepareRun 算出的 rerunIndex；只有目录在运行期间被塞了同名文件才会抬升。
   */
  const sharedIndex = await firstFreeRerunIndex(ref.layout, stage, sides, rerunIndex);
  if (sharedIndex !== rerunIndex) {
    warn(`第 ${rerunIndex} 轮的审查文档名已被占用，两侧一并抬升到第 ${sharedIndex} 轮`);
    meta.rerun_index = sharedIndex;
  }
  const artifacts: string[] = [];
  /**
   * 审查文档写入时的 sha256，收尾登记直接用它（代码双审 r3 CODEX-04）。
   * 与 `protectedMeta`、原稿登记、verify 记录同口径：不在收尾时重新读盘——
   * 落盘到收尾之间若有改写，重算会把改写版锁成基线；登记写入值则在下次提交时判 modified。
   */
  const artifactSha = new Map<string, string>();
  /*
   * 结构化结论、失败记录与 fallback 单元也进 `run.json.artifacts` 保护集。
   * `review-<c>-<runId>.json` 是 `gate --check` **唯一**的事实来源：不受保护时，
   * 把它改成 `findings: []` 就能让空裁决表过闸，且提交时无人核对。
   */
  const protectedMeta: { path: string; sha256: string }[] = [];
  /*
   * 共同阻断这一档的**运行期事实**，渲染与 `run.json` 共用同一份计算
   * （分成两处算过一次，两边的分母就漂了——见下面落盘处的说明）。
   */
  const jointCheckRun = jointCheckRunState(sides, verdict, reviews);
  for (const c of sides) {
    const hints = retryHints[c];
    if (hints && hints.length > 0) {
      const w = await writeMeta(
        ref.layout, stage, `brief-${c}-${runId}.retry.md`,
        `# ${c} 侧重试时追加进 BRIEF 的内容（共 ${hints.length} 次）\n\n` +
          hints.map((h, i) => `## 第 ${i + 2} 次尝试追加\n\n${h}\n`).join('\n'),
      );
      metaPaths.push(w.absPath);
      protectedMeta.push({ path: w.relPath, sha256: w.sha256 });
    }
    const r = results[c];
    if (!r) continue;
    // 失败侧不产出审查文档，改在 _meta/ 记 failed.json——绝不改名冒充对方（AC-06）
    if (r.status === 'failed' || r.status === 'timeout') {
      const w = await writeMeta(
        ref.layout, stage, `review-${c}-${runId}.failed.json`,
        JSON.stringify({ critic: c, status: r.status, fail_reason: r.fail_reason, attempts: attempts[c] }, null, 2) + '\n',
      );
      metaPaths.push(w.absPath);
      protectedMeta.push({ path: w.relPath, sha256: w.sha256 });
      continue;
    }

    const side = verdict.sides[c];
    const doc = renderReviewDoc({
      critic: c, stage, topic: ref.topic, runId, rerunIndex: sharedIndex,
      review: reviews[c] ?? null,
      rawText: fallbackText[c] ?? null,
      degradedFindings: degraded[c] ?? [],
      ...(repairs[c] ? { parseRepairs: repairs[c] } : {}),
      ...(fallbackCause[c] ? { parseFallbackCause: fallbackCause[c] } : {}),
      result: r,
      modelRequested: requests[c]!.model,
      effort: requests[c]!.effort ?? null,
      snapshotHash: `sha256:${primarySnap.subjectSha256}`,
      startedAt, finishedAt,
      evidenceOk: side?.evidenceOk ?? false,
      projectReads: side?.projectReads ?? 0,
      selectedCritics: mode.selectedSides,
      // 用真实判定，不再从 mode 反推——mode 只说完成度，不说参与者基数（runner.ts ModeDecision）
      degraded: mode.degraded,
      drift: verdict.drift.kind !== 'none',
      // 比不了（EV-139）：旗标换成「漂移无法判定」，front-matter 仍只写 drift: true
      ...(verdict.drift.kind === 'unknown'
        ? { driftUnknown: { cause: verdict.drift.cause, detail: verdict.drift.detail } }
        : {}),
      peerDeny: r.peer_deny_applied,
      /*
       * 禁读核验结论——与上面的 `peerDeny` **正交**，两者都要传。
       * 后者说「路径级 deny 这个机制有没有生效」，本字段说「这一侧实际碰没碰禁读面」。
       * 只传前者的话，一份命中了对端产物的审查在文档上看不出任何异样。
       */
      ...(side ? { peerLeak: peerLeakOf(side) } : {}),
      consultedUnverified: side?.consultedUnverified ?? true,
      ...(side
        ? {
            verification: {
              readonly: side.verification.readonly,
              path: side.verification.path,
              ...(side.verification.pathCause ? { pathCause: side.verification.pathCause } : {}),
              ...(side.verification.untrusted ? { untrusted: side.verification.untrusted } : {}),
            },
          }
        : {}),
      /*
       * 本轮共同阻断这一档做不做得成——上一轮承诺补进 front-matter、没补。
       * 裁决者读的是这份单侧文档，「有效侧不足、这一档没做」直接决定他还剩几层防线。
       */
      jointCheck: jointCheckRun,
      heterogeneous: isHeterogeneous(r.model_effective ?? requests[c]!.model, agentById(meta.driver)!.vendor),
      overrideReason: overrideReasonFor(
        c, r.model_effective ?? requests[c]!.model, opts.modelOverrides, r.profile_requested, meta.driver,
      ),
    });

    const written = await writeArtifact({
      layout: ref.layout, stage, role: c, writer: c,
      rerunIndex: sharedIndex, content: doc,
    });
    if (written.effectiveRerunIndex !== sharedIndex) {
      // 预扫描之后仍撞名：只可能是运行期间有人往目录里塞文件。两侧已经不共用 N，如实告警
      warn(`${c} 侧审查文档落到了第 ${written.effectiveRerunIndex} 轮（预定第 ${sharedIndex} 轮），两侧轮次不一致，请人工核对`);
    }
    artifacts.push(written.absPath);
    artifactSha.set(written.absPath, written.sha256);

    // 结构化原文进 _meta/，供 gate 机读与追溯
    const rj = await writeMeta(
      ref.layout, stage, `review-${c}-${runId}.json`,
      JSON.stringify(reviews[c] ?? { parse_fallback: true, raw: fallbackText[c] ?? null }, null, 2) + '\n',
    );
    metaPaths.push(rj.absPath);
    protectedMeta.push({ path: rj.relPath, sha256: rj.sha256 });

    /*
     * 逐条降级的意见另存旁路文件（解析回退逐条降级计划 r2 §3.3）。
     *
     * 上面那份 `review-<侧>-<run>.json` 保持**纯 review.v1**（只含合格意见）：它是 gate 的事实来源、
     * 也是 schema 合法的审查结论，混入不合格对象会打破这两点。裁决期望集取自 run.json 的
     * `findings_degraded`（只写一次、在提交锚保护下）；这份文件原样保留审查员给的对象，供渲染与追溯，
     * 同样进保护集——删了它提交锚报「已丢失」。
     */
    const dg = degraded[c] ?? [];
    if (dg.length > 0) {
      const w = await writeMeta(
        ref.layout, stage, `review-${c}-${runId}.degraded.json`,
        JSON.stringify({ critic: c, run_id: runId, findings: dg }, null, 2) + '\n',
      );
      metaPaths.push(w.absPath);
      protectedMeta.push({ path: w.relPath, sha256: w.sha256 });
    }

    // parse_fallback 侧另存编号化的原文，让 Driver 有可逐条裁决的单元（§6.6 规则 8）
    if (reviews[c] === null && fallbackText[c]) {
      const items = enumerateFallbackFindings(fallbackText[c]!, c);
      const cause = fallbackCause[c];
      const fb = await writeMeta(
        ref.layout, stage, `review-${c}-${runId}.fallback-items.md`,
        `# ${c} 侧解析降级：待逐条裁决的意见单元\n\n` +
          (cause ? `> 整份回退的成因：${FALLBACK_CAUSE_LABEL[cause]}（\`${cause}\`）\n\n` : '') +
          `${items.map((i) => `- ${i}`).join('\n')}\n`,
      );
      metaPaths.push(fb.absPath);
      protectedMeta.push({ path: fb.relPath, sha256: fb.sha256 });
    }
  }

  // ── 收尾元数据 ──
  meta.finished_at = finishedAt;
  meta.review_mode = mode.mode;
  meta.degraded_reason = mode.degradedReason;
  /*
   * `policy` = 本轮实际适用的那个配置键的值。比不了（`unknown`，EV-139）按 `on_drift_related` 处置，
   * 这里同口径；`unknown_reason` 只取加法、只在比不了时写，既有三个字段的含义不变。
   */
  meta.snapshot.drift = {
    changed: verdict.drift.kind !== 'none',
    files: verdict.fingerprintChangedFiles,
    policy:
      verdict.drift.kind === 'related' || verdict.drift.kind === 'unknown'
        ? cfg.review.on_drift_related
        : cfg.review.on_drift,
    ...(verdict.drift.kind === 'unknown'
      ? { unknown_reason: { cause: verdict.drift.cause, detail: verdict.drift.detail } }
      : {}),
  };
  /*
   * 收尾复算的 tree 落盘，只供审批时的工作树改动摘要作基线（审批前工作树摘要计划 r2 §2.3）。
   * 没有任何判定读它；与 drift 同一处写、同一次落盘，之后 run.json 不再更新（EV-133 的不变量不受影响）。
   */
  meta.snapshot.after_tree_hash = afterTreeHash;
  meta.guard = {
    readonly_breach: verdict.readonlyBreach,
    peer_artifact_read: verdict.peerArtifactRead,
    peer_deny_applied: Object.fromEntries(
      sides.map((c) => [c, results[c]?.peer_deny_applied ?? false]),
    ),
    // 逐侧的跳过条数进 run.json，report 据此推降级旗标（代码双审 r2 CODEX-01）
    deny_skipped: Object.fromEntries(
      sides.map((c) => [c, results[c]?.deny_skipped ?? 0]),
    ),
    // 保留字段（EV-137）：run.v1 / v2 必填，写侧恒 false，不代表检测过
    forged_role_file: false,
    breached_files: verdict.breachedFiles,
    /*
     * 措施 b（§10.1 / EV-01）的命中记录，**逐审核者**（审查意见 GLM-06）。
     *
     * 只给**真被判定过的侧**写键：`verdict.sides[c]` 不存在说明该侧失败/超时、
     * 被 `judgeRun` 跳过，其 `command_texts` **从未扫过**——那种情形下写
     * `hit: false` 就是在说「扫过没命中」，与事实不符。
     * 三态因此落在结构上而不是值上：键缺 = 没扫，`hit:false` = 扫过没命中。
     */
    peer_leak_via_command: Object.fromEntries(
      sides
        .filter((c) => verdict.sides[c] !== undefined)
        .map((c) => [c, {
          /*
           * `hit` 的语义是「命令通道**扫到了东西**」，不是「这一侧作废了」——
           * 与路径通道同口径（那边是 r1 修的同一个毛病）。挂在只含作废类的
           * `peerCommandHits` 上，会让告警档的命令命中落盘成 `hit:false` + 非空明细。
           */
          hit: verdict.sides[c]!.typedCommandHits.length > 0,
          commands: [
            ...new Set(verdict.sides[c]!.typedCommandHits.map((h) => h.command)),
          ],
          /*
           * **命中逐条带类**，与 `peer_leak_via_path.hits` 同构（r2 AGY-04 ≡ GLM-05）。
           * `path` 是分类实际用的目标：命令里那个路径 token，静态解析不了时是条目本身。
           */
          hits: verdict.sides[c]!.typedCommandHits,
        }]),
    ),
    /*
     * 路径通道的按侧留痕（2026-09-16），与上面的命令通道**同构**。
     *
     * 补它之前，措施 a 只有一个全局 OR 的布尔位 `peer_artifact_read`：
     * 措施 b 按侧记命中与命令原文，措施 a 的命中明细一条不进。后果实测发生过——
     * 一侧确实命中而看不见，据此在裁决件里写了错的处置表；要查只能手工复算
     * 原始轨迹，而运行目录到期即删。
     *
     * 三态同样落在结构上：字段缺失=早于接线；某侧键缺失=那一侧没扫（失败/超时
     * 被 judgeRun 跳过）；`hit: false`=扫过、没命中。
     * **命中逐条带类**——同一侧一轮内可同时命中多类，处置取最重档，
     * 而留痕要能复盘每一条各属哪类（设计 §10.1.1）。
     */
    peer_leak_via_path: Object.fromEntries(
      sides
        .filter((c) => verdict.sides[c] !== undefined)
        .map((c) => [c, {
          /*
           * `hit` 的语义是「路径通道**扫到了东西**」，不是「这一侧作废了」——
           * 后者由 `peer_artifact_read` 表达，两者不可互相顶替。
           *
           * 初版把它挂在 `peerHits`（只含作废类）上，于是告警档的命中
           * 落盘成 `hit: false` + 非空 `hits`：同一条留痕里自相矛盾，
           * 而「读了凭据文件」这类事实在机读面上直接消失。
           */
          hit: verdict.sides[c]!.typedHits.length > 0,
          hits: verdict.sides[c]!.typedHits,
        }]),
    ),
    /*
     * 两条核验通道的降级档位（§11.1，M8 第 2 步）——留痕五面里的第一面。
     *
     * 三态与 `peer_leak_via_command` 同构地落在**结构**上：整个字段缺失 = 该次运行
     * 早于本次接线；某侧的键缺失 = 那一侧失败/超时、根本没判过；值 = 该侧的实际档位。
     * `evidence_threshold` 记本次生效的项目读取下限：`command-trace` 族折减过，
     * 不记的话同一个读数在两族间一过一不过，复盘时看起来像 bug。
     */
    /*
     * 共同阻断这一档的执行状态（设计 §12.1）。
     *
     * **写在这里而不是 gate 里**：gate 是校验命令、可以反复跑，而 run.json 是
     * 这一轮的运行事实，只写一次。字段的语义是「本轮这一档做没做」，
     * 属于运行事实而非校验结论。
     *
     * 初版设计与 schema 都声明了这个字段、`gate` 也算了三态，**唯独没有写侧**——
     * 于是留痕里它恒缺失，而设计写着「写侧恒写 · 已实现」。
     * 「声明了但没有代码让它成真」在本批自己的交付里复发了一次（r1 三侧独立指出）。
     *
     * 这里只能给出「有效侧够不够」这一半：真正的共同项要等裁决表齐备才算得出，
     * 那是 `gate --check` 的事。所以本字段在运行时先落 `effective_sides` 与
     * 「够/不够」，`checked-found` 与 `checked-none` 的区分由 gate 的告警补充——
     * **这个边界要写明，否则下一个人会以为 run.json 里的 state 是最终结论**。
     */
    joint_check: jointCheckRun,
    verification_degraded: Object.fromEntries(
      sides
        .filter((c) => verdict.sides[c] !== undefined)
        .map((c) => [c, {
          readonly: verdict.sides[c]!.verification.readonly,
          path: verdict.sides[c]!.verification.path,
          /*
           * `unavailable` 的成因（r2 GLM-03 ≡ CODEX-07）：三种成因的处置完全不同
           * ——结构性无信号（没法修）、该侧没报计数（修适配器）、本轮零必带路径调用
           * （不是缺陷）。压成一个值，读留痕的人无从判断该去修什么。
           */
          ...(verdict.sides[c]!.verification.pathCause
            ? { path_cause: verdict.sides[c]!.verification.pathCause }
            : {}),
          evidence_threshold: verdict.sides[c]!.verification.evidenceThreshold,
          // 证据不可信（EV-188）：只在成立时写，常态 run.json 逐字不变；schema 逐侧加的是可选属性
          ...(verdict.sides[c]!.verification.untrusted
            ? { evidence_untrusted: verdict.sides[c]!.verification.untrusted }
            : {}),
        }]),
    ),
    ...(verdict.unattributedDriftFiles.length > 0
      ? { unattributed_drift_files: verdict.unattributedDriftFiles }
      : {}),
  };
  for (const c of sides) {
    const r = results[c];
    if (!r) continue;
    const side = verdict.sides[c];
    meta.critics[c] = {
      /*
       * 从注册表取，不再 `c === 'gemini' ? 'antigravity' : 'zcode'`。
       * 那个三目最危险的地方是它不会响亮失败：第三家会被**静默记成 zcode**，
       * 而 vendor 是适配器路由与禁读矩阵的依据，留痕直接是错的。
       *
       * 类型层的防错也已补齐（M7b 第 3 步，BACKLOG EV-03 收口）：`Vendor` 不再是
       * 独立的两值 union，而**就是**注册表的 `AgentVendor`，`CRITIC_VENDOR` 派生处
       * 那个把四值宽 union 断言成两值的 `as Vendor` 随之删除。此前它恒编译通过，
       * 新增审核者时这条链不会像 `effortFor` / `checkModelSlugs` 的 `never` 分支
       * 那样报错，而是把新 vendor 静默塞进值位、落盘才被枚举校验拒掉。
       * 前提是 `run.v2` 的 `vendor` 不再枚举两值——所以它只能随本步一起做。
       */
      vendor: CRITIC_VENDOR[c],
      cli_version: r.cli_version,
      model_requested: requests[c]!.model,
      model_effective: r.model_effective,
      model_effective_source: r.model_effective_source,
      /*
       * 两个字段**恒写**（含 null），不走 `...(x ? {} : {})` 的条件展开。
       *
       * 条件展开会让「该族没有这种事实」与「本轮没采到」再次落成同一个观测——
       * 字段缺失既可能是旧留痕、也可能是新缺陷，事后分不开。
       * 这与措施 b 的 `peer_leak_via_command` 恒写、`hit:false` 表示「扫过没命中」
       * 是同一条口径（6.7.1 写侧说明）。
       */
      profile_requested: r.profile_requested,
      model_provider: r.model_provider,
      ...(r.model_route ? { model_route: r.model_route } : {}),
      /*
       * **条件展开是刻意的**，与上面几格「恒写」的口径不冲突（EV-82）：那几格的
       * 字段缺席没有含义，所以缺席必须被消灭；这一格的字段缺席**本身就是一种取值**
       * ——「本次没有覆盖尝试」。恒写会把它压进 `null`，而 `null` 的唯一含义是
       * 「尝试了、没回读到生效模型」。详见 `CriticResult.model_override_applied`。
       */
      ...(r.model_override_applied === undefined
        ? {}
        : { model_override_applied: r.model_override_applied }),
      // 落点自检（EV-112 计划 r3 §4.6）：同一口径，缺席 = 没走到自检，不压成 null
      ...(r.carriers_landed === undefined ? {} : { carriers_landed: r.carriers_landed }),
      // 没做覆盖而实际模型不同（EV-122）：同一口径，缺席 = 不成立，不压成 null
      ...(r.model_unenforced === undefined ? {} : { model_unenforced: r.model_unenforced }),
      ...(requests[c]!.effort ? { effort: requests[c]!.effort! } : {}),
      status: r.status,
      exit_code: r.exit_code,
      duration_s: r.duration_s,
      tool_calls: { ...r.tool_calls, project_reads: side?.projectReads ?? 0 },
      evidence_ok: side?.evidenceOk ?? false,
      ...(r.usage ? { usage: r.usage } : {}),
      heterogeneous: isHeterogeneous(r.model_effective ?? requests[c]!.model, agentById(meta.driver)!.vendor),
      // 与上面渲染侧**共用同一个派生函数**：两处各写一份文案就会踩破
      // 「front-matter 与运行元数据两处同值」这条自己要守的判据（EV-54）
      override_reason: overrideReasonFor(
        c, r.model_effective ?? requests[c]!.model, opts.modelOverrides, r.profile_requested, meta.driver,
      ),
      fail_reason: r.fail_reason,
      /*
       * 「合格 0 条**且**降级 0 条」才是空结论（解析回退逐条降级计划 r2 §3.3）：只数合格意见的话，
       * 全部意见都降级的一侧会被记成 `empty_review: true`，而它明明交了意见。
       */
      empty_review: reviews[c] ? reviews[c]!.findings.length === 0 && (degraded[c] ?? []).length === 0 : false,
      parse_fallback: r.status === 'parse_fallback',
      /*
       * 三格的三态落在结构上（计划 r2 §3.3）：解析成功的侧恒写前两格（零值 = 解析过、没有），
       * parse_fallback 侧恒写成因；失败 / 超时侧三格都不写。gate 的降级期望集取自 `findings_degraded`。
       */
      ...(reviews[c]
        ? {
            findings_degraded: (degraded[c] ?? []).map((d) => d.id),
            parse_repairs: repairs[c] ?? { stripped_fields: [], unescaped_backslashes: 0 },
          }
        : {}),
      ...(r.status === 'parse_fallback' && fallbackCause[c] ? { parse_fallback_cause: fallbackCause[c] } : {}),
      session_id: r.session_id,
      peer_deny_applied: r.peer_deny_applied,
      /*
       * **三格恒写**，与上方 `profile_requested` / `model_provider` 同一条口径
       * （条件展开会让「该族没有这种事实」与「本轮没采到」落成同一个观测）。
       *
       * 代码双审 r3 AGY-03 ≡ GLM-03：`run.v2.json` 的逐侧段已声明
       * `deny_skipped` / `deny_rule_count`，而这里**一个都没写**——
       * 机读契约宣告了不存在的产出点（本仓 EV-06 反复登记的形态），
       * 读 schema 的人会到逐侧记录里找一个永不出现的字段。
       *
       * 真实落盘此前只有 `meta.guard.deny_skipped`，那是**聚合 map**：
       * 与逐侧段同名不同形（object vs integer），混淆面比缺字段更大。
       * 两段各司其职——聚合面给 `report.ts` 推旗标，逐侧面留逐侧事实。
       */
      deny_skipped: r.deny_skipped,
      deny_rule_count: r.deny_rule_count,
      deny_bytes: r.deny_bytes,
    };
  }
  /*
   * 追加而非替换：prepareRun 已经把 `_meta/` 的补丁与两份 brief 登记进去了，
   * 整体覆盖会把它们挤掉，保护集又缩回只剩审查文档。
   */
  meta.artifacts = [
    ...meta.artifacts,
    ...protectedMeta,
    ...(await Promise.all(
      artifacts.map(async (p) => ({
        path: path.relative(ctx.archiveRoot, p),
        sha256: artifactSha.get(p) ?? (await sha256File(p)),
      })),
    )),
  ];

  // 被审对象漂移 → 整次运行作废（§9.2 第 2 步，优先级最高）
  let exitCode: number = EXIT.OK;
  if (verdict.drift.kind === 'subject_drift') {
    meta.status = 'failed';
    exitCode = EXIT.FAIL;
  } else if (verdict.driftAction === 'fail') {
    meta.status = 'failed';
    exitCode = EXIT.FAIL;
  } else if (mode.abort) {
    meta.status = 'failed';
    exitCode = EXIT.STRICT_ABORT;
  } else {
    meta.status = 'success';
  }

  /*
   * ── plan / bug 原稿登记（M10a 第 2 步，EV-55，计划 §3.1.1）──
   *
   * **时点**：收尾且 `meta.status === 'success'` 才登记，不在 `--start` 骨架期。
   * 送审窗口内改稿由 `subject_drift` 判定承接、整轮作废；作废轮（本判据之前的
   * `subject_drift` / 超时 / abort 分支）不登记，于是「作废轮之后要不要继续保护
   * 原稿」这个取舍不必做——它压根没进保护集，改了直接可提交。
   *
   * **只对 plan / bug 生效**：code 阶段的被审对象是 `_meta/changes-<runid>.diff`，
   * 已在 `prepareRun` 经 `pendingDiff` 登记（§3.1.1 硬约束 1），这里再登记就是同一份
   * 工件的重复条目。
   *
   * **路径按归档相对形态登记**，不用 `subjectPath` 的绝对值——`checkRecordedArtifacts`
   * 核对时统一按 `path.join(layout.archiveRoot, a.path)` 解析（`archive.ts`），
   * 绝对路径会被当成归档根下一个不存在的位置，判 `missing`。
   *
   * **域约束**：相对结果以 `..` 越出归档根（`--plan-file doc/…` 这类归档外文档）时
   * 不登记，且如实标注——静默跳过会让人以为登记了，而这类文档要保留「设计文档审后
   * 回补修订」的常态改动能力，提交锚不该覆盖它。
   *
   * **哈希用冻结值**（计划 §7.3 R-j，代码双审 r2 GLM-03）：不在这里重新读盘。
   * 漂移复算点与这里之间隔着批量哈希与多份落盘，窗口内原稿若被改写，重算会把
   * 篡改版锁成基线；登记冻结值则是 fail-safe——窗口内被改的文件在下次提交时判 modified。
   */
  if (stage !== 'code' && meta.status === 'success') {
    const relSubject = await resolveSubjectArtifactRelPath(ctx.archiveRoot, subjectPath);
    if (relSubject === null) {
      const notice = `本轮原稿不在保护集：${subjectPath} 不在归档根内，提交锚不覆盖它`;
      warnings.push(notice);
      meta.gate.warnings = [...(meta.gate.warnings ?? []), notice];
    } else {
      meta.artifacts.push({ path: relSubject, sha256: primarySnap.subjectSha256 });
    }
  }

  /*
   * 构建标识比对（EV-82 小主题第一段 r2 §2）：只在**本仓模式**下出告警——被审项目就是编排器本仓时，
   * 才能拿编排器的构建来源与它比；外部项目里 HEAD 恒不等，告警会常亮（r2 CODEX-01）。
   * 位置在 writeRunMeta 之前，与上面那条同位，才落得进 run.json（AGY-05）。只告警，不阻断、不改 evidence_ok。
   * 比对本身出错不得拖垮收尾，但**要留痕**（代码双审 r1 GLM-03）：`checkBuildStamp` 内部的 git 失败
   * 都已以 null 收口，能到这里的基本只剩编程错误，而那恰是最该被看见的一类——吞掉就成了
   * 「零告警、零痕迹」，与非本仓模式不可区分。与 doctor 侧「读取失败」同型，只告警、不阻断。
   */
  for (const notice of await collectBuildStampNotices(ctx.projectRoot, meta.snapshot.build ?? null)) {
    warnings.push(notice);
    meta.gate.warnings = [...(meta.gate.warnings ?? []), notice];
  }

  meta.gate.state = meta.status === 'success' ? 'review_done_awaiting_disposition' : 'failed';

  await writeRunMeta(ref.layout, stage, meta);
  await registerRun(ref.layout, meta, { triviumDir: ctx.triviumDir, heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000 });

  /*
   * 同步到 state.json，Hook 才看得见。
   *
   * 失败的运行置 `idle`：没有可裁决的意见，却让闸门卡在 running 会把 Driver
   * 永久锁死在一个已经结束的运行上——那比不拦更糟，因为人会去改配置绕开 Hook。
   */
  await setGateChecked({
    triviumDir: ctx.triviumDir,
    topic: ref.topic, stage,
    state: meta.status === 'success' ? 'review_done_awaiting_disposition' : 'idle',
    runId, rerunIndex: sharedIndex,
    sessionId: opts.sessionId ?? null,
    heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
    // 只写属于本 run 的闸门：并发的另一轮已经接管时不该被我们改写
    expect: { runId },
  });

  say('');
  say(summarizeRun(meta));

  /*
   * 多审退化提示（§9.3）。放在这里而非 `report`，是因为它只对**本次**结论有意义，
   * 而 report 是跨轮复盘——真正需要看到「这次两家在看同一批地方」的人是刚跑完的 Driver。
   * report 之后会按主题做跨轮汇总，两者不冲突。
   */
  /*
   * 逐对算，不再写死「恰好两侧且必是 gemini×glm」。
   * 两侧时产出一对，与旧行为等价；三审时三对，不会静默丢掉任何一家。
   */
  for (const div of measureAllPairs(reviews, sides)) {
    say(renderDivergence(div));
    if (div.degenerate) {
      warnings.push(`多审退化：${div.a} 与 ${div.b} 的镜头重合度过高，见上方 Jaccard 提示`);
    }
  }

  if (warnings.length > 0) {
    say('');
    for (const w of warnings) warn(w);
  }
  say('');
  say('已落盘：');
  for (const a of artifacts) say(`  ${path.relative(ctx.projectRoot, a)}`);
  say(`  ${path.relative(ctx.projectRoot, metaDir(ref.layout, stage))}/ （${metaPaths.length} 份审计材料）`);

  return {
    runId, rerunIndex, artifacts, metaPaths, warnings, exitCode,
    sideStatuses: Object.fromEntries(
      sides.map((c) => [c, results[c]?.status ?? 'failed']),
    ) as Partial<Record<CriticId, CriticResult['status']>>,
  };
}

/** 己方历史产出与 Driver 对它的裁决（§9.4 第 4 段最后一条） */

/** 同步路径（M1 行为）：准备 + 执行一气做完。长时运行请用 `--start` / `--wait` */
export async function runReview(opts: ReviewOptions): Promise<ReviewOutcome> {
  const { ctx } = opts;
  /*
   * 同步路径同样要持主题锁（§12.6）。原先一行锁都没有：终端里的同步 `review` 与
   * skill 侧的 `--start` worker 同时跑同一主题，两边同时冻结、同时算出同一个 -r<N>、
   * 同时写 _meta/ 与 task.json，闸门互相覆盖。与 startRun 用同一套判据。
   */
  const lock = await acquireLock({
    triviumDir: ctx.triviumDir,
    topic: opts.topic,
    stage: opts.stage,
    kind: 'run',
    heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
    runTerminal: async (runId) => {
      if (!runId) return false;
      const ref = await resolveTopicReadOnly(ctx, opts.topic, opts.stage);
      const m = await readRunMeta(ref.layout, opts.stage, runId);
      return m !== null && m.status !== 'running';
    },
  });
  try {
    /*
     * 回收了上一轮遗留的运行锁时给那一轮收尾（EV-151）；再把本轮的 run_id 写进锁（同步路径扩展），
     * 本进程被中断之后下一次取锁能据此收本轮的尾。动态导入：`run-protocol.ts` 静态导入本模块，反向静态导入会成环。
     */
    const { settleReclaimedRunLocks } = await import('./run-protocol.js');
    await settleReclaimedRunLocks(ctx, lock.reclaimed);
    return await runReviewLocked({ ...opts, onRunIdAllocated: (runId) => recordRunIdInLock(lock, runId) });
  } finally {
    await lock.release();
  }
}

/**
 * 同步路径把本轮 run_id 写进自己持有的主题锁（EV-151 同步路径扩展）：pid、启动时刻、`acquired_at` 都不变，
 * 只补 `run_id`，与 worker 锁同形（`release` 按 pid + `acquired_at` 认自己的锁，不受影响）。
 * 与 `--start` 改写 worker 锁同一种非原子写：并发者撕裂读判 `unparsable`，由 `acquireLock` 对不足 2 s 的不可解析锁
 * 不回收的防御兜住。写不进只告警——退回「锁里定位不到上一轮」的旧形态，不挡本轮。
 */
async function recordRunIdInLock(lock: LockHandle, runId: string): Promise<void> {
  try {
    await fs.writeFile(lock.path, JSON.stringify({ ...lock.content, run_id: runId }, null, 2) + '\n', 'utf8');
  } catch (e) {
    warn(`没能把 run_id ${runId} 写进主题锁（${String((e as Error)?.message ?? e).split('\n')[0]}）：本进程若被中断，下一次取锁定位不到这一轮、不会替它收尾`);
  }
}

async function runReviewLocked(opts: ReviewOptions): Promise<ReviewOutcome> {
  const rc = await prepareRun(opts);
  try {
    return await executeRun(rc);
  } catch (e) {
    /*
     * 同步路径也要回收闸门（审查意见 AGY-06）。
     *
     * 上一批只给 worker 那条路加了回收，漏了这里——而 `prepareRun` 在这条路上
     * 同样置了 `running`。异常一抛，闸门就挂在 running 上直到 24h TTL，
     * 业务写入全程被拦。
     *
     * 与 `state.ts` 的 `releaseRunningGateEntry` 同形（`running → idle`、比 runId、槽位不存在不造条目、吞错），
     * **改一处须改两处**。这里没改调它：`hooks.ts` 头注释按「`review.ts` 的四处 `setGateChecked`」计数引用
     * 这一处（闸门拦截不留骨架计划 r2 §3.2；代码双审 r1 CODEX-05 取只加互指注释）。
     */
    await setGateChecked({
      triviumDir: rc.ctx.triviumDir,
      topic: rc.ref.topic, stage: rc.stage, state: 'idle', runId: rc.runId,
      heartbeatStaleMs: rc.cfg.review.heartbeat_stale_s * 1000,
      expect: { state: ['running'], runId: rc.runId, allowMissing: false },
    }).catch(() => {
      /* 回收失败不该盖过真正的错误 */
    });
    /*
     * 同步路径的事后收尾（EV-145，事后收尾余项计划 r2 §3.4）：把仍为 running 的 run.json 收尾为 failed（`sync_exception`）。
     * 写者就是本进程——同步路径从不写 status.json 与交接文件，`--cancel` / `--wait` 够不着；没有 worker。
     * 「仍为 running 才写」挡住 executeRun 已写完终态、之后的登记或闸门写入才抛的那一格，不追溯改写。
     * 与上面的闸门回收同一次序（先回收、再收尾，见 meta.ts 通用体文档块）；主题锁由 `runReview` 的 finally 在其后放。
     * `prepareRun` 在 try 之外，它的失败由它自己的 catch 收尾，不会走到这里、不重复。
     */
    const fin = await finalizeFailedRunMeta({
      layout: rc.ref.layout, stage: rc.stage, runId: rc.runId,
      lock: { triviumDir: rc.ctx.triviumDir, heartbeatStaleMs: rc.cfg.review.heartbeat_stale_s * 1000 },
      workerGone: true,
      termination: { by: 'sync_exception', exit_code: exitCodeOf(e) },
    });
    for (const line of finalizeLines(fin, rc.runId, '同步路径异常')) warn(line);
    throw e;
  }
}

async function listOwnHistory(
  stageDirAbs: string,
  projectRoot: string,
  critic: CriticId,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(stageDirAbs);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(`-${critic}.md`) || /-(?:revised|response)-claude\.md$/.test(e))
    .map((e) => path.relative(projectRoot, path.join(stageDirAbs, e)))
    .sort();
}

/**
 * 重试时追加进 BRIEF 的提示：让模型知道上一次哪里不对（§12.3）。
 *
 * **只在适配器层判为瞬时故障、要重试这一侧时**经 `runBothSides` 的 `onRetryBrief` 调用。
 * 解析与 `parse_fallback` 的判定发生在全部重试结束之后（本文件「解析」一段），不经这里——
 * 回退成因的标记到不了本函数（解析回退逐条降级计划双审 r1 AGY-03 驳回时核实）。
 */
function buildRetryHint(critic: CriticId, prev: CriticResult): string {
  const reason = prev.fail_reason ?? '未记录原因';
  if (/no_project_context/.test(reason)) {
    return (
      '## 上一次尝试未通过\n\n' +
      '**你没有读取任何项目文件**，只看了任务书与被审对象。这不满足「结合整个项目评审」的要求。\n' +
      '本次请先按第 4 节的必读清单实际读取文件，再下结论。'
    );
  }
  if (/insufficient_evidence|no_trace/.test(reason)) {
    return (
      '## 上一次尝试未通过\n\n' +
      `工具调用次数不足：${reason}\n` +
      '审查必须建立在实际读取代码与文档之上，请先读再判。'
    );
  }
  if (/schema|parse|JSON/.test(reason)) {
    return (
      '## 上一次输出未能解析\n\n' +
      `${reason}\n\n` +
      '请严格按第 6 节的输出契约重新输出：**只输出 JSON**，不要包裹说明文字，' +
      '九个字段全部必填，枚举字段只取第 6 节列出的值。'
    );
  }
  return `## 上一次尝试失败\n\n${critic} 侧上一次的失败原因：${reason}`;
}

export { TriviumError };
