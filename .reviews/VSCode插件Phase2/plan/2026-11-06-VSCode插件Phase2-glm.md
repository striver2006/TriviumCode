# VSCode插件Phase2 · 实施计划（r1 原稿）

- 主题：VSCode插件Phase2
- 执笔：glm（Driver，ZCode 桌面端会话）
- 日期：2026-11-06
- 基线：分支 `feat/vscode-extension`，HEAD `2be1ca88`；CLI 1.3.5；extension 包 0.1.0（第一批已交付）
- 依据：v2 计划 §6.2（Phase 2 验收标准）+ §4.3 FR-6/FR-7 + §7 测试策略；第一批交付说明（`.reviews/VSCode插件Phase0-1/code/2026-11-06-VSCode插件Phase0-1-交付说明-glm.md`）登记的 P1 遗留人工验收项并入本批
- 参数：critics=claude,gemini,codex；max-rounds 5（plan/code 同值）

## 〇、要解决的问题与范围

**任务目标**：在已交付的 `extension/` 独立包之上实施 v2 计划 §6.2 Phase 2——审查结果结构化展示：FR-6（意见列表 / 行内批注 / Problems / Diff 视图）+ FR-7（运行历史与回放），并把第一批遗留的人工验收项（F5 GUI 走查、真机注入矩阵、入口解析保真）并入本批验收执行与记录。

**交付清单**：
- FR-6a 意见列表：消费 `.reviews/{主题}/{阶段}/_meta/review-*.json`（review.v2），按审查者分组、severity 分级，侧完成后实时刷新；
- FR-6b 行内批注：location 归一 + 行号 fuzzy 校验 → VS Code Comments API，同文件多家分层、逐家开关，漂移显式标注；
- FR-6c Problems：findings → Diagnostics（blocker/major→Error、minor→Warning、nit→Information）；
- FR-6d Diff 视图：意见关联变更在 Diff 编辑器查看（复用 `_meta/changes-*.diff`）；
- FR-7 运行历史：`run_root` 扫描 + `task.json` → 主题/运行列表（时间线、逐轮意见数与严重度分布），点击回放；
- P1 遗留验收执行与记录（详见 D10）。

**范围边界**：不在本批——FR-8 裁决台、FR-9 审批、FR-10 保存拦截、FR-11 预设、FR-13 发布（仅保证 `vsce package` 可打包）；E1/E2/E3；M2；P3/P4 全部。**不改核心仓 `src/`、`skills-src/`、`skills/`、`test/` 与主仓构建配置**；`.trivium/config.yaml` verify.test 仍不接线（AGY-03 裁决维持）。平台边界沿用第一批：macOS（darwin/arm64）。

**硬约束（违反即不合格）**：集成面仅 CLI（--json + 退出码）与文件面（只读 watcher）；零复制编排器业务逻辑；review.v2 校验走既有 versionCheck 支持集机制（新增 `review: 'trivium.review.v2'`，逐文件降级语义不变）；不直写 `.trivium/*.yaml` 与 `.reviews/`（Comments/Diagnostics 是内存对象不落盘）；不改用户全局配置；UI 与注释全中文；批注生命周期正确清理、漂移不静默；extension 独立包 check 须绿且主仓 `npm run check` 不被破坏。

## 一、事实基线（本轮源码/工件核实）

沿用第一批 r2 计划的九条事实与第 10~15 条新增。本轮新核实：

16. **review.v2 契约**（`skills/dual-critic/schema/review.v2.json`）：根字段 `schema/verdict(pass|pass-after-changes|reject)/summary/findings`，finding 必填 `id/severity(blocker|major|minor|nit)/layer/kind/location/problem/evidence/suggestion/confidence(high|medium|low)`，可选 `agreed/not_covered/consulted`；id 形如 `CLAUDE-01`、重跑 `AGY-r2-01`。
17. **真实工件形态**（`.reviews/VSCode插件Phase0-1/code/_meta/`）：`review-<critic>-<runId>.json` 逐侧逐轮一份；`changes-<runId>.diff` 头部为 `# trivium changes.diff / # run_id / # base / # head / # files: N` + 相对路径清单，正文为统一 diff；另有 `run-<runId>.json`、`brief-*.md`。**location 实测形态**：`extension/src/extension.ts:23-29；extension/src/ui/cockpit.ts:104-131`（中文分号分隔多位置、行区间）、`plan §3.2`（非文件引用）——归一器必须处理多位置与非文件形态。
18. **task.json 形态**（`trivium.task.v1`）：`runs[]` 含 `run_id/stage/rerun_index/status/review_mode/started_at/driver`；`gate` 段为当前闸门；`drivers` 按阶段记录执笔。FR-7 的时间线以它为主轴，run 目录 `status.json` 补 phase/sides/时长。
19. **run_root 桶名**：`<工作区目录名>-<hash8>`（如 `TriviumCode-2217d505`），同 runId 可能跨仓撞号——历史扫描沿用 runDiscovery 的归属纪律（桶前缀过滤 + status.topic 比对，不唯一不接管）。
20. **Comments API 无公开枚举面**：`vscode.comment` 只能建线程，没有「列出 controller 已建线程」的公开 API——集成测试不能直接断言 VS Code 内的线程；断言走 AnnotationHub 的内部可观测面（第一批 `runStates()` 先例），Diagnostics 走 `languages.getDiagnostics()` 公开查询。
21. **第一批 P1 遗留**（交付说明 §四）：就绪延迟四家未标定（缺省 3000ms 可配）；sendText 真机逐家模式未定档（缺省 execute）；入口解析保真（真 dual-run 比对 task_goal）未执行；F5 GUI 端到端走查待人工。

## 二、总体架构（新增/改动模块）

```
extension/src/
├── env/versionCheck.ts         【改】SUPPORTED_SCHEMAS 增 review: 'trivium.review.v2'
├── reviews/                    【新目录】
│   ├── reviewParse.ts          review.v2 解析：文件名→(critic,runId)、schema 校验、逐条容错（单条缺字段跳过计数、整份坏文件降级计数）
│   ├── locationResolve.ts      location 归一（多位置拆分/引号/workdir 前缀/绝对路径/非文件形态）+ 行号 fuzzy（锚文本提取→精确/邻近/文件级降级，漂移原因枚举）
│   ├── annotationModel.ts      纯函数层：resolved findings → 线程/诊断描述模型（severity 映射、同文件同行合并、量级阈值、逐家过滤）——VS Code 对象由 Hub 装配
│   ├── annotationHub.ts        VS Code 侧：CommentController + DiagnosticCollection、scope 绑定与切换、metaWatch 接入、可观测面（threadsSnapshot）
│   ├── metaWatch.ts            `_meta/` 目录 watcher（review-*.json / changes-*.diff 落盘事件，vscode watcher + 全量 rescan，对齐 reviewWatch 形态）
│   └── diffView.ts             changes.diff 头部解析（变更集成员 + hunk 行号）+ Diff 编辑器打开（内置 git 扩展软依赖，降级打开文件）
├── history/                    【新目录】
│   ├── runHistory.ts           主题/运行扫描合并（.reviews/*/task.json + run_root 桶扫描归属）、逐轮意见统计（severity 分布、verdict）
│   └── historyProvider.ts      TreeView `triviumHistory`（主题→运行两级）、刷新命令、点击回放接线
├── ui/cockpit.ts               【改】RunCard 增 findingsSummary/意见列表数据面；attachRun 挂 metaWatch；open-finding/open-diff/toggle-critic 消息处理
├── ui/cockpitHtml.ts           【改】run 卡片内意见列表区（按审查者分组折叠、severity 徽标、location 跳转、Diff 按钮）
├── extension.ts                【改】注册 AnnotationHub（services 持有）、历史树视图与命令
├── services.ts                 【改】services 增 annotationHub
└── package.json                【改】version 0.2.0；commands/views/configuration（triviumHistory 视图、trivium.history.refresh、trivium.reviews.focus、trivium.critics.filter、trivium.openDiff；配置 trivium.reviews.maxThreadsPerFile 等）
extension/test/
├── unit/  reviewParse / locationResolve / runHistory / annotationModel / versionCheck（扩展）
├── integration/  annotations.test / history.test / cockpitFindings.test（fixtureLib 扩展：_meta 工件 + 源文件 + changes.diff + 多 run 目录）
```

**不改**：`cli/`、`env/config.ts`、`env/health.ts`、`launch/`、`monitor/` 既有模块（reviewWatch 保持只管 md 正文；statusWatch/stateWatch 不动）；主仓除本计划新增文档外零改动（预计 `.gitignore` 无需再动）。

## 三、关键设计决策

### D1 review.v2 消费与逐文件降级（FR-6a 数据面）

- `reviewParse.parseReviewFile(absPath, fileName)`：文件名 `review-<critic>-<runId>.json` 解析出 critic/runId（不匹配命名模式 → 记 `unrecognized`，不出意见）；内容 JSON.parse 失败 → `parse-error` 降级；`checkSchema(schema,'review')` 非 ok（v1 旧件或未知串）→ `unsupported-schema` 降级，**只降该文件**：意见列表显示「该侧工件版本不支持（trivium.review.v1），未展示」，**不进全局 degradedReason**——全局禁点火是 config/state/status 三源语义（CODEX-07），review 是消费侧逐文件，混入会让旧归档主题无法点火。versionCheck 的 `SUPPORTED_SCHEMAS` 增 `review` 项，`checkSchema`/worstVerdict 逻辑零改动。
- finding 级容错：单条缺必填字段或枚举外值 → 跳过该条并计入 `skipped`（不整份丢弃）；`findings: []` 合法（显示「无意见」+ verdict）。
- 夹具策略：单测优先读主仓真实工件（`.reviews/VSCode插件Phase0-1/{plan,code}/_meta/` 具名三件 + 含 nit/minor 的历史工件），路径探测不到（独立分发）则回退内联样例并断言降级路径——同一套断言跑两种来源。

### D2 location 归一与行号 fuzzy（FR-6b 前置）

归一（纯函数，`normalizeLocation(loc, workspaceRoot)`）：
1. 多位置拆分：中文/ASCII 分号 `；;` 分隔，逐段独立归一，主锚点取第一段（其余进次级锚点列表，批注正文可引用）；
2. 单段：剥首尾引号 → 剥 `./` 前缀 → 绝对路径时截取 workspaceRoot 之后的相对段（workdir 前缀剥离；不在 workspaceRoot 下则整段无效）→ `path:line[-endLine]` 拆分（line 非 数字 → 无行号）；
3. 非文件形态（如 `plan §3.2`、无扩展名且无行号的词组）→ `{kind:'doc'}`：只进意见列表，不建 thread/诊断。

行号校验（`resolveAnchor`，注入 `readFile`）：
- 文件不存在 → `{level:'missing-file'}`：进意见列表并标注「文件缺失」，不建 thread/诊断（两者都要存在的 URI）；
- **锚文本提取（best-effort）**：从 problem/evidence 提取反引号包裹的代码片段（≥8 字符）作为期望行内容——真实工件中审查员并非总给代码引用，提取不到是常态；
- 有锚文本：目标行 trim 后包含锚（或相等）→ 精确命中；否则在 ±20 行窗口内搜包含行 → `{level:'line', drift:'nearby'}`（显式标注邻近命中）；找不到 → `{level:'file', drift:'line-lost'}`；
- 无锚文本：行号 ≤ 文件总行数 → 直接行级（不强制内容对照——锚提取覆盖率低，强校验会制造大量假漂移）；越界 → `{level:'file', drift:'out-of-range'}`；
- 漂移一律显式：thread 标签、诊断 message、意见列表三处统一「⚠ 漂移（原因，原 L<N>）」前缀，无静默。

### D3 批注宿主与呈现（FR-6b/6c）

- `AnnotationHub`（services 持有，activate 建、deactivate 释放）：`CommentController('trivium.reviews')` + `DiagnosticCollection('trivium.reviews')`；
- 线程粒度 `(uri, 主锚点行)`：同文件同行多 finding → 同 thread 多 comment（分层 = `comment.author.name` 为审查者显示名 + thread.label 标 severity 概览如 `[blocker×1 major×2] claude 2 条 ｜ gemini 1 条`）；comment mode=Preview（只读展示，不提供回复入口——commentingRangeProvider 不注册，用户回复属 P3 裁决台语义）；
- Diagnostics：severity 映射 blocker/major→Error、minor→Warning、nit→Information；`code=finding.id`、`source='TriviumCode 审查'`、message 首行 `id · problem 摘要`；行级 finding 的 range 与 thread 同源（同一 annotationModel 输出），跳转天然一致；文件级/漂移 → range 定位文件首行 + 「⚠ 漂移」前缀；
- **逐家开关**：`trivium.critics.filter` 命令（QuickPick 多选当前 scope 出现过的审查者）+ 驾驶舱意见列表分组头 checkbox，切换即全量重建线程与诊断（量级小，重建幂等）；
- 数据流：`setScope(topic, stage)` 全清旧 → 挂焦点 run；活跃 run 期间 metaWatch 事件触发该 run 增量合入（实现为「重算受影响文件并重建」，幂等）；`threadsSnapshot()` 可观测面供测试。

### D4 绑定模型：批注与运行/主题的切换（任务书必答项）

- **scope = {topic, stage}，scope 内单一焦点 run**：焦点 run = 活跃 run 中最新者；无活跃 run 时取该阶段最新一条有意见工件的 run（按 runId 时间序）。同主题同阶段新 run 出现（重审）→ 自动切到新 run（旧轮批注清除，意见历史仍可从历史树回看）。
- **切换呈现策略**：`setScope`/`setActiveRun` 均走「全清 → 重建」：controller 线程逐个 dispose + diagnostics.clear() 再重建——不留旧 run 批注残影，也杜绝孤儿诊断；历史树点击任意 run → 回放该 run 全部意见（含批注/诊断/意见列表聚焦）。
- **生命周期**：批注生命周期独立于驾驶舱面板（面板关闭批注保留——用户要看码时面板通常关着）；run 结束批注保留；工作区关闭/扩展停用（dispose）全清；「当前批注来源」在状态栏显示（`批注：主题/阶段 · runId · N 家 M 条`，点击弹 QuickPick 切换 run）。
- 焦点 run 的意见合入不影响 FR-6a 列表：驾驶舱 run 卡按 run 分组天然隔离；历史树节点统计按 run 聚合。

### D5 Diff 视图（FR-6d）

- `_meta/changes-<runId>.diff` 头部解析（只读 `#` 注释段 + `@@` hunk 头行，不整份进模型）：得到变更集成员清单与每文件 hunk 的 head 侧行区间；成员判定 → finding 的 relPath 在清单中才提供「查看 Diff」动作；
- 打开：`vscode.diff(gitUri(HEAD), 工作区文件 URI, 标题)`，gitUri 经**内置 git 扩展公开 API**（`vscode.extensions.getExtension('vscode.git')` → `exports.getAPI(1).toGitUri`）软依赖——不可用（非 git 仓库/扩展被禁）时降级为直接打开文件 + 信息提示「无 git 基线」；plan 阶段无 changes.diff → 同样只打开文件；
- 定位：diff 打开后 `revealRange` 到 finding 行（右侧 panerange 与 D2 锚点同源）；hunk 头行区间可用于辅助提示「该意见行位于被审变更内/外」。

### D6 运行历史（FR-7）

- `runHistory.listTopics(reviewsRoot)`：扫 `.reviews/*/task.json` → 主题节点（创建/更新时间、run 计数、末次状态、drivers）；
- `listRuns(topic)`：task.json `runs[]` 为主轴（时间线：run_id、stage、rerun_index、status、driver、started_at），逐 run 到 run_root 桶扫描补 `status.json`（phase、sides 时长、message 摘要）——**归属同 runDiscovery 纪律**：桶前缀（工作区名）过滤 + `status.topic === topic` 比对，0 或 >1 命中不接管，节点降级显示 task.json 基础信息并标注「run 目录未定位」；
- 逐轮意见统计：读该主题该阶段 `_meta/review-*.json` 按 runId 分组 → 每侧 verdict + severity 计数（blocker/major/minor/nit + 总数），树节点 description 呈现（如 `code r2 · 成功 · 3 侧 · 12 条（2 blocker ｜ 4 major）`）；
- TreeView `triviumHistory`（Activity Bar Trivium 容器内第二视图）：主题（可折叠）→ 运行（按时间倒序）；标题栏刷新按钮；点击 run 节点 → `setScope` + `setActiveRun` 回放批注 + 状态栏更新；节点上下文命令「打开审查正文」（md 工件）/「查看该轮 Diff」（FR-6d 复用）；扫描惰性（树可见/刷新时），不做常驻 watcher。

### D7 驾驶舱意见列表（FR-6a UI）

- RunCard 扩展：`findingsSummary`（逐侧 verdict + severity 计数）+ `findings`（逐条：id、severity、critic、location 原文、problem 摘要、漂移标注、resolvedLevel）；
- 渲染：run 卡内 details 折叠区，按审查者分组（组头 = 侧名 + verdict 徽标 + 计数 + 分层开关 checkbox）；条目行 = severity 徽标（blocker 红 / major 橙 / minor 黄 / nit 灰）+ id + problem 一行摘要 + location 链接；点击条目 → `open-finding`（宿主定位 thread/诊断并跳转）+ 「Diff」按钮（变更集成员才有）；
- 实时刷新：`attachRun` 起挂 metaWatch（同一 run 生命周期内），侧完成文件落盘 → 重推 runCards；run 结束 metaWatch 随 RunWatch 释放（意见数据已进 Hub，不需继续 watch）。

### D8 性能量级控制（任务书必答项）

- **意见量**：真实规模 = 3 侧 × 10~30 条/轮，量级小；防御性上限——scope 总 findings > 2000：只挂 Problems（诊断仍全量）+ 列表提示「意见过多，行内批注已折叠」；单文件线程数 > `trivium.reviews.maxThreadsPerFile`（缺省 200）：超出部分仅进 Problems 并在列表标注；comment 正文 evidence 截断 500 字；
- **watcher 面**：metaWatch 仅活跃 run 期间存在；历史扫描按需触发（树刷新/驾驶舱打开），多主题目录扫描限制在本仓 `.reviews/`（工作量 = 目录数 × task.json 读取，千级文件毫秒量级）；
- **diff 面**：changes.diff 只解析头部与 hunk 头（`#` 与 `@@` 行），不建全文模型；Diff 渲染由 VS Code 原生承担（base 由 git 扩展按需提供，插件不缓存文件内容）；
- **Webview**：意见列表 details 默认收起、条目摘要定长截断，postMessage 快照式推送不变（沿用第一批幂等渲染约定）。

### D9 测试计划

单元（node --test，无 VS Code）：
- `reviewParse.test`：真实工件三件（三家 verdict/severity 全档——nit/minor 样本从本仓历史主题工件补齐）+ 缺字段容错（单条跳过计数）+ 坏 JSON + v1 旧 schema 降级 + 命名不识别；
- `locationResolve.test`：相对/带引号/`./` 前缀/绝对路径截取/workspace 外绝对路径/中文分号多位置/`plan §3.2` 非文件/不存在文件；
- `annotationModel.test`：severity→DiagnosticSeverity 映射四档、同行多 finding 合并、多侧分层结构、量级阈值触发（构造超限夹具）、逐家过滤、漂移标注进模型标签；
- `runHistory.test`：夹具 run_root（两桶 × 多 run，含他仓撞号桶）+ task.json → 主题/运行合并、归属不接管、统计计数正确；
- `versionCheck.test`（扩展）：review 项 ok/v1 降级/未知串。

集成（@vscode/test-electron 真实宿主，fixtureLib 扩展 `_meta` 工件 + 源文件 + changes.diff + 多 run 目录）：
- `annotations.test`：源文件 + 三家 review JSON（含行号越界与锚文本邻近命中夹具）→ 断言 threadsSnapshot 数量/行号/severity 映射/同行分层/逐家开关重建/漂移标注；`languages.getDiagnostics` 断言诊断数量与 severity/range；切换 scope 后旧批注全清（无孤儿）；
- `history.test`：夹具 run_root 多运行目录 + task.json → 树数据快照、点击回放后批注挂载正确、run 目录未定位时降级节点；
- `cockpitFindings.test`：run 卡 findingsSummary/意见列表 postMessage 断言、metaWatch 落盘事件触发刷新；
- 既有 34 项集成回归不红。

### D10 P1 遗留人工验收（并入本批，诚实分工）

- **入口解析保真（真 dual-run 全链比对 task_goal）**：本主题 VSCode插件Phase2 就是一次真 dual-run（glm/ZCode 桌面端驱动）——S5 完成后读 `.reviews/VSCode插件Phase2/task.json` 的 goal 与用户正文逐字比对，结论（含差异说明，如单引号转义、花括号改法）写入交付说明。**本项由 Driver 执行，零额外配额**。
- **F5 GUI 走查 + 真机注入矩阵（就绪延迟标定、sendText 模式定档）**：需要 GUI 与真机四家 CLI 会话，**Driver 无法代跑**；本批交付：走查清单（含 Phase 2 新增路径：意见列表→行内批注→Problems→Diff→历史回放）+ 标定流程与 carrierOverrides 样例 + 结论记录模板，全部进交付说明附录，由用户执行勾选；**用户未执行的项如实标「待人工」，不宣称通过**。glm 侧通道保真已有 fakeTUI 字节级自动化代偿（第一批 D8 矩阵），不重复投入。

### D11 版本与构建

- `extension/package.json` version → 0.2.0；`npm run check --prefix extension`（typecheck + compile + 单测 + 集成）全绿；主仓 `npm run check` 回归不破坏；`vsce package` 可打包；e2e（TRIVIUM_STUB_CRITIC 桩）回归通过。

## 四、实施步骤（S5 内序）

1. versionCheck 扩展 + reviewParse + locationResolve（纯函数层）及单测；
2. annotationModel + 单测（量级阈值/分层/映射）；
3. AnnotationHub + metaWatch + services/extension 接线；
4. 驾驶舱意见列表（cockpit.ts / cockpitHtml.ts）+ QuickPick 逐家开关；
5. diffView（changes.diff 头解析 + git 软依赖）；
6. runHistory + historyProvider 树 + 回放接线 + 状态栏；
7. fixtureLib 扩展 + 三个集成测试文件；
8. extension check 全绿 + 主仓 check 回归 + e2e + vsce 打包；
9. 入口解析保真比对（本主题 task.json vs 用户正文）；
10. 交付说明（含 P1 遗留验收清单/模板/分工边界）。

## 五、验收清单（对照 v2 计划 §6.2 + 本批附加项）

- [ ] 一次真实运行结束后（TRIVIUM_STUB_CRITIC 桩驱动或本主题真运行），意见以行内批注呈现、点击跳转准确（集成测试 + GUI 走查项）；
- [ ] Problems 按 severity 聚合（四档映射正确，集成断言）；
- [ ] 历史列表可回放过往主题（集成断言 + 走查项）；
- [ ] 同一文件多家意见分层不互相覆盖（同行合 thread 多 comment，集成断言）；
- [ ] 漂移显式标注、文件级降级路径有测；切换 scope/run/工作区关闭无孤儿诊断（集成断言）；
- [ ] review.v2 逐文件降级：v1 旧件/坏件不产出意见且明示原因，不影响其它文件与点火（单测）；
- [ ] extension check 全绿、主仓 check 不破坏、e2e 通过；
- [ ] 入口解析保真比对结论入档；F5 走查与真机矩阵清单入档（用户执行项标「待人工」）。

## 六、风险与对策

| 风险 | 等级 | 对策 |
| :--- | :---: | :--- |
| Comments API 无公开枚举面，集成测试无法直查 VS Code 线程 | 中 | 以 threadsSnapshot() 内部可观测面断言 + 诊断走公开 API；GUI 呈现进 F5 走查清单（D10） |
| 内置 git 扩展 API 形态变动/被禁用 | 低 | 软依赖 + 降级打开文件 + 明示原因；集成测试两条路径都测 |
| location 锚文本提取覆盖率低（审查员不总给代码引用） | 中 | best-effort 设计：无锚时界内即接受，不制造假漂移；有锚才做对照与邻近搜索（D2 已述） |
| 历史 run 目录跨仓撞号 | 低 | 沿用 runDiscovery 归属纪律（桶过滤 + topic 比对），不唯一不接管并明示 |
| 多意见/大 diff 场景性能 | 低 | D8 阈值与惰性扫描；真实规模远低于阈值 |
| `.reviews` 内中文路径 watcher 事件 | 低 | 与第一批 reviewWatch 同机制（vscode watcher + 全量 rescan 幂等），已验证 |

## 七、交付物清单

- 代码：`extension/src/reviews/`（6 文件）、`extension/src/history/`（2 文件）、改动 5 个既有文件（versionCheck/cockpit/cockpitHtml/extension/services/package.json）；
- 测试：单测 4 新文件 + versionCheck 扩展；集成 3 新文件 + fixtureLib 扩展；
- 文档：交付说明（`.reviews/VSCode插件Phase2/code/`，含 verify 记录、入口保真比对、P1 遗留验收清单与模板）；
- 打包：`trivium-cockpit-0.2.0.vsix` 可出（不承诺市场发布）。
