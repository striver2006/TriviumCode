// 只附加到隔离桩的 worker。把 stdout 文件系统调用的成功字节数与封口时间记在进程外。
if (process.argv.includes('--worker') && process.env.TRIVIUM_STUB_CRITIC && process.env.TRIVIUM_E1_METRICS) {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = process.env.TRIVIUM_E1_METRICS;
  const writes = [];
  const fault = fs.existsSync(path.join(dir, 'fault.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'fault.json'))) : {};
  const side = p => fault[path.basename(path.dirname(path.dirname(String(p))))];
  const diskError = () => Object.assign(new Error('夹具模拟磁盘写入失败'), { code: 'ENOSPC' });
  const record = (p, bytes) => writes.push({ at: Date.now(), file: String(p), bytes });
  const matches = p => /[/\\]out[/\\]stdout(?:\.jsonl?|[-]live\.json)(?:\.tmp-.*)?$/.test(String(p));
  const io = fs.promises;
  const open = io.open.bind(io);
  io.open = async (p, ...args) => {
    const fh = await open(p, ...args);
    if (matches(p)) {
      const write = fh.write.bind(fh);
      fh.write = async (...a) => {
        const mode = side(p);
        if (mode === 'permanent') throw diskError();
        if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1150));
        if (mode === 'short') a[2] = Math.min(a[2], 63);
        const r = await write(...a);
        record(p, r.bytesWritten);
        return r;
      };
    }
    return fh;
  };
  const writeFile = io.writeFile.bind(io);
  io.writeFile = async (p, bytes, ...args) => {
    if (side(p) === 'permanent' && path.basename(String(p)).startsWith('stdout.jsonl.tmp-')) throw diskError();
    const r = await writeFile(p, bytes, ...args);
    if (matches(p)) record(p, Buffer.byteLength(bytes));
    return r;
  };
  process.on('exit', () => fs.writeFileSync(path.join(dir, 'worker-' + process.pid + '.json'),
    JSON.stringify({ core: fs.realpathSync(process.argv[1]), usage: process.resourceUsage(), writes })));
}
