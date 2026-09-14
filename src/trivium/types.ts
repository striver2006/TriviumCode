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
 * 可出现在「审核者」位置的 Agent —— **就是注册表的全集**（M7b 第 6 步放开）。
 *
 * ## 为什么是全集，而不是「当前启用的那几家」
 *
 * 想要的显然是后者，但 TypeScript 表达不了：`criticEnabled` 是运行期的字段值，
 * 类型层取不到 `AGENTS.filter(...)` 的结果。能写出来的只有两种形态——
 * 注册表全集，或者**再手写一遍**的字面 union。
 *
 * 此前用的是后者（`Extract<AgentId, 'gemini' | 'glm'>`），而它的注释写着
 * 「M8 / M9 启用时只改注册表，本别名自动跟随」。**那句话是假的**：`Extract`
 * 的第二个参数就是手写的两值，注册表把 codex 的 `criticEnabled` 改成 true
 * 之后它纹丝不动。于是「唯一登记处」在这一处是破的——注册表说三家，类型说两家，
 * 中间靠 `CRITICS` 那个 `as` 断言把差异抹平。第 6 步的桩夹具正是被它卡住：
 * 夹具只许改注册表与接入套件（设计 5.1.1），改不到这里，类型层就永远不认第三家。
 *
 * 全集的代价是**类型层不再拦「把 Driver 当审核者用」**。这个代价是可接受的，
 * 因为那道防线本来就不该由类型承担：`resolveCriticSelection` 里「当轮 Driver
 * 不得入选」是**独立检查**，不依赖 `criticEnabled` 顺带生效（M7b 第 5 步的取舍之一）。
 * 类型层收窄给的是一种错觉——它挡的是字面量写错，挡不住任何来自配置或命令行的值，
 * 而后者才是真实入口。
 *
 * **运行期的真集合始终是 `CRITICS`**（由 `criticEnabled` 派生）。
 */
export type CriticId = AgentId;
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

/** 隔离手段。探针实测「独立 HOME / 独立 settings 路径 / 仅环境变量 / 共享」中首个可用者 */
export type ProbeIsolation = 'home_copy' | 'settings_path' | 'env' | 'shared';

/**
 * 复现「取版本」这一步所需的调用方式，由探针落盘、`preflight` 复用。
 *
 * 存在的理由是 P7 的直接应用：**命令行由探针结论构造，不由读侧按家分支猜**。
 * 两家的取法真的不同——agy 是 `agy --version` 取全文，
 * zcode 是 `node zcode.cjs version` 再正则抠三段号。原先这条知识写死在
 * `checkCliVersions` 的两个分支里，于是第三家的版本漂移一律不被检查
 * （BACKLOG EV-05②）。搬进探针结论之后，读侧只剩一条规则。
 */
export interface VersionProbe {
  /**
   * 需要用哪个运行时来跑 entrypoint。
   *
   * `null` = 直接执行 entrypoint 本身（agy）；
   * `'node'` = 用 Node 跑（zcode 的 .cjs）——**记的是「要 node」这个事实，
   * 不是某个 node 的绝对路径**：路径随机器和版本管理器变，落盘会立刻过期。
   */
  runner: 'node' | null;
  /** 传给 CLI 的参数，不含 entrypoint 本身 */
  args: string[];
  /** 从 stdout 抠版本号的正则（取第 1 捕获组）。null = 取 trim 后的全文 */
  extract: string | null;
}

/**
 * 各家探针结论的**共有事实**（M6 第 1 步）。
 *
 * 抽取判据不是「看起来像」，而是**泛化读侧真正需要什么**：
 * `preflight` 的版本漂移比对要 `entrypoint` + `version`，
 * `guard` 的只读失守判定要 `scratch_paths`，
 * TTL 新鲜度要 `probed_at`。这三处都不需要任何一家的特有字段，
 * 所以它们——且只有它们——进共有面。特有字段留在各家 interface 里，
 * 由各家适配器消费（纪律 10 对适配器内部的豁免）。
 *
 * ## 为什么是 `entrypoint` 而不是保留 `bin` / `entry`
 *
 * 两家原先各叫各的（agy 记 `bin`、zcode 记 `entry`），于是「怎么取可执行路径」
 * 成了一条**按家分叉的知识**，`checkCliVersions` 只能写死两个分支——
 * 那正是 EV-05② 里「第三家的 CLI 在不在一律不被检查」的成因。
 * 统一成一个名字之后，版本比对只需要「取 entrypoint 跑 --version」这一条规则，
 * 对第几家都成立。
 *
 * **不保留旧名做别名**：那会让同一个事实有两个字段，写入方稍不注意就写岔。
 * 盘上旧结论由 `migrateProbeSection` 在读盘时搬到新名，一次性完成。
 */
export interface CommonProbe {
  /** CLI 可执行入口的绝对路径。null = 未探到（该侧不可用） */
  entrypoint: string | null;
  /** CLI 自报版本。`preflight` 据此判漂移 */
  version: string | null;
  /** 怎么再取一次版本。null = 探针没记，该侧的版本漂移无法检查（如实报告，不静默） */
  version_probe: VersionProbe | null;
  /**
   * **这一键**是何时探的。
   *
   * 与 `ProbeSection.generated_at` 分工不同：那个记的是「探针段整体最后写过的时刻」，
   * 任何一次 `doctor` 都会刷新它。若 TTL 只看它，`doctor --only codex` 会把
   * agy / zcode 的过期结论一并刷成「新鲜」——审查意见 GLM-03 实测指出的失真。
   * 按键判定之后，没重探的键该过期照样过期。
   */
  probed_at: string | null;
  /** 该 CLI 可用的模型 slug 目录。空数组 = 未探到或该家无目录概念 */
  models: string[];
  path_deny: PathDenyProbe;
  /** Agent 在项目根自建的临时文件白名单，指纹比对时排除 */
  scratch_paths: string[];
  isolation: ProbeIsolation;
}

export interface AgyProbe extends CommonProbe {
  /** headless 下是否真的会读文件（Antigravity issue #548 的本机判定） */
  headless_read_ok: boolean | null;
  /** --json-schema 是否能强制出可解析的结构化输出 */
  json_schema_ok: boolean | null;
  /** 管道下 stdout 是否为空、需要 `script -q /dev/null` 伪终端包装 */
  pty_required: boolean | null;
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

export interface ZcodeProbe extends CommonProbe {
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
  /** 实测到的模型 id 规范写法（本机为 builtin:<provider>/<name> 形态） */
  model_id_form?: string | null;
}

/**
 * Codex CLI 的探针结论（M6 第 2 步，本机实测 `codex-cli 0.154.0`）。
 *
 * **每个字段都注明谁消费、什么时候消费。** 这是 BACKLOG EV-06 的直接应用——
 * 那条记的是 `instructionFiles` 登记了却没有任何读取方，于是「登记」被误读成「已生效」。
 * 探针结论天然是给后续里程碑用的，但「M8 会用」和「没人会用」必须当场分得清。
 */
export interface CodexProbe extends CommonProbe {
  /**
   * `codex exec` headless 下能否真的读到文件（哨兵首行回显命中）。
   * **消费方**：M8 适配器的 `availability()`——false 即该侧不可用。
   */
  exec_headless_read_ok: boolean | null;
  /**
   * `--json` 事件流里出现过的**顶层事件类型**（`thread.started` / `turn.completed` …）。
   * **消费方**：M8 的轨迹解析器；新类型出现时提示重录样本。
   */
  json_event_types: string[];
  /**
   * 出现过的 **item 类型**（`command_execution` / `agent_message` / `error` …）。
   *
   * 与上一字段分开记（审查意见 GLM-08）：原先合并去重成一个列表，
   * 而两个名字空间混在一起后不可区分（`error` 是 item 类型、`turn.started` 是事件类型），
   * 「新类型出现就重录样本」这条消费口径本应对 **item 类型**敏感，合并会把它变粗。
   * 解析器内部本来就维护着两个独立集合，合并那一步才是多余的。
   */
  json_item_types: string[];
  /**
   * 读取路径能否从轨迹里**结构化**取出。
   *
   * 本机实测 **false**：codex 让模型跑 shell（`/bin/zsh -lc 'head -n 1 …'`），
   * 路径只存在于 `command` 文本里，没有独立字段。
   * **消费方**：M8 的 `project_reads` 统计与禁读核验——false 时两者都只能走
   * 命令文本解析（BACKLOG EV-01 的措施 b，对 codex 是唯一手段而非补充）。
   */
  trace_path_structured: boolean | null;
  /**
   * 被沙箱拒绝的命令是否留在轨迹里。
   *
   * 本机实测 **false**：写入被拒时 `command_execution` 事件一条都不产生。
   * **消费方**：`guard` 的 `write_events` 判定——false 意味着设计 §10.3
   * 「轨迹有写事件即判失守」对该侧恒为假，只读保障完全落在沙箱上。
   * 这不是安全漏洞（写确实被挡住了），是**检测盲区**，必须如实记而不是留空。
   */
  rejected_command_in_trace: boolean | null;
  /**
   * 实测**实际被接受**的只读参数组合。
   * **消费方**：M8 适配器构造命令行（P7：命令行由探针结论构造）。
   */
  readonly_flags: string[];
  /**
   * `-p <name>` 是否真实生效（同一 `-m` 下 provider 随 profile 改变即为真）。
   * **消费方**：M11 的档位路由选型——决定走 profile 还是 `-c` 覆盖。
   */
  profile_flag: boolean | null;
  /**
   * 未知 profile 名是否被 CLI 拒绝。
   *
   * 本机实测 **false**：`-p __no_such__` 不报错，**静默回落基底配置**。
   * **消费方**：M8 的预检——false 意味着拼错 profile 名不会有任何提示，
   * 用户以为跑的是 deepseek、实际跑的是基底那家，因此预检**必须自己拦**。
   */
  unknown_profile_rejected: boolean | null;
  /**
   * 可用的 profile 名单。
   *
   * 取法是枚举 `$CODEX_HOME/*.config.toml`，**不是**读 `config.toml` 的
   * `[profiles.*]` 段——0.154.0 的 `-p` 是文件分层机制（`CONFIG_PROFILE_V2`），
   * 那个段在本机五份 toml 里一个都没有。按设计原定义取，名单会**恒为空**，
   * 而 M8 的「未知 profile 拦截」是「名单为空即跳过」，于是那道拦截静默失效。
   * **消费方**：M8 预检校验 `--profile` 取值。
   */
  profiles: string[];
  /**
   * `-c key=value`（dotted path，值按 TOML 解析）是否真实生效。
   * **消费方**：M11 档位路由的备选路径；也是 `model_catalog` 探测本身的手法。
   */
  config_override: boolean | null;
  /**
   * 客户端是否校验 effort 档位在该模型的支持列表内。
   *
   * 本机实测 **false**：目录只声明 `low|medium|high`，而 `xhigh` 照样被透传。
   * **消费方**：`preflight` 的档位校验——false 意味着写错档位不会被 CLI 拦，
   * 得像校验 model slug 一样自己校验。
   */
  effort_validated: boolean | null;
  /**
   * 模型目录文件的来源路径（从配置的 `model_catalog_json` 读出，**不写死**）。
   *
   * 演进设计写的是 `~/.codex/model-catalog.local.json`，本机实际是
   * `~/.codex/models-qwen.json` 一类随 provider 一份的文件——按设计写死路径
   * 会对一台**配置正确**的机器判出假阴性（原则 P7）。
   *
   * **口径**：优先取本次探针实际使用的 profile 文件里的 `model_catalog_json`，
   * 取不到再回落基底 `config.toml`。profile 是文件分层机制（C-1），
   * `<name>.config.toml` 同样能设这个键，只读基底会记错活跃档位下的目录
   * （审查意见 GLM-09）。
   * **消费方**：人读诊断与 `doctor` 报告。
   */
  model_catalog_path: string | null;
}

export interface AuthCacheEntry {
  checked_at: string;
  cli_version: string | null;
  /** 决定可用性的配置文件指纹：agy 取 Agent 定义哈希，zcode 取 CLI config.json 哈希 */
  fingerprint: string | null;
  /** 恒为 true——负结论不入缓存 */
  ok: true;
}

/**
 * 各 CLI 的探针结论表，**按 `cliName` 索引**（M6 第 1 步，审查意见 AGY-01 / GLM-04）。
 *
 * ## 键集与类型是两件事，不是两份事实源
 *
 * - **键集**的唯一来源是注册表的 `ALL_CLI_NAMES`。谁该有一段、`--only` 接受哪些取值、
 *   `defaultProbe` 生成哪些键，全从那里派生——加一家 CLI 不必改本文件。
 * - **类型**为已实现专属形状的两家给出精确定义。这不是枚举身份：各家探针结论的
 *   字段本来就不同（agy 有 `pty_required`、zcode 有 `response_field`），
 *   那是**真实差异**，泛化不掉也不该泛化。尚未实现专属形状的 CLI 落 `CommonProbe`。
 *
 * `registry-parity` 以「探针段具名键 ⊆ cliName 集」守着两者不分叉。
 *
 * ## 为什么每个键都是可选的
 *
 * 「这家还没探过」与「探过、结论为否」必须可区分——前者该提示去跑 doctor，
 * 后者该如实报告该侧不可用。这与 M7b 第 6 步 `checkModelSlugs` 引入
 * 「无法校验」第三态是同一条口径：**静默通过会让「校验了」与「没得校验」长得一模一样。**
 */
export type ProbeByCli = { [cliName: string]: CommonProbe | undefined } & {
  agy?: AgyProbe;
  zcode?: ZcodeProbe;
  codex?: CodexProbe;
};

export interface ProbeSection {
  /**
   * 探针段**整体**最后写过的时刻。
   *
   * 注意它**不是** TTL 判据：按键的新鲜度看 `CommonProbe.probed_at`。
   * 两者分开的理由写在那个字段上（GLM-03）。这里保留它是为了回答
   * 「这份 config.local.yaml 上次被 doctor 动过是什么时候」。
   */
  generated_at: string | null;
  /** doctor 探测到的编译测试候选命令，仅供 init 展示确认，绝不自动执行（设计 §14.1） */
  verify_suggestion: { build: string[]; test: string[] };
  /** 各 CLI 的探针结论。旧盘上的 `probe.agy` / `probe.zcode` 由读盘迁移搬进来 */
  cli: ProbeByCli;
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
  /**
   * 允许部分入选审核者失败后降级续跑（`--allow-single` 的配置开关）。
   *
   * v1 里叫 `allow_single_flag`。改名是因为「single」在 N 方语境下已经不成立：
   * 三审挂一侧后剩两侧，那不是 single 而是 partial（对齐 `run.v2` 的完成度取值）。
   * **旧名长期保留为别名**，`loadCtx` 的内存迁移会把它搬过来，旧配置不改也能跑。
   */
  allow_partial_flag: boolean;
  /**
   * 不给 `--critics` 时的默认审核者集合（设计 13.1.1）。
   *
   * 每一项都必须在 `agents` 里有配置，且必须是注册表中 `criticEnabled: true` 的 Agent。
   * 默认值维持 `[gemini, glm]`——与现状等价，成本不变。
   *
   * 接线已在 M7b 第 5 步完成：不给 `--critics` 时，`resolveCriticSelection`
   * 取的就是这个字段（优先级 `--critics` > `--only` > 本字段），
   * **不再回落到 `CRITICS` 全集**。
   */
  default_critics: CriticId[];
  /** 单次运行可选审核者的基数上限（FR-29：1～3） */
  max_critics: number;
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

/**
 * 单个 Agent 的配置段（`config.v2` 的 `agents.<id>`）。
 *
 * **以 `vendor` 为判别式的可辨识联合，不是同构 record**：两家的字段集合完全不同
 * （antigravity 要 `agent` 与 `effort`，zcode 要 `entry` 与 `max_turns`），
 * 硬压成同一个形状只会得到一堆互相不适用的可选字段，校验也就形同虚设。
 *
 * codex / claude 的形状随 M8 / M9 / M10 加入本联合。在那之前，配置里写
 * `agents.claude` 会被 schema 拒——那不是缺陷，而是「形状尚未定义」的如实反映：
 * 设计 13.1.1 允许 Driver 段存在，但没说它长什么样，凭空放行等于承诺一个不存在的契约。
 */
export type AgentConfig = GeminiCriticConfig | GlmCriticConfig;

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
  schema: 'trivium.config.v2';
  archive_root: string;
  topic: { max_len: number; forbid_chars: string[] };
  runtime: RuntimeConfig;
  isolation: IsolationConfig;
  review: ReviewConfig;
  /**
   * 逐 Agent 的配置段，键是注册表的 Agent id（v1 里叫 `critics`）。
   *
   * **键只要求「是已登记 Agent」，不要求 `criticEnabled: true`**（设计 13.1.1）：
   * Driver 自身也需要配置容身之处。`criticEnabled` 只约束 `review.default_critics`
   * 与 `--critics` 的每一项。
   *
   * 这一条与 M7b 计划稿 §3.2「约束一」写的相反（那里要求键必须 `criticEnabled`），
   * 以设计为准——计划稿早于设计定稿，那条约束会把未来的 Driver 段一并拒掉。
   */
  agents: Partial<Record<AgentId, AgentConfig>>;
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
