---
schema: trivium.review.v1
topic: 任务书点名禁用MCP执行工具
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.14
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261002T110839Z
rerun_index: 1
snapshot_hash: sha256:b9511154a943ae51b62a25534575622511a91b83264452cce53a39fdcdafa4cd
blind: true
started_at: 2026-10-02T11:08:42.496Z
finished_at: 2026-10-02T11:16:07.020Z
duration_s: 150
tool_calls:
  read: 23
  grep: 4
  glob: 2
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: approve
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: 069ad90f-07b7-4dd4-8d8d-bec380270743
---

# 代码审查：任务书点名禁用MCP执行工具

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261002T110839Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

代码变更完全落实已批准的计划 r2（EV-191 缓解①），未偏离计划且无多余复杂度。
1. 适配器新增可选声明 mcpExecPrefixes，zcode 适配器直接引用事实源 ZCODE_MCP_EXEC_PREFIXES 保证单一名单，其余侧与桩缺省保持未声明（不含该键）。
2. 任务书渲染入参 mcpExecPrefixes 必填，review.ts 完成从适配器声明到渲染入参的动态分发，避免在渲染层硬编码或按侧名分叉，满足纪律 7 与 10。
3. brief.ts 渲染逻辑对多前缀连接格式处理得当，紧跟证据性质最后一条并准确回指上一条，段落数与结构不变。
4. 单测与集成测试覆盖完备，变异测试全部咬住，改前改后对照 19/19 零漂移，文档与契约同步齐备。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 适配器层设计合理：CriticAdapter.mcpExecPrefixes 作为可选声明避免向不具备该面的其他三家引入无意义冗余字段；桩适配器通过 StubSpec.mcpExecPrefixes 仅在显式传入时挂载，保证既有缺省桩行为不变的同时为集成测试打通接线验证链路。
- 事实源单一性严守纪律：zcodeAdapter.mcpExecPrefixes 直接引用 ZCODE_MCP_EXEC_PREFIXES，并在单测中以对象同一性断言守住，彻底杜绝两份名单漂移风险。
- 任务书生成逻辑严格解耦：renderBrief 纯由 BriefInput.mcpExecPrefixes 驱动，未引入任何特定 Agent ID 或厂商硬编码，各侧差异完全由适配器生命周期管理。
- 测试与验证充分可信：单测严守未声明侧的负断言与结构计数，集成测试验证了双侧互换下禁令跟随声明而非侧名的动态性；改前改后对照与变异测试设计严谨；真实 glm 效果层验证如实记录了单次样本的统计局限性。

## 未覆盖范围（本侧盲区）

- 未真机拉起真实厂商 CLI（agy / codex / zcode）复测审查全流程，因审查员无写权限与执行命令权限，效果层与机制层验证依据被审材料中的测试报告与离线代码审查推演。
- 未验证多前缀（3 个及以上）在真实审查员交互场景下的阅读理解效果，仅通过单元测试覆盖了文本生成与标点拼接逻辑。
- 未涉及名单外 MCP 工具的处置策略，该项已依决策登记为待议事项（BACKLOG EV-192）。

## 实际查阅的项目文件

- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-02_brief_mcp_exec_ban.md`
- `doc/05_testing/evidence/brief-mcp-exec-ban-20261002/acceptance-output.txt`
- `doc/05_testing/evidence/brief-mcp-exec-ban-20261002/acceptance.mjs`
- `doc/08_project/BACKLOG.md`
- `.reviews/任务书点名禁用MCP执行工具/plan/2026-10-02-任务书点名禁用MCP执行工具-r2-claude.md`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/zcode-trace.ts`
- `src/trivium/brief.ts`
- `src/trivium/review.ts`
- `test/unit/brief-mcp-exec.test.ts`
- `test/integration/brief-mcp-exec.test.ts`
- `test/unit/brief-command-execution.test.ts`
- `test/unit/brief-output-contract.test.ts`
- `test/unit/brief.test.ts`
- `test/unit/registry-parity.test.ts`
- `test/fixtures/stub-agent-kit/pieces/stub-agent.ts.txt`
- `test/integration/stub-agent-kit.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":23,"grep":4,"glob":2,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
