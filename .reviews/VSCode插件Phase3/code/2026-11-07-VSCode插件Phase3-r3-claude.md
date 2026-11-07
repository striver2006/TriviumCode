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
run_id: 20261107T024822Z
rerun_index: 3
snapshot_hash: sha256:bb43732727b1294b8eaad9452d01393d1bd2ea43e3f53a57a8c4e59105543a26
blind: true
started_at: 2026-11-07T02:48:35.099Z
finished_at: 2026-11-07T03:00:01.450Z
duration_s: 686
tool_calls:
  read: 52
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 38
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 6
  minor: 2
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
session_id: 1b9667cb-7b75-4333-bbfc-99dd0d22581b
---

# 代码审查：VSCode插件Phase3

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261107T024822Z` ｜ 第 3 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。

## 总判断

最危险的是无表头修复分支丢弃全部表单行：missing_findings 写不回，自动 gate 闭环必然反复。
另有 unparsable_table 删除错位、零意见首写被禁、fallback 口径分叉、预览后编辑未失效等核心问题。
保存恢复与裁决写回也存在检查后竞争窗口，可能覆盖更新的内容。
上述问题触及 FR-8/FR-10 主链路且需修改后重新评审，故不通过。
本侧仅做静态审查，未运行测试。

**结论**：不通过（`reject`）

## 审查意见（共 9 条：阻断 1 ｜ 重要 6 ｜ 次要 2）

### CLAUDE-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:972` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：surgery=null（找不到合法表头）的修复分支完全不消费本次表单结果。虽然前面已计算 replaceRows、appendLines 和 removedIds，但该分支只生成 front-matter、空表头并拼接原文；missing_findings 的新行、待修复行和删除操作全部丢失，落盘后的自动 gate 复核会继续报同一缺口，无法形成修复闭环。

**依据**：extension/src/ui/cockpit.ts:951-989 显示 v.rows 只在后续 sg 非空路径进入 renderRepaired，!sg 分支在 972-979 行提前返回且未使用这些行。src/trivium/disposition.ts:181-188 说明找不到表头正是 unparsable_table 的来源。extension/test/unit/gateGapModel.test.ts:192-227 只验证缺口分类，没有覆盖渲染落盘；extension/test/real/dispositionGate.test.ts:19-62 也只核输出形状。

**建议**：为 surgery=null 单列真正的结构重建路径，把当前表单的新增、修复和删除语义全部生成进新表，并明确处理原损坏表格；始终写回 dispositionPath。补无表头且带 missing_findings 的落盘后真实 gate 对拍。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:286` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：unparsable_table 与 unknown_findings 同时出现时，删除行会错位。removeAt 按原 lines 的下标计算，随后 newHeaderLines 用两行替换原一行表头，之后却仍按旧下标过滤，导致目标 unknown 行保留、其前一行被误删。

**依据**：extension/src/disposition/dispositionDraft.ts:273-294 先在原数组上计算 removeAt，再在 287-289 行插入额外表头行，最后在 293 行按旧下标过滤。extension/src/ui/cockpit.ts:981-988 在 unparsable_table 时必传 newHeaderLines，并同时传入 removeIds。现有 extension/test/unit/dispositionDraft.test.ts:186-222 的删除用例令 newHeaderLines=null，未覆盖该组合。

**建议**：先完成删除再做表头替换，或在插入新表头后重算行号映射；不要混用两套下标。增加 unparsable_table+unknown_findings 的组合测试，并断言没有误删合法行。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:914` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：零意见的首写轮次仍被禁止生成裁决件。draft 下 items 与 removedIds 都为空时 structuralRepair 必为 false，validateDesk 因 hasContent=false 拒绝预览；但编排器明确允许 expectedCount=0 的空表，同时 missing_disposition 仍要求该件存在。

**依据**：extension/src/ui/cockpit.ts:914-918 只对 repair 放行纯结构内容。src/trivium/gate.ts:353-382 要求缺件时产出裁决件，579-590 明确 expectedCount=0 时空表合法。extension/src/disposition/dispositionDraft.ts:94-113 本身能够渲染 rows=[] 的完整文档，因此阻断点在宿主校验。

**建议**：在首写期望集确实为空时允许生成带表头的零行裁决件，并与元数据缺失、无法知道期望集的情形区分。补零意见 missing_disposition 的预览、落盘和真实 gate 闭环用例。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/runMeta.ts:139` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：fallback 期望集与 gate 的实际重读口径不一致。插件只按 run 元数据 status 非 ok 就读取 F 编号；gate 会用当前解析器重试 parse_fallback 原文，重试成功时改用结构化编号且不再要求 F 行。此时插件额外生成的 F 行会被 gate 判为 unknown_findings。 failed 等状态也被插件纳入，进一步放大口径差。

**依据**：extension/src/disposition/runMeta.ts:139-147 仅跳过 status=ok，没有处理重试成功，也没有限定 parse_fallback。src/trivium/gate.ts:1382-1408 显示重试完全成功时走结构化结论，只有仍失败或部分合格才读取 fallback-items；1423-1439 显示 failed 侧不进入该期望集。extension/test/unit/runMeta.test.ts:91-103 只覆盖两个 parse_fallback 侧，未覆盖重试成功或 failed。

**建议**：不要把 run 状态直接当作 F 期望集的充分条件；以 gate 实际重读结果为权威，必要时由 CLI 提供首写也可读的权威期望集，避免插件复制解析器。至少补重试成功、部分合格和 failed 侧的差分用例。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:555` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：预览后的表单编辑不会使预览失效。裁决选择、理由和落点控件没有 oninput/onchange 回传，保存按钮也不会被禁用；用户预览后继续修改，再点落盘，宿主仍写入旧预览。宿主 hash 只能发现它已经收到的 desk-update，无法覆盖这条真实 UI 路径。

**依据**：extension/src/ui/cockpitHtml.ts:555-585 只给删除复选框注册变化事件；619-622 行只有预览时 collectDesk，保存时仅发 desk-save。extension/src/ui/cockpit.ts:405-417 的失效逻辑完全依赖 desk-update，941 行的预览文本则一直保留到下一次更新。计划 .reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:102-105 要求预览确认后落盘且表单变更须重新确认。

**建议**：给所有行控件接上统一变更通知，变更时同步 desk-update、清除确认状态并禁用落盘；保存前宿主再复核。用真实 Webview 交互覆盖预览后编辑，不能只直调宿主消息。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:183` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：恢复前的对象身份检查与真正写回之间仍存在竞态。检查通过后 restore 异步写临时文件、chmod、rename；此间若用户再次保存，旧快照仍可覆盖较新的保存，且 snapshots.delete 无条件执行。savedAt 只写不读，不能封住这个窗口。

**依据**：extension/src/guard/saveGuard.ts:181-185 在 await restore 前只做一次身份比较，206-219 的 restore 没有代次复核或串行化。第二次保存可在任一 await 后发生。extension/test/integration/saveGuard.test.ts:93-120 只有单次保存和立即恢复，没有恢复中再次保存的故障注入。

**建议**：按文档串行化保存恢复，维护显式保存代次，并在原子替换前再次确认快照仍是当前代次；过期恢复应放弃并提示。补 restore 写临时文件期间发生第二次保存的测试。

### CLAUDE-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:350` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：裁决件的 hash 防并发覆盖仍是检查后写（TOCTOU）。当前内容比对通过后，外部写入者仍可在 replaceExclusive 的临时文件写入与 rename 之前修改目标，随后被原子 rename 覆盖。原子替换只保证不半写，不保证比较与替换不可分割。

**依据**：extension/src/disposition/dispositionDraft.ts:350-360 先 readFile/hash，再 await replaceExclusive；extension/src/ui/cockpit.ts:1024-1028 的 replaceExclusive 由 writeFile 与 rename 两个异步步骤组成，期间没有复核。extension/README.md:44-45 将这一机制直接表述为「载入 hash 防并发覆盖」。

**建议**：明确这只是冲突检测而非完全防覆盖；用协作锁或在替换前再次核对当前内容以缩小窗口，并对无法消除的竞态如实标注。补 hash 比对后、rename 前发生外部修改的故障注入。

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:154` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：快照读取失败或超时时，警示文案仍承诺「可一键恢复」，但实际没有恢复入口。新文件、读取失败和超时路径会删除快照，onDidSave 随即直接返回，用户得到的是误导性承诺。

**依据**：extension/src/guard/saveGuard.ts:154-162 在 catch 删除快照后仍统一发送含「可一键恢复到保存前」的消息；167-169 行无快照即返回，不显示恢复按钮。模块头 18 行也明确此时应放弃恢复。

**建议**：按是否获得可靠快照分流文案：无快照时只警示保存风险并明确「本次无法提供恢复」，不要显示可恢复承诺；补读取失败与超时用例。

### CLAUDE-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/test/real/dispositionGate.test.ts:19` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：真实对拍没有验证插件生成的裁决件能否通过真实 gate，偏离了已批准计划的关键验收设计。当前测试只核输出字段形状，第二个用例在无 JSON 时还会直接成功返回，因此本轮无表头、空表和 fallback 口径问题都不会被它发现。

**依据**：.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md:166 要求生成草稿到临时主题并跑真实 gate 断言通过；extension/test/real/dispositionGate.test.ts:19-49 只逐字段核形状，52-62 行不构造草稿且 !r.json 直接 return。文件头 5-7 行也承认改成了输出契约对拍。

**建议**：在隔离的临时 Git 夹具仓和临时主题中生成草稿并直调真实 gate，至少覆盖正常首写、零意见、无表头修复和 fallback 重读形态；无 JSON 应失败而不是跳过。若坚持缩小范围，应回写计划并说明替代验收。

## 认为正确的部分

- approve/reject/abandon 的 argv 形状与 CLI 契约一致，拒绝理由非空拦截、abandon 显式 --stage、审批动作防重入均已接线。
- 闸门缓存键包含 runId，拉取有 epoch 与状态复核；审批结果及权威摘要移到独立区域，不再被 gateArea 刷新直接清空。
- state.json 的 ENOENT 与其它读取失败已分流，非法 JSON 根值进入 unreadable 保守红灯。
- front-matter 改用 YAML 序列化，文件名轮次优先采用 gate.rerun_index，runMeta 根形状防御也已补齐。
- 保存快照同步注册 waitUntil，使用原始字节与 mode，并有 1.2 秒超时和快照身份检查，较上一轮明显加固。
- 预设使用 globalState/workspaceState，主题与正文不入库；名称输入和删除确认均移到宿主侧。
- unknown_findings 已有删除语义，正常修复路径保留合法行与表外正文，落盘也已绑定已确认预览文本。

## 未覆盖范围（本侧盲区）

- 本侧没有执行任何命令，未运行 extension 的 typecheck、compile、单元、集成或 real 测试；竞态与 UI 结论均按代码事件链推理，未实测。
- 未在真实 Webview DOM 中验证渲染、预览后编辑、按钮交互及 modal/toast 时序。
- 未覆盖真实四家 Driver、真实三审主题和真实 CLI 输出复跑。
- Windows、多根工作区、非 UTF-8 文件、符号链接与文件权限边界未验证。
- Phase 2 既有功能只检查本次改动触及的调用链，未做完整回归审查。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T024822Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-claude.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r2-claude.md`
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
- `extension/src/env/config.ts`
- `extension/src/env/health.ts`
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
- `extension/test/real/suite.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/test/unit/gateAreaModel.test.ts`
- `extension/test/unit/gateGapModel.test.ts`
- `extension/test/unit/lampModel.test.ts`
- `extension/test/unit/presetModel.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/unit/stateModel.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`
- `src/trivium/review.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":52,"grep":7,"glob":0,"run_command":0,"project_reads":38}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
