// 生成「解析回退逐条降级」的源码变异规格（计划 r2 §5.4）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/cancel-grace-unverifiable-20260930/gen-mutation-spec.mjs 的形态；多行锚点用 block() 从唯一起始行往下截 n 行。
// 用法（在仓库根）：node gen-mutation-spec.mjs 〈输出路径〉
//
// 计划 §5.4 的「还原条件去掉『只在解析失败时』」**不列**：合法 JSON 里不存在非法转义，还原对它是恒等变换，
// 这条变异与原码在任何输入上行为相同（等价变异），装置判不出——报告如实登记。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PARSE = 'src/trivium/parse.ts';
const REVIEW = 'src/trivium/review.ts';
const GATE = 'src/trivium/gate.ts';
const BRIEF = 'src/trivium/brief.ts';
const RENDER = 'src/trivium/render.ts';
const PS = 'dist/test/test/unit/parse-degrade.test.js';
const GS = 'dist/test/test/unit/gate-degrade.test.js';
const RS = 'dist/test/test/unit/render-degrade.test.js';
const BS = 'dist/test/test/unit/brief-output-contract.test.js';
const FI = 'dist/test/test/integration/fault-injection.test.js';

function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
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

const U_BRANCH = block(PARSE, "if (next === 'u' && /^[0-9a-fA-F]{4}$/", 5);
if (!U_BRANCH.trimEnd().endsWith('}')) throw new Error('U_BRANCH 没截到收尾花括号');
const U_COND = lineOf(PARSE, "if (next === 'u' && /^[0-9a-fA-F]{4}$/");
const ECHO_LINE = lineOf(PARSE, "'duration_s', 'tool_calls', 'evidence_ok', 'findings_count', 'findings_degraded'");
const ROOT_CHECK = lineOf(PARSE, 'if (!Array.isArray(findings) || !rootOk) {');
const DEGRADE_PUSH = lineOf(PARSE, 'degraded.push({ index, id, problems, raw: f as Record<string, unknown> });');
const COVER = block(PARSE, 'if (chosen.ids.every((id) => mine.has(id))) {', 2);
const RANK = lineOf(PARSE, 'if (!deepest || v.rank > deepest.rank) deepest = v;');
// r1：GLM-01 之后第三参是降级意见本身
const ALL_IDS = lineOf(PARSE, 'const allIds = [...review.findings.map((f) => f.id), ...degraded.map((d) => d.id)];');
const EMPTY = lineOf(REVIEW, 'empty_review: reviews[c] ? reviews[c]!.findings.length === 0 && (degraded[c] ?? []).length === 0 : false,');
const FD = lineOf(REVIEW, 'findings_degraded: (degraded[c] ?? []).map((d) => d.id),');
const IDS_SET = lineOf(GATE, 'const idsSet = new Set([...structuredIds, ...degradedIds]);');
const COUNT = lineOf(GATE, 'const expectedCount = structuredIds.length + (expectedFallback?.length ?? 0) + degradedIds.length;');
const RETRY = lineOf(GATE, 'if (retry?.ok && retry.degraded.length === 0 && prefixOk) {');
const ZCODE = lineOf(BRIEF, "CRITIC_VENDOR[critic] === 'zcode'");
const SECTION = lineOf(RENDER, 'if (nDegraded > 0) parts.push(renderDegradedSection(input.degradedFindings!));');
const REVIEWER_REPAIRS = lineOf(RENDER, 'return r.unescaped_backslashes > 0 || r.stripped_fields.some((k) => !vendor.has(k));');
// 代码双审 r1 接受项的新判据（r1 追加）
const PER_FINDING = lineOf(PARSE, '    findingsOfFirstObject(rawText) ??');
const DEGRADED_EVIDENCE = lineOf(PARSE, "    ...degraded.map((d) => d.raw['evidence']).filter((e): e is string => typeof e === 'string'),");
const PIPE_ESCAPE = lineOf(RENDER, "      v = v.replace(/\\|/g, '\\\\|');");
const TYPE_OF = lineOf(BRIEF, '    if (!p?.type) return null;');
const FM_DEGRADED = lineOf(RENDER, '...(degradedCount(input) > 0 ? { findings_degraded: input.degradedFindings!.map((d) => d.id) } : {}),');
const CONSULTED_UNVERIFIED = lineOf(RENDER, '    ...(input.consultedUnverified ? { consulted_unverified: true } : {}),');

// desc 的「⇒」后是计划期预测的红集；实测红集以 mutation-names 的输出为准
const cases = [
  { id: 'M1', desc: '还原删掉「u 加四位十六进制原样」分支 ⇒ P5‴', file: PARSE, find: U_BRANCH, replace: '', expect: PS },
  { id: 'M2', desc: '还原对 u 不核四位十六进制 ⇒ P5′', file: PARSE,
    find: U_COND, replace: sub(U_COND, " && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))", ''), expect: PS },
  { id: 'M3', desc: '回显清单删 evidence_ok ⇒ P1、P9', file: PARSE,
    find: ECHO_LINE, replace: sub(ECHO_LINE, "'evidence_ok', ", ''), expect: PS },
  { id: 'M4', desc: '根校验不要求 findings 是数组 ⇒ P11', file: PARSE,
    find: ROOT_CHECK, replace: sub(ROOT_CHECK, '!Array.isArray(findings) || ', ''), expect: PS },
  { id: 'M5', desc: '逐条降级退回整份判死（降级一律当编号不可用）⇒ P7、P7′、P10③ 等', file: PARSE,
    find: DEGRADE_PUSH, replace: "    unaddressable.push('x');\n", expect: PS },
  { id: 'M6', desc: '选取不看覆盖、首个全合格即替换 ⇒ P10②', file: PARSE,
    find: COVER, replace: sub(COVER, 'if (chosen.ids.every((id) => mine.has(id))) {', 'if (true) {'), expect: PS },
  { id: 'M7', desc: '替换候选时沿用前一候选的修复（跨候选累加的形态）⇒ P13', file: PARSE,
    find: COVER, replace: sub(COVER, 'chosen = { ...v, from: cand.from };', 'chosen = { ...v, repairs: chosen.repairs, from: cand.from };'), expect: PS },
  { id: 'M8', desc: '回退成因取最后一个而非走得最远 ⇒ P11', file: PARSE,
    find: RANK, replace: sub(RANK, 'if (!deepest || v.rank > deepest.rank) deepest = v;', 'deepest = v;'), expect: PS },
  { id: 'M9', desc: '完整性校验不看降级编号 ⇒ P12', file: PARSE,
    find: ALL_IDS, replace: '  const allIds = review.findings.map((f) => f.id);\n', expect: PS },
  { id: 'M10', desc: 'empty_review 退回只数合格意见 ⇒ I2', file: REVIEW,
    find: EMPTY, replace: '      empty_review: (reviews[c]?.findings.length ?? -1) === 0,\n', expect: FI },
  { id: 'M11', desc: 'run.json 不记降级编号 ⇒ I1、I2', file: REVIEW,
    find: FD, replace: sub(FD, '(degraded[c] ?? []).map((d) => d.id)', '[]'), expect: FI },
  { id: 'M12', desc: 'gate 期望集漏并降级编号 ⇒ G1、G2', file: GATE,
    find: IDS_SET, replace: '  const idsSet = new Set(structuredIds);\n', expect: GS },
  { id: 'M13', desc: 'gate 空表守卫漏计降级编号 ⇒ G4', file: GATE,
    find: COUNT, replace: sub(COUNT, ' + degradedIds.length', ''), expect: GS },
  { id: 'M14', desc: '重试把部分合格当成功 ⇒ G10、G10′', file: GATE,
    find: RETRY, replace: sub(RETRY, ' && retry.degraded.length === 0', ''), expect: GS },
  { id: 'M15', desc: '重试不核前缀归属 ⇒ G11', file: GATE,
    find: RETRY, replace: sub(RETRY, ' && prefixOk', ''), expect: GS },
  { id: 'M16', desc: 'ExitPlanMode 一句的厂商条件取反 ⇒ B3', file: BRIEF,
    find: ZCODE, replace: sub(ZCODE, "=== 'zcode'", "!== 'zcode'"), expect: BS },
  { id: 'M17', desc: '不渲染不合格意见一节 ⇒ R4', file: RENDER, find: SECTION, replace: '', expect: RS },
  { id: 'M18', desc: '厂商字段的剥离也挂横幅与 front-matter ⇒ R2', file: RENDER,
    find: REVIEWER_REPAIRS, replace: '  return r.unescaped_backslashes > 0 || r.stripped_fields.length > 0;\n', expect: RS },
  // ── 代码双审 r1 接受项 ──
  { id: 'M19', desc: '整份回退一律按散文切、不按意见逐条出 F 单元（CODEX-01）⇒ P15', file: PARSE,
    find: PER_FINDING, replace: '    null ??\n', expect: PS },
  { id: 'M20', desc: '降级意见的 evidence 不参与 consulted 核对（GLM-01）⇒ P12′', file: PARSE,
    find: DEGRADED_EVIDENCE, replace: '', expect: PS },
  { id: 'M21', desc: '不合格意见单元格不转义竖线（CODEX-05 ≡ GLM-02）⇒ R4′', file: RENDER,
    find: PIPE_ESCAPE, replace: '', expect: RS },
  { id: 'M22', desc: '可选根字段类型不从 schema 取（CODEX-06）⇒ B2′', file: BRIEF,
    find: TYPE_OF, replace: '    return null;\n', expect: BS },
  { id: 'M23', desc: 'front-matter 的 findings_degraded 退回条数（CODEX-03）⇒ R1', file: RENDER,
    find: FM_DEGRADED, replace: sub(FM_DEGRADED, 'input.degradedFindings!.map((d) => d.id)', 'degradedCount(input)'), expect: RS },
  { id: 'M24', desc: 'front-matter 新增一个夹具没覆盖的条件键而回显清单没跟（CODEX-02：P9 假绿、P9′ 要红）⇒ P9′', file: RENDER,
    find: CONSULTED_UNVERIFIED, replace: CONSULTED_UNVERIFIED + '    ...(input.drift ? { drift_detail: true } : {}),\n', expect: PS },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [PARSE, REVIEW, GATE, BRIEF, RENDER], suites: [PS, GS, RS, BS, FI], cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
