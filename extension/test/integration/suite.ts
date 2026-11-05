/**
 * 集成测试入口（@vscode/test-electron 加载本模块；mocha 程序化运行）。
 *
 * 夹具已由 scripts/runIntegration.mjs 在启动 VS Code 前建好，路径经环境变量
 * TRIVIUM_EXT_FIXTURE 传入（workspace folder 即夹具根，二者一致）。
 */
import path from 'node:path';

export async function run(): Promise<void> {
  const Mocha = (await import('mocha')).default;
  const mocha = new Mocha({ ui: 'tdd', timeout: 60_000, color: true });
  const here = __dirname;
  // 逐个登记（排除夹具库与 e2e）
  const files = ['activate.test.js', 'health.test.js', 'prechain.test.js', 'monitor.test.js', 'terminalRelay.test.js', 'disposable.test.js', 'cockpitLifecycle.test.js'];
  for (const f of files) mocha.addFile(path.join(here, f));
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`集成测试 ${failures} 个失败`)) : resolve()));
  });
}
