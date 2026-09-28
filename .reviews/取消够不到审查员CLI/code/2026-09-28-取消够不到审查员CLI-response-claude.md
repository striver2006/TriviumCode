---
schema: trivium.disposition.v1
topic: 取消够不到审查员CLI
stage: code
role: claude
kind: response
run_id: 20260927T230542Z
addresses:
  - 2026-09-28-取消够不到审查员CLI-codex.md
  - 2026-09-28-取消够不到审查员CLI-gemini.md
  - 2026-09-28-取消够不到审查员CLI-glm.md
---

# 应答：取消够不到审查员CLI · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260927T230542Z.diff`（相对 HEAD `8267ffa` 的 29 个文件变更，255.8 KB）
> ｜ 运行：`20260927T230542Z`（约 17 分 39 秒）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve`（零意见）｜ glm `approve-with-nits`
> ｜ 共 9 条（次要 4、吹毛求疵 5），**全部接受**；同指两组：CODEX-01 ≡ GLM-02（「组长已退出后该组整组收不到信号」被说窄成「只有忽略 SIGTERM 的组员会漏」）；CODEX-05 ≡ GLM-03（墙钟上界余量偏紧）
> ｜ 不改修法、不改时间预算的数值；行为代码只动一处常量命名（CODEX-06）

## 0. 核实记录

逐条对照工作树源码核过：

- **CODEX-01 ≡ GLM-02**：成立。`run()` 在组长 `'exit'` 时就把它从 `liveTrees` 删掉（`util/exec.ts` :150-152），`shutdownTrackedTrees` 只从 `liveTrees` 里取仍未退出的条目（:578-581）。所以只要组长先退出——不论是处理器运行之前自己正常退出，还是被首个 SIGTERM 结束——这一组就不在遍历面上，同组遗留的后代一个信号都收不到，与它们响不响应 SIGTERM 无关。原文把残留面说窄了：exec.ts 文档块写「只有忽略 SIGTERM 的组员会漏」，设计 7.5、LLD、EV-154 写「组长 CLI 已退出而同组有忽略 SIGTERM 的后代」。`exec.ts` :228-233 已经承认「孙进程拖住管道不闭合」是真实形状。另外，EV-154 候选里的「CLI 退出时清空」会漏掉同一格（CODEX-01 建议）。
- **GLM-01**：成立。MANUAL 已知缺口段末句「自 v1.0.10 起只剩上面两种情形」说过头：组长先退出后遗留的后代（上一条）、CLI 自己 `setsid` 出去的后代，这两格里 worker 都在宽限内正常退出，`--cancel` 不打任何提示。转发行只写进 `worker.log`，用户终端看不到。
- **CODEX-02**：成立。`treeShutdown` 是模块级的单向门，唯一的防线是测试文件里的一句注释；EV-155 又计划让前台入口复用这个函数。今天唯一的生产调用点是处理器（`run-protocol.ts` 里 `installWorkerSigtermForwarding`），它随后必然自杀，所以没有现存缺陷，缺的是契约写在显眼处。
- **CODEX-03**：成立。EV-154 的候选写「`run()` 新增 `onSpawn` 回调，经 `AdapterContext` 穿到四个适配器」，没有说明它与本补丁落地的 `liveTrees` 是什么关系。
- **CODEX-04**：成立。按 `ps` 找标记、取组号、数成员这套解析在 `gate-loop.test.ts`、`run-protocol.test.ts`、`worker-detach.test.ts` 与 `acceptance.mjs` 里各有一份，字段集已经分叉。其中 `worker-detach.test.ts` 那份在场景子进程的脚本串里，必须自包含。
- **CODEX-05 ≡ GLM-03**：成立。I2 的读数约 3.6 s、上界 4.5 s；U7⑥ 的读数约 1.55 s、上界 2.5 s；两者余量都不到 1 s。U9② 的读数约 2.1 s，余量 2.4 s。
  - I2 的主判据是因果的（stderr 不含「未响应 SIGTERM」），M5 也是靠这一条咬住的（mutation-names：M5 首行文案就是那两条 stderr 断言），计时那条不承担任何变异的咬合。
  - U7⑥ 的计时是 M10 唯一的咬合点，不能删，只能拉开并行与串行的差距。
  - U9② 的计时是 M7 的咬合点之一（读数 5058 ms），余量足够，不动。
- **CODEX-06**：成立。`settleOrphanedStart` 那一行，`graceMs` 用的是具名常量 `WORKER_TERM_GRACE_MS`，`killWaitMs` 还是字面量 5000；两者数值相同、语义无关。`cancelRun` 的 `killWaitMs: 0` 是刻意的，但没有一句说明。设计 7.5 `--start` 行写的「约 20 s 上界」就是靠这个值撑的。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立（≡ GLM-02）：组长一退出，该组就从登记里删掉、整组收不到信号，与后代是否忽略 SIGTERM 无关；原措辞把一整格写成了半格。EV-154 的候选同样会漏这一格 | `util/exec.ts` `shutdownTrackedTrees` 文档块那一条改为「组长已退出（含处理器运行前已正常退出）⇒ 该组不在遍历面上，同组遗留的后代一律收不到信号」；设计 7.5「工作进程的信号语义」的覆盖不到的格、LLD 已知缺口与 worker 主体、BACKLOG EV-152 去向与 EV-154 同步改准；EV-154 待论证清单补「组长退出后仍要保留组号或按组里还有活成员判，否则同样漏这一格」；报告 §3.2 h 格改准 |
| CODEX-02 | codex | minor | 接受 | 核实成立：今天唯一调用点随后必自杀，没有现存缺陷，但单向门的契约只写在测试注释里，EV-155 要复用它。取建议②：把契约写成文档块首句，不加测试用的复位口——复位口只为测试开，会给生产代码多一个能把冻结撤掉的入口，反而削弱「终止中不再推进」这条保证 | `util/exec.ts` `shutdownTrackedTrees` 文档块首句改为契约：「调用即本进程进入终止中（不可撤销）：此后 `run()` 不再派生、已在跑的不再兑现；调用方必须随后结束本进程」；`treeShutdown` 注释同步；BACKLOG EV-155 候选补「复用它的前台入口必须随后退出，否则带着悬空 Promise 活着」 |
| CODEX-03 | codex | nit | 接受 | 核实成立：EV-154 的候选没说明与 `liveTrees` 的关系，接手者可能再建一份同职登记 | BACKLOG EV-154 候选段补：本进程内的登记面唯一来源是 `liveTrees`，跨进程可见只需在派生 / 退出时把它的条目（加侧归属与启动时刻）落进 status.json；若仍要走 `onSpawn`，要说明为什么不能由 `liveTrees` 派生（例如侧归属只有适配器知道） |
| CODEX-04 | codex | nit | 接受 | 核实成立：判组空是本次全部用例与验收的承重判据，四份副本已开始分叉 | 新增 `test/helpers/proc.ts`（`groupsWithMark` / `groupMemberCount`），`gate-loop.test.ts` 与 `run-protocol.test.ts` 改用它，`worker-detach.test.ts` 的外层清理也改用它；`worker-detach.test.ts` 场景子进程脚本串里那份必须自包含，保留并注明与 helper 同源；`acceptance.mjs` 保留自包含副本，文件头注明同源、字段集以 helper 为准 |
| CODEX-05 | codex | minor | 接受 | 核实成立（≡ GLM-03）。分三处处理：I2 的计时不承担任何变异的咬合，放宽；U7⑥ 的计时是 M10 唯一的咬合点，改参数拉开并行与串行的差距，并在失败文案里写出预期值；U9② 余量 2.4 s，不动 | I2：计时上界改为 `WORKER_TERM_GRACE_MS + 2000`，注释写明主判据是 stderr 的因果断言，计时只防挂住；U7⑥：`graceMs` 1500 → 2000，上界改为 `graceMs + killWaitMs + 1000`（3.5 s；并行约 2.05 s、串行约 4.1 s），失败文案写明两者的预期值与「超界先按 EV-149 口径存读数」；变异 M10 重跑确认仍咬住；报告 §3.1 与 §7 记 |
| CODEX-06 | codex | nit | 接受 | 核实成立：两个同为 5000 的量一个具名一个具值，容易被读成同一个旋钮 | `run-protocol.ts` 新增常量 `ORPHAN_KILL_CONFIRM_MS = 5000`（派生后失败收尾里 SIGKILL 之后的确认窗口），`settleOrphanedStart` 改用它；`cancelRun` 的 `killWaitMs: 0` 旁补一行注释，说明刻意不等（原行为，EV-150 起一直如此）；设计 7.5 `--start` 行「约 20 s」对上两个常量名 |
| GLM-01 | glm | minor | 接受 | 核实成立：「只剩上面两种情形」说过头，另有两格不会打任何提示，而这段手册恰是告诉用户何时该手工清理的地方 | MANUAL 已知缺口段末句改为：「会打提示的是上面两种情形；另有两种较窄的形态不会打提示（CLI 进程先于 worker 退出后遗留的子进程、CLI 自己脱离进程组的后代）。取消后想确信没有残留，用 `ps` 查 ppid 为 1 的 CLI 进程」；PROTOCOL `--cancel` 段同族措辞核对后同步 |
| GLM-02 | glm | nit | 接受 | 核实成立（≡ CODEX-01） | 同 CODEX-01 |
| GLM-03 | glm | nit | 接受 | 核实成立（≡ CODEX-05）：I2 的因果判据已足够，计时只是弱冗余 | 同 CODEX-05 |

## 2. 修改方案（审批后执行）

1. **代码**：
   - `util/exec.ts`：`shutdownTrackedTrees` 文档块首句写契约（CODEX-02），h 格那一条改准（CODEX-01 ≡ GLM-02）；`treeShutdown` 注释同步。
   - `run-protocol.ts`：新增 `ORPHAN_KILL_CONFIRM_MS`，`settleOrphanedStart` 改用；`cancelRun` 的 `killWaitMs: 0` 补注释（CODEX-06）。
2. **用例**：
   - 新增 `test/helpers/proc.ts`，三个集成测试的外层按组判定与清理改用它（CODEX-04）；
   - I2 计时上界放宽（CODEX-05 ≡ GLM-03）；U7⑥ 参数与上界调整，失败文案写明并行 / 串行的预期值。
3. **文档**：设计 7.5（信号语义段的 h 格、`--start` 行常量名）、LLD（worker 主体与已知缺口）、MANUAL（已知缺口段末句）、PROTOCOL（`--cancel` 段核对）、BACKLOG（EV-152 去向、EV-154 候选与待论证清单、EV-155 候选）同步改准。
4. **读数**：修订后重跑全量两次（文档改前、改后）、源码变异（按修订后代码重生成规格；M10 因 U7⑥ 参数变了必须重跑确认；原规格与读数留 `.r0`）、失败用例名核对、零配额验收、`doctor --selftest`。读数写进报告新增的 §7「代码双审 r1 与修订」。
5. **不改**：修法 ①；`WORKER_TREE_GRACE_MS` / `WORKER_TREE_KILL_WAIT_MS` / `WORKER_TERM_GRACE_MS` 的数值；不给冻结加测试复位口（理由见 CODEX-02）；skill 与入口资产。
