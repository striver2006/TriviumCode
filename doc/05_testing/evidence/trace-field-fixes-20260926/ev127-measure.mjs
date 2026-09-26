// EV-127 只读实测：拿本仓全部历史结构化审查件，比较新旧 evidence 路径判据的差异。
// 只读：不写任何仓库文件，结果打到 stdout。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] ?? process.cwd();
const ROOTS = ['src', 'lib', 'app', 'test', 'tests', 'doc', 'docs', 'packages', 'scripts'];
const R = ROOTS.join('|');

const variants = {
  // 现行（parse.ts :225）
  OLD: (ev) => all(ev, new RegExp(`\\b((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g')),
  // 候选 ①a：前界「非路径字符」，与 findSwallowedFlags 同形（不含 . 与 /）
  A1: (ev) => all(ev, new RegExp(`(?<![A-Za-z0-9_-])((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g')),
  // 候选 ①b：前界把 . 与 / 也算路径字符
  A2: (ev) => all(ev, new RegExp(`(?<![A-Za-z0-9_./-])((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g')),
  // 候选 ②：先切完整路径 token，去掉前导 ./，首段整段等于已知根才收
  B: (ev) => {
    const out = [];
    for (const m of ev.matchAll(/[A-Za-z0-9_./-]+/g)) {
      let t = m[0].replace(/^(?:\.\/)+/, '');
      const mm = new RegExp(`^((?:${R})\\/[A-Za-z0-9_./-]*?\\.[A-Za-z0-9]+)(?![A-Za-z0-9])`).exec(t);
      if (!mm) continue;
      // 与现行同口径取「到最后一个扩展名为止」：贪婪版
      const g = new RegExp(`^((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)(?![A-Za-z0-9])`).exec(t);
      out.push(g ? g[1] : mm[1]);
    }
    return out;
  },
};

function all(ev, re) {
  const out = [];
  let m;
  while ((m = re.exec(ev)) !== null) out.push(m[1]);
  return out;
}

const files = execFileSync('find', ['.reviews', '-path', '*/_meta/review-*.json'], { cwd: repo, encoding: 'utf8' })
  .split('\n').filter(Boolean).sort();

const exists = (p) => fs.existsSync(path.join(repo, p));
const stats = {};
for (const k of Object.keys(variants)) stats[k] = { flaggedReviews: 0, missing: 0, missingNonexistent: 0 };
const diffs = [];
let parsed = 0, skipped = 0, findingsTotal = 0;

for (const f of files) {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8')); } catch { skipped++; continue; }
  if (!r || !Array.isArray(r.findings)) { skipped++; continue; }
  parsed++;
  findingsTotal += r.findings.length;
  const consulted = new Set(r.consulted ?? []);
  const per = {};
  for (const [k, fn] of Object.entries(variants)) {
    const miss = new Set();
    for (const fd of r.findings) for (const p of fn(String(fd.evidence ?? ''))) if (!consulted.has(p)) miss.add(p);
    per[k] = miss;
    if (miss.size > 0) stats[k].flaggedReviews++;
    stats[k].missing += miss.size;
    for (const p of miss) if (!exists(p)) stats[k].missingNonexistent++;
  }
  for (const k of ['A1', 'A2', 'B']) {
    const removed = [...per.OLD].filter((p) => !per[k].has(p));
    const added = [...per[k]].filter((p) => !per.OLD.has(p));
    if (removed.length || added.length) diffs.push({ file: f, variant: k, removed, added });
  }
}

console.log(JSON.stringify({ files: files.length, parsed, skipped, findingsTotal, stats }, null, 2));
// 按候选汇总差异
for (const k of ['A1', 'A2', 'B']) {
  const ds = diffs.filter((d) => d.variant === k);
  const removed = ds.flatMap((d) => d.removed.map((p) => ({ f: d.file, p })));
  const added = ds.flatMap((d) => d.added.map((p) => ({ f: d.file, p })));
  console.log(`\n== ${k}: 旧判据报、新判据不报 ${removed.length} 条；新判据新报 ${added.length} 条`);
  for (const x of removed) console.log(`  - ${x.p}${exists(x.p) ? '' : '  [仓内不存在]'}  @ ${x.f}`);
  for (const x of added) console.log(`  + ${x.p}${exists(x.p) ? '' : '  [仓内不存在]'}  @ ${x.f}`);
}
