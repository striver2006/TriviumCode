// 生成「必读与禁读交集校验」（EV-02）的源码变异规格（计划 r2 §3.3；代码双审 r1 之后的修订版，r1 版存为 gen-mutation-spec.r1.mjs）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/config-dead-keys-20261001/gen-mutation-spec.mjs 的形态。每条只指定一个期望套件（装置每条只收一个套件）。
// 集成套件经打包 CLI 跨进程跑，装置与预跑脚本都用 build.mjs --with-tests 重建（含 bundle）。
// 用法（在仓库根）：node doc/05_testing/evidence/mustread-deny-intersection-20261002/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BRIEF = 'src/trivium/brief.ts';
const REVIEW = 'src/trivium/review.ts';
const RP = 'src/trivium/run-protocol.ts';
const S = {
  unit: 'dist/test/test/unit/mustread-deny.test.js',
  integ: 'dist/test/test/integration/mustread-deny.test.js',
};

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const CONTAINS = lineOf(BRIEF, '} else if (isUnder(denyAbs, entryAbs)) {');
const READABLE = lineOf(BRIEF, 'if (readable(hitPoint)) continue;');
const OWN = lineOf(BRIEF, "if (category === 'own-run-material') continue;");
const ENTRY_ABS = lineOf(BRIEF, 'const entryAbs = normalizeAbs(expandHomeSpellings(entry), ctx.projectRoot);');
const CAP = lineOf(BRIEF, 'if (max !== undefined && groups.length > max) {');
const HIT_ENTRY = lineOf(BRIEF, 'hitPoint = entryAbs;');
const SIDES_TEXT = lineOf(BRIEF, "涉及 ${g.critics.join('、')} 侧");
const BODY_ALL = lineOf(BRIEF, 'const body = rest.length === 0');
const PLAIN = lineOf(BRIEF, 'return detail.startsWith(WARNING_MARK) ? detail.slice(WARNING_MARK.length) : detail;');

const CTX_THROW = lineOf(REVIEW, 'if (contextConflicts.some((s) => s.conflicts.length > 0)) {');
const CTX_RAW = lineOf(REVIEW, 'return { critic, conflicts: opts.contextPaths.flatMap((c) => findDenyConflicts(c, denyPaths, denyCtx)) };');
const KEEP_TRUE = lineOf(REVIEW, 'if (conflicts.length === 0) return true;');
const KEEP_CONF = lineOf(REVIEW, 'const conflicts = findDenyConflicts(pathOf(it), snap.denyPaths, denyCtx);');
const META_W = lineOf(REVIEW, 'meta.gate.warnings = [...(meta.gate.warnings ?? []), ...mustReadPrunedAll.map((w) => plainWarningText(w.detail))];');
const META_IF = lineOf(REVIEW, 'if (mustReadPrunedAll.length > 0) {');
const EXEC_W = lineOf(REVIEW, 'const warnings = [...rc.mustReadPruned.map((w) => plainWarningText(w.detail)), ...renderGuardWarnings(verdict)];');

const START_W = lineOf(RP, '...rc.mustReadPruned,');
const INLINE_W = lineOf(RP, 'warnings: [],');

const cases = [
  { id: 'M1', desc: '去掉 contains 方向（目录罩住禁读条目不算）', file: BRIEF, find: CONTAINS,
    replace: sub(CONTAINS, 'isUnder(denyAbs, entryAbs)', 'false'), expect: S.unit },
  { id: 'M2', desc: 'under 方向不跳具名放行', file: BRIEF, find: READABLE,
    replace: sub(READABLE, 'if (readable(hitPoint))', "if (direction === 'contains' && readable(hitPoint))"), expect: S.unit },
  { id: 'M3', desc: '不跳己方运行材料', file: BRIEF, find: OWN,
    replace: sub(OWN, "if (category === 'own-run-material') continue;", 'void 0;'), expect: S.unit },
  { id: 'M4', desc: '条目不展开 ~', file: BRIEF, find: ENTRY_ABS,
    replace: sub(ENTRY_ABS, 'normalizeAbs(expandHomeSpellings(entry), ctx.projectRoot)', 'normalizeAbs(entry, ctx.projectRoot)'), expect: S.unit },
  { id: 'M5', desc: '条目不归一（裸字符串比较）', file: BRIEF, find: ENTRY_ABS,
    replace: sub(ENTRY_ABS, 'normalizeAbs(expandHomeSpellings(entry), ctx.projectRoot)', 'expandHomeSpellings(entry)'), expect: S.unit },
  { id: 'M6', desc: '--context 撞上不拒跑', file: REVIEW, find: CTX_THROW,
    replace: sub(CTX_THROW, 'contextConflicts.some((s) => s.conflicts.length > 0)', 'false'), expect: S.integ },
  { id: 'M7', desc: '渲染段不剔除自动条目', file: REVIEW, find: KEEP_TRUE,
    replace: sub(KEEP_TRUE, 'conflicts.length === 0', 'true'), expect: S.integ },
  { id: 'M8', desc: '剔除不按侧（任一侧撞上就从全部侧剔）', file: REVIEW, find: KEEP_CONF,
    replace: sub(KEEP_CONF, 'findDenyConflicts(pathOf(it), snap.denyPaths, denyCtx)',
      'sides.flatMap((c) => findDenyConflicts(pathOf(it), snapshots[c]!.denyPaths, denyContextFor(cfg, ctx.projectRoot, c)))'),
    expect: S.integ },
  { id: 'M9', desc: 'startRun 不追加 mustReadPruned', file: RP, find: START_W,
    replace: sub(START_W, '...rc.mustReadPruned,', '// 变异：不追加'), expect: S.integ },
  { id: 'M10', desc: 'executeRun 不并入（同步路径看不到）', file: REVIEW, find: EXEC_W,
    replace: sub(EXEC_W, '...rc.mustReadPruned.map((w) => plainWarningText(w.detail)), ', ''), expect: S.integ },
  { id: 'M11', desc: '64 文案只写第一侧', file: BRIEF, find: SIDES_TEXT,
    replace: sub(SIDES_TEXT, "${g.critics.join('、')}", '${g.critics[0]}'), expect: S.unit },
  { id: 'M12', desc: '判必读清单的产物而不是 --context 原始写法', file: REVIEW, find: CTX_RAW,
    replace: sub(CTX_RAW, 'opts.contextPaths.flatMap(',
      "mustRead.filter((e) => e.source === 'context').map((e) => e.path).flatMap("), expect: S.integ },
  { id: 'M13', desc: '辅助函数喂原始写法而不是展开归一后的路径', file: BRIEF, find: HIT_ENTRY,
    replace: sub(HIT_ENTRY, 'hitPoint = entryAbs;', 'hitPoint = entry;'), expect: S.unit },
  { id: 'M14', desc: 'contains 方向不跳具名放行', file: BRIEF, find: READABLE,
    replace: sub(READABLE, 'if (readable(hitPoint))', "if (direction === 'under' && readable(hitPoint))"), expect: S.unit },
  { id: 'M15', desc: '骨架不写 gate.warnings', file: REVIEW, find: META_W,
    replace: '      void 0;\n', expect: S.integ },
  { id: 'M16', desc: '剔全部入选侧时仍写「照常列出」', file: BRIEF, find: BODY_ALL,
    replace: sub(BODY_ALL, 'rest.length === 0', 'false'), expect: S.unit },
  { id: 'M17', desc: '字符串通道不去 ⚠️ 前缀', file: BRIEF, find: PLAIN,
    replace: '  return detail;\n', expect: S.unit },
  // ── 代码双审 r1 之后追加（CODEX-02 / CODEX-03 / CODEX-06 / GLM-01）──
  { id: 'M18', desc: '跳过轮不写 gate.warnings（CODEX-03 之前的口径）', file: REVIEW, find: META_IF,
    replace: sub(META_IF, 'mustReadPrunedAll.length > 0', 'mustReadPrunedAll.length > 0 && !skipVerdict?.skipped'), expect: S.integ },
  { id: 'M19', desc: 'finished_inline 分支播报剔除告警（GLM-01）', file: RP, find: INLINE_W,
    replace: sub(INLINE_W, 'warnings: [],', 'warnings: rc.mustReadPruned,'), expect: S.integ },
  { id: 'M20', desc: '$HOME / ${HOME} 写法不展开（CODEX-02）', file: BRIEF, find: ENTRY_ABS,
    // 替换串里不能出现 `$'`：String.replace 把它当特殊替换模式（第一次预跑因此构建失败，日志留在 mutation-names-log.aborted-m20.txt）
    replace: sub(ENTRY_ABS, 'expandHomeSpellings(entry)', '(entry.charCodeAt(0) === 36 ? entry : expandHomeSpellings(entry))'), expect: S.unit },
  { id: 'M21', desc: '播报不封顶（CODEX-06）', file: BRIEF, find: CAP,
    replace: sub(CAP, 'max !== undefined && groups.length > max', 'false'), expect: S.unit },
  { id: 'M22', desc: 'run.json 写封顶版而不是全量（CODEX-06）', file: REVIEW, find: META_W,
    replace: sub(META_W, '...mustReadPrunedAll.map(', '...mustReadPruned.map('), expect: S.integ },
];

// 每条 find 在目标文件中恰好一处（装置闸 7 同口径，这里先核一遍）
for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，写入 ${OUT}`);
