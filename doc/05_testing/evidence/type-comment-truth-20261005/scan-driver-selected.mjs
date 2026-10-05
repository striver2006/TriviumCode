// 只读：扫 .reviews 下全部 run 元数据，统计 run.v2 份数与 critics_selected / critics 键含 driver 的份数
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? '.reviews');
let v2 = 0, v1 = 0, other = 0;
const bad = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/^run-.*\.json$/.test(e.name)) {
      let j;
      try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { other++; continue; }
      if (j.schema === 'trivium.run.v2') {
        v2++;
        const sel = Array.isArray(j.critics_selected) ? j.critics_selected : [];
        if (sel.includes(j.driver) || Object.keys(j.critics ?? {}).includes(j.driver)) bad.push(path.relative(root, p));
      } else if (j.schema === 'trivium.run.v1') v1++;
      else other++;
    }
  }
}
walk(root);
console.log(JSON.stringify({ root, v2, v1, other, driverSelected: bad.length, bad }, null, 1));
