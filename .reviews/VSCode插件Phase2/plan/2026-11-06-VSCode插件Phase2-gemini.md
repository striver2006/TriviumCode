---
schema: trivium.review.v2
topic: VSCode插件Phase2
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.5.1
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261105T230457Z
rerun_index: 1
snapshot_hash: sha256:cd0473aae7ccf956909e83279a8cdd2d0b7eb796f8c76056460333dcd1e79f01
blind: true
started_at: 2026-11-05T23:05:08.164Z
finished_at: 2026-11-05T23:15:35.690Z
duration_s: 403
tool_calls:
  read: 30
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 16
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 3
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: glm
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: k3.1-pro
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：kimi / gemini
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 左侧模型信息缺失
session_id: 9d5bc826-8c55-4394-af71-b253435980d2
---

# 计划审查：VSCode插件Phase2

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261105T230457Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本计划整体架构完备、边界清晰，测试计划覆盖了单元与宿主集成层，总体设计可行。但存在两处主要问题和几处细节缺口需要修正：
最主要的是 metaWatch 被挂在驾驶舱 attachRun 内部，一旦用户关闭面板（甚至从不打开看板），监听即随 RunEntry 被 dispose，导致后台运行的审查意见无法进入行内批注与诊断，破坏批注生命周期的独立性承诺；
其次，location 归一未支持审查员常用的单文件逗号分隔多行区间（如 path:L1-L2,L3-L4），会导致大批真实意见误降级为无行号文件级；
同时，按反引号提取期望代码做行号比对极易因缺省代码、多文件引用产生误判，将有效意见误降为 line-lost 漂移；此外 Diff 视图流式解析漏掉了 diff --git 分界行，且对新增文件直调 gitUri(HEAD) 会触发 git 异常。
按上述意见针对性修正后即可实施，无需再审一轮。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 6 条：重要 3 ｜ 次要 3）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §二 (架构图), §三 D4, D7` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：metaWatch 生命周期与宿主绑定错位：D4 承诺批注生命周期独立于面板，但 D7 将 metaWatch 挂在 cockpit.ts 的 attachRun 内。在 cockpit.ts:120-121, 643-650 中，面板关闭触发 onDidDispose 会调用 disposeRuns 销毁全部 attachRun watcher。若用户在审查进行中关闭驾驶舱看代码，或在外部终端运行（M3 模式下从未打开驾驶舱），metaWatch 均被销毁或未建立，落盘的 review JSON 无法被捕获，导致行内批注、诊断与状态栏静默失效。

**依据**：读了被审计划 §二、§三 D4 与 D7；对照 extension/src/ui/cockpit.ts:120-121 及 643-650，确认 onDidDispose 调用 disposeRuns 释放所有 attach 监听。与 extension/src/services.ts 长期持有的 stateWatch 对比，证实 metaWatch 若只随 RunEntry 创建并随面板清理，无法支撑 D4 承诺的独立生命周期。

**建议**：将 metaWatch 提升至服务层（由 services 或 AnnotationHub 持有），使其监听阶段 _meta 目录与生命周期跟随当前激活 scope 与工作区，独立于 Webview 面板开关。当新工件落盘时，由 AnnotationHub 统一更新批注与状态栏，Cockpit 打开时作为观察者订阅刷新。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D2 (location 归一与行号 fuzzy)` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：location 归一逻辑不支持单文件逗号分隔的多行区间（如 path:L1-L2,L3-L4）。D2 规定仅按分号 ；; 拆分并以 path:line[-endLine] 正则提取数字，遇到多区间时整个 line 部分为包含逗号的字符串，匹配失败后被判断为「非数字」并无条件降级为无行号的文件级 doc/missing-file，导致大量多行区间意见丢失行级批注。

**依据**：读了被审计划 §三 D2；对照真实工件 .reviews/VSCode插件Phase0-1/code/_meta/review-claude-20261105T185028Z.json 第 44 行 location 为 extension/src/ui/cockpit.ts:418-424,524-530,533-546；以及 doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md 表 2.1 中的 cli.ts:268-278,796-824。证明审查员工件中单文件多区间均以逗号分隔，D2 的解析规则无法提取出有效行号。

**建议**：在 locationResolve 中扩展行号解析规则：在提取出 path 后的行号部分支持逗号 , 分隔的多个区间或离散行号。取第一个有效区间作为主锚点（primary anchor），后续区间作为次级锚点列表（secondary anchors），避免因含逗号导致行号匹配失败而误退化为文件级。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D2 (行号校验 resolveAnchor)` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：以 problem/evidence 中反引号代码片段（≥8 字符）作为「期望行内容」做严格匹配会导致大面积误判漂移与 line-lost 降级。审查意见中反引号常用于指出缺失的代码或参数（如「遗漏 --driver-model」）、提及跨文件方法名或无空格表达式（如 pool.length===1），这些文本在目标行及附近根本不可能存在。D2 规定找不到即标 line-lost 并降为文件级批注，会将正常在界内的意见大面积误杀降级。

**依据**：读了被审计划 §三 D2 规则；对照 review-claude-20261105T185028Z.json 第 34 行 CLAUDE-03 指出 preflightFlagList 白名单漏掉 --driver-model，该行在源码中不存在该词；第 23 行 CLAUDE-02 指出 pool.length===1 分支，而源码写为 pool.length === 1。若按 D2 强制反引号匹配，两处原本有效的行级位置均会被误判为 line-lost 漂移并移出代码行。

**建议**：调整 resolveAnchor 的锚文本策略：反引号文本仅作为「邻近漂移重定位」的启发式加分项，而非行号有效性的否决条件。若文本无法匹配，但只要行号处于有效行数范围内（1 <= line <= lineCount），且无文件被修改的事实，应信任原始行号展示行级批注，不应盲目降级为 line-lost 文件级。同时对候选代码进行空白字符归一化比对。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D5 (Diff 视图)` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：changes.diff 流式解析器未覆盖 diff --git / +++ b/ 文件分界行，导致无法将 @@ hunk 区间关联到具体文件。D5 声明「只读 # 注释段 + @@ hunk 头行」，但在统一 diff 格式中，@@ 行只包含行列号信息而不包含文件路径；若不解析 diff 文件头分界行，状态机无法确定当前 hunk 属于哪个变更文件，被审行是否在变更集内的辅助判定将失效。

**依据**：读了被审计划 §三 D5；对照真实文件 .reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T185028Z.diff 第 69-95 行，确认 hunk 行 @@ -154,3 +154,16 @@ 前后仅由 diff --git 和 +++ b/ 标识所属文件，# 行仅集中在最顶层头部。只扫 # 和 @@ 无法将 hunk 行映射到具体文件。

**建议**：在 diffView.ts 的流式行状态机中，增加对 diff --git a/... b/...（或 +++ b/...）前缀的解析，维护当前处理的相对路径，从而正确将 @@ hunk 区间归属于相应文件。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D6 (运行历史)` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：历史运行树过度依赖本地临时目录 run_root，对已进 Git 归档的完结运行会普遍误报「run 目录未定位」。.reviews/ 是持久化 Git 审计库，而 ~/.trivium/runs 是可能被轮转清理、在多机克隆仓库中本就不存在的临时工作区。D6 规定所有运行均到 run_root 扫描 status.json，找不到即降级标未定位，会导致查阅历史归档时出现大面积误报降级标签，且逐 run 扫桶产生不必要的磁盘 I/O。

**依据**：读了被审计划 §三 D6 与 README.md；对照真实归档 .reviews/VSCode插件Phase0-1/code/_meta/run-20261105T185028Z.json，确认已归档运行的元数据、模型比较与 sides 信息在 _meta 下完整保留。task.json 中已有 status/started_at，无需必须依赖 run_root/status.json。

**建议**：区分「完结历史运行」与「活跃/本地未归档运行」：对于 task.json 中已终态且在 .reviews/*/ 存在 _meta 工件的运行，以 _meta/run-*.json 及 review-*.json 作为第一事实源；仅在缺失归档或活跃运行时才探测 run_root，缺失临时目录不应标记为异常降级。

### AGY-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D5 (Diff 视图)` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：对新增文件（/dev/null 基线）调用 git.toGitUri(HEAD) 打开 diff 会触发 Git 致命错误。D5 规定变更集成员通过 vscode.diff(gitUri(HEAD), 工作区文件 URI) 打开 Diff。但对于本次变更中新创建的文件，HEAD 中不存在该 blob，VS Code 内置 Git 插件执行 git show HEAD:<path> 会抛出 fatal 错误或弹窗报错，导致 Diff 动作失败。

**依据**：读了被审计划 §三 D5；对照 changes-20261105T185028Z.diff，第 5-30 行列出的 63 个变更文件中包含大量首次创建的 extension/ 模块。若直接以此类新增文件的 gitUri(HEAD) 发起 vscode.diff，git 会因对象不存在抛出 exit code 128。

**建议**：在 diffView 成员判定中区分修改与新增文件（检查 diff 头部是否为 --- /dev/null 或 git 状态）：对新增文件，降级为直接打开该文件并气泡提示「该文件为本轮新增文件，无基线版本」，或打开对比空白临时文档，避免向 VS Code 提交无效的 gitUri(HEAD)。

## 认为正确的部分

- 坚持将 extension/ 作为独立包交付，不侵入主仓 src/、skills/ 与闸门配置，契约边界清晰。
- 批注采用 VS Code 原生 Comments API 与 Diagnostics 并行，同文件同行多审查员合并分层，设计符合 VS Code 交互范式。
- review.v2 采用逐文件降级隔离，不污染 config/state/status 三源的全局禁点火降级，保护存量历史工程可用性。
- 对 changes.diff 采取按需轻量级头部与 hunk 行流式解析，不全文缓存大 diff，结合 VS Code 原生 Diff 编辑器渲染，避免内存暴涨。
- 对 P1 遗留项采取诚实边界划分，将无法代跑的真机 GUI 走查制成清单与模板交付，避免虚假自动化承诺。

## 未覆盖范围（本侧盲区）

- Windows 平台（win32）下的路径与终端兼容性（本批明确限定 macOS darwin/arm64 边界）。
- 真实的 VS Code 界面渲染与 Comments 气泡交互视觉走查（因二次审查员无 GUI 运行环境）。
- 真机交互式 CLI 的真实注入时序与就绪延迟中位数实测（需真机外部会话）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase0-1/code/2026-11-06-VSCode插件Phase0-1-交付说明-glm.md`
- `.reviews/VSCode插件Phase0-1/task.json`
- `.reviews/VSCode插件Phase0-1/code/_meta/review-claude-20261105T185028Z.json`
- `.reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T185028Z.diff`
- `.reviews/VSCode插件Phase0-1/code/_meta/run-20261105T185028Z.json`
- `extension/package.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/env/versionCheck.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/monitor/reviewWatch.ts`
- `extension/src/launch/entryCommand.ts`
- `skills/dual-critic/schema/review.v1.json`
- `skills/dual-critic/schema/review.v2.json`
- `src/trivium/archive.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":30,"grep":0,"glob":0,"run_command":0,"project_reads":16}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
