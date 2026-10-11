/** 保持正式launch及原始证据，仅减少控制台大JSON；每个label必须恰一真实调用。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const [version, pool, label, ...args] = process.argv.slice(2);
if (!['v5'].includes(version) || !/^[\w-]+$/.test(label ?? '')) throw Error('入口版本/标签无效');
const child = spawn(process.execPath, [path.join(root, `launch-${version}.mjs`), pool, label, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = ''; child.stderr.on('data', b => { stderr += b; });
child.once('error', e => { stderr += `quiet-launch:${e.code ?? 'unknown'}\n`; });
const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
const dir = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3/calls');
const records = fs.readdirSync(dir).filter(n => n.startsWith(`${label}-`) && n.endsWith('-completed.json'));
if (records.length !== 1) throw Error('实际调用证据缺失或不唯一，拒绝选择旧成功');
const file = path.join(dir, records[0]), record = JSON.parse(fs.readFileSync(file));
let result = null; try { result = JSON.parse(record.stdout); } catch { /* 原始输出完整保留，由正式调用退出码判定。 */ }
const profiles = Object.fromEntries(Object.entries(result?.probe?.cli?.claude?.routes ?? {}).map(([key, value]) => [key,
  { version: value.probe.version, shape: value.probe.directory_deny_shape, verified: value.probe.directory_deny_verified }]));
console.log(JSON.stringify({ label, code, signal, evidence: file, ok: result?.ok ?? null, profiles,
  failure: result?.directoryEvidence?.failure ?? null, blockers: result?.blockers ?? null,
  stderr_summary: stderr.split('\n').slice(-3).join('\n') }));
process.exitCode = code ?? 1;
