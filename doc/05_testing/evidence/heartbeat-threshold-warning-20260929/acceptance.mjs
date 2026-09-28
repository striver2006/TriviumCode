#!/usr/bin/env node
/**
 * 「心跳阈值事前告警」（EV-160）零配额验收（计划 r2 §6.4 A0～A7，另加 A8 doctor 自检）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用；预检一律 `--skip-auth-check`，探针结论是种进去的假 CLI。
 * 收尾只删 mkdtemp 的返回值；残留进程按 run_id 标记与组号结束。
 *
 * 新旧两份构建（沿用上一主题做法）：
 *   - 新：工作树 `skills/dual-critic/scripts/trivium.cjs`；
 *   - 旧：`git archive` 固定提交（缺省 4097aaa，ACCEPT_BASE_REF 可覆盖，不写 HEAD）+ `.reviews/`，
 *     `node_modules` 软链工作树，不叠加任何文件（桩相对基线的 diff 进读数，非空即判失败），`node scripts/build.mjs`；
 *   - 两份都 `node <bundle>` 直接调；记 sha256 并断言不同。
 *
 * 归一化（计划 r2 §6.4，GLM-02）：夹具根与运行根 → 占位、run_id、ISO 时间戳、pid、`已 N s 未更新` 的相对时长。
 *
 *   A0 同一构建（新）、120 s，预检连跑两次 ⇒ JSON 逐字相同（比对基线确定，CODEX-01）
 *   A1 2 s 预检：新多出「失联阈值」（checks 与 warnings 各一项），删掉之后新旧 JSON 逐字相同，退出码同为 0
 *   A2 120 s 预检：新旧 JSON 与退出码逐字相同
 *   A3 2 s `--start --json`（桩 hang，随后 `--cancel`）：新 warnings 恰一项、旧 []；其余键归一化后相同；退出码同为 0；`--cancel` 输出归一化后相同
 *   A4 120 s 同上：归一化后逐字相同
 *   A5 2 s `--start` → 3 s 后 `--wait` 判失联：新旧报错正文（含「判定依据」行与「阈值不大于心跳间隔」那一句）归一化后逐字相同、退出码相同
 *   A6 边界：30 s 与 30.5 s 的预检——新 30 出、30.5 不出；旧都不出
 *   A7 2 s 同步 `review --stage`：新旧 stdout / stderr 归一化后逐字相同，都不含「失联阈值」
 *   A8 新构建 doctor --selftest
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
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '4097aaa';
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
// 探针夹具与集成测试共用一份（test/helpers/fixture.ts，代码双审 r1 CODEX-02）；三侧都塞，缺一侧 ① 就失败
const { seedFakeProbes } = await imp(path.join(ROOT, 'dist/test/test/helpers/fixture.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const NAME = '失联阈值';
const NEW = { name: 'new', cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') };
if (!existsSync(NEW.cli)) throw new Error(`找不到：${NEW.cli}`);

const results = [];
const readout = { base_ref: BASE_REF, node: process.version, platform: process.platform };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
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
const envFor = (build, stub) => ({ TRIVIUM_ASSET_ROOT: build.asset, [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : '', CLAUDE_SESSION_ID: SESSION });
const cli = (build, cwd, args, stub = null) => sh(cwd, process.execPath, [build.cli, ...args], envFor(build, stub));

function psRows() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,ppid=,command='], { encoding: 'utf8' });
  const rows = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) rows.push({ pid: +m[1], pgid: +m[2], ppid: +m[3], cmd: m[4] });
  }
  return rows;
}
const killGroup = (g) => { if (g > 1) try { process.kill(-g, 'SIGKILL'); } catch { /* 已不在 */ } };
const runIds = new Set();

/** 一个夹具 = 一个 git 仓 + 配置（阈值可调）+ 待审计划；`probes` 为真时种新鲜探针（假 CLI 用真文件） */
async function fixture(base, name, staleS, probes = false) {
  const root = path.join(base, name);
  const topic = '阈值验收';
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  const runRoot = path.join(base, 'runs-' + name);
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${runRoot}`,
    'review:', '  default_critics: [gemini, glm]', `  heartbeat_stale_s: ${staleS}`,
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  if (probes) await seedFakeProbes(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n验收。\n');
  return { root, topic, runRoot };
}

/** 归一化：夹具根 / 运行根 / run_id / 时间戳 / pid / 相对时长 */
function norm(text, fx) {
  let t = String(text ?? '');
  if (fx) {
    t = t.split(fx.root).join('〈ROOT〉').split(fx.runRoot).join('〈RUNROOT〉');
    const real = (p) => { try { return execFileSync('/bin/realpath', [p], { encoding: 'utf8' }).trim(); } catch { return p; } };
    t = t.split(real(fx.root)).join('〈ROOT〉');
  }
  return t
    .replace(/\d{8}T\d{6}Z(?:-\d+)?/g, '〈RUN〉')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '〈TS〉')
    .replace(/已 \d+ s 未更新/g, '已 N s 未更新')
    // 运行根下按仓库分的子目录是「目录名-路径哈希」（repoId），新旧夹具目录名不同（r0 读数的假红之一）
    .replace(/〈RUNROOT〉\/[^/"\s]+-[0-9a-f]{8}\//g, '〈RUNROOT〉/〈REPO〉/')
    // 「向工作进程组 N」也是 pid（r0 读数的假红之二）
    .replace(/(工作进程组?|pid|worker_pid"?:?)\s*\d+/g, '$1 〈PID〉')
    .replace(/"worker_pid": \d+/g, '"worker_pid": 〈PID〉');
}

const preflightArgs = ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'];
const dropItem = (js) => ({ ...js, checks: js.checks.filter((c) => c.name !== NAME), warnings: js.warnings.filter((w) => w.name !== NAME) });
const hasItem = (js) => !!js && js.checks.some((c) => c.name === NAME) && js.warnings.some((w) => w.name === NAME);

async function startHang(build, fx) {
  const r = await cli(build, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'],
    { gemini: { mode: 'hang' }, glm: { mode: 'hang' } });
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_id) runIds.add(js.run_id);
  return { r, js };
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-hb-threshold-'));
const hangs = [];
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

  // ── A0：比对基线确定 ──
  {
    const fx = await fixture(base, 'A0', 120, true);
    const p1 = await cli(NEW, fx.root, preflightArgs);
    const p2 = await cli(NEW, fx.root, preflightArgs);
    readout.A0 = { codes: [p1.code, p2.code], same: p1.stdout === p2.stdout, json: jsonOf(p1.stdout) };
    check('A0', p1.code === 0 && p2.code === 0 && p1.stdout === p2.stdout && jsonOf(p1.stdout)?.ok === true,
      `新构建 120 s 预检连跑两次：退 ${p1.code}/${p2.code}，stdout 逐字相同 ${p1.stdout === p2.stdout}`);
  }

  // ── A1 / A2 / A6：预检（新旧跑同一个夹具，预检不写盘，路径天然一致）──
  const pre = async (id, staleS) => {
    const fx = await fixture(base, id, staleS, true);
    const n = await cli(NEW, fx.root, preflightArgs);
    const o = await cli(OLD, fx.root, preflightArgs);
    return { fx, n, o, nj: jsonOf(n.stdout), oj: jsonOf(o.stdout) };
  };
  {
    const { n, o, nj, oj } = await pre('A1', 2);
    const same = !!nj && !!oj && JSON.stringify(dropItem(nj)) === JSON.stringify(oj);
    readout.A1 = { codes: [n.code, o.code], newWarnings: nj?.warnings, oldWarnings: oj?.warnings, sameAfterDrop: same, newItem: nj?.checks.find((c) => c.name === NAME) ?? null };
    check('A1', n.code === 0 && o.code === 0 && hasItem(nj) && !hasItem(oj) && nj.checks.length === oj.checks.length + 1 && same,
      `2 s 预检：退 ${n.code}/${o.code}；新有「${NAME}」${hasItem(nj)}、旧没有 ${!hasItem(oj)}；删掉这一项后新旧 JSON 逐字相同 ${same}`);
  }
  {
    const { n, o } = await pre('A2', 120);
    readout.A2 = { codes: [n.code, o.code], same: n.stdout === o.stdout };
    check('A2', n.code === 0 && o.code === 0 && n.stdout === o.stdout, `120 s 预检：退 ${n.code}/${o.code}，新旧 stdout 逐字相同 ${n.stdout === o.stdout}`);
  }
  {
    const eq = await pre('A6-30', 30);
    const gt = await pre('A6-30_5', 30.5);
    readout.A6 = {
      at30: { newItem: hasItem(eq.nj), oldItem: hasItem(eq.oj), codes: [eq.n.code, eq.o.code] },
      at30_5: { newItem: hasItem(gt.nj), oldItem: hasItem(gt.oj), codes: [gt.n.code, gt.o.code], same: gt.n.stdout === gt.o.stdout },
    };
    check('A6', hasItem(eq.nj) && !hasItem(eq.oj) && !hasItem(gt.nj) && !hasItem(gt.oj) && gt.n.stdout === gt.o.stdout
      && [eq.n.code, eq.o.code, gt.n.code, gt.o.code].every((c) => c === 0),
      `边界：30 s 新出 ${hasItem(eq.nj)}、旧不出 ${!hasItem(eq.oj)}；30.5 s 新旧都不出且 stdout 逐字相同 ${gt.n.stdout === gt.o.stdout}`);
  }

  // ── A3 / A4：--start --json（桩 hang），随后 --cancel ──
  const startCase = async (id, staleS) => {
    const fxN = await fixture(base, `${id}-new`, staleS);
    const fxO = await fixture(base, `${id}-old`, staleS);
    const sN = await startHang(NEW, fxN);
    const sO = await startHang(OLD, fxO);
    hangs.push(sN, sO);
    const cN = sN.js ? await cli(NEW, fxN.root, ['review', '--cancel', sN.js.run_id]) : null;
    const cO = sO.js ? await cli(OLD, fxO.root, ['review', '--cancel', sO.js.run_id]) : null;
    const strip = (js, fx) => js && norm(JSON.stringify({ ...js, warnings: undefined }), fx);
    return {
      codes: [sN.r.code, sO.r.code], cancelCodes: [cN?.code, cO?.code],
      newWarnings: sN.js?.warnings, oldWarnings: sO.js?.warnings,
      restSame: strip(sN.js, fxN) === strip(sO.js, fxO),
      startStderrSame: norm(sN.r.stderr, fxN) === norm(sO.r.stderr, fxO),
      cancelSame: !!cN && !!cO && norm(cN.stdout, fxN) === norm(cO.stdout, fxO) && norm(cN.stderr, fxN) === norm(cO.stderr, fxO),
      diffs: {
        start: [strip(sN.js, fxN), strip(sO.js, fxO)],
        startStderr: [norm(sN.r.stderr, fxN), norm(sO.r.stderr, fxO)],
        cancel: [norm((cN?.stdout ?? '') + (cN?.stderr ?? ''), fxN), norm((cO?.stdout ?? '') + (cO?.stderr ?? ''), fxO)],
      },
    };
  };
  {
    const r = await startCase('A3', 2);
    readout.A3 = r;
    const nw = r.newWarnings ?? [];
    check('A3', r.codes.every((c) => c === 0) && r.cancelCodes.every((c) => c === 0) && nw.length === 1 && nw[0].name === NAME
      && JSON.stringify(r.oldWarnings) === '[]' && r.restSame && r.startStderrSame && r.cancelSame,
      `2 s --start：退 ${r.codes.join('/')}；新 warnings ${nw.map((w) => w.name).join('、')}、旧 ${JSON.stringify(r.oldWarnings)}；` +
        `其余键归一化后相同 ${r.restSame}；--start stderr 相同 ${r.startStderrSame}；--cancel 退 ${r.cancelCodes.join('/')}、输出相同 ${r.cancelSame}`);
  }
  {
    const r = await startCase('A4', 120);
    readout.A4 = r;
    check('A4', r.codes.every((c) => c === 0) && r.cancelCodes.every((c) => c === 0) && JSON.stringify(r.newWarnings) === '[]'
      && JSON.stringify(r.oldWarnings) === '[]' && r.restSame && r.startStderrSame && r.cancelSame,
      `120 s --start：退 ${r.codes.join('/')}；新旧 warnings 都是 []；其余键相同 ${r.restSame}；stderr 相同 ${r.startStderrSame}；--cancel 输出相同 ${r.cancelSame}`);
  }

  // ── A5：2 s --start → 3 s 后 --wait 判失联：报错正文新旧相同 ──
  {
    const fxN = await fixture(base, 'A5-new', 2);
    const fxO = await fixture(base, 'A5-old', 2);
    const sN = await startHang(NEW, fxN);
    const sO = await startHang(OLD, fxO);
    hangs.push(sN, sO);
    await sleep(3000);
    const wN = await cli(NEW, fxN.root, ['review', '--wait', sN.js.run_id, '--timeout', '5']);
    const wO = await cli(OLD, fxO.root, ['review', '--wait', sO.js.run_id, '--timeout', '5']);
    const eN = norm(wN.stdout + wN.stderr, fxN);
    const eO = norm(wO.stdout + wO.stderr, fxO);
    readout.A5 = { codes: [wN.code, wO.code], same: eN === eO, new: eN, old: eO };
    check('A5', wN.code === wO.code && wN.code !== 0 && eN === eO && /判定依据/.test(eN) && /阈值不大于心跳间隔：健康的工作进程也会被判失联/.test(eN),
      `--wait 判失联：退 ${wN.code}/${wO.code}；报错含判定依据与「阈值不大于心跳间隔」那一句；归一化后新旧逐字相同 ${eN === eO}`);
  }

  // ── A7：同步 review --stage ──
  {
    const stub = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
    const fxN = await fixture(base, 'A7-new', 2);
    const fxO = await fixture(base, 'A7-old', 2);
    const args = (fx) => ['review', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--critics', 'gemini', '--session-id', SESSION, '--json'];
    const rN = await cli(NEW, fxN.root, args(fxN), stub);
    const rO = await cli(OLD, fxO.root, args(fxO), stub);
    const oN = norm(rN.stdout, fxN); const oO = norm(rO.stdout, fxO);
    const dN = norm(rN.stderr, fxN); const dO = norm(rO.stderr, fxO);
    readout.A7 = { codes: [rN.code, rO.code], stdoutSame: oN === oO, stderrSame: dN === dO, diffs: oN === oO && dN === dO ? null : { stdout: [oN, oO], stderr: [dN, dO] } };
    check('A7', rN.code === 0 && rO.code === 0 && oN === oO && dN === dO && !(rN.stdout + rN.stderr).includes(NAME),
      `同步 review：退 ${rN.code}/${rO.code}；stdout 相同 ${oN === oO}、stderr 相同 ${dN === dO}；新构建输出不含「${NAME}」`);
  }

  // ── A8：doctor 自检 ──
  {
    const d = await sh(ROOT, process.execPath, [NEW.cli, 'doctor', '--selftest'], { TRIVIUM_ASSET_ROOT: NEW.asset });
    const m = /(\d+)\s*\/\s*(\d+)/.exec(d.stdout + d.stderr);
    readout.A8 = { code: d.code, tail: (d.stdout + d.stderr).trim().split('\n').slice(-6) };
    check('A8', d.code === 0 && !!m && m[1] === m[2], `doctor --selftest 退 ${d.code}、${m ? `${m[1]}/${m[2]}` : '（没读到计数）'}`);
  }
} finally {
  for (const h of hangs) if (h.js?.worker_pid) killGroup(h.js.worker_pid);
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) killGroup(r.pgid);
  await sleep(300);
  const left = [];
  for (const id of runIds) for (const r of psRows()) if (r.cmd.includes(`--worker ${id}`)) left.push(r.pgid);
  readout.leftover_groups = left;
  await fs.rm(base, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass} / ${results.length}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ results, readout }, null, 2) + '\n');
process.exit(pass === results.length ? 0 : 1);
