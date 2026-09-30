#!/usr/bin/env node
/**
 * 跨进程形态的零配额验收（取不到启动时刻当不在，EV-175，计划 r2 §5.2 X1～X4）。
 *
 * 真实 `review --start`（桩审核者 `hang_cli`：两侧 CLI 挂住、worker 心跳照常；`heartbeat_stale_s: 600` 保心跳新鲜）拉起一个
 * 真正的工作进程；之后的 `--wait` / `--cancel` 以 `NODE_OPTIONS=--require psblock-preload.cjs` 只让 **CLI 进程**取不到那个
 * 工作进程的启动时刻（别的 pid 照常）。工作进程与 CLI 是两个进程——这正是「写记录的与读记录的不是同一个进程」的跨进程形态。
 *
 *   X1  `--wait --timeout 5`（拦）          ⇒ 改前 1 + status failed（pid_gone）；改后 73 + running
 *   X2  `--cancel`（拦）                    ⇒ 改前 0 + 锁没了 + 工作进程活；改后 69 + 锁原样 + 工作进程活
 *   X3  紧接着同主题 `--start`（不拦）        ⇒ 改前 0（双跑）；改后 70
 *   X4  `--cancel`（不拦）                   ⇒ 两边都 0、工作进程退出（对照）
 *
 * X1 与 X2～X4 各用一个主题（X1 在改前会把 status 写成 failed，X2 就落进终态分支、测的不再是主路径）。
 * 新旧两份构建：新 = 工作树 bundle；旧 = `git archive c4d082e`（ACCEPT_BASE_ROOT 指向已构建的树）。都 `node 〈bundle〉` 直接调，
 * 记 sha256 并断言不同。**不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具与运行根都在一个 mkdtemp 下；收尾按组结束
 * 本次认得出的进程（worker pid、带本次运行目录标记的桩 CLI 组）、只删 mkdtemp 的返回值。
 *
 * 用法（仓库根，先 npm run build 与 build --with-tests）：
 *   ACCEPT_BASE_ROOT=〈旧树〉 node acceptance.mjs [输出 JSON]
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(HERE, 'psblock-preload.cjs');
const OUT = process.argv[2] ?? null;
const BASE_ROOT = process.env.ACCEPT_BASE_ROOT;
if (!BASE_ROOT) throw new Error('需要 ACCEPT_BASE_ROOT（git archive c4d082e 并构建过的树）');
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const BUILDS = [
  { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') },
  { name: 'old', cli: path.join(BASE_ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(BASE_ROOT, 'skills/dual-critic') },
];
for (const b of BUILDS) if (!existsSync(b.cli)) throw new Error(`找不到：${b.cli}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const jsonOf = (text) => {
  try {
    return JSON.parse(text.slice(text.indexOf('{')));
  } catch {
    return null;
  }
};
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const exists = async (p) => fs.access(p).then(() => true, () => false);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
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
const envFor = (build, stub) => ({
  TRIVIUM_ASSET_ROOT: build.asset, [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : '', CLAUDE_SESSION_ID: SESSION, NODE_OPTIONS: '',
});
const cli = (build, cwd, args, stub, extraEnv = {}) =>
  sh(cwd, process.execPath, [build.cli, ...args], { ...envFor(build, stub), ...extraEnv });

/** 带预载桩调 CLI：只拦 pid；返回结果与这一次被拦的次数（从日志里取本次新增的那几行） */
async function cliBlocked(build, cwd, args, pid, logPath) {
  const before = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length : 0;
  const r = await cli(build, cwd, args, null, {
    NODE_OPTIONS: `--require ${PRELOAD}`, TRIVIUM_EV175_BLOCK_PIDS: String(pid), TRIVIUM_EV175_BLOCK_LOG: logPath,
  });
  const lines = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(before) : [];
  const blocked = lines.map((l) => JSON.parse(l).blocked).reduce((a, b) => a + b, 0);
  return { ...r, blocked };
}

function psRows() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: +m[1], pgid: +m[2], cmd: m[3] });
  }
  return rows;
}
const marks = new Set();
const workers = new Set();

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + topic);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]', '  heartbeat_stale_s: 600',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n验收。\n');
  return { root, topic, lock: path.join(root, TD, 'lock', `${topic}.lock`), state: path.join(root, TD, 'state' + '.json') };
}

const HANG = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };
const OK = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

async function start(build, fx, stub) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_dir) marks.add(`trivium-stub-cli:${js.run_dir}`);
  if (js?.worker_pid) workers.add(js.worker_pid);
  return { r, js };
}

/** 等 worker 写下 running 且两侧 CLI 记录都落盘（记录里带启动时刻），即「活着、心跳照常」的稳态 */
async function waitSteady(runDir) {
  for (let i = 0; i < 150; i++) {
    const s = await readJson(path.join(runDir, 'status.json')).catch(() => null);
    const v = s ? Object.values(s.sides).map((x) => x.cli) : [];
    if (s?.phase === 'running' && s.worker_started_at_canonical && v.length === 2 && v.every((x) => x && x.started_at)) return s;
    await sleep(100);
  }
  return null;
}

const gateOf = async (fx) => {
  const st = await readJson(fx.state).catch(() => null);
  return st?.gates?.[`${fx.topic}/plan`]?.state ?? null;
};
const lockFacts = async (fx) => {
  try {
    const st = await fs.stat(fx.lock, { bigint: true });
    return `${st.dev}:${st.ino}:${st.mtimeNs}:${sha(fx.lock)}`;
  } catch {
    return null;
  }
};

async function runBuild(build, base) {
  const out = { build: build.name };
  const log = path.join(base, `block-${build.name}.log`);

  // ── X1：--wait（拦） ──
  {
    const fx = await fixture(base, `验收甲${build.name}`);
    const { r, js } = await start(build, fx, HANG);
    if (!js) return { ...out, error: `X1 --start 失败：${r.stdout}${r.stderr}` };
    const steady = await waitSteady(js.run_dir);
    const w = await cliBlocked(build, fx.root, ['review', '--wait', js.run_id, '--timeout', '5', '--json'], js.worker_pid, log);
    const s = await readJson(path.join(js.run_dir, 'status.json')).catch(() => null);
    out.X1 = {
      steady: !!steady, code: w.code, blocked: w.blocked, phase: s?.phase ?? null, lost: s?.lost?.reason ?? null,
      worker_alive: alive(js.worker_pid), gate: await gateOf(fx), stderr_head: w.stderr.split('\n').slice(0, 3).join('\n'),
    };
  }

  // ── X2～X4：--cancel（拦）→ 同主题 --start（不拦）→ --cancel（不拦） ──
  {
    const fx = await fixture(base, `验收乙${build.name}`);
    const { r, js } = await start(build, fx, HANG);
    if (!js) return { ...out, error: `X2 --start 失败：${r.stdout}${r.stderr}` };
    const steady = await waitSteady(js.run_dir);
    const lock0 = await lockFacts(fx);
    const c = await cliBlocked(build, fx.root, ['review', '--cancel', js.run_id], js.worker_pid, log);
    // 返回那一刻先读：改前那一格随后会被活 worker 自己改写（r0 发现：CLI 被按记录结束后 worker 收尾、写 failed、退出）
    const workerAliveAtReturn = alive(js.worker_pid);
    const phaseAtReturn = (await readJson(path.join(js.run_dir, 'status.json')).catch(() => null))?.phase ?? null;
    await sleep(1500);
    const s = await readJson(path.join(js.run_dir, 'status.json')).catch(() => null);
    out.X2 = {
      steady: !!steady, code: c.code, blocked: c.blocked, stdout: c.stdout.trim(), stderr: c.stderr.trim(),
      worker_alive_at_return: workerAliveAtReturn, phase_at_return: phaseAtReturn,
      phase: s?.phase ?? null, lock_same: (await lockFacts(fx)) === lock0 && lock0 !== null, lock_present: await exists(fx.lock),
      gate: await gateOf(fx), worker_alive: alive(js.worker_pid),
    };
    const again = await start(build, fx, OK);
    out.X3 = { code: again.r.code, stderr_head: again.r.stderr.split('\n').slice(0, 2).join('\n'), second_run: again.js?.run_id ?? null };
    if (again.js) {
      // 改前那一格真的拿到了锁、起了第二条流水线：让它跑完，免得留进程
      let wt = { code: 73 };
      for (let i = 0; i < 10 && wt.code === 73; i++) wt = await cli(build, fx.root, ['review', '--wait', again.js.run_id, '--timeout', '20'], OK);
      out.X3.second_run_wait_code = wt.code;
    }
    const c2 = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) {
      gone = !alive(js.worker_pid);
      if (!gone) await sleep(100);
    }
    out.X4 = { code: c2.code, worker_gone: gone, lock_present: await exists(fx.lock), stdout_tail: c2.stdout.trim().split('\n').slice(-1)[0] ?? '' };
  }
  return out;
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev175-accept-'));
const readout = {
  base_root: BASE_ROOT, node: process.version, platform: process.platform, at: new Date().toISOString(),
  bundles: Object.fromEntries(BUILDS.map((b) => [b.name, sha(b.cli)])),
};
const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok, detail });
  console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`);
};
try {
  check('B0 两份 bundle 不同', readout.bundles.new !== readout.bundles.old, `new ${readout.bundles.new.slice(0, 16)} / old ${readout.bundles.old.slice(0, 16)}`);
  for (const b of BUILDS) readout[b.name] = await runBuild(b, base);
  const n = readout.new;
  const o = readout.old;
  for (const [k, r] of [['new', n], ['old', o]]) {
    if (r.error) check(`${k} 夹具`, false, r.error);
    else check(`${k} 稳态与桩自证`, r.X1.steady && r.X2.steady && r.X1.blocked > 0 && r.X2.blocked > 0, `steady ${r.X1.steady}/${r.X2.steady}，被拦 ${r.X1.blocked}/${r.X2.blocked}`);
  }
  if (!n.error && !o.error) {
    check('X1 改前：--wait 退 1、status failed（pid_gone）', o.X1.code === 1 && o.X1.phase === 'failed' && o.X1.lost === 'pid_gone', JSON.stringify(o.X1));
    check('X1 改后：--wait 退 73、status 仍 running', n.X1.code === 73 && n.X1.phase === 'running' && n.X1.lost === null, JSON.stringify(n.X1));
    // r0 的判据写窄了：改前那一格工作进程没收到信号，但它名下的 CLI 被按记录结束，它随后自己收尾、把 status 改写成 failed、退出
    check(
      'X2 改前：--cancel 退 0、对活工作进程判「已不存在」（返回时它仍活）、按记录结束 CLI、status 写 cancelled、锁没了',
      o.X2.code === 0 && o.X2.worker_alive_at_return && o.X2.phase_at_return === 'cancelled' && !o.X2.lock_present &&
        new RegExp(`工作进程 \\d+ 已不存在，仅做状态与锁的清理`).test(o.X2.stderr) && /按记录结束审查员 CLI/.test(o.X2.stderr),
      JSON.stringify({ ...o.X2, stdout: undefined, stderr: undefined }),
    );
    check('X2 改后：--cancel 退 69、锁原样、闸门 running、status running、工作进程仍活', n.X2.code === 69 && n.X2.lock_same && n.X2.gate === 'running' && n.X2.phase === 'running' && n.X2.worker_alive && /本次不取消/.test(n.X2.stderr) && n.X2.stdout === '', JSON.stringify({ ...n.X2, stdout: undefined }));
    check('X3 改前：同主题 --start 退 0（双跑）', o.X3.code === 0, JSON.stringify(o.X3));
    check('X3 改后：同主题 --start 退 70', n.X3.code === 70, JSON.stringify(n.X3));
    check('X4 两边：撤桩 --cancel 退 0、工作进程退出', n.X4.code === 0 && n.X4.worker_gone && o.X4.code === 0 && o.X4.worker_gone, JSON.stringify({ new: n.X4, old: o.X4 }));
  }
} finally {
  // 收尾：本次的 worker 与带标记的桩 CLI 组
  const rows = psRows();
  const groups = new Set([...workers]);
  for (const r of rows) for (const m of marks) if (r.cmd.includes(m)) groups.add(r.pgid);
  for (const g of groups) {
    if (g > 1) {
      try {
        process.kill(-g, 'SIGKILL');
      } catch {
        // 已不在
      }
    }
  }
  await sleep(300);
  await fs.rm(base, { recursive: true, force: true });
}
readout.checks = checks;
readout.pass = checks.filter((c) => c.ok).length;
readout.total = checks.length;
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
console.log(`${readout.pass} / ${readout.total}`);
process.exitCode = readout.pass === readout.total ? 0 : 1;
