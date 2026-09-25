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

test('--help：--model-* 与 --only 的取值清单等于已启用的审核者全集', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await cli(os.tmpdir(), ['--help']);
  const out = r.stdout + r.stderr;
  for (const id of CRITIC_AGENT_IDS) assert.match(out, new RegExp(`--model-${id}\\b`), `帮助文本缺 --model-${id}`);
  assert.ok(out.includes(`--only ${CRITIC_AGENT_IDS.join('|')}`), '帮助文本的 --only 取值与注册表不一致');
  assert.doesNotMatch(out, /--model-gemini <slug> \/ --model-glm <id>/, '写死两家的旧文案回来了');
});
