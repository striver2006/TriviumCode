import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StringDecoder } from 'node:string_decoder';
import { StdoutRedactor } from '../../src/trivium/live-stdout.js';
import { redactSecrets } from '../../src/trivium/secrets.js';

test('每个 UTF-8 字节切点的已发布前缀与最终脱敏结果一致', () => {
  const key = ['sk-', 'abcdefghij', 'ABCDEFGHIJKLMNOPQRST'].join('');
  const gateway = '临时网关' + 'Marker-123456789';
  const material = Buffer.from('a synthetic string only for the redaction boundary fixture!').toString('base64');
  for (const sample of [
    '行一\n\n{"消息":"中文' + key + '"}\n结束',
    'token\n  =\n  "' + material + '"\n尾行',
    'const token = ' + 'SomeRandomIdentifierNumber123.method();\n下一行',
    '-----BEGIN PRIVATE KEY-----\n' + material + '\n-----END PRIVATE KEY-----\nend',
    '第一行 ' + gateway + '\n第二行\r\n',
  ]) {
    const bytes = Buffer.from(sample);
    const expected = redactSecrets(sample.split(gateway).join('<redacted-env>')).content;
    for (let split = 0; split <= bytes.length; split++) {
      const decoder = new StringDecoder('utf8');
      const stream = new StdoutRedactor({ path: '', attempt: 1, replace: [gateway] });
      let text = '';
      for (const part of [bytes.subarray(0, split), bytes.subarray(split)]) {
        text += stream.push(decoder.write(part));
        assert.ok(expected.startsWith(text), '不能发布未经确定的前缀，切点 ' + split);
      }
      text += stream.push(decoder.end()) + stream.finish();
      assert.equal(text, expected);
    }
  }
});

test('半行 JSON 在可证明安全的边界即可追加，未闭合键值等到结束', () => {
  const redactor = new StdoutRedactor({ path: '', attempt: 1 });
  const text = '{"事件":"中"}';
  assert.equal(redactor.push(text + '{"下一事件":'), text);
  assert.equal(redactor.push('"文"'), '');
  assert.equal(redactor.finish(), '{"下一事件":"文"');
});

test('超出未决后缀上限时明确暂缓', () => {
  const redactor = new StdoutRedactor({ path: '', attempt: 1 });
  assert.equal(redactor.push('甲'.repeat(65536)), '');
  assert.equal(redactor.push('乙'.repeat(65536)), null);
});

test('完整 PEM 及谈论标记后的普通行可在 EOF 前发布', () => {
  const header = '-----BEGIN PRIVATE KEY-----';
  const body = Buffer.from('synthetic fixture for progressive redaction only').toString('base64');
  for (const sample of [header + '\n' + body + '\n-----END PRIVATE KEY-----\n', '谈到 ' + header + ' 的含义\n']) {
    const redactor = new StdoutRedactor({ path: '', attempt: 1 });
    assert.equal(redactor.push(sample), redactSecrets(sample).content);
    assert.equal(redactor.push('之后的中文输出\n'), '之后的中文输出\n');
  }
});
