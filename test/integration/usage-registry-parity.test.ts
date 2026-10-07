/**
 * `trivium --help` 的取值清单与注册表同源（EV-61 原条目，M10b 第 2 步）。
 *
 * USAGE 此前写死 `--model-gemini <slug> / --model-glm <id>` 与 `--only gemini|glm`，
 * 而 CLI 按注册表接受四家。BACKLOG EV-61 原话：「`skill-flag-parity` 只抓旗标名，改取值提示不会红」——
 * 这条用例就是那道「会红」的判据：走真实打包产物，比对帮助文本与注册表。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { bundleMissing, bundleSkipReason, cli } from '../helpers/fixture.js';
import { CRITIC_AGENT_IDS } from '../../src/trivium/agents/registry.js';
import { vendorProfileAgents } from '../../src/trivium/tier-flags.js';

test('--help：--model-* 与 --only 的取值清单等于已启用的审核者全集', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await cli(os.tmpdir(), ['--help']);
  const out = r.stdout + r.stderr;
  for (const id of CRITIC_AGENT_IDS) assert.match(out, new RegExp(`--model-${id}\\b`), `帮助文本缺 --model-${id}`);
  assert.ok(out.includes(`--only ${CRITIC_AGENT_IDS.join('|')}`), '帮助文本的 --only 取值与注册表不一致');
  assert.doesNotMatch(out, /--model-gemini <slug> \/ --model-glm <id>/, '写死两家的旧文案回来了');
});

/*
 * 档位旗标（M11 第 5 步，计划三审 AGY-03）：--tier-* / --effort-* 对已启用审核者全集逐个在场；
 * --profile-〈id〉 只对实现了 vendorProfilesFor 钩子的侧在场（今天只有 codex），其余不得出现。
 */
test('--help：--tier-* / --effort-* 与已启用审核者全集对齐，--profile-〈id〉 只对带厂商 profile 概念的侧', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await cli(os.tmpdir(), ['--help']);
  const out = r.stdout + r.stderr;
  for (const id of CRITIC_AGENT_IDS) {
    assert.match(out, new RegExp(`--tier-${id}\\b`), `帮助文本缺 --tier-${id}`);
    assert.match(out, new RegExp(`--effort-${id}\\b`), `帮助文本缺 --effort-${id}`);
  }
  const withProfile = new Set<string>(vendorProfileAgents());
  assert.ok(withProfile.size > 0, '前提：至少一家带厂商 profile 概念，否则本条空转');
  for (const id of CRITIC_AGENT_IDS) {
    const re = new RegExp(`--profile-${id}\\b`);
    if (withProfile.has(id)) assert.match(out, re, `帮助文本缺 --profile-${id}`);
    else assert.doesNotMatch(out, re, `--profile-${id} 不该出现：${id} 没有厂商 profile 概念`);
  }
});
