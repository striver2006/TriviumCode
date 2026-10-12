/** 获批作用面的检查/构建/桩，输出脱敏扫描落盘；不启动厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { computeBuildStamp } from 'file:///Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/build-stamp.js';
import { saveEvidence } from 'file:///Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const repo = process.cwd(), root = path.dirname(new URL(import.meta.url).pathname);
const [label, command, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '') || !['npm', 'node', '.trivium/bin/trivium'].includes(command)) throw Error('检查调用未列入本批');
const target = command === '.trivium/bin/trivium' ? path.join(repo, command) : command === 'node' ? process.execPath : command;
const before = await computeBuildStamp(repo), started = new Date().toISOString();
const bundle = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const hashBundle = () => crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex');
const bundleBefore = hashBundle();
const child = spawn(target, args, { cwd: repo, env: { ...process.env, TRIVIUM_ASSET_ROOT: undefined }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
child.once('error', e => { stderr += 'validation:' + (e.code ?? 'unknown') + '\n'; });
const [code, signal] = await new Promise(resolve => child.once('close', (...r) => resolve(r)));
const after = await computeBuildStamp(repo);
const record = { started_at: started, finished_at: new Date().toISOString(), label, command, args, code, signal,
  stdout, stderr, inputs_before: before, inputs_after: after, same_inputs: before.inputs_sha256 === after.inputs_sha256,
  source_bundle_before: bundleBefore, source_bundle_after: hashBundle(),
  script_sha256: crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'), vendor_cli_starts: 0 };
saveEvidence(path.join(root, label + '.json'), record);
if (!record.same_inputs) throw Error('检查中作用面输入变化');
console.log(JSON.stringify({ label, code, signal, same_inputs: record.same_inputs, inputs: after.inputs_sha256,
  stdout_tail: stdout.split('\n').slice(-10).join('\n'), stderr_tail: stderr.split('\n').slice(-3).join('\n') }));
process.exitCode = code ?? 1;
