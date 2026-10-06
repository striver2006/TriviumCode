// 生成「建议命令主题名转义」（EV-195）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/lost-cancel-identity-exit-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/topic-arg-quoting-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const NAMING = 'src/trivium/naming.ts';
const SUITE = 'dist/test/test/unit/topic-arg-quoting.test.js';
// 源码原文（反斜杠在 JS 字符串里各写成两个）
const GUARD = '  if (SHELL_SAFE_ARG.test(s)) return s;\n';
const JOIN = '  return q + s.split(q).join(`${q}\\\\${q}${q}`) + q;\n';

const cases = [
  {
    id: 'M1', desc: '一律不加引号（改前的裸拼形态）', file: NAMING,
    find: JOIN, replace: '  return s;\n', expect: SUITE,
  },
  {
    id: 'M2', desc: '内含单引号的转义写错（只加反斜杠）', file: NAMING,
    find: JOIN, replace: '  return q + s.split(q).join(`\\\\${q}`) + q;\n', expect: SUITE,
  },
  {
    id: 'M3', desc: '白名单内也加引号（现存主题的输出不再逐字不变）', file: NAMING,
    find: GUARD, replace: '', expect: SUITE,
  },
  {
    id: 'M4', desc: '认领命令回退成裸拼', file: 'src/trivium/driver-claim.ts',
    find: '`trivium topic claim --topic ${shellQuoteArg(topic)} --stage',
    replace: '`trivium topic claim --topic ${topic} --stage', expect: SUITE,
  },
  {
    id: 'M5', desc: '失守作废命令回退成裸拼（只有源码护栏能抓）', file: 'src/trivium/hooks.ts',
    find: '`--topic ${shellQuoteArg(g.topic)} --stage ${g.stage} 作废这一轮',
    replace: '`--topic ${g.topic} --stage ${g.stage} 作废这一轮', expect: SUITE,
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
