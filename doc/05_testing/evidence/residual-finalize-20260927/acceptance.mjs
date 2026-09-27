#!/usr/bin/env node
/**
 * 「事后收尾余项」零配额验收（计划 r2 §4.4 A1～A8）。
 *
 * **不碰真实 HOME、不改本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用。夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 收尾只删 mkdtemp 的返回值，并按本脚本观测到的 run_id 结束残留 worker。本仓归档只读（A7）。
 *
 *   A1 ①首轮登记失败 ⇒ run.json failed + prepare_exception；report 说明；会话启动仍报「运行目录的状态读不到」（如实保留）
 *   A2 ①第 1 轮已审批后第 2 轮登记失败 ⇒ 第 1 轮逐字节不变；不带 --run-id 的 gate --check 指向第 2 轮骨架（D5）；
 *      随后正常重跑 ⇒ 时间线 r1、r2，未进时间线表一行「准备阶段失败…」
 *   A3 ②派生前：写交接文件 EACCES、以及 spawnDetached 内部开日志文件 EISDIR 两格 ⇒ run.json 与登记 failed + prepare_exception；
 *      之后 --wait / --cancel 不再改 run.json
 *   A4 ②子进程诞生之后（写 worker.pid EISDIR，hang 桩）⇒ 不收尾：run.json running、无 termination；孤儿 worker 活着、锁已放（EV-150 现状）
 *   A5 ③同步路径 executeRun 抛错 ⇒ run.json 与登记 failed + sync_exception
 *   A6 ④worker 猝死（行为不变）⇒ 会话启动提示 --wait；直接再 --start 后旧 run.json 仍 running；补跑 --wait 收尾为 worker_lost / pid_gone
 *   A7 本仓归档只读：新旧两份构建逐主题 buildTopicReport，rounds 与 unlistedRuns 逐主题深相等
 *   A8 回滚演练（计划 r2 §6.3，r1 CODEX-04）：ACCEPT_BASE_REF（缺省 53eaab8）原样构建 vs 换上本主题 run.v2.json 的构建，
 *      读同一份 prepare_exception 的 run.json：前者读成 null、resolveStageDriver 判 corrupt；后者可读、report 落兜底说明
 *
 * 旧构建基线用固定提交（缺省 53eaab8，可由 ACCEPT_BASE_REF 覆盖），不写 HEAD——提交之后 HEAD 即改后代码。
 * 用法（在仓库根）：node acceptance.mjs [输出 JSON 路径]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
if (!existsSync(CLI)) throw new Error(`找不到仓库构建的 CLI：${CLI}（先 npm run build）`);
const imp = (p) => import(pathToFileURL(p).href);
const { encodeStubConfig, STUB_ENV_VAR } = await imp(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const { repoId } = await imp(path.join(ROOT, 'dist/test/src/trivium/review.js'));
const { newRunId } = await imp(path.join(ROOT, 'dist/test/src/trivium/meta.js'));
const SESSION = 'S-验收';
const TD = '.' + 'trivium';
const STATE = 'state' + '.json';
const TASK = 'task' + '.json';
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '53eaab8';

const results = [];
const readout = {};
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

async function sh(cwd, bin, args, env = {}, input = null) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
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
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
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
const locks = async (fx) => ls(path.join(fx.root, TD, 'lock'));
async function report(fx) {
  const r = await cli(fx.root, ['report', '--topic', fx.topic, '--json']);
  const j = jsonOf(r.stdout);
  return {
    rounds: (j?.rounds ?? []).map((x) => ({ r: x.rerunIndex, runId: x.runId })),
    unlisted: (j?.unlistedRuns ?? []).map((x) => ({ r: x.rerunIndex, runId: x.runId, label: x.label })),
  };
}
async function writeDisposition(fx, runId) {
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${fx.topic}-revised-` + 'claude.md'),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${fx.topic}-gemini.md`, `  - ${today()}-${fx.topic}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 同一处问题，一并补上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );
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
const isPrep = (m, code = 1) => m?.status === 'failed' && m?.gate?.state === 'failed' && eq(m?.termination, { by: 'prepare_exception', exit_code: code });

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-residual-'));
try {
  // ── A1 ──
  {
    const fx = await fixture(base, 'A1-首轮登记失败');
    await fs.chmod(fx.topicDir, 0o555);
    const s = await start(fx);
    await fs.chmod(fx.topicDir, 0o755);
    const { id, meta } = await onlyRun(fx);
    const rep = await report(fx);
    const ss = await hookSessionStart(fx.root);
    readout.A1 = { startCode: s.r.code, stderrTail: s.r.stderr.split('\n').filter(Boolean).slice(-3), status: meta?.status, termination: meta?.termination, task: await taskRuns(fx), gate: (await gateOf(fx))?.state, locks: await locks(fx), unlisted: rep.unlisted, sessionStart: ss.ctx };
    check('A1 首轮登记失败 ⇒ 骨架收尾为 prepare_exception', s.r.code !== 0 && isPrep(meta), `退 ${s.r.code}，run ${meta?.status} ${JSON.stringify(meta?.termination)}`);
    check('A1 闸门 idle、锁已放、主题任务文件未建', (await gateOf(fx))?.state === 'idle' && (await locks(fx)).length === 0 && (await taskRuns(fx)) === null, `闸门 ${(await gateOf(fx))?.state}，锁 ${(await locks(fx)).join(',') || '无'}`);
    check('A1 report 说明「准备阶段失败，未拉起审查员（退出码 1）」', rep.unlisted.find((u) => u.runId === id)?.label === '准备阶段失败，未拉起审查员（退出码 1）', JSON.stringify(rep.unlisted));
    check('A1 会话启动仍报「运行目录的状态读不到」（如实保留，D2 子项）', /运行目录的状态读不到/.test(ss.ctx), ss.ctx.split('\n')[1] ?? '（无）');
  }

  // ── A2 ──
  {
    const fx = await fixture(base, 'A2-次轮登记失败');
    const s1 = await start(fx);
    await waitDone(fx, s1.runId);
    await writeDisposition(fx, s1.runId);
    const chk = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--session-id', SESSION]);
    const ap = await cli(fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan', '--session-id', SESSION]);
    const r1Bytes = await fs.readFile(runFile(fx, s1.runId), 'utf8');
    await sleep(1100);
    await fs.chmod(fx.topicDir, 0o555);
    const s2 = await start(fx);
    await fs.chmod(fx.topicDir, 0o755);
    const ms = await runMetas(fx.stageDir);
    const r2 = Object.keys(ms).find((k) => k !== s1.runId);
    const gc = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check', '--json', '--session-id', SESSION]);
    const gj = jsonOf(gc.stdout);
    await sleep(1100);
    const s3 = await start(fx);
    if (s3.runId) await waitDone(fx, s3.runId);
    const rep = await report(fx);
    readout.A2 = { checkCode: chk.code, approveCode: ap.code, r1: s1.runId, r2, r2meta: ms[r2] && { status: ms[r2].status, termination: ms[r2].termination }, gateCheck: { code: gc.code, run_id: gj?.run_id }, r3: s3.runId, rounds: rep.rounds, unlisted: rep.unlisted };
    check('A2 第 2 轮骨架收尾为 prepare_exception、第 1 轮逐字节不变', s2.r.code !== 0 && isPrep(ms[r2]) && (await fs.readFile(runFile(fx, s1.runId), 'utf8')) === r1Bytes, `第 2 轮 ${ms[r2]?.status}`);
    check('A2 不带 --run-id 的 gate --check 仍指向第 2 轮骨架（D5）', gj?.run_id === r2, `run_id ${gj?.run_id}`);
    check('A2 正常重跑后时间线 r1、r2，未进时间线表一行准备阶段失败', eq(rep.rounds.map((x) => x.r), [1, 2]) && rep.unlisted.length === 1 && rep.unlisted[0].runId === r2 && rep.unlisted[0].label.startsWith('准备阶段失败'), `${JSON.stringify(rep.rounds)} ｜ ${JSON.stringify(rep.unlisted)}`);
  }

  // ── A3 ──
  for (const [tag, prep, what] of [
    ['a', (d) => fs.chmod(d, 0o555), '写交接文件 EACCES'],
    ['b', (d) => fs.mkdir(path.join(d, 'worker.log')), 'spawnDetached 内部开日志文件 EISDIR'],
  ]) {
    const fx = await fixture(base, `A3${tag}-派生前失败`);
    const { ids, dirs } = await precreate(fx, prep);
    const s = await start(fx);
    for (const d of dirs) await fs.chmod(d, 0o755).catch(() => {});
    const { id, meta, all } = await onlyRun(fx);
    const hit = id !== null && ids.has(id);
    const before = id ? await fs.readFile(runFile(fx, id), 'utf8') : null;
    const w = id ? await cli(fx.root, ['review', '--wait', id, '--timeout', '6']) : null;
    const c = id ? await cli(fx.root, ['review', '--cancel', id]) : null;
    const after = id ? await fs.readFile(runFile(fx, id), 'utf8') : null;
    const ps = await sh(base, 'ps', ['-axo', 'pid=,command=']);
    const worker = id ? ps.stdout.split('\n').some((l) => l.includes('--worker') && l.includes(id)) : null;
    readout[`A3${tag}`] = { what, startCode: s.r.code, hit, all, status: meta?.status, termination: meta?.termination, task: await taskRuns(fx), gate: (await gateOf(fx))?.state, locks: await locks(fx), waitCode: w?.code, cancelCode: c?.code, worker };
    check(`A3${tag} ${what} ⇒ 骨架与登记收尾为 prepare_exception`, hit && s.r.code !== 0 && isPrep(meta) && eq((await taskRuns(fx))?.map((t) => t.status), ['failed']), hit ? `run ${meta?.status} ${JSON.stringify(meta?.termination)}` : `预建窗口未命中：${JSON.stringify(all)}`);
    check(`A3${tag} 之后 --wait / --cancel 不再改 run.json，且没有 worker`, before === after && worker === false, `--wait 退 ${w?.code}、--cancel 退 ${c?.code}，run.json ${before === after ? '不变' : '变了'}，worker ${worker ? '在' : '无'}`);
  }

  // ── A4 ──
  {
    const fx = await fixture(base, 'A4-诞生之后失败');
    const { ids } = await precreate(fx, (d) => fs.mkdir(path.join(d, 'worker.pid')));
    const s = await start(fx, HANG);
    const { id, meta } = await onlyRun(fx);
    await sleep(800);
    const ps = await sh(base, 'ps', ['-axo', 'pid=,command=']);
    const orphan = id ? Number.parseInt(ps.stdout.split('\n').find((l) => l.includes('--worker') && l.includes(id))?.trim() ?? '', 10) : NaN;
    readout.A4 = { startCode: s.r.code, hit: id !== null && ids.has(id), status: meta?.status, termination: meta?.termination ?? null, orphan: Number.isFinite(orphan) ? orphan : null, locks: await locks(fx), gate: (await gateOf(fx))?.state };
    check('A4 子进程诞生之后失败 ⇒ 不收尾（running、无 termination）', s.r.code !== 0 && ids.has(id) && meta?.status === 'running' && meta?.termination === undefined, `run ${meta?.status}`);
    check('A4 孤儿 worker 活着、锁已放（EV-150 现状，如实记录）', Number.isFinite(orphan) && alive(orphan) && (await locks(fx)).length === 0, `孤儿 ${orphan}，锁 ${(await locks(fx)).join(',') || '无'}`);
    if (Number.isFinite(orphan)) killGroup(orphan);
  }

  // ── A5 ──
  {
    const fx = await fixture(base, 'A5-同步路径异常');
    await fs.mkdir(path.join(fx.stageDir, '_meta'), { recursive: true });
    await fs.chmod(fx.stageDir, 0o555);
    const r = await cli(fx.root, ['review', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--entry', 'B', '--session-id', SESSION]);
    await fs.chmod(fx.stageDir, 0o755);
    const { id, meta } = await onlyRun(fx);
    const rep = await report(fx);
    readout.A5 = { code: r.code, stderrTail: r.stderr.split('\n').filter(Boolean).slice(-3), status: meta?.status, termination: meta?.termination, task: await taskRuns(fx), gate: (await gateOf(fx))?.state, unlisted: rep.unlisted };
    check('A5 同步路径异常 ⇒ run.json 与登记 failed + sync_exception', r.code !== 0 && meta?.status === 'failed' && eq(meta?.termination, { by: 'sync_exception', exit_code: 1 }) && eq((await taskRuns(fx))?.map((t) => t.status), ['failed']), `退 ${r.code}，run ${meta?.status} ${JSON.stringify(meta?.termination)}`);
    check('A5 report 说明「同步路径异常（退出码 1）」', rep.unlisted.find((u) => u.runId === id)?.label === '同步路径异常（退出码 1）', JSON.stringify(rep.unlisted));
  }

  // ── A6 ──
  {
    const fx = await fixture(base, 'A6-worker猝死');
    const s = await start(fx, HANG);
    await sleep(1000);
    killGroup(s.workerPid);
    await sleep(600);
    const ss = await hookSessionStart(fx.root);
    await sleep(1100);
    const s2 = await start(fx);
    if (s2.runId) await waitDone(fx, s2.runId);
    const mid = (await runMetas(fx.stageDir))[s.runId];
    const w = await cli(fx.root, ['review', '--wait', s.runId, '--timeout', '10'], HANG);
    const after = (await runMetas(fx.stageDir))[s.runId];
    readout.A6 = { sessionStart: ss.ctx, secondStart: s2.r.code, oldAfterSecondStart: mid?.status, waitCode: w.code, oldAfterWait: { status: after?.status, termination: after?.termination } };
    check('A6 会话启动提示 --wait（行为不变）', /请先 trivium review --wait/.test(ss.ctx), ss.ctx.split('\n').slice(1).join(' ｜ '));
    check('A6 直接再 --start 后旧 run.json 仍 running（EV-151 现状）', s2.r.code === 0 && mid?.status === 'running', `第二次退 ${s2.r.code}，旧 run ${mid?.status}`);
    check('A6 补跑 --wait 收尾为 worker_lost / pid_gone', after?.status === 'failed' && eq(after?.termination, { by: 'worker_lost', reason: 'pid_gone' }), `--wait 退 ${w.code}，旧 run ${after?.status}`);
  }

  // ── 旧构建（A7 / A8 共用）──
  async function buildAt(dir, swapSchema) {
    await fs.mkdir(dir, { recursive: true });
    const tarPath = path.join(base, `${path.basename(dir)}.tar`);
    const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', tarPath, BASE_REF, 'src', 'scripts', 'skills', 'skills-src', 'test', 'package.json', 'tsconfig.json']);
    if (ar.code !== 0) throw new Error(`git archive 失败：${ar.stderr}`);
    const ex = await sh(dir, 'tar', ['-xf', tarPath]);
    if (ex.code !== 0) throw new Error(`解包失败：${ex.stderr}`);
    if (swapSchema) {
      await fs.copyFile(path.join(ROOT, 'skills/dual-critic/schema/run.v2.json'), path.join(dir, 'skills/dual-critic/schema/run.v2.json'));
    }
    await fs.symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const b = await sh(dir, process.execPath, ['scripts/build.mjs', '--with-tests']);
    if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
  }
  const oldPure = path.join(base, 'old-pure');
  const oldSwap = path.join(base, 'old-with-new-schema');
  await buildAt(oldPure, false);
  await buildAt(oldSwap, true);

  // ── A7 ──
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
    readout.A7 = { baseRef: BASE_REF, topics, diffs };
    check('A7 本仓 report 逐主题不变', diffs.length === 0, `基线 ${BASE_REF}，${topics} 个主题，rounds / unlistedRuns 不同的：${diffs.join('、') || '无'}`);
  }

  // ── A8 ──
  {
    const newMeta = await imp(path.join(ROOT, 'dist/test/src/trivium/meta.js'));
    const layout = { archiveRoot: path.join(base, 'a8-archive'), topic: 'A8-回滚演练' };
    const m = newMeta.newRunMeta({
      runId: '20260927T000000Z', topic: layout.topic, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
      criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
    });
    m.status = 'failed';
    m.gate.state = 'failed';
    m.finished_at = new Date().toISOString();
    m.termination = { by: 'prepare_exception', exit_code: 1 };
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
    const swap = await probe(oldSwap);
    readout.A8 = { baseRef: BASE_REF, pure, swap };
    check('A8 (i) 旧构建原样：新取值读成 null，resolveStageDriver 判 corrupt（回滚漏步的形态）', !pure.readable && pure.driver === 'corrupt', JSON.stringify(pure));
    check('A8 (ii) 旧代码 + 本主题 schema：可读、Driver 判定正常、report 落兜底说明（回滚步骤成立）', swap.readable && swap.driver.startsWith('ok:') && swap.label === 'failed（gate.state=failed）', JSON.stringify(swap));
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
