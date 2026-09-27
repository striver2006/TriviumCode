# 派生后失败的孤儿 worker · 实施报告（EV-150）

- **日期**：2026-09-27
- **主题**：`派生后失败的孤儿worker`；计划 `.reviews/派生后失败的孤儿worker/plan/`（D1～D8 送审前已定、全取建议项 → 计划双审 run `20260927T092419Z`：codex / glm `approve-with-nits`、gemini `request-changes`，13 条接受 12、AGY-04 暂缓 → 用户审批通过，附言「AGY-04 并入」→ r2 定稿，提交 `31005b4`）
- **起点**：`31005b4`（计划 r2 提交）；计划行号取自 `e49279a`（两者之间只有计划留痕，源码未变）
- **状态**：代码双审 r1（run `20260927T151757Z`）5 条全接受、审批通过（无附言）；已按应答件修订（§7），未提交
- **evidence**：`doc/05_testing/evidence/orphan-worker-20260927/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.2 子进程句柄 | `util/exec.ts`：新增 `DetachedChildWatch`（`hasExited()` 读 `exitCode` / `signalCode`，`exited` 在 `'exit'` 到达时兑现）；`spawnDetached` 在拿到 pid 之后、调回调之前同步挂 `'exit'` 监听，`onSpawned(pid, watch)` 追加第二个参数 | U3、M7 |
| §3.2 `terminateProcessGroup` | `util/exec.ts` 新增：每次发信号前先问 `isGone()`；SIGTERM 进程组 → 宽限轮询 → `onEscalate` + SIGKILL → 至多 `killWaitMs` 等待；`signal` 可注入（只为单测计数） | U4①～④、M8、M9 |
| §3.2 `cancelRun` 改用 + AGY-04 | `run-protocol.ts`：`cancelRun` 的 SIGTERM / 宽限 / SIGKILL 一段改为调 `terminateProcessGroup`（`graceMs: 5000`、`killWaitMs: 0`、`pollMs: 250`、`onEscalate` 打原 warn）；判据抽成导出的 `workerGoneForCancel`——**不存活或不是同一进程**即算已退出 | 既有 `--cancel` 两条与 EV-128 E1 / E3 / E6 原样绿；U6、M15 |
| §3.4 主 `catch` | `startRun`：`spawnState.born` 在 `onSpawned` 里与 `childBorn` 同时置位（用对象持有，免得控制流分析在 `catch` 里把它收窄成 null）；`workerStartedAt` 提到 `try` 之外；`catch` 里 `born` 在场即交给 `settleOrphanedStart` 后抛原错误，未诞生那一侧一行不改 | P4、P4b、P4c、M1 |
| §3.4 `settleOrphanedStart` | `run-protocol.ts` 新增、导出（`terminate` / `startTimeOf` 可注入）：①终止并按句柄确认；②确认不了退出：补记 `worker_pid` / `worker_started_at`、仍是本进程内容的锁改记到 worker 名下、给出 `--cancel` 出路、不放锁；③回收闸门（终止之后）；④`finalizeFailedRunMeta`（`post_spawn_exception`），worker 已写终态时按 status.json 是否已终态分两种指路；⑤status.json 三分；⑥`release()` + 按 run_id + pid 复核回收已改写的锁。各步吞错打 warn | U5①～④、M2～M6、M11～M14 |
| §3.6 取值面 | `types.ts` `EXCEPTION_TERMINATION_BY` 追加 `post_spawn_exception`（文档块与 `RunMeta.status` / `termination` 注释同步）；`run.v2.json` 的 `by` 枚举、`termination` 与 `status` 两处 description；`report.ts` `unlistedLabel` 加一支 | S1″、S3、V8′、V9；M10；契约 MC1 |
| §3.7 注释 | `run-protocol.ts` `childBorn` 注释、主 `catch` 注释、`cancelRun` 注释与 step 文案（去掉「（含两侧厂商子进程）」）；`util/exec.ts` `killProcessTree` 文档块改准（D7）；`meta.ts` `workerGone` 第四类调用方、调用方六个、次序规约第二组加入本路径；`worker-detach.test.ts`「杀整组」用例注释改准 | 反扫（§4） |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次（文档同步之前）**2159 / 2157 / 0 / 2**，一次全绿（起点 2145 → 新增 14 条：S1″、V8′、U3、U4①～④、U5①～④、U6、P4b、P4c；P4 为改写，不计新增）；变异、契约变异、验收与文档同步之后第 2 次 **2159 / 2157 / 0 / 2**，两次读数相同（`lock-cross-process` 两次都绿，EV-149 没有复现） |
| 受影响套件单跑 | `worker-detach` / `run-protocol` / `run-meta-strict` / `report` 70 / 70；`gate-loop` 里 P1～P6、P4b、P4c、B6、B7 共 11 / 11；每次跑完进程表里没有残留 `review --worker` |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并逐条核对唯一） | **15 / 15**（`mutation-output.txt`，基线四个套件全绿）：M1 fail=3、M2 fail=3、M3 fail=2、M4 fail=1（以上 `gate-loop.test`）、M5 fail=1、M6 fail=1（`run-protocol.test`）、M7 fail=3、M8 fail=2、M9 fail=1（`worker-detach.test`）、M10 fail=2（`report.test`）、M11 fail=2、M12～M15 各 fail=1（`run-protocol.test`）。每条只写一个期望套件 |
| 失败用例名与文案（`mutation-names.mjs`，补上一主题报告 §3.3 的缺口） | M1 / M2 各红 P4、P4b、P4c 三条，M4 红 P4 一条；首行文案分别是「不得留下孤儿 worker」「今天这里会被孤儿置成 review_done_awaiting_disposition」「只应有新一轮的 worker」、M2 的 P4 为 `--cancel` 未见「已处于终态」、M4 为 status.json 的相等断言；三条**都没有**「预建窗口未命中」（`mutation-names-output.json`）。M1 的 P4 报的是 `finally` 里那条——`try` 里的状态断言先红，`finally` 的断言随后抛出、盖掉了前者，两者都是目标断言 |
| 契约侧变异（`contract-mutation.mjs`） | **1 / 1**（MC1）：schema 的 `by` 枚举去掉 `post_spawn_exception` ⇒ S1″ 与 S3 两条红；被测产物是 `dist/test/skills/dual-critic/schema/run.v2.json` 这份拷贝，脚本断言它确实变了；恢复后逐字节核对 |
| 零配额验收（`acceptance.mjs`，mkdtemp 夹具、桩审查员；A6 / A7 基线 `e49279a`） | **13 / 13**（`acceptance-readout.json`）；第 1 次 11 / 13，两条都是验收构造本身的问题，见 §3.4 |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14 / 14** |
| 环境 | git 2.54.0（Apple Git-157），Node v25.2.1，macOS |

## 3. 偏离与如实登记

### 3.1 与 r2 文字的小出入

- **S1″、V8′ 另起用例**：r2 §4.1 写「S1′ / V8 追加」。上一主题的 S1′ / V8 原样保留，新取值的正反例与说明各写成一条独立用例，名字里带 EV-150，失败时能直接看出是哪一个取值的问题。
- **`terminateProcessGroup` 在第一次 SIGTERM 之前也先问一次 `isGone()`**（r2 §3.2 写「每次发信号之前先问」，这里照做）。对 `cancelRun` 来说，这比原来多一次 `processAlive`（原来在前置判断之后直接发 SIGTERM）；若 worker 恰在两次判断之间退出，现在不再向它发 SIGTERM。时序与播报之外没有别的差别；与 AGY-04 那一处收紧一起，都是 `cancelRun` 相对「逐项等价」的偏离。
- **`if (!childBorn)` 保留**：`born` 在场时 `catch` 先行返回，走到这一行时 `childBorn` 恒为假，条件形同恒真；保留它是为了不改动上一主题已审过的这一段，也给「`spawnState` 没置上而 `childBorn` 置上了」这种不应出现的形态留一道防线。
- **P4c 的 `finally` 只做清理、不断言**：`--cancel` 刚发完信号，进程表未必已刷新；残留 worker 的断言放在 P4 / P4b，P4c 只断言「起跑时只有新一轮的 worker」。

### 3.2 实测范围（计划双审 r1 CODEX-04）

§2.1 K1 / K2、U3、U4 都只在 Node v25.2.1 / macOS 上跑过。本机只有这一个 Node（`/opt/homebrew/bin/node`），`engines.node` 声明 `>=18`；**最低支持版本上的 U3 未测**。「句柄未观察到退出 ⇒ 未被回收」依赖的是 libuv 在 SIGCHLD 回调里 `waitpid` 并同步置 `exitCode` / `signalCode` 的语义，不宣称在 Linux 上实测成立。

**失败路径的返回上界**（代码双审 r1 CODEX-02 补）：子进程诞生之后失败时，`--start` 最长约 20 s 才返回——宽限 5 s + SIGKILL 后确认至多 5 s + 确认不了退出时取启动时刻的 `ps`（`processStartTime` 超时 10 s）。skill 对 `--start` 用 Bash 缺省的 120 s 工具超时，覆盖得住；常态（worker 在加载阶段就响应 SIGTERM）是百毫秒级。上界写进了设计 7.5 `review --start` 行，参数不改。

### 3.3 只按代码或守卫论证、没有用例直接钉住的格

- **收尾窗口内被新一轮接管**（计划双审 r1 CODEX-01 ≡ GLM-05）：锁已改写成 worker 内容的那一格，worker 被终止后新 `--start` 可按 `pid_gone` 当场接管锁与闸门。确定的并发时序零配额造不出；U5③ 钉住四道守卫里的第③道（第 6 步不删新持有者的锁、新一轮的闸门不动），其余三道（闸门回收按 run_id、收尾按 run_id、`reclaimStaleLock` 的复验）按代码论证。
- **改写锁、写 status.json、关日志句柄三个失败点**：零配额造不出（计划 r2 §2.3），由 U5 注入覆盖 `settleOrphanedStart` 的各分支；`startRun` 里把它们接到 `settleOrphanedStart` 的那一段，只有 `worker.pid` 这一格被集成用例走到。
- **「孤儿在加载阶段就被终止、来不及拉起审查员」**：按时序推断（计划 r2 §3.3）；P4b 把推断的后果钉成用例（改后 3 秒内 run.json 与闸门都不被改写），推断失守会红。

### 3.4 验收第 1 次 11 / 13：两条都是构造问题

读数留在 `acceptance-readout.r0.json` / `acceptance-output.r0.txt`，改法写进脚本注释：

- **A4**：会话启动报了「59 个运行目录的状态读不到」和「worker.pid 脱敏失败：EISDIR」。前者是验收为命中 run_id 预建的 60 个运行目录里没用上的 59 个（第 1 版到 A3 才撤掉它们，而 A4 跑在 A3 之前）；后者是用上的那个目录里**人为放进去的 `worker.pid` 目录**——凭据清扫现在会按「status.json 终态 + pid 已不在」去处理这次运行（改前 status.json 停在 `running`、没有 pid，清扫从不碰它），读 `worker.pid` 时撞上了这个目录。改为在会话启动之前撤掉这两样，重跑后没有任何提示。真实失败里不会出现「59 个读不到的预建目录」；但「抹除失败」一族告警在权限 / 磁盘类成因下仍可能出现（派生后失败的真实触发面正是本地读写失败），属预期、下次会话启动会重试，不是本主题的回归（代码双审 r1 CODEX-04 改准）。
- **A7 (ii)**：叠上取值面的旧树跑两个套件 30 / 32，红的是 `run-meta-strict` 里「收严回归锁」「收严生效」两条——它们读本仓 `.reviews/` 里的真实留痕，而第 1 版 `git archive` 没带 `.reviews/`。用 `repro-a7.mjs` 复现确认后，导出时带上 `.reviews/`，重跑 32 / 32。S3、V9 两次都是绿的。

### 3.5 其它

- `mutation-names.mjs` 第一版按 `error:` 截失败文案，与 `node --test` 缺省报告器的格式不符，一条都没截到（读数 `mutation-names-output.v1.json`，失败用例名是全的）；第二版改为截每个 ✖ 块之后第一行含 `Error` 的文字，并在整段输出里直接查「预建窗口未命中」，只跑 P4 那组用例。
- 计划期探针 `probe-kill-reach.mjs` 第一版的收尾只结束了 `sh`，留下它名下一个 `sleep 120`（本探针自己的进程，按进程组号核对后结束）；已改为按进程组结束，之后两次运行（含验收 A5）都没有残留。
- LLD：只校准了 `startRun` 一节的四处行号锚点；其余章节（worker 主体、`--wait`）的锚点仍有漂移，未改。

## 4. 文档同步

| 文件 | 落点 |
| :--- | :--- |
| 主设计 → v1.3.51 | 当前版本行；6.7 注记新增 ⑤「派生后启动未完成」、③末句改为指向 ⑤、「已结束却仍为 running」的列举改准；6.7.1 `termination` 行（四值、回滚改为保留取值面）；7.5 `review --start` 与 `review --cancel` 两行；变更记录 v1.3.51 行 |
| PRD → v1.4.15 | 当前版本与文档版本行；变更说明；FR-24 补一句边界 |
| LLD → v1.1.9 | 版本行与变更说明；`startRun` 第 5 条（`onSpawned` 第二参数、`--cancel` 够不到厂商 CLI）、第 7 条（`settleOrphanedStart` 六步）；四处行号锚点；4.2 引述块；已知缺口表 `cancelRun` 一行与新增 EV-152 一行 |
| MANUAL → v1.0.9 | 版本行；取消一节改准并补「已知缺口」；场景 4 补「`--start` 在拉起工作进程之后才报错时」一段 |
| PROTOCOL | :60 `termination` 段；`review --start` 流程补一段 |
| run.v2 schema | `status` 与 `termination` 两处 description、`by` 枚举 |
| BACKLOG | EV-150 done；EV-146 / EV-151 / EV-38 注记；新登 EV-152 |

反扫（`-c core.quotepath=off`，`doc/`、`skills-src/`、`skills/`、`src/`、`test/`，排除 evidence 与历史报告）：「含两侧厂商子进程」「也在同一组里」「孤儿 worker 被杀」「诞生之后才失败的不收尾」「按进程组杀」零命中；「agy / zcode」剩余命中均与本主题无关（探针、轨迹、配置等既有说明）或是本次新写的说明。`.reviews/README.md`、skills-src、CLI 帮助不改（r2 §5）。本仓根 `CLAUDE.md` 不改（EV-138）。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `probe-kill-reach.mjs`、`probe-kill-reach.out.json` | 计划 §2.1：K1（按 worker 组 SIGTERM 够不到 `killTree` 拉起的子进程）、K2（子进程句柄在杀之前 `exitCode` / `signalCode` 为 null，杀之后 `'exit'` 4 ms 到达） |
| `probe-c2b-e49279a.out.json` | 计划 §2.2：上一主题探针 `evidence/residual-finalize-20260927/probe-residual.mjs` 的 C2b 两格在 `e49279a` 上重跑的读数 |
| `focus-check.mjs` | 计划双审送审焦点的 Hook 判据实测 |
| `gen-mutation-spec.mjs` → `mutation-spec.json`、`mutation-output.txt` | 源码侧变异规格生成、锚点唯一性核对与结果 |
| `mutation-names.mjs`、`mutation-names-output.json`（第 1 版读数 `.v1.json`） | M1 / M2 / M4 的失败用例名与首行文案 |
| `contract-mutation.mjs`、`contract-mutation-output.txt` | 契约侧 MC1 与结果 |
| `acceptance.mjs`、`acceptance-readout.json`、`acceptance-output.txt`（第 1 次读数 `.r0`） | 零配额验收 A1～A7 |
| `repro-a7.mjs` | §3.4 A7 (ii) 那两条红的复现 |
| `check-r1.txt`、`check-r1b.txt` | §7 代码双审修订后两次全量的摘要（前者含那条偶发红） |
| `*.r0.*`、`acceptance-*.r1.*` | 代码双审修订之前的规格与读数副本 |

## 6. 待办

1. ~~文档同步之后第 2 次 `npm run check`~~——已跑，读数见 §2。
2. ~~用户终端重装 → 代码双审~~——r1 已过，修订见 §7。
3. 提交等用户说；推送等用户确认。提交后从已提交状态重建、用户终端重装（`--targets claude,glm,codex,gemini`）、复核安装副本一致。

## 7. 代码双审 r1（run `20260927T151757Z`）与修订

三侧：codex `approve-with-nits`（次要 2、吹毛求疵 2）、gemini `approve`（零意见）、glm `approve-with-nits`（次要 1）。5 条全接受，同指一处 CODEX-01 ≡ GLM-01 第（1）点。用户审批通过（无附言）。应答件 `.reviews/派生后失败的孤儿worker/code/2026-09-27-派生后失败的孤儿worker-response-claude.md`。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 ≡ GLM-01（1） | `terminateProcessGroup` 返回 `signals`（实际发过的信号，按顺序）；`settleOrphanedStart` 第 1 步播报四分：没发信号即已退出 ⇒「在被终止之前已自行退出」；发过且已退出 ⇒「已终止工作进程组 N（SIGTERM[、SIGKILL]）」；没确认退出 ⇒「已向工作进程组 N 发送 …，未能确认退出」；终止出错 ⇒ 只保留出错那一行（按句柄判得已退出时补一句「已退出（终止过程出错）」），不再说「已终止」 | U4①～④ 加 `signals` 断言；U5①②④ 加播报断言；新增变异 M16 |
| GLM-01（2） | D5 分支记下改写锁的结果（已改写 / 原本就是 worker 的 / 既非本进程也非 worker 的 / 改写失败），末句只在前两种说「主题锁已记在它名下」，后两种如实说明锁的归属与「本进程退出后可能按 pid_gone 被回收、它若还活着会与新一轮并发」 | U5② 断言成功那一句；新增 U5⑥；新增变异 M18 |
| CODEX-03 | 回读 run.json 为 null（读不出 / 不合契约）判为第三态：第 5 步只补 `worker_pid` / `worker_started_at`、不落 phase，并告警「读不出：status.json 的 phase 不替它下结论，请人工核对」 | 新增 U5⑤；新增变异 M17 |
| CODEX-02 | 不改参数；失败路径约 20 s 的返回上界写进设计 7.5 `review --start` 行与本报告 §3.2 | — |
| CODEX-04 | §3.4 A4 那句改准：「抹除失败」一族告警在真实的权限 / 磁盘类失败下仍可能出现，属预期可重试 | — |

同步：设计 6.7 注记 ⑤（播报、D5 末句、第三态）、7.5 `review --start` 行、变更记录 v1.3.51 行补代码双审一句；LLD `startRun` 第 7 条；MANUAL 场景 4 引用的报错字样与修订后代码一致，未改。

变异规格按修订后代码重生成：M4、M6、M9 的锚点随代码变了（同效），新增 M16～M18；r1 之前的规格与读数留 `mutation-spec.r0.json`、`mutation-output.r0.txt`，契约与失败用例名核对的读数留 `.r0`，验收读数留 `acceptance-readout.r1.json`。

修订后读数：

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次 **2161 / 2158 / 1 / 2**：红的是 `state.test.ts`「并发 setGate 不丢更新（经短临界区串行化，GLM-08）」——本主题没有改 `state.ts`、`lock.ts` 与该用例（`git diff` 为空），单跑连续 5 次全绿，判为满载下的并发锁争用偶发红（与 EV-149 同族：短临界区的重试在满载下耗尽）；**未登记 BACKLOG，是否登记待用户定**（`check-r1.txt`）。第 2 次 **2161 / 2159 / 0 / 2**，一次全绿（`check-r1b.txt`；新增 U5⑤⑥ 两条）。报告 §7 写完之后第 3 次 **2161 / 2159 / 0 / 2**（`check-r1c.txt`） |
| 源码侧变异（重生成的 `mutation-spec.json`） | **18 / 18**（基线四个套件全绿）：M1 fail=3、M2 fail=4、M3 fail=2、M4～M6 各 fail=1、M7 fail=3、M8 fail=2、M9 fail=1、M10 fail=2、M11 fail=2、M12～M18 各 fail=1 |
| 失败用例名与文案 | M1 / M2 / M4 仍各红 P4 系列目标用例，无「预建窗口未命中」 |
| 契约侧变异 | MC1 **1 / 1**（S1″ 与 S3 红） |
| 零配额验收 | **13 / 13** |
| `doctor --selftest` | **14 / 14** |
