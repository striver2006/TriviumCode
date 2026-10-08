// 生成「思考等级透传与留痕接线」（M11 第 6 步，计划 r2 §3.2）的变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/m11-tier-flags-20261008/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件。
// 产出两份：〈前缀〉-ts.json 只含 .ts 目标（给 scripts/mutation-check.mjs）；〈前缀〉-all.json 另含 schema 上的契约变异（给逐条预跑脚本）。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-effort-wiring-20261008/gen-mutation-spec.mjs 〈输出前缀〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出前缀〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const AGY = 'src/trivium/adapters/agy.ts';
const CODEX = 'src/trivium/adapters/codex.ts';
const CLAUDE = 'src/trivium/adapters/claude.ts';
const ZCODE = 'src/trivium/adapters/zcode.ts';
const REVIEW = 'src/trivium/review.ts';
const PRE = 'src/trivium/preflight.ts';
const RENDER = 'src/trivium/render.ts';
const PROBE = 'src/trivium/probes/claude.ts';
const SCHEMA = 'skills/dual-critic/schema/run.v2.json';
const S = {
  unit: 'dist/test/test/unit/effort-wiring.test.js',
  e2e: 'dist/test/test/integration/effort-wiring.test.js',
  run: 'dist/test/test/integration/codex-effort-profile.test.js',
  tier: 'dist/test/test/unit/tier-resolve.test.js',
};

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

const A_READ = blockOf(AGY, "if (result.model_effective_source !== 'envelope' || !modelEncodesEffort(m)) return EFFORT_UNVERIFIED;");
const C_READ = blockOf(CODEX, 'effortReadback: () => EFFORT_UNVERIFIED,');
const CL_READ = blockOf(CLAUDE, 'effortReadback: () => EFFORT_UNVERIFIED,');
const Z_READ = blockOf(ZCODE, 'effortReadback: () => EFFORT_NO_CONCEPT,');
const R_EFF = blockOf(REVIEW, 'effort_effective: effortRead[c]!.effective,');
const R_REQ = blockOf(REVIEW, 'effort_requested: requests[c]!.effort ?? null,');
const R_PROFILE = blockOf(REVIEW, 'profile: cfg.active_profile,');
const R_EFFORT_REQ = blockOf(REVIEW, '...(routed.effort !== null ? { effort: routed.effort } : {}),');
const R_AVAIL = blockOf(REVIEW, 'const av = adapter.availability(adapterCtx, { vendorProfiles: [routedBy[c]!.vendorProfile] });');
const exact = (file, block, what) => {
  if (read(file).split(block).length - 1 !== 1) throw new Error(`${what} 锚点不唯一`);
  return block;
};
const C_ARGV = exact(CODEX, '        profile: inv.profile,\n        model: inv.model,\n', 'invokeCodex');
const C_HOME = exact(CODEX, '        profile: inv.profile,\n        projectRoot: req.project_root,\n', 'prepareCodexHome');
const R_TIER = exact(REVIEW, '      tier: requests[c]!.tier,\n      tier_source: requests[c]!.tier_source,\n      status: r.status,\n', 'run.json tier');
const C_AVAIL = blockOf(CODEX, 'const wantedAll = opts?.vendorProfiles !== undefined');
const CL_RUN = blockOf(CLAUDE, 'effort: req.effort ?? null,', 2);
const P_PAREN = blockOf(PROBE, 'if (open < 0 || close < 0) return null;');
const P_OPEN = blockOf(PROBE, "const open = line.indexOf('(');");
const CL_LEVELS = blockOf(CLAUDE, 'return claudeReasoningLevels(cfg.probe.cli.claude);');
const FM = blockOf(RENDER, 'effort_effective: input.effortEffective,');
const PRE_AVAIL = blockOf(PRE, 'const v = a.availability(actx, { vendorProfiles });');
// C_ARGV 的两行必须是 run() 里 invokeCodex 那一处（prepareCodexHome 那一处第二行是 projectRoot）
if (!C_ARGV.includes('model: inv.model')) throw new Error('C_ARGV 锚点错位');

const schemaTier = (() => {
  const src = read(SCHEMA);
  const block = '          "enum": [\n            "low",\n            "medium",\n            "high",\n            null\n          ],\n';
  if (src.split(block).length - 1 !== 1) throw new Error('schema tier 枚举锚点不唯一');
  return block;
})();

const ts = [
  one('M1', 'agy 回读不看来源（回执缺失退到请求值时也取后缀）', AGY, A_READ,
    sub(A_READ, "result.model_effective_source !== 'envelope' || ", ''), S.unit),
  one('M2', 'codex 回读改取生效模型的 slug 后缀（拿非回读面冒充）', CODEX, C_READ,
    "  effortReadback: (r) => (r.model_effective && /-(high|medium|low)$/.test(r.model_effective) ? { effective: r.model_effective.slice(r.model_effective.lastIndexOf('-') + 1), source: 'envelope' } : EFFORT_UNVERIFIED),\n", S.unit),
  one('M3', 'claude 回读同上', CLAUDE, CL_READ,
    "  effortReadback: (r) => (r.model_effective && /-(high|medium|low)$/.test(r.model_effective) ? { effective: r.model_effective.slice(r.model_effective.lastIndexOf('-') + 1), source: 'envelope' } : EFFORT_UNVERIFIED),\n", S.unit),
  one('M4', 'zcode 来源写 unverified（无此概念与没读到合流）', ZCODE, Z_READ,
    "  effortReadback: () => ({ effective: null, source: 'unverified' as const }),\n", S.unit),
  one('M5', '写侧 effort_effective 改条件展开（null 与缺席合流）', REVIEW, R_EFF,
    sub(R_EFF, 'effort_effective: effortRead[c]!.effective,', '...(effortRead[c]!.effective !== null ? { effort_effective: effortRead[c]!.effective } : {}),'), S.e2e),
  one('M6', '写侧 effort_requested 改条件展开', REVIEW, R_REQ,
    sub(R_REQ, 'effort_requested: requests[c]!.effort ?? null,', '...(requests[c]!.effort ? { effort_requested: requests[c]!.effort } : {}),'), S.e2e),
  one('M7', '不写 tier / tier_source', REVIEW, R_TIER, '      status: r.status,\n', S.e2e),
  one('M8', '不写顶层 profile', REVIEW, R_PROFILE, '', S.e2e),
  one('M9', 'codex 的 -p 回退取配置段', CODEX, C_ARGV, sub(C_ARGV, 'profile: inv.profile,', 'profile: codexConfig(ctx).profile,'), S.run),
  one('M10', 'codex 隔离副本拷配置段那家的 profile 文件', CODEX, C_HOME, sub(C_HOME, 'profile: inv.profile,', 'profile: codexConfig(ctx).profile,'), S.run),
  one('M11', 'codex 可用性忽略本轮解析值', CODEX, C_AVAIL, sub(C_AVAIL, 'opts?.vendorProfiles !== undefined', 'false'), S.unit),
  one('M12', 'claude run() 不下传 --effort', CLAUDE, CL_RUN, sub(CL_RUN, 'effort: req.effort ?? null,', 'effort: null,'), S.run),
  one('M13', '请求的思考等级回退为只给 antigravity（原 effortFor 口径）', REVIEW, R_EFFORT_REQ,
    sub(R_EFFORT_REQ, 'routed.effort !== null ?', "routed.effort !== null && critic === 'gemini' ?"), S.e2e),
  one('M14', 'parseEffortLevels 解析不出时落 []（错枚举：把「取不到」说成「没有这个旗标」）', PROBE, P_PAREN, sub(P_PAREN, 'return null;', 'return [];'), S.unit),
  one('M15', 'claude reasoningLevelsFor 不读探针', CLAUDE, CL_LEVELS, sub(CL_LEVELS, 'cfg.probe.cli.claude', 'undefined'), S.tier),
  one('M16', 'front-matter 漏写 effort_effective', RENDER, FM, '', S.unit),
  one('M17', 'parseEffortLevels 改回取最后一对括号（计划三审 CODEX-02）', PROBE, P_OPEN, sub(P_OPEN, "line.indexOf('(')", "line.lastIndexOf('(')"), S.unit),
  one('M18', '预检可用性不传本轮解析值', PRE, PRE_AVAIL, sub(PRE_AVAIL, 'a.availability(actx, { vendorProfiles })', 'a.availability(actx)'), S.e2e),
  one('M19', 'review 准备阶段可用性不传本轮解析值', REVIEW, R_AVAIL,
    sub(R_AVAIL, 'adapter.availability(adapterCtx, { vendorProfiles: [routedBy[c]!.vendorProfile] })', 'adapter.availability(adapterCtx)'), S.e2e),
];
const contractCases = [
  one('MC1', '契约：tier 枚举放宽（任意串都收）', SCHEMA, schemaTier, '', S.unit),
];

const all = [...ts, ...contractCases];
for (const c of all) {
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的替换串含特殊替换模式`);
  const src = read(c.file);
  if (src.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
  if (c.find === c.replace) throw new Error(`${c.id} 替换前后相同`);
}
const tsTargets = [...new Set(ts.map((c) => c.file))];
const suitesOf = (cs) => [...new Set(cs.map((c) => c.expect))];
fs.writeFileSync(`${OUT}-ts.json`, JSON.stringify({ targets: tsTargets, suites: suitesOf(ts), cases: ts }, null, 2) + '\n');
fs.writeFileSync(`${OUT}-all.json`, JSON.stringify({ targets: [...tsTargets, SCHEMA], suites: suitesOf(all), cases: all }, null, 2) + '\n');
console.log(`ts ${ts.length} 条、合计 ${all.length} 条`);
