/** locationResolve 单测（r2 计划 D2′：归一 + 行号校验全分支） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLocation,
  parseRanges,
  extractAnchorTexts,
  resolveLocation,
  CONSISTENCY_UNKNOWN,
} from '../../src/reviews/locationResolve';

const ROOT = '/ws/proj';

/** 内存文件映射 */
function files(map: Record<string, string>): (rel: string) => Promise<string | null> {
  return async (rel) => map[rel] ?? null;
}

test('parseRanges：单行 / 区间 / 逗号多区间（AGY-02 真实形态）', () => {
  assert.deepEqual(parseRanges('88'), [{ start: 88, end: 88 }]);
  assert.deepEqual(parseRanges('23-29'), [{ start: 23, end: 29 }]);
  assert.deepEqual(parseRanges('418-424,524-530,533'), [
    { start: 418, end: 424 },
    { start: 524, end: 530 },
    { start: 533, end: 533 },
  ]);
  assert.equal(parseRanges('a-b'), null);
  assert.equal(parseRanges(''), null);
});

test('归一：项目相对路径 / 带引号 / ./ 前缀', () => {
  assert.deepEqual(normalizeLocation('src/a.ts:88', ROOT), { kind: 'file', anchors: [{ relPath: 'src/a.ts', ranges: [{ start: 88, end: 88 }] }] });
  const q = normalizeLocation("'src/a.ts':88", ROOT);
  assert.equal(q.kind, 'file');
  if (q.kind === 'file') assert.equal(q.anchors[0]?.relPath, 'src/a.ts');
  const dot = normalizeLocation('./src/a.ts:1-2', ROOT);
  assert.equal(dot.kind, 'file');
  if (dot.kind === 'file') assert.equal(dot.anchors[0]?.relPath, 'src/a.ts');
});

test('归一：绝对路径截取工作区相对段（workdir 前缀剥离）', () => {
  const r = normalizeLocation(`${ROOT}/src/ui/cockpit.ts:104-131`, ROOT);
  assert.equal(r.kind, 'file');
  if (r.kind === 'file') {
    assert.equal(r.anchors[0]?.relPath, 'src/ui/cockpit.ts');
    assert.deepEqual(r.anchors[0]?.ranges, [{ start: 104, end: 131 }]);
  }
});

test('归一：workspace 外绝对路径与 ../ 上溯 → outside（CLAUDE-07）', () => {
  assert.equal(normalizeLocation('/other/repo/src/a.ts:5', ROOT).kind, 'outside');
  assert.equal(normalizeLocation('../outside/a.ts:5', ROOT).kind, 'outside');
  assert.equal(normalizeLocation('src/../../escape.ts:5', ROOT).kind, 'outside');
  // 伪装前缀目录：前缀相同但实为兄弟目录（路径里带 /ws/proj-evil）
  assert.equal(normalizeLocation(`${ROOT}-evil/a.ts:1`, ROOT).kind, 'outside');
});

test('归一：中文分号多文件位置（真实形态）', () => {
  const r = normalizeLocation('extension/src/extension.ts:23-29；extension/src/ui/cockpit.ts:104-131', ROOT);
  assert.equal(r.kind, 'file');
  if (r.kind === 'file') {
    assert.equal(r.anchors.length, 2);
    assert.equal(r.anchors[0]?.relPath, 'extension/src/extension.ts');
    assert.equal(r.anchors[1]?.relPath, 'extension/src/ui/cockpit.ts');
  }
});

test('归一：非文件形态 → doc', () => {
  assert.deepEqual(normalizeLocation('plan §3.2', ROOT), { kind: 'doc', text: 'plan §3.2' });
  assert.deepEqual(normalizeLocation('设计 §16.2 纪律 7', ROOT), { kind: 'doc', text: '设计 §16.2 纪律 7' });
});

test('锚文本提取：反引号 ≥8 字符，排除路径与纯数字（AGY-03）', () => {
  const out = extractAnchorTexts('问题在 `pool.length===1` 分支', '读了 `src/runDiscovery.ts` 与 `1.2.3`');
  assert.deepEqual(out, ['pool.length===1']);
  assert.deepEqual(extractAnchorTexts('无反引号', '内容'), []);
});

const SAMPLE = ['l1', 'l2', 'const x = pool.length === 1;', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'].join('\n');

test('resolveLocation：命中 → 行级（界内信任行号）', async () => {
  const r = await resolveLocation('src/a.ts:3', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(r.kind, 'file');
  const a = r.anchors[0]!;
  assert.equal(a.level, 'line');
  assert.deepEqual(a.line, { start: 3, end: 3 });
  assert.equal(a.drift, null);
});

test('resolveLocation：区间贯通（CLAUDE-05）', async () => {
  const r = await resolveLocation('src/a.ts:2-4', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  const a = r.anchors[0]!;
  assert.deepEqual(a.line, { start: 2, end: 4 });
});

test('resolveLocation：文件不存在 → missing-file', async () => {
  const r = await resolveLocation('src/gone.ts:5', ROOT, { readFile: files({}) });
  assert.equal(r.kind, 'missing-file');
  assert.equal(r.missingRelPath, 'src/gone.ts');
});

test('resolveLocation：无行号 → 文件级「未给行号」（区别于漂移，CLAUDE-08）', async () => {
  const r = await resolveLocation('src/a.ts', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  const a = r.anchors[0]!;
  assert.equal(a.level, 'file');
  assert.equal(a.label, '未给行号');
  assert.equal(a.drift, null);
});

test('resolveLocation：越界 + 锚文本唯一命中（空白归一化）→ nearby（AGY-03）', async () => {
  const r = await resolveLocation('src/a.ts:999', ROOT, {
    readFile: files({ 'src/a.ts': SAMPLE }),
    anchorTexts: ['pool.length === 1'], // 空格形态 vs 源码无空格（真实形态是 `pool.length===1`）
  });
  const a = r.anchors[0]!;
  assert.equal(a.level, 'line');
  assert.equal(a.drift, 'nearby');
  assert.equal(a.line?.start, 3);
  assert.match(a.label ?? '', /原 L999/);
});

test('resolveLocation：越界 + 锚文本多命中 → multi-hit 歧义降文件级（CLAUDE-08）', async () => {
  const dup = ['const x = pool.length===1;', 'b', 'const y = pool.length===1;'].join('\n');
  const r = await resolveLocation('src/a.ts:99', ROOT, {
    readFile: files({ 'src/a.ts': dup }),
    anchorTexts: ['pool.length===1'],
  });
  const a = r.anchors[0]!;
  assert.equal(a.level, 'file');
  assert.equal(a.drift, 'multi-hit');
});

test('resolveLocation：越界 + 有锚未命中 → line-lost；无锚 → out-of-range', async () => {
  const r1 = await resolveLocation('src/a.ts:99', ROOT, { readFile: files({ 'src/a.ts': 'only\nlines\nhere\n' }), anchorTexts: ['nothing-matches-this'] });
  assert.equal(r1.anchors[0]!.drift, 'line-lost');
  assert.equal(r1.anchors[0]!.level, 'file');
  const r2 = await resolveLocation('src/a.ts:99', ROOT, { readFile: files({ 'src/a.ts': 'x\ny\n' }) });
  assert.equal(r2.anchors[0]!.drift, 'out-of-range');
  assert.equal(r2.anchors[0]!.level, 'file');
});

test('resolveLocation：一致性结论透传（静态/动态判据输出）', async () => {
  const r = await resolveLocation('src/a.ts:1', ROOT, {
    readFile: files({ 'src/a.ts': 'x\n' }),
    consistency: () => ({ state: 'mismatch', note: 'git blob 不一致' }),
  });
  assert.equal(r.consistency.state, 'mismatch');
  assert.equal(CONSISTENCY_UNKNOWN.state, 'unknown');
});

test('resolveLocation：次级锚点不做行号校验（不套用主文件行数）', async () => {
  const r = await resolveLocation('src/a.ts:1；src/b.ts:500-600', ROOT, {
    readFile: files({ 'src/a.ts': 'x\ny\n', 'src/b.ts': 'one\n' }),
  });
  assert.equal(r.kind, 'file');
  assert.equal(r.anchors[1]!.level, 'file');
  assert.match(r.anchors[1]!.label ?? '', /次级位置/);
});

// ── S8 修订（CLAUDE-09/AGY-02、CLAUDE-08）：行号边界与次级区间 ──

test('行号 0 / 负数 → 文件级「未给行号」（CLAUDE-09/AGY-02）', async () => {
  const zero = await resolveLocation('src/a.ts:0', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(zero.anchors[0]!.level, 'file');
  assert.equal(zero.anchors[0]!.label, '未给行号');
  const neg = await resolveLocation('src/a.ts:-1', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(neg.kind, 'file');
  assert.equal(neg.anchors[0]!.level, 'file');
  assert.equal(neg.anchors[0]!.label, '未给行号');
  // 负数尾巴剥离后仍是有效文件（不误报 missing-file）
  assert.equal(neg.anchors[0]!.relPath, 'src/a.ts');
});

test('parseRanges 拒绝 0 与负数形态', () => {
  assert.equal(parseRanges('0'), null);
  assert.equal(parseRanges('0-3'), null);
  assert.equal(parseRanges('-1'), null);
  assert.equal(parseRanges('3,-2'), null);
});

test('逗号多区间的次级区间展开（CLAUDE-08：2-3,5-6 不只剩 2-3）', async () => {
  const r = await resolveLocation('src/a.ts:2-3,5-6', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  const lineAnchors = r.anchors.filter((a) => a.level === 'line');
  assert.ok(lineAnchors.some((a) => a.line?.start === 2 && a.line?.end === 3), '主锚点 2-3');
  const secondary = r.anchors.find((a) => a.label?.includes('次级区间'));
  assert.ok(secondary, '次级区间存在');
  assert.equal(secondary!.line?.start, 5);
  assert.equal(secondary!.line?.end, 6);
  // 次级区间越界 → 文件级标注
  const r2 = await resolveLocation('src/a.ts:2,999-1000', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  const over = r2.anchors.find((a) => a.label?.includes('越界'));
  assert.ok(over, '越界次级区间标注存在');
  assert.equal(over!.level, 'file');
});

// ── r2 修订（AGY-01/CODEX-03、CLAUDE-04）──

test('主锚点恒在首位（AGY-01/CODEX-03）：次级区间后置，含越界形态', async () => {
  const r = await resolveLocation('src/a.ts:2-3,5-6', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(r.anchors[0]!.level, 'line');
  assert.deepEqual(r.anchors[0]!.line, { start: 2, end: 3 }, 'anchors[0] 是主区间 2-3');
  const r2 = await resolveLocation('src/a.ts:2-3,900-999', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.deepEqual(r2.anchors[0]!.line, { start: 2, end: 3 }, '次级越界不影响主锚点仍为 2-3 行级');
  assert.equal(r2.anchors[1]!.level, 'file');
  assert.match(r2.anchors[1]!.label ?? '', /越界/);
});

test('非数字行号尾巴（CLAUDE-04）：:abc / :1x 剥离 → 文件级「未给行号」，不误报缺失', async () => {
  const r = await resolveLocation('src/a.ts:abc', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(r.kind, 'file');
  assert.equal(r.anchors[0]!.relPath, 'src/a.ts', '尾巴剥离后仍是真实文件');
  assert.equal(r.anchors[0]!.level, 'file');
  assert.equal(r.anchors[0]!.label, '未给行号');
  const r2 = await resolveLocation('src/a.ts:1x2', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(r2.anchors[0]!.label, '未给行号');
  // 尾巴含 . 或 / 不剥离（保守：无法区分怪文件名/版本引用，诚实标缺失）
  const dotted = await resolveLocation('src/a.ts:v1.2', ROOT, { readFile: files({ 'src/a.ts': SAMPLE }) });
  assert.equal(dotted.kind, 'missing-file', '含 . 的尾巴不剥 → 按路径诚实标文件缺失');
});
