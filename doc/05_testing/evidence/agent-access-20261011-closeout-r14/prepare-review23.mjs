/** 按独立轮次/CLI委托发布有界23C批；旧轮数、判据、台账不重置。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readCurrentAuthorization, assertFormalRound } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
const root = path.dirname(new URL(import.meta.url).pathname), topic = 'Agent双模式接入真实准入收口', repo = process.cwd();
const layout = { archiveRoot: path.join(repo, '.reviews'), topic }, task = await readTask(layout), runs = await listRecordedRuns(layout);
const auth = readCurrentAuthorization();
const args = ['review', '--start', '--entry', 'C', '--stage', 'code', '--topic', topic, '--driver', 'codex', '--critics', 'claude,gemini,glm'];
if (assertFormalRound(auth, task, runs, args) !== 23 || task.runs.length !== 22 || auth.new_limit !== 23 ||
    auth.criteria_change_authorized !== false || !task.approvals.some(a => a.run_id === '20261011T142848Z' && a.stage === 'plan' && a.decision === 'approved')) throw Error('23C前置授权/计划审批不符');
const { openBudget } = createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budgetRoot = path.join(process.env.HOME, '.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const b = openBudget(budgetRoot, 'review'), names = fs.readdirSync(b.dir);
const used = names.filter(n => /^reserved-\d+\.json$/.test(n)).length, completed = names.filter(n => /^launch-\d+\.json$/.test(n)).length;
if (used !== 283 || completed !== used || b.limit() !== 288) throw Error('事前CLI基线不符');
const batch = { at: new Date().toISOString(), topic, driver: 'codex', stage: 'code', entry: 'C', ordinal: 23, formal_limit: 23,
  formal_used_before: 22, independent_round_delegation: '授权轮次可以按需增加，不必询问授权',
  before: { used, completed, pool_limit: b.limit() }, expected_starts: 15, hard_maximum_new_starts: 20,
  cumulative_pool_stop: 303, preflight: { cli_versions_and_wrapper_native: 7, possible_expired_auth: 3 },
  full_three_critic_first_attempt: 5, possible_retry_allowance_within_hard_limit: 5,
  critics: ['claude', 'gemini', 'glm'], requested_models_from_existing_config: true, code_base: '39ed20530d64a72f81f183095c6d9516632d0228',
  criteria_change_authorized: false, admission_new_starts: 0, no_count_reset: true, old_records_retained: true,
  authorization: '用户已明确自动增加CLI配额；事前发布20硬上限，本次仅288→303。到上限停止，不借用准入池。' };
saveEvidence(path.join(root, 'review-round23-code-batch.json'), batch);
const extension = b.extend('r27-code23-cli-batch-303', 15, batch.authorization);
saveEvidence(path.join(root, 'review-round23-budget-extension.json'), { at: new Date().toISOString(), extension, limit_after: b.limit(), new_vendor_starts: 0 });
console.log(JSON.stringify({ review_before: used, limit_after: b.limit(), expected: 15, hard: 20, formal: '22/23', admission_new_starts: 0 }));
