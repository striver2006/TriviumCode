import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { groupsWithMark, killGroup } from '../helpers/proc.js';
import {
  killProcessTree, runSpawnRelay, spawnDetached, processAlive, run, terminateProcessGroup, type DetachedChildWatch,
} from '../../src/trivium/util/exec.js';
import { scratchDir } from '../helpers/scratch.js';

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
// win32 的 ESM import 不认盘符绝对路径——模块定位一律 file:// URL（macOS 上 file:// 同样合法）
const EXEC_MODULE = pathToFileURL(path.resolve(HERE, '../../src/trivium/util/exec.js')).href;

async function tmpDir(): Promise<string> {
  return scratchDir('trivium-detach-');
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

// ─────────────── Windows 逃 Job 派生通道（ISSUE-08）的中继与回退 ───────────────

test('runSpawnRelay：照规格拉起 worker、pid 落结果文件、规格（含 env 快照）读完即删', { skip: process.platform !== 'win32' && 'win32 专属：WMI 中继入口只在 Windows 的派生链上使用' }, async () => {
  const dir = await tmpDir();
  const workerScript = path.join(dir, 'relay-worker.mjs');
  await fs.writeFile(
    workerScript,
    `import { appendFileSync } from 'node:fs';
     appendFileSync(${JSON.stringify(path.join(dir, 'relay-ran.txt'))}, process.env.TRIVIUM_RELAY_PROOF ?? 'NO-ENV' + '\\n');
     setTimeout(() => process.exit(0), 3000);`,
    'utf8',
  );
  const specPath = path.join(dir, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify({
    bin: process.execPath,
    args: [workerScript],
    cwd: dir,
    logFile: path.join(dir, 'relay-worker.log'),
    // env 快照必须过桥：中继自身继承的是 WmiPrvSE 的环境，worker 的 env 只能来自规格
    env: { ...process.env, TRIVIUM_RELAY_PROOF: 'env-crossed' } as Record<string, string>,
  }), 'utf8');

  const code = await runSpawnRelay(specPath);
  assert.equal(code, 0);
  await assert.rejects(fs.access(specPath), '规格文件必须被中继删除（内含完整 env 快照，可能带凭据形态）');
  const outcome = JSON.parse(await fs.readFile(`${specPath}.result`, 'utf8')) as { pid: number | null };
  assert.ok(typeof outcome.pid === 'number' && outcome.pid! > 0, `结果文件应记下 worker pid：${JSON.stringify(outcome)}`);
  await waitFor(() => fs.access(path.join(dir, 'relay-ran.txt')).then(() => true, () => false), 10_000);
  const ran = await fs.readFile(path.join(dir, 'relay-ran.txt'), 'utf8');
  assert.match(ran, /env-crossed/, 'worker 的环境必须来自规格快照，而不是 WMI 提供进程的环境');
  try {
    process.kill(outcome.pid!, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
});

test('ISSUE-08 回退：WMI 逃逸通道失败时回退直接派生（channel=direct），日志留痕不比修复前更糟', { skip: process.platform !== 'win32' && 'win32 专属：WMI 逃逸通道只在 Windows 尝试' }, async () => {
  const dir = await tmpDir();
  const workerScript = path.join(dir, 'w.mjs');
  await fs.writeFile(workerScript, 'setTimeout(() => process.exit(0), 5000);', 'utf8');

  // 中继入口指向不存在的二进制：WMI Create 必失败（ReturnValue≠0）→ 走回退
  const r = await spawnDetached(process.execPath, [workerScript], {
    cwd: dir,
    logFile: path.join(dir, 'w.log'),
    winRelay: { bin: path.join(dir, 'no-such-relay-binary.exe'), args: ['review', '--spawn-relay'] },
  });
  assert.equal(r.channel, 'direct', '逃逸失败必须回退直拉，而不是拒绝派生');
  const log = await fs.readFile(path.join(dir, 'w.log'), 'utf8');
  assert.match(log, /WMI 逃逸通道不可用.*回退直接派生/, '回退必须在 worker.log 留痕（带收杀 Job 的会话里直拉会死，原因要可见）');
  try {
    process.kill(r.pid, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
});

test('ISSUE-08 逃逸：winRelay 指向真实入口时 worker 经 WMI 中继派生（channel=wmi-escape）、规格与结果文件都清干净', { skip: process.platform !== 'win32' && 'win32 专属：WMI 逃逸通道只在 Windows 尝试（Job 收杀语境见 win-job-escape.test.ts）' }, async () => {
  const { BUNDLE } = await import('../helpers/fixture.js');
  const dir = await tmpDir();
  const workerScript = path.join(dir, 'w.mjs');
  await fs.writeFile(workerScript, 'setTimeout(() => process.exit(0), 5000);', 'utf8');

  const logFile = path.join(dir, 'w.log');
  const r = await spawnDetached(process.execPath, [workerScript], {
    cwd: dir,
    logFile,
    winRelay: { bin: process.execPath, args: [BUNDLE, 'review', '--spawn-relay'] },
  });
  assert.equal(r.channel, 'wmi-escape', '真实入口下必须走逃逸通道（这里失败说明 WMI 不可用或中继异常，需人工核对）');
  await assert.rejects(fs.access(`${logFile}.spawn-spec.json`), '规格文件在成败两条路上都必须清理');
  await assert.rejects(fs.access(`${logFile}.spawn-spec.json.result`), '结果文件同样不留');
  const alive = await processAlive(r.pid);
  assert.equal(alive.alive, true, '逃逸派生的 worker 应正常存活');
  try {
    process.kill(r.pid, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
});

test('派生的 worker 脱离父进程的进程组（detached 即 setsid）', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
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

// ── --cancel 必须连带杀掉厂商子进程（实测遗弃过）──

test('killProcessTree 杀整组：子孙进程不被遗弃给 init', async () => {
  const dir = await scratchDir('trivium-tree-');

  /*
   * 造一棵真进程树：detached 的父进程再 spawn 一个长睡子进程（**不带** detached，与父进程同组）。
   * 这是 worker 以不带 `killTree` 的 `run()` 拉起子进程的形状。只 kill 父进程的话，
   * 子进程会被 init 收养并继续跑——`5476238` 实测中 `--cancel` 之后 zcode-cli 的 PPID
   * 变成 1 且仍在消耗配额，就是这么来的（那时它还在 worker 的组里）。
   * 注意：审查员适配器以 `killTree: true` 拉起厂商 CLI，那会让 CLI 自成一组，本用例的形状**不覆盖**它——
   * 按 worker 的组发的信号到不了那一组，由 worker 的 SIGTERM 处理器转发（EV-152）；那一形状见本文件 U7 与
   * gate-loop 的 I1 / I2。
   */
  const script = path.join(dir, 'parent.mjs');
  await fs.writeFile(
    script,
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      // 子进程睡很久；把它的 pid 写出来供断言
      `const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},600000)'], { stdio: 'ignore' });`,
      `writeFileSync(${JSON.stringify(path.join(dir, 'child.pid'))}, String(child.pid));`,
      'setTimeout(() => {}, 600000);',
    ].join('\n'),
    'utf8',
  );

  const parent = await spawnDetached(process.execPath, [script], {
    cwd: dir,
    logFile: path.join(dir, 'p.log'),
  });

  // 等子进程起来
  let childPid = 0;
  for (let i = 0; i < 50 && childPid === 0; i++) {
    try {
      childPid = Number.parseInt(await fs.readFile(path.join(dir, 'child.pid'), 'utf8'), 10);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(childPid > 0, '子进程没起来，用例前提不成立');
  assert.equal((await processAlive(childPid, null)).alive, true);

  assert.equal(killProcessTree(parent.pid, 'SIGKILL'), true);

  // 两个都应在短时间内消失
  for (let i = 0; i < 50; i++) {
    const p = (await processAlive(parent.pid, null)).alive;
    const c = (await processAlive(childPid, null)).alive;
    if (!p && !c) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await processAlive(parent.pid, null)).alive, false, '父进程应已退出');
  assert.equal(
    (await processAlive(childPid, null)).alive,
    false,
    '子进程必须一起被杀——否则它会被 init 收养并继续烧配额',
  );
});

test('killProcessTree 对已退出的 pid 返回 false 而不抛异常', async () => {
  const r = await run(process.execPath, ['-e', 'process.exit(0)'], { timeoutMs: 10_000 });
  assert.equal(r.code, 0);
  // 用一个几乎不可能存在的 pid
  assert.equal(killProcessTree(999_999, 'SIGTERM'), false);
});

test('killProcessTree 拒绝 pid <= 1，绝不误杀 init 或整个会话', () => {
  assert.equal(killProcessTree(0, 'SIGKILL'), false, 'pid 0 是「当前进程组」，会自杀');
  assert.equal(killProcessTree(1, 'SIGKILL'), false);
  assert.equal(killProcessTree(-5, 'SIGKILL'), false);
  assert.equal(killProcessTree(process.pid, 'SIGKILL'), false, '绝不对自己发信号');
});

// ── EV-145：onSpawned 的调用时点，与 spawn 失败不崩进程（事后收尾余项计划 r2 §3.3 / §4.1 U1）──

test('EV-145 U1：onSpawned 在拿到 pid 时恰好调用一次；建日志目录就失败时抛错且不调用', async () => {
  const dir = await tmpDir();
  const workerScript = path.join(dir, 'w.mjs');
  await fs.writeFile(workerScript, 'setTimeout(() => process.exit(0), 5000);', 'utf8');

  const seen: number[] = [];
  const r = await spawnDetached(process.execPath, [workerScript], {
    cwd: dir,
    logFile: path.join(dir, 'w.log'),
    onSpawned: (pid) => seen.push(pid),
  });
  try {
    assert.deepEqual(seen, [r.pid], '子进程诞生时回调恰好一次，参数就是返回的 pid');
  } finally {
    try {
      process.kill(r.pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }

  // 日志路径的父级是一个普通文件：建日志目录失败，子进程从未诞生
  const blocker = path.join(dir, 'not-a-dir');
  await fs.writeFile(blocker, 'x', 'utf8');
  const seen2: number[] = [];
  await assert.rejects(
    spawnDetached(process.execPath, [workerScript], {
      cwd: dir,
      logFile: path.join(blocker, 'w.log'),
      onSpawned: (pid) => seen2.push(pid),
    }),
  );
  assert.deepEqual(seen2, [], '子进程诞生之前的失败不得触发回调——startRun 据此把骨架收尾为 failed');
});

test('EV-145 U2：二进制不存在（spawn 拿不到 pid）⇒ spawnDetached 抛错被调用方接住，进程不因未处理的 error 事件崩溃', async () => {
  const dir = await tmpDir();
  const script = path.join(dir, 'spawn-enoent.mjs');
  await fs.writeFile(
    script,
    `const { spawnDetached } = await import(${JSON.stringify(EXEC_MODULE)});
     let born = false;
     try {
       await spawnDetached('/nonexistent/trivium-bin-xyz', [], { logFile: ${JSON.stringify(path.join(dir, 'w.log'))}, onSpawned: () => { born = true; } });
       console.log('returned');
     } catch (e) {
       console.log('caught:' + e.message);
     }
     await new Promise((r) => setTimeout(r, 300));
     console.log(born ? 'born' : 'not-born');
     console.log('alive');`,
    'utf8',
  );
  const r = await run(process.execPath, [script], { timeoutMs: 20_000 });
  assert.equal(r.code, 0, `进程不应崩溃：\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /caught/);
  assert.match(r.stdout, /not-born/);
  assert.match(r.stdout, /alive/);
  // 代码双审 r1 CODEX-01：不崩之外还要可诊断——成因（错误码与可执行文件路径）进报错正文与 worker.log
  assert.match(r.stdout, /caught:spawn 未返回 pid：\/nonexistent\/trivium-bin-xyz（ENOENT /, r.stdout);
  const log = await fs.readFile(path.join(dir, 'w.log'), 'utf8');
  assert.match(log, /spawn 未返回 pid：\/nonexistent\/trivium-bin-xyz（ENOENT /, `worker.log 应留一行成因：${JSON.stringify(log)}`);
});

// ── EV-150：子进程句柄的退出观察与按组终止（派生后失败的孤儿worker计划 r2 §3.2 / §4.1 U3 / U4）──

/** 派生一个长睡子进程并拿到它的退出观察；`ignoreTerm` 为真时它忽略 SIGTERM，就绪后才返回 */
async function spawnWatched(ignoreTerm = false): Promise<{ pid: number; watch: DetachedChildWatch; argPid: number }> {
  const dir = await tmpDir();
  const ready = path.join(dir, 'ready');
  const script = path.join(dir, 'w.mjs');
  await fs.writeFile(
    script,
    [
      "import { writeFileSync } from 'node:fs';",
      ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
      `writeFileSync(${JSON.stringify(ready)}, 'x');`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
    'utf8',
  );
  let got: { pid: number; watch: DetachedChildWatch } | null = null;
  const r = await spawnDetached(process.execPath, [script], {
    cwd: dir,
    logFile: path.join(dir, 'w.log'),
    onSpawned: (pid, watch) => {
      got = { pid, watch };
    },
  });
  assert.ok(await waitFor(() => fs.access(ready).then(() => true, () => false), 10_000), '子进程没就绪，用例前提不成立');
  const g = got as { pid: number; watch: DetachedChildWatch } | null;
  assert.ok(g, 'onSpawned 应已调用');
  return { pid: r.pid, watch: g.watch, argPid: g.pid };
}

test('EV-150 U3：onSpawned 的第二个参数——杀之前 hasExited 为假；按组 SIGTERM 后 exited 兑现、signal 为 SIGTERM、hasExited 为真', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
  const { pid, watch, argPid } = await spawnWatched();
  try {
    assert.equal(argPid, pid, '第一个参数仍是返回的 pid');
    assert.equal(watch.hasExited(), false);
    assert.equal(killProcessTree(pid, 'SIGTERM'), true);
    const ev = await Promise.race([watch.exited, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    assert.ok(ev, '3 s 内应观察到退出');
    assert.equal(ev.signal, 'SIGTERM');
    assert.equal(watch.hasExited(), true);
  } finally {
    killProcessTree(pid, 'SIGKILL');
  }
});

test('EV-150 U4①：terminateProcessGroup——普通子进程 SIGTERM 即退，不升级', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
  const { pid, watch } = await spawnWatched();
  try {
    let escalations = 0;
    const r = await terminateProcessGroup(pid, {
      isGone: watch.hasExited, graceMs: 3000, killWaitMs: 3000, pollMs: 50, onEscalate: () => escalations++,
    });
    assert.deepEqual(r, { gone: true, escalated: false, signals: ['SIGTERM'] });
    assert.equal(escalations, 0);
  } finally {
    killProcessTree(pid, 'SIGKILL');
  }
});

test('EV-150 U4②：terminateProcessGroup——忽略 SIGTERM 的子进程在宽限后升级 SIGKILL，onEscalate 恰调一次', async () => {
  const { pid, watch } = await spawnWatched(true);
  try {
    let escalations = 0;
    const r = await terminateProcessGroup(pid, {
      isGone: watch.hasExited, graceMs: 300, killWaitMs: 3000, pollMs: 50, onEscalate: () => escalations++,
    });
    assert.deepEqual(r, { gone: true, escalated: true, signals: ['SIGTERM', 'SIGKILL'] });
    assert.equal(escalations, 1);
  } finally {
    killProcessTree(pid, 'SIGKILL');
  }
});

test('EV-150 U4③：terminateProcessGroup——判据恒为「未退出」时在宽限 + 等待之后如实返回 gone: false，不挂住', async () => {
  const sent: NodeJS.Signals[] = [];
  const t0 = Date.now();
  const r = await terminateProcessGroup(999_999, {
    isGone: () => false, graceMs: 200, killWaitMs: 300, pollMs: 50,
    signal: (_pid, sig) => (sent.push(sig), true),
  });
  assert.deepEqual(r, { gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'] });
  assert.deepEqual(sent, ['SIGTERM', 'SIGKILL']);
  assert.ok(Date.now() - t0 < 2000, `应在宽限 + 等待之后返回，实为 ${Date.now() - t0} ms`);
});

test('EV-150 U4④：terminateProcessGroup——一开始就已退出时一个信号都不发（不向可能被复用的号发组信号）', async () => {
  const sent: NodeJS.Signals[] = [];
  const r = await terminateProcessGroup(999_999, {
    isGone: () => true, graceMs: 200, killWaitMs: 200,
    signal: (_pid, sig) => (sent.push(sig), true),
  });
  assert.deepEqual(r, { gone: true, escalated: false, signals: [] });
  assert.deepEqual(sent, []);
});

// ─────────── EV-152：shutdownTrackedTrees（取消够不到审查员CLI计划 r2 §5.1 U7） ───────────

/**
 * 冻结标志是模块级的，**不能在测试进程里置位**：每格在子进程里跑。子进程自己以 killTree 形态派生（组长），
 * 它名下不带 killTree 的后代与它同组；带 killTree 的孙进程各自成组。收尾按组号结束：本次标记认得出的组、
 * 以及子进程自己那一组。
 */
interface ShutdownScenario {
  groups: number[];
  signals: Record<string, string[]>;
  remaining: number[];
  [k: string]: unknown;
}

/** 子进程脚本的公共前段：导入被测模块、按标记找组长、数组员（`rows` / `members` 与 `test/helpers/proc.ts` 同源；在子进程里跑，必须自包含） */
function scenarioPrelude(): string {
  return [
    `import { run, shutdownTrackedTrees } from ${JSON.stringify(EXEC_MODULE)};`,
    "import { execFileSync } from 'node:child_process';",
    "import { existsSync } from 'node:fs';",
    'const MARK = process.argv[2];',
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
    'function rows() {',
    "  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' });",
    '  const res = [];',
    "  for (const l of out.split('\\n')) { const m = /^\\s*(\\d+)\\s+(\\d+)\\s+(.*)$/.exec(l); if (m) res.push({ pid: +m[1], pgid: +m[2], cmd: m[3] }); }",
    '  return res;',
    '}',
    'const members = (pgid) => rows().filter((r) => r.pgid === pgid).length;',
    'async function leader(tag) {',
    '  for (let i = 0; i < 100; i++) {',
    "    const r = rows().find((x) => x.cmd.includes(MARK + '-' + tag) && x.cmd.startsWith('/bin/sh'));",
    '    if (r) { await sleep(100); return r.pid; }',
    '    await sleep(50);',
    '  }',
    "  throw new Error('组长没起来：' + tag);",
    '}',
    "const tree = (tag, ignoreTerm) => run('/bin/sh', ['-c', (ignoreTerm ? \"trap '' TERM; \" : '') + 'sleep 600; : \"$0\"', MARK + '-' + tag], { killTree: true, timeoutMs: 600000 });",
  ].join('\n');
}

async function runScenario(body: string): Promise<ShutdownScenario> {
  const dir = await tmpDir();
  const mark = `trivium-u7-${path.basename(dir)}`;
  const script = path.join(dir, 'scenario.mjs');
  await fs.writeFile(script, `${scenarioPrelude()}\n${body}\nprocess.exit(0);\n`, 'utf8');
  try {
    const r = await run(process.execPath, [script, mark], { killTree: true, timeoutMs: 30_000 });
    const stdout = r.stdout.trim();
    assert.equal(r.code, 0, `场景子进程应退 0：${r.stderr}${stdout}`);
    return JSON.parse(stdout.split('\n').pop()!) as ShutdownScenario;
  } finally {
    // 收尾按组号结束带本次标记的组：场景子进程名下不带 killTree 的后代（U7⑤）在场景子进程自己那一组里，标记也认得出
    for (const g of groupsWithMark(mark)) killGroup(g);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('EV-152 U7①：shutdownTrackedTrees——killTree 拉起的静默子进程被按组终止（组空），那个 run() 此后不兑现（冻结）', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
  const r = await runScenario([
    "const p = tree('a', false);",
    'let resolved = false; p.then(() => { resolved = true; });',
    "const pgid = await leader('a');",
    'const before = members(pgid);',
    'const res = await shutdownTrackedTrees({ graceMs: 3000, killWaitMs: 1000 });',
    'let after = members(pgid);',
    'for (let i = 0; i < 20 && after > 0; i++) { await sleep(50); after = members(pgid); }',
    'await sleep(500);',
    'console.log(JSON.stringify({ ...res, pgid, before, after, resolved }));',
  ].join('\n'));
  assert.equal(r['before'], 2, '组里应有 sh 与 sleep 两个成员，用例前提');
  assert.deepEqual(r.groups, [r['pgid']]);
  assert.deepEqual(r.signals[String(r['pgid'])], ['SIGTERM']);
  assert.deepEqual(r.remaining, []);
  assert.equal(r['after'], 0, '整组都应结束，不只是带标记的组长');
  assert.equal(r['resolved'], false, '冻结之后被杀子进程的 run() 不得兑现（否则 runner 会往下走、抢先写归档终态）');
});

test('EV-152 U7②：shutdownTrackedTrees——忽略 SIGTERM 的组在宽限后升级 SIGKILL，组空', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
  const r = await runScenario([
    "tree('b', true);",
    "const pgid = await leader('b');",
    'const res = await shutdownTrackedTrees({ graceMs: 300, killWaitMs: 2000 });',
    'let after = members(pgid);',
    'for (let i = 0; i < 20 && after > 0; i++) { await sleep(50); after = members(pgid); }',
    'console.log(JSON.stringify({ ...res, pgid, after }));',
  ].join('\n'));
  assert.deepEqual(r.signals[String(r['pgid'])], ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(r.remaining, []);
  assert.equal(r['after'], 0);
});

test('EV-152 U7③：冻结之后再调 run()——不派生、不兑现', async () => {
  const r = await runScenario([
    'await shutdownTrackedTrees({ graceMs: 100, killWaitMs: 100 });',
    // 绝对路径、落在本格的 mkdtemp 里：变异（M4）让 run() 照常派生时，文件不能落进测试进程的 cwd（仓库根）
    "const f = new URL('./u7c-created', import.meta.url).pathname;",
    "const p = run('/bin/sh', ['-c', ': > \"$0\"', f]);",
    'let resolved = false; p.then(() => { resolved = true; });',
    'await sleep(300);',
    'console.log(JSON.stringify({ groups: [], signals: {}, remaining: [], created: existsSync(f), resolved }));',
  ].join('\n'));
  assert.equal(r['created'], false, '冻结之后 run() 不得派生');
  assert.equal(r['resolved'], false);
});

test('EV-152 U7④：登记为空——立即返回，一个信号都不发', async () => {
  const r = await runScenario([
    'let sent = 0;',
    'const t0 = Date.now();',
    'const res = await shutdownTrackedTrees({ graceMs: 1000, killWaitMs: 1000, signal: () => { sent++; return true; } });',
    'console.log(JSON.stringify({ ...res, sent, ms: Date.now() - t0 }));',
  ].join('\n'));
  assert.deepEqual(r.groups, []);
  assert.equal(r['sent'], 0);
  assert.ok((r['ms'] as number) < 500, `应立即返回，实为 ${String(r['ms'])} ms`);
});

test('EV-152 U7⑤：不带 killTree 的 run() 不进登记', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
  const r = await runScenario([
    "run('/bin/sh', ['-c', 'sleep 600; : \"$0\"', MARK + '-plain'], { timeoutMs: 600000 });",
    "tree('d', false);",
    "const pgid = await leader('d');",
    "let plain = 0;",
    "for (let i = 0; i < 50 && !plain; i++) { const x = rows().find((y) => y.cmd.includes(MARK + '-plain') && y.cmd.startsWith('/bin/sh')); if (x) plain = x.pid; else await sleep(50); }",
    'const res = await shutdownTrackedTrees({ graceMs: 1000, killWaitMs: 1000 });',
    'console.log(JSON.stringify({ ...res, pgid, plain }));',
  ].join('\n'));
  assert.ok((r['plain'] as number) > 0, '不带 killTree 的子进程没起来，用例前提不成立');
  assert.deepEqual(r.groups, [r['pgid']], '登记里只应有 killTree 那一组');
});

test('EV-152 U7⑥：两组都忽略 SIGTERM——并行终止，总耗时在单组预算之内（串行会约翻倍）', { skip: process.platform === 'win32' && 'POSIX 进程组语义（setsid/pgid 组信号/SIGTERM 升级阶梯）——win32 按 §7.1 走父链闭包+taskkill 等价路径，需等价改写非形态适配（§3.1-6 重改写族）' }, async () => {
  const r = await runScenario([
    "tree('e1', true); tree('e2', true);",
    "const g1 = await leader('e1'); const g2 = await leader('e2');",
    'const t0 = Date.now();',
    'const res = await shutdownTrackedTrees({ graceMs: 2000, killWaitMs: 500 });',
    'const ms = Date.now() - t0;',
    'let after = members(g1) + members(g2);',
    'for (let i = 0; i < 20 && after > 0; i++) { await sleep(50); after = members(g1) + members(g2); }',
    'console.log(JSON.stringify({ ...res, ms, after }));',
  ].join('\n'));
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.remaining, []);
  assert.equal(r['after'], 0);
  // 并行约 grace + 几十毫秒 ≈ 2.05 s；串行约 2 × grace ≈ 4.1 s。上界取 grace + killWait + 1000 = 3.5 s，两侧各留约 1.4 s
  // （计划双审 r1 AGY-05；代码双审 r1 CODEX-05 把原来 1.5 s / 上界 2.5 s 的参数拉开，免得满载下假红）。这条是变异 M10 唯一的咬合点
  assert.ok(
    (r['ms'] as number) < 2000 + 500 + 1000,
    `并行终止应在单组预算内，实为 ${String(r['ms'])} ms（预期：并行约 2050 ms、串行约 4100 ms；介于两者之间先按 EV-149 口径存读数）`,
  );
});
