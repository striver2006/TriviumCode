---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: code
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
run_id: 20261107T021820Z
rerun_index: 2
snapshot_hash: sha256:030fcc19e06b4f4fedb64e8f681f6d4b810c2ebc50c66e2999a5796e7ed174e9
blind: true
started_at: 2026-11-07T02:18:33.413Z
finished_at: 2026-11-07T02:32:52.389Z
duration_s: 859
tool_calls:
  read: 48
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 39
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 8
  minor: 3
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
session_id: 56aa9cbf-c4a9-4d56-a6c0-411fe85af9c3
---

# 代码审查：VSCode插件Phase3

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261107T021820Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。

## 总判断

最严重的是 cockpitHtml 在同一函数块内重复声明 const tdR/ta/tdA/taA，Webview 脚本会直接 SyntaxError，整个驾驶舱无法工作。
裁决台结构修复仍有两条确定断点：缺失 front-matter 时替换为空操作；找不到表头时修复路径与 replace 写回模式不匹配。
保存防护与闸门卡还存在保存代次、请求代次未管理的竞态，分别可能误恢复旧内容、展示旧闸门状态。
零意见首写被错误禁止，runMeta 对合法但异常形状的 JSON 会抛异常，修复行的落点也未做单元格安全化。
上述问题触及本批核心闭环且需要修改后重新评审，故本侧不通过。

**结论**：不通过（`reject`）

## 审查意见（共 12 条：阻断 1 ｜ 重要 8 ｜ 次要 3）

### CLAUDE-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:551` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：renderDesk 的同一函数块内两次声明 const tdR、ta、tdA、taA（第二组从 582 行开始），这是直接的 SyntaxError。Webview 整段脚本无法解析，驾驶舱已有功能与 Phase 3 全部按钮都会一起失效。

**依据**：extension/src/ui/cockpitHtml.ts:551-557 与 582-588 的重复声明可在源码中直接核对；extension/test/integration/dispositionDesk.test.ts:109-128 通过 handleMessageForTest 直调宿主消息，完全不执行这段 Webview JavaScript，因此现有集成链路覆盖不到该故障。

**建议**：删除重复的一组单元格构造，保留唯一的裁决/理由/落点列及复选框引用；增加至少解析并执行 Webview 脚本的冒烟测试，而不是只测宿主消息。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:286` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：bad_front_matter 包含「缺少 front-matter」和「未闭合」两种形态，但 finishRepair 仅用正则替换一对完整 ---。没有完整分隔符时 replace 无匹配、静默返回原文，新 front-matter 根本没有插入，自动 gate 复核会反复回到同一缺口。

**依据**：src/trivium/gate.ts:388-392 在 front-matter 不可解析时产生 bad_front_matter；extension/src/disposition/dispositionDraft.ts:286-289 只做 text.replace；extension/src/ui/cockpit.ts:878-882 又允许这种纯结构修复进入预览，所以会形成可保存但永远修不好的闭环。extension/test/unit/dispositionDraft.test.ts:224-235 只覆盖分隔符完整的坏 YAML。

**建议**：在没有完整首对分隔符时显式在文首插入新的 front-matter 块，未闭合形态也要明确处理；补「完全缺失」与「未闭合」两类保存后真实 gate 对拍。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:915` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：找不到表头时 parsed.surgery=null，代码退回全新 renderDisposition，并按当前日期重新计算文件名，而不是使用 gate 给出的 dispositionPath。跨天修复时 saveDesk 仍以 replace+旧 loadedText 写这个新路径，目标不存在便 IO 失败；同日则会整份覆盖旧件并丢失表外正文。

**依据**：src/trivium/disposition.ts:181-188 说明找不到表头是 unparsable_table 的典型来源；extension/src/disposition/dispositionDraft.ts:167-170 此时 surgery=null。extension/src/ui/cockpit.ts:915-940 走新文件名分支，979 行仍选择 replace，saveDraft 在 extension/src/disposition/dispositionDraft.ts:319-324 读取新目标失败。现有测试没有 surgery=null 的修复链路。

**建议**：为 surgery=null 单列结构重建路径：始终写回 dispositionPath，明确哪些正文可保留、哪些必须重建，并让写回模式与目标路径一致；补跨日、无表头及带表外附注的端到端用例。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:142` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：快照没有保存代次或实际超时处理。读取超过共享 1.5 秒预算时，didSave 可先到而看不到快照，之后迟到的快照又失去按钮时机；用户选择恢复前若再次保存，onDidSave 捕获的旧 snap 会在 await 后覆盖较新的保存，savedAt 记录却从不校验。

**依据**：extension/node_modules/@types/vscode/index.d.ts:14533-14551 给出 1.5 秒总预算与 didSave 事件；extension/src/guard/saveGuard.ts:142-157 只有异步读，没有超时或代次，162-177 在 await 用户选择后直接 restore 捕获值，38 行的 savedAt 仅写入未消费。extension/test/integration/saveGuard.test.ts:93-115 仅覆盖立即读取和单次保存。

**建议**：给每文档维护保存代次，快照读取设置明确超时并协调 didSave；恢复前确认该快照仍是当前代次且之后没有保存，否则丢弃并重新提示。补延迟 readFile、didSave 先到、连续两次保存的故障注入。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:631` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：闸门卡的迟到请求只按 topic/stage/runId 判当前，不含期望 state。raf→awaiting_approval 在同一 runId 下发生时，旧 raf 请求仍被接受并写回缓存，还可能后于新请求 post 整卡，导致 UI 回到旧模式、旧 failures/warnings/计票。

**依据**：extension/src/ui/cockpit.ts:149-169 在状态迁移时启动新一轮 pushGateArea；631-653 的 stillCurrent 只比较 runId，且旧 c.mode 会随 out 一并发布。extension/test/integration/gateApproval.test.ts 使用固定桩输出，没有让迁移前后两次 gate 返回不同内容，未覆盖该交错。

**建议**：每次拉取携带包含 state/runId 的请求代次，返回时同时核对并丢弃旧代次；对 pushGateArea 串行化或做最新请求胜出，补 raf→aa 的乱序响应测试。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:878` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：零意见的首写轮次无法生成裁决件。draft 下 items、removedIds 都为空，structuralRepair 又只属 repair，validateDesk 必报「没有可生成的内容」；但 gate 在 expectedCount=0 时明确允许空表，missing_disposition 仍要求该件存在。

**依据**：src/trivium/gate.ts:578-591 说明 expectedCount=0 时空表合法，350-382 的 missing_disposition 早退仍可要求落件；extension/src/ui/cockpit.ts:878-882 没有 draft 空表例外。renderDisposition 本身在 extension/src/disposition/dispositionDraft.ts:94-113 能生成 rows=[] 的文档，阻断仅来自宿主校验。

**建议**：当首写期望集确实为空时允许生成带表头的零行裁决件，并与「元数据缺失导致无法知道期望集」区分；补零意见 missing_disposition 的真实 gate 闭环用例。

### CLAUDE-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/runMeta.ts:65` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：readRunMeta 只捕获 JSON.parse 异常，不校验根形状。合法 JSON null 会在访问 obj.critics 时抛 TypeError，artifacts 为非数组对象时也会在 .map 处抛错；openDesk 没有兜底，用户得不到约定的降级提示。

**依据**：extension/src/disposition/runMeta.ts:65-83 在类型断言后直接读取 critics、调用 artifacts.map；extension/src/ui/cockpit.ts:782-801 直接 await readRunMeta，未捕获这些形状异常。模块头注与计划要求的是防御式解析、读不出返回 null，而现有单测只覆盖正常对象。

**建议**：先验证根值是非空普通对象，再分别验证 critics 与 artifacts 的容器形状，不合格一律返回 null 并在 UI 明示；补 null、标量、数组及 artifacts 非数组用例。

### CLAUDE-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:920` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：修复模式手工拼表格行时只对 reason 替换竖线与换行，action 原样插入。落点输入框允许竖线和多行文本，可能改变列含义、截断表格或让后续行失去解析，破坏契约与自动复核闭环。

**依据**：extension/src/ui/cockpit.ts:920-923 的行模板直接插值 row.action；同一项目 extension/src/disposition/dispositionDraft.ts:52-55 已有 safeCell，125-127 的起草路径对所有单元格使用它，修复路径却未复用。src/trivium/disposition.ts:106-131 展示了真实表格分隔规则。

**建议**：修复与起草共用同一个 rowLine/safeCell 渲染函数，至少对 action 做同等处理；补修复行中含竖线、 CRLF 与多行落点的契约测试。

### CLAUDE-09 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:720` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：预设删除在真实 UI 中不可达：下拉 onchange 立即加载并把选择重置为空，用户再点「删除」只会得到「请先选中」提示，无法形成删除所需的选择。即使绕过 UI 直发 preset-delete，宿主也没有计划要求的删除确认。

**依据**：extension/src/ui/cockpitHtml.ts:720-727 在加载后清空 presetSel，738-744 的删除处理又要求其中有值；extension/src/ui/cockpit.ts:1088-1091 直接 remove。`.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:139-144` 明确要求删除带确认；extension/test/integration/presets.test.ts:61-80 直发宿主消息，绕过了不可达的选择交互。

**建议**：将「选择」与「加载」拆成独立动作，或保留待删除选择；在删除前增加名称明确的确认并测试取消不删除、确认才删除的真实 Webview 路径。

### CLAUDE-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:608` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：addresses 编辑框读取的是 m.model.addresses，但 desk-state 的 m 本身就是 GapModel，没有 model 子字段，所以 addrList 永远为空。即使宿主成功派生 addresses，UI 也错误宣称「派生为空，须手工补齐」，用户无法核对初始值。

**依据**：extension/src/ui/cockpit.ts:811-820 以 { model, session } 发送 desk-state，model.addresses 由 787、801 行构造；extension/src/ui/cockpitHtml.ts:515 已把该对象赋给 m，608 行却又访问 m.model。宿主预览仍使用 s.addresses，故 UI 与实际生成内容可能不一致。

**建议**：改为读取 m.addresses，并在用户编辑后保持显示与宿主会话同步；补派生非空和派生为空两种 Webview 渲染断言。

### CLAUDE-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:649` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：表单空洞理由警示已经计算并随 desk-preview 发送，但 renderDeskPreview 在成功和失败分支都只渲染 errors/text，完全忽略 msg.warnings，用户看不到计划承诺的即时提示。

**依据**：extension/src/ui/cockpit.ts:856-861 生成 isHollow 警示，897、906 行均以 warnings 字段发送；extension/src/ui/cockpitHtml.ts:649-658 没有任何 msg.warnings 消费。`.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:91-95` 要求即时提示但不阻止提交。

**建议**：在预览结果区逐条渲染 warnings，保持非阻断语义；增加 warn 策略理由可见且仍可落盘的测试。

### CLAUDE-12 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:415` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：实际 Webview 使用的 statusText 只看 x 位，未暂存修改 ' M' 和删除 ' D' 不会得到中文标签。纯函数 worktreeSummary.statusText 虽已正确看 y 位并有测试，但视图另写了一份旧逻辑，修复没有接到真实消费方。

**依据**：extension/src/ui/cockpitHtml.ts:414-415 的 STATUS_TEXT 与 statusText 仅取 xy[0]，447 行实际调用它；extension/src/approval/worktreeSummary.ts:48-56 才同时看 x/y。extension/test/unit/worktreeSummary.test.ts:72-77 只验证未被 Webview 复用的那份函数。

**建议**：收敛为单一状态码映射（由宿主随摘要发送标签，或让 Webview 使用同一生成资产），并用真实摘要 ' M' 验证最终 DOM 文案。

## 认为正确的部分

- approve/reject/abandon 的 argv 形状与 CLI 契约一致，abandon 显式携带 --stage，拒绝理由在宿主侧也有非空拦截，审批动作增加了在途防重入。
- unknown_findings 已有删除语义，落盘绑定已确认预览，修复写回也有载入内容 hash 比对。
- front-matter 改用 YAML 序列化，文件名轮次优先采用 gate 的 rerun_index；state.json 的非 ENOENT 读失败与非法 JSON 根值已纳入 unreadable 保守处理。
- 审批结果与权威工作树摘要移到独立 gateResult 区域，不再被 gateArea 刷新直接清空。
- Driver 定位坚持 run 元数据优先、阶段认领兜底，addresses 的正常派生路径与 expectedReviewDocs 基本对齐。
- 保存快照已同步注册 waitUntil，并保存原始字节与 mode；预设使用 globalState/workspaceState 且不把 topic/body 入库。

## 未覆盖范围（本侧盲区）

- 本侧没有执行任何命令，未运行 extension 的 typecheck、compile、单元、集成或 real 测试；脚本语法错误按 JavaScript 语言语义作静态判定，保存与请求竞态按代码事件链推理，未实测。
- 未在真实 Webview DOM 中验证渲染、按钮交互、modal/toast 时序，也未覆盖真实四家 Driver 与真实三审主题。
- Windows、多根工作区、非 UTF-8 文件、文件权限与文件系统边界未验证。
- Phase 2 既有功能只检查本次改动触及的调用链，未做完整回归审查。
- test/real/dispositionGate.test.ts 的真实 CLI 输出未在本侧复跑，其运行时是否形成有效断言未验证。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T021820Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-claude.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `extension/README.md`
- `extension/package.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/approval/gateAreaModel.ts`
- `extension/src/approval/lampModel.ts`
- `extension/src/approval/worktreeSummary.ts`
- `extension/src/cli/commands.ts`
- `extension/src/disposition/dispositionDraft.ts`
- `extension/src/disposition/gateGapModel.ts`
- `extension/src/disposition/runMeta.ts`
- `extension/src/guard/saveGuard.ts`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/presets/presetModel.ts`
- `extension/src/presets/presetStore.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/test/integration/dispositionDesk.test.ts`
- `extension/test/integration/gateApproval.test.ts`
- `extension/test/integration/presets.test.ts`
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/real/dispositionGate.test.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/test/unit/gateGapModel.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":48,"grep":7,"glob":0,"run_command":0,"project_reads":39}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
