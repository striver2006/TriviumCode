/** preset 模型与存储单测（r2 计划 D9：分层字段、校验剔除、双作用域合并、软上限） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePreset, presetFromAssembly, assemblyOf, filterStaleCtxPaths } from '../../src/presets/presetModel';
import { PresetStore } from '../../src/presets/presetStore';
import { memoryKV, memoryPresetStore } from '../integration/fakePresets';

test('装配参数 → preset：不含 topic/body（AGY-06 分层）', () => {
  const p = presetFromAssembly('三审严格档', 'global', {
    driver: 'codex', driverModel: 'alpha', driverEffort: 'high',
    critics: ['claude', 'gemini', 'glm'],
    entry: 'A',
    maxRounds: 5,
    profile: 'default',
    extraFlags: '--model-claude k3.1-pro',
    ctxPaths: ['doc/x.md'],
    now: new Date('2026-11-07T00:00:00Z'),
  });
  assert.equal(p.v, 1);
  assert.equal(p.name, '三审严格档');
  assert.equal(p.entry, 'A');
  assert.ok(!('topic' in p) && !('body' in p), '会话瞬态不入 preset');
  const a = assemblyOf(p);
  assert.equal(a.driver, 'codex');
  assert.equal(a.driverModel, 'alpha');
  assert.equal(a.driverEffort, 'high');
  const stored = sanitizePreset(JSON.parse(JSON.stringify(p)), 'global')!;
  assert.deepEqual(assemblyOf(stored), a);
  assert.deepEqual(a.critics, ['claude', 'gemini', 'glm']);
  assert.deepEqual(a.ctxPaths, ['doc/x.md']);
});

test('sanitize：未知字段剔除、坏条目 null、entry 枚举校验', () => {
  assert.equal(sanitizePreset({ name: 'x', driver: 'glm', critics: ['claude'], entry: 'E', extraFlags: '' }, 'global'), null);
  assert.equal(sanitizePreset('不是对象', 'global'), null);
  assert.equal(sanitizePreset(null, 'global'), null);
  const ok = sanitizePreset({ name: 'n', driver: 'glm', critics: [], entry: 'A', extraFlags: '', hack: '注入字段' }, 'workspace');
  assert.ok(ok);
  assert.equal(assemblyOf(ok).driverModel, undefined);
  assert.equal(assemblyOf(ok).driverEffort, undefined);
  assert.ok(!('hack' in (ok as object)), '未知字段被剔除');
});

test('PresetStore：双作用域存取 + 同名 workspace 优先', async () => {
  const store = new PresetStore(memoryKV(), memoryKV());
  await store.save(presetFromAssembly('档一', 'global', { driver: 'codex', critics: [], entry: 'A', extraFlags: '' }));
  await store.save(presetFromAssembly('档一', 'workspace', { driver: 'glm', critics: [], entry: 'B', extraFlags: '' }));
  const list = await store.list();
  assert.equal(list.length, 1, '同名合并（workspace 覆盖显示）');
  assert.equal(list[0]!.scope, 'workspace');
  assert.equal((await store.get('档一', 'global'))!.driver, 'codex', '两作用域各自保留');
});

test('PresetStore：保存去重替换、删除、软上限', async () => {
  const store = memoryPresetStore();
  await store.save(presetFromAssembly('a', 'global', { driver: 'glm', critics: [], entry: 'A', extraFlags: 'v1' }));
  await store.save(presetFromAssembly('a', 'global', { driver: 'glm', critics: [], entry: 'A', extraFlags: 'v2' }));
  assert.equal((await store.get('a', 'global'))!.extraFlags, 'v2');
  assert.equal(await store.remove('a', 'global'), true);
  assert.equal(await store.remove('a', 'global'), false);
});

test('PresetStore：坏条目读取容错剔除不阻断', async () => {
  const g = memoryKV();
  // 直接写入一条坏数据（模拟 storage 损坏）
  await g.update('trivium.presets', [{ name: '', driver: 'x' }, { name: '好条目', driver: 'glm', critics: [], entry: 'A', extraFlags: '' }]);
  const store = new PresetStore(g, memoryKV());
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.name, '好条目');
});

test('跨仓 ctxPaths 存在性过滤：失效标注跳过', async () => {
  const { keep, stale } = await filterStaleCtxPaths(
    async (p) => p.replace(/\\/g, '/') === '/root/exists.md',
    ['exists.md', 'gone.md'],
    '/root',
  );
  assert.deepEqual(keep, ['exists.md']);
  assert.deepEqual(stale, ['gone.md']);
});
