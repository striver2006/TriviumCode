/** 23C送审前零CLI静态审计；检查/安装/授权/原件/全局/旧台账均实际核对。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { measureCodeStart, assertCodeStartMeasurement } from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readCurrentAuthorization, assertFormalRound } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
const repo = process.cwd(), root = path.dirname(new URL(import.meta.url).pathname), topic = 'Agent双模式接入真实准入收口';
const read = p => JSON.parse(fs.readFileSync(p)), hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const demand = (v, m) => { if (!v) throw Error(m); };
const first = read(root + '/check1-r27-denial.json'), second = read(root + '/check2-r27-denial.json');
const stamp = await computeBuildStamp(repo);
demand(first.code === 0 && second.code === 0 && first.pass === 3207 && first.skipped === 3 && first.fail === 0 &&
  second.stdout.includes('ℹ pass 3207') && second.stdout.includes('ℹ fail 0') && second.stdout.includes('ℹ skipped 3') &&
  first.inputs_after.inputs_sha256 === stamp.inputs_sha256 && second.inputs_before.inputs_sha256 === stamp.inputs_sha256 &&
  second.inputs_after.inputs_sha256 === stamp.inputs_sha256 && Date.parse(first.log_mtime) < Date.parse(second.started_at), '两遍串行检查/作用面不符');
for (const label of ['source-selftest-r27', 'installed-selftest-r27']) {
  const r = read(root + '/' + label + '.json');
  demand(r.code === 0 && r.stdout.includes('通过（14/14 步）') && r.inputs_after.inputs_sha256 === stamp.inputs_sha256 &&
    r.source_bundle_before === r.source_bundle_after && r.source_bundle_after === hash(repo + '/skills/dual-critic/scripts/trivium.cjs'), '桩或精确bundle不符');
}
const install = read(root + '/install-before23.json');
demand(install.entries.length === 28 && install.targets.length === 4 && install.source_sha256 === hash(repo + '/skills/dual-critic/scripts/trivium.cjs') &&
  install.runtime_sha256 === hash(install.runtime_root + '/scripts/trivium.cjs') && install.source_sha256 === install.runtime_sha256, '正常四目标安装不符');
function inventory(base, exclude = []) {
  const result = [];
  function walk(dir, rel = '') { for (const name of fs.readdirSync(dir).sort()) {
    if (!rel && exclude.includes(name)) continue;
    const p = path.join(dir, name), r = path.join(rel, name), s = fs.lstatSync(p);
    result.push({ path: r, mode: s.mode & 0o7777, type: s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : 'file',
      sha256: s.isFile() ? hash(p) : null, link: s.isSymbolicLink() ? fs.readlinkSync(p) : null });
    if (s.isDirectory()) walk(p, r);
  } } walk(base); return result;
}
demand(JSON.stringify(inventory(repo + '/skills/dual-critic', ['entry'])) === JSON.stringify(inventory(install.runtime_root)), '运行时资产变化');
for (const entry of install.entries) demand(JSON.stringify(inventory(entry.target)) === JSON.stringify(entry.inventory), '入口变化');
for (const name of install.backup_names_verified) {
  let present = true; try { fs.lstatSync(path.join(os.homedir(), '.agents/skills', name)); } catch (e) { if (e.code === 'ENOENT') present = false; else throw e; }
  demand(!present, '共享入口复现');
  demand(JSON.stringify(inventory(install.backup + '/copied/' + name)) === JSON.stringify(inventory(install.backup + '/moved/' + name)), '迁移备份变化');
}
const prior = path.resolve(root, '../agent-access-20261011-closeout-r13');
const historicalBatch = read(prior + '/admission-after21/mature-batch.json');
for (const [p, h] of Object.entries(historicalBatch.configs.globals)) demand(hash(path.join(os.homedir(), p)) === h, '全局配置变化');
demand(hash(repo + '/.trivium/config.yaml') === historicalBatch.configs.shared, '共享配置变化');
const configs = { shared: hash(repo + '/.trivium/config.yaml'), local: hash(repo + '/.trivium/config.local.yaml'), globals: historicalBatch.configs.globals };
const continuity = read(path.resolve(root, '../agent-access-20261011-closeout-r3/budget-continuity-r12.json'));
for (const item of continuity.files) for (const base of [continuity.source, continuity.destination]) demand(hash(base + '/' + item.path) === item.sha256, '历史台账变化');
const frozen = read(prior + '/frozen-before-round22.json');
for (const [p, h] of Object.entries(frozen.hashes)) demand(hash(prior + '/' + p) === h, 'r13旧静态冻结变化');
const run22 = read(repo + '/.reviews/' + topic + '/plan/_meta/run-20261011T142848Z.json');
for (const a of run22.artifacts) demand(hash(repo + '/.reviews/' + a.path) === a.sha256, '22B原审查工件变化');
const origin = read(root + '/plan22-disposition-origin.json');
for (const a of [origin.final, origin.disposition]) demand(hash(a.absPath) === a.sha256, '22B定稿/裁决变化');
const layout = { archiveRoot: repo + '/.reviews', topic }, task = await readTask(layout), runs = await listRecordedRuns(layout), auth = readCurrentAuthorization();
const args = ['review', '--start', '--entry', 'C', '--stage', 'code', '--topic', topic, '--driver', 'codex', '--critics', 'claude,gemini,glm'];
demand(task.runs.length === 22 && runs.length === 22 && runs.every(r => !r.unreadable) && assertFormalRound(auth, task, runs, args) === 23 &&
  auth.new_limit === 23 && auth.criteria_change_authorized === false && hash(auth.supersedes_file) === auth.supersedes_sha256, '有界23C资格/授权谱系不符');
const approval = task.approvals.find(a => a.run_id === '20261011T142848Z' && a.stage === 'plan' && a.decision === 'approved');
demand(approval && approval.reason.includes(origin.final.sha256), '本轮敏感范围批准不符');
demand(read(repo + '/.reviews/' + topic + '/code/_meta/run-20261010T170416Z.json').status === 'failed', '旧失败状态变化');
const { openBudget } = createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs'), budgetRoot = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3/budget'), budgets = {};
for (const pool of ['admission', 'review']) {
  const b = openBudget(budgetRoot, pool), names = fs.readdirSync(b.dir), reserved = names.filter(n => /^reserved-\d+\.json$/.test(n)), done = names.filter(n => /^launch-\d+\.json$/.test(n));
  demand(reserved.length === done.length && reserved.every(n => names.includes(n.replace('reserved-', 'launch-'))), '仍有在途厂商CLI');
  budgets[pool] = { used: reserved.length, completed: done.length, limit: b.limit() };
}
demand(budgets.admission.used === 673 && budgets.admission.limit === 689 && budgets.review.used >= 283 && budgets.review.used <= 293 && budgets.review.limit === 303, '事前预算越界');
const measurement = await measureCodeStart(repo, topic, args); assertCodeStartMeasurement(measurement);
let files = 0, bytes = 0;
function scan(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  const p = dir + '/' + e.name; if (e.isDirectory()) scan(p); else { const b = fs.readFileSync(p); demand(scanSecrets(b.toString()).length === 0, '证据扫描非零'); files++; bytes += b.length; }
} } scan(root);
saveEvidence(root + '/static-audit-before23-' + budgets.review.used + '.json', { at: new Date().toISOString(), source_stamp: stamp,
  bundle_sha256: install.source_sha256, checks: { serial: true, each: { pass: 3207, skipped: 3, fail: 0 }, inputs: stamp.inputs_sha256 },
  selftests: { source: '14/14', installed: '14/14', exact_bundle: true }, installation: { entries: 28, targets: install.targets,
    full_runtime_assets_equal: true, shared_absent: true, backup_names: install.backup_names_verified, client_name_resolution: null },
  formal: { used: 22, limit: 23, next: 23, entry: 'C', base: '39ed20530d64a72f81f183095c6d9516632d0228', history_ids: runs.map(r => r.run_id) },
  budgets, configs, plan: origin.final, disposition: origin.disposition, approval, original_review_artifacts_unchanged: run22.artifacts.length,
  original_22_frozen_static_unchanged: Object.keys(frozen.hashes).length, historical_budget_files_unchanged: continuity.files.length,
  measurement, scan: { files, bytes, secret_candidates: 0 }, current_full_matrix: { passed: 0, untested: 12 },
  original_claude_read_failure_retained: true, criteria_replacement_adopted: false, goal_complete: false, vendor_cli_starts: 0 });
console.log(JSON.stringify({ inputs: stamp.inputs_sha256, bundle: install.source_sha256, budgets, settings_bytes: measurement.settings_bytes,
  scan_files: files, secret_candidates: 0, formal: '22/23', new_vendor_starts: 0 }));
