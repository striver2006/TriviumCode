/**
 * EV-256：第三方网关 env 改经子进程环境变量注入——审查调用与探针各臂端到端。
 *
 * ## 要钉住的事
 *
 * 开了 `agents.claude.settings_env_source: user_settings` 时，`~/.claude/settings.json` env 段里的网关键
 * 1.2.0～1.3.1 并进 `--settings` 内联 JSON、出现在 claude 子进程的命令行里（Bug 清单 §3.1 第 14 条）。
 * 修复后网关键只经 `claudeInvocationEnv` 进子进程环境：先清父进程路线变量、后注网关键，同名键网关值胜出。
 * 本文件对每一次真实 spawn 断言：argv 里没有任何网关值、`--settings`（若有）没有 `env` 段、
 * 子进程环境里的 `ANTHROPIC_` / `CLAUDE_` 键恰为提取出的那些且值逐字相等。覆盖两条执行出口的全部调用点：
 * `invokeClaude`（审查调用 E1、探活 E2、目录臂 E4）与探针 `routeInvocation`（execProbe 各臂、记忆两臂、
 * verbose 阴性对照，E3）。未开启（E5）与 env 段为空 / 读不到（E6）时环境里没有任何前缀键、argv 与配方逐项相同。
 * 输出侧脱敏：`invokeClaude` 由 E1 锚住，探针执行封装 `execArgv` 由 E7 锚住（代码审 GLM-01）。
 *
 * ## 装置
 *
 * - 假 CLI 是一份 `.cjs`，路线入口取 `process.execPath`、`prefix: [脚本]`——不靠 shebang，win32 也跑
 *   （兄弟套件 `claude-route-stability` 只在非 win32 跑；网关特性的主场恰是 Windows）。行为沿用该套件那份
 *   已能跑完 `probeClaude` 各臂的假 CLI；另外每次调用往 `FAKE_CLAUDE_LOG` 追加一行记录，并把
 *   `ANTHROPIC_AUTH_TOKEN` 的值回显进 stdout 与 stderr 锚脱敏。
 * - **宿主变量隔离**（计划三审 CODEX-01）：每格先摘下宿主全部 `ANTHROPIC_` / `CLAUDE_` 前缀变量、finally 原样放回，
 *   只放合成值；假 CLI 只对 `FAKE_CLAUDE_VALUE_KEYS` 声明的键记值，其余前缀键只记键名——宿主真实令牌不进子进程、
 *   也不可能落进日志。
 * - 父进程合成键：`ANTHROPIC_AUTH_TOKEN`（与 settings.json 同名，钉「先清后注」的次序）、
 *   `ANTHROPIC_PARENT_ONLY_EV256`（settings.json 没有，必须仍被清除）。都在 `resolveClaudeRoute` 之前设好。
 * - 每格独立 `scratchDir` 家目录，`HOME` 与 `USERPROFILE` 都钉住（win32 的 `os.homedir()` 读后者）。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { defaultConfig, resolveReviewSchemaPath } from '../../src/trivium/config.js';
import { execArgv, probeArgs, probeClaude, withClaudeProbeRoute, READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import type { Fixture } from '../../src/trivium/probes/fixture.js';
import { probeClaudeDirectories } from '../../src/trivium/probes/claude-directory.js';
import { buildClaudeArgs, buildDenySettings, denyRuleShapeOf, invokeClaude } from '../../src/trivium/adapters/claude.js';
import { resolveClaudeRoute, type ClaudeRoute } from '../../src/trivium/adapters/claude-route.js';
import type { Config } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';
import { ASSET_ROOT } from '../helpers/fixture.js';

const MODEL = 'claude-haiku-4-5-20251001';
const PREFIX = /^(ANTHROPIC_|CLAUDE_)/;

/** 夹具网关 env：值都是非凭据形态的短串（≥8 字符过 `scrubGatewayEnv` 的长度阈，避开密钥扫描形态） */
const SETTINGS_ENV = {
  ANTHROPIC_BASE_URL: 'https://gw-ev256.invalid/api',
  ANTHROPIC_AUTH_TOKEN: 'gw-ev256-auth-01',
  ANTHROPIC_MODEL: 'gw-ev256-model-01',
  CLAUDE_CODE_SUBAGENT_MODEL: 'gw-ev256-sub-01',
  GATEWAY_EXTRA_EV256: 'gw-ev256-extra-01',
  ANTHROPIC_EMPTY_EV256: '',
};
const SETTINGS_TEXT = JSON.stringify({ env: SETTINGS_ENV });
/**
 * 应注入的键（无前缀干扰键与空串键不在）。**独立写死、不取 `extractSettingsEnv` 的产出**：
 * 提取口径本身被改坏（如去掉前缀过滤）时，预期不能跟着一起变。
 */
const EXPECTED: Record<string, string> = {
  ANTHROPIC_BASE_URL: SETTINGS_ENV.ANTHROPIC_BASE_URL,
  ANTHROPIC_AUTH_TOKEN: SETTINGS_ENV.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_MODEL: SETTINGS_ENV.ANTHROPIC_MODEL,
  CLAUDE_CODE_SUBAGENT_MODEL: SETTINGS_ENV.CLAUDE_CODE_SUBAGENT_MODEL,
};
const PARENT = { ANTHROPIC_AUTH_TOKEN: 'parent-ev256-auth', ANTHROPIC_PARENT_ONLY_EV256: 'parent-ev256-only' };
const GATEWAY_VALUES = Object.values(SETTINGS_ENV).filter((v) => v.length > 0);

let script = '';

before(async () => {
  const work = await scratchDir('trivium-gateway-env-');
  script = path.join(work, 'fake-claude.cjs');
  await fs.writeFile(script, [
    "const fs = require('node:fs');",
    'const argv = process.argv.slice(2);',
    "const valueKeys = (process.env.FAKE_CLAUDE_VALUE_KEYS || '').split(',').filter(Boolean);",
    'const env = {};',
    'for (const k of Object.keys(process.env)) {',
    '  if (/^(ANTHROPIC_|CLAUDE_)/.test(k)) env[k] = valueKeys.includes(k) ? process.env[k] : null;',
    '}',
    "fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, env, extra: 'GATEWAY_EXTRA_EV256' in process.env }) + '\\n');",
    "if (argv.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude)\\n'); process.exit(0); }",
    'function emit(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }',
    "const echo = process.env.ANTHROPIC_AUTH_TOKEN || '';",
    "if (echo) process.stderr.write('echo ' + echo + '\\n');",
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    "  const structured = argv.includes('--json-schema');",
    "  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: structured ? ['Read', 'Grep', 'Glob', 'StructuredOutput'] : ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });",
    "  if (echo) emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo ' + echo }] } });",
    "  const result = structured ? JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'fake summary', findings: [] }) : 'ok';",
    "  emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001, session_id: 'fake-session' });",
    '  process.exit(0);',
    '});',
    '',
  ].join('\n'));
});

interface Rec { argv: string[]; env: Record<string, string | null>; extra: boolean }

interface Cell { home: string; log: string; cfg: Config }

/**
 * 一格的环境：家目录（可选写 settings.json）、日志、宿主前缀变量隔离、父进程合成键。
 * `fn` 结束后无论成败都原样恢复 `process.env`。
 */
async function withCell<T>(opts: { enabled: boolean; settings: string | null }, fn: (c: Cell) => Promise<T>): Promise<T> {
  const home = await scratchDir('trivium-gateway-env-home-');
  if (opts.settings !== null) {
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'settings.json'), opts.settings);
  }
  const log = path.join(home, 'calls.jsonl');
  await fs.writeFile(log, '');
  const cfg = defaultConfig();
  const agent = cfg.agents.claude;
  assert.ok(agent?.vendor === 'anthropic');
  agent.bin = process.execPath;
  if (opts.enabled) agent.settings_env_source = 'user_settings';

  const saved: Record<string, string | undefined> = {};
  const touch = (k: string): void => { if (!(k in saved)) saved[k] = process.env[k]; };
  // 宿主前缀变量一律摘下（CODEX-01）：真实令牌既不进子进程、也不进日志
  for (const k of Object.keys(process.env)) if (PREFIX.test(k)) { touch(k); delete process.env[k]; }
  const patch: Record<string, string> = {
    ...PARENT,
    HOME: home,
    USERPROFILE: home,
    FAKE_CLAUDE_LOG: log,
    FAKE_CLAUDE_VALUE_KEYS: [...Object.keys(SETTINGS_ENV), ...Object.keys(PARENT)].join(','),
  };
  for (const [k, v] of Object.entries(patch)) { touch(k); process.env[k] = v; }
  try {
    return await fn({ home, log, cfg });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/** 解析所得路线只把入口换成假 CLI；`env` / `settingsEnv` 保持解析所得——被测的正是它们如何进子进程 */
function fakeRoute(cfg: Config): ClaudeRoute {
  return { ...resolveClaudeRoute(cfg, null), bin: process.execPath, prefix: [script] };
}

async function records(log: string): Promise<Rec[]> {
  return (await fs.readFile(log, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);
}

/** 只看带模型调用的那些（`--version` / `--help` 修复前后都不带网关 env，不在本主题的面） */
function modelCalls(recs: Rec[]): Rec[] {
  return recs.filter((r) => !r.argv.includes('--version') && !r.argv.includes('--help'));
}

function settingsOf(r: Rec): Record<string, unknown> | null {
  const i = r.argv.indexOf('--settings');
  return i < 0 ? null : JSON.parse(r.argv[i + 1]!) as Record<string, unknown>;
}

/** 开启时每条记录都要过的谓词：argv 无网关值、`--settings` 无 env 段、环境里的前缀键恰为提取出的那些 */
function assertGatewayClean(label: string, r: Rec): void {
  for (const a of r.argv) {
    for (const v of GATEWAY_VALUES) assert.ok(!a.includes(v), `${label}：argv 里出现了网关值（${Object.entries(SETTINGS_ENV).find(([, x]) => x === v)?.[0]}）`);
  }
  assert.ok(!(settingsOf(r) && 'env' in settingsOf(r)!), `${label}：--settings 仍带 env 段（遗留内联）`);
  assert.deepEqual(Object.keys(r.env).sort(), Object.keys(EXPECTED).sort(),
    `${label}：子进程环境里的 ANTHROPIC_/CLAUDE_ 键须恰为提取出的那些（父进程独有键须被清除、网关键须在）`);
  for (const [k, v] of Object.entries(EXPECTED)) {
    assert.equal(r.env[k], v, `${label}：${k} 须为 settings.json 的值（同名键被父进程清除覆盖即注入次序颠倒）`);
  }
  assert.equal(r.extra, false, `${label}：无前缀的干扰键不得注入`);
}

/** 未开启 / env 段为空时：argv 无网关值、`--settings` 无 env 段、环境里没有任何前缀键（与修复前「只清不注」相同） */
function assertNoGateway(label: string, r: Rec): void {
  for (const a of r.argv) for (const v of GATEWAY_VALUES) assert.ok(!a.includes(v), `${label}：argv 里出现了网关值`);
  assert.ok(!(settingsOf(r) && 'env' in settingsOf(r)!), `${label}：--settings 不得带 env 段`);
  assert.deepEqual(r.env, {}, `${label}：未注入时环境里不得有任何 ANTHROPIC_/CLAUDE_ 键（父进程那两个须被清除）`);
  assert.equal(r.extra, false);
}

const denyJson = (): string => buildDenySettings(['secret.txt'], ['Read', 'Grep', 'Glob'], denyRuleShapeOf('Read(./x)')).json!;

function reviewOpts(route: ClaudeRoute, cwd: string, settingsJson: string | null) {
  return { bin: route.bin!, route, cwd, prompt: 'review', model: MODEL, effort: null,
    readonlyArgs: [...READONLY_INVARIANTS], schemaJson: null, settingsJson, timeoutMs: 30_000 };
}

/** 四组调用：审查调用、探活、探针各臂、目录臂。返回各组的记录 */
async function runAll(c: Cell): Promise<{ review: Rec[]; auth: Rec[]; probe: Rec[]; directory: Rec[] }> {
  const route = fakeRoute(c.cfg);
  const take = async (fn: () => Promise<unknown>): Promise<Rec[]> => {
    await fs.writeFile(c.log, '');
    await fn();
    return records(c.log);
  };
  const deny = denyJson();
  const injected = Object.keys(route.settingsEnv).length > 0;
  const review = await take(async () => {
    const out = await invokeClaude(reviewOpts(route, c.home, deny));
    assert.equal(out.exitCode, 0, `审查调用应跑通：${out.stderr}`);
    // 先核子进程实际收到的 argv 与环境，再核输出脱敏——注入漏了或次序反了，要红在注入这一句上
    const recs = await records(c.log);
    if (injected) assertGatewayClean('E1 审查调用', recs[0]!);
    // argv 与配方逐项相同：网关键不进 argv，--settings 是 deny 载荷原样
    assert.deepEqual(recs[0]?.argv, buildClaudeArgs(reviewOpts(route, c.home, deny)));
    // 脱敏保留（CODEX-02）：回显进 stdout / stderr 的网关值只能以占位符出现；命令行里本就不该有值
    for (const text of [out.stdout, out.stderr, out.commandLine]) {
      for (const v of GATEWAY_VALUES) assert.ok(!text.includes(v), '审查调用的输出与命令行不得含网关值');
    }
    if (injected) {
      assert.ok(out.stdout.includes('<redacted-env>'), 'stdout 回显的网关值须被替换成占位符');
      assert.ok(out.stderr.includes('<redacted-env>'), 'stderr 回显的网关值须被替换成占位符');
    }
  });
  const auth = await take(() => invokeClaude(reviewOpts(route, c.home, null)));
  const probe = await take(() => withClaudeProbeRoute(route, MODEL, null,
    () => probeClaude(process.execPath, { assetRoot: ASSET_ROOT })));
  const directory = await take(() => probeClaudeDirectories({ critic: 'claude', cfg: c.cfg, route, model: MODEL, effort: null,
    readonlyFlags: READONLY_INVARIANTS, schemaPath: resolveReviewSchemaPath(ASSET_ROOT) }));
  return { review, auth, probe, directory };
}

/** 探针臂覆盖：四类按需 spawn 的臂各至少一条，防止「没跑到所以没查到」的空转 */
function assertProbeArms(label: string, probe: Rec[]): void {
  const calls = modelCalls(probe);
  const has = (pred: (a: string[]) => boolean, what: string): void =>
    assert.ok(calls.some((r) => pred(r.argv)), `${label}：缺少${what}的调用（该臂没跑到，断言会空转）`);
  has((a) => !a.includes('--restricted'), '记忆对照臂（无 --restricted）');
  // routeInvocation 把 -p 改写成 --print，记录的是最终 argv（计划三审 CODEX-03 / GLM-02）
  has((a) => a.includes('--print') && !a.includes('--verbose'), 'verbose 阴性对照（--print 且无 --verbose）');
  has((a) => a.includes('--json-schema'), '结构化臂（--json-schema）');
  has((a) => a.includes('--settings'), '路径 deny 臂（--settings）');
}

test('E1–E4 开启：审查调用、探活、探针各臂、目录臂——argv 无网关值，环境里网关键恰为提取出的那些', async () => {
  await withCell({ enabled: true, settings: SETTINGS_TEXT }, async (c) => {
    const { review, auth, probe, directory } = await runAll(c);

    assert.equal(review.length, 1, 'E1 审查调用恰 1 次');
    assertGatewayClean('E1 审查调用', review[0]!);
    assert.deepEqual(settingsOf(review[0]!), JSON.parse(denyJson()), 'E1：--settings 是 deny 载荷原样');

    assert.equal(auth.length, 1, 'E2 探活恰 1 次');
    assertGatewayClean('E2 探活', auth[0]!);
    assert.ok(!auth[0]!.argv.includes('--settings'), 'E2：探活形态没有 deny，argv 里不得出现 --settings（修复前此处会新建 {"env":…}）');

    const calls = modelCalls(probe);
    assert.ok(calls.length >= 8, `E3：探针模型调用次数异常（${calls.length}）`);
    calls.forEach((r, i) => assertGatewayClean(`E3 探针第 ${i + 1} 次（${r.argv.slice(0, 3).join(' ')}…）`, r));
    assertProbeArms('E3', probe);

    assert.equal(directory.length, 7, `E4：目录臂应跑 7 次（${directory.length}）`);
    directory.forEach((r, i) => {
      assertGatewayClean(`E4 目录臂第 ${i + 1} 次`, r);
      assert.ok(settingsOf(r)?.['permissions'], `E4 目录臂第 ${i + 1} 次：--settings 须是 deny 载荷`);
    });
  });
});

test('E5 未开启（settings.json 照样放着网关 env）：各组调用都不注入、父进程前缀键照旧被清除，argv 与配方相同', async () => {
  await withCell({ enabled: false, settings: SETTINGS_TEXT }, async (c) => {
    const { review, auth, probe, directory } = await runAll(c);
    for (const [label, recs] of [['审查调用', review], ['探活', auth], ['探针', modelCalls(probe)], ['目录臂', directory]] as const) {
      assert.ok(recs.length > 0, `E5 ${label}：没有调用记录`);
      recs.forEach((r, i) => assertNoGateway(`E5 ${label}第 ${i + 1} 次`, r));
    }
    assertProbeArms('E5', probe);
    assert.equal(directory.length, 7);
  });
});

test('E6 开启但 env 段为空 / settings.json 读不到：与未开启相同', async () => {
  for (const [label, settings] of [['env 段为空', JSON.stringify({ model: 'x' })], ['文件不存在', null]] as const) {
    await withCell({ enabled: true, settings }, async (c) => {
      const route = fakeRoute(c.cfg);
      assert.deepEqual(route.settingsEnv, {});
      assert.ok(route.settingsEnvNote, `E6 ${label}：应有注记`);
      const { review, auth, probe, directory } = await runAll(c);
      for (const r of [...review, ...auth, ...modelCalls(probe), ...directory]) assertNoGateway(`E6 ${label}`, r);
      assert.equal(directory.length, 7, `E6 ${label}：目录臂应跑 7 次`);
    });
  }
});

test('E7 开启：探针执行封装 execArgv 对 stdout / stderr 逐值脱敏（网关值只以占位符出现）', async () => {
  // 代码审 GLM-01：invokeClaude 的脱敏由 E1 锚住；探针侧这一份此前没有任何断言。假 CLI 把网关值回显进两路输出
  await withCell({ enabled: true, settings: SETTINGS_TEXT }, async (c) => {
    const route = fakeRoute(c.cfg);
    const fx = { root: c.home } as Fixture;
    const out = await withClaudeProbeRoute(route, MODEL, null, () => execArgv(process.execPath, fx, probeArgs({ prompt: 'p' })));
    for (const [label, text] of [['raw（stdout）', out.raw], ['stderr', out.stderr]] as const) {
      for (const v of GATEWAY_VALUES) assert.ok(!text.includes(v), `E7 ${label}：网关值须被替换`);
      assert.ok(text.includes('<redacted-env>'), `E7 ${label}：回显的网关值须以占位符出现（脱敏被拿掉时这里是原值）`);
    }
    const recs = await records(c.log);
    assert.equal(recs.length, 1);
    assertGatewayClean('E7 execArgv', recs[0]!);
  });
});
