---
schema: trivium.review.v2
topic: VSCode插件Phase2
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
run_id: 20261106T010601Z
rerun_index: 2
snapshot_hash: sha256:d270d2b498851de937406ca9b97896686ea8f306bf2a2674a1fd4dcba1a26515
blind: true
started_at: 2026-11-06T01:06:11.964Z
finished_at: 2026-11-06T01:17:33.749Z
duration_s: 681
tool_calls:
  read: 39
  grep: 3
  glob: 0
  run_command: 0
  project_reads: 30
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 2
  minor: 4
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
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
    status: unknown
    left_model: null
    right_model: k3.1-pro
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
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
override_reason: 左侧模型信息缺失
session_id: ddcd1a23-9ca5-4319-bc21-839aef3bb222
---

# 代码审查：VSCode插件Phase2

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261106T010601Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的是两处主入口仍未贯通：删除文件的 Diff 底层虽修好，但列表只给 line 级意见按钮，删除文件必为 missing-file，用户无法进入；历史回放也不会主动打开意见列表。
次级区间/多文件锚点、逐家面板开关仍只有半成品接线；非数字行号与 review 根字段损坏还会产生错误状态。
上一轮关于送审基线、首次一致性计算、自定义 base 和删除文件底层降级的核心问题已实质修复。
整体建议修改后通过，需补齐上述入口与契约测试，无需因架构问题再审。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 6 条：重要 2 ｜ 次要 4）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/history/historyProvider.ts:125` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：历史回放仍不会打开或聚焦意见列表。虽然本轮新增了历史回放卡，但驾驶舱未打开时，点击运行历史节点只更新 AnnotationHub，用户只能得到批注和诊断，README 与 HistoryProvider 注释承诺的“意见列表聚焦”仍不成立。

**依据**：extension/src/history/historyProvider.ts:125-128 的 replayRun 只有 setScope/setActiveRun；extension/src/extension.ts:53 将 cockpit.open 留在另一个独立命令，历史回放命令 55-58 没有调用它。extension/src/ui/cockpit.ts:773-775 在面板未开时直接不推送，747-769 的历史卡也只能在用户随后手动开面板后才有意义。extension/test/integration/cockpitFindings.test.ts:100-106 先显式 await cockpit.open() 再回放，因此未覆盖真实的历史树点击起点。

**建议**：回放完成后调用既有驾驶舱单例的 open/reveal，或提供独立的历史意见视图；补一个从面板关闭状态点击历史节点、随后同时看到批注与意见卡的集成用例。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:344` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：删除文件的 Diff 能力没有用户可达入口。删除文件的意见必然被解析为 missing-file，而 Diff 按钮仅挂在线级意见上，因此底层已实现的只读基线展示无法从意见列表触发。

**依据**：extension/src/reviews/locationResolve.ts:227-230 将不存在的文件归为 missing-file；extension/src/reviews/annotationHub.ts:201-214 随之向卡片输出 level=missing。extension/src/ui/cockpitHtml.ts:344-355 只在 level===line 的分支创建 Diff 按钮，missing 分支 356-359 仅显示文本。extension/src/extension.ts:72-74 的命令在没有 relPath 参数时直接返回，历史树也没有其它 Diff 入口。与此相对，extension/src/reviews/diffView.ts:91-99 已实现删除文件基线打开；extension/test/integration/diffView.test.ts:80-90 只直接测该底层函数，没有经过列表消息入口。

**建议**：把 Diff 入口按 inChangeset 与 diffMember 能力独立生成，不要依附 line 级跳转；删除文件走既有只读基线分支，其它 missing 文件保持明示降级。补从 open-diff 消息到删除文件基线打开的端到端断言。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationModel.ts:131` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：逗号多区间和分号多文件的次级锚点只有解析结果，没有任何下游消费。2-3,5-6 最终仍只在 UI 与批注中呈现 2-3；多文件位置也只呈现首个文件，修订声称的次级区间展示未真正贯通。

**依据**：extension/src/reviews/locationResolve.ts:240-255 已生成多文件次级位置及逗号次级区间；但 extension/src/reviews/annotationModel.ts:128-161 只读取 resolution.anchors[0]，extension/src/reviews/annotationHub.ts:201-215 的卡片映射也只读取第一个锚点。extension/test/unit/locationResolve.test.ts:181-193 仅断言解析器里存在次级区间，未验证其进入线程、诊断或列表。

**建议**：将全部 anchors 传入展示模型：可生成次级线程/诊断，或至少在意见条目与批注正文中完整列出次级位置；增加 annotationModel 或卡片层的次级区间断言，而非只测 resolver。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/locationResolve.ts:107` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：非数字行号没有按说明书归为文件级。比如 src/a.ts:abc 会把整个串当成文件名，最终显示“文件缺失”，而非对真实 src/a.ts 给出“未给行号”的文件级意见。

**依据**：extension/src/reviews/locationResolve.ts:101-110 只在冒号后缀含数字或负号时剥离非法行号，字母后缀会留在 relPath 中；227-230 随后把读取失败归为 missing-file。文件头 8-11 行及 r2 计划 D2′ 则约定非数字行号按文件级“未给行号”处理。现有 extension/test/unit/locationResolve.test.ts:162-179 只覆盖 0 与负数。

**建议**：将可识别的行号后缀与文件路径拆分后统一校验，非法后缀保留原文件并标“未给行号”；补字母、数字字母混合及带冒号路径的用例。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:317` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：驾驶舱内的逐家开关未接线，且 QuickPick 关闭某家后其意见仍完整留在列表中。宿主存在 toggle-critic 死分支，用户文档中的“可逐家开关”只在 Comments/Problems 上部分兑现。

**依据**：extension/src/ui/cockpitHtml.ts:317-330 的注释声称组头有分层开关，实际只创建 summary，没有 checkbox 或 postMessage；extension/src 内检索不到 toggle-critic 的生产方，只有 extension/src/ui/cockpit.ts:289-306 的消息处理分支。与此同时 extension/src/reviews/annotationHub.ts:201-216 的 lastResolved 列表不做 enabledCritics 过滤，过滤只发生在 annotationModel 的线程/诊断装配。

**建议**：在分组头接入实际的 toggle-critic 控件，并明确列表是否也应过滤；若是，则复用 enabledCritics 过滤卡片数据，若否则收窄命令与文档口径。补一个 Webview 消息生产到过滤结果的测试。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/reviewParse.ts:102` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：review.v2 根字段的必填与类型没有校验。缺 findings、findings 非数组、缺 verdict 或 summary 的损坏工件会被标为 ok，破坏“坏件逐文件降级且明示”的承诺，并可能把整轮意见静默显示为空。

**依据**：skills/dual-critic/schema/review.v2.json:6-23 要求 verdict、summary、findings 且 findings 必须为数组；extension/src/reviews/reviewParse.ts:102 在 findings 缺失或类型错误时按空数组处理，140-143 仍把状态置为 ok，并允许 verdict/summary 缺失。于是历史树会把这种坏件统计成正常的“无意见”，而不是降级件。

**建议**：在 finding 级容错之前校验根必填字段及 findings 数组类型，失败时给出明确的 parse-error/invalid 状态；补四类根字段损坏用例。

## 认为正确的部分

- 静态一致性已改为先由冻结 base 与 hunk 重建送审工作树，再解析锚点；缓存键包含 runId，上一轮指出的基线误用和首次挂载时序问题均已实质修正。
- openDiffFor 已能按默认 HEAD/完整 sha 选择基线，并对删除文件、对象不可读和 git 不可用分别降级，不再尝试打开已删除的工作区路径。
- AnnotationHub 服务级持有 metaWatch，scope/rebuild/dispose 代次守卫、线程与诊断清理以及配置化量级提示的接线完整。
- runHistory 以 _meta 归档为第一事实源，仅归档缺失时探测 run_root，并复用桶前缀与 topic 的归属校验。
- reviewParse 已覆盖 severity/layer/kind/confidence 枚举，降级状态能贯通驾驶舱与历史统计。

## 未覆盖范围（本侧盲区）

- 本侧只读静态审查，未运行 extension typecheck、单元/集成测试、主仓回归、e2e 或 vsce，也未启动真实 VS Code GUI；所有结论均为代码与调用链推理。
- Windows、multi-root、符号链接逃逸、大规模意见与 diff 的实际性能未覆盖。
- P1 人工验收、入口解析保真记录、交付说明和 doc/08_project 维护记录不在本补丁中，未评价其完成情况。
- 未逐一重放所有真实历史归档的 location 与损坏工件组合；相关判断依据契约、实现及所读测试夹具。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase2/code/_meta/changes-20261106T010601Z.diff`
- `.reviews/VSCode插件Phase2/code/2026-11-06-VSCode插件Phase2-claude.md`
- `.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-r2-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `extension/README.md`
- `extension/package.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/env/config.ts`
- `extension/src/history/historyProvider.ts`
- `extension/src/history/runHistory.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/reviews/annotationHub.ts`
- `extension/src/reviews/annotationModel.ts`
- `extension/src/reviews/diffParse.ts`
- `extension/src/reviews/diffView.ts`
- `extension/src/reviews/locationResolve.ts`
- `extension/src/reviews/metaWatch.ts`
- `extension/src/reviews/reviewParse.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/test/integration/annotations.test.ts`
- `extension/test/integration/cockpitFindings.test.ts`
- `extension/test/integration/diffView.test.ts`
- `extension/test/unit/locationResolve.test.ts`
- `src/trivium/review.ts`
- `skills/dual-critic/schema/review.v2.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":39,"grep":3,"glob":0,"run_command":0,"project_reads":30}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
