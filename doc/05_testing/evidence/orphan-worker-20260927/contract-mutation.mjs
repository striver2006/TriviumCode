// 契约侧变异 MC1（派生后失败的孤儿worker计划 r2 §4.3）：run.v2 schema 的 termination.by 枚举去掉 post_spawn_exception
// ⇒ S1″（新取值判错）与 S3（单一来源不等）应红。
// scripts/mutation-check.mjs 只认 src/*.ts，而 schema 在测试产物里是 schemas.js 运行时 import 的一份拷贝
// （dist/test/skills/dual-critic/schema/run.v2.json），所以单独做：
// 备份 → 变异 → 重建测试产物 → 断言那份拷贝确实变了 → 跑 run-meta-strict → 恢复并逐字节核对 → 再重建。
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
    return { fail: 0, names: [] };
  } catch (e) {
    const out = String(e.stdout);
    return {
      fail: Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? 1),
      // node --test 在末尾的失败汇总里会把失败项再列一遍，去重
      names: [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))],
    };
  }
};

const original = fs.readFileSync(SCHEMA, 'utf8');
const baseHash = sha(SCHEMA);
build();
const base = runSuite();
if (base.fail !== 0) throw new Error(`基线不是全绿（fail=${base.fail}）`);
const baseArt = sha(ARTIFACT);

const find = '"by": { "enum": ["worker_exception", "prepare_exception", "sync_exception", "post_spawn_exception"] },';
if (original.split(find).length - 1 !== 1) throw new Error('MC1 的 find 不唯一');
const results = [];
try {
  fs.writeFileSync(SCHEMA, original.replace(find, '"by": { "enum": ["worker_exception", "prepare_exception", "sync_exception"] },'));
  build();
  if (sha(ARTIFACT) === baseArt) {
    results.push({ id: 'MC1', verdict: '✖ 产物哈希未变——变异没进被测产物' });
  } else {
    const r = runSuite();
    results.push({
      id: 'MC1',
      desc: 'schema 的 termination.by 枚举去掉 post_spawn_exception ⇒ S1″（新取值判错）与 S3（单一来源不等）',
      verdict: r.fail > 0 ? `✓ 咬住（fail=${r.fail}）` : '✖ 没红',
      fail: r.fail,
      red: r.names,
    });
  }
} finally {
  fs.writeFileSync(SCHEMA, original);
  if (sha(SCHEMA) !== baseHash) throw new Error('恢复 schema 后哈希不符——停下来人工处理');
  build();
}
console.log(JSON.stringify({ baseline: { fail: base.fail }, results }, null, 2));
