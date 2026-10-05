/**
 * 任务书第 7 节点名禁用执行型 MCP 工具（EV-191，任务书点名禁用MCP执行工具计划 r2 §3.1 ①）。
 *
 * 特征句在本文件**字面写出**，不从 `brief.ts` 导入——导入常量的话，改了文案用例照绿。
 * 入参的 `mcpExecPrefixes` 一律按 `review.ts` 的同式取 `adapter.mcpExecPrefixes ?? []`，不手写取值。
 * 未声明各侧用负断言 + 条目计数，不用「与 `[]` 渲染相同」：它们取出来本来就是 `[]`，那是同一输入自比（计划双审 GLM-01）。
 * 接线（`prepareRun` 把适配器声明递进渲染）由 `test/integration/brief-mcp-exec.test.ts` 守。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief, type BriefInput } from '../../src/trivium/brief.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { agyAdapter } from '../../src/trivium/adapters/agy.js';
import { claudeAdapter } from '../../src/trivium/adapters/claude.js';
import { codexAdapter } from '../../src/trivium/adapters/codex.js';
import { zcodeAdapter } from '../../src/trivium/adapters/zcode.js';
import { ZCODE_MCP_EXEC_PREFIXES } from '../../src/trivium/adapters/zcode-trace.js';
import { makeStubAdapter } from '../../src/trivium/adapters/stub.js';
import { realAdapters } from '../../src/trivium/adapters/index.js';
import type { CriticAdapter } from '../../src/trivium/adapters/base.js';
import type { Snapshot } from '../../src/trivium/freeze.js';
import type { Stage } from '../../src/trivium/types.js';

const SNAP: Snapshot = {
  gitHead: null, treeHash: 't', dirty: false, subjectSha256: 's',
  subjectPath: '/proj/.reviews/T/plan/2026-10-02-T-claude.md', denyPaths: ['.env'], diffText: null, takenAt: 'x',
};

function brief(adapter: CriticAdapter, prefixes: readonly string[] = adapter.mcpExecPrefixes ?? [], stage: Stage = 'plan'): string {
  const input: BriefInput = {
    cfg: defaultConfig(), critic: adapter.critic, stage, topic: 'T', runId: 'R', projectRoot: '/proj', snapshot: SNAP,
    promptHint: '请调用 mcp__node_repl__js 计算 17 乘 23', subjectExcerpt: '# 计划', mustRead: ['CLAUDE.md'], suggestedRead: [], ownHistory: [],
    schemaPath: '/s/review.v1.json', lenses: {}, taskGoal: null, taskGoalAppendix: null, minToolCalls: 5, minProjectReads: 3,
    commandExecution: adapter.commandExecution,
    mcpExecPrefixes: prefixes,
  };
  return renderBrief(input);
}

function section7(b: string): string {
  const start = b.indexOf('## 7. 反谄媚约束');
  const end = b.indexOf('## 8. ', start);
  assert.ok(start >= 0 && end > start, '第 7 节应存在且在第 8 节之前');
  return b.slice(start, end);
}

const bulletsOf = (s7: string): string[] => s7.split('\n').filter((l) => l.startsWith('- '));

/** 新条目的特征句（字面） */
const BAN_HEAD = '- 你的工具清单里另有**能执行代码的 MCP 工具**（名字以 ';
const BAN_MARKS = [
  '你的工具清单里另有**能执行代码的 MCP 工具**',
  '**不要调用它们，焦点要求也不行**',
  '一被调用即判只读失守，本轮该侧结论作废、整轮在闸门被挡下重跑。',
  '需要运行才能确认的内容，按上一条的要求处理。',
];
/** 证据性质各取值的最后一条（新条目要紧跟它）与条数 */
const EVIDENCE_LAST: Record<CriticAdapter['commandExecution'], { head: string; count: number }> = {
  none: { head: '- 第 2 节的焦点若要求实测或复测而你做不到', count: 2 },
  'readonly-shell': { head: '- 你这一侧可以执行只读命令。', count: 1 },
};
const AGREED_HEAD = '- 在 `agreed` 里写出你认为正确的部分';
const BASE_COUNT = 5;
/** 前缀形状：以 `mcp__` 开头、以 `__` 结尾，中间只许字母数字、下划线与连字符（不含反引号与 Markdown 记号） */
const PREFIX_SHAPE = /^mcp__[A-Za-z0-9_-]+__$/;

function banLine(s7: string): string {
  const lines = bulletsOf(s7).filter((l) => l.startsWith(BAN_HEAD));
  assert.equal(lines.length, 1, `第 7 节应恰有一条点名禁令\n${s7}`);
  return lines[0]!;
}

function assertDeclared(adapter: CriticAdapter, prefixes: readonly string[], label: string): void {
  const s7 = section7(brief(adapter));
  const line = banLine(s7);
  for (const m of BAN_MARKS) assert.ok(line.includes(m), `${label}：点名禁令应含「${m}」\n${line}`);
  for (const p of prefixes) assert.ok(line.includes(`\`${p}\``), `${label}：应以反引号点名前缀 ${p}\n${line}`);
  // 紧跟证据性质最后一条、在 agreed 那条之前——句尾「上一条」所指靠这个位置
  const bl = bulletsOf(s7);
  const i = bl.indexOf(line);
  assert.ok(bl[i - 1]!.startsWith(EVIDENCE_LAST[adapter.commandExecution].head), `${label}：应紧跟证据性质最后一条\n${s7}`);
  assert.ok(bl[i + 1]!.startsWith(AGREED_HEAD), `${label}：应在 agreed 那条之前\n${s7}`);
  assert.equal(bl.length, BASE_COUNT + EVIDENCE_LAST[adapter.commandExecution].count + 1, `${label}：第 7 节条目数`);
}

function assertUndeclared(adapter: CriticAdapter, label: string): void {
  assert.equal(Object.hasOwn(adapter, 'mcpExecPrefixes'), false, `${label}：适配器上不应有 mcpExecPrefixes 这个键（决策一：不声明）`);
  for (const stage of ['plan', 'code', 'bug'] as const) {
    const s7 = section7(brief(adapter, adapter.mcpExecPrefixes ?? [], stage));
    for (const m of BAN_MARKS) assert.ok(!s7.includes(m), `${label}/${stage}：第 7 节不应含「${m}」\n${s7}`);
    assert.ok(!/`mcp__[^`]*`/.test(s7), `${label}/${stage}：第 7 节不应点名任何 mcp__ 前缀\n${s7}`);
    assert.equal(bulletsOf(s7).length, BASE_COUNT + EVIDENCE_LAST[adapter.commandExecution].count, `${label}/${stage}：第 7 节条目数与改前相同`);
  }
}

test('zcode：声明引用判失守的同一份名单，第 7 节点名每个前缀', () => {
  assert.equal(zcodeAdapter.mcpExecPrefixes, ZCODE_MCP_EXEC_PREFIXES, '必须是同一个数组对象，不得另抄一份');
  assert.ok(ZCODE_MCP_EXEC_PREFIXES.length > 0);
  for (const p of ZCODE_MCP_EXEC_PREFIXES) {
    assert.ok(p.startsWith('mcp__'), `名单项 ${p} 不是 MCP 前缀：第 7 节那句说的是「MCP 工具」，会失实`);
  }
  assertDeclared(zcodeAdapter, ZCODE_MCP_EXEC_PREFIXES, 'zcode');
});

test('zcode：三个阶段都只多出点名禁令那一行，其余逐字不变；八个标题仍是八个', () => {
  for (const stage of ['plan', 'code', 'bug'] as const) {
    const withBan = brief(zcodeAdapter, zcodeAdapter.mcpExecPrefixes ?? [], stage);
    const without = brief(zcodeAdapter, [], stage);
    const line = banLine(section7(withBan));
    assert.equal(withBan.replace(`${line}\n`, ''), without, `${stage}：去掉那一行后应与不声明时逐字相同`);
    assert.equal((withBan.match(/^## \d\. /gm) ?? []).length, 8, '段落数是契约');
  }
});

test('其余三家真实适配器与两种缺省桩：不声明，第 7 节与改前相同', () => {
  const cases: [CriticAdapter, string][] = [
    [agyAdapter, 'gemini（agy）'],
    [claudeAdapter, 'claude'],
    [codexAdapter, 'codex'],
    [makeStubAdapter('glm', { mode: 'ok' }), '桩 ok'],
    [makeStubAdapter('gemini', { mode: 'command_trace' }), '桩 command_trace'],
  ];
  for (const [a, label] of cases) assertUndeclared(a, label);
});

test('只读 shell + 有声明：点名禁令照常渲染、紧跟只读 shell 那条（桩覆盖在非缺省 mode 下也生效）', () => {
  const a = makeStubAdapter('gemini', { mode: 'command_trace', mcpExecPrefixes: ['mcp__x__'] });
  assert.equal(a.commandExecution, 'readonly-shell');
  assert.deepEqual(a.mcpExecPrefixes, ['mcp__x__']);
  assertDeclared(a, ['mcp__x__'], 'command_trace + 声明');
  const s7 = section7(brief(a));
  assert.ok(!s7.includes('**你这一侧没有执行命令的能力**'), '不应混入 none 的说法');
});

test('多前缀：两项用「或」，三项及以上前面用顿号、最后一项前用「或」', () => {
  /*
   * 单前缀格用桩，不拿 zcode 的真实名单做字面断言（代码双审 CODEX-03）：名单本身由 zcode-mcp-detect U1 逐字钉住，
   * 按「实见才增」加一项时不该在这个叫「多前缀」的用例里红
   */
  const cases: [string[], string][] = [
    [['mcp__a__'], '（名字以 `mcp__a__` 开头）'],
    [['mcp__a__', 'mcp__b__'], '（名字以 `mcp__a__` 或 `mcp__b__` 开头）'],
    [['mcp__a__', 'mcp__b__', 'mcp__c__'], '（名字以 `mcp__a__`、`mcp__b__` 或 `mcp__c__` 开头）'],
  ];
  for (const [prefixes, want] of cases) {
    for (const p of prefixes) assert.match(p, PREFIX_SHAPE, `用例里的前缀 ${p} 也要过形状判据`);
    const line = banLine(section7(brief(makeStubAdapter('glm', { mode: 'ok', mcpExecPrefixes: prefixes }))));
    assert.ok(line.includes(want), `${prefixes.length} 项：\n${line}`);
  }
});

test('真实适配器凡声明了执行型 MCP 前缀的，每项都是 mcp__〈server〉__ 形状（下一家声明时同样被管住）', () => {
  /*
   * 代码双审 GLM-01：前缀直接包进反引号拼进任务书，含反引号或 Markdown 记号会让那一行结构损坏，而特征句断言照绿。
   * 不在渲染函数里加抛出路径（今天的值是仓库内常量），改为对全部真实适配器的声明做形状对账
   */
  const declared = Object.values(realAdapters()).filter((a) => a !== undefined && Object.hasOwn(a, 'mcpExecPrefixes'));
  assert.ok(declared.length > 0, '至少 zcode 一家声明');
  for (const a of declared) {
    const prefixes = a!.mcpExecPrefixes!;
    assert.ok(prefixes.length > 0, `${a!.critic}：声明了就不该是空数组（不声明即可）`);
    for (const p of prefixes) assert.match(p, PREFIX_SHAPE, `${a!.critic}：前缀 ${p} 不是 mcp__〈server〉__ 形状`);
  }
});

test('显式给空数组：与不声明同样不渲染', () => {
  const a = makeStubAdapter('glm', { mode: 'ok', mcpExecPrefixes: [] });
  const s7 = section7(brief(a));
  for (const m of BAN_MARKS) assert.ok(!s7.includes(m), `空声明不应渲染「${m}」`);
  assert.equal(bulletsOf(s7).length, BASE_COUNT + 2);
});
