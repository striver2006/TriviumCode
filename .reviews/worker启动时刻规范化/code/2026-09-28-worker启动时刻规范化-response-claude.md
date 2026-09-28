---
schema: trivium.disposition.v1
topic: worker启动时刻规范化
stage: code
role: claude
kind: response
run_id: 20260928T120630Z
addresses:
  - 2026-09-28-worker启动时刻规范化-codex.md
  - 2026-09-28-worker启动时刻规范化-gemini.md
  - 2026-09-28-worker启动时刻规范化-glm.md
---

# 应答：worker启动时刻规范化 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260928T120630Z.diff`（相对 HEAD `6b89cc0` 的 33 个文件，696.8 KB——体积大头是 evidence 里两份全量输出）
> ｜ 运行：`20260928T120630Z`（约 9 分 28 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve`（零意见）
> ｜ 共 3 条，**全部接受**；CODEX-01 取「写成参数上的硬约束」而不删参数，CODEX-03 只取「登记为已知约束」那一半（其并发后果的前提不成立，见 §0）
> ｜ 命令 A 不设人工闸门：按接受项修订后重跑读数、写进报告 §4

## 0. 核实记录

- **CODEX-01**：成立。`interpretStatus` 情形 A 仍以 `processAlive(pid, opts.fallbackPidStartedAt)` 按读者缺省环境比，是「只有一个读法」之外的唯一入口；生产不传（`waitRun` 只传 `fallbackPid`），「没人传」靠记性维持。建议的两个办法里，删参数要改两处既有用例（`test/unit/status.test.ts` :85、:110 以它构造「status.json 尚未出现、worker.pid 已知」的格），且情形 C 也把它当缺省形态的回落值；取第二个办法：把约束写在参数上。
- **CODEX-02**：成立。`sweepDeadRunningGates` 的文档块已改成「只看存活」，调用行仍传 `st.worker_started_at`——值被取 `ps`、比对、然后丢弃，实参与注释相悖，后来者容易顺手加上 `sameProcess`。改传 null：`processAlive` 的 `.alive` 与期望值无关，行为逐字不变（对活进程仍取一次 `ps`，计划 r2 §4.5 已述，不影响）。
- **CODEX-03**：**部分成立**。两处锁改写确是非原子 `fs.writeFile`，且非本主题回归；但「并发者读到截断 JSON ⇒ `judgeStale` 判 `unparsable` ⇒ 被 `reclaimStaleLock` 回收」这条后果不成立：`acquireLock` 在判出 `unparsable` 后还有一道「文件修改不足 2 s 不回收」的防御（`lock.ts`，`fileAgeMs(p) < 2_000` ⇒ `stale = null`），改写刚发生、mtime 是新的，撕裂读只会让争用者按「已被占用」重试或退 70，不会回收。计划 r2 §7.5 已记这一句。换 `writeAtomic` 与 EV-158 无关、改动面在锁的写法上（临时文件 + rename 与 `link` 进位的既有纪律要一并论证），不在本主题做；取「把这个事实从读代码才能发现变成登记过的约束」那一半。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：情形 A 是规范化读法之外唯一按读者缺省环境比启动时刻的入口，「生产不传」靠记性维持；删参数要改两处既有用例且情形 C 也用它，取硬约束写法 | `status.ts` `interpretStatus` 的 `fallbackPidStartedAt` 文档块写明：它是**调用方自己环境下取的缺省形态**，只供同进程构造（单测）；生产代码不得传入，尤其不得传锁或 status.json 里别的进程写下的启动时刻——跨进程的身份一律经 status.json 的两字段与 `processMatchesRecord`（EV-158） |
| CODEX-02 | codex | nit | 接受 | 核实成立：注释说只看存活、实参仍传启动时刻，二者相悖，易被顺手改成比 `sameProcess`；改传 null 行为逐字不变 | `hooks.ts` `sweepDeadRunningGates`：`processAlive(st.worker_pid, null)`，行尾注明「只取 `.alive`；不传启动时刻，免得被误读成在比身份」 |
| CODEX-03 | codex | minor | 接受 | 部分成立：非原子改写属实、非回归；「活锁被回收」不成立——`acquireLock` 对修改不足 2 s 的不可解析锁不回收。换 `writeAtomic` 与本主题无关，只取登记约束那一半 | `run-protocol.ts` `startRun` 与 `settleOrphanedStart` 两处锁改写旁各加一句注释：「非原子写：撕裂读判 `unparsable`，由 `acquireLock` 的 2 s 新鲜度防御兜住、不回收（计划 r2 §7.5）」；`lock.ts` `workerLockContent` 文档块同写一句 |

## 2. 修改方案（命令 A：应答后直接执行）

1. **代码**：`status.ts`（参数文档）、`hooks.ts`（实参改 null + 行尾注释）、`run-protocol.ts` 两处注释、`lock.ts` 文档块一句。均不改行为。
2. **用例**：不新增——三处都是注释或行为不变的实参替换；`hooks.ts` 那一处由既有「worker 还活着时 hook-session-start 绝不回收」「hook-session-start 回收 worker 已死……」两条与本主题 I1～I5 覆盖。
3. **读数**：修订后重跑全量（两次）、源码变异（按修订后代码重生成规格、原规格与读数留 `.r1`）、失败用例名核对、零配额验收、`doctor --selftest`；写进报告 §4。
4. **不改**：不删 `fallbackPidStartedAt`（CODEX-01 的第一种办法）；锁改写不换 `writeAtomic`（CODEX-03 的第一种办法）。
