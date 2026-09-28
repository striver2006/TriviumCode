#!/usr/bin/env node
/**
 * 「CLI进程组记录」零配额验收（计划 r2 §5.4 B1～B10）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录（每个夹具的 run_root 各在 mkdtemp 之下——
 * `trivium scrub` 会遍历整个运行根）、旧构建都建在一个 mkdtemp 目录下；审核者换成桩（`TRIVIUM_STUB_CRITIC`），
 * 不发起任何模型调用。收尾只删 mkdtemp 的返回值；残留进程按组号结束（本次运行目录标记认得出的桩 CLI 组、本次 run_id 的 worker）。
 *
 * 新旧两份构建（沿用上一主题做法）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`，TRIVIUM_ASSET_ROOT 指工作树；
 *   - 旧：`git archive` 固定提交（缺省 b6a555b，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，只叠加 `stub.ts`
 *     （`sleepS` / `blockAfterMs` 两项；`hang_cli` 旧构建本就有），`node_modules` 软链工作树、不联网，`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调，不经 `.trivium/bin/trivium`；记 sha256 并断言不同；叠加面的 diff 进读数。
 *
 *   B1  新：worker 被按组 SIGKILL（上一主题 A3 的做法）→ --cancel ⇒ 两组成员数为零、stderr 两行「按记录结束」
 *   B2  旧：同 B1 ⇒ 两组仍在、组长 ppid = 1、stderr 含旧的如实提示（复现上一主题 A3）
 *   B3  新：worker 事件循环被堵住（blockAfterMs）→ --cancel 升级 SIGKILL ⇒ 两组成员数为零
 *   B4  旧：同 B3 ⇒ 两组仍在
 *   B5  新 / 旧：worker 被强杀、CLI 仍活、放假载体 → trivium scrub：新不抹（deferred）、旧抹；新在 CLI 结束后再跑即抹
 *   B6  新：worker 被强杀 → --wait 判失联、会话启动 Hook ⇒ 都不结束 CLI；随后 --cancel ⇒ 两组空、status.json 字节不变
 *   B7  新：hang_cli + sleepS 1 跑完 ⇒ status.json 两侧 cli 为 null
 *   B8  新 / 旧：常态格 a 回归——hang 桩与 hang_cli 桩各走 --start / --cancel，stdout 逐行相同、stderr 归一化后逐行相同
 *   B9  probe-record.mjs 重跑：Q1～Q4 与计划期一致
 *   B10 新 → 旧（计划双审 r1 CODEX-03）：新构建写下带 cli 记录的 status.json，旧构建对它 --status --json / trivium scrub / --cancel 不报错
 *
 * 按进程表认组的 `psRows` / `groupsWithMark` / `members` 与 `test/helpers/proc.ts` 同源（本脚本要能脱离测试构建单独跑，
 * 故保留自包含副本；字段集以 helper 为准）。
 *
 * 用法（在仓库根，先 npm run build 与 build --with-tests）：node acceptance.mjs <probe-record.mjs> [输出 JSON 路径]
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
const PROBE = path.resolve(process.argv[2] ?? '');
const OUT = process.argv[3] ?? null;
const BASE_REF = process.env.ACCEPT_BASE_REF ?? 'b6a555b';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
for (const p of [NEW.cli, PROBE]) if (!existsSync(p)) throw new Error(`找不到：${p}`);

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
  return { root, topic, topicDir, stageDir, runRoot };
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

const sidesCli = async (runDir) => {
  const s = await readJson(path.join(runDir, 'status.json')).catch(() => null);
  return s ? Object.fromEntries(Object.entries(s.sides).map(([k, v]) => [k, v.cli])) : null;
};

/** 新构建：等 status.json 两侧都记下组号与启动时刻（旧构建不写记录，只等 1 s） */
async function waitRecords(build, runDir) {
  if (build.name !== 'new') { await sleep(1000); return null; }
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

const recMatches = (rec, groups) => rec !== null
  && JSON.stringify(Object.values(rec).map((v) => v?.pgid).sort()) === JSON.stringify([...groups].sort())
  && Object.values(rec).every((v) => v?.started_at);

/** B1 / B2：worker 被按组 SIGKILL → --cancel */
async function killedWorkerThenCancel(build, fx, stub) {
  const { r, js } = await start(build, fx, stub);
  if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
  const groups = await cliGroups(js.run_dir);
  const rec = await waitRecords(build, js.run_dir);
  const workerGone = await killWorker(js.worker_pid);
  await sleep(300);
  const before = groups.map((g) => members(g).length);
  const leaderPpids = groups.map((g) => psRows().find((x) => x.pid === g)?.ppid ?? null);
  const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], stub);
  await sleep(300);
  const after = groups.map((g) => members(g).length);
  const status = await readJson(path.join(js.run_dir, 'status.json')).catch(() => null);
  for (const g of groups) killGroup(g);
  return {
    runId: js.run_id, groups, rec, recOk: recMatches(rec, groups), workerGone, before, leaderPpids, after,
    cancelCode: c.code, cancelStderr: c.stderr, byRecord: (c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length,
    oldHint: /拉起的审查员 CLI 可能仍在/.test(c.stderr), statusPhase: status?.phase ?? null,
    sidesCliAfter: status ? Object.fromEntries(Object.entries(status.sides).map(([k, v]) => [k, v.cli])) : null,
  };
}

/** B3 / B4：worker 事件循环被堵住 → --cancel 升级 SIGKILL */
async function blockedWorkerThenCancel(build, fx) {
  // 桩先等本运行全部侧的记录（含启动时刻）落盘（至多 10 s）、再过 300 ms 才堵住（代码双审 r1 CODEX-03）。
  // 旧构建不写记录，桩要等满 10 s 才开始计时，所以旧构建多等 10 s
  const stub = { gemini: { mode: 'hang_cli', blockAfterMs: 300 }, glm: { mode: 'hang_cli' } };
  const { r, js } = await start(build, fx, stub);
  if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
  const groups = await cliGroups(js.run_dir);
  const rec = await waitRecords(build, js.run_dir);
  await sleep(build.name === 'new' ? 1000 : 11_000);
  const t0 = Date.now();
  const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], stub);
  const ms = Date.now() - t0;
  await sleep(300);
  const after = groups.map((g) => members(g).length);
  for (const g of groups) killGroup(g);
  killGroup(js.worker_pid);
  return {
    runId: js.run_id, groups, rec, recOk: recMatches(rec, groups), after, ms, cancelCode: c.code,
    escalated: /未响应 SIGTERM/.test(c.stderr), byRecord: (c.stderr.match(/按记录结束审查员 CLI/g) ?? []).length, cancelStderr: c.stderr,
  };
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

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-cli-pgroup-'));
try {
  // ── 旧构建 ──
  const oldDir = path.join(base, 'old');
  await fs.mkdir(oldDir, { recursive: true });
  const tarPath = path.join(base, 'old.tar');
  const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', tarPath, BASE_REF, 'src', 'scripts', 'skills', 'skills-src', 'test', '.reviews', 'package.json', 'tsconfig.json']);
  if (ar.code !== 0) throw new Error(`git archive 失败：${ar.stderr}`);
  const ex = await sh(oldDir, 'tar', ['-xf', tarPath]);
  if (ex.code !== 0) throw new Error(`解包失败：${ex.stderr}`);
  const OVERLAY = 'src/trivium/adapters/stub.ts';
  readout.overlay = { file: OVERLAY, diff: (await sh(ROOT, 'git', ['diff', BASE_REF, '--', OVERLAY])).stdout };
  await fs.copyFile(path.join(ROOT, OVERLAY), path.join(oldDir, OVERLAY));
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  const b = await sh(oldDir, process.execPath, ['scripts/build.mjs']);
  if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  const OLD = { name: 'old', cli: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(oldDir, 'skills/dual-critic') };
  readout.bundles = { new: { path: NEW.cli, sha256: sha(NEW.cli) }, old: { path: OLD.cli, sha256: sha(OLD.cli), from: BASE_REF, overlay: [OVERLAY] } };
  check('构建', readout.bundles.new.sha256 !== readout.bundles.old.sha256, `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）`);

  const TWO = { gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } };

  // ── B1 / B2 ──
  const b1 = await killedWorkerThenCancel(NEW, await fixture(base, 'B1'), TWO);
  readout.B1 = b1;
  check('B1', !b1.error && b1.recOk && b1.workerGone && b1.before.every((n) => n === 2) && b1.after.every((n) => n === 0)
    && b1.byRecord === 2 && b1.statusPhase === 'cancelled',
    `记录与组相符 ${b1.recOk}；worker 被强杀后组成员 ${JSON.stringify(b1.before)}、--cancel 后 ${JSON.stringify(b1.after)}；「按记录结束」${b1.byRecord} 行；status ${b1.statusPhase}；取消后记录 ${JSON.stringify(b1.sidesCliAfter)}`);
  await sleep(1100);
  const b2 = await killedWorkerThenCancel(OLD, await fixture(base, 'B2'), TWO);
  readout.B2 = b2;
  check('B2', !b2.error && b2.after.every((n) => n === 2) && b2.leaderPpids.every((p) => p === 1) && b2.oldHint,
    `旧构建：--cancel 后组成员 ${JSON.stringify(b2.after)}、组长 ppid ${JSON.stringify(b2.leaderPpids)}、旧提示在场 ${b2.oldHint}（复现上一主题 A3）`);

  // ── B3 / B4 ──
  await sleep(1100);
  const b3 = await blockedWorkerThenCancel(NEW, await fixture(base, 'B3'));
  readout.B3 = b3;
  check('B3', !b3.error && b3.recOk && b3.escalated && b3.after.every((n) => n === 0) && b3.byRecord === 2,
    `记录与组相符 ${b3.recOk}；升级 SIGKILL ${b3.escalated}；--cancel 后组成员 ${JSON.stringify(b3.after)}；「按记录结束」${b3.byRecord} 行；${b3.ms} ms`);
  await sleep(1100);
  const b4 = await blockedWorkerThenCancel(OLD, await fixture(base, 'B4'));
  readout.B4 = b4;
  check('B4', !b4.error && b4.escalated && b4.after.every((n) => n === 2),
    `旧构建：升级 SIGKILL ${b4.escalated}；--cancel 后组成员 ${JSON.stringify(b4.after)}（CLI 留下）`);

  // ── B5 ──
  const scrubCase = async (build) => {
    await sleep(1100);
    const fx = await fixture(base, `B5-${build.name}`);
    const { r, js } = await start(build, fx, TWO);
    if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
    const groups = await cliGroups(js.run_dir);
    await waitRecords(build, js.run_dir);
    await killWorker(js.worker_pid);
    const carrier = await placeCarrier(js.run_dir);
    const s1 = await cli(build, fx.root, ['scrub', '--json'], null);
    const j1 = jsonOf(s1.stdout);
    const carrierAfter1 = await exists(carrier);
    const alive1 = groups.map((g) => members(g).length);
    for (const g of groups) killGroup(g);
    for (let i = 0; i < 40 && groups.some((g) => members(g).length > 0); i++) await sleep(50);
    const s2 = await cli(build, fx.root, ['scrub', '--json'], null);
    const carrierAfter2 = await exists(carrier);
    return { runDir: js.run_dir, code1: s1.code, deferred1: j1?.deferred ?? null, scrubbed1: j1?.scrubbed ?? null, carrierAfter1, alive1, code2: s2.code, carrierAfter2 };
  };
  const b5n = await scrubCase(NEW);
  const b5o = await scrubCase(OLD);
  readout.B5 = { new: b5n, old: b5o };
  check('B5', !b5n.error && !b5o.error && b5n.code1 === 0 && b5n.carrierAfter1 && (b5n.deferred1 ?? []).includes(b5n.runDir)
    && b5n.alive1.every((n) => n === 2) && !b5n.carrierAfter2 && b5o.code1 === 0 && !b5o.carrierAfter1,
    `新：CLI 活着时 scrub 后载体在 ${b5n.carrierAfter1}、deferred 含该目录 ${(b5n.deferred1 ?? []).includes(b5n.runDir)}、CLI 结束后再 scrub 载体在 ${b5n.carrierAfter2}；旧：CLI 活着时 scrub 后载体在 ${b5o.carrierAfter1}（EV-38 原貌）`);

  // ── B6 ──
  await sleep(1100);
  {
    const fx = await fixture(base, 'B6');
    const { r, js } = await start(NEW, fx, TWO);
    if (!js) {
      check('B6', false, `--start 失败：${r.stdout}${r.stderr}`);
    } else {
      const groups = await cliGroups(js.run_dir);
      await waitRecords(NEW, js.run_dir);
      await killWorker(js.worker_pid);
      const w = await cli(NEW, fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], null);
      const afterWait = groups.map((g) => members(g).length);
      const h = await hookSessionStart(NEW, fx.root);
      const afterHook = groups.map((g) => members(g).length);
      const sp = path.join(js.run_dir, 'status.json');
      const beforeBytes = await fs.readFile(sp, 'utf8');
      const c = await cli(NEW, fx.root, ['review', '--cancel', js.run_id], null);
      await sleep(300);
      const afterCancel = groups.map((g) => members(g).length);
      const same = (await fs.readFile(sp, 'utf8')) === beforeBytes;
      for (const g of groups) killGroup(g);
      readout.B6 = { waitCode: w.code, waitStderr: w.stderr, hookCode: h.code, afterWait, afterHook, cancelStdout: c.stdout, cancelStderr: c.stderr, afterCancel, statusBytesSame: same };
      check('B6', w.code === 1 && afterWait.every((n) => n === 2) && h.code === 0 && afterHook.every((n) => n === 2)
        && /已处于终态（failed）/.test(c.stdout) && afterCancel.every((n) => n === 0) && same,
        `--wait 退 ${w.code} 后组成员 ${JSON.stringify(afterWait)}；会话启动 Hook 后 ${JSON.stringify(afterHook)}；--cancel（终态分支）后 ${JSON.stringify(afterCancel)}；status.json 字节不变 ${same}`);
    }
  }

  // ── B7 ──
  await sleep(1100);
  {
    const fx = await fixture(base, 'B7');
    const stub = { gemini: { mode: 'hang_cli', sleepS: 1 }, glm: { mode: 'hang_cli', sleepS: 1 } };
    const { js } = await start(NEW, fx, stub);
    let w = { code: 73 };
    for (let i = 0; i < 10 && w.code === 73; i++) w = await cli(NEW, fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub);
    const rec = await sidesCli(js.run_dir);
    readout.B7 = { waitCode: w.code, sidesCli: rec };
    check('B7', rec !== null && Object.values(rec).every((v) => v === null), `运行结束后两侧记录 ${JSON.stringify(rec)}`);
  }

  // ── B8 ──
  {
    const norm = (s) => s
      .replace(/\d{8}T\d{6}Z/g, '<RUN>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>')
      .replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<BASE>')
      .replace(/B8-[a-z_]+-(new|old)/g, 'B8-<T>-<B>')
      .replace(/\b\d{3,7}\b/g, '<N>');
    const one = async (build, kind, stub) => {
      await sleep(1100);
      const fx = await fixture(base, `B8-${kind}-${build.name}`);
      const { js } = await start(build, fx, stub);
      if (kind === 'hang_cli') await cliGroups(js.run_dir);
      else await sleep(500);
      const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
      for (const g of groupsWithMark(`trivium-stub-cli:${js.run_dir}`)) killGroup(g);
      return { stdout: c.stdout, stderr: c.stderr, code: c.code };
    };
    const kinds = { hang: { gemini: { mode: 'hang' }, glm: { mode: 'hang' } }, hang_cli: TWO };
    readout.B8 = {};
    let ok = true;
    const parts = [];
    for (const [k, stub] of Object.entries(kinds)) {
      const n = await one(NEW, k, stub);
      const o = await one(OLD, k, stub);
      const same = { stdout: norm(n.stdout) === norm(o.stdout), stderr: norm(n.stderr) === norm(o.stderr) };
      readout.B8[k] = { new: n, old: o, normalized: { new: { stdout: norm(n.stdout), stderr: norm(n.stderr) }, old: { stdout: norm(o.stdout), stderr: norm(o.stderr) } }, same };
      ok &&= n.code === o.code && same.stdout && same.stderr;
      parts.push(`${k}：退出码 ${n.code}/${o.code}、stdout 同 ${same.stdout}、stderr 同 ${same.stderr}`);
    }
    check('B8', ok, parts.join('；'));
  }

  // ── B9 ──
  {
    const p = jsonOf((await sh(ROOT, process.execPath, [PROBE, ROOT])).stdout);
    readout.B9 = p;
    check('B9', p?.Q1?.ok && p?.Q2?.ok && p?.Q3?.ok && p?.Q4?.ok && (p?.leftover ?? []).length === 0,
      `Q1 ${p?.Q1?.ok} Q2 ${p?.Q2?.ok} Q3 ${p?.Q3?.ok} Q4 ${p?.Q4?.ok}；残留 ${JSON.stringify(p?.leftover)}`);
  }

  // ── B10（回滚方向）──
  await sleep(1100);
  {
    const fx = await fixture(base, 'B10');
    const { r, js } = await start(NEW, fx, TWO);
    if (!js) {
      check('B10', false, `--start 失败：${r.stdout}${r.stderr}`);
    } else {
      const groups = await cliGroups(js.run_dir);
      const rec = await waitRecords(NEW, js.run_dir);
      await killWorker(js.worker_pid);
      for (const g of groups) killGroup(g); // 只留记录
      for (let i = 0; i < 40 && groups.some((g) => members(g).length > 0); i++) await sleep(50);
      const newStatus = await cli(NEW, fx.root, ['review', '--status', js.run_id, '--json'], null);
      const oldStatus = await cli(OLD, fx.root, ['review', '--status', js.run_id, '--json'], null);
      const oj = jsonOf(oldStatus.stdout);
      const oldCliKey = Object.values(oj?.status?.sides ?? {}).every((v) => v && 'cli' in v);
      const oldScrub = await cli(OLD, fx.root, ['scrub', '--json'], null);
      const oldCancel = await cli(OLD, fx.root, ['review', '--cancel', js.run_id], null);
      readout.B10 = {
        rec, newStatusCode: newStatus.code, oldStatusCode: oldStatus.code, oldCliKey,
        oldScrubCode: oldScrub.code, oldScrubOk: jsonOf(oldScrub.stdout)?.ok ?? null,
        oldCancelCode: oldCancel.code, oldCancelStdout: oldCancel.stdout, oldCancelStderr: oldCancel.stderr,
      };
      check('B10', recMatches(rec, groups) && newStatus.code === oldStatus.code && oldCliKey && oldScrub.code === 0
        && oldCancel.code === 0 && /已取消/.test(oldCancel.stdout),
        `旧构建读新 status.json：--status 退 ${oldStatus.code}（新 ${newStatus.code}）、cli 键原样透出 ${oldCliKey}；scrub 退 ${oldScrub.code}；--cancel 退 ${oldCancel.code}`);
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
