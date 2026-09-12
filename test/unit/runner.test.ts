import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientFailure, decideMode, runBothSides } from '../../src/trivium/runner.js';
import { failedResult, type CriticAdapter, type AdapterContext } from '../../src/trivium/adapters/base.js';
import { defaultConfig } from '../../src/trivium/config.js';
import type { CriticId, CriticRequest, CriticResult } from '../../src/trivium/types.js';

function okResult(critic: CriticId, over: Partial<CriticResult> = {}): CriticResult {
  return {
    critic, status: 'ok', exit_code: 0, duration_s: 10,
    raw_stdout_path: '/runs/out', trace_path: '/runs/trace', review_json: null,
    raw_response_text: '{}', model_effective: 'M', model_effective_source: 'envelope',
    tool_calls: { read: 6 }, read_paths: ['/proj/src/a.ts'], write_events: [],
    evidence_ok: true, fail_reason: null, session_id: 'S', cli_version: '1',
    peer_deny_applied: false, command_line: 'x', ...over,
  };
}

const CTX: AdapterContext = { cfg: defaultConfig(), nodePath: '/usr/bin/node' };

function req(critic: CriticId): CriticRequest {
  return {
    run_id: 'R1', topic: 't', stage: 'plan', critic,
    project_root: '/proj', subject_path: '/proj/s.md', deny_paths: [],
    out_dir: '/runs/x', brief_path: '/proj/b.md', brief_text: 'BRIEF',
    model: 'M', timeout_s: 900, schema_path: '/s.json',
    min_tool_calls: 5, min_project_reads: 3,
  };
}

/** 可编程的桩适配器：按脚本依次返回结果，并记录每次收到的 brief_text */
function stub(critic: CriticId, script: CriticResult[]): CriticAdapter & { briefs: string[] } {
  const briefs: string[] = [];
  let i = 0;
  return {
    critic, briefs,
    availability: () => ({ ok: true }),
    async run(_ctx, r) {
      briefs.push(r.brief_text);
      return script[Math.min(i++, script.length - 1)]!;
    },
  } as CriticAdapter & { briefs: string[] };
}

test('瞬时故障可重试：空输出 / schema / 证据不足 / 429', () => {
  for (const reason of [
    'schema 校验失败', 'insufficient_evidence：工具调用 2 次 < 下限 5',
    'no_project_context：项目文件读取 0 次', '429 rate limit', '空输出',
  ]) {
    assert.equal(
      isTransientFailure(failedResult('glm', { status: 'failed', reason })),
      true,
      `应判为瞬时：${reason}`,
    );
  }
});

test('业务性失败不重试：鉴权、模型非法、配置缺失', () => {
  for (const reason of [
    'zcode 执行失败（provider_not_configured）：provider 鉴权失败',
    'Model config is missing',
    '模型 slug 非法',
    'zcode entry 未探测到',
  ]) {
    assert.equal(
      isTransientFailure(failedResult('glm', { status: 'failed', reason })),
      false,
      `应判为业务性：${reason}`,
    );
  }
});

test('超时不重试（重试大概率再超时，交给失败策略）', () => {
  assert.equal(isTransientFailure(failedResult('glm', { status: 'timeout', reason: '脚本级超时' })), false);
});

test('成功结果不触发重试判定', () => {
  assert.equal(isTransientFailure(okResult('gemini')), false);
});

test('瞬时故障重试一次即成功，且重试的 BRIEF 被追加了失败原因', async () => {
  const failing = failedResult('gemini', { status: 'failed', reason: 'schema 校验失败' });
  const a = stub('gemini', [failing, okResult('gemini')]);
  const out = await runBothSides({
    ctx: CTX,
    adapters: { gemini: a, glm: a },
    requests: { gemini: req('gemini') },
    maxTransientRetries: 1,
    onRetryBrief: (_c, prev) => `上一次失败：${prev.fail_reason}`,
  });
  assert.equal(out.results.gemini?.status, 'ok');
  assert.equal(out.attempts.gemini, 2);
  assert.equal(a.briefs.length, 2);
  assert.ok(!a.briefs[0]!.includes('上一次失败'), '首次不应带重试提示');
  assert.ok(a.briefs[1]!.includes('上一次失败：schema 校验失败'), '重试须把原因喂回去');
});

test('重试次数受上限约束，不会无限重试', async () => {
  const failing = failedResult('glm', { status: 'failed', reason: 'schema 校验失败' });
  const a = stub('glm', [failing]);
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: a, glm: a },
    requests: { glm: req('glm') }, maxTransientRetries: 1,
  });
  assert.equal(out.attempts.glm, 2, '首次 + 重试一次 = 2');
  assert.equal(out.results.glm?.status, 'failed');
});

test('两侧真并行，一侧抛异常不连带丢掉另一侧（AC-06）', async () => {
  const good = stub('gemini', [okResult('gemini')]);
  const throwing: CriticAdapter = {
    critic: 'glm',
    availability: () => ({ ok: true }),
    async run() { throw new Error('适配器内部炸了'); },
  };
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: good, glm: throwing },
    requests: { gemini: req('gemini'), glm: req('glm') }, maxTransientRetries: 0,
  });
  assert.equal(out.results.gemini?.status, 'ok', '幸存侧结果必须保留');
  assert.equal(out.results.glm?.status, 'failed');
  assert.match(out.results.glm!.fail_reason!, /适配器异常/);
});

test('两侧都成功 → dual，不降级', () => {
  const d = decideMode({ gemini: okResult('gemini'), glm: okResult('glm') }, 'strict');
  assert.deepEqual(
    { mode: d.mode, abort: d.abort, reason: d.degradedReason },
    { mode: 'dual', abort: false, reason: null },
  );
});

test('严格模式下单侧失败即中止，但幸存侧结果与原因都保留', () => {
  const d = decideMode(
    { gemini: okResult('gemini'), glm: failedResult('glm', { status: 'timeout', reason: '超时' }) },
    'strict',
  );
  assert.equal(d.mode, 'single');
  assert.equal(d.abort, true);
  assert.deepEqual(d.okSides, ['gemini']);
  assert.deepEqual(d.failedSides, ['glm']);
  assert.match(d.degradedReason!, /glm: timeout/);
});

test('降级模式下单侧失败继续，但必须标 single 与原因（不得伪装双审）', () => {
  const d = decideMode(
    { gemini: okResult('gemini'), glm: failedResult('glm', { status: 'failed', reason: '炸了' }) },
    'degrade',
  );
  assert.equal(d.mode, 'single');
  assert.equal(d.abort, false);
  assert.ok(d.degradedReason && d.degradedReason.length > 0, '降级必须留痕');
});

test('两侧都失败：无论什么策略都中止', () => {
  for (const policy of ['strict', 'degrade'] as const) {
    const d = decideMode(
      {
        gemini: failedResult('gemini', { status: 'failed', reason: 'a' }),
        glm: failedResult('glm', { status: 'failed', reason: 'b' }),
      },
      policy,
    );
    assert.equal(d.abort, true, `${policy} 下两侧全败应中止`);
    assert.deepEqual(d.okSides, []);
  }
});

test('parse_fallback 侧算「跑成功了」，不触发降级中止', () => {
  const d = decideMode(
    { gemini: okResult('gemini'), glm: okResult('glm', { status: 'parse_fallback' }) },
    'strict',
  );
  assert.equal(d.mode, 'dual');
  assert.equal(d.abort, false);
});

// ── 等待期逐侧进展回写（审查意见 AGY-01）──

test('单侧进展在开始、重试与收口三处各回调一次，attempt 递增', async () => {
  const failing = failedResult('gemini', { status: 'failed', reason: 'schema 校验失败' });
  const a = stub('gemini', [failing, okResult('gemini')]);
  const seen: Array<{ critic: CriticId; state?: string; attempt?: number; note?: string | null }> = [];
  await runBothSides({
    ctx: CTX,
    adapters: { gemini: a, glm: a },
    requests: { gemini: req('gemini') },
    maxTransientRetries: 1,
    onSideProgress: (critic, p) => seen.push({ critic, state: p.state, attempt: p.attempt, note: p.note }),
  });
  // 第 1 次开始 → 瞬时故障重试 → 第 2 次开始 → 收口
  assert.deepEqual(
    seen.map((s) => [s.state, s.attempt]),
    [['running', 1], ['running', 1], ['running', 2], ['ok', 2]],
  );
  assert.equal(seen[1]!.note, '瞬时故障，重试中');
});

test('终态失败也回写，并带上失败原因', async () => {
  const failing = failedResult('glm', { status: 'failed', reason: '鉴权失败' });
  const a = stub('glm', [failing]);
  const seen: Array<{ state?: string; note?: string | null }> = [];
  await runBothSides({
    ctx: CTX,
    adapters: { gemini: a, glm: a },
    requests: { glm: req('glm') },
    maxTransientRetries: 1,
    onSideProgress: (_c, p) => seen.push({ state: p.state, note: p.note }),
  });
  const last = seen.at(-1)!;
  assert.equal(last.state, 'failed');
  assert.equal(last.note, '鉴权失败');
});

test('进展回调抛异常不得连累审查本身', async () => {
  const a = stub('gemini', [okResult('gemini')]);
  const out = await runBothSides({
    ctx: CTX,
    adapters: { gemini: a, glm: a },
    requests: { gemini: req('gemini') },
    maxTransientRetries: 1,
    onSideProgress: () => {
      throw new Error('磁盘炸了');
    },
  });
  assert.equal(out.results.gemini?.status, 'ok', '进度写失败不该让审查失败');
});
