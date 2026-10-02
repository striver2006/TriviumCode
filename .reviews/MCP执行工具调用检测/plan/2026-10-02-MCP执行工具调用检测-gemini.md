---
schema: trivium.review.v1
topic: MCP执行工具调用检测
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.14
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261002T072209Z
rerun_index: 1
snapshot_hash: sha256:940dc443d86fe78c3e1398a36999f85e140a19eb62dbae8133a9206293e2dc0a
blind: true
started_at: 2026-10-02T07:22:11.774Z
finished_at: 2026-10-02T07:33:09.189Z
duration_s: 387
tool_calls:
  read: 36
  grep: 17
  glob: 0
  run_command: 0
  project_reads: 20
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: e7ad3ad3-5052-4584-82da-781978e36a5b
---

# 计划审查：MCP执行工具调用检测

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261002T072209Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

计划整体周密，各留痕面与测试变异设计完备；但存在一项 major 级别判定漏洞：未将「证据不可信」纳入 guard.ts 的工作树漂移归因分流逻辑中，若调用了名单外 MCP 且发生漂移，变动会被错误判定为开发者手改；此外 summarizeZcodeMcp 提取名单外工具时未明确并入会话日志独有项。建议修订计划后进入实施。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/MCP执行工具调用检测/plan/2026-10-02-MCP执行工具调用检测-claude.md:141-154` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划引入了「证据不可信」（SideVerification.untrusted），明确其语义为「修饰阴性结论：轨迹无写事件不再足以证明没写」，但遗漏了对工作树漂移归因分流逻辑（guard.ts:706-726）的联动适配，导致调用了名单外 MCP 且发生漂移时，漂移会被错误归咎于开发者手改。

**依据**：查阅 src/trivium/guard.ts:706-726 与 765-773，漂移归因分流依据 anyReadonlyUnavailable 判断：只要没有侧为 readonly: unavailable，changed 中的文件就会全量打入 fingerprintChangedFiles（判定为开发者在审查期间手改）；而 anyReadonlyUnavailable（:723）仅依据静态声明 capabilities.rejectionRecorded === false。zcode 适配器声明为 rejectionRecorded: true。如果 zcode 侧调用了名单外 MCP 工具（运行时标记为 untrusted），此时无写事件已不能证明审查员没写，但 guard.ts 依然会将其工作树变动误判为开发者手改，违背了「不把审查员失守安到开发者头上」的根本设计。

**建议**：在 guard.ts 的归因分流判据中，将「本轮有任一侧 verification.untrusted」纳入无法归因的分流条件（与 anyReadonlyUnavailable 同步分流到 unattributedDriftFiles）；并在计划 §2.4 与 §3.1 的测试矩阵（如 G5 的判定场景）中明确这一规则与断言。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/MCP执行工具调用检测/plan/2026-10-02-MCP执行工具调用检测-claude.md:124-125` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：summarizeZcodeMcp 对名单外不可信工具（untrustedTools）的提取未明确覆盖「仅在会话日志中出现、rollout 缺失或丢行」的边界分支，且 U 测试集存在盲区。

**依据**：查阅 src/trivium/adapters/zcode-trace.ts:130-208 及计划 §2.2，会话日志的 tool.call.* 事件包含 context.toolName。计划在 U5/U6 专门测试了执行型工具在日志独有/多于 rollout 时补写事件，但对于 untrustedTools，计划表述为「名单外 → 不可信工具名：mcp__ 开头而不在执行型名单里的，去重排序后输出」，未明确工具名全集必须取自 rolloutCalls 与 logCounts 的并集；且 §3.1 的 U1-U9 用例中，U3 仅测了 rollout 包含名单外工具，缺少「rollout 为 null 或丢行、仅会话日志记录了名单外 MCP 工具」的用例。若实现时仅从 rolloutCalls 提取工具名，在 rollout 损坏或丢行时会漏记降级。

**建议**：在 §2.2 明确 untrustedTools 的工具名必须从 rolloutCalls 与 logCounts 键集的并集中提取；并在 §3.1 的 U 单测中补充「rollout 为 null 但会话日志含名单外 MCP 工具调用」的断言用例。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/MCP执行工具调用检测/plan/2026-10-02-MCP执行工具调用检测-claude.md:252-253` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：协议文档同步范围不够精确，doc/03_api/PROTOCOL_dual_critic_relay.md 已有逐项列出 verification_degraded 各键的陈述，计划中仅定性写为 grep 读者面「没有就不动」，容易遗漏同步。

**依据**：查阅 doc/03_api/PROTOCOL_dual_critic_relay.md:202-208，该处明确逐项解释了 guard.verification_degraded 下的 path 和 readonly 两个降级键。本次在 run.v2.json 的 verification_degraded 逐侧对象中新增 evidence_untrusted 属性，协议文档属于改动同步清单要求的强同步范围，现有文档中已具备该字段的详细语境，必须具名更新。

**建议**：将 doc/03_api/PROTOCOL_dual_critic_relay.md §二中对 guard.verification_degraded 的键描述明确列入 §4 的文档必须同步清单，而不是交由编码期临时 grep 决定。

## 认为正确的部分

- 赞同执行型 MCP 工具按 server 前缀（mcp__node_repl__）整机拦截，将 js_reset 等控制面工具一并纳入只读失守判定，安全深度合理且符合决策四。
- 赞同 ToolCallCounts 中 mcp 键仅在 > 0 时写入的取舍，严格满足用户决策八「无 MCP 调用与改前逐字相同」，同时避免其余三家缺席与 glm 产生歧义。
- 赞同写事件参数摘要采用「先 redactSecrets 脱敏再截断至 120 字」的顺序，防止截断破坏凭据特征导致敏感信息泄露。
- 赞同 breachedAbs 显式跳过 MCP: 前缀条目的设计，消除了参数代码中内嵌路径被误当成受影响文件扣除的隐患。

## 未覆盖范围（本侧盲区）

- 因无命令执行权限，未在运行时真实拉起 ZCode 运行日志与 rollout 原件测试纯函数的实际解析耗时。
- 未深入评估未来非 MCP 内置表外工具（如 EvalWorkflowSnippet 等暂缓项 S2）的具体执行能力。

## 实际查阅的项目文件

- `.reviews/MCP执行工具调用检测/plan/2026-10-02-MCP执行工具调用检测-claude.md`
- `CLAUDE.md`
- `src/trivium/adapters/zcode-trace.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/guard.ts`
- `src/trivium/render.ts`
- `src/trivium/parse.ts`
- `src/trivium/report.ts`
- `src/trivium/review.ts`
- `skills/dual-critic/schema/run.v2.json`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `src/trivium/types.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/gate.ts`
- `src/trivium/secrets.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":36,"grep":17,"glob":0,"run_command":0,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
