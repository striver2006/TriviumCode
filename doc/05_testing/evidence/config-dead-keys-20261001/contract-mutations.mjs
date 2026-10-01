#!/usr/bin/env node
/**
 * 「两个空配置项收口」（EV-30 ① / EV-15）config.v2 schema 的变异验证（计划 r2 §6「schema 契约变异」）。
 *
 * ## 为什么不走 `scripts/mutation-check.mjs`
 *
 * 装置只认 `src/*.ts`。schema 是 JSON，且测试里有**两个读者**：
 *   - `validateConfig`（U1 / U2）读构建拷进 `dist/test/skills/dual-critic/schema/` 的那一份（`schemas.ts` 的 JSON 导入）；
 *   - U3 与 config-consumers 的回归锁直接读仓库里的源 schema（`REPO_ROOT/skills/...`）。
 * 所以 K1～K5 改 `dist/test/` 拷贝（期望 U1 / U2 红），K6 / K7 改源 schema（期望 U3 / 回归锁红，不重建、dist 拷贝不动）。
 * K8 / K9（代码双审 r1 CODEX-02 补）改 `skills-src/` 下的源文档，期望 U9 红（U9 直接读仓库文件）。
 *
 * **执行窗口**（计划双审 CODEX-05）：`pretest`（`build.mjs --with-tests`）每次会从源目录重拷 dist 下的 schema，
 * 所以本脚本**不调构建、不经 `npm test`**，只用 `node --test` 直跑两个目标测试文件；
 * 先由操作者跑一次 `node scripts/build.mjs --with-tests`。每格写入后先断言文件确为变异文本（哈希变了）再跑，
 * 跑完恢复并逐字节比对；全部跑完后断言 dist 拷贝与源 schema 逐字节相同。
 *
 * **K6 / K7 动的是活工作树里进 Git 的源文件**（与 drift-uncomparable 的 K4 同一取舍）：回归锁与 U3 钉的就是那份源文件。
 * 恢复靠 `finally` 逐字节回写并核哈希；SIGKILL / 断电时 `finally` 不执行，残留的哨兵会挡住重跑，
 * 被改的源 schema 在 `git status` 里可见，请在终端用 `git restore` 恢复（本主题未提交时则按哨兵里的哈希核对）后删哨兵。
 *
 * ## 判据：点名的用例必须红
 *
 * 每条记期望变红的用例名片段，只有它们出现在 `✖` 行里才判咬住；其余顺带变红的原样列出。
 *
 * 用法（在仓库根，先 `node scripts/build.mjs --with-tests`）：
 *   node doc/05_testing/evidence/config-dead-keys-20261001/contract-mutations.mjs
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
const SUITES = ['dist/test/test/unit/config-schema.test.js', 'dist/test/test/unit/config-consumers.test.js'];
const DIST = 'dist/test/skills/dual-critic/schema/config.v2.json';
const SRC = 'skills/dual-critic/schema/config.v2.json';
const U1 = 'U1 两个空配置项';
const U2 = 'U2 两个空配置项';
const U3 = 'U3 两个空配置项';
const LOCK = '回归锁：已删除的 max_check_retries';
const U9 = 'U9「gate --check 重跑几次」';
const BODY = 'skills-src/partials/review/body.md';
const CONTRACT = 'skills-src/commands/run.contract.md';

const srcText = await fs.readFile(path.join(ROOT, SRC), 'utf8');
/** 从源 schema 截出某个属性的完整对象文本（含前导的「,\n缩进」），用于整段删除 */
function propBlock(name, indent) {
  const open = `${indent}"${name}": {\n`;
  const i = srcText.indexOf(open);
  if (i < 0 || srcText.indexOf(open, i + 1) >= 0) throw new Error(`属性 ${name} 的起始行不唯一或不存在`);
  const close = `\n${indent}}`;
  const j = srcText.indexOf(close, i);
  return srcText.slice(i, j + close.length);
}
const GATE_REQ = '"stop_hook_max_blocks",\n        "reason_policy",';
const AGY_REQ = '"agent",\n              "effort"\n            ],';
const GATE_PROP = propBlock('max_check_retries', '        ');
const AGY_PROP = propBlock('readonly_commands', '              ');

const CASES = [
  { id: 'K1', desc: 'gate 的 required 加回 max_check_retries', file: DIST, find: GATE_REQ,
    replace: '"stop_hook_max_blocks",\n        "max_check_retries",\n        "reason_policy",', expect: [U1] },
  { id: 'K2', desc: 'gate 删掉 max_check_retries 属性（带它的旧配置变成未知字段）', file: DIST, find: GATE_PROP + ',\n',
    replace: '', expect: [U1] },
  { id: 'K3', desc: 'antigravity 分支的 required 加回 readonly_commands', file: DIST, find: AGY_REQ,
    replace: '"agent",\n              "effort",\n              "readonly_commands"\n            ],', expect: [U1] },
  { id: 'K4', desc: 'antigravity 分支删掉 readonly_commands 属性', file: DIST, find: ',\n' + AGY_PROP,
    replace: '', expect: [U1] },
  { id: 'K5', desc: 'max_check_retries 的类型约束放宽（去掉 minimum）', file: DIST, find: '"type": "integer",\n          "minimum": 0,\n          "deprecated": true,',
    replace: '"type": "integer",\n          "deprecated": true,', expect: [U2] },
  { id: 'K6', desc: '源 schema 去掉 max_check_retries 的 deprecated 标注', file: SRC, find: '"minimum": 0,\n          "deprecated": true,',
    replace: '"minimum": 0,', expect: [U3] },
  { id: 'K7', desc: '源 schema 的 gate required 加回 max_check_retries', file: SRC, find: GATE_REQ,
    replace: '"stop_hook_max_blocks",\n        "max_check_retries",\n        "reason_policy",', expect: [U3, LOCK] },
  // 代码双审 r1 CODEX-02 补的 U9：「重跑最多 3 次」一句的跨文件一致性。改的是活工作树里的源文档，同 K6 / K7 的取舍
  { id: 'K8', desc: 'review 正文那句的 3 改成 5（与其余几处不再一致）', file: BODY,
    find: '重跑最多 3 次（首次校验不计）', replace: '重跑最多 5 次（首次校验不计）', expect: [U9] },
  { id: 'K9', desc: '/dual-run S8 漏写上限（回到原状）', file: CONTRACT,
    find: '有缺口则回到 S7 补齐后重跑本步；\n重跑最多 3 次（首次校验不计），仍不通过则向用户说明缺口并停下，交给用户处理。',
    replace: '有缺口回到 S7。', expect: [U9] },
];

const SENTINEL = path.join(ROOT, '.contract-mutations-running');
const sha = async (f) => createHash('sha256').update(await fs.readFile(path.join(ROOT, f))).digest('hex');
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

async function runSuites() {
  try {
    const r = await run(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=60000', ...SUITES], {
      cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 600_000,
    });
    return r.stdout;
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}
const redNames = (out) => [...new Set([...out.split('✖ failing tests:')[0].matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];

await fs.writeFile(SENTINEL, JSON.stringify({ pid: process.pid, [SRC]: await sha(SRC), [DIST]: await sha(DIST) }), { flag: 'wx' });
const targets = [...new Set(CASES.map((c) => c.file))];
const base = Object.fromEntries(await Promise.all(targets.map(async (f) => [f, await fs.readFile(path.join(ROOT, f), 'utf8')])));
const baseHash = Object.fromEntries(await Promise.all(targets.map(async (f) => [f, await sha(f)])));
let clean = true;
let bitten = 0;
try {
  if (base[SRC] !== base[DIST]) throw new Error('开跑前 dist 拷贝与源 schema 不一致：先跑 node scripts/build.mjs --with-tests');
  for (const c of CASES) {
    const n = base[c.file].split(c.find).length - 1;
    if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 命中 ${n} 处（应为 1）`);
  }
  const baseline = redNames(await runSuites());
  if (baseline.length > 0) throw new Error(`基线不绿：${baseline.join(' ｜ ')}`);
  log(`✓ 基线全绿（${SUITES.join('、')}）`);
  for (const c of CASES) {
    await fs.writeFile(path.join(ROOT, c.file), base[c.file].replace(c.find, c.replace));
    try {
      if ((await sha(c.file)) === baseHash[c.file]) throw new Error(`${c.id} 写入后哈希没变——变异没落上`);
      const red = redNames(await runSuites());
      const hit = c.expect.every((e) => red.some((r) => r.includes(e)));
      if (hit) bitten += 1;
      log(`${hit ? '✓ 咬住' : '✗ 没咬住'} ${c.id}（${c.desc}，改 ${c.file}）：期望红 ${c.expect.join(' + ')}；实际红 ${red.length} 条${red.length ? '：' + red.join(' ｜ ') : ''}`);
    } finally {
      await fs.writeFile(path.join(ROOT, c.file), base[c.file]);
      if ((await sha(c.file)) !== baseHash[c.file]) { clean = false; throw new Error(`恢复 ${c.file} 后哈希不符，停下人工处理`); }
    }
  }
} finally {
  for (const f of targets) {
    if ((await sha(f)) !== baseHash[f]) { await fs.writeFile(path.join(ROOT, f), base[f]); }
    if ((await sha(f)) !== baseHash[f]) clean = false;
  }
  const same = (await fs.readFile(path.join(ROOT, SRC), 'utf8')) === (await fs.readFile(path.join(ROOT, DIST), 'utf8'));
  log(`收尾：dist 拷贝与源 schema ${same ? '逐字节相同' : '不一致！'}`);
  if (!same) clean = false;
  log(`结果：${bitten}/${CASES.length} 咬住；工作树${clean ? '已恢复' : '可能未恢复，哨兵保留'}`);
  // 可选参数是输出后缀（如 `.r1`），首轮读数原样保留
  await fs.writeFile(path.join(HERE, `contract-mutations-output${process.argv[2] ?? ''}.txt`), lines.join('\n') + '\n');
  if (clean) await fs.rm(SENTINEL);
}
process.exit(bitten === CASES.length && clean ? 0 : 1);
