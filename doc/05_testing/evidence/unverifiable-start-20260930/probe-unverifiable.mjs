#!/usr/bin/env node
/**
 * 零配额探针（取不到启动时刻当不在，EV-175，计划 §2）：工作进程**活着**、而本进程取不到它的启动时刻时，
 * 五处身份消费方（interpretStatus 情形 A / C、workerConfirmedGone、workerStillAlive、cancelRun 主路径）各自的实际结局。
 *
 * 做法：
 *   - 另起一个真实的「工作进程」（detached 的 node 定时器，argv 带标记），先在**不拦**时取它两种形态的启动时刻写进记录；
 *   - 再只拦「`/bin/ps -p 〈工作进程 pid〉`」这一种调用（两种形态都拦；别的 pid、`ps -axo` 不拦），造出「活着而取不到」；
 *   - 每格先做桩自证：工作进程两种形态都取不到、本进程两种形态都取得到（桩只拦指定 pid）；
 *   - 同一组格在 `control`（不拦）下再跑一遍作对照。
 *
 * 结局按事实读：reading / 退出码 / 抛错码、stdout 与 stderr 全文、status.json 的 phase / message / lost、
 * 凭据载体在不在、运行目录在不在、主题锁在不在、闸门状态、工作进程与 CLI 进程组在不在（在 ⇒ 没收到信号：它们对 SIGTERM 不设防）。
 * **不改 src**；只往本格 mkdtemp 里写；收尾按组 SIGKILL 本探针起的进程、删 mkdtemp。
 *
 * 版本：计划阶段（r1）14 格，读数 `probe-pre-c4d082e.json`；编码阶段按计划 r2 §5.2 加 `K-main-timeout`（被拦的 ps 换成睡过
 * 10 s 超时的进程，CODEX-02）共 15 格，新旧两份构建各跑一次（`probe-pre-c4d082e.coding.json` / `probe-post.json`），
 * 由 `compare-probe.mjs` 做硬断言（格数、自证、对照组逐格相同）并出对照表。
 *
 * 用法：node probe-unverifiable.mjs --root 〈构建树根（已 build --tests-only）〉 [--out 〈JSON〉] [--mode psfail|control|both]
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
const MODE = arg('mode', 'both');
const imp = (p) => import(pathToFileURL(path.join(ROOT, 'dist/test', p)).href);

const exec = await imp('src/trivium/util/exec.js');
const status = await imp('src/trivium/status.js');
const rp = await imp('src/trivium/run-protocol.js');
const retention = await imp('src/trivium/retention.js');
const state = await imp('src/trivium/state.js');
const lock = await imp('src/trivium/lock.js');
const { defaultConfig } = await imp('src/trivium/config.js');
const { wiredAdapter } = await imp('src/trivium/adapters/index.js');
const { RUN_DIR_FILES } = await imp('src/trivium/run-files.js');

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.access(p).then(() => true, () => false);
const TD = '.' + 'trivium';

// ── ps 桩：只拦 `-p 〈被拦 pid〉`；形态 fail = 派生失败（即刻非零），timeout = 换成睡过 10 s 超时的进程（计划 r2 §5.2，CODEX-02） ──
const origSpawn = cp.spawn;
const blockedPids = new Map();
let blocked = 0;
cp.spawn = function (bin, args, opts) {
  if (bin === '/bin/ps' && Array.isArray(args)) {
    const i = args.indexOf('-p');
    const how = i >= 0 ? blockedPids.get(Number(args[i + 1])) : undefined;
    if (how === 'fail') {
      blocked++;
      return origSpawn.call(this, '/nonexistent/trivium-ev175-probe-ps', args, opts);
    }
    if (how === 'timeout') {
      blocked++;
      return origSpawn.call(this, '/bin/sleep', ['15'], opts);
    }
  }
  return origSpawn.call(this, bin, args, opts);
};
syncBuiltinESMExports();

// ── 进程与目录 ──
const spawnedGroups = new Set();
const tmpDirs = new Set();
function spawnMarked(mark) {
  const child = origSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)', mark], { detached: true, stdio: 'ignore' });
  // 不 unref：收尾要等它的 'exit'，unref 之后事件循环会在等待中清空
  spawnedGroups.add(child.pid);
  const exited = new Promise((r) => child.once('exit', (code, sig) => r({ code, sig })));
  return { pid: child.pid, exited };
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
async function mkd(prefix) {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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
    return { ok: false, error: { code: e?.code ?? null, message: String(e?.message ?? e) }, out, err };
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

function mkStatus(o) {
  const s = status.newStatus({ runId: o.runId, topic: o.topic, stage: 'plan', sides: ['glm'], models: {} });
  s.phase = o.phase ?? 'running';
  s.worker_pid = o.pid;
  s.worker_started_at = o.legacy;
  if (o.canonical === undefined) delete s.worker_started_at_canonical;
  else s.worker_started_at_canonical = o.canonical;
  if (o.heartbeatAt) s.heartbeat_at = o.heartbeatAt;
  if (o.cli) s.sides.glm.cli = o.cli;
  if (o.message) s.message = o.message;
  if (o.lost) s.lost = o.lost;
  if (o.phase && ['success', 'failed', 'cancelled'].includes(o.phase)) s.exit_code = 1;
  return s;
}

async function seedRunDir(dir, s, { carrier = true, workerPidFile = null } = {}) {
  await fs.mkdir(dir, { recursive: true });
  let carrierPath = null;
  if (carrier) {
    carrierPath = path.join(dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
    await fs.mkdir(path.dirname(carrierPath), { recursive: true });
    await fs.writeFile(carrierPath, '{"provider":{"k":{"apiKey":"fake-probe"}}}');
    await fs.mkdir(path.join(dir, 'glm', 'out'), { recursive: true });
  }
  // 不用 writeStatus：它会把 heartbeat_at 刷成当下，心跳过期的格就造不出来
  if (s) await fs.writeFile(path.join(dir, RUN_DIR_FILES.status), JSON.stringify(s, null, 2) + '\n');
  if (workerPidFile !== null) await fs.writeFile(path.join(dir, RUN_DIR_FILES.workerPid), String(workerPidFile));
  return carrierPath;
}

async function seedLock(ctx, topic, runId, pid, rec) {
  const p = lock.lockPathFor(ctx.triviumDir, topic);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const content = {
    topic, stage: 'plan', run_id: runId, pid,
    pid_started_at: rec.legacy, pid_started_at_canonical: rec.canonical,
    acquired_at: new Date().toISOString(), kind: 'run',
  };
  await fs.writeFile(p, JSON.stringify(content, null, 2) + '\n');
  return p;
}

const readStatusFacts = async (dir) => {
  const s = await status.readStatus(dir);
  return s ? { phase: s.phase, message: s.message ?? null, lost: s.lost ?? null, cli: s.sides?.glm?.cli ?? null } : null;
};

/** 桩自证：被拦 pid 两种形态都取不到；本进程两种形态都取得到 */
async function stubSelfCheck(pid) {
  const w = [await exec.processStartTime(pid), await exec.processStartTime(pid, { canonical: true })];
  const me = [await exec.processStartTime(process.pid), await exec.processStartTime(process.pid, { canonical: true })];
  return { ok: w.every((x) => x === null) && me.every((x) => x !== null), worker: w, self: me.map((x) => x !== null) };
}

/** 一个格：起工作进程、取记录、按模式装桩、跑 body、收事实、清场 */
async function cell(id, mode, body, how = 'fail') {
  const w = spawnMarked(`trivium-ev175-probe-worker:${id}`);
  await sleep(150);
  const rec = await exec.processStartTimes(w.pid);
  const extra = { cliGroups: [] };
  if (mode === 'psfail') blockedPids.set(w.pid, how);
  const blocked0 = blocked;
  // 超时形态的自证本身要等两个 10 s，省掉：它与 fail 形态走同一个拦截点，被拦次数照记
  const selfCheck = mode === 'psfail' && how === 'fail' ? await stubSelfCheck(w.pid) : null;
  let r;
  try {
    r = await body({ w, rec, extra });
  } catch (e) {
    r = { probe_error: String(e?.stack ?? e) };
  } finally {
    blockedPids.delete(w.pid);
  }
  const res = {
    id, mode, selfCheck, ps_blocked: blocked - blocked0,
    recorded: { legacy: rec.legacy !== null, canonical: rec.canonical !== null },
    ...r,
    worker_alive_after: alive(w.pid),
    cli_groups_alive_after: extra.cliGroups.map((g) => alive(g)),
  };
  for (const g of [w.pid, ...extra.cliGroups]) {
    try {
      process.kill(-g, 'SIGKILL');
    } catch {
      // 已不在
    }
  }
  await w.exited;
  return res;
}

const HOUR_AGO = () => new Date(Date.now() - 3600_000).toISOString();

const CELLS = [
  // ── ① interpretStatus 情形 A：status.json 不存在，按 worker.pid 兜底 ──
  ['A-prod', 'interpretStatus 情形 A：status.json 不存在，只给 fallbackPid（生产形状，waitRun 不传 fallbackPidStartedAt）', async ({ w }) => {
    const d = await mkd('trivium-ev175-A-');
    const reading = await status.interpretStatus(d, { heartbeatStaleMs: 120_000, fallbackPid: w.pid });
    return { reading };
  }],
  ['A-test', 'interpretStatus 情形 A：同上，另给 fallbackPidStartedAt = 缺省形态（只供同进程构造的入口）', async ({ w, rec }) => {
    const d = await mkd('trivium-ev175-A-');
    const reading = await status.interpretStatus(d, { heartbeatStaleMs: 120_000, fallbackPid: w.pid, fallbackPidStartedAt: rec.legacy });
    return { reading };
  }],
  // ── ② interpretStatus 情形 C ──
  ['C-canon-fresh', 'interpretStatus 情形 C：running、规范化记录、心跳新鲜', async ({ w, rec }) => {
    const d = await mkd('trivium-ev175-C-');
    await seedRunDir(d, mkStatus({ runId: 'R', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical }), { carrier: false });
    return { reading: await status.interpretStatus(d, { heartbeatStaleMs: 120_000 }) };
  }],
  ['C-legacy-fresh', 'interpretStatus 情形 C：running、旧版记录（无规范化键）、心跳新鲜', async ({ w, rec }) => {
    const d = await mkd('trivium-ev175-C-');
    await seedRunDir(d, mkStatus({ runId: 'R', topic: 't', pid: w.pid, legacy: rec.legacy }), { carrier: false });
    return { reading: await status.interpretStatus(d, { heartbeatStaleMs: 120_000 }) };
  }],
  ['C-canon-stale', 'interpretStatus 情形 C：running、规范化记录、心跳过期（1 h 前）', async ({ w, rec }) => {
    const d = await mkd('trivium-ev175-C-');
    await seedRunDir(d, mkStatus({ runId: 'R', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical, heartbeatAt: HOUR_AGO() }), { carrier: false });
    return { reading: await status.interpretStatus(d, { heartbeatStaleMs: 120_000 }) };
  }],
  ...[['C-wait', '心跳新鲜', null], ['C-wait-stale', '心跳过期（1 h 前）', HOUR_AGO]].map(([id, hb, at]) => [id, `waitRun 全程：running、规范化记录、${hb}、闸门 running、主题锁归工作进程、带凭据载体`, async ({ w, rec }) => {
    const root = await mkd('trivium-ev175-W-');
    const ctx = ctxFor(root);
    const runId = 'R-EV175-W';
    const topic = '探针';
    const dir = rp.runDirFor(ctx.config, ctx.projectRoot, runId);
    const carrier = await seedRunDir(dir, mkStatus({ runId, topic, pid: w.pid, legacy: rec.legacy, canonical: rec.canonical, heartbeatAt: at ? at() : undefined }), { workerPidFile: w.pid });
    const lockPath = await seedLock(ctx, topic, runId, w.pid, rec);
    await state.setGate({ triviumDir: ctx.triviumDir, topic, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });
    const io = await captureIO(() => rp.waitRun(ctx, runId, 4));
    return {
      io: io.ok ? { ok: true, exitCode: io.value?.exitCode ?? null, out: io.out, err: io.err } : io,
      after: {
        status: await readStatusFacts(dir), carrier_present: await exists(carrier), lock_present: await exists(lockPath),
        gate: (await state.getGate(ctx.triviumDir, topic, 'plan'))?.state ?? null,
      },
    };
  }]),
  // ── ③ workerConfirmedGone（及经它的 scrubAdmission） ──
  ['G-running', 'workerConfirmedGone / scrubAdmission：running、规范化记录', async ({ w, rec }) => {
    const s = mkStatus({ runId: 'R', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical });
    const g = await status.workerConfirmedGone(s, null);
    const a = await status.scrubAdmission(s, null);
    return { workerConfirmedGone: g, scrubAdmission: { admit: a.admit, worker: a.worker } };
  }],
  ['G-failed', 'workerConfirmedGone / scrubAdmission：failed（--wait 判 heartbeat_stale 之后的形态）、规范化记录', async ({ w, rec }) => {
    const s = mkStatus({ runId: 'R', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical, phase: 'failed', message: 'worker_lost（heartbeat_stale）', lost: { reason: 'heartbeat_stale', at: new Date().toISOString() } });
    const g = await status.workerConfirmedGone(s, null);
    const a = await status.scrubAdmission(s, null);
    return { workerConfirmedGone: g, scrubAdmission: { admit: a.admit, worker: a.worker } };
  }],
  ['G-cancel-terminal', 'cancelRun 终态分支：failed（worker_lost pid_gone，无 lost.heartbeat_stale）、工作进程活着、带一条活 CLI 组记录', async ({ w, rec, extra }) => {
    const root = await mkd('trivium-ev175-T-');
    const ctx = ctxFor(root);
    const runId = 'R-EV175-T';
    const topic = '探针';
    const cliProc = spawnMarked('trivium-ev175-probe-cli:T');
    extra.cliGroups.push(cliProc.pid);
    await sleep(150);
    const cliStart = await exec.processStartTime(cliProc.pid, { canonical: true });
    const dir = rp.runDirFor(ctx.config, ctx.projectRoot, runId);
    const carrier = await seedRunDir(dir, mkStatus({
      runId, topic, pid: w.pid, legacy: rec.legacy, canonical: rec.canonical, phase: 'failed',
      message: 'worker_lost（pid_gone）', lost: { reason: 'pid_gone', at: new Date().toISOString() }, cli: { pgid: cliProc.pid, started_at: cliStart },
    }), { workerPidFile: w.pid });
    const io = await captureIO(() => rp.cancelRun(ctx, runId));
    return {
      cli_started_at_recorded: cliStart !== null,
      io: io.ok ? { ok: true, exitCode: io.value, out: io.out, err: io.err } : io,
      after: { status: await readStatusFacts(dir), carrier_present: await exists(carrier) },
    };
  }],
  // ── ④ workerStillAlive（经 pruneRunDirs / scrubAllRunRoot） ──
  ['S-prune', 'pruneRunDirs：running、规范化记录、已过 run_dir_days（now 取 31 天后）、带凭据载体', async ({ w, rec }) => {
    const root = await mkd('trivium-ev175-P-');
    const projectRoot = path.join(root, 'proj');
    const cfg = defaultConfig();
    cfg.runtime.run_root = path.join(root, 'runs');
    const dir = rp.runDirFor(cfg, projectRoot, 'R-EV175-P');
    const carrier = await seedRunDir(dir, mkStatus({ runId: 'R-EV175-P', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical }));
    const io = await captureIO(() => retention.pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter, now: Date.now() + 31 * 86_400_000 }));
    const v = io.value;
    return {
      io: io.ok ? { ok: true, removed: v.removed.length, kept: v.kept, scrubbed: v.scrubbed.length, deferred: v.deferred.length } : io,
      after: { run_dir_present: await exists(dir), carrier_present: await exists(carrier) },
    };
  }],
  ['S-prune-fresh', 'pruneRunDirs：同上但未到期（now 取当下）', async ({ w, rec }) => {
    const root = await mkd('trivium-ev175-P-');
    const projectRoot = path.join(root, 'proj');
    const cfg = defaultConfig();
    cfg.runtime.run_root = path.join(root, 'runs');
    const dir = rp.runDirFor(cfg, projectRoot, 'R-EV175-P2');
    const carrier = await seedRunDir(dir, mkStatus({ runId: 'R-EV175-P2', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical }));
    const io = await captureIO(() => retention.pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter }));
    const v = io.value;
    return {
      io: io.ok ? { ok: true, removed: v.removed.length, kept: v.kept, scrubbed: v.scrubbed.length, deferred: v.deferred.length } : io,
      after: { run_dir_present: await exists(dir), carrier_present: await exists(carrier) },
    };
  }],
  ['S-sweep', 'scrubAllRunRoot（跨仓清扫，非 dry-run）：running、规范化记录、带凭据载体', async ({ w, rec }) => {
    const root = await mkd('trivium-ev175-X-');
    const cfg = defaultConfig();
    cfg.runtime.run_root = path.join(root, 'runs');
    const dir = rp.runDirFor(cfg, path.join(root, 'proj'), 'R-EV175-X');
    const carrier = await seedRunDir(dir, mkStatus({ runId: 'R-EV175-X', topic: 't', pid: w.pid, legacy: rec.legacy, canonical: rec.canonical }));
    const io = await captureIO(() => retention.scrubAllRunRoot(cfg, { adapters: wiredAdapter }));
    const v = io.value;
    return {
      io: io.ok ? { ok: true, visited: v.visited, alive: v.alive, scrubbed: v.scrubbed.length, deferred: v.deferred.length } : io,
      after: { carrier_present: await exists(carrier) },
    };
  }],
  // ── ⑤ cancelRun 主路径 ──
  ['K-main', 'cancelRun 主路径：running、规范化记录、闸门 running、主题锁归工作进程、带凭据载体与一条活 CLI 组记录；之后同主题 acquireLock', async ({ w, rec, extra }) => {
    const root = await mkd('trivium-ev175-K-');
    const ctx = ctxFor(root);
    const runId = 'R-EV175-K';
    const topic = '探针';
    const cliProc = spawnMarked('trivium-ev175-probe-cli:K');
    extra.cliGroups.push(cliProc.pid);
    await sleep(150);
    const cliStart = await exec.processStartTime(cliProc.pid, { canonical: true });
    const dir = rp.runDirFor(ctx.config, ctx.projectRoot, runId);
    const carrier = await seedRunDir(dir, mkStatus({
      runId, topic, pid: w.pid, legacy: rec.legacy, canonical: rec.canonical, cli: { pgid: cliProc.pid, started_at: cliStart },
    }), { workerPidFile: w.pid });
    const lockPath = await seedLock(ctx, topic, runId, w.pid, rec);
    await state.setGate({ triviumDir: ctx.triviumDir, topic, stage: 'plan', state: 'running', runId, heartbeatStaleMs: 120_000 });
    const t0 = Date.now();
    const io = await captureIO(() => rp.cancelRun(ctx, runId));
    const ms = Date.now() - t0;
    const workerAliveRightAfter = alive(w.pid);
    const cliAliveRightAfter = alive(cliProc.pid);
    const after = {
      status: await readStatusFacts(dir), carrier_present: await exists(carrier), lock_present: await exists(lockPath),
      gate: (await state.getGate(ctx.triviumDir, topic, 'plan'))?.state ?? null,
      worker_alive: workerAliveRightAfter, cli_alive: cliAliveRightAfter,
    };
    // 下一次 --start 的第一步：同主题拿运行锁（仍在桩下）
    const next = await captureIO(async () => {
      const h = await lock.acquireLock({ triviumDir: ctx.triviumDir, topic, stage: 'plan', runId: 'R-NEXT', kind: 'run', heartbeatStaleMs: 120_000, retries: 0 });
      await h.release();
      return 'acquired';
    });
    return {
      cli_started_at_recorded: cliStart !== null, ms,
      io: io.ok ? { ok: true, exitCode: io.value, out: io.out, err: io.err } : io,
      after,
      next_acquire: next.ok ? next.value : { error: next.error, err: next.err.trim().slice(0, 400) },
    };
  }],
];

// 超时形态一格（计划 r2 §5.2，CODEX-02）：同 K-main 的构造，被拦的 ps 换成睡过 10 s 超时的进程；结局应与 K-main 同形，耗时记 ms
{
  const k = CELLS.find((c) => c[0] === 'K-main');
  CELLS.push(['K-main-timeout', `${k[1]}（ps 超时形态：被拦的 ps 睡过 10 s）`, k[2], 'timeout']);
}

const modes = MODE === 'both' ? ['psfail', 'control'] : [MODE];
const results = [];
try {
  for (const mode of modes) {
    for (const [id, desc, body, how] of CELLS) {
      const r = await cell(id, mode, body, how);
      results.push({ desc, ps_block_form: mode === 'psfail' ? (how ?? 'fail') : null, ...r });
      process.stderr.write(`· ${mode} ${id} done\n`);
    }
  }
} finally {
  cp.spawn = origSpawn;
  syncBuiltinESMExports();
  for (const g of spawnedGroups) {
    try {
      process.kill(-g, 'SIGKILL');
    } catch {
      // 已不在
    }
  }
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true });
}

const summary = {
  root: ROOT, node: process.version, platform: process.platform, at: new Date().toISOString(),
  exec_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/util/exec.js')),
  status_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/status.js')),
  retention_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/retention.js')),
  run_protocol_js_sha16: sha(path.join(ROOT, 'dist/test/src/trivium/run-protocol.js')),
  results,
};
if (OUT) await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
