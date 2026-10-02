/**
 * 任务书第 7 节点名禁用执行型 MCP 工具的接线（EV-191，任务书点名禁用MCP执行工具计划 r2 §3.1 ②）。
 *
 * 单测直调 `renderBrief`，管不到接线；这里走真实打包 CLI 子进程 + 桩（零配额），验 `prepareRun` 把**适配器的声明**
 * 递进渲染：恒传空、恒传 zcode 名单、两侧串值、按侧名硬编码，都会在这两次运行（第二次两侧互换）里红。
 * 真实 zcode 适配器进不了桩运行，所以由桩的显式覆盖 `mcpExecPrefixes` 充当会声明的那一侧。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;

const BAN_MARK = '你的工具清单里另有**能执行代码的 MCP 工具**（名字以 `mcp__node_repl__` 开头）。**不要调用它们，焦点要求也不行**';

/** 跑一次同步 review，返回各侧落盘任务书的第 7 节 */
async function section7ByCritic(topic: string, stub: StubConfig): Promise<Record<string, string>> {
  const fx = await makeFixture({ topic });
  const r = await cli(fx.root, ['review', '--stage', 'plan', '--topic', topic, '--focus', 'x'], stub);
  assert.equal(r.code, EXIT.OK, `${r.stdout}\n${r.stderr}`);
  const metaDir = path.join(fx.stageDir, '_meta');
  const out: Record<string, string> = {};
  for (const critic of Object.keys(stub)) {
    const files = (await fs.readdir(metaDir)).filter((f) => f.startsWith(`brief-${critic}-`) && f.endsWith('.md'));
    assert.equal(files.length, 1, `${critic} 侧应恰有一份任务书：${files.join('、')}`);
    const text = await fs.readFile(path.join(metaDir, files[0]!), 'utf8');
    const s = text.indexOf('## 7. 反谄媚约束');
    const e = text.indexOf('## 8. ', s);
    assert.ok(s >= 0 && e > s, `${critic} 侧任务书段落结构变了`);
    out[critic] = text.slice(s, e);
  }
  return out;
}

test('声明了执行型 MCP 前缀的一侧拿到点名禁令，另一侧没有', { skip }, async () => {
  const s7 = await section7ByCritic('第七节点名接线', {
    gemini: { mode: 'ok' },
    glm: { mode: 'ok', mcpExecPrefixes: ['mcp__node_repl__'] },
  });
  assert.ok(s7['glm']!.includes(BAN_MARK), `glm（声明）应有点名禁令\n${s7['glm']}`);
  assert.ok(!s7['gemini']!.includes('MCP 工具'), `gemini（不声明）不应有点名禁令\n${s7['gemini']}`);
});

test('两侧互换：禁令跟着声明走，不跟侧名', { skip }, async () => {
  const s7 = await section7ByCritic('第七节点名接线互换', {
    gemini: { mode: 'ok', mcpExecPrefixes: ['mcp__node_repl__'] },
    glm: { mode: 'ok' },
  });
  assert.ok(s7['gemini']!.includes(BAN_MARK), `gemini（声明）应有点名禁令\n${s7['gemini']}`);
  assert.ok(!s7['glm']!.includes('MCP 工具'), `glm（不声明）不应有点名禁令\n${s7['glm']}`);
});
