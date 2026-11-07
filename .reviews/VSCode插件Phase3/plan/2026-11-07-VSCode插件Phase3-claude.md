---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: plan
role: claude
vendor: anthropic
agent_cli: claude/2.1.318
model_requested: k3.1-pro
model_effective: k3.1-pro
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261107T001957Z
rerun_index: 1
snapshot_hash: sha256:47a7538dbfd4cfea11fe07d297b6f1a67b3346c286863a11f88f18cea9f64b41
blind: true
started_at: 2026-11-07T00:20:07.138Z
finished_at: 2026-11-07T00:33:07.068Z
duration_s: 780
tool_calls:
  read: 37
  grep: 7
  glob: 4
  run_command: 0
  project_reads: 33
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 10
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: different-family
access:
  requested_mode: profile
  profile: kimi
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 302204616262eadfddb0f255aac8b9d2768d9db4ddf5a3bd5c5d84925f2c82b8
  provider_declared: kimi
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: glm
    right: claude
    status: different-family
    left_model: glm-5.3
    right_model: k3.1-pro
    left_source: declared
    right_source: envelope
    reason: 模型族不同：glm / kimi
  - left: claude
    right: gemini
    status: different-family
    left_model: k3.1-pro
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：kimi / gemini
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
override_reason: 模型族不同：glm / kimi
session_id: e6d0d8b7-8d6c-44b4-bfa1-0bef8776771d
---

# 计划审查：VSCode插件Phase3

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261107T001957Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。

## 总判断

最危险的是 FR-10：计划未安排扩展激活，且现有 state.json 解析失败会变空闸门，保存护栏可能不启动或误判绿灯。
FR-8/FR-9 也有多处契约偏差：Driver 定位采信可陈旧字段、接受理由误设为可空、首写 fallback 编号无来源、修复回路退回手工编辑。
另有 joint_blocker_rejected 漏分组、审批 warnings 未展示、.vscode 放行会制造漂移等问题。
整体 CLI+文件面架构与大部分契约核实扎实；上述问题均有明确局部修法，修正后可实施，无需推翻方案。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 12 条：重要 10 ｜ 次要 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D4、§三 D10；extension/package.json:16-20` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：FR-10 被设计为服务级保存护栏和常驻状态灯，但计划只写 package.json 增配置与命令，没有安排 activationEvents。当前扩展仅在打开健康视图、历史视图或驾驶舱时激活；用户未先开这些 UI 时，onWillSaveTextDocument 监听根本不会注册，审查期保存可直接通过，状态灯也不存在。

**依据**：阅读 extension/package.json，现有 activationEvents 只有 onView:triviumHealth、onView:triviumHistory、onCommand:trivium.openCockpit；extension/src/extension.ts:14-29 也确认监听与服务要 activate 后才装配。计划 D4 的服务级形态本身不会触发激活。

**建议**：在实施步骤和验收中明确扩展激活策略（例如适用于已初始化工作区的启动激活），并增加「未打开驾驶舱、直接保存业务文件」的集成测试，证明护栏与状态灯已生效。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D4 三色灯；extension/src/monitor/stateModel.ts:39-45` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划让 lampModel 把「无闸门」映射为绿灯并放行，却没有处理 state.json 损坏。现有 parseGates 在 JSON 解析失败时返回空 gates、空 active 且 schemaReason=null；直接复用后，损坏会被当成无闸门，FR-10 在最需要保守处理时静默失效。

**依据**：extension/src/monitor/stateModel.ts:39-45 的 catch 明确返回空快照；src/trivium/state.ts:19-33 则明确 state.json 存在但读不出必须按违例处理，不能当成没有闸门。计划只安排 GateRef 增字段，没有修正这条失败路径。

**建议**：给状态模型增加独立的 unreadable/corrupt 结果，禁止其进入绿灯与放行分支；明确护栏采用阻断或至少非绿色的保守降级，并补损坏 JSON、缺 gates、读取失败的灯色与保存测试。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D4 判定规则、§三 D5 workspace 预设` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D4 无条件放行 .vscode/，但 .vscode 不是编排器写入区，里面的受跟踪文件仍属于审查工作树。D5 又把 workspace preset 写入 .vscode/settings.json；审查或闸门期保存预设即可绕过保存护栏并造成快照漂移，两个设计决策直接冲突。

**依据**：src/trivium/code-stage.ts:106-123 的快照排除集只有 .trivium、.git、归档根及可选运行根，没有 .vscode；src/trivium/worktree-summary.ts:19-22 也仅说明 .gitignore 与改回等盲区。计划 D5 明确 workspace preset 进 .vscode/settings.json 且随仓共享。

**建议**：删除 .vscode/ 的整体豁免，只放行真正的编排器写入区；同时规定活跃闸门期 workspace preset 写入是禁止、延迟还是经用户显式确认，并补该路径的漂移护栏测试。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D6 当轮 Driver id 定位链` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：定位链把 gates[...].driver 列为第一权威来源，但该字段只作留痕，可能沿用上轮 Driver；task.json 的阶段认领也不是逐 run 身份。同槽位重跑并更换 Driver 时，计划会生成错误 role 和错误文件名，恰好触发其想避免的 bad_front_matter。

**依据**：src/trivium/state.ts:56-81 明写 driver 不是当轮身份来源，同槽位重跑换 Driver 时可留上一轮值；src/trivium/cli.ts:1312-1323、1424 则以最新 run.json.driver 作为闸门权威来源。src/trivium/meta.ts:256-277 显示 drivers[stage] 是单值阶段声明而非逐 run 记录。

**建议**：以目标 run 的 _meta/run-<runId>.json.driver 为首选权威源，阶段认领与闸门字段仅作受限 fallback/展示；补充同槽位重跑换 Driver、历史 run 回放两种定位测试。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D1 表单预填（接受项理由可空）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划允许接受项理由为空，与 gate 的硬校验直接冲突。按该 UI 生成的草稿会在下一步 gate --check 返回 empty_reason，形成本可由表单避免的必现返工。

**依据**：src/trivium/gate.ts:639-655 的 checkRow 对所有 structured 行执行 reason.length===0 → emptyReason，失败文案明确「三种裁决都必须有非空理由」；fallback 行也在 645-647 走同一理由检查。

**建议**：把三种裁决的非空理由都设为表单前置条件，并分别为接受、驳回、暂缓补空理由失败用例；空洞词则按 gate.reason_policy 的 hard/warn 语义呈现，避免把配置相关规则写死。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D1 gateGapModel 三组缺口` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：声称对齐 15 个 failure code 的三组分类漏掉 joint_blocker_rejected。该 code 在 hard 策略下会真实产生并带 ids；若不进入 UI 模型，用户面对 gate 退 2 时看不到共同 blocker 被驳回这一阻断原因，也无法在裁决台针对性修正。

**依据**：src/trivium/gate.ts:116-134 列出该枚举，687-696 在 joint_blocker_policy=hard 时构造 failure；计划三组只覆盖其余 14 个（含死枚举 bad_verdict），没有它的落点，D9 也无对应夹具。

**建议**：为 joint_blocker_rejected 指定可操作的展示与修复分组，保留其 ids 与共同来源语义，并增加 hard/warn 两种策略的模型测试。

### CLAUDE-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D1 数据流、§三 D9 dispositionDesk 集成夹具` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：首写 missing_disposition 且存在 parse_fallback 侧时，真实 gate 输出不会给出期望的 F 编号：提前返回的 fallbackIds 是空数组，也没有 missing_findings。计划却完全依赖 gate JSON 逐条生成表单，因此会漏掉全部必裁 fallback 单元；集成测试用 missing_findings.ids 手塞 AGY-F01，并未覆盖真实首写形态。

**依据**：src/trivium/gate.ts:360-382 的 missing_disposition 提前返回中 fallbackIds: []；603-621 显示期望 fallback 来自 expectedFallbackIds（注释指向 .fallback-items.md），而 fallbackIds 是现有裁决表里的行。计划没有读取 .fallback-items.md 的设计。

**建议**：明确首写时 fallback 期望集的只读来源（本批不改主仓 src 的约束下可评估 .fallback-items.md），并用真实 missing_disposition + fallback 侧形状替代仅靠 missing_findings 的桩夹具。

### CLAUDE-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D1 逐条类的已裁决编号推导` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：公式只减 missing_findings.ids，就把其余编号全部称为「已裁决、只读、不进表单」。empty_reason、defer_not_allowed、missing_action 的编号通常已存在于裁决表而非 missing_findings，因此会被公式归为只读；这又与同段要求把这些条预填进表单修复相矛盾，按公式实现会封死修复入口。

**依据**：src/trivium/gate.ts:614-630 区分 missing 与 unknown，633-679 另独立产生 empty_reason、defer_not_allowed、missing_action；这些失败并不从期望集中删除。计划同一段同时给出只读公式和修复表单两种互斥归属。

**建议**：先定义可编辑集合为缺裁与各类可修复失败的并集，再从期望集排除后得到真正只读集合；增加「已有行但理由为空/缺落点」的模型测试，明确该行只进入可编辑修复区。

### CLAUDE-09 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D1 结构类、unknown_findings、落盘 EEXIST；§五 FR-8 验收` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划没有闭环「首写后校验仍失败」的修复路径。bad_front_matter/unparsable_table 要先修既有结构，unknown_findings 要删既有行，而 EEXIST 又要求用户直接编辑或删除既有裁决件；这些路径都回到手工编辑工件，与计划及 v2 §6.3 的「无手工编辑任何工件文件」验收不相容。

**依据**：src/trivium/gate.ts:384-386 是对 dispositionPath 指向的既有文件继续解析；计划 D1 明确 EEXIST 不覆盖、让用户编辑或删除，unknown_findings 明示从既有裁决件删行。doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md:223-227 的验收要求全程无手工编辑。

**建议**：在计划中明确首写与修复两阶段的安全更新机制及确认语义，覆盖结构错误、缺理由、缺落点、unknown_findings；若决定只承诺首写通畅，则必须相应收窄验收并如实列出需要手工修复的例外。

### CLAUDE-10 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D2 计票、§三 D9 gateAreaModel` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：闸门区只消费 failures、round_verdict 和 round_line，没有 warnings 的展示模型。 ok:true 也可能伴随降级轮、未确证只读失守、共同 blocker 争议、addresses 未核等关键警示；审批人只看计票会误以为信息完整，削弱人工审批的实际意义。

**依据**：src/trivium/cli.ts:1674-1685 的输出同时含 warnings；src/trivium/gate.ts:521-542 给出 readonly_breach_unconfirmed 与 degraded_round，144-161 还列有 weak_reason、joint_blocker_rejected、addresses_unchecked 等。计划 gateAreaModel 与测试均未安排这些字段。

**建议**：把 warnings 作为闸门卡和裁决台的一等展示数据，区分警告与失败且不静默丢弃；至少补降级轮、未确证失守、共同驳回 warn 的审批展示用例。

### CLAUDE-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D1 落点 textarea 必填规则` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划对所有接受项一律要求落点，并称其对齐 missing_action；实际 fallback 行只要求裁决与理由，不要求落点。统一必填会把比闸门更严的规则误当既有契约，迫使 fallback 接受项填写无意义内容。

**依据**：src/trivium/gate.ts:639-647 中 structuredRows 调 checkRow(r,true)，fallbackRows 调 checkRow(r,false)，663-670 的 missing_action 因此只覆盖结构化行。

**建议**：在 UI 模型中保留是否要求 action 的行级属性：结构化接受项必填，fallback 接受项按契约可选；补两类接受项的对拍用例。

### CLAUDE-12 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §三 D2 计票、§三 D9 gateAreaModel` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计票模型默认 aa 态必有 round_verdict，没有定义 null 形态。bug 阶段、旧运行、无轮次链或运行未成形时该字段可为 null；若直接渲染，入口 D 的审批卡会出现空白或被迫伪造计票。

**依据**：src/trivium/cli.ts:1279-1291 的 roundFactsOfMeta 注释明确「没有计票（旧运行、bug 阶段、没跑成）时 next_action 与 round_line 为 null」，实现也在无 loop 时返回 round_verdict:null。计划测试只列 aa+round_verdict 的正常件。

**建议**：为无计票信息定义如实降级文案与卡片模型，不根据其它字段自行补算；增加 bug 阶段和无轮次链旧 run 的测试。

## 认为正确的部分

- D3 选择只读 git status 作为点击前提示、批准后采用 approve 的权威 worktree_summary，并明确两套基线口径，避免重入 gate --await-approval 的状态迁移，方向正确。
- approve/reject/abandon 的 argv 设计总体忠实：approve/abandon 显式传 --stage、拒绝必填理由、放弃二次确认、执行期防双击，均与 cli.ts/approval.ts 相符。
- disposition front-matter 七字段、kind 映射、表头同义词、命名与 O_EXCL 等事实基线大多与 schema、naming.ts、disposition.ts 和真实裁决件一致。
- D5 坚持不写 .trivium YAML，preset 只回填表单并沿用冻结后须重跑前置链的语义，保持了既有配置与点火边界。
- 纯函数模型与宿主 IO 分层、复用 StateWatch/AnnotationHub、真实工件夹具与桩 CLI 的测试路线合理，便于在不复制核心业务逻辑的前提下实施。

## 未覆盖范围（本侧盲区）

- 未执行任何命令或测试；结论均为静态阅读与推理，未验证真实 CLI 端到端行为。
- VS Code onWillSaveTextDocument 的等待超时、自动保存重入、undo 栈、巨型文档与多编辑器行为，以及 modal 在 @vscode/test-electron 中的可操作性，未做实机验证。
- 未逐件阅读现有全部集成测试与 fixtureLib 实现，新增四家 Driver/真实运行夹具的具体改造量未评估。
- 未深入审查 workspace preset 将任务正文和 extraFlags 随仓共享的敏感性提示、多人并发编辑 settings.json 的冲突处理。
- git status 的可选锁/索引刷新行为及其与权威摘要排除集的展示差异未展开，未形成独立意见。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-glm.md`
- `.reviews/agy适配1.5.2/code/2026-11-07-agy适配1.5.2-response-glm.md`
- `.reviews/agy适配1.5.2/plan/2026-11-06-agy适配1.5.2-revised-glm.md`
- `.reviews/agy适配1.5.2/code/_meta/run-20261106T172504Z.json`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/05_testing/evidence/m9-acceptance-20260919/hook-and-gate-outputs.md`
- `src/trivium/cli.ts`
- `src/trivium/gate.ts`
- `src/trivium/disposition.ts`
- `src/trivium/naming.ts`
- `src/trivium/state.ts`
- `src/trivium/archive.ts`
- `src/trivium/worktree-summary.ts`
- `src/trivium/code-stage.ts`
- `src/trivium/meta.ts`
- `src/trivium/approval.ts`
- `skills/dual-critic/schema/disposition.v1.json`
- `extension/package.json`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/cli/commands.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/history/runHistory.ts`
- `extension/src/reviews/annotationHub.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/services.ts`
- `extension/src/extension.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":37,"grep":7,"glob":4,"run_command":0,"project_reads":33}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
