---
schema: trivium.disposition.v1
topic: 闸门拦截不留骨架
stage: code
role: claude
kind: response
run_id: 20260927T035514Z
addresses:
  - 2026-09-27-闸门拦截不留骨架-codex.md
  - 2026-09-27-闸门拦截不留骨架-gemini.md
  - 2026-09-27-闸门拦截不留骨架-glm.md
---

# 应答：闸门拦截不留骨架 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260927T035514Z.diff`（相对 HEAD `6868ff99` 的 26 个文件变更，209.2 KB）
> ｜ 运行：`20260927T035514Z`（15m32s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 8 条：次要 3 ｜ 吹毛求疵 5 ｜ 零阻断、零重要
> ｜ **8 条全部接受**。没有两侧同指的一组；三侧对焦点五项的「认为正确」结论一致（重排为纯移动、回收同义、用例与变异可区分、文档与代码一致）。

## 0. 本轮的形状

意见分三类：一处契约窄缝与一处注释失实（CODEX-01、GLM-01，都在 `prepareRun`）；一处重复实现（CODEX-05）；其余五条落在留痕面——BACKLOG 的漏项、残句、行号（CODEX-02 / 03 / 04、GLM-02）与验收脚本的基线写死（AGY-01）。核对结果：CODEX-03 的 catch 行确为 :429；GLM-02 指出的 :152 是我误把编译产物 `dist/test/…/lock-cross-process.test.js:152` 的行号当成源码行号，源码在 :216；CODEX-04 的纯文档跳过分支确实只有 `finally`、没有 `catch`。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 成立：置闸门的 `setGateChecked` 在 `try` 之外，比较-交换已写盘而 `withGlobalLock` 的 `finally` 放锁抛错时，闸门带本轮 runId 停在 running，文档块「抛错 ⇒ 闸门不归本轮」的全称承诺不成立。窗口极窄、不是回归，但取建议的第一种：把整个 `if (holdsGate) { 比较-交换 + 被拦 throw }` 并入 `try`。被拦的 `GATE_BLOCK` 进 `catch` 后，`releaseRunningGateEntry` 的 `expect: { state: ['running'], runId: 本轮 }` 对别的 run 的待裁决槽位是空操作，报错原样抛出，行为不变 | `src/trivium/review.ts` `prepareRun`：`try` 起点前移到比较-交换之前，`holdsGate` 声明留在 `try` 之外；文档块与段注释同步；变异规格重生成（M1 / M2 / M7 锚点随之变），装置重跑 |
| CODEX-02 | codex | nit | 接受 | 成立：EV-145 余项叙述里残留「①最容易发生，正解多半是『先查闸门再写骨架』，与事后收尾是两种修法」，而那一格正是按这句修完的 | `doc/08_project/BACKLOG.md` EV-145 行：该句改为历史注记「①的被拦一格已按『先置闸门再落盘』修毕（EV-109）」 |
| CODEX-03 | codex | nit | 接受 | 已核：`} catch (e) {` 在 `run-protocol.ts` :429，:430 是 catch 体第一行注释（我取锚点时用了注释行） | EV-145 行 ② 改为「`startRun` 主 `try` 的 `catch`（:429）」；按 CODEX-01 改完代码后再核一遍行号 |
| CODEX-04 | codex | minor | 接受 | 成立：`startRun` 的纯文档跳过分支 `try { executeRun(rc) } finally { lock.release() }` 没有 `catch`，`executeRun` 在这里抛时骨架与登记已落盘，run.json 停在 running；这条不经 :429 的 catch，也不在 EV-145 ①～④ 与 LLD 4.2 引述块的列举里。闸门这一侧没问题（跳过轮不置闸门） | EV-145 行 ② 补一句「另含纯文档跳过分支里 `executeRun` 抛错（`run-protocol.ts` 跳过分支只有 `finally`，骨架已写）」；LLD 4.2 引述块的列举同步补上 |
| CODEX-05 | codex | nit | 接受 | 成立：`runReviewLocked` 的内联回收与 `releaseRunningGateEntry` 逐字段同形，同一语义两份。取建议的第二种：计划 r2 §3.2 明定此处不动（它回收的是 `executeRun` 之后的失败，且改调会改掉 `hooks.ts` :298 注释「`review.ts` 的四处 `setGateChecked`」的计数），所以只加互指注释，不改调用 | `src/trivium/review.ts` `runReviewLocked` 的 `catch`：加一行「与 `state.ts` `releaseRunningGateEntry` 同形，改一处须改两处」；`state.ts` 该函数文档块补一句指回这里 |
| AGY-01 | gemini | minor | 接受 | 成立：A6 用 `git archive HEAD` 建旧构建，本主题提交之后 HEAD 就是改后代码，重跑会静默退化为自比 | `doc/05_testing/evidence/gate-block-no-skeleton-20260927/acceptance.mjs`：基线改为 `process.env.ACCEPT_BASE_REF ?? '1ee28b0'`（计划 r2 提交，源码与 `bcb454e` 相同），读数里记下所用基线；脚本头注释写明；修改后重跑验收 |
| GLM-01 | glm | nit | 接受 | 成立：`prepareRun` 文档块「被拦时一个文件都不写」与段注释「到这里为止一个文件都没写」字面失实——判负的比较-交换也会整文件重写 state.json（刷新 `updated_at`，闸门项不变），置闸门成功时更已写过；这正是 r1 三侧同指、r2 退回过的那个坑，代码注释不该留着字面版本 | `src/trivium/review.ts` :531 文档块与 :911 段注释：收窄为「不写任何审查工件与留痕（brief、补丁与便利副本、run.json、task.json 登记、运行目录）」，补半句「闸门状态文件在判负时也会刷新 `updated_at`，闸门项不变」 |
| GLM-02 | glm | nit | 接受 | 已核：该用例源码从 `lock-cross-process.test.ts` :216 开始；:152 是编译产物里的行号 | `doc/08_project/BACKLOG.md` EV-149 落点列与实施报告 §3.3 的「:152 起」改为「:216 起」 |

## 2. 修改方案（审批后执行）

1. **代码**（`review.ts`）：CODEX-01 把置闸门并入 `try`；GLM-01 两处注释收窄；CODEX-05 互指注释（`state.ts` 同步一句）。
2. **留痕**：BACKLOG EV-145（CODEX-02 / 03 / 04）、EV-149（GLM-02）；LLD 4.2 引述块（CODEX-04）；实施报告 §3.3 行号（GLM-02）与新增「代码双审 r1 与修订」一节。
3. **证据**：`acceptance.mjs` 基线可配（AGY-01）；变异规格按新代码重生成、装置重跑；验收重跑。
4. **读数**：修订后全量 `npm run check`、`doctor --selftest`；读数写进报告。
5. 不改：决策 D1～D5、`runReviewLocked` 的调用方式（只加注释）、`hooks.ts` :298 的计数注释。
