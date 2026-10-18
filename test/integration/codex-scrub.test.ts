/**
 * 真实 codex 适配器 + 假二进制：凭据副本在四种出口之后都被抹（EV-20）。
 *
 * ## 为什么要真起子进程
 *
 * `codexAdapter.run()` 此前**零端到端覆盖**——40 条单测全是纯函数与组装（计划双审 CODEX-12）。
 * 抹除挂在 runner 的 finally 上，而「适配器真的把副本写在 runner 会去抹的那一层」
 * 只有跑一遍 `run()` 才知道：路径拼错一层，单测照绿、副本照留。
 *
 * ## 假二进制
 *
 * 一个 sh 包装 + node 脚本，按 `FAKE_CODEX_MODE` 决定出口：`ok` 正常收尾、`silent` 不给最终回复、
 * `hang` 睡到超时、`flaky` 第一次 429 第二次 ok（走 runner 的瞬时重试）。
 * 它也往 `$CODEX_HOME/sessions/` 写一份会话文件——真 codex 会写，抹除必须留着它。
 * 不烧配额、不依赖本机装没装 codex。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { codexAdapter } from '../../src/trivium/adapters/codex.js';
import { runBothSides } from '../../src/trivium/runner.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { readScrubSentinel } from '../../src/trivium/scrub.js';
import type { Config, CriticRequest } from '../../src/trivium/types.js';

// WIN_FILE_SKIP（Windows 移植）：shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）');
} else {

// 运行时拼接、不叫 token：本文件会进送审包，归档侧密钥扫描扫 diff 原文（见 credential-scrub.test.ts 头注释）
const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join('');
let work = '';
let fakeBin = '';
let counterFile = '';
const savedCodexHome = process.env['CODEX_HOME'];

before(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-codex-scrub-'));
  // 假的宿主机 CODEX_HOME：prepareCodexHome 从这里拷副本
  const src = path.join(work, 'src-home');
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(
    path.join(src, 'config.toml'),
    `model = "qwen3.8-max"\n[model_providers.qwen]\nexperimental_bearer_token = "${FAKE_CRED}"\nbase_url = "https://example.invalid/v1"\n`,
  );
  await fs.writeFile(path.join(src, 'qwen.config.toml'), 'model = "qwen3.8-max"\nmodel_provider = "qwen"\n');
  await fs.writeFile(path.join(src, 'auth.json'), `{"OPENAI_API_KEY":"sk-proj-${FAKE_CRED}${FAKE_CRED}"}`);
  process.env['CODEX_HOME'] = src;

  counterFile = path.join(work, 'calls');
  const script = path.join(work, 'fake-codex.cjs');
  await fs.writeFile(script, `
const fs = require('node:fs');
const path = require('node:path');
const mode = process.env.FAKE_CODEX_MODE || 'ok';
const home = process.env.CODEX_HOME;
const counter = process.env.FAKE_CODEX_COUNTER;
const n = (() => { try { return Number(fs.readFileSync(counter, 'utf8')) + 1; } catch { return 1; } })();
fs.writeFileSync(counter, String(n));
// 真 codex 会往 $CODEX_HOME/sessions/ 写会话文件——抹除必须留着它
const sdir = path.join(home, 'sessions', '2026', '09', '17');
fs.mkdirSync(sdir, { recursive: true });
// 第二行模拟模型在沙箱里读了自己的配置副本：token 经 JSON 转义落进会话记录——抹除要就地脱敏而不删（EV-32）
fs.writeFileSync(path.join(sdir, 'rollout-2026-09-17-T1.jsonl'),
  '{"type":"session_meta","payload":{"session_id":"T1","model_provider":"qwen","cli_version":"9.9.9","base_instructions":{"provenance":{"model":"qwen3.8-max"}}}}\\n' +
  '{"type":"response_item","payload":{"output":"experimental_bearer_token = \\\\"' + process.env.FAKE_CODEX_CRED + '\\\\""}}\\n');
// 真 codex 还会写一堆缓存：插件目录（实测 21 MB）——不该扫、更不该记成失败
fs.mkdirSync(path.join(home, 'cache', 'remote_plugin_catalog'), { recursive: true });
fs.writeFileSync(path.join(home, 'cache', 'remote_plugin_catalog', 'catalog.json'), '{"plugins":[]}');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.resume();
process.stdin.on('end', () => {
  if (mode === 'hang') { setTimeout(() => {}, 60_000); return; }
  emit({ type: 'thread.started', thread_id: 'T1' });
  if (mode === 'silent') { process.exit(0); }
  if (mode === 'flaky' && n === 1) { emit({ type: 'error', message: '429 rate limit' }); process.exit(1); }
  emit({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } });
  emit({ type: 'turn.completed' });
  process.exit(0);
});
`);
  fakeBin = path.join(work, 'codex');
  await fs.writeFile(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`, { mode: 0o755 });
});

after(async () => {
  if (savedCodexHome === undefined) delete process.env['CODEX_HOME'];
  else process.env['CODEX_HOME'] = savedCodexHome;
  await fs.rm(work, { recursive: true, force: true });
});

function cfgWith(): Config {
  const cfg = defaultConfig();
  Object.assign(cfg.probe.cli.codex!, {
    probed_at: new Date().toISOString(),
    entrypoint: fakeBin,
    version: '9.9.9',
    readonly_flags: ['-s', 'read-only'],
    exec_headless_read_ok: true,
    profiles: ['qwen'],
    providers: [],
  });
  (cfg.agents.codex as { bin: string | null; profile: string | null }).bin = fakeBin;
  (cfg.agents.codex as { bin: string | null; profile: string | null }).profile = 'qwen';
  return cfg;
}

async function runOnce(mode: string, timeoutS = 30) {
  process.env['FAKE_CODEX_MODE'] = mode;
  process.env['FAKE_CODEX_COUNTER'] = counterFile;
  process.env['FAKE_CODEX_CRED'] = FAKE_CRED;
  await fs.rm(counterFile, { force: true });
  const run = await fs.mkdtemp(path.join(work, `run-${mode}-`));
  const proj = path.join(run, 'proj');
  await fs.mkdir(proj, { recursive: true });
  const sideDir = path.join(run, 'codex');
  const req: CriticRequest = {
    run_id: 'R1', topic: 't', stage: 'plan', critic: 'codex',
    project_root: proj, subject_path: path.join(proj, 's.md'), deny_paths: [],
    out_dir: path.join(sideDir, 'out'), brief_path: path.join(proj, 'b.md'), brief_text: 'BRIEF',
    model: 'qwen3.8-max', timeout_s: timeoutS, schema_path: '/s.json',
    min_tool_calls: 0, profile_requested: 'qwen', min_project_reads: 0, tier: null, tier_source: null,
  };
  const out = await runBothSides({
    ctx: { cfg: cfgWith(), nodePath: process.execPath },
    adapters: { codex: codexAdapter },
    requests: { codex: req },
    maxTransientRetries: 1,
  });
  return { out, sideDir, home: path.join(sideDir, 'codexhome') };
}

async function assertScrubbed(sideDir: string, home: string) {
  await assert.rejects(fs.access(path.join(home, 'auth.json')), 'auth.json 副本必须被删');
  await assert.rejects(fs.access(path.join(home, 'config.toml')), 'config.toml 副本必须被删');
  await assert.rejects(fs.access(path.join(home, 'qwen.config.toml')), '所选 profile 副本必须被删');
  const session = await fs.readFile(path.join(home, 'sessions/2026/09/17/rollout-2026-09-17-T1.jsonl'), 'utf8');
  assert.ok(session.startsWith('{"type":"session_meta"'), 'sessions/ 保留且首行结构不变');
  assert.ok(!session.includes(FAKE_CRED), 'sessions/ 里模型自读到的 token 必须被就地脱敏（EV-32）');
  const s = await readScrubSentinel(sideDir);
  assert.equal(s?.ok, true, JSON.stringify(s));
  assert.ok(s!.carriers_deleted.includes(path.join('codexhome', 'auth.json')), JSON.stringify(s));
  assert.ok(Object.keys(s!.logs_redacted).some((k) => k.includes('sessions')), JSON.stringify(s!.logs_redacted));
  assert.deepEqual(s!.errors, []);
  // 适配器写在 out/ 下的两份日志不得再带 token（假 codex 的事件流本身不含 token，这里守的是「没抹坏」）
  for (const f of ['out/stdout.jsonl', 'out/trace.json']) {
    const p = path.join(sideDir, f);
    try {
      assert.ok(!(await fs.readFile(p, 'utf8')).includes(FAKE_CRED), `${f} 不得含 token`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

test('出口 ok：副本已抹、sessions 保留、结果 ok', async () => {
  const { out, sideDir, home } = await runOnce('ok');
  assert.equal(out.results.codex?.status, 'ok', out.results.codex?.fail_reason ?? '');
  assert.equal(out.results.codex?.model_effective, 'qwen3.8-max', '前提：sessions/ 真被回读了——所以它必须留着');
  await assertScrubbed(sideDir, home);
});

test('出口 无最终回复（failed）：副本已抹', async () => {
  const { out, sideDir, home } = await runOnce('silent');
  assert.equal(out.results.codex?.status, 'failed');
  await assertScrubbed(sideDir, home);
});

test('出口 超时：副本已抹', async () => {
  const { out, sideDir, home } = await runOnce('hang', 1);
  assert.equal(out.results.codex?.status, 'timeout', out.results.codex?.fail_reason ?? '');
  await assertScrubbed(sideDir, home);
});

test('瞬时故障重试：第二次重新准备的副本同样被抹（CODEX-02 的变异点）', async () => {
  const { out, sideDir, home } = await runOnce('flaky');
  assert.equal(out.attempts.codex, 2, '前提：确实重试了');
  assert.equal(out.results.codex?.status, 'ok');
  await assertScrubbed(sideDir, home);
});

}
