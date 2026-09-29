#!/usr/bin/env node
/**
 * 「清扫输出失实文字」（EV-164）零配额验收（计划 r2 §4.3 B0～B11）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 审核者换成桩（`TRIVIUM_STUB_CRITIC`，`hang_cli` 以仓库的 run() 按 killTree 真实拉起 `sh -c 'sleep 600'`），不发起任何模型调用。
 * 收尾只删 mkdtemp 的返回值；残留进程按标记与组号结束。
 *
 * 新旧两份构建（照搬 evidence/cancel-wait-cli-admission-20260929/acceptance.mjs）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`（先 npm run build）；
 *   - 旧：`git archive` 固定提交（缺省 171e38c，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，展开进 mkdtemp，
 *     `node_modules` 软链工作树，**不叠加任何文件**（桩相对基线的 diff 进读数，非空即判失败），`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 * 新旧各跑一个独立夹具，主题名相同；比对前归一化：mkdtemp 根、夹具目录名里的 new / old、repoId 哈希、run_id、ISO 时间戳、
 * 三位以上的数字（pid、组号）。逐字不变的判法（计划 r2 §4.3）：归一化后逐行多重集差，允许差异**只有**两对——
 * 「旧提示行 ↔ 新提示行」（有第四格的 scrub 人读输出）与「旧动机句 ↔ 新动机句」（帮助），且只出现在该出现的格里。
 *
 *   B0  构建：sha256 不同；桩相对 171e38c 无 diff
 *   B1  --help、scrub --help、help、无参数：每条差恰为动机句一对、行数相等、退出码都是 0
 *   B2  worker 被强杀、两侧 hang_cli 仍活（A 格）→ scrub：差恰为提示行一对；新旧载体都在
 *   B3  同 B2 的现场、scrub --dry-run：差恰为提示行一对
 *   B4  另起一轮，两侧记录的 started_at 改成 null（C 格）→ scrub：差恰为提示行一对
 *   B5  另起一轮，glm 侧记录由本脚本写成常量 {"pgid":"not-a-number"}（D 格，CODEX-04）→ scrub：差恰为提示行一对
 *   B6  B2 的现场、scrub --json：归一化后逐字相同
 *   B7  B2 的现场、结束两组之后 → scrub：差为空；新旧载体都已抹
 *   B8  B2 的现场（结束两组之前）→ 会话启动 Hook：additionalContext 归一化后逐字相同（第四格不改，计划 r2 §2.3）
 *   B9  空运行根 → scrub：差为空
 *   B10 全部格的退出码新旧逐格相同
 *   B11 新构建 doctor --selftest
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
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '171e38c';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const TOPIC = '清扫文字验收';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

const HINT_NEW = '    CLI 结束后再跑会重判；「记录读不懂」不会自愈，需把该侧 cli 改回 null（到期整删也会保留它）';
const HINT_OLD = '    CLI 结束后再跑会重判；「记录读不懂」不会自愈，需把该侧 cli 改回 null 或等 run_dir_days 整删';
const MOTIVE_NEW = '      不再回到那个仓库时，副本会一直躺到 retention.run_dir_days 整删（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）。这条命令补那一格。';
const MOTIVE_OLD = '      不再回到那个仓库时，副本会一直躺到 retention.run_dir_days 整删。这条命令补那一格。';
const MALFORMED = { pgid: 'not-a-number' };

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

/** 改 status.json 两侧的 cli 记录（目标只在 mkdtemp 之下）；改写不经任何一份构建的代码 */
async function patchCli(base, runDir, fn) {
  if (!runDir.startsWith(base + path.sep)) throw new Error(`拒绝改 mkdtemp 之外的目录：${runDir}`);
  const sp = path.join(runDir, 'status.json');
  const s = await readJson(sp);
  fn(s.sides);
  await fs.writeFile(sp, JSON.stringify(s, null, 2) + '\n', 'utf8');
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
/** 差恰为一对（新 newLine ↔ 旧 oldLine） */
const exactlyPair = (d, newLine, oldLine) =>
  d.onlyNew.length === 1 && d.onlyOld.length === 1 && d.onlyNew[0] === newLine && d.onlyOld[0] === oldLine;
const empty = (d) => d.onlyNew.length === 0 && d.onlyOld.length === 0;
const both = (r) => r.stdout + r.stderr;
const lineCount = (s) => s.replace(/\n+$/, '').split('\n').length;

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

const codes = [];
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-ev164-'));
BASE = base;
try {
  // ── B0：构建 ──
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
  check('B0', readout.bundles.new.sha256 !== readout.bundles.old.sha256 && stubDiff === '',
    `新旧 bundle sha256 不同（new ${readout.bundles.new.sha256.slice(0, 12)} / old ${readout.bundles.old.sha256.slice(0, 12)}）；桩相对 ${BASE_REF} 无 diff ${stubDiff === ''}`);

  // ── B1：帮助的四条路由 ──
  {
    const parts = [];
    let ok = true;
    readout.B1 = {};
    for (const argv of [['--help'], ['scrub', '--help'], ['help'], []]) {
      const n = await cli(NEW, base, argv);
      const o = await cli(OLD, base, argv);
      const d = lineDiff(both(n), both(o));
      const key = argv.join(' ') || '（无参数）';
      const pair = exactlyPair(d, MOTIVE_NEW, MOTIVE_OLD);
      const sameLines = lineCount(n.stdout) === lineCount(o.stdout);
      readout.B1[key] = { code: [n.code, o.code], lines: [lineCount(n.stdout), lineCount(o.stdout)], diff: d };
      codes.push({ cell: `B1 ${key}`, new: n.code, old: o.code });
      ok &&= n.code === 0 && o.code === 0 && pair && sameLines;
      parts.push(`${key}：退出码 ${n.code}/${o.code}、行数 ${lineCount(n.stdout)}/${lineCount(o.stdout)}、差恰为动机句一对 ${pair}`);
    }
    check('B1', ok, parts.join('；'));
  }

  // ── B2 / B3 / B6 / B7 / B8：A 格（两侧 CLI 仍活）──
  const aCase = async (build) => {
    const o = await orphanedRun(build, base, `B2-${build.name}`);
    if (o.error) return o;
    const s1 = await cli(build, o.fx.root, ['scrub']);
    const carrier1 = await exists(o.carrier);
    const dry = await cli(build, o.fx.root, ['scrub', '--dry-run']);
    const js = await cli(build, o.fx.root, ['scrub', '--json']);
    const hook = await hookSessionStart(build, o.fx.root);
    const carrierAfterHook = await exists(o.carrier);
    const alive = o.groups.map((g) => members(g));
    const ended = await endGroups(o.groups);
    const s2 = await cli(build, o.fx.root, ['scrub']);
    const carrier2 = await exists(o.carrier);
    return { workerGone: o.workerGone, groups: o.groups, s1, carrier1, dry, js, hook, carrierAfterHook, alive, ended, s2, carrier2 };
  };
  const an = await aCase(NEW);
  const ao = await aCase(OLD);
  readout.A = { new: an, old: ao };
  if (an.error || ao.error) {
    check('B2', false, `现场没造出来：${an.error ?? ''}${ao.error ?? ''}`);
  } else {
    const d2 = lineDiff(both(an.s1), both(ao.s1));
    readout.B2 = d2;
    codes.push({ cell: 'B2', new: an.s1.code, old: ao.s1.code });
    check('B2', an.workerGone && ao.workerGone && an.alive.every((n) => n === 2) && ao.alive.every((n) => n === 2)
      && an.carrier1 && ao.carrier1 && exactlyPair(d2, HINT_NEW, HINT_OLD) && /因审查员 CLI 未动/.test(an.s1.stdout),
      `worker 已不在 ${an.workerGone}/${ao.workerGone}、两组仍活 ${JSON.stringify(an.alive)}/${JSON.stringify(ao.alive)}、载体都在 ${an.carrier1 && ao.carrier1}；` +
      `差恰为提示行一对 ${exactlyPair(d2, HINT_NEW, HINT_OLD)}（新有旧无 ${d2.onlyNew.length}、旧有新无 ${d2.onlyOld.length}）`);

    const d3 = lineDiff(both(an.dry), both(ao.dry));
    readout.B3 = d3;
    codes.push({ cell: 'B3', new: an.dry.code, old: ao.dry.code });
    check('B3', exactlyPair(d3, HINT_NEW, HINT_OLD) && /侧层本会抹/.test(an.dry.stdout),
      `--dry-run：差恰为提示行一对 ${exactlyPair(d3, HINT_NEW, HINT_OLD)}（新有旧无 ${d3.onlyNew.length}、旧有新无 ${d3.onlyOld.length}）`);

    const d6 = lineDiff(both(an.js), both(ao.js));
    readout.B6 = d6;
    codes.push({ cell: 'B6', new: an.js.code, old: ao.js.code });
    const keysN = Object.keys(jsonOf(an.js.stdout) ?? {});
    const keysO = Object.keys(jsonOf(ao.js.stdout) ?? {});
    check('B6', empty(d6) && keysN.length === 15 && JSON.stringify(keysN) === JSON.stringify(keysO),
      `--json：归一化后差为空 ${empty(d6)}；键 ${keysN.length} 个、新旧键序一致 ${JSON.stringify(keysN) === JSON.stringify(keysO)}`);

    const d7 = lineDiff(both(an.s2), both(ao.s2));
    readout.B7 = d7;
    codes.push({ cell: 'B7', new: an.s2.code, old: ao.s2.code });
    check('B7', empty(d7) && an.ended.every((n) => n === 0) && ao.ended.every((n) => n === 0) && !an.carrier2 && !ao.carrier2
      && !/因审查员 CLI 未动/.test(an.s2.stdout),
      `结束两组后 scrub：差为空 ${empty(d7)}、两组已空 ${JSON.stringify(an.ended)}/${JSON.stringify(ao.ended)}、载体都已抹 ${!an.carrier2 && !ao.carrier2}`);

    const d8 = lineDiff(an.hook.ctx, ao.hook.ctx);
    readout.B8 = d8;
    codes.push({ cell: 'B8', new: an.hook.code, old: ao.hook.code });
    check('B8', empty(d8) && /因审查员 CLI 进程组记录未动/.test(an.hook.ctx) && an.carrierAfterHook && ao.carrierAfterHook,
      `会话启动 Hook：第四格在 ${/因审查员 CLI 进程组记录未动/.test(an.hook.ctx)}、additionalContext 归一化后差为空 ${empty(d8)}、载体都在 ${an.carrierAfterHook && ao.carrierAfterHook}`);
  }

  // ── B4：C 格（判不了）──
  const cCase = async (build) => {
    const o = await orphanedRun(build, base, `B4-${build.name}`);
    if (o.error) return o;
    await patchCli(base, o.js.run_dir, (sides) => { for (const v of Object.values(sides)) v.cli.started_at = null; });
    const s = await cli(build, o.fx.root, ['scrub']);
    const carrier = await exists(o.carrier);
    const ended = await endGroups(o.groups);
    return { s, carrier, ended };
  };
  {
    const n = await cCase(NEW);
    const o = await cCase(OLD);
    const d = n.error || o.error ? null : lineDiff(both(n.s), both(o.s));
    readout.B4 = { new: n, old: o, diff: d };
    if (d) codes.push({ cell: 'B4', new: n.s.code, old: o.s.code });
    check('B4', !!d && exactlyPair(d, HINT_NEW, HINT_OLD) && /启动时刻没记下：判不了/.test(n.s.stdout) && n.carrier && o.carrier,
      d ? `判不了：第四格在 ${/启动时刻没记下：判不了/.test(n.s.stdout)}、载体都在 ${n.carrier && o.carrier}、差恰为提示行一对 ${exactlyPair(d, HINT_NEW, HINT_OLD)}（${d.onlyNew.length}+${d.onlyOld.length}）`
        : `现场没造出来：${n.error ?? ''}${o.error ?? ''}`);
  }

  // ── B5：D 格（记录读不懂，CODEX-04）──
  const dCase = async (build) => {
    const o = await orphanedRun(build, base, `B5-${build.name}`);
    if (o.error) return o;
    await patchCli(base, o.js.run_dir, (sides) => { sides.glm.cli = MALFORMED; });
    const s = await cli(build, o.fx.root, ['scrub']);
    const carrier = await exists(o.carrier);
    const ended = await endGroups(o.groups);
    return { s, carrier, ended };
  };
  {
    const n = await dCase(NEW);
    const o = await dCase(OLD);
    const d = n.error || o.error ? null : lineDiff(both(n.s), both(o.s));
    const want = `CLI 记录读不懂（glm：${JSON.stringify(MALFORMED)}）：判不了`;
    readout.B5 = { new: n, old: o, diff: d };
    if (d) codes.push({ cell: 'B5', new: n.s.code, old: o.s.code });
    check('B5', !!d && exactlyPair(d, HINT_NEW, HINT_OLD) && n.s.stdout.includes(want) && o.s.stdout.includes(want) && n.carrier && o.carrier,
      d ? `读不懂：原始值逐字在新旧输出里 ${n.s.stdout.includes(want) && o.s.stdout.includes(want)}、载体都在 ${n.carrier && o.carrier}、差恰为提示行一对 ${exactlyPair(d, HINT_NEW, HINT_OLD)}（${d.onlyNew.length}+${d.onlyOld.length}）`
        : `现场没造出来：${n.error ?? ''}${o.error ?? ''}`);
  }

  // ── B9：空运行根 ──
  {
    const n = await cli(NEW, (await fixture(base, 'B9-new')).root, ['scrub']);
    const o = await cli(OLD, (await fixture(base, 'B9-old')).root, ['scrub']);
    const d = lineDiff(both(n), both(o));
    readout.B9 = { new: n, old: o, diff: d };
    codes.push({ cell: 'B9', new: n.code, old: o.code });
    check('B9', empty(d), `空运行根：差为空 ${empty(d)}、退出码 ${n.code}/${o.code}`);
  }

  // ── B10：退出码 ──
  readout.B10 = codes;
  check('B10', codes.length > 0 && codes.every((c) => c.new === c.old),
    `${codes.length} 格新旧退出码逐格相同 ${codes.every((c) => c.new === c.old)}（${codes.map((c) => `${c.cell} ${c.new}/${c.old}`).join('，')}）`);

  // ── B11：doctor 自检 ──
  {
    const d = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(d.stdout + d.stderr);
    readout.B11 = { code: d.code, tail: (d.stdout + d.stderr).trim().split('\n').slice(-6) };
    check('B11', d.code === 0 && !!m && m[1] === m[2], `doctor --selftest 退 ${d.code}、${m ? `${m[1]}/${m[2]}` : '（没读到计数）'}`);
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
