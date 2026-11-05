// e2e 慢测驱动（可选跑，D7′）：真实 trivium.cjs + JSON 桩配置，零厂商配额。
// 需 TRIVIUM_E2E=1 显式开启：npm run e2e 会因缺该变量直接跳过。
import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { buildFixture } from '../out-test/test/integration/fixtureLib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(here, '..');

async function main() {
  if (process.env['TRIVIUM_E2E'] !== '1') {
    console.log('TRIVIUM_E2E 未设为 1：跳过 e2e 慢测（真实编排器 + 桩审核者）。');
    return;
  }
  const fx = await buildFixture();
  // 用真实编排器替换桩 wrapper（e2e 前提：本仓已构建 skills/dual-critic/scripts/trivium.cjs）
  const repoRoot = path.resolve(extRoot, '..');
  const realCli = path.join(repoRoot, 'skills', 'dual-critic', 'scripts', 'trivium.cjs');
  const nodeBin = process.execPath;
  await fs.writeFile(
    path.join(fx.root, '.trivium', 'bin', 'trivium'),
    `#!/bin/sh\nexec "${nodeBin}" "${realCli}" "$@"\n`,
    { mode: 0o755 },
  );
  console.log(`e2e 夹具：${fx.root}（真实 CLI：${realCli}）`);
  try {
    await runTests({
      extensionDevelopmentPath: extRoot,
      extensionTestsPath: path.join(extRoot, 'out-test', 'test', 'e2e', 'suite.js'),
      launchArgs: [fx.root, '--disable-extensions', '--disable-gpu'],
      extensionTestsEnv: {
        TRIVIUM_EXT_FIXTURE: fx.root,
        TRIVIUM_STUB_CRITIC: JSON.stringify({
          // 按审核者的桩配置（CODEX-08：必须是对象，覆盖入选集合）
          claude: { cli_version: 'stub/0.0.0' },
          gemini: { cli_version: 'stub/0.0.0' },
          codex: { cli_version: 'stub/0.0.0' },
        }),
      },
    });
  } catch (e) {
    console.error('e2e 失败：', e);
    process.exitCode = 1;
  }
}

void main();
