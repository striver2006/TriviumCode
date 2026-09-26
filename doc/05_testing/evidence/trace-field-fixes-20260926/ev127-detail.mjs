// EV-127 只读实测第二段：对旧判据报、候选 B 不报的每一条，找出它所在的完整路径 token，
// 看完整 token 是否在 consulted 里（= 纯误报），或不在（= 新判据下这一条不再被检查，漏报方向）。
// 另列候选 B 下仍报、且仓内不存在的路径（剩余告警的构成）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] ?? process.cwd();
const R = ['src', 'lib', 'app', 'test', 'tests', 'doc', 'docs', 'packages', 'scripts'].join('|');
const OLD = new RegExp(`\\b((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g');
const B = (ev) => {
  const out = [];
  for (const m of ev.matchAll(/[A-Za-z0-9_./-]+/g)) {
    const t = m[0].replace(/^(?:\.\/)+/, '');
    const g = new RegExp(`^((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)(?![A-Za-z0-9])`).exec(t);
    if (g) out.push(g[1]);
  }
  return out;
};
const A2 = new RegExp(`(?<![A-Za-z0-9_./-])((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g');
const all = (ev, re) => { re.lastIndex = 0; const o = []; let m; while ((m = re.exec(ev))) o.push({ p: m[1], i: m.index }); return o; };

const files = execFileSync('find', ['.reviews', '-path', '*/_meta/review-*.json'], { cwd: repo, encoding: 'utf8' })
  .split('\n').filter(Boolean).sort();
const exists = (p) => fs.existsSync(path.join(repo, p));
const cats = { fullInConsulted: [], fullNotInConsulted: [] };
const remainingNonexistent = [];
const a2vsB = [];
for (const f of files) {
  let r; try { r = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8')); } catch { continue; }
  if (!r || !Array.isArray(r.findings)) continue;
  const consulted = new Set(r.consulted ?? []);
  const seen = new Set();
  for (const fd of r.findings) {
    const ev = String(fd.evidence ?? '');
    const bset = new Set(B(ev));
    const a2set = new Set(all(ev, A2).map((x) => x.p));
    for (const { p, i } of all(ev, OLD)) {
      if (consulted.has(p) || bset.has(p)) continue;
      const key = `${p}@${f}`; if (seen.has(key)) continue; seen.add(key);
      // 取所在完整 token
      let s = i; while (s > 0 && /[A-Za-z0-9_./~-]/.test(ev[s - 1])) s--;
      const full = ev.slice(s, i + p.length).replace(/^(?:\.\/)+/, '');
      const inC = consulted.has(full) || [...consulted].some((c) => c.endsWith(full) || full.endsWith(c));
      (inC ? cats.fullInConsulted : cats.fullNotInConsulted).push({ p, full, f });
    }
    for (const p of bset) if (!consulted.has(p) && !exists(p)) remainingNonexistent.push({ p, f });
    for (const p of bset) if (!a2set.has(p) && !consulted.has(p)) {
      const i = ev.indexOf(p); a2vsB.push({ p, f, ctx: ev.slice(Math.max(0, i - 30), i + p.length + 10) });
    }
  }
}
console.log(`旧报 / B 不报：完整 token 在 consulted 里（纯误报）${cats.fullInConsulted.length} 条`);
for (const x of cats.fullInConsulted) console.log(`  ${x.p}  <=  ${x.full}`);
console.log(`\n旧报 / B 不报：完整 token 不在 consulted 里（新判据下不再检查）${cats.fullNotInConsulted.length} 条`);
for (const x of cats.fullNotInConsulted) console.log(`  ${x.p}  <=  ${x.full}   @ ${x.f.split('/')[1]}`);
console.log(`\nA2 不报、B 报：${a2vsB.length} 条`);
for (const x of a2vsB) console.log(`  ${x.p}  ctx=「${x.ctx}」 @ ${x.f}`);
const uniq = [...new Map(remainingNonexistent.map((x) => [x.p + x.f, x])).values()];
console.log(`\nB 下仍报且仓内不存在：${uniq.length} 条`);
for (const x of uniq) console.log(`  ${x.p}   @ ${x.f.split('/')[1]}`);
