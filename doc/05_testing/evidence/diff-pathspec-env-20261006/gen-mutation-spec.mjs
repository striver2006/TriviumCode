// 生成「补丁排除钉住 pathspec 解释」（EV-222）的变异规格。未走双审，规格由执笔方自定。
// 照搬 evidence/worktree-hash-concurrency-20261006/gen-mutation-spec.mjs 的形态。
// GLOB 一项不设变异：对现有两种写法实测无影响（env-matrix.txt），只有 H3 对常量的断言咬得住，不算行为覆盖。
// 用法（在仓库根）：node doc/05_testing/evidence/diff-pathspec-env-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GIT = 'src/trivium/util/git.ts';
const UNIT = 'dist/test/test/unit/diff-pathspec-env.test.js';
const INTEG = 'dist/test/test/integration/diff-pathspec-env.test.js';

const cases = [
  {
    id: 'M1', desc: '补丁的 git diff 不钉环境（改前形态）', file: GIT,
    find: "'--', '.', ...pathspecs], PATHSPEC_ENV_DEFAULTS);\n",
    replace: "'--', '.', ...pathspecs]);\n", expect: UNIT, also: [INTEG],
  },
  {
    id: 'M2', desc: '常量里去掉 GIT_LITERAL_PATHSPECS', file: GIT,
    find: "  GIT_LITERAL_PATHSPECS: '0',\n  GIT_NOGLOB_PATHSPECS: '0',\n",
    replace: "  GIT_NOGLOB_PATHSPECS: '0',\n", expect: UNIT, also: [INTEG],
  },
  {
    id: 'M3', desc: '常量里去掉 GIT_NOGLOB_PATHSPECS', file: GIT,
    find: "  GIT_NOGLOB_PATHSPECS: '0',\n  GIT_GLOB_PATHSPECS: '0',\n",
    replace: "  GIT_GLOB_PATHSPECS: '0',\n", expect: UNIT, also: [INTEG],
  },
  {
    id: 'M4', desc: '常量里去掉 GIT_ICASE_PATHSPECS', file: GIT,
    find: "  GIT_GLOB_PATHSPECS: '0',\n  GIT_ICASE_PATHSPECS: '0',\n",
    replace: "  GIT_GLOB_PATHSPECS: '0',\n", expect: UNIT,
  },
  {
    id: 'M5', desc: '工作树哈希退回只钉 GIT_LITERAL_PATHSPECS（EV-221 形态）', file: GIT,
    find: '{ ...env, ...PATHSPEC_ENV_DEFAULTS }',
    replace: "{ ...env, GIT_LITERAL_PATHSPECS: '0' }", expect: UNIT,
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
