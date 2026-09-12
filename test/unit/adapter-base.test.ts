import { test } from 'node:test';
import { modelEncodesEffort } from '../../src/trivium/adapters/agy.js';
import assert from 'node:assert/strict';
import {
  checkEvidence,
  checkPeerLeak,
  routeModel,
  isHeterogeneous,
  failedResult,
} from '../../src/trivium/adapters/base.js';
import { defaultConfig } from '../../src/trivium/config.js';

const REQ = {
  min_tool_calls: 5,
  min_project_reads: 3,
  subject_path: '/proj/.reviews/t/plan/2026-09-10-t-claude.md',
  brief_path: '/proj/.reviews/t/plan/_meta/brief-gemini-R1.md',
  project_root: '/proj',
};
const OPTS = { archiveRootAbs: '/proj/.reviews' };

test('项目文件读取只算项目根之内的：读 ~/ 下的无关文件不能凑数（AC-11）', () => {
  const r = checkEvidence(
    {
      tool_calls: { read: 6, grep: 2 },
      read_paths: ['/Users/x/.zshrc', '/etc/hosts', '/proj/src/a.ts', './src/b.ts', REQ.subject_path],
      trace_path: '/runs/trace.jsonl',
    },
    REQ,
    OPTS,
  );
  assert.equal(r.projectReads, 2, '只有 /proj/src/a.ts 与 ./src/b.ts 算项目内读取');
});

test('禁读核对做路径归一化：./ 前缀、.. 与 macOS 的 /private 前缀都能命中', () => {
  const deny = ['.reviews/t/plan/2026-09-10-t-glm.md'];
  const r = checkPeerLeak(
    ['./.reviews/t/plan/2026-09-10-t-glm.md', '/private/proj/src/../.reviews/t/plan/2026-09-10-t-glm.md'],
    deny,
    '/proj',
  );
  assert.equal(r.leaked, true);
  assert.equal(r.hits.length, 2);
  assert.equal(checkPeerLeak(['/proj/src/a.ts'], deny, '/proj').leaked, false);
});

test('证据充分时通过', () => {
  const r = checkEvidence(
    {
      tool_calls: { read: 6, grep: 2 },
      read_paths: ['/proj/src/a.ts', '/proj/src/b.ts', '/proj/doc/x.md', REQ.subject_path],
      trace_path: '/runs/trace.jsonl',
    },
    REQ,
    OPTS,
  );
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.projectReads, 3);
});

test('零工具调用判 no_trace（Antigravity 软拒绝的表现，AC-05 落点）', () => {
  const r = checkEvidence({ tool_calls: {}, read_paths: [], trace_path: null }, REQ, OPTS);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith('no_trace')));
});

test('工具调用数不足下限判 insufficient_evidence', () => {
  const r = checkEvidence(
    { tool_calls: { read: 2 }, read_paths: ['/proj/src/a.ts'], trace_path: 't' },
    REQ,
    OPTS,
  );
  assert.ok(r.reasons.some((x) => x.startsWith('insufficient_evidence')));
});

test('把 BRIEF 与被审对象反复读也过不了项目文件下限（AC-11 的防绕过）', () => {
  const r = checkEvidence(
    {
      // 工具调用总数达标，但读的全是送审材料自己
      tool_calls: { read: 10 },
      read_paths: [REQ.subject_path, REQ.brief_path],
      trace_path: 't',
    },
    REQ,
    OPTS,
  );
  assert.equal(r.ok, false);
  assert.equal(r.projectReads, 0);
  assert.ok(r.reasons.some((x) => x.startsWith('no_project_context')));
});

test('归档根内的文件不计入项目上下文', () => {
  const r = checkEvidence(
    {
      tool_calls: { read: 8 },
      read_paths: [
        '/proj/.reviews/t/plan/2026-09-10-t-gemini.md',
        '/proj/.reviews/t/task.json',
        '/proj/src/only-one.ts',
      ],
      trace_path: 't',
    },
    REQ,
    OPTS,
  );
  assert.equal(r.projectReads, 1, '只有 src/only-one.ts 算项目上下文');
});

test('轨迹核验：绝对路径与相对路径两种形态都能命中禁读清单（AC-04）', () => {
  const deny = ['.reviews/t/plan/2026-09-10-t-glm.md', '.env'];
  const abs = checkPeerLeak(['/proj/.reviews/t/plan/2026-09-10-t-glm.md'], deny, '/proj');
  assert.equal(abs.leaked, true);
  assert.deepEqual(abs.hits, ['/proj/.reviews/t/plan/2026-09-10-t-glm.md']);

  const rel = checkPeerLeak(['.env'], deny, '/proj');
  assert.equal(rel.leaked, true);
});

test('轨迹核验：读己方产出不算泄漏', () => {
  const deny = ['.reviews/t/plan/2026-09-10-t-glm.md'];
  const r = checkPeerLeak(
    ['/proj/.reviews/t/plan/2026-09-10-t-gemini.md', '/proj/src/a.ts'],
    deny,
    '/proj',
  );
  assert.equal(r.leaked, false);
});

test('模型路由四级优先级：命令行 > 主题 > profile', () => {
  const cfg = defaultConfig();
  assert.deepEqual(routeModel(cfg, 'gemini', 'plan', { cli: 'X', topic: 'Y' }), {
    model: 'X',
    source: 'cli',
  });
  assert.deepEqual(routeModel(cfg, 'gemini', 'plan', { topic: 'Y' }), {
    model: 'Y',
    source: 'topic',
  });
  assert.deepEqual(routeModel(cfg, 'gemini', 'plan'), {
    model: 'gemini-3.8-flash-high',
    source: 'profile',
  });
  assert.deepEqual(routeModel(cfg, 'glm', 'code'), { model: 'GLM-5.3', source: 'profile' });
});

test('模型路由：profile 缺该阶段时返回 none 而非瞎猜', () => {
  const cfg = defaultConfig();
  cfg.profiles['bare'] = { gemini: {} };
  cfg.active_profile = 'bare';
  assert.deepEqual(routeModel(cfg, 'gemini', 'plan'), { model: null, source: 'none' });
});

test('异构判定：Claude 系为同源，需显式标记（FR-17 / AC-18）', () => {
  assert.equal(isHeterogeneous('gemini-3.1-pro-high'), true);
  assert.equal(isHeterogeneous('GLM-5.3'), true);
  assert.equal(isHeterogeneous('claude-sonnet-4-6'), false);
  assert.equal(isHeterogeneous('claude-opus-4-6-thinking'), false);
  assert.equal(isHeterogeneous(null), true);
});

test('默认 profile 两侧互不相同且均为非 Claude 系（AC-18）', () => {
  const cfg = defaultConfig();
  for (const stage of ['plan', 'code', 'bug'] as const) {
    const g = routeModel(cfg, 'gemini', stage).model;
    const z = routeModel(cfg, 'glm', stage).model;
    assert.ok(g && z, `${stage} 两侧都应有默认模型`);
    assert.notEqual(g, z, `${stage} 两侧默认模型不应相同——相同模型 + 相同镜头只是把成本乘二`);
    assert.equal(isHeterogeneous(g), true, `${stage} gemini 侧应为非 Claude 系`);
    assert.equal(isHeterogeneous(z), true, `${stage} glm 侧应为非 Claude 系`);
  }
});

test('失败结果构造：evidence_ok 恒为 false，字段不漏', () => {
  const r = failedResult('glm', { status: 'timeout', reason: '超时', exitCode: null, durationS: 1200 });
  assert.equal(r.critic, 'glm');
  assert.equal(r.status, 'timeout');
  assert.equal(r.evidence_ok, false);
  assert.equal(r.review_json, null);
  assert.equal(r.model_effective_source, 'unverified');
  assert.equal(r.peer_deny_applied, false);
  assert.equal(r.fail_reason, '超时');
});

// ── agy 的 --effort 与模型 slug 冲突（坑 P-16，实测踩到）──

test('模型 slug 自带档位时不再传 --effort', () => {
  // agy 1.2.0：`--model gemini-3.8-flash-high --effort medium` 会被直接拒绝
  assert.equal(modelEncodesEffort('gemini-3.8-flash-high'), true);
  assert.equal(modelEncodesEffort('gemini-3.1-pro-low'), true);
  assert.equal(modelEncodesEffort('gpt-oss-120b-medium'), true);
});

test('不带档位的 slug 仍需要 --effort', () => {
  assert.equal(modelEncodesEffort('claude-sonnet-4-6'), false);
  assert.equal(modelEncodesEffort('claude-opus-4-6-thinking'), false);
  assert.equal(modelEncodesEffort(null), false);
});

test('档位只认结尾，中间出现 high/low 不算', () => {
  assert.equal(modelEncodesEffort('gemini-high-pro'), false);
  assert.equal(modelEncodesEffort('some-lowercase'), false);
});
