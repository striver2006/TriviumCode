# 测试报告 · 审批正本读不出拒写（EV-248）

- 日期：2026-10-22
- 主题：`审批正本读不出拒写`（`/dual-run`，A 档）
- 计划：`.reviews/审批正本读不出拒写/plan/2026-10-22-审批正本读不出拒写-r2-claude.md`（计划双审 run `20261022T041612Z`，第 1/5 轮，gemini / glm 均 `pass-after-changes`，8 条全接受）
- 主设计：v1.3.171（6.7 末段、12.6）；BACKLOG EV-248；PROTOCOL §五
- 证据：[`evidence/task-unreadable-refusal-20261022/`](./evidence/task-unreadable-refusal-20261022/)

## 一、改了什么

| 面 | 改动 |
| :--- | :--- |
| 写入口 | `updateTask` / `updateTaskAsync` 锁内改严格读：读不出抛退 2 的受控错误、不调回调、正本原样；不存在照旧起写 |
| 严格读 | `readTaskStrict` 加形状判据：非对象、`schema` 不是 `trivium.task.v1`、`runs` / `approvals` / `degradations` / `disputes` 任一缺失或不是数组 ⇒ 读不出，`error` 点名哪一项 |
| `gate --check` | 结果输出之前判；读不出时 `failures` 加 `task_unreadable`、只输出一次、退 2，不写共同阻断三态与争议标记、不推进闸门、不归零阻断计数 |
| `gate --await-approval` | 读不出改 `ok: false`、退 2（此前 `ok: true` 退 0） |
| `approve` / `abandon` | 复核之前判一次；`recordApproval` 写闸门之前再判；闸门已写下决定之后正本才坏，比较-交换回退闸门 |
| `verify` | 分配 run_id 与执行命令之前判；跑完才在登记时被拒，记录保留、文案写明命令结论、退 2 |
| `review` 准备阶段 | 轮次链判定之后、分配 run_id 之前判，零工件（覆盖骨架登记、任务目标、纯文档跳过收尾） |
| 出口文案 | `taskUnreadableExit` 写入口、续链判定、`taskUnreadableHold` 三处共用：绝对路径、Git 找回命令、「恢复由用户在终端执行」 |
| skill | 认领、`gate --check`、停点、S10、审批 / 放弃补退 2 的处置句；重渲染四家入口 |

## 二、用例

**单测 `test/unit/meta-task-write.test.ts`（25 条）**：U1 七种读不出形态（截断 JSON、`null`、数组、数字、`{}`、`approvals` 为对象 × 两个写入口；目录；权限 000）断言退 2、不调回调、字节不变，形状五种另断言 `error` 点名；U2 不存在 ⇒ 首次写入完整；U3 可读 ⇒ 字段保留；U4 三处共用出口段；U5 `recordApproval` 先判（不经补偿）、补偿回退、闸门被接管时不回退。

**集成 `test/integration/task-unreadable-refusal.test.ts`（14 条，真实打包 CLI + 桩）**：I14（代码双审 GLM-01 补）`verify` 的 build 命令自己把正本写坏——开跑前判得过、登记时才坏，断言退 2、文案写明「编译测试已执行完（结论：全部命令通过）」与记录路径、验证记录与两份 `_meta` 保留、正本是命令写下的坏件；I1～I3 `gate --check`（B 已审批 / A 未表态 / 争议标记），I4～I5 审批、拒绝、无 `--stage` 放弃，I6 `topic claim`（正本是目录），I7 `verify`（命令未执行、无记录），I8～I9 `review --start` 新阶段第一轮与纯文档跳过（零工件），I10 新主题首次写入照常，I11 worker 收尾时才坏（运行失败、文案点名、闸门回收、坏件不被覆盖），I12 `--await-approval`，I13 `{}` 形状。

**既有用例调整**：`review-loop` L10 补 `--await-approval` 退 2 与 `--check` 不写的断言、删去过期注释；`run-id-alloc` 的 `register` 夹具补成完整形态（只有 `topic` + `runs` 的写法按新判据读不出）；`topic-arg-quoting` 登记表 approval.ts 2 → 4（补偿文案的两处 `--topic`）。

## 三、变异验证

规格 [`mutation-spec.json`](./evidence/task-unreadable-refusal-20261022/mutation-spec.json)，代码双审前 14 条，代码双审 GLM-01 后补 M12 共 15 条。

- **逐条预跑**（`--with-tests` 变体，集成类变异重打 bundle）：12 条首跑即按预期变红；M10、M11b 两条首跑超过脚本 900 秒上限（1599 s / 939 s），并连带出现与变异无关的 I2 红——期间机器负载异常或挂起，读数作废；单独重跑两条各 27 s、28 s，只红在 I12、I13。读数见 `mutation-names-output.json`（首跑）与 `mutation-names-rerun-output.json`（重跑）。
- **正式装置** `scripts/mutation-check.mjs`：工作树干净、基线全绿，**14/14 咬住**，恢复逐字节一致，见 `mutation-output.txt`。

| # | 变异 | 期望套件 | 失败数 |
| :-- | :-- | :-- | :-- |
| M1 | 写入口改回宽松读 | 单测 | 16 |
| M2 | `--check` 删去输出前判定 | 集成 | 1（I1） |
| M3a | `cmdApproval` 删去先判 | 集成 | 1（I4：先看到工作树摘要再被拒） |
| M3b | `recordApproval` 删去先判 | 单测 | 1（U5：靠补偿兜回，文案带「回退」） |
| M4 | 删去补偿 | 单测 | 1 |
| M5 | `review` 准备段删去先判 | 集成 | 2（I8、I9） |
| M6 | `verify` 删去先判 | 集成 | 1（I7） |
| M7 / M7b | 不存在也判读不出 | 单测 / 集成 | 3 / 9 |
| M8 | 拒写退出码改 1 | 单测 | 18 |
| M9 | `--check` 读不出退 0 | 集成 | 4 |
| M10 | `--await-approval` 读不出退 0 | 集成 | 1（I12） |
| M11 / M11b | 删去形状判据 | 单测 / 集成 | 15 / 1（I13） |
| M12 | `verify` 删去登记被拒时的文案改写 | 集成 | 1（I14；预跑 `mutation-names-m12-output.json`） |

M12 补入后正式装置按 15 条完整规格重跑一遍，见 `mutation-output.r2.txt`（读数见第七节）。

M3a / M3b 是双重先判，各自只有一条用例能区分：删掉外层，内层仍拦，区别只在「是否先打印了工作树摘要」；删掉内层，补偿仍会把闸门回退，区别只在错误文案里有没有「回退」。两条鉴别断言是为此补的。

## 四、全量

`npm run check`（前台、一次一条），读数见第七节。

## 五、代码双审与对计划的偏差

代码双审 run `20261022T081726Z`（评审循环第 1/5 轮）：gemini `pass` 零意见，glm `pass` 2 条，计票「通过」，两条都接受：

- **GLM-01**：`verify` 登记时才被拒的那一支没有用例与变异 ⇒ 补 I14 与 M12。
- **GLM-02**：`gate --check` 读不出时，计划 r2 §三.1 第 3 步写的是「失败项放出口段首两句、另 `warn` 打一次完整出口段」，实现改为**完整出口段整段进失败项、不另打 `warn`**——只输出一份，JSON 里机读可见；另打一遍就是双份输出。这是有意简化，`cli.ts` 该处注释已写明，后续不要照计划把 `warn` 加回去。连带 PROTOCOL §五 原写「stderr 点名正本路径」，对 `gate --check`（stdout 的 `failures`）与 `--await-approval --json`（stdout 的 `message`）不成立，已改。

## 六、残余

- worker 运行中正本被搅坏：留下「run.json 终态、正本未登记」，恢复正本后不会补登记，靠 `hook-pre-commit` 锚 ② 在提交时拦。未开题。
- 每个调用方「先判」与写入口锁内读之间仍有竞态窗口；写入口兜住「不覆盖」，窗口只影响拒写之前已做的几步，收尾方式见计划 r2 §三。

## 七、全量读数

| 遍 | 时间 | 用例 / 通过 / 失败 / 跳过 | 说明 |
| :-- | :-- | :-- | :-- |
| 1 | 12:46～12:51 | 3821 / 3818 / 1 / 2 | 红在 `topic-arg-quoting` Q6 源码护栏：补偿文案新增两处 `--topic ${shellQuoteArg(…)}`，登记表未同步；补登记后单跑 6/6 |
| 2 | 16:05～16:11 | 3821 / 3819 / 0 / 2 | 补鉴别断言、变异、文档之后 |
| 3 | 16:11～16:17 | 3821 / 3819 / 0 / 2 | 报告补读数之后再跑一遍（测试会读 `doc/`） |
| — | 代码双审后 | — | 正式变异装置 15 条（含 M12）：工作树干净、基线全绿，15/15 咬住（M7b 此次 fail=10，多出的一格是新增的 I14） |
| 4 | S10 `verify`（run `20261022T085009Z`） | 3822 / 3820 / 0 / 2 | 代码双审改码与文档同步之后的收口全量（多出的一条是 I14）；typecheck、build 均过 |
