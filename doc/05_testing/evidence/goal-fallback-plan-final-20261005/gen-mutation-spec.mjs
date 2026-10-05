// 生成「目标回退取计划定稿」（EV-212）的源码变异规格（计划 r2 §4.4 的候选，按实际源码定稿）。
// 照搬 evidence/plan-final-recheck-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 期望套件：单测 task-goal（UNIT）为主锚；只有调用链看得见的变异取集成 goal-fallback-plan-final（INTEG）。
// 跨两类的红格放 `also`（预跑脚本顺带跑、装置忽略）。
// 用法（在仓库根）：node doc/05_testing/evidence/goal-fallback-plan-final-20261005/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const RV = 'src/trivium/review.ts';
const UNIT = 'dist/test/test/unit/task-goal.test.js';
const INTEG = 'dist/test/test/integration/goal-fallback-plan-final.test.js';

const WIRE = "    stage === 'code' ? async () => planFinal : () => resolvePlanFinal(ref, ctx.projectRoot));\n";
const NULL_PF = '({ path: null, warning: null })';
const NO_PATH = '    if (!final.path) return null;\n';
const RESOLVE = '    return goalFromPlanDoc(await fs.readFile(path.resolve(projectRoot, final.path), \'utf8\'));\n';
const EXPLICIT = '  const explicit = clampGoal(opts.taskGoal);\n  if (explicit) return explicit;\n';
const PLAN_SHORT = "  if (opts.stage === 'plan') return null;\n\n  try {\n    const final = await planFinal();\n";
const CALL = '    const final = await planFinal();\n';
const CATCH = '  } catch {\n    /*\n     * 读件失败（竞态删除等）';

const cases = [
  { id: 'M1', desc: '代码阶段改传恒取不到的桩（不复用已算好的计划定稿）', file: RV, find: WIRE,
    replace: `    stage === 'code' ? async () => ${NULL_PF} : () => resolvePlanFinal(ref, ctx.projectRoot));\n`, expect: INTEG },
  { id: 'M2', desc: 'bug 阶段改传恒取不到的桩（不现算）', file: RV, find: WIRE,
    replace: `    stage === 'code' ? async () => planFinal : async () => ${NULL_PF});\n`, expect: INTEG },
  /*
   * M3a「删去 path 判空」已从规格删除：预跑（mutation-names-log.txt）fail=0，确认是等价变异——
   * path.resolve 遇 null 抛 TypeError、落进 catch 同样返回 null（计划 r2 §4.4 注）。判空保留是为可读，不承担行为。
   */
  { id: 'M3b', desc: '不丢弃告警：path 为空时把告警名当目标返回', file: RV, find: NO_PATH,
    replace: '    if (!final.path) return final.warning ? clampGoal(final.warning.name) : null;\n', expect: UNIT },
  { id: 'M4', desc: '相对路径不按 projectRoot 还原、按进程 cwd 读（GLM-01）', file: RV, find: RESOLVE,
    replace: "    return goalFromPlanDoc(await fs.readFile(final.path, 'utf8'));\n", expect: UNIT },
  { id: 'M5', desc: '惰性破坏：函数开头先调一次取件', file: RV, find: EXPLICIT,
    replace: '  await planFinal().catch(() => null);\n' + EXPLICIT, expect: UNIT },
  { id: 'M6', desc: '删去计划阶段短路', file: RV, find: PLAN_SHORT,
    replace: "  try {\n    const final = await planFinal();\n", expect: UNIT },
  { id: 'M7', desc: '删去兜底：catch 原样抛出', file: RV, find: CATCH,
    replace: '  } catch (e) {\n    throw e;\n    /*\n     * 读件失败（竞态删除等）', expect: UNIT },
  { id: 'M8', desc: '退回旧取法：第三级按缺省 Driver 后缀自己找计划文档', file: RV, find: CALL,
    replace: "    const final = { path: path.relative(projectRoot, await locateSubject({ topic: ref.topic, layout: ref.layout, stage: 'plan' as const, stageDirAbs: stageDir(ref.layout, 'plan') }, null, projectRoot)) };\n",
    expect: UNIT, also: [INTEG] },
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
