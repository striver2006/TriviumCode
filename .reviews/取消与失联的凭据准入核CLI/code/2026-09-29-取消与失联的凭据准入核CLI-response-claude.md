---
schema: trivium.disposition.v1
topic: 取消与失联的凭据准入核CLI
stage: code
role: claude
kind: response
run_id: 20260928T235013Z
addresses:
  - 2026-09-29-取消与失联的凭据准入核CLI-codex.md
  - 2026-09-29-取消与失联的凭据准入核CLI-gemini.md
  - 2026-09-29-取消与失联的凭据准入核CLI-glm.md
---

# 应答：取消与失联的凭据准入核CLI · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260928T235013Z.diff`（相对 HEAD `08396d2` 的 25 个文件，283.8 KB）
> ｜ 运行：`20260928T235013Z`（约 11 分 39 秒）
> ｜ 结论：gemini `approve`（零意见）｜ glm `approve`（零意见）｜ codex **解析回退**（原文自报 `approve-with-nits`，7 条：次要 4、吹毛求疵 3）
> ｜ 闸门按回退侧的两个待裁决单元校验（CODEX-F01 总述句、CODEX-F02 内含 7 条意见的 JSON 块）；那 7 条的逐条裁决放在表外 §2
> ｜ codex 原文 7 条全接受（CODEX-01 取其备选方案：不改判据、把有意的分叉写明并登记）
> ｜ 命令 A 不设人工闸门：按接受项修订后重跑读数、写进报告 §7

## 0. 核实记录

- **CODEX-01**：事实成立，修法取备选。`terminateRecordedCliGroups` 对发过信号的组在组长确认退出后数成员（`run-protocol.ts` `membersLeft`），`settledCliSides` 要 `membersLeft === 0` 才清记录；而随后的 `scrubAdmission` → `judgeCliGroup` 只看组长，组长不在即 `gone` 放行——同一个 `cliOutcome` 在同一函数里被两处按不同口径读。**不改判据的理由**：①用户决策「准入判据与 `admitScrub` 同源、不得各写一份」「`admitScrub` 行为不变」——在 `cancelRun` 里单加一道 `membersLeft` 检查就是第二份判据，改 `judgeCliGroup` 则同时改了 `admitScrub` 与到期整删的行为；②「组长已退出而组员还在」是 EV-154 用户决策 4 如实保留的一格，计划 r2 §6.2 已写明「准入对它放行、组员若仍在用副本会照抹——与 `admitScrub` 今天同口径」。取审查员的备选：把这一处有意的分叉写进 LLD 与代码注释，并单登 BACKLOG，让它是被权衡过的边界而不是看起来像 bug。
- **CODEX-02**：成立。`--wait` 在 `pid_gone`（及工作进程已死的 `heartbeat_stale`）格新增的那一行只说「留给会话启动清扫」，而会话启动清扫不结束进程；唯一能结束记录里仍在的 CLI 的动作是 `review --cancel`——其终态早退分支对「工作进程确认已不在且有记录」按记录逐组结束（EV-154 D3，集成 EV-154 I5 钉住）。出口只对判「仍在」（`alive`）的那几组成立：判不了、读不懂的记录 `--cancel` 同样不发信号，说成「都能结束」会是新的假话。
- **CODEX-03**：成立。EV-157 原登记写过「CLI 以鉴权错误失败（对已取消 / 已失联的运行反而让它停止烧配额）」；本主题之后 `--wait` 判失联而 CLI 仍活时不抹，孤儿 CLI 手上的凭据仍然有效、也没人结束它，配额会一直烧到有人 `--cancel` 或手工结束。这是用户决策（不抹、`--wait` 不结束进程）的直接后果，但 BACKLOG 与 LLD 都没把它写成残余。
- **CODEX-04**：成立，我在报告 §4 与计划 r2 §3.7 的「仍成立」论证不对。「副本会一直躺到 `run_dir_days` 整删」的内容就是「副本最迟被整删」，而被 CLI 挡住的目录恰恰是副本在盘、到期也不删的目录——句子的论域包含它们。`cli.ts` :327 是 `trivium scrub --help` 的输出，属用户冻结的清扫子命令输出面，与 :1924 同样处置（逐字保留、并入 EV-164）；MANUAL :374、RUNBOOK :224、`retention.ts` :284（注释）不在冻结面内，加限定。
- **CODEX-05**：成立。RUNBOOK「跨仓清扫」的分档表没有 EV-154 起的第四格「因审查员 CLI 未动」，而本主题让到期被挡下的目录也落进这一格；MANUAL :375 把分档含义指向这张表。
- **CODEX-06**：成立（部分）。两种措辞是有意的：`why` 进清扫子命令的冻结输出、逐字保持 EV-157 之前「形状坏的全部合成一句」的旧文字；`detail` 是新告警里的逐侧单句。注释没写这个理由，看起来像偶然重复。取「写死理由」这一支，不另加字段。
- **CODEX-07**：成立。`fakeCtx` 与 `captureStderr` 在 `test/unit/scrub-admission.test.ts` 与 `test/integration/run-protocol.test.ts` 里逐字同形；`seedDeadRun` 与 `seedRun` 语义不同（死 / 活 worker、是否带载体与归档），不是重复。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | — | 接受 | 回退单元是 codex 的开场句（「I have enough context. Here is my review conclusion.」）；如实收下，该侧总判断与 7 条意见都在 CODEX-F02 的 JSON 块里，逐条裁决见 §2 | 无单独改动（见 CODEX-F02） |
| CODEX-F02 | codex | — | 接受 | 回退单元是完整的 `trivium.review.v1` JSON 结论件（自报 `approve-with-nits`，次要 4、吹毛求疵 3，无 blocker / major；解析回退是编排器没能从围栏嵌套里取出它），内含 CODEX-01～07 七条意见，逐条核实后全部接受（§2；CODEX-01 取备选方案） | 见 §2 七条的落点 |

## 2. CODEX-F02 内七条意见的逐条裁决（表外，闸门不按这些编号校验）

- **CODEX-01（minor）接受，取审查员的备选方案（不改判据）**。理由见 §0：改判据与用户决策「同源、`admitScrub` 行为不变」冲突，且「组长已退、组员仍在」是 EV-154 决策 4 如实保留的格。落点：`run-protocol.ts` `settledCliSides` 与 `cancelRun` 挂载点 ③ 的注释写明「准入只看组长；`membersLeft` 只用于告警与是否清记录，这是有意的分叉」；LLD 4.2 `cancelRun` 引述块同一句；BACKLOG 新登 **EV-165**（凭据准入对「组长已退出、组员仍在」的组放行——四处同口径；候选：`judgeCliGroup` 在组长不在时数一次组成员、非零即挡住，代价是组长不在时多一次 `ps`，会同时改 `admitScrub` 与到期整删的行为，须用户定）；报告 §3.3 与 §7 如实记。
- **CODEX-02（minor）接受**。落点：`waitRun` 挂载点 ② 在 CLI 挡住、且阻挡项里有判「仍在」的组时，`scrubNote` 之后再加一行出口：「其中仍在的审查员 CLI 可用 trivium review --cancel 〈run_id〉 按记录结束（本命令不结束任何进程）；结束之后下一次会话启动清扫即抹副本」；阻挡项只有判不了 / 读不懂时不加（`--cancel` 也不对它们发信号）。不新增任何结束进程的动作。U6 / K1 断言补这一行（A 格有、C / D 格没有）；验收 A1 的允许差异相应为两行（「凭据副本未抹」与出口句），A2（`--cancel`）不受影响；PROTOCOL / MANUAL 同步。
- **CODEX-03（minor）接受**。落点：BACKLOG EV-157 的 done 注记补「残余：`--wait` 判失联而 CLI 仍活时副本不抹，孤儿 CLI 手上的凭据仍有效、配额照烧，直到有人 `--cancel`（按记录结束）或手工结束——用户决策（不抹、`--wait` 不结束进程）的直接后果；CODEX-02 的出口句把这条路指给人」；LLD 已知缺口表该行「已解决」之后补同一残余；MANUAL 场景 4 引述块补半句。
- **CODEX-04（minor）接受**。落点：MANUAL :374 与 RUNBOOK :224 句末加限定「（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删，见 MANUAL 场景 4 / BACKLOG EV-164）」；`retention.ts` :284 注释同样加限定；`cli.ts` :327（`trivium scrub --help`）属冻结的清扫子命令输出面，逐字保留、代码旁注明，BACKLOG EV-164 的登记面与位置栏扩到这一处；报告 §4 与计划 r2 §3.7 的「仍成立」结论在报告 §7 里如实更正（计划 r2 已定稿，不回改）。
- **CODEX-05（nit）接受**。落点：RUNBOOK「跨仓清扫」分档表补一行「因审查员 CLI 未动 N 个 ｜ 工作进程已不在，但记录里的审查员 CLI 进程组仍在／判不了／记录读不懂（到期被挡下的目录也在这一格） ｜ CLI 结束后再跑即重判；「记录读不懂」不自愈，核对进程确已不在后把该侧 `cli` 改回 null（到期整删也会保留它）」。
- **CODEX-06（nit）接受，取「写死理由」**。落点：`status.ts` `cliGroupsConfirmedGone` 文档块补一句：形状坏的措辞有两份是有意的——`why` 进 `trivium scrub` 与会话启动的冻结人读输出、逐字保持旧的「合成一句」，`detail` 是新告警的逐侧单句；二者都由 U1 逐字钉住。
- **CODEX-07（nit）接受**。落点：新增 `test/helpers/run-ctx.ts`，导出 `fakeCtx`（保持集成侧原形：`mkdtemp` 不取 realpath、前缀可传）与 `captureStderr`；`test/unit/scrub-admission.test.ts` 与 `test/integration/run-protocol.test.ts` 都改为从它导入；`seedDeadRun` / `seedRun` 语义不同，各留一份并在注释里写明。

## 3. 修改方案（命令 A：应答后直接执行）

1. **代码**：`run-protocol.ts`（`waitRun` 出口句、`cancelRun` ③ 与 `settledCliSides` 注释、`retention.ts` :284 注释）、`status.ts`（文档块）、`cli.ts` :327 旁注释（输出不改）。
2. **用例**：U6 / K1 补出口句断言；新增 `test/helpers/run-ctx.ts` 并替换两处夹具。
3. **文档**：LLD（`cancelRun` 引述块的分叉说明、已知缺口表残余、EV-165）；MANUAL（:374 限定、场景 4 出口句与残余）；RUNBOOK（:224 限定、分档表第四格）；PROTOCOL（出口句）；BACKLOG（EV-157 残余注记、EV-164 登记面扩到 `cli.ts` :327、新登 EV-165）；主设计（「审查员 CLI 进程组记录」段与变更记录 v1.3.58 行补出口句、EV-165）。
4. **读数**：修订后重跑全量（文档改前、改后各一次）、源码变异（按修订后代码重生成规格，新增一条「出口句恒不出 / 恒出」；原规格与读数留 `.r1`）、失败用例名核对、零配额验收（A1 的允许差异改为两行，其余格不变）、`doctor --selftest`；写进报告 §7。
5. **不改**：凭据准入判据本身（CODEX-01 取备选）；`trivium scrub` 的任何输出与帮助文字（CODEX-04 中 `cli.ts` :327 与 :1924 同属 EV-164，待用户定）。
