/** Bob明确授权的本次七入口迁移；备份校验、正常安装、拒绝覆盖恢复。 */
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
const batch = JSON.parse(fs.readFileSync(path.join(root, 'batch-a.json')));
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline.json')));
const bundle = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const stamp = await computeBuildStamp(repo);
if (stamp.dirty || stamp.git_head !== batch.source_stamp.git_head || stamp.inputs_sha256 !== batch.source_stamp.inputs_sha256) throw Error('生产输入变化');
for (const [file, digest] of Object.entries(batch.files)) if (exists(file) ? sha(file) !== digest : digest !== null) throw Error('冻结指纹变化');
for (const item of baseline.shared_entry_reappearance) if (sha(path.join(shared,item.name,'SKILL.md')) !== item.sha256 || fs.lstatSync(path.join(shared,item.name)).isSymbolicLink()) throw Error('共享入口变化');
const unrelatedSharedRuntime = inventory(path.join(shared,'dual-critic'));
const { build } = await import('esbuild');
const rebuilt = await build({ platform:'node', target:'node18', logLevel:'silent', charset:'utf8', entryPoints:[path.join(repo,'src/install.ts')], outfile:path.join(repo,'dist/install.cjs'), bundle:true, format:'cjs', banner:{js:'#!/usr/bin/env node'}, write:false });
const rebuiltSha = crypto.createHash('sha256').update(rebuilt.outputFiles[0].contents).digest('hex');
if (rebuiltSha !== sha(path.join(repo,'dist/install.cjs'))) throw Error('安装器与当前源码不符');
const original = Object.fromEntries(names.map(n => [n, inventory(path.join(shared, n))]));
const rootModes = Object.fromEntries(names.map(n => [n, fs.lstatSync(path.join(shared, n)).mode & 0o7777]));
const backup = path.join(backupParent, `trivium-shared-direct-20261012-${Date.now()}-${crypto.randomUUID()}`);
fs.mkdirSync(backup); fs.mkdirSync(path.join(backup, 'copied')); fs.mkdirSync(path.join(backup, 'moved'));
const globalFiles = ['.codex/config.toml', '.codex/auth.json', '.codex/hooks.json', '.claude/settings.json'];
const globalsBefore = Object.fromEntries(globalFiles.map(n => [n, exists(path.join(os.homedir(), n)) ? sha(path.join(os.homedir(), n)) : null]));
saveEvidence(path.join(backup, 'started.json'), { at: new Date().toISOString(), original, rootModes, globalsBefore,
  authority: 'Bob明确答复：授权迁移七个入口并验证四目标安装；本轮免双审，不记正式审批',
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
  for (const name of names) { equal(inventory(path.join(shared,name)), original[name], '移动前'+name); if(exists(path.join(backup,'moved',name))) throw Error('目标已存在'); fs.renameSync(path.join(shared, name), path.join(backup, 'moved', name)); }
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
  equal(unrelatedSharedRuntime, inventory(path.join(shared,'dual-critic')), '不在迁移范围的共享核心');
  for(const name of names) for(const side of ['copied','moved']) { equal(inventory(path.join(backup,side,name)), original[name], '安装后备份'+name); if((fs.lstatSync(path.join(backup,side,name)).mode & 0o7777)!==rootModes[name]) throw Error('备份根权限变化'); }
  for(const [file,digest] of Object.entries(batch.files)) if(exists(file) ? sha(file)!==digest : digest!==null) throw Error('安装使准入指纹变化');
  const result = { at: new Date().toISOString(), backup, targets: selected, entries, runtime_root: plan.runtimeRoot,
    runtime_sha256: sha(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')), source_sha256: sha(bundle),
    build_stamp: await computeBuildStamp(repo), shared_names_absent: names.every(n => !exists(path.join(shared, n))),
    globalsBefore, globalsAfter, client_name_resolution: null, other_repositories_dependency_complete:null, admission_fingerprints_unchanged:true, installer_rebuilt_in_memory_sha256:rebuiltSha, status: 'four-target-install-verified' };
  saveEvidence(path.join(backup, 'success.json'), result);
  saveEvidence(path.join(root, 'migration-install.json'), result);
  console.log(JSON.stringify({ status: result.status, backup, entries: entries.length, runtime_sha256: result.runtime_sha256 }));
} catch (error) {
  saveEvidence(path.join(backup, 'rollback-required.json'), { at: new Date().toISOString(), error: error.message });
  restore(backup, original); throw error;
}
