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

const repo = path.resolve(import.meta.dirname, '..');
const bundle = path.join(repo, 'dist', 'install.cjs');
if (!fs.existsSync(bundle)) {
  console.error(`✗ 找不到 ${path.relative(repo, bundle)}，先在仓库根跑一次 \`npm run build\`。`);
  process.exit(2);
}

// 安装器产物带 require.main 守卫：在这里 require 不会触发安装
const { planInstall, checkInstall, defaultInstallEnv } = createRequire(import.meta.url)(bundle);
try {
  const plan = await planInstall(repo, defaultInstallEnv());
  const problems = await checkInstall(plan.targets);
  if (problems.length === 0) {
    console.log(`✓ 无重名、无残留（已查 ${plan.targets.map((t) => t.agent).join('、')} 的安装根与额外读取面）`);
    process.exit(0);
  }
  const KIND = {
    'foreign-entry': '本产品的入口出现在不该装的位置（如被别的工具拷进共享根）',
    'third-party': '别家的同名 skill',
    residue: '旧版安装的残留',
  };
  console.log(`✗ ${problems.length} 个问题（安装会因此整次拒装）：`);
  for (const p of problems) console.log(`  · ${p.agent}  ${p.path}\n      ${KIND[p.kind] ?? p.kind}`);
  console.log('  安装器只报错、不删除这些路径：确认无用后自行挪走或删除，再跑一次本检查。');
  process.exit(1);
} catch (e) {
  console.error(`✗ 检查失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
