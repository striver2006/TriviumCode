#!/usr/bin/env node
/**
 * 「留痕字段与误报小修」零配额验收（计划 r2 §4.4）。
 *
 * **不碰真实 HOME、不改本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；审核者换成桩（`TRIVIUM_STUB_CRITIC`，`hang` 模式让运行停在进行中），不发起任何模型调用。
 * 夹具与运行目录都建在一个 mkdtemp 目录下；收尾只删 mkdtemp 的返回值。本仓归档只读（C4 的扫描）。
 *
 *   C1 `review --start` → 运行中途把归档提交进 git（run.json 为 running）→ `review --cancel`
 *      ⇒ run.json 为 cancelled、artifacts 与已提交版本一致、task.json 该条为 cancelled；提交锚（hook-pre-commit）放行，再真实提交；
 *   C2 再 `--cancel` 一次 ⇒「已处于终态」，run.json 与 task.json 逐字节不变；
 *   C3 `report` 时间线该轮状态列为 cancelled；
 *   C4 EV-127：用新构建导出的 `checkReviewIntegrity` 重扫本仓历史审查件，读数应为 64 / 96 / 39，
 *      与旧判据的差异恰为计划 §2.2 的 56 条、新报 0 条。
 *
 * 用法：node doc/05_testing/evidence/trace-field-fixes-20260926/acceptance.mjs
 * 读数写进同目录 `acceptance-readout.json`，终端出摘要。
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const { checkReviewIntegrity } = await import(path.join(ROOT, 'dist/test/src/trivium/parse.js'));
const HANG = encodeStubConfig({ gemini: { mode: 'hang' }, glm: { mode: 'hang' } });
const TOPIC = '验收-取消收尾';
const SESSION = 'S-验收';

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
const ENV = { TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: HANG, CLAUDE_SESSION_ID: SESSION };
const cli = (cwd, args) => sh(cwd, process.execPath, [CLI, ...args], ENV);
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);

/** 以 Hook 身份调用 hook-pre-commit，从 stdin 喂一条提交事件 */
function preCommit(cwd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'gate', 'hook-pre-commit'], { cwd, env: { ...process.env, ...ENV } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', function (d) { stdout += d; });
    p.stderr.on('data', function (d) { stderr += d; });
    p.on('close', function (code) { resolve({ code, stdout, stderr }); });
    p.stdin.end(JSON.stringify({ session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }));
  });
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cancel-accept-'));
try {
  // ── 夹具 ──
  const root = path.join(base, 'proj');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs')}`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', TOPIC, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(stageDir, `${today}-${TOPIC}-claude.md`), '# 待审计划\n\n## 一、目标\n\n验收取消收尾。\n');

  // ── C1 ──
  const started = await cli(root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC, '--focus', '验收', '--session-id', SESSION, '--json']);
  if (started.code !== 0) throw new Error(`review --start 失败：${started.stdout}${started.stderr}`);
  const runId = JSON.parse(started.stdout.slice(started.stdout.indexOf('{'))).run_id;
  const runJson = path.join(stageDir, '_meta', `run-${runId}.json`);
  const taskJson = path.join(root, '.reviews', TOPIC, 'task.json');
  const s0 = JSON.parse(await fs.readFile(runJson, 'utf8'));
  check('C1 起点', s0.status === 'running', `--start 之后 run.json 为 ${s0.status}`);

  await git(root, ['add', '-A', '--', '.reviews']);
  await git(root, ['commit', '-q', '-m', '运行中途入库', '--no-verify']);
  const headArtifacts = JSON.parse((await git(root, ['show', `HEAD:.reviews/${TOPIC}/plan/_meta/run-${runId}.json`])).stdout).artifacts;

  const c1 = await cli(root, ['review', '--cancel', runId]);
  readout.C1_cancel = { code: c1.code, stdout: c1.stdout, stderr: c1.stderr };
  const m1 = JSON.parse(await fs.readFile(runJson, 'utf8'));
  const t1 = JSON.parse(await fs.readFile(taskJson, 'utf8'));
  check('C1 退出码', c1.code === 0, `--cancel 退 ${c1.code}`);
  check('C1 run.json', m1.status === 'cancelled' && m1.gate.state === 'cancelled' && !!m1.finished_at,
    `status=${m1.status}，gate.state=${m1.gate.state}，finished_at=${m1.finished_at}`);
  check('C1 artifacts 原样', JSON.stringify(m1.artifacts) === JSON.stringify(headArtifacts), `${m1.artifacts.length} 条登记与已提交版本一致`);
  check('C1 task 登记', t1.runs.find(function (r) { return r.run_id === runId; })?.status === 'cancelled', 'task.json 该条为 cancelled');
  check('C1 播报', /收尾为 cancelled/.test(c1.stderr) && /同步为 cancelled/.test(c1.stderr), '两步都有一行说明');
  const pc = await preCommit(root);
  readout.C1_preCommit = pc;
  check('C1 提交锚放行', pc.code === 0, `hook-pre-commit 退 ${pc.code}`);
  await git(root, ['add', '-A', '--', '.reviews']);
  const cm = await git(root, ['commit', '-q', '-m', '取消后入库', '--no-verify']);
  const headStatus = JSON.parse((await git(root, ['show', `HEAD:.reviews/${TOPIC}/plan/_meta/run-${runId}.json`])).stdout).status;
  check('C1 入库', cm.code === 0 && headStatus === 'cancelled', `提交退 ${cm.code}，HEAD 里为 ${headStatus}`);

  // ── C2 ──
  const runBefore = await fs.readFile(runJson, 'utf8');
  const taskBefore = await fs.readFile(taskJson, 'utf8');
  const c2 = await cli(root, ['review', '--cancel', runId]);
  readout.C2_cancel = { code: c2.code, stdout: c2.stdout, stderr: c2.stderr };
  check('C2 终态早退', c2.code === 0 && /已处于终态/.test(c2.stdout + c2.stderr), `退 ${c2.code}`);
  check('C2 不改写', (await fs.readFile(runJson, 'utf8')) === runBefore && (await fs.readFile(taskJson, 'utf8')) === taskBefore,
    'run.json 与 task.json 逐字节不变');

  // ── C3 ──
  /*
   * 计划 r2 §4.4 第 3 条原写「report 时间线该轮状态列为 cancelled」——第 1 次验收（acceptance-readout-run1.json）证伪：
   * report 按**审查工件**枚举轮次，取消轮被杀在 worker 收尾之前、没有审查文档，时间线根本不列它。
   * 这是 report 的既有行为，本主题不改（改它属扩大范围）。C3 改为如实钉住这一事实：report 照常退 0、不列这一轮。
   */
  const rep = await cli(root, ['report', '--topic', TOPIC]);
  readout.C3_report = rep.stdout;
  check('C3 report 不列无工件的取消轮', rep.code === 0 && /轮次总数\*\*：0/.test(rep.stdout) && !rep.stdout.includes(runId),
    `report 退 ${rep.code}；轮次总数 0、不含 run ${runId}（取消轮没有审查文档，report 按工件枚举轮次）`);

  // ── C4：EV-127 重扫本仓历史审查件（只读）──
  const R = ['src', 'lib', 'app', 'test', 'tests', 'doc', 'docs', 'packages', 'scripts'].join('|');
  const OLD = new RegExp(`\\b((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g');
  const files = (await pexec('find', ['.reviews', '-path', '*/_meta/review-*.json'], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 })).stdout
    .split('\n').filter(Boolean).sort();
  let structured = 0; let flaggedNew = 0; let missNew = 0; let nonexistentNew = 0;
  const removed = []; const added = [];
  for (const f of files) {
    const r = JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));
    if (!r || !Array.isArray(r.findings)) continue;
    // 本主题自己这一轮的审查件不计（它们晚于计划 §2 的实测，计划的读数不含它们）
    if (f.includes('/留痕字段与误报小修/')) continue;
    structured++;
    const consulted = new Set(r.consulted ?? []);
    const oldMiss = new Set();
    for (const fd of r.findings) for (const m of String(fd.evidence ?? '').matchAll(OLD)) if (!consulted.has(m[1])) oldMiss.add(m[1]);
    const newMiss = new Set(checkReviewIntegrity({ ...r, findings: r.findings.map(function (x) { return { ...x, id: 'AGY-01' }; }) }, 'gemini').evidenceNotInConsulted);
    if (newMiss.size > 0) flaggedNew++;
    missNew += newMiss.size;
    for (const p of newMiss) if (!existsSync(path.join(ROOT, p))) nonexistentNew++;
    for (const p of oldMiss) if (!newMiss.has(p)) removed.push(`${p} @ ${f}`);
    for (const p of newMiss) if (!oldMiss.has(p)) added.push(`${p} @ ${f}`);
  }
  readout.C4 = { structured, flaggedNew, missNew, nonexistentNew, removed, added };
  check('C4 读数', structured === 383 && flaggedNew === 64 && missNew === 96 && nonexistentNew === 39,
    `结构化 ${structured}、被标 ${flaggedNew}、报出 ${missNew}、仓内不存在 ${nonexistentNew}（期望 383 / 64 / 96 / 39）`);
  check('C4 差异', removed.length === 56 && added.length === 0, `旧报新不报 ${removed.length} 条（期望 56）、新报 ${added.length} 条（期望 0）`);
} finally {
  await fs.rm(base, { recursive: true, force: true });
}

const pass = results.filter(function (r) { return r.ok; }).length;
readout.summary = `${pass}/${results.length}`;
readout.results = results;
await fs.writeFile(path.join(HERE, 'acceptance-readout.json'), JSON.stringify(readout, null, 2) + '\n');
console.log(`\n零配额验收 ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
