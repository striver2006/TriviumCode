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
run_id: 20261106T002819Z
rerun_index: 1
snapshot_hash: sha256:0d33a004dd86ead5218f8dcfe23bfc83e28f38ba9f6959c74d3fee91d63680e3
blind: true
started_at: 2026-11-06T00:28:31.014Z
finished_at: 2026-11-06T00:40:34.242Z
duration_s: 723
tool_calls:
  read: 34
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 31
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 6
  minor: 5
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
session_id: b2b7ef8e-fa87-4775-8386-b8e34401095d
---

# 代码审查：VSCode插件Phase2

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261106T002819Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

静态一致性判据误用 changes.diff 的 head（送审前提交）对比当前工作树，正常未提交改动会被判为不一致；且首次挂载在计算前已固化 unknown。
驾驶舱 Diff 按钮因 relPath 未进入 RunCard 而必定空路径返回，自定义 --base 也错用 head，Diff 主链存在两类实质错误。
历史回放对未附着的旧 run 只更新 Hub，驾驶舱没有对应意见卡，承诺的“意见列表聚焦”不成立。
删除文件的降级路径会尝试打开已不存在的工作区文件。上述问题涉及基线语义与主链接线，需修复并补足真实场景测试后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 11 条：重要 6 ｜ 次要 5）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:342` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：驾驶舱意见条目的 relPath 没有随 RunCard 发出，导致路径文本缺文件名的同时，Diff 按钮点击后必定因空 relPath 在宿主侧直接返回，FR-6d 的主入口不可用。

**依据**：extension/src/ui/cockpit.ts:62-66 的 findings 类型没有 relPath，703-716 的实际映射也只发送 file 与 inChangeset；extension/src/ui/cockpitHtml.ts:342、349 却读取 f.relPath 并把它随 open-diff 发回。extension/src/ui/cockpit.ts:277-281 在 relPath 为空时 break，因此按钮没有后续效果。

**建议**：把 relPath 纳入 RunCard 类型和 runCards 映射，保持与 Hub 输出同名；补一条从 webview open-diff 消息到 openDiffFor 入参的集成断言，而不只断言卡片上的 inChangeset。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:367` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：静态“与送审版本一致”判据选错基线：它把当前工作区文件与 changes.diff 的 head blob 比较，而 head 是生成补丁时的提交，不是送审工作树。默认 HEAD 的未提交代码审中，被审改动本身就必然造成 mismatch，后续重建会把正常意见误标为“与送审版本不一致”。

**依据**：src/trivium/review.ts:1021-1031 先以 base 调 diffAgainst，再以当前 headSha 写补丁头；src/trivium/code-stage.ts:132-146 也证明该 head 只是补丁生成时的仓库 HEAD。extension/src/reviews/annotationHub.ts:385-390 直接用当前工作区内容对比这个 head。src/trivium/types.ts:1632-1658 另有不等同于 HEAD 的送审 tree_hash / 收尾 after_tree_hash 概念，说明两种快照不能混用。

**建议**：静态判据应改为能代表送审工作树的快照或逐文件冻结内容；无法取得时保持 unknown，不要用 head 代替。补“默认 HEAD、工作区含待审改动”的首次及后续重建用例，并同步修正计划中相同的基线表述。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:292` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：首次挂载时静态一致性计算发生在全部 resolveLocation 之后，resolved 已各自固化 unknown；随后写入 consistency Map 的结果不会回流到本次线程、诊断和 lastResolved，首次展示拿不到静态校验结论。

**依据**：extension/src/reviews/annotationHub.ts:292-301 先解析并传入 consistency 回调，304-310 才 ensureConsistencyChecked 和 buildAnnotationModels；extension/src/reviews/locationResolve.ts:229 在解析时读取一次 consistency 并保存到返回值。extension/test/integration/annotations.test.ts:166-172 只覆盖“不得 mismatch”的阴性断言，没有首次挂载即应标 mismatch 的用例。

**建议**：把静态校验安排为解析前阶段，或在校验后重新生成 resolved 再装配；增加首次 setActiveRun 即可见 mismatch/consistent 的测试，避免依赖下一次偶然 rebuild。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/history/historyProvider.ts:124` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：历史树回放一个当前驾驶舱未附着的旧 run 时，只切换 AnnotationHub，不会在该 run 上生成或聚焦意见列表；扩展重启后的历史回放因此只有批注和诊断，没有注释所承诺的“意见列表聚焦”。

**依据**：extension/src/history/historyProvider.ts:124-128 的 replayRun 仅调用 setScope/setActiveRun。extension/src/ui/cockpit.ts:682-746 的 runCards 只遍历 this.runs，而全 src 中唯一的 this.runs.set 位于 cockpit.ts:664 的活跃 run attach 路径；历史 replay 没有向它插入条目，也没有打开驾驶舱。HistoryProvider 顶部 6-8 行明确把意见列表聚焦列为回放结果。

**建议**：让历史回放向驾驶舱提供一张由 RunSummary/Hub 驱动的历史意见卡并 reveal，或提供独立的历史意见列表视图；用新建 Cockpit 中不存在该 run 的场景做回放断言。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/diffView.ts:65` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：自定义 --base 时 Diff 左侧仍固定使用 diff.head，展示的就不是本轮被审的 base→当前文件变更；若改动已提交到 head，右侧与左侧甚至相同，整轮变更在 Diff 中消失。

**依据**：extension/src/reviews/diffView.ts:65-83 只读取 diff.head，extension/src/reviews/diffParse.ts:27-50 虽解析 base 却没有消费者。src/trivium/review.ts:1021-1031 明确被审补丁由 diffAgainst(base) 生成、head 仅另取当前 HEAD。extension/test/integration/diffView.test.ts 全文没有计划要求的 --base 自定义用例，且 17-19 的 fakeGitApi 忽略 ref，无法核验所传基线对象。

**建议**：在送审工件中冻结并消费解析后的 base 提交身份，而不是回放时依赖可移动的 ref；若本批不支持自定义 base，应显式降级并收窄文档。补自定义 base 下已提交与未提交两种 Diff 测试。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/diffView.ts:65` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：删除文件在 git 不可用、无 head 或基线对象不可读时，降级逻辑会调用 showFile 打开工作区路径，但该路径按定义已删除，Promise 拒绝，用户得不到承诺的明示降级结果；删除分支只在上述 fallback 之后处理。

**依据**：extension/src/reviews/diffView.ts:65-80 显示 member.deleted 判断位于两次 showFile fallback 之后。extension/test/integration/fixtureLib.ts:297-312 虽注释称 gone.ts 为“工作区删”，实际从未删除它；extension/test/integration/diffView.test.ts:78-82 因文件仍存在而掩盖了该异常，也没有覆盖删除文件的真实只读基线成功路径。

**建议**：把 deleted 的基线读取与无基线提示独立成分支，不再尝试打开不存在的当前文件；调用侧也应有错误可见性。夹具需真实删除 gone.ts，分别覆盖 git 可用、git 不可用和对象缺失。

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:307` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：新增的 trivium.reviews.maxTotalFindings 用户配置没有消费方，Hub 永远写死 2000，用户调整设置不会产生任何效果。

**依据**：extension/package.json:159-164 声明了该配置及默认值；extension/src/reviews/annotationHub.ts:307-311 给 buildAnnotationModels 的 maxTotalFindings 固定为 2000，同文件 442-444 只有 maxThreadsPerFile 的配置读取。

**建议**：按 maxThreadsPerFile 的同款方式读取 maxTotalFindings，并用非默认值验证线程抑制行为随配置变化。

### CLAUDE-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/locationResolve.ts:233` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：逗号多区间只在 normalize 阶段保留了数组，resolve 阶段每个文件锚点仍只取 ranges[0]，同一路径的第二及后续区间既未成为次级锚点，也未进入展示，2-3,5-6 实际只剩 2-3。

**依据**：extension/src/reviews/locationResolve.ts:68-79 能解析全部区间，但 233-240 对每个 FileAnchor 仅取 a.ranges[0]，循环变量 i 只遍历分号拆出的文件位置，没有展开其余 ranges。计划 D2′/AGY-02 要求第一区间为主锚点、其余为次级锚点。

**建议**：将同文件的后续 ranges 转成次级 AnchorResolution 或在展示模型中保留完整区间集合；补 resolveLocation 对 2-3,5-6 的次级区间断言，而非只测 parseRanges。

### CLAUDE-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/locationResolve.ts:68` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：非法行号 0 与负数没有按计划归为文件级“未给行号”：0 会被接受为行级区间 0，负数则无法拆出行号并把文件名一并变成不存在的路径。

**依据**：extension/src/reviews/locationResolve.ts:68-79 的 parseRanges 接受 0；246-264 只检查 raw.start > lineCount，没有 start < 1 检查，因此 0 进入 line 分支。负号不在正则内，冒号拆分失败后 225-227 会把形如 src/a.ts:-1 的整体当文件路径并报 missing-file。计划 CLAUDE-08 明确要求 line<1/非数字的文件级处理及 0、负数测试。

**建议**：在解析与行级接受前统一校验起止行均至少为 1，非法时按原文件生成“未给行号”的文件级锚点；补 0、负数及反向区间的行为测试。

### CLAUDE-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/reviewParse.ts:98` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：解析器声称“枚举外值跳过”，实际只校验 severity，layer、kind、confidence 的表外值会作为 ok finding 展示，逐文件降级状态与 review.v2 契约不一致。

**依据**：extension/src/reviews/reviewParse.ts:98-130 的必填检查之后仅有 SEVERITIES.includes，随后直接接受其余字段。skills/dual-critic/schema/review.v2.json:36-60 对 severity、layer、kind、confidence 均有明确枚举；reviewParse.ts:7 与 130 的注释/提示却泛称枚举外值会跳过。

**建议**：按 schema 校验 layer/kind/confidence 的枚举并计入 partial-skipped，或把提示与计划明确收窄为仅 severity；增加逐字段表外值用例。

### CLAUDE-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/annotationHub.ts:307` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：量级超限的“并提示”没有接线：单文件 overflow 被计算后无人消费，总量超限也只是静默把 threads 置空，用户无法知道批注为何缺失。

**依据**：extension/src/reviews/annotationModel.ts:162-180 生成 overflow，119 与 178-180 处理总量降级；extension/src/reviews/annotationHub.ts:307-364 只读取 built.threads 与 built.diagnostics，未读取 overflow，也没有总量降级通知。extension/package.json:157、163 分别承诺超线程上限进 Problems、超总量仅 Problems 并提示。

**建议**：把单文件溢出数与总量降级原因纳入 ScopeState/驾驶舱摘要或状态栏提示，并对两类超限各加一条用户可见提示断言。

## 认为正确的部分

- versionCheck 新增 review 支持集后没有进入 worstVerdict 的全局禁点火路径，reviewParse 的逐文件状态模型也能被驾驶舱与历史统计共同消费。
- annotationModel 的 severity 映射、同行多 comment 合并以及 thread/diagnostic 区间同源清晰，location 的 path.resolve containment 与漂移显式标签方向正确。
- AnnotationHub/MetaWatch 由服务级持有，scope 切换会清理线程与诊断，dispose 链路完整，符合面板独立于批注生命周期的设计。
- runHistory 在归档齐全时不探 run_root，缺失时才复用带桶前缀和 topic 校验的 locateRunDir，保留归档第一事实源与跨仓不接管纪律。
- diffParse 对默认 head 的冻结身份、文件分界、hunk 归属及新增/删除标记有对应单测，整体只读文件面边界未被破坏。

## 未覆盖范围（本侧盲区）

- 本侧没有执行能力，未运行 extension 的 typecheck、单元/集成测试、主仓回归、vsce 或真实 VS Code GUI；所有结论均为静态阅读与调用链推理，未验证运行时表现。
- Windows、multi-root、符号链接逃逸及大规模意见/diff 的实际性能未覆盖，这些多属本批声明边界或需要专项环境。
- P1 遗留人工验收、入口解析保真记录、交付说明及 doc/08_project 维护记录不在本补丁中，未评价其完成情况。
- 未逐一验证真实历史归档中所有 location 形态与所有损坏工件组合，相关意见依据所提供的契约、夹具和实现路径。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-r2-glm.md`
- `.reviews/VSCode插件Phase2/code/_meta/changes-20261106T002819Z.diff`
- `extension/README.md`
- `extension/package.json`
- `extension/src/env/config.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/history/historyProvider.ts`
- `extension/src/history/runHistory.ts`
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
- `extension/test/integration/diffView.test.ts`
- `extension/test/integration/fixtureLib.ts`
- `src/trivium/code-stage.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `skills/dual-critic/schema/review.v2.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":34,"grep":7,"glob":0,"run_command":0,"project_reads":31}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
