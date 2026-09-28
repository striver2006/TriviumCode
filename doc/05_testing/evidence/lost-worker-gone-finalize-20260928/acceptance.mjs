#!/usr/bin/env node
/**
 * 「失联worker退出后补收」零配额验收（计划 r2 §4.4 A1～A4）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 审核者换成桩（`TRIVIUM_STUB_CRITIC`，两侧 hang_cli：CLI 一直挂着，worker 因此停在 running，不会自己收尾），
 * 不发起任何模型调用。收尾只删 mkdtemp 的返回值；残留进程按组号 / run_id 标记结束。
 *
 * 新旧两份构建（沿用上一主题做法）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`；
 *   - 旧：`git archive` 固定提交（缺省 fc42d30，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，
 *     `node_modules` 软链工作树，不叠加任何文件（桩相对基线的 diff 进读数，非空即判失败），`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 * 构造次序（计划双审 r1 GLM-01 改正）：**worker 仍存活时**先让旧版 `--wait` 判 heartbeat_stale
 * （`heartbeat_stale_s: 2`、不堵事件循环——J2 同构，健康的 worker 也会被判失联；此刻旧版自己的归档收尾因
 * workerGone=false 跳过，run.json 停在 running），**随后**才 kill -9——先后次序颠倒会让旧版判 pid_gone
 * （`status.ts` 情形 C 先判进程死活），gone 格判据就落不到 heartbeat_stale。
 *
 *   A1（方向一，新旧对照）：旧 --start；worker 仍活时旧 --wait 判 heartbeat_stale；kill -9 worker；
 *       新 --cancel ⇒ run.json / task.json 补收为 failed、termination 正确，不说「无需取消」
 *   A2（方向二，回滚）：A1 产物上旧 --cancel 再跑一次 ⇒ 不报错、不二次改写（旧版没有 gone 格补收，走它自己的默认早退）
 *   A3（可重入）：A1 产物上新 --cancel 再跑一次 ⇒ 幂等，run.json / task.json / status.json 逐字节不变
 *   A4：新构建 doctor --selftest
 *
 * 用法（在仓库根，先 npm run build 与 build --with-tests）：node acceptance.mjs [输出 JSON 路径]
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const BASE_REF = process.env.ACCEPT_BASE_REF ?? 'fc42d30';
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
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const readText = async (p) => fs.readFile(p, 'utf8').catch(() => null);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function mergeEnv(env) {
  const out = { ...process.env };
  for (const [k, v] of Object.entries(env ?? {})) {
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

const TWO = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };
const runJsonOf = (fx, runId) => path.join(fx.stageDir, '_meta', `run-${runId}.json`);
const taskJsonOf = (fx) => path.join(fx.topicDir, 'task.json');

async function start(build, fx, stub) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_id) runIds.add(js.run_id);
  if (js?.run_dir) marks.add(`trivium-stub-cli:${js.run_dir}`);
  return { r, js };
}

/** 起两侧 hang_cli，等两组组长出现、等 status.json 的 worker_pid 与两侧记录落盘 */
async function startLive(build, fx) {
  const { r, js } = await start(build, fx, TWO);
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
  return { js, groups, status };
}

function cleanupRun(L) {
  if (!L?.js) return;
  killGroup(L.js.worker_pid);
  for (const g of L.groups ?? []) killGroup(g);
  for (const g of groupsWithMark(`trivium-stub-cli:${L.js.run_dir}`)) killGroup(g);
}

async function waitGone(pids, groups, ms = 5000) {
  for (let i = 0; i < ms / 50 && (pids.some((p) => !pidGone(p)) || groups.some((g) => members(g).length > 0)); i++) await sleep(50);
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-gone-finalize-'));
let L = null;
let fx = null;
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
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  const b = await sh(oldDir, process.execPath, ['scripts/build.mjs']);
  if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  const OLD = { name: 'old', cli: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(oldDir, 'skills/dual-critic') };
  readout.bundles = { new: { path: NEW.cli, sha256: sha(NEW.cli) }, old: { path: OLD.cli, sha256: sha(OLD.cli), from: BASE_REF } };
  check('构建', readout.bundles.new.sha256 !== readout.bundles.old.sha256 && stubDiff === '',
    `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）；桩相对 ${BASE_REF} 无 diff ${stubDiff === ''}`);

  // ── A1：旧 --start → worker 仍活时旧 --wait 判 heartbeat_stale → kill -9 → 新 --cancel ──
  fx = await fixture(base, 'A1');
  L = await startLive(OLD, fx);
  if (L.error) throw new Error(L.error);
  await sleep(3000); // 心跳阈值 2 s，3 s 足以越过、worker 仍健康（不堵事件循环，J2 同构）
  const oldWait = await cli(OLD, fx.root, ['review', '--wait', L.js.run_id, '--timeout', '3']);
  const statusAfterOldWait = await readJson(path.join(L.js.run_dir, 'status.json')).catch(() => null);
  const runAfterOldWait = await readJson(runJsonOf(fx, L.js.run_id)).catch(() => null);
  readout.pre = {
    oldWaitLost: statusAfterOldWait?.lost ?? null,
    runStillRunning: runAfterOldWait?.status === 'running',
    workerAlive: !pidGone(L.js.worker_pid),
  };
  check('前提', readout.pre.oldWaitLost?.reason === 'heartbeat_stale' && readout.pre.runStillRunning && readout.pre.workerAlive,
    `旧 --wait 判失联原因 ${readout.pre.oldWaitLost?.reason}（应为 heartbeat_stale，次序颠倒会判 pid_gone，GLM-01）；` +
      `run.json 仍 running ${readout.pre.runStillRunning}；worker 仍活 ${readout.pre.workerAlive}`);

  killGroup(L.js.worker_pid); // 模拟「自己死了 / 被手工结束」：只杀 worker，不动两侧 CLI 组
  await waitGone([L.js.worker_pid], []);

  const c1 = await cli(NEW, fx.root, ['review', '--cancel', L.js.run_id]);
  const meta1 = await readJson(runJsonOf(fx, L.js.run_id)).catch(() => null);
  const task1 = await readJson(taskJsonOf(fx)).catch(() => null);
  const entry1 = task1?.runs?.find((x) => x.run_id === L.js.run_id);
  readout.A1 = {
    code: c1.code, stdout: c1.stdout, stderr: c1.stderr,
    metaStatus: meta1?.status ?? null, termination: meta1?.termination ?? null, taskStatus: entry1?.status ?? null,
  };
  check('A1', c1.code === 0 && meta1?.status === 'failed'
    && JSON.stringify(meta1?.termination) === JSON.stringify({ by: 'worker_lost', reason: 'heartbeat_stale' })
    && entry1?.status === 'failed' && !/无需取消/.test(c1.stdout),
    `--cancel 退 ${c1.code}；run.json 为 ${meta1?.status}、termination ${JSON.stringify(meta1?.termination)}；` +
      `task.json 登记 ${entry1?.status}；stdout 不含「无需取消」`);

  // ── A2：回滚——A1 产物上旧构建 --cancel 再跑一次 ──
  const runBeforeA2 = await readText(runJsonOf(fx, L.js.run_id));
  const c2 = await cli(OLD, fx.root, ['review', '--cancel', L.js.run_id]);
  const runAfterA2 = await readText(runJsonOf(fx, L.js.run_id));
  readout.A2 = { code: c2.code, stdout: c2.stdout, stderr: c2.stderr, unchanged: runBeforeA2 === runAfterA2 };
  check('A2', c2.code === 0 && runBeforeA2 === runAfterA2,
    `旧版读新版补收过的归档：--cancel 退 ${c2.code}（不应报错）；run.json 逐字节不变 ${runBeforeA2 === runAfterA2}`);

  // ── A3：可重入——A1 产物上新构建 --cancel 再跑一次 ──
  const [statusBeforeA3, runBeforeA3, taskBeforeA3] = await Promise.all([
    readText(path.join(L.js.run_dir, 'status.json')), readText(runJsonOf(fx, L.js.run_id)), readText(taskJsonOf(fx)),
  ]);
  const c3 = await cli(NEW, fx.root, ['review', '--cancel', L.js.run_id]);
  const [statusAfterA3, runAfterA3, taskAfterA3] = await Promise.all([
    readText(path.join(L.js.run_dir, 'status.json')), readText(runJsonOf(fx, L.js.run_id)), readText(taskJsonOf(fx)),
  ]);
  readout.A3 = {
    code: c3.code, stdout: c3.stdout, stderr: c3.stderr,
    statusUnchanged: statusBeforeA3 === statusAfterA3, runUnchanged: runBeforeA3 === runAfterA3, taskUnchanged: taskBeforeA3 === taskAfterA3,
  };
  check('A3', c3.code === 0 && readout.A3.statusUnchanged && readout.A3.runUnchanged && readout.A3.taskUnchanged
    && /已是终态（failed），不追溯改写/.test(c3.stderr) && !/无需取消/.test(c3.stdout),
    `再跑一次 --cancel 退 ${c3.code}；status/run/task 逐字节不变 ${readout.A3.statusUnchanged}/${readout.A3.runUnchanged}/${readout.A3.taskUnchanged}；` +
      `stderr 含「已是终态，不追溯改写」；stdout 不含「无需取消」`);

  // ── A4：doctor 自检 ──
  {
    const d = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(d.stdout + d.stderr);
    readout.A4 = { code: d.code, tail: (d.stdout + d.stderr).trim().split('\n').slice(-6) };
    check('A4', d.code === 0 && !!m && m[1] === m[2], `doctor --selftest 退 ${d.code}、${m ? `${m[1]}/${m[2]}` : '（没读到计数）'}`);
  }
} finally {
  cleanupRun(L);
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
