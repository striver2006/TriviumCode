#!/usr/bin/env node
/**
 * M10b 第 4 步 3-1 轮（claude · plan · 夹具）的夹具搭建。只搭夹具与认领，**不发起审查**。
 *
 *   1. mkdtemp 建夹具（仓库外），放一个小 TS 工程，git init + 首个提交；
 *   2. 用**已安装**的 CLI（`~/.claude/skills/dual-critic/scripts/trivium.cjs`）跑 `init`；
 *      拷本仓 `.trivium/config.local.yaml`（只含探针读数，无凭据）以过 review 的 slug 校验；
 *   3. `topic claim --stage plan --driver claude`（命令 B 第 0 步）。
 *
 * 读数写进本目录 `01-setup-readout.json`。不删除任何东西（R1 / R8）。
 * 用法：node doc/05_testing/evidence/m10b-step4-r1-claude-plan-20260925/setup.mjs
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
const TOPIC = '限流器重构';

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

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'm10b-s4r1-')));
await fs.mkdir(path.join(root, 'src'), { recursive: true });
await fs.writeFile(path.join(root, 'README.md'), '# 夹具：限流器\n\n一个固定窗口限流器，供 M10b 第 4 步 3-1 轮计划审查使用。\n', 'utf8');
await fs.writeFile(
  path.join(root, 'src/limiter.ts'),
  [
    '/** 固定窗口限流：每个 key 在 windowMs 内最多放行 limit 次 */',
    'export class FixedWindowLimiter {',
    '  private readonly hits = new Map<string, { start: number; count: number }>();',
    '  constructor(private readonly limit: number, private readonly windowMs: number) {}',
    '',
    '  allow(key: string, now: number = Date.now()): boolean {',
    '    const cur = this.hits.get(key);',
    '    if (!cur || now - cur.start >= this.windowMs) {',
    '      this.hits.set(key, { start: now, count: 1 });',
    '      return true;',
    '    }',
    '    if (cur.count >= this.limit) return false;',
    '    cur.count++;',
    '    return true;',
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
const claim = await tv(root, ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'claude', '--json']);

const readout = { at: new Date().toISOString(), fixture: root, cli: CLI, topic: TOPIC, codes: { init: init.code, claim: claim.code }, log };
await fs.writeFile(path.join(HERE, '01-setup-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ fixture: root, topic: TOPIC, codes: readout.codes }, null, 2));
