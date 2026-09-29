#!/usr/bin/env node
/**
 * 「取消与失联的凭据准入核CLI」（EV-157）零配额验收（计划 r2 §4.4 A1～A8，另加 A9 doctor 自检）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 审核者换成桩（`TRIVIUM_STUB_CRITIC`，`hang_cli` 以仓库的 run() 按 killTree 真实拉起 `sh -c 'sleep 600'`），不发起任何模型调用。
 * 收尾只删 mkdtemp 的返回值；残留进程按标记与组号结束。
 *
 * 新旧两份构建（沿用上两个主题做法，计划 r2 §4.4「构建」，计划双审 r1 CODEX-02）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`（先 npm run build）；
 *   - 旧：`git archive` 固定提交（缺省 08396d2，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，展开进 mkdtemp，
 *     `node_modules` 软链工作树，**不叠加任何文件**（桩相对基线的 diff 进读数，非空即判失败），`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 * 新旧各跑一个独立夹具，主题名相同；比对前归一化：mkdtemp 根、夹具目录名里的 new / old、repoId 哈希、run_id、ISO 时间戳、
 * 三位以上的数字（pid、组号、耗时）。逐字不变的判法（计划 r2 §4.4 末段，GLM-02）：归一化后逐行比对，允许差异**只有**
 * A1 的「凭据副本未抹」一行与 --cancel 出口一行（代码双审 r1 CODEX-02 之后）、A2 的「凭据副本未抹」一行、A3 会话启动提示里第四格那一行
 * （与随之消失的「已清理」那一行）；A5～A7 必须逐字相同，A7 不设任何白名单（`trivium scrub` 的输出按 D3 逐字保留）。
 *
 *   A1  worker 被强杀、两侧 CLI 仍活 → --wait：新不抹、正文多一行逐侧带组号与一行 --cancel 出口、两组仍活；旧照抹。之后结束两组 → 会话启动 Hook：新即抹
 *   A2  worker 被强杀、两侧记录的启动时刻抹成 null（判不了）→ --cancel：新不抹、多一行告警；旧照抹；两者 run.json 都 cancelled
 *   A3  worker 被强杀、两侧 CLI 仍活、运行目录推到 31 天前 → 会话启动 Hook：新目录在（第四格）、旧已删（已清理 1 个）
 *   A4  A1 / A2 / A3 的后半：结束两组（A3 再推一次时间）→ 会话启动 Hook：新载体已抹 / 目录已删
 *   A5  CLI 已结束的两格：K4（--cancel 按记录结束之后）与 K2（--wait 之前两组已结束）——新旧逐行相同、退出码相同
 *   A6  常态：hang 与 hang_cli 的常态 --cancel（a 格）、hang_cli sleepS:1 跑完——新旧逐行相同、退出码相同
 *   A7  trivium scrub：worker 已死、CLI 仍活 → 结束两组后再跑——新旧逐行相同、退出码相同（admitScrub 行为不变）
 *   A8  退出码：A1 新旧都是 1、A2 新旧都是 0
 *   A9  新构建 doctor --selftest
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
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '08396d2';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const TOPIC = '准入验收';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

const results = [];
const readout = { base_ref: BASE_REF, node: process.version, platform: process.platform };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
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
const cli = (build, cwd, args, stub = null) => sh(cwd, process.execPath, [build.cli, ...args], envFor(build, stub));

// 按进程表认组：与 test/helpers/proc.ts 同源（本脚本要能脱离测试构建单独跑）
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
const members = (pgid) => psRows().filter((r) => r.pgid === pgid).length;
const killGroup = (g) => { if (g > 1) try { process.kill(-g, 'SIGKILL'); } catch { /* 已不在 */ } };
const pidGone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code !== 'EPERM'; } };
const marks = new Set();
const runIds = new Set();

async function fixture(base, dir) {
  const root = path.join(base, dir);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + dir);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', TOPIC, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${TOPIC}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n验收。\n');
  return { root, stageDir, runRoot };
}

async function start(build, fx, stub) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC, '--focus', '验收', '--session-id', SESSION, '--json'], stub);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_id) runIds.add(js.run_id);
  if (js?.run_dir) marks.add(`trivium-stub-cli:${js.run_dir}`);
  return { r, js };
}

async function cliGroups(runDir) {
  const mark = `trivium-stub-cli:${runDir}`;
  let g = [];
  for (let i = 0; i < 100 && g.length < 2; i++) {
    g = groupsWithMark(mark);
    if (g.length < 2) await sleep(100);
  }
  return g;
}

const sidesCli = async (runDir) => {
  const s = await readJson(path.join(runDir, 'status.json')).catch(() => null);
  return s ? Object.fromEntries(Object.entries(s.sides).map(([k, v]) => [k, v.cli])) : null;
};

/** 两份构建（08396d2 起都写 CLI 记录）：等 status.json 两侧都记下组号与启动时刻 */
async function waitRecords(runDir) {
  let rec = null;
  for (let i = 0; i < 100; i++) {
    rec = await sidesCli(runDir);
    const v = Object.values(rec ?? {});
    if (v.length === 2 && v.every((x) => x && x.started_at)) break;
    await sleep(100);
  }
  return rec;
}

async function killWorker(pid) {
  killGroup(pid);
  for (let i = 0; i < 100 && !pidGone(pid); i++) await sleep(50);
  return pidGone(pid);
}

async function endGroups(groups) {
  for (const g of groups) killGroup(g);
  for (let i = 0; i < 40 && groups.some((g) => members(g) > 0); i++) await sleep(50);
  return groups.map((g) => members(g));
}

async function hookSessionStart(build, cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [build.cli, 'gate', 'hook-session-start'], {
      cwd, env: { ...process.env, TRIVIUM_ASSET_ROOT: build.asset, CLAUDE_SESSION_ID: SESSION },
    });
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', () => {});
    p.on('close', (code) => resolve({ code, ctx: jsonOf(stdout)?.hookSpecificOutput?.additionalContext ?? '' }));
    p.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }));
  });
}

async function placeCarrier(runDir) {
  const carrier = path.join(runDir, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  return carrier;
}
const exists = async (p) => fs.access(p).then(() => true, () => false);

/** 运行目录连同 status.json 的心跳推到 days 天前（目标只在 mkdtemp 之下） */
async function age(base, dir, days) {
  if (!dir.startsWith(base + path.sep)) throw new Error(`拒绝改 mkdtemp 之外的目录：${dir}`);
  const t = new Date(Date.now() - days * 86_400_000);
  const sp = path.join(dir, 'status.json');
  const s = await readJson(sp);
  s.heartbeat_at = t.toISOString();
  await fs.writeFile(sp, JSON.stringify(s, null, 2) + '\n', 'utf8');
  for (const f of await fs.readdir(dir)) await fs.utimes(path.join(dir, f), t, t);
  await fs.utimes(dir, t, t);
}

let BASE = '';
const norm = (s) => String(s ?? '')
  .split(BASE).join('〈BASE〉')
  .replace(/\d{8}T\d{6}Z(?:-\d+)?/g, '〈RUN〉')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '〈TS〉')
  .replace(/([A-Za-z0-9]+)-(new|old)\b/g, '$1-〈B〉')
  .replace(/-[0-9a-f]{8}\b/g, '-〈H〉')
  .replace(/\b\d{3,7}\b/g, '〈N〉');

/** 归一化后逐行多重集差：新有旧无、旧有新无 */
function lineDiff(a, b) {
  const la = norm(a).split('\n');
  const lb = norm(b).split('\n');
  const cnt = new Map();
  for (const l of lb) cnt.set(l, (cnt.get(l) ?? 0) + 1);
  const onlyA = [];
  for (const l of la) {
    const n = cnt.get(l) ?? 0;
    if (n > 0) cnt.set(l, n - 1);
    else onlyA.push(l);
  }
  const onlyB = [];
  for (const [l, n] of cnt) for (let i = 0; i < n; i++) onlyB.push(l);
  return { onlyNew: onlyA, onlyOld: onlyB };
}

const TWO = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };

/** 起两侧 hang_cli、等记录、按组 SIGKILL worker、放载体 */
async function orphanedRun(build, base, dir) {
  await sleep(1100); // run_id 秒级：两次 --start 错开
  const fx = await fixture(base, dir);
  const { r, js } = await start(build, fx, TWO);
  if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
  const groups = await cliGroups(js.run_dir);
  const rec = await waitRecords(js.run_dir);
  const workerGone = await killWorker(js.worker_pid);
  const carrier = await placeCarrier(js.run_dir);
  return { fx, js, groups, rec, workerGone, carrier };
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-ev157-'));
BASE = base;
try {
  // ── 构建 ──
  const oldDir = path.join(base, 'old-build');
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
  readout.bundles = { new: { path: NEW.cli, sha256: sha(NEW.cli) }, old: { path: OLD.cli, sha256: sha(OLD.cli), from: BASE_REF }, stubDiff };
  check('构建', readout.bundles.new.sha256 !== readout.bundles.old.sha256 && stubDiff === '',
    `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）；桩相对 ${BASE_REF} 无 diff ${stubDiff === ''}`);

  // ── A1 / A4(wait)：--wait ──
  const waitCase = async (build) => {
    const o = await orphanedRun(build, base, `A1-${build.name}`);
    if (o.error) return o;
    const w = await cli(build, o.fx.root, ['review', '--wait', o.js.run_id, '--timeout', '20']);
    const carrierAfterWait = await exists(o.carrier);
    const aliveAfterWait = o.groups.map((g) => members(g));
    const recAfterWait = await sidesCli(o.js.run_dir);
    const h1 = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook1 = await exists(o.carrier);
    const ended = await endGroups(o.groups);
    const h2 = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook2 = await exists(o.carrier);
    return {
      runDir: o.js.run_dir, groups: o.groups, rec: o.rec, workerGone: o.workerGone, code: w.code, stdout: w.stdout, stderr: w.stderr,
      carrierAfterWait, aliveAfterWait, recRetained: JSON.stringify(recAfterWait) === JSON.stringify(o.rec),
      hook1: h1.code, carrierAfterHook1, ended, hook2: h2.code, carrierAfterHook2,
    };
  };
  const a1n = await waitCase(NEW);
  const a1o = await waitCase(OLD);
  {
    const d = lineDiff(a1n.stdout + a1n.stderr, a1o.stdout + a1o.stderr);
    // 代码双审 r1 CODEX-02 之后允许差异是两行：「凭据副本未抹」与 --cancel 出口句（两侧都判「仍在」）
    const line = d.onlyNew.find((l) => /凭据副本未抹/.test(l)) ?? '';
    const exitLine = d.onlyNew.find((l) => /其中仍在的审查员 CLI 可用 trivium review --cancel 〈RUN〉 按记录结束（本命令不结束任何进程）/.test(l)) ?? '';
    const bothSides = a1n.groups && Object.entries(a1n.rec ?? {}).every(([side, v]) => (a1n.stdout + a1n.stderr).includes(`${side} 侧审查员 CLI 进程组 ${v?.pgid} 仍在`));
    readout.A1 = { new: a1n, old: a1o, diff: d };
    check('A1', !a1n.error && !a1o.error && a1n.workerGone && a1o.workerGone
      && a1n.carrierAfterWait && a1n.aliveAfterWait.every((n) => n === 2) && a1n.recRetained && bothSides
      && !a1o.carrierAfterWait
      && d.onlyNew.length === 2 && /凭据副本未抹：工作进程 〈N〉 已不存在，但审查员 CLI 未确认结束——/.test(line) && exitLine !== ''
      && d.onlyOld.length === 0,
      `新：--wait 后载体在 ${a1n.carrierAfterWait}、两组成员 ${JSON.stringify(a1n.aliveAfterWait)}、记录留存 ${a1n.recRetained}、两侧组号都在正文里 ${bothSides}；` +
      `旧：载体在 ${a1o.carrierAfterWait}；归一化后新有旧无 ${d.onlyNew.length} 行（「凭据副本未抹」${line !== ''}、--cancel 出口 ${exitLine !== ''}）、旧有新无 ${d.onlyOld.length} 行`);
  }

  // ── A2 / A4(cancel)：--cancel，判不了 ──
  const cancelCase = async (build) => {
    const o = await orphanedRun(build, base, `A2-${build.name}`);
    if (o.error) return o;
    const sp = path.join(o.js.run_dir, 'status.json');
    const s = await readJson(sp);
    for (const v of Object.values(s.sides)) v.cli.started_at = null;
    await fs.writeFile(sp, JSON.stringify(s, null, 2) + '\n', 'utf8');
    const c = await cli(build, o.fx.root, ['review', '--cancel', o.js.run_id]);
    const carrierAfterCancel = await exists(o.carrier);
    const aliveAfterCancel = o.groups.map((g) => members(g));
    const runJson = await readJson(path.join(o.fx.stageDir, '_meta', `run-${o.js.run_id}.json`)).catch(() => null);
    const h1 = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook1 = await exists(o.carrier);
    const ended = await endGroups(o.groups);
    const h2 = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook2 = await exists(o.carrier);
    return {
      groups: o.groups, code: c.code, stdout: c.stdout, stderr: c.stderr, carrierAfterCancel, aliveAfterCancel,
      runJsonStatus: runJson?.status ?? null, hook1: h1.code, carrierAfterHook1, ended, hook2: h2.code, carrierAfterHook2,
    };
  };
  const a2n = await cancelCase(NEW);
  const a2o = await cancelCase(OLD);
  {
    const d = lineDiff(a2n.stdout + a2n.stderr, a2o.stdout + a2o.stderr);
    readout.A2 = { new: a2n, old: a2o, diff: d };
    check('A2', !a2n.error && !a2o.error && a2n.carrierAfterCancel && a2n.aliveAfterCancel.every((n) => n === 2)
      && !a2o.carrierAfterCancel && a2n.runJsonStatus === 'cancelled' && a2o.runJsonStatus === 'cancelled'
      && d.onlyNew.length === 1 && /凭据副本未抹：工作进程 〈N〉 已不存在，但审查员 CLI 未确认结束——.*判不了；.*判不了——留给会话启动清扫/.test(d.onlyNew[0] ?? '')
      && d.onlyOld.length === 0,
      `新：--cancel 后载体在 ${a2n.carrierAfterCancel}、两组成员 ${JSON.stringify(a2n.aliveAfterCancel)}；旧：载体在 ${a2o.carrierAfterCancel}；` +
      `run.json 新 ${a2n.runJsonStatus} / 旧 ${a2o.runJsonStatus}；新有旧无 ${d.onlyNew.length} 行、旧有新无 ${d.onlyOld.length} 行`);
  }

  // ── A3 / A4(prune)：到期整删 ──
  const pruneCase = async (build) => {
    const o = await orphanedRun(build, base, `A3-${build.name}`);
    if (o.error) return o;
    await age(base, o.js.run_dir, 31);
    const h1 = await hookSessionStart(build, o.fx.root);
    const dirAfter1 = await exists(o.js.run_dir);
    const carrierAfter1 = await exists(o.carrier);
    const alive1 = o.groups.map((g) => members(g));
    const ended = await endGroups(o.groups);
    let h2 = null;
    let dirAfter2 = dirAfter1;
    if (dirAfter1) {
      await age(base, o.js.run_dir, 31);
      h2 = await hookSessionStart(build, o.fx.root);
      dirAfter2 = await exists(o.js.run_dir);
    }
    return { code1: h1.code, ctx1: h1.ctx, dirAfter1, carrierAfter1, alive1, ended, code2: h2?.code ?? null, ctx2: h2?.ctx ?? null, dirAfter2 };
  };
  const a3n = await pruneCase(NEW);
  const a3o = await pruneCase(OLD);
  {
    const d = lineDiff(a3n.ctx1, a3o.ctx1);
    const fourth = d.onlyNew.length === 1 && /因审查员 CLI 进程组记录未动/.test(d.onlyNew[0]);
    const cleaned = d.onlyOld.length === 1 && /已清理 1 个超过 30 天的运行目录/.test(d.onlyOld[0]);
    readout.A3 = { new: a3n, old: a3o, diff: d };
    check('A3', !a3n.error && !a3o.error && a3n.code1 === 0 && a3o.code1 === 0 && a3n.dirAfter1 && a3n.carrierAfter1
      && a3n.alive1.every((n) => n === 2) && !a3o.dirAfter1 && fourth && cleaned,
      `新：Hook 后目录在 ${a3n.dirAfter1}、载体在 ${a3n.carrierAfter1}；旧：目录在 ${a3o.dirAfter1}；` +
      `新有旧无「第四格」${fourth}、旧有新无「已清理 1 个」${cleaned}（其余 ${d.onlyNew.length - (fourth ? 1 : 0)} / ${d.onlyOld.length - (cleaned ? 1 : 0)} 行）`);
  }

  // ── A4：三格的后半（结束两组之后）──
  check('A4', a1n.carrierAfterHook1 && !a1n.carrierAfterHook2 && a2n.carrierAfterHook1 && !a2n.carrierAfterHook2 && !a3n.dirAfter2
    && a1n.ended.every((n) => n === 0) && a2n.ended.every((n) => n === 0) && a3n.ended.every((n) => n === 0),
    `新：--wait 之后会话启动清扫仍挡住 ${a1n.carrierAfterHook1}、结束两组后即抹 ${!a1n.carrierAfterHook2}；` +
    `--cancel 之后仍挡住 ${a2n.carrierAfterHook1}、结束两组后即抹 ${!a2n.carrierAfterHook2}；到期目录在两组结束后被删 ${!a3n.dirAfter2}`);

  // ── A5：CLI 已结束的两格 ──
  {
    const k4 = async (build) => {
      const o = await orphanedRun(build, base, `A5k4-${build.name}`);
      if (o.error) return o;
      const c = await cli(build, o.fx.root, ['review', '--cancel', o.js.run_id]);
      await sleep(200);
      return { code: c.code, stdout: c.stdout, stderr: c.stderr, carrier: await exists(o.carrier), after: o.groups.map((g) => members(g)) };
    };
    const k2 = async (build) => {
      const o = await orphanedRun(build, base, `A5k2-${build.name}`);
      if (o.error) return o;
      await endGroups(o.groups);
      const w = await cli(build, o.fx.root, ['review', '--wait', o.js.run_id, '--timeout', '20']);
      return { code: w.code, stdout: w.stdout, stderr: w.stderr, carrier: await exists(o.carrier) };
    };
    const n4 = await k4(NEW); const o4 = await k4(OLD);
    const n2 = await k2(NEW); const o2 = await k2(OLD);
    const d4 = lineDiff(n4.stdout + n4.stderr, o4.stdout + o4.stderr);
    const d2 = lineDiff(n2.stdout + n2.stderr, o2.stdout + o2.stderr);
    readout.A5 = { k4: { new: n4, old: o4, diff: d4 }, k2: { new: n2, old: o2, diff: d2 } };
    check('A5', n4.code === o4.code && n2.code === o2.code && !n4.carrier && !o4.carrier && !n2.carrier && !o2.carrier
      && d4.onlyNew.length === 0 && d4.onlyOld.length === 0 && d2.onlyNew.length === 0 && d2.onlyOld.length === 0,
      `K4（--cancel 按记录结束之后）：退出码 ${n4.code}/${o4.code}、载体都已抹 ${!n4.carrier && !o4.carrier}、差异 ${d4.onlyNew.length}+${d4.onlyOld.length} 行；` +
      `K2（--wait 之前两组已结束）：退出码 ${n2.code}/${o2.code}、载体都已抹 ${!n2.carrier && !o2.carrier}、差异 ${d2.onlyNew.length}+${d2.onlyOld.length} 行`);
  }

  // ── A6：常态 ──
  {
    const cancelNormal = async (build, kind, stub) => {
      await sleep(1100);
      const fx = await fixture(base, `A6${kind}-${build.name}`);
      const { js } = await start(build, fx, stub);
      if (kind === 'hangcli') await cliGroups(js.run_dir);
      else await sleep(500);
      const c = await cli(build, fx.root, ['review', '--cancel', js.run_id]);
      for (const g of groupsWithMark(`trivium-stub-cli:${js.run_dir}`)) killGroup(g);
      return { code: c.code, stdout: c.stdout, stderr: c.stderr };
    };
    const finishNormal = async (build) => {
      await sleep(1100);
      const fx = await fixture(base, `A6done-${build.name}`);
      const stub = { gemini: { mode: 'hang_cli', sleepS: 1 }, glm: { mode: 'hang_cli', sleepS: 1 } };
      const { js } = await start(build, fx, stub);
      let w = { code: 73, stdout: '', stderr: '' };
      for (let i = 0; i < 10 && w.code === 73; i++) w = await cli(build, fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub);
      return { code: w.code, stdout: w.stdout, stderr: w.stderr, status: jsonOf(w.stdout)?.phase ?? null };
    };
    const parts = [];
    let ok = true;
    readout.A6 = {};
    for (const [k, stub] of Object.entries({ hang: { gemini: { mode: 'hang' }, glm: { mode: 'hang' } }, hangcli: TWO })) {
      const n = await cancelNormal(NEW, k, stub);
      const o = await cancelNormal(OLD, k, stub);
      const d = lineDiff(n.stdout + n.stderr, o.stdout + o.stderr);
      readout.A6[k] = { new: n, old: o, diff: d };
      ok &&= n.code === o.code && d.onlyNew.length === 0 && d.onlyOld.length === 0;
      parts.push(`${k} 常态 --cancel：退出码 ${n.code}/${o.code}、差异 ${d.onlyNew.length}+${d.onlyOld.length} 行`);
    }
    const n = await finishNormal(NEW);
    const o = await finishNormal(OLD);
    const d = lineDiff(n.stdout + n.stderr, o.stdout + o.stderr);
    readout.A6.done = { new: n, old: o, diff: d };
    // hang_cli 睡满后以「桩 CLI 挂起未被取消」收场、两侧判失败（退 75 STRICT_ABORT）——桩的既定形态；这里只比新旧是否相同（r0 误写成必须退 0）
    ok &&= n.code === o.code && d.onlyNew.length === 0 && d.onlyOld.length === 0;
    parts.push(`hang_cli sleepS:1 跑完：退出码 ${n.code}/${o.code}、差异 ${d.onlyNew.length}+${d.onlyOld.length} 行`);
    check('A6', ok, parts.join('；'));
  }

  // ── A7：trivium scrub（admitScrub 行为不变，输出逐字保留）──
  {
    const scrubCase = async (build) => {
      const o = await orphanedRun(build, base, `A7-${build.name}`);
      if (o.error) return o;
      const s1 = await cli(build, o.fx.root, ['scrub']);
      const carrier1 = await exists(o.carrier);
      const ended = await endGroups(o.groups);
      const s2 = await cli(build, o.fx.root, ['scrub']);
      const carrier2 = await exists(o.carrier);
      return { s1, s2, carrier1, carrier2, ended };
    };
    const n = await scrubCase(NEW);
    const o = await scrubCase(OLD);
    const d1 = lineDiff(n.s1.stdout + n.s1.stderr, o.s1.stdout + o.s1.stderr);
    const d2 = lineDiff(n.s2.stdout + n.s2.stderr, o.s2.stdout + o.s2.stderr);
    readout.A7 = { new: n, old: o, diff1: d1, diff2: d2 };
    check('A7', n.s1.code === o.s1.code && n.s2.code === o.s2.code && n.carrier1 && o.carrier1 && !n.carrier2 && !o.carrier2
      && d1.onlyNew.length + d1.onlyOld.length + d2.onlyNew.length + d2.onlyOld.length === 0
      && /或等 run_dir_days 整删/.test(n.s1.stdout),
      `CLI 仍活：退出码 ${n.s1.code}/${o.s1.code}、载体都在 ${n.carrier1 && o.carrier1}、差异 ${d1.onlyNew.length}+${d1.onlyOld.length} 行；` +
      `CLI 结束后：退出码 ${n.s2.code}/${o.s2.code}、载体都已抹 ${!n.carrier2 && !o.carrier2}、差异 ${d2.onlyNew.length}+${d2.onlyOld.length} 行；` +
      `D3 那一行逐字保留 ${/或等 run_dir_days 整删/.test(n.s1.stdout)}`);
  }

  // ── A8：退出码 ──
  check('A8', a1n.code === 1 && a1o.code === 1 && a2n.code === 0 && a2o.code === 0,
    `A1 --wait 退出码 新 ${a1n.code} / 旧 ${a1o.code}；A2 --cancel 退出码 新 ${a2n.code} / 旧 ${a2o.code}`);

  // ── A9：doctor 自检 ──
  {
    const d = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(d.stdout + d.stderr);
    readout.A9 = { code: d.code, tail: (d.stdout + d.stderr).trim().split('\n').slice(-6) };
    check('A9', d.code === 0 && !!m && m[1] === m[2], `doctor --selftest 退 ${d.code}、${m ? `${m[1]}/${m[2]}` : '（没读到计数）'}`);
  }
} finally {
  for (const m of marks) for (const g of groupsWithMark(m)) killGroup(g);
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) killGroup(r.pgid);
  await sleep(300);
  const left = [];
  for (const m of marks) left.push(...groupsWithMark(m));
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) left.push(r.pgid);
  readout.leftover_groups = left;
  if (!base.startsWith(os.tmpdir())) throw new Error(`拒绝删除 mkdtemp 之外的目录：${base}`);
  await fs.rm(base, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass} / ${results.length} 通过；残留进程组 ${JSON.stringify(readout.leftover_groups)}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ results, readout }, null, 2) + '\n');
process.exit(pass === results.length && readout.leftover_groups.length === 0 ? 0 : 1);
