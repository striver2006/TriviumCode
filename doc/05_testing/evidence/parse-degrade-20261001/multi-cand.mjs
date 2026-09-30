import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let multi = 0;
for (const r of j.rows) {
  const rootOk = r.candidates.filter((c) => c.root === 'ok');
  if (rootOk.length > 1) {
    multi++;
    const sets = rootOk.map((c) => c.findings.map((f) => f.id).join(','));
    console.log(r.file, r.predicted.outcome, rootOk.map((c) => `${c.from}:${c.predicted}:${c.findings.length}`).join(' | '), new Set(sets).size === 1 ? 'SAME-IDS' : 'DIFF-IDS');
  }
}
console.log('multi root-ok samples:', multi, 'of', j.rows.length);
