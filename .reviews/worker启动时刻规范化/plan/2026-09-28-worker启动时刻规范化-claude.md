# worker启动时刻规范化 实施计划（r1）

> **性质**：BACKLOG EV-158。**不属任何里程碑**。EV-159、EV-157、EV-160 **不并入**；EV-158 修好之后 EV-159 还差什么见 §8。
> **一句话**：worker 与主题锁的启动时刻今天按写者自己的缺省环境取 `ps -o lstart=`、读者在各自环境里重取、按字符串比，TZ 或区域设置一不同，活着的 worker 就被判「不是同一进程」。本主题**不动既有字段**，在 status.json 与锁文件各加一个可选字段记**规范化启动时刻**（`LC_ALL=C`、`TZ=UTC0`，与 CLI 进程组记录同一形态），三个写者在写既有字段的同一处一并写；全部身份判据改经一个读法：记录里有规范化字段就只按规范化形态比（读者自己也按规范化环境取），没有（旧版写的）就退回今天的缺省环境比较。
> **用户已定（2026-09-28，送审前）**：只做 EV-158；写法——不改既有字段的形态与含义，新增可选字段（status.json 一个、锁文件一个，字段名由本计划定），写者在写既有字段的同一处一并写，旧读者忽略新字段，不新增运行目录文件；读法——有规范化字段就只按规范化形态比，没有就退回今天的缺省环境比较，判据不得解析人读文案；取不到启动时刻时各消费方的处置保持今天的口径，失联后取消那一格的严格判据沿用；新旧两个方向（旧写新读、新写旧读）都要论证并验收；不花配额；超范围的问题登记暂缓、不停下。
> **本稿自定、请审查员重点看的**：字段名与「有」的判定（D1、D3）；读法收成一个共享函数、`sweepDeadRunningGates` 与 `--wait` 补收那一处不改（D2）；`startRun` / `settleOrphanedStart` 改写锁时**显式**覆盖新字段、不从 `--start` 自己的锁内容里带过来（D4，本主题最容易写错的一处）；`acquireLock` 对本进程的规范化启动时刻做进程内缓存（D5）；失联后取消那一格 `mismatch` 的告警按比对依据分写（D6）。
> **实测**（§2，零配额）：同一进程在 7 种环境下缺省形态 7 种各不相同、规范化形态始终 1 种（三次读数相同）。

- **日期**：2026-09-28
- **主题**：`worker启动时刻规范化`（`topic claim` plan → claude，2026-09-28T11:00:34Z）
- **起点**：`6b89cc0`（`main`，clean）。下文行号均取自该提交的**源码**（不取 `dist/test` 编译产物的行号）
- **上位**：BACKLOG EV-158（本主题，含 CLI进程组记录代码双审 r1 GLM-02 与失联后取消挂住的worker 两条注记）、EV-159 / EV-157 / EV-160（相邻，不并入）、EV-38（已 done，`admitScrub` 的 CLI 那一半）；
  `.reviews/CLI进程组记录/plan/` r2 §2 Q4（`lstart` 随 TZ 与区域设置变化的首次实测）与 §7.3（本条的登记出处：改法同规范化环境，但要单独论证过渡）；
  `.reviews/失联后取消挂住的worker/plan/` r2 §7.3（身份判错的两个方向）与代码双审应答件（CODEX-02：`mismatch` 格不结束 CLI；GLM-01：该格的严格退出判据 `lostWorkerGoneFrom`）；
  `doc/05_testing/REPORT_2026-09-28_cli_pgroup_record.md` 的 U16（规范化取值与调用方环境无关的用例）与 M15（去掉规范化环境的变异，让 U16 红）；
  主设计 v1.3.54、PRD v1.4.16、LLD v1.1.12、MANUAL v1.0.12
- **全量基线**：`npm run check` 2203 / 2201 / 0 / 2（`6b89cc0`，上一主题报告 §7）

---

## 0. 范围与不做

| 做 | 不做 |
| :--- | :--- |
| status.json 加可选字段 `worker_started_at_canonical`，锁文件加可选字段 `pid_started_at_canonical`（D1）；既有 `worker_started_at` / `pid_started_at` 的取法、形态、含义一概不变 | 改既有字段（例如直接把它们换成规范化形态）；新增运行目录文件；给 status.json / 锁文件补 JSON schema（两者今天都只有 TS 接口） |
| 三个写者在写既有字段的同一处一并写新字段：`startRun`（status.json 与改写后的锁）、`settleOrphanedStart`（补记 status.json 与改写锁）、`acquireLock`（长锁与短锁的初始内容）（§4.2） | 改 run.v2 schema、`termination` 取值、归档里任何文件 |
| `util/exec.ts` 新增共享读法 `processMatchesRecord`（§4.3）；八个身份消费方改经它（§4.4） | `sweepDeadRunningGates` 的判据（它只看存活，不受 EV-158 影响，§4.5）；`--wait` 补收那一处 `processAlive(fallbackPid, null)`（期望值为 null，不比启动时刻） |
| 失联后取消那一格：身份取法改经共享读法，严格判据 `lostWorkerGoneFrom` 沿用；`mismatch` 告警按比对依据分写（D6） | 改 `mismatch` 格「一个信号都不发」的处置（CODEX-02 的结论不动，§4.4 第 8 条）；EV-159 的补收（§8） |
| 单测、集成、源码变异、零配额验收（新旧构建对照，旧 = `6b89cc0`，含旧写新读与新写旧读两个方向）、doctor 自检；主设计 / LLD / MANUAL / PROTOCOL / BACKLOG 同步，PRD 核后定（§5、§6） | 真实厂商 CLI 实测（用户决策）；取不到启动时刻（`ps` 失败或超时）时各消费方的处置（保持今天的口径，§4.6）；本仓根 `CLAUDE.md`（EV-138） |

---

## 1. 现状（逐条对照代码，`6b89cc0`）

### 1.1 取值

- `processStartTime(pid, o)`（`util/exec.ts` :531-539）：以 `/bin/ps -p 〈pid〉 -o lstart=` 取，`o.canonical` 时环境叠加 `LC_ALL=C`、`TZ=UTC0`，否则继承调用方的 `process.env`（`run()` 在派生时拷贝 `process.env`，:194）。`ps` 非零退出或输出为空返回 null；超时 10 s。
- `processAlive(pid, expected)`（:500-521）：`kill(pid, 0)` 判存活（EPERM 也算活）；活着就以**缺省环境**取启动时刻；`expected` 为假值时 `sameProcess: true`（「缺失 = 相符」），否则 `sameProcess = 取到且逐字相等`。取不到（null）而 `expected` 非空 ⇒ `sameProcess: false`。
- 规范化形态今天只有 CLI 进程组记录在用（`run()` 登记 `killTree` 子进程时 :227、`judgeCliGroup` 判定时 `status.ts` :283）。

### 1.2 写者（三个，都按缺省环境）

| 写者 | 位置 | 写什么 |
| :--- | :--- | :--- |
| `acquireLock` | `lock.ts` :166-174 | 每次尝试都现取 `processStartTime(process.pid)` 写进锁内容的 `pid_started_at`；长锁（`kind: 'run'`）与短锁（`kind: 'critical'`，`withTopicLock` / `withGlobalLock`）都经它 |
| `startRun` | `run-protocol.ts` :433-448 | 派生后取 `workerStartedAt = processStartTime(spawned.pid)`，同一个变量写进改写后的锁（`{ ...lock.content, run_id, pid, pid_started_at }`，:434-442）与 status.json 的 `worker_started_at`（:444-448） |
| `settleOrphanedStart` | `run-protocol.ts` :621-640（确认不了退出一支）、:697-708（收尾一支） | 补记 `worker_started_at ??=`；锁仍是本进程内容时改写成 worker 的（`pid_started_at: startedAt`）；收尾一支 `s.worker_started_at ??= i.workerStartedAt` |

### 1.3 身份消费方（按字符串比启动时刻的）

| # | 消费方 | 位置 | 判据 | 环境不同时的后果（方向一：活 worker 判「不是同一进程」） |
| :-- | :--- | :--- | :--- | :--- |
| C1 | `interpretStatus` 情形 C | `status.ts` :390-395 | `processAlive(pid, raw.worker_started_at ?? fallbackPidStartedAt)`，不同 ⇒ `worker_lost / pid_gone` | `--wait` 把活 worker 判失联；随后 `workerConfirmedGone` 也判「已不在」⇒ run.json 写成 failed（EV-142 的两写者形态）、抹凭据副本 |
| C2 | `workerConfirmedGone` | `status.ts` :191-196 | `processAlive(pid, status.worker_started_at)`，不是同一进程 ⇒ `gone` | 取消、等待、会话启动清扫与 `trivium scrub` 的凭据准入在 worker 还活着时抹副本；`--cancel` 终态分支按记录结束活 worker 名下的 CLI（EV-154 D3；`mismatch` 格已跳过，CODEX-02） |
| C3 | `workerStillAlive`（到期整删与跨仓清扫的「活着就不动」） | `retention.ts` :99-103 | 同上，`alive && sameProcess` | 活 worker 的运行目录进入整删 / 抹除候选（整删要到期，抹除随后由 C2 放行） |
| C4 | `judgeStale` | `lock.ts` :80-83 | `processAlive(lock.pid, lock.pid_started_at)`，不是同一进程 ⇒ `pid_reused` | 新 `--start`（或任一短锁争用者）回收活 worker 的锁，新一轮与活 worker 并发 |
| C5 | `cancelRun` 主路径 | `run-protocol.ts` :1622-1654 | `processAlive(pid, s.worker_started_at)`；活着且同一进程才发信号 | 不对活 worker 发信号，走「已不存在」分支：按记录结束 CLI，随后 C2 判已不在 ⇒ 抹副本、收尾 cancelled——而 worker 仍在跑 |
| C6 | `workerGoneForCancel`（C5 的宽限期判据） | `run-protocol.ts` :727-730 | `!alive \|\| !sameProcess` | 发出 SIGTERM 之后（仅当 C5 判对了才会走到）立刻判「已退出」、不升级 |
| C7 | `classifyLostCancel` | `run-protocol.ts` :1391-1406 | 类型守卫后 `processAlive(pid, startedAt)`；活着而不同 ⇒ `mismatch` | 失联后仍挂着的 worker 判 `mismatch`，一个信号都不发（CODEX-02 之后连 CLI 也不结束） |
| C8 | `lostWorkerGone`（C7 之后的严格退出判据） | `run-protocol.ts` :1417-1425 | `lostWorkerGoneFrom(processAlive(pid, at), at)`：不在 ⇒ 已退出；取到且不同 ⇒ 已退出；取不到 ⇒ 未退出 | 只在 C7 判 `alive` 之后才会走到（同一 `--cancel` 进程、同一环境），环境错配已在 C7 挡下；但它是同一身份判据，要随 C7 一起换读法，否则 C7 按规范化判 `alive`、C8 按缺省形态判「取到且不同 ⇒ 已退出」，会在 worker 还活着时补收 run.json |

另有两处调 `processAlive` 而**不比启动时刻**，不受 EV-158 影响：`sweepDeadRunningGates`（`hooks.ts` :1748，只取 `.alive`）与 `waitRun` 补收那一处（`run-protocol.ts` :1154，`processAlive(fallbackPid, null)`）。`interpretStatus` 的 `fallbackPidStartedAt` 入参（`status.ts` :362、:378）生产代码从不传（`waitRun` :1118-1121 只传 `fallbackPid`）。

### 1.4 测试现状

- `test/unit/cli-group-record.test.ts` U16：进程内改 `process.env`（TZ / LANG / LC_ALL / LC_TIME）后取规范化启动时刻，两次相同；缺省的随之变化。它证明了「改 `process.env` 能改到 `ps` 的环境」，本主题的单测照这个办法构造「写者与读者环境不同」。
- `lock.test.ts`、`status.test.ts`、`retention.test.ts`、`run-protocol.test.ts` 里的既有用例都按缺省环境手工写 `pid_started_at` / `worker_started_at`（见 `grep`：`lock.test.ts` :27/:75/:85/:95/:115、`status.test.ts` :133/:155/:167、`retention.test.ts` :65/:109、`run-protocol.test.ts` :64/:232/:290/:527/:585-589/:955-1016）。它们写的都是**没有新字段**的记录，本主题之后恰好成为「旧版写下、新版读」的回归面，一律不改。
- `gate-loop.test.ts` 的真实 bundle 用例（EV-152 I1/I2、EV-154 I3～I7、EV-146 J1～J3）全在测试进程自己的环境里跑 `--start` 与读者，环境从没错开过。`test/helpers/fixture.ts` 的 `cli()`（:162-174）不收额外环境变量。

---

## 2. 实测（零配额，`probe-lstart.mjs`，Node v25.2.1 / macOS，三次读数相同）

脚本在 Driver 会话 scratchpad：以 `detached` 派生一个 `sleep 30`，对同一 pid 在 7 种环境下各取一次缺省形态与规范化形态（规范化 = 在该环境之上覆盖 `LC_ALL=C`、`TZ=UTC0`，与 `processStartTime(pid, { canonical: true })` 同形），收尾按组结束。实施时拷进 `doc/05_testing/evidence/worker-start-canonical-20260928/`。

| 环境 | 缺省形态 | 规范化形态 |
| :--- | :--- | :--- |
| 本会话缺省 | `Mon Sep 28 19:03:25 2026` | `Mon Sep 28 11:03:25 2026` |
| `TZ=UTC` | `Mon Sep 28 11:03:25 2026` | 同上 |
| `TZ=Asia/Tokyo` | `Mon Sep 28 20:03:25 2026` | 同上 |
| `TZ=America/New_York` | `Mon Sep 28 07:03:25 2026` | 同上 |
| `LC_ALL=fr_FR.UTF-8` | `lun. 28 sept. 19:03:25 2026` | 同上 |
| `LC_TIME=zh_CN.UTF-8` | `一  9月/28 19:03:25 2026` | 同上 |
| `LANG=de_DE.UTF-8 TZ=Europe/Berlin` | `Mo. 28 Sep. 13:03:25 2026` | 同上 |

- 缺省形态 7 种各不相同，规范化形态 1 种。`LC_ALL=C` 压过 `LANG` 与 `LC_TIME`，`TZ=UTC0` 压过调用方的 `TZ`。
- 一个巧合要记下：写者恰在 `TZ=UTC` 且区域设置为 C 时，缺省形态与规范化形态逐字相同。它不影响本稿的读法（有规范化字段就只比规范化字段），但验收里「旧写新读」的环境组合要避开它，否则看不出退回比较真的发生了（§5.4）。
- 系统时钟事后回拨、夏令时切换都不影响：`lstart` 是进程启动那一刻记下的绝对时间，规范化形态按 UTC 渲染。

---

## 3. 覆盖矩阵：写者 × 读者 × 环境

记号：**W** = 写者的环境（`--start`、或持锁进程），**R** = 读者的环境；「新 / 旧」指写者或读者的版本。

| 格 | 写者 | 读者 | 环境 | 今天（`6b89cc0`） | 本主题之后 |
| :-- | :--- | :--- | :--- | :--- | :--- |
| a | 新 | 新 | R = W | 同一进程 | 同一进程（比规范化） |
| b | 新 | 新 | R ≠ W | **判「不是同一进程」** | **同一进程**（比规范化，本主题要翻过来的格） |
| c | 旧 | 新 | R = W | 同一进程 | 同一进程（记录没有新字段 ⇒ 退回缺省比较，与今天逐字相同） |
| d | 旧 | 新 | R ≠ W | 判「不是同一进程」 | **不变**：仍判「不是同一进程」（退回今天的比较；升级窗口里在跑的运行与遗留锁，§7.1） |
| e | 新 | 旧 | R = W | — | 同一进程（旧读者忽略新字段、比缺省字段；缺省字段的写法没变） |
| f | 新 | 旧 | R ≠ W | — | 判「不是同一进程」（回滚之后与今天相同，§7.2） |
| g | 新 | 新 | 规范化字段写时取不到（null） | — | 退回缺省比较（同 c / d） |
| h | 新 | 新 | 读时规范化取不到（`ps` 失败 / 超时） | 缺省取不到 ⇒ `sameProcess: false` | 规范化取不到 ⇒ `sameProcess: false`，**各消费方处置与今天相同**（§4.6） |
| i | 任意 | 任意 | pid 已不在 | `alive: false` | 不变 |
| j | 新 | 新 | pid 被复用、新进程与记录同一秒启动 | 同一环境下误判为同一进程（秒级精度） | 不变（规范化形态同样只到秒；环境不同时今天多一个「恰差一个时区差」的巧合，本主题之后没有了） |

---

## 4. 改法

### 4.1 字段（D1、D3）

- **status.json**：`RunStatus` 加 `worker_started_at_canonical?: string | null`（`status.ts` :57-59 旁）。语义：`worker_pid` 那个进程的规范化启动时刻（`processStartTime(pid, { canonical: true })`）；null = 写时取不到；**缺席 = 旧版写的**。`newStatus` 写 `null`（与 `worker_started_at: null` 同处）。
- **锁文件**：`LockContent` 加 `pid_started_at_canonical?: string | null`（`lock.ts` :29-30 旁），语义同上、指 `pid` 那个进程。
- **「有」的判定**（D3）：`canonicalStartOf(v: unknown): string | null`——`typeof v === 'string' && v.trim().length > 0` 才返回 `v`，其余（缺席、null、空串、非字符串）一律当「没有」、退回缺省比较。理由：用户决策「没有（旧版写的）就退回今天的比较」；形状坏的值只可能来自手改，按「没有」处理就是今天的行为，不另立一格「判不了」。放 `util/exec.ts`，与读法同处。
- **对外 JSON 形状**：`--wait --json` / `--status --json` 整份透出 status，新键是加法；PROTOCOL 同步（§6）。

### 4.2 写者：在写既有字段的同一处一并写（D4、D5）

1. **取值助手**（`util/exec.ts`，`processStartTime` 旁）：`processStartTimes(pid): Promise<{ legacy: string | null; canonical: string | null }>`，两次 `ps` 并发取（`Promise.all`）。两次 `ps` 之间 pid 可能被复用？不会：调用方都是 `pid` 的父进程或 `pid` 本身（`startRun` / `settleOrphanedStart` 手里有子进程句柄，未观察到 `'exit'` 之前 pid 不会被复用；`acquireLock` 取的是自己），两次取到的一定是同一进程。
2. **`startRun`**（`run-protocol.ts` :433-448）：`workerStartedAt` 改由 `processStartTimes(spawned.pid)` 的 `legacy` 给（取法、形态不变），另得 `workerStartedAtCanonical`。改写锁时**显式**写 `pid_started_at_canonical: workerStartedAtCanonical`；`patchStatus` 里 `s.worker_started_at_canonical = workerStartedAtCanonical`，与 `worker_pid` / `worker_started_at` 同一次写入。
   - **D4 的要点**：锁的改写是 `{ ...lock.content, run_id, pid, pid_started_at }`。`lock.content` 是 `--start` 自己 `acquireLock` 写下的内容，自本主题起**带着 `--start` 进程的** `pid_started_at_canonical`。若改写时只覆盖 `pid_started_at`、不覆盖新字段，锁就成了「worker 的 pid + `--start` 的规范化启动时刻」——新读者按规范化比，（`--start` 与 worker 不在同一秒启动时）判 `pid_reused`，**下一个 `--start` 会把活 worker 的锁当遗留锁回收**，比 EV-158 本身还糟。所以改写收成一个纯函数 `workerLockContent(content, { runId, pid, startedAt, startedAtCanonical })`（`lock.ts`），`startRun` 与 `settleOrphanedStart` 两处都经它；它显式覆盖四个键（新字段值为 null 也写 null），由 U4 与 M2 钉住（§5.1、§5.3）。
   - 提到 `try` 之外的 `workerStartedAt`（:398）同样补一个 `workerStartedAtCanonical`，派生后失败时交给 `settleOrphanedStart`（入参 `OrphanedStartInput` 加 `workerStartedAtCanonical: string | null`）。
3. **`settleOrphanedStart`**（:620-640、:697-708）：确认不了退出一支，`startedAt` 旁另取 `startedAtCanonical = i.workerStartedAtCanonical ?? canonicalStartTimeOf(born.pid)`（注入口 `canonicalStartTimeOf?`，缺省 `processStartTime(pid, { canonical: true })`，与既有 `startTimeOf` 注入同形）；`patchStatus` 里 `s.worker_started_at_canonical ??= startedAtCanonical`；改写锁同样经 `workerLockContent`（D4 同一理由）。收尾一支 `s.worker_started_at_canonical ??= i.workerStartedAtCanonical`。
   - `??=` 与既有字段同一口径：status.json 若已由 `startRun` 写过两个字段（失败点在 `patchStatus` 之后），不覆盖。两个字段因此总是出自同一个写者、同一个 pid（§7.3）。
4. **`acquireLock`**（`lock.ts` :166-174）：`pid_started_at` 照旧每次尝试现取；新增 `pid_started_at_canonical: await selfCanonicalStartTime()`。
   - **D5**：`selfCanonicalStartTime()` 对 `process.pid` 的规范化启动时刻做**进程内缓存**（只缓存非 null）。理由：`withGlobalLock` 缺省 40 次重试、每次尝试都重建锁内容，`state.json` 的每一次读改写都经它；多一次 `ps` 就是每次尝试多一次派生。进程的启动时刻终生不变、规范化形态与环境无关，缓存不改语义。缺省形态**不**缓存：它随 `process.env` 变（测试会进程内改环境），缓存就改了今天的行为。取不到（null）不缓存，下次重试再取。

### 4.3 读法：一个共享函数（D2）

`util/exec.ts` 新增：

```ts
/** 记录里的启动时刻：规范化形态（EV-158 起写，可能缺席）与写者缺省环境下的形态（旧有） */
export interface RecordedStart { canonical?: unknown; legacy: string | null | undefined }

export async function processMatchesRecord(pid: number, rec: RecordedStart):
  Promise<{ alive: boolean; sameProcess: boolean; startedAt: string | null; expected: string | null; basis: 'canonical' | 'legacy' }>
```

- `canonicalStartOf(rec.canonical)` 非 null ⇒ **basis = canonical**：`kill(pid, 0)` 判存活（EPERM 也算活，与 `processAlive` 同）；活着就以 `processStartTime(pid, { canonical: true })` 取，`sameProcess = 取到且逐字相等`；取不到 ⇒ `sameProcess: false`（与今天「期望非空而取不到」同口径，§4.6）。**不再看 `rec.legacy`**（用户决策「有规范化字段就只按规范化形态比」）。
- 否则 ⇒ **basis = legacy**：原样调 `processAlive(pid, rec.legacy ?? null)`——逐字是今天的行为，含「期望为假值即相符」。
- 返回里带 `startedAt`（按 basis 取到的那个形态）与 `expected`（参与比较的那个记录值），供 C8 的严格判据用；带 `basis` 供 D6 的告警分写用。判据只用结构化字段，不读任何人读文案。
- `processAlive` 本身不改（C1～C8 之外还有两处只看 `.alive` 的调用，§1.3 末段），文档块补一句「身份比对请用 `processMatchesRecord`」。

### 4.4 八个消费方改经共享读法

| # | 改法 | 记录从哪取 |
| :-- | :--- | :--- |
| C1 | `interpretStatus` 情形 C：`processMatchesRecord(pid, { canonical: raw.worker_started_at_canonical, legacy: raw.worker_started_at ?? opts.fallbackPidStartedAt ?? null })`；情形 A（status.json 读不到）不变 | status.json |
| C2 | `workerConfirmedGone`：`processMatchesRecord(pid, { canonical: status.worker_started_at_canonical, legacy: status.worker_started_at ?? null })`；其余三格（读不到 / starting / 拿不到 pid）不变 | status.json |
| C3 | `workerStillAlive`：同 C2 | status.json |
| C4 | `judgeStale`：`processMatchesRecord(lock.pid, { canonical: lock.pid_started_at_canonical, legacy: lock.pid_started_at })` | 锁文件 |
| C5 | `cancelRun` 主路径：判存活那一处同 C2；`startedAt` 改为整份记录 `rec` 传给 C6 | status.json |
| C6 | `workerGoneForCancel(pid, rec: RecordedStart)`：`!alive \|\| !sameProcess`，改签名（唯一调用方 C5；导出供单测） | 同 C5 |
| C7 | `classifyLostCancel`：类型守卫改为「规范化字段有（D3）**或**缺省字段是非空字符串」，两者都没有 ⇒ `no_identity`（今天只看缺省字段；规范化字段有而缺省字段为 null 的记录——写时缺省 `ps` 失败、规范化成功——今天判 `no_identity`，之后可判）；比对经 `processMatchesRecord`；`alive` 格带上整份 `rec`；`mismatch` 格带上 `basis`（D6） | status.json |
| C8 | `lostWorkerGone(pid, rec)`：`lostWorkerGoneFrom({ alive, startedAt }, expected)`，`startedAt` / `expected` 取自 `processMatchesRecord` 的同名返回（同一 basis）。**严格判据本身不改**：不在 ⇒ 已退出；取到且不同 ⇒ 已退出；取不到 ⇒ 未退出。`CancelOptions.terminateWorker` 的第二个参数随之改为 `rec` | 同 C7 |

- **D6：`mismatch` 告警按 basis 分写**（`run-protocol.ts` :1600-1607）。basis = canonical 时环境差异已不可能造成不符，告警改为「启动时刻与 status.json 的规范化记录不符：PID 已被复用，或本次取不到它的启动时刻——不对它发信号，本次也未结束它名下的审查员 CLI；请用 ps 核对」；basis = legacy 时保留今天的句子，并注明「这份记录由旧版写下、没有规范化启动时刻」。**处置不变**：两种 basis 下都一个信号都不发、也不结束 CLI（CODEX-02 的结论；basis = canonical 时不符的成因还包括「本次 `ps` 取不到」，那一格照 §4.6 不改口径）。stdout 结论句不变。
- `LostCancelCell` 的 `alive` 格字段 `startedAt: string` 改为 `rec: RecordedStart`（开场句不打印启动时刻，不需要单独留一个形态）；`mismatch` 格加 `basis`。

### 4.5 不改的读者

- `sweepDeadRunningGates`（`hooks.ts` :1717-1760）：只取 `processAlive(…).alive`，启动时刻不参与判定，EV-158 不影响它（PID 被复用时它把复用者当 worker 仍活着、不回收闸门——保守方向，今天就如此）。它的文档块写着「经 `processAlive` 比对启动时间」，与实现不符；**只改注释**，写明「只看存活；PID 复用时保守地不回收，TTL 兜底」。
- `waitRun` 补收判据（:1150-1154）：status.json 读不到时 `processAlive(fallbackPid, null).alive`，没有记录可比，不改。
- `interpretStatus` 情形 A（:369-381）：用 `fallbackPidStartedAt`（生产不传），不改。

### 4.6 取不到启动时刻：保持今天的口径

| 消费方 | 今天：期望非空、读时取不到 ⇒ `sameProcess: false` 之后 | 本主题之后（basis = canonical 时读时取不到） |
| :--- | :--- | :--- |
| C1 | 判 `pid_gone` | 同 |
| C2 | 判 `gone`（可抹） | 同 |
| C3 | 不算活着 | 同 |
| C4 | 判 `pid_reused` | 同 |
| C5 / C6 | 不发信号 / 判已退出 | 同 |
| C7 | 判 `mismatch` | 同（告警按 D6 措辞） |
| C8 | 严格判据：未退出 | 同 |

写时取不到（新字段为 null）⇒ basis 退回 legacy，逐字是今天的行为。`processAlive` 对「期望为假值」给 `sameProcess: true` 的既有口径同样保留在 legacy 那一支里，本主题不借机收紧（EV-146 的 `classifyLostCancel` 类型守卫是唯一例外，今天就有，沿用）。

---

## 5. 验证

### 5.1 单测（新文件 `test/unit/start-canonical.test.ts`；`lock.test.ts`、`status.test.ts`、`retention.test.ts`、`run-protocol.test.ts` 各补一两条）

写者与读者的环境错开照 U16 的办法：进程内改 `process.env`（`TZ` / `LANG` / `LC_ALL` / `LC_TIME`），`try … finally` 还原。「写者环境」下现取两种形态造记录，「读者环境」下判。W = `TZ=Asia/Tokyo LC_ALL=fr_FR.UTF-8`，R = `TZ=America/New_York LANG=de_DE.UTF-8`（都不是 UTC、也不是 C，避开 §2 那个巧合）。被判对象是本格 mkdtemp 之外不写文件的 `detached` `sleep` 组（`test/helpers/proc.ts` 按标记收尾）。

- **U1**（`processMatchesRecord`，b 格）：W 下造的完整记录，R 下判 ⇒ `alive && sameProcess`、`basis: canonical`；同一记录 W 下判也相同。
- **U2**（c / d 格回归）：只有缺省字段（新字段缺席）⇒ `basis: legacy`；W 下判同一进程、R 下判不是同一进程——**与 `processAlive` 逐字相同**（断言两者返回一致），证明退回比较没有变。
- **U3**（D3）：新字段为 null、`''`、`'   '`、`123`、`{}` 各一格 ⇒ 都 `basis: legacy`。
- **U4**（D4，锁的改写不带 `--start` 的规范化启动时刻）：① 纯函数 `workerLockContent`：入参锁内容带 `pid_started_at_canonical: 'C-start'`，传 worker 的 `'C-worker'` ⇒ 输出为 `'C-worker'`；传 null ⇒ 输出为 null（不是 `'C-start'`）；`pid` / `run_id` / `pid_started_at` 同样被覆盖，`acquired_at` / `kind` / `topic` 保留。② `settleOrphanedStart` 注入 `canonicalStartTimeOf` 返回 `'C-worker'`，确认改写后的锁 `pid_started_at_canonical === 'C-worker'`；status.json `worker_started_at_canonical` 补记为 `'C-worker'`，已有值时不覆盖（`??=`）。
- **U5**（`acquireLock` 写两个字段）：`pid_started_at_canonical` 等于本进程规范化启动时刻；在 R 环境下拿到的锁、W 环境下 `judgeStale` ⇒ null（不回收）；把锁的新字段删掉再判 ⇒ `pid_reused`（d 格回归）。短锁（`withTopicLock`）同样带新字段。
- **U6**（C2 / C3）：W 下造 status（新字段齐），R 下 `workerConfirmedGone` ⇒ 不可抹；`pruneRunDirs` / `scrubAllRunRoot` 计 `kept` / `alive`；删掉新字段 ⇒ 回到今天（可抹、不算活）。
- **U7**（C1）：`interpretStatus` 情形 C，R 下 ⇒ `running` 而不是 `worker_lost`；删掉新字段 ⇒ `pid_gone`。
- **U8**（C6 / C7 / C8）：`workerGoneForCancel` R 下 ⇒ false；`classifyLostCancel` R 下（`failed` + `lost.heartbeat_stale`）⇒ `alive`；删掉新字段 ⇒ `mismatch` 且 `basis: legacy`；规范化字段填一个别的时刻 ⇒ `mismatch` 且 `basis: canonical`；只有规范化字段、缺省字段为 null ⇒ 不再是 `no_identity`（§4.4 C7）；`lostWorkerGone` 对活进程（R 下）⇒ false，对 `startedAt` 取不到的注入 ⇒ false（严格判据沿用）。
- **U9**（D6 措辞）：`cancelRun` 终态分支 `mismatch` 两种 basis 各一格，stderr 分别含「规范化记录不符」与「由旧版写下」；两格都不对 CLI 发信号（沿用 K5 ④ 的真实 detached 组断言形态）。
- **U10**（h 格口径）：`processMatchesRecord` 注入「规范化取不到」（新增可选第三参 `o.startTimeOf`，只为单测开）⇒ `alive: true, sameProcess: false`；据此 C2 判可抹、C8 判未退出——与今天 legacy 取不到时逐项相同。

### 5.2 集成（`gate-loop.test.ts`，真实 bundle + `hang_cli` 桩 + `test/helpers/proc.ts`）

`fixture.ts` 的 `cli()` 加可选第五参 `env`（叠加在既有 env 之上，缺省不变）。`--start` 在 W 下跑，被测读者在 R 下跑。每格收尾按标记结束 worker 与两侧桩 CLI 组。

- **I1**（写者）：`--start` 之后，status.json 与锁文件的新字段都等于 worker pid 的规范化启动时刻（测试进程现取），缺省字段仍等于测试进程在 W 下现取的缺省形态（取法没变）。「锁不带 `--start` 的规范化启动时刻」（D4）**不在这里判**：`--start` 与 worker 可能同一秒启动，两者的 `lstart` 逐字相同，集成断言咬不住——那一条由 U4 对纯函数 `workerLockContent` 直接钉住。
- **I2**（C1）：R 下 `--wait --timeout 3` ⇒ 退 73（仍在跑），status.json 仍非终态，归档 run.json 仍 `running`。
- **I3**（C2 / C3，会话启动清扫与 `trivium scrub`）：R 下 `hook-session-start` 与 `trivium scrub` ⇒ 两侧凭据副本（桩的载体文件）仍在；scrub 的 JSON 里本运行计 `alive`；闸门仍 `running`。
- **I4**（C4）：R 下同主题同阶段再 `--start` ⇒ 退 70（`LOCKED`），锁文件内容逐字节不变。
- **I5**（C5 / C6）：R 下 `--cancel` ⇒ 「向工作进程组 … 发送 SIGTERM」，worker 与两侧 CLI 组都结束，status.json / run.json 为 `cancelled`。
- **I6**（C7 / C8）：沿用 EV-146 J1 的构造（`heartbeat_stale_s: 2`、`blockAfterMs` 堵住事件循环），`--wait` 在 W 下判 `heartbeat_stale`，`--cancel` 在 R 下 ⇒ 入 `alive` 格、升级 SIGKILL、补收 run.json 为 failed、回收锁。
- **I7**（d 格回归，旧写新读的集成形态）：`--start` 之后把 status.json 与锁里的新字段删掉（模拟旧版写下），R 下 `--wait` ⇒ 判失联（`pid_gone`），与今天相同——证明退回比较在真实 CLI 链路上也生效。本格随即按标记结束 worker。

计时断言沿用各自所仿用例的界式与余量（I5 同 EV-152 I1，I6 同 EV-146 J1 的 60 s 上界）。

### 5.3 源码变异（`scripts/mutation-check.mjs`；规格由生成脚本从源码截锚点并逐条核对唯一，照搬 `evidence/lost-worker-cancel-20260928/gen-mutation-spec.mjs`；失败用例名与文案用同目录 `mutation-names.mjs` 补，确认没有前置失败）

| # | 变异 | 预期咬住 |
| :-- | :--- | :--- |
| M1 | `startRun` 的 `patchStatus` 不写 `worker_started_at_canonical` | I1、I2（R 下判失联） |
| M2 | `workerLockContent` 不覆盖 `pid_started_at_canonical`（沿用 `--start` 的） | U4 ① |
| M3 | `acquireLock` 的 `pid_started_at_canonical` 恒 null | U5 |
| M4 | `processMatchesRecord` 忽略规范化字段（恒走 legacy） | U1、U6～U8、I2～I6 |
| M5 | `processMatchesRecord` 规范化那一支以缺省环境取（去掉 `{ canonical: true }`） | U1 |
| M6 | 规范化字段缺席时判「不是同一进程」（去掉退回） | U2、U5 回归格 |
| M7 | `canonicalStartOf` 接受空串 / 非字符串 | U3 |
| M8～M15 | C1～C8 各自改回 `processAlive(pid, legacy)`（逐个消费方一条） | U6～U8、I2～I6 对应格 |
| M16 | `settleOrphanedStart` 确认不了退出一支不写 `worker_started_at_canonical` | U4 |
| M17 | `settleOrphanedStart` 改写锁时传给 `workerLockContent` 的规范化值恒为 null | U4 ② |
| M18 | `classifyLostCancel` 的类型守卫仍只认缺省字段 | U8（只有规范化字段那一格） |
| M19 | D6：`mismatch` 告警不分 basis | U9 |

### 5.4 零配额验收（scratchpad → `evidence/worker-start-canonical-20260928/`）

照搬 `evidence/lost-worker-cancel-20260928/acceptance.mjs` 的骨架：旧构建用 `git archive 6b89cc0`（带 `.reviews/`、`node_modules` 软链工作树、只叠加必要的桩，桩 `hang_cli` 在 `6b89cc0` 已有），新旧都直接 `node` 调 bundle 路径，记 sha256 并断言不同；输出归一化覆盖主题名、run_id、时间戳、路径与 pid。W / R 同 §5.1。

| 格 | 构造 | 判据 |
| :-- | :--- | :--- |
| A1（b 格，新写新读） | 新 `--start`（W）；新 `--wait`（R）、新 `trivium scrub --dry-run`（R）、新同阶段 `--start`（R）、新 `--cancel`（R） | 73；计 alive；70；SIGTERM 发出、worker 与 CLI 组都结束、`cancelled` |
| A2（c 格，旧写新读、同环境） | 旧 `--start`（W）；新 `--wait` / `--start` / `--cancel`（W） | status.json 与锁**没有**新字段；新读者行为与旧读者逐项相同（73；70；按组结束） |
| A3（d 格，旧写新读、异环境） | 旧 `--start`（W）；新 `--wait`（R） | 与旧读者（R）结果相同：判失联 `pid_gone`——升级窗口里在跑的运行**不会被新版改善、也不会被新版恶化**（§7.1） |
| A4（遗留锁，旧写新读） | 旧构建写下一把 pid 已不在的锁（旧 `--start` 后按组 SIGKILL worker）；新 `--start`（W 与 R 各一次） | 两次都按 `pid_gone` 回收并起跑（与旧版相同） |
| A5（e 格，新写旧读、同环境） | 新 `--start`（W）；旧 `--wait` / `--start` / `--cancel`（W） | 旧读者照常：73；70；按组结束——新字段被忽略、缺省字段仍正确 |
| A6（f 格，新写旧读、异环境） | 新 `--start`（W）；旧 `--wait`（R） | 与今天相同：判失联（回滚即回到 EV-158 的现状，§7.2） |
| A7（旧版读改写保留新字段） | 新 `--start`（W）；旧构建 `--cancel`（W）把 status.json 写成 `cancelled`（worker 与 `--start` 同一 bundle，造不出「旧 worker 读改写新 status.json」，改用旧版 `--cancel` 的 `patchStatus` 代表旧版读改写） | 新字段逐字保留（旧版 `patchStatus` 读改写整份对象、不删不认识的键） |
| A8 | 新构建 `doctor --selftest` | 14/14 |

### 5.5 doctor 自检与全量

`npm run check` 文档改前、改后各一次；`node dist/… doctor --selftest`（直跑仓库构建产物，不装真实 HOME）。

---

## 6. 文档同步

- **主设计 v1.3.55**：7.5「长时调用协议」补一段「worker 与主题锁的启动时刻」：两个新字段、写者、共享读法、覆盖矩阵 a～j 的结论、升级窗口与回滚；`review --cancel` 行 `mismatch` 那句改为按 basis；变更记录一行（单行，表格单元格里不换行）。
- **LLD v1.1.13**：`startRun` 第 6 条（锁的所有权移交）补新字段与 D4；worker 主体 / 4.2「失联后取消」引述块里 `classifyLostCancel` 的判据改为经 `processMatchesRecord`；:599 行「`worker_started_at` 对 TZ / 区域设置敏感」一行改为已解决（写明残余：旧版写下的记录、回滚）。
- **MANUAL v1.0.13**：:652 那段告警解读按 D6 分写；「升级之后仍在跑的旧运行，换了时区 / 区域设置的终端仍可能被判不是同一进程，请在原终端操作」一句。
- **PROTOCOL**：:270「进程存活性比对」补规范化形态与两个新字段；status.json 字段表加 `worker_started_at_canonical`（对外 JSON 加法）。
- **BACKLOG**：EV-158 标 done（写明残余 d / f 格）；EV-159 注记「EV-158 之后还差什么」（§8）；不新登条目，除非实施中冒出。
- **PRD**：核 `lstart` / 启动时刻 / PID 复用相关条文；已 `grep` 过没有字段级表述，预计不改，实施时再核一次并在报告里写明。
- **实施报告**：`doc/05_testing/REPORT_2026-09-28_worker_start_canonical.md`；证据 `doc/05_testing/evidence/worker-start-canonical-20260928/`（`probe-lstart.mjs` 与三次读数、变异规格与生成脚本、名字核对、验收脚本与读数）。

---

## 7. 风险与边界

### 7.1 升级窗口（旧写新读，d 格）

升级前由旧版 `--start` 起的运行、旧版持锁进程写下的锁，都没有新字段，新读者退回缺省比较——与旧版读者**逐字相同**：同环境判对，异环境判错（EV-158 的原状）。这是用户决策「没有就退回今天的比较」的直接后果，本主题**不**在比对时「两种形态都试」（BACKLOG 原候选之一）：没有规范化字段就没有规范化基准，「都试」只能是拿读者环境的缺省形态再比一次，那正是今天的比法。残余面：升级那一刻仍在跑的运行（一次运行至多几十分钟）与旧版写下、持有者仍活着的锁。MANUAL 写一句出路：在原终端操作。

### 7.2 回滚（新写旧读，e / f 格）

旧读者 `JSON.parse` 后按接口取字段，新键被忽略；缺省字段的写法没变，所以同环境判对、异环境判错——回滚即回到 `6b89cc0` 的行为，不更坏。旧版 `patchStatus` 读改写整份对象，新键保留（A7）；旧版的锁改写只基于它自己 `acquireLock` 的内存内容（没有新键），不会把新键带到错误的 pid 上（§7.3）。回滚步骤：回退源码与用例，`npm run build`、`npm run check`，由用户在终端重装。run.v2 与归档无改动，无需迁移。

### 7.3 两个字段同指一个进程（混版本的不变量）

- 新写者总在同一次写入里写两个字段、取自同一个 pid（§4.2）；`settleOrphanedStart` 的 `??=` 两个字段各自判空，status.json 若已被 `startRun` 写全，两个都不覆盖；若只写了一个（不存在这样的写者），读法按「有规范化就只比规范化」，也不会拿缺省字段去配规范化的 pid。
- **唯一能把两个字段拆开的形态是 D4**：以 spread 改写锁时漏覆盖新字段。旧版没有新字段，不会拆；新版由 M2 / M17 钉住。
- 混版本写同一个文件：status.json 的 `worker_pid` / 启动时刻只有 `--start` 与它自己的派生后收尾写，两者同一进程、同一版本；锁文件的改写同理。旧版 worker 只写 phase / 心跳 / 逐侧状态。所以不存在「新字段属于 A、旧字段属于 B」的混写。

### 7.4 方向二（别的进程被判成 worker）

规范化之后，「环境不同时恰差一个时区差」那个巧合消失，只剩同一秒内 pid 复用（j 格），量级与 CLI 进程组记录相同（CLI进程组记录计划 r2 §7.2），如实保留。

### 7.5 对既有不变量

- 取不到启动时刻时各消费方的处置不变（§4.6）；失联后取消那一格的严格判据不变（C8）；`mismatch` 格一个信号都不发不变（D6 只改措辞）。
- `acquireLock` 每次尝试多一次 `ps` 只发生在进程第一次持锁时（D5 缓存）；读者一侧 basis = canonical 时仍是一次 `ps`（换了环境而已），basis = legacy 时与今天相同。
- 冻结（EV-152）：worker 进入终止中之后 `run()` 悬空，`processStartTimes` 同样悬空——与今天 `processStartTime` 相同；`acquireLock` 的缓存命中时不派生，反而少一处悬空。

---

## 8. EV-158 修好之后 EV-159 还差什么

EV-159：`--wait` 判 heartbeat_stale 之后 worker 已不在时，`--cancel` 终态分支没有补收 run.json 的入口；BACKLOG 写明它排在 EV-158 之后，因为「worker 已不在」在环境错配下会假阳性、会在 worker 还活着时写 run.json（EV-142 的两写者）。本主题之后：

1. **新版写下的记录**：环境错配不再造成假阳性（b 格翻过来了）。EV-159 的「已不在」判据可以直接用 `processMatchesRecord`。
2. **仍差——判据要用严格形态**：`workerConfirmedGone` 把「活着而启动时刻取不到」（h 格）算作已不在；EV-159 要写 run.json，得用 C8 那样的严格判据（不在 ⇒ 已退出；取到且不同 ⇒ 已退出；取不到 ⇒ 未退出），不能直接复用 C2。
3. **仍差——旧版写下的记录**（d 格）：升级前起跑、没有规范化字段的运行，环境错配仍会假阳性。EV-159 需要决定：basis = legacy 时是否一律不补收（只提示），还是接受与今天同级的风险。本稿建议前者（写 run.json 是不可逆的归档动作），留给 EV-159 定。
4. **仍差——没有 `lost` 的升级窗口形态**（EV-159 原文第二形态，CODEX-03 并入）：与启动时刻无关，本主题不触及。
5. **仍差——秒级精度**（j 格）：同一秒内 pid 复用，罕见，EV-159 如实保留即可。

---

## 9. 决策点（本稿自定，请审查员重点看）

| # | 决策 | 备选与不取的理由 |
| :-- | :--- | :--- |
| D1 | 字段名 `worker_started_at_canonical`（status.json）、`pid_started_at_canonical`（锁）：与既有字段同前缀，`grep` 一次都能找到；后缀与 `processStartTime` 的选项名一致 | `*_utc`：形态不止 UTC，还有 C 区域设置；`started_at_v2`：看不出含义 |
| D2 | 读法收成 `processMatchesRecord` 一个函数，八个消费方都经它；`processAlive` 不改、`sweepDeadRunningGates` 与补收那一处不改 | 改 `processAlive` 的签名：它还有两处只看存活的调用，改签名会把它们也卷进来；各消费方各写一遍分支：八份同职实现，漏一处就静默错一格 |
| D3 | 「有」= 非空字符串；其余一律当「没有」、退回缺省比较 | 形状坏 ⇒ 判不了：多一格处置、多一套告警，而形状坏只可能来自手改；用户决策只分「有 / 没有」 |
| D4 | 锁的两处 spread 改写收成纯函数 `workerLockContent`，**显式**覆盖 `run_id` / `pid` / `pid_started_at` / `pid_started_at_canonical` 四键（新字段值为 null 也写 null） | 两处各自在 spread 里补一个键：两份同职实现，集成断言又因同一秒启动而咬不住（§5.2 I1）；改成不用 spread、逐键构造：`LockContent` 日后再加字段时同样要记得，纯函数 + U4 + M2 已足够 |
| D5 | `acquireLock` 对本进程规范化启动时刻做进程内缓存（只缓存非 null）；缺省形态不缓存 | 不缓存：每次锁尝试多一次 `ps` 派生，`withGlobalLock` 争用时最多 40 次；连缺省形态一起缓存：改了今天的行为（它随 `process.env` 变） |
| D6 | `mismatch` 告警按 basis 分写，处置不变 | 不改措辞：basis = canonical 时原句「也可能是 TZ / 区域设置不同」已不成立，误导人去换终端；basis = canonical 时放开按记录结束 CLI：不符的成因还含「本次 `ps` 取不到」，放开就是对可能还活着的 worker 名下的 CLI 发信号，与 §4.6「取不到时保持今天口径」相违 |
| D7 | `classifyLostCancel` 的类型守卫放宽为「规范化或缺省字段有其一」 | 维持只认缺省字段：规范化字段有而缺省字段为 null 的记录（写时缺省 `ps` 失败）明明有可核对的身份，却判 `no_identity`；放宽后比对仍是严格的（有规范化就只比规范化） |

---

## 10. 流程（命令 A，一口气跑）

S0.8 已认领 plan → 本稿 → 计划双审（`--entry A`，入选 codex / gemini / glm）→ 逐条裁决写 `…-revised-claude.md`、`gate --check` → 认领 code → 按修订稿实施、把 §5 的读数做全 → 代码双审 → 应答件 → 按接受项修订并重跑读数 → `verify`。不提交、不推送、不审批。
