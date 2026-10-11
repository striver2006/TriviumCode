/** 已迁移后的正常四目标重装；不再次移动共享入口，不碰用户模型/凭据配置。 */
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
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for (const n of ['check1-r12-rootfix', 'check2-r12-rootfix', 'final-build-r12-rootfix', 'selftest-r12-rootfix']) {
  if (JSON.parse(fs.readFileSync(path.join(root, `${n}.json`))).code !== 0) throw Error(`前置验证未通过：${n}`);
}
const migration = JSON.parse(fs.readFileSync(path.join(root, 'migration-install-r12.json')));
const observed = JSON.parse(fs.readFileSync(path.join(root, 'global-config-observation-r12.json')));
const before = Object.fromEntries(Object.keys(migration.globalsAfter).map(n => [n, hash(path.join(os.homedir(), n))]));
if (JSON.stringify(before) !== JSON.stringify(observed.globals_current)) throw Error('当前已审计配置再次变化，拒绝猜测安装面');
const bundle = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const build = JSON.parse(fs.readFileSync(path.join(root, 'final-build-r12-rootfix.json'))), stamp = await computeBuildStamp(repo);
if (build.bundle_sha256 !== hash(bundle) || build.source_stamp.inputs_sha256 !== stamp.inputs_sha256) throw Error('最终构建不符');
const env = { ...process.env }; delete env.TRIVIUM_ASSET_ROOT;
const plan = await planInstall(repo, { ...defaultInstallEnv(), env });
const targets = plan.targets.map(t => t.agent);
if (targets.length !== 4 || plan.targets.some(t => t.sources.length !== 7)) throw Error('四目标28入口不符');
const child = spawn(process.execPath, ['dist/install.cjs', '--targets', targets.join(',')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
child.once('error', e => { stderr += `installer:${e.code ?? 'unknown'}\n`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...v) => resolve(v)));
const after = Object.fromEntries(Object.keys(before).map(n => [n, hash(path.join(os.homedir(), n))]));
const entries = plan.targets.flatMap(t => t.sources.map(s => ({ agent: t.agent, name: s.name, source: hash(path.join(s.src, 'SKILL.md')),
  installed: hash(path.join(t.skillsRoot, s.name, 'SKILL.md')) })));
const matched = code === 0 && !signal && hash(bundle) === hash(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')) &&
  entries.every(e => e.source === e.installed) && JSON.stringify(before) === JSON.stringify(after);
saveEvidence(path.join(root, 'install-rootfix-r12.json'), { at: new Date().toISOString(), code, signal, stdout, stderr,
  targets, entries, before, after, source_sha256: hash(bundle), installed_sha256: hash(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')),
  matched, stamp, migration_backup_preserved: migration.backup, shared_entries_moved_again: false, model_configs_changed: false });
if (!matched) throw Error('正常四目标重装核验失败');
console.log(JSON.stringify({ matched, targets, entries: entries.length, bundle_sha256: hash(bundle), inputs: stamp.inputs_sha256 }));
