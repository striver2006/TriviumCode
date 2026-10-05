// 生成「sh/dash 补测与 pty 模式修复」（EV-156）的变异规格。本批未走双审，规格由执笔方自定。EV-101 只补测与改文档，无变异。
// 照搬 evidence/ps-zombie-sample-20261006/gen-mutation-spec.mjs 的形态。期望套件只有新单测 pty-run。
// 用法（在仓库根）：node doc/05_testing/evidence/sh-dash-and-pty-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const EXEC = 'src/trivium/util/exec.ts';
const SUITE = 'dist/test/test/unit/pty-run.test.js';

const cases = [
  {
    id: 'M1', desc: 'pty 下 stdin 退回管道（改前形态）', file: EXEC,
    find: "    stdio: [bsdPty ? 'ignore' : 'pipe', 'pipe', 'pipe'],\n",
    replace: "    stdio: ['pipe', 'pipe', 'pipe'],\n", expect: SUITE,
  },
  {
    id: 'M2', desc: 'stdout 不经还原', file: EXEC,
    find: "    child.stdout?.on('data', ptyOut ? (c: string) => appendOut(ptyOut.push(c)) : appendOut);\n",
    replace: "    child.stdout?.on('data', appendOut);\n", expect: SUITE,
  },
  {
    id: 'M3', desc: '还原不去首部回显', file: EXEC,
    find: '      const out = head.startsWith(PTY_EOF_ECHO) ? head.slice(PTY_EOF_ECHO.length) : head;\n',
    replace: '      const out = head;\n', expect: SUITE,
  },
  {
    id: 'M4', desc: '收尾不吐扣住的余量', file: EXEC,
    find: '      if (ptyOut) appendOut(ptyOut.flush());\n',
    replace: '', expect: SUITE,
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
