// EV-258 第二轮零配额验收的判读半边（计划 r2 §6.1）：读 accept-run.mjs 产出的 20 份 JSON（两棵树 × 两态 × 五情形），逐条判定并打印。
// 照第一轮 evidence/gateway-model-suffix-20261026/accept-readout.mjs 改：加情形 suffixU；被测产物比 claude-route.js；
// 开启时不带大写后缀的四情形新旧逐项相同，suffixU 基线复现缺陷、新构建回读带 [1M] 的名且一致性 true。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-model-suffix-case-20261026/accept-readout.mjs
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const DIR = 'doc/05_testing/evidence/gateway-model-suffix-case-20261026';
const SCENARIOS = ['default', 'model', 'cred', 'suffix', 'suffixU'];
const load = (t, m, s) => JSON.parse(fs.readFileSync(`${DIR}/accept-${t}-${m}-${s}.json`, 'utf8'));
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

{
  const a = load('base', 'off', 'default'), b = load('new', 'off', 'default');
  check('两侧被测产物不同（adapters/claude-route.js sha256）', a.route_sha256 !== b.route_sha256,
    `${a.route_sha256.slice(0, 12)} / ${b.route_sha256.slice(0, 12)}`);
}

for (const m of ['off', 'on']) for (const s of SCENARIOS) for (const t of ['base', 'new']) {
  const r = load(t, m, s);
  const leaked = Object.entries(r.credential_hits).filter(([, ks]) => ks.length > 0);
  check(`${t}/${m}/${s}：凭据键的值在全部输出里零命中`, leaked.length === 0, JSON.stringify(leaked));
}

// 未开启：五种情形新旧逐项相同（未开 settings_env_source 的机器 scrub 输出逐字不变；回读与 model_flag 不变）
for (const s of SCENARIOS) {
  const a = load('base', 'off', s), b = load('new', 'off', s);
  check(`off/${s}：新旧归一化输出逐项相同`, isDeepStrictEqual(a.normalized_sha256, b.normalized_sha256));
  check(`off/${s}：回读与 model_flag 新旧相同`, isDeepStrictEqual([a.readback, a.model_flag], [b.readback, b.model_flag]),
    JSON.stringify([b.readback, b.model_flag]));
}
// 开启、init.model 不带大写后缀的四种情形（含第一轮的小写 suffix）：本轮不该有任何影响，新旧逐项相同
for (const s of ['default', 'model', 'cred', 'suffix']) {
  const a = load('base', 'on', s), b = load('new', 'on', s);
  check(`on/${s}：新旧归一化输出逐项相同`, isDeepStrictEqual(a.normalized_sha256, b.normalized_sha256));
  check(`on/${s}：回读、model_flag、回报与一致性新旧相同`,
    isDeepStrictEqual([a.readback, a.model_flag, a.reported_models, a.consistency], [b.readback, b.model_flag, b.reported_models, b.consistency]),
    JSON.stringify([b.readback, b.model_flag, b.consistency]));
}
// 开启、init.model 取大写后缀键：基线被吞（兜底记 null + unverified），新构建记带 [1M] 的名 + envelope、与回报一致
{
  const a = load('base', 'on', 'suffixU'), b = load('new', 'on', 'suffixU');
  const real = 'gw-ev258-flash-02[1M]';
  check('on/suffixU 基线：复现缺陷（回读被吞，兜底记 null + unverified）',
    a.readback.model_effective === null && a.readback.model_effective_source === 'unverified', JSON.stringify(a.readback));
  check('on/suffixU 基线：探针臂 init.model 是占位符', a.arm_init_model === '<redacted-env>', String(a.arm_init_model));
  check('on/suffixU 新构建：记带大写后缀的模型名、来源 envelope',
    b.readback.model_effective === real && b.readback.model_effective_source === 'envelope', JSON.stringify(b.readback));
  check('on/suffixU 新构建：探针臂 init.model 为带大写后缀的模型名', b.arm_init_model === real, String(b.arm_init_model));
  check('on/suffixU 新构建：回显的凭据值仍以占位符出现',
    ['review_stdout', 'review_stderr', 'arm_raw', 'arm_stderr'].every((n) => b.placeholder_in.includes(n)), b.placeholder_in.join(','));
  check('on/suffixU 新构建：服务端回报名收进留痕、判为一致',
    isDeepStrictEqual(b.reported_models, ['gw-ev258-flash-02']) && b.consistency === true,
    `${JSON.stringify(b.reported_models)} / ${b.consistency}`);
  check('on/suffixU：一致性旧 null（回读被吞、没法比）、新 true', a.consistency === null && b.consistency === true,
    `${a.consistency} / ${b.consistency}`);
  check('on/suffixU：model_flag 旧 null（没核对成）、新 false（所选 haiku ≠ 回读名，核对不符）', a.model_flag === null && b.model_flag === false,
    `${a.model_flag} / ${b.model_flag}`);
}

for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  ${c.detail}` : ''}`);
const bad = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length} 项，${bad === 0 ? '全部通过' : `${bad} 项不通过`}`);
process.exit(bad === 0 ? 0 : 1);
