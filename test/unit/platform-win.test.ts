/**
 * Windows 平台层的用例（设计 §7.1）。其它平台整文件跳过；POSIX 侧的既有进程语义
 * 用例（ps/组信号/僵尸）不在本文件复刻——两平台各自的语义各自验收。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { winOnly } from '../helpers/platform.js';
import {
  cachedEnumRows, enumerateWinProcesses, resetEnumCacheForTest, resolvePosixShellSync, winProcessCreation, winTaskkillTree, winTreeMemberCount,
} from '../../src/trivium/util/platform.js';
import { CANCEL_FLAG_BASELINE_BACKOFF_MS, installWorkerCancelFlagWatcher } from '../../src/trivium/run-protocol.js';
import { killProcessTree, processStartTime } from '../../src/trivium/util/exec.js';

/**
 * 起一个两代 node 树：父进程派生子进程后挂起，两代都活着，父链与后代计数可验。
 * 返回根 pid 与子 pid；用例负责树杀收尾。
 */
async function spawnNodeTree(): Promise<{ root: number; child: number }> {
  const childScript = 'setInterval(()=>{},1000)';
  const parentScript = `const{spawn}=require('node:child_process');` +
    `const c=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore',windowsHide:true});` +
    `console.log(c.pid);setInterval(()=>{},1000)`;
  const rootProc = spawn(process.execPath, ['-e', parentScript], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let out = '';
  const child = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`父进程 5 s 内没打印子 pid，stdout=${out}`)), 5_000);
    rootProc.stdout!.setEncoding('utf8');
    rootProc.stdout!.on('data', (c: string) => {
      out += c;
      const m = /^(\d+)\s*$/.exec(out.trim());
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    rootProc.on('error', reject);
  });
  rootProc.unref();
  if (rootProc.pid === undefined) throw new Error('没拿到父 pid');
  return { root: rootProc.pid, child };
}

test('resolvePosixShellSync：定位到真实存在的 sh.exe（Git for Windows 硬前置）',
  { skip: winOnly('只在 Windows 上跑') }, () => {
    const sh = resolvePosixShellSync();
    assert.ok(sh, '本机应能定位 sh.exe（Git for Windows 是硬前置）');
    assert.match(sh, /sh\.exe$/i);
    assert.ok(existsSync(sh));
  });

test('enumerateWinProcesses：返回非空进程表，含本进程；短 TTL 内两次取值一致',
  { skip: winOnly('只在 Windows 上跑'), timeout: 30_000 }, async () => {
    const rows = await enumerateWinProcesses();
    assert.ok(rows && rows.length > 10, '全量枚举应远多于 10 条');
    assert.ok(rows.some((r) => r.pid === process.pid), '枚举里应有本测试进程');
    const again = await enumerateWinProcesses();
    assert.equal(again, rows, 'TTL 内两次调用应命中同一份缓存');
  });

test('winProcessCreation：本进程的创建时刻是 UTC ISO 形态且缓存内稳定',
  { skip: winOnly('只在 Windows 上跑'), timeout: 30_000 }, async () => {
    const t = await winProcessCreation(process.pid);
    assert.ok(t, '本进程应取得到创建时刻');
    assert.match(t!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    assert.equal(await winProcessCreation(process.pid), t, '同缓存窗口取值稳定');
    assert.equal(await processStartTime(process.pid, { canonical: true }), t, 'processStartTime 与 canonical 同形');
  });

test('winTreeMemberCount：父链后代计数覆盖两代；强杀后归零',
  { skip: winOnly('只在 Windows 上跑'), timeout: 60_000 }, async () => {
    const { root, child } = await spawnNodeTree();
    try {
      // 子进程登记进 WMI 有延迟，重试至看到两代
      let n: number | null = null;
      for (let i = 0; i < 20; i++) {
        n = await winTreeMemberCount(root);
        if (n !== null && n >= 2) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(n !== null && n >= 2, `两代树应数出至少 2 个成员，实测 ${n}`);
      assert.ok(await winProcessCreation(child) !== null, '子进程应在枚举里');
    } finally {
      assert.equal(killProcessTree(root, 'SIGKILL'), true, 'taskkill /T /F 应成功');
    }
    for (let i = 0; i < 20; i++) {
      const n = await winTreeMemberCount(root);
      if (n === 0) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.fail('强杀后成员数应归零');
  });

test('winTaskkillTree：硬步立即清树，根进程从表上消失',
  { skip: winOnly('只在 Windows 上跑'), timeout: 60_000 }, async () => {
    const { root } = await spawnNodeTree();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(winTaskkillTree(root, true), true);
    for (let i = 0; i < 20; i++) {
      const rows = await enumerateWinProcesses({ fresh: true });
      if (rows && !rows.some((r2) => r2.pid === root)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.fail('硬步之后根进程应从进程表消失');
  });

test('取消标记文件：run-files 登记的文件名进白名单（isRunDirFile 对账）',
  { skip: winOnly('只在 Windows 上跑') }, async () => {
    const { RUN_DIR_FILES, isRunDirFile } = await import('../../src/trivium/run-files.js');
    assert.equal(RUN_DIR_FILES.cancelRequest, 'cancel.requested');
    assert.equal(isRunDirFile('cancel.requested'), true);
    assert.equal(isRunDirFile('cancel.requested.tmp-123-456'), true, '原子写临时态也要认得');
  });

test('init 双形态 wrapper：win32 同时写 sh 形态与 .cmd，checkWrapper 核出失效路径',
  { skip: winOnly('只在 Windows 上跑'), timeout: 30_000 }, async () => {
    const { writeWrapper, checkWrapper } = await import('../../src/trivium/init.js');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-win-wrap-'));
    try {
      const report = { created: [] as string[], updated: [] as string[], removed: [] as string[], skipped: [] as string[] };
      await writeWrapper(dir, process.execPath, 'C:\\fake-asset-root', report as never, false);
      const shWrapper = path.join(dir, 'bin', 'trivium');
      const cmdWrapper = path.join(dir, 'bin', 'trivium.cmd');
      assert.ok(existsSync(shWrapper), 'sh 形态照写');
      assert.ok(existsSync(cmdWrapper), '.cmd 应写入');
      const content = await fs.readFile(cmdWrapper, 'utf8');
      assert.match(content, /^@echo off\r\n/);
      assert.ok(content.includes(`"${process.execPath}"`), '.cmd 内写死本机 node 绝对路径');
      // bundle 路径不存在 → checkWrapper 应核出（写死路径失效是它的职责）
      const problems = await checkWrapper(dir);
      assert.ok(problems.length > 0 && problems.some((p) => p.includes('bundle')), `指向不存在的 bundle 应被核出，实测 ${problems}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

// ─────────────────── 1.2.2 审查修复的 win32 锚点 ───────────────────

test('cachedEnumRows：失败兜底只认显式龄期内的缓存（CLAUDE-03——无龄期旧表是另一种猜）', () => {
  const rows = [{ pid: 1, ppid: 0, creation: '2026-10-20T00:00:00.000000Z' }];
  const now = Date.now();
  assert.deepEqual(cachedEnumRows({ at: now - 500, rows }, now), rows, '数秒内的表可作失败兜底');
  assert.equal(cachedEnumRows({ at: now - 4_000, rows }, now), null, '超龄旧表不得回给调用方——pid 复用下会误判同一进程');
  assert.equal(cachedEnumRows(null, now), null, '从无缓存就是 null');
});

// ─────────────────── 1.2.8 修复的 win32 锚点 ───────────────────

/** 可控的假枚举子进程：测试按需喂数据并 close，钉住「一趟枚举」的生命周期（不真跑 PowerShell） */
class FakeEnumChild extends EventEmitter {
  readonly stdout = Object.assign(new EventEmitter(), {
    setEncoding(_e: string): void { /* 形态对齐即可 */ },
  });
  kill(): void { this.emit('close', 1); }
}

test('enumerateWinProcesses：fresh 的搭车判据是启程时刻——拒绝启程更早的在飞趟、同拍启程的共享一趟（1.2.8）',
  { skip: winOnly('只在 Windows 上跑'), timeout: 30_000 }, async () => {
    const { syncBuiltinESMExports } = await import('node:module');
    const cp = (await import('node:child_process')).default;
    const trips = new Array<{ child: FakeEnumChild; feed: (line: string) => void; close: () => void }>();
    const orig = cp.spawn;
    cp.spawn = (() => {
      const child = new FakeEnumChild();
      trips.push({
        child,
        feed: (line) => child.stdout.emit('data', line),
        close: () => child.emit('close', 0),
      });
      return child as unknown as import('node:child_process').ChildProcess;
    }) as typeof cp.spawn;
    syncBuiltinESMExports();
    resetEnumCacheForTest();
    /** 自旋到当前毫秒刚翻过：之后的同步调用背靠背落进同一个新毫秒窗，时序判定才确定 */
    const spinPastMsBoundary = (): void => {
      const b = Date.now();
      while (Date.now() === b) { /* 自旋等翻毫秒 */ }
    };
    try {
      // ── 场景一：在飞趟启程早于 fresh 请求 ⇒ 不搭它（1.2.6 的强制重枚举不能拿旧表充数），等它落地后自起一趟 ──
      const first = enumerateWinProcesses();
      spinPastMsBoundary(); // fresh 的请求时刻严格晚于第一趟的启程时刻
      const fresh = enumerateWinProcesses({ fresh: true });
      let freshSettled = false;
      void fresh.then(() => { freshSettled = true; });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(trips.length, 1, 'fresh 不得为启程更早的在飞趟抢跑兑现');
      assert.equal(freshSettled, false, '旧枚举未落地，fresh 不得兑现');
      // 旧枚举落地：表里只有 pid 424241（没有 fresh 关心的 424242）
      trips[0]!.feed('424241,0,2026-01-01T00:00:00.000000Z\n');
      trips[0]!.close();
      const old = await first;
      assert.ok(old && old.some((r) => r.pid === 424241));
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(trips.length, 2, '旧枚举落地后 fresh 应自起一趟新枚举');
      assert.equal(freshSettled, false, '新枚举未落地，fresh 仍不得兑现');
      trips[1]!.feed('424242,0,2026-01-01T00:00:00.000000Z\n');
      trips[1]!.close();
      const rows = await fresh;
      assert.ok(rows?.some((r) => r.pid === 424242), `fresh 兑现的应是含 424242 的新表，实测 ${JSON.stringify(rows)}`);

      // ── 场景二：在飞趟启程不早于 fresh 请求（同拍）⇒ 直接搭它，不自起——processStartTimes 两形态并发取值
      //    共享同一趟是缺省路径的时序前提（1.2.8 实测回归的钉子：多付一趟枚举会把 --start 的收尾拖进
      //    worker 已完成的窗口，触发终态被碾压的竞态） ──
      resetEnumCacheForTest();
      trips.length = 0;
      spinPastMsBoundary();
      const f1 = enumerateWinProcesses({ fresh: true });
      const f2 = enumerateWinProcesses({ fresh: true });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(trips.length, 1, '同拍的两个 fresh 应共享同一趟枚举，不得串行自起两趟');
      trips[0]!.feed('424243,0,2026-01-01T00:00:00.000000Z\n');
      trips[0]!.close();
      const [r1, r2] = await Promise.all([f1, f2]);
      assert.ok(r1?.some((r) => r.pid === 424243) && r2?.some((r) => r.pid === 424243), '两个 fresh 都应从共享的那趟拿到表');
    } finally {
      cp.spawn = orig;
      syncBuiltinESMExports();
      resetEnumCacheForTest();
    }
  });

test('取消旗标基线：回退量覆盖模块加载窗口与 FAT 粒度；陈旧旗标只记痕迹不触发收尾（CLAUDE-02）', async () => {
  assert.ok(CANCEL_FLAG_BASELINE_BACKOFF_MS >= 15_000, '回退量不得小于 15 秒');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cancelbase-'));
  try {
    const flag = path.join(dir, 'cancel.requested');
    await fs.writeFile(flag, '');
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(flag, stale, stale);
    let noted = false;
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown, cb?: (err?: Error) => void) => {
      if (typeof chunk === 'string' && chunk.includes('按陈旧忽略')) { noted = true; return cb?.() ?? true; }
      return orig(chunk as never, cb as never);
    }) as typeof process.stderr.write;
    const uninstall = installWorkerCancelFlagWatcher(dir);
    try {
      await new Promise((r) => setTimeout(r, 700));
    } finally {
      process.stderr.write = orig;
      uninstall();
    }
    assert.ok(noted, '陈旧旗标必须留痕（worker.log 收集），旗标被吞不再无从排查');
    // 触发路径（新旗标 → shutdown.begin）不在测试里跑：那会真起收尾链杀测试进程；
    // 触发判据（mtime ≥ 安装时刻−回退量）由回退量断言与 run-meta-cancel 的取消标记用例合守。
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
