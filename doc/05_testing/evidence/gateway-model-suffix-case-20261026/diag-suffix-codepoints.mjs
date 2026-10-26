// EV-258 第二轮 Windows 验收第 1 步（零配额）：读本机 ~/.claude/settings.json 的 env 段，按**构建产物里的同一份口径**
// （extractSettingsEnv、isModelNameKey、looksLikeModelName、stripContextWindowSuffix、gatewayScrubPlan、redactSecrets）
// 逐键列出守卫与是否豁免，并**直接打印模型名键末尾方括号段的码点**——第一轮只打印「形状」，形状抹掉了大小写（计划 r2 §0.4）。
// 不在脚本里另写「哪些算模型名」。输出不含任何凭据值（计划三审 CODEX-01）：
//   - 非模型名键（凭据类）：只打印长度；
//   - 已豁免的模型名键（四道守卫全过）：打印原值与末尾方括号段的码点；
//   - 未豁免的模型名键：方括号前的部分只打印形状（字母换 a、数字换 9）；末尾方括号段只有同时满足
//     ①恰为「1～4 位 ASCII 数字 + 恰好一个 ASCII 字母」②整值无模式脱敏命中 ③不与任何非模型名键同值
//     才打印码点，否则只打印长度与类别——长度上限挡不住可逆编码，误填进模型名键的短凭据会被码点原样打出。
//   - 出屏边界逐行再过产品的 scrubGatewayEnv（代码三审 CODEX-01）：豁免只说明整值不是凭据、不与凭据同值，
//     不排除凭据以子串出现在模型名值里（`〈凭据〉/qwen[1M]`）；被改写的行在行尾标注，不作逐字期望。
// 用法（仓库根，先 node scripts/build.mjs --with-tests）：
//   node doc/05_testing/evidence/gateway-model-suffix-case-20261026/diag-suffix-codepoints.mjs            # 读本机 settings.json
//   node doc/05_testing/evidence/gateway-model-suffix-case-20261026/diag-suffix-codepoints.mjs --self-test  # 合成 env 自检，不读本机文件
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve('dist/test/src/trivium', p)).href);
const { extractSettingsEnv, isModelNameKey, looksLikeModelName, stripContextWindowSuffix } = await dist('adapters/claude-route.js');
const { gatewayScrubPlan, scrubGatewayEnv } = await dist('adapters/claude.js');
const { redactSecrets } = await dist('secrets.js');

const cps = (s) => [...s].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
const shape = (v) => v.replace(/[A-Za-z]/g, 'a').replace(/[0-9]/g, '9');
const mark = (b) => (b ? 'Y' : 'N');
/** 未豁免值的末尾方括号段可打印码点的唯一形态：信息量极低，足以分辨单位字母的大小写 */
const SAFE_TAIL = /^\[[0-9]{1,4}[A-Za-z]\]$/;
const SCRUBBED_NOTE = '（该行含凭据子串或命中模式脱敏，已按产品口径脱敏；此值不作逐字期望）';

/** 拆出末尾方括号段：值以 `]` 结尾时取最后一个 `[` 起的部分，否则没有 */
function splitTail(v) {
  const i = v.lastIndexOf('[');
  return v.endsWith(']') && i >= 0 ? { head: v.slice(0, i), tail: v.slice(i) } : { head: v, tail: null };
}

/** 逐键诊断，返回 { lines, rows }；rows 给自检按键核对 */
function diagnose(env) {
  const plan = gatewayScrubPlan(env);
  const nonModelValues = new Set(Object.entries(env).filter(([k]) => !isModelNameKey(k)).map(([, v]) => v));
  const lines = [];
  const rows = {};
  lines.push(`dist/test 含第二轮代码：${stripContextWindowSuffix('x[1M]') === 'x' ? '是' : '否'}`);
  lines.push(`settings.json env 段可注入键 ${Object.keys(env).length} 个；豁免 ${plan.exemptKeys.length} 个；替换集 ${plan.replace.length} 个值`);
  lines.push('键 | 长度 | 模型名键(守卫1) | 模式脱敏无命中(守卫2) | 像模型名(守卫4) | 豁免 | 值或形状 | 末尾方括号段码点');
  for (const [k, v] of Object.entries(env)) {
    let line;
    if (!isModelNameKey(k)) {
      line = `${k} | ${v.length} | N | - | - | N | （凭据类，不打印） | -`;
    } else {
      const g2 = redactSecrets(v).count === 0;
      const g4 = looksLikeModelName(v);
      const exempt = plan.exemptKeys.includes(k);
      const { head, tail } = splitTail(v);
      let valueCol;
      let tailCol;
      if (exempt) {
        valueCol = v;
        tailCol = tail ? cps(tail) : '（无方括号后缀）';
      } else {
        valueCol = shape(head) + (tail ? '[…]' : '');
        if (!tail) tailCol = '（无方括号后缀）';
        else if (!SAFE_TAIL.test(tail)) tailCol = `（方括号段 ${tail.length} 字符，形态不在白名单，不打印）`;
        else if (!g2) tailCol = '（命中模式脱敏，不打印）';
        else if (nonModelValues.has(v)) tailCol = '（与非模型名键同值，不打印）';
        else tailCol = cps(tail);
      }
      line = `${k} | ${v.length} | Y | ${mark(g2)} | ${mark(g4)} | ${mark(exempt)} | ${valueCol} | ${tailCol}`;
    }
    const scrubbed = scrubGatewayEnv(line, env);
    if (scrubbed !== line) line = `${scrubbed} | ${SCRUBBED_NOTE}`;
    rows[k] = line;
    lines.push(line);
  }
  lines.push(`替换集各值长度（降序）：${plan.replace.map((v) => v.length).join(', ') || '（空）'}`);
  return { lines, rows };
}

if (process.argv.includes('--self-test')) {
  // 合成 env：凭据形态值运行时分段拼接；写进临时目录再经 extractSettingsEnv 读回，走与正常模式相同的解析路径
  const auth = ['st', 'auth', 'Zq9Xw2Lp'].join('-');
  const misfilled = ['aB3', 'dE6'].join('');
  const random = ['q7Xk2Lm9', 'Vb4Nc8Zr', 'T1yW6pHs'].join('');
  const synthetic = {
    ANTHROPIC_BASE_URL: 'https://selftest.invalid/api',
    ANTHROPIC_AUTH_TOKEN: auth,
    ANTHROPIC_MODEL: 'selftest-max[1M]',
    ANTHROPIC_DEFAULT_OPUS_MODEL: `x[${misfilled}]`,
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'selftest-cred[1M]',
    ANTHROPIC_EXTRA_SELFTEST: 'selftest-cred[1M]',
    CLAUDE_CODE_SUBAGENT_MODEL: `x[${random}]`,
    // 凭据以子串出现在模型名值里：整值过四道守卫被豁免，原值不能直接出屏（代码三审 CODEX-01）
    ANTHROPIC_DEFAULT_FABLE_MODEL: `${auth}/qwen[1M]`,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-ev258b-diag-'));
  let out;
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ env: synthetic }), 'utf8');
    out = diagnose(extractSettingsEnv(fs.readFileSync(file, 'utf8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const text = out.lines.join('\n');
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok });
  check('构建自证为「是」', out.lines[0] === 'dist/test 含第二轮代码：是');
  check('合法 [1M] 后缀的模型名键豁免，码点列为 U+005B U+0031 U+004D U+005D',
    / \| Y \| Y \| Y \| Y \| selftest-max\[1M\] \| U\+005B U\+0031 U\+004D U\+005D$/.test(out.rows.ANTHROPIC_MODEL));
  for (const k of ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    check(`${k}：未豁免，且该行不含任何码点`, out.rows[k].split(' | ')[5] === 'N' && !out.rows[k].includes('U+'));
  }
  for (const [label, secret] of [['凭据键的值', auth], ['基地址', synthetic.ANTHROPIC_BASE_URL], ['误填的短凭据', misfilled],
    ['与非模型名键同值的值', synthetic.ANTHROPIC_EXTRA_SELFTEST], ['方括号里的长随机串', random]]) {
    check(`输出不含${label}的原文`, !text.includes(secret));
    check(`输出不含${label}的码点序列`, !text.includes(cps(secret)) && !text.includes(cps(`[${secret}]`)));
  }
  check('含凭据子串的豁免值：确实被豁免（前提），该行已脱敏并带标注',
    gatewayScrubPlan(synthetic).exemptKeys.includes('ANTHROPIC_DEFAULT_FABLE_MODEL')
    && out.rows.ANTHROPIC_DEFAULT_FABLE_MODEL.endsWith(SCRUBBED_NOTE) && out.rows.ANTHROPIC_DEFAULT_FABLE_MODEL.includes('<redacted-env>'));
  check('凭据类键只出现长度',out.rows.ANTHROPIC_AUTH_TOKEN === `ANTHROPIC_AUTH_TOKEN | ${auth.length} | N | - | - | N | （凭据类，不打印） | -`);
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
  const bad = checks.filter((c) => !c.ok).length;
  console.log(bad === 0 ? 'SELF-TEST PASS' : `SELF-TEST FAIL（${bad} 项）`);
  process.exit(bad === 0 ? 0 : 1);
}

const file = path.join(os.homedir(), '.claude', 'settings.json');
const { lines } = diagnose(extractSettingsEnv(fs.readFileSync(file, 'utf8')));
for (const l of lines) console.log(l);
