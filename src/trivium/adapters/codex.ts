/**
 * Codex 适配器（设计 §11.1 / §3.6，M8 第 3 步）。
 *
 * 与既有两家最要紧的差别不在参数，在**能力形状**：codex 读文件就是跑 shell，
 * 路径只在命令文本里（P-C1），被沙箱拒绝的命令一条事件都不产生（P-C2）。
 * 判定层已在第 2 步改为面向 `TraceCapability`，所以这里只声明能力、不特判。
 *
 * 铁律（原则 P7）：命令行**一律由 probe 结论构造**，不得硬编码设计文档里的示例。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type { CriticRequest, CriticResult, CodexCriticConfig } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir, exists, sha256File } from '../util/fsx.js';
import { agentConfigOf } from '../config.js';
import {
  parseCodexEvents,
  readSessionMeta,
  succeededCommands,
  traceCompleted,
  type CodexSessionMeta,
  type CodexTrace,
} from './codex-trace.js';
import { codexHomeOf, prepareCodexHome, type CodexHomePrep } from './codex-home.js';
import {
  classifyWriteCommands,
  failedResult,
  COMMAND_TRACE_CAPABILITY,
  type AdapterContext,
  type CriticAdapter,
} from './base.js';

export interface CodexInvokeOptions {
  bin: string;
  cwd: string;
  /** 送审包全文。走 stdin，不进 argv */
  prompt: string;
  profile: string | null;
  model: string | null;
  effort: string | null;
  /** 探针实测被接受的只读旗标（argv 形态） */
  readonlyArgs: string[];
  codexHome: string;
  fakeHome: string;
  timeoutMs: number;
}

/**
 * argv 拼装。纯函数，与执行分离，让调用配方有回归测试。
 *
 * **prompt 走 stdin（末尾的 `-`）而不是 argv**：送审包是几十 KB 量级的文本，
 * 塞进 argv 是在赌 `ARG_MAX`。`codex exec --help` 明载 `[PROMPT]` 支持 `-`
 * 从 stdin 读，本步实测以 78 KB 跑通。
 */
export function buildCodexArgs(
  opts: Pick<CodexInvokeOptions, 'profile' | 'model' | 'effort' | 'readonlyArgs' | 'cwd'>,
): string[] {
  return [
    'exec',
    ...(opts.profile ? ['-p', opts.profile] : []),
    ...(opts.model ? ['-m', opts.model] : []),
    ...(opts.effort ? ['-c', `model_reasoning_effort=${opts.effort}`] : []),
    ...opts.readonlyArgs,
    '--json',
    '--skip-git-repo-check',
    '-C', opts.cwd,
    '-',
  ];
}

/**
 * 只读旗标由探针结论构造（P7）。
 *
 * 本机实测值是 `['-s','read-only']`，且该结论是**负对照挣来的**：探针让模型
 * 在 cwd 建文件，文件没被创建才记这个值；创建成功则记空数组。
 * 所以空数组的含义是「本机沙箱不可信」，此时该侧必须判不可用——
 * 绝不能回落到一个「文档上写着应该管用」的默认值。
 */
export function readonlyArgsFromProbe(readonlyFlags: readonly string[]): string[] {
  return [...readonlyFlags];
}

export interface CodexInvokeOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  commandLine: string;
  durationMs: number;
}

/** **唯一**执行 codex 的地方 */
export async function invokeCodex(opts: CodexInvokeOptions): Promise<CodexInvokeOutcome> {
  const args = buildCodexArgs(opts);
  const r = await run(opts.bin, args, {
    cwd: opts.cwd,
    env: { CODEX_HOME: opts.codexHome, HOME: opts.fakeHome },
    /*
     * stdin 必须显式给：codex 在 argv 已带 prompt 时**仍然读 stdin**
     * （stderr 恒打印 `Reading additional input from stdin...`）。
     * 本步实测踩过——继承了一个不会 EOF 的 stdin，进程挂到超时被杀。
     */
    stdin: opts.prompt,
    timeoutMs: opts.timeoutMs,
    killTree: true,
  });
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.code,
    timedOut: r.timedOut,
    commandLine: r.commandLine,
    durationMs: r.durationMs,
  };
}

/** 取 codex 的配置段。缺段或 vendor 不符时由 `agentConfigOf` 响亮失败 */
function codexConfig(ctx: AdapterContext): CodexCriticConfig {
  return agentConfigOf(ctx.cfg, 'codex', 'openai') as CodexCriticConfig;
}

/**
 * 把一次运行的原始事实组装成 `CriticResult`。
 *
 * **抽成纯函数是为了能被变异验证打中**（M8 第 3 步）：这里有一条 AC-20 的硬判据——
 * 「生效模型以回读为准、拿不到就记 `unverified`，绝不用 requested 冒充」——
 * 而它原先埋在 `run()` 里，要真跑 codex 才走得到。跑一次 M4 变异
 * （`meta.modelEffective ?? req.model`）证实了这一点：全量用例无一变红。
 * 冒充的后果不是数字难看，是 AC-20 那条验收**永远通过、永远没有意义**。
 */
export function buildCodexResult(
  trace: CodexTrace,
  meta: CodexSessionMeta,
  o: Pick<CodexInvokeOutcome, 'exitCode' | 'durationMs' | 'commandLine'>,
  paths: { stdout: string; trace: string },
  probe: { version: string | null; path_deny: { supported: boolean | null } },
  projectRoot: string,
): CriticResult {
  /*
   * 写判据在这里算，不从调用方传进来：判据与它产出的两个字段绑在一处，
   * 才不会出现「算了一套、填了另一套」。入参只喂**成功执行**的命令，
   * 而 `command_texts` 拿全集——两者论域不同，见 `classifyWriteCommands` 的契约。
   */
  const allCommands = trace.commands.map((c) => c.command);
  const { writes, suspected } = classifyWriteCommands(succeededCommands(trace), projectRoot);

  return {
    critic: 'codex',
    status: 'ok',
    exit_code: o.exitCode,
    duration_s: o.durationMs / 1000,
    raw_stdout_path: paths.stdout,
    trace_path: paths.trace,
    review_json: null, // 由 parse 填充
    raw_response_text: trace.finalText,
    model_effective: meta.modelEffective,
    /*
     * 回读到就记 trace，回读不到记 unverified——**绝不用 requested 冒充**
     * （与 zcode 侧同一条纪律）。AC-20 要核对「生效模型与指定一致」，
     * 拿意图值冒充会让那条验收永远通过、永远没有意义。
     */
    model_effective_source: meta.modelEffective ? 'trace' : 'unverified',
    model_route: 'config_copy',
    tool_calls: { run_command: trace.commands.length },
    /*
     * **恒为空数组，且这是能说明理由的空**：codex 没有结构化读取路径字段
     * （P-C1 实测），读取路径由判定层从 `command_texts` 回填
     * （`effectiveReadPaths`，第 2 步落地）。空的含义是「该侧没有这种字段」，
     * 不是「没采集」。
     */
    read_paths: [],
    write_events: writes,
    suspected_write_events: suspected,
    command_texts: allCommands,
    evidence_ok: false, // 由 guard 判定
    fail_reason: null,
    session_id: trace.threadId,
    cli_version: meta.cliVersion ?? probe.version,
    // 实测：codex 无路径级 deny 机制（`path_deny.supported === false`）
    peer_deny_applied: probe.path_deny.supported === true,
    command_line: o.commandLine,
  };
}

export const codexAdapter: CriticAdapter = {
  critic: 'codex',
  /*
   * 读即命令、被拒不留痕。两条都是 M6 实测（P-C1 / P-C2），
   * 本步的隔离实测再次复现了后者：让模型写 /tmp，文件没建成，
   * 而轨迹里连那条命令都没有。
   */
  capability: COMMAND_TRACE_CAPABILITY,

  /**
   * 探活。
   *
   * 指纹取本次 profile 的分层文件 + `auth.json`：这两处任一改动都会换掉凭据或 provider，
   * 旧的「已认证」结论随即失效。基底 `config.toml` 不进指纹——它的大部分内容
   * （plugins、mcp_servers、projects 信任表）与鉴权无关，且每次用 codex 都在变，
   * 把它算进去等于让缓存永远失效。
   *
   * 最小调用走与真实审查**同一条隔离路径**（裁剪副本 + 双覆盖）：
   * 探活若走宿主机配置而真实运行走副本，探到的「能用」证明不了副本里也能用——
   * 那正是本步要防的失败形态（F-2 的退出就发生在副本里，宿主机上一切正常）。
   */
  authProbe(ctx: AdapterContext, projectRoot: string) {
    const cfg = ctx.cfg;
    const profile = codexConfig(ctx).profile;
    return {
      async fingerprint(): Promise<string | null> {
        const home = codexHomeOf();
        const parts: string[] = [];
        for (const f of [profile ? `${profile}.config.toml` : null, 'auth.json']) {
          if (!f) continue;
          const p = path.join(home, f);
          if (await exists(p)) parts.push((await sha256File(p)) ?? '');
        }
        return parts.length > 0 ? parts.join(':') : null;
      },
      async probe(): Promise<{ ok: boolean; detail: string }> {
        const probe = cfg.probe.cli.codex;
        const bin = codexConfig(ctx).bin ?? probe?.entrypoint ?? null;
        if (!bin) return { ok: false, detail: 'codex 入口未记录' };

        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-codex-auth-'));
        try {
          const home = await prepareCodexHome(tmp, { profile, projectRoot });
          const out = await invokeCodex({
            bin,
            cwd: projectRoot,
            prompt: '只回复 OK 两个字母，不要调用任何工具。',
            profile,
            model: null, // 用 profile 的默认模型，探的是凭据不是模型路由
            effort: null,
            readonlyArgs: readonlyArgsFromProbe(probe?.readonly_flags ?? []),
            codexHome: home.codexHome,
            fakeHome: home.fakeHome,
            timeoutMs: 120_000,
          });
          const trace = parseCodexEvents(out.stdout);
          const ok = traceCompleted(trace, out.timedOut);
          return {
            ok,
            detail: ok
              ? `探活通过（${Math.round(out.durationMs / 1000)}s）`
              : `探活失败：${trace.errors.join('；') || out.stderr.slice(0, 200) || '(无错误消息)'}。\n` +
                `  请确认 profile「${profile ?? '(未配置)'}」对应的 provider 凭据可用。`,
          };
        } finally {
          await fs.rm(tmp, { recursive: true, force: true });
        }
      },
    };
  },

  availability(ctx: AdapterContext) {
    // 两态判据同另两家：以 probed_at 区分「没探过」与「探过没找到」
    const p = ctx.cfg.probe.cli.codex;
    if (!p?.probed_at) {
      return { ok: false, reason: 'codex 尚未探测，请先运行 trivium doctor --only codex' };
    }
    if (!p.entrypoint) {
      return { ok: false, reason: '探针未找到 codex 可执行文件，请先运行 trivium doctor' };
    }
    if (p.readonly_flags.length === 0) {
      return {
        ok: false,
        reason:
          '探针未实测到可用的只读旗标——**这包括只读沙箱负对照失败的情形**' +
          '（read-only 下文件仍被创建时探针会把该字段清空）。无法保障审查员只读，该侧不可用。',
      };
    }
    if (p.exec_headless_read_ok === false) {
      return {
        ok: false,
        reason: 'codex exec headless 读不到文件，该侧无法作为审查员使用。请重跑 trivium doctor --only codex',
      };
    }
    if (p.exec_headless_read_ok === null) {
      return {
        ok: false,
        reason: '探针尚未实测 codex 的 headless 读取能力（上次探测没跑完），请重跑 trivium doctor --only codex',
      };
    }

    /*
     * provider 家族必须带得出凭据（J8 / AC-20 末条）。
     *
     * 判据落在**本次 profile** 上而不是「有任意一家可用」：家族由 profile 决定，
     * 而未知 profile 会被 codex **静默回落**到基底配置（`unknown_profile_rejected`
     * 实测为 false），所以这里不拦，用户就会以为跑的是 deepseek、实际跑的是别家。
     */
    const wanted = codexConfig(ctx).profile;
    if (wanted !== null) {
      const hit = p.providers.find((x) => x.profile === wanted);
      if (!hit) {
        const known = p.providers.map((x) => x.profile).join('、') || '（探针未发现任何 profile）';
        return {
          ok: false,
          reason:
            `配置的 codex profile「${wanted}」在本机不存在。已探测到的：${known}。\n` +
            '  注意 codex 对未知 profile 不报错、而是静默回落基底配置，所以这道拦截由预检负责。',
        };
      }
      if (!hit.credentialed) {
        return {
          ok: false,
          reason:
            `codex profile「${wanted}」对应的 provider「${hit.provider ?? '未知'}」没有可用凭据。\n` +
            `  请在 ${'~/.codex'}/${wanted}.config.toml 或 config.toml 的 [model_providers.${hit.provider ?? '<家族>'}] 段配置凭据后重跑 doctor。\n` +
            '  编排器不代写凭据、也不改你的全局配置（纪律 5）。',
        };
      }
    }
    return { ok: true };
  },

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.cli.codex;
    if (!probe?.probed_at) {
      return failedResult('codex', {
        status: 'failed',
        reason: 'codex 尚未探测，请先运行 trivium doctor --only codex',
      });
    }
    if (!probe.entrypoint) {
      return failedResult('codex', { status: 'failed', reason: 'codex 入口未探测到' });
    }

    const cfg = codexConfig(ctx);
    const bin = cfg.bin ?? probe.entrypoint;
    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.jsonl');
    const tracePath = path.join(req.out_dir, 'trace.json');

    // 隔离：CODEX_HOME + HOME 双覆盖，配置按白名单裁剪（EV-08 + 本步实测）
    let home: CodexHomePrep;
    try {
      home = await prepareCodexHome(path.dirname(req.out_dir), {
        profile: cfg.profile,
        projectRoot: req.project_root,
      });
    } catch (e) {
      return failedResult('codex', {
        status: 'failed',
        reason: `准备 codex 隔离副本失败：${(e as Error).message}`,
      });
    }

    let out: CodexInvokeOutcome;
    try {
      out = await invokeCodex({
        bin,
        cwd: req.project_root,
        prompt: req.brief_text,
        profile: cfg.profile,
        model: req.model,
        effort: req.effort ?? null,
        readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags),
        codexHome: home.codexHome,
        fakeHome: home.fakeHome,
        timeoutMs: req.timeout_s * 1000,
      });
    } catch (e) {
      return failedResult('codex', {
        status: 'failed',
        reason: `拉起 codex 失败：${(e as Error).message}`,
      });
    }

    await fs.writeFile(stdoutPath, out.stdout, 'utf8');
    const trace = parseCodexEvents(out.stdout);

    if (out.timedOut) {
      return failedResult('codex', {
        status: 'timeout',
        reason: `脚本级超时（${req.timeout_s}s）`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: trace.threadId,
      });
    }

    if (!traceCompleted(trace, out.timedOut)) {
      /*
       * 没有最终回复即视为没跑成——退出码不足以判定（codex 在模型拒绝任务时也可能退 0）。
       * 失败原因优先取事件流里的 error 消息：跨家族调用时那里写的是
       * `Model not found: …`，而退出码只有一个 1。
       */
      const why = trace.errors.length > 0 ? trace.errors.join('；') : out.stderr.slice(0, 300);
      return failedResult('codex', {
        status: 'failed',
        reason: `codex 未产出最终回复：${why || '(无错误消息)'}`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: trace.threadId,
      });
    }

    // 生效模型回读：会话文件首行的 session_meta（事件流里没有 model 字段）
    const meta = await readSessionMeta(home.codexHome, trace.threadId);

    /*
     * 写判定：只把**成功执行**的命令喂进分类器。
     * `command_texts` 保留全集给措施 b——泄漏企图即便失败也要被扫到，两者论域不同。
     */
    const { writes, suspected } = classifyWriteCommands(
      succeededCommands(trace),
      req.project_root,
    );

    await fs.writeFile(
      tracePath,
      JSON.stringify(
        {
          threadId: trace.threadId,
          eventTypes: trace.eventTypes,
          itemTypes: trace.itemTypes,
          commands: trace.commands,
          errors: trace.errors,
          writeEvents: writes,
          suspectedWrites: suspected,
          isolation: {
            codexHome: home.codexHome,
            strippedKeys: home.strippedKeys,
            rewrittenPaths: home.rewrittenPaths,
            copiedFiles: home.copiedFiles,
            warnings: home.warnings,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    return buildCodexResult(trace, meta, out, { stdout: stdoutPath, trace: tracePath }, probe, req.project_root);
  },
};
