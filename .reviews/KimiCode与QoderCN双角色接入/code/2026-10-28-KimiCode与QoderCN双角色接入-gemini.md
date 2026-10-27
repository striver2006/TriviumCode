---
schema: trivium.review.v2
topic: KimiCode与QoderCN双角色接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.4.8
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261027T155518Z
rerun_index: 1
snapshot_hash: sha256:c2d8989352b8d98150b674dd5dec536f1332db6895121ec688e9b73321a3e19a
blind: true
started_at: 2026-10-27T15:55:25.347Z
finished_at: 2026-10-27T16:19:32.778Z
duration_s: 746
tool_calls:
  read: 48
  grep: 12
  glob: 3
  run_command: 0
  project_reads: 35
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 3
  minor: 1
  nit: 0
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
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 17a6d8cd-207f-43c3-9905-6b60775c9790
---

# 代码审查：KimiCode与QoderCN双角色接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261027T155518Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

1. 【最危险】Schema 与类型定义中对 moonshot 与 qoder-cn 违规放行 readonly_enforcement:prompt-only，公然破坏已批准计划 §7.2 安全裁决与禁止 prompt-only 降级的架构纪律（ADR-002）。
2. Kimi (moonshot) 的 tiers 错误引用 tiersCommon，引入了未经验收的 effort 与 profile 暴露面。
3. 两家配置中 bin 在 Schema 与 types.ts 中被误设为必填，导致省略 bin 的合法配置校验失败。
4. Qoder CN 模型校验未防御 defaults 包含 'auto' 的情况，破坏了非 auto fail-closed 防线。
5. Qoder CN 回退断言仅查 stderr 存在告警漏检盲区，且请求解析将 declared 与 requested 混淆。
6. 取证报告与用例中诚实标记未测状态及 Kimi 规则探针失败反例，未作假准入，但上述配置、契约与逻辑问题必须先驳回并修改。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：阻断 1 ｜ 重要 3 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/schema/config.v2.json:566-572,608-614` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：Schema与TypeScript类型定义中违背已批准计划§7.2裁决，非法放开并接受 readonly_enforcement:prompt-only。计划与架构原则明确禁止接受 prompt-only 作为只读隔离降级（ADR-002），但 moonshot 与 qoder-cn 的 Agent 配置 schema 及 types.ts 均显式声明了 readonly_enforcement: { enum: ['required', 'prompt-only'] }，导致存在严重安全与契约降级风险。

**依据**：查阅已批准计划 .reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md §7.2 明确裁定：'不接受 profile、readonly_enforcement:prompt-only、任意 permission 参数'。然而在 skills/dual-critic/schema/config.v2.json 的 moonshot (第 566-572 行) 与 qoder-cn (第 608-614 行) 中，以及 src/trivium/types.ts (第 1111 行、第 1119 行) 中，均新增了 readonly_enforcement: 'required' | 'prompt-only'。

**建议**：移除 config.v2.json 和 src/trivium/types.ts 中 moonshot 与 qoder-cn 配置项对 readonly_enforcement 的定义与取值支持，严格与已批准实施计划 §7.2 保持一致，禁止接受 prompt-only 配置。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/schema/config.v2.json:574-576` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：Kimi (moonshot) 的 tiers 配置错误引用了 tiersCommon，允许配置未经真机验收的 effort 与 profile，直接破坏计划 §7.2 对新侧不接受 effort/profile 的约束边界。

**依据**：查阅 .reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md §7.2 规定：'首版没有已验收 effort 覆盖时不接受新侧 effort，不能静默忽略。两支 AgentConfig 为 {vendor, bin?, tiers?: Partial<Record<TierName, {model:string}>>, default_tier?}'。而在 skills/dual-critic/schema/config.v2.json 中，qoder-cn 正确引用了 tiersModelOnly (第 616 行)，但 moonshot (第 574-576 行) 却引用了 tiersCommon，从而向用户暴露并放行了包含 effort 与 profile 的 tierEntry。

**建议**：将 skills/dual-critic/schema/config.v2.json 中 moonshot 的 tiers 引用从 tiersCommon 改为 tiersModelOnly，与 qoder-cn 保持一致，并在 src/trivium/config.ts 解析时收紧校验。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/schema/config.v2.json:544-547,586-589` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：config.v2.json 与 src/trivium/types.ts 将 bin 标记为必填字段（required: ['vendor', 'bin']），导致用户按计划省略 bin 时 ajv 校验直接失败。

**依据**：查阅 .reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md §7.2 声明：'两支 AgentConfig 为 {vendor, bin?, tiers?: Partial<Record<TierName, {model:string}>>, default_tier?}，bin 省略/null 表示官方 CLI 发现'。然而在 skills/dual-critic/schema/config.v2.json 中，moonshot (第 544-547 行) 和 qoder-cn (第 586-589 行) 均将 bin 列入 required 数组；同时 src/trivium/types.ts 第 1108 与 1117 行也将其定义为必填的 bin: string | null，导致省略 bin 的合法配置文件被 ajv 拒绝。

**建议**：在 skills/dual-critic/schema/config.v2.json 中将 required: ['vendor', 'bin'] 改为 required: ['vendor']；在 src/trivium/types.ts 中将 bin 调整为可选字段 bin?: string | null。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:76-84` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：validateQoderNativeModelCatalog 未防御 defaults 中配置或回读为 'auto' 的情况，存在绕过 fail-closed 准入的漏洞。

**依据**：在 doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md 及 doc/05_testing/evidence/kimi-qoder-cn-20261027/qoder-cn-open-2026-10-26T18-18-10-886Z-2bcf3534.json 中明确表明 Qoder 原生模型列表中包含 'auto'。而在 src/trivium/adapters/qoder-cn-model.ts 的 validateQoderNativeModelCatalog 函数中（第 76-84 行），仅校验了 !available.includes(model)，未校验 model.toLowerCase() !== 'auto'。当 defaults 中为 'auto' 时，只要 available 中也包含 'auto'，即可合法通过校验，破坏了默认档位必须是具体模型、不可为 auto 的 fail-closed 约束。

**建议**：在 validateQoderNativeModelCatalog 中对 defaults[tier] 增加必须不为 'auto'（不区分大小写）的显式防御检查，一旦为 'auto' 立即抛出解析或准入错误。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:105,151` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：assertQoderModelDidNotFallback 仅检测 stderr 存在回退识别盲区；且 resolveQoderModelRequest 将 declared 写死为 requested 破坏了配置默认与覆盖请求的区分记录。

**依据**：在 src/trivium/adapters/qoder-cn-model.ts 中：1. 第 151 行 assertQoderModelDidNotFallback 仅对 stderr 执行正则匹配，但在 Qoder CLI 输出中（如 doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json 记录的 stream-json 或文本提示），若 fallback 提示出现在 stdout 某一行，将无法捕获；2. 第 105 行 resolveQoderModelRequest 将 declared: requested 直接赋值，当调用方传入 override 时，抹除了原始配置声明模型 (declared) 与实际请求模型 (requested) 的差异，使得 run 元数据记录失真。

**建议**：在 assertQoderModelDidNotFallback 中增加对 stdout 逐行文本或混合输出的回退特征正则检测；在 resolveQoderModelRequest 中将 declared 保留为目录默认模型（或配置声明模型），requested 保留为 override || declared，确保留痕语义清晰。

## 认为正确的部分

- 注册表 registry.ts 正确解耦了 Driver 接入与 Critic 准入能力，criticEnabled: false 保持紧闭
- skills-src/carriers/ 与渲染产物严格对应，多载体命令契约渲染与卸载路径完整清晰
- 取证材料真实保留了 Kimi 规则探针 deny arm 拦截失败的反例与 Qoder CN 无效模型失败案例，未冒充客户端安全防护通过
- release-package 及 install 逻辑充分考虑了仅作为 Driver 的新载体资产打包与多目标安装校验

## 未覆盖范围（本侧盲区）

- Windows 真实环境下的 Kimi Code 与 Qoder CN CLI 路径与执行行为
- VS Code Extension Host 真实多进程生命周期与真实 GUI 交互
- 真实网络环境下 Qoder CN 在线模型探测及动态 fallback 响应流

## 实际查阅的项目文件

- `.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md`
- `doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-37-19-914Z-36a4f815.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-tools/kimi-tools-2026-10-27T15-53-39-513Z-4c128b5e.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027/qoder-cn-open-2026-10-26T18-18-10-886Z-2bcf3534.json`
- `doc/07_manuals/MANUAL_user.md`
- `doc/07_manuals/QUICKSTART.md`
- `skills-src/carriers/kimi.yaml`
- `skills-src/carriers/qoder-cn.yaml`
- `skills/dual-critic/entry/kimi/dual-run/SKILL.md`
- `skills/dual-critic/schema/config.v2.json`
- `src/install.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/config.ts`
- `src/trivium/types.ts`
- `test/contract/entry-render-parity.test.ts`
- `test/contract/skill-recalibrate.test.ts`
- `test/integration/release-package.test.ts`
- `test/unit/install.test.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":48,"grep":12,"glob":3,"run_command":0,"project_reads":35}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
