---
schema: trivium.disposition.v1
topic: 多轮评审循环
stage: code
role: claude
kind: response
run_id: 20261021T233757Z
addresses:
  - 2026-10-22-多轮评审循环-gemini.md
  - 2026-10-22-多轮评审循环-glm.md
---

# 应答：多轮评审循环 · 代码双审第 1 轮

> 被审对象：相对 `faae0483` 的工作树改动（72 个文件），计划定稿 `plan/2026-10-22-多轮评审循环-claude.md`（启动时编排器告警：该定稿未通过复核，缺 r2 计划，见文末）。
> gemini `approve-with-nits`（1 条 minor），glm `request-changes`（1 条 major、1 条 minor）。3 条全部接受，修改在审批之后进行。
> 裁决前逐条对过代码：
> - AGY-01：`latestRunMeta`（`meta.ts:593`）newest-first、取到第一份可读的就返回，`unreadable` 只装比它更新的那几份；`resolveStageDriver` 因此只挡「最新一份读不出」。而 `previousRoundFacts`（`review.ts:287`）会越过失败轮继续往旧处走，走到读不出的一份时 `return null`——`review.ts:285` 注释「走不到这里」在这一格不成立。
> - GLM-01：`review.ts:1279` 的比较-交换期望态不含 `awaiting_approval`、也没传 `allowMissing: false`，`state.ts:210` 在槽位缺失时放行；`deriveReviewLoop`（`round-verdict.ts:153`）对 `next_action === 'human_review'` 且未表态的上一轮判「新链」。两者叠加，state.json 缺失时人工审核的停点只靠本机副本把守，属实。`round-verdict.ts:169` 的「到上限」分支按 `nextAction` 的构造确实不可达。
> - GLM-02：`review.ts:1382` 让纯文档跳过轮不写 `reviewLoop`，于是它不满足 `review.ts:304` 的跳过谓词（要求 `m.review_loop` 为真），会被当作上一轮返回，链被打断、上限重置。跳过轮在 run.json 里有 `skipped: true`（`review.ts:1399`）可供判别。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| GLM-01 | glm | major | 接受 | 「最后一轮仍不通过就停下人工审核」是本主题的核心承诺，不该只靠 state.json 这份本机副本把守；归档正本里 `round_verdict` 与审批记录本来就已读到手，补这一格几乎没有代价。只把住 `human_review` 且未表态这一格，`proceed` 未表态维持现状（它不属于轮次链不变量，本机由比较-交换拦） | `src/trivium/round-verdict.ts` `deriveReviewLoop`：`prev.review_loop` 在、`prev.round_verdict?.next_action === 'human_review'`、`!prev.closed` ⇒ 返回 `ok:false`，沿用 169 行那段「请人工审核……再决定是否重新起链」的出口文案，并把原来不可达的上限分支并入或改注释；`test/unit/round-verdict.test.ts` R10 家族补「human_review 未表态 ⇒ 拒绝」与「human_review 已表态 ⇒ 新链」两格；`test/integration/review-loop.test.ts` 补「human_review 未表态、删掉 state.json 后 `review --start` 退 64 且零工件」 |
| AGY-01 | gemini | minor | 接受 | 核实属实：最新一份是失败轮、更早一份读不出时，`resolveStageDriver` 放行而 `previousRoundFacts` 静默当「没有上一轮」，预算被重置。应 fail-closed，与 `corrupt` 一档同口径 | `src/trivium/review.ts` `previousRoundFacts`：遍历中遇读不出的 run.json 改为抛用法错误（退 64），文案点名那份 run_id 并接 `unreadableRunMetaExitAt` 出口段；同步改正 285 行注释（只有最新一份读不出才由 `resolveStageDriver` 先挡）；`test/integration/review-loop.test.ts` 补「最新为失败轮、次新 run.json 写坏 ⇒ `--start` 退 64」 |
| GLM-02 | glm | minor | 接受 | 纯文档跳过轮同失败轮一样没消耗轮次，不该打断轮次链；设计 6.7.1 只写了跳过轮不写 `review_loop`，没说它会断链，按「不消耗轮次」的同一原则跳过它 | `src/trivium/review.ts` `previousRoundFacts` 跳过谓词增加 `m.skipped === true`（未表态时）一格，注释同步写明「失败、超时、取消、纯文档跳过都不消耗轮次」；`doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md` 6.7.1 补一句跳过轮不断链；单测或集成补「rerun → 纯文档跳过 → 再送审仍是第 2 轮」 |

## 修改计划

审批后按上表改码，三处都在续链判定一条路径上，一起改、一起补用例，然后跑 `npm run check` 与全量测试两次。改完再送一轮代码双审（这是 major 级接受项，不走自审收口）。

## 遗留事项（不在本轮裁决范围，提请用户处理）

- 启动时编排器告警：计划定稿 `plan/2026-10-22-多轮评审循环-claude.md` 未通过复核——计划阶段 run `20261021T231442Z` 接受了 AGY-01～03、GLM-01～03 共 6 条，但没有 `-r2-claude.md`，代码审查员读到的是未修订的原稿。会话开始时 Hook 也提示计划阶段裁决未齐备。两种处置（补 r2 计划后重跑代码双审，或先送一轮计划双审）由用户选。
- 编排器收尾提示：安装副本构建于 `b3140f0`，与当前工作树不一致；做验收前要先 `install:local`。
