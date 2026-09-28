// 生成「worker启动时刻规范化」的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/lost-worker-cancel-20260928/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const EXEC = 'src/trivium/util/exec.ts';
const LOCK = 'src/trivium/lock.ts';
const STATUS = 'src/trivium/status.ts';
const RET = 'src/trivium/retention.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const S = {
  unit: 'dist/test/test/unit/start-canonical.test.js',
  proto: 'dist/test/test/integration/run-protocol.test.js',
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";

const cases = [
  { id: 'M1', desc: 'startRun 的 patchStatus 不写 worker_started_at_canonical ⇒ I1', file: PROTO,
    find: '      s.worker_started_at_canonical = workerStartedAtCanonical;\n',
    replace: '', expect: S.gateLoop },
  { id: 'M2', desc: 'workerLockContent 不覆盖规范化启动时刻（沿用 --start 的）⇒ U4 ①', file: LOCK,
    find: '    pid_started_at_canonical: w.startedAtCanonical,\n',
    replace: '', expect: S.unit },
  { id: 'M3', desc: 'acquireLock 的规范化启动时刻恒 null ⇒ U5 ①', file: LOCK,
    find: '      pid_started_at_canonical: await selfCanonicalStartTime(),\n',
    replace: '      pid_started_at_canonical: null,\n', expect: S.unit },
  { id: 'M4', desc: 'processMatchesRecord 忽略规范化字段（恒走缺省比较）⇒ U1', file: EXEC,
    find: '  const expected = canonicalStartOf(rec.canonical);\n',
    replace: '  const expected = null as string | null;\n', expect: S.unit },
  { id: 'M5', desc: '规范化那一支以缺省环境取（去掉 canonical 选项）⇒ U1', file: EXEC,
    find: '  const startedAt = await (o.canonicalStartTimeOf ?? ((p: number) => processStartTime(p, { canonical: true })))(pid).catch(\n',
    replace: '  const startedAt = await (o.canonicalStartTimeOf ?? ((p: number) => processStartTime(p)))(pid).catch(\n',
    expect: S.unit },
  { id: 'M6', desc: '规范化字段缺席时判「不是同一进程」（去掉退回）⇒ U2', file: EXEC,
    find: "    return { ...p, expected: legacy || null, basis: 'legacy' };\n",
    replace: "    return { ...p, sameProcess: false, expected: legacy || null, basis: 'legacy' };\n", expect: S.unit },
  { id: 'M7a', desc: 'canonicalStartOf 接受空串 / 全空白 ⇒ U3', file: EXEC,
    find: '  const t = v.trim();\n  return t.length > 0 ? t : null;\n',
    replace: '  const t = v.trim();\n  return t.length >= 0 ? t : null;\n', expect: S.unit },
  { id: 'M7b', desc: 'canonicalStartOf 返回原值、不 trim（计划双审 r1 AGY-01）⇒ U3', file: EXEC,
    find: '  const t = v.trim();\n  return t.length > 0 ? t : null;\n',
    replace: '  const t = v.trim();\n  return t.length > 0 ? v : null;\n', expect: S.unit },
  { id: 'M8', desc: 'C1 interpretStatus 改回缺省比较 ⇒ U7', file: STATUS,
    find: '    const live = await processMatchesRecord(pid, workerStartOf(raw, opts.fallbackPidStartedAt ?? null));\n',
    replace: '    const live = await processAlive(pid, raw.worker_started_at ?? opts.fallbackPidStartedAt ?? null);\n', expect: S.unit },
  { id: 'M9', desc: 'C2 workerConfirmedGone 改回缺省比较 ⇒ U6 ①', file: STATUS,
    find: '    const live = await processMatchesRecord(pid, workerStartOf(status));\n',
    replace: '    const live = await processAlive(pid, status.worker_started_at ?? null);\n', expect: S.unit },
  { id: 'M10', desc: 'C3 workerStillAlive 改回缺省比较 ⇒ U6 ②④', file: RET,
    find: '  const a = await processMatchesRecord(status.worker_pid, workerStartOf(status));\n',
    replace: '  const a = await processMatchesRecord(status.worker_pid, { legacy: status.worker_started_at });\n', expect: S.unit },
  { id: 'M11', desc: 'C4 judgeStale 改回缺省比较 ⇒ U5 ②', file: LOCK,
    find: '    canonical: lock.pid_started_at_canonical,\n',
    replace: '    canonical: null,\n', expect: S.unit },
  { id: 'M12', desc: 'C5 --cancel 主路径改回缺省比较 ⇒ C5 / C6 用例', file: PROTO,
    find: "    const rec: RecordedStart = s ? workerStartOf(s) : { legacy: null };\n",
    replace: "    const rec: RecordedStart = { legacy: s?.worker_started_at ?? null };\n", expect: S.proto },
  { id: 'M13', desc: 'C6 workerGoneForCancel 改回缺省比较 ⇒ U8', file: PROTO,
    find: '  const p = await processMatchesRecord(pid, rec);\n  return !p.alive || !p.sameProcess;\n',
    replace: '  const p = await processAlive(pid, rec.legacy ?? null);\n  return !p.alive || !p.sameProcess;\n', expect: S.unit },
  { id: 'M14', desc: 'C7 classifyLostCancel 改回缺省比较 ⇒ U8', file: PROTO,
    find: '  const live = await processMatchesRecord(pid, rec);\n  if (!live.alive) return { kind: \'gone\', pid };\n',
    replace: '  const live = await processMatchesRecord(pid, { legacy: rec.legacy });\n  if (!live.alive) return { kind: \'gone\', pid };\n',
    expect: S.unit },
  { id: 'M15', desc: 'C8 lostWorkerGone 改回缺省比较 ⇒ U8', file: PROTO,
    find: '  const m = await processMatchesRecord(pid, rec, o);\n',
    replace: '  const m = await processMatchesRecord(pid, { legacy: rec.legacy }, o);\n', expect: S.unit },
  { id: 'M16', desc: 'settleOrphanedStart 确认不了退出一支不补记规范化启动时刻 ⇒ U4 ②', file: PROTO,
    find: '        s.worker_started_at_canonical ??= startedAtCanonical;\n',
    replace: '', expect: S.proto },
  { id: 'M17', desc: 'settleOrphanedStart 改写锁时规范化值恒 null ⇒ U4 ②', file: PROTO,
    find: '              runId: i.runId, pid: born.pid, startedAt, startedAtCanonical,\n',
    replace: '              runId: i.runId, pid: born.pid, startedAt, startedAtCanonical: null,\n', expect: S.proto },
  { id: 'M18', desc: 'classifyLostCancel 的类型守卫仍只认缺省字段（D7）⇒ U8', file: PROTO,
    find: '    (canonicalStartOf(s.worker_started_at_canonical) === null && !legacyOk)\n',
    replace: '    !legacyOk\n', expect: S.unit },
  { id: 'M19', desc: 'D6：mismatch 告警不分比对依据 ⇒ U9', file: PROTO,
    find: "        cell.basis === 'canonical'\n",
    replace: '        false\n', expect: S.proto },
  { id: 'M20', desc: 'judgeStale 忽略 sameProcess（活着即持有者，计划双审 r1 CODEX-03）⇒ U5 ⑤', file: LOCK,
    find: "  if (!live.sameProcess) return 'pid_reused';\n",
    replace: `  if (!live.sameProcess && ${NEVER}) return 'pid_reused';\n`, expect: S.unit },
  { id: 'M21', desc: 'workerConfirmedGone 只看 alive（计划双审 r1 CODEX-03）⇒ U6 ④', file: STATUS,
    find: "    if (live.alive && live.sameProcess) return { gone: false, why: `工作进程 ${pid} 仍在` };\n",
    replace: "    if (live.alive) return { gone: false, why: `工作进程 ${pid} 仍在` };\n", expect: S.unit },
  { id: 'M22', desc: 'settleOrphanedStart 确认退出一支不补规范化启动时刻 ⇒ U4 ②′', file: PROTO,
    find: '        s.worker_started_at_canonical ??= i.workerStartedAtCanonical ?? null;\n',
    replace: '', expect: S.proto },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [EXEC, LOCK, STATUS, RET, PROTO], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
