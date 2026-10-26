---
schema: trivium.review.v2
topic: KimiCode与QoderCN双角色接入
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.4.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261026T174236Z
rerun_index: 1
snapshot_hash: sha256:4dd32c184995dc930cb3ae2094e7063faa1b86de1640a195f648c4403c464ad2
blind: true
started_at: 2026-10-26T17:42:42.202Z
finished_at: 2026-10-26T18:02:42.064Z
duration_s: 420
tool_calls:
  read: 41
  grep: 5
  glob: 5
  run_command: 0
  project_reads: 24
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 4
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
session_id: 429e1464-b475-4902-a1c6-bf762b741a2b
---

# 计划审查：KimiCode与QoderCN双角色接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261026T174236Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

方案对两家新角色的能力准入设计了极其严密的受控夹具与负对照要求，但在编排器核心契约层存在关键断点：未定义新 Agent 的 AgentVendor 字面量及模型族归属规则，直接导致 registry 类型与两段式校验受阻；未给出 config.v2.json 的具体 schema 分支，易引发配置校验崩溃；存量项目配置中缺少新节点时显式选侧会被 resolveCriticSelection 误拒；多 Driver 宿主环境与当前 registry 单一 entrySkillRoot 的安装分发机制脱节。建议修改并补全相关契约细节后通过实施（pass-after-changes）。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：重要 4 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1.1 与 §3.1.6` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：未定义 kimi 与 qoder-cn 的 vendor 枚举字面量以及模型族判定规则（VENDOR_MODEL_FAMILY 与 MODEL_FAMILY_RULES），导致两段式契约与 tsc strict 编译受阻。

**依据**：查阅 src/trivium/agents/registry.ts:44-63，AgentVendor 为受限联合类型，且 VENDOR_MODEL_FAMILY 声明为 Record<AgentVendor, RegExp>（类型完备性约束），同时 MODEL_FAMILY_RULES 维护各供应商的模型族归属规则。被审方案 plan §3.1 第 1 项仅笼统称「新增身份、vendor」，未明确 kimi（如 'moonshot' 或 'kimi'）与 qoder-cn（如 'qoder' 或 'qoder-cn'）的标准 vendor 字符串，亦未设计 MODEL_FAMILY_RULES 中针对 Kimi (Moonshot/Kimi-k1.x) 和 Qoder 模型族的前缀比对逻辑，无法满足两段式校验要求。

**建议**：在计划中明确补齐 kimi 和 qoder-cn 的 vendor 枚举字面量定义，并在 registry.ts 的 VENDOR_MODEL_FAMILY 及 MODEL_FAMILY_RULES 中补充对应模型族前缀模式与归属规则。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1.7` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：未定义 config.v2.json 中 agents.kimi 和 agents['qoder-cn'] 的独立 JSON Schema 校验形状，将导致 configurableVendors 守卫与 ajv 校验冲突。

**依据**：查阅 skills/dual-critic/schema/config.v2.json:115-180 与 src/trivium/schemas.ts:186-218，config.v2.json 的 properties.agents.additionalProperties.oneOf 显式穷举了各供应商特有的配置 schema，且 schemas.ts 中通过 configurableVendors() 抽取注册表中的供应商，检查其必须在 config.v2 中具备对应 schema 分支。被审方案 plan §3.1 第 7 项仅声明「新 Agent 配置为可选；类型/schema 追加新 vendor 的形状」，未明确给出两家的 schema 分支定义（例如 bin、profile、tiers、permission 字段要求），会直接阻断模式校验或配置加载。

**建议**：在计划 §3.1.7 中明确定义 kimi 和 qoder-cn 在 config.v2.json 中的 schema 属性规范（含 required 字段、模式属性约束及与现有配置字段的对齐方式）。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1.7` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：存量项目的 config.yaml 若未写入新 Agent 节点，显式指定 --critics kimi 时会被 resolveCriticSelection 误拒为 EXIT.USAGE。

**依据**：查阅 src/trivium/critics.ts:88-90 及 :383-390，resolveCriticSelection 在校验 --critics 入选列表时，要求入选审核者必须存在于 cfg.agents 中（即 cfg.agents[c] !== undefined），否则直接抛出 EXIT.USAGE 退出；而 plan §3.1 第 7 项强调「新 Agent 配置为可选；旧四家配置不用补新段即可运行」。若存量配置未显式包含 kimi/qoder-cn 节点，且编排器未在 loadConfig / resolveConfig 时予以缺省键合并，用户使用 --critics kimi 将被直接拦截无法启动。

**建议**：在计划中明确配置合并策略：对于缺省未配置的 kimi 与 qoder-cn，在 resolveConfig 或 critics.ts 判定前由 defaultConfig() 注入默认空配置结构，或调整 resolveCriticSelection 对默认配置存在性的判定逻辑，确保向后兼容与显式选侧顺畅。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1 与 §3.3` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：多 Driver 入口接入要求与当前 registry.ts 的单 entrySkillRoot 模型存在结构性脱节，未说明多环境安装落点与分发机制。

**依据**：任务书与被审方案 §1 明确要求 Kimi 验收 3 个 Driver 入口（官方 CLI、Kimi Code 桌面端、Kimi VS Code 插件），Qoder CN 验收 2 个（官方 CLI、桌面端）。但查阅 src/trivium/agents/registry.ts:225-245 及 src/install.ts:25-95，现有 AgentSpec 仅支持单一 entrySkillRoot 以及辅助 entrySkillExtraReadRoots，install.ts 是按固定逻辑将渲染产物同步至用户全局目录。方案未阐明 install.ts 如何将 dual-* 入口安装到 VS Code 插件技能目录及桌面端目录，亦未说明 carrier.yaml 的渲染物分发路径。

**建议**：在计划 §3.1 与 §3.3 中细化 Driver 入口技能安装模型：明确 registry.ts 是扩展 entrySkillRootSpec 支持多目标分发，还是在 install.ts 中增加专用安装子目标，并界定各宿主（CLI、Desktop、VS Code 插件）的技能加载根路径。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1.4` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：未规划 lenses.yaml 中 kimi 与 qoder-cn 的正交审查维度，易触发镜头重叠度（Jaccard 距离）退化告警。

**依据**：查阅 skills/dual-critic/lenses.yaml 与 test/unit/registry-parity.test.ts，registry-parity 严格守卫所有已注册且 criticEnabled 为 true 的 Agent 必须在 lenses.yaml 中拥有独立的顶层 key，且各 Agent 之间的审查镜头应保持互补性。方案 §3.1 第 4 项仅称「新增两侧独立镜头，沿用动态选择」，未规划两家具体关注哪些独特维度（如原生能力侧重、中文生态规范、安全性与权限边界等），缺乏避免镜头冗余的设计。

**建议**：在方案 §3.1.4 中补充两家审核者在 plan/code/bug 阶段的专有镜头维度定义，确保与现有四家（claude/gemini/glm/codex）形成互补且无同质化冲突。

## 认为正确的部分

- 对只读审核者能力准入设立了极其严密的受控夹具与负对照矩阵，明确拒绝提示词只读降级与口头拒绝，严格保持 fail-closed 准入原则。
- 坚持架构纪律 10、11、12：身份与意见前缀唯一由 agents/registry.ts 派生，Schema 仅校形状不枚举 Agent id，避免硬编码分叉。
- 贯彻两阶段接入闭环，将能力取证与生产适配解耦，优先使用只读探针和受控环境验证 CLI 身份、参数形状及轨迹完整性。
- 对 Windows 环境下的跨平台支持边界清晰，通过远程委托方案（Bob 机器验证、带签名快照的清单传递）避免虚假宣称。

## 未覆盖范围（本侧盲区）

- 因审查员处于只读环境，未实际运行 Kimi 与 Qoder CN 的 CLI 二进制文件及探针命令。
- Windows 平台（PowerShell/Git Bash）下的实际进程树行为与路径转义实测结果。
- 宿主机器上实际 Kimi Code Desktop / Qoder CN Desktop 的本地 socket 通信与私有协议解析细节。

## 实际查阅的项目文件

- `.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-codex.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/schemas.ts`
- `src/trivium/config.ts`
- `src/trivium/critics.ts`
- `skills/dual-critic/schema/config.v2.json`
- `skills/dual-critic/lenses.yaml`
- `src/install.ts`
- `skills-src/carriers/gemini.yaml`
- `skills-src/carriers/codex.yaml`
- `test/unit/registry-parity.test.ts`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":41,"grep":5,"glob":5,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
