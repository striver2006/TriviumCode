// 生成「派生后失败的孤儿worker」的源码变异规格（计划 r2 §4.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROTO = 'src/trivium/run-protocol.ts';
const REPORT = 'src/trivium/report.ts';
const EXEC = 'src/trivium/util/exec.ts';
const S = {
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
  proto: 'dist/test/test/integration/run-protocol.test.js',
  report: 'dist/test/test/unit/report.test.js',
  detach: 'dist/test/test/integration/worker-detach.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";
const RELEASE_GATE =
  '    await releaseRunningGateEntry({ triviumDir: ctx.triviumDir, topic: i.topic, stage: i.stage, runId: i.runId, heartbeatStaleMs });\n';
const STEP5 =
  "  if (st && !isTerminal(st.phase)) {\n    await soft('写 status.json 终态', () =>\n      patchStatus(i.runDir, (s) => {\n        if (isTerminal(s.phase)) return;\n";

const cases = [
  { id: 'M1', desc: '主 catch 去掉「子进程已诞生」分支（回到今天：只回收闸门、放锁）⇒ P4（run.json 停在 running、留下孤儿）', file: PROTO,
    find: '    if (born) {\n      await settleOrphanedStart({\n', replace: `    if (born && ${NEVER}) {\n      await settleOrphanedStart({\n`, expect: S.gateLoop },
  { id: 'M2', desc: 'settleOrphanedStart 不终止、直接当已退出往下走 ⇒ P4b（孤儿跑完改写 run.json 与闸门）', file: PROTO,
    find: '      isGone: born.watch.hasExited, graceMs: 5000, killWaitMs: 5000,\n', replace: '      isGone: () => true, graceMs: 5000, killWaitMs: 5000,\n', expect: S.gateLoop },
  { id: 'M3', desc: '收尾时 by 写成 prepare_exception ⇒ P4（termination 深相等）', file: PROTO,
    find: "    termination: { by: 'post_spawn_exception', exit_code: exitCodeOf(i.error) },\n",
    replace: "    termination: { by: 'prepare_exception', exit_code: exitCodeOf(i.error) },\n", expect: S.gateLoop },
  { id: 'M4', desc: '去掉第 5 步 status.json 落终态 ⇒ P4（status.json 与 --wait 断言）', file: PROTO,
    find: '        if (workerWroteTerminal || metaUnreadable) return; // phase', replace: '        if (workerWroteTerminal || metaUnreadable || true) return; // phase', expect: S.gateLoop },
  { id: 'M5', desc: '去掉第 6 步按 run_id 回收已改写成 worker 的锁 ⇒ U5①', file: PROTO,
    find: '    if (cur && cur.run_id === i.runId && cur.pid === born.pid) {\n',
    replace: `    if (cur && cur.run_id === i.runId && cur.pid === born.pid && ${NEVER}) {\n`, expect: S.proto },
  // 代码双审 r1 修订后 `t.gone` 改为局部 `gone`（t 可能为 null），锚点随之变；r0 规格与读数留 .r0 副本
  { id: 'M6', desc: 'D5 分支照样回收闸门 ⇒ U5②', file: PROTO,
    find: '  if (!gone) {\n', replace: '  if (!gone) {\n' + RELEASE_GATE, expect: S.proto },
  { id: 'M7', desc: 'hasExited() 恒返回 false ⇒ U3', file: EXEC,
    find: '      hasExited: () => child.exitCode !== null || child.signalCode !== null,\n', replace: '      hasExited: () => false,\n', expect: S.detach },
  { id: 'M8', desc: 'terminateProcessGroup 不升级 SIGKILL ⇒ U4②', file: EXEC,
    find: "  send(pid, 'SIGKILL');\n", replace: `  if (${NEVER}) send(pid, 'SIGKILL');\n`, expect: S.detach },
  { id: 'M9', desc: 'terminateProcessGroup 发信号前不问 isGone() ⇒ U4④', file: EXEC,
    find: "  if (await o.isGone()) return { gone: true, escalated: false, signals };\n  send(pid, 'SIGTERM');\n", replace: "  send(pid, 'SIGTERM');\n", expect: S.detach },
  { id: 'M10', desc: 'unlistedLabel 去掉 post_spawn_exception 分支 ⇒ V8′（落进兜底说明）', file: REPORT,
    find: "  } else if (meta.status === 'failed' && meta.termination?.by === 'post_spawn_exception') {\n",
    replace: "  } else if (meta.status === 'failed' && (meta.termination?.by as string | undefined) === '__never__') {\n", expect: S.report },
  { id: 'M11', desc: '闸门回收挪到终止之前（计划双审 r1 AGY-03）⇒ U5①（终止时闸门已不是本轮 running）', file: PROTO,
    find: '  // 1. 终止并确认\n', replace: '  // 1. 终止并确认\n' + RELEASE_GATE.replace(/^ {4}/, '  '), expect: S.proto },
  { id: 'M12', desc: '去掉 D5 分支补记 worker_pid / worker_started_at（计划双审 r1 GLM-03 / CODEX-02）⇒ U5②', file: PROTO,
    find: '        s.worker_pid ??= born.pid;\n        s.worker_started_at ??= startedAt;\n', replace: '        void s; void startedAt;\n', expect: S.proto },
  { id: 'M13', desc: '去掉 D5 分支把锁改记到 worker 名下（计划双审 r1 AGY-01）⇒ U5②', file: PROTO,
    find: '      if (cur && cur.pid === i.lock.content.pid && cur.acquired_at === i.lock.content.acquired_at) {\n',
    replace: `      if (cur && cur.pid === i.lock.content.pid && cur.acquired_at === i.lock.content.acquired_at && ${NEVER}) {\n`, expect: S.proto },
  { id: 'M14', desc: '第 5 步不判 status.json 已终态（计划双审 r1 AGY-02 ≡ GLM-01）⇒ U5④（success 被改写）', file: PROTO,
    find: STEP5, replace: STEP5.replace('  if (st && !isTerminal(st.phase)) {\n', '  if (st) {\n').replace('        if (isTerminal(s.phase)) return;\n', ''), expect: S.proto },
  { id: 'M15', desc: 'workerGoneForCancel 退回只看存活（计划双审 r1 AGY-04）⇒ U6', file: PROTO,
    find: '  return !p.alive || !p.sameProcess;\n', replace: '  return !p.alive;\n', expect: S.proto },
  // ── 代码双审 r1 修订新增 ──
  { id: 'M16', desc: '第 1 步播报不看结果、一律说「已终止」（代码双审 r1 CODEX-01 ≡ GLM-01）⇒ U5②④', file: PROTO,
    find: '  if (t && gone && t.signals.length === 0) {\n', replace: `  if (${NEVER}) {\n`, expect: S.proto },
  { id: 'M17', desc: '回读 run.json 读不出并回「本进程收尾」、照样落 failed（代码双审 r1 CODEX-03）⇒ U5⑤', file: PROTO,
    find: '        if (workerWroteTerminal || metaUnreadable) return;', replace: '        if (workerWroteTerminal) return;', expect: S.proto },
  { id: 'M18', desc: 'D5 末句不看改写锁的结果、一律说「已记在它名下」（代码双审 r1 GLM-01 第 2 点）⇒ U5⑥', file: PROTO,
    find: "      lockOutcome === 'rewritten' || lockOutcome === 'already_worker'\n", replace: "      lockOutcome === 'rewritten' || lockOutcome === 'already_worker' || true\n", expect: S.proto },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [PROTO, REPORT, EXEC], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
