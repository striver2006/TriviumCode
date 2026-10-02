import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

/**
 * EV-188 集成用例（计划 `.reviews/MCP执行工具调用检测/plan/` r2 §3.1 I）：桩注入 MCP 两档，走真实打包 CLI 的
 * `review --start` → `--wait` 全链路，咬住两档各自的留痕面——
 *   - 名单外（证据不可信）：run.json `verification_degraded.glm.evidence_untrusted`、`tool_calls.mcp`、front-matter 条件键、
 *     文档横幅、终态播报、报告旗标；`gate --check` **不**出 `readonly_breach`；
 *   - 执行型（只读失守）：run.json `readonly_breach` 与 `breached_files` 的 `MCP:` 条目、终态播报的 MCP 补句、报告 `只读失守`、
 *     `gate --check` 出 `readonly_breach` failure。
 * run.json 落盘前过 run.v2 校验，新键的 schema 也在这条链上。
 */

const TOPIC = 'MCP检测';

async function codeFixture() {
  const fx = await makeFixture({ topic: TOPIC, draft: false });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
  return { ...fx, codeDir };
}

async function runCode(root: string, codeDir: string, stub: StubConfig) {
  const started = await cli(root, ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', '看变更', '--json'], stub);
  assert.equal(started.code, EXIT.OK, `--start 失败：\n${started.stdout}\n${started.stderr}`);
  const js = JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string };
  let exitCode: number = EXIT.STILL_RUNNING;
  let out = started.stdout;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '20'], stub, 60_000);
    exitCode = w.code ?? EXIT.FAIL;
    out += w.stdout + w.stderr;
  }
  const meta = JSON.parse(await fs.readFile(path.join(codeDir, '_meta', `run-${js.run_id}.json`), 'utf8')) as RunMeta;
  const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '5', '--json'], stub, 60_000);
  const message = (JSON.parse(extractJsonCandidate(w.stdout)!.json) as { message?: string | null }).message ?? '';
  const glmDoc = (await fs.readdir(codeDir)).find((n) => n.endsWith('-glm.md'));
  assert.ok(glmDoc, '要有 glm 侧审查文档');
  const doc = await fs.readFile(path.join(codeDir, glmDoc!), 'utf8');
  const fm = YAML.parse(doc.split('---')[1]!) as Record<string, unknown>;
  /*
   * 闸门前先落一份把桩意见全部裁决掉的应答件：缺件时 missing_disposition 早退、走不到 readonly_breach 那一格
   * （与 fault-injection 的同名用例同一手法）。
   */
  const metaDir = path.join(codeDir, '_meta');
  const rows: string[] = [];
  const addresses: string[] = [];
  for (const f of await fs.readdir(metaDir)) {
    const m = /^review-(gemini|glm)-.*\.json$/.exec(f);
    if (!m) continue;
    const rv = JSON.parse(await fs.readFile(path.join(metaDir, f), 'utf8')) as { findings?: { id: string }[] };
    for (const x of rv.findings ?? []) rows.push(`| ${x.id} | ${m[1]} | minor | 接受 | 用例只为走到闸门，逐条接受 | §1 |`);
  }
  for (const n of (await fs.readdir(codeDir)).filter((n) => /-(gemini|glm)\.md$/.test(n)).sort()) addresses.push(`  - ${n}`);
  const date = glmDoc!.slice(0, 10);
  await fs.writeFile(
    path.join(codeDir, `${date}-${TOPIC}-response-claude.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: code', 'role: claude', 'kind: response',
      `run_id: ${meta.run_id}`, 'addresses:', ...addresses, '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ...rows, '',
    ].join('\n'),
    'utf8',
  );
  const gate = await cli(root, ['gate', '--stage', 'code', '--topic', TOPIC, '--check', '--json'], stub);
  const gateJs = JSON.parse(extractJsonCandidate(gate.stdout)!.json) as { failures: { code: string; message: string }[] };
  const rep = await cli(root, ['report', '--topic', TOPIC, '--json'], stub);
  return { exitCode, meta, out, message, doc, fm, gate: gateJs, report: rep.stdout };
}

test('名单外 MCP 调用 ⇒ 证据不可信走五面、不失守、不进闸门（EV-188 I1）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  const r = await runCode(fx.root, fx.codeDir, { gemini: { mode: 'ok' }, glm: { mode: 'ok', mcpUntrustedTools: ['mcp__zread__read_file'] } });
  assert.equal(r.exitCode, EXIT.OK, r.out.slice(-600));
  // run.json
  assert.equal(r.meta.guard.readonly_breach, false);
  assert.deepEqual(r.meta.guard.verification_degraded?.glm?.evidence_untrusted, { cause: 'mcp-call', tools: ['mcp__zread__read_file'] });
  assert.equal('evidence_untrusted' in (r.meta.guard.verification_degraded?.gemini ?? {}), false, '没注入的一侧缺席');
  assert.equal(r.meta.critics.glm?.tool_calls.mcp, 1);
  assert.equal('mcp' in (r.meta.critics.gemini?.tool_calls ?? {}), false);
  // front-matter 与横幅
  assert.deepEqual(r.fm['evidence_untrusted'], { cause: 'mcp-call', tools: ['mcp__zread__read_file'] });
  assert.ok(r.doc.includes('**证据不可信（MCP 调用）**'), '横幅');
  // 运行时播报
  assert.ok(r.message.includes('glm 侧证据不可信（MCP 调用）'), `终态播报要点名，实得：${r.message || '(空)'}`);
  // 闸门不挡、报告看得见
  assert.deepEqual(r.gate.failures, [], '应答件齐备、不可信不进闸门：一条失败都不该有');
  assert.ok(r.report.includes('glm 侧证据不可信（MCP 调用：mcp__zread__read_file'), r.report.slice(0, 2000));
});

test('MCP 执行型调用 ⇒ 只读失守的既有各面、写事件一眼看出 MCP 通道（EV-188 I2）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  const r = await runCode(fx.root, fx.codeDir, { gemini: { mode: 'ok' }, glm: { mode: 'ok', mcpExecCalls: 1 } });
  assert.equal(r.meta.guard.readonly_breach, true);
  assert.deepEqual(r.meta.guard.breached_files, ['MCP:mcp__node_repl__js({"code":"stub 1"})']);
  assert.equal('evidence_untrusted' in (r.meta.guard.verification_degraded?.glm ?? {}), false, '执行型不走证据不可信那一档');
  assert.equal(r.meta.critics.glm?.tool_calls.mcp, 1);
  assert.ok(r.message.includes('只读失守'), `终态播报，实得：${r.message || '(空)'}`);
  assert.ok(r.message.includes('`MCP:` 开头的是 MCP 执行型工具调用'), 'MCP 补句');
  const f = r.gate.failures.find((x) => x.code === 'readonly_breach');
  assert.ok(f, JSON.stringify(r.gate.failures));
  assert.doesNotMatch(r.gate.failures.map((x) => x.code).join(','), /missing_disposition/, '失败要来自失守本身');
  assert.ok(f!.message.includes('MCP:mcp__node_repl__js('), '闸门消息里的调用记录点名该工具');
  assert.ok(r.report.includes('只读失守'));
  assert.equal('evidence_untrusted' in r.fm, false);
});
