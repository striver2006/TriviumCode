// 生成「探针夹具删除收尾」（EV-199）的源码变异规格（计划 r2 §2.6 的 M1～M14，按实际源码定稿）。
// 照搬 evidence/auth-fingerprint-guard-20261004/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。期望套件只有一个（本题新文件，F / I / E / W 四组都在里面）。
// claude.ts 两处调用点用 `fx` / `memFx` 区分上下文，其余三个探针文件各只有一处调用点。
// 用法（在仓库根）：node doc/05_testing/evidence/probe-fixture-cleanup-20261004/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const FX = 'src/trivium/probes/fixture.ts';
const CX = 'src/trivium/probes/codex.ts';
const SUITE = 'dist/test/test/unit/probe-fixture-cleanup.test.js';

const MAIN_CLEANUP = "    cleanup: () => removeFixtureRoot('main', root),\n";
const MEM_CLEANUP = "    cleanup: () => removeFixtureRoot('memory', root),\n";
const BARE = '    cleanup: () => fs.rm(root, { recursive: true, force: true }).then(() => null),\n';
const FX_TEXT = '    `⚠️ 探针夹具删除失败（${code}）：${tildeHome(root)} 仍在，` +\n';
const FX_RET = '  return left === null ? null : fixtureResidueText(kind, root, left.code);\n';
const ISO_RM =
  '    const left = await tryRemoveTempDir(dir, []);\n' +
  '    tempDirResidue = left === null ? null : codexIsolationResidueText(dir, left.code);\n';
const ISO_RET = '  return { isolation, tempDirResidue };\n';
const ISO_PUSH = '    if (iso.tempDirResidue) notes.push(iso.tempDirResidue);\n';
const ISO_TEXT = '    `⚠️ codex 隔离探针临时目录删除失败（${code}）：${tildeHome(dir)} 仍在，` +\n';
const SITE = (who) => `    const fixtureResidue = await ${who}.cleanup();\n    if (fixtureResidue) notes.push(fixtureResidue);\n`;
const SITE_BARE = (who) => `    await ${who}.cleanup();\n`;

const cases = [
  { id: 'M1', file: FX, desc: '主夹具 cleanup 退回裸递归删除', find: MAIN_CLEANUP, replace: BARE },
  { id: 'M2', file: FX, desc: '记忆夹具 cleanup 退回裸递归删除', find: MEM_CLEANUP, replace: BARE },
  { id: 'M3', file: FX, desc: 'fixtureResidueText 去掉家目录归一', find: FX_TEXT, replace: FX_TEXT.replace('${tildeHome(root)}', '${root}') },
  { id: 'M4', file: FX, desc: '删成功也返回提示', find: FX_RET, replace: "  return fixtureResidueText(kind, root, left === null ? 'OK' : left.code);\n" },
  { id: 'M5', file: FX, desc: '记忆夹具的提示取主夹具那句', find: MEM_CLEANUP, replace: MAIN_CLEANUP },
  { id: 'M6', file: CX, desc: '隔离探针 finally 退回裸递归删除', find: ISO_RM, replace: '    await fs.rm(dir, { recursive: true, force: true });\n' },
  { id: 'M7', file: CX, desc: '删不掉时把结论改成 shared', find: ISO_RET, replace: "  return { isolation: tempDirResidue === null ? isolation : 'shared', tempDirResidue };\n" },
  { id: 'M8', file: CX, desc: 'probeCodex 不推隔离探针的提示', find: ISO_PUSH, replace: '' },
  { id: 'M9', file: 'src/trivium/probes/agy.ts', desc: 'agy 调用点不推夹具提示', find: SITE('fx'), replace: SITE_BARE('fx') },
  { id: 'M10', file: 'src/trivium/probes/claude.ts', desc: 'claude 记忆夹具调用点不推提示', find: SITE('memFx'), replace: SITE_BARE('memFx') },
  { id: 'M11', file: 'src/trivium/probes/zcode.ts', desc: 'zcode 调用点不推夹具提示', find: SITE('fx'), replace: SITE_BARE('fx') },
  { id: 'M12', file: CX, desc: 'codexIsolationResidueText 去掉家目录归一', find: ISO_TEXT, replace: ISO_TEXT.replace('${tildeHome(dir)}', '${dir}') },
  { id: 'M13', file: CX, desc: 'codex 调用点不推夹具提示', find: SITE('fx'), replace: SITE_BARE('fx') },
  { id: 'M14', file: 'src/trivium/probes/claude.ts', desc: 'claude 主夹具调用点不推提示', find: SITE('fx'), replace: SITE_BARE('fx') },
].map((c) => ({ ...c, expect: SUITE }));

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
