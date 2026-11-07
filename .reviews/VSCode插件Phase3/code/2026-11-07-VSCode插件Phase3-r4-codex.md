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
run_id: 20261107T031826Z
rerun_index: 4
snapshot_hash: sha256:6eb0283a11d0ef0d0e553932098c8a957578741b0bda056b030dd78640e1f467
blind: true
started_at: 2026-11-07T03:18:39.310Z
finished_at: 2026-11-07T03:33:03.756Z
duration_s: 281
tool_calls:
  run_command: 32
  project_reads: 43
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 5
  minor: 0
  nit: 0
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
session_id: 01a1b403-f1ae-7df2-9cb3-2ca755a78051
---

# 代码审查：VSCode插件Phase3

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261107T031826Z` ｜ 第 4 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

补丁 SHA-256 与 HEAD 均符合任务书。类型检查、生成的 Webview 脚本语法检查通过，八份相关单测经内存转译执行为 64/64 通过。零意见首写与无表头重建已修复，但额外内存复现确认仍存在两处保存时序问题和三处裁决表修复问题，需修改后重审。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：重要 5）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:218-242` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：恢复前仍仅比较快照对象身份，没有检查通知出现后的磁盘修改或文档继续编辑。外部写入不会改变 snapshots 中的对象，因此点击恢复会覆盖后续磁盘内容，并通过 revert 丢弃后续未保存编辑。上一轮本侧 CODEX-01 尚未解决；这不是检查与写回之间的短暂竞态，而是整个通知等待期间都没有冲突检查。

**依据**：实际读取 saveGuard.ts 的 onDidSave/restore。本轮执行 node -e，内存转译实际源码并注入文件系统及通知桩：保存前 A、保存后 B，通知等待期间磁盘变为 EXTERNAL-C、文档版本递增并置 dirty；点击恢复后输出 RESTORE_AFTER_EXTERNAL_CHANGE A。未发生真实文件写入。

**建议**：记录保存完成后的磁盘基线与文档版本，恢复前核对；出现后续修改时取消旧恢复或提供明确的冲突处理，避免直接覆盖。补充外部修改和继续编辑的时序测试。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:153-161,178-180` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：保存代次只在下一次 will-save 开始时递增，did-save 没有关闭当前代次。共享保存预算耗尽、保存先完成而读取随后返回时，迟到读取仍可通过代次检查并发布快照；本次没有恢复通知，该快照还可能被后续保存误用。上一轮本侧 CODEX-03 的关键时序仍未处理。

**依据**：实际读取的 extension/node_modules/@types/vscode/index.d.ts:14533-14544 声明所有监听器共享 1.5 秒预算。本轮执行 node -e 内存时序桩，在实际 SaveGuard 中依次触发 will-save、did-save，再于自身读取超时之前释放读取，输出 READ_AFTER_DID_SAVE {"snapshots":1,"prompts":0,"saveSeq":1}。

**建议**：在 did-save 时关闭对应保存代次的快照接收窗口，丢弃已经完成保存的迟到读取；新保存开始时隔离旧快照，清理也须限定代次。覆盖共享预算耗尽后的事件顺序。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:315-325` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：新增行虽然已按原列映射生成，但插入位置仍假定编号位于第一列，或对齐行必须以“| :---”开头。合法表格若将编号放在第二列并使用普通“| ---”对齐行，lastTable 保持 -1，新裁决行会插到 front-matter 之前，破坏原有合法文件且新增编号仍未被解析。

**依据**：实际读取 src/trivium/disposition.ts，其支持任意列序及普通 Markdown 对齐行。本轮执行 node -e 调用实际 parseDispositionDoc、appendRowByColumns、renderRepaired，再用编排器 parseDisposition 解析。REORDERED_APPEND 输出修复前编号为 ["CODEX-01"]，修复后首行为新增数据行、frontMatter=null，编号仍只有 ["CODEX-01"]。

**建议**：使用已解析表格的边界和行锚定位追加位置，并在删行、换表头后正确更新位置；不要重新用第一列正则猜测。补充重排列序与普通对齐行组合的回归用例。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:254-262` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：既有裁决表没有落点列时，missing_action 修复无法生效：表单允许用户填写落点，但 setCol 遇到 actionAt=null 就静默返回，生成内容丢失该输入。合法三列表中的结构化接受项因此会反复回到同一个 missing_action 缺口。

**依据**：实际读取 cockpit.ts 的 renderDeskDraft、dispositionDraft.ts 的 replaceRowInPlace，以及 gate.ts 的 checkRow。本轮执行 node -e 调用实际 renderDeskDraft，为三列表中的 CODEX-01 接受项填写“src/a.ts 补校验”，再经编排器解析，MISSING_ACTION_REPAIR 输出 [{"id":"CODEX-01","action":""}]。

**建议**：需要写入落点而原表无对应列时，为整张表一致地增加落点列，保留既有行和额外列。补充缺落点列的修复到编排器解析验证。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:991-998` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：unparsable_table 不一定表示表头不可识别，也可能只是所有行的裁决词无效。当前分支先按原表列序修复数据行，再无条件换成标准六列表头，却不转换数据行。原三列、四列或重排列序的表修复后仍字段错位，无法结束修复循环。

**依据**：实际读取 gate.ts：parsed.rows 为空且存在期望意见时即产生 unparsable_table。本轮执行 node -e，对实际 renderDeskDraft 输入四列表“意见编号/裁决/理由/落点”、裁决词为“错字”的 CODEX-01，提交修复为驳回。UNPARSABLE_SHORT_REPAIR 输出 rows=[]，编排器报告该行裁决为空；生成件为六列表头配四列数据。

**建议**：区分表头结构损坏与数据行无法解析。原表头可用时保留其结构；确需标准化表头时，同步转换全部保留行、修复行及新增行，并替换原对齐行。

## 认为正确的部分

- 零意见首写现已允许生成空裁决表；本轮调用实际 validateDesk 验证通过。
- 无可识别表头的重建分支现已包含用户提交的裁决行；本轮通过编排器解析验证编号及 front-matter 均可读取。
- 关闭旧恢复通知时已按快照对象身份清理，避免无条件删除较新快照。
- 审批动作通过宿主参数数组调用 CLI，abandon 显式限定阶段；预设使用双 memento 且不包含主题和正文。
- 保存快照继续保留原始字节与权限，状态读取失败采用保守锁闭。

## 未覆盖范围（本侧盲区）

- 未启动真实 VS Code Extension Host；时序复现使用实际源码内存转译和依赖桩，不能替代真实宿主验证。
- 未运行会构建或写入夹具的完整 check、集成测试及 test/real 真实 gate 流程；64 个单测通过内存转译执行。
- 未验证 Windows、最低支持 VS Code 版本、真实子进程超时收尾及真实磁盘恢复权限。
- 未重新计算工作树 tree 指纹；已核对补丁 SHA-256 与 HEAD，未逐项覆盖全部新增测试和交互。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T031826Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r2-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-codex.md`
- `extension/package.json`
- `extension/tsconfig.json`
- `extension/esbuild.mjs`
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

> 编排器从工具轨迹中记录到的读取次数：{"run_command":32,"project_reads":43}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
