---
schema: trivium.disposition.v1
topic: CLI进程组记录
stage: plan
role: claude
kind: revised
run_id: 20260928T015235Z
addresses:
  - 2026-09-28-CLI进程组记录-codex.md
  - 2026-09-28-CLI进程组记录-gemini.md
  - 2026-09-28-CLI进程组记录-glm.md
---

# 裁决：CLI进程组记录 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-28-CLI进程组记录-claude.md`（r1，起点 `b6a555b`，用户决策 1～8 送审前已定）
> ｜ 运行：`20260928T015235Z`（约 11 分 35 秒）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 9 条（次要 8、吹毛求疵 1），**全部接受**；AGY-02 接受问题、落点收窄到主路径（终态早退分支不写，理由见表）
> ｜ 三侧都认可 D1（ALS）与 D3（终态早退分支里 worker 已不在时按记录结束 CLI 落在决策 5 字面之内）
> ｜ 修订后的计划：`plan/2026-09-28-CLI进程组记录-r2-claude.md`

## 0. 核实记录

- **CODEX-01**：成立，且比意见说的更宽。本会话实测同一进程的 `ps -p <pid> -o lstart=`：缺省 `Mon Sep 28 10:04:56 2026`；`TZ=UTC` 为 `02:04:56`；`TZ=Asia/Tokyo` 为 `11:04:56`；`LC_ALL=fr_FR.UTF-8` 为 `lun. 28 sept. …`；`LC_TIME=zh_CN.UTF-8` 为 `一  9月/28 …`；`LC_ALL=C TZ=UTC0` 为 `Mon Sep 28 02:04:56 2026`。**TZ 与区域设置都会改输出**，而 worker（由 `--start` 派生、继承其环境）与 `--cancel` / 会话启动 Hook / `trivium scrub` 各自的进程环境不必相同。按 r1 的判定，环境不同 ⇒ 活着的 CLI 判 `reused` ⇒ 取消侧不发信号（可接受），准入侧判「已不在」放行抹除——正翻回 EV-38。钉死环境（`LC_ALL=C`、`TZ=UTC0`）后两处读数相同。**同一缺陷也命中既有的 `worker_started_at`**（`processAlive` 用于 `--cancel` 判 worker、`workerConfirmedGone` 用于三处准入）：那一面改动会让旧版写下的记录与新版读法不符，且不在本主题范围，按决策 8 登记暂缓。
- **CODEX-02**：成立。本机 `which -a node` 只有 Homebrew 的 v25.2.1，没有 18 / 20 可复跑 Q1。`AsyncLocalStorage` 在 Node 16.4 起标为稳定，但本项目没有在下限版本上实测过这条传播链。
- **CODEX-03**：成立。「旧读者忽略新字段」今天只由 `readStatus` 不校验（`status.ts` :95-103）推出，没有读数。
- **CODEX-04**：成立。`blockAfterMs` 的定时器与「取到启动时刻再补写」的 `patchStatus` 在同一事件循环上赛跑，块先落地时记录停在 `started_at: null`（f′ 格），用例会以等不到前提而红，归因不清。
- **AGY-01**：成立。`started_at: null` 时 `judgeCliGroup` 在 pid 存活期间恒为 `unverifiable`，不可能判 `reused`；r1 §4.5 与 §7.2「pid 被复用时放行」写错了。
- **AGY-02**：成立。`cancelRun` 主路径的 `patchStatus`（`run-protocol.ts` :1303-1308）只改 phase / exit_code / message，已确认结束的 CLI 记录会一直留在 status.json 上；遇到 `started_at: null` 且 pid 日后被复用，准入会一直 `deferred`。
- **AGY-03**：成立。`processStartTime` 走 `run()`，它自身不抛，但 `.then` 里的通知回调抛错时就是未处理的拒绝；worker 的心跳写入已有同类防线（`run-protocol.ts` :798-802）。
- **GLM-01**：成立。`terminateProcessGroup` 的 `isGone` 以组长判定（`exec.ts` :534-541），组长服从 SIGTERM 而组员忽略时，宽限轮询在组长退出那一刻即返回 `gone: true`、不升级，播报会把仍活着的组员说成已结束。worker 的 `shutdownTrackedTrees`（EV-152）同形，是沿承的盲点；本主题把它带进了新的消费方与新的播报。
- **GLM-02**：成立。r1 的 `cliRecordsOf` 把「键在而形状坏」与「键缺席」并为「没有记录」，准入侧因此把读不懂的记录放行成可抹，与「判不了就不抹」相逆。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 实测成立：TZ 与区域设置都会改 `lstart` 的字符串，跨进程等值判定在环境不同时把活着的 CLI 判成 `reused`，准入侧据此放行抹除。取「发 ps 时钉死环境」：写记录与判定都经同一个取规范化启动时刻的入口（`LC_ALL=C`、`TZ=UTC0`），不动既有 `worker_started_at` 的读写（改它会让旧版写下的记录判不符）；既有那一面按决策 8 登记暂缓 | r2 §2 Q4（读数）；§4.1 `processStartTime` 新增 `canonical` 选项；§4.3 `judgeCliGroup` 用它；§5.1 U16、§5.3 M15；§7.2 删去「时钟回拨」以外的环境假设、写明钉死的前提；§7.3 与 §8 新登「`worker_started_at` 对 TZ / 区域设置敏感」 |
| CODEX-02 | codex | minor | 接受 | 本机只有 v25.2.1，无法在下限版本复跑；取建议的第二种：把「ALS 跨 await / 定时器 / 子进程事件传播」单列为未验证前提，与「真实 CLI 未实测」同列，并说明失效形态（记录缺席 ⇒ 取消侧回到今天的如实提示、准入侧回到只核 worker，不会误杀或误抹） | r2 §7.2 新增一条；§2 表头注明版本 |
| CODEX-03 | codex | minor | 接受 | 回滚方向缺读数，一格就能补 | r2 §5.4 新增 B10：新构建产出带 `cli` 记录的 status.json，旧构建对它跑 `--status --json`、`--cancel`、`trivium scrub`，断言按旧口径工作（字段原样透出或被忽略、不报错） |
| CODEX-04 | codex | nit | 接受 | 竞态成立。把块时点放宽到 3000 ms，用例先等 `started_at` 非空再等块生效；等不到时以「块先于补写落地（f′ 格），用例前提不成立」失败，与机制失败分开 | r2 §5.2 I4 |
| AGY-01 | gemini | minor | 接受 | 核实成立：`started_at: null` 的记录在 pid 存活期间恒为 `unverifiable`，只有进程不在时才转 `gone` | r2 §4.5 与 §7.2 改写该句：「一直 `deferred` 到该 pid 上没有活进程为止；pid 被复用且占有者活着期间仍判不了」 |
| AGY-02 | gemini | minor | 接受 | 核实成立。落点收窄：主路径（:1303 那次 `patchStatus`）对**已确认结束**的记录（`gone` 且组成员数为零、或判 `gone`）清成 null；`unverifiable`、未确认退出、形状坏的保留。终态早退分支（D3）**不写** status.json：那一支的承诺是「不追溯改写」，本稿不在里面开写入口子；遗留的记录由判定口径兜住（组长不在 ⇒ `gone`） | r2 §4.4「收尾」条；§5.2 I3 断言取消后两侧 `cli` 为 null、I5 断言终态分支 status.json 字节不变 |
| AGY-03 | gemini | minor | 接受 | 核实成立 | r2 §4.1：`processStartTime(…).then(…)` 末尾 `.catch(() => {})`，观察者调用各自 try/catch |
| GLM-01 | glm | minor | 接受 | 核实成立。取第二种：`terminateRecordedCliGroups` 对每组收尾后按 `ps -axo pgid=` 数一次组成员，非零即 warn「组长已退出，组里还有 N 个成员，未对它们发信号（决策 4）」，不改发信号的判据（决策 4「不去猜」）。worker 处理器同形的盲点不在本主题动（EV-152 已结案），写进 §7.2 | r2 §4.4（结果多一个 `members_left`、播报）；§5.1 U15 补「组员忽略 SIGTERM」变体；§5.3 M16；§7.2 |
| GLM-02 | glm | minor | 接受 | 核实成立：准入侧对不可逆动作要 fail-closed | r2 §4.3 `cliRecordsOf` 返回 `{ records, malformed }` 三态；`cliGroupsConfirmedGone` 遇形状坏判不可抹；取消侧遇形状坏 warn「记录读不懂，不发信号」；§5.1 U12 / U14 各补一格；§5.3 M17 |

## 2. 修订要点（r2 相对 r1）

1. **启动时刻规范化**（CODEX-01）：`processStartTime(pid, { canonical: true })` 以 `LC_ALL=C`、`TZ=UTC0` 调 `ps`；CLI 记录的写与判都只经它。既有 `worker_started_at` 不动、登记暂缓。
2. **形状坏的记录三态处理**（GLM-02），**组员残留如实告警**（GLM-01），**主路径清掉已确认结束的记录**（AGY-02），**异步链兜底**（AGY-03）。
3. **文字改准**：`unverifiable` 的放行时机（AGY-01）；ALS 的版本前提（CODEX-02）。
4. **验证**：I4 竞态（CODEX-04）；B10 回滚方向（CODEX-03）；新增 U16、M15～M18。
5. 决策 1～8 与 D1～D5 不变。
