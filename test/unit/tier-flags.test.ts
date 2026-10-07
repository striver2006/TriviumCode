import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../../src/trivium/config.js';
import { TIER_NAMES } from '../../src/trivium/adapters/base.js';
import { ALL_AGENT_IDS } from '../../src/trivium/agents/registry.js';
import { assertModelOverrideKeys } from '../../src/trivium/critics.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import {
  assertTierFlags,
  collectTierFlags,
  mergeCliOverrides,
  tierFlagNames,
  vendorProfileAgents,
  type RawTierFlags,
} from '../../src/trivium/tier-flags.js';

/*
 * M11 第 5 步：档位命令行旗标的收集、键校验、取值校验与合并（设计 7.1「档位旗标」；计划 r2 §2.1、§3.1）。
 * 这一层只管形状；原生枚举、本机名单与过渡闸在 `checkTierCombos`（见 tier-resolve.test.ts 的 F 组）。
 */

const PICKED = ['codex', 'gemini', 'glm'];
const raw = (over: Partial<RawTierFlags> = {}): RawTierFlags => ({ tier: {}, effort: {}, profile: {}, ...over });
const usage = (fn: () => unknown, re: RegExp): void => {
  assert.throws(fn, (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.USAGE);
    assert.match(e.message, re);
    return true;
  });
};

test('K1 收集面是全部已登记 Agent；没写的不出现；写了空串的出现为空串（计划三审 AGY-02）', () => {
  const names = tierFlagNames();
  for (const id of ALL_AGENT_IDS) {
    for (const k of ['tier', 'effort', 'profile']) assert.ok(names.includes(`${k}-${id}`), `缺 ${k}-${id}`);
  }
  const given: Record<string, string> = { 'tier-gemini': 'high', 'effort-codex': '', 'profile-glm': 'x' };
  const r = collectTierFlags((n) => given[n]);
  assert.deepEqual(r, { tier: { gemini: 'high' }, effort: { codex: '' }, profile: { glm: 'x' } });
});

test('K2 键校验与 --model-〈id〉 同一份判定：能入选未入选列本轮入选并给 --critics 出口；Driver 自己列当前可用', () => {
  const cfg = defaultConfig();
  for (const k of ['tier', 'effort', 'profile'] as const) {
    usage(() => assertTierFlags(cfg, 'claude', raw({ [k]: { glm: 'high' } }), ['codex', 'gemini']),
      new RegExp(`--${k}-glm：glm 本轮没有入选[\\s\\S]*本轮入选：codex \\| gemini[\\s\\S]*--critics`));
    usage(() => assertTierFlags(cfg, 'claude', raw({ [k]: { claude: 'high' } }), PICKED),
      new RegExp(`--${k}-claude：它是本轮的 Driver[\\s\\S]*当前可用`));
  }
});

test('K3 --model-〈id〉 既有文案逐字不变（参数化之后的回归锁）', () => {
  const cfg = defaultConfig();
  assert.throws(() => assertModelOverrideKeys(cfg, 'claude', ['glm'], ['codex', 'gemini']), (e: Error) => {
    assert.equal(
      e.message,
      '--model-glm：glm 本轮没有入选，为它指定的模型不会生效。\n' +
        '  本轮入选：codex | gemini\n' +
        '  要让它参审，请用 --critics 把它列进来；否则去掉这个旗标。',
    );
    return true;
  });
  assert.throws(() => assertModelOverrideKeys(cfg, 'claude', ['claude'], PICKED), (e: Error) => {
    assert.match(e.message, /^--model-claude：它是本轮的 Driver（执笔者），不能同时充当审核者，不能为它指定模型。\n {2}当前可用：/);
    return true;
  });
});

test('K4 --profile-〈id〉 只对带厂商 profile 概念的侧成立；给别家退 64 并点明不是 --profile 档位表名', () => {
  const cfg = defaultConfig();
  assert.deepEqual(vendorProfileAgents(), ['codex'], '前提：今天只有 codex 实现了 vendorProfilesFor');
  usage(() => assertTierFlags(cfg, 'claude', raw({ profile: { gemini: 'x' } }), PICKED),
    /--profile-gemini：gemini 没有厂商 profile 概念[\s\S]*不是 trivium 的 --profile 〈档位表名〉[\s\S]*可用：--profile-codex/);
  assert.deepEqual(assertTierFlags(cfg, 'claude', raw({ profile: { codex: 'deepseek' } }), PICKED), { codex: { vendorProfile: 'deepseek' } });
});

test('K5 --tier 只收三档名；三类旗标写了不给值都退 64', () => {
  const cfg = defaultConfig();
  usage(() => assertTierFlags(cfg, 'claude', raw({ tier: { gemini: 'ultra' } }), PICKED), /--tier-gemini 只接受 low \| medium \| high，收到：ultra/);
  usage(() => assertTierFlags(cfg, 'claude', raw({ tier: { gemini: '' } }), PICKED), /--tier-gemini 需要一个值/);
  usage(() => assertTierFlags(cfg, 'claude', raw({ effort: { codex: '' } }), PICKED), /--effort-codex 需要一个值/);
  usage(() => assertTierFlags(cfg, 'claude', raw({ profile: { codex: '' } }), PICKED), /--profile-codex 需要一个值/);
  assert.deepEqual(
    assertTierFlags(cfg, 'claude', raw({ tier: { gemini: 'low' }, effort: { codex: 'max' } }), PICKED),
    { gemini: { tier: 'low' }, codex: { effort: 'max' } },
  );
});

test('K6 mergeCliOverrides：模型与三类旗标逐侧合并、互不覆盖；没给的侧不出现', () => {
  assert.deepEqual(
    mergeCliOverrides({ gemini: 'g-x' }, { gemini: { tier: 'high' }, codex: { effort: 'max', vendorProfile: 'kimi' } }),
    { gemini: { model: 'g-x', tier: 'high' }, codex: { effort: 'max', vendorProfile: 'kimi' } },
  );
  assert.deepEqual(mergeCliOverrides({}, {}), {});
  assert.deepEqual(mergeCliOverrides({ glm: 'GLM-5.3' }), { glm: { model: 'GLM-5.3' } });
});

test('K7 三档清单只有一份：旗标层用的就是 base.ts 导出的 TIER_NAMES（计划三审 GLM-03）', () => {
  assert.deepEqual([...TIER_NAMES], ['low', 'medium', 'high']);
  for (const t of TIER_NAMES) {
    assert.deepEqual(assertTierFlags(defaultConfig(), 'claude', raw({ tier: { glm: t } }), PICKED), { glm: { tier: t } });
  }
});
