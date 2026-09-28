#!/usr/bin/env node
/**
 * 「失联后取消挂住的worker」计划期零配额探针 P1 / P2（计划 r1 §2）。
 * P1：heartbeat_stale_s 2、两侧 hang_cli 不堵 ⇒ --wait 是否判 heartbeat_stale；--cancel 是否终态早退、什么都不动；
 *     worker 30 s 心跳时刻是否写回 heartbeat_at、phase 是否仍为 failed。
 * P2：同上但 gemini blockAfterMs 300 ⇒ 同样判 heartbeat_stale；堵住后 worker 不再写；--cancel 什么都不动；同阶段 --start 退几。
 * 只写 mkdtemp；收尾按本次标记与 worker pid 按组 SIGKILL，只删 mkdtemp 返回值。
 * 用法（仓库根）：node probe-lost.mjs <bundle> <asset_root> [输出 JSON]
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const BUNDLE = path.resolve(process.argv[2]);
const ASSET = path.resolve(process.argv[3]);
const OUT = process.argv[4] ?? null;
const { encodeStubConfig, STUB_ENV_VAR } = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js')).href);
const SESSION = 'S-probe';
const TD = '.' + 'trivium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonOf = (t) => { try { return JSON.parse(t.slice(t.indexOf('{'))); } catch { return null; } };
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const cli = (cwd, args, stub) => sh(cwd, process.execPath, [BUNDLE, ...args], { TRIVIUM_ASSET_ROOT: ASSET, [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : '', CLAUDE_SESSION_ID: SESSION });

function psRows() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,ppid=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: +m[1], pgid: +m[2], ppid: +m[3], cmd: m[4] });
  }
  return rows;
}
const groupsWithMark = (mark) => [...new Set(psRows().filter((r) => r.cmd.includes(mark)).map((r) => r.pgid))];
const members = (g) => psRows().filter((r) => r.pgid === g).length;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const killGroup = (g) => { if (g > 1) try { process.kill(-g, 'SIGKILL'); } catch { /* 已不在 */ } };

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs-' + topic)}`,
    'review:', '  default_critics: [gemini, glm]', '  heartbeat_stale_s: 2',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n探针。\n');
  return { root, topic, stageDir };
}

const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'probe-lost-')));
const readout = { bundle: BUNDLE, node: process.version, cells: {} };
const cleanup = [];
try {
  for (const [cell, stub] of [
    ['P1', { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } }],
    ['P2', { gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } }],
  ]) {
    const fx = await fixture(base, `探针${cell}`);
    const s = await cli(fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '探针', '--session-id', SESSION, '--json'], stub);
    const js = jsonOf(s.stdout);
    const r = { start_code: s.code };
    readout.cells[cell] = r;
    if (!js?.run_id) { r.start_err = s.stderr.slice(0, 2000); continue; }
    const mark = `trivium-stub-cli:${js.run_dir}`;
    cleanup.push({ mark, pid: js.worker_pid });
    let groups = [];
    for (let i = 0; i < 100 && groups.length < 2; i++) { groups = groupsWithMark(mark); if (groups.length < 2) await sleep(100); }
    r.groups = groups.length;
    await sleep(3000);
    const sp = path.join(js.run_dir, 'status.json');
    const w = await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '10'], stub);
    r.wait_code = w.code;
    r.wait_says_heartbeat_stale = /heartbeat_stale/.test(w.stdout + w.stderr);
    r.wait_tail = (w.stderr.trim().split('\n').slice(-6)).join(' ⏎ ');
    const afterWait = await readJson(sp);
    r.after_wait = { phase: afterWait.phase, message: afterWait.message, heartbeat_at: afterWait.heartbeat_at, has_lost_key: 'lost' in afterWait };
    r.worker_alive_after_wait = alive(js.worker_pid);
    r.members_after_wait = groups.map(members);
    const metaDir = path.join(fx.stageDir, '_meta');
    const runJson = path.join(metaDir, `run-${js.run_id}.json`);
    r.run_json_after_wait = (await readJson(runJson)).status;
    const c = await cli(fx.root, ['review', '--cancel', js.run_id], stub);
    r.cancel_code = c.code;
    r.cancel_stdout = c.stdout.trim();
    r.cancel_stderr = c.stderr.trim();
    r.worker_alive_after_cancel = alive(js.worker_pid);
    r.members_after_cancel = groups.map(members);
    r.run_json_after_cancel = (await readJson(runJson)).status;
    r.lock_present_after_cancel = await fs.access(path.join(fx.root, TD, 'lock', `${fx.topic}.lock`)).then(() => true, () => false);
    const s2 = await cli(fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '探针', '--session-id', SESSION, '--json'], stub);
    r.second_start_code = s2.code;
    r.second_start_err = s2.stderr.trim().split('\n').slice(0, 2).join(' ⏎ ');
    const js2 = jsonOf(s2.stdout);
    if (js2?.worker_pid) cleanup.push({ mark: `trivium-stub-cli:${js2.run_dir}`, pid: js2.worker_pid });
    if (cell === 'P1') {
      // 等过 worker 的 30 s 心跳时刻（从 --start 起算），看它是否写回 heartbeat_at、phase 是否仍 failed
      await sleep(30_000);
      const later = await readJson(sp);
      r.after_heartbeat = { phase: later.phase, heartbeat_at: later.heartbeat_at, heartbeat_changed: later.heartbeat_at !== afterWait.heartbeat_at };
    } else {
      await sleep(3000);
      const later = await readJson(sp);
      r.after_3s = { heartbeat_changed: later.heartbeat_at !== afterWait.heartbeat_at };
    }
  }
} finally {
  for (const { mark, pid } of cleanup) {
    for (const g of groupsWithMark(mark)) killGroup(g);
    killGroup(pid);
  }
  await sleep(300);
  readout.leftover = cleanup.map(({ mark, pid }) => ({ groups: groupsWithMark(mark).length, worker_alive: alive(pid) }));
  await fs.rm(base, { recursive: true, force: true });
}
const text = JSON.stringify(readout, null, 2);
console.log(text);
if (OUT) await fs.writeFile(OUT, text + '\n');
