// 零模型调用的独立验后核对；不改原始批次、不回算历史证据、不执行人工审批。
// 用法：node doc/05_testing/evidence/argon-acceptance-20261016/verify.mjs <批次>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const batch = process.argv[2];
if (!/^[\w-]+$/.test(batch ?? '')) throw Error('批次名无效');
const dir = path.join(here, batch);
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const save = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const { run } = await import(path.join(repo, 'dist/test/src/trivium/util/exec.js'));
const { writeArtifact } = await import(path.join(repo, 'dist/test/src/trivium/archive.js'));
const { parseReview } = await import(path.join(repo, 'dist/test/src/trivium/parse.js'));
const manifest = read('manifest.json'), full = read('full-review-result.json');
const root = manifest.fixture_root, topic = full.run.topic;
const actual = full.run, critic = actual.critics.gemini;
const meta = path.join(dir, 'fixture/.reviews', topic, 'code/_meta');
const review = JSON.parse(fs.readFileSync(path.join(meta, `review-gemini-${full.run_id}.json`), 'utf8'));
const original = await run('git', ['-c', 'core.quotePath=false', 'show', 'HEAD:src/inventory.js'], { cwd: root, timeoutMs: 30000 });
assert.equal(original.code, 0);
const expectedInventory = original.stdout.replace("  if (quantity > stock) throw new Error('insufficient stock');\n", '');
assert.notEqual(original.stdout, expectedInventory);
const expected = { ...manifest.fixture_files, 'src/inventory.js': hash(expectedInventory) };
const businessUnchanged = Object.entries(expected).every(([f, digest]) => full.fixture_business_files[f] === digest);
const readResult = read('read-result.json');
const write = read('write-negative-result.json'), command = read('command-negative-result.json');
const knownBug = review.findings.some(f => f.kind === 'correctness' && f.location.includes('src/inventory.js')
  && /quantity\s*>\s*stock|库存不足|超额|负数库存|超卖/.test(f.problem + f.evidence));
const parsed = parseReview(JSON.stringify(review));
const modelMatches = critic.model_effective === 'gemini-4-argon-high' && critic.model_effective_source === 'envelope';
const codeReview = actual.status === 'success' && actual.review_mode === 'full' && full.wait_exit === 0
  && critic.status === 'ok' && critic.evidence_ok === true && critic.parse_fallback === false
  && actual.guard.readonly_breach === false && actual.guard.peer_artifact_read === false
  && knownBug && businessUnchanged;
assert.equal(readResult.read_pass, true);
assert.equal(modelMatches, true);
assert.equal(critic.effort_effective, 'high');
assert.equal(critic.effort_effective_source, 'envelope');
assert.equal(codeReview, true);

const reviewDoc = actual.artifacts.find(a => a.path?.endsWith('-gemini.md'));
assert(reviewDoc, '必须有编排器写出的真实审查件');
assert.deepEqual(review.findings.map(f => f.id), ['AGY-01', 'AGY-02']);
const content = [
  '---', 'schema: trivium.disposition.v1', `topic: ${topic}`, 'stage: code', 'role: codex', 'kind: response',
  `run_id: ${full.run_id}`, 'addresses:', `  - ${path.basename(reviewDoc.path)}`, '---', '',
  '# 隔离验收夹具逐条应答', '',
  '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
  '| :--- | :--- | :--- | :--- | :--- | :--- |',
  '| AGY-01 | gemini | blocker | 接受 | 命中本次故意移除的超卖检查；独立运行夹具测试也确实失败。此为验收样本，不据此修改本仓业务代码。 | 夹具 src/inventory.js 的数量大于库存分支，后续若修复则恢复检查 |',
  '| AGY-02 | gemini | minor | 接受 | 实际测试缺少耗尽库存、负数和浮点数量以及调用链用例；意见成立。 | 夹具 test/inventory.test.js 的边界及 placeOrder 调用链用例，后续修复时补充 |', '',
  '本件只完成验收中的逐条裁决。未调用 approve，未修复夹具缺陷，未修改生产业务文件。', '',
].join('\n');
const response = await writeArtifact({ layout: { archiveRoot: path.join(root, '.reviews'), topic }, stage: 'code',
  role: 'codex', writer: 'driver', driver: 'codex', kind: 'response', rerunIndex: actual.rerun_index,
  date: '2026-10-16', content });
save('driver-response-location.json', response);
const cli = path.join(repo, '.trivium/bin/trivium');
const env = { TRIVIUM_STUB_CRITIC: undefined, TRIVIUM_ASSET_ROOT: undefined };
const gate = await run(cli, ['gate', '--stage', 'code', '--topic', topic, '--check', '--run-id', full.run_id, '--json'], { cwd: root, env, timeoutMs: 30000 });
const artifacts = await run(cli, ['gate', '--stage', 'code', '--topic', topic, '--check-artifacts', '--run-id', full.run_id, '--json'], { cwd: root, env, timeoutMs: 30000 });
save('gate-check.json', gate); save('artifact-check.json', artifacts);
assert.equal(gate.code, 0, gate.stdout + gate.stderr);
assert.equal(artifacts.code, 0, artifacts.stdout + artifacts.stderr);
fs.copyFileSync(response.absPath, path.join(dir, 'fixture/.reviews', response.relPath));
const result = {
  batch, run_id: full.run_id, code_review_pass: codeReview, model_readback_pass: modelMatches,
  model_effective: critic.model_effective, model_source: critic.model_effective_source,
  effort_effective: critic.effort_effective, effort_source: critic.effort_effective_source,
  actual_read_pass: readResult.read_pass, business_files_unchanged: businessUnchanged,
  successful_tool_calls: critic.tool_calls, evidence_ok: critic.evidence_ok,
  structured_parse_kind: parsed.kind, parse_fallback: critic.parse_fallback, known_bug_found: knownBug,
  verdict: review.verdict, findings: review.findings.map(f => ({ id: f.id, severity: f.severity, kind: f.kind })),
  driver_response_complete: gate.code === 0, artifacts_complete: artifacts.code === 0,
  readonly_observed: actual.guard.readonly_breach === false && businessUnchanged && write.unchanged && command.unchanged,
  actual_write_attempt_denied: write.actual_attempt_denied,
  actual_command_attempt_denied: command.actual_attempt_denied,
  negative_control_complete: write.negative_pass === true && command.negative_pass === true,
  overall: write.negative_pass === true && command.negative_pass === true ? 'passed' : 'partial',
  boundaries: ['写文件与命令负对照没有实际工具尝试，拒绝强制性仍未测', '单侧审查不代表多审背靠背验收',
    '未执行用户人工审批或修复夹具', '不改变全局配置、生产判据或历史件'],
  expected_inventory_sha256: hash(expectedInventory), script_sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
};
save('verification.json', result);
console.log(JSON.stringify(result, null, 2));
