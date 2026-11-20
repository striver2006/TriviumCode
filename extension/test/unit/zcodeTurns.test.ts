import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZcodeTurns } from '../../src/launch/zcodeTurns';

test('ZCode 续话须等同一主会话轮末，跨日及半行写入只消费一次', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trivium-turn-'));
  try {
    const turns = new ZcodeTurns(dir);
    const file = (day: number) => join(dir, 'zcode-2026-11-' + day + '.jsonl');
    const event = (turnId: string, kind: string, sessionId = 'main') =>
      JSON.stringify({ module: 'core.runtime', sessionId, turnId, event: 'turn.' + kind }) + '\n';
    assert.equal(turns.started, false);
    await appendFile(file(19), 'broken {"event":"bootstrap.app.startup.completed"\n' +
      'broken {"event":"turn.completed"\n' + '{"module":"unrelated","message":"bootstrap.app.startup.completed"}\n');
    await turns.refresh();
    assert.equal(turns.started, false);
    await appendFile(file(19), JSON.stringify({module:'bootstrap', event:'bootstrap.app.startup.completed'}) + '\n');
    await appendFile(file(19), event('1', 'started') + event('sub', 'started', 'child') + event('sub', 'completed', 'child'));
    await turns.refresh();
    assert.ok(turns.started);
    assert.ok(turns.busy);
    assert.equal(turns.ready, false);
    const end = event('1', 'completed');
    await appendFile(file(20), end.slice(0, -3));
    await turns.refresh();
    assert.equal(turns.ready, false);
    await appendFile(file(20), end.slice(-3));
    await turns.refresh();
    assert.ok(turns.ready);
    turns.submitted();
    await turns.refresh();
    assert.equal(turns.ready, false);
    await appendFile(file(20), event('2', 'started') + event('2', 'completed'));
    await turns.refresh();
    assert.ok(turns.ready);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
