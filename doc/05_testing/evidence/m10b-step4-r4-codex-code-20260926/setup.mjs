#!/usr/bin/env node
/**
 * M10b 第 4 步 3-4 轮（codex 真载体 · code · 夹具）的夹具搭建。只搭夹具，**不发起审查、不认领**（code 轮无认领步）。
 *
 *   1. mkdtemp 建夹具（仓库外），放一个小 TS 工程：`src/slug.ts`（朴素的 slugify）、README 写明待实现的小任务、
 *      `NOTES.md`（EV-77 写事件用：不进 diff、不进 `--context`，审查进行中改它判 `unrelated` 漂移）；git init + 首个提交；
 *   2. 用**已安装**的 CLI（`~/.claude/skills/dual-critic/scripts/trivium.cjs`）跑 `init`；拷本仓 `.trivium/config.local.yaml`（只含探针读数，无凭据）；
 *   3. 把 init 产物逐个路径 `git add` 后提交（同 3-2），使 code 阶段补丁只含 codex 会话的业务改动。
 *
 * 审核者 claude、gemini 用夹具缺省档（claude-sonnet-5、gemini-3.8-flash-high）；codex 是 Driver，不作审核者，夹具配置不换档。
 * 读数写进本目录 `01-setup-readout.json`。不删除任何东西（R1 / R8）。
 * 用法：node doc/05_testing/evidence/m10b-step4-r4-codex-code-20260926/setup.mjs
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
const ID = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid'];
const INIT_PATHS = ['.claude', '.gitignore', '.reviews', '.trivium', '.zcode', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

const log = [];
async function sh(bin, args, opts = {}) {
  try {
    const r = await run(bin, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
    log.push({ cmd: [bin, ...args].join(' '), code: 0, out: r.stdout.slice(-3000), err: r.stderr.slice(-1500) });
    return { code: 0, stdout: r.stdout };
  } catch (e) {
    log.push({ cmd: [bin, ...args].join(' '), code: e.code, out: (e.stdout ?? '').slice(-3000), err: (e.stderr ?? '').slice(-1500) });
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '' };
  }
}
const tv = (root, args) => sh(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, TRIVIUM_ASSET_ROOT: undefined } });

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'm10b-s4r4-')));
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(
  path.join(root, 'README.md'),
  [
    '# 夹具：slug 生成',
    '',
    '`src/slug.ts` 的 `slugify` 把标题转成 URL 片段，供 M10b 第 4 步 3-4 轮代码审查使用。',
    '',
    '## 待实现',
    '',
    '现有实现只做小写与空白换横线，有三个问题要修：',
    '',
    '1. 连续的空白或标点会产生连续横线（`a  b` → `a--b`），应折叠成一个；',
    '2. 首尾的横线应去掉（` hi! ` → `hi`）；',
    '3. 增加可选参数 `maxLength`：超长时截断，且不在单词中间截断、截断后不以横线结尾。',
    '',
    '只保留 ASCII 字母、数字与横线；其余字符视为分隔符。调用方式 `slugify(title)` 保持不变。',
    '',
  ].join('\n'),
  'utf8',
);
await fs.writeFile(path.join(root, 'NOTES.md'), '# 开发笔记\n\n（随手记录，不属于交付物。）\n', 'utf8');
await fs.writeFile(
  path.join(root, 'src/slug.ts'),
  [
    '/** 把标题转成 URL 片段 */',
    'export function slugify(title: string): string {',
    "  return title.toLowerCase().replace(/\\s/g, '-');",
    '}',
    '',
  ].join('\n'),
  'utf8',
);
await sh('git', ['init', '-q'], { cwd: root });
await sh('git', [...ID, 'add', '.'], { cwd: root });
await sh('git', [...ID, 'commit', '-q', '-m', 'fixture'], { cwd: root });

const init = await tv(root, ['init']);
await fs.copyFile('/Users/chenzhenbo/Work/TriviumCode/.trivium/config.local.yaml', path.join(root, '.trivium/config.local.yaml'));
for (const p of INIT_PATHS) await sh('git', [...ID, 'add', '--', p], { cwd: root });
await sh('git', [...ID, 'commit', '-q', '-m', 'fixture: init 产物'], { cwd: root });
const head = (await sh('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const status = (await sh('git', ['status', '--short'], { cwd: root })).stdout;
const tracked = (await sh('git', ['ls-files'], { cwd: root })).stdout.split('\n').filter(Boolean);

const readout = { at: new Date().toISOString(), fixture: root, cli: CLI, codes: { init: init.code }, head, tracked, status_after: status, log };
await fs.writeFile(path.join(HERE, '01-setup-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ fixture: root, head, init: init.code, tracked_count: tracked.length, status_after: status }, null, 2));
