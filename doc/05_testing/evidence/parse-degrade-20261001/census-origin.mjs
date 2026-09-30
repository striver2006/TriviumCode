// 零配额普查：把归档里全部 parse_fallback 样本（review-<侧>-<run>.json 带 raw）用当前构建的解析器重放，按成因分类。只读。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const { parseReview, extractJsonCandidates } = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/parse.js')).href);

const files = [];
for (const topic of fs.readdirSync(path.join(ROOT, '.reviews'))) {
  for (const stage of ['plan', 'code', 'bug']) {
    const d = path.join(ROOT, '.reviews', topic, stage, '_meta');
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (/^review-[a-z]+-.*\.json$/.test(f)) files.push(path.join(d, f));
  }
}
const all = { total: 0, fallback: 0 };
const rows = [];
for (const f of files) {
  all.total++;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!j.parse_fallback) continue;
  all.fallback++;
  const side = /review-([a-z]+)-/.exec(path.basename(f))[1];
  const run = /-(\d{8}T\d{6}Z)/.exec(path.basename(f))?.[1] ?? '?';
  const raw = String(j.raw ?? '');
  const cands = extractJsonCandidates(raw);
  const r = parseReview(raw);
  // 成因分类
  let cause;
  if (r.ok) cause = 'now_ok';
  else if (cands.length === 0) cause = raw.trim().length === 0 ? 'empty' : 'no_json';
  else if (/语法错误/.test(r.reason)) cause = 'json_syntax';
  else cause = 'schema';
  const errs = r.ok ? [] : r.errors;
  // schema 错误细分
  const kinds = new Set();
  for (const e of errs) {
    if (/additional/i.test(e) || /额外|多余|不允许/.test(e)) kinds.add('extra_field');
    else if (/required|必填|缺/.test(e)) kinds.add('missing_field');
    else if (/enum|allowed|取值|枚举/.test(e)) kinds.add('enum');
    else if (/pattern|格式/.test(e)) kinds.add('pattern');
    else kinds.add('other');
  }
  const wrapped = raw.trim().startsWith('{') ? 'bare' : /```/.test(raw) ? 'prose+fence' : 'prose';
  rows.push({ file: path.relative(ROOT, f), side, run, cause, kinds: [...kinds], wrapped, cands: cands.map((c) => c.from), errs: errs.slice(0, 6), reason: r.ok ? null : r.reason, rawLen: raw.length });
}
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
const bySideCause = rows.reduce((m, r) => ((m[`${r.side}/${r.cause}`] = (m[`${r.side}/${r.cause}`] ?? 0) + 1), m), {});
const kindCount = rows.flatMap((r) => r.kinds).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
const out = { ...all, bySide: by('side'), byCause: by('cause'), bySideCause, byWrap: by('wrapped'), schemaKinds: kindCount, rows };
fs.writeFileSync(process.argv[2] ?? '/dev/stdout', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ ...all, bySide: out.bySide, byCause: out.byCause, bySideCause, byWrap: out.byWrap, schemaKinds: kindCount }, null, 1));
