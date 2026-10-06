# 回收遗留锁时收尾旧运行 · 实施报告（EV-151）

> - **日期**：2026-10-06
> - **主题**：`回收遗留锁收尾旧运行`（M11 前待办第二批第 3 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`36d8fe8`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/reclaimed-lock-settle-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定取候选 A 并含同步路径扩展（BACKLOG EV-151 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/lock.ts` :335 `acquireLock`：锁已被占时 `judgeStale` 判遗留（`pid_gone` / `pid_reused` / `heartbeat_dead` / `unparsable`），`reclaimStaleLock` 回收成功后只 `warn` 一行「回收主题「X」的遗留锁（原因 …，原持有者 pid N）」就重试创建；被回收那份锁的内容（含 `run_id`、`stage`、`kind`）不交给调用方。返回的 `LockHandle` 只有 `path` / `content` / `release`。
2. 两个运行锁的取锁点：`run-protocol.ts` :320 `startRun`（`--start`）与 `review.ts` :2130 `runReview`（同步 `review --stage`），都是 `kind: 'run'`、不带 `runId`。`--start` 派生工作进程之后经 `workerLockContent` 把锁改写成「`run_id` + 工作进程 pid + 工作进程启动时刻」（:450 起），随后才把 `worker_pid` 补进 status.json；同步路径的锁从头到尾是「无 `run_id` + 本 CLI 进程 pid」，run_id 在 `prepareRun`（`review.ts` :882 `allocateRunId`）里分配、此后写骨架 run.json 与登记。
3. 于是：工作进程猝死（SIGKILL、崩溃）或同步 CLI 被 SIGKILL 之后，下一次 `--start` / 同步 review 只回收锁、不碰旧运行，旧 run.json 与 task.json 登记停在 `running`。工作进程那一种还能靠对它补跑 `--wait`（EV-142 失联收尾，`worker_lost` / `pid_gone`）收掉，运行目录过了保留期就不行；同步那一种没有 status.json（`meta.ts` `finalizeFailedRunMeta` 文档块：「准备阶段与同步路径：没有 status.json，`--cancel` / `--wait` 也够不着」），锁里也定位不到运行，**任何入口都收不了**。EV-155 之后同步路径被 Ctrl-C 也是这一形态。
4. 现成部件：EV-142 的 `finalizeFailedRunMeta`（自身不抛、已是终态不追溯改写）；`state.ts` `releaseRunningGateEntry`（只把 `running` 且 run_id 相符的闸门项改回 idle）；`run-protocol.ts` 的 `reportFinalizeStep`、`runDirFor`；`status.ts` 的 `readStatus`。

### 修法（候选 A + 同步路径扩展）

1. `lock.ts`：`LockHandle` 加 `reclaimed`——本次取锁过程中**真回收掉**的每一份遗留锁（判定的原因 + 当时读到的内容）。告警一行不变。
2. `run-protocol.ts` 新增 `settleReclaimedRunLocks(ctx, reclaimed)`：只处理原因为 `pid_gone` / `pid_reused`（持锁进程按 pid + 启动时刻已确认不在）、`kind: 'run'`、带 `run_id` 与 `stage` 的那些——
   - 旧运行的归档 run.json 读不出 ⇒ 告警一行、不收；已是终态 ⇒ 什么都不做；
   - 运行目录里 status.json 记了 `worker_pid` 而与锁里的 pid 不同 ⇒ 不收（锁记的不是那一轮的工作进程），告警并给 `--wait` 出口；
   - 否则播报一行「上一轮运行 … 的持锁进程已不在、归档仍为 running：按失联收尾」，先回收该轮仍为 running 的闸门项（比 run_id），再 `finalizeFailedRunMeta`（`worker_lost` / `pid_gone`，与 `--wait` 判 `pid_gone` 同一取值），逐步播报。
   - 锁带 `kind: 'run'` 却没有 `run_id`（`--start` 在改写锁之前就中断——EV-150 那个窗口，工作进程可能还活着；或本版之前的同步运行）⇒ 只多告警一句「定位不到上一轮，不收尾」。
   `startRun` 与 `runReview` 取到锁后、准备新一轮之前各调一次（`runReview` 经动态导入，避免 `review.ts` ↔ `run-protocol.ts` 的静态循环，与 `hooks.ts` 取 `runDirFor` 同法）。
3. 同步路径扩展：`ReviewOptions` 加可选回调 `onRunIdAllocated`，`prepareRun` 在 `allocateRunId` 之后、写骨架之前调它；`runReview` 传入的回调把锁内容改写为带 `run_id`（pid、启动时刻、`acquired_at` 不变，与 worker 锁同形）。`startRun` 不传——它在派生之前锁记的是 `--start` 自己，此时带上 run_id，`--start` 死在派生之后、改写之前时会把活工作进程的运行判成可收尾（正是 EV-150 那个窗口）。

### 不改的边界

- status.json 不写：工作进程那一轮之后对它 `--wait` 仍会判 `pid_gone`（run.json 已是终态、不再改写）；同步运行本来就没有 status.json。
- `termination` 不新增取值：同步运行被中断也记 `worker_lost` / `pid_gone`（这里的「工作进程」即同步执行审查的那个进程）；要区分得改 run.v2 契约，属产品决策，另登。
- `acquireLock` 的判定、重试、回收协议与告警文字不动；`withGlobalLock` 等短临界区锁不受影响（只处理 `kind: 'run'`）。
- 会话启动清扫 `sweepDeadRunningGates`（候选 B）不动。

## 1. 改了什么

1. `src/trivium/lock.ts`：`LockHandle` 加 `reclaimed: ReclaimedLock[]`（新导出类型：判定原因 + 判定时读到的内容）；`acquireLock` 在真回收一份遗留锁、打出原有告警之后把它记进数组，成功取锁时随句柄交还。判定、回收协议与告警文字不动。
2. `src/trivium/run-protocol.ts`：新增导出 `settleReclaimedRunLocks` 与内部 `settleReclaimedRun`（过滤与收尾规则见 §0 修法 2）；`startRun` 在取锁之后、`try` 之前调它（自身不抛，不进本轮的失败收尾）；`installForegroundInterruptForwarding` 文档块里「中断后的留痕不在这里收，见 EV-151」一句改为指向新的收尾。
3. `src/trivium/review.ts`：`ReviewOptions.onRunIdAllocated`（`prepareRun` 在 `allocateRunId` 之后、写骨架之前调用）；`runReview` 取锁后经动态导入调 `settleReclaimedRunLocks`，再以 `recordRunIdInLock`（把 run_id 补写进自己的锁，写不进只告警）作回调跑本轮。
4. 用例：新文件 `test/integration/reclaimed-lock-settle.test.ts` 7 格（S1 工作进程那一轮收尾且 status.json 不写、S2 同步运行收尾、S3 status.json 的 worker_pid 不符不收、S4 没有 run_id 只告警、S5 已终态 / 归档不存在不出声、S6 短临界区锁与持锁进程活着不收、S7 没回收时为空数组）；`test/integration/gate-loop.test.ts` 新增 G1 / G2 两格（经真实 bundle，hang 桩 + 强杀）。
5. 文档：主设计 v1.3.106（7.5 新增「回收遗留锁时收尾上一轮」一段、v1.3.102「不收留痕」一句与 6.7 未回填清单改准）；LLD v1.1.43（4.3 新增「回收之后」一条，另三处指向 EV-151 的半句改准）；PROTOCOL `termination` 一段补写入者；用户手册 v1.0.35（Ctrl-C 那一条）；BACKLOG EV-151 结案、新登 EV-220；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 新文件单跑（先 `build.mjs --with-tests`） | 7/7 | `suite-settle.txt` |
| G1 / G2 单跑（`--test-name-pattern EV-151`） | 2/2 | `suite-gate-loop-g.txt` |
| 变异逐条预跑（带 `--test-timeout`） | 8/8 红：M1（不交还回收清单）红 S 系列 6 格；M2（`--start` 不收尾，即改前形态）红 G1；M3（同步不收尾）、M4（同步不写 run_id）红 G2；M5～M8 各红 1 格 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 8/8 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量第 1 次 `npm run check` | 2877 / 2875 / 0 / 2，退 0（起点 2868 + 9） | `check-1.txt` |
| 全量第 2 次（串行） | 2877 / 2875 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 0、全量 2 期间 1（`trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：新文档块只陈述实现了的过滤与顺序；「先回收闸门、再收尾」引的是 `finalizeUnfinishedRunMeta` 文档块里已有的「没有下一次补齐入口时」那一组次序，没有另造规则。`releaseRunningGateEntry` 自身不抛，起初多包的一层 try 已去掉。
- 一处同形口径，如实写明：同步锁带上 run_id 之后，与 worker 锁一样，在「本轮 run.json 已写终态、本进程放锁之前」那一瞬会被并发取锁者按 `heartbeat_dead`（运行已终态）回收——这是 worker 锁一直以来的判据，同步路径从此同口径；此前同步锁没有 run_id，这一瞬不会被回收。
- 断言范围：既有用例一条未改；新断言只覆盖本题新增的行为。
- 护栏：没有新增 `locateSubject` 一类登记调用点；新增的 `releaseRunningGateEntry` 调用点无计数护栏（已 grep `test/`）；新用例临时目录走 `fakeCtx` / `makeFixture`（`scratchDir`），G2 的分离子进程与桩 CLI 组在 `finally` 里按组结束；全程零配额。
- 触发条件：本题动了 `lock.ts` 的取锁返回值，但没动回收判定与「放回」路径，未命中 EV-174（「实测命中放不回告警或双持有」）的触发条件；也未命中其它等触发条目。
- 新发现：同步运行被中断也记 `worker_lost`，区分要改 run.v2 契约，另登 EV-220（建议维持现状）。
