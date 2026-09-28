---
schema: trivium.disposition.v1
topic: 失联worker退出后补收
stage: plan
role: claude
kind: revised
run_id: 20260928T142320Z
addresses:
  - 2026-09-28-失联worker退出后补收-codex.md
  - 2026-09-28-失联worker退出后补收-gemini.md
  - 2026-09-28-失联worker退出后补收-glm.md
---

# 裁决：失联worker退出后补收 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-28-失联worker退出后补收-claude.md`（r1，起点 `fc42d30`）
> ｜ 运行：`20260928T142320Z`（约 9 分 20 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 2）｜ gemini `request-changes`（重要 1、次要 1、吹毛求疵 1）｜ glm `request-changes`（重要 2、次要 2）
> ｜ 共 10 条（去重后 8 条）：接受 8、驳回 0、暂缓 0
> ｜ CODEX-01 ≡ AGY-01 ≡ GLM-02 为同一条；CODEX-03 ≡ GLM-04 为同一条
> ｜ 修订后的计划：`plan/2026-09-28-失联worker退出后补收-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01 ≡ AGY-01 ≡ GLM-02**：成立。`meta.ts` :690（已是终态 ⇒ skip）、:676（归档里没有文件 ⇒ skip）均为非错误跳过，
  `reportFinalizeStep` 已如实播报「未回写」；r1 §3.3 的 `finalizeGoneWorker` 在这两种情形下仍无条件 `say`「已按前提补收」，
  与上一行自相矛盾，违背用户决策 6。`run-protocol.ts` :1587（`alive` 格既有结论句）从不复述归档结果，只说「见上方输出」，
  是应当沿用而 r1 没有沿用的既有范式。
- **GLM-01**：成立。`status.ts` :413-420：情形 C 先判进程死活（死 ⇒ 无条件 `pid_gone`，注释「无论心跳是否还新鲜」），
  心跳过期判断在其后；`test/integration/run-protocol.test.ts` :846-852（K2-GONE）实证。r1 §5.4 A1「先杀后判」的次序
  会让旧版判出 `pid_gone` 而非 `heartbeat_stale`，`classifyLostCancel` 首行即落 `none` 格，A1 自身判据无法成立。
- **CODEX-02**：成立。`run-protocol.ts` :1486-1525：走到共享函数第 4 步即已确认 worker 死亡，下一次 `--cancel` 必落
  `gone` 格，不是「同一格」（`alive` 格）。
- **GLM-03**：成立。r1 §3.2 `noSecondChance` 首句「没写成可以……重试」的断句在「没写成」与「可以……重试」之间容易被
  读反；与 CODEX-02 的「格」指称问题一并改写。
- **CODEX-03 ≡ GLM-04**：成立。r1 §5.2 G1 判据只列结果事实，没有输出顺序断言，§5.3 M8「预期咬住＝G1 输出顺序断言」
  与实际不符；`finalizeGoneWorker` 挪到 CLI 结束块之前会因其 `return` 使 CLI 结束块整段不可达（codex 的补充观察），
  G1 既有的 CLI 结束断言本可拦住这一变异，但显式顺序断言仍是应补的完备性缺口（glm 的角度）。
- **AGY-02**：成立。`meta.ts` :576-581 文档块枚举「七个调用方」未覆盖 `gone` 格经 `finalizeLostAndReclaimLock` 间接
  调用 `finalizeFailedRunMeta` 这第八个调用方。
- **AGY-03**：成立。r1 正文「改法」为 `## 3.`（子节 3.1-3.5），但交叉引用与 `### 4.5`/`### 4.6` 两节使用了脱离该序列
  的 `§4.x` 编号，属改稿过程中编号方案变更后正文未全部同步的遗留问题；「квирк」确系西里尔字母误输入。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：结论句硬编码「已按前提补收」在可重入、归档缺失两种非错误跳过情形下均为假话，违背用户决策 6；`alive` 格既有结论句「见上方输出」的范式应予沿用，比按结果分流文案更简单也更不易再错 | r2 §3.3：`finalizeGoneWorker` 结论句固定为「工作进程 N 已不在」+「……不追溯改写；归档 run.json 与运行登记见上方输出」，不复述两步结果；r2 §4.1 N2/N7 断言据此更新（结构上不再存在「已补收」字样） |
| AGY-01 | gemini | major | 接受 | 同 CODEX-01（三侧独立发现同一处） | 同 CODEX-01 的落点 |
| GLM-02 | glm | major | 接受 | 同 CODEX-01（三侧独立发现同一处） | 同 CODEX-01 的落点 |
| GLM-01 | glm | major | 接受 | 核实成立：`status.ts` :413-420 情形 C 先判进程死活、后判心跳，先杀 worker 会被旧版判 `pid_gone`，A1 判据无法达成 | r2 §4.4 A1 改为：旧构建 `--start`；worker 仍存活时旧构建 `--wait` 先判 `heartbeat_stale`（此刻其自身补收因 `workerGone=false` 跳过，run.json 停在 running）；随后按组 `kill -9`；新构建 `--cancel`。显式写明「强杀必须发生在失联判定之后」的时序约束；A2/A3 复用改正后的 A1 产物 |
| CODEX-02 | codex | minor | 接受 | 核实成立：走到共享函数第 4 步已确认 worker 死亡，下次必落 `gone` 格，非「同一格」 | 与 GLM-03 合并处理，见下 |
| GLM-03 | glm | minor | 接受 | 核实成立：首句断句易被读反，且「格」指称需与 CODEX-02 一并改准 | r2 §3.2 `noSecondChance` 改写为清楚的肯定句：「这一步可以再跑一次 --cancel 重试：只要 run.json 仍为 running，再跑一次会落进会重试这一步的格（本次工作进程已被结束过，下一次判格时它已经不在了，通常是 gone 格；EV-159 起 gone 格与 alive 格一样会重试这一步）。若这次写失败的原因是持续性故障（比如目录只读），重试不会自愈，请人工核对归档 run.json 与 task.json 的运行登记」；r2 §4.1 K9/N4 断言同步 |
| CODEX-03 | codex | minor | 接受 | 核实成立：G1 判据未含顺序断言，M8「预期咬住」描述与实际拦截点不完全对应 | 与 GLM-04 合并处理，见下 |
| GLM-04 | glm | minor | 接受 | 核实成立：G1 应补显式顺序断言，M8 应改指到位 | r2 §4.2 G1 新增顺序断言（合并输出中「按记录结束审查员 CLI」先于「已把归档里的 run-…json 收尾为 failed」首次出现）；r2 §4.3 M8「预期咬住」改为「G1 的 CLI 结束断言 + 新增的顺序断言」 |
| AGY-02 | gemini | minor | 接受 | 核实成立：`meta.ts` :576-581 的调用方枚举漏了 gone 格这第八个调用方 | r2 §3.5：`meta.ts` 文档块「七个调用方」→「八个调用方」，补一条枚举；r2 §5 文档同步清单同步列出 |
| AGY-03 | gemini | nit | 接受 | 核实成立：§4.1/§4.2/§4.4/§4.5/§4.6 悬空引用与「квирк」笔误均属实 | r2 全篇：`### 4.5`→`### 3.6`，`### 4.6`→`### 3.7`，全部 §4.x 交叉引用改为 §3.x；「квирк」→「quirk」 |

---

**裁决汇总**：10 条（去重后 8 条）全部接受，0 驳回、0 暂缓。r2 定稿已按上述落点逐条修订。
