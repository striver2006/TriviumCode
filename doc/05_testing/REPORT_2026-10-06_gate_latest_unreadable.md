# 闸门最新留痕读不出即硬失败 · 实施报告（EV-73）

> - **日期**：2026-10-06
> - **主题**：`闸门最新留痕读不出`（M11 前待办第三批第 1 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`06994fd`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/gate-latest-unreadable-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定取 A——`gate` 与另四处同口径，最新一份读不出即硬失败（退 65、共用出口段 + 本次判定一行），旧轮经 `--run-id` 查看（BACKLOG EV-73 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. Driver 判定的四个消费点（`review --start`、`topic claim`、`topic resolve`、`hook-pre-write`）共用 `src/trivium/driver-claim.ts` :114 `resolveStageDriver`：:121 起「`unreadable` 非空即判 `corrupt`，即使已经取到一份可读的 meta」，四处都以 `meta.ts` 的共用出口段 `unreadableRunMetaExitAt` 收尾。
2. `src/trivium/cli.ts` `cmdGate` 不走它：:1133 起没钉 `--run-id` 时直接 `latestRunMeta`，:1155 只判 `!latest && scan.scanned > 0`（一份都读不出）为硬失败（65，`missingArtifactError`）。最新一份读不出、较旧一份可读时，`meta.ts` :547 `latestRunMeta` 打一行 stderr 告警「运行元数据 X（阶段）读不出来，已跳过」后返回较旧那份，`cmdGate` 采信它的 `driver`、`rerun_index` 与 `run_id`，`--check` / `--check-artifacts` / `--await-approval` 三条子命令都据此对上一轮判定，`--json` 输出里没有任何迹象。
3. `--run-id` 钉住的那一份读不出时，:1117 起已是 65 + 「本次判定」一行（EV-04）+ 共用出口段；钉住可读的那份时 `scan` 直接由它构造（`unreadable: []`），不扫目录。
4. 写着「`gate` 静默采信较旧的可读份 / 有意分叉」的落点：`hooks.ts` :324「与 `cmdGate` 在中间格有意分叉」一节；`meta.ts` :504 起 `latestRunMeta` 文档块「最新那条坏掉时闸门会据此把轮次与 run_id 一并变旧」一段；`meta.ts` :556 起共用出口段文档块列的「七处」；主设计 8.4 结局③之后那段「与 `gate` 有意分叉」与「留痕读不出：成因与出口」段的处数与退出码列表。`driver-claim.ts` :127 的注释讲的是 `resolveStageDriver` 自己，不涉及 `gate`。
5. 用例：`test/integration/gate-loop.test.ts` T-12 只覆盖「一份都读不出」与「钉住读不出」；「最新坏、旧可读」这一格在 `gate` 侧零覆盖（`test/unit/run-meta.test.ts` 的「读不出来的那条往下跳」测的是 `latestRunMeta` 本身，语义不变）。用户手册没有描述 `gate` 读不出留痕的处置（RUNBOOK「提交被拦下」一节已笼统写「`gate` … 遇到读不出时给的就是这三档」）。

### 修法

1. `cmdGate`：在「一份都读不出」那条硬失败之后，加一条「取到了可读的一份、但比它更新的读不出」（`latest && scan.unreadable.length > 0`）的硬失败——退 65（`missingArtifactError`），前半句说清是最新那几份读不出、不按上一轮继续，并给出查看上一轮的出路「`--run-id <可读那份>`」；之后加「本次判定」一行（逐份用 `readRunMetaDetailed` + `describeRunMetaCause` 判成因），以 `unreadableRunMetaExitAt(layout, stage, scan.unreadable)` 收尾。三条子命令走同一条路径，口径一致。
2. 注释：`hooks.ts`「有意分叉」一节改写为「EV-73 起 `gate` 同口径」；`meta.ts` 两段文档块同步（最新坏时闸门不再变旧、共用出口段列入新的一处）。
3. 用例：`gate-loop` 新增一格——真实跑一轮得到可读留痕，再放一份更新的读不出的 run 文件：三条子命令都退 65、文案与出口段、本次判定一行；`--run-id` 钉住可读那份时与损坏前同结果（可查看旧轮）。
4. 文档：主设计 8.4 两段、用户手册 §9.2 常见症状补一行、RUNBOOK 不动（已涵盖）；版本记录与 BACKLOG 结案。

### 不改的边界

- 「一份都读不出」那条硬失败的文案不动（T-12 逐字断言），也不给它补「本次判定」——用户定的范围是新这一格。
- `latestRunMeta` 本身的语义与告警不动（`resolveStageDriver` 也依赖它的「newest-first、命中即返回」）；`--run-id` 钉住的两种结局不动。
- 不加 `--driver` / `--force` 一类覆盖旗标（原有决策）；提交锚、`approve` 复核不动。

## 1. 改了什么

1. `src/trivium/cli.ts` `cmdGate`：「一份都读不出」那条硬失败之后新增一支——`latest && scan.unreadable.length > 0`（取到可读的一份，但比它更新的读不出）⇒ `missingArtifactError`（65）。前半句：「`<阶段>` 阶段最新的 N 份运行元数据读不出来（ids），可读的最新一份是更早的 X」「不能按那一份继续——……」「只想查看上一轮的，可用 `--run-id X` 钉住那一份」；随后「本次判定：」一行（逐份 `readRunMetaDetailed` + `describeRunMetaCause`，多份以「；」相连，复读时已可读的照实写「复读时已可读」、不改判）；以 `unreadableRunMetaExitAt(layout, stage, scan.unreadable)` 收尾。三条子命令在这之前没有任何写入，所以硬失败时不立停点。
2. 注释：`hooks.ts`「与 `cmdGate` 在中间格有意分叉」一节改为「曾经有意分叉（EV-73 起同口径）」，保留当时的理由原文并补一句 EV-73 的结论；`meta.ts` `latestRunMeta` 文档块补「EV-73 起这一格不再发生」，共用出口段文档块补 `gate` 后来接上的两处（钉住读不出、最新读不出）。
3. 用例：`test/integration/gate-loop.test.ts` 新增 T-12b——真实跑一轮（桩）得到可读留痕并写好裁决件，再放一份 run_id 更新（`29991231T235959Z`）的坏 JSON：`--check` / `--check-artifacts` / `--await-approval` 都退 65；前半句、`--run-id <旧份>` 出路、「本次判定」一行的位置（原文之后、出口段之前）、共用出口段只列坏的那一份；闸门没被推到等待审批；`--run-id` 钉住可读的旧份时 `--check-artifacts` 与 `--check` 都退 0、输出不提「读不出来」。
4. 文档：主设计 v1.3.114（8.4 结局③之后那段改为「曾与 `gate` 有意分叉」并补 v1.3.114 起的口径；「留痕读不出：成因与出口」段补这一处）；用户手册 v1.0.36（§9.2 常见症状补一行）；BACKLOG EV-73 结案；本报告登记索引。RUNBOOK「提交被拦下」一节已笼统写「`gate` … 遇到读不出时给的就是这三档」，仍成立，未改。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑 T-12 与 T-12b（`--test-name-pattern='T-12'`） | 2/2 | `suite-t12.txt` |
| 变异逐条预跑（带 `--test-timeout`） | M1～M4 各红 1 格，均为 T-12b | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 4/4 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量首轮（作废） | 两次都 2883 / 2879 / 2 / 2，红的是 `doc-archive-index` A2：我提前起草的第 3 题报告草稿放进了 `doc/05_testing/` 而没登记索引（与本题改动无关）。等这轮序列跑完后把草稿挪出仓库，再完整重跑 | `first-round-red/` |
| 全量第 1 次 `npm run check` | 2883 / 2881 / 0 / 2，退 0（总数比起点 2882 多 1，即 T-12b） | `check-1.txt` |
| 全量第 2 次（串行） | 2883 / 2881 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 两次全量期间各 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

变异规格：M1 新分支条件恒假（改前形态）；M2 删「本次判定」一行；M3 查看旧轮的出路指向读不出的那一份；M4 出口段列可读的旧份而不是读不出的那几份。

## 3. 提交前自审

- 注释与文档：`grep` 复核「静默采信 / 有意分叉」的现时态落点——`hooks.ts`、`meta.ts`、主设计 8.4 两处都已改为过去时或补了 v1.3.114 起的口径；`cli.ts` 新分支注释如实写「此前」；设计 v1.3.112 版本行是历史记录，未改。LLD、PROTOCOL 没有描述这一格，无须改。
- 断言范围：T-12 的断言一字未动；T-12b 只断言新这一格与 `--run-id` 钉住旧份可用，没有放宽任何既有断言。「一份都读不出」那条文案没加「本次判定」（用户定的范围是新这一格）。
- 范围：`latestRunMeta` 本身、`resolveStageDriver`、提交锚与 `approve` 复核都未动；没有加覆盖旗标。本题无新增护栏登记调用点（没有新增 `locateSubject` 一类调用）。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
