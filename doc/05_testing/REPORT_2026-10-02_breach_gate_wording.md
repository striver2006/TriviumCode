# 收工闸门文案区分只读失守 · 实施报告（EV-98 文案部分）

> - **日期**：2026-10-02
> - **主题**：`收工闸门文案区分只读失守`（命令 A `/dual-run`，Driver claude）
> - **起点**：`364ef0f`（`main`，工作树干净）
> - **计划**：`.reviews/收工闸门文案区分只读失守/plan/` r2（计划双审第 1 轮 run `20261002T143500Z`，16 条全接受；实施期在 r2 §7 追加一条更正）
> - **证据目录**：`doc/05_testing/evidence/breach-gate-wording-20261002/`
> - **配额**：验证全程零配额（桩审查员）；真实审查运行只有本主题的计划双审与代码双审

## 1. 问题

只读失守时 `gate --check` 必败（`readonly_breach` failure），闸门停在 `review_done_awaiting_disposition`；`hook-stop` 与 `hook-pre-commit` 只看闸门状态，一律报「还有未逐条裁决的审查意见」，把 Driver 引向补裁决件——而补多少都解不开。EV-79 代码双审 r2 就这样卡死：22 条裁决齐备、闸门解不开，最终由用户 abandon。

## 2. 改了什么

- `hooks.ts`：两处 Hook 在拦截与计数定好之后，把待裁决闸门按「该闸门那一轮的运行留痕是否记录了只读失守」拆成两组（按闸门项 `run_id` 用 `readRunMeta` 直读，读不出静默）。失守组非空时：
  - 失守首句「本轮审查记录到只读失守……这道闸门靠补裁决件解不开」；
  - 逐项段：调用记录（至多 8 条）、快照漂移的实际取值（未检出 / 检出 K 个文件 / 比对未完成）、按该轮 `driver` 取写法的作废命令（每项一条）；
  - 共用处置段：`gate.ts` 的 `READONLY_BREACH_TRIAGE`（与 `gate --check` 同一来源）+「裁决件未落盘时 gate --check 先报缺件」+「重跑也须先作废」；
  - 与未裁决阶段并存时两段都出，`hook-stop` 的 `stderr` 两个真因都在，`hook-pre-commit` 的关闭方式恒为最后一行；阻断上限放行同样两类都点名。
- `gate.ts`：`readonly_breach` 的处置句抽成导出常量 `READONLY_BREACH_TRIAGE` 与 `breachRecordsText`，`gate --check` 输出逐字节不变。
- 拦截、阻断计数、退出码、判据、闸门状态机一概不变；未见失守（含读不出、闸门项无 `run_id`、失守的不是这一轮）时文案与改前逐字相同。

**实施期更正（计划 r2 §7）**：计划与决策原话把出口写成「作废这一轮，或重跑审查」。编码写集成用例时核实：待裁决时 `review --start` 拒绝重跑（`review.ts` 的比较-交换），失守轮 `gate --check` 必败——**唯一出口是作废这一轮**，重跑须先作废。文案按此写，并由集成用例实跑「不作废重跑 ⇒ 退 2」锁住。

## 3. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 单测（`hooks.test.ts` U1～U16 + U4b / U8b / U10b，`gate.test.ts` U15） | 19 条新增全绿（U4b 与 U12 第三格为代码双审后补） | — |
| 集成（`gate-loop.test.ts` 两条：齐裁决件失守格、未写裁决件失守格） | 全绿，均实际执行（未跳过） | — |
| 变异预跑（逐条带超时） | 第一批 18/18、代码双审后第二批 20/20 咬住 | `mutation-names-log.r1.txt` / `mutation-names-log.txt` 及同名 `output` |
| 变异装置（`scripts/mutation-check.mjs`） | 第一批 18/18、第二批 20/20 咬住，基线三套件全绿 | `mutation-spec.r1.json` / `mutation-spec.json`、`mutation-output.r1.txt` / `mutation-output.txt` |
| 改前改后对照（`364ef0f` vs 工作树） | 两次各 15/15（代码双审前后各一次） | `acceptance.mjs`、`acceptance-output.r1.txt` / `acceptance-output.txt`、`acceptance-readout*.json` |
| 全量检查（串行） | 见 §3.1 | `check-1.txt`、`check-2.txt`、`check-3.txt` |
| doctor 自检 | 见 §3.1 | `doctor-selftest.txt`、`doctor-selftest.r2.txt` |

对照两格：**失守格**旧构建两个 Hook 说「未逐条裁决」、新构建说「只读失守」并列调用记录与作废出口，两份构建 `gate --check` 的 `readonly_breach` message 归一化后逐字相同、退出码都拦；**未裁决格**两个 Hook 的退出码、stdout、stderr 归一化后逐字相同，且确为拦截态。

### 3.1 全量与自检

- `npm run check` **两次串行：2597 / 2595 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同（`check-1.txt`、`check-2.txt`）。每次发起前确认无残留测试进程、输出直接落文件、取真实退出码（均为 0）。
- `doctor --selftest`（工作树新构建）：**14/14**（`doctor-selftest.txt`）。
- 起点 `364ef0f` 之前上一主题的读数为 2577 / 2575 / 0 / 2；上面两次是代码双审之前，本题净增 20 例（单测 18、集成 2），跳过数不变。
- 代码双审后按接受项改码（CODEX-02、GLM-01，新增 U4b）并同步文档，再串行跑一次全量与自检：见 `check-3.txt`、`doctor-selftest.r2.txt`（读数：**2598 / 2596 / 0 / 2**，比前两次多 U4b 一例；自检 **14/14**）。本行读数是全量跑完后填入的——只改了这一行文字，索引条目与文件集未动。

### 3.2 代码双审

run `20261002T152411Z`：gemini `approve`（零意见）、codex / glm `approve-with-nits`，4 条——接受 3（缺 `run_id` 键与 null 同按无留痕 + U4b；漂移文件截断补用例 + 对偶变异 M19；主题名不加引号登记 EV-195）、驳回 1（失守项不封顶：一项对应一个待裁决槽位）。应答件 `.reviews/收工闸门文案区分只读失守/code/…-response-claude.md`。

## 4. 已知边界

- **轮次来源不同源**：闸门那一轮的 run.json 读不出、更旧一轮记着失守时，Hook 出原文案，不带 `--run-id` 的 `gate --check` 退回更旧一轮报失守。留痕坏了才可达，Hook 若改扫更旧一份会重新引入 stderr 告警并把上一轮的失守说成这一轮的；不改，U14 锁现行为。
- **同族未改的三处**：会话开始 Hook 的待办句；`gate.ts` 处置句「确有则清理后重跑审查」未说须先作废（决策不改 gate 输出，Hook 侧已补那一行）；`review.ts` 重跑拒绝文案给的「补齐裁决件并通过 gate --check 后再来」对失守轮走不通。都记在 BACKLOG EV-98。
- **真实会话自证**：本仓会话的 Hook 走已安装副本，新文案要等提交后用户重装才出现；复核安装副本一致时在安装副本上补跑一次 §3 对照两格。
- **作废命令里的主题名不加引号**（代码双审 CODEX-01）：与仓里既有四处建议命令同式；`validateTopic` 实为黑名单，含 shell 元字符的主题名合法。根治在收紧校验，跨模块、超出本题，登记 EV-195。
- **判据部分**（解释器内联脚本误报）不在本题，EV-98 判据部分仍 todo、等再次失守。
