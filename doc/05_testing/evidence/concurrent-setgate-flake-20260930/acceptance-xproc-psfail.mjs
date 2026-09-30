#!/usr/bin/env node
/**
 * 跨进程验收（并发写闸门偶发红，EV-153，计划 r2 §5.3）：别的进程活着并持一把 `kind: 'run'` 锁（两种启动时刻都是真实取值），
 * 本进程让**规范化形态**的 `/bin/ps` 派生失败后 `acquireLock(retries: 0)`，循环 R 轮。
 * 期望：改后「抛 70、锁文件内容与身份原样、无回收告警」R / R；改前与旧构建「回收并拿到锁」R / R（缺陷在跨进程形态也在）。
 *
 * 用法：node acceptance-xproc-psfail.mjs --root 〈构建树根〉 [--rounds 50] [--out 〈JSON〉]
 */
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promises as fs } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(arg('root', process.cwd()));
const ROUNDS = Number(arg('rounds', '50'));
const OUT = arg('out', null);

const lock = await import(path.join(ROOT, 'dist/test/src/trivium/lock.js'));
const { processStartTime } = await import(path.join(ROOT, 'dist/test/src/trivium/util/exec.js'));

const origSpawn = cp.spawn;
let blocking = false;
let blocked = 0;
cp.spawn = function (bin, args, opts) {
  if (blocking && bin === '/bin/ps' && opts?.env?.TZ === 'UTC0') {
    blocked++;
    return origSpawn.call(this, '/nonexistent/trivium-acceptance-ps', args, opts);
  }
  return origSpawn.call(this, bin, args, opts);
};
syncBuiltinESMExports();

const identity = async (p) => {
  const st = await fs.stat(p, { bigint: true });
  return `${st.dev}:${st.ino}:${st.mtimeNs}`;
};
const origWrite = process.stderr.write.bind(process.stderr);

const tally = {};
const samples = [];
let stubSelfCheckFailed = 0;
for (let k = 0; k < ROUNDS; k++) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev153-xproc-'));
  const child = origSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)', 'trivium-ev153-acceptance-holder'], {
    detached: true, stdio: 'ignore',
  });
  const exited = new Promise((r) => child.once('exit', r));
  const pid = child.pid;
  let outcome;
  let err = '';
  try {
    const content = {
      topic: '验收', stage: 'code', run_id: 'R-LIVE', pid,
      pid_started_at: await processStartTime(pid),
      pid_started_at_canonical: await processStartTime(pid, { canonical: true }),
      acquired_at: new Date().toISOString(), kind: 'run',
    };
    const p = path.join(dir, 'lock', '验收.lock');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(content, null, 2) + '\n');
    const before = { text: await fs.readFile(p, 'utf8'), id: await identity(p) };
    blocking = true;
    // 桩自证：规范化形态应取不到
    if ((await processStartTime(process.pid, { canonical: true })) !== null) stubSelfCheckFailed++;
    process.stderr.write = (c) => ((err += String(c)), true);
    try {
      const h = await lock.acquireLock({ triviumDir: dir, topic: '验收', kind: 'run', heartbeatStaleMs: 120_000, retries: 0 });
      outcome = 'acquired';
      await h.release();
    } catch (e) {
      outcome = e?.code === 70 ? 'locked_70' : `error:${e?.code ?? e}`;
    } finally {
      process.stderr.write = origWrite;
      blocking = false;
    }
    if (outcome === 'locked_70') {
      const intact = (await fs.readFile(p, 'utf8')) === before.text && (await identity(p)) === before.id;
      if (!intact) outcome = 'locked_70_but_lock_changed';
    }
    if (/回收主题/.test(err)) outcome += '+reclaim_warning';
  } finally {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // 已不在
    }
    await exited;
    await fs.rm(dir, { recursive: true, force: true });
  }
  tally[outcome] = (tally[outcome] ?? 0) + 1;
  if (samples.length < 2 && err) samples.push({ k, outcome, stderr: err.trim().slice(0, 500) });
}
cp.spawn = origSpawn;
syncBuiltinESMExports();

const summary = { root: ROOT, node: process.version, at: new Date().toISOString(), rounds: ROUNDS, blocked_ps: blocked, stub_self_check_failed: stubSelfCheckFailed, tally, samples };
if (OUT) await fs.writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
