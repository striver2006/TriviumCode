/**
 * 回收遗留锁时收尾旧运行（EV-151，候选 A 并含同步路径扩展）——进程内各格。
 *
 * `acquireLock` 回收一把遗留的运行锁之后把它交还调用方（`LockHandle.reclaimed`），`settleReclaimedRunLocks` 按锁里的
 * run_id 给那一轮收尾：持锁进程确认不在、归档仍为 running ⇒ 回收它的闸门项、run.json 与登记收尾为 failed（worker_lost / pid_gone）。
 * 各格在 `fakeCtx` 上摆出「上一轮停在 running、锁记着一个已退出的进程」再取一次锁。经真实 CLI 的两格（`--start` 工作进程被强杀、
 * 同步 review 被强杀）在 `gate-loop.test.ts` 的 EV-151 G1 / G2。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { runDirFor, settleReclaimedRunLocks } from '../../src/trivium/run-protocol.js';
import { acquireLock, lockPathFor, type LockContent } from '../../src/trivium/lock.js';
import { getGate, setGate } from '../../src/trivium/state.js';
import { newStatus, writeStatus } from '../../src/trivium/status.js';
import { newRunMeta, readRunMeta, readTask, registerRun, writeRunMeta, finalizeCancelledRunMeta } from '../../src/trivium/meta.js';
import type { ArchiveLayout } from '../../src/trivium/archive.js';
import type { Ctx, RunMeta } from '../../src/trivium/types.js';
import { captureStderr, fakeCtx } from '../helpers/run-ctx.js';

const TOPIC = '遗留锁收尾';
const STALE = 120_000;

/** 一个已经退出的进程的 pid（按 pid 判 `pid_gone`） */
async function deadPid(): Promise<number> {
  const p = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((r) => p.once('exit', r));
  return p.pid!;
}

async function seedRunning(ctx: Ctx, runId: string): Promise<ArchiveLayout> {
  const layout: ArchiveLayout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  const meta = newRunMeta({
    runId, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
    criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn',
  });
  await writeRunMeta(layout, 'plan', meta);
  await registerRun(layout, meta, { triviumDir: ctx.triviumDir, heartbeatStaleMs: STALE });
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId, heartbeatStaleMs: STALE });
  return layout;
}

/** 直接摆一把遗留锁（不经 acquireLock：持锁进程早已退出） */
async function plantLock(ctx: Ctx, c: Partial<LockContent> & { pid: number }): Promise<void> {
  const content: LockContent = {
    topic: TOPIC, stage: 'plan', run_id: null, pid_started_at: null, pid_started_at_canonical: null,
    acquired_at: new Date(Date.now() - 60_000).toISOString(), kind: 'run', ...c,
  };
  const p = lockPathFor(ctx.triviumDir, TOPIC);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(content, null, 2) + '\n', 'utf8');
}

/** 取一次运行锁、给回收到的上一轮收尾，返回 stderr 与回收清单 */
async function acquireAndSettle(ctx: Ctx) {
  return captureStderr(async () => {
    const lock = await acquireLock({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', kind: 'run', heartbeatStaleMs: STALE });
    try {
      await settleReclaimedRunLocks(ctx, lock.reclaimed);
      return lock.reclaimed;
    } finally {
      await lock.release();
    }
  });
}

const taskStatus = async (l: ArchiveLayout, runId: string) => (await readTask(l)).runs.find((r) => r.run_id === runId)?.status;

test('EV-151 S1：工作进程那一轮（status.json 的 worker_pid 与锁相同）⇒ 闸门回收、run.json 与登记收尾为 failed（worker_lost / pid_gone）', async () => {
  const ctx = await fakeCtx();
  const l = await seedRunning(ctx, 'R-W');
  const pid = await deadPid();
  const runDir = runDirFor(ctx.config, ctx.projectRoot, 'R-W');
  await fs.mkdir(runDir, { recursive: true });
  const s = newStatus({ runId: 'R-W', topic: TOPIC, stage: 'plan', sides: ['gemini', 'glm'], models: { gemini: 'M1', glm: 'M2' } });
  s.phase = 'running';
  s.worker_pid = pid;
  await writeStatus(runDir, s);
  const statusBefore = await fs.readFile(path.join(runDir, 'status.json'), 'utf8');
  await plantLock(ctx, { run_id: 'R-W', pid });

  const { value: reclaimed, err } = await acquireAndSettle(ctx);
  assert.deepEqual(reclaimed.map((r) => [r.reason, r.content?.run_id]), [['pid_gone', 'R-W']], 'acquireLock 要交还回收掉的那一份');
  const m = (await readRunMeta(l, 'plan', 'R-W')) as RunMeta;
  assert.equal(m.status, 'failed');
  assert.deepEqual(m.termination, { by: 'worker_lost', reason: 'pid_gone' });
  assert.equal(await taskStatus(l, 'R-W'), 'failed');
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'idle', '上一轮仍为 running 的闸门项要回收');
  assert.equal(await fs.readFile(path.join(runDir, 'status.json'), 'utf8'), statusBefore, 'status.json 不写');
  assert.match(err, /回收主题「遗留锁收尾」的遗留锁（原因 pid_gone/, '原有告警不变');
  assert.match(err, new RegExp(`上一轮运行 R-W（plan 阶段）的持锁进程 ${pid} 已不在、归档仍为 running：按失联收尾（worker_lost / pid_gone）`));
  assert.match(err, /已把归档里的 run-R-W\.json 收尾为 failed/);
  assert.match(err, /已把 task\.json 的运行登记同步为 failed/);
});

test('EV-151 S2：同步运行（没有 status.json，锁里补写了 run_id）⇒ 同样收尾', async () => {
  const ctx = await fakeCtx();
  const l = await seedRunning(ctx, 'R-S');
  await plantLock(ctx, { run_id: 'R-S', pid: await deadPid() });
  const { err } = await acquireAndSettle(ctx);
  const m = (await readRunMeta(l, 'plan', 'R-S')) as RunMeta;
  assert.equal(m.status, 'failed', err);
  assert.deepEqual(m.termination, { by: 'worker_lost', reason: 'pid_gone' });
  assert.equal(await taskStatus(l, 'R-S'), 'failed');
});

test('EV-151 S3：status.json 记的工作进程不是锁里的 pid ⇒ 不收尾，给 --wait 出口', async () => {
  const ctx = await fakeCtx();
  const l = await seedRunning(ctx, 'R-X');
  const runDir = runDirFor(ctx.config, ctx.projectRoot, 'R-X');
  await fs.mkdir(runDir, { recursive: true });
  const s = newStatus({ runId: 'R-X', topic: TOPIC, stage: 'plan', sides: ['gemini', 'glm'], models: { gemini: 'M1', glm: 'M2' } });
  s.worker_pid = process.pid; // 不同于锁里的 pid
  await writeStatus(runDir, s);
  const pid = await deadPid();
  await plantLock(ctx, { run_id: 'R-X', pid });
  const { err } = await acquireAndSettle(ctx);
  assert.equal((await readRunMeta(l, 'plan', 'R-X'))?.status, 'running');
  assert.equal(await taskStatus(l, 'R-X'), 'running');
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'running', '不收尾时闸门也不动');
  assert.match(err, new RegExp(`遗留锁记的 pid ${pid} 不是 status\\.json 记的工作进程 ${process.pid}：不替它收尾，请 trivium review --wait R-X 判定`));
});

test('EV-151 S4：锁里没有 run_id ⇒ 只多告警一句「定位不到上一轮」，什么都不写', async () => {
  const ctx = await fakeCtx();
  const l = await seedRunning(ctx, 'R-N');
  await plantLock(ctx, { pid: await deadPid() });
  const { err } = await acquireAndSettle(ctx);
  assert.equal((await readRunMeta(l, 'plan', 'R-N'))?.status, 'running');
  assert.match(err, /被回收的遗留锁里没有记 run_id（派生工作进程之前就中断，或本版之前的同步运行）：定位不到上一轮，不替它收尾/);
});

test('EV-151 S5：上一轮已是终态 ⇒ 不重写、不多出声；归档不存在 ⇒ 同样不出声', async () => {
  const ctx = await fakeCtx();
  const l = await seedRunning(ctx, 'R-T');
  await finalizeCancelledRunMeta({
    layout: l, stage: 'plan', runId: 'R-T', lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: STALE }, workerGone: true,
  });
  const before = await fs.readFile(path.join(ctx.archiveRoot, TOPIC, 'plan', '_' + 'meta', 'run-R-T.json'), 'utf8');
  await plantLock(ctx, { run_id: 'R-T', pid: await deadPid() });
  const t = await acquireAndSettle(ctx);
  assert.equal(await fs.readFile(path.join(ctx.archiveRoot, TOPIC, 'plan', '_' + 'meta', 'run-R-T.json'), 'utf8'), before);
  assert.doesNotMatch(t.err, /上一轮运行/, t.err);

  await plantLock(ctx, { run_id: 'R-NONE', pid: await deadPid() });
  const n = await acquireAndSettle(ctx);
  assert.equal(n.value.length, 1);
  assert.doesNotMatch(n.err, /上一轮运行|读不出/, n.err);
});

test('EV-151 S6：短临界区锁、或持锁进程还活着 ⇒ 不收尾（只处理已确认不在的运行锁）', async () => {
  const ctx = await fakeCtx();
  const l = await seedRunning(ctx, 'R-C');
  // 短临界区锁：持锁进程已退出、被回收，但 kind 不是 run
  await plantLock(ctx, { run_id: 'R-C', pid: await deadPid(), kind: 'critical' });
  const c = await acquireAndSettle(ctx);
  assert.equal(c.value.length, 1);
  assert.equal((await readRunMeta(l, 'plan', 'R-C'))?.status, 'running');
  assert.doesNotMatch(c.err, /上一轮运行/);
  // 直接喂一份原因不是 pid_gone / pid_reused 的回收记录（heartbeat_dead：持锁进程活着、运行已终态）
  const h = await captureStderr(() =>
    settleReclaimedRunLocks(ctx, [{
      reason: 'heartbeat_dead',
      content: {
        topic: TOPIC, stage: 'plan', run_id: 'R-C', pid: process.pid, pid_started_at: null, pid_started_at_canonical: null,
        acquired_at: new Date().toISOString(), kind: 'run',
      },
    }]),
  );
  assert.equal((await readRunMeta(l, 'plan', 'R-C'))?.status, 'running');
  assert.equal(h.err, '');
});

test('EV-151 S7：没有回收时 reclaimed 为空数组', async () => {
  const ctx = await fakeCtx();
  const lock = await acquireLock({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', kind: 'run', heartbeatStaleMs: STALE });
  try {
    assert.deepEqual(lock.reclaimed, []);
  } finally {
    await lock.release();
  }
});
