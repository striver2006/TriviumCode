---
schema: trivium.disposition.v1
topic: 多轮评审循环
stage: plan
role: claude
kind: revised
run_id: 20261021T231442Z
addresses:
  - 2026-10-22-多轮评审循环-gemini.md
  - 2026-10-22-多轮评审循环-glm.md
---

# 裁决：多轮评审循环 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-22-多轮评审循环-claude.md`（r1，起点 `faae0483`，实现已在工作树）
> gemini `request-changes`（2 major、1 minor），glm `approve-with-nits`（1 major、1 minor、1 nit）。六条全部接受，合入后的计划见 `plan/2026-10-22-多轮评审循环-r2-claude.md`。
> 本轮由旧安装副本跑（v1 契约、无计票），两侧结论是 v1 四值，不进新规则的计票。
> 裁决前逐条回源码核过依据：`schemas.ts:257-317` 的 `checkAgentIdentities` 确实不看 `round_verdict`；`review-code.contract.md:6` 的 Bash 只放行 `.trivium/bin/trivium:*`；`review.ts:300-304` 读不出即 `return null`，而 `meta.ts latestRunMeta` 的 `unreadable` 只收比最新可读份更新的那几份；`runner.ts` 的 strict 只对失败侧中止、整份回退侧照常跑成。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 成立：`run.v3.json` 的 `round_verdict.sides` / `excluded` 描述里写了「是否已登记由代码层按注册表校验」，代码层却没校——描述承诺了一道并不存在的守卫。与 `critics` 键同类，属两段式校验该兜的跨字段约束 | `schemas.ts checkAgentIdentities` 补：`round_verdict.sides` 与 `excluded` 的每个键须是已登记、可当审核者的 Agent id，且在 `critics_selected` 内；同一侧不得同时出现在两处。单测补非法键、不在入选集合、两处重叠三格。r2 §四.1 |
| AGY-02 | gemini | major | 接受 | 成立：命令 C 第 5.5 步要求「改完先自查能编译、相关用例能过」，而 allowed-tools 的 Bash 只放行编排器，L1 载体跑不了构建与测试，要么一路弹权限、要么跳过自查。命令 C 自 EV-247 起每轮都改业务代码，与命令 A 的 S5 / S8 同性质，Bash 放行口径应与命令 A 一致 | `skills-src/commands/review-code.contract.md` 的 allowed-tools 追加 `Bash`（与 `run.contract.md` 同写法）；`apply.code.md` 写明用项目的常规构建 / 测试命令自查、审查期内不得用它改业务文件；`npm run render` 同步产物。命令 B 不改（计划审不改业务代码）。r2 §六 |
| AGY-03 | gemini | minor | 接受 | 成立：「与原稿同目录」在原稿经 `--plan-file` 来自归档外时会把新一轮计划引到归档外，`checkNextPlan` / `resolvePlanFinal` 只在 `.reviews/<主题>/plan/` 下找，必判 `missing_next_plan`；循环里续轮被审对象也就接不上。该句源自 EV-214，本主题改这个片段时一并修 | `skills-src/partials/review/next-plan.plan.md`：「与原稿同目录」改为「写在本主题的 `.reviews/<主题>/plan/` 下——原稿经 `--plan-file` 来自归档外时也一样」；`loop.plan.md` 的续轮说明同步（给过 `--plan-file` 时改传归档内新一轮计划的路径）。`npm run render`。r2 §六 |
| GLM-01 | glm | major | 接受 | 成立，且可达面确如所述比 r1 自述宽：缺省 strict 下整份回退侧不中止运行，终判作废侧也只出分母，三审面板剩一票即可定整轮；命令 A 计划阶段 `proceed` 后既无人工停点、新计划也不再送审。取 glm 建议的下限：**有效票 × 2 < 入选侧数 ⇒ `undetermined` ⇒ `human_review`**（整数比较，与 `2k ≥ n` 同口径）。双审面板 1 票仍可定论（与既有 `--allow-single` 降级语义一致），三审及以上才生效；方向是 fail-safe（多停一次人工），不会让任何原本停下的情形放行。**这是执笔方的取舍，收尾时请用户确认** | `round-verdict.ts`：`decideOutcome` 增入选侧数参数、`tallyRound` 以 ballots 键数为入选侧数；`outcomeLabel` 的 `undetermined` 文案改「有效结论不足」；`HUMAN_REVIEW_REASON`、`loop.*` 片段、命令 A 契约、`run.v3.json` 描述、设计 8.2.1、需求 稳需-15、BACKLOG 同步改口径。单测补三审「两侧回退 + 一票 pass ⇒ undetermined」与「两票有效 ⇒ 正常判」两格。r2 §0 D-5、§三 |
| GLM-02 | glm | minor | 接受 | 成立：`previousRoundFacts` 会越过「带链、无计票」的失败轮继续往旧走，而入口的 corrupt 判定只覆盖比最新可读份更新的坏件；夹在失败轮之后的坏件会让续链静默新起、上限重置，是 fail-open 方向，与 `driver-claim.ts` 的 corrupt 纪律相反 | `review.ts previousRoundFacts`：遇到文件在场但 `readRunMeta` 读不出时，**硬失败**（`EXIT.GATE_BLOCK`，文案以 `meta.ts unreadableRunMetaExitAt` 收尾），不折成「没有上一轮」；仍在分配 run_id 之前，零工件。集成用例补「失败轮 → 坏件 → rerun 链首」排序，断言拒跑且不新起一链。r2 §四.4 |
| GLM-03 | glm | nit | 接受 | 成立：§九「只剩两处」的论域写错了——类型联合、判据、不计票原因的用户文案与注释里都有 v1 字面；`types.ts` `DegradedFinding` 的文档块仍写「不合 trivium.review.v1」，是漏改的过期注释 | r2 §九 改为「仍会**产出** v1 形态的只有桩的 `legacySchema` 与探针夹具两处；类型联合、判据与文案里的字面属设计内」；`types.ts` `DegradedFinding` 注释改为「不合现行审查契约」。r2 §九 |

## 不构成意见、一并说明的

- gemini 总判断第 4 条与 glm「认为正确的部分」都认可了 r1 §八 第 1、3、5、6、7 问的取法（`undetermined` 第 1 轮也停、作废侧不影响运行计票、`proceed` 轮新计划不再送审、命令 C 最后一轮改码只过人工审批、读取侧判据已收齐）；r2 把这几问从「拿不准」改记为已定。
- glm 盲区里提到「`task.json` 读不出时 `humanDecidedThisRound` 恒为 true ⇒ 新起一链」只做了推理：这是 `approval.ts` 既有的 fail-closed 口径（读不出即视为已表态）。对轮次链的效果是断链、从第 1 轮起，**上限随之重置**——与 GLM-02 同属「留痕坏了、链被静默重置」一族，但成因在 task.json 而非 run.json，`review --start` 自身对读不出的 task.json 如何处置执笔方尚未核实。不是意见编号，r2 §十 记为已知边界，代码双审时请审查员一并看。
