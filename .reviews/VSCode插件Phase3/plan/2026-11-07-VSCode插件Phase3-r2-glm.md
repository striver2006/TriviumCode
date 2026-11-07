# VSCode插件Phase3 · 实施计划（r2 修订）

## 相对 r1 的改动（计划审第 1 轮裁决合入）

本轮接受 24 条（CLAUDE-01、CLAUDE-02、CLAUDE-03、CLAUDE-04、CLAUDE-05、CLAUDE-06、CLAUDE-07、CLAUDE-08、CLAUDE-09、CLAUDE-10、CLAUDE-11、CLAUDE-12、AGY-01、AGY-02、AGY-03、AGY-04、AGY-05、AGY-06、CODEX-01、CODEX-02、CODEX-03、CODEX-04、CODEX-05、CODEX-06 全量处置见 `2026-11-07-VSCode插件Phase3-revised-glm.md`）。逐项落点：

1. **D4 全节重写**（CLAUDE-01、CLAUDE-02、AGY-01、CODEX-01）：waitUntil 有共享 1.5 秒预算、VS Code 无取消保存 API——原「modal 弹窗 + edits 还原」机制整体废弃，改为三段式（编辑期预警 → 保存瞬间警示 → 保存后一键恢复）；activationEvents 增 `onStartupFinished`；state.json 不可读走保守锁闭。
2. **D1 重构**（CLAUDE-05、CLAUDE-06、CLAUDE-07、CLAUDE-08、CLAUDE-09、CLAUDE-11、AGY-02、AGY-04、CODEX-02、CODEX-03、CODEX-05、CODEX-06）：裁决台分起草/修复两模式；三档理由全部必填；缺口模型按首写/修复两形态独立定义（fallback 期望集读 `.fallback-items.md`）；addresses 改 `run-<runId>.json`.artifacts[] 派生；joint_blocker_rejected 入组；行级 requireAction。
3. **D2 补强**（CLAUDE-10、CLAUDE-12）：warnings 一等展示；round_verdict null 降级。
4. **D3 补强**（AGY-05）：提示性摘要过滤编排器目录前缀。
5. **D5 重构**（CLAUDE-03、AGY-06）：workspace 作用域载体改 `context.workspaceState`（不写 `.vscode/settings.json`）；preset 分层只存装配参数。
6. **D6 重排**（CLAUDE-04、AGY-03、CODEX-04）：Driver 定位链以 `_meta/run-<runId>.json`.driver 为第一权威源。
7. **D9 扩充**：新增首写形态夹具、真实 gate 对拍（test/real）、激活前保存、损坏 state、恢复链路等用例。

以下为合入后的完整计划。

---

- **依据**：`doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`（v2.1）§6.3；任务目标见 task.json（goal）
- **范围**：FR-8 裁决台、FR-9 人工审批、FR-10 漂移护栏、FR-11 预设体系 + Phase 2 数据面协同两项。Phase 4 与 E1/E2/E3 不在本批。
- **基线**：extension/ 0.2.0（FR-1~FR-7 全量）；本批不改主仓 `src/` 与 `skills-src/`。

## 〇、要解决的问题与范围裁剪

在已交付驾驶舱之上补齐闭环「最后三公里」：FR-8 把 gate 缺口清单变成契约草稿表单（含修复回路）；FR-9 让 awaiting_approval 停点的审批走带外按钮；FR-10 用 VS Code 宿主能力对审查期业务文件写入做警示与恢复；FR-11 装配参数预设。**与 r1 的最大差异**：FR-10 按 VS Code 真实 API 边界重新设计（无取消保存能力，承诺改为「警示+一键恢复」），FR-8 补齐修复回路与首写形态。

## 一、事实基线（本轮源码/工件核实）

r1 §1.1~1.3 的事实全部保留，**新增以下四条**（均经源码核实，来自计划审意见的指证）：

| 契约 | 事实 | 出处 |
| :--- | :--- | :--- |
| waitUntil 时间预算 | `onWillSaveTextDocument` 的 waitUntil **共享 1.5 秒预算**，超时保存照常继续；保存监听器三次失常后被忽略；并发修改时 edits 会被忽略——「弹窗等人」不可行 | `@types/vscode index.d.ts:14533-14546, 13520-13523` |
| 取消保存能力 | VS Code API **没有**取消保存的路径；waitUntil promise 的 rejection 行为无文档承诺（未定义行为，不可依赖） | VS Code API 文档；AGY-01 建议①据此驳回 |
| addresses 官方判据 | 文件名取自 `run.json.artifacts[]`，不按日期现拼（跨零点、撞名抬升会改实际落盘名）；筛选 = 位于 `<主题>/<阶段>/` 根、非裁决件（parseArtifactName.kind===null）、后缀属有效侧（critics status ∈ {ok, parse_fallback}） | `gate.ts:1205-1240 expectedReviewDocs` |
| fallback 期望集 | parse_fallback 侧的待裁编号在 `_meta/review-<critic>-<runId>.fallback-items.md`，每行 `- <前缀>-F<n>: …`；missing_disposition 提前返回时 `fallback_ids` 恒空数组，**不能**当期望集用 | `gate.ts:1377-1402, 606, 1771` |
| GateEntry.driver | 只在 awaiting_approval 迁移时写入，raf 阶段不写、upsert 沿用前轮值——同槽位重跑换 Driver 时残留旧值，不能当当轮身份源 | `state.ts:56-81, 233-243`；`test/unit/hooks.test.ts:718-740` |
| 理由硬校验 | checkRow 对 structured 与 fallback 行**统一**要求三档裁决非空理由，不按裁决值豁免；空洞词按 reason_policy 处置 | `gate.ts:639-677` |
| 行级落点要求 | missing_action 只覆盖结构化行（checkRow(r,true)）；fallback 行 checkRow(r,false) 落点可选 | `gate.ts:639-670` |
| joint_blocker_rejected | hard 策略下是 failure 带 ids；warn 策略下进 warnings | `gate.ts:687-702` |
| round_verdict 可空 | bug 阶段、旧运行、无轮次链时为 null | `cli.ts:1279-1293` |

r1 §1.2（真实工件夹具：agy适配1.5.2 两件裁决件、evidence/m9 gate 输出、编号前缀体系）、§1.3（extension 现状）不变，全部沿用。

## 二、总体架构（新增/改动模块）

```
extension/src/
├─ cli/commands.ts            [改] +gateCheck / +approve / +abandon 封装与输出类型
├─ disposition/
│  ├─ gateGapModel.ts         [新] gate --check JSON（首写/修复两形态）→ 缺口 UI 模型（纯函数）
│  ├─ dispositionDraft.ts     [新] 裁决表 → 契约草稿文本 + 文件名生成 + 起草新建/修复写回（注入 fs）
│  ├─ runMeta.ts              [新] `_meta/run-<runId>.json` + artifacts[] + fallback-items 只读解析（纯函数+注入 fs）
├─ approval/
│  ├─ gateAreaModel.ts        [新] StateSnapshot + gate 输出 → 闸门区模型（含 warnings/计票 null 形态；纯函数）
│  ├─ lampModel.ts            [新] 闸门态聚合（含 unreadable）→ 三色灯（纯函数）
│  ├─ worktreeSummary.ts      [新] 只读 git status 解析（含编排器目录前缀过滤）→ 提示性摘要（纯函数+注入 runner）
├─ guard/saveGuard.ts         [新] 三段式保存防护 + 状态栏三色灯（服务级，onStartupFinished 装配）
├─ presets/
│  ├─ presetModel.ts          [新] 装配参数 ↔ preset JSON（分层校验；纯函数）
│  ├─ presetStore.ts          [新] globalState + workspaceState 双作用域存取（注入 storage）
├─ monitor/stateModel.ts      [改] GateRef +rerunIndex/driver；解析失败与文件不存在分流（unreadable 通道）
├─ ui/cockpit.ts / cockpitHtml.ts [改] 闸门区 / 裁决台（起草+修复）/ 预设 UI
├─ extension.ts               [改] 装配 saveGuard 与三色灯（启动激活）
└─ package.json               [改] 0.3.0；activationEvents + onStartupFinished；+配置项
test/unit/ +gateGapModel +dispositionDraft +runMeta +lampModel +presetModel +worktreeSummary +gateAreaModel
test/integration/ +gateApproval +dispositionDesk +saveGuard +presets（suite.ts 登记）
test/real/ +dispositionGate（真实 gate --check 对拍）
```

## 三、关键设计决策

### D1 FR-8 裁决台：两形态缺口模型 + 起草/修复两模式

**入口**：raf 态闸门卡上「进入裁决台」按钮，或用户手动选主题/阶段；进入即调 `gate --check --json`。

**缺口模型（gateGapModel）按 gate 输出自动判形**：

- **起草形态**（`disposition` 为 null，即 missing_disposition 提前返回）：
  - 待裁集 = `structured_ids ∪ degraded_ids ∪ fallback 期望集`。fallback 期望集由 `runMeta.ts` 只读解析 `_meta/review-<critic>-<runId>.fallback-items.md`（每行 `- <前缀>-F<n>: …`；文件可能不存在=该侧无 fallback，空集）。**不用** `fallback_ids`（此时恒空）。
  - 全部待裁编号进表单（无「已裁决只读」区）。
  - 其余结构类 failure（missing_review_json/task_unreadable 等）整卡展示。
- **修复形态**（`disposition` 非 null，裁决件已存在）：
  - **新增行** = `missing_findings.ids`。
  - **修复行** = `empty_reason.ids ∪ defer_not_allowed.ids ∪ missing_action.ids ∪ unknown_findings.ids（操作=删行）∪ joint_blocker_rejected.ids（hard 策略时）`。这些行已存在于裁决表，表单按现有内容预填（解析现有件进表单，见「修复模式」）。
  - **只读行** = 期望集 − 新增行 − 修复行（已合法裁决，保留展示）。
  - **计划类**（missing_next_plan/next_plan_missing_ids）：展示期望文件名与缺失编号，注明属 Driver 下一轮计划职责，裁决台不代写。
  - **结构类**（bad_front_matter/unparsable_table）：进修复模式整体重建（front-matter 按本计划规则重生成、表格从表单重建）。
- joint_blocker_rejected：hard→修复行组；warn→warnings 区展示（不阻断）。

**表单规则**（对齐契约硬校验，CLAUDE-05/11）：
- 三档裁决（接受/驳回/暂缓）**理由全部必填非空**；空洞词（无需修改/不适用/已知悉/没问题/ok/na）在 UI 即时提示「按 reason_policy 可能被判空洞」，不阻止提交（策略属编排器配置面，插件不复制判定）。
- 落点（修改计划）：**行级 requireAction**——结构化行的接受项必填（对齐 missing_action）；fallback 行（`-F` 编号）接受项可选（对齐 checkRow 第二参数）。
- `defer_not_allowed` 命中的编号禁选暂缓档。
- 三档理由与落点均为人工输入，无默认值、无自动填充。

**草稿生成（dispositionDraft）**：
- front-matter 七字段：schema/topic/stage/role/kind/run_id/addresses。**addresses 由 `runMeta.ts` 从 `_meta/run-<runId>.json`.artifacts[] 派生**（筛选：位于 `<主题>/<阶段>/` 根、非裁决件、后缀属有效侧——对齐 gate.ts expectedReviewDocs 的只读派生，不做日期拼名；推不出空集时预览页允许手工编辑并明示原因）。
- 表格六列对齐真实件：code `意见编号/来源/严重度/裁决/理由/修改计划`，plan/bug 末列 `落点`；对齐行 `| :--- |` ×6；单元格安全化（`|`→全角、换行→空格）。修复模式下**保留现有合法行原文**（含已有行的人工措辞），只替换被修复行、追加新增行、删除 unknown 行。
- 文件名 `<本地日期>-<主题>[-rN(rerun>1)]-<kind>-<driver>.md`，本地时区取宿主时钟。

**落盘——起草/修复两模式（CLAUDE-09/AGY-02/CODEX-06）**：
- **起草**（目标文件不存在）：`fs.open(path,'wx')` 独占创建；EEXIST 即转修复模式提示（文件已存在，读它进表单）。
- **修复**（写回既有路径，含起草件自身的迭代）：预览确认后**原子替换写回**（tmp+rename 同目录）；**写回前比对「表单载入时刻的文件内容 hash」与当前盘上内容**，不一致则拒绝写回并提示「文件已被外部修改，请重新拉取」（防并发覆盖）；保留合法行的原文措辞。
- 写例外语义：本批插件对 `.reviews/` 的写仅限「裁决件的新建与经预览确认的写回」，均需用户点击确认；不做第二套闸门校验，正确性由 `gate --check` 兜底（生成后自动重跑一次 check 并展示结果，不过即回到修复模式——闭环无手工编辑）。

**当轮 Driver id 定位链（D6 重排后）**：① `_meta/run-<runId>.json`.driver（run 权威）；② task.json `drivers.<stage>.driver`（受限 fallback，UI 标注「阶段认领声明」）；③ 闸门 `gates[].driver` 仅作展示比对、不采信。推不出 → 禁用草稿生成并明示，**不猜**。

### D2 FR-9 闸门区

r1 D2 保留（感知/计票=gate --check 的 round_verdict 原样/三按钮/防双击/abandon 显式 --stage/拒绝理由 textarea 必填），**补两条**（CLAUDE-10/12）：
- **warnings 一等展示**：闸门卡与裁决台均渲染 `gate --check` 的 warnings（与 failures 分区、逐条 code+message；readonly_breach_unconfirmed/degraded_round/addresses_unchecked 等关键警示不静默）。
- **round_verdict null 降级**：显示「无计票信息（旧运行或 bug 阶段）」，不从其它字段补算。
- 批准后的权威摘要（worktree_summary）渲染保留 r1 设计（available=false 四态如实展示）。

### D3 工作树摘要数据源（维持 r1 决策 + 一处补强）

双层数据源不变：点击前 spawn 只读 `git status --porcelain=v1 -z --untracked-files=all`（提示性，UI 明示「相对 HEAD，看不见闸门期已提交改动」）；批准后展示 approve 输出的权威 worktree_summary。**补强（AGY-05）**：提示性摘要按编排器 diffExcludePrefixes 同语义过滤 `.reviews/`、`.trivium/`、`.git/` 前缀（展示层过滤，注释注明对齐 `worktree-summary.ts` 的排除语义），避免把每轮审查工件当业务改动误报。不选 gate --await-approval 重入的理由不变（状态迁移副作用）。

### D4 FR-10 保存防护：三段式（全节重写）

**API 边界（先声明，决定一切形态）**：VS Code 无取消保存 API；will-save 的 waitUntil 共享 1.5 秒预算、超时保存照常继续、监听器三次失常被停用；modal 弹窗不能放进保存事件。**本插件承诺的是「事前预警 + 事中警示 + 事后一键恢复」，不承诺「阻止写盘」**——这是 API 边界内能做到的最大形态，交付说明如实注明。

**三段式机制**：
1. **编辑期预警（事前）**：锁态≠绿（含 unreadable）且用户修改业务文件时（onDidChangeTextDocument，文档级去重、会话内每文件最多一次），弹 modal：「审查期间修改业务文件可能造成快照漂移、整轮作废。停止编辑请按 Esc 关闭本提示；继续编辑将在保存时再次警示」。不在保存事件内，无时间预算约束。
2. **保存瞬间警示（事中）**：onWillSaveTextDocument 命中违规保存时，在 1.5 秒预算内只做两件快事：异步读磁盘快照（此刻盘上即保存前内容）存入待恢复表；发非阻塞 toast「⚠ 已保存到审查中的业务文件 <relPath>：可一键恢复到保存前」。不弹 modal、不做 edits 还原（CODEX-01 否决原机制）。
3. **保存后一键恢复（事后）**：toast 带「恢复」按钮（onDidSaveTextDocument 确认保存完成后触发带按钮的警告消息）；点击 → 原子写回快照（tmp+rename）→ `workbench.action.files.revert` 让编辑器回到盘上（恢复后）内容 → 用户修改保留在 undo 栈可找回。不点击则保持（用户显式自担）。快照对每文档只保留最近一次保存前内容，内存有界。

**reason 分流（AGY-01）**：Manual / AfterDelay / FocusOut 一律走第 2+3 段（无阻断、无 modal，自动保存不轰炸）；modal 只在第 1 段（编辑期，非保存事件）出现。ESC 关闭第 1 段 modal = 仅关闭提示，不影响后续段。

**判定规则**（顺序短路）：scheme≠file 放行；不在工作区根下放行；relPath 以 `.reviews/`、`.trivium/`、`.vscode/` 开头放行（编排器写入区 + VS Code 设置文件——任务书硬约束；`.vscode/` 下受跟踪文件的改动仍会被编排器快照捕获，属用户显式自担，风险注记进使用说明）；灯=绿放行；其余拦截路径。

**激活（CLAUDE-01）**：activationEvents 增 `onStartupFinished`；activate 时若工作区存在 `.trivium/`（已 init）则装配 saveGuard 与三色灯；未 init 不装配（不误伤其它仓库）。

**状态面（CLAUDE-02）**：stateModel 区分三态——文件不存在（正常，绿灯）/ 解析成功 / **文件存在但解析失败（unreadable）**。unreadable 时灯显「🔴 状态不可读」、保存防护按拦截路径处理（保守），并 toast 提示排查 state.json（编排器对坏 state 会退 2）。`.tmp-*` 闪现文件名不是 state.json 本体，watcher 天然忽略。

**三色灯（lampModel）**：🔴 任一闸门 running 或 unreadable；🟡 无 running 但有 raf/awaiting_approval；🟢 其余。状态栏常驻，点击打开驾驶舱。

### D5 FR-11 预设：分层模型 + 双 memento 作用域

- **preset 分层（AGY-06）**：只存装配参数 `driver/critics/entry/maxRounds/profile/extraFlags`（+可选 `ctxPaths`）；**topic/body 不进 preset**（会话瞬态）；加载不覆盖用户正在输入的正文与主题。全局作用域 preset 跨仓加载时对 ctxPaths 逐项校验存在性，失效项标注跳过。
- **双作用域（CLAUDE-03 载体修正）**：用户级 `context.globalState` + 工作区级 `context.workspaceState`（**不用** workspace configuration——写 `.vscode/settings.json` 会落入编排器审查快照、与保存防护自相矛盾；workspaceState 同为 VS Code 官方工作区级 memento，语义等价且零仓库足迹）。读取合并展示，同名 workspace 优先并标注来源。不写 `.trivium/` 任何 yaml（G6 维持）。
- **UI**：装配区「预设：[select] [另存为…] [删除]」；另存为弹名称 + 作用域二选一；删除带确认。加载回填视为表单变更（CLAUDE-08 冻结语义自然生效，须重跑前置链）。

### D6 ~ D8

D6 已并入 D1（定位链）。D7（缺口联动批注）、D8（UI 布局落点与消息协议）维持 r1 设计。

### D9 测试计划（扩充）

**单测**（纯函数）：
- `gateGapModel`：三件夹具——①**真实首写形态**（missing_disposition 提前返回：structured_ids/degraded_ids 非空 + fallback_ids 空 + 无 missing_findings，配 fallback-items.md 解析）；②修复形态（empty_reason/missing_action/unknown_findings/joint_blocker_rejected-hard 各带 ids + 已有行预填分组 + 只读集推导）；③evidence/m9 真实 bad_front_matter 输出。断言两形态建表规则、joint warn/hard 分组、坏 JSON 容错。
- `dispositionDraft`：front-matter 七字段逐字段；表头对拍 agy适配1.5.2 真实件（字符级）；修复模式保留合法行原文、只改修复行；单元格安全化；文件名（本地日期/rN/kind/driver）；起草 wx 成功/EEXIST 转修复提示；修复写回 hash 比对（不一致拒写）；行级 requireAction（结构化/fallback 两类）。
- `runMeta`：artifacts[] 派生 addresses（有效侧筛选、_meta 排除、裁决件排除）；fallback-items 解析（每行编号提取、文件缺失空集）；driver 读取。
- `lampModel`：七态 × 多闸门 × unreadable → 三色灯全映射。
- `presetModel`：分层字段校验、未知字段剔除、topic/body 不入、ctxPaths 失效标注。
- `worktreeSummary`：porcelain -z 解析 + 编排器目录前缀过滤（.reviews/.trivium/.git 不出现在结果）。
- `gateAreaModel`：aa 态 + round_verdict 正常件 / null 件（降级文案）/ 退 2 件（failures+warnings 展示模型）。

**集成**（真实宿主）：
- `gateApproval`：writeState 造 awaiting_approval + _meta（run.v3 带 round_verdict + review-*.json）→ 闸门卡浮出、计票正确；桩 CLI 配 approve/abandon 应答 → 三按钮 argv 断言（--topic/--stage/--reject/--reason 逐项）+ 空理由前端拦截 + 放弃二次确认；state 迁移后收敛；warnings 展示。
- `dispositionDesk`：**首写链路**（桩 gate 返 missing_disposition + fallback-items 文件 → 表单含 F 编号行）→ 逐条裁决 → 预览对拍契约 → 落盘 → 磁盘断言；**修复链路**（预置带 empty_reason 的裁决件 → 修复模式预填 → 写回 hash 比对 → EEXIST 转修复）；联动批注（复用 Phase2 夹具锚点）。
- `saveGuard`：**不开任何 UI 视图**直接模拟保存（激活即装配断言）；running 期保存业务文件 → toast 警示 + 快照 + 一键恢复后磁盘内容不变；.reviews/.trivium/.vscode 放行；损坏 state.json → 红灯 + 拦截路径；reason 分流（AfterDelay 不弹编辑期 modal）；连续保存（三次失常阈值内不丢警示）。
- `presets`：两作用域存取、合并列表、加载回填（不含 topic/body）、删除。

**真实对拍（test/real 新增 dispositionGate）**：插件生成草稿落临时主题目录（夹具构造 run 元数据 + review 件）→ 跑本仓真实 `.trivium/bin/trivium gate --check --json` → 断言生成件通过裁决齐备校验（CODEX-03 建议；test/real 已有真实 CLI 链路先例）。

**人工验收保留项**：真实三审主题的裁决台手感、四家 Driver role 定位实跑、modal/toast 在真实交互下的时序——列入交付说明人工清单。

### D10 版本与工程面

package.json → **0.3.0**；activationEvents 增 `onStartupFinished`；配置项增 `trivium.guard.saveGuard`（bool 缺省 true 总开关）；README 增 Phase 3 一节（含 API 边界如实说明）。extension `npm run check` 全绿；主仓 `npm run check` 不受影响；`.trivium/config.yaml` verify 接线维持现状（AGY-03 旧裁决维持）。

## 四、实施步骤（S5 内序）

1. `cli/commands.ts` 三封装 + `disposition/runMeta.ts`（+单测）。
2. `gateGapModel` → `dispositionDraft`（+单测，含对拍夹具）。
3. `lampModel`/`gateAreaModel`/`worktreeSummary`/`presetModel`（+单测）。
4. `stateModel` 扩展与 unreadable 分流（+回归）。
5. `guard/saveGuard.ts` 三段式 + `extension.ts` 启动装配 + package.json + 集成 saveGuard。
6. `presets/` + 表单区 UI + 集成 presets。
7. cockpit 闸门区 + 集成 gateApproval。
8. cockpit 裁决台（起草+修复+联动）+ 集成 dispositionDesk + test/real 对拍。
9. suite.ts 登记、README、0.3.0；extension check 全绿 + 主仓 check 复跑。

## 五、验收清单

- [ ] FR-8：首写与修复两形态建表正确（真实 missing_disposition 夹具）；草稿对拍真实契约件；三档理由必填、行级落点要求；addresses 由 artifacts[] 派生；role 四级不猜；起草/修复/写回 hash 防护；生成后自动 gate 校验闭环。
- [ ] FR-9：闸门卡浮出/计票（含 null 降级与 warnings 展示）/三按钮 argv/带外性。
- [ ] FR-10：激活即装配（无需开 UI）；编辑期 modal 预警、保存瞬间 toast+快照、一键恢复后磁盘不变；放行目录三处；unreadable 保守锁闭；三色灯全映射。验收措辞按 API 边界如实：**「保存瞬间收到警示并可一键恢复」**（v2 §6.3 的「被拦截」在 VS Code API 下以本形态交付，交付说明注明边界）。
- [ ] FR-11：分层 preset、双 memento 作用域、回填不含瞬态字段、不写 .trivium/.vscode。
- [ ] 协同：缺口联动批注定位；计票同源。
- [ ] 工程面：extension check 绿；主仓 check 不破坏；中文 UI/注释；集成面 = CLI + 只读文件面 + 论证过的只读 git status。

## 六、风险与对策

| 风险 | 等级 | 对策 |
| :--- | :---: | :--- |
| 保存防护不承诺「阻止写盘」（API 边界），与 v2 计划原文「拦截」有语义差 | 中 | 计划与交付说明双处如实声明；编辑期 modal + 红灯 + 一键恢复把实际损失窗口压到秒级；用户可选配合关闭 files.autoSave（使用手册建议） |
| 保存后恢复链路（toast→点击→写回→revert）在快节奏连续保存下竞争 | 中 | 快照每文档只留最近一次；写回原子替换；集成测试覆盖连续保存 |
| addresses/首写期望集派生依赖 _meta 工件完整性 | 中 | runMeta 解析全部防御式；推不出即明示并允许手工编辑 addresses；gate --check 兜底 |
| 修复模式写回与编排器/他人并发写同文件 | 中 | 载入 hash 比对拒写；gate 兜底 |
| 桩与真实 CLI 输出漂移 | 中 | test/real 真实 gate 对拍件；真实链路人工清单 |
| workspaceState/globalState 损坏或超量 | 低 | 读取容错剔除坏条目；preset 条数软上限提示（如 50） |

## 七、交付物清单

- `extension/src/`：新增 9 模块 + 改 5（§二）。
- `extension/test/`：单测 7 件 + 集成 4 件 + real 1 件 + fixtureLib 扩展 + suite.ts 登记。
- `extension/package.json` 0.3.0、`extension/README.md` Phase 3 一节（含 API 边界说明）。
- 交付说明（含人工验收清单与 API 边界如实声明）。
