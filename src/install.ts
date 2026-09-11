/**
 * 安装器：把构建产物与资产装到用户目录（设计 §5.2 / 交付物 #8）。
 *
 *   skills/*                              → ~/.claude/skills/
 *   skills/dual-critic/agents/trivium-critic.md
 *                                         → ~/.gemini/config/agents/trivium-critic/agent.md
 *
 * 装完跑一次 `trivium doctor`。用户级安装一次、多项目复用（AD-13）；
 * 目标项目里只留 `.trivium/` 配置与 wrapper。
 *
 * **不改用户的日常配置**（§16.2 纪律 5）：只写自己的 skill 目录与自己的 Agent 定义，
 * 不碰 `~/.gemini/antigravity-cli/settings.json`，也不写 `~/.zcode/**` 的全局模型设置。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const HOME = os.homedir();
const SKILLS_TARGET = path.join(HOME, '.claude/skills');
const AGENT_TARGET = path.join(HOME, '.gemini/config/agents/trivium-critic/agent.md');

/**
 * 仓库根：本文件编译为 dist/install.cjs，故上溯一级。
 *
 * 不用 `import.meta.url` 兜底：产物是 CJS bundle，esbuild 会把 `import.meta` 置空
 * 并在**每次构建**都警告一次——一个恒不生效的分支换来一条长期警告，不值得。
 * `__filename` 在 CJS 里必然存在；退路用 argv[1]，只为 ESM 测试构建下不至于抛错。
 */
function repoRoot(): string {
  const self = typeof __filename === 'string' ? __filename : (process.argv[1] ?? process.cwd());
  return path.resolve(path.dirname(self), '..');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dst: string): Promise<number> {
  let count = 0;
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) count += await copyDir(s, d);
    else {
      await fs.copyFile(s, d);
      count++;
    }
  }
  return count;
}

async function main(): Promise<number> {
  const root = repoRoot();
  const skillsSrc = path.join(root, 'skills');
  const bundle = path.join(skillsSrc, 'dual-critic/scripts/trivium.cjs');

  if (!(await exists(bundle))) {
    console.error(
      `✗ 找不到构建产物 ${bundle}\n` +
        `  请先运行 \`npm run build\`——安装器只搬运，不负责构建。`,
    );
    return 1;
  }

  console.log('TriviumCode 安装');
  console.log('─'.repeat(60));

  // ── skills → ~/.claude/skills/ ──
  let total = 0;
  for (const e of await fs.readdir(skillsSrc, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const n = await copyDir(path.join(skillsSrc, e.name), path.join(SKILLS_TARGET, e.name));
    total += n;
    console.log(`  + ${path.join(SKILLS_TARGET, e.name)}（${n} 个文件）`);
  }

  // ── 只读审查 Agent → ~/.gemini/config/agents/ ──
  const agentSrc = path.join(skillsSrc, 'dual-critic/agents/trivium-critic.md');
  if (await exists(agentSrc)) {
    await fs.mkdir(path.dirname(AGENT_TARGET), { recursive: true });
    await fs.copyFile(agentSrc, AGENT_TARGET);
    console.log(`  + ${AGENT_TARGET}`);
  } else {
    console.error(`  ⚠️ 找不到 ${agentSrc}——Antigravity 侧的只读保障会失效`);
  }

  console.log(`\n共 ${total} 个文件。`);
  console.log('下一步：');
  console.log('  1. 在任意项目里运行 `trivium doctor` 实测本机能力（会消耗少量厂商配额）；');
  console.log('  2. 在要启用双审的项目根运行 `trivium init`；');
  console.log('  3. 用 `/dual-review-plan <提示语>` 试跑一条。');
  console.log('');
  console.log('注意：`trivium` 命令本身不在 PATH 上。项目内一律用 `.trivium/bin/trivium`');
  console.log('（由 init 生成，内含 node 绝对路径——GUI 进程不读 ~/.zshrc）。');
  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((e: unknown) => {
    console.error(`安装失败：${(e as Error).message}`);
    process.exitCode = 1;
  });
