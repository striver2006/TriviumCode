---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.167.0
model_requested: gpt-6.1-sol
model_effective: gpt-6.1-sol
model_effective_source: trace
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
model_route: config_copy
run_id: 20261107T001957Z
rerun_index: 1
snapshot_hash: sha256:47a7538dbfd4cfea11fe07d297b6f1a67b3346c286863a11f88f18cea9f64b41
blind: true
started_at: 2026-11-07T00:20:07.138Z
finished_at: 2026-11-07T00:33:07.068Z
duration_s: 207
tool_calls:
  run_command: 23
  project_reads: 41
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 5
  minor: 0
  nit: 0
findings_degraded:
  - CODEX-06
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: different-family
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: caa5d8cf3f6c8be8cacfff1499d364ea45091297507b936c7ce6b3c074005148
  provider_declared: openai
  provider_declared_source: config
  provider_effective: openai
  provider_effective_source: trace
family_comparisons:
  - left: glm
    right: codex
    status: different-family
    left_model: glm-5.3
    right_model: gpt-6.1-sol
    left_source: declared
    right_source: trace
    reason: 模型族不同：glm / gpt
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 模型族不同：glm / gpt
session_id: 01a1b360-7c7c-7711-95ea-fc4113927976
---

# 计划审查：VSCode插件Phase3

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261107T001957Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **逐条降级**：本侧有 1 条意见不合 schema，单列在「不合格意见」一节，保留原编号、须逐条裁决，但不参与阻断与共同阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

不通过。保存护栏依赖的 VS Code 等待机制无法覆盖正常的人工确认时长，需要重新设计并复审；裁决台还存在首次缺件无法正确建表、理由校验不符、Driver 来源陈旧及落盘后无法通过 UI 修正等问题。已核对计划原件哈希、需求、核心契约、插件基座及官方 API 文档。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：重要 5）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md:125-133（D4）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：方案把 waitUntil 当成可以等待用户关闭弹窗的无限挂起机制，但保存监听器共享的时间预算只有 1.5 秒。用户正常阅读警示就可能超过预算，保存会在决定前继续；监听器反复超时还可能被停用。因此“取消后磁盘不变”不能作为该机制的保证，这不是仅限超大文档的残余风险。

**依据**：实际读取 extension/node_modules/@types/vscode/index.d.ts:14533-14546，声明了共享 1.5 秒预算及监听器三次失常后被忽略；13520-13523 还说明并发修改时 edits 会被忽略。[VS Code 官方 API 文档](https://code.visualstudio.com/api/references/vscode-api#workspace.onWillSaveTextDocument)给出相同约束。本项为 API 契约推理，未执行真实保存实验。

**建议**：重新确定保存护栏的可实现机制和承诺边界，不把人工弹窗等待置于该时间预算内。修改后的方案应重新评审，并增加真实宿主中延迟数秒再选择取消、连续超时及并发编辑的验证。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md:90-94（D1 缺口分类与已裁决推导）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：首次进入裁决台时通常还没有裁决件。此时 gate 提前返回 missing_disposition，不会同时给 missing_findings。按计划的差集公式，structured_ids 和 degraded_ids 会全部被标为“已裁决、只读”，表单没有待裁条目。另外 fallback_ids 表示裁决表中已经出现的回退编号，并非完整期望集；首次缺件时它固定为空，无法用它发现待裁回退意见。

**依据**：src/trivium/gate.ts:346-374 在找不到裁决件时立即返回，failures 只有 missing_disposition，rows 为空、fallbackIds 为空，但 structuredIds/degradedIds 可以非空；593-609 明确 fallbackIds 来自已解析的 fallbackRows，期望回退集另从 expectedFallbackIds 获取；1377-1402 显示回退期望编号来自对应的 .fallback-items.md。上述均为源码核对。

**建议**：单独定义 missing_disposition 的首次建表规则，区分待裁期望集、已存在裁决行及错误行；补齐首次缺件时回退编号的数据来源。测试应包含真实的 missing_disposition 输出，而不能只用已有 missing_findings 的应答作为入口夹具。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md:94（D1 表单校验）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划明确允许“接受项理由可空”，但核心对三种裁决都要求非空理由。用户按表单合法操作生成的接受行会被 gate 判为 empty_reason，无法完成审批闭环。

**依据**：src/trivium/gate.ts:639-647 对结构化行和 fallback 行统一执行理由检查，没有按裁决值豁免；649-653 的失败消息明确说明“三种裁决都必须有非空理由”。672-677 的空洞理由策略也适用于所有裁决值。

**建议**：将三种裁决的理由要求与核心契约对齐，明确空洞理由策略的处理方式；增加接受项空理由的负例，并让生成件经过真实核心 gate 校验，避免仅以插件复刻的判据验收。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md:154-156（D6）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：Driver 定位链把 GateEntry.driver 排在本轮 run 元数据之前，会在同主题同阶段换 Driver 后采信上一轮身份。它存在时不会触发 fallback，插件将生成错误的 role 和文件名后缀，甚至写入当前审核者身份的裁决件。

**依据**：src/trivium/state.ts:62-70 明确说明 GateEntry.driver 会沿用上一轮值，不能作为当轮身份来源；233-243 的 upsert 实现保留 prev.driver。test/unit/hooks.test.ts:718-740 已有“陈旧闸门项不影响当轮判定”的回归用例。src/trivium/cli.ts:1424 则按运行元数据确定 gateDriver。

**建议**：以目标 run_id 对应的运行元数据确定当轮 Driver；其他来源只能在能够证明与该轮一致时使用。增加上一轮与本轮 Driver 不同且闸门 driver 陈旧的测试。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md:96（D1 addresses 推导）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划通过 review JSON 存在性、rerun_index 和目录 glob 反推审查文档名，但这不是 run 与 Markdown 工件的权威映射。各侧可以跨本地日期落盘，极端撞名还会使某一侧实际文件轮次高于 run.rerun_index。错误候选可能本身存在，因而不会进入“推不出才人工确认”的分支，最终生成被 gate 拒绝的 addresses。

**依据**：src/trivium/gate.ts:1211-1238 明确要求从 runMeta.artifacts 读取实际文件名，并说明跨零点和撞名抬升的原因；src/trivium/review.ts:1920-1927 明确允许单侧 effectiveRerunIndex 与 sharedIndex 不同；skills/dual-critic/schema/disposition.v1.json 的 addresses 描述也指定由 run.json.artifacts 派生期望集。

**建议**：直接消费目标 run 元数据中已登记的实际工件路径，并按有效侧筛选；不要重新拼接日期和轮次。补充跨午夜、单侧撞名抬升及 parse_fallback 侧的测试。

## 不合格意见（逐条降级，共 1 条）

> 下列意见不合 `trivium.review.v2`：保留原编号、**仍须逐条裁决**（接受要写落点），
> 但**不参与阻断与共同阻断判定**——其中声称 blocker 的，被驳回也不会触发共同阻断告警。

### CODEX-06 · 不合格

**不合格之处**：
- `kind`：取值不合法（/kind must be equal to one of the allowed values {"allowedValues":["correctness","security","concurrency","contract","test-gap","maintainability","scope-drift","performance"]}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | major |
| 位置 | .reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md:100、178-183（D1 落盘与 D9 验收） |
| 类别 | requirement（不合法） ｜ 层次 plan |
| 置信度 | high |

**问题**：计划承诺校验不通过即可回裁决台修改，但唯一保存路径是 wx 新建；同一轮已有文件后只能报 EEXIST，要求用户手工编辑或删除。已有部分裁决件补行、首次草稿校验失败及插件重开后的修正均无法在 UI 内完成，与“无手工编辑任何工件”的验收要求冲突。修正还必须保留已有合法裁决，不能只把缺口行另存为完整裁决件。

**依据**：被审计划:100 明确将 EEXIST 的恢复交给手工编辑或删除；doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md §6.3 要求入口 B 从审查结束到批准无需手工编辑工件。src/trivium/gate.ts:346-385 按本轮定位并读取完整裁决件，614-629 按整张表检查缺裁和多余编号，单独保存补丁行不能替代完整件。

**建议**：明确已有裁决件和首次落盘失败后的 UI 修正、预览确认及并发冲突处理规则，兼顾防覆盖与合法行保留。增加“生成后 gate 失败→UI 修正→再次校验通过”和“已有部分裁决件→补齐”的完整测试。

## 认为正确的部分

- 批准、拒绝和放弃由用户显式点击，经宿主直接调用 CLI；放弃显式传 stage，可避免批量影响其他阶段。
- 区分相对 HEAD 的提示摘要与审查收尾以来的权威摘要，并明确展示口径差异，是正确的数据语义。
- 预设存插件侧双作用域、不写编排器 YAML，且加载后重新要求前置链，符合既定边界。
- 复用 StateWatch、AnnotationHub 和现有 shell:false CLI 封装，有助于控制新增维护成本与测试配额。

## 未覆盖范围（本侧盲区）

- 本轮仅执行只读检查；未运行会生成构建产物或夹具的测试，未启动真实 VS Code 保存实验，未消耗模型调用配额。
- 未验证四家真实 Driver 的完整审批链、Windows、远程工作区及多窗口运行行为。
- 尚无 Phase 3 实现代码，因此未审查最终 Webview 消息校验、并发写入实现及预设迁移的实际行为。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/05_testing/evidence/m9-acceptance-20260919/hook-and-gate-outputs.md`
- `skills/dual-critic/schema/disposition.v1.json`
- `src/trivium/cli.ts`
- `src/trivium/gate.ts`
- `src/trivium/disposition.ts`
- `src/trivium/state.ts`
- `src/trivium/naming.ts`
- `src/trivium/archive.ts`
- `src/trivium/review.ts`
- `src/trivium/meta.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/topic.ts`
- `src/trivium/worktree-summary.ts`
- `test/unit/hooks.test.ts`
- `extension/package.json`
- `extension/README.md`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/cli/commands.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/history/runHistory.ts`
- `extension/src/ui/cockpit.ts`
- `extension/scripts/runIntegration.mjs`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/integration/cockpitFindings.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":23,"project_reads":41}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
