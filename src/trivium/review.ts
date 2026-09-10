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
import { isHeterogeneous, routeModel, type AdapterContext } from './adapters/base.js';
import { freeze } from './freeze.js';
import { buildMustReadList, excerptSubject, extractPathReferences, loadLenses, renderBrief } from './brief.js';
import { parseReview, enumerateFallbackFindings } from './parse.js';
import { decideMode, runBothSides } from './runner.js';
import { judgeRun, renderGuardWarnings } from './guard.js';
import { renderReviewDoc } from './render.js';
import { resolveTopic, locateSubject } from './topic.js';
import { resolveRerunIndex, writeArtifact, writeMeta, metaDir } from './archive.js';
import { newRunId, newRunMeta, registerRun, summarizeRun, writeRunMeta } from './meta.js';
import { runRoot } from './config.js';
import { ensureDir, sha256, sha256File } from './util/fsx.js';
import { workTreeHash } from './util/git.js';
import { EXIT, envError, TriviumError } from './exit-codes.js';
import { say, step, warn } from './util/log.js';

/** 运行目录按仓库路径哈希分桶，避免不同项目互相覆盖 */
export function repoId(projectRoot: string): string {
  return `${path.basename(projectRoot)}-${sha256(projectRoot).slice(0, 8)}`;
}

export interface ReviewOptions {
  ctx: Ctx;
  stage: Stage;
  topic: string;
  promptHint: string | null;
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
}

export interface ReviewOutcome {
  runId: string;
  rerunIndex: number;
  artifacts: string[];
  metaPaths: string[];
  warnings: string[];
  exitCode: number;
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
  ref: Awaited<ReturnType<typeof resolveTopic>>;
  adapterCtx: AdapterContext;
  adapters: Record<CriticId, typeof agyAdapter | typeof zcodeAdapter>;
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

  const adapters = { gemini: agyAdapter, glm: zcodeAdapter } as const;
  const adapterCtx: AdapterContext = {
    cfg,
    nodePath: cfg.runtime.node ?? process.execPath,
  };

  // ── 可用性检查：不可用就别开工，避免产生半套工件（AC-16 的精神）──
  const sides: CriticId[] = opts.onlyCritic ? [opts.onlyCritic] : [...CRITICS];
  for (const c of sides) {
    const av = adapters[c].availability(adapterCtx);
    if (!av.ok) throw envError(`${c} 侧不可用：${av.reason}`);
  }
  if (sides.length < 2) {
    warn(`只跑 ${sides.join('/')} 一侧：这不是双审，结果会被标为降级。仅供调试使用。`);
  }

  const ref = await resolveTopic(ctx, opts.topic, stage);
  const rerunIndex = await resolveRerunIndex(ref.layout, stage);
  const runId = newRunId();

  // ── 被审对象 ──
  const subjectPath = await locateSubject(ref, opts.subjectFile, ctx.projectRoot);
  const subjectText = await fs.readFile(subjectPath, 'utf8');

  step(`主题 ${ref.topic} ｜ 阶段 ${stage} ｜ 第 ${rerunIndex} 轮 ｜ run ${runId}`);
  step(`被审对象 ${path.relative(ctx.projectRoot, subjectPath)}`);

  // ── 运行目录（项目外，§10.1 第 ② 道）──
  const runDirBase = path.join(runRoot(cfg), repoId(ctx.projectRoot), runId);
  await ensureDir(runDirBase);

  const lenses = await loadLenses(lensesPath);
  const mustRead = await buildMustReadList(cfg, ctx.projectRoot, ref.topic, opts.contextPaths);
  const suggestedRead = extractPathReferences(subjectText);
  const excerpt = excerptSubject(subjectText);

  // ── 冻结 + 送审包（禁读清单逐侧不同：屏蔽的是**对方**的历史产出）──
  const snapshots: Partial<Record<CriticId, Awaited<ReturnType<typeof freeze>>>> = {};
  const requests: Partial<Record<CriticId, CriticRequest>> = {};
  const metaPaths: string[] = [];

  for (const critic of sides) {
    const snap = await freeze({
      cfg,
      projectRoot: ctx.projectRoot,
      archiveRoot: ctx.archiveRoot,
      stage,
      critic,
      subjectPath,
    });
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
      schemaPath, lenses,
      taskGoal: null,
      minToolCalls: cfg.review.min_tool_calls[stage],
      minProjectReads: cfg.review.min_project_reads[stage],
    });

    // BRIEF 落归档 _meta/（它本身就是审计材料，AC-17）
    const briefFile = `brief-${critic}-${runId}.md`;
    const w = await writeMeta(ref.layout, stage, briefFile, briefText);
    metaPaths.push(w.absPath);

    requests[critic] = {
      run_id: runId, topic: ref.topic, stage, critic,
      project_root: ctx.projectRoot,
      subject_path: subjectPath,
      deny_paths: snap.denyPaths,
      out_dir: path.join(runDirBase, critic, 'out'),
      brief_path: w.absPath,
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

  // ── run.json 骨架（status: running），崩溃后也能取证 ──
  const meta = newRunMeta({
    runId, topic: ref.topic, stage, rerunIndex,
    command: opts.command,
    promptHint: opts.promptHint,
    treeHash: primarySnap.treeHash,
    gitHead: primarySnap.gitHead,
    dirty: primarySnap.dirty,
    subjectSha256: primarySnap.subjectSha256,
    denyPaths: primarySnap.denyPaths,
    driftPolicy: cfg.review.on_drift,
  });
  await writeRunMeta(ref.layout, stage, meta);
  await registerRun(ref.layout, meta);

  return {
    opts, cfg, ctx, stage, ref, adapterCtx, adapters, sides,
    runId, rerunIndex, subjectPath, runDirBase,
    requests, snapshots, primarySnap, metaPaths, meta,
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
    runId, rerunIndex, subjectPath, requests, primarySnap, metaPaths, meta,
  } = rc;
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

  const mode = decideMode(results, cfg.review.failure_policy);
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
  meta.artifacts = await Promise.all(
    artifacts.map(async (p) => ({
      path: path.relative(ctx.archiveRoot, p),
      sha256: await sha256File(p),
    })),
  );

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

  say('');
  say(summarizeRun(meta));
  if (warnings.length > 0) {
    say('');
    for (const w of warnings) warn(w);
  }
  say('');
  say('已落盘：');
  for (const a of artifacts) say(`  ${path.relative(ctx.projectRoot, a)}`);
  say(`  ${path.relative(ctx.projectRoot, metaDir(ref.layout, stage))}/ （${metaPaths.length} 份审计材料）`);

  return { runId, rerunIndex, artifacts, metaPaths, warnings, exitCode };
}

/** 己方历史产出与 Driver 对它的裁决（§9.4 第 4 段最后一条） */

/** 同步路径（M1 行为）：准备 + 执行一气做完。长时运行请用 `--start` / `--wait` */
export async function runReview(opts: ReviewOptions): Promise<ReviewOutcome> {
  const rc = await prepareRun(opts);
  return executeRun(rc);
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
