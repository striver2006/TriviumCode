// 契约侧变异 M16（计划 r2 §4.3）：run.v2 schema 的 termination 去掉 additionalProperties: false ⇒ S1 应红。
// scripts/mutation-check.mjs 只认 src/*.ts（被测产物按 .ts → dist/test/*.js 映射），而 schema 在测试产物里是
// schemas.js 运行时 import 的一份拷贝（dist/test/skills/dual-critic/schema/run.v2.json，第一版误以为内联进 schemas.js、
// 产物哈希判「未变」），所以单独做：备份 → 变异 → 重建测试产物 → 断言那份拷贝确实变了 → 跑 run-meta-strict → 恢复并逐字节核对 → 再重建。
// 用法（在仓库根）：node contract-mutation.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const SCHEMA = 'skills/dual-critic/schema/run.v2.json';
const ARTIFACT = 'dist/test/skills/dual-critic/schema/run.v2.json';
const SUITE = 'dist/test/test/unit/run-meta-strict.test.js';
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const build = () => execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { stdio: 'ignore' });
const runSuite = () => {
  try {
    execFileSync(process.execPath, ['--test', SUITE], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return Number(/ℹ fail (\d+)/.exec(String(e.stdout))?.[1] ?? 1);
  }
};

const original = fs.readFileSync(SCHEMA, 'utf8');
const baseHash = sha(SCHEMA);
build();
const baseFail = runSuite();
if (baseFail !== 0) throw new Error(`基线不是全绿（fail=${baseFail}）`);
const baseArt = sha(ARTIFACT);

const find = '"required": ["by", "exit_code"],\n          "additionalProperties": false,\n';
if (original.split(find).length - 1 !== 1) throw new Error('M16 的 find 不唯一');
const results = [];
try {
  fs.writeFileSync(SCHEMA, original.replace(find, '"required": ["by", "exit_code"],\n'));
  build();
  if (sha(ARTIFACT) === baseArt) {
    results.push({ id: 'M16', verdict: '✖ 产物哈希未变——变异没进被测产物' });
  } else {
    const fail = runSuite();
    results.push({ id: 'M16', desc: 'termination 的 worker_exception 分支去掉 additionalProperties: false ⇒ S1', verdict: fail > 0 ? `✓ 咬住（fail=${fail}）` : '✖ 没红', fail });
  }
} finally {
  fs.writeFileSync(SCHEMA, original);
  if (sha(SCHEMA) !== baseHash) throw new Error('恢复 schema 后哈希不符——停下来人工处理');
  build();
}
console.log(JSON.stringify({ baseline: { fail: baseFail }, results }, null, 2));
