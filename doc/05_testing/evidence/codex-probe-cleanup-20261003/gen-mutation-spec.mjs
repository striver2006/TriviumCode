// 生成「codex探活删除收尾」（EV-200）的源码变异规格（计划 r2 §3.2 的 M1～M15，按实际源码定稿为 M1～M16）。
// 照搬 evidence/zcode-probe-arm-cleanup-20261003/gen-mutation-spec.mjs 的形态：find 串从现行源码截取，逐条核对恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。每条只指定一个期望套件（装置每条只收一个套件）；
// 计划里点名「亦红」的跨套件观察写在 `also` 里，只给本目录的预跑脚本用，装置忽略它。
// 与计划的出入：M15 原写「没有凭据副本档不归一家目录」，实现里两档共用一个前缀（计划双审 AGY-01），改为变异前缀；
// M16 编码时补（凭据副本位置少拼一层 codexhome）。
// 用法（在仓库根）：node doc/05_testing/evidence/codex-probe-cleanup-20261003/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CODEX = 'src/trivium/adapters/codex.ts';
const CHOME = 'src/trivium/adapters/codex-home.ts';
const FSX = 'src/trivium/util/fsx.ts';
const ZC = 'src/trivium/adapters/zcode.ts';
const S = {
  cauth: 'dist/test/test/unit/codex-auth-probe.test.js', // C1～C8、F1
  zhome: 'dist/test/test/unit/zcode-doctor-probe-home.test.js', // D10 系列
  zfull: 'dist/test/test/unit/zcode-full-copy-arm.test.js', // R2～R6
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

// ── codex 探活 ──
const P_FIN = blockOf(CODEX, '          residue = await removeCodexAuthTempDir(tmp, profile);');
const P_RET = blockOf(CODEX, '        return residue === null ? r : { ok: r.ok, detail:');
const P_DEL = blockOf(CODEX, '  const left = await tryRemoveTempDir(tmp, codexCredentialCopies(codexHomeUnder(tmp), profile));');
const P_KIND = blockOf(CODEX, '  return left === null ? null : codexTempDirResidueText(tmp, left.code, left.remaining.length > 0);');
const P_PREP = blockOf(CODEX, '        home = await prepareCodexHome(tmp, { profile, projectRoot });', 2);
const P_TILDE = blockOf(CODEX, '          detail: `准备 codex 隔离副本失败${step ?');
const P_PREFIX = blockOf(CODEX, '    `⚠️ 探活临时目录删除失败（${code}）：${tildeHome(runDir)} 仍在，` +');
// ── codex-home ──
const H_LIST = blockOf(CHOME, "  return ['config.toml', ...(profile ? [`${profile}.config.toml`] : []), 'auth.json']");
const H_STEP = blockOf(CHOME, '      (e as { codexPrepStep?: string }).codexPrepStep = step;');
// ── 通用删除 ──
const F_ENOENT = blockOf(FSX, "        (err: unknown) => (err as NodeJS.ErrnoException).code !== 'ENOENT',");
const F_PUSH = blockOf(FSX, '      if (there) remaining.push(p);');
// ── zcode 薄包装 ──
const Z_WRAP = blockOf(ZC, '  return zcodeTempDirResidueText(who, runDir, left.code, copy && left.remaining.length > 0 ? copy.kind : null);');

const cases = [
  { id: 'M1', desc: 'codex 探活外层 finally 退回裸删', file: CODEX, find: P_FIN,
    replace: '          await fs.rm(tmp, { recursive: true, force: true });\n', expect: S.cauth },
  { id: 'M2', desc: '不接残留提示', file: CODEX, find: P_RET, replace: '        return r;\n', expect: S.cauth },
  { id: 'M3', desc: '残留时把 ok 改为 false', file: CODEX, find: P_RET, replace: sub(P_RET, '{ ok: r.ok,', '{ ok: false,'), expect: S.cauth },
  { id: 'M4', desc: 'codexCredentialCopies 去掉 auth.json', file: CHOME, find: H_LIST, replace: sub(H_LIST, ", 'auth.json']", ']'), expect: S.cauth },
  { id: 'M5', desc: 'codexCredentialCopies 去掉 profile 分层文件', file: CHOME, find: H_LIST,
    replace: sub(H_LIST, "...(profile ? [`${profile}.config.toml`] : []), ", ''), expect: S.cauth },
  { id: 'M6', desc: 'codex 措辞档位反向', file: CODEX, find: P_KIND, replace: sub(P_KIND, 'left.remaining.length > 0', 'left.remaining.length === 0'), expect: S.cauth },
  { id: 'M7', desc: 'tryRemoveTempDir 把 ENOENT 也判在', file: FSX, find: F_ENOENT, replace: '        () => true,\n', expect: S.cauth, also: [S.zhome] },
  { id: 'M8', desc: 'tryRemoveTempDir 查不了判不在', file: FSX, find: F_ENOENT, replace: '        () => false,\n', expect: S.cauth, also: [S.zhome] },
  { id: 'M9', desc: 'tryRemoveTempDir 不查（remaining 恒空）', file: FSX, find: F_PUSH, replace: '      void there;\n', expect: S.cauth },
  { id: 'M10', desc: 'attempt 不兜副本准备', file: CODEX, find: P_PREP, replace: P_PREP + '        throw e;\n', expect: S.cauth },
  { id: 'M11', desc: '步骤名不挂', file: CHOME, find: H_STEP, replace: '', expect: S.cauth },
  { id: 'M12', desc: '副本准备失败详情不归一家目录', file: CODEX, find: P_TILDE,
    replace: sub(P_TILDE, '${tildeHome(e instanceof Error ? e.message : String(e))}', '${e instanceof Error ? e.message : String(e)}'), expect: S.cauth },
  { id: 'M13', desc: 'zcode 薄包装忽略现场（恒取调用方档位）', file: ZC, find: Z_WRAP,
    replace: sub(Z_WRAP, 'copy && left.remaining.length > 0 ? copy.kind : null', 'copy ? copy.kind : null'), expect: S.zhome, also: [S.zfull] },
  { id: 'M14', desc: '删除成功时也接一个空提示', file: CODEX, find: P_RET,
    replace: '        return { ok: r.ok, detail: `${r.detail}；${residue ?? \'\'}` };\n', expect: S.cauth },
  { id: 'M15', desc: '残留提示前缀不归一家目录', file: CODEX, find: P_PREFIX, replace: sub(P_PREFIX, '${tildeHome(runDir)}', '${runDir}'), expect: S.cauth },
  { id: 'M16', desc: '凭据副本位置少拼一层 codexhome', file: CODEX, find: P_DEL,
    replace: sub(P_DEL, 'codexCredentialCopies(codexHomeUnder(tmp), profile)', 'codexCredentialCopies(tmp, profile)'), expect: S.cauth },
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
