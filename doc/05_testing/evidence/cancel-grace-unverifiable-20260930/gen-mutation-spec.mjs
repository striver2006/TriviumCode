// 生成「取消宽限期判不了仍放锁」（EV-176）的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/unverifiable-start-20260930/gen-mutation-spec.mjs 的形态；多行锚点用 block() 从唯一起始行往下截 n 行。
// 用法（在仓库根）：node gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const EXEC = 'src/trivium/util/exec.ts';
const RP = 'src/trivium/run-protocol.ts';
const SUITE = 'dist/test/test/integration/cancel-grace-unverifiable.test.js';

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
/** 从含 needle 的唯一一行起往下截 n 行（含换行） */
function block(file, needle, n) {
  const lines = read(file).split('\n');
  const at = lines.map((l, i) => (l.includes(needle) ? i : -1)).filter((i) => i >= 0);
  if (at.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${at.length} 行（应为 1）`);
  return lines.slice(at[0], at[0] + n).join('\n') + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const PRECHECK = lineOf(EXEC, 'if ((await judge()) === true) return { gone: true, escalated: false, signals };');
const PRE_UNVER = block(EXEC, '// 首检判不了：一个信号都不发（EV-176 零信号格）', 2);
const POLL = lineOf(EXEC, 'if ((await judge()) === true) return true;');
const GRACE_UNVER = block(EXEC, '// 宽限期满最后一次仍判不了：不升级 SIGKILL', 2);
const UNCONFIRMED = lineOf(EXEC, 'lastUnverifiable() ? { gone: false, escalated, signals, unverifiable: true } : { gone: false, escalated, signals };');
const KILLWAIT = lineOf(RP, '        killWaitMs: ORPHAN_KILL_CONFIRM_MS,');
const NOT_GONE = lineOf(RP, 'if (!t.gone) throw envError(unconfirmedCancelMessage(pid, runId, t));');
const ZERO = lineOf(RP, 'if (!t.gone && t.signals.length === 0) throw envError(unverifiableCancelMessage(pid, runId));');
const WGFC = lineOf(RP, "if (p.identity === 'unverifiable') return 'unverifiable';");
const CLI_GATE = lineOf(RP, 'if (t.escalated || t.unverifiable) {');
const TERM_CALL = block(RP, '      const t = await terminateProcessGroup(pid, {', 6);
if (!TERM_CALL.includes('onTerm: () => step(`向工作进程组 ${pid} 发送 SIGTERM`),')) throw new Error('TERM_CALL 块里没截到 onTerm 那一行');

// desc 的「⇒」后是计划期预测的红集；实测红集以 mutation-names 的输出为准
const cases = [
  { id: 'M1', desc: '首检把判不了当已退出 ⇒ T1、K-Z1', file: EXEC,
    find: PRECHECK, replace: sub(PRECHECK, '=== true', '!== false'), expect: SUITE },
  { id: 'M2', desc: '首检忽略判不了、照发 SIGTERM ⇒ T1、K-Z1', file: EXEC,
    find: PRE_UNVER, replace: PRE_UNVER.split('\n')[0] + '\n', expect: SUITE },
  { id: 'M3', desc: '宽限期轮询把判不了当已退出 ⇒ T2、T3、K-G1、K-G2、K-G3', file: EXEC,
    find: POLL, replace: sub(POLL, '=== true', '!== false'), expect: SUITE },
  { id: 'M4', desc: '宽限期满判不了仍升级 SIGKILL ⇒ T3、K-G2', file: EXEC,
    find: GRACE_UNVER, replace: GRACE_UNVER.split('\n')[0] + '\n', expect: SUITE },
  { id: 'M5', desc: '主路径 SIGKILL 之后改回不等（killWaitMs 0）⇒ K-K3', file: RP,
    find: KILLWAIT, replace: sub(KILLWAIT, 'ORPHAN_KILL_CONFIRM_MS', '0'), expect: SUITE },
  { id: 'M6', desc: '删掉「未确认 ⇒ 不收尾」⇒ K-G2、K-K1、K-K4', file: RP,
    find: NOT_GONE, replace: '', expect: SUITE },
  { id: 'M7', desc: '未确认时退 1 而不是 69 ⇒ K-G2、K-K1、K-K4', file: RP,
    find: NOT_GONE, replace: sub(NOT_GONE, 'throw envError(', 'throw new TriviumError(EXIT.FAIL, '), expect: SUITE },
  { id: 'M8', desc: 'workerGoneForCancel 不读 identity ⇒ W1、K-Z1、K-G2', file: RP,
    find: WGFC, replace: '', expect: SUITE },
  { id: 'M9', desc: '「发送 SIGTERM」播报挪回调用之前 ⇒ K-Z1', file: RP,
    find: TERM_CALL,
    replace: '      step(`向工作进程组 ${pid} 发送 SIGTERM`);\n' + TERM_CALL.replace('        onTerm: () => step(`向工作进程组 ${pid} 发送 SIGTERM`),\n', ''),
    expect: SUITE },
  { id: 'M10', desc: '升级 SIGKILL 而未确认时跳过按记录结束 CLI ⇒ K-K1', file: RP,
    find: CLI_GATE, replace: sub(CLI_GATE, 't.escalated || t.unverifiable', '(t.escalated && t.gone) || (t.unverifiable && !t.escalated)'), expect: SUITE },
  { id: 'M11', desc: '未确认时不置 unverifiable ⇒ T1、T3、T5、K-G2、K-K4', file: EXEC,
    find: UNCONFIRMED, replace: '    ({ gone: false, escalated, signals });\n', expect: SUITE },
  { id: 'M12', desc: '扣下 SIGKILL 时跳过按记录结束 CLI ⇒ K-G2', file: RP,
    find: CLI_GATE, replace: sub(CLI_GATE, 't.escalated || t.unverifiable', 't.escalated'), expect: SUITE },
  { id: 'M13', desc: '零信号格不按入口格处置（落到发过信号的正文）⇒ K-Z1', file: RP,
    find: ZERO, replace: '', expect: SUITE },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [EXEC, RP], suites: [SUITE], cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
