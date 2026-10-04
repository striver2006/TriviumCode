// 「夹具运行目录收尾」（EV-207）验收读数：数 os.tmpdir() 下三个前缀的条目（-runs 后缀单列），只读不删。
// 用法：node doc/05_testing/evidence/fixture-runs-cleanup-20261004/count-prefixes.mjs <标签>
import fs from 'node:fs';
import os from 'node:os';

const names = fs.readdirSync(os.tmpdir());
const row = {
  label: process.argv[2] ?? '',
  at: new Date().toISOString(),
};
for (const p of ['trivium-fx-', 'trivium-selftest-', 'trivium-kit-']) {
  const hit = names.filter((n) => n.startsWith(p));
  row[p] = hit.length;
  row[`${p}*-runs`] = hit.filter((n) => n.endsWith('-runs')).length;
}
console.log(JSON.stringify(row));
