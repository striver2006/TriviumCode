/** reviewParse 单测（r2 计划 D9′：优先主仓真实工件，缺则内联回退） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  parseReviewFile,
  parseReviewFileName,
  severityLabel,
  verdictLabel,
  countSeverities,
  type ParsedReview,
} from '../../src/reviews/reviewParse';

/**
 * 主仓真实工件夹具（D1′/D9′）：存在即读、缺则回退内联样例（独立分发兼容）。
 * 覆盖：三家 verdict 全档（Phase0-1 code r2）与 blocker/major/minor/nit 全档
 * （Agent双模式接入真实准入收口 code 历史件）。
 */
async function loadRealFixture(rel: string): Promise<{ name: string; text: string } | null> {
  const p = path.join(process.cwd(), '..', '.reviews', rel);
  try {
    return { name: path.basename(rel), text: await fs.readFile(p, 'utf8') };
  } catch {
    return null;
  }
}

test('文件名解析：标准形态 / 不识别', () => {
  assert.deepEqual(parseReviewFileName('review-claude-20261105T185028Z.json'), { critic: 'claude', runId: '20261105T185028Z' });
  assert.deepEqual(parseReviewFileName('review-gemini-20261105T182415Z.json'), { critic: 'gemini', runId: '20261105T182415Z' });
  assert.equal(parseReviewFileName('changes-20261105T185028Z.diff'), null);
  assert.equal(parseReviewFileName('run-20261105T185028Z.json'), null);
  assert.equal(parseReviewFileName('review-claude-notimestamp.json'), null);
});

test('真实工件（claude r2）：全档 severity 解析 + verdict', async () => {
  const fx = await loadRealFixture('VSCode插件Phase0-1/code/_meta/review-claude-20261105T185028Z.json');
  if (!fx) return; // 独立分发环境：内联回退见下述构造用例
  const parsed = parseReviewFile(fx.name, fx.text);
  assert.equal(parsed.status.state, 'ok');
  assert.equal(parsed.status.critic, 'claude');
  assert.equal(parsed.verdict, 'pass-after-changes');
  assert.ok(parsed.findings.length > 0);
  const sevs = new Set(parsed.findings.map((f) => f.severity));
  assert.ok(sevs.has('major'));
  for (const f of parsed.findings) {
    assert.ok(f.id.length > 0 && f.problem.length > 0 && f.location.length > 0);
  }
});

test('真实工件（含 nit/minor 的 v2 历史件）：全档覆盖', async () => {
  const fx = await loadRealFixture('KimiCode-macOS规则根因与只读准入修复/code/_meta/review-glm-20261027T180347Z.json');
  if (!fx) return;
  const parsed = parseReviewFile(fx.name, fx.text);
  assert.equal(parsed.status.state, 'ok');
  const sevs = new Set(parsed.findings.map((f) => f.severity));
  assert.ok(sevs.has('minor'));
  assert.ok(sevs.has('nit'));
});

test('真实工件（review.v1 旧归档件）：逐文件降级且明示（2026-10 早期件为 v1 契约）', async () => {
  const fx = await loadRealFixture('Agent双模式接入真实准入收口/code/_meta/review-claude-20261010T170416Z.json');
  if (!fx) return;
  const parsed = parseReviewFile(fx.name, fx.text);
  assert.equal(parsed.status.state, 'unsupported-schema');
  assert.equal(parsed.status.actualSchema, 'trivium.review.v1');
  assert.equal(parsed.findings.length, 0);
  assert.match(parsed.status.notice ?? '', /未展示/);
});

function baseFinding(): Record<string, string> {
  return {
    id: 'TEST-01', severity: 'major', layer: 'code', kind: 'correctness',
    location: 'src/a.ts:10', problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high',
  };
}

function reviewJson(findings: unknown[], schema = 'trivium.review.v2', verdict = 'pass'): string {
  return JSON.stringify({ schema, verdict, summary: 'ok', findings });
}

test('ok：正常解析', () => {
  const p = parseReviewFile('review-claude-20260101T000000Z.json', reviewJson([baseFinding()]));
  assert.equal(p.status.state, 'ok');
  assert.equal(p.findings[0]?.id, 'TEST-01');
  assert.equal(p.verdict, 'pass');
  assert.deepEqual(p.agreed, []);
});

test('partial-skipped：单条缺字段/枚举外值 → 跳过计数（不整份丢弃）', () => {
  const bad1 = { ...baseFinding() } as Record<string, unknown>;
  delete bad1['problem'];
  const bad2 = { ...baseFinding(), severity: 'huge' };
  const good = { ...baseFinding(), id: 'TEST-02' };
  const p = parseReviewFile('review-claude-20260101T000000Z.json', reviewJson([bad1, bad2, good]));
  assert.equal(p.status.state, 'partial-skipped');
  assert.equal(p.status.skippedCount, 2);
  assert.equal(p.findings.length, 1);
  assert.match(p.status.notice ?? '', /2 条/);
});

test('parse-error：坏 JSON / 非对象根', () => {
  const p1 = parseReviewFile('review-claude-20260101T000000Z.json', '{oops');
  assert.equal(p1.status.state, 'parse-error');
  assert.match(p1.status.notice ?? '', /JSON/);
  const p2 = parseReviewFile('review-claude-20260101T000000Z.json', '[1,2]');
  assert.equal(p2.status.state, 'parse-error');
});

test('unsupported-schema：v1 旧件 → 逐文件降级且携带实际串（CLAUDE-06/D1′）', () => {
  const p = parseReviewFile('review-claude-20260101T000000Z.json', reviewJson([baseFinding()], 'trivium.review.v1'));
  assert.equal(p.status.state, 'unsupported-schema');
  assert.equal(p.status.actualSchema, 'trivium.review.v1');
  assert.equal(p.findings.length, 0);
  assert.match(p.status.notice ?? '', /不支持/);
  const p2 = parseReviewFile('review-claude-20260101T000000Z.json', reviewJson([baseFinding()], 'trivium.review.v3'));
  assert.equal(p2.status.state, 'unsupported-schema');
});

test('unrecognized：命名不匹配', () => {
  const p = parseReviewFile('whatever.json', reviewJson([baseFinding()]));
  assert.equal(p.status.state, 'unrecognized');
});

test('标签与计数工具', () => {
  assert.equal(severityLabel('blocker'), '阻断');
  assert.equal(verdictLabel('pass-after-changes'), '修改后通过');
  assert.equal(verdictLabel(null), '未知');
  const reviews: ParsedReview[] = [
    parseReviewFile('review-a-20260101T000000Z.json', reviewJson([baseFinding(), { ...baseFinding(), severity: 'nit' }])),
    parseReviewFile('review-b-20260101T000000Z.json', reviewJson([{ ...baseFinding(), severity: 'minor' }])),
  ];
  const c = countSeverities(reviews);
  assert.equal(c.major, 1);
  assert.equal(c.nit, 1);
  assert.equal(c.minor, 1);
  assert.equal(c.blocker, 0);
});

test('枚举表外值（layer/kind/confidence）→ 跳过计数（CLAUDE-10）', () => {
  const bad1 = { ...baseFinding(), layer: '架构' };
  const bad2 = { ...baseFinding(), kind: 'style' };
  const bad3 = { ...baseFinding(), confidence: 'certain' };
  const good = { ...baseFinding(), id: 'TEST-09' };
  const p = parseReviewFile('review-claude-20260101T000000Z.json', reviewJson([bad1, bad2, bad3, good]));
  assert.equal(p.status.state, 'partial-skipped');
  assert.equal(p.status.skippedCount, 3);
  assert.equal(p.findings.length, 1);
});

test('根字段损坏（CLAUDE-06）：findings 缺/非数组、verdict 缺、summary 缺 → parse-error 明示', () => {
  const missing = JSON.stringify({ schema: 'trivium.review.v2', verdict: 'pass', summary: 's' });
  const p1 = parseReviewFile('review-claude-20260101T000000Z.json', missing);
  assert.equal(p1.status.state, 'parse-error');
  assert.match(p1.status.notice ?? '', /findings/);
  const notArray = JSON.stringify({ schema: 'trivium.review.v2', verdict: 'pass', summary: 's', findings: 'x' });
  assert.equal(parseReviewFile('review-claude-20260101T000000Z.json', notArray).status.state, 'parse-error');
  const noVerdict = JSON.stringify({ schema: 'trivium.review.v2', summary: 's', findings: [] });
  const p3 = parseReviewFile('review-claude-20260101T000000Z.json', noVerdict);
  assert.equal(p3.status.state, 'parse-error');
  assert.match(p3.status.notice ?? '', /verdict/);
  const noSummary = JSON.stringify({ schema: 'trivium.review.v2', verdict: 'pass', findings: [] });
  const p4 = parseReviewFile('review-claude-20260101T000000Z.json', noSummary);
  assert.equal(p4.status.state, 'parse-error');
  assert.match(p4.status.notice ?? '', /summary/);
});
