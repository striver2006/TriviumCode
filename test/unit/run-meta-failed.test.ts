import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  finalizeCancelledRunMeta, finalizeFailedRunMeta, newRunMeta, readTask, registerRun, taskLockName, writeRunMeta,
  type TaskLock,
} from '../../src/trivium/meta.js';
import { metaDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import { withTopicLock } from '../../src/trivium/lock.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import type { RunMeta, RunTermination } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

/**
 * EV-142：没走到 worker 收尾就失败的运行，归档侧收尾为 failed（计划 r2 §3.1 / §4.1 F1～F7）。
 *
 * 直测 `finalizeFailedRunMeta`：目标终态参数化、`termination` 只由这条路写、第二步只同步同一终态、
 * 第一步在主题任务锁里判与写。经 worker 异常分支与 `--wait` 失联分支的接线由
 * `test/integration/gate-loop.test.ts` 的 W1 / W2 与 `run-protocol.test.ts` 的 L1～L5 守。
 */

const TOPIC = '失败收尾';
const RUN = '20260927T000000Z';
const LOST: RunTermination = { by: 'worker_lost', reason: 'pid_gone' };

async function setup(): Promise<{ layout: ArchiveLayout; lock: TaskLock; runJson: string; taskJson: string }> {
  const root = await fs.realpath(await scratchDir('trivium-failed-'));
  const layout: ArchiveLayout = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
  const lock: TaskLock = { triviumDir: path.join(root, '.trivium'), heartbeatStaleMs: 120_000 };
  return {
    layout, lock,
    runJson: path.join(metaDir(layout, 'plan'), `run-${RUN}.json`),
    taskJson: path.join(layout.archiveRoot, TOPIC, 'task.json'),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function seed(env: Env, over: (m: RunMeta) => void = () => {}): Promise<RunMeta> {
  const m = newRunMeta({
    runId: RUN, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
    criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn', effectiveFailurePolicy: 'strict',
  });
  m.artifacts = [{ path: `${TOPIC}/plan/_meta/brief-glm-${RUN}.md`, sha256: 'a'.repeat(64) }];
  await writeRunMeta(env.layout, 'plan', m); // 先落骨架、再登记，与 prepareRun 同序
  await registerRun(env.layout, m, env.lock);
  over(m);
  await writeRunMeta(env.layout, 'plan', m); // over 只改 run.json，登记保持骨架期的 running
  return m;
}

const fail = (env: Env, termination: RunTermination = LOST, workerGone = true) =>
  finalizeFailedRunMeta({ layout: env.layout, stage: 'plan', runId: RUN, lock: env.lock, workerGone, termination });

const readRun = async (env: Env) => JSON.parse(await fs.readFile(env.runJson, 'utf8')) as RunMeta;

test('F1：v3 骨架 ⇒ 两步都写；failed 带 termination 与 partial 原因，其余逐键不变', async () => {
  const env = await setup();
  const before = await seed(env);
  const termination: RunTermination = { by: 'worker_exception', exit_code: 69 };
  const r = await fail(env, termination);
  assert.deepEqual(r, { runMeta: { kind: 'written' }, task: { kind: 'written' } });

  const after = await readRun(env);
  assert.deepEqual(validateRunMeta(after), []);
  assert.equal(after.status, 'failed');
  assert.equal(after.effective_failure_policy, 'strict');
  assert.equal(after.gate.state, 'failed');
  assert.equal(after.review_mode, 'partial');
  assert.match(after.degraded_reason!, /运行异常收尾/);
  assert.deepEqual(after.termination, termination);
  assert.ok(after.finished_at && !Number.isNaN(Date.parse(after.finished_at)));
  const strip = (m: RunMeta) => {
    const { termination: _t, ...rest } = m;
    return { ...rest, status: null, finished_at: null, review_mode: null, degraded_reason: null, gate: { ...m.gate, state: null } };
  };
  assert.deepEqual(strip(after), strip(before));
  assert.equal((await readTask(env.layout)).runs.find((e) => e.run_id === RUN)?.status, 'failed');
});

test('F2：run.json 已是 success（worker 写完收尾之后才抛的异常）⇒ 不追溯改写，run.json 与 task.json 逐字节不变', async () => {
  const env = await setup();
  await seed(env, (m) => { m.status = 'success'; m.gate.state = 'review_done_awaiting_disposition'; });
  const runBefore = await fs.readFile(env.runJson, 'utf8');
  const taskBefore = await fs.readFile(env.taskJson, 'utf8');
  const r = await fail(env, { by: 'worker_exception', exit_code: 70 });
  assert.match(r.runMeta.kind === 'skipped' ? r.runMeta.why : '', /已是终态（success）/);
  assert.equal(r.task.kind, 'skipped');
  assert.equal(await fs.readFile(env.runJson, 'utf8'), runBefore);
  assert.equal(await fs.readFile(env.taskJson, 'utf8'), taskBefore);
});

test('F3：run.json 已是 failed、登记仍 running（上一次在两次写之间被打断）⇒ 第一步跳过、第二步把登记补成 failed', async () => {
  const env = await setup();
  await seed(env, (m) => { m.status = 'failed'; m.gate.state = 'failed'; m.finished_at = new Date().toISOString(); });
  assert.equal((await readTask(env.layout)).runs[0]?.status, 'running');
  const r = await fail(env);
  assert.equal(r.runMeta.kind, 'skipped');
  assert.equal(r.task.kind, 'written');
  assert.equal((await readTask(env.layout)).runs[0]?.status, 'failed');
});

test('F4：run.json 已是 cancelled、登记 running ⇒ 第二步也跳过（只同步目标终态 failed，不照抄别的终态）', async () => {
  const env = await setup();
  await seed(env, (m) => { m.status = 'cancelled'; m.gate.state = 'cancelled'; m.finished_at = new Date().toISOString(); });
  const taskBefore = await fs.readFile(env.taskJson, 'utf8');
  const r = await fail(env);
  assert.equal(r.runMeta.kind, 'skipped');
  assert.equal(r.task.kind, 'skipped');
  assert.match(r.task.kind === 'skipped' ? r.task.why : '', /不是 failed（cancelled）/);
  assert.equal(await fs.readFile(env.taskJson, 'utf8'), taskBefore);
});

test('F5：工作进程未确认退出 ⇒ 不写 run.json，原因写明「未确认」，文件逐字节不变', async () => {
  const env = await setup();
  await seed(env);
  const runBefore = await fs.readFile(env.runJson, 'utf8');
  const r = await fail(env, LOST, false);
  assert.match(r.runMeta.kind === 'skipped' ? r.runMeta.why : '', /未确认退出/);
  assert.equal(await fs.readFile(env.runJson, 'utf8'), runBefore);
  assert.equal(r.task.kind, 'skipped');
});

test('F6：第一步在主题任务锁里判与写——锁被占着时不写，放锁后才写', async () => {
  const env = await setup();
  await seed(env);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let acquired!: () => void;
  const isHeld = new Promise<void>((r) => { acquired = r; });
  const holder = withTopicLock(
    { triviumDir: env.lock.triviumDir, topic: taskLockName(TOPIC), heartbeatStaleMs: env.lock.heartbeatStaleMs },
    async () => { acquired(); await held; },
  );
  await isHeld;
  const pending = fail(env);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await readRun(env)).status, 'running', '锁被占着时不得写 run.json');
  release();
  await holder;
  const r = await pending;
  assert.equal(r.runMeta.kind, 'written');
  assert.equal((await readRun(env)).status, 'failed');
});

test('F7：取消与失败两个收尾同时发起 ⇒ 恰一个写 run.json，另一个读到终态跳过；run.json 只有一种终态', async () => {
  const env = await setup();
  await seed(env);
  const [a, b] = await Promise.all([
    finalizeCancelledRunMeta({ layout: env.layout, stage: 'plan', runId: RUN, lock: env.lock, workerGone: true }),
    fail(env),
  ]);
  const written = [a, b].filter((x) => x.runMeta.kind === 'written');
  assert.equal(written.length, 1, JSON.stringify([a.runMeta, b.runMeta]));
  const loser = [a, b].find((x) => x.runMeta.kind === 'skipped')!;
  assert.match(loser.runMeta.kind === 'skipped' ? loser.runMeta.why : '', /已是终态/);
  const final = await readRun(env);
  assert.ok(final.status === 'cancelled' || final.status === 'failed');
  // 登记跟着赢家的终态走
  assert.equal((await readTask(env.layout)).runs[0]?.status, final.status);
});
