import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measureDivergence,
  normalizeLocation,
  renderDivergence,
  sameLocation,
} from '../../src/trivium/divergence.js';
import type { Review, Finding } from '../../src/trivium/types.js';

/**
 * 位置归一化（审查意见 AGY-06）。
 *
 * 为什么必须有这一层：M3 那轮真实双审，两侧 14 条意见的原始 location 集合
 * Jaccard = **0.00**，而人读下来 AGY-01 与 GLM-03 讲的是同一件事。
 * 未归一化的指标不只是不准，它是**恒为 0**——等于这个退化检测根本没在工作。
 */

const loc = (s: string) => normalizeLocation(s);

test('行号与行区间归一到同一 anchor', () => {
  assert.equal(loc('src/a.ts:88').anchor, 'src/a.ts');
  assert.deepEqual(loc('src/a.ts:88').lines, [88, 88]);
  assert.equal(loc('src/a.ts:85-92').anchor, 'src/a.ts');
  assert.deepEqual(loc('src/a.ts:85-92').lines, [85, 92]);
});

test(':88 落在 :85-92 区间内 → 同一处', () => {
  assert.ok(sameLocation(loc('src/a.ts:88'), loc('src/a.ts:85-92')));
  // 这是 AGY-06 举的例子，字符串相等判定下它会被算成两处不同位置
  assert.notEqual('src/a.ts:88', 'src/a.ts:85-92');
});

test('区间不重合 → 不是同一处', () => {
  assert.ok(!sameLocation(loc('src/a.ts:10'), loc('src/a.ts:85-92')));
});

test('同文件但一方未给行号 → 视为同一处', () => {
  assert.ok(sameLocation(loc('src/a.ts'), loc('src/a.ts:85-92')));
});

test('不同文件一律不是同一处，哪怕行号相同', () => {
  assert.ok(!sameLocation(loc('src/a.ts:88'), loc('src/b.ts:88')));
});

test('章节标记去前缀归一：plan §3.2 == §3.2', () => {
  assert.equal(loc('plan §3.2').anchor, '§3.2');
  assert.equal(loc('§3.2').anchor, '§3.2');
  assert.equal(loc('设计 § 3.2').anchor, '§3.2');
  assert.ok(sameLocation(loc('plan §3.2'), loc('§3.2')));
  assert.equal(loc('§3.2').lines, null);
});

test('路径前缀差异归一：./src/a.ts == src/a.ts', () => {
  assert.equal(loc('./src/a.ts:3').anchor, 'src/a.ts');
  assert.equal(loc('src\\a.ts:3').anchor, 'src/a.ts');
  assert.ok(sameLocation(loc('./src/a.ts:3'), loc('src/a.ts:3')));
});

test('反向区间被规整为升序', () => {
  assert.deepEqual(loc('src/a.ts:92-85').lines, [85, 92]);
});

test('行区间支持 en dash 与波浪号', () => {
  assert.deepEqual(loc('src/a.ts:5–9').lines, [5, 9]);
  assert.deepEqual(loc('src/a.ts:5~9').lines, [5, 9]);
});

// ───────────────────────── Jaccard ─────────────────────────

function review(locations: string[]): Review {
  const findings = locations.map((location, i) => ({
    id: `X-${i}`,
    severity: 'minor',
    layer: 'plan',
    kind: 'correctness',
    location,
    problem: 'p',
    evidence: 'e',
    suggestion: 's',
    confidence: 'high',
  })) as unknown as Finding[];
  return { schema: 'trivium.review.v1', verdict: 'request-changes', summary: 's', findings } as Review;
}

test('归一化把 0.00 的原始 Jaccard 救回真实重合度', () => {
  const a = review(['src/a.ts:88', 'plan §3.2', 'src/c.ts:1']);
  const b = review(['src/a.ts:85-92', '§3.2', 'src/d.ts:9']);

  const d = measureDivergence(a, b);
  assert.equal(d.rawJaccard, 0, '原始字符串集合完全不相交，这正是实测到的病灶');
  // 3 个共同位置里有 2 个真重合，并集 = 2 + 1 + 1 = 4
  assert.deepEqual(d.overlap.sort(), ['plan §3.2', 'src/a.ts:88']);
  assert.deepEqual(d.onlyA, ['src/c.ts:1']);
  assert.deepEqual(d.onlyB, ['src/d.ts:9']);
  assert.equal(d.jaccard, 0.5);
  assert.equal(d.degenerate, false);
});

test('两侧看同一批地方 → 判双审退化', () => {
  const a = review(['src/a.ts:10', 'src/b.ts:20', 'src/c.ts:30']);
  const b = review(['src/a.ts:8-12', 'src/b.ts:20', 'src/c.ts:28-33']);
  const d = measureDivergence(a, b);
  assert.equal(d.jaccard, 1);
  assert.equal(d.degenerate, true);
  assert.match(renderDivergence(d), /双审退化/);
});

test('两侧都零意见不判退化——那是「都认为没问题」', () => {
  const d = measureDivergence(review([]), review([]));
  assert.equal(d.jaccard, 0);
  assert.equal(d.degenerate, false, '空集的 Jaccard 无定义，不能当成重合');
  assert.doesNotMatch(renderDivergence(d), /双审退化/);
});

test('一侧缺失（降级单审）不报错', () => {
  const d = measureDivergence(review(['src/a.ts:1']), null);
  assert.equal(d.jaccard, 0);
  assert.deepEqual(d.onlyA, ['src/a.ts:1']);
  assert.equal(d.degenerate, false);
});

test('阈值可调，边界是严格大于', () => {
  const a = review(['src/a.ts:1', 'src/b.ts:1']);
  const b = review(['src/a.ts:1', 'src/b.ts:1']);
  assert.equal(measureDivergence(a, b, 1).degenerate, false, 'Jaccard 1 不 > 阈值 1');
  assert.equal(measureDivergence(a, b, 0.99).degenerate, true);
});

test('多章节 location 锚到第一节（确定性优先）', () => {
  // 实测真实数据里出现过这种写法
  assert.equal(loc('plan §1 & §6 R-B').anchor, '§1');
  assert.ok(sameLocation(loc('plan §1 & §6 R-B'), loc('§1')));
});

test('同侧重复位置折叠成一处——Jaccard 算的是集合不是多重集', () => {
  // A 侧两条意见都落在 §1；若不折叠，重合数会被同侧重复项抬高
  const a = review(['plan §1', 'plan §1 & §6 R-B', 'src/x.ts:5']);
  const b = review(['§1']);
  const d = measureDivergence(a, b);
  assert.deepEqual(d.overlap, ['plan §1'], '§1 只应计一次');
  assert.deepEqual(d.onlyA, ['src/x.ts:5']);
  assert.deepEqual(d.onlyB, []);
  assert.equal(d.jaccard, 0.5, '并集 = {§1, src/x.ts:5}，交集 = {§1}');
});

test('同侧重复不会把重合度刷成 1', () => {
  const a = review(['src/a.ts:1', 'src/a.ts:1', 'src/a.ts:1']);
  const b = review(['src/a.ts:1', 'src/b.ts:9']);
  const d = measureDivergence(a, b);
  assert.equal(d.jaccard, 0.5);
  assert.equal(d.degenerate, false);
});
