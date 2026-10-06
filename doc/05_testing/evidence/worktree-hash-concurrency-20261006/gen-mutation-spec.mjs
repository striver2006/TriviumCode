// 生成「工作树哈希并发收口」（EV-221）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/run-dir-collision-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/worktree-hash-concurrency-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GIT = 'src/trivium/util/git.ts';
const FREEZE = 'src/trivium/freeze.ts';
const REVIEW = 'src/trivium/review.ts';
const SUMMARY = 'src/trivium/worktree-summary.ts';
const STAMP = 'src/trivium/build-stamp.ts';
const UNIT = 'dist/test/test/unit/worktree-hash-exclude.test.js';
const INTEG = 'dist/test/test/integration/worktree-hash-concurrency.test.js';

const cases = [
  {
    id: 'M1', desc: '排除失效：add 不带排除 pathspec（改前形态）', file: GIT,
    find: "    const addArgs = ['add', '-A', '--', '.', ...excludes];\n",
    replace: "    const addArgs = ['add', '-A', '--', '.'];\n", expect: UNIT, also: [INTEG],
  },
  {
    id: 'M2', desc: '送审冻结不传排除', file: FREEZE,
    find: '  const treeHash = await workTreeHash(projectRoot, { exclude: ownExcludes });\n',
    replace: '  const treeHash = await workTreeHash(projectRoot);\n', expect: UNIT, also: [INTEG],
  },
  {
    id: 'M3', desc: '跑后复算不传排除', file: REVIEW,
    find: '  const afterTreeHash = await workTreeHash(ctx.projectRoot, { exclude: ownExcludes });\n',
    replace: '  const afterTreeHash = await workTreeHash(ctx.projectRoot);\n', expect: UNIT, also: [INTEG],
  },
  {
    id: 'M4', desc: '审批摘要不传排除', file: SUMMARY,
    find: '      const current = await workTreeHash(i.projectRoot, { timeoutMs: remaining(), exclude: excluded });\n',
    replace: '      const current = await workTreeHash(i.projectRoot, { timeoutMs: remaining() });\n', expect: UNIT,
  },
  {
    id: 'M5', desc: '构建标识不传排除（结果按设计不变，只有源码护栏咬得住）', file: STAMP,
    find: '    tree = await workTreeHash(root, { exclude: INPUT_HASH_EXCLUDES });\n',
    replace: '    tree = await workTreeHash(root);\n', expect: UNIT,
  },
  {
    id: 'M6', desc: '不重试（改前形态）', file: GIT,
    find: '    for (let n = 0; n < ADD_VANISHED_RETRIES && add.code !== 0',
    replace: '    for (let n = 0; n < 0 && add.code !== 0', expect: UNIT,
  },
  {
    id: 'M7', desc: '任何报错都重试（不看判据）', file: GIT,
    find: ' && !add.timedOut && isVanishedFileError(add.stderr); n++) {\n',
    replace: ' && !add.timedOut; n++) {\n', expect: UNIT,
  },
  {
    id: 'M8', desc: '判据放宽：只看 unable to stat', file: GIT,
    find: "  return stderr.includes('unable to stat') && stderr.includes('No such file or directory');\n",
    replace: "  return stderr.includes('unable to stat');\n", expect: UNIT,
  },
  {
    id: 'M9', desc: '重试次数改 1', file: GIT,
    find: 'export const ADD_VANISHED_RETRIES = 2;\n',
    replace: 'export const ADD_VANISHED_RETRIES = 1;\n', expect: UNIT,
  },
  {
    id: 'M10', desc: 'add 这一步不钉 GIT_LITERAL_PATHSPECS=0', file: GIT,
    find: "    const addEnv = excludes.length > 0 ? { ...env, GIT_LITERAL_PATHSPECS: '0' } : env;\n",
    replace: '    const addEnv = env;\n', expect: UNIT,
  },
  {
    id: 'M11', desc: '排除前缀不按字面（去掉 literal 魔法）', file: GIT,
    find: '    out.push(`:(exclude,literal)${p}`);\n',
    replace: '    out.push(`:(exclude)${p}`);\n', expect: UNIT,
  },
  {
    id: 'M12', desc: '规范化不丢 .（排除整棵树）', file: GIT,
    find: "    if (p === '' || p === '.' || p.startsWith('..')) continue;\n",
    replace: "    if (p === '' || p.startsWith('..')) continue;\n", expect: UNIT,
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
