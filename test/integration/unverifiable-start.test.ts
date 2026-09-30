/**
 * 取不到启动时刻当不在（EV-175，计划 r2 §5.1）：工作进程**活着**、而本进程取不到它的启动时刻（满载下 `ps` 派生失败或超时）时，
 * 五处身份消费方都按「判不了」处置——不判失联、不算已不在、不整删不抹、`--cancel` 什么都不动并以 69 退出。
 *
 * 构造：另起一个真实的「工作进程」（detached 的 node 定时器，argv 带标记），先在**不拦**时取它两种形态的启动时刻写进记录，
 * 再用按 pid 过滤的 `ps` 失败桩（`stubPsFailure(…, { pids })`）只拦它——审查员 CLI 进程组记录的判定照常，信号发没发才分得清。
 * 每格装桩后自证（`psStubWorks(…, pid)`）、末尾断言被拦次数 > 0；进程在 `finally` 按组 SIGKILL 并等 exit；等待一律带超时。
 *
 * **不静态导入任何本主题新增的导出**（计划双审 r1 GLM-01）：测试构建逐文件转译，静态导入改前树不存在的具名导出会让整个文件
 * 加载失败，移植验收里回归格就无从变绿。纯函数真值表经动态 `import()` 取 `recordIdentityOf`，`identity` 按属性读。
 * 回归格（改前改后都应绿）与新行为格（改前应红）分成不同用例，名字里带「回归」二字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { cancelRun, runDirFor, waitRun } from '../../src/trivium/run-protocol.js';
import {
  interpretStatus, newStatus, readStatus, scrubAdmission, scrubHoldWhy, workerConfirmedGone, type RunStatus,
} from '../../src/trivium/status.js';
import { pruneRunDirs, scrubAllRunRoot } from '../../src/trivium/retention.js';
import { getGate, setGate } from '../../src/trivium/state.js';
import { lockPathFor } from '../../src/trivium/lock.js';
import { processMatchesRecord, processStartTime, processStartTimes, type RecordMatch } from '../../src/trivium/util/exec.js';
import { wiredAdapter } from '../../src/trivium/adapters/index.js';
import { RUN_DIR_FILES } from '../../src/trivium/run-files.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { psStubWorks, stubPsFailure, type PsForm } from '../helpers/ps-stub.js';
import { fakeCtx } from '../helpers/run-ctx.js';

const TOPIC = '判不了用例';
const OTHER_CANONICAL = 'Thu Jan  1 00:00:00 1970';
const DEAD_PID = 999_995;
const T = { timeout: 90_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) => fs.access(p).then(() => true, () => false);
const identityOf = (m: RecordMatch): unknown => (m as { identity?: unknown }).identity;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 带超时地等一个 Promise；超时即抛（变异让它等不到时用例要红而不是挂死） */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`等待超时（${ms} ms）：${what}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Proc {
  pid: number;
  exited: Promise<unknown>;
}

/** 另起一个对 SIGTERM 不设防的 detached 进程（自成一组）；跑完还活着即没收到信号 */
async function spawnMarked(mark: string, owned: Proc[]): Promise<Proc> {
  const child = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)', `trivium-ev175-test:${mark}`], {
    detached: true, stdio: 'ignore',
  });
  const exited = new Promise((r) => child.once('exit', r));
  const p = { pid: child.pid!, exited };
  owned.push(p);
  await sleep(120);
  return p;
}

/**
 * 夹具进程的两种启动时刻（代码双审 r1 CODEX-01）：两种都取到才返回。取不到时记录会落进「期望为假值即相符」，
 * 新行为格会以与被测缺陷几乎相同的文案翻红——所以在这里就以夹具问题判红，不让红因被误读。满载下偶发取不到，重试两次。
 */
async function fixtureRecord(pid: number): Promise<{ legacy: string; canonical: string }> {
  let r = await processStartTimes(pid);
  for (let i = 0; i < 2 && !(r.legacy && r.canonical); i++) {
    await sleep(100);
    r = await processStartTimes(pid);
  }
  assert.ok(
    r.legacy && r.canonical,
    `夹具进程 ${pid} 的启动时刻没取到（${JSON.stringify(r)}）：是测试环境问题，不是被测行为（此时还没装桩）`,
  );
  return { legacy: r.legacy!, canonical: r.canonical! };
}

/** 按组 SIGKILL 并等 exit；超时不静默（代码双审 r1 CODEX-02）：再补一次组信号，仍活着就抛错列出 pid */
async function killAll(owned: Proc[]): Promise<void> {
  const killGroups = () => {
    for (const p of owned) {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {
        // 已不在
      }
    }
  };
  killGroups();
  const settled = await within(Promise.all(owned.map((p) => p.exited)), 10_000, '收尾时进程退出').then(() => true, () => false);
  if (settled) return;
  killGroups();
  await sleep(500);
  const survivors = owned.filter((p) => isAlive(p.pid)).map((p) => p.pid);
  if (survivors.length > 0) throw new Error(`收尾后夹具进程仍活着：${survivors.join('、')}（请手工结束，argv 带 trivium-ev175-test 标记）`);
}

/** 以按 pid 过滤的桩运行 fn：装桩后自证、结束时断言确实拦到过、finally 复原 */
async function underStub<R>(which: PsForm, pid: number, fn: () => Promise<R>): Promise<R> {
  const stub = stubPsFailure(which, { pids: [pid] });
  try {
    const broken = await psStubWorks(which, pid);
    assert.equal(broken, null, broken ?? '');
    const blocked0 = stub.blocked;
    const r = await fn();
    assert.ok(stub.blocked > blocked0, `被测路径应至少调一次被拦的 ps（blocked=${stub.blocked}，自证前 ${blocked0}）`);
    return r;
  } finally {
    stub.restore();
  }
}

function mkStatus(o: {
  runId: string; pid: number; rec: { legacy: string | null; canonical: string | null }; canonical?: boolean;
  phase?: RunStatus['phase']; heartbeatAt?: string; cliPgid?: number; cliStart?: string | null; lost?: RunStatus['lost'];
}): RunStatus {
  const s = newStatus({ runId: o.runId, topic: TOPIC, stage: 'plan', sides: ['glm'], models: {} });
  s.phase = o.phase ?? 'running';
  s.worker_pid = o.pid;
  s.worker_started_at = o.rec.legacy;
  if (o.canonical === false) delete s.worker_started_at_canonical;
  else s.worker_started_at_canonical = o.rec.canonical;
  if (o.heartbeatAt) s.heartbeat_at = o.heartbeatAt;
  if (o.cliPgid !== undefined) s.sides.glm!.cli = { pgid: o.cliPgid, started_at: o.cliStart ?? null };
  if (o.lost) s.lost = o.lost;
  if (['success', 'failed', 'cancelled'].includes(s.phase)) {
    s.exit_code = EXIT.FAIL;
    s.message = `worker_lost（${o.lost?.reason ?? 'pid_gone'}）`;
  }
  return s;
}

/** 原样落盘（不经 writeStatus：它会把 heartbeat_at 刷成当下），返回凭据载体路径 */
async function seedRunDir(dir: string, s: RunStatus, workerPid: number | null = null): Promise<string> {
  const carrier = path.join(dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake-ev175"}}}');
  await fs.mkdir(path.join(dir, 'glm', 'out'), { recursive: true });
  await fs.writeFile(path.join(dir, RUN_DIR_FILES.status), JSON.stringify(s, null, 2) + '\n');
  if (workerPid !== null) await fs.writeFile(path.join(dir, RUN_DIR_FILES.workerPid), `${workerPid}\n`);
  return carrier;
}

async function seedLock(ctx: Ctx, runId: string, pid: number, rec: { legacy: string | null; canonical: string | null }) {
  const p = lockPathFor(ctx.triviumDir, TOPIC);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({
    topic: TOPIC, stage: 'plan', run_id: runId, pid, pid_started_at: rec.legacy, pid_started_at_canonical: rec.canonical,
    acquired_at: new Date().toISOString(), kind: 'run',
  }, null, 2) + '\n');
  return p;
}

async function fileFacts(p: string): Promise<string | null> {
  try {
    const st = await fs.stat(p, { bigint: true });
    const sha = createHash('sha256').update(await fs.readFile(p)).digest('hex');
    return `${st.dev}:${st.ino}:${st.mtimeNs}:${sha}`;
  } catch {
    return null;
  }
}

async function captureIO<R>(fn: () => Promise<R>): Promise<{ value?: R; error?: unknown; out: string; err: string }> {
  const ow = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((c: string | Uint8Array) => ((out += String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => ((err += String(c)), true)) as typeof process.stderr.write;
  try {
    return { value: await fn(), out, err };
  } catch (error) {
    return { error, out, err };
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

// ─────────────────────────── U1 三态结论 ───────────────────────────

test('EV-175 U1a：recordIdentityOf 真值表（动态导入：改前树没有这个导出即红）', async () => {
  const mod = (await import('../../src/trivium/util/exec.js')) as Record<string, unknown>;
  const f = mod['recordIdentityOf'] as ((m: object) => string) | undefined;
  assert.equal(typeof f, 'function', 'util/exec.js 应导出 recordIdentityOf');
  const cases: Array<[object, string]> = [
    [{ alive: true, sameProcess: true, startedAt: 'x', expected: 'x' }, 'same'],
    [{ alive: true, sameProcess: true, startedAt: null, expected: null }, 'same'], // 期望为假值即相符（quirk 保留）
    [{ alive: false, sameProcess: false, startedAt: null, expected: 'x' }, 'different'],
    [{ alive: false, sameProcess: false, startedAt: null, expected: null }, 'different'],
    [{ alive: true, sameProcess: false, startedAt: 'y', expected: 'x' }, 'different'],
    [{ alive: true, sameProcess: false, startedAt: null, expected: 'x' }, 'unverifiable'],
    [{ alive: true, sameProcess: false, startedAt: null, expected: null }, 'different'],
  ];
  for (const [m, want] of cases) assert.equal(f!(m), want, JSON.stringify(m));
});

test('EV-175 U1b：processMatchesRecord 的 identity——同一 / 不符 / 不在（两种 basis）/ 取不到（注入与按 pid 拦，两种 basis）', T, async () => {
  const owned: Proc[] = [];
  try {
    const self = await processStartTimes(process.pid);
    assert.ok(self.legacy && self.canonical, `本进程两种形态都应取到：${JSON.stringify(self)}`);
    assert.equal(identityOf(await processMatchesRecord(process.pid, self)), 'same');
    assert.equal(identityOf(await processMatchesRecord(process.pid, { canonical: OTHER_CANONICAL, legacy: self.legacy })), 'different');
    // 不在：规范化 basis（:623 那个 return，计划双审 r1 GLM-02）与 legacy basis 各一格
    assert.equal(identityOf(await processMatchesRecord(DEAD_PID, { canonical: OTHER_CANONICAL, legacy: null })), 'different');
    assert.equal(identityOf(await processMatchesRecord(DEAD_PID, { legacy: OTHER_CANONICAL })), 'different');
    // 注入取不到
    const inj = await processMatchesRecord(process.pid, self, { canonicalStartTimeOf: async () => null });
    assert.equal(identityOf(inj), 'unverifiable');

    const w = await spawnMarked('u1b', owned);
    const rec = await fixtureRecord(w.pid);
    const canon = await underStub('canonical', w.pid, () => processMatchesRecord(w.pid, rec));
    assert.equal(identityOf(canon), 'unverifiable', JSON.stringify(canon));
    const legacy = await underStub('legacy', w.pid, () => processMatchesRecord(w.pid, { legacy: rec.legacy }));
    assert.equal(identityOf(legacy), 'unverifiable', JSON.stringify(legacy));
    // 期望为假值：不比启动时刻，拦了也是 same（processAlive 对活进程照样取一次缺省形态，桩会被调到）
    const quirk = await underStub('legacy', w.pid, () => processMatchesRecord(w.pid, { legacy: null }));
    assert.equal(identityOf(quirk), 'same');
  } finally {
    await killAll(owned);
  }
});

test('EV-175 U1c（回归）：取不到时原五个字段与改前逐字相同', T, async () => {
  const owned: Proc[] = [];
  try {
    const w = await spawnMarked('u1c', owned);
    const rec = await fixtureRecord(w.pid);
    const canon = await underStub('canonical', w.pid, () => processMatchesRecord(w.pid, rec));
    assert.deepEqual(
      { alive: canon.alive, sameProcess: canon.sameProcess, startedAt: canon.startedAt, expected: canon.expected, basis: canon.basis },
      { alive: true, sameProcess: false, startedAt: null, expected: rec.canonical, basis: 'canonical' },
    );
    const legacy = await underStub('legacy', w.pid, () => processMatchesRecord(w.pid, { legacy: rec.legacy }));
    assert.deepEqual(
      { alive: legacy.alive, sameProcess: legacy.sameProcess, startedAt: legacy.startedAt, expected: legacy.expected, basis: legacy.basis },
      { alive: true, sameProcess: false, startedAt: null, expected: rec.legacy, basis: 'legacy' },
    );
    const same = await processMatchesRecord(w.pid, rec);
    assert.deepEqual([same.alive, same.sameProcess, same.startedAt], [true, true, rec.canonical]);
  } finally {
    await killAll(owned);
  }
});

// ─────────────────────────── U2 / U3 interpretStatus ───────────────────────────

test('EV-175 U2：情形 A（status.json 不存在）——给了 fallbackPidStartedAt 而取不到 ⇒ inconclusive；不给（生产形状）照旧 inconclusive', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u2-');
  try {
    const w = await spawnMarked('u2', owned);
    const rec = await fixtureRecord(w.pid);
    const dir = path.join(ctx.projectRoot, 'no-status');
    await fs.mkdir(dir, { recursive: true });
    const withExpected = await underStub('legacy', w.pid, () =>
      interpretStatus(dir, { heartbeatStaleMs: 120_000, fallbackPid: w.pid, fallbackPidStartedAt: rec.legacy }));
    assert.deepEqual(withExpected, { kind: 'inconclusive', reason: 'no_status_file' });
    const prod = await underStub('both', w.pid, () => interpretStatus(dir, { heartbeatStaleMs: 120_000, fallbackPid: w.pid }));
    assert.deepEqual(prod, { kind: 'inconclusive', reason: 'no_status_file' });
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

test('EV-175 U2′（回归）：情形 A 死 pid ⇒ pid_gone', async () => {
  const ctx = await fakeCtx('trivium-ev175-u2r-');
  try {
    const r = await interpretStatus(ctx.projectRoot, { heartbeatStaleMs: 120_000, fallbackPid: DEAD_PID, fallbackPidStartedAt: 'x' });
    assert.deepEqual(r, { kind: 'worker_lost', reason: 'pid_gone' });
  } finally {
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

test('EV-175 U3：情形 C——取不到时按心跳判：新鲜 ⇒ running（规范化 / 旧版记录），过期 ⇒ heartbeat_stale', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u3-');
  try {
    const w = await spawnMarked('u3', owned);
    const rec = await fixtureRecord(w.pid);
    const cases: Array<[string, RunStatus, PsForm, string]> = [
      ['canon-fresh', mkStatus({ runId: 'R', pid: w.pid, rec }), 'canonical', 'running'],
      ['legacy-fresh', mkStatus({ runId: 'R', pid: w.pid, rec, canonical: false }), 'legacy', 'running'],
      ['canon-stale', mkStatus({ runId: 'R', pid: w.pid, rec, heartbeatAt: new Date(Date.now() - 3600_000).toISOString() }), 'canonical', 'worker_lost/heartbeat_stale'],
    ];
    for (const [name, s, form, want] of cases) {
      const dir = path.join(ctx.projectRoot, name);
      await seedRunDir(dir, s);
      const r = await underStub(form, w.pid, () => interpretStatus(dir, { heartbeatStaleMs: 120_000 }));
      const got = r.kind === 'worker_lost' ? `worker_lost/${r.reason}` : r.kind;
      assert.equal(got, want, `${name}：${JSON.stringify(r).slice(0, 300)}`);
    }
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

test('EV-175 U3′（回归）：情形 C 规范化记录取到了且不符 ⇒ pid_gone；进程不在 ⇒ pid_gone', async () => {
  const ctx = await fakeCtx('trivium-ev175-u3r-');
  try {
    const self = await processStartTimes(process.pid);
    const a = path.join(ctx.projectRoot, 'reused');
    await seedRunDir(a, mkStatus({ runId: 'R', pid: process.pid, rec: { legacy: self.legacy, canonical: OTHER_CANONICAL } }));
    assert.deepEqual(await interpretStatus(a, { heartbeatStaleMs: 120_000 }), { kind: 'worker_lost', reason: 'pid_gone' });
    const b = path.join(ctx.projectRoot, 'dead');
    await seedRunDir(b, mkStatus({ runId: 'R', pid: DEAD_PID, rec: self }));
    assert.deepEqual(await interpretStatus(b, { heartbeatStaleMs: 120_000 }), { kind: 'worker_lost', reason: 'pid_gone' });
  } finally {
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────── U4 workerConfirmedGone ───────────────────────────

test('EV-175 U4：workerConfirmedGone 取不到 ⇒ 不算已不在、why 写明判不了；scrubAdmission 不准入（running 与 heartbeat_stale 后的 failed）', T, async () => {
  const owned: Proc[] = [];
  try {
    const w = await spawnMarked('u4', owned);
    const rec = await fixtureRecord(w.pid);
    const forms: RunStatus[] = [
      mkStatus({ runId: 'R', pid: w.pid, rec }),
      mkStatus({ runId: 'R', pid: w.pid, rec, phase: 'failed', lost: { reason: 'heartbeat_stale', at: new Date().toISOString() } }),
    ];
    for (const s of forms) {
      const g = await underStub('canonical', w.pid, () => workerConfirmedGone(s, null));
      assert.equal(g.gone, false, `${s.phase}：${g.why}`);
      assert.match(g.why, new RegExp(`工作进程 ${w.pid} 仍在，但取不到它的启动时刻：判不了`));
      const a = await underStub('canonical', w.pid, () => scrubAdmission(s, null));
      assert.equal(a.admit, false);
      assert.equal(scrubHoldWhy(a), g.why);
    }
  } finally {
    await killAll(owned);
  }
});

test('EV-175 U4′（回归）：workerConfirmedGone 同一进程 ⇒ 仍在；进程不在 ⇒ 已不存在', async () => {
  const self = await processStartTimes(process.pid);
  assert.deepEqual(await workerConfirmedGone(mkStatus({ runId: 'R', pid: process.pid, rec: self }), null),
    { gone: false, why: `工作进程 ${process.pid} 仍在` });
  assert.deepEqual(await workerConfirmedGone(mkStatus({ runId: 'R', pid: DEAD_PID, rec: self }), null),
    { gone: true, why: `工作进程 ${DEAD_PID} 已不存在` });
});

// ─────────────────────────── U5 清扫 ───────────────────────────

test('EV-175 U5：workerStillAlive 取不到当仍在——到期不整删、未到期不抹、跨仓清扫计 alive', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u5-');
  try {
    const w = await spawnMarked('u5', owned);
    const rec = await fixtureRecord(w.pid);
    const cfg = ctx.config;
    const proj = path.join(ctx.projectRoot, 'proj');

    const expired = runDirFor(cfg, proj, 'R-EXPIRED');
    const c1 = await seedRunDir(expired, mkStatus({ runId: 'R-EXPIRED', pid: w.pid, rec }));
    const pr = await underStub('canonical', w.pid, () =>
      pruneRunDirs(cfg, proj, { adapters: wiredAdapter, now: Date.now() + 31 * 86_400_000 }));
    assert.deepEqual(pr.removed, [], `到期也不整删：${JSON.stringify(pr)}`);
    assert.equal(pr.kept, 1);
    assert.ok(await exists(expired));
    assert.ok(await exists(c1), '载体应仍在');
    await fs.rm(expired, { recursive: true, force: true });

    const fresh = runDirFor(cfg, proj, 'R-FRESH');
    const c2 = await seedRunDir(fresh, mkStatus({ runId: 'R-FRESH', pid: w.pid, rec }));
    const pf = await underStub('canonical', w.pid, () => pruneRunDirs(cfg, proj, { adapters: wiredAdapter }));
    assert.deepEqual([pf.scrubbed, pf.deferred, pf.removed], [[], [], []], JSON.stringify(pf));
    assert.ok(await exists(c2), '未到期也不抹');

    const sw = await underStub('canonical', w.pid, () => scrubAllRunRoot(cfg, { adapters: wiredAdapter }));
    assert.equal(sw.alive, 1, JSON.stringify(sw));
    assert.deepEqual(sw.scrubbed, []);
    assert.ok(await exists(c2), '跨仓清扫也不抹');
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────── U6 / U7 cancelRun ───────────────────────────

test('EV-175 U6：cancelRun 主路径取不到 ⇒ 抛 69、什么都不动（不发信号、status / 锁 / 闸门 / 载体原样）', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u6-');
  try {
    const w = await spawnMarked('u6-worker', owned);
    const cli = await spawnMarked('u6-cli', owned);
    const rec = await fixtureRecord(w.pid);
    const cliStart = await processStartTime(cli.pid, { canonical: true });
    assert.ok(cliStart, 'CLI 组长的规范化启动时刻应取到');
    const runId = 'R-EV175-U6';
    const dir = runDirFor(ctx.config, ctx.projectRoot, runId);
    const carrier = await seedRunDir(dir, mkStatus({ runId, pid: w.pid, rec, cliPgid: cli.pid, cliStart }), w.pid);
    const lockPath = await seedLock(ctx, runId, w.pid, rec);
    await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });
    const statusPath = path.join(dir, RUN_DIR_FILES.status);
    const before = { status: await fileFacts(statusPath), lock: await fileFacts(lockPath) };

    const io = await underStub('both', w.pid, () => captureIO(() => cancelRun(ctx, runId)));
    const e = io.error as { code?: number; message?: string } | undefined;
    assert.ok(e, `应抛出而不是返回 ${String(io.value)}；stdout=${io.out} stderr=${io.err}`);
    assert.equal(e.code, EXIT.ENV, `退出码应为 69：${e.message}`);
    for (const frag of ['取不到工作进程', '本次不取消', '稍后重试', `review --worker ${runId}`, `kill -TERM -${w.pid}`]) {
      assert.ok(e.message!.includes(frag), `正文应含「${frag}」：${e.message}`);
    }
    assert.equal(io.out, '', 'stdout 应为空');
    assert.equal(await fileFacts(statusPath), before.status, 'status.json 不动');
    assert.equal(await fileFacts(lockPath), before.lock, '锁文件内容与身份不动');
    assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'running', '闸门不动');
    assert.ok(await exists(carrier), '凭据载体不抹');
    await sleep(300);
    assert.ok(isAlive(w.pid), '工作进程不应收到信号');
    assert.ok(isAlive(cli.pid), 'CLI 进程组不应收到信号');
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

test('EV-175 U6′（回归）：cancelRun 主路径不拦 ps ⇒ 退 0、工作进程收 SIGTERM 退出、锁回收、闸门 idle', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u6r-');
  try {
    const w = await spawnMarked('u6r-worker', owned);
    const rec = await fixtureRecord(w.pid);
    const runId = 'R-EV175-U6R';
    const dir = runDirFor(ctx.config, ctx.projectRoot, runId);
    await seedRunDir(dir, mkStatus({ runId, pid: w.pid, rec }), w.pid);
    const lockPath = await seedLock(ctx, runId, w.pid, rec);
    await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });
    const io = await captureIO(() => cancelRun(ctx, runId));
    assert.equal(io.value, EXIT.OK, `${String((io.error as Error | undefined)?.message)} ${io.err}`);
    await within(w.exited, 10_000, '工作进程收 SIGTERM 后退出');
    assert.equal(await exists(lockPath), false, '锁应已回收');
    assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'idle');
    assert.equal((await readStatus(dir))?.phase, 'cancelled');
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

test('EV-175 U7：cancelRun 终态分支（failed / pid_gone）取不到 ⇒ 不按记录结束活 worker 名下的 CLI', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u7-');
  try {
    const w = await spawnMarked('u7-worker', owned);
    const cli = await spawnMarked('u7-cli', owned);
    const rec = await fixtureRecord(w.pid);
    const cliStart = await processStartTime(cli.pid, { canonical: true });
    const runId = 'R-EV175-U7';
    const dir = runDirFor(ctx.config, ctx.projectRoot, runId);
    await seedRunDir(dir, mkStatus({
      runId, pid: w.pid, rec, phase: 'failed', lost: { reason: 'pid_gone', at: new Date().toISOString() }, cliPgid: cli.pid, cliStart,
    }), w.pid);
    const io = await underStub('both', w.pid, () => captureIO(() => cancelRun(ctx, runId)));
    assert.equal(io.value, EXIT.OK, String((io.error as Error | undefined)?.message));
    assert.match(io.out, /已处于终态（failed），无需取消/);
    assert.doesNotMatch(io.err, /按记录结束审查员 CLI/, io.err);
    await sleep(300);
    assert.ok(isAlive(cli.pid), 'CLI 进程组不应收到信号');
    assert.ok(isAlive(w.pid));
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});

// ─────────────────────────── U8 waitRun ───────────────────────────

test('EV-175 U8：waitRun 取不到——心跳新鲜 ⇒ 73、什么都不动；过期 ⇒ heartbeat_stale、凭据不抹、正文写明判不了', T, async () => {
  const owned: Proc[] = [];
  const ctx = await fakeCtx('trivium-ev175-u8-');
  try {
    const w = await spawnMarked('u8', owned);
    const rec = await fixtureRecord(w.pid);

    const fresh = 'R-EV175-U8F';
    const d1 = runDirFor(ctx.config, ctx.projectRoot, fresh);
    const c1 = await seedRunDir(d1, mkStatus({ runId: fresh, pid: w.pid, rec }), w.pid);
    await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId: fresh, heartbeatStaleMs: 120_000 });
    const r1 = await underStub('both', w.pid, () => captureIO(() => waitRun(ctx, fresh, 2)));
    assert.equal(r1.error, undefined, String((r1.error as Error | undefined)?.message));
    assert.equal(r1.value?.exitCode, EXIT.STILL_RUNNING);
    assert.equal((await readStatus(d1))?.phase, 'running');
    assert.ok(await exists(c1));
    assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'running');

    const stale = 'R-EV175-U8S';
    const d2 = runDirFor(ctx.config, ctx.projectRoot, stale);
    const c2 = await seedRunDir(d2, mkStatus({ runId: stale, pid: w.pid, rec, heartbeatAt: new Date(Date.now() - 3600_000).toISOString() }), w.pid);
    const r2 = await underStub('both', w.pid, () => captureIO(() => waitRun(ctx, stale, 2)));
    const e = r2.error as { code?: number; message?: string } | undefined;
    assert.ok(e, '心跳过期应判失联');
    assert.equal(e.code, EXIT.FAIL);
    assert.match(e.message!, /工作进程失联（heartbeat_stale）/);
    assert.match(e.message!, /凭据副本未抹：工作进程 \d+ 仍在，但取不到它的启动时刻：判不了/);
    const s2 = await readStatus(d2);
    assert.equal(s2?.phase, 'failed');
    assert.equal(s2?.lost?.reason, 'heartbeat_stale');
    assert.ok(await exists(c2), '凭据载体不抹');
  } finally {
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
});
