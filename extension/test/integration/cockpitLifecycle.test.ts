/**
 * 驾驶舱生命周期（代码审 r2：CLAUDE-01/AGY-r2-01/CODEX-01/CODEX-05/CLAUDE-04）
 * —— 打开→关闭→再打开、监听不重复、闸门回落收尾。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { TriviumEnv } from '../../src/env/config';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { TerminalRelay } from '../../src/launch/terminalRelay';
import { StateWatch } from '../../src/monitor/stateWatch';
import { AnnotationHub } from '../../src/reviews/annotationHub';
import { Cockpit } from '../../src/ui/cockpit';
import type { TriviumServices } from '../../src/services';
import { waitFor, fxPaths, RUN_ID } from './testHelper';
import { memoryPresetStore } from './fakePresets';

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
    saveGuard: null,
    presets: memoryPresetStore(),
    repoRoot: root,
    disposables: { push: () => {} },
  };
}

suite('驾驶舱生命周期（r2 修订）', function () {
  this.timeout(60_000);

  test('点火在认领前复核冻结字段和实际程序，GLM 同主题冲突保留旧会话', async () => {
    const p = await fxPaths();
    const services = buildServices(p.root);
    const cockpit = new Cockpit(services);
    const settings = vscode.workspace.getConfiguration('trivium.launch', vscode.Uri.file(p.root));
    const previous = settings.inspect<string>('glmInteractivePath')?.workspaceValue;
    const dir = await fs.mkdtemp(path.join(p.root, 'model-check-'));
    const first = path.join(dir, 'zcode'), second = path.join(dir, 'zcode-new');
    const form = { driver: 'glm', critics: ['claude'], entry: 'B', topic: '装配冻结', body: '检查', ctxPaths: [],
      profile: 'pro', extraFlags: '--tier-claude high --driver-model declared-only' };
    let claims = 0, injections = 0;
    services.cmds.topicResolve = async () => ({ code: 0, stdout: '', stderr: '', out: {
      ok: true, topic: form.topic, topic_inferred: false, driver: 'glm', critics: ['claude'], task_goal: null, prompt_hint: null, max_rounds: null, notes: [],
    } });
    services.cmds.preflight = async ({ flags }) => {
      assert.deepEqual(flags, ['--profile', 'pro', '--tier-claude', 'high', '--driver-model', 'declared-only']);
      return { code: 0, stderr: '', out: { ok: true, checks: [], warnings: [], exit_code: 0 } };
    };
    services.cmds.topicClaim = async (topic, stage, driver) => { claims++; return { code: 0, stderr: '', out: { ok: true, topic, stage, driver, outcome: 'claimed' } }; };
    services.relay.injectText = async (session, command) => {
      assert.deepEqual(session.launch.nativeArgs, [], '审核者档位和 Driver 声明只随任务命令传递');
      assert.match(command, /--profile pro --tier-claude high --driver-model declared-only/);
      injections++; session.entrySent = true; return true;
    };
    const pre = () => cockpit.handleMessageForTest({ type: 'prechain', form });
    const ignite = (extra = {}) => cockpit.handleMessageForTest({ type: 'ignite', topic: form.topic, form: { ...form, ...extra } });
    try {
      for (const file of [first, second]) await fs.writeFile(file,
        '#!/bin/sh\nif [ "$1" = --help ]; then echo "Usage: zcode"; exit 0; fi\nexec cat\n', { mode: 0o755 });
      await settings.update('glmInteractivePath', first, vscode.ConfigurationTarget.Workspace);
      await pre();
      await ignite({ driverEffort: 'high' });
      await ignite({ driverModel: '失效模型' });
      assert.deepEqual([claims, injections], [0, 0]);
      await cockpit.handleMessageForTest({ type: 'form-changed' });
      await ignite();
      assert.equal(claims, 0, '改回原值仍须重新预检');
      await pre();
      await settings.update('glmInteractivePath', second, vscode.ConfigurationTarget.Workspace);
      await ignite();
      assert.equal(claims, 0, '实际入口在预检后变化');
      await pre();
      await ignite();
      const old = services.relay.find('glm|装配冻结|B')!;
      assert.ok(old);
      await ignite();
      assert.deepEqual([claims, injections], [1, 1], '同配置返回已有 GLM 终端');
      await settings.update('glmInteractivePath', first, vscode.ConfigurationTarget.Workspace);
      await pre();
      await ignite();
      await cockpit.handleMessageForTest({ type: 'resend' });
      assert.deepEqual([claims, injections], [1, 1], '冲突不能走 GLM 早返回、认领或注入');
      assert.equal(services.relay.find(old.key), old);
      assert.equal(old.terminal.exitStatus, undefined);
      await cockpit.handleMessageForTest({ type: 'keep-terminal', id: 1 });
      await cockpit.handleMessageForTest({ type: 'resend' });
      assert.deepEqual([claims, injections], [1, 2], '保留后只能重新注入原会话的任务');
      old.terminal.dispose();
    } finally {
      await settings.update('glmInteractivePath', previous, vscode.ConfigurationTarget.Workspace);
      cockpit.dispose();
      services.stateWatch.dispose();
      services.relay.dispose();
      services.annotationHub.dispose();
    }
  });

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
