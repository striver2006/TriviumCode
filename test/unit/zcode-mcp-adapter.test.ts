/**
 * EV-188 适配器级用例（计划 `.reviews/MCP执行工具调用检测/plan/` r2 §3.1 A）：假 `zcode.cjs` 按 0.16.9 取值链把
 * 照真实形态构造的会话日志与 rollout 落进运行目录，`zcodeAdapter.run` 组装结果，再经 `judgeRun` → `renderGuardWarnings`。
 *
 * 三种样本（`test/helpers/zcode-mcp-samples.ts` 的 `roundSample`）：执行型 ⇒ 写事件点名、判只读失守；名单外 ⇒ 记证据不可信、不失守；
 * 无 MCP ⇒ `tool_calls` / `write_events` / `trace.json` 与改前同形（无 `mcp` 键、无 `mcpCalls`）。
 * 测试进程的 `HOME` 钉到临时用户目录（与 zcode-carriers 同一惯例），所有写入只落 mkdtemp。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { zcodeAdapter } from '../../src/trivium/adapters/zcode.js';
import { MCP_WRITE_EVENT_PREFIX } from '../../src/trivium/adapters/base.js';
import { judgeRun, renderGuardWarnings } from '../../src/trivium/guard.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo, workTreeHash } from '../../src/trivium/util/git.js';
import type { CriticRequest, CriticResult } from '../../src/trivium/types.js';
import { roundSample, SAMPLE_SID } from '../helpers/zcode-mcp-samples.js';

/** 假入口：把 FAKE_SAMPLE_DIR 下的 log.jsonl / rollout.jsonl 拷到 CLI 的日志目录与存储根，再吐 envelope */
const SAMPLE_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env, sid = ${JSON.stringify(SAMPLE_SID)};
const homeZ = path.join(env.HOME, '.zcode');
const logDir = env.ZCODE_LOG_DIR || path.join(homeZ, 'cli', 'log');
const storage = env.ZCODE_STORAGE_DIR || homeZ;
const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const src = env.FAKE_SAMPLE_DIR;
put(path.join(logDir, 'zcode-2026-10-01.jsonl'), fs.readFileSync(path.join(src, 'log.jsonl'), 'utf8'));
put(path.join(storage, 'cli', 'rollout', 'model-io-' + sid + '.jsonl'), fs.readFileSync(path.join(src, 'rollout.jsonl'), 'utf8'));
process.stdout.write(JSON.stringify({ sessionId: sid, response: '{}', usage: {}, eventCount: 1 }) + '\\n');
process.exit(0);
`;

const made: string[] = [];
const tmp = async (p: string) => {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), p)));
  made.push(d);
  return d;
};

async function runSample(kind: 'exec' | 'untrusted' | 'none') {
  const root = await tmp('trivium-ev188-proj-');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(root, 'src/b.ts'), 'export const b = 1;\n');
  await fs.writeFile(path.join(root, 'README.md'), '# x\n');
  await fs.writeFile(path.join(root, 's.md'), '# 原稿\n');
  await initFixtureRepo(root);
  const before = await workTreeHash(root);

  const app = await tmp('trivium-ev188-app-');
  const entry = path.join(app, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, SAMPLE_ENTRY, 'utf8');
  await fs.mkdir(path.join(app, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(app, 'Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');

  const samples = await tmp('trivium-ev188-sample-');
  const s = roundSample(kind, root);
  await fs.writeFile(path.join(samples, 'log.jsonl'), s.log);
  await fs.writeFile(path.join(samples, 'rollout.jsonl'), s.rollout);

  const userHome = await tmp('trivium-ev188-home-');
  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.agents.glm = { vendor: 'zcode', entry };
  cfg.probe.cli.zcode!.entrypoint = await fs.realpath(entry);
  cfg.probe.cli.zcode!.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit,Bash'];
  cfg.probe.cli.zcode!.response_field = 'response';
  const runDir = await tmp('trivium-ev188-run-');
  const sideDir = path.join(runDir, 'glm');
  const req = {
    run_id: 'r', topic: 't', stage: 'plan' as const, critic: 'glm' as const,
    project_root: root, subject_path: path.join(root, 's.md'), deny_paths: [],
    out_dir: path.join(sideDir, 'out'), brief_path: path.join(root, 'b.md'), brief_text: 'ok',
    model: null, timeout_s: 20, schema_path: path.join(root, 'schema.json'),
    min_tool_calls: 0, min_project_reads: 0, profile_requested: null,
  };
  const saved = { HOME: process.env['HOME'], FAKE_SAMPLE_DIR: process.env['FAKE_SAMPLE_DIR'] };
  process.env['HOME'] = userHome;
  process.env['FAKE_SAMPLE_DIR'] = samples;
  let result: CriticResult;
  try {
    result = await zcodeAdapter.run({ cfg, nodePath: process.execPath }, req as never);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const verdict = await judgeRun({
    cfg, degraded: {}, projectRoot: root, archiveRootAbs: path.join(root, '.reviews'), archiveRootRel: '.reviews',
    before: { gitHead: null, treeHash: before, dirty: false, subjectSha256: 'S', subjectPath: req.subject_path, denyPaths: [], diffText: null, takenAt: 'now' },
    afterTreeHash: await workTreeHash(root), afterSubjectSha256: 'S', relatedPaths: [],
    results: { glm: result }, reviews: { glm: null }, requests: { glm: req as unknown as CriticRequest },
    capabilities: { glm: zcodeAdapter.capability },
  });
  const trace = JSON.parse(await fs.readFile(result.trace_path!, 'utf8')) as Record<string, unknown>;
  return { result, verdict, warnings: renderGuardWarnings(verdict), trace };
}

test.after(async () => {
  for (const d of made) await fs.rm(d, { recursive: true, force: true });
});

test('A1 执行型样本：计数、写事件点名 node_repl、判只读失守、trace.json 有明细', async () => {
  const { result, verdict, warnings, trace } = await runSample('exec');
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.deepEqual(result.tool_calls, { read: 3, grep: 0, glob: 0, run_command: 0, mcp: 1 });
  assert.equal(result.write_events.length, 1);
  assert.ok(result.write_events[0]!.startsWith(`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(`), result.write_events[0]);
  assert.ok(result.write_events[0]!.includes('17 * 23'));
  assert.equal('mcp_untrusted_tools' in result, false);
  assert.equal(verdict.readonlyBreach, true);
  assert.deepEqual(verdict.breachedFiles, result.write_events);
  assert.ok(warnings[0]!.startsWith('只读失守：'));
  assert.ok(warnings.some((w) => w.includes('`MCP:` 开头的是 MCP 执行型工具调用')));
  assert.deepEqual(trace['mcpCalls'], { total: 1, byTool: { mcp__node_repl__js: 1 }, sources: { rollout: 1, log: 1 } });
  assert.deepEqual(trace['writeEvents'], result.write_events);
});

test('A2 名单外样本：计数、点名、记证据不可信、不失守', async () => {
  const { result, verdict, warnings, trace } = await runSample('untrusted');
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.deepEqual(result.tool_calls, { read: 3, grep: 0, glob: 0, run_command: 0, mcp: 1 });
  assert.deepEqual(result.write_events, []);
  assert.deepEqual(result.mcp_untrusted_tools, ['mcp__zread__read_file']);
  assert.equal(verdict.readonlyBreach, false);
  assert.deepEqual(verdict.sides.glm!.verification.untrusted, { cause: 'mcp-call', tools: ['mcp__zread__read_file'] });
  assert.ok(warnings.some((w) => w.startsWith('glm 侧证据不可信（MCP 调用）') && w.includes('mcp__zread__read_file')), warnings.join('\n'));
  assert.equal(warnings.some((w) => w.startsWith('只读失守')), false);
  assert.deepEqual(trace['mcpCalls'], { total: 1, byTool: { mcp__zread__read_file: 1 }, sources: { rollout: 1, log: 1 } });
});

test('A3 无 MCP 样本：tool_calls / write_events / trace.json 与改前同形，判定无事', async () => {
  const { result, verdict, warnings, trace } = await runSample('none');
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.deepEqual(result.tool_calls, { read: 3, grep: 0, glob: 0, run_command: 0 }, '不得出现 mcp 键');
  assert.deepEqual(result.write_events, []);
  assert.equal('mcp_untrusted_tools' in result, false);
  assert.equal('mcpCalls' in trace, false);
  assert.deepEqual(Object.keys(trace), ['toolCalls', 'readPaths', 'writeEvents', 'sessionId', 'modelSelection', 'carriersLanded'], '键集与改前相同');
  assert.equal(verdict.readonlyBreach, false);
  assert.equal('untrusted' in verdict.sides.glm!.verification, false);
  assert.equal(warnings.some((w) => w.includes('MCP')), false);
});
