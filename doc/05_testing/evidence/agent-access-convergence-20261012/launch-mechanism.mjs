/** 本批直接执行固定入口；预算包装器及侧车沿用，授权来源明确为用户免审指令。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { redactSecrets, scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { saveEvidence, primaryLoaded } from '../../../../scripts/agent-access-evidence.mjs';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import {assertMode3Arguments,measureMode3Launch} from './mechanism-launch-check.mjs';

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
if (!/^[\w-]+$/.test(label ?? '')) throw Error('mode3-label-rejected');
assertMode3Arguments(pool,mode,args);
const measured=await measureMode3Launch(repo,pool,mode,args);
const token = process.env.TRIVIUM_ACCESS_REQUEST_TOKEN ?? crypto.randomUUID();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) throw Error('本次请求token格式无效');
const callDir = path.join(evidenceRoot, 'calls'); fs.mkdirSync(callDir, { recursive: true });
if (fs.readdirSync(callDir).some(name => name.endsWith(`-${token}-requested.json`) || name.endsWith(`-${token}-completed.json`)))
  throw Error('本次请求token已经使用');
saveEvidence(path.join(callDir, `${token}-claim.json`), { load_id: token, label, pool, mode, claimed_at: new Date().toISOString() });
const budget = openBudget(root, pool); budget.limit();
const authFile = path.join(repo,'doc/05_testing/evidence/agent-access-convergence-20261012/mechanism-authorization.json');

const preload = path.join(repo, 'scripts/agent-access-budget-preload.cjs');
const target=process.execPath,fixtureTarget=path.join(repo,'doc/05_testing/evidence/agent-access-convergence-20261012/controlled-fixture.mjs');
const targetArgs=[fixtureTarget,...args];
const env = { ...process.env, TRIVIUM_ACCESS_BUDGET_ROOT: root, TRIVIUM_ACCESS_BUDGET_POOL: pool,
  TRIVIUM_ACCESS_LABEL: label, TRIVIUM_ACCESS_EVIDENCE_ROOT: evidenceRoot, TRIVIUM_ACCESS_LOAD_TOKEN: token,
  TRIVIUM_ACCESS_SCRIPT_SHA256: hashFile(fixtureTarget),
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${preload}`.trim() };
const invocation = { budget_root: root, budget_continuity_sha256: hashFile(path.join(root, 'continuity.json')),
  start_precheck_sha256: hashFile(path.join(staticRoot, 'formal-start-precheck-v2.mjs')),
  current_authority_sha256: hashFile(path.join(staticRoot, 'formal-round-authority.json')),
  round_guard_sha256: hashFile(path.join(staticRoot, 'round-guard-v2.mjs')),
  user_authorization_sha256: hashFile(authFile), user_authorization: authFile, load_id: token, pool, label, mode, requested_at: new Date().toISOString(), preload_sha256: hashFile(preload),
  build_inputs_observed: await computeBuildStamp(repo),
  argv_flags_only: args.filter(a => a.startsWith('--')), script_sha256: hashFile(fileURLToPath(import.meta.url)),
  execution_sha256: env.TRIVIUM_ACCESS_SCRIPT_SHA256, core_sha256: hashFile(path.join(repo, 'scripts/agent-access-budget.cjs')),
  secrets_module_sha256: hashFile(path.join(repo, 'dist/test/src/trivium/secrets.js')),
  evidence_helper_sha256: hashFile(path.join(repo, 'scripts/agent-access-evidence.mjs')),
  wrapper_sha256: hashFile(path.join(repo, '.trivium/bin/trivium')),
  installed_bundle_sha256: hashFile(path.join(process.env.HOME, '.claude/skills/dual-critic/scripts/trivium.cjs')),
  shared_config_sha256: hashFile(path.join(repo, '.trivium/config.yaml')), local_config_sha256: hashFile(path.join(repo, '.trivium/config.local.yaml')) };
saveEvidence(measured.job.claim,{load_id:token,claimed_at:new Date().toISOString(),batch_ref:measured.batch_ref,plan_run_id:null,user_review_waiver:true,criteria_adopted:false,authorization_ref:{path:authFile,sha256:hashFile(authFile)},combination:args[0],variant:args[1],before_starts:measured.facts.used,previous_proofs:measured.facts.previous_proofs});
saveEvidence(path.join(callDir, `${label}-${token}-requested.json`), {...invocation,batch_ref:measured.batch_ref,claim_ref:{path:measured.job.claim,sha256:hashFile(measured.job.claim)},previous_proofs:measured.facts.previous_proofs});
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
