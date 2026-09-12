import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgyArgs, resolveAgyAgent } from '../../src/trivium/adapters/agy.js';
import { buildZcodeArgs, readonlyArgsFromProbe, ZCODE_READONLY_DENYLIST, qualifyZcodeModel } from '../../src/trivium/adapters/zcode.js';

/*
 * 两家 CLI 的调用配方全部来自 M0 实测（坑清单 P-06 / P-07 / P-16 / AD-07 …）。
 * 项目自己的纪律第 1 条是「两家 CLI 的行为与文档不符是常态」，这些配方却一直没有
 * 回归测试守着——厂商一升级只能靠人重跑 doctor 发现。这里把 argv 拼装当契约锁住。
 */

const base = { prompt: 'BRIEF', timeoutMs: 600_000 };

test('agy：基本形态 -p <prompt> --output-format stream-json，且绝不带 --dangerously-skip-permissions（AD-07）', () => {
  const args = buildAgyArgs({ ...base });
  assert.deepEqual(args.slice(0, 4), ['-p', 'BRIEF', '--output-format', 'stream-json']);
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('agy：slug 自带档位时不传 --effort（P-16：否则 agy 直接拒绝）', () => {
  const args = buildAgyArgs({ ...base, model: 'gemini-3.8-flash-high', effort: 'medium' });
  assert.ok(args.includes('--model') && args.includes('gemini-3.8-flash-high'));
  assert.ok(!args.includes('--effort'), `不该带 --effort：${args.join(' ')}`);
});

test('agy：slug 不带档位时才传 --effort', () => {
  const args = buildAgyArgs({ ...base, model: 'claude-sonnet-4-6', effort: 'high' });
  const i = args.indexOf('--effort');
  assert.ok(i > 0);
  assert.equal(args[i + 1], 'high');
});

test('agy：--agent 与 --json-schema 只在给定时出现', () => {
  const without = buildAgyArgs({ ...base });
  assert.ok(!without.includes('--agent') && !without.includes('--json-schema'));
  const withBoth = buildAgyArgs({ ...base, agent: 'trivium-critic', jsonSchemaPath: '/s.json' });
  assert.equal(withBoth[withBoth.indexOf('--agent') + 1], 'trivium-critic');
  assert.equal(withBoth[withBoth.indexOf('--json-schema') + 1], '/s.json');
});

test('agy：--print-timeout 比脚本级超时短 20s、下限 30s（P-07：到期后 exit 0，靠墙钟判超时）', () => {
  const a = buildAgyArgs({ ...base, timeoutMs: 600_000 });
  assert.equal(a[a.indexOf('--print-timeout') + 1], '580s');
  const b = buildAgyArgs({ ...base, timeoutMs: 10_000 });
  assert.equal(b[b.indexOf('--print-timeout') + 1], '30s');
});

test('agy：只读 Agent 取自探针验证过的值（P7），探针记 null 即该侧不可用', () => {
  assert.deepEqual(resolveAgyAgent({ agent: 'trivium-critic' }, 'configured'), { agent: 'trivium-critic', reason: null });
  const r = resolveAgyAgent({ agent: null }, 'trivium-critic');
  assert.equal(r.agent, null);
  assert.match(r.reason ?? '', /doctor --only agy/);
  // 旧探针结论没有该字段：回退到配置名（兼容）
  assert.equal(resolveAgyAgent({}, 'configured').agent, 'configured');
});

test('zcode：入口在首位，--prompt / --cwd / --json --no-color，只读参数最后', () => {
  const args = buildZcodeArgs({ entry: '/z/zcode.cjs', prompt: 'BRIEF', cwd: '/proj', readonlyArgs: ['--mode', 'plan'] });
  assert.deepEqual(args, ['/z/zcode.cjs', '--prompt', 'BRIEF', '--cwd', '/proj', '--json', '--no-color', '--mode', 'plan']);
  assert.ok(!args.includes('--settings'), '--settings 被 0.16.5 拒绝，不得出现');
});

test('zcode：只读参数只传探针接受的旗标，denylist 用完整清单（含 Bash 与出网工具）', () => {
  assert.deepEqual(readonlyArgsFromProbe([]), []);
  assert.deepEqual(readonlyArgsFromProbe(['--mode plan']), ['--mode', 'plan']);
  const both = readonlyArgsFromProbe(['--mode plan', '--disallowed-tools Write,Edit,Bash']);
  assert.deepEqual(both, ['--mode', 'plan', '--disallowed-tools', ZCODE_READONLY_DENYLIST]);
  for (const t of ['Write', 'Edit', 'MultiEdit', 'ApplyPatch', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch']) {
    assert.ok(ZCODE_READONLY_DENYLIST.split(',').includes(t), `denylist 缺 ${t}`);
  }
});

test('zcode：模型短名按探针回读的 provider 前缀补全（P-06）', () => {
  assert.equal(qualifyZcodeModel('GLM-5.3', 'builtin:zhipu/GLM-5.3-Flash'), 'builtin:zhipu/GLM-5.3');
  assert.equal(qualifyZcodeModel('a/b', 'x/y'), 'a/b');
  assert.equal(qualifyZcodeModel('GLM-5.3', null), 'GLM-5.3');
});
