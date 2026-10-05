// 只读：按创建时间统计系统临时目录里 trivium- / tv- 开头的新建条目，按前缀分组
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const since = Date.parse(process.argv[2]);
const until = process.argv[3] ? Date.parse(process.argv[3]) : Infinity;
const dir = os.tmpdir();
const names = fs.readdirSync(dir).filter((n) => n.startsWith('trivium-') || n.startsWith('tv-'));
const groups = new Map();
let total = 0, all = names.length;
for (const n of names) {
  let st;
  try { st = fs.lstatSync(path.join(dir, n)); } catch { continue; }
  const t = st.birthtimeMs;
  if (t < since || t >= until) continue;
  total++;
  const prefix = n.length > 6 ? n.slice(0, -6) : n;
  groups.set(prefix, (groups.get(prefix) ?? 0) + 1);
}
const rows = [...groups].sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({ tmpdir: dir, all, since: process.argv[2], total, prefixes: rows.length }));
for (const [p, c] of rows) console.log(`${c}\t${p}`);
