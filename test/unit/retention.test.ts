import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pruneRunDirs } from '../../src/trivium/retention.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { repoId } from '../../src/trivium/review.js';
import { newStatus, writeStatus } from '../../src/trivium/status.js';
import { processStartTime } from '../../src/trivium/util/exec.js';
import { wiredAdapter } from '../../src/trivium/adapters/index.js';
import { readScrubSentinel } from '../../src/trivium/scrub.js';
import { TOOL_TRACE_CAPABILITY, failedResult, type CriticAdapter } from '../../src/trivium/adapters/base.js';

const DAY = 86_400_000;

async function bucket() {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ret-'));
  const projectRoot = '/tmp/some-project';
  const cfg = defaultConfig();
  cfg.runtime.run_root = runRoot;
  const b = path.join(runRoot, repoId(projectRoot));
  await fs.mkdir(b, { recursive: true });
  return { cfg, projectRoot, b };
}

/** 把目录连同 status.json 的心跳一起「变老」：writeStatus 每次都会把 heartbeat_at 刷成现在 */
async function age(dir: string, days: number) {
  const t = new Date(Date.now() - days * DAY);
  const sp = path.join(dir, 'status.json');
  try {
    const s = JSON.parse(await fs.readFile(sp, 'utf8')) as { heartbeat_at: string };
    s.heartbeat_at = t.toISOString();
    await fs.writeFile(sp, JSON.stringify(s), 'utf8');
  } catch { /* 没有 status.json 的残留目录 */ }
  for (const f of await fs.readdir(dir)) await fs.utimes(path.join(dir, f), t, t);
  await fs.utimes(dir, t, t);
}

test('超过 run_dir_days 的终态运行目录被删，新的保留', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const old = path.join(b, 'R-old');
  const fresh = path.join(b, 'R-fresh');
  for (const d of [old, fresh]) {
    await fs.mkdir(d);
    const s = newStatus({ runId: path.basename(d), topic: 't', stage: 'plan', sides: [], models: {} });
    s.phase = 'success';
    await writeStatus(d, s);
  }
  await age(old, 40);
  const r = await pruneRunDirs(cfg, projectRoot);
  assert.deepEqual(r.removed, [old]);
  assert.equal(r.kept, 1);
  await assert.rejects(fs.access(old));
  await fs.access(fresh);
});

test('仍在跑的运行（worker 活着）无论多老都不动', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const d = path.join(b, 'R-running');
  await fs.mkdir(d);
  const s = newStatus({ runId: 'R-running', topic: 't', stage: 'plan', sides: [], models: {} });
  s.phase = 'running';
  s.worker_pid = process.pid;
  s.worker_started_at = await processStartTime(process.pid);
  await writeStatus(d, s);
  await age(d, 90);
  const r = await pruneRunDirs(cfg, projectRoot);
  assert.deepEqual(r.removed, []);
  await fs.access(d);
});

test('没有 status.json 的残留目录按 mtime 处理；run_dir_days 为 0 时不清理', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const junk = path.join(b, 'R-junk');
  await fs.mkdir(junk);
  await age(junk, 60);
  cfg.retention.run_dir_days = 0;
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot)).removed, []);
  cfg.retention.run_dir_days = 30;
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot, { dryRun: true })).removed, [junk]);
  await fs.access(junk, undefined);
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot)).removed, [junk]);
});

test('只清本项目的桶，别的项目的运行目录不碰', async () => {
  const { cfg, projectRoot } = await bucket();
  const other = path.join(cfg.runtime.run_root, 'other-project-deadbeef', 'R1');
  await fs.mkdir(other, { recursive: true });
  await age(other, 100);
  await pruneRunDirs(cfg, projectRoot);
  await fs.access(other);
});

// ── 挂载点 ④：未到期目录的凭据抹除（EV-20；计划双审 CODEX-04 / CODEX-05 ≡ AGY-04）──

/** 造一个带 zcode 侧凭据副本的运行目录；phase 为 null 表示不写 status.json */
async function runDirWith(b: string, name: string, phase: 'success' | 'running' | 'starting' | null, pid: number | null = null) {
  const d = path.join(b, name);
  const carrier = path.join(d, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  await fs.mkdir(path.join(d, 'glm', 'out'), { recursive: true });
  if (phase) {
    const s = newStatus({ runId: name, topic: 't', stage: 'plan', sides: ['glm'], models: {} });
    s.phase = phase;
    if (pid !== null) {
      s.worker_pid = pid;
      s.worker_started_at = await processStartTime(pid);
    }
    await writeStatus(d, s);
  }
  return { d, carrier };
}

test('终态且未到期的目录：抹凭据副本、目录本身保留、哨兵落盘', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const { d, carrier } = await runDirWith(b, 'R-done', 'success');
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.removed, [], '未到期不删目录');
  assert.deepEqual(r.scrubbed, [d]);
  await assert.rejects(fs.access(carrier), '副本必须被抹');
  await fs.access(d);
  assert.equal((await readScrubSentinel(path.join(d, 'glm')))?.ok, true);

  // 第二次：哨兵已记 ok，不再计入 scrubbed
  const again = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(again.scrubbed, []);
  assert.deepEqual(again.scrubFailed, []);
});

test('run_dir_days 为 0 时整删关闭，凭据抹除照跑（安全底线不挂在可关的档位上，CODEX-04）', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const { carrier } = await runDirWith(b, 'R-done', 'success');
  cfg.retention.run_dir_days = 0;
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.removed, []);
  assert.equal(r.scrubbed.length, 1);
  await assert.rejects(fs.access(carrier));
});

test('worker 活着的运行：不抹（它还要用那份副本）', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const { carrier } = await runDirWith(b, 'R-live', 'running', process.pid);
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.scrubbed, []);
  await fs.access(carrier);
});

test('终态但进程还活着：不抹（AGY-01——waitRun 判 heartbeat_stale 时正是把活进程写成 failed）', async () => {
  /*
   * 这一条是 r1 修复自己捅开的闭环：`waitRun` 在心跳过期时把 phase 落成 `failed`（终态）并
   * 承诺「留给会话启动清扫」，而清扫此前对终态目录**根本不查进程**——承诺于是变成
   * 「下次会话启动无条件抹」。判据现在统一到 `workerConfirmedGone`：终态也要看进程。
   */
  const { cfg, projectRoot, b } = await bucket();
  const { d, carrier } = await runDirWith(b, 'R-failed-but-alive', 'success', process.pid);
  // 把它改成 waitRun 写出来的那种终态：failed + 仍然活着的 pid
  const sp = path.join(d, 'status.json');
  const s = JSON.parse(await fs.readFile(sp, 'utf8')) as { phase: string; message: string };
  s.phase = 'failed';
  s.message = 'worker_lost（heartbeat_stale）';
  await fs.writeFile(sp, JSON.stringify(s), 'utf8');

  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.scrubbed, [], '进程还在用那份副本，终态也不能抹');
  await fs.access(carrier);
});

test('status.json 读不到（缺失或损坏）：不做不可逆抹除，计入 unknown（CODEX-05）', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const missing = await runDirWith(b, 'R-nostatus', null);
  const corrupt = await runDirWith(b, 'R-corrupt', null);
  await fs.writeFile(path.join(corrupt.d, 'status.json'), '{"phase": "succ', 'utf8');
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.scrubbed, []);
  assert.deepEqual(r.unknown.sort(), [corrupt.d, missing.d].sort());
  await fs.access(missing.carrier);
  await fs.access(corrupt.carrier);
});

test('starting（worker_pid 尚为 null 的拉起瞬间）：不抹（AGY-04）', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const { carrier } = await runDirWith(b, 'R-starting', 'starting');
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.scrubbed, []);
  assert.deepEqual(r.unknown, []);
  await fs.access(carrier);
});

test('非终态但 worker 已死（pid 不存在）：抹', async () => {
  const { cfg, projectRoot, b } = await bucket();
  // 找一个大概率不存在的 pid
  let dead = 99_999;
  while (true) {
    try { process.kill(dead, 0); dead--; } catch { break; }
  }
  const { d, carrier } = await runDirWith(b, 'R-dead', 'running', dead);
  // processStartTime 对不存在的 pid 返回 null，status 里 worker_started_at 为 null 即可
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.scrubbed, [d]);
  await assert.rejects(fs.access(carrier));
});

test('只有真抹了东西才计入 scrubbed：无载体、无命中的目录不报「已抹除」（GLM-05）', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const d = path.join(b, 'R-empty');
  await fs.mkdir(path.join(d, 'gemini', 'out'), { recursive: true });
  await fs.writeFile(path.join(d, 'gemini', 'out', 'stdout.jsonl'), '{}\n');
  const s = newStatus({ runId: 'R-empty', topic: 't', stage: 'plan', sides: ['gemini'], models: {} });
  s.phase = 'success';
  await writeStatus(d, s);
  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(r.scrubbed, [], 'agy 无副本、日志无命中：「没得抹」不能长得像「抹过了」');
  assert.deepEqual(r.scrubFailed, []);
  assert.equal((await readScrubSentinel(path.join(d, 'gemini')))?.ok, true, '哨兵照写，下次会话不再重扫');
});

test('抹除失败进 scrubFailed 并带原因；dryRun 与不传 adapters 都不抹', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const { d, carrier } = await runDirWith(b, 'R-fail', 'success');
  const throwing: CriticAdapter = {
    critic: 'glm', capability: TOOL_TRACE_CAPABILITY, availability: () => ({ ok: true }),
    async run() { return failedResult('glm', { status: 'failed', reason: 'unused' }); },
    async scrubRunDir() { throw new Error('EPERM 模拟'); },
  };
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot)).scrubbed, [], '不传 adapters：旧调用形态，行为不变');
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter, dryRun: true })).scrubbed, []);
  await fs.access(carrier);

  const r = await pruneRunDirs(cfg, projectRoot, { adapters: () => throwing });
  assert.equal(r.scrubFailed.length, 1);
  assert.equal(r.scrubFailed[0]?.dir, d);
  assert.match(r.scrubFailed[0]!.reason, /EPERM 模拟/);
  assert.equal((await readScrubSentinel(path.join(d, 'glm')))?.ok, false, 'ok:false 让下次清扫重试');
});
