import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const r of j.rows) {
  if (!r.predicted.outcome.startsWith('fallback')) continue;
  console.log('\n==', r.file, r.predicted.outcome, JSON.stringify(r.predicted.errors));
  for (const c of r.candidates) console.log('   cand', JSON.stringify({ ...c, findings: c.findings?.length }));
}
console.log('\n== extra/missing-location findings');
for (const r of j.rows) for (const c of r.candidates) for (const f of c.findings ?? []) {
  if (f.extra.length || f.missing.includes('location')) console.log(r.file, f.id, JSON.stringify(f));
}
console.log('\n== enum values');
const vals = {};
for (const r of j.rows) for (const c of r.candidates.slice(0, 1)) for (const f of c.findings ?? []) for (const e of f.errors) {
  const m = /^\/(\w+) must be equal to one of the allowed values/.exec(e);
  if (m) (vals[m[1]] ??= new Set()).add(r.side);
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, [...v]]))));
