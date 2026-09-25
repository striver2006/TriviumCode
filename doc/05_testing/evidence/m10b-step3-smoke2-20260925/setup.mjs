#!/usr/bin/env node
/**
 * M10b 第 3 步 · glm 第二轮薄冒烟的夹具搭建（零配额）。
 *
 * 目的：在 ZCode 桌面端验证第 3 步渲染出的 `.zcode/config.json`——信任流程、写入拦截、`Stop`（裁决未完成不得收工）、
 * `SessionStart`（待办注入）与停点话术。为此夹具要先处在「审查已落盘、裁决件还没写」的闸门状态：
 * 审核者用编排器自带的桩（`TRIVIUM_STUB_CRITIC`，与 selftest 同一机制），**不发起任何真实模型调用**。
 *
 * 做什么：
 *   1. mkdtemp 建夹具（仓库外，系统临时目录），git init + 首个提交；
 *   2. 用**已安装**的 CLI（`~/.claude/skills/dual-critic/scripts/trivium.cjs`，即 ZCode 会话里 wrapper 会调的那一份）跑 `init`；
 *   3. `topic claim --driver glm`，写 glm 后缀的原稿；
 *   4. `review --start`（桩：codex、gemini 各一份合规结论）→ `--wait` 到收尾；
 *   5. 读数写进本目录 `01-setup-readout.json`。
 *
 * 不删除任何东西：夹具目录的去留由用户在终端处理（清扫助手绝不在会话里指向临时目录以外，R1 / R8）。
 * 用法：node doc/05_testing/evidence/m10b-step3-smoke2-20260925/setup.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(os.homedir(), '.claude/skills/dual-critic/scripts/trivium.cjs');
const TOPIC = '冒烟二轮';
const STUB = JSON.stringify({ codex: { mode: 'ok', findings: 2 }, gemini: { mode: 'ok', findings: 1 } });

const log = [];
async function sh(bin, args, opts = {}) {
  try {
    const r = await run(bin, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
    log.push({ cmd: [bin, ...args].join(' '), code: 0, out: r.stdout.slice(-4000), err: r.stderr.slice(-2000) });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    log.push({ cmd: [bin, ...args].join(' '), code: e.code, out: (e.stdout ?? '').slice(-4000), err: (e.stderr ?? '').slice(-2000) });
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const tv = (root, args, extraEnv = {}) =>
  sh(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, TRIVIUM_ASSET_ROOT: undefined, ...extraEnv } });

const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'm10b-smoke2-'));
const root = await fs.realpath(raw);
await fs.writeFile(path.join(root, 'README.md'), '# 冒烟二轮夹具\n', 'utf8');
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(path.join(root, 'src/app.ts'), 'export const answer = 42;\n', 'utf8');
await sh('git', ['init', '-q'], { cwd: root });
await sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.'], { cwd: root });
await sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fixture'], { cwd: root });

const init = await tv(root, ['init']);
// 夹具需要本机探针结论才能过 review 的 slug 校验：拷本仓的 config.local.yaml（只含探针读数与本机路径，不含凭据）
await fs.copyFile(
  '/Users/chenzhenbo/Work/TriviumCode/.trivium/config.local.yaml',
  path.join(root, '.trivium/config.local.yaml'),
);

const claim = await tv(root, ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm', '--json']);
const today = new Date().toISOString().slice(0, 10);
const planDir = path.join(root, '.reviews', TOPIC, 'plan');
await fs.mkdir(planDir, { recursive: true });
await fs.writeFile(
  path.join(planDir, `${today}-${TOPIC}-glm.md`),
  '# 冒烟二轮 · 待审计划\n\n## 一、目标\n\n在 src/app.ts 里加一个 greet() 函数。\n',
  'utf8',
);

const start = await tv(
  root,
  ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC, '--driver', 'glm',
    '--focus', '冒烟二轮：只为造出待裁决闸门', '--critics', 'codex,gemini', '--json'],
  { TRIVIUM_STUB_CRITIC: STUB },
);
const runId = /"run_id":\s*"([^"]+)"/.exec(start.stdout)?.[1] ?? null;
let wait = null;
for (let i = 0; runId && i < 20; i++) {
  wait = await tv(root, ['review', '--wait', runId, '--timeout', '30', '--json'], { TRIVIUM_STUB_CRITIC: STUB });
  if (wait.code !== 73) break;
}
const status = await tv(root, ['status', '--json']);
const files = (await sh('git', ['status', '--porcelain', '-uall'], { cwd: root })).stdout;

const readout = {
  at: new Date().toISOString(),
  fixture: root,
  cli: CLI,
  run_id: runId,
  codes: { init: init.code, claim: claim.code, start: start.code, wait: wait?.code ?? null, status: status.code },
  fixture_files: files.split('\n').filter(Boolean),
  log,
};
await fs.writeFile(path.join(HERE, '01-setup-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ fixture: root, run_id: runId, codes: readout.codes }, null, 2));
