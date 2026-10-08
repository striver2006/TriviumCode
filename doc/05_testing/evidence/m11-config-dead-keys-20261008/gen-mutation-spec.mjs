// 生成 M11 第 8 步（EV-30 ④～⑦ 四个零消费方配置项删除）的变异规格。B 档未走双审，规格由执笔方自定。
// 照 evidence/config-dead-keys-2-20261006/gen-mutation-spec.mjs 的做法分两份：
//   ts（源码，逐条预跑 + 变异装置）与 schema（.json 进不了装置——闸 4 只认 dist/test 下的 .js 产物——只做逐条预跑；
//   预跑脚本每条都会 build --with-tests，schema 的拷贝随之更新）。
// ts 规格分两类：A 废弃表 / 默认值回潮（M1～M8，对 config-consumers）；B「假想接线」（W1～W4）——把某个旧键真的接上，
// 看「行为不变」那几格会不会红：它们守的正是「旧配置里留着这些键不改变任何行为」。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-config-dead-keys-20261008/gen-mutation-spec.mjs 〈ts 规格路径〉 〈schema 规格路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const [OUT_TS, OUT_SCHEMA] = process.argv.slice(2);
if (!OUT_TS || !OUT_SCHEMA) throw new Error('用法：node gen-mutation-spec.mjs 〈ts 规格路径〉 〈schema 规格路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CFG = 'src/trivium/config.ts';
const TOPIC = 'src/trivium/topic.ts';
const GATE = 'src/trivium/gate.ts';
const ZCODE = 'src/trivium/adapters/zcode.ts';
const SCHEMA = 'skills/dual-critic/schema/config.v2.json';
const CONSUMERS = 'dist/test/test/unit/config-consumers.test.js';
const SCHEMA_SUITE = 'dist/test/test/unit/config-schema.test.js';
const TOPIC_SUITE = 'dist/test/test/unit/topic.test.js';
const GATE_SUITE = 'dist/test/test/unit/gate.test.js';
const ZCODE_SUITE = 'dist/test/test/unit/zcode-model-selection.test.js';

const tsCases = [
  {
    id: 'M1', desc: '废弃表漏登 topic.forbid_chars（出现了也不提示）', file: CFG,
    find: "  { path: ['topic', 'forbid_chars'] }, // ④ 主题名校验是 naming.ts 的独立实现；接线会允许把 /、.. 移出禁止集\n",
    replace: '', expect: CONSUMERS,
  },
  {
    id: 'M2', desc: '废弃表漏登 gate.require_adjudication', file: CFG,
    find: "  { path: ['gate', 'require_adjudication'] }, // ⑤ 闸门恒强制逐条裁决；接线等于给核心判据加关闭开关\n",
    replace: '', expect: CONSUMERS,
  },
  {
    id: 'M3', desc: '废弃表漏登 agents.glm.max_turns', file: CFG,
    find: "  { path: ['agents', 'glm', 'max_turns'] }, // ⑥ zcode 0.16.5 无处可接（M0 坑清单 C-01：--max-turns 被拒）\n",
    replace: '', expect: CONSUMERS,
  },
  {
    id: 'M4', desc: '废弃表漏登 agents.glm.unsupported_override', file: CFG,
    find: "  { path: ['agents', 'glm', 'unsupported_override'] }, // ⑦ annotate 语义已由 model_unenforced 播报承担\n",
    replace: '', expect: CONSUMERS,
  },
  {
    id: 'M5', desc: "agents.glm.max_turns 改成 '*' 通配（别家同名键会被误报）", file: CFG,
    find: "  { path: ['agents', 'glm', 'max_turns'] },",
    replace: "  { path: ['agents', '*', 'max_turns'] },", expect: CONSUMERS,
  },
  {
    id: 'M6', desc: '默认值加回 topic.forbid_chars（改前形态）', file: CFG,
    find: '    topic: { max_len: 64 }, // forbid_chars 已删除（EV-30 ④）：见 DEPRECATED_CONFIG_KEYS\n',
    replace: "    topic: { max_len: 64, forbid_chars: ['/', '\\\\', '..', ' '] },\n", expect: CONSUMERS,
  },
  {
    id: 'M7', desc: '默认值加回 gate.require_adjudication（改前形态）', file: CFG,
    find: '      // require_adjudication 已删除（EV-30 ⑤）：见 DEPRECATED_CONFIG_KEYS\n',
    replace: '      require_adjudication: true,\n', expect: CONSUMERS,
  },
  {
    id: 'M8', desc: '默认值加回 agents.glm 的 max_turns 与 unsupported_override（改前形态）', file: CFG,
    find: "      glm: { vendor: 'zcode', entry: null },\n",
    replace: "      glm: { vendor: 'zcode', entry: null, max_turns: 40, unsupported_override: 'reject' },\n", expect: CONSUMERS,
  },
  {
    id: 'W1', desc: '假想接线 forbid_chars：旧配置写空数组就跳过主题名校验', file: TOPIC,
    find: '  const v = validateTopic(raw, ctx.config.topic.max_len);\n',
    replace:
      '  const v = (ctx.config.topic as { forbid_chars?: string[] }).forbid_chars?.length === 0\n' +
      '    ? { ok: true, normalized: raw.trim().replace(/\\s+/g, \'-\') } as ReturnType<typeof validateTopic>\n' +
      '    : validateTopic(raw, ctx.config.topic.max_len);\n',
    expect: TOPIC_SUITE,
  },
  {
    id: 'W2', desc: '假想接线 require_adjudication：旧配置写 false 就不报漏裁', file: GATE,
    find: "  if (missing.length > 0) {\n    failures.push({\n      code: 'missing_findings',",
    replace:
      "  if (missing.length > 0 && (cfg.gate as { require_adjudication?: boolean }).require_adjudication !== false) {\n" +
      "    failures.push({\n      code: 'missing_findings',",
    expect: GATE_SUITE,
  },
  {
    id: 'W3', desc: '假想接线 max_turns：旧配置带它就给 zcode 加 --max-turns', file: ZCODE,
    find: '        prompt: req.brief_text,\n        readonlyArgs,\n',
    replace:
      '        prompt: req.brief_text,\n' +
      '        readonlyArgs: (ctx.cfg.agents.glm as { max_turns?: number } | undefined)?.max_turns !== undefined\n' +
      "          ? [...readonlyArgs, '--max-turns', String((ctx.cfg.agents.glm as { max_turns?: number }).max_turns)]\n" +
      '          : readonlyArgs,\n',
    expect: ZCODE_SUITE,
  },
  {
    id: 'W4', desc: '假想接线 unsupported_override：旧配置写 reject 且模型未受控就拒跑', file: ZCODE,
    find: '    const unenforced = decideModelUnenforced(overrideAttempted, req.model, modelEffective, home.cause, home.reason);\n',
    replace:
      '    const unenforced = decideModelUnenforced(overrideAttempted, req.model, modelEffective, home.cause, home.reason);\n' +
      "    if (unenforced && (ctx.cfg.agents.glm as { unsupported_override?: string } | undefined)?.unsupported_override === 'reject') {\n" +
      "      return failedResult('glm', { status: 'failed', reason: 'unsupported_override: reject' });\n" +
      '    }\n',
    expect: ZCODE_SUITE,
  },
];

const schemaCases = [
  {
    id: 'S1', desc: 'schema topic.required 加回 forbid_chars（不带它的配置会校验失败）', file: SCHEMA,
    find: '      "required": [\n        "max_len"\n      ],',
    replace: '      "required": [\n        "max_len",\n        "forbid_chars"\n      ],', expect: SCHEMA_SUITE,
  },
  {
    id: 'S2', desc: 'schema gate.required 加回 require_adjudication', file: SCHEMA,
    find: '      "required": [\n        "allow_defer",',
    replace: '      "required": [\n        "require_adjudication",\n        "allow_defer",', expect: SCHEMA_SUITE,
  },
  {
    id: 'S3', desc: 'schema zcode 分支 required 加回 max_turns 与 unsupported_override', file: SCHEMA,
    find: '            "required": [\n              "vendor",\n              "entry"\n            ],',
    replace: '            "required": [\n              "vendor",\n              "entry",\n              "max_turns",\n              "unsupported_override"\n            ],',
    expect: SCHEMA_SUITE,
  },
  {
    id: 'S4', desc: 'schema 去掉 unsupported_override 的 deprecated 标注', file: SCHEMA,
    find: '                ],\n                "deprecated": true,\n                "description": "已废弃（2026-10-08，EV-30 ⑦）',
    replace: '                ],\n                "description": "已废弃（2026-10-08，EV-30 ⑦）', expect: SCHEMA_SUITE,
  },
  {
    id: 'S5', desc: 'schema 放宽 max_turns 的类型约束（去掉 minimum）', file: SCHEMA,
    find: '              "max_turns": {\n                "type": "integer",\n                "minimum": 1,\n',
    replace: '              "max_turns": {\n                "type": "integer",\n', expect: SCHEMA_SUITE,
  },
];

const check = (cases) => {
  for (const c of cases) {
    const n = read(c.file).split(c.find).length - 1;
    if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
    if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
    if ([...c.replace].some((ch, i) => ch.charCodeAt(0) === 36 && /[$&`'0-9<]/.test(c.replace[i + 1] ?? ''))) {
      throw new Error(`${c.id} 的 replace 含特殊替换模式`);
    }
  }
  return { targets: [...new Set(cases.map((c) => c.file))], suites: [...new Set(cases.map((c) => c.expect))], cases };
};
fs.writeFileSync(OUT_TS, JSON.stringify(check(tsCases), null, 2) + '\n');
fs.writeFileSync(OUT_SCHEMA, JSON.stringify(check(schemaCases), null, 2) + '\n');
console.error(`规格 ts ${tsCases.length} 条、schema ${schemaCases.length} 条`);
