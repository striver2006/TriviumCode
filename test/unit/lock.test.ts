import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
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

// ── 锁回收误判已删锁文件（EV-173 / EV-149，计划 r2 §5.1）：同进程 + fs.promises 桩控制 lock.ts 内部时序 ──

type FsFn = (...a: unknown[]) => Promise<unknown>;

/** 给 `fs.promises` 的一个方法打桩（`lock.ts` 取的是同一个对象、调用时按属性查找）；返回复原函数，调用方在 finally 里复原 */
function stubFs(name: 'open' | 'readFile' | 'writeFile' | 'rename' | 'link', wrap: (orig: FsFn) => FsFn): () => void {
  const t = fs as unknown as Record<string, FsFn>;
  const orig = t[name]!;
  t[name] = wrap(orig);
  return () => {
    t[name] = orig;
  };
}

/** 截 stderr（`warn` 直接写 process.stderr）；拒绝时把错误一并带回 */
async function withStderr<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; error: unknown; err: string }> {
  const orig = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write;
  try {
    return { value: await fn(), error: undefined, err };
  } catch (e) {
    return { value: undefined, error: e, err };
  } finally {
    process.stderr.write = orig;
  }
}

/** 与 `lock.ts` `readLockFile` 同一形态的身份：`dev:ino:mtimeNs` */
async function identityOf(p: string): Promise<string> {
  const st = await fs.stat(p, { bigint: true });
  return `${st.dev}:${st.ino}:${st.mtimeNs}`;
}

const DEAD: LockContent = {
  topic: TOPIC, stage: 'plan', run_id: 'R-DEAD', pid: 2 ** 22, pid_started_at: null,
  acquired_at: '2026-01-01T00:00:00.000Z', kind: 'run',
};
const liveContent = (runId: string): LockContent => ({
  topic: TOPIC, stage: 'plan', run_id: runId, pid: process.pid, pid_started_at: null,
  acquired_at: new Date().toISOString(), kind: 'run',
});
const writeLockFile = (p: string, c: LockContent | string): Promise<void> =>
  fs.writeFile(p, typeof c === 'string' ? c : JSON.stringify(c, null, 2) + '\n');
const staleLeftovers = async (dir: string): Promise<string[]> =>
  (await fs.readdir(path.join(dir, 'lock'))).filter((n) => n.includes('.stale-'));

test('锁回收误判 U1：EEXIST 之后、读锁之前持有者释放 ⇒ 立刻重试拿到锁，不告警、不 rename（EV-173）', async () => {
  const dir = await tmpTrivium();
  await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  let injected = 0;
  let renames = 0;
  const r1 = stubFs('open', (orig) => async (...a) => {
    if (a[0] === lockFile(dir) && injected++ === 0) await fs.rm(lockFile(dir), { force: true }); // 持有者恰在此刻释放
    return orig(...a);
  });
  const r2 = stubFs('rename', (orig) => async (...a) => {
    renames++;
    return orig(...a);
  });
  try {
    let judged = 0;
    const runTerminal = async (): Promise<boolean> => {
      judged++;
      return false;
    };
    const r = await withStderr(() =>
      acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0, runTerminal }),
    );
    assert.ok(injected >= 1, '桩必须真的在读锁前删过');
    assert.equal(r.error, undefined, `应拿到锁：${String(r.error)}`);
    assert.equal(r.value?.content.pid, process.pid);
    assert.doesNotMatch(r.err, /回收主题/, '锁已释放不是遗留锁，不得告警');
    assert.equal(judged, 0, '锁已不在就不进判定（不查 runTerminal）');
    assert.equal(renames, 0, '不得进回收');
    await r.value?.release();
  } finally {
    r1();
    r2();
  }
});

test('锁回收误判 U2：读锁时锁已不在、重试 link 前又被别人建上 ⇒ 按活锁判、抛 70，无告警', async () => {
  const dir = await tmpTrivium();
  await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  let phase = 0;
  const r1 = stubFs('open', (orig) => async (...a) => {
    if (a[0] === lockFile(dir) && phase === 0) {
      phase = 1;
      await fs.rm(lockFile(dir), { force: true });
    }
    return orig(...a);
  });
  const r2 = stubFs('link', (orig) => async (...a) => {
    if (a[1] === lockFile(dir) && phase === 1) {
      phase = 2;
      await writeLockFile(lockFile(dir), liveContent('R-OTHER')); // 别人抢先建上
    }
    return orig(...a);
  });
  try {
    const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
    assert.equal(phase, 2, '两段桩都应触发');
    assert.equal((r.error as { code?: number } | undefined)?.code, EXIT.LOCKED, `应抛 70：${String(r.error)}`);
    assert.match(String((r.error as Error).message), /run_id R-OTHER/);
    assert.doesNotMatch(r.err, /回收主题/);
    assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-OTHER', '别人的锁原样在位');
  } finally {
    r1();
    r2();
  }
});

test('锁回收误判 U3：不可解析锁的年龄取自判定的同一个 inode——读后路径被换成旧文件，仍按新写的不回收', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), ''); // 刚写下、不可解析
  let swapped = false;
  const r1 = stubFs('open', (orig) => async (...a) => {
    const fh = await orig(...a);
    if (a[0] === lockFile(dir) && !swapped) {
      swapped = true;
      // 描述符已拿到之后，路径上换成一份 60 s 前的旧文件：按路径 stat 会得「旧」，按描述符 fstat 仍是「新」
      const other = `${lockFile(dir)}.swap`;
      await writeLockFile(other, '');
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(other, old, old);
      await fs.rename(other, lockFile(dir));
    }
    return fh;
  });
  try {
    const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
    assert.ok(swapped);
    assert.equal((r.error as { code?: number } | undefined)?.code, EXIT.LOCKED, `判定的那一份是新写的，应当活锁处理：${String(r.error)}`);
    assert.doesNotMatch(r.err, /回收主题/);
  } finally {
    r1();
  }
});

test('锁回收误判 U4：回收前身份预检——路径上已换成新锁 ⇒ 返回 false、不 rename、新锁逐字节不变', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const judged = await identityOf(lockFile(dir));
  await fs.rm(lockFile(dir));
  await writeLockFile(lockFile(dir), liveContent('R-NEW'));
  const before = await fs.readFile(lockFile(dir), 'utf8');
  let renames = 0;
  const r1 = stubFs('rename', (orig) => async (...a) => {
    renames++;
    return orig(...a);
  });
  try {
    assert.equal(await reclaimStaleLock(lockFile(dir), DEAD, judged), false);
    assert.equal(renames, 0, '预检不符不得 rename');
    assert.equal(await fs.readFile(lockFile(dir), 'utf8'), before);
    // 反面：身份相符照常回收
    assert.equal(await reclaimStaleLock(lockFile(dir), null, await identityOf(lockFile(dir))), true);
    assert.equal(await inspectLock(dir, TOPIC), null);
  } finally {
    r1();
  }
});

test('锁回收误判 U4′：身份含修改时刻——判定之后遗留锁被就地改写（inode 相同、mtime 不同）⇒ 预检不符，不回收', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockFile(dir), old, old);
  const ino = (await fs.stat(lockFile(dir))).ino;
  let opens = 0;
  const r1 = stubFs('open', (orig) => async (...a) => {
    // 第一次是判定读，第二次是回收的预检读：在预检之前就地改写成活锁（同一 inode，只改内容与修改时刻）
    if (a[0] === lockFile(dir) && ++opens === 2) await writeLockFile(lockFile(dir), liveContent('R-REWRITTEN'));
    return orig(...a);
  });
  try {
    const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
    assert.ok(opens >= 2, '桩必须在预检读时触发');
    assert.equal((await fs.stat(lockFile(dir))).ino, ino, '前提：同一 inode');
    assert.equal((r.error as { code?: number } | undefined)?.code, EXIT.LOCKED, `就地改写后的是活锁：${String(r.error)}`);
    assert.doesNotMatch(r.err, /回收主题/);
    assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-REWRITTEN', '活锁原样在位');
  } finally {
    r1();
  }
});

test('锁回收误判 U4b：不传身份、expected 非空而此刻内容读不出 ⇒ 不回收（计划双审 AGY-01）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), '{"topic": "写到一半');
  assert.equal(await reclaimStaleLock(lockFile(dir), DEAD), false);
  assert.equal(await fs.readFile(lockFile(dir), 'utf8'), '{"topic": "写到一半', '正在改写的锁不得被挪走');
  assert.deepEqual(await staleLeftovers(dir), []);
});

test('锁回收误判 U5：慢回收者判定之后快回收者已建好新锁 ⇒ 慢者不挪走活锁，空档不出现，只有一个持有者（EV-149 入口 B）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const opts = (runId: string) => ({ triviumDir: dir, topic: TOPIC, runId, kind: 'run' as const, heartbeatStaleMs: STALE_MS, retries: 0 });
  // B 对锁路径的第二次触碰（判定之后的预检读 / 旧实现的 rename）被扣住，直到 A 回收并持锁
  let touches = 0;
  let phase: 'B' | 'A' = 'B';
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let atHold!: () => void;
  const reachedHold = new Promise<void>((r) => (atHold = r));
  let renamesOfLock = 0;
  const hold = async (p: unknown) => {
    if (phase === 'B' && p === lockFile(dir) && ++touches === 2) {
      atHold();
      await held;
    }
  };
  const r1 = stubFs('open', (orig) => async (...a) => {
    await hold(a[0]);
    return orig(...a);
  });
  const r2 = stubFs('rename', (orig) => async (...a) => {
    await hold(a[0]);
    if (a[0] === lockFile(dir)) renamesOfLock++;
    return orig(...a);
  });
  // 旧实现读锁走 readFile：一并计入触碰，否则扣留点到不了（移植到旧构建上时应红而不是挂死）
  const r3 = stubFs('readFile', (orig) => async (...a) => {
    await hold(a[0]);
    return orig(...a);
  });
  try {
    const cap = await withStderr(async () => {
      const b = acquireLock(opts('R-B')).then(() => 'B 拿到了', (e: { code?: number }) => e.code);
      const reached = await Promise.race([reachedHold.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5_000))]);
      assert.ok(reached, 'B 没走到判定之后的第二次触碰（桩失效）');
      phase = 'A';
      const a = await acquireLock(opts('R-A'));
      release();
      const bResult = await b;
      const c = await acquireLock(opts('R-C')).then(() => 'C 拿到了', (e: { code?: number }) => e.code);
      return { a, bResult, c };
    });
    assert.equal(cap.error, undefined, String(cap.error));
    const { a, bResult, c } = cap.value!;
    assert.equal(bResult, EXIT.LOCKED, 'B 预检看到新锁，不回收，按活锁抛 70');
    assert.equal(c, EXIT.LOCKED, 'A 持有期间 C 不得拿到');
    assert.equal(renamesOfLock, 1, '只有 A 的一次回收 rename');
    assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-A');
    assert.equal((cap.err.match(/回收主题/g) ?? []).length, 1, `只有真回收的 A 告警一条：${cap.err}`);
    await a.release();
    assert.equal(await inspectLock(dir, TOPIC), null);
  } finally {
    release();
    r1();
    r2();
    r3();
  }
});

test('锁回收误判 U6：残余窗口命中（预检之后才换人）⇒ 放回用 link、不覆盖空档里的新锁，留痕告警，不留 tmp', async () => {
  for (const cJoins of [true, false]) {
    const dir = await tmpTrivium();
    await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
    await writeLockFile(lockFile(dir), DEAD);
    const judged = await identityOf(lockFile(dir));
    let swapped = false;
    let cLinked = false;
    const r1 = stubFs('rename', (orig) => async (...a) => {
      if (a[0] === lockFile(dir) && !swapped) {
        swapped = true;
        // 预检已通过；此刻另一回收者完成了回收并建好新锁 LA
        await fs.rm(lockFile(dir));
        await writeLockFile(lockFile(dir), liveContent('R-LA'));
      }
      return orig(...a);
    });
    const r2 = stubFs('open', (orig) => async (...a) => {
      if (cJoins && !cLinked && String(a[0]).includes('.stale-')) {
        cLinked = true;
        await writeLockFile(lockFile(dir), liveContent('R-LC')); // 复验期间 C 在空档里建锁
      }
      return orig(...a);
    });
    try {
      const r = await withStderr(() => reclaimStaleLock(lockFile(dir), DEAD, judged));
      assert.equal(r.value, false, `挪走的不是判定的那一份（C ${cJoins ? '进' : '不进'}空档）`);
      assert.deepEqual(await staleLeftovers(dir), [], 'link 放回不移走源，tmp 必须删掉');
      if (cJoins) {
        assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-LC', '放回不得覆盖空档里的新锁');
        assert.match(r.err, /回收主题「登录重构」的锁时挪走了一把新建的锁且放不回，可能有两个持有者/);
      } else {
        assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-LA', '没人进空档时原样放回');
        assert.doesNotMatch(r.err, /回收主题/);
      }
    } finally {
      r1();
      r2();
    }
  }
});

test('锁回收误判 U7：告警只在真回收之后打，文字不变；预检不符放弃回收时不告警', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const ok = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
  assert.equal(ok.error, undefined);
  assert.equal(
    ok.err.split('\n').filter((l) => l.includes('回收主题')).join('\n'),
    `⚠️  回收主题「${TOPIC}」的遗留锁（原因 pid_gone，原持有者 pid ${2 ** 22}）`,
  );
  await ok.value?.release();

  // 判定（第一次读）之后、预检（第二次读）之前换成活锁：什么都没回收，不得告警
  await writeLockFile(lockFile(dir), DEAD);
  let opens = 0;
  const r1 = stubFs('open', (orig) => async (...a) => {
    if (a[0] === lockFile(dir) && ++opens === 2) {
      await fs.rm(lockFile(dir));
      await writeLockFile(lockFile(dir), liveContent('R-LIVE'));
    }
    return orig(...a);
  });
  try {
    const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
    assert.equal((r.error as { code?: number } | undefined)?.code, EXIT.LOCKED);
    assert.doesNotMatch(r.err, /回收主题/, '没回收就不说回收了');
    assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-LIVE');
  } finally {
    r1();
  }
});

test('锁回收误判 U8：同进程同一毫秒的两次回收 tmp 名不同', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const targets: string[] = [];
  const now = Date.now;
  Date.now = () => 1_790_000_000_000;
  const r1 = stubFs('rename', () => async (...a) => {
    targets.push(String(a[1]));
    throw Object.assign(new Error('桩：不真的挪'), { code: 'EBUSY' });
  });
  try {
    // 顺序两次：同一份遗留锁同一时刻只许一个回收者持认领（D8），认领在 finally 里释放，第二次照样走到 rename
    assert.equal(await reclaimStaleLock(lockFile(dir), DEAD), false);
    assert.equal(await reclaimStaleLock(lockFile(dir), DEAD), false);
  } finally {
    r1();
    Date.now = now;
  }
  assert.equal(targets.length, 2, '两次都应走到 rename');
  assert.notEqual(targets[0], targets[1], `tmp 名撞了：${targets.join(' ')}`);
});

const claimOf = (p: string, identity: string): string =>
  `${p}.reclaim-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
const claimLeftovers = async (dir: string): Promise<string[]> =>
  (await fs.readdir(path.join(dir, 'lock'))).filter((n) => n.includes('.reclaim-'));

test('锁回收误判 U12：回收认领——同一份遗留锁同一时刻只有一个回收者动手；新鲜认领挡住后来者，陈旧认领被清掉后可重来（D8）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const judged = await identityOf(lockFile(dir));

  // ① 第一个回收者持认领、在 rename 前被扣住：第二个同身份回收者拿不到认领，直接放弃，不碰锁路径
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let atRename!: () => void;
  const reachedRename = new Promise<void>((r) => (atRename = r));
  let renamesOfLock = 0;
  const r1 = stubFs('rename', (orig) => async (...a) => {
    if (a[0] === lockFile(dir) && renamesOfLock++ === 0) {
      atRename();
      await held;
    }
    return orig(...a);
  });
  try {
    const first = reclaimStaleLock(lockFile(dir), DEAD, judged);
    // 带超时：变异下第一个回收者可能根本走不到 rename，此时应红而不是挂死（变异装置不给套件加超时）
    const reached = await Promise.race([reachedRename.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5_000))]);
    if (!reached) assert.fail(`第一个回收者没走到 rename：${String(await first)}`); // 没走到就不会被扣住，first 此时已返回
    assert.deepEqual(await claimLeftovers(dir), [path.basename(claimOf(lockFile(dir), judged))], '认领按身份命名');
    assert.equal(await reclaimStaleLock(lockFile(dir), DEAD, judged), false, '同身份的第二个回收者应放弃');
    assert.equal(await reclaimStaleLock(lockFile(dir), DEAD), false, '不传身份的外部调用方按预检读到的身份认领，同样放弃');
    assert.equal(renamesOfLock, 1, '只有持认领者走到 rename');
    release();
    assert.equal(await first, true);
  } finally {
    release();
    r1();
  }
  assert.equal(await inspectLock(dir, TOPIC), null);
  assert.deepEqual(await claimLeftovers(dir), [], '认领在收尾时释放');

  // ② 认领残留：新鲜的挡住、原样保留；10 s 以上的按认领者中途死了清掉，下一轮照常回收
  await writeLockFile(lockFile(dir), DEAD);
  const id2 = await identityOf(lockFile(dir));
  const claim = claimOf(lockFile(dir), id2);
  await fs.writeFile(claim, '999999\n');
  assert.equal(await reclaimStaleLock(lockFile(dir), DEAD, id2), false, '新鲜认领挡住');
  assert.ok(await fs.stat(claim).then(() => true, () => false), '新鲜认领不得被清掉');
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(claim, old, old);
  assert.equal(await reclaimStaleLock(lockFile(dir), DEAD, id2), false, '碰到陈旧认领这一轮先放弃');
  assert.deepEqual(await claimLeftovers(dir), [], '陈旧认领已清掉');
  assert.equal(await reclaimStaleLock(lockFile(dir), DEAD, id2), true, '下一轮照常回收');
  assert.equal(await inspectLock(dir, TOPIC), null);

  // ③ 迟到的回收者：预检时还是那份遗留锁，拿认领之前上一个认领者已收掉它、别人建了新锁 ⇒ 认领后复查不符，不 rename
  await writeLockFile(lockFile(dir), DEAD);
  const id3 = await identityOf(lockFile(dir));
  let renames3 = 0;
  const r2 = stubFs('writeFile', (orig) => async (...a) => {
    if (String(a[0]).includes('.reclaim-') && renames3 === 0) {
      await fs.rm(lockFile(dir));
      await writeLockFile(lockFile(dir), liveContent('R-NEWER')); // 上一个认领者收掉了、别人建了新锁
    }
    return orig(...a);
  });
  const r3 = stubFs('rename', (orig) => async (...a) => {
    if (a[0] === lockFile(dir)) renames3++;
    return orig(...a);
  });
  try {
    assert.equal(await reclaimStaleLock(lockFile(dir), DEAD, id3), false);
    assert.equal(renames3, 0, '认领之后复查不符，不得 rename');
    assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-NEWER');
    assert.deepEqual(await claimLeftovers(dir), []);
  } finally {
    r2();
    r3();
  }
});

test('锁回收误判 U9：读锁取不到修改时刻、兜底 stat 时锁已不在 ⇒ 按已释放重试，不进回收', async () => {
  const dir = await tmpTrivium();
  await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  let opens = 0;
  const r1 = stubFs('open', (orig) => async (...a) => {
    if (a[0] === lockFile(dir) && ++opens === 1) {
      await fs.rm(lockFile(dir), { force: true });
      throw Object.assign(new Error('桩：权限不足'), { code: 'EACCES' }); // 读不了 ⇒ 不可解析、没有修改时刻
    }
    return orig(...a);
  });
  try {
    const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(opens, 1, '兜底 stat 得 ENOENT 应直接重试 link，不进回收的预检读');
    assert.doesNotMatch(r.err, /回收主题/);
    await r.value?.release();
  } finally {
    r1();
  }
});

test('锁回收误判 U10：打开锁文件之后读内容出错（EIO）⇒ 按不可解析判、不抛非 70 的异常（计划双审 GLM-02）', async () => {
  const dir = await tmpTrivium();
  await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS });
  const r1 = stubFs('open', (orig) => async (...a) => {
    const fh = (await orig(...a)) as object;
    if (a[0] !== lockFile(dir)) return fh;
    return new Proxy(fh, {
      get(t, k) {
        if (k === 'readFile') return async () => { throw Object.assign(new Error('桩：EIO'), { code: 'EIO' }); };
        const v = Reflect.get(t, k) as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
  });
  try {
    const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
    assert.equal((r.error as { code?: number } | undefined)?.code, EXIT.LOCKED, `刚写下的不可解析锁按活锁处理：${String(r.error)}`);
    assert.doesNotMatch(r.err, /回收主题/);
  } finally {
    r1();
  }
});

test('锁回收误判 U13：清理失败不改变结果类型——锁路径被旧目录占着照常拿到锁；认领创建遇非 EEXIST 错误时不回收并告警（代码双审 CODEX-04 / GLM-02）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(lockFile(dir), { recursive: true }); // 锁路径上是一个目录
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockFile(dir), old, old);
  const r = await withStderr(() => acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }));
  assert.equal(r.error, undefined, `不得抛出清理阶段的原始异常：${String(r.error)}`);
  assert.equal(r.value?.content.pid, process.pid);
  await r.value?.release();

  const dir2 = await tmpTrivium();
  await fs.mkdir(path.join(dir2, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir2), DEAD);
  const r1 = stubFs('writeFile', (orig) => async (...a) => {
    if (String(a[0]).includes('.reclaim-')) throw Object.assign(new Error('桩：权限不足'), { code: 'EACCES' });
    return orig(...a);
  });
  try {
    const w = await withStderr(() => reclaimStaleLock(lockFile(dir2), DEAD));
    assert.equal(w.value, false, 'fail-closed：认领不到就不回收');
    assert.match(w.err, /回收主题「登录重构」的遗留锁时认领失败（EACCES），本轮不回收/);
    assert.equal((await inspectLock(dir2, TOPIC))?.run_id, 'R-DEAD', '遗留锁原样在位');
  } finally {
    r1();
  }
});

test('锁回收误判 U14：回收没成（认领被占）时隔一个重试间隔再来，不空转（代码双审 CODEX-02）', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });
  await writeLockFile(lockFile(dir), DEAD);
  const claim = claimOf(lockFile(dir), await identityOf(lockFile(dir)));
  await fs.writeFile(claim, '999999\n'); // 一个「正在回收」的认领（未满 10 s）
  const judgedAt: number[] = [];
  const runTerminal = async (): Promise<boolean> => {
    judgedAt.push(Date.now());
    return false;
  };
  const DELAY = 150;
  // 约 500 ms 后认领者收工：删认领，下一轮照常回收
  const done = new Promise<void>((res) => setTimeout(() => void fs.rm(claim, { force: true }).then(() => res()), 500));
  const r = await withStderr(() =>
    acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0, retryDelayMs: DELAY, runTerminal }),
  );
  await done;
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.value?.content.pid, process.pid, '认领释放后照常回收并拿到锁');
  assert.ok(judgedAt.length >= 2, `应至少判定两轮：${judgedAt.length}`);
  const gaps = judgedAt.slice(1).map((t, i) => t - judgedAt[i]!);
  assert.ok(Math.min(...gaps) >= DELAY - 10, `两次判定之间应隔一个重试间隔（${DELAY} ms），实际 ${gaps.join(' / ')} ms`);
  await r.value?.release();
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
