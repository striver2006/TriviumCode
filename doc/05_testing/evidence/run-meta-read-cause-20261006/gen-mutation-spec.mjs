// 生成「留痕读不出的成因」（EV-04 候选 B）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/lost-cancel-unverifiable-20261006/gen-mutation-spec.mjs 的形态。
// report.ts buildRound 那条注记只在竞态下可达（enumerateRounds 先按同一判据把读不出的筛掉），没有用例，不进规格。
// 用法（在仓库根）：node doc/05_testing/evidence/run-meta-read-cause-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const META = 'src/trivium/meta.ts';
const GATE = 'src/trivium/gate.ts';
const CLI = 'src/trivium/cli.ts';
const REPORT = 'src/trivium/report.ts';
const U = 'dist/test/test/unit/unreadable-run-exit.test.js';
const R = 'dist/test/test/unit/report.test.js';
const G = 'dist/test/test/integration/gate-loop.test.js';

const cases = [
  {
    id: 'M1', desc: '文件不存在不再单列（ENOENT 并进「读不了」）', file: META,
    find: "    if (code === 'ENOENT') return { ok: false, cause: { kind: 'missing' } };\n",
    replace: '', expect: U,
  },
  {
    id: 'M2', desc: '不是合法 JSON 误报成不合契约', file: META,
    find: "    return { ok: false, cause: { kind: 'unparsable', detail",
    replace: "    return { ok: false, cause: { kind: 'contract', detail", expect: U,
  },
  {
    id: 'M3', desc: '审批复核出口不加本次判定一行', file: GATE,
    find: '        `  本次判定：${describeRunMetaCause(read.cause)}。\\n` +\n',
    replace: '', expect: U,
  },
  {
    id: 'M4', desc: 'gate --run-id 出口不加本次判定一行', file: CLI,
    find: '        `  本次判定：${describeRunMetaCause(pinnedRead.cause)}。\\n` +\n',
    replace: '', expect: G,
  },
  {
    id: 'M5', desc: 'report 未进时间线那条注记不补成因', file: REPORT,
    find: '，未列入报告（本次判定：${describeRunMetaCause(read.cause)}）`',
    replace: '，未列入报告`', expect: R,
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
