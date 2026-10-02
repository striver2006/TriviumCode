/**
 * EV-188：zcode 侧 MCP 调用的计数、两档分类与判定（计划 `.reviews/MCP执行工具调用检测/plan/` r2 §3.1 U / G 两表，§7 更正）。
 *
 * 样本**照真实形态构造**：rollout 行的顶层键、`model`、`request.toolNames`、`response.toolCalls[]` 元素 `{id, name, input}`、
 * node_repl 的 `input`（`code` / `timeout_ms` / `title`）取自 run `20261001T092816Z` 的 glm 侧 rollout；日志行的顶层键
 * （含 `toolCallId`）与 `context` 七个键取自同一运行的 `tool.call.started` / `completed`。正文一律是合成内容。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  isZcodeMcp,
  isZcodeMcpExec,
  parseZcodeRollout,
  parseZcodeTrace,
  summarizeMcpInput,
  summarizeZcodeMcp,
  ZCODE_MCP_EXEC_PREFIXES,
  ZCODE_MCP_PREFIX,
  ZCODE_MCP_SUMMARY_MAX,
} from '../../src/trivium/adapters/zcode-trace.js';
import { MCP_WRITE_EVENT_PREFIX, TOOL_TRACE_CAPABILITY, type TraceCapability } from '../../src/trivium/adapters/base.js';
import { judgeRun, judgeSide, renderGuardWarnings } from '../../src/trivium/guard.js';
import { TRIVIUM_DIR, defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo, workTreeHash } from '../../src/trivium/util/git.js';
import type { CriticRequest, CriticResult } from '../../src/trivium/types.js';
import { logCall, logLine, read, repl, rolloutLine, SAMPLE_SID as SID } from '../helpers/zcode-mcp-samples.js';

const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join('');

/** 解析两份来源并合并（与 zcode.ts 组装处同一个式子） */
function merge(rollout: string | null, log: string | null) {
  const ro = rollout === null ? null : parseZcodeRollout(rollout);
  const lg = log === null ? null : parseZcodeTrace(log, SID);
  return summarizeZcodeMcp(ro?.toolCalls ?? null, lg?.mcpCalls ?? null, lg?.mcpCallIds ?? null);
}

// ─────────────────── U：判别、计数、合并 ───────────────────

test('U1 名单判别：只认 mcp__ 前缀；执行型按 server 前缀，首批只有 node_repl', () => {
  assert.equal(ZCODE_MCP_PREFIX, 'mcp__');
  assert.deepEqual([...ZCODE_MCP_EXEC_PREFIXES], ['mcp__node_repl__'], '名单逐字钉住：新增一项要有实见依据');
  const cases: [string, boolean, boolean][] = [
    ['mcp__node_repl__js', true, true],
    ['mcp__node_repl__js_reset', true, true],
    ['mcp__node_repl__js_add_node_module_dir', true, true],
    ['mcp__zread__read_file', true, false],
    ['mcp__web-search-prime__web_search_prime', true, false],
    ['Read', false, false],
    ['mcp_node_repl_js', false, false],
    ['xmcp__node_repl__js', false, false],
    ['mcp__node_replica__js', true, false],
  ];
  for (const [name, mcp, exec] of cases) {
    assert.equal(isZcodeMcp(name), mcp, `isZcodeMcp(${name})`);
    assert.equal(isZcodeMcpExec(name), exec, `isZcodeMcpExec(${name})`);
  }
});

test('U2 执行型：两边都记 2 次 ⇒ 计 2、写事件 2 条带参数摘要、无不可信', () => {
  const ro = [rolloutLine([repl('call_a', 'const x = 1;'), read('call_r', '/p/a.ts')], 0), rolloutLine([repl('call_b', 'const y = 2;')], 1)].join('\n');
  const lg = [...logCall('mcp__node_repl__js', 'call_a'), ...logCall('Read', 'call_r'), ...logCall('mcp__node_repl__js', 'call_b')].join('\n');
  const s = merge(ro, lg);
  assert.equal(s.total, 2);
  assert.deepEqual(s.byTool, { mcp__node_repl__js: 2 });
  assert.deepEqual(s.sources, { rollout: 2, log: 2 });
  assert.equal(s.execEvents.length, 2);
  for (const e of s.execEvents) assert.ok(e.startsWith(`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(`), e);
  assert.ok(s.execEvents.some((e) => e.includes('const x = 1;')));
  assert.ok(s.execEvents.some((e) => e.includes('const y = 2;')));
  assert.deepEqual(s.untrustedTools, []);
});

test('U3 名单外：计数、不进写事件、工具名去重排序', () => {
  const ro = rolloutLine([
    { id: 'c1', name: 'mcp__zread__read_file', input: { path: 'x' } },
    { id: 'c2', name: 'mcp__web-search-prime__web_search_prime', input: { q: 'a' } },
    { id: 'c3', name: 'mcp__web-search-prime__web_search_prime', input: { q: 'b' } },
  ]);
  const s = merge(ro, null);
  assert.equal(s.total, 3);
  assert.deepEqual(s.execEvents, []);
  assert.deepEqual(s.untrustedTools, ['mcp__web-search-prime__web_search_prime', 'mcp__zread__read_file']);
  assert.deepEqual(s.sources, { rollout: 3, log: null });
});

test('U4 无 MCP 调用：合并结果为零；既有解析输出与改前同形', () => {
  const ro = rolloutLine([read('call_r', '/p/a.ts'), { id: 'call_g', name: 'Grep', input: { pattern: 'x' } }]);
  const lg = [...logCall('Read', 'call_r'), ...logCall('Grep', 'call_g')].join('\n');
  const s = merge(ro, lg);
  assert.deepEqual(s, { total: 0, byTool: {}, sources: { rollout: 0, log: 0 }, execEvents: [], untrustedTools: [] });
  const t = parseZcodeTrace(lg, SID);
  // 改前（6aee012）的四类计数与写事件，逐字写死
  assert.deepEqual(t.toolCalls, { read: 1, grep: 1, glob: 0, run_command: 0 });
  assert.deepEqual(t.writeEvents, []);
  assert.deepEqual(t.mcpCalls, {});
  assert.deepEqual(t.mcpCallIds, {});
  assert.deepEqual(parseZcodeRollout(ro).writeEvents, []);
});

test('U5 rollout 没读到、日志记 2 次执行型 ⇒ 计 2、补一条「另记 2 次」', () => {
  const lg = [...logCall('mcp__node_repl__js', 'call_a'), ...logCall('mcp__node_repl__js', 'call_b')].join('\n');
  const s = merge(null, lg);
  assert.equal(s.total, 2);
  assert.deepEqual(s.sources, { rollout: null, log: 2 });
  assert.deepEqual(s.execEvents, [`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(会话日志另记 2 次，参数不可得)`]);
});

test('U6 rollout 丢行：rollout 1 次、日志 3 次 ⇒ 计 3、一条带参数 + 一条「另记 2 次」', () => {
  const ro = rolloutLine([repl('call_a', 'const a = 1;')]);
  const lg = ['call_a', 'call_b', 'call_c'].flatMap((id) => logCall('mcp__node_repl__js', id)).join('\n');
  const s = merge(ro, lg);
  assert.equal(s.total, 3);
  assert.equal(s.execEvents.length, 2);
  assert.ok(s.execEvents[0]!.includes('const a = 1;'));
  assert.equal(s.execEvents[1], `${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(会话日志另记 2 次，参数不可得)`);
});

test('U7 日志按名取大：只有终态没有 started、只有 started 没有终态，各计 1', () => {
  const onlyEnd = parseZcodeTrace(logLine('tool.call.completed', 'mcp__node_repl__js', null), SID);
  assert.deepEqual(onlyEnd.mcpCalls, { mcp__node_repl__js: 1 });
  const onlyStart = parseZcodeTrace(logLine('tool.call.started', 'mcp__node_repl__js', null), SID);
  assert.deepEqual(onlyStart.mcpCalls, { mcp__node_repl__js: 1 });
  const failed = parseZcodeTrace([logLine('tool.call.started', 'mcp__zread__read_file', 'c1'), logLine('tool.call.failed', 'mcp__zread__read_file', 'c1')].join('\n'), SID);
  assert.deepEqual(failed.mcpCalls, { mcp__zread__read_file: 1 }, '失败的调用也计：计的是尝试');
});

test('U8 参数摘要：先脱敏再截断、折叠空白、不超长', () => {
  const secret = `sk-${FAKE_CRED}`;
  const code = `const k = "${secret}";\n${'x'.repeat(300)}`;
  const s = summarizeMcpInput({ code });
  assert.ok(!s.includes(FAKE_CRED), '凭据原文不得进写事件');
  assert.ok(s.length <= ZCODE_MCP_SUMMARY_MAX);
  assert.ok(!/[\n\r\t]/.test(s));
  // 凭据落在截断边界上时也要先抹掉：把它放到第 110 字附近
  const edge = summarizeMcpInput({ code: `${'y'.repeat(100)}${secret}` });
  assert.ok(!edge.includes(FAKE_CRED.slice(0, 12)), '截断在前会留下半截凭据');
});

test('U9 既有四类计数不受 MCP 事件影响', () => {
  const base = [...logCall('Read', 'r1'), ...logCall('Glob', 'g1')];
  const a = parseZcodeTrace(base.join('\n'), SID);
  const b = parseZcodeTrace([...base, ...logCall('mcp__node_repl__js', 'm1'), ...logCall('mcp__zread__read_file', 'm2')].join('\n'), SID);
  assert.deepEqual(b.toolCalls, a.toolCalls);
  assert.deepEqual(b.writeEvents, a.writeEvents, '日志侧不往写事件里放 MCP：执行型的写事件统一由合并函数产出');
});

test('U10 rollout 没读到、日志只有名单外 MCP ⇒ 点名、计数，不进写事件（AGY-02）', () => {
  const lg = [...logCall('mcp__zread__read_file', 'c1'), ...logCall('mcp__zread__read_file', 'c2')].join('\n');
  const s = merge(null, lg);
  assert.equal(s.total, 2);
  assert.deepEqual(s.untrustedTools, ['mcp__zread__read_file']);
  assert.deepEqual(s.execEvents, []);
});

test('U11 两边各有一个名单外工具 ⇒ 两个都点名（AGY-02）', () => {
  const ro = rolloutLine([{ id: 'c1', name: 'mcp__zread__read_file', input: {} }]);
  const lg = [...logCall('mcp__zread__read_file', 'c1'), ...logCall('mcp__zread__search_doc', 'c2')].join('\n');
  const s = merge(ro, lg);
  assert.deepEqual(s.untrustedTools, ['mcp__zread__read_file', 'mcp__zread__search_doc']);
  assert.equal(s.total, 2);
});

test('U13 写事件带调用 id：参数前缀相同的多次调用不被去重成一条', () => {
  const same = 'x'.repeat(200);
  const ro = rolloutLine([repl('call_a', `${same}A`), repl('call_b', `${same}B`)]);
  const s = merge(ro, null);
  assert.equal(s.execEvents.length, 2, '两次调用两条，留痕条数等于调用次数');
  assert.ok(s.execEvents[0]!.startsWith(`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(call_a {`), s.execEvents[0]);
  assert.ok(s.execEvents[1]!.startsWith(`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(call_b {`), s.execEvents[1]);
});

test('U14 rollout 条目缺 id、日志带同批 id ⇒ 该名退回按名取大，不翻倍、不多造「另记」（代码双审 GLM-01）', () => {
  const ro = rolloutLine([repl('', 'a'), repl('', 'b')]);
  const lg = [...logCall('mcp__node_repl__js', 'call_a'), ...logCall('mcp__node_repl__js', 'call_b')].join('\n');
  const s = merge(ro, lg);
  assert.equal(s.total, 2, '同一批两次调用，不是四次');
  assert.equal(s.execEvents.length, 2);
  assert.equal(s.execEvents.some((e) => e.includes('另记')), false);
  // 只是该名退回：别的名字照常按 id 求并集
  const mixed = merge(
    rolloutLine([repl('', 'a'), { id: 'z1', name: 'mcp__zread__read_file', input: {} }]),
    [...logCall('mcp__node_repl__js', 'call_a'), ...logCall('mcp__zread__read_file', 'z1'), ...logCall('mcp__zread__read_file', 'z2')].join('\n'),
  );
  assert.deepEqual(mixed.byTool, { mcp__node_repl__js: 1, mcp__zread__read_file: 2 });
});

test('U12 按调用 id 求并集：两边各丢不同的调用也不少计（计划 r2 §7 更正）', () => {
  // rollout 有 a、b；日志有 b、c——按名取大只得 2，真实是 3
  const ro = rolloutLine([repl('call_a', 'a'), repl('call_b', 'b')]);
  const lg = [...logCall('mcp__node_repl__js', 'call_b'), ...logCall('mcp__node_repl__js', 'call_c')].join('\n');
  const s = merge(ro, lg);
  assert.equal(s.total, 3);
  assert.equal(s.execEvents.length, 3, '两条带参数 + 一条「另记 1 次」');
  assert.equal(s.execEvents[2], `${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(会话日志另记 1 次，参数不可得)`);
  // 日志行的 id 在顶层：解析出来的 id 映射要对得上
  assert.deepEqual(parseZcodeTrace(lg, SID).mcpCallIds, { call_b: 'mcp__node_repl__js', call_c: 'mcp__node_repl__js' });
});

// ─────────────────── G：判定 ───────────────────

const cfg = defaultConfig();
const ROOT = '/proj';
const REQ = {
  critic: 'glm', stage: 'plan', model: 'm', timeout_s: 60, min_tool_calls: 5, min_project_reads: 3,
  subject_path: `${ROOT}/.reviews/t/plan/2026-10-02-t-claude.md`, brief_path: `${ROOT}/brief.md`,
  project_root: ROOT, deny_paths: [], out_dir: '/runs/out', brief_text: '',
} as unknown as CriticRequest;

function result(over: Partial<CriticResult> = {}): CriticResult {
  return {
    critic: 'glm', status: 'ok', exit_code: 0, duration_s: 1, raw_stdout_path: '', trace_path: 't', review_json: null,
    raw_response_text: null, model_effective: 'm', model_effective_source: 'trace', model_provider: null, profile_requested: null,
    tool_calls: { read: 6, grep: 1, glob: 0, run_command: 0 },
    read_paths: [`${ROOT}/src/a.ts`, `${ROOT}/src/b.ts`, `${ROOT}/src/c.ts`],
    search_hit_paths: null, path_bearing_reads: 3, path_bearing_reads_with_path: 3,
    write_events: [], command_texts: [], evidence_ok: false, fail_reason: null, session_id: null, cli_version: null,
    peer_deny_applied: false, deny_skipped: 0, deny_rule_count: 0, deny_bytes: 0, command_line: '',
    ...over,
  };
}

const sideOpts = {
  archiveRootAbs: `${ROOT}/.reviews`, projectRoot: ROOT, triviumDir: `${ROOT}/${TRIVIUM_DIR}`, runRoot: '/runs', degraded: [],
};

const EXEC_EVENT = `${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js({"code":"17*23"})`;

test('G1 执行型写事件 ⇒ 只读失守；告警有失守段与 MCP 补句', async () => {
  const s = judgeSide(cfg, 'glm', result({ write_events: [EXEC_EVENT] }), null, REQ, sideOpts);
  assert.equal(s.readonlyBreach, true);
  assert.deepEqual(s.breachEvidence, [EXEC_EVENT]);
  assert.equal(s.verification.untrusted, undefined);
  const w = renderGuardWarnings({
    sides: { glm: s }, drift: { kind: 'none' } as never, driftAction: 'ok', fingerprintChangedFiles: [], unattributedDriftFiles: [],
    readonlyBreach: true, breachedFiles: [EXEC_EVENT], peerArtifactRead: false,
  });
  assert.ok(w[0]!.startsWith('只读失守：'));
  assert.ok(w[0]!.includes(EXEC_EVENT));
  assert.ok(w.some((l) => l.includes('`MCP:` 开头的是 MCP 执行型工具调用')));
});

test('G2 名单外 ⇒ 证据不可信：不失守、不动禁读与证据判定，告警点名', () => {
  const base = judgeSide(cfg, 'glm', result(), null, REQ, sideOpts);
  const s = judgeSide(cfg, 'glm', result({ mcp_untrusted_tools: ['mcp__zread__read_file'] }), null, REQ, sideOpts);
  assert.equal(s.readonlyBreach, false);
  assert.equal(s.peerArtifactRead, base.peerArtifactRead);
  assert.equal(s.evidenceOk, base.evidenceOk);
  assert.deepEqual(s.evidenceReasons, base.evidenceReasons);
  assert.deepEqual(s.verification.untrusted, { cause: 'mcp-call', tools: ['mcp__zread__read_file'] });
  const w = renderGuardWarnings({
    sides: { glm: s }, drift: { kind: 'none' } as never, driftAction: 'ok', fingerprintChangedFiles: [], unattributedDriftFiles: [],
    readonlyBreach: false, breachedFiles: [], peerArtifactRead: false,
  });
  const line = w.find((l) => l.startsWith('glm 侧证据不可信（MCP 调用）'));
  assert.ok(line, JSON.stringify(w));
  assert.ok(line!.includes('mcp__zread__read_file'));
  assert.ok(line!.includes('结论保留、不作废'));
});

test('G3 两档同时成立、互不覆盖', () => {
  const s = judgeSide(cfg, 'glm', result({ write_events: [EXEC_EVENT], mcp_untrusted_tools: ['mcp__zread__read_file'] }), null, REQ, sideOpts);
  assert.equal(s.readonlyBreach, true);
  assert.deepEqual(s.verification.untrusted, { cause: 'mcp-call', tools: ['mcp__zread__read_file'] });
});

test('G4 都没有 ⇒ verification 上没有 untrusted 这个键（结构上缺席）', () => {
  const s = judgeSide(cfg, 'glm', result(), null, REQ, sideOpts);
  assert.equal('untrusted' in s.verification, false);
  const s2 = judgeSide(cfg, 'glm', result({ mcp_untrusted_tools: [] }), null, REQ, sideOpts);
  assert.equal('untrusted' in s2.verification, false, '空数组也不成立');
});

// ── 漂移归因：G5～G8 都要真实 git 夹具（judgeRun 跑 judgeDrift） ──

const COMMAND_TRACE: TraceCapability = { traceShape: 'command-trace', rejectionRecorded: false };

async function driftRun(opts: {
  results: Partial<Record<'gemini' | 'glm', CriticResult>>;
  capabilities: Partial<Record<'gemini' | 'glm', TraceCapability>>;
}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev188-')));
  await fs.writeFile(path.join(dir, 'subject.ts'), 'export const s = 1;\n');
  await fs.writeFile(path.join(dir, 'b.ts'), 'export const b = 1;\n');
  await initFixtureRepo(dir);
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'b.ts'), 'export const b = 2;\n');
  const after = await workTreeHash(dir);
  const req = (critic: string) => ({
    run_id: 'R', topic: 't', stage: 'plan', critic, project_root: dir, subject_path: path.join(dir, 'subject.ts'), deny_paths: [],
    out_dir: '/x', brief_path: '/b', brief_text: 'B', model: 'M', timeout_s: 900, schema_path: '/s', min_tool_calls: 5, min_project_reads: 3,
  }) as unknown as CriticRequest;
  try {
    return await judgeRun({
      cfg, degraded: {}, projectRoot: dir, archiveRootAbs: path.join(dir, '.reviews'), archiveRootRel: '.reviews',
      before: { gitHead: null, treeHash: before, dirty: false, subjectSha256: 'S', subjectPath: path.join(dir, 'subject.ts'), denyPaths: [], diffText: null, takenAt: 'now' },
      afterTreeHash: after, afterSubjectSha256: 'S', relatedPaths: [],
      results: opts.results,
      reviews: Object.fromEntries(Object.keys(opts.results).map((k) => [k, null])),
      requests: Object.fromEntries(Object.keys(opts.results).map((k) => [k, req(k)])),
      capabilities: opts.capabilities,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('G5 MCP: 条目不参与归因扣除：括号里恰好是漂移文件的路径也不扣（GLM-01 的可杀构造）', async () => {
  const v = await driftRun({
    // 合成条目：括号里是本轮漂移文件的相对路径，不经适配器——防的是将来摘要形态变了、恰好像路径
    results: { glm: result({ write_events: [`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js(b.ts)`] }), gemini: result({ critic: 'gemini' }) },
    capabilities: { glm: TOOL_TRACE_CAPABILITY, gemini: COMMAND_TRACE },
  });
  assert.ok(v.unattributedDriftFiles.includes('b.ts'), `MCP 条目没有写入证据，不能把文件扣出「无法归因」桶：${JSON.stringify(v.unattributedDriftFiles)}`);
});

test('G6 证据不可信参与归因：漂移落进「无法归因」、不记开发者手改（AGY-01）', async () => {
  const v = await driftRun({
    results: { glm: result({ mcp_untrusted_tools: ['mcp__zread__read_file'] }) },
    capabilities: { glm: TOOL_TRACE_CAPABILITY },
  });
  assert.deepEqual(v.fingerprintChangedFiles, []);
  assert.deepEqual(v.unattributedDriftFiles, ['b.ts']);
  assert.deepEqual(v.unattributedCauses, ['evidence-untrusted']);
  const w = renderGuardWarnings(v).find((l) => l.includes('**无法归因**'));
  assert.ok(w && w.includes('有侧证据不可信'), w);
});

test('G7 无不可信侧、能力都可用 ⇒ 归因与改前相同（开发者手改）', async () => {
  const v = await driftRun({ results: { glm: result() }, capabilities: { glm: TOOL_TRACE_CAPABILITY } });
  assert.deepEqual(v.fingerprintChangedFiles, ['b.ts']);
  assert.deepEqual(v.unattributedDriftFiles, []);
  assert.equal('unattributedCauses' in v, false);
});

test('G8 MCP 执行型调用参与归因：写事件里没有路径，漂移不得记成开发者手改（计划 r2 §7 偏离 2）', async () => {
  const v = await driftRun({
    results: { glm: result({ write_events: [`${MCP_WRITE_EVENT_PREFIX}mcp__node_repl__js({"code":"x"})`] }) },
    capabilities: { glm: TOOL_TRACE_CAPABILITY },
  });
  assert.equal(v.readonlyBreach, true);
  assert.deepEqual(v.fingerprintChangedFiles, []);
  assert.deepEqual(v.unattributedDriftFiles, ['b.ts']);
  assert.deepEqual(v.unattributedCauses, ['mcp-exec']);
});

test('G9 只有能力恒态这一种成因时，「无法归因」文案与改前逐字相同', async () => {
  const v = await driftRun({ results: { gemini: result({ critic: 'gemini' }) }, capabilities: { gemini: COMMAND_TRACE } });
  assert.deepEqual(v.unattributedCauses, ['readonly-unavailable']);
  const w = renderGuardWarnings(v).find((l) => l.includes('**无法归因**'));
  assert.equal(
    w,
    '审查期间有文件变更，但本轮有侧的只读核验不可用，**无法归因**：\n    b.ts\n' +
      '  既不能判为审查员失守（无正向证据），也不能判为开发者手改（该侧被拒的写不留痕，无写事件排除不了审查员写过）。请人工核对。',
  );
});
