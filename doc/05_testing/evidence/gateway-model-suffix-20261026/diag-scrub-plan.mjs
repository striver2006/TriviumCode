// EV-258 Windows 验收第 1 步（零配额）：读本机 ~/.claude/settings.json 的 env 段，按**构建产物里的同一份口径**
// （extractSettingsEnv、isModelNameKey、looksLikeModelName、gatewayScrubPlan）逐键列出四道守卫与是否豁免。
// 不在脚本里另写「哪些算模型名」。输出不含任何凭据值：
//   - 非模型名键（凭据类）：只打印长度；
//   - 模型名键但未豁免：打印长度与「形状」（字母换 a、数字换 9，其余原样）；
//   - 已豁免的模型名键：打印原值（模型名本就以明文进 model_effective）。
// 用法（仓库根，先 node scripts/build.mjs --with-tests）：node doc/05_testing/evidence/gateway-model-suffix-20261026/diag-scrub-plan.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve('dist/test/src/trivium', p)).href);
const { extractSettingsEnv, isModelNameKey, looksLikeModelName } = await dist('adapters/claude-route.js');
const { gatewayScrubPlan } = await dist('adapters/claude.js');
const { redactSecrets } = await dist('secrets.js');

const file = path.join(os.homedir(), '.claude', 'settings.json');
const env = extractSettingsEnv(fs.readFileSync(file, 'utf8'));
const plan = gatewayScrubPlan(env);
const shape = (v) => v.replace(/[A-Za-z]/g, 'a').replace(/[0-9]/g, '9');
const mark = (b) => (b ? 'Y' : 'N');

console.log(`settings.json env 段可注入键 ${Object.keys(env).length} 个；豁免 ${plan.exemptKeys.length} 个；替换集 ${plan.replace.length} 个值`);
console.log('键 | 长度 | 模型名键(守卫1) | 模式脱敏无命中(守卫2) | 像模型名(守卫4) | 豁免 | 形状或值');
for (const [k, v] of Object.entries(env)) {
  const g1 = isModelNameKey(k);
  const exempt = plan.exemptKeys.includes(k);
  if (!g1) {
    console.log(`${k} | ${v.length} | N | - | - | N | （凭据类，不打印）`);
    continue;
  }
  const g2 = redactSecrets(v).count === 0;
  const g4 = looksLikeModelName(v);
  console.log(`${k} | ${v.length} | Y | ${mark(g2)} | ${mark(g4)} | ${mark(exempt)} | ${exempt ? v : shape(v)}`);
}
console.log(`替换集各值长度（降序）：${plan.replace.map((v) => v.length).join(', ') || '（空）'}`);
