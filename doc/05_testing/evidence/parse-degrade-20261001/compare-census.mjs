// 逐份对照两份普查读数。
// 用法：node compare-census.mjs <A.json> <B.json> [--mode pre-pre|pre-post]
//   pre-pre ：同一改前构建、脚本 r0 与 r2 两版的读数 ⇒ 预测与 parser、gate 逐份相同（计划 r2 §5.2 首段）
//   pre-post：改前读数 vs 改后读数 ⇒ ①预测与改后解析器实际结果逐份一致 ②改前能解析的不退化
//             ③改后跨候选丢失编号为 0 ④闸门翻转逐轮列出（计划 r2 §5.2）
import fs from 'node:fs';

const [aPath, bPath] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'pre-post';
const A = JSON.parse(fs.readFileSync(aPath, 'utf8'));
const B = JSON.parse(fs.readFileSync(bPath, 'utf8'));
const byFile = (j) => new Map(j.rows.map((r) => [r.file, r]));
const a = byFile(A);
const b = byFile(B);
const problems = [];
const lines = [];

if (a.size !== b.size || [...a.keys()].some((k) => !b.has(k))) problems.push(`样本集不同：${a.size} vs ${b.size}`);

const sig = (p) => JSON.stringify({ o: p.outcome, q: p.qualified ?? null, d: p.degraded ?? null, e: [...(p.strippedEcho ?? [])].sort(), v: [...(p.strippedVendor ?? [])].sort(), x: p.escapesRepaired ?? 0 });

for (const [file, ra] of a) {
  const rb = b.get(file);
  if (!rb) continue;
  if (mode === 'pre-pre') {
    if (sig(ra.predicted) !== sig(rb.predicted)) problems.push(`${file}：预测不同 ${sig(ra.predicted)} vs ${sig(rb.predicted)}`);
    if (JSON.stringify(ra.parser.ok) !== JSON.stringify(rb.parser.ok)) problems.push(`${file}：parser 不同`);
    if (JSON.stringify(ra.gate) !== JSON.stringify(rb.gate)) problems.push(`${file}：gate 不同`);
    continue;
  }
  // pre-post
  const pb = rb.parser;
  const pred = rb.predicted;
  let actual;
  if (pb.ok) {
    actual = {
      outcome: (pb.degraded?.length ?? 0) > 0 ? 'partial' : 'ok',
      qualified: pb.findings,
      degraded: pb.degraded?.length ?? 0,
      strippedAll: [...(pb.repairs?.stripped_fields ?? [])].sort(),
      escapes: pb.repairs?.unescaped_backslashes ?? 0,
    };
  } else {
    actual = { outcome: `fallback:${pb.cause ?? '?'}` };
  }
  const expect = {
    outcome: pred.outcome,
    ...(pred.outcome === 'ok' || pred.outcome === 'partial'
      ? {
          qualified: pred.qualified,
          degraded: pred.degraded,
          strippedAll: [...(pred.strippedEcho ?? []), ...(pred.strippedVendor ?? [])].sort(),
          escapes: pred.escapesRepaired ?? 0,
        }
      : {}),
  };
  const same = JSON.stringify(actual) === JSON.stringify(expect);
  if (!same) problems.push(`${file}：预测 ${JSON.stringify(expect)} ≠ 实际 ${JSON.stringify(actual)}`);
  if (ra.parser.ok && !pb.ok) problems.push(`${file}：改前能解析、改后退化`);
  if ((pb.lostIds?.length ?? 0) > 0) problems.push(`${file}：跨候选丢失编号 ${pb.lostIds.join(',')}`);
  lines.push(`${same ? '一致' : '不一致'}  ${rb.side.padEnd(6)} ${actual.outcome.padEnd(30)} q${actual.qualified ?? '-'} d${actual.degraded ?? '-'} esc${actual.escapes ?? '-'} strip[${(actual.strippedAll ?? []).join(',')}]  ${file}`);
}

// 闸门翻转（按轮）
const flips = [];
if (mode === 'pre-post') {
  const seen = new Set();
  for (const [file, ra] of a) {
    const rb = b.get(file);
    const key = `${file.split('/_meta')[0]} ${ra.run}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ga = ra.gate.ok ?? 'error';
    const gb = rb.gate.ok ?? 'error';
    if (ga !== gb) flips.push({ round: key, before: ga, after: gb, failures: rb.gate.failures ?? rb.gate.error, notes: rb.gate.notes });
  }
}

const out = { mode, a: aPath, b: bPath, samples: a.size, problems, flips, lines };
console.log(lines.join('\n'));
console.log(JSON.stringify({ mode, samples: a.size, problems: problems.length, flips: flips.length }, null, 1));
if (problems.length) console.log('问题：\n' + problems.join('\n'));
if (flips.length) console.log('闸门翻转：\n' + flips.map((f) => `${f.round}: ${f.before} → ${f.after} ${JSON.stringify(f.failures)}`).join('\n'));
const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
process.exitCode = problems.length === 0 ? 0 : 1;
