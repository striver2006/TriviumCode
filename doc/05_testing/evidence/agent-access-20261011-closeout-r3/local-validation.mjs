/** 本轮本地验证：保存完整脱敏输出；不启动厂商模型CLI，正式审查仍经launch。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../../..');
const [mode, label] = process.argv.slice(2);
if (!['check', 'build', 'selftest'].includes(mode) || !/^[\w-]+$/.test(label ?? '')) throw Error('本地验证模式/标签无效');
const target = mode === 'selftest' ? process.execPath : 'npm';
const args = mode === 'selftest' ? ['skills/dual-critic/scripts/trivium.cjs', 'doctor', '--selftest'] : ['run', mode];
const env = { ...process.env };
if (mode === 'selftest') env.TRIVIUM_ASSET_ROOT = path.join(repo, 'skills/dual-critic');
const started = new Date().toISOString();
const child = spawn(target, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
child.once('error', error => { stderr += `local-validation:${error.code ?? 'unknown'}\n`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const record = { mode, label, target, args, started_at: started, finished_at: new Date().toISOString(), code, signal,
  runner_sha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), stdout, stderr,
  source_stamp: await computeBuildStamp(repo), bundle_sha256: digest(fs.readFileSync(path.join(repo, 'skills/dual-critic/scripts/trivium.cjs'))),
  real_admission_cli_starts: 0 };
saveEvidence(path.join(root, `${label}.json`), record);
process.stdout.write(JSON.stringify({ mode, label, code, signal, stdout_tail: stdout.split('\n').slice(-14).join('\n'),
  stderr_tail: stderr.split('\n').slice(-5).join('\n'), bundle_sha256: record.bundle_sha256 }) + '\n');
process.exitCode = code ?? 1;
