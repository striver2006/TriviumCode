/**
 * ZCode 适配器（设计 §11.3）。
 *
 * M0 实测把设计里的若干假设推翻了，这里按实测结论实现：
 *   - **没有裸 `ZCODE_MODEL` 环境变量**（0.16.5）。模型覆盖三档的 `env` 档作废，
 *     只能靠独立 `HOME` 下的 `<home>/.zcode/cli/config.json` 副本（`config_copy`）。
 *   - **`--settings` 参数被拒绝**，不能用它注入独立配置。
 *   - `ZCODE_HOME` / `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` 对配置解析**无效**，
 *     只有 `HOME` 生效。
 *   - **`--mode plan` 不阻止命令执行**，完整 denylist 中 `Bash` 是必需项。
 *   - stdout **不是纯 JSON**（前面有 AI SDK 告警行），必须抠 envelope。
 *   - envelope **没有 model 字段**，生效模型只能从日志/rollout 回读。
 *   - 轨迹需要**两个**文件：日志给工具名与状态，rollout 给工具参数（路径）。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type { CriticRequest, CriticResult } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir, exists, sha256File } from '../util/fsx.js';
import {
  parseZcodeEnvelope,
  parseZcodeRollout,
  parseZcodeTrace,
  type ZcodeEnvelope,
} from './zcode-trace.js';
import {
  failedResult,
  TOOL_TRACE_CAPABILITY,
  type AdapterContext,
  type CarrierScrub,
  type CriticAdapter,
} from './base.js';
import { scanAndRemoveSecrets } from '../scrub.js';

/**
 * 把 profile 里的人类可读短名补全为 `<providerId>/<modelName>` 全限定形态。
 *
 * 为什么需要（坑 P-06 / 冲突项 C-02）：配置里写 `GLM-5.3` 更易读，但 ZCode 实测
 * 传裸模型名会落到错误 provider 并报 "Model provider is missing an API key"。
 * providerId 从探针回读的 `model_id_form` 取——不硬编码，因为它随用户的 provider 配置而变。
 */
export function qualifyZcodeModel(model: string | null, modelIdForm: string | null): string | null {
  if (!model) return null;
  if (model.includes('/')) return model; // 已是全限定形态
  if (!modelIdForm || !modelIdForm.includes('/')) return model; // 探针没给出前缀，只能原样传
  const providerId = modelIdForm.slice(0, modelIdForm.lastIndexOf('/'));
  return `${providerId}/${model}`;
}

/** 完整只读 denylist。`Bash` 必须在列——`--mode plan` 挡不住命令执行（M0 实测） */
/** 写类工具 + shell + 出网：审查员不该把被审代码发到外部端点 */
export const ZCODE_READONLY_DENYLIST = 'Write,Edit,MultiEdit,ApplyPatch,NotebookEdit,Bash,WebFetch,WebSearch';

export interface ZcodeInvokeOptions {
  entry: string;
  node: string;
  cwd: string;
  prompt: string;
  /** 探针实测被接受的只读参数（argv 形态） */
  readonlyArgs: string[];
  /** 独立 HOME：模型覆盖与配置隔离的唯一落点 */
  homeDir?: string | null;
  timeoutMs: number;
}

export interface ZcodeInvokeOutcome {
  envelope: ZcodeEnvelope | null;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  commandLine: string;
  durationMs: number;
  failureKind: 'none' | 'model_config_missing' | 'provider_not_configured' | 'other';
}

/** zcode 的 argv 拼装。纯函数，与执行分离，让 M0 调用配方有回归测试 */
export function buildZcodeArgs(opts: Pick<ZcodeInvokeOptions, 'entry' | 'prompt' | 'cwd' | 'readonlyArgs'>): string[] {
  return [
    opts.entry,
    '--prompt', opts.prompt,
    '--cwd', opts.cwd,
    '--json', '--no-color',
    ...opts.readonlyArgs,
  ];
}

/**
 * 从探针结论构造只读参数：只传探针实测**被接受**的旗标，且 denylist 一律用完整清单
 * （探针试的是精简版，适配层要的是含 NotebookEdit / WebFetch 的全集）。
 */
export function readonlyArgsFromProbe(readonlyFlags: readonly string[]): string[] {
  const out: string[] = [];
  if (readonlyFlags.some((f) => f.startsWith('--mode plan'))) out.push('--mode', 'plan');
  if (readonlyFlags.some((f) => f.startsWith('--disallowed-tools'))) out.push('--disallowed-tools', ZCODE_READONLY_DENYLIST);
  return out;
}

/**
 * 一组只读参数里，`Bash` 是否仍被禁用。
 *
 * `command_texts` 在本侧恒记空数组，前提就是这一条——该侧跑不了命令。
 * 前提一旦不成立而这里没跟着改，措施 b（§10.1）会在本侧**静默失效**：
 * 命令照跑、扫描面却是空的。所以把它做成断言而不是注释（审查意见 GLM-05）。
 *
 * **要喂给它的是 `readonlyArgsFromProbe` 的返回值**（实际递给 CLI 的 argv），
 * 不是 `probe.readonly_flags`（探针候选串的接受记录）。两者是独立的源，
 * 拿后者当判据，`ZCODE_READONLY_DENYLIST` 的漂移就无人可察（r5 GLM-05）。
 *
 * 判据看 denylist 里有没有 `Bash` 这个**词**，而不是 `includes('Bash')` 子串——
 * 后者会被 `BashOutput` 之类的兄弟工具名蒙混过去。
 */
export function bashStillDenied(readonlyFlags: readonly string[]): boolean {
  // `=` 在前置集里：`--disallowed-tools=Bash` 是标准长参数写法，实测**认不出**（AGY-04）。
  // `=Write,Bash` 因逗号边界侥幸认得出——这种侥幸比全错更危险，它让缺陷在一半样本上隐形。
  return readonlyFlags.some((f) => /(^|[\s,"'=])Bash([\s,"']|$)/.test(f));
}

/** **唯一**执行 zcode 的地方 */
export async function invokeZcode(opts: ZcodeInvokeOptions): Promise<ZcodeInvokeOutcome> {
  const args = buildZcodeArgs(opts);

  const env: Record<string, string | undefined> = {};
  if (opts.homeDir) env['HOME'] = opts.homeDir;

  const r = await run(opts.node, args, { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs, killTree: true });

  let failureKind: ZcodeInvokeOutcome['failureKind'] = 'none';
  if (r.code !== 0) {
    if (/Model config is missing/i.test(r.stderr)) failureKind = 'model_config_missing';
    else if (/provider is missing an API key|provider_not_configured|Provider authentication failed/i.test(r.stderr))
      failureKind = 'provider_not_configured';
    else failureKind = 'other';
  }

  return {
    envelope: parseZcodeEnvelope(r.stdout),
    exitCode: r.code,
    timedOut: r.timedOut,
    stdout: r.stdout,
    stderr: r.stderr,
    commandLine: r.commandLine,
    durationMs: r.durationMs,
    failureKind,
  };
}

/**
 * 为一次运行准备独立 HOME 与模型覆盖（`config_copy` 档）。
 *
 * 从用户的 `~/.zcode/cli/config.json` 拷一份到运行目录下的临时 HOME，
 * 只改 `model.main` 为本次要用的模型。**绝不改用户的全局配置**（§16.2 纪律 5）。
 */
/** 副本 HOME 在该侧运行目录下的位置——准备与抹除共用同一个拼法 */
export const zcodeHomeUnder = (runDir: string): string => path.join(runDir, 'home');
const ZCODE_CLI_SUBDIR = '.zcode/cli';

/**
 * 抹掉副本里的凭据（BACKLOG EV-20；计划双审三侧同时逮到的阻断——原稿以为只有 codex 有副本）。
 *
 * 载体只有一份：`home/.zcode/cli/config.json`，是 `prepareZcodeHome` 从宿主机整份抄来
 * 只改 `model` 的那份，provider 段的 apiKey 原样在里面。跑后没有任何代码回读它
 * （返回值只喂本次 `invokeZcode`），整份删。`home/` 下其余文件过扫描器，命中即删。
 */
export async function scrubZcodeHome(homeDir: string, opts: { sizeCap?: number } = {}): Promise<CarrierScrub> {
  const out: CarrierScrub = {
    deleted: [], unscannableDeleted: [], scanned: 0, removedOnHit: [],
    redacted: {}, warnings: [], skipped: 0, errors: [],
  };
  if (!(await exists(homeDir))) return out;
  const dirName = path.basename(homeDir);
  /*
   * 不用 `exists()` 当门禁：它内部是 `fs.access`，**权限异常或软链损坏时同样返回 false**，
   * 于是「删不掉」会被读成「本来就没有」，载体留在盘上而结果报 ok（代码双审 r2 AGY-03）。
   * `fs.rm({ force: true })` 本身对不存在就是静默成功，直接依赖它的幂等性，只捕真异常。
   */
  const carrier = path.join(homeDir, ZCODE_CLI_SUBDIR, 'config.json');
  const carrierExisted = await exists(carrier);
  try {
    await fs.rm(carrier, { force: true });
    if (carrierExisted) out.deleted.push(path.join(dirName, ZCODE_CLI_SUBDIR, 'config.json'));
  } catch (e) {
    out.errors.push(`删不掉 config.json 副本：${(e as Error).message}`);
  }
  /*
   * 与 codex 侧同一口径（代码双审 r1 GLM-03 ≡ CODEX-05）：
   * `rollout/` 与 `log/` 是模型 I/O 日志——逐字含送审包全文，夹具密钥会误命中，且 rollout 是本侧
   * 工具参数与生效模型的回读来源——命中不删、就地脱敏；`plugins/`（实测含数千个 node_modules 文件
   * 与 16 MB 动态库）与 `db/`（sqlite）不扫。
   */
  const scan = await scanAndRemoveSecrets(homeDir, {
    exclude: [`${ZCODE_CLI_SUBDIR}/plugins`, `${ZCODE_CLI_SUBDIR}/db`],
    redactUnder: [`${ZCODE_CLI_SUBDIR}/rollout`, `${ZCODE_CLI_SUBDIR}/log`],
    sizeCap: opts.sizeCap,
  });
  out.scanned = scan.scanned;
  out.removedOnHit = scan.removed.map((p) => path.join(dirName, p));
  /*
   * 论域内扫不进去的二进制整删（EV-36）。本侧自己的 sqlite 在 `db/` 下、已按前缀排除，
   * 这一格接的是**操作系统写进假 HOME 的副产品**——实测 `Library/Caches/com.apple.python 下的 .pyc`
   * （36 份 Xcode 自带 Python 框架的字节码，HOME 被重定向后由系统写入）。
   * 它们此前让该侧 `complete` 恒为 false：一条永不收工、也无动作可消除的待办。
   */
  out.unscannableDeleted = scan.unscannableRemoved.map((p) => path.join(dirName, p));
  for (const [rel, n] of Object.entries(scan.redacted)) out.redacted[path.join(dirName, rel)] = n;
  out.warnings.push(...scan.warnings);
  out.skipped = scan.skipped;
  out.errors.push(...scan.errors);
  return out;
}

export async function prepareZcodeHome(
  runDir: string,
  model: string | null,
): Promise<{ homeDir: string | null; route: 'config_copy' | 'global'; reason?: string }> {
  const srcConfig = path.join(os.homedir(), '.zcode/cli/config.json');
  if (!(await exists(srcConfig))) {
    return {
      homeDir: null,
      route: 'global',
      reason: `未找到 ${srcConfig}，无法做模型覆盖；将沿用 ZCode CLI 的全局默认`,
    };
  }
  if (!model) return { homeDir: null, route: 'global', reason: '本次未指定模型' };

  const homeDir = zcodeHomeUnder(runDir);
  const dstDir = path.join(homeDir, ZCODE_CLI_SUBDIR);
  await ensureDir(dstDir);

  const raw = await fs.readFile(srcConfig, 'utf8');
  const cfg = JSON.parse(raw) as { provider?: Record<string, unknown>; model?: unknown };
  // 模型 id 必须是 <providerId>/<modelName> 全限定形态（坑 P-06）
  cfg.model = { main: model, lite: model };

  await fs.writeFile(path.join(dstDir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  // 配置副本含凭据，权限收紧
  await fs.chmod(path.join(dstDir, 'config.json'), 0o600);

  return { homeDir, route: 'config_copy' };
}

export const zcodeAdapter: CriticAdapter = {
  critic: 'glm',
  /*
   * 专用读工具带独立路径字段，被拒操作留痕。本侧 `Bash` 全禁，`command_texts`
   * 恒空（见本文件 §96 的说明），`command-trace` 的回填路径对它是空操作——
   * 但仍如实声明为 `tool-trace`：能力说的是「轨迹是什么形状」，不是「本次采到了什么」。
   */
  capability: TOOL_TRACE_CAPABILITY,

  /**
   * 目录比对前的 slug 归一（M8 第 3 步）。
   *
   * 配置里写短名 `GLM-5.3` 更易读，但实测传裸名会落到错误 provider（坑 P-06），
   * 所以适配器传参时会补成 `<providerId>/<name>`。预检要拿「补全后的形态」去比目录，
   * 否则短名恒判不在目录里。这条知识属于本侧，收敛后不再住在 `preflight` 里。
   */
  normalizeModelForCatalog(cfg, model) {
    return qualifyZcodeModel(model, cfg.probe.cli.zcode?.model_id_form ?? null) ?? model;
  },

  /**
   * 探活（M8 第 3 步从 `preflight` 搬来）。
   *
   * 指纹取 `~/.zcode/cli/config.json`：CLI 的 provider 配置**独立于桌面端**，
   * 「桌面端已登录」不等于 CLI 可用（M0 实测），所以判据只认这个文件。
   */
  authProbe(ctx: AdapterContext, projectRoot: string) {
    const cfg = ctx.cfg;
    return {
      async fingerprint() {
        const f = path.join(os.homedir(), '.zcode/cli/config.json');
        return (await exists(f)) ? sha256File(f) : null;
      },
      async probe() {
        const entry = cfg.probe.cli.zcode?.entrypoint ?? null;
        if (!entry) return { ok: false, detail: 'zcode 入口未记录' };
        const out = await invokeZcode({
          entry,
          node: ctx.nodePath,
          cwd: projectRoot,
          prompt: '只回复 OK 两个字母，不要调用任何工具。',
          readonlyArgs: readonlyArgsFromProbe(cfg.probe.cli.zcode?.readonly_flags ?? []),
          homeDir: null,
          /*
           * 180s，与搬家前 `preflight` 里的值一致（r9 双审 GLM-07）。
           * M8 第 3 步把探活搬进适配器时手抄成了 120s——**一次搬家不该顺带改行为**。
           * 本侧要起 node 子进程再拉 CLI，比 agy 慢，那 60 秒是当初特意给的。
           */
          timeoutMs: 180_000,
        });
        const ok = out.failureKind === 'none' && !out.timedOut && out.envelope !== null;
        return {
          ok,
          detail: ok
            ? `探活通过（${Math.round(out.durationMs / 1000)}s）`
            : out.failureKind === 'model_config_missing'
              ? '缺 ~/.zcode/cli/config.json（CLI 的模型配置独立于桌面端，「已登录」不等于可用）'
              : `探活失败（${out.failureKind}）：${out.stderr.slice(0, 200)}`,
        };
      },
    };
  },

  availability(ctx: AdapterContext) {
    // 同 agy：「未探过」与「探过但没找到」要分开答，判据用 probed_at 而非 `!p`（AGY-01）。
    const p = ctx.cfg.probe.cli.zcode;
    if (!p?.probed_at) {
      return { ok: false, reason: 'zcode 尚未探测，请先运行 trivium doctor --only zcode' };
    }
    if (!p.entrypoint) return { ok: false, reason: '探针未找到 zcode.cjs 入口，请先运行 trivium doctor' };
    if (p.readonly_flags.length === 0) {
      return {
        ok: false,
        reason: '探针未实测到任何可用的只读参数组合，无法保障审查员只读，该侧不可用',
      };
    }
    /*
     * `--disallowed-tools` 是硬前置：probes/zcode.ts 与 ZCODE_READONLY_DENYLIST 的注释
     * 都写明 `--mode plan` 并不阻止命令执行，完整 denylist 里的 Bash 是必需项。
     * 原先只要 readonly_flags 非空就判可用——某个版本把 --disallowed-tools 改名后，
     * 审查员会在没有任何工具级 denylist 的情况下跑起来，失守只能事后靠轨迹发现。
     */
    if (!p.readonly_flags.some((f) => f.startsWith('--disallowed-tools'))) {
      return {
        ok: false,
        reason:
          '探针未实测到 --disallowed-tools 被接受：仅靠 --mode plan 挡不住 Bash 写入（M0 实测），' +
          '无法保障审查员只读，该侧不可用。请重跑 trivium doctor 或升级 ZCode',
      };
    }
    if (p.response_field === null) {
      return {
        ok: false,
        reason:
          'ZCode headless 未跑通。注意 CLI 的模型 provider 配置独立于桌面端——' +
          '「已登录」不等于「可用」，请确认 ~/.zcode/cli/config.json 存在。',
      };
    }
    return { ok: true };
  },

  /** 凭据载体在 `<侧>/home/.zcode/cli/config.json`，由 `prepareZcodeHome` 写入；抹除见 `scrubZcodeHome` */
  async scrubRunDir(sideDir: string, opts?: { sizeCap?: number }) {
    return scrubZcodeHome(zcodeHomeUnder(sideDir), opts);
  },

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.cli.zcode;
    // 两态判据同 availability()：以 probed_at 区分（AGY-01）。
    if (!probe?.probed_at) {
      return failedResult('glm', {
        status: 'failed',
        reason: 'zcode 尚未探测，请先运行 trivium doctor --only zcode',
      });
    }
    if (!probe.entrypoint) {
      return failedResult('glm', { status: 'failed', reason: 'zcode 入口未探测到' });
    }
    const entry = probe.entrypoint;

    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.json');
    const tracePath = path.join(req.out_dir, 'trace.json');

    // 只读参数以探针实测「实际被接受」的为准，并强制补全 denylist
    const readonlyArgs = readonlyArgsFromProbe(probe.readonly_flags);

    // 模型名补全必须在写配置副本之前——写进去的裸名会让 provider 解析失败
    const qualified = qualifyZcodeModel(req.model, probe.model_id_form ?? null);
    const home = await prepareZcodeHome(path.dirname(req.out_dir), qualified);

    let out: ZcodeInvokeOutcome;
    try {
      out = await invokeZcode({
        entry,
        node: ctx.nodePath,
        cwd: req.project_root,
        prompt: req.brief_text,
        readonlyArgs,
        homeDir: home.homeDir,
        timeoutMs: req.timeout_s * 1000,
      });
    } catch (e) {
      return failedResult('glm', { status: 'failed', reason: `拉起 zcode 失败：${(e as Error).message}` });
    }

    await fs.writeFile(stdoutPath, out.stdout, 'utf8');

    if (out.timedOut) {
      return failedResult('glm', {
        status: 'timeout',
        reason: `脚本级超时（${req.timeout_s}s）`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.envelope?.sessionId ?? null,
      });
    }

    if (out.failureKind !== 'none' || !out.envelope) {
      const hint =
        out.failureKind === 'model_config_missing'
          ? '缺 ~/.zcode/cli/config.json（CLI 的模型配置独立于桌面端）'
          : out.failureKind === 'provider_not_configured'
            ? 'provider 鉴权失败，检查 config.json 里的 apiKey'
            : out.stderr.slice(0, 300);
      return failedResult('glm', {
        status: 'failed',
        reason: `zcode 执行失败（${out.failureKind}）：${hint}`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.envelope?.sessionId ?? null,
      });
    }

    // ── 轨迹：两个来源缺一不可 ──
    const sessionId = out.envelope.sessionId;
    const cliDir = path.join(home.homeDir ?? os.homedir(), '.zcode/cli');

    let toolCalls: CriticResult['tool_calls'] = {};
    let writeEvents: string[] = [];
    let modelFromLog: string | null = null;
    // 日志：工具名、状态、model。共享 HOME 时必须按 sessionId 过滤
    try {
      const logDir = path.join(cliDir, 'log');
      const files = (await fs.readdir(logDir)).filter((f) => f.endsWith('.jsonl')).sort();
      const latest = files.at(-1);
      if (latest) {
        const t = parseZcodeTrace(await fs.readFile(path.join(logDir, latest), 'utf8'), sessionId);
        toolCalls = t.toolCalls;
        writeEvents = t.writeEvents;
        modelFromLog = t.modelEffective;
      }
    } catch {
      /* 日志不可读不致命，交给 guard 按证据不足处置 */
    }

    // rollout：工具参数（路径）与 model.source。读取路径**只能**从这里取
    let readPathList: string[] = [];
    /*
     * 路径提取覆盖率（设计 10.1.1 第②层）。`null` = 该轮没读到 rollout，
     * 与「读到了但分母为 0」是两件事——前者该记未知，后者说明本轮没有必带路径的调用。
     */
    let coverage: { total: number; withPath: number } | null = null;
    let modelFromRollout: string | null = null;
    if (sessionId) {
      // 文件名是 `model-io-` + sessionId，sessionId 自带 sess_ 前缀（坑 P-14）
      const rolloutFile = path.join(cliDir, 'rollout', `model-io-${sessionId}.jsonl`);
      if (await exists(rolloutFile)) {
        const ro = parseZcodeRollout(await fs.readFile(rolloutFile, 'utf8'));
        readPathList = ro.readPaths;
        coverage = ro.pathCoverage;
        modelFromRollout = ro.modelEffective;
        writeEvents = [...new Set([...writeEvents, ...ro.writeEvents])];
        await fs.copyFile(rolloutFile, path.join(req.out_dir, 'rollout.jsonl'));
      }
    }

    await fs.writeFile(
      tracePath,
      JSON.stringify({ toolCalls, readPaths: readPathList, writeEvents, sessionId }, null, 2),
      'utf8',
    );

    const modelEffective = modelFromLog ?? modelFromRollout;

    return {
      critic: 'glm',
      status: 'ok',
      exit_code: out.exitCode,
      duration_s: out.durationMs / 1000,
      raw_stdout_path: stdoutPath,
      trace_path: tracePath,
      review_json: null, // 由 parse 填充
      raw_response_text: out.envelope.response,
      model_effective: modelEffective,
      // envelope 没有 model 字段，因此来源只能是 trace 或 unverified，绝不用 requested 冒充
      model_effective_source: modelEffective ? 'trace' : 'unverified',
      /*
       * 同 agy：本族无这两种事实，恒 null 且说得出理由。
       * zcode 的模型 id 自带 `bigmodel-coding-plan/` 前缀，那是**套餐**不是 provider 家族；
       * 配置段 `GlmCriticConfig` 也没有 `profile` 键。
       */
      model_provider: null,
      profile_requested: null,
      model_route: home.route,
      tool_calls: toolCalls,
      read_paths: readPathList,
      /*
       * 覆盖率两项**恒写**（r2 代码双审 GLM-08 ≡ CODEX-10）。
       *
       * 上一版在读不到 rollout 时整体省略这两个键，判定层据此记 `unavailable`——
       * 结论是对的，可**成因丢了**：字段缺失在契约里的含义是「该族没有这个概念，
       * 或这份留痕早于本字段」，而这里的真相是「本族有这个概念、这次没采到」。
       * 两者的处置完全不同：前者没法修，后者是该查轨迹文件为什么读不到。
       *
       * 写 `null` 把这件事说清楚，判定层仍记 `unavailable`（成因 `no-counts`）。
       */
      path_bearing_reads: coverage ? coverage.total : null,
      path_bearing_reads_with_path: coverage ? coverage.withPath : null,
      write_events: writeEvents,
      /*
       * zcode 侧**恒为空数组**，而这是能说明理由的空：只读组合里 `Bash` 被整个禁掉
       * （M0 的 C-10：`--mode plan` 单独不够，denylist 必须含 `Bash`），
       * 该侧压根产生不了命令事件。空数组的含义是「**没有命令**」而不是「没采集」。
       *
       * **这个前提由 `bashStillDenied` 在运行期断言，不靠注释**（审查意见 GLM-05）：
       * 初版这里写的是「若哪天放开了 `Bash`，这一行要跟着改」——
       * 纯记性约定，而 AGENTS.md 纪律 12 明令这类纪律要换成不依赖记性的机制。
       * 真放开了 `Bash` 而这里仍恒空，措施 b 会在该侧**静默失效**。
       *
       * 断言喂的是 `readonlyArgs`——**真正递给 CLI 的那串 argv**，不是
       * `probe.readonly_flags`（r5 GLM-05）。后者只是探针那个固定候选串的
       * 「被接受」记录，与实际传参是两个源：`readonlyArgsFromProbe` 无条件
       * 把 `ZCODE_READONLY_DENYLIST` 推进 argv，所以从那个常量里删掉 `Bash`
       * 不会让探针记录有任何变化——断言照旧通过，而措施 b 已经死了。
       * 断言必须守着实际生效的东西，守候选记录等于没守。
       */
      command_texts: bashStillDenied(readonlyArgs)
        ? []
        : (() => {
            throw new Error(
              'zcode 实际递出的只读参数里不再禁用 Bash（readonlyArgs = ' +
                `${JSON.stringify(readonlyArgs)}），而适配器仍把 command_texts 恒记为空。\n` +
                '  该侧现在能跑命令了，措施 b（§10.1 命令文本扫描）会静默失效——\n' +
                '  要么在这里真从轨迹提取命令原文，要么把 Bash 加回 ZCODE_READONLY_DENYLIST。',
            );
          })(),
      evidence_ok: false, // 由 guard 判定
      fail_reason: null,
      session_id: sessionId,
      usage: out.envelope.usage,
      cli_version: probe.version,
      // M0 实测：denylist 是工具级而非路径级，此项恒为 false
      /*
       * **读 `file_shape_verified`，不读 `supported`**（BACKLOG EV-42，代码双审 r4 CODEX-03）。
       *
       * `supported` 回答「这家 CLI 有没有路径级 deny 机制」；这一格回答的是
       * **「本机曾实测该逐文件形状可拦」**——两件事。
       *
       * **措辞要准**（代码双审 r2 GLM-01）：上一版这里写的是「本次注入的那些逐文件
       * 路径真的挡住了」，那**比字段能知道的更多**——它的取值来自探针夹具里的
       * 单条 ASCII 路径，对**本次**注入的那批规则（可能含被跳过的、含 glob 元字符的）
       * 一无所知。逐条结果看 `trace.json` 的 `denySettings.skippedPaths`。
       *
       * 三态在这里天然安全：`null`（没验过）与 `false` 都判不过 `=== true`。
       */
      peer_deny_applied: probe.path_deny.file_shape_verified === true,
      /*
       * 该侧不注入 `--settings`（无路径级 deny 机制），**恒为 0 且这是能说明理由的零**：
       * 含义是「没有这种概念」，不是「注入了但一条都没跳过」。
       */
      deny_skipped: 0,
      deny_rule_count: 0,
    deny_bytes: 0,
      command_line: out.commandLine,
    };
  },
};
