/**
 * codex 探针结论 → 诊断严重度的分档（M6 第 2 步，审查意见 GLM-03 / AGY-01 / GLM-01）。
 *
 * 本组里有一条**安全判定**：只读沙箱负对照失守时必须是 blocker。
 * 它原先埋在 `runDoctor` 里、要真跑 codex 才走得到，等于没有测试守着——
 * 而那正是本轮唯一被判 `security` 类的意见。抽成纯函数就是为了让它可测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexSeverity } from '../../src/trivium/doctor.js';
import { defaultProbe } from '../../src/trivium/config.js';
import type { CodexProbe } from '../../src/trivium/types.js';

/** 一个「一切正常」的探针结论，各用例只改自己关心的那一项 */
function healthy(over: Partial<CodexProbe> = {}): CodexProbe {
  return {
    ...(defaultProbe().cli.codex as CodexProbe),
    entrypoint: '/opt/homebrew/bin/codex',
    version: '0.154.0',
    probed_at: new Date().toISOString(),
    readonly_flags: ['-s', 'read-only'],
    exec_headless_read_ok: true,
    ...over,
  };
}

const LIVE = { enabled: false, asked: false, skipModelCalls: false };

test('一切正常时不产生任何诊断', () => {
  assert.deepEqual(codexSeverity(healthy(), LIVE), []);
});

test('【安全】只读沙箱失守恒为 blocker，哪怕该侧尚未启用为审核者', () => {
  /*
   * 这是本组存在的首要理由。
   *
   * `readonly_flags` 为空 = 负对照失败 = `-s read-only` 下文件仍被创建 =
   * 这一侧当审查员时**能写项目文件**。原实现只给它一条 ⚠️ note，
   * 于是沙箱失守的机器上 doctor 照常报「✓ 未发现阻断级问题」——
   * 而探针自己的 note 文案写着「该侧不可用于审查」，判定与自家文案矛盾。
   *
   * 不分档的理由：失守说明这台机器上的 codex 现在就是不安全的，
   * 与「我们打不打算用它当审核者」无关。
   */
  const lines = codexSeverity(healthy({ readonly_flags: [] }), LIVE);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 'blocker', '沙箱失守必须阻断，不能只是一条提示');
  assert.match(lines[0]!.message, /只读沙箱负对照失败/);
});

test('【安全】失守的严重度高于「读不到文件」：两者同时出现时先报失守', () => {
  /*
   * 原实现的分支顺序把「读不到文件」排在前面，于是失守被它遮住。
   * 两种失败的处置完全不同：读不到是「用不了」，失守是「用了会坏事」。
   */
  const lines = codexSeverity(
    healthy({ readonly_flags: [], exec_headless_read_ok: false }),
    LIVE,
  );
  assert.match(lines[0]!.message, /只读沙箱/, '失守要盖过「读不到文件」');
});

test('负对照没跑过时，readonly_flags 为空不算失守', () => {
  /*
   * `--no-model-calls` 下负对照根本没执行，`readonly_flags` 保留的是上一次结论。
   * 空集在这种情形下只代表「没测过」，判成失守会让省配额的那条路径恒报 blocker。
   */
  assert.deepEqual(
    codexSeverity(healthy({ readonly_flags: [] }), { ...LIVE, skipModelCalls: true }),
    [],
  );
});

test('未启用为审核者时，「没装」只是 note，不阻断全量 doctor', () => {
  /*
   * codex 的 criticEnabled 现在是 false。全量 doctor 会因 blockers 非空退非零码——
   * **没装 codex 的用户什么都没做错，却会被硬阻断**（审查意见 AGY-01）。
   */
  const lines = codexSeverity(healthy({ entrypoint: null }), LIVE);
  assert.equal(lines[0]!.level, 'note');
  assert.match(lines[0]!.message, /尚未启用为审核者/, '要说清为什么不阻断');
});

test('显式 --only codex 时，「没装」升为 blocker', () => {
  // 用户点名问这一侧的状况，「没装」正是他要的答案，该以非零码告诉他
  const lines = codexSeverity(healthy({ entrypoint: null }), { ...LIVE, asked: true });
  assert.equal(lines[0]!.level, 'blocker');
});

test('启用为审核者后，「读不到文件」升为 blocker', () => {
  const lines = codexSeverity(
    healthy({ exec_headless_read_ok: false }),
    { ...LIVE, enabled: true },
  );
  assert.equal(lines[0]!.level, 'blocker');
  assert.match(lines[0]!.message, /无法作为审查员使用/);
});

test('第三态不静默放行：未得出结论要留痕，且不是 blocker', () => {
  /*
   * null 是「没测出结论」（超时、进程报错、事件流里没有最终回复），
   * 与「测了没问题」必须在报告里长得不一样——否则三态改造就白做了。
   * 但它也不该阻断：一次网络抖动不等于能力缺陷。
   */
  const lines = codexSeverity(healthy({ exec_headless_read_ok: null }), LIVE);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 'note');
  assert.match(lines[0]!.message, /未得出结论/);
  assert.match(lines[0]!.message, /重跑/, '要给出路');
});

test('第三态在 --no-model-calls 下不报：那时本来就没打算测', () => {
  assert.deepEqual(
    codexSeverity(healthy({ exec_headless_read_ok: null }), { ...LIVE, skipModelCalls: true }),
    [],
  );
});
