// 生成「计划定稿复核」（EV-215）的源码变异规格（计划 r2 §4 的候选，按实际源码定稿）。
// 照搬 evidence/plan-final-required-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 期望套件：单测 plan-final-recheck（UNIT）为主锚；只有调用链看得见的变异取集成 plan-final-recheck（INTEG）。
// 跨两类的红格放 `also`（预跑脚本顺带跑、装置忽略）。
// 用法（在仓库根）：node doc/05_testing/evidence/plan-final-recheck-20261005/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GT = 'src/trivium/gate.ts';
const RV = 'src/trivium/review.ts';
const UNIT = 'dist/test/test/unit/plan-final-recheck.test.js';
const INTEG = 'dist/test/test/integration/plan-final-recheck.test.js';
const GATE_UNIT = 'dist/test/test/unit/plan-final-gate.test.js';

const LATER = '        planFinal: { subjectRerunIndex: mark.subject_rerun_index, laterSubjectRerunIndexes: [] },\n';
const NO_DISP = '      if (!disp) continue;\n';
const DRV_MISMATCH = '      if (m.driver !== driver) {\n';
const MARK = "      const mark = m.plan_final_check;\n      if (!mark) return { kind: 'skipped' };\n";
const NO_ACCEPTED = "      if (acceptedIds.length === 0) return { kind: 'skipped' };\n";
const NAME_GUARD = "    if (!final) return { kind: 'unverifiable', reason: `定稿文件名 ${finalFileName} 解析不出执笔方` };\n";
const CATCH = "    return { kind: 'unverifiable', reason: `复核出错：${e instanceof Error ? e.message : String(e)}` };\n";
const EXPECTED_PRED = '        .filter((r) => (isFallbackId(r.id) ? (fb ? fb.includes(r.id) : true) : idsSet.has(r.id)))\n';
const ACCEPT_FILTER = "        .filter((r) => r.disposal === '接受')\n";
const DEGRADED_IN = '  const idsSet = expectedFindingIds(collectStructuredIds(i.reviews), [...new Set(i.expectedDegradedIds)]);\n';
const WIRE = '  const planFinalWarnings = [planFinal.warning, planFinalRecheck].filter(';
const DISPLAY = '    display: [...planFinalWarnings, ...renderPrunedWarnings(pruned, sides, MUST_READ_PRUNED_DISPLAY_MAX)],\n';
const ALL = '    all: [...planFinalWarnings, ...renderPrunedWarnings(pruned, sides)],\n';

const cases = [
  { id: 'M1', file: GT, desc: 'M-later：照传真实后续轮次（loadRoundReviews 的 planFinal）', find: LATER,
    replace: '        planFinal: round.planFinal ?? { subjectRerunIndex: mark.subject_rerun_index, laterSubjectRerunIndexes: [] },\n', expect: UNIT },
  { id: 'M2', file: GT, desc: 'M-stop：最新一次没有裁决件即不复核（不往旧里找）', find: NO_DISP,
    replace: "      if (!disp) return { kind: 'skipped' };\n", expect: UNIT },
  { id: 'M3', file: GT, desc: 'M-drv：不比对那一轮执笔方与定稿后缀', find: DRV_MISMATCH, replace: '      if (false) {\n', expect: UNIT },
  { id: 'M4', file: GT, desc: 'M-unmarked：去掉第 ③ 格（无标记按被审对象轮次 null 照判）', find: MARK,
    replace: '      const mark = m.plan_final_check ?? { subject_rerun_index: null };\n', expect: UNIT, also: [INTEG] },
  { id: 'M5', file: GT, desc: '去掉第 ④ 格（接受集合为空也交给 checkNextPlan）', find: NO_ACCEPTED, replace: '', expect: UNIT },
  { id: 'M6', file: GT, desc: 'M-name：去掉定稿文件名判空（AGY-01）', find: NAME_GUARD, replace: '', expect: UNIT },
  { id: 'M7', file: GT, desc: 'M-catch：兜底改为原样抛出（CODEX-02）', find: CATCH, replace: '    throw e;\n', expect: UNIT },
  { id: 'M8', file: GT, desc: 'M-accept：接受集合不按期望集过滤', find: EXPECTED_PRED, replace: '        .filter(() => true)\n', expect: UNIT, also: [GATE_UNIT] },
  { id: 'M9', file: GT, desc: 'M-fallback：虚拟编号不按清单', find: EXPECTED_PRED,
    replace: '        .filter((r) => (isFallbackId(r.id) ? true : idsSet.has(r.id)))\n', expect: UNIT },
  { id: 'M10', file: GT, desc: '接受集合不按裁决过滤（驳回 / 暂缓也收）', find: ACCEPT_FILTER, replace: '        .filter((r) => r.disposal.length > 0)\n', expect: UNIT, also: [GATE_UNIT] },
  { id: 'M11', file: GT, desc: 'M-gate：逐条降级不进期望集', find: DEGRADED_IN,
    replace: '  const idsSet = expectedFindingIds(collectStructuredIds(i.reviews), []);\n', expect: UNIT },
  { id: 'M12', file: RV, desc: 'M-wire：prepareRun 不并入复核告警', find: WIRE,
    replace: '  const planFinalWarnings = [planFinal.warning].filter(', expect: INTEG },
  { id: 'M13', file: RV, desc: 'M-order-a：播报通道里复核告警排到剔除告警之后（CODEX-01）', find: DISPLAY,
    replace: '    display: [...renderPrunedWarnings(pruned, sides, MUST_READ_PRUNED_DISPLAY_MAX), ...planFinalWarnings],\n', expect: UNIT, also: [INTEG] },
  { id: 'M14', file: RV, desc: 'M-order-a′：run.json 里复核告警排到剔除告警之后', find: ALL,
    replace: '    all: [...renderPrunedWarnings(pruned, sides), ...planFinalWarnings],\n', expect: UNIT, also: [INTEG] },
  { id: 'M15', file: RV, desc: 'M-order-b：复核告警计入剔除封顶（CODEX-01）', find: DISPLAY,
    replace: '    display: [...planFinalWarnings, ...renderPrunedWarnings(pruned, sides, MUST_READ_PRUNED_DISPLAY_MAX)].slice(0, MUST_READ_PRUNED_DISPLAY_MAX),\n',
    expect: UNIT },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
  if ([...c.replace].some((ch, i) => ch.charCodeAt(0) === 36 && /[$&`'0-9<]/.test(c.replace[i + 1] ?? ''))) {
    throw new Error(`${c.id} 的 replace 含特殊替换模式`);
  }
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.error(`规格 ${cases.length} 条 → ${OUT}`);
