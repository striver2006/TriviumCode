---
schema: trivium.disposition.v1
topic: 留痕字段与误报小修
stage: plan
role: claude
kind: revised
run_id: 20260926T135731Z
addresses:
  - 2026-09-26-留痕字段与误报小修-codex.md
  - 2026-09-26-留痕字段与误报小修-gemini.md
  - 2026-09-26-留痕字段与误报小修-glm.md
---

# 裁决：留痕字段与误报小修 · 计划双审第 1 轮

> 被审对象：`2026-09-26-留痕字段与误报小修-claude.md`（r1）
> ｜ 运行：`20260926T135731Z`（14m40s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 14 条：次要 6 ｜ 吹毛求疵 8 ｜ 零阻断
> ｜ **14 条全部接受**。同指四组：
>   - CODEX-01 ≡ GLM-01：归档侧收尾排在 `patchStatus` 之后，中断即不可恢复；
>   - CODEX-02 ≡ AGY-01 ≡ GLM-02：新步骤抛异常会把锁与闸门回收挡在身后；
>   - CODEX-03 ≡ AGY-02 ≡ GLM-05：E3 的形态含糊，`cancelRun` 传 `goneNow.gone` 这条接线没人守；
>   - CODEX-04 ≡ AGY-03：task.json 里找不到对应 run_id 时的行为未规定。

## 0. 本轮的形状

焦点五项三侧都核过：
- **② EV-127 实测**：codex 与 glm 各自用独立脚本复算，§2.1 四行读数、56 条差异、差异中指向入仓文件 0 条、`./` 真信号 1 条，逐格吻合。三侧都推演了前界：反引号、全角标点、行首成立，中段截断全部堵死。
- **① 与提交锚、EV-133 的相容性**：三侧都认为论证成立。HEAD 为 running 时只查 `run_id` 与已登记条目，HEAD 已终态时一律拦；「取消是唯一一次终态写入」这条论证本身站得住。
- **③ EV-137**：`report.ts` :258 是唯一读点；F5 三道的覆盖面描述准确。
- **⑤ 行号**：三侧抽查全部命中。glm 指出 §3.2 引的 `run-protocol.ts` :360-362 实际是 :360（交接文件）与 :371（status.json），r2 顺手改正。

问题集中在 EV-128 新步骤的**位置与失败语义**。这一处我在 r1 只想了 worker 侧的交错，没想编排器自己在两次写之间倒下：
1. **顺序**：排在 `patchStatus` 之后，`--cancel` 进程若死在两次写之间，status.json 已是终态，第二次 `--cancel` 在 :804 早退，run.json 永远停在 running——正是本主题要消灭的形态。r1 的 EV-133 论证里写了「第二次 `--cancel` 走 :804 的终态分支」，我却没把它和插入位置连起来看。
2. **异常**：r1 只规定「前提不满足即跳过」，没规定写侧抛错怎么办；按插入位置，异常会跳过锁与闸门回收。
3. **验证**：E3 自相矛盾，接线没人守；三条变异的期望写了两个套件，而装置的 `expect` 只收单值（`mutation-check.mjs` :356，已核）。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：`cancelRun` 在 :804 对 status.json 已终态的运行早退，r1 把归档侧收尾放在 :854 `patchStatus` 之后，`--cancel` 进程死在两者之间就再也走不到收尾，且没有任何输出。挪到 `patchStatus` 之前后，中断时 status.json 仍非终态，第二次 `--cancel` 重走全流程，被前提 4 幂等挡住，最终一致 | r2 §3.2：`cancelRun` 顺序改为 杀进程 → `goneNow` 复核 → 抹凭据副本 → **归档侧收尾** → `patchStatus` → 回收锁与闸门；§3.2 写明两种中断点各自的恢复路径；§3.2 EV-133 论证段改写，把「第二次 `--cancel`」与插入位置连起来 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-01。另指出同族残差：新函数内部 run.json 与 task.json 两次写之间中断，会留下 run.json 为 cancelled、task.json 为 running；`checkRunManifests` 只核存在与可读，不比 status，不会拦。已核属实 | 同 CODEX-01；另 r2 §3.2 把 task.json 同步改为**独立判据**：run.json 最终为 `cancelled`（不论是本次写的还是上次已写的）且 task.json 对应条目为 `running` 时才改。于是两写之间中断后，第二次 `--cancel`（status.json 仍非终态）会把 task.json 补齐。R5 补一格「run.json 已是 cancelled、task.json 仍 running」 |
| CODEX-02 | codex | minor | 接受 | 属实：`writeRunMeta` 写前校验不合契约直接抛（`meta.ts` :377-380），`writeAtomic` 与 `updateTask` 有真实的 IO 失败形态。按 r1 的位置，任一抛错都会跳过 :864 起的锁与闸门回收，把唯一的恢复路径变成新的卡死入口 | r2 §3.2：`finalizeCancelledRunMeta` **自身不抛**，内部捕获全部异常，转成 `{ kind: 'skipped', why }` 并 `warn` 一行，风格与 `scrubRunDir` 的 `.catch` 同形。只设这一道：调用侧不再另包一层，免得变异撞上冗余通道。§4.1 加 R7（写失败注入：阶段目录只读 ⇒ 返回 skipped、不抛）；§4.2 加 E6（同一构造经 `cancelRun` ⇒ 退 0、锁与闸门已回收、输出含原因） |
| AGY-01 | gemini | minor | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| GLM-02 | glm | minor | 接受 | 同 CODEX-02；另点名 R4 只覆盖读侧失败 | 同 CODEX-02；R7 即写侧失败格 |
| CODEX-03 | codex | minor | 接受 | 属实：用例给不了 `cancelRun` 传参，r1 的 E3 实际只能退化成单测；「`cancelRun` 传的是 `goneNow.gone`」这条接线在全部用例与变异里都没人守，改成硬传 true 全绿。已核 `workerConfirmedGone`（`status.ts` :155-178）：status.json 存在、phase 非终态且拿不到 worker_pid 时确定性返回 `gone: false`，集成里可构造 | r2 §4.2 E3 改为经 `cancelRun` 的真实集成：布置 status.json 为 `running`、无 `worker_pid`、无 `worker.pid` 文件 ⇒ run.json 逐字节不变、输出含跳过原因；§4.1 加 R6（直调新函数 `workerGone: false` ⇒ skipped）；§4.3 M4 拆为 M4a（`cancelRun` 硬传 true，期望 E3 所在套件）与 M4b（新函数忽略 `workerGone`，期望 R6 所在套件） |
| AGY-02 | gemini | nit | 接受 | 同 CODEX-03，给出了同一种夹具构造法 | 同 CODEX-03 |
| GLM-05 | glm | nit | 接受 | 同 CODEX-03 | 同 CODEX-03 |
| CODEX-04 | codex | nit | 接受 | 属实：`prepareRun` 先写 run.json（`review.ts` :949）、后 `registerRun`（:951），中间被打断即留下「有 run.json、task.json 无条目」。r1 只描述了命中态，实施者可能写成补登记或取末条 | r2 §3.2：按 run_id 精确匹配，找不到即跳过同步，并在返回的 `why` 与播报里说明；不新建条目、不动其它条目。R5 补一格「无对应条目」 |
| AGY-03 | gemini | nit | 接受 | 同 CODEX-04 | 同 CODEX-04 |
| CODEX-05 | codex | nit | 接受 | 已用脚本复核：180 份 run.json 里 6 份属 verify 阶段，没有 guard 段；计划写作时点带 guard 段的是 174 份，全为 false（本轮新增一份后为 175）。结论不变，但口径不写清，验收复算时会对不上 | r2 §1.2 C10 注明「180 份含 verify 阶段 6 份」；§1.3 F6 改为「带 guard 段的 174 份全为 false，verify 阶段 6 份无此字段」；普查脚本同口径输出这两个数 |
| CODEX-06 | codex | nit | 接受 | 属实：`cli.ts` :241 USAGE 写「取消运行并回收主题锁」，行为变更后不再完备；PROTOCOL 同一句进了同步表，USAGE 漏列 | r2 §5 加一行：`cli.ts` USAGE 的 `--cancel` 那一格改为同时说明把仍在跑的归档 run.json 标为 cancelled；反扫词表加「回收主题锁」 |
| GLM-03 | glm | nit | 接受 | 属实：主题锁的 `runTerminal`（`run-protocol.ts` :299-304、`review.ts` :1697-1703）判据是 `status !== 'running'`，取消轮回写后由 false 翻为 true。这是唯一翻转结果的读者，方向良性（残留锁更快可回收），但 r1 §6.2 写「与改前相同」，读者会以为全部不变 | r2 §1.2 C7 与 §6.2 点名 `runTerminal` 对取消轮由「未终态」翻为「终态」，并写明有意：取消轮不会再有写者，锁可回收是正确结论 |
| GLM-04 | glm | nit | 接受 | 已核：`mutation-check.mjs` :356 是 `c.expect ? [c.expect] : spec.suites`，`expect` 只收单个套件。r1 的 M5 / M7 / M8 各写了两个 | r2 §4.3 每条变异只写一个期望套件，并给出新单测文件名：M5 → R2、M7 → R1、M8 → R5，都在新单测文件里；集成用例只作补充保障，不列为期望 |

## 2. 不改的部分

- D1～D5 三侧都认同，不变：D1 全词匹配；D2 (a) 回写与四个子项；D3 ②；D4 合并；D5 两条新登、一条并进 EV-73。
- EV-127、EV-137 的改法不变，只按 CODEX-05 修正口径、按 CODEX-06 补 USAGE。
- 四个写入前提不变，只改插入位置与失败出口。
- 仍保留的边界，r2 §6.2 照写：未确认退出时 run.json 不写，而 `patchStatus` 照旧把 status.json 改成 cancelled。之后第二次 `--cancel` 在 :804 早退，这份 run.json 会一直留在 running，输出会说明原因。这与改前相同，本主题不改 :804 的早退语义。
- 无驳回、无暂缓。

## 3. 下一步

审批通过后，按本件落点写 r2 定稿（`2026-09-26-留痕字段与误报小修-r2-claude.md`），照惯例先提交计划再实施。
