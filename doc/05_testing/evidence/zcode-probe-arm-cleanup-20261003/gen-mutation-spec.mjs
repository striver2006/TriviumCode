// 生成「zcode探针臂删除收尾」（EV-198）的源码变异规格（计划 r2 §3.2 第 1～10 组，按实际源码定稿为 M1～M20）。
// 代码双审后（应答件 CODEX-05）：同形臂取档抽成 `fullCopyResidueKind`，M6 / M7 的锚点改到新函数的两条分支上，其余不变；
// 第一批规格与读数留档为 *.r1.*。
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/zcode-probe-silent-fail-20261003/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件）。
// 用法（在仓库根）：node doc/05_testing/evidence/zcode-probe-arm-cleanup-20261003/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROBE = 'src/trivium/probes/zcode.ts';
const ADAPTER = 'src/trivium/adapters/zcode.ts';
const S = {
  env: 'dist/test/test/unit/zcode-provider-env.test.js', // R1、D19
  full: 'dist/test/test/unit/zcode-full-copy-arm.test.js', // R2～R6
  auth: 'dist/test/test/unit/zcode-auth-probe.test.js', // A1～A4、A3、R7
  home: 'dist/test/test/unit/zcode-doctor-probe-home.test.js', // D10 系列、D18
};

/** 从源码截锚点：含 needle 的那一行起连取 n 行（含换行），要求整段在文件里唯一 */
function blockOf(file, needle, n = 1) {
  const src = read(file);
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`${file} 里没有「${needle}」`);
  const block = lines.slice(idx, idx + n).join('\n') + '\n';
  const hits = src.split(block).length - 1;
  if (hits !== 1) throw new Error(`${file} 里从「${needle}」起 ${n} 行的锚点命中 ${hits} 处（应为 1）`);
  return block;
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

// ── 三臂的删除收尾 ──
const F_FIN = blockOf(PROBE, "    tempDirResidue = await removeZcodeTempDir(emptyHome, '探针', null);");
const F_RET = blockOf(PROBE, '  return { accepted, rejected, indeterminate, zeroExit, tempDirResidue };');
const W_FIN = blockOf(PROBE, "    residue = await removeZcodeTempDir(home, '探针', { path: copyPath, kind: 'sentinel' });");
const W_RET = blockOf(PROBE, '  return residue === null ? result : { ...result, tempDirResidue: residue };');
const C_FIN = blockOf(PROBE, "    tempDirResidue = await (opts.removeTempDir ?? removeZcodeTempDir)(root, '探针', {");
const K_API = blockOf(PROBE, "  if (replace === 'apiKeyOnly') return 'credential';");
const K_RES = blockOf(PROBE, "  if (residue.length > 0) return 'credential';");
const C_RET = blockOf(PROBE, '  return tempDirResidue === null ? result : { ...result, tempDirResidue };');
// ── probeZcode 推 note ──
const N_FLAG = blockOf(PROBE, '    if (flags.tempDirResidue) notes.push(flags.tempDirResidue);');
const N_MO = blockOf(PROBE, '      if (mo.tempDirResidue) notes.push(mo.tempDirResidue);');
const N_FC = blockOf(PROBE, '      if (fc.tempDirResidue) notes.push(fc.tempDirResidue);');
const N_RO = blockOf(PROBE, '      if (ro.tempDirResidue) notes.push(ro.tempDirResidue);');
// ── doctor headless 段与认证探活的既有调用 ──
const H_FIN = blockOf(PROBE, "      const residue = await removeZcodeTempDir(runDir, '探针', { path: zcodeCliCopyPath(zcodeHomeUnder(runDir)), kind: 'credential' });");
const A_FIN = blockOf(ADAPTER, "          residue = await removeZcodeTempDir(runDir, '探活', { path: zcodeCliCopyPath(zcodeHomeUnder(runDir)), kind: 'credential' });");
// ── 共用函数 ──
const R_STAT = blockOf(ADAPTER, "            (err: unknown) => ((err as NodeJS.ErrnoException).code === 'ENOENT' ? null : copy.kind),");
const R_NULL = blockOf(ADAPTER, '      copy === null');
const T_SENT = blockOf(ADAPTER, "        ? '其中的 cli/config.json 是探针副本、凭据已换成哨兵，仍请手工删除'");
const P_PATH = blockOf(ADAPTER, "  return path.join(homeDir, ZCODE_CLI_SUBDIR, 'config.json');");

const BARE = (v) => `    await fs.rm(${v}, { recursive: true, force: true });\n`;

const cases = [
  // 计划第 1 组：三臂 finally 各自退回裸删
  { id: 'M1', desc: '旗标探针退回裸删', file: PROBE, find: F_FIN, replace: BARE('emptyHome'), expect: S.env },
  { id: 'M2', desc: '白名单臂退回裸删', file: PROBE, find: W_FIN, replace: BARE('home'), expect: S.full },
  { id: 'M3', desc: '同形臂退回裸删（先裸删再走原调用，删除失败照抛）', file: PROBE, find: C_FIN, replace: BARE('root') + C_FIN, expect: S.full },
  // 第 2、3 组：白名单臂的副本位置与档位
  { id: 'M4', desc: '白名单臂按 prepareZcodeHome 的布局查副本', file: PROBE, find: W_FIN,
    replace: sub(W_FIN, '{ path: copyPath,', '{ path: zcodeCliCopyPath(zcodeHomeUnder(home)),'), expect: S.full },
  { id: 'M5', desc: '白名单臂的档位取成含真实凭据', file: PROBE, find: W_FIN, replace: sub(W_FIN, "kind: 'sentinel'", "kind: 'credential'"), expect: S.full },
  // 第 4 组：同形臂的档位条件
  { id: 'M6', desc: '同形臂丢掉残余条件', file: PROBE, find: K_RES, replace: '', expect: S.full },
  { id: 'M7', desc: '同形臂丢掉 apiKeyOnly 条件', file: PROBE, find: K_API, replace: '', expect: S.full },
  // 第 5 组：旗标探针「谎称有副本」，指向删除失败时必然还在的临时目录本身（计划 r2：CODEX-02 ≡ GLM-03）
  { id: 'M8', desc: '旗标探针传指向临时目录本身的哨兵档', file: PROBE, find: F_FIN,
    replace: sub(F_FIN, "'探针', null);", "'探针', { path: emptyHome, kind: 'sentinel' });"), expect: S.env },
  // 第 6 组：删除失败后不现场查（ENOENT 也按调用方档位说）
  { id: 'M9', desc: '副本已不在也按调用方档位说', file: ADAPTER, find: R_STAT, replace: '            () => copy.kind,\n', expect: S.full },
  // 第 7 组：probeZcode 四处推 note 各删一处
  { id: 'M10', desc: '不推旗标探针的残留提示', file: PROBE, find: N_FLAG, replace: '', expect: S.home },
  { id: 'M11', desc: '不推白名单臂的残留提示', file: PROBE, find: N_MO, replace: '', expect: S.home },
  { id: 'M12', desc: '不推同形臂原样支的残留提示', file: PROBE, find: N_FC, replace: '', expect: S.home },
  { id: 'M13', desc: '不推同形臂置首支的残留提示', file: PROBE, find: N_RO, replace: '', expect: S.home },
  // 第 8 组：三臂丢掉 tempDirResidue
  { id: 'M14', desc: '旗标探针不带出提示', file: PROBE, find: F_RET, replace: sub(F_RET, 'zeroExit, tempDirResidue };', 'zeroExit, tempDirResidue: null };'), expect: S.env },
  { id: 'M15', desc: '白名单臂不带出提示', file: PROBE, find: W_RET, replace: '  return result;\n', expect: S.full },
  { id: 'M16', desc: '同形臂不带出提示', file: PROBE, find: C_RET, replace: '  return result;\n', expect: S.full },
  // 第 9 组：第三档措辞
  { id: 'M17', desc: '第三档措辞改字', file: ADAPTER, find: T_SENT, replace: sub(T_SENT, '凭据已换成哨兵，仍请手工删除', '凭据已换哨兵，请删除'), expect: S.auth },
  // 第 10 组：副本路径改错层级
  { id: 'M18', desc: 'zcodeCliCopyPath 多拼一层 cli', file: ADAPTER, find: P_PATH, replace: sub(P_PATH, "ZCODE_CLI_SUBDIR, 'config.json'", "ZCODE_CLI_SUBDIR, 'cli', 'config.json'"), expect: S.full },
  // 编码时补：两处既有调用的档位不得漂成哨兵档（输出逐字不变的承诺）
  { id: 'M19', desc: '认证探活的档位改成哨兵档', file: ADAPTER, find: A_FIN, replace: sub(A_FIN, "kind: 'credential'", "kind: 'sentinel'"), expect: S.auth },
  { id: 'M20', desc: 'doctor headless 段的档位改成哨兵档', file: PROBE, find: H_FIN, replace: sub(H_FIN, "kind: 'credential'", "kind: 'sentinel'"), expect: S.home },
];
// R_NULL 只作锚点存在性核对：null 短路被 M8 从调用方一侧咬住，不单列变异（计划 r2 §2.2）
void R_NULL;

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
