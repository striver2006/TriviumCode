---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
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
run_id: 20261027T233105Z
rerun_index: 1
snapshot_hash: sha256:8f5c5579ea42fe6e5533b65b2db2de53c10cdb46d42d6e3647901b691ec9c237
blind: true
started_at: 2026-10-27T23:31:13.628Z
finished_at: 2026-10-27T23:42:57.105Z
duration_s: 703
tool_calls:
  read: 65
  grep: 25
  glob: 0
  run_command: 0
  project_reads: 42
evidence_ok: true
verdict: reject
findings_count:
  blocker: 2
  major: 1
  minor: 2
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
session_id: f4964c33-e829-447a-b6b1-39b202bf8210
---

# 代码审查：QoderCN官方模型路由与回退阻断

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261027T233105Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

1. 真实 Qoder CLI stderr 回退告警末尾带有使用提示，导致当前正则完全脱节无法匹配，回退阻断核心机制在真机 stderr 下旁路失效；
2. withQoderHome 清理阶段将返回对象的异步调用作真值判断导致无论存活均强杀，且辅助进程自然退出时在 finally 中抛出异常阻断清理；
3. render.ts 透传的 native_model 漏加进 parse.ts 的 ECHOED_ORCHESTRATOR_KEYS，破坏透传白名单契约并导致解析退化风险；
4. 探针硬编码 source: 'catalog-default' 丢失了计划中原生配置来源 config 路径，且 preflight 检查模型目录时因候选准入开关未直通已接线的适配器钩子。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：阻断 2 ｜ 重要 1 ｜ 次要 2）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:87` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：回退告警正则表达式尾部定界符限制过死，无法匹配 Qoder CLI 真实输出的 stderr 告警文本，导致 stderr 回退检测与早期阻断在真实运行中完全失效。

**依据**：查阅 src/trivium/adapters/qoder-cn-model.ts:87，匹配模式写为 /^\s*Model\s+["'][^"']+["']\s+is not available(?: right now)?;?\s+using\s+["'][^"']+["']\s+instead\.?\s*$/i，要求必须以 instead.? 结尾。而在真实真机测试证据 doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json 第 63 行以及 doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-27-51-812Z-b0b109.json 第 256 行中，Qoder CLI 实际打印的完整 stderr 为：'Model "..." is not available right now; using "auto" instead. Use /model to choose another model.'。该行末尾包含后续提示语，导致正则表达式完全不匹配。在 test/unit/qoder-cn-model.test.ts:75 中，由于使用了人工裁剪的假数据且 stdout 恰好包含 {"model":"Auto"} 触发了后置的模型比对失败，掩盖了真实 stderr 阻断完全旁路的问题。

**建议**：放宽正则尾部匹配，允许匹配真实输出中的提示信息（如 (?:instead\.?(?:\s+Use\s+\/model\s+to\s+choose\s+another\s+model\.?)?)\s*$ 或采用前缀词边界识别），并在单测中引入包含真实完整 CLI 输出的用例。

### AGY-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-native.ts:51-55` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：withQoderHome 清理逻辑中将返回对象的异步调用直接用作布尔判断，导致无论存活与否均强行强杀；且在 finally 块中因进程自然退出抛出异常，阻断环境清理。

**依据**：查阅 src/trivium/adapters/qoder-cn-native.ts:53 与 55 行，代码为 if (await processAlive(pid, started))。编排器中的 processAlive 返回 Promise<{ alive: boolean; sameProcess: boolean; startedAt: string | null }>，在 JavaScript 中任何返回对象均为真值，因此即使进程已死也会误判为存活并强行发送 SIGKILL。此外，51-52 行在 finally 清理块中执行 if (!started) throw new Error(...)，若辅助进程在 ps 枚举与读取启动时间之间已自然退出，started 为 null 会导致抛出未捕获异常，阻断后续临时目录的清理流程并使调用崩溃。

**建议**：检查存活状态时应显式读取属性（如 (await processAlive(pid, started)).sameProcess）；清理阶段若读取不到启动时间说明进程已自然退出，应记录并跳过而非直接抛异常中断清理。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/parse.ts:197-205` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：编排器透传给审查件 front-matter 的字段与 parse.ts 中的 ECHOED_ORCHESTRATOR_KEYS 白名单未对齐，存在契约断裂与退化解析风险。

**依据**：在本次变更中，src/trivium/render.ts:190 新增了透传字段 ...(input.result.native_model ? { native_model: input.result.native_model } : {})。但在 src/trivium/parse.ts:197-205 中定义的 ECHOED_ORCHESTRATOR_KEYS 常量数组中未同步补充 'native_model'。在契约测试 test/unit/parse-degrade.test.ts:253 中有严格的 P9' 守卫断言两者必须一致；若不补充，审查员回传携带该元数据的件会被解析器视作额外属性而触发校验失败退化为降级解析。

**建议**：在 src/trivium/parse.ts 的 ECHOED_ORCHESTRATOR_KEYS 数组中同步增加 'native_model'，与 render.ts 保持一致。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/qoder-cn.ts:30` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | medium |

**问题**：探针硬编码 source: 'catalog-default'，未落地计划中对原生配置来源有效默认模型的 'config' 来源归属判定。

**依据**：根据计划文档 .reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md §3 及 src/trivium/types.ts:1012，source 定义为 'catalog-default' | 'config'，允许官方原生配置指定官方目录中的模型并标注来源为 config。但在 src/trivium/probes/qoder-cn.ts:30 中，代码直接硬编码 source: 'catalog-default'，未对配置模型做有效性验证并标记为 config，与规划的证据来源分类脱节。

**建议**：在探针中增加对 configuration?.model 是否属于有效官方目录模型的校验，若有效则记录 source: 'config'。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/preflight.ts:748` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：preflight 目录模型检查直接调用 realAdapters()，导致尚未正式准入的候选审核者无法命中适配器已接线的 catalogModelsFor 方法。

**依据**：在 src/trivium/adapters/qoder-cn.ts:133-136 实现了 catalogModelsFor，并在 src/trivium/adapters/index.ts:25 完成了适配器接线。但在 src/trivium/preflight.ts:748 的 checkModelAgainstCatalog 中调用为 realAdapters()[critic]?.catalogModelsFor?.(cfg, vendorProfile)。由于 realAdapters 仅返回 criticEnabled: true 的正式审核者（在 registry.ts 中 qoder-cn 为 false），导致处于候选阶段的真实适配器方法无法被 preflight 调用，静默回落到通用的 probe.models 逻辑。

**建议**：改用可索引候选已接线适配器的映射（如 wiredAdapter(critic)），使已接入的目录提取逻辑在 preflight 中能够正常生效。

## 认为正确的部分

- 严格遵循了请求快照与运行结果分离原则，requested_routes 与交接证据在 worker 侧实现了确定性冻结比对，禁止运行期重新选默认
- 对 Auto 路由标签的底层未知状态明确记为 null/unverified，计费键独立保存在 usage_labels 中，不主观推断别名或伪造回退证据
- 真实适配器架构清晰地拆分了模型路由规则（qoder-cn-model.ts）与原生目录隔离运行（qoder-cn-native.ts），单测与集成测试用例骨架完备

## 未覆盖范围（本侧盲区）

- Windows 平台下 Qoder CLI 进程启动与临时配置隔离路径处理（本轮审查在 macOS 环境执行）
- 真实线上网络配额下的 Qoder CN 模型调用与计费证据（审查过程严格遵循只读约束，不发起在线写请求或消耗真实 Token）

## 实际查阅的项目文件

- `AGENTS.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/05_testing/evidence/qoder-cn-model-20261028/directory-2026-10-27T23-15-59-345Z-c54e0b.json`
- `doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-27-51-812Z-b0b109.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`
- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md`
- `scripts/acceptance/kimi-qoder-cn/qoder-model.mjs`
- `skills/dual-critic/schema/run.v3.json`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/parse.ts`
- `src/trivium/preflight.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/render.ts`
- `src/trivium/report.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `test/unit/parse-degrade.test.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":65,"grep":25,"glob":0,"run_command":0,"project_reads":42}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
