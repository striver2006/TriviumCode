// 生成「收工闸门文案区分只读失守」（EV-98 文案部分）的源码变异规格（计划 r2 §3.3 M1～M14，编码时补 M15～M18，代码双审后补 M19～M20）：
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/brief-mcp-exec-ban-20261002/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件）。
// 集成套件经打包 CLI 跨进程跑，装置与预跑脚本都用 build.mjs --with-tests 重建（含 bundle）。
// 用法（在仓库根）：node doc/05_testing/evidence/breach-gate-wording-20261002/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const HOOKS = 'src/trivium/hooks.ts';
const GATE = 'src/trivium/gate.ts';
const S = {
  hooks: 'dist/test/test/unit/hooks.test.js',
  gate: 'dist/test/test/unit/gate.test.js',
  integ: 'dist/test/test/integration/gate-loop.test.js',
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

const H_BREACH = blockOf(HOOKS, 'return meta?.guard.readonly_breach === true ? { g, meta } : null;');
const H_READ = blockOf(HOOKS, "const { readRunMeta } = await import('./meta.js');", 2);
const H_NULLRUN = blockOf(HOOKS, 'if (!g.run_id) return null;');
const H_DSLICE = blockOf(HOOKS, "d.files.slice(0, 8).join('、') +");
const H_STOP_B = blockOf(HOOKS, '  if (breached.length > 0) {\n'.trimEnd());
const H_COMMIT_B = blockOf(HOOKS, '// 未见失守：与改前逐字相同', 1);
const H_EXC_B = blockOf(HOOKS, '    let msg: string;', 2);
const H_NLIST = blockOf(HOOKS, "const nList = normal.map(gateLabel).join('、');");
const H_EXIT = blockOf(HOOKS, '出口：由用户决定用', 2);
const H_CLOSE = blockOf(HOOKS, '...(await breachLines(breached, \'  \')),\n      `  如需关闭该拦截'.split('\n')[0], 2);
const H_CODE = blockOf(HOOKS, "return { exitCode: EXIT.GATE_BLOCK, stderr: lines.join('\\n') };");
const H_EXC_N = blockOf(HOOKS, "...(normal.length > 0 ? [`  ${normal.map(gateLabel).join('、')} 的裁决仍未齐备，请手工处理。`] : []),");
const H_STDERR = blockOf(HOOKS, 'stderr.push(`还有未逐条裁决的审查意见：${nList}`, `另有阶段本轮审查记录到只读失守：${bList}`);');
const H_DRIFT = blockOf(HOOKS, "if (!d.changed) return '未检出");
const H_ONLY = blockOf(HOOKS, '（只针对上列阶段；下列只读失守的阶段另行处置，它们的 gate --check 不会通过）。');
const H_RERUN = blockOf(HOOKS, '`${indent}不论确有改动要清理后重跑，还是核实为误报想重跑，都须先作废这一轮：`', 2);
const G_SLICE = blockOf(GATE, "return files.length > 0 ? files.slice(0, 8).join('、')");
const G_TRIAGE = blockOf(GATE, "'还须核调用记录本身是否真的写入、目标是否存在、是否被 ignore，确认后再按 BACKLOG EV-75 登记重跑。';");

// H_CLOSE 应恰好是「失守段展开 + 关闭方式」两行（提交 Hook 失守分支）
if (!H_CLOSE.includes('如需关闭该拦截')) throw new Error('H_CLOSE 锚点没取到关闭方式那一行');
// H_COMMIT_B 是提交 Hook「未见失守」分支的注释行；变异把它前一行的条件恒真，这里取「条件 + 注释」两行
const H_COMMIT_IF = blockOf(HOOKS, '    if (breached.length === 0) {\n      // 未见失守'.split('\n')[0], 2);
if (!H_COMMIT_IF.includes('// 未见失守')) throw new Error('H_COMMIT_IF 应取到提交 Hook 那一处');

const cases = [
  { id: 'M1', desc: '判据放宽为「不是 false 就算失守」（读不出也算）', file: HOOKS, find: H_BREACH,
    replace: sub(H_BREACH, 'meta?.guard.readonly_breach === true', 'meta?.guard.readonly_breach !== false'), expect: S.hooks },
  { id: 'M2', desc: '改用 latestRunMeta 取最新而不按闸门项 run_id 直读', file: HOOKS, find: H_READ,
    replace: "  const { latestRunMeta } = await import('./meta.js');\n" +
      '  const meta = (await latestRunMeta({ archiveRoot: ctx.archiveRoot, topic: g.topic }, g.stage)).meta;\n', expect: S.hooks },
  { id: 'M3', desc: '收工拦截忽略失守（恒走原文案）', file: HOOKS, find: H_STOP_B,
    replace: sub(H_STOP_B, 'breached.length > 0', 'false'), expect: S.hooks },
  { id: 'M4', desc: '提交 Hook 忽略失守（恒走原文案）', file: HOOKS, find: H_COMMIT_IF,
    replace: sub(H_COMMIT_IF, 'breached.length === 0', 'true'), expect: S.hooks },
  { id: 'M5', desc: '阻断上限忽略失守（恒走原两句）', file: HOOKS, find: H_EXC_B,
    replace: sub(H_EXC_B, 'breached.length === 0', 'true'), expect: S.hooks },
  { id: 'M6', desc: '混合时原句列全部待裁决项', file: HOOKS, find: H_NLIST,
    replace: sub(H_NLIST, 'normal.map(gateLabel)', 'pending.map(gateLabel)'), expect: S.hooks },
  { id: 'M7', desc: '调用记录截断改 9 条', file: GATE, find: G_SLICE,
    replace: sub(G_SLICE, 'files.slice(0, 8)', 'files.slice(0, 9)'), expect: S.hooks },
  { id: 'M8', desc: '逐项段漏作废命令', file: HOOKS, find: H_EXIT, replace: '', expect: S.hooks },
  { id: 'M9', desc: '提交失守段漏关闭方式', file: HOOKS, find: H_CLOSE,
    replace: H_CLOSE.split('\n')[0] + '\n', expect: S.hooks },
  { id: 'M10', desc: '提交 Hook 失守时退出码改 0', file: HOOKS, find: H_CODE,
    replace: sub(H_CODE, 'EXIT.GATE_BLOCK', 'EXIT.OK'), expect: S.hooks },
  { id: 'M11', desc: '阻断上限混合时丢掉未裁决项', file: HOOKS, find: H_EXC_N, replace: '', expect: S.hooks },
  { id: 'M12', desc: '混合时 stderr 只取原首句', file: HOOKS, find: H_STDERR,
    replace: sub(H_STDERR, ', `另有阶段本轮审查记录到只读失守：${bList}`', ''), expect: S.hooks },
  { id: 'M13', desc: '作废命令写死斜杠写法', file: HOOKS, find: H_EXIT,
    replace: sub(H_EXIT, "${entryCommandOf(meta.driver, 'dual-abandon')}", '/dual-abandon'), expect: S.hooks },
  { id: 'M14', desc: '快照漂移恒写「未检出」', file: HOOKS, find: H_DRIFT,
    replace: sub(H_DRIFT, 'if (!d.changed)', 'if (true)'), expect: S.hooks },
  // ── 编码时补的 ──
  { id: 'M15', desc: '混合时指引句漏「只针对上列阶段」补句', file: HOOKS, find: H_ONLY,
    replace: sub(H_ONLY, '（只针对上列阶段；下列只读失守的阶段另行处置，它们的 gate --check 不会通过）', ''), expect: S.hooks },
  { id: 'M16', desc: '闸门项一律判未失守（接线断）——集成层', file: HOOKS, find: H_NULLRUN,
    replace: sub(H_NULLRUN, 'if (!g.run_id) return null;', 'return null;'), expect: S.integ },
  { id: 'M17', desc: '共用处置句措辞漂移（gate 输出改变）', file: GATE, find: G_TRIAGE,
    replace: sub(G_TRIAGE, '确认后再按 BACKLOG EV-75 登记重跑。', '确认后再登记重跑。'), expect: S.gate },
  { id: 'M18', desc: '漏「重跑须先作废」那一行（计划 r2 §7）', file: HOOKS, find: H_RERUN, replace: '', expect: S.hooks },
  // ── 代码双审之后追加 ──
  { id: 'M19', desc: '快照漂移文件截断改 9 个（GLM-01）', file: HOOKS, find: H_DSLICE,
    replace: sub(H_DSLICE, 'd.files.slice(0, 8)', 'd.files.slice(0, 9)'), expect: S.hooks },
  { id: 'M20', desc: '无 run_id 守卫只判 null（CODEX-02）', file: HOOKS, find: H_NULLRUN,
    replace: sub(H_NULLRUN, 'if (!g.run_id) return null;', 'if (g.run_id === null) return null;'), expect: S.hooks },
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
