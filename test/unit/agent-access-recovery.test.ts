/** 追加轮数与配方约束只用静态夹具；绝不启动审核者CLI。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

test('已启动轮数4/5允许第五plan/第六code，6/7及原件不一致均拒绝', async () => {
  const { assertFormalRoundCore: assertFormalRound } = await import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs')).href);
  const auth = { topic: 'original', driver: 'codex', critics: ['claude', 'gemini', 'glm'], new_limit: 6,
    historical_run_ids: ['1', '2', '3', '4'], new_rounds: [{ ordinal: 5, entry: 'B', stage: 'plan' }, { ordinal: 6, entry: 'C', stage: 'code' }] };
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', 'original', '--driver', 'codex',
    '--critics', 'claude,gemini,glm', '--entry', entry, '--stage', stage];
  const runs = (n: number) => Array.from({ length: n }, (_, i) => ({ run_id: String(i + 1), status: i % 2 ? 'failed' : 'running' }));
  assert.equal(assertFormalRound(auth, { runs: runs(4) }, runs(4), args('B', 'plan')), 5);
  assert.equal(assertFormalRound(auth, { runs: runs(5) }, runs(5), args('C', 'code')), 6);
  for (const n of [6, 7]) assert.throws(() => assertFormalRound(auth, { runs: runs(n) }, runs(n), args('C', 'code')));
  for (const altered of [args('C', 'plan'), args('B', 'code'), [...args('B', 'plan'), '--allow-single'],
    [...args('B', 'plan'), '--topic', 'replacement'], args('B', 'plan').map(x => x === 'codex' ? 'claude' : x)]) {
    assert.throws(() => assertFormalRound(auth, { runs: runs(4) }, runs(4), altered));
  }
  assert.throws(() => assertFormalRound(auth, null, runs(4), args('B', 'plan')));
  assert.throws(() => assertFormalRound(auth, { runs: runs(4) }, runs(5), args('B', 'plan')));
  assert.throws(() => assertFormalRound(auth, { runs: runs(4) }, [...runs(3), { run_id: '4', unreadable: true }], args('B', 'plan')));
});

test('四个Claude生产写缺口均在spawn与计数之前拒绝；Codex读取配方只有单一命令', async () => {
  const { assertProductionArm, productionReadPrompt } = await import(pathToFileURL(path.resolve('scripts/agent-access-recipes.mjs')).href);
  let spawnCount = 0, budgetUsed = 0;
  const launch = (combination: string) => { assertProductionArm('claude', combination, 'write'); budgetUsed++; spawnCount++; };
  for (const combo of ['qwen-pro', 'kimi', 'kimi-pro', 'deepseek']) assert.throws(() => launch(combo));
  assert.equal(spawnCount, 0); assert.equal(budgetUsed, 0);
  assert.doesNotThrow(() => assertProductionArm('claude', 'qwen', 'write'));
  assert.doesNotThrow(() => assertProductionArm('claude', 'kimi', 'read'));
  assert.match(productionReadPrompt('codex', 'JSON'), /单一读取命令 cat README.md/);
});

test('独立总7轮授权仅允许第六补充plan及第七完整code，原6轮授权不变', async () => {
  const { assertFormalRoundCore: assertFormalRound } = await import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs')).href);
  const original = { topic: 'original', driver: 'codex', critics: ['claude', 'gemini', 'glm'], new_limit: 6,
    historical_run_ids: ['1', '2', '3', '4'], new_rounds: [{ ordinal: 5, entry: 'B', stage: 'plan' }, { ordinal: 6, entry: 'C', stage: 'code' }] };
  const before = JSON.stringify(original);
  const extension = { ...original, new_limit: 7, historical_run_ids: ['1', '2', '3', '4', '5'],
    new_rounds: [{ ordinal: 6, entry: 'B', stage: 'plan' }, { ordinal: 7, entry: 'C', stage: 'code' }] };
  const runs = (n: number) => Array.from({ length: n }, (_, i) => ({ run_id: String(i + 1) }));
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', 'original', '--driver', 'codex',
    '--critics', 'claude,gemini,glm', '--entry', entry, '--stage', stage];
  assert.equal(assertFormalRound(extension, { runs: runs(5) }, runs(5), args('B', 'plan')), 6);
  assert.equal(assertFormalRound(extension, { runs: runs(6) }, runs(6), args('C', 'code')), 7);
  for (const [n, entry, stage] of [[5, 'C', 'code'], [6, 'B', 'plan'], [7, 'C', 'code']] as const) {
    assert.throws(() => assertFormalRound(extension, { runs: runs(n) }, runs(n), args(entry, stage)));
  }
  assert.throws(() => assertFormalRound(original, { runs: runs(5) }, runs(5), args('B', 'plan')));
  assert.throws(() => assertFormalRound(original, { runs: runs(5) }, runs(5), args('C', 'code'), extension));
  assert.throws(() => assertFormalRound(extension, { runs: runs(6) }, runs(5), args('C', 'code')));
  assert.throws(() => assertFormalRound(extension, { runs: runs(5) }, runs(6), args('B', 'plan')));
  assert.throws(() => assertFormalRound(extension, { runs: [...runs(5), runs(5)[0]] }, runs(6), args('C', 'code')));
  assert.equal(JSON.stringify(original), before);
});

test('当前权威读取壳拒绝旧载体和授权hash漂移；原授权与历史guard保留', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRound, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard.mjs')).href);
  const old = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization.json'), 'utf8'));
  const current = readCurrentAuthorization();
  const runs = old.historical_run_ids.concat('20261010T175354Z').map((run_id: string) => ({ run_id }));
  const args = ['review', '--start', '--topic', old.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm', '--entry', 'C', '--stage', 'code'];
  assert.throws(() => assertFormalRound(old, { runs }, runs, args), /授权已被替代/);
  const sixth = [...runs, { run_id: '20261010T224543Z' }];
  assert.throws(() => assertFormalRound(current, { runs: sixth }, sixth, args));
  const planArgs = args.map(a => a === 'C' ? 'B' : a === 'code' ? 'plan' : a);
  assert.equal(assertFormalRound(current, { runs: sixth }, sixth, planArgs), 7);
  const seventh = [...sixth, { run_id: 'current-seventh-fixture' }];
  assert.equal(assertFormalRound(current, { runs: seventh }, seventh, args), 8);
  const bytes = Buffer.from(JSON.stringify(current));
  const pointer = { authorization: 'formal-round-authorization-v3.json', topic: current.topic,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  const reader = (file: URL) => file.pathname.endsWith('formal-round-authority.json') ? Buffer.from(JSON.stringify(pointer)) : bytes;
  assert.deepEqual(readCurrentAuthorization(reader), current);
  pointer.sha256 = '0'.repeat(64);
  assert.throws(() => readCurrentAuthorization(reader), /hash漂移/);
  pointer.authorization = '../unknown.json';
  assert.throws(() => readCurrentAuthorization(reader), /载体无效/);
  assert.equal(createHash('sha256').update(await fs.readFile(path.resolve(current.supersedes_file))).digest('hex'), current.supersedes_sha256);
  const oldGuard = await fs.readFile(path.join(root, 'round-guard-v1-preserved.mjs'));
  assert.equal(createHash('sha256').update(oldGuard).digest('hex'), 'd5e75c9df91c9bc9b94b8c3ab81dfaf223e68d8e562a6358092b6b9858e98991');
});

test('正式代码前软线与最终安装/事实核验：失败不spawn、不占正式轮数', async () => {
  const { assertCodeStartMeasurement } = await import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck.mjs')).href);
  const valid = { install_matches_source: true, inputs_match: true, settings_bytes: 131072, skipped_count: 0,
    file_shape_verified: true, directory_shape: 'ascii-root1-5-depth0-2-v2', directory_fact_consumed: true, deny_settings_applied: true };
  let starts = 0, formalRuns = 6;
  const start = (value: object) => { assertCodeStartMeasurement(value); starts++; formalRuns++; };
  for (const change of [{ settings_bytes: 131073 }, { settings_bytes: 2898308 }, { settings_bytes: -1 },
    { install_matches_source: false }, { inputs_match: false }, { skipped_count: 1 }, { file_shape_verified: false },
    { directory_shape: 'ascii-root1-4-depth0-2-v1' }, { directory_fact_consumed: false }, { deny_settings_applied: false }]) {
    assert.throws(() => start({ ...valid, ...change }));
  }
  assert.equal(starts, 0); assert.equal(formalRuns, 6);
  start(valid); assert.equal(starts, 1); assert.equal(formalRuns, 7);
});

test('独立总8轮授权仅允许第七敏感扫描plan、第八完整code，旧7轮不可复用', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard.mjs')).href);
  const current = readCurrentAuthorization();
  const old = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v2.json'), 'utf8'));
  const before = JSON.stringify(old);
  const runs = current.historical_run_ids.map((run_id: string) => ({ run_id }));
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', current.topic, '--driver', 'codex',
    '--critics', 'claude,gemini,glm', '--entry', entry, '--stage', stage];
  assert.equal(runs.length, 6);
  assert.equal(assertFormalRoundCore(current, { runs }, runs, args('B', 'plan'), current), 7);
  assert.throws(() => assertFormalRoundCore(current, { runs }, runs, args('C', 'code'), current));
  assert.throws(() => assertFormalRoundCore(old, { runs }, runs, args('C', 'code'), current), /授权已被替代/);
  const seven = [...runs, { run_id: 'seventh-fixture' }];
  assert.equal(assertFormalRoundCore(current, { runs: seven }, seven, args('C', 'code'), current), 8);
  assert.throws(() => assertFormalRoundCore(current, { runs: seven }, seven, args('B', 'plan'), current));
  const eight = [...seven, { run_id: 'eighth-fixture' }];
  assert.throws(() => assertFormalRoundCore(current, { runs: eight }, eight, args('C', 'code'), current));
  assert.equal(JSON.stringify(old), before);
});
