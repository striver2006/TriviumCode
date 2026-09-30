// 生成「取不到启动时刻当不在」（EV-175）的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/concurrent-setgate-flake-20260930/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/unverifiable-start-20260930/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const EXEC = 'src/trivium/util/exec.ts';
const STATUS = 'src/trivium/status.ts';
const RET = 'src/trivium/retention.ts';
const RP = 'src/trivium/run-protocol.ts';
const SUITE = 'dist/test/test/integration/unverifiable-start.test.js';

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const ID_OF = lineOf(EXEC, "m.alive && m.startedAt === null && m.expected !== null ? 'unverifiable' : 'different'");
const NOT_ALIVE = lineOf(EXEC, "if (!alive) return withIdentity({ alive: false, sameProcess: false, startedAt: null, expected, basis: 'canonical' });");
const LEGACY_RET = lineOf(EXEC, "return withIdentity({ ...p, expected: legacy || null, basis: 'legacy' });");
const CASE_C = lineOf(STATUS, "if (live.identity !== 'unverifiable' && (!live.alive || !live.sameProcess)) {");
const CASE_A = lineOf(STATUS, "if ((live.alive && live.sameProcess) || live.identity === 'unverifiable') return { kind: 'inconclusive', reason };");
const WCG = lineOf(STATUS, "    if (live.identity === 'unverifiable') {");
const WSA = lineOf(RET, "return (a.alive && a.sameProcess) || a.identity === 'unverifiable';");
const CANCEL = lineOf(RP, "    if (live.identity === 'unverifiable') {");
const THROW69 = lineOf(RP, '      throw envError(\n'.trimEnd());

// desc 的「⇒」后是计划期预测的红集；实测红集以 mutation-names 的输出为准
const cases = [
  { id: 'M1', desc: 'recordIdentityOf 的判不了改回 different ⇒ U1a、U1b、U2～U8 的新行为格', file: EXEC,
    find: ID_OF, replace: sub(ID_OF, "? 'unverifiable' : 'different'", "? 'different' : 'different'"), expect: SUITE },
  { id: 'M2', desc: '情形 C 删掉判不了分支（回到「!alive 或 !sameProcess 即 pid_gone」）⇒ U3、U8', file: STATUS,
    find: CASE_C, replace: sub(CASE_C, "live.identity !== 'unverifiable' && ", ''), expect: SUITE },
  { id: 'M3', desc: '情形 C 的判不了不走心跳、直接 running ⇒ U3 过期格、U8 过期格', file: STATUS,
    find: CASE_C, replace: "    if (live.identity === 'unverifiable') return { kind: 'running', status: raw };\n" + CASE_C, expect: SUITE },
  { id: 'M4', desc: '情形 A 删掉判不了分支 ⇒ U2', file: STATUS,
    find: CASE_A, replace: sub(CASE_A, " || live.identity === 'unverifiable'", ''), expect: SUITE },
  { id: 'M5', desc: 'workerConfirmedGone 删判不了分支 ⇒ U4、U7、U8 过期格', file: STATUS,
    find: WCG, replace: sub(WCG, "live.identity === 'unverifiable'", 'false'), expect: SUITE },
  { id: 'M6', desc: 'workerStillAlive 删判不了分支 ⇒ U5', file: RET,
    find: WSA, replace: sub(WSA, " || a.identity === 'unverifiable'", ''), expect: SUITE },
  { id: 'M7', desc: 'cancelRun 主路径删判不了分支 ⇒ U6', file: RP,
    find: CANCEL, replace: sub(CANCEL, "live.identity === 'unverifiable'", 'false'), expect: SUITE },
  { id: 'M8', desc: '判不了时退 1 而不是 69 ⇒ U6', file: RP,
    find: THROW69, replace: sub(THROW69, 'throw envError(', 'throw new TriviumError(EXIT.FAIL, '), expect: SUITE },
  { id: 'M9', desc: '规范化且不在那个 return 不补 identity（计划双审 r1 GLM-02）⇒ U1b 不在的规范化格', file: EXEC,
    find: NOT_ALIVE, replace: sub(NOT_ALIVE, 'return withIdentity({', 'return ({'), expect: SUITE },
  { id: 'M10', desc: 'legacy 分支那个 return 不补 identity ⇒ U1b legacy 格、U2、U3 旧版记录格', file: EXEC,
    find: LEGACY_RET, replace: sub(LEGACY_RET, 'return withIdentity({', 'return ({'), expect: SUITE },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [EXEC, STATUS, RET, RP], suites: [SUITE], cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
