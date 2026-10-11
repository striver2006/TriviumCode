/** r14获批普通安装收口：原七入口逐项同内容复现，复用已审迁移方法：先完整备份核对，再可恢复移动，最后经正常安装器安装四目标。 */
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
const backupParent = path.join(os.homedir(), '.trivium/backups');
const shared = path.join(os.homedir(), '.agents/skills');
const names = ['dual-abandon', 'dual-approve', 'dual-review-bug', 'dual-review-code', 'dual-review-plan', 'dual-run', 'dual-status'];
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
function restore(backup, original) {
  const moved = path.join(backup, 'moved');
  for (const name of names) if (exists(path.join(moved, name))) {
    if (exists(path.join(shared, name))) throw Error(`恢复拒绝覆盖：${name}`);
    fs.renameSync(path.join(moved, name), path.join(shared, name));
  }
  for (const name of names) equal(inventory(path.join(shared, name)), original[name], `恢复${name}`);
  saveEvidence(path.join(backup, `restored-${crypto.randomUUID()}.json`), { at: new Date().toISOString(), restored: names, installer_changes_rolled_back: false });
}
fs.mkdirSync(backupParent, { recursive: true });
// 重启先恢复未完成迁移，拒绝在未知过渡态继续安装。
for (const entry of fs.readdirSync(backupParent).filter(n => (n.startsWith('trivium-shared-r12-') || n.startsWith('trivium-shared-r14-')))) {
  const previous = path.join(backupParent, entry), start = path.join(previous, 'started.json');
  if (!exists(start) || exists(path.join(previous, 'success.json')) || fs.readdirSync(previous).some(n => n.startsWith('restored-'))) continue;
  restore(previous, JSON.parse(fs.readFileSync(start)).original);
  throw Error('已恢复上次未完成迁移；请核对恢复记录后重新执行本操作');
}
for (const label of ['check1-round9', 'check2-round9', 'final-build-round9', 'selftest-round9-final']) {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, `${label}.json`)));
  if (evidence.code !== 0) throw Error(`前置验证未通过：${label}`);
}
const bundle = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const build = JSON.parse(fs.readFileSync(path.join(root, 'final-build-round9.json')));
if (build.bundle_sha256 !== sha(bundle) || build.source_stamp.inputs_sha256 !== (await computeBuildStamp(repo)).inputs_sha256)
  throw Error('最终构建与当前源码不符');
const task = JSON.parse(fs.readFileSync(path.join(repo, '.reviews/Agent双模式接入真实准入收口/task.json')));
if (!task.approvals?.some(a => a.run_id === '20261011T020308Z' && a.stage === 'plan' && a.decision === 'approved'))
  throw Error('未找到当前r14委托审批依据');
const reappearance = JSON.parse(fs.readFileSync(path.join(root, "shared-entry-reappearance-audit.json")));
if (reappearance.results.length !== 7 || reappearance.results.some(r => JSON.stringify(inventory(path.join(shared, r.name))) !== JSON.stringify(r.inventory))) throw Error("共享入口自审计后改变，停止");
const original = Object.fromEntries(names.map(n => [n, inventory(path.join(shared, n))]));
const rootModes = Object.fromEntries(names.map(n => [n, fs.lstatSync(path.join(shared, n)).mode & 0o7777]));
const backup = path.join(backupParent, `trivium-shared-r14-${Date.now()}-${crypto.randomUUID()}`);
fs.mkdirSync(backup); fs.mkdirSync(path.join(backup, 'copied')); fs.mkdirSync(path.join(backup, 'moved'));
const globalFiles = ['.codex/config.toml', '.codex/auth.json', '.codex/hooks.json', '.claude/settings.json'];
const globalsBefore = Object.fromEntries(globalFiles.map(n => [n, exists(path.join(os.homedir(), n)) ? sha(path.join(os.homedir(), n)) : null]));
saveEvidence(path.join(backup, 'started.json'), { at: new Date().toISOString(), original, rootModes, globalsBefore,
  authority: '用户本轮自动审批授权；run20261011T020308Z有效9B/r14普通审批；当前七入口逐项同内容，继承已审r12§四及GLM-02连续备份迁移方法',
  impact: '所有发现~/.agents/skills七入口的仓库；专用入口按各carrier保留；客户端实际解析未测',
  restore: '失败或中断先逐个moved移回原精确路径，拒绝覆盖，逐文件hash/软链/权限核对；备份永久保留',
  source_bundle_sha256: sha(bundle), script_sha256: sha(fileURLToPath(import.meta.url)) });
try {
  for (const name of names) {
    const copy = path.join(backup, 'copied', name);
    fs.cpSync(path.join(shared, name), copy, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true });
    if ((fs.lstatSync(copy).mode & 0o7777) !== rootModes[name]) throw Error(`备份根权限不一致：${name}`);
    equal(inventory(copy), original[name], `备份${name}`);
  }
  saveEvidence(path.join(backup, 'backup-verified.json'), { at: new Date().toISOString(), names, original });
  for (const name of names) fs.renameSync(path.join(shared, name), path.join(backup, 'moved', name));
  saveEvidence(path.join(backup, 'moved.json'), { at: new Date().toISOString(), names, shared_absent: names.every(n => !exists(path.join(shared, n))) });
  const env = { ...process.env }; delete env.TRIVIUM_ASSET_ROOT;
  const plan = await planInstall(repo, { ...defaultInstallEnv(), env });
  const selected = plan.targets.map(t => t.agent);
  if (selected.length !== 4 || plan.targets.some(t => t.sources.length !== 7)) throw Error('四目标28入口计划不符');
  const child = spawn(process.execPath, ['dist/install.cjs', '--targets', selected.join(',')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  child.once('error', e => { stderr += `installer:${e.code ?? 'unknown'}\n`; });
  const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
  saveEvidence(path.join(backup, 'installer.json'), { code, signal, stdout, stderr, selected, cli_vendor_starts: 0 });
  if (code !== 0 || signal) throw Error('正常四目标安装器失败');
  equal(inventory(path.join(repo, 'skills/dual-critic'), ['entry']), inventory(plan.runtimeRoot), '运行时全部资产');
  const entries = [];
  for (const t of plan.targets) for (const s of t.sources) {
    const dst = path.join(t.skillsRoot, s.name); equal(inventory(s.src), inventory(dst), `${t.agent}/${s.name}`);
    entries.push({ agent: t.agent, name: s.name, target: dst, inventory: inventory(dst) });
  }
  const globalsAfter = Object.fromEntries(globalFiles.map(n => [n, exists(path.join(os.homedir(), n)) ? sha(path.join(os.homedir(), n)) : null]));
  equal(globalsBefore, globalsAfter, '全局配置');
  const result = { at: new Date().toISOString(), backup, targets: selected, entries, runtime_root: plan.runtimeRoot,
    runtime_sha256: sha(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')), source_sha256: sha(bundle),
    build_stamp: await computeBuildStamp(repo), shared_names_absent: names.every(n => !exists(path.join(shared, n))),
    globalsBefore, globalsAfter, client_name_resolution: null, status: 'four-target-install-verified' };
  saveEvidence(path.join(backup, 'success.json'), result);
  saveEvidence(path.join(root, 'migration-install-round9.json'), result);
  console.log(JSON.stringify({ status: result.status, backup, entries: entries.length, runtime_sha256: result.runtime_sha256 }));
} catch (error) {
  saveEvidence(path.join(backup, 'rollback-required.json'), { at: new Date().toISOString(), error: error.message });
  restore(backup, original); throw error;
}
