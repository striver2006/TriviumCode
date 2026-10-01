#!/usr/bin/env node
/**
 * 「漂移比不了不放行」（EV-139）run.v2 schema 的变异验证（计划 r2 §5.3 末段）。
 *
 * ## 为什么不走 `scripts/mutation-check.mjs`
 *
 * 装置只认 `src/*.ts`。schema 是 JSON：`validateRunMeta` 在测试里读的是构建拷进 `dist/test/skills/dual-critic/schema/`
 * 的那一份（坑清单），C1 则直接读仓库里的源 schema 与 `DRIFT_UNKNOWN_CAUSES` 比对。所以：
 *   - K1～K3 改 `dist/test/` 下的拷贝，期望 C2 变红；
 *   - K4 改源 schema 的枚举，期望 C1 变红（不重建，dist 拷贝不动）。
 *
 * **K4 动的是活工作树里进 Git 的源文件——有意偏离「活工作树不动」的既有口径**（代码双审 CODEX-04）：
 * C1 钉的就是「仓库里那份源 schema 与 `DRIFT_UNKNOWN_CAUSES` 相等」，改读副本就测不到它。
 * 恢复靠 `finally` 逐字节回写并核哈希；SIGKILL / 断电时 `finally` 不执行，残留的哨兵会挡住重跑，
 * 被改的 `skills/dual-critic/schema/run.v2.json` 在 `git status` 里可见，请在终端用 `git restore` 恢复后删哨兵。
 *
 * ## 判据：点名的用例必须红
 *
 * 每条记期望变红的用例名片段，只有它们出现在 `✖` 行里才判咬住；其余顺带变红的原样列出。
 *
 * ## 闸
 *
 * 哨兵 `.contract-mutations-running` 独占创建、善终才删；写盘前断言 find 恰好命中一处；变异后断言哈希变了；
 * 每条跑完恢复并逐字节比对；开跑前基线套件全绿。
 *
 * 用法（在仓库根，先 `node scripts/build.mjs --with-tests`）：
 *   node doc/05_testing/evidence/drift-uncomparable-20261001/contract-mutations.mjs
 * 输出：同目录 `contract-mutations-output.txt`（脚本自己写）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const SUITE = 'dist/test/test/unit/run-meta-strict.test.js';
const DIST_SCHEMA = 'dist/test/skills/dual-critic/schema/run.v2.json';
const SRC_SCHEMA = 'skills/dual-critic/schema/run.v2.json';
const C1 = 'EV-139 C1';
const C2 = 'EV-139 C2';

const ENUM = '"enum": [\n                    "object_gone",\n                    "git_error",\n                    "timeout"\n                  ]';
const CASES = [
  { id: 'K1', desc: 'cause 枚举放宽（加 pruned）', file: DIST_SCHEMA, find: ENUM,
    replace: ENUM.replace('"timeout"', '"timeout",\n                    "pruned"'), expect: [C2] },
  { id: 'K2', desc: 'unknown_reason 去掉 additionalProperties: false', file: DIST_SCHEMA,
    find: '"detail"\n              ],\n              "additionalProperties": false,',
    replace: '"detail"\n              ],', expect: [C2] },
  { id: 'K3', desc: 'unknown_reason 的 required 去掉 detail', file: DIST_SCHEMA,
    find: '"required": [\n                "cause",\n                "detail"\n              ],',
    replace: '"required": [\n                "cause"\n              ],', expect: [C2] },
  { id: 'K4', desc: '源 schema 的 cause 枚举少一项（与 DRIFT_UNKNOWN_CAUSES 不再相等）', file: SRC_SCHEMA, find: ENUM,
    replace: ENUM.replace(',\n                    "timeout"', ''), expect: [C1] },
];

const SENTINEL = path.join(ROOT, '.contract-mutations-running');
const sha = async (f) => createHash('sha256').update(await fs.readFile(path.join(ROOT, f))).digest('hex');
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

async function runSuite() {
  try {
    const r = await run(process.execPath, ['--test', '--test-reporter=spec', SUITE], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return r.stdout;
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}
const redNames = (out) => [...new Set([...out.split('✖ failing tests:')[0].matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];

await fs.writeFile(SENTINEL, String(process.pid), { flag: 'wx' });
const targets = [...new Set(CASES.map((c) => c.file))];
const base = Object.fromEntries(await Promise.all(targets.map(async (f) => [f, await fs.readFile(path.join(ROOT, f), 'utf8')])));
const baseHash = Object.fromEntries(await Promise.all(targets.map(async (f) => [f, await sha(f)])));
let clean = true;
let bitten = 0;
try {
  for (const c of CASES) {
    const n = base[c.file].split(c.find).length - 1;
    if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 命中 ${n} 处（应为 1）`);
  }
  const baseline = redNames(await runSuite());
  if (baseline.length > 0) throw new Error(`基线不绿：${baseline.join(' ｜ ')}`);
  log(`✓ 基线全绿（${SUITE}）`);
  for (const c of CASES) {
    await fs.writeFile(path.join(ROOT, c.file), base[c.file].replace(c.find, c.replace));
    if ((await sha(c.file)) === baseHash[c.file]) throw new Error(`${c.id} 变异后哈希未变`);
    try {
      const red = redNames(await runSuite());
      const hit = c.expect.every((e) => red.some((r) => r.includes(e)));
      if (hit) bitten++;
      log(`  ${c.id} ${hit ? '✓ 咬住' : '✖ 没咬住'}：${c.desc} ⇒ 红：${red.join(' ｜ ') || '（无）'}`);
    } finally {
      await fs.writeFile(path.join(ROOT, c.file), base[c.file]);
      if ((await sha(c.file)) !== baseHash[c.file]) { clean = false; throw new Error(`恢复 ${c.file} 后哈希不符`); }
    }
  }
  log(`${bitten}/${CASES.length} 咬住`);
} finally {
  for (const f of targets) if ((await sha(f)) !== baseHash[f]) { await fs.writeFile(path.join(ROOT, f), base[f]); }
  await fs.writeFile(path.join(HERE, 'contract-mutations-output.txt'), lines.join('\n') + '\n');
  if (clean) await fs.rm(SENTINEL, { force: true });
}
process.exit(bitten === CASES.length ? 0 : 1);
