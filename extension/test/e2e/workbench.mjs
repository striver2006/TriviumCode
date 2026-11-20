// 只连接本轮新建 profile 的临时 VS Code 窗口。
import assert from 'node:assert/strict';
import { resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { extensionRoot } from './workspace.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(what, check, seconds = 45) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error('超时：' + what);
}
export async function command(page, title) {
  await page.keyboard.press('F1');
  const input = page.locator('.quick-input-widget input:visible');
  await input.fill('>' + title);
  await page.locator('.quick-input-list .monaco-list-row.focused').filter({ hasText: title }).waitFor();
  await input.press('Enter');
}
export async function installVsix({ code, base, vsix }) {
  const cli = resolveCliPathFromVSCodeExecutablePath(code);
  const args = ['--user-data-dir', path.join(base, 'install-profile'), '--extensions-dir', path.join(base, 'extensions')];
  console.log(execFileSync(cli, [...args, '--install-extension', path.resolve(vsix)], { encoding: 'utf8' }));
  const installed = execFileSync(cli, [...args, '--list-extensions', '--show-versions'], { encoding: 'utf8' });
  const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
  assert.equal(installed.trim(), manifest.publisher + '.' + manifest.name + '@' + manifest.version);
  console.log(installed.trim());
}
export async function openWorkspace(fx, { base, code, vsix, children, terminalAccess = false, sendMode, readyDelayMs }) {
  const profile = path.join(base, path.basename(fx.root) + '-profile');
  const extensions = path.join(base, 'extensions');
  const profileArgs = ['--user-data-dir', profile, '--extensions-dir', extensions];
  await fs.mkdir(path.join(profile, 'User'), { recursive: true });
  await fs.writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'workbench.tips.enabled': false, 'chat.disableAIFeatures': true,
    ...(terminalAccess ? { 'editor.accessibilitySupport': 'on', 'terminal.integrated.gpuAcceleration': 'off' } : {}),
    ...(readyDelayMs !== undefined ? { 'trivium.launch.readyDelayMs': readyDelayMs } : {}),
    ...(sendMode ? { 'trivium.launch.sendMode': sendMode } : {}),
    'telemetry.telemetryLevel': 'off', 'terminal.integrated.enablePersistentSessions': false,
  }));
  const args = [...profileArgs, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-updates',
    '--disable-workspace-trust', '--locale=en', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    ...(vsix ? [] : ['--extensionDevelopmentPath=' + extensionRoot]), fx.root];
  const log = await fs.open(path.join(profile, 'launch.log'), 'w');
  const child = spawn(code, args, { stdio: ['ignore', log.fd, log.fd], detached: true });
  await log.close();
  child.unref();
  children.push(child);
  const browser = await until('连接工作台', async () => {
    if (child.exitCode !== null) throw new Error('VS Code 退出：' + child.exitCode + '，见 ' + profile + '/launch.log');
    // 重开批准窗口时 profile 中可能暂时是上次的端口。
    const port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
    if (!port) return null;
    return chromium.connectOverCDP('http://127.0.0.1:' + port).catch(() => null);
  });
  const page = await until('工作台窗口', () => browser.contexts()[0].pages().find(p => p.url().includes('workbench')));
  await page.locator('.monaco-workbench').waitFor();
  await command(page, '打开 Trivium 驾驶舱');
  const frame = await until('驾驶舱 Webview', async () => {
    for (const f of page.frames()) if (await f.locator('#driver option').count()) return f;
  });
  return { ...fx, profile, child, browser, page, frame };
}
