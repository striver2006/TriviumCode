/** 两遍全检及源桩后正常四目标安装；逐资产/入口/备份/全局配置核验。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { planInstall, defaultInstallEnv } from 'file:///Users/chenzhenbo/Work/TriviumCode/dist/test/src/install.js';
import { computeBuildStamp } from 'file:///Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/build-stamp.js';
import { saveEvidence } from 'file:///Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const root = path.dirname(new URL(import.meta.url).pathname), repo = process.cwd();
const names = ['dual-abandon', 'dual-approve', 'dual-review-bug', 'dual-review-code', 'dual-review-plan', 'dual-run', 'dual-status'];
const backup = '/Users/chenzhenbo/.trivium/backups/trivium-shared-r14-1791686121897-5a253e93-eab3-4364-ac01-8d0928592994';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function inventory(base, exclude = []) {
  const entries = [];
  function walk(dir, rel = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!rel && exclude.includes(name)) continue;
      const p = path.join(dir, name), r = path.join(rel, name), s = fs.lstatSync(p);
      entries.push({ path: r, mode: s.mode & 0o7777, type: s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : 'file',
        sha256: s.isFile() ? hash(p) : null, link: s.isSymbolicLink() ? fs.readlinkSync(p) : null });
      if (s.isDirectory()) walk(p, r);
    }
  }
  walk(base); return entries;
}
const equal = (a, b, why) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('逐资产不符：' + why); };
const shared = () => Object.fromEntries(names.map(n => [n, exists(path.join(os.homedir(), '.agents/skills', n))]));
const sharedBefore = shared();
if (Object.values(sharedBefore).some(Boolean)) throw Error('共享七入口复现，停止且不移动/绕过安装器');
const backups = Object.fromEntries(names.map(n => {
  const copied = inventory(path.join(backup, 'copied', n));
  equal(copied, inventory(path.join(backup, 'moved', n)), '备份' + n); return [n, copied];
}));
const stamp = await computeBuildStamp(repo), checks = {};
if (stamp.dirty !== false || stamp.git_head !== 'aa6db337315dd60691af966bb2bee1dfc5b0829d') throw Error('清洁提交标识不符');
for (const label of ['check1-r27-denial', 'check2-r27-denial', 'finalbuild-after23', 'source-selftest-after23']) {
  const recordFile = label.startsWith('check') ? path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r14', label + '.json') : path.join(root, label + '.json');
  const record = JSON.parse(fs.readFileSync(recordFile));
  if (record.code !== 0 || record.signal || record.inputs_after.inputs_sha256 !== stamp.inputs_sha256) throw Error('检查或输入不符：' + label);
  checks[label] = { sha256: hash(recordFile), code: record.code, inputs: record.inputs_after.inputs_sha256 };
  if (label === 'source-selftest-after23' && (!record.stdout.includes('通过（14/14 步）') ||
      record.source_bundle_before !== record.source_bundle_after || record.source_bundle_after !== hash(path.join(repo, 'skills/dual-critic/scripts/trivium.cjs')))) throw Error('源桩或精确bundle不符');
}
const task = JSON.parse(fs.readFileSync(path.join(repo, '.reviews/Agent双模式接入真实准入收口/task.json')));
const approval = task.approvals.find(a => a.run_id === '20261011T152631Z' && a.stage === 'code' && a.decision === 'approved');
if (!approval || !approval.reason.includes('f4b47c2a42fa7a63edeb4986762ab3259b183370a93afdff013647ed3424b165')) throw Error('缺明确绑定本轮敏感范围审批');
const globals = ['.codex/config.toml', '.codex/auth.json', '.codex/hooks.json', '.claude/settings.json'];
const readGlobals = () => Object.fromEntries(globals.map(n => [n, exists(path.join(os.homedir(), n)) ? hash(path.join(os.homedir(), n)) : null]));
const globalsBefore = readGlobals(), env = { ...process.env }; delete env.TRIVIUM_ASSET_ROOT;
const plan = await planInstall(repo, { ...defaultInstallEnv(), env }), selected = plan.targets.map(t => t.agent);
if (selected.length !== 4 || plan.targets.some(t => t.sources.length !== 7)) throw Error('四目标28入口计划不符');
const child = spawn(process.execPath, ['dist/install.cjs', '--targets', selected.join(',')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
child.once('error', e => { stderr += 'installer:' + (e.code ?? 'unknown') + '\n'; });
const [code, signal] = await new Promise(resolve => child.once('close', (...r) => resolve(r)));
saveEvidence(path.join(root, 'installer-call-after23.json'), { at: new Date().toISOString(), selected, code, signal, stdout, stderr, vendor_cli_starts: 0 });
if (code !== 0 || signal) throw Error('正常四目标安装失败');
equal(inventory(path.join(repo, 'skills/dual-critic'), ['entry']), inventory(plan.runtimeRoot), '全部运行时资产');
const entries = [];
for (const t of plan.targets) for (const s of t.sources) {
  const target = path.join(t.skillsRoot, s.name);
  equal(inventory(s.src), inventory(target), t.agent + '/' + s.name);
  entries.push({ agent: t.agent, name: s.name, target, inventory: inventory(target) });
}
const globalsAfter = readGlobals(), sharedAfter = shared();
equal(globalsBefore, globalsAfter, '四全局配置');
if (Object.values(sharedAfter).some(Boolean)) throw Error('安装后共享入口复现');
for (const n of names) for (const side of ['copied', 'moved']) equal(inventory(path.join(backup, side, n)), backups[n], '安装后备份' + n);
const result = { at: new Date().toISOString(), status: 'four-target-install-verified', targets: selected, entries,
  runtime_root: plan.runtimeRoot, runtime_sha256: hash(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')),
  source_sha256: hash(path.join(repo, 'skills/dual-critic/scripts/trivium.cjs')), build_stamp: await computeBuildStamp(repo),
  checks, approval, backup, backup_names_verified: names, sharedBefore, sharedAfter, globalsBefore, globalsAfter,
  client_name_resolution: null, other_repositories_dependency_complete: null, vendor_cli_starts: 0 };
saveEvidence(path.join(root, 'install-after23.json'), result);
console.log(JSON.stringify({ status: result.status, targets: selected, entries: entries.length,
  shared_absent: true, backup_verified: names.length, runtime_sha256: result.runtime_sha256 }));
