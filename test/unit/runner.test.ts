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

test('两侧都成功 → full，不降级', () => {
  const d = decideMode({ gemini: okResult('gemini'), glm: okResult('glm') }, 'strict', ['gemini', 'glm']);
  assert.deepEqual(
    { mode: d.mode, abort: d.abort, reason: d.degradedReason },
    { mode: 'full', abort: false, reason: null },
  );
});

test('严格模式下单侧失败即中止，但幸存侧结果与原因都保留', () => {
  const d = decideMode(
    { gemini: okResult('gemini'), glm: failedResult('glm', { status: 'timeout', reason: '超时' }) },
    'strict',
    ['gemini', 'glm'],
  );
  assert.equal(d.mode, 'partial');
  assert.equal(d.abort, true);
  assert.deepEqual(d.okSides, ['gemini']);
  assert.deepEqual(d.failedSides, ['glm']);
  assert.match(d.degradedReason!, /glm: timeout/);
});

test('降级模式下单侧失败继续，但必须标 partial 与原因（不得伪装双审）', () => {
  const d = decideMode(
    { gemini: okResult('gemini'), glm: failedResult('glm', { status: 'failed', reason: '炸了' }) },
    'degrade',
    ['gemini', 'glm'],
  );
  assert.equal(d.mode, 'partial');
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
      ['gemini', 'glm'],
    );
    assert.equal(d.abort, true, `${policy} 下两侧全败应中止`);
    assert.deepEqual(d.okSides, []);
  }
});

/*
 * ── 入选集合参与判定（M7b 第 1 步 §2.1）──
 *
 * 这三例针对的是一个**会带病通过既有测试**的缺陷：原有五个 decideMode 用例
 * 全部传入两侧，单侧入选的形态一个都没覆盖，于是「只审了一侧」与「双审全成功」
 * 返回值逐字段相同（实测确认），留痕里查不出来（AC-06）。
 */

test('入选一侧且成功：不是降级，但参与者基数必须机器可判（AC-06 / 设计 AC-22）', () => {
  const one = decideMode({ gemini: okResult('gemini') }, 'strict', ['gemini']);
  const two = decideMode({ gemini: okResult('gemini'), glm: okResult('glm') }, 'strict', [
    'gemini',
    'glm',
  ]);

  // 选 1 审是**配置意图**，不打降级横幅、不写降级理由（设计 AC-22）
  assert.equal(one.degraded, false, '显式只选一侧并成功，不是降级');
  assert.equal(one.degradedReason, null);
  assert.equal(one.abort, false);

  // 但两者必须可区分——这正是修复前做不到的事
  assert.deepEqual(one.selectedSides, ['gemini']);
  assert.deepEqual(two.selectedSides, ['gemini', 'glm']);
  assert.notDeepEqual(
    one.selectedSides,
    two.selectedSides,
    '单侧与双侧的入选集合必须不同，否则留痕里查不出本轮只审了一侧',
  );
});

test('入选两侧却只回来一侧：缺失侧必须显形，不能当成全成功', () => {
  // 装配链断了才会出现；修复前 Object.keys(results) 见不到它，会判成 full/不降级
  const d = decideMode({ gemini: okResult('gemini') }, 'degrade', ['gemini', 'glm']);

  assert.deepEqual(d.missingSides, ['glm']);
  assert.deepEqual(d.failedSides, ['glm'], '缺失侧要并进 failedSides');
  assert.equal(d.degraded, true);
  assert.match(d.degradedReason!, /glm: 入选但未产出任何结果/);
});

test('未入选侧的结果混进 results 时被忽略，不得污染判定（审查意见 AGY-02 ≡ GLM-02）', () => {
  /*
   * 求交之前：ran 直接取键集，glm 的失败会把 mode 判成 partial、degraded 置 true、
   * strict 下还会 abort——只防「入选却没跑」、不防「没入选却有结果」的不对称漏洞。
   */
  const polluted = decideMode(
    {
      gemini: okResult('gemini'),
      glm: failedResult('glm', { status: 'failed', reason: '这一侧压根没入选' }),
    },
    'strict',
    ['gemini'],
  );

  assert.equal(polluted.degraded, false, '未入选侧的失败不得触发降级');
  assert.equal(polluted.abort, false, 'strict 下也不得因未入选侧而中止');
  assert.equal(polluted.degradedReason, null);
  assert.deepEqual(polluted.okSides, ['gemini']);
  assert.deepEqual(polluted.failedSides, [], '未入选侧不得进 failedSides');
  assert.deepEqual(polluted.selectedSides, ['gemini']);
});

test('degraded 与 mode 解耦：mode 只说完成度，不得当降级标志用', () => {
  const intentionalSingle = decideMode({ gemini: okResult('gemini') }, 'strict', ['gemini']);
  // 只入选一侧且它成功了：完成度是 full，**不表达**参与者基数（AC-22）
  assert.equal(intentionalSingle.mode, 'full');
  assert.equal(intentionalSingle.degraded, false, 'mode 与 degraded 各自独立');

  const realDegrade = decideMode(
    { gemini: okResult('gemini'), glm: failedResult('glm', { status: 'failed', reason: 'x' }) },
    'degrade',
    ['gemini', 'glm'],
  );
  assert.equal(realDegrade.mode, 'partial');
  assert.equal(realDegrade.degraded, true);
});

test('parse_fallback 侧算「跑成功了」，不触发降级中止', () => {
  const d = decideMode(
    { gemini: okResult('gemini'), glm: okResult('glm', { status: 'parse_fallback' }) },
    'strict',
    ['gemini', 'glm'],
  );
  assert.equal(d.mode, 'full');
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

/*
 * ── 查表缺项必须说得出是谁缺（M7b 第 6 步）──
 *
 * `CriticId` 放开成注册表全集之后，`Record<CriticId, CriticAdapter>` 成了一句谎话
 * （Driver 与尚未接入的 Agent 本就没有适配器）。改成 `AdapterTable = Partial<…>` 后
 * 取值处必须显式判空——**而判空分支本身要被测**，否则它只是一段好看的死代码。
 *
 * 这条路径在生产里不可达（`realAdapters()` 会先响亮失败），但 `runBothSides`
 * 是导出函数、`adapters` 是入参，手工构造的调用方随时能撞上它。
 */
test('入选了某侧却没有它的适配器 → 该侧记 failed 并点名，不连带丢掉另一侧', async () => {
  const good = stub('gemini', [okResult('gemini')]);
  const out = await runBothSides({
    ctx: CTX,
    // glm 被请求了，表里却没有它
    adapters: { gemini: good },
    requests: { gemini: req('gemini'), glm: req('glm') },
    maxTransientRetries: 0,
  });
  assert.equal(out.results.gemini?.status, 'ok', '有适配器的那侧照常跑完');
  assert.equal(out.results.glm?.status, 'failed');
  assert.match(
    out.results.glm!.fail_reason!,
    /glm/,
    '报错必须点名是哪一侧缺适配器——否则排障时看到的只是一条 TypeError',
  );
});
