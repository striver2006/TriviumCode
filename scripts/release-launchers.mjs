/**
 * Windows 快捷入口的 .cmd 模板与清单（1.2.9）。
 *
 * 从 `package-release.mjs` 抽出成模块，供打包与 `test/contract/release-cmd-template.test.ts`
 * 同源断言——模板行为（闸门、双击可用性）改了而测试不知道，就是上一次「版本闸门失效」
 * （检查后不判 errorlevel、Node<18 照样往下跑）的复发条件。
 *
 * 硬约束：.cmd 按 OEM 代码页读取，**内容必须纯 ASCII**（文件名可以是中文）；给用户看的
 * 中文信息一律由 Node 侧输出（TTY 直写 Unicode，无码页问题）。行尾一律 CRLF。
 *
 * 模板行为（相对 1.2.8 前的三处修复）：
 * - `where node` 先行：node 不在 PATH 时给英文指引并退出（原先报两次系统级 9009 裸错）；
 * - 版本检查后 `if errorlevel 1` 硬闸：Node < 18 不再继续执行目标命令（原先闸门失效）；
 * - 结尾按 `%cmdcmdline%` 判断「由资源管理器双击启动」才 `pause`：双击不再窗口瞬逝，
 *   终端调用无多余按键；退出码透传目标命令。
 */

/** Windows 快捷入口清单：文件名 → 目标命令的 argv（`node <argv...> %*`） */
export const WINDOWS_LAUNCHERS = {
  '一键安装.cmd': ['scripts\\quick-install.mjs'],
  '安装.cmd': ['dist\\install.cjs'],
  '安装前检查.cmd': ['scripts\\install-check.mjs'],
  '卸载.cmd': ['dist\\install.cjs', '--uninstall'],
};

/**
 * 生成一个快捷入口的 .cmd 全文。`argv` 是目标命令（不含开头的 node）。
 * 终端里直接运行与双击运行都成立；参数经 `%*` 原样透传。
 */
export function windowsLauncherBody(argv) {
  const target = argv.join(' ');
  return [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js 18 or above is required, but "node" was not found on PATH.',
    '  echo Install it from https://nodejs.org/ and reopen the terminal, then run this again.',
    '  goto end',
    ')',
    'node -e "if (Number(process.versions.node.split(\'.\')[0]) < 18) { console.error(\'Node.js 18 or above is required.\'); process.exit(1); }"',
    'if errorlevel 1 goto end',
    `node ${target} %*`,
    'set EC=%errorlevel%',
    'goto finish',
    ':end',
    'set EC=1',
    ':finish',
    'rem keep the window open when launched by double-click; no effect in a terminal',
    'echo %cmdcmdline% | find /i "%~f0" >nul 2>nul',
    'if not errorlevel 1 pause',
    'exit /b %EC%',
    '',
  ].join('\r\n');
}
