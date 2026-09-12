import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  newStatus, writeStatus, readStatus, patchStatus, interpretStatus,
  renderProgress, renderProgressBrief, fmtDuration, computeMaxWaits, statusPath, isTerminal,
  type ProgressBudget, type RunStatus,
} from '../../src/trivium/status.js';
import { processStartTime } from '../../src/trivium/util/exec.js';

async function runDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trivium-status-'));
}
const STALE = 120_000;
const DEAD_PID = 2 ** 22;
/** code 阶段 2700s、窗口 180s、重试 1 次 → maxWaits = ceil(5400/180)+2 = 32 */
const BUDGET: ProgressBudget = { stageTimeoutS: 2700, waitTimeoutS: 180, maxWaits: 32 };

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

test('同进程并发 patchStatus 串行化：心跳不会把终态回滚成 running', async () => {
  const dir = await runDir();
  await writeStatus(dir, base());
  /*
   * worker 里心跳定时器与终态写入在同一个事件循环里交错：心跳在终态写入前读、
   * 之后写，终态就被回滚。两者同进程，一条 promise 链即可消掉窗口。
   */
  await Promise.all([
    patchStatus(dir, (s) => { s.phase = 'success'; s.exit_code = 0; }),
    patchStatus(dir, () => {}), // 心跳
    patchStatus(dir, (s) => { s.artifacts.push('a'); }),
    patchStatus(dir, () => {}),
  ]);
  const s = await readStatus(dir);
  assert.equal(s?.phase, 'success', '终态不得被并发的心跳回滚');
  assert.deepEqual(s?.artifacts, ['a']);
});

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
  s.sides.glm = { state: 'ok', model: 'M2', attempt: 1, elapsed_s: 120, note: '收尾' };
  const out = renderProgress(s);
  assert.match(out, /gemini: 审查中/);
  assert.match(out, /第 1 次尝试/);
  assert.match(out, /glm: 已完成/);
  assert.match(out, /收尾/);
  assert.match(out, /最近心跳/);
  // 不传 budget 时退回老输出：不得出现期待值字段，既有调用方不受影响
  assert.doesNotMatch(out, /预算/);
  assert.doesNotMatch(out, /次等待/);
});

// ── 等待期进度反馈（FR-26 / AC-19）──

test('传入 budget 时补出期待值：预算、百分比、第几次等待', () => {
  const s = base();
  s.phase = 'running';
  s.started_at = new Date(Date.now() - 612_000).toISOString(); // 已用 612s
  s.sides.gemini = { state: 'ok', model: 'M1', attempt: 1, elapsed_s: 340 };
  s.sides.glm = { state: 'running', model: 'M2', attempt: 1, elapsed_s: 612 };
  const out = renderProgress(s, Date.now(), BUDGET);
  assert.match(out, /已用 10m12s \/ 预算 45m0s（23%）/);
  // 612 / 180 = 3.4 → 第 4 次；从 1 起算
  assert.match(out, /第 4\/32 次等待/);
  assert.match(out, /阶段状态 审查中/);
});

test('waits_done 从 1 起算，并在窗口边界进位', () => {
  const s = base();
  s.phase = 'running';
  // elapsed 为 0：人在等的是「第 1 次」，不是「第 0 次」
  assert.match(renderProgress(s, Date.now(), BUDGET), /第 1\/32 次等待/);
  s.started_at = new Date(Date.now() - 180_000).toISOString();
  assert.match(renderProgress(s, Date.now(), BUDGET), /第 2\/32 次等待/);
});

test('超出单阶段预算时不显示百分比，改说重试收尾', () => {
  const s = base();
  s.phase = 'running';
  s.started_at = new Date(Date.now() - 3000_000).toISOString(); // 3000s > 2700s
  s.sides.glm = { state: 'running', model: 'M2', attempt: 2, elapsed_s: 3000 };
  const out = renderProgress(s, Date.now(), BUDGET);
  assert.match(out, /已超单次预算 · 重试收尾中（第 2 次尝试）/);
  assert.doesNotMatch(out, /%/);
});

test('brief 是单行摘要，含阶段、时间段与两侧状态', () => {
  const s = base();
  s.phase = 'running';
  s.started_at = new Date(Date.now() - 612_000).toISOString();
  s.sides.gemini = { state: 'ok', model: 'M1', attempt: 1, elapsed_s: 340 };
  s.sides.glm = { state: 'running', model: 'M2', attempt: 1, elapsed_s: 612 };
  const brief = renderProgressBrief(s, Date.now(), BUDGET);
  assert.equal(brief.includes('\n'), false, 'brief 必须是单行');
  assert.match(brief, /gemini 已完成 · glm 审查中/);
  assert.match(brief, /已用 10m12s \/ 预算 45m0s（23%）/);
  assert.ok([...brief].length <= 60, `brief 应控制在 60 字以内，实际 ${[...brief].length}：${brief}`);
});

test('时钟回拨：elapsed 为负时钳到 0，不渲染负百分比或「第 0 次」', () => {
  const s = base();
  s.phase = 'running';
  // started_at 落在 now 之后（NTP 校正）
  s.started_at = new Date(Date.now() + 30_000).toISOString();
  const out = renderProgress(s, Date.now(), BUDGET);
  assert.doesNotMatch(out, /（-\d+%）/, '不得出现负百分比');
  assert.doesNotMatch(out, /第 0\//, '不得出现「第 0 次」');
  assert.match(out, /已用 0s/);
  assert.match(out, /第 1\/32 次等待/);
  assert.match(out, /（0%）/);
});

test('时长渲染：不足一分钟按秒，超过则分秒', () => {
  assert.equal(fmtDuration(45), '45s');
  assert.equal(fmtDuration(612), '10m12s');
  assert.equal(fmtDuration(60), '1m0s');
  assert.equal(fmtDuration(-5), '0s');
});

test('max_waits 覆盖「单侧超时 × (1+重试)」并留 2 次余量', () => {
  // plan 900s、每次等 540s、重试 1 次 → 总 1800s → ceil(1800/540)=4 → +2 = 6
  assert.equal(computeMaxWaits(900, 540, 1), 6);
  // 不重试：900s → ceil(900/540)=2 → +2 = 4
  assert.equal(computeMaxWaits(900, 540, 0), 4);
  // code 阶段 1200s、重试 1 次 → 2400s → ceil(2400/540)=5 → +2 = 7
  assert.equal(computeMaxWaits(1200, 540, 1), 7);
});

test('窗口收窄到 180s 后 max_waits 自适应（本项目 timeout_s 覆盖值）', () => {
  // code 2700s × 2 ÷ 180 = 30 → +2 = 32
  assert.equal(computeMaxWaits(2700, 180, 1), 32);
  // plan 1500s × 2 ÷ 180 = ceil(16.67)=17 → +2 = 19
  assert.equal(computeMaxWaits(1500, 180, 1), 19);
});

test('max_waits 对异常入参不炸（除零保护）', () => {
  assert.ok(computeMaxWaits(900, 0, 1) > 0);
  assert.equal(computeMaxWaits(900, 540, -3), computeMaxWaits(900, 540, 0));
});
