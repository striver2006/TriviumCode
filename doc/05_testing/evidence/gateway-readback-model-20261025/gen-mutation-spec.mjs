// 生成 EV-257 变异规格（计划 r2 §2.3）：每条 find 在目标文件里须恰好命中一处，替换串不含 `$` 特殊替换模式。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-readback-model-20261025/gen-mutation-spec.mjs
import fs from 'node:fs';

const DIR = 'doc/05_testing/evidence/gateway-readback-model-20261025';
const ROUTE = 'src/trivium/adapters/claude-route.ts';
const ADAPTER = 'src/trivium/adapters/claude.ts';
const TRACE = 'src/trivium/adapters/claude-trace.ts';
const SECRETS = 'src/trivium/secrets.ts';
const PROBE = 'src/trivium/probes/claude.ts';
const IT = 'dist/test/test/integration/claude-gateway-env.test.js';
const UNIT = 'dist/test/test/unit/claude-gateway-scrub.test.js';

const KEY_REGEX = '  if (!/^(ANTHROPIC|CLAUDE)_(?:[A-Z0-9]+_)*MODEL(?:_NAME)?$/.test(key)) return false;';
const KEY_WORDS = "  return !key.split('_').some((seg) => CREDENTIAL_KEY_WORDS.has(seg));";
const GUARDS = '    isModelNameKey(k) && redactSecrets(v).count === 0 && looksLikeModelName(v));';
const EXEMPT_FILTER = '    .filter(([k]) => !exempt.some(([e]) => e === k)).map(([, v]) => v))]';
const MARK = "  return typeof s === 'string' && (s.includes('<redacted') || s.includes('…'));";

const cases = [
  // ── 第一类：模型名键被重新纳入逐值替换 ──
  { id: 'M1', desc: '模型名键被重新纳入：isModelNameKey 恒假', file: ROUTE,
    find: KEY_WORDS, replace: '  return false;', expect: UNIT },
  { id: 'M1b', desc: '同 M1，对集成 E8', file: ROUTE,
    find: KEY_WORDS, replace: '  return false;', expect: IT },
  { id: 'M2', desc: '模型名键被重新纳入：替换集构造忽略豁免（退回修复前）', file: ADAPTER,
    find: EXEMPT_FILTER, replace: '    .map(([, v]) => v))]', expect: UNIT },
  { id: 'M2b', desc: '同 M2，对集成 E8', file: ADAPTER,
    find: EXEMPT_FILTER, replace: '    .map(([, v]) => v))]', expect: IT },
  // ── 第二类：凭据键被误放出逐值替换 ──
  { id: 'M3', desc: '凭据键被放出：isModelNameKey 恒真', file: ROUTE,
    find: KEY_REGEX, replace: '  return true;', expect: UNIT },
  { id: 'M3b', desc: '同 M3，对集成 E9（令牌值被当模型名记下）', file: ROUTE,
    find: KEY_REGEX, replace: '  return true;', expect: IT },
  { id: 'M4', desc: '凭据键被放出：去掉凭据词表', file: ROUTE,
    find: KEY_WORDS, replace: '  return true;', expect: UNIT },
  { id: 'M5', desc: '凭据键被放出：键名正则去掉前缀与后缀锚定（含 MODEL 即算）', file: ROUTE,
    find: KEY_REGEX, replace: '  if (!/MODEL/.test(key)) return false;', expect: UNIT },
  { id: 'M6', desc: '凭据键被放出：去掉守卫 2（值过 redactSecrets 无命中）', file: ADAPTER,
    find: GUARDS, replace: '    isModelNameKey(k) && looksLikeModelName(v));', expect: UNIT },
  { id: 'M7', desc: '凭据键被放出：去掉守卫 3（凭据优先）', file: ADAPTER,
    find: '  const exempt = candidates.filter(([, v]) => !credentialValues.has(v));',
    replace: '  const exempt = candidates;', expect: UNIT },
  { id: 'M8', desc: '凭据值留残段：替换集不按长度降序', file: ADAPTER,
    find: '    .sort((a, b) => b.length - a.length);', replace: '    ;', expect: UNIT },
  { id: 'M9', desc: '凭据键被放出：去掉守卫 4（正向形态约束）', file: ADAPTER,
    find: GUARDS, replace: '    isModelNameKey(k) && redactSecrets(v).count === 0);', expect: UNIT },
  { id: 'M10', desc: '凭据键被放出：键名正则改为大小写不敏感', file: ROUTE,
    find: KEY_REGEX, replace: '  if (!/^(ANTHROPIC|CLAUDE)_(?:[A-Z0-9]+_)*MODEL(?:_NAME)?$/i.test(key)) return false;', expect: UNIT },
  // ── 第三类：占位符被记作 envelope ──
  { id: 'M11', desc: '占位符记作回读成功：hasRedactionMark 恒假', file: SECRETS,
    find: MARK, replace: '  return false;', expect: UNIT },
  { id: 'M11b', desc: '同 M11，对集成 E9', file: SECRETS,
    find: MARK, replace: '  return false;', expect: IT },
  { id: 'M12', desc: '占位符记作回读成功：hasRedactionMark 不认首尾预览', file: SECRETS,
    find: MARK, replace: "  return typeof s === 'string' && s.includes('<redacted');", expect: UNIT },
  { id: 'M13', desc: '占位符记作回读成功：buildClaudeResult 的来源退回直取 init.model', file: ADAPTER,
    find: '    model_effective_source: readback.source,',
    replace: "    model_effective_source: trace.init?.model ? 'envelope' : 'unverified',", expect: UNIT },
  { id: 'M13b', desc: '占位符记作生效模型：buildClaudeResult 的模型退回直取 init.model', file: ADAPTER,
    find: '    model_effective: readback.model,', replace: '    model_effective: trace.init?.model ?? null,', expect: UNIT },
  { id: 'M14', desc: '回读被吞记成核对不符：探针 model_flag 退回原判据', file: PROBE,
    find: '      ? (modelSwallowed ? null : read.init.model === selectedModel)',
    replace: '      ? read.init.model === selectedModel', expect: IT },
  // ── 未开启零变化 ──
  { id: 'M15', desc: '零变化破坏：回读判定对正常名也强制 unverified', file: TRACE,
    find: "  return { model, source: model ? 'envelope' : 'unverified' };",
    replace: "  return { model: null, source: 'unverified' };", expect: UNIT },
  { id: 'M15b', desc: '同 M15，对集成 E10', file: TRACE,
    find: "  return { model, source: model ? 'envelope' : 'unverified' };",
    replace: "  return { model: null, source: 'unverified' };", expect: IT },
];

const targets = [ROUTE, ADAPTER, TRACE, SECRETS, PROBE];
const src = Object.fromEntries(targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
for (const c of cases) {
  const n = src[c.file].split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id}：find 在 ${c.file} 命中 ${n} 处，须恰好 1 处`);
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id}：替换串含 $ 特殊替换模式`);
}
const spec = { targets, suites: [IT, UNIT], cases };
fs.writeFileSync(`${DIR}/mutation-spec.json`, JSON.stringify(spec, null, 2) + '\n');
console.log(`已生成 ${cases.length} 条，find 全部唯一`);
