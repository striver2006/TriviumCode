import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ASSET_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { defaultConfig, persistProbe, loadCtx } from '../../src/trivium/config.js';
import { projectClaudeDenyPaths, buildProjectedDenySettings, verifiedClaudeDirectories, claudeDirectoryFingerprint,
  type ClaudeInvokeOutcome } from '../../src/trivium/adapters/claude.js';
import { judgeDirectoryArm, probeClaudeDirectories } from '../../src/trivium/probes/claude-directory.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import { resolveClaudeRoute } from '../../src/trivium/adapters/claude-route.js';

test('目录只能来自严格字面配置；相邻前缀/非法坐标/有glob的目录不压缩', () => {
  const paths = ['calls/a', 'calls/sub/b', 'calls_extra/a', 'calls', '/calls/a', 'calls/../other', 'calls//a', '中文 空格/a', 'x[1]/a'];
  const copy = [...paths];
  const p = projectClaudeDenyPaths(paths, ['calls/**', 'calls/sub/**', '中文 空格/**', '/calls/**', 'x[1]/**', '**/a', './calls/**']);
  assert.deepEqual(p.directories, [{ directory: 'calls', coveredCount: 3 }, { directory: '中文 空格', coveredCount: 1 }]);
  assert.deepEqual(p.paths, ['calls', '中文 空格', 'calls_extra/a', '/calls/a', 'calls/../other', 'calls//a', 'x[1]/a']);
  assert.deepEqual(paths, copy);
});

test('混合规则各工具三态独立；未核实仍逐文件，元字符文件可被已测字面目录覆盖', () => {
  const paths = ['calls/a', 'calls/sub/b', 'calls/file[1].txt', 'other.txt'];
  const shape = { sampleTool: 'Read', relPrefix: './' };
  const b = buildProjectedDenySettings(paths, ['Read', 'Grep', 'Glob'], shape, ['calls/**'], { Read: true, Grep: null, Glob: false });
  const rules: string[] = JSON.parse(b.json!).permissions.deny;
  assert.ok(rules.includes('Read(./calls/**)'));
  assert.ok(!rules.includes('Read(./calls/a)'));
  assert.ok(rules.includes('Grep(./calls/a)') && rules.includes('Glob(./calls/sub/b)'));
  assert.deepEqual(b.projection?.compressedTools, ['Read']);
  assert.deepEqual(b.projection?.originalSkipped, ['calls/file[1].txt']);
  assert.deepEqual(b.skipped, ['calls/file[1].txt']);
  assert.equal(b.bytes, Buffer.byteLength(b.json!, 'utf8'));
  assert.equal(b.ruleCount, rules.length);
  assert.deepEqual(buildProjectedDenySettings(paths, ['Read'], null, ['calls/**'], { Read: true }).projection?.compressedTools, []);
});

test('目录自己的时间与路线指纹控制启用；旧配置/未来时间/漂移均不继承true', () => {
  const now = Date.now();
  const p = { directory_deny_verified: { Read: true, Grep: null }, directory_deny_fingerprint: 'f', directory_deny_probed_at: new Date(now).toISOString() };
  assert.deepEqual(verifiedClaudeDirectories(p, 'f', 7, now), p.directory_deny_verified);
  for (const over of [{ directory_deny_probed_at: undefined }, { directory_deny_probed_at: new Date(now - 8 * 86400000).toISOString() },
    { directory_deny_probed_at: new Date(now + 1000).toISOString() }, { directory_deny_fingerprint: 'changed' }]) {
    assert.deepEqual(verifiedClaudeDirectories({ ...p, ...over }, 'f', 7, now), {});
  }
  assert.deepEqual(verifiedClaudeDirectories({}, 'f', 7, now), {});
});

test('目录三态持久化读回；入口内容和版本变化使旧事实失效', async () => {
  const root = await scratchDir('trivium-directory-config-');
  const cfg = defaultConfig();
  const bin = path.join(root, 'cli');
  await fs.writeFile(bin, 'first');
  const route = resolveClaudeRoute(cfg, null); route.bin = bin; route.nativeBin = bin;
  const fingerprint = await claudeDirectoryFingerprint(route, 'stub/0.0.0');
  const p = cfg.probe.cli.claude!;
  p.directory_deny_verified = { Read: true, Grep: false, Glob: null };
  p.directory_deny_probed_at = new Date().toISOString(); p.directory_deny_fingerprint = fingerprint;
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await persistProbe(path.join(root, '.trivium'), cfg.probe);
  const loaded = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.deepEqual(loaded.config.probe.cli.claude?.directory_deny_verified, p.directory_deny_verified);
  assert.notEqual(await claudeDirectoryFingerprint(route, 'stub/0.0.1'), fingerprint);
  await fs.writeFile(bin, 'changed');
  assert.notEqual(await claudeDirectoryFingerprint(route, 'stub/0.0.0'), fingerprint);
  assert.deepEqual(verifiedClaudeDirectories(p, await claudeDirectoryFingerprint(route, 'stub/0.0.0'), 7), {});
});

const review = JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'observed', findings: [] });
function output(root: string, targets: string[], tool = 'Read', denied = true, content = 'OPEN'): ClaudeInvokeOutcome {
  const lines = [{ type: 'system', subtype: 'init', cwd: root, tools: ['Read', 'Grep', 'Glob'], model: 'stub/0.0.0' },
    ...targets.flatMap((target, i) => [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: `id-${i}`, name: tool,
      input: tool === 'Read' ? { file_path: target } : { path: target, pattern: '.+' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `id-${i}`, is_error: denied, content }] } }]),
    { type: 'result', subtype: 'success', is_error: false, result: review, permission_denials: denied ? targets.map(target => ({ tool_name: tool,
      tool_input: tool === 'Read' ? { file_path: target } : { path: target, pattern: '.+' } })) : [] }];
  return { stdout: lines.map(l => JSON.stringify(l)).join('\n'), stderr: '', exitCode: 0, spawned: true, timedOut: false,
    commandLine: 'stub/0.0.0', durationMs: 1 };
}

test('目录证明必须完整交付与唯一精确配对；泄漏先判false，无调用/超时/错ID落null', () => {
  const root = '/tmp/fixture', targets = ['calls/a'];
  const good = output(root, targets);
  assert.equal(judgeDirectoryArm(good, root, 'Read', targets, ['SECRET'], 'files').verdict, true);
  assert.equal(judgeDirectoryArm({ ...good, timedOut: true }, root, 'Read', targets, ['SECRET'], 'files').verdict, null);
  assert.equal(judgeDirectoryArm({ ...good, stdout: good.stdout.replace('observed', 'SECRET') }, root, 'Read', targets, ['SECRET'], 'files').verdict, false);
  assert.equal(judgeDirectoryArm({ ...good, stdout: good.stdout.replace('"tool_use_id":"id-0"', '"tool_use_id":"wrong"') }, root, 'Read', targets, ['SECRET'], 'files').verdict, null);
  assert.equal(judgeDirectoryArm(output(root, []), root, 'Read', targets, ['SECRET'], 'files').verdict, null);
  assert.equal(judgeDirectoryArm({ ...good, stdout: good.stdout.replace(review.replaceAll('"', '\\"'), 'bad') }, root, 'Read', targets, ['SECRET'], 'files').verdict, null);
});

test('七个异质臂通过同一适配器入口、生产枚举与archive；真实CLI未启动，夹具已清理', async () => {
  const cfg = defaultConfig();
  const route = resolveClaudeRoute(cfg, null);
  route.bin = '/stub/cli'; route.nativeBin = route.bin;
  let calls = 0, fixtureRoot = '';
  const result = await probeClaudeDirectories({ critic: 'claude', cfg, route, model: 'stub/0.0.0', effort: null,
    readonlyFlags: READONLY_INVARIANTS, schemaPath: path.join(ASSET_ROOT, 'schema/review.v1.json'), invoke: async opts => {
      calls++; fixtureRoot = opts.cwd;
      assert.ok(opts.schemaJson?.includes('trivium.review.v1'));
      const targets = JSON.parse(/\[[^\]]*\](?=。)/.exec(opts.prompt)?.[0] ?? '[]') as string[];
      // 方括号文件名会让简单regex歧义，按数组结束后任务分隔符解析。
      const start = opts.prompt.indexOf('['), end = opts.prompt.indexOf('。', start);
      const actual = end > start ? JSON.parse(opts.prompt.slice(start, end)) as string[] : targets;
      const positive = opts.prompt.includes('允许的正对照');
      const tool = positive ? 'Read' : /实际调用([^，]+)，/.exec(opts.prompt)![1]!;
      if (!positive) return output(opts.cwd, actual, tool);
      const positiveOut = output(opts.cwd, actual, tool, false);
      const events = positiveOut.stdout.split('\n').map(l => JSON.parse(l));
      for (let i = 0; i < actual.length; i++) events[2 + i * 2].message.content[0].content = await fs.readFile(path.join(opts.cwd, actual[i]!), 'utf8');
      return { ...positiveOut, stdout: events.map(e => JSON.stringify(e)).join('\n') };
    } });
  assert.equal(calls, 7);
  assert.deepEqual(result.verified, { Read: true, Grep: true, Glob: true });
  assert.ok(result.sourceHash && result.settingsJson && result.denyPaths.includes('evidence/calls/.hidden'));
  await assert.rejects(fs.stat(fixtureRoot), { code: 'ENOENT' });
});

test('目录臂中途启动被拒保留已完成证据、其余未测，并完成夹具清理', async () => {
  const cfg = defaultConfig(), route = resolveClaudeRoute(cfg, null);
  route.bin = '/stub/cli'; route.nativeBin = route.bin;
  let calls = 0, root = '';
  const result = await probeClaudeDirectories({ critic: 'claude', cfg, route, model: 'stub/0.0.0', effort: null,
    readonlyFlags: READONLY_INVARIANTS, schemaPath: path.join(ASSET_ROOT, 'schema/review.v1.json'), invoke: async opts => {
      calls++; root = opts.cwd;
      if (calls === 3) throw Error('budget exhausted');
      const start = opts.prompt.indexOf('['), end = opts.prompt.indexOf('。', start);
      return output(opts.cwd, JSON.parse(opts.prompt.slice(start, end)), 'Read');
    } });
  assert.equal(calls, 3); assert.equal(result.arms.length, 2);
  assert.deepEqual(result.verified, { Read: null, Grep: null, Glob: null });
  assert.match(result.failure!, /budget exhausted/);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});
