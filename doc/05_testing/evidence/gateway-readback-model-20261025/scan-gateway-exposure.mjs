// EV-257 落盘扫描（计划 r2 §3.2，计划三审 CODEX-01）：读用户级 settings.json 的 env 段，按**产品同一份口径**分类——
// 直接导入构建产物里的 `extractSettingsEnv` 与 `gatewayScrubPlan`，不在脚本里另写「哪些算模型名」：
//   - 替换集里的值（凭据类键，≥ 8 字符）在任何被扫文件里出现 ⇒ LEAK，退 1；
//   - 豁免键（过了四道守卫的模型名键）的值出现 ⇒ 只报 NOTE；
//   - 不足 8 字符、不进替换集的值不扫（产品同样不替换它们），只报个数。
// 只打印键名与命中文件，**不打印任何值**。
//
// 用法（仓库根，先 `node scripts/build.mjs --with-tests`）：
//   node doc/05_testing/evidence/gateway-readback-model-20261025/scan-gateway-exposure.mjs 〈文件或目录…〉 [--settings 〈settings.json 路径〉]
//   node doc/05_testing/evidence/gateway-readback-model-20261025/scan-gateway-exposure.mjs --self-test
// 缺省 settings 路径是 〈家目录〉/.claude/settings.json。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dist = (p) => import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium', p)).href);
const { extractSettingsEnv } = await dist('adapters/claude-route.js');
const { gatewayScrubPlan } = await dist('adapters/claude.js');

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);
  else if (st.isFile()) out.push(p);
  return out;
}

/** 扫一组路径：返回 LEAK / NOTE 记录（键名 + 文件），不含值 */
export function scan(env, targets) {
  const plan = gatewayScrubPlan(env);
  const credential = Object.entries(env).filter(([, v]) => plan.replace.includes(v));
  const exempt = Object.entries(env).filter(([k]) => plan.exemptKeys.includes(k));
  const skipped = Object.keys(env).length - credential.length - exempt.length;
  const leaks = [], notes = [];
  for (const file of targets.flatMap((t) => walk(t, []))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [k, v] of credential) if (text.includes(v)) leaks.push({ key: k, file });
    for (const [k, v] of exempt) if (text.includes(v)) notes.push({ key: k, file });
  }
  return { leaks, notes, credentialKeys: credential.map(([k]) => k), exemptKeys: plan.exemptKeys, skipped };
}

function selfTest() {
  // 合成值一律运行时拼接，静态文本里不出现完整凭据形态
  const fakeToken = ['q7Xk2Lm9', 'Vb4Nc8Zr', 'T1yW6pHs'].join('');
  const fakeAuth = ['gw', 'selftest', 'auth', '01'].join('-');
  const env = {
    ANTHROPIC_AUTH_TOKEN: fakeAuth,
    ANTHROPIC_BASE_URL: 'https://gw-selftest.invalid/api',
    ANTHROPIC_AUTH_MODEL: ['gw', 'selftest', 'pseudo', 'model'].join('-'), // 伪模型键：名字带 AUTH
    ANTHROPIC_DEFAULT_HAIKU_MODEL: fakeToken, // 模型名键里误填非标准令牌
    ANTHROPIC_MODEL: 'kimi-for-coding', // 真实模型名形态：应豁免
  };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-ev257-scan-'));
  try {
    const cells = [
      { name: '伪模型键（ANTHROPIC_AUTH_MODEL）的值泄漏 ⇒ LEAK', text: `x ${env.ANTHROPIC_AUTH_MODEL} y`, leak: 'ANTHROPIC_AUTH_MODEL' },
      { name: '模型名键里的令牌形态值泄漏 ⇒ LEAK', text: `x ${fakeToken} y`, leak: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
      { name: '真实模型名形态的豁免值出现 ⇒ 只报 NOTE、不判泄漏', text: '"model":"kimi-for-coding"', leak: null, note: 'ANTHROPIC_MODEL' },
    ];
    let bad = 0;
    for (const [i, c] of cells.entries()) {
      const f = path.join(work, `cell-${i}.txt`);
      fs.writeFileSync(f, c.text);
      const r = scan(env, [f]);
      const ok = c.leak ? r.leaks.some((l) => l.key === c.leak) : r.leaks.length === 0 && r.notes.some((n) => n.key === c.note);
      if (!ok) bad++;
      console.log(`${ok ? '✓' : '✗'} ${c.name}（leaks: ${r.leaks.map((l) => l.key).join(',') || '无'}；notes: ${r.notes.map((n) => n.key).join(',') || '无'}）`);
    }
    const plan = gatewayScrubPlan(env);
    console.log(`豁免键：${plan.exemptKeys.join(',') || '无'}`);
    console.log(bad === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL（${bad} 格）`);
    return bad === 0 ? 0 : 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());
const si = args.indexOf('--settings');
const settingsPath = si >= 0 ? args[si + 1] : path.join(os.homedir(), '.claude', 'settings.json');
const targets = si >= 0 ? args.filter((_, i) => i !== si && i !== si + 1) : args;
if (targets.length === 0) { console.error('用法：scan-gateway-exposure.mjs 〈文件或目录…〉 [--settings 〈路径〉] ｜ --self-test'); process.exit(64); }
const env = extractSettingsEnv(fs.readFileSync(settingsPath, 'utf8'));
const r = scan(env, targets);
console.log(`凭据类键 ${r.credentialKeys.length} 个、豁免模型名键 ${r.exemptKeys.length} 个（${r.exemptKeys.join(',') || '无'}）、不足 8 字符未扫 ${r.skipped} 个`);
for (const n of r.notes) console.log(`NOTE ${n.key}（模型名，允许出现） ${n.file}`);
for (const l of r.leaks) console.log(`LEAK ${l.key} ${l.file}`);
console.log(r.leaks.length === 0 ? 'RESULT: no leak' : `RESULT: leak seen（${r.leaks.length} 处）`);
process.exit(r.leaks.length === 0 ? 0 : 1);
