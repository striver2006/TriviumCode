import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  bashTimeoutFor, cancelRun, runDirFor, settleOrphanedStart, statusRun, waitRun, workerGoneForCancel,
} from '../../src/trivium/run-protocol.js';
import { getGate, setGate } from '../../src/trivium/state.js';
import { newStatus, readStatus, writeStatus } from '../../src/trivium/status.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { acquireLock, inspectLock } from '../../src/trivium/lock.js';
import { spawnDetached, processStartTime, processAlive } from '../../src/trivium/util/exec.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
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

async function fakeCtx(): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-proto-'));
  const cfg = defaultConfig();
  cfg.runtime.run_root = path.join(root, 'runs');
  return {
    config: cfg,
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

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

/** 进程内捕获 stderr（step / warn 都走它），fn 结束后原样恢复 */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; err: string }> {
  const orig = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    return { value: await fn(), err };
  } finally {
    process.stderr.write = orig;
  }
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
  assert.equal(await workerGoneForCancel(process.pid, 'Thu Jan  1 00:00:00 1970'), true, '计划双审 r1 AGY-04：复用者不能被当成 worker 升级 SIGKILL');
  assert.equal(await workerGoneForCancel(process.pid, real), false);
  assert.equal(await workerGoneForCancel(999_993, null), true);
});
