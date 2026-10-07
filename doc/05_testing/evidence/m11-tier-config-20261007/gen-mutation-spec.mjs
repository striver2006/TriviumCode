// 生成「配置契约与档位解析」（M11 第 4 步，计划 r2 §5.2）的变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/m11-ac25-three-critic-20261007/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件。
// 产出两份：〈前缀〉-ts.json 只含 .ts 目标（给 scripts/mutation-check.mjs，闸 4 按 dist/test/〈路径〉.js 找产物）；
//          〈前缀〉-all.json 另含 schema 类变异（给逐条预跑脚本 mutation-names.mjs，它重建后跑套件，不依赖产物映射）。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-tier-config-20261007/gen-mutation-spec.mjs 〈输出前缀〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出前缀〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BASE = 'src/trivium/adapters/base.ts';
const PRE = 'src/trivium/preflight.ts';
const CFG = 'src/trivium/config.ts';
const PROBE = 'src/trivium/probes/codex.ts';
const REVIEW = 'src/trivium/review.ts';
const CODEX = 'src/trivium/adapters/codex.ts';
const AGY = 'src/trivium/adapters/agy.ts';
const SCHEMA = 'skills/dual-critic/schema/config.v2.json';
const S = {
  tier: 'dist/test/test/unit/tier-resolve.test.js',
  schema: 'dist/test/test/unit/config-schema.test.js',
  consumers: 'dist/test/test/unit/config-consumers.test.js',
  probe: 'dist/test/test/unit/probe-fixture-cleanup.test.js',
  noart: 'dist/test/test/integration/no-artifacts.test.js',
};

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

// ── 解析（base.ts）──
const B_TIERCELL = blockOf(BASE, "} else if (cell && typeof cell === 'object' && 'tier' in cell) {");
const B_ALL = blockOf(BASE, 'const allOverridden = provided.length > 0 && provided.every((k) => overridden[k]);');
const B_OVR = blockOf(BASE, "if (!base || allOverridden) tierSource = 'override';");
const B_CLITIER = blockOf(BASE, '  if (cli.tier) {', 2);
const B_PROF = blockOf(BASE, 'if (base?.fields.profile !== undefined) {');
const B_EMPTY = blockOf(BASE, "} else if (typeof cell === 'string') {", 2);
const B_FALLBACK = blockOf(BASE, "if (effort === null && base?.kind === 'legacy' && stageEffort !== null) {");
// ── 校验（preflight.ts）──
const P_ENUM = blockOf(PRE, "} else if (lv.kind === 'levels' && !lv.levels.includes(r.effort)) {");
const P_UNKNOWN = blockOf(PRE, "} else if (lv.kind === 'unknown') {", 2);
const P_NONE = blockOf(PRE, "if (lv.kind === 'none') {");
const P_NAMES = blockOf(PRE, 'else if (!names.includes(r.vendorProfile)) {');
const P_SLUGPROF = blockOf(PRE, 'const r = checkModelAgainstCatalog(cfg, critic, routed.model, routed.vendorProfile);');
const P_MISSING = blockOf(PRE, 'if (routed.missingTier) {');
const P_GATE_EFF = blockOf(PRE, "if (r.effort !== null && r.origin.effort !== 'agent' && !suffixEncoded) {");
const P_GATE_PROF = blockOf(PRE, "if (r.vendorProfile !== null && r.origin.vendorProfile !== 'agent' && r.vendorProfile !== r.agentVendorProfile) {");
const P_RESIDUAL = blockOf(PRE, "r.tierSource !== 'legacy' &&");
// ── 其余 ──
const C_DEPR = blockOf(CFG, "{ path: ['agents', 'codex', 'effort'] },");
const C_ATOM_T = blockOf(CFG, "['agents', '*', 'tiers'],");
const C_ATOM_P = blockOf(CFG, "['profiles', '*', '*', '*'],");
const PR_BYPROF = blockOf(PROBE, 'reasoningByProfile[name] = visibleEfforts(c);');
const PR_BASE = blockOf(PROBE, 'probe.reasoning_levels.base = visibleEfforts(catalog);');
const PR_VIS = blockOf(PROBE, 'for (const slug of lists.visible) out[slug] = lists.efforts[slug] ?? [];');
const R_COMBOS = blockOf(REVIEW, 'if (!combos.ok) throw usageError(');
const X_TABLE = blockOf(CODEX, 'const table = vendorProfile ? rl.by_profile[vendorProfile] : rl.base;');
const A_DERIVE = blockOf(AGY, ".filter((m) => modelEncodesEffort(m) && m.slice(0, m.lastIndexOf('-')) === model)");
// ── schema ──
const SC_STAGE_STR = (() => {
  const src = read(SCHEMA);
  const anchor = '"stageModel": {';
  const i = src.indexOf(anchor);
  const j = src.indexOf('"type": "string"', i);
  const k = src.indexOf('}', j);
  const block = src.slice(src.lastIndexOf('{', j), k + 1);
  if (src.split(block).length - 1 < 1) throw new Error('stageModel 裸 slug 锚点失配');
  return { block, at: src.lastIndexOf('{', j) };
})();
// 裸 slug 那一支在全文里不唯一（别处也有 {"type": "string"}），把前面的 "oneOf": [ 连带截进来
const SC_STR = (() => {
  const src = read(SCHEMA);
  const i = src.indexOf('"stageModel": {');
  const start = src.indexOf('"oneOf": [', i);
  const block = src.slice(start, SC_STAGE_STR.at + SC_STAGE_STR.block.length);
  if (src.split(block).length - 1 !== 1) throw new Error('stageModel oneOf 锚点不唯一');
  return block;
})();
const SC_TIERFORM = (() => {
  const src = read(SCHEMA);
  const i = src.indexOf('"stageModel": {');
  // 从 {tier} 那一支的 "additionalProperties": false 截到 required 里的 "tier" 为止——带上 "tier" 才唯一
  const a = src.indexOf('"additionalProperties": false,', i);
  const r = src.indexOf('"required": [', a);
  const full = src.slice(a, src.indexOf('"tier"', r) + '"tier"'.length);
  if (src.split(full).length - 1 !== 1) throw new Error('{tier} 形态锚点不唯一');
  return full;
})();
const SC_ZCODE = '"$ref": "#/$defs/tiersModelOnly"';
const SC_OPENAI_REQ = (() => {
  const src = read(SCHEMA);
  const block = '"required": [\n              "vendor",\n              "bin",\n              "profile"\n            ],';
  if (src.split(block).length - 1 !== 1) throw new Error('openai required 锚点不唯一');
  return block;
})();
if (read(SCHEMA).split(SC_ZCODE).length - 1 !== 1) throw new Error('zcode tiers 锚点不唯一');

const ts = [
  one('R1', '{tier} 格子被当作未命中（解析跳过档位引用）', BASE, B_TIERCELL, sub(B_TIERCELL, "'tier' in cell", "'tier' in cell && false"), S.tier),
  one('R2', '全覆盖判定恒假（override 失效）', BASE, B_ALL, 'const allOverridden = false;\n', S.tier),
  one('R3', '裸 slug 被命令行覆盖仍记 legacy（P-6 回退）', BASE, B_OVR, sub(B_OVR, '!base || allOverridden', "!base || (allOverridden && base.kind !== 'legacy')"), S.tier),
  one('R4', '第一段次序颠倒：default_tier 先于格子', BASE, B_CLITIER,
    "  if (agent?.default_tier && !cli.tier) {\n    base = fromTier(agent.default_tier, 'agent_default');\n  } else if (cli.tier) {\n    base = fromTier(cli.tier, 'cli');\n", S.tier),
  one('R5', '厂商 profile 次序颠倒：agents.codex.profile 先于档位条目', BASE, B_PROF, sub(B_PROF, 'base?.fields.profile !== undefined', 'base?.fields.profile !== undefined && agentVendorProfile === null'), S.tier),
  one('R6', 'gemini 阶段级 effort 回落不再限裸 slug', BASE, B_FALLBACK, sub(B_FALLBACK, " && base?.kind === 'legacy'", ''), S.tier),
  // 代码三审 GLM-01 补：空串格子不得回落 default_tier
  one('E1', '空串格子改回「未命中」、回落 default_tier', BASE, B_EMPTY,
    "  } else if (typeof cell === 'string' && cell) {\n    base = { kind: 'legacy', source: 'legacy', tier: null, fields: { model: cell } };\n", S.tier),
  one('V1', '枚举非空时不校验', PRE, P_ENUM, sub(P_ENUM, "lv.kind === 'levels' && !lv.levels.includes(r.effort)", "lv.kind === 'levels' && false"), S.tier),
  one('V2', '枚举取不到时硬拒', PRE, P_UNKNOWN, sub(P_UNKNOWN, "} else if (lv.kind === 'unknown') {\n", "} else if (lv.kind === 'unknown') {\n          sideBad = true; bad.push('x');\n"), S.tier),
  one('V3', '「无思考等级概念」一格删去（glm 写 effort 不再被永久判据拒）', PRE, P_NONE, sub(P_NONE, "lv.kind === 'none'", "lv.kind === 'none' && false"), S.tier),
  one('V3b', '同 V3，review 准备阶段集成用例', PRE, P_NONE, sub(P_NONE, "lv.kind === 'none'", "lv.kind === 'none' && false"), S.noart),
  one('V4', '厂商 profile 名单校验删去', PRE, P_NAMES, sub(P_NAMES, '!names.includes(r.vendorProfile)', 'false'), S.tier),
  one('V5', 'slug 校验不传档位解析的厂商 profile', PRE, P_SLUGPROF, sub(P_SLUGPROF, ', routed.vendorProfile)', ')'), S.tier),
  one('V6', '档名缺失分支删去（回落「未定义模型」）', PRE, P_MISSING, sub(P_MISSING, 'routed.missingTier', 'routed.missingTier && false'), S.tier),
  one('G1', '过渡闸 effort 格删去', PRE, P_GATE_EFF, 'if (false) {\n', S.tier),
  one('G1b', '同 G1，review 准备阶段集成用例', PRE, P_GATE_EFF, 'if (false) {\n', S.noart),
  one('G2', '过渡闸 profile 格删去', PRE, P_GATE_PROF, 'if (false) {\n', S.tier),
  one('G3', '过渡闸不再豁免 slug 已编码档位', PRE, P_GATE_EFF, sub(P_GATE_EFF, ' && !suffixEncoded', ''), S.tier),
  one('G4', '过渡告警（GLM-01）删去', PRE, P_RESIDUAL, sub(P_RESIDUAL, "r.tierSource !== 'legacy' &&", 'false &&'), S.tier),
  one('D1', '废弃键路径改回通配（gemini 同名键被误报）', CFG, C_DEPR, sub(C_DEPR, "'codex'", "'*'"), S.consumers),
  one('M1', '原子节点：tiers 改回逐键合并', CFG, C_ATOM_T, '', S.schema),
  one('M2', '原子节点：profiles 格子改回逐键合并', CFG, C_ATOM_P, '', S.schema),
  one('P1', '探针不落逐 profile 思考等级', PROBE, PR_BYPROF, '', S.probe),
  one('P2', '探针不落基底思考等级', PROBE, PR_BASE, '', S.probe),
  one('P3', '思考等级收进隐藏项', PROBE, PR_VIS, sub(PR_VIS, 'lists.visible', 'lists.models'), S.probe),
  one('Q1', 'review 准备阶段不调档位组合校验（只有预检拦）', REVIEW, R_COMBOS, sub(R_COMBOS, '!combos.ok', 'false'), S.noart),
  one('H1', 'codex 钩子不分 profile、一律取基底', CODEX, X_TABLE, 'const table = rl.base;\n', S.tier),
  one('H2', 'agy 钩子不比对基名、目录里所有带后缀的都算', AGY, A_DERIVE, ".filter((m) => modelEncodesEffort(m))\n", S.tier),
];
const schemaCases = [
  one('S1', 'schema：裸 slug 形态加 minLength（空串 slug 改为加载期被拒）', SCHEMA, SC_STR,
    SC_STR.replace('"type": "string"', '"type": "string",\n          "minLength": 1'), S.schema),
  one('S2', 'schema：{tier} 形态放开 additionalProperties（与 model 混写不再被拒）', SCHEMA, SC_TIERFORM,
    SC_TIERFORM.replace('"additionalProperties": false,', '"additionalProperties": true,'), S.schema),
  one('S3', 'schema：zcode 支档位条目放行 effort', SCHEMA, SC_ZCODE, '"$ref": "#/$defs/tiersCommon"', S.schema),
  one('S4', 'schema：openai 支 effort 回到 required', SCHEMA, SC_OPENAI_REQ,
    SC_OPENAI_REQ.replace('"profile"\n', '"profile",\n              "effort"\n'), S.schema),
];

const all = [...ts, ...schemaCases];
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
