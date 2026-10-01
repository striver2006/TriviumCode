// 生成「漂移比不了不放行」（EV-139）的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/lock-reclaim-enoent-20260930/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/drift-uncomparable-20261001/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const FREEZE = 'src/trivium/freeze.ts';
const GUARD = 'src/trivium/guard.ts';
const REVIEW = 'src/trivium/review.ts';
const RENDER = 'src/trivium/render.ts';
const REPORT = 'src/trivium/report.ts';
const META = 'src/trivium/meta.ts';
const GIT = 'src/trivium/util/git.ts';
const STUB = 'src/trivium/adapters/stub.ts';
const S = {
  drift: 'dist/test/test/unit/freeze-drift.test.js',
  unknown: 'dist/test/test/unit/drift-unknown.test.js',
  report: 'dist/test/test/unit/report.test.js',
  fault: 'dist/test/test/integration/fault-injection.test.js',
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

const STRICT = lineOf(FREEZE, 'entries = await diffTreesNameStatus(projectRoot, before.treeHash, afterTreeHash);');
const CATCH = lineOf(FREEZE, "return { kind: 'unknown', ...(await classifyCompareFailure(projectRoot, before.treeHash, afterTreeHash, e)) };");
const ACTION = blockOf(FREEZE, '// 比不了 ⇒ 排除不了被审范围内的文件被改，按相关漂移那一档', "return cfg.review.on_drift_related === 'fail' ? 'fail' : 'warn';");
// 代码双审 r1 修订后（CODEX-01/02 ≡ GLM-02/03）锚点随源码更新；M16 为修订新增
const TIMEOUT = lineOf(FREEZE, 'if (err instanceof GitTimeoutError) return timedOut(err, GIT_DEFAULT_TIMEOUT_MS);');
const BUDGET = lineOf(FREEZE, 'present = await exists(projectRoot, tree, { timeoutMs: remaining() });');
const GONE = lineOf(FREEZE, "if (!present) return { cause: 'object_gone', detail: goneDetail };");
const SHAPE = lineOf(FREEZE, 'if (!OBJECT_NAME_RE.test(before.treeHash) || !OBJECT_NAME_RE.test(afterTreeHash)) {');
const POLICY = lineOf(REVIEW, "verdict.drift.kind === 'related' || verdict.drift.kind === 'unknown'");
const REASON = lineOf(REVIEW, '? { unknown_reason: { cause: verdict.drift.cause, detail: verdict.drift.detail } }');
const WARNCASE = lineOf(GUARD, "    case 'unknown':");
const REPORTFLAG = lineOf(REPORT, 'base.guardFlags.push(`漂移无法判定（${describeDriftUnknown(driftUnknown)}，${meta.snapshot.drift.policy}）`);');
const RENDERFLAG = lineOf(RENDER, 'if (input.driftUnknown) {');
const SUMMARY = lineOf(META, 'if (unknownReason) {');
const ZFLAG = lineOf(GIT, "['diff-tree', '-r', '--name-status', '--no-renames', '-z', '--no-commit-id', treeA, treeB],");
const TMPGUARD = lineOf(STUB, 'if (!inTmp) {');

const cases = [
  { id: 'M1', desc: '3.a 换回失败返回 [] 的 diffTrees', file: FREEZE, find: STRICT,
    replace: "entries = (await (await import('./util/git.js')).diffTrees(projectRoot, before.treeHash, afterTreeHash)).map((p) => ({ status: 'M', path: p }));\n",
    expect: S.drift },
  { id: 'M2', desc: '比对失败时返回 none', file: FREEZE, find: CATCH, replace: sub(CATCH, "return { kind: 'unknown', ...(await classifyCompareFailure(projectRoot, before.treeHash, afterTreeHash, e)) };", "void e; return { kind: 'none' };"), expect: S.drift },
  { id: 'M3', desc: 'driftAction 的 unknown 改跟 on_drift', file: FREEZE, find: ACTION, replace: sub(ACTION, 'on_drift_related', 'on_drift'), expect: S.drift },
  { id: 'M4', desc: 'driftAction 的 unknown 恒 warn', file: FREEZE, find: ACTION, replace: sub(ACTION, "return cfg.review.on_drift_related === 'fail' ? 'fail' : 'warn';", "return 'warn';"), expect: S.drift },
  { id: 'M5', desc: '分原因去掉超时分支', file: FREEZE, find: TIMEOUT, replace: '// 变异 M5：去掉超时分支\n', expect: S.drift },
  { id: 'M6', desc: '分原因不用 treeExists 的结果（object_gone 判据去掉）', file: FREEZE, find: GONE, replace: '    void present; void goneDetail;\n', expect: S.drift },
  { id: 'M7', desc: 'run.json 的 policy 条件不含 unknown', file: REVIEW, find: POLICY, replace: sub(POLICY, " || verdict.drift.kind === 'unknown'", ''), expect: S.fault },
  { id: 'M8', desc: 'run.json 不写 unknown_reason', file: REVIEW, find: REASON, replace: sub(REASON, '{ unknown_reason: { cause: verdict.drift.cause, detail: verdict.drift.detail } }', '{}'), expect: S.fault },
  { id: 'M9', desc: '人读告警的 unknown 分支直接 break', file: GUARD, find: WARNCASE, replace: "    case 'unknown': break;\n", expect: S.unknown },
  { id: 'M10', desc: 'report 不推「漂移无法判定」旗标', file: REPORT, find: REPORTFLAG, replace: '    void driftUnknown;\n', expect: S.report },
  { id: 'M11', desc: '审查文档不换旗标', file: RENDER, find: RENDERFLAG, replace: sub(RENDERFLAG, 'if (input.driftUnknown) {', 'if (false) {'), expect: S.unknown },
  { id: 'M12', desc: '严格比对去掉 -z', file: GIT, find: ZFLAG, replace: sub(ZFLAG, "'-z', ", ''), expect: S.drift },
  { id: 'M13', desc: '去掉 tree 值的形状闸', file: FREEZE, find: SHAPE, replace: sub(SHAPE, 'if (!OBJECT_NAME_RE.test(before.treeHash) || !OBJECT_NAME_RE.test(afterTreeHash)) {', 'if (false) {'), expect: S.drift },
  { id: 'M14', desc: '去掉 prune_objects 桩的临时夹具自缚', file: STUB, find: TMPGUARD, replace: sub(TMPGUARD, 'if (!inTmp) {', 'if (false) {'), expect: S.unknown },
  { id: 'M15', desc: 'summarizeRun 不打「漂移无法判定」', file: META, find: SUMMARY, replace: sub(SUMMARY, 'if (unknownReason) {', 'if (false) {'), expect: S.unknown },
  { id: 'M16', desc: '核对对象不传共享预算（回到各走缺省 120 s）', file: FREEZE, find: BUDGET, replace: sub(BUDGET, ', { timeoutMs: remaining() }', ''), expect: S.drift },
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
