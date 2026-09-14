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
  judgeToolSurface,
  parseClaudeEvents,
} from '../../src/trivium/probes/claude.js';
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
