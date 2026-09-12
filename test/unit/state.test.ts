import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  setGate, StateCorruptError,
  setGateChecked, getGate, listOpenGates, readState, shouldLockWrites, gateKey, type GateEntry,
} from '../../src/trivium/state.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

const STALE = 120_000;

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trivium-state-'));
}

function entry(over: Partial<GateEntry> = {}): GateEntry {
  return {
    topic: 't', stage: 'plan', state: 'awaiting_approval',
    run_id: 'R1', rerun_index: 1,
    since: new Date().toISOString(), session_id: 'S-CURRENT',
    ...over,
  };
}

test('设置与读取闸门', async () => {
  const d = await tmp();
  await setGate({
    triviumDir: d, topic: '登录重构', stage: 'plan', state: 'awaiting_approval',
    runId: 'R1', rerunIndex: 2, sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  const g = await getGate(d, '登录重构', 'plan');
  assert.equal(g?.state, 'awaiting_approval');
  assert.equal(g?.run_id, 'R1');
  assert.equal(g?.rerun_index, 2);
  assert.equal(g?.session_id, 'S1');
});

test('会话 id 一旦记下不因后续状态变化而丢（写锁作用域判定要用它）', async () => {
  const d = await tmp();
  await setGate({
    triviumDir: d, topic: 't', stage: 'plan', state: 'running',
    sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  // 后续更新不传 sessionId
  await setGate({
    triviumDir: d, topic: 't', stage: 'plan', state: 'awaiting_approval',
    heartbeatStaleMs: STALE,
  });
  assert.equal((await getGate(d, 't', 'plan'))?.session_id, 'S1');
});

test('不同主题与阶段互不干扰', async () => {
  const d = await tmp();
  await setGate({ triviumDir: d, topic: 'A', stage: 'plan', state: 'awaiting_approval', heartbeatStaleMs: STALE });
  await setGate({ triviumDir: d, topic: 'A', stage: 'code', state: 'approved', heartbeatStaleMs: STALE });
  await setGate({ triviumDir: d, topic: 'B', stage: 'plan', state: 'idle', heartbeatStaleMs: STALE });
  const s = await readState(d);
  assert.equal(Object.keys(s.gates).length, 3);
  assert.equal(s.gates[gateKey('A', 'code')]?.state, 'approved');
});

test('listOpenGates 只列未关闭的闸门', async () => {
  const d = await tmp();
  await setGate({ triviumDir: d, topic: 'A', stage: 'plan', state: 'awaiting_approval', heartbeatStaleMs: STALE });
  await setGate({ triviumDir: d, topic: 'B', stage: 'code', state: 'review_done_awaiting_disposition', heartbeatStaleMs: STALE });
  await setGate({ triviumDir: d, topic: 'C', stage: 'bug', state: 'approved', heartbeatStaleMs: STALE });
  await setGate({ triviumDir: d, topic: 'D', stage: 'plan', state: 'abandoned', heartbeatStaleMs: STALE });
  const open = await listOpenGates(d);
  assert.deepEqual(open.map((g) => g.topic).sort(), ['A', 'B']);
});

test('state.json 不存在 → 空状态（还没跑过，正常）', async () => {
  const d = await tmp();
  assert.deepEqual((await readState(d)).gates, {});
});

test('state.json 存在但坏了 → 抛 StateCorruptError（退出码 2），不得静默当成空', async () => {
  const d = await tmp();
  await fs.writeFile(path.join(d, 'state.json'), '{ 这不是 JSON', 'utf8');
  await assert.rejects(readState(d), (e: unknown) => {
    assert.ok(e instanceof StateCorruptError);
    assert.equal((e as StateCorruptError).code, EXIT.GATE_BLOCK);
    return true;
  });
  // 形状不对也算坏
  await fs.writeFile(path.join(d, 'state.json'), '{"schema":"x"}', 'utf8');
  await assert.rejects(readState(d), StateCorruptError);
  await assert.rejects(listOpenGates(d), StateCorruptError, '所有读取入口都不得回落成「无闸门」');
});

test('并发 setGate 不丢更新（经短临界区串行化，GLM-08）', async () => {
  const d = await tmp();
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      setGate({
        triviumDir: d, topic: `T${i}`, stage: 'plan',
        state: 'awaiting_approval', heartbeatStaleMs: STALE,
      }),
    ),
  );
  const s = await readState(d);
  assert.equal(Object.keys(s.gates).length, 8, `8 个并发写入应全部保留，实际 ${Object.keys(s.gates).length}`);
});

// ── shouldLockWrites：设计 §8.4 第 3 层 / 审核意见 RV-05 ──

test('本会话的 awaiting_approval 闸门 → 加锁', () => {
  const r = shouldLockWrites(entry(), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, true);
  assert.match(r.reason, /闸门未审批/);
});

test('运行中的闸门也加锁（就地模式下审查员正在读真实工作树）', () => {
  const r = shouldLockWrites(entry({ state: 'running' }), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, true);
  assert.match(r.reason, /双审进行中/);
});

test('其它会话的闸门 → 只提醒不加锁（RV-05：不锁死开发者的其它编辑）', () => {
  const r = shouldLockWrites(entry({ session_id: 'S-OTHER' }), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, false);
  assert.match(r.reason, /其它会话/);
});

test('scope=global 时不论会话都加锁', () => {
  const r = shouldLockWrites(entry({ session_id: 'S-OTHER' }), {
    currentSessionId: 'S-CURRENT', scope: 'global', ttlHours: 24,
  });
  assert.equal(r.lock, true);
});

test('超过 TTL 的闸门 → 不加锁', () => {
  const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
  const r = shouldLockWrites(entry({ since: old }), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, false);
  assert.match(r.reason, /TTL/);
});

test('已审批/已拒绝/已放弃的闸门 → 不加锁（三种结论均解除写锁）', () => {
  for (const st of ['approved', 'rejected', 'abandoned', 'idle'] as const) {
    const r = shouldLockWrites(entry({ state: st }), {
      currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
    });
    assert.equal(r.lock, false, `${st} 不应加锁`);
  }
});

test('review_done_awaiting_disposition 不加写锁（那是 hook-stop 的职责）', () => {
  const r = shouldLockWrites(entry({ state: 'review_done_awaiting_disposition' }), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, false, '裁决未完成应阻止收工，而不是锁住写入');
});

/*
 * 闸门未记录会话 id → **加锁**（保守方向）。
 *
 * 会话 id 只能靠 --session-id / CLAUDE_SESSION_ID 传入，而 Claude Code 不向 Bash 工具
 * 注入后者，skill 正常走一遍闸门几乎总是 null。原先把 null 判为「无法判定作用域，不加锁」，
 * 等于写锁在默认路径上从未生效（本仓库 state.json 三个真实闸门全是 null）。
 */
test('闸门未记录会话 id 时按本会话处理，照样加锁', () => {
  const r = shouldLockWrites(entry({ session_id: null }), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, true, 'null 无从证明是别人的会话，不能放过');
});

test('hook 自己也拿不到会话 id（两边都是 null）时同样加锁', () => {
  const r = shouldLockWrites(entry({ session_id: null }), {
    currentSessionId: null, scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, true);
});

test('无闸门 → 不加锁', () => {
  assert.equal(shouldLockWrites(null, { currentSessionId: 'S', scope: 'session', ttlHours: 24 }).lock, false);
});

test('闸门时间戳损坏 → 不加锁（宁可放过也不误伤）', () => {
  const r = shouldLockWrites(entry({ since: '不是时间' }), {
    currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24,
  });
  assert.equal(r.lock, false);
  assert.match(r.reason, /不可解析/);
});

// ── 条件迁移（审查意见 GLM-r2-01）──

test('expect.state 不匹配时不写入，并说明原因', async () => {
  const dir = await tmp();
  await setGate({ triviumDir: dir, topic: 't', stage: 'plan', state: 'running', runId: 'R1', heartbeatStaleMs: STALE });

  const r = await setGateChecked({
    triviumDir: dir, topic: 't', stage: 'plan', state: 'idle', runId: 'R1',
    heartbeatStaleMs: STALE, expect: { state: ['review_done_awaiting_disposition'] },
  });
  assert.equal(r.applied, false);
  assert.match(r.skipped ?? '', /当前状态为 running/);
  assert.equal((await getGate(dir, 't', 'plan'))!.state, 'running', '未匹配时原状态必须保持');
});

test('expect.runId 不匹配时不写入——新一轮的护栏不该被旧 run 清掉', async () => {
  const dir = await tmp();
  // 新一轮 R2 已接管
  await setGate({ triviumDir: dir, topic: 't', stage: 'plan', state: 'running', runId: 'R2', heartbeatStaleMs: STALE });

  // 旧 run R1 的收尾/取消试图把闸门清成 idle
  const r = await setGateChecked({
    triviumDir: dir, topic: 't', stage: 'plan', state: 'idle', runId: 'R1',
    heartbeatStaleMs: STALE, expect: { runId: 'R1' },
  });
  assert.equal(r.applied, false);
  assert.match(r.skipped ?? '', /闸门当前记着 run R2/);
  assert.equal((await getGate(dir, 't', 'plan'))!.state, 'running');
  assert.equal((await getGate(dir, 't', 'plan'))!.run_id, 'R2');
});

test('expect 匹配时正常写入', async () => {
  const dir = await tmp();
  await setGate({ triviumDir: dir, topic: 't', stage: 'plan', state: 'running', runId: 'R1', heartbeatStaleMs: STALE });
  const r = await setGateChecked({
    triviumDir: dir, topic: 't', stage: 'plan', state: 'idle', runId: 'R1',
    heartbeatStaleMs: STALE, expect: { state: ['running'], runId: 'R1' },
  });
  assert.equal(r.applied, true);
  assert.equal((await getGate(dir, 't', 'plan'))!.state, 'idle');
});

test('闸门不存在时默认放行——首次置 running 的槽位本来就是空的', async () => {
  const dir = await tmp();
  const ok = await setGateChecked({
    triviumDir: dir, topic: 't', stage: 'plan', state: 'running', runId: 'R1',
    heartbeatStaleMs: STALE, expect: { state: ['idle'] },
  });
  assert.equal(ok.applied, true);

  const dir2 = await tmp();
  const no = await setGateChecked({
    triviumDir: dir2, topic: 't', stage: 'plan', state: 'idle', runId: 'R1',
    heartbeatStaleMs: STALE, expect: { state: ['running'], allowMissing: false },
  });
  assert.equal(no.applied, false);
  assert.match(no.skipped ?? '', /闸门不存在/);
});

test('比较与写入在同一把锁内：并发的条件迁移只会成功一个', async () => {
  const dir = await tmp();
  await setGate({ triviumDir: dir, topic: 't', stage: 'plan', state: 'running', runId: 'R1', heartbeatStaleMs: STALE });

  // 两个都期望 running → 只该有一个真正翻转（check-then-act 会两个都成功）
  const results = await Promise.all([
    setGateChecked({
      triviumDir: dir, topic: 't', stage: 'plan', state: 'idle', runId: 'R1',
      heartbeatStaleMs: STALE, expect: { state: ['running'], runId: 'R1' },
    }),
    setGateChecked({
      triviumDir: dir, topic: 't', stage: 'plan', state: 'abandoned', runId: 'R1',
      heartbeatStaleMs: STALE, expect: { state: ['running'], runId: 'R1' },
    }),
  ]);
  assert.equal(results.filter((r) => r.applied).length, 1, '只该有一个成功翻转');
});
