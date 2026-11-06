/** annotationModel 单测（r2 计划 D3′/D9′） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnotationModels, severityToDiagLevel, driftNotesOf, findingsSummary, type ResolvedFinding } from '../../src/reviews/annotationModel';
import type { ReviewFinding, ParsedReview } from '../../src/reviews/reviewParse';
import { parseReviewFile } from '../../src/reviews/reviewParse';
import { CONSISTENCY_UNKNOWN, type LocationResolution } from '../../src/reviews/locationResolve';

function finding(id: string, severity: ReviewFinding['severity'], loc = 'src/a.ts:3'): ReviewFinding {
  return { id, severity, layer: 'code', kind: 'correctness', location: loc, problem: `问题 ${id}`, evidence: '证据', suggestion: '建议', confidence: 'high' };
}

function reso(relPath: string, start: number, end: number, extra?: Partial<LocationResolution>): LocationResolution {
  return {
    kind: 'file',
    anchors: [{ relPath, raw: { start, end }, level: start > 0 ? 'line' : 'file', line: start > 0 ? { start, end } : null, drift: null, label: null }],
    missingRelPath: null,
    consistency: CONSISTENCY_UNKNOWN,
    ...extra,
  };
}

function rf(critic: string, f: ReviewFinding, resolution: LocationResolution): ResolvedFinding {
  return { critic, runId: '20260101T000000Z', finding: f, resolution };
}

const OPTS = { enabledCritics: null, maxThreadsPerFile: 200, maxTotalFindings: 2000 };

test('severity 映射四档（FR-6c）', () => {
  assert.equal(severityToDiagLevel('blocker'), 'error');
  assert.equal(severityToDiagLevel('major'), 'error');
  assert.equal(severityToDiagLevel('minor'), 'warning');
  assert.equal(severityToDiagLevel('nit'), 'information');
});

test('同行多侧多 finding → 同 thread 多 comment（分层不覆盖）', () => {
  const out = buildAnnotationModels(
    [
      rf('claude', finding('C-01', 'major'), reso('src/a.ts', 3, 3)),
      rf('claude', finding('C-02', 'nit'), reso('src/a.ts', 3, 3)),
      rf('gemini', finding('G-01', 'blocker'), reso('src/a.ts', 3, 3)),
    ],
    OPTS,
  );
  assert.equal(out.threads.length, 1);
  const t = out.threads[0]!;
  assert.equal(t.comments.length, 3);
  assert.deepEqual(t.comments.map((c) => c.critic), ['claude', 'claude', 'gemini']);
  assert.match(t.label, /claude 2 条/);
  assert.match(t.label, /gemini 1 条/);
  // 诊断逐 finding 一条，与线程同区间
  assert.equal(out.diagnostics.length, 3);
  for (const d of out.diagnostics) {
    assert.equal(d.startLine, 3);
    assert.equal(d.endLine, 3);
  }
});

test('区间贯通：多行 location 的 thread/诊断同源（CLAUDE-05）', () => {
  const out = buildAnnotationModels([rf('claude', finding('C-01', 'major'), reso('src/a.ts', 23, 29))], OPTS);
  assert.equal(out.threads[0]!.startLine, 23);
  assert.equal(out.threads[0]!.endLine, 29);
  assert.equal(out.diagnostics[0]!.startLine, 23);
  assert.equal(out.diagnostics[0]!.endLine, 29);
});

test('文件级（无行号/漂移）→ 首行区间 + ⚠ 标注', () => {
  const r: LocationResolution = {
    kind: 'file',
    anchors: [{ relPath: 'src/a.ts', raw: null, level: 'file', line: null, drift: 'out-of-range', label: '行号越界，降为文件级' }],
    missingRelPath: null,
    consistency: CONSISTENCY_UNKNOWN,
  };
  const out = buildAnnotationModels([rf('claude', finding('C-01', 'major'), r)], OPTS);
  assert.equal(out.threads[0]!.startLine, 1);
  assert.match(out.threads[0]!.label, /文件级/);
  assert.match(out.diagnostics[0]!.message, /行号越界/);
});

test('一致性标注进线程与诊断（CLAUDE-01/CODEX-02）', () => {
  const r: LocationResolution = { ...reso('src/a.ts', 3, 3), consistency: { state: 'mismatch', note: null } };
  const rf1 = rf('claude', finding('C-01', 'major'), r);
  const notes = driftNotesOf(rf1);
  assert.ok(notes.some((n) => n.includes('与送审版本不一致')));
  const out = buildAnnotationModels([rf1], OPTS);
  assert.match(out.diagnostics[0]!.message, /与送审版本不一致/);
  const r2: LocationResolution = { ...reso('src/a.ts', 3, 3), consistency: { state: 'edited', note: null } };
  assert.ok(driftNotesOf(rf('claude', finding('C-02', 'minor'), r2)).some((n) => n.includes('文件已在批注挂载后被编辑')));
});

test('doc/outside/missing → listOnly（不建 VS Code 对象）', () => {
  const doc: LocationResolution = { kind: 'doc', anchors: [], missingRelPath: null, consistency: CONSISTENCY_UNKNOWN };
  const outside: LocationResolution = { kind: 'outside', anchors: [], missingRelPath: null, consistency: CONSISTENCY_UNKNOWN };
  const missing: LocationResolution = { kind: 'missing-file', anchors: [], missingRelPath: 'src/gone.ts', consistency: CONSISTENCY_UNKNOWN };
  const out = buildAnnotationModels(
    [rf('claude', finding('C-01', 'major', 'plan §3.2'), doc), rf('claude', finding('C-02', 'major', '../x.ts:1'), outside), rf('claude', finding('C-03', 'minor', 'src/gone.ts:9'), missing)],
    OPTS,
  );
  assert.equal(out.threads.length, 0);
  assert.equal(out.diagnostics.length, 0);
  assert.equal(out.listOnly.length, 3);
  assert.match(out.listOnly[2]!.reason, /src\/gone\.ts/);
});

test('逐家开关：过滤后重建（enabledCritics）', () => {
  const data = [rf('claude', finding('C-01', 'major'), reso('src/a.ts', 3, 3)), rf('gemini', finding('G-01', 'minor'), reso('src/a.ts', 4, 4))];
  const off = buildAnnotationModels(data, { ...OPTS, enabledCritics: new Set(['claude']) });
  assert.equal(off.diagnostics.length, 1);
  assert.equal(off.diagnostics[0]!.code, 'C-01');
  const all = buildAnnotationModels(data, { ...OPTS, enabledCritics: new Set() }); // 空集合 = 全部
  assert.equal(all.diagnostics.length, 2);
});

test('量级控制：单文件线程上限溢出（D8′）', () => {
  const data: ResolvedFinding[] = [];
  for (let i = 1; i <= 5; i++) data.push(rf('claude', finding(`C-${String(i).padStart(2, '0')}`, 'minor', `src/a.ts:${i}`), reso('src/a.ts', i, i)));
  const out = buildAnnotationModels(data, { ...OPTS, maxThreadsPerFile: 3 });
  assert.equal(out.threads.length, 3);
  assert.equal(out.diagnostics.length, 5); // 诊断仍全量
  assert.deepEqual(out.overflow, [{ file: 'src/a.ts', count: 2 }]);
});

test('量级控制：scope 总量超限 → 仅诊断（D8′）', () => {
  const data: ResolvedFinding[] = [];
  for (let i = 1; i <= 5; i++) data.push(rf('claude', finding(`C-${String(i).padStart(2, '0')}`, 'minor', `src/a.ts:${i}`), reso('src/a.ts', i, i)));
  const out = buildAnnotationModels(data, { ...OPTS, maxTotalFindings: 4 });
  assert.equal(out.threads.length, 0);
  assert.equal(out.diagnostics.length, 5);
});

test('findingsSummary：逐侧摘要（驾驶舱/历史树共用）', () => {
  const mk = (name: string, text: string): ParsedReview => parseReviewFile(name, text);
  const c = mk('review-claude-20260101T000000Z.json', JSON.stringify({
    schema: 'trivium.review.v2', verdict: 'pass-after-changes', summary: 's',
    findings: [finding('C-01', 'blocker'), finding('C-02', 'nit')],
  }));
  const g = mk('review-gemini-20260101T000000Z.json', JSON.stringify({
    schema: 'trivium.review.v1', verdict: 'pass', summary: 's', findings: [finding('G-01', 'minor')],
  }));
  const out = findingsSummary([c, g]);
  assert.equal(out[0]!.critic, 'claude');
  assert.equal(out[0]!.counts.blocker, 1);
  assert.equal(out[0]!.counts.nit, 1);
  assert.equal(out[0]!.state, 'ok');
  assert.equal(out[1]!.state, 'unsupported-schema'); // 降级态贯通（CLAUDE-06）
  assert.ok(out[1]!.notice);
});

test('totalSuppressed：总量超限标志（CLAUDE-11 提示依据）', () => {
  const data: ResolvedFinding[] = [];
  for (let i = 1; i <= 5; i++) data.push(rf('claude', finding(`C-${String(i).padStart(2, '0')}`, 'minor', `src/a.ts:${i}`), reso('src/a.ts', i, i)));
  const out = buildAnnotationModels(data, { ...OPTS, maxTotalFindings: 4 });
  assert.equal(out.totalSuppressed, true);
  assert.equal(out.threads.length, 0);
  const ok = buildAnnotationModels(data, OPTS);
  assert.equal(ok.totalSuppressed, false);
});
