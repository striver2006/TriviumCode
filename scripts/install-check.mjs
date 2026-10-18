/**
 * 安装前的只读检查：`npm run install:check`。
 *
 * 只调安装器自己的 `planInstall` + `checkInstall`，**一个文件都不写**——`node dist/install.cjs` 没有 dry-run，
 * 无冲突时会直接覆盖安装。适用场景：Codex 的「从 Claude 导入」之类工具往 `~/.agents/skills`（codex、zcode
 * 共读的共享根）写进同名入口之后，先看一眼哪家、哪个路径撞名（BACKLOG EV-240）。
 *
 * 退出码：0 无问题；1 有重名或残留（逐行列出）；2 产物缺失或运行出错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// 安装检查随预构建包分发，须与运行时一样兼容 Node 18。
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(repo, 'dist', 'install.cjs');
if (!fs.existsSync(bundle)) {
  console.error(`✗ 找不到 ${path.relative(repo, bundle)}，先在仓库根跑一次 \`npm run build\`。`);
  process.exit(2);
}

// 安装器产物带 require.main 守卫：在这里 require 不会触发安装
// 三类短标签与 doctor / preflight 同一份（`src/trivium/entry-collisions.ts`，经安装器产物再导出；M12 批次 5）
const { planInstall, checkInstall, defaultInstallEnv, ENTRY_PROBLEM_LABELS: KIND } = createRequire(import.meta.url)(bundle);
// 拉了新代码却没重跑 build 时产物里没有这张表：直说「产物过旧」，不要等到有冲突时抛 TypeError、
// 被当成「检查失败」吞掉冲突清单（代码三审 GLM-01）。退出码沿用 2（产物缺失或运行出错）
if (!KIND || typeof KIND !== 'object') {
  console.error(`✗ ${path.relative(repo, bundle)} 过旧（不含三类标签表），先在仓库根跑一次 \`npm run build\`。`);
  process.exit(2);
}
try {
  const plan = await planInstall(repo, defaultInstallEnv());
  // 补传运行时根：它恰好放在共享根里时不当残留报，与真装的豁免口径一致（主题 M12-共享根残留检测）
  const problems = await checkInstall(plan.targets, plan.runtimeRoot);
  if (problems.length === 0) {
    console.log(`✓ 无重名、无残留（已查 ${plan.targets.map((t) => t.agent).join('、')} 的安装根与额外读取面）`);
    process.exit(0);
  }
  console.log(`✗ ${problems.length} 个问题（安装会因此整次拒装）：`);
  for (const p of problems) console.log(`  · ${p.agent}  ${p.path}\n      ${KIND[p.kind] ?? p.kind}`);
  console.log('  安装器只报错、不删除这些路径：确认无用后自行挪走或删除，再跑一次本检查。');
  process.exit(1);
} catch (e) {
  console.error(`✗ 检查失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
