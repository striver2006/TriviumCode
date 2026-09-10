import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReview,
  extractJsonCandidate,
  checkReviewIntegrity,
  enumerateFallbackFindings,
} from '../../src/trivium/parse.js';
import type { Review } from '../../src/trivium/types.js';

function validReview(over: Partial<Review> = {}): Review {
  return {
    schema: 'trivium.review.v1',
    verdict: 'request-changes',
    summary: '最危险的一条：并发回滚未覆盖，可能造成数据不一致。',
    findings: [
      {
        id: 'AGY-01',
        severity: 'blocker',
        layer: 'plan',
        kind: 'concurrency',
        location: 'plan §3.2',
        problem: '计划未覆盖并发回滚',
        evidence: '读了 src/auth/oidc.ts 与 doc/01_requirements/PRD_x.md，均未见补偿事务',
        suggestion: '补充补偿事务步骤',
        confidence: 'high',
      },
    ],
    agreed: ['OIDC 选型合理'],
    not_covered: ['未审查前端改动'],
    consulted: ['src/auth/oidc.ts', 'doc/01_requirements/PRD_x.md'],
    ...over,
  };
}

test('整段就是 JSON 时直接解析（--json-schema 生效的常态）', () => {
  const r = parseReview(JSON.stringify(validReview()));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.extractedFrom, 'whole');
});

test('包在 ```json 围栏里也能抠出来', () => {
  const text = `我的审查结论如下：\n\n\`\`\`json\n${JSON.stringify(validReview(), null, 2)}\n\`\`\`\n\n以上。`;
  const r = parseReview(text);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.extractedFrom, 'fence');
});

test('前后有散文时靠括号配平兜底', () => {
  const text = `结论：${JSON.stringify(validReview())} 补充说明若干。`;
  const r = parseReview(text);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.extractedFrom, 'braces');
});

test('配平扫描不被字符串内的花括号骗到', () => {
  const c = extractJsonCandidate('noise {"a":"} {","b":1} tail');
  assert.ok(c);
  assert.deepEqual(JSON.parse(c!.json), { a: '} {', b: 1 });
});

test('findings 为空数组合法（表示无问题）', () => {
  const r = parseReview(JSON.stringify(validReview({
    findings: [],
    verdict: 'approve',
    summary: '通读计划与相关代码后未发现阻断性问题。',
    not_covered: ['未审查性能'],
  })));
  assert.equal(r.ok, true);
});

test('七字段缺一即不合格，并给出可回喂给模型的错误清单', () => {
  const bad = validReview();
  // @ts-expect-error 故意删字段
  delete bad.findings[0]!.evidence;
  const r = parseReview(JSON.stringify(bad));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.length > 0);
    assert.ok(r.errors.some((e) => e.includes('evidence')), `错误应点名 evidence：${r.errors.join('; ')}`);
    assert.equal(r.rawText.length > 0, true, '原文必须保留供 parse_fallback 落盘');
  }
});

test('编号不符合 AGY-/GLM- 前缀模式即 schema 不合格', () => {
  const bad = validReview();
  bad.findings[0]!.id = 'FOO-1';
  assert.equal(parseReview(JSON.stringify(bad)).ok, false);
});

test('severity / confidence 取值受枚举约束', () => {
  const bad = validReview();
  // @ts-expect-error 故意给非法枚举值
  bad.findings[0]!.severity = 'critical';
  assert.equal(parseReview(JSON.stringify(bad)).ok, false);
});

test('多余字段被拒（additionalProperties: false）', () => {
  const obj = { ...validReview(), 意外字段: 1 };
  assert.equal(parseReview(JSON.stringify(obj)).ok, false);
});

test('找不到 JSON 与语法错误分别给出原因', () => {
  const a = parseReview('我觉得这个计划挺好的，没什么问题。');
  assert.equal(a.ok, false);
  if (!a.ok) assert.match(a.reason, /找不到 JSON/);

  const b = parseReview('{"schema": "trivium.review.v1", 坏语法}');
  assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.reason, /JSON 语法错误/);
});

test('语义校验：编号前缀必须属于本侧（两侧不得冲突）', () => {
  const i = checkReviewIntegrity(validReview(), 'glm');
  assert.equal(i.prefixOk, false);
  assert.deepEqual(i.badIds, ['AGY-01']);
  assert.equal(checkReviewIntegrity(validReview(), 'gemini').prefixOk, true);
});

test('语义校验：重复编号被揪出', () => {
  const r = validReview();
  r.findings.push({ ...r.findings[0]! });
  assert.deepEqual(checkReviewIntegrity(r, 'gemini').duplicateIds, ['AGY-01']);
});

test('语义校验：evidence 引用的文件必须出现在 consulted', () => {
  const r = validReview({ consulted: ['src/auth/oidc.ts'] });
  const i = checkReviewIntegrity(r, 'gemini');
  assert.deepEqual(i.evidenceNotInConsulted, ['doc/01_requirements/PRD_x.md']);

  const ok = checkReviewIntegrity(validReview(), 'gemini');
  assert.deepEqual(ok.evidenceNotInConsulted, []);
});

test('语义校验：零意见且未说明检查了什么会被标记', () => {
  const lazy = validReview({ findings: [], summary: '没问题', not_covered: [] });
  assert.equal(checkReviewIntegrity(lazy, 'gemini').emptyWithoutExplanation, true);

  const honest = validReview({
    findings: [],
    summary: '通读了计划与 src/auth 下全部文件，未发现阻断性问题。',
    not_covered: ['未审查前端'],
  });
  assert.equal(checkReviewIntegrity(honest, 'gemini').emptyWithoutExplanation, false);
});

test('降级兜底：从原文切出可逐条裁决的编号单元（§6.6 规则 8）', () => {
  const raw = [
    '## 审查意见',
    '',
    '- 第一个问题是登录流程缺少超时处理，会导致请求悬挂。',
    '',
    '- 第二个问题是没有covering并发场景的回归测试用例。',
  ].join('\n');
  const items = enumerateFallbackFindings(raw, 'glm');
  assert.ok(items.length >= 2, `应切出至少 2 条，实际 ${items.length}`);
  assert.ok(items[0]!.startsWith('GLM-F01:'));
  assert.ok(items[1]!.startsWith('GLM-F02:'));
});

test('降级兜底：过短的碎片不计入', () => {
  assert.deepEqual(enumerateFallbackFindings('短\n\n也短', 'gemini'), []);
});
