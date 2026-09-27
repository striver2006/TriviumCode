#!/usr/bin/env node
/**
 * 只读实测：阶段最新一份 run.json 读不出来时，提示里给的出口「重跑一次该阶段双审」走不走得通。
 * 构造：plan 跑一轮成功并 abandon（闸门不挡），把那份 run.json 改成不合契约的 {}，再 review --start。
 * 收尾只删 mkdtemp 的返回值。用法：node probe-corrupt-rerun.mjs <仓库根>
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
  TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: encodeStubConfig(OK), CLAUDE_SESSION_ID: 'S-probe',
});
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const pick = (r) => (r.stdout + r.stderr).split('\n').filter((l) => l && !/桩|STUB|注入配置|只应出现|同步模式/.test(l)).slice(0, 5);

const out = {};
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-corrupt-'));
try {
  const topic = 'K-留痕坏损重跑';
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs')}`,
    'review:', '  default_critics: [gemini, glm]', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const stageDir = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n实测。\n');
  const r1 = await cli(root, ['review', '--stage', 'plan', '--topic', topic, '--focus', '实测', '--entry', 'B']);
  const ab = await cli(root, ['abandon', '--topic', topic, '--stage', 'plan', '--reason', '实测']);
  const metaDir = path.join(stageDir, '_meta');
  const runFile = (await fs.readdir(metaDir)).find((n) => /^run-/.test(n));
  await fs.writeFile(path.join(metaDir, runFile), '{}\n');
  const g = await cli(root, ['gate', '--stage', 'plan', '--topic', topic, '--check']);
  await new Promise((r) => setTimeout(r, 1100));
  const r2 = await cli(root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', topic, '--focus', '实测']);
  const tr = await cli(root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', '实测', '--topic', topic]);
  out.K = {
    firstCode: r1.code, abandonCode: ab.code,
    gateCheck: { code: g.code, msg: pick(g) },
    rerunStart: { code: r2.code, msg: pick(r2) },
    topicResolve: { code: tr.code, msg: pick(tr) },
    metaAfter: (await fs.readdir(metaDir)).filter((n) => /^run-/.test(n)),
  };
} finally {
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
