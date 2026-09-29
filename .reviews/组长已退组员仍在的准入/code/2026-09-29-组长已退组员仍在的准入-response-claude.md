---
schema: trivium.disposition.v1
topic: 组长已退组员仍在的准入
stage: code
role: claude
kind: response
run_id: 20260929T041949Z
addresses:
  - 2026-09-29-组长已退组员仍在的准入-codex.md
  - 2026-09-29-组长已退组员仍在的准入-gemini.md
  - 2026-09-29-组长已退组员仍在的准入-glm.md
---

# 应答：组长已退组员仍在的准入 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260929T041949Z.diff`（相对 HEAD `eeceeaa` 的 23 个文件，263.4 KB）
> ｜ 运行：`20260929T041949Z`（约 9 分 29 秒）
> ｜ 结论：gemini `approve-with-nits`（2 条）｜ glm `approve-with-nits`（2 条）｜ codex **解析回退**（原文自报
>   `request-changes`，3 条：重要 1、次要 1、吹毛求疵 1）
> ｜ 闸门按回退侧的三个待裁决单元校验（CODEX-F01 总述句、CODEX-F02 内含 3 条意见的 JSON 块、CODEX-F03 结论说明段）；
>   那 3 条的逐条裁决放在表外 §2
> ｜ codex 原文 3 条全接受；gemini 2 条全接受；glm 2 条全接受——**共 7 条，全部接受**
> ｜ 命令 A 不设人工闸门：按接受项修订后重跑读数、写进报告

## 0. 核实记录

- **CODEX-01（major，成立，我自己在本轮新写的文档描述错误）**：核实 `status.ts:290-333`（`judgeCliGroup`）：`now===null`
  分支复检 `kill(pgid,0)` 之后，若组长仍在（异常码为 `EPERM` 或未抛异常）落到 `return 'unverifiable'`，不是 `reused`。
  而我在主设计 v1.3.60 §7.5「复用判据」段与 `status.ts` 的 `judgeCliGroup` 文档块里把这条路径与「不符」合并成了同一句
  「不符（或取不到、复检后组长仍在）⇒ 组号已被复用（`reused`）」——这是把两个语义相反的结果（`reused` 放行、
  `unverifiable` 阻挡）写成了一个。代码本身没问题（复用 r1 既有逻辑，未受本轮改动影响），问题是**本轮新写的文档表述**
  与代码矛盾，会误导下一位按文档实现的人把这一格改成 `reused`、在组长可能带着活组员时放行抹除凭据——与同一段设计文的
  「如实保留」清单自相矛盾（那里仍写着「启动时刻未取到（不发信号、不抹）」）。只改文字，不改代码。
- **CODEX-02（minor，成立）**：核实 `doc/05_testing/evidence/orphan-cli-admission-20260929/probe-pgid-reuse.mjs:79` 与
  `acceptance.mjs:51`：探针与验收脚本的 `readout` 只登记了 `node: process.version` 与 `platform: process.platform`，
  没有登记 macOS 产品版本（`sw_vers -productVersion`）与内核版本（`uname -r`）。而「组员仍在时组号不会被复用」这个前提
  是 XNU 的 pid/pgid 分配行为，与 Node 版本无关，只登记 Node 版本无法在日后界定该前提在哪个系统版本上成立。这是本仓
  「厂商/系统行为与文档不符是常态」纪律下的合理补强，不改代码判据本身。
- **CODEX-03（nit，成立，如实登记不改设计）**：核实 `run-protocol.ts:823-833`（`isGone` 轮询）与 `status.ts:306-310`
  （`leaderGone`）：孤儿组或「组长先退、组员扛 TERM」的组在宽限轮询期间，每 250ms 一次 `processGroupMemberCount` 都是
  一次全机 `ps -axo pgid=,stat=` 扫描——这是 r2 计划已经预告并接受的成本（§3.4「如实记录性能读数，不做设计改动」），
  本条把量级说得更具体（每组每次 cancel 约 12+ 次全表扫描）。计划已定的处置维持：不改代码，只在文档里把这个量级说清楚。
- **AGY-01（minor，成立，真实的测试脆弱性）**：核实 `test/integration/gate-loop.test.ts` 的 K5/K6：`killLeaderOnly(glmPgid)`
  在调用之前没有像 `test/unit/scrub-admission.test.ts` 的 `orphanedGroup`（:126-133）那样先等 `groupMemberCount(glmPgid) >= 2`
  ——`startWithRecordedClis` 的 `cliGroups` 只等「两侧**各自**的组长都已存在」（两个不同 pgid），不等某一侧组内的
  `sleep` 子进程已经 fork 完成。若在 `sh` 刚起、还没来得及 fork `sleep` 的窄窗口里就把组长 SIGKILL 掉，组会被整个端掉、
  `groupMemberCount` 恒为 0，随后 `for (…n===0…)` 的等待循环毫无意义、会白等到超时断言失败——这与 `scrub-admission.test.ts`
  里已经修过的同一形态竞态（我自己犯过一次、也已经修过，但没有同步到 K5/K6）是同一个问题。
- **AGY-02（nit）≡ GLM-01（minor，同一处，合并处理）**：核实 `run-protocol.ts:787-802`（`terminateRecordedCliGroups`
  文档块）：`isGone` 一句里同时写着「组长服从 SIGTERM 而组员忽略时不升级」与括号内「isGone 仍为假，继续升级」——
  这句话本身自相矛盾（EV-154 旧文案「不升级」的残留没删干净，我在改写这段注释时只在括号里补了新说明，忘了删旧半句）。
  GLM-01 进一步核出 `util/exec.ts:709-742`（`terminateProcessGroup` 文档块，本轮**零改动**的文件）也因新 `isGone` 语义
  被连带失实：它仍整句写「组长服从 SIGTERM 而组员忽略时，宽限轮询在组长退出那一刻即返回、不升级 SIGKILL」，而新
  `isGone`（`v==='gone'||v==='reused'`）在「组长退、组员在」时持续为假，宽限耗尽会升级——这是本主题行为变化最核心的
  一句注释，必须改准。两处都只改注释，`U15` 变体的断言（`signals:['SIGTERM','SIGKILL']`）已经钉住了新行为本身。
- **GLM-02（minor，成立，我在报告里的论证是错的）**：核实 `run-protocol.ts:846-882`（`reportRecordedCliGroups`）新增的
  `orphan_unverifiable` warn 文案（「组长已退出，组里的非僵尸成员数取不到，判不了是否还有遗留，不发信号——请用 ps 核对」）
  确无任何用例钉住，而它已被 `MANUAL_user.md` v1.0.18 逐字引用、是用户可见的契约面文案。报告 §3.3 第二条「该函数未
  导出，只能通过 `cancelRun` 完整链路间接触发、构造『真实孤儿组 + 真实 ps 失败』超出零配额可行范围」这个论证**不成立**：
  `test/unit/scrub-admission.test.ts` 既有的 U5 A 格已经用 `CancelOptions.terminateCli` 注入一个伪造的 `RecordedCliOutcome`
  走完整 `cancelRun` 链路触发这条播报，不需要真实孤儿组也不需要真实 ps 失败。接受，补测试，并更正报告的错误论证。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | — | 接受 | 回退单元是 codex 的开场句；如实收下，该侧总判断与 3 条意见都在 CODEX-F02 的 JSON 块里，逐条裁决见 §2 | 无单独改动（见 CODEX-F02） |
| CODEX-F02 | codex | — | 接受 | 回退单元是完整的 `trivium.review.v1` JSON 结论件（自报 `request-changes`，重要 1、次要 1、吹毛求疵 1）；内含 CODEX-01～03 三条意见，逐条核实后全部接受（§2） | 见 §2 三条的落点 |
| CODEX-F03 | codex | — | 接受 | 回退单元是原始输出末尾的「结论说明（非契约部分）」一段——对 CODEX-01～03 三条的优先级摘要，内容与 CODEX-F02 的 JSON 块一致，无新增信息；如实收下 | 无单独改动（见 CODEX-F02 与 §2） |
| AGY-01 | gemini | minor | 接受 | K5/K6 杀组长前缺少「组员已 fork 完成」的前置等待，是真实的测试竞态风险，与 `scrub-admission.test.ts` 已修过的同一形态不一致 | `test/integration/gate-loop.test.ts`（`killLeaderOnly` 调用前补等待） |
| AGY-02 | gemini | nit | 接受 | 与 GLM-01 合并处理（`run-protocol.ts:799` 自相矛盾的注释） | `src/trivium/run-protocol.ts`（文档块） |
| GLM-01 | glm | minor | 接受 | 两处注释（`run-protocol.ts`、`util/exec.ts`）残留 EV-154 旧语义，与本轮新 `isGone` 行为矛盾或失实 | `src/trivium/run-protocol.ts`、`src/trivium/util/exec.ts`（文档块） |
| GLM-02 | glm | minor | 接受 | `orphan_unverifiable` warn 文案已被 MANUAL 逐字引用却无测试钉住；报告 §3.3 的「不可行」论证是错的，既有 U5 A 格的 `terminateCli` 注入手法可以覆盖 | `test/unit/scrub-admission.test.ts`（新用例）、`doc/05_testing/REPORT_2026-09-29_orphan_cli_admission.md`（更正 §3.3） |

## 2. CODEX-F02 内三条意见的逐条裁决（表外，闸门不按这些编号校验）

- **CODEX-01（major）接受**。落点：主设计 v1.3.60 §7.5「复用判据」段与 `status.ts` `judgeCliGroup` 文档块的括号内容
  改写为与代码一致的三分法——「不符 ⇒ `reused`；取不到且复检组长仍在 ⇒ `unverifiable`（判不了）；复检组长已退 ⇒ 与
  组长不在同路（`leaderGone`）」，并注明 `reused`＝放行、`unverifiable`＝阻挡，防止下一轮改写再混同。只改文档与注释，
  不改代码（代码本身正确）。
- **CODEX-02（minor）接受**。落点：`probe-pgid-reuse.mjs` 与 `acceptance.mjs` 的 `readout` 补记 `sw_vers -productVersion`
  与 `uname -r`（只读，不改判据）；报告证据段与主设计「如实保留」清单补一句「该前提是 XNU 行为，macOS 升级后需要复核」。
- **CODEX-03（nit）接受，不改代码**。落点：主设计「如实保留」清单或 BACKLOG 补一句性能量级记录（「孤儿组终止轮询每组
  约 12+ 次全表 `ps` 扫描，10 s 单次上限兜底」），与 r2 计划 §3.4 已定的处置一致（如实记录、不做批量化设计）。

## 3. 修改方案（命令 A：应答后直接执行）

1. **文档/注释**（CODEX-01、AGY-02≡GLM-01、CODEX-03）：主设计 v1.3.60 §7.5 复用判据段改准；`status.ts` `judgeCliGroup`
   文档块同步；`run-protocol.ts:799` 自相矛盾句改写；`util/exec.ts` `terminateProcessGroup` 文档块按新 `isGone` 语义
   改准；性能量级一句登记。
2. **测试**（AGY-01）：K5/K6 在 `killLeaderOnly(glmPgid)` 之前补 `groupMemberCount(glmPgid) >= 2` 的前置轮询等待。
3. **测试**（GLM-02）：新增用例，用 `CancelOptions.terminateCli` 注入 `verdict:'orphan_unverifiable'` 的伪造
   `RecordedCliOutcome`，经 `cancelRun` 断言 `reportRecordedCliGroups` 的 warn 文案逐字。
4. **文档**（CODEX-02）：探针/验收脚本补记系统版本；报告 §3.3 更正错误论证，改为「已用 terminateCli 注入覆盖」。
5. **读数**：修订后重跑受影响单测/集成套件、全量 `npm test`、`doctor --selftest`；如涉及源码行号变化，核对变异规格
   仍能唯一命中（不改代码逻辑，预期变异规格不用重生成）；读数写进报告新增小节。
