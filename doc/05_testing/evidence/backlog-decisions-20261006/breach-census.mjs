// 只读：①run.v2 schema 的 guard 段是否允许未知字段；②归档 plan / code / bug 三阶段每份 run.json 按契约读不读得出（走 readRunMetaDetailed，
// 与编排器同一判据）；③guard.readonly_breach 为 true 的运行（EV-75 ②、EV-148 剩余项论证用）。
// 用法（在仓库根，先 node scripts/build.mjs --with-tests）：node doc/05_testing/evidence/backlog-decisions-20261006/breach-census.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { readRunMetaDetailed, describeRunMetaCause } = await import(
  pathToFileURL(path.join(process.cwd(), 'dist/test/src/trivium/meta.js')).href
);
const schema = JSON.parse(fs.readFileSync('skills/dual-critic/schema/run.v2.json', 'utf8'));
const g = schema.properties.guard;
console.log('guard.additionalProperties =', JSON.stringify(g.additionalProperties), '；字段：', Object.keys(g.properties).join(', '));
const ROOT = '.' + 'reviews';
const archiveRoot = path.resolve(ROOT);
const hits = [];
const unreadable = [];
let n = 0;
for (const topic of fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  for (const stage of ['plan', 'code', 'bug']) { // verify 阶段是另一份 schema（trivium.verify-run.v1），不在 readRunMeta 论域
    const dir = path.join(ROOT, topic, stage, '_' + 'meta');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const id = /^run-(.+)\.json$/.exec(f)?.[1];
      if (!id) continue;
      n++;
      const r = await readRunMetaDetailed({ archiveRoot, topic }, stage, id);
      if (!r.ok) { unreadable.push(`${topic}/${stage}/${f}：${describeRunMetaCause(r.cause)}`); continue; }
      if (r.meta.guard?.readonly_breach === true) hits.push(`${topic}/${stage}/${f} ${JSON.stringify(r.meta.guard.breached_files ?? [])}`);
    }
  }
}
console.log(`run.json ${n} 份，按契约读不出 ${unreadable.length} 份，readonly_breach=true ${hits.length} 份`);
for (const u of unreadable) console.log('  读不出 ' + u);
for (const h of hits) console.log('  失守 ' + h.slice(0, 300));
