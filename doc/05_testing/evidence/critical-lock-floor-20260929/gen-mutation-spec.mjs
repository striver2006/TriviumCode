// 生成「临界区锁超时下限」（EV-161）的源码变异规格（计划 r2 §6.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/heartbeat-threshold-warning-20260929/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/critical-lock-floor-20260929/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LOCK = 'src/trivium/lock.ts';
const STATUS = 'src/trivium/status.ts';
const S = {
  unitLock: 'dist/test/test/unit/lock.test.js',
  unitStatus: 'dist/test/test/unit/status.test.js',
  intLock: 'dist/test/test/integration/lock-cross-process.test.js',
};

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}

const AGE = lineOf(LOCK, 'age > criticalHoldTimeoutMs(opts.heartbeatStaleMs)');
const FN = lineOf(LOCK, 'return Math.max(heartbeatStaleMs, WORKER_HEARTBEAT_MS);');
const WORKER = lineOf(STATUS, 'const stale = Number.isFinite(age) && age > opts.heartbeatStaleMs;');
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

// desc 的「⇒」后是实测红集（代码双审 r1 CODEX-02：首轮写的是计划期预测集，M2 / M6 低估了；以 mutation-names-output 的 red 为准）。
// M4 ⇒ U1′ 是修订时按 NaN 格推出的新预测，由修订后的重跑验证。
const cases = [
  { id: 'M1', desc: '年龄判据改回 opts.heartbeatStaleMs（撤销本修复）⇒ U2 / U6 / U8', file: LOCK,
    find: AGE, replace: sub(AGE, 'criticalHoldTimeoutMs(opts.heartbeatStaleMs)', 'opts.heartbeatStaleMs'), expect: S.unitLock },
  { id: 'M1x', desc: '同 M1，跨进程 ⇒ X1 / X2（丢更新或回收告警）', file: LOCK,
    find: AGE, replace: sub(AGE, 'criticalHoldTimeoutMs(opts.heartbeatStaleMs)', 'opts.heartbeatStaleMs'), expect: S.intLock },
  { id: 'M2', desc: 'Math.max 改 Math.min ⇒ U1 / U2 / U3 / U6 / U8（亚秒阈值直接生效，1 s 与 300 ms 的活锁被回收）', file: LOCK,
    find: FN, replace: sub(FN, 'Math.max(', 'Math.min('), expect: S.unitLock },
  { id: 'M3', desc: '下限改成 WORKER_HEARTBEAT_MS − 1 ⇒ U1 / U2（F 那一格）', file: LOCK,
    find: FN, replace: sub(FN, 'WORKER_HEARTBEAT_MS)', 'WORKER_HEARTBEAT_MS - 1)'), expect: S.unitLock },
  { id: 'M4', desc: '函数恒返回 WORKER_HEARTBEAT_MS（忽略阈值）⇒ U1 / U1′ / U3', file: LOCK,
    find: FN, replace: sub(FN, 'Math.max(heartbeatStaleMs, WORKER_HEARTBEAT_MS)', 'WORKER_HEARTBEAT_MS'), expect: S.unitLock },
  { id: 'M5', desc: '年龄判据 > 改 >= ⇒ U2（age = F）/ U3（age = T）', file: LOCK,
    find: AGE, replace: sub(AGE, 'age > criticalHoldTimeoutMs', 'age >= criticalHoldTimeoutMs'), expect: S.unitLock },
  { id: 'M6', desc: "年龄判据去掉 kind === 'critical' ⇒ U4 与既有「短临界区持有过久」（run 锁按年龄判了）", file: LOCK,
    find: AGE, replace: sub(AGE, " && lock.kind === 'critical'", ''), expect: S.unitLock },
  { id: 'M7', desc: '下限误加到 worker 失联判定 ⇒ S1', file: STATUS,
    find: WORKER, replace: sub(WORKER, 'age > opts.heartbeatStaleMs', 'age > Math.max(opts.heartbeatStaleMs, WORKER_HEARTBEAT_MS)'),
    expect: S.unitStatus },
];

// 同一锚点被多条 case 共用（装置逐条恢复），但在文件里必须恰好一处
for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [LOCK, STATUS], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
