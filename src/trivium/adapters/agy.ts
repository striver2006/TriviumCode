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
import { promises as fs } from 'node:fs';
import type { CriticRequest, CriticResult } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir } from '../util/fsx.js';
import {
  parseAgyStream,
  readPaths,
  successfulToolCalls,
  writeEvents,
  AGY_READ_TOOLS,
  type AgyStreamResult,
} from './agy-events.js';
import { failedResult, type AdapterContext, type CriticAdapter } from './base.js';

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

/** 拼装并执行一次 agy headless。**唯一**构造 agy 命令行的地方 */
export async function invokeAgy(opts: AgyInvokeOptions): Promise<AgyInvokeOutcome> {
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

  const r = await run(opts.bin, args, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
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
  void AGY_READ_TOOLS;
  return counts;
}

export const agyAdapter: CriticAdapter = {
  critic: 'gemini',

  availability(ctx: AdapterContext) {
    const p = ctx.cfg.probe.agy;
    if (!p.bin) return { ok: false, reason: '探针未找到 agy 可执行文件，请先运行 trivium doctor' };
    if (p.headless_read_ok === false) {
      return {
        ok: false,
        reason:
          'agy headless 无法读取文件（issue #548）。请确认只读审查 Agent 已安装到 ' +
          `~/.gemini/config/agents/${ctx.cfg.critics.gemini.agent}/agent.md`,
      };
    }
    if (p.headless_read_ok === null) {
      return { ok: false, reason: '探针尚未实测 agy headless 读取能力，请先运行 trivium doctor' };
    }
    return { ok: true };
  },

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.agy;
    const bin = probe.bin;
    if (!bin) {
      return failedResult('gemini', { status: 'failed', reason: 'agy bin 未探测到' });
    }

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
        agent: ctx.cfg.critics.gemini.agent,
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
      tool_calls: countTools(out.parsed),
      read_paths: readPaths(out.parsed),
      write_events: writeEvents(out.parsed),
      evidence_ok: false, // 由 guard 判定
      fail_reason: null,
      session_id: out.parsed.conversationId,
      usage: out.parsed.usage,
      cli_version: probe.version,
      // M0 实测：agy 无路径级 deny 机制，此项恒为 false（§10.2 诚实边界）
      peer_deny_applied: probe.path_deny.supported === true,
      command_line: out.commandLine,
    };
  },
};
