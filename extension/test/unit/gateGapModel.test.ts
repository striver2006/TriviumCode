/**
 * gate 缺口模型单测（r2 计划 D9）：首写/修复两形态建表、fallback 期望集、
 * 只读行推导、joint_blocker 分组、真实 m9 bad_front_matter 夹具。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGapModel } from '../../src/disposition/gateGapModel';
import type { GateCheckOutput } from '../../src/cli/commands';
import type { RunMetaInfo } from '../../src/disposition/runMeta';

function check(partial: Partial<GateCheckOutput>): GateCheckOutput {
  return {
    ok: false,
    stage: 'plan',
    rerun_index: 1,
    run_id: '20261107T000000Z',
    failures: [],
    warnings: [],
    structured_ids: [],
    fallback_ids: [],
    degraded_ids: [],
    disposition: null,
    review_loop: { round: 1, max_rounds: 5 },
    round_verdict: null,
    next_action: null,
    round_line: null,
    ...partial,
  };
}

const META = (over: Partial<RunMetaInfo> = {}): RunMetaInfo => ({
  runId: '20261107T000000Z',
  driver: 'glm',
  rerunIndex: 1,
  criticsSelected: ['claude', 'gemini', 'codex'],
  criticStatus: { claude: 'ok', gemini: 'ok', codex: 'ok' },
  artifacts: [],
  ...over,
});

test('首写形态：missing_disposition 提前返回——structured/degraded/fallback 期望集全部进表单', () => {
  const model = buildGapModel({
    check: check({
      failures: [{ code: 'missing_disposition', message: '缺少裁决件' }],
      // 提前返回：fallback_ids 恒空、无 missing_findings（gate.ts:360-382）
      structured_ids: ['CLAUDE-01', 'AGY-01'],
      degraded_ids: ['CODEX-06'],
      fallback_ids: [],
    }),
    topic: 'T',
    stage: 'plan',
    meta: META(),
    fallbackExpected: ['AGY-F01', 'AGY-F02'], // 来自 .fallback-items.md，不是 check.fallback_ids
    driver: { driver: 'glm', source: 'run-meta' },
    addresses: ['2026-11-07-T-claude.md'],
    existingRows: [],
  });
  assert.equal(model.form, 'draft');
  assert.deepEqual(
    model.items.map((i) => i.id),
    ['AGY-01', 'AGY-F01', 'AGY-F02', 'CLAUDE-01', 'CODEX-06'],
  );
  // fallback 行：requireAction=false（checkRow 第二参数，CLAUDE-11）；结构化行 true
  assert.equal(model.items.find((i) => i.id === 'AGY-F01')!.requireAction, false);
  assert.equal(model.items.find((i) => i.id === 'CLAUDE-01')!.requireAction, true);
  // 前缀映射（AGY=gemini 经 agy 适配）
  assert.equal(model.items.find((i) => i.id === 'AGY-01')!.critic, 'gemini');
  assert.equal(model.items.find((i) => i.id === 'AGY-F01')!.origin, 'fallback');
  assert.equal(model.readonlyRows.length, 0);
});

test('修复形态：新增行 + 修复行进表单，已合法行只读保留', () => {
  const model = buildGapModel({
    check: check({
      disposition: '/x/.reviews/T/plan/2026-11-07-T-revised-glm.md',
      failures: [
        { code: 'missing_findings', message: '缺裁', ids: ['CLAUDE-02'] },
        { code: 'empty_reason', message: '理由为空', ids: ['CLAUDE-01'] },
        { code: 'missing_action', message: '缺落点', ids: ['AGY-01'] },
        { code: 'unknown_findings', message: '多余', ids: ['GLM-99'] },
      ],
      structured_ids: ['CLAUDE-01', 'CLAUDE-02', 'CLAUDE-03', 'AGY-01'],
      fallback_ids: ['CLAUDE-01', 'CLAUDE-03', 'AGY-01'], // 表里已有行
    }),
    topic: 'T',
    stage: 'plan',
    meta: META(),
    fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' },
    addresses: [],
    existingRows: [
      { id: 'CLAUDE-01', verdict: '接受', reason: '', action: '' }, // 理由空 → 修复行
      { id: 'CLAUDE-03', verdict: '驳回', reason: '不成立', action: null }, // 合法 → 只读
      { id: 'AGY-01', verdict: '接受', reason: '成立', action: '' }, // 缺落点 → 修复行
      { id: 'GLM-99', verdict: '接受', reason: 'x', action: null }, // 多余 → 修复行（删）
    ],
  });
  assert.equal(model.form, 'repair');
  assert.deepEqual(
    model.items.map((i) => i.id).sort(),
    ['AGY-01', 'CLAUDE-01', 'CLAUDE-02', 'GLM-99'],
  );
  // 修复行预填现有内容 + problemNote
  const fixRow = model.items.find((i) => i.id === 'CLAUDE-01')!;
  assert.equal(fixRow.existing?.verdict, '接受');
  assert.ok(fixRow.problemNote!.includes('理由'));
  // 只读行：CLAUDE-03（合法保留，不进表单）
  assert.deepEqual(model.readonlyRows.map((r) => r.id), ['CLAUDE-03']);
  assert.equal(model.readonlyRows[0]!.reason, '不成立');
});

test('defer_not_allowed 命中 → 该行禁选暂缓', () => {
  const model = buildGapModel({
    check: check({
      disposition: '/x/revised.md',
      failures: [{ code: 'defer_not_allowed', message: '不允许暂缓', ids: ['CLAUDE-01'] }],
      structured_ids: ['CLAUDE-01', 'CLAUDE-02'],
      fallback_ids: [],
    }),
    topic: 'T',
    stage: 'code',
    meta: META(),
    fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' },
    addresses: [],
    existingRows: [
      { id: 'CLAUDE-01', verdict: '暂缓', reason: '等等', action: null },
      { id: 'CLAUDE-02', verdict: '接受', reason: 'x', action: null }, // 已合法 → 只读行
    ],
  });
  assert.equal(model.items.find((i) => i.id === 'CLAUDE-01')!.deferAllowed, false);
  // CLAUDE-02 已合法 → 只读行，不进表单（禁选暂缓只约束表单行）
  assert.equal(model.items.filter((i) => i.id === 'CLAUDE-02').length, 0);
  assert.deepEqual(model.readonlyRows.map((r) => r.id), ['CLAUDE-02']);
});

test('joint_blocker_rejected：hard 策略 failure 进修复行；plan 类缺口单列不进表单', () => {
  const model = buildGapModel({
    check: check({
      disposition: '/x/revised.md',
      failures: [
        { code: 'joint_blocker_rejected', message: '共同 blocker 被驳回', ids: ['CLAUDE-01', 'AGY-01'] },
        { code: 'missing_next_plan', message: '缺新一轮计划 2026-11-07-T-r2-glm.md', ids: ['CLAUDE-02'] },
      ],
      structured_ids: ['CLAUDE-01', 'CLAUDE-02', 'AGY-01'],
      fallback_ids: [],
    }),
    topic: 'T',
    stage: 'plan',
    meta: META(),
    fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' },
    addresses: [],
    existingRows: [],
  });
  assert.ok(model.items.some((i) => i.id === 'CLAUDE-01' && i.problemNote!.includes('blocker')));
  assert.equal(model.planGaps.length, 1);
  assert.deepEqual(model.planGaps[0]!.ids, ['CLAUDE-02']);
  assert.equal(model.items.filter((i) => i.id === 'CLAUDE-02').length, 0, '计划类编号不进裁决表单');
});

test('真实 m9 夹具形态：bad_front_matter（role 不匹配并进 message）→ 结构类整卡', () => {
  const model = buildGapModel({
    // 取自 doc/05_testing/evidence/m9-acceptance-20260919/hook-and-gate-outputs.md 的真实形态
    check: check({
      stage: 'code',
      run_id: '20260919T120643Z',
      failures: [
        {
          code: 'bad_front_matter',
          message: '裁决件 front-matter 与本轮不匹配：role=claude（当轮 Driver 是 codex；文件名后缀与 front-matter 的 role 必须同指一人）',
        },
      ],
      structured_ids: ['CLAUDE-01', 'CLAUDE-02'],
      fallback_ids: [],
      disposition: '<FX>/.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-response-codex.md',
    }),
    topic: 'M9-验收-3812f4c',
    stage: 'code',
    meta: META({ driver: 'codex' }),
    fallbackExpected: [],
    driver: { driver: 'codex', source: 'run-meta' },
    addresses: [],
    existingRows: [],
  });
  assert.equal(model.form, 'repair');
  assert.equal(model.structural.length, 1);
  assert.equal(model.structural[0]!.code, 'bad_front_matter');
  assert.ok(model.structural[0]!.message.includes('role=claude'));
});

test('任务书点名的 Phase2 计划审 r1 缺口形态（三缺构造）', () => {
  // gate.ts:391/458-463/582-589/616-621 构造模板手工还原：bad_front_matter 三处不匹配
  // + unparsable_table + missing_findings 逐条编号
  const model = buildGapModel({
    check: check({
      failures: [
        {
          code: 'bad_front_matter',
          message:
            '裁决件 front-matter 与本轮不匹配：\n  schema=（缺）应为 trivium.disposition.v1\n  topic=别的主题 应为 VSCode插件Phase2\n  role=claude（当轮 Driver 是 glm）',
        },
        { code: 'unparsable_table', message: '裁决表不可解析（本轮有 4 条意见待裁决）：第 7 行：列数不足' },
        { code: 'missing_findings', message: '下列意见没有裁决，必须逐条给出', ids: ['CLAUDE-05', 'CLAUDE-09', 'AGY-01', 'AGY-03', 'CODEX-01'] },
      ],
      structured_ids: ['CLAUDE-05', 'CLAUDE-09', 'AGY-01', 'AGY-03', 'CODEX-01'],
      fallback_ids: [],
      disposition: '/x/.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-revised-glm.md',
    }),
    topic: 'VSCode插件Phase2',
    stage: 'plan',
    meta: META(),
    fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' },
    addresses: [],
    existingRows: [],
  });
  assert.equal(model.structural.length, 2);
  assert.deepEqual(
    model.structural.map((s) => s.code),
    ['bad_front_matter', 'unparsable_table'],
  );
  assert.deepEqual(
    model.items.map((i) => i.id),
    ['AGY-01', 'AGY-03', 'CLAUDE-05', 'CLAUDE-09', 'CODEX-01'],
  );
});

// ── 代码审 r1 修复回归（CLAUDE-02/11、AGY-01、CODEX-06）──

test('unknown_findings 行标记 removeable（表单删除语义）', () => {
  const model = buildGapModel({
    check: check({
      disposition: '/x/r.md',
      failures: [{ code: 'unknown_findings', message: '多余编号', ids: ['GLM-99'] }],
      structured_ids: ['CLAUDE-01'],
      fallback_ids: ['CLAUDE-01'],
    }),
    topic: 'T', stage: 'code', meta: META(), fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' }, addresses: [],
    existingRows: [{ id: 'GLM-99', verdict: '接受', reason: 'x', action: null }],
  });
  assert.equal(model.items.find((i) => i.id === 'GLM-99')!.removeable, true);
  assert.equal(model.items.find((i) => i.id === 'GLM-99')!.problemNote!.includes('删除'), true);
});

test('文件名轮次：check.rerun_index 是第一事实源（review_loop=null + meta=null 不丢 -rN，CLAUDE-11）', () => {
  const model = buildGapModel({
    check: check({ rerun_index: 2, review_loop: null, failures: [{ code: 'missing_disposition', message: 'x' }], structured_ids: ['CLAUDE-01'] }),
    topic: 'T', stage: 'code', meta: null, fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' }, addresses: [], existingRows: [],
  });
  assert.equal(model.rerunIndex, 2);
  const fromMeta = buildGapModel({
    check: check({ rerun_index: 0, review_loop: null, failures: [{ code: 'missing_disposition', message: 'x' }], structured_ids: [] }),
    topic: 'T', stage: 'code', meta: META({ rerunIndex: 3 }), fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' }, addresses: [], existingRows: [],
  });
  assert.equal(fromMeta.rerunIndex, 3, 'check 无有效值时回落 run 元数据');
});

// ── 代码审 r3/r4 修复回归 ──

test('零意见首写：draft 且期望集真空 → 允许生成（emptyDraft，r3 CLAUDE-03/CODEX-06）', () => {
  const model = buildGapModel({
    check: check({ failures: [{ code: 'missing_disposition', message: 'x' }], structured_ids: [], degraded_ids: [], fallback_ids: [] }),
    topic: 'T', stage: 'code', meta: META(), fallbackExpected: [],
    driver: { driver: 'glm', source: 'run-meta' }, addresses: ['a-claude.md'], existingRows: [],
  });
  assert.equal(model.items.length, 0);
  // 宿主 validateDesk 的 emptyDraft 例外由集成测试覆盖；此处锁定模型语义
});
