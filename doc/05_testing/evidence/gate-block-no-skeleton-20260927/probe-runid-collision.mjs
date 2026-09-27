#!/usr/bin/env node
/**
 * 只读实测：同步 review 连跑两次，第二次被闸门拦下。两次落在同一秒时 run_id 相同（newRunId 只到秒），
 * 核对被拦那次的骨架是否按同名覆盖了第 1 轮的 run.json 与 brief。最多试 12 次，撞上一次即停。
 * 收尾只删 mkdtemp 的返回值。用法：node probe-runid-collision.mjs <仓库根>
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
const TD = '.' + 'trivium';
const OK = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const cli = (cwd, args) => sh(cwd, process.execPath, [CLI, ...args], {
  TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: encodeStubConfig(OK), CLAUDE_SESSION_ID: SESSION,
});
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const jsonOf = (r) => { try { return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return null; } };
const ls = async (d) => (await fs.readdir(d).catch(() => [])).sort();
const sha = async (p) => (await import('node:crypto')).createHash('sha256').update(await fs.readFile(p)).digest('hex').slice(0, 12);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs-' + topic)}`,
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
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n实测。\n');
  return { root, topicDir, stageDir };
}

const out = {};
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-collide-'));
try {
  for (let i = 0; i < 12; i++) {
    const topic = `C${i}-撞秒`;
    const fx = await fixture(base, topic);
    const args = ['review', '--stage', 'plan', '--topic', topic, '--focus', '实测', '--entry', 'B', '--session-id', SESSION];
    const r1 = await cli(fx.root, args);
    const metaDir = path.join(fx.stageDir, '_meta');
    const before = await ls(metaDir);
    const firstRun = before.find((n) => /^run-/.test(n));
    const firstJson = await readJson(path.join(metaDir, firstRun));
    const briefs = before.filter((n) => /^brief-/.test(n));
    const briefShaBefore = Object.fromEntries(await Promise.all(briefs.map(async (b) => [b, await sha(path.join(metaDir, b))])));
    const r2 = await cli(fx.root, args);
    const after = await ls(metaDir);
    if (after.length !== before.length) continue; // 没撞秒，换下一个夹具
    const j = await readJson(path.join(metaDir, firstRun));
    const task = await readJson(path.join(fx.topicDir, 'task.json')).catch(() => null);
    out.collision = {
      attempt: i, firstCode: r1.code, secondCode: r2.code, runFile: firstRun,
      before: { status: firstJson.status, rerun_index: firstJson.rerun_index, artifacts: firstJson.artifacts.map((a) => path.basename(a.path)) },
      after: { status: j.status, rerun_index: j.rerun_index, artifacts: j.artifacts.map((a) => path.basename(a.path)) },
      briefsChanged: await Promise.all(briefs.map(async (b) => [b, briefShaBefore[b] !== (await sha(path.join(metaDir, b)))])),
      taskRuns: task?.runs?.map((r) => ({ run_id: r.run_id, r: r.rerun_index, status: r.status })) ?? null,
      gateCheckNoRunId: (() => null)(),
    };
    const g = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--check', '--json']);
    out.collision.gateCheckNoRunId = { code: g.code, failures: jsonOf(g)?.failures?.map((f) => f.code) ?? null };
    break;
  }
  if (!out.collision) out.collision = 'no collision in 12 attempts';
} finally {
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
