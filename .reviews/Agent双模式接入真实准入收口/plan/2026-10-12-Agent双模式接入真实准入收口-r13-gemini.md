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
run_id: 20261011T184407Z
rerun_index: 13
snapshot_hash: sha256:d769e5ac860d97a475b59bd917ce5e8b125bb5e294d6257d8aa3c73db15af35a
blind: true
started_at: 2026-10-11T18:44:13.069Z
finished_at: 2026-10-11T18:54:20.937Z
duration_s: 608
tool_calls:
  read: 29
  grep: 2
  glob: 1
  run_command: 0
  project_reads: 28
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
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
session_id: 9082819d-b7ca-4e51-bfce-cdaff2545600
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261011T184407Z` ｜ 第 13 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最关键风险：计划 r27 提议在受控环境注入合成 settings.json 却未明确 25B 审批 reason 的文本规范与计划哈希绑定契约，与守卫 verify-audit-guard25.mjs 脱节。
计划严格坚持了 fail-closed 原则，拒绝放宽 guard/gate 判据与生产适配器，两候选判据亦未越权采用，符合焦点要求。
合成 settings.json 存在测试与生产环境分叉，须建立严格的防逃逸断言与生命周期清理守卫。
认证时间戳链已推进至 c5b4d9a9，现有诊断脚本和测试尚未覆盖双跳链路演进。
正文审查额度计数存在轻微事实滞后（313 漂移自 323）。
整体建议修改计划（request-changes），补齐审批契约与测试规约后推进。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 2 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md:44` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 r27 在第 4 节及边界说明中提议「按普通委托决定plan」，未给出 25B 审批 reason 的严格文本规范与计划哈希绑定契约，与已生效前置守卫 verify-audit-guard25.mjs 的精确哈希匹配要求不符。

**依据**：查阅 .reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md 第44行及第55行；对照 doc/05_testing/evidence/agent-access-20261011-closeout-r18/verify-audit-guard25.mjs 第11行显式断言 a.reason.includes(planHash)；以及 doc/05_testing/evidence/agent-access-20261011-closeout-r18/static-audit-guard-contract-supplement.json 对审批 reason 包含定稿哈希与范围声明的硬约束。当前计划未给出审批 reason 的标准化文本模板，导致审批执行与守卫校验存在契约空隙。

**建议**：在修订计划中明确补全 25B 审批 reason 的标准文本契约，强制绑定本计划最终定稿的 SHA256，并明示不放宽生产 guard 语义与不采用两候选判据。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md:23` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：受控 pilot 在临时 HOME 注入合成 settings.json 造成与真实生产环境的配置形态分叉，计划缺少启动前后对该文件内容单一性、权限（0600）及与 CLI --settings 禁读规则互不干扰的严格自动化断言规约。

**依据**：查阅 .reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md 第23-28行；对照 doc/05_testing/evidence/agent-access-20261011-closeout-r17/permission-mode-readonly-diagnosis.json 记录的真实生产环境 ~/.claude/settings.json 实际上并不存在 permissions.defaultMode 设置（生产环境走的是 ~/.claude.json 缓存路径）。在受控临时 HOME 中合成该文件属于测试环境特化，必须有严格的防逃逸与无副作用守卫。

**建议**：在计划中增加对合成 settings.json 的全生命周期自动化断言规约：启动前断言文件仅含 permissions.defaultMode: 'default'，启动中断言 CLI 注入的 deny settings 对生产6目标与写操作的拒绝完备性不变，清理阶段验证其彻底移除无残留。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md:57` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：25B 预检已将认证配置哈希推进至 c5b4d9a9，计划虽然提及覆盖本次时间链，但遗漏了配套的级联只读诊断脚本规约与针对双跳时间戳演进的单元测试补充。

**依据**：查阅 .reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md 第57-61行；对照 doc/05_testing/evidence/agent-access-20261011-closeout-r17/run-auth-timestamp-diagnostic-v2.mjs 第20行，该脚本直接硬编码校验配置哈希等于 r24 的 fb64a35a，面对 25B 预检生成的 c5b4d9a9 将直接失败；对照 test/unit/agent-access-auth-applicability.test.ts，目前尚缺少针对 496eed89 -> fb64a35a -> c5b4d9a9 双跳配置哈希与时间戳链路递增性的单元测试。

**建议**：在第 3 节静态收口中补充对级联诊断脚本（如 run-auth-timestamp-diagnostic-v3.mjs）的实现规约，并在 test/unit/agent-access-auth-applicability.test.ts 中增加对双跳时间链单调性与三路由哈希一致性的单元测试断言。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md:18` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划正文中记载的已消耗审查额度（313/333）滞后于 25B 预检执行后的实际落盘状态（已达 323/333），存在台账引用漂移。

**依据**：查阅 .reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md 第18行与第67行；对照 doc/05_testing/evidence/agent-access-20261011-closeout-r18/static-audit-before25.json 与 doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md，在 25B 预检中实际已发生 10 次审查启动（#240-#249），审查额度已消耗至 323/333，正文叙述仍停留在预检前的 313/333。

**建议**：在修订计划中修正审查额度数据为预检落盘后的真实值 323/333，确保与静态审计事实及恢复报告严格保持一致。

## 认为正确的部分

- 计划严格坚持 fail-closed 判据，明确拒绝放宽 controlled-mechanism.mjs 中关于 init.permissionMode 严格等于 default 的判定要求，不靠猜测 CLI 旗标或放大白名单绕过问题。
- 计划明确保持生产适配器、生产 guard/gate/hooks、Bash 判据以及历史 Schema 保持不变，拒绝将测试环境的变通逻辑泄漏至生产核心代码。
- 计划明确将受限工具面 v2 与时间戳 v1 作为独立未采用候选判据，坚守普通 plan/code 审批不越权采用两候选判据、不回写标准准入矩阵的底线。
- 计划提议将 loopback 限额与清理逻辑提取为获批独立的局部测试 helper，有助于解决孤儿连接与并发端口冲突隐患。

## 未覆盖范围（本侧盲区）

- 审查员环境为严格只读沙箱，未实际执行构建或测试脚本验证代码行为。
- 未实际拉起 Claude Code 2.1.296 CLI 测试临时 HOME settings.json 对其内部状态机和权限输出的实际影响。
- 未测试外部模型供应商网络接口的连通性与配额波动。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/post-pilot-mode-plan-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/controlled-pilot-stop.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/permission-mode-readonly-diagnosis.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/diagnostic-turn-status.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/controlled-mechanism.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/controlled-fixture.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/launch-controlled-v1.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/auth-timestamp-applicability.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r17/run-auth-timestamp-diagnostic-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v14.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r18/README.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r18/static-audit-before25.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r18/static-audit-guard-contract-supplement.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r18/verify-audit-guard25.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r18/config-after25-preflight-observation.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r18/review-round25-plan-batch.json`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-controlled-mechanism.test.ts`
- `test/unit/agent-access-criteria-approval.test.ts`
- `test/unit/agent-access-auth-applicability.test.ts`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r12-gemini.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":29,"grep":2,"glob":1,"run_command":0,"project_reads":28}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
