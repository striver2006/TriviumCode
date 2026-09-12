/**
 * 安装器：把构建产物与资产装到用户目录（设计 §5.2 / 交付物 #8）。
 *
 *   skills/*                              → ~/.claude/skills/
 *   skills/dual-critic/agents/trivium-critic.md
 *                                         → ~/.gemini/config/agents/trivium-critic/agent.md
 *
 * 装完跑一次 `node <SKILLS_TARGET>/dual-critic/scripts/trivium.cjs doctor`
 * （`trivium` 不在 PATH 上，见下方输出文案）。用户级安装一次、多项目复用（AD-13）；
 * 目标项目里只留 `.trivium/` 配置与 wrapper。
 *
 * **不改用户的日常配置**（§16.2 纪律 5）：只写自己的 skill 目录与自己的 Agent 定义，
 * 不碰 `~/.gemini/antigravity-cli/settings.json`，也不写 `~/.zcode/**` 的全局模型设置。
 *
 * 升级：目标目录里源码已不存在的文件会被**裁措**（只裁我们自己的 skill 目录）。
 * 否则被重命名/删除的 SKILL.md 会以孤儿形式残留并继续被 Claude Code 加载——
 * 旧版 SKILL.md 配新版 CLI 正是「文档写的旗标 CLI 已经不认」这类静默失败的温床。
 * 卸载：`node dist/install.cjs --uninstall`。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

export interface InstallTargets {
  /** skills 的安装目录（默认 ~/.claude/skills） */
  skillsTarget: string;
  /** 只读审查 Agent 定义的落点（默认 ~/.gemini/config/agents/trivium-critic/agent.md） */
  agentTarget: string;
}

export function defaultTargets(home: string = os.homedir()): InstallTargets {
  return {
    skillsTarget: path.join(home, '.claude/skills'),
    agentTarget: path.join(home, '.gemini/config/agents/trivium-critic/agent.md'),
  };
}

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

/** 递归同步：复制源里的全部文件，删掉目标里源已没有的文件（裁剪孤儿） */
async function syncDir(src: string, dst: string): Promise<{ copied: number; removed: string[] }> {
  let copied = 0;
  const removed: string[] = [];
  await fs.mkdir(dst, { recursive: true });
  const srcEntries = await fs.readdir(src, { withFileTypes: true });
  const keep = new Set(srcEntries.map((e) => e.name));
  for (const e of srcEntries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      const r = await syncDir(s, d);
      copied += r.copied;
      removed.push(...r.removed);
    } else {
      await fs.copyFile(s, d);
      copied++;
    }
  }
  for (const e of await fs.readdir(dst, { withFileTypes: true })) {
    if (keep.has(e.name)) continue;
    const d = path.join(dst, e.name);
    await fs.rm(d, { recursive: true, force: true });
    removed.push(d);
  }
  return { copied, removed };
}

/** 仓库里有哪些 skill 目录：安装、裁剪与卸载都只作用于这些名字 */
async function skillNames(skillsSrc: string): Promise<string[]> {
  return (await fs.readdir(skillsSrc, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export interface InstallReport {
  installed: { dir: string; files: number }[];
  removed: string[];
  agentInstalled: string | null;
}

export async function install(root: string, t: InstallTargets): Promise<InstallReport> {
  const skillsSrc = path.join(root, 'skills');
  const bundle = path.join(skillsSrc, 'dual-critic/scripts/trivium.cjs');
  if (!(await exists(bundle))) {
    throw new Error(`找不到构建产物 ${bundle}\n  请先运行 \`npm run build\`——安装器只搬运，不负责构建。`);
  }
  const report: InstallReport = { installed: [], removed: [], agentInstalled: null };
  for (const name of await skillNames(skillsSrc)) {
    const r = await syncDir(path.join(skillsSrc, name), path.join(t.skillsTarget, name));
    report.installed.push({ dir: path.join(t.skillsTarget, name), files: r.copied });
    report.removed.push(...r.removed);
  }
  const agentSrc = path.join(skillsSrc, 'dual-critic/agents/trivium-critic.md');
  if (await exists(agentSrc)) {
    await fs.mkdir(path.dirname(t.agentTarget), { recursive: true });
    await fs.copyFile(agentSrc, t.agentTarget);
    report.agentInstalled = t.agentTarget;
  }
  return report;
}

export interface UninstallReport {
  removed: string[];
  notes: string[];
}

/**
 * 卸载：只删我们装过的东西——仓库里列出的 skill 目录与只读审查 Agent 定义。
 * 各项目内的 `.trivium/` 与 `.claude/settings.json` 里的 Hook **不动**：那是项目的一部分，
 * 随仓库分发，删了会影响协作者；要清理请在项目里手工处理。
 */
export async function uninstall(root: string, t: InstallTargets): Promise<UninstallReport> {
  const skillsSrc = path.join(root, 'skills');
  const removed: string[] = [];
  const names = (await exists(skillsSrc)) ? await skillNames(skillsSrc) : [];
  for (const name of names) {
    const d = path.join(t.skillsTarget, name);
    if (await exists(d)) {
      await fs.rm(d, { recursive: true, force: true });
      removed.push(d);
    }
  }
  if (await exists(t.agentTarget)) {
    await fs.rm(t.agentTarget, { force: true });
    removed.push(t.agentTarget);
  }
  return {
    removed,
    notes: [
      '各项目内的 .trivium/（config.yaml、wrapper）与 .claude/settings.json 里的 Hook 未动：',
      '  它们随仓库分发；如需清理请在项目里删除 .trivium/ 并从 settings.json 移除 gate hook-* 条目。',
      '  settings.json 里的 Hook 命令带存在性守卫，wrapper 不在时会自动 no-op，不会报错。',
    ],
  };
}

async function main(): Promise<number> {
  const root = repoRoot();
  const targets = defaultTargets();

  if (process.argv.includes('--uninstall')) {
    console.log('TriviumCode 卸载');
    console.log('─'.repeat(60));
    const r = await uninstall(root, targets);
    for (const p of r.removed) console.log(`  - ${p}`);
    if (r.removed.length === 0) console.log('  （没有找到已安装的内容）');
    console.log('');
    for (const n of r.notes) console.log(n);
    return 0;
  }

  console.log('TriviumCode 安装');
  console.log('─'.repeat(60));
  let r: InstallReport;
  try {
    r = await install(root, targets);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 1;
  }
  let total = 0;
  for (const i of r.installed) {
    total += i.files;
    console.log(`  + ${i.dir}（${i.files} 个文件）`);
  }
  for (const p of r.removed) console.log(`  - ${p}（源里已不存在，已裁剪）`);
  if (r.agentInstalled) console.log(`  + ${r.agentInstalled}`);
  else console.error('  ⚠️ 找不到 skills/dual-critic/agents/trivium-critic.md——Antigravity 侧的只读保障会失效');

  console.log(`\n共 ${total} 个文件。`);
  // `trivium` 不进 PATH 是有意的（AD-13），所以这里一律打印可直接复制执行的完整命令。
  // wrapper 由 init 生成，故前两步只能走 skill 产物的绝对路径。
  const cliPath = path.join(targets.skillsTarget, 'dual-critic/scripts/trivium.cjs');
  console.log('下一步（`trivium` 不在 PATH 上，用下面的完整命令）：');
  console.log('  1. 实测本机能力（会消耗少量厂商配额）：');
  console.log(`       node ${cliPath} doctor`);
  console.log('  2. 在要启用双审的项目根启用：');
  console.log(`       node ${cliPath} init`);
  console.log('  3. init 之后该项目内改用 wrapper（内含 node 绝对路径——GUI 进程不读 ~/.zshrc）：');
  console.log('       ./.trivium/bin/trivium doctor');
  console.log('  4. 用 `/dual-review-plan <审查焦点>` 试跑一条。');
  console.log('  升级：重新 `npm run build && node dist/install.cjs`（会裁剪旧版残留），各项目内重跑 init 刷新 wrapper。');
  console.log('  卸载：`node dist/install.cjs --uninstall`。');
  return 0;
}

// 只在作为脚本直接执行时跑 main：ESM 测试构建会 import 本文件取 install / uninstall
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main()
    .then((c) => {
      process.exitCode = c;
    })
    .catch((e: unknown) => {
      console.error(`安装失败：${(e as Error).message}`);
      process.exitCode = 1;
    });
}
