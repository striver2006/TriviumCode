/**
 * Antigravity 适配器（设计 §11.2）。
 *
 * M0 实测确立的调用配方，**不得偏离**：
 *   1. `--agent trivium-critic`：只读工具白名单，**不含 `run_command`**。
 *      模型一旦选 `run_command`，headless 下拿不到审批就被静默拒绝，
 *      产出「exit 0 但零读取」的空审查（社区 issue #548）。
 *   2. BRIEF 里的路径**一律绝对化**。agy 的文件工具只接受绝对路径，
 *      且没有 `run_command` 时模型无法 `pwd`，不给绝对路径它会跑出项目乱翻。
 *   3. **禁止** `--dangerously-skip-permissions`（AD-07）——它会连写工具一起放行。
 *
 * 另有两个反直觉的地方：
 *   - `stream-json` 本身就是工具轨迹来源，不需要另找日志文件；
 *   - 1.1.28 起 `--print-timeout` 到期**不再非零退出**，而是返回部分输出并 exit 0，
 *     所以超时判定必须靠编排器自己的墙钟计时，不能只看退出码（坑 P-07）。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import type { CriticRequest, CriticResult } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir, exists, sha256File } from '../util/fsx.js';
import {
  parseAgyStream,
  readPaths,
  pathCoverage,
  successfulToolCalls,
  writeEvents,
  commandTexts,
  type AgyStreamResult,
} from './agy-events.js';
import {
  failedResult,
  TOOL_TRACE_CAPABILITY,
  type AdapterContext,
  type CriticAdapter,
} from './base.js';
import { agentConfigOf } from '../config.js';

export interface AgyInvokeOptions {
  bin: string;
  cwd: string;
  prompt: string;
  model?: string | null;
  agent?: string | null;
  effort?: string | null;
  jsonSchemaPath?: string | null;
  timeoutMs: number;
  pty?: boolean;
  env?: Record<string, string | undefined>;
}

export interface AgyInvokeOutcome {
  parsed: AgyStreamResult;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  commandLine: string;
  durationMs: number;
  /** agy 自报的「输出可能被截断」告警（1.1.28 起的行为，见坑 P-07） */
  printTimeoutWarned: boolean;
}

/**
 * 模型 slug 是否自带努力档位后缀。
 *
 * agy 的目录形如 `gemini-3.8-flash-high` / `gemini-3.1-pro-low` / `gpt-oss-120b-medium`；
 * 也有不带档位的（`claude-sonnet-4-6`），那种才需要 `--effort`。
 */
export function modelEncodesEffort(model: string | null): boolean {
  return model !== null && /-(high|medium|low)$/.test(model);
}

/**
 * agy 的 argv 拼装。纯函数，与执行分离——M0 坑清单里的调用配方（P-07 / P-16 / AD-07）
 * 在这里有回归测试守着，厂商升级后能第一时间发现配方失效。
 */
export function buildAgyArgs(opts: Omit<AgyInvokeOptions, 'bin' | 'cwd' | 'pty' | 'env'>): string[] {
  const args = ['-p', opts.prompt, '--output-format', 'stream-json'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.agent) args.push('--agent', opts.agent);
  /*
   * `--effort` 只在模型 slug **没有**自带档位时才传。
   *
   * agy 1.2.0 的 slug 本身就编码了档位（`gemini-3.8-flash-high`、`gemini-3.1-pro-low`），
   * 此时再给 `--effort` 会被直接拒绝：
   *   error: invalid model selection (--model "gemini-3.8-flash-high" --effort "medium"):
   *          --model gemini-3.8-flash-high conflicts with --effort=medium
   * 实测踩到（坑 P-16）：plan 阶段恰好 slug 与 effort 都是 high 所以一直没暴露，
   * code 阶段配的是 medium，一跑就非零退出、白烧一次调用。
   *
   * slug 是权威：它来自探针回读的模型目录，而 `critics.gemini.effort` 只是配置意图。
   */
  if (opts.effort && !modelEncodesEffort(opts.model ?? null)) {
    args.push('--effort', opts.effort);
  }
  if (opts.jsonSchemaPath) args.push('--json-schema', opts.jsonSchemaPath);

  // 进程内超时略小于脚本级超时，让 agy 有机会自己收尾并吐出已有输出
  const innerS = Math.max(30, Math.floor(opts.timeoutMs / 1000) - 20);
  args.push('--print-timeout', `${innerS}s`);
  return args;
}

/** 拼装并执行一次 agy headless。**唯一**执行 agy 的地方 */
export async function invokeAgy(opts: AgyInvokeOptions): Promise<AgyInvokeOutcome> {
  const args = buildAgyArgs(opts);

  const r = await run(opts.bin, args, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    killTree: true,
    pty: opts.pty ?? false,
    env: opts.env ?? {},
  });

  return {
    parsed: parseAgyStream(r.stdout),
    exitCode: r.code,
    timedOut: r.timedOut,
    stdout: r.stdout,
    stderr: r.stderr,
    commandLine: r.commandLine,
    durationMs: r.durationMs,
    printTimeoutWarned: /print timeout after/i.test(r.stderr),
  };
}

/** 统计工具调用分类计数 */
function countTools(parsed: AgyStreamResult): CriticResult['tool_calls'] {
  const counts: CriticResult['tool_calls'] = { read: 0, grep: 0, glob: 0, run_command: 0 };
  for (const t of successfulToolCalls(parsed)) {
    switch (t.toolName) {
      case 'view_file':
        counts.read = (counts.read ?? 0) + 1;
        break;
      case 'grep_search':
        counts.grep = (counts.grep ?? 0) + 1;
        break;
      case 'find_by_name':
      case 'list_dir':
        counts.glob = (counts.glob ?? 0) + 1;
        break;
      case 'run_command':
        counts.run_command = (counts.run_command ?? 0) + 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

/**
 * 本次调用该用哪个只读 Agent：探针实际验证过的那个（P7）。
 *
 *   - 探针记了名字 → 用它；
 *   - 探针明确记了 null → agent.md 缺失、当时是用默认 Agent 探的，该侧不可用；
 *   - 旧探针结论没有该字段 → 回退到配置名（兼容），下次 doctor 会补上。
 */
export function resolveAgyAgent(
  probe: { agent?: string | null },
  configured: string,
): { agent: string | null; reason: string | null } {
  if (probe.agent === undefined) return { agent: configured, reason: null };
  if (probe.agent === null) {
    return {
      agent: null,
      reason:
        `探针验证时只读审查 Agent 未安装（当时以默认 Agent 探测）。请确认 ` +
        `~/.gemini/config/agents/${configured}/agent.md 已由安装器写入，然后重跑 trivium doctor --only agy`,
    };
  }
  return { agent: probe.agent, reason: null };
}

export const agyAdapter: CriticAdapter = {
  critic: 'gemini',
  /*
   * 专用读工具带独立路径字段，被拒操作留痕——与本步之前的判定行为逐字等价。
   * 注意 `run_command` 在本侧**不是**读取手段：它根本不在 `AGY_WRITE_TOOLS`
   * 之外的白名单里，出现即失守，所以 `toolTotal` 不计入它（见 checkEvidence 的分档）。
   */
  capability: TOOL_TRACE_CAPABILITY,

  /**
   * 探活（M8 第 3 步从 `preflight` 搬来）。
   *
   * 指纹取只读审查 Agent 的定义文件：那份 `agent.md` 一改，白名单就换了，
   * 旧的「已认证」结论对新的工具面不再成立——所以它必须参与缓存失效判定。
   */
  authProbe(ctx: AdapterContext, projectRoot: string) {
    const cfg = ctx.cfg;
    return {
      async fingerprint() {
        const f = path.join(
          os.homedir(), '.gemini/config/agents',
          agentConfigOf(cfg, 'gemini', 'antigravity').agent, 'agent.md',
        );
        return (await exists(f)) ? sha256File(f) : null;
      },
      async probe() {
        const bin = cfg.probe.cli.agy?.entrypoint ?? null;
        if (!bin) return { ok: false, detail: 'agy 路径未记录' };
        const out = await invokeAgy({
          bin,
          cwd: projectRoot,
          prompt: '只回复 OK 两个字母，不要调用任何工具。',
          model: cfg.probe.cli.agy?.models[0] ?? null,
          agent: agentConfigOf(cfg, 'gemini', 'antigravity').agent,
          timeoutMs: 120_000,
          pty: cfg.probe.cli.agy?.pty_required === true,
        });
        const ok = out.parsed.status === 'SUCCESS' && !out.timedOut;
        return {
          ok,
          detail: ok
            ? `探活通过（${Math.round(out.durationMs / 1000)}s）`
            : `探活失败（status=${out.parsed.status}）。请先交互登录一次：\`agy\` 然后完成登录流程。\n` +
              `  stderr: ${out.stderr.slice(0, 200)}`,
        };
      },
    };
  },

  availability(ctx: AdapterContext) {
    /*
    * 「这一侧还没探过」与「探过、没找到可执行文件」是两回事：
    * 前者该去跑 doctor，后者是该侧真的不可用。
    *
    * 判据用 `probed_at` 而**不是** `!p`（审查意见 AGY-01）：`defaultProbe()` 为全部
    * 已登记 CLI 预填空壳、`patchProbe` 又按 default 补齐，于是 `p` 恒非空，
    * `if (!p)` 那一支恒不可达——两态会永远答同一句。这两处改动出自同一次提交，
    * 是我加的预填让我自己写的判据失效的。口径与 `preflight` 的
    * `if (!probe?.probed_at) continue` 和 doctor 的「未实现 CLI 答复」一致。
    */
    const p = ctx.cfg.probe.cli.agy;
    if (!p?.probed_at) {
      return { ok: false, reason: 'agy 尚未探测，请先运行 trivium doctor --only agy' };
    }
    if (!p.entrypoint) return { ok: false, reason: '探针未找到 agy 可执行文件，请先运行 trivium doctor' };
    if (p.headless_read_ok === false) {
      return {
        ok: false,
        reason:
          'agy headless 无法读取文件（issue #548）。请确认只读审查 Agent 已安装到 ' +
          `~/.gemini/config/agents/${agentConfigOf(ctx.cfg, 'gemini', 'antigravity').agent}/agent.md`,
      };
    }
    if (p.headless_read_ok === null) {
      return { ok: false, reason: '探针尚未实测 agy headless 读取能力，请先运行 trivium doctor' };
    }
    const agent = resolveAgyAgent(p, agentConfigOf(ctx.cfg, 'gemini', 'antigravity').agent);
    if (agent.reason) return { ok: false, reason: agent.reason };
    return { ok: true };
  },

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.cli.agy;
    // 两态判据同 availability()：以 probed_at 区分，不用 `!probe`（AGY-01）。
    if (!probe?.probed_at) {
      return failedResult('gemini', {
        status: 'failed',
        reason: 'agy 尚未探测，请先运行 trivium doctor --only agy',
      });
    }
    if (!probe.entrypoint) {
      return failedResult('gemini', { status: 'failed', reason: 'agy 入口未探测到' });
    }
    const bin = probe.entrypoint;

    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.jsonl');
    const tracePath = path.join(req.out_dir, 'trace.json');

    let out: AgyInvokeOutcome;
    try {
      out = await invokeAgy({
        bin,
        cwd: req.project_root,
        prompt: req.brief_text,
        model: req.model,
        // 探针验证过的 Agent，不是配置意图（P7）；availability 已挡掉 null 的情形
        agent: resolveAgyAgent(probe, agentConfigOf(ctx.cfg, 'gemini', 'antigravity').agent).agent,
        effort: req.effort ?? null,
        // 探针说 --json-schema 不可用时降级为提示词约定 + 宽松解析（AD-08）
        jsonSchemaPath: probe.json_schema_ok === false ? null : req.schema_path,
        timeoutMs: req.timeout_s * 1000,
        // 探针实测需要伪终端时才包装
        pty: probe.pty_required === true,
      });
    } catch (e) {
      return failedResult('gemini', { status: 'failed', reason: `拉起 agy 失败：${(e as Error).message}` });
    }

    // 原始输出与轨迹落在项目**外**的运行目录（§10.1 第 ② 道）
    await fs.writeFile(stdoutPath, out.stdout, 'utf8');
    await fs.writeFile(tracePath, JSON.stringify(out.parsed.toolCalls, null, 2), 'utf8');

    // 超时判定不能只看退出码：1.1.28 起 --print-timeout 到期会 exit 0（坑 P-07）
    const timedOut = out.timedOut || out.printTimeoutWarned;
    if (timedOut) {
      return failedResult('gemini', {
        status: 'timeout',
        reason: out.timedOut
          ? `脚本级超时（${req.timeout_s}s）`
          : 'agy 自报 print timeout，输出可能不完整',
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        tracePath,
        rawText: out.parsed.response || null,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.parsed.conversationId,
      });
    }

    // 软拒绝：exit 0 + status SUCCESS 但 denied_actions 非空，是 #548 的正脸
    if (out.parsed.deniedActions.length > 0 && out.parsed.response.trim().length === 0) {
      return failedResult('gemini', {
        status: 'failed',
        reason:
          `工具被 headless 软拒绝且无任何输出：${out.parsed.deniedActions.map((d) => d.action).join(', ')}` +
          '（issue #548）。检查只读 Agent 的 tools 白名单是否包含了需要审批的工具。',
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        tracePath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.parsed.conversationId,
      });
    }

    if (out.exitCode !== 0) {
      return failedResult('gemini', {
        status: 'failed',
        reason: `agy 非零退出（${out.exitCode}）：${out.stderr.slice(0, 300)}`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        tracePath,
        rawText: out.parsed.response || null,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.parsed.conversationId,
      });
    }

    /*
     * 生效模型（§11.2 要点 4）：
     * agy 的 init 事件带 model，是**回读**而非请求值，优先采信它。
     * 拿不到时可退到「预检已校验过的请求值」——因为未知 slug 会让 agy 直接非零退出，
     * 不会静默换模型。两者皆不成立记 unverified，不采信任何猜测。
     */
    const modelEffective = out.parsed.model ?? req.model ?? null;
    const modelSource: CriticResult['model_effective_source'] = out.parsed.model
      ? 'envelope'
      : req.model
        ? 'requested'
        : 'unverified';

    // 算一次就够：上一版在两个字段上各调了一遍，同一份轨迹被遍历两次
    const coverage = pathCoverage(out.parsed);

    return {
      critic: 'gemini',
      status: 'ok',
      exit_code: out.exitCode,
      duration_s: out.durationMs / 1000,
      raw_stdout_path: stdoutPath,
      trace_path: tracePath,
      review_json: null, // 由 parse 模块填充
      raw_response_text: out.parsed.response,
      model_effective: modelEffective,
      model_effective_source: modelSource,
      /*
       * 两个字段对本族**恒为 null，且这是能说明理由的空**：
       * agy 的 CLI 不暴露模型的 provider 归属（探针 `probes/agy.ts` 拿到的是
       * 一张扁平模型目录，没有家族字段），也没有厂商 profile 这个概念
       * （`GeminiCriticConfig` 里根本没有 `profile` 键）。
       * 不是「没采集」——没有这种事实可采。
       */
      model_provider: null,
      profile_requested: null,
      tool_calls: countTools(out.parsed),
      read_paths: readPaths(out.parsed),
      // 路径提取覆盖率：两者不等即提取器已相对厂商参数名退化（设计 §10.1.1 第②层）
      path_bearing_reads: coverage.total,
      path_bearing_reads_with_path: coverage.withPath,
      write_events: writeEvents(out.parsed),
      command_texts: commandTexts(out.parsed),
      evidence_ok: false, // 由 guard 判定
      fail_reason: null,
      session_id: out.parsed.conversationId,
      usage: out.parsed.usage,
      cli_version: probe.version,
      // M0 实测：agy 无路径级 deny 机制，此项恒为 false（§10.2 诚实边界）
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
