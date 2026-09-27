#!/usr/bin/env node
/**
 * 只读实测（不碰真实 HOME、不改本仓归档）：用仓库构建的 CLI + 桩审查员，在 mkdtemp 夹具里核对
 *   P1 入选侧全部失败（两侧 fail）⇒ run.json 状态、是否有审查文档、report 时间线是否列它、轮次总数；
 *      随后再跑一轮成功 ⇒ 新一轮的 rerun_index 是否与失败轮相同、report 列的是哪一次
 *   P2 worker 抛异常（阶段目录只读 ⇒ 写审查文档 EACCES）⇒ status.json 与 run.json 各是什么
 *   P3 worker 被 SIGKILL 后 --wait 判 worker_lost ⇒ status.json 与 run.json 各是什么
 *   P4 prepareRun 在骨架写入之后被闸门拦下（上一轮未裁决直接重跑）⇒ 归档里是否多出一份 running 的 run.json
 * 收尾只删 mkdtemp 的返回值。
 *
 * 用法：node probe-unfinished.mjs <仓库根>
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pexec = promisify(execFile);
const ROOT = path.resolve(process.argv[2] ?? '.');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-probe';

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
const out = {};

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs-' + topic)}`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(stageDir, `${today}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n实测。\n');
  return { root, stageDir };
}

async function start(root, topic, stub) {
  const r = await cli(root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', topic, '--focus', '实测', '--session-id', SESSION, '--json'], stub);
  if (r.code !== 0) return { r, runId: null };
  const js = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  return { r, runId: js.run_id, workerPid: js.worker_pid, runDir: js.run_dir };
}
async function waitDone(root, runId, stub) {
  let w;
  for (let i = 0; i < 10; i++) {
    w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], stub);
    if (w.code !== 73) break;
  }
  return w;
}
async function runMetaOf(stageDir, runId) {
  return readJson(path.join(stageDir, '_meta', `run-${runId}.json`)).catch(() => null);
}
async function mdDocs(stageDir) {
  return (await fs.readdir(stageDir)).filter((n) => n.endsWith('.md')).sort();
}
async function report(root, topic, stub) {
  const r = await cli(root, ['report', '--topic', topic, '--json'], stub);
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    return { code: r.code, rounds: (j.rounds ?? []).map((x) => ({ stage: x.stage, r: x.rerunIndex, runId: x.runId, status: x.status })), notes: j.notes };
  } catch {
    const text = await cli(root, ['report', '--topic', topic], stub);
    return { code: r.code, raw: (text.stdout + text.stderr).split('\n').filter((l) => /轮次总数|^\| plan|⚠️/.test(l)) };
  }
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-unfinished-'));
try {
  // ── P1 ──
  {
    const topic = 'P1-全失败';
    const { root, stageDir } = await fixture(base, topic);
    const FAIL = { gemini: { mode: 'fail' }, glm: { mode: 'fail' } };
    const s = await start(root, topic, FAIL);
    const w = await waitDone(root, s.runId, FAIL);
    const m = await runMetaOf(stageDir, s.runId);
    out.P1 = {
      waitCode: w.code,
      run: m && { status: m.status, gate: m.gate.state, rerun: m.rerun_index, sides: Object.fromEntries(Object.entries(m.critics).map(([c, v]) => [c, v.status])), artifacts: m.artifacts.map((a) => path.basename(a.path)) },
      docs: await mdDocs(stageDir),
      report: await report(root, topic, FAIL),
    };
    const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
    const s2 = await start(root, topic, OK);
    const w2 = await waitDone(root, s2.runId, OK);
    const m2 = await runMetaOf(stageDir, s2.runId);
    out.P1_rerun = { startCode: s2.r.code, startErr: s2.runId ? null : (s2.r.stdout + s2.r.stderr).slice(0, 600), waitCode: w2?.code, rerun: m2?.rerun_index, status: m2?.status, docs: await mdDocs(stageDir), report: await report(root, topic, OK) };
  }

  // ── P2 ──
  {
    const topic = 'P2-worker异常';
    const { root, stageDir } = await fixture(base, topic);
    await fs.mkdir(path.join(stageDir, '_meta'), { recursive: true });
    await fs.chmod(stageDir, 0o555); // 审查文档写不进阶段目录；_meta 仍可写
    const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
    const s = await start(root, topic, OK);
    const w = s.runId ? await waitDone(root, s.runId, OK) : null;
    await fs.chmod(stageDir, 0o755);
    const m = s.runId ? await runMetaOf(stageDir, s.runId) : null;
    const st = s.runDir ? await readJson(path.join(s.runDir, 'status.json')).catch(() => null) : null;
    const task = await readJson(path.join(root, '.reviews', topic, 'task.json')).catch(() => null);
    out.P2 = {
      startCode: s.r.code, startErr: s.runId ? null : (s.r.stdout + s.r.stderr).slice(0, 600),
      waitCode: w?.code, waitTail: w ? (w.stdout + w.stderr).split('\n').filter(Boolean).slice(-4) : null,
      statusJson: st && { phase: st.phase, message: st.message },
      run: m && { status: m.status, gate: m.gate.state, finished_at: m.finished_at },
      taskEntry: task?.runs?.find((x) => x.run_id === s.runId)?.status ?? null,
      report: await report(root, topic, OK),
    };
  }

  // ── P3 ──
  {
    const topic = 'P3-worker失联';
    const { root, stageDir } = await fixture(base, topic);
    const HANG = { gemini: { mode: 'hang' }, glm: { mode: 'hang' } };
    const s = await start(root, topic, HANG);
    await new Promise((r) => setTimeout(r, 800));
    try { process.kill(-s.workerPid, 'SIGKILL'); } catch { try { process.kill(s.workerPid, 'SIGKILL'); } catch { /* 已不在 */ } }
    await new Promise((r) => setTimeout(r, 500));
    const w = await cli(root, ['review', '--wait', s.runId, '--timeout', '20'], HANG);
    const m = await runMetaOf(stageDir, s.runId);
    const st = await readJson(path.join(s.runDir, 'status.json')).catch(() => null);
    out.P3 = {
      waitCode: w.code, waitTail: (w.stdout + w.stderr).split('\n').filter(Boolean).slice(-3),
      statusJson: st && { phase: st.phase, message: st.message },
      run: m && { status: m.status, gate: m.gate.state, finished_at: m.finished_at },
      report: await report(root, topic, HANG),
    };
    // 失联判定之后再 --cancel：看是否在终态分支早退
    const c = await cli(root, ['review', '--cancel', s.runId], HANG);
    out.P3_cancelAfterLost = { code: c.code, tail: (c.stdout + c.stderr).split('\n').filter(Boolean).slice(-3), run: (await runMetaOf(stageDir, s.runId))?.status };
  }

  // ── P4 ──
  {
    const topic = 'P4-闸门拦重跑';
    const { root, stageDir } = await fixture(base, topic);
    const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
    const s1 = await start(root, topic, OK);
    await waitDone(root, s1.runId, OK);
    const before = (await fs.readdir(path.join(stageDir, '_meta'))).filter((n) => /^run-/.test(n));
    const s2 = await start(root, topic, OK); // 上一轮未裁决，应被拦
    const after = (await fs.readdir(path.join(stageDir, '_meta'))).filter((n) => /^run-/.test(n));
    const extra = after.filter((n) => !before.includes(n));
    const extraMeta = [];
    for (const n of extra) {
      const j = await readJson(path.join(stageDir, '_meta', n));
      extraMeta.push({ file: n, status: j.status, rerun: j.rerun_index });
    }
    out.P4 = { secondStartCode: s2.r.code, secondStartMsg: (s2.r.stdout + s2.r.stderr).split('\n').filter(Boolean).slice(0, 2), runJsonBefore: before.length, runJsonAfter: after.length, extra: extraMeta };
  }
} finally {
  // 收尾只删 mkdtemp 的返回值
  await fs.chmod(base, 0o755).catch(() => {});
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
