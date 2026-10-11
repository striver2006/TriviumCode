/** 第11次计划审查任务入口：node doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v6.mjs <池> <标签> tv|probe <参数...>；v5原件保留。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { redactSecrets, scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { saveEvidence, primaryLoaded } from '../../../../scripts/agent-access-evidence.mjs';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { assertFormalRound } from './round-guard.mjs';
const require = createRequire(import.meta.url);
const { openBudget, hashFile } = require('../../../../scripts/agent-access-budget.cjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const legacyRoot = path.join(repo, 'doc/05_testing/evidence/agent-access-20261010-closeout-r2');
const root = path.join(process.env.HOME, '.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const continuity = JSON.parse(fs.readFileSync(path.join(root, 'continuity.json')));
if (fs.readFileSync(path.join(root, 'continuity.json'), 'utf8') !== fs.readFileSync(path.join(repo,
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/budget-continuity-r12.json'), 'utf8')) throw Error('预算连续性冻结原件不符');
if (continuity.source !== legacyRoot || continuity.destination !== root) throw Error('预算连续性权威不符');
for (const item of continuity.files) {
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest(path.join(legacyRoot, item.path)) !== item.sha256 || digest(path.join(root, item.path)) !== item.sha256)
    throw Error('历史预算连续性hash不符，拒绝启动');
}
const evidenceRoot = path.join(process.env.HOME, '.trivium/evidence/agent-access-20261011-closeout-r3');
const staticRoot = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
const [pool, label, mode, ...args] = process.argv.slice(2);
if (!/^[\w-]+$/.test(label ?? '') || !['tv', 'probe'].includes(mode)) throw Error('用法：<admission|review> <标签> tv|probe <参数>');
const budget = openBudget(root, pool); budget.limit();
const authFile = path.join(staticRoot, 'formal-round-authorization-v5.json');
const authorization = JSON.parse(fs.readFileSync(authFile));
if (mode === 'tv' && args[0] === 'review' && args.includes('--start')) {
  const { listRecordedRuns } = await import('../../../../dist/test/src/trivium/archive.js');
  const { readTask } = await import('../../../../dist/test/src/trivium/meta.js');
  const layout = { archiveRoot: path.join(repo, '.reviews'), topic: authorization.topic };
  const runs = await listRecordedRuns(layout), task = await readTask(layout);
  assertFormalRound(authorization, task, runs, args);
  if (['plan', 'code'].includes(args[args.indexOf('--stage') + 1])) {
    const { measureCodeStart, assertCodeStartMeasurement } = await import('./formal-start-precheck-v2.mjs');
    const measurement = await measureCodeStart(repo, authorization.topic, args);
    const precheckDir = path.join(evidenceRoot, 'calls');
    fs.mkdirSync(precheckDir, { recursive: true });
    saveEvidence(path.join(precheckDir, `${label}-${crypto.randomUUID()}-start-measurement.json`), measurement);
    assertCodeStartMeasurement(measurement);
  }
}
const token = crypto.randomUUID();
const preload = path.join(repo, 'scripts/agent-access-budget-preload.cjs');
const target = mode === 'tv' ? path.join(repo, '.trivium/bin/trivium') : process.execPath;
const targetArgs = mode === 'tv' ? args : [path.join(legacyRoot, 'probe.mjs'), ...args];
const env = { ...process.env, TRIVIUM_ACCESS_BUDGET_ROOT: root, TRIVIUM_ACCESS_BUDGET_POOL: pool,
  TRIVIUM_ACCESS_LABEL: label, TRIVIUM_ACCESS_EVIDENCE_ROOT: evidenceRoot, TRIVIUM_ACCESS_LOAD_TOKEN: token,
  TRIVIUM_ACCESS_SCRIPT_SHA256: hashFile(mode === 'tv' ? fileURLToPath(import.meta.url) : path.join(legacyRoot, 'probe.mjs')),
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${preload}`.trim() };
const callDir = path.join(evidenceRoot, 'calls'); fs.mkdirSync(callDir, { recursive: true });
const invocation = { budget_root: root, budget_continuity_sha256: hashFile(path.join(root, 'continuity.json')),
  start_precheck_sha256: hashFile(path.join(staticRoot, 'formal-start-precheck-v2.mjs')),
  current_authority_sha256: hashFile(path.join(staticRoot, 'formal-round-authority.json')),
  round_guard_sha256: hashFile(path.join(staticRoot, 'round-guard.mjs')),
  round_authorization_sha256: hashFile(authFile), round_authorization: authFile, load_id: token, pool, label, mode, requested_at: new Date().toISOString(), preload_sha256: hashFile(preload),
  build_inputs_observed: await computeBuildStamp(repo),
  argv_flags_only: args.filter(a => a.startsWith('--')), script_sha256: hashFile(fileURLToPath(import.meta.url)),
  execution_sha256: env.TRIVIUM_ACCESS_SCRIPT_SHA256, core_sha256: hashFile(path.join(repo, 'scripts/agent-access-budget.cjs')),
  secrets_module_sha256: hashFile(path.join(repo, 'dist/test/src/trivium/secrets.js')),
  evidence_helper_sha256: hashFile(path.join(repo, 'scripts/agent-access-evidence.mjs')),
  wrapper_sha256: hashFile(path.join(repo, '.trivium/bin/trivium')),
  installed_bundle_sha256: hashFile(path.join(process.env.HOME, '.claude/skills/dual-critic/scripts/trivium.cjs')),
  shared_config_sha256: hashFile(path.join(repo, '.trivium/config.yaml')), local_config_sha256: hashFile(path.join(repo, '.trivium/config.local.yaml')) };
saveEvidence(path.join(callDir, `${label}-${token}-requested.json`), invocation);
env.TRIVIUM_ACCESS_MANIFEST = path.join(callDir, `${label}-${token}-requested.json`);
const child = spawn(target, targetArgs, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
child.once('error', e => { stderr += `launcher:${e.code ?? 'unknown'}\n`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...result) => resolve(result)));
const loadedDir = path.join(root, 'loaded');
const marks = fs.existsSync(loadedDir) ? fs.readdirSync(loadedDir).filter(n => n.startsWith(token + '-'))
  .map(n => JSON.parse(fs.readFileSync(path.join(loadedDir, n)))) : [];
const loadedOk = primaryLoaded(marks, invocation, process.pid);
const content = redactSecrets(JSON.stringify({ ...invocation, code, signal, primary_loaded: loadedOk,
  loaded_pids: marks.map(x => x.pid), stdout, stderr }, null, 2)).content + '\n';
if (scanSecrets(content).length) throw Error('调用输出扫描失败，拒绝落盘');
fs.writeFileSync(path.join(callDir, `${label}-${token}-completed.json`), content, { flag: 'wx', mode: 0o600 });
process.stdout.write(redactSecrets(stdout).content); process.stderr.write(redactSecrets(stderr).content);
if (!loadedOk) throw Error('预算侧车未装载，调用不得标为成功');
process.exitCode = code ?? 1;

