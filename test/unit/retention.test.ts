import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pruneRunDirs, scrubAllRunRoot } from '../../src/trivium/retention.js';
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
    critic: 'glm', capability: TOOL_TRACE_CAPABILITY, commandExecution: 'none', availability: () => ({ ok: true }),
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

// ── 跨仓清扫（BACKLOG EV-33）──

/**
 * 造一个含两个项目桶的运行根。EV-33 的整条缺口就长在「桶」这一级上：
 * 会话启动清扫只进本项目那一个桶，别的桶要等它自己再开一次会话。
 */
async function twoBuckets() {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-sweep-'));
  const cfg = defaultConfig();
  cfg.runtime.run_root = runRoot;
  const mine = path.join(runRoot, repoId('/tmp/project-a'));
  const other = path.join(runRoot, repoId('/tmp/project-b'));
  for (const b of [mine, other]) await fs.mkdir(b, { recursive: true });
  return { cfg, runRoot, mine, other, projectRoot: '/tmp/project-a' };
}

test('scrubAllRunRoot：别的项目桶里的凭据副本也抹，而会话启动清扫碰不到它们（EV-33）', async () => {
  const { cfg, mine, other, projectRoot } = await twoBuckets();
  const a = await runDirWith(mine, 'R-a', 'success');
  const b = await runDirWith(other, 'R-b', 'success');

  // 先复现缺口本身：本项目的清扫只抹自己桶里的那份
  const pruned = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
  assert.deepEqual(pruned.scrubbed, [a.d]);
  await fs.access(b.carrier);

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  assert.deepEqual(r.scrubbed, [b.d], 'a 的哨兵已记 ok，本轮只剩 b 要抹');
  await assert.rejects(fs.access(b.carrier), '别的仓库遗留的载体要被抹掉');
  assert.equal(r.buckets.length, 2);
  assert.equal(r.visited, 2);
  assert.deepEqual(r.scrubFailed, []);
  await fs.access(a.d);
  await fs.access(b.d);
});

test('scrubAllRunRoot：只抹凭据，一个目录都不删——整删是 run_dir_days 的职责且按项目划界', async () => {
  const { cfg, mine, other } = await twoBuckets();
  const a = await runDirWith(mine, 'R-a', 'success');
  const b = await runDirWith(other, 'R-b', 'success');
  // 造成「早就该整删」的年纪：本函数仍不得删它
  for (const d of [a.d, b.d]) await age(d, 400);

  await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  await fs.access(a.d);
  await fs.access(b.d);
});

test('scrubAllRunRoot：status 读不到的目录跳过并计数，不做不可逆抹除', async () => {
  const { cfg, other } = await twoBuckets();
  const { d, carrier } = await runDirWith(other, 'R-nostatus', null);

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  assert.deepEqual(r.unknown, [d], '读不到状态就没有证据说它已跑完，而抹除不可逆');
  assert.deepEqual(r.scrubbed, []);
  await fs.access(carrier);
});

test('scrubAllRunRoot：worker 现势活着的运行不动', async () => {
  const { cfg, other } = await twoBuckets();
  const { carrier } = await runDirWith(other, 'R-live', 'running', process.pid);

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  assert.equal(r.alive, 1);
  assert.deepEqual(r.scrubbed, []);
  await fs.access(carrier);
});

test('scrubAllRunRoot：--dry-run 列出「本会抹」但盘上什么都不动', async () => {
  const { cfg, mine, other } = await twoBuckets();
  const a = await runDirWith(mine, 'R-a', 'success');
  const b = await runDirWith(other, 'R-b', 'success');
  const nostatus = await runDirWith(other, 'R-nostatus', null);

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter, dryRun: true });

  assert.deepEqual([...r.eligible].sort(), [a.d, b.d].sort());
  assert.deepEqual(r.unknown, [nostatus.d], '预览也走一遍准入判据，读不到状态的不能算进「本会抹」');
  assert.deepEqual(r.scrubbed, []);
  for (const c of [a.carrier, b.carrier, nostatus.carrier]) await fs.access(c);
});

test('pruneRunDirs：运行目录那一层跳过了文件，也要计入 incomplete', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const { d } = await runDirWith(b, 'R-big', 'success');
  // 交接包大到过不了扫描上限：那一层没有哨兵，不在这里报就没有第二次机会
  await fs.writeFile(path.join(d, 'request.json'), `{"x":"${'y'.repeat(4096)}"}`, 'utf8');

  const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter, sizeCap: 1024 });

  assert.deepEqual(r.incomplete.map((x) => x.dir), [d]);
  // 那一层不写哨兵，指着 scrub.json 会一无所获——所以取证细节必须随计数一起带出来
  assert.match(r.incomplete[0]!.detail!, /request\.json/);
});

test('scrubAllRunRoot：预览的「本会抹」与真跑的跳过判据同源，不把已收工的目录算进去', async () => {
  const { cfg, mine, other } = await twoBuckets();
  const done = await runDirWith(mine, 'R-done', 'success');
  const todo = await runDirWith(other, 'R-todo', 'success');
  // 先把 done 抹掉一轮，让它的侧层哨兵收工
  await scrubAllRunRoot(cfg, { adapters: wiredAdapter, dryRun: false, sizeCap: undefined });
  await assert.rejects(fs.access(done.carrier));
  await assert.rejects(fs.access(todo.carrier));

  // 再造一份新的待抹载体，只在 todo 那一侧
  await fs.writeFile(todo.carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  await fs.rm(path.join(todo.d, 'glm', 'scrub.json'), { force: true });

  const preview = await scrubAllRunRoot(cfg, { adapters: wiredAdapter, dryRun: true });
  assert.deepEqual(preview.eligible, [todo.d], '已收工的不能算进「本会抹」——那会让预览报一个真跑不成立的数');
  assert.equal(preview.settled, 1);

  const real = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });
  assert.deepEqual(real.scrubbed, [todo.d], '真跑抹的正是预览列出的那一批');
  assert.deepEqual(real.eligible, preview.eligible, '两条路径填同一格，取的是同一条判据');
});

// ── 代码双审 r1 修复：分档闭合与桶级记账 ──

test('scrubAllRunRoot：准入未过而 status 读得到的目录进 deferred，不再哪一格都不进（GLM-04）', async () => {
  const { cfg, other } = await twoBuckets();
  // starting：worker_pid 尚为 null 的拉起瞬间，副本可能正在写下
  const { d, carrier } = await runDirWith(other, 'R-starting', 'starting');

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  assert.deepEqual(r.deferred, [d], 'starting 类此前不计 alive、不计 unknown、也不进 eligible/settled');
  assert.deepEqual(r.unknown, [], 'status 读得到，不该混进「读不到」那一格');
  assert.equal(r.alive, 0);
  assert.deepEqual(r.scrubbed, []);
  await fs.access(carrier, );
  // 账目闭合：看过的每个目录都落进恰好一格
  assert.equal(r.visited, r.alive + r.deferred.length + r.unknown.length + r.eligible.length + r.settled);
});

test('scrubAllRunRoot：项目桶读不了要记账，不能整棵静默跳过（CODEX-01）', async () => {
  const { cfg, runRoot, mine } = await twoBuckets();
  await runDirWith(mine, 'R-a', 'success');
  // 桶位置上放一个普通文件：readdir 会 ENOTDIR，走的正是那条 catch
  const brokenBucket = path.join(runRoot, 'broken-bucket');
  await fs.mkdir(brokenBucket);
  await fs.chmod(brokenBucket, 0o000);

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  try {
    assert.deepEqual(r.unreadableBuckets.map((x) => x.bucket), ['broken-bucket']);
    assert.ok(r.unreadableBuckets[0]!.reason.length > 0, '要带上原因，否则人读行没法排查');
    assert.ok(!r.buckets.includes('broken-bucket'), '没进论域的桶不该算进「扫过的桶」');
  } finally {
    await fs.chmod(brokenBucket, 0o700); // 让临时目录还能被清掉
  }
});

test('scrubAllRunRoot：只脱敏了交接包的目录进 runDirRedacted 而非 scrubbed（GLM-06）', async () => {
  const { cfg, other } = await twoBuckets();
  const { d, carrier } = await runDirWith(other, 'R-onlyreq', 'success');
  // 先抹一轮，让侧层哨兵收工、载体清零
  await scrubAllRunRoot(cfg, { adapters: wiredAdapter });
  await assert.rejects(fs.access(carrier));

  // 再往运行目录那一层放一份含凭据的交接包：那层没有哨兵，每轮都复查
  await fs.writeFile(path.join(d, 'request.json'), '{"brief_text":"apiKey = \\"' + 'Qx7mZp2Lk9Rt4Wv1Ab3Cd5Ef7Gh9Jk2M' + '\\""}', 'utf8');

  const r = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });

  assert.deepEqual(r.scrubbed, [], '一份凭据载体都没抹，不能报成「已抹除凭据副本」');
  assert.deepEqual(r.runDirRedacted, [d]);
  assert.equal(r.settled, 1, '侧层确实已收工');
  assert.ok(!(await fs.readFile(path.join(d, 'request.json'), 'utf8')).includes('Qx7mZp2L'), '交接包仍要被脱敏');
});

// ── EV-154 / EV-38：准入还要核审查员 CLI 的进程组记录（CLI进程组记录计划 r2 §4.5、§5.1 U14）──

const CLI_MARK = `trivium-u14-${process.pid}-${Date.now()}`;

/** 起一个 detached 的活进程组（sh + sleep），返回组号、规范化启动时刻与结束函数 */
async function liveCliGroup(tag: string) {
  const { spawn } = await import('node:child_process');
  const child = spawn('/bin/sh', ['-c', 'sleep 600; : "$0"', `${CLI_MARK}-${tag}`], { detached: true, stdio: 'ignore' });
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  const pgid = child.pid!;
  const startedAt = await processStartTime(pgid, { canonical: true });
  return {
    pgid,
    startedAt,
    stop: async () => {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        /* 已不在 */
      }
      await exited;
    },
  };
}

/** 给终态目录的 glm 侧写一条 CLI 记录（worker_pid 为 null：终态且从未记下 pid ⇒ workerConfirmedGone 放行） */
async function withCliRecord(d: string, cli: unknown) {
  const sp = path.join(d, 'status.json');
  const s = JSON.parse(await fs.readFile(sp, 'utf8')) as { sides: Record<string, Record<string, unknown>> };
  s.sides['glm']!['cli'] = cli;
  await fs.writeFile(sp, JSON.stringify(s), 'utf8');
}

test('EV-154 U14：记录里的 CLI 组还活着 ⇒ 会话启动清扫与 trivium scrub 都不抹、计入 deferred；组结束后再跑即抹', async () => {
  const g = await liveCliGroup('a');
  try {
    const { cfg, projectRoot, b } = await bucket();
    const { d, carrier } = await runDirWith(b, 'R-cli-alive', 'success');
    await withCliRecord(d, { pgid: g.pgid, started_at: g.startedAt });

    const p = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
    assert.deepEqual(p.scrubbed, [], 'CLI 还在用那份副本');
    assert.deepEqual(p.deferred, [d]);
    assert.equal(p.deferredCli.length, 1, '第四格单列并带成因（代码双审 r1 CODEX-01）');
    assert.equal(p.deferredCli[0]!.dir, d);
    assert.match(p.deferredCli[0]!.detail, new RegExp(`glm 侧审查员 CLI 进程组 ${g.pgid} 仍在`));
    await fs.access(carrier);

    const s = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });
    assert.deepEqual(s.scrubbed, []);
    assert.deepEqual(s.deferred, [d]);
    await fs.access(carrier);

    await g.stop();
    const again = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
    assert.deepEqual(again.scrubbed, [d], '组长不在了即放行');
    await assert.rejects(fs.access(carrier));
  } finally {
    await g.stop();
  }
});

test('EV-154 U14：判不了（启动时刻没记下且组长还在）与记录读不懂（计划双审 r1 GLM-02）都不抹；启动时刻不符（组号已被复用）放行', async () => {
  const g = await liveCliGroup('b');
  try {
    const { cfg, projectRoot, b } = await bucket();
    const unv = await runDirWith(b, 'R-cli-unverifiable', 'success');
    await withCliRecord(unv.d, { pgid: g.pgid, started_at: null });
    const bad = await runDirWith(b, 'R-cli-malformed', 'success');
    await withCliRecord(bad.d, { pgid: 'not-a-number' });
    const reused = await runDirWith(b, 'R-cli-reused', 'success');
    await withCliRecord(reused.d, { pgid: g.pgid, started_at: 'Thu Jan  1 00:00:00 1970' });

    const r = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
    assert.deepEqual([...r.deferred].sort(), [unv.d, bad.d].sort());
    const why = Object.fromEntries(r.deferredCli.map((x) => [x.dir, x.detail]));
    assert.match(why[unv.d] ?? '', /判不了/);
    assert.match(why[bad.d] ?? '', /读不懂（glm：\{"pgid":"not-a-number"\}）/, '形状坏的带原始值（代码双审 r1 CODEX-04）');
    assert.deepEqual(r.scrubbed, [reused.d], '组号已是别的进程：原来那组已不在');
    await fs.access(unv.carrier);
    await fs.access(bad.carrier);
    await assert.rejects(fs.access(reused.carrier));
  } finally {
    await g.stop();
  }
});
