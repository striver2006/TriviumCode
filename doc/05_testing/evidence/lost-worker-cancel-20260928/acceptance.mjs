#!/usr/bin/env node
/**
 * 「失联后取消挂住的worker」零配额验收（计划 r2 §5.4 C1～C8）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录（每个夹具的 run_root 各在 mkdtemp 之下——
 * `trivium scrub` 会遍历整个运行根）、旧构建都建在一个 mkdtemp 目录下；审核者换成桩（`TRIVIUM_STUB_CRITIC`），
 * 不发起任何模型调用。收尾只删 mkdtemp 的返回值；残留进程按组号结束（本次运行目录标记认得出的桩 CLI 组、本次 run_id 的 worker）。
 * 夹具 `heartbeat_stale_s: 2`：worker 心跳 30 s 一次，记录落盘之后 2 s 不写即被 `--wait` 判 heartbeat_stale。
 *
 * 新旧两份构建（沿用上一主题做法）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`，TRIVIUM_ASSET_ROOT 指工作树；
 *   - 旧：`git archive` 固定提交（缺省 50cb380，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，`node_modules` 软链工作树，
 *     不叠加任何文件（`hang_cli` 的 `blockAfterMs` 旧构建已有；叠加面的 diff 进读数，非空即判失败），`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调，不经 `.trivium/bin/trivium`；记 sha256 并断言不同。
 *
 *   C1  新：worker 事件循环堵住 → --wait 判 heartbeat_stale → --cancel ⇒ worker 与两组都不在、run.json failed（worker_lost / heartbeat_stale）、
 *       登记 failed、锁不在、status.json sha256 不变；之前同阶段 --start 退 70、之后能起跑；耗时进读数
 *   C2  旧：同 C1 ⇒ --cancel 打「已处于终态」；worker 与两组仍在；run.json running；锁仍在；同阶段 --start 退 70（EV-146 原文）
 *   C3  新 / 旧：不堵（心跳只是慢）→ --wait 判 heartbeat_stale → --cancel：新 = 不升级、处理器自己收拾、run.json failed；旧 = 什么都不动
 *   C4  新：C1 之后再 --cancel ⇒ 终态早退原样两行，run.json 与 status.json 的 sha256 不变
 *   C5  新 / 旧：上一主题 B3（b 格）与 B6（c′ 格）照原判据各跑一遍，两侧读数相同
 *   C6  新：C1 的构造放假载体 ⇒ --wait、--cancel 之后都仍在；trivium scrub ⇒ 被抹
 *   C7  新 / 旧：常态格 a 回归——hang 桩与 hang_cli 桩各走 --start / --cancel，stdout 逐行相同、stderr 归一化后逐行相同
 *   C8  新 → 旧：新构建写下带 lost 的 status.json（worker 与 CLI 由脚本按组结束），旧构建对它 --status --json（lost 原样透出、
 *       退出码相同）与 --cancel（终态早退、不报错）
 *
 * 用法（在仓库根，先 npm run build 与 build --with-tests）：node acceptance.mjs [输出 JSON 路径]
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '50cb380';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

const results = [];
const readout = { base_ref: BASE_REF, node: process.version, platform: process.platform };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaOrNull = (p) => (existsSync(p) ? sha(p) : null);
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const exists = async (p) => fs.access(p).then(() => true, () => false);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const envFor = (build, stub) => ({ TRIVIUM_ASSET_ROOT: build.asset, [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : '', CLAUDE_SESSION_ID: SESSION });
const cli = (build, cwd, args, stub) => sh(cwd, process.execPath, [build.cli, ...args], envFor(build, stub));

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
const members = (pgid) => psRows().filter((r) => r.pgid === pgid);
const killGroup = (g) => { if (g > 1) try { process.kill(-g, 'SIGKILL'); } catch { /* 已不在 */ } };
const pidGone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code !== 'EPERM'; } };
const marks = new Set();
const runIds = new Set();

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + topic);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]', '  heartbeat_stale_s: 2',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const topicDir = path.join(root, '.reviews', topic);
  const stageDir = path.join(topicDir, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n验收。\n');
  return { root, topic, topicDir, stageDir, runRoot, lock: path.join(root, TD, 'lock', `${topic}.lock`) };
}

async function start(build, fx, stub) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_id) runIds.add(js.run_id);
  if (js?.run_dir) marks.add(`trivium-stub-cli:${js.run_dir}`);
  return { r, js };
}

/** 等两侧桩 CLI 的组长都出现，返回组号 */
async function cliGroups(runDir) {
  const mark = `trivium-stub-cli:${runDir}`;
  let g = [];
  for (let i = 0; i < 100 && g.length < 2; i++) {
    g = groupsWithMark(mark);
    if (g.length < 2) await sleep(100);
  }
  return g;
}

/** 两侧记录（含启动时刻）都落盘（新旧构建都写记录：50cb380 已含 EV-154） */
async function waitRecords(runDir) {
  for (let i = 0; i < 100; i++) {
    const s = await readJson(path.join(runDir, 'status.json')).catch(() => null);
    const v = s ? Object.values(s.sides).map((x) => x.cli) : [];
    if (v.length === 2 && v.every((x) => x && x.started_at)) return true;
    await sleep(100);
  }
  return false;
}

const BLOCKED = { gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } };
const TWO = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };
const OK = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const runJsonOf = (fx, runId) => path.join(fx.stageDir, '_meta', `run-${runId}.json`);
const taskStatusOf = async (fx, runId) =>
  (await readJson(path.join(fx.topicDir, 'task' + '.json')).catch(() => ({ runs: [] }))).runs.find((x) => x.run_id === runId)?.status ?? null;

/** 起两侧 hang_cli、等记录、等心跳过期、跑 --wait；返回判失联之后的现场 */
async function lostRun(build, fx, stub, carrier = false) {
  const { r, js } = await start(build, fx, stub);
  if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
  const groups = await cliGroups(js.run_dir);
  const recorded = await waitRecords(js.run_dir);
  let carrierPath = null;
  if (carrier) {
    carrierPath = path.join(js.run_dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
    await fs.mkdir(path.dirname(carrierPath), { recursive: true });
    await fs.writeFile(carrierPath, '{"provider":{"k":{"apiKey":"fake"}}}');
  }
  await sleep(3000);
  const w = await cli(build, fx.root, ['review', '--wait', js.run_id, '--timeout', '10'], null);
  const status = await readJson(path.join(js.run_dir, 'status.json')).catch(() => null);
  return {
    js, groups, recorded, carrierPath,
    wait: { code: w.code, stderr: w.stderr, heartbeatStale: /heartbeat_stale/.test(w.stdout + w.stderr), cancelHint: /trivium review --cancel/.test(w.stdout + w.stderr) },
    afterWait: { workerAlive: !pidGone(js.worker_pid), members: groups.map((g) => members(g).length), phase: status?.phase ?? null, lost: status?.lost ?? null },
  };
}

/** C1 / C2：堵住的 worker 判失联之后 --cancel */
async function blockedLostThenCancel(build, fx) {
  const L = await lostRun(build, fx, BLOCKED);
  if (L.error) return L;
  const sp = path.join(L.js.run_dir, 'status.json');
  const beforeStart = await start(build, fx, OK);
  const statusSha0 = shaOrNull(sp);
  const t0 = Date.now();
  const c = await cli(build, fx.root, ['review', '--cancel', L.js.run_id], null);
  const ms = Date.now() - t0;
  await sleep(300);
  const meta = await readJson(runJsonOf(fx, L.js.run_id)).catch(() => null);
  const out = {
    ...L,
    startWhileLost: beforeStart.r.code,
    cancel: { code: c.code, ms, stdout: c.stdout, stderr: c.stderr, escalated: /未响应 SIGTERM/.test(c.stderr), byRecord: (c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length },
    after: {
      workerGone: pidGone(L.js.worker_pid), members: L.groups.map((g) => members(g).length),
      runJson: meta ? { status: meta.status, termination: meta.termination ?? null } : null,
      task: await taskStatusOf(fx, L.js.run_id), lockPresent: await exists(fx.lock), statusShaSame: shaOrNull(sp) === statusSha0,
    },
  };
  const afterStart = await start(build, fx, OK);
  out.startAfterCancel = afterStart.r.code;
  if (afterStart.js) {
    let w = { code: 73 };
    for (let i = 0; i < 10 && w.code === 73; i++) w = await cli(build, fx.root, ['review', '--wait', afterStart.js.run_id, '--timeout', '20'], OK);
  }
  return out;
}

async function hookSessionStart(build, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [build.cli, 'gate', 'hook-session-start'], {
      cwd, env: { ...process.env, TRIVIUM_ASSET_ROOT: build.asset, CLAUDE_SESSION_ID: SESSION },
    });
    p.stdout.on('data', () => {});
    p.stderr.on('data', () => {});
    p.on('close', (code) => resolve({ code }));
    p.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }));
  });
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-lost-cancel-'));
try {
  // ── 旧构建 ──
  const oldDir = path.join(base, 'old');
  await fs.mkdir(oldDir, { recursive: true });
  const tarPath = path.join(base, 'old.tar');
  const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', tarPath, BASE_REF, 'src', 'scripts', 'skills', 'skills-src', 'test', '.reviews', 'package.json', 'tsconfig.json']);
  if (ar.code !== 0) throw new Error(`git archive 失败：${ar.stderr}`);
  const ex = await sh(oldDir, 'tar', ['-xf', tarPath]);
  if (ex.code !== 0) throw new Error(`解包失败：${ex.stderr}`);
  const stubDiff = (await sh(ROOT, 'git', ['diff', BASE_REF, '--', 'src/trivium/adapters/stub.ts'])).stdout;
  readout.overlay = { files: [], stubDiffVsBase: stubDiff };
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  const b = await sh(oldDir, process.execPath, ['scripts/build.mjs']);
  if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  const OLD = { name: 'old', cli: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(oldDir, 'skills/dual-critic') };
  readout.bundles = { new: { path: NEW.cli, sha256: sha(NEW.cli) }, old: { path: OLD.cli, sha256: sha(OLD.cli), from: BASE_REF, overlay: [] } };
  check('构建', readout.bundles.new.sha256 !== readout.bundles.old.sha256 && stubDiff === '',
    `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）；桩相对 ${BASE_REF} 无 diff、不叠加 ${stubDiff === ''}`);

  // ── C1 / C4 ──
  const fx1 = await fixture(base, 'C1');
  const c1 = await blockedLostThenCancel(NEW, fx1);
  readout.C1 = c1;
  check('C1', !c1.error && c1.recorded && c1.wait.code === 1 && c1.wait.heartbeatStale && c1.wait.cancelHint
    && c1.afterWait.workerAlive && c1.afterWait.members.every((n) => n === 2) && c1.afterWait.lost?.reason === 'heartbeat_stale'
    && c1.startWhileLost === 70 && c1.cancel.code === 0 && c1.cancel.escalated && c1.cancel.byRecord === 2
    && c1.after.workerGone && c1.after.members.every((n) => n === 0) && c1.after.runJson?.status === 'failed'
    && c1.after.runJson?.termination?.by === 'worker_lost' && c1.after.runJson?.termination?.reason === 'heartbeat_stale'
    && c1.after.task === 'failed' && !c1.after.lockPresent && c1.after.statusShaSame && c1.startAfterCancel === 0,
    `--wait 退 ${c1.wait?.code}（heartbeat_stale ${c1.wait?.heartbeatStale}、出口句 ${c1.wait?.cancelHint}、lost ${JSON.stringify(c1.afterWait?.lost?.reason)}）；判失联后 --start 退 ${c1.startWhileLost}；` +
      `--cancel 退 ${c1.cancel?.code}、升级 ${c1.cancel?.escalated}、按记录 ${c1.cancel?.byRecord} 行、${c1.cancel?.ms} ms；worker 不在 ${c1.after?.workerGone}、组成员 ${JSON.stringify(c1.after?.members)}；` +
      `run.json ${JSON.stringify(c1.after?.runJson)}、登记 ${c1.after?.task}、锁在 ${c1.after?.lockPresent}、status.json 不变 ${c1.after?.statusShaSame}；之后 --start 退 ${c1.startAfterCancel}`);
  if (!c1.error) {
    const sp = path.join(c1.js.run_dir, 'status.json');
    const rp = runJsonOf(fx1, c1.js.run_id);
    const s0 = shaOrNull(sp);
    const r0 = shaOrNull(rp);
    const c = await cli(NEW, fx1.root, ['review', '--cancel', c1.js.run_id], null);
    readout.C4 = { code: c.code, stdout: c.stdout, stderr: c.stderr, statusSame: shaOrNull(sp) === s0, runSame: shaOrNull(rp) === r0 };
    check('C4', c.code === 0 && /已处于终态（failed），无需取消/.test(c.stdout) && readout.C4.statusSame && readout.C4.runSame,
      `再 --cancel 退 ${c.code}、终态早退 ${/无需取消/.test(c.stdout)}、status.json 不变 ${readout.C4.statusSame}、run.json 不变 ${readout.C4.runSame}`);
  } else {
    check('C4', false, 'C1 未跑通');
  }

  // ── C2 ──
  await sleep(1100);
  const c2 = await blockedLostThenCancel(OLD, await fixture(base, 'C2'));
  readout.C2 = c2;
  check('C2', !c2.error && c2.wait.code === 1 && c2.wait.heartbeatStale && c2.afterWait.lost === null && c2.startWhileLost === 70
    && c2.cancel.code === 0 && /已处于终态（failed），无需取消/.test(c2.cancel.stdout)
    && !c2.after.workerGone && c2.after.members.every((n) => n === 2) && c2.after.runJson?.status === 'running'
    && c2.after.lockPresent && c2.startAfterCancel === 70,
    `旧构建：--wait 退 ${c2.wait?.code}、无 lost 键 ${c2.afterWait?.lost === null}；--cancel 终态早退 ${/无需取消/.test(c2.cancel?.stdout ?? '')}；worker 仍在 ${!c2.after?.workerGone}、组成员 ${JSON.stringify(c2.after?.members)}；` +
      `run.json ${c2.after?.runJson?.status}、锁在 ${c2.after?.lockPresent}；之后 --start 退 ${c2.startAfterCancel}（EV-146 原文）`);

  // ── C3 ──
  const slow = async (build) => {
    await sleep(1100);
    const fx = await fixture(base, `C3-${build.name}`);
    const L = await lostRun(build, fx, TWO);
    if (L.error) return L;
    const c = await cli(build, fx.root, ['review', '--cancel', L.js.run_id], null);
    await sleep(300);
    const meta = await readJson(runJsonOf(fx, L.js.run_id)).catch(() => null);
    const wlog = await fs.readFile(path.join(L.js.run_dir, 'worker.log'), 'utf8').catch(() => '');
    return {
      wait: L.wait, afterWait: L.afterWait,
      cancel: { code: c.code, stdout: c.stdout, stderr: c.stderr, escalated: /未响应 SIGTERM/.test(c.stderr), slowSaid: /在宽限内响应 SIGTERM/.test(c.stderr) },
      handlerRan: /收到 SIGTERM：已按组终止审查员 CLI/.test(wlog),
      after: { workerGone: pidGone(L.js.worker_pid), members: L.groups.map((g) => members(g).length), runJson: meta?.status ?? null, termination: meta?.termination ?? null },
    };
  };
  const c3n = await slow(NEW);
  const c3o = await slow(OLD);
  readout.C3 = { new: c3n, old: c3o };
  check('C3', !c3n.error && !c3o.error && c3n.wait.heartbeatStale && c3n.afterWait.workerAlive && !c3n.cancel.escalated && c3n.cancel.slowSaid
    && c3n.handlerRan && c3n.after.workerGone && c3n.after.members.every((n) => n === 0) && c3n.after.runJson === 'failed'
    && c3o.wait.heartbeatStale && /无需取消/.test(c3o.cancel.stdout) && !c3o.after.workerGone && c3o.after.members.every((n) => n === 2) && c3o.after.runJson === 'running',
    `新：升级 ${c3n.cancel?.escalated}、说「宽限内响应」${c3n.cancel?.slowSaid}、处理器跑了 ${c3n.handlerRan}、worker 不在 ${c3n.after?.workerGone}、组 ${JSON.stringify(c3n.after?.members)}、run.json ${c3n.after?.runJson}；` +
      `旧：终态早退 ${/无需取消/.test(c3o.cancel?.stdout ?? '')}、worker 仍在 ${!c3o.after?.workerGone}、组 ${JSON.stringify(c3o.after?.members)}、run.json ${c3o.after?.runJson}`);

  // ── C5：上一主题 B3（b 格）与 B6（c′ 格）照原判据 ──
  const b3 = async (build) => {
    await sleep(1100);
    const fx = await fixture(base, `C5b3-${build.name}`);
    const { r, js } = await start(build, fx, BLOCKED);
    if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
    const groups = await cliGroups(js.run_dir);
    const recorded = await waitRecords(js.run_dir);
    await sleep(1000);
    const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
    await sleep(300);
    const after = groups.map((g) => members(g).length);
    for (const g of groups) killGroup(g);
    killGroup(js.worker_pid);
    return { recorded, escalated: /未响应 SIGTERM/.test(c.stderr), byRecord: (c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, after, code: c.code };
  };
  // B3 原判据的前提是「--cancel 时状态非终态」：heartbeat_stale_s 为 2 的夹具里只要不跑 --wait，status 就仍是 running
  const b6 = async (build) => {
    await sleep(1100);
    const fx = await fixture(base, `C5b6-${build.name}`);
    const { r, js } = await start(build, fx, TWO);
    if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
    const groups = await cliGroups(js.run_dir);
    await waitRecords(js.run_dir);
    killGroup(js.worker_pid);
    for (let i = 0; i < 100 && !pidGone(js.worker_pid); i++) await sleep(50);
    const w = await cli(build, fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], null);
    const afterWait = groups.map((g) => members(g).length);
    const h = await hookSessionStart(build, fx.root);
    const afterHook = groups.map((g) => members(g).length);
    const sp = path.join(js.run_dir, 'status.json');
    const s0 = shaOrNull(sp);
    const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
    await sleep(300);
    const afterCancel = groups.map((g) => members(g).length);
    for (const g of groups) killGroup(g);
    return { waitCode: w.code, pidGoneSaid: /pid_gone/.test(w.stdout + w.stderr), afterWait, hookCode: h.code, afterHook, terminalSaid: /已处于终态（failed）/.test(c.stdout), afterCancel, statusSame: shaOrNull(sp) === s0 };
  };
  const c5 = { b3: { new: await b3(NEW), old: await b3(OLD) }, b6: { new: await b6(NEW), old: await b6(OLD) } };
  readout.C5 = c5;
  const b3ok = (x) => !x.error && x.recorded && x.escalated && x.byRecord === 2 && x.after.every((n) => n === 0);
  const b6ok = (x) => !x.error && x.waitCode === 1 && x.pidGoneSaid && x.afterWait.every((n) => n === 2) && x.hookCode === 0
    && x.afterHook.every((n) => n === 2) && x.terminalSaid && x.afterCancel.every((n) => n === 0) && x.statusSame;
  check('C5', b3ok(c5.b3.new) && b3ok(c5.b3.old) && b6ok(c5.b6.new) && b6ok(c5.b6.old),
    `B3 新 ${b3ok(c5.b3.new)} / 旧 ${b3ok(c5.b3.old)}；B6 新 ${b6ok(c5.b6.new)} / 旧 ${b6ok(c5.b6.old)}（本主题不改这两格）`);

  // ── C6 ──
  await sleep(1100);
  {
    const fx = await fixture(base, 'C6');
    const L = await lostRun(NEW, fx, BLOCKED, true);
    if (L.error) {
      check('C6', false, L.error);
    } else {
      const afterWait = await exists(L.carrierPath);
      const c = await cli(NEW, fx.root, ['review', '--cancel', L.js.run_id], null);
      const afterCancel = await exists(L.carrierPath);
      const s = await cli(NEW, fx.root, ['scrub', '--json'], null);
      const afterScrub = await exists(L.carrierPath);
      readout.C6 = { waitHeartbeatStale: L.wait.heartbeatStale, cancelCode: c.code, workerGone: pidGone(L.js.worker_pid), afterWait, afterCancel, scrubCode: s.code, afterScrub };
      check('C6', L.wait.heartbeatStale && afterWait && c.code === 0 && readout.C6.workerGone && afterCancel && s.code === 0 && !afterScrub,
        `--wait 后载体在 ${afterWait}；--cancel（本格）后载体在 ${afterCancel}；trivium scrub 后载体在 ${afterScrub}`);
    }
  }

  // ── C7 ──
  {
    const norm = (s) => s
      .replace(/\d{8}T\d{6}Z/g, '<RUN>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>')
      .replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<BASE>')
      .replace(/C7-[a-z_]+-(new|old)/g, 'C7-<T>-<B>')
      .replace(/\b\d{3,7}\b/g, '<N>');
    const one = async (build, kind, stub) => {
      await sleep(1100);
      const fx = await fixture(base, `C7-${kind}-${build.name}`);
      const { js } = await start(build, fx, stub);
      if (kind === 'hang_cli') await cliGroups(js.run_dir);
      else await sleep(500);
      const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
      for (const g of groupsWithMark(`trivium-stub-cli:${js.run_dir}`)) killGroup(g);
      return { stdout: c.stdout, stderr: c.stderr, code: c.code };
    };
    const kinds = { hang: { gemini: { mode: 'hang' }, glm: { mode: 'hang' } }, hang_cli: TWO };
    readout.C7 = {};
    let ok = true;
    const parts = [];
    for (const [k, stub] of Object.entries(kinds)) {
      const n = await one(NEW, k, stub);
      const o = await one(OLD, k, stub);
      const same = { stdout: norm(n.stdout) === norm(o.stdout), stderr: norm(n.stderr) === norm(o.stderr) };
      readout.C7[k] = { new: n, old: o, normalized: { new: { stdout: norm(n.stdout), stderr: norm(n.stderr) }, old: { stdout: norm(o.stdout), stderr: norm(o.stderr) } }, same };
      ok &&= n.code === o.code && same.stdout && same.stderr;
      parts.push(`${k}：退出码 ${n.code}/${o.code}、stdout 同 ${same.stdout}、stderr 同 ${same.stderr}`);
    }
    check('C7', ok, parts.join('；'));
  }

  // ── C8（回滚方向）──
  await sleep(1100);
  {
    const fx = await fixture(base, 'C8');
    const L = await lostRun(NEW, fx, BLOCKED);
    if (L.error) {
      check('C8', false, L.error);
    } else {
      killGroup(L.js.worker_pid);
      for (const g of L.groups) killGroup(g);
      for (let i = 0; i < 40 && (!pidGone(L.js.worker_pid) || L.groups.some((g) => members(g).length > 0)); i++) await sleep(50);
      const ns = await cli(NEW, fx.root, ['review', '--status', L.js.run_id, '--json'], null);
      const os_ = await cli(OLD, fx.root, ['review', '--status', L.js.run_id, '--json'], null);
      const oj = jsonOf(os_.stdout);
      const oc = await cli(OLD, fx.root, ['review', '--cancel', L.js.run_id], null);
      readout.C8 = {
        lostWritten: L.afterWait.lost, newStatusCode: ns.code, oldStatusCode: os_.code, oldLostEchoed: oj?.status?.lost ?? null,
        oldCancelCode: oc.code, oldCancelStdout: oc.stdout, oldCancelStderr: oc.stderr,
      };
      check('C8', L.afterWait.lost?.reason === 'heartbeat_stale' && ns.code === os_.code && oj?.status?.lost?.reason === 'heartbeat_stale'
        && oc.code === 0 && /已处于终态（failed），无需取消/.test(oc.stdout),
        `新构建写下 lost ${JSON.stringify(L.afterWait.lost?.reason)}；旧构建 --status 退 ${os_.code}（新 ${ns.code}）、lost 原样透出 ${JSON.stringify(oj?.status?.lost?.reason ?? null)}；旧 --cancel 退 ${oc.code}、终态早退 ${/无需取消/.test(oc.stdout)}`);
    }
  }
} finally {
  for (const m of marks) for (const g of groupsWithMark(m)) killGroup(g);
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) killGroup(r.pgid);
  await sleep(300);
  const left = [];
  for (const m of marks) left.push(...groupsWithMark(m));
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) left.push(r.pgid);
  readout.leftover_groups = left;
  await fs.rm(base, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass} / ${results.length}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ results, readout }, null, 2) + '\n');
process.exit(pass === results.length ? 0 : 1);
