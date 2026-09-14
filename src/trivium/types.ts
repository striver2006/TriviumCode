/**
 * 全局类型契约。
 *
 * 与四份 JSON Schema（skills/dual-critic/schema/）一一对应：
 *   trivium.config.v1      → Config
 *   trivium.review.v1      → Review / Finding
 *   trivium.disposition.v1 → Disposition / DispositionRow
 *   trivium.run.v2         → RunMeta（v1 是历史契约，只读侧认，见 meta.ts 的 migrateRunMetaV1）
 * Schema 是运行时真理来源（ajv 校验），本文件是编译期的同一份约定。改一处必须改另一处。
 */

import { agentById, CRITIC_AGENT_IDS, type AgentId, type AgentVendor } from './agents/registry.js';

export type { AgentId, AgentVendor };

export type Stage = 'plan' | 'code' | 'bug';
export type StageOrVerify = Stage | 'verify';
/** 发起本次运行的斜杠命令（设计 §7.1）：A 全流程 / B 计划审 / C 代码审 / D 根因审 */
export type CommandEntry = 'A' | 'B' | 'C' | 'D';
export const COMMAND_ENTRIES: readonly CommandEntry[] = ['A', 'B', 'C', 'D'];
/**
 * 当前可选为审核者的 Agent。
 *
 * M7a 仍是两值——与重构前逐项相同（行为等价）。它现在由
 * `agents/registry.ts` 的 `criticEnabled` 派生而非独立定义：
 * M8 / M9 启用 codex / claude 时只改注册表，本别名自动跟随。
 */
export type CriticId = Extract<AgentId, 'gemini' | 'glm'>;
/**
 * 厂商标识。**直接就是注册表的 `AgentVendor`**（M7b 第 3 步收口 EV-03）。
 *
 * 此前它是独立的两值 union `'antigravity' | 'zcode'`，与注册表的四值 union
 * 各写一份。后果不是「多写一遍」而是**编译期防错被一个断言穿掉**：
 * `CRITIC_VENDOR` 的派生处写着 `agentById(c)!.vendor as Vendor`，把四值宽 union
 * 断言成两值窄 union，恒编译通过。于是新增一家审核者时，这条链不会像
 * `effortFor` / `checkModelSlugs` 的 `never` 分支那样在编译期报错，
 * 而是把新 vendor 静默塞进值位，直到落盘被 schema 枚举拒掉才现形。
 *
 * 收口的前提是 `run.v2` 的 `vendor` 不再枚举两值（见 run.v2.json 的说明），
 * 所以这条与本步的数据契约升版是同一件事，不能单独提前做——这也是
 * BACKLOG EV-03 当初被判为「随 run.v2 一并处理」的理由。
 */
export type Vendor = AgentVendor;
export type Severity = 'blocker' | 'major' | 'minor' | 'nit';
export type Confidence = 'high' | 'medium' | 'low';
export type Verdict = 'approve' | 'approve-with-nits' | 'request-changes' | 'block';

export const STAGES: readonly Stage[] = ['plan', 'code', 'bug'];

/*
 * ── 以下三张表由注册表派生，不再手写字面量（计划 §2.1）──
 *
 * 重构前它们是三份独立的字面表，新增一家要改三处、改一漏二不会报错。
 * 现在唯一来源是 `agents/registry.ts`，`registry-parity.test.ts` 对账。
 */

export const CRITICS: readonly CriticId[] = CRITIC_AGENT_IDS as readonly CriticId[];

export const CRITIC_VENDOR: Record<CriticId, Vendor> = Object.fromEntries(
  CRITICS.map((c) => [c, agentById(c)!.vendor]),
) as Record<CriticId, Vendor>;

/** 意见编号前缀，各家不冲突（设计 §6.5） */
export const CRITIC_PREFIX: Record<CriticId, string> = Object.fromEntries(
  CRITICS.map((c) => [c, agentById(c)!.findingPrefix]),
) as Record<CriticId, string>;

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
  /**
   * 探针**实际用来验证**的只读 Agent 名：agent.md 存在时为配置的名字，不存在时探针
   * 改用默认 Agent 探测、此处为 null。适配层一律用这个值（P7：命令行由探针结论构造）——
   * 原先适配层取配置里的名字，与探针验证过的配置不是同一个，agent.md 缺失时只读白名单失效。
   * 旧探针结论没有该字段（undefined）：适配层回退到配置名。
   */
  agent?: string | null;
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

export interface AuthCacheEntry {
  checked_at: string;
  cli_version: string | null;
  /** 决定可用性的配置文件指纹：agy 取 Agent 定义哈希，zcode 取 CLI config.json 哈希 */
  fingerprint: string | null;
  /** 恒为 true——负结论不入缓存 */
  ok: true;
}

export interface ProbeSection {
  generated_at: string | null;
  /** doctor 探测到的编译测试候选命令，仅供 init 展示确认，绝不自动执行（设计 §14.1） */
  verify_suggestion: { build: string[]; test: string[] };
  agy: AgyProbe;
  zcode: ZcodeProbe;
  /**
   * preflight 探活结果的短 TTL 缓存（审查意见 AGY-02 / GLM-06）。
   *
   * 只有时间戳是不够的：ZCode 的 CLI 版本长期不变，但可用性取决于
   * `~/.zcode/cli/config.json` 的 provider 与 apiKey（坑 P-08 / P-10）；
   * Antigravity 的只读保障取决于 Agent 定义文件存在。因此缓存键要含
   * **版本 + 配置指纹**，任一变化即失效。
   *
   * 且**只缓存正结论**：失败探活本身快且便宜，缓存负结论会把「用户交互登录修复后」
   * 挡在 TTL 之外，而 `--skip-auth-check` 是跳过而非刷新、缓存依然是脏的。
   */
  auth?: Partial<Record<CriticId, AuthCacheEntry>>;
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
  /**
   * `null` = 来源无法判定（`来源` 列缺失或写错，且编号前缀未登记）。
   *
   * 重构前这里不可为 null，因为 `inferSource` 用三目兜底保证「总有个值」——
   * 代价是第三家的编号被静默归给 glm（计划 §2.2 / A-1）。现在无匹配如实记 null，
   * 由解析器报出 problem，而不是编一个来源出来。
   */
  source: CriticId | 'fallback' | null;
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

// ────────────────── 运行元数据（trivium.run.v2，§6.7.1） ──────────────────

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

/**
 * 本轮审查的完成度（`run.v2`，取代 v1 的 `dual` / `single`）。
 *
 * `full` = 入选的审核者全部成功；`partial` = 有入选者失败后降级续跑。
 * **它只回答「入选的都成了吗」，不回答「跑了几侧」**——后者看 `critics_selected`。
 * v1 把这两件事挤进一个值，于是 `--only gemini` 成功跑完被记成 `dual`（§2.1）：
 * 留痕上看不出本轮只审了一侧，AC-06 的可核对性形同虚设。
 */
export type ReviewMode = 'full' | 'partial';

/**
 * v1 时代的完成度取值。**只出现在读侧**：既有归档里的 v1 记录按写入时的规范
 * 解读，读进内存时映射为 `ReviewMode`（`dual → full`、`single → partial`）。
 */
export type LegacyReviewMode = 'dual' | 'single';

export interface RunMeta {
  schema: 'trivium.run.v2';
  run_id: string;
  topic: string;
  stage: Stage;
  rerun_index: number;
  command: string;
  prompt_hint: string | null;
  /** 送进 BRIEF 第 4 段的任务目标；便于事后追溯审查员当时看到的是什么 */
  task_goal: string | null;
  /** 发起本次运行的斜杠命令；null 表示直接从命令行手工调用 */
  entry?: CommandEntry | null;
  /**
   * **当轮发起方**的 Agent id（§6.7.1）。与归档后缀（产出方）正交：
   * 同一 Agent 在不同运行里可能是 Driver 也可能是审核者，
   * 这条正交性正是禁读矩阵不能按后缀差集生成的根本原因。
   * M7b 起恒为 `claude`，M10 放开 `--driver` 后才会变。
   */
  driver: AgentId;
  /**
   * 本轮**入选**的审核者集合（基数 1～3，FR-29）。
   *
   * 与 `critics` 的键集**不是一回事**：后者是「实际产出了结果的」，
   * 入选却整侧失联时它就少一个键。要区分「计划跑但失败了」与「压根没入选」，
   * 只能靠本字段——这也是 `gate` 判定缺件、`render` 渲染参与者事实的依据。
   */
  critics_selected: CriticId[];
  snapshot: SnapshotMeta;
  started_at: string;
  finished_at: string | null;
  review_mode: ReviewMode;
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
