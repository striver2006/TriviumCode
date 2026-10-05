// 生成「探针注释失实与回归格合成入口」（EV-94 ①）的变异规格。本批未走双审，规格由执笔方自定。EV-23 只改注释，无变异。
// 照搬 evidence/ps-zombie-sample-20261006/gen-mutation-spec.mjs 的形态。期望套件只有 preflight 单测。
// M1 改用例自身（退回 null 入口），M2 改产品代码（入口探测不认调用方给的入口）——两条都该让那条回归格红在「入口不是合成入口」。
// 用法（在仓库根）：node doc/05_testing/evidence/probe-doc-and-entry-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TEST = 'test/unit/preflight.test.ts';
const ZC = 'src/trivium/probes/zcode.ts';
const SUITE = 'dist/test/test/unit/preflight.test.js';

const cases = [
  {
    id: 'M1', desc: '回归格退回 null 入口（改前形态）', file: TEST,
    find: '  const { probe } = await probeZcode(entry, process.execPath, {\n',
    replace: '  const { probe } = await probeZcode(null, process.execPath, {\n', expect: SUITE,
  },
  {
    id: 'M2', desc: 'probeZcode 的入口探测不认调用方给的入口', file: ZC,
    find: '  const { entry, version } = await probeZcodeEntry(configuredEntry, node);\n',
    replace: '  const { entry, version } = await probeZcodeEntry(null, node);\n', expect: SUITE,
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
