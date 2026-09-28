# 实施报告：worker启动时刻规范化（EV-158）

- **日期**：2026-09-28
- **主题**：`worker启动时刻规范化`（命令 A 一口气跑；plan / code 两阶段均 `topic claim` → claude）
- **起点**：`6b89cc0`（`main`，clean）
- **计划**：`.reviews/worker启动时刻规范化/plan/2026-09-28-worker启动时刻规范化-r2-claude.md`（r2 定稿；计划双审第 1 轮 run `20260928T110842Z`，三侧 `approve-with-nits`，9 条接受 8、驳回 1）
- **证据**：`doc/05_testing/evidence/worker-start-canonical-20260928/`
- **设计同步**：主设计 v1.3.55、LLD v1.1.13、MANUAL v1.0.13、PROTOCOL、BACKLOG（EV-158 done、EV-159 注记）；PRD 已核，没有启动时刻 / PID 复用的条文，不改

---

## 1. 改了什么

| 计划 r2 条目 | 落点 | 钉住它的用例 / 变异 |
| :--- | :--- | :--- |
| §4.1 两个可选字段 | `status.ts` `RunStatus.worker_started_at_canonical`（`newStatus` 写 null）；`lock.ts` `LockContent.pid_started_at_canonical` | U5 ①、I1、A1 |
| §4.1 D3「有」的判定（AGY-01 trim） | `util/exec.ts` :572 `canonicalStartOf` | U3、M7a、M7b |
| §4.1 契约线（CODEX-01） | `util/exec.ts` `processStartTime` 与 `processMatchesRecord` 文档块；主设计 7.5、PROTOCOL :270 | —（文字） |
| §4.2 取值助手（AGY-02、GLM-03） | `util/exec.ts` :559 `processStartTimes`（两路各自吞错，永不 reject） | U10 |
| §4.2 D4 锁改写 | `lock.ts` :48 `workerLockContent`；`startRun`（`run-protocol.ts` :439 起）与 `settleOrphanedStart` 两处都经它 | U4 ①②、M2、M17 |
| §4.2 写者 | `startRun` 同一次写入写两种形态；`settleOrphanedStart` 两支 `??=`；`acquireLock` 写本进程的规范化启动时刻 | I1、U4 ②②′、U5 ①④、M1、M3、M16、M22 |
| §4.2 D5 缓存 | `lock.ts` :67 `selfCanonicalStartTime`（只缓存非 null） | —（不改语义；见 §3.2） |
| §4.3 共享读法 | `util/exec.ts` :604 `processMatchesRecord`；`status.ts` :177 `workerStartOf` | U1、U2、M4～M6 |
| §4.4 八个消费方 | `interpretStatus`（:410）、`workerConfirmedGone`（:210）、`workerStillAlive`（`retention.ts`）、`judgeStale`（`lock.ts` :119）、`cancelRun` 主路径与 `workerGoneForCancel`（:753）、`classifyLostCancel`（:1419，D7 放宽守卫）、`lostWorkerGone`（:1457，改导出） | U5～U8、C5 / C6、I2～I6、M8～M15、M18、M20、M21 |
| §4.4 D6 告警分写 | `run-protocol.ts` :1648：规范化记录不符 ⇒「PID 已被复用，或本次取不到它的启动时刻」；旧版记录 ⇒ 原句逐字保留、句末补「这份记录没有规范化启动时刻」 | U9、M19；既有 K5 ④ 不改仍绿 |
| §4.5 注释更正 | `hooks.ts` `sweepDeadRunningGates` 文档块改为「只看存活」 | — |

另：`test/helpers/start-env.ts`（W / R 环境对、进程内切环境、P0 前置断言）；`test/helpers/fixture.ts` 的 `cli()` 加可选第五参 `extraEnv`；`gate-loop.test.ts` 的 `startWithRecordedClis` 加可选第三参。

---

## 2. 读数（编码阶段，代码双审之前）

| 项 | 读数 |
| :--- | :--- |
| 实测 `probe-lstart.mjs`（计划 §2） | 三次相同：同一进程 7 种环境下缺省形态 7 种、规范化形态 1 种（`probe-lstart.out.{1,2,3}.json`） |
| `npm run check` | 第 1 次（文档同步之前）**2221 / 2219 / 0 / 2**（`check-1.txt`，起点 2203 → 新增 18：`start-canonical.test.ts` 11、`run-protocol.test.ts` 4、`gate-loop.test.ts` 3）；第 2 次（文档同步之后）**2221 / 2219 / 0 / 2**（`check-2.txt`） |
| 源码变异（`mutation-spec.json`，23 条，锚点由 `gen-mutation-spec.mjs` 从源码截取并核对唯一） | **23 / 23 咬住**（`mutation-output.txt`，基线三个套件全绿）：M4 fail=8、M5 fail=7、M6 fail=4、M1 / M7a / M15 / M21 各 2，其余各 1 |
| 失败用例名与文案（`mutation-names.mjs`，23 条全跑） | 全部红在本主题的目标用例上（`mutation-names-output.json`；M1 单跑 gate-loop、按 `EV-158` 过滤，`mutation-names-output-gateloop.json`：红在 I1～I5 与 I6）；**没有前置失败** |
| 零配额验收（`acceptance.mjs`，旧构建 `git archive 6b89cc0`，不叠加任何文件） | **10 / 10**（`acceptance-output.txt` / `acceptance-readout.json`）；收尾无残留进程组 |
| doctor 自检 | 验收 A8：新构建 `doctor --selftest` 14/14 |

验收各格（W = `TZ=Asia/Tokyo LC_ALL=fr_FR.UTF-8`，R = `TZ=America/New_York LANG=de_DE.UTF-8`；P0 读数：W `lun. 28 sept. 21:00:24 2026`、R `Mo. 28 Sep. 08:00:24 2026`、规范化 `Mon Sep 28 12:00:24 2026`）：

| 格 | 方向 | 结果 |
| :-- | :--- | :--- |
| A1 | 新写新读、R≠W | status.json 与锁的规范化字段都等于 worker 的；R 下 `--wait` 退 73、会话启动清扫不回收闸门且副本仍在、`scrub --dry-run` 计 alive 1、同阶段 `--start` 退 70、`--cancel` 发 SIGTERM、worker 与两组都结束、cancelled |
| A2 | 旧写新读、同环境 | 旧版写下的 status.json 与锁没有新字段；新读者照常：73、70、按组结束 |
| A3 | 旧写新读、异环境 | 新旧读者结果相同：都判 `pid_gone`（worker 其实活着）、run.json 写成 failed——升级窗口不改善也不恶化（计划 §7.1） |
| A4 | 遗留锁旧写新读（两轮独立序列，GLM-01） | W、R 两轮新 `--start` 都按 `pid_gone` 回收旧格式遗留锁并起跑，新锁带规范化字段 |
| A5 | 新写旧读、同环境 | 旧读者照常：73、70、按组结束 |
| A6 | 新写旧读、异环境 | 旧读者判 `pid_gone`——回滚即回到 EV-158 的现状（计划 §7.2） |
| A7 | 旧版读改写 | 旧版 `--cancel` 把 status.json 写成 cancelled 之后，规范化字段逐字保留 |

---

## 3. 实施中核出的事

### 3.1 失联后取消那一格的旧文案被既有用例钉着

D6 第一版把 legacy 依据的告警整句改写，既有 EV-146 K5 ④（钉「可能是 PID 已被复用，也可能是本命令的 TZ / 区域设置与 --start 不同（BACKLOG EV-158）——不对它发信号」）红了。按「旧版写下的记录、行为不变」的口径，legacy 依据改为**原句逐字保留、句末补一句成因**，K5 ④ 不改即绿；新增的 U9 两格分别钉两种依据。

### 3.2 D5 缓存没有单独的用例

缓存只省 `ps` 派生、不改取值（进程启动时刻终生不变、规范化形态与环境无关），行为上无从区分「缓存了」与「每次现取」；计划 §5.3 也没列它的变异。如实记下：它的正确性由 U5 ①④（取到的值正确）间接覆盖，「只缓存非 null」一条没有用例。

### 3.3 既有用例的改动

- `run-protocol.test.ts` EV-150 U6：`workerGoneForCancel` 第二个参数由字符串改为整份记录（计划 §4.4 C6 改签名），三处调用改传 `{ legacy: … }`，断言与语义不变。
- 其余既有用例一条未改；它们写的都是没有新字段的记录，恰好成为「旧版写下、新版读」的回归面（全量两次全绿）。

### 3.4 未做 / 如实保留

- 真实厂商 CLI 实测：用户决策不花配额，未做。
- 升级窗口（d 格）与回滚（f 格）：按设计退回旧行为，A3 / A6 验证了「与旧版相同」。
- 同一秒内 pid 复用（j 格）：`lstart` 只到秒，如实保留。
- Node 18 / 20 未测（本机 Node v25.2.1）。

---

## 4. 代码双审与修订

- **代码双审第 1 轮**（run `20260928T120630Z`，约 9 分 28 秒）：gemini `approve` 零意见、glm `approve` 零意见、codex `approve-with-nits` 3 条（次要 2、吹毛求疵 1），**全部接受**；应答件在 `.reviews/worker启动时刻规范化/code/`，`gate --check` 通过。

| 意见 | 裁决 | 落点 |
| :--- | :--- | :--- |
| CODEX-01 `interpretStatus` 情形 A 的 `fallbackPidStartedAt` 是规范化读法之外的入口 | 接受（取「写成硬约束」，不删参数：两处既有用例以它构造格、情形 C 也用它回落） | `status.ts` 参数文档：只供同进程构造，生产不传，不得传别的进程写下的启动时刻 |
| CODEX-02 `sweepDeadRunningGates` 注释说只看存活、实参仍传启动时刻 | 接受 | `hooks.ts` 实参改 null（`.alive` 与期望值无关，行为不变）并注明 |
| CODEX-03 两处锁改写非原子 | 接受「登记约束」那一半；「活锁被回收」的后果不成立——`acquireLock` 对修改不足 2 s 的不可解析锁不回收 | `run-protocol.ts` 两处改写旁、`lock.ts` `workerLockContent` 文档块各一句注释；不换 `writeAtomic` |

三条都只改注释或行为不变的实参，不新增用例。

**修订后读数**（修订前的变异规格与读数、验收读数留 `.r1` 副本）：

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 3 次（修订后、本节写入之前）**2221 / 2219 / 0 / 2**（`check-3.txt`）；第 4 次（本节写入之后）**2221 / 2219 / 0 / 2**（`check-4.txt`） |
| 源码变异（按修订后代码重生成规格，与 `.r1` 逐字节相同——三处修订都不在锚点上） | **23 / 23 咬住**，各条 fail 数与 r1 逐条相同 |
| 失败用例名与文案 | 23 条全部红在本主题目标用例上，无前置失败 |
| 零配额验收 | **10 / 10**（新 bundle sha256 `90166dd17fc9…`，旧 `a4b8aa094a94…` 同 r1），收尾无残留进程组；A8 `doctor --selftest` 14/14 |
