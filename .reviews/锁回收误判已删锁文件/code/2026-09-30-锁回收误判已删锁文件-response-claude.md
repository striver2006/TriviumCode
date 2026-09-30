---
schema: trivium.disposition.v1
topic: 锁回收误判已删锁文件
stage: code
role: claude
kind: response
run_id: 20260930T050232Z
addresses:
  - 2026-09-30-锁回收误判已删锁文件-codex.md
  - 2026-09-30-锁回收误判已删锁文件-gemini.md
  - 2026-09-30-锁回收误判已删锁文件-glm.md
---

# 应答：锁回收误判已删锁文件 · 代码双审第 1 轮

> 被审对象：相对 `3e38d29` 的未提交改动（50 个文件，补丁 1025 KB）
> ｜ 运行：`20260930T050232Z`（约 9 分钟）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 3）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01 ≡ GLM-01**：成立。`doc/01_requirements/原始需求.txt` 的改动是用户自己的工作树改动（会话开始时 `git status` 已是 `M`，计划原稿与实施报告的「起点」行都已注明与本主题无关），本主题没有写过它；但它确实进了本轮 `changes.diff`。处置：**不代改用户内容**（含那行只有空格的行），不纳入本主题的提交——提交时按文件名逐个 `git add`，由用户决定它的去留。
- **CODEX-02**：成立。`acquireLock` 回收返回 false 后立刻 `continue`，不经循环末的 `retryDelayMs`。D8 之前这一路只在「别人先 rename 了」时走一次；D8 之后，认领者中途崩溃、认领未满 10 s 时，等待者每轮都撞认领 EEXIST 后立刻重来，最长约 10 s，且每轮要派生两次 `ps`（取自身启动时刻与判定持有者）。
- **CODEX-03 ≡ GLM-03**：成立。认领与 `.stale-` tmp 只在正常路径的 `finally` 里删；进程在两者之间被 SIGKILL 会残留，而认领按年龄清理只在「同身份的后来者撞 EEXIST」时发生，原锁一旦收走，同身份后来者就不存在。已核 `hooks.ts` 按 `.lock` 后缀枚举锁目录，残件不会被误读成锁，只是垃圾文件。LLD 与主设计里「10 s 以上按认领者中途死了清掉」的写法确实容易被读成有通用回收。
- **CODEX-04**：成立（按代码论证，本轮补单测实测）。`fs.rm(…, { force: true })` 只吞 ENOENT；锁路径被一个目录占着时，`readLockFile` 给 `present`、`content: null`、身份取目录的 `fstat`，旧了会被判 `unparsable` 回收，rename 走整个目录后复验按身份相符，`finally` 的 `rm` 抛 `ERR_FS_EISDIR` 穿透到调用方。tmp 那处 `rm` 在旧代码里同形（非本次回归），认领那处是本次新加。
- **GLM-02**：成立。认领创建的 catch 只处理 EEXIST，其余 errno 静默 `return false`，与 D4 放不回时的告警口径不一致。
- **GLM-04**：成立。`git diff --numstat -- src/trivium/run-protocol.ts` 为 `6 2`，报告误写「+8 −2」。

## 1. 逐条应答

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：用户自己的工作树改动混进了本轮 diff；它不属于本主题 | 不改该文件、不代改用户内容；实施报告 §3.3 登记「`原始需求.txt` 是用户改动，不随本主题提交」；提交时按文件名逐个 add、排除它（提交由用户发起） |
| CODEX-02 | codex | minor | 接受 | 核实成立：认领撞车后零间隔重来，认领者崩溃时最长约 10 s 空转 | `lock.ts` `acquireLock`：回收返回 false 时先睡一个 `retryDelayMs` 再 `continue`（预算与间隔的取值都不变，只在这一路补上间隔；`missing` 那一路仍立刻重试）；U14 断言「认领被占时两次判定之间至少隔一个间隔」 |
| CODEX-03 | codex | nit | 接受 | 核实成立：崩溃残件无通用清扫，文档措辞易误读 | 不改码；主设计 §12.6 与 LLD 4.3 把「10 s 以上按认领者中途死了清掉」改注为「只在同身份的后来者撞上时机会性清理」；EV-174 与 LLD 缺口表补第四格「崩溃残件（`.reclaim-*` / `.stale-*` / `.tmp-*`）无通用清扫，候选：会话启动按年龄清」 |
| CODEX-04 | codex | nit | 接受 | 核实成立：清理失败不该改变获取结果的类型与退出码 | `lock.ts`：`reclaimStaleLock` 与 `renameAndVerify` 两处 `finally` 的 `rm` 都 `.catch(() => undefined)`；U13：锁路径被一个 60 s 前的目录占着 ⇒ `acquireLock` 不抛非 70 的异常、照常拿到锁 |
| GLM-02 | glm | nit | 接受 | 核实成立：新引入的静默失败面 | `lock.ts` `reclaimStaleLock`：认领创建遇 EEXIST 之外的错误时 `warn` 一行（带锁名与 errno），仍 fail-closed 返回 false；U13 同组断言该告警 |
| GLM-03 | glm | nit | 接受 | 与 CODEX-03 同一事实 | 同 CODEX-03 |
| GLM-04 | glm | nit | 接受 | 核实成立 | 实施报告 §1 末段改为「`run-protocol.ts`（+6 −2）」 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同一事实 | 同 CODEX-01 |

## 2. 修订计划

1. `src/trivium/lock.ts`：CODEX-02 的间隔、CODEX-04 的两处清理吞错、GLM-02 的告警；
2. `test/unit/lock.test.ts`：新增 U13（目录占位 + 认领创建失败告警）、U14（认领被占时的重试间隔）；
3. 文档：主设计 §12.6 与变更记录、LLD 4.3 与缺口表与 2.7 行数、BACKLOG EV-174、实施报告（§1 行数、§3.3 用户改动、§5 代码双审 r1 与修订后读数）；
4. 修订后重跑：锁单测与跨进程用例、变异（新增条目）、验收、全量检查、doctor 自检。
