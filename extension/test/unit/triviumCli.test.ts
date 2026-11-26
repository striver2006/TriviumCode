/** CLI 子进程分块 UTF-8 解码（CODEX-08）：中文不得跨块损坏 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TriviumCli, extractJson, parseWrapperCommand, resolveWrapperSpawn } from '../../src/cli/triviumCli';

/** 逐字节输出 UTF-8 多字节字符的脚本（模拟最细粒度分块） */
const SLOW_ECHO = `
const text = process.argv[2]; // argv[1] 是脚本自身路径
const bytes = Buffer.from(text, 'utf8');
let i = 0;
const tick = () => {
  if (i >= bytes.length) { process.exit(0); return; }
  process.stdout.write(Buffer.from([bytes[i]]));
  i += 1;
  setTimeout(tick, 0);
};
tick();
`;

test('分块输出的中文 JSON 完整解码（topic 不悄悄变字）', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'trivium-utf8-'));
  try {
    const script = path.join(dir, 'slow-echo.cjs');
    await fs.writeFile(script, SLOW_ECHO);
    const wrapperDir = path.join(dir, '.trivium', 'bin');
    await fs.mkdir(wrapperDir, { recursive: true });
    await fs.writeFile(
      path.join(wrapperDir, 'trivium'),
      `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
      { mode: 0o755 },
    );
    const cli = new TriviumCli(dir);
    const payload = JSON.stringify({ ok: true, topic: '中文主题' });
    const r = await cli.run([payload], 30_000);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout) as { topic: string };
    assert.equal(parsed.topic, '中文主题', '逐字节输出的中文必须完整解码');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('extractJson 对混合前缀文本取 JSON', () => {
  assert.deepEqual(extractJson('进度行\n{"ok":true}'), { ok: true });
  assert.equal(extractJson('不是 json'), null);
  assert.equal(extractJson(''), null);
});

test('parseWrapperCommand 与 resolveWrapperSpawn 兼容 sh、.cmd 与 node shebang', async () => {
  assert.deepEqual(
    parseWrapperCommand('#!/bin/sh\nexec "/opt/node" "/a/trivium.cjs" "$@"\n'),
    { nodePath: '/opt/node', cliPath: '/a/trivium.cjs' },
  );
  assert.deepEqual(
    parseWrapperCommand('@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\u\\trivium.cjs" %*\r\n'),
    { nodePath: 'C:\\Program Files\\nodejs\\node.exe', cliPath: 'C:\\u\\trivium.cjs' },
  );
  assert.equal(parseWrapperCommand('#!/bin/sh\necho hi\n'), null);

  assert.deepEqual(
    await resolveWrapperSpawn('D:\\repo\\.trivium\\bin\\trivium', ['doctor', '--json'], async (p) =>
      p.endsWith('trivium') ? '#!/bin/sh\nexec "C:\\node.exe" "C:\\trivium.cjs" "$@"\n' : null,
    'win32', 'C:\\fallback.exe'),
    { command: 'C:\\node.exe', args: ['C:\\trivium.cjs', 'doctor', '--json'] },
  );

  assert.deepEqual(
    await resolveWrapperSpawn('D:\\repo\\.trivium\\bin\\trivium', ['doctor'], async (p) =>
      p.endsWith('.cmd') ? '@echo off\r\n"C:\\node.exe" "C:\\trivium.cjs" %*\r\n' : null,
    'win32', 'C:\\fallback.exe'),
    { command: 'C:\\node.exe', args: ['C:\\trivium.cjs', 'doctor'] },
  );

  assert.deepEqual(
    await resolveWrapperSpawn('D:\\repo\\.trivium\\bin\\trivium', ['--version'], async () =>
      '#!/usr/bin/env node\nconsole.log(1);\n',
    'win32', 'C:\\node.exe'),
    { command: 'C:\\node.exe', args: ['D:\\repo\\.trivium\\bin\\trivium', '--version'] },
  );

  assert.deepEqual(
    await resolveWrapperSpawn('/repo/.trivium/bin/trivium', ['doctor'], async () => null, 'linux'),
    { command: '/repo/.trivium/bin/trivium', args: ['doctor'] },
  );
});
