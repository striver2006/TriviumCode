---
schema: trivium.disposition.v1
topic: 失联后取消挂住的worker
stage: plan
role: claude
kind: revised
run_id: 20260928T044009Z
addresses:
  - 2026-09-28-失联后取消挂住的worker-codex.md
  - 2026-09-28-失联后取消挂住的worker-gemini.md
  - 2026-09-28-失联后取消挂住的worker-glm.md
---

# 裁决：失联后取消挂住的worker · 计划双审第 1 轮

> 被审对象：`plan/2026-09-28-失联后取消挂住的worker-claude.md`（r1，起点 `50cb380`，用户决策 1～8 送审前已定）
> ｜ 运行：`20260928T044009Z`（约 11 分 26 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 5、吹毛求疵 1）｜ gemini `request-changes`（重要 1、次要 2）｜ glm `approve-with-nits`（次要 2、吹毛求疵 3）
> ｜ 共 15 条：接受 13、驳回 1（CODEX-04，前提与源码不符）、暂缓 1（CODEX-02，登记 EV-160）
> ｜ 三侧都认可 D1（`lost` 字段、fail-safe 方向）、D2（不为本格另立规范化锚点）、D5（沿用 `worker_lost` 取值）、D7、EV-159 暂缓
> ｜ 修订后的计划：`plan/2026-09-28-失联后取消挂住的worker-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：成立。`HEARTBEAT_MS` 是 30 s 常量（`run-protocol.ts` :47），`heartbeat_stale_s` 只约束 `> 0`（`config.v2.json` :167-170），阈值不大于 30 s 时健康的 worker 必被判 heartbeat_stale（本稿 §2 P1 正是这一构造）。r1 §4.2 的出口句是工具第一次向人推荐 `--cancel`，却不带任何可分辨的事实；r1 §4.4 的「可能只是心跳慢」要到信号发完之后才出现。判定那一刻手上有的事实：改写前 status.json 的 `heartbeat_at`（算得出心跳年龄）、生效阈值、心跳间隔常量。
- **CODEX-02**：成立（配置本身没有合法性检查，`grep` 核过 `preflight.ts` / `config.ts` / `cli.ts`）。但它是另一处面（预检告警的种类与 skill 转述契约），不属 EV-146；CODEX-01 接受后，判失联那一刻的报错已当场说出「阈值不大于心跳间隔」这条事实，正是它会造成误导的那一刻。
- **CODEX-03**：成立。r1 §4.4 自己算的本格最长耗时含 `ORPHAN_KILL_CONFIRM_MS`，J1 的界照抄主路径的公式漏了这一项；主路径 `killWaitMs: 0`，本格不是。
- **CODEX-04**：**前提不成立**。`startRun`（`run-protocol.ts` :432-447）先 `workerStartedAt = await processStartTime(spawned.pid)`，再把**同一个变量**写进锁（`pid_started_at`）与 status.json（`worker_started_at`）；`ps` 失败或超时时两处同为 null，不存在「status.json 缺而锁里有」的形态。唯一让两处分叉的路是 status.json 那次 `patchStatus` 本身失败（转入 EV-150 的 `settleOrphanedStart`），而那条路在确认不了退出时同样把 `worker_started_at ??= startedAt` 补进 status.json（:621-626），与写锁用的是同一个值。所以锁里的启动时刻不是第二份证据。意见要求补的「no_identity 的成因」本身有价值（`--start` 那次 `ps` 失败或超时），r2 照写一句，但不改判据。
- **CODEX-05**：成立。「status.json 为 failed + run.json 仍为 running + worker 仍是同一活进程」确实是今天就有的结构化事实组合，r1 的 D1 备选漏了它；`--status --json` 整份透出 status（`cli.ts` :473-481），`lost` 是对外 JSON 面的加法，r1 没把这个级别写清。
- **CODEX-06**：三点都成立。① 「`--cancel` 已终态的运行：不改写历史」在 `gate-loop.test.ts` :1388，不在 `run-protocol.test.ts`（771 行）；② r1 §1.3 的「（U8 守）」指既有的 EV-152 U8（`run-protocol.test.ts` :696），与 r1 §5.1 新排的 U8 撞号；③ D7 让判格可重入（本格不写 status.json，`lost` 与 phase 原样留着），但没有用例钉住「未确认退出后再跑一次仍入本格」。
- **CODEX-07**：成立。r1 让 MANUAL 不再推荐手工结束，但本格「未能确认退出」那一支的出路仍是人去 `ps` 核对、手工结束；手工结束之后再 `--cancel` 落进 `gone` 格，run.json 停在 running，r1 §4.4 的「没有第二次机会」句却没给出路。
- **AGY-01**：成立。r1 §4.3 让 `mismatch` / `no_identity` 打完告警后跌回原有两行「已处于终态（failed），无需取消」「已完成的运行不会被追溯改写」——前一句告警让人换环境再跑取消，后一句 stdout 说无需取消；而挂住的 worker 与主题锁实际都还在。
- **AGY-02**：成立（≡ GLM-02）。`processAlive` 对假值 `expectedStartedAt` 直接给 `sameProcess: true`（`util/exec.ts` :515），r1 只写「缺任一项」，空串会被当成有身份；`worker_pid` 为 1、非整数、字符串时同样应拒。status.json 只有 TS 接口、`readStatus` 不校验（`status.ts` :108-116）。
- **AGY-03**：成立。`describeFinalizeStepWith` 只出字符串，step / warn 的分流在 `reportFinalizeStep`（`run-protocol.ts` :1308-1316）里，而它的「没有第二次机会」半句写死了主路径的处境。
- **GLM-01**：成立。`waitRun` 写 failed + `lost`（:1173-1177）与回收闸门（:1184）是两次独立写，中间被打断时闸门停在 running；本格按用户决策 4 不动闸门，再跑 `--cancel` 也收不到它；自愈路径是会话启动的 `sweepDeadRunningGates`（`hooks.ts` :1711 起，本格结束 worker 之后它按「running 且 worker 已死」回收）。今天同一窗口的后果更差（worker、锁、闸门全卡住）。
- **GLM-02**：成立，同 AGY-02。
- **GLM-03**：成立，同 CODEX-06 ①。
- **GLM-04**：成立。`no_status_file` 只在 status.json 不存在时产生（`status.ts` :339-348），`patchStatus` 读不到文件即不执行 mutate（:130-140），`lost` 无处落盘。
- **GLM-05**：成立，同 CODEX-06 ②。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：出口句是工具第一次向人推荐破坏性动作，判定那一刻就有可分辨的事实（心跳年龄、生效阈值、心跳间隔），应与推荐同屏；取消那一刻也有「判定之后 status.json 还被写过没有」这条事实，应在发信号之前说 | r2 §4.2 出口句改为先列事实：判定时心跳已 N s 未更新、生效阈值 T s、工作进程心跳间隔 30 s；阈值不大于间隔时加一句「健康的工作进程也会被判失联，--cancel 会结束一个可能正在正常推进的轮次」；r2 §4.4 第 1 步开场句带 `lost.at` 与 status.json 最近一次写入时刻，二者相差超过 1 s 时加「判定之后工作进程又写过 status.json，它可能只是心跳慢」；r2 §7.1 补「操作者是在工具的推荐下第一次得知可取消」这一层；r2 §5.1 K2 断言这些事实；变异 N15 改为「不带事实」 |
| CODEX-02 | codex | minor | 暂缓 | 成立，但配置合法性是预检告警那一面（告警种类、skill 转述与契约用例），不属 EV-146，用户决策 1 只做 EV-146、决策 8 超范围登记暂缓；CODEX-01 接受后，判失联那一刻的报错已当场说出「阈值不大于心跳间隔」，误导最重的时刻已覆盖 | r2 §0 不做栏、§8 新登 EV-160「`heartbeat_stale_s` 不大于心跳间隔时预检不告警」（候选：`--start` 与预检的 `warnings` 加一条），§7.1 写明本格把这一误判的后果从「什么都不发生」升级为「可被结束」、告警留给 EV-160 |
| CODEX-03 | codex | minor | 接受 | 核实成立：界式漏了本格自己新增的 SIGKILL 后确认项 | r2 §5.2 J1 界式显式写 `WORKER_TERM_GRACE_MS + ORPHAN_KILL_CONFIRM_MS + WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 3000`，并注明「计时只防挂死，主判据是信号序列、组成员数与 run.json 三格；超界先存读数」；耗时另记进验收读数 |
| CODEX-04 | codex | minor | 驳回 | 前提与源码不符：`startRun` :432-447 用同一个变量写锁与 status.json，`ps` 失败时两处同为 null，锁里的 `pid_started_at` 不是第二份证据；status.json 那次写入失败的旁路（EV-150）确认不了退出时也把同一个值补进 status.json。改判据不增加覆盖，反而引入跨文件拼装身份 | 判据不改。r2 §3 c″-无身份行与 §7.5 补一句成因（`--start` 取 worker 启动时刻的 `ps` 失败或超时），并写明锁里同批写下的是同一个值 |
| CODEX-05 | codex | minor | 接受 | 核实成立：备选漏了「failed + run.json running + worker 活着」这条不加字段的判据；`lost` 进对外 JSON 面的级别没写清 | r2 §9 D1 备选补这一条与不取的理由（要跨读归档、`readRunMeta` 读不出与 v1 的形态要另论；记不下失联原因——用户决策 2 要的「失联原因是 heartbeat_stale」本身就要一个结构化原因；run.json 未写的成因不止失联一种）；r2 §6 PROTOCOL 行与 §4.1 写明「`--wait --json` / `--status --json` 的 `status` 对外多一个键，加法」 |
| CODEX-06 | codex | minor | 接受 | 核实三点都成立 | ① r2 §1.4 出处改为 `gate-loop.test.ts` :1388；② 新增用例改用前缀 K（K1～K9），r2 §1.3 的「U8」改为「`run-protocol.test.ts` :696 的 EV-152 U8」；③ r2 §5.1 K4 补「紧接着再跑一次 `--cancel` 仍入本格、再次尝试结束（注入计数为 2）」，变异表 N13 注明它同时守可重入 |
| CODEX-07 | codex | nit | 接受 | 核实成立：「未能确认退出」那一支的人工出路走下去就是 EV-159 那一格 | r2 §4.4 第 2 步「未能确认退出」告警与第 4 步「没有第二次机会」半句都指明：手工结束之后再跑 `--cancel` 只会结束 CLI，归档 run.json 与登记要人工核对（或等 EV-159）；r2 §6 MANUAL 行同写；r2 §8 EV-159 注明「它同时是手工结束之后唯一的归档闭环缺口，排在 EV-158 之后」 |
| AGY-01 | gemini | major | 接受 | 核实成立：告警与 stdout 自相矛盾，且掩盖了 worker 与锁仍在 | r2 §4.3：`mismatch` / `no_identity` 两格在 D3 之后**不打**原有两行，改打如实结论「运行 〈run〉 已被 --wait 判为失联（heartbeat_stale），但〈身份判不上 / 身份没记下〉，未对工作进程 〈pid〉 发信号；归档 run.json 与主题锁未动」；原有两行只留给不入本格的其余终态；r2 §3 两行、§5.1 K5 ④⑤ 断言相应改（stdout 不含「无需取消」）；变异 N16 |
| AGY-02 | gemini | minor | 接受 | 核实成立：`processAlive` 对假值启动时刻给 `sameProcess: true` | r2 §4.3 判格前置类型守卫：`worker_pid` 为整数且 > 1、`worker_started_at` 为 trim 后非空的字符串，否则 `no_identity`；r2 §5.1 K5 ⑤ 参数化（null、空串、`worker_pid` 为 1 / 字符串）；变异 N6 改为「守卫只判 null」 |
| AGY-03 | gemini | minor | 接受 | 核实成立：分流逻辑在 `reportFinalizeStep`，它的后半句写死了主路径处境 | r2 §4.4 第 4 步：`reportFinalizeStep` 加一个可选参数传「没有第二次机会」半句（缺省为主路径原句，主路径输出逐字不变），本格传自己的句子；分流规则不变（异常转成的跳过 warn、其余 step） |
| GLM-01 | glm | minor | 接受 | 核实成立：闸门回收与写 failed 不原子，本格按决策 4 不动闸门，这一窗口应如实保留；不改行为（改就是重开用户决策 4） | r2 §7.5 补一行：`--wait` 死在写 failed + `lost` 与回收闸门之间时闸门停在 running，本格不收；本格结束 worker 之后下次会话启动的 `sweepDeadRunningGates` 按「running 且 worker 已死」回收；今天同一窗口 worker、锁、闸门全卡住 |
| GLM-02 | glm | minor | 接受 | 同 AGY-02 | 同 AGY-02 的落点 |
| GLM-03 | glm | nit | 接受 | 同 CODEX-06 ① | r2 §1.4 |
| GLM-04 | glm | nit | 接受 | 核实成立：`no_status_file` 时没有 status.json 可写 | r2 §4.1 改为「三种原因都记；`no_status_file` 时 status.json 本就不存在、`patchStatus` 不执行，该事实只进报错正文」 |
| GLM-05 | glm | nit | 接受 | 同 CODEX-06 ② | r2 §1.3 |

## 2. 修订范围小结

- 行为面新增：`--wait` heartbeat_stale 报错的事实行（CODEX-01）；本格开场句的判定后写入事实（CODEX-01）；`mismatch` / `no_identity` 两格改打如实结论（AGY-01）；判格类型守卫（AGY-02）；`reportFinalizeStep` 可选后半句（AGY-03）。
- 验证面：J1 界式（CODEX-03）；K4 可重入（CODEX-06）；K5 ④⑤ 断言与参数化（AGY-01、AGY-02）；变异 N6 / N15 改、N16 新增。
- 文档面：D1 备选（CODEX-05）、对外 JSON 加法、如实保留两条（GLM-01、CODEX-04 的成因）、EV-159 注记与 MANUAL 出路（CODEX-07）、EV-160 新登（CODEX-02）。
- 不改：判据不引入锁里的启动时刻（CODEX-04 驳回）；闸门不动（GLM-01 只记保留）；配置合法性告警不在本主题（CODEX-02 暂缓）。
