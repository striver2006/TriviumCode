/** 安装副本的14步桩自检，输出脱敏留痕；不启动厂商模型CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(root, '../../../..');
const env = { ...process.env }; delete env.TRIVIUM_ASSET_ROOT;
const target = path.join(repo, '.trivium/bin/trivium'), args = ['doctor', '--selftest'];
const started = new Date().toISOString();
const child = spawn(target, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
child.once('error', error => { stderr += `installed-selftest:${error.code ?? 'unknown'}\n`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const installed = path.join(process.env.HOME, '.claude/skills/dual-critic/scripts/trivium.cjs');
const source = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const record = { at: started, finished_at: new Date().toISOString(), target, args, code, signal, stdout, stderr,
  installed_sha256: sha(installed), source_sha256: sha(source), script_sha256: sha(fileURLToPath(import.meta.url)), cli_vendor_starts: 0 };
saveEvidence(path.join(root, 'installed-selftest-r18.json'), record);
if (record.installed_sha256 !== record.source_sha256) throw Error('安装副本与源码bundle不一致');
console.log(JSON.stringify({ code, signal, installed_sha256: record.installed_sha256,
  stdout_tail: stdout.split('\n').slice(-9).join('\n'), stderr_tail: stderr.split('\n').slice(-5).join('\n') }));
process.exitCode = code ?? 1;
