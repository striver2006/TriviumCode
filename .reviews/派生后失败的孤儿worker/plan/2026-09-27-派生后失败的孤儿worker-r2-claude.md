# 派生后失败的孤儿 worker 实施计划（r2 定稿）

> **性质**：BACKLOG EV-150，**不属任何里程碑**。上一主题（事后收尾余项，`e49279a`）把 `--start` 在**子进程诞生之前**的失败收尾为 `failed`，诞生之后那一格明确留给本主题：`startRun` 主 `catch` 在 worker 已派生时照样放锁、回收闸门、报失败，而 worker 还在跑。
> **做法（D1）**：子进程诞生之后失败时，`--start` 先按进程组终止这个 worker、**用父进程手里的子进程句柄确认它已退出**，再回收闸门、把骨架收尾为 `failed`（`termination.by` 新增 `post_spawn_exception`，D2）、按形态处理 status.json、最后放锁；确认不了退出时闸门与 run.json 留给它、锁尽力改写成它的，不回收。目标不变量是「**`--start` 非零退出 ⇔ 没有 worker 在跑，锁、闸门、留痕都已收拾好**」，skill 不用改。
> **实测另核出一处既有缺口（§2.1，D7）**：审查员适配器以 `killTree: true` 拉起厂商 CLI，那会让它们自成进程组；`--cancel` 按 worker 的进程组发信号，**够不到**它们。本主题不修这一处行为，只把几处与之不符的说法改准并新登 BACKLOG。
> **决策已定（2026-09-27，送审前）**：用户定 D1～D8 全部取 §7 的建议项。验收零配额。
> **计划双审第 1 轮**（run `20260927T092419Z`）：codex、glm `approve-with-nits`，gemini `request-changes`；13 条接受 12、暂缓 1（AGY-04：与 D3「`cancelRun` 行为逐项等价」冲突，交用户定）。裁决件 `2026-09-27-派生后失败的孤儿worker-revised-claude.md`。用户审批通过，附言「**AGY-04 并入**」——D3 随之改为「除宽限期判据收紧一处外逐项等价」（§3.2、§7 D3）。
> **r2 相对 r1 的改动**：D5 分支补记启动时刻并尽力把锁改写成 worker 的（CODEX-02、AGY-01）；status.json 按「已终态 / 本进程收尾 / worker 已写 run.json 终态」三种形态处理，指路随之分（AGY-02 ≡ GLM-01）；第 6 步论证分「锁未改写 / 已改写」两形态、§3.5 补「收尾窗口内接管主题锁的新一轮」（CODEX-01 ≡ GLM-05）；`cancelRun` 宽限期判据收紧为「不存活或不是同一进程」（AGY-04）；U5 扩到四格、新增 U6，变异加五条、删去「先后不可观察」（AGY-03、GLM-03）；回滚配方改为保留取值面（CODEX-03）；schema `status` 描述与反扫面（GLM-02）；§3.5 status 行措辞（GLM-04）；实测范围注明（CODEX-04）。逐条对应见文末附录。

- **日期**：2026-09-27
- **主题**：`派生后失败的孤儿worker`（`topic claim` plan → claude，2026-09-27）
- **起点**：`e49279a`（`main`）。下文行号均取自该提交的**源码**（不取 `dist/test` 编译产物的行号）
- **上位**：BACKLOG EV-150（本主题）、EV-146（D6，不并入）、EV-151 / EV-147（相邻问题，写用例要避开 EV-147 的秒级撞名）、EV-142 / EV-128（事后收尾的前例与写入前提）、EV-38（准入判据不核 CLI 子进程，与 §2.1 同源）；
  `.reviews/事后收尾余项/plan/` r2（§2.3 实测、§3.3 派生切分、§3.5 写入前提）与代码双审应答件（原文 CODEX-01 的成因、CODEX-02：两处运行锁获取时不带 `run_id`）；
  `doc/05_testing/REPORT_2026-09-27_residual_finalize.md`（§3.1、§3.3、§7）与 `evidence/residual-finalize-20260927/probe-residual.mjs`（C2b 的构造）；
  主设计 v1.3.50、PRD v1.4.14、LLD v1.1.8、MANUAL v1.0.8
- **全量基线**：`npm run check` 2145 / 2143 / 0 / 2（`e49279a`，上一主题报告 §7）

---

## 0. 范围与不做

| 做 | 不做 |
| :--- | :--- |
| `startRun` 主 `catch` 的「子进程已诞生」一侧：终止 worker、确认退出、回收闸门、收尾 run.json 与 task.json 登记、按形态处理 status.json、放锁（含已改写成 worker 内容的那把锁）；确认不了退出时不回收、尽力把锁与 pid 留给它（D1、D4、D5） | EV-151（遗留锁回收时不收尾）、EV-147（run_id 秒级撞名）、EV-148、EV-149；历史留痕回填 |
| `termination.by` 新增 `post_spawn_exception`：schema（只增不减）、`EXCEPTION_TERMINATION_BY`、`report` 说明（D2） | EV-146（D6；本主题抽出的杀进程函数留给它复用） |
| `util/exec.ts`：`onSpawned` 追加第二个参数（子进程句柄的退出观察）；新增按进程组终止并等待退出的函数 `terminateProcessGroup`；`cancelRun` 改用它，**宽限期判据收紧为「不存活或不是同一进程」**，其余逐项等价（D3，AGY-04） | §2.1 那处既有缺口的**行为**修复（worker 被杀时连带结束它以 `killTree` 拉起的厂商 CLI）：新登 BACKLOG（D7） |
| 与 §2.1 不符的几处说法改准：`killProcessTree` 文档块、`cancelRun` 注释与一行播报、LLD `startRun` 第 5 条、MANUAL 取消一节、`worker-detach.test.ts` 一处注释（D7） | `--start` 进程**自己被信号杀掉**（Ctrl-C、被外部 SIGKILL）落在派生与改写锁之间的窗口：那不走 `catch`，本主题管不到（§6.2） |
| 同步主设计、PRD、LLD、MANUAL、PROTOCOL、run.v2 schema（`termination` 与 `status` 两处描述、`by` 枚举）、`types.ts` 注释、BACKLOG | skill 文本、入口资产：不用改（§3.7） |

---

## 1. 现状（逐条对照代码，`e49279a`）

### 1.1 `startRun` 派生前后

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| S1 | 先占运行锁（:295-307），**不传 `runId`**：锁内容 `run_id: opts.runId ?? null`（`lock.ts` :164）为 null，`runTerminal(null)` 直接判否（:302） | `src/trivium/run-protocol.ts` :294-307 |
| S2 | 主 `try`（:371-446）顺序：副本源复查（:372）→ 建运行目录（:373）→ 交接文件（:374）→ status.json（:385，`phase: starting`）→ 定位自身脚本（:388-389）→ **`spawnDetached`**（:390-400，`onSpawned` 里置 `childBorn = true`，:396-398）→ **写 `worker.pid`**（:401）→ **`processStartTime`**（:404）→ **改写锁为 worker**（:405-413：`{ ...lock.content, run_id, pid: worker, pid_started_at }`，`acquired_at` 沿用 `--start` 的）→ **`patchStatus` 记 `worker_pid` / `worker_started_at` / `phase: running`**（:415-419）→ 返回 | 同上 :360-446 |
| S3 | 主 `catch`（:447-470）：`releaseRunningGate`（:449）→ `!childBorn` 时收尾为 `prepare_exception`（:450-467）→ `lock.release()`（:468）→ 原样抛（:469）。**`childBorn` 为真时只回收闸门、放锁、抛**——注释 :366-367 写明「锁与闸门被提前放掉的既有缺陷见 BACKLOG EV-150」 | 同上 :447-470 |
| S4 | 子进程诞生之后的失败点：`spawnDetached` 的 `finally { await handle.close() }`（`exec.ts` :343-346）、写 `worker.pid`（:401）、改写锁（:405）、`patchStatus`（:415）；`processStartTime`（`exec.ts` :386-391）**不抛**，`ps` 失败时返回 null——它不是抛错点，而是「启动时刻可能拿不到」 | `src/trivium/util/exec.ts` :343-346、:386-391 |
| S5 | `lock.release()` 只删「内容仍是自己的」那把锁：比 `pid` 与 `acquired_at`（`lock.ts` :185-190）。**失败点在改写锁之后（`patchStatus` :415）时，锁内容的 `pid` 已是 worker 的，`release()` 不删**——锁留给 worker，worker 正常收尾时在 `finally` 里按 `cur.pid === process.pid` 删（:621-624）。失败点在改写之前时 `release()` 删掉它 | `src/trivium/lock.ts` :182-190；`src/trivium/run-protocol.ts` :610-625 |
| S6 | `spawnDetached` 返回 `{ pid, commandLine }`，不交出子进程句柄；`onSpawned(pid)` 只给 pid（:265、:335-339）。`startRun` 里 `spawned` 只在函数正常返回时有值，`handle.close()` 抛错那一格拿不到它 | `src/trivium/util/exec.ts` :253-347 |
| S7 | `judgeStale` 先判 `processAlive(lock.pid, lock.pid_started_at)`：不存活即 `pid_gone`，存活而不是同一进程即 `pid_reused`，**都排在 `runTerminal` 与心跳判据之前**（:75-81）；`acquireLock` 据此当场回收并重试（:199-213）。所以持锁进程一死，这把锁就可被下一个获取者接管，与锁里有没有 `run_id` 无关（计划双审 r1 CODEX-01 ≡ GLM-05） | `src/trivium/lock.ts` :68-89、:199-213 |

### 1.2 孤儿 worker 与三个事后读者

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| W1 | worker 正常收尾：`writeRunMeta`（review.ts :1687，**无条件写**终态）→ `registerRun`（:1688）→ `setGateChecked(state: success ? review_done_awaiting_disposition : idle, expect: { runId })`（:1696-1705，**只比 run_id、不比状态**）。所以闸门被 `--start` 回收成 `idle`（run_id 仍是本轮）之后，孤儿收尾照样命中、把它置成 `review_done_awaiting_disposition` | `src/trivium/review.ts` :1685-1705 |
| W1′ | status.json 的终态由 `workerMain` 在 `executeRun` **返回之后**写（:553-569）。所以「worker 已跑完」有两种形态：status.json 已是 `success` / `failed`；或 run.json 已终态、status.json 仍是 `running`（计划双审 r1 AGY-02 ≡ GLM-01） | `src/trivium/run-protocol.ts` :551-569 |
| W2 | worker 没有信号处理器（全仓无 `process.on(`）：SIGTERM 即按缺省动作退出，`finally` 不跑 | 全仓 grep |
| W3 | `--cancel`：status.json 或交接文件给身份（:921-924）；status.json 已终态即早退（:933-937）；pid 取 `status.worker_pid ?? worker.pid`（:938-943）；`processAlive(pid, worker_started_at)` 活着且同一进程才杀：SIGTERM 进程组 → 宽限 5 s 每 250 ms 轮询 → 仍活则 SIGKILL，**SIGKILL 之后不等**（:945-964）。**宽限轮询只看 `.alive`、不看 `sameProcess`**（:954、:957）；宽限期内 PID 被复用时，`killProcessTree` 的 `kill(-pid)` 在复用者不是组长时 ESRCH，退回 `kill(pid)`（`exec.ts` :414-416），SIGKILL 会打到无关进程（计划双审 r1 AGY-04）。随后 `workerConfirmedGone` 决定抹凭据副本与收尾（:971、:993-1003）；status.json 由 `patchStatus` 无条件写 `cancelled`（:1005-1009） | `src/trivium/run-protocol.ts` :913-1043 |
| W4 | `--wait`：`fallbackPid` 取 `worker.pid`（:679-684）；判失联时改写前的 status.json 决定 `goneForArchive`（:732-736） | 同上 :671-814 |
| W5 | `workerConfirmedGone`：`phase: starting` 一律判「否」（`status.ts` :159-161）；有 pid 看 `processAlive`；没 pid 时**终态**判「是」，理由写的是「worker 压根没起来（`--start` 早退）」（:176-182），非终态判「否」 | `src/trivium/status.ts` :155-185 |
| W6 | `processAlive(pid, expectedStartedAt)`：`kill(pid, 0)` 判存活；`expectedStartedAt` 为空时**直接判同一进程**（:377）——拿不到启动时刻就没有 PID 复用防护 | `src/trivium/util/exec.ts` :362-383 |
| W7 | 会话启动清扫 `sweepDeadRunningGates`：status.json 没有 `worker_pid` 时要等 `approval_lock_ttl_h` 才回收 `running` 闸门（`hooks.ts` :1722-1733） | `src/trivium/hooks.ts` :1711-1750 |
| W8 | `prepareRun` 置闸门的比较-交换允许从 `running` 迁移（`review.ts` :914 `expect.state` 含 `running`）：新一轮只要拿到主题锁，就能接管一个仍记着旧 run 的 `running` 闸门 | `src/trivium/review.ts` :907-916 |

### 1.3 杀法与进程组

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| K1 | `killProcessTree(pid, sig)`：`kill(-pid)` 按进程组发，失败退回单进程；文档块称 worker 「拉起的 agy / zcode 也在同一组里」（:393-404） | `src/trivium/util/exec.ts` :393-421 |
| K2 | 但 `run()` 在 `killTree: true` 时以 `detached: true` 派生（:115-120），子进程**自成进程组**；四个适配器都这么调：`agy.ts` :113、`codex.ts` :112、`zcode.ts` :499、`claude.ts` :412。`killTree` 由 `2b460ad`（2026-09-12「子进程超时杀整棵树」）引入，晚于 `5476238`（2026-09-11「`--cancel` 按进程组杀」） | `src/trivium/util/exec.ts` :115-120；`src/trivium/adapters/*.ts` |
| K3 | `worker-detach.test.ts` 「killProcessTree 杀整组」（:173）用的子进程是**不带 detached** 的 `spawn`，注释称「这正是 worker → agy/zcode 的形状」（:176-181）——与 K2 不符，所以这条用例一直绿 | `test/integration/worker-detach.test.ts` :173-228 |

### 1.4 会动到的既有测试

| 用例 | 现状 | 本主题 |
| :--- | :--- | :--- |
| `gate-loop.test.ts` :2340 P4「子进程诞生之后才失败 ⇒ 不收尾：刚返回时 run.json 仍是 running」 | 断言 `running`、无 `termination`、stderr 不含「收尾为 failed」（:2348-2350） | **改写**为新 P4（§4.2）：`failed` + `post_spawn_exception`、没有残留 worker |
| `gate-loop.test.ts` :2229 `precreateRunDirs`、:2251 `hitRunId`、:2259 `killWorkersOf` | P3 / P3b / P4 共用 | 沿用，不改 |
| `gate-loop.test.ts` :2304 P3、:2324 P3b | 派生前两格 | 不动（子进程未诞生的一侧一行不改） |
| `worker-detach.test.ts` :246 U1 | 断言 `onSpawned` 的参数等于返回的 pid | 不动（第二个参数是追加的） |
| `worker-detach.test.ts` :173「killProcessTree 杀整组」 | 注释与 K2 不符 | 只改注释（D7），断言不动 |
| `run-protocol.test.ts` :215、:491 与 EV-128 E1 / E3 / E6（:288、:321、:345） | `--cancel` 的杀、收尾与播报 | 不改断言：`cancelRun` 改用 `terminateProcessGroup` 后，除宽限期判据收紧外行为与输出不变（D3），这几条守住；收紧那一处由 U6 守 |
| `run-meta-strict.test.ts` :153 S1′、:169 S3 | 三个异常取值 / 单一来源 | S1′ 追加新取值的正反例；S3 不改（按常量比） |
| `report.test.ts` :492 V8、:503 V9 | 说明文字 / 不落兜底 | V8 追加一格；V9 不改（按常量遍历） |

---

## 2. 实测（只读 / 零配额）

脚本在 Driver 会话 scratchpad，mkdtemp 夹具，收尾只删 mkdtemp 返回值、只结束命令行里带本次随机标记或本次 run_id 的进程（按进程组结束）；实施时拷进 `doc/05_testing/evidence/orphan-worker-<日期>/`，读数一并存档。**实测范围**：Node v25.2.1、macOS（本机唯一的 Node；`engines.node` 为 `>=18`）；不宣称 Linux 上成立（计划双审 r1 CODEX-04）。

### 2.1 杀法够不够得到（`probe-kill-reach.mjs`，K1）

照生产形状搭：`spawnDetached` 派生一个 node「worker」，它用仓库构建的 `run()` 以 `killTree: true`（适配器的写法）与不带 `killTree` 各拉起一个 `sh -c 'sleep 120'`；然后照 `cancelRun` 的杀法 `killProcessTree(worker, 'SIGTERM')`，宽限后看谁还活着。连跑两次读数相同：

| 进程 | 杀前 pgid | 杀后 |
| :--- | :--- | :--- |
| worker | = 自身 pid | 退出（约 150 ms） |
| 不带 `killTree` 的子进程 | = worker pid | 随组退出 |
| **`killTree: true` 的子进程** | **= 自身 pid（自成一组）** | **仍活着，ppid 变成 1** |

结论：`--cancel` 按 worker 进程组发的 SIGTERM **够不到**适配器拉起的厂商 CLI；worker 一死，CLI 自己的超时计时器（在 worker 进程里）也跟着没了。被遗弃的 CLI 会不会因 stdout 管道断开而在下一次写输出时自行退出，取决于该 CLI 对 SIGPIPE / EPIPE 的处理——本探针用的 `sleep` 不写输出，**没有覆盖这一点**；`5476238` 的提交说明记过一次真实观察（被杀 worker 名下的 zcode-cli ppid 变成 1 且继续消耗配额，那时它还在 worker 的进程组里）。这是既有缺口，与 EV-38 同源；对本主题的影响见 §3.3 与 D7。

K2（同一脚本）：父进程以 `detached` + `stdio: ignore` 派生并 `unref()`，杀之前 `exitCode` / `signalCode` 都是 null；`kill(-pid, SIGTERM)` 之后 `'exit'` 事件 4 ms 到达（`signal: SIGTERM`），`kill(pid, 0)` 随即判不存在。`unref()` 不妨碍事件到达（事件循环里有计时器在等）。

### 2.2 `e49279a` 上重跑 C2b（`probe-residual.mjs` 的 C2b 两格，读数 `probe-c2b-e49279a.out.json`）

| 格 | 读数 |
| :--- | :--- |
| ok 桩 | `--start` 退 1（EISDIR `worker.pid`），耗时 289 ms；刚返回时 run.json `running`、闸门 `idle`（run_id 为本轮）、锁已放。**孤儿 worker 在 `finished_at` .307 秒就写完**（run_id 同一秒）：run.json `success`、登记 `success`、两份审查文档齐、闸门 `review_done_awaiting_disposition`；`report` 时间线列这一轮 |
| hang 桩 | `--start` 退 1；运行目录有 `request.json` / `status.json` / `worker.log` / `worker.pid`（目录）；status.json `phase: running`、`worker_pid: null`；孤儿活着 |
| hang 桩，孤儿活着时再 `--start` | 退 0，第二个 worker；两份 run.json 同为第 1 轮、都 `running`；闸门与锁归第二个 |
| 杀掉孤儿后 `--cancel <孤儿 run>` | 退 0，但「凭据副本未抹：运行处于 running 却拿不到 worker_pid」「归档 run-….json 未回写：工作进程未确认退出」「闸门未回收：闸门当前记着 run <第二个>」 |

ok 桩那一格说明：孤儿从诞生到写完终态不到 300 ms。改后 `--start` 在失败点之后立刻发 SIGTERM，那时 worker 还在加载 bundle；用例 P4b 就钉这一点（§4.2）。

### 2.3 零配额造不出的失败点

`worker.pid` 这一格可以造（预建运行目录里放同名目录）；另三格按代码论证、不实测：

- **改写锁**（:405）：锁文件是 `acquireLock` 当场 `link` 进位的，要让随后那次写失败只能在两步之间改权限，是竞速，不可复现；
- **`patchStatus`**（:415）：它与 :385 的 `writeStatus` 写同一个文件、同一种原子写，:385 成功而 :415 失败只剩 I/O 错误；
- **`handle.close()`**（`exec.ts` :345）：有效 fd 上的 `close` 实际不失败。

这三格要单独处理的是：改写锁之后失败时，锁已是 worker 的内容，`lock.release()` 不删（S5）。§3.4 第 6 步专门回收它，用 U5 以注入方式钉住（§4.1）。

---

## 3. 改法

### 3.1 目标不变量

**`--start` 以非零退出码返回时，没有 worker 在跑；锁已放、闸门不再是本轮的 `running`、run.json 与登记是终态。** 唯一的例外是「worker 确认不了退出」（D5），那时闸门、run.json 留给它，锁尽力改写成它的，报错里给出 pid 与出路。

今天这条不变量在子进程诞生之前成立（上一主题），诞生之后不成立（§2.2）。skill 对 `--start` 非零退出的处理是转述并停止（`skills-src/partials/review/body.md` 对预检与 `--wait` 失败都是「原样转述并停止」，`run.contract.md` :148「失败不得宣称成功」；`--start` 没有专门一条，落在同一口径）——不变量成立，这个处理才是对的。

### 3.2 `util/exec.ts`：子进程句柄与终止函数（D3）

**`onSpawned` 追加第二个参数**（第一个参数与调用时点不变，U1 不动）：

```ts
export interface DetachedChildWatch {
  /** 父进程已观察到子进程退出（'exit' 事件已到）。为 false 时子进程尚未被回收，pid 与同号进程组不会被复用 */
  hasExited(): boolean;
  /** 'exit' 事件到达时兑现 */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
onSpawned?: (pid: number, watch: DetachedChildWatch) => void;
```

在拿到 pid 之后、调用回调之前同步挂 `child.once('exit', …)`（'exit' 是异步发出的，同步挂上不会漏）。`hasExited()` 读 `child.exitCode !== null || child.signalCode !== null`。

**PID 复用的依据**：`--start` 是 worker 的父进程。Node 的 libuv 在 SIGCHLD 时 `waitpid` 回收子进程、并在同一回调里把 `exitCode` / `signalCode` 置上并发出 `'exit'`（JS 单线程，两者之间不会插进别的 JS）。所以在 JS 看来「`hasExited()` 为假」⇒ 子进程还没被回收（活着或是僵尸）⇒ 它的 pid、以及以它为组号的进程组号都不可能被别的进程占用。这比比对启动时刻强，也不依赖 `processStartTime`（S4：它可能返回 null）。§2.1 K2 是这一点的实测，范围见 §2 开头（Node v25.2.1、macOS）。

**新增 `terminateProcessGroup`**：

```ts
export async function terminateProcessGroup(pid: number, o: {
  isGone: () => boolean | Promise<boolean>;   // 调用方给「确认已退出」的判据
  graceMs: number;                            // SIGTERM 之后等多久再 SIGKILL
  killWaitMs: number;                         // SIGKILL 之后等多久（0 = 不等）
  pollMs?: number;                            // 缺省 250
  onEscalate?: () => void;                    // 升级到 SIGKILL 前回调（给 cancelRun 打那行 warn）
}): Promise<{ gone: boolean; escalated: boolean }>
```

- 每次发信号之前先问 `isGone()`：已退出就不再发——对「按句柄判」的调用方，这保证不会向一个已回收、可能被复用的号发组信号。
- SIGTERM 进程组 → 每 `pollMs` 问一次、至多 `graceMs` → 仍在则 `onEscalate()` + SIGKILL 进程组 → 至多 `killWaitMs` → 返回 `{ gone: await isGone(), escalated }`。
- **只管 worker 这一组**。`killTree` 拉起的 CLI 在各自的组里，够不到（§2.1）；文档块照实写，不宣称「连同厂商子进程」。

**`cancelRun` 改用它**（D3；AGY-04 按审批附言并入）：`isGone` 抽成导出的小函数 `workerGoneForCancel(pid, startedAt)`——`processAlive(pid, startedAt)` 的结果**不存活或不是同一进程**即判已退出，与 `workerConfirmedGone`、`judgeStale` 的口径一致；`graceMs: 5000`、`killWaitMs: 0`、`pollMs: 250`、`onEscalate` 打原来那行 warn。与 :950-960 相比**唯一的行为变化**是宽限期判据由「只看存活」收紧为「存活且是同一进程」：宽限期内 PID 被复用时不再升级 SIGKILL（W3 那一格）；同样的信号、同样的宽限与轮询间隔、SIGKILL 之后同样不等。`processAlive(...).alive && sameProcess` 的前置判断（:946-947）与「已不存在」那行 step（:962）留在 `cancelRun` 里不动。那行 step 的括号「（含两侧厂商子进程）」按 D7 去掉。

### 3.3 为什么不去杀 `killTree` 拉起的 CLI

孤儿是在失败点之后立刻被终止的：失败点离派生只隔一两次本地写，而 worker 从诞生到拉起审查员要先加载 bundle、重建上下文、写 status.json、进 `executeRun`（§2.2 ok 桩整轮不到 300 ms，其中大半是桩的零耗时审查）。按代码与读数，终止发生时它还没拉起任何 CLI；真实审查员更不可能在这几十毫秒里起来。所以本主题只终止 worker 这一组，**不**为此去追踪 CLI 的进程组——那要让 worker 记下每个 CLI 的 pid（EV-38 已说明这是契约面改动），而且真正受 §2.1 影响的是 `--cancel` 与 EV-146，归新登的 BACKLOG（D7）。这一判断在报告里如实写成「按时序推断，未构造出反例」；推断若失守，P4b 会红（§4.2）。

### 3.4 `startRun` 主 `catch`：子进程已诞生的一侧

`onSpawned` 回调里同时留下句柄：`onSpawned: (pid, watch) => { childBorn = true; born = { pid, watch }; }`（`childBorn` 保留，未诞生那一侧一行不改）。:404 的 `workerStartedAt` 提到 `try` 之外声明（初值 null），供第 2、5 步使用。`catch` 改为：

```ts
  } catch (e) {
    if (born) {
      await settleOrphanedStart({ ctx, rc, lock, born, workerStartedAt, error: e });   // 【新】见下
      throw e;
    }
    await releaseRunningGate(ctx, rc.runId, rc.ref.topic, rc.stage);   // :449 起原样
    …!childBorn 收尾（:450-467）原样…
    await lock.release();
    throw e;
  }
```

`settleOrphanedStart`（`run-protocol.ts` 新增、导出供 U5 注入 `terminate`）按顺序：

1. **终止并确认**：`terminateProcessGroup(born.pid, { isGone: born.watch.hasExited, graceMs: 5000, killWaitMs: 5000 })`；打一行 warn「`--start` 在派生工作进程之后失败：已终止工作进程组 〈pid〉（SIGTERM[，未响应后 SIGKILL]）」。
2. **确认不了退出**（`gone` 为假，D5）：闸门、run.json、status.json 的 phase 一概不动；并尽力（各自吞错、失败打 warn）：
   - 取 `startedAt = workerStartedAt ?? await processStartTime(born.pid)`（此时进程多半还活着，查得到；取不到为 null，如实，CODEX-02）；
   - `patchStatus` 补记 `worker_pid = born.pid`、`worker_started_at = startedAt`（为空时才补），好让 `--cancel` 找得到它、并有复用防护；
   - `inspectLock`：锁内容仍是本进程的（`pid` 与 `acquired_at` 同 `lock.content`）时，改写为 `{ ...lock.content, run_id: rc.runId, pid: born.pid, pid_started_at: startedAt }`——与 :405 同形，让锁跟着这个可能还活着的写者走（AGY-01）；锁已改写成 worker 的则不动；
   - warn「工作进程 〈pid〉 未能确认退出：闸门与归档 run.json 留给它（它若还活着就是写者），主题锁已记在它名下。请 `trivium review --cancel <run_id>`，或手工结束进程组 〈pid〉 之后 `trivium review --wait <run_id>`」；返回，由调用方抛原错误。**不调 `lock.release()`**。
3. **回收闸门**：`releaseRunningGate`（只收「仍是本轮、仍为 running」的条目）。**排在终止之后**——这是 D4 的核心：今天先回收、孤儿后收尾，才出现「闸门 `review_done_awaiting_disposition` 而 Driver 看到启动失败」（§2.2 ok 桩）。worker 已确认退出，此后它不会再动这个条目。
4. **收尾 run.json 与登记**：`finalizeFailedRunMeta({ …, workerGone: true, termination: { by: 'post_spawn_exception', exit_code: exitCodeOf(e) } })`，经 `finalizeLines(fin, runId, '派生后启动未完成')` 各打一行 warn。随后读一次 run.json 定形态，供第 5 步与指路用：
   - **本进程收尾**：第一步写成（`written`），或 run.json 已是 `failed` + `post_spawn_exception`；
   - **worker 已写终态**：run.json 是终态且不是上一种（worker 在被终止之前跑完了）——按前提 4 跳过、不追溯改写，并追加一行指路：status.json 已终态时「工作进程在被终止之前已跑完：用 `trivium review --wait <run_id>` 取结果」；status.json 仍非终态时「工作进程在被终止之前已写下归档终态（〈status〉），审查文档已落盘，以归档 run.json 为准；此时 `--wait` 会判失联（`pid_gone`），但不改写 run.json」（AGY-02 ≡ GLM-01）；
   - **读不到或仍 `running`**（收尾单步写失败）：按 `finalizeLines` 的告警处理，第 5 步按「本进程收尾」走。
5. **status.json**（尽力，吞错并 warn）——三分（AGY-02 ≡ GLM-01）：
   - **已是终态** ⇒ 不动（终态不追溯改写；worker 写下的 `success` / `failed` 保留）；
   - **非终态、run.json 属「本进程收尾」** ⇒ 落 `phase: failed`、`exit_code`、`message`（「启动未完成：已终止工作进程 〈pid〉」），`worker_pid` 为空时补 `born.pid`、`worker_started_at` 为空时补 `workerStartedAt`（失败点在 :404 之前或 `ps` 取不到时仍为 null）；
   - **非终态、run.json 属「worker 已写终态」** ⇒ 只补 `worker_pid` / `worker_started_at`，不落 phase——phase 该由 worker 写，本进程不替它下结论；之后的 `--wait` 走既有失联路径（`pid_gone`），其收尾按前提 4 跳过 run.json。

   落 `failed` 之后，`--wait` 直接按终态返回、`--cancel` 按终态早退，不会再走「失联」「未确认退出」那些绕路；会话启动的凭据清扫也能按「终态 + pid 已不在」判定可抹（W5：`starting` 永远不抹）。
6. **放锁**：`lock.release()`（锁仍是 `--start` 的内容时删掉）；再 `inspectLock`，若内容已被改写成本轮 worker 的（`run_id === rc.runId && pid === born.pid`，即失败点在 :405 之后，S5），照 `cancelRun` :1015-1020 同形 `reclaimStaleLock`（rename → 复验 → 删除）。放锁排在最后，但**它的排他力只在一种形态下成立**（CODEX-01 ≡ GLM-05）：
   - **锁仍是本进程的内容**（失败点在 :405 之前）：持锁进程（本进程）活着、锁里没有 run_id，收尾期间新 `--start` 拿不到锁即退 70，保守无害；
   - **锁已改写成 worker 的**（失败点在 :405 之后）：第 1 步终止 worker 后，锁的持有 pid 已死，并发的新 `--start` 可按 `pid_gone` 当场接管（S7）、并经比较-交换接管闸门（W8），与本进程第 3～6 步交错。不串写的依据见 §3.5 新增的一行；第 6 步的 `inspectLock` 条件对新持有者不成立，不会删它的锁。

**不在这里抹凭据副本**：按 §3.3 终止时还没有副本；万一有，第 5 步写成的「终态 + pid」让会话启动清扫按既有准入判据处理（`workerConfirmedGone` → `processAlive`）。不给 EV-20 再加一个挂载点。

### 3.5 写入前提逐步论证

| 写入 | 写者 | 为什么这一刻没有第二个写者（或有也不串写） |
| :--- | :--- | :--- |
| 闸门（第 3 步） | `--start` | worker 已按句柄确认退出（`'exit'` 已到）；`--cancel` 的回收是 `expect: { runId }` 的幂等 `idle`；清扫只收 `running` 且 worker 判死的条目；三者写的都是「本轮 running → idle」，谁先到都一样。新一轮若已接管，条目的 run_id 已不是本轮，`releaseRunningGateEntry` 按 run_id 跳过 |
| run.json / 登记（第 4 步） | `--start` | `workerGone: true` 的依据是第 1 步的句柄确认，不是推断；第一步在主题任务锁里读、判、写，`--cancel` / `--wait` 若同时到，谁先到记谁；run.json 已终态（worker 自己写的、或别的事后写者抢先写的）一律跳过；新一轮写的是自己 run_id 的 run.json 与登记条目 |
| status.json（第 5 步） | `--start` | worker 已退出；已终态不动。`patchStatus` 只在同进程内串行，跨进程可能与 `--cancel`（无条件写 `cancelled`）或 `--wait`（写 `failed`）交错——**后写者胜出可能让 phase 在 `cancelled` / `failed` 间取其一、message 随之；「已终态」这一结论与 run.json 的内容不受影响**（GLM-04）；status.json 在运行目录里按 run_id 分开，新一轮不碰它 |
| 锁（第 6 步） | `--start` | `release()` 与 `reclaimStaleLock` 都先核内容再删，不会删掉新持有者的锁 |
| **收尾窗口内接管主题锁的新一轮**（CODEX-01 ≡ GLM-05） | 并发的新 `--start` | 只在「锁已改写成 worker 的」一格出现（§3.4 第 6 步）。四道既有守卫保证两轮不串写：①闸门回收 `expect` 本轮 run_id 且 `running`（被新一轮接管后跳过）；②run.json 收尾与登记同步按 run_id 键；③第 6 步 `inspectLock` 要求 `run_id` 与 `pid` 都是本轮 worker 的；④`reclaimStaleLock` rename 之后复验内容、不符放回。这一窗口零配额造不出确定的时序，U5③ 钉住③，其余按守卫论证，实施报告如实写明 |

`meta.ts` `FinalizeInput.workerGone` 的文档块（:548-556）补第四类调用方：「`--start` 在子进程诞生之后失败时传 true——依据是父进程按子进程句柄观察到的退出，不是推断」。

### 3.6 `termination.by` 扩值（D2）

- `types.ts` :1264 `EXCEPTION_TERMINATION_BY` 追加 `'post_spawn_exception'`，文档块（:1255-1263）补一句：「`--start` 派生工作进程之后启动未完成，工作进程已被终止并确认退出；它可能已做了一部分准备，按时序推断还没有拉起审查员（§3.3）」。
- schema `run.v2.json` :487 `by` 枚举追加同一值，:480 `termination` description 同步；**只增不减**。:471 `status` description 里「--start 在子进程诞生之后才失败而孤儿 worker 被杀」改为「本版以前 --start 在子进程诞生之后才失败的运行、确认不了工作进程退出的那一格」（GLM-02）。
- `report.ts` `unlistedLabel`（:420-440）加一支：「派生工作进程之后启动未完成，工作进程已终止（退出码 N）」。
- S3 / V9 按常量比、按常量遍历，常量加值即覆盖；S1′ 与 V8 各追加一格（§4.1）。

### 3.7 注释、播报与 skill

| 位置 | 改法 |
| :--- | :--- |
| `run-protocol.ts` :361-369 `childBorn` 注释 | 「为真：……不收尾……见 BACKLOG EV-150」改为「为真：终止 worker 并确认退出后收尾（`post_spawn_exception`），见 `settleOrphanedStart`」 |
| `run-protocol.ts` :448 主 `catch` 首行注释 | 补派生后一侧的次序（终止 → 闸门 → 收尾 → status.json → 锁）与理由 |
| `run-protocol.ts` :869-874 `cancelRun` 文档块、:948-949 | 「按进程组……含两侧厂商子进程」改为只说 worker 这一组，并指向新登 BACKLOG（D7）；step 文案去掉「（含两侧厂商子进程）」；宽限期判据收紧的理由（AGY-04） |
| `util/exec.ts` :393-404 `killProcessTree` 文档块 | 「它拉起的 agy / zcode 也在同一组里」改为：worker 进程内不带 `killTree` 的子进程在同一组；适配器以 `killTree` 拉起的 CLI 自成一组，按 worker 组发的信号够不到它们（§2.1，新登 BACKLOG） |
| `util/exec.ts` `SpawnDetachedOptions.onSpawned` 文档块 | 第二个参数的语义与「未回收即不复用」的依据 |
| `meta.ts` :548-556、:570-575、:620-626 | `workerGone` 第四类调用方；`finalizeFailedRunMeta` 调用方由五个变六个；次序规约的第二组（「先回收闸门再收尾」）加入本路径，并注明它有 status.json 但补齐入口不可靠（pid 可能没落盘），所以按第二组排 |
| `status.ts` :176-182 | 「终态且从未记下 pid ⇒ worker 压根没起来（`--start` 早退）」在本主题之后仍成立（第 5 步落 `failed` 时会补记 pid），不改 |
| skill 与入口资产 | **不改**：`--start` 非零退出仍是「原样转述并停止」，不变量（§3.1）保证那时没有东西在跑；报错下方多出的几行 warn 随原样转述带出 |

### 3.8 改前 / 改后

| 格 | run.json | 登记 | 闸门 | 锁 | worker | status.json |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ok 桩 今天 | `running` → 孤儿写成 `success` | → `success` | `idle` → 孤儿置 `review_done_awaiting_disposition` | 已放 | 跑完 | 孤儿写 `success` |
| ok 桩 改后 | `failed` + `post_spawn_exception` | `failed` | `idle` | 已放 | 已终止 | `failed` |
| hang 桩 今天 | `running`（永久） | `running` | `idle` | 已放（可再起第二个 worker） | 活着 | `running`、无 pid |
| hang 桩 改后 | `failed` + `post_spawn_exception` | `failed` | `idle` | 已放 | 已终止 | `failed`、有 pid |
| 锁已改写后失败 今天 | `running` | `running` | `idle` | **留给孤儿** | 活着 | `running` |
| 锁已改写后失败 改后 | `failed` + `post_spawn_exception` | `failed` | `idle`（或已被新一轮接管） | 按 run_id 回收（或已被新一轮接管） | 已终止 | 尽力 `failed` |
| worker 在终止前已跑完、status.json 已终态 | worker 写的终态 | worker 写的 | worker 置的 | 已放 | 已退出 | 不动 |
| worker 在终止前已写 run.json、status.json 未终态 | worker 写的终态 | 视 worker 走到哪一步 | 若仍本轮 `running` 则 `idle` | 已放 | 已终止 | 只补 pid，不落 phase |
| 确认不了退出（D5） | 不动 | 不动 | 不动（仍 `running`） | 尽力改写为 worker 的 | 可能活着 | 尽力补 pid 与启动时刻 |

---

## 4. 验证

### 4.1 单测

- **S1′ 追加**（`run-meta-strict.test.ts` :153）：`{ by: 'post_spawn_exception', exit_code: 1 }` 通过；缺 `exit_code`、带 `reason`、带自由文本不通过。
- **V8 追加**（`report.test.ts` :492）：`failed` + `post_spawn_exception` ⇒ 说明为「派生工作进程之后启动未完成，工作进程已终止（退出码 1）」。
- **U3**（`worker-detach.test.ts`）：`spawnDetached` 派生一个长睡子进程，`onSpawned` 的第二个参数 `watch`：杀之前 `hasExited()` 为假；`killProcessTree(pid, 'SIGTERM')` 之后 `watch.exited` 在 3 s 内兑现、`signal` 为 `SIGTERM`、`hasExited()` 为真。第一个参数仍等于返回的 pid。
- **U4**（同文件）：`terminateProcessGroup`——①普通子进程：SIGTERM 即退、`{ gone: true, escalated: false }`；②忽略 SIGTERM 的子进程（`process.on('SIGTERM', () => {})`）、`graceMs: 300`：升级 SIGKILL、`{ gone: true, escalated: true }`、`onEscalate` 恰调一次；③`isGone` 恒假的桩判据、`killWaitMs: 300`：在 `grace + killWait + 余量` 内返回 `{ gone: false }`，不挂住；④`isGone` 一开始就为真：一个信号都不发（对一个已退出、已回收的子进程调用，断言无异常且信号计数为 0）。
- **U5**（`run-protocol.test.ts`，进程内夹具，注入 `terminate`）：`settleOrphanedStart`——
  - ①注入「已退出」、锁内容预置为本轮 worker 的（`run_id` 相符、`pid` 为假 worker pid）：**`terminate` 桩被调用时断言闸门仍为本轮 `running`**（AGY-03）；之后锁文件被回收、闸门 `idle`、run.json `failed` + `post_spawn_exception`、status.json `failed`；
  - ②注入「未确认退出」、锁内容是本进程的：闸门仍为本轮 `running`、run.json 仍 `running`、status.json phase 不变；**status.json 的 `worker_pid` 为 `born.pid`、`worker_started_at` 为注入的时刻**（GLM-03）；**锁内容已改写为 `{ run_id: 本轮, pid: born.pid, pid_started_at: 注入的时刻 }`**（AGY-01）；stderr 含 pid 与 `--cancel` 出路；
  - ③注入「已退出」、锁内容预置为**另一轮**的新持有者：第 6 步不删它（CODEX-01 ≡ GLM-05）；
  - ④注入「已退出」、run.json 与 status.json 都预置为 worker 写下的 `success`：run.json 不改、status.json 逐字段不变、stderr 含「用 `trivium review --wait` 取结果」（AGY-02 ≡ GLM-01）。
- **U6**（`run-protocol.test.ts`）：`workerGoneForCancel(pid, startedAt)`——对本进程 pid 传一个错的启动时刻 ⇒ 判已退出（存活但不是同一进程）；传真实启动时刻 ⇒ 判未退出；传不存在的 pid ⇒ 判已退出（AGY-04）。

### 4.2 集成（真实 CLI + 桩）

沿用上一主题的构造：`precreateRunDirs`（60 秒窗口，预建目录里放一个名为 `worker.pid` 的目录）、`hitRunId`（命中前置断言，不命中以「预建窗口未命中」失败、不进后续断言）、`killWorkersOf`（按预建集合里的 run_id 从进程表结束残留 worker，**放在 `finally`**，命中断言失败时也执行）。闸门比条目字段、不比 state.json 字节。两次运行之间隔 1.1 s（EV-147）。

- **P4**（`gate-loop.test.ts` :2340，改写；hang 桩）：`--start` 退 1；命中后：run.json `failed`、`gate.state: failed`、`termination` 深相等 `{ by: 'post_spawn_exception', exit_code: 1 }`；登记 `failed`；闸门 `idle`；锁已放；status.json `phase: failed` 且 `worker_pid` 非空；stderr 含「已终止工作进程组」与「收尾为 failed（派生后启动未完成）」；随后 `review --wait <run>` 按终态返回（退 1、不含「失联」）、`review --cancel <run>` 说「已处于终态」；`finally` 里 `killWorkersOf` 返回 `[]`（断言：没有残留 worker——今天这里会找到一个）。
- **P4b**（同文件，ok 桩，同一构造）：`--start` 退 1；命中后**等 3 秒**：闸门仍为 `idle`（今天会被孤儿置成 `review_done_awaiting_disposition`）、run.json 仍 `failed`（今天会变 `success`）、阶段目录里没有审查文档（只有原稿）；`finally` 里 `killWorkersOf` 返回 `[]`。
- **P4c**（同文件，hang 桩）：P4 之后撤掉其余预建目录、隔 1.1 s 再 `--start` ⇒ 退 0；进程表里本主题只有这一个 worker（今天会是两个）；收尾 `--cancel` 它。
- 既有须保持绿：P1～P3b、P5、P6、B5～B7；EV-142 的 W / L / X 系列；EV-128 的 E 系列与 `--cancel` 两条（`run-protocol.test.ts` :215、:491）；`worker-detach.test.ts` 全部；`no-artifacts.test.ts` 全部；会话启动清扫两条。

### 4.3 变异（`scripts/mutation-check.mjs`；规格由生成脚本从源码截锚点并逐条核对唯一，照搬 `evidence/residual-finalize-20260927/gen-mutation-spec.mjs`）

每条只写一个期望套件；find 锚点写完代码后再定。P4 / P4b 类的判定以命中前置断言为前提；上一主题报告 §3.3 记下的缺口（装置只记 fail 数、不记文案）本主题补上：对 M1、M2、M4 三条另跑一次变异版的单套件，把失败用例名与首行文案存档，确认是目标断言而红。

| # | 变异 | 期望套件（应红的用例） |
| :-- | :--- | :--- |
| M1 | 主 `catch` 去掉「子进程已诞生」分支（回到今天：只回收闸门、放锁） | `gate-loop.test`（P4） |
| M2 | `settleOrphanedStart` 不终止、直接当已退出往下走 | `gate-loop.test`（P4b：孤儿跑完改写 run.json 与闸门） |
| M3 | 收尾时 `by` 写成 `prepare_exception` | `gate-loop.test`（P4） |
| M4 | 去掉第 5 步 status.json 落终态 | `gate-loop.test`（P4：status.json 与 `--wait` 断言） |
| M5 | 去掉第 6 步按 run_id 回收已改写的锁 | `run-protocol.test`（U5①） |
| M6 | D5 分支照样回收闸门 | `run-protocol.test`（U5②） |
| M7 | `hasExited()` 恒返回 false | `worker-detach.test`（U3） |
| M8 | `terminateProcessGroup` 不升级 SIGKILL | `worker-detach.test`（U4②） |
| M9 | `terminateProcessGroup` 发信号前不问 `isGone()` | `worker-detach.test`（U4④） |
| M10 | `unlistedLabel` 去掉 `post_spawn_exception` 分支 | `report.test`（V8） |
| M11 | 闸门回收挪到终止之前（AGY-03） | `run-protocol.test`（U5①） |
| M12 | 去掉 D5 分支补记 `worker_pid` / `worker_started_at`（GLM-03） | `run-protocol.test`（U5②） |
| M13 | 去掉 D5 分支改写锁（AGY-01） | `run-protocol.test`（U5②） |
| M14 | 第 5 步不判 status.json 已终态（AGY-02 ≡ GLM-01） | `run-protocol.test`（U5④） |
| M15 | `workerGoneForCancel` 退回只看存活（AGY-04） | `run-protocol.test`（U6） |

契约侧：schema 的 `by` 枚举去掉 `post_spawn_exception` ⇒ S1′ 与 S3 红，另写契约变异脚本，被测产物是 `dist/test/skills/dual-critic/schema/run.v2.json` 这份拷贝（脚本断言它确实变了）。
只在代码审核对的：`cancelRun` 改用 `terminateProcessGroup` 之后其余部分的等价性由 E 系列与两条 `--cancel` 用例守，不另设变异；「收尾窗口内被新一轮接管」的时序按 §3.5 的守卫论证（U5③ 钉住第③道）。

### 4.4 零配额验收

scratchpad 脚本搭 mkdtemp 夹具（仓库构建的 CLI、`TRIVIUM_ASSET_ROOT` 指工作树、桩审查员），沿用 §2 的构造：

1. A1 hang 桩派生后失败 ⇒ run.json / 登记 `failed` + `post_spawn_exception`、闸门 `idle`、锁已放、status.json `failed` 有 pid、进程表里没有该 run_id 的 worker；`--wait` 按终态返回、`--cancel` 说已处于终态、run.json 不再被改。
2. A2 ok 桩派生后失败 ⇒ 3 秒后闸门仍 `idle`、run.json 仍 `failed`、没有审查文档（今天是 §2.2 第一行）。
3. A3 A1 之后隔 1.1 s 正常 `--start` ⇒ 只有一个 worker，正常跑完；`report` 时间线只列这一轮，未进时间线表一行「派生工作进程之后启动未完成……」。**预期先按代码核实**：`report` 按审查工件枚举轮次，这一行的轮次号与说明以实施时读数为准。
4. A4 会话启动 Hook ⇒ 不再有指向那次失败运行的「运行目录的状态读不到」「双审进行中」提示（status.json 已终态、锁已放；与读数不符即如实改写）。
5. A5 §2.1 K1 重跑一遍，读数不变（本主题不改那一格的行为，如实保留，指向新登 BACKLOG）。
6. A6 本仓归档只读：新旧两份构建逐主题跑 `buildTopicReport`，`rounds` 与 `unlistedRuns` 逐主题深相等（本仓历史里没有新取值）。旧构建基线用固定提交 `e49279a`（可由环境变量覆盖），不写 `HEAD`。
7. A7 回滚演练（CODEX-03 改写）：从 `e49279a` 导出源码两份——(i) 原样；(ii) 叠上本主题的**取值面**四处（`run.v2.json` 的枚举与两处描述、`types.ts` 常量与文档块、`report.ts` 那一支、`run-meta-strict.test.ts` / `report.test.ts` 的新增格）。(ii) 构建后跑 `run-meta-strict` 与 `report` 两个套件须全绿（S3 / V9 不红）；两份各读同一份 `termination: { by: 'post_spawn_exception', exit_code: 1 }` 的 run.json：(i) `readRunMeta` 返回 null、以它为最新留痕时 `resolveStageDriver` 判 `corrupt`；(ii) 可读，`report` 说明为本主题那一句。

证据放 `doc/05_testing/evidence/orphan-worker-<日期>/`（含 §2 两个探针与读数），报告 `doc/05_testing/REPORT_<日期>_orphan_worker.md`。报告写明实测范围（Node 版本、平台）；若实施时能取得最低支持版本 Node 18，就在它上面补跑 U3 并存读数，取不到如实记为未测（CODEX-04）。验证前从已提交状态构建，由用户在终端按 `--targets claude,glm,codex,gemini` 重装（`install` 与 `.trivium/bin` 不写在同一条命令里）。`npm run check` 全绿（起点 2145 / 2143 / 0 / 2；`lock-cross-process` 若偶发红，单跑复核后按 EV-149 如实记录），`doctor --selftest` 14/14。全量检查跑着时不改文档；文档改完重跑一次。

---

## 5. 文档同步

| 文件 | 位置 | 改成 |
| :--- | :--- | :--- |
| 主设计 → **v1.3.51** | 6.7 注记「本进程的事后收尾」段（:1130-1133） | ③的末句「诞生之后才失败的不收尾（worker 活着、会自己写终态，BACKLOG EV-150）」改为新增⑤**派生后启动未完成**：先按进程组终止 worker、以父进程的子进程句柄确认退出，再回收闸门、收尾（`post_spawn_exception`）、按形态处理 status.json（已终态不动）、放锁（含按 run_id 回收已改写成 worker 的锁）；确认不了退出时闸门与 run.json 不动、锁与 pid 尽力记在 worker 名下 |
| | 同段（:1135）「已结束却仍为 running」的列举 | 「`--start` 在子进程诞生之后才失败而孤儿 worker 被杀（EV-150）」改为「本版以前 `--start` 在子进程诞生之后才失败的运行、以及确认不了工作进程退出的那一格」 |
| | 6.7.1 `termination` 行（:1190） | `by` 取值加 `post_spawn_exception`；单元格保持单行 |
| | 7.5 `review --start` 行（:1466） | 句末补「子进程诞生之后失败时先终止工作进程并确认退出，再收尾为 `failed`（`post_spawn_exception`，v1.3.51）」；单元格单行 |
| | 7.5 `review --cancel` 行（实施时按 grep 定位） | 若写有宽限期判据或「含厂商子进程」，按 §3.2 / D7 改准；单元格单行 |
| | 变更记录 | 加 v1.3.51 行（含 `cancelRun` 宽限期判据收紧、§2.1 缺口改准说法与新登 BACKLOG） |
| PRD → **v1.4.15** | 变更说明；FR-24（:195） | 只补边界：`review --start` 在拉起工作进程之后启动未完成的运行，工作进程被终止后同样记 `failed`。不新增需求、不改判据 |
| LLD → **v1.1.9** | `startRun` 第 5 条（:236） | 补 `onSpawned` 第二个参数；末句「worker 自成进程组，`--cancel` 才能按进程组杀掉 agy/zcode」改准（D7） |
| | `startRun` 第 7 条（:238） | 「诞生之后才失败的不收尾……（锁与闸门被提前放掉见 BACKLOG EV-150）」改为 §3.4 的六步 |
| | 4.2 引述块（:471） | 「仍会停在 `running` 的」去掉 EV-150 那一格、补 D5 那一格 |
| MANUAL → **v1.0.9** | 取消一节（:617） | 「按进程组杀掉 worker 及其拉起的 agy/zcode」改准（D7） |
| | :633 | 「`--start` 在审查员已被拉起之后才报错的少见情形不在此列……见 BACKLOG EV-150」改为：`--start` 在拉起工作进程之后才报错时，会先终止它再同样标为 `failed`（`post_spawn_exception`）；报错里若写「未能确认退出」，按提示 `--cancel` |
| PROTOCOL | :60 `termination` 段；:256 `review --start` 流程 | 同主设计 |
| run.v2 schema | `status` description（:471）、`termination` description（:480）与 `by` 枚举（:487） | 同 §3.6（GLM-02） |
| `types.ts` | :1255-1264 | 同 §3.6 |
| BACKLOG | EV-150；EV-146 / EV-151 / EV-38 注记；新登一条 | 见 §6.4 |
| `.reviews/README.md`、skills-src、CLI 帮助 | — | 不改：前两者没有描述这一格；帮助只讲退出码 |
| 本仓根 `CLAUDE.md` | — | **不改**（EV-138） |

实施时 grep 反扫「EV-150」「诞生之后」「孤儿」「含两侧厂商子进程」「agy/zcode」「按进程组杀」「prepare_exception」「termination」，带 `-c core.quotepath=off`，面含 `doc/` 全部与 `skills-src/`、**`skills/`**（GLM-02）、`src/`、`test/`，剩余命中逐条判断是历史说明还是漏改。

---

## 6. 风险与边界

### 6.1 对既有不变量

- **EV-133「收尾后不再更新」/ 至多一次终态写入**：第 4 步只在仍为 `running` 时写，且在主题任务锁里判与写；worker 已确认退出，不会有它的后写。status.json 同样「已终态不动」（第 5 步）。EV-147 的同秒覆盖照旧是已知例外。
- **`workerGone: true` 的依据**：由「本进程里的推断」（上一主题三格）变成「父进程观察到的子进程退出」，更强；但它只覆盖 worker 进程本身，不覆盖 `killTree` 拉起的 CLI（§2.1、§3.3）。
- **收尾窗口内的并发接管**（CODEX-01 ≡ GLM-05）：锁已改写成 worker 的那一格，worker 被终止后新 `--start` 可当场接管锁与闸门，与本进程的收尾交错；按 §3.5 的四道守卫不串写。今天这一格的锁一直留给活着的孤儿，改后变成「收尾期间可被接管」——回收时机确实变早了，但被接管时孤儿已不在。
- **提交锚**：只改 run.json 三格加 `termination`，`artifacts[]` 原样（同上一主题）。
- **`--start` 的耗时**：失败路径最坏多等 `graceMs + killWaitMs` = 10 s；按 §2.1 读数，常态是百毫秒级。D5 分支另有一次 `ps`（10 s 超时上限）。成功路径零变化。
- **`cancelRun`**：换杀进程的实现；**宽限期判据收紧为「不存活或不是同一进程」是唯一的行为变化**（AGY-04，用户审批并入）——宽限期内 PID 被复用时不再升级 SIGKILL、按「已退出」往下走，随后照常由 `workerConfirmedGone` 决定是否收尾；输出去掉一个不实的括号（D7）。终态早退、收尾前提、锁与闸门回收一概不动。

### 6.2 如实保留

- **确认不了退出**（D5）：闸门、run.json 留给它；锁尽力改写成 worker 的内容（AGY-01）。**改写也失败时**，锁仍是 `--start` 的内容，本进程退出后会按 `pid_gone` 被下一次 `--start` 回收——那时若孤儿其实还活着，仍可能与新一轮并发。启动时刻取不到时（`ps` 失败），补记的 `worker_started_at` 与锁里的 `pid_started_at` 为 null，之后 `--cancel` 与 `judgeStale` 对这个 pid 退化为无复用防护（CODEX-02）。触发要求 SIGKILL 在 5 s 内未能让自己的子进程退出（不可中断睡眠一类），按罕见处理。
- **`--start` 自己被信号杀掉**（Ctrl-C、外部 SIGKILL）恰落在派生与改写锁之间：不走 `catch`，孤儿照常跑、锁按 `pid_gone` 可被回收。worker 另起会话（`detached`），终端的 Ctrl-C 不会连带它。这是 EV-151 里「持锁 pid 已死不等于 worker 已死」那个窗口剩下的部分，写进 EV-151 注记。
- **worker 在被终止前已写下 run.json 终态、还没写 status.json**（AGY-02 ≡ GLM-01）：run.json 保留 worker 的结论，status.json 只补 pid、不落 phase；之后 `--wait` 走失联路径（`pid_gone`），报「失联」但不改写 run.json。若它连闸门也还没置，闸门由第 3 步回收成 `idle`——审查文档在、闸门不等裁决。要求 worker 在失败点之后的几十毫秒里跑完整轮审查，只有零耗时的桩可能做到；与 `--cancel` 撞上 worker 收尾的既有窗口同形（D4）。
- §2.1 的既有缺口（`--cancel` 够不到 `killTree` 拉起的 CLI）：本主题只改说法、不改行为（D7）。
- 实测范围只有 Node v25.2.1 / macOS（CODEX-04）。
- 历史留痕不回填。

### 6.3 回滚（CODEX-03 改写）

新取值旧代码读不懂（schema 在构建期内嵌进 bundle），所以回滚**保留取值面、只回退行为**：

1. 保留四处（都是数据或文案，没有行为）：`skills/dual-critic/schema/run.v2.json` 的 `by` 枚举与两处描述、`types.ts` 的 `EXCEPTION_TERMINATION_BY` 与文档块、`report.ts` `unlistedLabel` 的 `post_spawn_exception` 那一支、`run-meta-strict.test.ts` S1′ 与 `report.test.ts` V8 的新增格；
2. 回退行为代码及其用例：`run-protocol.ts`（`settleOrphanedStart`、主 `catch`、`cancelRun` 改用新函数）、`util/exec.ts`（`onSpawned` 第二参数、`terminateProcessGroup`）、P4 / P4b / P4c / U3～U6；
3. `npm run build`，`npm run check` 应全绿（S3 / V9 不红，A7 (ii) 演练过）；
4. 由用户在终端按 `--targets claude,glm,codex,gemini` 重装；对含新取值的阶段跑一次 `topic resolve`，应退 0。

漏了第 1 步的形态与出口同上一主题（`review --start` 退 2、`gate` 退 65；补回取值面、重建重装，不要去删改那份 run.json）。暴露面：只有本仓自己在这一格失败时才会写出新取值，本仓历史里没有。

### 6.4 BACKLOG 处置（D8）

1. **EV-150**：状态改 done，指向本主题；描述末尾注明「确认不了退出」与「`--start` 自身被信号杀掉」两格的去向。
2. **EV-146**：维持 todo（D6），注记「本主题新增的 `terminateProcessGroup` 可直接复用；`cancelRun` 已改用它」，并补一句：它杀掉的也只是 worker 这一组（新登条目）。
3. **EV-151**：注记「EV-150 那个窗口里由异常触发的部分已由本主题关闭；剩下 `--start` 自身被信号杀掉的部分」。
4. **EV-38**：注记指向新登条目（同源：不核、也杀不到 CLI 子进程）。
5. **新登 EV-152：`--cancel` 按 worker 进程组发信号，够不到适配器以 `killTree` 拉起的厂商 CLI。**`run()` 在 `killTree: true` 时以 `detached` 派生、子进程自成进程组（`2b460ad` 起），四个适配器都这么调；`cancelRun` 与 `terminateProcessGroup` 只按 worker 的组发。零配额实测（§2.1）：worker 退出后该子进程被过继给 init 继续活着，它的超时计时器随 worker 一起没了。真实 CLI 会不会因 stdout 管道断开而自行退出未实测；`5476238` 记过 zcode-cli 在 worker 被杀后继续消耗配额。影响 `--cancel`、EV-146、以及凭据副本的清扫准入（EV-38）。候选：worker 装 SIGTERM 处理器，转发给 runner 里在跑的 `run()`（它们各自有 `killProcessTree(child.pid)`）后再退出；或 worker 把各 CLI 的 pgid 记进运行目录，`--cancel` 逐组发。碰 worker 的信号语义与运行目录契约，单独论证。

---

## 7. 决策点（2026-09-27 送审前已定：用户定 D1～D8 全部取建议项；计划双审第 1 轮后按审批附言并入 AGY-04，D3 相应改写）

**D1 子进程诞生之后 `--start` 失败的语义** — **已定：①终止并收尾**（§3.4）。

- 不变量「非零退出 ⇔ 没有东西在跑」成立；skill 与入口资产不用改。写者清楚：worker 退出之后 `--start` 是唯一写者（§3.5，收尾窗口内被新一轮接管的那一格按守卫不串写）。
- 代价：一次本来可能跑得成的审查被放弃；触发点都是本地写失败，多半意味着磁盘或权限出了问题。
- 未取 ②（不放锁与闸门、交出 run_id）：锁在改写之前护不住、`--wait` / `--cancel` 可能拿不到 pid、skill 要改；未取 ③（派生后簿记降级为非致命）：逐格论证与测试成本与收益不相称。

**D2 `termination.by` 取值** — **已定：新增 `post_spawn_exception`**（带 `exit_code`）。不沿用 `prepare_exception`：它在 `report` 里说「未拉起审查员」，而这一格 worker 已经诞生，字面失实的风险不该进留痕。代价：schema 再加一个值，回滚要保留取值面（§6.3）。

**D3 杀进程的依据与实现** — **已定：确认退出以父进程的子进程句柄为准；抽出 `terminateProcessGroup`，`startRun` 用它，`cancelRun` 也改用它——除宽限期判据收紧为「不存活或不是同一进程」一处外逐项等价**（收紧一处按计划双审 r1 AGY-04、用户审批附言「AGY-04 并入」）。

- 依据：`--start` 是父进程，「句柄未观察到退出」⇒ 未被回收 ⇒ pid 与同号进程组不会被复用（§3.2，§2.1 K2）。不依赖 `processStartTime`。
- 复用：SIGTERM → 宽限 → SIGKILL 这条链两处共用，EV-146 日后也直接用它。
- 收紧那一处：宽限期内 PID 被复用时，今天会把 SIGKILL 打到无关进程（W3）；改后与 `workerConfirmedGone`、`judgeStale` 同一口径，由 U6 / M15 守。

**D4 孤儿已经动过闸门那一格** — **已定：靠次序消除——先终止并确认退出、再回收闸门；worker 若在被终止前已写下终态，保留它写的，只在报错里指路**。r2 把 status.json 纳入同一口径：已终态不动，worker 已写 run.json 终态而 status.json 未到时只补 pid、不落 phase，指路按形态分（AGY-02 ≡ GLM-01）。窄窗口如实保留（§6.2）。

**D5 确认不了退出时怎么办** — **已定：闸门、run.json、status.json 的 phase 一概不动；尽力补记 `worker_pid` 与启动时刻，并把仍是本进程内容的锁改写成 worker 的**（r2 按 CODEX-02、AGY-01 做实「锁与 pid 留给它」）。

**D6 EV-146 并不并入** — **已定：不并入，维持 todo**。杀进程那部分已由 D3 共用；EV-146 的难处（终态早退分支开例外、识别 `heartbeat_stale`、够不到 CLI）与本主题的写者、时序都不同。

**D7 §2.1 那处既有缺口** — **已定：本主题不改行为，新登 EV-152；与之不符的说法在本主题改准**（`killProcessTree` 文档块、`cancelRun` 注释与 step 文案、LLD 第 5 条末句、MANUAL :617、`worker-detach.test.ts` :176-181 注释）。

**D8 BACKLOG** — **已定**：EV-150 结案；EV-146 / EV-151 / EV-38 加注记；新登 EV-152（§6.4）。

**用例构造**：沿用预建运行目录（60 秒窗口、放名为 `worker.pid` 的目录）与命中前置断言；孤儿在 `finally` 里按 run_id 从进程表结束，并断言结束列表为空；hang 桩钉「终止并收尾」，ok 桩钉「孤儿不会在之后改写闸门与 run.json」；零配额造不出的三格与 D5、并发接管、status.json 形态改用 U5 四格注入钉住。

---

## 8. 流程

1. r2 定稿 → **先提交计划**（`git commit -F <文件>`），推送等用户说。
2. 实施、测试、变异、零配额验收 → 报告。
3. 用户终端重装 → 用户敲 `/dual-review-code`。

---

## 附录：计划双审第 1 轮意见的落点

| 意见 | r2 落点 |
| :--- | :--- |
| CODEX-01 ≡ GLM-05 | §1.1 S7；§3.4 第 6 步分两形态；§3.5 新增「收尾窗口内接管主题锁的新一轮」一行；§3.8 锁已改写一行；§4.1 U5③；§4.3 末段；§6.1 并发接管一条；§7 D1 |
| CODEX-02 | §3.4 第 2 步补记启动时刻；§4.1 U5② 断言；§4.3 M12；§6.2 D5 条 |
| CODEX-03 | §4.4 A7 改写；§6.3 回滚配方改为保留取值面 |
| CODEX-04 | §2 开头实测范围；§3.2 PID 复用依据末句；§4.4 末段 Node 18 补跑说明；§6.2 |
| AGY-01 | §3.4 第 2 步改写锁；§3.1；§3.8 D5 行；§4.1 U5②；§4.3 M13；§6.2 D5 条；§7 D5 |
| AGY-02 ≡ GLM-01 | §1.2 W1′；§3.4 第 4 步形态与指路、第 5 步三分；§3.5 status 行；§3.8 两行；§4.1 U5④；§4.3 M14；§6.1；§6.2；§7 D4 |
| AGY-03 | §4.1 U5① 桩内断言；§4.3 M11，删去「先后不可观察」 |
| AGY-04（审批附言并入） | §0；§1.2 W3；§3.2 `workerGoneForCancel`；§3.7 `cancelRun` 一行；§4.1 U6；§4.3 M15；§5 主设计 `--cancel` 行与变更记录；§6.1；§7 D3 |
| GLM-02 | §3.6 schema `status` description；§5 run.v2 schema 行；§5 末段反扫面加 `skills/` |
| GLM-03 | §4.1 U5② 断言；§4.3 M12 |
| GLM-04 | §3.5 status 行措辞 |
