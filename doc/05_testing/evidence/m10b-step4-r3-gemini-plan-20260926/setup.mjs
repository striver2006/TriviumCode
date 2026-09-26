#!/usr/bin/env node
/**
 * M10b 第 4 步 3-3 轮（gemini 名义 Driver · plan · 夹具）的夹具搭建。只搭夹具与认领，**不发起审查**。
 *
 *   1. mkdtemp 建夹具（仓库外），放一个小 TS 工程（无过期的 LRU 缓存），git init + 首个提交；
 *   2. 用**已安装**的 CLI（`~/.claude/skills/dual-critic/scripts/trivium.cjs`）跑 `init`；
 *      拷本仓 `.trivium/config.local.yaml`（只含探针读数，无凭据）以过 review 的 slug 校验；
 *   3. 把夹具配置里 codex 的 `-p` 档与模型槽改成 deepseek / deepseek-flash（用户 2026-09-26 定，与本仓
 *      `.trivium/config.yaml` 同口径）：`init` 落盘的缺省配置是 `profile: qwen` + `qwen3.8-max`，
 *      只改 `~/.codex` 的默认模型不会生效——编排器显式传 `-p` / `-m`。两个维度一起换，免得组成
 *      `-p qwen -m deepseek-flash` 被端点拒绝；每处替换断言恰好命中一次，改前改后 sha256 记进读数；
 *   4. `topic claim --stage plan --driver gemini`（命令 B 第 0 步；gemini 是名义 Driver，由 Claude 会话代执笔）。
 *
 * 读数写进本目录 `01-setup-readout.json`。不删除任何东西（R1 / R8）。
 * 用法：node doc/05_testing/evidence/m10b-step4-r3-gemini-plan-20260926/setup.mjs
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
const TOPIC = '缓存过期策略';

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

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'm10b-s4r3-')));
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(path.join(root, 'README.md'), '# 夹具：LRU 缓存\n\n一个不带过期的 LRU 缓存，供 M10b 第 4 步 3-3 轮计划审查使用。\n', 'utf8');
await fs.writeFile(
  path.join(root, 'src/cache.ts'),
  [
    '/** 容量上限的 LRU 缓存：超出 capacity 时淘汰最久未访问的条目。没有过期。 */',
    'export class LruCache<V> {',
    '  private readonly map = new Map<string, V>();',
    '  constructor(private readonly capacity: number) {',
    "    if (capacity <= 0) throw new RangeError('capacity 必须为正');",
    '  }',
    '',
    '  get(key: string): V | undefined {',
    '    if (!this.map.has(key)) return undefined;',
    '    const v = this.map.get(key)!;',
    '    this.map.delete(key);',
    '    this.map.set(key, v);',
    '    return v;',
    '  }',
    '',
    '  set(key: string, value: V): void {',
    '    if (this.map.has(key)) this.map.delete(key);',
    '    this.map.set(key, value);',
    '    if (this.map.size > this.capacity) {',
    '      const oldest = this.map.keys().next().value as string;',
    '      this.map.delete(oldest);',
    '    }',
    '  }',
    '',
    '  get size(): number {',
    '    return this.map.size;',
    '  }',
    '}',
    '',
  ].join('\n'),
  'utf8',
);
await sh('git', ['init', '-q'], { cwd: root });
await sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.'], { cwd: root });
await sh('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fixture'], { cwd: root });

const init = await tv(root, ['init']);
await fs.copyFile('/Users/chenzhenbo/Work/TriviumCode/.trivium/config.local.yaml', path.join(root, '.trivium/config.local.yaml'));

// 3. codex 两个维度一起换（见文件头第 3 条）
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
  if (hits !== 1) throw new Error(`${e.what}：期望恰好命中 1 处，实际 ${hits} 处；夹具留在 ${root}，未做任何替换以外的改动`);
  after = after.replace(e.re, e.to);
  editLog.push({ what: e.what, hits });
}
await fs.writeFile(cfgPath, after, 'utf8');

const claim = await tv(root, ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'gemini', '--json']);

const readout = {
  at: new Date().toISOString(),
  fixture: root,
  cli: CLI,
  topic: TOPIC,
  codes: { init: init.code, claim: claim.code },
  config_codex_switch: { edits: editLog, sha256_before: sha(before), sha256_after: sha(after) },
  log,
};
await fs.writeFile(path.join(HERE, '01-setup-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ fixture: root, topic: TOPIC, codes: readout.codes, config_codex_switch: editLog }, null, 2));
