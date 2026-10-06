// 生成「回收遗留锁收尾旧运行」（EV-151）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/lost-cancel-exit-code-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/reclaimed-lock-settle-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LOCK = 'src/trivium/lock.ts';
const RP = 'src/trivium/run-protocol.ts';
const RV = 'src/trivium/review.ts';
const S = 'dist/test/test/integration/reclaimed-lock-settle.test.js';
const G = 'dist/test/test/integration/gate-loop.test.js';

const cases = [
  { id: 'M1', desc: 'acquireLock 不交还回收掉的锁', file: LOCK,
    find: '        reclaimed.push({ reason: stale, content: existing });\n', replace: '', expect: S },
  { id: 'M2', desc: '--start 取锁后不给上一轮收尾（改前形态）', file: RP,
    find: '  await settleReclaimedRunLocks(ctx, lock.reclaimed);\n\n  let rc: RunContext;',
    replace: '\n  let rc: RunContext;', expect: G },
  { id: 'M3', desc: '同步 review 取锁后不给上一轮收尾', file: RV,
    find: '    await settleReclaimedRunLocks(ctx, lock.reclaimed);\n', replace: '    void settleReclaimedRunLocks;\n', expect: G },
  { id: 'M4', desc: '同步路径不把 run_id 写进锁（扩展之前的形态）', file: RV,
    find: '  if (opts.onRunIdAllocated) await opts.onRunIdAllocated(runId);\n', replace: '', expect: G },
  { id: 'M5', desc: '不核 status.json 的 worker_pid 与锁里的 pid', file: RP,
    find: "  if (typeof st?.worker_pid === 'number' && st.worker_pid !== pid) {",
    replace: "  if (false && typeof st?.worker_pid === 'number' && st.worker_pid !== pid) {", expect: S },
  { id: 'M6', desc: '不按回收原因过滤（持锁进程活着也收）', file: RP,
    find: "    if (!c || c.kind !== 'run' || (r.reason !== 'pid_gone' && r.reason !== 'pid_reused')) continue;",
    replace: "    if (!c || c.kind !== 'run') continue;", expect: S },
  { id: 'M7', desc: '不按锁种类过滤（短临界区锁也收）', file: RP,
    find: "    if (!c || c.kind !== 'run' || (r.reason !== 'pid_gone' && r.reason !== 'pid_reused')) continue;",
    replace: "    if (!c || (r.reason !== 'pid_gone' && r.reason !== 'pid_reused')) continue;", expect: S },
  { id: 'M8', desc: '收尾时不回收上一轮的闸门项', file: RP,
    find: '  await releaseRunningGateEntry({ triviumDir: ctx.triviumDir, topic, stage, runId, heartbeatStaleMs }); // 自身不抛\n',
    replace: '', expect: S },
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
