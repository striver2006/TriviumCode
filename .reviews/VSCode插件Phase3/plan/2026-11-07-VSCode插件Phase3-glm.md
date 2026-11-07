# VSCode插件Phase3 · 实施计划（r1 原稿）

- **依据**：`doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`（v2.1）§6.3；任务目标见 task.json（goal）
- **范围**：FR-8 裁决台、FR-9 人工审批、FR-10 漂移护栏、FR-11 预设体系 + 与 Phase 2 数据面协同两项（缺口联动批注、计票同源）。Phase 4（打包/手册/注入矩阵回归）与核心增强 E1/E2/E3 不在本批。
- **基线**：extension/ 0.2.0（FR-1~FR-7 全量，主仓分支 feat/vscode-extension，HEAD=9c057024）；本批不改主仓 `src/` 与 `skills-src/`。

## 〇、要解决的问题与范围裁剪

在已交付的驾驶舱（装配点火/监控/意见批注/历史回放）之上补齐闭环的「最后三公里」：

1. **裁决台（FR-8）**：审查结束后 Driver 侧的逐条裁决件，目前只能手写 Markdown——把 `gate --check --json` 的缺口清单变成表单，生成对齐 `trivium.disposition.v1` 契约的草稿，用户预览确认后落盘（本批唯一写 `.reviews` 的例外）。
2. **人工审批（FR-9）**：`awaiting_approval` 停点目前只能回终端敲 `trivium approve`——驾驶舱浮出闸门区，计票 + 工作树摘要 + 批准/拒绝/放弃按钮，点击动作不经过任何模型上下文（v2 计划 §4.4 的带外通道）。
3. **漂移护栏（FR-10）**：L2 载体的 Hook 只能事后发现漂移——VS Code 宿主级 `onWillSaveTextDocument` 事前拦截 + 状态栏三色灯。
4. **预设体系（FR-11）**：装配表单存为插件侧 preset（globalState + workspace 双作用域），不写 `.trivium/` 任何 yaml（G6 裁决维持）。

## 一、事实基线（本轮源码/工件核实）

以下事实全部经源码或真实工件核实，是本计划的设计前提。

### 1.1 编排器契约面

| 契约 | 事实 | 出处 |
| :--- | :--- | :--- |
| `gate --check --json` 输出 | `{ok, stage, rerun_index, run_id, failures[], warnings[], structured_ids[], fallback_ids[], degraded_ids[], disposition, review_loop, round_verdict, next_action, round_line}`；**无 topic 字段**（调用方自己传的 `--topic`）；退出码 **0 通过 / 2 未通过** | `src/trivium/cli.ts:1674-1685` |
| failures 单条 | `{code, message, ids?, line?}`——文件名、期望值、mismatches 全嵌在 `message` 文本里；`ids` 是编号数组 | `src/trivium/gate.ts:136-142` |
| GateFailureCode 全集（15 个） | `missing_disposition / bad_front_matter / unparsable_table / missing_findings / unknown_findings / bad_verdict(死枚举，无构造点) / defer_not_allowed / empty_reason / missing_action / joint_blocker_rejected / missing_review_json / readonly_breach / missing_next_plan / next_plan_missing_ids / task_unreadable`；role 不一致**不是独立 code**，并进 `bad_front_matter` 的 mismatches 文案 | `gate.ts:116-134` 及各构造点 |
| 缺裁编号 | `missing_findings.ids` = 期望集（structured ∪ degraded ∪ 期望 fallback）减已裁，纯编号数组；fallback 形态 `<前缀>-F<n>` | `gate.ts:614-621` |
| disposition.v1 front-matter | **七必填字段**：`schema('trivium.disposition.v1')/topic/stage/role/kind/run_id/addresses`（任务书写的「五字段」漏了 topic/stage，本计划按 schema 修正）；`kind`：plan/bug→`revised`、code→`response`；`addresses` = 审查文档**文件名**数组，份数 = 本轮落审文档的侧数 | `skills/dual-critic/schema/disposition.v1.json` |
| 裁决表解析 | 在 `src/trivium/disposition.ts`（**不是** parse.ts）；表头三必备列同义词：意见编号(编号/id)、裁决(处置/结论/disposal)、理由(原因/reason)；可选列：来源(source)、严重度(severity)、落点(落地点/修改点/修改计划/计划/动作/action)；裁决值：接受(采纳/同意/accept)、驳回(不接受/拒绝/否决/reject)、暂缓(搁置/推迟/defer)；单元格归一化（全角→半角）后先精确后包含匹配 | `disposition.ts:32-86` |
| 命名规则 | `<YYYY-MM-DD 本地时区>-<主题>[-r<N>, rerun>1 时][-revised|-response]-<Driver id>.md`；主题 1~64 字符、黑名单制（禁 `/\`、`..`、前导 `.`、保留后缀）、**不截断**；落盘 `O_EXCL` 独占创建，`EEXIST` 抬升 `-r<N>` 重试（上限 200） | `src/trivium/naming.ts:113-137`、`archive.ts:196-237` |
| `approve` | `approve --topic <t> --stage <s> [--reason <附言>] [--reject --reason <理由>] [--session-id <id>]`；`--topic`、`--stage` 必填；`--reject` 是布尔旗标且 **`--reason` 必填**（缺则 64）；通过前复核 `verifyRoundForApproval`（裁决齐备 + 本轮工件 sha256）未过退 2；`--json` 输出 `{ok, topic, stages, decision, worktree_summary?}`——**仅 approved 带 `worktree_summary`**（`Partial<Record<Stage, WorkTreeSummary>>`） | `cli.ts:1902-2049`、`approval.ts:220-222` |
| `abandon` | `abandon --topic <t> [--stage <s>] [--reason <r>]`；`--stage` **可省**=批量放弃该主题全部非 running 开放闸门（插件单闸门场景应显式传 `--stage`，避免误伤其它阶段）；abandoned 不走复核 | `cli.ts:1913-1943`、`approval.ts:84-86` |
| state.json | `{schema:'trivium.state.v1', updated_at, gates}`；`gates["<topic>/<stage>"] = {topic, stage, state, run_id, rerun_index, since, driver?, session_id}`；七态 `idle/running/review_done_awaiting_disposition/awaiting_approval/approved/rejected/abandoned`；原子替换（tmp+rename），目录里闪现 `.tmp-*`；插件绝不能写 | `src/trivium/state.ts:37-153` |
| 工作树摘要语义 | 编排器 `worktree_summary` 基线是 `run.json.snapshot.after_tree_hash`（审查收尾 tree），**含闸门期提交过的改动**；相对 HEAD 的 `git status` 看不见已提交改动——两套口径不同 | `worktree-summary.ts:13-25` |
| `gate --await-approval` | 已表态则 `state:'unchanged'` 不迁移；未表态时会**主动迁移**闸门（白名单六态 → awaiting_approval）——有写副作用，不能当插件的只读取摘要通道 | `cli.ts:1540-1622` |
| round_verdict（run.v3） | `{sides{critic→verdict}, excluded, counts{pass/pass-after-changes/reject}, outcome, next_action}`——闸门区计票的权威源（随 gate --check --json 输出） | run.v3 真实件、`cli.ts:1674` |

### 1.2 真实工件夹具（本仓留痕，单测直接引用形态）

- **code 阶段裁决件**（对拍金标准）`.reviews/agy适配1.5.2/code/2026-11-07-agy适配1.5.2-response-glm.md`：front-matter 七字段 + `addresses` 为 yaml 列表；表头 `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |` + `| :--- |` 对齐行；正文标题 `# 代码审第 1/5 轮应答（Driver：glm）`。
- **plan 阶段裁决件** `.reviews/agy适配1.5.2/plan/2026-11-06-agy适配1.5.2-revised-glm.md`：同构，`kind: revised`，末列名是「落点」。
- **finding id 前缀**：`CLAUDE-01 / CODEX-01 / AGY-01 / GLM-01`（agent id 全大写 + 两位序号；gemini 经 agy 适配故为 AGY）；fallback `<前缀>-F01`。
- **真实 gate 缺口输出样例**：`doc/05_testing/evidence/m9-acceptance-20260919/hook-and-gate-outputs.md`（bad_front_matter 带 role mismatch message + structured_ids + disposition 路径）。任务书点名的「VSCode插件Phase2 计划审第 1 轮缺口形态（bad_front_matter 三缺、unparsable_table、missing_findings 逐条编号）」无存档（gate 输出不落盘），单测夹具按 `gate.ts` 各构造点的 message 模板**手工构造**等价 JSON，并注明构造依据（gate.ts:391/458-463/582-589/616-621）。

### 1.3 extension 现状（集成基座）

| 模块 | 现状 | 本批关系 |
| :--- | :--- | :--- |
| `StateWatch`/`stateModel` | 监视 state.json，`GateRef{key,topic,stage,state,runId,since}`；`ACTIVE_GATE_STATES`={running, raf, aa}；订阅即回放最近快照 | FR-9/FR-10 共用数据面；GateRef 需扩展 `rerunIndex`/`driver`（防御式，缺省 null） |
| `Cockpit`/`cockpitHtml` | 表单 `FormState{driver,critics,entry,body,topic,maxRounds,profile,ctxPaths,extraFlags}` + CLAUDE-08 冻结语义；`post` 消息协议；已有 `open-finding` 跳转（行区间 reveal） | FR-8/9/11 的 UI 宿主；表单快照即 preset 序列化对象 |
| `TriviumCommands`/`TriviumCli` | spawn wrapper（shell:false、分块 Buffer、超时 SIGTERM→SIGKILL、extractJson 容错） | 新增 gateCheck/approve/abandon 三个封装 |
| `AnnotationHub` | scope+焦点 run、`findingsOfFocusRun()`（含 id/relPath/startLine/endLine）、`setScope`/`setActiveRun` | 裁决台缺口→批注联动复用其数据面 |
| `runHistory` | `_meta/run-*.json`（run.v3：driver/critics_selected/round_verdict）+ task.json 时间线 | Driver id 的 fallback 源 |
| `fixtureLib`（集成测试） | 可编程桩 CLI（按子命令回放 responses.json + last-args.json 断言 argv）、`writeState` 原子写 state.json、buildPhase2Fixture 的 _meta 归档形态 | Phase 3 集成测试直接扩展 |

## 二、总体架构（新增/改动模块）

```
extension/src/
├─ cli/commands.ts            [改] +gateCheck / +approve / +abandon 封装与输出类型
├─ disposition/
│  ├─ gateGapModel.ts         [新] gate --check JSON → 缺口 UI 模型（纯函数）
│  ├─ dispositionDraft.ts     [新] 裁决输入 → 契约草稿文本 + 文件名生成 + O_EXCL 落盘（纯函数 + 注入 fs）
├─ approval/
│  ├─ gateAreaModel.ts        [新] StateSnapshot + gate 输出 → 闸门区模型（纯函数）
│  ├─ lampModel.ts            [新] 闸门态聚合 → 三色灯（纯函数）
│  ├─ worktreeSummary.ts      [新] 只读 git status 解析 → 提示性摘要（纯函数 + 注入 runner）
├─ guard/saveGuard.ts         [新] onWillSaveTextDocument 拦截 + 状态栏三色灯（服务级）
├─ presets/
│  ├─ presetModel.ts          [新] FormState ↔ preset JSON（纯函数，校验/迁移）
│  ├─ presetStore.ts          [新] globalState + workspace 配置双作用域存取（注入 storage）
├─ monitor/stateModel.ts      [改] GateRef +rerunIndex/driver（防御式解析）
├─ ui/cockpit.ts / cockpitHtml.ts [改] 闸门区 / 裁决台 / 预设 UI（消息协议扩展）
├─ extension.ts               [改] 装配 saveGuard 与三色灯、命令注册
└─ package.json               [改] 0.3.0；+配置项 +命令
test/unit/ +gateGapModel +dispositionDraft +lampModel +presetModel +worktreeSummary +gateAreaModel
test/integration/ +gateApproval +dispositionDesk +saveGuard +presets（suite.ts 登记）
```

分层纪律不变：IO 全在宿主异步侧、Webview 只 postMessage 渲染；纯函数模块不依赖 vscode（单测直跑）。

## 三、关键设计决策

### D1 FR-8 数据流：gate 缺口 → 裁决表单 → 契约草稿

**数据流**：`gate --check --json`（用户在驾驶舱点「拉取缺口」，或 raf 态浮出提示一键进入）→ `gateGapModel` 解析为 UI 模型 → 表单逐条裁决 → `dispositionDraft` 生成草稿全文 → 预览 → 确认落盘 → 提示「闸门校验兜底，不过即回台改」。

`gateGapModel` 的缺口分三组（对齐 15 个 failure code 的可操作性）：

1. **结构类**（不可逐条裁决，须先修结构）：`missing_disposition`（正好是裁决台的入口态）、`bad_front_matter`、`unparsable_table`、`missing_review_json`、`task_unreadable`、`readonly_breach`——整卡展示 message 原文 + 处置建议（task_unreadable 明确提示「不是裁决缺口，需在终端恢复正本」）。
2. **逐条类**（表单主体）：`missing_findings`（ids=缺裁编号）、`empty_reason`（ids=理由空洞的编号，表单预填该条并标红理由框）、`unknown_findings`（ids=多余编号，提示从既有裁决件删行）、`defer_not_allowed`（ids=不允许暂缓的编号，表单里这些条禁选「暂缓」）、`missing_action`（ids=接受但缺落点的编号，接受项落点框必填）。`structured_ids ∪ degraded_ids ∪ fallback_ids - missing_findings.ids` = 已裁决编号（只读展示，不进表单）。
3. **计划类**（plan 阶段）：`missing_next_plan`/`next_plan_missing_ids`——展示期望文件名与缺失编号，提示这是 Driver 的下一轮计划职责，裁决台不代写（计划文档的撰写属于 Driver 会话，插件不越权）。

**表单预填**：每条缺裁编号一行——编号（点击联动批注，见 D8）、来源 critic（从编号前缀映射：CLAUDE→claude 等，fallback `-F` 也能映射）、severity（AnnotationHub 数据面取，取不到显示「—」）、三档裁决单选（缺省未选；`defer_not_allowed` 的条禁用暂缓档）、理由 textarea、落点 textarea（仅裁决=接受时显示且必填，对齐 `missing_action` 契约）。**驳回/暂缓必填非空理由且非空洞词**（对齐 `empty_reason` 的 HOLLOW_PATTERNS：无需修改/不适用/已知悉/没问题/ok/na）；接受项理由可空。三档理由均为人工输入，无默认值、无自动填充。

**草稿生成**（`dispositionDraft`）：front-matter 七字段——`schema:trivium.disposition.v1`、`topic`（闸门/用户传入）、`stage`、`role`（当轮 Driver id，取自 D6 的 Driver 定位链）、`kind`（plan/bug→revised、code→response）、`run_id`（gate 输出的 run_id）、`addresses`（本轮审查文档文件名——取 `gate --check` 时读 `.reviews/<topic>/<stage>/` 下当日带 critic 后缀的 `_meta/review-*` 对应 md？**否**：直接从阶段目录扫描本轮 run_id 对应的审查 md 文件名。审查文档命名 `<日期>-<主题>[-rN]-<critic>.md` 与 run 的对应关系经 `_meta/brief-<critic>-<runId>.md` 旁证：`_meta/` 下 `brief-<critic>-<runId>.md` 与归档的 `review-<critic>-<runId>.json` 同 runId，而正文名即 `addresses` 期望值。实现：读 `_meta/review-<critic>-<runId>.json`（存在的 critic 集）→ 对应 `<日期>-<主题>[-rN]-<critic>.md` 文件名（从 run 元数据的 rerun_index 推 rN 中缀 + 阶段目录 glob 校验存在）。若推不出，让用户在预览里手工确认 addresses 列表（编辑后再生效）——**正确性由 gate --check 兜底**，插件不做第二套强校验）。
表格六列对齐真实件：code 表头 `意见编号/来源/严重度/裁决/理由/修改计划`，plan 表头末列 `落点`；对齐行 `| :--- |` ×6。理由/落点文本做单元格安全化：`|`→全角 `｜`、换行→空格（disposition.ts 按 `|` 切列，不转义会破坏解析）。正文头部一句话概述（`# 裁决草稿（Driver：xxx）` + 计数行）。
**文件名**：`<本地日期 YYYY-MM-DD>-<主题>[-rN(rerun>1)]-<kind>-<driver>.md`，本地时区取自宿主时钟（对齐 naming.ts 的 localDate 语义，不引入时区换算第二份实现——直接 `new Date()` 格式化本地日期）。

**落盘**：`fs.open(path,'wx')` 独占创建（对齐 archive.ts 的 O_EXCL 语义）；**EEXIST 不抬升 -rN**（那是编排器的重试语义，插件重复它=复制业务逻辑），如实报错「文件已存在：请直接编辑该文件（可能上一份草稿已落盘），或删除后重试」，把决定留给用户。落盘前必须经预览确认（Webview 只读展示草稿全文 + 「确认落盘」按钮，见 D3 的写例外论证）。

### D2 FR-9 闸门区：感知、计票、三按钮、带外性

**感知**：StateWatch 快照里 `state==='awaiting_approval'` 的闸门 → 驾驶舱顶部浮出闸门区（每道闸门一张卡；含初始回放路径——订阅即回放保证插件后开也能看到）。raf（review_done_awaiting_disposition）态闸门区显示「裁决未齐」提示卡 + 「进入裁决台」按钮（联动 FR-8）。

**计票**：闸门卡浮出时宿主调一次 `gate --check --json`（aa 态时它应退 0）取 `round_verdict`（各侧 pass/pass-after-changes/reject、counts、outcome）与 `round_line` 原样展示；「刷新」按钮重拉。**同源论证**：round_verdict 由编排器从本轮 review-*.json 派生（run.v3 同一字段），与历史树 run 节点的 verdict 统计（runHistory 消费同一批 review-*.json）出自同一事实源，不构成第二份计票逻辑。gate --check 退 2（异常态）时如实展示 failures 摘要并提示进裁决台。

**三按钮**（均为用户显式点击，无倒计时无自动触发）：
- **批准**：`approve --topic <t> --stage <s> --json`；成功后把输出里的 `worktree_summary`（权威摘要）渲染进结果区（available=false 四态如实展示 reason）；退 2 时展示复核失败原文（不重试不绕过）。
- **拒绝**：闸门卡内嵌理由 textarea（不用 QuickPick——理由常为多行；**必填非空**，前端拦截空理由，不代填）；`approve --topic <t> --stage <s> --reject --reason <理由> --json`。
- **放弃**：modal 二次确认（「放弃将解除业务写锁，已有工件全部保留」）后 `abandon --topic <t> --stage <s> --json`（**显式传 --stage**——省略会批量放弃该主题全部开放闸门，非本意）。
按钮执行期间禁用防双击；动作完成后 state.json 迁移经 StateWatch 自动收敛闸门区（approved/rejected/abandoned 卡片变结果态后自动收起，保留最近一次结果供查看）。

### D3 工作树摘要数据源（任务书点名的取舍决策，交计划审裁决）

**推荐方案 A（双层数据源）**：
- **闸门区浮出时（点击前）**：spawn 只读 `git status --porcelain=v1 -z --untracked-files=all`（cwd=工作区根、shell:false、超时 5s、失败降级「摘要不可用」），展示为「相对 HEAD 的提示性摘要」，UI 明示口径：「⚠ 本摘要相对 HEAD，看不见闸门期已提交的改动；完整口径（自审查收尾以来）以批准时编排器输出为准」。
- **点击批准后**：展示 approve --json 的 `worktree_summary`（编排器权威口径，基线 after_tree_hash）。

**论证**（为什么不选另两个候选）：
- 候选 B（不自算，仅批准后展示权威摘要）：零新增面，但用户点击前没有任何工作树信息——审查期间的积累改动要到按下批准才可见，审批决策的信息完整性受损；
- 候选 C（重入 `gate --await-approval --json` 取其停点输出的 worktree_summary）：语义完全一致，但该命令**未表态时会主动迁移闸门状态**（六态白名单→awaiting_approval，cli.ts:1583-1597），插件的「读取」会产生状态机写副作用，且与 Driver 会话竞争「何时立停点」的职责边界——否决。
- 方案 A 的 git status 调用**不构成第三业务集成面**的理由：git 是宿主版本库的固有设施（VS Code 自身、diffView 的 git 扩展软依赖、locationResolve 的一致性判据都已消费 git 事实）；本调用纯只读（status 查询无锁无写）、不复制编排器业务语义（不碰 after_tree_hash/write-tree——那需要临时索引写，插件绝不模仿）、口径差异在 UI 层如实标注。**插件绝不做** `git add -A`/`write-tree`（编排器摘要的实现含临时索引写，属于编排器内部机制）。

### D4 FR-10 保存拦截：VS Code API 限制与落地机制（交计划审裁决）

**API 事实**（决定方案形态）：VS Code `onWillSaveTextDocument` 的 `waitUntil` 只能**挂起**保存（等 Promise resolve）与应用 `TextEdit[]`，**没有取消保存的 API**（长期 issue，1.85 无解）。

**机制**（两段式）：
1. **挂起 + 警示**：锁态≠绿 且保存目标属业务文件时，`waitUntil` 一个 modal 弹窗（`showWarningMessage(..., {modal:true}, '仍然保存', '取消')`）——弹窗期间保存被挂起（这正是「事前」拦截的时点）。
2. **「取消」= 保存前应用还原 edits**：用户选「取消」时，`waitUntil` 返回**单个全文档 TextEdit**（Range 全量 replace），内容为**挂起时刻从磁盘读到的保存前内容**（此刻磁盘尚未写入——`fs.readFile` 拿到的就是保存前快照）。edits 在保存发生前应用，于是落盘的就是旧内容：**磁盘不变**，零插件写盘，全走官方 edits 通道。用户的未保存修改从缓冲区消失但**进入 undo 栈**（Ctrl+Z 可找回），弹窗文案明示这一点（「取消：放弃本次未保存的修改（可 Ctrl+Z 找回）」）。
   - 备选机制 iv-b（保存后用 fs 写回快照、保留缓冲区修改）被否决：插件对业务文件产生一次直接写盘，违反「唯一写例外」纪律的精神；iv-a 的 edits 通道不产生任何插件写盘。
   - 残余风险如实声明：TextEdit 全量 replace 在极端巨型文档上有性能成本（VS Code 自身机制，可接受）；弹窗期间用户切窗口用外部编辑器改文件不在拦截范围（与 L2 Hook 同界的固有盲区，不宣称覆盖）。

**判定规则**（顺序短路）：scheme≠file → 放行；文档 uri 不在工作区根下 → 放行；relPath 以 `.reviews/`、`.trivium/`、`.vscode/` 开头 → 放行（编排器写入区 + VS Code 设置文件）；无活跃闸门（灯=绿）→ 放行；其余 → 拦截弹窗。警示文案含漂移后果：「审查中保存业务文件可能造成快照漂移、整轮作废」。

**三色灯**（`lampModel` 纯函数 + 状态栏 StatusBarItem，服务级，点击打开驾驶舱）：
- 🔴 审查中锁闭：任一闸门 `running`；
- 🟡 闸门等待：无 running 但存在 `raf`/`awaiting_approval`；
- 🟢 自由编辑：其余（idle/approved/rejected/abandoned/无闸门）。
approved/rejected/abandoned 到 approved 等终态的迁移经 RunEndedEvent 语义驱动灯回落（diffRunEnded 已有）。灯与拦截共用同一 StateWatch 订阅（任务书要求的数据面共用）。

### D5 FR-11 预设体系：双作用域与表单回填

**preset 对象**：`{name, scope:'workspace'|'global', createdAt, updatedAt, form: FormState}`（form 即 Cockpit 的表单快照，字段一一对应）。`presetModel` 负责序列化校验（未知字段剔除、类型防御）与版本字段（`v:1`，为将来演进留迁移点）。

**存储双作用域**：
- workspace 作用域：VS Code 配置 `trivium.presets.items`（数组，进工作区 `.vscode/settings.json`，随仓共享）；
- global 作用域：`context.globalState`（键 `trivium.presets`，用户级跨工作区）。
读取时合并展示（同名时 workspace 优先并标注来源）。**不改 `.trivium/` 任何 yaml**（G6 维持）。

**UI**：装配区一行「预设：[select 加载…] [另存为…] [删除]」——select 列出两个作用域的全部 preset（`名称（作用域）`）；加载 postMessage → webview 回填全部表单字段（含 critics chips 状态、ctxPaths 列表）；另存为弹名称 + 作用域选择（QuickPick 二选一）；删除带确认。**回填即表单变更**：CLAUDE-08 冻结语义自然生效（须重跑前置链才能点火），preset 只回填不越权点火。

### D6 当轮 Driver id 定位链（裁决草稿 role 字段的数据源）

优先级链（逐级 fallback，全部只读）：① 闸门项 `gates[...].driver`（stateModel 扩展解析）；② `.reviews/<topic>/task.json` 的 `drivers.<stage>.driver`；③ `_meta/run-<runId>.json` 的 `driver`；④ 推不出 → 裁决台顶部明示「无法定位当轮 Driver id」并禁用草稿生成（**不猜**——role 填错的代价是 gate 报 bad_front_matter，宁缺毋滥）。UI 展示定位结果供用户核对。

### D7 裁决台缺口联动批注（Phase 2 协同增强项）

缺口表单里每条编号可点击 → 宿主确保 `annotationHub.setScope(topic, stage)` + `setActiveRun(gate run_id)` → `findingsOfFocusRun()` 中按 id 匹配 → 有行锚（relPath+startLine）复用现有 open-finding 跳转（revealRange）；无锚（doc 位置/文件缺失）则 toast 展示 location 原文。id 找不到（如 fallback 编号在结构化工件外）时如实提示。**零新增数据面**——全部复用 AnnotationHub 既有锚点。

### D8 驾驶舱 UI 布局落点

cockpitHtml 新增三个区块（保持现有装配/监控/输入框结构不动）：闸门区插在「运行监控」上方（浮出语义：有闸门卡才渲染）；裁决台为模式化区块（进入时替换监控区视野，带「返回」）；预设行并入装配区。消息协议新增（webview→宿主）：`gate-pull`（拉取缺口）、`disposition-update`（表单增量）、`disposition-save`（预览确认落盘）、`approve-req`/`reject-req`/`abandon-req`、`preset-list`/`preset-save`/`preset-load`/`preset-delete`、`locate-finding`（缺口联动）；宿主→webview 对应快照推送。全部幂等快照式（沿用现有 post 模式）。

### D9 测试计划

**单测**（node --test 直跑，纯函数）：
- `gateGapModel`：真实 gate 输出夹具三件——①任务书点名的 Phase2 计划审 r1 形态（bad_front_matter 三缺 + unparsable_table + missing_findings 逐条编号，按 gate.ts 构造点手工构造 message 原文）；②evidence/m9-acceptance 的真实 bad_front_matter 输出；③全通过态（ok:true + round_line）。断言分组/编号提取/已裁决推导/坏 JSON 容错。
- `dispositionDraft`：front-matter 七字段逐字段断言（kind 按 stage、role 取定位链、addresses 形态）；表格表头对拍 agy适配1.5.2 真实件（逐列字符级）；单元格安全化（`|`/换行）；文件名生成（本地日期/rN 中缀/kind/driver 后缀）；O_EXCL 落盘成功/EEXIST 报错（注入 fs mock）；坏输入（空编号/无 run_id）容错。
- `lampModel`：七态 × 多闸门组合到三色灯全映射（含 approved 后回落绿）。
- `presetModel`：序列化/校验/未知字段剔除/回填对称性。
- `worktreeSummary`：porcelain -z 解析（修改/新增/删除/重命名、-z 分隔）→ 摘要模型；空仓/失败降级。
- `gateAreaModel`：aa 态闸门 + round_verdict → 闸门卡模型；退 2 态的 failures 摘要。

**集成**（@vscode/test-electron 真实宿主，扩展 fixtureLib）：
- `gateApproval.test.js`：夹具 writeState 造 awaiting_approval + _meta 归档（run.v3 带 round_verdict + review-*.json）→ 断言闸门卡浮出、计票正确；桩 CLI 配 `approve`/`abandon` 应答 → 点批准/拒绝（空理由被前端拦 + 有理由走通）/放弃（二次确认）→ 断言 last-args.json 的 argv（--topic/--stage/--reject/--reason 逐项）与退出码路径；state.json 迁移后闸门区收敛。
- `dispositionDesk.test.js`：桩 `gate` 应答带 failures（missing_findings.ids=[CLAUDE-01,AGY-F01]）→ 裁决台表单出现两条 → 逐条裁决输入 → 预览文本断言（对拍契约）→ 确认落盘 → 磁盘文件存在且 front-matter/表格可被（插件侧复刻的解析判据）识别 → EEXIST 场景（预置同名文件）报错不覆盖。
- `saveGuard.test.js`：writeState 造 running → 模拟保存业务文件（`workspace.save` 路径或 TextDocumentWillSaveEvent 直接触发）→ 断言弹窗拦截与「取消」后磁盘内容不变；`.reviews/`、`.trivium/`、`.vscode/` 下文件放行；终态后绿灯放行。
- `presets.test.js`：另存（两作用域）→ 列表合并 → 加载回填逐字段断言 → 删除。
- 裁决台联动：缺口编号点击 → 打开对应文件的对应行（复用 Phase2 夹具的 sample.ts 锚点）。

**验收对照**（v2 计划 §6.3）：入口 B 从「审查结束」到「approve 放行」全程无终端命令、无手工编辑工件（裁决台 + 闸门区覆盖）；审查期保存业务文件被拦并见红灯；三色灯随状态机流转。**人工验收保留项**：真实 CLI（非桩）下的端到端手感、四家 Driver 的 role 定位实跑——这两项在交付说明里列为人工清单（诚实分工，同 Phase 2 惯例）。

### D10 版本与工程面

- package.json → **0.3.0**；`contributes.configuration` 新增：`trivium.presets.items`（workspace preset 存储，type array）、`trivium.guard.saveIntercept`（bool，缺省 true，总开关）。commands 新增：`trivium.gate.refresh`（闸门区刷新）等如需。
- `extension/` 独立包自检（`npm run check` = typecheck + compile + test）须绿；主仓 `npm run check` 不受影响（不触主仓 src/）。
- 主仓 `.trivium/config.yaml` 的 verify 接线维持现状不动的裁决（AGY-03 维持）——S10 verify 走主仓既有配置。

## 四、实施步骤（S5 内序）

1. `cli/commands.ts`：gateCheck/approve/abandon 封装 + 输出类型（GateCheckOutput/GateApprovalOutput）。
2. 纯函数层：gateGapModel → dispositionDraft → lampModel → gateAreaModel → presetModel → worktreeSummary（每件配单测）。
3. `stateModel` 扩展（rerunIndex/driver）+ 状态回归。
4. `guard/saveGuard.ts`（拦截 + 三色灯）+ `extension.ts` 装配 + 集成测试 saveGuard。
5. `presets/`（store 双作用域）+ cockpit 表单区 UI + 集成测试 presets。
6. cockpit 闸门区（感知/计票/三按钮/摘要双层）+ 集成测试 gateApproval。
7. cockpit 裁决台（缺口表单/草稿预览/确认落盘/联动批注）+ 集成测试 dispositionDesk。
8. suite.ts 登记新测试文件；package.json 0.3.0；README 增补 Phase 3 使用说明一节。
9. `npm run check`（extension 内）全绿；主仓 `npm run check` 复跑确认不破坏。

## 五、验收清单（对照 v2 计划 §6.3 + 任务书）

- [ ] FR-8：gate 缺口→表单→契约草稿→预览确认→落盘全链路；草稿 front-matter/表格与真实件对拍一致；EEXIST 不覆盖不抬升；role 定位链四级 fallback。
- [ ] FR-9：awaiting_approval 浮出闸门卡；计票 = round_verdict 原样；批准/拒绝（必填理由）/放弃（二次确认）argv 经桩断言；带外性（无自动触发、无倒计时）。
- [ ] FR-10：running/raf/aa 期业务文件保存被挂起弹窗，「取消」后磁盘不变；.reviews/.trivium/.vscode 放行；三色灯全状态映射。
- [ ] FR-11：preset 两作用域存取、加载回填全字段、删除；不写 .trivium。
- [ ] 协同：缺口编号点击→行内定位；闸门计票与历史树 verdict 同源（同一批 review-*.json 派生）。
- [ ] 工程面：extension check 绿；主仓 check 不破坏；UI/注释全中文；集成面仍仅 CLI + 文件面（+D3 论证的只读 git status）。

## 六、风险与对策

| 风险 | 等级 | 对策 |
| :--- | :---: | :--- |
| VS Code 无取消保存 API，edits 还原机制在特殊场景（超大文档/多编辑器同文档）行为不稳 | 中 | 集成测试覆盖主路径；弹窗文案不承诺「绝对拦截」，只承诺挂起+选择；残余盲区如实声明（外部编辑器、非 file scheme） |
| addresses 推导（review md 文件名 ↔ runId 映射）在异常留痕下推不出 | 中 | 预览页允许手工编辑 addresses 再生成；gate --check 兜底（addresses 比对是闸门校验项） |
| 桩 CLI 与真实 CLI 输出漂移 | 中 | 夹具 JSON 取自真实 evidence 样例与 gate.ts 构造模板；真实链路留人工验收清单 |
| worktree_summary 的 approved-only：拒绝路径无权威摘要 | 低 | 拒绝路径展示点击前的提示性 git status 摘要（口径已标注）；如实呈现 |
| preset 存 workspace settings 与用户手工编辑冲突 | 低 | 读取容错（坏条目剔除并提示）；写走 vscode.workspace.getConfiguration().update（VS Code 自身原子性） |
| gate --check 在 aa 态被并发审查改变输出 | 低 | 快照式展示 + 手动刷新；不缓存判定 |

## 七、交付物清单

- `extension/src/`：新增 8 个模块 + 改 5 个（见 §二）。
- `extension/test/`：单测 6 件 + 集成 4 件 + fixtureLib 扩展 + suite.ts 登记。
- `extension/package.json` 0.3.0、`extension/README.md` Phase 3 一节。
- 交付说明（.reviews/VSCode插件Phase3/code/ 的 Driver 交付件，含人工验收清单）。
