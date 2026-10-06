// 生成「闸门最新留痕读不出」（EV-73）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/lost-cancel-exit-code-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/gate-latest-unreadable-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CLI = 'src/trivium/cli.ts';
const SUITE = 'dist/test/test/integration/gate-loop.test.js';

const cases = [
  {
    id: 'M1', desc: '删掉新分支：最新坏、旧可读时照旧采信旧份（改前形态）', file: CLI,
    find: '  if (latest && scan.unreadable.length > 0) {\n',
    replace: '  if (latest && scan.unreadable.length > 0 && Date.now() < 0) {\n', expect: SUITE,
  },
  {
    id: 'M2', desc: '删掉「本次判定」一行', file: CLI,
    find: "        `  本次判定：${judged.join('；')}。\\n` +\n",
    replace: '', expect: SUITE,
  },
  {
    id: 'M3', desc: '查看旧轮的出路指向读不出的那一份', file: CLI,
    find: '`  只想查看上一轮的，可用 --run-id ${latest.run_id} 钉住那一份。\\n`',
    replace: '`  只想查看上一轮的，可用 --run-id ${scan.unreadable[0]} 钉住那一份。\\n`', expect: SUITE,
  },
  {
    id: 'M4', desc: '出口段列的是可读的旧份而不是读不出的那几份', file: CLI,
    find: '        unreadableRunMetaExitAt(ref.layout, stage, scan.unreadable),\n    );\n  }\n\n  const gateDriver',
    replace: '        unreadableRunMetaExitAt(ref.layout, stage, [latest.run_id]),\n    );\n  }\n\n  const gateDriver',
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
