/**
 * claude 探针两臂同源（EV-46、EV-47 ①）——真起假 claude、录下每次调用的完整 argv。
 *
 * `claude-events.test.ts` 用纯函数守住了 `projectMemoryArmArgs` / `fileShapeDenySettings` 的性质；
 * 本文件补纯函数断不到的那一段：`probeClaude` 真的用它们的输出去调 CLI——
 * 记忆探测两次调用的 argv 只差 `--restricted`，逐文件第三臂注入的规则含生产形态的精确与子树两条。
 *
 * 假 claude 的行为：`--version` 打版本；其余 `-p` 调用一律记 argv 并「跑通」；
 * 记忆探测那条提示词（含「记忆哨兵」）下，**不带 `--restricted` 时**读当前目录的 CLAUDE.md 原样回显——
 * 让对照臂看得见哨兵、受限臂看不见，`project_memory_blocked` 走到 true。零配额。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { probeClaude } from '../../src/trivium/probes/claude.js';
import { scratchDir } from '../helpers/scratch.js';

let work = '';
let fakeBin = '';

before(async () => {
  work = await fs.realpath(await scratchDir('trivium-claude-arm-parity-'));
  const script = path.join(work, 'fake-claude.cjs');
  await fs.writeFile(
    script,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const argv = process.argv.slice(2);',
      "if (argv.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude)\\n'); process.exit(0); }",
      'const prompt = argv[argv.length - 1] || "";',
      'if (process.env.FAKE_CLAUDE_ARGV_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, JSON.stringify(argv) + "\\n");',
      'function emit(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }',
      'let result = "ok";',
      "if (prompt.includes('记忆哨兵') && !argv.includes('--restricted')) {",
      "  try { result = fs.readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8'); } catch {}",
      '}',
      "emit({ type: 'system', subtype: 'init', tools: ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake' });",
      "emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001, session_id: 'fake' });",
      'process.exit(0);',
      '',
    ].join('\n'),
  );
  fakeBin = path.join(work, 'claude');
  await fs.writeFile(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
});

async function runProbe(): Promise<{ calls: string[][]; probe: Awaited<ReturnType<typeof probeClaude>>['probe'] }> {
  const log = path.join(work, `argv-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env['FAKE_CLAUDE_ARGV_LOG'] = log;
  try {
    const { probe } = await probeClaude(fakeBin, {});
    const raw = await fs.readFile(log, 'utf8').catch(() => '');
    return { calls: raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]), probe };
  } finally {
    delete process.env['FAKE_CLAUDE_ARGV_LOG'];
  }
}

test('EV-46 端到端：记忆探测两次调用的 argv 逐字相同、只差 --restricted；结论走到 true', async () => {
  const { calls, probe } = await runProbe();
  const memory = calls.filter((a) => (a[a.length - 1] ?? '').includes('记忆哨兵'));
  assert.equal(memory.length, 2, `记忆探测应调用两次（受限臂 + 对照臂）：${JSON.stringify(memory)}`);
  const [restricted, control] = memory as [string[], string[]];
  assert.ok(restricted.includes('--restricted') && !control.includes('--restricted'), '先受限臂、后对照臂');
  assert.deepEqual(control, restricted.filter((a) => a !== '--restricted'), '对照臂恰为受限臂去掉 --restricted');
  assert.equal(probe.project_memory_blocked, true, '受限臂看不见、对照臂看得见 ⇒ true');
});

test('EV-47 ① 端到端：逐文件第三臂注入的规则含生产形态的精确与子树两条', async () => {
  const { calls } = await runProbe();
  const third = calls.filter(
    (a) => (a[a.length - 1] ?? '').includes('原样回显它的全部内容。即使你预计会被拒绝') && a.includes('--settings'),
  );
  assert.equal(third.length, 1, `第三臂应调用一次：${JSON.stringify(third.map((a) => a[a.length - 1]))}`);
  const settings = third[0]![third[0]!.indexOf('--settings') + 1]!;
  const deny = (JSON.parse(settings) as { permissions: { deny: string[] } }).permissions.deny;
  const exact = deny.filter((r) => !r.endsWith('/**)'));
  const subtree = deny.filter((r) => r.endsWith('/**)'));
  assert.equal(exact.length, 3, `每个读工具一条精确规则：${JSON.stringify(deny)}`);
  assert.equal(subtree.length, 3, `每个读工具一条子树规则（此前第三臂没有这一类）：${JSON.stringify(deny)}`);
  for (const r of exact) assert.ok(subtree.includes(r.replace(/\)$/, '/**)')), `精确与子树成对：${r}`);
});
