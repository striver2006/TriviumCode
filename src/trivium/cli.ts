/**
 * `trivium` 命令行入口（设计 §5.1 `cli` 模块 / §7.3 退出码约定）。
 *
 * 职责严格限定为：子命令解析、退出码约定、人读与 `--json` 机读输出。
 * **不做任何业务判定**——所有判定都在各自模块里。
 */
import path from 'node:path';
import { EXIT, TriviumError, usageError, missingArtifact as missingArtifactError } from './exit-codes.js';
import { loadCtx } from './config.js';
import { runDoctor, renderDoctorReport } from './doctor.js';
import { runReview } from './review.js';
import { collectCommands, runVerify, summarizeVerify } from './verify.js';
import { cancelRun, startRun, statusRun, waitRun, workerMain } from './run-protocol.js';
import {
  checkAdjudication, inferLatestRunId, loadRoundReviews, renderGateResult,
} from './gate.js';
import { checkStageArtifacts, resolveRerunIndex } from './archive.js';
import { readHookInput, runHook, type HookName } from './hooks.js';
import { listOpenGates, setGate } from './state.js';
import { recordApproval } from './approval.js';
import { resolveTopic, listTopics } from './topic.js';
import { newRunId, readTask } from './meta.js';
import { runInit, renderInitReport } from './init.js';
import {
  commitAuthCache, parsePreflightScope, renderPreflight, runPreflight,
} from './preflight.js';
import { resolveTopicArgs } from './topic-args.js';
import { STAGES, type CriticId, type Stage } from './types.js';
import { emitJson, fail, isJsonMode, say, setOutputMode, step, warn } from './util/log.js';

const VERSION = '0.1.0';

interface ParsedArgs {
  command: string;
  sub: string[];
  flags: Map<string, string | boolean>;
  /**
   * `--` 之后的全部内容，原样拼回一个字符串。
   *
   * 存在的理由：`topic resolve` 要接收 skill 的整串 `$ARGUMENTS`，而它本身以
   * `--topic …` 开头。用 `--args <值>` 传会被下面的「值不能以 -- 开头」规则误判成
   * 布尔标志——真跑时踩过。`--` 终止符让这种值可以无歧义地传进来。
   */
  trailing: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let trailing = '';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    // `--` 之后的一切都不再解析，整体作为 trailing
    if (a === '--') {
      trailing = argv.slice(i + 1).join(' ');
      break;
    }

    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, true);
    }
  }

  return { command: positional[0] ?? '', sub: positional.slice(1), flags, trailing };
}

const USAGE = `trivium ${VERSION} — Driver-DualCritic 主攻双审流水线编排器

用法：
  trivium doctor [--json] [--no-model-calls] [--only agy|zcode|env]
      本机能力探针。实测两家 CLI 的真实能力并回填 .trivium/config.local.yaml 的 probe: 段。
      --no-model-calls  只做静态探测，不消耗厂商配额
      --only            只探测指定一侧

  trivium review --stage plan|code|bug --topic <主题> --focus <提示语> [选项]
      **同步**跑一次双审。仅供手工调试：一次运行墙钟可达 30~40 分钟，
      远超 Driver 的 Bash 工具超时，从 skill 里必须改用 --start/--wait。
      --focus     审查焦点提示语。命令 B/C/D 必填（FR-20）
      --context   被审对象涉及的代码路径与相关文档，逗号分隔；并入必读清单
      --plan-file / --rca-file  显式指定被审对象
      --model-gemini <slug> / --model-glm <id>  本次模型覆盖
      --only gemini|glm  仅跑一侧（调试用，会被标为降级——这不是双审）

  trivium review --start --stage <s> --topic <主题> --focus <提示语> [同上选项] [--json]
      冻结送审包 → 派生工作进程 → **立即返回** run_id 与 max_waits。
      返回的 bash_timeout_ms 是 skill 必须为每次 --wait 设置的工具级超时。

  trivium review --wait <run_id> [--timeout <秒>] [--json]
      轮询到完成或本次窗口用尽。退出码 73 表示仍在运行（**不是失败**），
      打印进度后继续下一次 --wait。

  trivium review --status <run_id> [--json]    只读一次状态，不等待
  trivium review --cancel <run_id>             取消运行并回收主题锁

  trivium preflight --stage plan|code|bug|all [--json] [--skip-auth-check] [--refresh-auth]
      启动预检（FR-18 / AC-16）。失败时**不产生任何工件**。
      --stage all   命令 A 用：校验全部三阶段的模型 slug + 编译测试命令已配置
      --refresh-auth  强制重新探活，穿透 TTL 缓存

  trivium topic resolve --stage <s> -- <整串 $ARGUMENTS>   [--json]
      解析主题、提示语、被审对象与模型覆盖。**纯只读**，不创建任何目录。
      用 -- 终止符传原始参数串：它本身以 --topic 开头，用 --args <值> 会有歧义。

  trivium verify --topic <主题> [--only build|test] [--timeout <秒>] [--json]
      执行 .trivium/config.yaml 中 verify.build / verify.test **显式声明**的命令，
      落盘 verify/<日期>-<主题>-verify.md 与 _meta/verify-<run_id>.json（FR-21 / AC-10）。
      两组都没配时退 64——「什么都没跑」不是「通过」。
      构建失败即不再跑测试：测试几乎必然连带失败，只会埋掉真正的根因。

  trivium init [--dry-run] [--asset-root <路径>]
      在本项目布置运行时：.trivium/（config.yaml + bin/trivium wrapper）、
      合并 Hook 进 .claude/settings.json、幂等追加 .gitignore 与协议片段。
      全部操作幂等，重复运行不重复追加、不覆盖用户内容。

  trivium gate --stage <s> --topic <主题> --check [--run-id <id>] [--json]
      裁决完整性硬校验（§8.6）。返回 2 表示未通过，stdout 给出缺口清单供直接修补。
      --check-artifacts   改为校验该阶段最低工件集（§6.3）
      --await-approval    置闸门为 awaiting_approval 并输出停点话术

  trivium gate hook-pre-write | hook-pre-commit | hook-stop | hook-session-start
      Claude Code Hook 入口，从 stdin 读事件。**不应由人直接调用。**
      退出码：0 放行或判定不了 ｜ 2 明确判定拦截 ｜ 1 程序缺陷（非阻断）

  trivium approve --topic <主题> --stage <s> [--reject --reason <理由>]
  trivium abandon --topic <主题> [--stage <s>] [--reason <理由>]
      人工审批 / 放弃闸门。三种结论均解除业务写锁，工件一律保留。

  trivium status [--topic <主题>] [--json]
      打印闸门、运行、降级与争议。

  trivium --version
  trivium --help

退出码：0 成功 / 1 一般失败 / 2 闸门阻断 / 64 参数错误 / 65 前置产物缺失
        69 环境或预检失败 / 70 主题被锁 / 73 运行仍在进行 / 75 严格模式中止
`;

function flagString(args: ParsedArgs, name: string): string | null {
  const v = args.flags.get(name);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseStage(args: ParsedArgs): Stage {
  const raw = flagString(args, 'stage');
  if (!raw) throw usageError(`缺少 --stage，取值范围：${STAGES.join(' | ')}`);
  if (!(STAGES as readonly string[]).includes(raw)) {
    throw usageError(`--stage 只接受 ${STAGES.join(' | ')}，收到：${raw}`);
  }
  return raw as Stage;
}

async function cmdReview(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();

  // ── 工作进程模式：不应由人直接调用 ──
  const workerId = flagString(args, 'worker');
  if (workerId) return workerMain(ctx, workerId);

  // ── 只读/控制类子命令：只需要 run_id ──
  const waitId = flagString(args, 'wait');
  if (waitId) {
    const timeoutS = Number.parseInt(flagString(args, 'timeout') ?? '', 10);
    const out = await waitRun(
      ctx,
      waitId,
      Number.isFinite(timeoutS) && timeoutS > 0 ? timeoutS : ctx.config.review.wait_timeout_s,
    );
    if (isJsonMode()) {
      emitJson({
        ok: out.exitCode === EXIT.OK,
        still_running: out.exitCode === EXIT.STILL_RUNNING,
        run_id: waitId,
        phase: out.status?.phase ?? null,
        artifacts: out.status?.artifacts ?? [],
        message: out.status?.message ?? null,
        progress: out.progress,
      });
    } else {
      say(out.progress);
    }
    return out.exitCode;
  }

  const statusId = flagString(args, 'status');
  if (statusId) {
    const out = await statusRun(ctx, statusId);
    if (isJsonMode()) {
      emitJson({
        ok: out.exitCode === EXIT.OK,
        run_id: statusId,
        phase: out.status?.phase ?? null,
        status: out.status,
        progress: out.progress,
      });
    } else {
      say(out.progress);
    }
    return out.exitCode;
  }

  const cancelId = flagString(args, 'cancel');
  if (cancelId) return cancelRun(ctx, cancelId);

  // ── 启动类：需要完整参数 ──
  const stage = parseStage(args);

  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('缺少 --topic。主题名规则见设计 §6.1');

  const focus = flagString(args, 'focus');
  // FR-20 / §7.3：B/C/D 缺提示语一律拒绝启动，退出码 64
  if (!focus) {
    throw usageError(
      '缺少 --focus：命令 B/C/D 必须携带审查焦点提示语（FR-20）。' +
        '提示语会逐字进入两侧送审材料，是 AC-09 的验收落点。',
    );
  }

  const onlyRaw = flagString(args, 'only');
  if (onlyRaw && onlyRaw !== 'gemini' && onlyRaw !== 'glm') {
    throw usageError(`--only 只接受 gemini | glm，收到：${onlyRaw}`);
  }

  const contextRaw = flagString(args, 'context');
  const modelOverrides: Partial<Record<CriticId, string>> = {};
  const mg = flagString(args, 'model-gemini');
  const mz = flagString(args, 'model-glm');
  if (mg) modelOverrides.gemini = mg;
  if (mz) modelOverrides.glm = mz;

  const reviewOpts = {
    ctx,
    stage,
    topic,
    promptHint: focus,
    contextPaths: contextRaw ? contextRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
    subjectFile: flagString(args, 'plan-file') ?? flagString(args, 'rca-file'),
    modelOverrides,
    command: `trivium review --stage ${stage}`,
    onlyCritic: (onlyRaw as CriticId | null) ?? null,
  };

  // ── --start：派生后立即返回 ──
  if (args.flags.get('start') === true) {
    const st = await startRun({ ...reviewOpts, command: `trivium review --start --stage ${stage}` });
    if (isJsonMode()) {
      emitJson({
        ok: true,
        run_id: st.runId,
        max_waits: st.maxWaits,
        wait_timeout_s: st.waitTimeoutS,
        // skill 必须用这个值设置每次 --wait 的 Bash 工具超时（GLM-02）
        bash_timeout_ms: st.bashTimeoutMs,
        worker_pid: st.workerPid,
        run_dir: st.runDir,
      });
    } else {
      say(`已启动运行 ${st.runId}（工作进程 pid ${st.workerPid}）`);
      say(`  请循环调用：trivium review --wait ${st.runId} --timeout ${st.waitTimeoutS}`);
      say(`  循环上限 ${st.maxWaits} 次；每次调用的 Bash 工具超时须设为 ${st.bashTimeoutMs}ms`);
      say(`  运行目录 ${st.runDir}`);
    }
    return EXIT.OK;
  }

  // ── 同步路径（手工调试）──
  warn(
    '同步模式：一次运行墙钟可达 30~40 分钟，会超出 Driver 的 Bash 工具超时。' +
      '从 skill 调用请改用 --start / --wait。',
  );
  const out = await runReview(reviewOpts);

  if (isJsonMode()) {
    emitJson({
      ok: out.exitCode === EXIT.OK,
      run_id: out.runId,
      rerun_index: out.rerunIndex,
      artifacts: out.artifacts,
      meta: out.metaPaths,
      warnings: out.warnings,
    });
  }
  return out.exitCode;
}

async function cmdDoctor(args: ParsedArgs): Promise<number> {
  // doctor 要能在尚未 init 的项目里跑——它本来就是 init 的前置
  const ctx = await loadCtx({ allowUninitialized: true });

  const onlyRaw = args.flags.get('only');
  const only =
    typeof onlyRaw === 'string' && ['agy', 'zcode', 'env'].includes(onlyRaw)
      ? (onlyRaw as 'agy' | 'zcode' | 'env')
      : null;
  if (onlyRaw !== undefined && only === null) {
    throw usageError(`--only 只接受 agy | zcode | env，收到：${String(onlyRaw)}`);
  }

  const report = await runDoctor({
    projectRoot: ctx.projectRoot,
    triviumDir: ctx.triviumDir,
    config: ctx.config,
    skipModelCalls: args.flags.get('no-model-calls') === true,
    only,
  });

  if (isJsonMode()) {
    emitJson({
      ok: report.blockers.length === 0,
      probe: report.probe,
      notes: report.notes,
      blockers: report.blockers,
    });
  } else {
    renderDoctorReport(report);
  }

  return report.blockers.length === 0 ? EXIT.OK : EXIT.ENV;
}

async function cmdPreflight(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const scope = parsePreflightScope(flagString(args, 'stage'));

  const modelOverrides: Partial<Record<CriticId, string>> = {};
  const mg = flagString(args, 'model-gemini');
  const mz = flagString(args, 'model-glm');
  if (mg) modelOverrides.gemini = mg;
  if (mz) modelOverrides.glm = mz;

  const r = await runPreflight({
    ctx,
    scope,
    modelOverrides,
    skipAuthCheck: args.flags.get('skip-auth-check') === true,
    refreshAuth: args.flags.get('refresh-auth') === true,
  });
  // 只有通过才写探活缓存——否则「预检失败」会留下写入，AC-16 字面不成立（GLM-05）
  await commitAuthCache(ctx, r);

  if (isJsonMode()) {
    emitJson({
      ok: r.ok,
      scope: r.scope,
      checks: r.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      exit_code: r.exitCode,
    });
  } else {
    say(renderPreflight(r));
  }
  return r.ok ? EXIT.OK : r.exitCode;
}

async function cmdTopic(args: ParsedArgs): Promise<number> {
  if (args.sub[0] !== 'resolve') {
    throw usageError(`topic 只支持 resolve 子命令，收到：${args.sub[0] ?? '(空)'}`);
  }
  const ctx = await loadCtx();
  const scope = parsePreflightScope(flagString(args, 'stage'));
  /*
   * 三种传法都支持，优先级：`--` 终止符 > `--args=<值>` > `--args <值>`。
   * skill 用 `--` 形式最稳——整串 $ARGUMENTS 以 `--topic` 开头时另两种会歧义。
   */
  const rawArgs = args.trailing || flagString(args, 'args') || '';
  if (rawArgs.length === 0) {
    throw usageError(
      'topic resolve 需要原始参数串。推荐写法：\n' +
        '  trivium topic resolve --stage plan -- <整串 $ARGUMENTS>',
    );
  }

  const r = await resolveTopicArgs({ ctx, scope, rawArgs });
  if (isJsonMode()) {
    emitJson({ ok: true, ...r });
  } else {
    say(`主题 ${r.topic}${r.topic_inferred ? '（由任务目标推导，请确认）' : ''}`);
    say(`提示语 ${r.prompt_hint ?? '(无)'}`);
    say(`被审对象 ${r.subject_path ?? (r.base ? `git diff ${r.base}` : '(本阶段无单一被审文件)')}`);
    if (r.context_paths.length > 0) say(`必读路径 ${r.context_paths.join(', ')}`);
    for (const n of r.notes) step(n);
  }
  return EXIT.OK;
}

async function cmdInit(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx({ allowUninitialized: true });
  const dryRun = args.flags.get('dry-run') === true;
  const report = await runInit({
    ctx,
    dryRun,
    ...(flagString(args, 'asset-root') ? { assetRoot: flagString(args, 'asset-root')! } : {}),
  });
  if (isJsonMode()) emitJson({ ok: true, dry_run: dryRun, ...report });
  else renderInitReport(report, dryRun);
  return EXIT.OK;
}

const HOOK_NAMES: readonly HookName[] = [
  'hook-pre-write', 'hook-pre-commit', 'hook-stop', 'hook-session-start',
];

async function cmdGate(args: ParsedArgs): Promise<number> {
  // ── Hook 入口 ──
  const sub = args.sub[0];
  if (sub && (HOOK_NAMES as readonly string[]).includes(sub)) {
    const input = await readHookInput();
    const out = await runHook(sub as HookName, () => loadCtx({ allowUninitialized: true }), input);
    if (out.json) process.stdout.write(JSON.stringify(out.json) + '\n');
    if (out.stderr) process.stderr.write(out.stderr + '\n');
    return out.exitCode;
  }

  const ctx = await loadCtx();
  const stage = parseStage(args);
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('gate 需要 --topic');
  const ref = await resolveTopic(ctx, topic, stage);

  // 本轮轮次：已产出审查工件的最新一轮，即 resolveRerunIndex - 1
  const nextIndex = await resolveRerunIndex(ref.layout, stage);
  const rerunIndex = Math.max(1, nextIndex - 1);

  // ── --check-artifacts ──
  if (args.flags.get('check-artifacts') === true) {
    const c = await checkStageArtifacts(ref.layout, stage, rerunIndex);
    if (isJsonMode()) {
      emitJson({ ok: c.ok, stage, rerun_index: rerunIndex, present: c.present, missing: c.missing });
    } else if (c.ok) {
      say(`✓ ${stage} 阶段第 ${rerunIndex} 轮工件齐备：${c.present.join(' / ')}`);
    } else {
      fail(`${stage} 阶段第 ${rerunIndex} 轮缺件：${c.missing.join(' / ')}`);
    }
    return c.ok ? EXIT.OK : EXIT.MISSING_ARTIFACT;
  }

  // ── --await-approval ──
  if (args.flags.get('await-approval') === true) {
    const runId = flagString(args, 'run-id') ?? (await inferLatestRunId(ref.layout, stage, rerunIndex));
    await setGate({
      triviumDir: ctx.triviumDir, topic, stage, state: 'awaiting_approval',
      runId, rerunIndex,
      sessionId: flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? null,
      heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
    });
    const msg =
      `已置为等待人工审批：${topic} / ${stage}（第 ${rerunIndex} 轮）\n` +
      `  通过：/dual-approve --topic ${topic} --stage ${stage}\n` +
      `  拒绝：/dual-approve --topic ${topic} --stage ${stage} --reject --reason <理由>\n` +
      `  放弃：/dual-abandon --topic ${topic}\n` +
      `  在此期间不得修改业务文件（Hook 会拦下）。`;
    if (isJsonMode()) emitJson({ ok: true, state: 'awaiting_approval', stage, rerun_index: rerunIndex, message: msg });
    else say(msg);
    return EXIT.OK;
  }

  // ── --check（默认）──
  const runId = flagString(args, 'run-id') ?? (await inferLatestRunId(ref.layout, stage, rerunIndex));
  if (!runId) {
    throw missingArtifactError(
      `找不到 ${stage} 阶段第 ${rerunIndex} 轮的 run_id。请先跑一次双审，或用 --run-id 指定。`,
    );
  }
  const { reviews, notes } = await loadRoundReviews(ref.layout, stage, runId);
  for (const n of notes) step(n);

  const result = await checkAdjudication({
    cfg: ctx.config, layout: ref.layout, stage, rerunIndex, reviews,
    degraded: Object.values(reviews).some((r) => r === undefined),
  });

  if (isJsonMode()) {
    emitJson({
      ok: result.ok,
      stage, rerun_index: rerunIndex, run_id: runId,
      failures: result.failures,
      warnings: result.warnings,
      structured_ids: result.structuredIds,
      fallback_ids: result.fallbackIds,
      disposition: result.dispositionPath,
    });
  } else {
    say(renderGateResult(result));
  }
  // 返回 2 让调用方（skill / Hook）能按闸门语义处理
  return result.ok ? EXIT.OK : EXIT.GATE_BLOCK;
}

async function cmdApproval(
  args: ParsedArgs,
  fallbackDecision: 'approved' | 'abandoned',
): Promise<number> {
  const ctx = await loadCtx();
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('需要 --topic');

  const decision =
    fallbackDecision === 'approved' && args.flags.get('reject') === true ? 'rejected' : fallbackDecision;

  // abandon 不带 --stage 时，放弃该主题下全部未关闭闸门
  const stageRaw = flagString(args, 'stage');
  const stages: Stage[] = stageRaw
    ? [parseStage(args)]
    : (await listOpenGates(ctx.triviumDir)).filter((g) => g.topic === topic).map((g) => g.stage);

  if (stages.length === 0) {
    throw missingArtifactError(`主题「${topic}」没有未关闭的闸门`);
  }

  for (const stage of stages) {
    const out = await recordApproval({
      ctx, topic, stage, decision,
      reason: flagString(args, 'reason'),
    });
    say(out.message);
  }
  if (isJsonMode()) emitJson({ ok: true, topic, stages, decision });
  return EXIT.OK;
}

async function cmdVerify(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('verify 需要 --topic');
  const ref = await resolveTopic(ctx, topic, 'plan');

  const onlyRaw = flagString(args, 'only');
  if (onlyRaw && onlyRaw !== 'build' && onlyRaw !== 'test') {
    throw usageError(`--only 只接受 build 或 test，收到「${onlyRaw}」`);
  }
  const only = (onlyRaw as 'build' | 'test' | null) ?? null;

  const planned = collectCommands(ctx.config, only);
  if (planned.length === 0) {
    /*
     * 不直接抛 usageError：§14.2 要求把「未配置」也落成一份记录，
     * 否则事后看归档会以为这一步从未发生过。落盘后再以 64 退出。
     */
    warn('verify.build 与 verify.test 均未配置，本次什么也不会执行——这不等于通过。');
  }

  const timeoutRaw = Number(flagString(args, 'timeout') ?? '');
  const runId = newRunId();
  const out = await runVerify({
    ctx,
    layout: ref.layout,
    runId,
    only,
    ...(Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? { timeoutS: timeoutRaw } : {}),
    onProgress: (l) => say(l),
  });

  if (isJsonMode()) {
    emitJson({
      ok: out.exitCode === EXIT.OK,
      run_id: runId,
      status: out.record.status,
      unconfigured: out.record.unconfigured,
      commands: out.record.commands.map((c) => ({
        cmd: c.cmd, group: c.group, exit_code: c.exit_code, duration_s: c.duration_s,
      })),
      artifact: out.artifactPath,
      meta: out.metaPath,
    });
  } else {
    say('');
    say(`编译测试：${summarizeVerify(out.record)}`);
    say('已落盘：');
    say(`  ${path.relative(ctx.projectRoot, out.artifactPath)}`);
    say(`  ${path.relative(ctx.projectRoot, out.metaPath)}`);
    if (out.record.unconfigured) {
      fail('未配置编译测试命令：请运行 `trivium init` 或 `trivium doctor --suggest-verify` 后重试。');
    }
  }
  return out.exitCode;
}

async function cmdStatus(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const only = flagString(args, 'topic');
  const gates = await listOpenGates(ctx.triviumDir);
  const topics = only ? [only] : await listTopics(ctx);

  const payload: Record<string, unknown>[] = [];
  for (const t of topics) {
    const task = await readTask({ archiveRoot: ctx.archiveRoot, topic: t });
    const g = gates.filter((x) => x.topic === t);
    payload.push({
      topic: t,
      open_gates: g.map((x) => ({ stage: x.stage, state: x.state, since: x.since })),
      runs: task.runs.length,
      degradations: task.degradations.length,
      disputed: task.disputed,
      approvals: task.approvals.length,
    });
  }

  if (isJsonMode()) {
    emitJson({ ok: true, topics: payload });
  } else if (payload.length === 0) {
    say('归档根下还没有任何主题。');
  } else {
    for (const p of payload) {
      const gs = p['open_gates'] as { stage: string; state: string; since: string }[];
      say(`主题 ${String(p['topic'])}`);
      say(
        `  运行 ${String(p['runs'])} 次 ｜ 降级 ${String(p['degradations'])} 次 ｜ ` +
          `审批记录 ${String(p['approvals'])} 条${p['disputed'] ? ' ｜ ⚠️ 有争议项' : ''}`,
      );
      if (gs.length === 0) say('  无未关闭闸门');
      else for (const x of gs) say(`  · ${x.stage}: ${x.state}（自 ${x.since}）`);
    }
  }
  return EXIT.OK;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  setOutputMode({ json: args.flags.get('json') === true, quiet: args.flags.get('quiet') === true });

  if (args.flags.get('version') === true || args.command === 'version') {
    say(VERSION);
    return EXIT.OK;
  }
  if (args.flags.get('help') === true || args.command === '' || args.command === 'help') {
    say(USAGE);
    return EXIT.OK;
  }

  switch (args.command) {
    case 'doctor':
      return cmdDoctor(args);
    case 'review':
      return cmdReview(args);
    case 'init':
      return cmdInit(args);
    case 'preflight':
      return cmdPreflight(args);
    case 'topic':
      return cmdTopic(args);
    case 'gate':
      return cmdGate(args);
    case 'approve':
      return cmdApproval(args, 'approved');
    case 'abandon':
      return cmdApproval(args, 'abandoned');
    case 'verify':
      return cmdVerify(args);
    case 'status':
      return cmdStatus(args);
    default:
      throw usageError(`未知子命令：${args.command}\n\n${USAGE}`);
  }
}

// esbuild 打包为 CJS 后作为脚本直接执行
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof TriviumError) {
      fail(err.message);
      process.exitCode = err.code;
    } else {
      fail(`内部错误：${(err as Error).message}`);
      if (process.env['TRIVIUM_DEBUG']) console.error(err);
      process.exitCode = EXIT.FAIL;
    }
  });
