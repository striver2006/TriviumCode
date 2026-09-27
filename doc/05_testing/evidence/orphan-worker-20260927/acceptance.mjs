#!/usr/bin/env node
/**
 * 「派生后失败的孤儿worker」零配额验收（计划 r2 §4.4 A1～A7）。
 *
 * **不碰真实 HOME、不改本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用。夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 收尾只删 mkdtemp 的返回值，并按本脚本观测到的 run_id 结束残留 worker。本仓归档只读（A6）。
 *
 *   A1 hang 桩派生后失败（写 worker.pid EISDIR）⇒ run.json / 登记 failed + post_spawn_exception、闸门 idle、锁已放、
 *      status.json failed 有 pid、进程表里没有该 run_id 的 worker；--wait 按终态返回、--cancel 说已处于终态、run.json 不再被改
 *   A2 ok 桩派生后失败 ⇒ 3 秒后闸门仍 idle、run.json 仍 failed、没有审查文档（今天孤儿会跑完并改写）
 *   A3 A1 之后隔 1.1 s 正常 --start ⇒ 只有一个 worker、正常跑完；report 时间线与未进时间线表（读数以实际为准）
 *   A4 A1 之后会话启动 Hook ⇒ 不再有指向那次失败运行的「运行目录的状态读不到」「双审进行中」提示
 *   A5 杀法够不到 killTree 拉起的 CLI（计划 r2 §2.1 K1）重跑一遍，读数不变（本主题不改那一格的行为）
 *   A6 本仓归档只读：新旧两份构建逐主题 buildTopicReport，rounds 与 unlistedRuns 逐主题深相等
 *   A7 回滚演练（计划 r2 §6.3，计划双审 r1 CODEX-03）：ACCEPT_BASE_REF（缺省 e49279a）原样构建 vs 叠上本主题「取值面」的构建；
 *      后者 run-meta-strict / report 两个套件须全绿，读同一份 post_spawn_exception 的 run.json：前者 null、判 corrupt，后者可读、有专门说明
 *
 * 旧构建基线用固定提交（缺省 e49279a，可由 ACCEPT_BASE_REF 覆盖），不写 HEAD。
 * 用法（在仓库根）：node acceptance.mjs <探针 probe-kill-reach.mjs 路径> [输出 JSON 路径]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const PROBE = path.resolve(process.argv[2] ?? '');
const OUT = process.argv[3] ?? null;
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
if (!existsSync(CLI)) throw new Error(`找不到仓库构建的 CLI：${CLI}（先 npm run build）`);
if (!existsSync(PROBE)) throw new Error(`找不到探针：${PROBE}`);
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const { repoId } = await imp(path.join(ROOT, 'dist/test/src/trivium/review.js'));
const { newRunId } = await imp(path.join(ROOT, 'dist/test/src/trivium/meta.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const STATE = 'state' + '.json';
const TASK = 'task' + '.json';
const BASE_REF = process.env.ACCEPT_BASE_REF ?? 'e49279a';
const LABEL = '派生工作进程之后启动未完成，工作进程已终止（退出码 1）';

const results = [];
const readout = {};
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
async function hookSessionStart(cwd) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'gate', 'hook-session-start'], {
      cwd, env: { ...process.env, TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), CLAUDE_SESSION_ID: SESSION },
    });
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', () => {});
    p.on('close', (code) => resolve({ code, ctx: jsonOf(stdout)?.hookSpecificOutput?.additionalContext ?? '' }));
    p.stdin.end(JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }));
  });
}
const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
const HANG = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };
const envFor = (stub) => ({ TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: encodeStubConfig(stub), CLAUDE_SESSION_ID: SESSION });
const cli = (cwd, args, stub = OK) => sh(cwd, process.execPath, [CLI, ...args], envFor(stub));
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已不在 */ } } };
const seenRunIds = new Set();
const ls = async (d) => (await fs.readdir(d).catch(() => [])).sort();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
async function start(fx, stub = OK) {
  const r = await cli(fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub);
  const js = r.code === 0 ? jsonOf(r.stdout) : null;
  if (js?.run_id) seenRunIds.add(js.run_id);
  return { r, runId: js?.run_id ?? null, workerPid: js?.worker_pid ?? null };
}
async function waitDone(fx, runId, stub = OK) {
  let w;
  for (let i = 0; i < 10; i++) {
    w = await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], stub);
    if (w.code !== 73) break;
  }
  return w;
}
async function runMetas(stageDir) {
  const o = {};
  for (const n of await ls(path.join(stageDir, '_meta'))) {
    const id = /^run-(.+)\.json$/.exec(n)?.[1];
    if (!id) continue;
    seenRunIds.add(id);
    o[id] = await readJson(path.join(stageDir, '_meta', n)).catch(() => null);
  }
  return o;
}
const runFile = (fx, id) => path.join(fx.stageDir, '_meta', `run-${id}.json`);
async function taskRuns(fx) {
  const t = await readJson(path.join(fx.topicDir, TASK)).catch(() => null);
  return t?.runs?.map((r) => ({ run_id: r.run_id, status: r.status })) ?? null;
}
async function gateOf(fx) {
  const s = await readJson(path.join(fx.root, TD, STATE)).catch(() => null);
  return s?.gates?.[`${fx.topic}/plan`] ?? null;
}
const locks = async (fx) => (await ls(path.join(fx.root, TD, 'lock'))).filter((n) => n.endsWith('.lock'));
async function report(fx) {
  const r = await cli(fx.root, ['report', '--topic', fx.topic, '--json']);
  const j = jsonOf(r.stdout);
  return {
    rounds: (j?.rounds ?? []).map((x) => ({ r: x.rerunIndex, runId: x.runId })),
    unlisted: (j?.unlistedRuns ?? []).map((x) => ({ r: x.rerunIndex, runId: x.runId, label: x.label })),
  };
}
/** 预建从现在起 60 秒内每一秒可能用到的运行目录（项目根原样与 realpath 两种写法各一份） */
async function precreate(fx, prep) {
  const repos = new Set([repoId(fx.root), repoId(await fs.realpath(fx.root))]);
  const dirs = [];
  const ids = new Set();
  const t0 = Date.now();
  for (const repo of repos) {
    for (let i = 0; i < 60; i++) {
      const id = newRunId(new Date(t0 + i * 1000));
      ids.add(id);
      const d = path.join(fx.runRoot, repo, id);
      await fs.mkdir(d, { recursive: true });
      await prep(d);
      dirs.push(d);
    }
  }
  return { ids, dirs };
}
const onlyRun = async (fx) => {
  const ms = await runMetas(fx.stageDir);
  const ids = Object.keys(ms);
  return ids.length === 1 ? { id: ids[0], meta: ms[ids[0]] } : { id: null, meta: null, all: ids };
};
const isPost = (m, code = 1) => m?.status === 'failed' && m?.gate?.state === 'failed' && eq(m?.termination, { by: 'post_spawn_exception', exit_code: code });
async function statusJson(fx, runId) {
  for (const repo of await ls(fx.runRoot)) {
    const j = await readJson(path.join(fx.runRoot, repo, runId, 'status.json')).catch(() => null);
    if (j) return j;
  }
  return null;
}
async function workersOf(base, ids) {
  const ps = await sh(base, 'ps', ['-axo', 'pid=,command=']);
  return ps.stdout.split('\n').map((l) => ({ pid: Number.parseInt(l.trim(), 10), id: /review --worker (\S+)/.exec(l)?.[1] })).filter((x) => x.id && ids.has(x.id));
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-orphan-'));
try {
  // ── A1 / A4 / A3（同一夹具，依次）──
  {
    const fx = await fixture(base, 'A1-诞生之后失败-hang');
    const { ids, dirs } = await precreate(fx, (d) => fs.mkdir(path.join(d, 'worker.pid')));
    const s = await start(fx, HANG);
    const { id, meta, all } = await onlyRun(fx);
    const hit = id !== null && ids.has(id);
    const st = id ? await statusJson(fx, id) : null;
    const workers = await workersOf(base, ids);
    const before = id ? await fs.readFile(runFile(fx, id), 'utf8') : null;
    const w = id ? await cli(fx.root, ['review', '--wait', id, '--timeout', '6'], HANG) : null;
    const c = id ? await cli(fx.root, ['review', '--cancel', id], HANG) : null;
    const after = id ? await fs.readFile(runFile(fx, id), 'utf8') : null;
    readout.A1 = {
      startCode: s.r.code, hit, all, stderrTail: s.r.stderr.split('\n').filter(Boolean).slice(-5),
      status: meta?.status, termination: meta?.termination, task: await taskRuns(fx), gate: (await gateOf(fx))?.state,
      locks: await locks(fx), statusJson: st && { phase: st.phase, worker_pid: st.worker_pid, message: st.message },
      workers, wait: w && { code: w.code, tail: `${w.stdout}${w.stderr}`.split('\n').filter(Boolean).slice(-2) },
      cancel: c && { code: c.code, tail: `${c.stdout}${c.stderr}`.split('\n').filter(Boolean).slice(-2) },
    };
    check('A1 hang 桩派生后失败 ⇒ run.json 与登记 failed + post_spawn_exception', hit && s.r.code !== 0 && isPost(meta) && eq((await taskRuns(fx))?.map((t) => t.status), ['failed']), hit ? `退 ${s.r.code}，run ${meta?.status} ${JSON.stringify(meta?.termination)}` : `预建窗口未命中：${JSON.stringify(all)}`);
    check('A1 闸门 idle、锁已放、status.json failed 且有 pid', (await gateOf(fx))?.state === 'idle' && (await locks(fx)).length === 0 && st?.phase === 'failed' && Number.isInteger(st?.worker_pid), `闸门 ${(await gateOf(fx))?.state}，锁 ${(await locks(fx)).join(',') || '无'}，status ${st?.phase}/${st?.worker_pid}`);
    check('A1 进程表里没有该 run_id 的 worker（今天会留一个孤儿）', workers.length === 0, JSON.stringify(workers));
    check('A1 --wait 按终态返回（退 1、不说失联）、--cancel 说已处于终态、run.json 不再被改', w?.code === 1 && !/失联/.test(`${w?.stdout}${w?.stderr}`) && /已处于终态/.test(`${c?.stdout}${c?.stderr}`) && before === after, `--wait 退 ${w?.code}，--cancel 退 ${c?.code}，run.json ${before === after ? '不变' : '变了'}`);

    // A4：会话启动。先撤掉构造本身留下的东西（第 1 次跑时它们各冒出一行提示，读数留 acceptance-readout.r0.json）：
    // 没用上的 59 个预建运行目录（「状态读不到」）与用上的那个目录里人为放进去的 worker.pid 目录（凭据清扫读它 EISDIR）。
    // 真实失败里二者都不存在。
    for (const d of dirs) if (path.basename(d) !== id) await fs.rm(d, { recursive: true, force: true });
    for (const repo of await ls(fx.runRoot)) {
      const p = path.join(fx.runRoot, repo, id ?? '', 'worker.pid');
      if (id && (await fs.stat(p).catch(() => null))?.isDirectory()) await fs.rm(p, { recursive: true, force: true });
    }
    const ss = await hookSessionStart(fx.root);
    readout.A4 = { ctx: ss.ctx };
    check('A4 会话启动不再有指向那次失败运行的「状态读不到」「双审进行中」「抹除失败」提示', !/运行目录的状态读不到/.test(ss.ctx) && !/双审进行中/.test(ss.ctx) && !/抹除失败/.test(ss.ctx), ss.ctx.split('\n').filter(Boolean).slice(0, 3).join(' ｜ ') || '（无提示）');

    // A3：之后正常重跑（预建目录已在 A4 之前撤掉）
    await sleep(1100);
    const s2 = await start(fx, OK);
    const concurrent = await workersOf(base, new Set([...(id ? [id] : []), ...(s2.runId ? [s2.runId] : [])]));
    const w2 = s2.runId ? await waitDone(fx, s2.runId) : null;
    const rep = await report(fx);
    readout.A3 = { startCode: s2.r.code, runId: s2.runId, workersRightAfterStart: concurrent, waitCode: w2?.code, rounds: rep.rounds, unlisted: rep.unlisted };
    check('A3 正常重跑 ⇒ 退 0、只有新一轮的 worker、跑完退 0', s2.r.code === 0 && concurrent.every((x) => x.id === s2.runId) && w2?.code === 0, `start 退 ${s2.r.code}，worker ${JSON.stringify(concurrent)}，--wait 退 ${w2?.code}`);
    check('A3 report：时间线只列新一轮，未进时间线表一行本主题说明', eq(rep.rounds.map((x) => x.runId), [s2.runId]) && rep.unlisted.length === 1 && rep.unlisted[0].runId === id && rep.unlisted[0].label === LABEL, `${JSON.stringify(rep.rounds)} ｜ ${JSON.stringify(rep.unlisted)}`);
  }

  // ── A2 ──
  {
    const fx = await fixture(base, 'A2-诞生之后失败-ok');
    const { ids } = await precreate(fx, (d) => fs.mkdir(path.join(d, 'worker.pid')));
    const s = await start(fx, OK);
    const { id, meta: m0 } = await onlyRun(fx);
    await sleep(3000);
    const m = id ? (await runMetas(fx.stageDir))[id] : null;
    const docs = (await ls(fx.stageDir)).filter((n) => n.endsWith('.md'));
    readout.A2 = { startCode: s.r.code, hit: id !== null && ids.has(id), rightAfter: m0?.status, after3s: m && { status: m.status, termination: m.termination }, gate: await gateOf(fx), docs };
    check('A2 ok 桩派生后失败 ⇒ 3 秒后闸门仍 idle、run.json 仍 failed、没有审查文档', id !== null && ids.has(id) && s.r.code !== 0 && isPost(m) && (await gateOf(fx))?.state === 'idle' && docs.length === 1, `run ${m?.status}，闸门 ${(await gateOf(fx))?.state}，文档 ${docs.join(',')}`);
  }

  // ── A5：K1 重跑 ──
  {
    const r = await sh(ROOT, process.execPath, [PROBE, ROOT]);
    const j = jsonOf(r.stdout);
    readout.A5 = j && { before: j.K1_before, after: j.K1_after, k2: j.K2_afterKill };
    check('A5 按 worker 进程组发 SIGTERM 仍够不到 killTree 拉起的子进程（如实保留，EV-152）', j?.K1_after?.workerAlive === false && j?.K1_after?.treeChildAlive === true && j?.K1_after?.plainChildAlive === false, JSON.stringify(j?.K1_after ?? r.stderr.slice(0, 200)));
  }

  // ── 旧构建（A6 / A7 共用）──
  const VALUE_FACE = [
    'skills/dual-critic/schema/run.v2.json',
    'src/trivium/types.ts',
    'src/trivium/report.ts',
    'test/unit/run-meta-strict.test.ts',
    'test/unit/report.test.ts',
  ];
  async function buildAt(dir, overlay) {
    await fs.mkdir(dir, { recursive: true });
    const tarPath = path.join(base, `${path.basename(dir)}.tar`);
    // 带上 .reviews：run-meta-strict 的「收严回归锁」两条读本仓真实留痕，第 1 次跑没带它就红了（读数留 .r0）
    const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', tarPath, BASE_REF, 'src', 'scripts', 'skills', 'skills-src', 'test', '.reviews', 'package.json', 'tsconfig.json']);
    if (ar.code !== 0) throw new Error(`git archive 失败：${ar.stderr}`);
    const ex = await sh(dir, 'tar', ['-xf', tarPath]);
    if (ex.code !== 0) throw new Error(`解包失败：${ex.stderr}`);
    for (const rel of overlay) await fs.copyFile(path.join(ROOT, rel), path.join(dir, rel));
    await fs.symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const b = await sh(dir, process.execPath, ['scripts/build.mjs', '--with-tests']);
    if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  }
  const oldPure = path.join(base, 'old-pure');
  const oldFace = path.join(base, 'old-with-value-face');
  await buildAt(oldPure, []);
  await buildAt(oldFace, VALUE_FACE);

  // ── A6 ──
  {
    const oldReport = await imp(path.join(oldPure, 'dist/test/src/trivium/report.js'));
    const newReport = await imp(path.join(ROOT, 'dist/test/src/trivium/report.js'));
    const archiveRoot = path.join(ROOT, '.reviews');
    const origErr = console.error;
    console.error = () => {};
    const diffs = [];
    let topics = 0;
    try {
      for (const topic of (await fs.readdir(archiveRoot)).sort()) {
        if (topic.startsWith('.') || !(await fs.stat(path.join(archiveRoot, topic))).isDirectory()) continue;
        topics++;
        const o = await oldReport.buildTopicReport({ archiveRoot, topic });
        const n = await newReport.buildTopicReport({ archiveRoot, topic });
        if (!eq(o.rounds, n.rounds) || !eq(o.unlistedRuns, n.unlistedRuns)) diffs.push(topic);
      }
    } finally {
      console.error = origErr;
    }
    readout.A6 = { baseRef: BASE_REF, topics, diffs };
    check('A6 本仓 report 逐主题不变', diffs.length === 0, `基线 ${BASE_REF}，${topics} 个主题，rounds / unlistedRuns 不同的：${diffs.join('、') || '无'}`);
  }

  // ── A7 ──
  {
    const suites = await sh(oldFace, process.execPath, ['--test', 'dist/test/test/unit/run-meta-strict.test.js', 'dist/test/test/unit/report.test.js']);
    const failN = Number(/ℹ fail (\d+)/.exec(suites.stdout)?.[1] ?? -1);
    const passN = Number(/ℹ pass (\d+)/.exec(suites.stdout)?.[1] ?? -1);
    const newMeta = await imp(path.join(ROOT, 'dist/test/src/trivium/meta.js'));
    const layout = { archiveRoot: path.join(base, 'a7-archive'), topic: 'A7-回滚演练' };
    const m = newMeta.newRunMeta({
      runId: '20260927T000000Z', topic: layout.topic, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
      criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
    });
    m.status = 'failed';
    m.gate.state = 'failed';
    m.finished_at = new Date().toISOString();
    m.termination = { by: 'post_spawn_exception', exit_code: 1 };
    await newMeta.writeRunMeta(layout, 'plan', m);
    const probe = async (dir) => {
      const meta = await imp(path.join(dir, 'dist/test/src/trivium/meta.js'));
      const claim = await imp(path.join(dir, 'dist/test/src/trivium/driver-claim.js'));
      const rep = await imp(path.join(dir, 'dist/test/src/trivium/report.js'));
      const origErr = console.error;
      console.error = () => {};
      try {
        const read = await meta.readRunMeta(layout, 'plan', '20260927T000000Z');
        const drv = await claim.resolveStageDriver(layout, 'plan');
        const r = await rep.buildTopicReport(layout);
        return { readable: read !== null, driver: drv.kind === 'ok' ? `ok:${drv.driver}` : drv.kind, label: r.unlistedRuns[0]?.label ?? null };
      } finally {
        console.error = origErr;
      }
    };
    const pure = await probe(oldPure);
    const face = await probe(oldFace);
    readout.A7 = { baseRef: BASE_REF, valueFace: VALUE_FACE, faceSuites: { pass: passN, fail: failN }, pure, face };
    check('A7 (ii) 叠上取值面后 run-meta-strict / report 两个套件全绿（S3 / V9 不红）', failN === 0 && passN > 0, `pass ${passN}，fail ${failN}`);
    check('A7 (i) 旧构建原样：新取值读成 null，resolveStageDriver 判 corrupt（回滚漏步的形态）', !pure.readable && pure.driver === 'corrupt', JSON.stringify(pure));
    check('A7 (ii) 旧代码 + 取值面：可读、Driver 判定正常、report 有专门说明', face.readable && face.driver.startsWith('ok:') && face.label === LABEL, JSON.stringify(face));
  }
} finally {
  const ps = await sh(base, 'ps', ['-axo', 'pid=,command=']);
  for (const l of ps.stdout.split('\n')) {
    const m = /review --worker (\S+)/.exec(l);
    if (m && seenRunIds.has(m[1])) killGroup(Number.parseInt(l.trim(), 10));
  }
  const fix = async (d) => {
    await fs.chmod(d, 0o755).catch(() => {});
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && !e.isSymbolicLink()) await fix(path.join(d, e.name));
  };
  await fix(base);
  // 收尾只删 mkdtemp 的返回值
  await fs.rm(base, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), baseRef: BASE_REF, passed, total: results.length, results, readout }, null, 2) + '\n');
process.exit(passed === results.length ? 0 : 1);
