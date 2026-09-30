#!/usr/bin/env node
/**
 * 跨进程形态的零配额验收（取消宽限期判不了仍放锁，EV-176，计划 r2 §5.2；改自 EV-175 的同名脚本）。
 *
 * 真实 `review --start`（桩审核者 `hang_cli`：两侧 CLI 挂住、worker 心跳照常；`heartbeat_stale_s: 600`）拉起一个真正的工作进程；
 * 之后的 `--cancel` 以 `NODE_OPTIONS=--require cancel-psblock-preload.cjs` 在 **CLI 进程**里拦 `ps -p 〈工作进程 pid〉` / 扣 SIGKILL。
 * 需要工作进程对 SIGTERM 迟钝时，`--start` 另带 `worker-slowterm-preload.cjs`（经环境继承到工作进程，只在 `--worker` 进程里生效）。
 *
 *   X-Z  零信号：入口判定放过、之后拦                        ⇒ 改前 0 + 锁没了 + 未发信号却说「发送 SIGTERM」；改后 69 + 什么都不动
 *   X-G  宽限期：工作进程 SIGTERM 延后 8 s 处理，SIGTERM 后拦 ⇒ 改前 0 + 锁没了 + 返回时工作进程活；改后约 5 s 后 69 + 锁原样
 *   X-K  SIGKILL 扣下：工作进程不响应 SIGTERM，SIGKILL 不投递 ⇒ 改前 0 + 锁没了；改后约 10 s 后 69、正文「仍是同一进程」
 *   X-N  对照：不拦                                           ⇒ 两边 0、工作进程退出、锁回收
 * X-Z / X-G 之后：同主题 `--start`（不拦），起跑前先记上一轮工作进程活不活——不变量是「新一轮起跑时上一轮的工作进程已不在」：
 * 改前两格都是 0 且上一轮仍活、它的 status 是 `--cancel` 代写的 cancelled（双跑）；改后 X-Z 是 70（上一轮仍活、锁在）；
 * 改后 X-G 按记录结束 CLI 之后，上一轮工作进程看到 CLI 退出会自己收尾（status 写 failed、放锁），进程本身还被预载桩挂着的
 * 延迟定时器拖着没退；它放锁与新一轮 `--start` 抢锁之间是它自己的时序，读「起跑前那一刻」的 phase / 存活都与之竞态
 * （r0 只认 70、r1 看进程活不活、r2 看起跑前的 phase，三次都写错，见报告）。X-G 改后因此只断言 `--cancel` 自己的不变量：
 * 返回那一刻锁原样（之后的放锁只可能出自工作进程自己），且上一轮最终的 status 是工作进程自己写的 failed / success
 * （主路径的 `--cancel` 从不写 failed），新一轮起跑的结局照记为事实。
 * 最后等上一轮工作进程退出、`--cancel`（不拦）收尾。
 * X-K 改后按记录结束 CLI 之后，仍活着的工作进程会看到 CLI 退出、自己收尾（写 failed、放锁）——那是它自己的路径，
 * 所以 X-K 只断言 `--cancel` 自己做了什么（退出码、stdout、正文、返回那一刻 status 不是 cancelled、返回那一刻锁仍在）。
 *
 * 新旧两份构建：新 = 工作树 bundle；旧 = `git archive d1e6408`（ACCEPT_BASE_ROOT）。都 `node 〈bundle〉` 直接调，记 sha256 并断言不同。
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具与运行根都在一个 mkdtemp 下；收尾按组结束本次认得出的进程
 * （worker pid、带本次运行目录标记的桩 CLI 组）、只删 mkdtemp 的返回值。
 *
 * 用法（仓库根，先 npm run build 与 build --with-tests）：ACCEPT_BASE_ROOT=〈旧树〉 node acceptance.mjs [输出 JSON]
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
const CANCEL_PRELOAD = path.join(HERE, 'cancel-psblock-preload.cjs');
const WORKER_PRELOAD = path.join(HERE, 'worker-slowterm-preload.cjs');
const OUT = process.argv[2] ?? null;
const BASE_ROOT = process.env.ACCEPT_BASE_ROOT;
if (!BASE_ROOT) throw new Error('需要 ACCEPT_BASE_ROOT（git archive d1e6408 并构建过的树）');
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

const lines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);

/** 带预载桩调 `--cancel`；返回结果、耗时与本次预载的自证记录 */
async function cancelWith(build, cwd, runId, pid, env, logPath) {
  const before = lines(logPath).length;
  const t0 = Date.now();
  const r = await cli(build, cwd, ['review', '--cancel', runId], null, {
    NODE_OPTIONS: `--require ${CANCEL_PRELOAD}`, TRIVIUM_EV176_TARGET_PID: String(pid), TRIVIUM_EV176_LOG: logPath, ...env,
  });
  const ms = Date.now() - t0;
  const rec = lines(logPath).slice(before).map((l) => JSON.parse(l)).find((x) => x.argv.includes('--cancel')) ?? null;
  return { ...r, ms, preload: rec };
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

async function start(build, fx, stub, extraEnv = {}) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub, extraEnv);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_dir) marks.add(`trivium-stub-cli:${js.run_dir}`);
  if (js?.worker_pid) workers.add(js.worker_pid);
  return { r, js };
}

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
async function waitGone(pid, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!alive(pid)) return true;
    await sleep(100);
  }
  return !alive(pid);
}

/** 一格：起一轮、等稳态、带桩 --cancel，按返回那一刻读事实；follow 为真时再做同主题 --start 与撤桩 --cancel */
async function cell(build, base, id, o) {
  const fx = await fixture(base, `验收${id}${build.name}`);
  const workerLog = path.join(base, `worker-${build.name}-${id}.log`);
  const startEnv = o.workerDelayMs
    ? { NODE_OPTIONS: `--require ${WORKER_PRELOAD}`, TRIVIUM_EV176_WORKER_TERM_DELAY_MS: String(o.workerDelayMs), TRIVIUM_EV176_WORKER_LOG: workerLog }
    : {};
  const { r, js } = await start(build, fx, HANG, startEnv);
  if (!js) return { error: `${id} --start 失败：${r.stdout}${r.stderr}` };
  const steady = await waitSteady(js.run_dir);
  const workerPreload = lines(workerLog).map((l) => JSON.parse(l));
  const lock0 = await lockFacts(fx);
  const c = await cancelWith(build, fx.root, js.run_id, js.worker_pid, o.cancelEnv, path.join(base, `cancel-${build.name}-${id}.log`));
  const atReturn = {
    worker_alive: alive(js.worker_pid),
    phase: (await readJson(path.join(js.run_dir, 'status.json')).catch(() => null))?.phase ?? null,
    lock_same: (await lockFacts(fx)) === lock0 && lock0 !== null,
    lock_present: await exists(fx.lock),
    gate: await gateOf(fx),
  };
  const out = {
    steady: !!steady, worker_preload: workerPreload, code: c.code, ms: c.ms, preload: c.preload,
    stdout: c.stdout.trim(), stderr: c.stderr.trim(), at_return: atReturn,
  };
  if (o.follow) {
    out.worker_alive_before_next_start = alive(js.worker_pid);
    out.prev_phase_before_next_start = (await readJson(path.join(js.run_dir, 'status.json')).catch(() => null))?.phase ?? null;
    const again = await start(build, fx, OK);
    out.next_start = { code: again.r.code, stderr_head: again.r.stderr.split('\n').slice(0, 2).join('\n'), second_run: again.js?.run_id ?? null };
    if (again.js) {
      let wt = { code: 73 };
      for (let i = 0; i < 10 && wt.code === 73; i++) wt = await cli(build, fx.root, ['review', '--wait', again.js.run_id, '--timeout', '20'], OK);
      out.next_start.second_run_wait_code = wt.code;
    }
    // 撤桩再取消：工作进程（延迟处理 SIGTERM 的那格会自己退出）退出后按「已不存在」收尾；改前多半已是终态、落「无需取消」
    await waitGone(js.worker_pid, o.workerDelayMs ? o.workerDelayMs + 6000 : 1000);
    const c2 = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
    out.after = {
      code: c2.code, worker_gone: await waitGone(js.worker_pid, 10_000), lock_present: await exists(fx.lock), gate: await gateOf(fx),
      phase: (await readJson(path.join(js.run_dir, 'status.json')).catch(() => null))?.phase ?? null,
      stdout_tail: c2.stdout.trim().split('\n').slice(-1)[0] ?? '',
    };
  }
  return out;
}

async function runBuild(build, base) {
  return {
    build: build.name,
    XZ: await cell(build, base, 'Z', { cancelEnv: { TRIVIUM_EV176_PS: 'after1' }, follow: true }),
    XG: await cell(build, base, 'G', { workerDelayMs: 8000, cancelEnv: { TRIVIUM_EV176_PS: 'onTerm' }, follow: true }),
    XK: await cell(build, base, 'K', { workerDelayMs: 2 ** 31 - 1, cancelEnv: { TRIVIUM_EV176_DROP_KILL: '1' } }),
    XN: await cell(build, base, 'N', { cancelEnv: {} }),
  };
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev176-accept-'));
const readout = {
  base_root: BASE_ROOT, node: process.version, platform: process.platform, at: new Date().toISOString(),
  bundles: Object.fromEntries(BUILDS.map((b) => [b.name, sha(b.cli)])),
};
const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok, detail });
  console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`);
};
const brief = (x) => JSON.stringify({ ...x, stdout: undefined, stderr: undefined, worker_preload: undefined });
try {
  check('B0 两份 bundle 不同', readout.bundles.new !== readout.bundles.old, `new ${readout.bundles.new.slice(0, 16)} / old ${readout.bundles.old.slice(0, 16)}`);
  for (const b of BUILDS) readout[b.name] = await runBuild(b, base);
  const n = readout.new;
  const o = readout.old;
  const cells = ['XZ', 'XG', 'XK', 'XN'];
  for (const [k, r] of [['new', n], ['old', o]]) {
    const errs = cells.filter((c) => r[c].error).map((c) => r[c].error);
    if (errs.length) {
      check(`${k} 夹具`, false, errs.join(' | '));
      continue;
    }
    check(
      `${k} 稳态与预载自证`,
      cells.every((c) => r[c].steady && r[c].preload) &&
        r.XZ.preload.allowed === 1 && r.XZ.preload.blocked > 0 && r.XG.preload.blocked > 0 &&
        r.XG.worker_preload.length === 1 && r.XK.worker_preload.length === 1 && r.XK.preload.signals.includes('SIGKILL'),
      JSON.stringify(Object.fromEntries(cells.map((c) => [c, { steady: r[c].steady, preload: r[c].preload, worker_preload: r[c].worker_preload.length }]))),
    );
  }
  if (cells.every((c) => !n[c].error && !o[c].error)) {
    check('X-Z 改前：退 0、未发信号却播报「发送 SIGTERM」、锁没了、闸门 idle、返回时工作进程活',
      o.XZ.code === 0 && o.XZ.preload.signals.length === 0 && /发送 SIGTERM/.test(o.XZ.stderr) && !o.XZ.at_return.lock_present &&
        o.XZ.at_return.gate === 'idle' && o.XZ.at_return.worker_alive, brief(o.XZ));
    check('X-Z 改后：退 69、零信号、不播报发送、stdout 空、锁原样、闸门 running、status running、工作进程活',
      n.XZ.code === 69 && n.XZ.preload.signals.length === 0 && !/发送 SIGTERM/.test(n.XZ.stderr) && n.XZ.stdout === '' &&
        n.XZ.at_return.lock_same && n.XZ.at_return.gate === 'running' && n.XZ.at_return.phase === 'running' && n.XZ.at_return.worker_alive,
      brief(n.XZ));
    check('X-Z 之后同主题 --start：改前 0 且上一轮工作进程仍活、status 是代写的 cancelled（双跑）；改后 70 且上一轮仍活',
      o.XZ.next_start.code === 0 && o.XZ.worker_alive_before_next_start && o.XZ.prev_phase_before_next_start === 'cancelled' &&
        n.XZ.next_start.code === 70 && n.XZ.worker_alive_before_next_start,
      JSON.stringify({ old: { ...o.XZ.next_start, prev_alive: o.XZ.worker_alive_before_next_start }, new: { ...n.XZ.next_start, prev_alive: n.XZ.worker_alive_before_next_start } }));
    check('X-G 改前：退 0、只发 SIGTERM、锁没了、返回时工作进程活',
      o.XG.code === 0 && o.XG.preload.signals.join() === 'SIGTERM' && !o.XG.at_return.lock_present && o.XG.at_return.worker_alive, brief(o.XG));
    check('X-G 改后：约 5 s 后退 69、只发 SIGTERM、正文判不了、锁原样、闸门 running、工作进程活',
      n.XG.code === 69 && n.XG.ms >= 4_900 && n.XG.preload.signals.join() === 'SIGTERM' && /判不了/.test(n.XG.stderr) &&
        /不升级 SIGKILL/.test(n.XG.stderr) && n.XG.at_return.lock_same && n.XG.at_return.gate === 'running' && n.XG.at_return.worker_alive,
      brief(n.XG));
    check('X-G 之后同主题 --start：改前 0 且上一轮工作进程仍活、status 是 --cancel 代写的 cancelled（双跑）；改后 --cancel 返回时锁原样、上一轮终态由工作进程自己写（failed / success）',
      o.XG.next_start.code === 0 && o.XG.worker_alive_before_next_start && o.XG.prev_phase_before_next_start === 'cancelled' &&
        n.XG.at_return.lock_same && ['failed', 'success'].includes(n.XG.after.phase),
      JSON.stringify({
        old: { ...o.XG.next_start, prev_alive: o.XG.worker_alive_before_next_start, prev_phase: o.XG.prev_phase_before_next_start },
        new: { ...n.XG.next_start, prev_alive: n.XG.worker_alive_before_next_start, prev_phase: n.XG.prev_phase_before_next_start },
      }));
    check('X-G 改后：上一轮工作进程退出后撤桩 --cancel 退 0、工作进程不在、它的锁不在',
      n.XG.after.code === 0 && n.XG.after.worker_gone && !n.XG.after.lock_present, JSON.stringify(n.XG.after));
    check('X-K 改前：退 0、SIGTERM + SIGKILL（被扣）、status cancelled、锁没了、返回时工作进程活',
      o.XK.code === 0 && o.XK.preload.signals.join() === 'SIGTERM,SIGKILL' && o.XK.at_return.phase === 'cancelled' &&
        !o.XK.at_return.lock_present && o.XK.at_return.worker_alive, brief(o.XK));
    check('X-K 改后：退 69、SIGTERM + SIGKILL、正文「仍是同一进程」、stdout 空、返回时 status 不是 cancelled、锁仍在',
      n.XK.code === 69 && n.XK.preload.signals.join() === 'SIGTERM,SIGKILL' && /仍是同一进程/.test(n.XK.stderr) && n.XK.stdout === '' &&
        n.XK.at_return.phase !== 'cancelled' && n.XK.at_return.lock_present, brief(n.XK));
    check('X-N 两边：不拦 ⇒ 退 0、锁回收、闸门 idle、status cancelled',
      [n.XN, o.XN].every((x) => x.code === 0 && !x.at_return.lock_present && x.at_return.gate === 'idle' && x.at_return.phase === 'cancelled'),
      JSON.stringify({ new: brief(n.XN), old: brief(o.XN) }));
  }
} finally {
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
