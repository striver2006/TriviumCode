import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnDetached, processAlive, run } from '../../src/trivium/util/exec.js';

/**
 * R-A 的验收（修订版 M2 计划 §6）：两条断言，不是一条模糊判据。
 *
 * 这必须是真集成测试而非 mock —— 双审两侧都指出，原稿的「detached + unref」
 * 说法漏掉了 stdio 去向，而 stdio 恰恰决定成败：
 *   - 继承父进程管道 → 父退出后 worker 死于 SIGPIPE（AGY-01）
 *   - 管道 EOF 不闭合 → 派生方的调用挂到 worker 退出（GLM-03）
 * 这两件事只有真的起进程、真的让父进程退出才测得出来。
 */

/** 本测试文件编译后位于 dist/test/test/integration/，据此定位同构的 src 产物 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXEC_MODULE = path.resolve(HERE, '../../src/trivium/util/exec.js');

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trivium-detach-'));
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test('R-A 断言①：worker 在父进程退出后仍然存活并完成工作', async () => {
  const dir = await tmpDir();
  const marker = path.join(dir, 'worker-finished.txt');
  const pidFile = path.join(dir, 'worker.pid');

  // worker：先等一会儿（确保父进程先退出），再写 marker
  const workerScript = path.join(dir, 'worker.mjs');
  await fs.writeFile(
    workerScript,
    `import { writeFileSync } from 'node:fs';
     process.on('SIGHUP', () => {});           // 忽略挂断信号
     console.log('worker started');            // 走重定向后的日志文件
     setTimeout(() => {
       writeFileSync(${JSON.stringify(marker)}, 'done');
       process.exit(0);
     }, 1200);`,
    'utf8',
  );

  // 父进程：派生 worker、写 pid 文件，然后立刻退出
  const parentScript = path.join(dir, 'parent.mjs');
  await fs.writeFile(
    parentScript,
    `import { writeFileSync } from 'node:fs';
     const { spawnDetached } = await import(${JSON.stringify(EXEC_MODULE)});
     const r = await spawnDetached(process.execPath, [${JSON.stringify(workerScript)}], {
       cwd: ${JSON.stringify(dir)},
       logFile: ${JSON.stringify(path.join(dir, 'worker.log'))},
     });
     writeFileSync(${JSON.stringify(pidFile)}, String(r.pid));
     process.exit(0);`,
    'utf8',
  );

  const parent = await run(process.execPath, [parentScript], { cwd: dir, timeoutMs: 30_000 });
  assert.equal(parent.code, 0, `父进程应正常退出：${parent.stderr}`);

  const workerPid = Number.parseInt(await fs.readFile(pidFile, 'utf8'), 10);
  assert.ok(Number.isInteger(workerPid) && workerPid > 0, '应拿到 worker 的 pid');

  // 父进程已退出，worker 必须还活着
  const alive = await processAlive(workerPid);
  assert.equal(alive.alive, true, 'worker 不得随父进程退出而死（SIGPIPE / SIGHUP）');

  // 而且要真的干完活
  assert.equal(
    await waitFor(() => fs.access(marker).then(() => true, () => false), 15_000),
    true,
    'worker 应在父进程退出后继续执行到完成',
  );

  // 日志被重定向到文件，而不是丢进父进程的管道
  const log = await fs.readFile(path.join(dir, 'worker.log'), 'utf8');
  assert.match(log, /worker started/, 'stdout 应重定向到日志文件');
  assert.equal(parent.stdout.includes('worker started'), false, 'worker 的输出不得混进父进程 stdout');
});

test('R-A 断言②：派生调用秒级返回，不等 worker 结束', async () => {
  const dir = await tmpDir();
  const workerScript = path.join(dir, 'slow-worker.mjs');
  // worker 故意跑 8 秒
  await fs.writeFile(workerScript, 'setTimeout(() => process.exit(0), 8000);', 'utf8');

  const t0 = Date.now();
  const r = await spawnDetached(process.execPath, [workerScript], {
    cwd: dir,
    logFile: path.join(dir, 'w.log'),
  });
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 2000, `派生应秒级返回，实际耗时 ${elapsed}ms —— 超时说明 stdio 仍在等管道`);
  assert.ok(r.pid > 0);

  // 收尾：别把 worker 留到测试进程之后
  try {
    process.kill(r.pid, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
});

test('派生的 worker 脱离父进程的进程组（detached 即 setsid）', async () => {
  const dir = await tmpDir();
  const workerScript = path.join(dir, 'w.mjs');
  await fs.writeFile(workerScript, 'setTimeout(() => process.exit(0), 5000);', 'utf8');

  const r = await spawnDetached(process.execPath, [workerScript], {
    cwd: dir,
    logFile: path.join(dir, 'w.log'),
  });
  try {
    // pgid 应等于自身 pid（新会话领导者），而非父进程的 pgid
    const ps = await run('/bin/ps', ['-o', 'pgid=', '-p', String(r.pid)], { timeoutMs: 10_000 });
    const pgid = Number.parseInt(ps.stdout.trim(), 10);
    assert.equal(pgid, r.pid, `worker 应自成进程组（pgid=${pgid}, pid=${r.pid}）`);
  } finally {
    try {
      process.kill(r.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
});

test('日志文件以追加方式打开，多次派生不互相覆盖', async () => {
  const dir = await tmpDir();
  const logFile = path.join(dir, 'shared.log');
  const mk = async (msg: string) => {
    const s = path.join(dir, `${msg}.mjs`);
    await fs.writeFile(s, `console.log(${JSON.stringify(msg)}); process.exit(0);`, 'utf8');
    return s;
  };
  const a = await spawnDetached(process.execPath, [await mk('first')], { cwd: dir, logFile });
  await waitFor(async () => !(await processAlive(a.pid)).alive, 10_000);
  const b = await spawnDetached(process.execPath, [await mk('second')], { cwd: dir, logFile });
  await waitFor(async () => !(await processAlive(b.pid)).alive, 10_000);

  const log = await fs.readFile(logFile, 'utf8');
  assert.match(log, /first/);
  assert.match(log, /second/, '第二次派生不得覆盖第一次的日志');
});

test('processAlive 能区分「同一进程」与「PID 被复用」', async () => {
  const self = await processAlive(process.pid);
  assert.equal(self.alive, true);
  assert.ok(self.startedAt, '应取到本进程的启动时刻');

  const same = await processAlive(process.pid, self.startedAt);
  assert.equal(same.sameProcess, true);

  const reused = await processAlive(process.pid, 'Thu Jan  1 00:00:00 1970');
  assert.equal(reused.alive, true);
  assert.equal(reused.sameProcess, false, '启动时刻不符即判为 PID 被复用');
});
