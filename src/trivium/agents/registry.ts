/**
 * Agent 注册表 —— 全部 Agent 差异的**唯一登记处**（计划 §5.1 / D-1）。
 *
 * 归档后缀、意见编号前缀、配置键、探针段、镜头键、禁读矩阵、Hook 字面集
 * 一律从这里派生。除本文件与各适配器自身外，**任何模块不得出现具体
 * Agent id / 后缀 / 前缀的字面量**——`test/unit/registry-parity.test.ts`
 * 以 grep 级对账守着这条（计划 §2.1）。
 *
 * ## 为什么需要它
 *
 * 重构前，「两侧、角色固定」的假设散落在类型、配置、命名、Hook、Gate 五个
 * 契约层。计划审查（run 20260913T115435Z）两侧合计查出 12 处硬编码，其中
 * `gate.ts:388` 的 `['gemini','glm']` 字面循环会让第三家审核者的意见对 gate
 * **整体不可见**——静默漏裁。人工清单维持不住完整性（原计划稿自称补全 4 处，
 * 审查又补出 8 处），因此完整性改由注册表派生 + 机器对账保证。
 *
 * ## M7a 的边界
 *
 * 本里程碑是**行为等价重构**：注册表登记四项，但 `criticEnabled` 只对
 * gemini / glm 为真，`driverEnabled` 只对 claude 为真——与重构前可选集合
 * 逐项相同。登记而不启用，是为了让注册表从第一天起就是完整的
 * 单一来源（审查意见 AGY-03②）。
 *
 * ## M8 第 3 步的变化
 *
 * codex 的 `criticEnabled` 翻为 true（适配器、探针、镜头、配置形状、模型路由五件齐备）。
 * 同时新增 `defaultSelected`：**「能不能当审核者」与「不选时跑不跑它」自此是两件事**——
 * 否则启用第三家就等于让每次审查的成本自动涨一档（决策 D-1）。
 * claude 的审核者能力仍待 M9，Driver 任意化仍待 M10。
 *
 * ## M10a 第 3 步的变化
 *
 * codex / gemini / glm 的 `driverEnabled` 翻为 true，四家均可作为 Driver。
 * 与此同时 `resolveDriver` 对 `driverEnabled: false` 由「放行 + 标注」收紧为退 64——
 * 今天四家全启用、该分支对本表不可达，它守的是**第五家登记而未启用**的那一格
 * （M10 计划 r7 §4.2 / §9 A4）。收紧只作用于经 `resolveDriver` 的入口，
 * 不经它的面见 `critics.ts` 的 `DriverResolution` 文档块。
 * 任一 Agent 作为 Driver 真实走完命令 B 的真载体验收在 M10b（入口资产随之渲染）。
 * 上面两节是当时的叙事，保留原文。
 */

import path from 'node:path';

/** 已登记的 Agent。取值同时是归档后缀与配置键命名空间 */
export type AgentId = 'claude' | 'codex' | 'gemini' | 'glm';

/** 厂商标识。与 `AgentId` 分开：未来同一厂商可能有多个 Agent */
export type AgentVendor = 'anthropic' | 'openai' | 'antigravity' | 'zcode';

/**
 * 各厂商的**名义**模型族，按模型名判定（EV-62，M10a 第 4 步）。
 *
 * 唯一用途：`isHeterogeneous` 用它近似「当轮 Driver 的模型族」。
 * 编排器不采集 Driver 的生效模型，只能假定 Driver 跑的是其厂商的自家模型——
 * 这是**启发式**。本仓自己就有反例：codex 在本仓默认跑 qwen，Antigravity 提供 claude-* slug。
 * 它也**不是** `agents.codex.profile` 意义上的「家族」：那一个描述的是审核者调用连到哪家
 * provider，与 Driver 会话无关。与演进设计 §5「模型族按生效模型判定、不按 Agent」
 * 在 Driver 一侧有张力，根本解见 BACKLOG EV-107。
 *
 * 以 `Record<AgentVendor, …>` 声明：登记第五个厂商而不补这里，编译期就报错。
 */
export const VENDOR_MODEL_FAMILY: Readonly<Record<AgentVendor, RegExp>> = {
  anthropic: /claude/i,
  openai: /gpt/i,
  antigravity: /gemini/i,
  zcode: /glm/i,
};

/**
 * 护栏等级（计划 §7.5；M10b r10 §3.1.1 改写定义）。
 *
 * L1：blocking Hook **兜得住**该载体上的写入——当轮 Driver 的写操作一律经过 Hook 判定
 * （闸门期写拦截 + Stop 阻断 + 提交完整性锚），没有已知的结构性旁路。
 * L2：**不宣称** Hook 兜得住写入。可以没有 Hook（codex、gemini），也可以有尽力拦截的
 * Hook（glm：只在桌面端、已信任、主代理、matcher 覆盖、不超时时生效）；无论有无，
 * 都靠 approve 前置复核、`_meta` 唯一事实来源、`O_EXCL` 防覆盖与跑后漂移复算补偿。
 * 这是「任意 Agent 可为 Driver」的固有代价，如实分级，不伪装成同等级强制。
 */
export type GuardLevel = 'L1' | 'L2';

/**
 * 入口 skill 的安装根怎么取（M10b r10 §2.2：各家 skill 根由注册表派生，按该家 CLI 自己的规则取值）。
 *
 * 只登记**路径规则**，不做任何文件系统访问——注册表被全仓引用，不该有副作用。
 * 求值见 {@link entrySkillRootOf}。
 */
export interface EntrySkillRootSpec {
  /** 该家 CLI 承认的「家根」环境变量；设了就以它为家根（codex 的 `CODEX_HOME`） */
  homeEnv?: string;
  /** 家根相对用户主目录的缺省位置 */
  homeRel: string;
  /** skill 根相对家根的位置 */
  skillsRel: string;
}

/**
 * 当轮 Driver 所在载体的护栏形态（M10b r10 §3.1.3）：由 `guardLevel` 与「有无 Hook 配置目标」两项派生。
 *
 *   l1-hook  L1，Hook 兜得住（claude）
 *   l2-hook  L2，有尽力拦截的 Hook，不兜底（glm）
 *   l2-none  L2，没有 Hook（codex、gemini）
 *
 * 入口资产注入哪段护栏文案按它选；第 3 步 `preflight` 打印的等级文案与它同源。
 */
export type GuardProfile = 'l1-hook' | 'l2-hook' | 'l2-none';

export interface AgentDescriptor {
  id: AgentId;
  /** 人读名，进播报与报告 */
  display: string;
  /**
   * 审查文档抬头的人读全称（`render.ts` 的第一行）。
   *
   * 「Critic-A / Critic-B」是主设计第 0 章术语表**钉死的称谓**（A = gemini、B = glm），
   * 不是按运行期位置算出来的序号——所以它登记在这里，而不是渲染时数下标。
   * 若按下标算，启用第三家后既有两侧的字母会跟着漂移，历史留痕的抬头就对不上了。
   * codex 于 M8 第 3 步启用为审核者，字母裁定为 **C**（决策 D-2）：A/B 是术语表钉死的
   * 称谓、不是按位置算的序号，所以新启用者取下一个未用字母，既有两侧不受影响。
   * claude 启用时（M9）同理取 D。
   */
  label: string;
  vendor: AgentVendor;
  /**
   * 该 Agent 的 CLI 命令名，进审查文档 front-matter 的 `agent_cli`。
   *
   * 登记而不是从 vendor 三目算：`render.ts` 原先写的是
   * `vendor === 'antigravity' ? 'agy' : 'zcode'`——两值时它恰好穷尽，
   * 而本步把 `Vendor` 放开成注册表的四值后，它会把 codex / claude
   * **静默记成 zcode**。这正是计划 §2.3 点名的那类二元兜底：不报错、
   * 不退非零码，只是留痕直接写错，而 front-matter 是审计凭证。
   *
   * ## 它同时是探针段的索引键（M6 第 1 步）
   *
   * `config.local.yaml` 的 `probe.cli.<cliName>` 按本字段索引，
   * **不按 vendor、也不按 Agent id**。理由是探针探的是「这条命令行能干什么」——
   * 二进制在不在、旗标接不接受、日志落在哪——那是 **CLI 的事实，不是 Agent 的事实**。
   * 若按 Agent id 索引，将来同一厂商的两个 Agent 共用一条 CLI 时会落**两份重复结论**，
   * 而两份还可能互相不一致；按 cliName 索引则天然共享同一份。
   *
   * M6 计划稿原拟新增一个 `probeKey` 字段专门承载它，双审两侧独立判为**过度登记**
   * （AGY-01 / GLM-04）：那会给同一个事实立第二个字段，恰是纪律 7 反对的第二事实源；
   * 而「登记而不是推算」的先例（上一段）治的是**从另一字段推算映射**，
   * 不适用于**同值复用**。`registry-parity` 以两条对账守着这个决定：
   * cliName 全表唯一、探针段具名键 ⊆ cliName 集。
   */
  cliName: string;
  /**
   * 归档后缀，标识**产出方**。恒等于 `id`。
   *
   * 与「发起方」正交：同一后缀在不同运行中可能是 Driver 也可能是审核者，
   * 发起方记在 `run.json.driver`。这条正交性是禁读矩阵不能按后缀差集
   * 生成的根本原因（计划 §3.1 / D-3）。
   */
  suffix: AgentId;
  /** 意见编号前缀，不含连字符。四家互不冲突 */
  findingPrefix: string;
  /** 可作为审核者被 headless 拉起 */
  criticEnabled: boolean;
  /**
   * 缺省是否入选 —— 与 `criticEnabled` **分开的一件事**（M8 第 3 步）。
   *
   * `criticEnabled` 回答「这一家能不能当审核者」，本字段回答「不指定 `--critics` 时跑不跑它」。
   * 此前二者合一：`review.default_critics` 由 `criticEnabled` 全集派生，于是
   * **启用第三家的那一刻，每次审查的配额成本自动涨 1.5 倍**，而那是用户可见的行为变化，
   * 不该由一次「接入」顺带决定（决策 D-1，2026-09-15 由项目负责人裁定：
   * 默认两家，可通过配置改成 1 家或 3 家）。
   *
   * 拆成两个字段而不是在 `config.ts` 里写死 `['gemini','glm']`：后者会让
   * 「默认跑哪几家」多出一个与注册表并列的事实源（纪律 7）。这样 `default_critics`
   * 仍是纯派生值，用户要三审就显式 `--critics` 或改配置。
   */
  defaultSelected: boolean;
  /** 可作为 Driver 发起四条命令 */
  driverEnabled: boolean;
  guardLevel: GuardLevel;
  /**
   * TriviumCode Hook 合并进的**项目内**配置文件（相对项目根）；该家没有 Hook 机制则为 null。
   *
   * 「有没有」决定入口资产注入哪段护栏文案（{@link guardProfileOf}）；
   * glm 的 `.zcode/config.json` 由 M10b 第 3 步的 `trivium hooks --agent glm` 渲染（r10 §3.2）。
   */
  hookConfigTarget: string | null;
  /** 协议片段落点（Driver 协议 + 审查员身份两段式） */
  instructionFiles: readonly string[];
  /**
   * 作为审核者被拉起时会不会读项目记忆（`instructionFiles`）。
   *
   * 决定协议片段要不要带【审查员身份】段：读不到就是死件（EV-44：claude 审核者以 `--restricted`
   * 拉起，实测阻断项目记忆），不写进它的记忆文件（r2 §3.3）。
   */
  criticReadsInstructionFiles: boolean;
  /** 入口 skill 的安装根（M10b 第 2 步多目标安装） */
  entrySkillRoot: EntrySkillRootSpec;
  /**
   * 该家 CLI **还会读**的其它用户级 skill 根（相对用户主目录）。安装前按「完整读取面」查重名
   * （r2 §3.2.2）：同名项在这些根里同样会进模型可见清单。
   * 实测：codex、zcode 都读 `~/.agents/skills`（第 1 步报告 §2.1、§3.6）；agy 不读（§1.3.1）。
   * 这些根**只查不装**：`~/.agents/skills` 是共享读取面，钉为禁装（r2 §3.2.2，P-22）。
   */
  entrySkillExtraReadRoots: readonly string[];
}

/**
 * 四家注册值。
 *
 * 顺序即派生集合的顺序，改动会影响 `ALL_SUFFIXES` 等导出的枚举次序——
 * 那些次序进了 schema pattern 与错误提示文案，因此不要随意重排。
 */
export const AGENTS: readonly AgentDescriptor[] = [
  {
    id: 'claude',
    display: 'Claude Code',
    // 字母取 D：A/B 是术语表钉死的称谓，新启用者取下一个未用字母（决策 D-2，本字段文档块）
    label: 'Critic-D · Anthropic Claude Code',
    vendor: 'anthropic',
    cliName: 'claude',
    suffix: 'claude',
    findingPrefix: 'CLAUDE',
    criticEnabled: true, // M9 第 4 步启用
    /*
     * **`defaultSelected` 保持 false，而且不能翻**（M9 第 4 步）。
     *
     * 两个理由，第二个是硬的：
     * ①翻了等于让每次审查的成本自动涨一档——`criticEnabled` 回答「能不能选」，
     *   本字段回答「不选时跑不跑」，这正是 M8 第 3 步把二者分家的理由；
     * ②`deriveDefaultCritics` 的**上限不变量**会在模块加载期抛：缺省集合现为
     *   codex/gemini/glm 三家，已经顶满内置 `max_critics = 3`，再加一家即 4 > 3。
     *   错误现场离改动点很远（每个项目 init 出来的配置都会判错），所以它在注册表就炸。
     *
     * claude 与另三家的**真正区别**在这里：它是当轮 Driver，
     * 而「当轮 Driver 不得入选」是 `critics.ts` 的独立检查——本字段为 false
     * 只是不默认选它，挡住自审的是那条检查，不是这一行。
     */
    defaultSelected: false,
    driverEnabled: true,
    guardLevel: 'L1',
    hookConfigTarget: '.claude/settings.json',
    instructionFiles: ['CLAUDE.md'],
    criticReadsInstructionFiles: false, // EV-44：审核者以 --restricted 拉起，读不到项目记忆
    entrySkillRoot: { homeRel: '.claude', skillsRel: 'skills' },
    entrySkillExtraReadRoots: [],
  },
  {
    id: 'codex',
    display: 'Codex',
    label: 'Critic-C · OpenAI Codex',
    vendor: 'openai',
    cliName: 'codex',
    suffix: 'codex',
    findingPrefix: 'CODEX',
    criticEnabled: true, // M8 第 3 步启用
    /*
     * **D4-4（2026-09-16，决策者 Chen Zhenbo）：纳入默认集合。**
     *
     * M8 第 3 步的 D-1 当时定的是「启用后也不进默认集合」，理由是
     * 「第 4 步之前这一侧一次真实审查都没跑过，让它默认参与每一轮是拿用户的配额做测试」。
     * 那个理由**随 AC-20 达成而消失**：两个家族各真实审查一次，四个分量逐一有据，
     * 耗时 293s / 1038s、`project_reads` 31 与 40、`evidence_ok` 均为真
     * （见 `doc/05_testing/REPORT_2026-09-16_m8_ac20_acceptance.md`）。
     *
     * **代价是用户可见的**：此后每次 `/dual-review-*` 默认三侧，配额 ×1.5，
     * 墙钟取最慢侧。这是本项目里少数几个「改一行、每个人每次都感觉得到」的开关，
     * 所以它由项目负责人拍板、不由实现顺带决定——翻回去同样是一行。
     *
     * **另一条代价要说在这里**：默认三侧意味着**预检会检查 codex 这一侧**，
     * 于是一台没配置 codex profile 的机器将无法跑任何审查。
     * 失败是响亮的（`availability()` 给可粘贴的配置指引，不静默回落），
     * 但这条确实把本项目的环境门槛抬高了一档。
     *
     * ── 以下两条由 r12 代码双审补齐（CODEX-02 / CODEX-06），它们是这次翻转的
     *    真实边界，先前只写了上面两条代价，读的人无从判断这一行改到了谁 ──
     *
     * **① 这一行只对「配置里没有显式写 `default_critics`」的项目生效。**
     * `trivium init` 落盘的是 `defaultConfig()` 去掉 `probe` 的**整份** YAML，
     * 而 `default_critics: [...DEFAULT_CRITICS]` 就在里面（`config.ts`）——
     * 于是**任何已 init 过的项目都把当时的缺省集合冻进了进 Git 的配置文件**，
     * 此后翻本字段对它们无效，得手工改那份 YAML 或重跑 init。
     * 本仓库不受影响：它走的是 v1 迁移路径，而迁移**故意不补该键**，
     * 所以 `.trivium/config.yaml` 里没有它、本次翻转在这里真实生效。
     * 同一份决策对两类项目效果相反，而没有任何提示会告诉用户自己属于哪一类。
     *
     * **② 按内置默认超时档，本侧在 plan 阶段偏紧。**
     * 内置默认是 `timeout_s: { plan: 900, code: 1200, bug: 1200 }`，
     * 而 AC-20 实测本侧一次代码审耗时 **1038s**——已越过 plan 档，
     * 距 code 档只剩约 14% 余量；`runner` 对超时**不重试**，`failure_policy` 默认 strict。
     * 翻转前这只砸在显式选它的人身上，翻转后落在**每个人每次的默认路径**上。
     * 本仓库把 `plan` 调到了 1500s 所以不吃紧，但内置默认是给别人用的。
     */
    defaultSelected: true,
    driverEnabled: true, // M10a 第 3 步启用
    guardLevel: 'L2',
    hookConfigTarget: null,
    instructionFiles: ['AGENTS.md'],
    criticReadsInstructionFiles: true,
    // 与 `adapters/codex-home.ts` 的 `codexHomeOf()` 同口径：CODEX_HOME 优先，未设回落 ~/.codex
    entrySkillRoot: { homeEnv: 'CODEX_HOME', homeRel: '.codex', skillsRel: 'skills' },
    entrySkillExtraReadRoots: ['.agents/skills'],
  },
  {
    id: 'gemini',
    display: 'Antigravity',
    label: 'Critic-A · Google Antigravity',
    vendor: 'antigravity',
    cliName: 'agy',
    suffix: 'gemini',
    findingPrefix: 'AGY',
    criticEnabled: true,
    defaultSelected: true,
    driverEnabled: true, // M10a 第 3 步启用
    guardLevel: 'L2',
    hookConfigTarget: null,
    instructionFiles: ['GEMINI.md'],
    criticReadsInstructionFiles: true,
    // 全局根；工作区根 print 模式下不读，不作目标（r10 §2.2，报告 §1.2 / §1.3）
    entrySkillRoot: { homeRel: '.gemini', skillsRel: 'config/skills' },
    entrySkillExtraReadRoots: [],
  },
  {
    id: 'glm',
    display: 'ZCode',
    label: 'Critic-B · 智谱 ZCode',
    vendor: 'zcode',
    cliName: 'zcode',
    suffix: 'glm',
    findingPrefix: 'GLM',
    criticEnabled: true,
    defaultSelected: true,
    driverEnabled: true, // M10a 第 3 步启用
    // M10b r10 §3.1（D-2 = (b)）：子代理不过工作区 Hook、命令行模式下工作区 Hook 整体关闭，
    // Hook 兜不住写入，只作尽力拦截（第 1 步报告 §3.1.2、§3.5）
    guardLevel: 'L2',
    // 尽力拦截的工作区 Hook（r10 §3.1）：第 3 步由 `trivium hooks --agent glm` 渲染
    hookConfigTarget: '.zcode/config.json',
    instructionFiles: ['AGENTS.md'],
    criticReadsInstructionFiles: true,
    entrySkillRoot: { homeRel: '.zcode', skillsRel: 'skills' },
    entrySkillExtraReadRoots: ['.agents/skills'],
  },
];

const BY_ID = new Map<string, AgentDescriptor>(AGENTS.map((a) => [a.id, a]));
const BY_PREFIX = new Map<string, AgentDescriptor>(AGENTS.map((a) => [a.findingPrefix, a]));

/** 全部已登记的 Agent id（= 全部归档后缀） */
export const ALL_AGENT_IDS: readonly AgentId[] = AGENTS.map((a) => a.id);

/** 全部意见编号前缀，供 schema pattern 与解析正则生成 */
export const ALL_FINDING_PREFIXES: readonly string[] = AGENTS.map((a) => a.findingPrefix);

/**
 * 全部已登记的 CLI 名 —— **探针段键集的唯一来源**（M6 第 1 步）。
 *
 * 去重是必要的而非防御性的：将来同一厂商的两个 Agent 共用一条 CLI 时，
 * 它们只该占探针段的**一个**键（见 `cliName` 的登记说明）。
 * `registry-parity` 另有一条「cliName 全表唯一」的对账——那条守的是
 * **当前**四家不得重名（重名会让 `agent_cli` 留痕分不清是哪家）；
 * 这里的去重守的是**键集**语义，两者不冲突也不互相替代。
 */
export const ALL_CLI_NAMES: readonly string[] = [...new Set(AGENTS.map((a) => a.cliName))];

/** 按 CLI 名取注册项。同名多 Agent 时返回第一个——调用方只该用它取 CLI 级事实 */
export function agentByCliName(cliName: string): AgentDescriptor | null {
  return AGENTS.find((a) => a.cliName === cliName) ?? null;
}

/** 当前可被选为审核者的 Agent（M7a：gemini / glm；M9 起四家均已启用，EV-61 ⑤） */
export const CRITIC_AGENT_IDS: readonly AgentId[] = AGENTS.filter((a) => a.criticEnabled).map(
  (a) => a.id,
);

/**
 * **缺省入选**的审核者（`review.default_critics` 的唯一来源，M8 第 3 步）。
 *
 * 与 `CRITIC_AGENT_IDS` 的差别就是 `defaultSelected` 那一个字段：
 * 前者是「能选谁」，本集合是「不选时跑谁」。codex 启用后属于前者不属于后者——
 * 三审要显式 `--critics`（决策 D-1）。
 *
 * 断言缺省集合是启用集合的子集：`defaultSelected` 为真而 `criticEnabled` 为假
 * 会让缺省配置直接跑不起来（`critics.ts` 拒掉未启用的 id），
 * 那种组合是登记错误，不该等到运行期才发现。
 */
/**
 * `review.max_critics` 的内置默认值，**同时是缺省集合长度的上限**。
 *
 * 这个 `3` 此前散在三处（`defaultConfig()`、v1 迁移补默认值、schema 校验兜底），
 * 与缺省集合之间没有任何机器约束——而 D4-4 之后两者**正好相等**，零余量。
 * 见 `deriveDefaultCritics` 的说明。
 *
 * **必须定义在 `DEFAULT_CRITIC_AGENT_IDS` 之前**：后者在模块加载期就调用
 * `deriveDefaultCritics`，而这个常量是它的默认参数，写在后面会撞 TDZ
 * （`const` 不像函数声明那样提升，整个 CLI 会起不来）。
 */
export const DEFAULT_MAX_CRITICS = 3;

export const DEFAULT_CRITIC_AGENT_IDS: readonly AgentId[] = deriveDefaultCritics(AGENTS);

/**
 * 由注册表派生「缺省入选」集合，并在同一处校验两条不变量。
 *
 * 提成纯函数而不是内联 IIFE，是为了让这两条不变量**能被测到**：
 * `DEFAULT_CRITIC_AGENT_IDS` 是模块加载期算出的常量，用例没法换一份注册表去试。
 * 于是「加了守卫」与「守卫守对了东西」之间隔着一道没人验过的缝——
 * 而本项目在 M8 里已经踩过一次同类的坑（r12 AGY-01：守卫还在，守的东西没了）。
 *
 * ## 不变量一：缺省集合 ⊆ 启用集合
 *
 * `defaultSelected` 为真而 `criticEnabled` 为假，会让默认配置直接跑不起来
 * （`critics.ts` 拒掉未启用的 id）。那是登记错误，不该等到运行期才发现。
 *
 * ## 不变量二：缺省集合不得超过 `max_critics` 的内置默认
 *
 * 越界的现场**不在这里**，而是「每个项目 `init` 出来的配置变成非法配置」：
 * `default_critics` 项数超过 `max_critics`，schema 当场判错，
 * 而改的人在注册表里看不到任何警告（r12 CODEX-05）。
 * 所以在这里就炸，逼着同一次改动把上限一起抬上去。
 */
export function deriveDefaultCritics(
  agents: readonly AgentDescriptor[],
  maxCritics: number = DEFAULT_MAX_CRITICS,
): readonly AgentId[] {
  const bad = agents.filter((a) => a.defaultSelected && !a.criticEnabled).map((a) => a.id);
  if (bad.length > 0) {
    throw new Error(
      `注册表登记错误：${bad.join('、')} 标了 defaultSelected 却没有 criticEnabled。\n` +
        '  缺省入选必须是已启用审核者的子集，否则默认配置一跑就被 critics.ts 拒掉。',
    );
  }
  const picked = agents.filter((a) => a.defaultSelected).map((a) => a.id);
  if (picked.length > maxCritics) {
    throw new Error(
      `注册表登记错误：缺省入选 ${picked.length} 家（${picked.join('、')}），` +
        `超过内置上限 max_critics=${maxCritics}。\n` +
        '  再纳入一家默认审核者时，必须同时抬高这个上限——否则每个项目 init 出来的\n' +
        '  配置都会因 default_critics 超限而判错，且错误现场离改动点很远。',
    );
  }
  return picked;
}

/** 当前可作为 Driver 的 Agent（M7a 只有 claude；M10a 第 3 步起四家全部启用） */
export const DRIVER_AGENT_IDS: readonly AgentId[] = AGENTS.filter((a) => a.driverEnabled).map(
  (a) => a.id,
);

/**
 * 默认 Driver。
 *
 * M7a 里它就是唯一 Driver；M10 之后仍作为 `--driver` 缺省值，
 * 使未升级的旧入口资产（不带 `--driver` 的调用）行为不变。
 */
export const DEFAULT_DRIVER: AgentId = 'claude';

/**
 * 该 Agent 的护栏形态（见 {@link GuardProfile}）。
 *
 * 「L1 而没有 Hook 配置目标」没有合法来源——L1 的定义就是 Hook 兜得住（r10 §3.1.1），
 * 登记成这样当场抛，不让它被渲染成某一段看似合理的文案。
 */
export function guardProfileOf(agent: AgentDescriptor): GuardProfile {
  const hasHook = agent.hookConfigTarget !== null;
  if (agent.guardLevel === 'L1') {
    if (!hasHook) {
      throw new Error(`注册表登记错误：${agent.id} 登记为 L1 却没有 hookConfigTarget——L1 的前提是 Hook 兜得住写入`);
    }
    return 'l1-hook';
  }
  return hasHook ? 'l2-hook' : 'l2-none';
}

export interface EntrySkillRoots {
  /** 家根：该家 CLI 的配置目录。不存在即视为本机没装这一家 */
  familyRoot: string;
  /** 入口 skill 的安装根 */
  skillsRoot: string;
  /** 完整读取面：安装根 + 额外读取根（查重名用） */
  readRoots: readonly string[];
}

/**
 * 按 {@link EntrySkillRootSpec} 求值。`home` 与 `env` 显式传入：测试一律注入临时 home
 * （r2 §3.2.3），安装器不得在这里偷偷读 `os.homedir()`。
 */
export function entrySkillRootOf(
  agent: AgentDescriptor,
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): EntrySkillRoots {
  const spec = agent.entrySkillRoot;
  const fromEnv = spec.homeEnv ? env[spec.homeEnv] : undefined;
  const familyRoot = fromEnv && fromEnv.length > 0 ? fromEnv : path.join(home, spec.homeRel);
  const skillsRoot = path.join(familyRoot, spec.skillsRel);
  return {
    familyRoot,
    skillsRoot,
    readRoots: [skillsRoot, ...agent.entrySkillExtraReadRoots.map((r) => path.join(home, r))],
  };
}

/** 按 id 取注册项。未登记返回 null——**不得**兜底到任意 Agent */
export function agentById(id: string): AgentDescriptor | null {
  return BY_ID.get(id) ?? null;
}

/** 某字符串是否为已登记的 Agent id */
export function isAgentId(id: string): id is AgentId {
  return BY_ID.has(id);
}

/**
 * 按意见编号前缀反查 Agent。
 *
 * **未匹配返回 null，禁止三目兜底**（计划 §2.2 / A-1）。重构前
 * `disposition.ts` 写的是 `id.startsWith('AGY-') ? 'gemini' : 'glm'`——
 * 第三家的 `CODEX-03` 会被静默归给 glm，裁决差集按错误来源比对，
 * gate 可能放过缺口也可能报假缺口。这类「非 A 即 B」的二元兜底是
 * 泛化期最危险的形态：不抛异常、不退非零码、结论直接是错的。
 */
export function agentByFindingPrefix(prefix: string): AgentDescriptor | null {
  return BY_PREFIX.get(prefix) ?? null;
}

/**
 * 从意见编号（如 `AGY-01`、`GLM-r2-03`、`CODEX-F1`）反查来源 Agent。
 *
 * 同样在未匹配时返回 null，由调用方决定报错还是归入 fallback。
 */
export function agentByFindingId(id: string): AgentDescriptor | null {
  const dash = id.indexOf('-');
  if (dash <= 0) return null;
  return agentByFindingPrefix(id.slice(0, dash));
}

/**
 * 生成「前缀交替」正则片段，如 `AGY|GLM|CLAUDE|CODEX`。
 *
 * 供 `disposition` 行过滤、`gate` fallback 编号读取、`schemas` 的
 * pattern 生成共用——三处重构前各写各的字面量，改一漏二。
 */
export function findingPrefixAlternation(): string {
  return ALL_FINDING_PREFIXES.join('|');
}

/**
 * 生成「后缀交替」正则片段，如 `claude|codex|gemini|glm`。
 *
 * 供角色工件名识别（`naming.looksLikeRoleArtifact`）与 Hook 字面集共用。
 */
export function suffixAlternation(): string {
  return ALL_AGENT_IDS.join('|');
}
