# 未收尾运行的留痕与复盘可见性 · 实施报告（EV-142 / EV-144）

- **日期**：2026-09-27
- **主题**：`未收尾运行的留痕与复盘可见性`；计划 `.reviews/未收尾运行的留痕与复盘可见性/plan/`（r1 送审前用户授权按最优原则拍板 D1～D8、全取建议项 → 计划双审 run `20260926T235951Z` 8 条全接受 → r2 定稿，提交 `e22a174`；用户审批「修改后实施」）
- **起点**：`e22a174`；计划行号取自 `9003a0e`（两者之间只有计划留痕与用户自己的两条 `.trivium/config.yaml` 提交，源码未变）
- **状态**：代码双审 r1（run `20260927T005543Z`）接受 3、驳回 1，审批「修改后通过，提交，推送」；已按应答件修订（§7）
- **evidence**：`doc/05_testing/evidence/unfinished-runs-20260927/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 通用收尾 | `meta.ts`：函数体改为按目标终态参数化的 `finalizeUnfinishedRunMeta`（内部），对外 `finalizeCancelledRunMeta`（签名与行为不变）与新增 `finalizeFailedRunMeta`；两步辅助函数改名 `unfinishedRunMetaStep` / `unfinishedTaskEntryStep`；第一步的读、判、写整段进 `withTopicLock(taskLockName)`；第二步判据改为「run.json 已是本次目标终态」；`taskLockName` 改为导出（F6 要占这把锁） | `run-meta-failed.test.ts` F1～F7；既有 R1～R7 原样绿 |
| §3.2 worker 异常 | `run-protocol.ts` `workerMain` 的 `catch`：在 `patchStatus` 之前取身份（status.json，读不到则交接文件）、调 `finalizeFailedRunMeta({ workerGone: true, termination: { by: 'worker_exception', exit_code } })`，两步结果经新增的 `describeFinalizeStep` 拼进 status.json 的 `message` | `gate-loop.test.ts` W1 / W2 |
| §3.3 `worker_lost` | `waitRun` 的 `worker_lost` 分支：改写 status.json 之前判「已退出」——status.json 在时 `workerConfirmedGone(pre, fallbackPid)`，读不到而 worker.pid 已知时 `processAlive(fallbackPid, null)` 不存在才算；身份取 `pre` → `last` → 交接文件；两步结果只拼进报错正文（不调 `reportFinalizeStep`）；:680 的凭据抹除判定原样 | `run-protocol.test.ts` L1（含 L4 的顺序断言）/ L2 / L3 / L5 |
| §3.4 撞车 | 由 §3.1 的锁承担；顺序撞车两格由用例钉住 | F7；`gate-loop.test.ts` X1 / X2 |
| §3.5 `termination` | `status.ts` 导出 `WORKER_LOST_REASONS` 并派生 `WorkerLostReason`；`types.ts` 新增 `RunTermination` 与 `RunMeta.termination?`；run.v2 schema 新增 `termination`（`oneOf` 两形状、各自 `additionalProperties: false`）并改写 `status` description | `run-meta-strict.test.ts` S1 / S2 |
| §3.6 EV-144 | `report.ts`：新增 `UnlistedRun`、`TopicReport.unlistedRuns`、`collectUnlistedRuns`（可读 run.json 减去时间线选中者，读不出的进 notes）、`unlistedLabel`；渲染在时间线表后加「未进时间线的运行」小节与表后注、头部「轮次总数」与空主题 note 追加「另有 K 次」 | `report.test.ts` V1～V7；既有 15 条原样绿 |
| §5 文档 | 主设计 v1.3.48（6.7 注记、6.7.1 `termination` 行、7.5 约束①、§5.1 `report` 行、§13.2、故障表、验收表、变更记录）；PRD v1.4.12（变更说明、FR-24）；LLD v1.1.6（`worker_lost` 一节、引述块、已知缺口表一行）；MANUAL v1.0.6（场景 4、§6.4）；PROTOCOL（`termination` 段、`worker_lost` 约束、命令表 `report` 行）；BACKLOG（EV-142 / EV-144 状态、EV-133 一句、新登 EV-145 / EV-146） | §5 反扫词表逐词 grep，剩余命中均为历史说明或本次新写的说明 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | **2126 / 2124 / 0 / 2**（起点 2103 → 新增 23 条：F 7、S 2、V 7、L 4、W 1、X 2）。实施后跑一次，文档同步后再跑一次，两次读数相同 |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14/14** |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并逐条核对唯一） | **16/16**（`mutation-output.txt`）：M1～M3（`gate-loop.test`，W1 / W2）、M4～M6、M17（`run-protocol.test`，L1 / L2 / L3 / L5）、M7～M10（`run-meta-failed.test`，F6 / F1 / F3 / F4）、M11（`run-meta-cancel.test`，R1）、M12～M15（`report.test`，V1 / V2 / V1 / V3）。每条只写一个期望套件 |
| 契约侧变异（`contract-mutation.mjs`） | **1/1**（`contract-mutation-output.txt`）：M16 去掉 `termination` 的 `additionalProperties: false` ⇒ S1 红 |
| 零配额验收（`acceptance.mjs`，mkdtemp 夹具、桩审查员） | **18/18**，第 1 次即过（`acceptance-readout.json`） |
| 环境 | git 2.54.0（Apple Git-157），Node v25.2.1 |

## 3. 偏离与如实登记

### 3.1 契约侧变异脚本第一版判错了被测产物

M16 第一次跑报「产物哈希未变」：脚本假定 schema 经 `import` 内联进 `dist/test/src/trivium/schemas.js`，实际构建把 schema 拷成 `dist/test/skills/dual-critic/schema/run.v2.json`、由 `schemas.js` 运行时 import。改为比对那份拷贝后 M16 咬住（fail=1）。第一次那轮的变异已按哈希恢复，`run.v2.json` 的改动只剩本主题的正式修改。

### 3.2 M2 与 W1 / W2 同一条用例

W1（内容）与 W2（顺序）为省一次真实 CLI 夹具合在一条用例里。M2 把收尾挪到 `patchStatus` 之后时，`message` 也随之拿不到收尾结果（`notes` 在 `patchStatus` 时还是空的），于是 W1 的 message 断言与 W2 的修改时间断言都会红——装置只报 fail=1，分不出是哪一条断言先红。M2「咬住」成立，但它的区分依据不只是顺序，如实登记。

### 3.3 与 r2 文字的小出入

- `RunTermination` 定义在 `types.ts`（r2 §3.1 的代码示意写在 `meta.ts`）：`RunMeta.termination` 要用它，放在类型模块里免得 `types.ts` 反向依赖 `meta.ts`。
- L4（顺序）并进了 L1 那条用例，没有单列——构造完全相同。集成用例计数因此是 L 4 条。
- `reportFinalizeStep` 未改（r2 §3.3 AGY-01 落点：它只服务 `--cancel`）；另两处用新增的 `describeFinalizeStep` 返回字符串。
- 「入选侧全部失败」的判据：`failed`、无 `termination`、登记了 `.failed.json`、没登记本轮入选审核者后缀的审查文档。
- A6 读的是 51 个主题（含本主题）：本主题的计划双审轮已有审查文档、在时间线里，所以「本主题自身」条目为 0，下表合计恰为 4 份历史 running。

### 3.4 实施期间用户自己的配置提交

实施期间 `.trivium/config.yaml` 出现过一批不属本主题的改动（用户在 IDE 里的编辑）；送审前用户已自行提交（`09d7d96`、`04d05e0`），所以代码双审的基线是 `04d05e0`、补丁只含本主题的 28 个文件，本主题提交也不含该文件。
（本节初稿写成「工作树里有用户未提交的 26 行改动」，送审时已不成立，代码双审修订时改准。）

## 4. 文档同步

见 §1 最后一行。主设计 7.1 命令表 `review --cancel` 那一格未改：取消的行为本主题没变。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `running-census.mjs` | 计划 §2.1：归档里 `running` 的 run.json 与本机运行目录对照 |
| `report-invisible-census.mjs` | 计划 §2.3：逐主题 `buildTopicReport`，列时间线没选中的运行（实施前构建） |
| `probe-unfinished.mjs` | 计划 §2.2：P1～P4 夹具实测（实施前构建） |
| `gen-mutation-spec.mjs` → `mutation-spec.json`、`mutation-output.txt` | 源码侧变异规格生成、锚点唯一性核对与 16/16 结果 |
| `contract-mutation.mjs`、`contract-mutation-output.txt` | 契约侧 M16 与结果 |
| `acceptance.mjs`、`acceptance-readout.json` | 零配额验收 A1～A6（18/18） |

## 6. 待办

1. ~~用户终端重装 → 用户敲 `/dual-review-code`~~——r1 已过（§7）。
2. 提交、推送；从已提交状态重建，用户重装（`--targets claude,glm,codex,gemini`），复核安装副本一致。

## 7. 代码双审 r1（run `20260927T005543Z`）与修订

三侧：codex `approve-with-nits`（3 nit）、gemini `approve`（零意见）、glm `approve-with-nits`（1 nit）；4 条接受 3、驳回 1，同指一组 CODEX-01 ≡ GLM-01。用户审批「修改后通过，提交，推送」。
应答件 `.reviews/未收尾运行的留痕与复盘可见性/code/2026-09-27-未收尾运行的留痕与复盘可见性-response-claude.md`。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 ≡ GLM-01 | `run-protocol.ts` 失联分支注释里「下面 :680 那次判定」（本补丁插入后实际在 :746）改为按调用引用「抹凭据副本前的 `workerConfirmedGone(meta0, …)` 那次判定」；`meta.ts` 注释里的「:1627」改为「`executeRun` 收尾写完 run.json 终态之后」 | 只动注释；全量重跑 |
| CODEX-02 | LLD 4.2「三判据（`status.ts:165-196`）」改为现值 `status.ts:205-249`，常量标 `:187`；LLD 变更说明补一句 | — |
| CODEX-03 | 驳回：`acquireLock` 的 `LOCKED` 文案里「可用 `trivium review --cancel` 取消」在第二行，`skippedFromError` 只取异常首行（`meta.ts` :539），不会进入事后收尾的告警 | — |

另：§3.4 改准（见该节末句）。修订后读数见下。

| 项 | 读数 |
| :--- | :--- |
| `npm run check`（修订后） | **2126 / 2124 / 0 / 2** |
| 变异规格锚点（修订后重跑 `gen-mutation-spec.mjs`） | 16 条锚点仍全部唯一；修订只动注释，不重跑装置 |
