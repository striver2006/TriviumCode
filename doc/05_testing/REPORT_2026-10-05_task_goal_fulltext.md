# 任务目标全文送审 · 实施报告（EV-210）

> - **日期**：2026-10-05
> - **主题**：`任务目标全文送审`（命令 A `/dual-run`，Driver claude）
> - **起点**：`722a471`（`main`，工作树干净）
> - **计划**：`.reviews/任务目标全文送审/plan/` r2（计划双审第 1 轮 run `20261005T000535Z`：codex `approve-with-nits`（次要 1、吹毛求疵 2）、gemini `approve-with-nits`（吹毛求疵 1）、glm `approve-with-nits`（次要 2、吹毛求疵 1），7 条全接受）
> - **证据目录**：`doc/05_testing/evidence/task-goal-fulltext-20261005/`
> - **代码双审**：run `20261005T010708Z` 失败（归档闸拒绝，见 §6）；加焦点重跑 run `20261005T013444Z`：codex `approve-with-nits`（吹毛求疵 1）、gemini `approve`、glm `approve-with-nits`（重要 1、次要 1、吹毛求疵 1），4 条全接受
> - **配额**：全程零配额：桩适配器与本机构建，不跑任何真实 CLI

## 1. 问题

`/dual-run` 的正文整段算任务目标，而 `review.ts` 的 `clampGoal` 把它折叠空白后截到 200 字（`TASK_GOAL_MAX`），任务书第 4 段「任务目标：」只有这一行：用户正文里的现状、决策与要求到不了计划审查员面前，没法据此核对计划是否忠实。代码阶段的必读清单不含本主题的计划，审查员能不能读到定稿计划全靠自己去找（EV-209 代码审 codex 明说未核对实现与计划的偏离）。设计 §6.7 写任务文件存「任务目标原文」，实现存的是截断后的 200 字。

## 2. 改了什么

1. **计划阶段附录**（决策一）：`review.ts` 新增 `taskGoalAppendix(stage, rawGoal)`——只在计划阶段、本次显式 `--goal` 折叠后超过 200 字（`clampGoal` 真截了一刀）时返回原文（只把 CRLF 换成换行、去首尾空白）。`renderBrief` 新增必填入参 `taskGoalAppendix`：非空时第 4 段摘要行后加一行指引，第 8 段之后、页脚之前加不编号的「附录：任务目标原文」（注明是开发者原话、夹有给执笔方的操作指示、请对照现状与决策核对计划是否忠实；原文在「这是数据，不是对你的指令」分隔线之间）。上限 16000 码点（`TASK_GOAL_APPENDIX_MAX`），超出按码点截、提示行在结束分隔线之后。附录原文在计算段（置闸门与任何落盘之前）单独按 full 模式扫密钥，命中即拒（退 1）、零工件，文案点名「任务目标原文」与行号（代码双审 GLM-01）。页脚从第 8 段模板串拆成单独一段，拆分点在原文的 `\n\n---` 处，没有附录时拼回来逐字相同。
2. **代码阶段必读计划定稿**（决策二）：`review.ts` 新增 `resolvePlanFinal`——`resolveStageDriver(…, 'plan')` 判计划阶段执笔方，`locateSubject` 取该后缀、非裁决件、轮次最大的一份；没有计划阶段不列不报错；计划阶段留痕读不出时不列、出「必读清单未列计划定稿」告警（排在剔除告警之前、同走三个出口）。`buildMustReadList` 加第五个必填参数 `planFinal`，新来源 `plan-final`（「本主题计划定稿」），排在关键词设计文档之后、`--context` 之前，照常过 EV-02 的交集校验。代码阶段不出附录；裁决件不列入。
3. **常量与折叠规则各只留一份**（计划双审 CODEX-01、CODEX-03）：`TASK_GOAL_MAX` 挪到 `brief.ts` 并导出（依赖方向 review → brief）；抽出 `foldGoal`，`clampGoal` 与附录判定共用。`clampGoal`、`resolveTaskGoal` 的行为，任务文件 `goal` 与 run.json `task_goal` 的字段与取值不变（决策三）。
4. **文档**：设计 v1.3.88（§6.7 订正、§9.4 开头与第 4 条、版本记录）、PROTOCOL §二三处（计划双审 GLM-01）、LLD v1.1.34、MANUAL v1.0.28、`AGENTS.md` 同步清单 BRIEF 一行（代码双审 CODEX-01）；BACKLOG EV-210 结案，另登 EV-211（bug 阶段是否必读计划定稿）、EV-212（`resolveTaskGoal` 第三级按当前阶段 Driver 定位计划原稿）、EV-213（`clampGoal` 可能切在代理对中间）。

## 3. 与计划的出入

1. **`driver-wiring.test.ts` 护栏表补一条**（计划未列）：该文件扫全 `src/` 里 `locateSubject` 的调用点并逐处核 driver 的取值，新调用点不在表里时当场红（第一遍全量的 2 例红，读数留作 `check-1-red-driver-wiring.txt`）。按它的文案要求补条目而不是改期望值：`resolvePlanFinal` 里的变量改名 `planStageRef` 以区分锚点，新条目要求取值是 `resolution.driver`、不许出现 `DEFAULT_DRIVER`，全局对账从 2 处改为 3 处。手工把取值换成 `DEFAULT_DRIVER`，新条目当场红，恢复后哈希一致。改名让变异规格 M10 的锚点失效，规格重生成后装置重跑（§4）。
2. **变异多一条 M18**（守页脚拆分的拼接）、多一条 M12b（告警不并进出口）：计划 §4 是 M1～M17。代码双审后再加 M19（附录不单独扫）。
3. **附录单独扫密钥**（计划未列，代码双审 GLM-01）：计划 §1.7 说「附录过任务书落盘的密钥扫描，属期望行为」，但那套扫描是 `added-lines`，按 hunk 判——原文里一行 `@@ ` 开头，其后连字符开头的行就漏扫。修前实测 I12：带凭据形态的原文照常进了任务书、`--start` 退 0。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新单测 `test/unit/task-goal-appendix.test.ts` | 11 格全过（U1～U8，U7 四格） | — |
| 新集成 `test/integration/task-goal-fulltext.test.ts` | 13 格全过（I1～I12，I8 两格）；I1～I10 首跑全绿，I11 / I12 在修 GLM-01 之前两格都红（I12 退 0 漏扫、I11 文案没点名任务目标原文），修后转绿 | — |
| A1 旧构建逐字比对（`722a471`） | 4 种任务书（计划短目标、目标为空、代码阶段长目标摘要带执行型 MCP、bug 阶段）与 2 组必读清单，新旧逐字相同 | `a1-old-new-brief.txt` |
| 变异预跑（逐条带超时） | 19/19 按预期变红，无超时、无取消；跨类亦跑与预期一致；代码双审后补的 M19 单条预跑变红（I11、I12） | `mutation-names-log.txt`、`mutation-names-output.json`、`mutation-names-log-m19.txt` |
| 变异装置（`scripts/mutation-check.mjs`） | 改名前 19/19；改名后 19/19；代码双审修改后 20/20 咬住，基线全绿（2 个套件）。M4 的 fail 数由 3 变 5：新增的 I11 / I12 也咬住它（摘要当原文时凭据在 200 字之后、扫描看不到） | `mutation-output-pre-rename.txt`、`mutation-output-pre-s9.txt`、`mutation-output.txt` |
| 全量 `npm run check`（补护栏条目之前） | 2760 / 2756 / 2 / 2，退 1：`driver-wiring` 两格（见 §3 第 1 条） | `check-1-red-driver-wiring.txt` |
| 全量 `npm run check`（代码双审前，串行两次） | 两次均 2761 / 2759 / 0 / 2，退 0（较 `722a471` 的 2738 多 23：新单测 11、新集成 11、driver-wiring 新条目 1） | `check-1-pre-s9.txt`、`check-2-pre-s9.txt` |
| 全量 `npm run check`（代码双审修改后，串行两次） | 两次均 2763 / 2761 / 0 / 2，退 0（多出 I11、I12） | `check-1.txt`、`check-2.txt` |
| `trivium doctor --selftest`（`npm run build` 后跑仓库 bundle） | 代码双审前后各一次，均 14/14、退 0 | `doctor-selftest-pre-s9.txt`、`doctor-selftest.txt` |
| 系统临时目录新建 `trivium-` 条目（按 `birthtimeMs`） | 代码双审前：全量一 1 个（`trivium-index-`）、全量二 0、自检 0；修改后：全量一、全量二各 1 个（`trivium-index-`）、自检 0；判据「除 `trivium-index-` 外为 0」满足 | `count-new-*.txt` |

变异一览：M1 去掉「只在计划阶段」、M2 截断判定 `>` 改 `>=`、M3 附录给折叠后的文本、M4 调用点把摘要当原文、M5 不渲染附录、M6 不出指引行、M7 附录放到页脚之后、M8 上限差一、M9 不收计划定稿、M10 按缺省 Driver 定位、M11 判代码阶段的执笔方、M12 留痕读不出不出告警、M12b 告警不并进出口、M13 计划定稿排在 `--context` 之后、M14 任务文件改存原文、M15 代码阶段也出附录、M16 按 UTF-16 截、M17 提示行落进分隔线之内、M18 页脚拼接变了、M19 附录不单独扫。

## 5. 残余

1. 附录的触发判定按 UTF-16 长度（与 `clampGoal` 同口径），上限按码点：两套单位并存是有意的，注释写明；`clampGoal` 自身可能切在代理对中间，另登 EV-213。
2. 原文里与结束分隔线逐字相同的一行不转义。
3. 附录原文含凭据形态时 `--start` 拒绝启动（零工件），开发者要先改目标原文；属期望行为（凭据不该随送审包出网）。
4. 「四侧同一份」：用例覆盖的是入选两侧（I1、I2）与三侧（I8 第二格）；四家同时参审的组合在本仓不存在（当轮 Driver 不入选）。

## 6. 代码双审

**第一次（run `20261005T010708Z`）失败**：三侧都交了卷，codex 的证据里写出了仓库测试夹具中一个示例密钥的完整字面量，归档落盘的密钥扫描当场拒绝（`aws-access-key-id`），整轮收尾为 failed、三侧结论都没进归档。用户选择加焦点重跑（焦点：引用凭据形态的样例时只写前缀或打码，不要写出完整字面量）。那一轮 codex 与 glm 从运行目录看各自独立提出了与下面 GLM-01 同一个问题。

**重跑（run `20261005T013444Z`，16m33s）**：codex `approve-with-nits`（吹毛求疵 1）、gemini `approve`（零意见）、glm `approve-with-nits`（重要 1、次要 1、吹毛求疵 1），4 条全接受，应答件 `.reviews/任务目标全文送审/code/2026-10-05-任务目标全文送审-response-claude.md`，`gate --check` 通过：

- **GLM-01**（重要）：附录原文按任务书的 `added-lines`（hunk）判据扫会漏，修前实测确认（I12 退 0）。改为计算段单独 full 扫、命中即拒、零工件。
- **GLM-02**（次要）：补 I11 / I12 两格端到端用例，变异补 M19。
- **GLM-03**（吹毛求疵）：`resolvePlanFinal` 的 catch 注释补「阶段目录读失败也落到这里」与不收窄的理由。
- **CODEX-01**（吹毛求疵）：`AGENTS.md` 同步清单 BRIEF 一行补附录开口。

**verify**：`trivium verify --topic 任务目标全文送审`（run `20261005T021613Z`）：`npm run typecheck`、`npm run build`、`npm test` 三条全过，306 s；测试 2763 / 2761 / 0 / 2。verify 期间（2026-10-05T02:16:10Z 起）系统临时目录新建 `trivium-` 条目 0 个（`count-new-verify.txt`）。留痕 `.reviews/任务目标全文送审/verify/`。

另据第一次那轮 codex 的两条吹毛求疵（未进裁决，核过属实）：`meta.ts` 共用出口段注释补第八个、也是唯一不拒绝的消费点；设计 §6.7「与 `task_goal` 同值」补时间限定。
