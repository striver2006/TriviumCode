import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run, processAlive, spawnDetached } from '../../src/trivium/util/exec.js';
import { inspectLock, acquireLock } from '../../src/trivium/lock.js';

/**
 * 跨进程抢锁竞态（BACKLOG M21 的最后一项）。
 *
 * 已有的并发用例（test/unit/lock.test.ts）全是**同进程** `Promise.all`——它们只在
 * 一个事件循环里于 await 点交错，证明不了真正的互斥原语成立：
 *   - 互斥靠的是 `fs.link` 在目标已存在时原子失败（EEXIST），这是**系统调用层**的竞争，
 *     同进程并发根本走不到多个 OS 进程同时 link 同一路径的那个点；
 *   - `judgeStale` 的 `pid_gone` 判据要对**真的已经不存在的 PID** 成立，而同进程用例
 *     只能拿 `pid: 2 ** 22` 这样的假 PID 顶替；
 *   - `withTopicLock` 要防的「丢更新」是两个**独立进程**读改写同一个文件，
 *     同进程里 JS 的单线程语义本身就帮着挡掉了一部分。
 *
 * 所以这一组必须起真进程。
 */

/** 本测试文件编译后位于 dist/test/test/integration/，据此定位同构的 src 产物 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK_MODULE = path.resolve(HERE, '../../src/trivium/lock.js');

const STALE_MS = 120_000;
const TOPIC = '跨进程抢锁';

async function tmpTrivium(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-xproc-'));
  // macOS 的 /var 是 /private/var 的符号链接，realpath 一下免得路径比对失配
  return fs.realpath(raw);
}

/**
 * 起 N 个进程同时跑同一段 worker 脚本，用「共同的起跑时刻」做屏障。
 *
 * 不用文件信号做屏障：那本身就是一次文件系统往返，会把竞争窗口抹平。
 * 传一个未来的绝对时刻，各进程自旋到那一刻再同时动手，窗口才够窄。
 */
async function raceWorkers(
  dir: string,
  body: string,
  count: number,
  leadMs = 700,
): Promise<Array<Record<string, unknown>>> {
  const script = path.join(dir, 'worker.mjs');
  await fs.writeFile(
    script,
    `const LOCK = ${JSON.stringify(LOCK_MODULE)};
     const [dir, startAtRaw, idRaw] = process.argv.slice(2);
     const startAt = Number(startAtRaw);
     const id = Number(idRaw);
     const lock = await import(LOCK);
     // 自旋到共同起跑时刻，让 N 个进程真的挤在同一瞬间
     while (Date.now() < startAt) {}
     let out;
     try {
       out = await (async () => { ${body} })();
     } catch (e) {
       out = { ok: false, code: e && e.code, message: String(e && e.message) };
     }
     process.stdout.write(JSON.stringify({ id, ...out }) + '\\n');
     process.exit(0);`,
    'utf8',
  );

  const startAt = Date.now() + leadMs;
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      run(process.execPath, [script, dir, String(startAt), String(i)], {
        cwd: dir,
        timeoutMs: 60_000,
      }),
    ),
  );

  return results.map((r, i) => {
    const line = r.stdout.trim().split('\n').filter(Boolean).pop();
    assert.ok(line, `worker ${i} 没有输出结果行；stderr=${r.stderr}`);
    // `__stderr`：各进程的 stderr 原文（EV-161 X1 / X2 查回收告警用；其余用例不读它）
    return { ...(JSON.parse(line) as Record<string, unknown>), __stderr: r.stderr };
  });
}

test('跨进程：N 个独立进程同抢一把锁，有且只有一个拿到', async () => {
  const dir = await tmpTrivium();

  /*
   * 赢家拿到后要**持有一会儿**再释放，否则它可能在别人还没 link 之前就已经 release，
   * 于是出现两个赢家——那不是竞态失败，是用例自己没构造好。
   */
  const results = await raceWorkers(
    dir,
    `const h = await lock.acquireLock({
       triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, runId: 'R-' + id,
       kind: 'run', heartbeatStaleMs: ${STALE_MS}, retries: 0,
     });
     await new Promise((r) => setTimeout(r, 900));
     await h.release();
     return { ok: true };`,
    6,
  );

  const winners = results.filter((r) => r['ok'] === true);
  const losers = results.filter((r) => r['ok'] !== true);

  assert.equal(
    winners.length,
    1,
    `6 个进程同抢应只有一个拿到，实际 ${winners.length} 个：${JSON.stringify(results)}`,
  );
  assert.equal(losers.length, 5);
  for (const l of losers) {
    assert.equal(l['code'], 70, `失败者应得退出码 70（EXIT.LOCKED），实际 ${JSON.stringify(l)}`);
  }
  // 赢家释放后锁必须消失，不能留下墓碑挡住后来者
  assert.equal(await inspectLock(dir, TOPIC), null, '赢家 release 后锁应消失');
});

test('跨进程：临界区串行化，并发读改写不丢更新', async () => {
  const dir = await tmpTrivium();
  const counter = path.join(dir, 'counter.json');
  await fs.writeFile(counter, JSON.stringify({ n: 0 }), 'utf8');

  const N = 6;
  /*
   * 这正是 GLM-08 要防的形状：`state.json` 的「读 → 改 → 写」。
   * 原子替换只防撕裂不防丢更新——不加锁的话 N 个进程都读到 0、都写 1。
   * 体内故意睡 40ms 把窗口撑开，让缺失的互斥无处藏身。
   */
  const results = await raceWorkers(
    dir,
    `const fsp = (await import('node:fs')).promises;
     const counter = ${JSON.stringify(counter)};
     await lock.withTopicLock(
       { triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, heartbeatStaleMs: ${STALE_MS},
         retries: 200, retryDelayMs: 50 },
       async () => {
         const cur = JSON.parse(await fsp.readFile(counter, 'utf8'));
         await new Promise((r) => setTimeout(r, 40));
         await fsp.writeFile(counter, JSON.stringify({ n: cur.n + 1 }));
       },
     );
     return { ok: true };`,
    N,
  );

  assert.equal(results.filter((r) => r['ok'] === true).length, N, `全部应成功：${JSON.stringify(results)}`);

  const final = JSON.parse(await fs.readFile(counter, 'utf8')) as { n: number };
  assert.equal(final.n, N, `${N} 个进程各加一应得 ${N}，实际 ${final.n} —— 少了就是丢更新`);
  assert.equal(await inspectLock(dir, TOPIC), null, '全部退出后不应残留锁');
});

test('跨进程：持锁进程被杀后，遗留锁按 pid_gone 被真实回收', async () => {
  const dir = await tmpTrivium();
  const pidFile = path.join(dir, 'holder.pid');

  // 持锁者：拿到长持锁，写下自己的 pid，然后长睡不醒
  const holderScript = path.join(dir, 'holder.mjs');
  await fs.writeFile(
    holderScript,
    `import { writeFileSync } from 'node:fs';
     const lock = await import(${JSON.stringify(LOCK_MODULE)});
     await lock.acquireLock({
       triviumDir: ${JSON.stringify(dir)}, topic: ${JSON.stringify(TOPIC)},
       runId: 'R-HOLDER', kind: 'run', heartbeatStaleMs: ${STALE_MS},
     });
     writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
     setTimeout(() => {}, 600000);`,
    'utf8',
  );

  const holder = await spawnDetached(process.execPath, [holderScript], {
    cwd: dir,
    logFile: path.join(dir, 'holder.log'),
  });

  // 等它真的把锁拿到手
  let holderPid = 0;
  for (let i = 0; i < 100 && holderPid === 0; i++) {
    try {
      holderPid = Number.parseInt(await fs.readFile(pidFile, 'utf8'), 10);
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.ok(holderPid > 0, '持锁进程没起来，用例前提不成立');
  assert.equal((await inspectLock(dir, TOPIC))?.run_id, 'R-HOLDER', '锁应由持锁进程持有');

  // 活着的时候抢不到——先确认这一点，否则后面的「抢到了」说明不了是回收生效
  await assert.rejects(
    acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 }),
    (e: { code?: number }) => e.code === 70,
    '持锁进程还活着时不得放行',
  );

  // 猝死：SIGKILL 不给任何清理机会，锁文件必然留在原地
  process.kill(holder.pid, 'SIGKILL');
  for (let i = 0; i < 100; i++) {
    if (!(await processAlive(holderPid)).alive) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal((await processAlive(holderPid)).alive, false, '持锁进程应已死');
  assert.notEqual(await inspectLock(dir, TOPIC), null, 'SIGKILL 不会清锁，锁文件应还在');

  // 真实的 pid_gone：PID 确实不存在了，不是用例伪造的 2**22
  const h = await acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: STALE_MS, retries: 0 });
  assert.equal(h.content.pid, process.pid, '遗留锁应被回收并由本进程重新持有');
  await h.release();
});

test('跨进程：多个进程同时回收同一把遗留锁，仍只有一个拿到', async () => {
  const dir = await tmpTrivium();
  await fs.mkdir(path.join(dir, 'lock'), { recursive: true });

  /*
   * 预置一把 pid 已不存在的遗留锁，让 N 个进程同时判定「该回收」并同时动手。
   * 这是 GLM-04 那条 rename → 复验 → 删除 的真实压力场景：
   * 若回收不是原子的，会出现第二个进程删掉第一个刚建好的新锁 → 两个赢家。
   */
  const dead = {
    topic: TOPIC, stage: 'code', run_id: 'R-DEAD', pid: 2 ** 22, pid_started_at: null,
    acquired_at: new Date(Date.now() - 60_000).toISOString(), kind: 'run',
  };
  await fs.writeFile(path.join(dir, 'lock', `${TOPIC}.lock`), JSON.stringify(dead, null, 2) + '\n');

  /*
   * 锁回收误判已删锁文件（EV-149 / EV-173，计划 r2 §5.2）：赢家回报持锁区间（拿到 / 释放时刻），
   * 把「真双持有」（区间重叠）与「晚启动者在赢家释放后合法拿锁」（区间先后）从读数上分开；
   * 修前探针 200 轮里后者 0 轮，唯一的双赢家区间重叠，入口是 ENOENT 被误判 unparsable 的回收挪走了活锁。
   */
  const results = await raceWorkers(
    dir,
    `const now = () => performance.timeOrigin + performance.now();
     const h = await lock.acquireLock({
       triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, runId: 'R-' + id,
       kind: 'run', heartbeatStaleMs: ${STALE_MS}, retries: 0,
     });
     const acq = now();
     await new Promise((r) => setTimeout(r, 900));
     const rel = now();
     await h.release();
     return { ok: true, acq, rel };`,
    5,
  );

  const winners = results.filter((r) => r['ok'] === true) as Array<Record<string, unknown> & { acq: number; rel: number }>;
  const overlapping: string[] = [];
  for (let a = 0; a < winners.length; a++) {
    for (let b = a + 1; b < winners.length; b++) {
      if (winners[a]!.acq < winners[b]!.rel && winners[b]!.acq < winners[a]!.rel) {
        overlapping.push(`${String(winners[a]!['id'])}×${String(winners[b]!['id'])}`);
      }
    }
  }
  assert.deepEqual(overlapping, [], `任意两段持锁区间不得重叠（真双持有）：${JSON.stringify(results)}`);
  assert.equal(
    winners.length,
    1,
    `回收遗留锁的竞争也只应有一个赢家，实际 ${winners.length} 个（区间不重叠 ⇒ 先后合法获取，用例构造问题）：${JSON.stringify(results)}`,
  );
  const stderr = results.map((r) => String(r['__stderr'])).join('');
  // 这把遗留锁可解析：`unparsable` 只可能来自「锁恰被释放 / 挪走时读到 ENOENT」的误判（EV-173）
  assert.doesNotMatch(stderr, /原因 unparsable/, `不得把已删的锁文件判成不可解析：${JSON.stringify(results)}`);
  // 告警只在真回收之后打（计划 r2 D5）：恰有一个进程回收了那把死锁
  const reasons = [...stderr.matchAll(/回收主题「[^」]+」的遗留锁（原因 (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(reasons, ['pid_gone'], `回收告警应恰一条且原因 pid_gone：${JSON.stringify(results)}`);
  assert.equal(await inspectLock(dir, TOPIC), null, '赢家 release 后不应残留');
});

/*
 * 锁回收误判已删锁文件 X3（计划 r2 §5.2）：「释放抖动」——4 个进程各做 25 次短临界区，专门把
 * 「撞 EEXIST 之后、读锁之前持有者恰好释放」这一格压出来。改前这一格读到 ENOENT 判 unparsable、年龄得 +∞，
 * 打出失实告警并去回收，回收时若别人刚建好新锁就把活锁挪走（EV-173 / EV-149 入口 A）。
 * 缺省阈值（120 s）：没有任何锁该被回收，任何「回收主题」字样都是误判。
 */
test('锁回收误判 X3：跨进程——高频抢放短临界区，锁恰被释放的那一格不告警、不回收、不交叠、不丢更新', async () => {
  const dir = await tmpTrivium();
  const counter = path.join(dir, 'counter.json');
  const trace = path.join(dir, 'trace.log');
  await fs.writeFile(counter, JSON.stringify({ n: 0 }), 'utf8');
  const N = 4;
  const ROUNDS = 25;
  const results = await raceWorkers(
    dir,
    `const fsp = (await import('node:fs')).promises;
     const { appendFileSync } = await import('node:fs');
     const counter = ${JSON.stringify(counter)};
     const trace = ${JSON.stringify(trace)};
     for (let k = 0; k < ${ROUNDS}; k++) {
       await lock.withTopicLock(
         { triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, heartbeatStaleMs: ${STALE_MS}, retries: 2000, retryDelayMs: 5 },
         async () => {
           appendFileSync(trace, '+' + id + '\\n');
           const cur = JSON.parse(await fsp.readFile(counter, 'utf8'));
           await fsp.writeFile(counter, JSON.stringify({ n: cur.n + 1 }));
           appendFileSync(trace, '-' + id + '\\n');
         },
       );
     }
     return { ok: true };`,
    N,
  );

  assert.equal(results.filter((r) => r['ok'] === true).length, N, `全部应成功：${JSON.stringify(results)}`);
  let inside = 0;
  let maxInside = 0;
  const lines = (await fs.readFile(trace, 'utf8')).split('\n').filter(Boolean);
  for (const l of lines) {
    inside += l.startsWith('+') ? 1 : -1;
    maxInside = Math.max(maxInside, inside);
  }
  assert.equal(lines.length, 2 * N * ROUNDS, '每次进出各一行');
  assert.equal(maxInside, 1, `临界区须串行，实际同时 ${maxInside} 个`);
  const final = JSON.parse(await fs.readFile(counter, 'utf8')) as { n: number };
  assert.equal(final.n, N * ROUNDS, `${N}×${ROUNDS} 次各加一应得 ${N * ROUNDS}，实际 ${final.n} —— 少了就是丢更新`);
  for (const r of results) {
    assert.doesNotMatch(String(r['__stderr']), /回收主题/, `锁恰被释放不是遗留锁，不得告警 / 回收：${String(r['__stderr'])}`);
  }
  assert.equal(await inspectLock(dir, TOPIC), null, '全部退出后不应残留锁');
});

/*
 * EV-161（临界区锁超时下限计划 r2 §6.2）：亚秒阈值（heartbeat_stale_s: 0.05）下，持有 250 ms 的慢临界区
 * 远超阈值、远不到 30 s 下限——改前等待者会判 heartbeat_dead 把活锁回收，两个持有者并存、丢更新；改后必须串行。
 * 每个进程进出临界区时往同一日志以 O_APPEND 各写一行，重放得「区内人数」的最大值。
 */
const SUB_SECOND_MS = 50;

async function slowCriticalRace(lockCall: 'withTopicLock' | 'withGlobalLock'): Promise<void> {
  const dir = await tmpTrivium();
  const counter = path.join(dir, 'counter.json');
  const trace = path.join(dir, 'trace.log');
  await fs.writeFile(counter, JSON.stringify({ n: 0 }), 'utf8');
  const N = 4;
  const opts =
    lockCall === 'withTopicLock'
      ? `{ triviumDir: dir, topic: ${JSON.stringify(TOPIC)}, heartbeatStaleMs: ${SUB_SECOND_MS}, retries: 200, retryDelayMs: 50 }`
      : `{ triviumDir: dir, heartbeatStaleMs: ${SUB_SECOND_MS}, retries: 200, retryDelayMs: 50 }`;
  const results = await raceWorkers(
    dir,
    `const fsp = (await import('node:fs')).promises;
     const { appendFileSync } = await import('node:fs');
     const counter = ${JSON.stringify(counter)};
     const trace = ${JSON.stringify(trace)};
     await lock.${lockCall}(${opts}, async () => {
       appendFileSync(trace, '+' + id + '\\n');
       const cur = JSON.parse(await fsp.readFile(counter, 'utf8'));
       await new Promise((r) => setTimeout(r, 250));
       await fsp.writeFile(counter, JSON.stringify({ n: cur.n + 1 }));
       appendFileSync(trace, '-' + id + '\\n');
     });
     return { ok: true };`,
    N,
  );

  assert.equal(results.filter((r) => r['ok'] === true).length, N, `全部应成功：${JSON.stringify(results)}`);
  let inside = 0;
  let maxInside = 0;
  const lines = (await fs.readFile(trace, 'utf8')).split('\n').filter(Boolean);
  for (const l of lines) {
    inside += l.startsWith('+') ? 1 : -1;
    maxInside = Math.max(maxInside, inside);
  }
  assert.equal(lines.length, 2 * N, `每个进程进出各一行：${lines.join(' ')}`);
  assert.equal(maxInside, 1, `亚秒阈值下临界区仍须串行，实际同时 ${maxInside} 个：${lines.join(' ')}`);
  const final = JSON.parse(await fs.readFile(counter, 'utf8')) as { n: number };
  assert.equal(final.n, N, `${N} 个进程各加一应得 ${N}，实际 ${final.n} —— 少了就是丢更新`);
  for (const r of results) {
    assert.doesNotMatch(String(r['__stderr']), /回收主题/, `活着的慢临界区不得被回收：${String(r['__stderr'])}`);
  }
}

test('EV-161 X1：跨进程——亚秒阈值下慢临界区（withTopicLock）不被并发者回收、不丢更新', async () => {
  await slowCriticalRace('withTopicLock');
});

test('EV-161 X2：跨进程——亚秒阈值下慢临界区（withGlobalLock）不被并发者回收、不丢更新', async () => {
  await slowCriticalRace('withGlobalLock');
});
