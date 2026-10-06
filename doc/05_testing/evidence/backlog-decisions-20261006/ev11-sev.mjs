// 只读：逐条降级旁路文件里，被降级意见的原始 severity 分布与成因组合（EV-11 论证用）
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '.' + 'reviews';
const out = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.degraded\.json$/.test(e.name)) out.push(p); } };
walk(ROOT);
const sev = {}; const why = {};
for (const f of out) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const it of j.findings ?? []) {
    const s = it.raw?.severity ?? '（无）'; sev[s] = (sev[s] ?? 0) + 1;
    const k = (it.problems ?? []).map((p) => `${p.field}:${p.kind}`).sort().join('+'); why[k] = (why[k] ?? 0) + 1;
  }
}
console.log(JSON.stringify({ files: out.length, sev, why }, null, 1));
