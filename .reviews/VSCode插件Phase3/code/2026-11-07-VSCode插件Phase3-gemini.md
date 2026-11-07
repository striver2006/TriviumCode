---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.5.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261107T014536Z
rerun_index: 1
snapshot_hash: sha256:99a09d60c841f74a490fca513165866358fadca1867f523422d100b4eb995207
blind: true
started_at: 2026-11-07T01:46:36.588Z
finished_at: 2026-11-07T02:03:53.874Z
duration_s: 884
tool_calls:
  read: 56
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 27
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 3
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: different-family
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
  - left: glm
    right: gemini
    status: different-family
    left_model: glm-5.3
    right_model: gemini-3.8-flash-high
    left_source: declared
    right_source: envelope
    reason: 模型族不同：glm / gemini
  - left: claude
    right: gemini
    status: different-family
    left_model: k3.1-pro
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：kimi / gemini
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 模型族不同：glm / gemini
session_id: 362a8cfc-7dc0-45ed-9022-fe54580c7619
---

# 代码审查：VSCode插件Phase3

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261107T014536Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

发现严重阻塞与并发/状态缺陷，整体判定为 reject。
1. 最严重问题：裁决台在修复 unknown_findings 缺口时，由于缺少从表单移除该行的能力，且校验器强制所有项必填理由，导致非法编号被反复写回盘上，形成无法解开的修复死循环（AGY-01，Blocker）。
2. SaveGuard 在 onWillSave 中未调用 waitUntil 挂起写盘，异步读快照与 VS Code 磁盘写入存在竞态条件，一键恢复可能捕获改后内容而失效（AGY-02，Major）。
3. SaveGuard 恢复使用 applyEdit 代替计划约定的 revert，将文档置为 dirty，在开启 autoSave 时会引发死循环保存与 Toast 轰炸（AGY-03，Major）。
4. 驾驶舱闸门检查缓存 gateCheckCache 缺乏状态流转失效机制，导致审批阶段残留陈旧检查数据（AGY-04，Major）。
5. worktreeSummary 未暂存修改状态文本映射退化及 addresses 为空时的 front-matter 格式细节需同步修复（AGY-05、AGY-06）。

**结论**：不通过（`reject`）

## 审查意见（共 6 条：阻断 1 ｜ 重要 3 ｜ 次要 2）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/gateGapModel.ts:98` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：裁决台修复模式处理 unknown_findings 缺口时因缺少删除行机制与强制必填校验陷入修复死循环

**依据**：在 extension/src/disposition/gateGapModel.ts:98-100 中，gate 检查返回的 unknown_findings 编号被置入 fixIds 转换为普通 GapItem。在 extension/src/ui/cockpitHtml.ts:251-255 与 extension/src/ui/cockpit.ts:803-820 中，该项仅带有删除提示，UI 却未提供删除该条目的操作或标记；且 extension/src/ui/cockpit.ts:808-812 的 validateDesk 强制校验列表每一项必须非空选择裁决并填写理由。用户被迫填写后提交，extension/src/disposition/dispositionDraft.ts:133 的 renderDisposition 会将该未知编号再次写回 Markdown 表格，重新触发 gate 的 unknown_findings 失败，导致用户永远无法闭环。

**建议**：在 GapItem 及 Webview 表单中为未知编号提供明确的删除/剔除操作，validateDesk 豁免被标记删除的条目，且在 renderDisposition 输出 Markdown 表格时将其过滤排除。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:66` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：SaveGuard.onWillSave 未接入 e.waitUntil 挂起保存，异步基线快照与 VS Code 磁盘写入存在竞态条件

**依据**：在 extension/src/guard/saveGuard.ts:66 中，事件监听注册为 vscode.workspace.onWillSaveTextDocument((e) => void this.onWillSave(e.document))，未将异步任务传递给 e.waitUntil(...)。VS Code 在触发事件后会立即将编辑器内容写盘，而 onWillSave 内部使用 fs.readFile 异步读取磁盘。在较快写入或高负载下，fs.readFile 读取到的极可能已经是写盘后的新内容而非保存前的基线快照，导致事后一键恢复捕获错误内容而失效。

**建议**：让 onWillSave 返回 Promise，并在监听器中调用 e.waitUntil(this.onWillSave(e.document))，确保异步快照在 VS Code 完成落盘前捕获完毕。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:187` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：SaveGuard 一键恢复使用 applyEdit 偏离计划约定的 revert，将文档置为 dirty 导致在 autoSave 场景下引发死循环保存

**依据**：计划 .reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md §D4 明确约定：在原子写回磁盘后，执行 workbench.action.files.revert 让编辑器静默重载盘上内容。但 extension/src/guard/saveGuard.ts:187-192 实际使用了 vscode.workspace.applyEdit(edit)。applyEdit 会直接把已恢复的文档置为未保存（dirty）状态；若用户开启了常用的 files.autoSave: afterDelay，文档会被自动保存，从而反复触发 onWillSave/onDidSave 流程与弹窗警示，造成死循环。

**建议**：遵守计划 §D4，在原子写回磁盘后通过 workbench.action.files.revert 重新加载文件内容，避免编辑器的 dirty 状态触发连续自动保存。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:602` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：驾驶舱 gateCheckCache 仅以 topic/stage 为键且缺乏主动失效逻辑，状态流转后闸门卡片显示陈旧数据

**依据**：在 extension/src/ui/cockpit.ts:602-605 中，gateCheckCache 以 topic/stage 为键缓存 gate 检查结果。当状态流转（例如完成审查进入 awaiting_approval，或在同一阶段重跑）时，stateWatch.onChange 调用 pushGateArea()，但未传入 force: true。此时 gateCheckCache.get(key) 命中旧缓存并直接返回，导致闸门区浮出的 failures、warnings、round_verdict 与 worktree 提示均为陈旧历史值，直到用户手动点击刷新按钮。

**建议**：在 stateWatch.onChange 监听到状态或轮次发生关键变更时，主动失效该 topic/stage 的缓存或在调用 pushGateArea 时传入 force: true。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/approval/worktreeSummary.ts:50` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：worktreeSummary 对未暂存修改的状态码映射错误，状态列显示为原始标记而非可读中文

**依据**：在 extension/src/approval/worktreeSummary.ts:50-55 中，statusText(xy) 实现为 const x = xy[0] ?? '?' 并从 map[x] 查表。但在 git status --porcelain=v1 -z 中，未暂存修改的标识为 ' M'（首位空格代表暂存区无变化，第二位 M 代表工作树修改）。xy[0] 为空格导致 map[x] 为 undefined，直接退化返回原始字符串 ' M'，未能正确转换为「修改」。

**建议**：调整 statusText 逻辑，兼顾 xy[0] 与 xy[1]，当 xy[0] 为空格时取 xy[1] 映射状态文本。

### AGY-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:127` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：addresses 为空时 front-matter 输出不规范 YAML 且预览页面缺少地址编辑与说明

**依据**：计划 .reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md §D1 约定当 addresses 派生为空时应在预览页面提示原因并允许手动编辑。但在 extension/src/ui/cockpit.ts 与 extension/src/ui/cockpitHtml.ts 中未提供 addresses 的展示与编辑能力；且在 extension/src/disposition/dispositionDraft.ts:127-129 中，当 addresses 为空数组时模板生成 addresses:\n---，在 YAML front-matter 中该字段会被解析为 null 而非列表。

**建议**：在 dispositionDraft.ts 中当 addresses 为空数组时输出 addresses: []，并在 Webview 预览界面补充 addresses 列表展示与提示信息。

## 认为正确的部分

- 装配预设体系（presetModel/presetStore）严格遵循双作用域 Memento 机制，不向仓库写任何文件，且加载只回填装配参数不覆盖用户输入的主题与正文，设计严密。
- 人工审批与闸门区模型（gateAreaModel）严格落实了直接调用 CLI、不经过模型上下文、计票与结论权威来源于 gate 输出且不设自动倒计时的安全契约。
- runMeta 的 Driver 解析链按 stage/rerun/artifacts 完备对齐编排器规范，并在 real 测试中成功对接了实际的 gate --check。

## 未覆盖范围（本侧盲区）

- VS Code 真实桌面环境下的 Webview 渲染效果与 CSS 样式兼容性。
- Windows 原生平台下的 git 状态解析与路径归一化实机测试。
- macOS 系统通知中心集成及无头自动化 CI 环境下的多插件冲突。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `extension/src/guard/saveGuard.ts`
- `extension/src/disposition/dispositionDraft.ts`
- `extension/src/disposition/gateGapModel.ts`
- `extension/src/disposition/runMeta.ts`
- `extension/src/approval/gateAreaModel.ts`
- `extension/src/approval/lampModel.ts`
- `extension/src/approval/worktreeSummary.ts`
- `extension/src/presets/presetModel.ts`
- `extension/src/presets/presetStore.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/services.ts`
- `extension/src/extension.ts`
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/real/dispositionGate.test.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/gate.ts`
- `src/trivium/disposition.ts`
- `src/trivium/naming.ts`
- `src/trivium/cli.ts`
- `skills/dual-critic/schema/disposition.v1.json`
- `skills/dual-critic/schema/review.v2.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":56,"grep":0,"glob":0,"run_command":0,"project_reads":27}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
