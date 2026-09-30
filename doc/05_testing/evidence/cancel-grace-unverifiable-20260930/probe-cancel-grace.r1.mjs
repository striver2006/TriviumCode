#!/usr/bin/env node
/**
 * 零配额探针（取消宽限期判不了仍放锁，EV-176，计划 §2）：`--cancel` 主路径入口已判同一进程之后，
 * 工作进程的身份转为「判不了」（活着而取不到启动时刻）、或 SIGKILL 之后未确认退出时，收尾的实际结局。
 *
 * 做法：
 *   - 每格另起一个真实的「工作进程」：经一个立即退出的中间进程以 detached 派生（自成进程组、父进程过继给 launchd，
 *     与生产里 `--start` 退出后的 worker 同形——不是本探针的子进程，退出后不会停在本探针名下的僵尸态）；
 *     argv 带标记；对 SIGTERM 的反应按格取：缺省即死 / 延迟 3 s 退出 / 忽略；
 *   - 在**不拦**时取它两种形态的启动时刻写进 status.json 与锁；预置运行目录（凭据载体、worker.pid）、主题锁、
 *     闸门 running、归档 run.json 骨架（running）与 task.json 登记；
 *   - 拦截点只有两个：
 *       ps 桩——只拦 `/bin/ps -p 〈工作进程 pid〉`（别的 pid 与 `ps -axo` 照常），按格决定何时开始拦：
 *         `after1` = 放过对该 pid 的第 1 次（cancelRun 入口那次判定），此后一律拦（零信号形态）；
 *         `onTerm` = 本探针观察到对该工作进程组发出 SIGTERM 之后才开始拦（宽限期形态）；
 *       process.kill 包装——记下发给工作进程（组）的每个非 0 信号；`dropKill` 格把 SIGKILL 记下而不投递
 *         （模拟「SIGKILL 发了而进程没在等待窗口内确认退出」，真实进程在 SIGKILL 下必死，零配额造不出）；
 *   - 结局按事实读：退出码或抛错码、stdout / stderr 全文、耗时、发出的信号序列、ps 放过 / 拦下次数、
 *     status.json 的 phase / message、凭据载体在不在、主题锁在不在、闸门状态、归档 run.json 与 task.json 登记的 status、
 *     返回那一刻工作进程活不活（G1 格另记 4 s 后）、之后同主题再拿运行锁的结局（仍在桩下）。
 * **不改 src**；只往本格 mkdtemp 里写；收尾按组 SIGKILL 本探针起的进程并等到它不在、删 mkdtemp。
 *
 * 用法：node probe-cancel-grace.mjs --root 〈构建树根（已 build --with-tests）〉 [--out 〈JSON〉] [--only 〈格 id,…〉]
 */
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg('root', process.cwd()));
const OUT = arg('out', null);
const ONLY = arg('only', null)?.split(',') ?? null;
const imp = (p) => import(pathToFileURL(path.join(ROOT, 'dist/test', p)).href);

const exec = await imp('src/trivium/util/exec.js');
const status = await imp('src/trivium/status.js');
const rp = await imp('src/trivium/run-protocol.js');
const state = await imp('src/trivium/state.js');
const lock = await imp('src/trivium/lock.js');
const meta = await imp('src/trivium/meta.js');
const { defaultConfig } = await imp('src/trivium/config.js');
const { RUN_DIR_FILES } = await imp('src/trivium/run-files.js');

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.access(p).then(() => true, () => false);
const TD = '.' + 'trivium';

// ── 拦截状态（每格重置） ──
const origSpawn = cp.spawn;
const origKill = process.kill.bind(process);
const cur = { pid: null, psMode: null, armed: false, psAllowed: 0, psBlocked: 0, signals: [], dropKill: false };

cp.spawn = function (bin, args, opts) {
  if (bin === '/bin/ps' && Array.isArray(args) && cur.pid !== null) {
    const i = args.indexOf('-p');
    if (i >= 0 && Number(args[i + 1]) === cur.pid && cur.psMode !== null) {
      if (cur.psMode === 'after1' && !cur.armed && cur.psAllowed >= 1) cur.armed = true;
      if (cur.armed) {
        cur.psBlocked++;
        return origSpawn.call(this, '/nonexistent/trivium-ev176-probe-ps', args, opts);
      }
      cur.psAllowed++;
    }
  }
  return origSpawn.call(this, bin, args, opts);
};
syncBuiltinESMExports();

process.kill = function (target, sig) {
  if (cur.pid !== null && (target === cur.pid || target === -cur.pid) && sig !== 0 && sig !== undefined) {
    cur.signals.push(`${sig}→${target < 0 ? '组' : '进程'}`);
    if (sig === 'SIGTERM' && cur.psMode === 'onTerm') cur.armed = true;
    if (sig === 'SIGKILL' && cur.dropKill) return true;
  }
  return origKill(target, sig);
};

// ── 进程与目录 ──
const PROGRAMS = {
  default: 'setInterval(() => {}, 1e6)',
  delay3s: "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 3000)); setInterval(() => {}, 1e6)",
  ignore: "process.on('SIGTERM', () => {}); setInterval(() => {}, 1e6)",
};
const spawnedGroups = new Set();
const tmpDirs = new Set();
const alive = (pid) => {
  try {
    origKill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
function spawnWorker(mark, program) {
  const launcher =
    "const c = require('node:child_process').spawn(process.execPath, ['-e', process.argv[1], process.argv[2]], { detached: true, stdio: 'ignore' });" +
    'process.stdout.write(String(c.pid)); c.unref();';
  const pid = Number(cp.execFileSync(process.execPath, ['-e', launcher, PROGRAMS[program], mark], { encoding: 'utf8' }).trim());
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`派生工作进程失败：${pid}`);
  spawnedGroups.add(pid);
  return pid;
}
async function killGroup(pid) {
  try {
    origKill(-pid, 'SIGKILL');
  } catch {
    // 已不在
  }
  for (let i = 0; i < 100 && alive(pid); i++) await sleep(50);
  return !alive(pid);
}
async function mkd(prefix) {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  tmpDirs.add(d);
  return d;
}

async function captureIO(fn) {
  const ow = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = (c) => ((out += String(c)), true);
  process.stderr.write = (c) => ((err += String(c)), true);
  try {
    const value = await fn();
    return { ok: true, value, out, err };
  } catch (e) {
    return { ok: false, error: { code: e?.code ?? null, exitCode: e?.exitCode ?? null, message: String(e?.message ?? e) }, out, err };
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

function ctxFor(root) {
  const cfg = defaultConfig();
  cfg.runtime.run_root = path.join(root, 'runs');
  return { config: cfg, projectRoot: root, archiveRoot: path.join(root, '.reviews'), triviumDir: path.join(root, TD), sources: ['<probe>'] };
}

/** 预置一轮 running 的运行：运行目录、主题锁、闸门、归档 run.json 与 task.json 登记 */
async function seedRun(ctx, { runId, topic, pid, rec }) {
  const dir = rp.runDirFor(ctx.config, ctx.projectRoot, runId);
  await fs.mkdir(dir, { recursive: true });
  const carrier = path.join(dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake-probe"}}}');
  await fs.mkdir(path.join(dir, 'glm', 'out'), { recursive: true });
  const s = status.newStatus({ runId, topic, stage: 'plan', sides: ['glm'], models: {} });
  s.phase = 'running';
  s.worker_pid = pid;
  s.worker_started_at = rec.legacy;
  s.worker_started_at_canonical = rec.canonical;
  await fs.writeFile(path.join(dir, RUN_DIR_FILES.status), JSON.stringify(s, null, 2) + '\n');
  await fs.writeFile(path.join(dir, RUN_DIR_FILES.workerPid), String(pid));

  const lockPath = lock.lockPathFor(ctx.triviumDir, topic);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify({
    topic, stage: 'plan', run_id: runId, pid, pid_started_at: rec.legacy, pid_started_at_canonical: rec.canonical,
    acquired_at: new Date().toISOString(), kind: 'run',
  }, null, 2) + '\n');
  await state.setGate({ triviumDir: ctx.triviumDir, topic, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });

  const layout = { archiveRoot: ctx.archiveRoot, topic };
  const taskLock = { triviumDir: ctx.triviumDir, heartbeatStaleMs: 120_000 };
  const m = meta.newRunMeta({
    runId, topic, stage: 'plan', rerunIndex: 1, command: 'probe', promptHint: null, taskGoal: null,
    criticsSelected: ['glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
  });
  await meta.writeRunMeta(layout, 'plan', m);
  await meta.registerRun(layout, m, taskLock);
  return { dir, carrier, lockPath, layout };
}

async function facts(ctx, seeded, runId, topic) {
  const s = await status.readStatus(seeded.dir);
  const rm = await meta.readRunMeta(seeded.layout, 'plan', runId).catch(() => null);
  const task = await meta.readTask(seeded.layout).catch(() => null);
  return {
    status_phase: s?.phase ?? null,
    status_message: s?.message ?? null,
    carrier_present: await exists(seeded.carrier),
    lock_present: await exists(seeded.lockPath),
    gate: (await state.getGate(ctx.triviumDir, topic, 'plan'))?.state ?? null,
    archive_run_status: rm?.status ?? null,
    task_entry_status: task?.runs?.find((r) => r.run_id === runId)?.status ?? null,
  };
}

/**
 * 格定义：program = 工作进程对 SIGTERM 的反应；psMode = ps 桩何时开始拦（null = 不拦）；dropKill = SIGKILL 记而不投递
 */
const CELLS = [
  { id: 'Z1', desc: '零信号形态：入口判同一进程之后 ps 即拦（放过第 1 次），工作进程对 SIGTERM 缺省即死', program: 'default', psMode: 'after1' },
  { id: 'G1', desc: '宽限期形态：SIGTERM 发出之后 ps 开始拦，工作进程收到 SIGTERM 延迟 3 s 才退出', program: 'delay3s', psMode: 'onTerm', lateCheckMs: 4000 },
  { id: 'G2', desc: '宽限期形态：SIGTERM 发出之后 ps 开始拦，工作进程忽略 SIGTERM', program: 'ignore', psMode: 'onTerm' },
  { id: 'G3', desc: '宽限期形态（回归对照）：SIGTERM 发出之后 ps 开始拦，工作进程收到 SIGTERM 即死', program: 'default', psMode: 'onTerm' },
  { id: 'K1', desc: 'SIGKILL 不等确认形态：工作进程忽略 SIGTERM，SIGKILL 记下而不投递（模拟 SIGKILL 之后未确认退出），ps 不拦', program: 'ignore', psMode: null, dropKill: true },
  { id: 'K2', desc: 'SIGKILL 形态（回归对照）：工作进程忽略 SIGTERM，SIGKILL 照常投递，ps 不拦', program: 'ignore', psMode: null },
  { id: 'C0', desc: '对照：工作进程收到 SIGTERM 即死，不拦', program: 'default', psMode: null },
];

async function runCell(c, n) {
  const root = await mkd(`trivium-ev176-${c.id}-`);
  const ctx = ctxFor(root);
  const runId = `20260930T15${String(n).padStart(2, '0')}00Z`;
  const topic = '探针';
  const pid = spawnWorker(`trivium-ev176-probe-worker:${c.id}`, c.program);
  await sleep(200);
  const rec = await exec.processStartTimes(pid);
  const seeded = await seedRun(ctx, { runId, topic, pid, rec });
  Object.assign(cur, { pid, psMode: c.psMode, armed: false, psAllowed: 0, psBlocked: 0, signals: [], dropKill: !!c.dropKill });
  const t0 = Date.now();
  const io = await captureIO(() => rp.cancelRun(ctx, runId));
  const ms = Date.now() - t0;
  const workerAliveAtReturn = alive(pid);
  const after = await facts(ctx, seeded, runId, topic);
  // 下一次 --start 的第一步：同主题拿运行锁（仍在桩下）
  const next = await captureIO(async () => {
    const h = await lock.acquireLock({ triviumDir: ctx.triviumDir, topic, stage: 'plan', runId: 'R-NEXT', kind: 'run', heartbeatStaleMs: 120_000, retries: 0 });
    await h.release();
    return 'acquired';
  });
  const psCounts = { allowed: cur.psAllowed, blocked: cur.psBlocked };
  const signals = [...cur.signals];
  Object.assign(cur, { pid: null, psMode: null, armed: false, dropKill: false });
  let workerAliveLate = null;
  if (c.lateCheckMs) {
    await sleep(Math.max(0, c.lateCheckMs - (Date.now() - t0)));
    workerAliveLate = { at_ms: Date.now() - t0, alive: alive(pid) };
  }
  const cleaned = await killGroup(pid);
  return {
    id: c.id, desc: c.desc, recorded: { legacy: rec.legacy !== null, canonical: rec.canonical !== null },
    ms, ps: psCounts, signals,
    io: io.ok ? { ok: true, exitCode: io.value, out: io.out, err: io.err } : io,
    worker_alive_at_return: workerAliveAtReturn,
    worker_alive_late: workerAliveLate,
    after,
    next_acquire: next.ok ? next.value : { error: next.error, err: next.err.trim().slice(0, 400) },
    cleaned,
  };
}

const results = [];
try {
  let n = 0;
  for (const c of CELLS) {
    n++;
    if (ONLY && !ONLY.includes(c.id)) continue;
    results.push(await runCell(c, n));
    process.stderr.write(`· ${c.id} done\n`);
  }
} finally {
  cp.spawn = origSpawn;
  syncBuiltinESMExports();
  process.kill = origKill;
  for (const g of spawnedGroups) await killGroup(g);
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true });
}

const summary = {
  root: ROOT, node: process.version, platform: process.platform, at: new Date().toISOString(),
  exec_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/util/exec.js')),
  run_protocol_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/run-protocol.js')),
  status_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/status.js')),
  results,
};
if (OUT) await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
