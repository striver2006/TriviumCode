// 生成「事后收尾余项」的源码变异规格（计划 r2 §4.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const REVIEW = 'src/trivium/review.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const REPORT = 'src/trivium/report.ts';
const EXEC = 'src/trivium/util/exec.ts';
const S = {
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
  report: 'dist/test/test/unit/report.test.js',
  detach: 'dist/test/test/integration/worker-detach.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";

const PREP_BY = "        termination: { by: 'prepare_exception', exit_code: exitCodeOf(e) },\n      });\n      for (const line of finalizeLines(fin, runId, '准备阶段失败')) warn(line);";
const SYNC_BY = "      termination: { by: 'sync_exception', exit_code: exitCodeOf(e) },";
const SYNC_GONE = "      workerGone: true,\n" + SYNC_BY;
// 代码双审 r1（CODEX-01）之后，监听同时留住错误对象；M11 改为「监听整个去掉」（与原「挪回 pid 检查之后」同效：pid 缺失时无监听 ⇒ 崩溃）。
// r1 之前的规格与读数留在 mutation-spec.r0.json / mutation-output.r0.txt。
const ERR_LISTENER =
  "    const errorArrived = new Promise<void>((resolve) => {\n      child.once('error', (err: NodeJS.ErrnoException) => {\n        seen.err = err;\n        resolve();\n      });\n    });\n";
const CAUSE_MSG = '      const msg = `spawn 未返回 pid：${bin}（${cause}）`;\n';

const cases = [
  { id: 'M1', desc: 'prepareRun 的 catch 不收尾 ⇒ P1（骨架停在 running）', file: REVIEW,
    find: '    if (skeletonWritten) {\n', replace: `    if (skeletonWritten && ${NEVER}) {\n`, expect: S.gateLoop },
  { id: 'M2', desc: 'prepareRun 收尾时 by 写成 worker_exception ⇒ P1（termination 深相等）', file: REVIEW,
    find: PREP_BY, replace: PREP_BY.replace("by: 'prepare_exception'", "by: 'worker_exception'"), expect: S.gateLoop },
  { id: 'M3', desc: 'startRun 主 catch 不收尾 ⇒ P3（派生前失败的骨架停在 running）', file: PROTO,
    find: '    if (!childBorn) {\n', replace: `    if (!childBorn && ${NEVER}) {\n`, expect: S.gateLoop },
  { id: 'M4', desc: 'startRun 主 catch 去掉 !childBorn（子进程诞生之后也收尾）⇒ P4（刚返回时已是 failed）', file: PROTO,
    find: '    if (!childBorn) {\n', replace: '    if (!childBorn || true) {\n', expect: S.gateLoop },
  { id: 'M5', desc: 'runReviewLocked 的 catch 不收尾（workerGone 恒假 ⇒ 第一步跳过）⇒ P5', file: REVIEW,
    find: SYNC_GONE, replace: SYNC_GONE.replace('workerGone: true', `workerGone: ${NEVER}`), expect: S.gateLoop },
  { id: 'M6', desc: '同步路径收尾时 by 写成 prepare_exception ⇒ P5（termination 深相等）', file: REVIEW,
    find: SYNC_BY, replace: SYNC_BY.replace("'sync_exception'", "'prepare_exception'"), expect: S.gateLoop },
  { id: 'M7', desc: 'unlistedLabel 去掉 prepare_exception 分支 ⇒ V8（落进兜底说明）', file: REPORT,
    find: "  } else if (meta.status === 'failed' && meta.termination?.by === 'prepare_exception') {\n",
    replace: "  } else if (meta.status === 'failed' && (meta.termination?.by as string | undefined) === '__never__') {\n",
    expect: S.report },
  { id: 'M8', desc: 'startRun 改回在调用 spawnDetached 之前置位（r1 的判据）⇒ P3b（子进程未诞生的一格不收尾）', file: PROTO,
    find: '    const spawned = await spawnDetached(\n', replace: '    childBorn = true;\n    const spawned = await spawnDetached(\n',
    expect: S.gateLoop },
  { id: 'M9', desc: 'spawnDetached 把 onSpawned 挪到建日志目录之前 ⇒ U1（诞生之前的失败也触发回调）', file: EXEC,
    find: "  const { promises: fsp } = await import('node:fs');\n  await fsp.mkdir(pathDirname(opts.logFile), { recursive: true });\n",
    replace: "  const { promises: fsp } = await import('node:fs');\n  opts.onSpawned?.(-1);\n  await fsp.mkdir(pathDirname(opts.logFile), { recursive: true });\n",
    expect: S.detach },
  { id: 'M10', desc: 'prepareRun 去掉 skeletonWritten 守卫 ⇒ B7（骨架之前的失败多出一行「未回写：归档里没有」）', file: REVIEW,
    find: '    if (skeletonWritten) {\n', replace: '    if (skeletonWritten || true) {\n', expect: S.gateLoop },
  { id: 'M11', desc: "spawnDetached 去掉 'error' 监听（实施期修正的既有缺陷的反面）⇒ U2（ENOENT 时进程因未处理的 error 事件崩溃）", file: EXEC,
    find: ERR_LISTENER,
    replace: '    const errorArrived = new Promise<void>(() => { void seen; });\n',
    expect: S.detach },
  { id: 'M13', desc: 'pid 缺失时报错正文不带成因（代码双审 r1 CODEX-01 的反面）⇒ U2（报错与 worker.log 应含 ENOENT 与可执行文件路径）', file: EXEC,
    find: CAUSE_MSG,
    replace: "      const msg = `spawn 未返回 pid${''.slice(0, 0 * cause.length)}`;\n",
    expect: S.detach },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [REVIEW, PROTO, REPORT, EXEC], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
