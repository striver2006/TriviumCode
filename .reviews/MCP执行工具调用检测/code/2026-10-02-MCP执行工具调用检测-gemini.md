---
schema: trivium.review.v1
topic: MCP执行工具调用检测
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.14
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261002T081745Z
rerun_index: 1
snapshot_hash: sha256:37e48b5286aa54dc39d821ee2ce0f9412742c42111512fba2e5732d1ae48f241
blind: true
started_at: 2026-10-02T08:17:48.087Z
finished_at: 2026-10-02T08:30:38.053Z
duration_s: 307
tool_calls:
  read: 37
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 19
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
session_id: 39307f0c-28d2-45a6-bbf6-431d8d43e358
---

# 代码审查：MCP执行工具调用检测

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261002T081745Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本补丁完整实现了 MCP 执行工具调用检测（EV-188）：
1. zcode 侧轨迹解析准确合并 rollout 与会话日志中的 MCP 调用（按调用 ID 求并集、日志按名兜底，解决同名多次去重问题）；
2. 执行型工具（mcp__node_repl__）准确以 MCP: 前缀并入 write_events 触发只读失守并阻断闸门；名单外 MCP 工具准确记入 evidence_untrusted 并走五面留痕；
3. 漂移归因分流周全，证据不可信与 MCP 执行型条目均正确流向「无法归因」桶，避免将审查员潜在写入误归为开发者手改；
4. breachedAbs 针对 MCP: 前缀做显式跳过，防御代码摘要被误作路径解析；
5. 对外契约（run.v2.json、front-matter、ECHOED_ORCHESTRATOR_KEYS 及 PROTOCOL 文档）严格同步，单测、适配器测、契约测试、变异与集成测试完备，偏离计划处均有充分显式记录，代码质量极高。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 按调用 ID 求并集与写事件带 ID：解决了计划 r2 误判日志无 ID 的问题，且在条目中携带调用 ID 彻底避免了同前缀代码摘要被去重成一条，保证了写事件计数与实际调用次数严格一致。
- 漂移归因完整性：不仅将 evidence_untrusted 纳入无法归因桶，还补齐了 MCP 执行型条目（写事件只有代码摘要无路径）使漂移落入 unattributedDriftFiles，消除了将审查员潜在写入误判为开发者手改的风险。
- 防误扣除路径隔离：breachedAbs 显式识别 MCP_WRITE_EVENT_PREFIX 并跳过路径提取，有效防御了代码摘要未来演进可能形似相对路径导致的错误扣除。
- 契约与留痕五面闭环：run.v2 schema 逐侧增加 evidence_untrusted，文档横幅、front-matter 条件键、运行期告警分句、report 旗标全链路贯通，且 ECHOED_ORCHESTRATOR_KEYS 同步更新并由 P9 对账测试守卫。
- 零 MCP 运行严格向后兼容：当本轮无 MCP 调用时，mcp 键、mcpCalls、evidence_untrusted 均在数据结构中完全缺席，保持既有留痕格式逐字不变。

## 未覆盖范围（本侧盲区）

- 本审查员无命令执行能力，未在终端真实拉起 node 子进程或实际执行 npm test / trivium cli 命令，所有关于测试用例、变异覆盖率及退出码的验证结论均基于代码静态推演与已归档测试报告 / 证据材料的比对。
- 真实 ZCode (GLM) 运行期的网络请求与真实插件缓存 HOME 交互细节依赖宿主环境，本审查仅核验了 mock/sample 注入与轨迹解析逻辑，未对外部环境进行实机拉起验证。

## 实际查阅的项目文件

- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-02_mcp_exec_detect.md`
- `doc/05_testing/evidence/mcp-exec-detect-20261002/acceptance-output.txt`
- `doc/05_testing/evidence/mcp-exec-detect-20261002/runs/r1/run.json`
- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/adapters/zcode-trace.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/guard.ts`
- `src/trivium/parse.ts`
- `src/trivium/render.ts`
- `src/trivium/report.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `src/trivium/gate.ts`
- `test/helpers/zcode-mcp-samples.ts`
- `test/unit/zcode-mcp-detect.test.ts`
- `test/unit/zcode-mcp-adapter.test.ts`
- `test/unit/run-schema-mcp.test.ts`
- `test/integration/mcp-detect.test.ts`
- `test/unit/parse-degrade.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":37,"grep":9,"glob":0,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
