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

import {
  agentById,
  CRITIC_AGENT_IDS,
  DEFAULT_CRITIC_AGENT_IDS,
  type AgentId,
  type AgentVendor,
} from './agents/registry.js';

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
/**
 * 禁读集条目的四类分档（设计 §10.1.1）。
 *
 * 禁读集由性质完全不同的四类拼成，而此前它们共用一个布尔位 `peer_artifact_read`
 * 与一句「该侧结论作废」。四次实测命中**全部落在 `orchestrator-state`**——
 * 审查员读了自己的护栏配置或列了目录，与背靠背独立性毫无关系，却按泄漏对端产物处置。
 *
 * `own-run-material` 必须单列：运行根是**混合树**，对端本轮输出与审查员**自己的**
 * 运行时材料（sandbox home、请求文件、工作日志）同处一棵。按整棵前缀匹配，
 * 「读自己的运行目录」会被判成泄漏——把误伤换个地方制造一次。
 */
export type DenyCategory =
  /** 对端历史审查件与其结构化原文 —— 判作废 */
  | 'peer-artifact'
  /** 运行根下**对端**本轮原始输出 —— 判作废 */
  | 'peer-run-output'
  /** 运行根下**己方**运行时材料 —— 不判作废 */
  | 'own-run-material'
  /** 编排器状态目录（护栏载体，非审查内容） —— 告警级 */
  | 'orchestrator-state'
  /** `sensitive_globs` 命中的凭据文件 —— 安全告警线 */
  | 'sensitive';

/** 会判该侧作废的类别（设计 §10.1.1 的第①②类） */
export const VOIDING_DENY_CATEGORIES: readonly DenyCategory[] = ['peer-artifact', 'peer-run-output'];

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

/**
 * **缺省入选**的审核者集合（`review.default_critics` 的默认值来源，M8 第 3 步）。
 *
 * 与 `CRITICS` 的差别只在注册表的 `defaultSelected` 一个字段：
 * `CRITICS` 是「能选谁」，本集合是「不选时跑谁」。两者曾是同一个集合，
 * 于是启用第三家就等于让每次审查的成本自动涨一档——见注册表 `defaultSelected` 的说明。
 */
export const DEFAULT_CRITICS: readonly CriticId[] =
  DEFAULT_CRITIC_AGENT_IDS as readonly CriticId[];

/**
 * `review.max_critics` 的内置默认值，同时是缺省集合长度的上限。
 *
 * 唯一登记处在注册表（与 `defaultSelected` 的不变量同处一地），这里只转出。
 */
export { DEFAULT_MAX_CRITICS } from './agents/registry.js';

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
  /**
   * 可复用的规则写法。不支持时为 null。
   *
   * **它记的是实测被证生效的那一条的形状，不是「什么都能往里套」的模板**
   * （代码双审 CODEX-04）。claude 侧落盘的是**目录 glob**（`Read(./<dir>/**)`），
   * 而 M9 要注入的 `CriticRequest.deny_paths` 是**逐文件清单**——
   * **两者形状不同，等价性未验**（M6 与 M9 两份报告都把它登记为未验）。
   *
   * 照字面把逐文件路径套进这个形状，第 ③ 道屏蔽可能根本不成立，
   * 而 `run.json.guard.peer_deny_applied` 仍会记 true（三家适配器都只看 `supported`）。
   * **`coverage_complete` 不覆盖这个问题**：那一格管的是「规则对哪些**读工具**生效」，
   * 这一条问的是「规则对哪种**路径形状**生效」，是两件事。
   *
   * M9 第 3 步接适配器**之前**要补一次逐文件形态的实测。
   */
  rule_syntax: string | null;
  /** 该结论是怎么测出来的（人读，写进坑清单） */
  method?: string | null;
  /** 已尝试但不成立的注入点，避免下次重复试 */
  attempts?: string[];
  /**
   * 主判据之外**另行实测过的**读工具，同一批规则是否同样生效（BACKLOG EV-40）。
   *
   * `true` = 另测的通道也被挡住；`false` = **存在已实测的绕过通道**；
   * `null` / 缺省 = 没另测过（**不等于覆盖完整**）。
   *
   * **`true` 的含义是「已实测的通道都挡住了」，不是「覆盖全部读工具」。**
   * claude 侧另测的只有 `Grep`（实测绕得过 ⇒ false），`Glob` 至今未验
   * （M6 报告 §四.7 已登记为已披露缺口）。把它读成「覆盖完整」会免掉事后轨迹核验，
   * 而那是这个洞唯一的兜底（设计 §3.7）。
   *
   * 立此字段是为了替掉 `method` 中文自由文本的 `includes` 反解——
   * 厂商或我们自己改一句话，反解就静默失效，而失效的方向是**放松**。
   *
   * **消费方**：`doctor` 的结论文案；M9 适配器判「第 ③ 道屏蔽能不能单独成立」。
   */
  /*
   * **必填，不是可选**（代码双审 r3 CODEX-01 ≡ GLM-01）。
   *
   * 上一版写成 `?:`，理由是「不给也能编译」。那正是问题所在：不给也能编译，
   * 于是 agy / zcode / codex 三家**真实产出**的 `path_deny`（赋值形与 return 形）
   * 一格都没补，而我以为自己修了——我改到的只是它们的**初值空壳**。
   * 配套那条 grep 契约又只认属性形，把属性形全改成 `emptyPathDeny()` 之后
   * 它扫到的是**空集**，`offenders` 恒为 `[]`，测试 vacuous 通过。
   *
   * 改必填之后，`tsc` 会在每一个产出点当场报错，由写的人显式给 `null`。
   * **扫描器要靠我写对正则，类型检查不用**——这一族缺陷我已经连错三轮，
   * 换成结构上不可能写错的做法，而不是再加一层需要写对的判据。
   */
  coverage_complete: boolean | null;

  /**
   * **逐文件形态的 deny 规则验没验过**（BACKLOG EV-42，代码双审 r4 CODEX-03）。
   *
   * `true` = 逐文件注入实测通过（两条腿：哨兵未泄漏 **且** 该次记入 `permission_denials`）；
   * `false` = 实测确认逐文件形态**不生效**；`null` = **没验过**。
   *
   * ## 为什么要立这一格，而不是把它写在 BACKLOG 里
   *
   * EV-42 的安全默认原本是一句话：「等价性未验前 `peer_deny_applied` 不得记 true」。
   * 但三家适配器逐字都是 `peer_deny_applied: probe.path_deny.supported === true`——
   * **第 3 步最省力的做法（照抄那一行）当场违反该默认，而没有任何东西会红**。
   * 那条默认实质仍是「靠记性的纪律」，与本轮刚换成的「让结构去保证」自相矛盾。
   *
   * 立成**必填**三态之后，`peer_deny_applied` 改读这一格：没验过就是 `null`，
   * `=== true` 判不过，**结构上不可能把一件没测过的事记成 true**。
   *
   * ## 它与 `coverage_complete` 是两件事
   *
   * 那一格问「规则对哪些**读工具**生效」（claude 侧：Read 挡得住、Grep 绕得过）；
   * 这一格问「规则对哪种**路径形状**生效」——落盘的 `rule_syntax` 是**目录 glob**，
   * 而 `CriticRequest.deny_paths` 是**逐文件清单**，两者形状不同、等价性未验。
   */
  file_shape_verified: boolean | null;
}

/** 隔离手段。探针实测「独立 HOME / 独立 settings 路径 / 仅环境变量 / 共享」中首个可用者 */
export type ProbeIsolation = 'home_copy' | 'settings_path' | 'env' | 'shared';

/**
 * 复现「取版本」这一步所需的调用方式，由探针落盘、`preflight` 复用。
 *
 * 存在的理由是 P7 的直接应用：**这条命令的取法必须靠实测才知道，故由探针落盘、
 * 不由读侧按家分支猜**（分层判据见设计 §11.1；机制类旗标不在此列）。
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
   * 改用默认 Agent 探测、此处为 null。适配层一律用这个值——该名字属只读保障面，
   * 取值必须靠实测才知道，按 P7 与设计 §11.1 判据一归探针——
   * 原先适配层取配置里的名字，与探针验证过的配置不是同一个，agent.md 缺失时只读白名单失效。
   * 旧探针结论没有该字段（undefined）：适配层回退到配置名。
   */
  agent?: string | null;
}

export interface ZcodeProbe extends CommonProbe {
  /** 实测**实际被接受**的只读参数组合，不是文档上写的 */
  readonly_flags: string[];
  /**
   * 模型覆盖实际生效的档位——**实测值**，不是写死的（EV-82，计划双审 r3 CODEX-04）。
   *
   * 探针臂 `probeModelOverride`：副本 HOME + `cli/config.json` 副本（apiKey 全换哨兵、`model.main`
   * 写一个**非首位**模型）+ 只给内置变量 → headless → 读 CLI 自写的 `v2/provider_config.json`，
   * 其 `defaultModelSelection` 等于请求 ⇒ `config_copy`（legacy 导入读到了 `model.main`）；
   * 否则 `global`。零配额、副本里无真实凭据。
   *
   * 谁消费：只有 doctor 的 notes（给人看）。`availability()` 与 `run()` 不读它——拉起时按当下的
   * 文件系统重算（与 `provider_config` 那一格同一条理由）。
   */
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
  /**
   * 0.16.9 起 CLI 定位 provider 配置所需的两份文件（坑 P-28），记**探测时刻的存在性**：
   * 存在记绝对路径，不存在记 null，整段 null 表示旧结论文件未探过这一格。
   *
   * 谁消费：`doctor` 的 notes 与 blocker **直接读**这一格；`preflight` 经 `zcodeAdapter.availability()`
   * 读 `builtin_file` 判该侧可用性（自己不读结论文件）；探活失败的详情由 `authProbe()` 在**运行时**
   * 从 CLI 的 stderr 生成，与这一格无关。**真正执行拉起的那条路径不读它**：派生规则
   * （`zcodeProviderConfigPaths`）只有一处，拉起时按当下的文件系统重算并做存在性门控；
   * 若改成读这格，文件在两次 doctor 之间出现或消失时，拉起要么漏注入要么注入到不存在的路径。
   * 这格的价值是让人在 doctor 输出里**看见**编排器会注入什么，以及让「可用性」有一个不必起进程的判据。
   */
  provider_config?: { builtin_file: string | null; personal_file: string | null } | null;
}

/**
 * Codex CLI 的探针结论（M6 第 2 步，本机实测 `codex-cli 0.154.0`）。
 *
 * **每个字段都注明谁消费、什么时候消费。** 这是 BACKLOG EV-06 的直接应用——
 * 那条记的是 `instructionFiles` 登记了却没有任何读取方，于是「登记」被误读成「已生效」。
 * 探针结论天然是给后续里程碑用的，但「M8 会用」和「没人会用」必须当场分得清。
 */
/**
 * 一个 codex profile 的 provider 家族结论（M8 第 3 步，J8）。
 *
 * 为什么按 **profile** 而不是按 provider 组织：`-p` 是用户实际能选的旋钮，
 * 而 0.154.0 的 profile 是**文件分层**（`$CODEX_HOME/<name>.config.toml` 整份叠在基底上），
 * 一个 profile 恰好钉住一组「provider + 默认模型 + 模型目录」。
 * 按 provider 组织则要反查「哪个 profile 能选到它」，那正是本步否决的那类猜测。
 */
export interface CodexProviderProbe {
  /** profile 名，即 `-p` 的取值 */
  profile: string;
  /** 该 profile 生效的 provider 家族 id（`model_provider` 键） */
  provider: string | null;
  /** 该 provider 段带得出凭据（明文 token 或 env_key 指向的变量在场）。**不记值** */
  credentialed: boolean;
  /** 该 profile 声明的默认模型 slug */
  model: string | null;
  /**
   * 该 provider 段 `base_url` 的 **host**（已归一，不是原串）。
   *
   * **只留 host 是刻意的**：判据只需要「两侧 endpoint 是否同一个」，
   * 而 URL 的 userinfo（`https://user:token@host/v1`）与 query 都是承载凭据的常见形态——
   * 原串入库等于把凭据面扩到 `config.local.yaml` 与 doctor 输出
   * （代码双审 CODEX-06）。归一在采集处做，落盘的就已经是 host。
   *
   * AC-20 要「至少两个模型家族」，而 provider **id** 互异证明不了 endpoint 互异：
   * 两个不同的 `[model_providers.X]` 段完全可以指向同一个 base_url 与同一套凭据，
   * 此时两次运行的 `model_provider` 字符串不同、模型不同、判据全绿，
   * 打的却是同一个端点（计划双审 CODEX-03）。判据因此要看到这一层。
   *
   * 取不到记 `null`。**`null` 的验收语义是「该分量无法校验」，不是「该分量不参与」**
   * （代码双审 CODEX-03）：AC-20 分量④要的是「两侧 host 互不相同」，任一侧为 `null` 时
   * 这句话无从判断——按「不参与」读，「两次都采不到 host」与「两 host 确证互异」
   * 在验收侧就长成同一个通过，正是本版反复消灭的那个形状。
   * 本机 `gpt` profile 的 `base_url` 就是 `null`（内置 provider 无段），不是构造形态。
   * 口径同 `checkModelAgainstCatalog` 的 `unverifiable` 第三态：说不出来要说出来，不假装通过。
   */
  base_url: string | null;
}

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
   *
   * **消费方（M8 第 3 步起，本步仅预留、尚未接线）**：`doctor` 的能力对账。
   * 判定层已于第 2 步改为面向 `TraceCapability.traceShape`（声明在适配器上），
   * 本字段是**实测侧的对照物**，用来发现「声明与实测不符」——
   * 但**对账代码还不存在**（`doctor.ts` 目前对 capability 零引用）。
   * 它已不再直接驱动 `project_reads` 统计与禁读核验。
   *
   * 对账范围**仅 codex（及 M9 的 claude）**：`AgyProbe` / `ZcodeProbe` 没有对应字段，
   * 那两家以适配器现状行为等价为据，不做机器对账（r2 裁决 GLM-07）。
   */
  trace_path_structured: boolean | null;
  /**
   * 被沙箱拒绝的命令是否留在轨迹里。
   *
   * 本机实测 **false**：写入**被拒**时 `command_execution` 事件一条都不产生。
   *
   * **消费方（M8 第 3 步起，本步仅预留、尚未接线）**：`doctor` 的能力对账，
   * 对照 `TraceCapability.rejectionRecorded`（声明在适配器上）。对账代码还不存在。
   *
   * ## 一处更正：它**不**意味着「轨迹有写事件即判失守」对该侧恒为假
   *
   * 本注释此前是这么写的，而那是错的——M8 第 2 步的计划审查（r2）以 blocker 指出：
   * P-C2 只断言**被拒**的命令不留痕，**成功执行的命令照常产生事件**
   * （P-C1 的样本本身就是 `status:"completed"`、`exit_code:0` 的 `command_execution`）。
   * 所以沙箱一旦失守、写命令真的跑成了，`write_events` 非空是**真阳性**，必须判失守。
   *
   * false 的准确含义是「**尝试写**的检测失效」：没检出写事件时，排除不了
   * 「试过但被拒、没留痕」。这是**阴性结论**的可信度问题，只读保障从三重降到两重
   * （指纹比对仍有效），不是检测全盲。降级如实留痕在 `guard.verification_degraded.readonly`。
   */
  rejected_command_in_trace: boolean | null;
  /**
   * 实测**实际被接受**的只读参数组合。
   * **消费方**：M8 适配器构造命令行——只读保障这一族取值必须靠实测才知道，
   * 故归探针（P7 与设计 §11.1 判据一；机制类旗标归适配层，不在此字段）。
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
   * 逐 profile 的 provider 家族探活结论（J8，M8 第 3 步）。
   *
   * **消费方**：①适配器的 `availability()`——本次 profile 没有可用凭据即该侧不可用；
   * ②`preflight`——选了 codex 而其 profile 所属家族未配置时**拒绝启动**并给可粘贴指引
   * （AC-20 末条）；③`doctor` 的人读诊断。
   *
   * **只记「有没有」，不记凭据值**（与 `secrets.ts` 的既定口径一致）。
   */
  providers: CodexProviderProbe[];
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
   *
   * ⚠️ **它与同段的 `models` 取自不同的层，两者不可当成一对读**：
   * `models` 走 `probeCodexModels(bin, null)` 即**基底** `config.toml` 的目录，
   * 而本字段取的是**本次探针 profile**（`profiles` 字典序里第一个目录非空的那个）的路径。
   * 起草 M8 第 4 步计划时我就是把这一对当同源读，写出过一句失实断言。
   * 逐 profile 的准确结论在下面的 `models_by_profile`。
   */
  model_catalog_path: string | null;
  /**
   * **逐 profile 的可见模型清单**（M8 第 4 步，计划双审 CODEX-05 的落点）。
   *
   * ## 为什么必须逐 profile 存
   *
   * 模型目录是**分层**的：`<profile>.config.toml` 可以自带 `model_catalog_json`，
   * 取不到才回落基底。于是「哪些 slug 合法」这件事**随 `-p` 变**，
   * 而 `models`（单一列表、取自基底）拿去校验任何非基底 profile 都是错的，
   * 两个方向都会错：
   *
   * - **误杀**：`profile: deepseek` + 它自己的默认模型 `deepseek-flash`——
   *   在 deepseek 目录里，却不在基底目录里，预检拒掉一个本可跑通的配置；
   * - **误放**：某个 slug 在基底目录里而不在该 profile 的目录里，预检放行，
   *   到 `turn.failed` 才被端点拒——而预检存在的全部理由就是把这类失败挡在花钱之前（AC-16）。
   *
   * 存的是**可见项**，理由见 `probeCodexModels` 的文档块（端点名单 ＝ 可见项，n=1 实测）。
   *
   * **消费方**：`checkModelAgainstCatalog` 经适配器钩子 `catalogModelsFor`。
   * 旧留痕没有本字段（M8 第 4 步之前落盘的 `config.local.yaml`）——那时记 `{}`，
   * 消费方据此返回 `fallback`：**照常用基底目录校验（不 fail-open），但把回落这件事说出来**。
   * 本句原写「记为 `unverifiable`、不静默通过」，而实现返回的是 `null`（静默回落）——
   * 承诺与实现对不上，代码双审 CODEX-05 指出后按**实现侧**修：改成 `fallback` 两头都顾。
   */
  models_by_profile: Record<string, string[]>;
  /**
   * **基底目录**的可见 slug（`models` 的可见子集）。
   *
   * 没有它时，未配 profile 的形态（codex 的默认形态）会回落到含隐藏项的 `models` 全集——
   * 而 `probeCodexModels` 的文档块自己写着「拿全集当判据会放行隐藏项」。
   * 于是修复只覆盖了配了 profile 的那一半，默认形态上误放原样存在
   * （代码双审 GLM-03）。
   */
  models_visible: string[];
  /**
   * 逐 profile 的**采集失败原因**（profile → 人读原因）。键在即表示那次采集失败。
   *
   * **它与 `models_by_profile` 的空数组是两件事**：后者表示「采到了，而且目录确实为空」，
   * 本字段表示「没采到，不知道目录里有什么」。合流的后果是 fail-open——
   * 一次子进程失败会被消费方读成「确认没有目录」从而放行
   * （代码双审 CODEX-01）。
   */
  models_by_profile_errors: Record<string, string>;
}

/**
 * Claude Code CLI 的探针结论（M6 第 3 步，本机实测 `2.1.270`）。
 *
 * 同 `CodexProbe`：**每个字段都注明谁消费、什么时候消费**（EV-06 的应用）。
 *
 * ## 与另两家最要紧的差别
 *
 * 只读保障走的是**工具白名单**（`--restricted --strict-mcp-config --tools …`）
 * 而不是沙箱，于是被拒的尝试**留在轨迹里**——codex 那边被沙箱挡下的命令
 * 一条事件都不产生。加上读取路径有结构化字段、且支持路径级 deny，
 * claude 侧是三家里**可核验性最强**的一侧。
 */
export interface ClaudeProbe extends CommonProbe {
  /**
   * `claude -p` headless 下能否真的读到文件（哨兵首行回显命中）。
   * **消费方**：M9 适配器的 `availability()`——false 即该侧不可用。
   */
  headless_read_ok: boolean | null;
  /**
   * 工具调用的**参数**里有没有结构化路径（`Read` 的 `file_path`）。
   *
   * 本机实测 **true**，与 codex 相反（那边路径只在 shell 命令文本里）。
   * **消费方**：M9 的 `project_reads` 统计与 `deny_paths` 轨迹核验——
   * 为真时两者都能走结构化字段，不必做命令文本解析（BACKLOG EV-01 对该侧非必需）。
   */
  trace_path_structured: boolean | null;
  /**
   * 白名单外的工具被调用时，这次**尝试**是否留在轨迹里。
   *
   * 本机实测 **true**：模型照常发出 `tool_use`，随后收到
   * `No such tool available: Write. Write is disabled for this session,
   * in subagents as well as here.` 的 `tool_result`。
   * **消费方**：`guard` 的 `write_events` 判定——为真时设计 §10.3
   * 「轨迹有写事件即判失守」对该侧**成立**（codex 侧恒为假）。
   *
   * 注意判据要扫 `tool_use` 的工具名，**不是** `permission_denials`：
   * 白名单外的工具走「工具不存在」路径，不进 denials（见 `path_deny`）。
   */
  denied_tool_in_trace: boolean | null;
  /**
   * 负对照是否**真的落了文件**。
   *
   * 独立于 `readonly_flags` 与 `tool_surface_checked`（审查意见 GLM-01 路径②）：
   * 原实现里 breach 发生时只清空 `readonly_flags`，于是「文件真被创建了」这个
   * **已核实的事实**又一次塌缩进 flags 空集——与「工具面脏」「压根没核对」三者
   * 共用一个信号，读侧分不出来。
   *
   * 这是同一个塌缩模式的第三次（r3 的 flags 空集双义、r3 的 `path_deny`
   * 无从证实落 false、本轮的 breach）。共同形状：**一个字段承载多个互斥的意思**。
   *
   * **消费方**：`claudeSeverity` —— 为 true 时**恒 blocker**，
   * 且排在一切「没测到」判据之前：文件在不在是文件系统事实，
   * 不依赖读探针跑没跑完。
   */
  readonly_breach: boolean | null;
  /**
   * 工具面**核对过没有**。
   *
   * 加这个字段是因为 `readonly_flags` 的空集承载了两个互斥的意思
   * （审查意见 AGY-02 ≡ GLM-01）：「核对过、发现混入了写工具」与「压根没核对」。
   * 后者发生在读探针拿不到 `system/init` 时——未登录、断网、spawn 报错，
   * 而 `run()` 对这些**都不抛错**。
   *
   * 两者塌缩的后果落在**安全判定**上：`claudeSeverity` 把空集判成失守，
   * 于是登录态一过期，默认 `doctor` 就给出一条**失实的失守指控**。
   * claude 是 Driver（`driverEnabled: true`）、人人皆装，这不是个别用户被误伤。
   * **消费方**：`claudeSeverity` —— 只有它为 true 时，空的 `readonly_flags` 才算失守。
   */
  tool_surface_checked: boolean | null;
  /**
   * 实测**实际被接受**的只读参数组合。
   *
   * **`--strict-mcp-config` 是硬前置**：不加它时 MCP 服务器的工具会混进工具面，
   * 本机实测混入了含发信、建档、分享、删除等**写操作**的条目——
   * 那是能越出项目边界的失守面，比「能写项目文件」更严重。
   * 它同时也是成本项：本机实测一次最小任务 $0.199 → $0.0083（24 倍）。
   * **消费方**：M9 适配器构造命令行（P7）。
   */
  readonly_flags: string[];
  /** `--model` 是否真实生效（`system/init` 事件回读）。**消费方**：M11 档位路由 */
  model_flag: boolean | null;
  /**
   * `--json-schema` 能否强制出结构化输出——**探针喂的是真实审查契约**
   * `skills/dual-critic/schema/review.v1.json`（EV-74），不是迷你 schema。
   *
   * 三态判据见 `judgeJsonSchema`（`probes/claude.ts`）：`false` 只由「CLI 干净拒绝」
   * 触发；`null` 的成因（撞闸/未跑完/环境层失败/模型不合规/资产根未安装/早退轮
   * 保留旧值）由**返回值字段** `StructuredArmCause` 承载，不落进本字段本身、
   * 也不落进 notes——那个字段才是「本轮是否真跑过」与「为什么是 null」的机读来源。
   *
   * 两处形态仍要记：①参数取**内联 JSON 字符串**，不是文件路径（codex 的
   * `--output-schema` 才是文件）；②`result` 字段回来的是**JSON 字符串**，调用方要
   * 再 parse 一次。
   * **消费方**：M9 的结构化解析（为 false 时降级为提示词约定 + 宽松解析）；
   * `doctor` 的 `DoctorReport.warnings`（按 `StructuredArmCause` 分文案，见 `doctor.ts`）。
   */
  json_schema_ok: boolean | null;
  /**
   * 会话 id 的来源路径。本机实测：**每条事件都带 `session_id`**，
   * 且 `--session-id` 可由调用方指定。
   * **消费方**：M9 的留痕与轨迹定位。
   */
  session_id_source: string | null;
  /**
   * headless 在一个**全新目录**里首跑是否需要人工信任。
   *
   * 设计单列此项的理由：若需要，则该侧对「新克隆的仓库」不可用，必须如实标记，
   * 不能靠「我这台机器上是好的」糊过去。本机实测 **false**（无提示、直接跑通）。
   * **消费方**：M9 的可用性判定与用户文档。
   */
  trust_prompt_required: boolean | null;
  /**
   * `--output-format stream-json` 是否**必须**配 `--verbose`（BACKLOG EV-40）。
   *
   * 2026-09-17 实测（2.1.273）：**不是「少吐事件」，是 CLI 硬拒绝**——
   * 不带 `--verbose` 时进程退 1、零事件、**零 API 调用**，stderr 为
   * `When using --print, --output-format=stream-json requires --verbose`。
   * EV-40 原拟的判据「同一任务跑两次数事件条数」建立在「会降级」这个假设上，
   * **已被实测否证**；现判据是**负对照进程是否被干净拒绝**——更强，且负对照不花钱。
   *
   * `true` = 硬前置成立（现状）；`false` = 不带也能跑，绑定已解除；`null` = 未测。
   *
   * **消费方是漂移可见性，不是参数构造**：适配层仍按机制类旗标硬编码 `--verbose`
   * （设计 §11.1 判据一第二类）。本字段的作用是让「CLI 改成默认全量或换旗标名」
   * 这件事被探针看见，而不是让 M9 白跑一次才发现。
   */
  stream_json_requires_verbose: boolean | null;
  /**
   * 探针落盘的 `readonly_flags` 里**含不含那条 MCP 硬前置旗标**。
   *
   * 存在的理由是一处真实的张力：适配层必须校验该硬前置在场，
   * 而 `registry-parity` 第 6 条禁止 `adapters/` 出现那个字面量（设计 §11.1 判据二）。
   * 于是判定放在探针侧——字面量本来就住在这里——适配层只读这个布尔。
   *
   * **不与 `readonly_flags.length > 0` 等价，而且两者并不同真同假。**
   * 上一版在这里写过「今天两者恰好同真同假」——那句是错的，三侧独立打中
   * （代码双审 r2 AGY-02 ≡ GLM-r2-05 ≡ CODEX-05），两条现实路径各是一个反例：
   *
   *   · `system/init` 的 `tools` 读回为空 ⇒ 该分支**同时**置 `checked=false` 与清空数组
   *     ⇒ 本字段 `null`、`length > 0` 为 `false`——一个 null 一个 false，不等价；
   *   · `existing` 带着上一轮的完整清单、本轮拿不到 `init` ⇒ 数组**非空**而本字段 `null`。
   *
   * 可核的陈述是这样：
   *
   *   · `false` **当且仅当**已核对，且组合内确无该旗标（含 breach 与工具面脏两种清空）；
   *   · `null` **当且仅当**本轮没核对成（此时数组可能仍带着上一轮的值）。
   *
   * **以上两条的前提是「本轮真跑到了终态派生」**（代码双审 r3 CODEX-05 补出的第三条路径）。
   * 未找到可执行文件、或 `--no-model-calls` 时，`probeClaude` 早退，派生根本不执行，
   * 字段保留的是**上一轮的值**——可能是一个 stale `true`。
   * 所以**消费方不得把它当本轮读数**：`availability()` 要与 `probed_at` 一并读——
   * 而 `probed_at` 现在**只在模型段真跑过时才打戳**（代码双审 r4 CODEX-06：
   * 上一版它写在两条早退之前，于是「模型段没跑」在它上面看不出来，
   * 我指的这个信号被实现自己抹平了；现已挪到早退之后，两者才对得上）。`claudeSeverity` 的 ②' 用 `!skipModelCalls` 挡住了
   * 这一格，但那是判定层的保护，**不是字段语义**。
   *
   * 所以取值必须读本字段，不能用长度替代：`readonly_flags` 的契约是
   * 「**实际被接受**的组合」、允许是子集，真出现子集时只看长度会放行一个缺硬前置的组合，
   * 而漏掉它的代价是 MCP 的写工具（发信、云盘创建与共享）进入审查会话工具面，
   * 且单次成本约 24 倍。
   *
   * **消费方**：M9 适配器的 `availability()`、`claudeSeverity`。`null` = 未测。
   */
  strict_mcp_config_applied: boolean | null;

  /**
   * **`--restricted` 在场时，项目记忆文件（`CLAUDE.md`）是否仍被阻断进入上下文。**
   *
   * `true` = 仍被阻断（现状）；`false` = **不再被阻断**；`null` = 无从证实。
   *
   * ## 它是 BACKLOG EV-44 的**翻转条件载体**，不是一个诊断项
   *
   * EV-44 裁定「接入套件第 ⑤ 件（审查员身份片段）对 claude 侧**显式不做**」，
   * 理由是实测级的：`--restricted` 会连项目记忆一起阻断，于是
   * ①交底担心的「审查员读到 Driver 协议这个反指令」根本进不来；
   * ②片段若注入 `CLAUDE.md`，**会被同一个旗标挡掉**，做出来是一件永远读不到的死件。
   *
   * 这条结论**有翻转的一天**——厂商改掉该旗标的语义时。本字段就是那天的探测器：
   * **只有实测 `false` 的那天本条结论作废**，第 ⑤ 件要重开。
   *
   * ## `null` 维持原裁定，不作废
   *
   * `null` 是「没测到」，不是「不再阻断」。把没测到当证据，正是本主题连修四轮的
   * 那个形状（代码双审 r4 CODEX-05 在这条 BACKLOG 文本上又抓到过一次）。
   * 而本格的判据依赖模型配合作答，**`null` 将是常态**——同族的
   * `denied_tool_in_trace` 四次观测里三次落 `null`。
   *
   * ## 为什么不挂在 `readonly_flags` 上
   *
   * 上一版 EV-44 把翻转条件挂在「`readonly_flags` 里还有没有那个旗标」上，**两个方向都不可信**：
   * 那个数组会被三个**与厂商无关**的清空点清成 `[]`（工具面读回为空 / 工具面脏 /
   * 只读负对照落文件），那一刻旗标照样在传、记忆照样被挡，条件却字面满足 ⇒ **误翻转**；
   * 反过来厂商真改掉语义时旗标还在数组里 ⇒ **不翻转**。
   * **「数组被清空」不等于「旗标消失」**——这层区分要留着。
   *
   * ## 命名
   *
   * 不叫 `project_memory_loaded`（正向命名会让 `null` 读起来像「没加载」）；
   * 不叫 `restricted_blocks_memory`（把旗标名写进字段名，厂商改名即失真）。
   *
   * **消费方**：BACKLOG EV-44 的翻转判定、设计 §16.1 M9 行的第 ⑤ 件取舍。
   * 与 `probed_at` 以及「本轮是否真跑过模型段」一并读——见 `strict_mcp_config_applied`。
   */
  project_memory_blocked: boolean | null;
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
  claude?: ClaudeProbe;
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

/**
 * codex 的配置段（M8 第 3 步）。
 *
 * `profile` 是 R-6 的落点，也是**「家族」的唯一判定依据**——
 * 本步实测确认 `model_provider` 随 `-p` 走（`-p qwen` ⇒ qwen、`-p deepseek` ⇒ deepseek），
 * 所以家族由 profile 决定，**不按模型 slug 的前缀猜**：目录命名会漂移，
 * 而 `unknown_profile_rejected` 实测为 false（未知 profile 静默回落基底），
 * 猜错一次就是「以为跑的是 deepseek、实际跑的是基底那家」而毫无提示。
 */
export interface CodexCriticConfig {
  vendor: 'openai';
  bin: string | null;
  /** 厂商 profile 名，对应 `$CODEX_HOME/<name>.config.toml`（0.154.0 的 `-p` 是文件分层） */
  profile: string | null;
  effort: Record<Stage, 'low' | 'medium' | 'high'>;
}

export interface GlmCriticConfig {
  vendor: 'zcode';
  entry: string | null;
  max_turns: number;
  /** 模型覆盖落到 global 档时：reject 拒绝启动 / annotate 放行但标注（设计 §11.3） */
  unsupported_override: 'reject' | 'annotate';
}

/**
 * claude 的配置段（M9 第 4 步）。
 *
 * ## 只有判别式，**没有任何其它字段**——这是刻意的不对称
 *
 * 另三家的段里都装着入口覆盖（gemini/codex 的 `bin`、glm 的 `entry`），
 * 于是「照先例给 claude 也加一个 `bin`」看起来天经地义。**核过之后不是这样**：
 * 那三个字段**都有真实消费方**——`doctor.ts` 把 `agents.gemini.bin` 传进 `probeAgy`、
 * 把 `agents.glm.entry` 传进 `probeZcode`，`adapters/codex.ts` 两处入口取值都是
 * `cfg.bin ?? probe.entrypoint`。**先例是「有消费方才登记」，不是「每家都有 bin」。**
 *
 * claude 侧没有这个消费方：适配器的 `run` 与 `authProbe` 都从
 * `probe.cli.claude.entrypoint` 取入口，`doctor.ts` 调 `probeClaude` 时第一个参数
 * 逐字传 `null`。**入口由探针独占。** 加一个 `bin` 就是加一个死字段——
 * 本仓已有两条「登记而无消费方」的未结 BACKLOG（EV-06 的 `instructionFiles`、
 * EV-15 的 `readonly_commands`），它们的危害正是**让后来者以为那个字段已经生效**。
 *
 * **不要为了「补齐」把 `bin` 加回来。** 真需要本机入口覆盖时，
 * 再放宽这一支的 schema 是向后兼容的；反过来删一个已经进过用户配置的字段则不是。
 *
 * `effort` 同理不加：claude 侧没有对应的 CLI 旗标（探针未记录任何 effort 旗标）。
 */
export interface ClaudeCriticConfig {
  vendor: 'anthropic';
}

/**
 * 单个 Agent 的配置段（`config.v2` 的 `agents.<id>`）。
 *
 * **以 `vendor` 为判别式的可辨识联合，不是同构 record**：两家的字段集合完全不同
 * （antigravity 要 `agent` 与 `effort`，zcode 要 `entry` 与 `max_turns`），
 * 硬压成同一个形状只会得到一堆互相不适用的可选字段，校验也就形同虚设。
 *
 * **四家形状自 M9 第 4 步起全部就位**（codex 随 M8 第 3 步、claude 随本步）。
 * 此前配置里写 `agents.claude` 会被 schema 拒，那不是缺陷而是「形状尚未定义」
 * 的如实反映——设计 13.1.1 允许 Driver 段存在，但没说它长什么样，
 * 凭空放行等于承诺一个不存在的契约。
 *
 * **副作用要知道**：`schemas.ts` 的 `configurableVendors()` 从 schema 现取判别式，
 * 四支齐备后「已登记但形状未定义」这一格**变成空集**，那条报错分支随之不可达。
 * 三条依赖该格的用例已在本步一并处置（见 `config-schema.test.ts` /
 * `config-migrate.test.ts` 里对应的说明）。
 */
export type AgentConfig =
  | GeminiCriticConfig
  | GlmCriticConfig
  | CodexCriticConfig
  | ClaudeCriticConfig;

/**
 * 一条判不实的写入线索（`CriticResult.suspected_write_events` 的元素）。
 *
 * 定义在本文件而不是 `adapters/base.ts`：它是**结果契约**的一部分，
 * 而 `base.ts` 已经 import 本文件——反向 import 会成环。
 */
export interface SuspectedWrite {
  /** 命令原文 */
  command: string;
  /** 为什么判不实（人读，进留痕） */
  why: string;
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
  /**
   * 执笔方（当轮 Driver）的 Agent id。
   *
   * M9 第 6 步之前这里写死 `'claude'`，与 `disposition.v1.json` 的
   * `role: {"const": "claude"}` 同源——两处各抄了一份 id。EV-66 把 schema
   * 拉回注册表口径时这里一起放开，理由是**不在类型层留第二份 Agent id**
   * （纪律 7），而不是别的：
   *
   * **本接口当前没有任何消费方**（代码双审 CODEX-06 实核：全仓无 `: Disposition`
   * 与 `as Disposition`）。裁决件 front-matter 的真实解析形状是 `disposition.ts` 的
   * `DispositionFrontMatter`（`role: string`）。所以改它不影响任何类型检查——
   * 初版注释写的「非缺省 Driver 的裁决件在类型上根本构造不出来」是编的，
   * 那条约束从来不存在。两个类型的合一见 BACKLOG EV-70。
   */
  role: AgentId;
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
  /**
   * 本次请求的厂商 profile（请求值）与实际走到的 provider 家族（回读值）。
   *
   * **必填而非可选**，与 `CriticResult` 同源同理由：可选会让「该族没有这种事实」
   * 与「本轮没采到」落成同一个观测。无此概念的族写 `null`。
   * AC-20 的「互可区分」要同时看 `model_provider` 与 `model_effective` 两个维度。
   */
  profile_requested: string | null;
  model_provider: string | null;
  model_route?: 'env' | 'config_copy' | 'global';
  /** 模型覆盖是否落实（EV-82）。四种情况与语义见 `CriticResult.model_override_applied` */
  model_override_applied?: boolean | null;
  effort?: string;
  status: 'ok' | 'timeout' | 'failed' | 'parse_fallback';
  exit_code: number | null;
  duration_s: number;
  tool_calls: ToolCallCounts;
  evidence_ok: boolean;
  usage?: Record<string, number>;
  heterogeneous: boolean;
  /**
   * `heterogeneous === false` 时的成因（EV-54，M9 第 5 步补上写入方）。
   *
   * `run.v2` 的散文契约要求 false 时必须有它。承接侧早就接通、一直没有写入方，
   * 因为在 claude 能被选为审核者之前，补了也没有路径能端到端验证。
   * 取值由 `review.ts` 的 `overrideReasonFor` 单点派生，两个写点共用。
   *
   * **可选**：true 时为 null，早于本步的留痕则整个字段缺失。
   * 不给 schema 加 `if/then`——那会让历史留痕集体读不回。
   */
  override_reason?: string | null;
  fail_reason?: string | null;
  empty_review?: boolean;
  parse_fallback?: boolean;
  session_id?: string | null;
  peer_deny_applied?: boolean;
  /**
   * 本次该侧被跳过的禁读路径条数 / 注入的规则条数 / 注入的字节数。
   *
   * **三格恒写（含 0）**，与本接口其余「恒写」字段同一条口径：
   * 条件展开会让「该族没有这种事实」与「本轮没采到」落成同一个观测。
   *
   * r3 AGY-03 ≡ GLM-03：`run.v2.json` 的逐侧段已声明 `deny_skipped` /
   * `deny_rule_count`，而 `review.ts` 组装逐侧记录时**一个都没写**——
   * 机读契约宣告了不存在的产出点，读 schema 的人会到 `run.json` 的逐侧记录里
   * 找一个永不出现的字段。真实落盘此前只有 `guard.deny_skipped`（聚合 map），
   * 与逐侧段**同名不同形**（object vs integer），混淆面更大。
   */
  deny_skipped?: number;
  deny_rule_count?: number;
  deny_bytes?: number;
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
   * M7b 起恒为 `claude`；**M9 第 5 步放开 `--driver` 之后开始会变**
   * （上一版这里写的是「M10 放开后才会变」——放开它的是 M9 第 5 步，不是 M10）。
   */
  driver: AgentId;
  /**
   * 当轮 Driver 在这次运行时是否**已启用为 Driver**（M9 第 5 步）。
   *
   * **可选**：早于本步的留痕没有这个字段，缺失即「无从得知」，不等于 false。
   * M9 的 `--driver` 只校验「已登记」，于是归档里会出现 `driver_enabled: false`
   * 的合法留痕；M10a 第 3 步把校验收紧（入口 `resolveDriver` 退 64）之后那些留痕**仍要读得回**，
   * 所以它不进 `required`、不加 `if/then`。这是本步唯一不可逆的选择。
   */
  driver_enabled?: boolean;
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
    /**
     * 本次注入时被跳过的禁读路径条数，逐审核者（代码双审 r2 CODEX-01）。
     *
     * 与 `peer_deny_applied` 成对读：那一格答「本机曾实测该形状可拦」（探针格），
     * 这一格答「**本次**有没有路径拼不出规则」。只有两格都看，才知道第 ③ 道屏蔽
     * 这一次到底覆盖了多少——单看前者会把「主题名带括号导致对端产出整批跳过」
     * 读成「屏蔽正常」。
     *
     * 字段缺失 = 早于本轮；某侧键缺失 = 那一侧没有这种概念（不注入 `--settings`）。
     */
    deny_skipped?: Partial<Record<CriticId, number>>;
    forged_role_file: boolean;
    breached_files?: string[];
    /**
     * 措施 b（§10.1 / EV-01）的命中记录：命令原文里出现了禁读条目。
     *
     * **逐审核者记，不是跨侧合并**（审查意见 GLM-06）。初版写成了
     * `{ hit, commands }` 的合并形态，两个毛病：
     * ①`commands` 用 `flatMap` 并成一串，**看不出是哪一侧跑的**；
     * ②失败/超时侧会被 `judgeRun` 跳过、其 `command_texts` **从未被扫描**，
     *   而合并后的 `hit: false` 按注释是「扫过、没命中」——**我用一个字段表达了两件事**，
     *   正是这一轮自己在反对的塌缩。
     * 逐侧 map 之后，「没扫」表现为**该侧的键不存在**，与 `hit: false` 分得开。
     * 这也与 `run.v2` 把双侧字段改逐审核者 map 的既定原则一致
     * （M8 马上引入第三家，现在不改，第三家来了要再改一次）。
     *
     * **整个字段可选是为了读旧留痕**（接线前落盘的 run.json 没有它）。
     * 判读规则：字段缺失 = 该次运行早于 M8 第 1 步；
     * 字段在而某侧的键缺失 = 那一侧没扫（失败/超时被跳过）；
     * `hit: false` = 扫过、没命中。
     */
    peer_leak_via_command?: Partial<
      Record<
        CriticId,
        {
          hit: boolean;
          commands: string[];
          /**
           * 命中逐条带类，与 `peer_leak_via_path.hits` 同构。
           * `path` 是分类实际用的目标：命令里那个路径 token，静态解析不了时是条目本身。
           *
           * **可选是为了读旧留痕**：2026-09-17 之前落盘的 run.json 只有 `commands`，
           * 分档结果一个字都没进去。缺失 = 那次运行早于本次接线，不是「没有命中明细」。
           */
          hits?: { command: string; path: string; category: DenyCategory }[];
        }
      >
    >;
    /**
     * 措施 a（§10.1 路径通道）的命中记录，与上面的措施 b **同构**。
     *
     * 补它之前，路径通道只有 `peer_artifact_read` 一个**全局 OR** 的布尔位：
     * 措施 b 按侧记命中与命令原文，措施 a 的命中明细一条不进。后果是
     * 「哪一侧、碰了什么」事后只能手工复算原始轨迹，而运行目录到期即删——
     * 2026-09-16 实测撞上一次：一侧确实命中而我看不见，据此在裁决件里写了错的处置表。
     *
     * **命中逐条带类**（设计 §10.1.1 的四类分档）：同一侧一轮内可同时命中多类
     * （例如既读了对端审查件、又列了编排器目录），处置取**最重档**，
     * 而留痕要能复盘每一条各属哪类——只记一个聚合的 category 会把这件事再塌缩一次。
     *
     * 三态与措施 b 同构：字段缺失 = 早于接线；某侧键缺失 = 那一侧没扫；
     * `hit: false` = 扫过、没命中。
     */
    peer_leak_via_path?: Partial<
      Record<CriticId, { hit: boolean; hits: { path: string; category: DenyCategory }[] }>
    >;
    /**
     * 共同阻断这一档的执行状态（§6.6 规则 7 / §12.1）。
     *
     * 被判作废的一侧不计入独立来源，排除后有效侧可能不足两家，
     * 而 `findJointRejectedBlockers` 的判据是 `critics.size < 2`——**恒返回空集**。
     * 若不记这个字段，「查过、没有共同项」与「有效侧不足、这一项根本没做」
     * 在留痕里完全一样，三态纪律第四次复发。
     *
     * **这是过渡处置**：它只保证失效可见，不恢复交叉验证。
     * 真正的补偿是设计 §12.1 那条「作废侧重跑一次」，尚待实施。
     */
    joint_check?: {
      /**
       * **运行期只到 `pending` 为止**：这一档的判据要读裁决表，而裁决表在运行结束
       * 之后才写。run.json 能断言的只有「排除作废与无结构化结论的侧之后够不够两家」。
       *
       * 最终三态（含 `checked-found`）由 `gate --check` 判，落在
       * `task.json.joint_checks`。`checked-none` / `checked-found` 仍在这个联合里，
       * 只为读回 2026-09-17 之前那批把伪阴性写进 run.json 的留痕。
       */
      state: 'pending' | 'checked-none' | 'checked-found' | 'skipped-insufficient-sides';
      effective_sides: number;
    };
    /**
     * 两条核验通道的降级档位与本次生效的证据阈值（§11.1，M8 第 2 步）。
     *
     * `readonly`：「尝试写」检测是否可用（`unavailable` ⟺ 该侧被拒的写不留痕）。
     * **记的是能力恒态**，与本次是否检出写事件无关——真阳性由 `readonly_breach` 表达。
     * `path`：措施 a 是否有结构化输入可扫（`unavailable` ⟺ 读取路径只在命令文本里）。
     * `evidence_threshold`：本次生效的 `min_project_reads`（command-trace 族折减过）。
     *
     * 三态同样落在结构上：字段缺失 = 早于 M8 第 2 步；某侧键缺失 = 那一侧没判过；
     * 值 = 该侧实际档位。
     */
    verification_degraded?: Partial<
      Record<
        CriticId,
        {
          readonly: 'ok' | 'unavailable';
          /**
           * `partial`（2026-09-16 新增）：该侧有结构化轨迹，但「必然带路径」的
           * 读调用里出现了提不出路径的——即提取器相对厂商实际参数名已经退化。
           * 可无路径的搜索/列目录类不计入分母：不带目录的搜索是合法形态。
           */
          path: 'ok' | 'partial' | 'unavailable';
          /**
           * `unavailable` 的成因（2026-09-17 新增）。三种成因处置完全不同：
           * `command-trace` = 该族结构性无信号，没法修，deny 核验只剩措施 b；
           * `no-counts` = 该侧没报计数（旧留痕或适配器没采集），要修适配器；
           * `no-path-bearing-calls` = 本轮一次「必带路径」的读调用都没有，不是缺陷。
           *
           * 缺失 = 该档位不是 `unavailable`，或那次运行早于本字段。
           */
          path_cause?: 'command-trace' | 'no-counts' | 'no-path-bearing-calls';
          evidence_threshold: number;
        }
      >
    >;
    /**
     * 指纹变化但无法归因的文件（§9.2 + §11.1）。
     *
     * 只在本轮有侧的 `readonly` 档位为 `unavailable` 时出现：那种情形下
     * 「无写事件 ⇒ 开发者手改」的推理前提不成立，既不能判失守也不能判手改。
     * 与 `breached_files` 分开记——后者是有正向证据的失守。
     */
    unattributed_drift_files?: string[];
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
  /**
   * 本次请求的厂商 profile 的**镜像**（编排器侧可读）。
   *
   * 适配器读自己的配置段就够了，这个镜像是给**编排器的兜底出口**用的：
   * `runner` 在适配器抛异常时要组装一个 `CriticResult`，那里拿不到厂商知识，
   * 而按 Agent 身份去取配置会把 Agent 字面量带进编排器（纪律 7 禁止）。
   * 于是由 `review.ts` 在组装请求时算一次，兜底处直接取镜像
   * （代码双审 CODEX-01：上一版那一格恒写 null，
   * 把「该族没有 profile 概念」与「这次没采到」压成同一个观测）。
   *
   * **同一次计算、同一个来源**：镜像与适配器读的是同一份配置段，不会漂。
   */
  profile_requested: string | null;
}

/**
 * 一侧运行目录的凭据抹除结果（`scrub.ts`，BACKLOG EV-20）。
 *
 * 落两处：`<侧>/scrub.json` 哨兵（供清扫路径判「已抹过」与事后对账），
 * 以及 `CriticResult.scrub`（供 worker 把失败写进 `status.json` 的侧 note，
 * 让 `--wait` 的人看得见——哨兵在无人读的目录里，光写哨兵等于换个方式静默，
 * 计划双审 CODEX-10 ≡ AGY-06）。
 */
export interface ScrubOutcome {
  ok: boolean;
  at: string;
  /**
   * 这次调用其实没做事的原因：侧目录不存在（runner 单测的假路径、该侧未拉起），
   * 或清扫路径发现哨兵已记 ok（不重复扫）。runner 的 `finally` 走 `force`，不会命中后者。
   */
  skipped?: 'no-side-dir' | 'already-scrubbed';
  /** 该侧适配器有没有「凭据载体」这个概念；没有（agy / 桩）就如实记 false，不冒充抹过 */
  adapter_scrub: boolean;
  /** 整份删除的凭据载体（相对该侧目录） */
  carriers_deleted: string[];
  /**
   * 整份删除的**扫不动的自有二进制**（相对该侧目录）——见 `CarrierScrub.unscannableDeleted`。
   * 与 `carriers_deleted` 分两格：删除理由不同，合并会让哨兵把「该侧 CLI 自己生成的状态库」
   * 说成「编排器写进去的凭据载体」。
   */
  unscannable_deleted: string[];
  /** 该侧自有目录里过了扫描器的普通文件数 */
  scanned_files: number;
  /** 扫描命中而被删除的文件（相对该侧目录）——载体之外「本轮没想到」的东西 */
  removed_on_hit: string[];
  /** 就地脱敏计数（编排器自写日志与模型 I/O 日志）：相对该侧目录的路径 → 命中处数 */
  logs_redacted: Record<string, number>;
  /** 告警：超过扫描上限而跳过的文件等——**不影响 `ok`**，只进哨兵（代码双审 r1 CODEX-02） */
  warnings: string[];
  /**
   * 这次有没有**跳过**任何目标（超大、二进制、读不了）。
   *
   * 与 `ok` 分开是因为两个问题不同（代码双审 r1 CODEX-02 与 r2 AGY-02 各要一半）：
   * `ok` 回答「有没有出错」——跳过一个 21 MB 的插件缓存不是出错，不该在待办里报失败；
   * `complete` 回答「扫完了没有」——跳过意味着**那份文件仍未脱敏**，所以清扫不能据此
   * 认定「已处理」而永久跳过。`ok && complete` 才是「这一侧不用再看了」。
   */
  complete: boolean;
  /** 错误：载体删不掉、命中却处理不了、哨兵写不下去——`ok:false`，人读报失败、清扫重试 */
  errors: string[];
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
  /**
   * 本侧的模型覆盖**是否真的落实**：回读到的生效模型与请求的是不是同一个（EV-82）。
   *
   * ## 为什么需要它
   *
   * EV-82 的形态是**静默失效**：探活能过、审查跑得起来、结论也产出了，只是跑的不是
   * 请求的那个模型——于是 FR-06 的模型路由与 NFR-06 的异构默认双双失守，而留痕里
   * `model_requested` 与 `model_effective` 两个值虽然都在，却**没有任何一处判定去对照它们**。
   * 靠人对照等于靠记性，这条字段把它换成机制。
   *
   * ## 三态与「字段缺席」是**四**种情况，不能压成三种
   *
   * - **字段缺席**：本次没有覆盖尝试（没指定模型、或该族根本不做配置覆盖）。
   * - `true` / `false`：比对过，一致 / 不一致。
   * - `null`：**尝试了覆盖，但没回读到生效模型**，无法判定。唯一含义，不表示「没有这种概念」。
   *
   * 这正是本字段**可选而非必填**的理由（计划双审 AGY-03）：初稿设计成必填三态，
   * 让四家适配器一律填 `null`，于是 `null` 同时承载「本族未实现」与「本轮没采到」——
   * 两个原因落进同一个观测，事后分不开。可选字段的代价是失去 `tsc` 逐处点名，
   * 换回的是 `null` 语义单一。随 `model_route` 的既有先例。
   *
   * ## 判据归各家适配器，不归判定层
   *
   * 各族的模型 id 形态不同（zcode `<providerId>/<name>`、codex profile + model 两维、
   * claude slug），判定层做统一字符串比较必然误报。判定层只播报结论
   * （`guard.ts` 的 `renderGuardWarnings`）。
   *
   * **当前只有 zcode 侧产出**；其余三家的作答落点登记在 BACKLOG，接入前先定义
   * 「本族什么算一次覆盖尝试」。
   */
  model_override_applied?: boolean | null;
  /**
   * 该侧**实际走到的 provider 家族**（回读值）。
   *
   * ## 为什么它必须与 `model_effective` 并列，而不是由后者推出来
   *
   * 本步实测：`codex exec -p qwen -m deepseek-v4-pro` **成功退 0**，
   * 回读得到 `model_provider=qwen`、`model=deepseek-v4-pro`——
   * **同一个模型名可以挂在两个 provider 下**，codex 不校验两者的对应关系。
   * 于是「两次运行的 `model_effective` 不同 ⇒ 跑了两个模型家族」这个推断不成立，
   * 而 AC-20 的「至少两个模型家族各一次」正是靠它验收的（计划双审 GLM-01 / CODEX-03）。
   *
   * **必填而非可选**：没有这个事实的族要显式写 `null`，
   * 那是**能说明理由的空**（agy / zcode 的 CLI 不暴露 provider 归属），
   * 与 `read_paths` 对 `command-trace` 族的处理同构。可选字段会让「没采集」
   * 与「没有这种事实」再次落成同一个观测。
   */
  model_provider: string | null;
  /**
   * 本次**请求**的厂商 profile 名（`agents.<id>.profile`，codex 的 `-p`）。
   *
   * ## 命名
   *
   * 随 `model_requested` / `effort_requested` 的既有惯例（计划双审 CODEX-10）：
   * 它是请求值，不是回读值，回读值是上面的 `model_provider`。
   * **裸名 `profile` 留空不占**——这个词在本系统里已经指「档位」
   * （`config.yaml` 的 `profiles` / `active_profile` / CLI `--profile`），
   * 而 `run.v2` 自己的档位词汇是 `tier*`。同一类事实两套命名惯例，
   * 与同一个词两个意思是同一个病。
   *
   * **绝不参与 `model_effective` 的判定**：请求值一旦渗回生效值，
   * AC-20 末句「生效模型仍以回读为准、不采信 profile 意图」就失效了。
   */
  profile_requested: string | null;
  tool_calls: ToolCallCounts;
  /** 轨迹中出现过的读取路径（项目相对），供 deny_paths 核验与 consulted 交叉核对 */
  read_paths: string[];
  /**
   * 经**搜索工具的输出**读到的文件（绝对路径）：claude 侧 Grep `content` 模式的命中（EV-76 出路 ①）。
   *
   * **三态与 `model_provider` 同构**：必填，claude 填数组（可为空）；其余显式写 `null`，
   * 但同一个 `null` 背后是两种原因，各家适配器的注释写明了是哪种：
   *   - **无此事实**：agy / zcode 的流只有工具入参、stub 不产真实输出；
   *   - **未采集**：codex 的命令输出在 trace.json 的 `commands[].output` 里，只是适配器未做命中解析
   *     （解析任意 shell 输出另是一档代价，EV-19 族；要做时从那里起步）。
   * 可选字段会让「没采集」与「没有这种事实」落成同一个观测——所以必填，且两种原因不能写成一种。
   *
   * **消费方只有两处**：`judgeSide` 的 consulted 交叉核对与措施 a（`checkPeerLeak`）——
   * **不进** `project_reads` 计数（一次目录级 Grep 命中 41 个文件不等于打开了 41 个文件），
   * 不进 run.json / 审查文档（无 schema 变更），只在 `trace.json` 留痕。
   */
  search_hit_paths: string[] | null;
  /**
   * 「必然带路径」的读调用总数，与其中真的提出了路径的条数（设计 §10.1.1 第②层）。
   *
   * 两者不等 ⇒ 提取器相对厂商实际参数名**已经退化**——这是本项目唯一能在
   * **下一轮运行时**发现厂商改参数名的信号。2026-09-16 之前它不存在，
   * 于是某家 CLI 的搜索目录参数改名后，措施 a 对该通道恒盲而计数通道一切正常，
   * 直到有人手工复算原始轨迹才发现。
   *
   * **分母只算「必然带路径」那一档**：搜索 / 列目录类允许无路径（不带目录的
   * 搜索是合法形态），计进去会让降级档位变成稳态噪声、淹掉真信号。
   *
   * ## 三种「没有数」要分得开
   *
   * - **字段缺失**：`command-trace` 族结构性没有这个概念，或那份留痕早于本字段；
   * - **`null`**：该侧**这次**没能算出覆盖率（轨迹文件读不到、解析失败）——
   *   与「缺失」分开，是为了让「本次采集失败」不被读成「这个族没有这个概念」；
   * - **`0`**：算出来了，本轮一次「必带路径」的调用都没有。
   *
   * **前两者都不是零，也都不是 `ok`**：`guard` 据此记 `unavailable`
   * （成因分别为 `no-counts`），而不是拿「有效」去填「不知道」。
   *
   * > 这一行的上一版注释写的是「`guard` 据此记 `ok` 而不是谎报退化」——
   * > 那句话在 2026-09-16 判定改成 `unavailable` 之后就不再成立，
   * > 而它还在这儿指着一个相反的行为。契约注释与实现相反比没有注释更坏。
   */
  path_bearing_reads?: number | null;
  path_bearing_reads_with_path?: number | null;
  /** 轨迹中出现过的写工具/写命令事件，非空即 readonly_breach */
  write_events: string[];
  /**
   * **疑似**写入：命中写形态但判不实的命令（M8 第 3 步）。
   *
   * **不驱动 `readonly_breach`**，只进留痕与 doctor 输出。
   *
   * ## 为什么要单列这一档
   *
   * 只读失守是安全指控，`judgeSide` 对它没有分级：`write_events` 非空即失守、整侧作废。
   * 而 `command-trace` 族的写判定只能从命令文本推，三类形态推不实：
   * 幂等空操作（`mkdir -p <已存在>` 退 0 却没写）、失败掩码（`… || true` 的整条退出码
   * 与写段成功脱钩）、项目外目标。把它们塞进 `write_events` 会误杀正常审查；
   * 丢弃则让排查失去线索——所以单列一档，如实记而不下判决。
   *
   * 可选字段：`tool-trace` 族（结构化写事件）不需要这一档，恒不填。
   */
  suspected_write_events?: SuspectedWrite[];
  /**
   * 轨迹中出现过的**命令原文**，措施 b（§10.1）的输入。
   *
   * **消费方**：`checkPeerLeakViaCommand` —— 对每条命令做 deny 字面量子串匹配，
   * 命中与路径命中同等处置（该侧作废）。
   *
   * **为什么它与 `write_events` 不是一回事**：`write_events` 记的是「这条命令属于写类」
   * 这个**判定结果**，`command_texts` 记的是**原文**。agy 侧 `run_command` 本就在
   * 写工具集里（出现即失守），所以两者重合；而 codex 侧读文件就是跑 shell，
   * 命令原文是**正常证据**而非失守信号——`write_events` 表达不了它，
   * 这正是本字段单列的理由（M6 P-C1）。
   *
   * 无 `run_command` 能力的侧（zcode 全禁 `Bash`）恒为空数组。
   * **空数组的含义是「没有命令」，不是「没采集」**——采集不到要在 `fail_reason` 里说，
   * 不能让两者都落空数组。
   */
  command_texts: string[];
  evidence_ok: boolean;
  fail_reason: string | null;
  session_id: string | null;
  usage?: Record<string, number>;
  cli_version: string | null;
  peer_deny_applied: boolean;
  /**
   * 本次注入时**被跳过的禁读路径条数**（拼不出一条能字面匹配的规则）。
   *
   * ## 为什么必须进判定面，而不是只躺在 `trace.json`
   *
   * `peer_deny_applied` 读的是**探针格**（`file_shape_verified`，探针夹具里的单条
   * ASCII 路径），它对**本次**注入的那批规则一无所知。于是「某些路径被跳过」这件事
   * 在判定面上**完全看不见**：落盘仍 `peer_deny_applied: true`，
   * 而 `report.ts` 的第 ③ 道屏蔽降级旗标只在它为 `false` 时推。
   *
   * 后果是有条件但真实的：禁读条目的路径前缀就是 `.reviews/<topic>/…`，
   * **只要主题名带一个圆括号或 glob 元字符，这一次运行里每一条对端产出都带它**
   * ⇒ CLI 层屏蔽对「对端产出」整批失效，只剩提示语与事后轨迹核验，
   * **而没有任何一处会说出来**（代码双审 r2 CODEX-01）。
   *
   * 此前唯一的记录在 `trace.json` 的 `denySettings.skippedPaths`，而**全仓没有消费方**；
   * 更糟的是两条失败出口（超时、未产出最终回复）在写 `trace.json` **之前**就 return，
   * 连那份记录都没有。`guard.ts` 自己写过这条纪律：
   * 「之所以要让它出现在判定结果里而不是只躺在 `trace.json`：**宣称了不存在的消费方**
   * 正是 EV-06 记的那个形态」。
   *
   * **消费方**：`report.ts` 在 `> 0` 时推一条与 `peer_deny_applied === false` 同档的降级旗标。
   * 没有这种概念的侧（agy / zcode / codex：不注入 `--settings`）恒为 0。
   */
  deny_skipped: number;
  /** 本次实际注入的 deny 规则条数；不注入的侧恒为 0（与 `deny_skipped` 成对读） */
  deny_rule_count: number;
  /**
   * 本次注入的 `--settings` 字节数；不注入的侧恒为 0。
   *
   * **为什么它必须与另两格同路进判定面**（代码双审 r3 GLM-08 ≡ CODEX-03）：
   * 整份 settings 进**单个 argv 项**，越界就是 spawn 失败（E2BIG），
   * 而**条数看不出规模**——`DENY_SETTINGS_SOFT_CAP_BYTES` 的注释自己说的。
   * 字节数才是 ARG_MAX 预算的主要消费者，是三格里最该被看见的一格。
   *
   * r2 §2.2 的承诺原文三格并列（`deny_rule_count` / `deny_bytes` / `deny_skipped`），
   * 实际只落了两格：字节数此前只活在 `trace.json` 的 `denySettings.bytes` 里，
   * 而那份记录在两条失败出口上**根本不写**——于是超软上限的情形在 `run.json` 层不可见。
   */
  deny_bytes: number;
  command_line: string;
  /**
   * 本次尝试结束后对该侧运行目录的凭据抹除结果。由 `runner` 在 `adapter.run` 的
   * `finally` 里挂上，适配器自己**不填**。`run.json` 不落这个字段（`meta.critics[c]`
   * 逐字段构造，不展开整个结果）；它的可见落点是 `status.json` 的侧 note。
   */
  scrub?: ScrubOutcome;
}
