// 生成「留痕读不出的出口」（EV-148 文案部分）的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/drift-uncomparable-20261001/gen-mutation-spec.mjs 的形态。每条只指定一个期望套件（计划双审 CODEX-06）。
// 用法（在仓库根）：node doc/05_testing/evidence/unreadable-run-exit-20261001/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const META = 'src/trivium/meta.ts';
const CLI = 'src/trivium/cli.ts';
const TOPIC_ARGS = 'src/trivium/topic-args.ts';
const HOOKS = 'src/trivium/hooks.ts';
const GATE = 'src/trivium/gate.ts';
const S = {
  exit: 'dist/test/test/unit/unreadable-run-exit.test.js',
  claim: 'dist/test/test/integration/topic-claim.test.js',
  hooks: 'dist/test/test/unit/hooks.test.js',
  loop: 'dist/test/test/integration/gate-loop.test.js',
};

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
/** 从源码截多行锚点：从含 startNeedle 的行到其后第一处含 endNeedle 的行（含两端），startNeedle 唯一 */
function blockOf(file, startNeedle, endNeedle) {
  const lines = read(file).split('\n');
  const i = lines.findIndex((l) => l.includes(startNeedle));
  const j = lines.findIndex((l, k) => k > i && l.includes(endNeedle));
  if (i < 0 || j < 0) throw new Error(`${file} 里找不到「${startNeedle}」…「${endNeedle}」`);
  if (lines.filter((l) => l.includes(startNeedle)).length !== 1) throw new Error(`「${startNeedle}」不唯一`);
  return lines.slice(i, j + 1).join('\n') + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

// 共用出口段（meta.ts）
const BODY_HEAD = lineOf(META, '重跑该阶段双审不是出口：review --start 在冻结送审包之前就按同一判定拒绝');
const BODY_TERMINAL = lineOf(META, '这一步只能由用户在终端做——会话里的恢复命令会被 Hook 拦下');
const BODY_NO_EXIT = lineOf(META, "'工具内没有出口。没有可恢复的副本");
const BODY_MANUAL = lineOf(META, '按 MANUAL §3.6「升级」更新并重装本工具后重试');
const FILE_LIST = lineOf(META, 'shown.map((f) => `    · ${f}\\n`)');
// 五处拼接
// 代码双审 r1 修订后（GLM-02 单入口）锚点随源码更新；r0 规格见 mutation-spec.r0.json
const SITE1 = lineOf(CLI, 'unreadableRunMetaExitAt(layout, stage, resolution.unreadable)');
const SITE2 = lineOf(CLI, 'unreadableRunMetaExitAt(ref.layout, stage, resolution.unreadable)');
const SITE3 = lineOf(TOPIC_ARGS, 'unreadableRunMetaExitAt(layout, stage, resolution.unreadable)');
const SITE4 = lineOf(HOOKS, 'unreadableRunMetaExitAt({ archiveRoot: ctx.archiveRoot, topic: loc.topic }, loc.stage, res.unreadable)');
const SITE5 = lineOf(CLI, 'unreadableRunMetaExitAt(ref.layout, stage, scan.unreadable)');
const PINNED = lineOf(CLI, 'unreadableRunMetaExitAt(ref.layout, stage, [pinnedId])');
// 第 6、7 处（gate.ts 的出口构造函数）
const AWAIT = lineOf(GATE, 'unreadableRunMeta: runId ? unreadableRunMetaExitAt(layout, stage, [runId]) : NO_RUN_ID_NO_FILE');
const APPROVE = lineOf(GATE, '(i.runId ? unreadableRunMetaExitAt(i.layout, i.stage, [i.runId]) : NO_RUN_ID_NO_FILE)');
const APPROVE_MISSING_TAIL = lineOf(GATE, "'  这会留下一条 run_id 为空的放弃记录，请在 reason 里写明缘由。',");
const APPROVE_ORDER = blockOf(GATE, '先把它恢复成可读，恢复后直接重新 approve', '重跑同样会被拒绝');
const swapped = (() => {
  const ls = APPROVE_ORDER.split('\n').filter((l) => l.length > 0);
  if (ls.length !== 6) throw new Error(`APPROVE_ORDER 应为 6 行，实为 ${ls.length}`);
  return [ls[3], ls[4], ls[5], ls[0], ls[1], ls[2]].join('\n') + '\n';
})();
// 代码双审 r1 新增的判据面
const LIST_CAP = lineOf(META, 'const shown = files.slice(0, UNREADABLE_RUN_META_LIST_LIMIT);');
const STAMP = lineOf(META, '判别 ①：本工具的构建是 ${build.git_head.slice(0, 7)}');
const REGISTERED = lineOf(META, '登记过的运行，提交时的留痕核对会以「运行清单已丢失」拦下 git commit；没登记的删掉则无从追查');

const cases = [
  { id: 'M1', desc: '共用段首句换回循环出口', file: META, find: BODY_HEAD,
    replace: "  '  出口是重跑一次该阶段双审：新运行会先落一份可读的留痕，判定随即恢复。\\n' +\n", expect: S.exit },
  { id: 'M2', desc: '共用段 ② 删掉「只能在终端做」一句', file: META, find: BODY_TERMINAL, replace: "  '\\n' +\n", expect: S.exit },
  { id: 'M3', desc: '共用段 ③ 删掉「工具内没有出口」', file: META, find: BODY_NO_EXIT, replace: sub(BODY_NO_EXIT, '工具内没有出口。', ''), expect: S.exit },
  { id: 'M4', desc: '共用段 ① 删掉 MANUAL 落点', file: META, find: BODY_MANUAL, replace: sub(BODY_MANUAL, '按 MANUAL §3.6「升级」', ''), expect: S.exit },
  { id: 'M5', desc: 'unreadableRunMetaExit 不列文件', file: META, find: FILE_LIST, replace: "    '' +\n", expect: S.exit },
  { id: 'M6', desc: '第 1 处 review --start 去掉共用出口', file: CLI, find: SITE1, replace: "        '',\n", expect: S.claim },
  { id: 'M7', desc: '第 2 处 topic claim 去掉共用出口', file: CLI, find: SITE2, replace: "        '',\n", expect: S.claim },
  { id: 'M8', desc: '第 3 处 topic resolve 去掉共用出口', file: TOPIC_ARGS, find: SITE3, replace: "            '',\n", expect: S.claim },
  { id: 'M9', desc: '第 4 处 Hook 去掉共用出口', file: HOOKS, find: SITE4, replace: "            '',\n", expect: S.hooks },
  { id: 'M10', desc: '第 5 处 gate 一份都读不出去掉共用出口', file: CLI, find: SITE5, replace: "        '',\n", expect: S.loop },
  { id: 'M11', desc: 'awaitApprovalRecovery 读不出不带共用出口', file: GATE, find: AWAIT, replace: "    unreadableRunMeta: '',\n", expect: S.exit },
  { id: 'M12', desc: 'approveForkRecovery 读不出不带共用出口', file: GATE, find: APPROVE, replace: "      '',\n", expect: S.exit },
  { id: 'M13', desc: 'approveForkRecovery 缺 run_id 也拼共用出口', file: GATE, find: APPROVE_MISSING_TAIL,
    replace: "      '  这会留下一条 run_id 为空的放弃记录，请在 reason 里写明缘由。\\n' + unreadableRunMetaExitAt(i.layout, i.stage, ['x']),\n", expect: S.exit },
  { id: 'M14', desc: 'approve 出口 abandon 排到恢复之前', file: GATE, find: APPROVE_ORDER, replace: swapped, expect: S.exit },
  { id: 'M15', desc: 'gate --run-id 钉住读不出那一格去掉共用出口', file: CLI, find: PINNED, replace: "        '',\n", expect: S.loop },
  { id: 'M16', desc: '清单不封顶', file: META, find: LIST_CAP, replace: '  const shown = files;\n', expect: S.exit },
  { id: 'M17', desc: '判别 ① 不给构建标识', file: META, find: STAMP, replace: "      ? '' +\n", expect: S.exit },
  { id: 'M18', desc: '删除句丢掉「登记」前提', file: META, find: REGISTERED,
    replace: sub(REGISTERED, '登记过的运行，提交时的留痕核对会以「运行清单已丢失」拦下 git commit；没登记的删掉则无从追查、判定悄悄降级；', '提交时的留痕核对会以「运行清单已丢失」拦下 git commit；'), expect: S.exit },
  { id: 'M19', desc: 'awaitApprovalRecovery 在 runId 为 null 时也拼共用出口', file: GATE, find: AWAIT,
    replace: sub(AWAIT, ': NO_RUN_ID_NO_FILE', ": unreadableRunMetaExitAt(layout, stage, ['x'])"), expect: S.exit },
];

// 每条 find 在目标文件中恰好一处（装置闸 7 同口径，这里先核一遍）
for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，写入 ${OUT}`);
