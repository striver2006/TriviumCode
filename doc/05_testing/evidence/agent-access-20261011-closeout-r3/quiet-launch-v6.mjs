/** v6摘要入口只委托launch-v8.mjs的claim/resolve/preflight；正式review须直接v8并读取完整输出。v5及旧件原样保留。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function assertQuietCommand(version, pool, label, args) {
  if (version !== 'v8' || !['review', 'admission'].includes(pool) || !/^[\w-]+$/.test(label ?? '') || args[0] !== 'tv')
    throw Error('摘要入口版本/池/标签/模式无效');
  const argv = args.slice(1);
  const single = flag => argv.filter(x => x === flag).length === 1 &&
    argv[argv.indexOf(flag) + 1] !== undefined && argv[argv.indexOf(flag) + 1] !== '';
  if (argv[0] === 'topic' && argv[1] === 'claim' && single('--topic') && single('--stage') && single('--driver')) return;
  if (argv[0] === 'topic' && argv[1] === 'resolve' && single('--stage') && argv.filter(x => x === '--').length === 1) return;
  if (argv[0] === 'preflight' && single('--stage') && single('--driver') && single('--critics')) return;
  throw Error('摘要入口只允许topic claim、topic resolve或preflight；正式review直调launch-v8');
}

async function main() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const [version, pool, label, ...args] = process.argv.slice(2);
  assertQuietCommand(version, pool, label, args); // 预算读取和子进程启动之前拒绝。
  const child = spawn(process.execPath, [path.join(root, 'launch-v8.mjs'), pool, label, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  child.once('error', e => { stderr += `quiet-launch:${e.code ?? 'unknown'}\n`; });
  const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
  const dir = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3/calls');
  const records = fs.readdirSync(dir).filter(n => n.startsWith(`${label}-`) && n.endsWith('-completed.json'));
  if (records.length !== 1) throw Error('实际调用证据缺失或不唯一，拒绝选择旧成功');
  const file = path.join(dir, records[0]), record = JSON.parse(fs.readFileSync(file));
  let result = null; try { result = JSON.parse(record.stdout); } catch { /* 完整输出仍在调用原件中。 */ }
  console.log(JSON.stringify({ label, code, signal, evidence: file, ok: result?.ok ?? null,
    blockers: result?.blockers ?? null, stderr_summary: stderr.split('\n').slice(-3).join('\n') }));
  process.exitCode = code ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
