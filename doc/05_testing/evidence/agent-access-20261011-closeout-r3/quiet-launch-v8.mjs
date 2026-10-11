/** 13B批准摘要实现的14C补修：全摘要脱敏，选择/退出语义不变；旧v7保留。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { redactSecrets, scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';

export function assertQuietCommand(version, pool, label, args) {
  if (version !== 'v10' || !['review', 'admission'].includes(pool) || !/^[\w-]+$/.test(label ?? '') || args[0] !== 'tv')
    throw Error('摘要入口版本/池/标签/模式无效');
  const argv = args.slice(1);
  const single = flag => {
    const value = argv[argv.indexOf(flag) + 1];
    return argv.filter(x => x === flag).length === 1 && typeof value === 'string' && value !== '' && !value.startsWith('--');
  };
  if (argv[0] === 'topic' && argv[1] === 'claim' && single('--topic') && single('--stage') && single('--driver')) return;
  if (argv[0] === 'topic' && argv[1] === 'resolve' && single('--stage') && argv.filter(x => x === '--').length === 1) return;
  if (argv[0] === 'preflight' && single('--stage') && single('--driver') && single('--critics')) return;
  throw Error('摘要入口只允许topic claim、topic resolve或preflight；正式review直调launch-v10');
}

/** 真实main和回归共用本次证据选择，不按历史label枚举成功件。 */
export function selectCurrentEvidence(dir, current) {
  const { token, label, pool, startedAt, code, signal, launcherSha256 } = current;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token) ||
      !/^[\w-]+$/.test(label) || !['review', 'admission'].includes(pool) || !Number.isFinite(startedAt))
    throw Error('本次摘要坐标无效');
  const requested = path.join(dir, `${label}-${token}-requested.json`);
  const completed = path.join(dir, `${label}-${token}-completed.json`);
  const request = JSON.parse(fs.readFileSync(requested, 'utf8'));
  const record = JSON.parse(fs.readFileSync(completed, 'utf8'));
  const timestamp = Date.parse(request.requested_at);
  if (request.load_id !== token || request.label !== label || request.pool !== pool || request.mode !== 'tv' ||
      request.script_sha256 !== launcherSha256 || request.execution_sha256 !== launcherSha256 ||
      !/^[a-f0-9]{64}$/.test(launcherSha256 ?? '') || !Number.isFinite(timestamp) || timestamp < startedAt ||
      record.primary_loaded !== true || record.code !== code || record.signal !== signal)
    throw Error('本次调用证据缺失或错配');
  // completed继承整个invocation；任何请求字段漂移都不消费。
  for (const key of Object.keys(request)) if (JSON.stringify(record[key]) !== JSON.stringify(request[key]))
    throw Error('本次requested/completed字段不一致');
  return { file: completed, record };
}

/** 本层自身异常与子进程尾行同样经过既有脱敏规则，不新增规则或放宽扫描。 */
export function renderQuietSummary(summary) {
  const text = redactSecrets(JSON.stringify(summary)).content;
  if (scanSecrets(text).length) throw Error('摘要脱敏扫描未通过');
  return text;
}

async function main() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const [version, pool, label, ...args] = process.argv.slice(2);
  assertQuietCommand(version, pool, label, args); // token、预算、spawn之前拒绝。
  const token = crypto.randomUUID(), startedAt = Date.now();
  const launcher = path.join(root, 'launch-v10.mjs');
  const launcherSha256 = crypto.createHash('sha256').update(fs.readFileSync(launcher)).digest('hex');
  const child = spawn(process.execPath, [launcher, pool, label, ...args], {
    env: { ...process.env, TRIVIUM_ACCESS_REQUEST_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  child.once('error', e => { stderr += `quiet-launch:${e.code ?? 'unknown'}\n`; });
  const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
  const dir = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3/calls');
  let selected = null, validationError = null;
  try { selected = selectCurrentEvidence(dir, { token, label, pool, startedAt, code, signal, launcherSha256 }); }
  catch (error) { validationError = error.code ?? 'evidence-mismatch'; }
  let result = null; try { result = JSON.parse(selected?.record.stdout); } catch { /* 完整输出在本次原件。 */ }
  console.log(renderQuietSummary({ label, load_id: token, code, signal, evidence: selected?.file ?? null,
    validated: selected !== null, validation_error: validationError, ok: selected ? result?.ok ?? null : false,
    blockers: result?.blockers ?? null, stderr_summary: stderr.split('\n').slice(-3).join('\n') }));
  // 真实非零码优先保留；child=0也不能将证据失败算成功。
  process.exitCode = selected ? code ?? 1 : code !== null && code !== 0 ? code : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch { console.error('摘要入口参数或运行条件无效'); process.exitCode = 1; }
}
