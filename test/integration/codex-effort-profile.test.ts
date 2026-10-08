/**
 * codex 适配器 `run()` 的发起值（M11 第 6 步，计划 r2 §2.2 / §3.1 A、E、P 组）：零配额，假 codex + 钉住的 `CODEX_HOME`。
 *
 * 纯函数单测（`codexInvocationOf` / `buildCodexArgs`）守不到 `run()` 里那几处取值——此前 `run()` 全程读
 * `agents.codex.profile`，第 6 步改取 `req.profile_requested`。这里真跑一次 `run()`，从假 codex 的视角核：
 * ①argv 的 `-p` 与 `-c model_reasoning_effort=` 是请求里的三层解析值，不是配置段；
 * ②隔离副本里拷进来的 profile 分层文件是同一家（`prepareCodexHome` 与 `-p` 同值）；
 * ③失败出口的 `profile_requested` 也是它；
 * ④会话文件里 `turn_context.payload.effort` 写着请求值的回显——`effortReadback` 照样落 null + unverified，不拿回显冒充。
 *
 * 装置照 `codex-scrub.test.ts`：假宿主机 `CODEX_HOME` 只放无凭据的最小 toml（不写任何凭据形态的字面量）。
 * 末一格（X4）对 claude 适配器 `run()` 做同样的事：核 `--effort` 真的从请求递进了 argv。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { codexAdapter } from '../../src/trivium/adapters/codex.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { scratchDir } from '../helpers/scratch.js';
import type { Config, CriticRequest } from '../../src/trivium/types.js';

let work = '';
let fakeBin = '';
let seenFile = '';
const savedCodexHome = process.env['CODEX_HOME'];

before(async () => {
  work = await scratchDir('trivium-codex-effort-');
  const src = path.join(work, 'src-home');
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(path.join(src, 'config.toml'), 'model = "qwen3.8-max"\n');
  await fs.writeFile(path.join(src, 'qwen.config.toml'), 'model = "qwen3.8-max"\n');
  await fs.writeFile(path.join(src, 'deepseek.config.toml'), 'model = "deepseek-v4-pro"\n');
  process.env['CODEX_HOME'] = src;

  seenFile = path.join(work, 'seen.json');
  const script = path.join(work, 'fake-codex.cjs');
  await fs.writeFile(script, `
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.CODEX_HOME;
fs.writeFileSync(process.env.FAKE_CODEX_SEEN, JSON.stringify({ argv: process.argv.slice(2), home: fs.readdirSync(home).sort() }));
const sdir = path.join(home, 'sessions', '2026', '10', '08');
fs.mkdirSync(sdir, { recursive: true });
// 会话文件：首行 session_meta（生效模型回读面），第二行 turn_context 原样回显请求的思考等级（M11 第 1 步 F3）
const p = process.argv.slice(2);
const effort = (p[p.indexOf('-c') + 1] || '').split('=')[1] || null;
fs.writeFileSync(path.join(sdir, 'rollout-2026-10-08-T9.jsonl'),
  JSON.stringify({ type: 'session_meta', payload: { session_id: 'T9', model_provider: 'deepseek', cli_version: '9.9.9', base_instructions: { provenance: { model: 'deepseek-v4-pro' } } } }) + '\\n' +
  JSON.stringify({ type: 'turn_context', payload: { effort } }) + '\\n');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.resume();
process.stdin.on('end', () => {
  emit({ type: 'thread.started', thread_id: 'T9' });
  if (process.env.FAKE_CODEX_MODE === 'silent') process.exit(0);
  emit({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } });
  emit({ type: 'turn.completed' });
  process.exit(0);
});
`);
  fakeBin = path.join(work, 'codex');
  await fs.writeFile(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  process.env['FAKE_CODEX_SEEN'] = seenFile;
});

after(() => {
  if (savedCodexHome === undefined) delete process.env['CODEX_HOME'];
  else process.env['CODEX_HOME'] = savedCodexHome;
  delete process.env['FAKE_CODEX_SEEN'];
  delete process.env['FAKE_CODEX_MODE'];
});

/** 配置段是 qwen；请求里是本轮解析出的 deepseek（档位条目或 --profile-codex） */
function cfgWith(): Config {
  const cfg = defaultConfig();
  Object.assign(cfg.probe.cli.codex!, {
    probed_at: new Date().toISOString(), entrypoint: fakeBin, version: '9.9.9',
    readonly_flags: ['-s', 'read-only'], exec_headless_read_ok: true,
  });
  (cfg.agents.codex as { bin: string | null; profile: string | null }).bin = fakeBin;
  (cfg.agents.codex as { bin: string | null; profile: string | null }).profile = 'qwen';
  return cfg;
}

async function req(name: string, over: Partial<CriticRequest> = {}): Promise<CriticRequest> {
  const run = path.join(work, name);
  const proj = path.join(run, 'proj');
  await fs.mkdir(proj, { recursive: true });
  return {
    run_id: 'R1', topic: 't', stage: 'plan', critic: 'codex',
    project_root: proj, subject_path: path.join(proj, 's.md'), deny_paths: [],
    out_dir: path.join(run, 'codex', 'out'), brief_path: path.join(proj, 'b.md'), brief_text: 'BRIEF',
    model: 'deepseek-v4-pro', effort: 'max', timeout_s: 60, schema_path: '/s.json',
    min_tool_calls: 0, min_project_reads: 0, profile_requested: 'deepseek', tier: 'high', tier_source: 'profile',
    ...over,
  };
}

const seen = async () => JSON.parse(await fs.readFile(seenFile, 'utf8')) as { argv: string[]; home: string[] };

test('X1 run()：-p 与隔离副本的 profile 分层文件都是请求里的解析值（deepseek），不是配置段（qwen）；-c 带请求的思考等级', async () => {
  delete process.env['FAKE_CODEX_MODE'];
  const r = await codexAdapter.run({ cfg: cfgWith(), nodePath: process.execPath }, await req('x1'));
  assert.equal(r.status, 'ok', r.fail_reason ?? '');
  const s = await seen();
  assert.equal(s.argv[s.argv.indexOf('-p') + 1], 'deepseek', s.argv.join(' '));
  assert.equal(s.argv[s.argv.indexOf('-c') + 1], 'model_reasoning_effort=max');
  assert.ok(s.home.includes('deepseek.config.toml'), `副本里要有 deepseek 的分层文件：${s.home.join(', ')}`);
  assert.ok(!s.home.includes('qwen.config.toml'), '配置段那一家不该被拷进来');
  assert.equal(r.profile_requested, 'deepseek');
  // 会话文件回显了 effort=max，但那是请求回显——生效值只取回读面，codex 没有
  assert.deepEqual(codexAdapter.effortReadback(r), { effective: null, source: 'unverified' });
});

test('X2 run()：请求没有厂商 profile、没有思考等级 ⇒ 不带 -p 也不带 -c（裸 slug 且配置段为空的形态）', async () => {
  delete process.env['FAKE_CODEX_MODE'];
  const cfg = cfgWith();
  (cfg.agents.codex as { profile: string | null }).profile = null;
  const r = await codexAdapter.run({ cfg, nodePath: process.execPath }, await req('x2', { profile_requested: null, effort: undefined, model: 'qwen3.8-max' }));
  assert.equal(r.status, 'ok', r.fail_reason ?? '');
  const s = await seen();
  assert.ok(!s.argv.includes('-p') && !s.argv.includes('-c'), s.argv.join(' '));
});

test('X3 失败出口：profile_requested 也是请求里的解析值', async () => {
  process.env['FAKE_CODEX_MODE'] = 'silent';
  const r = await codexAdapter.run({ cfg: cfgWith(), nodePath: process.execPath }, await req('x3'));
  assert.equal(r.status, 'failed');
  assert.equal(r.profile_requested, 'deepseek');
  assert.deepEqual(codexAdapter.effortReadback(r), { effective: null, source: 'unverified' });
});

/*
 * claude 适配器 `run()` 同理（M11 第 6 步新增 `--effort`）：纯函数单测守不到 `run()` 把 `req.effort` 递进 `invokeClaude` 那一处。
 * 假 claude 只记下 argv、吐最小的 stream-json；不涉及凭据与模型调用。
 */
test('X4 claude run()：请求的思考等级以 --effort 下传；生效值仍落 null + unverified（init / result 没有 effort 字段）', async () => {
  const seenClaude = path.join(work, 'seen-claude.json');
  const script = path.join(work, 'fake-claude.cjs');
  await fs.writeFile(script, `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(seenClaude)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5', session_id: 'S1', tools: ['Read'] }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'S1' }) + '\\n');
  process.exit(0);
});
`);
  const bin = path.join(work, 'claude');
  await fs.writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const cfg = defaultConfig();
  Object.assign(cfg.probe.cli.claude!, {
    probed_at: new Date().toISOString(), entrypoint: bin, version: '2.1.291',
    readonly_flags: ['--tools', 'Read,Grep,Glob'], json_schema_ok: false,
    effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  });
  const { claudeAdapter } = await import('../../src/trivium/adapters/claude.js');
  const r = await claudeAdapter.run({ cfg, nodePath: process.execPath }, await req('x4', { critic: 'claude', model: 'claude-sonnet-5', effort: 'xhigh', profile_requested: null }));
  const argv = JSON.parse(await fs.readFile(seenClaude, 'utf8')) as string[];
  assert.equal(argv[argv.indexOf('--effort') + 1], 'xhigh', argv.join(' '));
  assert.deepEqual(claudeAdapter.effortReadback(r), { effective: null, source: 'unverified' });

  await claudeAdapter.run({ cfg, nodePath: process.execPath }, await req('x5', { critic: 'claude', model: 'claude-sonnet-5', effort: undefined, profile_requested: null }));
  assert.ok(!(JSON.parse(await fs.readFile(seenClaude, 'utf8')) as string[]).includes('--effort'), '没有请求值就不传');
});
