// 真正的审查子进程 stdout 计时，仅保存字节数、时间和进程号，不保存参数或内容。
if (process.argv.includes('--worker') && process.env.TRIVIUM_E1_TIMING_DIR) {
  const cp = require('node:child_process');
  const path = require('node:path');
  const fs = require('node:fs');
  const spawn = cp.spawn;
  cp.spawn = function(bin, args, options) {
    const child = spawn.apply(this, arguments);
    if (options?.detached && child.stdout && child.pid) {
      const f = path.join(process.env.TRIVIUM_E1_TIMING_DIR, child.pid + '.json');
      const s = { pid: child.pid, bin: path.basename(bin), started: Date.now(), first: null, last: null,
        chunks: 0, bytes: 0, exitAt: null, closedAt: null };
      const emit = child.stdout.emit;
      child.stdout.emit = function(name, chunk) {
        if (name === 'data') {
          s.first ??= Date.now();
          s.last = Date.now(); s.chunks++; s.bytes += Buffer.byteLength(chunk);
        }
        return emit.apply(this, arguments);
      };
      child.once('spawn', () => fs.writeFileSync(f, JSON.stringify(s)));
      child.once('exit', (code, signal) => { s.exitAt = Date.now(); s.code = code; s.signal = signal; });
      child.once('close', () => { s.closedAt = Date.now(); fs.writeFileSync(f, JSON.stringify(s)); });
    }
    return child;
  };
}
