// 生成「claude 思考等级续行解析」（M11 第 6 步跟进修复，计划 r2 §3.3）的变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/m11-effort-wiring-20261008/gen-mutation-spec.mjs 的形态；只含 probes/claude.ts 一个目标、effort-wiring 单测一个套件。
// N1～N4 是本次新增（拼接本身与三条终止条件）；M14 / M17 是第 6 步的两条，锚点随 line ⇒ text 重截后重跑。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-effort-continuation-20261008/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROBE = 'src/trivium/probes/claude.ts';
const UNIT = 'dist/test/test/unit/effort-wiring.test.js';

/** 从含 needle 的那一行起取 n 行，核在文件里恰好一处 */
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
const one = (id, desc, file, find, replace, expect) => ({ id, desc, file, find, replace, expect });

const LOOP = blockOf(PROBE, 'for (let i = at + 1; i < lines.length; i++) {');
const TOP = blockOf(PROBE, 'if (!/^\\s/.test(l)) break;');
const STOP = blockOf(PROBE, "if (t === '' || t.startsWith('-')) break;");
const P_PAREN = blockOf(PROBE, 'if (open < 0 || close < 0) return null;');
const P_OPEN = blockOf(PROBE, "const open = text.indexOf('(');");

const cases = [
  one('N1', '不拼续行（循环立即退出，只看锚点行——第 6 步首版的行为）', PROBE, LOOP, sub(LOOP, 'i < lines.length', 'i < at + 1'), UNIT),
  one('N2', '拼接不止于选项行（越过下一个选项去拿它的括号）', PROBE, STOP, sub(STOP, " || t.startsWith('-')", ''), UNIT),
  one('N3', '拼接不止于空行（含纯空白行）', PROBE, STOP, sub(STOP, "t === '' || ", ''), UNIT),
  one('N4', '拼接不止于顶格行（段标题之后的缩进行也拼入）', PROBE, TOP, sub(TOP, 'if (!/^\\s/.test(l)) break;', '// 顶格判据被删'), UNIT),
  one('M14', 'parseEffortLevels 解析不出时落 []（错枚举：把「取不到」说成「没有这个旗标」）', PROBE, P_PAREN, sub(P_PAREN, 'return null;', 'return [];'), UNIT),
  one('M17', 'parseEffortLevels 改回取最后一对括号（计划三审 CODEX-02）', PROBE, P_OPEN, sub(P_OPEN, "text.indexOf('(')", "text.lastIndexOf('(')"), UNIT),
];

for (const c of cases) {
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的替换串含特殊替换模式`);
  const src = read(c.file);
  if (src.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
  if (c.find === c.replace) throw new Error(`${c.id} 替换前后相同`);
}
fs.writeFileSync(OUT, JSON.stringify({ targets: [PROBE], suites: [UNIT], cases }, null, 2) + '\n');
console.log(`${cases.length} 条`);
