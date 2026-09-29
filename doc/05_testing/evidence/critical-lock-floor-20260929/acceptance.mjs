#!/usr/bin/env node
/**
 * 「临界区锁超时下限」（EV-161）零配额验收（计划 r2 §6.4 A0～A7）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、旧构建都建在一个 mkdtemp 目录下；不发起任何模型调用
 * （入口是 `topic claim`，只读写夹具里的 task.json；预检一律 `--skip-auth-check`，探针是种进去的假 CLI）。
 * 收尾结束持有者进程组、只删 mkdtemp 的返回值。
 *
 * 临界区锁的 CLI 入口：`topic claim` ⇒ `updateTaskAsync` ⇒ `withTopicLock(.task-<主题>)`（kind critical，计划 r2 L5）。
 * 持有者是本脚本起的一个带标记的 node 子进程（独立进程组），锁文件按它的 pid 与两种启动时刻写。
 *
 * 新旧两份构建：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`（先 `npm run build`）；
 *   - 旧：`git archive` 固定提交（缺省 53d7476，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，
 *     `node_modules` 软链工作树，不叠加任何文件，`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 *   A0 前置闸与静态：归档内 package.json / package-lock.json 与工作树逐字节相同（CODEX-02，不同即拒绝开跑）；
 *      lock.ts 从 status.js 导入 WORKER_HEARTBEAT_MS、不含 30_000 / 30000 字面；新旧 bundle sha256 不同
 *   A1 T = 0.05，活持有者、1 s 前取的 .task 锁：旧回收（heartbeat_dead）退 0；新退 70、锁文件逐字节不变、task.json 未写
 *   A2 T = 0.05，活持有者、40 s 前取：新旧都回收、退 0，输出归一化后逐字相同
 *   A3 T = 0.05，持有者已死：新旧都 pid_gone 回收、退 0，输出归一化后逐字相同
 *   A4 T = 0.05，kind run 的活持有者、40 s 前取：新旧都不回收、退 70，输出归一化后逐字相同
 *   A5 缺省配置：无预置 / 活持有者 1 s / 活持有者 130 s——新旧输出与退出码归一化后逐字相同（0 / 70 / 0）
 *   A6 T = 0.05 的 preflight --json：新旧 JSON 逐字相同（含「失联阈值」项，EV-160 文案未动）
 *   A7 新构建 doctor --selftest
 *
 * 用法（在仓库根，先 npm run build 与 node scripts/build.mjs --tests-only）：node acceptance.mjs [输出 JSON 路径]
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
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '53d7476';
const imp = (p) => import(pathToFileURL(p).href);
const { processStartTime } = await imp(path.join(ROOT, 'dist/test/src/trivium/util/exec.js'));
const { seedFakeProbes } = await imp(path.join(ROOT, 'dist/test/test/helpers/fixture.js'));
const TD = '.' + 'trivium';
const TOPIC = '锁验收';
const MARK = 'critical-lock-floor-accept-holder';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

const results = [];
const readout = { base_ref: BASE_REF, node: process.version, platform: process.platform };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const cli = (build, cwd, args) => sh(cwd, process.execPath, [build.cli, ...args], { TRIVIUM_ASSET_ROOT: build.asset, CLAUDE_SESSION_ID: 'S-验收' });
const claimArgs = ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'claude', '--json'];

/** 夹具：一个 git 仓 + 配置（staleS 为 null 时不写阈值，取缺省） */
async function fixture(base, name, staleS, probes = false) {
  const root = path.join(base, name);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + name);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]', ...(staleS === null ? [] : [`  heartbeat_stale_s: ${staleS}`]),
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  if (probes) await seedFakeProbes(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  return { root, runRoot, lockFile: path.join(root, TD, 'lock', `.task-${TOPIC}.lock`), taskFile: path.join(root, '.reviews', TOPIC, 'task.json') };
}

/** 活持有者：独立进程组、argv 带标记 */
const holders = [];
async function liveHolder() {
  const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)', MARK], { detached: true, stdio: 'ignore' });
  c.unref();
  holders.push(c.pid);
  for (let i = 0; i < 50; i++) {
    const t = await processStartTime(c.pid);
    if (t) return c.pid;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('持有者进程没起来');
}
/** 已死的持有者：跑完即退，取它的 pid */
async function deadPid() {
  const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((r) => c.on('exit', r));
  return c.pid;
}

/** 预置锁文件，返回写下的原文 */
async function presetLock(fx, { pid, kind, ageMs }) {
  const content = {
    topic: `.task-${TOPIC}`, stage: null, run_id: null, pid,
    pid_started_at: await processStartTime(pid),
    pid_started_at_canonical: await processStartTime(pid, { canonical: true }),
    acquired_at: new Date(Date.now() - ageMs).toISOString(), kind,
  };
  const text = JSON.stringify(content, null, 2) + '\n';
  await fs.mkdir(path.dirname(fx.lockFile), { recursive: true });
  await fs.writeFile(fx.lockFile, text);
  return text;
}
const readOrNull = (p) => fs.readFile(p, 'utf8').catch(() => null);

/** 归一化：夹具根 / 运行根 / 时间戳 / pid */
function norm(text, fx) {
  let t = String(text ?? '');
  const real = (p) => { try { return execFileSync('/bin/realpath', [p], { encoding: 'utf8' }).trim(); } catch { return p; } };
  t = t.split(real(fx.root)).join('〈ROOT〉').split(fx.root).join('〈ROOT〉').split(fx.runRoot).join('〈RUNROOT〉');
  return t
    .replace(/\d{8}T\d{6}Z(?:-\d+)?/g, '〈RUN〉')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '〈TS〉')
    .replace(/(pid|持有者 pid)\s*\d+/g, '$1 〈PID〉')
    .replace(/"(claimed_at|updated_at)": "[^"]*"/g, '"$1": "〈TS〉"');
}

/** 同一构造在新旧两个夹具上各跑一次 claim */
async function pair(base, id, staleS, preset) {
  const out = {};
  for (const b of [NEW, OLD]) {
    const fx = await fixture(base, `${id}-${b.name}`, staleS);
    const text = preset ? await presetLock(fx, await preset()) : null;
    const r = await cli(b, fx.root, claimArgs);
    const after = await readOrNull(fx.lockFile);
    const task = await readOrNull(fx.taskFile);
    out[b.name] = {
      code: r.code, stdout: norm(r.stdout, fx), stderr: norm(r.stderr, fx),
      lockUnchanged: text !== null && after === text, lockGone: after === null,
      claimed: task !== null && task.includes('"claude"'),
    };
  }
  out.same = out.new.code === out.old.code && out.new.stdout === out.old.stdout && out.new.stderr === out.old.stderr;
  return out;
}

let OLD;
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-crit-floor-'));
try {
  // ── A0：前置闸与静态 ──
  const oldDir = path.join(base, 'old');
  await fs.mkdir(oldDir, { recursive: true });
  const tarPath = path.join(base, 'old.tar');
  const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', tarPath, BASE_REF, 'src', 'scripts', 'skills', 'skills-src', 'test', '.reviews', 'package.json', 'package-lock.json', 'tsconfig.json']);
  if (ar.code !== 0) throw new Error(`git archive 失败：${ar.stderr}`);
  const ex = await sh(oldDir, 'tar', ['-xf', tarPath]);
  if (ex.code !== 0) throw new Error(`解包失败：${ex.stderr}`);
  const deps = {};
  for (const f of ['package.json', 'package-lock.json']) deps[f] = { archive: sha(path.join(oldDir, f)), worktree: sha(path.join(ROOT, f)) };
  const depsSame = Object.values(deps).every((d) => d.archive === d.worktree);
  readout.A0_deps = deps;
  check('A0 前置闸', depsSame, `归档与工作树的 package.json / package-lock.json 逐字节相同 ${depsSame}`);
  if (!depsSame) throw new Error('依赖声明与工作树不一致，拒绝开跑（CODEX-02）');

  const lockSrc = readFileSync(path.join(ROOT, 'src/trivium/lock.ts'), 'utf8');
  const importsFloor = /import \{ WORKER_HEARTBEAT_MS \} from '\.\/status\.js';/.test(lockSrc);
  const noLiteral = !/30_000|30000/.test(lockSrc);
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  const b = await sh(oldDir, process.execPath, ['scripts/build.mjs']);
  if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  OLD = { name: 'old', cli: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(oldDir, 'skills/dual-critic') };
  readout.bundles = { new: { path: NEW.cli, sha256: sha(NEW.cli) }, old: { path: OLD.cli, sha256: sha(OLD.cli), from: BASE_REF } };
  check('A0 静态', importsFloor && noLiteral && readout.bundles.new.sha256 !== readout.bundles.old.sha256,
    `lock.ts 从 status.js 导入 WORKER_HEARTBEAT_MS ${importsFloor}；不含 30_000 / 30000 字面 ${noLiteral}；` +
    `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）`);

  const RECLAIM = (why) => new RegExp(`回收主题「\\.task-${TOPIC}」的遗留锁（原因 ${why}`);

  // ── A1：亚秒阈值 + 刚取不久的活锁 ──
  {
    const r = await pair(base, 'A1', 0.05, async () => ({ pid: await liveHolder(), kind: 'critical', ageMs: 1_000 }));
    readout.A1 = r;
    const oldOk = r.old.code === 0 && RECLAIM('heartbeat_dead').test(r.old.stderr) && r.old.lockGone && r.old.claimed;
    const newOk = r.new.code === 70 && !/回收主题/.test(r.new.stderr) && r.new.lockUnchanged && !r.new.claimed;
    check('A1', oldOk && newOk,
      `旧：退 ${r.old.code}、回收 heartbeat_dead ${RECLAIM('heartbeat_dead').test(r.old.stderr)}、锁不在 ${r.old.lockGone}、已写声明 ${r.old.claimed}；` +
      `新：退 ${r.new.code}、无回收 ${!/回收主题/.test(r.new.stderr)}、锁文件逐字节不变 ${r.new.lockUnchanged}、未写声明 ${!r.new.claimed}`);
  }

  // ── A2：亚秒阈值 + 过了下限的活锁 ──
  {
    const r = await pair(base, 'A2', 0.05, async () => ({ pid: await liveHolder(), kind: 'critical', ageMs: 40_000 }));
    readout.A2 = r;
    check('A2', r.same && r.new.code === 0 && RECLAIM('heartbeat_dead').test(r.new.stderr) && r.new.claimed,
      `新旧都退 ${r.new.code}/${r.old.code}、都回收 heartbeat_dead、输出归一化后逐字相同 ${r.same}`);
  }

  // ── A3：亚秒阈值 + 已死的持有者 ──
  {
    const r = await pair(base, 'A3', 0.05, async () => ({ pid: await deadPid(), kind: 'critical', ageMs: 0 }));
    readout.A3 = r;
    check('A3', r.same && r.new.code === 0 && RECLAIM('pid_gone').test(r.new.stderr),
      `新旧都退 ${r.new.code}/${r.old.code}、都按 pid_gone 回收、输出归一化后逐字相同 ${r.same}`);
  }

  // ── A4：亚秒阈值 + run 锁 ──
  {
    const r = await pair(base, 'A4', 0.05, async () => ({ pid: await liveHolder(), kind: 'run', ageMs: 40_000 }));
    readout.A4 = r;
    check('A4', r.same && r.new.code === 70 && r.new.lockUnchanged && r.old.lockUnchanged,
      `新旧都退 ${r.new.code}/${r.old.code}、锁文件都不变、输出归一化后逐字相同 ${r.same}`);
  }

  // ── A5：缺省配置三格 ──
  {
    const cells = {
      none: await pair(base, 'A5a', null, null),
      live1s: await pair(base, 'A5b', null, async () => ({ pid: await liveHolder(), kind: 'critical', ageMs: 1_000 })),
      live130s: await pair(base, 'A5c', null, async () => ({ pid: await liveHolder(), kind: 'critical', ageMs: 130_000 })),
    };
    readout.A5 = cells;
    const codes = Object.values(cells).map((c) => `${c.new.code}/${c.old.code}`).join('、');
    const ok = Object.values(cells).every((c) => c.same) && cells.none.new.code === 0 && cells.live1s.new.code === 70 &&
      cells.live130s.new.code === 0 && RECLAIM('heartbeat_dead').test(cells.live130s.new.stderr);
    check('A5', ok, `缺省配置三格（无预置 / 活 1 s / 活 130 s）新旧退出码 ${codes}，输出逐字相同 ${Object.values(cells).map((c) => c.same).join('/')}`);
  }

  // ── A6：亚秒阈值的预检 ──
  {
    const fx = await fixture(base, 'A6', 0.05, true);
    const args = ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'];
    const n = await cli(NEW, fx.root, args);
    const o = await cli(OLD, fx.root, args);
    const nj = jsonOf(n.stdout);
    const hasItem = !!nj && nj.warnings.some((w) => w.name === '失联阈值');
    readout.A6 = { codes: [n.code, o.code], same: n.stdout === o.stdout, warnings: nj?.warnings ?? null };
    check('A6', n.code === o.code && n.stdout === o.stdout && hasItem,
      `T = 0.05 预检：退 ${n.code}/${o.code}，JSON 逐字相同 ${n.stdout === o.stdout}，含「失联阈值」${hasItem}`);
  }

  // ── A7：新构建自检 ──
  {
    const r = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(r.stdout.split('\n').reverse().find((l) => /\d+\s*\/\s*\d+/.test(l)) ?? '');
    readout.A7 = { code: r.code, tail: r.stdout.split('\n').slice(-6).join('\n') };
    check('A7', r.code === 0 && m !== null && m[1] === m[2], `doctor --selftest 退 ${r.code}，${m ? `${m[1]}/${m[2]}` : '未读到通过数'}`);
  }
} finally {
  for (const pid of holders) { try { process.kill(-pid, 'SIGKILL'); } catch { /* 已不在 */ } }
  await new Promise((r) => setTimeout(r, 200));
  const left = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes(MARK) && !l.includes('/bin/ps'));
  readout.leftover = left;
  await fs.rm(base, { recursive: true, force: true });
}
const passed = results.filter((r) => r.ok).length;
readout.summary = `${passed} / ${results.length}`;
readout.results = results;
console.log(`\n合计 ${passed} / ${results.length}；残留持有者进程 ${readout.leftover.length} 个`);
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
process.exit(passed === results.length && readout.leftover.length === 0 ? 0 : 1);
