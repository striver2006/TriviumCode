/**
 * 载体描述表（r2 计划 D1′/D2′）。
 *
 * 本表是注册表（src/trivium/agents/registry.ts 的 cliName / entrySkillRoot /
 * entryInvocation）与 skills-src/carriers/*.yaml 所载事实的**插件侧镜像**——插件
 * 无法 import 核心仓代码，这是允许的最小事实集。防漂移靠对账单测
 * `test/unit/carriers.test.ts`：直接读注册表源码与载体 yaml 文本逐项核对，
 * 核心侧演进时测试先红先知（CLAUDE-08）。
 *
 * `invocation` 是**终端 CLI 完整调用模板**（CLAUDE-01/CODEX-01：ZCode 命令行是
 * `/skill <名字>`，不是桌面端的 `/名字`；插件拉起的恒为终端 CLI）。
 */

export type AgentId = 'claude' | 'codex' | 'gemini' | 'glm';
/** 探针 probe.cli 的键（CLI 名，与 Agent id 不同名：gemini→agy、glm→zcode） */
export type CliKey = 'claude' | 'codex' | 'agy' | 'zcode';

export const AGENT_IDS: readonly AgentId[] = ['claude', 'codex', 'gemini', 'glm'];

export interface CarrierDescriptor {
  readonly agentId: AgentId;
  readonly cliKey: CliKey;
  readonly display: string;
  /**
   * 终端 CLI 调用模板，`{name}` 为命令名（dual-run 等）。
   * 事实来源：registry.entryInvocation（桌面端形态）与 skills-src/carriers/*.yaml
   * 注释中登记的 CLI 展开形态（zcode CLI 为 `/skill 名字`）。
   */
  readonly invocation: string;
  /**
   * 拉起模式（AGY-02）：direct = entrypoint 为可执行文件，可作 shellPath；
   * shellCommand = entrypoint 为脚本（.cjs），须在默认 shell 里用解释器启动。
   */
  readonly launchMode: 'direct' | 'shellCommand';
}

export const CARRIERS: Readonly<Record<AgentId, CarrierDescriptor>> = {
  claude: {
    agentId: 'claude',
    cliKey: 'claude',
    display: 'Claude Code',
    invocation: '/{name}',
    launchMode: 'direct',
  },
  codex: {
    agentId: 'codex',
    cliKey: 'codex',
    display: 'Codex',
    invocation: '${name}',
    launchMode: 'direct',
  },
  gemini: {
    agentId: 'gemini',
    cliKey: 'agy',
    display: 'Antigravity',
    invocation: '/{name}',
    launchMode: 'direct',
  },
  glm: {
    agentId: 'glm',
    cliKey: 'zcode',
    display: 'ZCode',
    invocation: '/skill {name}',
    launchMode: 'shellCommand',
  },
};

export function carrierOf(agentId: string): CarrierDescriptor | undefined {
  return (AGENT_IDS as readonly string[]).includes(agentId)
    ? CARRIERS[agentId as AgentId]
    : undefined;
}

/** 代入命令名得到完整调用（如 glm+`dual-run` → `/skill dual-run`） */
export function invocationFor(agentId: AgentId, commandName: string): string {
  return CARRIERS[agentId].invocation.replace('{name}', commandName);
}

/**
 * 渲染产物（入口 SKILL.md）的查找根候选（安装位优先，仓内产品兜底）。
 *
 * 事实来源：registry.entrySkillRoot（claude: ~/.claude/skills；codex:
 * $CODEX_HOME|~/.codex/skills；gemini: ~/.gemini/config/skills；glm:
 * ~/.zcode/skills）与 layout（claude 为 top：仓内产物在 skills/，其余 entry/）。
 */
export function skillRootCandidates(agentId: AgentId, repoRoot: string | null): string[] {
  const home = process.env['HOME'] ?? '';
  const roots: string[] = [];
  switch (agentId) {
    case 'claude':
      roots.push(joinHome(home, '.claude', 'skills'));
      if (repoRoot) roots.push(joinHome(repoRoot, 'skills'));
      break;
    case 'codex': {
      const codexHome = process.env['CODEX_HOME'] ?? joinHome(home, '.codex');
      roots.push(joinHome(codexHome, 'skills'));
      if (repoRoot) roots.push(joinHome(repoRoot, 'skills', 'dual-critic', 'entry', 'codex'));
      break;
    }
    case 'gemini':
      roots.push(joinHome(home, '.gemini', 'config', 'skills'));
      if (repoRoot) roots.push(joinHome(repoRoot, 'skills', 'dual-critic', 'entry', 'gemini'));
      break;
    case 'glm':
      roots.push(joinHome(home, '.zcode', 'skills'));
      if (repoRoot) roots.push(joinHome(repoRoot, 'skills', 'dual-critic', 'entry', 'glm'));
      break;
  }
  return roots;
}

function joinHome(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

/**
 * 解析 wrapper 脚本内嵌的 node 绝对路径（zcode 等 .cjs entrypoint 的解释器，
 * AGY-02 兜底来源）。wrapper 形如：exec "/path/to/node" "/path/to/trivium.cjs" "$@"
 */
export function parseWrapperNodePath(wrapperContent: string): string | null {
  const m = /exec\s+"([^"]+)"\s+"[^"]*trivium/.exec(wrapperContent);
  return m?.[1] ?? null;
}
