/** YAML 解析与深合并单测（probe 段锚点别名 + local 覆盖语义） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, deepGet } from '../../src/util/yamlLoad';
import YAML from 'yaml';

test('锚点别名展开（config.local.yaml probe 段形态）', () => {
  const doc = `
entrypoint: &ep /usr/local/bin/claude
cli:
  claude:
    entrypoint: *ep
    version_probe: &vp
      runner: null
    version_probe2: *vp
`;
  const parsed = YAML.parse(doc) as Record<string, unknown>;
  assert.equal(deepGet(parsed, ['cli', 'claude', 'entrypoint']), '/usr/local/bin/claude');
  const vp2 = deepGet(parsed, ['cli', 'claude', 'version_probe2']) as Record<string, unknown>;
  assert.equal(vp2['runner'], null);
});

test('深合并：对象递归、数组与标量替换', () => {
  const base = { review: { default_critics: ['a'], timeout_s: { plan: 100 } }, runtime: { run_root: '~/.t' } };
  const local = { review: { default_critics: ['b', 'c'], timeout_s: { plan: 200 } } };
  const merged = deepMerge(base, local) as Record<string, unknown>;
  assert.deepEqual(deepGet(merged, ['review', 'default_critics']), ['b', 'c']);
  assert.equal(deepGet(merged, ['review', 'timeout_s', 'plan']), 200);
  assert.equal(deepGet(merged, ['runtime', 'run_root']), '~/.t');
});

test('deepGet 缺层返回 undefined；非对象路径安全', () => {
  assert.equal(deepGet({ a: { b: 1 } }, ['a', 'b', 'c']), undefined);
  assert.equal(deepGet(null, ['a']), undefined);
  assert.equal(deepGet('str', ['a']), undefined);
});
