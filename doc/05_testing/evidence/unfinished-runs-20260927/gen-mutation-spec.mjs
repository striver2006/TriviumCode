// 生成「未收尾运行的留痕与复盘可见性」的源码变异规格（计划 r2 §4.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
// M16（schema）不在这里：装置只认 src/*.ts，见同目录 contract-mutation.mjs。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const META = 'src/trivium/meta.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const REPORT = 'src/trivium/report.ts';
const S = {
  failed: 'dist/test/test/unit/run-meta-failed.test.js',
  cancel: 'dist/test/test/unit/run-meta-cancel.test.js',
  report: 'dist/test/test/unit/report.test.js',
  proto: 'dist/test/test/integration/run-protocol.test.js',
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
};

// M2：worker 异常分支的归档侧收尾整块挪到 patchStatus 之后（message 随之不再带收尾结果）
const proto = read(PROTO);
const m2Start = proto.indexOf('    const notes: string[] = [];\n');
const m2Patch = proto.indexOf('    // 终态必须写下来，否则 --wait 只能等到心跳过期才判失联\n', m2Start);
const m2End = proto.indexOf('    });\n', m2Patch) + '    });\n'.length;
if (m2Start < 0 || m2Patch < 0) throw new Error('M2 锚点没找到');
const m2find = proto.slice(m2Start, m2End);
const m2patchText = proto.slice(m2Patch, m2End).replace('s.message = [msg, ...notes].join(\' ｜ \');', 's.message = msg;');
if (m2patchText === proto.slice(m2Patch, m2End)) throw new Error('M2 的 message 行没替换上');
const m2replace = m2patchText + proto.slice(m2Start, m2Patch);

const cases = [
  { id: 'M1', desc: 'worker 异常分支不调 finalizeFailedRunMeta ⇒ W1', file: PROTO,
    find: '    if (id0) {\n      const fin = await finalizeFailedRunMeta({\n',
    replace: "    if (id0 && process.env['TRIVIUM_MUT_NEVER'] === '1') {\n      const fin = await finalizeFailedRunMeta({\n",
    expect: S.gateLoop },
  { id: 'M2', desc: 'worker 异常分支的收尾挪到 patchStatus 之后 ⇒ W1 / W2（同一条用例：顺序由 W2 的修改时间断言钉，message 断言随之也红）', file: PROTO,
    find: m2find, replace: m2replace, expect: S.gateLoop },
  { id: 'M3', desc: 'worker 异常分支不传 termination ⇒ W1', file: PROTO,
    find: "        workerGone: true,\n        termination: { by: 'worker_exception', exit_code: exitCode },\n",
    replace: '        workerGone: true,\n        termination: undefined as never,\n', expect: S.gateLoop },
  { id: 'M4', desc: 'worker_lost 分支不调收尾 ⇒ L1', file: PROTO,
    find: '      if (id0) {\n        const fin = await finalizeFailedRunMeta({\n',
    replace: "      if (id0 && process.env['TRIVIUM_MUT_NEVER'] === '1') {\n        const fin = await finalizeFailedRunMeta({\n",
    expect: S.proto },
  { id: 'M5', desc: 'worker_lost 分支硬传 workerGone: true ⇒ L2（heartbeat_stale 且进程在）', file: PROTO,
    find: '          workerGone: goneForArchive,\n', replace: '          workerGone: true,\n', expect: S.proto },
  { id: 'M6', desc: 'worker_lost 分支改用改写之后的判定（phase 已是 failed）⇒ L3', file: PROTO,
    find: '          ? (await workerConfirmedGone(pre, fallbackPid)).gone\n',
    replace: "          ? (await workerConfirmedGone({ ...pre, phase: 'failed' }, fallbackPid)).gone\n", expect: S.proto },
  { id: 'M7', desc: '第一步去掉主题任务锁 ⇒ F6', file: META,
    find: '  return withTopicLock(\n    { triviumDir: i.lock.triviumDir, topic: taskLockName(i.layout.topic), heartbeatStaleMs: i.lock.heartbeatStaleMs },\n',
    replace: '  return (async (fn: () => Promise<FinalizeStep>) => fn())(\n', expect: S.failed },
  { id: 'M8', desc: '通用函数写死 cancelled（忽略目标终态）⇒ F1', file: META,
    find: '      meta.status = i.terminal;\n', replace: "      meta.status = 'cancelled';\n", expect: S.failed },
  { id: 'M9', desc: '第二步判据写死 cancelled ⇒ F3', file: META,
    find: '  if (m?.status !== i.terminal) {\n', replace: "  if (m?.status !== 'cancelled') {\n", expect: S.failed },
  { id: 'M10', desc: '第二步放宽为「run.json 是任一终态就照抄」⇒ F4', file: META,
    find: '  if (m?.status !== i.terminal) {\n', replace: "  if (m === null || m.status === 'running') {\n", expect: S.failed },
  { id: 'M11', desc: '取消轮也写 termination ⇒ R1（其余逐键不变）', file: META,
    find: "  return finalizeUnfinishedRunMeta({ ...i, terminal: 'cancelled' });\n",
    replace: "  return finalizeUnfinishedRunMeta({ ...i, terminal: 'cancelled', termination: { by: 'worker_exception', exit_code: 0 } });\n",
    expect: S.cancel },
  { id: 'M12', desc: 'report 不收 unlistedRuns ⇒ V1', file: REPORT,
    find: '    unlistedRuns.push(...(await collectUnlistedRuns(layout, stage, listed, notes)));\n',
    replace: '    void listed;\n', expect: S.report },
  { id: 'M13', desc: 'unlistedRuns 不减去时间线选中的运行 ⇒ V2', file: REPORT,
    find: '    if (runId === undefined || listed.has(runId)) continue;\n',
    replace: '    if (runId === undefined) continue;\n', expect: S.report },
  { id: 'M14', desc: '头部「轮次总数」不追加「另有 K 次」⇒ V1', file: REPORT,
    find: '      (r.unlistedRuns.length > 0 ? `（另有',
    replace: '      (false ? `（另有', expect: S.report },
  { id: 'M15', desc: 'running 的说明改成断言式「未收尾」⇒ V3', file: REPORT,
    find: "  else if (meta.status === 'running') label = '进行中，或没走到收尾';\n",
    replace: "  else if (meta.status === 'running') label = '未收尾';\n", expect: S.report },
  { id: 'M17', desc: 'worker_lost 分支去掉「status.json 读不到时按 worker.pid 判」那一格 ⇒ L5', file: PROTO,
    find: '          : fallbackPid !== null && !(await processAlive(fallbackPid, null)).alive;\n',
    replace: '          : false;\n', expect: S.proto },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
}
const spec = { targets: [META, PROTO, REPORT], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
