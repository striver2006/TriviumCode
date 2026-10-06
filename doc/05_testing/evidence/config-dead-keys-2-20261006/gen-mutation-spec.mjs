// 生成「空配置项收口二」（EV-30 ②③）的变异规格。本批未走双审，规格由执笔方自定。
// 两份：ts（源码，逐条预跑 + 变异装置）与 schema（.json 进不了装置——闸 4 只认 dist/test 下的 .js 产物——只做逐条预跑；
// 预跑脚本每条都会 build --with-tests，schema 的拷贝随之更新）。
// 用法（在仓库根）：node doc/05_testing/evidence/config-dead-keys-2-20261006/gen-mutation-spec.mjs 〈ts 规格路径〉 〈schema 规格路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const [OUT_TS, OUT_SCHEMA] = process.argv.slice(2);
if (!OUT_TS || !OUT_SCHEMA) throw new Error('用法：node gen-mutation-spec.mjs 〈ts 规格路径〉 〈schema 规格路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CFG = 'src/trivium/config.ts';
const SCHEMA = 'skills/dual-critic/schema/config.v2.json';
const CONSUMERS = 'dist/test/test/unit/config-consumers.test.js';
const SCHEMA_SUITE = 'dist/test/test/unit/config-schema.test.js';

const tsCases = [
  {
    id: 'M1', desc: '废弃表漏登 review.parallel（出现了也不提示）', file: CFG,
    find: "  { path: ['review', 'parallel'] }, // EV-30 ②（2026-10-06）：runner 恒并行；单侧调试用 --critics\n",
    replace: '', expect: CONSUMERS,
  },
  {
    id: 'M2', desc: '废弃表漏登 isolation.deny_via_cli', file: CFG,
    find: "  { path: ['isolation', 'deny_via_cli'] }, // EV-30 ③（2026-10-06）：注不注入路径级 deny 只看探针实测\n",
    replace: '', expect: CONSUMERS,
  },
  {
    id: 'M3', desc: '默认值加回 review.parallel（改前形态）', file: CFG,
    find: '    review: {\n      // parallel 已删除（EV-30 ②）：见 DEPRECATED_CONFIG_KEYS\n',
    replace: '    review: {\n      parallel: true,\n', expect: CONSUMERS,
  },
];
const schemaCases = [
  {
    id: 'S1', desc: 'schema review.required 加回 parallel（不带它的配置会校验失败）', file: SCHEMA,
    find: '      "required": [\n        "failure_policy",',
    replace: '      "required": [\n        "parallel",\n        "failure_policy",', expect: SCHEMA_SUITE,
  },
  {
    id: 'S2', desc: 'schema 去掉 deny_via_cli 的 deprecated 标注', file: SCHEMA,
    find: '          ],\n          "deprecated": true,\n          "description": "已废弃（2026-10-06，EV-30 ③）',
    replace: '          ],\n          "description": "已废弃（2026-10-06，EV-30 ③）', expect: SCHEMA_SUITE,
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
