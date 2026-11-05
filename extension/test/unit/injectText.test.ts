/** injectText 单测：单行化与警示（AGY-01 落点） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenBody, prepareBody } from '../../src/util/injectText';

test('多行正文单行化', () => {
  assert.equal(flattenBody('第一行\n第二行\n\n第三行'), '第一行 第二行 第三行');
  assert.equal(flattenBody('  制表\t与  多空格  '), '制表 与 多空格');
});

test('正常正文无警示', () => {
  const r = prepareBody('实现缓存失效策略，过期后重新加载');
  assert.equal(r.warnings.length, 0);
  assert.equal(r.text, '实现缓存失效策略，过期后重新加载');
});

test('空正文警示', () => {
  const r = prepareBody('   \n  ');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /正文为空/);
});

test('以 --xxx 开头的正文警示（吞旗标风险）', () => {
  const r = prepareBody('--base 真正进入冻结');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /旗标/);
});

test('超长正文警示', () => {
  const r = prepareBody('长'.repeat(1200));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /KB/);
});

test('中文与特殊字符保真（不转义、不去引号）', () => {
  const raw = '看 it\'s 这一处与 "双引号" 及 $HOME 与 `反引号`';
  assert.equal(prepareBody(raw).text, raw);
});
