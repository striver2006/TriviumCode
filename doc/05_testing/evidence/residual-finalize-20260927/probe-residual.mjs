#!/usr/bin/env node
/**
 * 只读实测（不碰真实 HOME、不改本仓归档）：事后收尾余项（BACKLOG EV-145 余项 ①～④）今天各留下什么。
 * 仓库构建的 CLI（53eaab8）+ 桩审查员，mkdtemp 夹具，收尾只删 mkdtemp 的返回值。
 *
 *   C1a 首轮登记失败（主题目录只读，阶段目录可写）⇒ run.json / 闸门 / 锁 / 运行目录 / 会话启动提示 / report / gate / status
 *   C1b 第 2 轮登记失败（第 1 轮已审批）⇒ 同上；不带 --run-id 的 gate 指向哪一轮；随后成功重跑的轮次号
 *   C2a startRun 派生前失败（预建只读运行目录 ⇒ 写交接文件 EACCES）⇒ 同上；--wait / --cancel 能否收尾
 *   C2b startRun 派生后失败（预建运行目录里放一个名为 worker.pid 的目录 ⇒ 写 worker.pid EISDIR）
 *       · ok 桩：worker 是否照常跑完、run.json 终态、闸门终态
 *       · hang 桩：--start 报错之后 worker 是否还活着、锁与闸门是否已放；此时同阶段能否再 --start；杀掉后 --wait / --cancel 能否收尾
 *   C2c 纯文档跳过分支里 executeRun 抛错（闸门状态文件替换成目录 ⇒ 跳过分支的闸门写入抛）⇒ run.json 是什么
 *   C3  同步路径 executeRun 抛错（阶段目录只读、_meta 可写 ⇒ 写审查文档 EACCES）⇒ 同上；--wait / --cancel 能否收尾
 *   C4  worker 猝死（hang + SIGKILL）且不跑 --wait / --cancel
 *       a 会话启动 Hook：清扫与提示；run.json
 *       b 接着直接再 --start：遗留锁回收、旧 run.json、report
 *       c 最后对旧 run 补跑 --wait：能否收尾
 *
 * 用法：node probe-residual.mjs <仓库根>
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pexec = promisify(execFile);
const ROOT = path.resolve(process.argv[2] ?? '.');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const { repoId } = await import(path.join(ROOT, 'dist/test/src/trivium/review.js'));
const SESSION = 'S-probe';
const TD = '.' + 'trivium';
const STATE = 'state' + '.json';
const TASK = 'task' + '.json';

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
function shIn(cwd, bin, args, env, input) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.stdin.end(input);
  });
}
const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
const HANG = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };
const envFor = (stub) => ({ TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: encodeStubConfig(stub), CLAUDE_SESSION_ID: SESSION });
const cli = (cwd, args, stub = OK) => sh(cwd, process.execPath, [CLI, ...args], envFor(stub));
const hookSessionStart = (cwd) =>
  shIn(cwd, process.execPath, [CLI, 'gate', 'hook-session-start'], { TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), CLAUDE_SESSION_ID: SESSION }, JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }));
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const lines = (r, n = 4) => (r.stdout + r.stderr).split('\n').filter(Boolean).slice(0, n);
const tail = (r, n = 4) => (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-n);
const jsonOf = (r) => { try { return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const runIdAt = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已不在 */ } } };
const out = {};
const toKill = new Set();
const seenRunIds = new Set();
const CELLS = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const want = (c) => !CELLS || CELLS.has(c);

async function fixture(base, topic, extraCfg = []) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + topic);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    ...extraCfg,
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const topicDir = path.join(root, '.reviews', topic);
  const stageDir = path.join(topicDir, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n实测。\n');
  return { root, topicDir, stageDir, runRoot };
}

async function start(root, topic, stub = OK, stage = 'plan', entry = 'B') {
  const r = await cli(root, ['review', '--start', '--entry', entry, '--stage', stage, '--topic', topic, '--focus', '实测', '--session-id', SESSION, '--json'], stub);
  const js = r.code === 0 ? jsonOf(r) : null;
  if (js?.worker_pid) toKill.add(js.worker_pid);
  return { r, runId: js?.run_id ?? null, workerPid: js?.worker_pid ?? null, runDir: js?.run_dir ?? null };
}
async function waitDone(root, runId, stub = OK) {
  let w;
  for (let i = 0; i < 10; i++) {
    w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], stub);
    if (w.code !== 73) break;
  }
  return w;
}
const ls = async (d) => (await fs.readdir(d).catch(() => [])).sort();
async function runDirsOf(runRoot) {
  const o = {};
  for (const repo of await ls(runRoot)) {
    for (const id of await ls(path.join(runRoot, repo))) o[id] = await ls(path.join(runRoot, repo, id));
  }
  return o;
}
async function gateOf(root, topic, stage = 'plan') {
  const s = await readJson(path.join(root, TD, STATE)).catch(() => null);
  const g = s?.gates?.[`${topic}/${stage}`];
  return g ? { state: g.state, run_id: g.run_id, rerun_index: g.rerun_index } : null;
}
async function taskRuns(topicDir) {
  const t = await readJson(path.join(topicDir, TASK)).catch(() => null);
  return t?.runs?.map((r) => ({ run_id: r.run_id, stage: r.stage, r: r.rerun_index, status: r.status })) ?? null;
}
async function runMetas(stageDir) {
  const o = {};
  for (const n of await ls(path.join(stageDir, '_meta'))) {
    const id = /^run-(.+)\.json$/.exec(n)?.[1];
    if (!id) continue;
    seenRunIds.add(id);
    const j = await readJson(path.join(stageDir, '_meta', n)).catch(() => null);
    o[id] = j && { status: j.status, gate: j.gate?.state, r: j.rerun_index, finished_at: j.finished_at, termination: j.termination ?? null, skipped: j.skipped ?? null, artifacts: j.artifacts?.length };
  }
  return o;
}
const locks = async (root) => ls(path.join(root, TD, 'lock'));
async function report(root, topic) {
  const r = await cli(root, ['report', '--topic', topic, '--json']);
  const j = jsonOf(r);
  return {
    code: r.code,
    rounds: (j?.rounds ?? []).map((x) => ({ stage: x.stage, r: x.rerunIndex, runId: x.runId, status: x.status })),
    unlisted: (j?.unlistedRuns ?? []).map((x) => ({ stage: x.stage, r: x.rerunIndex, runId: x.runId, status: x.status, label: x.label })),
  };
}
const gateCheck = async (root, topic, stage = 'plan') => {
  const r = await cli(root, ['gate', '--stage', stage, '--topic', topic, '--check', '--json', '--session-id', SESSION]);
  const j = jsonOf(r);
  return { code: r.code, run_id: j?.run_id ?? null, rerun_index: j?.rerun_index ?? null, failures: (j?.failures ?? []).map((f) => f.code ?? f).slice(0, 4), text: j ? undefined : lines(r, 3) };
};
const statusRuns = async (root, topic) => {
  const r = await cli(root, ['status', '--topic', topic, '--json']);
  const j = jsonOf(r);
  return { code: r.code, runs: j?.topics?.[0]?.runs ?? null };
};
const topicResolve = async (root, topic, stage = 'plan') => {
  const r = await cli(root, ['topic', 'resolve', '--stage', stage, '--json', '--', '实测', '--topic', topic]);
  return { code: r.code, driver: jsonOf(r)?.driver ?? null, text: jsonOf(r) ? undefined : lines(r, 2) };
};
async function writeDisposition(stageDir, topic, runId) {
  await fs.writeFile(
    path.join(stageDir, `${today()}-${topic}-revised-` + 'claude.md'),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${topic}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${topic}-gemini.md`, `  - ${today()}-${topic}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 同一处问题，一并补上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );
}
/** 预建接下来 n 秒可能用到的运行目录（两种项目根写法各一份，projectRoot 是否 realpath 过不确定） */
async function precreateRunDirs(fx, n, prep) {
  const repos = new Set([repoId(fx.root), repoId(await fs.realpath(fx.root))]);
  const made = [];
  const t0 = Date.now();
  for (const repo of repos) {
    for (let i = 0; i < n; i++) {
      const d = path.join(fx.runRoot, repo, runIdAt(t0 + i * 1000));
      await fs.mkdir(d, { recursive: true });
      await prep(d);
      made.push(d);
    }
  }
  return made;
}
const snapshot = async (fx, topic) => ({
  runMetas: await runMetas(fx.stageDir),
  task: await taskRuns(fx.topicDir),
  gate: await gateOf(fx.root, topic),
  locks: await locks(fx.root),
});

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-residual-'));
try {
  if (want('C1a')) // ── C1a 首轮登记失败 ──
  {
    const topic = 'C1a-首轮登记失败';
    const fx = await fixture(base, topic);
    await fs.chmod(fx.topicDir, 0o555);
    const s = await start(fx.root, topic);
    await fs.chmod(fx.topicDir, 0o755);
    const ss = await hookSessionStart(fx.root);
    out.C1a = {
      startCode: s.r.code, startMsg: tail(s.r, 3),
      ...(await snapshot(fx, topic)),
      runDirs: await runDirsOf(fx.runRoot),
      sessionStart: { code: ss.code, ctx: jsonOf(ss)?.hookSpecificOutput?.additionalContext ?? (ss.stdout + ss.stderr).slice(0, 400) },
      report: await report(fx.root, topic),
      gateCheckNoRunId: await gateCheck(fx.root, topic),
      status: await statusRuns(fx.root, topic),
      topicResolve: await topicResolve(fx.root, topic),
    };
  }

  if (want('C1b')) // ── C1b 第 2 轮登记失败（第 1 轮已审批） ──
  {
    const topic = 'C1b-次轮登记失败';
    const fx = await fixture(base, topic);
    const s1 = await start(fx.root, topic);
    await waitDone(fx.root, s1.runId);
    await writeDisposition(fx.stageDir, topic, s1.runId);
    const chk = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--check', '--session-id', SESSION]);
    const ap = await cli(fx.root, ['approve', '--topic', topic, '--stage', 'plan', '--session-id', SESSION]);
    await sleep(1100);
    await fs.chmod(fx.topicDir, 0o555);
    const s2 = await start(fx.root, topic);
    await fs.chmod(fx.topicDir, 0o755);
    out.C1b = {
      r1: s1.runId, checkCode: chk.code, approveCode: ap.code,
      startCode: s2.r.code, startMsg: tail(s2.r, 3),
      ...(await snapshot(fx, topic)),
      report: await report(fx.root, topic),
      gateCheckNoRunId: await gateCheck(fx.root, topic),
      status: await statusRuns(fx.root, topic),
    };
    await sleep(1100);
    const s3 = await start(fx.root, topic);
    if (s3.runId) await waitDone(fx.root, s3.runId);
    out.C1b_rerun = { startCode: s3.r.code, startMsg: s3.runId ? null : tail(s3.r, 3), runMetas: await runMetas(fx.stageDir), report: await report(fx.root, topic) };
  }

  if (want('C2a')) // ── C2a 派生前失败 ──
  {
    const topic = 'C2a-派生前失败';
    const fx = await fixture(base, topic);
    const made = await precreateRunDirs(fx, 15, (d) => fs.chmod(d, 0o555));
    const s = await start(fx.root, topic);
    for (const d of made) await fs.chmod(d, 0o755).catch(() => {});
    const snap = await snapshot(fx, topic);
    const rid = Object.keys(snap.runMetas)[0] ?? null;
    const runDirs = await runDirsOf(fx.runRoot);
    const w = rid ? await cli(fx.root, ['review', '--wait', rid, '--timeout', '6']) : null;
    const c = rid ? await cli(fx.root, ['review', '--cancel', rid]) : null;
    out.C2a = {
      startCode: s.r.code, startMsg: tail(s.r, 3),
      ...snap,
      runDirWithFiles: Object.fromEntries(Object.entries(runDirs).filter(([, v]) => v.length > 0)),
      wait: w && { code: w.code, tail: tail(w, 3) },
      cancel: c && { code: c.code, tail: tail(c, 3) },
      runMetasAfterWaitCancel: await runMetas(fx.stageDir),
      report: await report(fx.root, topic),
    };
  }

  if (want('C2b_ok')) // ── C2b 派生后失败：ok 桩 ──
  {
    const topic = 'C2b-派生后失败-ok';
    const fx = await fixture(base, topic);
    await precreateRunDirs(fx, 15, (d) => fs.mkdir(path.join(d, 'worker.pid')));
    const t0 = Date.now();
    const s = await start(fx.root, topic);
    const startMs = Date.now() - t0;
    const snap0 = await snapshot(fx, topic);
    await sleep(6000); // 让孤儿 worker 跑完
    out.C2b_ok = {
      startCode: s.r.code, startMsg: tail(s.r, 3), startMs,
      rightAfterStart: snap0,
      after6s: await snapshot(fx, topic),
      docs: (await ls(fx.stageDir)).filter((n) => n.endsWith('.md')),
      report: await report(fx.root, topic),
    };
  }

  if (want('C2b_hang')) // ── C2b 派生后失败：hang 桩 ──
  {
    const topic = 'C2b-派生后失败-hang';
    const fx = await fixture(base, topic);
    const made = await precreateRunDirs(fx, 15, (d) => fs.mkdir(path.join(d, 'worker.pid')));
    const s = await start(fx.root, topic, HANG);
    await sleep(1500);
    // 第一次 --start 用掉其中一个；其余撤掉，让第二次 --start 走正常路径
    const usedIds = new Set(Object.keys(await runMetas(fx.stageDir)));
    for (const d of made) if (!usedIds.has(path.basename(d))) await fs.rm(d, { recursive: true, force: true });
    const snap = await snapshot(fx, topic);
    const rid = Object.keys(snap.runMetas)[0] ?? null;
    // 找孤儿 worker：status.json 里有没有 worker_pid；没有就按命令行找
    const runDirs = await runDirsOf(fx.runRoot);
    let orphan = null;
    const ps = await sh(base, 'ps', ['-axo', 'pid=,command=']);
    for (const l of ps.stdout.split('\n')) {
      if (rid && l.includes('--worker') && l.includes(rid)) orphan = Number.parseInt(l.trim(), 10);
    }
    if (orphan) toKill.add(orphan);
    const statusJson = rid
      ? await (async () => {
          for (const repo of await ls(fx.runRoot)) {
            const p = path.join(fx.runRoot, repo, rid, 'status.json');
            const j = await readJson(p).catch(() => null);
            if (j) return { phase: j.phase, worker_pid: j.worker_pid ?? null };
          }
          return null;
        })()
      : null;
    // 孤儿还在跑时，同阶段再 --start
    await sleep(1100);
    const s2 = await start(fx.root, topic, HANG);
    out.C2b_hang = {
      startCode: s.r.code, startMsg: tail(s.r, 3),
      ...snap,
      runDirFiles: rid ? runDirs[rid] ?? null : null,
      statusJson,
      orphanPid: orphan, orphanAlive: orphan ? alive(orphan) : null,
      secondStart: { code: s2.r.code, msg: s2.runId ? null : tail(s2.r, 3), runId: s2.runId },
      afterSecondStart: await snapshot(fx, topic),
    };
    if (s2.workerPid) killGroup(s2.workerPid);
    if (orphan) killGroup(orphan);
    await sleep(800);
    const c = rid ? await cli(fx.root, ['review', '--cancel', rid]) : null;
    out.C2b_hang.afterKill = {
      orphanAlive: orphan ? alive(orphan) : null,
      cancel: c && { code: c.code, tail: tail(c, 4) },
      runMetas: await runMetas(fx.stageDir),
    };
  }

  if (want('C2c')) // ── C2c 纯文档跳过分支里 executeRun 抛错 ──
  {
    const topic = 'C2c-跳过分支抛错';
    const fx = await fixture(base, topic);
    await git(fx.root, ['add', '-A']);
    await git(fx.root, ['commit', '-q', '-m', 'plan', '--no-verify']);
    await fs.writeFile(path.join(fx.root, 'NOTES.md'), '# 只改文档\n');
    // 闸门状态文件换成目录：跳过轮在 prepareRun 里不碰它，跳过分支的 setGateChecked 才第一次碰
    await fs.rm(path.join(fx.root, TD, STATE), { force: true });
    await fs.mkdir(path.join(fx.root, TD, STATE));
    const s = await start(fx.root, topic, OK, 'code', 'C');
    const codeStage = path.join(fx.topicDir, 'code');
    out.C2c = {
      startCode: s.r.code, startMsg: tail(s.r, 4),
      runMetas: await runMetas(codeStage),
      task: await taskRuns(fx.topicDir),
      locks: await locks(fx.root),
    };
    await fs.rm(path.join(fx.root, TD, STATE), { recursive: true, force: true });
  }

  if (want('C3')) // ── C3 同步路径 executeRun 抛错 ──
  {
    const topic = 'C3-同步路径抛错';
    const fx = await fixture(base, topic);
    await fs.mkdir(path.join(fx.stageDir, '_meta'), { recursive: true });
    await fs.chmod(fx.stageDir, 0o555);
    const r = await cli(fx.root, ['review', '--stage', 'plan', '--topic', topic, '--focus', '实测', '--entry', 'B', '--session-id', SESSION]);
    await fs.chmod(fx.stageDir, 0o755);
    const snap = await snapshot(fx, topic);
    const rid = Object.keys(snap.runMetas)[0] ?? null;
    const runDirs = await runDirsOf(fx.runRoot);
    const w = rid ? await cli(fx.root, ['review', '--wait', rid, '--timeout', '6']) : null;
    const c = rid ? await cli(fx.root, ['review', '--cancel', rid]) : null;
    const ss = await hookSessionStart(fx.root);
    out.C3 = {
      code: r.code, tail: tail(r, 3),
      ...snap,
      runDirs,
      wait: w && { code: w.code, tail: tail(w, 2) },
      cancel: c && { code: c.code, tail: tail(c, 2) },
      runMetasAfter: await runMetas(fx.stageDir),
      sessionStart: jsonOf(ss)?.hookSpecificOutput?.additionalContext ?? null,
      report: await report(fx.root, topic),
    };
  }

  if (want('C4')) // ── C4 worker 猝死且没人收尾 ──
  {
    const topic = 'C4-worker猝死';
    const fx = await fixture(base, topic);
    const s = await start(fx.root, topic, HANG);
    await sleep(1000);
    killGroup(s.workerPid);
    await sleep(600);
    const ss = await hookSessionStart(fx.root);
    out.C4a = {
      runId: s.runId,
      sessionStart: jsonOf(ss)?.hookSpecificOutput?.additionalContext ?? (ss.stdout + ss.stderr).slice(0, 400),
      ...(await snapshot(fx, topic)),
    };
    await sleep(1100);
    const s2 = await start(fx.root, topic);
    if (s2.runId) await waitDone(fx.root, s2.runId);
    out.C4b = {
      secondStart: { code: s2.r.code, msg: lines(s2.r, 2), runId: s2.runId },
      ...(await snapshot(fx, topic)),
      report: await report(fx.root, topic),
    };
    const w = await cli(fx.root, ['review', '--wait', s.runId, '--timeout', '10'], HANG);
    out.C4c = { wait: { code: w.code, tail: tail(w, 4) }, runMetas: await runMetas(fx.stageDir), task: await taskRuns(fx.topicDir), gate: await gateOf(fx.root, topic) };
  }
} finally {
  for (const pid of toKill) if (alive(pid)) killGroup(pid);
  const ps = await sh(base, 'ps', ['-axo', 'pid=,command=']);
  for (const l of ps.stdout.split('\n')) {
    const m = /review --worker (\S+)/.exec(l);
    if (m && seenRunIds.has(m[1])) { const pid = Number.parseInt(l.trim(), 10); process.stderr.write(`收尾：结束残留 worker ${pid}（run ${m[1]}）\n`); killGroup(pid); }
  }
  // 收尾只删 mkdtemp 的返回值
  const fix = async (d) => {
    await fs.chmod(d, 0o755).catch(() => {});
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await fix(path.join(d, e.name));
  };
  await fix(base);
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
