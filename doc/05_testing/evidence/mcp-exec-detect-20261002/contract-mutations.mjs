#!/usr/bin/env node
/**
 * 「MCP执行工具调用检测」（EV-188）run.v2 schema 的契约变异（计划 r2 §3.1「契约变异」）。
 *
 * 装置只认 `src/*.ts`，schema 是 JSON，所以另写本脚本（照 evidence/config-dead-keys-20261001/contract-mutations.mjs 的形态）。
 * 被测产物是构建拷进 `dist/test/skills/dual-critic/schema/run.v2.json` 的那一份（`schemas.ts` 的 JSON 导入读它），
 * 咬点是 `test/unit/run-schema-mcp.test.ts` 的 S1～S4。
 *
 * **执行窗口**：`build.mjs --with-tests` 会从源目录重拷 dist 下的 schema，所以本脚本**不调构建**，只用 `node --test` 直跑目标文件；
 * 先由操作者跑一次 `node scripts/build.mjs --with-tests`。每格写入后断言文件确为变异文本再跑，跑完恢复并逐字节比对；
 * 全部跑完后断言 dist 拷贝与源 schema 逐字节相同。只动 dist 拷贝，不动进 Git 的源 schema。
 *
 * 判据：点名的用例必须出现在 `✖` 行里才判咬住；其余顺带变红的原样列出。
 * 用法（在仓库根）：node doc/05_testing/evidence/mcp-exec-detect-20261002/contract-mutations.mjs
 * 输出：同目录 `contract-mutations-output.txt`。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const SUITE = 'dist/test/test/unit/run-schema-mcp.test.js';
const DIST = path.join(ROOT, 'dist/test/skills/dual-critic/schema/run.v2.json');
const SRC = path.join(ROOT, 'skills/dual-critic/schema/run.v2.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const base = await fs.readFile(DIST, 'utf8');
if (base !== (await fs.readFile(SRC, 'utf8'))) throw new Error('前提不成立：dist 拷贝与源 schema 不同，先跑 build.mjs --with-tests');

/** 截 evidence_untrusted 整块（含前导的「,\n缩进」），用于整段删除 */
function block() {
  const open = '              "evidence_untrusted": {\n';
  const i = base.indexOf(open);
  if (i < 0 || base.indexOf(open, i + 1) >= 0) throw new Error('evidence_untrusted 起始行不唯一或不存在');
  const close = '\n              }';
  const j = base.indexOf(close, i);
  const k = base.lastIndexOf(',\n', i);
  return base.slice(k, j + close.length);
}

const CASES = [
  { id: 'K1', desc: '删掉 evidence_untrusted 属性（带该键的 run.json 变成未知字段）', find: block(), replace: '', expect: ['S1'] },
  { id: 'K2', desc: 'tools 去掉 minItems', find: '"minItems": 1,\n                    "items": {\n                      "type": "string",\n                      "minLength": 1',
    replace: '"items": {\n                      "type": "string",\n                      "minLength": 1', expect: ['S2'] },
  { id: 'K3', desc: 'cause 的枚举放宽成任意字符串', find: '"cause": {\n                    "enum": [\n                      "mcp-call"\n                    ]\n                  }',
    replace: '"cause": {\n                    "type": "string"\n                  }', expect: ['S3'] },
  { id: 'K4', desc: 'required 去掉 tools', find: '"required": [\n                  "cause",\n                  "tools"\n                ],',
    replace: '"required": [\n                  "cause"\n                ],', expect: ['S3'] },
  { id: 'K5', desc: 'evidence_untrusted 允许多余字段', find: '"minItems": 1', replace: '"minItems": 1', expect: ['S4'], special: 'additional' },
];

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
let bitten = 0;
try {
  for (const c of CASES) {
    let mutated;
    if (c.special === 'additional') {
      // evidence_untrusted 块里的 additionalProperties:false 改成 true（块内唯一一处）
      const b = block();
      const nb = b.replace('"additionalProperties": false', '"additionalProperties": true');
      if (nb === b) throw new Error('K5 锚点不在块内');
      mutated = base.replace(b, nb);
    } else {
      if (base.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
      mutated = base.replace(c.find, c.replace);
    }
    await fs.writeFile(DIST, mutated);
    if (sha(await fs.readFile(DIST, 'utf8')) === sha(base)) throw new Error(`${c.id} 写入后文件没变`);
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=60000', SUITE], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    const red = [...new Set([...out.split('✖ failing tests:')[0].matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
    const ok = c.expect.every((e) => red.some((n) => n.startsWith(e)));
    if (ok) bitten++;
    log(`${c.id} ${ok ? '✓ 咬住' : '✗ 未咬住'}（${c.desc}）⇒ ${red.join(' ｜ ') || '（无红）'}`);
    await fs.writeFile(DIST, base);
    if (sha(await fs.readFile(DIST, 'utf8')) !== sha(base)) throw new Error(`${c.id} 恢复后哈希不符`);
  }
} finally {
  await fs.writeFile(DIST, base);
}
if ((await fs.readFile(DIST, 'utf8')) !== (await fs.readFile(SRC, 'utf8'))) throw new Error('收尾后 dist 拷贝与源 schema 不同');
log(`${bitten}/${CASES.length} 咬住；dist 拷贝已恢复且与源 schema 逐字节相同`);
await fs.writeFile(path.join(HERE, 'contract-mutations-output.txt'), lines.join('\n') + '\n');
