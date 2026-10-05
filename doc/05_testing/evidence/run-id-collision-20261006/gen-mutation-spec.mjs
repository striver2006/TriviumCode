// 生成「run_id 同秒避让」（EV-147）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/cancel-grace-ready-20261005/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式。装置只收一个期望套件：meta.ts 的三条期望单测，两个分配点的两条期望
// 源码护栏（同在 run-id-alloc 单测里）；集成格 I1 由逐条预跑的 `also` 观察。
// 用法（在仓库根）：node doc/05_testing/evidence/run-id-collision-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const META = 'src/trivium/meta.ts';
const REVIEW = 'src/trivium/review.ts';
const CLI = 'src/trivium/cli.ts';
const UNIT = 'dist/test/test/unit/run-id-alloc.test.js';
const INTEG = 'dist/test/test/integration/run-id-collision.test.js';

const RETURN = '    if (!registered.has(id) && !(await fileTaken(id))) return id;\n';
const ALLOC = '  const runId = await allocateRunId(ref.layout);\n';

const cases = [
  {
    id: 'M1', desc: 'allocateRunId 不看占用，第一个就返回（等价改前 newRunId）', file: META, find: RETURN,
    replace: '    return id;\n', expect: UNIT, also: [INTEG],
  },
  {
    id: 'M2', desc: 'allocateRunId 不看 task.json 登记', file: META, find: RETURN,
    replace: '    if (!(await fileTaken(id))) return id;\n', expect: UNIT, also: [INTEG],
  },
  {
    id: 'M3', desc: 'allocateRunId 不看 _meta 文件', file: META, find: RETURN,
    replace: '    if (!registered.has(id)) return id;\n', expect: UNIT, also: [INTEG],
  },
  {
    id: 'M4', desc: 'prepareRun 退回直接调 newRunId', file: REVIEW, find: ALLOC,
    replace: "  const runId = (await import('./meta.js')).newRunId();\n", expect: UNIT, also: [INTEG],
  },
  {
    id: 'M5', desc: 'cmdVerify 退回直接调 newRunId', file: CLI, find: ALLOC,
    replace: "  const runId = (await import('./meta.js')).newRunId();\n", expect: UNIT,
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
