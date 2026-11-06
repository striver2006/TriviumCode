---
schema: trivium.review.v2
topic: VSCode插件Phase2
stage: code
role: codex
vendor: openai
agent_cli: codex/0.166.0
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
run_id: 20261106T002819Z
rerun_index: 1
snapshot_hash: sha256:0d33a004dd86ead5218f8dcfe23bfc83e28f38ba9f6959c74d3fee91d63680e3
blind: true
started_at: 2026-11-06T00:28:31.014Z
finished_at: 2026-11-06T00:40:34.242Z
duration_s: 293
tool_calls:
  run_command: 25
  project_reads: 34
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 7
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: 159c9e2cff1fa3a527487bfc83473387b35f5a0de36ef7014bad96c646e274fe
  provider_declared: openai
  provider_declared_source: config
  provider_effective: openai
  provider_effective_source: trace
family_comparisons:
  - left: glm
    right: codex
    status: unknown
    left_model: null
    right_model: gpt-6.1-sol
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
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
override_reason: 左侧模型信息缺失
session_id: 01a1ae41-d0fb-7da3-9c70-22055aca7c74
---

# 代码审查：VSCode插件Phase2

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261106T002819Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

发现 7 项需修复的问题：Diff 按钮参数缺失、跨主题异步摄取污染、停用后的异步装配、三处静态一致性校验缺陷，以及历史回放缺少意见列表。已用只读内存桩复现相关数据流与竞态；类型检查通过。修复涉及批注生命周期与缓存模型，建议重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 7 条：重要 7）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:703-716` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：意见卡片没有传递 relPath，导致界面中的 Diff 按钮点击后直接返回，文件位置也只显示行号。

**依据**：cockpit.ts 的 findings 映射只有绝对路径 file，没有 relPath；cockpitHtml.ts:342、349 却使用 f.relPath 显示文件名及发送 open-diff。cockpit.ts:277-281 将缺失参数转为空串后直接退出。本轮执行 node -e 内存桩，调用源码 Cockpit.cardsForTest()，输出 file='/memory/a.ts'、relPath=undefined、inChangeset=true。

**建议**：在 RunCard 的类型与实际消息中完整传递 relPath，并增加从卡片消息到 Diff 按钮事件的契约验证。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:233-271` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：旧 scope 的摄取任务可以在切换主题后继续写入共享缓存，将旧主题意见挂到新主题下。rebuildSeq 只能约束装配，无法阻止此前的缓存污染。

**依据**：setScope():108-119 清空共享 Map 并更换 metaDir；ingestMetaDir() 在 readdir/readFile 的 await 后没有核对 scope 或代次，仍向当前 reviewsByRun 写入。本轮执行 node -e 内存桩：暂停主题 A 的 review 读取，完成 setScope('B','code') 后恢复 A，结果 currentScope 为 B，但 currentRunId 和 findings 中出现 A 的 A-01。

**建议**：为 scope 建立代次标识；摄取开始时捕获目录和代次，在异步读取后及提交缓存前复核。旧 scope 的整次结果应丢弃，避免逐条写入当前缓存。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:82-93；extension/src/reviews/annotationHub.ts:302-339` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：dispose() 没有使正在执行的 rebuild 失效；停用期间尚未完成的文件读取返回后，仍可能调用已释放的诊断集合和 CommentController 创建对象。

**依据**：dispose() 只设置 disposed，没有递增 rebuildSeq；rebuild() 的 await 后仅比较 seq，装配前没有再次检查 disposed。本轮执行 node -e 内存桩：暂停 rebuild 的文件读取，调用 dispose() 后恢复，观测到 createCommentThread 在 controller.dispose 后被调用一次，threadsSnapshot 仍有一个线程。

**建议**：dispose 时使所有在途代次失效，并在异步边界之后、访问 VS Code 资源之前复核 disposed 和代次；补充读取未完成时停用的生命周期回归。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:294-307` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：首次装配先把一致性结论复制到 resolution，随后才执行静态比对；比对发现 mismatch 后，本次线程、诊断和列表仍使用旧的 unknown。回放已归档运行且没有后续文件事件时，会持续漏标失配。

**依据**：locationResolve.ts 的 resolveLocation() 将 consistency 返回值保存在结果中；annotationHub.ts:305 才更新 consistency Map，之后没有更新 resolved。本轮执行 node -e 内存桩，以不同于冻结 blob 的工作区内容首次装配，输出 displayed='unknown'、cached='mismatch'、gitReads=1。

**建议**：在生成最终 resolution 前完成静态校验，或把校验结果重新应用到本次 resolved，再生成线程、诊断与列表。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:368-379` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：运行在没有可校验文件时就被永久标记为已校验。实时运行中 changes.diff 先出现、review 后落盘时，后续意见会一直跳过静态一致性检查；同一轮迟到侧首次引用的新文件也有相同问题。

**依据**：ensureConsistencyChecked() 在确认 diff、Git API 和待校验文件之前就执行 consistencyCheckedRuns.add(runId)，后续调用首先按 runId 返回。本轮执行 node -e 内存桩，先仅装配 diff，再加入 review 并重建，输出 displayed='unknown'、gitReads=0。

**建议**：按实际完成检查的文件记录进度；没有 diff 或没有文件时保留待校验状态，后续侧落盘新增的文件应继续补检。

### CODEX-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:123-130；extension/src/reviews/annotationHub.ts:381-390` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：一致性缓存只按 relPath 保存，切换同一 scope 内的运行时不会清空。不同轮次引用同一文件但冻结 head 不同，会沿用上一轮的 consistent/mismatch/edited，展示错误的版本一致性结论。

**依据**：consistency 在 setScope() 中清空，setActiveRun() 只改变 focusRunId；ensureConsistencyChecked():382 见到相同 relPath 就跳过。本轮执行 node -e 内存桩：第一轮 blob 与工作区一致，第二轮 blob 不同；切到第二轮后 displayed 仍为 consistent，两个运行合计只读取一次 Git blob。

**建议**：缓存身份至少包含运行或冻结快照与文件路径；切换运行时同步切换对应的一致性和挂载状态，动态 edited 结论也应限定到其所属回放。

### CODEX-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:682-694；extension/src/history/historyProvider.ts:125-127` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：历史树回放只更新 Hub，没有为历史运行建立意见列表的展示入口。驾驶舱仅遍历当前会话发现过的运行；重启扩展后回放已结束运行时，即使批注成功挂载，意见列表仍为空，非文件位置、缺失文件和降级说明也无法查看。

**依据**：historyProvider.ts 的 replayRun() 仅调用 setScope/setActiveRun；cockpit.ts 的 runCards() 仅遍历 this.runs，而 attachRun() 由活跃运行发现链填充。cockpitHtml.ts 的意见列表依附这些卡片。本轮执行 node -e 内存桩，Hub 已聚焦且有一条意见、驾驶舱没有活跃卡片时，cardsForTest() 返回 0 张卡片。批准计划 D6′ 明确要求历史回放时意见列表聚焦。

**建议**：为焦点历史运行提供独立列表或归档回放卡片，使其无需活跃运行目录即可展示全部意见与逐文件降级状态；补充重启后仅有归档的回放验证。

## 认为正确的部分

- 批注宿主和 metaWatch 由服务层持有，避免面板关闭直接释放批注资源，职责划分合理。
- review 旧版与坏件采用逐文件降级，未并入全局禁点火判定，符合计划边界。
- 历史统计优先读取归档，severity 映射及路径 containment 的基本实现方向正确。
- 补丁 SHA-256 与任务书一致，HEAD 一致；本轮执行 node extension/node_modules/typescript/bin/tsc -p extension/tsconfig.json --noEmit，通过。

## 未覆盖范围（本侧盲区）

- 未执行会构建产物或写入夹具的 npm check、完整单元测试、集成测试和 VSIX 打包。
- 竞态复现使用源码内存转译及 VS Code/文件系统桩，未在真实 Extension Host 中复测停用和快速切换。
- 未执行 F5 GUI、真实 CLI 注入、真实 Git Diff 界面及 Windows 验收；Windows 和 multi-root 为本批既定范围外。
- 未逐项验证人工条件性验收与交付文档是否已完成。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-r2-glm.md`
- `.reviews/VSCode插件Phase2/code/_meta/changes-20261106T002819Z.diff`
- `extension/package.json`
- `extension/tsconfig.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/reviews/annotationHub.ts`
- `extension/src/reviews/annotationModel.ts`
- `extension/src/reviews/locationResolve.ts`
- `extension/src/reviews/metaWatch.ts`
- `extension/src/reviews/diffParse.ts`
- `extension/src/reviews/diffView.ts`
- `extension/src/reviews/reviewParse.ts`
- `extension/src/history/historyProvider.ts`
- `extension/src/history/runHistory.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/test/integration/annotations.test.ts`
- `extension/test/integration/diffView.test.ts`
- `extension/test/integration/history.test.ts`
- `extension/test/integration/cockpitFindings.test.ts`
- `src/trivium/archive.ts`
- `src/trivium/review.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":25,"project_reads":34}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
