import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  acquireLock, criticalHoldTimeoutMs, inspectLock, judgeStale, reclaimStaleLock, withTopicLock,
  bumpStopBlockCount, resetStopBlockCount, type LockContent,
} from '../../src/trivium/lock.js';
import { WORKER_HEARTBEAT_MS } from '../../src/trivium/status.js';
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

test('回收复验不符时，把别人的新锁放回去而不是删掉（GLM-04 的承诺此前未兑现）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  // 我们判定为遗留的是 A；但在我们动手前它已被 release、别人建了新锁 B
  const A: LockContent = {
    topic: TOPIC, stage: null, run_id: 'R-A', pid: 2 ** 22, pid_started_at: null, acquired_at: 'A', kind: 'run',
  };
  const B: LockContent = { ...A, run_id: 'R-B', pid: process.pid, acquired_at: 'B' };
  await fs.writeFile(lockFile(dir), JSON.stringify(B));

  const ok = await reclaimStaleLock(lockFile(dir), A);
  assert.equal(ok, false);
  const onDisk = await inspectLock(dir, TOPIC);
  assert.equal(onDisk?.run_id, 'R-B', '别人的新锁必须原样留在原位');
});

test('原本不可解析、此刻已是合法锁 → 不回收（那是别人刚建的）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  const B: LockContent = {
    topic: TOPIC, stage: null, run_id: 'R-B', pid: process.pid, pid_started_at: null, acquired_at: 'B', kind: 'run',
  };
  await fs.writeFile(lockFile(dir), JSON.stringify(B));
  assert.equal(await reclaimStaleLock(lockFile(dir), null), false);
  assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-B');
});

test('锁文件一出现就是完整内容：并发争抢从不观察到空文件', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  let sawEmpty = false;
  // 一边高频轮询锁文件内容，一边并发抢锁
  const poll = (async () => {
    const until = Date.now() + 400;
    while (Date.now() < until) {
      try {
        const raw = await fs.readFile(lockFile(dir), 'utf8');
        if (raw.length === 0) sawEmpty = true;
      } catch { /* 不存在是正常 */ }
    }
  })();
  const handles = await Promise.all(
    Array.from({ length: 6 }, () =>
      acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 200, retryDelayMs: 5 })
        .then(async (h) => { await new Promise((r) => setTimeout(r, 10)); await h.release(); }),
    ),
  );
  await poll;
  assert.ok(handles.length === 6);
  assert.equal(sawEmpty, false, 'open(wx) 后再 writeFile 会留下空文件窗口，并发者会把活锁当 unparsable 回收');
});

test('不可解析但刚写下的锁文件：不抢，先当活锁重试', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await fs.writeFile(lockFile(dir), '');
  await assert.rejects(
    acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 1, retryDelayMs: 5 }),
    (e: { code?: number }) => e.code === EXIT.LOCKED,
  );
  // 放旧了才按 unparsable 回收
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockFile(dir), old, old);
  const h = await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 1, retryDelayMs: 5 });
  assert.equal(h.content.pid, process.pid);
  await h.release();
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

// ── EV-161：短临界区锁的持有超时 = max(heartbeat_stale_s, worker 心跳间隔)（临界区锁超时下限计划 r2 §6.1）──

/** 下限：从 status.ts 导入，测试里不写 30000 */
const FLOOR = WORKER_HEARTBEAT_MS;
/** 亚秒阈值（`heartbeat_stale_s: 0.05`） */
const SUB_MS = 50;

async function liveLock(kind: 'critical' | 'run', acquiredAt: number): Promise<LockContent> {
  return {
    topic: TOPIC, stage: null, run_id: null, pid: process.pid,
    pid_started_at: await processStartTime(process.pid),
    acquired_at: new Date(acquiredAt).toISOString(), kind,
  };
}

test('EV-161 U1：下限的来源就是 WORKER_HEARTBEAT_MS，取大不取小', () => {
  assert.equal(criticalHoldTimeoutMs(1), WORKER_HEARTBEAT_MS);
  assert.equal(criticalHoldTimeoutMs(SUB_MS), WORKER_HEARTBEAT_MS);
  assert.equal(criticalHoldTimeoutMs(WORKER_HEARTBEAT_MS - 1), WORKER_HEARTBEAT_MS);
  assert.equal(criticalHoldTimeoutMs(WORKER_HEARTBEAT_MS), WORKER_HEARTBEAT_MS);
  assert.equal(criticalHoldTimeoutMs(WORKER_HEARTBEAT_MS + 1), WORKER_HEARTBEAT_MS + 1);
  assert.equal(criticalHoldTimeoutMs(120_000), 120_000);
  // 非有限值与原先同为「不回收」（age > NaN 为假），靠 Math.max 的 NaN 传播成立（代码双审 r1 CODEX-03）
  assert.ok(Number.isNaN(criticalHoldTimeoutMs(Number.NaN)));
  assert.equal(criticalHoldTimeoutMs(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
});

test('EV-161 U1′：阈值为 NaN 时 critical 活锁照旧不按年龄回收', async () => {
  const t0 = Date.now();
  const lock = await liveLock('critical', t0);
  assert.equal(await judgeStale(lock, { heartbeatStaleMs: Number.NaN, now: t0 + 10 * 120_000 }), null);
});

test('EV-161 U2：阈值低于下限时 critical 锁按下限判，持有未过下限不回收', async () => {
  const t0 = Date.now();
  const lock = await liveLock('critical', t0);
  const at = async (age: number) => judgeStale(lock, { heartbeatStaleMs: SUB_MS, now: t0 + age });
  assert.equal(await at(1_000), null, '持有 1 s（远超 50 ms 阈值）不得回收');
  assert.equal(await at(FLOOR - 1), null);
  assert.equal(await at(FLOOR), null, '等于下限不回收（严格大于）');
  assert.equal(await at(FLOOR + 1), 'heartbeat_dead', '过了下限照常判');
});

test('EV-161 U3：阈值等于、高于下限时与原判据逐字相同', async () => {
  const t0 = Date.now();
  const lock = await liveLock('critical', t0);
  for (const T of [FLOOR, FLOOR + 1, 45_000, 120_000]) {
    for (const age of [T - 1, T, T + 1, FLOOR - 1, FLOOR, FLOOR + 1, 10 * T]) {
      // 参考谓词就是改前那一行：age > heartbeatStaleMs
      const expected = age > T ? 'heartbeat_dead' : null;
      assert.equal(
        await judgeStale(lock, { heartbeatStaleMs: T, now: t0 + age }), expected,
        `阈值 ${T} ms、持有 ${age} ms 应与原判据相同`,
      );
    }
  }
});

test('EV-161 U4：run 锁不受影响（不走年龄判据）', async () => {
  const t0 = Date.now();
  const lock = await liveLock('run', t0);
  for (const T of [SUB_MS, 2_000, 120_000]) {
    for (const age of [FLOOR + 1, 10 * FLOOR, 10 * T]) {
      assert.equal(
        await judgeStale(lock, { heartbeatStaleMs: T, now: t0 + age }), null,
        `run 锁在阈值 ${T} ms、持有 ${age} ms 时也不能按年龄判遗留`,
      );
    }
  }
});

test('EV-161 U5：小阈值下其余判据不变（pid_gone / pid_reused / runTerminal / unparsable）', async () => {
  const now = new Date().toISOString();
  const gone: LockContent = {
    topic: TOPIC, stage: null, run_id: null, pid: 2 ** 22, pid_started_at: null, acquired_at: now, kind: 'critical',
  };
  assert.equal(await judgeStale(gone, { heartbeatStaleMs: SUB_MS }), 'pid_gone');
  const reused: LockContent = { ...gone, pid: process.pid, pid_started_at: 'Thu Jan  1 00:00:00 1970' };
  assert.equal(await judgeStale(reused, { heartbeatStaleMs: SUB_MS }), 'pid_reused');
  const live = await liveLock('critical', Date.now());
  assert.equal(
    await judgeStale(live, { heartbeatStaleMs: SUB_MS, runTerminal: true, now: Date.parse(live.acquired_at) }),
    'heartbeat_dead', '运行已终态仍立即回收，不等下限',
  );
  assert.equal(await judgeStale(null, { heartbeatStaleMs: SUB_MS }), 'unparsable');
});

test('EV-161 U6：acquireLock 在亚秒阈值下不回收刚取不久的活锁，锁文件逐字节不变', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  const text = JSON.stringify(await liveLock('critical', Date.now() - 1_000), null, 2) + '\n';
  await fs.writeFile(lockFile(dir), text);
  await assert.rejects(
    acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: SUB_MS, retries: 0 }),
    (e: { code?: number }) => e.code === EXIT.LOCKED,
    '持有 1 s 的活临界区不得被 50 ms 阈值回收',
  );
  assert.equal(await fs.readFile(lockFile(dir), 'utf8'), text, '锁文件必须原样留着');
});

test('EV-161 U7：acquireLock 在亚秒阈值下过了下限照常回收', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  const old = await liveLock('critical', Date.now() - (FLOOR + 5_000));
  await fs.writeFile(lockFile(dir), JSON.stringify(old, null, 2) + '\n');
  const h = await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: SUB_MS, retries: 0 });
  assert.equal(h.content.pid, process.pid);
  assert.notEqual(h.content.acquired_at, old.acquired_at, '应是回收后新建的锁');
  await h.release();
});

test('EV-161 U8：同进程并发——亚秒阈值下慢临界区不被并发者回收、不丢更新', async () => {
  const dir = await tmpTrivium();
  let inside = 0;
  let maxInside = 0;
  let counter = 0;
  const order: string[] = [];
  const body = (name: string, holdMs: number) => async () => {
    inside++;
    maxInside = Math.max(maxInside, inside);
    order.push(`${name}+`);
    const cur = counter;
    await new Promise((r) => setTimeout(r, holdMs));
    counter = cur + 1;
    order.push(`${name}-`);
    inside--;
  };
  let entered!: () => void;
  const aIn = new Promise<void>((r) => { entered = r; });
  const a = withTopicLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: SUB_MS }, async () => {
    entered();
    await body('A', 300)();
  });
  await aIn;
  await new Promise((r) => setTimeout(r, SUB_MS));
  const b = withTopicLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: SUB_MS }, body('B', 10));
  await Promise.all([a, b]);
  assert.equal(maxInside, 1, `临界区最多一个持有者，实际 ${maxInside}（${order.join(' ')}）`);
  assert.deepEqual(order, ['A+', 'A-', 'B+', 'B-'], 'B 必须在 A 放锁之后进');
  assert.equal(counter, 2, '读改写不丢更新');
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
