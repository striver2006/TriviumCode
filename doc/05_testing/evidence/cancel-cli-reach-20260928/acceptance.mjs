#!/usr/bin/env node
/**
 * 「取消够不到审查员CLI」零配额验收（计划 r2 §5.4 A1～A7）。
 *
 * **不碰真实 HOME、不改本仓归档**：夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；审核者换成桩（`TRIVIUM_STUB_CRITIC`），
 * 不发起任何模型调用。收尾只删 mkdtemp 的返回值；残留进程按组号结束（本次运行目录标记认得出的桩 CLI 组、本次 run_id 的 worker）。
 *
 * 新旧两份构建（计划双审 r1 CODEX-01 ≡ AGY-01）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`，TRIVIUM_ASSET_ROOT 指工作树；
 *   - 旧：`git archive` 固定提交（缺省 dbd1a8a，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，只叠加 `stub.ts`（`hang_cli`），
 *     `node_modules` 软链工作树、不联网，`node scripts/build.mjs`，TRIVIUM_ASSET_ROOT 指导出目录；
 *   - 两份都 `node <bundle>` 直接调，不经 `.trivium/bin/trivium`；记 sha256 并断言不同；叠加面的 diff 进读数。
 *
 *   A1 新构建，两侧 hang_cli → --cancel ⇒ 两组成员数为零；worker.log 有转发行；run.json / status.json cancelled
 *   A2 新构建，一侧 ignoreTerm ⇒ 同 A1；stderr 不含「未响应 SIGTERM」；--cancel 耗时 < WORKER_TERM_GRACE_MS - 500
 *   A3 新构建，按组 SIGKILL worker（覆盖不到的格，如实记录）⇒ CLI 两组都活着、ppid = 1；--cancel 的 stderr 含如实提示
 *   A4 旧构建（叠加 hang_cli）同 A1 ⇒ CLI 两组都活着（今天的缺口）
 *   A5 计划期两个探针重跑，读数与计划期一致
 *   A6 hang 桩新旧两份构建 --start / --cancel：stdout 逐行相同；stderr 归一化 pid / run_id / 时间戳后逐行相同
 *   A7 A1 之后会话启动 Hook：不出现指向该运行的提示
 *
 * 按进程表认组的 `psRows` / `groupsWithMark` / `members` 与 `test/helpers/proc.ts` 同源（本脚本要能脱离测试构建单独跑，
 * 故保留自包含副本；字段集以 helper 为准，代码双审 r1 CODEX-04）。
 *
 * 用法（在仓库根，先 npm run build）：node acceptance.mjs <probe-kill-reach.mjs> <probe-pipe-break.mjs> [输出 JSON 路径]
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
const PROBE_K1 = path.resolve(process.argv[2] ?? '');
const PROBE_PB = path.resolve(process.argv[3] ?? '');
const OUT = process.argv[4] ?? null;
const BASE_REF = process.env.ACCEPT_BASE_REF ?? 'dbd1a8a';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const { WORKER_TERM_GRACE_MS } = await imp(path.join(ROOT, 'dist/test/src/trivium/run-protocol.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
for (const p of [NEW.cli, PROBE_K1, PROBE_PB]) if (!existsSync(p)) throw new Error(`找不到：${p}`);

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

/** A1 / A2 / A4 共用：起两侧 hang_cli、--cancel、看组是否空 */
async function cancelScenario(build, fx, stub) {
  const { r, js } = await start(build, fx, stub);
  if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
  const groups = await cliGroups(js.run_dir);
  const before = groups.map((g) => members(g).length);
  const t0 = Date.now();
  const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], stub);
  const ms = Date.now() - t0;
  await sleep(300);
  const after = groups.map((g) => members(g).map((m) => ({ pid: m.pid, ppid: m.ppid, cmd: m.cmd.slice(0, 60) })));
  const workerLog = await fs.readFile(path.join(js.run_dir, 'worker.log'), 'utf8').catch(() => '');
  const status = await readJson(path.join(js.run_dir, 'status.json')).catch(() => null);
  const meta = await readJson(path.join(fx.stageDir, '_meta', `run-${js.run_id}.json`)).catch(() => null);
  for (const g of groups) killGroup(g);
  return {
    runId: js.run_id, groups, before, after, ms, cancelCode: c.code,
    escalated: /未响应 SIGTERM/.test(c.stderr), cancelStderr: c.stderr,
    forwardLine: (/\[worker\][^\n]*/.exec(workerLog) ?? [null])[0],
    statusPhase: status?.phase ?? null, metaStatus: meta?.status ?? null,
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

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-cancel-cli-'));
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
  const IGN = { gemini: { mode: 'hang_cli', ignoreTerm: true }, glm: { mode: 'hang_cli' } };

  // ── A1 ──
  const fx1 = await fixture(base, 'A1');
  const a1 = await cancelScenario(NEW, fx1, TWO);
  readout.A1 = a1;
  check('A1', !a1.error && a1.before.every((n) => n === 2) && a1.after.every((m) => m.length === 0) && !a1.escalated
    && /已按组终止审查员 CLI/.test(a1.forwardLine ?? '') && a1.statusPhase === 'cancelled' && a1.metaStatus === 'cancelled',
    `组成员 前 ${JSON.stringify(a1.before)} 后 ${JSON.stringify(a1.after.map((m) => m.length))}；${a1.forwardLine}；status ${a1.statusPhase} / run.json ${a1.metaStatus}；${a1.ms} ms`);

  // ── A7（紧接 A1）──
  const h = await hookSessionStart(NEW, fx1.root);
  readout.A7 = { code: h.code, ctx: h.ctx };
  check('A7', h.code === 0 && !h.ctx.includes(a1.runId ?? '__none__'), `会话启动 Hook 退 ${h.code}，提示里${h.ctx.includes(a1.runId ?? '__none__') ? '有' : '没有'}该运行`);

  // ── A2 ──
  await sleep(1100);
  const fx2 = await fixture(base, 'A2');
  const a2 = await cancelScenario(NEW, fx2, IGN);
  readout.A2 = a2;
  check('A2', !a2.error && a2.after.every((m) => m.length === 0) && !a2.escalated && /（SIGTERM、SIGKILL）/.test(a2.forwardLine ?? '')
    && a2.metaStatus === 'cancelled' && a2.ms < WORKER_TERM_GRACE_MS - 500,
    `组成员后 ${JSON.stringify(a2.after.map((m) => m.length))}；${a2.forwardLine}；未升级 ${!a2.escalated}；${a2.ms} ms（上界 ${WORKER_TERM_GRACE_MS - 500}）`);

  // ── A3（覆盖不到的格）──
  await sleep(1100);
  const fx3 = await fixture(base, 'A3');
  {
    const { r, js } = await start(NEW, fx3, TWO);
    if (!js) {
      check('A3', false, `--start 失败：${r.stdout}${r.stderr}`);
    } else {
      const groups = await cliGroups(js.run_dir);
      killGroup(js.worker_pid);
      await sleep(800);
      const after = groups.map((g) => members(g).map((m) => ({ pid: m.pid, ppid: m.ppid })));
      const leaderPpids = groups.map((g) => psRows().find((x) => x.pid === g)?.ppid ?? null);
      const c = await cli(NEW, fx3.root, ['review', '--cancel', js.run_id], TWO);
      const hint = /拉起的审查员 CLI 可能仍在/.test(c.stderr);
      for (const g of groups) killGroup(g);
      readout.A3 = { groups, after, leaderPpids, cancelStderr: c.stderr, hint };
      check('A3', after.every((m) => m.length === 2) && leaderPpids.every((p) => p === 1) && hint,
        `worker 被 SIGKILL 后两组成员 ${JSON.stringify(after.map((m) => m.length))}、组长 ppid ${JSON.stringify(leaderPpids)}（如实保留的格）；--cancel 提示在场 ${hint}`);
    }
  }

  // ── A4（旧构建）──
  await sleep(1100);
  const fx4 = await fixture(base, 'A4');
  const a4 = await cancelScenario(OLD, fx4, TWO);
  readout.A4 = a4;
  check('A4', !a4.error && a4.after.every((m) => m.length === 2),
    `旧构建 --cancel 之后两组成员 ${JSON.stringify(a4.after.map((m) => m.length))}（今天的缺口：CLI 留下）`);

  // ── A5 ──
  {
    const k1 = jsonOf((await sh(ROOT, process.execPath, [PROBE_K1, ROOT])).stdout);
    const pb = jsonOf((await sh(ROOT, process.execPath, [PROBE_PB, ROOT])).stdout);
    const pAlive = {};
    for (const p of pb?.P ?? []) pAlive[p.id] = p.error ? 'n/a' : p.after['6s'].groupMembers.length > 0;
    const hKids = {};
    for (const x of pb?.H ?? []) hKids[x.id] = Object.values(x.kidGroupsAfter).map((a) => a.length);
    readout.A5 = { K1: k1?.K1_after ?? null, P: pAlive, H: hKids };
    const expectP = { P1: false, P2: false, P3: true, P4: false, P5: true, P6: true, P7: 'n/a', P8: 'n/a' };
    const ok = k1?.K1_after?.treeChildAlive === true && k1?.K1_after?.plainChildAlive === false
      && JSON.stringify(pAlive) === JSON.stringify(expectP)
      && JSON.stringify(hKids.H1) === '[0,0]' && JSON.stringify(hKids.H2) === '[2,2]';
    check('A5', ok, `K1 tree 活 ${k1?.K1_after?.treeChildAlive} / plain 活 ${k1?.K1_after?.plainChildAlive}；P ${JSON.stringify(pAlive)}；H ${JSON.stringify(hKids)}`);
  }

  // ── A6 ──
  {
    const norm = (s) => s
      .replace(/\d{8}T\d{6}Z/g, '<RUN>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>')
      .replace(new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<BASE>')
      // 第 1 次只归一了带斜杠的路径形态，stdout 里「已回收主题「A6-new」的锁」这种裸主题名漏了，A6 假红（读数留 .r0）
      .replace(/A6-(new|old)/g, 'A6-<B>')
      .replace(/\b\d{3,7}\b/g, '<N>');
    const one = async (build) => {
      await sleep(1100);
      const fx = await fixture(base, `A6-${build.name}`);
      const { js } = await start(build, fx, { gemini: { mode: 'hang' }, glm: { mode: 'hang' } });
      await sleep(500);
      const c = await cli(build, fx.root, ['review', '--cancel', js.run_id], null);
      return { stdout: c.stdout, stderr: c.stderr, code: c.code };
    };
    const n = await one(NEW);
    const o = await one(OLD);
    const same = { stdout: norm(n.stdout) === norm(o.stdout), stderr: norm(n.stderr) === norm(o.stderr) };
    readout.A6 = { new: n, old: o, normalized: { new: { stdout: norm(n.stdout), stderr: norm(n.stderr) }, old: { stdout: norm(o.stdout), stderr: norm(o.stderr) } }, same };
    check('A6', n.code === o.code && same.stdout && same.stderr, `退出码 ${n.code}/${o.code}；stdout 归一化后相同 ${same.stdout}；stderr 归一化后相同 ${same.stderr}`);
  }
} finally {
  for (const m of marks) for (const g of groupsWithMark(m)) killGroup(g);
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) killGroup(r.pgid);
  const left = [];
  for (const m of marks) left.push(...groupsWithMark(m));
  readout.leftover_groups = left;
  await fs.rm(base, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass} / ${results.length}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ results, readout }, null, 2) + '\n');
process.exit(pass === results.length ? 0 : 1);
