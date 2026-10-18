// 生成「M12-共享根残留检测」的变异规格：逐条核 find 在目标文件中恰好命中一处、replace 不含特殊替换模式。
// 形态照搬 evidence/m12-batch5-20261018/gen-spec.mjs。
// 用法（仓库根）：node gen-spec.mjs <全量规格 JSON> <正式装置规格 JSON>
//   全量规格给逐条预跑脚本用，含 scripts/install-check.mjs 的一条（M11）；
//   正式装置只认 .ts 目标（闸 4 按 dist/test 产物映射），第二份规格去掉 M11。
import fs from 'node:fs';
const EC = 'src/trivium/entry-collisions.ts', IN = 'src/install.ts', IC = 'scripts/install-check.mjs';
const U = (n) => `dist/test/test/unit/${n}.test.js`;
const cases = [
  ['M1', '共享根残留循环不排除安装根', EC, "        if (r === t.skillsRoot) continue;", "        if (r === '') continue;", U('entry-collisions')],
  ['M2', 'isResidueCopy 恒真（见名即判）', EC,
    "export async function isResidueCopy(dir: string, entryNames: readonly string[] = ENTRY_SKILL_NAMES): Promise<boolean> {",
    "export async function isResidueCopy(dir: string, entryNames: readonly string[] = ENTRY_SKILL_NAMES): Promise<boolean> {\n  if (dir) return true;",
    U('entry-collisions')],
  ['M3', '去掉 schema/ 判据', EC,
    "  if ((await hasRuntimeIdentity(dir, RUNTIME_ROOT_NAME)) && (await isDir(path.join(dir, 'schema')))) return true;",
    "  if ((await hasRuntimeIdentity(dir, RUNTIME_ROOT_NAME)) && (await isDir(dir))) return true;",
    U('entry-collisions')],
  ['M4', '去掉入口子树判据', EC, "        if (await isOurEntry(path.join(e, c, n), n)) return true;", "        void n;", U('entry-collisions')],
  ['M5', '入口子树只查 D、不查 D/entry', EC, "  for (const e of [dir, path.join(dir, 'entry')]) {", "  for (const e of [dir]) {", U('entry-collisions')],
  ['M6', '去掉豁免', EC, "          if (exempt.has(await realpathOr(p))) continue;", "          void exempt;", U('entry-collisions')],
  ['M7', 'sharedReadRootTargets 传空共享根残留名单', EC, "      sharedResidueNames: RESIDUE_DIR_NAMES,", "      sharedResidueNames: [],", U('entry-collisions')],
  ['M8', '安装器传空共享根残留名单', IN, "      sharedResidueNames: RESIDUE_NAMES,", "      sharedResidueNames: [],", U('install')],
  ['M9', 'describe 漏掉残留段的逐行', EC, "    for (const g of residues) lines.push(groupLine(g, home));", "    void residues;", U('entry-collisions')],
  ['M10', 'summarize 无残留时也带残留短语', EC,
    "    ...(residues.length > 0 ? [`${residues.length} 份本产品的历史拷贝`] : []),",
    "    ...[`${residues.length} 份本产品的历史拷贝`],",
    U('entry-collisions')],
  ['M11', 'install-check 不传运行时根', IC,
    "  const problems = await checkInstall(plan.targets, plan.runtimeRoot);",
    "  const problems = await checkInstall(plan.targets);",
    U('install-check-script')],
  ['M12', 'hasRuntimeIdentity 不要求 front-matter 起始', EC,
    "    return (await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).startsWith(`---\\nname: ${runtimeName}\\n`);",
    "    return (await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).includes(`name: ${runtimeName}\\n`);",
    U('entry-collisions')],
  ['M13', '豁免比对不取真实路径', EC,
    "      const exempt = new Set(await Promise.all((t.exemptPaths ?? []).map(realpathOr)));",
    "      const exempt = new Set(t.exemptPaths ?? []);",
    U('entry-collisions')],
  ['M14', 'sharedReadRootTargets 漏放自身所在的运行时根', EC,
    "  const exemptPaths = [resolveAssetRoot(undefined, se.env, se.home), ...(self === null ? [] : [self])];",
    "  const exemptPaths = [resolveAssetRoot(undefined, se.env, se.home)];",
    U('entry-collisions')],
  ['M15', 'install() 不传运行时根', IN,
    "  problems.push(...(await checkInstall(selected, plan.runtimeRoot)));",
    "  problems.push(...(await checkInstall(selected)));",
    U('install')],
];
for (const [id, , file, find] of cases) {
  const n = fs.readFileSync(file, 'utf8').split(find).length - 1;
  if (n !== 1) throw new Error(`${id} find 命中 ${n} 处`);
}
for (const c of cases) if (/\$[$&`'0-9<]/.test(c[4])) throw new Error(`${c[0]} replace 含特殊替换模式`);
const toSpec = (cs) => ({
  targets: [...new Set(cs.map((c) => c[2]))],
  suites: [...new Set(cs.map((c) => c[5]))],
  cases: cs.map(([id, desc, file, find, replace, expect]) => ({ id, desc, file, find, replace, expect })),
});
fs.writeFileSync(process.argv[2], JSON.stringify(toSpec(cases), null, 2) + '\n');
const tsOnly = cases.filter((c) => c[2].endsWith('.ts'));
fs.writeFileSync(process.argv[3], JSON.stringify(toSpec(tsOnly), null, 2) + '\n');
console.log(`ok 全量 ${cases.length} 条，正式装置 ${tsOnly.length} 条`);
