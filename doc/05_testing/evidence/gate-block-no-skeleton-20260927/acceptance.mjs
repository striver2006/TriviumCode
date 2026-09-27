#!/usr/bin/env node
/**
 * 「闸门拦截不留骨架」零配额验收（计划 r2 §4.4 A1～A6）。
 *
 * **不碰真实 HOME、不改本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用。夹具、运行目录、旧构建都建在一个 mkdtemp 目录下；
 * 收尾只删 mkdtemp 的返回值。本仓归档只读（A6）。
 *
 *   A1 plan 第 1 轮成功未裁决，再 --start ⇒ 退 2；_meta/、task.json（逐字节）、闸门项、运行根目录集合全不变；status --json 的 runs 仍为 1
 *   A2 接 A1：补第 1 轮裁决件 → 不带 --run-id 的 gate --check 通过（run_id 为第 1 轮）→ approve → 再跑一轮 ⇒ rerun_index 2；
 *      report 时间线 r1、r2 两行、unlistedRuns 为空
 *   A3 code 阶段被拦 ⇒ changes.diff 便利副本逐字节不变、_meta/ 文件集合不变
 *   A4 置闸门之后登记失败（主题目录只读）⇒ 非零退出；闸门项 idle 非 running；主题锁已放；骨架 running；report 说明「进行中，或没走到收尾」
 *   A5 同步 review --stage 被拦（与第 1 轮隔 1.1 s）⇒ 零工件
 *   A6 本仓归档只读：新旧两份构建逐主题 buildTopicReport，rounds 与 unlistedRuns 逐主题深相等（本主题不改 report）。
 *      旧构建取自 ACCEPT_BASE_REF（缺省 1ee28b0，计划 r2 提交、源码与起点相同），不取 HEAD——提交之后 HEAD 即改后代码（代码双审 r1 AGY-01）
 *
 * 用法（在仓库根）：node acceptance.mjs [输出 JSON 路径]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const TD = '.' + 'trivium';

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
const cli = (cwd, args, stub = OK) => sh(cwd, process.execPath, [CLI, ...args], envFor(stub));
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const jsonOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'))); } catch { return null; } };
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OK = { gemini: { mode: 'ok', findings: 1 }, glm: { mode: 'ok', findings: 1 } };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function listRec(dir, prefix = '') {
  let out = [];
  let ents = [];
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(await listRec(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

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
  return { root, topicDir, stageDir, runRoot, taskJson: path.join(topicDir, 'task.json'), stateJson: path.join(root, TD, 'state' + '.json') };
}

async function start(root, topic, stage = 'plan', entry = 'B') {
  const r = await cli(root, ['review', '--start', '--entry', entry, '--stage', stage, '--topic', topic, '--focus', '验收', '--session-id', SESSION, '--json']);
  return { r, runId: r.code === 0 ? jsonOf(r.stdout)?.run_id ?? null : null };
}
async function waitDone(root, runId) {
  let w;
  for (let i = 0; i < 12; i++) {
    w = await cli(root, ['review', '--wait', runId, '--timeout', '20']);
    if (w.code !== 73) break;
  }
  return w;
}
const gateEntry = async (fx, topic, stage) => (await readJson(fx.stateJson).catch(() => null))?.gates?.[`${topic}/${stage}`] ?? null;
async function writeDisposition(stageDir, topic, runId) {
  await fs.writeFile(
    path.join(stageDir, `${today()}-${topic}-revised-` + 'claude.md'),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${topic}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${topic}-gemini.md`, `  - ${today()}-${topic}-glm.md`,
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
async function reportJson(root, topic) {
  const r = await cli(root, ['report', '--topic', topic, '--json']);
  const j = jsonOf(r.stdout);
  return {
    code: r.code,
    rounds: (j?.rounds ?? []).map((x) => ({ stage: x.stage, r: x.rerunIndex, runId: x.runId })),
    unlisted: (j?.unlistedRuns ?? []).map((x) => ({ r: x.rerunIndex, runId: x.runId, status: x.status, label: x.label })),
  };
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-gateblock-'));
try {
  // ── A1 / A2 ──
  {
    const topic = 'A1-闸门拦重跑';
    const fx = await fixture(base, topic);
    const s1 = await start(fx.root, topic);
    const w1 = await waitDone(fx.root, s1.runId);
    const metaDir = path.join(fx.stageDir, '_meta');
    const before = {
      meta: await listRec(metaDir), task: await sha(fx.taskJson), gate: await gateEntry(fx, topic, 'plan'), runs: await listRec(fx.runRoot),
    };
    await sleep(1100);
    const s2 = await start(fx.root, topic);
    const after = {
      meta: await listRec(metaDir), task: await sha(fx.taskJson), gate: await gateEntry(fx, topic, 'plan'), runs: await listRec(fx.runRoot),
    };
    const st = jsonOf((await cli(fx.root, ['status', '--topic', topic, '--json'])).stdout);
    const runsCount = st?.topics?.find((t) => t.topic === topic)?.runs ?? null;
    readout.A1 = { firstWait: w1?.code, secondStart: s2.r.code, gateBefore: before.gate, gateAfter: after.gate, runsCount };
    check('A1 被拦退 2', s2.r.code === 2 && /尚未裁决/.test(s2.r.stdout + s2.r.stderr), `第二次 --start 退 ${s2.r.code}`);
    check('A1 零工件', JSON.stringify(before.meta) === JSON.stringify(after.meta) && before.task === after.task
      && JSON.stringify(before.runs) === JSON.stringify(after.runs),
      `_meta/ ${before.meta.length}→${after.meta.length} 份，task.json 逐字节${before.task === after.task ? '不变' : '变了'}，运行根 ${before.runs.length}→${after.runs.length}`);
    check('A1 闸门项不变', JSON.stringify(before.gate) === JSON.stringify(after.gate), `${after.gate?.state}（run ${after.gate?.run_id}）`);
    check('A1 status 的 runs 仍为 1', runsCount === 1, `runs = ${runsCount}`);

    await writeDisposition(fx.stageDir, topic, s1.runId);
    const c = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--check', '--json', '--session-id', SESSION]);
    const cj = jsonOf(c.stdout);
    check('A2 不带 --run-id 的 gate --check 通过且校验第 1 轮', c.code === 0 && cj?.run_id === s1.runId && cj?.rerun_index === 1,
      `退 ${c.code}，run_id ${cj?.run_id}，第 ${cj?.rerun_index} 轮`);
    const ap = await cli(fx.root, ['approve', '--topic', topic, '--stage', 'plan', '--session-id', SESSION]);
    await sleep(1100);
    const s3 = await start(fx.root, topic);
    const w3 = s3.runId ? await waitDone(fx.root, s3.runId) : null;
    const m3 = s3.runId ? await readJson(path.join(metaDir, `run-${s3.runId}.json`)).catch(() => null) : null;
    const rep = await reportJson(fx.root, topic);
    readout.A2 = { approve: ap.code, rerunStart: s3.r.code, rerunWait: w3?.code, rerunIndex: m3?.rerun_index, report: rep };
    check('A2 放行后重跑为第 2 轮', ap.code === 0 && s3.r.code === 0 && m3?.rerun_index === 2, `approve 退 ${ap.code}，重跑 rerun_index ${m3?.rerun_index}`);
    check('A2 report 时间线两行、未进时间线为空', rep.rounds.length === 2 && rep.rounds[0].runId === s1.runId && rep.rounds[1].runId === s3.runId
      && rep.unlisted.length === 0, `rounds ${JSON.stringify(rep.rounds.map((x) => x.r))}，unlisted ${rep.unlisted.length}`);
  }

  // ── A3 ──
  {
    const topic = 'A3-code便利副本';
    const fx = await fixture(base, topic);
    await git(fx.root, ['add', '-A']);
    await git(fx.root, ['commit', '-q', '-m', 'plan', '--no-verify']);
    await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
    const s1 = await start(fx.root, topic, 'code', 'C');
    if (s1.runId) await waitDone(fx.root, s1.runId);
    const codeMeta = path.join(fx.topicDir, 'code', '_meta');
    const aliasBefore = await sha(path.join(codeMeta, 'changes.diff')).catch(() => null);
    const metaBefore = await listRec(codeMeta);
    await sleep(1100);
    await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 3;\n');
    const s2 = await start(fx.root, topic, 'code', 'C');
    const aliasAfter = await sha(path.join(codeMeta, 'changes.diff')).catch(() => null);
    const metaAfter = await listRec(codeMeta);
    readout.A3 = { firstStart: s1.r.code, secondStart: s2.r.code, metaBefore: metaBefore.length, metaAfter: metaAfter.length };
    check('A3 code 被拦：便利副本与 _meta/ 不变', s1.r.code === 0 && s2.r.code === 2 && aliasBefore !== null && aliasBefore === aliasAfter
      && JSON.stringify(metaBefore) === JSON.stringify(metaAfter), `第二次退 ${s2.r.code}，changes.diff ${aliasBefore === aliasAfter ? '不变' : '变了'}，_meta/ ${metaBefore.length}→${metaAfter.length}`);
  }

  // ── A4 ──
  {
    const topic = 'A4-登记写失败';
    const fx = await fixture(base, topic);
    await fs.chmod(fx.topicDir, 0o555);
    let s;
    try {
      s = await start(fx.root, topic);
    } finally {
      await fs.chmod(fx.topicDir, 0o755);
    }
    const metaDir = path.join(fx.stageDir, '_meta');
    const ids = (await listRec(metaDir)).map((n) => /^run-(.+)\.json$/.exec(n)?.[1]).filter(Boolean);
    const skel = ids[0] ? await readJson(path.join(metaDir, `run-${ids[0]}.json`)) : null;
    const g = await gateEntry(fx, topic, 'plan');
    const locks = await fs.readdir(path.join(fx.root, TD, 'lock')).catch(() => []);
    const rep = await reportJson(fx.root, topic);
    readout.A4 = { start: s.r.code, ids, gate: g, locks, report: rep };
    check('A4 非零退出、闸门回收为 idle、锁已放', s.r.code !== 0 && g?.state === 'idle' && g?.run_id === ids[0] && !locks.includes(`${topic}.lock`),
      `退 ${s.r.code}，闸门 ${g?.state}（run ${g?.run_id}），锁 ${locks.includes(`${topic}.lock`) ? '残留' : '已放'}`);
    check('A4 骨架如实留 running，report 说明未改', ids.length === 1 && skel?.status === 'running'
      && rep.unlisted.length === 1 && rep.unlisted[0].label === '进行中，或没走到收尾', `骨架 ${skel?.status}，未进时间线 ${JSON.stringify(rep.unlisted.map((u) => u.label))}`);
  }

  // ── A5 ──
  {
    const topic = 'A5-同步路径';
    const fx = await fixture(base, topic);
    const args = ['review', '--stage', 'plan', '--topic', topic, '--focus', '验收', '--entry', 'B', '--session-id', SESSION];
    const r1 = await cli(fx.root, args);
    const archive = path.join(fx.root, '.reviews');
    const before = { files: await listRec(archive), task: await sha(fx.taskJson), gate: await gateEntry(fx, topic, 'plan'), runs: await listRec(fx.runRoot) };
    await sleep(1100);
    const r2 = await cli(fx.root, args);
    const after = { files: await listRec(archive), task: await sha(fx.taskJson), gate: await gateEntry(fx, topic, 'plan'), runs: await listRec(fx.runRoot) };
    readout.A5 = { first: r1.code, second: r2.code };
    check('A5 同步路径被拦零工件', r1.code === 0 && r2.code === 2 && JSON.stringify(before.files) === JSON.stringify(after.files)
      && before.task === after.task && JSON.stringify(before.gate) === JSON.stringify(after.gate) && JSON.stringify(before.runs) === JSON.stringify(after.runs),
      `第二次退 ${r2.code}，.reviews/ ${before.files.length}→${after.files.length}，task.json ${before.task === after.task ? '不变' : '变了'}`);
  }

  // ── A6 ──
  {
    const oldRoot = path.join(base, 'old-build');
    await fs.mkdir(oldRoot, { recursive: true });
    const archivePath = path.join(base, 'head.tar');
    // 旧构建的基线不能写死 HEAD：本主题提交之后 HEAD 就是改后代码，重跑会静默退化成自比（代码双审 r1 AGY-01）。
    // 缺省取计划 r2 提交 1ee28b0（源码与起点 bcb454e 相同）；要比别的基线用 ACCEPT_BASE_REF 覆盖
    const baseRef = process.env.ACCEPT_BASE_REF ?? '1ee28b0';
    const ar = await sh(ROOT, 'git', ['archive', '--format=tar', '-o', archivePath, baseRef, 'src', 'scripts', 'skills', 'skills-src', 'test', 'package.json', 'tsconfig.json']);
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
        if (JSON.stringify(o.rounds) !== JSON.stringify(n.rounds) || JSON.stringify(o.unlistedRuns) !== JSON.stringify(n.unlistedRuns)) diffs.push(topic);
        for (const u of n.unlistedRuns) unlisted.push({ topic, runId: u.runId, stage: u.stage, status: u.status, label: u.label });
      }
    } finally {
      console.error = origErr;
    }
    readout.A6 = { baseRef, topics, diffs, unlisted };
    check('A6 本仓 report 逐主题不变', diffs.length === 0, `${topics} 个主题，rounds / unlistedRuns 不同的：${diffs.join('、') || '无'}`);
    const ev79 = unlisted.find((u) => u.runId === '20260922T134058Z');
    check('A6 历史被拦骨架照旧在未进时间线表里', Boolean(ev79) && ev79.label === '进行中，或没走到收尾', `EV-79 20260922T134058Z：${ev79?.label ?? '未找到'}`);
  }
} finally {
  await fs.chmod(base, 0o755).catch(() => {});
  await fs.rm(base, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results, readout }, null, 2) + '\n');
process.exit(passed === results.length ? 0 : 1);
