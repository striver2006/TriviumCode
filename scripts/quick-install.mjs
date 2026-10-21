/**
 * Windows 一键安装链路（1.2.9，`一键安装.cmd` 的后端）：环境检测 → 安装前检查 → 安装 →
 * 版本核对 → doctor --selftest（14 步零配额自检）。
 *
 * 只编排既有入口，不引入第二套判定：前检复用安装器自己的 `planInstall` + `checkInstall`
 * （与 scripts/install-check.mjs 同源，只读不写）；安装以子进程跑 `dist/install.cjs`，
 * 与手动执行 安装.cmd 逐字同一命令、参数透传；自检走运行时根的 `doctor --selftest`
 * （桩适配器，不调真实厂商、不耗配额）。
 *
 * 退出码：0 全链路通过；1 环境前置缺失（Node / Git for Windows）或安装前检查有冲突；
 * 2 安装器失败或装后版本核对不符；3 零配额自检未全过。失败即停在对应输出上，不自动卸载。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (s) => console.log(s);

// ── ① 环境前置：Node 版本（直接跑本脚本时 .cmd 闸门不在场，这里自守）、Git for Windows（硬前置） ──
if (Number(process.versions.node.split('.')[0]) < 18) {
  say('✗ 需要 Node.js 18 或以上，当前 ' + process.version + '。请从 https://nodejs.org/ 升级后重跑。');
  process.exit(1);
}
const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
if (git.error || git.status !== 0) {
  say('✗ 检测不到 git：TriviumCode 在 Windows 上的硬前置是 Git for Windows（sh、Hook 守卫与 verify 都依赖它）。');
  say('  请从 https://git-scm.com/download/win 安装（安装器里勾选加入 PATH），装完重开终端再运行 一键安装.cmd。');
  process.exit(1);
}
say('✓ 环境前置：' + git.stdout.trim());
if (process.env.TRIVIUM_ASSET_ROOT) {
  say('⚠️ 检测到 TRIVIUM_ASSET_ROOT=' + process.env.TRIVIUM_ASSET_ROOT +
    '：安装链路会给安装器子进程剥离该变量（与部署手册 §2.1 同口径），避免运行时根与仓库重叠时被拒装或误同步。');
}

// ── ② 安装前检查（复用安装器判定，只读不写；冲突即中止，不代删——纪律不变） ──
const bundle = path.join(repo, 'dist', 'install.cjs');
if (!fs.existsSync(bundle)) {
  say('✗ 找不到 dist/install.cjs：安装包不完整，请重新解压或校验（文件校验.json）。');
  process.exit(2);
}
const { planInstall, checkInstall, defaultInstallEnv, ENTRY_PROBLEM_LABELS: KIND } =
  createRequire(import.meta.url)(bundle);
let plan;
try {
  plan = await planInstall(repo, defaultInstallEnv());
  const problems = await checkInstall(plan.targets, plan.runtimeRoot);
  if (problems.length > 0) {
    say('✗ 安装前检查发现 ' + problems.length + ' 个问题（安装会因此整次拒装）：');
    for (const p of problems) say('  · ' + p.agent + '  ' + p.path + '\n      ' + (KIND?.[p.kind] ?? p.kind));
    say('  安装器只报错、不删除这些路径：确认无用后自行挪走或删除，再运行 一键安装.cmd。');
    process.exit(1);
  }
  say('✓ 安装前检查通过（已查 ' + plan.targets.map((t) => t.agent).join('、') + ' 的安装根与额外读取面）');
} catch (e) {
  say('✗ 安装前检查失败：' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

// ── ③ 执行安装（与 安装.cmd 同一命令；子进程内剥离 TRIVIUM_ASSET_ROOT） ──
const childEnv = { ...process.env };
delete childEnv.TRIVIUM_ASSET_ROOT;
say('· 执行安装（node dist/install.cjs' + (process.argv.length > 2 ? ' ' + process.argv.slice(2).join(' ') : '') + '）…');
const installed = spawnSync(process.execPath, [bundle, ...process.argv.slice(2)], { stdio: 'inherit', env: childEnv });
if (installed.status !== 0) {
  say('✗ 安装器未成功（退出码 ' + installed.status + '，详见上方输出）。可运行 安装前检查.cmd 单独排查读取面问题。');
  process.exit(2);
}

// ── ④ 装后核对：运行时根的 CLI 版本与包版本一致 ──
const cli = path.join(plan.runtimeRoot, 'scripts', 'trivium.cjs');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const ver = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', windowsHide: true });
if (ver.status !== 0 || ver.stdout.trim() !== pkg.version) {
  say('✗ 装后版本核对不符：运行时根报 "' + ver.stdout.trim() + '"，安装包为 ' + pkg.version + '。');
  say('  运行时根：' + plan.runtimeRoot);
  process.exit(2);
}
say('✓ 已安装并核对版本：' + pkg.version + '（运行时根 ' + plan.runtimeRoot + '）');

// ── ⑤ 零配额自检：doctor --selftest，14 步，桩适配器，不调真实厂商 ──
say('· 零配额自检（doctor --selftest，用桩跑整条流水线，约需一两分钟）…');
const st = spawnSync(process.execPath, [cli, 'doctor', '--selftest'], { stdio: 'inherit' });
if (st.status !== 0) {
  say('✗ 自检未全过（详见上方 14 步结果）。安装本身已完成，可稍后单独重跑：');
  say('  node "' + cli + '" doctor --selftest');
  process.exit(3);
}
say('✓ 一键安装完成：环境前置 → 安装前检查 → 安装 → 版本核对 → 14 步自检全部通过。');
say('  下一步：在自己的 Git 项目根目录运行 trivium init（详见 doc/06_deployment/稳定版部署手册.md §3）。');
process.exit(0);
