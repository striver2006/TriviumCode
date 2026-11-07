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
run_id: 20261107T014536Z
rerun_index: 1
snapshot_hash: sha256:99a09d60c841f74a490fca513165866358fadca1867f523422d100b4eb995207
blind: true
started_at: 2026-11-07T01:46:36.588Z
finished_at: 2026-11-07T02:03:53.874Z
duration_s: 1035
tool_calls:
  read: 45
  grep: 11
  glob: 0
  run_command: 0
  project_reads: 40
evidence_ok: true
verdict: reject
findings_count:
  blocker: 3
  major: 9
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
consulted_unverified: true
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
session_id: b397836b-1eba-4993-bb4f-9b4088d62349
---

# 代码审查：VSCode插件Phase3

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261107T014536Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。

## 总判断

最危险的是保存防护未用 waitUntil 排序：快照可能读到保存后的内容，恢复提示也可能永远不出现，存在误恢复与数据损失风险。
裁决台还有两个确定闭环断点：unknown_findings 无删除路径，纯 bad_front_matter/unparsable_table 在无编辑行时无法生成修复件。
此外，预览与落盘内容未绑定、合法行并非保留原文、审批摘要会被立即清掉、闸门缓存跨运行复用，均影响核心承诺。
这些写入与恢复路径需要修改后重新评审，故本侧不通过。

**结论**：不通过（`reject`）

## 审查意见（共 15 条：阻断 3 ｜ 重要 9 ｜ 次要 3）

### CLAUDE-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:66` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：will-save 监听器丢弃事件并 void 调用异步函数，没有同步注册 e.waitUntil。保存不会等待磁盘快照，onDidSave 可能先找不到快照而直接返回；较晚完成的 readFile 还可能读到保存后的内容，随后把它误当“保存前内容”恢复。

**依据**：extension/src/guard/saveGuard.ts:66,128-161 显示 onWillSave/onDidSave 均为无等待的异步链；extension/node_modules/@types/vscode/index.d.ts:13521-13549 说明只有 waitUntil 能暂停保存，14533-14551 说明保存事件语义。extension/test/integration/saveGuard.test.ts:93-113 绕过真实恢复按钮、直接 restoreForTest，未覆盖上述时序。

**建议**：在事件分发内同步调用 e.waitUntil，把快照读取纳入保存前时序，并协调 didSave 的提示触发；补充延迟 readFile 的故障注入，覆盖 didSave 先到和快照读到新内容两类情况。

### CLAUDE-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/gateGapModel.ts:91-98` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：unknown_findings 在模型注释里要求“删行”，实际却被当成普通编辑行：UI 没有删除操作，validateDesk 强制每行选择裁决并填写理由，renderDisposition 又把这些编号全部写回。用户无法通过裁决台消除 unknown_findings，自动复核只会反复回到同一缺口。

**依据**：extension/src/disposition/gateGapModel.ts:91-98,190-201 将 unknown 编号放入 items；extension/src/ui/cockpit.ts:769-800 对全部 items 强制裁决并生成 rows；extension/src/ui/cockpitHtml.ts:535-608 只有裁决表单没有删行语义。extension/test/unit/gateGapModel.test.ts:72-110 只断言 unknown 行出现，没有验证删除后 gate 闭环。

**建议**：为 unknown_findings 建立明确的删除/排除语义，生成稿时不得再输出这些行；增加从既有件含多余编号到写回后编号消失、真实 gate 复核通过的端到端用例。

### CLAUDE-03 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:769-800` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：纯结构缺口无法修复。若 bad_front_matter 是唯一 failure，现有合法行全部进入 readonlyRows、items 为空；validateDesk 又要求 rows.length > 0，因此无法预览或重建 front-matter。unparsable_table 且没有 missing_findings 时同样无路可走。

**依据**：extension/src/disposition/gateGapModel.ts:160-167,190-208 将结构 failure 与编辑行分离；extension/src/ui/cockpit.ts:769-800 在没有任何 editable rows 时返回失败，803-833 因而不能生成修复稿。extension/test/unit/gateGapModel.test.ts:162-190 只检查 bad_front_matter 被归类，没有走保存链路。

**建议**：让结构修复可以基于现有只读行重建完整文档，校验时把保留行计入可生成内容，或提供明确的整体重建入口；补 bad_front_matter-only 与 unparsable_table-only 的保存闭环测试。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/gateGapModel.ts:202-208` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：“合法行保留原文”没有兑现。readonlyRows 只保留 id/裁决/理由/落点，来源与严重度被丢弃，renderDisposition 对它们填“—”；整份文件还会重建，表外说明和其它未被解析的内容一并消失。修复一条理由会无意改写审计件其它内容。

**依据**：extension/src/disposition/gateGapModel.ts:34-40,202-208 的 ReadonlyRow 没有原文、来源或严重度；extension/src/disposition/dispositionDraft.ts:76-100,112-150,184-205 全量重排文档。extension/README.md:35-41 承诺合法行保留原文；extension/test/integration/dispositionDesk.test.ts:152-208 仅断言合法行数量和裁决，未断言原文不变。

**建议**：保留合法行的原始文本及未编辑文档片段，只替换目标行、追加新行并删除 unknown 行；用包含自定义来源/严重度、表外说明和额外段落的既有件做字符级不变性测试。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:835-888` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：落盘不依赖已确认的预览。saveDesk 没有预览记录或内容 hash，会按点击保存时的最新表单重新生成文本；webview 在预览成功后允许继续编辑，且编辑不会重新禁用保存按钮，所以实际写入内容可以不同于用户刚确认的预览，跨午夜时文件名也可能不同。

**依据**：extension/src/ui/cockpit.ts:803-833 与 835-888 分别独立生成预览和落盘文本，没有共享已确认文本；extension/src/ui/cockpitHtml.ts:581-619 只在预览后启用按钮，没有编辑失效逻辑。extension/test/integration/dispositionDesk.test.ts:117-128 甚至不经预览直接 desk-save，说明宿主也没有预览门槛。

**建议**：保存会话中记录已确认预览的完整文本、目标路径和内容版本，只允许落盘同一份内容；任何后续表单变化都使预览失效，宿主侧也强制校验，而非仅依赖按钮状态。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:783-787` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：空洞理由被无条件当成校验错误，违背已批准计划“即时提示但不阻止提交”。在 gate.reason_policy=warn 时，这类理由本来只产生 warning，插件却让用户无法落盘，复制了且误判了编排器策略。

**依据**：extension/src/ui/cockpit.ts:783-787 对 isHollow 直接 errors.push；.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:91-95 明确要求不阻止提交；src/trivium/gate.ts:672-678 显示 weakReason 在 warn 策略下仅进 warnings。

**建议**：将空洞词检查改为非阻断警示，最终由真实 gate 按配置判定；增加 warn 策略可保存、hard 策略由复核回报的用例。

### CLAUDE-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:598-618` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：gateCheckCache 仅以 topic/stage 为键，既不包含 runId，也不随 state 快照或轮次变化失效。raf→aa、同主题新运行或外部修好裁决件后，卡片会继续展示旧的 failures/warnings/计票，只有手动刷新或插件内 saveDesk 才清缓存。

**依据**：extension/src/ui/cockpit.ts:598-618 命中缓存后完全不重新调用 gate，621-625 仅手动刷新删除，893-910 是另一处删除；缓存键在 607 行不含 runId。extension/test/integration/gateApproval.test.ts:39-99 始终使用同一份桩输出，未覆盖状态迁移或新 run 输出变化。

**建议**：至少把 runId 纳入缓存身份，并在运行、轮次或关键状态迁移时重拉；增加同 topic/stage 不同 runId 及 raf→aa 返回不同 gate 内容的测试。

### CLAUDE-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:415-420` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：批准后的权威工作树摘要会被立即擦掉。handleApprove 先发送含 authoritative 的 gate-action，再 await stateWatch.rescan；rescan 必然广播并触发 pushGateArea，而 renderGateArea 第一步就清空包含 gateActionResult 的整个 gateArea，因此结果和摘要无法稳定展示。

**依据**：extension/src/ui/cockpit.ts:641-659 的发送后 rescan 顺序、extension/src/monitor/stateWatch.ts:51-53 的每次广播、extension/src/ui/cockpitHtml.ts:415-420 与 488-503 的 DOM 结构共同构成清除链。extension/test/integration/gateApproval.test.ts:113-126 测试名提到权威摘要但只断言 argv，没有检查其后续展示。

**建议**：将动作结果/权威摘要放到不会被卡片刷新清空的独立区域，或在 rescan 与卡片刷新完成后再渲染；用真实 webview DOM 断言 approve 完成后摘要仍存在。

### CLAUDE-09 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/stateWatch.ts:38-50` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：“state.json 不可读按锁闭”只覆盖 JSON 解析失败。EACCES 等非 ENOENT 读取错误被静默 return，初始灯仍是绿色，可能放行保存；另外 JSON 文本 null 会在 parseGates 访问 obj['gates'] 时抛异常，也不会形成 unreadable 快照。

**依据**：extension/src/monitor/stateWatch.ts:38-50 明确对其它读失败 return；extension/src/guard/saveGuard.ts:41,83-91 初始为绿并据此放行；extension/src/monitor/stateModel.ts:57-66 未先验证解析结果是非空对象。extension/README.md:49-54 的承诺是不可读即保守锁闭。

**建议**：除明确 ENOENT 外的读取失败都发布 unreadable=true 快照，并在索引 gates 前校验根值是非空普通对象；补 EACCES、合法 JSON null 与非对象 gates 的测试。

### CLAUDE-10 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:77-88` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：front-matter 字符串未经 YAML 序列化或 quoting。主题名校验允许引号、方括号等特殊字符，像 [abc] 这样的合法主题会被 YAML 解析成数组，其它形态可造成 YAML 语法错误，生成的裁决件因此无法通过契约。

**依据**：extension/src/disposition/dispositionDraft.ts:77-88 直接插值 topic/addresses；src/trivium/naming.ts:51-100 明确采用黑名单并放行其它字符；src/trivium/disposition.ts:145-155 使用真实 YAML.parse。测试只覆盖普通中英文主题，没有特殊字符主题。

**建议**：用项目已有 YAML 依赖统一序列化 front-matter，或对所有自由字符串做可靠 YAML quoting；为方括号、引号、冒号等 validateTopic 放行形态增加契约测试。

### CLAUDE-11 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/gateGapModel.ts:213-220` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：裁决文件名轮次没有使用 gate 已返回的 rerun_index。当前实现只在 review_loop.round > 0 时取 meta.rerunIndex；旧运行 review_loop=null，或 run 元数据读取失败时，第二轮也会生成不带 -r2 的文件名，可能撞首轮文件并转进错误修复路径。

**依据**：extension/src/disposition/gateGapModel.ts:219 的取值链完全忽略 check.rerun_index；src/trivium/cli.ts:1674-1685 证明顶层 rerun_index 与校验所用轮次同源；extension/src/disposition/dispositionDraft.ts:41-47 只有 rerunIndex>1 才写 -rN。

**建议**：以 check.rerun_index 为第一事实源，meta 仅作必要时的后备；覆盖 review_loop=null、meta=null 且 rerun_index=2 的文件名测试。

### CLAUDE-12 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:725-754` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：计划承诺的 addresses 手工兜底没有实现。meta 缺失或 criticsSelected 为空时 addresses 变成空数组，预览没有编辑入口，最终只输出没有列表项的 addresses:，YAML 中不是非空数组，落盘后仍被 gate 拒绝。

**依据**：extension/src/ui/cockpit.ts:725-730 在 meta 缺失时传 []；extension/src/disposition/runMeta.ts:93-115 在 criticsSelected 为空时得到有效侧空集；extension/src/disposition/dispositionDraft.ts:86-87 空数组无列表项；.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:97-99 要求允许手工编辑；src/trivium/gate.ts:451-457 要求非空。

**建议**：在预览提供带校验的 addresses 人工编辑通道并标明降级原因，或在无法派生时明确禁止落盘并给出可执行修复指引，不要生成必然失败的契约件。

### CLAUDE-13 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:699-704` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：预设删除没有二次确认，点击删除即向宿主发送 preset-delete 并实际移除，与计划的“删除带确认”不符。

**依据**：extension/src/ui/cockpitHtml.ts:699-704 直接 postMessage；extension/src/ui/cockpit.ts:994-998 随即调用 store.remove；.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:139-144 明确要求删除确认。

**建议**：删除前增加名称明确的确认步骤，并测试取消时不调用 remove、确认后才删除。

### CLAUDE-14 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:641-711` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：审批三动作没有防双击。busy 只是结果区文案，宿主没有 pending 状态，按钮也未禁用，连续点击会并发发出多个 approve/abandon 请求，后到的结果还可能覆盖先到提示。

**依据**：extension/src/ui/cockpit.ts:641-711 每个处理器都直接调用 CLI；extension/src/ui/cockpitHtml.ts:461-480 按钮始终可用；.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:109-114 将防双击列为保留设计。

**建议**：按 topic/stage 维护动作进行中状态，在请求完成前禁用对应按钮并拒绝重复消息；增加连续两次点击只产生一次 CLI 调用的测试。

### CLAUDE-15 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/README.md:3-6` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：集成面说明仍停留在 Phase 2：称文件面只读、插件只做装配/注入/旁观渲染/中止，未包含本批新增的裁决件写例外、审批动作和只读 git status，容易让后续维护者误判写入边界。

**依据**：extension/README.md:3-6 与 35-58 的新功能自述相互不一致；extension/package.json:4 也仍写“集成面仅 CLI 与只读文件 watcher”；实际写入见 extension/src/ui/cockpit.ts:835-888，git 调用见 extension/src/ui/cockpit.ts:636-639。

**建议**：在 README 与 package description 同步列出审批动作、只读 git status，以及仅限预览确认后的 disposition 新建/修复写例外，保持单一准确边界口径。

## 认为正确的部分

- gate/approve/abandon 的参数形状与 src/trivium/cli.ts 对齐，拒绝理由在宿主侧也有非空拦截，abandon 显式携带 --stage。
- 首写期望集正确地区分 structured/degraded 与 .fallback-items.md，未误用 missing_disposition 早退时恒空的 fallback_ids。
- Driver 定位以 run 元数据优先、task.json 阶段认领为受限 fallback，没有采信可能残留的 gates[].driver。
- addresses 的正常路径派生逻辑与 gate.ts expectedReviewDocs 的阶段根、有效侧及裁决件排除规则基本一致。
- 工作树提示摘要使用 porcelain -z 并过滤编排器目录，且明确区分提示性 HEAD 口径与 approve 权威摘要。
- 预设采用 globalState/workspaceState，未写仓库配置，topic/body 也未进入预设模型。

## 未覆盖范围（本侧盲区）

- 本侧仅做静态审查，未运行 extension 的 typecheck、单元、集成或 real 测试；保存事件竞态、摘要被清除等结论按代码与事件链推理，未实测。
- Windows、多根工作区、非 UTF-8 文件及可执行位保留等平台/文件系统边界未验证。
- 真实四家 Driver、真实三审主题的交互手感与 CLI 实跑未覆盖。
- Phase 2 既有功能仅检查本次改动接触到的调用链，未做完整回归审查。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T014536Z.diff`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
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
- `extension/src/cli/triviumCli.ts`
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
- `extension/test/integration/cockpitFindings.test.ts`
- `extension/test/integration/cockpitLifecycle.test.ts`
- `extension/test/integration/dispositionDesk.test.ts`
- `extension/test/integration/fakePresets.ts`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/integration/gateApproval.test.ts`
- `extension/test/integration/health.test.ts`
- `extension/test/integration/presets.test.ts`
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/integration/suite.ts`
- `extension/test/real/dispositionGate.test.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/real/suite.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/test/unit/gateAreaModel.test.ts`
- `extension/test/unit/gateGapModel.test.ts`
- `extension/test/unit/lampModel.test.ts`
- `extension/test/unit/presetModel.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/cli.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`
- `src/trivium/naming.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":45,"grep":11,"glob":0,"run_command":0,"project_reads":40}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
