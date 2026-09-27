// 生成「闸门拦截不留骨架」的源码变异规格（计划 r2 §4.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const REVIEW = 'src/trivium/review.ts';
const STATE = 'src/trivium/state.ts';
const S = {
  state: 'dist/test/test/unit/state.test.js',
  noArtifacts: 'dist/test/test/integration/no-artifacts.test.js',
  codeStage: 'dist/test/test/integration/code-stage.test.js',
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
};

const review = read(REVIEW);
const at = (needle, from = 0) => {
  const i = review.indexOf(needle, from);
  if (i < 0) throw new Error(`锚点没找到：${needle.slice(0, 50)}`);
  return i;
};
// 代码双审 r1（CODEX-01）之后比较-交换也在 try 里：闸门块与落盘段同一缩进（4 格），挪位置不必再改缩进。
// r1 之前的规格与读数留在 mutation-spec.r0.json / mutation-output.r0.txt。

// 闸门块：try 里第一段，从 `if (holdsGate) {` 到它的收尾（不含随后的空行）
const TRY_OPEN = '  const holdsGate = !skipVerdict?.skipped;\n  try {\n';
const gateStart = at(TRY_OPEN) + TRY_OPEN.length;
const gateEnd = at('\n    }\n\n    /*\n     * ── 到这里为止**不写任何审查工件与留痕**', gateStart) + '\n    }\n'.length;
const gateIf = review.slice(gateStart, gateEnd); // "    if (holdsGate) {...}\n"
if (!gateIf.startsWith('    if (holdsGate) {\n      const g = await setGateChecked({')) throw new Error('闸门块形状不符');
const afterGate = gateEnd + '\n'.length; // 跳过那一个空行

// M1：闸门块挪回 registerRun 之后（原位置）
const REG = '    await registerRun(ref.layout, meta, taskLock);\n';
const regEnd = at(REG, gateEnd) + REG.length;
const m1find = review.slice(gateStart, regEnd);
const m1replace = review.slice(afterGate, regEnd) + gateIf;

// M2：闸门块挪到 brief 之后、建运行目录与骨架之前
const RUNDIR = '    await ensureDir(runDirBase);\n';
const runDirAt = at(RUNDIR, gateEnd);
const m2find = review.slice(gateStart, runDirAt + RUNDIR.length);
const m2replace = review.slice(afterGate, runDirAt) + gateIf + RUNDIR;

// M7：重置收工阻断计数移到 try 之外。比较-交换已在 try 里，「try 之外」只剩 try 之前——计数先于置闸门执行，
// 删不掉时根本走不到置闸门：B7 的「闸门置过、回收后留一条 idle」断言红（咬住的依据是闸门项缺席，而非停在 running）
const RESET_IN_TRY =
  '    // 新一轮开始，上一轮的收工阻断计数作废（否则跨轮累积后首次 Stop 就超限放行）。\n' +
  '    // 它会抛（目录里有删不掉的东西），所以放在 try 里，抛了也经下面的回收（计划 r2 §3.1，r1 AGY-02 ≡ GLM-02）\n' +
  '    if (holdsGate) {\n' +
  "      const { resetStopBlockCount } = await import('./lock.js');\n" +
  '      await resetStopBlockCount(ctx.triviumDir, ref.topic, stage);\n' +
  '    }\n';
const resetAt = at(RESET_IN_TRY, gateEnd);
const m7find = review.slice(gateStart - '  try {\n'.length, resetAt + RESET_IN_TRY.length);
const m7replace =
  '  if (holdsGate) {\n' +
  "    const { resetStopBlockCount } = await import('./lock.js');\n" +
  '    await resetStopBlockCount(ctx.triviumDir, ref.topic, stage);\n' +
  '  }\n' +
  '  try {\n' + review.slice(gateStart, resetAt);

const CATCH =
  '  } catch (e) {\n' +
  '    // 比较-交换起的任何失败：闸门由本函数回收（只回收仍记着本 runId 且仍是 running 的——被拦时槽位是别的 run，不动）\n' +
  '    if (holdsGate) {\n' +
  '      await releaseRunningGateEntry({\n';

const cases = [
  { id: 'M1', desc: '置闸门挪回 registerRun 之后（原位置）⇒ B1（被拦时已写下 brief、骨架、登记、运行目录）', file: REVIEW,
    find: m1find, replace: m1replace, expect: S.noArtifacts },
  { id: 'M2', desc: '置闸门挪到 brief 之后、骨架之前 ⇒ B3（便利副本被覆盖、新补丁与 brief 落盘）', file: REVIEW,
    find: m2find, replace: m2replace, expect: S.codeStage },
  { id: 'M3', desc: '落盘段的 catch 不回收闸门 ⇒ B5（闸门停在 running）', file: REVIEW,
    find: CATCH, replace: CATCH.replace('    if (holdsGate) {\n', "    if (holdsGate && process.env['TRIVIUM_MUT_NEVER'] === '1') {\n"),
    expect: S.gateLoop },
  { id: 'M4', desc: '落盘段的 catch 吞掉异常不再抛 ⇒ B5（startRun 拿到 undefined 在 try 外崩溃，主题锁不放）', file: REVIEW,
    find: '      });\n    }\n    throw e;\n  }\n}\n\n/**\n * 执行阶段',
    replace: '      });\n    }\n    void e;\n    return undefined as never;\n  }\n}\n\n/**\n * 执行阶段',
    expect: S.gateLoop },
  { id: 'M5', desc: 'releaseRunningGateEntry 去掉 runId 比较 ⇒ U1 ②（旧 run 清掉新一轮的护栏）', file: STATE,
    find: "      expect: { state: ['running'], runId: i.runId, allowMissing: false },\n",
    replace: "      expect: { state: ['running'], allowMissing: false },\n", expect: S.state },
  { id: 'M6', desc: 'releaseRunningGateEntry 的 allowMissing 回到缺省 true ⇒ U1 ④（槽位不存在时凭空造 idle）', file: STATE,
    find: "      expect: { state: ['running'], runId: i.runId, allowMissing: false },\n",
    replace: "      expect: { state: ['running'], runId: i.runId },\n", expect: S.state },
  { id: 'M7', desc: '重置收工阻断计数移到 try 之外（r1 之后只能排在置闸门之前）⇒ B7（计数删不掉时没走到置闸门，闸门项缺席）', file: REVIEW,
    find: m7find, replace: m7replace, expect: S.gateLoop },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [REVIEW, STATE], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
