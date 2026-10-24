/**
 * M11 第 6 步端到端（零配额，桩 + 打包产物；计划 r2 §3.1 S 组与 P 组）。
 *
 * - **S 组**：桩回报「请求值 ≠ 生效值」时，run.json 与审查文档 front-matter 分记 `effort_requested` 与 `effort_effective`，
 *   旧字段 `effort` 与请求值同值；不注入时生效值为 null、来源 unverified；`tier` / `tier_source` 与顶层 `profile` 入档
 *   （设计 17.2 的第 6 步一行）。
 * - **P 组**：厂商 profile 三处同值——预检的可用性检查按本轮解析出的厂商 profile 判（负对照：配置段那家有凭据、
 *   解析出的那家没有 ⇒ 拒）、模型目录按它比、`--start` 交接文件里发起用的 `profile_requested` 也是它。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import { bundleMissing, bundleSkipReason, cli, makeFixture, seedFakeProbes } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { repoId } from '../../src/trivium/review.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';
import { fixtureCodexHomeWith } from '../helpers/codex-home-fixture.js';

// WIN_FILE_SKIP（Windows 移植）：shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）');
} else {

const TOPIC = '思考等级接线端到端';
const parse = <T>(stdout: string): T => JSON.parse(extractJsonCandidate(stdout)!.json) as T;

type CriticMeta = Record<string, unknown>;
interface Meta { profile?: string; critics: Record<string, CriticMeta> }

async function appendConfig(root: string, yaml: string): Promise<void> {
  await fs.appendFile(path.join(root, '.trivium', 'config.yaml'), yaml, 'utf8');
}

/** `--start` 后等到终态，返回 run_id */
async function runToEnd(root: string, args: string[], stub: StubConfig, env: Record<string, string> = {}): Promise<string> {
  const r = await cli(root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', ...args, '--json'], stub, 120_000, env);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const runId = parse<{ run_id: string }>(r.stdout).run_id;
  let code: number = EXIT.FAIL;
  for (let i = 0; i < 10; i++) {
    code = (await cli(root, ['review', '--wait', runId, '--timeout', '20'], stub, 60_000, env)).code ?? EXIT.FAIL;
    if (code !== 73) break;
  }
  assert.equal(code, EXIT.OK, `运行没有正常结束（退 ${code}）`);
  return runId;
}

async function readMeta(stageDir: string, runId: string): Promise<Meta> {
  return JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${runId}.json`), 'utf8')) as Meta;
}

async function frontMatterOf(stageDir: string, role: string): Promise<Record<string, unknown>> {
  const f = (await fs.readdir(stageDir)).find((n) => n.endsWith(`-${role}.md`));
  assert.ok(f, `${role} 侧没有审查文档`);
  const text = await fs.readFile(path.join(stageDir, f!), 'utf8');
  return YAML.parse(text.split('\n---')[0]!.replace(/^---\n/, '')) as Record<string, unknown>;
}

const GEMINI_TIER = 'agents:\n  gemini:\n    tiers:\n      low: { model: g-tier-low, effort: low }\n';

test('S1 桩回报「请求 low ≠ 生效 high」：run.json 与 front-matter 分记，旧字段 effort 同请求值，档位与档位表名入档', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await appendConfig(fx.root, GEMINI_TIER);
  const runId = await runToEnd(fx.root, ['--critics', 'gemini,glm', '--tier-gemini', 'low'], {
    gemini: { mode: 'ok', effortEffective: 'high' },
    glm: { mode: 'ok' },
  });
  const meta = await readMeta(fx.stageDir, runId);
  const g = meta.critics['gemini']!;
  assert.equal(g['effort_requested'], 'low');
  assert.equal(g['effort_effective'], 'high', '生效值取回读（桩的回执），不取请求值');
  assert.equal(g['effort_effective_source'], 'envelope');
  assert.equal(g['effort'], 'low', '旧字段与 effort_requested 同值并写');
  assert.equal(g['tier'], 'low');
  assert.equal(g['tier_source'], 'cli');
  assert.equal(meta.profile, 'default');

  // 没给思考等级的一侧：五格都在场（恒写），请求值 null、旧字段缺席（只在有值时写）
  const z = meta.critics['glm']!;
  for (const k of ['effort_requested', 'effort_effective', 'effort_effective_source', 'tier', 'tier_source']) {
    assert.ok(k in z, `glm 侧 ${k} 要恒写`);
  }
  assert.equal(z['effort_requested'], null);
  assert.equal(z['tier'], null);
  assert.equal(z['tier_source'], 'legacy');
  assert.equal('effort' in z, false);

  // front-matter 与 run.json 同值（EV-54 两处同值）
  const fm = await frontMatterOf(fx.stageDir, 'gemini');
  assert.deepEqual(
    [fm['effort_requested'], fm['effort_effective'], fm['effort_effective_source'], fm['tier'], fm['tier_source'], fm['effort']],
    ['low', 'high', 'envelope', 'low', 'cli', 'low'],
  );
});

test('S2 不注入生效值：effort_effective 为 null、来源 unverified——不拿请求值顶上', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await appendConfig(fx.root, GEMINI_TIER);
  const runId = await runToEnd(fx.root, ['--critics', 'gemini,glm', '--tier-gemini', 'low'], {
    gemini: { mode: 'ok' },
    glm: { mode: 'ok' },
  });
  const g = (await readMeta(fx.stageDir, runId)).critics['gemini']!;
  assert.equal(g['effort_requested'], 'low');
  assert.equal(g['effort_effective'], null);
  assert.equal(g['effort_effective_source'], 'unverified');
});

/*
 * P 组的 codex 家要同时有 qwen 与 deepseek 两份 profile（vendorProfilesFor 的名单）：fixture.cli() 缺省的隔离家只有 qwen。
 * 双平台统一时补：这组在 Windows 线被整文件跳过，没撞上 1.2.7 的 CODEX_HOME 隔离；macOS 上原先靠开发机真实 ~/.codex 恰有 deepseek 才绿。
 */
let twoProfileHome: Record<string, string> | null = null;
const TWO = (): Record<string, string> => (twoProfileHome ??= { CODEX_HOME: fixtureCodexHomeWith(['qwen', 'deepseek']) });

/** codex 两个厂商 profile：配置段是 qwen、档位条目是 deepseek，模型只在 deepseek 的目录里 */
async function codexTwoProfiles(root: string, deepseekCredentialed: boolean): Promise<void> {
  await seedFakeProbes(root, {
    profiles: ['qwen', 'deepseek'],
    providers: [
      { profile: 'qwen', provider: 'qwen', model: 'qwen3.8-max', credentialed: true },
      { profile: 'deepseek', provider: 'deepseek', model: 'deepseek-v4-pro', credentialed: deepseekCredentialed },
    ],
    models_by_profile: { qwen: ['qwen3.8-max'], deepseek: ['deepseek-v4-pro'] },
    models_visible: ['qwen3.8-max'],
    reasoning_levels: { base: {}, by_profile: { deepseek: { 'deepseek-v4-pro': ['low', 'high', 'max'] } } },
  });
  await appendConfig(root, 'agents:\n  codex:\n    profile: qwen\n    tiers:\n      high: { model: deepseek-v4-pro, effort: max, profile: deepseek }\n');
}

test('P2 预检按本轮解析出的厂商 profile 判可用性与目录：通过；解析出的那家没凭据 ⇒ 拒（配置段那家有凭据也不放）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const ok = await makeFixture({ topic: TOPIC });
  await codexTwoProfiles(ok.root, true);
  const pass = await cli(ok.root, ['preflight', '--stage', 'plan', '--critics', 'codex', '--tier-codex', 'high', '--skip-auth-check', '--json'], null, 180_000, TWO());
  assert.equal(pass.code, EXIT.OK, pass.stdout + pass.stderr);
  // 负对照：不选档 ⇒ 裸 slug、配置段 qwen ⇒ 照旧按 qwen 判、通过（旧行为不变）
  const legacy = await cli(ok.root, ['preflight', '--stage', 'plan', '--critics', 'codex', '--skip-auth-check', '--json'], null, 180_000, TWO());
  assert.equal(legacy.code, EXIT.OK, legacy.stdout + legacy.stderr);

  const bad = await makeFixture({ topic: TOPIC });
  await codexTwoProfiles(bad.root, false);
  const r = await cli(bad.root, ['preflight', '--stage', 'plan', '--critics', 'codex', '--tier-codex', 'high', '--skip-auth-check', '--json'], null, 180_000, TWO());
  assert.notEqual(r.code, EXIT.OK, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /厂商 profile「deepseek」对应的 provider「deepseek」没有可用凭据|codex profile「deepseek」对应的 provider「deepseek」没有可用凭据/);
  assert.equal(
    (await cli(bad.root, ['preflight', '--stage', 'plan', '--critics', 'codex', '--skip-auth-check', '--json'], null, 180_000, TWO())).code,
    EXIT.OK,
    '同一台机器不选档（按配置段 qwen）照旧通过——拒的确实是解析出的那一家',
  );
});

/*
 * `review --start` 自己的可用性检查（准备阶段，不经 preflight）同样按本轮解析值判：codex 不打桩、走真实适配器的
 * `availability()`。解析出的 deepseek 没凭据 ⇒ 在拉起任何东西之前退 69；不选档（按配置段 qwen）⇒ 通过这一关。
 */
test('P4 --start 的可用性检查按本轮解析出的厂商 profile 判：解析出的那家没凭据 ⇒ 退 69、零工件', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await codexTwoProfiles(fx.root, false);
  const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--critics', 'codex', '--tier-codex', 'high', '--json'], null, 120_000, TWO());
  assert.equal(r.code, EXIT.ENV, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /codex 侧不可用：codex profile「deepseek」对应的 provider「deepseek」没有可用凭据/);
  const left = await fs.readdir(fx.stageDir).catch(() => [] as string[]);
  assert.ok(!left.some((n) => n.endsWith('-codex.md')), '不可用即退出，不产出审查件');
});

test('P3 --start：交接文件里发起用的厂商 profile / 模型 / 思考等级就是解析值；--profile-codex 覆盖档位条目时一并跟着变', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await codexTwoProfiles(fx.root, true);
  const stub: StubConfig = { codex: { mode: 'ok' } };
  const runId = await runToEnd(fx.root, ['--critics', 'codex', '--tier-codex', 'high'], stub, TWO());
  const request = JSON.parse(await fs.readFile(path.join(fx.runRoot, repoId(fx.root), runId, 'request.json'), 'utf8')) as {
    requests: Record<string, { profile_requested: string | null; model: string; effort?: string; tier: string | null; tier_source: string | null }>;
  };
  const q = request.requests['codex']!;
  assert.deepEqual([q.profile_requested, q.model, q.effort, q.tier, q.tier_source], ['deepseek', 'deepseek-v4-pro', 'max', 'high', 'cli']);
  const c = (await readMeta(fx.stageDir, runId)).critics['codex']!;
  assert.equal(c['effort_requested'], 'max');
  assert.equal(c['tier'], 'high');

  // 命令行精确值覆盖档位条目的厂商 profile 与模型：发起值跟着变，档位的思考等级保留 ⇒ 档位名照记
  const fx2 = await makeFixture({ topic: TOPIC });
  await codexTwoProfiles(fx2.root, true);
  const run2 = await runToEnd(fx2.root, ['--critics', 'codex', '--tier-codex', 'high', '--profile-codex', 'qwen', '--model-codex', 'qwen3.8-max'], stub, TWO());
  const req2 = (JSON.parse(await fs.readFile(path.join(fx2.runRoot, repoId(fx2.root), run2, 'request.json'), 'utf8')) as {
    requests: Record<string, { profile_requested: string | null; model: string; effort?: string; tier: string | null }>;
  }).requests['codex']!;
  assert.deepEqual([req2.profile_requested, req2.model, req2.effort, req2.tier], ['qwen', 'qwen3.8-max', 'max', 'high']);
});

}
