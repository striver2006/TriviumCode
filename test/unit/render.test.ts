import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderReviewDoc, parseFrontMatter, countSeverities,
} from '../../src/trivium/render.js';
import type { RenderInput } from '../../src/trivium/render.js';
import { CRITICS, type CriticResult, type ReviewV2 } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const RESULT: CriticResult = {
  critic: 'gemini', status: 'ok', exit_code: 0, duration_s: 472.4,
  raw_stdout_path: '/runs/out', trace_path: '/runs/trace', review_json: null,
  raw_response_text: '{}', model_effective: 'gemini-3.1-pro-high',
  model_effective_source: 'envelope', model_provider: null, profile_requested: null,
  tool_calls: { read: 27, grep: 9 },
  read_paths: [], search_hit_paths: null, write_events: [], command_texts: [], evidence_ok: true, fail_reason: null,
  session_id: 'conv-1', cli_version: '1.2.0', peer_deny_applied: false,
  deny_skipped: 0, deny_rule_count: 0, deny_bytes: 0,
  command_line: 'agy -p …',
};

const REVIEW: ReviewV2 = {
  schema: 'trivium.review.v2',
  verdict: 'pass-after-changes',
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
    effortRequested: 'high', effortEffective: 'high', effortEffectiveSource: 'envelope', tier: null, tierSource: 'legacy',
    snapshotHash: 'sha256:8c1f', startedAt: '2026-09-10T14:23:10+08:00',
    finishedAt: '2026-09-10T14:31:02+08:00', evidenceOk: true, projectReads: 21,
    selectedCritics: CRITICS,
    degraded: false, drift: false, peerDeny: false, consultedUnverified: false,
    heterogeneous: true, ...over,
  };
}

test('front-matter 可被 YAML 解析，且关键机读字段齐备', () => {
  const fm = parseFrontMatter(renderReviewDoc(input()));
  assert.ok(fm);
  assert.equal(fm!['schema'], 'trivium.review.v2');
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

test('请求模型与未验证模型不能出现在回读列或正文回读标题', () => {
  for (const source of ['requested', 'unverified'] as const) {
    const md = renderReviewDoc(input({ result: { ...RESULT, model_effective: 'qwen3.8-flash', model_effective_source: source }, modelRequested: 'qwen3.8-flash' }));
    const fm = parseFrontMatter(md)!;
    assert.equal(fm['model_effective'], null);
    assert.equal(fm['model_effective_source'], 'unverified');
    assert.ok(md.includes('回读模型 `未知`'));
    assert.ok(md.includes('请求模型 `qwen3.8-flash`'));
  }
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
  assert.ok(md.includes('本次为降级轮次'));
  assert.equal(parseFrontMatter(md)!['degraded'], true);
});

/*
 * 参与者事实与降级警示是**两件事**（设计 §3.4 / AC-22）。
 *
 * 旧渲染只有一个降级横幅，文案写着「另一侧未能完成」：
 *   · 只入选一侧并成功时，它是**假话**——没有任何一侧失败，却打降级横幅；
 *   · 反过来若因此不打任何标记，读者又看不出这份结论只有一侧背书。
 * 所以中性的「本轮审核者」始终渲染，降级横幅只在真降级时出现。
 */
test('入选一侧并成功：渲染参与者事实，但不打降级横幅', () => {
  const md = renderReviewDoc(input({ selectedCritics: ['gemini'], degraded: false }));
  assert.ok(md.includes('本轮审核者 gemini'), '必须让读者看见本轮只审了一侧');
  assert.ok(!md.includes('本次为降级轮次'), '选 1 审是配置意图，不是降级');
  assert.equal(parseFrontMatter(md)!['degraded'], false);
});

test('参与者事实在降级轮次里照样渲染，两个标记并存不互相顶替', () => {
  const md = renderReviewDoc(input({ selectedCritics: CRITICS, degraded: true }));
  assert.ok(md.includes(`本轮审核者 ${CRITICS.join('、')}`));
  assert.ok(md.includes('本次为降级轮次'));
});

test('降级文案不得再出现「另一侧」这种只对两侧成立的指代', () => {
  const md = renderReviewDoc(input({ selectedCritics: CRITICS, degraded: true }));
  assert.ok(!md.includes('另一侧'), '三审挂一侧时「另一侧」指代不清');
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
    heterogeneous: 'same-family', overrideReason: '用户显式指定',
    modelRequested: 'claude-sonnet-4-6',
  }));
  assert.ok(md.includes('模型族 same-family'));
  assert.ok(md.includes('用户显式指定'));
  const fm = parseFrontMatter(md)!;
  assert.equal(fm['heterogeneous'], 'same-family');
  assert.equal(fm['override_reason'], '用户显式指定');
});

test('同源旗标不写死 Claude 系（EV-62）', () => {
  /*
   * 判据改为按当轮 Driver 厂商的名义模型族之后，同源的那一侧未必是 Claude 系：
   * Driver 为 Codex 时，gemini 侧经显式覆盖跑 gpt-* 也会判同族。旗标若仍写
   * 「本侧使用了 Claude 系模型」，读的人会被带到错的方向上。
   */
  const reason = '用户经 --model-gemini 显式指定了与当轮 Driver（Codex）同族的模型';
  const md = renderReviewDoc(input({
    heterogeneous: 'unknown', overrideReason: reason,
    modelRequested: 'gpt-oss-120b-medium',
  }));
  assert.ok(md.includes('模型族 unknown'));
  assert.ok(md.includes(reason));
  assert.ok(!md.includes('Claude 系'), '同源旗标不得再写死「Claude 系」');
  // 这一格是按模型名的检出，不是同源的证明——标题不得写成确定性结论（代码双审 r5 CODEX-03）
  assert.ok(md.includes('告警继续'), 'unknown 不进入阻断');
});

test('零意见时文件照常渲染，并提示这不等于没审（FR-13）', () => {
  const md = renderReviewDoc(input({
    review: { ...REVIEW, findings: [], verdict: 'pass', summary: '未发现阻断性问题。' },
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

// ── 回归：已失败/超时的一侧不再报「证据不足」（真实运行中出现过的误导）──

test('回归：超时的一侧不产生证据不足告警，避免把真正原因埋在噪音里', async () => {
  const { judgeRun, renderGuardWarnings } = await import('../../src/trivium/guard.js');
  const { defaultConfig } = await import('../../src/trivium/config.js');
  const { failedResult } = await import('../../src/trivium/adapters/base.js');
  const path = await import('node:path');
  const { promises: fs } = await import('node:fs');
  const { initFixtureRepo, workTreeHash } = await import('../../src/trivium/util/git.js');

  const dir = await scratchDir('trivium-guardnoise-');
  await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(dir);
  const tree = await workTreeHash(dir);

  const req = {
    run_id: 'R', topic: 't', stage: 'plan' as const, critic: 'glm' as const,
    project_root: dir, subject_path: path.join(dir, 'a.ts'), deny_paths: [],
    out_dir: '/x', brief_path: '/b', brief_text: 'B', model: 'M',
    timeout_s: 900, schema_path: '/s', min_tool_calls: 5, min_project_reads: 3,
    profile_requested: null, tier: null, tier_source: null,
  };

  const v = await judgeRun({
    degraded: {},
    cfg: defaultConfig(),
    projectRoot: dir,
    archiveRootAbs: path.join(dir, '.reviews'),
    archiveRootRel: '.reviews',
    before: {
      gitHead: null, treeHash: tree, dirty: false, subjectSha256: 'S',
      subjectPath: req.subject_path, denyPaths: [], diffText: null, takenAt: 'now',
    },
    afterTreeHash: tree,
    afterSubjectSha256: 'S',
    relatedPaths: [],
    results: {
      glm: failedResult('glm', { status: 'timeout', reason: '脚本级超时（900s）' }),
    },
    reviews: { glm: null },
    requests: { glm: req },
  });

  assert.equal(v.sides.glm, undefined, '超时侧不应产出 SideVerdict');
  const warnings = renderGuardWarnings(v);
  assert.equal(
    warnings.some((w) => w.includes('证据不足')),
    false,
    `超时侧不该再报证据不足，实际告警：${warnings.join(' | ')}`,
  );
});

test('只读失守的告警包含可执行的人工核对命令，且明确不自动回滚', async () => {
  const { renderGuardWarnings } = await import('../../src/trivium/guard.js');
  const warnings = renderGuardWarnings({
    sides: {},
    drift: { kind: 'none' },
    driftAction: 'ok',
    fingerprintChangedFiles: [],
    unattributedDriftFiles: [],
    readonlyBreach: true,
    breachedFiles: ['write_to_file(/proj/src/x.ts)'],
    peerArtifactRead: false,
  });
  const w = warnings.join('\n');
  assert.match(w, /只读失守/);
  assert.match(w, /git status --porcelain -uall/);
  assert.match(w, /\*\*不会\*\*自动回滚/);
});
