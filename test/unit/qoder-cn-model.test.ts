import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import {
  QoderModelFallbackError,
  QoderModelConfigurationError,
  assertQoderModelDidNotFallback,
  resolveQoderModelRequest,
  validateQoderNativeModelCatalog,
} from '../../src/trivium/adapters/qoder-cn-model.js';

const catalog = {
  source: 'official-config' as const,
  sourceFingerprint: 'config-sha256',
  defaults: { default: 'cn-default', flash: 'cn-flash', pro: 'cn-pro' },
  available: ['cn-default', 'cn-flash', 'cn-pro', 'cn-explicit'],
};

test('Qoder CN default/flash/pro 只消费官方目录中的实际默认值', () => {
  const resolved = resolveQoderModelRequest({ tier: 'default', override: null }, catalog);
  assert.equal(resolved.requested, 'cn-default');
  assert.equal(resolved.declared, 'cn-default');
  assert.equal(resolveQoderModelRequest({ tier: 'flash', override: null }, catalog).requested, 'cn-flash');
  assert.equal(resolveQoderModelRequest({ tier: 'pro', override: null }, catalog).requested, 'cn-pro');
  const override = resolveQoderModelRequest({ tier: 'default', override: 'cn-explicit' }, catalog);
  assert.equal(override.requested, 'cn-explicit');
  assert.equal(override.declared, 'cn-default');
});

test('Qoder CN 缺默认或目录不一致时 fail closed', () => {
  assert.throws(
    () => resolveQoderModelRequest({ tier: 'default', override: null }, { ...catalog, defaults: { flash: 'cn-flash', pro: 'cn-pro' } }),
    QoderModelConfigurationError,
  );
  assert.throws(
    () => validateQoderNativeModelCatalog({ ...catalog, defaults: { ...catalog.defaults, pro: 'auto' } }),
    QoderModelConfigurationError,
  );
  assert.throws(
    () => validateQoderNativeModelCatalog({ ...catalog, defaults: null as never }),
    QoderModelConfigurationError,
  );
  assert.throws(
    () => resolveQoderModelRequest({ tier: 'default', override: 'invalid' }, catalog),
    QoderModelConfigurationError,
  );
});

test('Qoder CN Auto 标签不是底层模型回读，stderr 回退即失败', () => {
  const resolved = resolveQoderModelRequest({ tier: 'default', override: null }, catalog);
  assert.throws(
    () => assertQoderModelDidNotFallback(resolved, '{"model":"Auto"}\n', ''),
    QoderModelFallbackError,
  );
  assert.throws(
    () => assertQoderModelDidNotFallback(
      resolved,
      '{"model":"cn-default"}\n',
      'Model "trivium-invalid-model" is not available right now; using "auto" instead.',
    ),
    QoderModelFallbackError,
  );
  assert.doesNotThrow(() => assertQoderModelDidNotFallback(
    resolved,
    '{"model":"cn-default","message":{"content":[{"text":"consider using path.join instead"}]}}\n',
    '',
  ));
  assert.throws(
    () => assertQoderModelDidNotFallback(resolved, '', ''),
    QoderModelFallbackError,
  );
  assert.doesNotThrow(() => assertQoderModelDidNotFallback(resolved, '{"model":"cn-default"}\n', ''));
});

test('Qoder CN 嵌套 message.model 回读与请求不符均 fail closed', () => {
  const resolved = resolveQoderModelRequest({ tier: 'default', override: null }, catalog);
  assert.throws(
    () => assertQoderModelDidNotFallback(resolved, '{"message":{"model":"cn-flash"}}\n', ''),
    /请求 cn-default.*回读 cn-flash/,
  );
  assert.doesNotThrow(() => assertQoderModelDidNotFallback(resolved, '{"message":{"model":"cn-default"}}\n', ''));
});

test('Qoder CN 真实无效模型证据中的 stdout/stderr 回退文案会阻断，即使 CLI 退出 0', () => {
  const evidence = JSON.parse(readFileSync(path.join(
    REPO_ROOT,
    'doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json',
  ), 'utf8')) as { stdout: string; stderr: string };
  const resolved = resolveQoderModelRequest({ tier: 'default', override: 'cn-default' }, catalog);
  assert.throws(
    () => assertQoderModelDidNotFallback(resolved, evidence.stdout, evidence.stderr),
    QoderModelFallbackError,
  );
});
