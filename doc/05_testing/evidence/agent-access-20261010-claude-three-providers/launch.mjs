/** 唯一本轮任务入口：node scripts/agent-access-launch.mjs <池> <标签> tv|probe <参数...>。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { redactSecrets, scanSecrets } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/secrets.js';
import { saveEvidence, primaryLoaded } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { computeBuildStamp } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/build-stamp.js';
const require = createRequire(import.meta.url);
const { openBudget, hashFile } = require('/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-budget.cjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const root = path.join(repo, 'doc/05_testing/evidence/agent-access-20261010-claude-three-providers');
const [pool, label, mode, ...args] = process.argv.slice(2);
if (!/^[\w-]+$/.test(label ?? '') || !['tv', 'probe'].includes(mode)) throw Error('用法：<admission|review> <标签> tv|probe <参数>');
if (pool !== 'admission' || mode !== 'probe' || !['static','claude'].includes(args[0]) || !['qwen','kimi','deepseek','qwen-pro','kimi-pro','deepseek-pro'].includes(args[1]) || !['version','read','write','write-full','deny','deny-full'].includes(args[2])) throw Error('本批仅允许三供应商生产工具面的准入探针');
const budget = openBudget(root, pool); budget.limit();
const token = crypto.randomUUID();
const preload = path.join(repo, 'scripts/agent-access-budget-preload.cjs');
const target = mode === 'tv' ? path.join(repo, '.trivium/bin/trivium') : process.execPath;
const targetArgs = mode === 'tv' ? args : [path.join(root, 'probe.mjs'), ...args];
const env = { ...process.env, TRIVIUM_ACCESS_BUDGET_ROOT: root, TRIVIUM_ACCESS_BUDGET_POOL: pool,
  TRIVIUM_ACCESS_LABEL: label, TRIVIUM_ACCESS_LOAD_TOKEN: token,
  TRIVIUM_ACCESS_SCRIPT_SHA256: hashFile(mode === 'tv' ? fileURLToPath(import.meta.url) : path.join(root, 'probe.mjs')),
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${preload}`.trim() };
const callDir = path.join(root, 'calls'); fs.mkdirSync(callDir, { recursive: true });
const invocation = { load_id: token, pool, label, mode, requested_at: new Date().toISOString(), preload_sha256: hashFile(preload),
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
