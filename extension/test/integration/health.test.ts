/** 环境健康：夹具 probe 段（含锚点别名）解析与可用性映射 */
import * as assert from 'node:assert/strict';
import { TriviumEnv } from '../../src/env/config';
import { buildHealth } from '../../src/env/health';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { fxRoot } from './testHelper';
import { memoryPresetStore } from './fakePresets';
import type { TriviumServices } from '../../src/services';

suite('环境健康（FR-1）', function () {
  this.timeout(30_000);

  test('已 init 工作区：config + local 均可读', async () => {
    const env = new TriviumEnv(fxRoot());
    assert.equal(await env.inited(), true);
    const cfg = await env.loadConfig();
    assert.equal(cfg.schema, 'trivium.config.v2');
    assert.ok(cfg.runRoot && cfg.runRoot.includes('trivium-ext-runs-'), 'run_root 应指向夹具运行根');
    assert.deepEqual(cfg.defaultCritics, ['claude', 'gemini', 'codex']);
    assert.equal(cfg.heartbeatStaleS, 120);
  });

  test('probe 段锚点别名展开 + 健康映射（探针键用 CLI 名）', async () => {
    const env = new TriviumEnv(fxRoot());
    const probe = await env.loadProbe();
    assert.ok(probe, 'probe 段应存在');
    // 锚点 &auth_ok / *auth_ok：gemini auth 展开后仍应为对象
    assert.ok(probe!.auth['gemini'] && typeof probe!.auth['gemini'] === 'object');
    const health = buildHealth(probe);
    const claude = health.find((h) => h.agentId === 'claude')!;
    assert.equal(claude.availability, 'available');
    assert.equal(claude.version, '9.9.9-stub');
    assert.ok(claude.entrypoint && claude.entrypoint.includes('fake-tui.sh'));
    // 夹具只探了四家 CLI 键（claude/codex/agy/zcode），四家都应 available
    assert.ok(health.every((h) => h.availability === 'available'));
  });

  test('未 init 判定', async () => {
    const env = new TriviumEnv('/tmp/definitely-not-inited-xyz');
    assert.equal(await env.inited(), false);
  });

  test('未 init 时健康树为空 → viewsWelcome 引导生效（CLAUDE-05）', async () => {
    const { HealthProvider } = await import('../../src/ui/healthTree');
    const root = '/tmp/definitely-not-inited-xyz';
    const env = new TriviumEnv(root);
    const cli = new TriviumCli(root);
    const fakeServices: TriviumServices = {
      root,
      env,
      cli,
      cmds: new TriviumCommands(cli),
      relay: null as never,
      stateWatch: null as never,
      annotationHub: null as never,
      saveGuard: null,
      presets: memoryPresetStore(),
      repoRoot: root,
      disposables: { push: () => {} },
    };
    const provider = new HealthProvider(fakeServices);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(provider.getChildren().length, 0, '未 init：树为空，viewsWelcome 才会显示');
  });
});
