/** 真机启动冒烟入口（TRIVIUM_REAL=1 才加载） */
import path from 'node:path';

export async function run(): Promise<void> {
  const Mocha = (await import('mocha')).default;
  const mocha = new Mocha({ ui: 'tdd', timeout: 120_000 });
  mocha.addFile(path.join(__dirname, 'launch.test.js'));
  await new Promise<void>((resolve, reject) => {
    mocha.run((f) => (f > 0 ? reject(new Error(`真机冒烟 ${f} 个失败`)) : resolve()));
  });
}
