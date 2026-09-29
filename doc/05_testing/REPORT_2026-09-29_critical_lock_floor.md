# 临界区锁超时下限 · 实施报告（EV-161）

- **日期**：2026-09-29
- **主题**：`临界区锁超时下限`；计划 `.reviews/临界区锁超时下限/plan/`（用户决策送审前已定 → 计划双审 run `20260929T084121Z`：gemini `approve`、codex / glm `approve-with-nits`，3 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`53d7476`（`main`，clean）；计划与本报告的行号取自该提交的源码
- **状态**：实施与验证完成；代码双审 r1（run `20260929T091044Z`）已应答并按接受项修订（§6）；未提交
- **evidence**：`doc/05_testing/evidence/critical-lock-floor-20260929/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 下限 | `lock.ts`：新增 `import { WORKER_HEARTBEAT_MS } from './status.js'` 与导出函数 `criticalHoldTimeoutMs(heartbeatStaleMs) = Math.max(heartbeatStaleMs, WORKER_HEARTBEAT_MS)`；`judgeStale` 年龄判据由 `age > opts.heartbeatStaleMs` 改为 `age > criticalHoldTimeoutMs(opts.heartbeatStaleMs)`，书写顺序与其余判据不动；`judgeStale` 文档块、`AcquireOptions.heartbeatStaleMs` 注释、判据旁注释同步 | U1～U8、X1、X2、M1～M6、A0～A5 |
| §3.2 落点 | 只改 `judgeStale` 一处；29 处调用方、配置读取层、`interpretStatus` 零改动 | `git diff --stat`：源文件只有 `lock.ts`、`preflight.ts`（仅注释），代码双审后另有 `status.ts`（仅注释，§6.1）；S1、M7 |
| §3.3 导入方向 | `status.ts` 不导入 `lock.ts`，不成环；`npm run typecheck`、构建通过 | check-1 |
| §4 EV-160 文案 | 输出不改；`preflight.ts` `checkHeartbeatThreshold` 文档块末句改为「阈值配小不再波及短临界区锁：它的持有超时有 30 s 下限…下限不进本告警正文」 | A6（新旧预检 JSON 逐字相同） |
| §4 可见面（CODEX-01） | 新下限只进文档：MANUAL 配置项行、设计 §12.6、LLD、PROTOCOL、RUNBOOK；告警、70 正文、锁文件不变 | A1 新构建的 70 正文与旧构建同形（只差回收与否）、A5 |
| §5 小阈值用例盘点 | 受影响用例无，未改任何既有用例的构造 | check-1 全绿；§3.2 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check`（文档同步之后） | **2281 / 2279 / 0 / 2**，一次全绿（起点 2270 → 新增 11 条：`lock.test.ts` U1～U8、`status.test.ts` S1、`lock-cross-process.test.ts` X1 / X2），298 s（`check-1.txt`） |
| 新增用例耗时 | U8 约 0.38 s（A 持锁 300 ms）；X1 / X2 各约 1.85 s（4 进程 × 250 ms 串行）；其余单测每条 < 40 ms |
| 源码变异（r1 规格 `mutation-spec.r1.json`，8 条，锚点由 `gen-mutation-spec.mjs` 从源码截整行并核对唯一） | **8 / 8 咬住**（`mutation-output.r1.txt`；基线三个套件全绿）：M1 fail=3、M1x fail=2、M2 fail=5、M3 / M4 / M5 / M6 fail=2、M7 fail=1 |
| 失败用例名（`mutation-names-output.r1.json`，用 `evidence/cancel-cli-reach-20260928/mutation-names.mjs` 逐条跑） | 全部红在计划预期的用例上：M1 → U2 / U6 / U8；M1x → X1 / X2；M2 → U1 / U2 / U3 / U6 / U8；M3 → U1 / U2；M4 → U1 / U3；M5 → U2 / U3；M6 → U4 与既有「短临界区持有过久」；M7 → S1（断言文案「5 s 未更新超过 2 s 阈值就判失联，远未到 30 s」） |
| 零配额验收（`acceptance.mjs`，新旧两份构建，旧 = `53d7476`、不叠加任何文件） | **9 / 9** 一次通过（`acceptance-readout.r1.json`、`acceptance-output.r1.txt`），残留持有者进程 0 |
| `doctor --selftest`（新构建，验收 A7） | **14 / 14**（「自检：✅ 通过（14/14 步）」） |
| 环境 | Node v25.2.1，macOS |

验收各格读数：

| 格 | 读数 |
| :--- | :--- |
| A0 前置闸（CODEX-02） | 归档 `53d7476` 与工作树的 `package.json`（`f2fefaa5…`）、`package-lock.json`（`2b4a1019…`）sha256 逐字节相同 |
| A0 静态 | `lock.ts` 从 `./status.js` 导入 `WORKER_HEARTBEAT_MS`、不含 `30_000` / `30000` 字面；新 bundle `72b09409b78e…`、旧 `a0c56b0bd341…`，不同 |
| A1（T = 0.05，活持有者 1 s） | **旧**：退 0，stderr「⚠️ 回收主题「.task-锁验收」的遗留锁（原因 heartbeat_dead，原持有者 pid …）」，锁不在，task.json 已写声明；**新**：退 70，stderr「✗ 主题「.task-锁验收」已被占用：run_id 未知（pid …，自 … 起）」，无回收，锁文件逐字节不变，task.json 未写 |
| A2（T = 0.05，活持有者 40 s） | 新旧都退 0、都回收 `heartbeat_dead`，stdout / stderr 归一化后逐字相同 |
| A3（T = 0.05，持有者已死） | 新旧都退 0、都按 `pid_gone` 回收，归一化后逐字相同 |
| A4（T = 0.05，`run` 锁活持有者 40 s） | 新旧都退 70、锁文件都不变，归一化后逐字相同 |
| A5（缺省配置：无预置 / 活 1 s / 活 130 s） | 新旧退出码 0/0、70/70、0/0，三格输出归一化后逐字相同 |
| A6（T = 0.05 预检） | 退 0/0，JSON 逐字相同，含「失联阈值」 |
| A7 | 新构建 `doctor --selftest` 退 0，14 / 14 |

归一化：夹具根（含 realpath）、运行根、ISO 时间戳、pid、`claimed_at` / `updated_at`。新旧各用独立夹具（`topic claim` 会写 task.json）。

## 3. 偏离与如实登记

### 3.1 与 r2 文字的出入

- **M1 拆成两条**：变异装置每条只收一个期望套件，r2 表里 M1 的咬住对象跨单测（U2 / U6 / U8）与集成（X1 / X2）两个套件，规格里拆为 M1（单测）与 M1x（集成），find / replace 相同。
- **§5.3 以往变异规格锚点复核**：用 `evidence/worker-start-canonical-20260928/gen-mutation-spec.mjs` 原样重跑，它在 M18 处抛「find 在 run-protocol.ts 里出现 0 次」——M18 锚在 `run-protocol.ts`，本主题没改这个文件（`git diff --quiet 53d7476 -- src/trivium/run-protocol.ts` 为真），起点 `53d7476` 上它就已不是那个形态，是以往主题之后的既有漂移，与本主题无关。r2 点名的两条锁锚点单独核对：M11「`    canonical: lock.pid_started_at_canonical,`」、M20「`  if (!live.sameProcess) return 'pid_reused';`」在改后的 `lock.ts` 里各恰好一处，结论与 r2 相同。
- **`status.ts` 多了两行注释**（代码双审 r1 CODEX-01，§6.1）：r2 §3.4 写「一个字都不改」，本意是不改行为；数值与判据未动。
- **U7 的年龄**取 `F + 5 s`，与 r2 一致；U8 的 B 在 A 进锁后等 50 ms（`SUB_MS`）再起，与 r2 一致。

### 3.2 PRD

核后不改：PRD 全文不涉及锁的持有超时（无「遗留锁」「临界区」「heartbeat_stale」）。

### 3.3 等价变异

「下限与 `WORKER_HEARTBEAT_MS` 同一来源」在值上由 U1 钉住；把字面 `30_000` 换进 `criticalHoldTimeoutMs` 是等价变异，单测咬不住，由 A0 静态核对（导入存在、无字面）兜住，如 r2 §6.3 所述。

## 4. 文档同步

| 文档 | 改动 |
| :--- | :--- |
| 主设计 v1.3.62 | §12.6 新增一条「短临界区锁的持有超时 = max(`heartbeat_stale_s`, 30 s)」；§21 变更记录；版本号行 |
| LLD v1.1.20 | 变更说明；2.7 表 `lock.ts` 行数 394 与职责；4.3 判据表 `heartbeat_dead` 行；已知缺口表「短临界区锁的持有超时借用 `heartbeat_stale_s`」一行改为已解决（GLM-01：按行题定位） |
| MANUAL v1.0.20 | 配置表 `review.heartbeat_stale_s` 行补锁侧 30 s 下限 |
| PROTOCOL | 心跳段补一句锁的持有超时与失联阈值部分脱钩 |
| RUNBOOK | 遗留锁判据表 `heartbeat_dead` 行补下限与「约 3～4 秒后退 70，稍后重试」 |
| BACKLOG | EV-161 标 done |
| PRD | 不改（§3.2） |

## 5. 残留进程

变异、验收、全量跑完后，进程表里没有 `critical-lock-floor-accept-holder` 标记的进程（验收收尾按进程组结束持有者，读数 `leftover: []`）。

## 6. 代码双审

run `20260929T091044Z`（约 10 分 16 秒，相对 `53d7476` 的 20 个文件）：gemini `approve`、glm `approve`（均零意见），codex `approve-with-nits`（次要 1、吹毛求疵 2）。3 条全接受，应答件 `.reviews/临界区锁超时下限/code/2026-09-29-临界区锁超时下限-response-claude.md`，`gate --stage code --check` 通过（附带 run_warning「安装副本不是当前工作树构建的」——改动未提交、未重装，属预期）。

### 6.1 按接受项的修订

| 意见 | 修订 |
| :--- | :--- |
| CODEX-01（minor） | `status.ts` `WORKER_HEARTBEAT_MS` 文档块登记第四个消费方：它同时是 `criticalHoldTimeoutMs` 的锁下限，改值须按「覆盖最长临界区」重新论证。只改注释；与 r2 §3.4「`status.ts` 一个字都不改」的文字有出入（本意是不改行为，行为仍不变） |
| CODEX-02（nit） | `gen-mutation-spec.mjs` 的 desc 改为实测红集（M2 补 U6 / U8，M6 补既有「短临界区持有过久」，M4 按新增 NaN 格预测补 U1′）；首轮规格与读数改名 `.r1` 保留，重新生成规格 |
| CODEX-03（nit） | U1 加 `criticalHoldTimeoutMs(NaN)` 为 NaN、`(Infinity)` 为 Infinity；新增 U1′：阈值 NaN 时 critical 活锁持有 20 分钟仍不按年龄回收 |

变异规格的 desc 以 `mutation-names-output.json` 的 red 为准。

### 6.2 修订后重跑的读数

| 项 | 读数 |
| :--- | :--- |
| 新增单测 | EV-161 用例 10 / 10（U1～U8、U1′、S1） |
| 源码变异（`mutation-spec.json`） | **8 / 8 咬住**（`mutation-output.txt`）：M1 fail=3、M1x 2、M2 5、M3 2、M4 **3**、M5 2、M6 2、M7 1 |
| 失败用例名（`mutation-names-output.json`） | 实测红集与 desc 逐条一致；M4 较 r1 多咬住 U1′（修订时的预测，兑现） |
| 零配额验收 | **9 / 9**（`acceptance-readout.json`、`acceptance-output.txt`；r1 读数 `.r1`），残留 0；新 bundle sha256 `ad916327b8da…`（r1 为 `72b09409b78e…`，源码只多了 `status.ts` 的注释，差异推测来自构建标识，未逐字节追查）、旧 `a0c56b0bd341…` 不变 |
| `doctor --selftest` | 14 / 14（A7） |
| `npm run check` | 见 §7 |

## 7. 修订后全量

`npm run check`（修订与本报告 §6 写完之后跑）：**2282 / 2280 / 0 / 2**，一次全绿（r1 的 2281 + U1′），283 s（`check-2.txt`）。
本节这两行是 check-2 之后补记的，只改本报告的文字，未再跑全量；S10 `verify` 会再跑一次完整的 typecheck / build / test。
