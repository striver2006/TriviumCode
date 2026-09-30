import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  setGate, StateCorruptError,
  setGateChecked, getGate, listOpenGates, readState, shouldLockWrites, gateKey, type GateEntry,
  releaseRunningGateEntry,
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
  const N = 8;
  const t0 = Date.now();
  /*
   * EV-153（并发写闸门偶发红计划 r2 §3 D2）：失败文案带上每个写者的结局、最终闸门集合与回收告警。
   * 同进程的持有者永远是活着的本进程、内容完整：pid_reused / unparsable / pid_gone 回收告警任何一条都说明判定出错
   * （EV-173 的同进程形态，或取不到启动时刻被判复用）——它们正是两个写者同时读改写的入口。年龄回收（heartbeat_dead）
   * 在休眠唤醒等情形下是允许的，不进断言，只在文案里单列。
   */
  const reclaims: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    for (const line of s.split('\n')) if (line.includes('回收主题')) reclaims.push(line.trim());
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  let settled: PromiseSettledResult<number>[];
  try {
    settled = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        setGate({
          triviumDir: d, topic: `T${i}`, stage: 'plan',
          state: 'awaiting_approval', heartbeatStaleMs: STALE,
        }).then(() => Date.now() - t0),
      ),
    );
  } finally {
    process.stderr.write = origWrite;
  }
  const keys = Object.keys((await readState(d)).gates).sort();
  const expected = Array.from({ length: N }, (_, i) => `T${i}/plan`).sort();
  const reasonOf = (line: string): string => line.match(/原因 (\w+)/)?.[1] ?? '其他';
  const misjudged = reclaims.filter((l) => ['pid_reused', 'unparsable', 'pid_gone'].includes(reasonOf(l)));
  const aged = reclaims.filter((l) => reasonOf(l) === 'heartbeat_dead');
  const detail =
    '\n写者结局：\n' +
    settled
      .map((r, i) => {
        if (r.status === 'fulfilled') return `  T${i}：兑现（${r.value} ms）`;
        const e = r.reason as { code?: unknown; message?: unknown };
        return `  T${i}：拒绝（code ${String(e?.code ?? '?')}）${String(e?.message ?? r.reason)}`;
      })
      .join('\n') +
    `\n最终闸门（${keys.length}）：${keys.join('、') || '（空）'}` +
    `\n判定出错的回收告警（${misjudged.length}）：${misjudged.join(' / ') || '（无）'}` +
    `\n年龄回收告警（${aged.length}，允许）：${aged.join(' / ') || '（无）'}` +
    `\n其余回收告警：${reclaims.filter((l) => !misjudged.includes(l) && !aged.includes(l)).join(' / ') || '（无）'}` +
    `\n总用时 ${Date.now() - t0} ms`;
  assert.ok(settled.every((r) => r.status === 'fulfilled'), `有写者失败${detail}`);
  assert.deepEqual(keys, expected, `${N} 个并发写入应全部保留，实际 ${keys.length}${detail}`);
  assert.equal(misjudged.length, 0, `同进程写者不得把彼此的活锁当遗留锁回收${detail}`);
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

test('EV-129：加锁的两支 reason 只陈述状态，不带「不得……」后果句（后果由调用方拼）', () => {
  for (const state of ['running', 'awaiting_approval'] as const) {
    const r = shouldLockWrites(entry({ state }), { currentSessionId: 'S-CURRENT', scope: 'session', ttlHours: 24 });
    assert.equal(r.lock, true);
    assert.doesNotMatch(r.reason, /不得/, `${state}：${r.reason}`);
  }
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

// ── U1：releaseRunningGateEntry（闸门拦截不留骨架计划 r2 §3.2 / §4.1）──

test('U1 releaseRunningGateEntry：只回收仍记着本 runId 且仍是 running 的闸门，槽位不存在时不造条目，自身不抛', async () => {
  const dir = await tmp();
  const rel = (topic: string, runId: string) =>
    releaseRunningGateEntry({ triviumDir: dir, topic, stage: 'plan', runId, heartbeatStaleMs: STALE });

  // ① running + run 相符 ⇒ idle，run_id 保留
  await setGate({ triviumDir: dir, topic: 'a', stage: 'plan', state: 'running', runId: 'R1', heartbeatStaleMs: STALE });
  await rel('a', 'R1');
  assert.equal((await getGate(dir, 'a', 'plan'))?.state, 'idle');
  assert.equal((await getGate(dir, 'a', 'plan'))?.run_id, 'R1');

  // ② running 但记着别的 run ⇒ 不动（新一轮的护栏不该被旧 run 清掉）
  await setGate({ triviumDir: dir, topic: 'b', stage: 'plan', state: 'running', runId: 'R-NEW', heartbeatStaleMs: STALE });
  await rel('b', 'R-OLD');
  assert.equal((await getGate(dir, 'b', 'plan'))?.state, 'running');
  assert.equal((await getGate(dir, 'b', 'plan'))?.run_id, 'R-NEW');

  // ③ run 相符但已不是 running（例如已被收尾推进）⇒ 不动
  await setGate({
    triviumDir: dir, topic: 'c', stage: 'plan', state: 'review_done_awaiting_disposition', runId: 'R1', heartbeatStaleMs: STALE,
  });
  await rel('c', 'R1');
  assert.equal((await getGate(dir, 'c', 'plan'))?.state, 'review_done_awaiting_disposition');

  // ④ 槽位不存在 ⇒ 不凭空造一条 idle
  await rel('d', 'R1');
  assert.equal(await getGate(dir, 'd', 'plan'), null);

  // ⑤ 闸门状态文件读不出 ⇒ 不抛（回收失败不盖过调用方手里真正的错误）
  const bad = await tmp();
  await fs.writeFile(path.join(bad, 'state.json'), '{坏了', 'utf8');
  await releaseRunningGateEntry({ triviumDir: bad, topic: 'a', stage: 'plan', runId: 'R1', heartbeatStaleMs: STALE });
});
