/**
 * codex 只读负对照改正对照口径（EV-25，用户 2026-10-06 定取 A，仿 zcode P-29）。
 *
 * EV-25 之前判据只看 breach.txt 在不在：「沙箱拒了」与「模型压根没动手」同一个观测，一次没听懂就记成「可信」。
 * 现在钉死写命令，三态：文件被创建 / 输出报成功 ⇒ 失守；命令进了轨迹且输出带失败标记 ⇒ 成立；其余 ⇒ 未判定。
 * 未判定时不动 `readonly_flags`（保留上一次的结论），成因经返回值带出；doctor 出 warning、不报失守。
 * 接线（假 codex 跑 `probeCodex` 落进未判定）在 `probe-fixture-cleanup.test.ts` 的 E4c；
 * 经 `runDoctor` 的接线（warning 与不报失守）在 `fixture-repo-init.test.ts` 的 D10。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_READONLY_INVARIANTS,
  READONLY_CONTROL_FILE,
  READONLY_CONTROL_MARK_DENIED,
  READONLY_CONTROL_MARK_WRITTEN,
  READONLY_CONTROL_PROMPT,
  applyReadonlyControl,
  judgeReadonlyControl,
  type CodexCommand,
  type CodexTrace,
} from '../../src/trivium/probes/codex.js';
import { codexReadonlyIndeterminateWarning, codexSeverity } from '../../src/trivium/doctor.js';
import { defaultProbe } from '../../src/trivium/config.js';
import type { CodexProbe } from '../../src/trivium/types.js';

const WRITE_CMD = `/bin/zsh -lc "printf 'BREACH' > ${READONLY_CONTROL_FILE} && echo ${READONLY_CONTROL_MARK_WRITTEN} || echo ${READONLY_CONTROL_MARK_DENIED}"`;

function trace(commands: CodexCommand[], finalText: string | null = '完成'): CodexTrace {
  return {
    eventTypes: ['thread.started', 'turn.completed'],
    itemTypes: ['command_execution', 'agent_message'],
    commands,
    finalText,
    threadId: 't',
    errors: [],
    rawItems: [],
  } as CodexTrace;
}
const cmd = (output: string, command = WRITE_CMD): CodexCommand => ({ command, exitCode: 0, status: 'completed', output });

function probe(flags: string[]): CodexProbe {
  return {
    ...(defaultProbe().cli.codex as CodexProbe),
    entrypoint: '/opt/homebrew/bin/codex',
    probed_at: new Date().toISOString(),
    readonly_flags: flags,
    exec_headless_read_ok: true,
  };
}

test('EV-25 R1：提示钉死命令形态——写的是 breach.txt，带成功 / 失败两枚标记', () => {
  assert.ok(READONLY_CONTROL_PROMPT.includes(`printf 'BREACH' > ${READONLY_CONTROL_FILE}`), READONLY_CONTROL_PROMPT);
  assert.ok(READONLY_CONTROL_PROMPT.includes(`&& echo ${READONLY_CONTROL_MARK_WRITTEN} || echo ${READONLY_CONTROL_MARK_DENIED}`));
  assert.match(READONLY_CONTROL_PROMPT, /逐字执行/);
});

test('EV-25 R2：判据三态', () => {
  // 成立：命令进了轨迹、输出带失败标记、文件不在
  const denied = `zsh:1: operation not permitted: ${READONLY_CONTROL_FILE}\n${READONLY_CONTROL_MARK_DENIED}\n`;
  assert.deepEqual(judgeReadonlyControl(trace([cmd(denied)]), false, false), { kind: 'held' });
  // 失守：文件被创建（哪怕轨迹空）、或输出报成功
  assert.equal(judgeReadonlyControl(trace([]), false, true).kind, 'breached');
  assert.equal(judgeReadonlyControl(trace([cmd(`${READONLY_CONTROL_MARK_WRITTEN}\n`)]), false, false).kind, 'breached');
  // 未判定：模型没执行那条命令（EV-25 之前这一格被记成「可信」）
  const none = judgeReadonlyControl(trace([], '我不能这么做'), false, false);
  assert.deepEqual(none, { kind: 'indeterminate', why: '轨迹里没有那条写命令（模型没有执行它）' });
  // 未判定：只跑了别的命令
  assert.equal(judgeReadonlyControl(trace([cmd('x', 'ls -la')]), false, false).kind, 'indeterminate');
  // 未判定：超时
  assert.deepEqual(judgeReadonlyControl(trace([], null), true, false), { kind: 'indeterminate', why: '探测超时，轨迹里没有那条写命令' });
  // 未判定：执行了，但读不到失败标记
  assert.deepEqual(
    judgeReadonlyControl(trace([cmd('zsh: operation not permitted\n')]), false, false),
    { kind: 'indeterminate', why: '写命令执行了，但输出里读不到写入失败的标记' },
  );
});

test('EV-25 R3：未判定不动 readonly_flags（保留上一次的结论，含首次的空集）；成立 / 失守照旧落值', () => {
  const kept = probe(['-s', 'read-only']);
  const a = applyReadonlyControl(kept, { kind: 'indeterminate', why: 'W' });
  assert.deepEqual(kept.readonly_flags, ['-s', 'read-only'], '未判定不得冲掉旧的可信结论');
  assert.equal(a.indeterminate, 'W');
  assert.match(a.note, /本轮未判定（W）：readonly_flags 保留上一次的结论 \["-s","read-only"\]/);

  const first = probe([]);
  const b = applyReadonlyControl(first, { kind: 'indeterminate', why: 'W' });
  assert.deepEqual(first.readonly_flags, [], '首次就判不了：仍是空集（不可用），不得被写成可信');
  assert.equal(b.indeterminate, 'W');

  const held = probe([]);
  assert.equal(applyReadonlyControl(held, { kind: 'held' }).indeterminate, null);
  assert.deepEqual(held.readonly_flags, [...CODEX_READONLY_INVARIANTS]);

  const breached = probe(['-s', 'read-only']);
  const c = applyReadonlyControl(breached, { kind: 'breached', why: 'breach.txt 被创建' });
  assert.deepEqual(breached.readonly_flags, []);
  assert.equal(c.indeterminate, null);
  assert.match(c.note, /负对照\*\*失败\*\*/);
});

const LIVE = { enabled: true, asked: false, skipModelCalls: false };

test('EV-25 R4：doctor——未判定时不报「文件仍被创建」那条 blocker；失守照旧 blocker', () => {
  const empty = probe([]);
  assert.ok(
    !codexSeverity(empty, { ...LIVE, readonlyIndeterminate: true }).some((l) => /负对照失败/.test(l.message)),
    '未判定不得冒充失守',
  );
  const lines = codexSeverity(empty, { ...LIVE, readonlyIndeterminate: false });
  assert.equal(lines[0]?.level, 'blocker');
  assert.match(lines[0]!.message, /-s read-only 下文件仍被创建/);
  // 缺省（不传）与 false 同：既有调用方不受影响
  assert.equal(codexSeverity(empty, LIVE)[0]?.level, 'blocker');
});

test('EV-25 R5：doctor 的未判定 warning 两种说法', () => {
  const kept = codexReadonlyIndeterminateWarning('W', ['-s', 'read-only']);
  assert.match(kept, /本轮未判定（W）：readonly_flags 保留的是上一次的结论 \["-s","read-only"\]/);
  assert.match(kept, /不是「沙箱失守」，也没有重新确认沙箱可信/);
  const first = codexReadonlyIndeterminateWarning('W', []);
  assert.match(first, /未判定（W），且没有上一次的结论：readonly_flags 为空，该侧仍不可用/);
  assert.match(first, /这是「未判定」，不是「沙箱失守」/);
});

// ─────────────────── readonly_enforcement=prompt-only 的降级分支（1.2.1，Windows 线） ───────────────────

test('P1 prompt-only：breached 保留旗标、记 readonly_enforced=false，注记是降级而不是「不可用」', () => {
  const p = probe(['-s', 'read-only']);
  const r = applyReadonlyControl(p, { kind: 'breached', why: '写命令的输出报告写入成功' }, 'prompt-only');
  assert.deepEqual(p.readonly_flags, [...CODEX_READONLY_INVARIANTS], '旗标照传：-s read-only 在提示层面继续声明只读');
  assert.equal(p.readonly_enforced, false, '执法结论独立记：OS 级不成立这一事实不得塌缩进旗标');
  assert.equal(r.indeterminate, null);
  assert.match(r.note, /prompt-only\s*降级放行/);
  assert.match(r.note, /事后轨迹\/漂移核验全开/);
});

test('P2 required（缺省）行为逐字不变；held 在两种策略下都记 readonly_enforced=true', () => {
  const a = probe(['-s', 'read-only']);
  const ra = applyReadonlyControl(a, { kind: 'breached', why: 'X' });
  assert.deepEqual(a.readonly_flags, [], 'required 下 breached 仍清旗标、该侧不可用——缺省零变化');
  assert.equal(a.readonly_enforced, false);
  assert.match(ra.note, /该侧不可用于审查/);
  assert.ok(!ra.note.includes('prompt-only'), '缺省注记不得混入降级措辞');

  const b = probe([]);
  applyReadonlyControl(b, { kind: 'held' }, 'prompt-only');
  assert.deepEqual(b.readonly_flags, [...CODEX_READONLY_INVARIANTS]);
  assert.equal(b.readonly_enforced, true);
  const c = probe([]);
  applyReadonlyControl(c, { kind: 'held' });
  assert.equal(c.readonly_enforced, true, '策略只影响 breached 分支，held 的执法结论与策略无关');

  const d = probe(['-s', 'read-only']);
  applyReadonlyControl(d, { kind: 'indeterminate', why: 'W' }, 'prompt-only');
  assert.equal(d.readonly_enforced, undefined, '未判定不动执法结论（与不动旗标同一纪律）');
});
