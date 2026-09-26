import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { bashTimeoutFor, cancelRun, runDirFor, statusRun, waitRun } from '../../src/trivium/run-protocol.js';
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
