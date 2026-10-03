// 生成「zcode探针静默失败收口」（EV-196 + EV-197）的源码变异规格（计划 r2 §4.2 M1～M16，编码时补 M17～M18）。
// 代码双审后（应答件 GLM-01 ≡ CODEX-03、GLM-02）：「还有没有副本」改由删除函数在失败后现场查，
// 原 M16～M18（调用方传 hasCopy）随之失效，按新判据重写为 M16～M18，另补 M19。第一批规格与读数留档为 *.r1.*。
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/doctor-probe-home-20261003/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件）。
// 用法（在仓库根）：node doc/05_testing/evidence/zcode-probe-silent-fail-20261003/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROBE = 'src/trivium/probes/zcode.ts';
const ADAPTER = 'src/trivium/adapters/zcode.ts';
const DOCTOR = 'src/trivium/doctor.ts';
const S = {
  home: 'dist/test/test/unit/zcode-doctor-probe-home.test.js',
  auth: 'dist/test/test/unit/zcode-auth-probe.test.js',
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

// ── EV-196 探针侧 ──
const P_RET_A = blockOf(PROBE, "headlessUnrefreshed: headlessUnrefreshed('source_unreadable') };");
const P_RET_B = blockOf(PROBE, "headlessUnrefreshed: headlessUnrefreshed('headless_failed') };");
const P_SET_C = blockOf(PROBE, "        unrefreshed = headlessUnrefreshed('no_envelope');");
const P_ENV_OK = blockOf(PROBE, "        probe.response_field = out.envelope.keys.includes('response') ? 'response' : null;");
const P_SKIP = blockOf(PROBE, '// 没进真实调用段，不算「没刷新」（决策一）', 2);
if (!P_SKIP.includes('headlessUnrefreshed: null };')) throw new Error('P_SKIP 没取到跳过那条 return');
const P_CARRIED_C = blockOf(PROBE, "    carried: ['response_field', 'model_id_form'],");
const P_NOTE_C = blockOf(PROBE, '        notes.push(ZCODE_HEADLESS_UNREFRESHED.no_envelope.noteKey);');
// ── EV-196 doctor 侧 ──
const D_WARN = blockOf(DOCTOR, 'if (r.headlessUnrefreshed) warnings.push(zcodeHeadlessUnrefreshedWarning(r.headlessUnrefreshed));');
const D_BLOCK = blockOf(DOCTOR, 'if (r.probe.response_field === null && !opts.skipModelCalls) blockers.push(ZCODE_HEADLESS_NOT_OK_HINT);');
// ── EV-197 适配层 ──
const A_CATCH = blockOf(ADAPTER, '    return zcodeTempDirResidueText(who, runDir, (e as NodeJS.ErrnoException).code');
const A_TEXT = blockOf(ADAPTER, "(hasCopy ? '其中的 cli/config.json 副本含真实凭据，请手工删除'");
const A_RET = blockOf(ADAPTER, 'return residue === null ? r : { ok: r.ok, detail:');
const A_FIN = blockOf(ADAPTER, "residue = await removeZcodeTempDir(runDir, '探活');");
// 删除失败后现场查副本：stat 成功 ⇒ 有；ENOENT ⇒ 没有；其他错误 ⇒ 按有说
const A_STAT = blockOf(ADAPTER, "(err: unknown) => (err as NodeJS.ErrnoException).code !== 'ENOENT',");
const A_HASCOPY = blockOf(ADAPTER, '    const hasCopy = await fs');
const D_WARN_IF = D_WARN;

const cases = [
  { id: 'M1', desc: '副本源失败支不带出未刷新', file: PROBE, find: P_RET_A,
    replace: sub(P_RET_A, "headlessUnrefreshed('source_unreadable')", 'null'), expect: S.home },
  { id: 'M2', desc: 'headless 失败支不带出未刷新', file: PROBE, find: P_RET_B,
    replace: sub(P_RET_B, "headlessUnrefreshed('headless_failed')", 'null'), expect: S.home },
  { id: 'M3', desc: '无 envelope 支不带出未刷新', file: PROBE, find: P_SET_C, replace: '', expect: S.home },
  { id: 'M4', desc: '有 envelope 那一支也置成 no_envelope', file: PROBE, find: P_ENV_OK,
    replace: P_ENV_OK + "        unrefreshed = headlessUnrefreshed('no_envelope');\n", expect: S.home },
  { id: 'M5', desc: '跳过真实调用那条 return 带上 headless_failed', file: PROBE, find: P_SKIP,
    replace: sub(P_SKIP, 'headlessUnrefreshed: null };', "headlessUnrefreshed: headlessUnrefreshed('headless_failed') };"), expect: S.home },
  { id: 'M6', desc: '无 envelope 支 carried 取成四项', file: PROBE, find: P_CARRIED_C,
    replace: "    carried: ['response_field', 'path_deny', 'scratch_paths', 'model_id_form'],\n", expect: S.home },
  { id: 'M7', desc: 'doctor 不推 warning', file: DOCTOR, find: D_WARN, replace: '', expect: S.home },
  { id: 'M8', desc: 'doctor 把它推进 blockers', file: DOCTOR, find: D_WARN,
    replace: sub(D_WARN, 'warnings.push(', 'blockers.push('), expect: S.home },
  { id: 'M9', desc: 'headless blocker 判据并上 headlessUnrefreshed（出路二的等价形态）', file: DOCTOR, find: D_BLOCK,
    replace: sub(D_BLOCK, 'if (r.probe.response_field === null && ', 'if ((r.probe.response_field === null || r.headlessUnrefreshed) && '), expect: S.home },
  { id: 'M10', desc: '无 envelope 支的 note 不再引 noteKey（定位字面漂移）', file: PROBE, find: P_NOTE_C,
    replace: "        notes.push('ZCode stdout 里没有 JSON envelope');\n", expect: S.home },
  { id: 'M11', desc: '共用删除函数失败照抛（裸删）', file: ADAPTER, find: A_CATCH,
    replace: '    throw e;\n' + A_CATCH, expect: S.auth },
  { id: 'M12', desc: '探活不把残留接进详情', file: ADAPTER, find: A_RET,
    replace: sub(A_RET, 'return residue === null ? r : { ok: r.ok, detail:', 'return true ? r : { ok: r.ok, detail:'), expect: S.auth },
  { id: 'M13', desc: '探活在删除失败时把 ok 置 false', file: ADAPTER, find: A_RET,
    replace: sub(A_RET, '{ ok: r.ok, detail:', '{ ok: false, detail:'), expect: S.auth },
  { id: 'M14', desc: '探活退回旧写法（finally 里裸删）', file: ADAPTER, find: A_FIN,
    replace: sub(A_FIN, "residue = await removeZcodeTempDir(runDir, '探活');", 'await fs.rm(runDir, { recursive: true, force: true });'), expect: S.auth },
  { id: 'M15', desc: '共用函数里有副本那档的文案字面改写', file: ADAPTER, find: A_TEXT,
    replace: sub(A_TEXT, '其中的 cli/config.json 副本含真实凭据，请手工删除', '其中有副本，请删除'), expect: S.home },
  // ── 代码双审后按新判据重写（原 M16～M18 见 mutation-spec.r1.json）──
  { id: 'M16', desc: '残留里有没有副本恒判「有」（不现场查）', file: ADAPTER, find: A_HASCOPY,
    replace: sub(A_HASCOPY, '    const hasCopy = await fs', '    const hasCopy = true || await fs'), expect: S.home },
  { id: 'M17', desc: '残留里有没有副本恒判「没有」', file: ADAPTER, find: A_HASCOPY,
    replace: sub(A_HASCOPY, '    const hasCopy = await fs', '    const hasCopy = false && await fs'), expect: S.auth },
  { id: 'M18', desc: '查不了副本在不在时按「没有」说', file: ADAPTER, find: A_STAT,
    replace: sub(A_STAT, "(err as NodeJS.ErrnoException).code !== 'ENOENT'", 'false'), expect: S.home },
  { id: 'M19', desc: 'warning 判据加第二条件（existing 为 null 时不出，与 blocker 互斥）', file: DOCTOR, find: D_WARN_IF,
    replace: sub(D_WARN_IF, 'if (r.headlessUnrefreshed)', 'if (r.headlessUnrefreshed && r.probe.response_field !== null)'), expect: S.home },
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
