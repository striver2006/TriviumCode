import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * 准入脚本与探针必须共用同一份契约来源，不得各自再造一份（EV-74 计划 §5 用例 5，
 * 代码双审 GLM-02）。
 *
 * grep 级契约：`scripts/claude-admission-control.mjs` 真跑要真起 claude CLI、
 * 按 AGENTS.md 测试要点**不进 `npm test`**，所以「脚本臂被悄悄改回自造 schema，
 * 或漏接 `config.js` 的共用出口」此前没有任何测试会红——本文件补上最低限度的
 * 静态防线，仿 `registry-parity.test.ts` 的文本扫描形态。
 */
test('准入脚本的结构化臂契约：经共用出口取 schema，不得再造内联迷你 schema（EV-74 计划 §5 用例 5）', async () => {
  const scriptPath = path.join(REPO_ROOT, 'scripts/claude-admission-control.mjs');
  const src = await fs.readFile(scriptPath, 'utf8');

  assert.match(
    src,
    /resolveAssetRoot/,
    '准入脚本必须经 config.js 的 resolveAssetRoot 取资产根，不得另立一套规则',
  );
  assert.match(
    src,
    /resolveReviewSchemaPath/,
    '准入脚本必须经 config.js 的 resolveReviewSchemaPath 拼契约相对路径，不得另立一套规则',
  );
  assert.match(
    src,
    /readSchemaJson/,
    '准入脚本必须经 adapters/claude.js 的 readSchemaJson 读契约（与探针同一份变换）',
  );

  /*
   * 这条正则钉的是 EV-74 之前的真实历史形状（properties/first_line/
   * additionalProperties 三件套的内联迷你 schema）。下方防空转腿用同一段历史
   * 文本自证它抓得住，避免写太宽而永远不命中（AGENTS.md 纪律 12）。
   */
  const inlineMiniSchema = /properties:\s*\{\s*first_line:/;
  assert.doesNotMatch(
    src,
    inlineMiniSchema,
    '准入脚本不得再造内联迷你 schema——应改经 readSchemaJson 读真实契约文件',
  );
});

test('防空转腿：「不得再造内联迷你 schema」的正则确实抓得住 EV-74 之前的旧形态', () => {
  const oldShape = `const schema = JSON.stringify({
    type: 'object', properties: { first_line: { type: 'string' } },
    required: ['first_line'], additionalProperties: false,
  });`;
  assert.match(oldShape, /properties:\s*\{\s*first_line:/);
});
