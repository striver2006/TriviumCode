/**
 * `trivium` 命令行入口（设计 §5.1 `cli` 模块 / §7.3 退出码约定）。
 *
 * 职责严格限定为：子命令解析、退出码约定、人读与 `--json` 机读输出。
 * **不做任何业务判定**——所有判定都在各自模块里。
 */
import { EXIT, TriviumError, usageError } from './exit-codes.js';
import { loadCtx } from './config.js';
import { runDoctor, renderDoctorReport } from './doctor.js';
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

  trivium --version
  trivium --help

退出码：0 成功 / 1 一般失败 / 2 闸门阻断 / 64 参数错误 / 65 前置产物缺失
        69 环境或预检失败 / 70 主题被锁 / 73 运行仍在进行 / 75 严格模式中止
`;

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
