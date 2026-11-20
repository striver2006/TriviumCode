// 集成测试驱动：建夹具 → 起真实 extension host → 跑 suite
import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from '../out-test/test/integration/fixtureLib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, '..');

async function main() {
  const fx = await buildFixture();
  console.log(`夹具工作区：${fx.root}`);
  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      extensionDevelopmentPath: extRoot,
      extensionTestsPath: path.join(extRoot, 'out-test', 'test', 'integration', 'suite.js'),
      launchArgs: [fx.root, '--disable-extensions', '--disable-gpu'],
      extensionTestsEnv: { TRIVIUM_EXT_FIXTURE: fx.root },
    });
  } catch (e) {
    console.error('集成测试失败：', e);
    process.exitCode = 1;
  } finally {
    // 夹具目录留给排查；位于系统 tmp，系统会清理
  }
}

void main();
