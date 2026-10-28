---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
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
run_id: 20261028T050945Z
rerun_index: 2
snapshot_hash: sha256:546cdf29a24cfd152b6ebaf1b918c9e548009601a1c593319bede17fcbbeed3d
blind: true
started_at: 2026-10-28T05:09:54.599Z
finished_at: 2026-10-28T05:20:52.554Z
duration_s: 658
tool_calls:
  read: 45
  grep: 21
  glob: 2
  run_command: 0
  project_reads: 31
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
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
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
override_reason: 左侧模型信息缺失
session_id: 00c4b7aa-c977-4e95-be33-6215b9b8ff22
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261028T050945Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险问题：plan §1 将 qoderChildEnv 改为仅返回白名单而剔除旧补丁的父键 undefined 标记，配合 exec.ts 缺省为 merge 的语义，一旦适配器内部派生调用遗漏传入 envMode: 'replace'，将发生父进程环境变量（云平台凭据、Token 等）全量静默泄露；同时 §5 在任务取消导致进程树挂起时，withQoderHome 的 finally 清理无法执行，解密私有凭据在临时目录存在残留泄露风险。
此外，§2 的 Custom 模型选择语法未与 preflight 的 checkModelSlugs 目录核验契约闭环，会导致合法 Custom 请求在预检阶段被直接误拒；§5 的 admission.v1 schema 需按架构纪律 12 落实纯形状校验与两段式身份核验。
本计划严格遵循只读准入与真实验证原则，将底层模型未知与路线回读证据区分，坚持在未取得真实只读拒绝时阻塞生产开关，方向正确。按上述意见修订环境回落防御、预检目录接入与凭据取消擦除后，即可进入实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 4 条：重要 3 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：qoderChildEnv 拟移除父键 undefined 标记且 exec.ts 缺省为 merge，导致防御性回落缺失，存在环境变量静默全量泄露风险

**依据**：查阅 .reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-codex.md §1 规划「qoderChildEnv只返回允许系统、locale、证书路径...私有HOME/config/tmp变量。未知父变量以及构造后新增变量均不继承」，这意味着 qoderChildEnv 拟移除旧补丁中对父进程环境变量显式赋值 undefined 的防御性键；而查阅 src/trivium/util/exec.ts，run 的 RunOptions 新增 envMode 缺省仍为 merge。若 Qoder 适配器内部任何派生调用（如 --version、探针 probe、或者辅助采集工具）遗漏显式传入 envMode: 'replace'，调用将直接走 merge(process.env, env)。由于 env 中已无 undefined 标记，父进程中包含的云平台凭据、Token 及外部注入变量将静默全量继承到子进程中。查阅 src/trivium/adapters/qoder-cn.ts 与 src/trivium/adapters/qoder-cn-native.ts 可见存在多处子进程执行点，单点漏传即可导致非安全回退。

**建议**：坚持纵深防御原则：qoderChildEnv 在白名单输出目标键的同时，必须继续保留父进程既有键的 undefined 删除标记（作为 merge 模式下的兜底屏蔽）；exec.ts 的 envMode: 'replace' 则用于彻底封死构造 env 之后新增父键的漏洞。同时在 qoder-cn.ts 的底层派生入口处统一收敛包装器，禁止裸调 run 并强制 replace 语义。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：Custom 模型选择语法与通用预检 checkModelSlugs 目录校验契约未闭环

**依据**：查阅 .reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-codex.md §2 提出了 custom:<provider>/<modelID> 与裸 provider/modelID 的声明选择语法，但查阅 src/trivium/preflight.ts（checkModelSlugs）可知，预检通过调用适配器的 adapter.catalogModelsFor(cfg) 并要求请求的 model 必须存在于返回的 models 列表中；查阅 src/trivium/adapters/qoder-cn.ts 与 src/trivium/adapters/qoder-cn-model.ts，当前 catalogModelsFor 仅静态/动态返回官方目录（如 Auto、Qwen2.5 等），既不包含 custom: 前缀规范，也没有将 native_routes 中的已绑定 Custom 路由动态注入到 catalogModelsFor 结果集中。计划虽提及「adapter目录钩子返回规范选择」，但未定义 catalog 识别 custom: 模式以及 normalizeModelForCatalog 对应关系的契约，这将导致在 preflight 阶段任何合法的 Custom 请求模型直接被 checkModelSlugs 判为非法模型并阻断运行。

**建议**：明确补充预检契约：在 qoder-cn.ts 的 catalogModelsFor 中结合 config.critics/driver 及 native_routes，规范化输出支持的 Custom 模型标识（或在 normalizeModelForCatalog 中支持 custom: 命名空间解包与存在性核验），使 preflight.ts:checkModelSlugs 能够正确完成前置校验。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：取消或强杀导致 treeShutdown 挂起时，withQoderHome 的 finally 块被跳过，解密临时凭据根存在永久残留泄露风险

**依据**：查阅 .reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-codex.md §5 规划复用 AbortSignal、TERM 宽限 KILL 与凭据清理，但查阅 src/trivium/util/exec.ts 中 shutdownTrackedTrees 的实现：当收到取消信号或异常终止时，exec 模块会将 treeShutdown = true 并遍历杀死进程树，导致所有挂起的 run() Promise 永远挂死不再 resolve/reject；查阅 src/trivium/adapters/qoder-cn-native.ts 中的 withQoderHome，其临时凭据根 /tmp/trivium-cn-route* 仅在 try...finally 块内执行 rmSync。当挂起发生时，Node 进程在收到信号直接退出，finally 块永远得不到执行。此外，查阅 src/trivium/scrub.ts（scrubRunDir）只负责运行留痕目录清理，不跟踪也不清理操作系统临时根中的 /tmp/trivium-cn-route*，导致解密落盘的原生私有凭据在取消后永久残留于磁盘。

**建议**：建立全局活动临时凭据目录跟踪台账（如在 qoder-cn-native.ts 中维护 Set 并在 process.on('exit'/'SIGINT'/'SIGTERM') 及 review.ts 的 abort 钩子中注册物理路径清理函数），确保无论主进程正常退出、异常抛出还是通过 AbortSignal 取消，所有创建的临时根均被可靠擦除。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2 & §5` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：新增 admission.v1 schema 需遵循架构纪律 12 的两段式校验与全目录对账扫描约束

**依据**：查阅 .reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-codex.md §2 与 §5，规划引入 admission.v1 schema 对本机准入台账 .trivium/admission.local.json 进行结构校验。查阅项目根目录 AGENTS.md 架构纪律 12 以及 test/unit/registry-parity.test.ts，skills/dual-critic/schema/ 目录下的所有 schema 文件均受自动化兜底扫描（除具名历史豁免外），严禁在 schema 中硬编码枚举任何 Agent 角色或意见编号前缀。若在 skills/dual-critic/schema/ 下新增 admission.v1.json，必须保持纯形状校验，身份校验必须在 TS 逻辑中通过注册表（src/trivium/agents/registry.ts）派生进行两段式校验，并在 src/trivium/schemas.ts 与 test/unit/schemas.test.ts 中补齐对账，避免引入破坏性契约红测。

**建议**：在计划中明确 admission.v1.json 仅定义通用结构形状，供应商与角色字段保持纯 string，通过注册表进行二次身份核验，并同步将其注册入 schemas.ts 的 ajv 编译列表与测试对账清单中。

## 认为正确的部分

- 严格区分 Custom 路线回读核验（正对照、缺声明回退、错误凭据 401）与底层 provider/model 生效身份（无法取得独立信封时保持 null/unverified 并告警 unknown 模型族，不将 null 错误提升为阻断），符合主设计与业务目标。
- 在 Write mode 审批与 Grep/Glob 空结果未取得真实规则拒绝时，保持生产审核开关（criticEnabled/driverEnabled）关闭并如实报告未测与阻塞，绝不靠降低准入标准或伪造三审验收。
- 将 NativeModelFacts 的全 settings hash 降级为审计项，改用针对当前路线的确定性语义绑定 binding_version=2，有效避免因用户全局无关配置或格式变动导致误判失效。
- 明确将首个样本 bailian/qwen3.8-flash-tp 作为显式真实测试样本，不强制或静默将其设为默认路由，防止非预期污染生产默认配置。

## 未覆盖范围（本侧盲区）

- Windows 原生环境下的路径别名、符号链接与 ACL 权限隔离执行（计划指明当前未测）
- 真实二进制 codec 加密逆向的二进制兼容性以及多 Custom 模型并存时的内部解密冲突
- Qoder 厂商 CLI 未来更新版本对未公开命令行参数与环境变量行为变更的向前兼容性

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-gemini.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-revised-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-codex.md`
- `AGENTS.md`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/types.ts`
- `src/trivium/secrets.ts`
- `src/trivium/model-family.ts`
- `src/trivium/critics.ts`
- `src/trivium/guard.ts`
- `src/trivium/scrub.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `test/unit/registry-parity.test.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `skills/dual-critic/schema/run.v3.json`
- `skills/dual-critic/schema/config.v2.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":45,"grep":21,"glob":2,"run_command":0,"project_reads":31}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
