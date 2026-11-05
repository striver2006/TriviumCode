/** CLI 子进程分块 UTF-8 解码（CODEX-08）：中文不得跨块损坏 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TriviumCli, extractJson } from '../../src/cli/triviumCli';

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
