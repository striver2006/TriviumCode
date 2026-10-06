// 生成「运行目录同秒避让」（EV-218，候选 A）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/config-dead-keys-2-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/run-dir-collision-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const META = 'src/trivium/meta.ts';
const REVIEW = 'src/trivium/review.ts';
const UNIT = 'dist/test/test/unit/run-id-alloc.test.js';
const INTEG = 'dist/test/test/integration/run-dir-collision.test.js';
const GATE_LOOP = 'dist/test/test/integration/gate-loop.test.js';

const cases = [
  {
    id: 'M1', desc: '不排他：占用判定恒为可占（改前形态）', file: META,
    find: '    if (bucket === null) return true;\n    const dir = path.join(bucket, id);\n',
    replace: '    return true;\n    const dir = path.join(bucket, id);\n', expect: UNIT, also: [INTEG],
  },
  {
    id: 'M2', desc: 'EEXIST 一律当可占（不看测试开关）', file: META,
    find: "      if (process.env[ADOPT_PRECREATED_RUN_DIR_ENV] !== '1') return false;\n",
    replace: '', expect: UNIT,
  },
  {
    id: 'M3', desc: '测试开关失效（预建目录一律绕开）', file: META,
    find: "      if (process.env[ADOPT_PRECREATED_RUN_DIR_ENV] !== '1') return false;\n",
    replace: '      return false;\n', expect: UNIT, also: [GATE_LOOP],
  },
  {
    id: 'M4', desc: '外层不删落盘前占下的空目录', file: REVIEW,
    find: '    if (claim.dir !== null && !claim.landed) {\n',
    replace: '    if (claim.dir !== null && !claim.landed && Date.now() < 0) {\n', expect: INTEG,
  },
  {
    id: 'M5', desc: '分配点不传运行根桶（退回只看归档）', file: REVIEW,
    find: '    claimRunDirIn: path.join(runRoot(cfg), repoId(ctx.projectRoot)),\n',
    replace: '', expect: INTEG,
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
