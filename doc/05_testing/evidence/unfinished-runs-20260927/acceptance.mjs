#!/usr/bin/env node
/**
 * 「未收尾运行的留痕与复盘可见性」零配额验收（计划 r2 §4.4 A1～A6）。
 *
 * **不碰真实 HOME、不改本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用。夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 收尾只删 mkdtemp 的返回值。本仓归档只读（A6）。
 *
 *   A1 worker 异常（阶段目录只读、写审查文档 EACCES）⇒ run.json failed + termination(worker_exception)、task.json failed、
 *      `--wait --json` 的 message 说明已收尾
 *   A2 worker_lost（hang + SIGKILL 进程组，运行中途先提交一次）⇒ run.json failed + termination(worker_lost, pid_gone)；
 *      提交锚放行并真实提交；随后 `--cancel` 终态早退、run.json 逐字节不变
 *   A3 heartbeat_stale（SIGSTOP 冻住 worker、stale 阈值 2 s）⇒ run.json 逐字节不变，输出写明未确认退出
 *   A4 入选侧全部失败后成功重跑 ⇒ report 时间线只列重跑（r1），「未进时间线的运行」一行（失败那次，r1，入选侧全部失败），头部「另有 1 次」
 *   A5 取消一轮 ⇒ report「轮次总数：0（另有 1 次…）」，表里一行「被 review --cancel 取消」
 *   A6 本仓归档只读：新旧两份构建逐主题 `buildTopicReport`，rounds 深相等（主判据）；新构建的 unlistedRuns 逐条核对
 *      = 4 份历史 running + 本主题自身在验收时点尚无审查文档的运行（若有）
 *
 * 用法（在仓库根）：node acceptance.mjs [输出 JSON 路径]
 */
import { execFile, spawn } from 'node:child_process';
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
const { encodeStubConfig, STUB_ENV_VAR } = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js')).href);
const SESSION = 'S-验收';
const THIS_TOPIC = '未收尾运行的留痕与复盘可见性';
const HISTORICAL_RUNNING = ['20260922T164557Z', '20260922T134058Z', '20260911T023018Z', '20260917T024844Z'];

const results = [];
const readout = {};
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const envFor = (stub) => ({ TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: encodeStubConfig(stub), CLAUDE_SESSION_ID: SESSION });
const cli = (cwd, args, stub) => sh(cwd, process.execPath, [CLI, ...args], envFor(stub));
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const jsonOf = (text) => JSON.parse(text.slice(text.indexOf('{')));
const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
const HANG = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };
const FAIL = { gemini: { mode: 'fail' }, glm: { mode: 'fail' } };

function preCommit(cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'gate', 'hook-pre-commit'], { cwd, env: { ...process.env, ...envFor(null) } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', function (d) { stdout += d; });
    p.stderr.on('data', function (d) { stderr += d; });
    p.on('close', function (code) { resolve({ code, stdout, stderr }); });
    p.stdin.end(JSON.stringify({ session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }));
  });
}

async function fixture(base, topic, extraReview = []) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs-' + topic)}`,
    'review:', '  default_critics: [gemini, glm]', ...extraReview.map((l) => '  ' + l),
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(stageDir, `${today}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n验收。\n');
  return { root, stageDir, taskJson: path.join(root, '.reviews', topic, 'task.json') };
}

async function start(root, topic, stub) {
  const r = await cli(root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', topic, '--focus', '验收', '--session-id', SESSION, '--json'], stub);
  if (r.code !== 0) throw new Error(`review --start 失败：${r.stdout}${r.stderr}`);
  const js = jsonOf(r.stdout);
  return { runId: js.run_id, workerPid: js.worker_pid, runDir: js.run_dir };
}
async function waitDone(root, runId, stub, json = false) {
  let w;
  for (let i = 0; i < 10; i++) {
    w = await cli(root, ['review', '--wait', runId, '--timeout', '20', ...(json ? ['--json'] : [])], stub);
    if (w.code !== 73) break;
  }
  return w;
}
const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* 已不在 */ } } };

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-unfinished-accept-'));
try {
  // ── A1 ──
  {
    const topic = 'A1-worker异常';
    const fx = await fixture(base, topic);
    await fs.mkdir(path.join(fx.stageDir, '_meta'), { recursive: true });
    await fs.chmod(fx.stageDir, 0o555);
    try {
      const s = await start(fx.root, topic, OK);
      const w = await waitDone(fx.root, s.runId, OK, true);
      const out = jsonOf(w.stdout);
      const m = await readJson(path.join(fx.stageDir, '_meta', `run-${s.runId}.json`));
      const t = await readJson(fx.taskJson);
      readout.A1 = { waitCode: w.code, message: out.message, status: m.status, gate: m.gate.state, termination: m.termination ?? null };
      check('A1 退出码', w.code === 1, `--wait 退 ${w.code}`);
      check('A1 run.json', m.status === 'failed' && m.gate.state === 'failed' && !!m.finished_at
        && JSON.stringify(m.termination) === JSON.stringify({ by: 'worker_exception', exit_code: 1 }),
        `status=${m.status} gate.state=${m.gate.state} termination=${JSON.stringify(m.termination)}`);
      check('A1 task 登记', t.runs.find(function (r) { return r.run_id === s.runId; })?.status === 'failed', 'task.json 该条为 failed');
      check('A1 message', /工作进程异常/.test(out.message ?? '') && /收尾为 failed/.test(out.message ?? ''), '--wait --json 的 message 带收尾结果');
    } finally {
      await fs.chmod(fx.stageDir, 0o755);
    }
  }

  // ── A2 ──
  {
    const topic = 'A2-worker失联';
    const fx = await fixture(base, topic);
    const s = await start(fx.root, topic, HANG);
    const runJson = path.join(fx.stageDir, '_meta', `run-${s.runId}.json`);
    await git(fx.root, ['add', '-A', '--', '.reviews']);
    await git(fx.root, ['commit', '-q', '-m', '运行中途入库', '--no-verify']);
    const headArtifacts = JSON.parse((await git(fx.root, ['show', `HEAD:.reviews/${topic}/plan/_meta/run-${s.runId}.json`])).stdout).artifacts;
    killGroup(s.workerPid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
    const w = await cli(fx.root, ['review', '--wait', s.runId, '--timeout', '20'], HANG);
    const m = await readJson(runJson);
    readout.A2_wait = { code: w.code, stderr: w.stderr };
    check('A2 退出码', w.code === 1 && /失联（pid_gone）/.test(w.stdout + w.stderr), `--wait 退 ${w.code}`);
    check('A2 run.json', m.status === 'failed' && JSON.stringify(m.termination) === JSON.stringify({ by: 'worker_lost', reason: 'pid_gone' })
      && JSON.stringify(m.artifacts) === JSON.stringify(headArtifacts),
      `status=${m.status} termination=${JSON.stringify(m.termination)}，artifacts 与已提交版本一致`);
    const pc = await preCommit(fx.root);
    readout.A2_preCommit = pc;
    check('A2 提交锚放行', pc.code === 0, `hook-pre-commit 退 ${pc.code}`);
    await git(fx.root, ['add', '-A', '--', '.reviews']);
    const cm = await git(fx.root, ['commit', '-q', '-m', '失联收尾后入库', '--no-verify']);
    check('A2 入库', cm.code === 0, `提交退 ${cm.code}`);
    const before = await fs.readFile(runJson, 'utf8');
    const c = await cli(fx.root, ['review', '--cancel', s.runId], HANG);
    check('A2 之后 --cancel', c.code === 0 && /已处于终态（failed）/.test(c.stdout + c.stderr) && (await fs.readFile(runJson, 'utf8')) === before,
      '终态早退，run.json 逐字节不变');
  }

  // ── A3 ──
  {
    const topic = 'A3-心跳过期';
    const fx = await fixture(base, topic, ['heartbeat_stale_s: 2']);
    const s = await start(fx.root, topic, HANG);
    const runJson = path.join(fx.stageDir, '_meta', `run-${s.runId}.json`);
    try {
      for (let i = 0; i < 100; i++) {
        const st = await readJson(path.join(s.runDir, 'status.json')).catch(() => null);
        if (st?.phase === 'running') break;
        await new Promise((r) => setTimeout(r, 30));
      }
      process.kill(s.workerPid, 'SIGSTOP');
      const before = await fs.readFile(runJson, 'utf8');
      await new Promise((r) => setTimeout(r, 2500));
      const w = await cli(fx.root, ['review', '--wait', s.runId, '--timeout', '10'], HANG);
      readout.A3_wait = { code: w.code, stderr: w.stderr };
      check('A3 判心跳过期', /heartbeat_stale/.test(w.stdout + w.stderr), `--wait 退 ${w.code}`);
      check('A3 run.json 不写', (await fs.readFile(runJson, 'utf8')) === before && /工作进程未确认退出/.test(w.stdout + w.stderr),
        '进程还在：run.json 逐字节不变，输出写明未确认退出');
    } finally {
      try { process.kill(s.workerPid, 'SIGCONT'); } catch { /* 已不在 */ }
      killGroup(s.workerPid, 'SIGKILL');
    }
  }

  // ── A4 ──
  {
    const topic = 'A4-全失败后重跑';
    const fx = await fixture(base, topic);
    const s1 = await start(fx.root, topic, FAIL);
    await waitDone(fx.root, s1.runId, FAIL);
    const s2 = await start(fx.root, topic, OK);
    await waitDone(fx.root, s2.runId, OK);
    const rj = jsonOf((await cli(fx.root, ['report', '--topic', topic, '--json'], OK)).stdout);
    const md = (await cli(fx.root, ['report', '--topic', topic], OK)).stdout;
    readout.A4 = { rounds: rj.rounds.map((r) => ({ runId: r.runId, r: r.rerunIndex })), unlisted: rj.unlistedRuns };
    check('A4 时间线', rj.rounds.length === 1 && rj.rounds[0].runId === s2.runId && rj.rounds[0].rerunIndex === 1, `时间线只列重跑那次（r1）`);
    check('A4 下表', rj.unlistedRuns.length === 1 && rj.unlistedRuns[0].runId === s1.runId && rj.unlistedRuns[0].rerunIndex === 1
      && rj.unlistedRuns[0].label === '入选侧全部失败', `失败那次：${JSON.stringify(rj.unlistedRuns[0] ?? null)}`);
    check('A4 头部', /\*\*轮次总数\*\*：1（另有 1 次运行未产出审查文档/.test(md), '头部注明另有 1 次');
  }

  // ── A5 ──
  {
    const topic = 'A5-取消';
    const fx = await fixture(base, topic);
    const s = await start(fx.root, topic, HANG);
    await cli(fx.root, ['review', '--cancel', s.runId], HANG);
    const md = (await cli(fx.root, ['report', '--topic', topic], HANG)).stdout;
    readout.A5 = md.split('\n').filter((l) => /轮次总数|未进时间线|被 review --cancel 取消/.test(l));
    check('A5 头部', /\*\*轮次总数\*\*：0（另有 1 次运行未产出审查文档，见时间线下方）/.test(md), '「轮次总数：0」后注明另有 1 次');
    check('A5 下表', new RegExp(`\\| plan \\| r1 \\| \`${s.runId}\` \\|.*\\| cancelled \\| 被 review --cancel 取消 \\|`).test(md), '表里一行被取消');
  }

  // ── A6 ──
  {
    // 旧构建：HEAD（本主题实施前的已提交代码）导出到 mkdtemp，node_modules 链回仓库，只构建测试产物
    const oldRoot = path.join(base, 'old-build');
    await fs.mkdir(oldRoot, { recursive: true });
    const archivePath = path.join(base, 'head.tar');
    const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', archivePath, 'HEAD', 'src', 'scripts', 'skills', 'skills-src', 'test', 'package.json', 'tsconfig.json']);
    if (ar.code !== 0) throw new Error(`git archive 失败：${ar.stderr}`);
    const ex = await sh(oldRoot, 'tar', ['-xf', archivePath]);
    if (ex.code !== 0) throw new Error(`解包失败：${ex.stderr}`);
    await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldRoot, 'node_modules'));
    const b = await sh(oldRoot, process.execPath, ['scripts/build.mjs', '--with-tests']);
    if (b.code !== 0) throw new Error(`旧构建失败：${b.stdout}${b.stderr}`);
    const oldReport = await import(pathToFileURL(path.join(oldRoot, 'dist/test/src/trivium/report.js')).href);
    const newReport = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/report.js')).href);
    const archiveRoot = path.join(ROOT, '.reviews');
    const origErr = console.error;
    console.error = () => {};
    const diffs = [];
    const unlisted = [];
    let topics = 0;
    try {
      for (const topic of (await fs.readdir(archiveRoot)).sort()) {
        if (topic.startsWith('.') || !(await fs.stat(path.join(archiveRoot, topic))).isDirectory()) continue;
        topics++;
        const o = await oldReport.buildTopicReport({ archiveRoot, topic });
        const n = await newReport.buildTopicReport({ archiveRoot, topic });
        if (JSON.stringify(o.rounds) !== JSON.stringify(n.rounds)) diffs.push(topic);
        for (const u of n.unlistedRuns) unlisted.push({ topic, runId: u.runId, stage: u.stage, status: u.status, label: u.label });
      }
    } finally {
      console.error = origErr;
    }
    readout.A6 = { topics, roundsDiff: diffs, unlisted };
    check('A6 时间线逐主题不变', diffs.length === 0, `${topics} 个主题，rounds 不同的：${diffs.join('、') || '无'}`);
    const historical = unlisted.filter((u) => HISTORICAL_RUNNING.includes(u.runId));
    const own = unlisted.filter((u) => u.topic === THIS_TOPIC);
    const other = unlisted.filter((u) => !HISTORICAL_RUNNING.includes(u.runId) && u.topic !== THIS_TOPIC);
    check('A6 下表 = 4 份历史 running + 本主题自身', historical.length === 4 && other.length === 0
      && historical.every((u) => u.status === 'running' && u.label === '进行中，或没走到收尾'),
      `历史 ${historical.length} 条（均为「进行中，或没走到收尾」），本主题自身 ${own.length} 条，其它 ${other.length} 条`);
  }
} finally {
  await fs.rm(base, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results, readout }, null, 2) + '\n');
process.exit(passed === results.length ? 0 : 1);
