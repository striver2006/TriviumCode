# VSCode插件Phase2 · 实施计划（r2 · 定稿）

- 主题：VSCode插件Phase2
- 执笔：glm（Driver，ZCode 桌面端会话）
- 日期：2026-11-06
- 基线：分支 `feat/vscode-extension`，HEAD `2be1ca88`；CLI 1.3.5；extension 包 0.1.0（第一批已交付）
- 依据：v2 计划 §6.2 + §4.3 FR-6/FR-7 + §7 测试策略；计划审第 1/5 轮三侧意见（claude 9 条 / gemini 6 条 / codex 6 条，21 条全部接受，裁决见 `…-revised-glm.md`）

## 相对上一轮的改动（第 1/5 轮审查，21 条全接受）

1. **CODEX-01 / CLAUDE-02 / AGY-06（Diff 冻结基线，交叉命中）**：Diff 左侧从「查看时 HEAD」改为**该 run 的冻结 head sha**（changes.diff 头 `# head:` 字段，经内置 git 扩展 `toGitUri`）；右侧为当前工作区文件并在 Diff 标题明示「右侧为当前文件」；新增文件（`--- /dev/null`）→ 打开文件 + 提示「本轮新增，无基线版本」；删除文件（`+++ /dev/null`）→ 打开 sha 侧只读基线 + 提示；head 对象缺失（GC/浅克隆）或 git 扩展不可用 → 降级打开文件 + 明示原因。补「HEAD 前进后回放同一 run」「--base 自定义送审」用例。
2. **CODEX-02 / CLAUDE-01（快照一致性判据，交叉命中）**：D2′ 定义两层判据——挂载前静态校验（code 阶段且 git 可用且 run 有 head sha 时比对工作区文件与该 sha 的 blob，不一致→该文件意见整体标「⚠ 与送审版本不一致」）+ 挂载后动态校验（Hub 记每挂载文件内容 hash，onDidChange/SaveTextDocument 命中即重算，失配触发重锚或显式标注「文件已编辑」）。run-<id>.json 的 snapshot 段（git_head/tree_hash/after_tree_hash）作 run 身份展示，不复制编排器哈希算法。
3. **CODEX-03 / AGY-01（metaWatch 服务级，交叉命中）**：metaWatch 从 cockpit.attachRun 提升至 **AnnotationHub 持有**（服务级，随 scope 启停、监听 `{archiveRoot}/{topic}/{stage}/_meta/`）；Cockpit 退化为 Hub 订阅者。M3「从未打开面板」与「面板关闭后侧完成」两个场景都被覆盖；补对应集成测试。
4. **CODEX-04（入口保真分三层）**：D10′ 如实拆分——(a) 字节级注入通道（fakeTUI 自动化，已有）；(b) 入口解析保真（本主题真 dual-run 比对，Driver 执行）；(c) 插件全链点火（装配→整形→sendText→真会话，GUI 真机，用户执行项）。不互认替代。
5. **CODEX-05（条件性验收）**：P1 人工项（F5 走查、延迟标定、sendText 定档、插件全链点火）列为条件性验收：S5 后 Driver 主动请用户执行（清单+模板）；执行并记录则关闭，用户延后则如实标「未执行、留待用户」，不把模板当通过；范围是否调整由用户明示。
6. **CODEX-06 / CLAUDE-03（文件关闭语义，交叉命中）**：D4′ 明确——Comments 线程由 VS Code 随文档生命周期管理（关闭隐藏、重开恢复），Diagnostics 按 Problems 语义常驻（归属为 scope，非孤儿）；主动清理只在 scope/run 切换与 dispose。补「关闭→重开→恢复且不重复、无残留」测试；multi-root 固定首个 root 登记为后续边界。
7. **CLAUDE-04（FR-6d 测试落点）**：新增 `diffParse.test` 单测（头部字段/`diff --git` 与 `+++` 分界/hunk 归属/新增删除判定/多文件）与 `diffView.test` 集成（git 可用两路 + 降级三路 + 定位行号）；风险表承诺与测试文件一一对应。
8. **CLAUDE-05（行区间贯通）**：annotationModel 显式携带 [startLine,endLine]，thread 与 diagnostic 的 Range 同源生成；漂移邻近命中为重定位行单行区间；文件级取首行；open-finding reveal 同区间。多行 location 断言进单测与集成。
9. **CLAUDE-06（降级状态贯通 UI）**：新增逐文件状态模型 `ReviewFileStatus{critic,runId,state:ok|partial-skipped|parse-error|unsupported-schema|unrecognized,actualSchema,skippedCount,notice}`，reviewParse 输出、驾驶舱与历史树共同消费；部分坏 finding/整份坏 JSON/v1 旧件三形态展示断言进集成。
10. **CLAUDE-07（路径防逃逸）**：归一统一 `path.resolve(workspaceRoot, rel)` 后 containment 判定，越界只进意见列表并标注「路径越界」；`../`、嵌套上溯、伪装前缀目录进单测；symlink 不解析（登记边界）。
11. **CLAUDE-08（邻近搜索与边界行号）**：锚文本邻近搜索多匹配 → 判歧义降文件级、标注「多处命中」；line<1/非数字/有路径无行号 → 无行号文件级（标注「未给行号」，区别于漂移）；重复锚、0、负数用例进测试。
12. **CLAUDE-09（用户可见文档同步）**：extension/README.md 功能段、package.json description、doc/08_project/README.md 维护记录纳入实施步骤与交付清单；「改动 5 个既有文件」计数修正。
13. **AGY-02（逗号多区间）**：行号部分支持 `L1-L2,L3-L4` 逗号分隔多区间/离散行，第一区间为主锚点、其余次级；真实工件形态（`cockpit.ts:418-424,524-530,533-546`）进单测夹具。
14. **AGY-03（锚文本降为启发式）**：反引号文本不再作行号有效性否决条件——只在确认失配（越界/文件已变）后作重定位启发式，且空白归一化比对（`pool.length===1` vs `pool.length === 1` 不误判）；行号有效性改由第 2 条的一致性判据承担。
15. **AGY-04（diff 文件分界行）**：diff 解析状态机增加 `diff --git a/… b/…`（及 `+++ b/…` 兜底）前缀解析，hunk 归属到文件；用例进 diffParse 单测。
16. **AGY-05（历史第一事实源）**：完结运行以 `_meta/run-*.json` + review-*.json 为第一事实源；run_root 仅活跃运行或归档缺失时探测；「run 目录未定位」不再是已归档运行的异常标签。

——以下为合入后的完整计划。

## 〇、要解决的问题与范围

**任务目标**：在已交付的 `extension/` 独立包之上实施 v2 计划 §6.2 Phase 2——审查结果结构化展示：FR-6（意见列表 / 行内批注 / Problems / Diff 视图）+ FR-7（运行历史与回放），并把第一批遗留的人工验收项（F5 GUI 走查、真机注入矩阵、入口解析保真）并入本批验收执行与记录。

**交付清单**：FR-6a 意见列表（review.v2 消费、按审查者分组、severity 分级、侧完成实时刷新）；FR-6b 行内批注（location 归一 + 行号校验 + 快照一致性 → Comments API，分层合并、逐家开关、漂移显式）；FR-6c Problems（四档 severity 映射）；FR-6d Diff 视图（冻结基线）；FR-7 运行历史（主题/运行列表、逐轮统计、回放）；P1 遗留验收执行与记录（D10′ 分层）。

**范围边界**：不在本批——FR-8/9/10/11/13（仅保证 `vsce package` 可打包）、E1/E2/E3、M2、P3/P4 全部、Windows、multi-root 工作区（固定首个 root，登记后续批次）。**不改核心仓 `src/`、`skills-src/`、`skills/`、`test/` 与主仓构建配置**；`.trivium/config.yaml` verify.test 仍不接线（AGY-03 第一批裁决维持）。

**硬约束（违反即不合格）**：集成面仅 CLI（--json + 退出码）与文件面（只读 watcher）；零复制编排器业务逻辑；review.v2 校验走 versionCheck 支持集（新增 `review: 'trivium.review.v2'`，逐文件降级）；不直写 `.trivium/*.yaml` 与 `.reviews/`；不改用户全局配置；UI 与注释全中文；批注生命周期正确、漂移不静默；extension check 须绿且主仓 `npm run check` 不破坏。

## 一、事实基线

沿用第一批 r2 计划事实 1~15 与 r1 事实 16~21，本轮新增核实：

22. **changes.diff 头部含冻结身份**：`# head: <sha>`（如 `7bae8100…`）与 `# base:`（可能为字面 HEAD 或自定义 ref）逐 run 冻结——Diff 回放的基线来源；`diff --git a/… b/…` 与 `--- a/…`/`+++ b/…` 是 hunk 的文件归属分界（`/dev/null` 标新增/删除）。
23. **run-<id>.json 的 snapshot 段**：git_head、tree_hash、after_tree_hash、subject_sha256——run 身份与展示用；逐文件一致性判定不复制哈希算法，用 git blob 比对 + 插件自算内容 hash。
24. **run_root 是可轮转清理的临时区**（retention 30 天，SessionStart 已见清理播报）：已归档运行的完整元数据在 `_meta/run-*.json`——历史第一事实源。
25. **真实 location 形态全集**（第一批判工件实测）：`path:23-29；path2:104-131`（分号多文件）、`path:418-424,524-530,533-546`（逗号多区间）、`plan §3.2`（非文件）、带引号、`./` 与绝对路径前缀。

## 二、总体架构（新增/改动模块）

```
extension/src/
├── env/versionCheck.ts         【改】SUPPORTED_SCHEMAS 增 review: 'trivium.review.v2'
├── reviews/                    【新目录】
│   ├── reviewParse.ts          review.v2 解析 + ReviewFileStatus 逐文件状态模型（CLAUDE-06）
│   ├── locationResolve.ts      location 归一（分号多文件/逗号多区间/引号/前缀/防逃逸 containment）+ 行号校验（一致性判据 + 锚文本重定位启发式）
│   ├── annotationModel.ts      纯函数：resolved findings → 线程/诊断描述模型（[start,end] 区间、severity 映射、同行合并、量级阈值、逐家过滤、漂移标签）
│   ├── annotationHub.ts        VS Code 装配：CommentController + DiagnosticCollection、scope 绑定、**服务级 metaWatch**（CODEX-03/AGY-01）、挂载文件 hash 重校验（CLAUDE-01/CODEX-02）、threadsSnapshot 可观测面
│   ├── metaWatch.ts            `_meta/` 目录 watcher（Hub 持有，随 scope 启停）
│   └── diffView.ts             changes.diff 状态机解析（#/diff --git/+++/@@ 全前缀，AGY-04）+ 冻结基线 Diff 打开（CODEX-01/CLAUDE-02/AGY-06 降级路径）
├── history/                    【新目录】
│   ├── runHistory.ts           主题/运行扫描（_meta/run-*.json 第一事实源，AGY-05；run_root 仅活跃/缺失时探测，归属纪律同 runDiscovery）
│   └── historyProvider.ts      TreeView triviumHistory + 回放接线 + 逐文件状态展示
├── ui/cockpit.ts               【改】RunCard 增 findingsSummary/findings/ReviewFileStatus；订阅 Hub 事件刷新（不再自持 metaWatch）
├── ui/cockpitHtml.ts           【改】run 卡意见列表（分组折叠、severity 徽标、区间显示、漂移/降级标注、Diff 按钮）
├── extension.ts                【改】注册 Hub、历史树、命令
├── services.ts                 【改】services 增 annotationHub
├── README.md / package.json    【改】功能段与描述同步 Phase 2（CLAUDE-09；第一批表述注明时点保留）
└── package.json                【改】version 0.2.0；commands/views/configuration
extension/test/
├── unit/    reviewParse / locationResolve / annotationModel / runHistory / diffParse / versionCheck（扩展）
├── integration/  annotations / history / cockpitFindings / diffView（git 可用+降级）+ fixtureLib 扩展
└── 主仓 doc/08_project/README.md 维护记录两行（归档时同步，CLAUDE-09）
```

**不改**：`cli/`、`env/config.ts`、`env/health.ts`、`launch/`、`monitor/` 既有模块；主仓零改动（除上述 README 维护记录两行——归档动作，非代码）。

## 三、关键设计决策

### D1′ review.v2 消费与逐文件状态模型（FR-6a 数据面）

- `parseReviewFile`：文件名 `review-<critic>-<runId>.json` → critic/runId；JSON 坏 → `parse-error`；schema 非 v2 → `unsupported-schema`（携带实际 schema 串）；命名不识别 → `unrecognized`；单条 finding 缺字段/枚举外 → 跳过计数 `partial-skipped`。四态 + ok 全部进 `ReviewFileStatus{critic,runId,state,actualSchema,skippedCount,notice}`，驾驶舱与历史树共同消费——被降级文件在 UI 显示明确原因（如「该侧工件 trivium.review.v1，未展示」），不与完整消费混淆。
- 逐文件降级不进全局 degradedReason（config/state/status 三源语义，CODEX-07 第一批），点火不受影响。
- 夹具：单测优先读主仓真实工件（三侧真件 + 含 nit/minor 的历史件），缺则内联回退（独立分发兼容），断言同套。

### D2′ location 归一、行号校验与快照一致性（FR-6b 前置）

归一 `normalizeLocation(loc, workspaceRoot)`：
1. 分号（`；;`）拆多文件位置；单位置内行号部分支持逗号多区间 `L1-L2,L3`（AGY-02）：第一区间为主锚点、其余次级锚点列表；
2. 单段：剥引号/`./` → 绝对路径截取 workspaceRoot 相对段 → **统一 `path.resolve` 后 containment 判定**（越界→`{kind:'outside'}` 只进列表标注「路径越界」，CLAUDE-07）；
3. 非文件形态（`plan §3.2` 等）→ `{kind:'doc'}`：只进列表。

行号校验 `resolveAnchor`：
- 无行号/line<1/非数字 → 文件级（标注「未给行号」，非漂移，CLAUDE-08）；
- **一致性判据两层**（CLAUDE-01/CODEX-02）：
  - 静态（挂载前，best-effort）：code 阶段且 git 扩展可用且 run 有 `# head:` sha → 工作区文件与该 sha blob 比对；不一致 → 该文件全部意见标「⚠ 与送审版本不一致」（行号保留界内但统一带标注）；
  - 动态（挂载后，必做）：Hub 记每挂载文件内容 hash；onDidChange/SaveTextDocument 命中 → 重算，失配 → 触发重锚或标「⚠ 文件已编辑」；
- 行级接受条件：行号界内 **且**（静态一致 或 无法判定——无法判定时不加漂移标注但不算静默：无法判定的情形（plan 阶段/git 不可用）在意见列表侧栏注明「一致性未校验」）；
- 失配重定位（越界或确认已变）：锚文本（反引号片段，空白归一化比对，AGY-03）在 ±20 行窗口搜索——唯一命中 → 行级+「邻近命中」；多命中 → 歧义降文件级+「多处命中」（CLAUDE-08）；无锚/未命中 → 文件级+漂移原因（out-of-range/line-lost）；
- 文件不存在 → `missing-file`：只进列表标注「文件缺失」，不建 thread/诊断。

### D3′ 批注装配与呈现（FR-6b/6c）

- `AnnotationHub`（services 持有）：CommentController('trivium.reviews') + DiagnosticCollection 同名；
- 线程粒度 `(uri, 主锚点区间起始行)`，**区间贯通**：annotationModel 携带 [startLine,endLine]，thread.range 与 diagnostic.range 同源生成（多行 location 不折叠，CLAUDE-05）；同行多 finding → 同 thread 多 comment（author.name=审查者、thread.label 标 severity 概览）；comment mode=Preview 只读；
- Diagnostics：blocker/major→Error、minor→Warning、nit→Information；code=finding.id、source='TriviumCode 审查'；漂移/降级统一「⚠」前缀 + 原因 + 原行号；
- 逐家开关：`trivium.critics.filter` QuickPick + 驾驶舱分组 checkbox，切换全量重建（幂等）；
- 可观测面：threadsSnapshot()（uri/range/comments 数/标签）供测试；Diagnostics 走 languages.getDiagnostics()。

### D4′ 绑定模型与生命周期（任务书必答项）

- **scope = {topic, stage}，scope 内单一焦点 run**：活跃 run 最新者，无活跃时最新有意见工件 run；新 run 出现自动切换；历史树点击任意 run → 回放该轮；
- **切换呈现**：setScope/setActiveRun 全清（线程逐 dispose + diagnostics.clear）→ 重建——无残影、无孤儿；
- **生命周期分工**：
  - 文件关闭：Comments 线程随 VS Code 文档生命周期管理（关闭隐藏、重开恢复），Diagnostics 按 Problems 语义常驻——归属均为 scope，非孤儿；主动清理不在此触发（CODEX-06/CLAUDE-03 语义澄清）；
  - 面板关闭：批注与 metaWatch 不受影响（Hub 服务级持有）；run 结束：意见保留、metaWatch 随 scope 内 run 集合空则停；
  - 工作区关闭/扩展停用：dispose 全清（controller.dispose + diagnostics.clear）；
  - multi-root：固定首个 root（第一批边界沿用，登记后续）；
- 「当前批注来源」状态栏：`批注：主题/阶段 · runId · N 家 M 条`，点击 QuickPick 切换 run。

### D5′ Diff 视图（FR-6d，冻结基线版）

- changes.diff 状态机解析：`#` 头部（run_id/base/head/files 清单）→ `diff --git a/… b/…`（及 `+++ b/…` 兜底）文件分界（AGY-04）→ `@@ -a,b +c,d @@` hunk 归属 → 输出 per-file {relPath, newFile?, deletedFile?, hunks[head 侧行区间]}；流式逐行，不建全文模型；
- 打开 `openDiffFor(finding)`：relPath 在变更集 → `vscode.diff(gitUri(head-sha), 工作区 URI, '主题/run · 文件（右侧为当前文件）')` + revealRange 定位（D3′ 区间同源）；**新增文件**（`--- /dev/null`）→ 打开文件 + 提示「本轮新增，无基线版本」；**删除文件** → 打开 sha 侧只读基线 + 提示；**head 对象缺失或 git 扩展不可用** → 打开文件 + 明示原因；plan 阶段无 changes.diff → 同降级；
- 成员判定之外，hunk head 行区间用于意见行「位于被审变更内/外」辅助提示。

### D6′ 运行历史（FR-7，第一事实源版）

- `listTopics`：扫 `.reviews/*/task.json` → 主题（时间、run 数、末态、drivers）；
- `listRuns(topic)`：**完结运行以 `_meta/run-*.json` 为第一事实源**（sides/model/duration/snapshot 均在，AGY-05），task.json 提供时间线主轴（run_id/stage/rerun_index/status/driver/started_at），review-*.json 提供逐侧 verdict+severity 统计；run_root 仅活跃运行或归档缺失时探测（桶过滤 + topic 比对归属纪律）；「run 目录未定位」不再标为已归档运行的异常（归档齐全即正常态）；
- TreeView `triviumHistory`：主题→运行两级，节点 description `stage rN · 状态 · N 侧 · M 条（x blocker y major…）· verdict`；ReviewFileStatus 的降级件在节点标注（如「claude 侧工件不支持」）；点击 run → 回放（setScope + setActiveRun）；上下文命令「打开审查正文」「查看该轮 Diff」；扫描惰性（树可见/刷新时）。

### D7′ 驾驶舱意见列表（FR-6a UI）

- RunCard：`findingsSummary`（逐侧 verdict + severity 计数 + ReviewFileStatus 状态）+ `findings`（id/severity/critic/location 原文/问题摘要/漂移与降级标注/解析级别）；
- 渲染：run 卡内 details 折叠，按审查者分组（组头=侧名+verdict 徽标+计数+开关 checkbox）；条目=severity 徽标（blocker 红/major 橙/minor 黄/nit 灰）+ id + 摘要 + location 链接（区间完整显示）；点击 → open-finding（跳转 reveal 同区间）；「Diff」按钮（变更集成员才有）；
- 实时刷新：Cockpit 订阅 Hub 的 scopeUpdate 事件（metaWatch 服务级，CODEX-03/AGY-01）——面板关闭不中断、重开不重复挂载。

### D8′ 性能量级控制（任务书必答项）

- 意见量：scope 总 findings > 2000 → 仅 Problems + 列表提示；单文件线程 > `trivium.reviews.maxThreadsPerFile`（缺省 200）→ 超出仅 Problems 并标注；comment 正文 evidence 截断 500 字；
- watcher：metaWatch 由 Hub 持有、scope 空则停；历史扫描惰性；静态一致性比对仅 code 阶段、仅变更集内文件、每文件至多一次（结果缓存至 hash 动态校验失配）；
- diff：流式解析只保留文件分界与 hunk 头；Diff 渲染归 VS Code 原生（按需取 blob）；
- Webview：details 默认收起、摘要定长截断、快照式推送（沿用第一批幂等约定）。

### D9′ 测试计划

单元（node --test）：
- `reviewParse.test`：真实三件 + nit/minor 历史件；单条缺字段跳过计数、整份坏 JSON、v1 旧 schema、命名不识别；ReviewFileStatus 四态输出；
- `locationResolve.test`：相对/带引号/`./`/绝对路径截取/分号多文件/逗号多区间（真实形态）/`plan §3.2`/不存在/`../` 上溯与嵌套上溯与伪装前缀（越界）/无行号/0/负数；
- `annotationModel.test`：四档 severity 映射、[start,end] 区间、同行合并、多侧分层、量级阈值、逐家过滤、漂移标签（nearby/multi-hit/out-of-range/line-lost/未给行号/与送审版本不一致/文件已编辑）；
- `diffParse.test`（CLAUDE-04/AGY-04）：头部字段、diff --git 与 +++ 分界、hunk 归属、新增/删除判定、多文件、真实 changes.diff 夹具；
- `runHistory.test`：_meta/run-*.json 第一事实源、task.json 合并、归档缺失回退 run_root、归属不接管（跨桶撞号）、severity 统计；
- `versionCheck.test` 扩展：review ok/v1/未知串。

集成（真实宿主，fixtureLib 扩展：_meta 工件 + 源文件 + changes.diff + 多 run 目录）：
- `annotations.test`：三侧 review JSON（含行号越界、锚文本邻近、逗号多区间、多命中歧义夹具）→ threadsSnapshot 数量/区间/severity/分层/开关重建/各漂移标注；getDiagnostics 数量与 severity/range；**关闭文件→重开→线程恢复不重复、诊断无残留**（CLAUDE-03/CODEX-06）；**切换 scope 后旧批注全清**；**面板关闭后侧完成落盘 → 批注仍更新、重开不重复**（CODEX-03/AGY-01）；**挂载后编辑文件 → 重锚或标注**（CLAUDE-01/CODEX-02）；「无锚文本+整体改写+行数仍够」回归；
- `diffView.test`（CLAUDE-04）：git 可用（夹具 git 仓库 + 冻结 sha）→ diff 打开与定位行号、HEAD 前进后回放同一 run 基线不变；git 不可用/新增文件/删除文件/head 缺失 → 降级路径提示；
- `history.test`：多 run 夹具 → 树数据、回放挂载、归档齐全不探 run_root、降级件标注；
- `cockpitFindings.test`：findingsSummary/列表消息、Hub 事件驱动刷新；
- 既有集成回归不红。

### D10′ P1 遗留验收（分层执行，CODEX-04/05）

- **(b) 入口解析保真（Driver 执行，零配额）**：S5 后读本主题 task.json 的 goal 与用户正文逐字比对（含单引号转义、花括号改法两处已知的正文整形点），结论入交付说明；
- **(a) 字节级注入通道**：第一批 fakeTUI 自动化已覆盖，回归即证；
- **(c) 插件全链点火 + F5 GUI 走查 + 就绪延迟标定 + sendText 定档（用户执行，条件性验收）**：S5 完成后 Driver 主动请用户执行——交付说明附录给步骤化清单（走查路径含 Phase 2 新增：意见列表→批注→Problems→Diff→历史回放）、标定流程（逐家调 `trivium.launch.readyDelayMs`/`sendMode`/`carrierOverrides`）、记录模板；执行并记录则验收项关闭，用户明示延后则如实标「未执行、留待用户」，**不把模板当通过**；范围调整须用户决定；
- 三层互不冒认：(a)(b) 不宣称覆盖 (c)。

### D11′ 版本与构建

- extension version 0.2.0；`npm run check --prefix extension` 全绿；主仓 `npm run check` 回归；e2e 桩链路回归；`vsce package` 可打包；README/description/维护记录同步（CLAUDE-09）。

## 四、实施步骤（S5 内序）

1. versionCheck 扩展 + reviewParse（含 ReviewFileStatus）+ locationResolve（归一含防逃逸与逗号多区间）+ 单测；
2. annotationModel（区间/映射/阈值/标签）+ 单测；
3. diffParse（diffView 内状态机）+ 单测（真实 changes.diff 夹具）；
4. AnnotationHub（服务级 metaWatch + hash 重校验 + 一致性静态比对）+ services/extension 接线；
5. diffView 打开与降级 + 集成；
6. 驾驶舱意见列表 + QuickPick 开关 + 状态栏；
7. runHistory + historyProvider + 回放接线；
8. fixtureLib 扩展 + 四个集成测试文件 + 既有回归；
9. extension check 全绿 + 主仓 check 回归 + e2e + vsce；
10. 入口解析保真比对（本主题）；
11. README/description/维护记录同步（CLAUDE-09）；
12. 交付说明（含 P1 条件性验收清单/模板/分工边界）+ 请用户执行 GUI/真机项。

## 五、验收清单

- [ ] 真实运行结束后（本主题真运行或桩驱动），意见以行内批注呈现、点击跳转准确（区间级）；
- [ ] Problems 按 severity 聚合（四档映射断言）；
- [ ] 历史列表可回放过往主题（树数据 + 回放挂载断言；归档齐全不依赖 run_root）；
- [ ] 同一文件多家意见分层不互相覆盖（同行合 thread 多 comment 断言）；
- [ ] 漂移全路径显式（邻近/多命中/越界/丢失/未给行号/与送审不一致/已编辑），文件级降级有测；无锚+整体改写+行数够回归有测；
- [ ] Diff 冻结基线：HEAD 前进后回放不变；新增/删除/缺失降级有测；
- [ ] 生命周期：scope/run 切换与 dispose 无孤儿诊断；文件关闭→重开恢复不重复；面板关闭批注与刷新不中断；
- [ ] review.v2 逐文件降级四态 UI 明示，不影响点火（单测+集成）；
- [ ] 入口解析保真比对结论入档；(c) 层 GUI/真机项按条件性验收处理（用户执行或明示延后，如实记录）；
- [ ] extension check 全绿、主仓 check 不破坏、e2e 通过、vsce 可打包；README/description/维护记录同步。

## 六、风险与对策

| 风险 | 等级 | 对策 |
| :--- | :---: | :--- |
| Comments API 无公开枚举面 | 中 | threadsSnapshot 可观测面断言 + 诊断公开 API；GUI 呈现进 (c) 层走查（D10′） |
| git 扩展 API 变动/被禁/head 对象缺失 | 低 | 软依赖 + 三路降级 + 明示原因；diffView.test 两路都测（CLAUDE-04 落实） |
| 锚文本提取覆盖率低 | 中 | 已降为重定位启发式（AGY-03）；行号有效性由一致性判据承担，不制造假漂移 |
| 静态一致性比对开销（code 阶段逐文件 blob） | 低 | 仅变更集内文件、每文件一次、结果缓存（D8′） |
| 历史 run 目录跨仓撞号/已清理 | 低 | 归档第一事实源（AGY-05）+ 归属纪律不接管 |
| 多意见/大 diff 性能 | 低 | D8′ 阈值 + 流式解析 + 惰性扫描 |

## 七、交付物清单

- 代码：`extension/src/reviews/` 6 文件、`extension/src/history/` 2 文件；改动既有：versionCheck.ts、cockpit.ts、cockpitHtml.ts、extension.ts、services.ts、package.json、README.md（7 个）；
- 测试：单测 5 新文件 + versionCheck 扩展；集成 4 新文件 + fixtureLib 扩展；
- 文档：交付说明（verify 记录、入口保真比对、P1 条件性验收清单与模板）；doc/08_project/README.md 维护记录两行；
- 打包：`trivium-cockpit-0.2.0.vsix` 可出（不承诺市场发布）。
