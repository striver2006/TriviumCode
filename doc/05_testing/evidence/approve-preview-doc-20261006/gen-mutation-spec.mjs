// 生成「批前再看改动」（EV-140）的逐条预跑规格。本批未走双审，规格由执笔方自定。
// 目标是 skills-src 的 .md：变异装置闸 4 只认 dist/test 产物，进不了装置，只做逐条预跑（mutation-names.mjs）。
// entry-render-parity 测试时现读 skills-src/ 渲染、与已提交的产物比对，源里删掉新段即红。
// 用法（在仓库根）：node doc/05_testing/evidence/approve-preview-doc-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SRC = 'skills-src/commands/approve.contract.md';
const SUITE = 'dist/test/test/contract/entry-render-parity.test.js';
const text = read(SRC);
const start = text.indexOf('**批之前想再看一眼改动**');
const end = text.indexOf('明确要求审批时再运行上面的 `approve`。\n') + '明确要求审批时再运行上面的 `approve`。\n'.length;
if (start < 0 || end < start) throw new Error('新段锚点没找到');
const PARA = '\n' + text.slice(start, end);

const cases = [
  { id: 'M1', desc: '删掉 skill 源里新加的整段', file: SRC, find: PARA, replace: '', expect: SUITE },
  {
    id: 'M2', desc: '只删那条 --await-approval 命令', file: SRC,
    find: '.trivium/bin/trivium gate --stage <阶段> --topic <主题> --await-approval\n',
    replace: '\n', expect: SUITE,
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
