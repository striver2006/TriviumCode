import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAgyAuthFailure, type AgyInvokeOutcome } from '../../src/trivium/adapters/agy.js';
import { parseAgyStream, type AgyStreamResult } from '../../src/trivium/adapters/agy-events.js';

/**
 * agy 认证探活失败文案（BACKLOG EV-238，M12 批次 1）。
 *
 * 原先失败一律「请先交互登录一次」，M11 第 12 步 Z1 实为外层超时、登录正常。
 * 现在三档（认证 / 超时 / 其他），超时档按有无「已开始应答」的证据再分两层；判定（ok）不变，只验文案。
 */

const Z1_STDERR = '[agy] print timeout after 1m40s with turn in progress; returning partial output';
const LOGIN_AGAIN = '请先交互登录一次';

function outcome(over: Partial<Omit<AgyInvokeOutcome, 'parsed'>> & { parsed?: Partial<AgyStreamResult> } = {}): AgyInvokeOutcome {
  const { parsed, ...rest } = over;
  return {
    parsed: { ...parseAgyStream(''), ...parsed },
    exitCode: 0,
    timedOut: false,
    stdout: '',
    stderr: '',
    commandLine: 'agy -p …',
    durationMs: 0,
    printTimeoutWarned: false,
    ...rest,
  };
}

function assertNamesModelAndTime(text: string, model: string, secs: number): void {
  assert.ok(text.includes(`模型 ${model}`), `文案应点名探活模型：${text}`);
  assert.ok(text.includes(`${secs}s`), `文案应带耗时：${text}`);
}

test('EV-238：Z1 原话（status=SUCCESS、外层超时、自报 print timeout）⇒ 超时档「已开始应答」层，不引去重登', () => {
  const t = describeAgyAuthFailure(
    outcome({ timedOut: true, printTimeoutWarned: true, stderr: Z1_STDERR, durationMs: 120_400, parsed: { status: 'SUCCESS' } }),
    'gemini-3.8-flash-high',
  );
  assert.match(t, /^探活超时/);
  assert.match(t, /已开始应答/);
  assert.match(t, /不必重新登录/);
  assert.match(t, /print timeout/);
  assert.ok(!t.includes(LOGIN_AGAIN), `Z1 不是未登录，不该出现旧文案：${t}`);
  assertNamesModelAndTime(t, 'gemini-3.8-flash-high', 120);
});

test('EV-238：静默超时（无任何应答证据）⇒ 以「可能在等交互登录」打头', () => {
  const t = describeAgyAuthFailure(outcome({ timedOut: true, durationMs: 120_000, parsed: { status: null } }), 'm1');
  assert.match(t, /^探活超时/);
  assert.match(t, /没有收到任何应答：可能是在等交互登录/);
  assert.ok(!t.includes('已开始应答'), t);
  assertNamesModelAndTime(t, 'm1', 120);
});

test('EV-238：只拿到会话 id 的超时也算已开始应答', () => {
  const t = describeAgyAuthFailure(
    outcome({ timedOut: true, durationMs: 121_000, parsed: { status: null, conversationId: '2e38b1a1-0000' } }),
    'm1',
  );
  assert.match(t, /已开始应答/);
});

test('EV-238：自报 print timeout、未到外层超时、status 非 SUCCESS ⇒ 仍落超时档（与上位计划一致）', () => {
  const t = describeAgyAuthFailure(
    outcome({ printTimeoutWarned: true, stderr: Z1_STDERR, durationMs: 101_000, parsed: { status: 'ERROR' } }),
    'm1',
  );
  assert.match(t, /^探活超时/);
  assert.match(t, /已开始应答/);
});

test('EV-238：未登录原话 ⇒ 认证档；超时时也优先报未登录', () => {
  const said = 'Error: Please sign in to view available models. Launch the CLI without arguments to sign in.';
  for (const timedOut of [false, true]) {
    const t = describeAgyAuthFailure(outcome({ timedOut, stderr: said, durationMs: 3_000, parsed: { status: null } }), 'm1');
    assert.match(t, /^探活失败：agy 提示未登录/, `timedOut=${timedOut}：${t}`);
    assertNamesModelAndTime(t, 'm1', 3);
  }
  // 原话出现在 stdout 也认
  assert.match(describeAgyAuthFailure(outcome({ stdout: 'please sign in' }), null), /提示未登录/);
});

test('EV-238：其他档——未超时、无原话、status 非 SUCCESS ⇒ 原因未识别，仍给登录指引', () => {
  const t = describeAgyAuthFailure(outcome({ stderr: 'boom', durationMs: 2_000, parsed: { status: 'ERROR' } }), null);
  assert.match(t, /^探活失败（status=ERROR，模型 缺省，2s）：原因未识别/);
  assert.match(t, /交互运行一次 `agy`/);
  assert.match(t, /stderr: boom/);
});

// ── v1.3.6：认证探活降档（downgradeForAlive）──

test('降档：high/medium 尾缀降为同系 low，且降档形态在模型清单中才生效', async () => {
  const { downgradeForAlive } = await import('../../src/trivium/adapters/agy.js');
  const models = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'gemini-4-argon-medium', 'gemini-4-argon-low'];
  assert.equal(downgradeForAlive('gemini-3.8-flash-high', models), 'gemini-3.8-flash-low');
  assert.equal(downgradeForAlive('gemini-3.8-flash-medium', models), 'gemini-3.8-flash-low');
  assert.equal(downgradeForAlive('gemini-4-argon-medium', models), 'gemini-4-argon-low');
});

test('降档防御：清单缺 low 形态保持原模型；已是 low / 无档位后缀 / null 原样返回', async () => {
  const { downgradeForAlive } = await import('../../src/trivium/adapters/agy.js');
  assert.equal(downgradeForAlive('gemini-x-high', ['gemini-x-high']), 'gemini-x-high', '清单没有 low 形态：不猜不存在的 slug');
  assert.equal(downgradeForAlive('gemini-3.8-flash-low', ['gemini-3.8-flash-low']), 'gemini-3.8-flash-low');
  assert.equal(downgradeForAlive('claude-sonnet-4-6', ['claude-sonnet-4-6']), 'claude-sonnet-4-6', '不带档位后缀不动');
  assert.equal(downgradeForAlive(null, []), null);
  assert.equal(downgradeForAlive('gemini-3.8-flash-high', []), 'gemini-3.8-flash-high', '空清单无法核实降档形态：保持原模型');
});
