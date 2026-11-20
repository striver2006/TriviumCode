// 可控厂商子进程的工作进程探针。每次写完就读回文件，仅保存是否命中和次数。
if (process.argv.includes('--worker') && process.env.TRIVIUM_E1_FIXTURE) {
  const fs = require('node:fs');
  const path = require('node:path');
  const secret = ['sk-', 'unitFixture0123456789', 'abcdefghijk'].join('');
  const audit = {};
  const open = fs.promises.open.bind(fs.promises);
  fs.promises.open = async (p, ...args) => {
    const fh = await open(p, ...args);
    if (args[0] !== 'wx' || !/[/\\]out[/\\]stdout\.jsonl?$/.test(String(p))) return fh;
    const side = path.basename(path.dirname(path.dirname(p)));
    const rec = audit[side] = { writes: 0, leaked: false };
    const write = fh.write.bind(fh);
    fh.write = async (...args) => {
      const result = await write(...args);
      const data = await fs.promises.readFile(p, 'utf8');
      rec.leaked ||= data.includes(secret);
      rec.writes++;
      return result;
    };
    return fh;
  };
  process.on('exit', () => fs.writeFileSync(path.join(process.env.TRIVIUM_E1_FIXTURE, 'disk-audit.json'), JSON.stringify(audit)));
}
