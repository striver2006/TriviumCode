import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { scratchDir } from '../helpers/scratch.js';
import { after } from 'node:test';
import path from 'node:path';
import YAML from 'yaml';
import { resolveTier, type TierResolution } from '../../src/trivium/adapters/base.js';
import { realAdapters } from '../../src/trivium/adapters/index.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { checkModelSlugs, checkTierCombos } from '../../src/trivium/preflight.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import type { Config, CriticId, Stage, StageModel, TierEntry, TierName } from '../../src/trivium/types.js';

/*
 * M11 第 4 步：档位解析两段式（设计 11.5）、`tier` / `tier_source` 取值、适配器思考等级钩子、
 * 与预检「档位组合合法」。计划 r2 §3.3～§3.4、§5.1；取值规则按计划三审 AGY-01 统一后的四格（P-6 A）。
 *
 * 命令行一级（`--tier-<id>` / `--model-<id>` / `--effort-<id>` / `--profile-codex`）随第 5 步才有旗标，
 * 本文件以 `resolveTier` 的第四个参数注入。
 */

const STAGES: readonly Stage[] = ['plan', 'code', 'bug'];
// 名称校验读取真实文件清单；隔离 HOME，不依赖开发者机器上的 profile。
const originalCodexHome = process.env['CODEX_HOME'];
const profileHome = await scratchDir('trivium-profile-names-');
for (const name of ['qwen', 'kimi', 'deepseek']) await fs.writeFile(path.join(profileHome, `${name}.config.toml`), '# 离线名称夹具\n');
process.env['CODEX_HOME'] = profileHome;
after(() => { if (originalCodexHome === undefined) delete process.env['CODEX_HOME']; else process.env['CODEX_HOME'] = originalCodexHome; });

type Agents = Record<string, Record<string, unknown>>;
function cfgOf(mut: (c: Config, agents: Agents) => void = () => {}): Config {
  const c = defaultConfig();
  mut(c, c.agents as unknown as Agents);
  return c;
}
function setTiers(c: Config, id: string, tiers: Partial<Record<TierName, TierEntry>>, def?: TierName): void {
  const a = (c.agents as unknown as Agents)[id]!;
  a['tiers'] = tiers;
  if (def) a['default_tier'] = def;
}
function setCell(c: Config, id: string, stage: Stage, v: StageModel | undefined): void {
  const p = c.profiles[c.active_profile]!;
  const row = ((p as Record<string, Record<string, unknown>>)[id] ??= {});
  if (v === undefined) delete row[stage];
  else row[stage] = v;
}
const pick = (r: TierResolution) => ({
  model: r.model, effort: r.effort, vendorProfile: r.vendorProfile, tier: r.tier, tierSource: r.tierSource,
});

// ── 第一段：基础组合的三个来源与次序 ──

test('R1 第一段次序：命令行档位 > 档位表格子 > default_tier', () => {
  const c = cfgOf((cfg) => {
    setTiers(cfg, 'codex', {
      low: { model: 'm-low' },
      medium: { model: 'm-mid', effort: 'medium' },
      high: { model: 'm-high', effort: 'max', profile: 'deepseek' },
    }, 'low');
    setCell(cfg, 'codex', 'plan', { tier: 'medium' });
    setCell(cfg, 'codex', 'code', undefined);
  });
  assert.deepEqual(pick(resolveTier(c, 'codex', 'plan', { tier: 'high' })), {
    model: 'm-high', effort: 'max', vendorProfile: 'deepseek', tier: 'high', tierSource: 'cli',
  });
  assert.deepEqual(pick(resolveTier(c, 'codex', 'plan')), {
    model: 'm-mid', effort: 'medium', vendorProfile: 'qwen', tier: 'medium', tierSource: 'profile',
  }, '档位条目没写 profile ⇒ 回落 agents.codex.profile');
  assert.deepEqual(pick(resolveTier(c, 'codex', 'code')), {
    model: 'm-low', effort: null, vendorProfile: 'qwen', tier: 'low', tierSource: 'agent_default',
  }, '格子缺席才轮到 default_tier');
});

test('R2 档位表格子三形态：{tier} ⇒ profile；{model, effort} ⇒ 无档位名、profile；裸 slug ⇒ legacy', () => {
  const c = cfgOf((cfg) => {
    setTiers(cfg, 'codex', { high: { model: 'm-high' } });
    setCell(cfg, 'codex', 'plan', { tier: 'high' });
    setCell(cfg, 'codex', 'code', { model: 'm-cell', effort: 'low' });
    setCell(cfg, 'codex', 'bug', 'm-slug');
  });
  assert.deepEqual(pick(resolveTier(c, 'codex', 'plan')), { model: 'm-high', effort: null, vendorProfile: 'qwen', tier: 'high', tierSource: 'profile' });
  assert.deepEqual(pick(resolveTier(c, 'codex', 'code')), { model: 'm-cell', effort: 'low', vendorProfile: 'qwen', tier: null, tierSource: 'profile' });
  assert.deepEqual(pick(resolveTier(c, 'codex', 'bug')), { model: 'm-slug', effort: null, vendorProfile: 'qwen', tier: null, tierSource: 'legacy' });
});

test('R3 引用未定义的档：记 missingTier（来源与已定义的档），不抛，也不静默落到下一级', () => {
  const c = cfgOf((cfg) => {
    setTiers(cfg, 'codex', { low: { model: 'm-low' } }, 'low');
    setCell(cfg, 'codex', 'plan', { tier: 'high' });
  });
  const r = resolveTier(c, 'codex', 'plan');
  assert.equal(r.model, null, '写错的档不能静默落到 default_tier');
  assert.deepEqual(r.missingTier, { name: 'high', via: 'profile', defined: ['low'] });
  assert.deepEqual(resolveTier(c, 'codex', 'code', { tier: 'medium' }).missingTier, { name: 'medium', via: 'cli', defined: ['low'] });
  const noTiers = cfgOf((cfg) => { (cfg.agents as unknown as Agents)['glm']!['default_tier'] = 'high'; setCell(cfg, 'glm', 'plan', undefined); });
  assert.deepEqual(resolveTier(noTiers, 'glm', 'plan').missingTier, { name: 'high', via: 'agent_default', defined: [] });
});

test('R4 第一段无命中：无模型、tierSource 为 null；只有命令行模型时 ⇒ override', () => {
  const c = cfgOf((cfg) => setCell(cfg, 'glm', 'plan', undefined));
  assert.deepEqual(pick(resolveTier(c, 'glm', 'plan')), { model: null, effort: null, vendorProfile: null, tier: null, tierSource: null });
  assert.deepEqual(pick(resolveTier(c, 'glm', 'plan', { model: 'GLM-X' })), { model: 'GLM-X', effort: null, vendorProfile: null, tier: null, tierSource: 'override' });
  // 空串裸 slug 按无模型（没有 default_tier 时与旧 routeModel 的 falsy 判定同）
  const empty = cfgOf((cfg) => setCell(cfg, 'glm', 'plan', ''));
  assert.equal(resolveTier(empty, 'glm', 'plan').model, null);
  assert.equal(resolveTier(empty, 'glm', 'plan').emptySlug, true);
  // 有 default_tier 时也不回落：显式写空是配置错误（代码三审 GLM-01，与计划 r2 §3.3、计划三审 CODEX-03 同口径）
  const emptyWithDefault = cfgOf((cfg) => {
    setTiers(cfg, 'glm', { low: { model: 'GLM-5.3-Flash' } }, 'low');
    setCell(cfg, 'glm', 'plan', '');
  });
  const r = resolveTier(emptyWithDefault, 'glm', 'plan');
  assert.equal(r.model, null, '空串格子不得静默回落 default_tier');
  assert.equal(r.tierSource, null);
  assert.equal(r.emptySlug, true);
  // 格子缺席（不是空串）才轮到 default_tier
  setCell(emptyWithDefault, 'glm', 'code', undefined);
  assert.equal(resolveTier(emptyWithDefault, 'glm', 'code').model, 'GLM-5.3-Flash');
  assert.equal(resolveTier(emptyWithDefault, 'glm', 'code').emptySlug, false);
});

// ── 第二段：按字段叠加精确值；tier / tier_source 四格（P-6 A） ──

test('R5 档位被部分覆盖 ⇒ 保留档位名与来源；被覆盖字段原本来自档位时告警', () => {
  const c = cfgOf((cfg) => setTiers(cfg, 'codex', { high: { model: 'm-high', effort: 'max', profile: 'deepseek' } }, 'high'));
  setCell(c, 'codex', 'plan', undefined);
  const r = resolveTier(c, 'codex', 'plan', { model: 'm-x' });
  assert.deepEqual(pick(r), { model: 'm-x', effort: 'max', vendorProfile: 'deepseek', tier: 'high', tierSource: 'agent_default' });
  assert.equal(r.origin.model, 'cli');
  assert.equal(r.origin.effort, 'tier');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /覆盖了档位「high」的模型「m-high」/);
  const two = resolveTier(c, 'codex', 'plan', { model: 'm-x', effort: 'low' });
  assert.equal(two.tier, 'high', '还剩 profile 来自档位');
  assert.equal(two.warnings.length, 2);
});

test('R6 档位提供的字段被全部覆盖 ⇒ tier null、override；「提供的字段」按实际写了的键计', () => {
  const c = cfgOf((cfg) => setTiers(cfg, 'codex', { high: { model: 'm-high', effort: 'max', profile: 'deepseek' }, low: { model: 'm-low' } }));
  setCell(c, 'codex', 'plan', { tier: 'high' });
  setCell(c, 'codex', 'code', { tier: 'low' });
  assert.deepEqual(pick(resolveTier(c, 'codex', 'plan', { model: 'a', effort: 'b', vendorProfile: 'qwen' })), {
    model: 'a', effort: 'b', vendorProfile: 'qwen', tier: null, tierSource: 'override',
  });
  // 条目只写 model：覆盖 model 即全覆盖；厂商 profile 的回落是补全、不算档位提供
  assert.deepEqual(pick(resolveTier(c, 'codex', 'code', { model: 'a' })), {
    model: 'a', effort: null, vendorProfile: 'qwen', tier: null, tierSource: 'override',
  });
  // 只覆盖 effort（档位没提供它）不算覆盖档位字段
  assert.equal(resolveTier(c, 'codex', 'code', { effort: 'b' }).tierSource, 'profile');
});

test('R7 {model, effort} 格子：部分覆盖仍记 profile，全覆盖记 override', () => {
  const c = cfgOf((cfg) => setCell(cfg, 'codex', 'plan', { model: 'm-cell', effort: 'low' }));
  assert.equal(resolveTier(c, 'codex', 'plan', { model: 'a' }).tierSource, 'profile');
  assert.equal(resolveTier(c, 'codex', 'plan', { effort: 'b' }).tierSource, 'profile');
  const all = resolveTier(c, 'codex', 'plan', { model: 'a', effort: 'b' });
  assert.equal(all.tierSource, 'override');
  assert.equal(all.tier, null);
  assert.equal(all.warnings.length, 0, '格子的字段被覆盖不告警——告警只对档位');
});

test('R8 裸 slug：模型被命令行覆盖 ⇒ override（不把命令行的选择归给旧配置）；只给 effort 仍是 legacy', () => {
  const c = defaultConfig();
  const r = resolveTier(c, 'gemini', 'plan', { model: 'gemini-x' });
  assert.equal(r.tierSource, 'override');
  assert.equal(r.effort, 'high', 'gemini 阶段级 effort 是补全、不是基础组合提供的字段，照旧回落');
  assert.equal(resolveTier(c, 'gemini', 'plan', { effort: 'low' }).tierSource, 'legacy');
});

test('R9 厂商 profile 三层次序：命令行 > 档位条目 > agents.<id>.profile；非 openai vendor 恒 null', () => {
  const c = cfgOf((cfg) => setTiers(cfg, 'codex', { high: { model: 'm', profile: 'deepseek' } }));
  setCell(c, 'codex', 'plan', { tier: 'high' });
  assert.equal(resolveTier(c, 'codex', 'plan', { vendorProfile: 'kimi' }).vendorProfile, 'kimi');
  assert.equal(resolveTier(c, 'codex', 'plan').vendorProfile, 'deepseek');
  assert.equal(resolveTier(c, 'codex', 'code').vendorProfile, 'qwen');
  assert.equal(resolveTier(c, 'codex', 'code').origin.vendorProfile, 'agent');
  for (const id of ['gemini', 'glm']) {
    const r = resolveTier(c, id as CriticId, 'plan', { vendorProfile: 'kimi' });
    assert.equal(r.vendorProfile, null, `${id} 没有厂商 profile 概念`);
    assert.equal(r.origin.vendorProfile, null);
  }
  // profile 在 schema 里只给 openai 支；就算手工塞进别家的档位，解析也不认
  const leak = cfgOf((cfg) => setTiers(cfg, 'gemini', { high: { model: 'g', profile: 'p' } }));
  setCell(leak, 'gemini', 'plan', { tier: 'high' });
  assert.equal(resolveTier(leak, 'gemini', 'plan').vendorProfile, null);
});

test('R10 gemini 思考等级回落只对裸 slug：档位与 {model, effort} 格子不回落阶段级 effort', () => {
  const c = cfgOf((cfg) => setTiers(cfg, 'gemini', { low: { model: 'gemini-3.8-flash' } }));
  setCell(c, 'gemini', 'plan', { tier: 'low' });
  const tier = resolveTier(c, 'gemini', 'plan');
  // M11 第 6 步起这就是请求面的取值：档位没写 effort ⇒ 不下传（第 4、5 步另记的 stageEffort 随过渡告警删除）
  assert.equal(tier.effort, null);
  assert.equal(tier.origin.effort, null);
  const slug = resolveTier(c, 'gemini', 'code');
  assert.equal(slug.effort, 'high');
  assert.equal(slug.origin.effort, 'agent');
  // 废弃键 agents.codex.effort 即使还在配置里，也不回落（只有 antigravity 有阶段级 effort）
  const legacyCodex = cfgOf((_cfg, a) => { a['codex']!['effort'] = { plan: 'high', code: 'high', bug: 'high' }; });
  assert.equal(resolveTier(legacyCodex, 'codex', 'plan').effort, null);
  assert.equal(resolveTier(legacyCodex, 'codex', 'plan').origin.effort, null);
});

/*
 * **裸 slug 行为逐字不变**：旧 routeModel 对裸 slug 返回的就是格子字符串本身。对内置默认与本仓 config.yaml 的
 * 每张档位表 × 每个 Agent × 每个阶段，解析出的模型都等于格子原值、来源 legacy（旧函数已删，这里以格子原值为旧结果表）。
 */
test('R11 裸 slug 等价性：内置默认与本仓配置逐格解析结果等于格子原值', async () => {
  const own = YAML.parse(await fs.readFile(path.join(REPO_ROOT, '.trivium', 'config.yaml'), 'utf8')) as { profiles: Config['profiles'] };
  let checked = 0;
  for (const profiles of [defaultConfig().profiles, own.profiles]) {
    const c = defaultConfig();
    c.profiles = profiles;
    for (const [name, table] of Object.entries(profiles)) {
      c.active_profile = name;
      for (const [id, row] of Object.entries(table)) {
        for (const stage of STAGES) {
          const cell = row?.[stage];
          if (typeof cell !== 'string' || !cell) continue;
          const r = resolveTier(c, id as CriticId, stage);
          assert.equal(r.model, cell, `${name}.${id}.${stage}`);
          assert.equal(r.tierSource, 'legacy');
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 20, `论域过小（${checked} 格），本条空转`);
});

// ── 适配器思考等级钩子（计划三审 AGY-03）──

test('H1 codex 钩子：按厂商 profile 取逐模型枚举；无 profile 取基底；旧探针或查无 ⇒ unknown', () => {
  const c = defaultConfig();
  const codex = realAdapters().codex!;
  assert.equal(codex.reasoningLevelsFor!(c, 'm', 'qwen').kind, 'unknown', '旧探针结论没有 reasoning_levels');
  delete c.probe.cli.codex!.reasoning_levels;
  assert.equal(codex.reasoningLevelsFor!(c, 'm', 'qwen').kind, 'unknown');
  c.probe.cli.codex!.reasoning_levels = { base: { b1: ['low', 'high'] }, by_profile: { qwen: { q1: ['low', 'medium', 'high'], q2: [] } } };
  assert.deepEqual(codex.reasoningLevelsFor!(c, 'q1', 'qwen'), { kind: 'levels', levels: ['low', 'medium', 'high'] });
  assert.deepEqual(codex.reasoningLevelsFor!(c, 'b1', null), { kind: 'levels', levels: ['low', 'high'] });
  assert.equal(codex.reasoningLevelsFor!(c, 'q2', 'qwen').kind, 'unknown', '空枚举校验不了任何值');
  assert.equal(codex.reasoningLevelsFor!(c, 'q1', 'deepseek').kind, 'unknown', '该 profile 没采到');
  c.probe.cli.codex!.profiles = ['qwen', 'kimi'];
  assert.deepEqual(codex.vendorProfilesFor!(c).sort(), ['deepseek', 'kimi', 'qwen'], '本机文件清单优先于过期探针名单');
});

test('H2 agy 钩子：带后缀 ⇒ slug 已编码档位；不带后缀 ⇒ 由目录里的变体派生；没有变体 ⇒ unknown', () => {
  const c = defaultConfig();
  const agy = realAdapters().gemini!;
  c.probe.cli.agy!.models = ['gemini-3.8-flash-high', 'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.1-pro-high'];
  assert.deepEqual(agy.reasoningLevelsFor!(c, 'gemini-3.8-flash-high', null), { kind: 'levels', levels: [], suffixEncoded: true });
  assert.deepEqual(agy.reasoningLevelsFor!(c, 'gemini-3.8-flash', null), { kind: 'levels', levels: ['high', 'low', 'medium'] });
  assert.deepEqual(agy.reasoningLevelsFor!(c, 'gemini-3.1-pro', null), { kind: 'levels', levels: ['high'] });
  assert.equal(agy.reasoningLevelsFor!(c, 'gemini-9', null).kind, 'unknown');
  c.probe.cli.agy!.models = [];
  assert.equal(agy.reasoningLevelsFor!(c, 'gemini-3.8-flash', null).kind, 'unknown');
});

test('H3 zcode 钩子 none；claude 钩子读探针的 effort_levels（M11 第 6 步）：缺席 / null ⇒ unknown，[] ⇒ none，非空 ⇒ levels', () => {
  const c = defaultConfig();
  assert.deepEqual(realAdapters().glm!.reasoningLevelsFor!(c, 'GLM-5.3', null), { kind: 'none' });
  const claude = realAdapters().claude!;
  const old = claude.reasoningLevelsFor!(c, 'claude-x', null);
  assert.equal(old.kind, 'unknown', '旧探针结论没有 effort_levels');
  assert.match((old as { why: string }).why, /早于 effort_levels.*doctor/);
  c.probe.cli.claude!.effort_levels = null;
  const unparsed = claude.reasoningLevelsFor!(c, 'claude-x', null);
  assert.equal(unparsed.kind, 'unknown');
  assert.match((unparsed as { why: string }).why, /没能解析/);
  c.probe.cli.claude!.effort_levels = [];
  assert.deepEqual(claude.reasoningLevelsFor!(c, 'claude-x', null), { kind: 'none' }, '帮助文本里没有 --effort');
  c.probe.cli.claude!.effort_levels = ['low', 'medium', 'high', 'xhigh', 'max'];
  assert.deepEqual(claude.reasoningLevelsFor!(c, 'claude-x', null), { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] });
  assert.equal(realAdapters().glm!.vendorProfilesFor, undefined, '没有厂商 profile 概念的侧不实现名单钩子');
});

// ── 预检：模型 slug 合法（档名格并入，GLM-04）与档位组合合法 ──

test('S1 档名写错：slug 检查直接报档名与可用档，退 64——有命令行模型覆盖时也报', () => {
  const c = cfgOf((cfg) => setTiers(cfg, 'glm', { low: { model: 'GLM-5.3-Flash' } }));
  setCell(c, 'glm', 'plan', { tier: 'high' });
  for (const over of [{}, { glm: 'GLM-5.3' }]) {
    const r = checkModelSlugs(c, 'plan', over, ['glm']);
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, EXIT.USAGE);
    assert.match(r.detail, /档位「high」（经档位表格子指定）未在 agents\.glm\.tiers 定义。可用：low/);
  }
});

test('S2 第一段无命中：退 64（P-4 A：与 M11 之前同一出口），文案带 default_tier', () => {
  const c = cfgOf((cfg) => setCell(cfg, 'glm', 'plan', undefined));
  const r = checkModelSlugs(c, 'plan', {}, ['glm']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.USAGE);
  assert.match(r.detail, /未定义模型且无覆盖/);
  assert.match(r.detail, /default_tier/);
});

test('S2b 空串格子 + default_tier：slug 检查退 64 并点明是空串、不回落（代码三审 GLM-01）', () => {
  const c = cfgOf((cfg) => {
    setTiers(cfg, 'glm', { low: { model: 'GLM-5.3-Flash' } }, 'low');
    setCell(cfg, 'glm', 'plan', '');
  });
  const r = checkModelSlugs(c, 'plan', {}, ['glm']);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.USAGE);
  assert.match(r.detail, /未定义模型且无覆盖/);
  assert.match(r.detail, /写的是空串/);
});

test('S3 档位换家族：slug 按档位的厂商 profile 取目录校验', () => {
  const c = cfgOf((cfg) => setTiers(cfg, 'codex', { high: { model: 'deepseek-v4-pro', profile: 'deepseek' } }));
  setCell(c, 'codex', 'plan', { tier: 'high' });
  setCell(c, 'codex', 'code', 'deepseek-v4-pro');
  const p = c.probe.cli.codex!;
  p.models_by_profile = { qwen: ['qwen3.8-flash'], deepseek: ['deepseek-v4-pro'] };
  assert.equal(checkModelSlugs(c, 'plan', {}, ['codex']).ok, true, '按 deepseek 目录校验应通过');
  const bad = checkModelSlugs(c, 'code', {}, ['codex']);
  assert.equal(bad.ok, false, '裸 slug 仍按 agents.codex.profile 的目录校验——旧行为不变');
  assert.match(bad.detail, /不在 profile「qwen」的模型目录中/);
});

/** 档位组合检查用的配置：探针给 codex 两个 profile 与枚举、agy 带后缀变体 */
function comboCfg(mut: (c: Config) => void): Config {
  const c = defaultConfig();
  const p = c.probe.cli.codex!;
  p.profiles = ['qwen', 'deepseek'];
  p.models_by_profile = { qwen: ['qwen3.8-flash'], deepseek: ['deepseek-v4-pro'] };
  p.reasoning_levels = {
    base: {},
    by_profile: { qwen: { 'qwen3.8-flash': ['low', 'medium', 'high'] }, deepseek: { 'deepseek-v4-pro': ['low', 'high', 'max'] } },
  };
  c.probe.cli.agy!.models = ['gemini-3.8-flash-high', 'gemini-3.8-flash-low', 'gemini-3.8-flash-medium'];
  mut(c);
  return c;
}

test('C1 内置默认配置：档位组合通过、零告警（今天能跑的配置不被误拦也不被念叨）', () => {
  const r = checkTierCombos(comboCfg(() => {}), 'all', {}, ['codex', 'gemini', 'glm']);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.warn, undefined, r.detail);
});

test('C2 永久判据：枚举外 effort、名单外 profile、无思考等级概念却给了 effort，各退 64 并列出可用值', () => {
  const enumBad = checkTierCombos(comboCfg((c) => setCell(c, 'codex', 'plan', { model: 'qwen3.8-flash', effort: 'xhigh' })), 'plan', {}, ['codex']);
  assert.equal(enumBad.ok, false);
  assert.equal(enumBad.exitCode, EXIT.USAGE);
  assert.match(enumBad.detail, /「xhigh」不在模型「qwen3\.8-flash」的原生枚举中。可用值：low, medium, high/);
  assert.doesNotMatch(enumBad.detail, /第 6 步|过渡/, '过渡闸已拆（M11 第 6 步），只剩永久判据的真病因');

  const profBad = checkTierCombos(comboCfg((c) => {
    setTiers(c, 'codex', { high: { model: 'kimi-for-coding', profile: '__missing__' } });
    setCell(c, 'codex', 'plan', { tier: 'high' });
  }), 'plan', {}, ['codex']);
  assert.equal(profBad.ok, false);
  assert.match(profBad.detail, /厂商 profile「__missing__」不在本机名单中/);

  // schema 够不着档位表格子：glm 写 {model, effort} 能过 schema，由这里拒（AGY-02 / GLM-02）
  const glm = checkTierCombos(comboCfg((c) => setCell(c, 'glm', 'plan', { model: 'GLM-5.3', effort: 'high' })), 'plan', {}, ['glm']);
  assert.equal(glm.ok, false);
  assert.match(glm.detail, /ZCode 不支持思考等级/);
});

/*
 * ── T：过渡闸拆除后的反转（M11 第 6 步，计划 r2 §3.1 T 组）──
 *
 * 第 4、5 步这几格退 64 或告警，理由是「思考等级与厂商 profile 尚未透传」。第 6 步接线后逐格反转为通过，
 * 且文案里不再出现指向第 6 步的过渡说法——留着它们就是告诉用户一件已经不成立的事。
 */
test('C3 / T1 原过渡闸两格反转：档位表格子的合法 effort、与 agents.codex.profile 不同的档位 profile ⇒ 通过', () => {
  const eff = checkTierCombos(comboCfg((c) => setCell(c, 'codex', 'plan', { model: 'qwen3.8-flash', effort: 'high' })), 'plan', {}, ['codex']);
  assert.equal(eff.ok, true, eff.detail);
  assert.equal(eff.warn, undefined, eff.detail);
  const viaCli = checkTierCombos(comboCfg(() => {}), 'plan', {}, ['codex']);
  assert.equal(viaCli.ok, true, '没写 effort 照旧通过');

  const prof = checkTierCombos(comboCfg((c) => {
    setTiers(c, 'codex', { high: { model: 'deepseek-v4-pro', profile: 'deepseek' } });
    setCell(c, 'codex', 'plan', { tier: 'high' });
  }), 'plan', {}, ['codex']);
  assert.equal(prof.ok, true, prof.detail);
  assert.doesNotMatch(prof.detail, /第 6 步|过渡/);
  // 「只整段覆盖 tiers 一处即换家族」由此可用（EV-27 结构部分）：slug 也按档位的厂商 profile 取目录
  const c = comboCfg((cfg) => {
    setTiers(cfg, 'codex', { high: { model: 'deepseek-v4-pro', profile: 'deepseek' } });
    setCell(cfg, 'codex', 'plan', { tier: 'high' });
  });
  assert.equal(checkModelSlugs(c, 'plan', {}, ['codex']).ok, true);
});

test('C4 两键同改换家族（设计 13.1.1 现行出口）照旧通过：档位 profile 等于 agents.codex.profile', () => {
  const r = checkTierCombos(comboCfg((c) => {
    (c.agents as unknown as Agents)['codex']!['profile'] = 'deepseek';
    setTiers(c, 'codex', { high: { model: 'deepseek-v4-pro', profile: 'deepseek' } });
    setCell(c, 'codex', 'plan', { tier: 'high' });
  }), 'plan', {}, ['codex']);
  assert.equal(r.ok, true, r.detail);
});

test('C5 / T2 取不到就跳过并点名：旧探针无枚举时 effort 不做枚举校验、通过并告警（原「过渡闸仍拦」反转）；名单为空时 profile 跳过', () => {
  const noEnum = checkTierCombos(comboCfg((c) => {
    delete c.probe.cli.codex!.reasoning_levels;
    setCell(c, 'codex', 'plan', { model: 'qwen3.8-flash', effort: 'whatever' });
  }), 'plan', {}, ['codex']);
  assert.equal(noEnum.ok, true, noEnum.detail);
  assert.equal(noEnum.warn, true);
  assert.doesNotMatch(noEnum.detail, /原生枚举中/, '取不到枚举不得硬拒成「不在枚举中」');
  assert.match(noEnum.detail, /未实际校验/);
  assert.doesNotMatch(noEnum.detail, /第 6 步|过渡/);

  const emptyNames = checkTierCombos(comboCfg((c) => {
    c.probe.cli.codex!.profiles = [];
    setTiers(c, 'codex', { high: { model: 'qwen3.8-flash', profile: 'qwen' } });
    setCell(c, 'codex', 'plan', { tier: 'high' });
  }), 'plan', {}, ['codex']);
  assert.equal(emptyNames.ok, true, emptyNames.detail);
  assert.equal(emptyNames.warn, undefined, '本机存在 qwen，旧探针名单为空不造成跳过校验');
});

test('C6 / T3 gemini：原过渡残余告警反转为不告警（档位没写 effort 即不下传）；slug 已编码档位再给 effort 仍告警（永久）', () => {
  const residual = checkTierCombos(comboCfg((c) => {
    setTiers(c, 'gemini', { low: { model: 'gemini-3.8-flash' } });
    setCell(c, 'gemini', 'plan', { tier: 'low' });
  }), 'plan', {}, ['gemini']);
  assert.equal(residual.ok, true, residual.detail);
  assert.equal(residual.warn, undefined, residual.detail);

  const suffixed = checkTierCombos(comboCfg((c) => {
    setTiers(c, 'gemini', { low: { model: 'gemini-3.8-flash-low' } });
    setCell(c, 'gemini', 'plan', { tier: 'low' });
  }), 'plan', {}, ['gemini']);
  assert.equal(suffixed.warn, undefined, 'slug 带后缀时 agy 本就不传 --effort，不构成偏差、不告警');

  const encoded = checkTierCombos(comboCfg((c) => setCell(c, 'gemini', 'plan', { model: 'gemini-3.8-flash-low', effort: 'high' })), 'plan', {}, ['gemini']);
  assert.match(encoded.detail, /slug 已编码档位，思考等级「high」不生效/);
});

test('C7 档名缺失与无模型由 slug 检查报，档位组合检查不重复报', () => {
  const c = comboCfg((cfg) => setCell(cfg, 'glm', 'plan', { tier: 'high' }));
  const r = checkTierCombos(c, 'plan', {}, ['glm']);
  assert.equal(r.ok, true, r.detail);
});

// ── F：命令行档位旗标进两格校验（M11 第 5 步，计划 r2 §2.3、§3.1）──

/** codex 与 gemini 都配好档位：codex 两档（只写 model / 带 effort），gemini 一档不带后缀 */
function flagCfg(): Config {
  return comboCfg((c) => {
    setTiers(c, 'codex', { low: { model: 'qwen3.8-flash' }, high: { model: 'qwen3.8-flash', effort: 'high' } });
    setTiers(c, 'gemini', { low: { model: 'gemini-3.8-flash-low' } });
  });
}

test('F1 --tier 选到未定义的档：slug 检查报档名与可用档、来源是命令行，退 64', () => {
  const r = checkModelSlugs(flagCfg(), 'plan', {}, ['codex'], { codex: { tier: 'medium' } });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.USAGE);
  assert.match(r.detail, /档位「medium」（经命令行指定）未在 agents\.codex\.tiers 定义。可用：low, high/);
});

test('F2 / T4 --tier 选到只写 model 的档：通过且零告警（原留痕空窗告警反转：tier / tier_source 第 6 步起入档）', () => {
  const r = checkTierCombos(flagCfg(), 'plan', {}, ['codex'], { codex: { tier: 'low' } });
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.warn, undefined, r.detail);
  assert.doesNotMatch(r.detail, /尚未入档|第 6 步/);
  // 路由真的取到了档位的模型
  assert.equal(checkModelSlugs(flagCfg(), 'plan', {}, ['codex'], { codex: { tier: 'low' } }).ok, true);
});

test('F3 / T5 原过渡闸三格反转：--tier 选到带 effort 的档、--effort 单独给、--profile-codex 不同于 agents.codex.profile——通过', () => {
  const tierEffort = checkTierCombos(flagCfg(), 'plan', {}, ['codex'], { codex: { tier: 'high' } });
  assert.equal(tierEffort.ok, true, tierEffort.detail);
  assert.equal(tierEffort.warn, undefined, tierEffort.detail);

  const eff = checkTierCombos(flagCfg(), 'plan', {}, ['codex'], { codex: { effort: 'low' } });
  assert.equal(eff.ok, true, eff.detail);
  assert.equal(eff.warn, undefined, eff.detail);

  const prof = checkTierCombos(flagCfg(), 'plan', { codex: 'deepseek-v4-pro' }, ['codex'], { codex: { vendorProfile: 'deepseek' } });
  assert.equal(prof.ok, true, prof.detail);
  assert.doesNotMatch(prof.detail, /第 6 步|过渡/);
  // 同一组输入下 slug 检查按 deepseek 的目录比对（三处同值的目录那一处）
  assert.equal(checkModelSlugs(flagCfg(), 'plan', { codex: 'deepseek-v4-pro' }, ['codex'], { codex: { vendorProfile: 'deepseek' } }).ok, true);

  // --profile-codex 等于 agents.codex.profile：照旧通过
  assert.equal(checkTierCombos(flagCfg(), 'plan', {}, ['codex'], { codex: { vendorProfile: 'qwen' } }).ok, true);
});

test('F4 永久判据不随过渡闸拆除：--effort 枚举外报枚举；--profile-codex 名单外报名单、名单为空跳过并点名', () => {
  const enumBad = checkTierCombos(flagCfg(), 'plan', {}, ['codex'], { codex: { effort: 'xhigh' } });
  assert.equal(enumBad.ok, false);
  assert.equal(enumBad.exitCode, EXIT.USAGE);
  assert.match(enumBad.detail, /「xhigh」不在模型「qwen3\.8-flash」的原生枚举中。可用值：low, medium, high/);
  assert.doesNotMatch(enumBad.detail, /第 6 步|过渡/);

  const nameBad = checkTierCombos(flagCfg(), 'plan', {}, ['codex'], { codex: { vendorProfile: '__missing__' } });
  assert.equal(nameBad.ok, false);
  assert.match(nameBad.detail, /厂商 profile「__missing__」不在本机名单中/);

  const empty = flagCfg();
  empty.probe.cli.codex!.profiles = [];
  const skipped = checkTierCombos(empty, 'plan', {}, ['codex'], { codex: { vendorProfile: 'qwen' } });
  assert.equal(skipped.ok, true, skipped.detail);
  assert.doesNotMatch(skipped.detail, /名单为空/, '名称从真实文件读取');
});

test('F5 gemini 的 slug 已编码档位：--effort-gemini 只告警不生效、不退 64（计划三审 GLM-02）', () => {
  const r = checkTierCombos(flagCfg(), 'plan', {}, ['gemini'], { gemini: { tier: 'low', effort: 'high' } });
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /slug 已编码档位，思考等级「high」不生效/);
});

test('F6 --model 覆盖了 --tier 选出的档位模型：出「覆盖了档位」的告警，不阻断', () => {
  const r = checkTierCombos(flagCfg(), 'plan', { codex: 'qwen3.8-flash' }, ['codex'], { codex: { tier: 'low' } });
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /命令行模型「qwen3\.8-flash」覆盖了档位「low」的模型/);
});
