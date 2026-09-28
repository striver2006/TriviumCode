# 失联后取消挂住的worker 实施计划（r2 定稿）

> **性质**：BACKLOG EV-146。**不属任何里程碑**。EV-157（`--cancel` / `--wait` 自己的凭据准入与到期整删不核 CLI）、EV-158（`worker_started_at` 对 TZ / 区域设置敏感）**不并入**，只论证交互（§7）。
> **一句话**：`--wait` 判 `worker_lost` 时在 status.json 多记一个结构化事实 `lost`；此后 `review --cancel` 的终态早退分支只对「status.json 为 failed、`lost.reason` 为 `heartbeat_stale`、且工作进程仍是同一活进程」这一格开例外：按组结束工作进程（SIGTERM → 宽限 → SIGKILL）并确认退出 → 按 status.json 的记录结束审查员 CLI → 按 EV-142 的前提把仍为 running 的 run.json 与主题任务文件里的运行登记补收为 failed → 按 run_id 与 pid 复核回收主题锁。status.json 一个字节都不写，闸门不动，凭据副本不抹。
> **用户已定（2026-09-28，送审前，见 §9）**：只做 EV-146；例外只开这一格，判据取结构化事实、不解析人读文案，可给 status.json 加可选字段、不新增运行目录文件；动作次序与「status.json 的 phase / message 不改写、锁确认退出后复核回收、闸门不动」；确认不了退出时 run.json 不写、锁不动、如实说明；误判代价在计划里论证、杀掉可接受但输出要按事实说；这一格不抹凭据副本；不花配额；超范围的问题登记暂缓、不停下。
> **本稿自定**：`lost` 字段的形状与写者（D1）；身份判据沿用 `processAlive(pid, worker_started_at)`、不为本格另立规范化锚点（D2）；工作进程确认不了退出时仍按记录结束 CLI（D4）；run.json 的 `termination` 沿用 `{ by: worker_lost, reason: heartbeat_stale }`（D5）；退出码两种结局都是 0（D6）；「工作进程已不在 + heartbeat_stale」那一格的补收**暂缓**（D8，新登 EV-159）。
> **实测**（§2，零配额）：事件循环被堵住时 SIGTERM 处理器不执行、SIGKILL 才退（上一主题 Q3，三次相同）；本稿用 `50cb380` 的构建复现了 EV-146 原文（§2 P1 / P2：`--wait` 判 heartbeat_stale 后 `--cancel` 什么都不动、锁仍在、同阶段 `--start` 退 70），并确认「心跳过期阈值调小时健康的 worker 也被判 heartbeat_stale」（P1），它就是误判那一格的零配额构造。
> **计划双审第 1 轮**（run `20260928T044009Z`）：codex `approve-with-nits`、gemini `request-changes`、glm `approve-with-nits`，15 条：接受 13、驳回 1（CODEX-04）、暂缓 1（CODEX-02 → EV-160）；裁决件 `2026-09-28-失联后取消挂住的worker-revised-claude.md`。命令 A 不设人工闸门。
> **r2 相对 r1 的改动**：失联报错与本格开场句先列事实（CODEX-01）；`mismatch` / `no_identity` 两格不再跌回「无需取消」（AGY-01）；判格类型守卫（AGY-02 ≡ GLM-02）；`reportFinalizeStep` 可选后半句（AGY-03）；J1 界式（CODEX-03）；K4 可重入（CODEX-06）；D1 备选与对外 JSON 加法（CODEX-05）；如实保留两条（GLM-01、无身份的成因）；EV-159 注记与 MANUAL 出路（CODEX-07）；EV-160 新登（CODEX-02）；新增用例改用 K 前缀、出处改准（CODEX-06 ≡ GLM-03 / GLM-05）；`no_status_file` 写不进（GLM-04）。逐条对应见文末附录。

- **日期**：2026-09-28
- **主题**：`失联后取消挂住的worker`（`topic claim` plan → claude，2026-09-28T04:28:24Z）
- **起点**：`50cb380`（`main`，clean）。下文行号均取自该提交的**源码**（不取 `dist/test` 编译产物的行号）
- **上位**：BACKLOG EV-146（本主题，含 2026-09-28 CLI进程组记录计划 r2 §8 注记）、EV-142（前提的出处）、EV-157 / EV-158（相邻，只论证）；
  `.reviews/CLI进程组记录/plan/` r2（§3 覆盖矩阵 c″ 格、§4.4 终态早退分支的 D3、§8 EV-146 论证）与代码双审应答件（GLM-02：EV-158 让 D3 在环境错配时对活 worker 名下的 CLI 发信号）；
  `doc/05_testing/REPORT_2026-09-28_cli_pgroup_record.md` 与 `evidence/cli-pgroup-record-20260928/acceptance.mjs` 的 B3（事件循环堵住 ⇒ `--cancel` 升级 SIGKILL）、B6（worker 已死 ⇒ `--wait` 判 pid_gone ⇒ `--cancel` 终态分支结束 CLI）；
  主设计 v1.3.53、PRD v1.4.15、LLD v1.1.11、MANUAL v1.0.11
- **全量基线**：`npm run check` 2188 / 2186 / 0 / 2（`50cb380`，上一主题报告 §7）

---

## 0. 范围与不做

| 做 | 不做 |
| :--- | :--- |
| `status.ts`：`RunStatus` 加可选字段 `lost`（`{ reason, at }` 或 null）；读它的校验函数 `lostOf`（形状不对 ⇒ 当没有，§4.1） | 解析 `message` 的人读文案（用户决策 2）；新增运行目录文件（同上，不动 `RUN_DIR_FILES` / `freeze.ts` / `run-files-parity`）；给 status.json 补 JSON schema（它今天只有 TS 接口） |
| `run-protocol.ts` `waitRun`：判 `worker_lost` 时在写 failed 的同一次 `patchStatus` 里记下 `lost`；`heartbeat_stale` 那一支的报错先列事实再给出口（§4.2） | 改 `--wait` 的失联语义（「判 heartbeat_stale 时不写终态」那条路，§8）；`heartbeat_stale_s` 不大于心跳间隔时的预检告警（CODEX-02 → EV-160） |
| `run-protocol.ts` `cancelRun`：终态早退分支之前先判这一格；新增 `classifyLostCancel`（判格）与 `cancelLostWorker`（这一格的动作链），`cancelRun` 加一个只给单测用的可选注入参数；`mismatch` / `no_identity` 两格改打如实结论；`reportFinalizeStep` 加可选后半句（§4.3、§4.4） | 这一格里抹凭据副本（用户决策 7，EV-157 范围不动）；动闸门；改写 status.json |
| 常量：沿用 `WORKER_TERM_GRACE_MS`（宽限）与 `ORPHAN_KILL_CONFIRM_MS`（SIGKILL 后确认），后者文档块改成两个使用方（§4.4） | 新增常量 |
| run.v2 schema、`types.ts` `RunMeta.status` / `termination` 的**说明文字**补「`--cancel` 在这一格也写 `worker_lost`」；`report` 的「未进时间线」说明不改（取值不变，§4.5） | 新增 `termination.by` 取值（D5） |
| 单测、集成（`hang_cli` 的 `blockAfterMs` + 调小的 `heartbeat_stale_s` + `test/helpers/proc.ts`）、变异、零配额验收（新旧构建，旧 = `50cb380`）、doctor 自检；主设计 / LLD / MANUAL / PROTOCOL / BACKLOG 同步，PRD 核后定（§5、§6） | 真实厂商 CLI 实测（用户决策 6）；EV-157、EV-158 的修法；「worker 已不在 + heartbeat_stale」的补收（D8 → EV-159） |

---

## 1. 现状（逐条对照代码，`50cb380`）

### 1.1 失联判定与它写下的东西

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| W1 | `interpretStatus` 情形 C：进程活着且同一进程、心跳年龄超过 `heartbeat_stale_s` ⇒ `worker_lost / heartbeat_stale`；进程不在或不是同一进程 ⇒ `pid_gone`（先判）。身份判据是 `processAlive(pid, worker_started_at)` | `src/trivium/status.ts` :327-371 |
| W2 | `waitRun` 失联分支：用改写前的事实判「已退出」→ `finalizeFailedRunMeta`（`workerGone` 为假时第一步跳过、run.json 不写）→ `patchStatus` 写 `phase: failed`、`exit_code: 1`、`message: worker_lost（〈原因〉）`→ 回收闸门 → 凭据准入（`heartbeat_stale` 时 worker 仍在，不抹）→ 抛错。**失联原因只进了人读的 `message`**，没有结构化字段 | `src/trivium/run-protocol.ts` :1135-1213（写 status 在 :1173-1177，回收闸门在 :1184） |
| W3 | worker 的心跳每 30 s 一次（`HEARTBEAT_MS` 常量，不可配），`heartbeat_stale_s` 缺省 120、只约束 `> 0`；worker 的全部写入都走 `patchStatus` 读改写，**保留它不认识的键** | 同上 :47、:927-934；`status.ts` :127-147；`config.ts` :290；`config.v2.json` :167-170 |
| W4 | worker 恢复之后（只是慢）仍会照常写：心跳只刷 `heartbeat_at`（phase 保持 `--wait` 写的 failed），收尾那次把 phase 改写成自己的结论并写 run.json 终态 | `run-protocol.ts` :927-934、:967-983 |
| W5 | `heartbeat_stale` 之后 run.json 停在 running、主题锁仍由 worker 持有：锁的判旧 `judgeStale` 对活着的同一进程只在 `runTerminal`（查 run.json）为真时回收，run.json 是 running ⇒ 新 `--start` 退 70，报错原文让人「可用 `trivium review --cancel <run_id>` 取消」 | `lock.ts` :68-89、:215-221；`run-protocol.ts` :316-327 |
| W6 | `startRun` 用**同一个变量**把 worker 的启动时刻写进锁（`pid_started_at`）与 status.json（`worker_started_at`）；取它的 `ps` 失败或超时时两处同为 null | `run-protocol.ts` :432-447；`util/exec.ts` `processStartTime` |

### 1.2 `--cancel` 的终态早退分支

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| C1 | 终态分支：有 CLI 记录且 `workerConfirmedGone(s, pidFromFile)` 为真 ⇒ `terminateRecordedCliGroups` + 播报（EV-154 D3，只结束进程）；然后固定两行「已处于终态（〈phase〉），无需取消」「已完成的运行不会被追溯改写」，退 0。**worker 仍是同一活进程时什么都不做**——W5 的出路在这里断掉 | `run-protocol.ts` :1354-1368 |
| C2 | 主路径（非终态）：`terminateProcessGroup(pid, { isGone: workerGoneForCancel, graceMs: WORKER_TERM_GRACE_MS, killWaitMs: 0, pollMs: 250, onEscalate })`；升级时按记录结束 CLI；SIGKILL 之后不等，改由随后的 `workerConfirmedGone` 判是否已退出 | 同上 :1373-1406 |
| C3 | 现成积木：`terminateProcessGroup`（每次发信号前先问 `isGone`，返回 `{ gone, escalated, signals }`）；`workerGoneForCancel`（不存活或不是同一进程即算已退出）；`terminateRecordedCliGroups` / `reportRecordedCliGroups`（按记录结束 CLI 并按事实播报，`quietWhenEmpty` 控制无记录时出不出声）；`finalizeFailedRunMeta`（仍为 running 才写、只改三格加 `termination`、第一步在主题任务锁里判与写、第二步同步登记、自身不抛）；`reclaimStaleLock`（rename → 复验 → 删） | `util/exec.ts` :624-653；`run-protocol.ts` :726-729、:766-840；`meta.ts` :579-583、:657-730；`lock.ts` :97-127 |
| C4 | 主路径回收锁只比 `run_id`（:1467-1468）；EV-150 的派生后失败收尾回收「已改记到工作进程名下的锁」时比 `run_id` 与 `pid` 两项（:712-716）——本格用后者的口径（用户决策 4） | 同上 |
| C5 | `reportFinalizeStep` 按「异常转成的跳过 ⇒ warn、其余 ⇒ step」分流，但「没有第二次机会」半句写死了主路径的处境（「status.json 随后落终态，再跑 --cancel 会早退」），本格不适用 | 同上 :1308-1316 |
| C6 | `processAlive(pid, expectedStartedAt)` 在 `expectedStartedAt` 为假值（null、空串）时直接给 `sameProcess: true` | `util/exec.ts` :515 |

### 1.3 工作进程的信号语义（上一主题的读数）

- 事件循环被 `Atomics.wait` 堵住时，SIGTERM 处理器不执行、进程不退；SIGKILL 后 3～4 ms 以 `signal: SIGKILL` 退出（CLI进程组记录计划 r2 §2 Q3，三次读数相同）。
- 事件循环没被堵住时，worker 的 SIGTERM 处理器（`installWorkerSigtermForwarding`，:868-906）冻结 `run()`、按组终止它登记的 CLI、以 SIGTERM 自杀，预算 `WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 500` 落在 `WORKER_TERM_GRACE_MS` 之内（`run-protocol.test.ts` :696 的 EV-152 U8 守）。
- `hang_cli` 桩的 `blockAfterMs`：等本运行全部侧的 CLI 记录（含启动时刻）落盘，再过这么多毫秒在 worker 主线程 `Atomics.wait` 600 s（`adapters/stub.ts` :158-166、:312 起）。

### 1.4 测试现状

| 用例 | 现状 | 本主题 |
| :--- | :--- | :--- |
| `run-protocol.test.ts` L2（:427）：心跳过期而进程在 ⇒ run.json 不写；L1（:398）：pid_gone | 须保持绿 | 加断言：status.json 记下 `lost`；L2 的报错含事实行与出口句 |
| `gate-loop.test.ts` :949「心跳过期但进程仍在 … 不做不可逆抹除」 | SIGSTOP 冻住 worker、`heartbeat_stale_s: 2` | 不改，须保持绿 |
| `gate-loop.test.ts` EV-154 I4（:2638）、I5（:2668）与 :1388 的「`--cancel` 已终态的运行：不改写历史、不动闸门」 | b 格、c′ 格、终态分支 | 不改，须保持绿（本格之外的终态分支行为不变） |
| 上一主题验收 B3 / B6 | b 格、c′ 格 | 本主题验收 C5 在新旧构建上重跑、读数不变 |

---

## 2. 实测（零配额，Node v25.2.1 / macOS）

| 格 | 做法 | 读数 |
| :-- | :--- | :--- |
| P1 | 夹具配 `heartbeat_stale_s: 2`，两侧 `hang_cli`（不堵），`--start` 后等两组组长出现、再等 3 s 跑 `--wait --timeout 10` | 立即以 `worker_lost（heartbeat_stale）` 退 1；status.json `phase: failed`、`message: worker_lost（heartbeat_stale）`、**没有任何结构化的失联键**；run.json 仍 running；worker 与两组 CLI（各 2 个成员）都仍在；之后 `--cancel` 退 0、stdout 只有「已处于终态（failed），无需取消」两行、stderr 为空，worker 与两组仍在、run.json 仍 running、锁文件仍在；同阶段再 `--start` 退 70，报错原文「若确认该运行已卡死，可用 `trivium review --cancel <run_id>` 取消」（即 EV-146 原文与 W5 的死路）；从 `--start` 起约 30 s，worker 写回 `heartbeat_at`（04:38:46.804Z → 04:39:13.565Z）、phase 仍是 failed（W4）。**健康的 worker 在阈值小于心跳间隔时也会被判 heartbeat_stale**——这就是「心跳只是慢」那一格的零配额构造（§5.2 J2） |
| P2 | 同 P1 但 gemini `blockAfterMs: 300` | `--wait`、`--cancel`、再 `--start` 的读数与 P1 逐项相同；`--wait` 之后 3 s 内 status.json 的 `heartbeat_at` 不再变化（堵住之后 worker 不再写；§5.2 J1 的前提） |

读数出自 scratchpad 探针 `probe-lost.mjs`（mkdtemp 夹具、桩审核者，收尾按本次标记与 worker pid 按组结束、无残留），被测构建是工作树里 `50cb380` 的 bundle，跑一次。实施时把探针与读数拷进 evidence，并由验收 C2 / C3 的旧构建一侧重跑。

---

## 3. 覆盖矩阵（续用上一主题的格名；「终态」指 status.json 的 phase）

| 格 | 今天（`50cb380`） | 本主题之后 |
| :--- | :--- | :--- |
| c′. worker 已不在，`--wait` 判 `pid_gone` 写成 failed，之后 `--cancel` | ✅ 终态分支按记录结束 CLI（D3），不写任何文件 | 不变 |
| **c″. `--wait` 判 `heartbeat_stale`（worker 活着），之后 `--cancel`** | ❌ 终态早退，什么都不动；锁被挂住的 worker 持着，新 `--start` 退 70 且报错指向 `--cancel`（W5） | ✅ 本格：结束 worker → 结束 CLI → 补收 run.json 与登记 → 回收锁；status.json 不写、闸门不动、凭据不抹 |
| c″-慢. 同 c″，但 worker 只是心跳慢（事件循环没堵住） | ❌ 同上；worker 之后自己跑完，phase 被它改写回自己的结论 | ✅ 同 c″：SIGTERM 后 worker 的处理器自己收拾 CLI 并退出，输出如实说「在宽限内响应 SIGTERM——失联判定可能只是心跳慢」（§4.4、§7.1） |
| c″-恢复. 失联判定之后 worker 已恢复并写回自己的终态（phase 不再是 `--wait` 写的那次） | ✅ 终态早退 | 不变：phase 为 success 时不入本格；worker 自己写 failed 的那一刻它正在收尾退出，入本格也只是提前结束一个即将退出的进程（§7.1 情形 C） |
| c″-已死. `--wait` 判 heartbeat_stale 之后 worker 自己死了 / 被手工结束 / 本格第一次取消在杀掉之后中断 | ❌ 终态分支只结束 CLI；run.json 永远停在 running | ❌ **不变，暂缓**（D8 → EV-159）：用户决策「例外只开一格」 |
| c″-错配. 同 c″，但本次 `--cancel` 的 TZ / 区域设置与 `--start` 不同（EV-158） | ⚠️ 活 worker 被判「不是同一进程」⇒ 走 D3：按记录结束 CLI、worker 不动；stdout 说「无需取消」 | ⚠️ 不入本格（身份判不上），仍走 D3；**不再说「无需取消」**，改打如实结论与告警，点名两种可能（PID 复用 / 环境不同）与出路（§4.3、§7.3） |
| c″-无身份. 同 c″，但 status.json 的 `worker_pid` 不是 > 1 的整数，或 `worker_started_at` 不是非空字符串（成因：`--start` 取启动时刻的 `ps` 失败或超时，W6；或手改） | ❌ 终态早退 | ❌ 不入本格（判不了是不是同一进程就不发信号）；**不再说「无需取消」**，改打如实结论与告警（§4.3） |
| 旧版 `--wait` 写下的失联终态（没有 `lost`） | 终态早退 | 不变：没有结构化事实就不入本格（D1） |
| 常态 a / b / c 格、终态分支的其余情形 | — | 不变（验收 C5、C7 钉） |

---

## 4. 改法

### 4.1 status.json 新增可选字段 `lost`（D1）

`status.ts`：

```ts
export interface RunStatus {
  …
  /**
   * `--wait` 判 `worker_lost` 时记下的结构化事实（EV-146）：原因与判定时刻。与 `phase: failed`、`message` 在同一次写入里落盘。
   * 缺席（旧版 `--wait` 写的、或不是 `--wait` 判失联写的终态）与 null 读者一律当「没有」；旧版读者忽略这个键。
   * worker 恢复后自己的写入会保留它（读改写不删不认识的键），所以它说的是「曾被判失联」，不是「现在仍失联」。
   */
  lost?: WorkerLostRecord | null;
}
export interface WorkerLostRecord { reason: WorkerLostReason; at: string }

/** 读 `lost`：形状合法（reason ∈ WORKER_LOST_REASONS、at 为非空字符串）才返回，否则 null——读不懂就当没有，不入本格 */
export function lostOf(s: RunStatus | null): WorkerLostRecord | null;
```

- **写者**只有一个：`waitRun` 失联分支那次 `patchStatus`（:1173-1177）里加 `s.lost = { reason: reading.reason, at: new Date().toISOString() }`。三种原因都记；其中 `no_status_file` 时 status.json 本就不存在、`patchStatus` 不执行 mutate（`status.ts` :130-140），该事实只进报错正文（GLM-04）。消费方只认 `heartbeat_stale`。
- **对外面**：`--wait --json` 与 `--status --json` 整份透出 status（`cli.ts` :473-481），`lost` 因此是对外 JSON 形状的**加法**（CODEX-05），PROTOCOL 同步写明、验收 C8 钉回滚方向。
- **为什么不从别处推断**：`message` 是人读文案（用户决策 2 禁止）；run.json 的 `termination` 在 heartbeat_stale 时恰恰没写（EV-142 前提）；`exit_code: 1` 不区分失联与普通失败；新增运行目录文件被用户决策排除。不加字段的组合判据见 §9 D1 备选。
- **形状坏的 `lost`**（手改、未来版本改形状）⇒ `lostOf` 返回 null ⇒ 不入本格、走今天的终态早退——**读不懂就不发信号**，与上一主题「形状坏的 CLI 记录不发信号」同一口径（fail-safe 方向是「不杀」）。

### 4.2 `waitRun`：记 `lost`，heartbeat_stale 的报错先列事实再给出口（D9，CODEX-01）

- 上面那一行写入。
- 报错正文（:1208-1211）在原因为 `heartbeat_stale` 且 `goneForArchive` 为假时追加两行：
  - 事实行：「判定依据：工作进程 〈pid〉 仍在，status.json 已 〈N〉 s 未更新（失联阈值 `heartbeat_stale_s` = 〈T〉 s；工作进程的心跳间隔是 30 s）」——`N` 取改写前 status.json 的 `heartbeat_at`（`pre`，:1149）到判定时刻；阈值不大于心跳间隔时同一行接「——阈值不大于心跳间隔：健康的工作进程也会被判失联」。
  - 出口行：「若确认它卡死、要结束这一轮：`trivium review --cancel 〈run〉`——会结束它与它拉起的审查员 CLI，并补收归档 run.json；它若只是慢，这样做会结束一个仍在推进的轮次」。
- 今天那句「只能手工结束」的说法只在 MANUAL 里（:643-644），报错里没有出路；照着 70 的报错去跑 `--cancel` 又会早退（W5 / C1）。推荐与判断依据在同一屏，人才分得清「卡死」与「只是慢」（§7.1）。

### 4.3 判格：`classifyLostCancel`（新增，`run-protocol.ts`，导出供单测）

```ts
export type LostCancelCell =
  | { kind: 'none' }                                   // 不是「failed + lost.reason = heartbeat_stale」
  | { kind: 'no_identity' }                            // 是，但 status.json 的身份两项不合形状
  | { kind: 'gone'; pid: number }                      // 是，pid 上已没有活进程
  | { kind: 'mismatch'; pid: number }                  // 是，pid 上有活进程而启动时刻不符（PID 复用，或 EV-158 环境错配）
  | { kind: 'alive'; pid: number; startedAt: string }; // 本格
export async function classifyLostCancel(s: RunStatus): Promise<LostCancelCell>;
```

- 判据全部取 status.json 的结构化字段：`phase === 'failed'`、`lostOf(s)?.reason === 'heartbeat_stale'`、`worker_pid`、`worker_started_at`；进程事实取 `processAlive(worker_pid, worker_started_at)`。
- **身份的类型守卫**（AGY-02 ≡ GLM-02）：`worker_pid` 必须是整数且 > 1，`worker_started_at` 必须是 trim 后非空的字符串，否则 `no_identity`。理由：`processAlive` 对假值启动时刻给 `sameProcess: true`（C6），空串会被当成「有身份且相符」；pid 为 1 是 init / launchd；status.json 只有 TS 接口、`readStatus` 不校验。与 `lostOf` / `cliRecordsOf` 的形状校验同族。
- **只认 status.json 里的 pid 与启动时刻，不回落 `worker.pid` 文件**：回落时启动时刻为 null，等于「身份缺失 = 相符」，对一个可能已被复用的 pid 发 SIGKILL 不可接受。锁里的 `pid_started_at` 也不作第二来源：它与 `worker_started_at` 出自同一个变量（W6），`ps` 失败时同为 null，不增加覆盖（CODEX-04 驳回的理由）。
- `cancelRun` 终态分支（:1354）改为：

```ts
if (s && isTerminal(s.phase)) {
  const cell = await classifyLostCancel(s);
  if (cell.kind === 'alive') return cancelLostWorker(ctx, runId, runDir, s, cell, o);
  …原有 D3（有记录且 workerConfirmedGone ⇒ 按记录结束 CLI），逐字不变…
  if (cell.kind === 'mismatch' || cell.kind === 'no_identity') {
    // AGY-01：不跌回「无需取消」——worker 可能还挂着、锁与归档都没动
    warn(…mismatch：§7.3 的告警；no_identity：「status.json 里工作进程的 pid 或启动时刻缺失 / 形状不对，判不了是不是同一进程，不发信号——请用 ps 核对」…);
    say(`运行 ${runId} 已被 --wait 判为失联（heartbeat_stale），但${cell.kind === 'mismatch' ? '工作进程的身份与记录不符' : 'status.json 没记下可核对的工作进程身份'}，未对工作进程发信号；归档 run.json 与主题锁未动。`);
    return EXIT.OK;
  }
  say('…已处于终态…无需取消。'); say('  已完成的运行不会被追溯改写…');   // 只留给其余终态，逐字不变
  return EXIT.OK;
}
```

  `none` 与 `gone` 静默走原路（`gone` 是 c″-已死格，D8）。

### 4.4 本格的动作链：`cancelLostWorker`（新增，`run-protocol.ts`）

按用户决策 3 的次序，每一步按事实播报（step / warn 写 stderr，结论写 stdout）：

1. **开场**（step）：「运行 〈run〉 已被 --wait 判为失联（heartbeat_stale，判定于 〈lost.at〉；status.json 最近一次写入于 〈heartbeat_at〉），但工作进程 〈pid〉 仍是同一进程：按取消意图结束它——向工作进程组发送 SIGTERM」。`heartbeat_at` 晚于 `lost.at` 超过 1 s 时另 warn「失联判定之后工作进程又写过 status.json，它可能只是心跳慢；仍按取消结束它」（CODEX-01：在发信号之前说）。1 s 的余量是因为 `--wait` 自己那次写入会把 `heartbeat_at` 刷成判定后几毫秒（`writeStatus` :103-106），只影响这一句的措辞。
2. **结束工作进程并确认退出**：
   ```ts
   terminateProcessGroup(pid, {
     isGone: () => workerGoneForCancel(pid, startedAt),
     graceMs: WORKER_TERM_GRACE_MS,           // 与主路径同一宽限：事件循环没堵住时，worker 的处理器在这之内收拾完 CLI 并退出
     killWaitMs: ORPHAN_KILL_CONFIRM_MS,      // 与主路径不同：SIGKILL 之后要等确认——后面几步都以「确认退出」为前提（D3）
     pollMs: 250,
     onEscalate: () => warn(`工作进程组 ${pid} 未响应 SIGTERM（事件循环被堵住时处理器跑不到），发送 SIGKILL`),
   })
   ```
   `cancelRun` 的新可选参数 `o.terminateWorker` 只给单测替换这一步（与 `settleOrphanedStart` 的 `terminate` 注入同形）。播报按结果分三句：
   - 确认退出、没升级：step「工作进程在宽限内响应 SIGTERM 退出（〈信号序列〉）——它的事件循环没有被堵住，失联判定可能只是心跳慢；它的 SIGTERM 处理器已按自己的登记结束审查员 CLI（见 worker.log）」；
   - 确认退出、升级过：step「工作进程组 〈pid〉 已结束（SIGTERM、SIGKILL）」；
   - 没确认退出：warn「已向工作进程组 〈pid〉 发送 〈信号序列〉，未能确认退出：归档 run.json、主题任务文件的运行登记与主题锁都不动（它若还活着就是写者）。可以再跑一次 --cancel（仍会入这一格）；若改为在终端手工结束它，之后再跑 --cancel 只会结束 CLI，归档 run.json 与运行登记要人工核对（BACKLOG EV-159）」（CODEX-07）。
3. **按记录结束 CLI**：`terminateRecordedCliGroups(await readStatus(runDir))` → `reportRecordedCliGroups(r, quietWhenEmpty = !escalated, runDir)`。没升级时 worker 的处理器已经按句柄收拾过，记录多半已清成 null 或判 `gone`，无记录就不出声；升级过时无记录要说（沿用 b 格口径）。**worker 没确认退出时这一步照做**（D4）。
4. **补收 run.json 与登记**（仅在第 2 步确认退出时）：
   ```ts
   finalizeFailedRunMeta({ layout: { archiveRoot, topic: s.topic }, stage: s.stage, runId, lock: {…}, workerGone: true,
                           termination: { by: 'worker_lost', reason: 'heartbeat_stale' } })
   ```
   `workerGone: true` 的依据是第 2 步按 pid + 启动时刻**观察到**的退出（与 EV-150 传 true 的依据同类，`meta.ts` :548-557 的文档块补一句）。仍为 running 才写（前提 4）：worker 在被杀之前已写下归档终态的，不追溯改写、输出里的跳过原因照原样说。播报经 `reportFinalizeStep`（AGY-03）：它加一个可选参数传「没有第二次机会」半句，缺省仍是主路径原句（主路径输出逐字不变）；本格传「这一步不会再有第二次机会：status.json 已是终态、工作进程已不在，再跑 --cancel 不会补这一步（BACKLOG EV-159），请人工核对归档 run.json 与主题任务文件的运行登记」。分流规则不变：异常转成的跳过 warn，其余 step。
5. **回收主题锁**（仅在第 2 步确认退出时）：`inspectLock(topic)` 的 `run_id === runId && pid === 工作进程 pid` 才 `reclaimStaleLock`（C4 的 EV-150 口径），say「已回收主题「〈topic〉」的锁」（与主路径同句）；不符时 step「主题锁已不归本运行的工作进程（〈锁里的 run_id / pid〉），不动」。
6. **不做的**：status.json 一个字节都不写（phase / message 不改写，CLI 记录也不清——与 D3 终态分支同口径：终态分支的承诺是不追溯改写，不在里面开写入口子；遗留记录由判定口径兜住，组长不在即 `gone`。这也让判格可重入：`lost` 与 phase 原样留着，未确认退出后再跑一次仍入本格）；闸门不动（`--wait` 判失联时已回收，中断窗口见 §7.5）；凭据副本不抹（用户决策 7：worker 与 CLI 都结束之后，会话启动清扫 / `trivium scrub` 的 `admitScrub` 照常放行，§7.2）。
7. **结论**（stdout）：
   - 确认退出：「运行 〈run〉 已被 --wait 判为失联（heartbeat_stale）：已结束仍挂着的工作进程 〈pid〉。」+「  status.json 的 phase 与 message 保持失联判定时的样子（不追溯改写）；归档 run.json 与运行登记见上方输出。」
   - 未确认：「运行 〈run〉 已被 --wait 判为失联（heartbeat_stale）：未能确认工作进程 〈pid〉 退出，归档与主题锁未动。」
   退出码两种都是 0（D6）。

**常量**：`ORPHAN_KILL_CONFIRM_MS` 的文档块（:58-64）改成「SIGKILL 之后至多再等多久确认退出：`--start` 派生后失败的收尾（EV-150）与失联后取消（EV-146）两处」，并把「`--cancel` 那边 SIGKILL 之后刻意不等」改成「`--cancel` 主路径」。本格最长耗时 = 宽限 5 s + 确认 ≤5 s + CLI 宽限链 2 s + 1 s + 若干次 `ps`；实际 SIGKILL 后毫秒级确认，约 8 s。

**`cancelRun` 顶部文档块**（:1286-1291）补一段本格；终态分支的注释（:1355-1360）里「worker 还活着（`heartbeat_stale`，EV-146）或判不了时不动」改成指向本格与 `mismatch` / `no_identity` 两格。

### 4.5 归档契约的说明文字（取值不变）

- run.v2 schema（`skills/dual-critic/schema/run.v2.json`）`status`（:471）与 `termination`（:480）两处 description：`failed` / `by=worker_lost` 的写者补「或 `--wait` 判 heartbeat_stale 之后由 `review --cancel` 结束仍挂着的工作进程并确认退出时写（EV-146）」。枚举不变，`run-meta-strict.test.ts` S2 / S3 不受影响。
- `types.ts` `RunMeta.status`（:1488-1497 一带）与 `termination`（:1500-1510 一带）的注释同步；`meta.ts` `finalizeFailedRunMeta` 文档块（:572-578）「六个调用方」改成七个。
- `report.ts` `unlistedLabel`（:434-435）不改：`worker 失联（heartbeat_stale）` 对本格同样如实——那次运行确实是被判失联，之后才被取消结束；「被 --cancel 结束」这个事实只在 `--cancel` 的输出里，不进归档（D5 的代价，§9）。

---

## 5. 验证

### 5.1 单测（`test/unit/status.test.ts` 加 `lostOf` 各格；`test/integration/run-protocol.test.ts` 用既有的 `fakeCtx` / `seedRun` / `seedArchive` / `holdLock` / `staleHeartbeat` / `captureStderr`）

新增用例一律以 **K** 编号（与既有 U / L / E 系列不撞号，CODEX-06）。`seedRun` 的假 worker 是一个 `setTimeout` 长睡的 node 进程，没有 SIGTERM 处理器，收到 SIGTERM 即退——正好是「没堵住」那一支的最小形态；「堵住」那一支在集成里用真实 worker 造（§5.2）。

- **K1** `lostOf`：缺席 / null / 非对象 / `reason` 不在枚举 / `at` 非字符串或空串 ⇒ null；合法 ⇒ 原样。
- **K2**（L1 / L2 加断言）：心跳过期而进程在 ⇒ `waitRun` 抛错后 status.json 有 `lost.reason === 'heartbeat_stale'`、`at` 可解析；报错正文含事实行（心跳年龄、阈值、「心跳间隔是 30 s」）与 `--cancel` 出口行；夹具阈值 ≤ 30 s 时含「健康的工作进程也会被判失联」，> 30 s 时不含。L1（pid_gone）记下 `lost.reason === 'pid_gone'`、**不含**那两行。
- **K3** 本格主线：`seedRun` + `seedArchive` + `holdLock`（锁记在假 worker 名下）+ `staleHeartbeat` → `waitRun`（heartbeat_stale）→ 记下 status.json 字节 → `cancelRun`：退 0；假 worker 已不在；run.json `failed`、`termination` 为 `{ by: 'worker_lost', reason: 'heartbeat_stale' }`、`artifacts[]` 原样；登记 `failed`；锁已回收；**status.json 与取消前逐字节相同**；闸门项与取消前相同；stderr 含开场句与「在宽限内响应 SIGTERM」；stdout 含「已结束仍挂着的工作进程」、不含「无需取消」。
- **K4** 确认不了退出：同 K3，但注入 `terminateWorker` 返回 `{ gone: false, escalated: true, signals: ['SIGTERM','SIGKILL'] }`（假 worker 真的还活着）⇒ run.json 与主题任务文件逐字节不变、锁仍在且内容不变；stderr 含「未能确认退出」与「可以再跑一次 --cancel」；stdout 含「未能确认」；退 0。**紧接着再跑一次 `cancelRun`**（仍注入同一个桩）⇒ 仍入本格：注入计数为 2、stdout 同样是「未能确认」（CODEX-06 ③：判格可重入）。
- **K5** 不入本格的各格（每格断言：假 worker 仍活着、run.json / 锁 / status.json 逐字节不变）：
  ① phase failed、**没有 `lost`**、`message` 恰好是 `worker_lost（heartbeat_stale）`（证明不读文案）⇒ stdout 是「已处于终态」原两行；
  ② `lost.reason` 为 `pid_gone`（用活着的假 worker 构造）⇒ 原两行；
  ③ phase `success` 而 `lost.reason` 为 `heartbeat_stale`（c″-恢复）⇒ 原两行；
  ④ `worker_started_at` 改成别的串（`mismatch`）⇒ stderr 含 §7.3 告警；stdout 是如实结论「身份与记录不符，未对工作进程发信号」、**不含「无需取消」**（AGY-01）；
  ⑤ 身份不合形状，参数化四种：`worker_started_at` 为 null、为空串、`worker_pid` 为 1、`worker_pid` 为字符串（`no_identity`）⇒ stderr 含「判不了」告警；stdout 是如实结论、不含「无需取消」（AGY-01、AGY-02）；
  ⑥ `lost` 形状坏（`{ reason: 'heartbeat_stale' }` 缺 `at`）⇒ 原两行。
- **K6** 锁的复核：锁的 `run_id` 相同而 `pid` 不同（新一轮已接管的形态）⇒ 不动它、stderr 说明；锁的 `run_id` 不同 ⇒ 同样不动。
- **K7** run.json 已是终态（worker 在挂住之前写完了 success）⇒ run.json 不改、stderr 说「已是终态（success），不追溯改写」；worker 仍被结束、锁仍回收。
- **K8** 再跑一次：K3 之后再 `cancelRun` ⇒ 走终态早退（`gone` 格）、run.json 与 status.json 都不变、stdout 是原来两行。
- **K9** `reportFinalizeStep` 的后半句：主路径不传时 E6（`run-protocol.test.ts` :352）的断言原样通过（输出逐字不变）；本格在 `_meta` 只读时（同 E6 的构造）告警含本格的后半句、不含「status.json 随后落终态」。

### 5.2 集成（`gate-loop.test.ts`，真实 bundle + `hang_cli` + `extraReview: ['heartbeat_stale_s: 2']` + `test/helpers/proc.ts`）

沿用 `startWithRecordedClis`（它用缺省夹具；本组要给 `makeFixture` 传 `extraReview`，给该助手加一个可选参数）、`sidesCliOf`、`pidGone`、`cleanupGroups`。

- **J1**（c″，堵住）：两侧 `hang_cli` + gemini `blockAfterMs: 300` → 等记录（含启动时刻）→ 等块生效与心跳过期（2.5 s）→ `--wait --timeout 10` 退 1、stderr 含 `heartbeat_stale`、事实行与出口行、worker 与两组都仍活着（前提）→ 另起 `--start` 同阶段退 70（W5 的死路，前提的因果证据）→ 记 status.json 字节与闸门 → `--cancel`：退 0；stderr 含「未响应 SIGTERM」（升级确实发生）与两行「按记录结束审查员 CLI」；worker 已不在；两组成员数为零；run.json `failed` + `termination { worker_lost, heartbeat_stale }`；主题任务文件登记 `failed`；锁文件不在；status.json 逐字节不变；闸门不变；之后同阶段 `--start` 退 0（锁的死路解开，随即 `--cancel` 收掉它）。**计时只防挂死**：上界 `WORKER_TERM_GRACE_MS + ORPHAN_KILL_CONFIRM_MS + WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 3000`（CODEX-03），主判据是信号序列、组成员数与 run.json 三格；超界先存读数、别当实现回归。
- **J2**（c″-慢）：同 J1 但不堵 → `--wait` 判 heartbeat_stale（P1 读数）→ `--cancel`：stderr **不含**「未响应 SIGTERM」、含「在宽限内响应 SIGTERM」；worker.log 含「收到 SIGTERM：已按组终止审查员 CLI」（处理器自己收拾的因果证据）；两组为零；run.json `failed`（worker_lost / heartbeat_stale）；锁已回收。
- **J3**（凭据）：J1 的构造里，`--wait` 之前在 glm 侧放假载体（同 EV-154 I6）→ `--wait` 不抹（既有行为）→ `--cancel` 之后载体**仍在**（本格不抹，用户决策 7）→ 触发会话启动 Hook ⇒ 载体被抹（worker 与 CLI 都已不在，`admitScrub` 放行）。
- 既有须保持绿：EV-154 I3～I7、EV-152 I1 / I2、:949、:1388、EV-142 X1 / X2 与 W 系列、EV-150 P 系列、`worker-detach.test.ts`、`retention.test.ts` 全部。
- 实施时先在未变异的构建上确认每条被断言的文案确实落在被断言的流（stdout / stderr / worker.log）里，再定变异规格。

### 5.3 变异（`scripts/mutation-check.mjs`；规格由生成脚本从源码截锚点并逐条核对唯一，照搬 `evidence/cli-pgroup-record-20260928/gen-mutation-spec.mjs`；失败用例名与文案用同目录 `mutation-names.mjs` 补，确认没有前置失败）

| # | 变异 | 期望套件（应红的用例） |
| :-- | :--- | :--- |
| N1 | `waitRun` 不记 `lost` | `run-protocol.test`（K2、K3） |
| N2 | `lostOf` 不校验 `reason` 枚举（任意字符串都算） | `status.test`（K1） |
| N3 | 判格不看 `lost.reason`（任何 `lost` 都算） | `run-protocol.test`（K5②） |
| N4 | 判格不看 phase（success 也算） | `run-protocol.test`（K5③） |
| N5 | 判格不看启动时刻（活着即算同一进程） | `run-protocol.test`（K5④） |
| N6 | 身份守卫只判 null（空串、pid 为 1 放行） | `run-protocol.test`（K5⑤） |
| N7 | 结束工作进程不升级 SIGKILL（宽限后直接返回） | `gate-loop.test`（J1） |
| N8 | 不按记录结束 CLI | `gate-loop.test`（J1） |
| N9 | 未确认退出也补收 run.json（`workerGone` 恒真） | `run-protocol.test`（K4） |
| N10 | 未确认退出也回收锁 | `run-protocol.test`（K4） |
| N11 | 锁只比 `run_id` 不比 `pid` | `run-protocol.test`（K6） |
| N12 | `termination` 写成别的（如 `worker_exception`） | `run-protocol.test`（K3） |
| N13 | 本格改写 status.json（phase 置 cancelled）——同时让第二次调用不再入格 | `run-protocol.test`（K3、K4） |
| N14 | 本格抹凭据副本 | `gate-loop.test`（J3） |
| N15 | heartbeat_stale 报错不带事实行 | `run-protocol.test`（K2） |
| N16 | `mismatch` / `no_identity` 两格跌回「无需取消」 | `run-protocol.test`（K5④⑤） |

### 5.4 零配额验收（scratchpad → `evidence/lost-worker-cancel-20260928/`）

**新旧两份构建**（沿用上一主题做法）：新 = 工作树 `npm run build` 之后的 bundle；旧 = `git archive` 固定提交 `50cb380`（环境变量可覆盖，不写 `HEAD`）+ `.reviews/`，解包到 mkdtemp，`node_modules` 软链工作树，**不叠加任何文件**（`hang_cli` 的 `blockAfterMs` 在旧构建里已有；实施时核对 `stub.ts` 相对 `50cb380` 无 diff，有则只叠加桩），`node scripts/build.mjs --with-tests`。两份都直接 `node 〈bundle〉` 调用、记 sha256 并断言不同。夹具 `run_root` 在 mkdtemp 下，**绝不指向真实运行根**；`heartbeat_stale_s: 2`。

| 格 | 构建 | 做法与判据 |
| :-- | :--- | :--- |
| C1 | 新 | J1 的序列：`--wait` 判 heartbeat_stale → `--cancel` ⇒ worker 与两组都不在、run.json failed（worker_lost / heartbeat_stale）、登记 failed、锁不在、status.json 前后 sha256 相同；之后同阶段 `--start` 能起跑；耗时进读数 |
| C2 | 旧 | 同 C1 ⇒ `--cancel` 打「已处于终态」；worker 与两组仍在；run.json running；锁仍在；同阶段 `--start` 退 70（复现 EV-146 原文，存档 P2 读数） |
| C3 | 新 / 旧 | J2 的序列（不堵）：新 = 处理器自己收拾、不升级、run.json failed；旧 = 什么都不动（存档 P1 读数） |
| C4 | 新 | C1 之后再 `--cancel` ⇒ 终态早退原样两行，run.json 与 status.json 的 sha256 不变 |
| C5 | 新 / 旧 | 上一主题 B3（b 格）与 B6（c′ 格）照原判据各跑一遍：两侧读数相同（本主题不改这两格） |
| C6 | 新 | 凭据：C1 的构造放假载体 ⇒ `--cancel` 后仍在；`trivium scrub` ⇒ 被抹 |
| C7 | 新 / 旧 | 常态格 a 回归（沿用上一主题 B8：`hang` 桩与 `hang_cli` 桩各走一遍 `--start` / `--cancel`），stdout 逐行相同，stderr 归一化后逐行相同（pid、run_id、时间戳、路径、**主题名**） |
| C8 | 新 → 旧 | 回滚方向：新构建按 C1 的前半段产出一份带 `lost` 的 status.json（worker 与 CLI 先由脚本按组结束），旧构建对它跑 `--status --json`（`lost` 原样透出、退出码与新构建相同）与 `--cancel`（终态早退、不报错） |

`npm run check` 全绿（起点 2188 / 2186 / 0 / 2；EV-149 / EV-153 若偶发红，单跑复核、截失败文案后如实记录），`doctor --selftest` 14/14。全量跑着时不改文档，文档改完重跑一次。

---

## 6. 文档同步

| 文件 | 位置 | 改成 |
| :--- | :--- | :--- |
| 主设计 → **v1.3.54** | 7.5 `review --cancel` 行 | 追加：status.json 为 failed、`lost.reason` 为 heartbeat_stale 且工作进程仍是同一进程时，按组结束它（宽限后 SIGKILL）并确认退出，再按记录结束 CLI、补收 run.json 与登记（`termination` 同 `--wait`）、按 run_id + pid 回收锁；status.json 不写、闸门不动、凭据不抹；身份判不上或缺失时如实告警、不发信号。**单元格保持单行** |
| | 7.5「工作进程的信号语义」覆盖矩阵 | c″ 格改为已覆盖；新增 c″-已死（EV-159）、c″-错配（EV-158）、c″-无身份三行 |
| | status.json 字段描述（`sides[c].cli` 所在处） | 补 `lost`（对外 JSON 加法） |
| | 6.7 注记 / 6.7.1 `termination` | `worker_lost` 的写者补 `--cancel` 这一格 |
| | 故障表 `worker_lost` 行、验收表 | 心跳过期而进程还在 ⇒ 报错先列事实再给出口；由 `--cancel` 结束并补收 |
| | 变更记录 | 加 v1.3.54 行 |
| LLD → **v1.1.12** | `waitRun` 一节、`cancelRun` 一节、已知缺口表 | 同上；已知缺口表 EV-146 行改为已覆盖，新增 EV-159、EV-160 行；EV-158 行后果栏补本格的错配告警 |
| MANUAL → **v1.0.12** | 取消一节 :623 一带、:640-644 | 「心跳过期而进程一直挂着时，目前只能在终端手工结束」改为：`--wait` 报错里的事实行怎么读（心跳年龄、阈值、30 s 间隔）；再跑 `--cancel` 会结束它与它的 CLI、补收归档 run.json、回收锁；输出里的几种结局怎么读（宽限内响应 = 可能只是慢；升级 SIGKILL = 堵住；未能确认退出 ⇒ 可再跑一次，若改为手工结束，之后归档 run.json 与运行登记要人工核对（EV-159））；身份判不上的告警 ⇒ 换回 `--start` 的终端环境再跑；凭据副本留给下次会话启动 |
| PROTOCOL | `review --start / --wait / --status / --cancel` 行、`termination` 段（:60） | `--cancel` 段同主设计；`--wait --json` / `--status --json` 的 `status` 多出 `lost` 键（**对外 JSON 形状的加法**，旧调用方忽略，CODEX-05）；`termination` 的 `worker_lost` 写者补一条 |
| BACKLOG | EV-146 → done；EV-158 注记（本格的错配形态）；EV-157 注记（本格不抹、留给会话启动）；新登 EV-159（D8）、EV-160（CODEX-02） | 见 §8 |
| run.v2 schema、`types.ts`、`meta.ts` 注释 | §4.5 | 只改说明文字 |
| PRD | — | **核后定**：预期不改（PRD 对 `--cancel` 只有 FR-24「记 cancelled」，对失联后的恢复有无需求条目实施时 grep 核实） |
| skill 与入口资产、`.reviews/README.md`、CLI 帮助 | — | 不改：`--cancel` 的调用方式不变，skill 正文不提失联后的处置（已 grep 核实 `skills-src/` 无「失联」「worker_lost」）；skill 对非 0 / 73 的 `--wait` 退出码按原样转述报错，事实行与出口行随之到达用户 |

实施时 `git -c core.quotepath=off grep` 反扫「EV-146」「手工结束」「无需取消」「heartbeat_stale」，面含 `doc/`（排除 evidence 与历史报告）、`skills/`、`skills-src/`、`src/`、`test/`，剩余命中逐条判断是历史说明还是漏改。

---

## 7. 误判代价与相邻条目的交互

### 7.1 误判：心跳只是慢，worker 其实在正常推进或收尾

`heartbeat_stale` 只说明「status.json 超过阈值没被写」。worker 活着而不写的成因有两类：事件循环被堵住（本格要救的），和只是慢——心跳 30 s 一次而阈值被调小（P1；配置只约束 `> 0`，事前没有告警 → EV-160）、机器休眠唤醒后墙钟跳过了阈值、磁盘满导致心跳写失败（`catch` 吞掉，:931-933）。后一类里 worker 其实在推进。

**操作者是怎么走到 `--cancel` 的**（CODEX-01）：r2 起，`--wait` 的失联报错第一次向人推荐 `--cancel`——所以不能只论证「用户主动敲 `--cancel` 就是要它停」，还要让被推荐的那一刻看得到判断依据。事实行（心跳年龄、生效阈值、30 s 间隔，阈值不大于间隔时明说「健康的工作进程也会被判失联」）与出口行（「它若只是慢，这样做会结束一个仍在推进的轮次」）同屏；本格开场句在发信号之前再说一次判定之后 status.json 有没有被写过。本主题把「阈值配小」这一误判的后果从「什么都不发生」升级成了「可被结束」，事前告警留给 EV-160。

| 情形 | 不取消（今天与之后都一样） | 取消（本主题之后） | 代价 |
| :--- | :--- | :--- | :--- |
| A. 慢、审查员仍在跑 | worker 跑完后自己改写 status.json 的 phase、写 run.json 终态 | SIGTERM ⇒ 处理器转发给 CLI 并退出（不升级）；run.json 补收为 failed（worker_lost / heartbeat_stale）；输出说「在宽限内响应 SIGTERM——失联判定可能只是心跳慢」 | 这一轮审查作废、已花的配额白花。**与对一个正常运行中的轮次 `--cancel` 完全同价**——用户敲 `--cancel` 就是要它停。今天的「已处于终态，无需取消」在这一格反而是错的：worker 还在跑、之后还会改写 status.json |
| B. 慢、正在收尾，归档 run.json 已写成终态 | worker 写完 status.json 终态、放锁退出 | 同上结束它；run.json 已是终态 ⇒ 不追溯改写（输出说明）；status.json 停在 `--wait` 写的 failed（worker 没来得及写自己的结论）；锁由本格回收 | status.json 与 run.json 结论可能不一致（status 说失联、run.json 说 success）——两者各自如实：status.json 记的是失联判定，run.json 记的是 worker 写下的结论；审查文档已落盘。与 EV-128 主路径「取消落在收尾段」同一窗口 |
| C. 失联判定之后 worker 恢复并写下 `failed` 终态 | 它随即放锁退出 | 若恰在它退出前的毫秒级窗口里 `--cancel`：结束一个即将退出的进程；run.json 已终态不改；锁回收（它若已放锁则「不归本运行」一句） | 可忽略 |
| D. 写审查文档的中途被结束 | — | 部分审查文档已落盘而 run.json 补收为 failed；`artifacts[]` 按骨架原样 | 与 EV-128 主路径、EV-150 同一形态，既有的提交锚口径覆盖（`runningRewriteViolation` 只查 run_id 与已登记条目） |

**结论**：误判时唯一的额外损失是「一个本可自己跑完的慢轮次被结束」，而那正是 `--cancel` 的语义；推荐的那一刻与执行的那一刻都先列事实，执行之后按信号序列区分「堵住（升级 SIGKILL）」与「只是慢（宽限内响应 SIGTERM）」。不在本格里去猜「它是不是只是慢」而拒绝执行（比如看到心跳恢复就不杀）：猜对了也只是把 `--cancel` 变成「有时不取消」，与用户的明确意图相反。

### 7.2 EV-157（凭据准入）

本格不抹凭据副本。副本在 `--wait` 那一刻已因 worker 仍在而跳过（W2），本格结束 worker 与 CLI 之后，会话启动清扫与 `trivium scrub` 经 `admitScrub`（`workerConfirmedGone` + `cliGroupsConfirmedGone`）会放行——今天 heartbeat_stale 的副本同样要等到那里，本主题不让它更晚。EV-157 说的「`--cancel` / `--wait` 自己的准入不核 CLI」在本格里不出现：本格根本不走准入。J3 / C6 钉住。

### 7.3 EV-158（`worker_started_at` 对环境敏感）：身份判错的两个方向

身份判据是 `processAlive(worker_pid, worker_started_at)`：`--start` 以它自己的环境取 `ps -o lstart=` 写进 status.json，`--wait`、`--cancel` 各在自己的环境里重取、按字符串比。

**方向一：活着的 worker 被判「不是同一进程」**（假阴性；环境不同就会发生，是现实形态）。
- 发生在 `--wait` 那一刻：`interpretStatus` 判 `pid_gone` 而不是 heartbeat_stale ⇒ 根本进不了本格；而且 `--wait` 会在 worker 仍活着时把 run.json 写成 failed（pid_gone）、抹凭据副本——这是 EV-158 既有的危害，本主题不改也不加重。`lost.reason` 记的是 `pid_gone`，本格按结构化事实不入。
- 只发生在 `--cancel` 这一刻（`--wait` 与 `--start` 环境相同，`--cancel` 换了终端）：判格得 `mismatch` ⇒ **不对 worker 发信号**；随后仍走 D3（`workerConfirmedGone` 同样判「已不存在」）⇒ 按记录结束 CLI（CLI 记录的启动时刻是规范化的，判 `alive` 的确实是那几组 CLI，结束它们本身没有打错对象）；run.json、锁都不动。**worker 继续挂着**，与今天相同。本主题加告警：「工作进程 〈pid〉 上有活进程，但启动时刻与 status.json 的记录不符：可能是 PID 已被复用，也可能是本命令的 TZ / 区域设置与 `--start` 不同（BACKLOG EV-158）——不对它发信号。若确认是后者，请在与 `--start` 相同的环境里再跑一次 `--cancel`」；stdout 不再说「无需取消」，改说「身份与记录不符，未对工作进程发信号；归档 run.json 与主题锁未动」（AGY-01）。

**方向二：别的进程被判成 worker**（假阳性）。要求 pid 被复用、且新进程的 `lstart` 串在 `--cancel` 的环境里恰好等于记录值：同一环境下是「同一秒内复用」（上一主题 §7.2 秒级精度，按罕见处理）；环境不同时只剩一个巧合——新进程恰好在「记录时刻 + 时区差」那一秒启动。后果是对它的进程组发 SIGTERM / SIGKILL。这与主路径对 running 运行的判据同一风险类别；本格把它延伸到了终态运行，而终态运行可能隔了几天才被取消、pid 复用的机会更多，但启动时刻相等的要求不变，量级仍是罕见。**不为本格另立规范化锚点**（D2）：见 §9 的备选与理由。

修 EV-158 时须一并复核：本格判格（`classifyLostCancel`）是它的又一个消费方——BACKLOG EV-158 注记里补这一条。

### 7.4 EV-142 的前提

EV-142 不在「进程未确认退出」时写 run.json，理由是可能还有写者、两边会互相覆盖。本格在写之前自己结束了那个写者，并按 pid + 启动时刻观察到它退出（第 2 步），前提由此成立；第一步仍在主题任务锁里判与写、仍为 running 才写，所以与 `--wait`、worker 异常分支、主路径 `--cancel` 并发时每份 run.json 至多一次终态写入。worker 的 SIGTERM 处理器不写 run.json（EV-152 冻结 `run()`、以 SIGTERM 自杀），所以「没升级」那一支也不会与本格争写。

### 7.5 如实保留

- c″-已死（D8 → EV-159）：`--wait` 判 heartbeat_stale 之后 worker 自己死了、被手工结束，或本格第一次 `--cancel` 在第 2 步之后中断——run.json 仍停在 running，再跑 `--cancel` 走终态早退的 `gone` 格、不补。本格内的中断窗口是第 2 步确认退出到第 4 步写完之间（毫秒级）。本格「未能确认退出」告警与 MANUAL 都写明：改为手工结束之后，归档要人工核对（CODEX-07）。
- **闸门的中断窗口**（GLM-01）：`--wait` 死在写 failed + `lost`（:1173-1177）与回收闸门（:1184）之间时，闸门停在 running；本格按用户决策 4 不动闸门，再跑 `--cancel` 也收不到它。本格结束 worker 之后，下次会话启动的 `sweepDeadRunningGates`（`hooks.ts` :1711 起）按「running 且 worker 已死」回收，另有闸门 TTL 兜底。今天同一窗口 worker、锁、闸门全卡住，本主题只把前两样解开。
- **无身份的成因**（CODEX-04 的有效部分）：`--start` 取 worker 启动时刻的 `ps` 失败或超时（上限 10 s）时 status.json 与锁里同为 null（W6），这类运行不入本格、打告警；量级取决于 `ps` 失败率，本机没有读数。
- 判定与发信号之间的窗口：`isGone` 复核之后、`kill(-pid)` 之前 worker 退出且 pid 被复用——与主路径同一口径，毫秒级。
- 形状坏的 `lost`：不入本格（fail-safe 方向是不杀）。
- 其余实测只在 Node v25.2.1 / macOS。

### 7.6 对既有不变量

- 终态分支在本格与 `mismatch` / `no_identity` 两格之外逐字不变（K5 ①②③⑥、C5、C7）。
- `--cancel` 的历史语义：本格仍不写 status.json；run.json 只在仍为 running 时写一次（EV-142 / EV-133 口径）。
- `--wait` 的判定与返回不变；只在写 failed 时多一个键、heartbeat_stale 的报错多两行。
- status.json 的写者不变（`lost` 由 `--wait` 写，与它写 failed 同一次）。
- 主路径 `--cancel` 的输出逐字不变（`reportFinalizeStep` 的新参数有缺省值，K9）。
- 回滚：`lost` 旧读者忽略，run.json 没有新取值；回退 `status.ts`、`run-protocol.ts` 与用例、说明文字即可，由用户在终端重装。

---

## 8. BACKLOG

- **EV-146 → done**：本格的修法、`lost` 字段、误判代价的结论、J1 / J2 / C1～C3 的读数；去向：c″-已死 → EV-159；c″-错配 → EV-158 注记；阈值配小的事前告警 → EV-160。
- **EV-158 注记**：v1.3.54 起 `classifyLostCancel` 也消费该判据；环境错配时本格不入、打告警，活 worker 仍挂着、D3 结束其 CLI（§7.3）。
- **EV-157 注记**：本格不走凭据准入、不抹副本，结束之后留给 `admitScrub`（§7.2）。
- **新登 EV-159**（D8）：「`--wait` 判 heartbeat_stale 之后 worker 已不在时，run.json 没有补收入口」——形态：worker 自己死了 / 被手工结束 / 本格被中断；它同时是「手工结束挂住的 worker」之后唯一的归档闭环缺口（CODEX-07）。候选：终态分支在 `lost.reason === 'heartbeat_stale'` 且 `workerConfirmedGone` 为真时同样调 `finalizeFailedRunMeta`（仍为 running 才写，天然幂等），与 D3 结束 CLI 并列；要论证的只有「worker 已不在」这一前提在错配环境下的假阳性（EV-158 方向一会让活 worker 被判已不在 ⇒ 在它还活着时写 run.json，正是 EV-142 要防的两写者），所以排在 EV-158 之后。用户决策「例外只开一格」，**暂缓**。
- **新登 EV-160**（CODEX-02）：「`heartbeat_stale_s` 不大于工作进程心跳间隔（30 s）时，预检与 `--start` 都不告警」——配置只约束 `> 0`；这样配时每一轮都会被判 heartbeat_stale，而本主题起失联报错会推荐 `--cancel`。r2 已在判失联那一刻的报错里说出这条事实；候选：`--start` 与预检的 `warnings` 加一条（形状同既有警告，skill 已会原样转述）。不属 EV-146，**暂缓**。
- **不另立**：「`--wait` 判 heartbeat_stale 时不写终态」那条路（EV-146 原文的另一候选）——碰 `--wait` 的失联语义、闸门回收与凭据准入的时机，影响面更大；本主题的做法已让 `--cancel` 覆盖这一格，没有剩余动机。

---

## 9. 决策点

**用户已定（送审前，2026-09-28）**：

1. 只做 EV-146；EV-157、EV-158 不并入，计划写清交互（§7.2、§7.3）。
2. 例外只开给一格：status.json 为 failed、失联原因是 heartbeat_stale、worker 仍是同一活进程；判据取结构化事实、不解析人读文案；可给 status.json 加可选字段（旧读者忽略），不新增运行目录文件。
3. 动作次序：按组结束 worker（复用 `terminateProcessGroup` 的宽限链，宽限后 SIGKILL）并确认退出 → 按记录结束 CLI（复用 `terminateRecordedCliGroups`）→ 按 EV-142 前提把仍为 running 的 run.json 与登记补收为 failed。
4. status.json 的 phase、message 不改写；锁在确认退出后按 run_id 与 pid 复核回收；闸门不动。确认不了退出时 run.json 不写、锁不动，输出如实说明。
5. 误判代价在计划里论证；杀掉可接受，输出按事实说。
6. 不花配额做真实 CLI 实测。
7. 这一格不抹凭据副本（EV-157 范围不动）。
8. 超范围的问题登记暂缓、写清理由，不停下。

**本稿自定**：

- **D1 结构化事实 = status.json 新增 `lost: { reason, at }`**，由 `--wait` 在写 failed 的同一次写入里记；三种原因都记（`no_status_file` 无处可写）、本格只认 heartbeat_stale；形状坏即当没有。备选一：只记一个布尔 `heartbeat_stale`——`reason` 与 run.json `termination.reason` 同源同枚举，记全了将来 EV-159 与复盘都用得上。备选二（CODEX-05）：不加字段，用「status.json 为 failed + 归档 run.json 仍为 running + worker 仍是同一活进程」组合判格——不取：① 要跨读归档（`resolveTopic` / `readRunMeta`），读不出、run.v1、task 锁争用都要另论；② 记不下失联原因，而用户决策 2 要的判据本身就是「失联原因是 heartbeat_stale」；③ run.json 停在 running 的成因不止失联一种（EV-145 / EV-151 那几格、`finalizeFailedRunMeta` 单步写失败），组合判据会把它们一并卷进「可以杀」的格子。代价：`lost` 进了对外 JSON 面（加法），PROTOCOL 写明、C8 钉回滚方向。
- **D2 身份判据沿用 `processAlive(worker_pid, worker_started_at)`**，只认 status.json 里的两项、加类型守卫、不回落 `worker.pid`、不取锁里的同一值。备选：`--wait` 判失联时顺手取一份规范化启动时刻（`processStartTime(pid, { canonical: true })`）记进 `lost`，本格按它判——能让本格不受 EV-158 影响，但那是 EV-158 的局部修法：同一条 `--cancel` 里本格说「同一进程」、随后别处的 `workerConfirmedGone` 说「已不在」，两套判据互相矛盾；修 EV-158 该一次覆盖全部消费方并论证过渡。**不取**，以告警（§7.3）换一致。
- **D3 SIGKILL 之后等确认**（`killWaitMs: ORPHAN_KILL_CONFIRM_MS`），与主路径的 `killWaitMs: 0` 不同：主路径之后另有 `workerConfirmedGone` 复判，本格后面三步都以「确认退出」为前提，确认就在这里做。
- **D4 worker 没确认退出时仍按记录结束 CLI**：与主路径 b 格同口径（升级之后不论是否确认都按记录结束）；CLI 记录的判定独立于 worker（规范化启动时刻），结束它们不依赖 worker 的状态；run.json 与锁不动。备选：一并跳过——worker 卡在内核态（极罕见）时留下在烧配额的 CLI，不取。
- **D5 `termination` 沿用 `{ by: worker_lost, reason: heartbeat_stale }`**：与 status.json 的失联判定一致、schema 取值面不动；代价是归档里看不出「之后被 `--cancel` 结束」。备选：新增 `by` 取值（如 `cancelled_after_lost`）——要动 schema 枚举、`types.ts`、`report` 说明、S3 用例与「只增不减」的回滚面，而多出来的信息只是「谁结束了挂住的进程」，不改变这轮运行失败的结论。
- **D6 退出码两种结局都是 0**：与主路径同口径（主路径升级 SIGKILL 后没确认退出也退 0、靠告警）；PROTOCOL 里 `--cancel` 的退出码约定不变；未确认退出后的自救是再跑一次（判格可重入，K4 钉）。备选：未确认退出时退 1——对脚本调用方更直白，但让同一命令在两条路径上对同一结局给出不同退出码。
- **D7 status.json 一个字节都不写**（含不清 CLI 记录）：与 EV-154 D3 终态分支同口径；顺带让判格可重入。
- **D8 c″-已死格暂缓**（EV-159，§8）。
- **D9 `--wait` 的 heartbeat_stale 报错先列事实再给 `--cancel` 出口**（CODEX-01）：70 的报错已指向 `--cancel`，失联报错也该指，否则人只会在 MANUAL 里读到「只能手工结束」；推荐与判断依据同屏。
- **D10 锁按 run_id + pid 复核**：比主路径多比 pid——本格发生时距 `--start` 可能已很久，锁若已被新一轮接管（run_id 不同）或内容被改写（pid 不同），都不是本运行 worker 的锁。
- **D11 `mismatch` / `no_identity` 两格打如实结论、不跌回「无需取消」**（AGY-01）：其余终态的两行逐字不变。

---

## 10. 流程（命令 A，一口气跑）

1. 计划双审 → 逐条裁决（`…-revised-claude.md`）→ `gate --check`。✅（15 条，gate 通过）
2. 认领 code 阶段 → 按本稿实施；编码阶段就把 §5 全做完，报告 `doc/05_testing/REPORT_2026-09-28_lost_worker_cancel.md`，evidence `lost-worker-cancel-20260928/`；文档同步。
3. 代码双审 → 逐条应答 → 按已接受项修订并重跑读数、写进报告 → `trivium verify`。
4. 停：不提交、不推送、不审批，等用户。

---

## 附录：计划双审第 1 轮意见的落点

| 意见 | 裁决 | r2 落点 |
| :--- | :--- | :--- |
| CODEX-01 | 接受 | §4.2 事实行与出口行；§4.4 第 1 步开场句与「判定之后又写过」告警；§7.1「操作者是怎么走到 `--cancel` 的」；§5.1 K2；§5.3 N15；D9 |
| CODEX-02 | 暂缓 | §0 不做栏；§7.1；§8 EV-160 |
| CODEX-03 | 接受 | §5.2 J1 界式与「计时只防挂死」 |
| CODEX-04 | 驳回 | 判据不改；§1.1 W6、§3 c″-无身份行、§4.3、§7.5 写明成因与「锁里是同一个值」 |
| CODEX-05 | 接受 | §9 D1 备选二；§4.1「对外面」；§6 PROTOCOL 行 |
| CODEX-06 | 接受 | §1.4 出处；§1.3 U8 出处；§5.1 K 前缀与 K4 可重入；§5.3 N13 |
| CODEX-07 | 接受 | §4.4 第 2 步未确认告警与第 4 步后半句；§6 MANUAL 行；§7.5；§8 EV-159 |
| AGY-01 | 接受 | §3 c″-错配 / c″-无身份行；§4.3 代码段；§5.1 K5 ④⑤；§5.3 N16；§7.3；D11 |
| AGY-02 | 接受 | §1.2 C6；§4.3 类型守卫；§5.1 K5 ⑤ 参数化；§5.3 N6 |
| AGY-03 | 接受 | §4.4 第 4 步；§5.1 K9；§7.6 |
| GLM-01 | 接受 | §7.5「闸门的中断窗口」 |
| GLM-02 | 接受 | 同 AGY-02 |
| GLM-03 | 接受 | §1.4 |
| GLM-04 | 接受 | §4.1 写者条；D1 |
| GLM-05 | 接受 | §1.3 |
