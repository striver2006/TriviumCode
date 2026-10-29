/** 移除候选接入后，真实 CLI、配置和入口必须同时收口。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ALL_AGENT_IDS, DRIVER_AGENT_IDS, CRITIC_AGENT_IDS } from '../../src/trivium/agents/registry.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { validateConfig } from '../../src/trivium/schemas.js';
import { resolveDriver } from '../../src/trivium/critics.js';
import { realAdapters, wiredAdapter } from '../../src/trivium/adapters/index.js';
import { cli, makeFixture, REPO_ROOT } from '../helpers/fixture.js';

test('四家注册、Driver、审核者、配置和适配器集合一致', () => {
  const expected = ['claude', 'codex', 'gemini', 'glm'];
  for (const ids of [ALL_AGENT_IDS, DRIVER_AGENT_IDS, CRITIC_AGENT_IDS,
    Object.keys(defaultConfig().agents), Object.keys(realAdapters())]) {
    assert.deepEqual([...ids].sort(), expected);
  }
  assert.deepEqual(validateConfig(defaultConfig()), []);
});

for (const [id, vendor, executable] of [['kimi', 'moonshot', 'kimi'], ['qoder-cn', 'qoder-cn', 'qoderclicn']] as const) {
  test(`已移除的 ${id} 不能经旧配置、入口或 CLI 重新启用`, async () => {
    assert.equal(wiredAdapter(id), undefined);
    assert.throws(() => resolveDriver(id), /不是已登记的 Agent/);
    const cfg = structuredClone(defaultConfig()) as unknown as { agents: Record<string, unknown> };
    cfg.agents[id] = { vendor, bin: null };
    assert.ok(validateConfig(cfg).length > 0, '旧 Agent 配置必须拒绝');
    delete cfg.agents[id];
    cfg.agents['claude'] = { vendor, bin: null };
    assert.ok(validateConfig(cfg).length > 0, '换成合法键也不能偷渡旧 vendor');
    for (const rel of [`skills-src/carriers/${id}.yaml`, `skills/dual-critic/entry/${id}`]) {
      await assert.rejects(fs.stat(path.join(REPO_ROOT, rel)), { code: 'ENOENT' });
    }
    const fx = await makeFixture({ topic: '移除接入拒绝' });
    for (const args of [
      ['topic', 'claim', '--topic', fx.topic, '--stage', 'plan', '--driver', id],
      ['doctor', '--only', executable, '--no-model-calls'],
      ['review', '--stage', 'plan', '--topic', fx.topic, '--critics', id],
    ]) {
      const result = await cli(fx.root, args);
      assert.equal(result.code, 64, result.stdout + result.stderr);
    }
  });
}
