---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: code
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
run_id: 20261107T024822Z
rerun_index: 3
snapshot_hash: sha256:bb43732727b1294b8eaad9452d01393d1bd2ea43e3f53a57a8c4e59105543a26
blind: true
started_at: 2026-11-07T02:48:35.099Z
finished_at: 2026-11-07T03:00:01.450Z
duration_s: 272
tool_calls:
  run_command: 29
  project_reads: 37
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 6
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: different-family
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: 9d165553c2d4830a0a82cf4b86bf9680e2d8dee2f18f1cff28db60a2fb0667f2
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
session_id: 01a1b3e8-69a2-75d1-86ff-c0801ea77578
---

# 代码审查：VSCode插件Phase3

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261107T024822Z` ｜ 第 3 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

补丁哈希及 HEAD 与任务书一致。类型检查通过，生成的 Webview 脚本可解析，八份相关单测经内存转译执行为 64/64 通过。但额外内存桩复现了保存恢复覆盖后续改动、旧通知清除新快照，以及三类裁决生成失败，需要修复后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 6 条：重要 6）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:183-220` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：恢复前仅比较快照对象身份，没有检查通知出现后文档或磁盘是否发生变化。其它窗口或终端修改文件不会替换 snapshots 中的对象，因此点击恢复仍会直接覆盖这些后续改动。

**依据**：实际读取 saveGuard.ts 的 onDidSave/restore，恢复路径没有文档版本或当前磁盘内容校验。本轮执行 node -e 内存转译及文件系统桩：保存前 A、保存后 B、通知等待期间磁盘变为 EXTERNAL-C，点击恢复后输出 RESTORE_AFTER_EXTERNAL_AND_DIRTY_CHANGE A。文件写入均被内存桩替代。

**建议**：记录本次保存完成时的磁盘基线与文档版本；恢复前检查是否仍匹配，发现后续修改则使通知失效或进入明确的冲突处理。增加外部修改及继续编辑的时序用例。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:189-194` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：关闭旧恢复通知时仍无条件删除该 URI 的快照。连续保存产生新快照后，关闭第一次通知会清除第二次保存的恢复基线，导致最新通知的恢复按钮失效。

**依据**：实际读取 saveGuard.ts：快照身份检查只在选择恢复的分支，else 分支直接 delete。本轮执行 node -e 内存时序桩，依次保存 A→B、B→C，再关闭第一次通知，输出 DISMISS_OLD_NOTIFICATION {latestSnapshots:0,disk:"C"}；随后点击最新通知，磁盘仍为 C，未执行恢复。extension/test/integration/saveGuard.test.ts 使用 silentUi，未覆盖通知关闭分支。

**建议**：恢复与关闭通知两个分支均按保存代次检查身份，仅允许清理该通知所属快照。补充旧通知关闭后最新恢复仍有效的回归用例。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:148-153,167-169` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：固定 1.2 秒超时仍不能保证读取早于保存完成：VS Code 的 1.5 秒预算由所有监听器共享，其它监听器耗时后，本次保存可能在自身超时之前完成。迟到读取随后仍写入快照表，没有恢复提示且可能污染下一次保存。

**依据**：实际读取 extension/node_modules/@types/vscode/index.d.ts:14533-14544，其明确声明共享预算；saveGuard.ts 读取结束只检查 disposed，没有保存完成标记或代次校验。本轮执行 node -e，模拟共享预算耗尽导致 did-save 先于读取完成，随后在自身超时前释放读取，输出 SHARED_BUDGET_SAVE_BEFORE_READ {pending:1,restorePrompts:0}。

**建议**：每次保存开始即分配代次，并在 did-save 时关闭该代次的快照接收窗口；迟到读取必须丢弃。超时失败的清理也应限定代次，不能删除更新的快照。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:960-964` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：本轮修复了既有行按原列结构替换，但新增缺裁行仍固定输出六列。既有裁决表采用合法的三列、四列或其它列序时，新行字段错位，补齐 missing_findings 后仍无法通过闸门。

**依据**：实际读取 src/trivium/disposition.ts，编排器按表头映射列，支持至少编号、裁决、理由三列。本轮执行 node -e 调用实际 renderDeskDraft，向四列表“意见编号/裁决/理由/落点”追加 CODEX-02，再经 parseDispositionDoc 解析，SHORT_HEADER_APPEND 输出该行 verdict=null、reason="major"、action="接受"。

**建议**：追加行与替换行共用原表列映射，按原列数及顺序生成；若改为标准六列表，须同步转换表头和全部既有行。补充短列表及重排列序下新增缺裁行的验证。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:972-979` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：无可识别表头的修复分支只添加标准表头，遗漏已收集的 appendLines。用户填写并确认的裁决行没有进入生成内容，自动复核后仍回到相同缺口，无法完成修复闭环。

**依据**：实际读取 cockpit.ts：循环已收集新增行，但 !sg 分支返回前没有使用它们。本轮执行 node -e 调用实际 renderDeskDraft，输入有效文件头、不可识别表头及一条已填写的 CODEX-01，输出 NO_HEADER_REPAIR {surgery:null,rowsAfter:[],containsSubmittedId:false}。批准计划 r2 §D1 要求结构缺口能够重建表格。

**建议**：无表头重建时将全部已确认裁决行写入新表，并确保表头、对齐行和数据行连续；保留原正文。覆盖无表头与坏表头的完整修复链。

### CODEX-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:914-918` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：零意见首写仍被 hasContent 拦截。所有审核者均无待裁意见、Driver 与 addresses 均有效时，用户无法生成闸门要求的合法空裁决件。此处延续了上轮本侧 CODEX-09 指出的问题。

**依据**：实际读取 src/trivium/gate.ts:575-590，期望意见数为零时允许空裁决表。本轮执行 node -e，对实际 validateDesk 输入 missing_disposition、三个编号集均为空、有效 Driver 与非空 addresses，输出 ZERO_FINDINGS_DRAFT {ok:false,errors:["没有可生成的内容（无待裁条目、无结构缺口、无既有合法行）。"]}。

**建议**：允许已确认期望意见集为空的首写生成合法空表，同时保留对期望集读取失败的区分。增加零意见首写到闸门校验的闭环用例。

## 认为正确的部分

- 此前两处 Webview 语法错误已消除，本轮对实际生成脚本的解析检查通过。
- 闸门区新增请求代次并核对运行身份及状态，能够避免旧请求覆盖较新状态。
- 快照采用原始 Buffer 并记录文件权限，避免固定 UTF-8 往返及执行位丢失。
- 审批通过宿主参数数组直达 CLI，abandon 显式限定阶段；审批结果使用独立区域展示。
- 预设采用 workspaceState/globalState，名称输入和删除确认已移至宿主接口。

## 未覆盖范围（本侧盲区）

- 未启动真实 VS Code Extension Host；复现采用实际源码内存转译、依赖注入和事件时序桩，不能替代真实宿主验证。
- 未运行会构建或写夹具的 npm run check、集成测试及真实 gate 流程；64 个单测为内存转译执行。
- 未验证 Windows、最低支持 VS Code 版本、真实子进程超时收尾及磁盘权限恢复。
- test/real/dispositionGate.test.ts 当前仅检查真实输出形状，没有执行批准计划要求的生成裁决件与真实 gate 的端到端对拍。
- 未重新计算工作树 tree 指纹；本轮核对了补丁 SHA-256 与 HEAD。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T024822Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r2-codex.md`
- `extension/README.md`
- `extension/package.json`
- `extension/esbuild.mjs`
- `extension/tsconfig.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/cli/commands.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/approval/gateAreaModel.ts`
- `extension/src/approval/lampModel.ts`
- `extension/src/approval/worktreeSummary.ts`
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
- `extension/test/unit/gateAreaModel.test.ts`
- `extension/test/unit/gateGapModel.test.ts`
- `extension/test/unit/lampModel.test.ts`
- `extension/test/unit/presetModel.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/unit/stateModel.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":29,"project_reads":37}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
