// EV-257 零配额验收的判读半边（计划 r2 §3.1）：读 accept-run.mjs 产出的 12 份 JSON，逐条判定并打印。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-readback-model-20261025/accept-readout.mjs
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const DIR = 'doc/05_testing/evidence/gateway-readback-model-20261025';
const load = (t, m, s) => JSON.parse(fs.readFileSync(`${DIR}/accept-${t}-${m}-${s}.json`, 'utf8'));
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const base = load('base', 'off', 'default');
const cur = load('new', 'off', 'default');
check('两侧被测产物不同（adapters/claude.js sha256）', base.adapter_sha256 !== cur.adapter_sha256,
  `${base.adapter_sha256.slice(0, 12)} / ${cur.adapter_sha256.slice(0, 12)}`);

for (const m of ['off', 'on']) for (const s of ['default', 'model', 'cred']) for (const t of ['base', 'new']) {
  const r = load(t, m, s);
  const leaked = Object.entries(r.credential_hits).filter(([, ks]) => ks.length > 0);
  check(`${t}/${m}/${s}：凭据键的值在全部输出里零命中`, leaked.length === 0, JSON.stringify(leaked));
}

// 未开启：三种情形新旧逐项相同（归一化后的全部输出、组装结果、探针结论、目录臂结论）
for (const s of ['default', 'model', 'cred']) {
  const a = load('base', 'off', s), b = load('new', 'off', s);
  check(`off/${s}：新旧归一化输出逐项相同`, isDeepStrictEqual(a.normalized_sha256, b.normalized_sha256));
  check(`off/${s}：回读与 model_flag 新旧相同`, isDeepStrictEqual([a.readback, a.model_flag], [b.readback, b.model_flag]),
    JSON.stringify([b.readback, b.model_flag]));
}
// 开启、网关不回报模型名键的值：新旧也应逐项相同（修复只影响模型名键的值出现在输出里时）
{
  const a = load('base', 'on', 'default'), b = load('new', 'on', 'default');
  check('on/default：新旧归一化输出逐项相同', isDeepStrictEqual(a.normalized_sha256, b.normalized_sha256));
}
// 开启、网关回报的模型名等于模型名键的值：旧占位符 + envelope，新真名 + envelope
{
  const a = load('base', 'on', 'model'), b = load('new', 'on', 'model');
  check('on/model 基线：复现缺陷（占位符记作 envelope）',
    a.readback.model_effective === '<redacted-env>' && a.readback.model_effective_source === 'envelope', JSON.stringify(a.readback));
  check('on/model 新构建：记真实模型名、来源 envelope',
    b.readback.model_effective === 'gw-ev257-model-01' && b.readback.model_effective_source === 'envelope', JSON.stringify(b.readback));
  check('on/model 新构建：探针臂 init.model 为真实模型名', b.arm_init_model === 'gw-ev257-model-01', String(b.arm_init_model));
  check('on/model 新构建：回显的凭据值仍以占位符出现（stdout / stderr）',
    ['review_stdout', 'review_stderr', 'arm_raw', 'arm_stderr'].every((n) => b.placeholder_in.includes(n)), b.placeholder_in.join(','));
  check('on/model 新构建：model_flag 按真实值比（所选 haiku ≠ 网关回报名 → false，是「核对不符」）', b.model_flag === false, String(b.model_flag));
}
// 开启、网关把凭据值当模型名回显：旧占位符 + envelope，新 null + unverified
{
  const a = load('base', 'on', 'cred'), b = load('new', 'on', 'cred');
  check('on/cred 基线：占位符记作 envelope', a.readback.model_effective === '<redacted-env>' && a.readback.model_effective_source === 'envelope',
    JSON.stringify(a.readback));
  check('on/cred 新构建：记 null + unverified', b.readback.model_effective === null && b.readback.model_effective_source === 'unverified',
    JSON.stringify(b.readback));
  check('on/cred：model_flag 旧 false（误判核对不符）、新 null（没核对成）', a.model_flag === false && b.model_flag === null,
    `${a.model_flag} / ${b.model_flag}`);
}

for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  ${c.detail}` : ''}`);
const bad = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length} 项，${bad === 0 ? '全部通过' : `${bad} 项不通过`}`);
process.exit(bad === 0 ? 0 : 1);
