/**
 * 任务书第 7 节的接线（EV-95，审查侧实测措辞约束计划 r2 §3.1 ②）。
 *
 * 单测直调 `renderBrief` 并手工传 `commandExecution`，验的是渲染；这里走真实打包 CLI 子进程 + 桩（零配额），
 * 验 `prepareRun` 把**适配器的声明**递进渲染：硬编码一个取值、改按 `capability.traceShape` 推导、两侧串值，
 * 都会在第二次运行（解耦组合）里红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;

const NONE_MARK = '**你这一侧没有执行命令的能力**';
const SHELL_MARK = '你这一侧可以执行只读命令。';

/** 跑一次同步 review，返回两侧落盘任务书的第 7 节 */
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

function expect(s7: string, want: 'none' | 'readonly-shell', label: string): void {
  const [yes, no] = want === 'none' ? [NONE_MARK, SHELL_MARK] : [SHELL_MARK, NONE_MARK];
  assert.ok(s7.includes(yes), `${label}：应为 ${want} 说法\n${s7}`);
  assert.ok(!s7.includes(no), `${label}：不应出现另一种说法\n${s7}`);
}

test('桩缺省：command_trace 一侧拿到只读 shell 说法、ok 一侧拿到不能执行命令说法', { skip }, async () => {
  const s7 = await section7ByCritic('第七节接线缺省', {
    gemini: { mode: 'command_trace' },
    glm: { mode: 'ok' },
  });
  expect(s7['gemini']!, 'readonly-shell', 'gemini（command_trace）');
  expect(s7['glm']!, 'none', 'glm（ok）');
});

test('解耦组合：渲染跟适配器的 commandExecution 走，不跟轨迹形状', { skip }, async () => {
  const s7 = await section7ByCritic('第七节接线解耦', {
    gemini: { mode: 'ok', commandExecution: 'readonly-shell' },
    glm: { mode: 'command_trace', commandExecution: 'none' },
  });
  expect(s7['gemini']!, 'readonly-shell', 'gemini（tool-trace + readonly-shell）');
  expect(s7['glm']!, 'none', 'glm（command-trace + none）');
});
