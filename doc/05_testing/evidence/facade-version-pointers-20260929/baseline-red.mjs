// 基线全红（计划 r2 §5.4 ②）：同一套判定函数分别跑在起点提交 79d2ed4 与改后工作树上。
// 期望（下界）：
//   起点：P1～P9 每条至少含 forbidden（P1 另有 link_missing，预期）；全局规则至少命中
//         PRD :433（self_version）、设计索引 :33、MANUAL 索引 :27、LLD :51（stat_count）；
//   改后：清单、反向绑定、全局规则、历史样本全部零问题。
// 读数写 baseline-red.json；任一期望不满足退 1。
// 用法：node scripts/build.mjs --tests-only && node doc/05_testing/evidence/facade-version-pointers-20260929/baseline-red.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BASE, HERE, baseCandidates, baseRead, checkPrereqs, loadHelper, worktreeCandidates, worktreeRead } from './lib.mjs';

checkPrereqs();
const h = await loadHelper();

const PRD = 'doc/01_requirements/PRD_driver_dual_critic.md';
const EXPECT_GLOBAL = [
  [PRD, 433, 'self_version'],
  ['doc/02_design/README.md', 33, 'stat_count'],
  ['doc/07_manuals/README.md', 27, 'stat_count'],
  ['doc/02_design/LLD_orchestrator.md', 51, 'stat_count'],
];

function run(read, candidates) {
  const corpus = h.facadeCorpus(candidates);
  return {
    corpus_size: corpus.length,
    pointers: Object.fromEntries(h.POINTERS.map((e) => [e.id, h.checkPointers([e], read)])),
    unlisted: h.findUnlistedMarkers(corpus, h.POINTERS, read),
    global: h.scanGlobalRules(corpus, read),
    samples: h.checkHistoricalSamples(h.HISTORICAL_SAMPLES, h.POINTERS, read),
  };
}

const base = run(baseRead(), baseCandidates());
const after = run(worktreeRead, worktreeCandidates(h));

const verdicts = [];
const expect = (ok, what) => verdicts.push({ ok, what });

for (const e of h.POINTERS) {
  const kinds = [...new Set(base.pointers[e.id].map((p) => p.kind))].sort();
  expect(kinds.includes('forbidden'), `起点 ${e.id} 含 forbidden（实得 ${kinds.join(', ') || '无'}）`);
}
for (const [file, line, kind] of EXPECT_GLOBAL) {
  expect(base.global.some((p) => p.file === file && p.line === line && p.kind === kind), `起点全局规则命中 ${file}:${line} ${kind}`);
}
const afterPointerProblems = Object.values(after.pointers).flat();
expect(afterPointerProblems.length === 0, `改后清单零问题（实得 ${afterPointerProblems.length}）`);
expect(after.unlisted.length === 0, `改后反向绑定零问题（实得 ${after.unlisted.length}）`);
expect(after.global.length === 0, `改后全局规则零问题（实得 ${after.global.length}）`);
expect(after.samples.length === 0, `改后历史样本零问题（实得 ${after.samples.length}）`);

const summarize = (r) => ({
  corpus_size: r.corpus_size,
  pointers: Object.fromEntries(Object.entries(r.pointers).map(([id, ps]) => [id, [...new Set(ps.map((p) => p.kind))].sort()])),
  unlisted: r.unlisted.length,
  global: r.global.map((p) => `${p.file}:${p.line} ${p.kind} ${p.detail.slice(0, p.detail.indexOf('」') + 1)}`),
  samples: r.samples.map((p) => `${p.id} ${p.kind}`),
});
const readout = { base: BASE, generated_at: new Date().toISOString(), verdicts, base_summary: summarize(base), after_summary: summarize(after) };
writeFileSync(path.join(HERE, 'baseline-red.json'), `${JSON.stringify(readout, null, 2)}\n`);

for (const v of verdicts) console.log(`${v.ok ? '✓' : '✗'} ${v.what}`);
const bad = verdicts.filter((v) => !v.ok).length;
console.log(`\n${verdicts.length - bad}/${verdicts.length} 条期望满足；起点历史样本问题 ${base.samples.length} 条（H-prd-433 是 P10 改后才有的样本，起点找不到属预期）`);
process.exit(bad ? 1 : 0);
