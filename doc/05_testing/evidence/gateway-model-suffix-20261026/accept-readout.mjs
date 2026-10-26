// EV-258 零配额验收的判读半边（计划 r2 §6.1）：读 accept-run.mjs 产出的 16 份 JSON（两棵树 × 两态 × 四情形），逐条判定并打印。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-model-suffix-20261026/accept-readout.mjs
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const DIR = 'doc/05_testing/evidence/gateway-model-suffix-20261026';
const SCENARIOS = ['default', 'model', 'cred', 'suffix'];
const load = (t, m, s) => JSON.parse(fs.readFileSync(`${DIR}/accept-${t}-${m}-${s}.json`, 'utf8'));
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

{
  const a = load('base', 'off', 'default'), b = load('new', 'off', 'default');
  check('两侧被测产物不同（adapters/claude.js sha256）', a.adapter_sha256 !== b.adapter_sha256,
    `${a.adapter_sha256.slice(0, 12)} / ${b.adapter_sha256.slice(0, 12)}`);
}

for (const m of ['off', 'on']) for (const s of SCENARIOS) for (const t of ['base', 'new']) {
  const r = load(t, m, s);
  const leaked = Object.entries(r.credential_hits).filter(([, ks]) => ks.length > 0);
  check(`${t}/${m}/${s}：凭据键的值在全部输出里零命中`, leaked.length === 0, JSON.stringify(leaked));
}

// 未开启：四种情形新旧逐项相同（scrub 输出逐字不变；回读与 model_flag 不变）
for (const s of SCENARIOS) {
  const a = load('base', 'off', s), b = load('new', 'off', s);
  check(`off/${s}：新旧归一化输出逐项相同`, isDeepStrictEqual(a.normalized_sha256, b.normalized_sha256));
  check(`off/${s}：回读与 model_flag 新旧相同`, isDeepStrictEqual([a.readback, a.model_flag], [b.readback, b.model_flag]),
    JSON.stringify([b.readback, b.model_flag]));
}
// 开启、模型名不带后缀的三种情形：本批不该有任何影响，新旧逐项相同
for (const s of ['default', 'model', 'cred']) {
  const a = load('base', 'on', s), b = load('new', 'on', s);
  check(`on/${s}：新旧归一化输出逐项相同`, isDeepStrictEqual(a.normalized_sha256, b.normalized_sha256));
  check(`on/${s}：回读与 model_flag 新旧相同`, isDeepStrictEqual([a.readback, a.model_flag], [b.readback, b.model_flag]),
    JSON.stringify([b.readback, b.model_flag]));
}
// 开启、模型名键值带后缀：基线被吞（兜底记 null + unverified），新构建记带后缀名 + envelope
{
  const a = load('base', 'on', 'suffix'), b = load('new', 'on', 'suffix');
  const real = 'gw-ev258-max-01[1m]';
  check('on/suffix 基线：复现缺陷（回读被吞，兜底记 null + unverified）',
    a.readback.model_effective === null && a.readback.model_effective_source === 'unverified', JSON.stringify(a.readback));
  check('on/suffix 基线：探针臂 init.model 是占位符', a.arm_init_model === '<redacted-env>', String(a.arm_init_model));
  check('on/suffix 新构建：记带后缀的模型名、来源 envelope',
    b.readback.model_effective === real && b.readback.model_effective_source === 'envelope', JSON.stringify(b.readback));
  check('on/suffix 新构建：探针臂 init.model 为带后缀的模型名', b.arm_init_model === real, String(b.arm_init_model));
  check('on/suffix 新构建：回显的凭据值仍以占位符出现',
    ['review_stdout', 'review_stderr', 'arm_raw', 'arm_stderr'].every((n) => b.placeholder_in.includes(n)), b.placeholder_in.join(','));
  check('on/suffix 新构建：服务端回报名收进留痕、判为一致',
    isDeepStrictEqual(b.reported_models, ['gw-ev258-max-01']) && b.consistency === true,
    `${JSON.stringify(b.reported_models)} / ${b.consistency}`);
  check('on/suffix：model_flag 旧 null（没核对成）、新 false（所选 haiku ≠ 回读名，核对不符）', a.model_flag === null && b.model_flag === false,
    `${a.model_flag} / ${b.model_flag}`);
}

for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  ${c.detail}` : ''}`);
const bad = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length} 项，${bad === 0 ? '全部通过' : `${bad} 项不通过`}`);
process.exit(bad === 0 ? 0 : 1);
