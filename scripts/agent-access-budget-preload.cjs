// 仅由任务统一调用器加载，向独立worker继承；无用户全局配置改动。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
const { openBudget, vendorOf, hashFile } = require('./agent-access-budget.cjs');
const root = process.env.TRIVIUM_ACCESS_BUDGET_ROOT;
const pool = process.env.TRIVIUM_ACCESS_BUDGET_POOL;
const token = process.env.TRIVIUM_ACCESS_LOAD_TOKEN;
if (!token || !/^[\w-]+$/.test(token)) throw Error('缺预算装载token，拒绝运行');
const budget = openBudget(root, pool);
budget.limit();
const loadedDir = path.join(root, 'loaded'); fs.mkdirSync(loadedDir, { recursive: true });
const loaded = { pid: process.pid, parent_pid: process.ppid, load_id: token, pool, label: process.env.TRIVIUM_ACCESS_LABEL ?? null,
  preload_sha256: hashFile(__filename), core_sha256: hashFile(path.join(__dirname, 'agent-access-budget.cjs')),
  loaded_at: new Date().toISOString() };
budget.write(path.join(loadedDir, `${token}-${process.pid}-${crypto.randomUUID()}.json`), loaded);
globalThis[Symbol.for('trivium.access.budget.loaded')] = loaded;
const originalSpawn = cp.spawn;
cp.spawn = function (bin, args = [], options = {}) {
  if (!Array.isArray(args)) { options = args ?? {}; args = []; }
  const cli = vendorOf(bin, args);
  if (!cli) return originalSpawn.apply(this, arguments);
  const selection = {};
  for (const flag of ['--model', '-m', '--profile', '-p', '--effort']) {
    const at = args.indexOf(flag);
    selection[flag] = at >= 0 && /^[\w./:+-]+$/.test(args[at + 1] ?? '') ? args[at + 1] : null;
  }
  const metadata = { parent_pid: process.pid, load_id: token, label: process.env.TRIVIUM_ACCESS_LABEL ?? null, cli,
    boundary_parent: process.env.TRIVIUM_ACCESS_VENDOR_BOUNDARY ?? null,
    entry: bin, entry_sha256: hashFile(bin), selection, preload_sha256: loaded.preload_sha256, core_sha256: loaded.core_sha256,
    execution_script_sha256: process.env.TRIVIUM_ACCESS_SCRIPT_SHA256 ?? null,
    fingerprint_manifest: process.env.TRIVIUM_ACCESS_MANIFEST ?? null,
    kind: args.includes('--version') || args.includes('version') ? 'version' : args.includes('--help') ? 'help' : 'model-or-probe' };
  const record = budget.reserve(metadata);
  let child;
  // 到原生审核者边界卸下Node侧车，避免模型自己的Node命令继承写台账动作。
  // Node包装器仍继承侧车，内部原生CLI启动继续计数。
  const childEnv = options.env === undefined ? { ...process.env } : { ...options.env };
  childEnv.TRIVIUM_ACCESS_VENDOR_BOUNDARY = `${cli}:${process.pid}:${record.index}`;
  if (!['node', 'nodejs', 'zcode', 'zcode.cjs', 'zcode.js'].includes(path.basename(bin)) && cli !== 'codex') delete childEnv.NODE_OPTIONS;
  try {
    if (cli === 'codex') {
      let fd;
      try { fd = fs.openSync(bin, 'r'); const bytes = Buffer.alloc(2); fs.readSync(fd, bytes, 0, 2, 0);
        if (!bytes.equals(Buffer.from('#!'))) delete childEnv.NODE_OPTIONS;
      } catch { /* spawn记录真实启动失败，不以探测读失败替代它 */ }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    child = originalSpawn.call(this, bin, args, { ...options, env: childEnv });
  }
  catch (e) { budget.complete(record, { spawned: false, error_code: e.code ?? null }); throw e; }
  let spawned = false, errorCode = null;
  child.once('spawn', () => { spawned = true; });
  child.once('error', e => { errorCode = e.code ?? null; });
  child.once('close', (code, signal) => budget.complete(record, { spawned, pid: child.pid ?? null, code, signal, error_code: errorCode }));
  return child;
};
// util/exec是唯一厂商通道。其它API的vendor形态拒绝，不能静默失账。
for (const name of ['execFile', 'execFileSync', 'spawnSync', 'fork']) {
  const original = cp[name];
  cp[name] = function (bin, args, ...rest) {
    if (vendorOf(bin, Array.isArray(args) ? args : [])) throw Error(`vendor旁路${name}被拒绝，请使用统一spawn通道`);
    return original.apply(this, arguments);
  };
}
for (const name of ['exec', 'execSync']) {
  const original = cp[name];
  cp[name] = function (command) {
    if (/(?:^|[\s/])(codex|claude|cld|agy|zcode)(?:\.(?:cjs|js))?(?:\s|$)/.test(command)) throw Error(`vendor旁路${name}被拒绝`);
    return original.apply(this, arguments);
  };
}
syncBuiltinESMExports();
