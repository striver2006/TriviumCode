/**
 * 任务书第 7 节按该侧命令执行能力二选一（EV-95，审查侧实测措辞约束计划 r2 §3.1 ①）。
 *
 * 特征句在本文件**字面写出**，不从 `brief.ts` 导入——导入常量的话，改了文案用例照绿。
 * 四家真实适配器取各自模块导出的适配器对象（不是手写取值），桩取两种形态与两格解耦组合。
 * 接线（`prepareRun` 把适配器声明递进来）由 `test/integration/brief-command-execution.test.ts` 守。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief, type BriefInput } from '../../src/trivium/brief.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { agyAdapter } from '../../src/trivium/adapters/agy.js';
import { claudeAdapter } from '../../src/trivium/adapters/claude.js';
import { codexAdapter } from '../../src/trivium/adapters/codex.js';
import { zcodeAdapter } from '../../src/trivium/adapters/zcode.js';
import { makeStubAdapter } from '../../src/trivium/adapters/stub.js';
import type { CommandExecution, CriticAdapter } from '../../src/trivium/adapters/base.js';
import type { Snapshot } from '../../src/trivium/freeze.js';

const SNAP: Snapshot = {
  gitHead: null, treeHash: 't', dirty: false, subjectSha256: 's',
  subjectPath: '/proj/.reviews/T/plan/2026-10-02-T-claude.md', denyPaths: ['.env'], diffText: null, takenAt: 'x',
};

function brief(adapter: CriticAdapter): string {
  const input: BriefInput = {
    cfg: defaultConfig(), critic: adapter.critic, stage: 'plan', topic: 'T', runId: 'R', projectRoot: '/proj', snapshot: SNAP,
    promptHint: '请独立复测那条退出码断言', subjectExcerpt: '# 计划', mustRead: ['CLAUDE.md'], suggestedRead: [], ownHistory: [],
    lenses: {}, taskGoal: null, taskGoalAppendix: null, minToolCalls: 5, minProjectReads: 3,
    commandExecution: adapter.commandExecution,
    // 本文件只管证据性质那一条；执行型 MCP 点名那一条由 brief-mcp-exec.test.ts 守（EV-191）
    mcpExecPrefixes: [],
  };
  return renderBrief(input);
}

function section7(b: string): string {
  const start = b.indexOf('## 7. 反谄媚约束');
  const end = b.indexOf('## 8. ', start);
  assert.ok(start >= 0 && end > start, '第 7 节应存在且在第 8 节之前');
  return b.slice(start, end);
}

/** 两种说法各自的特征句（字面）。`none` 两条、`readonly-shell` 一条 */
const NONE_MARKS = [
  '**你这一侧没有执行命令的能力**，只能读文件与检索。',
  '不要用「实测」「复测」「直调」「跑了」「执行结果」一类说法描述你的判断',
  '需要运行才能确认的结论写明是推理，并在 `not_covered` 里列出没能验证的部分',
  '第 2 节的焦点若要求实测或复测而你做不到，如实说明后照常交付结论，**不要停下来等放行**。',
];
const SHELL_MARKS = [
  '你这一侧可以执行只读命令。',
  '凡写「实测」「复测」的判断，`evidence` 里写出你本轮实际执行的命令；没执行、靠推理得出的写明是推理。',
];

/** 既有五条（逐字、按序） */
const BASE_LINES = [
  '- **不要为了显得有用而编造问题。** 没问题就说没问题。',
  '- 不确定的判断标 `confidence: low`，不要用确定的语气写不确定的结论。',
  '- **必须**填写 `not_covered`，如实暴露你这次没覆盖的范围。',
  '- 在 `agreed` 里写出你认为正确的部分——只挑刺的审查是低质量的审查。',
  '- 不要给出大段可粘贴的补丁。你是审查员，不是第二作者；指出方向即可。',
];

function assertVariant(s7: string, want: CommandExecution, label: string): void {
  const [mine, other] = want === 'none' ? [NONE_MARKS, SHELL_MARKS] : [SHELL_MARKS, NONE_MARKS];
  for (const m of mine) assert.ok(s7.includes(m), `${label}：第 7 节应含「${m}」\n${s7}`);
  for (const m of other) assert.ok(!s7.includes(m), `${label}：第 7 节不应含另一种说法的「${m}」\n${s7}`);
  // 「第 2 节」而不是「第 2 段」：任务书正文自称各段为「节」
  assert.ok(!s7.includes('第 2 段'), `${label}：称呼应为「第 2 节」`);
}

test('四家真实适配器：第 7 节恰好是各自声明的那一种说法（codex 只读 shell，其余三家不能执行命令）', () => {
  const cases: [CriticAdapter, CommandExecution][] = [
    [codexAdapter, 'readonly-shell'],
    [agyAdapter, 'none'],
    [zcodeAdapter, 'none'],
    [claudeAdapter, 'none'],
  ];
  for (const [a, want] of cases) {
    assert.equal(a.commandExecution, want, `${a.critic} 的声明`);
    assertVariant(section7(brief(a)), want, a.critic);
  }
});

test('桩的两种形态：command_trace 缺省为只读 shell，其余缺省为不能执行命令', () => {
  assertVariant(section7(brief(makeStubAdapter('gemini', { mode: 'command_trace' }))), 'readonly-shell', '桩 command_trace');
  assertVariant(section7(brief(makeStubAdapter('glm', { mode: 'ok' }))), 'none', '桩 ok');
});

test('解耦两格：渲染跟的是 commandExecution，不是轨迹形状', () => {
  const toolShell = makeStubAdapter('gemini', { mode: 'ok', commandExecution: 'readonly-shell' });
  assert.equal(toolShell.capability.traceShape, 'tool-trace');
  assertVariant(section7(brief(toolShell)), 'readonly-shell', 'tool-trace + readonly-shell');

  const cmdNone = makeStubAdapter('glm', { mode: 'command_trace', commandExecution: 'none' });
  assert.equal(cmdNone.capability.traceShape, 'command-trace');
  assertVariant(section7(brief(cmdNone)), 'none', 'command-trace + none');
});

test('既有五条逐字仍在且顺序不变；新增条目插在 not_covered 那条之后、agreed 那条之前', () => {
  for (const ce of ['none', 'readonly-shell'] as const) {
    const s7 = section7(brief(makeStubAdapter('glm', { mode: 'ok', commandExecution: ce })));
    const lines = s7.split('\n').filter((l) => l.startsWith('- '));
    const pos = BASE_LINES.map((b) => lines.indexOf(b));
    assert.ok(pos.every((p) => p >= 0), `${ce}：既有五条应逐字仍在\n${s7}`);
    assert.deepEqual([...pos].sort((a, b) => a - b), pos, `${ce}：既有五条顺序不变`);
    const added = lines.length - BASE_LINES.length;
    assert.equal(added, ce === 'none' ? 2 : 1, `${ce}：新增条目数`);
    // not_covered 那条（第 3 条）与 agreed 那条（第 4 条）之间恰好夹着新增条目
    assert.equal(pos[3]! - pos[2]!, added + 1, `${ce}：新增条目应紧跟 not_covered 那条`);
  }
});

test('两种说法下第 7 节之外的全文逐字相同；八个标题恰好八个', () => {
  const a = brief(makeStubAdapter('glm', { mode: 'ok', commandExecution: 'none' }));
  const b = brief(makeStubAdapter('glm', { mode: 'ok', commandExecution: 'readonly-shell' }));
  const strip = (t: string) => t.replace(section7(t), '');
  assert.notEqual(a, b);
  assert.equal(strip(a), strip(b));
  for (const t of [a, b]) {
    assert.equal((t.match(/^## \d\. /gm) ?? []).length, 8, '段落数是契约');
  }
});
