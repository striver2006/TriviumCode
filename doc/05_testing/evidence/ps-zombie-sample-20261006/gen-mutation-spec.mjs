// 生成「僵尸排除的录制样本单测」（EV-169）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/run-id-collision-20261006/gen-mutation-spec.mjs 的形态：find 逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式。期望套件只有新单测 ps-group-members。
// 用法（在仓库根）：node doc/05_testing/evidence/ps-zombie-sample-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const EXEC = 'src/trivium/util/exec.ts';
const SUITE = 'dist/test/test/unit/ps-group-members.test.js';
const COND = "    if (m && Number(m[1]) === pgid && !m[2]!.startsWith('Z')) n++;\n";
const CALL = '  return countLiveGroupMembers(r.stdout, pgid);\n';

const cases = [
  {
    id: 'M1', desc: '不排除僵尸（删掉 stat 判据）', file: EXEC, find: COND,
    replace: '    if (m && Number(m[1]) === pgid) n++;\n', expect: SUITE,
  },
  {
    id: 'M2', desc: '组号按字符串前缀匹配', file: EXEC, find: COND,
    replace: "    if (m && m[1]!.startsWith(String(pgid).slice(0, -1)) && !m[2]!.startsWith('Z')) n++;\n", expect: SUITE,
  },
  {
    id: 'M3', desc: 'processGroupMemberCount 不经计数函数、数全部行（取数侧绕开僵尸排除）', file: EXEC, find: CALL,
    replace: "  return r.stdout.split('\\n').filter((l) => Number(/^\\s*(\\d+)\\s/.exec(l)?.[1]) === pgid).length;\n", expect: SUITE,
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
