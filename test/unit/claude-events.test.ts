/**
 * Claude Code `--output-format stream-json` 事件流解析（M6 第 3 步）。
 *
 * 样本是 **2026-09-14 真跑录下来的**（`test/fixtures/claude-events/`）。
 *
 * 本组里有三条**锁事实**的用例。它们守的不是代码行为，而是
 * **我们据以做 M9 设计决策的三个前提**：读取路径有结构化字段、
 * 被拒的工具调用留在轨迹里、路径级 deny 真的挡得住。
 * 哪天它们红了，说明厂商改了行为，相应的设计结论要跟着改。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  READONLY_INVARIANTS,
  judgeDenyCoverage,
  probeArgs,
  verboseNegativeControlArgs,
  judgeStrictMcpConfig,
  judgeToolSurface,
  judgeVerboseBinding,
  judgeHeadlessRead,
  judgeTracePathStructured,
  judgeJsonSchema,
  judgeReadonlyBreach,
  judgeFileShape,
  judgeProjectMemoryBlocked,
  projectMemoryControlArgs,
} from '../../src/trivium/probes/claude.js';
/*
 * **解析器改从适配层取**（M9 第 3 步搬家）：`parseClaudeEvents` 与 `ClaudeTrace`
 * 已移到 `adapters/claude-trace.ts`，探针反向 import 它。
 *
 * 判据（`judge*`）仍在探针侧——它们是探针的结论产出，不是轨迹解析。
 * 这条 import 分成两行正是为了让这个分工在用例文件里也看得见。
 *
 * 本文件保留的是**搬家前就存在的那些用例**，它们逐字不变地继续跑：
 * 搬家零行为变化的安全网，就是「同一批断言搬家前绿、搬家后仍绿」。
 * 新增的提取/计数用例在 `claude-trace.test.ts`。
 */
import { parseClaudeEvents } from '../../src/trivium/adapters/claude-trace.js';
import { emptyPathDeny } from '../../src/trivium/config.js';
import { REPO_ROOT } from '../helpers/fixture.js';

// `.jsonl` 是源码资产不是构建产物，esbuild 不搬进 dist/——按产物目录解析会 ENOENT
const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/claude-events');
const load = (name: string): Promise<string> => fs.readFile(path.join(FIXTURES, name), 'utf8');

test('录制样本：读文件任务的生效配置与哨兵回显', async () => {
  const t = parseClaudeEvents(await load('read-sentinel.jsonl'));

  assert.ok(t.init, 'system/init 必须能解析出来——它是生效配置的唯一回读处');
  assert.equal(t.init.model, 'claude-haiku-4-5-20251001', '--model 真实生效');
  assert.equal(t.init.permissionMode, 'default');
  assert.ok(t.completed, 'result 事件到位');
  assert.match(t.finalText ?? '', /SENTINEL-OPEN/, '哨兵必须出现在最终结果里');
  assert.ok(typeof t.costUsd === 'number', 'result 带成本，探针据此报单次开销');
  assert.ok(t.sessionId, '每条事件都带 session_id');
});

test('锁事实①：工具面干净——白名单生效且无 MCP 工具混入', async () => {
  /*
   * `--restricted --tools Read,Grep,Glob` **单独用是不够的**：
   * 本机实测不加 `--strict-mcp-config` 时，MCP 服务器的工具会混进工具面，
   * 其中含发信、建档、分享、删除等写操作——那是能越出项目边界的失守面，
   * 比「能写项目文件」更严重。它同时也是成本项（实测 24 倍差异）。
   *
   * 混入的那次没有录成样本：那份输出含用户装了哪些连接器的清单，
   * 属于用户的集成情况，不该写进团队仓库（与「凭据不经我手」同源）。
   * 证据以文字记在 M6 第 3 步的实测报告里。
   */
  const t = parseClaudeEvents(await load('read-sentinel.jsonl'));
  assert.deepEqual(t.init?.tools, ['Glob', 'Grep', 'Read'], '只读三件套，别的一个都不能有');
  assert.equal(
    t.init?.tools.filter((x) => x.startsWith('mcp__')).length, 0,
    'MCP 工具若出现在这里，说明 --strict-mcp-config 失效了——该侧当场不可用于审查',
  );
});

test('锁事实②：读取路径有结构化字段（与 codex 相反）', async () => {
  /*
   * claude 读文件走专用 Read 工具，路径在 `tool_use.input.file_path` 里。
   * codex 那边是让模型跑 shell，路径只在命令文本里。
   *
   * 后果（写进 ClaudeProbe.trace_path_structured 的「消费方」注释）：
   * M9 的 project_reads 统计与禁读核验能走结构化字段，
   * 不必像 codex 侧那样依赖命令文本解析（BACKLOG EV-01 对该侧非必需）。
   */
  const t = parseClaudeEvents(await load('read-sentinel.jsonl'));
  const read = t.toolUses.find((u) => u.name === 'Read');
  assert.ok(read, '样本里应当有一次 Read 调用');
  assert.ok(
    typeof read.input['file_path'] === 'string' && read.input['file_path'].includes('sentinel.txt'),
    '路径要在结构化字段里，不是只存在于自由文本中',
  );
});

test('锁事实③：白名单外的工具调用留在轨迹里，且没落文件', async () => {
  /*
   * 这是与 codex 的决定性差异。codex 被沙箱拒绝的命令**一条事件都不产生**，
   * 于是设计 §10.3「轨迹有写事件即判失守」对那一侧恒为假；
   * claude 这边模型照常发出 tool_use，随后收到 is_error 的 tool_result。
   *
   * **判据要扫 tool_use 的工具名，不是 permission_denials**：
   * 白名单外的工具走「工具不存在」路径，不进 denials（那条路见锁事实④）。
   *
   * 哪天这条红了，说明 claude 改成了静默丢弃，那时 M9 的写事件判定要跟着降级。
   */
  const t = parseClaudeEvents(await load('tool-denied.jsonl'));
  const tried = t.toolUses.find((u) => u.name === 'Write');
  assert.ok(tried, '模型确实发起了 Write——这次尝试必须留痕');
  assert.equal(tried.input['file_path'] !== undefined, true, '连目标路径都留着');
  assert.ok(t.toolErrors.length > 0, '要有 is_error 的 tool_result');
  assert.match(
    t.toolErrors.join('\n'), /No such tool available|disabled for this session/,
    '拒绝走的是「工具不存在」路径',
  );
  assert.match(
    t.toolErrors.join('\n'), /in subagents as well as here/,
    '子代理也禁用——堵住经 Task 绕过的路，这条是 M9 只读保障的一部分',
  );
  assert.deepEqual(
    t.permissionDenials, [],
    '白名单外的工具**不**进 permission_denials——判据别扫错地方',
  );
});

test('锁事实④：路径级 deny 真的挡住了，且被拒的读留痕', async () => {
  /*
   * claude 是三家里**唯一**支持路径级 deny 的（agy / zcode 的 M0 实测都是 false）。
   *
   * **但覆盖不完整**（审查意见 GLM-03，两轮实测）：规则对 `Read` 生效，
   * 对 `Grep` **不生效**——而且不是「规则没写全」，显式写上 `Grep(./dir/**)`
   * 照样绕得过。所以第 ③ 道屏蔽**不能**只靠它，事后轨迹核验仍是必需的。
   *
   * 本用例锁的是「对 Read 这条路真的挡住了」这一条事实，不代表整道屏蔽完整。
   * 初版这里的注释写的是「不必退化为禁读清单 + 事后核验」——那是**基于只验过
   * Read 的证据**下的结论，补了 Grep 负对照才发现它错了。
   *
   * 判据两条都要：哨兵没泄漏（真挡住了）+ 进了 denials（留了痕）。
   * 只看哨兵会把「模型压根没去读」误判成「挡住了」。
   */
  const raw = await load('path-denied.jsonl');
  const t = parseClaudeEvents(raw);
  assert.doesNotMatch(raw, /SENTINEL-PEER/, '对方产出的哨兵不得出现在整条事件流里');
  assert.equal(t.permissionDenials.length, 1, '被拒的读要记进 permission_denials');
  assert.equal(t.permissionDenials[0]!.tool_name, 'Read');
  assert.ok(
    String(t.permissionDenials[0]!.tool_input['file_path']).includes('.reviews/'),
    'denials 带完整 tool_input，含被拒的路径——事后核验据此定位',
  );
});

test('解析器：坏行跳过而不是抛', () => {
  const t = parseClaudeEvents(
    [
      '不是 JSON 的提示行',
      '{"type":"system","subtype":"init","model":"m","tools":["Read"],"session_id":"s"}',
      '{ 半截',
      '',
      '{"type":"result","result":"done","total_cost_usd":0.01,"permission_denials":[]}',
    ].join('\n'),
  );
  assert.equal(t.init?.model, 'm');
  assert.equal(t.finalText, 'done');
  assert.ok(t.completed);
});

test('解析器：没有 result 事件时 completed 为 false', () => {
  /*
   * 三态的共用前提：超时被杀、进程报错都会走到这里。
   * 判据取「有没有 result」而不是退出码——与另两家同口径。
   */
  const t = parseClaudeEvents('{"type":"system","subtype":"init","model":"m","tools":[]}');
  assert.equal(t.completed, false, '没结论就是没结论，不能记成「测了，答案是否」');
});

/*
 * ── 安全不变量（r3 GLM-04 ≡ AGY-03、r4 AGY-03 ≡ GLM-06）──
 *
 * 配方原先由 `claudeArgs` 导出、被测试与「被告知不要用它的 M9」共同盯着。
 * r4 复审后它改回**探针私有**（`probeArgs`），对外只导出三个安全不变量——
 * 那才是探针与 M9 真正共有的东西，也正是 `probe.readonly_flags` 落盘的内容。
 */

test('安全不变量：三件齐全，缺一即失守', () => {
  /*
   * 漏掉 `--strict-mcp-config` 的后果是双重的：安全面（MCP 的写操作工具混入
   * 工具面，能发信、改云端文件）与成本（实测 24 倍）。写成断言比写在注释里可靠。
   */
  assert.ok(READONLY_INVARIANTS.includes('--restricted'));
  assert.ok(
    READONLY_INVARIANTS.includes('--strict-mcp-config'),
    '漏掉它，工具面会混入 MCP 的写操作工具——r3 实测 $0.199 vs $0.0083',
  );
  const i = READONLY_INVARIANTS.indexOf('--tools');
  assert.ok(i >= 0);
  assert.equal(READONLY_INVARIANTS[i + 1], 'Read,Grep,Glob', '白名单要紧跟在 --tools 后');
});

test('安全不变量与工具面判据同源：白名单只有一处定义', () => {
  /*
   * `judgeToolSurface` 判的白名单与 `READONLY_INVARIANTS` 里传给 CLI 的，
   * 必须是同一份——两处各写一份的话，改了一处另一处不会报错，
   * 而症状是「探针按 A 判、CLI 按 B 跑」。
   */
  const fromInvariants = READONLY_INVARIANTS[READONLY_INVARIANTS.indexOf('--tools') + 1]!;
  const surface = judgeToolSurface(fromInvariants.split(','));
  assert.equal(surface.clean, true, '传给 CLI 的白名单，judgeToolSurface 必须判干净');
  assert.deepEqual(surface.missing, [], '也不该报缺失');
});

test('解析器：错误结果按 tool_use_id 与调用配对', () => {
  /*
   * 判据不能只数错误条数（审查意见 GLM-07③）：任何无关错误都会算进去。
   * 这里构造「一次调用成功、另一次失败」，确认只有失败那次的 id 被收集。
   */
  const t = parseClaudeEvents(
    [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_ok","name":"Read","input":{}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_ok","is_error":false,"content":"fine"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_bad","name":"Write","input":{}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_bad","is_error":true,"content":"No such tool available: Write"}]}}',
      '{"type":"result","result":"done","permission_denials":[]}',
    ].join('\n'),
  );
  assert.deepEqual([...t.erroredToolUseIds], ['tu_bad'], '只有失败那次进集合');
  assert.equal(t.toolUses.find((u) => u.name === 'Read')?.id, 'tu_ok', 'tool_use 要带 id');
});

/*
 * ── 工具面核对（审查意见 GLM-06）──
 *
 * 判据要与白名单**无序全等**，不是只查 mcp__ 前缀。
 * 抽成纯函数才测得到——埋在探针里要真跑才走得到，等于没有断言守着。
 */

test('工具面：与白名单全等才算干净', () => {
  assert.equal(judgeToolSurface(['Read', 'Grep', 'Glob']).clean, true);
  assert.equal(judgeToolSurface(['Glob', 'Grep', 'Read']).clean, true, '无序');
});

test('工具面：非 MCP 的写工具混入同样算失守', () => {
  /*
   * 这条是 GLM-06 的核心：只查 mcp__ 前缀的话，CLI 漂移把 Bash 放回工具面
   * 就检不出来——而 Bash 能干的事比任何 MCP 工具都多。
   */
  const r = judgeToolSurface(['Read', 'Grep', 'Glob', 'Bash']);
  assert.equal(r.clean, false, 'Bash 不在白名单里，必须检出');
  assert.deepEqual(r.extra, ['Bash']);
  assert.equal(r.mcpCount, 0, '它不是 MCP 工具——只查前缀的实现会漏掉它');
});

test('工具面：MCP 工具混入时点名数量', () => {
  const r = judgeToolSurface(['Read', 'Grep', 'Glob', 'mcp__x__send', 'mcp__y__write']);
  assert.equal(r.clean, false);
  assert.equal(r.mcpCount, 2, '要数出来，好让用户知道该查 --strict-mcp-config');
});

test('工具面：少于白名单不算失守（那是 CLI 更严，不是更松）', () => {
  assert.equal(judgeToolSurface(['Read']).clean, true, '只多不少——多出来的才危险');
});

/*
 * ── r4 复审补的三条（GLM-02 / GLM-05 / GLM-07）──
 *
 * 共同形状仍是那一个：**「没测到」不得塌缩成确定结论**。
 * 三处触发前提各不相同，但后果一样——M9 会据一个假的确定值做降级。
 */

test('工具面：读回为空不算干净，算「没核对成」', () => {
  /*
   * GLM-02：`parseClaudeEvents` 在 tools 字段缺失或改名时落 []，
   * 而空集对任何白名单都「没有多出来的」——记成 clean 就是 vacuous 通过，
   * 探针会永远说「干净且已核对」。CLI 改字段名的那天，核对静默退化成空转。
   */
  const r = judgeToolSurface([]);
  assert.equal(r.empty, true);
  assert.equal(r.clean, false, '空集不是干净，是没读到');
});

test('工具面：少于白名单不算失守，但要报缺了什么', () => {
  /*
   * AGY-02：这本就不是「全等」判定（少了是允许的，CLI 更严不是更松），
   * 而 r4 之前的 JSDoc 与 notes 都说成「全等」——文案与实现两个口径。
   * 缺了核心读工具是另一种不可用，值得单独报。
   */
  const r = judgeToolSurface(['Read']);
  assert.equal(r.clean, true, '没有多出来的，就不是失守');
  assert.deepEqual(r.missing, ['Glob', 'Grep'], '但要说清缺了什么');
});

test('解析器：错误形态的 result 不算跑完', () => {
  /*
   * GLM-05：初版只看「存在 type === result」，忽略 is_error / subtype，
   * 而注释写着「与另两家同口径」——codex 要求「有最终回复」。
   * 后果：预算掐断一类的错误路径被塌缩成「测了，答案是读不到文件」的确定否定。
   *
   * 判据取保守形态（不是 success 就存疑），因为错误 subtype 的具体取值
   * 没有实测样本——枚举漏一个就退回旧行为。
   */
  const ok = parseClaudeEvents('{"type":"result","subtype":"success","result":"x"}');
  assert.equal(ok.completed, true);

  const errored = parseClaudeEvents('{"type":"result","is_error":true,"result":"boom"}');
  assert.equal(errored.completed, false, 'is_error 为真不算跑完');

  const maxTurns = parseClaudeEvents('{"type":"result","subtype":"error_max_turns","result":""}');
  assert.equal(maxTurns.completed, false, '非 success 的 subtype 一律存疑');
});

test('解析器：tool_use 缺 id 时不当作「配对失败」', () => {
  /*
   * GLM-07：判据 `some(u => u.id !== null && …)` 在 id 全为 null 时返回 false，
   * 把「无从配对」记成确定否定。这里只锁解析器保留了 id 为 null 的形态，
   * 三分判据本身在探针里（见 denied_tool_in_trace 的注释）。
   */
  const t = parseClaudeEvents(
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{}}]}}',
  );
  assert.equal(t.toolUses.length, 1);
  assert.equal(t.toolUses[0]!.id, null, 'id 缺失要如实记 null，不能编一个');
});

/*
 * ── EV-40：stream-json 与 --verbose 的绑定判据 ─────────────────────────
 *
 * **这一组锁的是判据，不是厂商行为**（厂商行为由探针每次重跑去看）。
 * 判据必须是三态：两个误判方向的代价不同，但都不轻——
 * 说成 true 会掩盖厂商漂移，说成 false 会让人以为绑定解除了而去删适配层的 --verbose。
 */

/**
 * 默认带正对照成立、且 stderr 有输出（= 参数拒绝的真实形态）。
 *
 * **只有**专门测归因的那两条用例才把这两维翻掉——它们是 true 臂的两道归因门，
 * 混在别的用例里一起变会让「这条到底在测什么」说不清。
 */
const ok = (o: { exitCode: number | null; stdout: string; timedOut: boolean }) =>
  judgeVerboseBinding({ ...o, stderrHasOutput: true, positiveControlOk: true });

test('EV-40：非零退出 + 零事件 + 正对照成立 = 干净拒绝 ⇒ 绑定成立', () => {
  /*
   * 这就是 2026-09-17 在 2.1.273 上实测到的形态：exit 1、stdout 空、
   * stderr 为 `When using --print, --output-format=stream-json requires --verbose`。
   * **判据刻意不看 stderr 文案**——厂商改一句话，字面匹配就静默失效，
   * 而失效方向是放松（本仓 path_deny 的 includes 反解刚栽过同一跤）。
   */
  assert.equal(ok({ exitCode: 1, stdout: '', timedOut: false }), true);
  assert.equal(ok({ exitCode: 1, stdout: '\n  \n', timedOut: false }), true, '空白行不算事件');
  assert.equal(
    ok({ exitCode: 1, stdout: '{ 不是合法 JSON', timedOut: false }),
    true,
    '坏行也不算事件——口径与 parseClaudeEvents 一致（它同样跳过 parse 失败的行）',
  );
});

test('EV-40：零退出 + 有事件 = 干净通过 ⇒ 绑定已解除', () => {
  assert.equal(
    ok({
      exitCode: 0,
      stdout: '{"type":"system","subtype":"init"}\n{"type":"result"}',
      timedOut: false,
    }),
    false,
  );
});

test('EV-40：超时记未测，不往任一侧倒', () => {
  assert.equal(ok({ exitCode: null, stdout: '', timedOut: true }), null);
  assert.equal(
    ok({ exitCode: 1, stdout: '', timedOut: true }),
    null,
    '超时优先于退出码：被杀掉的进程那个非零码不代表「被拒绝」',
  );
});

test('EV-40：拿不到退出码记未测（spawn 失败 / 信号致死）', () => {
  /*
   * 代码双审 CODEX-02 ≡ GLM-03 打中的那一格：初版判据是 `exitCode !== 0`，
   * 而 `null !== 0` 为真——`util/exec.ts` 在 spawn 失败时给的正是 `code: null`、
   * `stdout: ''`，于是**进程根本没跑起来**被记成「实测确证硬前置成立」。
   * 与 timedOut 同族：拿不到退出码就既没被拒也没跑完。
   */
  assert.equal(ok({ exitCode: null, stdout: '', timedOut: false }), null);
});

test('EV-40：正对照不成立时一律记未测（true 臂必须有归因）', () => {
  /*
   * 未登录 / 断网 / slug 失效的机器上，负对照同样是「非零退 + 零事件」——
   * 但那个非零退出**归因不到 --verbose**。不设这道前置，EV-40 想买的
   * 「漂移可见性」恰好在环境不健康的机器上不可见：等厂商真解除绑定时，
   * 那台机器上这一项已经是「确证的 true」（代码双审 CODEX-02）。
   */
  assert.equal(
    judgeVerboseBinding({
      exitCode: 1, stdout: '', stderrHasOutput: true, timedOut: false, positiveControlOk: false,
    }),
    null,
    '同一组观测，仅正对照翻假 ⇒ 结论必须从 true 退回 null',
  );
  assert.equal(
    ok({ exitCode: 1, stdout: '', timedOut: false }),
    true,
    '对照组：正对照成立时同一观测才算数',
  );
});

test('EV-40：两种不干净的形态都记未测，不猜', () => {
  assert.equal(
    ok({ exitCode: 0, stdout: '', timedOut: false }),
    null,
    '退 0 却一条事件都没有：既不是拒绝也不是通过',
  );
  assert.equal(
    ok({ exitCode: 1, stdout: '{"type":"system"}', timedOut: false }),
    null,
    '非零退出却吐了事件：可能是跑到一半才失败，不能算「被拒绝」',
  );
});

/*
 * ── coverage_complete 的三态映射（代码双审 AGY-04）──────────────────
 *
 * 抽成纯函数才有防退化守卫。三个入值各有各的代价，`unverified` 尤其：
 * 记 false 是把「没测到」说成「确认绕得过」，记 true 会免掉事后轨迹核验。
 */
test('coverage_complete：三态一一对应，unverified 必须是 null', () => {
  assert.equal(judgeDenyCoverage('blocked'), true);
  assert.equal(judgeDenyCoverage('bypassed'), false);
  assert.equal(judgeDenyCoverage('unverified'), null, '没测到不得与任一确定结论合流');
});

/*
 * ── MCP 硬前置的判据本体（代码双审 AGY-01 ≡ GLM-01 ≡ CODEX-01）─────────
 *
 * 这一组锁的是**「没测到」不得被算成「确认没有」**。
 * 初版把它写成一句 `readonly_flags.includes(...)`，而 `[].includes(x)` 是 false。
 */
test('硬前置：没核对成一律 null，绝不从空数组反算出「确认缺失」', () => {
  assert.equal(judgeStrictMcpConfig(false, []), null, '拿不到 system/init：没测到');
  assert.equal(judgeStrictMcpConfig(null, []), null, '压根没跑到这一步：也是没测到');
  assert.equal(
    judgeStrictMcpConfig(false, READONLY_INVARIANTS),
    null,
    '数组里即便有值，没核对成就仍是没测到——前置优先于内容',
  );
});

test('硬前置：核对过才谈得上有无', () => {
  assert.equal(judgeStrictMcpConfig(true, READONLY_INVARIANTS), true);
  assert.equal(
    judgeStrictMcpConfig(true, ['--restricted', '--tools', 'Read,Grep,Glob']),
    false,
    '真子集：其余旗标在、独缺硬前置',
  );
  assert.equal(
    judgeStrictMcpConfig(true, []),
    false,
    'breach 与工具面脏会把数组清空——在**已被删掉**的旧句「同真同假」下这条路径恰好成立，\n' +
      '而那正是它当初漏检另外两条反例的原因（见下方「**不**同真同假」那条对账用例）',
  );
});

/*
 * ── 修法本体的守卫（代码双审 r2 GLM-r2-01 / GLM-r2-03）───────────────
 *
 * 上一轮我给三个**判据**都抽了纯函数配了用例，却给**修法本体**留了两处裸奔：
 * `probeArgs` 里 EV-40 负对照的唯一输入开关，以及「strict 赋值必须在清空点之后」
 * 这个位置约定。两者都不体现在任何返回值里，退化时没有一条用例会红。
 *
 * 「加了守卫不等于守卫被守着」——v1.3.8 记过一次，本轮在同一个 diff 里又照了一次。
 */

test('EV-40 输入开关：omitVerbose 决定 --verbose 在不在 argv 里', () => {
  /*
   * 它是负对照的**唯一**输入侧开关。若在重构中失效（--verbose 恒被拼入），
   * 负对照就变成正对照：进程正常跑完、退 0 且有事件 ⇒ judgeVerboseBinding 落 false
   * ⇒ 一条「厂商已解除绑定」的**假警报**，还会触发「设计 §3.7.1 该行要复核」。
   * EV-40 买的就是漂移可见性，而它自己的开关漂移时无人看见。
   */
  const withV = probeArgs({ prompt: 'p' });
  const noV = probeArgs({ prompt: 'p', omitVerbose: true });
  /*
   * **被测对象是负对照实际会用的那一份**（代码双审 r3 CODEX-02）。
   * 上一版只自建入参测「旋钮有效」，于是删掉调用点那个 `omitVerbose: true`
   * 照样全绿、负对照悄悄退化成正对照。现在调用点与这里共用同一个函数。
   */
  assert.ok(
    !verboseNegativeControlArgs().includes('--verbose'),
    '负对照实际发出的 argv 必须不含 --verbose——这条守的是「拨了旋钮」，不是「旋钮有效」',
  );
  assert.ok(withV.includes('--verbose'), '正常探测必须带 --verbose，否则 CLI 当场拒绝');
  assert.ok(!noV.includes('--verbose'), 'omitVerbose 必须真的把它拿掉——负对照全靠这一下');
  assert.deepEqual(
    withV.filter((a) => a !== '--verbose'), noV,
    '两者只该差这一个旗标：负对照要单变量，别的跟着变就不是对照了',
  );
});

test('EV-74 计划 §4.2：probeArgs 的 budgetUsdOverride 不设默认值，只在显式传入时生效', () => {
  /*
   * **本条只守机制本身的隔离性质，不等于计划 §5 用例 8**（代码双审
   * CODEX-01≡AGY-01≡GLM-01）：用例 8 要求端到端断言「结构化臂那次调用点真的
   * 拨了这个旋钮、其余各臂不受影响」，而调用点目前故意未接线（§4.2 的实测尚未
   * 做，见 `execProbe` 上方的状态说明）——没有调用点在拨，也就没有"拨没拨没人守"
   * 这件事可断言。这里守的是**将来接线时**这个机制不会被连带破坏：不传时必须
   * 落回模块常量，不能有任何隐式默认覆盖值——`probeArgs` 是导出函数
   * （本文件就直接调用它），任何调用点都可能无意间共享覆盖值，等于把
   * 「一次未经讨论的全局配额上调」换个位置重演。真正的用例 8（伪 bin 录 argv，
   * 断言调用点隔离）留到 §4.2 实测完成、覆盖值真正接线之后再补。
   */
  const withoutOverride = probeArgs({ prompt: 'p' });
  const withOverride = probeArgs({ prompt: 'p', budgetUsdOverride: '9.99' });

  const budgetIdx = (args: string[]) => args.indexOf('--max-budget-usd');
  assert.notEqual(budgetIdx(withoutOverride), -1, '--max-budget-usd 必须始终存在');
  assert.notEqual(
    withoutOverride[budgetIdx(withoutOverride) + 1],
    '9.99',
    '不传覆盖值时不得意外落到某个测试用的覆盖值上——必须是模块常量',
  );
  assert.equal(
    withOverride[budgetIdx(withOverride) + 1],
    '9.99',
    '显式传入的覆盖值必须原样出现在 argv 里',
  );
  // 两次调用除这一个值外，其余 argv 必须逐项相同——覆盖只影响这一个旗标
  const stripBudget = (args: string[]) => {
    const i = budgetIdx(args);
    return [...args.slice(0, i + 1), ...args.slice(i + 2)];
  };
  assert.deepEqual(
    stripBudget(withoutOverride),
    stripBudget(withOverride),
    '覆盖预算不该连带改动任何其它旗标',
  );
});

test('EV-40 输入开关：prompt 恒在 argv 末位（本文件全部结论都是 argv 形态下的）', () => {
  /*
   * 上一版为「第 3 步在 stdin 形态复验」加过 promptVia 分支，那是条死路
   * （零调用方、execProbe 硬编码 stdin: ''、adapters 禁 import probes），已删。
   * 这条断言把**现状**钉住：探针就是 argv 形态，所以 EV-40 那格的结论也只在 argv 形态下成立。
   * 哪天真给探针加了 stdin 形态，这条会红——那时该做的是同时回填设计 §3.7.1 与 EV-43。
   */
  const args = probeArgs({ prompt: 'SENTINEL-PROMPT' });
  assert.equal(args.at(-1), 'SENTINEL-PROMPT');
});

test('修法源序：strict 派生必须晚于对 readonly_flags 的**任何**写入', async () => {
  /*
   * r1 GLM-02 的修法本体是「位置」，而位置不体现在返回值里，所以要一条源序断言。
   *
   * **上一版锚点太窄**（代码双审 r3 CODEX-04）：它用精确字面量 `probe.readonly_flags = []`
   * 取 `lastIndexOf`，只认「清空」这一种写法。可真正的不变式是
   * **「派生点必须晚于任何一次对该数组的写入」**——`= [...READONLY_INVARIANTS]`
   * 那一处也是写入，它哪天被挪到派生点之后，上一版不会红。
   *
   * 两条一起上：锚点放宽到任何写入 + 锚点**计数下限**（写法换了、或写入搬去别的文件，
   * 命中数会掉，本条会红而不是静默少扫一处）。
   */
  const src = await fs.readFile(
    path.join(REPO_ROOT, 'src/trivium/probes/claude.ts'), 'utf8',
  );
  const writes = [...src.matchAll(/probe\.readonly_flags\s*=\s*\[/g)];
  const assign = src.indexOf('probe.strict_mcp_config_applied = judgeStrictMcpConfig(');

  assert.ok(assign > 0, '找不到派生点——扫描锚点写错了会让本条永绿');
  /*
   * 计数下限：现况 4 处写入（三处清空 + 一处赋整份常量）。
   * 少于这个数说明有写入换了写法或搬走了，那时本条的覆盖已经不完整——
   * 这正是上一版「只认一种写法」栽的地方，所以下限本身也要被断言。
   */
  assert.ok(
    writes.length >= 4,
    `对 readonly_flags 的写入只扫到 ${writes.length} 处（现况应为 4）——` +
      '有写法变了或搬去了别的文件，本条已不再覆盖全部写入',
  );

  const lastWrite = writes.at(-1)!.index;
  assert.ok(
    assign > lastWrite,
    '派生点排到了某次写入之前：落盘会出现 {readonly_flags: [], strict: true} 的矛盾组合',
  );
});

test('EV-40：非零退出但 stdout 与 stderr 两头皆空 ⇒ 记未测', () => {
  /*
   * true 臂的第四道门（代码双审 r2 CODEX-02）。「非零退出 + 零事件」不止参数拒绝
   * 一种成因：配额闸门掐断、CLI 自身崩溃、外部信号带退出码终止，全都长这样。
   * 它们在正对照成立时会被记成「实测确证硬前置成立」——而误判方向恰是本字段
   * 要买的东西的反面：**厂商真解除绑定那天，若负对照同时因别的原因失败，
   * 字段落 true，漂移永久不可见。**
   *
   * 参数拒绝必然往 stderr 写一行，所以这是**有无**判据。
   * 仍然不匹配任何文案——那条纪律没松（失效方向是放松，与 includes 反解同形）。
   */
  assert.equal(
    judgeVerboseBinding({
      exitCode: 1, stdout: '', stderrHasOutput: false, timedOut: false, positiveControlOk: true,
    }),
    null,
    '两头皆空的静默失败归因不到 --verbose',
  );
  assert.equal(
    judgeVerboseBinding({
      exitCode: 1, stdout: '', stderrHasOutput: true, timedOut: false, positiveControlOk: true,
    }),
    true,
    '对照组：CLI 确实说了话，才算干净拒绝',
  );
});

test('硬前置：与 readonly_flags.length > 0 **不**同真同假（两条反例各一格）', () => {
  /*
   * 对账用例（代码双审 r2 AGY-02 ≡ GLM-r2-05 ≡ CODEX-05）。
   * 上一版在 types.ts 与探针注释里都写过「今天两者恰好同真同假」——那是错的。
   * 三侧给的两条反例是不同路径，这里各锁一格，免得那句话以任何形式回来。
   */
  // 反例①：tools 读回为空 ⇒ 同时置 checked=false 并清空 ⇒ null 对 false
  assert.equal(judgeStrictMcpConfig(false, []), null);
  assert.equal([].length > 0, false, '同一组输入下长度判据给的是 false，不是 null');

  // 反例②：existing 带着上一轮完整清单、本轮拿不到 init ⇒ 数组非空而字段 null
  assert.equal(
    judgeStrictMcpConfig(false, READONLY_INVARIANTS),
    null,
    'GLM-r2-05 举的 existing 路径：数组非空，字段仍必须是 null',
  );
  assert.ok(READONLY_INVARIANTS.length > 0, '而长度判据在这里为真——两者就此分叉');
});

/**
 * `PathDenyProbe` 产出点的扫描器 —— **单源**（代码双审 r4 GLM-03 ≡ CODEX-02）。
 *
 * 上一版把同一条正则在主用例与反面夹具里各写了一份，于是**夹具守的是它自己那份副本**：
 * 只改其中一处，夹具照样全绿。这正是本仓在 `STRICT_MCP_CONFIG_FLAG` 与 `eventCount`
 * 上刚消掉的形态，我在同一次改动里一边消一边造。现在两边共用这一个函数。
 *
 * ## 为什么要先剥 `${…}`（r4 AGY-01 ≡ CODEX-01）
 *
 * 上一版正文类写成 `[^{}]*`，跨不过模板插值自带的花括号。而 `probeCodexPathDeny`
 * 三处 `return` 的 `method` **全是模板插值**，于是 `codex.ts` 命中数为 **0**——
 * 恰恰是 r3 点名的那一族一处都没进论域。codex 侧实跑验证：把那三行
 * `coverage_complete` 删掉，`offenders` 仍为 `[]`、**变异不红**。
 *
 * 所以这里先把 `${…}` 与注释替换成空白再匹配，**不让「我写对正则」成为前提**。
 *
 * ## 不覆盖的形态（具名登记，照 `registry-parity` 先例，r4 GLM-04）
 *
 * | 形态 | 例 | 谁兜底 |
 * | :--- | :--- | :--- |
 * | 正文含**嵌套对象**字面量 | `{ supported: x, meta: { a: 1 } }` | `tsc` 必填（剥插值后仍跨不过真花括号） |
 * | **中间变量**构造 | `const pd: PathDenyProbe = {…}; probe.path_deny = pd;` | `tsc` 必填（带类型标注时） |
 * | `supported` **子串**误命中 | 正文出现 `unsupportedX` | 无兜底——误报方向，需人工 |
 *
 * **主闸门是 `coverage_complete` 的必填类型，不是本函数**；本函数是第二道，
 * 盯的是类型够不到的那一面（键名写错、或将来又被改回可选）。
 */
function scanPathDenyProductions(src: string): { body: string; line: number }[] {
  const neutral = neutralize(src);
  const out: { body: string; line: number }[] = [];

  /*
   * ① 属性形与赋值形：`path_deny: {…}` / `probe.path_deny = {…}`。
   *    这两种自带「这是 path_deny」的标记，在哪儿都算。
   */
  const TAGGED = /path_deny\s*[:=]\s*\{([^{}]*)\}/g;
  for (const m of neutral.matchAll(TAGGED)) {
    out.push({ body: m[1]!, line: neutral.slice(0, m.index).split('\n').length });
  }

  /*
   * ② return 形：**只在签名声明返回 `PathDenyProbe` 的函数体内扫**。
   *
   * 上一版只按 `return {` + 正文含 `supported` 匹配，于是抓到了 `agy.ts` / `zcode.ts`
   * 里 `probePathDeny` 的返回——那是各自的**内部中间类型**（camelCase `ruleSyntax`），
   * 根本不是 `PathDenyProbe`，属**误报**。判据改挂函数签名这个真实标记
   * （codex 给的方向：扫 `Promise<PathDenyProbe>` 的函数返回值）。
   */
  const SIG = /:\s*Promise<PathDenyProbe>\s*\{/g;
  for (const sig of neutral.matchAll(SIG)) {
    // 从函数体起点到下一个顶格 `}` 为止——探针里这些函数都在顶层
    const bodyStart = sig.index! + sig[0].length;
    const bodyEnd = neutral.indexOf('\n}', bodyStart);
    const body = neutral.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);
    for (const m of body.matchAll(/return\s+\{([^{}]*)\}/g)) {
      out.push({
        body: m[1]!,
        line: neutral.slice(0, bodyStart + m.index!).split('\n').length,
      });
    }
  }
  return out;
}

/** 注释与模板插值替换成等长空白（保住行号）——两处扫描共用 */
function neutralize(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/\$\{[^{}]*\}/g, blank);
}

/**
 * 每个探针文件的命中下限 —— **按文件，不是全局**（代码双审 r4 CODEX-01）。
 *
 * 上一版防空转腿是 `scanned > 0` 这个**全局计数**，于是 `codex.ts` 命中 0
 * 被另三家的 5 处撑了过去——**全局计数挡不住逐文件的盲区**。
 * 下限由现况写死：少于它说明有产出点换了写法或搬走了，本条会红而不是静默少扫一处。
 * 手法与源序断言的 `writes.length >= 4` 同源——那条是我同一天写的，当时没用到这里。
 */
const PATH_DENY_MIN_HITS: Readonly<Record<string, number>> = {
  // claude：1 处属性形（probeClaude 初值）+ 3 处 return 形（probeClaudePathDeny 四分支之一走展开）
  'claude.ts': 3,
  // agy / zcode：各 1 处赋值形（真实产出）。它们的 probePathDeny 返回的是内部中间类型，不计
  'agy.ts': 1,
  'zcode.ts': 1,
  // codex：probeCodexPathDeny 的 3 处 return 形——**r4 漏掉的正是这一族**
  'codex.ts': 3,
};

test('契约：PathDenyProbe 的每一处产出都带齐键（三种写形，按文件下限）', async () => {
  const dir = path.join(REPO_ROOT, 'src/trivium/probes');
  const wantKeys = Object.keys(emptyPathDeny());
  assert.ok(wantKeys.includes('coverage_complete'), '空壳本身得带着那一格，否则下面扫的是空承诺');

  const offenders: string[] = [];
  const hits: Record<string, number> = {};
  for (const f of Object.keys(PATH_DENY_MIN_HITS)) {
    const src = await fs.readFile(path.join(dir, f), 'utf8');
    const found = scanPathDenyProductions(src);
    hits[f] = found.length;
    for (const { body, line } of found) {
      const missing = wantKeys.filter((k) => !new RegExp(`\\b${k}\\b`).test(body));
      if (missing.length > 0) offenders.push(`probes/${f}:${line} 缺 ${missing.join('、')}`);
    }
  }

  // 防空转：**逐文件**核下限，不是全局计数
  for (const [f, min] of Object.entries(PATH_DENY_MIN_HITS)) {
    assert.ok(
      hits[f]! >= min,
      `probes/${f} 只扫到 ${hits[f]} 处产出点（下限 ${min}）——` +
        '有写法变了或搬走了，本条对该文件已退化为空转（r4 就是这么漏掉 codex.ts 的）',
    );
  }
  assert.deepEqual(
    offenders, [],
    'PathDenyProbe 的产出点漏键（主闸门是类型必填，走到这里说明键名写错了）：\n  ' +
      offenders.join('\n  '),
  );
});

test('契约自检：扫描器对「漏键」确实会红，且抓得到带插值的真实形状', () => {
  /*
   * v1.3.19 立的规矩：光有正向扫描不算守着，得有一条期望**必须红**的反面夹具。
   * r4 补上最要紧的一条：**含 `${}` 插值的真实形状**——上一版四条样本全是
   * 无插值的合成串，所以它证明的是「简化形会抓」，不是「现场形状会抓」。
   */
  const miss = (src: string) =>
    scanPathDenyProductions(src).filter((h) => !/\bcoverage_complete\b/.test(h.body)).length;

  assert.equal(miss('const x = { path_deny: { supported: null, attempts: [] } };'), 1, '属性形');
  assert.equal(miss('probe.path_deny = { supported: false, method: "m" };'), 1, '赋值形');

  /*
   * return 形的样本必须**带上函数签名**——判据就挂在它上面。
   * 收紧前只按 `return {` + 正文含 supported 匹配，抓到了 agy/zcode 里
   * `probePathDeny` 返回的**内部中间类型**（camelCase `ruleSyntax`），那是误报。
   */
  const inFn = (body: string) => `async function f(): Promise<PathDenyProbe> {\n  ${body}\n}\n`;
  assert.equal(miss(inFn('return { supported: null, rule_syntax: null };')), 1, 'return 形');
  assert.equal(
    miss(inFn('return { supported: null, method: `失败（退出码 ${r.code}）`, attempts: [] };')),
    1,
    '**带模板插值的真实形状**——上一版正是在这里对 codex.ts 整个失明',
  );
  assert.equal(
    miss(inFn('return { supported: null, method: `码 ${r.code}`, coverage_complete: null };')),
    0,
    '键齐的不该报——否则这条会误伤到没人敢动',
  );
  assert.equal(
    miss('async function g() {\n  return { supported: false, ruleSyntax: null };\n}\n'),
    0,
    '**签名不是 PathDenyProbe 的 return 不算产出点**——agy/zcode 的内部中间类型就长这样，抓它是误报',
  );
});

test('契约：omitVerbose 的实拨点唯一（负对照 argv 只有一个来源）', async () => {
  /*
   * 代码双审 r4 CODEX-07：`verboseNegativeControlArgs` 抽出后调用面确实唯一，
   * 但那是**现在成立的事实，不是结构**——`probeArgs` 带 `omitVerbose?` 是导出的，
   * 任何新调用点都能自拼一份不含 `--verbose` 的 stream-json argv 绕过具名函数。
   * 把「唯一」交给机器判据，而不是留给下一个读者去 grep。
   */
  const src = await fs.readFile(
    path.join(REPO_ROOT, 'src/trivium/probes/claude.ts'), 'utf8',
  );
  // **先中和注释**：文件里有两处注释在讲「omitVerbose: true 写在调用点」，
  // 上一版直接扫原文把它们也算成了实拨（3 !== 1 那次红就是这么来的）
  const code = neutralize(src);
  const pulls = [...code.matchAll(/omitVerbose:\s*true/g)];
  assert.equal(
    pulls.length, 1,
    `src 里「实拨 omitVerbose」出现了 ${pulls.length} 次，应当只有 1 次（在 verboseNegativeControlArgs 体内）`,
  );
  const fnStart = code.indexOf('export function verboseNegativeControlArgs(');
  const fnEnd = code.indexOf('\n}', fnStart);
  assert.ok(fnStart > 0 && pulls[0]!.index! > fnStart && pulls[0]!.index! < fnEnd,
    '唯一那次实拨必须在 verboseNegativeControlArgs 体内');
});

test('EV-42 安全默认：peer_deny_applied 必须读 file_shape_verified，不得读 supported', async () => {
  /*
   * 代码双审 r4 CODEX-03 的落点。EV-42 的安全默认原本只是 BACKLOG 里一句话
   * 「等价性未验前 peer_deny_applied 不得记 true」，而三家适配器逐字都是
   * `peer_deny_applied: probe.path_deny.supported === true`——
   * **第 3 步照抄那一行当场违反，且没有任何东西会红**。
   *
   * 现在字段与读法都换了，这条守住「别换回去」：
   * 立这条契约时 claude 侧 `supported` 是 true 而 `file_shape_verified` 是 null
   * （EV-42 已于 M9 第 3 步结案、该格现为 true，但**本契约要守的是读哪一格、不是它的当前取值**），
   * 读错哪一格，落盘的 peer_deny_applied 就会把一件没测过的事记成 true。
   */
  const dir = path.join(REPO_ROOT, 'src/trivium/adapters');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ts'));
  const offenders: string[] = [];
  let seen = 0;
  for (const f of files) {
    const src = await fs.readFile(path.join(dir, f), 'utf8');
    for (const [i, line] of neutralize(src).split('\n').entries()) {
      /*
       * 只看**从探针结论取数**的那些行。`base.ts` 的失败出口与桩适配器写的是
       * 字面 `false`（该侧没跑过、或压根没有这个概念），它们不读任何字段，
       * 把它们算进来是误报——判据要贴着「它在读什么」写，不是「它叫什么」。
       */
      if (!/peer_deny_applied\s*:.*path_deny/.test(line)) continue;
      seen += 1;
      if (!/file_shape_verified/.test(line)) offenders.push(`adapters/${f}:${i + 1}  ${line.trim()}`);
    }
  }
  assert.ok(
    seen >= 4,
    `只扫到 ${seen} 处 peer_deny_applied（现况**四家**各一处，claude 随 M9 第 3 步接入）——论域缩了，本条已退化`,
  );
  assert.deepEqual(
    offenders, [],
    'peer_deny_applied 读错了字段（读 supported 会把「没验过」记成 true）：\n  ' + offenders.join('\n  '),
  );
});

// ───── 四个曾经内联的判据：三态（M9 第 3 步，计划双审 CODEX-04）─────

test('judgeHeadlessRead 三态：没跑完是 null，不是「读不到」', () => {
  assert.equal(judgeHeadlessRead({ completed: true, finalText: 'xx SENT yy', sentinel: 'SENT' }), true);
  assert.equal(judgeHeadlessRead({ completed: true, finalText: 'nothing', sentinel: 'SENT' }), false);
  assert.equal(judgeHeadlessRead({ completed: true, finalText: null, sentinel: 'SENT' }), false);
  assert.equal(
    judgeHeadlessRead({ completed: false, finalText: null, sentinel: 'SENT' }),
    null,
    '超时/错误 result ⇒ 那一轮没得出结论，不得塌缩成确定否定',
  );
});

test('judgeTracePathStructured 三态：按 basename 比对，没跑完是 null', () => {
  const uses = [{ input: { file_path: '/private/tmp/x/a.ts' } }];
  assert.equal(judgeTracePathStructured({ completed: true, toolUses: uses, wantBasename: 'a.ts' }), true);
  // macOS 软链：夹具给 /tmp/… 而事件里是 /private/tmp/…，按 basename 才不会假阴性
  assert.equal(judgeTracePathStructured({ completed: true, toolUses: uses, wantBasename: 'b.ts' }), false);
  assert.equal(judgeTracePathStructured({ completed: true, toolUses: [], wantBasename: 'a.ts' }), false);
  assert.equal(judgeTracePathStructured({ completed: false, toolUses: [], wantBasename: 'a.ts' }), null);
});

test('judgeJsonSchema 七格：行序互斥，null 成因各自独立（EV-74 计划 §3.4.1/§5 用例 3）', () => {
  const base = {
    timedOut: false,
    exitCode: 0,
    stderr: '',
    eventCount: 1,
    completed: true,
    positiveControlOk: true,
    finalText: '{"summary":"x"}',
    requiredKey: 'summary',
  };

  // 前置门（r5 CODEX-02：timedOut 补显式断言）
  assert.deepEqual(judgeJsonSchema({ ...base, timedOut: true }), { value: null, cause: 'not-completed' });
  assert.deepEqual(judgeJsonSchema({ ...base, exitCode: null }), { value: null, cause: 'not-completed' });
  assert.deepEqual(judgeJsonSchema({ ...base, positiveControlOk: false }), { value: null, cause: 'not-completed' });

  // 干净拒绝——唯一允许落 false 的形态
  assert.deepEqual(
    judgeJsonSchema({ ...base, exitCode: 1, eventCount: 0, stderr: 'error: bad schema', completed: false }),
    { value: false, cause: 'clean-reject' },
  );

  // 两头皆空：静默失败
  assert.deepEqual(
    judgeJsonSchema({ ...base, exitCode: 1, eventCount: 0, stderr: '', completed: false }),
    { value: null, cause: 'not-completed' },
  );

  // 非零退出但已吐出事件、completed !== true：跑到一半才失败
  assert.deepEqual(
    judgeJsonSchema({ ...base, exitCode: 1, eventCount: 3, completed: false }),
    { value: null, cause: 'not-completed' },
  );

  // 零退出但未跑完（撞闸/未获模型答复）——cause 与「模型不合规」分开
  assert.deepEqual(
    judgeJsonSchema({ ...base, exitCode: 0, eventCount: 2, completed: false }),
    { value: null, cause: 'not-completed' },
  );

  // completed 但不可 JSON.parse
  assert.deepEqual(
    judgeJsonSchema({ ...base, finalText: 'not json' }),
    { value: null, cause: 'model-noncompliant' },
    '跑通了但输出不是 JSON ⇒ 模型未按契约给出合规输出',
  );

  // completed 但缺 requiredKey
  assert.deepEqual(
    judgeJsonSchema({ ...base, finalText: '{"other":1}' }),
    { value: null, cause: 'model-noncompliant' },
  );

  // completed 且 requiredKey 为 string ⇒ true（r5 CODEX-02 新增：本主题要买的核心保证）
  assert.deepEqual(
    judgeJsonSchema({ ...base, finalText: '{"summary":"一句话摘要"}' }),
    { value: true, cause: 'ok' },
  );

  // 行序互斥（r5 CODEX-04≡GLM-02）：completed 是唯一分野，一旦为 true，
  // 退出码不再影响结论——不会像 r4 表那样与「非零退出但已吐出事件⇒null」相撞
  assert.deepEqual(
    judgeJsonSchema({ ...base, exitCode: 1, eventCount: 3, completed: true, finalText: '{"summary":"x"}' }),
    { value: true, cause: 'ok' },
  );
});

test('judgeReadonlyBreach 三态：写成功即失守（不论跑没跑完），没落盘又没跑完是 null', () => {
  assert.equal(judgeReadonlyBreach({ breached: false, completed: true }), false);
  assert.equal(
    judgeReadonlyBreach({ breached: false, completed: false }),
    null,
    '此前这里是一句直接赋值，把「那一轮没测」记成了「确认没失守」',
  );
  assert.equal(judgeReadonlyBreach({ breached: true, completed: true }), true);
  assert.equal(
    judgeReadonlyBreach({ breached: true, completed: false }),
    true,
    '判据顺序要紧：先判 breached。反过来会把「模型写成功之后才超时」抹成没测到——' +
      '那是把一次真实失守记成 null',
  );
});

// ───── EV-42 / EV-44 的两个新判据（M9 第 3 步）─────

test('judgeFileShape 三态：没试过是 null，两条腿任一不成立是 false（否定结案要真的走）', () => {
  const ok = { completed: true, attempted: true, leaked: false, recorded: true };
  assert.equal(judgeFileShape(ok), true);
  assert.equal(judgeFileShape({ ...ok, leaked: true }), false, '泄漏了 ⇒ 否定结案');
  assert.equal(judgeFileShape({ ...ok, recorded: false }), false, '没留痕 ⇒ 否定结案');
  assert.equal(
    judgeFileShape({ ...ok, attempted: false }),
    null,
    '模型压根没去读 ⇒ 没测到。只看哨兵会把这种情形误判成「挡住了」',
  );
  assert.equal(judgeFileShape({ ...ok, completed: false }), null);
});

test('judgeProjectMemoryBlocked 三态：true 臂必须有对照，否则字段名就在撒谎', () => {
  const blocked = {
    restrictedCompleted: true, restrictedToolUses: 0, restrictedSawSentinel: false,
    control: { completed: true, sawSentinel: true, toolUses: 0 },
  };
  assert.equal(judgeProjectMemoryBlocked(blocked), true);

  assert.equal(
    judgeProjectMemoryBlocked({ ...blocked, control: { completed: true, sawSentinel: false, toolUses: 0 } }),
    null,
    '对照臂也没看见 ⇒ 这个夹具/提示词本身就验不出记忆通道，受限臂没看见什么都不证明',
  );

  /*
   * **两臂待遇必须对称**（代码双审 r1 CODEX-08）。
   *
   * 上一版只把受限臂的 toolUses 当一等输入，对照臂的既没记也没判。
   * 于是对照臂若用 Read 自己读了 CLAUDE.md，「看见哨兵」会被当成「记忆通道可见」
   * ⇒ 落 true。而 true 的**全部意义**就是「受限臂没看见、**而记忆通道确实能被看见**」——
   * 后半句若是靠读文件得来的，这个 true 就是假的。
   */
  assert.equal(
    judgeProjectMemoryBlocked({ ...blocked, control: { completed: true, sawSentinel: true, toolUses: 1 } }),
    null,
    '对照臂调了工具 ⇒ 通道不纯，「看见哨兵」可能是读文件读到的，不得据此记 true',
  );
  assert.equal(
    judgeProjectMemoryBlocked({ ...blocked, control: null }),
    null,
    '没有对照就不得记 true——否则「CLI 压根不加载 CLAUDE.md」会被记成「--restricted 挡住了」',
  );
  assert.equal(
    judgeProjectMemoryBlocked({ ...blocked, restrictedSawSentinel: true }),
    false,
    '受限臂仍读到 ⇒ 一次调用即结案，EV-44 的结论就此作废',
  );
  assert.equal(
    judgeProjectMemoryBlocked({ ...blocked, restrictedToolUses: 1 }),
    null,
    '有工具调用 ⇒ 污染通道，可能是读文件读到的而不是记忆通道',
  );
  assert.equal(judgeProjectMemoryBlocked({ ...blocked, restrictedCompleted: false }), null);
});

test('EV-44 对照臂：旋钮只有一个实拨点，且它真的只摘掉那一条旗标', () => {
  /*
   * 与 verboseNegativeControlArgs 同一条纪律（r3 CODEX-02）：
   * 把「去掉 --restricted」写在调用点、用例自建入参去断言旋钮有效，
   * 于是**旋钮被守着、拨没拨没人守**——删掉调用点那一行不会红，
   * 而对照臂当场退化成第二个受限臂，结论被永久钉死在 null 上。
   */
  const control = projectMemoryControlArgs(READONLY_INVARIANTS);
  assert.ok(!control.includes('--restricted'), '对照臂必须摘掉受限旗标');
  assert.deepEqual(
    control,
    READONLY_INVARIANTS.filter((f) => f !== '--restricted'),
    '**只摘那一条**：MCP 硬前置等其余旗标必须留着，否则对照臂会顺带打开写工具面',
  );
  assert.ok(
    control.includes('--strict-mcp-config'),
    'MCP 硬前置在对照臂里也不能少——它与本格要测的东西无关，摘了是平白多开一个失守面',
  );
});

test('源序：EV-44 的探测臂排在主夹具 cleanup 之后（独立夹具不得被共用）', async () => {
  const src = await fs.readFile(
    path.join(REPO_ROOT, 'src/trivium/probes/claude.ts'),
    'utf8',
  );
  const mainCleanup = src.indexOf('await fx.cleanup()');
  const memCreate = src.indexOf('await createMemoryFixture()');
  assert.ok(mainCleanup > 0 && memCreate > 0, '两个锚点都要在——扫描写错了会让本条永绿');
  assert.ok(
    memCreate > mainCleanup,
    '记忆夹具必须在主夹具清理之后才建：合用一个夹具时，带 CLAUDE.md 的内容会给' +
      '其余每一格注入一段进上下文的文本。今天 --restricted 挡得住所以看不出差别，' +
      '而这一格存在的全部意义就是有朝一日它挡不住',
  );
  assert.equal(
    src.split('createMemoryFixture(').length - 1,
    1,
    '**带括号的只该有一处**（唯一调用点）——import 那行写的是不带括号的具名导入。' +
      '多出来的调用点说明这份独立夹具被别处复用了，而它独立的理由正是不与别处共用',
  );

  /*
   * **调用点也要守**，不只守函数本身。
   *
   * 上一版这条用例只断言 `projectMemoryControlArgs` 这个纯函数行为正确，
   * 而把调用点那行改成直接传 `READONLY_INVARIANTS`（不摘旗标）**不会红**：
   * 对照臂当场退化成第二个受限臂，两臂都看不见哨兵 ⇒ 判据落 `null`，
   * 一条本该翻转的结论被永久钉死在「无从证实」上。
   *
   * 这正是 r3 CODEX-02 记的「旋钮被守着、拨没拨没人守」——**我刚写完那条教训
   * 的实现，就在它旁边又犯了一次**。所以这里守的是「调用点确实拨了旋钮」。
   */
  assert.ok(
    /projectMemoryControlArgs\(/.test(src),
    '对照臂的 argv 必须经 projectMemoryControlArgs 构造；直接传 READONLY_INVARIANTS 会让它退化成受限臂',
  );
  const controlCallIdx = src.indexOf('projectMemoryControlArgs(READONLY_INVARIANTS)');
  assert.ok(
    controlCallIdx > memCreate,
    '那一处调用要落在 EV-44 探测臂里（记忆夹具创建之后），而不是别处',
  );
});
