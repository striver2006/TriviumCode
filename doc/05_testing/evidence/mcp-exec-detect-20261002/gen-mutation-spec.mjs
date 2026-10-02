// 生成「MCP执行工具调用检测」（EV-188）的源码变异规格（计划 r2 §3.1 变异清单 1～17，§7 更正补的两条，编码时补的五条）：
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/critic-exec-wording-20261002/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件）。
// 集成套件经打包 CLI 跨进程跑，装置与预跑脚本都用 build.mjs --with-tests 重建（含 bundle）。
// 用法（在仓库根）：node doc/05_testing/evidence/mcp-exec-detect-20261002/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TRACE = 'src/trivium/adapters/zcode-trace.ts';
const ZCODE = 'src/trivium/adapters/zcode.ts';
const GUARD = 'src/trivium/guard.ts';
const RENDER = 'src/trivium/render.ts';
const REPORT = 'src/trivium/report.ts';
const REVIEW = 'src/trivium/review.ts';
const S = {
  unit: 'dist/test/test/unit/zcode-mcp-detect.test.js',
  adapter: 'dist/test/test/unit/zcode-mcp-adapter.test.js',
  integ: 'dist/test/test/integration/mcp-detect.test.js',
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

const EXEC_LIST = lineOf(TRACE, "export const ZCODE_MCP_EXEC_PREFIXES: readonly string[] = ['mcp__node_repl__'];");
const IS_MCP = lineOf(TRACE, 'return name.startsWith(ZCODE_MCP_PREFIX);');
const BY_TOOL = lineOf(TRACE, 'byTool[n] = Math.max(ro.length + (unionable ? (logOnly.get(n) ?? 0) : 0), logCounts?.[n] ?? 0);');
const EXTRA = lineOf(TRACE, 'if (extra > 0) execEvents.push(');
const SUMMARY = lineOf(TRACE, 'return redactSecrets(JSON.stringify(input)).content');
const NAMES = lineOf(TRACE, '...new Set([...fromRollout.keys(), ...logOnly.keys(), ...Object.keys(logCounts ?? {}).filter(isZcodeMcp)]),');
const LOG_ID = lineOf(TRACE, 'mcpCallIds[callId] = toolName;');
const UNIONABLE = lineOf(TRACE, 'const unionable = ro.every((c) => c.id.length > 0);');
const Z_WRITE = lineOf(ZCODE, 'writeEvents = [...new Set([...writeEvents, ...mcp.execEvents])];');
const Z_GATE = lineOf(ZCODE, 'if (mcp.total > 0) {');
const Z_TRACE = lineOf(ZCODE, '...(mcp.total > 0 ? { mcpCalls:');
const Z_UNTRUSTED = lineOf(ZCODE, '...(mcp.untrustedTools.length > 0 ? { mcp_untrusted_tools:');
const G_UNTRUSTED = lineOf(GUARD, "...(untrustedTools.length > 0 ? { untrusted: { cause: 'mcp-call' as const, tools: untrustedTools } } : {}),");
const G_SKIP = lineOf(GUARD, 'if (ev.startsWith(MCP_WRITE_EVENT_PREFIX)) return [];');
const G_NOTE = lineOf(GUARD, 'if (v.breachedFiles.some((f) => f.startsWith(MCP_WRITE_EVENT_PREFIX))) {');
const G_WARN = lineOf(GUARD, 'if (s.verification.untrusted) {');
const G_CAUSE_UNTRUSTED = lineOf(GUARD, "...(anyEvidenceUntrusted ? (['evidence-untrusted'] as const) : []),");
const G_CAUSE_EXEC = lineOf(GUARD, "...(anyMcpExec ? (['mcp-exec'] as const) : []),");
const R_FM = lineOf(RENDER, '...(input.verification?.untrusted ? { evidence_untrusted:');
const R_BANNER = lineOf(RENDER, 'if (input.verification?.untrusted) {');
const REP_FLAG = lineOf(REPORT, 'if (d.evidence_untrusted) {');
const RV_RUNJSON = lineOf(REVIEW, '...(verdict.sides[c]!.verification.untrusted');
const RV_RENDER = lineOf(REVIEW, '...(side.verification.untrusted ? { untrusted: side.verification.untrusted } : {}),');

const cases = [
  { id: 'M1', desc: '执行型名单改空', file: TRACE, find: EXEC_LIST, replace: sub(EXEC_LIST, "['mcp__node_repl__']", '[]'), expect: S.unit },
  { id: 'M2', desc: '「是 MCP」不看前缀', file: TRACE, find: IS_MCP, replace: sub(IS_MCP, 'name.startsWith(ZCODE_MCP_PREFIX)', 'name.length > 0'), expect: S.unit },
  { id: 'M3', desc: '计数只取 rollout', file: TRACE, find: BY_TOOL, replace: sub(BY_TOOL, 'Math.max(ro.length + (unionable ? (logOnly.get(n) ?? 0) : 0), logCounts?.[n] ?? 0)', 'ro.length'), expect: S.unit },
  { id: 'M4', desc: '两份来源相加而不是去重', file: TRACE, find: BY_TOOL,
    replace: sub(BY_TOOL, 'Math.max(ro.length + (unionable ? (logOnly.get(n) ?? 0) : 0), logCounts?.[n] ?? 0)', 'ro.length + (logOnly.get(n) ?? 0) + (logCounts?.[n] ?? 0)'), expect: S.unit },
  { id: 'M5', desc: '「会话日志另记 k 次」那支删掉', file: TRACE, find: EXTRA, replace: '', expect: S.unit },
  { id: 'M6', desc: '参数摘要不脱敏', file: TRACE, find: SUMMARY, replace: sub(SUMMARY, 'redactSecrets(JSON.stringify(input)).content', 'JSON.stringify(input)'), expect: S.unit },
  { id: 'M7', desc: '执行型调用不进 write_events', file: ZCODE, find: Z_WRITE, replace: '', expect: S.adapter },
  { id: 'M8', desc: 'mcp 计数键无条件写', file: ZCODE, find: Z_GATE, replace: sub(Z_GATE, 'mcp.total > 0', 'true'), expect: S.adapter },
  { id: 'M9', desc: '证据不可信的条件展开反转', file: GUARD, find: G_UNTRUSTED, replace: sub(G_UNTRUSTED, 'untrustedTools.length > 0', 'untrustedTools.length === 0'), expect: S.unit },
  { id: 'M10', desc: 'breachedAbs 不跳过 MCP: 条目', file: GUARD, find: G_SKIP, replace: '', expect: S.unit },
  { id: 'M11', desc: '失守告警的 MCP 补句删掉', file: GUARD, find: G_NOTE, replace: sub(G_NOTE, 'v.breachedFiles.some((f) => f.startsWith(MCP_WRITE_EVENT_PREFIX))', 'false'), expect: S.unit },
  { id: 'M12', desc: 'front-matter 不渲染 evidence_untrusted', file: RENDER, find: R_FM, replace: '', expect: S.integ },
  { id: 'M13', desc: '报告不推证据不可信旗标', file: REPORT, find: REP_FLAG, replace: sub(REP_FLAG, 'd.evidence_untrusted', 'false'), expect: S.integ },
  { id: 'M14', desc: '文档横幅不出证据不可信那句', file: RENDER, find: R_BANNER, replace: sub(R_BANNER, 'input.verification?.untrusted', 'false'), expect: S.integ },
  { id: 'M15', desc: 'run.json 不写 evidence_untrusted', file: REVIEW, find: RV_RUNJSON, replace: sub(RV_RUNJSON, 'verdict.sides[c]!.verification.untrusted', 'false'), expect: S.integ },
  { id: 'M16', desc: '工具名全集只取 rollout（AGY-02）', file: TRACE, find: NAMES, replace: '    ...new Set([...fromRollout.keys()]),\n', expect: S.unit },
  { id: 'M17', desc: '归因分流去掉证据不可信（AGY-01）', file: GUARD, find: G_CAUSE_UNTRUSTED, replace: '', expect: S.unit },
  // ── 计划 r2 §7 更正与偏离之后补的 ──
  { id: 'M18', desc: '归因分流去掉 MCP 执行型（r2 §7 偏离 2）', file: GUARD, find: G_CAUSE_EXEC, replace: '', expect: S.unit },
  { id: 'M19', desc: '按 id 并集退回按名取大（r2 §7 更正 1）', file: TRACE, find: BY_TOOL,
    replace: sub(BY_TOOL, 'Math.max(ro.length + (unionable ? (logOnly.get(n) ?? 0) : 0), logCounts?.[n] ?? 0)', 'Math.max(ro.length, logCounts?.[n] ?? 0)'), expect: S.unit },
  { id: 'M20', desc: '日志侧不记调用 id', file: TRACE, find: LOG_ID, replace: '', expect: S.unit },
  // ── 编码时补的接线面 ──
  { id: 'M21', desc: '运行时告警不出证据不可信那行', file: GUARD, find: G_WARN, replace: sub(G_WARN, 's.verification.untrusted', 'false'), expect: S.unit },
  { id: 'M22', desc: 'trace.json 不写 mcpCalls 明细', file: ZCODE, find: Z_TRACE, replace: '', expect: S.adapter },
  { id: 'M23', desc: '适配器不产出 mcp_untrusted_tools', file: ZCODE, find: Z_UNTRUSTED, replace: '', expect: S.adapter },
  { id: 'M24', desc: '渲染输入不带 untrusted（横幅与 front-matter 同断）', file: REVIEW, find: RV_RENDER, replace: '', expect: S.integ },
  // ── 代码双审之后追加（GLM-01）──
  { id: 'M25', desc: 'rollout 条目缺 id 时不退回按名取大', file: TRACE, find: UNIONABLE, replace: sub(UNIONABLE, 'ro.every((c) => c.id.length > 0)', 'true'), expect: S.unit },
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
