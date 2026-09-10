import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets, assertNoSecrets } from '../../src/trivium/secrets.js';

test('干净文本不误报', () => {
  const clean = [
    '# 计划评审',
    '本次改动涉及 src/auth/oidc.ts:88，建议补充回滚路径。',
    'const timeout = 900; // seconds',
    'ZCODE_API_KEY=your_zcode_api_key_id.your_zcode_secret',   // .env.example 的占位符
    'api_key = "xxxxxxxxxxxxxxxxxxxxxxxx"',
  ].join('\n');
  assert.deepEqual(scanSecrets(clean), []);
});

test('识别 ZCode <id>.<secret> 形态凭据', () => {
  // 构造的假凭据：32 位 hex + 16 位随机串，形态与真实一致，值是编造的
  const line = '"apiKey": "0123456789abcdef0123456789abcdef.Qx7mZp2Lk9Rt4Wv1"';
  const hits = scanSecrets(line);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.rule, 'zcode-api-key');
  assert.equal(hits[0]?.line, 1);
});

test('识别 JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const hits = scanSecrets(`token: ${jwt}`);
  assert.ok(hits.some((h) => h.rule === 'jwt'), '应命中 jwt 规则');
});

test('预览已脱敏，不回显原文', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const hit = scanSecrets(jwt).find((h) => h.rule === 'jwt');
  assert.ok(hit);
  assert.ok(!hit!.preview.includes('IUzI1NiIsInR5cCI6'), '预览不得包含密钥中段');
  assert.ok(hit!.preview.includes('…'), '预览应带省略号');
});

test('多种前缀 token 均可识别', () => {
  const cases: [string, string][] = [
    ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'anthropic-key'],
    ['ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'github-token'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws-access-key-id'],
    ['AIzaSyD_1234567890abcdefghijklmnopqrstu', 'google-api-key'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'private-key-block'],
  ];
  for (const [sample, rule] of cases) {
    const hits = scanSecrets(sample);
    assert.ok(hits.some((h) => h.rule === rule), `${rule} 应命中：${sample.slice(0, 12)}…`);
  }
});

test('行号定位正确', () => {
  const text = ['第一行', '第二行', 'key: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'].join('\n');
  const hits = scanSecrets(text);
  assert.equal(hits[0]?.line, 3);
});

test('assertNoSecrets 命中时抛出且不含原文', () => {
  const secret = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  assert.throws(
    () => assertNoSecrets(`token=${secret}`, 'plan/x-gemini.md'),
    (err: Error) => {
      assert.ok(err.message.includes('拒绝落盘'));
      assert.ok(err.message.includes('plan/x-gemini.md:1'));
      assert.ok(!err.message.includes(secret), '错误信息不得包含密钥原文');
      return true;
    },
  );
});

test('assertNoSecrets 干净内容不抛', () => {
  assert.doesNotThrow(() => assertNoSecrets('# 正常的审查结论\n没有密钥。', 'plan/x-glm.md'));
});
