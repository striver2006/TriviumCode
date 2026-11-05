/**
 * e2e 慢测入口（TRIVIUM_E2E=1 才会加载；runE2E.mjs 已把桩 wrapper 换成真实
 * trivium.cjs，并注入 TRIVIUM_STUB_CRITIC 的 JSON 桩配置）。
 */
import path from 'node:path';

export async function run(): Promise<void> {
  const Mocha = (await import('mocha')).default;
  const mocha = new Mocha({ ui: 'tdd', timeout: 300_000, color: true });
  mocha.addFile(path.join(__dirname, 'fullflow.test.js'));
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`e2e 测试 ${failures} 个失败`)) : resolve()));
  });
}
