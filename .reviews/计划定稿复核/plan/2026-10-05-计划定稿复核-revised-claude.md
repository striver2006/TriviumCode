---
schema: trivium.disposition.v1
topic: 计划定稿复核
stage: plan
role: claude
kind: revised
run_id: 20261005T062609Z
addresses:
  - 2026-10-05-计划定稿复核-codex.md
  - 2026-10-05-计划定稿复核-gemini.md
  - 2026-10-05-计划定稿复核-glm.md
---

# 计划定稿复核 · 计划双审第 1 轮裁决

run `20261005T062609Z`：codex、gemini、glm 均 `approve-with-nits`，共 5 条（次要 4、吹毛求疵 1），全部接受。
CODEX-03 与 GLM-01 同指一处（期望集派生会复制第二份），一并处理。合入后的完整计划见 `2026-10-05-计划定稿复核-r2-claude.md`。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：C2 只有一条告警、没有剔除告警在场，顺序与封顶两种变异都看不出来；R2 只测组装函数、不经过拼接。拼接抽成纯函数后单测能造出超过 5 条的剔除告警，集成侧用「计划阶段 codex、代码阶段 claude」这一现成形态让剔除告警真实在场 | r2 §2.5 新增 `composeMustReadWarnings`；§3.1 新增 R14；§3.2 新增 C8；§4 M-order 改指 R14、C8 |
| CODEX-02 | codex | minor | 接受 | 属实：第 ⑥ 格的三个成因里「复核过程抛出异常」没有一格覆盖，删掉兜底不会有任何用例变红，而它是「自动条目不拒跑」的最后一道。兜底放在 `recheckPlanFinal` 内（判据层直接返回无从复核），用裁决件位置上放一个同名目录让读文件抛出来构造 | r2 §2.4 第 ⑥ 格写明兜底位置；§3.1 新增 R13；§4 新增 M-catch |
| CODEX-03 | codex | minor | 接受 | 属实，与 GLM-01 同指：r1 让复核按「第 1、5 步同样拼出」期望集，是同一派生的第二份实现。改为把第 1 步的结构化编号收集、第 5 步的期望集并集各抽一个小函数，接受集合函数直接收 `loadRoundReviews` 的产出在内部调它们；闸门第 1、5、6 步改调同一组函数，逐字等价 | r2 §2.2 改写为三个函数；§2.4 第 ⑤ 格改为直接传 `loadRoundReviews` 的产出；§3.1 R12 扩到含逐条降级与整份回退 |
| AGY-01 | gemini | nit | 接受 | 属实：`resolvePlanFinal` 返回的是项目相对路径，`parseArtifactName` 的正则锚定日期开头，直接传路径必返回 null，再取 `.role` 会抛出、被兜底吞成「复核出错」——错误的成因。改为调用方传 `path.basename`，函数内对解析结果判空、判空即无从复核并点名文件名 | r2 §2.3 第 1 步写明入参是文件名并判空；§2.4 第 ⑥ 格加「定稿文件名解析不出」；§3.1 R9 加第 ③ 格 |
| GLM-01 | glm | minor | 接受 | 属实，与 CODEX-03 同指：`voidedSides`、`readonlyBreach`、`reviewDocs`、`planFinal` 都是因「调用方各自拼」才收进统一派生的。处置同 CODEX-03；另按建议把 R12 的等价布局扩到含逐条降级与整份回退侧，并在 `checkAdjudication` 与复核两处注释互指 | r2 §2.2、§2.4 第 ⑤ 格、§3.1 R12 |

## 逐条说明

### CODEX-01（接受）

r1 的 M-order 写「由 C2 杀死」，但 C2 只有一条告警：复核告警排在剔除告警之前还是之后、计入还是不计入封顶，单条时都观察不到。修法两层：

1. `prepareRun` 里 `review.ts:1072～1074` 的三行拼接抽成导出纯函数 `composeMustReadWarnings(planFinalWarnings, pruned, sides)`，返回 `{ all, display }`。新单测 R14 造 7 条剔除条目（超过 `MUST_READ_PRUNED_DISPLAY_MAX = 5`），断言计划定稿那一条在两份里都排第一、`display` 里它之外恰好 5 条剔除告警（不占封顶名额）。
2. 新集成格 C8：计划阶段 codex 执笔（`topic claim` + `--driver codex`）、代码阶段 claude 执笔——计划定稿 `-r2-codex.md` 对 gemini、glm 两侧是禁读，按 EV-02 剔除并告警（`task-goal-fulltext.test.ts` I8 第二格的现成形态）；再让定稿漏一条接受编号，断言 `--start` 的 `warnings` 第一条是「计划定稿未通过复核」、其后是剔除告警。

M-order 拆成「排到剔除之后」（R14、C8 红）与「计入封顶」（R14 红）两条。

### CODEX-02（接受）

`recheckPlanFinal` 整个函数体包一层 try/catch，异常一律返回 `{ kind: 'unverifiable', reason: '复核出错：…' }`，`prepareRun` 侧不再另包。R13 在裁决件的位置放一个同名**目录**：`listStageArtifacts` 照常列出它（只看名字），读文件时抛 EISDIR——断言返回无从复核、原因含「复核出错」，组装后的告警含「无从复核」。变异 M-catch 删掉兜底 ⇒ R13 红（Promise 被拒）。

### CODEX-03 / GLM-01（接受）

`gate.ts` 抽三个函数，闸门与复核共用：

- `collectStructuredIds(reviews)`：第 1 步的收集循环；
- `expectedFindingIds(structuredIds, degradedIds)`：第 5 步的 `idsSet`（合格 ∪ 逐条降级）；
- `acceptedIdsForNextPlan({ reviews, expectedDegradedIds, expectedFallbackIds, rows })`：内部调上面两个，再按第 6 步原样过滤；`expectedFallbackIds` 为 null 时虚拟编号按表、否则按清单。

`checkAdjudication` 第 1 步改调 `collectStructuredIds`、第 5 步改调 `expectedFindingIds`、第 6 步改调 `acceptedIdsForNextPlan`（传 `input.expectedFallbackIds ?? null`）。第 6 步因此重算一次期望集——几十个编号的集合运算，成本可忽略，换来派生只有一份。复核把 `loadRoundReviews` 的产出直接交给 `acceptedIdsForNextPlan`，自己不拼任何集合。R12 的等价布局扩到「一侧逐条降级、一侧整份回退」，两处源码注释互指。

决策五「第 6 步只换函数调用、逐字等价」仍成立：行为等价由既有 `plan-final-gate` 单测与 R12 守。

### AGY-01（接受）

`recheckPlanFinal(layout, finalFileName)` 的入参是**文件名**；`planFinalRecheckWarning` 调它时传 `path.basename(planFinal.path)`。函数内 `parseArtifactName` 返回 null 时直接返回无从复核（「定稿文件名 … 解析不出执笔方」），不靠兜底吞异常。实际上 `locateSubject` 只返回可解析的文件，这一格只防将来调用方传错。
