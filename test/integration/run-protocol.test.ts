import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as childProcess from 'node:child_process';
import {
  bashTimeoutFor, cancelRun, classifyLostCancel, lostWorkerGoneFrom, runDirFor, settleOrphanedStart, statusRun, waitRun,
  workerGoneForCancel,
  WORKER_TERM_GRACE_MS, WORKER_TREE_GRACE_MS, WORKER_TREE_KILL_WAIT_MS,
} from '../../src/trivium/run-protocol.js';
import { getGate, setGate } from '../../src/trivium/state.js';
import { newStatus, readStatus, staleThresholdWithinHeartbeat, writeStatus, type RunStatus } from '../../src/trivium/status.js';
import { checkHeartbeatThreshold } from '../../src/trivium/preflight.js';
import { acquireLock, inspectLock } from '../../src/trivium/lock.js';
import { spawnDetached, processStartTime, processStartTimes, processAlive } from '../../src/trivium/util/exec.js';
import { ENV_R, ENV_W, assertEnvPairDistinct, withEnv } from '../helpers/start-env.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { groupMemberCount, groupsWithMark, killGroup } from '../helpers/proc.js';
import { captureStderr, fakeCtx } from '../helpers/run-ctx.js';
import { newRunMeta, readTask, registerRun, writeRunMeta } from '../../src/trivium/meta.js';
import { metaDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { Ctx, RunMeta } from '../../src/trivium/types.js';

/**
 * 协议层的自动化验证：用**假 worker**（一个长睡的 node 进程）代替真实双审，
 * 因此不依赖厂商 CLI、不消耗配额，可在 CI 里重复跑。
 *
 * 真实端到端（含两家 Agent）属于 §17.3 的手工验收剧本，不在此覆盖。
 */

const TOPIC = '协议用例';

/** 起一个长睡的假 worker，并把运行目录布置成 --start 之后的样子 */
async function seedRun(ctx: Ctx, runId: string, sleepMs = 60_000) {
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  const script = path.join(runDir, 'fake-worker.mjs');
  await fs.writeFile(script, `setTimeout(() => process.exit(0), ${sleepMs});`, 'utf8');
  const spawned = await spawnDetached(process.execPath, [script], {
    cwd: ctx.projectRoot,
    logFile: path.join(runDir, 'worker.log'),
  });
  await fs.writeFile(path.join(runDir, 'worker.pid'), `${spawned.pid}\n`, 'utf8');

  const s = newStatus({
    runId, topic: TOPIC, stage: 'plan',
    sides: ['gemini', 'glm'], models: { gemini: 'M1', glm: 'M2' },
  });
  s.phase = 'running';
  s.worker_pid = spawned.pid;
  s.worker_started_at = await processStartTime(spawned.pid);
  await writeStatus(runDir, s);

  return { runDir, pid: spawned.pid };
}

function killQuietly(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
}

test('--status 在运行中返回 73 并渲染两侧进度', async () => {
  const ctx = await fakeCtx();
  const { pid } = await seedRun(ctx, 'R-STATUS');
  try {
    const out = await statusRun(ctx, 'R-STATUS');
    assert.equal(out.exitCode, EXIT.STILL_RUNNING);
    assert.match(out.progress, /阶段状态 审查中/);
    assert.match(out.progress, /gemini/);
    assert.match(out.progress, /glm/);
    // 手工自查与自动等待循环看到同样的期待值（审查意见 AGY-03）
    assert.match(out.progress, /预算/);
    assert.match(out.progress, /次等待/);
  } finally {
    killQuietly(pid);
  }
});

test('尚无有效心跳时：status 为 null，字段退化而非报错（AC-19）', async () => {
  const ctx = await fakeCtx();
  const runId = 'R-NO-HEARTBEAT';
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  // 只起进程、写 pid，**不写 status.json**——worker 还没产生第一次心跳的那一瞬
  const script = path.join(runDir, 'fake-worker.mjs');
  await fs.writeFile(script, 'setTimeout(() => process.exit(0), 60000);', 'utf8');
  const spawned = await spawnDetached(process.execPath, [script], {
    cwd: ctx.projectRoot,
    logFile: path.join(runDir, 'worker.log'),
  });
  await fs.writeFile(path.join(runDir, 'worker.pid'), `${spawned.pid}\n`, 'utf8');

  try {
    const out = await waitRun(ctx, runId, 1); // 1s 窗口，立刻用尽
    assert.equal(out.exitCode, EXIT.STILL_RUNNING);
    assert.equal(out.status, null);
    assert.match(out.progressBrief, /仍在启动中/);
    assert.equal(out.progress, out.progressBrief, 'null 时两者是同一句提示');
    assert.equal(out.view, null);
    // budget 不依赖运行状态，仍须给出——max_waits 照样有意义
    assert.ok(out.budget.maxWaits > 0);
  } finally {
    killQuietly(spawned.pid);
  }
});

test('Bash 工具超时贴着等待窗口，并封顶在平台上限', () => {
  // 窗口 180s：留 60s 余量覆盖启动与收尾，卡死 4 分钟就能发现
  assert.equal(bashTimeoutFor(180), 240_000);
  // 窗口仍是 540s 时结果与改动前一致，既有项目不受影响
  assert.equal(bashTimeoutFor(540), 600_000);
  // 超过平台上限一律封顶
  assert.equal(bashTimeoutFor(900), 600_000);
});

test('--status 对不存在的运行返回 65', async () => {
  const ctx = await fakeCtx();
  const out = await statusRun(ctx, 'R-NOPE');
  assert.equal(out.exitCode, EXIT.MISSING_ARTIFACT);
  assert.equal(out.status, null);
});

test('--wait 窗口用尽时返回 73（这是预期返回，不是失败）', async () => {
  const ctx = await fakeCtx();
  const { pid } = await seedRun(ctx, 'R-WAIT');
  try {
    const t0 = Date.now();
    const out = await waitRun(ctx, 'R-WAIT', 3);
    const elapsed = Date.now() - t0;
    assert.equal(out.exitCode, EXIT.STILL_RUNNING);
    assert.ok(elapsed >= 2800, `应真的等满窗口，实际 ${elapsed}ms`);
    assert.ok(elapsed < 9000, `不应远超窗口，实际 ${elapsed}ms`);
    assert.match(out.progress, /R-WAIT/);
    assert.equal((await processAlive(pid)).alive, true, '--wait 返回不得影响工作进程');
  } finally {
    killQuietly(pid);
  }
});

test('--wait 在工作进程写下终态后立即返回其退出码', async () => {
  const ctx = await fakeCtx();
  const { runDir, pid } = await seedRun(ctx, 'R-DONE');
  try {
    // 模拟 worker 完成
    const s = (await readStatus(runDir))!;
    s.phase = 'success';
    s.exit_code = EXIT.OK;
    s.artifacts = ['t/plan/x-gemini.md', 't/plan/x-glm.md'];
    await writeStatus(runDir, s);

    const t0 = Date.now();
    const out = await waitRun(ctx, 'R-DONE', 30);
    assert.equal(out.exitCode, EXIT.OK);
    assert.ok(Date.now() - t0 < 4000, '终态应立即返回，不等满窗口');
    assert.deepEqual(out.status?.artifacts, ['t/plan/x-gemini.md', 't/plan/x-glm.md']);
  } finally {
    killQuietly(pid);
  }
});

test('--wait 透出工作进程记录的失败退出码', async () => {
  const ctx = await fakeCtx();
  const { runDir, pid } = await seedRun(ctx, 'R-FAIL');
  try {
    const s = (await readStatus(runDir))!;
    s.phase = 'failed';
    s.exit_code = EXIT.STRICT_ABORT;
    s.message = '严格模式单侧失败';
    await writeStatus(runDir, s);
    const out = await waitRun(ctx, 'R-FAIL', 10);
    assert.equal(out.exitCode, EXIT.STRICT_ABORT);
    assert.equal(out.status?.message, '严格模式单侧失败');
  } finally {
    killQuietly(pid);
  }
});

test('--wait 发现工作进程失联时抛错并把终态写下来', async () => {
  const ctx = await fakeCtx();
  const { runDir, pid } = await seedRun(ctx, 'R-LOST');
  // 杀掉假 worker，模拟猝死且未留终态
  killQuietly(pid);
  await new Promise((r) => setTimeout(r, 300));

  await assert.rejects(waitRun(ctx, 'R-LOST', 10), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.FAIL);
    assert.match(e.message, /失联/);
    assert.match(e.message, /worker\.log/, '应指出日志位置便于排查');
    return true;
  });
  // 失联判定必须落盘，否则下次 --wait 还要重新等一遍
  const s = await readStatus(runDir);
  assert.equal(s?.phase, 'failed');
  assert.match(s?.message ?? '', /worker_lost/);
});

test('--wait 对不存在的运行目录报 65', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(waitRun(ctx, 'R-GHOST', 5), (e: { code?: number }) => {
    assert.equal(e.code, EXIT.MISSING_ARTIFACT);
    return true;
  });
});

test('--cancel 终止工作进程、标 cancelled、并回收主题锁', async () => {
  const ctx = await fakeCtx();
  const { pid } = await seedRun(ctx, 'R-CANCEL');
  // 布置一把由该运行持有的锁
  const lock = await acquireLock({
    triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan',
    runId: 'R-CANCEL', kind: 'run', heartbeatStaleMs: 120_000,
  });
  await fs.writeFile(
    lock.path,
    JSON.stringify({ ...lock.content, pid, pid_started_at: await processStartTime(pid) }, null, 2),
    'utf8',
  );

  const code = await cancelRun(ctx, 'R-CANCEL');
  assert.equal(code, EXIT.OK);
  await new Promise((r) => setTimeout(r, 500));

  assert.equal((await processAlive(pid)).alive, false, '工作进程应已被终止');
  const s = await readStatus(runDirFor(ctx.config, ctx.projectRoot, 'R-CANCEL'));
  assert.equal(s?.phase, 'cancelled');
  assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '锁应被回收——这是卡死时唯一的恢复路径');
});

/*
 * ── EV-128：--cancel 的归档侧收尾（计划 r2 §4.2 E1 / E3 / E6）──
 *
 * `seedRun` 只布置运行目录；这里再按 prepareRun 的样子摆一份 v2 骨架 run.json 与 task.json 登记。
 */
async function seedArchive(ctx: Ctx, runId: string): Promise<{ layout: ArchiveLayout; runJson: string; taskJson: string; meta: RunMeta }> {
  const layout: ArchiveLayout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  const meta = newRunMeta({
    runId, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
    criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn',
  });
  meta.artifacts = [{ path: `${TOPIC}/plan/_meta/brief-glm-${runId}.md`, sha256: 'a'.repeat(64) }];
  await writeRunMeta(layout, 'plan', meta);
  await registerRun(layout, meta, { triviumDir: ctx.triviumDir, heartbeatStaleMs: 120_000 });
  return {
    layout, meta,
    runJson: path.join(metaDir(layout, 'plan'), `run-${runId}.json`),
    taskJson: path.join(ctx.archiveRoot, TOPIC, 'task.json'),
  };
}

async function holdLock(ctx: Ctx, runId: string, pid: number): Promise<void> {
  const lock = await acquireLock({
    triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan',
    runId, kind: 'run', heartbeatStaleMs: 120_000,
  });
  await fs.writeFile(
    lock.path,
    JSON.stringify({ ...lock.content, pid, pid_started_at: await processStartTime(pid) }, null, 2),
    'utf8',
  );
}

test('EV-128 E1：--cancel 把归档 run.json 与 task.json 登记收尾为 cancelled，且排在 status.json 之前写', async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-ARCH');
  const a = await seedArchive(ctx, 'R-ARCH');
  await holdLock(ctx, 'R-ARCH', pid);

  const { value: code, err } = await captureStderr(() => cancelRun(ctx, 'R-ARCH'));
  assert.equal(code, EXIT.OK);

  const after = JSON.parse(await fs.readFile(a.runJson, 'utf8')) as RunMeta;
  assert.equal(after.status, 'cancelled');
  assert.equal(after.gate.state, 'cancelled');
  assert.ok(after.finished_at, 'finished_at 应已写入');
  assert.deepEqual(after.artifacts, a.meta.artifacts, 'artifacts[] 必须原样（提交锚只放行不删改登记的收尾）');
  assert.equal((await readTask(a.layout)).runs.find((r) => r.run_id === 'R-ARCH')?.status, 'cancelled');
  assert.match(err, /已把归档里的 run-R-ARCH\.json 收尾为 cancelled/);
  assert.match(err, /已把 task\.json 的运行登记同步为 cancelled/);
  assert.equal((await readStatus(runDir))?.phase, 'cancelled');
  assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null);

  /*
   * 顺序：归档侧必须先于 status.json 落终态（计划双审 r1 CODEX-01 ≡ GLM-01）。
   * 排在后面时，进程死在两次写之间，再跑 --cancel 会在终态分支早退，run.json 永远停在 running。
   * 中断本身在集成里造不出来（不为此往 cancelRun 加测试钩子），用两份文件的修改时间钉住先后。
   * 前提：纳秒级时间戳（APFS / ext4 等）。粗粒度文件系统上两次写可能落进同一刻度，这里会假红、不会假绿
   * （代码双审 r1 CODEX-04 ≡ AGY-01）；不放宽成「小于等于」，那会让 M12 在粗粒度卷上假绿。
   */
  const mt = async (p: string) => (await fs.stat(p, { bigint: true })).mtimeNs;
  const statusMt = await mt(path.join(runDir, 'status.json'));
  assert.ok((await mt(a.runJson)) < statusMt, 'run.json 应先于 status.json 写');
  assert.ok((await mt(a.taskJson)) < statusMt, 'task.json 登记应先于 status.json 写');
});

test('EV-128 E3：工作进程未确认退出（运行中却拿不到 worker_pid）⇒ 归档 run.json 不写，输出写明原因', async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-UNSURE');
  try {
    // workerConfirmedGone：非终态且拿不到 pid ⇒ gone: false（没有证据）
    const s = (await readStatus(runDir))!;
    s.worker_pid = null;
    s.worker_started_at = null;
    await writeStatus(runDir, s);
    await fs.rm(path.join(runDir, 'worker.pid'));
    const a = await seedArchive(ctx, 'R-UNSURE');
    const runBefore = await fs.readFile(a.runJson, 'utf8');
    const taskBefore = await fs.readFile(a.taskJson, 'utf8');

    const { value: code, err } = await captureStderr(() => cancelRun(ctx, 'R-UNSURE'));
    assert.equal(code, EXIT.OK);
    assert.equal(await fs.readFile(a.runJson, 'utf8'), runBefore, '未确认退出时 run.json 必须逐字节不变');
    assert.equal(await fs.readFile(a.taskJson, 'utf8'), taskBefore);
    assert.match(err, /归档 run-R-UNSURE\.json 未回写：工作进程未确认退出/);
  } finally {
    killQuietly(pid);
  }
});

test('EV-128 E6：归档侧写失败（_meta 只读）不连坐锁与闸门回收：退 0、锁已回收、status.json 为 cancelled、告警写明原因', { skip: process.getuid?.() === 0 && 'root 下只读目录拦不住写入' }, async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-ROFS');
  const a = await seedArchive(ctx, 'R-ROFS');
  await holdLock(ctx, 'R-ROFS', pid);
  const dir = path.dirname(a.runJson);
  await fs.chmod(dir, 0o555);
  try {
    const { value: code, err } = await captureStderr(() => cancelRun(ctx, 'R-ROFS'));
    assert.equal(code, EXIT.OK);
    assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '归档侧失败不得挡住锁回收');
    assert.equal((await readStatus(runDir))?.phase, 'cancelled');
    assert.match(err, /归档 run-R-ROFS\.json 未回写：回写 run\.json 出错：/);
    // 单步写失败没有第二次机会，告警要当场说出来（代码双审 r1 CODEX-01）
    assert.match(err, /这一步不会再有第二次机会.*请人工核对归档 run\.json 与 task\.json 的运行登记/);
    assert.equal((JSON.parse(await fs.readFile(a.runJson, 'utf8')) as RunMeta).status, 'running');
  } finally {
    await fs.chmod(dir, 0o755);
    killQuietly(pid);
  }
});

/*
 * ── EV-142：--wait 判 worker_lost 时的归档侧收尾（计划 r2 §3.3 / §4.2 L1～L5）──
 */

/** 把 status.json 的心跳改成一小时前（writeStatus 会刷新心跳，所以直接写文件） */
async function staleHeartbeat(runDir: string, patch: (s: Record<string, unknown>) => void = () => {}): Promise<void> {
  const p = path.join(runDir, 'status.json');
  const s = JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, unknown>;
  s['heartbeat_at'] = new Date(Date.now() - 3_600_000).toISOString();
  patch(s);
  await fs.writeFile(p, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

/** waitRun 预期抛失联；返回报错正文 */
async function lostMessage(ctx: Ctx, runId: string): Promise<string> {
  let message = '';
  await assert.rejects(waitRun(ctx, runId, 10), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.FAIL);
    message = e.message;
    return true;
  });
  return message;
}

test('EV-142 L1：worker 被杀后 --wait 判 pid_gone ⇒ 归档 run.json 收尾为 failed、带 termination，task.json 同步', async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-LOST-ARCH');
  const a = await seedArchive(ctx, 'R-LOST-ARCH');
  killQuietly(pid);
  await new Promise((r) => setTimeout(r, 300));

  const message = await lostMessage(ctx, 'R-LOST-ARCH');
  const after = JSON.parse(await fs.readFile(a.runJson, 'utf8')) as RunMeta;
  assert.equal(after.status, 'failed');
  assert.equal(after.gate.state, 'failed');
  assert.ok(after.finished_at);
  assert.deepEqual(after.termination, { by: 'worker_lost', reason: 'pid_gone' });
  assert.deepEqual(after.artifacts, a.meta.artifacts, 'artifacts[] 必须原样');
  assert.equal((await readTask(a.layout)).runs.find((r) => r.run_id === 'R-LOST-ARCH')?.status, 'failed');
  assert.match(message, /已把归档里的 run-R-LOST-ARCH\.json 收尾为 failed/);
  assert.match(message, /已把 task\.json 的运行登记同步为 failed/);
  assert.equal((await readStatus(runDir))?.phase, 'failed');

  /*
   * L4：归档侧必须先于 status.json 落终态（计划 r2 §3.3）——反过来排，下一次 --wait 按终态直接返回，没有第二次机会。
   * 前提同 E1：纳秒级时间戳；粗粒度文件系统上会假红、不会假绿。
   */
  const mt = async (p: string) => (await fs.stat(p, { bigint: true })).mtimeNs;
  const statusMt = await mt(path.join(runDir, 'status.json'));
  assert.ok((await mt(a.runJson)) < statusMt, 'run.json 应先于 status.json 写');
  assert.ok((await mt(a.taskJson)) < statusMt, 'task.json 登记应先于 status.json 写');
});

test('EV-142 L2：进程还活着、只是心跳过期（heartbeat_stale）⇒ 归档 run.json 不写，报错写明未确认退出', async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-STALE-ARCH');
  try {
    const a = await seedArchive(ctx, 'R-STALE-ARCH');
    await staleHeartbeat(runDir);
    const runBefore = await fs.readFile(a.runJson, 'utf8');
    const taskBefore = await fs.readFile(a.taskJson, 'utf8');

    const message = await lostMessage(ctx, 'R-STALE-ARCH');
    assert.match(message, /heartbeat_stale/);
    assert.equal(await fs.readFile(a.runJson, 'utf8'), runBefore, '进程还在，可能还有写者，run.json 必须逐字节不变');
    assert.equal(await fs.readFile(a.taskJson, 'utf8'), taskBefore);
    assert.match(message, /归档 run-R-STALE-ARCH\.json 未回写：工作进程未确认退出/);
  } finally {
    killQuietly(pid);
  }
});

test('EV-142 L3：运行中却拿不到 pid、心跳过期 ⇒ 用改写前的 status.json 判「未确认」，run.json 不写', async () => {
  /*
   * 这一格改写前后判定不一致：改写前 phase 为 running 且无 pid ⇒ workerConfirmedGone 判「否」；
   * waitRun 把 status.json 写成 failed 之后再判，会走「终态且从未记下 pid ⇒ 已不在」那一支判「是」。
   * 归档写入必须用前者（计划 r2 §3.3），否则就替没确认的事作证。
   */
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-NOPID-ARCH');
  try {
    await fs.rm(path.join(runDir, 'worker.pid'));
    await staleHeartbeat(runDir, (s) => { s['worker_pid'] = null; s['worker_started_at'] = null; });
    const a = await seedArchive(ctx, 'R-NOPID-ARCH');
    const runBefore = await fs.readFile(a.runJson, 'utf8');

    const message = await lostMessage(ctx, 'R-NOPID-ARCH');
    assert.match(message, /heartbeat_stale/);
    assert.equal(await fs.readFile(a.runJson, 'utf8'), runBefore);
    assert.match(message, /未回写：工作进程未确认退出/);
  } finally {
    killQuietly(pid);
  }
});

test('EV-142 L5：status.json 读不到、worker.pid 指向的进程已死（pid_gone）⇒ 也收尾为 failed；进程活着则不判失联', async () => {
  /*
   * worker 在第一次写 status.json 之前就死了（计划双审 r1 CODEX-01 ≡ GLM-01 ≡ AGY-02）：
   * interpretStatus 拿 worker.pid 判出「已死」才报 pid_gone，证据在手；workerConfirmedGone(null) 却首行判「否」。
   * 身份取交接文件（startRun 在写 status.json 之前就写好了）。
   */
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-NOSTATUS-ARCH');
  await fs.rm(path.join(runDir, 'status.json'));
  await fs.writeFile(path.join(runDir, 'request.json'), JSON.stringify({ topic: TOPIC, stage: 'plan' }) + '\n', 'utf8');
  const a = await seedArchive(ctx, 'R-NOSTATUS-ARCH');

  // 对照：进程还活着 ⇒ 情形 A 判 inconclusive，窗口用尽退 73，run.json 不动
  const runBefore = await fs.readFile(a.runJson, 'utf8');
  const alive = await waitRun(ctx, 'R-NOSTATUS-ARCH', 2);
  assert.equal(alive.exitCode, EXIT.STILL_RUNNING);
  assert.equal(await fs.readFile(a.runJson, 'utf8'), runBefore);

  killQuietly(pid);
  await new Promise((r) => setTimeout(r, 300));
  const message = await lostMessage(ctx, 'R-NOSTATUS-ARCH');
  assert.match(message, /pid_gone/);
  const after = JSON.parse(await fs.readFile(a.runJson, 'utf8')) as RunMeta;
  assert.equal(after.status, 'failed');
  assert.deepEqual(after.termination, { by: 'worker_lost', reason: 'pid_gone' });
  assert.equal((await readTask(a.layout)).runs.find((r) => r.run_id === 'R-NOSTATUS-ARCH')?.status, 'failed');
  assert.doesNotMatch(message, /未确认退出/, '失联原因是 pid_gone，却又说未确认退出——两句互相矛盾（r1 GLM-01）');
});

test('--cancel 对已退出的工作进程也能清理状态与锁', async () => {
  const ctx = await fakeCtx();
  const { pid } = await seedRun(ctx, 'R-DEADCANCEL', 100);
  await new Promise((r) => setTimeout(r, 600)); // 等它自己退出
  assert.equal((await processAlive(pid)).alive, false);

  const code = await cancelRun(ctx, 'R-DEADCANCEL');
  assert.equal(code, EXIT.OK, '进程已死也应能正常清理');
  const s = await readStatus(runDirFor(ctx.config, ctx.projectRoot, 'R-DEADCANCEL'));
  assert.equal(s?.phase, 'cancelled');
});

/*
 * ── EV-150：--start 在子进程诞生之后失败的收尾（派生后失败的孤儿worker计划 r2 §4.1 U5 / U6）──
 *
 * 改写锁之后、写 status.json、关日志句柄三个失败点零配额造不出（计划 r2 §2.3），
 * 所以把 `settleOrphanedStart` 放到进程内夹具上、注入「终止结果」，逐格钉住次序、D5 与锁的回收。
 */
const FAKE_WORKER = 999_991; // 不存在的 pid：只被写进锁与 status.json，从不向它发信号（terminate 是注入的）

async function seedOrphan(ctx: Ctx, runId: string, o: { lockAsWorker?: boolean } = {}) {
  const a = await seedArchive(ctx, runId);
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  await writeStatus(runDir, newStatus({ runId, topic: TOPIC, stage: 'plan', sides: ['gemini', 'glm'], models: {} }));
  const lock = await acquireLock({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', kind: 'run', heartbeatStaleMs: 120_000 });
  if (o.lockAsWorker) {
    // 失败点在 :405 之后：锁内容已改写成 worker 的（S5）
    await fs.writeFile(lock.path, JSON.stringify({ ...lock.content, run_id: runId, pid: FAKE_WORKER, pid_started_at: 'T-worker' }, null, 2) + '\n', 'utf8');
  }
  return { ...a, runDir, lock };
}

const watchOf = (exited: boolean) => ({
  hasExited: () => exited,
  exited: new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(() => {}),
});

test('EV-150 U5①：确认退出 ⇒ 终止先于闸门回收；随后闸门 idle、run.json 与登记 failed（post_spawn_exception）、status.json failed、已改写成 worker 的锁按 run_id 回收', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-ORPH1', { lockAsWorker: true });
  let gateAtTerminate: string | null = null;
  const { err } = await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-ORPH1', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(true) }, workerStartedAt: 'T-worker', error: new Error('EISDIR'),
      terminate: async () => {
        // 计划双审 r1 AGY-03：终止发生时闸门必须仍是本轮 running——回收排在终止之后
        const g = await getGate(ctx.triviumDir, TOPIC, 'plan');
        gateAtTerminate = `${g?.state}/${g?.run_id}`;
        return { gone: true, escalated: false, signals: ['SIGTERM'] };
      },
    }),
  );
  assert.equal(gateAtTerminate, 'running/R-ORPH1', '终止时闸门应仍为本轮 running');
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'idle');
  const m = JSON.parse(await fs.readFile(s.runJson, 'utf8')) as RunMeta;
  assert.equal(m.status, 'failed');
  assert.deepEqual(m.termination, { by: 'post_spawn_exception', exit_code: EXIT.FAIL });
  assert.equal((await readTask(s.layout)).runs.find((r) => r.run_id === 'R-ORPH1')?.status, 'failed');
  const st = await readStatus(s.runDir);
  assert.equal(st?.phase, 'failed');
  assert.equal(st?.worker_pid, FAKE_WORKER);
  assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '已改写成本轮 worker 的锁应被回收（release() 不删它）');
  assert.match(err, /已终止工作进程组 999991（SIGTERM）/);
  assert.match(err, /收尾为 failed（派生后启动未完成）/);
});

test('EV-150 U5②：确认不了退出 ⇒ 闸门、run.json、status.json 的 phase 不动；补记 worker_pid 与启动时刻；本进程内容的锁改记到 worker 名下；给出 --cancel 出路', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-ORPH2');
  const runBefore = await fs.readFile(s.runJson, 'utf8');
  const { err } = await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-ORPH2', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(false) }, workerStartedAt: null, error: new Error('EISDIR'),
      terminate: async () => ({ gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'] }),
      startTimeOf: async () => 'T-started',
    }),
  );
  const g = await getGate(ctx.triviumDir, TOPIC, 'plan');
  assert.equal(`${g?.state}/${g?.run_id}`, 'running/R-ORPH2', 'D5：闸门留给可能还活着的写者');
  assert.equal(await fs.readFile(s.runJson, 'utf8'), runBefore, 'D5：run.json 逐字节不变');
  const st = await readStatus(s.runDir);
  assert.equal(st?.phase, 'starting', 'D5：status.json 的 phase 不动');
  assert.equal(st?.worker_pid, FAKE_WORKER, '计划双审 r1 GLM-03：补记 worker_pid，--cancel 才找得到它');
  assert.equal(st?.worker_started_at, 'T-started', '计划双审 r1 CODEX-02：连启动时刻一起补，--cancel 才有复用防护');
  const lk = await inspectLock(ctx.triviumDir, TOPIC);
  assert.deepEqual(
    lk && { run_id: lk.run_id, pid: lk.pid, pid_started_at: lk.pid_started_at },
    { run_id: 'R-ORPH2', pid: FAKE_WORKER, pid_started_at: 'T-started' },
    '计划双审 r1 AGY-01：锁跟着可能还活着的 worker 走，本进程退出后不会按 pid_gone 被回收',
  );
  assert.match(err, /工作进程 999991 未能确认退出/);
  // 代码双审 r1 CODEX-01 ≡ GLM-01：没确认退出就不能说「已终止」；锁改写成功才说「已记在它名下」
  assert.match(err, /已向工作进程组 999991 发送 SIGTERM、SIGKILL，未能确认退出/);
  assert.doesNotMatch(err, /已终止工作进程组/);
  assert.match(err, /主题锁已记在它名下/);
  assert.match(err, /trivium review --cancel R-ORPH2/);
});

test('EV-150 U5③：收尾窗口里主题锁已被新一轮接管 ⇒ 第 6 步不删它，新一轮的闸门也不动', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-ORPH3', { lockAsWorker: true });
  // 新一轮按 pid_gone 接管了锁与闸门（计划双审 r1 CODEX-01 ≡ GLM-05）
  const other = { ...s.lock.content, run_id: 'R-NEXT', pid: process.pid, acquired_at: new Date(Date.now() + 1000).toISOString() };
  await fs.writeFile(s.lock.path, JSON.stringify(other, null, 2) + '\n', 'utf8');
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId: 'R-NEXT', heartbeatStaleMs: 120_000 });
  await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-ORPH3', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(true) }, workerStartedAt: null, error: new Error('x'),
      terminate: async () => ({ gone: true, escalated: false, signals: [] }),
    }),
  );
  assert.equal((await inspectLock(ctx.triviumDir, TOPIC))?.run_id, 'R-NEXT', '新持有者的锁不得被删');
  const g = await getGate(ctx.triviumDir, TOPIC, 'plan');
  assert.equal(`${g?.state}/${g?.run_id}`, 'running/R-NEXT', '新一轮的闸门不得被回收');
  assert.equal((JSON.parse(await fs.readFile(s.runJson, 'utf8')) as RunMeta).status, 'failed', '本轮自己的 run.json 照常收尾');
});

test('EV-150 U5④：worker 在被终止之前已跑完（run.json 与 status.json 都是 success）⇒ 两者都不改写，指路 --wait', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-ORPH4');
  const m = JSON.parse(await fs.readFile(s.runJson, 'utf8')) as RunMeta;
  m.status = 'success';
  m.finished_at = new Date().toISOString();
  m.gate.state = 'review_done_awaiting_disposition';
  await writeRunMeta(s.layout, 'plan', m);
  const st0 = (await readStatus(s.runDir))!;
  st0.phase = 'success';
  st0.exit_code = 0;
  await writeStatus(s.runDir, st0);
  const runBefore = await fs.readFile(s.runJson, 'utf8');
  const statusBefore = await fs.readFile(path.join(s.runDir, 'status.json'), 'utf8');
  const { err } = await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-ORPH4', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(true) }, workerStartedAt: null, error: new Error('x'),
      terminate: async () => ({ gone: true, escalated: false, signals: [] }),
    }),
  );
  assert.equal(await fs.readFile(s.runJson, 'utf8'), runBefore, 'worker 写下的终态不追溯改写');
  assert.equal(
    await fs.readFile(path.join(s.runDir, 'status.json'), 'utf8'), statusBefore,
    '计划双审 r1 AGY-02 ≡ GLM-01：status.json 已终态不动，不把 success 降成 failed',
  );
  assert.match(err, /工作进程在被终止之前已跑完：用 trivium review --wait R-ORPH4 取结果/);
  // 代码双审 r1 CODEX-01：一个信号都没发时说「已自行退出」，不说「已终止」
  assert.match(err, /工作进程 999991 在被终止之前已自行退出/);
  assert.doesNotMatch(err, /已终止工作进程组/);
});

test('EV-150 U5⑤：回读 run.json 读不出（不可解析）⇒ status.json 的 phase 不动、只补 pid，并告警人工核对（代码双审 r1 CODEX-03）', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-ORPH5');
  await fs.writeFile(s.runJson, '{ 这不是 JSON', 'utf8');
  const { err } = await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-ORPH5', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(true) }, workerStartedAt: null, error: new Error('x'),
      terminate: async () => ({ gone: true, escalated: false, signals: ['SIGTERM'] }),
    }),
  );
  const st = await readStatus(s.runDir);
  assert.equal(st?.phase, 'starting', '读不出时不替它下结论：phase 不落 failed');
  assert.equal(st?.worker_pid, FAKE_WORKER, 'pid 照补');
  assert.match(err, /归档 run-R-ORPH5\.json 读不出：status\.json 的 phase 不替它下结论/);
});

test('EV-150 U5⑥：确认不了退出、锁已不归本进程也不归 worker ⇒ 不说「已记在它名下」，如实说明锁的归属与并发风险（代码双审 r1 GLM-01 第 2 点）', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-ORPH6');
  const other = { ...s.lock.content, run_id: 'R-OTHER', pid: FAKE_WORKER + 1, acquired_at: new Date(Date.now() + 1000).toISOString() };
  await fs.writeFile(s.lock.path, JSON.stringify(other, null, 2) + '\n', 'utf8');
  const { err } = await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-ORPH6', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(false) }, workerStartedAt: 'T', error: new Error('x'),
      terminate: async () => ({ gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'] }),
    }),
  );
  assert.doesNotMatch(err, /主题锁已记在它名下/);
  assert.match(err, /主题锁当前不归本进程也不归它——本进程退出后可能按 pid_gone 被回收/);
  assert.equal((await inspectLock(ctx.triviumDir, TOPIC))?.run_id, 'R-OTHER', '别人的锁不改写');
});

test('EV-150 U6：--cancel 宽限期判据——存活但不是同一进程（PID 被复用）即算已退出；同一进程算未退出；不存在算已退出', async () => {
  const real = await processStartTime(process.pid);
  assert.ok(real, '取不到本进程启动时刻，用例前提不成立');
  // EV-158 起入参是整份记录；这里只带缺省形态（旧版写下的记录），判据与改签名之前逐字相同
  assert.equal(await workerGoneForCancel(process.pid, { legacy: 'Thu Jan  1 00:00:00 1970' }), true, '计划双审 r1 AGY-04：复用者不能被当成 worker 升级 SIGKILL');
  assert.equal(await workerGoneForCancel(process.pid, { legacy: real }), false);
  assert.equal(await workerGoneForCancel(999_993, { legacy: null }), true);
});

// ─────────── EV-152：worker 的 SIGTERM 处理器（取消够不到审查员CLI计划 r2 §5.1 U8 / U9） ───────────

test('EV-152 U8：worker 处理器的预算落在取消宽限之内（转发宽限 + SIGKILL 后等待 + 1 s 余量 ≤ WORKER_TERM_GRACE_MS）', () => {
  assert.ok(
    WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 1000 <= WORKER_TERM_GRACE_MS,
    '处理器超预算时 --cancel 会升级 SIGKILL，处理器跑不到、CLI 遗留',
  );
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RP_MODULE = path.resolve(HERE, '../../src/trivium/run-protocol.js');
const EXEC_MODULE = path.resolve(HERE, '../../src/trivium/util/exec.js');

/**
 * 在子进程里装处理器，父进程发 SIGTERM（可连发两次），观察子进程的退出形态。
 * 冻结标志是模块级的，不能在测试进程里置位，所以处理器一定装在子进程里。
 */
async function sigtermScenario(withTree: boolean, twice: boolean) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-u9-'));
  const mark = `trivium-u9-${path.basename(dir)}`;
  const script = path.join(dir, 'worker-like.mjs');
  await fs.writeFile(script, [
    `import { installWorkerSigtermForwarding } from ${JSON.stringify(RP_MODULE)};`,
    `import { run } from ${JSON.stringify(EXEC_MODULE)};`,
    'installWorkerSigtermForwarding();',
    withTree
      ? `run('/bin/sh', ['-c', "trap '' TERM; sleep 600; : \\"$0\\"", ${JSON.stringify(mark + '-tree')}], { killTree: true, timeoutMs: 600000 });`
      : '',
    'setInterval(() => {}, 1000);',
    "setTimeout(() => process.stdout.write('READY\\n'), 300);",
  ].join('\n'), 'utf8');
  const child = childProcess.spawn(process.execPath, [script, mark], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8').on('data', (c: string) => { stdout += c; });
  child.stderr!.setEncoding('utf8').on('data', (c: string) => { stderr += c; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
    child.once('exit', (code, signal) => r({ code, signal })));
  try {
    for (let i = 0; i < 100 && !stdout.includes('READY'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(stdout.includes('READY'), `子进程没就绪，用例前提不成立：${stderr}`);
    const treeGroups = withTree ? groupsWithMark(`${mark}-tree`) : [];
    if (withTree) {
      assert.equal(treeGroups.length, 1, '孙进程组没起来，用例前提不成立');
      assert.equal(groupMemberCount(treeGroups[0]!), 2, '孙进程组应有 sh 与 sleep 两个成员');
    }
    const t0 = Date.now();
    process.kill(child.pid!, 'SIGTERM');
    if (twice) {
      await new Promise((r) => setTimeout(r, 200));
      try { process.kill(child.pid!, 'SIGTERM'); } catch { /* 已退出 */ }
    }
    const ev = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    const ms = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 100));
    return { ev, ms, stderr, treeMembersAfter: treeGroups.map((g) => groupMemberCount(g)) };
  } finally {
    for (const g of groupsWithMark(mark)) killGroup(g);
    killGroup(child.pid!);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('EV-152 U9①：处理器——登记为空时收到 SIGTERM 即以 signal: SIGTERM 退出（退出形态与今天相同，不是 exit(143)）', async () => {
  const r = await sigtermScenario(false, false);
  assert.ok(r.ev, '8 s 内应观察到退出');
  assert.deepEqual(r.ev, { code: null, signal: 'SIGTERM' }, '计划双审 r1 CODEX-06 ≡ AGY-02：重新自杀的退出形态');
  assert.match(r.stderr, /没有在跑的审查员 CLI/);
});

test('EV-152 U9②：处理器——连发两次 SIGTERM 只处理第一次：忽略 SIGTERM 的 CLI 组被升级 SIGKILL 结束（组空），worker 仍以 signal: SIGTERM 在宽限内退出', async () => {
  const r = await sigtermScenario(true, true);
  assert.ok(r.ev, '8 s 内应观察到退出');
  assert.deepEqual(r.ev, { code: null, signal: 'SIGTERM' });
  assert.deepEqual(r.treeMembersAfter, [0], '第二次 SIGTERM 若走了缺省动作，worker 会在转发中途死掉、留下 CLI 组');
  assert.match(r.stderr, /已按组终止审查员 CLI \d+（SIGTERM、SIGKILL）/);
  assert.ok(r.ms < WORKER_TERM_GRACE_MS - 500, `应在取消宽限内退出，实为 ${r.ms} ms`);
});

/*
 * ── EV-146：失联后取消挂住的 worker（失联后取消挂住的worker计划 r2 §5.1 K2～K9）──
 *
 * 假 worker（`seedRun`）没有 SIGTERM 处理器、收到 SIGTERM 即退——正是「事件循环没堵住」那一支的最小形态；
 * 堵住那一支由 `gate-loop.test.ts` 的 J1 用真实 worker 造。新增用例一律 K 编号，不与既有 U / L / E 撞号（计划双审 r1 CODEX-06）。
 */

/** 进程内同时捕获 stdout（say）与 stderr（step / warn），fn 结束后原样恢复 */
async function captureOut<T>(fn: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  const sink = (append: (t: string) => void) =>
    ((chunk: string | Uint8Array) => {
      append(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
  process.stdout.write = sink((t) => { out += t; });
  process.stderr.write = sink((t) => { err += t; });
  try {
    return { value: await fn(), out, err };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

const readText = (p: string): Promise<string> => fs.readFile(p, 'utf8');
const lockFile = (ctx: Ctx): string => path.join(ctx.triviumDir, 'lock', `${TOPIC}.lock`);

/**
 * 摆出「--wait 判 heartbeat_stale 之后」的样子：假 worker 活着、骨架 run.json 与登记为 running、锁记在 worker 名下，
 * 心跳改成一小时前、真跑一次 waitRun 让它判失联（status.json 由 waitRun 自己写成 failed + lost）
 */
async function lostScenario(ctx: Ctx, runId: string, o: { lockPid?: number; lockRunId?: string } = {}) {
  const { pid, runDir } = await seedRun(ctx, runId);
  const a = await seedArchive(ctx, runId);
  await holdLock(ctx, o.lockRunId ?? runId, o.lockPid ?? pid);
  await staleHeartbeat(runDir);
  const message = await lostMessage(ctx, runId);
  assert.match(message, /heartbeat_stale/, `前提：判的是心跳过期：${message}`);
  return { pid, runDir, a, message, statusPath: path.join(runDir, 'status.json') };
}

test('EV-146 K2：--wait 判失联时记下结构化的 lost；heartbeat_stale 的报错先列事实再给 --cancel 出口，pid_gone 不给', async () => {
  // 阈值 120 s（大于 30 s 心跳间隔）：有事实行与出口行，没有「健康的工作进程也会被判失联」
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-K2-STALE');
  try {
    const s = JSON.parse(await readText(r.statusPath)) as RunStatus;
    assert.equal(s.lost?.reason, 'heartbeat_stale');
    assert.ok(Number.isFinite(Date.parse(s.lost?.at ?? '')), `lost.at 应可解析：${JSON.stringify(s.lost)}`);
    assert.match(r.message, new RegExp(`判定依据：工作进程 ${r.pid} 仍在，status\\.json 已 \\d+ s 未更新（失联阈值 heartbeat_stale_s = 120 s；工作进程的心跳间隔是 30 s）`));
    assert.doesNotMatch(r.message, /健康的工作进程也会被判失联/);
    assert.match(r.message, /若确认它卡死、要结束这一轮：trivium review --cancel R-K2-STALE——会结束它与它拉起的审查员 CLI，并补收归档 run\.json；它若只是慢/);
  } finally {
    killQuietly(r.pid);
  }

  // 阈值 2 s（不大于心跳间隔）：事实行点明健康的工作进程也会被判失联
  const ctx2 = await fakeCtx();
  ctx2.config.review.heartbeat_stale_s = 2;
  const r2 = await lostScenario(ctx2, 'R-K2-LOW');
  try {
    assert.match(r2.message, /失联阈值 heartbeat_stale_s = 2 s；工作进程的心跳间隔是 30 s）——阈值不大于心跳间隔：健康的工作进程也会被判失联/);
  } finally {
    killQuietly(r2.pid);
  }

  // pid_gone：记下 lost，但没有事实行与出口行（worker 已不在，没有可结束的进程）
  const ctx3 = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx3, 'R-K2-GONE');
  killQuietly(pid);
  await new Promise((res) => setTimeout(res, 300));
  const m3 = await lostMessage(ctx3, 'R-K2-GONE');
  assert.equal((await readStatus(runDir))?.lost?.reason, 'pid_gone');
  assert.doesNotMatch(m3, /判定依据|trivium review --cancel/);
});

/*
 * EV-160 R1（心跳阈值事前告警计划 r2 §6.1）：`--wait` 报错里「阈值不大于心跳间隔」那一句与预检 / `--start` 的「失联阈值」
 * 只警告项共用同一判据。边界全集在 status.test.ts 的 U1 里纯内存跑；这里只取四个阈值（含等于间隔与略大于间隔两个边界），
 * 每个都真跑一次 waitRun——心跳被改到一小时前，四个阈值都会判 heartbeat_stale。
 */
test('EV-160 R1：--wait 那一句、共享判据、预检告警三者对同一阈值给出同一结论（2 / 30 / 30.5 / 120）', async () => {
  const cases: Array<[number, boolean]> = [[2, true], [30, true], [30.5, false], [120, false]];
  for (const [staleS, expected] of cases) {
    const ctx = await fakeCtx();
    ctx.config.review.heartbeat_stale_s = staleS;
    const r = await lostScenario(ctx, `R-R1-${String(staleS).replace('.', '_')}`);
    try {
      const sentence = r.message.includes('——阈值不大于心跳间隔：健康的工作进程也会被判失联');
      assert.match(r.message, new RegExp(`失联阈值 heartbeat_stale_s = ${String(staleS).replace('.', '\\.')} s；工作进程的心跳间隔是 30 s）`));
      assert.equal(staleThresholdWithinHeartbeat(staleS), expected, `共享判据（阈值 ${staleS}）`);
      assert.equal(sentence, expected, `--wait 那一句（阈值 ${staleS}）：\n${r.message}`);
      assert.equal(checkHeartbeatThreshold(ctx.config) !== null, expected, `预检告警（阈值 ${staleS}）`);
    } finally {
      killQuietly(r.pid);
    }
  }
});

test('EV-146 K3：本格主线——结束 worker、补收 run.json 与登记（worker_lost / heartbeat_stale）、按 run_id + pid 回收锁；status.json 逐字节不变、闸门不动', async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-K3');
  try {
    const statusBefore = await readText(r.statusPath);
    const gateBefore = await getGate(ctx.triviumDir, TOPIC, 'plan');
    const { value: code, out, err } = await captureOut(() => cancelRun(ctx, 'R-K3'));
    assert.equal(code, EXIT.OK);
    assert.equal((await processAlive(r.pid)).alive, false, '挂住的 worker 应已被结束');
    const meta = JSON.parse(await readText(r.a.runJson)) as RunMeta;
    assert.equal(meta.status, 'failed');
    assert.equal(meta.gate.state, 'failed');
    assert.deepEqual(meta.termination, { by: 'worker_lost', reason: 'heartbeat_stale' });
    assert.deepEqual(meta.artifacts, r.a.meta.artifacts, 'artifacts[] 必须原样');
    assert.equal((await readTask(r.a.layout)).runs.find((x) => x.run_id === 'R-K3')?.status, 'failed');
    assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '锁应按 run_id + pid 复核后回收');
    assert.equal(await readText(r.statusPath), statusBefore, 'status.json 一个字节都不写（不追溯改写）');
    assert.deepEqual(await getGate(ctx.triviumDir, TOPIC, 'plan'), gateBefore, '闸门不动');
    assert.match(err, /运行 R-K3 已被 --wait 判为失联（heartbeat_stale，判定于 .+；status\.json 最近一次写入于 .+），但工作进程 \d+ 仍是同一进程/);
    assert.match(err, /工作进程在宽限内响应 SIGTERM 退出（SIGTERM）——它的事件循环没有被堵住，失联判定可能只是心跳慢/);
    assert.match(err, /已把归档里的 run-R-K3\.json 收尾为 failed/);
    assert.match(err, /的运行登记同步为 failed/);
    assert.match(out, /已回收主题「协议用例」的锁/);
    assert.match(out, /运行 R-K3 已被 --wait 判为失联（heartbeat_stale）：已结束仍挂着的工作进程 \d+。/);
    assert.doesNotMatch(out, /无需取消/);
  } finally {
    killQuietly(r.pid);
  }
});

test('EV-146 K4：确认不了退出 ⇒ run.json、登记、锁都不动，如实说明；再跑一次仍入本格（判格可重入）', async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-K4');
  try {
    const runBefore = await readText(r.a.runJson);
    const taskBefore = await readText(r.a.taskJson);
    const lockBefore = await readText(lockFile(ctx));
    const statusBefore = await readText(r.statusPath);
    let calls = 0;
    const terminateWorker = async () => {
      calls++;
      return { gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'] as NodeJS.Signals[] };
    };
    const first = await captureOut(() => cancelRun(ctx, 'R-K4', { terminateWorker }));
    assert.equal(first.value, EXIT.OK);
    assert.equal(await readText(r.a.runJson), runBefore, '未确认退出时 run.json 必须逐字节不变');
    assert.equal(await readText(r.a.taskJson), taskBefore);
    assert.equal(await readText(lockFile(ctx)), lockBefore, '未确认退出时锁不动');
    assert.equal(await readText(r.statusPath), statusBefore);
    assert.match(first.err, /已向工作进程组 \d+ 发送 SIGTERM、SIGKILL，未能确认退出：归档 run\.json、主题任务文件的运行登记与主题锁都不动/);
    assert.match(first.err, /可以再跑一次 --cancel（仍会入这一格，再次尝试结束）；若改为在终端手工结束它，之后再跑 --cancel 会判它已不在（gone 格），按前提补收归档 run\.json 与运行登记（EV-159）/);
    assert.match(first.out, /未能确认工作进程 \d+ 退出，归档与主题锁未动/);
    assert.equal((await processAlive(r.pid)).alive, true, '桩没有真的发信号，假 worker 仍在');

    const second = await captureOut(() => cancelRun(ctx, 'R-K4', { terminateWorker }));
    assert.equal(second.value, EXIT.OK);
    assert.equal(calls, 2, '第二次 --cancel 仍入本格、再次尝试结束（CODEX-06 ③）');
    assert.match(second.out, /未能确认工作进程 \d+ 退出/);
  } finally {
    killQuietly(r.pid);
  }
});

/** 不入本格的各格：直接把 status.json 摆成给定形状（不经 waitRun），看 --cancel 不发信号、什么都不写 */
async function notThisCell(runId: string, shape: (s: RunStatus, pid: number) => void) {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, runId);
  const a = await seedArchive(ctx, runId);
  await holdLock(ctx, runId, pid);
  const s = (await readStatus(runDir))!;
  s.phase = 'failed';
  s.exit_code = EXIT.FAIL;
  s.message = 'worker_lost（heartbeat_stale）';
  s.lost = { reason: 'heartbeat_stale', at: new Date().toISOString() };
  shape(s, pid);
  await writeStatus(runDir, s);
  const statusPath = path.join(runDir, 'status.json');
  const before = { run: await readText(a.runJson), lock: await readText(lockFile(ctx)), status: await readText(statusPath) };
  try {
    const r = await captureOut(() => cancelRun(ctx, runId));
    assert.equal(r.value, EXIT.OK);
    assert.equal((await processAlive(pid)).alive, true, `${runId}：不入本格就不对 worker 发信号`);
    assert.equal(await readText(a.runJson), before.run, `${runId}：run.json 不动`);
    assert.equal(await readText(lockFile(ctx)), before.lock, `${runId}：锁不动`);
    assert.equal(await readText(statusPath), before.status, `${runId}：status.json 不动`);
    return r;
  } finally {
    killQuietly(pid);
  }
}

test('EV-146 K5：不入本格的各格——没有 lost（不读文案）、原因不是 heartbeat_stale、phase 不是 failed、lost 形状坏 ⇒ 原两行；身份判不上 / 缺失 ⇒ 如实结论、不说「无需取消」', async () => {
  // ① 没有 lost、message 恰好是人读的失联文案：证明判据不读 message
  let r = await notThisCell('R-K5-1', (s) => { delete s.lost; });
  assert.match(r.out, /已处于终态（failed），无需取消/);
  // ② 原因是 pid_gone（用活着的假 worker 构造）
  r = await notThisCell('R-K5-2', (s) => { s.lost = { reason: 'pid_gone', at: new Date().toISOString() }; });
  assert.match(r.out, /已处于终态（failed），无需取消/);
  // ③ worker 恢复后写回了 success（c″-恢复）
  r = await notThisCell('R-K5-3', (s) => { s.phase = 'success'; s.exit_code = EXIT.OK; });
  assert.match(r.out, /已处于终态（success），无需取消/);
  // ④ 启动时刻不符（PID 复用 / EV-158 环境错配）
  r = await notThisCell('R-K5-4', (s) => { s.worker_started_at = 'Thu Jan  1 00:00:00 1970'; });
  assert.match(r.err, /上有活进程，但启动时刻与 status\.json 的记录不符：可能是 PID 已被复用，也可能是本命令的 TZ \/ 区域设置与 --start 不同（BACKLOG EV-158）——不对它发信号/);
  assert.match(r.out, /已被 --wait 判为失联（heartbeat_stale），但工作进程的身份与记录不符，未对工作进程与它名下的审查员 CLI 发信号；归档 run\.json 与主题锁未动/);
  assert.doesNotMatch(r.out, /无需取消/, 'AGY-01：不跌回「无需取消」');
  // ⑤ 身份不合形状（AGY-02 ≡ GLM-02）：启动时刻 null / 空串、pid 为 1 / 字符串
  const shapes: Array<[string, (s: RunStatus, pid: number) => void]> = [
    ['R-K5-5a', (s) => { s.worker_started_at = null; }],
    ['R-K5-5b', (s) => { s.worker_started_at = ''; }],
    ['R-K5-5c', (s) => { s.worker_pid = 1; }],
    ['R-K5-5d', (s, pid) => { (s as unknown as { worker_pid: unknown }).worker_pid = String(pid); }],
  ];
  for (const [id, shape] of shapes) {
    r = await notThisCell(id, shape);
    assert.match(r.err, /status\.json 里工作进程的 pid 或启动时刻缺失 \/ 形状不对，判不了是不是同一进程，不发信号/, id);
    assert.match(r.out, /但 status\.json 没记下可核对的工作进程身份，未对工作进程发信号；归档 run\.json 与主题锁未动/, id);
    assert.doesNotMatch(r.out, /无需取消/, id);
  }
  // ⑥ lost 形状坏（缺 at）：读不懂就当没有
  r = await notThisCell('R-K5-6', (s) => { (s as unknown as { lost: unknown }).lost = { reason: 'heartbeat_stale' }; });
  assert.match(r.out, /已处于终态（failed），无需取消/);
});

test('EV-146 K5′：身份判不上（mismatch）时，status.json 里记着的活 CLI 组也不结束（代码双审 r1 CODEX-02）；同形但两种启动时刻缺失、worker 已不在时改判 gone（EV-159）、照旧按记录结束 CLI 并尝试补收', async () => {
  const spawnGroup = async (mark: string) => {
    const c = childProcess.spawn('sh', ['-c', 'sleep 600; : "$0"', mark], { detached: true, stdio: 'ignore' });
    c.unref();
    const pgid = c.pid!;
    let started: string | null = null;
    for (let i = 0; i < 20 && !started; i++) {
      started = await processStartTime(pgid, { canonical: true });
      if (!started) await new Promise((res) => setTimeout(res, 50));
    }
    return { pgid, started_at: started };
  };

  // mismatch：假 worker 活着而启动时刻被改掉，gemini 侧记着一个活的 CLI 组 ⇒ 组仍在，stderr 不出现「按记录结束」
  const mark1 = `trivium-k5p-${process.pid}-${Date.now()}-a`;
  const g1 = await spawnGroup(mark1);
  try {
    const r = await notThisCell('R-K5P-M', (s) => {
      s.worker_started_at = 'Thu Jan  1 00:00:00 1970';
      s.sides.gemini!.cli = g1;
    });
    assert.doesNotMatch(r.err, /按记录结束审查员 CLI/, r.err);
    assert.match(r.err, /本次也未结束它名下的审查员 CLI/, r.err);
    assert.equal(groupMemberCount(g1.pgid) > 0, true, 'mismatch 格不对记录里的 CLI 发信号');
  } finally {
    for (const g of [g1.pgid, ...groupsWithMark(mark1)]) killGroup(g);
  }

  // 两种启动时刻都缺失、worker 已不在：EV-159 起 classifyLostCancel 改判 gone（不再是 no_identity），CLI 照旧按记录结束、并尝试补收 run.json
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-K5P-N');
  const mark2 = `trivium-k5p-${process.pid}-${Date.now()}-b`;
  const g2 = await spawnGroup(mark2);
  try {
    killQuietly(pid);
    await new Promise((res) => setTimeout(res, 300));
    const s = (await readStatus(runDir))!;
    s.phase = 'failed';
    s.lost = { reason: 'heartbeat_stale', at: new Date().toISOString() };
    s.worker_started_at = null;
    s.sides.gemini!.cli = g2;
    await writeStatus(runDir, s);
    assert.deepEqual(await classifyLostCancel(s), { kind: 'gone', pid: s.worker_pid }, 'EV-159：两时刻缺失+已死 ⇒ gone，不是 no_identity');
    const r = await captureOut(() => cancelRun(ctx, 'R-K5P-N'));
    assert.match(r.err, /按记录结束审查员 CLI：gemini 侧进程组/, r.err);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(groupMemberCount(g2.pgid), 0, '两时刻缺失而 worker 已不在：照旧结束 CLI');
    // 没有 seedArchive，run.json 不存在 ⇒ finalizeLostAndReclaimLock 的第一步按前提跳过，不报错
    assert.match(r.err, /归档 run-R-K5P-N\.json 未回写：归档里没有 run-R-K5P-N\.json/, r.err);
    assert.match(r.out, /工作进程 \d+ 已不在。/, r.out);
    assert.doesNotMatch(r.out, /无需取消/, r.out);
  } finally {
    for (const g of [g2.pgid, ...groupsWithMark(mark2)]) killGroup(g);
  }
});

test('EV-146 K10：结束工作进程时一个信号都没发就判已不在（零信号）⇒ 不说「响应 SIGTERM」「处理器已收拾」，无记录告警照常打，结论不说「已结束仍挂着的」（代码双审 r1 CODEX-01）', async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-K10');
  try {
    const terminateWorker = async () => ({ gone: true, escalated: false, signals: [] as NodeJS.Signals[] });
    const { value: code, out, err } = await captureOut(() => cancelRun(ctx, 'R-K10', { terminateWorker }));
    assert.equal(code, EXIT.OK);
    assert.match(err, /未及发信号，工作进程 \d+ 已不在（在判格之后自己退出了，或它的 pid 已被别的进程占用）/, err);
    assert.doesNotMatch(err, /响应 SIGTERM|已按自己的登记结束/, err);
    assert.match(err, /status\.json 里没有在跑的审查员 CLI 记录/, '零信号那一格要照常提示 CLI 可能成孤儿');
    assert.match(out, /工作进程 \d+ 在发信号之前已不在，未对它发信号。/, out);
    assert.doesNotMatch(out, /已结束仍挂着的工作进程/, out);
  } finally {
    killQuietly(r.pid);
  }
});

test('EV-146 K11：本格的退出判据是严格的——进程在而启动时刻取不到（ps 瞬时失败）不算已退出；不存在或启动时刻不同才算（代码双审 r1 GLM-01）', () => {
  const at = 'Mon Sep 28 10:04:56 2026';
  assert.equal(lostWorkerGoneFrom({ alive: false, startedAt: null }, at), true, '进程不存在');
  assert.equal(lostWorkerGoneFrom({ alive: true, startedAt: 'Tue Sep 29 01:00:00 2026' }, at), true, 'pid 已被别的进程占用');
  assert.equal(lostWorkerGoneFrom({ alive: true, startedAt: null }, at), false, 'ps 取不到启动时刻：判不了，不算已退出');
  assert.equal(lostWorkerGoneFrom({ alive: true, startedAt: at }, at), false, '同一进程仍在');
});

test('EV-146 K6：锁已不归本运行的 worker（run_id 相同而 pid 不同 / run_id 不同）⇒ 不动它、如实说明；worker 与归档照常收尾', async () => {
  for (const [id, o] of [
    ['R-K6-PID', { lockPid: process.pid }],
    ['R-K6-RUN', { lockRunId: 'R-SOMEONE-ELSE' }],
  ] as const) {
    const ctx = await fakeCtx();
    const r = await lostScenario(ctx, id, o);
    try {
      const lockBefore = await readText(lockFile(ctx));
      const { value: code, err } = await captureOut(() => cancelRun(ctx, id));
      assert.equal(code, EXIT.OK);
      assert.equal(await readText(lockFile(ctx)), lockBefore, `${id}：不是本运行 worker 的锁，不动`);
      assert.match(err, /主题锁已不归本运行的工作进程（run_id .+，pid \d+），不动/, id);
      assert.equal((await processAlive(r.pid)).alive, false, id);
      assert.equal((JSON.parse(await readText(r.a.runJson)) as RunMeta).status, 'failed', id);
    } finally {
      killQuietly(r.pid);
    }
  }
});

test('EV-146 K7：worker 挂住之前已写下归档终态（success）⇒ run.json 不追溯改写、如实说明；worker 照样结束、锁照样回收', async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-K7');
  try {
    const a = await seedArchive(ctx, 'R-K7');
    await writeRunMeta(a.layout, 'plan', {
      ...a.meta, status: 'success', finished_at: new Date().toISOString(),
      gate: { ...a.meta.gate, state: 'review_done_awaiting_disposition' },
    });
    const runBefore = await readText(a.runJson);
    await holdLock(ctx, 'R-K7', pid);
    await staleHeartbeat(runDir);
    await lostMessage(ctx, 'R-K7');
    const { err } = await captureOut(() => cancelRun(ctx, 'R-K7'));
    assert.equal(await readText(a.runJson), runBefore, '已是终态的 run.json 不追溯改写');
    assert.match(err, /归档 run-R-K7\.json 未回写：已是终态（success），不追溯改写/);
    assert.equal((await processAlive(pid)).alive, false);
    assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null);
  } finally {
    killQuietly(pid);
  }
});

test('EV-159 N2：alive 格成功之后再跑一次 --cancel ⇒ worker 已不在（gone 格），按前提跳过（已是终态，不追溯改写）、可重入、逐字节不变', async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-K8');
  try {
    await captureOut(() => cancelRun(ctx, 'R-K8'));
    const runAfter = await readText(r.a.runJson);
    const taskAfter = await readText(r.a.taskJson);
    const statusAfter = await readText(r.statusPath);
    const lockAfter = await inspectLock(ctx.triviumDir, TOPIC);
    assert.equal(lockAfter, null, '前提：第一次已回收锁');
    const again = await captureOut(() => cancelRun(ctx, 'R-K8'));
    assert.equal(again.value, EXIT.OK);
    assert.match(again.err, /归档 run-R-K8\.json 未回写：已是终态（failed），不追溯改写/, again.err);
    assert.match(again.err, /task\.json 的运行登记未改：登记已是 failed，不改/, again.err);
    assert.match(again.out, /运行 R-K8 已被 --wait 判为失联（heartbeat_stale）：工作进程 \d+ 已不在。/, again.out);
    assert.match(again.out, /归档 run\.json 与运行登记见上方输出/, again.out);
    assert.doesNotMatch(again.out, /无需取消|已按前提补收/, again.out);
    assert.equal(await readText(r.a.runJson), runAfter, '第二次不改写 run.json');
    assert.equal(await readText(r.a.taskJson), taskAfter, '第二次不改写 task.json');
    assert.equal(await readText(r.statusPath), statusAfter, 'status.json 一个字节都不写');
  } finally {
    killQuietly(r.pid);
  }
});

test('EV-146 K9：本格的归档写失败（归档元数据目录只读）⇒ 告警带本格自己的「没有第二次机会」半句，不是主路径那句；锁照常回收', { skip: process.getuid?.() === 0 && 'root 下只读目录拦不住写入' }, async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-K9');
  const dir = path.dirname(r.a.runJson);
  await fs.chmod(dir, 0o555);
  try {
    const { value: code, err } = await captureOut(() => cancelRun(ctx, 'R-K9'));
    assert.equal(code, EXIT.OK);
    assert.match(
      err,
      /归档 run-R-K9\.json 未回写：回写 run\.json 出错：.*——这一步可以再跑一次 --cancel 重试：只要 run\.json 仍为 running，再跑一次会落进会重试这一步的格（本次工作进程已被结束过，下一次判格时它已经不在了，通常是 gone 格；EV-159 起 gone 格与 alive 格一样会重试这一步）。若这次写失败的原因是持续性故障（比如目录只读），重试不会自愈，请人工核对归档 run\.json 与 task\.json 的运行登记/,
    );
    assert.doesNotMatch(err, /status\.json 随后落终态/, '主路径那半句不适用于本格');
    assert.doesNotMatch(err, /不会再有第二次机会/, '旧版否定句已改为肯定句（GLM-03）');
    assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '归档侧失败不连坐锁回收');
  } finally {
    await fs.chmod(dir, 0o755);
    killQuietly(r.pid);
  }
});

// ─────────── EV-159：失联worker退出后补收（gone 格补收；计划 r2 §4.1） ───────────

test('EV-159 N1：worker 自己死了（不经 cancelLostWorker）⇒ classifyLostCancel 直接判 gone，--cancel 按 EV-142 前提补收 run.json 与登记、回收锁；不说「无需取消」', async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-N1');
  killQuietly(r.pid);
  await new Promise((res) => setTimeout(res, 300));
  const s = (await readStatus(r.runDir))!;
  assert.deepEqual(await classifyLostCancel(s), { kind: 'gone', pid: r.pid }, '前提：worker 已死，直接落 gone 格');
  const { value: code, out, err } = await captureOut(() => cancelRun(ctx, 'R-N1'));
  assert.equal(code, EXIT.OK);
  const meta = JSON.parse(await readText(r.a.runJson)) as RunMeta;
  assert.equal(meta.status, 'failed');
  assert.equal(meta.gate.state, 'failed');
  assert.deepEqual(meta.termination, { by: 'worker_lost', reason: 'heartbeat_stale' });
  assert.deepEqual(meta.artifacts, r.a.meta.artifacts, 'artifacts[] 必须原样');
  assert.equal((await readTask(r.a.layout)).runs.find((x) => x.run_id === 'R-N1')?.status, 'failed');
  assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '锁应按 run_id + pid 复核后回收');
  const statusNow = JSON.parse(await readText(r.statusPath)) as RunStatus;
  assert.equal(statusNow.phase, 'failed');
  assert.equal(statusNow.lost?.reason, 'heartbeat_stale', 'status.json 保持失联判定时的样子（不追溯改写）');
  assert.match(err, /已把归档里的 run-R-N1\.json 收尾为 failed/);
  assert.match(err, /已把 task\.json 的运行登记同步为 failed/);
  assert.match(out, /已回收主题「协议用例」的锁/);
  assert.match(out, /运行 R-N1 已被 --wait 判为失联（heartbeat_stale）：工作进程 \d+ 已不在。/);
  assert.match(out, /归档 run\.json 与运行登记见上方输出/);
  assert.doesNotMatch(out, /无需取消/);
});

test('EV-159 N3：gone 格下锁已不归本运行的 worker（run_id 相同而 pid 不同 / run_id 不同）⇒ 不动它、如实说明；归档照常补收', async () => {
  for (const [id, o] of [
    ['R-N3-PID', { lockPid: process.pid }],
    ['R-N3-RUN', { lockRunId: 'R-N3-SOMEONE-ELSE' }],
  ] as const) {
    const ctx = await fakeCtx();
    const r = await lostScenario(ctx, id, o);
    killQuietly(r.pid);
    await new Promise((res) => setTimeout(res, 300));
    const lockBefore = await readText(lockFile(ctx));
    const { value: code, err } = await captureOut(() => cancelRun(ctx, id));
    assert.equal(code, EXIT.OK);
    assert.equal(await readText(lockFile(ctx)), lockBefore, `${id}：不是本运行 worker 的锁，不动`);
    assert.match(err, /主题锁已不归本运行的工作进程（run_id .+，pid \d+），不动/, id);
    assert.equal((JSON.parse(await readText(r.a.runJson)) as RunMeta).status, 'failed', id);
    assert.equal((await readTask(r.a.layout)).runs.find((x) => x.run_id === id)?.status, 'failed', id);
  }
});

test('EV-159 N4：gone 格归档写失败（归档元数据目录只读）⇒ 告警带「可以再跑一次 --cancel 重试」的措辞，不是「没有第二次机会」；锁照常回收', { skip: process.getuid?.() === 0 && 'root 下只读目录拦不住写入' }, async () => {
  const ctx = await fakeCtx();
  const r = await lostScenario(ctx, 'R-N4');
  killQuietly(r.pid);
  await new Promise((res) => setTimeout(res, 300));
  const dir = path.dirname(r.a.runJson);
  await fs.chmod(dir, 0o555);
  try {
    const { value: code, err } = await captureOut(() => cancelRun(ctx, 'R-N4'));
    assert.equal(code, EXIT.OK);
    assert.match(err, /归档 run-R-N4\.json 未回写：回写 run\.json 出错：.*可以再跑一次 --cancel 重试/);
    assert.doesNotMatch(err, /不会再有第二次机会/);
    assert.equal(await inspectLock(ctx.triviumDir, TOPIC), null, '归档侧失败不连坐锁回收');
  } finally {
    await fs.chmod(dir, 0o755);
  }
});

test('EV-159 classifyLostCancel 矩阵：pid 不合法（不管死活）⇒ no_identity；pid 合法+两时刻缺失+活着 ⇒ no_identity；+已死 ⇒ gone（新增）；pid 合法+有时刻+已死 ⇒ gone（既有行为，回归）', async () => {
  const ctx = await fakeCtx();
  const { pid, runDir } = await seedRun(ctx, 'R-N-MATRIX');
  const s = (await readStatus(runDir))!;
  s.phase = 'failed';
  s.lost = { reason: 'heartbeat_stale', at: new Date().toISOString() };

  // pid 不合法：非整数字符串、以及 <= 1——不管死活都判不了
  const badPidStr = { ...s };
  (badPidStr as unknown as { worker_pid: unknown }).worker_pid = String(pid);
  assert.deepEqual(await classifyLostCancel(badPidStr), { kind: 'no_identity' }, 'pid 为字符串');
  assert.deepEqual(await classifyLostCancel({ ...s, worker_pid: 1 }), { kind: 'no_identity' }, 'pid 为 1（init/launchd）');

  // pid 合法 + 两时刻缺失 + 进程还在 ⇒ no_identity（维持现状：判不了是不是同一进程）
  const bothMissingAlive = { ...s, worker_pid: pid, worker_started_at: null, worker_started_at_canonical: null };
  assert.deepEqual(await classifyLostCancel(bothMissingAlive), { kind: 'no_identity' }, '前提：worker 还活着');

  // pid 合法 + 有启动时刻 + 已死 ⇒ gone（既有行为，回归）
  const withTime = { ...s, worker_pid: pid };
  killQuietly(pid);
  await new Promise((res) => setTimeout(res, 300));
  assert.deepEqual(await classifyLostCancel(withTime), { kind: 'gone', pid }, '既有行为：有启动时刻、已死 ⇒ gone');

  // pid 合法 + 两时刻缺失 + 已死 ⇒ gone（EV-159 新增收窄）
  assert.deepEqual(await classifyLostCancel(bothMissingAlive), { kind: 'gone', pid }, 'EV-159：两时刻缺失但已死 ⇒ 改判 gone');
});

// ─────────── EV-158：worker 与主题锁的启动时刻规范化（worker启动时刻规范化计划 r2 §5.1 U4 ②、C5、U9） ───────────

test('EV-158 U4 ②：settleOrphanedStart 确认不了退出 ⇒ status.json 补记规范化启动时刻、改写后的锁带 worker 的而不是本进程的；已有值不覆盖（??=）', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-C158-ORPH');
  const selfCanonical = await processStartTime(process.pid, { canonical: true });
  assert.equal(s.lock.content.pid_started_at_canonical, selfCanonical, '前提：--start 拿到的锁带着本进程的规范化启动时刻');
  await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-C158-ORPH', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(false) }, workerStartedAt: null, error: new Error('EISDIR'),
      terminate: async () => ({ gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'] }),
      startTimeOf: async () => 'T-started',
      canonicalStartTimeOf: async () => 'C-started',
    }),
  );
  const st = await readStatus(s.runDir);
  assert.equal(st?.worker_started_at_canonical, 'C-started');
  const lk = await inspectLock(ctx.triviumDir, TOPIC);
  assert.deepEqual(
    lk && { pid: lk.pid, pid_started_at: lk.pid_started_at, pid_started_at_canonical: lk.pid_started_at_canonical },
    { pid: FAKE_WORKER, pid_started_at: 'T-started', pid_started_at_canonical: 'C-started' },
    'D4：锁改写不把 --start 的规范化启动时刻带到 worker 的 pid 上',
  );

  // 已有值不覆盖：status.json 已由 startRun 写全（失败点在 patchStatus 之后）
  const ctx2 = await fakeCtx();
  const s2 = await seedOrphan(ctx2, 'R-C158-ORPH2');
  const pre = (await readStatus(s2.runDir))!;
  pre.worker_pid = FAKE_WORKER;
  pre.worker_started_at = 'T-pre';
  pre.worker_started_at_canonical = 'C-pre';
  await writeStatus(s2.runDir, pre);
  await captureStderr(() =>
    settleOrphanedStart({
      ctx: ctx2, topic: TOPIC, stage: 'plan', runId: 'R-C158-ORPH2', layout: s2.layout, runDir: s2.runDir, lock: s2.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(false) }, workerStartedAt: 'T-pre', workerStartedAtCanonical: 'C-pre', error: new Error('x'),
      terminate: async () => ({ gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'] }),
      canonicalStartTimeOf: async () => 'C-other',
    }),
  );
  assert.equal((await readStatus(s2.runDir))?.worker_started_at_canonical, 'C-pre', '??=：已有值不覆盖');
});

test('EV-158 U4 ②′：settleOrphanedStart 确认退出一支 ⇒ status.json 为 null 的规范化字段按 startRun 已取到的值补上', async () => {
  const ctx = await fakeCtx();
  const s = await seedOrphan(ctx, 'R-C158-ORPH3', { lockAsWorker: true });
  await captureStderr(() =>
    settleOrphanedStart({
      ctx, topic: TOPIC, stage: 'plan', runId: 'R-C158-ORPH3', layout: s.layout, runDir: s.runDir, lock: s.lock,
      born: { pid: FAKE_WORKER, watch: watchOf(true) }, workerStartedAt: 'T-worker', workerStartedAtCanonical: 'C-worker',
      error: new Error('EISDIR'),
      terminate: async () => ({ gone: true, escalated: false, signals: ['SIGTERM'] }),
    }),
  );
  const st = await readStatus(s.runDir);
  assert.equal(st?.phase, 'failed');
  assert.equal(st?.worker_started_at_canonical, 'C-worker');
});

/** W 下起假 worker 并把 status.json 的两种启动时刻都按 W 写（新版写下的样子）；legacyOnly 时删掉规范化字段（旧版写下） */
async function seedRunUnderW(ctx: Ctx, runId: string, o: { legacyOnly?: boolean } = {}) {
  const r = await withEnv(ENV_W, () => seedRun(ctx, runId));
  await assertEnvPairDistinct(r.pid);
  const s = (await readStatus(r.runDir))!;
  const t = await withEnv(ENV_W, () => processStartTimes(r.pid));
  s.worker_started_at = t.legacy;
  if (o.legacyOnly) delete s.worker_started_at_canonical;
  else s.worker_started_at_canonical = t.canonical;
  await writeStatus(r.runDir, s);
  return r;
}

test('EV-158 C5 / C6：--cancel 主路径在与 --start 不同的环境里——新版记录 ⇒ 向活 worker 发 SIGTERM 并确认退出、收尾 cancelled；旧版记录 ⇒ 仍当它已不存在（今天的行为）', async () => {
  const ctx = await fakeCtx();
  const r = await seedRunUnderW(ctx, 'R-C158-CANCEL');
  try {
    const { value, err } = await captureOut(() => withEnv(ENV_R, () => cancelRun(ctx, 'R-C158-CANCEL')));
    assert.equal(value, EXIT.OK);
    assert.match(err, new RegExp(`向工作进程组 ${r.pid} 发送 SIGTERM`), err);
    assert.doesNotMatch(err, /已不存在，仅做状态与锁的清理/, err);
    for (let i = 0; i < 40 && (await processAlive(r.pid)).alive; i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal((await processAlive(r.pid)).alive, false, 'b 格：worker 被结束');
    assert.equal((await readStatus(r.runDir))?.phase, 'cancelled');
  } finally {
    killQuietly(r.pid);
  }

  const ctx2 = await fakeCtx();
  const old = await seedRunUnderW(ctx2, 'R-C158-CANCEL-OLD', { legacyOnly: true });
  try {
    const { err } = await captureOut(() => withEnv(ENV_R, () => cancelRun(ctx2, 'R-C158-CANCEL-OLD')));
    assert.match(err, new RegExp(`工作进程 ${old.pid} 已不存在，仅做状态与锁的清理`), 'd 格：旧记录在异环境下仍判错（EV-158 的残余，升级窗口）');
    assert.equal((await processAlive(old.pid)).alive, true, 'd 格：没有对它发信号');
  } finally {
    killQuietly(old.pid);
  }
});

test('EV-158 U9（D6）：失联后取消那一格判 mismatch ⇒ 告警按比对依据分写，两种依据下都不对 worker 与记录里的 CLI 发信号', async () => {
  const c = childProcess.spawn('sh', ['-c', 'sleep 600; : "$0"', `trivium-c158-u9-${process.pid}-${Date.now()}`], { detached: true, stdio: 'ignore' });
  c.unref();
  const pgid = c.pid!;
  let started: string | null = null;
  for (let i = 0; i < 20 && !started; i++) {
    started = await processStartTime(pgid, { canonical: true });
    if (!started) await new Promise((res) => setTimeout(res, 50));
  }
  try {
    // basis = canonical：规范化值不符（PID 复用 / 取不到）——不再提环境
    let r = await notThisCell('R-C158-U9-C', (s) => {
      s.worker_started_at_canonical = 'Thu Jan  1 00:00:00 1970';
      s.sides.gemini!.cli = { pgid, started_at: started };
    });
    assert.match(r.err, /上有活进程，但启动时刻与 status\.json 的规范化记录不符：PID 已被复用，或本次取不到它的启动时刻——不对它发信号，本次也未结束它名下的审查员 CLI/, r.err);
    assert.doesNotMatch(r.err, /TZ \/ 区域设置|BACKLOG EV-158|按记录结束审查员 CLI/, r.err);
    assert.match(r.out, /但工作进程的身份与记录不符，未对工作进程与它名下的审查员 CLI 发信号/);
    assert.ok(groupMemberCount(pgid) > 0, 'basis = canonical 的 mismatch 同样不结束记录里的 CLI');
    // basis = legacy：旧版写下的记录——原句逐字保留，句末补成因
    r = await notThisCell('R-C158-U9-L', (s) => {
      s.worker_started_at = 'Thu Jan  1 00:00:00 1970';
      delete s.worker_started_at_canonical;
      s.sides.gemini!.cli = { pgid, started_at: started };
    });
    assert.match(r.err, /也可能是本命令的 TZ \/ 区域设置与 --start 不同（BACKLOG EV-158）——不对它发信号/, r.err);
    assert.match(r.err, /这份记录没有规范化启动时刻——由升级前的旧版写下，或写时取不到——所以只能按缺省环境比较/, r.err);
    assert.doesNotMatch(r.err, /按记录结束审查员 CLI/, r.err);
    assert.ok(groupMemberCount(pgid) > 0);
  } finally {
    killGroup(pgid);
  }
});
