/**
 * 生成可搬到其他主机的预构建安装包；只从白名单复制，不打包账号、探针、运行记录和审查原件。
 * 先 npm run build；正式包要求干净的 Git 工作树，--candidate 明确标成候选包。
 *
 * 1.1.0 起按构建主机平台出包（设计 §7.1/§8）：macOS 出 tar.gz + `.command` 快捷入口，
 * Windows 出 zip + `.cmd` 快捷入口；Linux 仍拒绝。跨平台打包不做（包内 launcher 与文档文案随平台）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { WINDOWS_LAUNCHERS, windowsLauncherBody } from './release-launchers.mjs';

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let candidate = false;
let out = path.join(root, 'dist/releases');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--candidate') candidate = true;
  else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) out = path.resolve(args[++i]);
  else throw new Error('用法：node scripts/package-release.mjs [--candidate] [--out <目录>]');
}
const PLATFORM = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : null;
if (PLATFORM === null) throw new Error('本脚本仅发布 macOS 与 Windows 安装包；Linux/WSL 尚未验收。');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('正式产品版本须为 x.y.z。');
const git = async (...argv) => (await execFile('git', ['-c', 'core.quotePath=false', ...argv], { cwd: root, windowsHide: true })).stdout.trim();
const head = await git('rev-parse', 'HEAD');
const dirty = (await git('status', '--porcelain=v1', '--untracked-files=all')) !== '';
if (dirty && !candidate) throw new Error('工作树未提交，不能生成正式包。先完成提交；预览可显式加 --candidate。');
const cli = 'skills/dual-critic/scripts/trivium.cjs';
const version = (await execFile(process.execPath, [path.join(root, cli), '--version'], { windowsHide: true })).stdout.trim();
if (version !== pkg.version) throw new Error(`CLI ${version} 与 package.json ${pkg.version} 不一致，请重新构建。`);
// 安装器执行时还读取 carriers；只拷两个 CJS 文件会导致异机安装失败。
// quick-install.mjs 是 一键安装.cmd 的链路后端（1.2.9）：环境检测 → 前检 → 安装 → 版本核对 → 零配额自检。
const files = ['README.md', 'LICENSE', 'package.json', 'dist/install.cjs', 'scripts/install-check.mjs', 'scripts/quick-install.mjs'];
async function walk(dir) {
  const result = [];
  for (const e of (await fs.readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) result.push(...await walk(rel));
    else if (e.isFile()) result.push(rel);
    else throw new Error(`分发源中不应出现软链或特殊文件：${rel}`);
  }
  return result;
}
files.push(...await walk('skills'), ...await walk('skills-src/carriers'));
files.push('doc/README.md');
for (const e of await fs.readdir(path.join(root, 'doc'), { withFileTypes: true })) {
  if (!e.isDirectory() || !/^\d\d_/.test(e.name)) continue;
  for (const d of await fs.readdir(path.join(root, 'doc', e.name), { withFileTypes: true })) {
    if (d.isFile() && d.name.endsWith('.md')) files.push(`doc/${e.name}/${d.name}`);
  }
}
// 拒绝旧 bundle：构建时嵌入的作用面指纹须与本次源树一致。
// 用与构建同一份实现计算，避免另写一套哈希算法。
const { build } = await import('esbuild');
await fs.mkdir(out, { recursive: true });
const scratch = await fs.mkdtemp(path.join(out, '.package-'));
const name = `TriviumCode-${pkg.version}-${PLATFORM === 'windows' ? 'windows-x64' : 'macos'}${candidate ? '-candidate' : ''}`;
const dest = path.join(out, name);
const archive = PLATFORM === 'windows' ? `${dest}.zip` : `${dest}.tar.gz`;
for (const p of [dest, archive, `${archive}.sha256`]) {
  try { await fs.lstat(p); throw new Error(`不覆盖已有发布物：${p}`); }
  catch (e) { if (e.code !== 'ENOENT') { await fs.rm(scratch, { recursive: true, force: true }); throw e; } }
}
const staged = path.join(scratch, name);
try {
  const helper = path.join(scratch, 'build-stamp.cjs');
  await build({ entryPoints: [path.join(root, 'src/trivium/build-stamp.ts')], outfile: helper,
    bundle: true, format: 'cjs', platform: 'node', target: 'node18', charset: 'utf8', logLevel: 'silent' });
  const { computeBuildStamp } = (await import('node:module')).createRequire(import.meta.url)(helper);
  const stamp = await computeBuildStamp(root);
  const bundleText = await fs.readFile(path.join(root, cli), 'utf8');
  if (!stamp || !bundleText.includes(stamp.inputs_sha256)) throw new Error('编排器构建指纹过期或缺失，请重新 npm run build。');
  await fs.mkdir(staged);
  for (const rel of [...new Set(files)].sort()) {
    const target = path.join(staged, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, rel), target);
  }
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const licenses = [];
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || entry.dev) continue;
    let license = null;
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
      try { license = await fs.readFile(path.join(root, location, file), 'utf8'); break; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (license === null) throw new Error(`缺少生产依赖许可：${location}`);
    licenses.push(`${location} ${entry.version}\n${license}`);
  }
  await fs.writeFile(path.join(staged, '第三方许可.txt'), licenses.join('\n\n' + '='.repeat(60) + '\n\n'));
  if (PLATFORM === 'windows') {
    // Windows 快捷入口：模板与清单在 release-launchers.mjs（与契约测试同源）。
    // .cmd 内容必须纯 ASCII（OEM 代码页）；中文说明在 开始使用.md 与 quick-install.mjs 的 Node 侧输出。
    for (const [file, argv] of Object.entries(WINDOWS_LAUNCHERS)) {
      await fs.writeFile(path.join(staged, file), windowsLauncherBody(argv), { mode: 0o755 });
    }
  } else {
    const launchers = { '安装.command': ['dist/install.cjs'], '安装前检查.command': ['scripts/install-check.mjs'],
      '卸载.command': ['dist/install.cjs', '--uninstall'] };
    for (const [file, argv] of Object.entries(launchers)) {
      await fs.writeFile(path.join(staged, file), `#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nif [ "$(uname -s)" != Darwin ]; then\n  echo '本包只支持 macOS；Windows 请使用对应的 windows-x64 安装包。' >&2\n  exit 1\nfi\nnode -e 'if (Number(process.versions.node.split(".")[0]) < 18) { console.error("需要 Node.js 18 或以上"); process.exit(1); }'\nnode ${argv.join(' ')} "$@"\n`, { mode: 0o755 });
    }
  }
  const platformBrief = PLATFORM === 'windows'
    ? 'Windows 安装包（需 Git for Windows；详见 doc/06_deployment/部署手册.md 的 Windows 章节）。'
    : 'macOS 稳定版安装包。';
  await fs.writeFile(path.join(staged, '开始使用.md'), `# TriviumCode ${pkg.version}\n\n${candidate ? '候选安装包，尚未作为正式版本交付。' : platformBrief}\n\n先安装 Node.js 18 或以上、Git 2.20 或以上（Windows 为 Git for Windows），以及需要的 Agent CLI 并登录。目标机无需 npm install，也无需编译。\n\n${PLATFORM === 'windows' ? '**推荐：在 cmd / PowerShell / Git Bash 进入本目录，运行 一键安装.cmd**（双击也可）。它会依次完成：Git 前置检测 → 安装前检查 → 安装 → 版本核对 → 零配额自检（doctor --selftest，14 步，桩适配器、不调真实厂商）。任一步失败都会停在对应输出上。\n\n也可在 Git Bash 里分步执行（PowerShell / cmd 的写法见 doc/06_deployment/部署手册.md §1b）：' : '在终端进入本目录：'}\n\n\`\`\`sh\nnode scripts/install-check.mjs\nnode dist/install.cjs\nnode ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor --selftest\n\`\`\`\n\n${PLATFORM === 'windows' ? '分步入口：安装前检查.cmd、安装.cmd、卸载.cmd。' : '也可运行本目录的安装前检查.command、安装.command。'}检查脚本只查读取面重名与残留，安装器另查运行时身份与源目录重叠。\n\n详细步骤见 doc/06_deployment/部署手册.md；日常操作见 doc/07_manuals/使用手册.md；限制见 doc/08_project/现存Bug与未完成工作清单.md。\n\n文件校验.json 列出除自身外全部文件的 SHA-256。源码与历史测试原始证据不在此安装包内，代码路径和 evidence 链接请到源码仓库查阅。包不含 Node、Git、厂商程序、登录信息和任何本机配置。\n`);
  await fs.writeFile(path.join(staged, '发布信息.json'), JSON.stringify({ product: pkg.name, version: pkg.version,
    release_state: candidate ? 'candidate' : 'stable', source_commit: head, source_dirty: dirty,
    source_snapshot: { repo_root_commit: stamp.repo_root_commit, git_head: stamp.git_head, dirty: stamp.dirty,
      inputs_sha256: stamp.inputs_sha256, computed_at: stamp.built_at },
    cli_sha256: createHash('sha256').update(bundleText).digest('hex'),
    platform: PLATFORM, native_windows_supported: true,
    runtime: 'Node.js >=18, Git >=2.20 (Windows: Git for Windows); external Agent CLIs required', created_at: new Date().toISOString() }, null, 2) + '\n');
  async function manifest(dir, prefix = '') {
    const entries = [];
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(prefix, e.name), full = path.join(dir, e.name);
      if (e.isDirectory()) entries.push(...await manifest(full, rel));
      else entries.push({ path: rel, sha256: createHash('sha256').update(await fs.readFile(full)).digest('hex') });
    }
    return entries;
  }
  await fs.writeFile(path.join(staged, '文件校验.json'), JSON.stringify(await manifest(staged), null, 2) + '\n');
  if (PLATFORM === 'windows') {
    // Windows 10+ 自带 bsdtar（System32\tar.exe），按扩展名出 zip（-a）；不可用时退 PowerShell Compress-Archive
    try {
      await execFile('tar.exe', ['--force-local', '-a', '-cf', path.join(scratch, `${name}.zip`), '-C', scratch, name], { windowsHide: true });
    } catch {
      await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path ${JSON.stringify(path.join(scratch, name))} -DestinationPath ${JSON.stringify(path.join(scratch, `${name}.zip`))} -Force`],
        { windowsHide: true });
    }
  } else {
    await execFile('/usr/bin/tar', ['-czf', path.join(scratch, `${name}.tar.gz`), '-C', scratch, name],
      { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  }
  const packedArchive = PLATFORM === 'windows' ? path.join(scratch, `${name}.zip`) : path.join(scratch, `${name}.tar.gz`);
  const sum = createHash('sha256').update(await fs.readFile(packedArchive)).digest('hex');
  // 打包期间若有修改，不能把变化混入发布；构建输入还需与构建前一致。
  if ((await git('rev-parse', 'HEAD')) !== head || (!candidate && await git('status', '--porcelain=v1', '--untracked-files=all')) ||
      (await computeBuildStamp(root))?.inputs_sha256 !== stamp.inputs_sha256) throw new Error('打包期间源树变化，请在工作树稳定后重试。');
  await fs.rename(staged, dest);
  await fs.rename(packedArchive, archive);
  await fs.writeFile(`${archive}.sha256`, `${sum}  ${path.basename(archive)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ directory: dest, archive, sha256: sum, candidate, version: pkg.version }, null, 2));
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
