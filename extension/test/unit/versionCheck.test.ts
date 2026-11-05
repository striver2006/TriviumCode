/** 版本对齐单测（D10′：按文件类型的 schema 支持集） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchema, worstVerdict, SUPPORTED_SCHEMAS } from '../../src/env/versionCheck';

test('支持集声明', () => {
  assert.equal(SUPPORTED_SCHEMAS.status, 'trivium.status.v1');
  assert.equal(SUPPORTED_SCHEMAS.state, 'trivium.state.v1');
  assert.equal(SUPPORTED_SCHEMAS.config, 'trivium.config.v2');
});

test('同版本 → ok', () => {
  assert.equal(checkSchema('trivium.status.v1', 'status').kind, 'ok');
});

test('主版本不同 → incompatible', () => {
  const v = checkSchema('trivium.status.v2', 'status');
  assert.equal(v.kind, 'incompatible');
});

test('未知数据名 / 缺标识 / 解析不了 → unknown（保守降级）', () => {
  assert.equal(checkSchema('trivium.unknown.v1', 'status').kind, 'unknown');
  assert.equal(checkSchema(null, 'status').kind, 'unknown');
  assert.equal(checkSchema('garbage', 'status').kind, 'unknown');
});

test('worstVerdict：incompatible 优先于 unknown 优先于 ok', () => {
  assert.equal(worstVerdict([{ kind: 'ok' }, { kind: 'incompatible', reason: 'x' }]).kind, 'incompatible');
  assert.equal(worstVerdict([{ kind: 'ok' }, { kind: 'unknown', reason: 'x' }]).kind, 'unknown');
  assert.equal(worstVerdict([{ kind: 'ok' }]).kind, 'ok');
});
