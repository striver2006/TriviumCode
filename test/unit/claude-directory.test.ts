import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { ASSET_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { defaultConfig, persistProbe, loadCtx } from '../../src/trivium/config.js';
import { projectClaudeDenyPaths, buildProjectedDenySettings, verifiedClaudeDirectories, claudeDirectoryFingerprint,
  claudeSensitiveGlobsHash, CLAUDE_DIRECTORY_SHAPE, consumeClaudeDirectories,
  type ClaudeInvokeOutcome } from '../../src/trivium/adapters/claude.js';
import { judgeDirectoryArm, probeClaudeDirectories } from '../../src/trivium/probes/claude-directory.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import { resolveClaudeRoute } from '../../src/trivium/adapters/claude-route.js';
import { ProbeFixtureError } from '../../src/trivium/probes/fixture.js';
import { run, LaunchBudgetExceeded } from '../../src/trivium/util/exec.js';
import { pathToFileURL } from 'node:url';

// WIN_FILE_SKIP（Windows 移植）：断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物');
} else {

test('目录只能来自严格字面配置；相邻前缀/非法坐标/有glob的目录不压缩', () => {
  const paths = ['calls/a', 'calls/sub/b', 'calls_extra/a', 'calls', '/calls/a', 'calls/../other', 'calls//a', '中文 空格/a', 'x[1]/a'];
  const copy = [...paths];
  const p = projectClaudeDenyPaths(paths, ['calls/**', 'calls/sub/**', '中文 空格/**', '/calls/**', 'x[1]/**', '**/a', './calls/**']);
  assert.deepEqual(p.directories, [{ directory: 'calls', coveredCount: 3 }]);
  assert.deepEqual(p.paths, ['calls', 'calls_extra/a', '/calls/a', 'calls/../other', 'calls//a', '中文 空格/a', 'x[1]/a']);
  assert.deepEqual(paths, copy);
});

test('真实禁读集合离线回放：来源hash、逐项覆盖、相邻合法路径与原集合不变', async () => {
  const f = JSON.parse(await fs.readFile(path.resolve('test/fixtures/claude-deny-paths-replay.json'), 'utf8')) as {
    source: { run_id: string; field: string; paths_sha256: string; trace_source_hash: string; request_sha256: string; trace_sha256: string };
    count: number; paths: string[]; projection_globs: string[] };
  const expected = '0ae4c8999fbf6f1e6a2f34c9d093691486fc80e54880d3c629e6be9f2d1d3c6b';
  assert.equal(f.source.paths_sha256, expected);
  assert.equal(f.source.trace_source_hash, expected);
  // 固定实际原件的来源身份及hash，避免仅校验hash格式而接受被替换的来源声明。
  assert.equal(f.source.run_id, '20261010T170416Z');
  assert.equal(f.source.field, 'requests.claude.deny_paths');
  assert.equal(f.source.request_sha256, '0964aa0a6ce5079a620dfb186804348d6387c80f715d173266611f5e19c71079');
  assert.equal(f.source.trace_sha256, '6456ba00191cf7523f1f6185dce75ad7a199ba85c8784f383a5ddca2b1d58297');
  assert.equal(f.count, 3924); // 原件3924；不伪造历史2290。
  assert.equal(f.count, f.paths.length);
  assert.equal(createHash('sha256').update(JSON.stringify(f.paths)).digest('hex'), expected);
  const copy = JSON.stringify(f.paths);
  const projected = projectClaudeDenyPaths(f.paths, f.projection_globs);
  assert.deepEqual(projected.directories.map(d => d.directory), [
    'doc/05_testing/evidence/agent-access-20261010-admission/calls',
    'doc/05_testing/evidence/agent-access-20261010-admission/ledger',
    'doc/05_testing/evidence/agent-access-20261010-admission/loaded',
    'doc/05_testing/evidence/agent-access-20261010-admission/routes',
    'doc/05_testing/evidence/agent-access-20261010-closeout-r2/calls',
    'doc/05_testing/evidence/agent-access-20261010-closeout-r2/ledger',
    'doc/05_testing/evidence/agent-access-20261010-closeout-r2/loaded',
    'doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes',
  ]);
  assert.equal(projected.directories.length, 8);
  assert.equal(projected.directories.reduce((n, d) => n + d.coveredCount, 0), 3908);
  assert.equal(projected.paths.length, 24);
  assert.ok(projected.paths.length < f.paths.length);
  for (const item of f.paths) assert.ok(projected.paths.includes(item) ||
    projected.directories.some(d => item === d.directory || item.startsWith(d.directory + '/')), item);
  for (const item of ['src/cli.ts', 'README.md', 'audit-snapshots/open.txt', ...projected.directories.map(d => d.directory + '_extra/open.txt')]) {
    assert.ok(!projected.paths.includes(item));
    assert.ok(!projected.directories.some(d => item.startsWith(d.directory + '/')));
  }
  assert.equal(JSON.stringify(f.paths), copy);
});

test('未测目录前缀、过深根与后代不消费；特殊文件名不外推特殊目录', () => {
  const paths = ['safe/file[1].txt', 'safe/中文 空格,逗号.txt', 'safe/中文/a', 'safe/nested/deeper/a',
    'safe/nested/deeper/deepest/a', '.hidden/a', '中文/a', 'space dir/a', 'comma,dir/a', 'a/b/c/d/e/f/g'];
  const b = projectClaudeDenyPaths(paths, ['safe/**', '.hidden/**', '中文/**', 'space dir/**', 'comma,dir/**', 'a/b/c/d/e/f/**']);
  assert.deepEqual(b.directories, [{ directory: 'safe', coveredCount: 3 }]);
  for (const p of paths.slice(4)) assert.ok(b.paths.includes(p), p);
  assert.ok(b.paths.includes('safe/中文/a'));
});

test('宽祖先与深后代glob共存时保守回退：深文件不丢失，原集合不变', () => {
  const paths = ['a/shallow.txt', 'a/b/c/d/e/nested/deep.txt', 'outside/public.txt'];
  const copy = [...paths];
  const deepOnly = projectClaudeDenyPaths(paths, ['a/b/c/d/e/**']);
  assert.deepEqual(deepOnly.directories, [{ directory: 'a/b/c/d/e', coveredCount: 1 }]);
  const combined = projectClaudeDenyPaths(paths, ['a/**', 'a/b/c/d/e/**']);
  assert.deepEqual(combined.directories, [{ directory: 'a', coveredCount: 1 }]);
  assert.deepEqual(combined.paths, ['a', 'a/b/c/d/e/nested/deep.txt', 'outside/public.txt']);
  assert.deepEqual(paths, copy);
});

test('项目hash与生命周期守卫先拒绝；二进制0/1/2次精确路径读取，无跨调用缓存', async () => {
  const cfg = defaultConfig(), route = resolveClaudeRoute(cfg, null);
  route.bin = '/same'; route.nativeBin = '/same';
  const globs = ['a/**', '.env'], projectHash = claudeSensitiveGlobsHash(globs);
  assert.equal(projectHash, claudeSensitiveGlobsHash(['.env', 'a/**', 'a/**']));
  for (const g of [['b/**', '.env'], ['a/**'], ['a/**', '.env', 'c']]) assert.notEqual(projectHash, claudeSensitiveGlobsHash(g));
  let reads = 0, bytes = 'first';
  const reader = async () => { reads++; return Buffer.from(bytes); };
  const p = { directory_deny_verified: { Read: true }, directory_deny_fingerprint: 'pending',
    directory_deny_probed_at: new Date().toISOString(), directory_deny_sensitive_globs_sha256: projectHash,
    directory_deny_shape: CLAUDE_DIRECTORY_SHAPE };
  p.directory_deny_fingerprint = (await claudeDirectoryFingerprint(route, 'stub/0.0.0', reader))!;
  assert.equal(reads, 1); reads = 0;
  for (const over of [{ directory_deny_sensitive_globs_sha256: undefined }, { directory_deny_shape: null },
    { directory_deny_shape: 'ascii-root1-4-depth0-2-v1' },
    { directory_deny_fingerprint: null }, { directory_deny_verified: { Read: null } },
    { directory_deny_probed_at: new Date(0).toISOString() }]) {
    const result = await consumeClaudeDirectories({ ...p, ...over }, route, 'stub/0.0.0', globs, 7, reader);
    assert.deepEqual(result.consumed, {}); assert.equal(result.observedFingerprint, null);
  }
  assert.deepEqual((await consumeClaudeDirectories(p, route, 'stub/0.0.0', ['changed'], 7, reader)).consumed, {});
  assert.equal(reads, 0);
  assert.deepEqual((await consumeClaudeDirectories(p, route, 'stub/0.0.0', globs, 7, reader)).consumed, { Read: true });
  assert.equal(reads, 1); bytes = 'changed';
  assert.deepEqual((await consumeClaudeDirectories(p, route, 'stub/0.0.0', globs, 7, reader)).consumed, {});
  assert.equal(reads, 2); reads = 0; route.nativeBin = '/different';
  await claudeDirectoryFingerprint(route, 'stub/0.0.0', reader); assert.equal(reads, 2);
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
  const p = { directory_deny_verified: { Read: true, Grep: null }, directory_deny_fingerprint: 'f', directory_deny_probed_at: new Date(now).toISOString(),
    directory_deny_sensitive_globs_sha256: 'project', directory_deny_shape: CLAUDE_DIRECTORY_SHAPE };
  assert.deepEqual(verifiedClaudeDirectories(p, 'f', 7, now, 'project'), p.directory_deny_verified);
  for (const over of [{ directory_deny_probed_at: undefined }, { directory_deny_probed_at: new Date(now - 8 * 86400000).toISOString() },
    { directory_deny_probed_at: new Date(now + 1000).toISOString() }, { directory_deny_fingerprint: 'changed' }]) {
    assert.deepEqual(verifiedClaudeDirectories({ ...p, ...over }, 'f', 7, now, 'project'), {});
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
  p.directory_deny_sensitive_globs_sha256 = claudeSensitiveGlobsHash(cfg.review.sensitive_globs);
  p.directory_deny_shape = CLAUDE_DIRECTORY_SHAPE;
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await persistProbe(path.join(root, '.trivium'), cfg.probe);
  const loaded = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.deepEqual(loaded.config.probe.cli.claude?.directory_deny_verified, p.directory_deny_verified);
  // 消费者另起进程，真实读回同一份持久化事实而非共享内存。
  const configModule = pathToFileURL(path.resolve('dist/test/src/trivium/config.js')).href;
  const child = await run(process.execPath, ['--input-type=module', '-e',
    `import { loadCtx } from ${JSON.stringify(configModule)}; const c=await loadCtx({cwd:${JSON.stringify(root)},allowUninitialized:true}); console.log(JSON.stringify(c.config.probe.cli.claude));`], { timeoutMs: 10000 });
  assert.equal(child.code, 0);
  const childProbe = JSON.parse(child.stdout);
  assert.equal(childProbe.directory_deny_sensitive_globs_sha256, p.directory_deny_sensitive_globs_sha256);
  assert.equal(childProbe.directory_deny_shape, CLAUDE_DIRECTORY_SHAPE);
  assert.deepEqual(childProbe.directory_deny_verified, p.directory_deny_verified);
  assert.notEqual(await claudeDirectoryFingerprint(route, 'stub/0.0.1'), fingerprint);
  await fs.writeFile(bin, 'changed');
  assert.notEqual(await claudeDirectoryFingerprint(route, 'stub/0.0.0'), fingerprint);
  assert.deepEqual(verifiedClaudeDirectories(p, await claudeDirectoryFingerprint(route, 'stub/0.0.0'), 7), {});
});

const review = JSON.stringify({ schema: 'trivium.review.v2', verdict: 'approve', summary: 'observed', findings: [] });
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
      assert.ok(opts.schemaJson?.includes('trivium.review.v2'));
      const targets = JSON.parse(/\[[^\]]*\](?=。)/.exec(opts.prompt)?.[0] ?? '[]') as string[];
      // 方括号文件名会让简单regex歧义，按数组结束后任务分隔符解析。
      const start = opts.prompt.indexOf('['), end = opts.prompt.indexOf('。', start);
      const actual = end > start ? JSON.parse(opts.prompt.slice(start, end)) as string[] : targets;
      const positive = opts.prompt.includes('允许的正对照');
      const tool = positive ? 'Read' : /实际调用([^，]+)，/.exec(opts.prompt)![1]!;
      assert.equal(actual.length, positive ? 4 : calls % 2 === 1 ? 30 : 5);
      if (!positive) assert.ok(actual.some(p => p.startsWith('evidence/ascii_root/nested/deep/calls')));
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
      if (calls === 3) throw new LaunchBudgetExceeded({ limit: 2, used: 2, launches: [], exhausted: true });
      const start = opts.prompt.indexOf('['), end = opts.prompt.indexOf('。', start);
      return output(opts.cwd, JSON.parse(opts.prompt.slice(start, end)), 'Read');
    } });
  assert.equal(calls, 3); assert.equal(result.arms.length, 2);
  assert.deepEqual(result.verified, { Read: null, Grep: null, Glob: null });
  assert.match(result.failure!, /CLI 启动已达上限/);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});


test('is_error与permission_denials独立变异：缺失、错目标、重复及错ID均不得true', () => {
  const root = '/tmp/fixture', targets = ['calls/a'];
  const raw = output(root, targets);
  const base = raw.stdout.split('\n').map(s => JSON.parse(s));
  const judge = (events: typeof base) => judgeDirectoryArm({ ...raw, stdout: events.map(x => JSON.stringify(x)).join('\n') }, root, 'Read', targets, [], 'files').verdict;
  assert.equal(judge(base), true);
  for (const mutate of [
    (e: typeof base) => { e[2].message.content[0].is_error = false; },
    (e: typeof base) => { e[3].permission_denials = []; },
    (e: typeof base) => { e[3].permission_denials[0].tool_input.file_path = 'wrong'; },
    (e: typeof base) => { e[3].permission_denials.push(e[3].permission_denials[0]); },
    (e: typeof base) => { e[3].permission_denials.push({ tool_name: 'Read', tool_input: { file_path: 'unexpected-target' } }); },
    (e: typeof base) => { e[3].permission_denials[0].tool_name = 'Grep'; },
    (e: typeof base) => { e[2].message.content.push(e[2].message.content[0]); },
    (e: typeof base) => { e[2].message.content.push({ ...e[2].message.content[0], is_error: false }); },
    (e: typeof base) => { e[1].message.content.push(e[1].message.content[0]); },
  ]) { const e = structuredClone(base); mutate(e); assert.notEqual(judge(e), true); }
  assert.notEqual(judgeDirectoryArm(output(root, []), root, 'Read', [], [], 'files').verdict, true);
});

test('目录预期创建失败可落盘；未知内部错误继续抛且清理', async () => {
  const cfg = defaultConfig(), route = resolveClaudeRoute(cfg, null);
  const input = { critic: 'claude' as const, cfg, route, model: 'stub/0.0.0', effort: null,
    readonlyFlags: READONLY_INVARIANTS, schemaPath: path.join(ASSET_ROOT, 'schema/review.v1.json') };
  const failed = await probeClaudeDirectories({ ...input, fixtureFactory: async () => { throw new ProbeFixtureError('main', Error('fixture fail'), null); } });
  assert.ok(failed.failure); assert.deepEqual(failed.arms, []); assert.deepEqual(failed.verified, { Read: null, Grep: null, Glob: null });
  let root = '';
  await assert.rejects(probeClaudeDirectories({ ...input, invoke: async opts => { root = opts.cwd; throw new TypeError('internal-error'); } }), TypeError);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});


test('目录臂返回启动失败/超时/非零退出：停止追加，清空true，保留三臂证据与清理', async () => {
  for (const outcome of [{ spawned: false }, { timedOut: true }, { exitCode: 1 }]) {
    const cfg = defaultConfig(), route = resolveClaudeRoute(cfg, null); let calls = 0, root = '';
    const result = await probeClaudeDirectories({ critic: 'claude', cfg, route, model: 'stub/0.0.0', effort: null,
      readonlyFlags: READONLY_INVARIANTS, schemaPath: path.join(ASSET_ROOT, 'schema/review.v1.json'), invoke: async opts => {
        calls++; root = opts.cwd;
        const start = opts.prompt.indexOf('['), end = opts.prompt.indexOf('。', start);
        const targets = JSON.parse(opts.prompt.slice(start, end));
        const tool = /实际调用([^，]+)，/.exec(opts.prompt)![1]!;
        const good = output(opts.cwd, targets, tool);
        return calls === 3 ? { ...good, ...outcome } : good;
      } });
    assert.equal(calls, 3); assert.equal(result.arms.length, 3); assert.ok(result.failure);
    assert.deepEqual(result.verified, { Read: null, Grep: null, Glob: null });
    assert.equal(result.cleanup, null); await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  }
});

}
