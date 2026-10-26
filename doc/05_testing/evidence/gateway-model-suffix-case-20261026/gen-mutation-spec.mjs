// 生成 EV-258 第二轮变异规格（计划 r2 §五）：每条 find 在目标文件里须恰好命中一处，替换串不含 `$` 特殊替换模式。
// A 部分：第一轮 21 条（evidence/gateway-model-suffix-20261026/gen-mutation-spec.mjs）按新源码重生成——find 里的单位类
// 随之改为 [kKmM]，M4 与 M5b 的替换串里内嵌的单位类也同步（计划三审 GLM-01）；M5a（加 i 旗标）放宽后是等价变异，删除。
// B 部分：本轮新增，两个方向都咬——去掉大写放行（C1、C6 丢了小写）与过宽（C2 单位任意字母、C3 多个字母、
// C4 Unicode 折叠、C5 键名随之放宽）。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-model-suffix-case-20261026/gen-mutation-spec.mjs
import fs from 'node:fs';

const DIR = 'doc/05_testing/evidence/gateway-model-suffix-case-20261026';
const ROUTE = 'src/trivium/adapters/claude-route.ts';
const TRACE = 'src/trivium/adapters/claude-trace.ts';
const ADAPTER = 'src/trivium/adapters/claude.ts';
const UNIT = 'dist/test/test/unit/claude-gateway-scrub.test.js';
const ACCESS = 'dist/test/test/unit/access-modes.test.js';
const IT = 'dist/test/test/integration/claude-gateway-env.test.js';
const DIRADAPTER = 'dist/test/test/integration/claude-directory-adapter.test.js';

const UNIT_CLASS = '[kKmM]';
const PATTERN = `const CONTEXT_WINDOW_SUFFIX_PATTERN = String.raw\`\\[[1-9][0-9]{0,3}${UNIT_CLASS}\\]\`;`;
const pattern = (body) => `const CONTEXT_WINDOW_SUFFIX_PATTERN = String.raw\`${body}\`;`;
const EXEC = '  const m = CONTEXT_WINDOW_SUFFIX.exec(value);';
const STRIP_AND_CHARSET = '  const base = stripContextWindowSuffix(value);\n  if (!/^[\\w./:+-]{1,128}$/.test(base)) return false;';
const CHARSET = '  if (!/^[\\w./:+-]{1,128}$/.test(base)) return false;';
const UUID = '  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return false;';
const PROFILE = 'const PROFILE_MODEL_VALUE = String.raw`[\\w.\\/:+-]+(?:${CONTEXT_WINDOW_SUFFIX_PATTERN})?`;';
// 整行正则的构造以 `$` 加反引号收尾，改写它的替换串会撞 `$` 特殊替换模式；与 C4 同法只改 exec 一行
const PROFILE_EXEC = '    const m = PROFILE_MODEL_LINE.exec(line);';
const COLLECT = "      if (typeof m === 'string' && m.length > 0 && !reportedModels.includes(m)) reportedModels.push(m);";
const BARE = "  const bareBase = b !== m && !b.includes('[');";
const EVERY = '  return reported.every((r) => r === m || (bareBase && r === b));';
const CONSISTENT = '            consistent: claudeModelConsistency(trace.init, trace.reportedModels),';

const cases = [
  // ══ A：第一轮 21 条按新源码重生成（M5a 删除） ══
  // ── 去掉后缀放行（过窄） ──
  { id: 'M1', desc: '去掉后缀放行：stripContextWindowSuffix 恒不剥', file: ROUTE, find: EXEC, replace: '  const m = null;', expect: UNIT },
  { id: 'M1b', desc: '同 M1，对集成 E11 / E12', file: ROUTE, find: EXEC, replace: '  const m = null;', expect: IT },
  { id: 'M8', desc: '剥了也白剥：字符集判据改看原值', file: ROUTE, find: CHARSET,
    replace: CHARSET.replace('.test(base)', '.test(value)'), expect: UNIT },
  { id: 'M8b', desc: '同 M8，对集成 E11 / E12', file: ROUTE, find: CHARSET,
    replace: CHARSET.replace('.test(base)', '.test(value)'), expect: IT },
  // ── 后缀放行过宽 ──
  { id: 'M2', desc: '过宽：不剥后缀、字符集直接收方括号（任意位置方括号）', file: ROUTE, find: STRIP_AND_CHARSET,
    replace: '  const base = value;\n  if (!/^[\\w./:+\\[\\]-]{1,128}$/.test(base)) return false;', expect: UNIT },
  { id: 'M3', desc: '过宽：后缀内容任意', file: ROUTE, find: PATTERN, replace: pattern('\\[[^\\]]*\\]'), expect: UNIT },
  { id: 'M4', desc: '过宽：可剥多个后缀', file: ROUTE, find: PATTERN, replace: pattern(`(?:\\[[1-9][0-9]{0,3}${UNIT_CLASS}\\])+`), expect: UNIT },
  { id: 'M5b', desc: '过宽：后缀位数不限、可以 0 开头', file: ROUTE, find: PATTERN, replace: pattern(`\\[[0-9]+${UNIT_CLASS}\\]`), expect: UNIT },
  // ── 剥后缀后跳过或改看原值 ──
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
  { id: 'M12b', desc: '同 M12，对集成 E11 / E12', file: TRACE, find: EVERY,
    replace: '  return reported.every((r) => r === m);', expect: IT },
  { id: 'M13', desc: '留痕丢失：reportedModels 恒空', file: TRACE, find: COLLECT,
    replace: '      if (m === COLLECT_NEVER) reportedModels.push(m);'.replace('COLLECT_NEVER', "'\\u0000never'"), expect: UNIT },
  { id: 'M13b', desc: '同 M13，对集成 E11 / E12', file: TRACE, find: COLLECT,
    replace: '      if (m === COLLECT_NEVER) reportedModels.push(m);'.replace('COLLECT_NEVER', "'\\u0000never'"), expect: IT },
  { id: 'M14', desc: '一致性过宽：不核剥后部分是否还含方括号', file: TRACE, find: BARE,
    replace: '  const bareBase = b !== m;', expect: UNIT },
  { id: 'M15', desc: '留痕写错：trace.json 的 consistent 恒为 false', file: ADAPTER, find: CONSISTENT,
    replace: '            consistent: false,', expect: DIRADAPTER },
  { id: 'M16', desc: '空串混进回报值（计划三审 AGY-02）', file: TRACE, find: COLLECT,
    replace: "      if (typeof m === 'string' && !reportedModels.includes(m)) reportedModels.push(m);", expect: UNIT },

  // ══ B：本轮新增 ══
  // ── 去掉大写放行（过窄） ──
  { id: 'C1', desc: '去掉大写放行：单位回到只认小写 [km]（第一轮）', file: ROUTE, find: PATTERN,
    replace: pattern('\\[[1-9][0-9]{0,3}[km]\\]'), expect: UNIT },
  { id: 'C1b', desc: '同 C1，对集成 E12', file: ROUTE, find: PATTERN, replace: pattern('\\[[1-9][0-9]{0,3}[km]\\]'), expect: IT },
  { id: 'C1c', desc: '同 C1，对 profile 元数据', file: ROUTE, find: PATTERN, replace: pattern('\\[[1-9][0-9]{0,3}[km]\\]'), expect: ACCESS },
  { id: 'C6', desc: '只放行大写、丢了小写：单位改为 [KM]', file: ROUTE, find: PATTERN,
    replace: pattern('\\[[1-9][0-9]{0,3}[KM]\\]'), expect: UNIT },
  // ── 过宽 ──
  { id: 'C2', desc: '过宽：单位任意字母 [A-Za-z]', file: ROUTE, find: PATTERN,
    replace: pattern('\\[[1-9][0-9]{0,3}[A-Za-z]\\]'), expect: UNIT },
  { id: 'C2b', desc: '同 C2，对 profile 元数据', file: ROUTE, find: PATTERN,
    replace: pattern('\\[[1-9][0-9]{0,3}[A-Za-z]\\]'), expect: ACCESS },
  { id: 'C3', desc: '过宽：单位可以多个字母 [kKmM]+', file: ROUTE, find: PATTERN,
    replace: pattern(`\\[[1-9][0-9]{0,3}${UNIT_CLASS}+\\]`), expect: UNIT },
  { id: 'C4', desc: '过宽：改用 Unicode 大小写折叠（exec 前加 iu 旗标，开尔文符号折成 k，计划三审 GLM-02）', file: ROUTE, find: EXEC,
    replace: "  const m = new RegExp(CONTEXT_WINDOW_SUFFIX.source, 'iu').exec(value);", expect: UNIT },
  { id: 'C5', desc: '过宽：profile 整行正则加 i 旗标，键名随之大小写不敏感', file: ROUTE, find: PROFILE_EXEC,
    replace: "    const m = new RegExp(PROFILE_MODEL_LINE.source, 'i').exec(line);", expect: ACCESS },
];

const targets = [ROUTE, TRACE, ADAPTER];
const src = Object.fromEntries(targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
for (const c of cases) {
  const n = src[c.file].split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id}：find 在 ${c.file} 命中 ${n} 处，须恰好 1 处`);
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id}：替换串含 $ 特殊替换模式`);
  if (c.replace === c.find) throw new Error(`${c.id}：替换串与 find 相同`);
}
if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('id 重复');
const spec = { targets, suites: [UNIT, ACCESS, IT, DIRADAPTER], cases };
fs.writeFileSync(`${DIR}/mutation-spec.json`, JSON.stringify(spec, null, 2) + '\n');
console.log(`已生成 ${cases.length} 条，find 全部唯一`);
for (const c of cases) console.log(`${c.id}\t${c.desc}\n\t- ${c.find.split('\n').join('⏎')}\n\t+ ${c.replace.split('\n').join('⏎')}`);
