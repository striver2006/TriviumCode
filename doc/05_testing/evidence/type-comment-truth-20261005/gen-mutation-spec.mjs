// 生成「类型与注释失实收口」（EV-59）的源码变异规格（计划 r2 §5.2）。
// 照搬 evidence/codex-header-poll-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。期望套件只有一个：registry-parity。
// 两条变异都是「在落盘层补一条 Driver 互斥规则」的两种补法：M1 看 critics_selected，M2 看 critics 的键。
// 用法（在仓库根）：node doc/05_testing/evidence/type-comment-truth-20261005/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SC = 'src/trivium/schemas.ts';
const SUITE = 'dist/test/test/unit/registry-parity.test.js';

const SEL_LOOP_END =
  '        problems.push(`critics_selected 含未登记的 Agent id：${JSON.stringify(id)}`);\n' +
  '      }\n' +
  '    }\n' +
  '  }\n';
const VENDOR_CHECK = '      continue;\n    }\n    if (side?.vendor !== agent.vendor) {\n';

const cases = [
  {
    id: 'M1', desc: 'checkAgentIdentities 补「critics_selected 含 driver ⇒ 报问题」', file: SC, find: SEL_LOOP_END,
    replace: SEL_LOOP_END +
      '  if (Array.isArray(m.critics_selected) && m.critics_selected.includes(m.driver)) {\n' +
      "    problems.push('critics_selected 含当轮 Driver（变异 M1）');\n" +
      '  }\n',
    expect: SUITE,
  },
  {
    id: 'M2', desc: 'checkAgentIdentities 的 critics 循环补「键等于 driver ⇒ 报问题」', file: SC, find: VENDOR_CHECK,
    replace: '      continue;\n    }\n' +
      "    if (id === m.driver) problems.push('critics 含当轮 Driver（变异 M2）');\n" +
      '    if (side?.vendor !== agent.vendor) {\n',
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
