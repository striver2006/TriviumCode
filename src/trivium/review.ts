/**
 * `review`：一次双审运行的编排（设计 §8.2 S2 / 第 9~11 章）。
 *
 * 顺序有讲究，不能调：
 *   冻结 → 生成两侧送审包 → 写 run.json 骨架 → **并行**拉起两侧 →
 *   复算快照 → 解析 → guard 判定 → 两侧齐备后**同时**落盘 → 收尾元数据
 *
 * 「两侧齐备后同时落盘」是背靠背隔离的第 ② 道（§10.1）：审查进行中，对方本次结论
 * 在项目树内**物理不存在**（原始输出在 `~/.trivium/runs/` 下，项目外），
 * 因此不需要靠提示词去要求对方「别看」。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type { Config, CriticId, CriticRequest, CriticResult, Ctx, Review, Stage } from './types.js';
import { CRITICS } from './types.js';
import { agyAdapter } from './adapters/agy.js';
import { zcodeAdapter } from './adapters/zcode.js';
import {
  isHeterogeneous,
  routeModel,
  type AdapterContext,
  type CriticAdapter,
} from './adapters/base.js';
import { resolveAdapters } from './adapters/stub.js';
import { freeze } from './freeze.js';
import {
  buildMustReadList,
  excerptSubject,
  extractPathReferences,
  loadLenses,
  loadStagePrompt,
  renderBrief,
} from './brief.js';
import { parseReview, enumerateFallbackFindings } from './parse.js';
import { decideMode, runBothSides } from './runner.js';
import { judgeRun, renderGuardWarnings } from './guard.js';
import { renderReviewDoc } from './render.js';
import { resolveTopicReadOnly, locateSubject } from './topic.js';
import {
  buildDiffHeader,
  classifyDiff,
  diffExcludePrefixes,
  diffFileName,
  filesInDiff,
  renderSkipNotice,
  summarizeDiff,
  type SkipVerdict,
} from './code-stage.js';
import { diffAgainst, headSha } from './util/git.js';
import { resolveRerunIndex, stageDir, writeArtifact, writeMeta, metaDir, type ArchiveLayout } from './archive.js';
import { newRunId, newRunMeta, readTask, registerRun, summarizeRun, writeRunMeta } from './meta.js';
import { measureDivergence, renderDivergence } from './divergence.js';
import { runRoot } from './config.js';
import { setGateChecked } from './state.js';
import { ensureDir, sha256, sha256File } from './util/fsx.js';
import { workTreeHash } from './util/git.js';
import {
  EXIT,
  envError,
  missingArtifact as missingArtifactError,
  usageError,
  TriviumError,
} from './exit-codes.js';
import { checkModelSlugs } from './preflight.js';
import { say, step, warn } from './util/log.js';

/** 任务目标进 BRIEF 只占一行，不是正文——超长就截断，别把第 4 段挤成一篇文章 */
const TASK_GOAL_MAX = 200;

function clampGoal(raw: string | null | undefined): string | null {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (t.length === 0) return null;
  return t.length > TASK_GOAL_MAX ? `${t.slice(0, TASK_GOAL_MAX)}…` : t;
}

/**
 * 从 plan 阶段原稿里取任务目标：第一个 Markdown 标题，取不到就取第一段正文。
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

/**
 * 解析本次要送进 BRIEF 第 4 段的任务目标（设计 §9.4）。
 *
 * 三级来源，取第一个非空：
 *   1. 显式 `--goal`（`/dual-run <任务目标>` 透传而来）
 *   2. `task.json` 的 `goal`——主题首次跑时落下的原文，后续阶段复用
 *   3. 同主题 plan 阶段原稿的标题/首段
 *
 * 都取不到就返回 null，该行不渲染（保持既有行为，不硬造一个目标去误导审查员）。
 * 刻意**不**兜底到主题名：主题是个短标签，当任务目标只会给审查员噪音。
 *
 * 两侧共用同一个结果——和「补丁只算一次」同理，否则两位审查员可能看到不同的目标。
 */
export async function resolveTaskGoal(
  opts: Pick<ReviewOptions, 'taskGoal' | 'stage' | 'subjectFile'>,
  ref: { topic: string; layout: ArchiveLayout },
  projectRoot: string,
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
    const planRef = { topic: ref.topic, layout: ref.layout, stage: 'plan' as const,
      stageDirAbs: stageDir(ref.layout, 'plan') };
    // 显式 subjectFile 是给当前阶段的，不能拿来定位 plan 原稿
    const planPath = await locateSubject(planRef, null, projectRoot);
    return goalFromPlanDoc(await fs.readFile(planPath, 'utf8'));
  } catch {
    // 纯 code 主题没有 plan 目录，属正常情况——静默跳过，不是错误
    return null;
  }
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
   * 不传时由 `resolveTaskGoal` 回退到 task.json / plan 原稿。
   */
  taskGoal?: string | null;
  /** Driver 指明的相关路径（UR-01），并入必读清单 */
  contextPaths: string[];
  /** plan/bug 的被审对象显式路径 */
  subjectFile: string | null;
  modelOverrides: Partial<Record<CriticId, string>>;
  command: string;
  /** 只跑一侧（调试用）。生产不应使用——那是伪双审 */
  onlyCritic?: CriticId | null;
  /** 覆盖 skill 资产根（默认取安装位置） */
  assetRoot?: string;
  /** code 阶段的 diff 基线，默认 HEAD */
  diffBase?: string | null;
  /**
   * 触发本次运行的 Claude Code 会话 id。
   *
   * 闸门写锁的作用域默认是「同会话」（RV-05），没有它 `shouldLockWrites`
   * 会因「闸门未记录触发会话」而一律不加锁——护栏静默失效。
   */
  sessionId?: string | null;
  /**
   * 本次运行临时降级：一侧失败时不中止，产出单审结果并留痕（§12.4）。
   *
   * 受 `review.allow_single_flag` 约束——配置里关掉这个开关，命令行也不能降级，
   * 否则「默认 strict」就成了纸面规定。
   */
  allowSingle?: boolean;
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

/** skill 资产根：优先环境变量，其次用户级安装位置 */
function resolveAssetRoot(override?: string): string {
  return (
    override ??
    process.env['TRIVIUM_ASSET_ROOT'] ??
    path.join(os.homedir(), '.claude/skills/dual-critic')
  );
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
  adapters: Record<CriticId, CriticAdapter>;
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
}

/**
 * 准备阶段：可用性检查 → 定位被审对象 → 冻结 → 渲染两侧送审包 → 写 run.json 骨架。
 *
 * 这一段**不拉起任何 Agent**，因此可以在 `--start` 的同步窗口内完成并秒级返回。
 */
export async function prepareRun(opts: ReviewOptions): Promise<RunContext> {
  const { ctx, stage } = opts;
  const cfg: Config = ctx.config;
  const assetRoot = resolveAssetRoot(opts.assetRoot);
  const schemaPath = path.join(assetRoot, 'schema/review.v1.json');
  const lensesPath = path.join(assetRoot, 'lenses.yaml');

  // 经工厂取适配器：TRIVIUM_STUB_CRITIC 在场时换成桩（测试用，生产路径会打醒目告警）
  const adapters = resolveAdapters({ gemini: agyAdapter, glm: zcodeAdapter });
  const adapterCtx: AdapterContext = {
    cfg,
    nodePath: cfg.runtime.node ?? process.execPath,
  };

  /*
   * ── slug 校验内嵌于此（审查意见 GLM-01）──
   *
   * 独立的 `preflight` 命令看不到 skill 步骤 3 才传来的 --model-* 覆盖值，
   * 而 routeModel 只透传不校验。若不在这里校验，非法 slug 会漏到运行中段才
   * 以业务性失败暴露——白烧配额且 strict 下整次中止。
   * §7.3 承诺的「退 64 并列出可用值」正是在这一处才真正成立。
   */
  {
    const slug = checkModelSlugs(cfg, stage, opts.modelOverrides);
    if (!slug.ok) throw usageError(`模型 slug 不合法：\n  ${slug.detail}`);
  }

  // ── 可用性检查：不可用就别开工，避免产生半套工件（AC-16 的精神）──
  const sides: CriticId[] = opts.onlyCritic ? [opts.onlyCritic] : [...CRITICS];
  for (const c of sides) {
    const av = adapters[c].availability(adapterCtx);
    if (!av.ok) throw envError(`${c} 侧不可用：${av.reason}`);
  }
  if (sides.length < 2) {
    warn(`只跑 ${sides.join('/')} 一侧：这不是双审，结果会被标为降级。仅供调试使用。`);
  }
  if (opts.allowSingle) {
    if (cfg.review.allow_single_flag) {
      warn(
        '已启用 --allow-single：一侧失败时不中止，产出单审结果。' +
          '单审的交叉验证价值远低于双审，结果会在元数据与文档头标为降级（AC-06）。',
      );
    } else {
      warn(
        '配置 review.allow_single_flag 为 false，忽略 --allow-single，仍按 strict 执行。' +
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
  const rerunIndex = await resolveRerunIndex(ref.layout, stage);
  const runId = newRunId();

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
    const body = await diffAgainst(ctx.projectRoot, base, excludes);
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
    subjectPath = await locateSubject(ref, opts.subjectFile, ctx.projectRoot);
    subjectText = await fs.readFile(subjectPath, 'utf8');
  }

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
  // 运行目录也推迟到落盘阶段才建（GLM-04）
  const runDirBase = path.join(runRoot(cfg), repoId(ctx.projectRoot), runId);

  const lenses = await loadLenses(lensesPath);
  // 阶段专属审查要点。缺文件返回 null，旧版安装不至于跑不起来
  const stagePrompt = await loadStagePrompt(assetRoot, stage);
  const mustRead = await buildMustReadList(cfg, ctx.projectRoot, ref.topic, opts.contextPaths);
  const suggestedRead = extractPathReferences(subjectText);
  const excerpt = excerptSubject(subjectText);
  // 两侧共用同一个任务目标：逐侧各解析一次，可能因中途写入而拿到不同结果
  const taskGoal = await resolveTaskGoal(opts, ref, ctx.projectRoot);

  // ── 冻结 + 送审包（禁读清单逐侧不同：屏蔽的是**对方**的历史产出）──
  const snapshots: Partial<Record<CriticId, Awaited<ReturnType<typeof freeze>>>> = {};
  const requests: Partial<Record<CriticId, CriticRequest>> = {};
  const metaPaths: string[] = [];
  /** 两侧的 brief 先攒在这里，全部算完才落盘（GLM-04） */
  const pendingBriefs: { fileName: string; text: string }[] = [];

  for (const critic of sides) {
    const snap = await freeze({
      cfg,
      projectRoot: ctx.projectRoot,
      archiveRoot: ctx.archiveRoot,
      stage,
      critic,
      subjectPath,
      ...(opts.diffBase ? { base: opts.diffBase } : {}),
      ...(frozenDiffText !== null ? { diffText: frozenDiffText } : {}),
    });
    // code 阶段 freeze 只能给出占位路径，真实路径在 _meta/ 下，这里回填
    if (stage === 'code') snap.subjectPath = subjectPath;
    snapshots[critic] = snap;

    const routed = routeModel(cfg, critic, stage, { cli: opts.modelOverrides[critic] ?? null });
    if (!routed.model) {
      throw envError(
        `${critic} 侧没有可用模型：profile「${cfg.active_profile}」未定义 ${stage} 阶段的模型，` +
          `且未通过命令行指定。`,
      );
    }

    const ownHistory = await listOwnHistory(ref.stageDirAbs, ctx.projectRoot, critic);

    const briefText = renderBrief({
      cfg, critic, stage, topic: ref.topic, runId,
      projectRoot: ctx.projectRoot,
      snapshot: snap,
      promptHint: opts.promptHint,
      subjectExcerpt: excerpt,
      mustRead, suggestedRead, ownHistory,
      schemaPath, lenses, stagePrompt,
      taskGoal,
      minToolCalls: cfg.review.min_tool_calls[stage],
      minProjectReads: cfg.review.min_project_reads[stage],
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
      effort: critic === 'gemini' ? cfg.critics.gemini.effort[stage] : undefined,
      timeout_s: cfg.review.timeout_s[stage],
      schema_path: schemaPath,
      min_tool_calls: cfg.review.min_tool_calls[stage],
      min_project_reads: cfg.review.min_project_reads[stage],
    };
  }

  const primarySnap = snapshots[sides[0]!]!;

  /*
   * ── 到这里为止**一个文件都没写**。从这一行开始才落盘。──
   * 顺序：建阶段目录 → 写两份 brief → 建运行目录 → 写 run.json
   */
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
    const w = await writeMeta(ref.layout, stage, pendingDiff.fileName, pendingDiff.text);
    metaPaths.push(w.absPath);
    metaArtifacts.push({ path: w.relPath, sha256: w.sha256 });
    /*
     * 另留一份 `changes.diff` 便于人读（`.reviews/README.md` 记载的就是这个名字）。
     * 它**不进保护集**：它只是指向最新一轮的便利副本，会被下一轮覆盖，
     * 受保护的是上面那份带 run_id 的。补丁头部自带 run_id，不会认错是哪一轮。
     */
    const alias = await writeMeta(ref.layout, stage, 'changes.diff', pendingDiff.text);
    metaPaths.push(alias.absPath);
  }
  for (const b of pendingBriefs) {
    const w = await writeMeta(ref.layout, stage, b.fileName, b.text);
    metaPaths.push(w.absPath);
    metaArtifacts.push({ path: w.relPath, sha256: w.sha256 });
  }
  await ensureDir(runDirBase);

  // ── run.json 骨架（status: running），崩溃后也能取证 ──
  const meta = newRunMeta({
    runId, topic: ref.topic, stage, rerunIndex,
    command: opts.command,
    promptHint: opts.promptHint,
    taskGoal,
    treeHash: primarySnap.treeHash,
    gitHead: primarySnap.gitHead,
    dirty: primarySnap.dirty,
    subjectSha256: primarySnap.subjectSha256,
    denyPaths: primarySnap.denyPaths,
    driftPolicy: cfg.review.on_drift,
  });
  meta.artifacts = [...metaArtifacts];

  // FR-23：跳过也要留痕，且必须写明命中的规则供人复核（§6.4）
  if (skipVerdict?.skipped) {
    meta.skipped = true;
    meta.skip_reason = skipVerdict.reasons.join('；');
  }
  await writeRunMeta(ref.layout, stage, meta);
  await registerRun(ref.layout, meta);

  /*
   * 任务目标落进 task.json，供本主题后续阶段复用——但**只落显式传入的那一个**。
   *
   * 从 plan 原稿推导出来的值不写回：它是个尽力而为的猜测（一个标题而已），
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
    });
  }

  /*
   * ── 闸门状态必须写进 state.json，不能只写进 run.json ──
   *
   * 四个 Hook 都是读 `state.json` 判定的（listOpenGates）。原先 review 只在
   * run.json 里记 `gate.state`，state.json 压根没被创建，于是
   * `hook-pre-write`（审查期禁写）、`hook-pre-commit`（裁决未齐备禁提交）、
   * `hook-stop`（裁决未齐备禁收工）**三个 Hook 全部无事可判、一律退 0**。
   * 那是整条流水线最核心的护栏（AC-02 / AC-12 / §8.5），实测确认过是静默失效的。
   */
  if (!skipVerdict?.skipped) {
    /*
     * 置 running 前先确认槽位不是**别的 run** 的待裁决状态（审查意见 GLM-r2-01 ③）。
     *
     * `state.json` 每个 <主题>/<阶段> 只有一个槽位。旧一轮审完未裁决就直接重跑，
     * 无条件覆盖会把待裁决状态无声抹掉，而 `gate --check` 只校验最新轮——
     * 旧那一轮从此既逃过裁决、也不再拦提交。
     */
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
          `  补齐裁决件并通过 \`trivium gate --stage ${stage} --topic ${ref.topic} --check\` 后再来，\n` +
          `  或用 \`trivium abandon --topic ${ref.topic} --stage ${stage}\` 显式作废那一轮（工件保留）。`,
      );
    }
  }

  return {
    opts, cfg, ctx, stage, ref, adapterCtx, adapters, sides,
    runId, rerunIndex, subjectPath, runDirBase,
    requests, snapshots, primarySnap, metaPaths, meta,
    pendingDiff, skipVerdict,
  };
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
    await registerRun(ref.layout, meta);
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

  const { results, attempts } = await runBothSides({
    ctx: adapterCtx,
    adapters,
    requests,
    maxTransientRetries: cfg.review.retry.transient_max,
    onRetryBrief: (critic, prev) => buildRetryHint(critic, prev),
  });
  const finishedAt = new Date().toISOString();

  // ── 复算快照，判漂移 ──
  const afterTreeHash = await workTreeHash(ctx.projectRoot);
  const afterSubjectSha = await sha256File(subjectPath);

  // ── 解析 ──
  const reviews: Partial<Record<CriticId, Review | null>> = {};
  const fallbackText: Partial<Record<CriticId, string>> = {};
  for (const c of sides) {
    const r = results[c];
    if (!r || r.status !== 'ok' || !r.raw_response_text) {
      reviews[c] = null;
      continue;
    }
    const p = parseReview(r.raw_response_text);
    if (p.ok) {
      reviews[c] = p.review;
    } else {
      reviews[c] = null;
      fallbackText[c] = r.raw_response_text;
      r.status = 'parse_fallback';
      r.fail_reason = `${p.reason}${p.errors.length > 0 ? `：${p.errors.slice(0, 5).join('; ')}` : ''}`;
      warn(`${c} 侧输出未能结构化解析，转 parse_fallback：${p.reason}`);
    }
  }

  // ── guard 判定 ──
  const verdict = await judgeRun({
    cfg,
    projectRoot: ctx.projectRoot,
    archiveRootAbs: ctx.archiveRoot,
    archiveRootRel: path.relative(ctx.projectRoot, ctx.archiveRoot) || cfg.archive_root,
    before: primarySnap,
    afterTreeHash,
    afterSubjectSha256: afterSubjectSha,
    relatedPaths: opts.contextPaths,
    results, reviews, requests,
  });

  /*
   * 失败策略：配置给默认值，`--allow-single` 只在 allow_single_flag 允许时才能覆盖。
   * 若配置关掉了开关而命令行仍传了它，照 strict 执行——已在 prepareRun 里告警过。
   */
  const effectivePolicy: 'strict' | 'degrade' =
    opts.allowSingle && cfg.review.allow_single_flag ? 'degrade' : cfg.review.failure_policy;
  const mode = decideMode(results, effectivePolicy);
  const warnings = renderGuardWarnings(verdict);

  // ── 两侧齐备后同时落盘（§10.1 第 ② 道）──
  const artifacts: string[] = [];
  for (const c of sides) {
    const r = results[c];
    if (!r) continue;
    // 失败侧不产出审查文档，改在 _meta/ 记 failed.json——绝不改名冒充对方（AC-06）
    if (r.status === 'failed' || r.status === 'timeout') {
      const w = await writeMeta(
        ref.layout, stage, `review-${c}-${runId}.failed.json`,
        JSON.stringify({ critic: c, status: r.status, fail_reason: r.fail_reason, attempts: attempts[c] }, null, 2) + '\n',
      );
      metaPaths.push(w.absPath);
      continue;
    }

    const side = verdict.sides[c];
    const doc = renderReviewDoc({
      critic: c, stage, topic: ref.topic, runId, rerunIndex,
      review: reviews[c] ?? null,
      rawText: fallbackText[c] ?? null,
      result: r,
      modelRequested: requests[c]!.model,
      effort: requests[c]!.effort ?? null,
      snapshotHash: `sha256:${primarySnap.subjectSha256}`,
      startedAt, finishedAt,
      evidenceOk: side?.evidenceOk ?? false,
      projectReads: side?.projectReads ?? 0,
      degraded: mode.mode === 'single',
      drift: verdict.drift.kind !== 'none',
      peerDeny: r.peer_deny_applied,
      consultedUnverified: side?.consultedUnverified ?? true,
      heterogeneous: isHeterogeneous(r.model_effective ?? requests[c]!.model),
    });

    const written = await writeArtifact({
      layout: ref.layout, stage, role: c, writer: c,
      rerunIndex, content: doc,
    });
    artifacts.push(written.absPath);

    // 结构化原文进 _meta/，供 gate 机读与追溯
    const rj = await writeMeta(
      ref.layout, stage, `review-${c}-${runId}.json`,
      JSON.stringify(reviews[c] ?? { parse_fallback: true, raw: fallbackText[c] ?? null }, null, 2) + '\n',
    );
    metaPaths.push(rj.absPath);

    // parse_fallback 侧另存编号化的原文，让 Driver 有可逐条裁决的单元（§6.6 规则 8）
    if (reviews[c] === null && fallbackText[c]) {
      const items = enumerateFallbackFindings(fallbackText[c]!, c);
      const fb = await writeMeta(
        ref.layout, stage, `review-${c}-${runId}.fallback-items.md`,
        `# ${c} 侧解析降级：待逐条裁决的意见单元\n\n${items.map((i) => `- ${i}`).join('\n')}\n`,
      );
      metaPaths.push(fb.absPath);
    }
  }

  // ── 收尾元数据 ──
  meta.finished_at = finishedAt;
  meta.review_mode = mode.mode;
  meta.degraded_reason = mode.degradedReason;
  meta.snapshot.drift = {
    changed: verdict.drift.kind !== 'none',
    files: verdict.fingerprintChangedFiles,
    policy: verdict.drift.kind === 'related' ? cfg.review.on_drift_related : cfg.review.on_drift,
  };
  meta.guard = {
    readonly_breach: verdict.readonlyBreach,
    peer_artifact_read: verdict.peerArtifactRead,
    peer_deny_applied: Object.fromEntries(
      sides.map((c) => [c, results[c]?.peer_deny_applied ?? false]),
    ),
    forged_role_file: false,
    breached_files: verdict.breachedFiles,
  };
  for (const c of sides) {
    const r = results[c];
    if (!r) continue;
    const side = verdict.sides[c];
    meta.critics[c] = {
      vendor: c === 'gemini' ? 'antigravity' : 'zcode',
      cli_version: r.cli_version,
      model_requested: requests[c]!.model,
      model_effective: r.model_effective,
      model_effective_source: r.model_effective_source,
      ...(r.model_route ? { model_route: r.model_route } : {}),
      ...(requests[c]!.effort ? { effort: requests[c]!.effort! } : {}),
      status: r.status,
      exit_code: r.exit_code,
      duration_s: r.duration_s,
      tool_calls: { ...r.tool_calls, project_reads: side?.projectReads ?? 0 },
      evidence_ok: side?.evidenceOk ?? false,
      ...(r.usage ? { usage: r.usage } : {}),
      heterogeneous: isHeterogeneous(r.model_effective ?? requests[c]!.model),
      fail_reason: r.fail_reason,
      empty_review: (reviews[c]?.findings.length ?? -1) === 0,
      parse_fallback: r.status === 'parse_fallback',
      session_id: r.session_id,
      peer_deny_applied: r.peer_deny_applied,
    };
  }
  /*
   * 追加而非替换：prepareRun 已经把 `_meta/` 的补丁与两份 brief 登记进去了，
   * 整体覆盖会把它们挤掉，保护集又缩回只剩审查文档。
   */
  meta.artifacts = [
    ...meta.artifacts,
    ...(await Promise.all(
      artifacts.map(async (p) => ({
        path: path.relative(ctx.archiveRoot, p),
        sha256: await sha256File(p),
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
  meta.gate.state = meta.status === 'success' ? 'review_done_awaiting_disposition' : 'failed';

  await writeRunMeta(ref.layout, stage, meta);
  await registerRun(ref.layout, meta);

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
    runId, rerunIndex,
    sessionId: opts.sessionId ?? null,
    heartbeatStaleMs: cfg.review.heartbeat_stale_s * 1000,
    // 只写属于本 run 的闸门：并发的另一轮已经接管时不该被我们改写
    expect: { runId },
  });

  say('');
  say(summarizeRun(meta));

  /*
   * 双审退化提示（§9.3）。放在这里而非 `report`，是因为它只对**本次**两侧结论有意义，
   * 而 report 是跨轮复盘——真正需要看到「这次两家在看同一批地方」的人是刚跑完的 Driver。
   * report 之后会按主题做跨轮汇总，两者不冲突。
   */
  if (sides.length === 2) {
    const div = measureDivergence(reviews.gemini ?? null, reviews.glm ?? null);
    say(renderDivergence(div));
    if (div.degenerate) warnings.push('双审退化：两侧镜头重合度过高，见上方 Jaccard 提示');
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
     */
    await setGateChecked({
      triviumDir: rc.ctx.triviumDir,
      topic: rc.ref.topic, stage: rc.stage, state: 'idle', runId: rc.runId,
      heartbeatStaleMs: rc.cfg.review.heartbeat_stale_s * 1000,
      expect: { state: ['running'], runId: rc.runId, allowMissing: false },
    }).catch(() => {
      /* 回收失败不该盖过真正的错误 */
    });
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

/** 重试时追加进 BRIEF 的提示：让模型知道上一次哪里不对（§12.3） */
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
      '七个字段全部必填。'
    );
  }
  return `## 上一次尝试失败\n\n${critic} 侧上一次的失败原因：${reason}`;
}

export { TriviumError };
