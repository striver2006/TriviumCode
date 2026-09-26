// 只读：统计历史结构化审查件 consulted 里带前导 ./ 的条目，以及 consulted 归一后 EV-127 新判据的读数变化。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const R = ['src', 'lib', 'app', 'test', 'tests', 'doc', 'docs', 'packages', 'scripts'].join('|');
const NEW = new RegExp(`(?<![A-Za-z0-9_./-])(?:\\.\\/)*((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g');
const strip = (p) => p.replace(/^(?:\.\/)+/, '');
const files = execFileSync('find', ['.reviews', '-path', '*/_meta/review-*.json'], { cwd: repo, encoding: 'utf8' })
  .split('\n').filter(Boolean).sort();
let dotEntries = 0; let reviewsWithDot = 0;
let flaggedA = 0; let missA = 0; let flaggedB = 0; let missB = 0;
const changed = [];
for (const f of files) {
  if (f.includes('/留痕字段与误报小修/')) continue;
  const r = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8'));
  if (!r || !Array.isArray(r.findings)) continue;
  const c = r.consulted ?? [];
  const d = c.filter((x) => x.startsWith('./')).length;
  dotEntries += d; if (d) reviewsWithDot++;
  const A = new Set(c); const B = new Set(c.map(strip));
  const mA = new Set(); const mB = new Set();
  for (const fd of r.findings) for (const m of String(fd.evidence ?? '').matchAll(NEW)) {
    if (!A.has(m[1])) mA.add(m[1]);
    if (!B.has(m[1])) mB.add(m[1]);
  }
  if (mA.size) flaggedA++; if (mB.size) flaggedB++; missA += mA.size; missB += mB.size;
  for (const p of mA) if (!mB.has(p)) changed.push(`${p} @ ${f}`);
}
console.log(JSON.stringify({ dotEntries, reviewsWithDot, before: { flagged: flaggedA, missing: missA }, afterNormalize: { flagged: flaggedB, missing: missB }, changed }, null, 2));
