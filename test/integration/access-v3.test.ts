/** 新 writer → 后台 worker → gate/report/Hook；真实子进程、桩指纹、零配额。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeFixture, cli, today, BUNDLE, ASSET_ROOT } from '../helpers/fixture.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { run } from '../../src/trivium/util/exec.js';
import { RUN_DIR_FILES } from '../../src/trivium/run-files.js';

const parse = (s: string) => JSON.parse(extractJsonCandidate(s)!.json);
test('接入显式null和Driver声明跨进程保留，v3 三态不造成门禁', async () => {
  const fx = await makeFixture({ topic: 'v3接入交接' });
  const session = 'S-v3闭环';
  const stub = { codex: { mode: 'ok' as const, modelEffective: 'qwen3.8-max' }, glm: { mode: 'ok' as const, modelEffective: 'GLM-5.3' } };
  const start = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x',
    '--critics', 'codex,glm', '--native-codex', '--driver-model', 'qwen3.8-flash', '--driver-provider', 'qwen',
    '--entry', 'B', '--session-id', session, '--json'], stub);
  assert.equal(start.code, 0, start.stdout + start.stderr);
  const id = parse(start.stdout).run_id;
  const handoff = JSON.parse(await fs.readFile(path.join(parse(start.stdout).run_dir, RUN_DIR_FILES.request), 'utf8'));
  assert.equal(handoff.options.driverModel, 'qwen3.8-flash');
  assert.equal(handoff.options.driverProvider, 'qwen');
  const wait = await cli(fx.root, ['review', '--wait', id, '--timeout', '20', '--json'], stub, 60_000);
  assert.equal(wait.code, 0, wait.stdout + wait.stderr);
  const meta = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${id}.json`), 'utf8'));
  assert.equal(meta.schema, 'trivium.run.v3');
  assert.deepEqual(meta.driver_declaration, { model: 'qwen3.8-flash', provider: 'qwen', source: 'declared' });
  assert.equal(meta.critics.codex.cli_version, 'stub/0.0.0');
  assert.equal(meta.critics.codex.profile_requested, null);
  assert.equal(meta.critics.codex.access.requested_mode, 'native');
  assert.equal(meta.requested_routes.codex.access.requested_mode, 'native');
  assert.equal(meta.requested_routes.codex.access.profile, null);
  assert.equal(meta.critics.codex.heterogeneous, 'same-family');
  assert.equal(meta.family_comparisons.length, 3);
  const report = await cli(fx.root, ['report', '--topic', fx.topic], stub);
  assert.equal(report.code, 0, report.stderr);
  assert.match(report.stdout, /same-family|qwen3.8-flash/);
  assert.ok(report.stdout.indexOf('Driver 会话声明') > report.stdout.indexOf('## 四、生效模型'));
  const runFile = path.join(fx.stageDir, '_meta', `run-${id}.json`);
  const before = await fs.readFile(runFile, 'utf8');
  const hook = () => run(process.execPath, [BUNDLE, 'gate', 'hook-pre-commit'], {
    cwd: fx.root, env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, CLAUDE_SESSION_ID: session, TRIVIUM_STUB_CRITIC: undefined },
    stdin: JSON.stringify({ session_id: session, tool_name: 'Bash', tool_input: { command: 'git commit -m fixture' } }), timeoutMs: 30_000,
  });
  assert.equal((await hook()).code, 2);
  await fs.writeFile(path.join(fx.stageDir, `${today()}-${fx.topic}-revised-claude.md`), [
    '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, 'stage: plan', 'role: claude', 'kind: revised', `run_id: ${id}`,
    'addresses:', `  - ${today()}-${fx.topic}-codex.md`, `  - ${today()}-${fx.topic}-glm.md`, '---', '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |', '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| CODEX-01 | codex | blocker | 接受 | 已在夹具补齐 | §1 |', '| GLM-01 | glm | blocker | 接受 | 已在夹具补齐 | §1 |', '',
  ].join('\n'));
  await fs.writeFile(path.join(fx.stageDir, `${today()}-${fx.topic}-r2-claude.md`), '# 定稿\nCODEX-01、GLM-01 已在 §1 补齐\n');
  for (const args of [
    ['gate', '--check'], ['gate', '--await-approval'], ['approve'], ['gate', '--check-artifacts'],
  ]) {
    const checked = await cli(fx.root, [...args, '--topic', fx.topic, '--stage', 'plan', '--session-id', session]);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.equal(await fs.readFile(runFile, 'utf8'), before, '闸门及夹具审批不得重写 v3 审计事实');
  }
  assert.equal((await hook()).code, 0);
  const conflict = await cli(fx.root, ['preflight', '--critics', 'codex', '--native-codex', '--profile-codex', 'qwen', '--skip-auth-check'], stub);
  assert.equal(conflict.code, 64);
  for (const value of ['false', 'qwen']) {
    const bare = await cli(fx.root, ['preflight','--critics','codex','--native-codex',value,'--skip-auth-check'], stub);
    assert.equal(bare.code,64,bare.stdout+bare.stderr);
  }
  const invalid = await cli(fx.root,['topic','resolve','--stage','code','--json','--','正文','--native-codex=qwen'],stub);
  assert.equal(invalid.code,64,invalid.stdout+invalid.stderr);
  const disabled = await cli(fx.root,['topic','resolve','--stage','plan','--json','--',fx.topic,'--critics','codex,glm','--native-codex=false','--profile-codex','qwen'],stub);
  assert.equal(disabled.code,0,disabled.stdout+disabled.stderr);
  assert.equal(parse(disabled.stdout).vendor_profiles.codex,'qwen');
});

test('提前取消仍归档请求路线，已保存请求不随取消清扫丢失', async () => {
  const fx = await makeFixture({ topic: 'v3取消留痕' });
  const stub = { codex: { mode: 'hang' as const }, glm: { mode: 'hang' as const } };
  const started = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', fx.topic, '--focus', 'x',
    '--critics', 'codex,glm', '--native-codex', '--driver-model', 'gpt-6.1-sol', '--entry', 'B', '--json'], stub);
  assert.equal(started.code, 0, started.stdout + started.stderr);
  const id = parse(started.stdout).run_id;
  const file = path.join(fx.stageDir, '_meta', `run-${id}.json`);
  const before = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(before.requested_routes.codex.access.requested_mode, 'native');
  const cancelled = await cli(fx.root, ['review', '--cancel', id, '--json'], stub, 30_000);
  assert.equal(cancelled.code, 0, cancelled.stdout + cancelled.stderr);
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(after.status, 'cancelled');
  assert.equal(after.review_mode, 'partial');
  assert.ok(after.degraded_reason);
  assert.deepEqual(after.requested_routes, before.requested_routes);
  const report = await cli(fx.root, ['report', '--topic', fx.topic, '--json'], stub);
  assert.equal(report.code, 0, report.stdout + report.stderr);
  assert.match(report.stdout, /requestedRoutes/);
  const handoffFile = path.join(parse(started.stdout).run_dir, RUN_DIR_FILES.request);
  const handoff = JSON.parse(await fs.readFile(handoffFile, 'utf8'));
  handoff.requests.codex.profile_requested = 'qwen';
  handoff.requests.codex.access.profile = 'qwen';
  await fs.writeFile(handoffFile, JSON.stringify(handoff));
  const worker = await cli(fx.root, ['review', '--worker', id], { codex: { mode: 'ok' }, glm: { mode: 'ok' } }, 30_000);
  assert.equal(worker.code, 69, worker.stdout + worker.stderr);
  const status = JSON.parse(await fs.readFile(path.join(parse(started.stdout).run_dir, RUN_DIR_FILES.status), 'utf8'));
  assert.match(status.message, /执行交接与运行记录请求路线不一致/);
});
