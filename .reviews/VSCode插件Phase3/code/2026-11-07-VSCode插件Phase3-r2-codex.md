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
run_id: 20261107T021820Z
rerun_index: 2
snapshot_hash: sha256:030fcc19e06b4f4fedb64e8f681f6d4b810c2ebc50c66e2999a5796e7ed174e9
blind: true
started_at: 2026-11-07T02:18:33.413Z
finished_at: 2026-11-07T02:32:52.389Z
duration_s: 346
tool_calls:
  run_command: 27
  project_reads: 50
evidence_ok: true
verdict: reject
findings_count:
  blocker: 2
  major: 7
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
session_id: 01a1b3cc-eba8-71e0-a169-512a55e4540b
---

# 代码审查：VSCode插件Phase3

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261107T021820Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

补丁哈希与 HEAD 均与任务书一致。类型检查通过，八份相关单测经内存转译执行，64/64 通过。但本轮复现了两处导致整个 Webview 无法执行的语法错误，以及裁决无法落盘、过期快照覆盖、异步状态回退和修复契约破坏等问题，需要修改后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 10 条：阻断 2 ｜ 重要 7 ｜ 次要 1）

### CODEX-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:551-588` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：renderDesk 的同一循环作用域重复声明 tdR、ta、tdA、taA，生成的 JavaScript 在解析阶段即失败。整个驾驶舱脚本都不会执行，既有装配、监控与新增审批功能一起失效。

**依据**：本轮执行 node -e 内存脚本，用 TypeScript transpileModule 加载实际 cockpitHtml，再将生成的 script 交给 new vm.Script，得到 WEBVIEW_PARSE_FAILED：Identifier 'tdR' has already been declared。另执行 node extension/node_modules/typescript/bin/tsc -p extension/tsconfig.json --noEmit，通过，说明类型检查没有覆盖模板内的 JavaScript。

**建议**：消除重复声明并正确复用输入控件；增加对实际生成脚本的解析检查和 Webview 启动验证。

### CODEX-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:613` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：addresses 文本框的 join 分隔符没有经过外层模板字符串所需的转义，生成结果在单引号字符串中包含实际换行。即使修复重复声明，整个 Webview 仍然无法解析。

**依据**：本轮执行 node -e，仅在内存中移除重复声明块后重新生成 HTML，再调用 new vm.Script，得到 SECOND_PARSE_FAILURE：Invalid or unexpected token，定位在 addrTa.value = addrList.join 的字符串换行处。仓库文件没有修改。

**建议**：修正嵌套 JavaScript 字符串的转义，并以最终 HTML 中的脚本作为检查对象。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:623,630-647; extension/src/ui/cockpit.ts:405-414` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：落盘按钮先调用 collectDesk，发送 desk-update，再发送 desk-save；宿主收到任何 desk-update 都无条件清空 confirmedPreview，即使内容完全没变。因此正常点击落盘必然被拒绝，重新预览也无法突破这个循环。

**依据**：本轮执行 node -e 内存转译桩，调用实际 Cockpit.previewDesk，再按按钮顺序发送内容相同的 desk-update、desk-save。输出 PREVIEW_CREATED=true，随后 SAVE_AFTER_COLLECT 返回“请先生成预览并确认”。extension/test/integration/dispositionDesk.test.ts 直接按 update→preview→save 调宿主，漏掉真实保存按钮额外发送的 update。

**建议**：只在表单实际变化时使预览失效，保存操作直接提交已确认的预览；补充与真实按钮一致的消息序列验证。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:142-164` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：快照读取虽然已注册 waitUntil，但没有超时失效机制。共享保存预算耗尽后，保存可能先完成，迟到读取仍会写入快照表；该次保存没有恢复按钮，迟到快照还可能污染后续保存。上轮接受的“读取超时放弃恢复”尚未实现。

**依据**：本地 extension/node_modules/@types/vscode/index.d.ts:14540-14544 明确说明共享 1.5 秒预算及失常监听器停用规则。本轮执行 node -e，注入延迟 readFile，模拟保存完成先于读取返回，实际 SaveGuard 输出 AFTER_SAVE_BUDGET_EXPIRED：restorePrompts=0、pendingSnapshots=1。源码只有读取异常处理，没有超时或保存代次校验。

**建议**：为每次保存建立代次和有效期；预算不足、保存已经完成或读取超时时丢弃迟到结果，明确提示本次无法恢复，并验证慢 I/O 时序。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:162-208` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：恢复通知闭包保留旧 snap，却不核对它是否仍是当前快照，也不检查文档或磁盘是否已再次变化。连续保存后点击旧通知，会覆盖后续保存内容，并删除最新快照；关闭旧通知同样会清除新快照。

**依据**：本轮执行 node -e，使用实际 SaveGuard 和内存文件系统，依次模拟 A→B、B→C 两次保存，再点击第一次通知的恢复按钮。输出 STALE_RESTORE_AFTER_TWO_SAVES：disk='A'、pendingSnapshots=0，后续已保存的 B、C 被旧通知覆盖。计划 r2 第六节明确将连续保存竞争列为需处理的风险。

**建议**：通知绑定保存代次；恢复或清理前核对快照身份、文档版本及当前磁盘内容。旧通知应失效，检测到后续编辑或外部修改时拒绝直接覆盖。

### CODEX-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:638-653` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：异步 gate 返回只核对 runId，没有核对状态或请求代次。同一 run 从裁决等待迁移到人工审批时，迟到的 raf 请求仍能覆盖新 aa 缓存并重新推送旧卡片，使审批按钮消失、旧缺口重新出现。

**依据**：本轮执行 node -e 内存转译桩，对实际 pushGateArea 制造同 run 的 raf、aa 两个请求，先完成 aa，再完成 raf。输出 LATE_RAF_RESULT：current='awaiting_approval'、rendered='raf'、cachedFailures=['missing_disposition']、cachedHint=null。当前 stillCurrent 条件不比较 state。

**建议**：以状态和刷新代次约束请求结果；在所有异步等待后确认仍为最新请求，再写缓存或发布整组卡片。覆盖 raf→aa 的乱序返回。

### CODEX-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:915-933; extension/src/disposition/dispositionDraft.ts:173-200` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：修复保留原表头，却把所有被修复行强制输出为固定六列顺序。编排器支持三列最小表和任意列顺序，这些合法既有件修复后会发生字段错位，原本仅缺理由的行会变成无法识别裁决的行。

**依据**：src/trivium/disposition.ts 明确按表头映射列，并支持至少编号、裁决、理由三列。本轮执行 node -e，向实际 renderDeskDraft 输入四列表“意见编号/裁决/理由/落点”，仅补 empty_reason；再次解析结果 SHORT_HEADER_REPAIR 为 verdict=null、reason=''、action='接受'。

**建议**：解析时保留原列映射，按原表头生成替换及新增单元格；需要统一表结构时，应同时转换整张表并保留额外列。

### CODEX-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:286-288` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：bad_front_matter 修复只替换已经存在且闭合的 front-matter。文件完全缺少文件头或文件头未闭合时，正则不匹配，所谓重建实际没有任何效果，自动复核后会永久回到同一个缺口。

**依据**：本轮执行 node -e，向实际修复链输入没有 front-matter、但有合法裁决表的文档。MISSING_FM_REPAIR 输出 valid=true、hasFrontMatter=false、same=true。src/trivium/disposition.ts 将缺失或未闭合文件头都作为错误报告。

**建议**：分别处理有效头替换、无头前置和未闭合头修复，保留原正文；验证这些形态修复后确实产生可解析的七字段文件头。

### CODEX-09 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:878-882` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：零意见首写仍被 hasContent 拦截。所有审核者均无待裁意见时，用户无法创建闸门要求的合法空裁决件。上轮 CODEX-07 已接受并明确承诺覆盖该场景，本轮只放开了修复模式。

**依据**：本轮执行 node -e，构造 missing_disposition、全部编号集为空、Driver 与 addresses 有效的首写模型，实际 validateDesk 返回 ZERO_FINDINGS_DRAFT：ok=false、“没有可生成的内容”。src/trivium/gate.ts:575-590 明确允许期望意见数为零时使用空表；Driver 应答第 47 行接受了该修复要求。

**建议**：允许已确认期望意见数为零的首写生成合法空表，并补充首写到真实 gate 校验的闭环用例。

### CODEX-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:720-743` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：预设选择后仍立即清空下拉值，删除按钮仍只从下拉读取目标，因此用户正常选择后始终无法删除预设。上轮 CODEX-10 已接受，但对应代码没有修复，也没有加入承诺的删除确认。

**依据**：源码推理：第 726 行在发送 preset-load 后将 value 清空，第 739-740 行随即会因空值拒绝删除。实际读取的 Driver 应答第 50 行承诺“加载后保留当前选择；删除按当前选中 + confirm”。extension/test/integration/presets.test.ts 直接发送 preset-delete，绕过了选择与删除交互。

**建议**：保留选中项或独立保存删除目标，加入删除确认，并验证从下拉选择到点击删除的完整交互。

## 认为正确的部分

- 保存快照改用原始 Buffer 并记录 mode，解决了此前固定 UTF-8 往返及执行位丢失的问题。
- StateWatch 已将非文件不存在类读取错误发布为 unreadable，保存防护据此保守锁闭。
- 审批结果移到独立 gateResult 区，避免随闸门列表刷新被立即清除。
- 审批动作通过宿主参数数组直达 CLI，abandon 显式限定 stage；Driver 优先读取本轮 run 元数据，预设使用双 memento 且不包含主题和正文。

## 未覆盖范围（本侧盲区）

- 未启动真实 VS Code Extension Host。运行复现使用实际源码的内存转译、注入依赖和消息时序桩，不能替代真实宿主验收。
- 未运行会构建或写入夹具的 npm run check、集成测试和真实 gate 流程；64 个单测是在内存转译后执行。
- 未进行 Windows、最低支持 VS Code 版本、真实子进程超时、文件权限及非 UTF-8 文件的磁盘恢复验证。
- 未覆盖全部新增测试及所有驾驶舱交互。test/real/dispositionGate.test.ts 当前只检查真实输出形状，没有执行批准计划要求的生成裁决件与真实 gate 的端到端对拍。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T021820Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-response-glm.md`
- `extension/package.json`
- `extension/tsconfig.json`
- `extension/esbuild.mjs`
- `extension/src/extension.ts`
- `extension/src/services.ts`
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
- `extension/test/unit/worktreeSummary.test.ts`
- `extension/test/unit/stateModel.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":27,"project_reads":50}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
