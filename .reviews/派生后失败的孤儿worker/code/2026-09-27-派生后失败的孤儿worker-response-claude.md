---
schema: trivium.disposition.v1
topic: 派生后失败的孤儿worker
stage: code
role: claude
kind: response
run_id: 20260927T151757Z
addresses:
  - 2026-09-27-派生后失败的孤儿worker-codex.md
  - 2026-09-27-派生后失败的孤儿worker-gemini.md
  - 2026-09-27-派生后失败的孤儿worker-glm.md
---

# 应答：派生后失败的孤儿worker · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260927T151757Z.diff`（相对 HEAD `31005b4` 的 36 个文件变更，260.9 KB）
> ｜ 运行：`20260927T151757Z`（约 12 分 33 秒）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve`（零意见）｜ glm `approve-with-nits`
> ｜ 共 5 条（次要 3、吹毛求疵 2），**全部接受**；同指一处：CODEX-01 ≡ GLM-01 第（1）点（`settleOrphanedStart` 第 1 步的「已终止」播报无条件打印）

## 0. 核实记录

逐条对照工作树源码核过：

- **CODEX-01 ≡ GLM-01（1）**：`run-protocol.ts` `settleOrphanedStart` 在终止之后无条件 warn「已终止工作进程组 N（SIGTERM[，未响应后 SIGKILL]）」。三种形态下它不属实：`terminateProcessGroup` 一进门 `isGone()` 即为真、一个信号都没发（worker 已自行退出）；`gone` 为假（紧接着又说「未能确认退出」）；`terminate` 抛错被接住后 `escalated` 被写成 false，信号序列是猜的。`terminateProcessGroup` 的返回值里没有「实际发过哪些信号」，播报无从区分。
- **GLM-01（2）**：D5 分支里 `soft('把主题锁改记到工作进程名下', …)` 失败只打一行「…失败」，随后那句「主题锁已记在它名下」照打；锁内容既不是本进程的、也不是 worker 的（例如已被别人接管）时，改写被条件跳过，这句同样不实。这句出现在用户要照着手工处理的那条路上。
- **CODEX-03**：第 4 步之后 `readRunMeta(...).catch(() => null)`，而 `readRunMeta` 自己在读不出、不合契约时也返回 null（`meta.ts` `readRunMeta` 两处 `return null`）。null 与「读到了、仍是 running / 本进程收尾」落进同一格，第 5 步会把 status.json 落成 `failed`——若盘上其实是 worker 写的终态、只是此刻读不出，两个通道结论相反。与本主题「确认不了就不替它下结论」的口径不一致。
- **CODEX-02**：失败路径最坏阻塞 = 宽限 5 s + SIGKILL 后确认至多 5 s；D5 分支另有一次 `processStartTime`（`ps` 超时上限 10 s）。设计 7.5 `review --start` 行只写「立即返回」。skill 对 `--start` 没有设工具级超时，走 Bash 缺省 120 s，覆盖得住，但契约里没有写明这个上界。
- **CODEX-04**：报告 §3.4 A4「真实失败里两者都不存在」对第二条说得过满：EV-150 之后，这类运行以「终态 + 记了 `worker_pid`」进凭据清扫的准入；派生后失败的真实触发面正是本地读写失败（权限、磁盘），清扫读运行目录时同样可能报一族「抹除失败」，只是成因不再是夹具自设。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立（≡ GLM-01 第 1 点）：「已终止」一句在「未发信号 / 未能确认退出 / 终止出错」三格都不属实，而 MANUAL 正教用户按报错字样分辨结局。取建议的方向：让 `terminateProcessGroup` 返回实际发过的信号，播报按结果分句 | `src/trivium/util/exec.ts` `terminateProcessGroup` 返回值加 `signals: NodeJS.Signals[]`（按发出顺序）；`src/trivium/run-protocol.ts` `settleOrphanedStart` 第 1 步播报四分：已退出且没发过信号 ⇒「工作进程 N 在被终止之前已自行退出」；已退出且发过 ⇒「已终止工作进程组 N（SIGTERM[、SIGKILL]）」；未确认退出 ⇒「已向工作进程组 N 发送 …，未能确认退出」；终止出错 ⇒ 只保留出错那一行、不再补「已终止」；`cancelRun` 不用新字段；U4①～④ 追加 `signals` 断言，U5 追加播报断言；变异补一条（播报不看结果）；MANUAL 场景 4 措辞核对 |
| CODEX-02 | codex | nit | 接受 | 核实成立：失败路径的阻塞上界没写进契约。实际上界约 20 s（宽限 5 s + SIGKILL 后确认 5 s + D5 取启动时刻的 `ps` 至多 10 s），在 Bash 缺省 120 s 之内，不改行为参数，只把上界写明 | 设计 7.5 `review --start` 行补「子进程诞生之后失败时，收尾最长约 20 s 后才返回（仍在 Bash 缺省 120 s 工具超时之内）」；实施报告 §3.2 补上界论证；skill 不改（它对 `--start` 本就用缺省超时） |
| CODEX-03 | codex | minor | 接受 | 核实成立：`readRunMeta` 的 null 同时表示「读不出 / 不合契约」，被并进「本进程收尾」那一格，会让 status.json 与盘上 run.json 结论相反。改为第三态，与「确认不了就不替它下结论」同口径 | `src/trivium/run-protocol.ts` `settleOrphanedStart`：回读 run.json 为 null 时判为「读不出」，第 5 步只补 `worker_pid` / `worker_started_at`、不落 phase，并 warn「归档 run.json 读不出，status.json 的 phase 不替它下结论，请人工核对」；U5 新增⑤（run.json 预置为不可解析 ⇒ status.json phase 不变、补 pid、告警在场）；变异补一条（null 并回「本进程收尾」）；设计 6.7 注记 ⑤、LLD 第 7 条同步 |
| CODEX-04 | codex | nit | 接受 | 核实成立：第一条（59 个预建目录）只属构造；第二条的**这次成因**属构造，但同一族「抹除失败」告警在真实的权限 / 磁盘类失败下仍可能出现，原句会让人误以为它绝迹 | 实施报告 §3.4 A4 那句改为：「真实失败里不会出现『59 个读不到的预建目录』；『抹除失败』一族告警在权限 / 磁盘类成因下仍可能出现，属预期、下次会话启动重试，不是本主题的回归」 |
| GLM-01 | glm | minor | 接受 | 核实成立：第（1）点 ≡ CODEX-01；第（2）点——D5 分支改写锁失败或被条件跳过时，「主题锁已记在它名下」照打，恰在用户要照着手工处理的那条路上误导 | 第（1）点同 CODEX-01；第（2）点：`settleOrphanedStart` D5 分支记下改写锁的结果（已改写 / 原本就是 worker 的 / 当前锁既非本进程也非 worker 的 / 改写失败），末句按结果分句——只有前两种说「主题锁记在它名下」，后两种说明锁的实际归属与「本进程退出后可能按 pid_gone 被回收、孤儿若还活着会与新一轮并发」，并以 `--cancel` / 手工结束进程组为准；U5② 断言成功那一句，新增 U5⑥（改写失败 ⇒ 不出现「已记在它名下」）；变异补一条 |

## 2. 修改方案（审批后执行）

1. **代码**：
   - `util/exec.ts`：`terminateProcessGroup` 返回 `signals`（CODEX-01）。
   - `run-protocol.ts` `settleOrphanedStart`：第 1 步播报四分（CODEX-01 ≡ GLM-01）；D5 末句按改写锁的结果分句（GLM-01）；回读 run.json 为 null 时判第三态（CODEX-03）。
2. **用例**：U4①～④ 加 `signals` 断言；U5①② 加播报断言；新增 U5⑤（run.json 读不出）、U5⑥（D5 改写锁失败）。
3. **变异**：规格按修订后代码重生成，新增三条（播报不看结果、null 并回本进程收尾、D5 末句不看改写结果）；原规格与读数留 `.r0` 副本。M1 / M2 / M4 的失败用例名核对随之重跑。
4. **文档**：
   - 设计：6.7 注记 ⑤（第三态）、7.5 `review --start` 行（收尾上界）。
   - LLD：第 7 条同步。
   - MANUAL：场景 4 核对报错字样。
   - 实施报告：§3.2 补上界论证，§3.4 A4 那句改写，新增 §7「代码双审 r1 与修订」。
5. **读数**：修订后重跑全量 `npm run check`（两次：文档改前、改后）、源码变异、契约变异、零配额验收、`doctor --selftest`，读数写进报告 §7。
6. **不改**：D1～D8；`--start` 失败路径的宽限与等待参数（CODEX-02 只补文档）；skill 与入口资产。
