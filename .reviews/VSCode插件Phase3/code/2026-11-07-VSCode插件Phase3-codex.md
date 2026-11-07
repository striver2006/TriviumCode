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
run_id: 20261107T014536Z
rerun_index: 1
snapshot_hash: sha256:99a09d60c841f74a490fca513165866358fadca1867f523422d100b4eb995207
blind: true
started_at: 2026-11-07T01:46:36.588Z
finished_at: 2026-11-07T02:03:53.874Z
duration_s: 586
tool_calls:
  run_command: 26
  project_reads: 52
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 9
  minor: 1
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
session_id: 01a1b3af-b55d-74b1-9425-8c1aa6515497
---

# 代码审查：VSCode插件Phase3

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261107T014536Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

补丁哈希与任务书一致，HEAD 一致。类型检查通过；新增七份单测经内存转译逐条执行，50/50 通过。但保存恢复、裁决修复和审批展示存在可复现缺陷，涉及恢复失效、内容损坏及跨轮次信息混用，需修复后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 10 条：重要 9 ｜ 次要 1）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:66,128-148` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：快照读取没有通过 waitUntil 注册，实际保存可以先于读取完成。首次保存时 onDidSave 找不到快照便直接返回，随后只有不带恢复按钮的警告；读取还可能取得保存后的内容，使恢复基线失真。

**依据**：源码第 66 行丢弃 onWillSave 的 Promise；本地 @types/vscode/index.d.ts:13543-13549 明确提供等待异步工作的重载。本轮执行 node -e 内存转译时序桩，先触发 did-save、再完成读取，输出 SAVE_RACE：waitUntilCalled=false、restorePromptCount=0、pendingSnapshots=1。extension/test/integration/saveGuard.test.ts 使用 silentUi 和 restoreForTest，未验证真实按钮是否出现。

**建议**：在事件分发期间注册有时间上限的快照读取，并将快照与本次保存绑定；超时或读取失败时明确禁用恢复，避免发布错误基线。增加读取延迟超过保存完成的时序用例。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:132,183-191` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：快照和恢复固定使用 UTF-8。保存 UTF-16、GBK 等编码的文本后点击恢复，会把原始字节错误解码再编码，造成文件损坏；同步回编辑器的内容也来自错误解码结果。

**依据**：saveGuard.ts 使用 readFile(path,'utf8') 和 writeFile(tmp,content,'utf8')，没有保存编码信息。本轮 node -e 内存验证同样的转换：UTF-16LE 字节 fffe61000a00 经该路径变为 efbfbdefbfbd61000a00。本地 @types/vscode/index.d.ts 的文本编码声明包含 utf16le、utf16be 等编码。

**建议**：磁盘恢复基线保存为原始 Buffer，按字节恢复；编辑器同步应使用文档实际编码或宿主提供的对应机制。增加非 UTF-8 文件的恢复验证。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:179-184` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：恢复通过新建临时文件再 rename 覆盖原文件，却没有保留原文件权限。macOS 上恢复可执行脚本会清除执行位，导致脚本无法直接运行，并产生额外的 Git 模式漂移。

**依据**：源码推理：saveGuard.ts:183 创建临时文件时没有 mode，随后直接替换目标；整个快照结构也未记录原权限。新文件的默认权限不含执行位，因此原目标的 0755 无法保留。本轮未执行磁盘写入复现。

**建议**：读取快照时记录目标文件权限，原子替换前恢复相应权限；增加可执行业务文件恢复后内容与模式均保持一致的测试。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/stateWatch.ts:38-46` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：state.json 因权限或 I/O 错误不可读时直接静默返回，不会发布 unreadable 状态。启动时遇到 EACCES，SaveGuard 会一直保持默认绿灯，业务保存完全没有防护，与 README 的保守锁闭承诺冲突。

**依据**：stateWatch.ts 只有不存在错误进入正常空快照，其他错误均 return；saveGuard.ts 默认 unreadable=false、activeStates=[]。本轮 node -e 注入 EACCES 调用 StateWatch.rescan，输出 STATE_EACCES：notifications=0。extension/README.md 明确承诺 state.json 不可读时锁闭处理。

**建议**：非不存在类读取错误应发布 unreadable=true，并展示错误原因；保留可用的既有闸门信息，避免将读取失败解释成运行结束。覆盖首次读取失败与绿灯后读取失败。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:599-618` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：gate 缓存只按 topic/stage 索引，闸门结束或进入新 run 时不失效。下一轮卡片会显示新 runId，却继续展示上一轮的计票、缺口、警告和工作树摘要，误导人工审批。

**依据**：源码仅在手动刷新和插件自身保存裁决后删除缓存，状态订阅没有按 runId 校验。已用 node -e 内存桩依次推送 r1、空闸门、r2，输出 GATE_CACHE：gateCalls=1、newCardRun=r2、cachedCheckRun=r1。

**建议**：缓存绑定 runId 和相关状态，运行切换及 raf→aa 时重新读取；异步返回后核对当前运行身份，丢弃旧请求结果。增加同主题连续两轮的回归用例。

### CODEX-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/gateGapModel.ts:198-200; extension/src/ui/cockpit.ts:774-798` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：unknown_findings 被当成普通裁决行展示，但 UI 没有删除操作，保存时又必然把它写回。用户无论选接受、驳回还是暂缓，都无法消除这个缺口，修复回路会永久重复。

**依据**：gateGapModel.ts 将未知编号加入 items；cockpitHtml.ts 仅提供三种裁决，validateDesk 再将每个 item 加入输出 rows。src/trivium/gate.ts 的 unknown_findings 判断要求该编号从表中消失。本轮 node -e 桩中 CLAUDE-99 修复后仍出现在通过 UI 校验的 rows 内。

**建议**：将未知编号建模为明确的删除操作，确认后从输出表排除；删除不应要求填写裁决理由。覆盖仅删除未知行和删除与普通修复混合的场景。

### CODEX-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:800` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：生成要求至少一条可编辑行，导致仅有 front-matter 错误、所有裁决行均合法时无法修复，且错误列表为空。各侧均无意见、需要创建合法空裁决表时也会被同一条件阻断。

**依据**：buildGapModel 将已有合法行放入 readonlyRows；validateDesk 只遍历 items，并以 rows.length>0 判定成功。本轮 node -e 对 bad_front_matter 场景得到 HEADER_ONLY_REPAIR：editable=0、readonly=1、validation.ok=false、errors=[]。src/trivium/gate.ts 明确允许期望意见数为零时使用空表。

**建议**：按生成或修复任务是否有效判断提交条件，允许仅修复文件头和合法零意见表；结构重建时按期望集补齐需要编辑的行。增加上述两类闭环用例。

### CODEX-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:855-887; extension/src/disposition/dispositionDraft.ts:184-202` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：普通修复会重新生成整份文档并覆盖原文件，删除表格之外的人工正文；合法行的来源、严重度等字段也被丢弃后重写为占位符。对于包含完整方案的 revised 件，这会丢失实际交付内容，不符合只修问题行、保留合法行原文的设计。

**依据**：parseDispositionDoc 只保留编号、裁决、理由和落点，saveDesk 无条件使用 renderDisposition 重建全文，loadedText 仅用于 hash 比对。本轮 node -e 内存往返验证输出 REPAIR_PRESERVATION：bodyRetained=false、originalValidLineRetained=false。批准计划 r2 §D1 要求合法行保留原文。

**建议**：普通修复基于原文定位并修改目标行，保留其余正文及合法行原始文本；整体重建应作为明确的独立操作展示内容损失。增加包含正文、额外列和合法行的保真测试。

### CODEX-09 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:415-418,488-502` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：审批结果和权威工作树摘要被放在 gateArea 内，而每次状态刷新都会清空整个 gateArea。handleApprove 发布结果后立即 rescan，因此正常成功路径会随即清除摘要，用户无法稳定查看批准后的权威信息。

**依据**：cockpit.ts 的 handleApprove 在发送含 authoritative 的 gate-action 后调用 stateWatch.rescan；订阅随后发送 gate-area。cockpitHtml.ts 的 renderGateArea 首句清空容器。本轮 node -e 执行实际生成的 Webview 脚本并注入 DOM 桩，输出 AUTH_RESULT_REFRESH：childrenBefore=1、childrenAfter=0。

**建议**：审批结果使用独立且持久的展示区域，或保存结果模型后随状态刷新重新渲染；覆盖批准成功后闸门消失、摘要仍可见的消息序列。

### CODEX-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:681-704` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：选择预设后 onchange 立即把下拉框清空，删除按钮又只从该下拉框读取目标。因此正常操作中始终无法删除预设，只会收到“请先选中”的提示。

**依据**：第 687 行在加载请求后清空 presetSel.value，第 700-701 行据此拒绝删除。本轮 node -e 执行生成的 Webview 脚本，依次选择预设并点击删除，PRESET_DELETE 输出只有 ready、preset-load，没有 preset-delete。现有 presets 集成测试直接调用宿主消息，绕过了此交互。

**建议**：保留当前选择或单独保存删除目标，并按计划加入删除确认；增加从下拉选择到点击删除的渲染层测试。

## 认为正确的部分

- 审批和放弃通过宿主直接调用 CLI，参数数组透传；abandon 显式限定 stage，方向正确。
- Driver 优先读取本轮 run 元数据，首写 fallback 编号从清单派生，避免使用错误的状态残留值。
- 预设采用 workspaceState/globalState，并剔除 topic/body，符合不污染仓库配置的约束。
- 明确说明 VS Code 保存 API 的能力边界，并把警示与恢复作为交付承诺，是合理的设计调整。

## 未覆盖范围（本侧盲区）

- 未启动真实 VS Code Extension Host；时序和渲染复现使用 node -e 内存转译及注入桩，不能替代真实宿主验收。
- 未执行会构建或写夹具的 npm run check、集成测试和真实 gate 流程。新增七份单测的 50 个测试函数是在内存中执行，并非完整官方测试流水线。
- test/real/dispositionGate.test.ts 已将计划中的“生成草稿交给真实 gate 校验”缩减为输出字段对拍；本轮未验证生成件与真实 gate 的端到端兼容性。
- 未进行 Windows、最低支持 VS Code 版本、真实进程超时收尾，以及文件权限恢复的磁盘验证。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T014536Z.diff`
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
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/integration/fakePresets.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/test/unit/gateAreaModel.test.ts`
- `extension/test/unit/gateGapModel.test.ts`
- `extension/test/unit/lampModel.test.ts`
- `extension/test/unit/presetModel.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/gate.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":26,"project_reads":52}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
