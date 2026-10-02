// 生成「审查侧实测措辞约束」（EV-95 前半）的源码变异规格（计划 r2 §3.1 ⑤）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/mustread-deny-intersection-20261002/gen-mutation-spec.mjs 的形态。每条只指定一个期望套件（装置每条只收一个套件）。
// 集成套件经打包 CLI 跨进程跑，装置与预跑脚本都用 build.mjs --with-tests 重建（含 bundle）。
// 用法（在仓库根）：node doc/05_testing/evidence/critic-exec-wording-20261002/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BRIEF = 'src/trivium/brief.ts';
const REVIEW = 'src/trivium/review.ts';
const STUB = 'src/trivium/adapters/stub.ts';
const AGY = 'src/trivium/adapters/agy.ts';
const ZCODE = 'src/trivium/adapters/zcode.ts';
const CLAUDE = 'src/trivium/adapters/claude.ts';
const CODEX = 'src/trivium/adapters/codex.ts';
const P_CLAUDE = 'src/trivium/probes/claude.ts';
const P_CODEX = 'src/trivium/probes/codex.ts';
const S = {
  unit: 'dist/test/test/unit/brief-command-execution.test.js',
  parity: 'dist/test/test/unit/command-execution-parity.test.js',
  integ: 'dist/test/test/integration/brief-command-execution.test.js',
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

const PICK = lineOf(BRIEF, 'const evidenceNature = EVIDENCE_NATURE_LINES[commandExecution]');
const SLOT = lineOf(BRIEF, '${evidenceNature}');
const NONE_2 = lineOf(BRIEF, "'第 2 节的焦点若要求实测或复测而你做不到");
const SHELL_1 = lineOf(BRIEF, "'你这一侧可以执行只读命令。");
const WIRE = lineOf(REVIEW, 'commandExecution: adapters[critic]!.commandExecution,');
const STUB_CE = lineOf(STUB, 'commandExecution: spec.commandExecution ??');
const AGY_CE = lineOf(AGY, "commandExecution: 'none',");
const ZCODE_CE = lineOf(ZCODE, "commandExecution: 'none',");
const CLAUDE_CE = lineOf(CLAUDE, "commandExecution: 'none',");
const CODEX_CE = lineOf(CODEX, "commandExecution: 'readonly-shell',");
const DENY = lineOf(ZCODE, 'export const ZCODE_READONLY_DENYLIST =');
const TOOLS = lineOf(P_CLAUDE, "const READONLY_TOOLS = 'Read,Grep,Glob';");
// 代码双审 CODEX-01 之后追加：claude 侧的两个安全旗标。lineOf 按「行含 needle」找，这里要整行精确匹配，单独截
function exactLine(file, line) {
  const hits = read(file).split('\n').filter((l) => l === line);
  if (hits.length !== 1) throw new Error(`${file} 里恰为「${line}」的行有 ${hits.length} 行（应为 1）`);
  return line + '\n';
}
const RESTRICTED = exactLine(P_CLAUDE, '  RESTRICTED_FLAG,');
const STRICT_MCP = exactLine(P_CLAUDE, '  STRICT_MCP_CONFIG_FLAG,');
const SANDBOX = lineOf(P_CODEX, "export const CODEX_READONLY_INVARIANTS: readonly string[] = ['-s', 'read-only'];");

const cases = [
  { id: 'M1', desc: '第 7 节恒取不能执行命令的说法', file: BRIEF, find: PICK,
    replace: sub(PICK, 'EVIDENCE_NATURE_LINES[commandExecution]', "EVIDENCE_NATURE_LINES['none']"), expect: S.unit },
  { id: 'M2', desc: '第 7 节恒取只读 shell 的说法', file: BRIEF, find: PICK,
    replace: sub(PICK, 'EVIDENCE_NATURE_LINES[commandExecution]', "EVIDENCE_NATURE_LINES['readonly-shell']"), expect: S.unit },
  { id: 'M3', desc: '不能执行命令的说法少了「不要停下来等放行」那一条', file: BRIEF, find: NONE_2,
    replace: '', expect: S.unit },
  { id: 'M4', desc: '只读 shell 的说法不要求写出本轮实际执行的命令', file: BRIEF, find: SHELL_1,
    replace: sub(SHELL_1, '`evidence` 里写出你本轮实际执行的命令', '`evidence` 里写出依据'), expect: S.unit },
  { id: 'M5', desc: '第 7 节不渲染证据性质那一条', file: BRIEF, find: SLOT,
    replace: '', expect: S.unit },
  { id: 'M6', desc: '接线改按轨迹形状推导', file: REVIEW, find: WIRE,
    replace: sub(WIRE, 'adapters[critic]!.commandExecution',
      "(adapters[critic]!.capability.traceShape === 'command-trace' ? 'readonly-shell' : 'none')"), expect: S.integ },
  { id: 'M7', desc: '接线硬编码不能执行命令', file: REVIEW, find: WIRE,
    replace: sub(WIRE, 'adapters[critic]!.commandExecution', "'none'"), expect: S.integ },
  { id: 'M8', desc: 'agy 声明翻成只读 shell', file: AGY, find: AGY_CE,
    replace: sub(AGY_CE, "'none'", "'readonly-shell'"), expect: S.parity },
  { id: 'M9', desc: 'zcode 声明翻成只读 shell', file: ZCODE, find: ZCODE_CE,
    replace: sub(ZCODE_CE, "'none'", "'readonly-shell'"), expect: S.parity },
  { id: 'M10', desc: 'claude 声明翻成只读 shell', file: CLAUDE, find: CLAUDE_CE,
    replace: sub(CLAUDE_CE, "'none'", "'readonly-shell'"), expect: S.parity },
  { id: 'M11', desc: 'codex 声明翻成不能执行命令', file: CODEX, find: CODEX_CE,
    replace: sub(CODEX_CE, "'readonly-shell'", "'none'"), expect: S.parity },
  { id: 'M12', desc: '桩缺省不看 mode（恒为不能执行命令）', file: STUB, find: STUB_CE,
    replace: sub(STUB_CE, "(spec.mode === 'command_trace' ? 'readonly-shell' : 'none')", "'none'"), expect: S.unit },
  { id: 'M13', desc: '桩忽略显式覆盖', file: STUB, find: STUB_CE,
    replace: sub(STUB_CE, 'spec.commandExecution ?? ', ''), expect: S.unit },
  { id: 'M14', desc: 'zcode 禁用名单去掉 Bash（声明不跟）', file: ZCODE, find: DENY,
    replace: sub(DENY, 'NotebookEdit,Bash,WebFetch', 'NotebookEdit,WebFetch'), expect: S.parity },
  { id: 'M15', desc: 'claude 工具白名单加上 Bash（声明不跟）', file: P_CLAUDE, find: TOOLS,
    replace: sub(TOOLS, "'Read,Grep,Glob'", "'Read,Grep,Glob,Bash'"), expect: S.parity },
  { id: 'M16', desc: 'claude 工具白名单加一个未分类的工具', file: P_CLAUDE, find: TOOLS,
    replace: sub(TOOLS, "'Read,Grep,Glob'", "'Read,Grep,Glob,LS'"), expect: S.parity },
  { id: 'M17', desc: 'codex 沙箱参数改成 workspace-write（声明不跟）', file: P_CODEX, find: SANDBOX,
    replace: sub(SANDBOX, "'read-only'", "'workspace-write'"), expect: S.parity },
  // ── 代码双审 r1 之后追加（CODEX-01）──
  { id: 'M18', desc: 'claude 不变量删掉 --restricted（白名单不动）', file: P_CLAUDE, find: RESTRICTED,
    replace: '', expect: S.parity },
  { id: 'M19', desc: 'claude 不变量删掉 --strict-mcp-config（白名单不动）', file: P_CLAUDE, find: STRICT_MCP,
    replace: '', expect: S.parity },
];

// 每条 find 在目标文件中恰好一处（装置闸 7 同口径，这里先核一遍）；替换串里不许有 String.replace 的特殊替换模式
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
