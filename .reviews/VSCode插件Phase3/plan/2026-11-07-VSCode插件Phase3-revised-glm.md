---
schema: trivium.disposition.v1
topic: VSCode插件Phase3
stage: plan
role: glm
kind: revised
run_id: 20261107T001957Z
addresses:
  - 2026-11-07-VSCode插件Phase3-claude.md
  - 2026-11-07-VSCode插件Phase3-gemini.md
  - 2026-11-07-VSCode插件Phase3-codex.md
---

# 计划审第 1/5 轮裁决（Driver：glm）

三侧结论：claude `pass-after-changes`（10 重要 + 2 次要）、gemini `pass-after-changes`（3 重要 + 3 次要）、codex `reject`（5 重要 + 1 条逐条降级）。共 **24 条：接受 24 ｜ 驳回 0 ｜ 暂缓 0**（两条含子建议取舍的已在理由栏写明采纳边界）。修订后的完整计划见同目录 `2026-11-07-VSCode插件Phase3-r2-glm.md`。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 成立：现有 activationEvents 只有 onView/onCommand，不开 UI 时护栏与灯都不会装配，FR-10 形同虚设 | r2 §D4-激活：activationEvents 增 `onStartupFinished`（工作区含 `.trivium/` 时启动即装配 saveGuard 与灯）；D9 增「不开任何视图直接保存」集成用例 |
| CLAUDE-02 | claude | major | 接受 | 成立：parseGates 现把 JSON 损坏当空闸门（schemaReason=null），最该保守时静默绿灯 | r2 §D4-状态面：stateModel 增 unreadable 通道（文件存在但解析失败≠文件不存在），unreadable→灯显「状态不可读」并按锁闭处理；补损坏 JSON/缺 gates/读失败三态灯测 |
| CLAUDE-03 | claude | major | 接受 | 前半成立并采纳：preset 写 `.vscode/settings.json` 确实在编排器快照排除集之外、与保存护栏自相矛盾——改用 `context.workspaceState`（不落仓库文件，根因消除）。其后半（删除 `.vscode/` 豁免）不采纳：该豁免来自任务书硬约束「拦截不得影响 VS Code 自身设置文件保存」，任务书优先；计划如实注明该目录下受跟踪文件的改动会被编排器快照捕获、属用户显式自担 | r2 §D5：workspace 作用域载体改 `context.workspaceState`（作用域语义不变：工作区级/用户级）；§D4 判定规则保留 `.vscode/` 放行并附风险注记 |
| CLAUDE-04 | claude | major | 接受 | 成立：GateEntry.driver 只留痕、同槽位重跑换 Driver 时残留旧值（state.ts:56-81 明写），编排器权威源是 run.json.driver | r2 §D6：定位链重排——① `_meta/run-<runId>.json`.driver（run 权威）② task.json drivers[stage]（受限 fallback，标注阶段声明语义）③ 闸门 driver 仅作展示不采信；补「同槽位换 Driver 残留」与「历史 run 回放」两测 |
| CLAUDE-05 | claude | major | 接受 | 成立：gate 对三档裁决统一要求非空理由（checkRow 不按裁决值豁免），接受项可空必然返工 | r2 §D1：三档理由全部必填非空，空洞词按 reason_policy 语义在 UI 呈现提示；补三档空理由负例 |
| CLAUDE-06 | claude | major | 接受 | 成立：joint_blocker_rejected 在 hard 策略下是真实 failure 且带 ids，漏组会让用户看不到阻断原因 | r2 §D1：缺口模型补 joint_blocker_rejected（hard→逐条修复组，warn→warnings 展示）；D9 补 hard/warn 双策略夹具 |
| CLAUDE-07 | claude | major | 接受 | 成立且关键：missing_disposition 提前返回时 fallbackIds 恒空、无 missing_findings，首写形态下差集公式全部误判 | r2 §D1：定义首写/修复两形态——首写待裁集 = structured_ids ∪ degraded_ids ∪ fallback 期望集（后者只读解析 `_meta/review-<c>-<runId>.fallback-items.md`，每行 `- <前缀>-F<n>: …`）；D9 集成夹具改用真实 missing_disposition 首写形态 |
| CLAUDE-08 | claude | major | 接受 | 成立：原公式把 empty_reason/defer_not_allowed/missing_action 的行误归只读，与修复表单自相矛盾 | r2 §D1：可编辑集 = 新增行（missing_findings.ids）∪ 修复行（empty_reason/defer_not_allowed/missing_action/unknown_findings/joint_blocker_rejected-hard 的 ids）；只读集 = 期望集 − 可编辑 − unknown（修复形态）；补「已有行但理由空/缺落点」模型测 |
| CLAUDE-09 | claude | major | 接受 | 成立：修复路径全部退回手工编辑，与 §6.3「无手工编辑」验收冲突 | r2 §D1：裁决台两模式——起草（O_EXCL 新建）与修复（读现有件进表单、保留合法行、预览后原子替换写回同一路径，写回前比对载入时内容 hash 防并发覆盖）；写例外语义扩展为「裁决件新建与经确认的写回」，均需预览确认 |
| CLAUDE-10 | claude | major | 接受 | 成立：ok:true 也可携带降级轮/未确证失守/addresses_unchecked 等关键警示，只看计票会误判信息完整 | r2 §D2：warnings 为闸门卡与裁决台的一等展示数据（与 failures 分区）；D9 补降级轮、readonly_breach_unconfirmed、joint warn 三展示用例 |
| CLAUDE-11 | claude | minor | 接受 | 成立：missing_action 只覆盖结构化行（checkRow 第二参数），fallback 接受项落点按契约可选 | r2 §D1：行级 requireAction 属性——结构化接受项必填落点、fallback 接受项可选；补两类对拍用例 |
| CLAUDE-12 | claude | minor | 接受 | 成立：round_verdict 在 bug 阶段/旧运行/无轮次链时为 null，直接渲染会空白或伪票 | r2 §D2：无计票形态降级文案「无计票信息（旧运行或 bug 阶段）」，不自行补算；D9 补 null 形态测 |
| AGY-01 | gemini | major | 接受 | 意见主体成立并采纳：TextEdit 还原会把缓冲区回退并标洁净（数据丢失风险）+ 自动保存 modal 轰炸 + reason 分流。其建议①的具体手法（「Promise 拒绝/抛异常中断保存流」）不采纳：VS Code 对 waitUntil rejection 行为无任何文档承诺，是不可依赖的未定义行为；且根因不止缓冲区——CODEX-01 的 1.5s 预算事实使「保存事件内等人」整体不可行，D4 已按此全节重设计 | r2 §D4 全节重写：废弃「保存事件内弹 modal + edits 还原」；新三段式=编辑期预警（红灯期业务文件被修改时 modal，去重）+ 保存瞬间警示（1.5s 预算内非阻塞 toast + 读盘快照）+ 保存后违规检测（一键恢复按钮，原子写回快照，缓冲区内容保留为未保存态）；reason 分流（AfterDelay/FocusOut 不弹编辑期以外的阻断） |
| AGY-02 | gemini | major | 接受 | 成立：EEXIST 拒写与「修复既有件缺口」需求 100% 互斥，且不合并已有合法行会造成整批 missing_findings | r2 §D1（同 CLAUDE-09 落点）：修复模式读现有件、表单保留合法行、完整输出新草稿、原子替换写回 |
| AGY-03 | gemini | major | 接受 | 成立：与 CLAUDE-04 同源，EV-68 已确立 run.json.driver 为权威 | r2 §D6（同 CLAUDE-04 落点） |
| AGY-04 | gemini | minor | 接受 | 成立：gate 的 expectedReviewDocs 明文「文件名取自 run.json.artifacts[]，不按日期现拼」，glob 推断在跨零点/撞名抬升下必错 | r2 §D1：addresses 直接读 `_meta/run-<runId>.json`.artifacts[] 派生（阶段根+非裁决件+有效侧后缀筛选，只读派生非校验复制，正确性由 gate 兜底）；D9 补跨零点与单侧抬升夹具 |
| AGY-05 | gemini | minor | 接受 | 成立：编排器摘要有 diffExcludePrefixes 排除，插件不过滤会把每轮审查工件当业务改动误报 | r2 §D3：提示性摘要按同语义过滤 `.reviews/`、`.trivium/`、`.git/` 前缀（展示层过滤，注释注明对齐来源） |
| AGY-06 | gemini | minor | 接受 | 成立：FormState 里的 topic/body 是会话瞬态、ctxPaths 工作区绑定，全量进 preset 跨仓加载必然冲刷失效；任务书原文的 preset 面本就只是「装配参数」 | r2 §D5：preset 分层——只存 driver/critics/entry/maxRounds/profile/extraFlags（+可选 ctxPaths，跨仓加载时校验存在性、失效项标注跳过）；topic/body 不进 preset；加载不覆盖用户正在输入的正文 |
| CODEX-01 | codex | major | 接受 | 成立且击穿原方案：waitUntil 共享预算 1.5 秒（@types/vscode index.d.ts:14533-14546），modal 人工阅读必然超时、保存会在决定前继续、监听器三次失常被忽略——「取消后磁盘不变」不成立 | r2 §D4 全节按新机制重写（见 AGY-01 落点）；验收措辞同步改：「保存瞬间收到警示 + 一键恢复 + 红灯常驻」，并如实声明 API 边界（无取消保存能力）；D9 增连续保存、保存后恢复、reason 分流用例 |
| CODEX-02 | codex | major | 接受 | 成立：与 CLAUDE-07 同源，首写形态建表规则必须独立定义 | r2 §D1（同 CLAUDE-07 落点） |
| CODEX-03 | codex | major | 接受 | 成立：与 CLAUDE-05 同源；其「让生成件经过真实核心 gate 校验」的建议一并采纳 | r2 §D1（理由必填）+ §D9：test/real 层新增真实对拍件——插件生成草稿落临时主题目录后跑本仓真实 `gate --check` 断言输出（复用 test/real 既有真实 CLI 链路） |
| CODEX-04 | codex | major | 接受 | 成立：与 CLAUDE-04 同源（test/unit/hooks.test.ts:718-740 已有同语义回归） | r2 §D6（同 CLAUDE-04 落点） |
| CODEX-05 | codex | major | 接受 | 成立：与 AGY-04 同源，单侧 effectiveRerunIndex 抬升使现拼名必错 | r2 §D1（同 AGY-04 落点） |
| CODEX-06 | codex | 降级件 | 接受 | 成立：与 CLAUDE-09 同源（EEXIST/修复回路/合法行保留），虽不合 schema 降级、但问题真实 | r2 §D1（同 CLAUDE-09 落点）；D9 增「生成后 gate 失败→UI 修复→再校验通过」与「已有部分裁决件→补齐」两用例 |
