---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
stage: plan
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
run_id: 20261027T230515Z
rerun_index: 1
snapshot_hash: sha256:a43539ea12b0f9c3c9addcb0e0b8cdbea00cc0cb83dcee28f48f99acbc7346ec
blind: true
started_at: 2026-10-27T23:05:23.947Z
finished_at: 2026-10-27T23:12:52.788Z
duration_s: 449
tool_calls:
  read: 45
  grep: 15
  glob: 4
  run_command: 0
  project_reads: 34
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
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
override_reason: 左侧模型信息缺失
session_id: abf35b36-849d-4451-8d0a-5786964a7025
---

# 计划审查：QoderCN官方模型路由与回退阻断

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261027T230515Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

实施计划总体目标明确、边界清晰，坚持了候选侧保持 criticEnabled/driverEnabled 关闭的架构纪律，针对 Qoder CLI 无效模型回退后退出 0 的真机缺陷提出了双通道判定与早退中止的合理方案。主要风险集中在契约与调度层面：§4.3/§4.4 扩展 requested_routes 未闭环 run.v3.json 的 additionalProperties:false 与 worker 严格对比逻辑；model_effective_source 出现表外值；异步 --list-models 与同步 catalogModelsFor 钩子生命周期未定；以及 criticEnabled:false 下 schemas.ts 对 requested_routes 的校验阻断。按本侧意见理顺上述契约后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：重要 4 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.3, §4.4` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：run.v3.requested_routes 扩展与 run.v3.json 强校验及 worker rebuildContext 判定逻辑存在脱节风险

**依据**：skills/dual-critic/schema/run.v3.json:761-770 中 requested_routes 每项明确声明 additionalProperties: false 且必填既有 5 个字段；src/trivium/run-protocol.ts:324-329 在 worker 中以 JSON.stringify(current) !== JSON.stringify(frozen) 逐字核对请求快照。计划 §4.3 提出在 requested_routes 中增加可选证据对象，但 §4.4 仅以模糊的「若扩展 Schema」带过，会导致：① ajv 校验 run.v3.json 失败；② worker 重建上下文时因字段未对齐或键顺序不一致直接抛出 envError。

**建议**：明确将写契约修改作为非可选动作（或另行在适配层快照/证据结构中记录，不直接污染 requested_routes 严格比较项）；若扩展 run.v3.json，须给出确切属性名，并在 run-protocol.ts:325 与 review.ts:1442 同步对齐 current 构造与确定性比较逻辑。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1, §5.3, §5.5` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：回读来源定义 source: unknown / stream 与项目现行类型及 run.v3 Schema 枚举冲突

**依据**：计划 §1、§5.3、§5.5 多次声明「底层身份无证据时为 null/unknown」「effective=null、source=unknown」，且 src/trivium/adapters/qoder-cn-model.ts:35 定义 source: 'stream' | 'unknown'。然而 src/trivium/types.ts:1420, 2091 与 skills/dual-critic/schema/run.v3.json:850-856 明确规定 model_effective_source 只能是 envelope、trace、unverified（以及历史兼容的 requested），不存在 unknown 或 stream 枚举项。

**建议**：对齐 TriviumCode 现有通用枚举契约：无底层有效模型证据或 Auto 路由未回读出具体模型时，model_effective 记为 null，model_effective_source 记为 unverified；从原生事件流读到的有效具体模型来源记为 envelope，避免发明表外字符串导致 Schema 校验红或运行时类型分叉。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.1, §6` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：保持 criticEnabled: false 与跨进程 worker 测试中校验 requested_routes 存在元数据校验冲突

**依据**：计划 §4.1 要求保持 criticEnabled 关闭，§6 计划通过两进程测试验证 worker 对 requested_routes 的严格比对。但在 src/trivium/schemas.ts:281-285 中，checkRunMetaIdentities 明确要求 for (const id of Object.keys(m.requested_routes ?? {})) { if (!isAgentId(id) || !agentById(id)?.criticEnabled) problems.push(...) }。若 qoder-cn 保持 criticEnabled: false，任何包含其 requested_routes 的真实 RunMeta 都会被 validateRunMeta 判为非法。

**建议**：在计划中明确跨进程测试的接入边界：是使用受控测试 harness 模拟入选集合与动态注册表（如单元测试中的 registry 映射夹具），还是在 schemas.ts 中针对已登记但未启用候选侧调整只校验 isAgentId，必须在设计中确定，避免 worker 测试被编排器自检直接拦下。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1, §4.2` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：CriticAdapter.catalogModelsFor 现有同步方法与执行 --list-models 子进程的异步生命周期缺乏衔接说明

**依据**：计划 §3.1 提出执行受测 CLI 的 --list-models 获取目录，§4.2 提出在适配器层提供准备原生路由的钩子（preflight/review 共用）。但查看 src/trivium/adapters/base.ts:210，通用接口 catalogModelsFor?(cfg: Config, vendorProfile?: string | null): CatalogSource | null 是纯同步方法，无法在内部就地 await exec.run。

**建议**：在计划 §4.2 中明确异步准备钩子（pre-warm / prepareRoute）在 preflight 与 review 执行流中的精确调用时机与调用链位置，并说明该钩子解析出的模型快照如何缓存并注入到后续同步调用的 catalogModelsFor 与 validateQoderNativeModelCatalog 中，保证时序闭环。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.3` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：原生配置解析对 JSONC 与环境引用的支持策略未明确实现边界

**依据**：计划 §3.3 称「原生配置解析提取 model.name，遇不支持的 JSONC/环境替换或信任语义拒绝并说明」。但本项目坚持零第三方运行时依赖架构（见 AGENTS.md），Node 原生 JSON.parse 无法直接解析带注释或尾逗号的 JSONC。若遇到带合法注释的官方 settings 文件，缺乏明确的剥注释与最小安全替换策略会导致官方正常配置被误拒。

**建议**：在计划 §3.3 中细化配置解析器的支持子集与实现方式（例如轻量正则剥离标准行/块注释，仅识别显式 ${env:VAR}），并明确列出不支持形态的 fail-closed 报错边界。

## 认为正确的部分

- 严格遵守阶段范围边界（P2），坚持生产未准入侧保持 criticEnabled/driverEnabled 关闭，不提前开放生产准入或篡改既有缺省 Driver/审核者。
- 基于真实失败样本（qoder-cn-failure-*.json）准确识别了 CLI 对无效模型告警后静默回退 Auto 且退出码为 0 的核心风险，制定了 stderr/stdout 增量监听结合进程树早退（stopEarly）拦截的有效治理方案。
- 区分 Auto 路由标签与底层模型身份，明确在缺乏底层证据时保持 model_effective 为 null，防止捏造虚假模型身份。
- 强调官方原生隔离路线与用户既有配置分开记录，使用独立隔离 settings 配合 --config-dir 与 --setting-sources user，杜绝污染或修改用户全局配置。

## 未覆盖范围（本侧盲区）

- macOS 与 Windows 宿主机上 qoderclicn --list-models 的实时命令直调与实际 JSON/文本输出格式验证（审查员无执行写/子进程权限，仅依据既有取证材料与架构推理分析）
- 官方 CN 目录中 Custom/BYOK 模型标记的底层文本字段名（依赖后续真实取证完成 parser 细化）
- Windows 平台的临时凭据 ACL 移除及进程树杀伤机制在真实 Windows 运行时的端到端复验（需等待 Windows 实体机执行回传）

## 实际查阅的项目文件

- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-codex.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `scripts/acceptance/kimi-qoder-cn/probe.mjs`
- `skills/dual-critic/schema/run.v3.json`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/config.ts`
- `src/trivium/critics.ts`
- `src/trivium/guard.ts`
- `src/trivium/retention.ts`
- `src/trivium/review.ts`
- `src/trivium/runner.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/scrub.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `test/unit/adapter-base.test.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":45,"grep":15,"glob":4,"run_command":0,"project_reads":34}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
