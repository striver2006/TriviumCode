#!/usr/bin/env node
/**
 * 「worker启动时刻规范化」零配额验收（计划 r2 §5.4 A1～A8）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录（每个夹具的 run_root 各在 mkdtemp 之下）、旧构建都建在
 * 一个 mkdtemp 目录下；审核者换成桩（`TRIVIUM_STUB_CRITIC`，两侧 hang_cli：worker 与 CLI 一直活着，读者误判就会动手），
 * 不发起任何模型调用。收尾只删 mkdtemp 的返回值；残留进程按组号结束（本次运行目录标记认得出的桩 CLI 组、本次 run_id 的 worker）。
 *
 * 写者 / 读者的环境（与 test/helpers/start-env.ts 同值）：W = TZ=Asia/Tokyo LC_ALL=fr_FR.UTF-8；R = TZ=America/New_York LANG=de_DE.UTF-8。
 * 环境准备段先对一个探针进程做 P0（两个环境的缺省形态确实不同、且都不等于规范化形态，计划双审 r1 CODEX-02），三个形态进读数。
 *
 * 新旧两份构建（沿用上一主题做法）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`，TRIVIUM_ASSET_ROOT 指工作树；
 *   - 旧：`git archive` 固定提交（缺省 6b89cc0，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，`node_modules` 软链工作树，
 *     不叠加任何文件（桩相对基线的 diff 进读数，非空即判失败），`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 *   A1 新写新读、R≠W：新 --start（W）⇒ status.json 与锁带规范化字段；新 --wait（R）退 73、新 scrub --dry-run（R）计 alive、
 *      新同阶段 --start（R）退 70、新 --cancel（R）发 SIGTERM 并收尾 cancelled（worker 与两组都结束）
 *   A2 旧写新读、同环境：旧 --start（W）⇒ 没有规范化字段；新 --wait / --start / --cancel（W）照常：73；70；按组结束
 *   A3 旧写新读、异环境：旧 --start（W）；新 --wait（R）与旧 --wait（R）结果相同（判失联 pid_gone）——升级窗口不改善也不恶化
 *   A4 遗留锁旧写新读（计划双审 r1 GLM-01：两轮独立序列）：每轮旧 --start → 按组 SIGKILL worker 与 CLI → 旧 --wait 判失联
 *      （回收闸门，锁留下）→ 新 --start（第一轮 W、第二轮 R）⇒ 按 pid_gone 回收遗留锁并起跑
 *   A5 新写旧读、同环境：新 --start（W）；旧 --wait / --start / --cancel（W）照常：73；70；按组结束
 *   A6 新写旧读、异环境：新 --start（W）；旧 --wait（R）判失联 pid_gone（回滚即回到 EV-158 的现状）
 *   A7 旧版读改写保留新字段：A5 里旧 --cancel 把 status.json 写成 cancelled 之后，规范化字段逐字保留
 *   A8 新构建 doctor --selftest
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
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '6b89cc0';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

const W = { TZ: 'Asia/Tokyo', LC_ALL: 'fr_FR.UTF-8', LANG: undefined, LC_TIME: undefined };
const R = { TZ: 'America/New_York', LANG: 'de_DE.UTF-8', LC_ALL: undefined, LC_TIME: undefined };

const results = [];
const readout = { base_ref: BASE_REF, node: process.version, platform: process.platform, env: { W, R } };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const exists = async (p) => fs.access(p).then(() => true, () => false);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 在 process.env 之上叠加 env；值为 undefined 的键删除 */
function mergeEnv(env) {
  const out = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}
async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: mergeEnv(env), maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const envFor = (build, stub, extra) => ({ TRIVIUM_ASSET_ROOT: build.asset, [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : '', CLAUDE_SESSION_ID: SESSION, ...extra });
const cli = (build, cwd, args, stub, extra = {}) => sh(cwd, process.execPath, [build.cli, ...args], envFor(build, stub, extra));

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

/** 一个 pid 在给定环境下的缺省形态与规范化形态（与 processStartTime 同形：规范化 = 叠加 LC_ALL=C、TZ=UTC0） */
const lstart = (pid, env) => {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { env: mergeEnv(env), encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};
const formsOf = (pid) => ({ w: lstart(pid, W), r: lstart(pid, R), canonical: lstart(pid, { LC_ALL: 'C', TZ: 'UTC0' }) });

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + topic);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]',
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

const TWO = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };
const OK = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const runJsonOf = (fx, runId) => path.join(fx.stageDir, '_meta', `run-${runId}.json`);

async function start(build, fx, stub, env) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub, env);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_id) runIds.add(js.run_id);
  if (js?.run_dir) marks.add(`trivium-stub-cli:${js.run_dir}`);
  return { r, js };
}

/** 起两侧 hang_cli（写者环境 env），等两组组长出现、等 status.json 的 worker_pid 与两侧记录落盘 */
async function startLive(build, fx, env) {
  const { r, js } = await start(build, fx, TWO, env);
  if (!js) return { error: `--start 失败（${build.name}）：${r.stdout}${r.stderr}` };
  const mark = `trivium-stub-cli:${js.run_dir}`;
  let groups = [];
  for (let i = 0; i < 100 && groups.length < 2; i++) {
    groups = groupsWithMark(mark);
    if (groups.length < 2) await sleep(100);
  }
  let status = null;
  for (let i = 0; i < 100; i++) {
    status = await readJson(path.join(js.run_dir, 'status.json')).catch(() => null);
    const v = status ? Object.values(status.sides).map((x) => x.cli) : [];
    if (status?.worker_pid && v.length === 2 && v.every((x) => x && x.started_at)) break;
    await sleep(100);
  }
  const lock = await readJson(fx.lock).catch(() => null);
  return { js, groups, status, lock, forms: formsOf(js.worker_pid) };
}

function cleanupRun(L) {
  if (!L?.js) return;
  killGroup(L.js.worker_pid);
  for (const g of L.groups ?? []) killGroup(g);
  for (const g of groupsWithMark(`trivium-stub-cli:${L.js.run_dir}`)) killGroup(g);
}

async function waitGone(pids, groups, ms = 3000) {
  for (let i = 0; i < ms / 50 && (pids.some((p) => !pidGone(p)) || groups.some((g) => members(g).length > 0)); i++) await sleep(50);
}

/** --cancel 之后的读数 */
async function cancelReadout(build, fx, L, env) {
  const c = await cli(build, fx.root, ['review', '--cancel', L.js.run_id], null, env);
  await waitGone([L.js.worker_pid], L.groups);
  const st = await readJson(path.join(L.js.run_dir, 'status.json')).catch(() => null);
  const meta = await readJson(runJsonOf(fx, L.js.run_id)).catch(() => null);
  return {
    code: c.code, stdout: c.stdout, stderr: c.stderr,
    sigterm: new RegExp(`向工作进程组 ${L.js.worker_pid} 发送 SIGTERM`).test(c.stderr),
    saidGone: /已不存在，仅做状态与锁的清理/.test(c.stderr),
    workerGone: pidGone(L.js.worker_pid), members: L.groups.map((g) => members(g).length),
    phase: st?.phase ?? null, runJson: meta?.status ?? null, statusAfter: st,
  };
}

const waitLost = (text) => /失联（pid_gone）/.test(text);

async function hookSessionStart(build, cwd, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [build.cli, 'gate', 'hook-session-start'], {
      cwd, env: mergeEnv({ TRIVIUM_ASSET_ROOT: build.asset, CLAUDE_SESSION_ID: SESSION, ...env }),
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', () => {});
    p.on('close', (code) => resolve({ code, stdout: out }));
    p.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }));
  });
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-start-canon-'));
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

  // ── P0：环境对确实错开 ──
  {
    const probe = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
    await sleep(100);
    const f = formsOf(probe.pid);
    killGroup(probe.pid);
    readout.P0 = f;
    check('P0', !!(f.w && f.r && f.canonical) && f.w !== f.r && f.w !== f.canonical && f.r !== f.canonical,
      `W ${JSON.stringify(f.w)} / R ${JSON.stringify(f.r)} / 规范化 ${JSON.stringify(f.canonical)}`);
  }

  // ── A1：新写新读、R≠W ──
  {
    const fx = await fixture(base, 'A1');
    const L = await startLive(NEW, fx, W);
    try {
      if (L.error) throw new Error(L.error);
      const wait = await cli(NEW, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3'], null, R);
      const carrier = path.join(L.js.run_dir, 'glm', 'home', '.zcode', 'cli', 'config.json');
      await fs.mkdir(path.dirname(carrier), { recursive: true });
      await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
      const hook = await hookSessionStart(NEW, fx.root, R);
      const scrub = await cli(NEW, fx.root, ['scrub', '--dry-run', '--json'], null, R);
      const sj = jsonOf(scrub.stdout);
      const carrierKept = await exists(carrier);
      const again = await start(NEW, fx, OK, R);
      const cancel = await cancelReadout(NEW, fx, L, R);
      readout.A1 = {
        forms: L.forms,
        written: {
          status: { legacy: L.status?.worker_started_at, canonical: L.status?.worker_started_at_canonical },
          lock: { pid: L.lock?.pid, legacy: L.lock?.pid_started_at, canonical: L.lock?.pid_started_at_canonical },
        },
        wait: { code: wait.code, lost: waitLost(wait.stdout + wait.stderr) },
        hook: { code: hook.code, swept: /已回收/.test(hook.stdout) }, carrierKept,
        scrub: { code: scrub.code, alive: sj?.alive ?? null },
        startAgain: again.r.code, cancel: { ...cancel, statusAfter: undefined },
      };
      check('A1', L.status?.worker_started_at_canonical === L.forms.canonical && L.lock?.pid_started_at_canonical === L.forms.canonical
        && L.status?.worker_started_at === L.forms.w && L.lock?.pid === L.js.worker_pid
        && wait.code === 73 && hook.code === 0 && !readout.A1.hook.swept && carrierKept && sj?.alive === 1 && again.r.code === 70
        && cancel.code === 0 && cancel.sigterm && !cancel.saidGone && cancel.workerGone && cancel.members.every((n) => n === 0)
        && cancel.phase === 'cancelled' && cancel.runJson === 'cancelled',
        `新字段 status ${JSON.stringify(L.status?.worker_started_at_canonical)} / 锁 ${JSON.stringify(L.lock?.pid_started_at_canonical)}（worker 规范化 ${JSON.stringify(L.forms.canonical)}）；` +
          `R 下：--wait 退 ${wait.code}、会话启动清扫退 ${hook.code} 未回收闸门 ${!readout.A1.hook.swept}、副本仍在 ${carrierKept}、scrub alive ${sj?.alive}、同阶段 --start 退 ${again.r.code}、` +
          `--cancel 退 ${cancel.code} 发 SIGTERM ${cancel.sigterm}、worker 不在 ${cancel.workerGone}、组成员 ${JSON.stringify(cancel.members)}、status ${cancel.phase}、run.json ${cancel.runJson}`);
    } finally {
      cleanupRun(L);
    }
  }

  // ── A2：旧写新读、同环境 ──
  await sleep(1100);
  {
    const fx = await fixture(base, 'A2');
    const L = await startLive(OLD, fx, W);
    try {
      if (L.error) throw new Error(L.error);
      const wait = await cli(NEW, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3'], null, W);
      const again = await start(NEW, fx, OK, W);
      const cancel = await cancelReadout(NEW, fx, L, W);
      const noKeys = L.status && !('worker_started_at_canonical' in L.status) && L.lock && !('pid_started_at_canonical' in L.lock);
      readout.A2 = { forms: L.forms, noNewKeys: noKeys, wait: { code: wait.code }, startAgain: again.r.code, cancel: { ...cancel, statusAfter: undefined } };
      check('A2', noKeys && wait.code === 73 && again.r.code === 70 && cancel.code === 0 && cancel.sigterm && cancel.workerGone
        && cancel.members.every((n) => n === 0) && cancel.phase === 'cancelled',
        `旧版写下的 status.json / 锁没有新字段 ${noKeys}；新读者（W）：--wait 退 ${wait.code}、同阶段 --start 退 ${again.r.code}、--cancel 发 SIGTERM ${cancel.sigterm}、worker 不在 ${cancel.workerGone}、组成员 ${JSON.stringify(cancel.members)}、status ${cancel.phase}`);
    } finally {
      cleanupRun(L);
    }
  }

  // ── A3：旧写新读、异环境（新旧读者各一轮，结果应相同）──
  {
    const one = async (reader) => {
      await sleep(1100);
      const fx = await fixture(base, `A3-${reader.name}`);
      const L = await startLive(OLD, fx, W);
      try {
        if (L.error) return { error: L.error };
        const wait = await cli(reader, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3'], null, R);
        const meta = await readJson(runJsonOf(fx, L.js.run_id)).catch(() => null);
        return { code: wait.code, lost: waitLost(wait.stdout + wait.stderr), workerAlive: !pidGone(L.js.worker_pid), runJson: meta?.status ?? null };
      } finally {
        cleanupRun(L);
      }
    };
    const n = await one(NEW);
    const o = await one(OLD);
    readout.A3 = { new: n, old: o };
    check('A3', !n.error && !o.error && n.code === o.code && n.lost === o.lost && n.lost && n.workerAlive && o.workerAlive && n.runJson === o.runJson,
      `旧版写下、R 下读：新 --wait 退 ${n.code}（判 pid_gone ${n.lost}、worker 其实活着 ${n.workerAlive}、run.json ${n.runJson}）；旧 --wait 退 ${o.code}（${o.lost}、${o.workerAlive}、${o.runJson}）——与旧版相同，不改善也不恶化`);
  }

  // ── A4：遗留锁旧写新读，两轮独立序列 ──
  {
    const round = async (label, env) => {
      await sleep(1100);
      const fx = await fixture(base, `A4-${label}`);
      const L = await startLive(OLD, fx, W);
      let N = null;
      try {
        if (L.error) return { error: L.error };
        cleanupRun(L);
        await waitGone([L.js.worker_pid], L.groups);
        const ow = await cli(OLD, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3'], null, W);
        const lockLeft = await readJson(fx.lock).catch(() => null);
        const n = await start(NEW, fx, TWO, env);
        N = n.js ? { js: n.js, groups: [] } : null;
        const reclaimed = /回收主题「[^」]+」的遗留锁（原因 pid_gone/.test(n.r.stderr);
        const lockNow = await readJson(fx.lock).catch(() => null);
        return {
          oldWait: ow.code, leftoverLockPid: lockLeft?.pid ?? null, leftoverHasCanonical: lockLeft ? 'pid_started_at_canonical' in lockLeft : null,
          newStart: n.r.code, reclaimed, newLockPid: lockNow?.pid ?? null, newWorker: n.js?.worker_pid ?? null,
          newLockCanonical: lockNow?.pid_started_at_canonical ?? null,
        };
      } finally {
        cleanupRun(L);
        if (N) {
          await sleep(300);
          cleanupRun(N);
        }
      }
    };
    const r1 = await round('W', W);
    const r2 = await round('R', R);
    readout.A4 = { W: r1, R: r2 };
    const ok = (x) => !x.error && x.leftoverLockPid !== null && x.leftoverHasCanonical === false && x.newStart === 0 && x.reclaimed && x.newLockPid === x.newWorker && !!x.newLockCanonical;
    check('A4', ok(r1) && ok(r2),
      `第一轮（新 --start 在 W）：遗留锁无新字段 ${r1.leftoverHasCanonical === false}、--start 退 ${r1.newStart}、按 pid_gone 回收 ${r1.reclaimed}、新锁归新 worker ${r1.newLockPid === r1.newWorker}；` +
        `第二轮（R）：${r2.leftoverHasCanonical === false}、退 ${r2.newStart}、${r2.reclaimed}、${r2.newLockPid === r2.newWorker}`);
  }

  // ── A5 / A7：新写旧读、同环境 ──
  await sleep(1100);
  {
    const fx = await fixture(base, 'A5');
    const L = await startLive(NEW, fx, W);
    try {
      if (L.error) throw new Error(L.error);
      const wait = await cli(OLD, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3'], null, W);
      const again = await start(OLD, fx, OK, W);
      const cancel = await cancelReadout(OLD, fx, L, W);
      readout.A5 = { forms: L.forms, wait: { code: wait.code }, startAgain: again.r.code, cancel: { ...cancel, statusAfter: undefined } };
      check('A5', wait.code === 73 && again.r.code === 70 && cancel.code === 0 && cancel.sigterm && cancel.workerGone
        && cancel.members.every((n) => n === 0) && cancel.phase === 'cancelled',
        `旧读者（W）：--wait 退 ${wait.code}、同阶段 --start 退 ${again.r.code}、--cancel 发 SIGTERM ${cancel.sigterm}、worker 不在 ${cancel.workerGone}、组成员 ${JSON.stringify(cancel.members)}、status ${cancel.phase}`);
      const kept = cancel.statusAfter?.worker_started_at_canonical;
      readout.A7 = { before: L.status?.worker_started_at_canonical ?? null, after: kept ?? null, phaseAfter: cancel.phase };
      check('A7', !!kept && kept === L.status?.worker_started_at_canonical && cancel.phase === 'cancelled',
        `旧版 --cancel 读改写 status.json（写成 ${cancel.phase}）之后规范化字段 ${JSON.stringify(kept)}，与写下时逐字相同 ${kept === L.status?.worker_started_at_canonical}`);
    } finally {
      cleanupRun(L);
    }
  }

  // ── A6：新写旧读、异环境 ──
  await sleep(1100);
  {
    const fx = await fixture(base, 'A6');
    const L = await startLive(NEW, fx, W);
    try {
      if (L.error) throw new Error(L.error);
      const wait = await cli(OLD, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3'], null, R);
      readout.A6 = { code: wait.code, lost: waitLost(wait.stdout + wait.stderr), workerAlive: !pidGone(L.js.worker_pid) };
      check('A6', wait.code === 1 && readout.A6.lost && readout.A6.workerAlive,
        `新版写下、旧读者 R 下：--wait 退 ${wait.code}、判 pid_gone ${readout.A6.lost}（worker 其实活着 ${readout.A6.workerAlive}）——回滚即回到 EV-158 的现状`);
    } finally {
      cleanupRun(L);
    }
  }

  // ── A8：doctor 自检 ──
  {
    const d = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(d.stdout + d.stderr);
    readout.A8 = { code: d.code, tail: (d.stdout + d.stderr).trim().split('\n').slice(-6) };
    check('A8', d.code === 0 && !!m && m[1] === m[2], `doctor --selftest 退 ${d.code}、${m ? `${m[1]}/${m[2]}` : '（没读到计数）'}`);
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
