// 生成「失联取消两格退69」（EV-177 ② 补）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/lost-cancel-exit-code-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/lost-cancel-identity-exit-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const RP = 'src/trivium/run-protocol.ts';
const SUITE = 'dist/test/test/integration/run-protocol.test.js';

const cases = [
  {
    id: 'M1', desc: 'mismatch 格退回 0（改前形态）', file: RP,
    find: '      // 69 与 alive 格未确认退出、主路径判不了身份同码：这次没做收尾、状态原样、可重试（EV-177 ② 补，用户 2026-10-06 定）\n      return EXIT.ENV;\n',
    replace: '      return EXIT.OK;\n', expect: SUITE,
  },
  {
    id: 'M2', desc: 'no_identity 格退回 0（改前形态）', file: RP,
    find: '      // 同上一格：69（EV-177 ② 补）\n      return EXIT.ENV;\n',
    replace: '      return EXIT.OK;\n', expect: SUITE,
  },
  {
    id: 'M3', desc: 'none 格（无需取消）也退 69（范围扩大）', file: RP,
    find: "    say('  已完成的运行不会被追溯改写——归档里的事实就是当时发生的事实。');\n    return EXIT.OK;\n",
    replace: "    say('  已完成的运行不会被追溯改写——归档里的事实就是当时发生的事实。');\n    return EXIT.ENV;\n",
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
