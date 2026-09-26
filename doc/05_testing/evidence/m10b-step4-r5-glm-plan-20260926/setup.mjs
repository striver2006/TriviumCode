#!/usr/bin/env node
/**
 * M10b 第 4 步 3-5 轮（glm 真载体 · plan · J4）的夹具搭建。只搭夹具，**不认领、不发起审查**——
 * 认领是命令 B 第 0 步，由 ZCode 会话自己执行（操作卡第 3 步），J4 才完整。
 *
 *   1. mkdtemp 建夹具（仓库外），放一个小 TS 工程：`src/config.ts`（只读 JSON 的配置加载），README 写明本轮要出计划的需求；git init + 首个提交；
 *   2. 用**已安装**的 CLI 跑 `init`（会渲染 `.zcode/config.json`，即 glm 的尽力拦截 Hook）；拷本仓 `.trivium/config.local.yaml`（只含探针读数，无凭据）；
 *   3. 把夹具配置里 codex 的 `-p` 档与模型槽换成 deepseek / deepseek-flash（同 3-3）。codex 本轮**不是**审核者（用户定 `claude,gemini`），
 *      换档只为入口 skill 的预检：它不带 `--critics`（EV-126），会按缺省集合减去 Driver 探活 codex 与 gemini，
 *      缺省 `-p qwen` 连本机代理，与用户现行配置不一致（EV-130）。每处替换断言恰好命中一次；
 *   4. init 产物逐个路径 `git add` 后提交，工作区干净，会话写的原稿与裁决件之外不应出现别的改动。
 *
 * 读数写进本目录 `01-setup-readout.json`。不删除任何东西（R1 / R8）。**不跑任何 zcode 调用**（r10 §4.1 第 3 条）。
 * 用法：node doc/05_testing/evidence/m10b-step4-r5-glm-plan-20260926/setup.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
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
const sha = (s) => createHash('sha256').update(s).digest('hex');

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'm10b-s4r5-')));
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(
  path.join(root, 'README.md'),
  [
    '# 夹具：配置加载',
    '',
    '`src/config.ts` 的 `loadConfig` 只读一个 JSON 文件，供 M10b 第 4 步 3-5 轮计划审查使用。',
    '',
    '## 需求（本轮先出计划，不写代码）',
    '',
    '1. 支持环境变量覆盖：`APP_<KEY>` 覆盖同名顶层键，值按原键的类型转换（数字、布尔、字符串）；',
    '2. 配置文件缺失时回退到内置默认值，而不是抛错；文件存在但 JSON 损坏时仍要报错，并指出文件路径；',
    '3. 加载结果只读（调用方改不动），且同一进程内只读一次文件。',
    '',
    '调用方式 `loadConfig(path)` 保持不变。',
    '',
  ].join('\n'),
  'utf8',
);
await fs.writeFile(
  path.join(root, 'src/config.ts'),
  [
    "import { readFileSync } from 'node:fs';",
    '',
    'export interface AppConfig {',
    '  port: number;',
    '  debug: boolean;',
    '  name: string;',
    '}',
    '',
    '/** 读取 JSON 配置文件 */',
    'export function loadConfig(path: string): AppConfig {',
    "  return JSON.parse(readFileSync(path, 'utf8')) as AppConfig;",
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

// 3. codex 两个维度一起换（见文件头第 3 条；正则同 3-3 的 setup.mjs）
const cfgPath = path.join(root, '.trivium/config.yaml');
const before = await fs.readFile(cfgPath, 'utf8');
const edits = [
  { what: 'agents.codex.profile', re: /(\n  codex:\n    vendor: openai\n(?:    .*\n)*?    profile: )qwen\n/, to: '$1deepseek\n' },
  { what: 'profiles.default.codex', re: /(\n    codex:\n      plan: )qwen3\.8-max\n      code: qwen3\.8-max\n      bug: qwen3\.8-max\n/, to: '$1deepseek-flash\n      code: deepseek-flash\n      bug: deepseek-flash\n' },
  { what: 'profiles.flash.codex', re: /(\n    codex:\n      plan: )qwen3\.8-flash\n      code: qwen3\.8-flash\n      bug: qwen3\.8-flash\n/, to: '$1deepseek-flash\n      code: deepseek-flash\n      bug: deepseek-flash\n' },
];
let after = before;
const editLog = [];
for (const e of edits) {
  const hits = after.match(new RegExp(e.re.source, 'g'))?.length ?? 0;
  if (hits !== 1) throw new Error(`${e.what}：期望恰好命中 1 处，实际 ${hits} 处；夹具留在 ${root}`);
  after = after.replace(e.re, e.to);
  editLog.push({ what: e.what, hits });
}
await fs.writeFile(cfgPath, after, 'utf8');

for (const p of INIT_PATHS) await sh('git', [...ID, 'add', '--', p], { cwd: root });
await sh('git', [...ID, 'commit', '-q', '-m', 'fixture: init 产物'], { cwd: root });
const head = (await sh('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const status = (await sh('git', ['status', '--short'], { cwd: root })).stdout;
const tracked = (await sh('git', ['ls-files'], { cwd: root })).stdout.split('\n').filter(Boolean);
const zcodeCfg = await fs.readFile(path.join(root, '.zcode/config.json'), 'utf8');

const readout = {
  at: new Date().toISOString(),
  fixture: root,
  cli: CLI,
  codes: { init: init.code },
  config_codex_switch: { edits: editLog, sha256_before: sha(before), sha256_after: sha(after) },
  zcode_config_sha256: sha(zcodeCfg),
  head,
  tracked,
  status_after: status,
  log,
};
await fs.writeFile(path.join(HERE, '01-setup-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ fixture: root, head, init: init.code, config_codex_switch: editLog, tracked_count: tracked.length, status_after: status }, null, 2));
