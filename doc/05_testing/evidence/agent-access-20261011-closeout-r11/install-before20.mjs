/** 最终构建后的正常四目标安装与七共享入口/备份/全局配置只读核验；不移动共享目录。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planInstall, defaultInstallEnv } from '../../../../dist/test/src/install.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(root, '../../../..');
const shared = path.join(os.homedir(), '.agents/skills');
const names = ['dual-abandon', 'dual-approve', 'dual-review-bug', 'dual-review-code', 'dual-review-plan', 'dual-run', 'dual-status'];
const backup = '/Users/chenzhenbo/.trivium/backups/trivium-shared-r14-1791686121897-5a253e93-eab3-4364-ac01-8d0928592994';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
function inventory(base, exclude = []) {
  const entries = [];
  function walk(current, rel = '') {
    for (const name of fs.readdirSync(current).sort()) {
      if (!rel && exclude.includes(name)) continue;
      const file = path.join(current, name), relative = path.join(rel, name), stat = fs.lstatSync(file);
      entries.push({ path: relative, mode: stat.mode & 0o7777, type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
        sha256: stat.isFile() ? sha(file) : null, link: stat.isSymbolicLink() ? fs.readlinkSync(file) : null });
      if (stat.isDirectory()) walk(file, relative);
    }
  }
  walk(base); return entries;
}
function equal(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`逐文件核验不一致：${label}`); }
const sharedBefore = Object.fromEntries(names.map(name => [name, exists(path.join(shared, name))]));
const backupInventory = Object.fromEntries(names.map(name => {
  const copied = path.join(backup, 'copied', name), moved = path.join(backup, 'moved', name);
  if (!exists(copied) || !exists(moved)) throw Error(`迁移备份不全：${name}`);
  const a = inventory(copied), b = inventory(moved); equal(a, b, `备份${name}`); return [name, a];
}));
if (Object.values(sharedBefore).some(Boolean)) {
  saveEvidence(path.join(root, 'shared-reappearance-blocked-before20.json'), { at: new Date().toISOString(), sharedBefore, backup, source_actor: null, installer_started: false });
  throw Error('七共享入口再次出现，按计划停止，不绕过安装器');
}
for (const label of ['check1-r22-final', 'check2-r22-final', 'finalbuild-r22-before20', 'selftest-r22-before20']) {
  const record = JSON.parse(fs.readFileSync(path.join(root, `${label}.json`)));
  if (record.code !== 0) throw Error(`前置验证未通过：${label}`);
}
const bundle = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const build = JSON.parse(fs.readFileSync(path.join(root, 'final-build-fingerprint-before20.json')));
if (build.bundle_sha256 !== sha(bundle) || build.source_stamp.inputs_sha256 !== (await computeBuildStamp(repo)).inputs_sha256)
  throw Error('最终构建或安装输入已改变');
const task = JSON.parse(fs.readFileSync(path.join(repo, '.reviews/Agent双模式接入真实准入收口/task.json')));
if (!task.approvals?.some(a => a.run_id === '20261011T113848Z' && a.stage === 'plan' && a.decision === 'approved'))
  throw Error('缺本轮有效计划审批');
const globalFiles = ['.codex/config.toml', '.codex/auth.json', '.codex/hooks.json', '.claude/settings.json'];
const globalsBefore = Object.fromEntries(globalFiles.map(n => [n, exists(path.join(os.homedir(), n)) ? sha(path.join(os.homedir(), n)) : null]));
const env = { ...process.env }; delete env.TRIVIUM_ASSET_ROOT;
const plan = await planInstall(repo, { ...defaultInstallEnv(), env });
const selected = plan.targets.map(t => t.agent);
if (selected.length !== 4 || plan.targets.some(t => t.sources.length !== 7)) throw Error('四目标28入口计划不符');
const child = spawn(process.execPath, ['dist/install.cjs', '--targets', selected.join(',')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
child.once('error', e => { stderr += `installer:${e.code ?? 'unknown'}\n`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
saveEvidence(path.join(root, 'installer-call-before20.json'), { at: new Date().toISOString(), code, signal, stdout, stderr, selected, cli_vendor_starts: 0 });
if (code !== 0 || signal) throw Error('正常四目标安装器失败');
equal(inventory(path.join(repo, 'skills/dual-critic'), ['entry']), inventory(plan.runtimeRoot), '运行时全部资产');
const entries = [];
for (const t of plan.targets) for (const s of t.sources) {
  const dst = path.join(t.skillsRoot, s.name); equal(inventory(s.src), inventory(dst), `${t.agent}/${s.name}`);
  entries.push({ agent: t.agent, name: s.name, target: dst, inventory: inventory(dst) });
}
const globalsAfter = Object.fromEntries(globalFiles.map(n => [n, exists(path.join(os.homedir(), n)) ? sha(path.join(os.homedir(), n)) : null]));
equal(globalsBefore, globalsAfter, '全局配置');
const sharedAfter = Object.fromEntries(names.map(name => [name, exists(path.join(shared, name))]));
if (Object.values(sharedAfter).some(Boolean)) throw Error('安装后七共享入口复现，停止交付');
for (const name of names) equal(inventory(path.join(backup, 'copied', name)), backupInventory[name], `安装后备份${name}`);
const result = { at: new Date().toISOString(), backup, sharedBefore, sharedAfter, backup_names_verified: names,
  targets: selected, entries, runtime_root: plan.runtimeRoot,
  runtime_sha256: sha(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')), source_sha256: sha(bundle),
  build_stamp: await computeBuildStamp(repo), globalsBefore, globalsAfter, client_name_resolution: null,
  status: 'four-target-install-verified' };
saveEvidence(path.join(root, 'install-before20.json'), result);
console.log(JSON.stringify({ status: result.status, targets: selected, entries: entries.length, shared_absent: true, backup_verified: names.length, runtime_sha256: result.runtime_sha256 }));
