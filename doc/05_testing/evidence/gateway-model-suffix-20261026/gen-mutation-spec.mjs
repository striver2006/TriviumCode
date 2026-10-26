// 生成 EV-258 变异规格（计划 r2 §五）：每条 find 在目标文件里须恰好命中一处，替换串不含 `$` 特殊替换模式。
// 三类必须咬住：去掉后缀放行（过窄）、后缀放行过宽（任意位置方括号 / 任意后缀内容 / 多个后缀 / 大小写与位数）、
// 剥后缀后跳过或改看原值；另含 profile 元数据两个方向、AC-20 留痕的一致性判定两个方向与留痕丢失。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-model-suffix-20261026/gen-mutation-spec.mjs
import fs from 'node:fs';

const DIR = 'doc/05_testing/evidence/gateway-model-suffix-20261026';
const ROUTE = 'src/trivium/adapters/claude-route.ts';
const TRACE = 'src/trivium/adapters/claude-trace.ts';
const ADAPTER = 'src/trivium/adapters/claude.ts';
const UNIT = 'dist/test/test/unit/claude-gateway-scrub.test.js';
const ACCESS = 'dist/test/test/unit/access-modes.test.js';
const IT = 'dist/test/test/integration/claude-gateway-env.test.js';
const DIRADAPTER = 'dist/test/test/integration/claude-directory-adapter.test.js';

const PATTERN = 'const CONTEXT_WINDOW_SUFFIX_PATTERN = String.raw`\\[[1-9][0-9]{0,3}[km]\\]`;';
const pattern = (body) => `const CONTEXT_WINDOW_SUFFIX_PATTERN = String.raw\`${body}\`;`;
const EXEC = '  const m = CONTEXT_WINDOW_SUFFIX.exec(value);';
const STRIP_AND_CHARSET = '  const base = stripContextWindowSuffix(value);\n  if (!/^[\\w./:+-]{1,128}$/.test(base)) return false;';
const CHARSET = '  if (!/^[\\w./:+-]{1,128}$/.test(base)) return false;';
const UUID = '  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return false;';
const PROFILE = 'const PROFILE_MODEL_VALUE = String.raw`[\\w.\\/:+-]+(?:${CONTEXT_WINDOW_SUFFIX_PATTERN})?`;';
const COLLECT = "      if (typeof m === 'string' && m.length > 0 && !reportedModels.includes(m)) reportedModels.push(m);";
const BARE = "  const bareBase = b !== m && !b.includes('[');";
const EVERY = '  return reported.every((r) => r === m || (bareBase && r === b));';
const CONSISTENT = '            consistent: claudeModelConsistency(trace.init, trace.reportedModels),';

const cases = [
  // ── 第一类：去掉后缀放行（过窄） ──
  { id: 'M1', desc: '去掉后缀放行：stripContextWindowSuffix 恒不剥', file: ROUTE, find: EXEC, replace: '  const m = null;', expect: UNIT },
  { id: 'M1b', desc: '同 M1，对集成 E11', file: ROUTE, find: EXEC, replace: '  const m = null;', expect: IT },
  { id: 'M8', desc: '剥了也白剥：字符集判据改看原值', file: ROUTE, find: CHARSET,
    replace: CHARSET.replace('.test(base)', '.test(value)'), expect: UNIT },
  { id: 'M8b', desc: '同 M8，对集成 E11', file: ROUTE, find: CHARSET,
    replace: CHARSET.replace('.test(base)', '.test(value)'), expect: IT },
  // ── 第二类：后缀放行过宽 ──
  { id: 'M2', desc: '过宽：不剥后缀、字符集直接收方括号（任意位置方括号）', file: ROUTE, find: STRIP_AND_CHARSET,
    replace: '  const base = value;\n  if (!/^[\\w./:+\\[\\]-]{1,128}$/.test(base)) return false;', expect: UNIT },
  { id: 'M3', desc: '过宽：后缀内容任意', file: ROUTE, find: PATTERN, replace: pattern('\\[[^\\]]*\\]'), expect: UNIT },
  { id: 'M4', desc: '过宽：可剥多个后缀', file: ROUTE, find: PATTERN, replace: pattern('(?:\\[[1-9][0-9]{0,3}[km]\\])+'), expect: UNIT },
  { id: 'M5a', desc: '过宽：后缀大小写不敏感', file: ROUTE, find: EXEC,
    replace: "  const m = new RegExp(CONTEXT_WINDOW_SUFFIX.source, 'i').exec(value);", expect: UNIT },
  { id: 'M5b', desc: '过宽：后缀位数不限、可以 0 开头', file: ROUTE, find: PATTERN, replace: pattern('\\[[0-9]+[km]\\]'), expect: UNIT },
  // ── 第三类：剥后缀后跳过或改看原值 ──
  { id: 'M6', desc: '剥得到后缀就直接放行，跳过其余判据', file: ROUTE, find: STRIP_AND_CHARSET,
    replace: STRIP_AND_CHARSET.replace('\n', '\n  if (base !== value) return true;\n'), expect: UNIT },
  { id: 'M7', desc: 'UUID 判据改看原值（带后缀的 UUID 漏网）', file: ROUTE, find: UUID,
    replace: UUID.replace('.test(base)', '.test(value)'), expect: UNIT },
  // ── profile 元数据两个方向 ──
  { id: 'M9', desc: 'profile 元数据不放行后缀', file: ROUTE, find: PROFILE,
    replace: 'const PROFILE_MODEL_VALUE = String.raw`[\\w.\\/:+-]+`;', expect: ACCESS },
  { id: 'M10', desc: 'profile 元数据放行任意方括号内容', file: ROUTE, find: PROFILE,
    replace: 'const PROFILE_MODEL_VALUE = String.raw`[\\w.\\/:+-]+(?:\\[[^\\]]*\\])?`;', expect: ACCESS },
  // ── AC-20 留痕 ──
  { id: 'M11', desc: '一致性过宽：剥后缀分支改为前缀比较', file: TRACE, find: EVERY,
    replace: '  return reported.every((r) => r === m || (bareBase && m.startsWith(r)));', expect: UNIT },
  { id: 'M12', desc: '一致性过窄：去掉剥后缀那一支', file: TRACE, find: EVERY,
    replace: '  return reported.every((r) => r === m);', expect: UNIT },
  { id: 'M12b', desc: '同 M12，对集成 E11', file: TRACE, find: EVERY,
    replace: '  return reported.every((r) => r === m);', expect: IT },
  { id: 'M13', desc: '留痕丢失：reportedModels 恒空', file: TRACE, find: COLLECT,
    replace: '      if (m === COLLECT_NEVER) reportedModels.push(m);'.replace('COLLECT_NEVER', "'\\u0000never'"), expect: UNIT },
  { id: 'M13b', desc: '同 M13，对集成 E11', file: TRACE, find: COLLECT,
    replace: '      if (m === COLLECT_NEVER) reportedModels.push(m);'.replace('COLLECT_NEVER', "'\\u0000never'"), expect: IT },
  { id: 'M14', desc: '一致性过宽：不核剥后部分是否还含方括号', file: TRACE, find: BARE,
    replace: '  const bareBase = b !== m;', expect: UNIT },
  { id: 'M15', desc: '留痕写错：trace.json 的 consistent 恒为 false', file: ADAPTER, find: CONSISTENT,
    replace: '            consistent: false,', expect: DIRADAPTER },
  { id: 'M16', desc: '空串混进回报值（计划三审 AGY-02）', file: TRACE, find: COLLECT,
    replace: "      if (typeof m === 'string' && !reportedModels.includes(m)) reportedModels.push(m);", expect: UNIT },
];

const targets = [ROUTE, TRACE, ADAPTER];
const src = Object.fromEntries(targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
for (const c of cases) {
  const n = src[c.file].split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id}：find 在 ${c.file} 命中 ${n} 处，须恰好 1 处`);
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id}：替换串含 $ 特殊替换模式`);
  if (c.replace === c.find) throw new Error(`${c.id}：替换串与 find 相同`);
}
const spec = { targets, suites: [UNIT, ACCESS, IT, DIRADAPTER], cases };
fs.writeFileSync(`${DIR}/mutation-spec.json`, JSON.stringify(spec, null, 2) + '\n');
console.log(`已生成 ${cases.length} 条，find 全部唯一`);
