/** 配置调整的预算入口；厂商调用全部委托项目编排器，不直接启动审核者。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../../..');
const require = createRequire(import.meta.url);
const { hashFile, openBudget } = require(path.join(repo, 'scripts/agent-access-budget.cjs'));
const { saveEvidence, primaryLoaded } = await import(path.join(repo, 'scripts/agent-access-evidence.mjs'));
const [label, ...args] = process.argv.slice(2);
if (!/^[\w-]+$/.test(label ?? '') || args[0] !== 'preflight') throw Error('只允许带唯一标签的项目 preflight');
const budget = openBudget(root, 'admission'); budget.limit();
const load_id = crypto.randomUUID();
const preload = path.join(repo, 'scripts/agent-access-budget-preload.cjs');
const wrapper = path.join(repo, '.trivium/bin/trivium');
const invocation = { load_id, label, pool: 'admission', argv: args, requested_at: new Date().toISOString(),
  script_sha256: hashFile(fileURLToPath(import.meta.url)), preload_sha256: hashFile(preload),
  core_sha256: hashFile(path.join(repo, 'scripts/agent-access-budget.cjs')),
  shared_config_sha256: hashFile(path.join(repo, '.trivium/config.yaml')),
  local_config_sha256: hashFile(path.join(repo, '.trivium/config.local.yaml')),
  wrapper_sha256: hashFile(wrapper),
  installed_bundle_sha256: hashFile(path.join(process.env.HOME, '.claude/skills/dual-critic/scripts/trivium.cjs')) };
fs.mkdirSync(path.join(root, 'calls'), { recursive: true });
const manifest = path.join(root, 'calls', `${label}-${load_id}-requested.json`);
saveEvidence(manifest, invocation);
const env = { ...process.env, TRIVIUM_ACCESS_BUDGET_ROOT: root, TRIVIUM_ACCESS_BUDGET_POOL: 'admission',
  TRIVIUM_ACCESS_LABEL: label, TRIVIUM_ACCESS_LOAD_TOKEN: load_id, TRIVIUM_ACCESS_MANIFEST: manifest,
  TRIVIUM_ACCESS_SCRIPT_SHA256: invocation.script_sha256,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${preload}`.trim() };
const child = spawn(wrapper, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
child.once('error', e => { stderr += `spawn:${e.code ?? 'unknown'}`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...x) => resolve(x)));
const marks = fs.readdirSync(path.join(root, 'loaded')).filter(n => n.startsWith(load_id + '-'))
  .map(n => JSON.parse(fs.readFileSync(path.join(root, 'loaded', n))));
const loaded = primaryLoaded(marks, invocation, process.pid);
saveEvidence(path.join(root, 'calls', `${label}-${load_id}-completed.json`), { ...invocation, code, signal,
  primary_loaded: loaded, stdout, stderr, completed_at: new Date().toISOString() });
if (!loaded) throw Error('侧车未装载，禁止判成功');
const result = JSON.parse(stdout);
console.log(JSON.stringify({ label, code, ok: result.ok, checks: result.checks, warnings: result.warnings }));
process.exitCode = code ?? 1;
