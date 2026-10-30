/**
 * `trivium hooks --agent <id>` 与 `trivium init` 的 Hook 多目标（M10b 第 3 步，r5 §6.1、r10 §3.1.2 / §3.2）。
 *
 * 走真实打包 CLI：命令分派、旗标解析、退出码与 `--json` 输出只有子进程这一层能证明接上了。
 * 家的取法经注册表（`hookConfigTarget.format`），不写死哪家是哪种形态。零配额：不拉起任何 Agent。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { AGENTS } from '../../src/trivium/agents/registry.js';
import { hookNamesOf } from '../../src/trivium/hook-config.js';

const skip = { skip: bundleMissing && bundleSkipReason };
const ZCODE_FMT = AGENTS.find((a) => a.hookConfigTarget?.format === 'zcode-config')!;
const CLAUDE_FMT = AGENTS.find((a) => a.hookConfigTarget?.format === 'claude-settings')!;
const NO_HOOK = AGENTS.find((a) => a.hookConfigTarget === null)!;

function json(stdout: string): Record<string, unknown> {
  const c = extractJsonCandidate(stdout);
  assert.ok(c, `输出里没有 JSON：${stdout}`);
  return JSON.parse(c.json) as Record<string, unknown>;
}

test('hooks --agent <ZCode 形态的家>：只写该家的配置，不碰 Claude 的', skip, async () => {
  const { root } = await makeFixture({ topic: 'T', draft: false });
  const r = await cli(root, ['hooks', '--agent', ZCODE_FMT.id, '--json']);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const out = json(r.stdout);
  assert.equal(out['agent'], ZCODE_FMT.id);
  const zp = path.join(root, ZCODE_FMT.hookConfigTarget!.path);
  const cfg = JSON.parse(await fs.readFile(zp, 'utf8')) as { hooks: { enabled: boolean; events: Record<string, unknown[]> } };
  assert.equal(cfg.hooks.enabled, true);
  const names = Object.values(cfg.hooks.events).flat().flatMap((e) => [...hookNamesOf(e)]);
  assert.ok(names.includes('pre-write') && names.includes('pre-bash'), names.join('、'));
  await assert.rejects(fs.access(path.join(root, CLAUDE_FMT.hookConfigTarget!.path)), '只合并指定的一家');
  assert.ok((out['notes'] as string[]).some((n) => /重新信任/.test(n)), '写入 ZCode 配置后必须提示重新信任');
});

test('hooks：没有 Hook 机制的家 ⇒ 退 64 并说明 L2；缺 --agent、未登记的 id ⇒ 退 64', skip, async () => {
  const { root } = await makeFixture({ topic: 'T', draft: false });
  const none = await cli(root, ['hooks', '--agent', NO_HOOK.id]);
  assert.equal(none.code, EXIT.USAGE, none.stdout + none.stderr);
  assert.match(none.stdout + none.stderr, /没有 Hook 机制/);
  const missing = await cli(root, ['hooks']);
  assert.equal(missing.code, EXIT.USAGE);
  assert.match(missing.stdout + missing.stderr, new RegExp(ZCODE_FMT.id), '报错要列出能渲染的家');
  const unknown = await cli(root, ['hooks', '--agent', 'nosuch']);
  assert.equal(unknown.code, EXIT.USAGE);
  for (const f of [ZCODE_FMT, CLAUDE_FMT]) {
    await assert.rejects(fs.access(path.join(root, f.hookConfigTarget!.path)), '拒绝时零写入');
  }
});

test('hooks --dry-run：报告会写什么，但一个文件都不落', skip, async () => {
  const { root } = await makeFixture({ topic: 'T', draft: false });
  const r = await cli(root, ['hooks', '--agent', ZCODE_FMT.id, '--dry-run', '--json']);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  const out = json(r.stdout);
  assert.deepEqual(out['created'], [path.join(root, ZCODE_FMT.hookConfigTarget!.path)]);
  // 连目录也不建，notes 不说「已写入」（代码双审 r3 CODEX-04）
  await assert.rejects(fs.access(path.dirname(path.join(root, ZCODE_FMT.hookConfigTarget!.path))));
  assert.ok(!(out['notes'] as string[]).some((n) => /已写入|已备份/.test(n)), JSON.stringify(out['notes']));
});

test('init：两家的 Hook 配置一起合并（r5 §6.1「trivium init 同时合并两家」）', skip, async () => {
  const { root } = await makeFixture({ topic: 'T', draft: false });
  const r = await cli(root, ['init', '--json']);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  for (const a of AGENTS.filter((x) => x.hookConfigTarget)) {
    const p = path.join(root, a.hookConfigTarget!.path);
    // Trivium 条目按 gate 身份认（hookNamesOf，对整份配置的 JSON 全文）：Windows 形态的 gate 名在
    // EncodedCommand 体内、明文不含；claude 形态挂在 hooks.<事件>[]、zcode 形态挂在 hooks.events.<事件>[]
    const merged = JSON.parse(await fs.readFile(p, 'utf8')) as unknown;
    const names = hookNamesOf(merged);
    assert.ok(names.has('pre-write'), `${a.id} 的 ${a.hookConfigTarget!.path} 没有合并进 Hook（识别到的 gate：${[...names].join('、') || '无'}）`);
  }
});
