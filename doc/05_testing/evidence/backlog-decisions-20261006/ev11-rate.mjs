// 只读：起始 run_id 之后的运行数、各侧侧次与逐条降级意见数（取 run.json critics[侧].findings_degraded）（EV-11 论证用）
// 用法（在仓库根）：node doc/05_testing/evidence/backlog-decisions-20261006/ev11-rate.mjs 〈起始 run_id〉
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '.' + 'reviews';
const since = process.argv[2] ?? '20261001T103637Z';
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/^run-\d{8}T\d{6}Z\.json$/.test(e.name)) files.push(p);
  }
};
walk(ROOT);
const per = {};
let runs = 0;
for (const f of files) {
  const id = /run-(\d{8}T\d{6}Z)\.json$/.exec(f)[1];
  if (id < since) continue;
  let m;
  try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  if (!m.critics) continue; // verify 阶段的另一份 schema 没有 critics
  runs++;
  for (const [side, c] of Object.entries(m.critics)) {
    per[side] = per[side] ?? { sides: 0, degraded: 0 };
    per[side].sides++;
    per[side].degraded += Array.isArray(c.findings_degraded) ? c.findings_degraded.length : 0;
  }
}
console.log(JSON.stringify({ since, runs, per }, null, 1));
