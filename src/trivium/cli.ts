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
import { STAGES, type CriticId, type Stage } from './types.js';
import { emitJson, fail, isJsonMode, say, setOutputMode } from './util/log.js';

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

  trivium review --stage plan|code|bug --topic <主题> [--focus <提示语>]
                 [--context <路径,…>] [--plan-file <路径>] [--rca-file <路径>]
                 [--model-gemini <slug>] [--model-glm <id>] [--json]
      跑一次双审：冻结送审包 → 并行拉起两侧 → 复算快照 → 解析 → 核验 → 两侧齐备后同时落盘。
      --focus     审查焦点提示语。命令 B/C/D 必填（FR-20）
      --context   被审对象涉及的代码路径与相关文档，逗号分隔；并入必读清单
      --only      仅跑一侧（调试用，结果会被标为降级——这不是双审）

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

  const out = await runReview({
    ctx,
    stage,
    topic,
    promptHint: focus,
    contextPaths: contextRaw ? contextRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
    subjectFile: flagString(args, 'plan-file') ?? flagString(args, 'rca-file'),
    modelOverrides,
    command: `trivium review --stage ${stage}`,
    onlyCritic: (onlyRaw as CriticId | null) ?? null,
  });

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
