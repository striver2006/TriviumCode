/**
 * Claude Code 适配器（M9 第 3 步，`adapters/claude.ts`）。
 *
 * 形态对位 `codex-adapter.test.ts`：argv / 回读 / 能力对账 / 组装 / 可用性分族。
 * **本批只覆盖「下半身」**（参数拼装与派生的纯函数）；`claudeAdapter` 各成员的
 * 用例随第 8 步一并补。分两批的理由见 `adapters/claude.ts` 的文件头。
 *
 * 本文件**可以**写出只读旗标的字面量：`registry-parity` 第 6 条的扫描根是
 * `src/trivium/adapters`，不含 `test/`。但下面一律改用探针导出的常量做输入——
 * 字面量写进用例就多出一份会漂移的副本，而这一族正是本主题反复在修的东西。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ASSET_ROOT, REPO_ROOT } from '../helpers/fixture.js';
import {
  buildClaudeArgs,
  buildClaudeResult,
  claudeAdapter,
  buildDenySettings,
  denyRuleShapeOf,
  readonlyArgsFromProbe,
  readonlyToolsFromProbe,
  readSchemaJson,
  stripMetaSchemaRef,
} from '../../src/trivium/adapters/claude.js';
import { READONLY_INVARIANTS, judgeToolSurface } from '../../src/trivium/probes/claude.js';
import { CLAUDE_OUTPUT_TOOLS, parseClaudeEvents } from '../../src/trivium/adapters/claude-trace.js';

/** 一组最小入参，各用例按需覆盖 */
const base = {
  model: 'claude-haiku-4-5-20251001',
  readonlyArgs: readonlyArgsFromProbe(READONLY_INVARIANTS),
  schemaJson: null,
  settingsJson: null,
  maxBudgetUsd: null,
};

// ───────────────────────────── argv 族 ─────────────────────────────

test('A1 argv：stream-json 与 --verbose 恒同时在场（两者绑定，且不看探针字段）', () => {
  const args = buildClaudeArgs(base);
  const i = args.indexOf('--output-format');
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], 'stream-json');
  assert.ok(
    args.includes('--verbose'),
    '不带 --verbose 时 CLI 直接拒绝（2.1.273 实测：退 1、零事件、零 API 调用）',
  );

  /*
   * **`--verbose` 是无条件的，不读 `stream_json_requires_verbose` 决定传不传。**
   * 那个字段的消费方是漂移可见性，不是参数构造。按它动态拼参会把监视器变成
   * 控制器：厂商解除绑定那天字段翻 false ⇒ 我们不传了 ⇒ 再也观测不到它何时绑回去。
   * `buildClaudeArgs` 的入参里**根本没有那个字段**，这条在类型层就成立。
   */
});

test('A2 argv：prompt 不进 argv，且末位不是 `-`（形态 A，不依赖未验的约定含义）', () => {
  const args = buildClaudeArgs(base);
  assert.ok(!args.includes('-'), '取形态 A：不带位置参数；形态 B 的 `-` 语义本步未验');
  assert.ok(
    !args.some((a) => a.length > 500),
    '送审包是几十 KB 量级，出现在 argv 里说明 prompt 走错了通道',
  );
  // 入参里压根没有 prompt 这一项，形态在类型层就钉住了
  assert.ok(!('prompt' in base));
});

test('A3 argv：只读旗标原样、按序透传，不重排不增删', () => {
  const args = buildClaudeArgs(base);
  const expected = [...READONLY_INVARIANTS];
  const at = args.indexOf(expected[0]!);
  assert.notEqual(at, -1, '只读旗标应当出现在 argv 里');
  assert.deepEqual(
    args.slice(at, at + expected.length),
    expected,
    '判据二：claude 的 readonly_flags 是可直接使用的 argv 片段，必须原样透传——' +
      '字面重建等于把「实测证明它管用」换成「文档上写着它应该管用」',
  );
});

test('A3b argv：探针没给只读旗标时不凭空补默认值', () => {
  const args = buildClaudeArgs({ ...base, readonlyArgs: readonlyArgsFromProbe([]) });
  // 只剩机制类旗标，一个安全不变量都不许被「补」出来
  assert.deepEqual(args, ['--print', '--output-format', 'stream-json', '--verbose', '--model', base.model]);
});

test('A4 argv：--json-schema 收的是 schema 内容，不是 schema_path', () => {
  const schemaJson = '{"type":"object"}';
  const args = buildClaudeArgs({ ...base, schemaJson });
  const i = args.indexOf('--json-schema');
  assert.notEqual(i, -1);
  assert.equal(
    args[i + 1],
    schemaJson,
    '实测传路径当场被拒：--json-schema is not valid JSON: Unrecognized token \'/\'',
  );
  assert.ok(
    !args.some((a) => a.includes('/') && a.endsWith('.json')),
    'argv 里不该出现任何看起来像 schema 文件路径的项',
  );
});

test('A5 argv：没有 schema 内容时不传 --json-schema（降级路径真实存在）', () => {
  assert.ok(!buildClaudeArgs({ ...base, schemaJson: null }).includes('--json-schema'));
});

test('A5b argv：没有 deny settings 时不传 --settings', () => {
  assert.ok(!buildClaudeArgs({ ...base, settingsJson: null }).includes('--settings'));
});

test('A5c argv：成本闸门是准入脚本专用，生产路径不传', () => {
  assert.ok(!buildClaudeArgs(base).includes('--max-budget-usd'), 'CriticRequest 没有这个字段');
  assert.ok(buildClaudeArgs({ ...base, maxBudgetUsd: '0.20' }).includes('--max-budget-usd'));
});

// ─────────────────────── 白名单派生族（裁决件 §2.10 的落点） ───────────────────────

test('A6 派生：从只读旗标运行时取出工具白名单，零字面量', () => {
  const tools = readonlyToolsFromProbe(READONLY_INVARIANTS);
  assert.ok(tools.length >= 2, `应当派生出多个读工具，实得 ${JSON.stringify(tools)}`);
  assert.ok(
    tools.every((t) => !t.startsWith('-')),
    '旗标名不是工具名',
  );
});

test('A6b 同源对账：适配层派生的白名单与探针自己的期望集完全一致（计划 §8.2）', () => {
  /*
   * 两套口径此前没有任何对账：探针侧 `judgeToolSurface` 用它自己的常量作期望集，
   * 适配器侧从 `readonly_flags` 运行时派生。两者今天同值是因为 `readonly_flags`
   * 就是那份常量——但「同源」这件事没有任何东西守着。
   *
   * 这里不去导出探针的私有常量（那会多一份可漂移的暴露面），而是**把派生结果
   * 喂给探针自己的判据**：判定为「完全一致」即证明两套口径同源。
   */
  const derived = readonlyToolsFromProbe(READONLY_INVARIANTS);
  const v = judgeToolSurface(derived);
  assert.deepEqual(v.extra, [], '适配层派生出了探针期望之外的工具');
  assert.deepEqual(v.missing, [], '适配层派生漏掉了探针期望内的工具');
  assert.equal(v.empty, false);
  assert.equal(v.clean, true, '两套口径必须同源，否则 write_events 判据与探针结论会分叉');
});

test('A6c 同源对账：探针期望集 = 白名单 ∪ 输出通道——带 --json-schema 的真实工具面判 clean', () => {
  /*
   * M9 第 6 步代码双审 CODEX-01 ≡ AGY-01 ≡ GLM-01：适配器豁免了 StructuredOutput，
   * 探针的 judgeToolSurface 不认它，EV-75 的两臂合并一落地就会把该侧判不可用。
   * 这里喂的是验收 run 20260919T120643Z 的真实 init.tools。
   */
  const realInitTools = [...readonlyToolsFromProbe(READONLY_INVARIANTS), ...CLAUDE_OUTPUT_TOOLS];
  const v = judgeToolSurface(realInitTools);
  assert.equal(v.clean, true, '输出通道不得被判成白名单外工具');
  assert.deepEqual(v.extra, []);
  assert.deepEqual(v.outputChannel, [...CLAUDE_OUTPUT_TOOLS].sort(), '放行的是哪个通道要说出来，不能悄悄抹掉');
  assert.deepEqual(v.missing, []);
});

test('A6d 同源对账：豁免只对输出通道——真写工具仍进 extra（变异守卫）', () => {
  const v = judgeToolSurface([...readonlyToolsFromProbe(READONLY_INVARIANTS), ...CLAUDE_OUTPUT_TOOLS, 'Write']);
  assert.equal(v.clean, false, '把「输出通道」写成「白名单外一律放行」会让这条红');
  assert.deepEqual(v.extra, ['Write']);
  assert.deepEqual(v.outputChannel, [...CLAUDE_OUTPUT_TOOLS].sort());
});

test('A6e 同源对账（grep 级）：输出通道的名字只能来自 claude-trace 的 import，探针与适配器不得自写一份', async () => {
  /*
   * 第 2 轮 CODEX-F01-④ ≡ AGY-02 ≡ GLM-01：把 import 换成同内容的本地 `new Set(['StructuredOutput'])`，
   * A6c/A6d/A29/A30 全绿——同源只靠「探针只 import」这条纪律。本仓对这类纪律的既定对策是
   * grep 级对账（registry-parity 先例）。判据：除定义处外，源码里不得出现该名字的字面量。
   * 注释里提到它是允许的——扫的是引号包住的字面串。
   */
  const { readFile } = await import('node:fs/promises');
  const defined = path.join(REPO_ROOT, 'src/trivium/adapters/claude-trace.ts');
  const consumers = ['src/trivium/probes/claude.ts', 'src/trivium/adapters/claude.ts'].map((p) => path.join(REPO_ROOT, p));
  for (const name of CLAUDE_OUTPUT_TOOLS) {
    // 只扫单/双引号字面串：注释里用反引号提到它是允许的（那是说它，不是写它）
    const literal = new RegExp(`['"]${name}['"]`);
    assert.match(await readFile(defined, 'utf8'), literal, `定义处必须以字面量登记 ${name}`);
    for (const f of consumers) {
      assert.doesNotMatch(await readFile(f, 'utf8'), literal, `${path.basename(f)} 自写了 ${name} 的字面量——事实只能从 claude-trace import`);
    }
  }
});

test('A7 派生：空输入得空集（fail-closed 的前半，绝不回落默认工具集）', () => {
  assert.deepEqual(readonlyToolsFromProbe([]), []);
  assert.deepEqual(
    readonlyToolsFromProbe(['--some-flag']),
    [],
    '只有旗标名、没有值时同样是空集——把「没测到」补成一个默认集合是本主题连修四轮的那个形状',
  );
});

test('A8 派生：已知边界——对非工具列表的值不设防（换家时要复核）', () => {
  /*
   * 判据是「不以 `-` 开头的元素按逗号切」。若某家的 readonly_flags 里有
   * 另一个不以 `-` 开头的值（如 codex 的沙箱模式值），它会被当成工具名。
   * 本家落盘形态下不发生（唯一的非旗标值就是工具列表），但这条边界要登记，
   * 而不是等换家时才发现。
   */
  assert.deepEqual(readonlyToolsFromProbe(['-s', 'some-mode-value']), ['some-mode-value']);
});

// ─────────────────────── deny 规则族（EV-42 的注入侧） ───────────────────────

test('A19 规则外壳：认得本机落盘的真实 rule_syntax，认不得畸形串', () => {
  // 本机落盘形态：目录 glob，带 ./ 前缀
  const shape = denyRuleShapeOf('Read(./.reviews/probe-topic/plan/**)');
  assert.notEqual(shape, null);
  assert.equal(shape!.relPrefix, './');
  assert.ok(shape!.sampleTool.length > 0);

  // 不带 ./ 的形态也认，前缀记为空
  assert.equal(denyRuleShapeOf('Read(/abs/path/**)')!.relPrefix, '');

  // 认不出来就是认不出来，不猜一个形状硬拼
  assert.equal(denyRuleShapeOf(null), null);
  assert.equal(denyRuleShapeOf(''), null);
  assert.equal(denyRuleShapeOf('not a rule'), null);
  assert.equal(denyRuleShapeOf('Read('), null);
});

test('A20 规则生成：三种 deny 条目形状各自的落地形态', () => {
  const shape = denyRuleShapeOf('Read(./.reviews/probe-topic/plan/**)')!;
  const tools = ['ToolA', 'ToolB'];
  const built = buildDenySettings(
    [
      '.reviews/t/plan/2026-01-01-t-glm.md', // ① 项目相对文件
      '.trivium', // ② 项目相对目录（enumerateDenyPaths 无条件加）
      '/Users/x/.trivium/runs', // ③ 项目外绝对路径（同上，从未测过）
    ],
    tools,
    shape,
  );
  assert.notEqual(built.json, null);
  const deny = (JSON.parse(built.json!) as { permissions: { deny: string[] } }).permissions.deny;
  assert.equal(built.ruleCount, deny.length, 'ruleCount 必须与真实规则数一致');
  assert.ok(built.bytes > 0, 'bytes 要记——它是 ARG_MAX 预算的主要消费者，只记条数看不出规模');
  assert.deepEqual(built.skipped, [], '这三条都能表示成规则');

  // 每个读工具一条规则：实测结论是规则**按工具生效**，只挡一个工具就会被换工具绕过
  for (const t of tools) {
    assert.ok(deny.some((r) => r.startsWith(`${t}(`)), `工具 ${t} 没有对应规则`);
  }

  // ①② 项目相对：补探针实测形态的 ./ 前缀
  assert.ok(deny.includes('ToolA(./.reviews/t/plan/2026-01-01-t-glm.md)'));
  assert.ok(deny.includes('ToolA(./.trivium)'));
  // ③ 项目外绝对路径：原样，不补前缀
  assert.ok(deny.includes('ToolA(/Users/x/.trivium/runs)'));
  assert.ok(!deny.some((r) => r.includes('./Users/')), '绝对路径不得被当成相对路径拼前缀');

  /*
   * 每条路径同时下「精确」与「子树」两条：deny_paths 是扁平字符串数组，
   * **丢失了「这条是文件还是目录」的信息**。用扩展名去猜不可靠；两条都下时，
   * 多出来的那条匹配不到任何东西、无害，而漏掉则是一条禁读通道静默失效。
   */
  assert.ok(deny.includes('ToolA(./.trivium/**)'), '目录条目要有子树规则');
  assert.ok(deny.includes('ToolA(/Users/x/.trivium/runs/**)'));
});

test('A20b 规则生成：三种「拼不出来」的情形一律不注入，由调用方记原因', () => {
  const shape = denyRuleShapeOf('Read(./x/**)')!;
  assert.equal(buildDenySettings(['a'], ['ToolA'], null).json, null, '外壳解析不出 ⇒ 不注入');
  assert.equal(buildDenySettings(['a'], [], shape).json, null, '白名单为空 ⇒ 不注入');
  assert.equal(buildDenySettings([], ['ToolA'], shape).json, null, '没有禁读路径 ⇒ 不注入');
});

test('A21 规则生成：会破坏规则语法的路径被跳过并逐条记名（CODEX-02）', () => {
  /*
   * `validateTopic` 实测放行 `M9(收口)` / `a,b` / `fix*`，所以带括号的路径**可达**。
   * 裸拼会生成 `Read(./.reviews/M9(收口)/x.md)`——括号嵌套，破坏规则语法。
   *
   * 两种可能结局都不好且都不可见：CLI 拒整份 settings（本次审查失败），
   * 或逐条静默丢弃（禁读通道死一条而没人看见）。所以**生成前就挡，并记名**。
   */
  const shape = denyRuleShapeOf('Read(./x/**)')!;
  const built = buildDenySettings(
    ['.reviews/ok/plan/a.md', '.reviews/M9(收口)/plan/b.md', 'has\nnewline'],
    ['ToolA'],
    shape,
  );
  assert.deepEqual(
    built.skipped,
    ['.reviews/M9(收口)/plan/b.md', 'has\nnewline'],
    '拼不出能字面匹配自身的规则的路径要被跳过并记名，而不是拼出一条畸形规则',
  );
  const deny = (JSON.parse(built.json!) as { permissions: { deny: string[] } }).permissions.deny;
  assert.ok(deny.every((r) => !r.includes('(收口)')), '畸形规则一条都不许进');
  assert.equal(built.ruleCount, 2, '只剩那条合法路径的精确 + 子树两条');
});

test('A21b 规则生成：不可表示集合的**每一个字符**都要挡住（AGY-05）', () => {
  /*
   * **这是本轮唯一的 test-gap，且它守的是一次「按审查意见做的修改」。**
   *
   * A21 只断言圆括号与换行两格，而判据在 r2 扩到 `[ ] { } * ? !`、
   * r3 又扩到逗号/空格/反斜杠。于是把黑名单**退回 r1 版本**（`( ) \n \r`）
   * 不会让任何用例变红——那次修复此刻没有任何东西守着，
   * 正是「加了守卫不等于守卫被守着」的又一个实例。
   *
   * 逐字符各一格，退任何一个字符都当场红。
   */
  const shape = denyRuleShapeOf('Read(./x/**)')!;
  const cases: Array<[string, string]> = [
    ['圆括号', '.reviews/M9(收口)/plan/a.md'],
    ['方括号（glob 字符类，匹配不到自身，比圆括号更隐蔽）', '.reviews/M9[3]/plan/a.md'],
    ['花括号（glob 展开）', '.reviews/M9{a,b}/plan/a.md'],
    ['星号（过匹配，连坐同前缀目录）', '.reviews/fix*/plan/a.md'],
    ['问号（单字符通配）', '.reviews/M9?/plan/a.md'],
    ['叹号（部分方言里的取反）', '.reviews/!M9/plan/a.md'],
    ['反斜杠（walkSensitive 派生，转义语义未实测，保守挡）', 'docs/we\\ird.pem'],
    ['换行（破坏 JSON 行结构）', 'has\nnewline'],
    ['回车', 'has\rcr'],
  ];

  const leaked: string[] = [];
  for (const [why, p] of cases) {
    const built = buildDenySettings([p], ['ToolA'], shape);
    if (built.skipped.length !== 1 || built.json !== null) leaked.push(`${why} → ${p}`);
  }
  assert.deepEqual(
    leaked,
    [],
    '这些形状穿过了语法门：会生成一条匹配不到自身的规则，且 skipped 为空 ⇒ fail-open 且不可见',
  );

  /*
   * **反向：逗号与空格必须放行**（EV-49 实测，2.1.276）。
   *
   * r3 首版按审查意见把这两个也挡了，理由是「可达且未测，保守超集代价小」。
   * 随后的实测臂（deny-dialect 用例）把它推翻了：两者的规则**照常生效**
   * （哨兵未泄漏 + 进 permission_denials），这个方言把路径当字面量处理。
   *
   * 于是挡它们是**净损失**——本可正常屏蔽的路径，规则被白白丢掉。
   * `docs/My Key.pem` 这类从 walkSensitive 直接派生的敏感文件尤其吃亏，
   * 那是最不该丢规则的一类。
   *
   * 这条断言的方向是**反的**：它守的是「别再挡回去」。
   */
  for (const [why, p] of [
    ['逗号（EV-49 实测：规则照常生效）', '.reviews/a,b/plan/a.md'],
    ['空格（同上；且这类路径来自 walkSensitive，最不该丢规则）', 'docs/My Key.pem'],
  ] as Array<[string, string]>) {
    const built = buildDenySettings([p], ['ToolA'], shape);
    assert.deepEqual(built.skipped, [], `${why} 不得被挡——实测证明这条规则能生效`);
    assert.notEqual(built.json, null, `${why} 必须真的注入规则`);
  }

  // 合法路径不得被误挡（挡过头会让那条禁读通道整条消失）
  const ok = buildDenySettings(['.reviews/M9-适配器本体与准入收口/plan/a.md'], ['ToolA'], shape);
  assert.deepEqual(ok.skipped, [], '常规路径（含中文）不得被这张黑名单误伤');
});

test('A22 规则生成：非 ASCII 路径不得被挡（本次运行 270 条里 267 条是中文主题名）', () => {
  /*
   * **非 ASCII 一律放行**，这是不可表示集合唯一明确排除的一类：
   * 本次运行的 270 条里 267 条是中文主题名，挡掉它们等于把禁读通道整个关上，
   * 那比语法风险更糟。
   *
   * 注意与 A21b 的分工：那边锁「该挡的都挡住」，这边锁「不该挡的没误伤」。
   * 上一版这里的注释写着「星号、逗号一律放行」——而 r2 已挡星号、r3 已挡逗号，
   * **注释与实现相反地并存了整整一轮**（r3 AGY-05）。
   */
  const shape = denyRuleShapeOf('Read(./x/**)')!;
  const built = buildDenySettings(['.reviews/M9-适配器本体与准入收口/plan/a.md'], ['ToolA'], shape);
  assert.deepEqual(built.skipped, []);
  assert.ok(built.json!.includes('适配器本体'), '中文路径必须照常进规则');
});

test('A23 规则生成：重复路径去重（每条都会展开成 工具数 × 2 条）', () => {
  const shape = denyRuleShapeOf('Read(./x/**)')!;
  const built = buildDenySettings(['a.md', 'a.md', 'b.md'], ['ToolA'], shape);
  assert.equal(built.ruleCount, 4, '两条不同路径 × 2 条规则，重复的那条不得翻倍');
});

// ─────────────────────── 组装族（A9–A14）───────────────────────

/** 最小可用轨迹：一次成功的 Read + result */
function traceOf(extra: { initModel?: string | null; uses?: unknown[]; errored?: string[] } = {}) {
  const uses = extra.uses ?? [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/p/a.ts' } }];
  const lines = [
    JSON.stringify({
      type: 'system', subtype: 'init', session_id: 's1',
      model: extra.initModel === undefined ? 'claude-haiku-4-5-20251001' : extra.initModel,
      tools: [], permissionMode: 'default',
    }),
    JSON.stringify({ type: 'assistant', message: { content: uses } }),
    ...(extra.errored ?? []).map((id) =>
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'denied' }] } })),
    JSON.stringify({ type: 'result', subtype: 'success', result: '{"ok":1}', total_cost_usd: 0.01, permission_denials: [] }),
  ];
  return parseClaudeEvents(lines.join('\n'));
}

const OUT = { exitCode: 0, durationMs: 2000, commandLine: 'claude -p …' };
const PATHS = { stdout: '/run/stdout.jsonl', trace: '/run/trace.json' };
const PROBE_OK = { version: '2.1.276', path_deny: { file_shape_verified: true } };
const TOOLS = readonlyToolsFromProbe(READONLY_INVARIANTS);
/** 默认：本次注入没有跳过项（含跳过项的断言见 A24） */
const NO_DENY = { ruleCount: 6, skipped: [] as string[], bytes: 0 };

test('A9 组装：回读到生效模型 → 来源记 envelope（不是 trace）', () => {
  const r = buildClaudeResult(traceOf(), OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.equal(r.model_effective, 'claude-haiku-4-5-20251001');
  assert.equal(
    r.model_effective_source,
    'envelope',
    'system/init 是事件流自身的事件（与 agy 同形）；zcode/codex 记 trace 是因为读的是另一个文件',
  );
});

test('A10 组装：回读不到 → unverified，且绝不用 requested 冒充', () => {
  const r = buildClaudeResult(traceOf({ initModel: null }), OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.equal(r.model_effective, null, '拿不到就是拿不到');
  assert.equal(r.model_effective_source, 'unverified');
  /*
   * 这条要能被 M4 变异打中，所以判定必须在**纯函数**里而不是埋在 run()。
   * codex 侧实测过：埋在 run() 时把 `?? req.model` 改下去，全量用例无一变红——
   * 冒充的后果不是数字难看，是 AC-20 那条验收永远通过、永远没有意义。
   */
  assert.notEqual(r.model_effective, 'claude-haiku-4-5-20251001');
});

test('A11 组装：白名单外工具的 tool_use 进 write_events', () => {
  const t = traceOf({
    uses: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/p/breach.txt' } }],
    errored: ['w1'],
  });
  const r = buildClaudeResult(t, OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.equal(r.write_events.length, 1);
  assert.match(r.write_events[0]!, /^Write\(/);
  assert.match(r.write_events[0]!, /breach\.txt/, '路径要带上，便于事后定位');
});

test('A12 组装：白名单内工具即使被 deny 挡住也不算失守', () => {
  // 被路径级 deny 挡下的 Read：is_error 为真，但它是**白名单内**工具
  const t = traceOf({ errored: ['r1'] });
  const r = buildClaudeResult(t, OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.deepEqual(r.write_events, [], '被挡下的读不是写失守——判据看工具名，不看成功与否');
  assert.deepEqual(r.read_paths, [], '但它也不算读到了东西');
  assert.deepEqual(r.tool_calls, { read: 0, grep: 0, glob: 0, run_command: 0 });
});

test('A13 组装：permission_denials 为空但有白名单外调用 ⇒ 仍判失守', () => {
  /*
   * 实测（M9 第 1 步报告 §3.1 第 2 条）：白名单外工具走「工具不存在」路径，
   * 那次 result.permission_denials 是**空数组**，拒绝信息在 tool_result 里。
   * 判据若扫 denials 就会恒为空——扫错地方等于这条判据不存在。
   */
  const t = traceOf({ uses: [{ type: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'rm -rf /' } }] });
  assert.deepEqual(t.permissionDenials, [], '前提：本样本 denials 确实为空');
  const r = buildClaudeResult(t, OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.equal(r.write_events.length, 1, 'denials 为空不影响失守判定');
});

test('A14 组装：peer_deny_applied 读 file_shape_verified 的三态', () => {
  const t = traceOf();
  assert.equal(buildClaudeResult(t, OUT, PATHS, PROBE_OK, TOOLS, NO_DENY).peer_deny_applied, true);
  assert.equal(
    buildClaudeResult(t, OUT, PATHS, { version: null, path_deny: { file_shape_verified: null } }, TOOLS, NO_DENY).peer_deny_applied,
    false,
    'null（没验过）必须判不过 === true——这是 EV-42 的安全默认，由结构保证',
  );
  assert.equal(
    buildClaudeResult(t, OUT, PATHS, { version: null, path_deny: { file_shape_verified: false } }, TOOLS, NO_DENY).peer_deny_applied,
    false,
    'false（否定结案）同样判不过',
  );
});

test('A14b 组装：覆盖率两个计数无条件填，且 command_texts 恒空', () => {
  const r = buildClaudeResult(traceOf(), OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.equal(r.path_bearing_reads, 1);
  assert.equal(r.path_bearing_reads_with_path, 1);
  assert.ok('path_bearing_reads' in r, '省略键会让 verification.path 档位恒为 ok——等于拿 ok 填「不知道」');
  assert.deepEqual(r.command_texts, [], '该侧工具面里没有命令工具，措施 b 在本侧无输入');
  assert.equal(r.model_provider, null, '该族 CLI 不暴露 provider 归属——能说明理由的空');
  assert.equal(r.profile_requested, null, '该族没有厂商 profile 概念');
});

test('A14c 组装：白名单为空 ⇒ 抛而不是产出一个看起来干净的结论（fail-closed 后半）', () => {
  assert.throws(
    () => buildClaudeResult(traceOf(), OUT, PATHS, PROBE_OK, [], NO_DENY),
    /失守检测在本侧已失效/,
    '空白名单时 write_events: [] 说的不是「没有失守」，而是「检测已经死掉」',
  );
});

// ─────────────────────── 能力与可用性族（A15–A18）───────────────────────

test('A15 能力：tool-trace + rejectionRecorded true（被拒的调用留在轨迹里）', () => {
  assert.equal(claudeAdapter.capability.traceShape, 'tool-trace');
  assert.equal(
    claudeAdapter.capability.rejectionRecorded,
    true,
    '依据是 M9 第 1 步的正向样本；探针那格偶尔落 null 是「没测到」，不构成反证',
  );
});

test('A16 取舍：三个可选成员刻意不实现——「不实现」是决定，不是遗漏', () => {
  assert.equal(claudeAdapter.scrubRunDir, undefined, '凭据在系统钥匙串，运行目录无副本；空实现会把「没得抹」伪装成「抹过了」');
  assert.equal(claudeAdapter.catalogModelsFor!({} as never)?.kind, 'unverifiable', '配置模型名单不是服务端目录');
  assert.equal(claudeAdapter.normalizeModelForCatalog, undefined, 'slug 无需归一');
});

test('A17 探活显式实现，路线指纹与凭据轮换在接入测试中验证', () => {
  assert.equal(typeof claudeAdapter.authProbe, 'function');
});

test('A18 可用性：各档不可用理由互不混淆，且 null 与 false 分开答', () => {
  const mk = (claude: unknown) => ({ cfg: { agents: {}, probe: { cli: { claude } } }, nodePath: '/x/node' }) as never;
  const base = {
    probed_at: '2026-09-18T00:00:00Z', entrypoint: process.execPath,
    readonly_flags: [...READONLY_INVARIANTS], strict_mcp_config_applied: true,
    headless_read_ok: true, tool_surface_checked: true,
  };
  const reason = (o: Record<string, unknown>) => claudeAdapter.availability(mk({ ...base, ...o })).reason ?? '';

  assert.equal(claudeAdapter.availability(mk(base)).ok, true, '齐备 ⇒ 可用');
  assert.match(reason({ probed_at: null }), /尚未探测/);
  assert.match(reason({ entrypoint: null }), /未找到/);
  assert.match(reason({ readonly_flags: [] }), /只读旗标/);
  assert.match(reason({ strict_mcp_config_applied: null }), /没核对成/, 'null 要说成「没核对成」');
  assert.match(reason({ strict_mcp_config_applied: false }), /确认不在/, 'false 要说成「确认不在」');
  assert.match(reason({ headless_read_ok: false }), /读不到文件/);
  assert.match(reason({ headless_read_ok: null }), /没跑完/, '「没测到」与「测出来不行」两句话');
  assert.match(reason({ tool_surface_checked: null }), /核对过生效工具面/);
  assert.match(reason({ tool_surface_checked: false }), /核对过生效工具面/);
  // 白名单派生不出来：旗标非空但里面没有工具列表
  assert.match(reason({ readonly_flags: ['--restricted', '--strict-mcp-config'] }), /派生不出工具白名单/);
});

test('A24 语法门：glob 元字符一律跳过（判据是「能否字面匹配」，不是「破坏语法」）', () => {
  /*
   * 代码双审 r2 CODEX-02 ≡ GLM-04：上一版只挡圆括号与换行，判据是「破坏语法」。
   * 而规则体是 glob，决定挡不挡得住的是**语义**：
   *   Read(./.reviews/M9[3]/code/a.md)  —— [3] 是字符类，匹配不到它自己那条字面路径
   * 而且它 skipped 为空，比圆括号更隐蔽：「逐条记名」机制对它完全不可见。
   */
  const shape = denyRuleShapeOf('Read(./x/**)')!;
  const built = buildDenySettings(
    [
      '.reviews/ok/plan/a.md',
      '.reviews/M9[3]/plan/b.md', // 字符类：fail-open
      '.reviews/fix*/plan/c.md', // 过匹配：连坐同前缀
      '.reviews/q?/plan/d.md',
      '.reviews/M9(收口)/plan/e.md', // 破坏配对（上一版已挡）
    ],
    ['ToolA'],
    shape,
  );
  assert.equal(built.skipped.length, 4, '四条带元字符或括号的都要跳过');
  assert.equal(built.ruleCount, 2, '只剩那条干净路径的精确 + 子树');
  const deny = (JSON.parse(built.json!) as { permissions: { deny: string[] } }).permissions.deny;
  for (const bad of ['[3]', 'fix*', 'q?', '(收口)']) {
    assert.ok(!deny.some((r) => r.includes(bad)), `${bad} 不许进规则`);
  }
});

test('A25 判定面：跳过条数与规则数进 CriticResult（不再只躺在 trace.json）', () => {
  /*
   * r2 CODEX-01：peer_deny_applied 读探针格，对本次这批规则一无所知。
   * 「主题名带一个括号 ⇒ 这一次每条对端产出都被跳过」在判定面上完全看不见——
   * 落盘仍 true，report 的降级旗标只在它为 false 时推。
   */
  const r = buildClaudeResult(traceOf(), OUT, PATHS, PROBE_OK, TOOLS, {
    ruleCount: 4,
    skipped: ['.reviews/M9(收口)/plan/a.md', '.reviews/M9[3]/plan/b.md'],
    bytes: 1234,
  });
  assert.equal(r.deny_skipped, 2, '跳过条数要进结果，report 据此推降级旗标');
  assert.equal(r.deny_rule_count, 4);
  /*
   * 字节数与另两格同路（代码双审 r3 GLM-08 ≡ CODEX-03）。
   * r2 承诺三格并列而只落两格，字节数困在 trace.json 里——
   * 而它才是 ARG_MAX 预算的主要消费者：条数看不出规模。
   */
  assert.equal(r.deny_bytes, 1234, '字节数必须与另两格同路进判定面，不能只活在 trace.json');
  assert.equal(
    r.peer_deny_applied,
    true,
    '前提：peer_deny_applied 仍是 true——正因如此才需要另一格把「本次跳过了」说出来',
  );
});

// ═══════════════════════ schema 头部：$schema 剥离（M9 第 6 步验收，EV-74）═══════════════════════

/**
 * 真实契约文件——用例必须喂它，不许再造一份迷你 schema（探针正是这么漏的）。
 * 路径走 `ASSET_ROOT`（`fileURLToPath` + 向上找 package.json），与其它 schema 用例同源；
 * `URL.pathname` 是百分号编码片段，仓库路径带中文即 ENOENT（代码双审 CODEX-05）。
 */
const REVIEW_SCHEMA_PATH = path.join(ASSET_ROOT, 'schema/review.v1.json');

test('A26 schema：真实 review.v1.json 带 2020-12 的 $schema，剥离后只少这一键', async () => {
  const raw = await (await import('node:fs/promises')).readFile(REVIEW_SCHEMA_PATH, 'utf8');
  const before = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(
    before['$schema'],
    'https://json-schema.org/draft/2020-12/schema',
    '前提：契约文件头部就是这条引用——它正是 claude 2.1.277 拒绝的那一句',
  );
  const after = JSON.parse(stripMetaSchemaRef(raw)) as Record<string, unknown>;
  assert.ok(!('$schema' in after), '顶层 $schema 必须被剥掉，否则 CLI 当场拒绝、零 API 调用');
  assert.equal(after['$id'], before['$id'], '$id 保留：实测只去 $id 不去 $schema 仍拒，去 $schema 留 $id 可过');
  const { $schema: _s, ...rest } = before;
  assert.deepEqual(after, rest, '除 $schema 外一字不动：契约内容不归本层改');
});

test('A27 schema：没有 $schema 的输入原样返回；非 JSON 也原样返回、不替 CLI 改写错误形态', () => {
  const plain = '{"type":"object","properties":{"first_line":{"type":"string"}}}';
  assert.equal(stripMetaSchemaRef(plain), plain, '探针那份迷你 schema 本来就过得了，不该被改动');
  const broken = '{not json';
  assert.equal(stripMetaSchemaRef(broken), broken, '坏 JSON 交给 CLI 自己报 is not valid JSON');
  assert.equal(stripMetaSchemaRef('[1,2]'), '[1,2]', '非对象顶层不碰');
});

// ═══════════════════════ 写事件：StructuredOutput 是输出通道，不是写（EV-75）═══════════════════════

test('A29 写事件：StructuredOutput 不算写——它是 --json-schema 下 CLI 注入的交付通道', () => {
  /*
   * M9 第 6 步验收 run 20260919T120643Z：init.tools 为 Glob/Grep/Read/StructuredOutput，
   * 模型调了 5 次 StructuredOutput 交付 JSON，被算成 5 次写、readonly_breach: true，
   * 而它一个字节都没落盘。
   */
  // 遍历常量构造，不写字面量：适配器内部若退化成 `u.name !== 'StructuredOutput'` 硬编码，
  // 常量再加一个名字时这里会红（第 2 轮 AGY-02）
  assert.ok(CLAUDE_OUTPUT_TOOLS.size > 0, '前提：常量非空，否则下面的遍历是空转');
  const uses = [
    { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/p/a.ts' } },
    ...[...CLAUDE_OUTPUT_TOOLS].flatMap((name, i) => [
      { type: 'tool_use', id: `s${i}a`, name, input: { schema: '{"verdict":"approve"}' } },
      { type: 'tool_use', id: `s${i}b`, name, input: { schema: 'trivium.review.v1', verdict: 'approve' } },
    ]),
  ];
  const r = buildClaudeResult(traceOf({ uses }), OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.deepEqual(r.write_events, [], '输出通道的调用不得进 write_events');
});

test('A30 写事件：豁免只对那一个名字——真写工具照旧算失守（变异守卫）', () => {
  const uses = [
    { type: 'tool_use', id: 's1', name: 'StructuredOutput', input: { verdict: 'approve' } },
    { type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/p/breach.txt', content: 'x' } },
  ];
  const r = buildClaudeResult(traceOf({ uses }), OUT, PATHS, PROBE_OK, TOOLS, NO_DENY);
  assert.equal(r.write_events.length, 1, '把豁免写成「白名单外一律不算」会让这条红');
  assert.match(r.write_events[0]!, /^Write\(/);
});

test('A28 schema：readSchemaJson 读真实文件后已剥离——调用方拿到的就是能进 --json-schema 的那一份', async () => {
  const s = await readSchemaJson(REVIEW_SCHEMA_PATH);
  assert.ok(!s.includes('json-schema.org/draft/2020-12'), '读侧出口不得再带元 schema 引用');
  // 正向锚点（第 2 轮 CODEX-F01-③）：否定式断言对空串同样成立，出口那份必须仍是真契约
  const parsed = JSON.parse(s) as { required?: string[]; properties?: Record<string, unknown> };
  assert.ok(Array.isArray(parsed.required) && parsed.required.length > 0, '出口产物退化成空对象时这条要红');
  assert.ok(parsed.properties && 'findings' in parsed.properties, '契约核心键 findings 必须还在');
  const args = buildClaudeArgs({ ...base, schemaJson: s });
  assert.equal(args[args.indexOf('--json-schema') + 1], s, '与 A4 同一条路：内容进 argv，不是路径');
});

test('A28b schema：buildClaudeArgs 是唯一出口——第二道剥壳即使已剥过一次仍是幂等的（CODEX-03，GLM-06 改准）', () => {
  const raw = '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object"}';
  const args = buildClaudeArgs({ ...base, schemaJson: raw });
  const sent = args[args.indexOf('--json-schema') + 1]!;
  assert.ok(
    !sent.includes('json-schema.org/draft/2020-12'),
    '出口处必须再剥一次——防未来新增调用方绕过 readSchemaJson，不是因为今天真有调用方绕过',
  );
  assert.equal(JSON.parse(sent).type, 'object');
});

/**
 * 2020-12 独有的关键字（draft-07 没有）。剥掉 $schema 后 CLI 按自己的方言校验，
 * 这些键会被静默忽略或直接拒——留痕分不出哪种（代码双审 CODEX-04 ≡ GLM-03）。
 *
 * **守卫论域是单向的**（第 2 轮 CODEX-F01-⑤ / GLM-03）：只查 2020-12 独有键。
 * draft-07 独有或跨方言语义变化的键——`dependencies`、tuple 形 `items`、布尔 `exclusiveMinimum`、
 * 以及 `$ref` 的兄弟键（draft-07 忽略、2020-12 应用）——不在这里，改契约时人工核。
 * 后者的可见症状是 parse 侧（Ajv2020）更严 → parse_fallback，吵而不静默，所以只记边界。
 */
const DRAFT_2020_ONLY_KEYWORDS = [
  '$defs', 'prefixItems', 'unevaluatedProperties', 'unevaluatedItems',
  'dependentSchemas', 'dependentRequired', '$anchor', '$dynamicRef', '$dynamicAnchor',
  '$recursiveRef', '$recursiveAnchor', 'minContains', 'maxContains', '$vocabulary',
];

function keywordsUsed(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) { for (const v of node) keywordsUsed(v, out); return out; }
  if (node === null || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out.add(k);
    // `properties` / `patternProperties` 的子键是属性名，不是关键字——不往集合里加，但要往下走
    if (k === 'properties' || k === 'patternProperties' || k === 'dependentSchemas' || k === '$defs') {
      if (v && typeof v === 'object') for (const sub of Object.values(v as Record<string, unknown>)) keywordsUsed(sub, out);
    } else {
      keywordsUsed(v, out);
    }
  }
  return out;
}

test('A31 契约金丝雀：送给 claude 的 review.v1.json 不用 2020-12 独有关键字', async () => {
  const sent = await readSchemaJson(REVIEW_SCHEMA_PATH);
  const doc = JSON.parse(sent) as Record<string, unknown>;
  const used = keywordsUsed(doc);
  /*
   * 正向锚点先行（第 2 轮 CODEX-F01-③ ≡ AGY-01）：下面的「不含」断言对空集恒真，
   * 出口产物退化成 `{}` 时会 vacuous 通过。先钉住被扫的确是那份真契约。
   */
  for (const k of ['type', 'properties', 'required']) assert.ok(used.has(k), `被扫产物缺少核心关键字 ${k}——不是真契约`);
  assert.ok(
    doc.properties && typeof doc.properties === 'object' && 'findings' in (doc.properties as object),
    '契约核心键 findings 必须在场',
  );
  const offending = DRAFT_2020_ONLY_KEYWORDS.filter((k) => used.has(k));
  assert.deepEqual(
    offending,
    [],
    `review.v1.json 用了 2020-12 独有关键字 ${offending.join('、')}：剥掉 $schema 后 claude CLI 会静默忽略或拒绝它，` +
      '生成侧约束与 parse 侧 Ajv2020 从此分叉。要么别用，要么同步改适配层策略（设计 §3.7 json_schema_ok 行）',
  );
  // 自证一：在**真实产物**的深拷贝里注入，扫描器必须报出来（不再用脱机小对象自证）
  const injected = JSON.parse(sent) as { properties: Record<string, Record<string, unknown>> };
  injected.properties['findings'] = { ...injected.properties['findings'], $defs: { x: { type: 'string' } } };
  assert.ok(DRAFT_2020_ONLY_KEYWORDS.filter((k) => keywordsUsed(injected).has(k)).includes('$defs'), '往真实契约里塞 $defs 必须被抓到');
  // 自证二：数组位也要下降（第 2 轮 GLM-03）——items / allOf / anyOf 里的关键字不能漏
  assert.ok(keywordsUsed({ allOf: [{ $anchor: 'x' }] }).has('$anchor'), '扫描器必须下降到数组位');
  assert.ok(keywordsUsed({ items: [{ prefixItems: [] }] }).has('prefixItems'));
});
