// 预算侧车：仅供本次验收的Node子进程。跨进程O_EXCL预占，不改全局配置。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const root = __dirname;
const originalSpawn = cp.spawn;
const selfHash = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const pool = process.env.TRIVIUM_ACCESS_BUDGET_POOL;
if (!['admission', 'review'].includes(pool)) throw Error('预算池缺失或无效');
const dir = path.join(root, 'ledger', pool);
fs.mkdirSync(dir, { recursive: true });
function hash(file) { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } }
function vendor(bin, args) {
  const name = path.basename(bin);
  if (['codex', 'cld', 'claude', 'agy', 'zcode'].includes(name)) return name;
  if (args.some(a => /(?:^|\/)zcode\.cjs$/.test(a))) return 'zcode';
  if (name === 'script') return args.find(a => /(?:^|\/)(codex|cld|claude|agy|zcode)$/.test(a))?.split('/').pop() ?? null;
  return null;
}
function limit() {
  const approval = JSON.parse(fs.readFileSync(path.join(root, 'approval.json')));
  return approval.initial_limits[pool] + fs.readdirSync(root).filter(n => /^extension-\d+\.json$/.test(n))
    .map(n => JSON.parse(fs.readFileSync(path.join(root, n))))
    .filter(x => x.pool === pool).reduce((n, x) => n + x.additional, 0);
}
cp.spawn = function (bin, args = [], options = {}) {
  const cli = vendor(bin, args);
  if (!cli) return originalSpawn.apply(this, arguments);
  const cap = limit();
  let index, reserved;
  for (let n = 1; n <= cap; n++) {
    const file = path.join(dir, `reserved-${String(n).padStart(4, '0')}.json`);
    // argv可能含提示词和内联配置：这里只保存旗标名及模型/profile白名单值。
    const selection = {};
    for (const flag of ['--model', '-m', '--profile', '-p', '--effort']) {
      const at = args.indexOf(flag);
      if (at >= 0 && /^[\w./:+-]+$/.test(args[at + 1] ?? '')) selection[flag] = args[at + 1];
    }
    const record = { index: n, pool, limit_at_start: cap, reserved_at: new Date().toISOString(),
      parent_pid: process.pid, script_sha256: selfHash, execution_script_sha256: process.env.TRIVIUM_ACCESS_SCRIPT_SHA256 ?? null,
      label: process.env.TRIVIUM_ACCESS_LABEL ?? null, cli, entry: bin, entry_sha256: hash(bin), selection,
      kind: args.includes('--version') || args.includes('version') ? 'version' : args.includes('--help') ? 'help' : 'model-or-probe',
      fingerprint_manifest: process.env.TRIVIUM_ACCESS_MANIFEST ?? null };
    try { fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); index = n; reserved = record; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (index === undefined) throw Error(`新增${pool}启动预算达到${cap}，拒绝spawn；保留台账后按已授权政策扩容`);
  const completed = path.join(dir, `launch-${String(index).padStart(4, '0')}.json`);
  const finish = extra => fs.writeFileSync(completed, JSON.stringify({ ...reserved, ...extra, completed_at: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  let child;
  try { child = originalSpawn.apply(this, arguments); }
  catch (e) { finish({ spawned: false, error_code: e.code ?? null }); throw e; }
  let spawned = false, errorCode = null;
  child.once('spawn', () => { spawned = true; });
  child.once('error', e => { errorCode = e.code ?? null; });
  child.once('close', (code, signal) => finish({ spawned, pid: child.pid ?? null, code, signal, error_code: errorCode }));
  return child;
};
syncBuiltinESMExports();
