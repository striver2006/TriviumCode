// 代码双审 r1 CODEX-01 的对照：48 份回退样本里改后仍整份回退的那几份，F 单元数在改前 / 改后构建上各是多少。
// 只读、零配额。用法（在仓库根）：node fallback-units.mjs 〈改前构建根〉 〈普查读数.json〉 〈输出 JSON〉
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [BASE, CENSUS, OUT] = process.argv.slice(2);
const load = (root) => import(pathToFileURL(path.join(path.resolve(root), 'dist/test/src/trivium/parse.js')).href);
const oldP = await load(BASE);
const newP = await load('.');
const rows = JSON.parse(fs.readFileSync(CENSUS, 'utf8')).rows;
const out = [];
for (const r of rows) {
  const raw = String(JSON.parse(fs.readFileSync(r.file, 'utf8')).raw ?? '');
  const now = newP.parseReview(raw);
  if (now.ok) continue; // 改后能解析的不再出 F 单元
  const side = r.side;
  const before = oldP.enumerateFallbackFindings(raw, side);
  const after = newP.enumerateFallbackFindings(raw, side);
  out.push({ file: r.file, side, cause: now.cause, units_before: before.length, units_after: after.length });
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
for (const x of out) console.log(`${x.cause.padEnd(22)} ${String(x.units_before).padStart(3)} → ${String(x.units_after).padEnd(3)} ${x.file}`);
