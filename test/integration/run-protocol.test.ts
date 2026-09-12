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
import type { Ctx } from '../../src/trivium/types.js';

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
