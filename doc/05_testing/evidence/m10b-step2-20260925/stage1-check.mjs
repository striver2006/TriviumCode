// M10b 第 2 步第一阶段：只抽单源、不改语义——渲染回 claude 载体须与现文件逐字节一致（r2 §3.1 / r5 §5.1）。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = process.argv[2];
const mod = await import(path.join(ROOT, 'dist/test/src/entry-render.js'));
const src = await mod.loadEntrySources(ROOT);
const top = src.carriers.find(function (c) { return c.layout === 'top'; });
const sha = function (s) { return createHash('sha256').update(s).digest('hex'); };
let bad = 0;
console.log(`HEAD ${process.argv[3]}  carrier=${top.agent}  contracts=${src.contracts.length}`);
for (const contract of src.contracts) {
  const r = mod.renderEntry(src, top, contract);
  const disk = readFileSync(path.join(ROOT, r.relPath), 'utf8');
  const same = disk === r.content;
  if (!same) bad++;
  console.log(`${same ? 'IDENTICAL' : 'DIFFERENT'}  ${r.relPath}  bytes=${Buffer.byteLength(disk)}  sha256=${sha(disk).slice(0, 16)} / rendered ${sha(r.content).slice(0, 16)}`);
  if (!same) {
    const a = disk.split('\n');
    const b = r.content.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`  first diff at line ${i + 1}\n  disk:     ${a[i]}\n  rendered: ${b[i]}`); break; }
    }
  }
}
console.log(bad === 0 ? 'RESULT: all identical' : `RESULT: ${bad} different`);
process.exitCode = bad === 0 ? 0 : 1;
