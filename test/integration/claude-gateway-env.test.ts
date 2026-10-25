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
 * ## 两类不变量（EV-257 起分开写）
 *
 * - **凭据类键的值**只以占位符出现：E1、E7 的回显值是 `ANTHROPIC_AUTH_TOKEN`，断言不动。
 *   E1 / E7 对 `GATEWAY_VALUES` 里两个模型名键的值也断言「不出现」，那两格成立是因为假 CLI 从不回显它们，
 *   **不是**因为模型名键在脱敏射程内——模型名键的值不进逐值替换（`gatewayScrubPlan`）。
 * - **模型名键的值**允许出现、回读要记真名：正向覆盖在 E8；凭据值被网关当模型名回显时只剩占位符、
 *   回读须记 null + `unverified`（E9）；未开启时与修复前逐项相同（E10）。E8～E10 不复用 `runAll`
 *   （它对全部 `GATEWAY_VALUES` 断言不出现），「不出现」只对 `CREDENTIAL_VALUES` 断言。
 *
 * ## 装置
 *
 * - 假 CLI 是一份 `.cjs`，路线入口取 `process.execPath`、`prefix: [脚本]`——不靠 shebang，win32 也跑
 *   （兄弟套件 `claude-route-stability` 只在非 win32 跑；网关特性的主场恰是 Windows）。行为沿用该套件那份
 *   已能跑完 `probeClaude` 各臂的假 CLI；另外每次调用往 `FAKE_CLAUDE_LOG` 追加一行记录，并把
 *   `ANTHROPIC_AUTH_TOKEN` 的值回显进 stdout 与 stderr 锚脱敏。两个可选开关只给 E8～E10 用、E1～E7 不设：
 *   `FAKE_CLAUDE_INIT_MODEL_KEY` 让 `init.model` 取该环境变量的值（不在环境里则退回缺省名）；
 *   `FAKE_CLAUDE_RAW_LOG` 把未脱敏的原始输出另写一份作对照（只在本格 `scratchDir` 里）。
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
import { buildClaudeArgs, buildClaudeResult, buildDenySettings, denyRuleShapeOf, invokeClaude, readonlyToolsFromProbe,
  type ClaudeInvokeOutcome } from '../../src/trivium/adapters/claude.js';
import { parseClaudeEvents } from '../../src/trivium/adapters/claude-trace.js';
import { redactSecrets } from '../../src/trivium/secrets.js';
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
/** 凭据类键的值（EV-257）：E8～E10 的「不出现」只对它们断言；模型名键的值允许出现 */
const CREDENTIAL_VALUES = [SETTINGS_ENV.ANTHROPIC_AUTH_TOKEN, SETTINGS_ENV.ANTHROPIC_BASE_URL];

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
    'const rawOut = [], rawErr = [];',
    'function emit(o) { const s = JSON.stringify(o) + "\\n"; rawOut.push(s); process.stdout.write(s); }',
    "const echo = process.env.ANTHROPIC_AUTH_TOKEN || '';",
    "if (echo) { const s = 'echo ' + echo + '\\n'; rawErr.push(s); process.stderr.write(s); }",
    "const modelKey = process.env.FAKE_CLAUDE_INIT_MODEL_KEY || '';",
    "const initModel = (modelKey && process.env[modelKey]) || 'claude-haiku-4-5-20251001';",
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    "  const structured = argv.includes('--json-schema');",
    "  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: structured ? ['Read', 'Grep', 'Glob', 'StructuredOutput'] : ['Read', 'Grep', 'Glob'], model: initModel, session_id: 'fake-session' });",
    "  if (echo) emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo ' + echo }] } });",
    "  const result = structured ? JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'fake summary', findings: [] }) : 'ok';",
    "  emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001, session_id: 'fake-session' });",
    "  if (process.env.FAKE_CLAUDE_RAW_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_RAW_LOG, JSON.stringify({ stdout: rawOut.join(''), stderr: rawErr.join('') }) + '\\n');",
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
async function withCell<T>(opts: { enabled: boolean; settings: string | null; extra?: Record<string, string> },
  fn: (c: Cell) => Promise<T>): Promise<T> {
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
    ...opts.extra,
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

test('E7 开启：探针执行封装 execArgv 对 stdout / stderr 逐值脱敏（回显的凭据值只以占位符出现）', async () => {
  // 代码审 GLM-01：invokeClaude 的脱敏由 E1 锚住；探针侧这一份此前没有任何断言。假 CLI 把 AUTH_TOKEN 回显进两路输出
  // （模型名键的值不回显，GATEWAY_VALUES 对它们的「不出现」是空成立；模型名键的正向覆盖在 E8，见文件头）
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

// ─────────────── EV-257：模型名回读不被逐值脱敏吞掉（E8～E10，不复用 runAll）───────────────

/** 审查调用一次 → 解析 → 组装，返回输出与组装结果（与 `claudeAdapter.run` 同一条链） */
async function reviewReadback(c: Cell): Promise<{ out: ClaudeInvokeOutcome; model: string | null; source: string }> {
  const route = fakeRoute(c.cfg);
  const out = await invokeClaude(reviewOpts(route, c.home, null));
  assert.equal(out.exitCode, 0, `审查调用应跑通：${out.stderr}`);
  const r = buildClaudeResult(parseClaudeEvents(out.stdout), out, { stdout: '/r/s', trace: '/r/t' },
    { version: '9.9.9', path_deny: { file_shape_verified: true } }, readonlyToolsFromProbe(READONLY_INVARIANTS),
    { ruleCount: 0, skipped: [], bytes: 0 });
  return { out, model: r.model_effective, source: r.model_effective_source };
}

function assertNoCredential(label: string, text: string): void {
  for (const v of CREDENTIAL_VALUES) assert.ok(!text.includes(v), `${label}：凭据键的值不得出现（逐值替换被放松）`);
}

test('E8 开启 · 网关回报的模型名等于模型名键的值：回读记真名、来源 envelope，凭据键的值仍被替换', async () => {
  await withCell({ enabled: true, settings: SETTINGS_TEXT, extra: { FAKE_CLAUDE_INIT_MODEL_KEY: 'ANTHROPIC_MODEL' } }, async (c) => {
    const real = SETTINGS_ENV.ANTHROPIC_MODEL;
    const { out, model, source } = await reviewReadback(c);
    assert.equal(model, real, '模型名键的值被重新纳入逐值替换时，这里是占位符或 null');
    assert.equal(source, 'envelope');
    for (const [label, text] of [['stdout', out.stdout], ['stderr', out.stderr], ['commandLine', out.commandLine]] as const) {
      assertNoCredential(`E8 审查调用 ${label}`, text);
    }
    assert.ok(out.stdout.includes('<redacted-env>') && out.stderr.includes('<redacted-env>'), 'E8：回显的 AUTH_TOKEN 须以占位符出现');

    const route = fakeRoute(c.cfg);
    const fx = { root: c.home } as Fixture;
    const arm = await withClaudeProbeRoute(route, real, null, () => execArgv(process.execPath, fx, probeArgs({ prompt: 'p' })));
    assert.equal(arm.init?.model, real, 'E8 探针臂：init.model 须为真实模型名');
    assertNoCredential('E8 探针 raw', arm.raw);
    assertNoCredential('E8 探针 stderr', arm.stderr);
    const { probe } = await withClaudeProbeRoute(route, real, null, () => probeClaude(process.execPath, { assetRoot: ASSET_ROOT }));
    assert.equal(probe.model_flag, true, 'E8：回读到的真实模型名与所选模型相同，model_flag 须为 true');
  });
});

test('E9 开启 · 网关把凭据值当模型名回显：只剩占位符，回读记 null + unverified、model_flag 记 null', async () => {
  await withCell({ enabled: true, settings: SETTINGS_TEXT, extra: { FAKE_CLAUDE_INIT_MODEL_KEY: 'ANTHROPIC_AUTH_TOKEN' } }, async (c) => {
    const { out, model, source } = await reviewReadback(c);
    assert.notEqual(model, SETTINGS_ENV.ANTHROPIC_AUTH_TOKEN, 'E9：凭据值不得作为生效模型落盘（凭据键被放出替换）');
    assert.equal(model, null, 'E9：只剩占位符时生效模型记 null');
    assert.equal(source, 'unverified', 'E9：占位符不得以 envelope 记作回读成功');
    assertNoCredential('E9 审查调用 stdout', out.stdout);
    const route = fakeRoute(c.cfg);
    const { probe } = await withClaudeProbeRoute(route, MODEL, null, () => probeClaude(process.execPath, { assetRoot: ASSET_ROOT }));
    assert.equal(probe.model_flag, null, 'E9：回读被吞是「没核对成」，不是「核对不符」（false）');
  });
});

test('E10 未开启：与修复前逐项相同——回读记缺省名 envelope，输出逐字等于只过模式脱敏', async () => {
  await withCell({ enabled: false, settings: SETTINGS_TEXT, extra: { FAKE_CLAUDE_INIT_MODEL_KEY: 'ANTHROPIC_MODEL' } }, async (c) => {
    const rawLog = path.join(c.home, 'raw.jsonl');
    process.env['FAKE_CLAUDE_RAW_LOG'] = rawLog;
    try {
      const { out, model, source } = await reviewReadback(c);
      assert.equal(model, MODEL, 'E10：子进程环境里没有模型名键，init.model 退回缺省名');
      assert.equal(source, 'envelope');
      const raw = JSON.parse((await fs.readFile(rawLog, 'utf8')).trim()) as { stdout: string; stderr: string };
      assert.equal(out.stdout, redactSecrets(raw.stdout).content, 'E10：未开启时 stdout 只过模式脱敏');
      assert.equal(out.stderr, redactSecrets(raw.stderr).content, 'E10：未开启时 stderr 只过模式脱敏');
      const route = fakeRoute(c.cfg);
      const { probe } = await withClaudeProbeRoute(route, MODEL, null, () => probeClaude(process.execPath, { assetRoot: ASSET_ROOT }));
      assert.equal(probe.model_flag, true, 'E10：未开启时 model_flag 与修复前相同');
    } finally {
      delete process.env['FAKE_CLAUDE_RAW_LOG'];
    }
  });
});
