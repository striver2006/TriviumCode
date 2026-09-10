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
import { ensureDir, exists } from '../util/fsx.js';
import {
  parseZcodeEnvelope,
  parseZcodeRollout,
  parseZcodeTrace,
  type ZcodeEnvelope,
} from './zcode-trace.js';
import { failedResult, type AdapterContext, type CriticAdapter } from './base.js';

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
export const ZCODE_READONLY_DENYLIST = 'Write,Edit,MultiEdit,ApplyPatch,NotebookEdit,Bash';

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

/** **唯一**构造 zcode 命令行的地方 */
export async function invokeZcode(opts: ZcodeInvokeOptions): Promise<ZcodeInvokeOutcome> {
  const args = [
    opts.entry,
    '--prompt', opts.prompt,
    '--cwd', opts.cwd,
    '--json', '--no-color',
    ...opts.readonlyArgs,
  ];

  const env: Record<string, string | undefined> = {};
  if (opts.homeDir) env['HOME'] = opts.homeDir;

  const r = await run(opts.node, args, { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs });

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

  const homeDir = path.join(runDir, 'home');
  const dstDir = path.join(homeDir, '.zcode/cli');
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

  availability(ctx: AdapterContext) {
    const p = ctx.cfg.probe.zcode;
    if (!p.entry) return { ok: false, reason: '探针未找到 zcode.cjs 入口，请先运行 trivium doctor' };
    if (p.readonly_flags.length === 0) {
      return {
        ok: false,
        reason: '探针未实测到任何可用的只读参数组合，无法保障审查员只读，该侧不可用',
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

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.zcode;
    const entry = probe.entry;
    if (!entry) return failedResult('glm', { status: 'failed', reason: 'zcode entry 未探测到' });

    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.json');
    const tracePath = path.join(req.out_dir, 'trace.json');

    // 只读参数以探针实测「实际被接受」的为准，并强制补全 denylist
    const readonlyArgs: string[] = [];
    if (probe.readonly_flags.some((f) => f.startsWith('--mode plan'))) {
      readonlyArgs.push('--mode', 'plan');
    }
    if (probe.readonly_flags.some((f) => f.startsWith('--disallowed-tools'))) {
      readonlyArgs.push('--disallowed-tools', ZCODE_READONLY_DENYLIST);
    }

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
    let modelFromRollout: string | null = null;
    if (sessionId) {
      // 文件名是 `model-io-` + sessionId，sessionId 自带 sess_ 前缀（坑 P-14）
      const rolloutFile = path.join(cliDir, 'rollout', `model-io-${sessionId}.jsonl`);
      if (await exists(rolloutFile)) {
        const ro = parseZcodeRollout(await fs.readFile(rolloutFile, 'utf8'));
        readPathList = ro.readPaths;
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
      model_route: home.route,
      tool_calls: toolCalls,
      read_paths: readPathList,
      write_events: writeEvents,
      evidence_ok: false, // 由 guard 判定
      fail_reason: null,
      session_id: sessionId,
      usage: out.envelope.usage,
      cli_version: probe.version,
      // M0 实测：denylist 是工具级而非路径级，此项恒为 false
      peer_deny_applied: probe.path_deny.supported === true,
      command_line: out.commandLine,
    };
  },
};
