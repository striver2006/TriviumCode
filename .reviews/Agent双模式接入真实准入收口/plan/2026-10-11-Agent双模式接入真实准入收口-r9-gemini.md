---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.3.3
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261011T093157Z
rerun_index: 9
snapshot_hash: sha256:f70191cd91b3e3b4b55b8c90ff85fea59cfb5729ef551d37bf55421ceaeefeaa
blind: true
started_at: 2026-10-11T09:32:02.295Z
finished_at: 2026-10-11T09:43:21.800Z
duration_s: 354
tool_calls:
  read: 25
  grep: 1
  glob: 0
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: qwen3.8-flash
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：qwen / gemini
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 39abf8dc-2479-4609-920d-0f6525c49b7e
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261011T093157Z` ｜ 第 9 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划紧扣审查焦点「授权轮次可以按需增加，不必询问授权」，以独立授权 v8 仅有界追加 16B/17C，保持旧 15 次记录、失败状态与 v2 守卫语义不变，严守轮数追加委托不等于准入判据变更授权的红线。
针对 Codex/Qwen read-3 暴露的复合命令未知解析、findings 字符串数组破坏契约及首词未对齐三项失败，计划提出调用前后 README 字节/哈希绑定核对、去除任务书中真实哨兵泄露与预设 approve 结论、补充对象 Schema 指引及仅限诊断的单 cat 全量文本核验，方案精准、不以诊断替代生产判据。
次要关注点在于 closeout 任务书提示词调整时须防止意外污染 write/deny 及 Claude 臂的字节契约。
整体方案严谨，同意进入实施。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r19-codex.md:33` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §3.3 明确要求「Claude既有已测任务书不改；write和deny臂既有任务书不改；只对Codex真实读取臂引入这套任务级修订」，但当前 scripts/agent-access-closeout.mjs 中的 outputInstruction 是在顶层由 expected 统一定义并被所有 arm（含 write 与 deny）及各 agent 共享。若实现中直接修改全局 outputInstruction，将波及非 Codex 读取臂的任务书提示词，违反「write/deny/Claude字节行为保持」的契约约束。

**依据**：查阅 .reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r19-codex.md:33-41 与 scripts/agent-access-closeout.mjs:133-139。

**建议**：在 closeout.mjs 中按 agent 与 arm 精确解耦 outputInstruction 分支（仅在 agent === 'codex' && arm === 'read' 时使用去首词泄露并包含 findings 结构指引的新提示，其余分支沿用既有模板），并在定向回归中校验 write/deny/Claude 任务书文本哈希零漂移。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r19-codex.md:29` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §3.2 提出增加单 cat 完整输出诊断并输出 read_content_diagnostic，但未明确该字段在证据 JSON 中的挂载层级（是顶层 result.json 字段，还是 command_evidence/pairs 的内嵌属性）。

**依据**：查阅 .reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r19-codex.md:29、scripts/agent-access-evidence.mjs:80-116 与 scripts/agent-access-closeout.mjs:257-266。

**建议**：在实现设计中明确 read_content_diagnostic 的装配位置（建议由 codexCommandEvidence 采集并挂载于 result.json），并确保在失败或无匹配命令时保持类型明确，不破坏既有布尔判据。

## 认为正确的部分

- 落实用户审查焦点委托「授权轮次可以按需增加，不必询问授权」，采用独立 v8 授权追加 16B/17C 有界批，保留全部 15 次历史运行与失败状态，明确轮数委托不自动包含准入判据变化批准。
- 准确剖析 Codex/Qwen read-3 失败的真实根因（复合命令 parsed_cmd=unknown、findings 字符串数组导致 finding_unaddressable、summary 非首词），坚持原 actual_read 判据函数逐字保留，不将 unknown 升级为 read，不合成伪读通过。
- 在 scripts/agent-access-evidence.mjs 与 closeout.mjs 中引入调用前后 README 文件的精确存在性、字节与哈希比对，建立不可篡改的文件状态基线。
- 在任务书中剥离真实首词泄露与预设 approve 结论，规范 findings 对象结构指引与单 cat 要求，从源头消除对模型真实读取判定的干扰。
- 明确不盲目引入 --output-schema 旗标，尊重 EV-124 关于 Qwen 端点忽略 schema 的实测结论，恪守架构纪律 1。
- 清晰维持历史整改、未测组合与真实准入标准（真实模型尝试、唯一 ID 配对拒绝、前后状态），不以诊断或受控样本代替生产标准，未测边界诚实暴露。

## 未覆盖范围（本侧盲区）

- 本侧审查员处于严格只读隔离环境，未执行任何命令或测试，未能通过实际运行 node --test 验证用例在当前工作树上的实际执行结果。
- 未实际启动 Node 子进程验证 launch-v12.mjs 与 round-guard-v2.mjs 在传递真实环境与 token 时的端到端拦截行为。
- 未能调用外部模型 CLI 验证各路线模型在真实网络与凭据环境下的实际准入能力。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r19-codex.md`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-selection.mjs`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-applicability.test.ts`
- `src/trivium/probes/fixture.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/parse.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v8.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v12.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/static-audit-before16.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/formal-round16-authorization-verification.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/codex-qwen-read3-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/post-round15-read-evidence-plan-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/matrix-admission15.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/final-admission15-audit.json`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r8-gemini.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":25,"grep":1,"glob":0,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
