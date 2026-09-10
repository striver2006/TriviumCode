/**
 * 适配层统一契约（设计 §11.1）。
 *
 * 适配层是**唯一**允许调用厂商 CLI 的地方（§5.1）。它把两家的差异
 * （参数、输出字段、模型指定方式、只读方式、轨迹来源）收敛为一组请求/结果结构，
 * 上层的 runner / parse / guard 只面对这组结构。
 *
 * 铁律（原则 P7）：命令行**一律由 probe 结论构造**，不得硬编码设计文档里的示例。
 */
import type { Config, CriticId, CriticRequest, CriticResult, Stage } from '../types.js';

export interface AdapterContext {
  cfg: Config;
  /** node 绝对路径（GUI 进程不读 .zshrc，§10.5） */
  nodePath: string;
}

export interface CriticAdapter {
  readonly critic: CriticId;
  /** 该侧是否可用（探针结论决定）。不可用时给出人读原因 */
  availability(ctx: AdapterContext): { ok: boolean; reason?: string };
  run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult>;
}

/** 失败结果的统一构造，避免各适配器自行拼字段时漏项 */
export function failedResult(
  critic: CriticId,
  fail: {
    status: 'timeout' | 'failed' | 'parse_fallback';
    reason: string;
    exitCode?: number | null;
    durationS?: number;
    rawStdoutPath?: string;
    tracePath?: string | null;
    rawText?: string | null;
    cliVersion?: string | null;
    commandLine?: string;
    sessionId?: string | null;
  },
): CriticResult {
  return {
    critic,
    status: fail.status,
    exit_code: fail.exitCode ?? null,
    duration_s: fail.durationS ?? 0,
    raw_stdout_path: fail.rawStdoutPath ?? '',
    trace_path: fail.tracePath ?? null,
    review_json: null,
    raw_response_text: fail.rawText ?? null,
    model_effective: null,
    model_effective_source: 'unverified',
    tool_calls: {},
    read_paths: [],
    write_events: [],
    evidence_ok: false,
    fail_reason: fail.reason,
    session_id: fail.sessionId ?? null,
    cli_version: fail.cliVersion ?? null,
    peer_deny_applied: false,
    command_line: fail.commandLine ?? '',
  };
}

/**
 * 判定 Agent 执行证据是否达标（设计 §11.4，五项检查中的前三项）。
 *
 * 这不是可选项：Antigravity 的软拒绝会产生「exit 0 但零工具调用」的空审查，
 * 因此工具轨迹下限是 AC-05 的强制落点。
 */
export interface EvidenceCheck {
  ok: boolean;
  reasons: string[];
  /** 被审对象与送审包之外的项目文件读取次数（AC-11） */
  projectReads: number;
}

export function checkEvidence(
  result: Pick<CriticResult, 'tool_calls' | 'read_paths' | 'trace_path'>,
  req: Pick<CriticRequest, 'min_tool_calls' | 'min_project_reads' | 'subject_path' | 'brief_path' | 'project_root'>,
  opts: { archiveRootAbs: string },
): EvidenceCheck {
  const reasons: string[] = [];

  const tc = result.tool_calls;
  const toolTotal = (tc.read ?? 0) + (tc.grep ?? 0) + (tc.glob ?? 0);

  // ① 轨迹存在
  if (result.trace_path === null && result.read_paths.length === 0 && toolTotal === 0) {
    reasons.push('no_trace：拿不到任何工具调用轨迹');
  }

  // ② 读文件次数下限
  if (toolTotal < req.min_tool_calls) {
    reasons.push(`insufficient_evidence：工具调用 ${toolTotal} 次 < 下限 ${req.min_tool_calls}`);
  }

  // ③ 项目文件读取下限——防止「把 BRIEF 与被审文档反复读 N 遍」通过上一条
  const excluded = [req.subject_path, req.brief_path].map((p) => p.replace(/\/+$/, ''));
  const projectReads = result.read_paths.filter((p) => {
    if (excluded.includes(p)) return false;
    // 归档根内的文件不算「项目上下文」——那是审查材料本身
    return !p.startsWith(opts.archiveRootAbs);
  }).length;

  if (projectReads < req.min_project_reads) {
    reasons.push(
      `no_project_context：被审对象与送审包之外的项目文件读取 ${projectReads} 次 < 下限 ${req.min_project_reads}`,
    );
  }

  return { ok: reasons.length === 0, reasons, projectReads };
}

/** 轨迹核验：读取路径中是否命中禁读清单（§10.1 第 ③ 道 (c) 层 / AC-04） */
export function checkPeerLeak(
  readPaths: readonly string[],
  denyPaths: readonly string[],
  projectRoot: string,
): { leaked: boolean; hits: string[] } {
  const denySet = new Set(denyPaths);
  const hits = readPaths.filter((p) => {
    // 轨迹里可能是绝对路径，禁读清单是项目相对路径，两边都比一次
    if (denySet.has(p)) return true;
    if (p.startsWith(projectRoot)) {
      const rel = p.slice(projectRoot.length).replace(/^\/+/, '');
      return denySet.has(rel);
    }
    return false;
  });
  return { leaked: hits.length > 0, hits: [...new Set(hits)] };
}

/** 模型路由：命令行参数 > 主题级覆盖 > profile > 阶段默认（设计 §11.5 四级） */
export function routeModel(
  cfg: Config,
  critic: CriticId,
  stage: Stage,
  overrides: { cli?: string | null; topic?: string | null } = {},
): { model: string | null; source: 'cli' | 'topic' | 'profile' | 'none' } {
  if (overrides.cli) return { model: overrides.cli, source: 'cli' };
  if (overrides.topic) return { model: overrides.topic, source: 'topic' };
  const profile = cfg.profiles[cfg.active_profile];
  const fromProfile = profile?.[critic]?.[stage];
  if (fromProfile) return { model: fromProfile, source: 'profile' };
  return { model: null, source: 'none' };
}

/** 是否与主脑异构（FR-17 / AC-18）：Claude 系模型即为同源 */
export function isHeterogeneous(model: string | null): boolean {
  if (!model) return true;
  return !/claude/i.test(model);
}
