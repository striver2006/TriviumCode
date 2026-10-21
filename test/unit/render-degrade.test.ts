/**
 * 逐条降级、无损修复与回退成因在审查文档上的表达（设计 §6.5；计划 r2 §3.5、§5.1 R 组）。
 * 名字带〔回归〕的格在改前构建上也必须绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewDoc, parseFrontMatter, type RenderInput } from '../../src/trivium/render.js';
import { CRITICS, type CriticResult, type DegradedFinding, type Review } from '../../src/trivium/types.js';

const RESULT: CriticResult = {
  critic: 'codex', status: 'ok', exit_code: 0, duration_s: 10,
  raw_stdout_path: '/o', trace_path: '/t', review_json: null, raw_response_text: '{}',
  model_effective: 'qwen3.8-flash', model_effective_source: 'trace', model_provider: null, profile_requested: null,
  tool_calls: { run_command: 9 }, read_paths: [], search_hit_paths: null, write_events: [], command_texts: [],
  evidence_ok: true, fail_reason: null, session_id: null, cli_version: '0.159.2', peer_deny_applied: false,
  deny_skipped: 0, deny_rule_count: 0, deny_bytes: 0, command_line: 'codex exec',
};

const REVIEW: Review = {
  schema: 'trivium.review.v2', verdict: 'approve-after-changes', summary: '最危险的一条在前。',
  findings: [{
    id: 'CODEX-01', severity: 'major', layer: 'code', kind: 'correctness', location: 'src/a.ts:1',
    problem: '合格意见', evidence: '读了 src/a.ts', suggestion: '改', confidence: 'high',
  }],
  not_covered: ['前端'], consulted: ['src/a.ts'],
};

const DEGRADED: DegradedFinding[] = [
  {
    index: 1, id: 'CODEX-02',
    problems: [{ field: 'confidence', kind: 'missing', message: "/findings/1 must have required property 'confidence'" }],
    raw: { id: 'CODEX-02', severity: 'blocker', layer: 'code', kind: 'correctness', location: 'src/b.ts:9',
      problem: '降级意见的问题原文', evidence: '读了 src/b.ts', suggestion: '改 b' },
  },
  {
    index: 2, id: 'CODEX-03',
    problems: [{ field: 'severity', kind: 'invalid', message: '/findings/2/severity must be equal to one of the allowed values' }],
    raw: { id: 'CODEX-03', severity: 'medium', layer: 'docs', kind: 'risk', location: 'doc/x.md',
      problem: '表外值意见', evidence: 'e', suggestion: 's', confidence: 'low', extra_note: { a: 1 } },
  },
];

function input(over: Partial<RenderInput> = {}): RenderInput {
  return {
    critic: 'codex', stage: 'code', topic: 'T', runId: 'R', rerunIndex: 1, review: REVIEW, rawText: null,
    result: RESULT, modelRequested: 'qwen3.8-flash',
    effortRequested: null, effortEffective: null, effortEffectiveSource: 'unverified', tier: null, tierSource: 'legacy',
    snapshotHash: 'sha256:x', startedAt: 'a', finishedAt: 'b',
    evidenceOk: true, projectReads: 5, selectedCritics: CRITICS, degraded: false, drift: false, peerDeny: false,
    consultedUnverified: false, heterogeneous: true, ...over,
  };
}

test('R1 有降级意见 ⇒ front-matter 记 findings_degraded，findings_count 只数合格意见', () => {
  const fm = parseFrontMatter(renderReviewDoc(input({ degradedFindings: DEGRADED })))!;
  assert.deepEqual(fm['findings_degraded'], ['CODEX-02', 'CODEX-03'], '编号数组，与 run.json 同型');
  assert.deepEqual(fm['findings_count'], { blocker: 0, major: 1, minor: 0, nit: 0 }, '降级的 blocker 不计进严重度');
  assert.equal(fm['parse_fallback'], false);
});

test('R1′〔回归〕没有降级、没有修复 ⇒ 三个新键都不出现（常态不渲染）', () => {
  const fm = parseFrontMatter(renderReviewDoc(input({ degradedFindings: [], parseRepairs: { stripped_fields: [], unescaped_backslashes: 0 } })))!;
  for (const k of ['findings_degraded', 'parse_repairs', 'parse_fallback_cause']) assert.equal(k in fm, false, k);
});

test('R2 审查员造成的修复 ⇒ front-matter 与横幅都说出来；只剥了厂商字段则都不渲染', () => {
  const md = renderReviewDoc(input({ parseRepairs: { stripped_fields: ['toolAction', 'topic'], unescaped_backslashes: 2 } }));
  const fm = parseFrontMatter(md)!;
  assert.deepEqual(fm['parse_repairs'], { stripped_fields: ['toolAction', 'topic'], unescaped_backslashes: 2 });
  assert.match(md, /解析前做了无损修复/);
  assert.match(md, /还原非法转义 2 处/);

  const vendorOnly = renderReviewDoc(input({ parseRepairs: { stripped_fields: ['toolAction', 'toolSummary'], unescaped_backslashes: 0 } }));
  assert.equal('parse_repairs' in parseFrontMatter(vendorOnly)!, false, 'agy 每轮都注入厂商字段，常态不挂横幅');
  assert.doesNotMatch(vendorOnly, /解析前做了无损修复/);
});

test('R3 整份回退 ⇒ front-matter 记成因、横幅说出成因', () => {
  const md = renderReviewDoc(input({ review: null, rawText: '一段小结', parseFallbackCause: 'no_json_object' }));
  const fm = parseFrontMatter(md)!;
  assert.equal(fm['parse_fallback'], true);
  assert.equal(fm['parse_fallback_cause'], 'no_json_object');
  assert.match(md, /解析降级.*成因：回答里没有 JSON 对象/s);
});

test('R4 不合格意见一节：保留原编号、点名不合格字段、原值照录、多余字段列出', () => {
  const md = renderReviewDoc(input({ degradedFindings: DEGRADED }));
  assert.match(md, /逐条降级\*\*：本侧有 2 条意见不合 schema/);
  assert.match(md, /## 不合格意见（逐条降级，共 2 条）/);
  assert.match(md, /### CODEX-02 · 不合格/);
  assert.match(md, /`confidence`：缺失/);
  assert.match(md, /\| 置信度 \| （缺失） \|/);
  assert.match(md, /### CODEX-03 · 不合格/);
  assert.match(md, /\| 严重度 \| medium（不合法） \|/);
  assert.match(md, /降级意见的问题原文/);
  assert.match(md, /\*\*多余字段\*\*：`extra_note` = \{"a":1\}/);
  // 合格意见照常渲染，且排在不合格一节之前
  assert.ok(md.indexOf('### CODEX-01') < md.indexOf('## 不合格意见'));
});

test('R4′ 不合格意见的值含竖线、反引号或很长时，表格仍是每行两列（代码双审 r1 CODEX-05 ≡ GLM-02）', () => {
  const nasty: DegradedFinding = {
    index: 0, id: 'CODEX-09',
    problems: [{ field: 'kind', kind: 'invalid', message: 'm' }],
    raw: { id: 'CODEX-09', severity: 'minor', layer: 'code', kind: 'a|b`c', location: 'x'.repeat(500),
      problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high' },
  };
  const md = renderReviewDoc(input({ degradedFindings: [nasty] }));
  const sec = md.slice(md.indexOf('### CODEX-09'));
  const rows = sec.split('\n').filter((l) => /^\| (严重度|位置|类别|置信度) \|/.test(l));
  assert.equal(rows.length, 4);
  for (const r of rows) {
    const cols = r.replace(/\\\|/g, '').split('|').length - 2; // 去掉转义竖线后数分隔
    assert.equal(cols, 2, `错列：${r.slice(0, 80)}`);
  }
  assert.match(sec, /a\\\|b`c（不合法）/);
  assert.match(sec, /…（全文见 \.degraded\.json）/);
});

test('R5 合格 0 条而有降级意见 ⇒ 不说「未发现问题」', () => {
  const md = renderReviewDoc(input({ review: { ...REVIEW, findings: [] }, degradedFindings: DEGRADED }));
  assert.doesNotMatch(md, /未发现问题/);
  assert.match(md, /合格意见 0 条；本侧另有 2 条意见逐条降级/);
});

test('R5′〔回归〕合格与降级都为 0 ⇒ 仍说「未发现问题」', () => {
  const md = renderReviewDoc(input({ review: { ...REVIEW, findings: [] }, degradedFindings: [] }));
  assert.match(md, /未发现问题/);
});
