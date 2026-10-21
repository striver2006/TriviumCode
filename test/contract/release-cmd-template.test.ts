/**
 * Windows 快捷入口 .cmd 模板与发布包清单的对账（1.2.9）。
 *
 * 模板与清单在 `scripts/release-launchers.mjs`（与 `package-release.mjs` 同源）；本测试钉住：
 * ① 版本闸门真的闸（检查后判 errorlevel 才退出——1.2.9 前的包里 Node<18 照样往下跑安装器）；
 * ② node 不在 PATH 时给英文指引而不是系统级 9009 裸错；③ 双击启动窗口不瞬逝（条件 pause）；
 * ④ .cmd 内容纯 ASCII（OEM 代码页约束，中文信息归 Node 侧）与 CRLF 行尾；
 * ⑤ 一键安装.cmd 的后端与 zip 白名单在位。模板回潮（改回内联、删闸门、漏文件）当场红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '../helpers/fixture.js';

const { WINDOWS_LAUNCHERS, windowsLauncherBody } = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'scripts', 'release-launchers.mjs')).href
)) as {
  WINDOWS_LAUNCHERS: Record<string, string[]>;
  windowsLauncherBody: (argv: readonly string[]) => string;
};

test('T1 快捷入口清单：一键安装.cmd 指向 quick-install.mjs，三个既有入口目标不变', () => {
  assert.deepEqual(WINDOWS_LAUNCHERS, {
    '一键安装.cmd': ['scripts\\quick-install.mjs'],
    '安装.cmd': ['dist\\install.cjs'],
    '安装前检查.cmd': ['scripts\\install-check.mjs'],
    '卸载.cmd': ['dist\\install.cjs', '--uninstall'],
  });
});

test('T2 模板行为：node 存在性检测、版本闸门硬退出、参数透传、退出码透传', () => {
  const body = windowsLauncherBody(['dist\\install.cjs', '--uninstall']);
  const whereAt = body.indexOf('where node');
  const verCheckAt = body.indexOf('node -e "if (Number(process.versions.node');
  const targetAt = body.indexOf('node dist\\install.cjs --uninstall %*');
  assert.ok(whereAt >= 0 && verCheckAt > whereAt && targetAt > verCheckAt, '三段须按 存在性→版本→目标 的顺序出现');
  // 两个闸门都必须真的退出：where 失败走 goto end；版本检查失败走 goto end（1.2.9 前版本检查后不退出）
  const whereGate = body.indexOf('if errorlevel 1 (', whereAt);
  assert.ok(whereGate > whereAt && body.indexOf('goto end', whereGate) > whereGate, 'node 缺失分支必须终止');
  assert.ok(body.includes("if errorlevel 1 goto end\r\nnode dist\\install.cjs"),
    '版本检查失败必须 goto end，不得继续执行目标命令');
  assert.ok(body.trimEnd().endsWith('exit /b %EC%'), '结尾必须透传目标命令退出码');
});

test('T3 双击可用：按 cmdcmdline 判定资源管理器启动才 pause，终端运行不受影响', () => {
  const body = windowsLauncherBody(['scripts\\install-check.mjs']);
  assert.ok(body.includes('echo %cmdcmdline% | find /i "%~f0"'), '须以 cmdcmdline 匹配脚本路径判定双击');
  assert.ok(body.includes('if not errorlevel 1 pause'), '双击场景须 pause 保留窗口');
});

test('T4 码页约束：内容纯 ASCII、CRLF 行尾（OEM 代码页下中文会乱码）', () => {
  for (const [name, argv] of Object.entries(WINDOWS_LAUNCHERS)) {
    const body = windowsLauncherBody(argv);
    assert.match(body, /^[\x20-\x7E\r\n]*$/, `${name} 只能含 ASCII 可打印字符与换行`);
    assert.ok(!/(?<!\r)\n/.test(body), `${name} 行尾必须一律 CRLF`);
  }
});

test('T5 发布包接线：zip 白名单含 quick-install.mjs，模板不再内联在 package-release.mjs', () => {
  const pkgRelease = readFileSync(path.join(REPO_ROOT, 'scripts', 'package-release.mjs'), 'utf8');
  assert.ok(/'scripts\/quick-install\.mjs'/.test(pkgRelease), 'files 白名单须含 scripts/quick-install.mjs（zip 才有它）');
  assert.ok(/from '\.\/release-launchers\.mjs'/.test(pkgRelease), '模板须从 release-launchers.mjs 引入');
  assert.doesNotMatch(pkgRelease, /node -e "if \(Number\(process\.versions\.node/,
    '模板不得回潮为内联写法（内联即脱离本对账）');
});

test('T6 一键链路后端：quick-install.mjs 的五段链路与退出码口径在位', () => {
  const qi = readFileSync(path.join(REPO_ROOT, 'scripts', 'quick-install.mjs'), 'utf8');
  for (const anchor of [
    'git', '--version',            // ① Git for Windows 硬前置
    'planInstall', 'checkInstall', // ② 前检复用安装器判定
    'dist/install.cjs',            // ③ 安装子进程
    '--version',                   // ④ 版本核对
    'doctor', '--selftest',        // ⑤ 零配额自检
    'TRIVIUM_ASSET_ROOT',          // 环境变量剥离
  ]) {
    assert.ok(qi.includes(anchor), `quick-install.mjs 须含 ${anchor}`);
  }
});
