/**
 * 取消宽限期判不了仍放锁（EV-176，计划 r2 §5.1）：`--cancel` 主路径入口已判同一进程之后，工作进程的身份转为「判不了」
 * （活着而取不到启动时刻），或升级 SIGKILL 之后没确认退出——收尾一律不做（不写 cancelled、不回收锁与闸门、不补收、不抹），
 * 以 69 退出；「发送 SIGTERM」只在确实要发时播报；SIGKILL 之后至多等 `ORPHAN_KILL_CONFIRM_MS` 确认。
 *
 * 两层：
 * - T 系列直测 `terminateProcessGroup` 的三态：脚本化的 `isGone` 序列 + 注入的发信号实现（不起进程、毫秒级）；
 * - K 系列经 `cancelRun` 走真实工作进程（本进程的 detached 子进程，Node 自己回收，不留僵尸）。「判不了」由按 pid 过滤的
 *   `ps` 失败桩造（`stubPsFailure`，只用派生失败一种拦法；挂到 10 s 超时的形态只由探针实测，计划双审 r1 CODEX-03）；
 *   桩「何时开始拦」由 `allowFirst`（放过入口那次）或 `arm()`（用例包装 `process.kill`，观察到 SIGTERM / SIGKILL 时调）定。
 *   SIGKILL 的扣留 / 延迟投递也在这层包装里做（真实进程在 SIGKILL 下必死，零配额造不出「SIGKILL 后未确认」）。
 *   夹具进程等它经 stdout 报就绪（处理器已装好）才交给用例（EV-217，R1 自检这一点）。
 *
 * **不静态导入任何本主题新增的导出**（移植验收：测试构建逐文件转译，静态导入改前树不存在的具名导出会让整个文件加载失败）；
 * 新增的返回字段 `unverifiable` 按属性读。回归格（改前改后都应绿）名字里带「回归」二字，其余是新行为格（改前应红）。
 * 等「被测路径结束 / 进程退出」一律带超时（变异装置不给套件加超时）；`process.kill` 的包装在 `finally` 先还原、再收尾进程。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { cancelRun, runDirFor, workerGoneForCancel } from '../../src/trivium/run-protocol.js';
import { newStatus, readStatus, type RunStatus } from '../../src/trivium/status.js';
import { getGate, setGate } from '../../src/trivium/state.js';
import { lockPathFor } from '../../src/trivium/lock.js';
import { newRunMeta, readRunMeta, readTask, registerRun, writeRunMeta } from '../../src/trivium/meta.js';
import { processStartTime, processStartTimes, terminateProcessGroup } from '../../src/trivium/util/exec.js';
import { RUN_DIR_FILES } from '../../src/trivium/run-files.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { stubPsFailure, type PsStub } from '../helpers/ps-stub.js';
import { fakeCtx } from '../helpers/run-ctx.js';

const TOPIC = '取消宽限期用例';
const DEAD_PID = 999_994;
const T = { timeout: 90_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) => fs.access(p).then(() => true, () => false);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 带超时地等一个 Promise；超时即抛（变异让它等不到时用例要红而不是挂死） */
async function within<R>(p: Promise<R>, ms: number, what: string): Promise<R> {
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

// ─────────────────────────── T 系列：terminateProcessGroup 的三态 ───────────────────────────

/** 本主题前的返回类型没有 `unverifiable`：按属性读，改前树上读到 undefined */
const unverifiableOf = (r: object): unknown => (r as { unverifiable?: unknown }).unverifiable;

/** 按序给出判定的 `isGone`：序列用完后重复最后一个；记下被问了几次 */
function scripted(seq: Array<boolean | 'unverifiable'>) {
  const st = { calls: 0 };
  const isGone = () => {
    const v = seq[Math.min(st.calls, seq.length - 1)]!;
    st.calls++;
    return v;
  };
  return { st, isGone: isGone as () => boolean };
}

function recorder() {
  const sent: NodeJS.Signals[] = [];
  const hooks = { term: 0, escalate: 0 };
  return {
    sent,
    hooks,
    opts: {
      signal: (_p: number, sig: NodeJS.Signals) => (sent.push(sig), true),
      onTerm: () => void hooks.term++,
      onEscalate: () => void hooks.escalate++,
    },
  };
}

const FAST = { graceMs: 150, killWaitMs: 150, pollMs: 10 };

test('EV-176 T1：首检判不了 ⇒ 一个信号都不发、onTerm 不调、gone 为假且 unverifiable', async () => {
  const s = scripted(['unverifiable']);
  const r = recorder();
  const t = await terminateProcessGroup(4242, { ...FAST, isGone: s.isGone, ...r.opts });
  assert.deepEqual(r.sent, [], '不应发任何信号');
  assert.equal(r.hooks.term, 0, 'onTerm 不应调');
  assert.equal(t.gone, false, '判不了不算已退出');
  assert.equal(t.escalated, false);
  assert.equal(unverifiableOf(t), true);
});

test('EV-176 T2：宽限期里判不了 ⇒ 继续轮询，之后判已退出即返回（只发 SIGTERM）', async () => {
  const s = scripted([false, 'unverifiable', 'unverifiable', 'unverifiable', true]);
  const r = recorder();
  const t = await terminateProcessGroup(4242, { ...FAST, isGone: s.isGone, ...r.opts });
  // 先断言轮询次数：改前把判不了当已退出、问 2 次即返回，红因要直指这一点（onTerm 是本主题新增的回调，改前本就不调）
  assert.ok(s.st.calls >= 5, `判不了之后应继续轮询到判已退出（问了 ${s.st.calls} 次）`);
  assert.equal(t.gone, true);
  assert.deepEqual(r.sent, ['SIGTERM']);
  assert.equal(r.hooks.term, 1, 'onTerm 恰调一次');
  assert.equal(unverifiableOf(t), undefined);
});

test('EV-176 T3：宽限期满仍判不了 ⇒ 不升级 SIGKILL、onEscalate 不调、unverifiable、等满宽限', async () => {
  const s = scripted([false, 'unverifiable']);
  const r = recorder();
  const t0 = Date.now();
  const t = await terminateProcessGroup(4242, { ...FAST, isGone: s.isGone, ...r.opts });
  assert.deepEqual(r.sent, ['SIGTERM'], '不向身份判不了的进程发 SIGKILL');
  assert.equal(r.hooks.escalate, 0);
  assert.equal(t.gone, false);
  assert.equal(t.escalated, false);
  assert.equal(unverifiableOf(t), true);
  assert.ok(Date.now() - t0 >= FAST.graceMs, '应等满宽限期');
});

test('EV-176 T4：期中判不了、期满恢复为同一进程 ⇒ 照常升级 SIGKILL', async () => {
  const s = scripted([false, 'unverifiable', 'unverifiable', false]);
  const r = recorder();
  const t = await terminateProcessGroup(4242, { ...FAST, isGone: s.isGone, ...r.opts });
  assert.deepEqual(r.sent, ['SIGTERM', 'SIGKILL']);
  assert.equal(r.hooks.escalate, 1);
  assert.equal(t.gone, false);
  assert.equal(t.escalated, true);
  assert.equal(unverifiableOf(t), undefined, '最后一次判定是「仍是它」，不带 unverifiable');
});

test('EV-176 T5：SIGKILL 之后的等待窗里判不了 ⇒ escalated、gone 为假、unverifiable', async () => {
  const r = recorder();
  const st = { killed: false };
  const t = await terminateProcessGroup(4242, {
    ...FAST,
    isGone: (() => (st.killed ? 'unverifiable' : false)) as () => boolean,
    ...r.opts,
    signal: (p, sig) => {
      if (sig === 'SIGKILL') st.killed = true;
      return r.opts.signal(p, sig);
    },
  });
  assert.deepEqual(r.sent, ['SIGTERM', 'SIGKILL']);
  assert.equal(t.escalated, true);
  assert.equal(t.gone, false, 'SIGKILL 之后判不了不算已退出');
  assert.equal(unverifiableOf(t), true);
});

test('EV-176 T6（回归）：布尔判据的四种序列与改前逐字相同', async () => {
  // (a) 首检即已退出：一个信号都不发
  {
    const r = recorder();
    const t = await terminateProcessGroup(4242, { ...FAST, isGone: scripted([true]).isGone, signal: r.opts.signal });
    assert.deepEqual({ ...t, sent: r.sent }, { gone: true, escalated: false, signals: [], sent: [] });
  }
  // (b) 宽限内退出
  {
    const r = recorder();
    const t = await terminateProcessGroup(4242, { ...FAST, isGone: scripted([false, false, true]).isGone, signal: r.opts.signal });
    assert.deepEqual({ ...t, sent: r.sent }, { gone: true, escalated: false, signals: ['SIGTERM'], sent: ['SIGTERM'] });
  }
  // (c) 一直不退：升级后等满仍未确认
  {
    const r = recorder();
    const t = await terminateProcessGroup(4242, { ...FAST, isGone: scripted([false]).isGone, signal: r.opts.signal });
    assert.deepEqual({ ...t, sent: r.sent }, {
      gone: false, escalated: true, signals: ['SIGTERM', 'SIGKILL'], sent: ['SIGTERM', 'SIGKILL'],
    });
  }
  // (d) killWaitMs 为 0：升级后只判一次
  {
    const r = recorder();
    const st = { killed: false };
    const t = await terminateProcessGroup(4242, {
      ...FAST, killWaitMs: 0, isGone: () => st.killed,
      signal: (p, sig) => ((st.killed = sig === 'SIGKILL'), r.opts.signal(p, sig)),
    });
    assert.deepEqual({ ...t, sent: r.sent }, { gone: true, escalated: true, signals: ['SIGTERM', 'SIGKILL'], sent: ['SIGTERM', 'SIGKILL'] });
  }
});

// ─────────────────────────── 真实进程夹具 ───────────────────────────

interface Proc {
  pid: number;
  exited: Promise<unknown>;
}

const PROGRAMS = {
  /** 对 SIGTERM 不设防：收到即死 */
  default: 'setInterval(() => {}, 1e6)',
  /** 收到 SIGTERM 300 ms 后退出（「很快就退」，但不在首次轮询之前） */
  delay300ms: "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300)); setInterval(() => {}, 1e6)",
  /** 收到 SIGTERM 3 s 后才退出 */
  delay3s: "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 3000)); setInterval(() => {}, 1e6)",
  /** 忽略 SIGTERM */
  ignore: "process.on('SIGTERM', () => {}); setInterval(() => {}, 1e6)",
  /** 只给夹具自检用（EV-217 R1）：先忙等 500 ms 再装「忽略 SIGTERM」，模拟高负载下 `node -e` 迟迟装不上处理器 */
  slowIgnore: "const t0 = Date.now(); while (Date.now() - t0 < 500) {} process.on('SIGTERM', () => {}); setInterval(() => {}, 1e6)",
} as const;

/** 夹具程序执行完（处理器已装好）后经 stdout 打的就绪标记 */
const READY_MARK = 'trivium-ev217-ready';
/** 等就绪标记的上界：超时以「测试环境问题」判红，不当成被测行为 */
const READY_TIMEOUT_MS = 20_000;

/**
 * 起一个带标记的夹具进程，**等它报就绪再返回**（EV-217）：程序正文执行完才经 stdout 打 `READY_MARK`，
 * 所以返回时各程序的 SIGTERM 处理器已经装好。原先固定等 150 ms，负载高时 `node -e` 启动慢过这段时间，
 * SIGTERM 落在装处理器之前、进程按默认处置直接退出（K 格偶发红的推断成因，按读数推断、未实测复现）。
 */
async function spawnMarked(mark: string, program: keyof typeof PROGRAMS, owned: Proc[]): Promise<Proc> {
  const code = `${PROGRAMS[program]}; process.stdout.write(${JSON.stringify(`${READY_MARK}\n`)})`;
  const child = childProcess.spawn(process.execPath, ['-e', code, `trivium-ev176-test:${mark}`], {
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const exited = new Promise((r) => child.once('exit', r));
  const p = { pid: child.pid!, exited };
  owned.push(p);
  const ready = new Promise<void>((resolve, reject) => {
    let buf = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (c: string) => {
      buf += c;
      if (buf.includes(READY_MARK)) resolve();
    });
    child.once('exit', (c, s) => reject(new Error(`夹具进程 ${mark} 没报就绪就退出了（code=${c} signal=${s}）`)));
  });
  try {
    await within(ready, READY_TIMEOUT_MS, `夹具进程 ${mark} 报就绪（测试环境问题，不是被测行为）`);
  } finally {
    // 只读这一行：读端关掉，之后程序不再写 stdout
    child.stdout!.destroy();
  }
  return p;
}

/** 夹具进程的两种启动时刻：两种都取到才返回，取不到以「测试环境问题」判红（此时还没装桩） */
async function fixtureRecord(pid: number): Promise<{ legacy: string; canonical: string }> {
  let r = await processStartTimes(pid);
  for (let i = 0; i < 2 && !(r.legacy && r.canonical); i++) {
    await sleep(100);
    r = await processStartTimes(pid);
  }
  assert.ok(r.legacy && r.canonical, `夹具进程 ${pid} 的启动时刻没取到（${JSON.stringify(r)}）：是测试环境问题，不是被测行为`);
  return { legacy: r.legacy!, canonical: r.canonical! };
}

/** 按组 SIGKILL 并等 exit；超时不静默：仍活着就抛错列出 pid */
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
  if (survivors.length > 0) throw new Error(`收尾后夹具进程仍活着：${survivors.join('、')}（请手工结束，argv 带 trivium-ev176-test 标记）`);
}

/**
 * 包装 `process.kill`：记下发给工作进程（组）的每个非 0 信号；按需在 SIGTERM / SIGKILL 时回调（给桩 `arm()`），
 * 扣下 SIGKILL（`dropKill`）或延迟投递（`delayKillMs`）。发给别的 pid（CLI 组）的信号照常。
 */
function watchKills(pid: number, o: { onTerm?: () => void; onKill?: () => void; dropKill?: boolean; delayKillMs?: number } = {}) {
  const orig = process.kill;
  const sent: string[] = [];
  const timers: NodeJS.Timeout[] = [];
  process.kill = function (target: number, sig?: string | number): true {
    if ((target === pid || target === -pid) && sig !== 0 && sig !== undefined) {
      sent.push(String(sig));
      if (sig === 'SIGTERM') o.onTerm?.();
      if (sig === 'SIGKILL') {
        o.onKill?.();
        if (o.dropKill) return true;
        if (o.delayKillMs !== undefined) {
          timers.push(setTimeout(() => {
            try {
              orig.call(process, target, sig);
            } catch {
              // 已不在
            }
          }, o.delayKillMs));
          return true;
        }
      }
    }
    return orig.call(process, target, sig as NodeJS.Signals);
  } as typeof process.kill;
  return {
    sent,
    restore: () => {
      for (const t of timers) clearTimeout(t);
      process.kill = orig;
    },
  };
}

function mkStatus(runId: string, pid: number, rec: { legacy: string; canonical: string }, cli?: { pgid: number; started_at: string }): RunStatus {
  const s = newStatus({ runId, topic: TOPIC, stage: 'plan', sides: ['glm'], models: {} });
  s.phase = 'running';
  s.worker_pid = pid;
  s.worker_started_at = rec.legacy;
  s.worker_started_at_canonical = rec.canonical;
  if (cli) s.sides.glm!.cli = cli;
  return s;
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

/** 一轮 running 的运行：运行目录（凭据载体、worker.pid）、主题锁、闸门 running、归档 run.json 骨架与 task.json 登记 */
async function seedCancelRun(ctx: Ctx, runId: string, w: Proc, rec: { legacy: string; canonical: string }, cli?: Proc) {
  const dir = runDirFor(ctx.config, ctx.projectRoot, runId);
  const carrier = path.join(dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake-ev176"}}}');
  await fs.mkdir(path.join(dir, 'glm', 'out'), { recursive: true });
  let cliRec: { pgid: number; started_at: string } | undefined;
  if (cli) {
    const cliStart = await processStartTime(cli.pid, { canonical: true });
    assert.ok(cliStart, 'CLI 组长的规范化启动时刻应取到（测试环境问题，不是被测行为）');
    cliRec = { pgid: cli.pid, started_at: cliStart };
  }
  await fs.writeFile(path.join(dir, RUN_DIR_FILES.status), JSON.stringify(mkStatus(runId, w.pid, rec, cliRec), null, 2) + '\n');
  await fs.writeFile(path.join(dir, RUN_DIR_FILES.workerPid), `${w.pid}\n`);

  const lockPath = lockPathFor(ctx.triviumDir, TOPIC);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify({
    topic: TOPIC, stage: 'plan', run_id: runId, pid: w.pid, pid_started_at: rec.legacy, pid_started_at_canonical: rec.canonical,
    acquired_at: new Date().toISOString(), kind: 'run',
  }, null, 2) + '\n');
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });

  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  const m = newRunMeta({
    runId, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: null, taskGoal: null,
    criticsSelected: ['glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
  });
  await writeRunMeta(layout, 'plan', m);
  await registerRun(layout, m, { triviumDir: ctx.triviumDir, heartbeatStaleMs: 120_000 });
  return { dir, carrier, lockPath, layout, statusPath: path.join(dir, RUN_DIR_FILES.status) };
}

type Seeded = Awaited<ReturnType<typeof seedCancelRun>>;

async function facts(ctx: Ctx, seeded: Seeded, runId: string) {
  return {
    phase: (await readStatus(seeded.dir))?.phase ?? null,
    lock: await exists(seeded.lockPath),
    gate: (await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state ?? null,
    carrier: await exists(seeded.carrier),
    archive: (await readRunMeta(seeded.layout, 'plan', runId).catch(() => null))?.status ?? null,
    task: (await readTask(seeded.layout)).runs.find((r) => r.run_id === runId)?.status ?? null,
  };
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

/** `cancelRun` 带超时跑完（它自己的上界约 10 s 加上按记录结束 CLI 的 3 s 链） */
const cancelWithin = (ctx: Ctx, runId: string) => captureIO(() => within(cancelRun(ctx, runId), 40_000, 'cancelRun 结束'));

/** 断言以 69 退出、什么收尾都没做：status / 锁文件（内容与身份）/ 闸门 / 载体 / 归档 / 登记原样 */
async function assertUntouched(
  ctx: Ctx, seeded: Seeded, runId: string, io: Awaited<ReturnType<typeof captureIO>>, lockBefore: string | null,
  frags: string[],
): Promise<string> {
  const e = io.error as { code?: number; message?: string } | undefined;
  assert.ok(e, `应抛出而不是返回 ${String(io.value)}；stdout=${io.out} stderr=${io.err}`);
  assert.equal(e.code, EXIT.ENV, `退出码应为 69：${e.message}`);
  for (const f of frags) assert.ok(e.message!.includes(f), `正文应含「${f}」：${e.message}`);
  assert.equal(io.out, '', `stdout 应为空：${io.out}`);
  assert.deepEqual(await facts(ctx, seeded, runId), {
    phase: 'running', lock: true, gate: 'running', carrier: true, archive: 'running', task: 'running',
  }, '什么收尾都不做：status / 锁 / 闸门 / 载体 / 归档 / 登记原样');
  assert.equal(await fileFacts(seeded.lockPath), lockBefore, '锁文件内容与身份不动');
  return e.message!;
}

async function assertFinalized(ctx: Ctx, seeded: Seeded, runId: string, io: Awaited<ReturnType<typeof captureIO>>): Promise<void> {
  assert.equal(io.value, EXIT.OK, `应退 0：${String((io.error as Error | undefined)?.message)}\nstderr=${io.err}`);
  assert.deepEqual(await facts(ctx, seeded, runId), {
    phase: 'cancelled', lock: false, gate: 'idle', carrier: false, archive: 'cancelled', task: 'cancelled',
  }, `确认退出后收尾完整（凭据已抹、归档与登记 cancelled）；stderr=${io.err}`);
}

// ─────────────────────────── R1 夹具自检（EV-217） ───────────────────────────

test('EV-217 R1（夹具）：spawnMarked 返回时 SIGTERM 处理器已装好——处理器装得慢也不会被 SIGTERM 打死', T, async () => {
  const owned: Proc[] = [];
  try {
    const t0 = Date.now();
    const w = await spawnMarked('r1', 'slowIgnore', owned);
    const ms = Date.now() - t0;
    assert.ok(ms >= 500, `应等到程序忙等完、装好处理器才返回（${ms} ms）`);
    process.kill(w.pid, 'SIGTERM');
    const died = await within(w.exited, 500, '夹具进程退出').then(() => true, () => false);
    assert.equal(died, false, '返回之后发的 SIGTERM 应被已装好的处理器接住，进程不该退出');
  } finally {
    await killAll(owned);
  }
});

// ─────────────────────────── W1 workerGoneForCancel ───────────────────────────

test('EV-176 W1：workerGoneForCancel——取不到 ⇒ unverifiable；同一进程 ⇒ false；不在 ⇒ true', T, async () => {
  const owned: Proc[] = [];
  try {
    const w = await spawnMarked('w1', 'default', owned);
    const rec = await fixtureRecord(w.pid);
    assert.equal(await workerGoneForCancel(w.pid, rec), false, '同一进程');
    assert.equal(await workerGoneForCancel(DEAD_PID, rec), true, '不在');
    const stub = stubPsFailure('both', { pids: [w.pid] });
    try {
      assert.equal(await workerGoneForCancel(w.pid, rec), 'unverifiable', '活着而取不到启动时刻应判不了，而不是已退出');
      assert.ok(stub.blocked > 0, '桩应拦到');
    } finally {
      stub.restore();
    }
  } finally {
    await killAll(owned);
  }
});

test('EV-177 W2：lostWorkerGoneJudgment——取不到 ⇒ unverifiable；同一进程 ⇒ false；不在 ⇒ true；布尔的 lostWorkerGone 不变', T, async () => {
  // 动态导入：与文件头同一约定（静态导入新导出会让移植到改前树的测试文件整份加载失败）
  const rp = (await import('../../src/trivium/run-protocol.js')) as unknown as Record<string, unknown>;
  const judgment = rp.lostWorkerGoneJudgment as (pid: number, rec: { legacy: string; canonical: string }) => Promise<unknown>;
  const lostWorkerGone = rp.lostWorkerGone as (pid: number, rec: { legacy: string; canonical: string }) => Promise<boolean>;
  assert.equal(typeof judgment, 'function', '应导出 lostWorkerGoneJudgment');
  const owned: Proc[] = [];
  try {
    const w = await spawnMarked('w2', 'default', owned);
    const rec = await fixtureRecord(w.pid);
    assert.equal(await judgment(w.pid, rec), false, '同一进程');
    assert.equal(await judgment(DEAD_PID, rec), true, '不在');
    const stub = stubPsFailure('both', { pids: [w.pid] });
    try {
      assert.equal(await judgment(w.pid, rec), 'unverifiable', '活着而取不到启动时刻应判不了');
      assert.equal(await lostWorkerGone(w.pid, rec), false, '布尔口径不变：判不了即「仍在」');
      assert.ok(stub.blocked > 0, '桩应拦到');
    } finally {
      stub.restore();
    }
  } finally {
    await killAll(owned);
  }
});

// ─────────────────────────── K 系列：cancelRun 主路径 ───────────────────────────

/** 一格：起工作进程（与可选的 CLI）、预置运行、装桩与信号包装、跑 cancelRun，收尾按序还原 */
async function kCell(
  name: string,
  o: {
    program: keyof typeof PROGRAMS;
    cli?: boolean;
    /** 把 status.json 摆成 `--wait` 判过失联的样子（EV-177：入失联后取消那一格 `cancelLostWorker`） */
    lost?: boolean;
    stub?: (pid: number) => PsStub;
    kills?: (pid: number, stub: PsStub | null) => Parameters<typeof watchKills>[1];
  },
  body: (c: {
    ctx: Ctx; runId: string; w: Proc; cli: Proc | null; seeded: Seeded; io: Awaited<ReturnType<typeof captureIO>>;
    sent: string[]; stub: PsStub | null; lockBefore: string | null; ms: number;
  }) => Promise<void>,
): Promise<void> {
  const owned: Proc[] = [];
  const ctx = await fakeCtx(`trivium-ev176-${name}-`);
  let stub: PsStub | null = null;
  let kills: ReturnType<typeof watchKills> | null = null;
  try {
    const w = await spawnMarked(`${name}-worker`, o.program, owned);
    const cli = o.cli ? await spawnMarked(`${name}-cli`, 'default', owned) : null;
    const rec = await fixtureRecord(w.pid);
    const runId = `R-EV176-${name}`;
    const seeded = await seedCancelRun(ctx, runId, w, rec, cli ?? undefined);
    if (o.lost) {
      const s = JSON.parse(await fs.readFile(seeded.statusPath, 'utf8')) as RunStatus;
      s.phase = 'failed';
      s.exit_code = EXIT.FAIL;
      s.message = 'worker_lost（heartbeat_stale）';
      s.lost = { reason: 'heartbeat_stale', at: new Date().toISOString() };
      await fs.writeFile(seeded.statusPath, JSON.stringify(s, null, 2) + '\n');
    }
    const lockBefore = await fileFacts(seeded.lockPath);
    stub = o.stub ? o.stub(w.pid) : null;
    kills = watchKills(w.pid, o.kills ? o.kills(w.pid, stub) : {});
    const t0 = Date.now();
    const io = await cancelWithin(ctx, runId);
    const ms = Date.now() - t0;
    const sent = [...kills.sent];
    await body({ ctx, runId, w, cli, seeded, io, sent, stub, lockBefore, ms });
  } finally {
    kills?.restore();
    stub?.restore();
    await killAll(owned);
    await fs.rm(ctx.projectRoot, { recursive: true, force: true });
  }
}

test('EV-176 K-Z1：入口判同一进程之后首检即判不了 ⇒ 零信号、69、不播报「发送 SIGTERM」、什么都不动', T, async () => {
  await kCell('Z1', {
    program: 'default',
    stub: (pid) => stubPsFailure('both', { pids: [pid], allowFirst: 1 }),
  }, async ({ ctx, runId, w, seeded, io, sent, stub, lockBefore }) => {
    assert.equal(stub!.allowed, 1, '入口那次判定应放过（桩自证）');
    assert.ok(stub!.blocked > 0, '入口之后应拦到（桩自证）');
    await assertUntouched(ctx, seeded, runId, io, lockBefore, ['取不到工作进程', '本次不取消', '未发信号', `review --worker ${runId}`]);
    assert.deepEqual(sent, [], '一个信号都不应发');
    assert.ok(!io.err.includes('发送 SIGTERM'), `没发就不能说发了：${io.err}`);
    assert.ok(isAlive(w.pid), '工作进程应仍活着');
  });
});

test('EV-176 K-G1：宽限期里判不了、工作进程 3 s 后才退出 ⇒ 继续等到它真退出，收尾完整（凭据已抹、归档 cancelled）', T, async () => {
  await kCell('G1', {
    program: 'delay3s',
    stub: (pid) => stubPsFailure('both', { pids: [pid], startArmed: false }),
    kills: (_pid, stub) => ({ onTerm: () => stub!.arm() }),
  }, async ({ ctx, runId, w, seeded, io, sent, stub }) => {
    assert.ok(stub!.blocked > 0, 'SIGTERM 之后应拦到（桩自证）');
    assert.deepEqual(sent, ['SIGTERM']);
    await within(w.exited, 5_000, '工作进程已退出');
    await assertFinalized(ctx, seeded, runId, io);
  });
});

test('EV-176 K-G2：宽限期满仍判不了（忽略 SIGTERM）⇒ 不升级 SIGKILL、按记录结束 CLI、69、其余什么都不动', T, async () => {
  await kCell('G2', {
    program: 'ignore',
    cli: true,
    stub: (pid) => stubPsFailure('both', { pids: [pid], startArmed: false }),
    kills: (_pid, stub) => ({ onTerm: () => stub!.arm() }),
  }, async ({ ctx, runId, w, cli, seeded, io, sent, stub, lockBefore, ms }) => {
    assert.ok(stub!.blocked > 0, 'SIGTERM 之后应拦到（桩自证）');
    const msg = await assertUntouched(ctx, seeded, runId, io, lockBefore, ['发送 SIGTERM', '判不了', '不升级 SIGKILL', '本次不收尾']);
    // SIGTERM 已发过而它没退出：手工出路给按组 SIGKILL，不再让人发 SIGTERM（代码双审 r1 CODEX-01 ≡ GLM-01）
    assert.ok(msg.includes(`kill -KILL -${w.pid}`) && !msg.includes('kill -TERM'), `手工出路应是按组 SIGKILL：${msg}`);
    assert.deepEqual(sent, ['SIGTERM'], '不向身份判不了的进程发 SIGKILL');
    assert.ok(ms >= 4_900, `应等满宽限期（${ms} ms）`);
    await within(cli!.exited, 10_000, 'CLI 组应被按记录结束');
    assert.ok(isAlive(w.pid), '工作进程应仍活着（忽略 SIGTERM、没收到 SIGKILL）');
  });
});

test('EV-176 K-G3：宽限期里判不了、工作进程收 SIGTERM 300 ms 后退出 ⇒ 轮询到它不在，收尾完整', T, async () => {
  // 不用「收到即死」：那一格改前的结局取决于首次轮询与进程回收谁先（探针 G3 两次读数一漏一全），移植验收要的是确定的红；
  // 300 ms 保证改前首次轮询时它还活着（判不了即当已退出），之后的凭据准入也还在它退出之前
  await kCell('G3', {
    program: 'delay300ms',
    stub: (pid) => stubPsFailure('both', { pids: [pid], startArmed: false }),
    kills: (_pid, stub) => ({ onTerm: () => stub!.arm() }),
  }, async ({ ctx, runId, w, seeded, io, sent }) => {
    assert.deepEqual(sent, ['SIGTERM']);
    await within(w.exited, 5_000, '工作进程已退出');
    await assertFinalized(ctx, seeded, runId, io);
  });
});

test('EV-176 K-K1：SIGKILL 扣下、等满仍是同一进程 ⇒ 按记录结束 CLI、69、其余什么都不动', T, async () => {
  await kCell('K1', {
    program: 'ignore',
    cli: true,
    kills: () => ({ dropKill: true }),
  }, async ({ ctx, runId, w, cli, seeded, io, sent, lockBefore }) => {
    const msg = await assertUntouched(ctx, seeded, runId, io, lockBefore, ['SIGTERM、SIGKILL', '仍是同一进程', '本次不收尾']);
    // 「没动」只说本命令：按记录结束了 CLI，活着的工作进程可能随后自己收尾（代码双审 r1 CODEX-01）
    assert.ok(msg.includes('本命令没有动') && msg.includes('可能自己收尾'), `正文应限定为本命令的动作：${msg}`);
    assert.deepEqual(sent, ['SIGTERM', 'SIGKILL']);
    await within(cli!.exited, 10_000, 'CLI 组应被按记录结束');
    assert.ok(isAlive(w.pid), '工作进程应仍活着（SIGKILL 被扣下）');
  });
});

test('EV-176 K-K3：SIGKILL 延迟 300 ms 才生效（不带 CLI 记录）⇒ 等到确认退出，收尾完整', T, async () => {
  // 不带 CLI 组记录（计划双审 r1 GLM-03）：改前「SIGKILL 后不等」要红，依赖 scrubAdmission 早于 300 ms 的投递执行；
  // 带了 CLI 记录则 2 s + 1 s 的按记录结束链会跨过 300 ms，改前也收全、这一格就分不出新旧
  await kCell('K3', {
    program: 'ignore',
    kills: () => ({ delayKillMs: 300 }),
  }, async ({ ctx, runId, w, seeded, io, sent }) => {
    assert.deepEqual(sent, ['SIGTERM', 'SIGKILL']);
    await within(w.exited, 5_000, '工作进程已退出');
    await assertFinalized(ctx, seeded, runId, io);
  });
});

test('EV-176 K-K4：SIGKILL 扣下、之后才取不到启动时刻 ⇒ 69、正文说 SIGKILL 之后判不了、什么都不动', T, async () => {
  await kCell('K4', {
    program: 'ignore',
    stub: (pid) => stubPsFailure('both', { pids: [pid], startArmed: false }),
    kills: (_pid, stub) => ({ dropKill: true, onKill: () => stub!.arm() }),
  }, async ({ ctx, runId, w, seeded, io, sent, stub, lockBefore }) => {
    assert.ok(stub!.blocked > 0, 'SIGKILL 之后应拦到（桩自证）');
    const msg = await assertUntouched(ctx, seeded, runId, io, lockBefore, ['SIGKILL 之后', '判不了', '本次不收尾', `review --worker ${runId}`]);
    assert.ok(msg.includes(`kill -KILL -${w.pid}`) && !msg.includes('kill -TERM'), `手工出路应是按组 SIGKILL：${msg}`);
    assert.deepEqual(sent, ['SIGTERM', 'SIGKILL']);
    assert.ok(isAlive(w.pid));
  });
});

test('EV-176 K-C0（回归）：不拦 ⇒ 退 0、工作进程收 SIGTERM 退出、收尾完整', T, async () => {
  await kCell('C0', { program: 'default' }, async ({ ctx, runId, w, seeded, io, sent }) => {
    assert.deepEqual(sent, ['SIGTERM']);
    await within(w.exited, 5_000, '工作进程已退出');
    await assertFinalized(ctx, seeded, runId, io);
    assert.ok(io.err.includes('发送 SIGTERM'), `发了就要说：${io.err}`);
  });
});

test('EV-176 K-E1（回归）：入口即判不了 ⇒ 69，正文与 EV-175 逐字相同、什么都不动', T, async () => {
  await kCell('E1', {
    program: 'default',
    stub: (pid) => stubPsFailure('both', { pids: [pid] }),
  }, async ({ ctx, runId, w, seeded, io, sent, lockBefore }) => {
    const msg = await assertUntouched(ctx, seeded, runId, io, lockBefore, []);
    const pid = w.pid;
    assert.equal(
      msg,
      `取不到工作进程 ${pid} 的启动时刻（ps 未返回），判不了它是不是 status.json 记录的那个工作进程：本次不取消——` +
        '未发信号，status.json、主题锁、闸门、归档与凭据副本都没动。请稍后重试 ' +
        `trivium review --cancel ${runId}。一直取不到时：先在终端确认 ${pid} 的命令行含 review --worker ${runId}` +
        `（ps -p ${pid} -o command=），确认是它、要结束这一轮，就在终端按组结束它（kill -TERM -${pid}），` +
        '之后再跑一次 --cancel，会按「已不存在」回收锁与闸门、按记录结束审查员 CLI',
    );
    assert.deepEqual(sent, []);
  });
});

// ─────────────────────────── L 系列：失联后取消那一格（EV-177 ①） ───────────────────────────

/** 失联那一格未确认退出：退 69（EV-177 ②，与主路径同口径）、归档 / 登记 / 锁 / 闸门原样、status.json 仍是失联判定时的样子 */
async function assertLostUntouched(ctx: Ctx, seeded: Seeded, runId: string, io: Awaited<ReturnType<typeof captureIO>>, lockBefore: string | null) {
  assert.equal(io.value, EXIT.ENV, `失联那一格未确认退出退 69，与主路径同口径（EV-177 ②）：${String((io.error as Error | undefined)?.message)}\nstderr=${io.err}`);
  assert.deepEqual(await facts(ctx, seeded, runId), {
    phase: 'failed', lock: true, gate: 'running', carrier: true, archive: 'running', task: 'running',
  }, '未确认退出：归档、登记、锁、闸门、载体都不动；status.json 保持失联判定时的 failed');
  assert.equal(await fileFacts(seeded.lockPath), lockBefore, '锁文件内容与身份不动');
  assert.match(io.out, /未能确认工作进程 \d+ 退出，归档与主题锁未动/);
}

test('EV-177 L1：失联后取消，SIGTERM 之后判不了、忽略 SIGTERM ⇒ 不升级 SIGKILL、按记录结束 CLI、工作进程仍在、退 69 且什么都不收', T, async () => {
  await kCell('L1', {
    program: 'ignore',
    cli: true,
    lost: true,
    stub: (pid) => stubPsFailure('both', { pids: [pid], startArmed: false }),
    kills: (_pid, stub) => ({ onTerm: () => stub!.arm() }),
  }, async ({ ctx, runId, w, cli, seeded, io, sent, stub, lockBefore, ms }) => {
    assert.ok(stub!.blocked > 0, 'SIGTERM 之后应拦到（桩自证）');
    assert.deepEqual(sent, ['SIGTERM'], '不向身份判不了的进程发 SIGKILL');
    assert.ok(ms >= 4_900, `应等满宽限期（${ms} ms）`);
    assert.match(io.err, /判不了身份：不升级 SIGKILL/);
    assert.ok(!io.err.includes('发送 SIGKILL'), `不能说发了 SIGKILL：${io.err}`);
    await assertLostUntouched(ctx, seeded, runId, io, lockBefore);
    await within(cli!.exited, 10_000, 'CLI 组应照 D4 按记录结束');
    assert.ok(isAlive(w.pid), '工作进程应仍活着（忽略 SIGTERM、没收到 SIGKILL）');
  });
});

test('EV-177 L2：失联后取消，入格之后首检即判不了 ⇒ 一个信号都不发，播报不说「发送 （无）」，退 69 且什么都不收', T, async () => {
  await kCell('L2', {
    program: 'ignore',
    lost: true,
    stub: (pid) => stubPsFailure('both', { pids: [pid], allowFirst: 1 }),
  }, async ({ ctx, runId, w, seeded, io, sent, stub, lockBefore }) => {
    assert.equal(stub!.allowed, 1, '入格那次判定应放过（桩自证）');
    assert.ok(stub!.blocked > 0, '入格之后应拦到（桩自证）');
    assert.deepEqual(sent, [], '一个信号都不应发');
    assert.match(io.err, /判不了它是不是 status\.json 记录的那个工作进程：未发信号，未能确认退出/);
    assert.ok(!io.err.includes('发送 （无）'), `零信号不能说「发送 （无）」：${io.err}`);
    await assertLostUntouched(ctx, seeded, runId, io, lockBefore);
    assert.ok(isAlive(w.pid), '工作进程应仍活着');
  });
});
