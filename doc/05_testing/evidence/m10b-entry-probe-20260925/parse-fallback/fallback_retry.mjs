// 只读：用当前解析器（dist/test 构建）重跑归档里全部 parse_fallback 原文，
// 统计「现在能过」的比例，并抽出越界的枚举取值与根对象多余键。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseReview } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/parse.js';

const ROOT = '/Users/chenzhenbo/Work/TriviumCode/.reviews';
const ENUMS = {
  severity: ['blocker', 'major', 'minor', 'nit'],
  layer: ['requirement', 'plan', 'code', 'rca'],
  kind: ['correctness', 'security', 'concurrency', 'contract', 'test-gap', 'maintainability', 'scope-drift', 'performance'],
};
// 取自 skills/dual-critic/schema/review.v1.json 的根 properties（additionalProperties: false）
const ROOT_KEYS = new Set(['schema', 'verdict', 'summary', 'findings', 'agreed', 'not_covered', 'consulted']);

async function* reviewFiles() {
  for (const topic of await fs.readdir(ROOT)) {
    for (const stage of ['plan', 'code', 'bug', 'verify']) {
      const dir = path.join(ROOT, topic, stage, '_meta');
      let names = [];
      try { names = await fs.readdir(dir); } catch { continue; }
      for (const n of names) {
        if (/^review-[a-z]+-\d{8}T\d{6}Z\.json$/.test(n)) yield path.join(dir, n);
      }
    }
  }
}

const stats = {};
const bad = { severity: {}, layer: {}, kind: {} };
const extraRoot = {};
const stillFail = [];
function bump(o, k) { o[k] = (o[k] ?? 0) + 1; }

for await (const f of reviewFiles()) {
  let j;
  try { j = JSON.parse(await fs.readFile(f, 'utf8')); } catch { continue; }
  if (!j || j.parse_fallback !== true) continue;
  const critic = path.basename(f).split('-')[1];
  stats[critic] ??= { total: 0, noRaw: 0, nowOk: 0, stillFail: 0 };
  const s = stats[critic];
  s.total++;
  if (!j.raw) { s.noRaw++; continue; }
  const r = parseReview(j.raw);
  if (r.ok) { s.nowOk++; continue; }
  s.stillFail++;
  stillFail.push(`${critic} ${path.relative(ROOT, f)} :: ${String(r.error ?? r.reason ?? '').slice(0, 160)}`);
  // 尽力从原文里抠出 JSON 对象，统计越界取值与多余根键
  const m = j.raw.match(/\{[\s\S]*\}/);
  if (!m) continue;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { continue; }
  for (const k of Object.keys(obj)) if (!ROOT_KEYS.has(k)) bump(extraRoot, `${critic}:${k}`);
  for (const fd of obj.findings ?? []) {
    for (const [key, allowed] of Object.entries(ENUMS)) {
      if (fd[key] !== undefined && !allowed.includes(fd[key])) bump(bad[key], `${critic}:${fd[key]}`);
    }
  }
}

console.log(JSON.stringify({ stats, bad, extraRoot }, null, 1));
console.log('--- still failing');
for (const x of stillFail) console.log(x);
