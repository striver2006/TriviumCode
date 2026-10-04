// 生成「临时索引与清扫删除收尾」（EV-204）的源码变异规格（计划 r2 §2.7 的 M1～M15，按实际源码定稿，另补 M16、M17）。
// 照搬 evidence/probe-fixture-cleanup-20261004/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。每条只有一个期望套件（装置 expect 只收一个）。
// M1 的「退回裸递归删除」用动态导入取 fs：改后的 git.ts 已不导入 fs，直接写 fs.rm 在打包产物里是 ReferenceError，
// 那样每次调用都抛、测的就不是原先「删不掉才抛」的形态了。
// 用法（在仓库根）：node doc/05_testing/evidence/temp-index-cleanup-20261004/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GIT = 'src/trivium/util/git.ts';
const RET = 'src/trivium/retention.ts';
const HOOKS = 'src/trivium/hooks.ts';
const ST = 'src/trivium/selftest.ts';
const U_TIC = 'dist/test/test/unit/temp-index-cleanup.test.js';
const U_RET = 'dist/test/test/unit/retention.test.js';
const U_HOOKS = 'dist/test/test/unit/hooks.test.js';
const I_WHC = 'dist/test/test/integration/worktree-hash-cleanup.test.js';
const I_ST = 'dist/test/test/integration/selftest.test.js';

const GIT_RM = '    const left = await tryRemoveTempDir(tmpDir, []);\n';
const GIT_ONCE = '    if (left && !indexResidueNoticed) {\n';
const GIT_WARN = '      warn(indexResidueText(tmpDir, left.code));\n';
const GIT_TEXT = '    `工作树哈希的临时目录删除失败（${code}）：${tildeHome(dir)} 仍在——` +\n';
const RET_PUSH = '        out.removeFailed.push({ dir, code: left.code });\n';
const RET_RM = '        const left = opts.dryRun ? null : await tryRemoveTempDir(dir, []);\n';
const HOOK_EARLY = '    pruned === 0 && removeFailed.length === 0 && scrubbed === 0 &&';
const HOOK_LINE = '  if (removeFailed.length > 0) lines.push(removeFailedLine(removeFailed));\n';
const HOOK_LISTED = '  const listed = failed.slice(0, REMOVE_FAILED_LISTED)';
const ST_MADE = '  made.dir = raw;\n';
const ST_FINISH = '    const left = keep || dir === null ? null : await tryRemoveTempDir(dir, []);\n';
const ST_RENDER = '    L.push(r.cleanupResidue);\n';
const ST_DETAIL = "      steps: [{ name: '创建夹具仓库', ok: false, detail: (e as Error).message }],\n";
const ST_CATCH = '    const left = made.dir ? await tryRemoveTempDir(made.dir, []) : null;\n';
const NULL_LEFT = 'null as { code: string } | null';

const cases = [
  {
    id: 'M1', file: GIT, expect: U_TIC, desc: 'workTreeHash 的 finally 退回裸递归删除',
    find: GIT_RM,
    replace: "    await (await import('node:fs')).promises.rm(tmpDir, { recursive: true, force: true });\n" +
      `    const left = ${NULL_LEFT};\n`,
  },
  { id: 'M2', file: GIT, expect: U_TIC, desc: '去掉「同一进程只提示一次」的判断', find: GIT_ONCE, replace: '    if (left) {\n' },
  { id: 'M3', file: GIT, expect: U_TIC, desc: '删不掉时不提示（静默）', find: GIT_WARN, replace: '' },
  { id: 'M4', file: GIT, expect: U_TIC, desc: '提示里不做家目录归一', find: GIT_TEXT, replace: GIT_TEXT.replace('${tildeHome(dir)}', '${dir}') },
  { id: 'M5', file: GIT, expect: I_WHC, desc: '删不掉就抛（漂移复算那一处会把运行判 failed）', find: GIT_ONCE, replace: "    if (left) throw new Error('删除失败 ' + left.code);\n" + GIT_ONCE },
  { id: 'M6', file: RET, expect: U_RET, desc: '到期目录删不掉后 break，后面的目录不再处理', find: RET_PUSH, replace: RET_PUSH + '        break;\n' },
  { id: 'M7', file: RET, expect: U_RET, desc: '删不掉后直接 continue，不落回凭据抹除', find: RET_PUSH, replace: RET_PUSH + '        continue;\n' },
  { id: 'M8', file: RET, expect: U_RET, desc: '删不掉不记 removeFailed', find: RET_PUSH, replace: '' },
  { id: 'M9', file: HOOKS, expect: U_HOOKS, desc: '会话启动早退条件不含 removeFailed', find: HOOK_EARLY, replace: '    pruned === 0 && scrubbed === 0 &&' },
  { id: 'M10', file: HOOKS, expect: U_HOOKS, desc: '待办不截断到三个', find: HOOK_LISTED, replace: '  const listed = failed' },
  { id: 'M11', file: ST, expect: U_TIC, desc: 'buildFixture 不记 made.dir', find: ST_MADE, replace: '' },
  {
    id: 'M12', file: ST, expect: I_ST, desc: 'finish 退回裸递归删除',
    find: ST_FINISH,
    replace: '    if (!keep) await fs.rm(root, { recursive: true, force: true });\n' + `    const left = ${NULL_LEFT};\n`,
  },
  { id: 'M13', file: ST, expect: U_TIC, desc: '有残留提示也说「夹具已清理」', find: ST_RENDER, replace: ST_RENDER + "    L.push('夹具已清理。');\n" },
  {
    id: 'M14', file: ST, expect: U_TIC, desc: '建夹具失败时用删除错误码顶替 detail',
    find: ST_DETAIL,
    replace: "      steps: [{ name: '创建夹具仓库', ok: false, detail: left ? left.code : (e as Error).message }],\n",
  },
  { id: 'M15', file: ST, expect: U_TIC, desc: '建夹具失败时不删 made.dir', find: ST_CATCH, replace: `    const left = ${NULL_LEFT};\n` },
  { id: 'M16', file: HOOKS, expect: U_HOOKS, desc: '会话启动不出删不掉那一行', find: HOOK_LINE, replace: '' },
  { id: 'M17', file: RET, expect: U_RET, desc: 'dryRun 也真删', find: RET_RM, replace: '        const left = await tryRemoveTempDir(dir, []);\n' },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的 replace 含特殊替换模式`);
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`已写 ${cases.length} 条 ⇒ ${OUT}`);
