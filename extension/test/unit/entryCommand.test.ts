/** 入口命令组装单测（D1′：完整模板 + 无 -- 分隔符 + 无 shell 引号） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleEntryCommand, ENTRY_COMMAND, ENTRY_STAGE, ENTRY_CLAIM_STAGE } from '../../src/launch/entryCommand';

test('命令名与阶段映射（入口 A/B/C/D）', () => {
  assert.equal(ENTRY_COMMAND.A, 'dual-run');
  assert.equal(ENTRY_COMMAND.B, 'dual-review-plan');
  assert.equal(ENTRY_COMMAND.C, 'dual-review-code');
  assert.equal(ENTRY_COMMAND.D, 'dual-review-bug');
  assert.equal(ENTRY_STAGE.A, 'all');
  assert.equal(ENTRY_STAGE.B, 'plan');
  assert.equal(ENTRY_CLAIM_STAGE.A, 'plan');
  assert.equal(ENTRY_CLAIM_STAGE.C, null);
});

test('四家注入文本形态：模板在前、正文次之、旗标在后', () => {
  const flags = ['--driver', 'codex', '--critics', 'claude,gemini'];
  assert.equal(
    assembleEntryCommand({ agentId: 'codex', entry: 'A', body: '实现缓存失效', flags }).text,
    '$dual-run 实现缓存失效 --driver codex --critics claude,gemini',
  );
  assert.equal(
    assembleEntryCommand({ agentId: 'claude', entry: 'A', body: '实现缓存失效', flags }).text,
    '/dual-run 实现缓存失效 --driver codex --critics claude,gemini',
  );
  assert.equal(
    assembleEntryCommand({ agentId: 'gemini', entry: 'A', body: '实现缓存失效', flags }).text,
    '/dual-run 实现缓存失效 --driver codex --critics claude,gemini',
  );
  assert.equal(
    assembleEntryCommand({ agentId: 'glm', entry: 'B', body: '重点看并发', flags: ['--topic', 'T'] }).text,
    '/skill dual-review-plan 重点看并发 --topic T',
  );
});

test('注入文本不添加 -- 分隔符与包裹引号（AGY-01）', () => {
  const r = assembleEntryCommand({
    agentId: 'glm', entry: 'A', body: '看 it\'s 与 $HOME',
    flags: ['--driver', 'glm'],
  });
  // 正文原样进入（含正文自带字符），模板不包引号、不插 -- 分隔符
  assert.equal(r.text, '/skill dual-run 看 it\'s 与 $HOME --driver glm');
  assert.ok(!r.text.startsWith('/skill dual-run \''));
  assert.ok(!r.text.includes(' -- \''));
});

test('多行正文单行化后进入注入文本', () => {
  const r = assembleEntryCommand({ agentId: 'claude', entry: 'A', body: '第一行\n第二行', flags: [] });
  assert.equal(r.text, '/dual-run 第一行 第二行');
});

test('正文以 -- 开头时透传警示', () => {
  const r = assembleEntryCommand({ agentId: 'claude', entry: 'A', body: '--base 冻结', flags: [] });
  assert.equal(r.warnings.length, 1);
});
