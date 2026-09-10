import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  acquireLock, inspectLock, judgeStale, reclaimStaleLock, withTopicLock,
  bumpStopBlockCount, resetStopBlockCount, type LockContent,
} from '../../src/trivium/lock.js';
import { processStartTime } from '../../src/trivium/util/exec.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

async function tmpTrivium(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trivium-lock-'));
}
const STALE_MS = 120_000;
const TOPIC = '登录重构';

function lockFile(dir: string, topic = TOPIC): string {
  return path.join(dir, 'lock', `${topic}.lock`);
}

test('首次获取成功，锁文件记录 pid 与启动时刻', async () => {
  const dir = await tmpTrivium();
  const h = await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  assert.equal(h.content.pid, process.pid);
  assert.ok(h.content.pid_started_at, '必须记录启动时刻，否则无法识别 PID 复用');
  const onDisk = await inspectLock(dir, TOPIC);
  assert.equal(onDisk?.pid, process.pid);
  await h.release();
  assert.equal(await inspectLock(dir, TOPIC), null, 'release 后锁应消失');
});

test('活锁被占用且不重试 → 抛退出码 70，并带上现有 run_id', async () => {
  const dir = await tmpTrivium();
  const h = await acquireLock({
    triviumDir: dir, topic: TOPIC, runId: 'R-EXISTING',
    kind: 'run', heartbeatStaleMs: STALE_MS,
  });
  await assert.rejects(
    acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.LOCKED);
      assert.ok(e.message.includes('R-EXISTING'), '错误信息应给出现有 run_id 供排查');
      assert.ok(e.message.includes('--cancel'), '应提示工具化恢复路径');
      return true;
    },
  );
  await h.release();
});

test('release 只删自己的锁：内容不符时不误删他人的锁', async () => {
  const dir = await tmpTrivium();
  const h = await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  // 模拟锁被回收后由别人重新持有
  await fs.writeFile(lockFile(dir), JSON.stringify({ ...h.content, pid: 999999, acquired_at: 'later' }));
  await h.release();
  assert.notEqual(await inspectLock(dir, TOPIC), null, '不得删掉别人的锁');
});

// ── judgeStale 的三条判据 ──

test('判据 1：PID 不存在 → pid_gone', async () => {
  const lock: LockContent = {
    topic: TOPIC, stage: 'plan', run_id: 'R', pid: 2 ** 22, pid_started_at: null,
    acquired_at: new Date().toISOString(), kind: 'run',
  };
  assert.equal(await judgeStale(lock, { heartbeatStaleMs: STALE_MS }), 'pid_gone');
});

test('判据 2：PID 存在但启动时刻不符 → pid_reused（治 macOS PID 复用）', async () => {
  const lock: LockContent = {
    topic: TOPIC, stage: 'plan', run_id: 'R',
    pid: process.pid,
    pid_started_at: 'Thu Jan  1 00:00:00 1970', // 故意与真实启动时刻不符
    acquired_at: new Date().toISOString(), kind: 'run',
  };
  assert.equal(await judgeStale(lock, { heartbeatStaleMs: STALE_MS }), 'pid_reused');
});

test('判据 2 的反面：启动时刻相符的活进程不算遗留', async () => {
  const lock: LockContent = {
    topic: TOPIC, stage: 'plan', run_id: 'R',
    pid: process.pid,
    pid_started_at: await processStartTime(process.pid),
    acquired_at: new Date().toISOString(), kind: 'run',
  };
  assert.equal(await judgeStale(lock, { heartbeatStaleMs: STALE_MS }), null);
});

test('判据 3：运行已终态 → heartbeat_dead，不必等满心跳 TTL', async () => {
  const lock: LockContent = {
    topic: TOPIC, stage: 'plan', run_id: 'R',
    pid: process.pid,
    pid_started_at: await processStartTime(process.pid),
    acquired_at: new Date().toISOString(), // 刚获取，远未过期
    kind: 'run',
  };
  assert.equal(
    await judgeStale(lock, { heartbeatStaleMs: STALE_MS, runTerminal: true }),
    'heartbeat_dead',
    '早期猝死不应留下最长 120s 的死锁窗口',
  );
});

test('锁文件损坏 → unparsable，视为遗留（否则永久锁死）', async () => {
  assert.equal(await judgeStale(null, { heartbeatStaleMs: STALE_MS }), 'unparsable');
});

test('短临界区持有过久 → heartbeat_dead（长持锁不受此限）', async () => {
  const old = new Date(Date.now() - 10 * STALE_MS).toISOString();
  const started = await processStartTime(process.pid);
  const critical: LockContent = {
    topic: TOPIC, stage: null, run_id: null, pid: process.pid,
    pid_started_at: started, acquired_at: old, kind: 'critical',
  };
  assert.equal(await judgeStale(critical, { heartbeatStaleMs: STALE_MS }), 'heartbeat_dead');

  const longHeld: LockContent = { ...critical, kind: 'run' };
  assert.equal(
    await judgeStale(longHeld, { heartbeatStaleMs: STALE_MS }), null,
    '长持锁的工作进程本来就会持有很久，不能因此判遗留',
  );
});

test('遗留锁被自动回收后可重新获取', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  const dead: LockContent = {
    topic: TOPIC, stage: 'plan', run_id: 'R-DEAD', pid: 2 ** 22, pid_started_at: null,
    acquired_at: new Date().toISOString(), kind: 'run',
  };
  await fs.writeFile(lockFile(dir), JSON.stringify(dead));

  const h = await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  assert.equal(h.content.pid, process.pid, '回收后应由本进程持有');
  await h.release();
});

test('回收用 rename → 复验 → 删除，并发只有一个成功', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  const lock: LockContent = {
    topic: TOPIC, stage: null, run_id: 'R', pid: 2 ** 22, pid_started_at: null,
    acquired_at: 'A', kind: 'run',
  };
  await fs.writeFile(lockFile(dir), JSON.stringify(lock));

  const results = await Promise.all([
    reclaimStaleLock(lockFile(dir), lock),
    reclaimStaleLock(lockFile(dir), lock),
    reclaimStaleLock(lockFile(dir), lock),
  ]);
  assert.equal(results.filter(Boolean).length, 1, '三个并发回收者只应有一个成功');
});

test('短临界区串行化：并发 withTopicLock 不会交叠', async () => {
  const dir = await tmpTrivium();
  let inside = 0;
  let maxInside = 0;
  const body = async () => {
    inside++;
    maxInside = Math.max(maxInside, inside);
    await new Promise((r) => setTimeout(r, 20));
    inside--;
  };
  await Promise.all(
    Array.from({ length: 6 }, () =>
      withTopicLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS }, body),
    ),
  );
  assert.equal(maxInside, 1, `临界区最多允许一个进入，实际 ${maxInside}`);
});

test('短臨界区异常也会释放锁', async () => {
  const dir = await tmpTrivium();
  await assert.rejects(
    withTopicLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS }, async () => {
      throw new Error('业务失败');
    }),
    /业务失败/,
  );
  assert.equal(await inspectLock(dir, TOPIC), null, 'finally 必须释放锁');
});

test('不同主题的锁互不影响', async () => {
  const dir = await tmpTrivium();
  const a = await acquireLock({ triviumDir: dir, topic: '主题A', heartbeatStaleMs: STALE_MS });
  const b = await acquireLock({ triviumDir: dir, topic: '主题B', heartbeatStaleMs: STALE_MS });
  assert.ok(a && b);
  await a.release();
  await b.release();
});

// ── hook-stop 阻断计数：免锁自增 ──

test('阻断计数自增并在超过上限时报 exceeded', async () => {
  const dir = await tmpTrivium();
  const r1 = await bumpStopBlockCount(dir, TOPIC, 'plan', 2);
  assert.deepEqual([r1.count, r1.exceeded], [1, false]);
  const r2 = await bumpStopBlockCount(dir, TOPIC, 'plan', 2);
  assert.deepEqual([r2.count, r2.exceeded], [2, false]);
  const r3 = await bumpStopBlockCount(dir, TOPIC, 'plan', 2);
  assert.deepEqual([r3.count, r3.exceeded], [3, true], '第 3 次超过上限 2');
});

test('阻断计数按主题与阶段分别记，reset 只清对应的一份', async () => {
  const dir = await tmpTrivium();
  await bumpStopBlockCount(dir, TOPIC, 'plan', 2);
  await bumpStopBlockCount(dir, TOPIC, 'code', 2);
  await resetStopBlockCount(dir, TOPIC, 'plan');
  assert.equal((await bumpStopBlockCount(dir, TOPIC, 'plan', 2)).count, 1, 'plan 已清零');
  assert.equal((await bumpStopBlockCount(dir, TOPIC, 'code', 2)).count, 2, 'code 不受影响');
});

test('阻断计数并发自增不丢计数', async () => {
  const dir = await tmpTrivium();
  await Promise.all(Array.from({ length: 8 }, () => bumpStopBlockCount(dir, TOPIC, 'bug', 100)));
  const final = await bumpStopBlockCount(dir, TOPIC, 'bug', 100);
  assert.equal(final.count, 9, `8 次并发 + 1 次应为 9，实际 ${final.count}`);
});
