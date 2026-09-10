/**
 * `trivium` 命令行入口（设计 §5.1 `cli` 模块 / §7.3 退出码约定）。
 *
 * 职责严格限定为：子命令解析、退出码约定、人读与 `--json` 机读输出。
 * **不做任何业务判定**——所有判定都在各自模块里。
 */
import { EXIT, TriviumError, usageError } from './exit-codes.js';
import { loadCtx } from './config.js';
import { runDoctor, renderDoctorReport } from './doctor.js';
import { runReview } from './review.js';
import { cancelRun, startRun, statusRun, waitRun, workerMain } from './run-protocol.js';
import { STAGES, type CriticId, type Stage } from './types.js';
import { emitJson, fail, isJsonMode, say, setOutputMode, warn } from './util/log.js';

const VERSION = '0.1.0';

interface ParsedArgs {
  command: string;
  sub: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
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

  return { command: positional[0] ?? '', sub: positional.slice(1), flags };
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
