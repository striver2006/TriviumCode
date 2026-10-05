// 生成「任务目标全文送审」（EV-210）的源码变异规格（计划 r2 §4 的 M1～M17，按实际源码定稿；另加 M18 守页脚拆分、M19 守代码双审 GLM-01 的附录单独扫描）。
// 照搬 evidence/fixture-repo-init-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 期望套件：单测 task-goal-appendix（UNIT）为主锚；只有调用链看得见的变异取集成 task-goal-fulltext（INTEG）。
// 跨两类的红格放 `also`（预跑脚本顺带跑、装置忽略）。
// 用法（在仓库根）：node doc/05_testing/evidence/task-goal-fulltext-20261005/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const RV = 'src/trivium/review.ts';
const BR = 'src/trivium/brief.ts';
const UNIT = 'dist/test/test/unit/task-goal-appendix.test.js';
const INTEG = 'dist/test/test/integration/task-goal-fulltext.test.js';

/** 从源码里截 [起点串, 终点串) 之间的一段（含起点、不含终点） */
function cut(file, from, to) {
  const s = read(file);
  const i = s.indexOf(from);
  if (i < 0) throw new Error(`${file} 里找不到起点：${from}`);
  const j = s.indexOf(to, i);
  if (j < 0) throw new Error(`${file} 里起点之后找不到终点：${to}`);
  return s.slice(i, j);
}

const STAGE_GUARD = "  if (stage !== 'plan') return null;\n";
const LEN_GUARD = '  if (foldGoal(rawGoal).length <= TASK_GOAL_MAX) return null;\n';
const RAW_RETURN = "  return (rawGoal ?? '').replace(/\\r\\n/g, '\\n').trim();\n";
const CALL = '  const goalAppendix = taskGoalAppendix(stage, opts.taskGoal);\n';
const TASK_WRITE = '        if (!t.goal) t.goal = taskGoal;\n';
const LOCATE = '    const abs = await locateSubject(planStageRef, null, projectRoot, resolution.driver);\n';
const RESOLVE = "  const resolution = await resolveStageDriver(ref.layout, 'plan');\n";
const CORRUPT_RET = '    return {\n      path: null,\n      warning: {\n';
const CHANNEL = '  const planFinalWarnings = planFinal.warning ? [planFinal.warning] : [];\n';
const PUSH_PLAN = "  if (planFinal) await push(planFinal, 'plan-final');\n";
const ORDER = cut(BR, '  // 3) 本主题计划定稿（代码阶段，EV-210）\n', '\n  return out;\n}');
const APPENDIX_PUSH = '  if (taskGoalAppendix) parts.push(renderGoalAppendix(taskGoalAppendix));\n';
const TAIL = cut(BR, APPENDIX_PUSH, '  void cfg;\n');
const POINTER = cut(BR, '  ? `（上面是摘要：', '  : \'\'}\n**必读**');
const OVER = '  const over = points.length > TASK_GOAL_APPENDIX_MAX;\n';
const SHOWN = "  const shown = over ? points.slice(0, TASK_GOAL_APPENDIX_MAX).join('') : full;\n";
const FENCE_TAIL = '${shown}\n${GOAL_FENCE_END}${tail}`;\n';
const FOOTER = "  parts.push(`---\n\n*本任务书由 TriviumCode 编排器生成";

const ORDER_LINES = ORDER.split('\n');
// 计划定稿那两行（注释 + push）与 --context 那两行（注释 + 循环）对调
const ORDER_SWAPPED = [ORDER_LINES[3], ORDER_LINES[4], '', ORDER_LINES[0], ORDER_LINES[1], ''].join('\n');
if (ORDER_LINES.length !== 6 || ORDER_LINES[5] !== '' || !ORDER_LINES[4].includes("'context'")) throw new Error(`ORDER 截取的形状不对：${JSON.stringify(ORDER_LINES)}`);

const cases = [
  { id: 'M1', file: RV, desc: 'taskGoalAppendix 去掉「只在计划阶段」', find: STAGE_GUARD, replace: '', expect: UNIT, also: [INTEG] },
  { id: 'M2', file: RV, desc: '截断判定 > 改 >=（恰 200 也出附录）', find: LEN_GUARD, replace: LEN_GUARD.replace('<=', '<'), expect: UNIT },
  { id: 'M3', file: RV, desc: '附录给折叠后的文本', find: RAW_RETURN, replace: '  return foldGoal(rawGoal);\n', expect: UNIT, also: [INTEG] },
  { id: 'M4', file: RV, desc: '调用点把解析后的摘要 taskGoal 当原文传入', find: CALL, replace: CALL.replace('opts.taskGoal', 'taskGoal'), expect: INTEG },
  { id: 'M5', file: BR, desc: 'renderBrief 不渲染附录', find: APPENDIX_PUSH, replace: '', expect: UNIT, also: [INTEG] },
  { id: 'M6', file: BR, desc: '第 4 段不出指引行', find: POINTER, replace: "  ? ''\n", expect: UNIT, also: [INTEG] },
  {
    id: 'M7', file: BR, desc: '附录放到页脚之后',
    find: TAIL, replace: TAIL.slice(APPENDIX_PUSH.length) + APPENDIX_PUSH, expect: UNIT,
  },
  { id: 'M8', file: BR, desc: '上限判定差一（恰 16000 也截）', find: OVER, replace: OVER.replace('>', '>='), expect: UNIT },
  { id: 'M9', file: BR, desc: 'buildMustReadList 不收计划定稿', find: PUSH_PLAN, replace: '', expect: UNIT, also: [INTEG] },
  { id: 'M10', file: RV, desc: 'resolvePlanFinal 按缺省 Driver 定位', find: LOCATE, replace: LOCATE.replace('resolution.driver', 'DEFAULT_DRIVER'), expect: UNIT, also: [INTEG] },
  { id: 'M11', file: RV, desc: 'resolvePlanFinal 判的是代码阶段的执笔方', find: RESOLVE, replace: RESOLVE.replace("'plan'", "'code'"), expect: UNIT, also: [INTEG] },
  {
    id: 'M12', file: RV, desc: '计划阶段留痕读不出时不出告警',
    find: CORRUPT_RET, replace: '    if (resolution.unreadable.length >= 0) return { path: null, warning: null };\n' + CORRUPT_RET, expect: UNIT, also: [INTEG],
  },
  { id: 'M12b', file: RV, desc: '告警不并进三个出口', find: CHANNEL, replace: '  const planFinalWarnings: { name: string; detail: string }[] = [];\n', expect: INTEG },
  { id: 'M13', file: BR, desc: '计划定稿排在 --context 之后', find: ORDER, replace: ORDER_SWAPPED, expect: UNIT },
  { id: 'M14', file: RV, desc: '任务文件改存原文', find: TASK_WRITE, replace: '        if (!t.goal) t.goal = opts.taskGoal ?? taskGoal;\n', expect: INTEG },
  { id: 'M15', file: RV, desc: '代码阶段也出附录（判定传死 plan）', find: CALL, replace: CALL.replace('(stage,', "('plan',"), expect: INTEG },
  { id: 'M16', file: BR, desc: '上限按 UTF-16 截（切代理对）', find: SHOWN, replace: '  const shown = over ? full.slice(0, TASK_GOAL_APPENDIX_MAX) : full;\n', expect: UNIT },
  { id: 'M17', file: BR, desc: '超限提示行落进分隔线之内', find: FENCE_TAIL, replace: '${shown}${tail}\n${GOAL_FENCE_END}`;\n', expect: UNIT },
  {
    id: 'M19', file: RV, desc: '附录原文不单独按 full 扫（只剩任务书的 hunk 判据，代码双审 GLM-01）',
    find: "  if (goalAppendix) assertNoSecrets(goalAppendix, `${ref.topic}/plan 任务目标原文（--goal）`, 'full');\n", replace: '', expect: INTEG,
  },
  { id: 'M18', file: BR, desc: '页脚拆分改了第 8 段与页脚之间的拼接', find: FOOTER, replace: FOOTER.replace('---\n\n*', '---\n*'), expect: UNIT },
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
