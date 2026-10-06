// 只读：列出逐条降级旁路文件里 field 不是 confidence 的每一条问题（EV-11 论证用）。用法（在仓库根）：node doc/05_testing/evidence/backlog-decisions-20261006/ev11-census2.mjs
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '.' + 'reviews';
const out = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.degraded\.json$/.test(e.name)) out.push(p); } };
walk(ROOT);
for (const f of out.sort()) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const it of j.findings ?? []) for (const pr of it.problems ?? []) if (pr.field !== 'confidence') console.log(path.basename(f), it.id ?? '', JSON.stringify(pr).slice(0, 220));
}
console.log('files', out.length);
