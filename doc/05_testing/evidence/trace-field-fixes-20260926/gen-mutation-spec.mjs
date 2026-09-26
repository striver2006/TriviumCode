// 生成「留痕字段与误报小修」的源码变异规格：find 串从现行源码截取，逐条核对恰好出现一次，再落进 evidence。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PARSE = 'src/trivium/parse.ts';
const META = 'src/trivium/meta.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const REPORT = 'src/trivium/report.ts';
const S = {
  parse: 'dist/test/test/unit/parse.test.js',
  cancel: 'dist/test/test/unit/run-meta-cancel.test.js',
  proto: 'dist/test/test/integration/run-protocol.test.js',
  report: 'dist/test/test/unit/report.test.js',
};

// M12：把归档侧收尾整块挪到 patchStatus 之后——find 覆盖「收尾块 + patchStatus 调用」这一段连续文本
const proto = read(PROTO);
const blockStart = proto.indexOf('  /*\n   * 归档侧收尾（EV-128）');
const patchStart = proto.indexOf('  const patched = await patchStatus(runDir, (st) => {', blockStart);
const patchEnd = proto.indexOf('  });\n', patchStart) + '  });\n'.length;
if (blockStart < 0 || patchStart < 0) throw new Error('M12 锚点没找到');
const m12find = proto.slice(blockStart, patchEnd);
const m12replace = proto.slice(patchStart, patchEnd) + proto.slice(blockStart, patchStart);

const cases = [
  { id: 'M1', desc: '正则前界改回 \\b ⇒ U1（skills-src 截成 src/…）', file: PARSE,
    find: '/(?<![A-Za-z0-9_./-])(?:\\.\\/)*((?:src|', replace: '/\\b((?:src|', expect: S.parse },
  { id: 'M2', desc: '前界改成候选 ① 的 (?<![A-Za-z0-9_-])（不含 . 与 /）⇒ U3 / U4', file: PARSE,
    find: '/(?<![A-Za-z0-9_./-])(?:\\.\\/)*((?:src|', replace: '/(?<![A-Za-z0-9_-])(?:\\.\\/)*((?:src|', expect: S.parse },
  { id: 'M3', desc: '去掉 (?:\\.\\/)*（前导 ./ 不再收）⇒ U5', file: PARSE,
    find: '/(?<![A-Za-z0-9_./-])(?:\\.\\/)*((?:src|', replace: '/(?<![A-Za-z0-9_./-])((?:src|', expect: S.parse },
  { id: 'M4a', desc: 'cancelRun 硬传 workerGone: true（接线失守）⇒ E3', file: PROTO,
    find: '      workerGone: goneNow.gone,\n', replace: '      workerGone: true,\n', expect: S.proto },
  { id: 'M4b', desc: '新函数忽略 workerGone ⇒ R6', file: META,
    find: '  if (!i.workerGone) {\n', replace: '  if (false && !i.workerGone) {\n', expect: S.cancel },
  { id: 'M5', desc: '删掉「仍为 running」前提（终态也改写）⇒ R2', file: META,
    find: "  if (meta.status !== 'running') return skipped(", replace: "  if (false && meta.status !== 'running') return skipped(", expect: S.cancel },
  { id: 'M6', desc: '删掉「只写 v2」前提 ⇒ R3（v1 形状随后仍过不了 v2 校验，这一条靠跳过原因咬住）', file: META,
    find: "  if (schema !== 'trivium.run.v2') {\n", replace: "  if (false && schema !== 'trivium.run.v2') {\n", expect: S.cancel },
  { id: 'M7', desc: '回写时清空 artifacts[] ⇒ R1', file: META,
    find: "  meta.gate.state = 'cancelled';\n  await writeRunMeta(", replace: "  meta.gate.state = 'cancelled';\n  meta.artifacts = [];\n  await writeRunMeta(", expect: S.cancel },
  { id: 'M8', desc: '不做 task.json 同步（条目不改、仍报 written）⇒ R5a', file: META,
    find: "    entry.status = 'cancelled';\n", replace: '', expect: S.cancel },
  { id: 'M9', desc: 'task.json 同步改为依赖「第一步本次写了」⇒ R5c（中断后补不齐）', file: META,
    find: '  const task = await cancelTaskEntryStep(i).catch(',
    replace: "  const task = runMeta.kind !== 'written' ? skipped('mut') : await cancelTaskEntryStep(i).catch(", expect: S.cancel },
  { id: 'M10', desc: '找不到条目时补登记 ⇒ R5b', file: META,
    find: '    if (!entry) return false;\n',
    replace: "    if (!entry) { t.runs.push({ run_id: i.runId, stage: i.stage, rerun_index: 1, status: 'cancelled', review_mode: 'full', started_at: '' } as (typeof t.runs)[number]); outcome = { kind: 'written' }; return undefined; }\n",
    expect: S.cancel },
  { id: 'M11', desc: '去掉第一步的异常捕获 ⇒ R7（写失败时抛出）', file: META,
    find: "  const runMeta = await cancelRunMetaStep(i).catch((e: unknown) => skippedFromError('回写 run.json ', e));\n",
    replace: '  const runMeta = await cancelRunMetaStep(i);\n', expect: S.cancel },
  { id: 'M12', desc: '归档侧收尾挪回 patchStatus 之后 ⇒ E1 的写入先后断言', file: PROTO,
    find: m12find, replace: m12replace, expect: S.proto },
  { id: 'M13', desc: 'cancelRun 不调用归档侧收尾 ⇒ E1', file: PROTO,
    find: '  if (identity) {\n    const fin = await finalizeCancelledRunMeta({',
    replace: "  if (identity && process.env['TRIVIUM_MUT_NEVER'] === '1') {\n    const fin = await finalizeCancelledRunMeta({", expect: S.proto },
  { id: 'M14', desc: 'report 恢复读取 forged_role_file ⇒ G1', file: REPORT,
    find: '   * 这件事实际由写入前 Hook、`gate --check-artifacts` 的未登记审查件判据与提交锚承担。\n   */\n',
    replace: "   * 这件事实际由写入前 Hook、`gate --check-artifacts` 的未登记审查件判据与提交锚承担。\n   */\n  if (meta.guard.forged_role_file) base.guardFlags.push('角色后缀伪造');\n",
    expect: S.report },
  // 代码双审 r1 修订补的两条
  { id: 'M15', desc: 'consulted 一侧不做 ./ 归一 ⇒ U8（代码双审 r1 CODEX-02）', file: PARSE,
    find: '  const consulted = new Set((review.consulted ?? []).map(stripDotSlash));\n',
    replace: '  void stripDotSlash;\n  const consulted = new Set(review.consulted ?? []);\n', expect: S.parse },
  { id: 'M16', desc: '写失败告警不再说明「没有第二次机会」⇒ E6（代码双审 r1 CODEX-01）', file: PROTO,
    find: "      `${notDone}：${r.why}——这一步不会再有第二次机会：status.json 随后落终态，再跑 --cancel 会早退，` +\n        '请人工核对归档 run.json 与 task.json 的运行登记',\n",
    replace: '      `${notDone}：${r.why}`,\n', expect: S.proto },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
}
const spec = { targets: [PARSE, META, PROTO, REPORT], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
