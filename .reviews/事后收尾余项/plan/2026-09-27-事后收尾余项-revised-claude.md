---
schema: trivium.disposition.v1
topic: 事后收尾余项
stage: plan
role: claude
kind: revised
run_id: 20260927T052648Z
addresses:
  - 2026-09-27-事后收尾余项-codex.md
  - 2026-09-27-事后收尾余项-gemini.md
  - 2026-09-27-事后收尾余项-glm.md
---

# 裁决：事后收尾余项 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-27-事后收尾余项-claude.md`（r1，起点 `53eaab8`）
> ｜ 运行：`20260927T052648Z`（10m35s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 7 条：次要 6 ｜ 吹毛求疵 1 ｜ 零阻断、零重要
> ｜ **7 条全部接受**。同指一组：CODEX-03 ≡ GLM-02（`spawnDetached` 在 `spawn()` 之前失败的子格没有 worker，却被划进「派生后」）。三侧对 §1 行号、§3.5 写者排除、切分判据方向、D1 / D5 的结论一致认同。

## 0. 本轮的形状

没有一条改变方向。七条分三类：①一处判据可以收得更准（CODEX-03 ≡ GLM-02：把 `spawnDetached` 内部、子进程诞生之前的三个失败点划回「派生前」）；②三处论证或注释与代码不符（GLM-01：`runTerminal` 判据让收尾之后、放锁之前的尾窗里新 `--start` 能接过锁；CODEX-01：`meta.ts` 通用体文档块的次序规约与新调用方相反；CODEX-04：schema 是构建期内嵌的，「只回代码不回 schema」要写成可执行的回滚步骤）；③两处实施细节（CODEX-02：预建目录时间窗的命中前置断言；AGY-01：播报函数缺场景入参）。

已核：`lock.ts` :80-81（活进程 + run 已终态 ⇒ `heartbeat_dead`）；`meta.ts` :588-589（「锁与闸门回收排在它之后」）；`schemas.ts` :20（`run.v2.json` 以 `import … with { type: 'json' }` 内嵌）；`util/exec.ts` :283 / :285 在 `spawn()` 之前、:300 pid 缺失即抛；`spawnDetached` 的生产调用方只有 `run-protocol.ts` :378，其余调用都在测试里，加可选参数不破坏它们。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 成立：`meta.ts` :588-589「锁与闸门回收排在它之后，归档侧失败不得连坐那两项」是面向调用方的次序规约，对 `--cancel` / `--wait` / worker 三条路成立，对本主题三格相反（闸门在前）。只删不改会丢掉 EV-128 r1 CODEX-01 的教训，所以改成按「有没有下一次补齐的入口」分两种次序、各写理由 | r2 §3.7 表 `meta.ts` 行补 :585-589 一句的改写；§3.2 第二条补一句点明与该文档块的关系 |
| CODEX-02 | codex | minor | 接受 | 成立：P3 / P4 靠「预建目录的时间窗命中 `--start` 的 run_id」，全量满载时漏命中会把 M3 / M4 判成逃逸或反向误红；§2 探针 15 秒与 P3 的 10 秒口径不一。不取「重跑该用例」：本仓没有用例级重试惯例，改为命中前置断言、未命中即以明确文案失败 | r2 §4.2 P3 / P4（含新增的 P3b）：窗口统一为从预建时刻起 60 秒；先断言 `--start` 报出的 run_id（从报错正文或 `_meta/` 里唯一的新 run.json 取）属于预建集合，不属于即以「预建窗口未命中」失败，不进后续断言；§2 注明探针用 15 秒、用例用 60 秒的理由；§4.3 注明 M3 / M4 的判定以命中断言为前提 |
| CODEX-03 | codex | minor | 接受 | 成立（≡ GLM-02）：`spawnDetached` 里建日志目录（:283）、开日志文件（:285）、`spawn()` 未返回 pid（:300）三个失败点都在子进程诞生之前，按 r1 的判据被划进「派生后」，结果 run.json 永远 `running` 且 `--wait` / `--cancel` 都够不着——正是本主题要消的形态，又没被 EV-150 准确登记。取建议 (a)：`spawnDetached` 加可选回调 `onSpawned(pid)`，只在拿到 pid 之后、`return` 与 `finally` 之前调用；`startRun` 在回调里置 `spawned = true`，判据由「调用之前」收窄为「子进程已诞生之前」。唯一「已派生仍抛」的点 `handle.close()` 落在回调之后，仍按派生后处理 | r2 §1.1 P4 补三个失败点的位置；§3.3 判据与伪代码改为回调置位；§3.5 第 ② 行补这三格；§4.2 新增 P3b（预建运行目录里放一个名为 `worker.log` 的目录 ⇒ 开日志文件 EISDIR、无子进程 ⇒ 收尾为 `prepare_exception`）；§4.3 新增 M8（回调置位挪到 `spawnDetached` 调用之前 ⇒ P3b 红）；§6.4 EV-150 触发面改为只剩 `handle.close()` 与 :383-401；§5 LLD `startRun` 第 5 条补回调 |
| CODEX-04 | codex | minor | 接受 | 成立：`run.v2.json` 经 `schemas.ts` :20 在构建期内嵌进 bundle，运行时用的是已安装的 bundle；按常规 revert（连 schema 一起退）或从旧提交构建重装，旧代码带旧内嵌 schema，照样把新取值读成 null ⇒ `corrupt` ⇒ EV-148 同形循环。「只增不减」是纪律，要落成人能照做的步骤，并给一格演练证据 | r2 §6.3 改写为回滚步骤：回退本主题代码提交时保留 `run.v2.json` 的本次改动 → 从该状态构建 → 用户终端重装；写明漏掉这一步的形态（该阶段 `review --start` 退 2、`gate` 退 65）与出口（补回 schema 后重建重装）；§4.4 新增 A8 回滚演练：`53eaab8` 的源码配本主题的 `run.v2.json` 构建，读一份 `prepare_exception` 的 run.json ⇒ 可读、`report` 说明落兜底；对照组纯 `53eaab8` 构建 ⇒ 读成 null |
| AGY-01 | gemini | nit | 接受 | 成立：`FinalizeStep` 不带场景信息，`finalizeLines(fin, runId)` 产不出 §3.6 承诺的「准备阶段失败 / 同步路径异常」 | r2 §3.2 / §3.3 / §3.4 伪代码改为 `finalizeLines(fin, runId, scene)`，`scene` 由调用方传入；§3.6 写明签名 |
| GLM-01 | glm | minor | 接受 | 成立：`judgeStale` 在 run 已终态时对活进程持有的锁也判 `heartbeat_dead`（`lock.ts` :80-81），而三格都是先收尾、后放锁——收尾写成终态之后、放锁之前的尾窗里，并发 `--start` 能按 `runTerminal` 接过主题锁。后果无害：两个写者按各自 run_id 改各自的 run.json 与登记条目，task.json 在任务锁里串行；本进程随后的 `lock.release()` 核对锁内容，不会删掉新持有者的锁；与 worker 在 :1660 写完终态后持锁到 `finally` 的既有窗口同形。执行顺序不改，改准论证 | r2 §3.3「放锁挪到收尾之后」一条改写为「收尾期间主题锁仍在，但写成终态之后的尾窗里新 `--start` 可按 `runTerminal` 接过，与 worker 正常收尾后持锁的窗口同形、无害」；§3.5 表「下一次 `--start` 回收遗留锁」的排除依据改为这一句；§6.1「`runTerminal` 翻转」条不再写「不改变任何回收结果」 |
| GLM-02 | glm | minor | 接受 | 成立（≡ CODEX-03）：「派生后 worker 一定在跑」只被 :383 的构造支撑，`spawnDetached` 在 `spawn()` 之前失败的子格没有 worker。GLM-02 建议判据不动、只改登记；CODEX-03 另给了收窄判据的 (a)，本裁决取 (a)——那几格可以零配额构造、可以收尾，就不留在登记里 | 同 CODEX-03 的落点；另 §2.3 结论行把「worker 一定在跑」改为「子进程诞生之后 worker 一定在跑」 |

## 2. 修改方案（审批后执行）

1. r2 在 r1 上按上表逐条改，文首加「r2 相对 r1 的改动」与「计划双审第 1 轮」两段，文末加意见落点附录。
2. 计划层面的增量只有两处实现面：`util/exec.ts` `spawnDetached` 加可选回调（CODEX-03）；验收加 A8 回滚演练（CODEX-04）。其余是论证、注释清单与用例构造的改准。
3. 决策 D1～D7 不变。
4. r2 定稿后先提交计划、再实施（按惯例）。
