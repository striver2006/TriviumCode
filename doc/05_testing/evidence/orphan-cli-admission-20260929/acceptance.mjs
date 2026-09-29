#!/usr/bin/env node
/**
 * 「组长已退组员仍在的准入」（EV-165）零配额验收（计划 r2 §3.4 B1～B5，另加 B6 doctor 自检）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 审核者换成桩（`TRIVIUM_STUB_CRITIC`，`hang_cli` 以仓库的 run() 按 killTree 真实拉起 `sh -c 'sleep 600; : "$0"'`），
 * 不发起任何模型调用。收尾只删 mkdtemp 的返回值；残留进程按标记与组号结束。
 *
 * 新旧两份构建（沿用上一主题做法）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`（先 npm run build）；
 *   - 旧：`git archive` 固定提交（缺省 eeceeaa，起点，ACCEPT_BASE_REF 可覆盖）+ `.reviews/`，展开进 mkdtemp，
 *     `node_modules` 软链工作树，`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 * 「组长已退、组员仍在」的构造：起两侧 hang_cli（组长 `sh` + 子进程 `sleep`，同组）→ 按组 SIGKILL worker
 * （它的 SIGTERM 处理器跑不到）→ 对 glm 侧单 pid（非组）SIGKILL 组长，`gemini` 侧组长保持存活作对照。
 * worker 已经不在，不会有观察者把 glm 侧记录清成 null（计划双审 r1 CODEX-01≡CODEX-02≡AGY-02≡GLM-03 的教训）。
 *
 *   B1  会话启动清扫：新——glm 侧（H 格）不抹、gemini 侧（仍活）不抹；旧——两侧都照抹
 *   B2  到期整删（推到 31 天前）：新——目录在（H 格挡住）；旧——目录已删
 *   B3  --cancel：新——按组结束 glm 侧组员（组信号打到 pgid 仍有效）与 gemini 侧组长之后，两侧都照抹；
 *       旧——glm 侧组长已不在直接判 gone 放行抹除（组员未被结束，遗留进程），gemini 侧走既有 alive 路径照抹
 *   B4  常态回归（两侧都正常存活、两侧都已自然结束）：新旧逐行输出与退出码相同——确认本轮改动没有波及既有路径
 *   B5  --wait 判失联：新——glm 侧（H 格）不抹、带精确成员数；gemini 侧（alive）不抹；两者都不结束进程；
 *       旧——两侧都照抹（旧版对 glm 侧的组长已退出直接判 gone 放行）
 *   B6  新构建 doctor --selftest
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
const BASE_REF = process.env.ACCEPT_BASE_REF ?? 'eeceeaa';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const TOPIC = '孤儿组验收';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

// 代码双审 r1 CODEX-02：孤儿组不被复用的前提是 XNU 行为，与 Node 版本无关，补记系统版本供日后核对是否需要重测
const sysVersion = (bin, args) => { try { return execFileSync(bin, args, { encoding: 'utf8' }).trim(); } catch { return null; } };
const results = [];
const readout = {
  base_ref: BASE_REF, node: process.version, platform: process.platform,
  macosProductVersion: sysVersion('/usr/bin/sw_vers', ['-productVersion']), kernelRelease: sysVersion('/usr/bin/uname', ['-r']),
};
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
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,ppid=,stat=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: +m[1], pgid: +m[2], ppid: +m[3], stat: m[4], cmd: m[5] });
  }
  return rows;
}
const groupsWithMark = (mark) => [...new Set(psRows().filter((r) => r.cmd.includes(mark)).map((r) => r.pgid))];
const members = (pgid) => psRows().filter((r) => r.pgid === pgid && !r.stat.startsWith('Z')).length;
const killGroup = (g) => { if (g > 1) try { process.kill(-g, 'SIGKILL'); } catch { /* 已不在 */ } };
const killLeaderOnly = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch { /* 已不在 */ } };
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

/** 两份构建都写 CLI 记录：等 status.json 两侧都记下组号与启动时刻 */
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

/** 起两侧 hang_cli、等记录、按组 SIGKILL worker、放载体、对 glm 侧单 pid SIGKILL 组长（造孤儿组）；gemini 侧组长保持存活作对照 */
async function orphanedRun(build, base, dir) {
  await sleep(1100); // run_id 秒级：两次 --start 错开
  const fx = await fixture(base, dir);
  const { r, js } = await start(build, fx, TWO);
  if (!js) return { error: `--start 失败：${r.stdout}${r.stderr}` };
  const groups = await cliGroups(js.run_dir);
  const rec = await waitRecords(js.run_dir);
  const workerGone = await killWorker(js.worker_pid);
  const carrier = await placeCarrier(js.run_dir);
  const glmPgid = rec?.glm?.pgid;
  const gemPgid = rec?.gemini?.pgid;
  killLeaderOnly(glmPgid);
  let n = members(glmPgid);
  for (let i = 0; i < 60 && n === 0; i++) { await sleep(50); n = members(glmPgid); }
  return { fx, js, groups, rec, workerGone, carrier, glmPgid, gemPgid, glmMembersAfterOrphan: n };
}

/**
 * 同 `orphanedRun`，但额外把 gemini 侧整组结束（含组员）——只留 glm 侧的孤儿态作为准入判据的唯一变量。
 * 不这样做的话，gemini 侧「仍在」会先一步挡住准入，新旧构建在这一步的输出都会相同，观察不到 glm 侧孤儿组
 * 本身有没有被本轮判据挡住（B1/B2/B5 要单独看 glm 侧；B3 需要 gemini 仍活，走既有 alive 路径，不用本函数）。
 */
async function orphanedRunIsolated(build, base, dir) {
  const o = await orphanedRun(build, base, dir);
  if (o.error) return o;
  killGroup(o.gemPgid);
  for (let i = 0; i < 60 && members(o.gemPgid) > 0; i++) await sleep(50);
  return o;
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-ev165-'));
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
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  const b = await sh(oldDir, process.execPath, ['scripts/build.mjs']);
  if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  const OLD = { name: 'old', cli: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(oldDir, 'skills/dual-critic') };
  readout.bundles = { new: { path: NEW.cli, sha256: sha(NEW.cli) }, old: { path: OLD.cli, sha256: sha(OLD.cli), from: BASE_REF } };
  check('构建', readout.bundles.new.sha256 !== readout.bundles.old.sha256,
    `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）`);

  // ── B1：会话启动清扫（仅 glm 侧孤儿态，gemini 侧已整组结束、不参与判定） ──
  const b1Case = async (build) => {
    const o = await orphanedRunIsolated(build, base, `B1-${build.name}`);
    if (o.error) return o;
    const h1 = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook1 = await exists(o.carrier);
    const ended = await endGroups([o.glmPgid]);
    const h2 = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook2 = await exists(o.carrier);
    return { glmMembersAfterOrphan: o.glmMembersAfterOrphan, code1: h1.code, ctx1: h1.ctx, carrierAfterHook1, ended, code2: h2.code, carrierAfterHook2 };
  };
  const b1n = await b1Case(NEW);
  const b1o = await b1Case(OLD);
  {
    const d = lineDiff(b1n.ctx1, b1o.ctx1);
    const fourth = d.onlyNew.find((l) => /组长已退出，组里还有.+个成员/.test(l)) ?? '';
    readout.B1 = { new: b1n, old: b1o, diff: d };
    check('B1', !b1n.error && !b1o.error && b1n.glmMembersAfterOrphan > 0
      && b1n.code1 === 0 && b1o.code1 === 0 && b1n.carrierAfterHook1
      && !b1o.carrierAfterHook1 && fourth !== ''
      && b1n.ended.every((n) => n === 0) && b1n.code2 === 0 && !b1n.carrierAfterHook2,
      `新：孤儿组成员数 ${b1n.glmMembersAfterOrphan}、Hook 后载体在 ${b1n.carrierAfterHook1}（H 格挡住 ${fourth !== ''}）；` +
      `旧：载体在 ${b1o.carrierAfterHook1}（应为 false，旧版放行抹除）；组结束后新构建再清扫即抹 ${!b1n.carrierAfterHook2}`);
  }

  // ── B2：到期整删 ──
  const b2Case = async (build) => {
    const o = await orphanedRunIsolated(build, base, `B2-${build.name}`);
    if (o.error) return o;
    await age(base, o.js.run_dir, 31);
    const h1 = await hookSessionStart(build, o.fx.root);
    const dirAfter1 = await exists(o.js.run_dir);
    const carrierAfter1 = await exists(o.carrier);
    const ended = await endGroups([o.glmPgid, o.gemPgid]);
    let h2 = null;
    let dirAfter2 = dirAfter1;
    if (dirAfter1) {
      await age(base, o.js.run_dir, 31);
      h2 = await hookSessionStart(build, o.fx.root);
      dirAfter2 = await exists(o.js.run_dir);
    }
    return { code1: h1.code, dirAfter1, carrierAfter1, ended, code2: h2?.code ?? null, dirAfter2 };
  };
  const b2n = await b2Case(NEW);
  const b2o = await b2Case(OLD);
  check('B2', !b2n.error && !b2o.error && b2n.code1 === 0 && b2o.code1 === 0
    && b2n.dirAfter1 && b2n.carrierAfter1 && !b2o.dirAfter1
    && b2n.ended.every((n) => n === 0) && !b2n.dirAfter2,
    `新：到期整删后目录在 ${b2n.dirAfter1}（H 格挡住）、两组结束后再整删即删 ${!b2n.dirAfter2}；旧：目录在 ${b2o.dirAfter1}（应为 false，旧版照删）`);
  readout.B2 = { new: b2n, old: b2o };

  // ── B3：--cancel（新按组结束孤儿组员之后照抹；旧对孤儿组直接判 gone 放行、组员遗留） ──
  const b3Case = async (build) => {
    const o = await orphanedRun(build, base, `B3-${build.name}`);
    if (o.error) return o;
    const c = await cli(build, o.fx.root, ['review', '--cancel', o.js.run_id]);
    await sleep(200);
    const glmMembersAfter = members(o.glmPgid);
    const gemMembersAfter = members(o.gemPgid);
    const carrierAfter = await exists(o.carrier);
    return { code: c.code, stdout: c.stdout, stderr: c.stderr, glmMembersAfter, gemMembersAfter, carrierAfter, glmPgid: o.glmPgid, gemPgid: o.gemPgid };
  };
  const b3n = await b3Case(NEW);
  const b3o = await b3Case(OLD);
  check('B3', !b3n.error && !b3o.error && b3n.code === 0 && b3o.code === 0
    && b3n.glmMembersAfter === 0 && b3n.gemMembersAfter === 0 && !b3n.carrierAfter
    && b3o.glmMembersAfter > 0 && b3o.gemMembersAfter === 0 && !b3o.carrierAfter,
    `新：--cancel 之后 glm 侧组员 ${b3n.glmMembersAfter}（应已被组信号结束）、gemini 侧 ${b3n.gemMembersAfter}、照抹 ${!b3n.carrierAfter}；` +
    `旧：glm 侧组员遗留 ${b3o.glmMembersAfter}（旧版从不按记录结束孤儿组，组长已不在即判 gone 直接抹除，组员照样烧配额）、gemini 侧 ${b3o.gemMembersAfter}`);
  // 旧构建遗留的孤儿组是本脚本自己造的桩进程（sleep），收尾按标记结束，不留系统残留
  killGroup(b3o.glmPgid); killGroup(b3o.gemPgid);
  readout.B3 = { new: b3n, old: b3o };

  // ── B4：常态回归（无孤儿组时新旧逐字相同——确认既有路径未受影响） ──
  {
    const normalCancel = async (build) => {
      await sleep(1100);
      const fx = await fixture(base, `B4cancel-${build.name}`);
      const { js } = await start(build, fx, TWO);
      await cliGroups(js.run_dir);
      const c = await cli(build, fx.root, ['review', '--cancel', js.run_id]);
      for (const g of groupsWithMark(`trivium-stub-cli:${js.run_dir}`)) killGroup(g);
      return { code: c.code, stdout: c.stdout, stderr: c.stderr };
    };
    const normalDone = async (build) => {
      await sleep(1100);
      const fx = await fixture(base, `B4done-${build.name}`);
      const stub = { gemini: { mode: 'hang_cli', sleepS: 1 }, glm: { mode: 'hang_cli', sleepS: 1 } };
      const { js } = await start(build, fx, stub);
      let w = { code: 73, stdout: '', stderr: '' };
      for (let i = 0; i < 10 && w.code === 73; i++) w = await cli(build, fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], stub);
      return { code: w.code, stdout: w.stdout, stderr: w.stderr };
    };
    const n1 = await normalCancel(NEW); const o1 = await normalCancel(OLD);
    const d1 = lineDiff(n1.stdout + n1.stderr, o1.stdout + o1.stderr);
    const n2 = await normalDone(NEW); const o2 = await normalDone(OLD);
    const d2 = lineDiff(n2.stdout + n2.stderr, o2.stdout + o2.stderr);
    readout.B4 = { cancel: { new: n1, old: o1, diff: d1 }, done: { new: n2, old: o2, diff: d2 } };
    check('B4', n1.code === o1.code && d1.onlyNew.length === 0 && d1.onlyOld.length === 0
      && n2.code === o2.code && d2.onlyNew.length === 0 && d2.onlyOld.length === 0,
      `常态 --cancel（两组都活）：退出码 ${n1.code}/${o1.code}、差异 ${d1.onlyNew.length}+${d1.onlyOld.length} 行；` +
      `常态跑完（两组自然结束）：退出码 ${n2.code}/${o2.code}、差异 ${d2.onlyNew.length}+${d2.onlyOld.length} 行`);
  }

  // ── B5：--wait 判失联（仅 glm 侧孤儿态，gemini 侧已整组结束、不参与判定） ──
  const b5Case = async (build) => {
    const o = await orphanedRunIsolated(build, base, `B5-${build.name}`);
    if (o.error) return o;
    const w = await cli(build, o.fx.root, ['review', '--wait', o.js.run_id, '--timeout', '20']);
    const carrierAfter = await exists(o.carrier);
    const glmMembersAfter = members(o.glmPgid);
    const ended = await endGroups([o.glmPgid]);
    return { code: w.code, stdout: w.stdout, stderr: w.stderr, carrierAfter, glmMembersAfter, ended, glmPgid: o.glmPgid, glmMembersAtCheck: o.glmMembersAfterOrphan };
  };
  const b5n = await b5Case(NEW);
  const b5o = await b5Case(OLD);
  {
    const out = b5n.stdout + b5n.stderr;
    const line = out.split('\n').find((l) => l.includes('凭据副本未抹')) ?? '';
    check('B5', !b5n.error && !b5o.error && b5n.code === 1 && b5o.code === 1
      && b5n.carrierAfter && !b5o.carrierAfter
      && b5n.glmMembersAfter > 0
      && line.includes(`glm 侧审查员 CLI 进程组 ${b5n.glmPgid} 的组长已退出，组里还有 ${b5n.glmMembersAtCheck} 个成员`),
      `新：--wait 退出码 ${b5n.code}（判失联退 1）、载体不抹 ${b5n.carrierAfter}、glm 侧组员仍在 ${b5n.glmMembersAfter}、正文带精确成员数 ${line !== ''}；` +
      `旧：退出码 ${b5o.code}（判失联同样退 1，但两侧都判 gone 照抹）、载体不抹 ${b5o.carrierAfter}（应为 false）`);
  }
  readout.B5 = { new: b5n, old: b5o };

  // ── B6：新构建 doctor 自检 ──
  {
    const d = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(d.stdout + d.stderr);
    readout.B6 = { code: d.code, tail: (d.stdout + d.stderr).trim().split('\n').slice(-6) };
    check('B6', d.code === 0 && !!m && m[1] === m[2], `doctor --selftest 退 ${d.code}、${m ? `${m[1]}/${m[2]}` : '（没读到计数）'}`);
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
