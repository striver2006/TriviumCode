// 生成「复盘面失守旗标分档」（EV-224）的源码变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/breach-unconfirmed-release-20261006/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件。
// 用法（在仓库根）：node doc/05_testing/evidence/breach-flag-split-20261007/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GATE = 'src/trivium/gate.ts';
const REPORT = 'src/trivium/report.ts';
const META = 'src/trivium/meta.ts';
const S = {
  gate: 'dist/test/test/unit/gate.test.js',
  report: 'dist/test/test/unit/report.test.js',
};

function blockOf(file, needle, n = 1) {
  const src = read(file);
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`${file} 里没有「${needle}」`);
  const block = lines.slice(idx, idx + n).join('\n') + '\n';
  const hits = src.split(block).length - 1;
  if (hits !== 1) throw new Error(`${file} 里从「${needle}」起 ${n} 行的锚点命中 ${hits} 处（应为 1）`);
  return block;
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const R_FLAG = blockOf(REPORT, 'base.guardFlags.push(readonlyBreachLabel(meta.snapshot.drift));');
const M_LINE = blockOf(META, 'lines.push(`  ⚠️ ${readonlyBreachLabel(meta.snapshot.drift)}`);');
const G_SWITCH = blockOf(GATE, '  switch (classifyReadonlyBreach(drift)) {');

const cases = [
  {
    id: 'N1', desc: 'report 旗标退回不分档的「只读失守」', file: REPORT,
    find: R_FLAG, replace: sub(R_FLAG, 'readonlyBreachLabel(meta.snapshot.drift)', "'只读失守'"), expect: S.report,
  },
  {
    id: 'N2', desc: 'summarizeRun 退回不分档的「只读失守」', file: META,
    find: M_LINE, replace: sub(M_LINE, '`  ⚠️ ${readonlyBreachLabel(meta.snapshot.drift)}`', "'  ⚠️ 只读失守'"), expect: S.gate,
  },
  {
    id: 'N3', desc: '标签不看判据：一律按确证说', file: GATE,
    find: G_SWITCH, replace: sub(G_SWITCH, 'classifyReadonlyBreach(drift)', "('confirmed' as ReadonlyBreachClass)"), expect: S.report,
  },
];

for (const c of cases) {
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的替换串含特殊替换模式`);
  if (c.find === c.replace) throw new Error(`${c.id} 替换前后相同`);
}
fs.writeFileSync(OUT, JSON.stringify({ targets: [GATE, REPORT, META], suites: [S.gate, S.report], cases }, null, 2) + '\n', 'utf8');
console.log(`写出 ${cases.length} 条变异到 ${OUT}`);
