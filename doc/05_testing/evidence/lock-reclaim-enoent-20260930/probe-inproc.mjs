#!/usr/bin/env node
/**
 * 零配额探针 · 同进程确定性复现（锁回收误判已删锁文件，EV-173 / EV-149）。
 *
 * 不改 src：只在本进程里给 `fs.promises` 的 readFile / rename 打桩，控制 `lock.js` 内部读锁、回收的先后时序。
 * `lock.ts` 以 `import { promises as fs } from 'node:fs'` 取的是同一个对象，调用时按属性查找，所以桩生效。
 *
 * 用法：node probe-inproc.mjs [lock.js 路径]（缺省为仓库 dist/test/src/trivium/lock.js，先 `node scripts/build.mjs --tests-only`）
 *
 * P1（EV-173 路径）：一把活着的临界区锁；`acquireLock` 撞 EEXIST 后读锁的那一刻，持有者恰好释放（桩在第一次读锁前删掉锁文件）。
 *    量：是否打出「回收…遗留锁（原因 unparsable）」告警；是否拿到锁。对照组 P1c 不删，应抛 70、无告警。
 * P2（EV-149 路径）：一把 pid 已不存在的遗留锁；回收者 B 判定之后、rename 之前，A 已回收并建好新锁 LA；
 *    B 的 rename 把 LA 挪走，B 复验期间 C 在空档里 link 成功；B 再把 LA 放回（rename 覆盖 C 的锁）。
 *    量：A、C 是否同时持有句柄；C 拿到句柄那一刻 A 的锁文件在哪里；锁路径最终内容是谁。
 */
import path from 'node:path';
import os from 'node:os';
import fsMod, { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const LOCK_MODULE = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist/test/src/trivium/lock.js'));
const lock = await import(LOCK_MODULE);

const TOPIC = '探针抢锁';
const origReadFile = fsMod.promises.readFile;
const origRename = fsMod.promises.rename;
const origOpen = fsMod.promises.open;

/** 截 stderr：`warn` 直接写 process.stderr */
function captureStderr() {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return true;
  };
  return { lines, restore: () => (process.stderr.write = orig) };
}

async function tmpTrivium() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-inproc-')));
}

function restoreFs() {
  fsMod.promises.readFile = origReadFile;
  fsMod.promises.rename = origRename;
  fsMod.promises.open = origOpen;
}

async function p1(deleteBeforeRead) {
  const dir = await tmpTrivium();
  const lockPath = path.join(dir, 'lock', `${TOPIC}.lock`);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  // 活着的临界区锁：本进程 pid、刚拿到——不属于任何遗留判据
  const live = await lock.acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: 120_000 });
  let injected = 0;
  // 旧构建读锁走 readFile(p)，新构建走 open(p)：撞 EEXIST 之后第一次按锁路径读，两种都拦
  const beforeRead = async (p) => {
    if (deleteBeforeRead && p === lockPath && injected === 0) {
      injected++;
      await fs.rm(lockPath, { force: true }); // 持有者恰在此刻释放
    }
  };
  fsMod.promises.readFile = async (p, ...rest) => {
    await beforeRead(p);
    return origReadFile(p, ...rest);
  };
  fsMod.promises.open = async (p, ...rest) => {
    await beforeRead(p);
    return origOpen(p, ...rest);
  };
  const cap = captureStderr();
  let outcome;
  try {
    const h = await lock.acquireLock({ triviumDir: dir, topic: TOPIC, heartbeatStaleMs: 120_000, retries: 0 });
    outcome = { acquired: true, holder_pid: h.content.pid };
    await h.release();
  } catch (e) {
    outcome = { acquired: false, code: e?.code ?? null, message: String(e?.message ?? e).split('\n')[0] };
  } finally {
    cap.restore();
    restoreFs();
  }
  void live;
  await fs.rm(dir, { recursive: true, force: true });
  const warnings = cap.lines.join('').split('\n').filter((l) => l.includes('回收主题'));
  return { delete_before_read: deleteBeforeRead, injected, ...outcome, reclaim_warnings: warnings };
}

async function p2() {
  const dir = await tmpTrivium();
  const lockPath = path.join(dir, 'lock', `${TOPIC}.lock`);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const dead = {
    topic: TOPIC, stage: 'code', run_id: 'R-DEAD', pid: 2 ** 22, pid_started_at: null,
    acquired_at: new Date(Date.now() - 60_000).toISOString(), kind: 'run',
  };
  await fs.writeFile(lockPath, JSON.stringify(dead, null, 2) + '\n');
  const opts = (runId) => ({ triviumDir: dir, topic: TOPIC, runId, kind: 'run', heartbeatStaleMs: 120_000, retries: 0 });
  const events = [];
  const snap = async (tag) => {
    let at = null;
    try { at = JSON.parse(await origReadFile(lockPath, 'utf8')).run_id; } catch { at = '(不存在)'; }
    const stale = (await fs.readdir(path.dirname(lockPath))).filter((n) => n.includes('.stale-'));
    events.push({ tag, lock_path_holds: at, stale_files: stale.length });
  };

  /*
   * B 在「判定之后、再碰锁路径之前」被扣住，直到 A 回收并建好新锁。扣留点取 B 对锁路径的**第二次**触碰
   * （第一次是撞 EEXIST 后的读锁）：旧构建第二次触碰是 rename(p)，新构建是 rename 之前的预检读——两者都在判定之后，
   * 对应真实场景里慢回收者卡在 judgeStale 的 ps 派生上。不能扣在 rename 上：新构建的 rename 在预检之后，扣在那里测的是残余窗口 R1。
   */
  let releaseB;
  const bHeld = new Promise((r) => (releaseB = r));
  let bReachedHold;
  const bAtHold = new Promise((r) => (bReachedHold = r));
  let bTouches = 0;
  let phase = 'B-solo';
  let cHandle = null;
  let cError = null;
  let cTriedAt = null;
  let aHandle = null;
  const touch = async (p) => {
    if (phase === 'B-solo' && p === lockPath && ++bTouches === 2) {
      phase = 'B-held';
      bReachedHold();
      await bHeld;
    }
  };
  const tryC = async (at) => {
    cTriedAt = at;
    try {
      cHandle = await lock.acquireLock(opts('R-C'));
      await snap('C 拿到句柄那一刻');
      events.push({ tag: 'C 拿到句柄时 A 是否仍持有', a_holds: aHandle !== null });
    } catch (e) {
      cError = { code: e?.code ?? null, message: String(e?.message ?? e).split('\n')[0] };
    }
  };
  const staleRead = async (p) => {
    if (phase === 'B-verify' && typeof p === 'string' && p.includes('.stale-')) {
      phase = 'done';
      await snap('B 已把 A 的活锁挪走、正在复验（空档）');
      await tryC('B 复验期间（空档）'); // C 在空档里抢
    }
  };
  fsMod.promises.rename = async (src, dst, ...rest) => {
    await touch(src);
    return origRename(src, dst, ...rest);
  };
  fsMod.promises.readFile = async (p, ...rest) => {
    await touch(p);
    await staleRead(p);
    return origReadFile(p, ...rest);
  };
  fsMod.promises.open = async (p, ...rest) => {
    await touch(p);
    await staleRead(p);
    return origOpen(p, ...rest);
  };

  const cap = captureStderr();
  let bOutcome;
  const bRun = lock
    .acquireLock(opts('R-B'))
    .then((h) => ({ acquired: true, h }))
    .catch((e) => ({ acquired: false, code: e?.code ?? null, message: String(e?.message ?? e).split('\n')[0] }));
  await bAtHold;
  try {
    phase = 'A';
    aHandle = await lock.acquireLock(opts('R-A'));
    await snap('A 回收并建好新锁之后');
    phase = 'B-verify';
    releaseB();
    bOutcome = await bRun;
    await snap('B 结束之后');
    // B 没有挪走 A 的锁（没读过 .stale-）时，C 在 A 仍持有的此刻照样抢一次——两个构建的 C 都真的抢过
    if (cTriedAt === null) await tryC('B 结束之后（A 仍持有）');
  } finally {
    cap.restore();
    restoreFs();
  }
  const warnings = cap.lines.join('').split('\n').filter((l) => l.includes('回收主题'));
  const result = {
    a_acquired: aHandle !== null,
    c_acquired: cHandle !== null,
    c_error: cError,
    c_tried_at: cTriedAt,
    b: bOutcome.acquired ? { acquired: true } : { acquired: false, code: bOutcome.code, message: bOutcome.message },
    double_holder: aHandle !== null && cHandle !== null,
    events,
    reclaim_warnings: warnings,
  };
  if (bOutcome.acquired) await bOutcome.h.release();
  if (cHandle) await cHandle.release();
  if (aHandle) await aHandle.release();
  await snap('A、C 各自 release 之后');
  result.after_release = events.at(-1);
  await fs.rm(dir, { recursive: true, force: true });
  return result;
}

const out = {
  lock_module: path.relative(ROOT, LOCK_MODULE),
  node: process.version,
  at: new Date().toISOString(),
  P1_enoent_after_eexist: await p1(true),
  P1c_control_no_delete: await p1(false),
  P2_reclaim_displaces_live_lock: await p2(),
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
