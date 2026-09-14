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
 * 逐项相同。codex / claude 的审核者能力在 M8 / M9 随适配器一并启用，
 * Driver 任意化在 M10。登记而不启用，是为了让注册表从第一天起就是完整的
 * 单一来源（审查意见 AGY-03②）。
 */

/** 已登记的 Agent。取值同时是归档后缀与配置键命名空间 */
export type AgentId = 'claude' | 'codex' | 'gemini' | 'glm';

/** 厂商标识。与 `AgentId` 分开：未来同一厂商可能有多个 Agent */
export type AgentVendor = 'anthropic' | 'openai' | 'antigravity' | 'zcode';

/**
 * 护栏等级（计划 §7.5）。
 *
 * L1 具备 blocking Hook（闸门期写拦截 + Stop 阻断 + 提交完整性锚）；
 * L2 没有，靠 approve 前置复核、`_meta` 唯一事实来源、`O_EXCL` 防覆盖与
 * 跑后漂移复算补偿。这是「任意 Agent 可为 Driver」的固有代价，如实分级，
 * 不伪装成同等级强制。
 */
export type GuardLevel = 'L1' | 'L2';

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
   * codex / claude 启用为审核者时（M8 / M9）字母由届时的设计裁定，现在不预留。
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
  /** 可作为 Driver 发起四条命令 */
  driverEnabled: boolean;
  guardLevel: GuardLevel;
  /** 协议片段落点（Driver 协议 + 审查员身份两段式） */
  instructionFiles: readonly string[];
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
    label: 'Anthropic Claude Code',
    vendor: 'anthropic',
    cliName: 'claude',
    suffix: 'claude',
    findingPrefix: 'CLAUDE',
    criticEnabled: false, // M9 启用
    driverEnabled: true,
    guardLevel: 'L1',
    instructionFiles: ['CLAUDE.md'],
  },
  {
    id: 'codex',
    display: 'Codex',
    label: 'OpenAI Codex',
    vendor: 'openai',
    cliName: 'codex',
    suffix: 'codex',
    findingPrefix: 'CODEX',
    criticEnabled: false, // M8 启用
    driverEnabled: false, // M10 启用
    guardLevel: 'L2',
    instructionFiles: ['AGENTS.md'],
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
    driverEnabled: false, // M10 启用
    guardLevel: 'L2',
    instructionFiles: ['GEMINI.md'],
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
    driverEnabled: false, // M10 启用
    guardLevel: 'L1',
    instructionFiles: ['AGENTS.md'],
  },
];

const BY_ID = new Map<string, AgentDescriptor>(AGENTS.map((a) => [a.id, a]));
const BY_PREFIX = new Map<string, AgentDescriptor>(AGENTS.map((a) => [a.findingPrefix, a]));

/** 全部已登记的 Agent id（= 全部归档后缀） */
export const ALL_AGENT_IDS: readonly AgentId[] = AGENTS.map((a) => a.id);

/** 全部意见编号前缀，供 schema pattern 与解析正则生成 */
export const ALL_FINDING_PREFIXES: readonly string[] = AGENTS.map((a) => a.findingPrefix);

/** 当前可被选为审核者的 Agent（M7a：gemini / glm） */
export const CRITIC_AGENT_IDS: readonly AgentId[] = AGENTS.filter((a) => a.criticEnabled).map(
  (a) => a.id,
);

/** 当前可作为 Driver 的 Agent（M7a：claude） */
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
