import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderReviewDoc, parseFrontMatter, countSeverities,
} from '../../src/trivium/render.js';
import type { RenderInput } from '../../src/trivium/render.js';
import type { CriticResult, Review } from '../../src/trivium/types.js';

const RESULT: CriticResult = {
  critic: 'gemini', status: 'ok', exit_code: 0, duration_s: 472.4,
  raw_stdout_path: '/runs/out', trace_path: '/runs/trace', review_json: null,
  raw_response_text: '{}', model_effective: 'gemini-3.1-pro-high',
  model_effective_source: 'envelope', tool_calls: { read: 27, grep: 9 },
  read_paths: [], write_events: [], evidence_ok: true, fail_reason: null,
  session_id: 'conv-1', cli_version: '1.2.0', peer_deny_applied: false,
  command_line: 'agy -p …',
};

const REVIEW: Review = {
  schema: 'trivium.review.v1',
  verdict: 'request-changes',
  summary: '最危险的一条：并发回滚未覆盖。',
  findings: [
    { id: 'AGY-02', severity: 'minor', layer: 'plan', kind: 'maintainability',
      location: 'plan §5', problem: '命名不一致', evidence: '读了 doc/x.md',
      suggestion: '统一命名', confidence: 'medium' },
    { id: 'AGY-01', severity: 'blocker', layer: 'plan', kind: 'concurrency',
      location: 'plan §3.2', problem: '并发回滚缺失', evidence: '读了 src/a.ts',
      suggestion: '补偿事务', confidence: 'high' },
  ],
  agreed: ['选型合理'],
  not_covered: ['未审前端'],
  consulted: ['src/a.ts', 'doc/x.md'],
};

function input(over: Partial<RenderInput> = {}): RenderInput {
  return {
    critic: 'gemini', stage: 'plan', topic: '登录重构', runId: '20260910T142310Z',
    rerunIndex: 1, review: REVIEW, rawText: null, result: RESULT,
    modelRequested: 'gemini-3.1-pro-high', effort: 'high',
    snapshotHash: 'sha256:8c1f', startedAt: '2026-09-10T14:23:10+08:00',
    finishedAt: '2026-09-10T14:31:02+08:00', evidenceOk: true, projectReads: 21,
    degraded: false, drift: false, peerDeny: false, consultedUnverified: false,
    heterogeneous: true, ...over,
  };
}

test('front-matter 可被 YAML 解析，且关键机读字段齐备', () => {
  const fm = parseFrontMatter(renderReviewDoc(input()));
  assert.ok(fm);
  assert.equal(fm!['schema'], 'trivium.review.v1');
  assert.equal(fm!['role'], 'gemini');
  assert.equal(fm!['vendor'], 'antigravity');
  assert.equal(fm!['agent_cli'], 'agy/1.2.0');
  assert.equal(fm!['blind'], true);
  assert.equal(fm!['duration_s'], 472);
  assert.deepEqual(fm!['findings_count'], { blocker: 1, major: 0, minor: 1, nit: 0 });
});

test('生效模型来源被记录，不采信 Agent 自述（AC-13）', () => {
  const fm = parseFrontMatter(renderReviewDoc(input()))!;
  assert.equal(fm['model_effective'], 'gemini-3.1-pro-high');
  assert.equal(fm['model_effective_source'], 'envelope');
});

test('project_reads 进 tool_calls（AC-11 的机读落点）', () => {
  const fm = parseFrontMatter(renderReviewDoc(input({ projectReads: 21 })))!;
  assert.deepEqual(fm['tool_calls'], { read: 27, grep: 9, project_reads: 21 });
});

test('意见按严重度排序，blocker 排在最前', () => {
  const md = renderReviewDoc(input());
  assert.ok(md.indexOf('AGY-01') < md.indexOf('AGY-02'), 'blocker 必须排在 minor 之前');
});

test('降级标记出现在正文顶部而非只在 front-matter（不可伪装）', () => {
  const md = renderReviewDoc(input({ degraded: true }));
  assert.ok(md.includes('本次为单审降级'));
  assert.equal(parseFrontMatter(md)!['degraded'], true);
});

test('证据不足会显式标注该侧不算合格双审的一半', () => {
  const md = renderReviewDoc(input({ evidenceOk: false }));
  assert.ok(md.includes('不得计为合格双审的一半'));
  assert.equal(parseFrontMatter(md)!['evidence_ok'], false);
});

test('路径级 deny 未生效时如实标注诚实边界（§10.2）', () => {
  const md = renderReviewDoc(input({ peerDeny: false }));
  assert.ok(md.includes('路径级 deny 未生效'));
  assert.equal(parseFrontMatter(md)!['peer_deny'], false);

  const md2 = renderReviewDoc(input({ peerDeny: true }));
  assert.ok(!md2.includes('路径级 deny 未生效'));
  assert.equal(parseFrontMatter(md2)!['peer_deny'], true);
});

test('漂移会标注「结论对应送审时刻快照」', () => {
  const md = renderReviewDoc(input({ drift: true }));
  assert.ok(md.includes('工作树发生漂移'));
  assert.equal(parseFrontMatter(md)!['drift'], true);
});

test('与主脑同源时醒目告警并记录覆盖理由（AC-18）', () => {
  const md = renderReviewDoc(input({
    heterogeneous: false, overrideReason: '用户显式指定',
    modelRequested: 'claude-sonnet-4-6',
  }));
  assert.ok(md.includes('与主脑同源'));
  assert.ok(md.includes('用户显式指定'));
  const fm = parseFrontMatter(md)!;
  assert.equal(fm['heterogeneous'], false);
  assert.equal(fm['override_reason'], '用户显式指定');
});

test('零意见时文件照常渲染，并提示这不等于没审（FR-13）', () => {
  const md = renderReviewDoc(input({
    review: { ...REVIEW, findings: [], verdict: 'approve', summary: '未发现阻断性问题。' },
  }));
  assert.ok(md.includes('未发现问题'));
  assert.ok(md.includes('这不等于「没审」'));
  assert.deepEqual(parseFrontMatter(md)!['findings_count'], { blocker: 0, major: 0, minor: 0, nit: 0 });
});

test('解析降级时保留原文并标注不参与阻断判定（AD-08）', () => {
  const raw = '我认为这个计划有几个问题……（非结构化输出）';
  const md = renderReviewDoc(input({ review: null, rawText: raw }));
  assert.ok(md.includes('解析降级'));
  assert.ok(md.includes('该侧不参与阻断判定'));
  assert.ok(md.includes(raw));
  assert.equal(parseFrontMatter(md)!['parse_fallback'], true);
});

test('consulted 未填时明确说明无法交叉核对', () => {
  const md = renderReviewDoc(input({ review: { ...REVIEW, consulted: [] } }));
  assert.ok(md.includes('无法与工具轨迹交叉核对'));
});

test('consulted 未通过核验时打 consulted_unverified 标记', () => {
  const fm = parseFrontMatter(renderReviewDoc(input({ consultedUnverified: true })))!;
  assert.equal(fm['consulted_unverified'], true);
});

test('重跑轮次在标题与 front-matter 中都可见', () => {
  const md = renderReviewDoc(input({ rerunIndex: 3 }));
  assert.ok(md.includes('第 3 轮'));
  assert.equal(parseFrontMatter(md)!['rerun_index'], 3);
});

test('两侧 vendor 与 agent_cli 正确区分', () => {
  const z = parseFrontMatter(renderReviewDoc(input({
    critic: 'glm',
    result: { ...RESULT, critic: 'glm', cli_version: '0.16.5', model_effective_source: 'trace', model_route: 'config_copy' },
  })))!;
  assert.equal(z['vendor'], 'zcode');
  assert.equal(z['agent_cli'], 'zcode/0.16.5');
  assert.equal(z['model_route'], 'config_copy');
});

test('countSeverities 对 null 安全', () => {
  assert.deepEqual(countSeverities(null), { blocker: 0, major: 0, minor: 0, nit: 0 });
});

test('parseFrontMatter 对无 front-matter 的文件返回 null', () => {
  assert.equal(parseFrontMatter('# 普通文档\n正文'), null);
});
