/**
 * 全局类型契约。
 *
 * 与四份 JSON Schema（skills/dual-critic/schema/）一一对应：
 *   trivium.config.v1      → Config
 *   trivium.review.v1      → Review / Finding
 *   trivium.disposition.v1 → Disposition / DispositionRow
 *   trivium.run.v1         → RunMeta
 * Schema 是运行时真理来源（ajv 校验），本文件是编译期的同一份约定。改一处必须改另一处。
 */

export type Stage = 'plan' | 'code' | 'bug';
export type StageOrVerify = Stage | 'verify';
export type CriticId = 'gemini' | 'glm';
export type Vendor = 'antigravity' | 'zcode';
export type Severity = 'blocker' | 'major' | 'minor' | 'nit';
export type Confidence = 'high' | 'medium' | 'low';
export type Verdict = 'approve' | 'approve-with-nits' | 'request-changes' | 'block';

export const STAGES: readonly Stage[] = ['plan', 'code', 'bug'];
export const CRITICS: readonly CriticId[] = ['gemini', 'glm'];
export const CRITIC_VENDOR: Record<CriticId, Vendor> = { gemini: 'antigravity', glm: 'zcode' };
/** 意见编号前缀，两侧不冲突（设计 §6.5） */
export const CRITIC_PREFIX: Record<CriticId, string> = { gemini: 'AGY', glm: 'GLM' };

// ─────────────────────────── 探针（设计 §3.5） ───────────────────────────

export interface PathDenyProbe {
  /** null = 尚未探测；false = 本机确认不支持，第 ③ 道屏蔽退化为禁读清单 + 轨迹核验 */
  supported: boolean | null;
  /** 可复用的规则写法，供适配层注入 deny_paths。不支持时为 null */
  rule_syntax: string | null;
  /** 该结论是怎么测出来的（人读，写进坑清单） */
  method?: string | null;
  /** 已尝试但不成立的注入点，避免下次重复试 */
  attempts?: string[];
}

export interface AgyProbe {
  bin: string | null;
  version: string | null;
  models: string[];
  /** headless 下是否真的会读文件（Antigravity issue #548 的本机判定） */
  headless_read_ok: boolean | null;
  /** --json-schema 是否能强制出可解析的结构化输出 */
  json_schema_ok: boolean | null;
  /** 管道下 stdout 是否为空、需要 `script -q /dev/null` 伪终端包装 */
  pty_required: boolean | null;
  path_deny: PathDenyProbe;
  /** Agent 在项目根自建的临时文件白名单，指纹比对时排除 */
  scratch_paths: string[];
  isolation: 'home_copy' | 'settings_path' | 'env' | 'shared';
  /** 达成 headless_read_ok 所需的额外手段，供适配层复现 */
  read_strategy?: 'default' | 'allow_settings' | 'pty' | 'add_dir' | null;
}

export interface ZcodeProbe {
  entry: string | null;
  version: string | null;
  /** 实测**实际被接受**的只读参数组合，不是文档上写的 */
  readonly_flags: string[];
  /** 模型覆盖实际生效的档位 */
  model_override: 'env' | 'config_copy' | 'global' | null;
  /**
   * 工具轨迹来源：**工具名、调用计数、生效模型、结构化失败根因**的路径模板。
   * M0 实测该日志的 `tool.call.*` 事件里**没有任何路径字段**。
   */
  trace_source: string | null;
  /**
   * 工具**参数**（含文件路径）的路径模板。
   * `deny_paths` 轨迹核验（AC-04）与 `consulted` 交叉核对（AC-11）只能从这里取值。
   */
  trace_args_source?: string | null;
  /** 正文字段路径，设计记载为 .response */
  response_field: string | null;
  path_deny: PathDenyProbe;
  scratch_paths: string[];
  isolation: 'home_copy' | 'settings_path' | 'env' | 'shared';
  /** 实测到的模型 id 规范写法（本机为 builtin:<provider>/<name> 形态） */
  model_id_form?: string | null;
  models?: string[];
}

export interface ProbeSection {
  generated_at: string | null;
  /** doctor 探测到的编译测试候选命令，仅供 init 展示确认，绝不自动执行（设计 §14.1） */
  verify_suggestion: { build: string[]; test: string[] };
  agy: AgyProbe;
  zcode: ZcodeProbe;
  /** preflight 探活结果的短 TTL 缓存 */
  auth?: { agy_checked_at?: string | null; zcode_checked_at?: string | null };
  /** 本机环境事实 */
  host?: {
    platform: string;
    arch: string;
    /** macOS 无 GNU coreutils 时为 false —— 超时必须在 Node 内实现 */
    has_timeout_bin: boolean;
    git_version: string | null;
  };
}

// ─────────────────────────── 配置（设计 §13.1） ───────────────────────────

export interface RuntimeConfig {
  node: string | null;
  run_root: string;
}

export interface IsolationConfig {
  peer_artifact_globs: string[];
  deny_via_cli: 'auto' | 'off';
  context_max_docs: number;
}

export interface ReviewConfig {
  parallel: boolean;
  failure_policy: 'strict' | 'degrade';
  allow_single_flag: boolean;
  timeout_s: Record<Stage, number>;
  wait_timeout_s: number;
  heartbeat_stale_s: number;
  retry: { transient_max: number };
  cache: boolean;
  min_tool_calls: Record<Stage, number>;
  min_project_reads: Record<Stage, number>;
  on_drift: 'warn' | 'fail';
  on_drift_related: 'warn' | 'fail';
  sensitive_globs: string[];
  block_severities: Severity[];
  skip_doc_only_review: boolean;
  skip_globs: string[];
  never_skip_globs: string[];
}

export interface GeminiCriticConfig {
  vendor: 'antigravity';
  bin: string | null;
  agent: string;
  effort: Record<Stage, 'low' | 'medium' | 'high'>;
  readonly_commands: string[];
}

export interface GlmCriticConfig {
  vendor: 'zcode';
  entry: string | null;
  max_turns: number;
  /** 模型覆盖落到 global 档时：reject 拒绝启动 / annotate 放行但标注（设计 §11.3） */
  unsupported_override: 'reject' | 'annotate';
}

export interface GateConfig {
  require_adjudication: boolean;
  allow_defer: boolean;
  block_business_write_when_awaiting_approval: boolean;
  approval_lock_scope: 'session' | 'global';
  approval_lock_ttl_h: number;
  block_commit: boolean;
  stop_hook_max_blocks: number;
  max_check_retries: number;
  reason_policy: 'warn' | 'hard';
  joint_blocker_policy: 'warn' | 'hard';
}

export type ProfileEntry = Partial<Record<Stage, string>> & { effort?: 'low' | 'medium' | 'high' };
export type Profile = Partial<Record<CriticId, ProfileEntry>>;

export interface Config {
  schema: 'trivium.config.v1';
  archive_root: string;
  topic: { max_len: number; forbid_chars: string[] };
  runtime: RuntimeConfig;
  isolation: IsolationConfig;
  review: ReviewConfig;
  critics: { gemini: GeminiCriticConfig; glm: GlmCriticConfig };
  profiles: Record<string, Profile>;
  active_profile: string;
  gate: GateConfig;
  preflight: { auth_cache_ttl_h: number };
  verify: { build: string[]; test: string[] };
  retention: { run_dir_days: number };
  probe: ProbeSection;
  probe_ttl_days: number;
}

/** 已解析的运行上下文：配置 + 本次调用的路径事实 */
export interface Ctx {
  config: Config;
  /** 项目根（git toplevel） */
  projectRoot: string;
  /** 归档根绝对路径 */
  archiveRoot: string;
  /** .trivium 目录绝对路径 */
  triviumDir: string;
  /** 配置来源，供 doctor/status 展示 */
  sources: string[];
}

// ─────────────────────── 审查结论（trivium.review.v1，§6.5） ───────────────────────

export interface Finding {
  id: string;
  severity: Severity;
  layer: 'requirement' | 'plan' | 'code' | 'rca';
  kind:
    | 'correctness' | 'security' | 'concurrency' | 'contract'
    | 'test-gap' | 'maintainability' | 'scope-drift' | 'performance';
  location: string;
  problem: string;
  evidence: string;
  suggestion: string;
  confidence: Confidence;
}

export interface Review {
  schema: 'trivium.review.v1';
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  agreed?: string[];
  not_covered?: string[];
  /** 审查员实际读过的项目文件，与工具轨迹交叉核对（§11.4） */
  consulted?: string[];
}

// ─────────────────── 裁决件（trivium.disposition.v1，§6.6） ───────────────────

export type Disposal = '接受' | '驳回' | '暂缓';

export interface DispositionRow {
  id: string;
  source: CriticId | 'fallback';
  severity: Severity | null;
  disposal: Disposal;
  reason: string;
  action: string;
}

export interface Disposition {
  schema: 'trivium.disposition.v1';
  topic: string;
  stage: Stage;
  role: 'claude';
  kind: 'revised' | 'response';
  run_id: string;
  addresses: string[];
  rows: DispositionRow[];
}

// ─────────────────── 运行元数据（trivium.run.v1，§6.7） ───────────────────

export interface ToolCallCounts {
  read?: number;
  grep?: number;
  glob?: number;
  run_command?: number;
  /** 被审对象与送审包之外的项目文件读取次数（§11.4 的 AC-11 落点） */
  project_reads?: number;
}

export interface CriticRunMeta {
  vendor: Vendor;
  cli_version: string | null;
  model_requested: string | null;
  model_effective: string | null;
  model_effective_source?: 'envelope' | 'trace' | 'requested' | 'unverified';
  model_route?: 'env' | 'config_copy' | 'global';
  effort?: string;
  status: 'ok' | 'timeout' | 'failed' | 'parse_fallback';
  exit_code: number | null;
  duration_s: number;
  tool_calls: ToolCallCounts;
  evidence_ok: boolean;
  usage?: Record<string, number>;
  heterogeneous: boolean;
  fail_reason?: string | null;
  empty_review?: boolean;
  parse_fallback?: boolean;
  session_id?: string | null;
  peer_deny_applied?: boolean;
}

export interface SnapshotMeta {
  git_head: string | null;
  tree_hash: string;
  dirty: boolean;
  subject_sha256: string;
  drift: { changed: boolean; files: string[]; policy: 'warn' | 'fail' };
}

export interface RunMeta {
  schema: 'trivium.run.v1';
  run_id: string;
  topic: string;
  stage: Stage;
  rerun_index: number;
  command: string;
  prompt_hint: string | null;
  snapshot: SnapshotMeta;
  started_at: string;
  finished_at: string | null;
  review_mode: 'dual' | 'single';
  degraded_reason: string | null;
  critics: Partial<Record<CriticId, CriticRunMeta>>;
  deny_paths: string[];
  guard: {
    readonly_breach: boolean;
    peer_artifact_read: boolean;
    peer_deny_applied: Partial<Record<CriticId, boolean>>;
    forged_role_file: boolean;
    breached_files?: string[];
  };
  artifacts: { path: string; sha256: string }[];
  gate: { adjudication_complete: boolean; state: string; warnings?: string[] };
  status: 'running' | 'success' | 'failed' | 'cancelled';
  skipped?: boolean;
  skip_reason?: string | null;
  cache_hit?: boolean;
}

// ─────────────────── 适配层契约（设计 §11.1） ───────────────────

export interface CriticRequest {
  run_id: string;
  topic: string;
  stage: Stage;
  critic: CriticId;
  project_root: string;
  subject_path: string;
  deny_paths: string[];
  home_dir?: string | null;
  out_dir: string;
  brief_path: string;
  brief_text: string;
  model: string;
  effort?: string;
  timeout_s: number;
  schema_path: string;
  min_tool_calls: number;
  min_project_reads: number;
}

export interface CriticResult {
  critic: CriticId;
  status: 'ok' | 'timeout' | 'failed' | 'parse_fallback';
  exit_code: number | null;
  duration_s: number;
  raw_stdout_path: string;
  trace_path: string | null;
  review_json: Review | null;
  raw_response_text: string | null;
  model_effective: string | null;
  model_effective_source: 'envelope' | 'trace' | 'requested' | 'unverified';
  model_route?: 'env' | 'config_copy' | 'global';
  tool_calls: ToolCallCounts;
  /** 轨迹中出现过的读取路径（项目相对），供 deny_paths 核验与 consulted 交叉核对 */
  read_paths: string[];
  /** 轨迹中出现过的写工具/写命令事件，非空即 readonly_breach */
  write_events: string[];
  evidence_ok: boolean;
  fail_reason: string | null;
  session_id: string | null;
  usage?: Record<string, number>;
  cli_version: string | null;
  peer_deny_applied: boolean;
  command_line: string;
}
