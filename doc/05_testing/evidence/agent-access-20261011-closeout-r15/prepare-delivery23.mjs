/** code批准后补充独立交付证据；历史冻结与判据不变，零厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
const repo = process.cwd(), root = path.dirname(new URL(import.meta.url).pathname);
const external = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const topic = 'Agent双模式接入真实准入收口', runId = '20261011T152631Z';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p));
const task = read(repo + '/.reviews/' + topic + '/task.json');
const approval = task.approvals.find(a => a.run_id === runId && a.stage === 'code' && a.decision === 'approved');
if (!approval || task.runs.length !== 23 || !approval.reason.includes('根据你的建议自动审批')) throw Error('本轮code审批不成立');
const prior = path.resolve(root, '../agent-access-20261011-closeout-r14');
const frozen = read(prior + '/frozen-before-round23.json');
for (const [p, h] of Object.entries(frozen.hashes)) if (hash(fs.readFileSync(prior + '/' + p)) !== h) throw Error('原静态冻结变化');
for (const [p, h] of Object.entries(frozen.business_hashes)) if (hash(fs.readFileSync(repo + '/' + p)) !== h) throw Error('获批作用面变化');
const run = read(repo + '/.reviews/' + topic + '/code/_meta/run-' + runId + '.json');
for (const a of run.artifacts) if (hash(fs.readFileSync(repo + '/.reviews/' + a.path)) !== a.sha256) throw Error('原审查工件变化');
const files = [];
function copy(source, relative) {
  const bytes = fs.readFileSync(source);
  if (scanSecrets(bytes.toString('utf8')).length) throw Error('补充证据脱敏扫描失败');
  const dest = path.join(root, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes, { flag: 'wx', mode: 0o600 });
  if (hash(fs.readFileSync(dest)) !== hash(bytes)) throw Error('证据逐字复制不符');
  files.push({ source, relative, bytes: bytes.length, sha256: hash(bytes) });
}
for (const name of ['driver-code23-disposition.mjs', 'code23-disposition-origin.json']) copy(external + '/' + name, 'code23/' + name);
for (const name of fs.readdirSync(external + '/calls').filter(n => n.startsWith('r27-code23-'))) copy(external + '/calls/' + name, 'code23/calls/' + name);
const manifest = read(prior + '/denial-fixtures/sources.json');
const historicalResults = [];
for (const item of manifest.manifest) {
  const source = path.join(path.dirname(item.source), 'result.json'), relative = 'historical-denial-results/' + item.label + '-result.json';
  const original = read(source);
  if (hash(fs.readFileSync(source)) !== item.original_result_sha256 || original.deny_pass !== item.original_deny_pass) throw Error('原历史值或hash变化');
  copy(source, relative);
  historicalResults.push({ label: item.label, relative, source, sha256: item.original_result_sha256, original_deny_pass: original.deny_pass, original_not_recomputed: true, post_review_copy_not_reviewed_in_23C: true });
}
const { openBudget } = createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budgets = {};
for (const pool of ['admission', 'review']) {
  const b = openBudget(external + '/budget', pool), names = fs.readdirSync(b.dir);
  const used = names.filter(n => /^reserved-\d+\.json$/.test(n)).length, completed = names.filter(n => /^launch-\d+\.json$/.test(n)).length;
  if (used !== completed || used !== (pool === 'admission' ? 673 : 298)) throw Error('预算有在途或新增未解释');
  budgets[pool] = { used, completed, limit: b.limit() };
  if (pool === 'review') for (const name of names.filter(n => /^(?:reserved|launch)-\d+\.json$/.test(n) && Number(n.match(/\d+/)[0]) >= 284)) copy(b.dir + '/' + name, 'code23/ledger/' + name);
}
const stamp = await computeBuildStamp(repo);
if (stamp.inputs_sha256 !== '7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f') throw Error('已测输入变化');
saveEvidence(root + '/code23-post-approval-checkpoint.json', { at: new Date().toISOString(), approval, run_id: runId, original_review_artifacts: run.artifacts, frozen: { static: 31, business: 552, all_equal_before_post_approval_status_update: true }, source_stamp: stamp,
  bundle_sha256: hash(fs.readFileSync(repo + '/skills/dual-critic/scripts/trivium.cjs')),
  local_config_sha256: hash(fs.readFileSync(repo + '/.trivium/config.local.yaml')), budgets, formal: { used: 23, limit: 23, next_refused: 24 },
  findings: { accepted: 0, deferred: 2, criteria_changed: false }, historical_results: historicalResults, copies: files,
  portable_variant4_source_addition_after_code_approval: true, old_frozen_records_untouched: true, new_vendor_starts: 0, prerequisite_complete: false });
console.log(JSON.stringify({ approval_at: approval.at ?? approval.approved_at ?? null, copies: files.length, budgets, source_inputs: stamp.inputs_sha256, new_vendor_starts: 0, prerequisite_complete: false }));
