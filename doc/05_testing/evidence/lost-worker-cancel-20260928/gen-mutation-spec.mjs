// 生成「失联后取消挂住的worker」的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/cli-pgroup-record-20260928/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROTO = 'src/trivium/run-protocol.ts';
const STATUS = 'src/trivium/status.ts';
const S = {
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
  proto: 'dist/test/test/integration/run-protocol.test.js',
  status: 'dist/test/test/unit/status.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";

const cases = [
  { id: 'N1', desc: 'waitRun 不记 lost ⇒ K2 / K3（本格判不出）', file: PROTO,
    find: '        s.lost = { reason: reading.reason, at: new Date().toISOString() };\n',
    replace: '', expect: S.proto },
  { id: 'N2', desc: 'lostOf 不校验 reason 枚举 ⇒ K1', file: STATUS,
    find: "  const okReason = typeof r.reason === 'string' && (WORKER_LOST_REASONS as readonly string[]).includes(r.reason);\n",
    replace: "  const okReason = typeof r.reason === 'string';\n", expect: S.status },
  { id: 'N3', desc: '判格不看 lost.reason（任何 lost 都算）⇒ K5②', file: PROTO,
    find: "  if (s.phase !== 'failed' || lost?.reason !== 'heartbeat_stale') return { kind: 'none' };\n",
    replace: "  if (s.phase !== 'failed' || !lost) return { kind: 'none' };\n", expect: S.proto },
  { id: 'N4', desc: '判格不看 phase（success 也算）⇒ K5③', file: PROTO,
    find: "  if (s.phase !== 'failed' || lost?.reason !== 'heartbeat_stale') return { kind: 'none' };\n",
    replace: "  if (lost?.reason !== 'heartbeat_stale') return { kind: 'none' };\n", expect: S.proto },
  { id: 'N5', desc: '判格不看启动时刻（活着即算同一进程）⇒ K5④', file: PROTO,
    find: "  if (!live.sameProcess) return { kind: 'mismatch', pid };\n",
    replace: '', expect: S.proto },
  { id: 'N6', desc: '身份守卫只判类型（空串启动时刻、pid 为 1 放行）⇒ K5⑤', file: PROTO,
    find: "    typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 ||\n    typeof startedAt !== 'string' || startedAt.trim().length === 0\n",
    replace: "    typeof pid !== 'number' || typeof startedAt !== 'string'\n", expect: S.proto },
  { id: 'N7', desc: '结束工作进程不升级 SIGKILL（SIGKILL 发不出去）⇒ J1', file: PROTO,
    find: '      onEscalate: () => warn(`工作进程组 ${p} 未响应 SIGTERM（事件循环被堵住时处理器跑不到），发送 SIGKILL`),\n',
    replace: '      onEscalate: () => warn(`工作进程组 ${p} 未响应 SIGTERM（事件循环被堵住时处理器跑不到），发送 SIGKILL`),\n' +
      "      signal: (q: number, sg: NodeJS.Signals) => { if (sg === 'SIGKILL') return false; try { process.kill(-q, sg); return true; } catch { return false; } },\n",
    expect: S.gateLoop },
  { id: 'N8', desc: '不按记录结束 CLI ⇒ J1（两组仍在）', file: PROTO,
    find: '  reportRecordedCliGroups(await terminateRecordedCliGroups(await readStatus(runDir)), handlerRan, runDir);\n',
    replace: `  if (${NEVER}) reportRecordedCliGroups(await terminateRecordedCliGroups(await readStatus(runDir)), handlerRan, runDir);\n`,
    expect: S.gateLoop },
  { id: 'N9', desc: '未确认退出也往下走（补收 run.json、回收锁；计划 r2 的 N9 与 N10 在早退结构下是同一处）⇒ K4', file: PROTO,
    find: '  if (!gone) {\n    say(',
    replace: `  if (!gone && ${NEVER}) {\n    say(`, expect: S.proto },
  { id: 'N10', desc: '确认退出后也不补收（workerGone 传 false）⇒ K3', file: PROTO,
    find: "    workerGone: true,\n    termination: { by: 'worker_lost', reason: 'heartbeat_stale' },\n",
    replace: "    workerGone: false,\n    termination: { by: 'worker_lost', reason: 'heartbeat_stale' },\n", expect: S.proto },
  { id: 'N11', desc: '锁只比 run_id 不比 pid ⇒ K6', file: PROTO,
    find: '  if (existing && existing.run_id === runId && existing.pid === pid) {\n',
    replace: '  if (existing && existing.run_id === runId) {\n', expect: S.proto },
  { id: 'N12', desc: 'termination 写成别的取值 ⇒ K3', file: PROTO,
    find: "    termination: { by: 'worker_lost', reason: 'heartbeat_stale' },\n",
    replace: "    termination: { by: 'worker_exception', exit_code: 1 },\n", expect: S.proto },
  { id: 'N13', desc: '本格改写 status.json（phase 置 cancelled）——同时让第二次调用不再入格 ⇒ K3 / K4', file: PROTO,
    find: '  // 3. 按记录结束 CLI（没确认退出也照做，D4）。只有 worker 的处理器确实跑过（发了 SIGTERM、宽限内退出）时无记录才不出声——\n',
    replace: "  await patchStatus(runDir, (x) => { x.phase = 'cancelled'; });\n" +
      '  // 3. 按记录结束 CLI（没确认退出也照做，D4）。只有 worker 的处理器确实跑过（发了 SIGTERM、宽限内退出）时无记录才不出声——\n',
    expect: S.proto },
  { id: 'N14', desc: '本格抹凭据副本 ⇒ J3', file: PROTO,
    find: '  // 结论按三态说（代码双审 r1 CODEX-01）：「已结束仍挂着的」只在确实发过信号时说\n',
    replace: '  await scrubRunDir(runDir, wiredAdapter).catch(() => null);\n' +
      '  // 结论按三态说（代码双审 r1 CODEX-01）：「已结束仍挂着的」只在确实发过信号时说\n',
    expect: S.gateLoop },
  { id: 'N15', desc: 'heartbeat_stale 报错不带事实行与出口行 ⇒ K2', file: PROTO,
    find: "      if (reading.reason === 'heartbeat_stale' && !goneForArchive) {\n",
    replace: `      if (reading.reason === 'heartbeat_stale' && !goneForArchive && ${NEVER}) {\n`, expect: S.proto },
  { id: 'N16a', desc: 'mismatch 跌回「无需取消」（计划双审 r1 AGY-01）⇒ K5④', file: PROTO,
    find: "    if (cell.kind === 'mismatch') {\n",
    replace: `    if (cell.kind === 'mismatch' && ${NEVER}) {\n`, expect: S.proto },
  { id: 'N16b', desc: 'no_identity 跌回「无需取消」（计划双审 r1 AGY-01）⇒ K5⑤', file: PROTO,
    find: "    if (cell.kind === 'no_identity') {\n",
    replace: `    if (cell.kind === 'no_identity' && ${NEVER}) {\n`, expect: S.proto },
  // ── 代码双审 r1 之后新增（应答件 §1）──
  { id: 'N17', desc: '零信号已不在当成「宽限内响应」播报、无记录告警静音（代码双审 r1 CODEX-01）⇒ K10', file: PROTO,
    find: '  if (gone && noSignalSent) {\n',
    replace: `  if (gone && noSignalSent && ${NEVER}) {\n`, expect: S.proto },
  { id: 'N18', desc: 'mismatch 格照旧按记录结束 CLI（代码双审 r1 CODEX-02）⇒ K5′', file: PROTO,
    find: "      cell.kind !== 'mismatch' &&\n",
    replace: '', expect: S.proto },
  { id: 'N19', desc: '严格判据把「ps 取不到启动时刻」当已退出（代码双审 r1 GLM-01）⇒ K11', file: PROTO,
    find: '  return p.startedAt !== null && p.startedAt !== expectedStartedAt;\n',
    replace: '  return p.startedAt !== expectedStartedAt;\n', expect: S.proto },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [PROTO, STATUS], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
