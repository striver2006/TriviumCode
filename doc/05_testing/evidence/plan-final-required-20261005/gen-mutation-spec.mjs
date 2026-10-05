// 生成「计划定稿强制产出」（EV-214）的源码变异规格（计划 r2 §4 的 M1～M16，按实际源码定稿；另加 M17 守「更晚运行」的取法、M18 守被审对象轮次的后缀判据）。
// 照搬 evidence/task-goal-fulltext-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 期望套件：单测 plan-final-gate（UNIT）为主锚；只有调用链看得见的变异取集成 plan-final-gate（INTEG）。
// 跨两类的红格放 `also`（预跑脚本顺带跑、装置忽略）。
// 用法（在仓库根）：node doc/05_testing/evidence/plan-final-required-20261005/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GT = 'src/trivium/gate.ts';
const RV = 'src/trivium/review.ts';
const CLI = 'src/trivium/cli.ts';
const UNIT = 'dist/test/test/unit/plan-final-gate.test.js';
const INTEG = 'dist/test/test/integration/plan-final-gate.test.js';

const STAGE_GUARD = "  if (stage === 'plan') {\n    const acceptedIds = [\n";
const ACCEPT_FILTER = ".filter((r) => r.disposal === '接受')\n";
const EXPECTED_PRED = '            isFallbackId(r.id) ? (expectedFallback ? expectedFallback.includes(r.id) : true) : idsSet.has(r.id),\n';
const PUSH = '    failures.push(...np.failures);\n';
const BASE = '  const base = i.planFinal.subjectRerunIndex ?? i.rerunIndex;\n';
const CAND = '    if (it.parsed.role !== i.driver || it.parsed.kind !== null || it.parsed.rerunIndex <= base) continue;\n';
const REVIEW_SKIP = "    if (await isReviewArtifact(path.join(stageDir(i.layout, 'plan'), it.fileName))) continue;\n";
const SUPERSEDED = '  const superseded = i.planFinal.laterSubjectRerunIndexes.some((s) => s > base);\n';
const PICK = '  const pick = superseded\n';
const MENTION = '  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text);\n';
const PLAN_CHECK = "  const planCheck = stage === 'plan' ? runMeta?.plan_final_check : undefined;\n";
const LATER = '    if (!id || id <= runId) continue;\n';
const PASS = '    expectedFallbackIds, expectedDegradedIds, missingSides, runId, reviewDocs, planFinal,\n';
const MARKER = '      ...(planFinalCheck ? { planFinalCheck } : {}),\n';
const SUBJECT_ROLE = '  if (!parsed || parsed.topic !== layout.topic || parsed.role !== driver || parsed.kind !== null) return null;\n';

const cases = [
  { id: 'M1', file: GT, desc: '去掉「只在计划阶段」', find: STAGE_GUARD, replace: STAGE_GUARD.replace("stage === 'plan'", 'true'), expect: UNIT },
  { id: 'M2a', file: GT, desc: '基准取 max(rerun_index, 被审对象轮次)（计划双审 GLM-01 之前的写法）', find: BASE, replace: '  const base = Math.max(i.planFinal.subjectRerunIndex ?? 0, i.rerunIndex);\n', expect: UNIT, also: [INTEG] },
  { id: 'M2b', file: GT, desc: '基准只取 rerun_index', find: BASE, replace: '  const base = i.rerunIndex;\n', expect: UNIT },
  { id: 'M3', file: GT, desc: '候选条件 > 改 >=（被审对象本身算新一轮）', find: CAND, replace: CAND.replace('<= base', '< base'), expect: UNIT, also: [INTEG] },
  { id: 'M4', file: GT, desc: '编号判据改成子串包含', find: MENTION, replace: '  return text.includes(id);\n', expect: UNIT },
  { id: 'M5', file: GT, desc: '接受集合排除虚拟编号', find: EXPECTED_PRED, replace: '            isFallbackId(r.id) ? false : idsSet.has(r.id),\n', expect: UNIT },
  { id: 'M6', file: GT, desc: '接受集合不按裁决过滤（全部行）', find: ACCEPT_FILTER, replace: '.filter((r) => r.disposal.length > 0)\n', expect: UNIT },
  { id: 'M7', file: GT, desc: '去掉角色过滤', find: CAND, replace: CAND.replace('it.parsed.role !== i.driver || ', ''), expect: UNIT, also: [INTEG] },
  { id: 'M8', file: GT, desc: '去掉审查件剔除', find: REVIEW_SKIP, replace: '', expect: UNIT },
  { id: 'M9', file: GT, desc: '「在用」分支改为取最小候选', find: PICK, replace: '  const pick = true\n', expect: UNIT },
  { id: 'M10', file: GT, desc: 'loadRoundReviews 的 planFinal 恒为 null', find: PLAN_CHECK, replace: PLAN_CHECK.replace("stage === 'plan'", "stage === 'never'"), expect: INTEG, also: [UNIT] },
  { id: 'M11', file: RV, desc: 'prepareRun 不写标记', find: MARKER, replace: '', expect: INTEG },
  { id: 'M12', file: CLI, desc: 'gate --check 调用点传 null', find: PASS, replace: PASS.replace('planFinal,', 'planFinal: null,'), expect: INTEG },
  { id: 'M13', file: GT, desc: 'verifyRoundForApproval 传 null', find: PASS, replace: PASS.replace('planFinal,', 'planFinal: null,'), expect: INTEG },
  { id: 'M14', file: GT, desc: '新失败项插到最前', find: PUSH, replace: '    failures.unshift(...np.failures);\n', expect: UNIT },
  { id: 'M15', file: GT, desc: '接受集合不按期望集过滤（计划双审 AGY-02）', find: EXPECTED_PRED, replace: '            true,\n', expect: UNIT },
  { id: 'M16', file: GT, desc: '「已被接手」判定恒假（计划双审 AGY-01 / GLM-03）', find: SUPERSEDED, replace: '  const superseded = false;\n', expect: UNIT, also: [INTEG] },
  { id: 'M17', file: GT, desc: '「更晚运行」把更早的运行也收进来', find: LATER, replace: '    if (!id || id === runId) continue;\n', expect: UNIT },
  { id: 'M18', file: RV, desc: '被审对象轮次不核后缀', find: SUBJECT_ROLE, replace: SUBJECT_ROLE.replace(' || parsed.role !== driver', ''), expect: UNIT },
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
