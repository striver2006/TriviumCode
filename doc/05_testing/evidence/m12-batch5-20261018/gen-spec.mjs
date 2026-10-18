// 生成 M12 批次 5 的变异规格：逐条核 find 在目标文件中恰好命中一处、replace 不含特殊替换模式。
// 用法（仓库根）：node gen-spec.mjs <输出 JSON>
import fs from 'node:fs';
const EC = 'src/trivium/entry-collisions.ts', IN = 'src/install.ts', DO = 'src/trivium/doctor.ts', PF = 'src/trivium/preflight.ts', RP = 'src/trivium/run-protocol.ts';
const U = (n) => `dist/test/test/unit/${n}.test.js`;
const I = (n) => `dist/test/test/integration/${n}.test.js`;
const WRAPPER = ['.trivium', 'bin', 'trivium'].join('/');
const cases = [
  ['M1', '安装根里的自家同名不再放行', EC, "        if (r === t.skillsRoot && ours) continue; // 安装根里的自家同名：上一次安装，升级覆盖", "        if (r === t.skillsRoot && ours && name === '') continue;", U('install')],
  ['M2', 'isOurEntry 去掉 wrapper 子串判据', EC, "  return md.startsWith(`---\\nname: ${name}\\n`) && md.includes('" + WRAPPER + "');", "  return md.startsWith(`---\\nname: ${name}\\n`);", U('entry-collisions')],
  ['M3', 'doctor 把共享读取面告警推进 blockers', DO, "      if (listed !== null) warnings.push(listed);", "      if (listed !== null) blockers.push(listed);", U('doctor-shared-roots')],
  ['M4', 'preflight 共享读取面项 ok 置 false', PF, "    return detail === null ? null : { name, ok: true, warn: true, detail };", "    return detail === null ? null : { name, ok: false, warn: true, detail };", U('preflight')],
  ['M5', 'preflight 相关集去掉 Driver', PF, "    const s = await checkSharedReadRoots([driver, ...selected], opts.entryScanEnv);", "    const s = await checkSharedReadRoots([...selected], opts.entryScanEnv);", U('preflight')],
  ['M6', '共享读取面目标把安装根也放进读取根', EC, "      readRoots: roots.readRoots.filter((r) => r !== roots.skillsRoot),", "      readRoots: roots.readRoots,", U('entry-collisions')],
  ['M7', 'packSnapshots 不置 null（仍存 N 份）', RP, "  for (const c of sides) packed[c] = { ...snapshots[c]!, diffText: null };", "  for (const c of sides) packed[c] = { ...snapshots[c]! };", U('handoff-pack')],
  ['M8', 'unpackSnapshots 不核正文 sha', RP, "  if (sha256(fd.text) !== fd.sha256) throw bad('冻结补丁的正文与它的 sha256 对不上');", "  void sha256;", U('handoff-pack')],
  ['M9', 'unpackSnapshots 漏还原首侧', RP, "    out[c] = { ...snap, diffText: fd.text };", "    out[c] = c === sides[0] ? snap : { ...snap, diffText: fd.text };", U('handoff-pack')],
  ['M10', '旧格式误判为新格式丢正文', RP, "    if (h.stage === 'code' && sides.some((c) => h.snapshots[c]?.diffText === null)) {", "    if (h.stage === 'code') {", U('handoff-pack')],
  ['M11', 'entryScanEnv 忽略环境变量', EC, "  const fromEnv = process.env[ENTRY_SCAN_HOME_ENV];", "  const fromEnv = undefined as string | undefined;", U('entry-scan-isolation')],
  ['M12', 'unpackSnapshots 去掉非 code 阶段拒绝', RP, "  if (h.stage !== 'code') throw bad(`${h.stage} 阶段不该带冻结补丁`);", "  void 0;", U('handoff-pack')],
  ['M13', '安装器对 top 布局也查残留', IN, "      residueNames: t.layout === 'entry' ? RESIDUE_NAMES : [],", "      residueNames: RESIDUE_NAMES,", U('install')],
  ['M14', 'writeHandoff 不写 frozen_diff（正文丢失）', RP, "    ...(packed.frozen_diff ? { frozen_diff: packed.frozen_diff } : {}),", "    ...({}),", I('handoff-dedupe')],
];
const targets = [...new Set(cases.map((c) => c[2]))];
for (const [id, , file, find] of cases) {
  const n = fs.readFileSync(file, 'utf8').split(find).length - 1;
  if (n !== 1) throw new Error(`${id} find 命中 ${n} 处`);
}
for (const c of cases) if (/\$[$&`'0-9<]/.test(c[4])) throw new Error(`${c[0]} replace 含特殊替换模式`);
const spec = {
  targets,
  suites: [...new Set(cases.map((c) => c[5]))],
  cases: cases.map(([id, desc, file, find, replace, expect]) => ({ id, desc, file, find, replace, expect })),
};
fs.writeFileSync(process.argv[2], JSON.stringify(spec, null, 2) + '\n');
console.log(`ok ${cases.length} cases, ${targets.length} targets`);
