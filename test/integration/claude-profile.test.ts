/** 真实包装器子进程；全部配置与输出都是夹具，不调用模型服务。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { scratchDir } from '../helpers/scratch.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { invokeClaude } from '../../src/trivium/adapters/claude.js';
import { resolveClaudeRoute, claudeProbeForRoute } from '../../src/trivium/adapters/claude-route.js';
import { claudeAdapter } from '../../src/trivium/adapters/claude.js';

// WIN_FILE_SKIP（Windows 移植）：shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）');
} else {

test('Claude 包装器收到长profile、print、模型、effort和stdin；认证清理且指纹轮换失效', async () => {
  const root = await scratchDir('trivium-cld-fixture-');
  const old = { HOME: process.env.HOME, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  try {
    process.env.HOME = root; process.env.ANTHROPIC_AUTH_TOKEN = 'fixture-parent';
    process.env.ANTHROPIC_MODEL = 'fixture-other'; process.env.CLAUDE_CODE_OAUTH_TOKEN = 'fixture-parent';
    const dir = path.join(root, '.claude', 'profiles'); await fs.mkdir(dir, { recursive: true });
    const profile = path.join(dir, 'qwen.env');
    await fs.writeFile(profile, 'export ANTHROPIC_MODEL=qwen3.8-flash\n');
    const wrapper = path.join(root, 'cld'); const capture = path.join(root, 'capture.json');
    await fs.writeFile(wrapper, `#!${process.execPath}\n` + [
      'const fs = require("node:fs");',
      'let stdin=""; process.stdin.on("data", chunk => stdin += chunk);',
      'process.stdin.on("end", () => {',
      `fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ argv: process.argv.slice(2), stdin, auth: process.env.ANTHROPIC_AUTH_TOKEN ?? null, oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null, modelEnv: process.env.ANTHROPIC_MODEL ?? null }));`,
      'process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"OK"}) + "\\n");', '});', '',
    ].join('\n'), { mode: 0o700 });
    const cfg = defaultConfig(); const agent = cfg.agents.claude;
    assert.ok(agent?.vendor === 'anthropic'); agent.profile_bin = wrapper; agent.bin = process.execPath;
    const route = resolveClaudeRoute(cfg, 'qwen');
    const out = await invokeClaude({ bin: wrapper, route, cwd: root, prompt: '夹具正文', model: 'qwen3.8-max', effort: 'high',
      readonlyArgs: ['--tools', 'Read,Grep,Glob'], schemaJson: null, settingsJson: null, timeoutMs: 10_000 });
    assert.equal(out.exitCode, 0);
    const got = JSON.parse(await fs.readFile(capture, 'utf8'));
    assert.deepEqual(got.argv.slice(0, 3), ['--profile', 'qwen', '--print']);
    assert.equal(got.argv[got.argv.indexOf('--model') + 1], 'qwen3.8-max');
    assert.equal(got.argv[got.argv.indexOf('--effort') + 1], 'high'); assert.equal(got.stdin, '夹具正文');
    assert.equal(got.auth, null); assert.equal(got.oauth, null); assert.equal(got.modelEnv, null);
    cfg.probe.cli.claude!.routes = { 'profile:qwen': { profile: 'qwen', fingerprint: route.fingerprint, probe: { ...cfg.probe.cli.claude! } } };
    assert.ok(claudeProbeForRoute(cfg, 'qwen'));
    await fs.appendFile(wrapper, '\n// fixture rotation\n');
    assert.equal(claudeProbeForRoute(cfg, 'qwen'), undefined);
    const changed = resolveClaudeRoute(cfg, 'qwen'); assert.notEqual(changed.wrapperSha256, route.wrapperSha256);
    cfg.probe.cli.claude!.routes['profile:qwen']!.fingerprint = changed.fingerprint;
    assert.ok(claudeProbeForRoute(cfg, 'qwen'));
    await fs.appendFile(profile, 'export ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3.8-max\n');
    assert.notEqual(resolveClaudeRoute(cfg, 'qwen').configurationSha256, changed.configurationSha256);
    assert.equal(claudeProbeForRoute(cfg, 'qwen'), undefined);
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('Claude 原生子进程不带profile前缀，保留官方OAuth且登录凭据轮换改指纹', async () => {
  const root = await scratchDir('trivium-cld-fixture-');
  const old = { HOME: process.env.HOME, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL };
  try {
    process.env.HOME = root; process.env.CLAUDE_CODE_OAUTH_TOKEN = 'fixture-oauth';
    process.env.ANTHROPIC_AUTH_TOKEN = 'fixture-conflict'; process.env.ANTHROPIC_MODEL = 'fixture-other';
    const bin = path.join(root, 'claude'); const capture = path.join(root, 'native.json');
    await fs.writeFile(bin, `#!${process.execPath}\nconst fs=require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({argv:process.argv.slice(2),input,oauth:process.env.CLAUDE_CODE_OAUTH_TOKEN,auth:process.env.ANTHROPIC_AUTH_TOKEN??null,model:process.env.ANTHROPIC_MODEL??null}));console.log('OK');});\n`, { mode: 0o700 });
    const cfg = defaultConfig(); const agent = cfg.agents.claude;
    assert.ok(agent?.vendor === 'anthropic'); agent.bin = bin;
    const route = resolveClaudeRoute(cfg, null);
    const out = await invokeClaude({ bin: route.bin!, route, cwd: root, prompt: '原生正文', model: 'claude-fable-5-1', effort: null,
      readonlyArgs: ['--tools', 'Read,Grep,Glob'], schemaJson: null, settingsJson: null, timeoutMs: 10_000 });
    assert.equal(out.spawned, true); assert.equal(out.exitCode, 0);
    const got = JSON.parse(await fs.readFile(capture, 'utf8'));
    assert.equal(got.argv[0], '--print'); assert.ok(!got.argv.includes('--profile'));
    assert.equal(got.oauth, 'fixture-oauth'); assert.equal(got.auth, null); assert.equal(got.model, null);
    assert.equal(got.input, '原生正文');
    const auth = claudeAdapter.authProbe!({ cfg, nodePath: process.execPath }, root,
      { vendorProfile: null, model: 'claude-fable-5-1', effort: null });
    const before = await auth.fingerprint();
    await fs.mkdir(path.join(root, '.claude'), { recursive: true });
    await fs.writeFile(path.join(root, '.claude', '.credentials.json'), JSON.stringify({ fixture: 'rotation' }));
    assert.notEqual(await auth.fingerprint(), before);
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('不同路线版本互不作废，未测或证伪的拒绝轨迹能力保持保守', async () => {
  const root = await scratchDir('trivium-cld-fixture-'); const oldHome = process.env.HOME;
  try {
    process.env.HOME = root;
    const dir = path.join(root, '.claude', 'profiles'); await fs.mkdir(dir, { recursive: true });
    for (const name of ['qwen','kimi']) await fs.writeFile(path.join(dir, `${name}.env`), 'export ANTHROPIC_MODEL=fixture-model\n');
    const wrapper = path.join(root, 'cld'); await fs.writeFile(wrapper, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const cfg = defaultConfig(); const agent = cfg.agents.claude; assert.ok(agent?.vendor === 'anthropic'); agent.profile_bin = wrapper;
    const base = cfg.probe.cli.claude!;
    base.routes = {};
    for (const [profile, version] of [['qwen','2.1.100'],['kimi','2.1.295']] as const) {
      base.routes[`profile:${profile}`] = { profile, fingerprint: resolveClaudeRoute(cfg, profile, version).fingerprint,
        probe: { ...base, version, denied_tool_in_trace: null } };
      delete base.routes[`profile:${profile}`]!.probe.routes;
    }
    base.version = '2.1.295';
    assert.equal(claudeProbeForRoute(cfg,'qwen')?.version, '2.1.100');
    assert.equal(claudeProbeForRoute(cfg,'kimi')?.version, '2.1.295');
    for (const value of [null, false, true]) {
      base.routes['profile:qwen']!.probe.denied_tool_in_trace = value;
      assert.equal(claudeAdapter.capabilityFor!(cfg,'qwen').rejectionRecorded, value === true);
    }
    agent.bin = path.join(root,'changed-native-entry');
    assert.equal(claudeProbeForRoute(cfg,'qwen'), undefined);
  } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
});

}
