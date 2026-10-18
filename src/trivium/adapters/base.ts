/**
 * 适配层统一契约（设计 §11.1）。
 *
 * 适配层是**唯一**允许调用厂商 CLI 的地方（§5.1）。它把两家的差异
 * （参数、输出字段、模型指定方式、只读方式、轨迹来源）收敛为一组请求/结果结构，
 * 上层的 runner / parse / guard 只面对这组结构。
 *
 * 铁律（原则 P7）：**取值必须靠实测才知道的旗标**一律由 probe 结论构造，
 * 不得硬编码设计文档里的示例。**这不等于「适配层不得出现任何旗标字面量」**——
 * 机制类旗标（输出格式、cwd、颜色、prompt 载入方式）由编排器需求决定、不是厂商能力事实，
 * 按设计 §11.1「旗标归属判据」就该写在本层；下面的 buildXxxArgs 本来就是这么写的。
 */
import nodePath from 'node:path';
import os from 'node:os';
import type {
  AccessMeta, AgentConfig, Config, CriticId, CriticRequest, CriticResult, EffortEffectiveSource, Stage, SuspectedWrite, TierName,
  TierSource, CommonProbe,
} from '../types.js';
import { VENDOR_MODEL_FAMILY, agentById, type AgentVendor } from '../agents/registry.js';

export interface AdapterContext {
  cfg: Config;
  /** node 绝对路径（GUI 进程不读 .zshrc，§10.5） */
  nodePath: string;
}

/**
 * 该侧轨迹能提供什么形状的证据（设计 §11.1，M8 第 2 步）。
 *
 * ## 为什么需要它
 *
 * 判定层原先假定「读取路径是结构化拿到的」「被拒的写操作会留痕」。M6 实测
 * （P-C1 / P-C2）推翻了这两条对 codex 的适用性：codex 读文件就是跑 shell，
 * 路径只在命令文本里；被沙箱拒绝的命令一条事件都不产生。
 *
 * 消费方因此必须**面对能力而不是 Agent id**——按 id 分叉是纪律 7 明令禁止的，
 * 而且 M9 的 claude 又是另一种组合，按 id 分叉会分出三支。
 *
 * ## 为什么挂在 `CriticAdapter` 上而不是注册表或 `CriticResult`
 *
 * 不挂 `CriticResult`：能力来自适配器及所选路线的有效探针，不由单次运行自报。
 * 静态 `capability` 保留为契约基线；支持多路线的适配器用 `capabilityFor` 按路线取值。
 *
 * 不挂注册表：`criticEnabled=false` 的 Agent 选不进运行（`critics.ts` 抛 `EXIT.USAGE`），
 * 而 M8 第 2 步不翻 codex 的开关——静态注册表方案下，桩的 `command-trace` 形态
 * **在集成测试里根本走不到**，泛化就没有机器判据（r2 裁决 AGY-04）。
 * 挂适配器则桩适配器可以声明自己的能力。
 */
export interface TraceCapability {
  /**
   * 轨迹形态：专用工具带结构化路径，还是 shell 命令。
   *
   * **消费方有两个**（缺一个就是 r2 那次「无消费方」的误判）：
   * `effectiveReadPaths` 的路径提取、`checkEvidence` 的 `toolTotal` 计数。
   */
  traceShape: 'tool-trace' | 'command-trace';
  /**
   * 被拒的操作是否留痕。
   *
   * `false` ⇒ 该侧**「尝试写」的检测失效**——注意**不是**「轨迹对写事件全盲」：
   * P-C2 只断言被沙箱拒绝的命令不产生事件，**成功执行的写命令照常留痕**
   * （P-C1 的样本本身就是 `status:"completed"` 的命令事件）。
   * 所以 `readonlyBreach` 仍由写事件判定，本字段只修饰**阴性结论**的可信度。
   */
  rejectionRecorded: boolean;
}

/**
 * 该侧审查员能否执行命令（EV-95，审查侧实测措辞约束计划 r2 §2.1）。
 *
 * 消费方是任务书第 7 节：按取值二选一渲染一条证据性质的措辞约束（设计 §9.4 第 7 条）——
 * 不能执行命令的一侧不得把推理说成「实测」，能执行的一侧写「实测」时要在 `evidence` 里给出命令。
 *
 * ## 为什么不并进 `TraceCapability`
 *
 * 那一项回答「轨迹长什么样、判定层怎么分档」，这一项回答「审查员能做什么」，消费方不同。
 * 今天四家碰巧 `command-trace` ⇔ `readonly-shell`，但将来某家的结构化工具面里带命令工具，
 * 两者就对不上。更直接的理由：三家共用 `TOOL_TRACE_CAPABILITY` 一个对象，往常量里加这一项
 * 就是**按轨迹形状批发**能力——每个适配器必须自己声明，不从轨迹形状推导。
 *
 * 取值不留「可写 shell」：任何一家能写都已违反只读保障，不该有一个合法取值来表达它。
 * 各家声明与它们的工具面事实源由 `test/unit/command-execution-parity.test.ts` 对账。
 */
export type CommandExecution = 'none' | 'readonly-shell';

/**
 * 探活能力（M8 第 3 步，收敛 `preflight` 的按厂商分派）。
 *
 * ## 切分口径
 *
 * **厂商知识回到适配器**：指纹从哪个文件算、最小调用怎么发、失败该怎么说。
 * **通用逻辑留在 `preflight`**：TTL、版本比对、缓存读写、失败即不缓存。
 *
 * 这样新增一家只写自己那两件，而缓存策略不会被抄成三份各自漂移。
 * 收敛前 `preflight` 里是 `probeAgyAuth` / `probeZcodeAuth` 两个写死分支，
 * 计划双审两侧独立指出再加第三个就是第三次堆砌（AGY-03 ≡ GLM-06）。
 */
export interface AuthProbe {
  /**
   * 该侧凭据的指纹（通常是凭据文件的哈希），缓存失效判据之一。
   * `null` = 无从计算，此时缓存只由 TTL 与 CLI 版本约束。
   *
   * **文件在而读不了就直接抛**，不要折成 `null`（EV-202）：`probeAuth` 统一兜住——不查也不写缓存、照常探活、
   * 原因接在详情末尾。折成 `null` 会把「读不了」混进「无从计算」，上次指纹为 `null` 时全等比较即命中缓存、跳过探活。
   * zcode 现写法（catch 后返回 `null`）是待改的历史欠账，见 EV-203，别照抄。
   */
  fingerprint(): Promise<string | null>;
  /** 真跑一次最小 headless 调用。**这是预检里最贵的一步**，由调用方决定要不要跑 */
  probe(): Promise<{ ok: boolean; detail: string }>;
}

/** 生产探活必须消费实际路由；可选参数仅供旧调用/夹具兼容。 */
export type AuthCombination = Pick<TierResolution, 'model' | 'effort' | 'vendorProfile'>;

export interface CriticAdapter {
  accessFor?(cfg: Config, profile: string | null): AccessMeta;
  /** 路线探针与版本入口由适配器提供，通用判定不按工具身份分叉。 */
  probeFor?(cfg: Config, profile: string | null): CommonProbe | undefined;
  versionInvocationFor?(cfg: Config, profile: string | null): {
    bin: string | null; prefix: string[]; env: Record<string, string | undefined>;
  };
  capabilityFor?(cfg: Config, profile: string | null): TraceCapability;
  readonly critic: CriticId;
  /** 该侧轨迹的证据形状——判定层据此分档，不按 Agent id 分叉（§11.1） */
  readonly capability: TraceCapability;
  /**
   * 该侧能否执行命令——任务书第 7 节据此二选一（§9.4 第 7 条）。**必填、不给缺省**：
   * 缺省值本身就是一次推导，漏声明应当编不过。与工具面事实源的对账见 `command-execution-parity` 用例
   */
  readonly commandExecution: CommandExecution;
  /**
   * 该侧工具清单里**有、但一被调用即判只读失守**的执行型 MCP 工具名前缀（EV-191，任务书点名禁用MCP执行工具计划 r2 §2.1）。
   * 消费方是任务书第 7 节：非空才在证据性质那一条之后多渲染一条点名的禁令；不声明 / 空数组 ⇒ 第 7 节与改前逐字相同。
   *
   * **可选**：今天只有 zcode 有这一面（经插件带进副本 HOME 的 MCP 工具）。codex 的 MCP 由 `codex-home.ts` 裁剪、
   * claude 有 `--strict-mcp-config`、agy 的工具面是 `tools:` 白名单——它们没有这一面，不声明。
   * **必须引用判失守的那份事实源**（zcode：`ZCODE_MCP_EXEC_PREFIXES`，同一个数组对象），不得另抄一份；
   * 同一引用由 `brief-mcp-exec` 单测断言，替代可选字段失去的「漏声明编不过」。
   * 不并进 `commandExecution`（那是能力枚举、有对账用例）也不并进 `capability`（判定层不读它）。
   */
  readonly mcpExecPrefixes?: readonly string[];
  /**
   * 该侧是否可用（探针结论决定）。不可用时给出人读原因。
   *
   * `opts.vendorProfiles`（M11 第 6 步，设计 11.5「厂商 profile」）：**本轮解析出的厂商 profile**——
   * 与 `-p` 和模型目录比对同出一次 `resolveTier`（`review.ts` 准备阶段、`preflight` 逐阶段收集）。
   * 只对有厂商 profile 概念的侧有意义（今天是 codex），别家照收、忽略。**不传 = 旧行为**：
   * 按 Agent 配置段自己的 profile 判——接口保留的旧行为，现役生产调用方（预检、`review` 准备阶段）都传（代码三审 CODEX-01）。
   * 传了就逐个判、跳过 `null`。
   */
  availability(ctx: AdapterContext, opts?: { vendorProfiles?: readonly (string | null)[] }): { ok: boolean; reason?: string };
  /**
   * **从回读结果派生思考等级生效值**（M11 第 6 步，设计 11.1「思考等级透传与回读」/ 6.7.1）。**必填**。
   *
   * ## 只收回读结果，不收请求
   *
   * 签名里没有 `CriticRequest`：生效值**结构上拿不到请求值**，也就无从拿它冒充（11.5 禁令 ②、
   * 11.1 约束 ②——与 `model_effective` 不拿 `requested` 冒充同一纪律）。codex 会话文件里的
   * `turn_context.payload.effort` 是请求回显（M11 第 1 步 F3），同样不得读成生效值。
   *
   * ## 必填
   *
   * 照 `commandExecution` 的先例：缺省值本身就是一次推导，漏声明应当编不过。新增一家时
   * 「没有回读面」必须如实落 `null`（有思考等级概念记来源 `unverified`，没有这个概念来源也是 `null`），
   * 不得静默落成某个缺省。
   *
   * 失败结果（`failedResult`、runner 兜底）同样经它派生，调用方不另写分支。
   * 偏离 11.1 原表「`CriticResult` 字段」的写法，理由见 M11 第 6 步计划 r2 §2.5，主设计随改。
   */
  effortReadback(result: CriticResult): EffortReadback;
  /**
   * 模型 slug 在与探针目录比对**之前**的归一。**可选**：不需要归一的侧不实现。
   *
   * 存在的理由是 zcode：配置里写短名，实际传参要补 `<providerId>/` 前缀（坑 P-06），
   * 而预检要比对的是**补全后**的形态。这条知识属于那一侧，不该住在 `preflight` 里
   * ——它住在那里时，`checkModelAgainstCatalog` 就得按 vendor 分支，
   * 于是第三家一律落「无法校验」（计划双审 GLM-04）。
   */
  normalizeModelForCatalog?(cfg: Config, model: string): string;
  /**
   * **本次配置下实际生效的模型目录**。**可选**：目录不随配置分层的侧不实现。
   *
   * 存在的理由是 codex：它的模型目录随 `-p` **分层**
   * （`<profile>.config.toml` 可自带 `model_catalog_json`，取不到才回落基底），
   * 于是 `probe.models` 那张**单一**列表拿去校验任何非基底 profile 两个方向都会错——
   * 误杀该 profile 自己的默认模型、误放只在基底目录里的 slug（计划双审 CODEX-05）。
   *
   * 这条知识属于那一侧，与 `normalizeModelForCatalog` 同理不住在 `preflight` 里。
   *
   * **四种返回值语义互不相同，一个都不能合并**（代码双审 CODEX-01 把原先的三态又拆开一格）：
   *
   * | kind | 含义 | 调用方该做什么 |
   * | :--- | :--- | :--- |
   * | `null` | 该族没有比 `probe.models` 更准的来源 | 回落探针那份，既有行为不变 |
   * | `catalog` | 采到了这一份目录 | 用它校验；**它为空就是「确实空」**，记无法校验并说明 |
   * | `fallback` | **采集失败**，不知道目录里有什么 | 回落 `probe.models` 校验，**并把原因说出来** |
   * | `unverifiable` | 确认渲染不出目录（该机没配 `model_catalog_json`） | 记无法校验并说明 |
   *
   * `fallback` 与 `unverifiable` 的区别是本契约的要害：前者是「没测到」，后者是「测出来没有」。
   * 上一版把两者合成同一个空清单，于是一次子进程失败会被读成「确认没有目录」从而**放行**——
   * 把刚建起来的拦截静默降级成 fail-open，而给出的原因还是编的。
   */
  catalogModelsFor?(cfg: Config, vendorProfile?: string | null): CatalogSource | null;
  /**
   * **该模型的原生思考等级枚举**（M11 第 4 步，设计 11.5「原生枚举与校验」）。**可选**：缺席按 `unknown`。
   *
   * 与 `catalogModelsFor` 同理住在适配器里：codex 的枚举在探针的逐 profile 目录里、gemini 的由 slug 后缀派生、
   * glm 没有这个概念——都是那一侧的知识，预检只按通用钩子判，不按 vendor 分派、不读厂商私有探针结构
   * （计划三审 AGY-03）。`vendorProfile` 只对目录随厂商 profile 分层的侧有意义，其余忽略。
   *
   * 三态互不合并（同 `CatalogSource` 的纪律）：`none` 是「该侧没有思考等级」——给了值就该拒；
   * `levels` 是「采到了」——非空而不在其中就该拒；`unknown` 是「不知道」——跳过并说出来。
   */
  reasoningLevelsFor?(cfg: Config, model: string, vendorProfile: string | null): ReasoningLevels;
  /**
   * **本机可用的厂商 profile 名单**（M11 第 4 步，设计 11.5「厂商 profile」预检格 ①）。**可选**：
   * 没有厂商 profile 概念的侧不实现。返回空数组 = 名单为空 ⇒ 预检跳过该项校验（同 slug 规则）。
   */
  vendorProfilesFor?(cfg: Config): string[];
  /** 名单为空也能证明不存在，禁止将明确不存在的名称当未知。 */
  readonly profileNamesAuthoritative?: boolean;
  /**
   * 该侧做模型覆盖时要读的**用户侧文件**（绝对路径，EV-123）。**可选**：不靠副本做覆盖的侧不实现。
   *
   * 契约：文件不在 ⇒ 该侧拉起时不做模型覆盖，跑的是 CLI 自己选的模型。
   * 预检与 `review --start` 据此各给一条只警告的提示（`checkModelOverrideSource`），不拒跑。
   * 路径按运行编排器那个进程的 HOME 解析，与拉起侧同源。
   *
   * 与 `normalizeModelForCatalog` 同理：这条知识属于那一侧，不住在 `preflight` 里——
   * 预检按「入选侧有没有这个成员」判侧，不写 Agent id 或 CLI 名字面量。
   */
  modelOverrideSource?(): string;
  /**
   * 探活。**可选**：没有凭据概念的侧（如桩）不实现，`preflight` 相应跳过并如实说明——
   * 「没得探」与「探过通过」不能长得一样。
   */
  authProbe?(ctx: AdapterContext, projectRoot: string, combination?: AuthCombination): AuthProbe;
  run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult>;
  /**
   * 抹掉该侧在运行目录里留下的**凭据载体**（BACKLOG EV-20）。**可选**：
   * 凭据走 CLI 自身登录态、运行目录里没有副本的侧（agy、桩）不实现，
   * 清扫如实记「该侧无载体」——「没得抹」与「抹过了」不能长得一样，与 `authProbe?` 同一口径。
   *
   * 存在的理由：哪一侧往运行目录放了什么，是**那一侧的知识**——codex 放的是
   * `codexhome/` 下的三份 toml/json，zcode 放的是 `home/.zcode/cli/config.json`
   * （计划双审三侧同时逮到的阻断：原稿以为只有 codex 有副本）。写在 `retention.ts` 里
   * 就得按 Agent id 分叉，第三家接入时改一漏二不会报错（纪律 10）。
   *
   * 入参是该侧目录 `<运行目录>/<侧>/`，即 `path.dirname(req.out_dir)`。
   * 目录不存在时**不得抛**：返回空结果即可。
   * 编排器自写日志（`stdout.*` / `trace.json`）的脱敏不在这里做，由 `scrub.ts` 统一处理。
   */
  scrubRunDir?(sideDir: string, opts?: { sizeCap?: number }): Promise<CarrierScrub>;
}

/** `scrubRunDir` 的返回：删了什么、扫了多少、扫到什么 */
export interface CarrierScrub {
  /** 整份删除的凭据载体（相对该侧目录） */
  deleted: string[];
  /**
   * 整份删除的**扫不动的自有二进制**（相对该侧目录）——与 `deleted` 分开记。
   *
   * 两者的删除**理由不同**，混在一个字段里会让哨兵说假话：`deleted` 是
   * 「编排器自己写进去的凭据载体，按名认」；这一格是「该侧 CLI 跑起来自己生成的
   * 二进制状态库，文本扫描器看不进去、跑后又没有任何代码回读」。
   * 前者不删就是明文凭据在盘上，后者不删就是一份**永远扫不完**的未脱敏面：
   * 模型在沙箱里自读配置副本时 token 可能落进去（CODEX-03 的同一条通道），
   * 而 `complete` 会因此恒为 false，哨兵永不收工、每次会话重扫同一批。
   *
   * 判据与凭据载体同构：**跑后没有回读者就整删**，而不是留着记一条告警。
   */
  unscannableDeleted: string[];
  /** 自有目录里过了扫描器的普通文件数 */
  scanned: number;
  /** 扫描命中而删除的文件（相对该侧目录） */
  removedOnHit: string[];
  /** 模型 I/O 日志里就地脱敏的文件 → 命中处数（相对该侧目录） */
  redacted: Record<string, number>;
  /** 告警：跳过的超大文件等，不影响 ok */
  warnings: string[];
  /** 跳过（超大、二进制、读不了）的文件数——它们仍未脱敏，清扫据此判「这一侧还没扫完」 */
  skipped: number;
  /** 错误：载体删不掉、命中却处理不了——ok:false，清扫会重试 */
  errors: string[];
}

/**
 * 「本次配置下生效的模型目录」的四种答案，见 `CriticAdapter.catalogModelsFor`。
 *
 * 分四格而不是「一个可空清单」，是因为它们要求调用方做**四件不同的事**；
 * 合并任意两格都会让某个「没测到」被当成「测出来没有」。
 */
export type CatalogSource =
  | { kind: 'catalog'; models: string[]; source: string }
  | { kind: 'fallback'; why: string }
  | { kind: 'unverifiable'; why: string };

/**
 * 原生思考等级的三种答案，见 `CriticAdapter.reasoningLevelsFor`。
 *
 * `suffixEncoded`：slug 本身已编码档位（gemini 的 `-low/-medium/-high` 后缀，坑 P-16）——
 * 此时 slug 即权威，再给思考等级不生效（设计 11.5 gemini 特例），预检告警而不校验。
 */
export type ReasoningLevels =
  | { kind: 'none' }
  | { kind: 'levels'; levels: string[]; suffixEncoded?: boolean }
  | { kind: 'unknown'; why: string };

/**
 * `CriticAdapter.effortReadback` 的答案（M11 第 6 步）：原样进 run.json 的
 * `effort_effective` / `effort_effective_source` 与审查文档 front-matter。
 *
 * 三种组合各有含义、不合并：`{值, 'envelope'}` 回执读到了；`{null, 'unverified'}` 该侧有思考等级概念、
 * 但没有回读面或这次没读到；`{null, null}` 该侧没有这个概念。
 */
export interface EffortReadback {
  effective: string | null;
  source: EffortEffectiveSource | null;
}

/** 有思考等级概念、却没有回读面的侧（codex、claude）共用的答案 */
export const EFFORT_UNVERIFIED: EffortReadback = Object.freeze({ effective: null, source: 'unverified' }) as EffortReadback;
/** 没有思考等级概念的侧（zcode）的答案 */
export const EFFORT_NO_CONCEPT: EffortReadback = Object.freeze({ effective: null, source: null }) as EffortReadback;

/** 结构化轨迹两家（gemini / glm）的能力：与本步之前的行为逐字等价 */
export const TOOL_TRACE_CAPABILITY: TraceCapability = {
  traceShape: 'tool-trace',
  rejectionRecorded: true,
};

/**
 * MCP 执行型工具调用进 `write_events` 时的条目前缀（EV-188）：条目形如 `MCP:mcp__node_repl__js(〈参数摘要〉)`。
 *
 * 两个用处：读留痕的人一眼看出这条失守走的是 MCP 通道；`guard.judgeRun` 的 `breachedAbs` 认这个前缀跳过——
 * 括号里是代码摘要不是路径，不能拿来从「无法归因」桶里扣文件。放在这里而不是 zcode 侧，是因为 `guard` 只从本模块取跨族词汇。
 */
export const MCP_WRITE_EVENT_PREFIX = 'MCP:';

/**
 * Agent id → 适配器的查表结构。
 *
 * **是 `Partial`，而且必须是。** `CriticId` 在 M7b 第 6 步放开成注册表全集之后，
 * `Record<CriticId, CriticAdapter>` 就成了一句谎话：它承诺**每一个已登记 Agent**
 * 都有适配器，而 Driver（claude）与尚未接入的 codex 本来就没有、也不该有。
 *
 * 谎话的代价不是类型不好看，而是**取值处的 undefined 检查被类型系统免掉了**：
 * `adapters[critic]` 恒被当成非空，真缺一个就在 `adapter.run` 上崩出一条
 * 与原因无关的 TypeError。改成 Partial 后取值处必须显式判空，缺谁说得出名字。
 *
 * 「已启用为审核者的那几家一定在表里」这条保证由 `realAdapters()` 在取表时
 * **运行期**兑现（缺接线即响亮失败），不靠类型硬编。
 */
export type AdapterTable = Partial<Record<CriticId, CriticAdapter>>;

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
    /**
     * 本次请求的厂商 profile。**失败出口同样要如实写**（代码双审 CODEX-03 ≡ GLM-02）。
     *
     * 上一版这里恒写 null，理由是「两者都没走到」——那句话对**回读值**成立，
     * 对**请求值**不成立：profile 来自静态配置、`-p` 早已进 argv，不需要运行成功才「走到」。
     * 而同一份 run.json 里同为请求值的 `model_requested` 对失败侧照常有值，
     * 于是「该族没有厂商 profile 概念」与「这次超时没采到」又长成了同一个观测——
     * 恰是这个字段声明「必填而非可选」时要避免的那一格。
     */
    profileRequested?: string | null;
    /**
     * 本次**已经构造并注入**的 deny 载荷。**注入过就必须传**（代码双审 r3 GLM-04 ≡ CODEX-04）。
     *
     * 上一版这三格在这里硬编码成 0，注释写的是「该侧不注入 `--settings`、恒为 0，
     * 含义是『没有这种概念』」——那句话对 agy / zcode / codex / stub 成立，
     * **对 claude 的两条失败出口不成立**：deny 在拉起 CLI **之前**就建好并注入了
     * （`claude.ts` 的 `buildDenySettings` 先于超时与「未产出最终回复」两条 return），
     * 规则可能已注入、路径可能确有跳过，`run.json` 却记 0。
     *
     * 那是**说明不了理由的零**——而同一文件上方刚为 `profileRequested` 立过
     * 「请求值 / 已发生的事实照写」的规矩，这里违反的正是同一条。
     *
     * 不传即视为该侧没有这种概念（另四家），三格落 0。
     */
    deny?: { skipped: number; ruleCount: number; bytes: number };
    processStarted?: boolean;
  },
): CriticResult {
  return {
    critic,
    status: fail.status,
    exit_code: fail.exitCode ?? null,
    process_started: fail.processStarted ?? (fail.exitCode !== undefined && fail.exitCode !== null),
    duration_s: fail.durationS ?? 0,
    raw_stdout_path: fail.rawStdoutPath ?? '',
    trace_path: fail.tracePath ?? null,
    review_json: null,
    raw_response_text: fail.rawText ?? null,
    model_effective: null,
    model_effective_source: 'unverified',
    // 回读值确实没走到，如实记 null；请求值是配置事实，调用方给了就照写
    model_provider: null,
    profile_requested: fail.profileRequested ?? null,
    tool_calls: {},
    read_paths: [],
    // 失败出口没有任何轨迹事实可言：与 model_provider 同款，写 null 不写 []
    search_hit_paths: null,
    write_events: [],
    command_texts: [],
    evidence_ok: false,
    fail_reason: fail.reason,
    session_id: fail.sessionId ?? null,
    cli_version: fail.cliVersion ?? null,
    peer_deny_applied: false,
    /*
     * 三格的零只在**没传 `deny`** 时出现，那才是「能说明理由的零」：
     * 含义是「该侧没有这种概念」（不注入 `--settings`），不是「注入了但一条都没跳过」。
     * 注入过的侧必须把真实值传进来——见 `fail.deny` 的文档块。
     */
    deny_skipped: fail.deny?.skipped ?? 0,
    deny_rule_count: fail.deny?.ruleCount ?? 0,
    deny_bytes: fail.deny?.bytes ?? 0,
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
  /**
   * 本次该侧**实际生效**的项目读取下限。
   *
   * 与配置值可能不同：`command-trace` 族按折减系数下调（见 `effectiveMinProjectReads`）。
   * 单列出来是为了进留痕——不记的话，codex 侧 `project_reads=2` 通过、
   * gemini 侧同样是 2 却不通过，事后复盘看起来像 bug。
   */
  minProjectReads: number;
}

export function checkEvidence(
  result: Pick<CriticResult, 'tool_calls' | 'read_paths' | 'trace_path' | 'command_texts'>,
  req: Pick<CriticRequest, 'min_tool_calls' | 'min_project_reads' | 'subject_path' | 'brief_path' | 'project_root'>,
  opts: { archiveRootAbs: string; capability?: TraceCapability },
): EvidenceCheck {
  const reasons: string[] = [];
  const cap = opts.capability ?? TOOL_TRACE_CAPABILITY;
  const commandTrace = cap.traceShape === 'command-trace';

  const tc = result.tool_calls;
  /*
   * ② 的计数口径按轨迹形态分档。
   *
   * `command-trace` 族**必须**计入 `run_command`：该族读文件就是跑 shell，
   * `read`/`grep`/`glob` 三者恒 0，不计就必然触发 `insufficient_evidence`——
   * 这正是 r2 计划稿误判「`commandSemantics` 无消费方」时漏掉的那个消费方。
   * 对 `tool-trace` 族不计入：那一族的 `run_command` 是写事件信号（agy 的白名单里
   * 根本没有它），计进证据就是把失守信号当成读取证据。
   */
  const toolTotal =
    (tc.read ?? 0) + (tc.grep ?? 0) + (tc.glob ?? 0) + (commandTrace ? (tc.run_command ?? 0) : 0);

  // 判定层使用的有效读取路径：command-trace 族从命令文本回填（派生视图，不回写结果）
  const effective = effectiveReadPaths(result, cap, req.project_root);

  // ① 轨迹存在
  if (result.trace_path === null && effective.length === 0 && toolTotal === 0) {
    reasons.push('no_trace：拿不到任何工具调用轨迹');
  }

  // ② 读文件次数下限
  if (toolTotal < req.min_tool_calls) {
    reasons.push(`insufficient_evidence：工具调用 ${toolTotal} 次 < 下限 ${req.min_tool_calls}`);
  }

  /*
   * ③ 项目文件读取下限——防止「把 BRIEF 与被审文档反复读 N 遍」通过上一条。
   *
   * 下限对 `command-trace` 族**单独折减**（r1 裁决 §2.2 第 3 条）：该族的路径靠命令
   * 文本提取，变量拼接、管道组合、`find -exec` 都提不出来，读数**系统性偏低**。
   * 沿用为结构化轨迹定的那个数，等于给该族设了一道不可达的闸；
   * 而按「下限不适用」处置又等于对该族放弃 AC-11——提取偏低但不为零
   * （BRIEF 给的是绝对路径，模型据此读项目文件，提出来就是项目内绝对路径）。
   * 生效值进留痕（`evidence_threshold`），否则同一个读数在两族间一过一不过会像 bug。
   */
  const minProjectReads = effectiveMinProjectReads(req.min_project_reads, cap);

  const excluded = new Set([req.subject_path, req.brief_path].map((p) => normalizeAbs(p, req.project_root)));
  const projectReads = effective.filter((p) => {
    const abs = normalizeAbs(p, req.project_root);
    if (excluded.has(abs)) return false;
    // 归档根内的文件不算「项目上下文」——那是审查材料本身
    if (isUnder(abs, opts.archiveRootAbs)) return false;
    // 项目根之外的读取（~/ 下的无关文件）也不算：AC-11 要的是「结合整个项目评审」
    return isUnder(abs, req.project_root);
  }).length;

  if (projectReads < minProjectReads) {
    reasons.push(
      `no_project_context：被审对象与送审包之外的项目文件读取 ${projectReads} 次 < 下限 ${minProjectReads}`,
    );
  }

  return { ok: reasons.length === 0, reasons, projectReads, minProjectReads };
}

/**
 * `command-trace` 族的项目读取下限折减系数。
 *
 * 取 1/2 并向上取整（默认 3 ⇒ 2）。**依据是设计预期，不是实测**：
 * BRIEF 给审查员的是绝对路径，模型据此读项目文件，提取以直引绝对形态为主；
 * 而变量拼接、管道组合、`find -exec` 提不出来，读数系统性偏低。
 *
 * > 本注释原写「实测样本里直引形态占多数」——那是**编的**：仓库内全部录制样本
 * > 只有 1 条命令（`read-sentinel.jsonl`），n=1 谈不上「占多数」；
 * > 而 r3 裁决 §1.2 刚判定该样本「是探针单次哨兵 fixture、不能用于标定审查全过程阈值」。
 * > 引用一份自己刚判定不可用的材料当依据，与 r3 那次「引用没读过实现的机制」同形。
 *
 * 它是**可调参数**而非推导结论，系数值**待第 3 步真实 codex 轨迹回标**；
 * 改动它要连同 `evidence_threshold` 的留痕一起看。
 */
const COMMAND_TRACE_READS_DIVISOR = 2;

/** 本次该侧实际生效的项目读取下限（进留痕，见 `verification_degraded.evidence_threshold`） */
export function effectiveMinProjectReads(configured: number, cap: TraceCapability): number {
  if (cap.traceShape !== 'command-trace') return configured;
  /*
   * `configured <= 0` 原样返回：配置里的 0 是「**显式关闭下限**」
   * （`config.v2.json` 对 `min_project_reads` 允许 `minimum: 0`）。
   * 原实现的 `Math.max(1, …)` 唯一作用面恰好就是 0——`configured ≥ 1` 时
   * `ceil(x/2) ≥ 1` 恒成立——于是它没做成任何兜底，只做成了「本意折减、
   * 在零值边界反向抬升」，让同一份配置在两族间语义分叉（r6 双审 AGY-03 ≡ GLM-05）。
   */
  if (configured <= 0) return configured;
  return Math.ceil(configured / COMMAND_TRACE_READS_DIVISOR);
}

/**
 * 外层子 shell 封装的剥离。
 *
 * codex 跑命令的真实形态是 `/bin/zsh -lc '<真实命令>'`（M6 P-C1 录制样本 `read-sentinel.jsonl`）。
 * **不剥这一层，整段子命令会塌成一个引号 token，路径一个都提不出来**——
 * r3 计划稿写「引号包裹的整体算一个 token」，被 blocker 正是因为这个。
 *
 * 只剥最外层：嵌套子 shell 在审查场景里不出现，多剥一层不如让它留在文本里被 token 化。
 */
const SUBSHELL_RE = /^\s*\/?(?:[\w./-]*\/)?(?:zsh|bash|sh|dash)\s+-[a-zA-Z]*c\s+(['"])([\s\S]*)\1\s*$/;

function unwrapSubshell(cmd: string): string {
  const m = SUBSHELL_RE.exec(cmd);
  return m ? m[2]! : cmd;
}

/**
 * 这些命令的**目标位**不是读取证据。
 *
 * 两族合一张表：写入点（`cp`/`mv`/`install`/`tee` 的目标）与
 * **目录目标**（`cd`/`mkdir` 的参数是目录，不是被读的文件）。
 * 后者是 r7 双审 GLM-04 实测出的虚报源——`cd src/x`、`mkdir -p dist/x`
 * 都会被「看起来像路径」的判据收成一条项目内读取，而它们一个字节都没读。
 */
const WRITE_VERB_TARGET: Record<string, 'last' | 'all-after-flags'> = {
  // 写入点：目标位是被写的文件
  cp: 'last',
  mv: 'last',
  install: 'last',
  tee: 'all-after-flags',
  // `ln` 两个参数都不读内容：源只是被记下路径，链接名是写入点——与 `cp` 不同族
  ln: 'all-after-flags',
  // 目录目标：参数是目录，不是被读的文件
  cd: 'all-after-flags',
  mkdir: 'all-after-flags',
  rmdir: 'all-after-flags',
  touch: 'all-after-flags',
  pushd: 'all-after-flags',
  // 非读取动词：参数位既不读也不是目录，但同样会被「像路径」判据收进来。
  // `rm` 尤其别扭——它是写动词，目标位计成读证据与口径 4 直接矛盾（r8 GLM-03）
  rm: 'all-after-flags',
  chmod: 'all-after-flags',
  chown: 'all-after-flags',
};

/**
 * 从一条命令原文里提取**读取候选**路径 token（§11.1，M8 第 2 步）。
 *
 * ## 口径（四组，逐组由 r3 双审裁定）
 *
 * 1. **引号穿透**：剥掉外层子 shell 后，`'` / `"` 按分隔符处理。
 *    与措施 b 的 F-5 / F-9 同向——措施 b 有专门的穿透处理，提取侧比它更弱就是漏报。
 * 2. **裸相对路径按 `projectRoot` 归一后计入**（`cat src/a.ts`）。
 *    措施 b 的 `spellingsOf` 对项目根下的条目显式派生 `rel` 与 `./rel` 两种拼写并必检
 *    （F-2 是闭集成员），提取侧同口径。逃逸形态（`../Other/x.ts`）归一后落在项目根外，
 *    由 `checkEvidence` 既有的 `isUnder` 过滤自然排除，不需要单独规则。
 *    （r3 稿曾写「cwd 不可知保守不计」，把 F-6 锚定形态的处理误当成了总体口径。）
 * 3. **`HEAD:<path>` 提取**（EV-01 已列的已知形态）；**通配不展开**——
 *    展开需要文件系统状态，判定层不做 I/O。
 * 4. **写目标位不计入**：输出重定向 `>` / `>>` 的右侧紧邻 token，以及写动词
 *    （`cp`/`mv`/`tee`/`install`/`sed -i`）的目标位。
 *    按 token 级而非命令级排除：命令级会把 `grep foo > out.txt` 里对 `foo` 的**真实读取**
 *    一并丢弃（漏报）；只剔重定向目标又会把 `cp a b` 的 `b` 计成读证据（虚高）。
 *
 * ## 已知边界（如实登记，不是缺陷）
 *
 * **两个方向都要登记**——上一版只列了漏报一侧，而虚报的后果更重：
 * 漏报只是少算一条证据，虚报是**凭空造出一条根本没发生的读取**，
 * 让 AC-11 的约束力比设计口径松（r7 双审 GLM-04）。
 *
 * **漏报（提不出来，`project_reads` 系统性偏低）**：
 * 变量拼接（`cat $F`）、命令替换、管道组合、`find -exec` 传递的路径；
 * 引号内含**空白或段分隔符**的路径（`cat "my notes/a.ts"`、`cat 'report(1).ts'`
 * ——丢整段，宁可漏也不产半截假路径）。下限相应折减（`effectiveMinProjectReads`）。
 *
 * **虚报（已收口的，留作回归清单）**：版本区间（`v1.3.8..v1.3.9`）、断尾路径、
 * 目录目标（`cd` / `mkdir` / `git -C`）、URL（`https://…`）、
 * git 范围与引用（`main..feat`、`origin/master`）、
 * 非读取动词的参数位（`rm` / `chmod` / `ln`）——
 * 各有排除规则与负断言。
 *
 * **仍可能虚报的**：`WRITE_VERB_TARGET` 表外动词的目标/参数位——
 * 既包括目录型（`rsync`），也包括非读取型（`echo src/a.ts` 这种把路径当字面量的）。
 * 类别不止一类，登记按「表外动词」而非「表外目录型动词」写（r8 双审 GLM-03）。
 * 承诺是「已知形态可提、已知虚报源已排除」，不是完备。
 */
/**
 * 重定向运算符（EV-79 缺口二）。
 *
 * 文法：可选 fd 数字**或**前置 `&`，然后 `>` / `>>`，然后可选后置 `&`，
 * 最后可选 zsh 的强制覆盖后缀 `|` / `!`。覆盖 `>`、`>>`、`2>`、`&>`、`&>>`、
 * `>&`、`2>&`、`>>&`、`2>>&`、`>|`、`>&|`、`&>!` 等全族。
 *
 * **承诺面是「按运算符文法覆盖」，不是一张拼写清单**——EV-79 的 r1～r4 每稿都给
 * 穷尽式数目、每稿都被下一轮证明数漏了（`&>` → `>&` → `2>&` → `>>&` → 强制覆盖族）。
 * 文法**边界**：只认以 `>` / `>>` 起首（可带上述前后缀）的运算符；
 * zsh 的 fd 变量重定向 `{var}>f` 在 `^` 锚定下永不匹配，属已知残余（BACKLOG）。
 */
const REDIRECT_RE = /^(?:&|[0-9]*)>>?&?[|!]?/;

/**
 * **唯一有 fd 语义的运算符族**：无强制覆盖后缀的 `[n]>&`。
 *
 * 判别轴是**运算符形态**而不是残留：同一残留 `&2`，在 `>&2` 是 fd 复制、
 * 在 `>>&2` 是往名为 `2` 的文件写（实测两者都建出文件才叫文件重定向）。
 *
 * **三条边界都是实测挣来的，放宽任意一条都会把真实写入静默吃掉**：
 * ①`>>&` 不在族内——`echo X >>& 2` 建出文件 `2`；
 * ②`&>` 不在族内——`echo X &> 2` 建出文件 `2`；
 * ③**带后缀的 `>&|` / `>&!` 不在族内**——`echo x >&| 2` 建出文件 `2`，
 *   clobber 后缀**消去** fd 语义（EV-79 r5 双审三侧同时命中此格）。
 * 断言见 `codex-write-verbs.test.ts` 的「重定向：clobber 后缀消去 fd 语义」
 * 与「重定向：普通数字/减号目标是文件名」两条。
 */
const FD_DUP_OP_RE = /^[0-9]*>&$/;

/**
 * fd 操作的目标位：**恰为**纯数字（复制）或 `-`（关闭）。
 *
 * **必须等值、不可前缀**：`echo Y >&2foo` 建出名为 `2foo` 的文件，
 * 按 `/^&?\d/` 一类前缀实现会把它误排除——静默漏检方向。
 * 断言见「重定向：等值防线——>&2foo 是文件，不是 fd 复制」。
 */
const FD_TARGET_RE = /^(?:\d+|-)$/;

/** 版本号/版本区间形态（`1.3.8`、`v1.3.8..v1.3.9`）——不含 `/`，不是路径 */
const VERSION_LIKE_RE = /^v?\d+(\.\d+)+(\.\.+v?\d+(\.\d+)+)?$/;

/**
 * git 范围语法（`main..feat`、`origin/main..HEAD`、`HEAD~1...HEAD`）。
 *
 * 它们含 `/` 或带点尾缀，会直接通过「看起来像路径」的判据，归一后还落在项目根下——
 * 虚构出一条根本不存在的读取（r8 双审 AGY-02 实测）。
 * 只认**两点/三点区间**这个特征：单个分支名（`origin/master`）由下面的
 * `GIT_REF_LIKE_RE` 另行处理，两者分开是因为后者的误伤面更大，判据要更保守。
 */
const GIT_RANGE_RE = /\.{2,3}/;

/**
 * 裸 git 引用形态（`origin/master`、`upstream/main`）。
 *
 * **只在 `git` 命令段内**启用这条排除：`origin/master` 与一个真实的
 * `origin/master` 目录在字面上无从区分，脱离 git 上下文去排除会误伤真实读取。
 */
const GIT_REF_LIKE_RE = /^(origin|upstream|refs)\/[A-Za-z0-9._\-/]+$/;

/**
 * 一条命令段内的路径提取（段 = 被 `|` / `;` / `&&` / `||` 分开的单元）。
 *
 * **必须按段判定写动词**：整条展平后取首 token 当动词，会让
 * `cat foo.ts | tee out.txt` 的 `tee` 不生效（写目标被计成读证据），
 * 也会让 `cp a b; cat c` 的 `cp` 规则跳掉**第二条命令的真实读取**（漏报）。
 * 一条命令里同时虚高与漏报，正是 r6 双审 GLM-02(b) 实测到的形态。
 */
function extractFromSegment(segTokens: string[], out: string[]): void {
  if (segTokens.length === 0) return;
  const skip = new Set<number>();

  // 口径 4：`… 2> out.txt` 的分离写法，目标在下一个 token
  for (let i = 0; i < segTokens.length; i++) {
    const t = segTokens[i]!;
    if (REDIRECT_RE.test(t) && t.replace(REDIRECT_RE, '') === '') skip.add(i + 1);
  }

  /*
   * 口径 4：写动词的目标位。
   * 动词取 **basename**——`/bin/cp` 与 `cp` 是同一件事，按全路径查表会整条漏掉。
   */
  const verbToken = segTokens[0]!;
  const verb = verbToken.slice(verbToken.lastIndexOf('/') + 1);
  skip.add(0); // 动词本身不是路径（`/bin/cp` 含 `/`，不排会被当成读取）

  const mode = WRITE_VERB_TARGET[verb];
  if (mode === 'last') {
    for (let i = segTokens.length - 1; i > 0; i--) {
      if (!segTokens[i]!.startsWith('-')) { skip.add(i); break; }
    }
  } else if (mode === 'all-after-flags') {
    for (let i = 1; i < segTokens.length; i++) {
      if (!segTokens[i]!.startsWith('-')) skip.add(i);
    }
  }

  /*
   * `git -C <dir>` / `-C <dir>`：`-C` 的参数是**工作目录**，不是被读的文件
   * （`git -C src/x log` 一个字节都没读 `src/x`）。r7 双审 GLM-04 实测。
   */
  for (let i = 0; i < segTokens.length - 1; i++) {
    if (segTokens[i] === '-C') skip.add(i + 1);
  }

  if (verb === 'sed') {
    /*
     * `sed [旗标] <脚本> <文件…>`：第一个非旗标参数是**脚本**，不是路径。
     * 不排它，`s/x/y/` 会因为含 `/` 被「看起来像路径」的判据收进来。
     */
    for (let i = 1; i < segTokens.length; i++) {
      if (!segTokens[i]!.startsWith('-')) { skip.add(i); break; }
    }
    // `-i` 就地改写：最后一个非旗标 token 是写目标
    if (segTokens.some((t) => t.startsWith('-i'))) {
      for (let i = segTokens.length - 1; i > 0; i--) {
        if (!segTokens[i]!.startsWith('-')) { skip.add(i); break; }
      }
    }
  }

  for (let i = 0; i < segTokens.length; i++) {
    if (skip.has(i)) continue;
    let t = segTokens[i]!;
    if (REDIRECT_RE.test(t)) continue;     // `2>out.txt` 紧贴写法
    if (t.startsWith('-')) continue;        // 旗标不是路径
    if (t.includes('*') || t.includes('?')) continue; // 口径 3：通配不展开

    /*
     * URL 不是路径：`curl https://example.com/x` 会被下面的 git 对象正则
     * 剥成 `//example.com/x`，归一后落进项目根下，虚构一条读取（r7 GLM-04 实测）。
     * 判定放在 gitObj 之前——剥完就认不出它原本是 URL 了。
     */
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(t) || t.startsWith('//')) continue;

    // 口径 3：git 对象语法 `HEAD:<path>` / `<sha>:<path>`。
    // Windows 移植：`D:/x` 形态的盘符前缀（冒号前恰是一个盘符字母）不是 git 对象语法，不得剥
    const gitObj = /^(?![A-Za-z]:)[A-Za-z0-9_./^~@{}-]+:(.+)$/.exec(t);
    if (gitObj) t = gitObj[1]!;

    // 版本号与版本区间：`git log v1.3.8..v1.3.9` 的 `.9` 会命中扩展名判据
    if (!t.includes('/') && VERSION_LIKE_RE.test(t)) continue;

    /*
     * git 范围与引用：`main..feat`、`origin/main..HEAD`、`origin/master`。
     * 范围语法（含 `..`）无条件排除——真实路径里出现连续两点只能是 `../`，
     * 而那个形态在这一步之前已经被 `normalizeAbs` 之外的逻辑保留成 `../x` 前缀，
     * 不会是「中缀两点」。裸引用只在 git 段内排除，避免误伤同名真实目录。
     */
    if (GIT_RANGE_RE.test(t) && !t.startsWith('.') && !t.includes('/..')) continue;
    if (verb === 'git' && GIT_REF_LIKE_RE.test(t)) continue;

    // 只有「看起来像路径」的 token 才算：含分隔符，或带扩展名
    if (!t.includes('/') && !/\.[A-Za-z0-9]+$/.test(t)) continue;
    if (t.length === 0) continue;
    out.push(t);
  }
}

export function extractPathTokens(rawCommand: string): string[] {
  const cmd = unwrapSubshell(rawCommand);

  /*
   * 口径 1：引号段在**分段之前**就地处置，内容含空白或段分隔符的整段丢弃。
   *
   * 两类必须丢的内容，理由不同但后果同向：
   *
   * ① **含空白**（`cat "my notes/a.ts"`）——按「替换成空格」的老办法会切成
   *    `my` 与 `notes/a.ts`：真实路径丢失，断尾的 `notes/a.ts` 反被当成一条
   *    项目内读取。**虚构证据比漏报更坏**（r6 双审 GLM-03 实测）。
   *
   * ② **含段分隔符 `;&|()`**（`grep '};' src/a.ts`、`sed -i 's/|/x/' f.ts`）——
   *    引号内的分隔符若原样留到下一步，就和真分隔符再也分不开，命令被错切。
   *    实测两种后果：`grep '};' src/a.ts` 整条漏提（`src/a.ts` 落到段首被当成动词
   *    吞掉），`sed -i 's/|/x/' src/a.ts` 则**把写目标计成读取**——后者更坏，
   *    因为上一轮刚给 `sed` 加的「首个非旗标参数是脚本」规则，
   *    会连同动词上下文一起在错切中失效（r7 双审 AGY-01 ≡ GLM-02 实测）。
   *
   * **② 在引号内是模式/脚本时不付漏报代价**：引号段整体变成空格后，
   * `grep '};' src/a.ts` 归约为 `grep   src/a.ts`——单段、动词是 `grep`、
   * `src/a.ts` 仍是读取源，真实读取照常提得出。
   *
   * > 但这句话**不能推广成「引号内本来就不是路径」**（上一版就是那么写的，
   * > 被 r8 双审 GLM-02 指出是过度断言）：`cat 'report(1).ts'`、`cat 'src/a;b.ts'`
   * > 的引号内**就是路径**——文件名含 `(` 或 `;` 在 shell 里必须引号包裹，
   * > 而「下载重名的 `xxx(1).ext`」是很常见的形态。这一族与 ① 同付漏报代价。
   *
   * 所以漏报登记里两类都要列：引号内含**空白**的路径、含**段分隔符**的路径。
   *
   * > **与措施 b 的 F-5/F-9 不是一回事**，此处不宣称「同向」：
   * > 措施 b 在**整串**上搜 deny 字面量、不分段，所以引号怎么剥都不会错切；
   * > 提取侧要切出命令段来判动词，引号与分段之间就必须有这道交接。
   * > 上一版文档块写着「与 F-5/F-9 同向」，那是把两个不同的问题说成了一个。
   */
  const dequoted = cmd.replace(/(['"`])([\s\S]*?)\1/g, (_m, _q, inner: string) =>
    /[\s;&|()]/.test(inner) ? ' ' : ` ${inner} `,
  );

  // 段边界：`|`、`;`、`&&`、`||`、子 shell 括号——每段各自判动词
  const segments = dequoted.split(/\|\||&&|[|;()]/);
  const out: string[] = [];
  for (const seg of segments) {
    extractFromSegment(seg.split(/[\s<]+/).filter((t) => t.length > 0), out);
  }
  return out;
}

/**
 * 判定层使用的**有效读取路径**（设计 §11.1）。
 *
 * `tool-trace`    ⇒ 就是 `read_paths`（现状，零行为变化）；
 * `command-trace` ⇒ `read_paths` ∪ 从 `command_texts` 按上述口径提取的路径。
 *
 * **这是派生视图，绝不回写 `CriticResult`。** `CriticResult` 是诚实记录，
 * 记的是适配器实际采到什么；把推导结果写回去，留痕就从「采到的」变成「推出来的」，
 * 事后复盘再也分不清哪些是轨迹里真有的。
 *
 * **消费方只有三处**：`checkEvidence` 的 `no_trace` 与 `projectReads`、
 * `judgeSide` 的 consulted 交叉核对。
 * **措施 a（`checkPeerLeak`）不吃回填**——命令里提到某路径不等于读了它
 * （`git log -p` 提到但未必读、`grep -l` 只列文件名）。并进去处置上零增益
 * （措施 b 已让该侧作废）、排查上有损（`peerHits` 与 `peerCommandHits` 分列就是
 * 为了看得出是哪条通道）、语义上降级（措施 a 声称的是文件系统级读取事实）。
 */
export function effectiveReadPaths(
  result: Pick<CriticResult, 'read_paths' | 'command_texts'>,
  cap: TraceCapability,
  projectRoot: string,
): string[] {
  if (cap.traceShape !== 'command-trace') return [...result.read_paths];

  const out = new Set<string>(result.read_paths);
  for (const cmd of result.command_texts) {
    for (const tok of extractPathTokens(cmd)) {
      // 归一到绝对路径：裸相对按 projectRoot 解析（口径 2）
      out.add(normalizeAbs(expandHome(tok), projectRoot));
    }
  }
  return [...out];
}

/**
 * `command-trace` 族的能力（M8 第 3 步）。
 *
 * `rejectionRecorded: false` 的依据是 M6 的 P-C2，并在本步的隔离实测里再次复现：
 * 让模型尝试 `echo BREACH > /tmp/…`，文件未被创建、**而轨迹里连那条命令都没有**。
 * 于是阴性结论（没检出写事件）排除不了「试过但被拒」，只读保障降到两重；
 * 阳性方向不受影响——成功执行的命令照常留痕（P-C1）。
 */
export const COMMAND_TRACE_CAPABILITY: TraceCapability = {
  traceShape: 'command-trace',
  rejectionRecorded: false,
};

/**
 * 写动词闭集 —— 回答「**这是不是写操作**」。
 *
 * ## 为什么不复用 `WRITE_VERB_TARGET`
 *
 * 那张表回答的是另一个问题：「这个参数位**算不算读证据**」。两张表的键集看着像，
 * 语义不同，正确内容因此也不同——`cd` / `pushd` 必须在那张表里（它们的参数是目录、
 * 不是被读的文件），却绝不能在这张表里（它们不发生任何写系统调用）。
 *
 * M8 第 3 步的计划稿曾写「复用那张表的动词集，不新起一张表——两张表会漂移」。
 * 防漂移这个理由本身没错，**错在前提**：防漂移的前提是两张表语义相同。
 * 计划双审两侧独立判它是 blocker（AGY-01 ≡ GLM-01），随后的隔离实测当场复现：
 * 模型跑的第二条命令就是 `/bin/zsh -lc 'cd . && echo ok'`，`exit_code: 0`、
 * `status: completed`，按那个判据会被记成写事件 ⇒ `guard.ts` 无分级地判只读失守
 * ⇒ 整侧作废。审查员开头先 `cd` 再 grep 是最常见的形态，这不是边缘情形。
 *
 * 两张表的关系由 `test/unit/codex-write-verbs.test.ts` 的对账用例守着：
 * `cd`/`pushd` 必须**在** `WRITE_VERB_TARGET`、**不在**本集合。
 * 后来者若再想合并，那条用例会当场红。
 */
const WRITE_VERBS: ReadonlySet<string> = new Set([
  'cp', 'mv', 'install', 'ln', 'tee',
  'rm', 'rmdir', 'mkdir', 'touch',
  'chmod', 'chown', 'truncate', 'dd',
]);

/**
 * 各写动词的**写入位**（与 `WRITE_VERB_TARGET` 的「参数位」分开定义，理由同上）。
 *
 * `ln` 取 `last` 而不是 `all-after-flags`：`ln -s a b` 只创建 `b`，
 * 把源 `a` 也当写入点会在「源在项目内、链接在项目外」时误判。
 */
const WRITE_VERB_SINK: Record<string, 'last' | 'all-after-flags'> = {
  cp: 'last', mv: 'last', install: 'last', ln: 'last', truncate: 'last',
  tee: 'all-after-flags',
  rm: 'all-after-flags', rmdir: 'all-after-flags',
  mkdir: 'all-after-flags', touch: 'all-after-flags',
  chmod: 'all-after-flags', chown: 'all-after-flags',
};

/** 对账用例的读取面：两个集合都要能被测试拿到，才谈得上对账 */
export const WRITE_VERBS_FOR_PARITY: readonly string[] = [...WRITE_VERBS].sort();
export const WRITE_TARGET_VERBS_FOR_PARITY: readonly string[] = Object.keys(WRITE_VERB_TARGET).sort();

export interface WriteCommandClassification {
  /** 高置信写入：目标在项目内、无掩码、非幂等空操作。进 `write_events`，驱动只读失守 */
  writes: string[];
  /** 判不实的：目标在项目外/提不出、段含掩码、幂等形态。**不**驱动失守，只留痕 */
  suspected: SuspectedWrite[];
}

/**
 * 段分隔符（带捕获，`split` 后奇数下标即分隔符本身）。
 *
 * **fd 重定向不是分隔符**：`2>&1`、`>&2`、`&>file` 里的 `&` 与命令分隔无关。
 * 这正是 r9 双审那个 blocker 的两半之一——原判据 `&(?!&)` 既命中 `&&` 的第二个 `&`
 * （它后面是空格，负向前瞻通过），也命中 `2>&1` 的 `&`，于是
 * **在真实写命令后加个 `2>&1` 就能绕过只读失守判定**。
 *
 * 前后顾各排除 `>` 与 `&`：前者挡住 fd 重定向，后者让 `&&` 走前面那条交替分支。
 * 断言这条行为的用例在 `test/unit/codex-write-verbs.test.ts` 的
 * 「掩码：fd 重定向不是掩码」与「掩码：&& 链里的真实写入必须判失守」两条。
 */
const SEGMENT_SPLIT_RE = /(\|\||&&|(?<![>&])[|;&](?![>&])|[()])/;

/** 设备路径：写它不构成对项目或留痕的破坏，也不值得进疑似档 */
function isDevicePath(p: string): boolean {
  return p === '/dev/null' || p.startsWith('/dev/');
}

/**
 * 这个 token 能不能**静态解析**成一条确定路径。
 *
 * 排除的是变量、命令替换与通配——它们要跑起来才知道指向哪里，
 * 判定层不做 I/O 也不展开（与 `extractPathTokens` 的口径一致）。
 *
 * ## 为什么不再用「看起来像路径」那套启发式
 *
 * 上一版用的是 `t.includes('/') || /\.[A-Za-z0-9]+$/.test(t)`，它把**无扩展名的
 * 裸文件名**一并滤掉了（r9 双审 AGY-01 ≡ GLM-02）：`echo bad > Makefile` 因此
 * **两档都不进**（重定向目标被滤空，而 `echo` 不在写动词表，fallback 也不命中），
 * `rm Makefile` / `mkdir build` / `touch LICENSE` 则降级成「提不出目标」。
 * 而 codex 的 cwd 就是项目根，裸相对名正是模型最自然的写法。
 *
 * 根因是那道启发式**用错了地方**：它本是给「参数位猜测」用的，
 * 而重定向目标与写动词的操作数位置是**确定**的，不需要猜。
 * 现在按动词把操作数摘干净（见 `writeSinksOfSegment`），这里只排除解析不了的。
 */
function isResolvablePath(t: string): boolean {
  return t.length > 0 && !/[$`*?]/.test(t);
}

/** 这些动词的第一个非旗标操作数不是路径：`chmod 644 f` 的 `644`、`chown user f` 的 `user` */
const NON_PATH_FIRST_OPERAND: ReadonlySet<string> = new Set(['chmod', 'chown']);

/**
 * 从一段命令里取出写入目标。段已去引号、已按分隔符切开。
 */
function writeSinksOfSegment(tokens: readonly string[]): string[] {
  const sinks: string[] = [];
  /** 被重定向记号消耗掉的下标——不能再当作写动词的操作数（`cp a b 2>&1` 的 `2>&1`） */
  const consumed = new Set<number>();

  /*
   * ① 输出重定向 —— 与动词无关的写形态，必须单列。
   * `echo BREACH > file` 的动词是 `echo`，不在任何写动词表里，
   * 只按动词判会把最常见的写入形态整个漏掉。
   */
  for (let i = 0; i < tokens.length; i++) {
    /*
     * 已被上一轮分离形态消费掉的 token 不再当运算符解析（代码双审 AGY-02）。
     * 没有这道检查时，目标**自身以重定向记号开头**会被二次解析：
     * `echo x > '>foo'` 的目标 token 是 `>foo`（引号剥离不改它），
     * 下一轮迭代会把它当成新运算符、再往 sinks 里推一个 `foo`。
     * 与读面扫描不看 `consumed` 是同一族问题——消费标记要被一致地使用。
     */
    if (consumed.has(i)) continue;

    const t = tokens[i]!;
    const m = REDIRECT_RE.exec(t);
    if (!m) continue;
    consumed.add(i);

    const op = m[0];
    const glued = t.slice(op.length);
    const isFdOp = FD_DUP_OP_RE.test(op);

    if (glued) {
      // 紧贴写法：目标就在本 token 里
      if (isFdOp && FD_TARGET_RE.test(glued)) continue; // `2>&1` / `>&-`：fd 操作，不是文件
      sinks.push(glued);
    } else if (tokens[i + 1]) {
      /*
       * 分离写法：目标在下一个 token。
       *
       * **`consumed.add` 必须无条件执行**，排除支也要——下面取写动词操作数时按
       * `!consumed.has(i)` 过滤，漏消费会让被排除的 fd 编号留在 args 里，
       * `mode === 'last'` 的动词把它当最后一个操作数。
       *
       * **断言见「目标钉死：被排除的 fd 编号不得顶替写动词的真实目标」**
       * （用**项目外**目标构造：取对了进疑似档、取错了归一到项目内进 writes）。
       * 不要拿 `cp /tmp/a src/b.ts >& 2` 那条当判别器——它的目标被 `2` 顶替后
       * 归一成 `/proj/2` **仍在项目内**，两条断言同样成立、分辨不出（代码双审 CODEX-04）。
       */
      consumed.add(i + 1);
      const next = tokens[i + 1]!;
      if (isFdOp && FD_TARGET_RE.test(next)) continue; // `>& 2` / `>& -`：fd 操作
      sinks.push(next);
    }
  }

  // ② 写动词的写入位
  const verb = tokens.find((t) => !t.includes('=')) ?? '';
  const base = verb.split('/').pop() ?? verb;
  if (WRITE_VERBS.has(base)) {
    if (base === 'dd') {
      // dd 的写入点是 `of=`，位置无关
      for (const t of tokens) if (t.startsWith('of=')) sinks.push(t.slice(3));
    } else {
      const verbIdx = tokens.indexOf(verb);
      let args = tokens.filter(
        (t, i) => i > verbIdx && !consumed.has(i) && !t.startsWith('-'),
      );

      /*
       * `-t <dir>` / `--target-directory=<dir>`：目标是那个**目录**，不是最后一个操作数
       * （r9 双审 GLM-04，双向都有翻转案例：`ln -s -t /tmp src/a.ts` 误报、
       * `cp -t src /tmp/a.ts /tmp/b.ts` 漏报）。
       */
      const tIdx = tokens.findIndex((t, i) => i > verbIdx && (t === '-t' || t === '--target-directory'));
      const tInline = tokens.find((t, i) => i > verbIdx && t.startsWith('--target-directory='));
      const targetDir = tInline
        ? tInline.slice('--target-directory='.length)
        : tIdx >= 0
          ? tokens[tIdx + 1]
          : null;
      if (targetDir) {
        sinks.push(targetDir);
        args = [];
      } else if (NON_PATH_FIRST_OPERAND.has(base)) {
        // mode / owner 不是写入目标，跳过；其余操作数**不再过滤**
        args = args.slice(1);
      }

      const mode = WRITE_VERB_SINK[base];
      if (base === 'ln' && args.length === 1) {
        /*
         * `ln -s <源>` 单操作数形态：POSIX 下目标是 cwd 下的 `basename(源)`，
         * 而不是源本身（r9 双审 AGY-05）。取最后一个会把项目内的写入
         * 误判成「目标在项目外」。
         */
        sinks.push(args[0]!.split('/').pop() ?? args[0]!);
      } else if (mode === 'last') {
        const last = args.at(-1);
        if (last) sinks.push(last);
      } else {
        sinks.push(...args);
      }
    }
  }

  return sinks.filter(isResolvablePath);
}

/**
 * 把成功执行过的命令分成「写事件」与「疑似写」两档（设计 §10.3 / §11.1，M8 第 3 步）。
 *
 * ## 调用契约
 *
 * 入参 `succeededCommands` 必须**只含成功执行的命令**（`status: completed`
 * 且 `exit_code === 0`），由适配器筛好再喂进来。本函数不看退出码——
 * `command_texts` 那份全集要留给措施 b（泄漏企图即便失败也要扫），两者论域不同。
 *
 * ## 为什么要分两档
 *
 * 只读失守是**安全指控**，`guard.ts` 对它没有分级：`write_events` 非空即失守、
 * 整侧作废。所以进这一档的必须是高置信形态，其余如实记成疑似——
 * 丢弃它们会让排查失去线索，混进去则会让正常审查被误杀。
 *
 * 三类判不实的形态（计划双审 GLM-01 逐条列出，本实现逐条落地）：
 *
 * 1. **幂等空操作**：`mkdir -p <已存在>` 不发写调用即退 0，`rm -f <不存在>`
 *    按 POSIX 退 0——写动词在场、成功退出，却没有任何写入发生。
 * 2. **失败掩码**：`touch x || true`、`…; true`——整条命令的 exit 0
 *    不代表写段成功。`&&` 不算掩码：`a && b` 退 0 意味着两段都成功。
 * 3. **项目外目标**：见下。
 *
 * ## 「项目外写入不算失守」是本步的裁决，不是宽松
 *
 * 依据是自洽性：codex 每次运行都会往 `$CODEX_HOME/sessions/` 写会话文件，
 * 而本步回读生效模型**正是靠读那个文件**（AC-20 的 J3 依赖它）。
 * 若项目外写入算失守，那么这条流水线赖以工作的那次写入自己就会把每一轮判成失守。
 * 只读承诺的保护对象是**被审项目与归档留痕**，不是「该进程一个字节都不许写」。
 * 项目外写入仍进疑似档——它可能是把被审代码外泄到 `/tmp` 的前兆。
 */
export function classifyWriteCommands(
  succeededCommands: readonly string[],
  projectRoot: string,
): WriteCommandClassification {
  const writes: string[] = [];
  const suspected: SuspectedWrite[] = [];

  for (const raw of succeededCommands) {
    const cmd = unwrapSubshell(raw);
    const dequoted = cmd.replace(/(['"`])([\s\S]*?)\1/g, (_m, _q, inner: string) =>
      /[\s;&|()]/.test(inner) ? ' ' : ` ${inner} `,
    );

    /*
     * 分段并保留分隔符：奇数下标是分隔符，偶数下标是段。
     * 掩码判定**按段**做而不是按整条做（r9 双审 AGY-02 ≡ GLM-01）。
     */
    const parts = dequoted.split(SEGMENT_SPLIT_RE);
    let hitAny = false;

    for (let si = 0; si < parts.length; si += 2) {
      const seg = parts[si]!;
      /*
       * 这一段的成功能否从**整条命令**的 exit 0 推出来？
       *
       * 能推出 ⟺ 它左右紧邻的分隔符都是 `&&`（或不存在）：
       * `a && b` 退 0 意味着两段都成功，而 `a || b` / `a ; b` / `a | b` / `a & b`
       * 的退出码都只反映其中一段。推不出就归疑似档——**判不实不下判决**。
       *
       * 保守之处：`a ; b` 的 **b** 其实可信（exit 0 就是 b 的），这里一并判不可信。
       * 方向是安全的（降级为疑似，不会误判失守），换来的是判据只有一条规则。
       */
      const leftSep = si > 0 ? parts[si - 1] : undefined;
      const rightSep = si + 1 < parts.length ? parts[si + 1] : undefined;
      const masked =
        (leftSep !== undefined && leftSep !== '&&') || (rightSep !== undefined && rightSep !== '&&');

      const tokens = seg.split(/[\s<]+/).filter((t) => t.length > 0);
      if (tokens.length === 0) continue;

      const verb = (tokens.find((t) => !t.includes('=')) ?? '').split('/').pop() ?? '';
      /*
       * 幂等形态：`mkdir -p <已存在>` 不发写调用即退 0，`rm -f <不存在>` 按 POSIX 退 0。
       *
       * **长旗标也要认**（r9 双审 GLM-03）：`^-\w*p` 匹配不了 `--parents`
       * ——第二个 `-` 不是 `\w`。判不出幂等的后果是把一次没有实际写入的成功命令
       * 判成只读失守、整侧作废，**是误杀方向**，本主题对这个方向的定级一贯更重。
       *
       * **但递归 + 强制不算幂等**（EV-79 缺口一）：这是白名单内的**单调性违背**——
       * `rm -r <目标>` 今天判 writes，而**加上** `-f` 之后反而降级到疑似。
       * 给命令增加一个破坏性旗标却让判定变轻，是判据自身的缺陷。
       * `-f` 的幂等理由只对「目标不存在」成立，而这一层不做 I/O 判不出；
       * 对非递归的 `rm -f <文件>` 这个不确定性可以接受，`-r` 把论域扩到整棵子树之后不能。
       *
       * 收紧的**误杀面**（EV-79 计划 §2.4.1，如实登记）：`rm -rf <项目内、实际不存在的目录>`
       * 会被判 writes。它是本次新引入的**可达**路径——`-f` 让目标不存在时也退 0，
       * 从而穿过调用契约的 `exit_code === 0` 筛选；不带 `-f` 的同形态退 1、进不到这里。
       * 排障指纹（**只能用来排除一部分，不能用来坐实**，代码双审 CODEX-09）：
       * 该形态没有工作树改动，故 `snapshot.drift` 为 false。但反过来不成立——
       * `judgeDrift` 是 git 树比对，**看不见被 `.gitignore` 忽略的文件**（未忽略的未跟踪文件在内），`dist/` 之类在 `.gitignore`
       * 里的目录被真实 `rm -rf` 掉同样 drift=false。所以 drift=false 时还须核
       * 目标是否真实存在、是否被 ignore；拿它直接判「误报」会把真失守降级。
       *
       * **递归旗标要一次写全**：`-r` / `-R` / `--recursive` 与簇合形态（`-rf` / `-fr` / `-vrf`）。
       * 与 `-\w*f` 同款用 `/^-\w*[rR]/` 加长旗标等值，**不改前缀匹配**——
       * 本机 BSD `rm` 不接受任何长旗标（实测退 64），前缀匹配只会平白扩大误判面。
       *
       * 四种写法进 writes、两条既有幂等行为不变色，断言见
       * `test/unit/codex-write-verbs.test.ts` 的「幂等：递归 + 强制不算幂等形态」
       * 与「幂等：长旗标 --parents / --force 也要认出来」两条。
       */
      const idempotent =
        (verb === 'mkdir' && tokens.some((t) => /^-\w*p/.test(t) || t === '--parents')) ||
        (verb === 'rm' &&
          tokens.some((t) => /^-\w*f/.test(t) || t === '--force') &&
          !tokens.some((t) => /^-\w*[rR]/.test(t) || t === '--recursive'));

      for (const sink of writeSinksOfSegment(tokens)) {
        if (isDevicePath(sink)) continue;
        hitAny = true;
        const abs = normalizeAbs(expandHome(sink), projectRoot);

        if (!isUnder(abs, projectRoot)) {
          suspected.push({ command: raw, why: `写入目标在项目外：${abs}` });
          continue;
        }
        if (masked) {
          suspected.push({ command: raw, why: '命令含 || 或 ; 掩码，整条退出码不代表写段成功' });
          continue;
        }
        if (idempotent) {
          suspected.push({ command: raw, why: `${verb} 的幂等形态，成功退出不等于发生了写入` });
          continue;
        }
        writes.push(raw);
      }
    }

    // 命中写动词却一个目标都提不出来（变量拼接、命令替换…）——判不出即疑似
    if (!hitAny) {
      const verbs = dequoted
        .split(/\|\||&&|[|;()]/)
        .map((s) => (s.trim().split(/\s+/)[0] ?? '').split('/').pop() ?? '');
      if (verbs.some((v) => WRITE_VERBS.has(v))) {
        suspected.push({ command: raw, why: '命中写动词但提不出写入目标（变量拼接或命令替换）' });
      }
    }
  }

  return {
    writes: [...new Set(writes)],
    suspected: suspected.filter(
      (s, i, arr) => arr.findIndex((x) => x.command === s.command && x.why === s.why) === i,
    ),
  };
}

/** 轨迹核验：读取路径中是否命中禁读清单（§10.1 第 ③ 道 (c) 层 / AC-04） */
export function checkPeerLeak(
  readPaths: readonly string[],
  denyPaths: readonly string[],
  projectRoot: string,
): { leaked: boolean; hits: string[] } {
  /*
   * 两边都归一成绝对路径再比：轨迹里可能是 `./x`、`/abs/../abs/x`、macOS 的 `/private/var/…`
   * 对 `/var/…`；原先纯字符串比对，任何写法差异都会让「读到对方产出」漏报，
   * 而漏报的后果是本应作废的结论照常采纳。
   */
  const denyAbs = denyPaths.map((d) => normalizeAbs(d, projectRoot));
  const denySet = new Set(denyAbs);

  /*
   * 目录形态的条目要按**前缀**命中（审查意见 GLM-03）。
   *
   * 纯 `Set.has()` 时，`.trivium` 这类目录条目永远等不到 `.trivium/state.json`
   * 这样的实际读取路径——BRIEF 第 8 段向审查员承诺「读其中任何一个本次审查即作废」，
   * 而机器核验对它的效力是零。那正是措施 a 要关闭的「提示语禁了一堆、核验只对
   * 其中一部分」的错位，不能在这里再造一个。
   *
   * 判据用 `<条目>/` 前缀而非 `startsWith(条目)`：否则 `.trivium` 会误伤
   * `.trivium-backup` 这类同前缀的兄弟路径。
   */
  const hits = readPaths.filter((p) => {
    const abs = normalizeAbs(p, projectRoot);
    if (denySet.has(abs)) return true;
    return denyAbs.some((d) => abs.startsWith(`${d}${nodePath.sep}`));
  });
  return { leaked: hits.length > 0, hits: [...new Set(hits)] };
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 * 措施 b（§10.1 / BACKLOG EV-01）：命令文本字面扫描
 * ──────────────────────────────────────────────────────────────────────────
 *
 * **为什么路径侧不够**：`checkPeerLeak` 吃的是轨迹里的**读取路径**。经 git 对象库
 * 取对端产物（`git show HEAD:<归档内文件>`）不产生文件系统读取，那条路径根本不出现；
 * 而 codex 侧读文件本就是跑 shell，**全部**读取都只在命令文本里（M6 P-C1）。
 * 对前者本措施是补充，对后者是唯一手段。
 *
 * ## 已知形态清单（本措施承诺必检的闭集）
 *
 * 计划双审 GLM-07 要求把论域钉死：不写数量，写清单。
 *
 * **下表与 `test/unit/peer-leak-command.test.ts` 的 `[F-n]` / `[B-n]` 用例名
 * 由 `known-forms-parity` 那条契约测试做双向对账**——这里多一行、那里少一条用例，
 * 或者反过来，都会红。
 *
 * > r1 双审（GLM-05）指出：初版这里写的是「改清单必须同时改用例，否则 known-forms 会红」，
 * > 而那条守卫只断言测试文件内的本地字面量、**既不读本文档块也不读设计**——
 * > 清单长出 F-6 时它什么都不会红。**注释宣称了不存在的保障**，
 * > 与设计 v1.3.6 记过的那条（注释宣称扫 enum/const、实现只有 enum）同形。
 * > 现在那条对账是真的了。
 *
 * | # | 形态 | 例 |
 * | :-- | :--- | :--- |
 * | F-1 | 绝对路径直引 | `cat /abs/proj/.reviews/t/code/x-<peer>.md` |
 * | F-2 | 项目相对路径直引 | `cat .reviews/t/code/x-<peer>.md`、`./.reviews/…` |
 * | F-3 | git 对象库取值 | `git show HEAD:.reviews/…`、`git cat-file -p <sha>:<path>` |
 * | F-4 | 目录级条目命中 | deny 里是目录时，`ls .trivium/`、`grep -r x .reviews/t/code/_meta/` |
 * | F-5 | 引号/命令替换包裹（双引号、单引号、反引号） | `cat "/abs/…"`、`cat '…'`、``cat `echo …` `` |
 * | F-6 | **锚定前缀**：完整字面量在场、左边不是分隔符 | `cat ../<rel>`、`cat $VAR/<rel>`、`/abs/x/../<rel>` |
 * | F-7 | **家目录写法**：deny 是展开态绝对路径 | `ls ~/.trivium/runs`、`$HOME/…`、`${HOME}/…` |
 * | F-8 | brace expansion | `diff {<rel>,other.md}` |
 * | F-9 | **引号切分**：删掉 `"` `'` 后再扫一遍 | `ls "$HOME"/<deny 后缀>` |
 *
 * F-6～F-8 是 r1 双审补的（GLM-01、AGY-03 ≡ GLM-02、AGY-04），三族当时**全部漏检**。
 * **F-3 是本措施存在的理由**；**F-7 是通道③的唯一覆盖**（EV-01），漏它等于该通道没接上。
 *
 * ## 明确检测不到的（威胁模型按 §10.1 末段，R25 已登记）
 *
 * | 盲区 | 例 |
 * | :--- | :--- |
 * | B-1 **分段拼接**：完整字面量从不出现 | `P=.reviews/t; cat $P/code/x-<peer>.md` |
 * | B-2 **未指名 deny 路径的内容转储** | 见下 |
 * | B-3 glob 展开 | `cat .reviews/*​/code/*-<peer>.md` |
 * | B-4 编码/间接（base64、xargs 取自文件、反斜杠转义 `cat \.reviews/…`） | — |
 * | B-5 **重新指名项目根**：回退层级里夹实体段，但归一后仍落回 deny | cwd 在两层子目录时 `cat ../../../proj/<rel>` |
 *
 * > **B-6 已撤销**（r4 双审 GLM-03）：它原本记的是「引号切分」，
 * > 拒绝理由写的是「剥引号要处理嵌套与转义，是另一套穷举面」——
 * > 那是**完整引号解析**的难度，而实际需要的只是「删掉所有引号再扫一遍」。
 * > **用更难的问题替换实际问题，再以前者的难度拒绝后者**，是论证上的偷换。
 * > 该族已改为真收，见 F-9。**B 表现为 B-1～B-5，编号不回收**——
 * > 留个空位比重排编号安全（旧留痕里引的 B-6 仍能对上这段说明）。
 *
 * **B-2 的范围 r1 双审后重划过**（GLM-03，一窄一宽两头都不准）：
 * - **不含** deny **目录条目自身**的目录级引用——`git log -p -- .trivium` 实测**命中**（F-4 覆盖）；
 * - **含**：deny **文件**条目的**祖先目录**（`git log -p -- .reviews/t/code`）、
 *   **无 pathspec 的裸 `git log -p`**、**从根递归的 `grep -rn . `**、`cat` 通配。
 *   三者都是通用只读命令，设计里曾有的那份 `readonly_commands` 清单也确实列着它们——
 *   但**那份清单从未接线、已于 2026-10-01 删除**（见下），「在白名单内」从来只是纸面。
 *   而 `.reviews/` 进 Git——**HEAD 历史里就有对端产物**。
 *
 * **B-5 是 r2 的收窄动作带出来的**（r3 双审 GLM-03 实测）：
 * 它是 F-6 收窄为「前置段仅 `..`/`.`」的代价，且**不真收**，理由见
 * `prefixIsOnlyDotHops` 的注释。
 *
 * > 同一轮还带出过一条 B-6（引号切分），当时也按「不真收」处理，
 * > 拒绝理由是「剥引号要处理嵌套与转义，是另一套穷举面」。
 * > **r4 双审 GLM-03 打穿了这个理由，B-6 已撤销并改为真收**——见上面的撤销注记与 F-9。
 * > 这两段是历史，不是现状：现在没有 B-6，引号切分是**收得住**的。
 *
 * **非蓄意也会撞上的盲区有两条：B-2 与 B-5**（B-6 已于 r4 改为真收，见 F-9）。
 * r4 双审 GLM-01 指出过「B-2 是唯一非蓄意」在 B-5 入表后已为假——
 * B-2 的特殊之处不在「唯一」，而在**它已拍板不收窄、因此没有缓解措施**（EV-16）；
 * B-5 是 F-6 收窄的代价。B-1/B-3/B-4 各需一个刻意动作。
 *
 * B-2 是 §10.1「git 通道保留能力而非封死」
 * 那条取舍的代价所在。收窄它要在**执行侧**限制能跑哪些命令，不是在检测侧加机制——
 * 而设计曾称作旋钮的 `readonly_commands` **从未接线、已于 2026-10-01 删除**（BACKLOG EV-15 结案）。
 * **对 agy / zcode 不是活风险**（agy 的工具面无命令工具、zcode 全禁 `Bash`），
 * 它在 codex 接入（M8 第 3 步）那一刻变活。codex 侧的执行面现状（2026-10-01 本机 codex-cli 0.159.2 实测）：
 * execpolicy 规则只能**按命令前缀**禁止，写不出「默认拒绝」的白名单，且未接线（BACKLOG EV-184）。
 *
 * **一处反直觉、已实测**：整条赋值里带完整字面量（`P=.reviews/…/x-<peer>.md; cat $P`）
 * **是能检出的**——字面量就在命令文本里。起草时我把「变量拼接」整类写成了盲区，
 * 实测证明只有**分段**拼接才真的躲得过。
 *
 * 本措施的目标是「**泄漏必检 + 成本抬升**」，**不是**抵御蓄意规避——
 * 承诺的是上表 F 清单必检，不是不可绕过。
 */

/** 命令文本里能合法紧邻路径两侧的字符——用于避免子串误命中 */
const CMD_BOUNDARY_CHARS = [
  ' ', '\t', '\n', '\r',
  '"', "'", '`',
  '=', ':', ';', '&', '|', '(', ')', '<', '>', ',',
  // brace expansion（`diff {<peer>,other.md}`，审查意见 AGY-04，已实跑复现漏检）
  '{', '}',
  // `curl -d @<file>`、`git apply @…` 一类把路径直接附在参数上的形态
  '@',
] as const;

const CMD_BOUNDARY = new Set<string>(CMD_BOUNDARY_CHARS);

/**
 * 边界字符的正则字符类（**从同一份定义派生，不另写一套**）。
 *
 * > r4 双审 AGY-01：`tildeUserHit` 当初手写了第二套字符类（`[^/\s"'\`]`），
 * > 与 `CMD_BOUNDARY` 各说各话——于是 `;` `&` `|` `(` `)` `=` `,` `{` `}` `@`
 * > 九种控制符全混得进用户名段（`echo ~;cat/.trivium/runs` 实测误命中），
 * > 而后缀段又把 `}` 吞掉（`diff {other,~user/.trivium/runs}` 漏检）。
 * > **一个概念两处定义，必然分叉**——这是本轮三个问题里两个的共同根因。
 */
const CMD_BOUNDARY_CLASS = CMD_BOUNDARY_CHARS
  .map((c) => c.replace(/[\\\]^-]/g, '\\$&'))
  .join('');

/** 右边界：行尾、分隔符，或 `/`（目录条目下的更深路径，F-4） */
function rightBoundaryOk(text: string, end: number): boolean {
  const after = end >= text.length ? '' : text[end]!;
  /*
   * `/` 写死而不只看 `nodePath.sep`：git 对象语法与 shell 路径分隔符**恒为 `/`**，
   * 与宿主的 `sep` 无关（审查意见 AGY-05）。本项目只跑 macOS，两者当前相等，
   * 所以这不是现行缺陷——但「分隔符取自宿主」这个写法本身就错，与 Windows 无关。
   */
  return after === '' || after === '/' || after === nodePath.sep || CMD_BOUNDARY.has(after);
}

/**
 * 从命中位置回扫出完整的**路径 token**（两侧扩到命令分隔符为止）。
 *
 * 用于 F-6：命中的字面量前面挂了个锚（`../`、`$VAR/`、`/abs/x/../`）。
 * 这时不能只看紧邻的那一个字符——要把整段路径拿出来再判。
 */
function pathTokenAround(
  text: string, start: number, end: number,
): { token: string; hitAt: number } {
  let s = start;
  while (s > 0 && !CMD_BOUNDARY.has(text[s - 1]!)) s--;
  let e = end;
  while (e < text.length && !CMD_BOUNDARY.has(text[e]!)) e++;
  // 一并返回命中在 token 内的偏移：调用方要据此判断「前置段是不是纯回退层级」，
  // 让它自己从三个下标里反推是白白制造一处算错的机会
  return { token: text.slice(s, e), hitAt: start - s };
}

/**
 * token 里含**无法静态解析**的段：变量、命令替换、通配。
 *
 * **`~` 不在其中**（审查意见 AGY-02 ≡ GLM-02）。初版把它一并归进来，
 * 于是 `cat ~/.trivium/config.yaml`、`cat ~/notes/.env` 全成了误报——
 * 而我在 r1 应答里恰恰承诺过「`~/.trivium/…` 归一后是 HOME 下的路径、不等于项目内条目」
 * 这条防线。**`os.homedir()` 是静态已知事实**，`spellingsOf` 自己就在用它做展开，
 * 把它塞进「不可解析」是归并错误。`~` 现在由 `expandTilde` 展开后走精确归一。
 */
const UNRESOLVABLE = /[$`*?]/;

/**
 * `~` 的三种形态要分清（审查意见 AGY-01 ≡ GLM-04）。
 *
 * | 形态 | 处置 | 理由 |
 * | :--- | :--- | :--- |
 * | `~` / `~/…` | **精确展开**后走归一 | `os.homedir()` 是静态已知事实 |
 * | `~user/…` | **保守命中** | 解析不了 `user` 指向谁，而 F-7 是通道③的唯一覆盖 |
 * | 其它 | 原样返回 | 不是家目录写法 |
 *
 * > r2 把 `~` 移出 `UNRESOLVABLE` 时，`~user/` 顺带从「保守命中」掉进了**静默判否**：
 * > 它既不触发保守分支、又展开不了、又过不了 `prefixIsOnlyDotHops`。
 * > 实测 `ls ~username/.trivium/runs` 漏检——而我在那一轮的送审焦点里
 * > 还写着「`~user/` 归入保守命中」，**拿一个不存在的行为去问审查员边界对不对**。
 *
 * 返回 `null` 表示「是家目录写法但展开不了」——调用方据此判保守命中。
 *
 * **但这不是 `~user/` 的主路径**：那种形态下四种派生拼写一个都不在命令文本里，
 * 扫描根本进不到 `hitsAt`，由 `tildeUserHit` 单独兜（见其注释）。
 * 本分支只覆盖「某个拼写已经匹配上、而 token 恰好是 `~user/` 开头」的残余情形，
 * 留着是为了让两条路径的语义一致，不是主要防线。
 */
function expandTilde(token: string): string | null {
  if (token === '~') return os.homedir();
  if (token.startsWith('~/')) return nodePath.join(os.homedir(), token.slice(2));
  if (token.startsWith('~')) return null; // `~user/…`：解析不了，保守命中
  return token;
}

/**
 * token 的前置段是否**仅由 `..` / `.` 组成**（纯回退层级）。
 *
 * 用于逃树兜底的收窄（r1 双审 AGY-01 ≡ GLM-03）：
 * `../<rel>`、`sub/../../<rel>` 是审查员在子目录里指向项目根的自然写法，该命中；
 * `../OtherProject/<rel>` 中间夹了**实体目录段**，判否。
 *
 * > **初版这里写的是「它从任何树内 cwd 都到不了本项目的 deny 条目」——这个全称断言
 * > 不成立**（r2 双审 GLM-03 实测证伪）：cwd 在两层子目录时，
 * > `cat ../../../proj/<rel>` 归一后正是 deny，前置段却含实体名 `proj`。
 * > 这族**重新指名项目根**的写法因此漏检，已登记为盲区 **B-5**。
 * >
 * > 为什么不真收：对整个 token 归一再判，等于把「cwd = 项目根」换成另一组同样无据的
 * > 假设——一层 `../proj/<rel>` 侥幸命中、三层不命中，**「深度决定检出」比明确的盲区更坏**。
 */
function prefixIsOnlyDotHops(token: string, hitStart: number): boolean {
  const prefix = token.slice(0, hitStart);
  if (prefix === '') return true;
  /*
   * **先归一再判段**。按原始段判的话 `sub/../../<rel>` 里的 `sub` 会被当成实体段，
   * 而它归一后就是 `../`——同样是纯回退。起草时漏了这一步，
   * 是用例（照 GLM-03 给的判据写的那条正断言）把它红出来的。
   */
  return nodePath
    .normalize(prefix)
    .split(nodePath.sep === '\\' ? /[\\/]/ : '/')
    .filter((seg) => seg !== '' && seg !== '.')
    .every((seg) => seg === '..');
}

/**
 * 一个 deny 条目在命令文本里可能的写法（绝对、项目相对、`./` 前缀）。
 *
 * **两侧必须用同一套归一**：`normalizeAbs` 会剥掉 macOS 的 `/private` 前缀，
 * 所以 root 也得剥。起草时这里直接用了 `nodePath.resolve(projectRoot)`，
 * 于是临时目录（`/private/var/folders/…`）下 `abs.startsWith(root)` 恒假、
 * **项目相对写法一个都派生不出来**——单测用的是干净的 `/Users/x/proj`，
 * 恰好两边都不带 `/private`，17 条全绿也没照出来。
 * 是故障注入用例在真实临时目录上把它逼出来的。
 */
function spellingsOf(denyPath: string, projectRoot: string): string[] {
  const abs = normalizeAbs(denyPath, projectRoot);
  const root = normalizeAbs('.', projectRoot);
  const out = new Set<string>([abs]);
  // 绝对写法也可能带 /private（命令是照 deny_paths 原样拼的），一并收
  if (abs !== denyPath && nodePath.isAbsolute(denyPath)) out.add(denyPath);

  /*
   * **家目录下的条目补 `~` / `$HOME` 写法**（审查意见 AGY-03 ≡ GLM-02）。
   *
   * 通道③的运行目录（`~/.trivium/runs`）经 `expandHome` 以**展开后的绝对路径**
   * 进 deny 集，而审查员看到 BRIEF 里的绝对路径后改写成 `~/…` 是最自然的动作——
   * 实测 `ls ~/.trivium/runs` 漏检。而 EV-01 明写措施 b 是**通道③在检测侧的唯一覆盖**，
   * 漏它等于该通道在命令侧根本没接上。
   */
  const home = normalizeAbs('.', os.homedir());
  if (abs.startsWith(`${home}${nodePath.sep}`)) {
    // Windows 移植：已归一路径在 win32 用反斜杠，命令文本里 `~/.trivium/...` 的正斜杠写法也要认——
    // 两种变体一并派生（macOS 上两变体相同，Set 去重无痕）
    const suffix = abs.slice(home.length); // 含前导分隔符
    const suffixPosix = nodePath.sep === '\\' ? suffix.replace(/\\/g, '/') : suffix;
    for (const sf of new Set([suffix, suffixPosix])) {
      out.add(`~${sf}`);
      out.add(`$HOME${sf}`);
      out.add(`\${HOME}${sf}`);
    }
  }

  if (abs === root) return [...out];
  if (abs.startsWith(`${root}${nodePath.sep}`)) {
    // Windows 移植：命令文本里的路径恒为正斜杠（shell 域），派生拼写统一转 posix 形态；
    // macOS 上本就是 `/`，转换无痕
    const relRaw = abs.slice(root.length + 1);
    const rel = nodePath.sep === '\\' ? relRaw.replace(/\\/g, '/') : relRaw;
    if (rel.length > 0) {
      out.add(rel);
      out.add(`./${rel}`);
    }
  }
  return [...out];
}

/**
 * 措施 b 的单条目扫描：命令原文里是否出现了**这一个** deny 条目的字面量。
 *
 * 返回命中的命令原文。按条目逐一扫描而不是把全集拼成一张拼写表，
 * 是为了让调用方知道**命中的是哪个条目**——见 `checkPeerLeakViaCommand` 的说明。
 */
function scanCommandsForEntry(
  commandTexts: readonly string[],
  denyPath: string,
  projectRoot: string,
): { command: string; resolved: string | null }[] {
  const denyAbs = [normalizeAbs(denyPath, projectRoot)];
  const spellings = spellingsOf(denyPath, projectRoot);

  /**
   * 命中处那个路径 token 的静态解析结果：归一后的绝对路径，或 `null`（解析不了）。
   *
   * 这是命令通道能与路径通道共用同一分类谓词的**全部凭据**：分档看的是
   * 「碰的是哪个文件」，而条目本身只说明「碰的是哪棵树」。
   * `~/.trivium/runs/<id>/<本侧>/out.json` 与 `…/<对端>/out.json` 撞的是同一个条目
   * （整棵运行根），分属己方材料与对端输出两档——只拿条目分类的话，
   * 两者都会落到最重档，要修的误伤原样保留。
   *
   * `hitAt` 是 deny 拼写在 token 内的偏移：token 前面可能挂着 `../` 一类的锚。
   */
  const resolveFrom = (token: string, hitAt: number): string | null => {
    if (UNRESOLVABLE.test(token)) return null;
    const expanded = expandTilde(token);
    if (expanded === null) return null;
    if (nodePath.isAbsolute(expanded)) return normalizeAbs(expanded, projectRoot);
    const asProjectRel = normalizeAbs(expanded, projectRoot);
    if (denyAbs.some((d) => asProjectRel === d || asProjectRel.startsWith(`${d}${nodePath.sep}`))) {
      return asProjectRel;
    }
    /*
     * 纯回退层级（`../<rel>`）：cwd 未知，而本分支的整个假设就是它指回项目根——
     * 那就按这个假设把 deny 拼写起的那一段归一到项目根下。
     * 猜错的方向是把某个更深的路径记成项目内路径，分类只会更轻不会更重，
     * 而「更重」那一侧由下面 `resolved === null` 的保守回退兜着。
     */
    return normalizeAbs(token.slice(hitAt), projectRoot);
  };

  /** 归一后的 token 是否就是某个 deny 条目、或落在它之下 */
  const resolvesIntoDeny = (token: string): boolean => {
    const a = normalizeAbs(token, projectRoot);
    return denyAbs.some((d) => a === d || a.startsWith(`${d}${nodePath.sep}`));
  };

  const hitsAt = (cmd: string, s: string, i: number): { resolved: string | null } | null => {
    const end = i + s.length;
    if (!rightBoundaryOk(cmd, end)) return null;

    const before = i === 0 ? '' : cmd[i - 1]!;
    if (before === '' || CMD_BOUNDARY.has(before)) {
      // F-1～F-9：左边就是分隔符，命中位置即 token 起点
      return { resolved: resolveFrom(pathTokenAround(cmd, i, end).token, 0) };
    }

    /*
     * ── F-6：完整字面量在场，但前面挂了个锚 ──────────────────────────
     *
     * `cat ../<rel>`、`cat $VAR/<rel>`、`/abs/proj/test/../<rel>`：
     * 三者的 deny 字面量**都逐字出现在命令里**，只是左边不是分隔符。
     * 初版在这里直接判否，于是三种全漏——而 `../` 是 agent 在子目录工作时
     * **最自然**的写法，属威胁模型承诺必检的「非对抗穿透」，不该算盲区
     * （审查意见 GLM-01；三种形态均已实跑复现）。
     *
     * 判法：把命中位置所在的整个路径 token 回扫出来再判，而不是只看紧邻字符。
     */
    /*
     * **只认 `/`**（审查意见 AGY-03 ≡ GLM-02）。初版还放行了 `.`，
     * 于是 `cat ..env`（deny 含 `.env`）走进 F-6：回扫出的 prefix 是 `.`，
     * 归一 + 过滤后**段列表为空**，`.every()` 对空数组恒真 ⇒ 误命中。
     * 同族还有 `cat n/...env`、`cat .id_rsa`（deny 含 `id_rsa`）。
     *
     * 去掉 `.` 分支**不损失任何真阳性**：`./<rel>` 的匹配点在 `./` 的**斜杠之后**，
     * 它走的本来就是 `/` 分支。`.` 在 Unix 里不是路径分隔符，
     * 当初把它放进来是把「文件名里的点」误当成了「路径层级」。
     */
    if (before !== '/') return null;
    const { token, hitAt } = pathTokenAround(cmd, i, end);

    /*
     * token 里有变量 / 命令替换 / 通配时**静态解析不了**它指向哪。
     * 判命中而不是判否：deny 的完整拼写已经逐字在场，我们证明不了它指向别处，
     * 而威胁模型的定调是「泄漏必检 + 成本抬升」——此处宁可误报。
     * 误报的代价是一次审查被判作废（人看得见、可复核）；漏报的代价是锚定污染
     * 无声发生，**尤其在 codex 侧这是唯一核验手段**。
     *
     * `~` **不在此列**：它可静态展开（见 `UNRESOLVABLE` 的注释），走下面的精确归一。
     */
    if (UNRESOLVABLE.test(token)) return { resolved: null };

    /*
     * **替换标记的外壳被回扫切掉了**（r4 双审 GLM-02，实测复现四条）。
     *
     * `(`、`{`、反引号都在 `CMD_BOUNDARY` 里，于是 `cat $(pwd)/<rel>` 回扫出的 token
     * 只剩 `/<rel>`——**`UNRESOLVABLE` 永远看不到它本要保守处理的那个 `$`**。
     * `cat $VAR/<rel>` 能命中纯属巧合：`$` 不是边界字符，留在 token 里了。
     *
     * 实测漏检：`${VAR}/<rel>`、`$(pwd)/<rel>`、`` `pwd`/<rel> ``，以及
     * **`cat $(git rev-parse --show-toplevel)/.trivium/state.json`**——
     * 最后这条是 agent 在任意 cwd 读项目根文件的**教科书写法**，与 F-6 的 `../`
     * 同属「非对抗穿透」，威胁模型承诺必检。登记成盲区就是又一次把承诺面
     * 缩到实现的形状上，所以**真收**。
     *
     * 判法：看截断点左侧紧邻的是不是替换外壳，是则与 `UNRESOLVABLE` 同样保守命中。
     *
     * **看的是闭合侧 `)` `}`，不是开启侧**：回扫止于路径左边最近的边界字符，
     * 而 `$(pwd)/x` 里那个字符是 `)`、`${VAR}/x` 里是 `}`。
     * 起草时我写成了 `(` / `{`，结果只有反引号（开闭同字符）侥幸修好——
     * 三条里两条照旧漏检，是重跑核实脚本才发现的。
     */
    const tokenStart = i - hitAt;
    const shell = tokenStart === 0 ? '' : cmd[tokenStart - 1]!;
    if (shell === ')' || shell === '}' || shell === '`') return { resolved: null };

    const expanded = expandTilde(token);
    // `~user/…`：是家目录写法但解析不了指向谁 ⇒ 保守命中（同 UNRESOLVABLE 的取舍）
    if (expanded === null) return { resolved: null };

    /*
     * 能静态解析的绝对 token：归一后落在 deny 之下才算。
     * 这条保住两条误报防线——
     * `cat /Users/other/repo/<rel>` 归一到项目外判否；
     * `cat ~/.trivium/config.yaml` 展开后是 HOME 下的路径、不等于项目内 `.trivium` 条目，
     * 也判否（**这正是 r1 应答承诺过、而初版没做到的那条**，AGY-02 ≡ GLM-02）。
     * 至于 `~/.trivium/runs/<runId>`：它落在 run-root deny 之下，照常命中。
     */
    if (nodePath.isAbsolute(expanded)) {
      return resolvesIntoDeny(expanded) ? { resolved: normalizeAbs(expanded, projectRoot) } : null;
    }

    /*
     * 相对 token（`../<rel>` 一类）：cwd 未知——审查员**可能**在子目录里。
     * 设计 §10.2 规定工作目录是项目根，但它 `cd` 得动，命令文本本身分辨不了。
     *
     * 所以**只认纯回退层级**（审查意见 AGY-01 ≡ GLM-03）：
     * deny 拼写之前的段仅由 `..` / `.` 组成时才判命中。
     *
     * | token | 判定 | 为什么 |
     * | :--- | :--- | :--- |
     * | `../<rel>` | 命中 | 子目录 cwd 指回项目根的自然写法 |
     * | `sub/../../<rel>` | 命中 | 同上，绕了一圈仍是纯回退 |
     * | `../OtherProject/<rel>` | **判否** | 夹了实体目录段，从任何树内 cwd 都到不了本项目的 deny |
     *
     * **初版这里的注释与实现完全相反**——注释写「归一后仍在项目树内就算命中」，
     * 代码写的是「跑出项目树才命中」，而后者把上表第三行也判成了命中。
     * 误报族集中在 `sensitive_globs` 派生的短名条目上（`.env` / `id_rsa`）：
     * 那类通用名会作为**别的项目**的文件名逐字出现，run-id 档案名则几乎撞不上。
     */
    if (resolvesIntoDeny(expanded)) return { resolved: normalizeAbs(expanded, projectRoot) };
    return prefixIsOnlyDotHops(token, hitAt)
      ? { resolved: normalizeAbs(token.slice(hitAt), projectRoot) }
      : null;
  };

  /*
   * `~user/…` 要单独扫，**不能指望 spelling 匹配**（审查意见 AGY-01 ≡ GLM-04）。
   *
   * 派生的拼写只有绝对态、`~/`、`$HOME/`、`${HOME}/` 四种，
   * 而 `~username/.trivium/runs` 里 `~` 与 `/` 之间隔着用户名，
   * **四种拼写一个都不在命令文本里**——扫描根本进不到 `hitsAt`，
   * 所以在那里加「保守命中」分支是修错了层（起草本轮修复时先错了一次）。
   *
   * 判法：把 `~<name>/<后缀>` 的后缀接到本机 HOME 之下再比。
   * 这样 `~someone/.trivium/runs` 与 `~<自己登录名>/.trivium/runs` 一并覆盖——
   * 前者解析不了指向谁（保守命中），后者本就等价于 `~/`。
   *
   * **正则的三段都从 `CMD_BOUNDARY` 派生**（r4 双审 AGY-01 + GLM-06，五类问题一并收）：
   *
   * | # | 形态 | 原判定 | 原因 |
   * | :-- | :--- | :--- | :--- |
   * | ① | `echo ~;cat/.trivium/runs` | 误命中 | 用户名段没排除控制符（九种全混得进） |
   * | ② | `diff {other,~user/.trivium/runs}` | 漏检 | 后缀段没排除 `}` |
   * | ③ | `npm i pkg@1.0~alpha/.trivium/runs` | 误命中 | `~` 前无边界锚 |
   * | ④ | `echo a~b/.trivium/runs` | 误命中 | 同上——**shell 只在词首做 tilde 展开** |
   * | ⑤ | `~$HOME/.trivium/runs` | 误命中 | `~$…` 不是任何 shell 的合法登录名 |
   *
   * ③④ 由词首边界解决，⑤ 由把 `$` 排除出用户名段解决，①② 由派生字符类解决。
   * 五条都是**纯收窄**，无真阳性损失。
   */
  const homeAbs = normalizeAbs('.', os.homedir());
  /*
   * 三段：①词首边界（行首或边界字符）②用户名段（非边界、非 `/`、非 `$`）③后缀段（非边界）。
   * 用户名段用 `*` 而非 `+`：`~/` 形态由 spellings 覆盖，这里匹配到空名也无害
   * （后缀判定仍要落进 deny 才算）。
   */
  const TILDE_USER = new RegExp(
    `(?:^|[${CMD_BOUNDARY_CLASS}])~[^/$${CMD_BOUNDARY_CLASS}]*(/[^${CMD_BOUNDARY_CLASS}]*)`,
    'g',
  );
  const tildeUserHit = (cmd: string): { resolved: string | null } | null => {
    for (const m of cmd.matchAll(TILDE_USER)) {
      const suffix = m[1]!;
      const asIfHome = normalizeAbs(`${homeAbs}${suffix}`, projectRoot);
      if (denyAbs.some((d) => asIfHome === d || asIfHome.startsWith(`${d}${nodePath.sep}`))) {
        /*
         * `~someone` 指向谁解析不了，但**后缀的层级是确定的**，而分档看的正是层级：
         * `~someone/.trivium/runs/<id>/<本侧>` 照样是己方材料的形状。
         * 所以给出按本机 HOME 归一的那条路径，而不是 `null`——
         * 判「是不是 deny」时它已经这么比过了（就是上面那个 `some`），
         * 判「属哪一档」时换个更重的口径没有依据。
         */
        return { resolved: asIfHome };
      }
    }
    return null;
  };

  const scanOnce = (cmd: string): { resolved: string | null } | null => {
    const tilde = tildeUserHit(cmd);
    if (tilde) return tilde;
    for (const s of spellings) {
      let from = 0;
      for (;;) {
        const i = cmd.indexOf(s, from);
        if (i < 0) break;
        const hit = hitsAt(cmd, s, i);
        if (hit) return hit;
        from = i + 1;
      }
    }
    return null;
  };

  /*
   * **F-9：删掉引号再扫一遍**（r4 双审 GLM-03）。
   *
   * `ls "$HOME"/.trivium/runs/<id>` 里 `$HOME/` 这个拼写被引号打断、
   * token 回扫也在 `"` 处截断，一遍扫描看不见它。
   *
   * > 这一族我上一轮登记成了盲区 B-6，理由写的是「剥引号要处理嵌套与转义，
   * > 是另一套穷举面」。**那个理由是论证上的偷换**：它只对「正确解析引号结构」成立，
   * > 而这里需要的只是**删掉所有引号再扫一遍**——不解析任何结构。
   * > 我用一个更难的问题替换了实际问题，再以前者的难度拒绝了后者。
   *
   * 为什么安全：删引号只会**新增**命中、不会丢失命中，而新增的那部分恰好落在
   * **F-5 已经承诺的范围内**（F-5 本就把 `'…'` / `"…"` 整包路径判命中）。
   *
   * **反引号不动**：它是命令替换的语法，删掉会把 `` `pwd`/x `` 变成 `pwd/x`，
   * 改变语义而非只去包装——那才真是另一套穷举面。
   */
  const stripQuotes = (cmd: string): string => cmd.replace(/["']/g, '');

  const out: { command: string; resolved: string | null }[] = [];
  for (const cmd of new Set(commandTexts)) {
    const hit = scanOnce(cmd) ?? scanOnce(stripQuotes(cmd));
    if (hit) out.push({ command: cmd, resolved: hit.resolved });
  }
  return out;
}

/** 一条命令命中了哪些禁读条目 */
export interface CommandDenyMatch {
  /** 命中的命令原文 */
  command: string;
  /**
   * 这条命令撞上的禁读条目，至少一个。
   *
   * - `entry`：禁读集里的那个条目（原样，未归一）——说明「撞的是哪棵树」。
   * - `resolved`：命令里那个路径 token 归一后的绝对路径，`null` 表示静态解析不了
   *   （变量、命令替换、通配）。分类**优先用它**，为 `null` 时才退回 `entry`。
   */
  hits: { entry: string; resolved: string | null }[];
}

/**
 * 措施 b 的判据：命令原文里是否出现了 deny 条目的字面量。
 *
 * 返回**两样都给**：
 *
 * - `hits`：命中的**命令原文**。处置时要让人看见「它跑了哪条命令」——
 *   只报路径的话，`git show HEAD:<path>` 与 `cat <path>` 在留痕上无从区分，
 *   而这两者的性质差别正是本措施存在的理由。
 * - `matches`：每条命中的命令**撞上了哪些条目**。这是 r2 代码双审阻断一逼出来的：
 *   没有它，调用方判不了「这条命令碰的是哪一档」，只能退而求其次——
 *   拿作废类条目整体再扫一遍，用两次全集扫描的差值去猜。那个做法与路径通道
 *   **不是同一个谓词**：路径通道逐条命中判类，命令通道判的是「条目本身」，
 *   于是同一棵目录在两条通道上会得出相反结论（整棵运行根在路径通道里按命中的
 *   子文件分档，在命令通道里按根自己分档）。现在两条通道都拿到「命中的条目」，
 *   用同一个 `dispose` 处置。
 *
 * 一条命令可以同时撞上多个条目（`diff <己方材料> <对端产出>`），所以 `entries`
 * 是数组而不是单值——调用方按**最重档**处置那条命令。
 */
export function checkPeerLeakViaCommand(
  commandTexts: readonly string[],
  denyPaths: readonly string[],
  projectRoot: string,
): { leaked: boolean; hits: string[]; matches: CommandDenyMatch[] } {
  if (commandTexts.length === 0 || denyPaths.length === 0) {
    return { leaked: false, hits: [], matches: [] };
  }
  /*
   * 按命令聚合，顺序随 `commandTexts`——留痕里命令的先后是可读的信息，
   * 按条目聚合会把同一条命令拆到多处。
   */
  const byCommand = new Map<string, { entry: string; resolved: string | null }[]>();
  for (const d of denyPaths) {
    for (const { command, resolved } of scanCommandsForEntry(commandTexts, d, projectRoot)) {
      const cur = byCommand.get(command);
      if (cur) cur.push({ entry: d, resolved });
      else byCommand.set(command, [{ entry: d, resolved }]);
    }
  }
  const matches: CommandDenyMatch[] = [];
  for (const cmd of new Set(commandTexts)) {
    const hits = byCommand.get(cmd);
    if (hits && hits.length > 0) matches.push({ command: cmd, hits });
  }
  return { leaked: matches.length > 0, hits: matches.map((m) => m.command), matches };
}

/**
 * 展开前导 `~` / `$HOME` / `${HOME}`。
 *
 * **在 `normalizeAbs` 之前做**：`path.resolve` 把 `~/x` 当裸相对路径，
 * 会解析成 `<projectRoot>/~/x`——那条路径既不存在、也与 consulted 里的写法对不上，
 * 于是 `consultedUnverified` 误报（r6 双审 AGY-05 实测）。
 * 与措施 b 的 `spellingsOf` 同口径：那里也把家目录的三种写法一并派生。
 */
function expandHome(p: string): string {
  const home = os.homedir();
  if (p === '~' || p === '$HOME' || p === '${HOME}') return home;
  if (p.startsWith('~/')) return nodePath.join(home, p.slice(2));
  if (p.startsWith('$HOME/')) return nodePath.join(home, p.slice('$HOME/'.length));
  if (p.startsWith('${HOME}/')) return nodePath.join(home, p.slice('${HOME}/'.length));
  return p;
}

/**
 * 同一份家目录展开口径的导出名：第 4 段与第 8 段的交集校验（`brief.ts` 的 `findDenyConflicts`）用它，
 * 与本文件的措施 a / 措施 b 同宽（EV-02 代码双审 CODEX-02——`util/fsx.ts` 那份只认 `~`，窄一格）。
 * 另起名字是为了不与 `fsx.expandHome` 同名混用。
 */
export const expandHomeSpellings = expandHome;

/** 归一成绝对路径：解析 `./`、`..`，并抹平 macOS 的 /private 前缀 */
/**
 * 归一成绝对路径，并抹平 macOS 的 `/private` 前缀双形态。
 *
 * **导出是有理由的**（r1 代码双审 CODEX-06）：分类器原先自己用裸 `path.relative`
 * 比较，而匹配走这里——于是运行根落在 `/var` 一类路径上时，
 * 匹配通道命中而分类通道判在根之外，又落回兜底最重档。
 * 两处必须用同一套口径，否则「判到哪一类」与「判没判中」会各说各话。
 */
export function normalizeAbs(p: string, projectRoot: string): string {
  const abs = nodePath.resolve(projectRoot, p);
  return abs.startsWith('/private/') ? abs.slice('/private'.length) : abs;
}

/** `abs` 是否等于 `root` 或落在它之下。两侧都先抹平 `/private` 前缀；win32 另把分隔符归一（调用方常给正斜杠根 + 反斜杠绝对路径的混合形态） */
export function isUnder(abs: string, root: string): boolean {
  const stripPrivate = (p: string): string => (p.startsWith('/private/') ? p.slice('/private'.length) : p);
  const norm = (p: string): string => (nodePath.sep === '\\' ? stripPrivate(p).replace(/\\/g, '/') : stripPrivate(p));
  const a = norm(abs);
  const r = norm(root);
  return a === r || a.startsWith(r.endsWith('/') ? r : `${r}/`);
}

/**
 * 把一条轨迹路径归一成**项目相对路径**；不在任一 root 之下返回 `null`。
 *
 * consulted 交叉核对此前是「切 projectRoot 前缀 + 精确相等 + `./` 变体」（guard.ts 旧实现），
 * 没有 realpath 感知、也没有分隔符边界——macOS `/tmp` 与 `/private/tmp`、`/repo` 与 `/repository`
 * 都会出错（M9 第 6 步代码双审 CODEX-07 / 计划双审 AGY-04）。这里**扩展**既有的 `normalizeAbs`
 * + `isUnder`，不另写第二份归一化（计划双审 CODEX-06）：`roots` 由调用方给
 * `[projectRoot, realpath(projectRoot)]`，realpath 取不到就只传前者。
 */
export function toProjectRelative(p: string, roots: readonly string[]): string | null {
  const abs = normalizeAbs(expandHome(p), roots[0] ?? '/');
  for (const root of roots) {
    const r = normalizeAbs(root, '/');
    if (!isUnder(abs, r)) continue;
    const rel = nodePath.relative(r, abs);
    // Windows 移植：项目相对路径是命令/留痕域的形态，恒用 `/`（win32 的 relative 产出反斜杠）
    const relPosix = nodePath.sep === '\\' ? rel.replace(/\\/g, '/') : rel;
    return relPosix === '' ? '.' : relPosix.replace(/^\.\//, '');
  }
  return null;
}

/** 基础组合的来源：定义上移到 `types.ts`（M11 第 6 步，计划三审 AGY-01），这里原样再导出 */
export type { TierSource };

/**
 * 解析结果里每个字段从哪来：`tier` 档位条目 ｜ `cell` 档位表格子（裸 slug 或 `{model, effort}`）｜
 * `cli` 命令行精确值 ｜ `agent` Agent 配置段的补全（厂商 profile 回落、gemini 阶段级 effort 回落）。
 */
export type FieldOrigin = 'tier' | 'cell' | 'cli' | 'agent';

/** 命令行一级（第二段的精确值与第一段的 `--tier-<id>`）。旗标随 M11 第 5 步，本步以参数形式进来 */
export interface TierOverrides {
  tier?: TierName | null;
  model?: string | null;
  effort?: string | null;
  vendorProfile?: string | null;
}

export interface TierResolution {
  model: string | null;
  effort: string | null;
  /** 厂商 profile（codex 的 `-p`）；无此概念的族恒 null */
  vendorProfile: string | null;
  tier: TierName | null;
  /** 无模型时为 null */
  tierSource: TierSource | null;
  origin: { model: FieldOrigin | null; effort: FieldOrigin | null; vendorProfile: FieldOrigin | null };
  /*
   * 原有 `agentVendorProfile` / `stageEffort` 两个字段，M11 第 6 步删除：只供过渡闸与过渡残余告警比对
   * 「解析结果」与「第 6 步之前运行期实际下传的值」，透传接线后两者同一，闸与告警随之拆除。
   * 裸 slug 格子回落阶段级 effort 的**规则本身**保留（永久规则，见下方 `resolveTier` 的补全段）。
   */
  /**
   * 档位表格子显式写了空串（计划三审 CODEX-03 / 代码三审 GLM-01）：按「无模型」处理，**不回落 `default_tier`**——
   * 显式写空是配置错误，与「写错档名不落到下一级」同一口径；预检据此在「未定义模型」文案里点明是空串。
   */
  emptySlug: boolean;
  /** 档位名指向未定义的档：解析不抛，由预检统一报 64 并列可用档 */
  missingTier: { name: TierName; via: 'cli' | 'profile' | 'agent_default'; defined: TierName[] } | null;
  /** 被覆盖的字段原本来自档位时的告警（设计 11.5，不阻断） */
  warnings: string[];
}

/** 三档清单。导出给命令行旗标层（`tier-flags.ts`）复用——同一事实只留一份（M11 第 5 步，计划三审 GLM-03） */
export const TIER_NAMES: readonly TierName[] = ['low', 'medium', 'high'];

/**
 * **档位解析**（设计 11.5 两段式，M11 第 4 步）。纯函数：不读盘、不读环境。
 *
 * 取代原 `routeModel`（只解析模型单值，且收一个从未有人传过的 `topic` 参数——主题级覆盖规范有、
 * 实现从未接线，v1.3.129 从规范删除，BACKLOG EV-226）。
 *
 * **第一段 · 基础组合**，取第一个命中者：①`cli.tier` → `cli`；②档位表格子：`{tier}` → 该档、`profile`；
 * `{model, effort}` → 该组合、`profile`；裸 slug → 该模型、`legacy`（行为与旧 `routeModel` 逐字相同）；
 * ③`agents.<id>.tiers[default_tier]` → `agent_default`。命中的引用指向未定义的档 ⇒ 记 `missingTier`、
 * 不再往下找（显式写错的档不能静默落到下一级）。空串裸 slug 按「无模型」、同样不往下找（记 `emptySlug`）——
 * 没有 `default_tier` 时与旧实现的 falsy 判定结果相同（退 64），有时也不静默回落（代码三审 GLM-01）。
 *
 * **补全**：厂商 profile 取 档位条目 > `agents.<id>.profile`（注册表声明能力的侧）；裸 slug 格子的思考等级
 * 回落 antigravity 段的阶段级 `effort`（11.5：「档位表格子是裸 slug 时」的回落；M11 第 6 步之前由 `effortFor` 单独取值、
 * 判据相同，第 6 步起请求面只认本函数的结果，`effortFor` 删除）。
 *
 * **第二段 · 按字段叠加精确值**：`cli.model` / `cli.effort` / `cli.vendorProfile` 各自覆盖；
 * 被覆盖字段原本来自档位时告警。
 *
 * **`tier` / `tier_source`**（11.5 / 6.7.1，计划三审 AGY-01 统一后的规则）：基础组合**提供的字段**被精确值
 * 全部覆盖、或第一段无命中 ⇒ `null` / `override`；否则档位记档位名与其来源，`{model, effort}` 格子
 * 记 `null` / `profile`，裸 slug 记 `null` / `legacy`。「提供的字段」按实际给出的键计，补全不算。
 *
 * vendor 取注册表登记的，不取配置段里自称的：后者是被校验的一方（原 `effortFor` 的同一判据）。
 */
export function resolveTier(
  cfg: Config,
  critic: CriticId,
  stage: Stage,
  cli: TierOverrides = {},
): TierResolution {
  const agent = (cfg.agents as Partial<Record<string, AgentConfig>>)[critic];
  const vendor = agentById(critic)?.vendor ?? null;
  const tiers = agent?.tiers ?? {};
  const defined = TIER_NAMES.filter((n) => tiers[n] !== undefined);

  const supportsProfiles = agentById(critic)?.supportsProfiles === true;
  type Fields = { model?: string; effort?: string; profile?: string | null };
  type Base = { kind: 'tier' | 'cell' | 'legacy'; source: Exclude<TierSource, 'override'>; tier: TierName | null; fields: Fields };
  let base: Base | null = null;
  let missingTier: TierResolution['missingTier'] = null;

  const fromTier = (name: TierName, via: 'cli' | 'profile' | 'agent_default'): Base | null => {
    const e = tiers[name];
    if (!e) {
      missingTier = { name, via, defined };
      return null;
    }
    const fields: Fields = { model: e.model };
    if (e.effort !== undefined) fields.effort = e.effort;
    // 厂商 profile 只对注册表声明能力的侧有意义。
    if (e.profile !== undefined && supportsProfiles) fields.profile = e.profile;
    return { kind: 'tier', source: via, tier: name, fields };
  };

  const cell = cfg.profiles[cfg.active_profile]?.[critic]?.[stage];
  const emptySlug = !cli.tier && cell === '';
  if (cli.tier) {
    base = fromTier(cli.tier, 'cli');
  } else if (typeof cell === 'string') {
    if (cell) base = { kind: 'legacy', source: 'legacy', tier: null, fields: { model: cell } };
  } else if (cell && typeof cell === 'object' && 'tier' in cell) {
    base = fromTier(cell.tier, 'profile');
  } else if (cell && typeof cell === 'object' && 'model' in cell) {
    base = { kind: 'cell', source: 'profile', tier: null, fields: { model: cell.model, effort: cell.effort } };
  } else if (agent?.default_tier) {
    base = fromTier(agent.default_tier, 'agent_default');
  }

  const fieldOrigin: FieldOrigin | null = base ? (base.kind === 'tier' ? 'tier' : 'cell') : null;
  let model: string | null = base?.fields.model ?? null;
  let effort: string | null = base?.fields.effort ?? null;
  let originModel: FieldOrigin | null = model !== null ? fieldOrigin : null;
  let originEffort: FieldOrigin | null = effort !== null ? fieldOrigin : null;

  const stageEffort =
    vendor === 'antigravity' && agent?.vendor === 'antigravity' ? (agent.effort?.[stage] ?? null) : null;
  if (effort === null && base?.kind === 'legacy' && stageEffort !== null) {
    effort = stageEffort;
    originEffort = 'agent';
  }

  const agentVendorProfile = supportsProfiles && agent && 'profile' in agent ? (agent.profile ?? null) : null;
  let vendorProfile: string | null = null;
  let originProfile: FieldOrigin | null = null;
  if (supportsProfiles) {
    if (base?.fields.profile !== undefined) {
      vendorProfile = base.fields.profile;
      originProfile = 'tier';
    } else if (agentVendorProfile !== null) {
      vendorProfile = agentVendorProfile;
      originProfile = 'agent';
    }
  }

  const warnings: string[] = [];
  const fromTierNote = base?.kind === 'tier' ? `档位「${base.tier}」` : '';
  if (cli.model) {
    if (originModel === 'tier') warnings.push(`${critic}/${stage}：命令行模型「${cli.model}」覆盖了${fromTierNote}的模型「${model}」`);
    model = cli.model;
    originModel = 'cli';
  }
  if (cli.effort) {
    if (originEffort === 'tier') warnings.push(`${critic}/${stage}：命令行思考等级「${cli.effort}」覆盖了${fromTierNote}的「${effort}」`);
    effort = cli.effort;
    originEffort = 'cli';
  }
  // 厂商 profile 的命令行覆盖按注册表能力；无能力侧由旗标层退 64。
  if (cli.vendorProfile !== undefined && supportsProfiles) {
    if (originProfile === 'tier') warnings.push(`${critic}/${stage}：命令行厂商 profile「${cli.vendorProfile}」覆盖了${fromTierNote}的「${vendorProfile}」`);
    vendorProfile = cli.vendorProfile;
    originProfile = 'cli';
  }

  const overridden: Record<keyof Fields, boolean> = {
    model: Boolean(cli.model),
    effort: Boolean(cli.effort),
    profile: cli.vendorProfile !== undefined && supportsProfiles,
  };
  const provided = base ? (Object.keys(base.fields) as (keyof Fields)[]).filter((k) => base.fields[k] !== undefined) : [];
  const allOverridden = provided.length > 0 && provided.every((k) => overridden[k]);

  let tier: TierName | null = null;
  let tierSource: TierSource | null = null;
  if (model !== null) {
    if (!base || allOverridden) tierSource = 'override';
    else {
      tierSource = base.source;
      tier = base.tier;
    }
  }

  return {
    model,
    effort,
    vendorProfile,
    tier,
    tierSource,
    origin: { model: originModel, effort: originEffort, vendorProfile: originProfile },
    emptySlug,
    missingTier,
    warnings,
  };
}

/**
 * 审查模型是否与当轮 Driver 异构（FR-17 / AC-18；EV-62 起按当轮 Driver 判定）。
 *
 * 判据：模型名**不落在** Driver 厂商的名义模型族里，即判异构。两层都是启发式：
 * 模型族靠模型名判（`VENDOR_MODEL_FAMILY`），Driver 的模型族靠厂商近似。
 * 所以 `true` 的准确读法是「未检出同族」，不是「确认异构」。
 * 取不到模型名时判 `true`，与改动前一致。
 */
/** @deprecated 仅保留旧名义族判据的历史测试；v3生产链路只用compareRunModels，不回算历史布尔。 */
export function isHeterogeneous(model: string | null, driverVendor: AgentVendor): boolean {
  if (!model) return true;
  return !VENDOR_MODEL_FAMILY[driverVendor].test(model);
}
