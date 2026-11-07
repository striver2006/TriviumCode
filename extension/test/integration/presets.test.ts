/**
 * 预设集成测试（FR-11，r2 计划 D9）：经 cockpit 消息链的保存/列表/加载/删除，
 * 注入 memoryPresetStore 观察宿主侧状态（webview 回填属渲染层，不在宿主断言面）。
 */
import * as assert from 'node:assert/strict';
import { TriviumEnv } from '../../src/env/config';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { TerminalRelay } from '../../src/launch/terminalRelay';
import { StateWatch } from '../../src/monitor/stateWatch';
import { AnnotationHub } from '../../src/reviews/annotationHub';
import { Cockpit } from '../../src/ui/cockpit';
import type { TriviumServices } from '../../src/services';
import { memoryPresetStore } from './fakePresets';
import { buildPhase2Fixture, type Phase2Fixture } from './fixtureLib';

const FORM = {
  driver: 'codex',
  critics: ['claude', 'gemini', 'glm'],
  entry: 'A',
  body: '正文不进 preset',
  topic: '主题也不进',
  maxRounds: 5,
  profile: 'default',
  ctxPaths: ['src/sample.ts'],
  extraFlags: '--model-claude k3.1-pro',
};

suite('预设体系（FR-11）', function () {
  this.timeout(60_000);
  let fx: Phase2Fixture;
  let cockpit: Cockpit;
  let store: ReturnType<typeof memoryPresetStore>;
  let stateWatch: StateWatch;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
  });

  setup(async () => {
    const env = new TriviumEnv(fx.root);
    const cli = new TriviumCli(fx.root);
    stateWatch = new StateWatch(fx.root);
    store = memoryPresetStore();
    const services: TriviumServices = {
      root: fx.root, env, cli, cmds: new TriviumCommands(cli),
      relay: new TerminalRelay(), stateWatch,
      annotationHub: new AnnotationHub(fx.root),
      saveGuard: null, presets: store,
      repoRoot: fx.root, disposables: { push: () => {} },
    };
    cockpit = new Cockpit(services);
    await cockpit.open();
  });

  teardown(async () => {
    cockpit.dispose();
    stateWatch.dispose();
  });

  test('另存（两作用域）→ 列表合并；加载可取；删除生效', async () => {
    await cockpit.handleMessageForTest({ type: 'preset-save', name: '三审严格档', scope: 'workspace', form: FORM });
    await cockpit.handleMessageForTest({ type: 'preset-save', name: '跨仓通用档', scope: 'global', form: { ...FORM, driver: 'glm', entry: 'B' } });
    const list = await store.list();
    assert.equal(list.length, 2);
    const ws = list.find((p) => p.name === '三审严格档')!;
    assert.equal(ws.scope, 'workspace');
    assert.equal(ws.driver, 'codex');
    assert.equal(ws.entry, 'A');
    assert.equal(ws.maxRounds, 5);
    assert.equal(ws.extraFlags, '--model-claude k3.1-pro');
    assert.deepEqual(ws.ctxPaths, ['src/sample.ts']);
    assert.ok(!('topic' in ws) && !('body' in ws), '会话瞬态不入库（AGY-06）');
    // 加载（跨仓路径过滤走宿主侧 filterStaleCtxPaths：src/sample.ts 存在于夹具）
    await cockpit.handleMessageForTest({ type: 'preset-load', name: '跨仓通用档', scope: 'global' });
    const g = await store.get('跨仓通用档', 'global');
    assert.equal(g!.driver, 'glm');
    // 删除
    await cockpit.handleMessageForTest({ type: 'preset-delete', name: '三审严格档', scope: 'workspace' });
    assert.equal(await store.get('三审严格档', 'workspace'), null);
    assert.equal((await store.list()).length, 1);
  });

  test('空名拒绝；同名保存为替换（更新不翻倍）', async () => {
    await cockpit.handleMessageForTest({ type: 'preset-save', name: '  ', scope: 'global', form: FORM });
    assert.equal((await store.list()).length, 0, '空名不入库');
    await cockpit.handleMessageForTest({ type: 'preset-save', name: '档', scope: 'global', form: FORM });
    await cockpit.handleMessageForTest({ type: 'preset-save', name: '档', scope: 'global', form: { ...FORM, maxRounds: 3 } });
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.maxRounds, 3);
  });
});
