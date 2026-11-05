/** Disposable 生命周期（AGY-05）：dispose 后不再有事件/定时器 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { RunWatch } from '../../src/monitor/statusWatch';
import { waitFor, fxPaths } from './testHelper';

async function atomicWrite(p: string, text: string): Promise<void> {
  const tmp = `${p}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, p);
}

suite('Disposable（AGY-05）', function () {
  this.timeout(30_000);

  test('RunWatch dispose 后写 status.json 不再触发渲染', async () => {
    const p = await fxPaths();
    // 自写合法初始态（前序用例可能遗留 v9/终态快照，用例必须自洽）
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date().toISOString(),
      sides: {}, artifacts: [], exit_code: null, message: null,
    });
    let renders = 0;
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'running', artifacts: null }),
      },
      { onRender: () => (renders += 1), onFinal: () => {} },
    );
    await waitFor(() => renders >= 1);
    w.dispose();
    const before = renders;
    await atomicWrite(
      `${p.runDir}/status.json`,
      JSON.stringify({ schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan', phase: 'running', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [] }),
    );
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(renders, before, 'dispose 后不应再渲染');
  });

  test('终态复核完成后自动 dispose（crossChecked 置位）', async () => {
    const p = await fxPaths();
    let finals = 0;
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'success', artifacts: null }),
      },
      { onRender: () => {}, onFinal: () => (finals += 1) },
    );
    await atomicWrite(
      `${p.runDir}/status.json`,
      JSON.stringify({ schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan', phase: 'cancelled', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [] }),
    );
    await waitFor(() => finals === 1 && w.isCrossChecked, 20_000);
    // 已自动 dispose：再写不渲染
    const finalsBefore = finals;
    await atomicWrite(
      `${p.runDir}/status.json`,
      JSON.stringify({ schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan', phase: 'success', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [] }),
    );
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(finals, finalsBefore);
  });
});
