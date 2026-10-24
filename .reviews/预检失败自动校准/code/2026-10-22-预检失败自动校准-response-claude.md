---
schema: trivium.disposition.v1
topic: 预检失败自动校准
stage: code
role: claude
kind: response
run_id: 20261022T131835Z
addresses:
  - 2026-10-22-预检失败自动校准-codex.md
  - 2026-10-22-预检失败自动校准-gemini.md
  - 2026-10-22-预检失败自动校准-glm.md
---

# 应答：预检失败自动校准 · 代码三审第 1 轮

> 被审对象：相对 HEAD `18e6ca38` 的未提交改动（补丁 `_meta/changes-20261022T131835Z.diff`）。
> 评审循环第 1/3 轮：codex `reject`（3 major、1 minor），gemini `pass`（2 nit），glm `pass-after-changes`（3 minor、2 nit）。计票 1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过。
> 11 条全部接受，按下表直接改码。
> 补丁里 `doc/01_requirements/原始需求.txt` 的改动是用户自己的未提交改动，不属于本主题，本主题提交时排除（同 EV-250 的处置）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 成立：组长句柄已退出后只凭同号组的非僵尸成员数发信号，旧组清空、组号被新组复用时会结束无关进程。进程表里此刻有 pid 等于该组号的进程，而我们的组长已退出，那个进程只能是复用者 | `exec.ts`：成员计数改为一次 `ps -axo pid=,pgid=,stat=` 同时取「成员数」与「是否有 pid 等于组号的活进程」；组长已退出而后者为真 ⇒ 判复用、不发信号、列进 `remaining` 并在 doctor 输出说明；成员查询并行。U1d 用注入的快照覆盖「旧组结束、同号新组出现」。无组长的复用组（复用者也已退出、只剩它的后代）仍分不出，与 `--cancel` 的 EV-165 同一残余，登记 BACKLOG EV-251 |
| CODEX-02 | codex | major | 接受 | 成立：兜底出口在环境段、构建标识、命令候选扫描都完成之后才就绪，它们挂住时到点也返回不了；它们的子进程也不在段作用域里 | `doctor.ts`：收尾函数与控制器在第一个 await 之前交出；环境段也包进段作用域（不进 `deadline.sections`，到点时环境段的结论不落盘、它产出的 blockers 撤回，`residue` 记一句）。新增 I10：注入挂住的环境探测，到点按时出结果 |
| CODEX-03 | codex | major | 接受 | 成立：兜底计时器等按组结束（又等在写的 checkpoint）完成才起算，成员查询串行；正常收尾在停掉控制器之后还要等落盘与删目录，都不受时限约束 | `doctor-deadline.ts`：到点即起兜底计时器（不再等按组结束）；等在写的 checkpoint 改为限时；`doctor.ts` 收尾的每一步（等按组结束、末次 checkpoint、台账收尾）按「到点时刻 + 兜底时长」的剩余预算限时，超时如实写进 `residue` 并保留台账。未到点时收尾先限在总时限内，再停控制器。新增 U6（`track` 一个永不兑现的 checkpoint，兜底仍按时兑现） |
| CODEX-04 | codex | minor | 接受 | 成立，与 GLM-03 同：补删只在带时限时执行，而文档写的是「下一次 doctor」，用户照 `rerun`（不带时限）在终端跑时不会补删 | 台账目录与时限解耦：`DoctorOptions.ledgerDir` 单列，`cli.ts` 每次 doctor 都传；补删每次启动都做，不带时限时残留进 `warnings`。新增 I11（遗留台账，普通 doctor 补删） |
| AGY-01 | gemini | nit | 接受 | 回退分支的路径形态与 `path.dirname` 的结果不保证同形，判错就把合法目录记成不敢删 | `realTmpRoot` 回退改 `path.resolve(os.tmpdir())` |
| AGY-02 | gemini | nit | 接受 | 与 GLM-05 同：没开始的段（派生 0 次）也说「配额已花」，自相矛盾 | `unfinishedSectionNote`：派生 0 次时改说「本段没有开始，没有花配额」 |
| GLM-01 | glm | minor | 接受 | 成立：段次序常量与 runDoctor 的段次序、注册表都没有对账，新增一家时 `deadline.sections` 会静默漏掉它 | 保留常量（它是执行次序，与 `ALL_CLI_NAMES` 的登记次序不同），加对账用例 U3″：源码里各段出现的次序等于常量、常量的集合等于 `ALL_CLI_NAMES` |
| GLM-02 | glm | minor | 接受 | 成立：`trivium` 不在 PATH 上，`rerun` 照抄会 command not found | `doctorRerunCommand` 前缀改 `.trivium/bin/trivium`（与手册终端命令同形）；预检人读输出的提示行同改；用例与文档中的样例同步 |
| GLM-03 | glm | minor | 接受 | 同 CODEX-04 | 同 CODEX-04 |
| GLM-04 | glm | nit | 接受 | 成立：带覆盖旗标的调用只断言了形状，没有经打包 CLI 照抄执行，旗标拼写与判键不一致时测不出 | 新增集成 I12：codex 入选、探针过期，把预检给出的带 `--profile-codex` / `--model-codex` 的 `args` 照抄给打包 CLI，断言不退 64 |
| GLM-05 | glm | nit | 接受 | 同 AGY-02 | 同 AGY-02 |
