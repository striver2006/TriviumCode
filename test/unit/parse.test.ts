import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReview,
  extractJsonCandidate,
  extractJsonCandidates,
  checkReviewIntegrity,
  enumerateFallbackFindings,
} from '../../src/trivium/parse.js';
import type { Review } from '../../src/trivium/types.js';

function validReview(over: Partial<Review> = {}): Review {
  return {
    schema: 'trivium.review.v2',
    verdict: 'approve-after-changes',
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

/*
 * 下面两条在「解析回退逐条降级」之前断言的是**整份回退**（`ok: false`）：单条意见缺字段或取值越界，
 * 整份结论判死。那正是本主题改掉的语义——根对象合法时只把那一条降级、原编号保留、逐字段点名问题。
 * 断言随语义改写，而不是删掉：「这一条不合格」这件事仍要被说出来，只是落点从整份回退换成了 `degraded`。
 */
test('意见缺必填字段 ⇒ 这一条逐条降级（原编号保留、点名缺的字段），不再整份回退', () => {
  const bad = validReview();
  // @ts-expect-error 故意删字段
  delete bad.findings[0]!.evidence;
  const r = parseReview(JSON.stringify(bad));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.review.findings, [], '不合格的那条不进 review.findings（失去阻断资格）');
    assert.equal(r.degraded.length, 1);
    assert.equal(r.degraded[0]!.id, 'AGY-01');
    assert.deepEqual(r.degraded[0]!.problems.map((p) => [p.field, p.kind]), [['evidence', 'missing']]);
    assert.ok(r.degraded[0]!.problems[0]!.message.includes('evidence'), '问题文案可回喂给模型');
  }
});

test('编号不符合 AGY-/GLM- 前缀模式即 schema 不合格', () => {
  const bad = validReview();
  bad.findings[0]!.id = 'FOO-1';
  assert.equal(parseReview(JSON.stringify(bad)).ok, false);
});

test('severity / confidence 取值受枚举约束：表外值让这一条降级，不做语义映射', () => {
  const bad = validReview();
  // @ts-expect-error 故意给非法枚举值
  bad.findings[0]!.severity = 'critical';
  const r = parseReview(JSON.stringify(bad));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.review.findings.length, 0);
    assert.deepEqual(r.degraded[0]!.problems.map((p) => [p.field, p.kind]), [['severity', 'invalid']]);
    assert.equal(r.degraded[0]!.raw['severity'], 'critical', '原值照录，不映射成任何合法值');
  }
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
  const i = checkReviewIntegrity(validReview(), 'glm', []);
  assert.equal(i.prefixOk, false);
  assert.deepEqual(i.badIds, ['AGY-01']);
  assert.equal(checkReviewIntegrity(validReview(), 'gemini', []).prefixOk, true);
});

test('语义校验：重复编号被揪出', () => {
  const r = validReview();
  r.findings.push({ ...r.findings[0]! });
  assert.deepEqual(checkReviewIntegrity(r, 'gemini', []).duplicateIds, ['AGY-01']);
});

test('语义校验：evidence 引用的文件必须出现在 consulted', () => {
  const r = validReview({ consulted: ['src/auth/oidc.ts'] });
  const i = checkReviewIntegrity(r, 'gemini', []);
  assert.deepEqual(i.evidenceNotInConsulted, ['doc/01_requirements/PRD_x.md']);

  const ok = checkReviewIntegrity(validReview(), 'gemini', []);
  assert.deepEqual(ok.evidenceNotInConsulted, []);
});

/*
 * EV-127：evidence 路径必须整段以已知根目录起头。
 * 旧判据用 `\b` 起匹配，根目录名出现在路径中段（`skills-src/`、`dist/test/`、`ZCode.app/`）也会截出一个
 * 并不存在的路径，报「evidence 引用但未列入 consulted」。本仓历史审查件实测 56 条，全是这一类。
 */
function evidenceMissing(evidence: string, consulted: string[]): string[] {
  const r = validReview({ consulted });
  r.findings[0]!.evidence = evidence;
  return checkReviewIntegrity(r, 'gemini', []).evidenceNotInConsulted;
}

test('EV-127 U1：skills-src/ 路径不再被截成 src/…（完整路径已列入 consulted）', () => {
  const p = 'skills-src/commands/run.contract.md';
  assert.deepEqual(evidenceMissing(`见 ${p} 第 3 段`, [p]), []);
});

test('EV-127 U2：不以已知根目录起头的路径不在核对范围（漏报方向，有意）', () => {
  assert.deepEqual(evidenceMissing('见 skills-src/commands/run.contract.md 第 3 段', []), []);
});

test('EV-127 U3：dist/test/… 不再被截成 test/…', () => {
  assert.deepEqual(evidenceMissing('跑了 dist/test/src/trivium/guard.js', []), []);
});

test('EV-127 U4：绝对路径里的 .app/ 不再被截成 app/…', () => {
  assert.deepEqual(evidenceMissing('读了 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs', []), []);
});

test('EV-127 U5：前导 ./ 照收，报的是去掉 ./ 之后的路径', () => {
  assert.deepEqual(evidenceMissing('对照 ./test/unit/archive.test.ts 的断言', []), ['test/unit/archive.test.ts']);
});

test('EV-127 U6：全角括号、反引号、全角逗号、行首这些常见前界仍然有效', () => {
  assert.deepEqual(
    evidenceMissing('lib/d.js 开头；（src/a.ts）与 `doc/b.md`，test/c.ts:12', []),
    ['doc/b.md', 'lib/d.js', 'src/a.ts', 'test/c.ts'],
  );
});

test('EV-127 U7：前面紧跟下划线时不起匹配（与旧判据相同的对照格）', () => {
  assert.deepEqual(evidenceMissing('见 foo_src/a.ts', []), []);
});

test('EV-127 U8：evidence 与 consulted 两侧都写前导 ./ 时对得上（consulted 同口径去 ./，代码双审 r1 CODEX-02）', () => {
  assert.deepEqual(evidenceMissing('对照 ./src/a.ts 的实现', ['./src/a.ts']), []);
});

test('语义校验：零意见且未说明检查了什么会被标记', () => {
  const lazy = validReview({ findings: [], summary: '没问题', not_covered: [] });
  assert.equal(checkReviewIntegrity(lazy, 'gemini', []).emptyWithoutExplanation, true);

  const honest = validReview({
    findings: [],
    summary: '通读了计划与 src/auth 下全部文件，未发现阻断性问题。',
    not_covered: ['未审查前端'],
  });
  assert.equal(checkReviewIntegrity(honest, 'gemini', []).emptyWithoutExplanation, false);
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

// ── 回归：厂商注入字段（实跑时 agy 真的塞了这两个）──

test('回归：剥离 agy 注入的 toolAction / toolSummary 后仍能通过校验', () => {
  const withNoise = {
    ...validReview(),
    toolAction: 'read_file',
    toolSummary: '读取了 15 个文件',
  };
  const r = parseReview(JSON.stringify(withNoise));
  assert.equal(r.ok, true, r.ok ? '' : `${r.reason}：${r.errors.join('; ')}`);
  if (r.ok) {
    assert.equal(r.review.findings.length, 1);
    // 剥离后的对象上不应残留噪音字段
    assert.ok(!('toolAction' in (r.review as unknown as Record<string, unknown>)));
  }
});

test('回归：剥离只针对已知厂商字段，真正写错的字段名仍会被发现', () => {
  const typo = { ...validReview(), findigs: [] };
  const r = parseReview(JSON.stringify(typo));
  assert.equal(r.ok, false, '未知的多余字段必须仍然报错，否则字段名写错就查不出来');
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes('findigs')));
});

// ── agy 1.2.0 输出两个首尾相接的 JSON 对象（实测踩到）──

test('两个首尾相接的 JSON 对象：取首个通过校验的，不再整段降级', () => {
  /*
   * 实测：agy 1.2.0 把 envelope 吐了两遍（内容相同，疑似流式收尾重复）。
   * 整段文本仍「以 { 开头、以 } 结尾」，旧实现据此当成一个整体，
   * JSON.parse 在第二个对象的起始处报语法错误——
   * 一份完全合格的 6 条意见结论**每次**被降级成 parse_fallback、失去阻断资格。
   */
  const one = JSON.stringify(validReview());
  const r = parseReview(`${one}\n${one}`);
  assert.equal(r.ok, true, `应解析成功，实际：${r.ok ? '' : r.reason}`);
  assert.equal(r.ok && r.review.findings.length, 1);
});

test('第一个对象残缺时跳过它，取后面合格的那个', () => {
  // 不是「取第一个能解析的」：流式片段可能先到
  const broken = '{"schema":"trivium.review.v1","findings":[';
  const good = JSON.stringify(validReview());
  const r = parseReview(`${broken}\n${good}`);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
});

test('结论之后追加的噪声对象顶不掉真正的结论', () => {
  const good = JSON.stringify(validReview());
  const noise = JSON.stringify({ toolAction: 'done', note: '收尾' });
  const r = parseReview(`${good}\n${noise}`);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  assert.equal(r.ok && r.review.findings[0]!.id, 'AGY-01');
});

test('全都不合格时如实报走得最远那一格的校验错误', () => {
  const r = parseReview('{"a":1}\n{"b":2}');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /不符合 trivium\.review\.v2/);
});

test('extractJsonCandidates 去重并保序', () => {
  const one = '{"x":1}';
  const c = extractJsonCandidates(`${one}\n${one}`);
  /*
   * 整段仍「以 { 开头、以 } 结尾」，所以先作为 whole 入列（它解析不了，
   * parseReview 会跳过它）；随后两个相同片段去重成一个。
   * 这正是 agy 重复输出时的形状。
   */
  assert.deepEqual(c.map((x) => x.from), ['whole', 'braces']);
  assert.equal(c[1]!.json, one);
});

test('extractJsonCandidates 同时收代码围栏与裸对象，且不重复', () => {
  const text = ['前言', '```json', '{"a":1}', '```', '尾巴 {"b":2} 结束'].join('\n');
  const got = extractJsonCandidates(text).map((c) => `${c.from}:${c.json}`);
  // 围栏里的那个先入列；配平扫描再扫到同一段时被去重
  assert.deepEqual(got, ['fence:{"a":1}', 'braces:{"b":2}']);
});
