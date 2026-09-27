---
schema: trivium.disposition.v1
topic: 闸门拦截不留骨架
stage: plan
role: claude
kind: revised
run_id: 20260927T015234Z
addresses:
  - 2026-09-27-闸门拦截不留骨架-codex.md
  - 2026-09-27-闸门拦截不留骨架-gemini.md
  - 2026-09-27-闸门拦截不留骨架-glm.md
---

# 裁决：闸门拦截不留骨架 · 计划双审第 1 轮

> 被审对象：`2026-09-27-闸门拦截不留骨架-claude.md`（r1）
> ｜ 运行：`20260927T015234Z`（14m52s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 10 条：次要 5 ｜ 吹毛求疵 5 ｜ 零阻断、零重要
> ｜ **10 条全部接受**。同指三组：
>   - CODEX-01 ≡ AGY-01 ≡ GLM-01：B1 / B4 / A1 断言「state.json 逐字节不变」做不到——比较-交换判负时 `updateState` 仍刷新 `updated_at` 并整文件重写（`state.ts` :146-151，已核）。
>   - AGY-02 ≡ GLM-02：§3.1 草图把 `resetStopBlockCount` 放在 `try` 之外，置 running 之后它若抛错，闸门不经回收。
>   - CODEX-02 ≡ AGY-03 ≡ GLM-04：`releaseRunningGate` 的调用点是三处（`run-protocol.ts` :429、:585、:733），不是四个。

## 0. 本轮的形状

焦点五项三侧都核过，结论一致的部分：D1 ①b 的方向与唯一判定点、§3.4 已列各格、§7 否决 ①a / ② / ③ 的理由、D2 (a) 的代价、「`prepareRun` 抛错 ⇒ 闸门不归本轮」对 `startRun` 与同步路径都成立、§2.2 误判改后消失、留痕兼容、EV-109 / EV-145 处置、§2.3 / §2.4 两条新登、§1 / §2 / §5 抽核的行号与引文。意见全部落在断言粒度、草图里的一处缝隙与叙述精度上，决策 D1～D5 不变。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 已核 `state.ts` :146-151：`mutate` 判负提前返回，`updated_at` 照刷、整文件照写，被拦那次 state.json 字节必变；§2.1 G1 的实测口径本来就是「闸门项逐字段不变」，B1 / A1 写成字节级是我把口径抬高了。取建议 ①，不把「无变更跳过写盘」拉进本主题（核心函数、全部调用方） | r2 §4.2 B1 / B4、§4.4 A1：state.json 改为「`gates` 键集合不变且该闸门项逐字段深相等」，task.json 仍逐字节；§2.1 G1 行措辞不变 |
| CODEX-02 | codex | nit | 接受 | 已核：三处调用（:429 `startRun` 主 `catch`、:585 worker `finally`、:733 `--wait` 失联），第四处印象来自 `review.ts` :1725 的内联回收，它不调这个函数 | r2 §3.2 第 2 条「四个调用点」改为「三处调用点」，并点明 `runReviewLocked` 的内联回收不在其列 |
| CODEX-03 | codex | nit | 接受 | 成立：登记失败后、成功重跑前，`latestRunMeta`（不看 `status`）取到那份 `running` 骨架，不带 `--run-id` 的 gate 子命令会指向它。比 §2.2 轻（旧轮已裁决或作废、没有待校验的轮次被顶掉；文案有 `--run-id` 兜底；重跑同号即成为最新留痕），但 D3 (a) 的论证没点出这一格 | r2 §3.5 补一段写明这个窗口与自愈条件；§6.2「如实保留」加一条；B5 追加一条读数断言：窗口期不带 `--run-id` 的 `gate --check --json` 的 `run_id` 为这份骨架（钉住现状，EV-145 余项落地时随之改） |
| AGY-01 | gemini | minor | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| AGY-02 | gemini | minor | 接受 | 成立：比较-交换写入成功后、进 `try` 之前，`resetStopBlockCount`（写 `.trivium` 下计数文件，动态 import）一抛，闸门停 running 到 TTL，与新契约「置闸门之后失败由 `prepareRun` 回收」不符 | r2 §3.1 草图：`resetStopBlockCount` 挪进 `try` 作首句（仍在写入成功之后、落盘之前，语义不变）；§6.1 对应一句改写；变异表加 M7「`resetStopBlockCount` 移回 `try` 之外」——无法稳定构造它抛错时，如实登记为不进装置、只在代码审核对 |
| AGY-03 | gemini | nit | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-01；另指出 B4 同款，一并改 | 同 CODEX-01 |
| GLM-02 | glm | minor | 接受 | 同 AGY-02；另指出今天同位失败同样卡 running、不是回归，但新契约宣称自我回收，例外必须消除或登记——取消除 | 同 AGY-02 |
| GLM-03 | glm | nit | 接受 | 成立：「逐格」只列了 S3 ②③、清扫与写锁 Hook，漏了同样不持主题锁的 approve、abandon、`review --cancel`、`--wait` 失联回收。它们各有守卫（approve 只接受 `awaiting_approval`；abandon 跳过 `running`；后两者带 `expect.runId` 且以运行目录存在为前提），与今天同暴露，只是缺这半句论证 | r2 §3.4 表加一行，逐个写明四个写者的守卫与出处（`cli.ts` :1589-1595、:1620-1622；`approval.ts` :206-217；`run-protocol.ts` :457-463） |
| GLM-04 | glm | nit | 接受 | 同 CODEX-02 | 同 CODEX-02 |

## 2. 不改的部分

- 决策 D1～D5 原样：三侧均认同 ①b、不加预查、回收沿用 `running → idle`、task.json 写失败只回收闸门、其余三格不顺带、BACKLOG 处置。
- `updateState` 的「无变更也写盘」不在本主题动（CODEX-01 建议 ② 的范围），也不新登：`updated_at` 本就是「最近一次经过全局锁」的时刻，没有读者依赖它等于「最近一次闸门变化」。

## 3. r2 的改动清单

1. §3.1 草图：`resetStopBlockCount` 挪进 `try` 首句；§6.1 相应一句。
2. §3.2：调用点「四个」改「三处」。
3. §3.4：补 approve / abandon / `--cancel` / `--wait` 失联一行。
4. §3.5、§6.2：补登记失败窗口期 gate 指向骨架的说明与自愈条件。
5. §4.2 B1 / B4、§4.4 A1：state.json 断言改为闸门项级；B5 加窗口期读数断言。
6. §4.3：加 M7（或如实登记为不进装置）。
7. 文首记本轮结论与审批结论；文末附意见落点表。
