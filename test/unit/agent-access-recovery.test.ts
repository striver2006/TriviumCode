/** 追加轮数与配方约束只用静态夹具；绝不启动审核者CLI。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { scratchDir } from '../helpers/scratch.js';

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

test('五个Claude生产写缺口均在spawn与计数之前拒绝；合法读取与Qwen flash写保留', async () => {
  const { assertProductionArm, productionReadPrompt } = await import(pathToFileURL(path.resolve('scripts/agent-access-recipes.mjs')).href);
  let spawnCount = 0, budgetUsed = 0;
  const launch = (combination: string) => { assertProductionArm('claude', combination, 'write'); budgetUsed++; spawnCount++; };
  for (const combo of ['qwen-pro', 'kimi', 'kimi-pro', 'deepseek', 'deepseek-pro']) assert.throws(() => launch(combo));
  assert.equal(spawnCount, 0); assert.equal(budgetUsed, 0);
  assert.doesNotThrow(() => assertProductionArm('claude', 'qwen', 'write'));
  for (const combo of ['qwen-pro', 'kimi', 'kimi-pro', 'deepseek', 'deepseek-pro'])
    assert.doesNotThrow(() => assertProductionArm('claude', combo, 'read'));
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

test('历史v5固定夹具与v2纯核验保留11B/12C边界，不随实时指针升级', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRound, assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const old = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization.json'), 'utf8'));
  const current = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v5.json'), 'utf8'));
  const runs = old.historical_run_ids.concat('20261010T175354Z').map((run_id: string) => ({ run_id }));
  const args = ['review', '--start', '--topic', old.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm', '--entry', 'C', '--stage', 'code'];
  assert.throws(() => assertFormalRound(old, { runs }, runs, args), /授权已被替代/);
  const tenth = current.historical_run_ids.map((run_id: string) => ({ run_id }));
  assert.equal(current.new_limit, 12);
  assert.equal(tenth.length, 10);
  const planArgs = args.map(a => a === 'C' ? 'B' : a === 'code' ? 'plan' : a);
  assert.equal(assertFormalRoundCore(current, { runs: tenth }, tenth, planArgs, current), 11);
  assert.throws(() => assertFormalRoundCore(current, { runs: tenth }, tenth, planArgs), /权威缺失/);
  assert.throws(() => assertFormalRoundCore(current, { runs: tenth }, tenth, planArgs, null), /权威缺失/);
  assert.throws(() => assertFormalRoundCore(current, { runs: tenth }, tenth, planArgs, {}), /形状无效/);
  const prior = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v4.json'), 'utf8'));
  assert.throws(() => assertFormalRoundCore(prior, { runs: tenth }, tenth, planArgs, current), /授权已被替代/);
  const eleventh = [...tenth, { run_id: 'current-eleventh-fixture' }];
  assert.equal(assertFormalRoundCore(current, { runs: eleventh }, eleventh, args, current), 12);
  assert.throws(() => assertFormalRoundCore(current, { runs: eleventh }, eleventh, planArgs, current));
  const twelfth = [...eleventh, { run_id: 'current-twelfth-fixture' }];
  assert.throws(() => assertFormalRoundCore(current, { runs: twelfth }, twelfth, args, current));
  const bytes = Buffer.from(JSON.stringify(current));
  const pointer = { authorization: 'formal-round-authorization-v5.json', topic: current.topic,
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

test('历史v6生产v2守卫固定覆盖13B/14C及参数、集合、权威负例', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const current = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v6.json'), 'utf8'));
  assert.equal(current.new_limit, 14);
  assert.equal(createHash('sha256').update(await fs.readFile(path.resolve(current.supersedes_file))).digest('hex'), current.supersedes_sha256);
  const runs = current.historical_run_ids.map((run_id: string) => ({ run_id }));
  assert.equal(runs.length, 12);
  const args = ['review', '--start', '--topic', current.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm', '--entry', 'B', '--stage', 'plan'];
  const task = { runs };
  assert.equal(assertFormalRoundCore(current, task, runs, args, current), 13);
  const next = [...runs, { run_id: 'thirteenth-fixture' }];
  const code = args.map(a => a === 'B' ? 'C' : a === 'plan' ? 'code' : a);
  assert.equal(assertFormalRoundCore(current, { runs: next }, next, code, current), 14);
  const final = [...next, { run_id: 'fourteenth-fixture' }];
  assert.throws(() => assertFormalRoundCore(current, { runs: final }, final, code, current));
  for (const flag of ['--topic', '--driver', '--critics', '--entry', '--stage']) {
    const at = args.indexOf(flag);
    const wrong = [...args]; wrong[at + 1] = 'wrong';
    assert.throws(() => assertFormalRoundCore(current, task, runs, wrong, current), flag);
    assert.throws(() => assertFormalRoundCore(current, task, runs, [...args, flag, args[at + 1]], current), flag);
    assert.throws(() => assertFormalRoundCore(current, task, runs, args.filter((_, i) => i !== at && i !== at + 1), current), flag);
  }
  assert.throws(() => assertFormalRoundCore(current, task, runs, [...args, '--allow-single'], current));
  for (const authority of [undefined, null, {}, []]) assert.throws(() => assertFormalRoundCore(current, task, runs, args, authority));
  const old = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v5.json'), 'utf8'));
  assert.throws(() => assertFormalRoundCore(old, task, runs, args, current));
  const mutations = [runs.slice(1), [...runs, { run_id: 'orphan' }], [...runs, runs[0]],
    runs.map((r: { run_id: string }, i: number) => i === 0 ? { ...r, unreadable: true } : r),
    runs.map((r: { run_id: string }, i: number) => i === 0 ? { run_id: 'replacement' } : r)];
  for (const changed of mutations) {
    assert.throws(() => assertFormalRoundCore(current, task, changed, args, current));
    assert.throws(() => assertFormalRoundCore(current, { runs: changed }, changed, args, current));
  }
  assert.throws(() => assertFormalRoundCore(current, { runs: [...runs, runs[0]] }, runs, args, current));
  const bytes = Buffer.from(JSON.stringify(current));
  const pointer = { authorization: 'formal-round-authorization-v6.json', topic: 'wrong-topic', sha256: createHash('sha256').update(bytes).digest('hex') };
  const reader = (file: URL) => file.pathname.endsWith('formal-round-authority.json') ? Buffer.from(JSON.stringify(pointer)) : bytes;
  assert.throws(() => readCurrentAuthorization(reader), /主题不符/);
});

test('历史v7固定夹具保留15C/16拒绝、授权谱系和参数集合负例', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRound, assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const current = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v7.json'), 'utf8'));
  assert.equal(current.new_limit, 15);
  assert.equal(createHash('sha256').update(await fs.readFile(path.resolve(current.supersedes_file))).digest('hex'), current.supersedes_sha256);
  const runs = current.historical_run_ids.map((run_id: string) => ({ run_id }));
  assert.equal(runs.length, 14);
  const args = ['review', '--start', '--topic', current.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm', '--entry', 'C', '--stage', 'code'];
  const task = { runs };
  assert.throws(() => assertFormalRound(current, task, runs, args), /授权已被替代/);
  assert.equal(assertFormalRoundCore(current, task, runs, args, current), 15);
  const final = [...runs, { run_id: 'fifteenth-fixture' }];
  assert.throws(() => assertFormalRoundCore(current, { runs: final }, final, args, current));
  assert.throws(() => assertFormalRoundCore(current, task, runs, args.map(a => a === 'C' ? 'B' : a === 'code' ? 'plan' : a), current));
  for (const flag of ['--topic', '--driver', '--critics', '--entry', '--stage']) {
    const at = args.indexOf(flag);
    const wrong = [...args]; wrong[at + 1] = 'wrong';
    assert.throws(() => assertFormalRoundCore(current, task, runs, wrong, current), flag);
    assert.throws(() => assertFormalRoundCore(current, task, runs, [...args, flag, args[at + 1]], current), flag);
    assert.throws(() => assertFormalRoundCore(current, task, runs, args.filter((_, i) => i !== at && i !== at + 1), current), flag);
  }
  assert.throws(() => assertFormalRoundCore(current, task, runs, [...args, '--allow-single'], current));
  for (const authority of [undefined, null, {}, []]) assert.throws(() => assertFormalRoundCore(current, task, runs, args, authority));
  const old = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v6.json'), 'utf8'));
  assert.throws(() => assertFormalRoundCore(old, task, runs, args, current));
  const mutations = [runs.slice(1), [...runs, { run_id: 'orphan' }], [...runs, runs[0]],
    runs.map((r: { run_id: string }, i: number) => i === 0 ? { ...r, unreadable: true } : r),
    runs.map((r: { run_id: string }, i: number) => i === 0 ? { run_id: 'replacement' } : r)];
  for (const changed of mutations) {
    assert.throws(() => assertFormalRoundCore(current, task, changed, args, current));
    assert.throws(() => assertFormalRoundCore(current, { runs: changed }, changed, args, current));
  }
  assert.throws(() => assertFormalRoundCore(current, { runs: [...runs, runs[0]] }, runs, args, current));
  const bytes = Buffer.from(JSON.stringify(current));
  const pointer = { authorization: 'formal-round-authorization-v7.json', topic: 'wrong-topic', sha256: createHash('sha256').update(bytes).digest('hex') };
  const reader = (file: URL) => file.pathname.endsWith('formal-round-authority.json') ? Buffer.from(JSON.stringify(pointer)) : bytes;
  assert.throws(() => readCurrentAuthorization(reader), /主题不符/);
});

test('历史v8固定数据对应委托首批16B/17C，不无限放行', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const auth = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v8.json'), 'utf8'));
  assert.equal(auth.delegation_exact_reply, '授权轮次可以按需增加，不必询问授权');
  assert.equal(auth.criteria_change_authorized, false);
  assert.equal(auth.new_limit, 17);
  assert.equal(auth.historical_run_ids.length, 15);
  assert.equal(createHash('sha256').update(await fs.readFile(path.resolve(auth.supersedes_file))).digest('hex'), auth.supersedes_sha256);
  const runs = auth.historical_run_ids.map((run_id: string) => ({ run_id }));
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', auth.topic, '--driver', auth.driver,
    '--critics', auth.critics.join(','), '--entry', entry, '--stage', stage];
  assert.equal(assertFormalRoundCore(auth, { runs }, runs, args('B', 'plan'), auth), 16);
  const next = [...runs, { run_id: 'sixteenth-fixture' }];
  assert.equal(assertFormalRoundCore(auth, { runs: next }, next, args('C', 'code'), auth), 17);
  assert.throws(() => assertFormalRoundCore(auth, { runs: next }, next, args('B', 'plan'), auth));
  const final = [...next, { run_id: 'seventeenth-fixture' }];
  assert.throws(() => assertFormalRoundCore(auth, { runs: final }, final, args('C', 'code'), auth));
});

test('当前hash权威读取壳与生产守卫消费逐轮枚举，批后/错误参数与集合拒绝', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRound, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const current = readCurrentAuthorization();
  assert.equal(createHash('sha256').update(await fs.readFile(path.resolve(current.supersedes_file))).digest('hex'), current.supersedes_sha256);
  const runs = current.historical_run_ids.map((run_id: string) => ({ run_id }));
  for (const round of current.new_rounds) {
    const args = ['review', '--start', '--topic', current.topic, '--driver', current.driver, '--critics', current.critics.join(','),
      '--entry', round.entry, '--stage', round.stage];
    assert.equal(assertFormalRound(current, { runs }, runs, args), round.ordinal);
    for (const flag of ['--topic', '--driver', '--critics', '--entry', '--stage']) {
      const at = args.indexOf(flag), wrong = [...args]; wrong[at + 1] = 'wrong';
      assert.throws(() => assertFormalRound(current, { runs }, runs, wrong));
      assert.throws(() => assertFormalRound(current, { runs }, runs, [...args, flag, args[at + 1]]));
    }
    assert.throws(() => assertFormalRound(current, { runs }, runs, [...args, '--allow-single']));
    for (const altered of [runs.slice(1), [...runs, { run_id: 'orphan' }], [...runs, runs[0]],
      runs.map((r: { run_id: string }, i: number) => i ? r : { ...r, unreadable: true })]) {
      assert.throws(() => assertFormalRound(current, { runs }, altered, args));
    }
    runs.push({ run_id: `current-batch-fixture-${round.ordinal}` });
    if (round === current.new_rounds.at(-1)) assert.throws(() => assertFormalRound(current, { runs }, runs, args));
  }
  const bytes = Buffer.from(JSON.stringify(current)), pointer = { authorization: 'formal-round-authorization-v8.json',
    topic: current.topic, sha256: createHash('sha256').update(bytes).digest('hex') };
  const reader = (file: URL) => file.pathname.endsWith('formal-round-authority.json') ? Buffer.from(JSON.stringify(pointer)) : bytes;
  assert.deepEqual(readCurrentAuthorization(reader), current);
  pointer.sha256 = '0'.repeat(64); assert.throws(() => readCurrentAuthorization(reader), /hash漂移/);
  pointer.authorization = '../unknown.json'; assert.throws(() => readCurrentAuthorization(reader), /载体无效/);
});

test('历史第24B合同锁定v13原件与保留指针，只授24B/25C而不授判据采用', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const bytes = await fs.readFile(path.join(root, 'formal-round-authorization-v13.json'));
  const authority = JSON.parse(bytes.toString('utf8'));
  const pointerBytes = await fs.readFile(path.join(root, 'formal-round-authority-v13-preserved.json'));
  const pointer = JSON.parse(pointerBytes.toString('utf8'));
  assert.equal(pointer.authorization, 'formal-round-authorization-v13.json');
  assert.equal(pointer.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(readCurrentAuthorization((file: URL) => file.pathname.endsWith('formal-round-authority.json') ? pointerBytes : bytes), authority);
  assert.equal(authority.criteria_change_authorized, false);
  assert.equal(authority.delegated_round_extensions, true);
  assert.equal(authority.delegation_exact_reply, '授权轮次可以按需增加，不必询问授权');
  assert.equal(authority.count_reset, false);
  assert.equal(authority.previous_limit, 23);
  assert.equal(authority.new_limit, 25);
  assert.equal(authority.historical_run_ids.length, 23);
  assert.deepEqual(authority.new_rounds, [
    { ordinal: 24, entry: 'B', stage: 'plan' },
    { ordinal: 25, entry: 'C', stage: 'code' },
  ]);
  const previous = await fs.readFile(path.resolve(authority.supersedes_file));
  assert.equal(authority.supersedes_sha256, createHash('sha256').update(previous).digest('hex'));
  const runs = authority.historical_run_ids.map((run_id: string) => ({ run_id }));
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', authority.topic,
    '--driver', authority.driver, '--critics', authority.critics.join(','), '--entry', entry, '--stage', stage];
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('B', 'plan'), readCurrentAuthorization()), /授权已被替代/);
  assert.equal(assertFormalRoundCore(authority, { runs }, runs, args('B', 'plan'), authority), 24);
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('C', 'code'), authority));
  runs.push({ run_id: 'fixed-v13-round24-fixture' });
  assert.equal(assertFormalRoundCore(authority, { runs }, runs, args('C', 'code'), authority), 25);
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('B', 'plan'), authority));
  runs.push({ run_id: 'fixed-v13-round25-fixture' });
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('C', 'code'), authority));
});

test('历史v14只授25B/26C，保留24实记和旧v13谱系，不随现行权威更新', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const bytes = await fs.readFile(path.join(root, 'formal-round-authorization-v14.json'));
  const authority = JSON.parse(bytes.toString('utf8'));
  const pointerBytes = await fs.readFile(path.join(root, 'formal-round-authority-v14-preserved.json'));
  const pointer = JSON.parse(pointerBytes.toString('utf8'));
  assert.equal(pointer.authorization, 'formal-round-authorization-v14.json');
  assert.equal(pointer.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(readCurrentAuthorization((file: URL) => file.pathname.endsWith('formal-round-authority.json') ? pointerBytes : bytes), authority);
  assert.equal(authority.criteria_change_authorized, false);
  assert.equal(authority.count_reset, false);
  assert.equal(authority.old_failed_status_unchanged, true);
  assert.equal(authority.delegation_exact_reply, '授权轮次可以按需增加，不必询问授权');
  assert.equal(authority.previous_limit, 25);
  assert.equal(authority.new_limit, 26);
  assert.equal(authority.historical_run_ids.length, 24);
  assert.deepEqual(authority.new_rounds, [{ ordinal: 25, entry: 'B', stage: 'plan' }, { ordinal: 26, entry: 'C', stage: 'code' }]);
  assert.equal(authority.supersedes_sha256, createHash('sha256').update(await fs.readFile(path.resolve(authority.supersedes_file))).digest('hex'));
  assert.deepEqual(authority.replaces_unstarted_round, { ordinal: 25, prior_entry: 'C', prior_stage: 'code', reason: '首次pilot实际auto/default不符，新增临时模式设置须先正式计划审查' });
  const runs = authority.historical_run_ids.map((run_id: string) => ({ run_id }));
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', authority.topic, '--driver', authority.driver, '--critics', authority.critics.join(','), '--entry', entry, '--stage', stage];
  assert.equal(assertFormalRoundCore(authority, { runs }, runs, args('B', 'plan'), authority), 25);
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('C', 'code'), authority));
  runs.push({ run_id: 'fixed-v14-round25-fixture' });
  assert.equal(assertFormalRoundCore(authority, { runs }, runs, args('C', 'code'), authority), 26);
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('B', 'plan'), authority));
  runs.push({ run_id: 'fixed-v14-round26-fixture' });
  assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args('C', 'code'), authority));
});

test('v9至v12新增固定历史原件测试，各自边界保留但现行权威拒绝旧声明', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore, readCurrentAuthorization } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const current = readCurrentAuthorization();
  const expected = [
    { version: 9, limit: 18, rounds: [{ ordinal: 18, entry: 'C', stage: 'code' }] },
    { version: 10, limit: 20, rounds: [{ ordinal: 19, entry: 'B', stage: 'plan' }, { ordinal: 20, entry: 'C', stage: 'code' }] },
    { version: 11, limit: 21, rounds: [{ ordinal: 21, entry: 'C', stage: 'code' }] },
    { version: 12, limit: 23, rounds: [{ ordinal: 22, entry: 'B', stage: 'plan' }, { ordinal: 23, entry: 'C', stage: 'code' }] },
  ];
  for (const fixture of expected) {
    const file = path.join(root, `formal-round-authorization-v${fixture.version}.json`);
    const before = await fs.readFile(file);
    const authority = JSON.parse(before.toString('utf8'));
    assert.equal(authority.new_limit, fixture.limit);
    assert.deepEqual(authority.new_rounds, fixture.rounds);
    assert.equal(authority.criteria_change_authorized, false);
    assert.equal(authority.supersedes_sha256, createHash('sha256').update(await fs.readFile(path.resolve(authority.supersedes_file))).digest('hex'));
    const runs = authority.historical_run_ids.map((run_id: string) => ({ run_id }));
    for (const round of fixture.rounds) {
      const args = ['review', '--start', '--topic', authority.topic, '--driver', authority.driver,
        '--critics', authority.critics.join(','), '--entry', round.entry, '--stage', round.stage];
      assert.equal(assertFormalRoundCore(authority, { runs }, runs, args, authority), round.ordinal);
      assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args, current), /授权已被替代/);
      const wrong = [...args]; wrong[wrong.indexOf('--stage') + 1] = 'wrong';
      assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, wrong, authority));
      runs.push({ run_id: `fixed-v${fixture.version}-round${round.ordinal}-fixture` });
      if (round === fixture.rounds.at(-1)) assert.throws(() => assertFormalRoundCore(authority, { runs }, runs, args, authority));
    }
    assert.deepEqual(await fs.readFile(file), before);
  }
});

test('历史总10权威固定v4夹具，9B/10C边界不随v5指针改变', async () => {
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const { assertFormalRoundCore } = await import(pathToFileURL(path.join(root, 'round-guard-v2.mjs')).href);
  const old = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v4.json'), 'utf8'));
  const eighth = old.historical_run_ids.map((run_id: string) => ({ run_id }));
  const args = (entry: string, stage: string) => ['review', '--start', '--topic', old.topic, '--driver', 'codex',
    '--critics', 'claude,gemini,glm', '--entry', entry, '--stage', stage];
  assert.equal(old.new_limit, 10);
  assert.equal(eighth.length, 8);
  assert.equal(assertFormalRoundCore(old, { runs: eighth }, eighth, args('B', 'plan'), old), 9);
  assert.throws(() => assertFormalRoundCore(old, { runs: eighth }, eighth, args('C', 'code'), old));
  const ninth = [...eighth, { run_id: 'historical-ninth' }];
  assert.equal(assertFormalRoundCore(old, { runs: ninth }, ninth, args('C', 'code'), old), 10);
  assert.throws(() => assertFormalRoundCore(old, { runs: ninth }, ninth, args('B', 'plan'), old));
  const tenth = [...ninth, { run_id: 'historical-tenth' }];
  assert.throws(() => assertFormalRoundCore(old, { runs: tenth }, tenth, args('C', 'code'), old));
});

test('quiet-v6只允许三种摘要入口，拒绝review/probe和缺必需旗标', async () => {
  const { assertQuietCommand } = await import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v6.mjs')).href);
  const allowed = [
    ['tv', 'topic', 'claim', '--topic', 'original', '--stage', 'plan', '--driver', 'codex'],
    ['tv', 'topic', 'resolve', '--stage', 'plan', '--json', '--', 'focus', '--topic', 'original'],
    ['tv', 'preflight', '--stage', 'plan', '--driver', 'codex', '--critics', 'claude,gemini,glm']
  ];
  for (const argv of allowed) assert.doesNotThrow(() => assertQuietCommand('v8', 'review', 'fixture', argv));
  let spawnCount = 0, budgetUsed = 0;
  const launch = (version: string, argv: string[]) => { assertQuietCommand(version, 'review', 'fixture', argv); budgetUsed++; spawnCount++; };
  for (const [version, argv] of [
    ['v7', allowed[0]], ['v8', ['probe', 'route']], ['v8', ['tv', 'review', '--start']],
    ['v8', ['tv', 'review', '--wait']], ['v8', ['tv', 'review', '--status']], ['v8', ['tv', 'review', '--cancel']],
    ['v8', ['tv', 'topic', 'claim', '--topic', 'original', '--stage', 'plan']],
    ['v8', ['tv', 'topic', 'resolve', '--stage', 'plan']],
    ['v8', ['tv', 'preflight', '--stage', 'plan', '--driver', 'codex']],
    ['v8', ['tv', 'unknown']]
  ] as [string, string[]][]) assert.throws(() => launch(version, argv));
  assert.equal(spawnCount, 0); assert.equal(budgetUsed, 0);
});

test('quiet-v6真实子进程拒绝review启动且不建立预算或调用证据', async () => {
  const home = await scratchDir('trivium-quiet-guard-');
  try {
    const script = path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v6.mjs');
    const result = spawnSync(process.execPath, [script, 'v8', 'review', 'blocked-fixture', 'tv', 'review', '--start'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /只允许topic claim/);
    await assert.rejects(fs.access(path.join(home, '.trivium')));
  } finally { await fs.rm(home, { recursive: true, force: true }); }
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
  const { assertFormalRoundCore } = await import(pathToFileURL(path.join(root, 'round-guard.mjs')).href);
  // 历史总8边界固定消费当时不可变授权，不随当前权威升级而改写历史断言。
  const current = JSON.parse(await fs.readFile(path.join(root, 'formal-round-authorization-v3.json'), 'utf8'));
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
