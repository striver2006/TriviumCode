# M12 批次 1：审查期两处误判（EV-239 / EV-238）

- **日期**：2026-10-17
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`M12-审查期误判两则`，命令 A（`/dual-run`，用户发起），A 档
- **上位**：[`doc/08_project/M11后续-开发计划-草案.md`](../08_project/M11后续-开发计划-草案.md) §4；主题计划定稿 `.reviews/M12-审查期误判两则/plan/` r2
- **厂商配额**：只有本主题双审——计划双审 1 轮（gemini、glm）、代码双审 1 轮（gemini、glm），另预检认证探活各 1 次；验收零厂商调用

## 1. 审查经过

| 阶段 | run | 结论 | 处置 |
| :--- | :--- | :--- | :--- |
| 计划双审 | `20261017T042520Z`（18m58s） | gemini `request-changes`（2 major、1 nit）、glm `approve-with-nits`（3 minor、1 nit） | 7 条全部接受，合入 r2：超时档按有无应答证据分两层（AGY-01）、谓词分三层且守卫侧级判定改调同一函数（AGY-02）、去掉闸门里不再使用的导入（AGY-03）、未识别原话的未登录按形态落档（GLM-01）、超时档触发恢复 `printTimeoutWarned`（GLM-02）、ok 现状角落如实写（GLM-03）、旧用例注释改准（GLM-04） |
| 代码双审 | `20261017T051253Z`（7m35s） | 两侧 `approve`、零意见 | 无代码改动 |
| verify | `20261017T052154Z` | typecheck、build、`npm test` 全通过（309s） | — |

预检与两轮运行都有一条告警：「Driver 模型未声明，模型族比较为 unknown」——本会话未声明 Driver 模型，不影响结论。

## 2. EV-239：作废判定只有一个谓词

**根因**：作废判定有三个派生点，守卫侧级判定与 run.json 运行期三态只认作废类，闸门 `voidedSides` 对命令通道按 `hit === true` 一律作废（注释称「命令通道没有类别信息」，写于带类 `hits` 补上之前）。只提到编排器状态目录的命令（告警级）因此在守卫看来有效、在闸门看来作废，两审形态下共同阻断静默不执行，同一轮 run.json 与 task.json 记着不同的有效侧数（M11 第 12 步 Z2 / B2）。

**改动**：

- `freeze.ts` 新增 `categoriesVoid` / `hitsVoid` / `leakRecordVoids`。`leakRecordVoids` 收与 run.json 单侧记录同形的输入：两条通道都按类别判；命令通道缺 `hits` 退回 `hit`、路径通道缺 `hits` 按无作废（旧口径，不追溯改判）。
- `guard.ts`：逐条命令分档改调 `categoriesVoid`；侧级 `peerArtifactRead` 改调 `leakRecordVoids`（与原判定等价）。
- `gate.ts`：`voidedSides` 改调 `leakRecordVoids`，换掉过时注释，去掉不再使用的导入。已归档轮次重跑 `gate --check` 按新口径派生，不设开关（用户 D-5）。
- `adapters/stub.ts`：`peer_leak_via_command` 新增 `note: 'orchestrator-state'`（B2 的排除式 `find` 原样一条、`--exclude-dir` 字面一条）。

## 3. EV-238：agy 探活失败文案分三档

`adapters/agy.ts` 新增并导出 `describeAgyAuthFailure`，`authProbe` 失败时调它；探活模型取值与调用共用一个变量。`ok` 判定、120 s 外层超时、退 69 都不变。

| 档 | 条件 | 文案要点 |
| :--- | :--- | :--- |
| 认证 | 输出含 `Please sign in`（只认已存原始样本），**优先于超时** | 提示交互登录 |
| 超时 · 有应答 | 外层超时或自报 print timeout，且有 print timeout / 流状态 SUCCESS / 会话 id 之一 | 模型侧慢，可重试，不必重登（Z1 落这里） |
| 超时 · 无应答 | 同上但没有任何应答证据 | 以「可能在等交互登录」打头 |
| 其他 | 以上都不是 | 原因未识别，仍给登录指引 |

**已知局限**：仓库里只有 `agy models` 的未登录原话，没有 `agy -p` 的；本命令约定 Driver 不得自行调用 agy，没有取新样本。未识别原话的未登录，快速失败的落「其他」、挂起到超时的落「超时 · 无应答」，两处都给登录指引。内层 print timeout 后在外层超时前带部分输出退出、流状态为 SUCCESS 时判通过，是现行判定，本批未改。

## 4. 验收读数

**新增用例**：`test/unit/leak-predicate.test.ts` 4 格（含两条通道 × 类别组合 1000 格以上的逐格对照：`leakRecordVoids` 与守卫改动前的口径一致）、`test/unit/agy-auth-failure.test.ts` 6 格、`test/unit/gate.test.ts` 作废侧一组新增 ⑤⑥⑦ 三处断言、`test/integration/fault-injection.test.ts` 1 格（两审 + 只提编排器状态目录：run.json `joint_check` 为 pending / 2 家，闸门无 `joint_check_degraded`、报出 `joint_blocker_rejected`，task.json 为 checked-found / 2 家）。

**变异**（[`evidence/m12-batch1-mutation-20261017/`](./evidence/m12-batch1-mutation-20261017/)）：正式装置 `scripts/mutation-check.mjs` 9/9 咬住（基线 4 个套件全绿、源文件逐字节恢复）。逐条预跑时 M1b、M4（期望集成套件变红）首次判「没红」——集成套件调的是打包产物，预跑脚本用 `--tests-only` 不重打 bundle，变异没进被测产物；改用重打 bundle 的变体（`mutation-names-bundle.mjs`）重跑两条均变红。正式装置本就用 `--with-tests`，不受影响。

**全量**：代码双审前 1 次、收口文档改完后串行 2 次，见 §6。

## 5. 文档同步

- 主设计 v1.3.161：10.1.1「作废判定只有一个谓词」；预检项表「Antigravity 已认证」处置列补失败详情三档；16.1 M12 行状态更新为批次 1 完成。
- BACKLOG：EV-238、EV-239 结案。
- 安装：verify 前执行 `npm run install:local`，安装副本 `trivium.cjs` 与仓库构建 sha256 一致（前缀 `a219aa52`）。提交后需从已提交状态重建，用户重装后核对。

## 6. 全量检查

代码双审前：tests 3637 / pass 3635 / fail 0 / skipped 2（较批次 0 多 11 格：谓词 4、agy 文案 6、集成 1）。
收口后两次串行：均为 tests 3637 / pass 3635 / fail 0 / skipped 2，退出码 0，无偶发红。
