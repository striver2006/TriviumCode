// 起点红、补齐后绿（计划 r2 §5.1）：同一套判定函数分别跑在起点提交 466bb59（git 读法）与改后一侧上。
//
// 读法分叉自检（计划双审 CODEX-01）：本主题不改的五个索引目录，git 读法在起点列出的顶层名字与各自类型，
// 必须与工作树读法逐一相等（两侧都滤掉 `.` 起头的隐藏项）；不等即退 2 报「读法分叉」——那是环境问题，不是判据失败。
//
// 期望：
//   起点：论域恰为六份 README、下限零问题；05_testing 恰报 19 条 missing（文件名集合与计划 S3 逐一相等）
//         与 4 条 order（第 28、30、52、54 行，计划 S4，按 §3.4 粒度）；其余五份零问题；
//   改后：论域恰为六份 README，全部零问题。
// 读数写 baseline-red.json（带 --after 时写 baseline-red-after-〈提交〉.json）；任一期望不满足退 1。
//
// 前提见 lib.mjs：脚本开头自己重编测试产物；起点提交不在本地对象库（浅克隆 / 部分克隆）即退 2（代码双审 CODEX-09）。
// 用法：node doc/05_testing/evidence/doc-archive-index-20261001/baseline-red.mjs
//       提交后复核提交点（计划双审 CODEX-04）：… baseline-red.mjs --after HEAD
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BASE, HERE, ROOT, checkPrereqs, git, gitIO, loadHelper, runAll } from './lib.mjs';

checkPrereqs();
const h = await loadHelper();

const afterIdx = process.argv.indexOf('--after');
const afterRef = afterIdx > 0 ? process.argv[afterIdx + 1] : null;
if (afterIdx > 0 && !afterRef) {
  console.error('--after 要跟一个提交');
  process.exit(2);
}
const afterLabel = afterRef ? `${afterRef}（${git(['rev-parse', '--short', afterRef]).trim()}）` : '工作树';

const baseIO = gitIO(BASE);
const wtIO = h.fsIndexIO(ROOT);
const afterIO = afterRef ? gitIO(afterRef) : wtIO;

// ── 读法分叉自检 ──
const UNTOUCHED = h.KNOWN_INDEXED_DIRS.filter((d) => d !== 'doc/05_testing');
const forks = [];
for (const d of UNTOUCHED) {
  const shape = (io) =>
    (io.list(d) ?? [])
      .filter((n) => !n.startsWith('.'))
      .sort()
      .map((n) => `${n}:${io.kind(`${d}/${n}`)}`);
  const a = shape(baseIO);
  const b = shape(wtIO);
  if (JSON.stringify(a) !== JSON.stringify(b)) forks.push({ dir: d, git: a, worktree: b });
}
if (forks.length) {
  console.error(`读法分叉（git 读法与工作树读法对同一批目录给出不同的名字或类型），环境前提不满足：\n${JSON.stringify(forks, null, 2)}`);
  process.exit(2);
}

// ── 判定 ──
const base = runAll(h, baseIO);
const after = runAll(h, afterIO);

const EXPECT_MISSING = [
  '2026-09-23_ev74_structured_arm_acceptance',
  '2026-09-24_ev82_review_arm',
  '2026-09-27_gate_block_no_skeleton',
  '2026-09-27_orphan_worker',
  '2026-09-27_residual_finalize',
  '2026-09-27_unfinished_runs',
  '2026-09-28_cancel_cli_reach',
  '2026-09-28_cli_pgroup_record',
  '2026-09-28_lost_worker_cancel',
  '2026-09-28_lost_worker_gone_finalize',
  '2026-09-28_worker_start_canonical',
  '2026-09-29_cancel_wait_cli_admission',
  '2026-09-29_critical_lock_floor',
  '2026-09-29_heartbeat_threshold_warning',
  '2026-09-29_orphan_cli_admission',
  '2026-09-29_scrub_help_main_clause',
  '2026-09-29_scrub_output_text',
  '2026-09-30_concurrent_setgate_flake',
  '2026-09-30_lock_reclaim_enoent',
].map((s) => `doc/05_testing/REPORT_${s}.md`);
const EXPECT_ORDER_LINES = [28, 30, 52, 54];
const T = 'doc/05_testing/README.md';
const SIX = h.KNOWN_INDEXED_DIRS.map((d) => `${d}/README.md`);

const verdicts = [];
const expect = (ok, what) => verdicts.push({ ok, what });
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

expect(same(base.domain, SIX), `起点论域恰为六份 README（实得 ${base.domain.join('、')}）`);
expect(base.domainProblems.length === 0, `起点下限零问题（实得 ${base.domainProblems.length}）`);
const baseT = base.perReadme[T] ?? [];
const missing = baseT.filter((p) => p.kind === 'missing').map((p) => p.detail.split(' ')[0]);
expect(same(missing, EXPECT_MISSING), `起点 05_testing 的 missing 恰为计划 S3 的 19 份（实得 ${missing.length} 条）`);
const orders = baseT.filter((p) => p.kind === 'order').map((p) => p.line);
expect(same(orders, EXPECT_ORDER_LINES), `起点 05_testing 的 order 恰为第 ${EXPECT_ORDER_LINES.join('、')} 行（实得 ${orders.join('、') || '无'}）`);
const other = baseT.filter((p) => p.kind !== 'missing' && p.kind !== 'order');
expect(other.length === 0, `起点 05_testing 无其它种类问题（实得 ${other.length}）`);
for (const r of SIX.filter((r) => r !== T)) {
  expect((base.perReadme[r] ?? []).length === 0, `起点 ${r} 零问题（实得 ${(base.perReadme[r] ?? []).length}）`);
}
expect(same(after.domain, SIX), `改后（${afterLabel}）论域恰为六份 README（实得 ${after.domain.join('、')}）`);
expect(after.domainProblems.length === 0, `改后下限零问题（实得 ${after.domainProblems.length}）`);
for (const r of SIX) {
  expect((after.perReadme[r] ?? []).length === 0, `改后 ${r} 零问题（实得 ${(after.perReadme[r] ?? []).length}）`);
}

const summarize = (res) => ({
  domain: res.domain,
  domain_problems: res.domainProblems,
  problems: Object.fromEntries(Object.entries(res.perReadme).map(([r, ps]) => [r, ps.map((p) => `[${p.kind}]${p.line ? ` :${p.line}` : ''} ${p.detail}`)])),
});
const readout = {
  base: BASE,
  after: afterLabel,
  generated_at: new Date().toISOString(),
  read_fork_check: { dirs: UNTOUCHED, forks: forks.length },
  verdicts,
  base_summary: summarize(base),
  after_summary: summarize(after),
};
const out = path.join(HERE, afterRef ? `baseline-red-after-${afterRef.replace(/[^\w.-]/g, '_')}.json` : 'baseline-red.json');
writeFileSync(out, `${JSON.stringify(readout, null, 2)}\n`);

for (const v of verdicts) console.log(`${v.ok ? '✓' : '✗'} ${v.what}`);
const bad = verdicts.filter((v) => !v.ok).length;
console.log(`\n${verdicts.length - bad}/${verdicts.length} 条期望满足；读法分叉自检通过（${UNTOUCHED.length} 个目录）；读数 ${path.relative(ROOT, out)}`);
process.exit(bad ? 1 : 0);
