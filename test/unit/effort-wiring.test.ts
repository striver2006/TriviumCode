/**
 * M11 第 6 步：思考等级与厂商 profile 透传、生效值回读、run.v2 档位字段接线（计划 r2 §3.1）。
 *
 * - **A 组** 各家参数组装纯函数：codex 的 `-p` / `-c`（含 `codexInvocationOf`）、claude 的 `--effort`、agy 的后缀格；
 * - **R 组** 本仓同形配置（裸 slug）下请求面与 argv 与改前逐字相同；档位形态下 codex / claude 的思考等级真进请求；
 * - **E 组** 回读钩子 `effortReadback` 逐家逐格（设计 11.1 表）：只取回读，codex / claude 恒 null + unverified；
 * - **C 组** 契约三态：新字段在场 / 缺席 / null，非法取值被拒，**旧读者**（本步之前的 run.v2.json 快照）读新留痕；
 * - **K 组** claude 探针 `parseEffortLevels` 与 `probeClaude` 零配额落盘（计划三审 CODEX-02）；
 * - **P 组** codex 可用性按本轮解析出的厂商 profile 判（三处同值的可用性那一处；目录那一处见 tier-resolve T 组）。
 *
 * 零配额：不拉起任何真实 CLI。K 组的假 claude 是 scratch 目录里的一段 sh。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { failedResult, resolveTier, type CriticAdapter } from '../../src/trivium/adapters/base.js';
import { agyEffortReadback, buildAgyArgs } from '../../src/trivium/adapters/agy.js';
import { buildCodexArgs, codexAdapter, codexInvocationOf } from '../../src/trivium/adapters/codex.js';
import { buildClaudeArgs, claudeAdapter, claudeReasoningLevels } from '../../src/trivium/adapters/claude.js';
import { zcodeAdapter } from '../../src/trivium/adapters/zcode.js';
import { makeStubAdapter } from '../../src/trivium/adapters/stub.js';
import { realAdapters } from '../../src/trivium/adapters/index.js';
import { parseEffortLevels, probeClaude } from '../../src/trivium/probes/claude.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { renderFrontMatter, type RenderInput } from '../../src/trivium/render.js';
import { ECHOED_ORCHESTRATOR_KEYS } from '../../src/trivium/parse.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import type { Config, CriticId, CriticResult, RunMeta, Stage, StageModel, TierEntry, TierName } from '../../src/trivium/types.js';

const STAGES: readonly Stage[] = ['plan', 'code', 'bug'];
type Agents = Record<string, Record<string, unknown>>;

function setTiers(c: Config, id: string, tiers: Partial<Record<TierName, TierEntry>>): void {
  (c.agents as unknown as Agents)[id]!['tiers'] = tiers;
}
function setCell(c: Config, id: string, stage: Stage, v: StageModel): void {
  const p = c.profiles[c.active_profile]! as Record<string, Record<string, unknown>>;
  (p[id] ??= {})[stage] = v;
}

/** 一份「成功」结果，回读面由入参决定 */
function okResult(critic: CriticId, over: Partial<CriticResult>): CriticResult {
  return { ...failedResult(critic, { status: 'failed', reason: 'x' }), status: 'ok', fail_reason: null, evidence_ok: true, ...over };
}

// ─────────────────────────── A 组：参数组装纯函数 ───────────────────────────

test('A1 codex：-p 与 -c 各格——有值才带，带就成对', () => {
  const base = { readonlyArgs: ['-s', 'read-only'], cwd: '/p' };
  const both = buildCodexArgs({ ...base, profile: 'deepseek', model: 'deepseek-v4-pro', effort: 'max' });
  assert.deepEqual(both.slice(0, 7), ['exec', '-p', 'deepseek', '-m', 'deepseek-v4-pro', '-c', 'model_reasoning_effort=max']);
  const none = buildCodexArgs({ ...base, profile: null, model: 'm', effort: null });
  assert.ok(!none.includes('-p') && !none.includes('-c'), none.join(' '));
});

test('A2 codexInvocationOf：厂商 profile 只取请求（三层解析值），不读配置段；null ⇒ 不带 -p', () => {
  assert.deepEqual(
    codexInvocationOf({ profile_requested: 'deepseek', model: 'deepseek-v4-pro', effort: 'max' }),
    { profile: 'deepseek', model: 'deepseek-v4-pro', effort: 'max' },
  );
  assert.deepEqual(codexInvocationOf({ profile_requested: null, model: 'm' }), { profile: null, model: 'm', effort: null });
  // 同一份取值同时喂 prepareCodexHome 与 argv（run() 两处都从它取）
  const inv = codexInvocationOf({ profile_requested: 'glm', model: 'glm-x', effort: 'low' });
  const argv = buildCodexArgs({ ...inv, readonlyArgs: [], cwd: '/p' });
  assert.equal(argv[argv.indexOf('-p') + 1], 'glm');
  assert.equal(argv[argv.indexOf('-c') + 1], 'model_reasoning_effort=low');
});

test('A3 claude：--effort 有值才传，紧跟 --model；准入脚本那种不带 effort 键的调用照旧不传', () => {
  const base = { model: 'claude-sonnet-5', readonlyArgs: ['--tools', 'Read'], schemaJson: null, settingsJson: null };
  const withE = buildClaudeArgs({ ...base, effort: 'xhigh' });
  const i = withE.indexOf('--effort');
  assert.ok(i > 0, withE.join(' '));
  assert.equal(withE[i + 1], 'xhigh');
  assert.equal(withE[i - 2], '--model', '紧跟 --model');
  assert.ok(!buildClaudeArgs({ ...base, effort: null }).includes('--effort'));
  assert.ok(!buildClaudeArgs(base).includes('--effort'));
});

test('A4 agy 后缀格：带后缀 + effort ⇒ 不传；不带后缀 + effort ⇒ 传；无 effort ⇒ 不传', () => {
  const base = { prompt: 'x', timeoutMs: 600_000 };
  assert.ok(!buildAgyArgs({ ...base, model: 'gemini-3.8-flash-high', effort: 'low' }).includes('--effort'));
  const plain = buildAgyArgs({ ...base, model: 'gemini-3.8-flash', effort: 'low' });
  assert.equal(plain[plain.indexOf('--effort') + 1], 'low');
  assert.ok(!buildAgyArgs({ ...base, model: 'gemini-3.8-flash', effort: null }).includes('--effort'));
});

// ─────────────────────────── R 组：请求面与现役不变 ───────────────────────────

/*
 * 本仓同形配置（用户 2026-10-08 定 ①：本步不改 .trivium/config.yaml）：逐档位表 × 阶段，按改前的取值公式
 * （`effortFor` 只给 antigravity 取阶段级 effort、`vendorProfileOf` 取配置段 profile）算出「改前请求」，
 * 与改后 `resolveTier` 的请求逐字比对，再比两者经各家纯函数组出的 argv。
 */
test('R1 本仓裸 slug 配置：各侧请求的 model / effort / 厂商 profile 与 argv 与改前逐字相同', async () => {
  const own = YAML.parse(await fs.readFile(path.join(REPO_ROOT, '.trivium', 'config.yaml'), 'utf8')) as {
    profiles: Config['profiles'];
    agents: { gemini: { effort: Record<Stage, string> }; codex: { profile: string | null } };
  };
  const c = defaultConfig();
  c.profiles = own.profiles;
  const a = c.agents as unknown as Agents;
  a['gemini']!['effort'] = own.agents.gemini.effort;
  a['codex']!['profile'] = own.agents.codex.profile;
  let checked = 0;
  for (const name of Object.keys(own.profiles)) {
    c.active_profile = name;
    for (const stage of STAGES) {
      for (const id of ['gemini', 'codex', 'glm'] as CriticId[]) {
        const cell = own.profiles[name]?.[id]?.[stage];
        if (typeof cell !== 'string' || !cell) continue;
        const r = resolveTier(c, id, stage);
        const oldEffort = id === 'gemini' ? own.agents.gemini.effort[stage] : undefined;
        const oldProfile = id === 'codex' ? own.agents.codex.profile : null;
        const at = `${name}.${id}.${stage}`;
        assert.equal(r.model, cell, at);
        assert.equal(r.effort ?? undefined, oldEffort, `${at} 思考等级请求值与改前同值`);
        assert.equal(r.vendorProfile, oldProfile, `${at} 厂商 profile 与改前同值`);
        assert.equal(r.tierSource, 'legacy', at);
        if (id === 'gemini') {
          const base = { prompt: 'x', timeoutMs: 600_000, model: r.model };
          assert.deepEqual(buildAgyArgs({ ...base, effort: r.effort }), buildAgyArgs({ ...base, effort: oldEffort ?? null }), at);
        }
        if (id === 'codex') {
          const now = buildCodexArgs({
            ...codexInvocationOf({ profile_requested: r.vendorProfile, model: r.model!, ...(r.effort ? { effort: r.effort } : {}) }),
            readonlyArgs: ['-s', 'read-only'], cwd: '/p',
          });
          const before = buildCodexArgs({ profile: oldProfile, model: r.model, effort: null, readonlyArgs: ['-s', 'read-only'], cwd: '/p' });
          assert.deepEqual(now, before, at);
          assert.ok(!now.includes('-c'), `${at}：裸 slug 不下传思考等级`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked >= 9, `论域过小（${checked} 格），本条空转`);
});

test('R2 档位形态：codex / claude 的档位思考等级真进请求（原 effortFor 只给 antigravity 取值），gemini 档位没写 effort 即不下传', () => {
  const c = defaultConfig();
  setTiers(c, 'codex', { high: { model: 'deepseek-v4-pro', effort: 'max', profile: 'deepseek' } });
  setCell(c, 'codex', 'plan', { tier: 'high' });
  setTiers(c, 'claude', { high: { model: 'claude-sonnet-5', effort: 'xhigh' } });
  setCell(c, 'claude', 'plan', { tier: 'high' });
  setTiers(c, 'gemini', { low: { model: 'gemini-3.8-flash' } });
  setCell(c, 'gemini', 'plan', { tier: 'low' });
  const codex = resolveTier(c, 'codex', 'plan');
  assert.deepEqual([codex.effort, codex.vendorProfile, codex.tier, codex.tierSource], ['max', 'deepseek', 'high', 'profile']);
  const claude = resolveTier(c, 'claude', 'plan');
  assert.deepEqual([claude.effort, claude.tier], ['xhigh', 'high']);
  const gemini = resolveTier(c, 'gemini', 'plan');
  assert.equal(gemini.effort, null, '11.5：档位没写 effort 时不回落阶段级 effort（第 6 步起不下传）');
  assert.ok(!buildAgyArgs({ prompt: 'x', timeoutMs: 1, model: gemini.model, effort: gemini.effort }).includes('--effort'));
});

// ─────────────────────────── E 组：回读钩子 ───────────────────────────

test('E1 agy：只认回执——envelope 且 slug 带后缀才取后缀，其余 null + unverified', () => {
  assert.deepEqual(agyEffortReadback({ model_effective: 'gemini-3.8-flash-low', model_effective_source: 'envelope' }), { effective: 'low', source: 'envelope' });
  assert.deepEqual(agyEffortReadback({ model_effective: 'gemini-3.8-flash', model_effective_source: 'envelope' }), { effective: null, source: 'unverified' }, '回执 slug 不带后缀：证明不了生效档位');
  assert.deepEqual(
    agyEffortReadback({ model_effective: 'gemini-3.8-flash-high', model_effective_source: 'requested' }),
    { effective: null, source: 'unverified' },
    '回执缺失、适配器退到请求值：即使请求 slug 带后缀也不是回读',
  );
  assert.deepEqual(agyEffortReadback(failedResult('gemini', { status: 'failed', reason: 'x' })), { effective: null, source: 'unverified' });
  assert.equal(realAdapters().gemini!.effortReadback, agyEffortReadback, '适配器挂的就是这一个纯函数');
});

test('E2 codex / claude：恒 null + unverified——结果里塞一个带后缀、来源 envelope 的生效模型也不冒充', () => {
  for (const [critic, adapter] of [['codex', codexAdapter], ['claude', claudeAdapter]] as const) {
    const lure = okResult(critic, { model_effective: 'x-model-high', model_effective_source: 'envelope' });
    assert.deepEqual(adapter.effortReadback(lure), { effective: null, source: 'unverified' }, critic);
    assert.deepEqual(adapter.effortReadback(failedResult(critic, { status: 'timeout', reason: 'x' })), { effective: null, source: 'unverified' }, critic);
  }
});

test('E3 zcode：无此概念，生效值与来源都是 null（不是「没读到」）', () => {
  assert.deepEqual(zcodeAdapter.effortReadback(okResult('glm', { model_effective: 'GLM-5.3-high' })), { effective: null, source: null });
});

test('E4 桩：注入生效值 ⇒ envelope；不注入 ⇒ null + unverified', () => {
  const r = okResult('gemini', {});
  assert.deepEqual(makeStubAdapter('gemini', { mode: 'ok', effortEffective: 'high' }).effortReadback(r), { effective: 'high', source: 'envelope' });
  assert.deepEqual(makeStubAdapter('gemini', { mode: 'ok' }).effortReadback(r), { effective: null, source: 'unverified' });
});

test('E5 钩子必填：四家真实适配器都声明了（新增一家不声明编不过，这里再从运行期核一遍）', () => {
  const table = realAdapters();
  for (const id of ['gemini', 'glm', 'codex', 'claude'] as CriticId[]) {
    const a: CriticAdapter | undefined = table[id];
    assert.equal(typeof a?.effortReadback, 'function', id);
  }
});

// ─────────────────────────── C 组：契约三态与旧读者 ───────────────────────────

function metaWith(critic: Record<string, unknown> | null, top: Record<string, unknown> = {}): RunMeta {
  const m = newRunMeta({
    runId: 'R1', topic: '档位接线', stage: 'plan', rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
    ...('profile' in top ? { profile: top['profile'] as string } : {}),
  });
  if (critic) {
    m.critics.gemini = {
      vendor: 'antigravity', cli_version: '1', model_requested: 'gemini-3.8-flash-low', model_effective: 'gemini-3.8-flash-low',
      profile_requested: null, model_provider: null, status: 'ok', exit_code: 0, duration_s: 1,
      tool_calls: { read: 1 }, evidence_ok: true, heterogeneous: true,
      ...critic,
    } as RunMeta['critics']['gemini'];
  }
  return m;
}

const PRESENT = {
  effort: 'low', effort_requested: 'low', effort_effective: 'high', effort_effective_source: 'envelope',
  tier: 'low', tier_source: 'cli',
};
const NULLS = { effort_requested: null, effort_effective: null, effort_effective_source: null, tier: null, tier_source: 'legacy' };

test('C1 三态：在场、null、缺席（M11 第 6 步之前的旧留痕）都过当前 schema；顶层 profile 在场与缺席都过', () => {
  assert.deepEqual(validateRunMeta(metaWith(PRESENT, { profile: 'default' })), []);
  assert.deepEqual(validateRunMeta(metaWith(NULLS, { profile: 'default' })), []);
  assert.deepEqual(validateRunMeta(metaWith({})), [], '旧留痕：五个字段与顶层 profile 都缺席');
  assert.equal('profile' in metaWith({}), false, '没传就不写——生产写侧恒传，缺席只属于旧留痕');
  assert.equal(metaWith({}, { profile: 'flash' }).profile, 'flash');
});

test('C2 非法取值被拒：tier / tier_source / effort_effective_source 都是封闭枚举，顶层 profile 不收空串', () => {
  for (const [k, v] of [['tier', 'ultra'], ['tier_source', 'topic'], ['effort_effective_source', 'requested'], ['effort_requested', 3]] as const) {
    assert.ok(validateRunMeta(metaWith({ ...PRESENT, [k]: v }, { profile: 'default' })).length > 0, `${k}=${String(v)} 应被拒`);
  }
  assert.ok(validateRunMeta(metaWith(PRESENT, { profile: '' })).length > 0);
});

test('C3 旧读者读新留痕：本步之前的 run.v2.json 快照照样校验通过（只加字段、不升版本）', async () => {
  const old = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'test', 'fixtures', 'run.v2.pre-m11-step6.json'), 'utf8')) as Record<string, unknown>;
  delete old['$schema'];
  const v = new Ajv2020({ allErrors: true, strict: false }).compile(old);
  for (const m of [metaWith(PRESENT, { profile: 'default' }), metaWith(NULLS, { profile: 'default' })]) {
    assert.ok(v(JSON.parse(JSON.stringify(m))), JSON.stringify(v.errors));
  }
});

test('C4 front-matter 五键：恒写（null 也写），与 run.json 同值；回显剥离清单同批收录', () => {
  const result = okResult('codex', { model_effective: 'qwen3.8-flash', model_effective_source: 'trace' });
  const input: RenderInput = {
    critic: 'codex', stage: 'plan', topic: 'T', runId: 'R', rerunIndex: 1, review: null, rawText: '{}', result,
    modelRequested: 'qwen3.8-flash', effort: 'high',
    effortRequested: 'high', effortEffective: null, effortEffectiveSource: 'unverified', tier: 'high', tierSource: 'cli',
    snapshotHash: 'sha256:x', startedAt: 'a', finishedAt: 'b', evidenceOk: true, projectReads: 1,
    selectedCritics: ['codex'], degraded: false, drift: false, peerDeny: false,
    consultedUnverified: false, heterogeneous: true,
  } as RenderInput;
  const fm = YAML.parse(renderFrontMatter(input).replace(/^---\n|\n---\n?$/g, '')) as Record<string, unknown>;
  assert.deepEqual(
    [fm['effort_requested'], fm['effort_effective'], fm['effort_effective_source'], fm['tier'], fm['tier_source']],
    ['high', null, 'unverified', 'high', 'cli'],
  );
  assert.ok('effort_effective' in fm, 'null 也要写出键');
  for (const k of ['effort_requested', 'effort_effective', 'effort_effective_source', 'tier', 'tier_source']) {
    assert.ok(ECHOED_ORCHESTRATOR_KEYS.includes(k), `${k} 要进回显剥离清单`);
  }
});

// ─────────────────────────── K 组：claude 原生枚举 ───────────────────────────

const F6 = '  --effort <level>                                  Effort level for the current session (low, medium, high, xhigh, max)';

test('K1 parseEffortLevels：F6 原文、无此行、括号缺失、空串、同行多对括号取第一对、列表项不合形状', () => {
  assert.deepEqual(parseEffortLevels(`Usage: claude\n${F6}\n  --model <m>  Model`), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parseEffortLevels('Usage: claude\n  --model <m>  Model (sonnet, opus)'), [], '没有 --effort 旗标');
  assert.equal(parseEffortLevels('  --effort <level>  Effort level for the current session'), null, '行在而括号缺失');
  assert.deepEqual(parseEffortLevels(''), []);
  assert.deepEqual(
    parseEffortLevels('  --effort <level>  Effort (low, high) (default: high)'),
    ['low', 'high'],
    '厂商在列表后追加括号说明时取第一对（计划三审 CODEX-02）',
  );
  assert.equal(parseEffortLevels('  --effort <level>  Effort (see docs at https://x)'), null, '列表项不合形状 ⇒ 取不到，不落错枚举');
  assert.equal(parseEffortLevels('  --effort <level>  Effort ()'), null);
  assert.deepEqual(parseEffortLevels('  --effort-budget <n>  Something (a, b)'), [], '前缀相同的别的旗标不算');
});

test('K2 claudeReasoningLevels：缺席 / null ⇒ unknown（理由分写），[] ⇒ none，非空 ⇒ levels', () => {
  const old = claudeReasoningLevels({});
  assert.equal(old.kind, 'unknown');
  assert.match((old as { why: string }).why, /doctor/);
  const unparsed = claudeReasoningLevels({ effort_levels: null });
  assert.equal(unparsed.kind, 'unknown');
  assert.doesNotMatch((unparsed as { why: string }).why, /doctor/);
  assert.deepEqual(claudeReasoningLevels({ effort_levels: [] }), { kind: 'none' });
  assert.deepEqual(claudeReasoningLevels({ effort_levels: ['low', 'max'] }), { kind: 'levels', levels: ['low', 'max'] });
  assert.equal(claudeReasoningLevels(undefined).kind, 'unknown');
});

test('K3 probeClaude 零配额落盘：--no-model-calls 下也采 effort_levels，且不刷新 probed_at', async () => {
  const dir = await scratchDir('trivium-effort-probe-');
  const bin = path.join(dir, 'claude');
  await fs.writeFile(
    bin,
    ['#!/bin/sh', 'case "$1" in', '  --version) echo "2.1.291 (Claude Code)";;', `  --help) printf '%s\\n' 'Usage: claude' '${F6}';;`, 'esac', ''].join('\n'),
    { mode: 0o755 },
  );
  const { probe, notes } = await probeClaude(bin, { skipModelCalls: true });
  assert.deepEqual(probe.effort_levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(probe.probed_at, null, 'probed_at 的语义是「模型段真跑过」，帮助文本这一步不刷它');
  assert.ok(notes.some((n) => /--effort 取值：low, medium, high, xhigh, max/.test(n)), notes.join('\n'));

  await fs.writeFile(bin, ['#!/bin/sh', 'case "$1" in', '  --version) echo "2.1.291";;', '  --help) exit 3;;', 'esac', ''].join('\n'), { mode: 0o755 });
  assert.equal((await probeClaude(bin, { skipModelCalls: true })).probe.effort_levels, null, '帮助文本跑失败 ⇒ null');
});

// ─────────────────────────── P 组：可用性按本轮解析出的厂商 profile ───────────────────────────

function codexReady(): Config {
  const c = defaultConfig();
  Object.assign(c.probe.cli.codex!, {
    probed_at: new Date().toISOString(), entrypoint: '/bin/echo', readonly_flags: ['-s', 'read-only'], exec_headless_read_ok: true,
    providers: [
      { profile: 'qwen', provider: 'qwen', model: 'q', credentialed: true },
      { profile: 'deepseek', provider: 'deepseek', model: 'd', credentialed: true },
      { profile: 'glm', provider: 'glm', model: 'g', credentialed: false },
    ],
  });
  return c;
}

test('P1 codex 可用性：传了本轮解析值就逐个判、不再看配置段；不传按配置段（旧行为）', () => {
  const c = codexReady();
  (c.agents as unknown as Agents)['codex']!['profile'] = 'no-such';
  const ctx = { cfg: c, nodePath: process.execPath };
  assert.equal(codexAdapter.availability(ctx).ok, false, '不传：按配置段 no-such 判不存在');
  assert.deepEqual(codexAdapter.availability(ctx, { vendorProfiles: ['deepseek'] }), { ok: true }, '本轮解析出 deepseek：配置段的坏值不再相干');
  const missing = codexAdapter.availability(ctx, { vendorProfiles: ['deepseek', 'kimi'] });
  assert.equal(missing.ok, false);
  assert.match(missing.reason!, /厂商 profile「kimi」在本机不存在/);
  const noCred = codexAdapter.availability(ctx, { vendorProfiles: ['glm'] });
  assert.equal(noCred.ok, false);
  assert.match(noCred.reason!, /没有可用凭据/);
  assert.deepEqual(codexAdapter.availability(ctx, { vendorProfiles: [null] }), { ok: true }, '解析不出厂商 profile（不带 -p）：没有可判的');
});
