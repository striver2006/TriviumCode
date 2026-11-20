// 真机启动冒烟（可选跑，D8′ 预算门控 TRIVIUM_REAL=1）：四家真实 CLI 仅验证
// 「直启/解释器启动 + 存活」，不做注入断言（终端输出无稳定 API 可读；注入
// 通道保真由 fakeTUI 字节级自动化覆盖）。每载体会话启动 1 次，零模型调用。
import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from '../out-test/test/integration/fixtureLib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, '..');

async function main() {
  if (process.env['TRIVIUM_REAL'] !== '1') {
    console.log('TRIVIUM_REAL 未设为 1：跳过真机启动冒烟。');
    return;
  }
  const fx = await buildFixture();
  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      extensionDevelopmentPath: extRoot,
      extensionTestsPath: path.join(extRoot, 'out-test', 'test', 'real', 'suite.js'),
      launchArgs: [fx.root, '--disable-extensions', '--disable-gpu'],
      extensionTestsEnv: { TRIVIUM_EXT_FIXTURE: fx.root },
    });
  } catch (e) {
    console.error('真机冒烟失败：', e);
    process.exitCode = 1;
  }
}

void main();
