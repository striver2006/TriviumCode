// 生成「任务书点名禁用MCP执行工具」（EV-191 缓解①）的源码变异规格（计划 r2 §3.1 ⑤ M1～M12，编码时补 M13～M14，代码双审后补 M15）：
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/mcp-exec-detect-20261002/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件）。
// 集成套件经打包 CLI 跨进程跑，装置与预跑脚本都用 build.mjs --with-tests 重建（含 bundle）。
// 用法（在仓库根）：node doc/05_testing/evidence/brief-mcp-exec-ban-20261002/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BRIEF = 'src/trivium/brief.ts';
const REVIEW = 'src/trivium/review.ts';
const ZCODE = 'src/trivium/adapters/zcode.ts';
const STUB = 'src/trivium/adapters/stub.ts';
const TRACE = 'src/trivium/adapters/zcode-trace.ts';
const S = {
  unit: 'dist/test/test/unit/brief-mcp-exec.test.js',
  integ: 'dist/test/test/integration/brief-mcp-exec.test.js',
};

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

const B_CALL = lineOf(BRIEF, 'const mcpBan = mcpExecBanLine(mcpExecPrefixes);');
const B_EMPTY = lineOf(BRIEF, 'if (prefixes.length === 0) return null;');
const B_FOCUS = lineOf(BRIEF, "'**不要调用它们，焦点要求也不行**：");
const B_NAMES = lineOf(BRIEF, 'const names = prefixes.map((p) =>');
const B_JOIN = lineOf(BRIEF, ": `${names.slice(0, -1).join('、')} 或 ${names[names.length - 1]!}`;");
const B_TAIL = lineOf(BRIEF, "'需要运行才能确认的内容，按上一条的要求处理。'");
const B_ORDER = lineOf(BRIEF, 'const evidenceNature = [...EVIDENCE_NATURE_LINES[commandExecution], ...(mcpBan !== null ? [mcpBan] : [])]');
const RV_WIRE = lineOf(REVIEW, 'mcpExecPrefixes: adapters[critic]!.mcpExecPrefixes ?? [],');
const Z_DECL = lineOf(ZCODE, 'mcpExecPrefixes: ZCODE_MCP_EXEC_PREFIXES,');
const T_LIST = lineOf(TRACE, "export const ZCODE_MCP_EXEC_PREFIXES: readonly string[] = ['mcp__node_repl__'];");
const ST_OVER = lineOf(STUB,'...(spec.mcpExecPrefixes !== undefined ? { mcpExecPrefixes: spec.mcpExecPrefixes } : {}),');

const cases = [
  { id: 'M1', desc: '渲染恒不出点名禁令', file: BRIEF, find: B_CALL, replace: sub(B_CALL, 'mcpExecBanLine(mcpExecPrefixes)', '(null as string | null)'), expect: S.unit },
  { id: 'M2', desc: '空数组也渲染', file: BRIEF, find: B_EMPTY, replace: '', expect: S.unit },
  { id: 'M3', desc: '禁令去掉「焦点要求也不行」', file: BRIEF, find: B_FOCUS, replace: sub(B_FOCUS, '，焦点要求也不行', ''), expect: S.unit },
  { id: 'M4', desc: '前缀写死成字面而不取入参', file: BRIEF, find: B_NAMES, replace: "  const names = ['`mcp__node_repl__`'];\n", expect: S.unit },
  { id: 'M5', desc: '禁令插到证据性质条目之前', file: BRIEF, find: B_ORDER,
    replace: sub(B_ORDER, '[...EVIDENCE_NATURE_LINES[commandExecution], ...(mcpBan !== null ? [mcpBan] : [])]', '[...(mcpBan !== null ? [mcpBan] : []), ...EVIDENCE_NATURE_LINES[commandExecution]]'), expect: S.unit },
  { id: 'M6', desc: 'review.ts 接线恒传空', file: REVIEW, find: RV_WIRE, replace: sub(RV_WIRE, 'adapters[critic]!.mcpExecPrefixes ?? []', '[]'), expect: S.integ },
  { id: 'M7', desc: 'review.ts 接线恒传 zcode 名单', file: REVIEW, find: RV_WIRE, replace: sub(RV_WIRE, 'adapters[critic]!.mcpExecPrefixes ?? []', "['mcp__node_repl__']"), expect: S.integ },
  { id: 'M8', desc: 'zcode 声明删掉', file: ZCODE, find: Z_DECL, replace: '', expect: S.unit },
  { id: 'M9', desc: 'zcode 声明改成复制的字面数组', file: ZCODE, find: Z_DECL, replace: sub(Z_DECL, 'ZCODE_MCP_EXEC_PREFIXES', "['mcp__node_repl__']"), expect: S.unit },
  { id: 'M10', desc: '桩忽略显式覆盖（单测层）', file: STUB, find: ST_OVER, replace: '', expect: S.unit },
  { id: 'M11', desc: '桩缺省就声明', file: STUB, find: ST_OVER, replace: "    mcpExecPrefixes: spec.mcpExecPrefixes ?? ['mcp__node_repl__'],\n", expect: S.unit },
  { id: 'M12', desc: '多前缀连接词改回顿号', file: BRIEF, find: B_JOIN, replace: sub(B_JOIN, ' 或 ', '、'), expect: S.unit },
  // ── 编码时补的 ──
  { id: 'M13', desc: '桩忽略显式覆盖（集成层）', file: STUB, find: ST_OVER, replace: '', expect: S.integ },
  { id: 'M14', desc: '禁令句尾去掉「按上一条的要求处理」', file: BRIEF, find: B_TAIL, replace: "    '';\n", expect: S.unit },
  // ── 代码双审之后追加（GLM-01）──
  { id: 'M15', desc: '执行型名单项混进反引号（前缀形状坏）', file: TRACE, find: T_LIST, replace: sub(T_LIST, "['mcp__node_repl__']", "['mcp__node_repl__`']"), expect: S.unit },
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
console.log(`${cases.length} 条，写入 ${OUT}`);
