/** 原始实录独立复核；只报告既有判据，不改变产品或准入接受逻辑。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import { saveEvidence, codexCommandEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { parseCodexEvents } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/adapters/codex-trace.js';
const root = path.dirname(new URL(import.meta.url).pathname), batch = JSON.parse(fs.readFileSync(root + '/codex-refresh-batch.json'));
const job = batch.jobs.find(j => j.name === process.argv[2]);
if (!job || job.args[0] !== 'codex') throw Error('只复核已公布模型能力臂');
const dir = batch.evidence_root + '/routes/' + job.route_directory, read = n => JSON.parse(fs.readFileSync(dir + '/' + n));
const r = read('result.json'), raw = read('raw.json'), after = read('fingerprints-after.json'), cleanup = read('cleanup.json');
const before = read('fixture-before.json'), final = read('fixture-after.json'), isolation = read('isolation.json');
const trace = parseCodexEvents(raw.stdout), events = read('session-events.json');
const recomputed = codexCommandEvidence(trace, events, { fixtureRoot: before.root, before: before.target, after: final.target, timedOut: raw.timedOut, code: raw.exitCode }, before.first_word);
const reasons = [];
if (!r.completed || r.readback.model !== r.request.model || r.request.cli_version_observed !== '0.162.1') reasons.push('completion-or-model-readback');
if (!after.unchanged || r.request.fingerprints.local_config !== batch.configs.local || r.request.build_inputs.inputs_sha256 !== batch.source_stamp.inputs_sha256) reasons.push('fingerprint-mismatch');
for (const [p, h] of Object.entries(batch.scripts)) if (hash(path.join(batch.repo, p)) !== h) reasons.push('published-file-changed:' + p);
if (cleanup.fixture_residue !== null || cleanup.scratch_removed !== true || fs.existsSync(before.root) || fs.existsSync(isolation.fakeHome)) reasons.push('cleanup-incomplete');
if (!isolation.independent_home || isolation.configs.some(c => c.mcp_sections_present !== false) || r.mcp_calls.length) reasons.push('mcp-isolation');
const arm = job.args[2];
if (arm === 'read' && (!r.actual_read || !recomputed.actual_read || !r.strict_first_word || !r.structured.ok)) reasons.push('original-actual-read-schema-firstword');
if (arm === 'write' && (!r.write_pass || !recomputed.write_pass || r.write_control.kind !== 'held' || !recomputed.pairs.some(p => p.unique_pair && p.write_pass))) reasons.push('original-production-write-criterion');
if (arm === 'deny' && r.forbidden_read_detection.leaked !== true) reasons.push('original-post-detection');
const { openBudget } = createRequire(import.meta.url)(batch.repo + '/scripts/agent-access-budget.cjs');
const b = openBudget(batch.budget_root, 'admission'), names = fs.readdirSync(b.dir);
const used = names.filter(n => /^reserved-\d+\.json$/.test(n)).length, completed = names.filter(n => /^launch-\d+\.json$/.test(n)).length;
if (used !== completed || used > batch.batch_stop) reasons.push('launch-ledger-incomplete-or-over-cap');
const proof = { at: new Date().toISOString(), kind: 'real-arm/original-criterion', job: job.name, arm, pass: reasons.length === 0, reasons,
  model_requested: r.request.model, model_effective: r.readback.model, model_source: r.readback.model_source,
  provider_declared: r.request.configuration.provider_declared ?? null, provider_effective: r.readback.provider, provider_source: r.readback.provider_source,
  server_identity: null, effort_requested: r.request.effort, effort_effective: r.readback.effort, effort_source: r.readback.effort_source,
  cli_version: r.request.cli_version_observed, cli_version_readback: r.readback.cli_version,
  actual_read: r.actual_read, strict_first_word: r.strict_first_word, structured_ok: r.structured.ok,
  structured_degraded: r.structured.degraded, structured_repairs: r.structured.repairs,
  original_write_pass: r.write_pass, write_context: r.write_context, command_pairs: recomputed.pairs,
  read_content_diagnostic_only: r.read_content_diagnostic ?? null, write_contract_diagnostic_only: r.write_contract_diagnostic ?? null,
  forbidden_read_detection: r.forbidden_read_detection, deny_boundary: '事后检测；不宣称CLI阻止读取；deny未要求JSON，不据该臂证明结构化交付',
  source_stamp: r.request.build_inputs, fingerprints_unchanged: after.unchanged, fixture_removed: !fs.existsSync(before.root),
  budget: { used, completed, limit: b.limit(), batch_stop: batch.batch_stop },
  references: Object.fromEntries(['requested.json', 'raw.json', 'result.json', 'fingerprints-after.json', 'fixture-before.json', 'fixture-after.json', 'isolation.json', 'credential-cleanup.json', 'session-events.json', 'cleanup.json'].map(n => [dir + '/' + n, hash(dir + '/' + n)])),
  script_sha256: hash(new URL(import.meta.url)), criteria_changed: false, new_vendor_starts_for_observation: 0 };
saveEvidence(root + '/' + job.name + '-proof.json', proof);
console.log(JSON.stringify({ job: job.name, pass: proof.pass, reasons, model: proof.model_effective, arm, structured_ok: proof.structured_ok,
  read_content_match: proof.read_content_diagnostic_only?.strict_content_match ?? null, contract_source_before_write: proof.write_contract_diagnostic_only?.source_consumed_before_write ?? null,
  original_write_pass: proof.original_write_pass, post_detection: proof.forbidden_read_detection.leaked, admission: used + '/' + b.limit() }));
if (!proof.pass) process.exitCode = 1;
