import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const seen = new Set();
for (const r of j.rows) {
  const k = r.file.split('/_meta')[0] + ' ' + r.run;
  const line = [r.side, r.predicted.outcome, `q${r.predicted.qualified ?? '-'}d${r.predicted.degraded ?? '-'}`,
    (r.predicted.strippedEcho ?? []).join(','), `esc${r.predicted.escapesRepaired ?? 0}`, JSON.stringify(r.parser.cause ?? r.parser.ok)].join(' ');
  if (!seen.has(k)) {
    seen.add(k);
    console.log(`\n${r.gate.ok ?? r.gate.error} ${k} ${JSON.stringify(r.gate.failures?.map((f) => f.code + ':' + f.ids.slice(0, 5).join(',')))}`);
  }
  console.log('   ' + line);
}
