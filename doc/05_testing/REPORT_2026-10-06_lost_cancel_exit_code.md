# 失联取消未确认退 69 · 实施报告（EV-177 ②）

> - **日期**：2026-10-06
> - **主题**：`失联取消未确认退69`（M11 前待办第二批第 2 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`ea39308`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/lost-cancel-exit-code-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定「改」——未确认退出改退 69，与主路径同口径，同步改 EV-146 的用例与 MANUAL / PROTOCOL（BACKLOG EV-177 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/run-protocol.ts` :1771 `cancelLostWorker`（失联后取消那一格，`classifyLostCancel` 判 `alive` 时进入）：结束工作进程后 `gone` 为假（未确认退出，含仍是同一进程、判不了身份、首检即判不了零信号三种）时，stderr 已有「……未能确认退出：归档 run.json、主题任务文件的运行登记与主题锁都不动……可以再跑一次 --cancel」告警，照 D4 按记录结束 CLI，stdout 结论句「运行 X 已被 --wait 判为失联（heartbeat_stale）：未能确认工作进程 N 退出，归档与主题锁未动。」，然后 `return EXIT.OK`。
2. 主路径（同文件 :1977 起，EV-176）：未确认退出 `throw envError(…)`，即 69（`EXIT.ENV`），「这次没做收尾、状态原样、可重试」。两处的差别就是 EV-177 ②。`cli.ts` :499 把 `cancelRun` 的返回值直接作退出码。
3. 写着「退 0」的落点：`run-protocol.ts` :1568、:1696 两段文档块；`test/integration/run-protocol.test.ts` EV-146 K4（两次 `--cancel` 都断言 `EXIT.OK`）；`test/integration/cancel-grace-unverifiable.test.ts` 的 `assertLostUntouched`（L1 / L2 共用，断言 `EXIT.OK`）与 L1 / L2 两个用例名；主设计 7.5「失联后取消挂住的工作进程」段「两种结局都退 0」、v1.3.101 版本行（历史记录，不改）；LLD 4.2 引述块「两格结局都退 0」与已知缺口表「失联后取消与主路径的口径差」行；`PROTOCOL` 「失联后仍挂着的工作进程」段末「退出码仍为 0」；用户手册「心跳过期而工作进程还活着」一条（「未能确认退出」那一句没写退出码）。`skills-src/` 没有依赖 `--cancel` 退出码的地方（已 grep）。

### 修法

1. `cancelLostWorker` 未确认退出那一支 `return EXIT.OK` 改为 `return EXIT.ENV`（69）。stderr 告警与 stdout 结论句**逐字不变**——它们已经说清「归档与主题锁未动、可以再跑一次 --cancel」；只改退出码，不把结论句挪进报错（挪了就是改输出，超出用户定的范围）。
2. 两段文档块、两处用例的断言与用例名、设计 7.5 段、LLD 两处、PROTOCOL、用户手册同步。

### 不改的边界

- 确认退出那一支（`finalizeLostAndReclaimLock` 之后）仍退 0；`gone` 格（`finalizeGoneWorker`）、`mismatch` / `no_identity` 两格（不发信号、如实说明）仍退 0——它们不进 `cancelLostWorker`（不是用户定的「那一格」）。
- 主路径不动；播报文字不动；status.json、归档、锁、闸门的处置不动。

## 1. 改了什么

1. `src/trivium/run-protocol.ts` `cancelLostWorker`：未确认退出那一支 `return EXIT.OK` 改为 `return EXIT.ENV`（69），加一行注释说明同码理由；函数文档块的退出码一段与 `lostWorkerGoneFrom` 文档块里「未确认时的退出码仍与主路径不同」一句同步改写。播报文字零改动。
2. 用例：`test/integration/run-protocol.test.ts` EV-146 K4 两次 `--cancel` 的断言改 `EXIT.ENV`、用例名补「退 69」；`test/integration/cancel-grace-unverifiable.test.ts` `assertLostUntouched`（L1 / L2 共用）断言改 `EXIT.ENV`、注释与两个用例名改「退 69」。确认退出的 K3 等用例仍断言 `EXIT.OK`、未动。
3. 文档：主设计 v1.3.105（7.5「失联后取消挂住的工作进程」段退出码一句、「入口之后才判不了」段那一句）；LLD v1.1.42（4.2 引述块、已知缺口表那一行划去）；PROTOCOL「失联后仍挂着的工作进程」段末；用户手册 v1.0.34（「未能确认退出」一句补退出码）；BACKLOG EV-177 ② 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 单跑两份套件（先 `build.mjs --with-tests`） | 69/69（改的是既有格，数不变） | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`） | M1（退回 0）红 K4，亦跑 cancel-grace 红 L1 / L2；M2（确认退出那支也改 69，范围扩大）红 4 格（K3、K10、K6 等） | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 2/2 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量第 1 次 `npm run check` | 2868 / 2866 / 0 / 2，退 0 | `check-1.txt` |
| 全量第 2 次（串行） | 2868 / 2866 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 两次全量期间各 2（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：v1.3.101 版本行里「退 0（②）不变」是历史记录，未改；其余写着失联格退 0 的落点（两段代码文档块、设计 7.5 两处、LLD 两处、PROTOCOL、手册）都已改，`grep` 复核无遗漏。PROTOCOL 那句写成「退出码仍为 0，唯一的例外……」，例外的范围与代码一致（只有 `cancelLostWorker` 未确认退出）。
- 断言范围：只把三处「未确认退出 ⇒ 0」改成 69，没有放宽；M2 证明确认退出那一支的 0 仍被守着。
- 范围：`mismatch` / `no_identity` 两格同样「没动归档与锁」，但它们不进 `cancelLostWorker`，用户定的范围是「那一格」，未扩到它们——若要统一，属新的退出码决策，汇总时提出。
- 护栏：本题无新增登记调用点；全程零配额。
- 触发条件：本题未命中任何等触发条目的触发条件。
