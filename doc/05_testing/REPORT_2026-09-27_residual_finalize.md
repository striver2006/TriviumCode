# 事后收尾余项 · 实施报告（EV-145）

- **日期**：2026-09-27
- **主题**：`事后收尾余项`；计划 `.reviews/事后收尾余项/plan/`（D1～D7 送审前已定、全取建议项 → 计划双审 run `20260927T052648Z` 三侧 `approve-with-nits`、7 条全接受 → r2 定稿，提交 `a89a46f`；用户审批「修改后实施」）
- **起点**：`a89a46f`（计划 r2 提交）；计划行号取自 `53eaab8`（两者之间只有计划留痕，源码未变）
- **状态**：代码双审 r1（run `20260927T074234Z`）实质意见 9 条全接受，审批「修改后提交」；已按应答件修订（§7）
- **evidence**：`doc/05_testing/evidence/residual-finalize-20260927/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 `termination.by` 扩值 | `types.ts` 导出 `EXCEPTION_TERMINATION_BY`（`worker_exception` / `prepare_exception` / `sync_exception`）与派生的 `ExceptionTerminationBy`，`RunTermination` 第一个形状改用它；run.v2 schema 第一个 `oneOf` 分支的 `by` 由 `const` 改为三值 `enum`，`status` 与 `termination` 的 description 同步；`exit-codes.ts` 新增 `exitCodeOf`（worker `catch` 改用它，四处同源）；`report.ts` `unlistedLabel` 加两句说明 | S1′、S3、V8、V9 |
| §3.2 ① `prepareRun` | `taskLock` 挪到 `try` 之前；`writeRunMeta` 骨架之后置 `skeletonWritten`；`catch` 里先按原样回收闸门，`skeletonWritten` 为真时再调 `finalizeFailedRunMeta`（`workerGone: true`、`prepare_exception`），两步结果经 `finalizeLines(…, '准备阶段失败')` 各打一行 `warn` | P1、P2、P6、B7 追加断言 |
| §3.3 ② `startRun` | `spawnDetached` 新增可选回调 `onSpawned(pid)`（拿到 pid 之后、`finally` 之前调用，回调自身出错被吞）；`startRun` 在回调里置 `childBorn`，主 `catch` 先 `releaseRunningGate`、`childBorn` 为假时收尾（`prepare_exception`）、最后放锁 | P3、P3b、P4、U1 |
| §3.4 ③ 同步路径 | `runReviewLocked` 的 `catch` 在内联闸门回收之后调 `finalizeFailedRunMeta`（`sync_exception`），结果经 `finalizeLines(…, '同步路径异常')` 打出 | P5、P6 |
| §3.6 播报 | `meta.ts` 新增 `describeFinalizeStepWith`（后果半句由调用方传）与 `finalizeLines(fin, runId, scene)`；`run-protocol.ts` 的 `describeFinalizeStep` 改为委托它，字面输出不变 | EV-142 的 W1 / L1 原样绿 |
| §3.7 注释 | `meta.ts` `workerGone` 文档块补第三类调用方；`finalizeFailedRunMeta` 调用方改为五个；通用体文档块的次序规约改写为按「有没有补齐入口」分两种次序（r1 CODEX-01）；`review.ts` `prepareRun` 文档块与段注释、`run-protocol.ts` 主 `catch` 与 `childBorn` 注释、`util/exec.ts` `onSpawned` 文档；`types.ts` `RunMeta.gate` / `status` / `termination` 注释 | — |
| §4 验证 | 见 §2 | — |
| §5 文档 | 见 §4 | 反扫 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次（文档同步之前）**2145 / 2143 / 0 / 2**，一次全绿（起点 2133 → 新增 12 条：S1′、S3、V8、V9、U1、U2、P2、P3、P3b、P4、P5、P6；P1 由 B5 改写、B7 追加断言，不计新增）；变异、契约变异、验收与文档同步之后第 2 次 **2145 / 2143 / 0 / 2**，两次读数相同（`lock-cross-process` 两次都绿，EV-149 没有复现） |
| 受影响套件单跑 | `run-meta-strict` / `report` / `worker-detach` 40 / 40；`gate-loop` 里本主题与 B6 / B7 共 9 / 9 |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并逐条核对唯一） | **11 / 11**（`mutation-output.txt`，基线三个套件全绿）：M1 fail=3、M2 fail=3、M3 fail=2、M4～M6 各 fail=1（以上 `gate-loop.test`，P1 / P3 / P4 / P5）、M7 fail=2（`report.test`，V8 / V9）、M8 fail=1（`gate-loop.test`，P3b）、M9 fail=2（`worker-detach.test`，U1）、M10 fail=1（`gate-loop.test`，B7 追加断言）、M11 fail=1（`worker-detach.test`，U2）。每条只写一个期望套件。**未核实的一格**：装置只记每条的 fail 数、不记失败文案，所以 M3 / M4 / M8 是否恰因目标断言而红（而不是 P3 / P3b / P4 的预建窗口未命中），从读数上分不出；基线同一套件全绿、未变异时这三条用例都命中，按此推断是目标断言，但没有逐条核失败文案（见 §3.3） |
| 契约侧变异（`contract-mutation.mjs`） | **1 / 1**（`contract-mutation-output.txt`）：M12 把 schema 的 `termination.by` 枚举去掉 `prepare_exception` ⇒ S1′ 与 S3 两条红；schema 按哈希恢复。被测产物是 `dist/test/skills/dual-critic/schema/run.v2.json` 这份拷贝（上一主题的教训），脚本断言它确实变了 |
| 零配额验收（`acceptance.mjs`，mkdtemp 夹具、桩审查员；A7 / A8 旧构建基线 `53eaab8`） | **21 / 21**，第 1 次即过（`acceptance-readout.json`）；A7 逐主题比对 53 个主题，`rounds` / `unlistedRuns` 零差异；A8 (i) `53eaab8` 原样构建读新取值为 null、`resolveStageDriver` 判 `corrupt`，(ii) 换上本主题 schema 后可读、Driver 判定 `ok:claude`、`report` 说明落兜底「failed（gate.state=failed）」 |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14 / 14** |
| 环境 | git 2.54.0（Apple Git-157），Node v25.2.1 |

## 3. 偏离与如实登记

### 3.1 实施期发现并修正一处既有缺陷：`spawnDetached` 在 `spawn` 拿不到 pid 时进程崩溃

计划 r2 §3.3 把「`spawn` 没拿到 pid」列为子进程诞生之前的三个失败点之一，要由 `startRun` 的主 `catch` 收尾。写回调时核对这一格：`spawnDetached` 原先在 pid 检查**之后**才挂 `child.once('error', …)`，pid 缺失时直接 `throw`、监听从没挂上；Node 随后异步发出的 `'error'` 没有监听者，成了未捕获异常。实测（scratchpad 里对仓库构建直调 `spawnDetached('/nonexistent/…')`）：调用方的 `catch` 一行都没跑，整个进程以「Unhandled 'error' event」退 1。也就是说这一格在今天连主 `catch` 的回收闸门、放锁都走不到。

改法：把监听挪到 pid 检查之前（一行位置调整，注释写明）；U2 用子进程钉住「抛错被调用方接住、进程不崩」，M11 把监听挪回原位即红。这不在计划 r2 的改动清单里，属实施期计划外修正，代码双审时请一并看。（代码双审 r1 指出这一修正只做了一半——防住了崩溃，却把成因吞掉；修订见 §7 原文 CODEX-01，M11 的形态随之改为「去掉监听」。）

### 3.2 与 r2 文字的小出入

- `exitCodeOf` 放在 `exit-codes.ts`（r2 §3.1 只说「抽成一个小函数」）：它只依赖 `TriviumError` 与 `EXIT`，放在它们旁边，免得 `meta.ts` / `review.ts` / `run-protocol.ts` 互相引。
- `startRun` 里的「子进程已诞生」标志命名为 `childBorn`（r2 伪代码写 `spawned`）：同一作用域里 `spawned` 已是 `spawnDetached` 的返回值。
- U1 / U2 放在 `worker-detach.test.ts`（r2 §4.1 写 U1 一条）：U2 对应 §3.1 的计划外修正。
- 变异表多了 M10（`skeletonWritten` 守卫，r2 §4.3 已写「另列一条进装置」）与 M11（§3.1）；M8 / M9 同 r2。

### 3.3 变异判定的一处缺口

r2 §4.3 写「M3 / M4 / M8 的判定以命中前置断言为前提：若因『预建窗口未命中』而红，按未咬住处理、重跑」。`scripts/mutation-check.mjs` 的输出只有每条的 fail 数，没有失败用例的名字与断言文案，所以这一前提**没法从装置读数上核**。能说的只有：三条的基线都全绿（同一构造、同一窗口下未变异时都命中），变异只改收尾分支、不碰运行目录与 run_id 的生成，窗口命中与否与变异无关——据此推断它们是因目标断言而红。要严格核实，可以对这三条单跑变异版的 `gate-loop.test`、读失败文案；本次没有做，如实记下。咬不住或不可观察、只在代码审核对的两格同 r2：`onSpawned` 挪到 `finally` 之后（只有关日志句柄抛错那一格能区分，构造不出）、闸门回收与收尾的先后（两步之间杀进程才能观察）。

## 4. 文档同步

| 文件 | 落点 |
| :--- | :--- |
| 主设计 → v1.3.50 | 当前版本行；6.7 注记新增「本进程的事后收尾」一段（③准备阶段失败 `prepare_exception`、④同步路径异常 `sync_exception`、次序与尾窗）并改写「已结束却仍为 running」的列举；6.7.1 `termination` 行（三值、单一来源、只增不减与回滚步骤）；7.5 `review --start` 一行；变更记录 v1.3.50 行 |
| PRD → v1.4.14 | 当前版本与文档版本行；变更说明；FR-24 补一句边界 |
| LLD → v1.1.8 | 版本行与变更说明；`startRun` 第 5 条（`onSpawned` 与 `'error'` 监听前移）、第 7 条（诞生前收尾、诞生后不收）；零工件不变式段末句；4.2 引述块（本进程两条收尾、「仍会停在 running」改准）；已知缺口表一行 |
| MANUAL → v1.0.8 | 版本行；场景 4 补「`review --start` 或同步 `review` 自己报错时」一段 |
| PROTOCOL | :60 `termination` 段；`review --start` 流程补一行 |
| run.v2 schema | `status` description、`termination` description 与 `by` 枚举 |
| BACKLOG | EV-145 done；新登 EV-150（`--start` 在子进程诞生之后失败的孤儿 worker）、EV-151（worker 猝死后遗留锁回收时不收尾） |

反扫（`-c core.quotepath=off`，`doc/`、`skills-src/`、`src/`、`test/`）：「EV-145」「登记失败」「如实留 running」「锁与闸门回收排在它之后」「只由 worker 异常分支」剩余命中均为本次新写的说明或历史记录。`.reviews/README.md`、skills-src、CLI 帮助不改（r2 §5）。本仓根 `CLAUDE.md` 不改（EV-138）。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `probe-residual.mjs`、`probe-residual.out.json` | 计划 §2：C1a～C4 夹具实测（实施前构建 `53eaab8`） |
| `gen-mutation-spec.mjs` → `mutation-spec.json`、`mutation-output.txt` | 源码侧变异规格生成、锚点唯一性核对与结果 |
| `contract-mutation.mjs`、`contract-mutation-output.txt` | 契约侧 M12 与结果 |
| `acceptance.mjs`、`acceptance-readout.json` | 零配额验收 A1～A8 |

## 6. 待办

1. ~~用户终端重装 → `/dual-review-code`~~——r1 已过（§7）。
2. 提交（审批附言「修改后提交」）；推送待用户确认。从已提交状态重建，用户重装（`--targets claude,glm,codex,gemini`），复核安装副本一致。

## 7. 代码双审 r1（run `20260927T074234Z`）与修订

三侧：codex **解析降级**（原文自报 `approve-with-nits`，7 条：重要 1、次要 3、吹毛求疵 3；闸门只认降级单元 `CODEX-F01` / `CODEX-F02`）、gemini `approve-with-nits`（1 nit）、glm `approve-with-nits`（1 minor）。实质意见 9 条全接受，同指一组 codex 原文 CODEX-03 ≡ AGY-01 ≡ GLM-01。用户审批「修改后提交」。
应答件 `.reviews/事后收尾余项/code/2026-09-27-事后收尾余项-response-claude.md`（原文 CODEX-01～07 写进裁决表会被闸门判 `unknown_findings`，逐条裁决放在表外第 2 节）。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| 原文 CODEX-01（major） | `util/exec.ts` `spawnDetached`：`'error'` 监听留住错误对象；pid 缺失时等它到达（至多 1 秒）再抛，报错正文为「`spawn 未返回 pid：<可执行文件>（<错误码> <message>）`」，并在关句柄前往 `worker.log` 写同一行；注释改为与实现相符。成因不进归档 | U2 追加两条断言（报错与 `worker.log` 都含 `ENOENT` 与路径）；新增变异 M13 |
| 原文 CODEX-02 | **计划 r2 §3.3 / §6.1 的一条论证不成立**：r2 写「写成终态之后、放锁之前的尾窗里，新 `--start` 可按『运行已终态』接过主题锁，与 worker 收尾后持锁的窗口同形」——那是计划双审 r1 接受 GLM-01 时写进去的。实际两处运行锁（`startRun`、同步路径 `runReview`）获取时都不传 `runId`，锁内容 `run_id` 为 null，`runTerminal(null)` 直接判否，这个判据在尾窗里用不上；新 `--start` 只会退 70。行为保守无害，错的是理由。不改代码，改设计 6.7 注记、`run-protocol.ts` 主 `catch` 注释、LLD 4.2 引述块的说法；计划 r2 已提交，不回改，以本节为准 | 只改文档与注释 |
| 原文 CODEX-03 ≡ AGY-01 ≡ GLM-01 | LLD `startRun()` 与 `prepareRun()` 两节的锚点按修订后代码校准（`run-protocol.ts` :290、:294-307、:327-346、:403-413，`review.ts` :542、:928，`meta.ts` :36），每处附函数或段落名。LLD 其余章节里带行号的引用（如 worker 主体、`--wait`、`executeRun` 漂移复算）同样有漂移，不在本次审查点名范围，未改 | 逐个 grep 核对 |
| 原文 CODEX-04 | BACKLOG EV-147 补一格触发面（准备阶段失败亚秒级完成，同秒重跑覆盖刚写的终态留痕）；设计 6.7 注记补「至多一次终态写入」的这一例外 | — |
| 原文 CODEX-05 | 「`--cancel` / `--wait` 拿不到身份」改为实话（常常拿不到身份；拿到了也没有 pid、判未确认退出；写完已是终态、不追溯改写）：设计 6.7 注记、`meta.ts` `workerGone` 文档块、`run-protocol.ts` 主 `catch` 注释、LLD 4.2 | — |
| 原文 CODEX-06 | `reportFinalizeStep` 改为经 `describeFinalizeStepWith` 出文案，只保留 step / warn 分流，输出字面不变；`describeFinalizeStepWith` 文档块点名三个使用者 | EV-128 的 E 系列（含 E6 写失败告警文案）原样绿 |
| 原文 CODEX-07 | `exit-codes.ts` `usageError = (` 补回空格 | — |

变异规格按修订后代码重生成：M11 的锚点随代码变了，改为「去掉 `'error'` 监听」（与原「挪回 pid 检查之后」同效）；新增 M13（成因不进报错正文）。r1 之前的规格与读数留在 `mutation-spec.r0.json`、`mutation-output.r0.txt`，验收读数留在 `acceptance-readout.r0.json`。

修订后读数：

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | **2145 / 2143 / 0 / 2**，一次全绿（U2 追加的两条断言在既有用例里，不计新增） |
| 源码侧变异（重生成的 `mutation-spec.json`） | **12 / 12**（`mutation-output.txt`，基线三个套件全绿）：M1 fail=3、M2 fail=3、M3 fail=2、M4～M6 各 fail=1、M7 fail=2、M8 fail=1、M9 fail=2、M10 fail=1、M11 fail=1（去掉监听）、M13 fail=1（成因不进报错正文 ⇒ U2 红）。§3.3 的判定缺口照旧 |
| 零配额验收 | **21 / 21**（`acceptance-readout.json`，基线 `53eaab8`；r1 之前的读数留 `acceptance-readout.r0.json`） |
| `doctor --selftest` | **14 / 14** |
