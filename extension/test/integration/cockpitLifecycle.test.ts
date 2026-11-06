/**
 * 驾驶舱生命周期（代码审 r2：CLAUDE-01/AGY-r2-01/CODEX-01/CODEX-05/CLAUDE-04）
 * —— 打开→关闭→再打开、监听不重复、闸门回落收尾。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { TriviumEnv } from '../../src/env/config';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { TerminalRelay } from '../../src/launch/terminalRelay';
import { StateWatch } from '../../src/monitor/stateWatch';
import { AnnotationHub } from '../../src/reviews/annotationHub';
import { Cockpit } from '../../src/ui/cockpit';
import type { TriviumServices } from '../../src/services';
import { waitFor, fxPaths, RUN_ID } from './testHelper';

function buildServices(root: string): TriviumServices {
  const env = new TriviumEnv(root);
  const cli = new TriviumCli(root);
  const relay = new TerminalRelay();
  const stateWatch = new StateWatch(root);
  const annotationHub = new AnnotationHub(root);
  return {
    root,
    env,
    cli,
    cmds: new TriviumCommands(cli),
    relay,
    stateWatch,
    annotationHub,
    repoRoot: root,
    disposables: { push: () => {} },
  };
}

suite('驾驶舱生命周期（r2 修订）', function () {
  this.timeout(60_000);

  test('打开→关闭→再打开：面板可重建，服务订阅不重复（CLAUDE-01/AGY-r2-01/CODEX-01）', async () => {
    const p = await fxPaths();
    const services = buildServices(p.root);
    const cockpit = new Cockpit(services);
    try {
      await cockpit.open();
      assert.ok(cockpit.isPanelOpen, '首次打开应建面板');
      const subsBefore = services.stateWatch.listenerCount;
      cockpit.closePanelForTest();
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(!cockpit.isPanelOpen, '关闭后无面板');
      await cockpit.open();
      assert.ok(cockpit.isPanelOpen, '关闭后可再次打开（实例未销毁）');
      assert.equal(services.stateWatch.listenerCount, subsBefore, '订阅数不随重开增加');
      cockpit.closePanelForTest();
      await cockpit.open();
      assert.ok(cockpit.isPanelOpen);
      assert.equal(services.stateWatch.listenerCount, subsBefore, '多次重开订阅仍恒定');
    } finally {
      cockpit.dispose();
      services.stateWatch.dispose();
      services.relay.dispose();
    }
  });

  test('闸门回落收尾：复核一次 --status 并释放监控（CLAUDE-04）', async () => {
    const p = await fxPaths();
    // 桩：review --status 返回 failed 终态
    await fs.writeFile(p.stubResponses, JSON.stringify({
      'review --status': {
        code: 0,
        json: { ok: true, run_id: RUN_ID, phase: null, status: { phase: 'failed', artifacts: ['/tmp/x.md'] } },
      },
    }));
    // 用例自洽：前置套件可能把 state/status 留在任意形态——重设 running 初始态
    await p.writeState({
      'DemoTopic/plan': { topic: 'DemoTopic', stage: 'plan', state: 'running', run_id: RUN_ID, since: '2026-11-06T00:00:00.000Z', session_id: null },
    });
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: RUN_ID, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date().toISOString(),
      sides: { claude: { state: 'running', model: 'stub-m', attempt: 1, elapsed_s: 0, cli: null } },
      artifacts: [], exit_code: null, message: null,
    });
    const services = buildServices(p.root);
    const cockpit = new Cockpit(services);
    try {
      await cockpit.open();
      // 等初始扫描把 DemoTopic 的 run 接上看板（attach 走重试定位）
      await waitFor(() => cockpit.runStates().some((r) => r.runId === RUN_ID), 30_000);
      // 闸门回落 idle → 触发 markEnded → finalizeEndedRun（复核 + 清理）
      await p.writeState({
        'DemoTopic/plan': { topic: 'DemoTopic', stage: 'plan', state: 'idle', run_id: RUN_ID, since: '2026-11-06T00:00:00.000Z', session_id: null },
      });
      await waitFor(
        () => {
          const r = cockpit.runStates().find((x) => x.runId === RUN_ID);
          return r !== undefined && r.ended && r.endNote !== null && r.endNote.includes('failed');
        },
        30_000,
      );
    } finally {
      cockpit.dispose();
      services.stateWatch.dispose();
      services.relay.dispose();
    }
  });
});
