/** 第11次正式计划审查前的零厂商CLI授权、预算与守卫核验。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { assertFormalRoundCore } from '../agent-access-20261011-closeout-r3/round-guard.mjs';

const repo = process.cwd();
const prior = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
const current = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r5');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const layout = { archiveRoot: path.join(repo, '.reviews'), topic: 'Agent双模式接入真实准入收口' };
const task = await readTask(layout);
const runs = await listRecordedRuns(layout);
if (task.runs.length !== 10 || runs.length !== 10 ||
    JSON.stringify(task.runs.map(r => r.run_id).sort()) !== JSON.stringify(runs.map(r => r.run_id).sort())) throw Error('历史10次记录不一致，停止');
const old = fs.readFileSync(path.join(prior, 'formal-round-authorization-v4.json'));
const pointer = fs.readFileSync(path.join(prior, 'formal-round-authority.json'));
if (JSON.parse(pointer).authorization !== 'formal-round-authorization-v4.json' || JSON.parse(pointer).sha256 !== hash(old)) throw Error('v4当前权威不符');
const auth = { ...JSON.parse(old), previous_limit: 10, new_limit: 12,
  historical_run_ids: task.runs.map(r => r.run_id),
  new_rounds: [{ ordinal: 11, entry: 'B', stage: 'plan' }, { ordinal: 12, entry: 'C', stage: 'code' }],
  authorization: '2026-10-11用户独立明确回复：授权总12轮，先计划审查再完整代码重审（建议）',
  authorized_scope: '第11次B/plan审第10次C/code三条接受的守卫整改及同行BRIEF证据边界；普通计划批准后实施，第12次C/code相对39ed2053完整重审。轮数授权及普通审批均不批准准入判据变化。',
  supersedes_file: 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v4.json',
  supersedes_sha256: hash(old), criteria_change_authorized: false, old_failed_status_unchanged: true, count_reset: false,
  recorded_at: new Date().toISOString() };
const bytes = JSON.stringify(auth, null, 2) + '\n';
const args = ['review', '--start', '--topic', layout.topic, '--driver', 'codex', '--critics', 'claude,gemini,glm', '--entry', 'B', '--stage', 'plan'];
const cases = [];
if (assertFormalRoundCore(auth, task, runs, args, auth) !== 11) throw Error('11B拒绝');
cases.push('当前10原件允许11B');
const futureTask = { ...task, runs: [...task.runs, { run_id: 'future11' }] };
const futureRuns = [...runs, { run_id: 'future11' }];
const codeArgs = args.map(v => v === 'B' ? 'C' : v === 'plan' ? 'code' : v);
if (assertFormalRoundCore(auth, futureTask, futureRuns, codeArgs, auth) !== 12) throw Error('12C拒绝');
cases.push('11记录只允许12C');
const reject = (name, a, t, r, argv, authority = auth) => {
  let denied = false;
  try { assertFormalRoundCore(a, t, r, argv, authority); } catch { denied = true; }
  if (!denied) throw Error(name);
  cases.push(name);
};
reject('旧v4不能启动', JSON.parse(old), task, runs, args);
reject('缺历史原件', auth, task, runs.slice(1), args);
reject('孤儿原件', auth, task, [...runs, { run_id: 'orphan' }], args);
reject('重复记录', auth, { ...task, runs: [...task.runs, task.runs[0]] }, [...runs, runs[0]], args);
reject('不可读原件', auth, task, runs.map((r, i) => i ? r : { ...r, unreadable: true }), args);
for (const [name, token, replacement] of [['错阶段', 'plan', 'code'], ['错Driver', 'codex', 'claude'], ['错审核集合', 'claude,gemini,glm', 'claude,gemini'], ['错主题', layout.topic, 'other']])
  reject(name, auth, task, runs, args.map(v => v === token ? replacement : v));
reject('重复旗标', auth, task, runs, [...args, '--entry', 'B']);
reject('第13次拒绝', auth, { ...futureTask, runs: [...futureTask.runs, { run_id: 'future12' }] }, [...futureRuns, { run_id: 'future12' }], args);
save(path.join(prior, 'formal-round-authority-v4-preserved.json'), pointer.toString());
save(path.join(prior, 'formal-round-authorization-v5.json'), bytes);
const nextPointer = { topic: layout.topic, authorization: 'formal-round-authorization-v5.json', sha256: hash(bytes),
  basis: '用户独立授权总12轮；保留旧v4权威与全部10次记录，既有原生无专用例外接口，任务级守卫先于正式启动。', recorded_at: new Date().toISOString() };
const temp = path.join(prior, `authority-${crypto.randomUUID()}.tmp`);
save(temp, nextPointer);
fs.renameSync(temp, path.join(prior, 'formal-round-authority.json'));
const launcher = fs.readFileSync(path.join(prior, 'launch-v6.mjs'), 'utf8');
if (launcher.split('formal-round-authorization-v4.json').length !== 2) throw Error('launcher替换点不唯一');
save(path.join(prior, 'launch-v7.mjs'), launcher.replace('formal-round-authorization-v4.json', 'formal-round-authorization-v5.json').replace('r14获批任务入口', '第11次计划审查任务入口'));
const require = createRequire(import.meta.url);
const { openBudget } = require('../../../../scripts/agent-access-budget.cjs');
const budgetRoot = path.join(process.env.HOME, '.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const budget = openBudget(budgetRoot, 'review');
const before = fs.readdirSync(budget.dir).filter(x => x.startsWith('reserved-')).length;
if (before !== 128 || budget.limit() !== 138) throw Error(`当前review池非预期：${before}/${budget.limit()}`);
const extension = budget.extend('formal-round11-plan-total12', 15, '用户自动CLI额度扩容授权；第11次B/plan预计15、硬上限20，总池138到153；独立于正式轮数12');
save(path.join(current, 'review-round11-plan-batch.json'), { pool: 'review', before, expected: 15, hard_limit: 20, batch_stop: before + 20, pool_limit: budget.limit(), extension,
  admission: { used: 547, limit: 563, new_starts: 0 }, formal: { used: 10, limit: 12, this_round: 11, entry: 'B', stage: 'plan' },
  routes: ['Claude现配置Qwen flash', 'Gemini现配置flash', 'GLM现配置coding'],
  counting: '版本、帮助、包装器/native、失败、超时、重试均算启动；达到批次或池上限即停，另发扩容记录。', created_at: new Date().toISOString() });
save(path.join(current, 'formal-round11-authorization-verification.json'), { authorization_sha256: hash(bytes), preserved_pointer_sha256: hash(pointer), historical_ids: auth.historical_run_ids,
  formal_count: 10, max: 12, cases, criteria_change_authorized: false, vendor_cli_starts: 0 });
console.log(JSON.stringify({ historical: auth.historical_run_ids, cases: cases.length, review_before: before, review_limit: budget.limit(), vendor_cli_starts: 0 }));
