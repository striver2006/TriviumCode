// 生成「档位命令行旗标」（M11 第 5 步，计划 r2 §3.2）的变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/m11-tier-config-20261007/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件。
// 产出两份：〈前缀〉-ts.json 只含 .ts 目标（给 scripts/mutation-check.mjs）；〈前缀〉-all.json 另含渲染产物上的契约变异（给逐条预跑脚本）。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-tier-flags-20261008/gen-mutation-spec.mjs 〈输出前缀〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出前缀〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TF = 'src/trivium/tier-flags.ts';
const PRE = 'src/trivium/preflight.ts';
const REVIEW = 'src/trivium/review.ts';
const RP = 'src/trivium/run-protocol.ts';
const TA = 'src/trivium/topic-args.ts';
const ER = 'src/entry-render.ts';
// 契约变异打在源上：skill-flag-parity 取渲染器的内存产物（从 skills-src/ 现渲染），不读盘上产物（首跑打在产物上没咬住，见报告）
const RUN_MD = 'skills-src/commands/run.contract.md';
const S = {
  flags: 'dist/test/test/unit/tier-flags.test.js',
  tier: 'dist/test/test/unit/tier-resolve.test.js',
  cli: 'dist/test/test/integration/tier-flags-cli.test.js',
  render: 'dist/test/test/contract/entry-render-parity.test.js',
  skill: 'dist/test/test/contract/skill-flag-parity.test.js',
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

const F_COLLECT = blockOf(TF, 'if (v !== undefined) out[k][id] = v;');
const F_KEYS = blockOf(TF, 'for (const k of KINDS) assertCriticFlagKeys(');
const F_HOOK = blockOf(TF, 'if (!withProfile.has(id)) {');
const F_TIERVAL = blockOf(TF, 'if (!(TIER_NAMES as readonly string[]).includes(v)) {');
// checkTierCombos 的合并行：与 checkModelSlugs 同字，带上下一行的 gated 声明才唯一
const P_COMBOS_MERGE = blockOf(PRE, 'const gated: string[] = [];', 1);
const P_COMBOS = (() => {
  const src = read(PRE);
  const block = '  const cli = mergeCliOverrides(overrides, tierFlags);\n  const bad: string[] = [];\n  const gated: string[] = [];\n';
  if (src.split(block).length - 1 !== 1) throw new Error('checkTierCombos 合并锚点不唯一');
  return block;
})();
void P_COMBOS_MERGE;
const P_GAP = blockOf(PRE, 'if (tierFlags[critic]?.tier) {');
// 代码三审 GLM-02 补：过渡闸文案按来源点明经 --tier 选到的档
const P_VIATIER = blockOf(PRE, "const viaTierFlag = r.tierSource === 'cli' && r.tier !== null");
const R_ROUTE = blockOf(REVIEW, 'const routed = resolveTier(cfg, critic, stage, cliOverrides[critic] ?? {});');
const R_REASON = blockOf(REVIEW, 'if (tier) return `用户经 --tier-');
const RP_WARN = blockOf(RP, 'const tierCombos = checkTierCombos(cfg, rc.stage, rc.opts.modelOverrides, rc.sides, rc.opts.tierFlags);');
const RP_HANDOFF = blockOf(RP, '...(rc.opts.tierFlags && Object.keys(rc.opts.tierFlags).length > 0 ? { tierFlags: rc.opts.tierFlags } : {}),');
const TA_TIERS = blockOf(TA, '    tiers,');
const TA_EFFORTS = blockOf(TA, '    efforts,');
const TA_VP = blockOf(TA, '    vendor_profiles: vendorProfiles,');
const TA_GET = blockOf(TA, 'collectTierFlags((name) => (named as Record<string, string | undefined>)[name]),');
const ER_VP = blockOf(ER, 'VENDOR_PROFILE_HINT: profileCritics.map(');
// 契约侧（源）：S2 交接清单里的三字段透传句；S0.6 交接清单里的 `--profile`
const MD_S2 = blockOf(RUN_MD, '- `--profile` 传 S0.5 的 `profile`，为空则不传；');
const MD_S06 = blockOf(RUN_MD, '- `profile` 非空时传 `--profile`；`models` 非空时逐个传对应的 `--model-<审核者 id>`；`tiers`');

const ts = [
  one('A1', '收集面漏掉一家（写给它的旗标被静默丢弃）', TF, F_COLLECT, sub(F_COLLECT, 'v !== undefined', "v !== undefined && id !== 'codex'"), S.flags),
  one('A2', '键校验只查 profile 一类（tier / effort 跳过）', TF, F_KEYS, "  assertCriticFlagKeys(cfg, driver, Object.keys(raw.profile), picked, 'profile');\n", S.flags),
  one('A3', '--profile-〈id〉 不查厂商 profile 钩子', TF, F_HOOK, sub(F_HOOK, '!withProfile.has(id)', 'false'), S.flags),
  one('A4', '--tier 取值不校验', TF, F_TIERVAL, sub(F_TIERVAL, '!(TIER_NAMES as readonly string[]).includes(v)', 'false'), S.flags),
  one('B1', 'checkTierCombos 不收档位旗标', PRE, P_COMBOS, sub(P_COMBOS, 'mergeCliOverrides(overrides, tierFlags)', 'mergeCliOverrides(overrides, {})'), S.tier),
  one('B2', '留痕空窗告警删去', PRE, P_GAP, sub(P_GAP, 'tierFlags[critic]?.tier', 'false'), S.tier),
  one('B3', '过渡闸文案不再点明经 --tier 选到的档（代码三审 GLM-02 补）', PRE, P_VIATIER, sub(P_VIATIER, "r.tierSource === 'cli' && r.tier !== null", 'false'), S.tier),
  one('C1', '路由点不用合并结果（--tier 选出的模型不进请求）', REVIEW, R_ROUTE,
    sub(R_ROUTE, 'cliOverrides[critic] ?? {}', '{ model: opts.modelOverrides[critic] ?? null }'), S.cli),
  one('C2', '--start 告警复查不带档位旗标', RP, RP_WARN, sub(RP_WARN, ', rc.opts.tierFlags)', ')'), S.cli),
  one('C3', '交接文件不带档位旗标', RP, RP_HANDOFF, '', S.cli),
  one('C4', 'override_reason 不认 --tier', REVIEW, R_REASON, sub(R_REASON, 'if (tier) return', 'if (false) return'), S.cli),
  one('D1', 'resolve 输出漏 tiers', TA, TA_TIERS, '', S.cli),
  one('D2', 'resolve 输出漏 efforts', TA, TA_EFFORTS, '', S.cli),
  one('D3', 'resolve 输出漏 vendor_profiles', TA, TA_VP, '', S.cli),
  one('D4', 'topic resolve 按真假过滤（写了不给值被静默丢弃）', TA, TA_GET,
    sub(TA_GET, '[name]),', '[name] || undefined),'), S.cli),
  one('E1', '入口渲染漏厂商 profile 提示', ER, ER_VP, '    VENDOR_PROFILE_HINT: \'\',\n', S.render),
];
const contractCases = [
  one('M1', '契约产物：dual-run 的 S2 交接删去三字段透传', RUN_MD, MD_S2,
    sub(MD_S2, '；`tiers` / `efforts` / `vendor_profiles` 非空时逐个传对应的 `--tier-<审核者 id>` / `--effort-<审核者 id>` / `--profile-<审核者 id>`', ''), S.skill),
  one('M2', '契约产物：dual-run 的 S0.6 交接删去 `--profile` 本身（只剩 `--profile-〈id〉`，旧正则会被它代绿）', RUN_MD, MD_S06,
    sub(MD_S06, '`profile` 非空时传 `--profile`；', '`profile` 非空时照传；'), S.skill),
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
fs.writeFileSync(`${OUT}-all.json`, JSON.stringify({ targets: [...tsTargets, RUN_MD], suites: suitesOf(all), cases: all }, null, 2) + '\n');
console.log(`ts ${ts.length} 条、合计 ${all.length} 条`);
