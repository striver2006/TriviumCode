// 只读：扫 doc/05_testing/evidence 下 EV-217 修复提交之后新增的全量读数（check-*.txt），数总份数、K 格红的份数。
// 用法（在仓库根）：node doc/05_testing/evidence/k-cell-flake-triage-20261006/scan-k-cells.mjs 〈起始提交〉
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const since = process.argv[2];
const files = execFileSync('git', ['log', '--name-only', '--diff-filter=A', '--format=', `${since}..HEAD`, '--', 'doc/05_testing/evidence'], { encoding: 'utf8' })
  .split('\n').filter((f) => /\/check-[^/]*\.txt$/.test(f)).sort();
let total = 0, full = 0; const red = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  total++;
  if (!/ℹ tests \d{4}/.test(t)) continue; // 只算全量
  full++;
  const k = [...new Set([...t.matchAll(/^✖ (EV-176 K-[^\s：]+)/gm)].map((m) => m[1]))];
  const fail = /ℹ fail (\d+)/.exec(t)?.[1];
  if (k.length) red.push(`${f}: ${k.join(', ')}`);
  console.log(`${f}\tfail=${fail}\tK红=${k.length}`);
}
console.log(`\n共 ${total} 份 check 读数，其中全量 ${full} 份；K 格红 ${red.length} 份`);
for (const r of red) console.log('  ' + r);
