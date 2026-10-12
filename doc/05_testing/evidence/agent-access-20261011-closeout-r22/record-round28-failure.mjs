/** 只读复算第28B失败原件；仅新增脱敏检查点，不补审查意见或审批。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadCtx, runRoot } from '../../../../dist/test/src/trivium/config.js';
import { repoId } from '../../../../dist/test/src/trivium/review.js';
import { getGate, listOpenGates } from '../../../../dist/test/src/trivium/state.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';

const repo = process.cwd(), root = path.dirname(new URL(import.meta.url).pathname);
const topic = 'Agent双模式接入真实准入收口', runId = '20261012T044824Z';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const runPath = repo + '/.reviews/' + topic + '/plan/_meta/run-' + runId + '.json';
const run = read(runPath), frozen = read(root + '/frozen-before-round28.json');
if (run.status !== 'failed' || run.finished_at !== '2026-10-12T05:33:37.687Z'
  || run.critics_selected.length !== 3 || run.critics_selected.some(id => run.critics[id].status !== 'timeout'))
  throw Error('第28B终态不符，不记录假失败');
const ctx = await loadCtx({ cwd: repo }), gate = await getGate(ctx.triviumDir, topic, 'plan');
if ((await listOpenGates(ctx.triviumDir)).length || gate.state !== 'idle' || gate.run_id !== runId)
  throw Error('仍有开放闸门，禁止新增业务证据');
const changes = [];
for (const [p, h] of Object.entries(frozen.hashes)) {
  try { if (hash(p) !== h) changes.push(p); } catch (e) { changes.push({ path: p, error: e.code }); }
}
if (changes.length) throw Error('冻结文件变化，停止，不追认本轮');
const artifacts = run.artifacts.map(a => ({ ...a, hash_equal: hash(repo + '/.reviews/' + a.path) === a.sha256 }));
if (artifacts.some(a => !a.hash_equal)) throw Error('正式失败原件hash不符');
const task = await readTask({ archiveRoot: repo + '/.reviews', topic });
const recorded = await listRecordedRuns({ archiveRoot: repo + '/.reviews', topic });
if (task.runs.length !== 28 || recorded.length !== 28 || recorded.some(r => r.unreadable)
  || JSON.stringify(task.runs.map(r => r.run_id).sort()) !== JSON.stringify(recorded.map(r => r.run_id).sort())
  || task.approvals.some(a => a.run_id === runId)) throw Error('正式运行或审批集合不符');
const budgetRoot = process.env.HOME + '/.trivium/evidence/agent-access-20261011-closeout-r3/budget';
const { openBudget } = createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budgets = {};
for (const pool of ['admission', 'review']) {
  const b = openBudget(budgetRoot, pool), names = fs.readdirSync(b.dir);
  budgets[pool] = { used: names.filter(n => /^reserved-\d+\.json$/.test(n)).length,
    completed: names.filter(n => /^launch-\d+\.json$/.test(n)).length, limit: b.limit() };
}
if (JSON.stringify(budgets) !== JSON.stringify({ admission: { used: 734, completed: 734, limit: 742 },
  review: { used: 373, completed: 373, limit: 398 } })) throw Error('启动基线变化');
const runtime = path.join(runRoot(ctx.config), repoId(ctx.projectRoot), runId);
const claudeFile = runtime + '/claude/out/stdout.jsonl', geminiFile = runtime + '/gemini/out/stdout.jsonl';
const rows = p => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const claude = rows(claudeFile), gemini = rows(geminiFile), trace = read(runtime + '/claude/out/trace.json');
const result = gemini.findLast(r => r.event === 'result')?.result;
const observations = {
  claude: { raw_ref: { path: claudeFile, sha256: hash(claudeFile) }, init_model: trace.init?.model ?? null,
    actual_tool_uses: trace.toolUses.length,
    api_retries: claude.filter(r => r.type === 'system' && r.subtype === 'api_retry')
      .map(r => ({ attempt: r.attempt, error_status: r.error_status, error: r.error })),
    complete_structured_review: false },
  gemini: { raw_ref: { path: geminiFile, sha256: hash(geminiFile) },
    init_model: gemini.find(r => r.event === 'init')?.init?.model ?? null,
    completed_tools: gemini.filter(r => r.event === 'step_update' && r.step_update?.state === 'DONE'
      && r.step_update?.step_type === 'tool').length,
    terminal_cli_status: result?.status ?? null, terminal_error: result?.error ?? null,
    complete_structured_review: false },
  glm: { raw_ref: { path: runtime + '/glm/out/stdout.json', sha256: hash(runtime + '/glm/out/stdout.json') },
    output_bytes: fs.statSync(runtime + '/glm/out/stdout.json').size, init_model: null,
    root_cause: null, complete_structured_review: false }
};
const checkpoint = { at: new Date().toISOString(), script_sha256: hash(new URL(import.meta.url)),
  run_ref: { path: runPath, sha256: hash(runPath) }, run_status: run.status, started_at: run.started_at,
  finished_at: run.finished_at, artifacts, snapshot: run.snapshot, guard: run.guard,
  frozen_files_verified: Object.keys(frozen.hashes).length, frozen_changes: changes,
  gate, formal: { used: 28, limit: 29, this_round_valid: false }, budgets,
  current_build: await computeBuildStamp(repo), current_local_sha256: hash(repo + '/.trivium/config.local.yaml'),
  observations, terminal_wait_exit: 75, gate_check_exit: 2, gate_failure: 'missing_disposition',
  valid_review_findings: 0, approval_recorded: false, implementation_authorized: false,
  auto_retry_performed: false, new_admission_starts: 0, auth_criterion_decision: 'rejected',
  restricted_criterion_adopted: false, current_canonical: { pass: 0, untested: 12 },
  historical_canonical: { pass: 7, untested: 5, original_false_preserved: true },
  formal_failure_preserved: true, previous_stopped_batch_preserved: true, prerequisite_complete: false,
  interpretation: 'timeout元数据project_reads=0不等于原始轨迹未读文件；原始init与失败元数据回读分列。部分工具轨迹不构成有效审查或准入。三侧共同根因未知，不将EOF/API未知或空输出推定为同一故障。' };
saveEvidence(root + '/round28-failed-checkpoint.json', checkpoint);
console.log(JSON.stringify({ run: runId, status: 'failed', frozen: checkpoint.frozen_files_verified,
  changes: changes.length, artifacts: artifacts.length, budgets, approval: false, implementation: false }));
