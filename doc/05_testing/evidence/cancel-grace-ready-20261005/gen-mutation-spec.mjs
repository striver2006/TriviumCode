// 生成「cancel-grace 夹具等就绪」（EV-217）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/type-comment-truth-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 被测对象是测试夹具本身（`spawnMarked`），所以变异目标是测试文件；期望套件只有它自己，咬住的应是 R1 夹具自检。
// 用法（在仓库根）：node doc/05_testing/evidence/cancel-grace-ready-20261005/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TF = 'test/integration/cancel-grace-unverifiable.test.ts';
const SUITE = 'dist/test/test/integration/cancel-grace-unverifiable.test.js';

const WAIT = '    await within(ready, READY_TIMEOUT_MS, `夹具进程 ${mark} 报就绪（测试环境问题，不是被测行为）`);\n';
const CODE = 'const code = `${PROGRAMS[program]}; process.stdout.write(${JSON.stringify(`${READY_MARK}\\n`)})`;';

const cases = [
  {
    id: 'M1', desc: 'spawnMarked 退回固定等 150 ms（改前形态），不等就绪标记', file: TF, find: WAIT,
    replace: '    ready.catch(() => {});\n    await sleep(150);\n',
    expect: SUITE,
  },
  {
    id: 'M2', desc: '就绪标记挪到程序正文之前打（处理器还没装就报就绪）', file: TF, find: CODE,
    replace: 'const code = `process.stdout.write(${JSON.stringify(`${READY_MARK}\\n`)}); ${PROGRAMS[program]}`;',
    expect: SUITE,
  },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
  if ([...c.replace].some((ch, i) => ch.charCodeAt(0) === 36 && /[$&`'0-9<]/.test(c.replace[i + 1] ?? ''))) {
    throw new Error(`${c.id} 的 replace 含特殊替换模式`);
  }
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.error(`规格 ${cases.length} 条 → ${OUT}`);
