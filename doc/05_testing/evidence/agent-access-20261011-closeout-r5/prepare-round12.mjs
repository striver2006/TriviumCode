/** 第12次完整C/code审前零厂商CLI检查：授权、批准、最终安装/目录事实/软线及独立预算批。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { assertFormalRound, readCurrentAuthorization } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import { measureCodeStart, assertCodeStartMeasurement } from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';

const repo = process.cwd(), topic = 'Agent双模式接入真实准入收口';
const root = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r5');
const prior = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
const layout = { archiveRoot: path.join(repo, '.reviews'), topic };
const task = await readTask(layout), runs = await listRecordedRuns(layout), auth = readCurrentAuthorization();
if (task.runs.length !== 11 || runs.length !== 11 || auth.new_limit !== 12 ||
    JSON.stringify(task.runs.map(r => r.run_id).sort()) !== JSON.stringify(runs.map(r => r.run_id).sort())) throw Error('正式第12次运行记录或授权不符');
if (!task.approvals?.some(a => a.run_id === '20261011T031230Z' && a.stage === 'plan' && a.decision === 'approved'))
  throw Error('第11次计划审批不齐备');
const codeRun = JSON.parse(fs.readFileSync(path.join(repo, `.reviews/${topic}/code/_meta/run-20261011T024158Z.json`)));
if (codeRun.status !== 'success' || !task.approvals?.some(a => a.run_id === codeRun.run_id && a.stage === 'code' && a.decision === 'rejected'))
  throw Error('第10次代码拒绝历史状态不符');
const args = ['review', '--start', '--entry', 'C', '--stage', 'code', '--topic', topic, '--driver', 'codex',
  '--critics', 'claude,gemini,glm', '--base', '39ed20530d64a72f81f183095c6d9516632d0228'];
if (assertFormalRound(auth, task, runs, args) !== 12) throw Error('第12次C/code守卫拒绝');
const measurement = await measureCodeStart(repo, topic, args);
assertCodeStartMeasurement(measurement);
saveEvidence(path.join(root, 'round12-code-start-measurement.json'), { ...measurement,
  round_guard_v2_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(prior, 'round-guard-v2.mjs'))).digest('hex'),
  launcher_v8_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(prior, 'launch-v8.mjs'))).digest('hex'),
  formal_ordinal: 12, prior_plan_approved: true, old_code_rejected: true });
const require = createRequire(import.meta.url);
const { openBudget } = require('../../../../scripts/agent-access-budget.cjs');
const budgetRoot = path.join(process.env.HOME, '.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const budget = openBudget(budgetRoot, 'review');
const before = fs.readdirSync(budget.dir).filter(x => x.startsWith('reserved-')).length;
if (before !== 143 || budget.limit() !== 153) throw Error(`review盘账非预期${before}/${budget.limit()}`);
const extension = budget.extend('formal-round12-code-total12', 15, '用户已授权自动CLI扩容；第12次完整C/code预计15、硬上限20，review池153到168，不扩大formal12');
saveEvidence(path.join(root, 'review-round12-code-batch.json'), { pool: 'review', before, expected: 15, hard_limit: 20,
  batch_stop: before + 20, pool_limit: budget.limit(), extension, admission: { used: 547, limit: 563, new_starts: 0 },
  formal: { used: 11, limit: 12, this_round: 12, entry: 'C', stage: 'code' },
  routes: ['Claude现配置Qwen flash', 'Gemini现配置flash', 'GLM现配置coding'],
  counting: '版本、帮助、包装器/native、失败、超时、重试都算启动；达到本批或池上限先停并另发扩容记录。', created_at: new Date().toISOString() });
console.log(JSON.stringify({ formal: '11/12', review_before: before, review_limit: budget.limit(),
  installed: measurement.install_matches_source, inputs: measurement.inputs_match, settings_bytes: measurement.settings_bytes,
  skipped: measurement.skipped_count, compressed_tools: measurement.compressed_tools, vendor_cli_starts: 0 }));
