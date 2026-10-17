# M12 批次 3：作废侧在同一次运行内重跑一次（EV-225）

- **日期**：2026-10-17
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`M12-作废侧重跑一次`，命令 A（`/dual-run`，用户发起），A 档
- **上位**：[`doc/08_project/M11后续-开发计划-草案.md`](../08_project/M11后续-开发计划-草案.md) §3；主题计划定稿 `.reviews/M12-作废侧重跑一次/plan/` r2；用户 D-7 五个子项全按推荐，加 1 轮真实回归
- **厂商配额**：本主题双审（每轮 gemini、glm 各 1 次，另预检认证探活各 1 次）+ 真实回归 1 轮（见 §6）

## 1. 审查经过

| 阶段 | run | 结论 | 处置 |
| :--- | :--- | :--- | :--- |
| 计划双审 | `20261017T133619Z`（20m34s） | gemini `approve-with-nits`（3 nit）、glm `approve-with-nits`（2 minor、2 nit） | 7 条全部接受，合入 r2：挪动前先建父目录（AGY-01）、重跑后的终态事件显式清 note（AGY-02）、挪动逻辑留在 `review.ts` 只经常量拼接（AGY-03）、协议文档同步（GLM-01）、显式声明对 D-7「点名路径或命令」的落点收紧并改为点名程序名（GLM-02）、改名失败时整删兜底（GLM-03）、`attempts` 条目分层记法（GLM-04） |
| 代码双审 | `20261017T152647Z`（13m3s） | gemini `approve`、零意见；glm `approve-with-nits`（2 minor） | 2 条全部接受：计划 r2 §4.3 承诺的闸门层用例补交（GLM-01）；重跑那次适配器抛异常时逐次记录与点名段经错误对象带回、rejected 分支交回（GLM-02） |
| verify | `20261017T161613Z` | typecheck、build、`npm test` 全通过（334s） | verify 前 `npm run install:local`，安装副本 `trivium.cjs` 与仓库构建 sha256 一致（前缀 `5ba68728`）；提交后需从已提交状态重建，再请用户重装 |

预检与计划双审都有一条告警：「Driver 模型未声明，模型族比较为 unknown」——本会话未声明 Driver 模型，不影响结论。

**与上位文字不一致的三处**（计划 r2 §0；第 2 条用户 2026-10-18 确认维持现状——点名段只写程序名加位置、不回显命令参数，完整命令只留在 run.json 的 `attempts` 供人复盘）：①上位写「run.v2 原地扩 attempts」，现行写形是 `run.v3`，扩在 v3 的逐侧节点上；②D-7「点名上一次命中的具体路径或命令」，命令通道只点程序名与位置、不回显命令参数——泄漏之后该侧敲的命令可能夹带对端原文；③任务目标里的 `--allow-partial` 即 CLI 的 `--allow-single`。

## 2. 改动

**触发与重拉**（`runner.ts`、`guard.ts`）：

- `guard.ts` 新增 `makeSideLeakJudge`（直接调 `judgeSide`，`review` 传 null）与内部 `sideJudgeOptions`（`judgeRun` 与它共用一份入参装配）。单侧判定的 `voided` 即 `peerArtifactRead`，即 `leakRecordVoids`——重跑判据、终判、闸门三处同一个谓词。
- `runner.ts` 的 `runOneSide`：结果为 ok 时立刻判；作废类命中且本侧未重跑过 ⇒ 挪走输出、任务书最前面插点名段、`continue` 重拉（`timeout_s` 不变，适配器每次重新计时）；二次命中 ⇒ 侧级 `failed`、`fail_reason` 以 `peer_leak` 起头，不进瞬时重试。瞬时重试改独立计数 `transientUsed`（无重跑时与原判据逐值等价，额度整侧共用）。判定器抛异常按未判出作废收口。发生过重跑的一侧收口时显式清 note。
- `RunnerOutput` 加 `attemptLog`（只有重跑过的侧有键）与 `rerunBanners`。

**点名段**（`brief.ts`）：`renderVoidRerunBanner` 与段首标题常量 `VOID_RERUN_BANNER_HEADING`。只列作废类命中；命令通道只点程序名（首个词末段、`[A-Za-z0-9._-]{1,32}`）；位置收敛到罩住命中的禁读条目（项目内）或运行目录第三段那一层（运行根下）；`redactSecrets` 后截 200 字符；至多 10 条。

**首次输出**（`review.ts`、`run-files.ts`、`scrub.ts`）：`stashVoidedOutput` 把 `<运行目录>/<侧>/out` 挪到 `<运行目录>/voided/<侧>/attempt-<n>/`（`VOIDED_ATTEMPTS_DIR`，不进运行目录层文件清单）；改名失败经 `tryRemoveTempDir` 整删兜底，删也失败告警。挪到这里第三段不是侧名，对端与重跑侧自己读到都判对端运行输出。`scrubRunDir` 另扫 `voided/` 下的日志。

**留痕与收尾**（`review.ts`、`types.ts`、`run.v3.json`、`report.ts`、`meta.ts`）：逐侧 `attempts`（只在重跑过的侧写，`minItems: 2`，条目 `additionalProperties: false`）；`_meta/brief-<侧>-<run>.rerun.md` 进保护集；本轮 warnings 加「首次读到对端产物已作废重跑」「重跑后仍读到判失败」与终判一致性自检；report 旗标与运行摘要加「作废重跑」。闸门代码不改——它读的 `guard.peer_leak_via_*` 本来就只写最终尝试。

**等待**（`status.ts`、`run-protocol.ts`、skill）：`SideStatus.void_rerun`（只置不清）；`budgetForStatus` 任一侧重跑过即 `max_waits` 加 `ceil(单侧超时 / 窗口)`；`--wait` 两个出口与 `--status` 按刚读到的 status 现算；进度摘要标「（作废重跑）」；skill 循环上限改读最近一次 `--wait` 的 `max_waits`（重新渲染四载体入口）。

**桩**（`adapters/stub.ts`）：`StubSpec.rerun`（任务书以点名段标题开头时改用它，顺带核了点名段确实置顶送达）；泄漏形态在 `out/` 留 `result.json` 标记；`run_material_leak` 新增 `note: 'voided'`。

## 3. 用例

- `test/integration/fault-injection.test.ts`：AC-25 三审 8 格与两侧分档作废类 3 格按新行为改断言（注入加 `rerun: ok`，命中明细改读 `attempts[0]`，终判、共同阻断有效侧由 2 / 1 家变为 3 家）；新增 EV-225 组 6 格：R1 首次命中重跑干净（`attempts` 两条、首次输出在 `voided/`、不进归档、点名段原文进 `_meta/`、终态 note 已清、另一侧只跑一次）、R2 二次命中 strict 退 75、R3 二次命中 `--allow-single` 降级、R4/R5 告警级与己方材料四种形态都不触发、R6 重跑侧读自己上一次的输出判二次命中、R8 `--wait --json` 的 `max_waits` 追加一份。计划 r2 的 R7（另一侧不受影响）并进 R1 的断言与单测，没有单列带延迟的集成格。
- `test/unit/void-rerun.test.ts` 17 格：runner 七格（无钩子逐值等价、重拉与点名段置顶、二次命中、重跑后瞬时重试、重跑那次适配器抛异常仍交回逐次记录与点名段〔代码双审 GLM-02 后补〕、判定器异常、另一侧调用与进度事件不变）、单侧判定与 `judgeSide` / `leakRecordVoids` 同结论七种形态、`VOIDED_ATTEMPTS_DIR` 分类、`stashVoidedOutput` 两格、点名段两格、预算、schema 两格、会话启动清扫。
- `test/unit/gate.test.ts` 作废侧一组补第 ⑧ 处断言（代码双审 GLM-01 后补，计划 r2 §4.3 承诺的闸门直测，首版漏交）：一侧 `attempts[0]` 作废、最终 `guard` 干净 ⇒ 不进 `voidedSides`；另一侧最终 `guard` 作废、无 `attempts` ⇒ 照旧排出。
- 护栏同步：`run-files-parity` 的写模块清单加 `review.ts`（它在运行目录那一层建 `voided/`）。

## 4. 变异

[`evidence/m12-batch3-mutation-20261017/`](./evidence/m12-batch3-mutation-20261017/)。正式装置 `scripts/mutation-check.mjs` 首版两份规格 **16/16 咬住**（单测类 11 条、集成类 5 条，基线全绿、源文件逐字节恢复）：触发改成任何命中、去掉至多 1 次、二次命中不判失败、首次输出留在侧子树、预算不追加、点名段回显命令全文、瞬时计数退回 `attempts`、重跑后不清 note、点名段放末尾、单侧判定改按「扫到了东西」、运行根命中点到文件；集成类：任何命中都重跑、`--wait` 只算一次预算、worker 不写 `void_rerun`、run.json 不写 `attempts`、点名段不落 `_meta`。逐条预跑时单测规格的 M1（期望集成套件）读数为 0——预跑脚本用 `--tests-only` 不重打 bundle，已知假阴性（坑清单），同一变异在集成规格里作 B1 咬住、正式装置里 M1 也咬住。代码双审改完后另跑 `mutation-spec-code-r1.json` 两条：重抛时不带逐次记录（C1）、闸门改读 `attempts`（C2），均咬住——合计 **18/18**。

## 5. 文档同步

- 主设计 v1.3.164：10.1.1 新增「作废侧在同一次运行内重跑一次」；12.1 基线行与演进增补行改写、「有效侧不足」行去掉「EV-225 就绪前」措辞；12.3 同步；6.7.1 记 run.v3 逐侧 `attempts`；16.1 M12 行记批次 3。
- PRD v1.4.29：AC-25 Then 与达成边界 ③ 改写。
- 协议文档：泄漏留痕段改指当前写形 run.v3、补 `attempts` 与 `void_rerun`；`--wait` 循环上限改读最近一次的 `max_waits`。
- BACKLOG：EV-225 结案。

## 6. 真实回归

用户定：临时夹具里跑带模型调用的 `doctor --only` 准备探针。夹具建在会话 scratchpad（一个 JS 文件的小 git 项目），用本仓新 bundle 直接 `init`（`--asset-root` 指向本仓），`doctor --only agy`、`doctor --only zcode` 两段都「未发现阻断级问题」；再写一份小计划原稿，入选 gemini、glm 跑一轮 plan 审查 `--start` / `--wait`。被测构建 `inputs_sha256 8622d796…`、构建于 15:44——代码双审修改之后的最终代码（run.json `snapshot.build` 核对）。

| 判据 | 读数 |
| :--- | :--- |
| 运行终态 | run `20261017T155301Z`：`success`、`review_mode: full`，4m50s |
| 不泄漏 | 两侧路径通道、命令通道都 `hit: false`，`peer_artifact_read: false` |
| 不触发重跑 | 两侧 run.json 都没有 `attempts`；status.json 两侧 `attempt: 1`、无 `void_rerun`；运行目录无 `voided/`；归档无 `.rerun.md` |
| 等待预算不变 | `--start` 与每次 `--wait` 的 `max_waits` 均为 12 |
| 归档形状 | 两份 brief、两份结构化结论、glm 的回退编号件、两份审查件与原稿，与改动前同构 |

**与本批无关的一处**：glm 输出 JSON 语法错误（`json_syntax`），落解析回退，于是该轮共同阻断记「有效侧不足」（`skipped-insufficient-sides` / 1）。解析路径本批未动，是模型输出层面的既有现象。

配额：doctor 两段的带模型调用（次数未逐条计）+ 审查 2 次 + 预检认证探活。读数摘要 [`evidence/m12-batch3-regress-20261017/`](./evidence/m12-batch3-regress-20261017/)；夹具在会话临时目录，不进仓库。

## 7. 全量检查

代码双审前：tests 3673 / pass 3671 / fail 0 / skipped 2，退出码 0。首轮全量（改用例之后、补护栏之前）红 4 格，都是本批引出的：渲染产物未重出、桩对只给部分字段的请求取 `brief_text.startsWith`、`run-files-parity` 写模块清单未登记 `review.ts`、递归删除豁免表多一处（改用 `tryRemoveTempDir`），修后全绿。

代码双审修改后：tests 3674 / pass 3672 / fail 0 / skipped 2。收口文档改完后串行三次：第一次红 2 格、第二与第三次全绿（均 3674 / 3672 / 0 / 2，退出码 0）。红的两格单跑各 3 次全过，都不在本批改动的文件里，按偶发记录：

- `gate-loop`「旧轮未裁决就重跑 → 拒绝启动」：运行跨过零点，审查文档按 10-17 命名、用例按当天日期写的裁决件是 10-18，`addresses` 对不上（日期边界，未登记）；
- `temp-index-cleanup` G3b：负载下超时落在 `read-tree` 而非预期的 `add`（计时类，未登记）。
