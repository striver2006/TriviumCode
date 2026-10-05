# 计划定稿复核 · 实施报告（EV-215）

> - **日期**：2026-10-05
> - **主题**：`计划定稿复核`（命令 A `/dual-run`，Driver claude）
> - **起点**：`32dd96d`（`main`，工作树干净）
> - **入选审核者**：codex、gemini、glm
> - **计划**：`.reviews/计划定稿复核/plan/` r2（计划双审第 1 轮 run `20261005T062609Z`：codex、gemini、glm 均 `approve-with-nits`，5 条全接受）
> - **代码双审**：run `20261005T070435Z`（14m14s，三侧到齐）：codex `approve`、gemini `approve`（均零意见）、glm `approve-with-nits`（吹毛求疵 1），GLM-01 接受——C7 断言集的收窄登记进 §3 第 3 条
> - **证据目录**：`doc/05_testing/evidence/plan-final-recheck-20261005/`
> - **配额**：全程零配额：桩适配器与本机构建，不跑任何真实 CLI

## 1. 问题

EV-214 让计划闸门在有接受项时要求执笔方的新一轮计划存在、且逐字引用每条接受编号，但判定只在 `gate --check`（与命令 B 的审批前复核）那一刻成立。命令 A 在 S4 之后没有第二次计划闸门；代码阶段 `resolvePlanFinal` 取执笔方轮次最大的一份当「本主题计划定稿」时，也不看计划阶段的裁决件。闸门通过之后再写的、没送审的更高轮次计划，会原样送给代码审查员，里面漏掉的接受项无人发现（设计 §6.6 规则 9 边界④）。

## 2. 改了什么

1. **共用的接受集合**（决策二；计划双审 CODEX-03 ≡ GLM-01）：`gate.ts` 把 `checkAdjudication` 第 1 步（结构化编号）、第 5 步（期望集 = 合格 ∪ 逐条降级）、第 6 步（期望集内的接受编号）抽成 `collectStructuredIds` / `expectedFindingIds` / `acceptedIdsForNextPlan`，闸门与复核调同一组；闸门行为与输出逐字不变。
2. **复核判据**：`gate.ts` 新增 `recheckPlanFinal(layout, 定稿文件名)`，结论四种（`skipped` / `passed` / `failed` / `unverifiable`），只读、函数体内兜底、从不抛出（CODEX-02）。执笔方取定稿文件名后缀，解析不出即无从复核（AGY-01）；计划阶段 run.json 从新到旧取第一份有裁决件的运行（没有裁决件的往旧里跳过）；无标记或接受集合为空不复核；否则以「后续轮次恒为空」调 `checkNextPlan`，恒核代码审查员读到的那份。
3. **告警与接线**（决策三）：`review.ts` 新增 `PLAN_FINAL_RECHECK_WARNING`（「计划定稿未通过复核」）与 `planFinalRecheckWarning`：失败时嵌入 `checkNextPlan` 的失败消息原文、涉及编号与两条处置（合进定稿后重跑代码双审 / 送一轮计划双审，调用写法按代码阶段 Driver）；无从复核时写明原因。`prepareRun` 在 `resolvePlanFinal` 列入定稿后调它；告警拼接抽成 `composeMustReadWarnings`（CODEX-01），计划定稿那条与「必读清单未列计划定稿」互斥、排在剔除告警之前、不计入封顶，同走 `--start` warnings、同步 warnings、run.json `gate.warnings` 三个出口。
4. **第 4 段不标注**（决策四）：任务书在任何复核结果下都与改前逐字相同。
5. **文档**：设计 v1.3.90（§6.6 规则 9 边界④改写并新增「代码阶段复核」一条、§9.4 第 4 条、版本记录）、LLD v1.1.36、MANUAL v1.0.30；BACKLOG EV-215 结案。

## 3. 与计划的出入

1. **变异编号**：计划 r2 §4 用 M-later 一类名字列了 12 条候选；规格按源码定为 M1～M15（M-order-a 拆成播报通道与 run.json 两条，另加「去掉第 ④ 格」「接受集合不按裁决过滤」两条），每条的 `desc` 带回计划里的名字。
2. **R12 的比较面**：计划写「失败码与 `ids` 两边一致」，实现还比了失败消息逐字相同。
3. **C7 少了「补齐后无告警」那半**（代码双审 GLM-01）：计划 r2 §3.2 的 C7 断言列写了两条——告警点名 `-r2-codex.md`、补齐 codex 那份后无告警；实现只落了第一条（另加了处置写法按 codex、不提 claude 后缀那份两条断言）。同一夹具里代码阶段闸门停在待裁决，再起一轮 `--start` 会被槽位判定拦下，补这半要另建夹具重跑计划与代码两段。「codex 后缀的定稿齐全 ⇒ 通过」由单测 R6 的 passed 分支覆盖，「定稿齐全 ⇒ 经真实 CLI 无告警」由集成 C1 覆盖。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 历史归档实扫（82 个有计划阶段运行的主题） | 最新一次运行没有裁决件：0；中途没有裁决件的运行 7 次，全部 `gate.state = failed`；另有 1 份崩溃骨架；最新一次运行带 `plan_final_check`：0（复核对全部历史主题都不触发） | 计划 r2 §1.5；codex 侧独立复扫一致 |
| 新单测 `plan-final-recheck.test.ts` | 14/14（R1～R14） | 全量内含 |
| 新集成 `plan-final-recheck.test.ts` | 8/8（C1～C8，打包 CLI + 桩适配器，每格核桩指纹） | 全量内含 |
| `task-goal-fulltext.test.ts`（I9 补断言） | 13/13 | 全量内含 |
| 闸门相关回归（`plan-final-gate` 单测与集成、`gate`、`gate-degrade`、`task-goal-appendix`、`driver-wiring`、`mustread-deny`） | 146/146 | — |
| 变异逐条预跑（带 `--test-timeout`，记失败用例名） | 15/15 红在预期的格 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 `scripts/mutation-check.mjs` | 15/15 咬住，基线全绿 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 代码双审前全量 `npm run check` | 2814 / 2812 / 0 / 2，退 0 | `check-1-pre-s6.txt` |
| 代码双审前 `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest-pre-s6.txt` |
| 代码双审前系统临时目录新建条目 | 全量：2（均为 `trivium-index-`，产品代码进程被杀时的已知残留，EV-204 残余五）；自检：0 | `count-new-check-1-pre-s6.txt`、`count-new-selftest-pre-s6.txt` |
| S9 后全量 `npm run check` 两次（串行） | 两次均 2814 / 2812 / 0 / 2，退 0 | `check-1.txt`、`check-2.txt` |
| S9 后 `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| S9 后系统临时目录新建条目 | 全量 1：2、全量 2：1（均为 `trivium-index-`）；自检：0。除 `trivium-index-` 外为 0 | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-selftest.txt` |
| S10 `trivium verify` | 通过（run `20261005T072937Z`：typecheck、build、test 三条，288s）；期间临时目录新建 0 | `.reviews/计划定稿复核/verify/`、`count-new-verify.txt` |

## 5. 边界

1. 复核只在代码双审开跑那一刻成立；开跑之后再改定稿，下一轮代码双审才会再核。
2. 计划阶段最新一轮全部驳回时不复核，此后另写的、不含早先轮次编号的定稿不会被发现。
3. 字面判据的两条边界（只核字面、跨轮同名编号，EV-216）原样继承。
