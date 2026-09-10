/**
 * 安装器（设计 §5.2 / 交付物 #8）。
 *
 * 把构建产物与资产装到用户目录：
 *   skills/*                    → ~/.claude/skills/
 *   agents/trivium-critic.md    → ~/.gemini/config/agents/trivium-critic/agent.md
 * 然后运行一次 doctor。
 *
 * M1 阶段先占位，M2 随 skills 一起实现。
 */
console.error('install: 尚未实现（M2 交付）。当前可用：node skills/dual-critic/scripts/trivium.cjs doctor');
process.exitCode = 1;
