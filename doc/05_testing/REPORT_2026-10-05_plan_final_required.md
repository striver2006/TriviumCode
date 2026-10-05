# 计划定稿强制产出 · 实施报告（EV-214）

> - **日期**：2026-10-05
> - **主题**：`计划定稿强制产出`（命令 A `/dual-run`，Driver claude）
> - **起点**：`50110fc`（`main`，工作树干净）
> - **入选审核者**：gemini、glm（首次发起时预检报 codex 侧 profile「kimi」5 小时用量用尽，用户改用 `--critics gemini,glm` 重发）
> - **计划**：`.reviews/计划定稿强制产出/plan/` r2（计划双审第 1 轮 run `20261005T032334Z`：gemini `request-changes`（重要 2、次要 2）、glm `request-changes`（重要 1、次要 2），7 条全接受）
> - **代码双审**：run `20261005T041442Z`（8m53s，两侧到齐）：gemini `approve`（零意见）、glm `approve-with-nits`（次要 1、吹毛求疵 2），3 条全接受——GLM-01 新集成用例补桩指纹断言、GLM-02 `PlanFinalCheck` 挪到 `RunTermination` 之后、GLM-03 I6 偏离写进本报告 §3
> - **证据目录**：`doc/05_testing/evidence/plan-final-required-20261005/`
> - **配额**：全程零配额：桩适配器与本机构建，不跑任何真实 CLI

## 1. 问题

计划双审的裁决件里有接受项时，流程不要求把它们合进新一轮计划：`/dual-run` 的 S3 与 `/dual-review-plan` 只要求写裁决件，`gate --stage plan --check` 只校验裁决是否齐备。而 EV-210 起，代码阶段必读清单自动列入「本主题计划定稿」——`resolvePlanFinal` 取执笔方后缀、非裁决件、轮次最大的一份。Driver 没写新一轮计划时，代码审查员读到的「定稿」是未修订的原稿：已接受的修改落进代码会被看成偏离计划，漏改了也查不出。历次主题都有 r2，那是 Driver 的习惯，不是流程保证。

## 2. 改了什么

1. **闸门判据**（决策一～四）：`gate.ts` 新增 `checkNextPlan`，由 `checkAdjudication` 在全部既有项之后、仅计划阶段调用。本轮裁决件有**期望集内**的接受编号（合格 ∪ 逐条降级 ∪ 虚拟编号；计划双审 AGY-02）时，要求执笔方的新一轮计划存在（`plan/` 根、当轮 Driver 后缀、无中缀、非审查件、轮次大于基准），且每个接受编号在其全文整词逐字出现（`mentionsFindingId`：前后字符都不是 `[A-Za-z0-9_]`）。基准轮次 = 被审对象轮次，没有才取 `rerun_index`（GLM-01）。本轮已被后续运行接手时核最小候选、否则核最大候选——即代码阶段会读的定稿（AGY-01、GLM-03）。新失败码 `missing_next_plan`（给出应写文件名）、`next_plan_missing_ids`（列缺的编号），排在全部既有失败项之后、照常一次全报。
2. **输入接线**：`GateCheckInput` 新增必填可为 null 的 `planFinal`；`loadRoundReviews` 从运行元数据派生它（本轮标记 + 本阶段更晚运行的被审对象轮次），`gate --check` 与 `verifyRoundForApproval`（`--await-approval` / `approve` 共用）照传。41 处既有单测调用补 `planFinal: null`。
3. **只对新运行生效**（决策六）：run.v2 新增可选字段 `plan_final_check: { subject_rerun_index }`，`prepareRun` 在计划阶段用 `planSubjectRerunIndex` 算一次、经 `newRunMeta` 写进骨架。不带它的旧轮次有接受项时只出告警 `next_plan_unchecked`。
4. **流程说明**（决策五）：新增片段 `skills-src/partials/review/next-plan.plan.md`（code / bug 两个空变体），`body.md` 第 5 步按阶段选变体、`run.contract.md` 的 S3 直接嵌入；`npm run render` 重出 `dual-run` / `dual-review-plan` 各载体产物（claude、codex、gemini、glm 共 8 份）。
5. **自检**：计划阶段写裁决件后补写 `-r2-` 计划；「重跑抬升」判据从 `includes('-r2-')` 收紧为「r2 且后缀不是当轮 Driver」，不被 Driver 的 r2 冒充。
6. **文档**：设计 v1.3.89（§6.6 规则 9、§6.2 `-r<N>` 一行、§6.7.1 字段表、§9.4 第 4 条、版本记录）、LLD v1.1.35、PROTOCOL、MANUAL v1.0.29、QUICKSTART、README、`.reviews/README.md`、模板 README；BACKLOG EV-214 结案，另登 EV-215、EV-216。

## 3. 与计划的出入

1. **既有集成用例的改法**：计划 §3.3 说「按红的格逐个核」。第一遍全量 49 格红，集中在 `gate-loop`（裁决件辅助函数 `writeDisposition` 与几处内联写法都接受了 AGY-01 / GLM-01 却没有 r2）、`fault-injection` 6 格、`registry-parity` 1 格。处置：两个文件各加 `writeNextPlan` 辅助函数，`writeDisposition` 内部顺带写 r2，内联写接受项的几处各补一次（第二轮的写 r3，非缺省 Driver 那格写对应后缀）；没有改任何断言。读数留作 `check-0-exploratory` 段落（§4 表）。
2. **`registry-parity` 一格**：自检里收紧判据时写了带引号的 `'claude'`，被「白名单外模块不得出现 Agent id 字面量」拦下，改用 `DEFAULT_DRIVER`。
3. **变异多两条**：M17（「更晚运行」误收更早的运行）、M18（被审对象轮次不核后缀）；计划 §4 是 M1～M16（M2 拆 a / b）。
4. **AGENTS.md 未改**：其协议块与 `skills/dual-critic/protocol/driver.snippet` 同源（`trivium init` 写进用户项目），「逐条裁决」那一行不涉及新一轮计划；流程细节写在入口命令里，不扩到 snippet。
5. **I6 的执笔方用 codex，不是计划写的 gemini**（代码双审 GLM-03）：计划 r2 §3.2 写「`--driver` 取 gemini、审核者取其余」，实现用 codex 当执笔方、入选 gemini 与 glm 两侧的桩——与单测 U6、EV-210 的 `task-goal-fulltext` I8 同一构造，桩现成、覆盖等价（都测「应写名取当轮 Driver 后缀、别家后缀的 r2 不算」）。按审查建议不改测试，记于此。
6. **历史读数订正**：计划 r2 §1.5 写「约 20 个主题的最新一轮会转红」，那是按 r1 规则估的；按 r2 规则（基准取被审对象、在用的轮次核定稿、接受集合限期望集内）复算是 **26 个**——早期主题的 r2 普遍没有逐条引用编号。结论（一律校验会让大批历史主题转红）不变；设计 §6.6 与 BACKLOG 写的是复算后的数。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新单测 `plan-final-gate.test.ts` | 22/22（U1～U17、U15b，标记写侧 / 契约 / `loadRoundReviews` / `planSubjectRerunIndex` 各一格） | 单跑输出见会话；全量内含 |
| 新集成 `plan-final-gate.test.ts` | 7/7（I1～I7，打包 CLI + 桩适配器） | 同上 |
| 受影响的三个既有文件（`gate-loop`、`fault-injection`、`registry-parity`）修后单跑 | 178/178 | — |
| 探路全量（修既有用例之前） | 2792 例，失败 49（见 §3.1），跳过 2 | 未落证据（scratchpad） |
| 变异预跑（逐条 `--test-timeout`） | 19 条全部咬住，无超时；M2a 只红 U15（max 写法）、M2b 红 U8 / U15，两种基准取法可区分 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置（`scripts/mutation-check.mjs`） | 19/19 咬住，基线全绿（2 个套件） | `mutation-output-pre-s6.txt` |
| 全量 `npm run check` 第 1 次 | 2792 / 2790 通过 / 0 失败 / 2 跳过 | `check-1-pre-s6.txt` |
| 全量第 2 次（串行） | 2792 / 2790 / 0 / 2 | `check-2-pre-s6.txt` |
| `doctor --selftest` | 14/14 | `doctor-selftest-pre-s6.txt` |
| 系统临时目录 `trivium-` / `tv-` 新建条目（按创建时间） | 全量 1：0；全量 2：0；自检：0 | `count-new-*-pre-s6.txt` |
| **代码双审修改（S9）之后**：新用例单跑 | 29/29（I1～I7 每格都断言两侧桩指纹） | — |
| S9 后变异装置 | 19/19 咬住，基线全绿 | `mutation-output.txt` |
| S9 后全量第 1 次 | 2792 / 2790 / 0 / 2 | `check-1.txt` |
| S9 后全量第 2 次（串行） | 2792 / 2790 / 0 / 2 | `check-2.txt` |
| S9 后 `doctor --selftest` | 14/14 | `doctor-selftest.txt` |
| S9 后系统临时目录新建条目 | 全量 1：1（`trivium-index-`）；全量 2：1（`trivium-index-`）；自检：0。`trivium-index-` 是产品代码进程被杀时的已知残留（EV-204 残余五），除它之外为 0 | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-selftest.txt` |
| S10 `trivium verify` | 通过（typecheck、build、test 三条命令，300 s）；期间临时目录新建 0 | `.reviews/计划定稿强制产出/verify/2026-10-05-计划定稿强制产出-verify.md`、`count-new-verify.txt` |
| 历史归档复算（r2 规则、只读） | 按轮：通过 64、不要求 1、缺新一轮计划 22、缺编号 24、跳过 8；最新一轮会转红的主题 26 个 | `scan-plan-final.mjs`、`scan-plan-final.txt` |

## 5. 边界（写进设计 §6.6 规则 9）

1. 只核字面，不判合入内容是否正确，也不判编号出现的语境。
2. 编号每轮从 01 重编，分不出同名编号属于哪一轮（EV-216）。
3. 接受集合取自裁决件，裁决件本身被改由既有校验与提交锚负责。
4. 判定只在闸门调用那一刻成立：通过之后再写的更高轮次计划，命令 A 没有第二次计划闸门、代码阶段入口也不复核（EV-215）。
5. 「已被后续运行接手」不区分后续运行的终态：failed / cancelled / running 的骨架只要带标记、被审对象轮次高于基准，就算接手（代码双审 glm 盲区一节提及、未列为意见）。理由：那份计划在冻结时已被送审，本轮的接受项交给了它；接手后核的正是那份被冻结的对象，不会放宽到一份没人看过的计划。
6. 只对 run.json 带 `plan_final_check` 的新运行生效；本题自己的计划阶段由旧版编排器跑、不带标记。**要用户重装之后**真实流水线才生效。
