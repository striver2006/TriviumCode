---
schema: trivium.review.v1
topic: 任务书点名禁用MCP执行工具
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.14
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261002T103422Z
rerun_index: 1
snapshot_hash: sha256:f05749f1e6c4a80ee94fd243b7364a669921d062682a33393f18f03966502ae4
blind: true
started_at: 2026-10-02T10:34:24.461Z
finished_at: 2026-10-02T10:43:25.733Z
duration_s: 244
tool_calls:
  read: 36
  grep: 5
  glob: 2
  run_command: 0
  project_reads: 25
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: fc45174a-6aa2-45bc-a3d9-68cc71768722
---

# 计划审查：任务书点名禁用MCP执行工具

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261002T103422Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的问题是计划 §2.4 拟渲染条目尾部附带的「自足写法」：在当前 none 组合下与前文形成直接复读，在未来 readonly-shell 组合下又会剥夺其执行只读命令验证的合法路径，构成逻辑冲突。
此外，计划遗漏了设计文档 §5.1.1 接入套件契约表的同步，单测对三家适配器「缺省不声明」的断言存在盲区。
整体架构解耦与防漂移设计扎实，建议微调措辞并补全文档后进入实施。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2.4` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：新增条目尾部的「自足写法」在未来潜在的 readonly-shell 组合下会与既有只读执行授权产生语义冲突；在当前唯一的 none 组合下又导致三行内两次字面复读「写明是推理并在 not_covered 里列出」。

**依据**：查阅 src/trivium/brief.ts:210-213，当 commandExecution 为 none 时已明确约束「需要运行才能确认的结论写明是推理，并在 not_covered 里列出没能验证的部分」；紧随其后插入计划 §2.4 拟渲染文本会导致连续复读。且若未来存在 readonly-shell 侧声明 mcpExecPrefixes（brief.ts:215-217），该侧本允许执行只读命令，而自足尾巴却强制所有需要运行的结论写明推理进 not_covered，反而剥夺了其只读执行验证的合法路径，构成逻辑冲突。

**建议**：删除新增条目末尾冗余的「需要运行才能确认的结论，写明是推理并在 not_covered 里列出」自足尾巴，让禁令在「整轮在闸门被挡下重跑」处自然完结，保持禁令纯粹且避免跨能力组合时的语义矛盾与复读。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划文档修改清单遗漏了设计文档 §5.1.1 接入套件契约表中关于适配器能力声明的同步更新。

**依据**：查阅 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 第 671 行（§5.1.1 表格），第 ② 件适配器落点描述写明「本体含两项必填能力声明 capability 与 commandExecution」。本次在 CriticAdapter（src/trivium/adapters/base.ts）上新增了可选声明 mcpExecPrefixes，若不同步该处描述，会导致新增 Agent 查阅准入契约时产生信息脱节。

**建议**：在计划 §4 文档修改清单中补充对设计文档 §5.1.1 适配器能力声明的同步项，明确记入可选声明 mcpExecPrefixes。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 ①` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：单测对决策一「其余三家真实适配器缺省不声明」缺少直接的 undefined 断言，无法防止空数组声明的隐蔽违规。

**依据**：计划 §3.1 ① 仅断言其余三家适配器入参取 adapter.mcpExecPrefixes ?? [] 时的渲染结果与空数组逐字相同。若某家适配器被误加上了 mcpExecPrefixes: []（声明了空数组），渲染用例依然全绿，但已违背决策一「其余三家不声明」的规范要求。

**建议**：在 test/unit/brief-mcp-exec.test.ts 中增加对其余三家真实适配器上 adapter.mcpExecPrefixes === undefined 的显式断言。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2.4 与 §3.1 ①` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：多前缀渲染采用顿号直接连接导致单数工具名产生语法歧义，单测未界定多前缀连接词规范。

**依据**：计划 §2.4 规定多前缀「由声明逐个以反引号包裹、顿号连接」，渲染为「名字以 `mcp__a__`、`mcp__b__` 开头」。中文单数主语下使用顿号易被误解为「同时以两者开头」的复合条件，不如「或」连接清晰。

**建议**：渲染多前缀时在多个项之间使用「或」连接（如 `mcp__a__` 或 `mcp__b__`），并在单测中明确断言该语法连接形态。

## 认为正确的部分

- 严格遵循了架构纪律 10，未在 brief.ts 引入侧名分叉或具体 Agent 字面量硬编码，保持了模块解耦
- 适配器直接引用 ZCODE_MCP_EXEC_PREFIXES 单一事实源，并通过单测同一引用断言杜绝名单副本漂移
- 测试桩提供可选覆盖机制以支撑集成测试验证 prepareRun 接线链路，使接线变异能够在零配额下被有效拦截
- 效果层真实运行设定了严格的 4 轮总预算上限与备用轮降级机制，有效防范配额不可控膨胀

## 未覆盖范围（本侧盲区）

- 未在真实环境中拉起包含 MCP 工具的 zcode/glm 运行时验证模型对「前缀匹配」指令的实际遵从概率
- 未实际执行 npm run check 或运行测试套件（本审查员为只读环境，无命令执行能力）

## 实际查阅的项目文件

- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `src/trivium/brief.ts`
- `src/trivium/review.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/zcode-trace.ts`
- `src/trivium/adapters/stub.ts`
- `scripts/mutation-check.mjs`
- `test/unit/command-execution-parity.test.ts`
- `test/unit/brief-command-execution.test.ts`
- `test/unit/brief.test.ts`
- `test/integration/brief-command-execution.test.ts`
- `test/integration/stub-agent-kit.test.ts`
- `test/fixtures/stub-agent-kit/overlay.ts`
- `test/fixtures/stub-agent-kit/pieces/stub-agent.ts.txt`

> 编排器从工具轨迹中记录到的读取次数：{"read":36,"grep":5,"glob":2,"run_command":0,"project_reads":25}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
