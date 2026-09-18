---
schema: trivium.review.v1
topic: M9-ClaudeCode审核者接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.5
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260917T151624Z
rerun_index: 1
snapshot_hash: sha256:a0015ec1bc42e355743eb642f1498aa8d519bd745bcbc84178ae7bb33b52212f
blind: true
started_at: 2026-09-17T15:16:25.629Z
finished_at: 2026-09-17T15:28:47.771Z
duration_s: 307
tool_calls:
  read: 36
  grep: 17
  glob: 0
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 0
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 4a147ee4-2779-4fca-be37-7dbdc02d97a8
---

# 代码审查：M9-ClaudeCode审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260917T151624Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. 最严重问题：doctor 新增的 blocker 分支 ②' 配合探针逻辑，将「没测到」误判为「MCP 硬前置缺席」失守，且遮蔽了信任提示诊断与泛化重跑建议。
2. 根因在于探针未核验工具面时仍将 strict_mcp_config_applied 赋为 false，且 doctor 分支未设 tool_surface_checked === true 前置。
3. EV-40 改用「非零退出且零事件」的干净拒绝判据成立且比原拟更严，$0 API 成本，纯函数测试完备。
4. EV-41 的 stdin 管道载入大包实测证据扎实，已厘清 ARG_MAX 边界。
5. 三个新探针字段中，stream_json_requires_verbose 在设计文档 §3.7.1 与 types.ts 的消费定位存在轻微表述矛盾。
6. 设计文档回填遗漏了文档头版本、现状断言、实测依据、§16.1 里程碑与 §24.1 台账记录。

**结论**：`request-changes`

## 审查意见（共 4 条：阻断 1 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/doctor.ts:277` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：doctor 新增的 blocker 分支 ②' 与探针赋值联动，将「没测到」（如读探针超时、未收到 system/init、或 tools 读回为空）误判为安全失守（blocker），并遮蔽了信任提示诊断（分支 ③）与泛化重跑建议（分支 ⑤/⑥）。

**依据**：在 src/trivium/probes/claude.ts:720 中，若读探针未拿到 system/init（如超时、网络异常、认证失效或需要人工信任），probe.tool_surface_checked 设为 false，注释写明「这不是失守，是没测到」；但 line 741 无条件执行 probe.strict_mcp_config_applied = probe.readonly_flags.includes(STRICT_MCP_CONFIG_FLAG)，因 readonly_flags 为 []，导致该字段被赋予 false 而非 null。随后在 src/trivium/doctor.ts:277 中，分支 ②' 仅检查 !ctx.skipModelCalls && probe.strict_mcp_config_applied === false，未设 probe.tool_surface_checked === true 前置，且排在分支 ③（trust_prompt_required）、⑤（headless_read_ok === null）和 ⑥（tool_surface_checked === false）之前，导致所有读探针未完成的「没测到」情形均被拦截并报错为 blocker。test/unit/claude-severity.test.ts:115/140 之所以未报红，是因为测试夹具 healthy() 硬编码了 strict_mcp_config_applied: true，掩盖了真实运行时 readonly_flags: [] 必定产生 strict_mcp_config_applied: false 的耦合。

**建议**：在 probes/claude.ts:741 中仅在 probe.tool_surface_checked === true 时计算该字段，未核对时保持 null；同时在 doctor.ts:277 为分支 ②' 增加 probe.tool_surface_checked === true 条件（与分支 ② 保持同档），并确保分支 ③（人工信任）在探针因信任问题中断时不被提前拦截。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:389` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：stream_json_requires_verbose 字段在设计文档中的消费描述与类型契约存在表述分歧：设计文档 §3.7.1 称适配层读取该字段，但实际无运行时参数构造消费方，仅用于探针日志的漂移可见性。

**依据**：doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:389 表格声明 --output-format stream-json + --verbose 的来源是「绑定关系本身读 probe.cli.claude.stream_json_requires_verbose」；但 src/trivium/types.ts:611 明确注明「消费方是漂移可见性，不是参数构造：适配层仍按机制类旗标硬编码 --verbose（设计 §11.1 判据一第二类）」。全仓代码中除 src/trivium/probes/claude.ts:895 生成 notes 外，无任何模块读取此字段。设计文档表格的「来源」列描述易引发误解，让人以为适配层需按该字段动态拼装参数。

**建议**：调整设计文档 §3.7.1 表格中的「来源」列说明，对齐 types.ts 与 §11.1 的定调，明确适配层仍按机制类硬编码 --verbose，该字段仅作为探针侧漂移可见性落点。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:6` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：设计文档回填遗漏了文档头现状断言、实测依据清单、§16.1 里程碑状态与 §24.1 演进台账。

**依据**：查阅 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md：文档头 line 6 版本仍为 v1.3.19；line 21 仍断言「M9～M11 尚未开工」；line 28 实测依据未收录 REPORT_2026-09-17_m9_claude_entry_probe.md；line 2804 里程碑表 M9 状态仍为「⏳ 未开始」；line 3237 §24.1 台账「3.7 Claude headless 事实表」行仍停留在 M6/v1.3.7，未登记本次 EV-40 补录的三字段。这与 REPORT_2026-09-17_m9_claude_entry_probe.md:870 待回填清单范围过窄直接相关。

**建议**：升版设计文档至 v1.3.20，在文档头补全实测依据索引与现状断言，将 §16.1 的 M9 状态标为进行中（第 1、2 步完成），并在 §24.1 台账与变更记录中登记 M9 事实回填。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:512` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：PathDenyProbe.coverage_complete 三态计算内联在带有 I/O 的探针流程中，未像 judgeVerboseBinding 那样解耦为可单元测试的纯函数，单元测试覆盖存在缺口。

**依据**：在 src/trivium/probes/claude.ts:512 中，coverage_complete: grepVerdict === 'unverified' ? null : grepVerdict === 'blocked' 紧密内联在 probeClaudePathDeny 过程中。对比 judgeVerboseBinding 抽成了纯函数并拥有 test/unit/claude-events.test.ts:527-573 完备的四格测试，全仓 test/ 目录下对 coverage_complete 的直接断言为 0，缺乏防回归守卫。

**建议**：将 grepVerdict 与 coverage_complete 的状态映射逻辑提取为导出纯函数并补充无 I/O 单元测试，保证三态映射逻辑具备防退化守卫。

## 认为正确的部分

- EV-40 的判据改动（负对照被干净拒绝）实测证据扎实且比原拟更严：原拟假设不带 --verbose 会降级为少吐事件，实测否证为 CLI 硬拒绝（退出码 1、0 事件、0 API 消耗）；落地判据 judgeVerboseBinding 抽成纯函数并锁定四格三态，既避免了匹配 stderr 文案的脆弱性，又免除了负对照的 API 成本。
- EV-41 的准入验证严密且边界清晰：形态 A/B 均以 31KB 大包成功验证整包送达，彻底消除了 ARG_MAX 尺寸焦虑；同时如实记录了形态 C 触发提示注入拦截的证据强弱差异，以及「-」是否为必要约定未被区分的真实实验边界。
- P-a 记忆阻断实验设计精准：单变量对照严格证实了 --restricted 会同时阻断 CLAUDE.md 进入模型上下文，有力地否定了原计划第 ⑤ 件在目标项目注入审查员片段的无效方案。
- 提炼具名常量 STRICT_MCP_CONFIG_FLAG：消除探针命令行构造与 READONLY_INVARIANTS 之间的重复字面量，维持了 registry-parity 对账守卫的灵敏度。

## 未覆盖范围（本侧盲区）

- adapters/claude.ts 适配器具体实现（M9 第 3 步尚未创建，其实际参数拼接与 availability() 逻辑无法在此阶段提前实测）
- 真实执行 trivium doctor 与子进程调用（作为只读审查员不执行写命令与外部 CLI 调用）
- 真实 claude 2.1.273 审查尺度的实际耗时与 token/费用表现（依赖第 6 步真实审查验证）
- doc/06_deployment/ 与 doc/07_manuals/ 等非关键运维手册在当前步骤的潜在影响

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/05_testing/REPORT_2026-09-14_m6_claude_probe.md`
- `doc/05_testing/REPORT_2026-09-17_m9_claude_entry_probe.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/claude.ts`
- `test/unit/claude-events.test.ts`
- `test/unit/claude-severity.test.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":36,"grep":17,"glob":0,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
