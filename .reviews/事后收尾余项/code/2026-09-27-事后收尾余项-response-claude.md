---
schema: trivium.disposition.v1
topic: 事后收尾余项
stage: code
role: claude
kind: response
run_id: 20260927T074234Z
addresses:
  - 2026-09-27-事后收尾余项-codex.md
  - 2026-09-27-事后收尾余项-gemini.md
  - 2026-09-27-事后收尾余项-glm.md
---

# 应答：事后收尾余项 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260927T074234Z.diff`（相对 HEAD `a89a46f` 的 28 个文件变更，224.5 KB）
> ｜ 运行：`20260927T074234Z`（约 16 分钟）
> ｜ 结论：codex 解析降级（原文自报 `approve-with-nits`，闸门按降级单元 `CODEX-F01` / `CODEX-F02` 校验）｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ codex 原文 7 条（重要 1、次要 3、吹毛求疵 3）+ AGY-01（吹毛求疵）+ GLM-01（次要）
> ｜ **实质意见全部接受**。同指一组：codex 原文 CODEX-03 ≡ AGY-01 ≡ GLM-01（LLD `startRun` 一节的行号锚点漂移）。

## 0. 本轮的形状

codex 侧输出没能结构化解析，闸门只认两个降级单元：`CODEX-F01` 是一句开场白，`CODEX-F02` 是整段 JSON（内含 codex 原文编号 CODEX-01～07）。第 1 节裁决表按闸门认的四个编号各给一行；第 2 节把 F02 里的七条逐条裁决——实质意见不因解析降级而被笼统处理。

已逐条对照代码核实：

- **原文 CODEX-01**：`util/exec.ts` 的空监听 `child.once('error', () => {})` 确实把 `spawn` 的真实成因丢掉，抛出的只有「spawn 未返回 pid」，注释「已由 pid 缺失路径报告」与实现不符；`worker.log` 此时是空文件。
- **原文 CODEX-02**：`startRun`（`run-protocol.ts` :295-307）与同步路径 `runReview`（`review.ts` 的 `acquireLock`）两处 `kind: 'run'` 都**不传 `runId`**，锁内容 `run_id` 为 null（`lock.ts` :164），`runTerminal(null)` 直接判否，`judgeStale` 的「运行已终态」判据在本进程收尾的尾窗里用不上——新 `--start` 只会退 70。**这正是我在计划双审 r1 接受 GLM-01（计划）时写进 r2 §3.3 / §6.1 的论证，它不成立**；设计 6.7 注记与 `run-protocol.ts` 主 `catch` 注释照抄了这条。行为保守无害，错的是理由。
- **原文 CODEX-04**：准备阶段失败是亚秒级的，同一秒内重跑会用同名骨架覆盖刚写的 `failed` + `termination`（EV-147 同形）。
- **原文 CODEX-05**：交接文件与 status.json 写成之后才失败的几格（副本源复查之后、`spawnDetached` 内部），`--cancel` 取得到身份；真正让它们不动这份 run.json 的是前提 4 与「无 pid 即未确认退出」。
- **原文 CODEX-06**：「这一步不会再有第二次机会…」三处字面拷贝，`reportFinalizeStep` 没走新抽出的函数。
- **原文 CODEX-07**：`exit-codes.ts` `usageError =(`，等号后的空格确实丢了（Edit 时连带改了原行）。
- **原文 CODEX-03 ≡ AGY-01 ≡ GLM-01**：LLD `startRun` 一节 `run-protocol.ts:223`、`:228-240`、`:258-276`、`:304-313`、`review.ts:275`、`:488-491`、`meta.ts:31` 均已漂移。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | 解析降级 | 驳回 | 这一单元是 codex 输出的开场白（「I have completed my review…」），不含任何可执行的主张；实质意见全部在 CODEX-F02 里 | 无修改（开场白不构成意见） |
| CODEX-F02 | codex | 解析降级 | 接受 | 这一单元即 codex 的完整结论 JSON（自报 `approve-with-nits`，原文 7 条）；逐条核实后全部接受，逐条裁决、理由与落点见第 2 节 | 见第 2 节原文 CODEX-01～07 各条的落点：`util/exec.ts`、`run-protocol.ts`、`meta.ts`、`exit-codes.ts`、`worker-detach.test.ts` U2、设计 6.7 注记、LLD `startRun` 一节与 4.2 引述块、BACKLOG EV-147、实施报告 §7 |
| AGY-01 | gemini | nit | 接受 | 成立（≡ codex 原文 CODEX-03 ≡ GLM-01）：本次改写了 LLD `startRun` 一节的第 5、7 条却没顺手校准同节的行号锚点，照链接跳过去看到的是不相关的代码 | `doc/02_design/LLD_orchestrator.md` `startRun()` 一节与 `prepareRun()` 零工件不变式段：`run-protocol.ts`、`review.ts`、`meta.ts` 的锚点按修订后代码改准并附函数 / 段落名（见第 2 节原文 CODEX-03） |
| GLM-01 | glm | minor | 接受 | 成立（≡ codex 原文 CODEX-03 ≡ AGY-01）。glm 建议「下次触碰时再改、不必单独返工」，但本次恰好改了这两节、代码双审修订本来就要重跑读数，顺手改准成本最低 | 同 AGY-01 |

## 2. CODEX-F02 所含七条的逐条裁决

- **原文 CODEX-01（major）——接受。** 成立。计划外修正只做了一半：不崩了，但成因被空监听吞掉，现场只剩「spawn 未返回 pid」与一份空 `worker.log`；而 `runtime.node` 或 wrapper 里钉死的 node 路径随 Homebrew 升级消失，正是本仓已知会复发的 ENOENT 触发面。取建议的第一种：pid 缺失时等那次异步 `'error'` 到达（设 1 秒上限，防它不来）再抛，报错正文带上可执行文件路径与 `code` / `message`，并在关句柄之前往 `worker.log` 写一行；归档侧仍不存原因文本（守 EV-142 口径）。
  落点：`src/trivium/util/exec.ts` `spawnDetached`（pid 缺失分支取回错误对象、抛出带成因的错误、写 `worker.log`，注释改为与实现相符）；`test/integration/worker-detach.test.ts` U2 追加断言（报错含 `ENOENT` 与可执行文件路径、`worker.log` 有这一行）；变异加 M13（成因不进报错正文 ⇒ U2 红）；LLD `startRun` 第 5 条同步一句。
- **原文 CODEX-02（minor）——接受，取建议 ②（不改代码、改理由）。** 两处运行锁不带 `run_id`，尾窗里并发的新 `--start` 拿不到锁即退 70，与 worker 收尾后持锁（锁内容已有 `run_id`）的窗口不同形；「先收尾、后放锁」的真实依据是「收尾只有一次机会，放锁前写完留痕；尾窗里新 `--start` 退 70，保守无害」。不取 ①：让运行锁提前带上 `run_id` 会改变锁内容的时点与 `inspectLock` 读者的语义，超出本主题。EV-151 不受影响：它说的是 worker 已接管、锁内容已带 `run_id` 之后的遗留锁；EV-150 同样。计划 r2 §3.3 / §6.1 的那两句已提交、不改，实施报告如实记下这一处错。
  落点：设计 6.7 注记「本进程的事后收尾」段末两句改写；`run-protocol.ts` 主 `catch` 注释改写；实施报告新增 §7 记录计划 r2 §3.3 / §6.1（接受计划双审 r1 GLM-01 时写入）的论证不成立。
- **原文 CODEX-03（minor）——接受**（≡ AGY-01 ≡ GLM-01）。本次改写了同一节却没顺手校准锚点。按改完后的现值更新，并在每处锚点旁保留函数或段落名，行号再漂也还能按名字找到。不取「加一条 grep 级对账用例」：LLD 里带行号的引用有几十处，全量对账是另一件事，不在本主题做。
  落点：同 AGY-01。
- **原文 CODEX-04（minor）——接受。** 准备阶段失败亚秒级完成，同秒内重跑会用同名骨架覆盖刚写的终态留痕——本主题的收尾让 EV-147 从「骨架丢失」升级为「终态留痕丢失」。不在本主题动 `newRunId`（EV-147 已登记、碰 run_id 格式）。
  落点：`doc/08_project/BACKLOG.md` EV-147 行补这一格触发面；设计 6.7 注记「每份 run.json 至多一次终态写入」一句后补限定（同名覆盖属 EV-147 已知面）。
- **原文 CODEX-05（nit）——接受。** 「拿不到身份」只对部分格成立；真正的保证是前提 4（已是终态不追溯改写）与「无 pid 即未确认退出」，加主题任务锁串行。
  落点：设计 6.7 注记该句、`meta.ts` `workerGone` 文档块、LLD 4.2 引述块同一口径改写。
- **原文 CODEX-06（nit）——接受。** 让 `reportFinalizeStep` 也经 `describeFinalizeStepWith` 出文案（只保留 step / warn 的分流），输出字面不变；`describeFinalizeStepWith` 的文档块点名三个使用者。
  落点：`src/trivium/run-protocol.ts` `reportFinalizeStep`；`src/trivium/meta.ts` `describeFinalizeStepWith` 文档块。
- **原文 CODEX-07（nit）——接受。** Edit 时连带改了原行。
  落点：`src/trivium/exit-codes.ts` `usageError = (` 补回空格。

## 3. 修改方案（审批后执行）

1. **代码**：`util/exec.ts`（原文 CODEX-01：成因进报错正文与 `worker.log`、注释改实）；`run-protocol.ts`（原文 CODEX-02 注释改写；原文 CODEX-06 `reportFinalizeStep` 委托）；`meta.ts`（原文 CODEX-05 / CODEX-06 文档块）；`exit-codes.ts`（原文 CODEX-07）。
2. **用例与变异**：U2 追加成因断言；变异规格按修订后代码重生成，新增 M13；装置重跑（原规格与读数留 `.r0` 副本）。
3. **文档**：设计 6.7 注记（原文 CODEX-02 / CODEX-04 / CODEX-05）；LLD 锚点与 4.2 引述块（原文 CODEX-03 / AGY-01 / GLM-01 / 原文 CODEX-05）；BACKLOG EV-147（原文 CODEX-04）；实施报告新增 §7「代码双审 r1 与修订」，含计划 r2 那条论证不成立的记录。
4. **读数**：修订后全量 `npm run check`、`doctor --selftest`、零配额验收重跑；读数写进报告。
5. 不改：决策 D1～D7；运行锁的获取方式（原文 CODEX-02 ①）；`newRunId`（原文 CODEX-04）；不加 LLD 行号对账用例（原文 CODEX-03）。
