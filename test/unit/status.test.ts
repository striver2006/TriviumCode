import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  newStatus, writeStatus, readStatus, patchStatus, interpretStatus,
  renderProgress, computeMaxWaits, statusPath, isTerminal, type RunStatus,
} from '../../src/trivium/status.js';
import { processStartTime } from '../../src/trivium/util/exec.js';

async function runDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trivium-status-'));
}
const STALE = 120_000;
const DEAD_PID = 2 ** 22;

function base(): RunStatus {
  return newStatus({
    runId: 'R1', topic: 't', stage: 'plan',
    sides: ['gemini', 'glm'],
    models: { gemini: 'gemini-3.1-pro-high', glm: 'GLM-5.3' },
  });
}

test('新建状态：两侧 pending，非终态', () => {
  const s = base();
  assert.equal(s.phase, 'starting');
  assert.equal(isTerminal(s.phase), false);
  assert.equal(s.sides.gemini?.state, 'pending');
  assert.equal(s.sides.glm?.model, 'GLM-5.3');
});

test('写入是原子替换，且每次刷新心跳', async () => {
  const d = await runDir();
  const s = base();
  const before = s.heartbeat_at;
  await new Promise((r) => setTimeout(r, 5));
  await writeStatus(d, s);
  assert.notEqual(s.heartbeat_at, before, '写入必须刷新心跳时间戳');
  const back = await readStatus(d);
  assert.equal(back?.run_id, 'R1');
});

test('patchStatus 读改写', async () => {
  const d = await runDir();
  await writeStatus(d, base());
  const s = await patchStatus(d, (x) => {
    x.phase = 'running';
    x.sides.gemini!.state = 'running';
    x.sides.gemini!.attempt = 1;
  });
  assert.equal(s?.phase, 'running');
  assert.equal((await readStatus(d))?.sides.gemini?.attempt, 1);
});

// ── GLM-06 的三种情形 ──

test('情形 A1：status.json 不存在但进程活着 → inconclusive，继续等', async () => {
  const d = await runDir();
  const r = await interpretStatus(d, {
    heartbeatStaleMs: STALE,
    fallbackPid: process.pid,
    fallbackPidStartedAt: await processStartTime(process.pid),
  });
  assert.equal(r.kind, 'inconclusive');
  if (r.kind === 'inconclusive') assert.equal(r.reason, 'no_status_file');
});

test('情形 A2：status.json 不存在且进程已死 → worker_lost', async () => {
  const d = await runDir();
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE, fallbackPid: DEAD_PID });
  assert.equal(r.kind, 'worker_lost');
  if (r.kind === 'worker_lost') assert.equal(r.reason, 'pid_gone');
});

test('情形 A3：连 pid 都不知道 → worker_lost，不无限等', async () => {
  const d = await runDir();
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE, fallbackPid: null });
  assert.equal(r.kind, 'worker_lost');
});

test('情形 A4：文件存在但内容撕裂 + 进程活着 → inconclusive（本次轮询无效）', async () => {
  const d = await runDir();
  await fs.writeFile(statusPath(d), '{"schema":"trivium.status.v1","run_id":"R1"'); // 半个 JSON
  const r = await interpretStatus(d, {
    heartbeatStaleMs: STALE,
    fallbackPid: process.pid,
    fallbackPidStartedAt: await processStartTime(process.pid),
  });
  assert.equal(r.kind, 'inconclusive');
  if (r.kind === 'inconclusive') assert.equal(r.reason, 'unparsable');
});

test('情形 B：终态直接返回，不再查进程', async () => {
  const d = await runDir();
  const s = base();
  s.phase = 'success';
  s.worker_pid = DEAD_PID; // 进程已退出是正常的
  s.exit_code = 0;
  await writeStatus(d, s);
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE });
  assert.equal(r.kind, 'terminal');
  if (r.kind === 'terminal') assert.equal(r.status.exit_code, 0);
});

test('情形 C1：非终态 + 心跳新鲜 + 进程活 → running', async () => {
  const d = await runDir();
  const s = base();
  s.phase = 'running';
  s.worker_pid = process.pid;
  s.worker_started_at = await processStartTime(process.pid);
  await writeStatus(d, s);
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE });
  assert.equal(r.kind, 'running');
});

test('情形 C2：非终态 + 进程没了 → worker_lost（即使心跳还新鲜）', async () => {
  const d = await runDir();
  const s = base();
  s.phase = 'running';
  s.worker_pid = DEAD_PID;
  await writeStatus(d, s);
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE });
  assert.equal(r.kind, 'worker_lost');
  if (r.kind === 'worker_lost') assert.equal(r.reason, 'pid_gone');
});

test('情形 C3：进程活着但心跳过期 → worker_lost（卡死在某处）', async () => {
  const d = await runDir();
  const s = base();
  s.phase = 'running';
  s.worker_pid = process.pid;
  s.worker_started_at = await processStartTime(process.pid);
  await writeStatus(d, s);
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE, now: Date.now() + 10 * STALE });
  assert.equal(r.kind, 'worker_lost');
  if (r.kind === 'worker_lost') assert.equal(r.reason, 'heartbeat_stale');
});

test('情形 C4：PID 被复用（启动时刻不符）→ worker_lost', async () => {
  const d = await runDir();
  const s = base();
  s.phase = 'running';
  s.worker_pid = process.pid;
  s.worker_started_at = 'Thu Jan  1 00:00:00 1970';
  await writeStatus(d, s);
  const r = await interpretStatus(d, { heartbeatStaleMs: STALE });
  assert.equal(r.kind, 'worker_lost');
});

// ── 其它 ──

test('进度摘要包含两侧状态、已用时与心跳新鲜度', () => {
  const s = base();
  s.phase = 'running';
  s.sides.gemini = { state: 'running', model: 'M1', attempt: 1, elapsed_s: 42 };
  s.sides.glm = { state: 'ok', model: 'M2', attempt: 1, elapsed_s: 120, note: '已完成' };
  const out = renderProgress(s);
  assert.match(out, /gemini: running/);
  assert.match(out, /第 1 次尝试/);
  assert.match(out, /glm: ok/);
  assert.match(out, /已完成/);
  assert.match(out, /最近心跳/);
});

test('max_waits 覆盖「单侧超时 × (1+重试)」并留 2 次余量', () => {
  // plan 900s、每次等 540s、重试 1 次 → 总 1800s → ceil(1800/540)=4 → +2 = 6
  assert.equal(computeMaxWaits(900, 540, 1), 6);
  // 不重试：900s → ceil(900/540)=2 → +2 = 4
  assert.equal(computeMaxWaits(900, 540, 0), 4);
  // code 阶段 1200s、重试 1 次 → 2400s → ceil(2400/540)=5 → +2 = 7
  assert.equal(computeMaxWaits(1200, 540, 1), 7);
});

test('max_waits 对异常入参不炸（除零保护）', () => {
  assert.ok(computeMaxWaits(900, 0, 1) > 0);
  assert.equal(computeMaxWaits(900, 540, -3), computeMaxWaits(900, 540, 0));
});
