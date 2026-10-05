# 目标回退取计划定稿 · 实施报告（EV-212）

> - **日期**：2026-10-05
> - **主题**：`目标回退取计划定稿`（命令 A `/dual-run`，Driver claude）
> - **起点**：`7b643b0`（`main`，工作树干净）
> - **入选审核者**：codex、gemini、glm
> - **计划**：`.reviews/目标回退取计划定稿/plan/` r2（计划双审第 1 轮 run `20261005T090634Z`：gemini `approve`，codex、glm `approve-with-nits`，4 条全接受）
> - **代码双审**：run `20261005T093847Z`（17m37s，三侧到齐）：glm `approve`（零意见）、gemini `approve-with-nits`（次要 1、吹毛求疵 1）、codex `request-changes`（重要 1、次要 1、吹毛求疵 2），6 条全接受——本报告与索引随被审 diff 补齐（CODEX-01 ≡ AGY-01）、新集成套件补桩指纹断言（CODEX-02）、三处措辞与注释（AGY-02、CODEX-03、CODEX-04）
> - **证据目录**：`doc/05_testing/evidence/goal-fallback-plan-final-20261005/`
> - **配额**：全程零配额：桩适配器与本机构建，不跑任何真实 CLI

## 1. 问题

任务目标的第三级回退（`resolveTaskGoal`：没有 `--goal`、任务文件也没有目标时，取本主题计划文档的首个标题/首段）用 `locateSubject` 按**本轮**（代码 / bug 阶段）Driver 的后缀找计划文档，而不是按计划阶段的执笔方。两个阶段分属两家时（例如计划 codex、代码 claude），它找不到计划文档、任务目标静默为空；计划目录里恰有一份本轮 Driver 后缀的文件时，就取到那份别家后缀的文件。EV-210 新加的 `resolvePlanFinal` 已按计划阶段执笔方取件，两处从此不同源。另：设计 §9.4 写「plan 原稿」，实现一直取轮次最大的一份。

## 2. 改了什么

1. **第三级复用 `resolvePlanFinal`**（决策一）：`resolveTaskGoal` 删去自己那次 `locateSubject`，改收第 4 个必填参数 `planFinal: () => Promise<PlanFinal>`（`PlanFinal` 即 `resolvePlanFinal` 的返回类型），只在前两级为空、且不是计划阶段时调用、至多一次。`prepareRun` 代码阶段传 `async () => planFinal`（复用必读清单已算好的那次，不判第二次），bug 阶段传 `() => resolvePlanFinal(ref, projectRoot)`（现算，只取目标，不进必读清单、不出告警）。`opts` 的 `Pick` 去掉 `driver` 与 `subjectFile`。
2. **取不到即不渲染**（决策二）：`path` 为 null（没有计划阶段，或计划阶段留痕读不出）返回 null，后者的告警在该处有意丢弃并写明理由；读件失败或现算抛出落 catch 返回 null，不给 bug 阶段添拒跑面。相对路径按同一个 `projectRoot` 还原。
3. **措辞与设计对齐**（决策三、六）：设计 §9.4 第 4 条改写（第三级与必读清单同一份、同一处判定，分阶段取法、留痕读不出的处理、跨禁读集的那一行），6.7、7.1 同义处同步；LLD 3.3 计算段；MANUAL `--goal` 回退一段；CLI `--goal` 帮助、`topic-args.ts` / `meta.ts` / `review.ts` 注释；`skills-src/partials/review/body.md` 两处并重渲染 12 份技能产物。
4. **护栏表**：`driver-wiring.test.ts` 删去 `resolveTaskGoal` 那一处的锚点条目，`RECONCILE` 的 `locateSubject` 期望 3 降 2。
5. **文档**：设计 v1.3.91、LLD v1.1.37、MANUAL v1.0.31；BACKLOG EV-212 结案。

## 3. 与计划的出入

1. **M3a 是等价变异，已从规格删除**：计划 r2 §4.4 预告过。预跑 fail=0——`path.resolve` 遇 null 抛 TypeError、落进 catch 同样返回 null。判空保留只为可读。含 M3a 的预跑读数另存为 `mutation-names-log-with-m3a.txt` / `mutation-names-output-with-m3a.json` / `mutation-spec-with-m3a.json`。
2. **新增 M3b**（计划外）：「不丢弃告警，path 为空时把告警名当目标返回」——替 M3a 守住「告警不进返回值」，T3、T6 红。
3. **M4 的杀手不止 T7**（代码双审 CODEX-04）：计划 r2 §4.4 与 T7 注释写「T7 唯一杀手」，实测 fail=6。既有单测改用夹具根当 `projectRoot`（与进程 cwd 不同），凡期望取到目标的格都能杀它；集成侧子进程 cwd 就是项目根，对它没有鉴别力。T7 注释已改准；T7 仍要求断言非空（GLM-01 的担心——桩与函数根不一致时退化成永绿——照样成立）。
4. **测试报告晚于首轮代码双审**（代码双审 CODEX-01 ≡ AGY-01）：首轮送审的 diff 没带本报告与索引，而设计版本记录与 BACKLOG 已引用它；S9 补齐，偏离了 EV-215「报告随被审 diff 送审」的惯例。
5. **验收脚本的归一化多了两项**：计划 r2 §4.3 列了主题名、run_id、时间戳、路径、pid；实测新旧两侧的差异还有各自的资产根（schema 路径）与夹具父目录（运行根），一并归一。新旧两侧用同一个主题名，不需要归一主题名；pid 不出现在任务书里。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 单测 `task-goal.test.ts` | 16/16（既有 9 格改传取件函数 + T1～T7） | 全量内含 |
| 新集成 `goal-fallback-plan-final.test.ts` | 6/6（G1～G6，打包 CLI + 桩适配器，每格逐侧核桩指纹） | 全量内含 |
| 相邻回归（`task-goal-fulltext`、`bug-stage`、`topic-args`、`driver-wiring`、`task-goal-appendix`） | 全绿 | 全量内含 |
| A1 / A2 新旧构建任务书比对（基线 `7b643b0` 就地构建，bundle sha256 不同；每场景新旧各一个全新夹具） | 9/9 符合：A1 缺省执笔方代码 / bug 两侧逐字相同（目标行均为「claude 定稿标题」）；A2 计划 codex、代码 / bug 阶段 claude，旧构建无目标行、新构建为「codex 定稿标题」，去掉该行后逐字相同 | `a1-a2-old-new-brief.mjs`、`a1-a2-old-new-brief.txt` |
| 变异逐条预跑（带 `--test-timeout`，记失败用例名） | 含 M3a 的 9 条：8 条红在预期的格，M3a fail=0（等价，§3 第 1 条） | `mutation-names-log-with-m3a.txt`、`mutation-names-output-with-m3a.json` |
| 变异装置 `scripts/mutation-check.mjs` | S9 前 8/8 咬住；S9 后重跑 8/8 咬住，基线全绿 | `mutation-output-pre-s9.txt`、`mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 代码双审前全量 `npm run check` | 2826 / 2824 / 0 / 2，退 0 | `check-1-pre-s6.txt` |
| 代码双审前系统临时目录新建条目 | 全量：2（均为 `trivium-index-`，产品代码进程被杀时的已知残留，EV-204 残余五） | `count-new-check-1-pre-s6.txt` |
| S9 后全量 `npm run check` 两次（串行） | 两次均 2826 / 2824 / 0 / 2，退 0 | `check-1.txt`、`check-2.txt` |
| S9 后 `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| S9 后系统临时目录新建条目 | 全量 1：2、全量 2：2（均为 `trivium-index-`）；自检：0。除 `trivium-index-` 外为 0 | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-selftest.txt` |
| S10 `trivium verify` | 通过（run `20261005T101225Z`：typecheck、build、test 三条，324s）；期间临时目录新建 1（`trivium-index-`），除它外为 0 | `.reviews/目标回退取计划定稿/verify/`、`count-new-verify.txt` |

## 5. 边界

1. **跨禁读集的那一行**：计划与代码阶段执笔方不同时，计划定稿对后缀不是本侧的各侧是禁读、从必读清单剔除，但第 4 段的任务目标行各侧共用，照样带上它的首个标题/首段（≤200 字）。它是计划执笔方的标题、不是审查员的意见；执笔方相同的主题本就如此（计划双审三侧认可）。
2. **首段可能不是标题**：`goalFromPlanDoc` 取首个非空行；修订稿若不以标题开头，目标会是首段那句话。既有行为，未改。
3. **bug 阶段现算那次只取目标**：不进 bug 阶段必读清单、不出告警；bug 阶段要不要必读计划定稿仍是 EV-211。
4. **历史不追溯**：已冻结的任务书与任务文件不动；改动只影响此后第三级真正走到的运行（多见于命令 B、C、D 单独发起、从未带过 `--goal` 的主题）。
5. **生效时点**：`src/` 与技能产物已改，要用户重装后才对真实流水线生效（`.trivium/bin` 指向全局安装副本）。
