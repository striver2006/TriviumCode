---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.4.9
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261028T090050Z
rerun_index: 3
snapshot_hash: sha256:2305a6fa60c077dd3ade2747ea934e5ec8e072f8737e3d0f632ff5f7327133af
blind: true
started_at: 2026-10-28T09:00:58.435Z
finished_at: 2026-10-28T09:13:08.369Z
duration_s: 730
tool_calls:
  read: 45
  grep: 8
  glob: 1
  run_command: 0
  project_reads: 29
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
session_id: 13d98161-be27-4f0d-ac83-79d057ca7119
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261028T090050Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划整体逻辑严谨，但在隔离验收脚本契约、持久开启 critic 的全仓守卫、多工具测试短路熔断机制三处存在显著缺口。
最危险问题（AGY-01）：现有台账生成脚本硬编码写回本仓 .trivium/admission.local.json，未提供隔离验收项目路径参数，执行将破坏隔离边界并污染本仓台账。
架构对账风险（AGY-02）：计划提出通过后“持久开启 critic 能力”，但在修改范围中遗漏了 src/trivium/agents/registry.ts 与关联契约守卫 src/trivium/cli.ts。
执行耗时失控风险（AGY-03）：首阶段若任一必需项（Write/Edit/Bash）失败准入已注定无法通过，计划未设必需项短路规则，盲目展开多工具测试将导致调用与耗时失控。
提示词与重试收敛（AGY-04）：候选臂缺少工具暴露时模型易退化为自然语言拒绝，需明确引导规范与单次未调用不盲目重试。
结论判为 pass-after-changes，按上述 4 条意见修订计划后即可执行实施，无需再次送审。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 4 条：重要 3 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2 & §6` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划明确隔离项目覆盖与本仓覆盖严格区分（隔离项目通过不授权本仓生产），但现有 qoder-admission.mjs 脚本硬编码以本仓作为 project_root 并写入本仓 .trivium/admission.local.json，缺少目标项目路径参数支持，若执行 --write 会污染本仓台账并破坏隔离边界。

**依据**：查阅 scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs：第 138-142 行 repo 硬编码指向 TriviumCode 仓库根目录，第 167-171 行在构建 req 时硬编码 project_root: repo，并在第 187-190 行硬编码写入 ${repo}/.trivium/admission.local.json；同时 src/trivium/admission.ts 的 verifyAdmissionRecord 第 78-79 行对台账中冻结的 project_root 与 deny_paths 做严格前缀与存在性比对。plan §2 与 §6 强调隔离验收项目覆盖与本仓覆盖严格解耦，但现有脚本缺少目标项目根路径参数支持，无法直接在隔离项目生成台账。

**建议**：在计划 §5 与 §6 中明确为 qoder-admission.mjs 增加外部目标项目根路径参数（如 --project-root <dir>），使台账生成器能针对指定的隔离验收项目计算 deny_paths 并写入该测试项目的 .trivium/admission.local.json，禁止直接写回本仓工作树。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5 & §6` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §6 提出隔离验收全部必需项通过后“持久开启对应 critic 能力”，但计划 §5 的文件修改清单中遗漏了 src/trivium/agents/registry.ts 以及受契约测试守卫的 src/trivium/cli.ts，缺少保持全仓对账测试绿灯的配套规划。

**依据**：查阅 src/trivium/agents/registry.ts：qoder-cn 当前 criticEnabled 为 false，开启该能力需修改注册表；查阅 test/integration/usage-registry-parity.test.ts，该集成契约测试强制要求 src/trivium/cli.ts 的 USAGE 帮助文本中 --critics 选项枚举与注册表完全一致。而在 plan §5 中，修改文件责任清单仅列出 adapters/qoder-cn*.ts、probes/、admission.ts 等，明确未包含 registry.ts 与 cli.ts。

**建议**：在计划 §5 补齐启用 critic 所需修改的模块范围（明确若持久开启 critic 需变更 src/trivium/agents/registry.ts 的 criticEnabled，并按契约同步更新 src/trivium/cli.ts 的 USAGE 文本以保持 parity 测试绿灯），或者明确首阶段准入产物仅在隔离项目生成台账做本地三审闭环验证、本仓注册表能力的持久开启下移至后续正式接入交付步骤。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：首阶段若任一必需项（Write/Edit/Bash）未取得合格拒绝，准入已确定不可通过，但计划仅以“至少一项取得拒绝”作为向 Agent/Task、MCP、网络及 20+ 剩余工具全面展开的条件，缺少必需项短路熔断机制，且扩展阶段无全局总调用与耗时硬天花板。

**依据**：查阅 plan §3：首阶段最多 12 次调用/36 分钟，但规定“首阶段至少一项取得可观察执行层拒绝后，再覆盖 Agent/Task、MCP、网络及其它执行入口……每实际入口同样最多两臂各 2 次/180 秒”。查阅 src/trivium/agents/registry.ts 中 qoder-cn 的 admissionChecks，write-denied、edit-denied、shell-denied 全部为独立必需项（缺一不可）。若首阶段中 Write 或 Edit 失败（例如仅 Bash 拒绝），准入已在逻辑上无法通过，此时继续对其它 20 多个工具展开测试将带来数十次无谓模型调用与数小时耗时。

**建议**：在计划 §3 中补充两项熔断收敛规则：1) 针对必需项（mandatory checks）增加短路熔断：首阶段 Write/Edit/Bash 中若有任一必需项确定无法取得合格拒绝事件，即刻终止后续多工具测试，直接进入阻塞分析；2) 为全流程自动化测试设置总调用上限（例如总调用次数不超过 24 次，总时间上限不超过 60 分钟），防止调用规模与时长失控。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：候选臂采用生产 review_invocation_args 运行，工具面未包含 Write/Edit/Bash；若提示词未强行约束模型调用工具，模型极易退化为自然语言回复而非发起工具调用，导致误判为未调用并触发无效重试。

**依据**：查阅 src/trivium/probes/qoder-cn.ts：QODER_REVIEW_ARGS 传入的 tools 为 Glob,Grep,Read，Write/Edit/Bash 被从工具列表中剥离；查阅 src/trivium/adapters/qoder-cn-admission.ts：执行层拒绝要求检测到明确针对该工具的拒绝事件或匹配结果（ac.length === 1）。若无明确 prompt 引导，现代 LLM 在工具不可见时通常直接输出自然语言解释（如“我无法使用 Write 工具”），不会产生 tool_call 节点。

**建议**：在计划 §3 中细化测试提示词的设计规范，明确提示词必须包含强制调用指定动作的结构化指令；同时明确区分“模型自然语言说明缺少工具”与“真实工具调度拒绝”，一旦首轮判定模型未输出 tool_call，第 2 次不得盲目重试，应立即记录为 tool-unavailable/unexposed 并推进到下一项。

## 认为正确的部分

- 坚持真实性原则：明确生产 loadQoderCustom 精确匹配唯一条目，固定 CLI 副本 SHA256 与真实 probe 事实，不更换默认、不猜测底层 provider，官方模型与 Custom 路线严格解耦。
- 坚持隔离边界原则：明确隔离验收项目覆盖与本仓覆盖解耦，真实用户凭据不作正控制读取目标，生产凭据租约与临时 HOME 动态保护。
- 坚持证据完整性原则：首阶段 Write/Edit/Bash 两臂严格配对（正控制取得真实 ID 与回读，候选臂取得真实 ID 失败与原生拒绝事件），不以未暴露或静默不变充抵。
- 声明式与运行时分离：明确指出 admission.v1 必需项从 registry 派生，请求快照冻结不可篡改，未实测的 Windows 环境与官方模型不盲目外推。
- 闭环验证清晰：在未取得完整真实准入台账前保持三大生产开关为 false，严格要求 Qoder 真实三审在隔离项目中闭环验证通过。

## 未覆盖范围（本侧盲区）

- Windows 原生平台下的执行拒绝事件、路径规范化（UNC / 短路径 / 大小写）及凭据保护行为未测。
- QoderCN 官方预置模型路线及其他 Custom 模型的适配与实际准入表现未覆盖（按计划仅测唯一配置的 bailian/qwen3.8-flash-tp）。
- 本机无写操作与子进程启动权限，无法直接在终端观测 Qoder CLI 真实运行时事件流及 JSON-RPC 通信细节。

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r5-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-gemini.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-gemini.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/_meta/brief-gemini-20261028T090050Z.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/01_requirements/需求说明书.md`
- `doc/02_design/README.md`
- `doc/02_design/系统设计说明书.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-lifecycle.mjs`
- `skills/dual-critic/schema/admission.v1.json`
- `src/trivium/admission.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/critics.ts`
- `src/trivium/types.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/freeze.ts`
- `src/trivium/cli.ts`
- `test/unit/registry-parity.test.ts`
- `test/integration/usage-registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":45,"grep":8,"glob":1,"run_command":0,"project_reads":29}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
