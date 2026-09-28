/**
 * EV-158：worker 与主题锁的启动时刻规范化（worker启动时刻规范化计划 r2 §5.1 U1～U8、U10）。
 *
 * 写者与读者的环境错开照 U16 的办法（`test/helpers/start-env.ts`）：W 下现取两种形态造记录，R 下判。被判对象是本进程——
 * 它活着、启动时刻终生不变；每格先做 P0（两个环境的缺省形态确实不同、且都不等于规范化形态，计划双审 r1 CODEX-02）。
 * 需要「活着的别的进程」与信号的格（U4 ②、U8 的 cancelRun 那几格、U9）在 `run-protocol.test.ts`；到期整删与跨仓清扫在本文件末尾。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  canonicalStartOf, processAlive, processMatchesRecord, processStartTime, processStartTimes,
} from '../../src/trivium/util/exec.js';
import { acquireLock, inspectLock, judgeStale, withTopicLock, workerLockContent, type LockContent } from '../../src/trivium/lock.js';
import { interpretStatus, newStatus, workerConfirmedGone, writeStatus, type RunStatus } from '../../src/trivium/status.js';
import { classifyLostCancel, lostWorkerGone, workerGoneForCancel } from '../../src/trivium/run-protocol.js';
import { pruneRunDirs, scrubAllRunRoot } from '../../src/trivium/retention.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { repoId } from '../../src/trivium/review.js';
import { wiredAdapter } from '../../src/trivium/adapters/index.js';
import { ENV_R, ENV_W, assertEnvPairDistinct, withEnv } from '../helpers/start-env.js';

const SELF = process.pid;
/** 一个与本进程规范化启动时刻不同、形状合法的时刻（k 格：pid 复用或手改） */
const OTHER_CANONICAL = 'Thu Jan  1 00:00:00 1970';

/** W 下取两种形态，造一份「新版写下」的记录 */
async function recordUnderW(pid = SELF): Promise<{ legacy: string | null; canonical: string | null }> {
  return withEnv(ENV_W, () => processStartTimes(pid));
}

function runningStatus(o: { canonical?: unknown; legacy: string | null; pid?: number }): RunStatus {
  const s = newStatus({ runId: 'R', topic: 't', stage: 'plan', sides: ['glm'], models: {} });
  s.phase = 'running';
  s.worker_pid = o.pid ?? SELF;
  s.worker_started_at = o.legacy;
  if ('canonical' in o) (s as unknown as Record<string, unknown>)['worker_started_at_canonical'] = o.canonical;
  else delete s.worker_started_at_canonical; // 旧版写下：键缺席
  return s;
}

test('EV-158 P0：本机的 W / R 环境对确实错开（缺省形态互异、且都不等于规范化形态）——其余各格的前提', async () => {
  const f = await assertEnvPairDistinct(SELF);
  assert.equal(await processStartTime(SELF, { canonical: true }), f.canonical);
});

test('EV-158 U1（b 格）：W 下造的完整记录，R 下判同一进程、比的是规范化形态；W 下判也相同', async () => {
  await assertEnvPairDistinct(SELF);
  const rec = await recordUnderW();
  assert.ok(rec.legacy && rec.canonical, `两种形态都应取到：${JSON.stringify(rec)}`);
  for (const env of [ENV_R, ENV_W]) {
    const m = await withEnv(env, () => processMatchesRecord(SELF, rec));
    assert.equal(m.alive, true);
    assert.equal(m.sameProcess, true, `R / W 下都应判同一进程：${JSON.stringify(m)}`);
    assert.equal(m.basis, 'canonical');
    assert.equal(m.expected, rec.canonical);
    assert.equal(m.startedAt, rec.canonical);
  }
});

test('EV-158 U2（c / d 格回归）：只有缺省形态（旧版写下）⇒ 退回缺省比较，与 processAlive 逐字相同——W 下同一进程、R 下不是', async () => {
  const f = await assertEnvPairDistinct(SELF);
  const legacyOnly = { legacy: f.w };
  const inW = await withEnv(ENV_W, () => processMatchesRecord(SELF, legacyOnly));
  const inR = await withEnv(ENV_R, () => processMatchesRecord(SELF, legacyOnly));
  assert.equal(inW.basis, 'legacy');
  assert.equal(inW.sameProcess, true);
  assert.equal(inR.basis, 'legacy');
  assert.equal(inR.sameProcess, false, 'd 格：升级窗口里的旧记录在异环境下仍判错，与今天相同');
  const pW = await withEnv(ENV_W, () => processAlive(SELF, f.w));
  const pR = await withEnv(ENV_R, () => processAlive(SELF, f.w));
  assert.deepEqual({ alive: inW.alive, sameProcess: inW.sameProcess, startedAt: inW.startedAt }, pW);
  assert.deepEqual({ alive: inR.alive, sameProcess: inR.sameProcess, startedAt: inR.startedAt }, pR);
  // 期望为假值即相符（processAlive 的既有口径）也原样保留
  const none = await withEnv(ENV_R, () => processMatchesRecord(SELF, { legacy: null }));
  assert.deepEqual({ sameProcess: none.sameProcess, basis: none.basis, expected: none.expected }, { sameProcess: true, basis: 'legacy', expected: null });
});

test('EV-158 U3（D3，计划双审 r1 AGY-01）：规范化字段缺席 / null / 空串 / 全空白 / 非字符串 ⇒ 当「没有」退回缺省比较；首尾带空白 ⇒ 按 trim 后的值比', async () => {
  const f = await assertEnvPairDistinct(SELF);
  for (const bad of [undefined, null, '', '   ', 123, {}, ['x']]) {
    assert.equal(canonicalStartOf(bad), null, JSON.stringify(bad));
    const m = await withEnv(ENV_W, () => processMatchesRecord(SELF, { canonical: bad, legacy: f.w }));
    assert.equal(m.basis, 'legacy', `${JSON.stringify(bad)} 应退回缺省比较`);
    assert.equal(m.sameProcess, true);
  }
  const padded = `  ${f.canonical}\n`;
  assert.equal(canonicalStartOf(padded), f.canonical);
  const m = await withEnv(ENV_R, () => processMatchesRecord(SELF, { canonical: padded, legacy: f.w }));
  assert.deepEqual({ basis: m.basis, sameProcess: m.sameProcess, expected: m.expected }, { basis: 'canonical', sameProcess: true, expected: f.canonical });
});

test('EV-158 U4 ①（D4）：workerLockContent 显式覆盖四个键——不把 --start 自己的规范化启动时刻带到 worker 的 pid 上', () => {
  const start: LockContent = {
    topic: 't', stage: 'plan', run_id: null, pid: 111, pid_started_at: 'L-start', pid_started_at_canonical: 'C-start',
    acquired_at: '2026-09-28T00:00:00.000Z', kind: 'run',
  };
  const w = workerLockContent(start, { runId: 'R', pid: 222, startedAt: 'L-worker', startedAtCanonical: 'C-worker' });
  assert.deepEqual(w, { ...start, run_id: 'R', pid: 222, pid_started_at: 'L-worker', pid_started_at_canonical: 'C-worker' });
  // 取不到时写 null，而不是留下 --start 的
  const n = workerLockContent(start, { runId: 'R', pid: 222, startedAt: null, startedAtCanonical: null });
  assert.equal(n.pid_started_at_canonical, null);
  assert.ok('pid_started_at_canonical' in n, '键在、值为 null');
  assert.equal(n.pid_started_at, null);
  // 入参不被改动
  assert.equal(start.pid_started_at_canonical, 'C-start');
});

async function tmpTrivium(): Promise<string> {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-canon-')), '.trivium');
}

test('EV-158 U5（acquireLock 与 judgeStale，C4）：锁带本进程的规范化启动时刻；异环境不回收；删掉新字段即回到今天（pid_reused）；短锁同样带；规范化值不符（k 格）判 pid_reused', async () => {
  const f = await assertEnvPairDistinct(SELF);
  const triviumDir = await tmpTrivium();
  // ① 在 R 下拿锁：缺省形态是 R 的，规范化形态与环境无关
  const h = await withEnv(ENV_R, () => acquireLock({ triviumDir, topic: 'T', kind: 'run', heartbeatStaleMs: 120_000 }));
  try {
    assert.equal(h.content.pid_started_at_canonical, f.canonical, '锁的规范化启动时刻应是本进程的');
    assert.equal(h.content.pid_started_at, f.r, '缺省字段的取法没变（持锁者自己的环境）');
    const onDisk = await inspectLock(triviumDir, 'T');
    assert.equal(onDisk?.pid_started_at_canonical, f.canonical);
    // ② W 下判：不回收
    assert.equal(await withEnv(ENV_W, () => judgeStale(onDisk, { heartbeatStaleMs: 120_000 })), null, 'b 格：异环境的判旧不回收活锁');
    // ③ 删掉新字段（旧版写下）⇒ 退回缺省比较，W 下判 pid_reused（今天的行为）
    const legacy = { ...onDisk! };
    delete legacy.pid_started_at_canonical;
    assert.equal(await withEnv(ENV_W, () => judgeStale(legacy, { heartbeatStaleMs: 120_000 })), 'pid_reused');
    assert.equal(await withEnv(ENV_R, () => judgeStale(legacy, { heartbeatStaleMs: 120_000 })), null, 'c 格：同环境照旧不回收');
    // ⑤ k 格（计划双审 r1 CODEX-03）：活进程、规范化值不符 ⇒ pid_reused（W / R 都是）
    const reused = { ...onDisk!, pid_started_at_canonical: OTHER_CANONICAL };
    for (const env of [ENV_W, ENV_R]) {
      assert.equal(await withEnv(env, () => judgeStale(reused, { heartbeatStaleMs: 120_000 })), 'pid_reused');
    }
  } finally {
    await h.release();
  }
  // ④ 短锁同样带新字段
  const seen = await withTopicLock({ triviumDir, topic: 'T2', heartbeatStaleMs: 120_000 }, () => inspectLock(triviumDir, 'T2'));
  assert.equal(seen?.kind, 'critical');
  assert.equal(seen?.pid_started_at_canonical, f.canonical);
});

test('EV-158 U6 ①③④（workerConfirmedGone，C2）：W 下写、R 下判 ⇒ 不可抹；删掉新字段 ⇒ 回到今天（可抹）；规范化值不符（k 格）⇒ 可抹', async () => {
  await assertEnvPairDistinct(SELF);
  const rec = await recordUnderW();
  const full = runningStatus({ canonical: rec.canonical, legacy: rec.legacy });
  const g = await withEnv(ENV_R, () => workerConfirmedGone(full));
  assert.equal(g.gone, false, `b 格：${g.why}`);
  // 终态（--wait 判失联写成 failed）也看进程
  const failed = { ...full, phase: 'failed' as const };
  assert.equal((await withEnv(ENV_R, () => workerConfirmedGone(failed))).gone, false);
  const legacyOnly = runningStatus({ legacy: rec.legacy });
  assert.equal((await withEnv(ENV_R, () => workerConfirmedGone(legacyOnly))).gone, true, 'd 格：旧记录在异环境下仍判已不在（今天的行为）');
  assert.equal((await withEnv(ENV_W, () => workerConfirmedGone(legacyOnly))).gone, false, 'c 格');
  const reused = runningStatus({ canonical: OTHER_CANONICAL, legacy: rec.legacy });
  for (const env of [ENV_W, ENV_R]) {
    assert.equal((await withEnv(env, () => workerConfirmedGone(reused))).gone, true, 'k 格：规范化值不符即不是同一进程，放行抹除');
  }
});

test('EV-158 U7（interpretStatus 情形 C，C1）：W 下写、R 下判 ⇒ running 而不是 worker_lost；删掉新字段 ⇒ pid_gone（今天的行为）', async () => {
  await assertEnvPairDistinct(SELF);
  const rec = await recordUnderW();
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-canon-run-'));
  await writeStatus(runDir, runningStatus({ canonical: rec.canonical, legacy: rec.legacy }));
  const r1 = await withEnv(ENV_R, () => interpretStatus(runDir, { heartbeatStaleMs: 120_000 }));
  assert.equal(r1.kind, 'running', `b 格：${JSON.stringify(r1)}`);
  await writeStatus(runDir, runningStatus({ legacy: rec.legacy }));
  const r2 = await withEnv(ENV_R, () => interpretStatus(runDir, { heartbeatStaleMs: 120_000 }));
  assert.deepEqual(r2, { kind: 'worker_lost', reason: 'pid_gone' }, 'd 格回归');
});

test('EV-158 U8（C6 / C7 / C8 的纯判定）：workerGoneForCancel、classifyLostCancel、lostWorkerGone 在 R 下都认得 W 下写的记录；旧记录退回、basis 如实', async () => {
  await assertEnvPairDistinct(SELF);
  const rec = await recordUnderW();
  // C6
  assert.equal(await withEnv(ENV_R, () => workerGoneForCancel(SELF, rec)), false, 'b 格：宽限期判据不把活 worker 当已退出');
  assert.equal(await withEnv(ENV_R, () => workerGoneForCancel(SELF, { legacy: rec.legacy })), true, 'd 格回归');
  // C7：failed + lost.heartbeat_stale
  const lost = (s: RunStatus): RunStatus => ({ ...s, phase: 'failed', lost: { reason: 'heartbeat_stale', at: new Date().toISOString() } });
  const full = lost(runningStatus({ canonical: rec.canonical, legacy: rec.legacy }));
  const c1 = await withEnv(ENV_R, () => classifyLostCancel(full));
  assert.equal(c1.kind, 'alive', `b 格：${JSON.stringify(c1)}`);
  const c2 = await withEnv(ENV_R, () => classifyLostCancel(lost(runningStatus({ legacy: rec.legacy }))));
  assert.deepEqual(c2, { kind: 'mismatch', pid: SELF, basis: 'legacy' });
  const c3 = await withEnv(ENV_R, () => classifyLostCancel(lost(runningStatus({ canonical: OTHER_CANONICAL, legacy: rec.legacy }))));
  assert.deepEqual(c3, { kind: 'mismatch', pid: SELF, basis: 'canonical' });
  // D7：只有规范化字段、缺省字段为 null ⇒ 不再是 no_identity
  const c4 = await withEnv(ENV_R, () => classifyLostCancel(lost(runningStatus({ canonical: rec.canonical, legacy: null }))));
  assert.equal(c4.kind, 'alive', `D7：${JSON.stringify(c4)}`);
  // 两种形态都没有 ⇒ 仍是 no_identity
  const c5 = await classifyLostCancel(lost(runningStatus({ canonical: '  ', legacy: null })));
  assert.deepEqual(c5, { kind: 'no_identity' });
  // C8
  assert.equal(await withEnv(ENV_R, () => lostWorkerGone(SELF, rec)), false, 'b 格：严格退出判据不把活 worker 当已退出');
  assert.equal(await withEnv(ENV_R, () => lostWorkerGone(SELF, { canonical: OTHER_CANONICAL, legacy: null })), true, '规范化值不符 ⇒ 已退出（pid 被复用）');
  assert.equal(await lostWorkerGone(999_994, rec), true, '进程不在 ⇒ 已退出');
});

test('EV-158 U10（h 格，计划双审 r1 AGY-02）：规范化取不到 ⇒ alive、不是同一进程（与今天「期望非空而取不到」同口径）；严格判据判未退出', async () => {
  const rec = await recordUnderW();
  const nothing = async () => null;
  const m = await processMatchesRecord(SELF, rec, { canonicalStartTimeOf: nothing });
  assert.deepEqual(
    { alive: m.alive, sameProcess: m.sameProcess, startedAt: m.startedAt, basis: m.basis },
    { alive: true, sameProcess: false, startedAt: null, basis: 'canonical' },
  );
  assert.equal(await lostWorkerGone(SELF, rec, { canonicalStartTimeOf: nothing }), false, '严格判据沿用：取不到不算已退出');
  // 取值抛错也不 reject（助手的契约）
  const boom = await processMatchesRecord(SELF, rec, { canonicalStartTimeOf: async () => { throw new Error('ps 挂了'); } });
  assert.equal(boom.sameProcess, false);
  // processStartTimes 永不 reject：对不存在的 pid 两路都是 null
  assert.deepEqual(await processStartTimes(999_995), { legacy: null, canonical: null });
});

// ── 到期整删与跨仓清扫的「活着就不动」（C3，U6 ②④） ──

async function bucket() {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-canon-ret-'));
  const projectRoot = '/tmp/some-canon-project';
  const cfg = defaultConfig();
  cfg.runtime.run_root = runRoot;
  const b = path.join(runRoot, repoId(projectRoot));
  await fs.mkdir(b, { recursive: true });
  return { cfg, projectRoot, b };
}

async function runDirWithCarrier(b: string, name: string, s: RunStatus) {
  const d = path.join(b, name);
  const carrier = path.join(d, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  await fs.mkdir(path.join(d, 'glm', 'out'), { recursive: true });
  await writeStatus(d, s);
  return { d, carrier };
}

test('EV-158 U6 ②④（workerStillAlive + admitScrub，C3）：W 下写、R 下清扫 ⇒ 跨仓清扫计 alive、会话启动清扫不抹；删掉新字段或规范化值不符 ⇒ 回到可抹', async () => {
  await assertEnvPairDistinct(SELF);
  const rec = await recordUnderW();
  const { cfg, projectRoot, b } = await bucket();
  const live = await runDirWithCarrier(b, 'R-live', runningStatus({ canonical: rec.canonical, legacy: rec.legacy }));
  const old = await runDirWithCarrier(b, 'R-legacy', runningStatus({ legacy: rec.legacy }));
  const reused = await runDirWithCarrier(b, 'R-reused', runningStatus({ canonical: OTHER_CANONICAL, legacy: rec.legacy }));

  const sweep = await withEnv(ENV_R, () => scrubAllRunRoot(cfg, { adapters: wiredAdapter, dryRun: true }));
  assert.equal(sweep.alive, 1, `只有新版写下的那一份算活着：${JSON.stringify(sweep)}`);
  assert.ok(sweep.eligible.includes(old.d), 'd 格：旧记录异环境下照旧可抹（今天的行为）');
  assert.ok(sweep.eligible.includes(reused.d), 'k 格：规范化值不符 ⇒ 可抹');
  assert.ok(!sweep.eligible.includes(live.d));

  const pr = await withEnv(ENV_R, () => pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter }));
  await fs.access(live.carrier); // b 格：活 worker 的副本不抹
  assert.ok(!pr.scrubbed.includes(live.d));
  await assert.rejects(fs.access(old.carrier), 'd 格：今天的行为');
  await assert.rejects(fs.access(reused.carrier), 'k 格');
});
