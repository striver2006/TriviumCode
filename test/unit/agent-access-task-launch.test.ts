/** 13B/r18任务入口直接回归：独立仓库/HOME和假产品CLI，零厂商启动。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { makeFixture, ASSET_ROOT, REPO_ROOT } from '../helpers/fixture.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { computeBuildStamp } from '../../src/trivium/build-stamp.js';
import { emptyTask, newRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import { claudeDirectoryFingerprint, claudeSensitiveGlobsHash, CLAUDE_DIRECTORY_SHAPE } from '../../src/trivium/adapters/claude.js';
import { resolveClaudeRoute } from '../../src/trivium/adapters/claude-route.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';

// WIN_FILE_SKIP（Windows 移植）：夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）');
} else {
const relative = 'doc/05_testing/evidence/agent-access-20261011-closeout-r3';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

async function world(stage: 'plan' | 'code' = 'plan', carrier?: { launcher: string; ordinal: number }) {
  const fixture = await makeFixture({ topic: 'isolated-token', draft: false });
  const root = fixture.root, home = path.join(root, 'isolated-home');
  const scripts = path.join(root, relative), budget = path.join(home, '.trivium/evidence/agent-access-20261011-closeout-r3/budget');
  const calls = path.join(home, '.trivium/evidence/agent-access-20261011-closeout-r3/calls');
  await fs.mkdir(scripts, { recursive: true }); await fs.mkdir(budget, { recursive: true });
  await fs.symlink(path.join(REPO_ROOT, 'dist'), path.join(root, 'dist'), 'dir');
  await fs.symlink(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), 'dir');
  for (const name of new Set(['launch-v10.mjs', 'quiet-launch-v7.mjs', 'quiet-launch-v8.mjs', 'round-guard-v2.mjs', 'formal-start-precheck-v2.mjs',
    ...(carrier ? [carrier.launcher] : [])]))
    await fs.copyFile(path.join(REPO_ROOT, relative, name), path.join(scripts, name));
  const launcher = carrier?.launcher ?? 'launch-v10.mjs';
  const launcherSource = await fs.readFile(path.join(scripts, launcher), 'utf8');
  const authNames = [...launcherSource.matchAll(/'(?<file>formal-round-authorization-v\d+\.json)'/g)].map(m => m.groups!['file']!);
  assert.equal(authNames.length, 1, '实际launcher只有一个精确授权引用');
  const authFile = authNames[0]!;
  const original = carrier ? JSON.parse(await fs.readFile(path.join(REPO_ROOT, relative, authFile), 'utf8')) : null;
  const authorization = original ? { ...original, topic: fixture.topic } :
    { topic: fixture.topic, driver: 'codex', critics: ['claude', 'gemini', 'glm'],
      new_limit: 1, historical_run_ids: [], new_rounds: [{ ordinal: 1, entry: stage === 'code' ? 'C' : 'B', stage }] };
  const authBytes = JSON.stringify(authorization);
  await fs.writeFile(path.join(scripts, authFile), authBytes);
  await fs.writeFile(path.join(scripts, 'formal-round-authority.json'), JSON.stringify({ topic: fixture.topic,
    authorization: authFile, sha256: sha(authBytes) }));
  await fs.mkdir(path.join(fixture.archiveRoot, fixture.topic), { recursive: true });
  const taskFile = path.join(fixture.archiveRoot, fixture.topic, 'task.json');
  const task = emptyTask(fixture.topic);
  // 真实archive出口产生合成历史，子进程须经实际listRecordedRuns校验；不伪造真实审查。
  for (let i = 0; i < (carrier?.ordinal ?? 1) - 1; i++) {
    const runId = authorization.historical_run_ids[i] ?? `fixture-prior-${i}`;
    const meta = newRunMeta({ runId, topic: fixture.topic, stage: 'plan', rerunIndex: i + 1, command: 'fixture-only',
      promptHint: null, taskGoal: null, driver: 'codex', criticsSelected: ['claude', 'gemini', 'glm'],
      treeHash: 'fixture-tree', gitHead: null, dirty: false, subjectSha256: 'fixture-subject', denyPaths: [], driftPolicy: 'warn' });
    await writeRunMeta({ archiveRoot: fixture.archiveRoot, topic: fixture.topic }, 'plan', meta);
    task.runs.push({ run_id: runId, stage: 'plan', rerun_index: i + 1, status: meta.status,
      review_mode: meta.review_mode, started_at: meta.started_at, driver: 'codex' });
  }
  await fs.writeFile(taskFile, JSON.stringify(task));
  const legacy = path.join(root, 'doc/05_testing/evidence/agent-access-20261010-closeout-r2');
  await fs.mkdir(legacy, { recursive: true });
  const continuity = JSON.stringify({ source: legacy, destination: budget, files: [] });
  await fs.writeFile(path.join(budget, 'continuity.json'), continuity);
  await fs.writeFile(path.join(scripts, 'budget-continuity-r12.json'), continuity);
  await fs.writeFile(path.join(budget, 'approval.json'), JSON.stringify({ initial_limits: { review: 20, admission: 20 } }));
  const marker = path.join(home, 'product-spawned.jsonl');
  const wrapper = path.join(root, '.trivium/bin/trivium');
  await fs.mkdir(path.dirname(wrapper), { recursive: true });
  await fs.writeFile(wrapper, `#!${process.execPath}\n` +
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify({argv:process.argv.slice(2),token:process.env.TRIVIUM_ACCESS_LOAD_TOKEN})+'\\n');\n` +
    `if(process.env.FIXTURE_NO_COMPLETION==='1'){process.kill(process.ppid,'SIGKILL');process.exit(0);}\n` +
    `console.log(JSON.stringify({ok:true}));process.exit(Number(process.env.FIXTURE_PRODUCT_CODE||0));\n`, { mode: 0o700 });
  const cfg = defaultConfig(), bin = path.join(home, 'stub-native');
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(bin, '#!/bin/sh\nexit 99\n', { mode: 0o700 }); // 测量只hash，不能执行。
  const agent = cfg.agents.claude; assert.ok(agent?.vendor === 'anthropic'); agent.bin = bin;
  cfg.profiles.default!.claude = { plan: 'plan-fixture', code: 'code-fixture', bug: 'bug-fixture' };
  cfg.runtime.run_root = fixture.runRoot;
  cfg.review.sensitive_globs = ['.env', 'evidence/a/b/c/d/**'];
  const sensitive = path.join(root, 'evidence/a/b/c/d/sample.txt');
  await fs.mkdir(path.dirname(sensitive), { recursive: true }); await fs.writeFile(sensitive, 'placeholder');
  const probe = cfg.probe.cli.claude!;
  Object.assign(probe, { entrypoint: bin, version: 'stub/0.0.0', probed_at: new Date().toISOString(),
    readonly_flags: [...READONLY_INVARIANTS], json_schema_ok: true,
    path_deny: { supported: true, rule_syntax: 'Read(./evidence/a/b/c/d/**)', file_shape_verified: true },
    directory_deny_verified: { Read: true, Grep: true, Glob: true }, directory_deny_probed_at: new Date().toISOString(),
    directory_deny_sensitive_globs_sha256: claudeSensitiveGlobsHash(cfg.review.sensitive_globs), directory_deny_shape: CLAUDE_DIRECTORY_SHAPE });
  probe.directory_deny_fingerprint = await claudeDirectoryFingerprint(resolveClaudeRoute(cfg, null, probe.version), probe.version);
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), YAML.stringify(cfg));
  await fs.writeFile(path.join(root, '.trivium/config.local.yaml'), '{}\n');
  await fs.appendFile(path.join(root, '.gitignore'), '\ndist/\nisolated-home/\nskills/dual-critic/scripts/trivium.cjs\n');
  const stamp = await computeBuildStamp(root); assert.ok(stamp);
  const bundle = `inputs_sha256: "${stamp.inputs_sha256}"\n`;
  const source = path.join(root, 'skills/dual-critic/scripts/trivium.cjs');
  const installed = path.join(home, '.claude/skills/dual-critic/scripts/trivium.cjs');
  for (const file of [source, installed]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bundle); }
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TRIVIUM_ASSET_ROOT: ASSET_ROOT };
  delete env.NODE_OPTIONS; delete env.TRIVIUM_ACCESS_REQUEST_TOKEN;
  return { ...fixture, home, scripts, calls, budget, marker, taskFile, installed, env, launcher, authFile };
}

type World = Awaited<ReturnType<typeof world>>;
function launch(w: World, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(w.scripts, w.launcher), 'review', 'same-label', 'tv', ...args],
    { cwd: w.root, env: { ...w.env, ...env }, encoding: 'utf8', timeout: 20000 });
}
function quiet(w: World, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(w.scripts, 'quiet-launch-v7.mjs'), 'v10', 'review', 'same-label', 'tv', ...args],
    { cwd: w.root, env: { ...w.env, ...env }, encoding: 'utf8', timeout: 20000 });
}
const claim = ['topic', 'claim', '--topic', 'isolated-token', '--stage', 'plan', '--driver', 'codex'];
async function reserved(w: World) {
  try { return (await fs.readdir(path.join(w.budget, 'ledger/review'))).filter(n => n.startsWith('reserved-')).length; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw e; }
}

test('quiet-v7同label重试各配本次token，缺本次完成不得选择旧成功', async () => {
  const w = await world();
  const first = quiet(w, claim), second = quiet(w, claim);
  assert.equal(first.status, 0, first.stderr); assert.equal(second.status, 0, second.stderr);
  const a = JSON.parse(first.stdout), b = JSON.parse(second.stdout);
  assert.notEqual(a.load_id, b.load_id); assert.notEqual(a.evidence, b.evidence);
  assert.equal(a.validated, true); assert.equal(b.validated, true);
  for (const item of [a, b]) {
    const request = JSON.parse(await fs.readFile(path.join(w.calls, `same-label-${item.load_id}-requested.json`), 'utf8'));
    const completed = JSON.parse(await fs.readFile(item.evidence, 'utf8'));
    assert.equal(request.load_id, item.load_id); assert.equal(completed.load_id, item.load_id);
    assert.equal(completed.primary_loaded, true);
  }
  const markers = (await fs.readFile(w.marker, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  assert.deepEqual(markers.map(m => m.token), [a.load_id, b.load_id]);
  const missing = quiet(w, claim, { FIXTURE_NO_COMPLETION: '1' });
  assert.notEqual(missing.status, 0); const failed = JSON.parse(missing.stdout);
  assert.equal(failed.validated, false); assert.equal(failed.evidence, null); assert.equal(failed.signal, 'SIGKILL');
  assert.equal(await reserved(w), 0);
});

test('quiet-v7证据选择直接覆盖错token、目标字段、时间、装载与退出信息', async () => {
  const w = await world(), result = quiet(w, claim); assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  const requestFile = path.join(w.calls, `same-label-${summary.load_id}-requested.json`);
  const request = JSON.parse(await fs.readFile(requestFile, 'utf8'));
  const completeBytes = await fs.readFile(summary.evidence, 'utf8'), complete = JSON.parse(completeBytes);
  const { selectCurrentEvidence } = await import(pathToFileURL(path.join(w.scripts, 'quiet-launch-v7.mjs')).href);
  const current = { token: summary.load_id, label: 'same-label', pool: 'review', startedAt: Date.parse(request.requested_at),
    code: 0, signal: null, launcherSha256: sha(await fs.readFile(path.join(w.scripts, 'launch-v10.mjs'))) };
  assert.equal(selectCurrentEvidence(w.calls, current).file, summary.evidence);
  for (const change of [{ load_id: randomUUID() }, { label: 'other' }, { pool: 'admission' }, { mode: 'probe' },
    { primary_loaded: false }, { code: 64 }, { signal: 'SIGTERM' }, { requested_at: '2000-01-01T00:00:00.000Z' },
    { script_sha256: '0'.repeat(64) }, { execution_sha256: '0'.repeat(64) }]) {
    await fs.writeFile(summary.evidence, JSON.stringify({ ...complete, ...change }));
    assert.throws(() => selectCurrentEvidence(w.calls, current));
  }
  await fs.writeFile(summary.evidence, completeBytes);
  for (const change of [{ token: randomUUID() }, { label: 'other' }, { startedAt: Date.parse(request.requested_at) + 1 },
    { code: 2 }, { signal: 'SIGTERM' }, { launcherSha256: '0'.repeat(64) }])
    assert.throws(() => selectCurrentEvidence(w.calls, { ...current, ...change }));
  await fs.rm(requestFile); assert.throws(() => selectCurrentEvidence(w.calls, current));
});

test('quiet-v7缺值/旗标样式/重复/错误version在真实main拒绝，0产品spawn/预算/task变动', async () => {
  const w = await world(), before = await fs.readFile(w.taskFile, 'utf8');
  for (const argv of [claim.filter(x => x !== 'codex'), ['topic', 'claim', '--topic', '--driver', 'codex', '--stage', 'plan'],
    ['topic', 'resolve', '--stage', '--', 'focus'], [...claim, '--stage', 'code'],
    ['preflight', '--stage', 'plan', '--driver', 'codex', '--critics', '--json'], ['review', '--start']]) {
    const result = quiet(w, argv); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  }
  const old = spawnSync(process.execPath, [path.join(w.scripts, 'quiet-launch-v7.mjs'), 'v8', 'review', 'same-label', 'tv', ...claim],
    { cwd: w.root, env: w.env, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(old.status, 0);
  await assert.rejects(fs.access(w.marker)); await assert.rejects(fs.access(w.calls));
  assert.equal(await reserved(w), 0); assert.equal(await fs.readFile(w.taskFile, 'utf8'), before);
  for (const argv of [claim, ['topic', 'resolve', '--stage', 'plan', '--json', '--', 'focus'],
    ['preflight', '--stage', 'plan', '--driver', 'codex', '--critics', 'claude,gemini,glm']]) {
    const result = quiet(w, argv); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).validated, true);
  }
});

test('launch-v10重复token跨label拒绝，invalid token在预算/测量/spawn前拒绝', async () => {
  const w = await world(), token = randomUUID();
  const first = launch(w, claim, { TRIVIUM_ACCESS_REQUEST_TOKEN: token }); assert.equal(first.status, 0, first.stderr);
  const markerBefore = await fs.readFile(w.marker, 'utf8');
  const same = launch(w, claim, { TRIVIUM_ACCESS_REQUEST_TOKEN: token }); assert.notEqual(same.status, 0);
  const other = spawnSync(process.execPath, [path.join(w.scripts, 'launch-v10.mjs'), 'review', 'different-label', 'tv', ...claim],
    { cwd: w.root, env: { ...w.env, TRIVIUM_ACCESS_REQUEST_TOKEN: token }, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(other.status, 0);
  assert.notEqual(launch(w, claim, { TRIVIUM_ACCESS_REQUEST_TOKEN: '../invalid' }).status, 0);
  assert.equal(await fs.readFile(w.marker, 'utf8'), markerBefore); assert.equal(await reserved(w), 0);
  const orphanToken = randomUUID();
  const orphan = spawnSync(process.execPath, [path.join(w.scripts, 'launch-v10.mjs'), 'invalid-pool', 'orphan-label', 'tv', ...claim],
    { cwd: w.root, env: { ...w.env, TRIVIUM_ACCESS_REQUEST_TOKEN: orphanToken }, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(orphan.status, 0);
  assert.notEqual(launch(w, claim, { TRIVIUM_ACCESS_REQUEST_TOKEN: orphanToken }).status, 0);
  assert.equal(await fs.readFile(w.marker, 'utf8'), markerBefore); assert.equal(await reserved(w), 0);
});

test('quiet-v7缺本次证据时保留child 2/64，child0仍退出失败1', async () => {
  const w = await world();
  // 故意在临时复制树中用本地退出边界模拟launcher未产证据；生产原件不动。
  await fs.writeFile(path.join(w.scripts, 'launch-v10.mjs'), 'process.exit(Number(process.env.FIXTURE_EXIT_CODE));\n');
  for (const code of [2, 64, 0]) {
    const result = quiet(w, claim, { FIXTURE_EXIT_CODE: String(code) });
    assert.equal(result.status, code === 0 ? 1 : code);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.code, code); assert.equal(summary.signal, null); assert.equal(summary.evidence, null);
    assert.equal(summary.validated, false); assert.equal(summary.ok, false);
  }
  assert.equal(await reserved(w), 0); await assert.rejects(fs.access(w.marker));
});

test('v10生产stage分支：plan无测量；code测量通过才spawn，失败0 spawn/reserve/run', async () => {
  for (const stage of ['plan', 'code'] as const) {
    const w = await world(stage), before = await fs.readFile(w.taskFile, 'utf8');
    const args = ['review', '--start', '--entry', stage === 'code' ? 'C' : 'B', '--stage', stage,
      '--topic', w.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm'];
    const result = launch(w, args); assert.equal(result.status, 0, result.stderr);
    const measurements = (await fs.readdir(w.calls)).filter(n => n.endsWith('-start-measurement.json'));
    assert.equal(measurements.length, stage === 'code' ? 1 : 0);
    if (stage === 'code') {
      const measurement = JSON.parse(await fs.readFile(path.join(w.calls, measurements[0]!), 'utf8'));
      assert.equal(measurement.stage, 'code'); assert.equal(measurement.cli_version, 'stub/0.0.0');
      await fs.writeFile(w.installed, 'wrong-install'); await fs.rm(w.marker);
      const failed = launch(w, args); assert.notEqual(failed.status, 0);
      await assert.rejects(fs.access(w.marker));
    }
    assert.equal(await reserved(w), 0); assert.equal(await fs.readFile(w.taskFile, 'utf8'), before);
  }
});

test('precheck-v2默认测量链直测缺/未知stage与真实plan/code路由、投影、hash回读', async () => {
  const w = await world('code');
  const precheck = pathToFileURL(path.join(REPO_ROOT, relative, 'formal-start-precheck-v2.mjs')).href;
  const code = `import {measureCodeStart,assertCodeStartMeasurement} from ${JSON.stringify(precheck)};` +
    `const [repo,topic,stage]=process.argv.slice(1);const m=await measureCodeStart(repo,topic,stage==='missing'?[]:['--stage',stage]);` +
    `assertCodeStartMeasurement(m);console.log(JSON.stringify(m));`;
  for (const stage of ['missing', 'unknown', 'plan', 'code']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, w.root, w.topic, stage],
      { cwd: w.root, env: w.env, encoding: 'utf8', timeout: 20000 });
    if (stage === 'missing' || stage === 'unknown') {
      assert.notEqual(result.status, 0); assert.match(result.stderr, /stage缺失或未知/); continue;
    }
    assert.equal(result.status, 0, result.stderr); const m = JSON.parse(result.stdout);
    assert.equal(m.stage, stage); assert.equal(m.requested_model, `${stage}-fixture`); assert.equal(m.profile, null);
    assert.equal(m.cli_version, 'stub/0.0.0'); assert.equal(m.inputs_match, true); assert.equal(m.install_matches_source, true);
    assert.equal(m.directory_fact_consumed, true); assert.equal(m.skipped_count, 0); assert.equal(m.real_cli_starts, 0);
    const expectedPaths = ['.trivium', w.runRoot, '.env', 'evidence/a/b/c/d/sample.txt'].sort();
    assert.equal(m.source_paths_count, expectedPaths.length);
    assert.equal(m.source_paths_sha256, sha(JSON.stringify(expectedPaths)));
    assert.ok(m.settings_bytes > 0);
  }
  const { assertCodeStartMeasurement } = await import(precheck);
  const valid = { install_matches_source: true, inputs_match: true, settings_bytes: 131072, skipped_count: 0,
    file_shape_verified: true, directory_shape: CLAUDE_DIRECTORY_SHAPE, directory_fact_consumed: true, deny_settings_applied: true };
  for (const change of [{ install_matches_source: false }, { inputs_match: false }, { settings_bytes: 131073 }, { settings_bytes: -1 },
    { skipped_count: 1 }, { file_shape_verified: false }, { directory_shape: 'old' }, { directory_fact_consumed: false }, { deny_settings_applied: false }])
    assert.throws(() => assertCodeStartMeasurement({ ...valid, ...change }));
  assert.equal(await reserved(w), 0); await assert.rejects(fs.access(w.marker));
});


test('quiet-v8完整摘要脱敏覆盖尾行和其他字符串，保持code/signal及JSON形状', async () => {
  const { renderQuietSummary } = await import(pathToFileURL(path.join(REPO_ROOT, relative, 'quiet-launch-v8.mjs')).href);
  const { scanSecrets } = await import('../../src/trivium/secrets.js');
  const synthetic = 'sk-' + 'Z'.repeat(48);
  const summary = { code: 64, signal: null, validated: false, evidence: null,
    stderr_summary: 'line1\nline2\napi_key=' + synthetic, validation_error: synthetic };
  const text = renderQuietSummary(summary);
  assert.equal(text.includes(synthetic), false); assert.deepEqual(scanSecrets(text), []);
  const actual = JSON.parse(text);
  assert.equal(actual.code, 64); assert.equal(actual.signal, null); assert.equal(actual.validated, false);
  assert.equal(actual.evidence, null); assert.equal(actual.stderr_summary.split('\n').length, 3);
});

test('quiet-v8本地launcher自身错误也脱敏，缺证据child0/2/64边界不变', async () => {
  const w = await world();
  const { scanSecrets } = await import('../../src/trivium/secrets.js');
  // 只替换独立夹具内的launcher；合成值经断言检查，测试日志不输出原值。
  const synthetic = 'sk-' + 'Z'.repeat(48);
  await fs.writeFile(path.join(w.scripts, 'launch-v10.mjs'),
    'console.error("line1\\nline2\\napi_key="+process.env.FIXTURE_SYNTHETIC);process.exit(Number(process.env.FIXTURE_EXIT_CODE));\n');
  for (const code of [0, 2, 64]) {
    const result = spawnSync(process.execPath, [path.join(w.scripts, 'quiet-launch-v8.mjs'), 'v10', 'review', 'same-label', 'tv', ...claim],
      { cwd: w.root, env: { ...w.env, FIXTURE_SYNTHETIC: synthetic, FIXTURE_EXIT_CODE: String(code) }, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, code === 0 ? 1 : code);
    assert.equal(result.stdout.includes(synthetic), false); assert.equal(result.stderr.includes(synthetic), false);
    assert.deepEqual(scanSecrets(result.stdout), []); assert.deepEqual(scanSecrets(result.stderr), []);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.code, code); assert.equal(summary.signal, null); assert.equal(summary.validated, false);
    assert.equal(summary.evidence, null); assert.equal(summary.ok, false);
    assert.ok(summary.stderr_summary.length > 0);
  }
  assert.equal(await reserved(w), 0); await assert.rejects(fs.access(w.marker));
});

/** 17C GLM-01：当前载体接线必须真起子进程，旧v10覆盖不能替代。 */
async function exerciseCarrier(launcher: string, ordinal: number, stage: 'plan' | 'code') {
  const w = await world(stage, { launcher, ordinal });
  const args = ['review', '--start', '--entry', stage === 'code' ? 'C' : 'B', '--stage', stage,
    '--topic', w.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm'];
  const taskBefore = await fs.readFile(w.taskFile, 'utf8');
  const rejected = async (argv: string[], env: NodeJS.ProcessEnv = {}) => {
    const markers = await fs.readFile(w.marker, 'utf8').catch(() => null);
    const result = launch(w, argv, env); assert.notEqual(result.status, 0);
    assert.equal(await fs.readFile(w.marker, 'utf8').catch(() => null), markers, '拒绝发生于产品spawn之前');
    assert.equal(await reserved(w), 0); assert.equal(await fs.readFile(w.taskFile, 'utf8'), taskBefore);
    return result;
  };
  for (const flag of ['--topic', '--driver', '--critics', '--entry', '--stage']) {
    const wrong = [...args]; wrong[wrong.indexOf(flag) + 1] = 'wrong';
    await rejected(wrong); await rejected([...args, flag, args[args.indexOf(flag) + 1]!]);
  }
  await rejected([...args, '--allow-single']);
  const auth = path.join(w.scripts, w.authFile), authBytes = await fs.readFile(auth, 'utf8');
  await fs.writeFile(auth, authBytes + '\n'); assert.match((await rejected(args)).stderr, /hash漂移/);
  await fs.writeFile(auth, authBytes);
  const good = launch(w, args); assert.equal(good.status, 0, good.stderr);
  const markers = (await fs.readFile(w.marker, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  assert.equal(markers.length, 1); assert.deepEqual(markers[0].argv, args);
  const requestedFiles = (await fs.readdir(w.calls)).filter(n => n.endsWith(`-${markers[0].token}-requested.json`));
  const completedFiles = (await fs.readdir(w.calls)).filter(n => n.endsWith(`-${markers[0].token}-completed.json`));
  assert.equal(requestedFiles.length, 1); assert.equal(completedFiles.length, 1);
  const request = JSON.parse(await fs.readFile(path.join(w.calls, requestedFiles[0]!), 'utf8'));
  const complete = JSON.parse(await fs.readFile(path.join(w.calls, completedFiles[0]!), 'utf8'));
  assert.equal(request.load_id, markers[0].token); assert.equal(complete.load_id, markers[0].token);
  assert.equal(complete.primary_loaded, true); assert.equal(request.script_sha256, sha(await fs.readFile(path.join(w.scripts, launcher))));
  assert.equal(request.round_authorization_sha256, sha(authBytes));
  const measurements = (await fs.readdir(w.calls)).filter(n => n.endsWith('-start-measurement.json'));
  assert.equal(measurements.length, stage === 'code' ? 1 : 0);
  if (stage === 'code') {
    assert.equal(JSON.parse(await fs.readFile(path.join(w.calls, measurements[0]!), 'utf8')).cli_version, 'stub/0.0.0');
    const installed = await fs.readFile(w.installed);
    await fs.writeFile(w.installed, 'wrong-install'); assert.match((await rejected(args)).stderr, /启动条件/);
    await fs.writeFile(w.installed, installed);
  }
  await rejected(args, { TRIVIUM_ACCESS_REQUEST_TOKEN: markers[0].token });
  // 产品是假的，不推进task；追加真实合成元数据达到该权威上限，必须拒绝下一次。
  const task = JSON.parse(taskBefore), meta = newRunMeta({ runId: 'fixture-next', topic: w.topic,
    stage, rerunIndex: ordinal, command: 'fixture-only', promptHint: null, taskGoal: null, driver: 'codex',
    criticsSelected: ['claude', 'gemini', 'glm'], treeHash: 'fixture-tree', gitHead: null, dirty: false,
    subjectSha256: 'fixture-subject', denyPaths: [], driftPolicy: 'warn' });
  await writeRunMeta({ archiveRoot: w.archiveRoot, topic: w.topic }, stage, meta);
  task.runs.push({ run_id: meta.run_id, stage, rerun_index: ordinal, status: meta.status,
    review_mode: meta.review_mode, started_at: meta.started_at, driver: 'codex' });
  await fs.writeFile(w.taskFile, JSON.stringify(task));
  const markerBefore = await fs.readFile(w.marker, 'utf8'), failed = launch(w, args);
  assert.notEqual(failed.status, 0); assert.equal(await fs.readFile(w.marker, 'utf8'), markerBefore); assert.equal(await reserved(w), 0);
}

test('launch-v12实际v8接线：15历史允许16B，16历史允许17C且17历史拒18', async () => {
  await exerciseCarrier('launch-v12.mjs', 16, 'plan');
  await exerciseCarrier('launch-v12.mjs', 17, 'code');
});

test('当前authority唯一launcher引用直接执行，换载体仍覆盖而不只核旧v10', async () => {
  const pointer = JSON.parse(await fs.readFile(path.join(REPO_ROOT, relative, 'formal-round-authority.json'), 'utf8'));
  const authBytes = await fs.readFile(path.join(REPO_ROOT, relative, pointer.authorization));
  assert.equal(sha(authBytes), pointer.sha256);
  const current = JSON.parse(authBytes.toString());
  assert.equal(current.delegated_round_extensions, true);
  assert.equal(current.delegation_exact_reply, '授权轮次可以按需增加，不必询问授权');
  assert.equal(current.criteria_change_authorized, false);
  const matches = [];
  for (const name of (await fs.readdir(path.join(REPO_ROOT, relative))).filter(n => /^launch-v\d+\.mjs$/.test(n)))
    if ((await fs.readFile(path.join(REPO_ROOT, relative, name), 'utf8')).includes(`'${pointer.authorization}'`)) matches.push(name);
  assert.equal(matches.length, 1, '当前指针只对应一份实际launcher');
  for (const round of current.new_rounds) await exerciseCarrier(matches[0]!, round.ordinal, round.stage);
});

}
