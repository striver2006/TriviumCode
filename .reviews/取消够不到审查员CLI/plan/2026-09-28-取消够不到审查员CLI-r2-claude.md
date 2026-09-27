# 取消够不到审查员 CLI 实施计划（r2 定稿）

> **性质**：BACKLOG EV-152，**不属任何里程碑**。上一主题（派生后失败的孤儿worker，`c54091f`）在计划期实测核出：`review --cancel` 按 worker 的进程组发信号，**够不到**适配器以 `killTree` 拉起、自成进程组的厂商 CLI；那一主题只把说法改准（D7），行为修复登为本条。
> **做法（D1，已定）**：修法 ①——worker 装 SIGTERM 处理器：处理器一执行就冻结经 `run()` 的链路，再按组终止它以 `killTree` 拉起、尚未退出的 CLI（宽限 2 s → SIGKILL → 至多再等 1 s，全程按父进程手里的子进程句柄判退出），确认之后以 SIGTERM 重新自杀，退出形态与今天相同。worker 被 SIGKILL（`--cancel` 宽限 5 s 后升级、外部强杀）或崩溃的那几格处理器跑不到，**如实保留**，另登一条「worker 把 CLI 进程组记进运行目录」的后续（修法 ②），与 EV-146、EV-38 共用这份记录。
> **实测**（§2，零配额）：会写输出的假 CLI 在 worker 死后下一次写输出时自行退出；**静默的、吞写错误的、忽略 SIGPIPE 的都活着**，ppid 变成 1。修法 ① 的原型在 SIGTERM 下 1.58 s 内结束了两组（含一组忽略 SIGTERM、靠 SIGKILL 结束），SIGKILL 下两组都活着。真实厂商 CLI 对 SIGTERM 的处置**未实测**（D3 定不花配额）。
> **决策已定（2026-09-28，送审前）**：用户定 D1～D7 全部取 §9 的建议项。
> **计划双审第 1 轮**（run `20260927T190138Z`）：codex `approve-with-nits`，gemini、glm `request-changes`；16 条全接受（AGY-04 接受问题、不取它建议的修法），裁决件 `2026-09-28-取消够不到审查员CLI-revised-claude.md`；用户审批通过（无附言）。
> **r2 相对 r1 的改动**：冻结的保证范围写准，新增「取消落在收尾段」一格，撤回「I1 守住」（AGY-04 ≡ GLM-01）；冻结对全部 `run()` 生效写成显式决定（CODEX-04）；处理器退出步骤收成 `exitOnce`、清看门狗、兜底延时，并可卸载（AGY-03、AGY-06）；a 格与文档口径加「真实 CLI 信号处置未实测」的限定（CODEX-02）；U7⑥、U9、M9、M10（AGY-05、AGY-02 ≡ CODEX-06、GLM-03）；I1 / I2 按组号判组空、断言改指 stderr、计时只作由常量推导的上界（CODEX-03、GLM-02、CODEX-05）；旧构建的出法与叠加面（CODEX-01 ≡ AGY-01）；A6 比对口径（GLM-04）。逐条对应见文末附录。

- **日期**：2026-09-28
- **主题**：`取消够不到审查员CLI`（`topic claim` plan → claude）
- **起点**：`dbd1a8a`（`main`）。下文行号均取自该提交的**源码**（不取 `dist/test` 编译产物的行号）
- **上位**：BACKLOG EV-152（本主题）、EV-146 / EV-38（同源，D4 / D5）、EV-151 / EV-153（相邻，不在范围）；
  `.reviews/派生后失败的孤儿worker/plan/` r2（§2.1 K1 / K2、§3.3、§6.4 第 5 条、D7）与代码双审应答件（`terminateProcessGroup` 返回 `signals`、播报按事实分句）；
  `doc/05_testing/REPORT_2026-09-27_orphan_worker.md`（§2、§3.2、§3.3、§7）与 `evidence/orphan-worker-20260927/`（`probe-kill-reach.mjs`、`acceptance.mjs` 的旧构建做法）；
  主设计 v1.3.51、PRD v1.4.15、LLD v1.1.9、MANUAL v1.0.9
- **全量基线**：`npm run check` 2161 / 2159 / 0 / 2（`c54091f` / `dbd1a8a`，上一主题报告 §7）

---

## 0. 范围与不做

| 做（D1 已定 ①） | 不做 |
| :--- | :--- |
| `util/exec.ts`：登记本进程以 `killTree` 拉起、尚未退出的子进程；新增「冻结并按组终止它们」的函数；冻结之后 `run()` 不再派生、已在跑的 `run()` 不再兑现（§4.1） | EV-151、EV-147、EV-148、EV-149、EV-153；历史留痕回填 |
| `run-protocol.ts` `workerMain`：装 SIGTERM 处理器，转发给上面那个函数后以 SIGTERM 重新自杀；带看门狗、可卸载（§4.2） | EV-146（D4，不并入）、EV-38（D5，不并入） |
| `cancelRun` / `settleOrphanedStart` 的宽限 5 s 抽成一个具名常量，并以用例钉住「worker 处理器预算 < 取消宽限」（§4.3） | 修法 ② 的行为：另登 BACKLOG，与 EV-146 / EV-38 共用（§8） |
| `cancelRun` 两处播报：升级 SIGKILL 时、worker 已不在时，补一行「它拉起的审查员 CLI 可能仍在」的如实提示（§4.3） | 前台同步路径（`review --stage`、预检 / `doctor` 的探活）被 Ctrl-C 时同样够不到 `killTree` 拉起的 CLI：按代码推断，未实测，另登（§7.3、D6） |
| 桩新增一种以 `killTree` 真实拉起子进程的挂起模式（§5.2） | `pty: true` 在 worker 的管道 stdin 下 `script` 直接退 1（§2.3 旁证）：本机 `pty_required: false`，不在生产形状里，只登记（D6） |
| 把 EV-150 那一轮改成「够不到」的说法再改回「worker 在跑时够得到、被强杀时够不到」：`killProcessTree` / `terminateProcessGroup` 文档块、`cancelRun` 注释、`worker-detach.test.ts` 一处注释；同步主设计、LLD、MANUAL、PROTOCOL、BACKLOG（§6） | skill 文本、入口资产、run.v2 schema、`termination` 取值：都不用改（§6 末段）；本仓根 `CLAUDE.md` 不改（EV-138） |

---

## 1. 现状（逐条对照代码，`dbd1a8a`）

### 1.1 CLI 是怎么被拉起的

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| R1 | `run()` 在 `killTree: true` 时给 `spawn` 加 `detached: true`（:116-121），子进程成为**新会话、新进程组**的组长；stdio 三路都是管道（:119）。文档块（:46-53）写的理由是「超时按进程组杀，才不会把真正烧配额的孙进程遗弃给 init」 | `src/trivium/util/exec.ts` :46-53、:116-121 |
| R2 | 超时与早退都走 `signalChild`（:208-211）：`killTree` 时 `killProcessTree(child.pid, sig)`，否则 `child.kill(sig)`；计时器（`softTimer` / `hardTimer`，:224-230）**活在调用 `run()` 的那个进程里** | 同上 :208-230 |
| R3 | `run()` 兑现靠 `'close'`（:197），`'exit'` 之后 2 s 兜底（:204-206）；`finish` 一旦调用就 `resolve`（:172-191）。**没有进程级的登记**：谁在跑、有几个，只存在于各自的闭包里 | 同上 :172-206 |
| R4 | 四个适配器的审查调用都带 `killTree: true`：`agy.ts` :110-116（另有 `pty: opts.pty ?? false`，:114；并给 CLI 传 `--print-timeout`＝上限减 20 s，:101-102）、`codex.ts` :102-113、`zcode.ts` :499、`claude.ts` :408-413。输出形态：agy / claude 为 `stream-json`（`agy.ts` :80、`claude.ts` :108-109），codex 为 `exec --json`（`codex.ts` :71），zcode 为 `--json`、stdout 末尾一个 envelope（`zcode.ts` :18、:447、:519） | `src/trivium/adapters/*.ts` |
| R5 | 同一组 `invokeX` 也被探活调用（前台进程）：`agy.ts` :206-214、`codex.ts` :325-336、`claude.ts` :747-756、`zcode.ts` :1069-1084；审查调用分别在 `agy.ts` :279、`codex.ts` :550、`claude.ts` :884、`zcode.ts` :1232 | 同上 |
| R6 | worker 里调用链：`executeRun`（`review.ts` :1085）→ `runBothSides`（`review.ts` :1127；`runner.ts` :201-262，`Promise.allSettled`）→ `runOneSide`（`runner.ts` :101-193）→ `adapter.run`（:142）→ `invokeX` → `run()`。`runOneSide` 在 `adapter.run` 之后抹凭据副本（:147）并可能重试（:166-183）。**归档终态写入（`review.ts` :1687 `writeRunMeta`）在 `runBothSides` 返回之后**，其间是一段不经 `run()` 的异步收尾（解析、漂移复算、哈希等，`review.ts` :1127-1687） | `src/trivium/runner.ts`、`src/trivium/review.ts` |

### 1.2 杀的一侧

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| C1 | `killProcessTree(pid, sig)`：`kill(-pid)` 按组发，ESRCH 退回 `kill(pid)`（:435-451）。文档块（:420-434）已写明「够不到的：适配器以 `killTree` 拉起的 CLI 自成一组……行为修复见 BACKLOG EV-152」 | `src/trivium/util/exec.ts` :420-451 |
| C2 | `terminateProcessGroup(pid, o)`：每次发信号前先问 `isGone()`；SIGTERM → 宽限轮询 → `onEscalate` + SIGKILL → 至多 `killWaitMs`；返回 `{ gone, escalated, signals }`（:468-508）；文档块末句「只管这一个进程组……这里够不到（EV-152）」（:477） | 同上 :453-508 |
| C3 | `cancelRun`：**按 status.json 的 phase 终态早退**（:1142-1146）→ pid 取 `status.worker_pid ?? worker.pid`（:1147-1152）→ 活着且同一进程才 `terminateProcessGroup(pid, { isGone: workerGoneForCancel, graceMs: 5000, killWaitMs: 0, pollMs: 250, onEscalate: warn(…) })`（:1154-1172），注释 :1157-1163 写明够不到 CLI；否则 step「工作进程 N 已不存在，仅做状态与锁的清理」（:1174）→ **凭据清扫准入** `workerConfirmedGone`（:1183-1193，只核 worker）→ 归档收尾 `cancelled`（:1205-1215，run.json 已终态即按前提 4 跳过）→ status.json **无条件** `cancelled`（:1217-1222）→ 回收锁与闸门（:1224-1252）。播报：`say` 在非 `--json` 模式写 stdout，`step` / `warn` 恒写 stderr（`util/log.ts` :18-35） | `src/trivium/run-protocol.ts` :1122-1255 |
| C4 | `settleOrphanedStart` 第 1 步 `terminateProcessGroup(born.pid, { isGone: born.watch.hasExited, graceMs: 5000, killWaitMs: 5000 })`（:577-579）。这一刻 worker 还在加载阶段、没有 CLI（上一主题计划 r2 §3.3，P4b 钉住） | 同上 :563-700 |
| C5 | `workerMain`（:720-835）：心跳定时器（:722-729）→ `rebuildContext` → `executeRun`（:760）→ status.json 终态（:762-778）；`catch` 收尾 `worker_exception`（:780-818）；`finally` 回收闸门与锁（:819-834）。**没有任何信号处理器**：全仓 `grep -rn "process\.on(\|process\.once(" src/` 零命中，SIGTERM 即按缺省动作（内核立刻终止）退出，`finally` 不跑 | 同上；全仓 grep |
| C6 | 工作进程入口：`cli.ts` :434 `if (workerId) return workerMain(ctx, workerId);` | `src/trivium/cli.ts` :429-434 |
| C7 | 「worker 已退出」的三个读者只核 worker：`workerConfirmedGone`（`status.ts` :155 起）、会话启动 / `trivium scrub` 的 `workerStillAlive`（`retention.ts` :93-97）与 `admitScrub`（:107-116）、会话启动 `sweepDeadRunningGates`（`hooks.ts` :1711 起，`processAlive(worker_pid)`） | `status.ts`、`retention.ts`、`hooks.ts` |
| C8 | 运行目录层的编排器文件由 `run-files.ts` 的 `RUN_DIR_FILES` 统一登记（`request.json` / `worker.pid` / `worker.log` / `status.json`），`freeze.ts` 的禁读分类与 `run-files-parity` 契约测试都读它。**新增一个运行目录文件就是一处契约面改动**（与修法 ② 相关，D2） | `src/trivium/run-files.ts` |
| C9 | status.json 是 `trivium.status.v1`，只有 TS 接口（`status.ts` :30-56），**没有 JSON schema**；`SideStatus` 为 `{ state, model, attempt, elapsed_s, note? }` | `src/trivium/status.ts` :30-56 |

### 1.3 测试现状

| 用例 | 现状 | 本主题 |
| :--- | :--- | :--- |
| `worker-detach.test.ts` :175「killProcessTree 杀整组」 | 子进程不带 detached，注释（:178-185）已写明不覆盖 `killTree` 形状 | 只改注释：指向新用例 U7 / I1 |
| 桩 `hang` 模式（`stub.ts` :104-110 说明、:283-289 实现） | 进程内 `setTimeout(600 s)`，**不起子进程**——测不出本条 | 不动；新增 `hang_cli` 模式（§5.2） |
| `run-protocol.test.ts` :218「--cancel 终止工作进程…」、:494「--cancel 对已退出的工作进程也能清理…」、EV-128 E1 :291 / E3 :324 / E6 :348 | `--cancel` 的杀、收尾与播报；均为字段断言与包含式匹配，不逐行比对 | 断言不改；:494 那一格 stderr 会多一行提示（§4.3） |
| `gate-loop.test.ts` 用 `hang` 桩的取消类用例（:727、:774、:815、:888、:923、:1384 等）与 P4 系列（:2352 起） | worker 里没有 `killTree` 子进程 | 须保持绿：处理器在登记为空时立刻重新自杀，行为与今天相同（§4.2） |
| 上一主题 U3～U6、`terminateProcessGroup` 系列 | 句柄与终止函数 | 不改 |

---

## 2. 实测（只读 / 零配额）

脚本在 Driver 会话 scratchpad，mkdtemp 夹具，收尾只删 mkdtemp 返回值、只按进程组结束命令行里带本次随机标记的进程；实施时拷进 `doc/05_testing/evidence/cancel-cli-reach-<日期>/`，读数一并存档。**实测范围**：Node v25.2.1、macOS；不宣称 Linux 上成立。

### 2.1 K1 回顾（上一主题 `probe-kill-reach.mjs`）

worker 被按组 SIGTERM 后约 150 ms 退出；不带 `killTree` 的子进程随组退出；**`killTree` 拉起的子进程仍活着、ppid 变成 1**。探针里的子进程是 `sleep`，不写输出。

### 2.2 管道断开之后假 CLI 的去留（`probe-pipe-break.mjs`，P1～P8）

照生产形状搭：`spawnDetached` 派生 node「worker」，它用仓库构建的 `run()` 以 `killTree: true` 拉起一个假 CLI；等假 CLI 正常写 1.2 s 后，照 `cancelRun` 的杀法 `killProcessTree(worker, 'SIGTERM')`，在 1 s / 3 s / 6 s 看假 CLI 所在进程组还有没有成员。**三次运行读数相同**：

| 格 | 假 CLI | 1 s / 3 s / 6 s |
| :-- | :--- | :--- |
| P1 | `sh` 每 0.5 s 往 stdout 写一行 | 组已空（SIGPIPE） |
| P2 | node 每 0.5 s 往 stdout 写一行，不接 `'error'` | 组已空（EPIPE 未处理即退出） |
| P3 | node 同上，但吞掉 stdout 的 `'error'` | **活着，ppid = 1** |
| P4 | node 每 0.5 s 只往 stderr 写一行，不接 `'error'` | 组已空 |
| P5 | node 静默（模拟等模型回包的那一段） | **活着，ppid = 1** |
| P6 | `sh` 忽略 SIGPIPE 后每 0.5 s 写一行（写失败即忽略） | **活着，ppid = 1** |
| P7 / P8 | `pty: true` 包装下写 / 静默 | 没测成：见 §2.3 |

探针第 1、2 版在 P7 / P8 走早退分支时没有结束 worker、且 worker 的 argv 不带标记，留下 4 个探针自己的 node 进程（路径都在本探针的 mkdtemp 目录下），已按进程组结束；第 3 版补了标记与早退分支的清理，之后无残留。三次读数中 P1～P6、H1 / H2 相同。

结论：**「管道一断就会自己死」只在「接下来还要写、且没有处理写错误」时成立**。静默阶段（等模型回包、跑一个长工具调用）的 CLI 活到它下一次写输出为止；吞写错误或忽略 SIGPIPE 的活到自然结束。而它的超时计时器随 worker 一起没了（R2）。

对照四家的输出形态（R4，按代码推断、未实测）：agy / claude / codex 流式输出事件，按 P1/P2 形态**多半**在 worker 死后的下一个事件处退出——前提是它们不吞写错误（P3/P6 形态），这一点零配额判不了；**zcode 只在结束时写一个 envelope，整段审查都是 P5 形态**，会一直跑到完成，配额照烧——与 `5476238` 记下的 zcode-cli「被遗弃后继续消耗配额」一致（那时它还在 worker 的组里，原因不同，后果相同）。agy 另有 `--print-timeout`（上限减 20 s，R4），被遗弃后最迟在那一刻自己收尾。

### 2.3 pty 旁证

`run('/bin/sh', …, { killTree: true, pty: true })` 在管道 stdin 下直接退 1，stderr `script: tcgetattr/ioctl: Operation not supported on socket`（`dbg-pty.mjs`）。`run()` 给子进程的 stdin 恒为管道（R1），所以 macOS 上 `pty: true` 这条路本身跑不起来；本机 `.trivium/config.local.yaml` 记的是 `pty_required: false`，生产形状不含 pty。与本条无关，只登记（D6）。

### 2.4 修法 ① 的原型（`probe-pipe-break.mjs`，H1 / H2）

worker 用 `spawn(…, { detached: true })` 拉起两组：`sleep 120` 与忽略 SIGTERM 的 `trap '' TERM; sleep 120`（`sleep` 继承忽略）。处理器：收到 SIGTERM → 对每组 `killProcessTree(pid, 'SIGTERM')` → 至多 1.5 s 按句柄等退出 → 仍在的 SIGKILL → 至多再等 1 s → 以 SIGTERM 重新自杀。三次读数相同：

| 格 | 发给 worker 组的信号 | worker 退出 | 两组 CLI |
| :-- | :--- | :--- | :--- |
| H1 | SIGTERM | 1.58 s，`signal: SIGTERM`（重新自杀，退出形态与今天一致） | **都已结束**（忽略 SIGTERM 的那组靠 SIGKILL） |
| H2 | SIGKILL | 4 ms，`signal: SIGKILL` | **都活着**，组长 ppid = 1、组员 `sleep` 在 |

原型的「CLI」是 `sh` + `sleep`，**不是任何真实厂商 CLI**：真实 CLI 对 SIGTERM 的处置（装监听做优雅收尾、等子请求返回）没有测过（D3），由 2 s 后的 SIGKILL 兜底（CODEX-02）。

### 2.5 重新自杀的退出形态（计划双审 r1 CODEX-06 / AGY-03 之后补测）

子进程里「装 SIGTERM 监听 → 移除 → `process.kill(self, 'SIGTERM')` → 同步 `process.exit(143)`」与「……→ 1 s 后 `process.exit(143)`」各跑三次，六次都是 `code: null, signal: 'SIGTERM'`：v25.2.1 / macOS 上，移除最后一个监听即恢复缺省处置，且 `kill(self)` 在返回之前就结束了进程。POSIX 只在「没有其它线程能接这个信号」时保证后一点，Node 18 未测，所以 §4.2 的兜底仍写成延时。

### 2.6 零配额造不出、按代码论证的

- **事件循环被堵住**（同步 I/O、死循环）时 SIGTERM 处理器跑不到：Node 的信号处理器在事件循环上执行。worker 的正常路径全是异步 I/O，按罕见处理；这一格与 worker 被 SIGKILL 同归「处理器覆盖不到」（§3）。
- **信号到达与处理器执行之间的窗口**（§4.1）：libuv 把信号转成事件循环里的回调，其间已就绪的 I/O 回调可先行，至多一次迭代；撞中要求取消恰好落在归档终态写入的最后一步上，造不出确定时序。
- **真实 CLI 对写错误与对信号的处置**：见 D3。

---

## 3. 修法选型与覆盖（D1）

### 3.1 候选

- **①** worker 装 SIGTERM 处理器，转发给自己以 `killTree` 拉起、尚未退出的 CLI 进程组，确认后再退出。
- **②** worker 在派生 CLI 时把它的 pid 与启动时刻记进运行目录（status.json 的侧字段，D2），`--cancel` 在处理完 worker 之后读这份记录、逐组发 SIGTERM → SIGKILL。
- **③** ① + ②。
- **④ 其它**，考虑过、不取：
  - ④a 去掉 `killTree` 的 `detached`、让 CLI 留在 worker 的组里：`--cancel` 的组信号就够得到。代价是 `run()` 的超时只能杀直接子进程——pty 包装下直接子进程只是 `script`、厂商 CLI 自己派生的孙进程被遗弃，正是 `2b460ad` 要修的那一格。要两头都顾，就得换成「按会话杀」或逐个枚举后代，macOS 没有 `pkill -s` 的可靠等价物。
  - ④b 让 CLI 随父进程死：Linux 有 `PR_SET_PDEATHSIG`，macOS 没有；Node 也不暴露。
  - ④c `--cancel` 按 ppid = 1 与命令行特征在进程表里搜孤儿：没有身份证据，会误杀别的仓库、别的会话里的同名 CLI。

### 3.2 覆盖矩阵

| 格 | ① | ② | ③ |
| :--- | :--- | :--- | :--- |
| a. `--cancel`，worker 在 5 s 内响应 SIGTERM（常态） | ✅ 按父进程句柄杀，不涉复用；真实 CLI 对 SIGTERM 的处置未实测，不响应时 2 s 后 SIGKILL 兜底（CODEX-02） | ✅（派生到落盘之间的毫秒窗口除外，见 f） | ✅ |
| a″. `--cancel` 落在收尾段（两侧 CLI 已结束、worker 在解析与归档） | 无 CLI 可杀；归档由谁收尾见 §4.4 第 3 行 | 同左 | 同左 |
| b. `--cancel`，worker 5 s 内没退出、被升级 SIGKILL（事件循环堵住；或 ① 的处理器超预算） | ❌ | ✅ | ✅ |
| c. worker 先被外部 SIGKILL / 崩溃，之后有人 `--cancel` | ❌ | ✅（`cancelRun` 在 worker 已不在的分支读记录） | ✅ |
| d. worker 被强杀 / 崩溃，之后没人 `--cancel`（只有 `--wait` 判失联、会话启动清扫） | ❌ | ❌（除非 `--wait` / 清扫也去杀——那是 EV-146 / EV-38 的范围） | ❌ |
| e. `settleOrphanedStart` 终止加载中的 worker | 无 CLI，不涉及 | 同左 | 同左 |
| f. CLI 刚派生、记录还没落盘时 `--cancel` | ✅（登记是同步的，进程内） | ❌ | ✅ |
| g. CLI 自己又 `setsid` 出去的后代 | ❌ | ❌ | ❌ |
| h. 组长 CLI 已因 SIGTERM 退出、同组还有忽略 SIGTERM 的后代 | ❌（组长退出后不再对该组发信号，§4.1） | ❌（同理：组长不在就判不了复用） | ❌ |
| i. 前台同步路径 / 探活被 Ctrl-C | ❌（处理器只装在 worker） | ❌ | ❌ |
| **代价** | `exec.ts` 与 `workerMain` 两处；无契约面改动；回滚即回退代码 | status.json 加侧字段、适配器多一个回调穿透、每派生一次多一次 `ps`、`cancelRun` 多一段、复用判据（D2） | 两者之和 |

### 3.3 已定：① 进本主题，② 另登并与 EV-146 / EV-38 合并论证

- ① 覆盖的是实际发生的那一格（a：用户敲 `--cancel` 时 worker 是活的、在等 CLI）。它按**父进程句柄**判退出，沿用上一主题 D3 的论证（未观察到 `'exit'` ⇒ 未被回收 ⇒ pid 与同号进程组不会被复用），不需要启动时刻，也不新增运行目录文件。
- ② 独有的是 b、c 两格——worker 自己不响应或已经死了。**EV-146（`heartbeat_stale` 后杀不掉挂住的 worker）正落在 b**：心跳停了多半是事件循环被堵住，① 的处理器同样跑不到；**EV-38（清扫准入不核 CLI）要的也正是这份记录**。三者要的是同一个东西（CLI 进程组的持久记录 + 复用判据），放在一次论证里做。

---

## 4. 改法

### 4.1 `util/exec.ts`：登记与冻结

```ts
/** 本进程以 killTree 拉起、尚未观察到退出的子进程（EV-152）。键是 pid，也是它的进程组号 */
const liveTrees = new Map<number, ChildProcess>();
/** 置位后本进程进入「终止中」：run() 不再派生，已在跑的 run() 不再兑现 */
let treeShutdown = false;

export interface TreeShutdownResult {
  /** 开始时在登记里、尚未退出的组 */
  groups: number[];
  /** 每组实际发过的信号（按顺序），沿用 terminateProcessGroup 的 signals */
  signals: Record<number, NodeJS.Signals[]>;
  /** 预算用尽仍未观察到退出的组 */
  remaining: number[];
}

export async function shutdownTrackedTrees(o: {
  graceMs: number; killWaitMs: number; pollMs?: number;
  signal?: (pid: number, sig: NodeJS.Signals) => boolean;   // 单测计数，同 TerminateOptions
}): Promise<TreeShutdownResult>
```

- **登记**：`run()` 在 `spawn` 之后、`killTree && child.pid` 时 `liveTrees.set(child.pid, child)`，`child.once('exit', …)` 里删掉。`spawn` 是同步的，登记与派生之间插不进别的 JS，所以没有覆盖矩阵 f 格那种窗口。
- **冻结**：`shutdownTrackedTrees` 进门**同步**置 `treeShutdown = true`，之后：
  - `run()` 进门若 `treeShutdown` 为真，返回一个**永不兑现**的 Promise、不派生；
  - `finish()` 若 `treeShutdown` 为真，清计时器、**不 resolve**。
  理由：被杀的 CLI 的 `'close'` 一到，`run()` 就会兑现，runner 随即抹凭据、判重试（`runner.ts` :147、:166-183），重试会再派生一个 CLI；另一侧也结束后，`runBothSides` 返回，`executeRun` 写归档终态（`review.ts` :1687）。那样 `--cancel` 看到的就是 worker 写下的终态（§4.4 第 3 行的两种形态），归档记成 `failed` 而不是 `cancelled`——**EV-128「取消由 `cancelRun` 收尾」被悄悄改掉**。进程随后就退出，悬着的 Promise 无害。
- **冻结对全部 `run()` 生效，不只是 `killTree` 派生的**（显式决定，CODEX-04）：worker 一旦进入终止中，就不该再有任何外部落地。代价是收尾路径上不带 `killTree` 的调用也会悬空（`processAlive` → `processStartTime` → `run('/bin/ps')`、`util/git.ts` 的调用），由 §4.2 的重新自杀与看门狗兜底。**日后在 worker 侧新增的 `run()` 调用者须知晓此语义**（§7.1）；`exec.ts` 冻结处的文档块写明这一点。
- **保证范围**（AGY-04 ≡ GLM-01）：**自处理器首行起**，经 `run()` 的链路不再推进。
  - **有在跑的 CLI 时**：`runBothSides` 是 `Promise.allSettled`，悬着的那一侧让它返回不了，`executeRun` 的终态写入必然走不到。
  - **没有在跑的 CLI 时**（两侧都已结束、worker 在解析与归档）：`shutdownTrackedTrees` 立即返回，处理器在同一串微任务里重新自杀，处理器开始执行之后不会再有 I/O 回调运行。
  - **窗口在处理器执行之前**：从信号到达到处理器执行，libuv 要在事件循环里读到信号，其间已就绪的 I/O 回调可以先跑，至多一次迭代。今天 SIGTERM 是内核立刻终止，这段窗口为零。这一格见 §4.4 第 3 行。
  - **不在 `writeRunMeta` 之前查终止标志**：标志由处理器置位，而窗口恰在处理器执行之前；处理器一旦执行，没有 CLI 时进程在微任务里就结束了，走不到那次检查。加检查关不住这段窗口，只会多一处与信号耦合的代码。
- **终止**：对登记里每个尚未退出的子进程**并行**调 `terminateProcessGroup(pid, { isGone: () => child.exitCode !== null || child.signalCode !== null, graceMs, killWaitMs, pollMs: o.pollMs ?? 50, signal: o.signal })`（`Promise.all`），汇总成 `TreeShutdownResult`。判据是**父进程句柄**，与 `settleOrphanedStart` 同一论证（上一主题 D3）：本进程就是这些 CLI 的父进程。并行由 U7⑥ / M10 钉住：串行时两组都忽略 SIGTERM 会让处理器耗时翻倍、击穿 5 s 宽限（AGY-05）。
- **组长已退出就不再对该组发信号**（覆盖矩阵 h 格）：`terminateProcessGroup` 每次发信号前先问 `isGone()`，组长的 `'exit'` 一到就停。组长退出之后同组若还有成员，按 POSIX 该组号不会被复用，继续发其实是安全的；但本进程判不了「组是否已空」，组空了之后组号可能被复用，所以不发。首个 SIGTERM 是按组发的，组员与组长同时收到；只有忽略 SIGTERM 的组员会漏，如实保留（§7.2）。
- 文档块：`killProcessTree` 的「够不到的」一段（:428-430）、`terminateProcessGroup` 末句（:477）改为「按 worker 组发的信号到不了 CLI 那一组；worker 自己的 SIGTERM 处理器会转发（`shutdownTrackedTrees`），worker 被 SIGKILL 时够不到（EV-152 余项，见 BACKLOG 新条目）」；`RunOptions.killTree` 文档块（:46-53）补「并登记进 `liveTrees`，供 worker 收到 SIGTERM 时按组终止」。

### 4.2 `run-protocol.ts` `workerMain`：SIGTERM 处理器

```ts
export const WORKER_TREE_GRACE_MS = 2000;      // 转发 SIGTERM 之后等 CLI 多久再 SIGKILL
export const WORKER_TREE_KILL_WAIT_MS = 1000;  // SIGKILL 之后至多再等多久

/** 装上 worker 的 SIGTERM 处理器，返回卸载函数。workerMain 用它；U9 在子进程里直接装它 */
export function installWorkerSigtermForwarding(): () => void
```

`workerMain` 第一行（心跳定时器之前，:720-722）`const uninstall = installWorkerSigtermForwarding();`，`finally` 首行 `uninstall()`（AGY-06）。收到 SIGTERM 且登记非空时，`workerMain` 被冻结、走不到 `finally`；登记为空时进程在微任务里就结束了——两种情形都不会让卸载抢在转发之前。

处理器（AGY-03 重写）：

1. **只处理第一次**：`process.on` + 进门标志 `handling`，不用 `once`——第二次 SIGTERM 若走缺省动作，会在转发中途把 worker 杀掉、留下 CLI。
2. 起**看门狗**：`WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 500` ms 后调 `exitOnce()`（不 `unref`）。
3. `try { const r = await shutdownTrackedTrees({ graceMs: WORKER_TREE_GRACE_MS, killWaitMs: WORKER_TREE_KILL_WAIT_MS }); 写 worker.log } finally { exitOnce(); }`。往 stderr（即 `worker.log`）写一行：「收到 SIGTERM：已按组终止审查员 CLI 〈组号列表〉（信号序列）」；`remaining` 非空时另写「未能确认退出：〈组号〉」；登记为空时写「收到 SIGTERM：没有在跑的审查员 CLI」。
4. **`exitOnce()`**：进门查 `exiting`，已置位即返回；置位 → `clearTimeout(看门狗)` → 移除监听 → `process.kill(process.pid, 'SIGTERM')` 重新自杀，退出形态与今天相同（H1、§2.5）→ 另起一个 1 s 计时器，到期才 `process.exit(143)`（病态兜底，不同步调用）。正常路径与看门狗都只调 `exitOnce()`，不会重入。

**时间预算**：最坏约 3 s（2 s + 1 s + 调度），看门狗 3.5 s，都落在 `cancelRun` 与 `settleOrphanedStart` 的 5 s 宽限之内；常态（CLI 响应 SIGTERM）是百毫秒级。预算关系由常量与 U8 钉住（§4.3、§5.1）。

**登记为空时**（`hang` 桩、加载阶段被 `settleOrphanedStart` 终止、审查已跑完正在收尾）：`shutdownTrackedTrees` 立刻返回，只多一串微任务就重新自杀——与今天的行为只差冻结标志与 §4.1 那段窗口，现有取消类用例据此保持绿（§1.3）。

**只装在 worker**：`--start`、`--wait`、`--cancel`、同步 `review --stage`、预检都不装。前台进程的 Ctrl-C 语义不变（覆盖矩阵 i 格，另登）。

**不处理 SIGINT / SIGHUP**：worker 是 `detached`（`setsid`）派生的，没有控制终端，收不到终端发出的这两个信号；编排器自己只发 SIGTERM / SIGKILL。

### 4.3 `cancelRun` / `settleOrphanedStart` 的常量与播报

- 两处的 `graceMs: 5000`（:1168、:578）抽成 `WORKER_TERM_GRACE_MS = 5000`；`settleOrphanedStart` 的 `killWaitMs: 5000` 不变。
- `cancelRun` 注释 :1157-1163 改为：worker 收到 SIGTERM 会先按组终止它拉起的 CLI（EV-152）；升级 SIGKILL 时处理器跑不到。
- `onEscalate` 的 warn（:1171，stderr）补半句：「……发送 SIGKILL——它拉起的审查员 CLI 可能未被结束，请用 `ps` 核对 ppid 为 1 的 CLI 进程（BACKLOG 〈新条目〉）」。
- 「工作进程 N 已不存在」分支（:1174）追加一行 warn（stderr）：「工作进程在本次取消之前已退出；它若是被强杀或崩溃的，拉起的审查员 CLI 可能仍在，本命令够不到（同上）」。只提示、不判断——`cancelRun` 此刻没有 CLI 的身份证据。
- 凭据清扫准入（:1183-1193）**不改**：常态 a 格里 CLI 已先于 worker 退出，这一步的前提因此由「只核 worker」变得名副其实；b、c 两格的准入仍只核 worker，留给 EV-38（D5）。

### 4.4 改前 / 改后

| 格 | 今天 | 改后（①） |
| :--- | :--- | :--- |
| a. `--cancel`，worker 在等 CLI | worker 约 150 ms 退出；CLI 过继给 init，静默的跑到完成、配额照烧 | worker 先按组终止 CLI（常态百毫秒级；忽略 SIGTERM 的、以及未实测的真实 CLI 若不响应，约 2 s 后 SIGKILL），再以 SIGTERM 退出；`--cancel` 输出不变 |
| a′. `--cancel`，worker 没有在跑的 CLI、也不在归档写入中 | 同上，worker 立刻退出 | 同今天（多一串微任务） |
| a″. `--cancel` 落在收尾段（两侧 CLI 已结束、归档终态写入已在飞） | 信号即终止；已交给内核线程池的那一步可能落盘，JS 侧不再推进 | 处理器执行之前至多多走一次事件循环迭代，已就绪的回调可再推进一步。最坏：worker 把 run.json 与 status.json 都写成终态 ⇒ `--cancel` 按 status.json 终态早退，归档记 `success` / `failed` 而非 `cancelled`（早退分支不回收锁与闸门，由 worker 自己的收尾或清扫接住）；只写了 run.json ⇒ `finalizeCancelledRunMeta` 按前提 4 跳过、status.json 被无条件写成 `cancelled`，两边劈叉。**取舍：接受并如实记录**（§7.2），按代码论证，无用例可钉 |
| b. worker 5 s 内没退出 | SIGKILL worker 组，CLI 遗留 | 同今天；stderr 多一行如实提示 |
| c. worker 已先死，再 `--cancel` | 「已不存在，仅做清理」，CLI 若在则遗留 | 同今天；stderr 多一行如实提示 |
| 归档与 status.json（a 格） | `cancelled`（由 `cancelRun` 写） | 不变（冻结保证 worker 不抢先写终态） |

---

## 5. 验证

### 5.1 单测

冻结标志是模块级的，**不能在测试进程里置位**：U7、U9 各格都在子进程里跑（`node` 起一个脚本 import `dist/test/src/trivium/…`，结果以 JSON 回到父进程），收尾按进程组结束带本次标记的进程。

- **U7**（`worker-detach.test.ts`）`shutdownTrackedTrees`——
  - ① 以 `run(…, { killTree: true })` 拉起一个静默长睡子进程：调用后它所在的组空了（按组号枚举），`remaining` 为 `[]`，`signals` 为 `['SIGTERM']`；**那个 `run()` 的 Promise 此后 500 ms 内不兑现**（冻结）。
  - ② 子进程忽略 SIGTERM（`trap '' TERM; sleep 600`），`graceMs: 300`：升级 SIGKILL，组空，`signals` 为 `['SIGTERM','SIGKILL']`。
  - ③ 冻结之后再调 `run()`（目标是一个会在 mkdtemp 里建文件的命令）：300 ms 内文件不存在、Promise 不兑现。
  - ④ 登记为空：立刻返回 `{ groups: [] }`，一个信号都不发（注入 `signal` 计数为 0）。
  - ⑤ 不带 `killTree` 的 `run()` 不进登记：它的子进程不在 `groups` 里。
  - ⑥ 两个忽略 SIGTERM 的 `killTree` 子进程，`graceMs: 1000`、`killWaitMs: 500`：两组都空，**总耗时小于 `graceMs + killWaitMs + 1000`**（串行约翻倍，会越界）（AGY-05）。
- **U8**（`run-protocol.test.ts`）预算关系：`WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 1000 <= WORKER_TERM_GRACE_MS`。
- **U9**（`run-protocol.test.ts`，子进程）`installWorkerSigtermForwarding`（AGY-02 ≡ CODEX-06，GLM-03）——
  - ① 子进程装上它、登记为空，父进程发 SIGTERM：断言子进程 `code === null && signal === 'SIGTERM'`，且 stderr 含「没有在跑的审查员 CLI」。
  - ② 子进程装上它、以 `run(…, { killTree: true })` 拉起一个忽略 SIGTERM 的孙进程组；父进程连发两次 SIGTERM（间隔 200 ms）：断言孙进程组空（按组号枚举）、子进程仍以 `signal: 'SIGTERM'` 退出、耗时小于 `WORKER_TERM_GRACE_MS - 500`——第二次 SIGTERM 若走了缺省动作，孙进程组会留下（钉住「只处理第一次」）。

### 5.2 集成（真实 CLI + 桩）

**桩新增 `hang_cli` 模式**（`stub.ts`）：`run()` 里用仓库的 `run('/bin/sh', ['-c', 'sleep 600; : trivium-stub-cli 〈out_dir〉'], { killTree: true })` 真实拉起一个静默子进程（P5 形态），可选 `ignoreTerm: true` 时命令前加 `trap '' TERM;`。保留 `sh` + `sleep` 两层，是为了让组里有不带标记的成员，才测得到「按组」（CODEX-03）。兜底 10 分钟与 `hang` 相同。`StubMode` 的穷举处（若有）实施时 grep 同步。

**判「组空」**（CODEX-03）：先按标记（带 `out_dir`）在进程表里找到 `sh` 组长、记下组号，再用 `ps -axo pid=,pgid=` 枚举该组成员，断言成员数为零；`finally` 按记下的组号清理，并断言清理前的残留列表为空。

- **I1**（`gate-loop.test.ts`，两侧 `hang_cli`）：`--start` → 等两侧组长都出现（前置断言，不出现以「桩 CLI 没起来」失败）并记下组号 → `--cancel` 退 0 → **返回时两组成员数都为零**；**stderr** 不含「未响应 SIGTERM」（GLM-02）；`worker.log` 含「已按组终止审查员 CLI」；status.json `cancelled`、run.json `cancelled`（EV-128 语义不变，冻结没让 worker 抢先写 `failed`）；锁与闸门已回收。今天这里两组都会留下。
- **I2**（同上，一侧 `ignoreTerm: true`）：主判据同 I1（组空、stderr 不含「未响应 SIGTERM」，后者是「worker 在宽限内自己退了」的因果表述，不依赖计时）；`worker.log` 里那一组的信号序列是 `SIGTERM、SIGKILL`；计时只作宽松上界：`--cancel` 耗时小于 `WORKER_TERM_GRACE_MS - 500`，阈值由常量推导、不写魔数（CODEX-05）。
- 既有须保持绿：`hang` 桩的全部取消类用例、P1～P6 / P4b / P4c、EV-128 E 系列、EV-142 W / L / X 系列、`worker-detach.test.ts` 全部、会话启动清扫两条。两次运行之间隔 1.1 s（EV-147）。
- 实施时先在未变异的构建上确认「未响应 SIGTERM」「已按组终止审查员 CLI」确实落在被断言的流里（stderr / `worker.log`），再定变异规格（GLM-02）。

### 5.3 变异（`scripts/mutation-check.mjs`；规格由生成脚本从源码截锚点并逐条核对唯一，照搬 `evidence/orphan-worker-20260927/gen-mutation-spec.mjs`）

每条只写一个期望套件；失败用例名与文案用 `evidence/orphan-worker-20260927/mutation-names.mjs`（第 2 版）补，确认是目标断言而红、没有「桩 CLI 没起来」一类的前置失败。

| # | 变异 | 期望套件（应红的用例） |
| :-- | :--- | :--- |
| M1 | `workerMain` 不装处理器 | `gate-loop.test`（I1） |
| M2 | `shutdownTrackedTrees` 不升级 SIGKILL（`graceMs` 之后直接返回） | `worker-detach.test`（U7②） |
| M3 | `finish()` 冻结时照常 resolve | `worker-detach.test`（U7①） |
| M4 | `run()` 冻结后照常派生 | `worker-detach.test`（U7③） |
| M5 | 处理器末尾不重新自杀（worker 留着） | `gate-loop.test`（I1：`--cancel` 升级 SIGKILL，**stderr** 出现「未响应 SIGTERM」） |
| M6 | `run()` 不登记 `killTree` 子进程 | `worker-detach.test`（U7①） |
| M7 | `WORKER_TREE_GRACE_MS` 改成 5000 | `run-protocol.test`（U8） |
| M8 | 登记也收不带 `killTree` 的子进程 | `worker-detach.test`（U7⑤） |
| M9 | 重新自杀改成同步 `process.exit(143)`（AGY-02 ≡ CODEX-06） | `run-protocol.test`（U9①） |
| M10 | `shutdownTrackedTrees` 的并行改成逐个 await（AGY-05） | `worker-detach.test`（U7⑥） |

### 5.4 零配额验收（scratchpad → `evidence/cancel-cli-reach-<日期>/`）

**新旧两份构建**（CODEX-01 ≡ AGY-01）：

- **新构建**：工作树 `npm run build` 之后的 `skills/dual-critic/scripts/trivium.cjs`，`TRIVIUM_ASSET_ROOT` 指工作树。
- **旧构建**：照搬上一主题 `evidence/orphan-worker-20260927/acceptance.mjs` :267-279 的做法——`git archive` 固定提交 `dbd1a8a`（可由环境变量覆盖，不写 `HEAD`），范围含 `src`、`scripts`、`skills`、`skills-src`、`test`、`.reviews`、`package.json`、`tsconfig.json`；解包到 mkdtemp；**叠加面只有 `stub.ts` 的 `hang_cli` 一处**（实施时核对 `src/trivium/adapters/stub.ts` 相对 `dbd1a8a` 的 diff 只含这一处；若还有别的，就只叠加这一段补丁）；`node_modules` 软链工作树的副本（不联网）；`node scripts/build.mjs --with-tests`；调用导出目录里的 `skills/dual-critic/scripts/trivium.cjs`，`TRIVIUM_ASSET_ROOT` 指导出目录。
- 两份都**直接以 `node <bundle 路径>` 调用**，不经 `.trivium/bin/trivium`（它指向已安装副本）；evidence 记两份 bundle 的 sha256、来源提交与叠加面，脚本**断言两份 sha256 不同**。

mkdtemp 夹具（桩审查员），组空的判法同 §5.2：

1. **A1**（新构建）两侧 `hang_cli` → `--cancel` → 两组成员数为零；`worker.log` 有转发行；run.json / status.json `cancelled`。
2. **A2**（新构建）一侧 `ignoreTerm` → 同 A1；stderr 不含「未响应 SIGTERM」；`--cancel` 耗时小于 `WORKER_TERM_GRACE_MS - 500`。
3. **A3**（新构建，覆盖不到的格，如实记录）按组 SIGKILL worker → CLI 两组都活着、ppid = 1；随后 `--cancel` 的 stderr 含 §4.3 的如实提示；收尾按组结束。
4. **A4**（旧构建）同 A1 → CLI 两组都活着。
5. **A5** 本条 §2 两个探针重跑（`probe-kill-reach.mjs` K1、`probe-pipe-break.mjs`），读数与计划期一致（它们用的是手搭的 worker，不经 `workerMain`，前提实测不随本主题变化）。
6. **A6** `hang` 桩（进程内挂起）新旧两份构建各走一遍 `--start` / `--cancel`：**stdout 逐行相同**；**stderr 把 pid、run_id、时间戳归一化为占位后逐行相同**；两份原文与归一化结果都进 evidence（GLM-04）。
7. **A7** A1 之后会话启动 Hook：不出现指向该运行的提示。

`npm run check` 全绿（起点 2161 / 2159 / 0 / 2；`lock-cross-process`（EV-149）与 `state.test`「并发 setGate 不丢更新」（EV-153）若偶发红，单跑复核、截失败文案后如实记录），`doctor --selftest` 14/14。全量跑着时不改文档，文档改完重跑一次。验证前从已提交状态构建，由你在终端按 `--targets claude,glm,codex,gemini` 重装（`install` 与 `.trivium/bin` 不写在同一条命令里）。

---

## 6. 文档同步

凡写「worker 收到 SIGTERM 会结束它拉起的 CLI」之处，一律带上「真实 CLI 对 SIGTERM 的处置未实测，不响应时 2 s 后 SIGKILL」这一限定，不写成无条件结论（CODEX-02）。

| 文件 | 位置 | 改成 |
| :--- | :--- | :--- |
| 主设计 → **v1.3.52** | 7.5 `review --cancel` 行（:1470） | 「够不到适配器以 `killTree` 拉起……」改为：工作进程收到 SIGTERM 先按组终止它以 `killTree` 拉起的审查员 CLI（宽限 2 s → SIGKILL → 至多再等 1 s，按父进程句柄判退出；真实 CLI 的信号处置未实测），再以 SIGTERM 退出（v1.3.52，EV-152）；worker 被升级 SIGKILL 或此前已被强杀时够不到，输出如实提示。**单元格保持单行** |
| | 工作进程的说明处（7.5 / AD-03 一带，实施时按「工作进程」「SIGTERM」grep 定位） | 补 worker 的信号语义：只处理 SIGTERM、处理器一执行就冻结经 `run()` 的链路、转发、重新自杀；冻结的保证范围与收尾段窗口；预算关系 |
| | 变更记录 | 加 v1.3.52 行 |
| LLD → **v1.1.10** | `startRun` 第 5 条末句（:237） | 「`--cancel` 够不到……」改为本主题口径 |
| | 已知缺口表「`--cancel` 够不到适配器拉起的厂商 CLI」行（:583） | 改为「worker 被 SIGKILL / 强杀 / 崩溃时够不到」与「取消落在收尾段时归档可能不是 `cancelled`」两格，指向新条目 |
| | worker 主体一节 | 补 SIGTERM 处理器（`exitOnce`、看门狗、卸载）与 `liveTrees` 登记、全 `run()` 冻结的约定 |
| MANUAL → **v1.0.10** | 取消一节「已知缺口」段（:619-621） | 改为：取消时工作进程会先结束它拉起的审查员 CLI；剩下两种情形够不到——stderr 出现「未响应 SIGTERM，发送 SIGKILL」，或「工作进程在本次取消之前已退出」——这时按提示用 `ps` 找 ppid 为 1 的 CLI 手工结束。删去「此前本手册写的……不准确」那句的时效说明，改记版本 |
| PROTOCOL | :360 `review --start / --wait / --status / --cancel` 行 | `--cancel` 那段补一句（同主设计） |
| BACKLOG | EV-152；EV-146 / EV-38 注记；新登 | 见 §8 |
| PRD | — | **核后不改**：PRD 对 `--cancel` 只有 FR-24 的「记 `cancelled`」（:195），没有「取消要结束审查员进程」的需求条目，本主题不改需求面，也不改 FR-24 的判据 |
| run.v2 schema、`termination` 取值、skill 与入口资产、`.reviews/README.md`、CLI 帮助 | — | 不改：本主题不产生新的归档字段；`--cancel` 的调用方式与退出码不变 |

实施时 `git -c core.quotepath=off grep` 反扫「EV-152」「够不到」「自成一组」「killTree」「连同 agy」「含两侧厂商子进程」，面含 `doc/`（排除 evidence 与历史报告）、`skills-src/`、`skills/`、`src/`、`test/`，剩余命中逐条判断是历史说明还是漏改。

---

## 7. 风险与边界

### 7.1 对既有不变量

- **EV-128「取消由 `cancelRun` 收尾」**：有在跑的 CLI 那一格由冻结保证，I1 的 `run.json cancelled` 断言与 M3 守；**收尾段那一格（§4.4 a″）按代码论证、无用例钉住**，如实保留（AGY-04 ≡ GLM-01）。
- **worker 退出形态**：重新自杀后仍是 `signal: SIGTERM`（H1、§2.5），**除走到兜底 `exit(143)` 的病态分支**；由 U9 / M9 守。`settleOrphanedStart` 按句柄判退出，不看信号名，不受影响。
- **取消耗时**：常态不变；有忽略 SIGTERM 的 CLI 时 `--cancel` 最长多等约 3 s，仍在 5 s 宽限之内。
- **Node 的缺省 SIGTERM 行为被接管**：装了监听之后 Node 不再自动退出，所以处理器必须保证走到重新自杀——`finally` + 看门狗 + `exitOnce` 防重入。M5 / M9 守。
- **冻结对全部 `run()` 生效**：日后在 worker 侧新增的 `run()` 调用者（取证、快照复算等）须知晓：终止中它会悬空、不会跑完（CODEX-04）。
- **测试进程**：冻结标志只由 worker 的处理器或 U7 / U9 的子进程置位，测试进程里的 `run()` 不受影响；处理器由 `workerMain` 的 `finally` 卸载。

### 7.2 如实保留

- 覆盖矩阵 b、c、d 格（worker 被 SIGKILL、崩溃、事件循环堵住）：CLI 仍会遗留；`--cancel` 在 b、c 两格给出如实提示。行为修复登新条目（修法 ②，§8）。
- a″ 格（取消落在收尾段）：处理器执行之前至多一次事件循环迭代的推进窗口，最坏归档记非 `cancelled` 或 run.json 与 status.json 劈叉（§4.4）。
- h 格：组长 CLI 已因 SIGTERM 退出、同组有忽略 SIGTERM 的后代时，那个后代漏掉。
- g 格：CLI 自己 `setsid` 出去的后代，哪个方案都够不到。
- **不依赖**真实 CLI 对**写错误**的处置（§2.2 已实测它不可靠）；**依赖**真实 CLI 对 **SIGTERM / SIGKILL** 的语义，对真实厂商 CLI 未实测（D3 定不花配额，本主题跑完也不会有这项证据）；不响应 SIGTERM 时由 2 s 后的 SIGKILL 兜住，代价是 `--cancel` 最多多等约 3 s（CODEX-02）。
- 实测范围只有 Node v25.2.1 / macOS；「移除最后一个监听即恢复缺省处置」「`kill(self)` 返回前即终止」只在这一版本上量过（§2.5），Node 18 未测。

### 7.3 相邻、不在本主题

- **前台同步路径被 Ctrl-C**：`review --stage`（同步）与预检 / `doctor` 的探活（R5）在前台进程里以 `killTree` 拉起 CLI；终端的 SIGINT 发给前台进程组，而 CLI 在自己的会话里，收不到，Node 缺省动作退出后 CLI 被遗弃。按代码推断，未实测；登记（D6）。
- **pty 路径跑不起来**（§2.3）：登记（D6）。

### 7.4 回滚

本主题不产生新的归档字段与取值，回滚即回退代码：`util/exec.ts`（登记、冻结、`shutdownTrackedTrees`）、`run-protocol.ts`（处理器、常量、播报）、`stub.ts` 的 `hang_cli`、U7 / U8 / U9 / I1 / I2；`npm run build`、`npm run check`；由你在终端重装。

---

## 8. BACKLOG 处置

1. **EV-152**：状态改为 done（常态格 a），描述末尾写明 a″ / b / c / d / g / h 格的去向。
2. **新登**：「worker 被 SIGKILL、崩溃或事件循环堵住时，它拉起的审查员 CLI 无人能结束」。候选修法 ②（CLI 进程组记进 status.json 的侧字段 `sides[c].cli: { pid, started_at }`，`--cancel` 在 worker 已不在 / 升级 SIGKILL 之后逐组结束；复用判据：组长活着且启动时刻相符才发组信号），与 EV-146、EV-38 共用这份记录，一并论证。**待验证前提**：真实厂商 CLI 对 SIGTERM 的处置（CODEX-02）。
3. **EV-146**：注记——它的场景（`heartbeat_stale`）多半是事件循环堵住，① 的处理器跑不到，依赖第 2 条的记录。
4. **EV-38**：注记——`cancelRun` 的准入在常态格已名副其实（CLI 先于 worker 退出）；会话启动清扫与 `trivium scrub` 的准入仍只核 worker，依赖第 2 条的记录。
5. **新登（D6）**：前台同步路径被 Ctrl-C 时遗弃 `killTree` 拉起的 CLI（推断，未实测）；`run()` 的 `pty: true` 在管道 stdin 下 `script` 直接退 1（实测，§2.3）。

编号在实施时取下一个空号。

---

## 9. 决策点（2026-09-28 送审前已定：用户定 D1～D7 全部取建议项；计划双审第 1 轮未动任何一条）

**D1 修法选型** — **已定：①**，② 另登并与 EV-146 / EV-38 合并论证（§3.3）。① 收掉常态格 a；覆盖不到 a″（收尾段窗口）、b、c、d、g、h，其中 b、c 两格的 `--cancel` 输出会如实提示。

**D2 进程组号记在哪、怎么防复用** — **已定：本主题不实施；下面这套写进新登条目（§8 第 2 条）作为候选写法**：记进 status.json 的侧字段 `sides[c].cli: { pid, started_at } | null`；worker 在派生 CLI 时写（`run()` 新增 `onSpawn` 回调，经 `AdapterContext` 穿到四个适配器），CLI 退出时清空。防复用沿用 worker 的判据；不新增运行目录文件（C8）；status.json 只有 TS 接口（C9）。

**D3 真实 CLI 实测花不花配额** — **已定：不花**。① 不依赖 CLI 对管道断开的反应；它对 SIGTERM 的处置未实测、由 SIGKILL 兜底（§7.2）。

**D4 EV-146 并不并入** — **已定：不并入**。它要在 `cancelRun` 的终态早退分支开例外；场景多半正是 ① 覆盖不到的「事件循环堵住」，依赖 ② 的记录。

**D5 EV-38 并不并入** — **已定：不并入**。会话启动清扫与 `trivium scrub` 要核 CLI，同样依赖 ② 的记录。

**D6 新登哪几条** — **已定：三条都登**：修法 ② 余项；前台同步路径 Ctrl-C 遗弃 CLI（推断）；`pty: true` 在管道 stdin 下跑不起来（实测）。

**D7 用例构造** — **已定**：桩新增 `hang_cli`（`sh` + `sleep` 两层，可选忽略 SIGTERM，标记带 `out_dir`）；集成用例按组号枚举判组空；`shutdownTrackedTrees` 与处理器的单测在子进程里跑；覆盖不到的 SIGKILL 格只放零配额验收 A3 如实记录，不写成用例。

---

## 10. 流程

1. r2 定稿 → **先提交计划**（`git commit -F <文件>`），推送等你说。
2. 实施、测试、变异、零配额验收 → 报告 `doc/05_testing/REPORT_<日期>_cancel_cli_reach.md`、evidence `cancel-cli-reach-<日期>/`（含 §2 探针与读数）。
3. 你在终端重装 → 你敲 `/dual-review-code`。

---

## 附录：计划双审第 1 轮意见的落点

| 意见 | r2 落点 |
| :--- | :--- |
| CODEX-01 ≡ AGY-01 | §5.4「新旧两份构建」段；A4 叠加 `hang_cli` |
| CODEX-02 | §2.4 末段；§3.2 a 格；§4.4 a 行；§6 首段与主设计行；§7.2；§8 第 2 条；§9 D3 |
| CODEX-03 | §5.2 `hang_cli` 两层的理由、「判组空」段、I1 / I2；§5.4 A1 / A2 |
| CODEX-04 | §4.1「冻结对全部 `run()` 生效」条；§7.1 |
| CODEX-05 | §5.2 I2；§5.4 A2 |
| CODEX-06 ≡ AGY-02 | §2.5；§5.1 U9；§5.3 M9；§7.1；§7.2 |
| AGY-03 | §4.2 第 1～4 步（`exitOnce`） |
| AGY-04 ≡ GLM-01 | §1.2 C3；§1.1 R6；§2.6；§3.2 a″ 行；§4.1「保证范围」条与「不查标志」理由；§4.4 a″ 行；§6 LLD 行；§7.1；§7.2；§8 第 1 条 |
| AGY-05 | §4.1「终止」条；§5.1 U7⑥；§5.3 M10 |
| AGY-06 | §4.2 首段 |
| GLM-02 | §1.2 C3（输出流）；§5.2 I1 / I2 与末条；§5.3 M5；§5.4 A2 |
| GLM-03 | §4.2 导出文档块；§5.1 U9 |
| GLM-04 | §5.4 A6 |
