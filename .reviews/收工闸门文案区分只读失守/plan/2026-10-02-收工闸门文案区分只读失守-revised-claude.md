---
schema: trivium.disposition.v1
topic: 收工闸门文案区分只读失守
stage: plan
role: claude
kind: revised
run_id: 20261002T143500Z
addresses:
  - 2026-10-02-收工闸门文案区分只读失守-codex.md
  - 2026-10-02-收工闸门文案区分只读失守-gemini.md
  - 2026-10-02-收工闸门文案区分只读失守-glm.md
---

# 裁决：收工闸门文案区分只读失守 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-02-收工闸门文案区分只读失守-claude.md`（r1，起点 `364ef0f`）
> ｜ 运行：`20261002T143500Z`（约 8 分 22 秒）
> ｜ 结论：codex `request-changes`（8 条全部因缺 `confidence` 逐条降级：重要 2、次要 6）｜ gemini `approve-with-nits`（次要 3、吹毛求疵 1）｜ glm `approve-with-nits`（重要 1、次要 2、吹毛求疵 1）
> ｜ 共 16 条：接受 16、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-02-收工闸门文案区分只读失守-r2-claude.md`；命令 A 不设人工闸门

每条都回源码核过，核对结果写在「理由」列。codex 侧 8 条虽逐条降级（不参与阻断判定），内容逐条有效，一律按正式意见裁决。三侧对 D1（按闸门项 `run_id` 直读、不用 `latestRunMeta`）均表认可，定案。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实：`gate.ts` 那段处置句的上方注释记着四次单点更正，r1 让 Hook 另抄一份、靠注释互指同步，是靠记性的纪律；EV-148 已为同类问题建过共用出口段。抽常量只搬位置、拼出的字节不变，不违反决策一「不改 gate --check 的输出」 | r2 §0、§2.3 共用处置段（`READONLY_BREACH_TRIAGE` 导出常量，gate 与两处 Hook 共用）、§3.1 U15（字面常量锁 gate 输出不变）、§3.4 第三格、§4 R3 |
| CODEX-02 | codex | major | 接受 | 属实：r1 的上限分支在 `pending[0]` 失守时只出失守两句，混合时 N 项从 `systemMessage` 消失，而那一刻 Hook 已放行、这句话是人唯一的提示 | r2 §2.2「阻断上限放行」：B 非空时 N 与 B 都点名；§3.1 U8b；§3.3 M11 |
| CODEX-03 | codex | minor | 接受 | 属实：混合时原指引只指向 N 的第一项，跑过它通过容易被读成可以收工 | r2 §2.2 收工拦截混合一格：原指引句末补「（只针对上列阶段；下列只读失守的阶段另行处置，它们的 gate --check 不会通过）」；§3.1 U6 断言该补句 |
| CODEX-04 | codex | minor | 接受 | 属实：同文件 :701～703 已用 `entryCommandOf(gate.driver, …)`，`registry.ts:503` 取 driver 的写法；本题 Hook 手里正有那份 run.json 的 `driver`（run.v2 必填），没必要沿用提交锚收尾那句「第三家要改这里」的写死债务 | r2 §2.3 逐项段「作废命令按该轮 run.json 的 driver 用 entryCommandOf 生成」；§3.1 U16；§3.3 M13 |
| CODEX-05 | codex | minor | 接受 | 属实：EV-95、EV-191 的部分结案都引用「报告 + 证据目录」，r1 只写了证据目录；补报告就要同批进 `doc/05_testing/README.md` 索引，否则契约测试判红 | r2 §2.4「报告」一条：`REPORT_2026-10-02_breach_gate_wording.md` + `evidence/breach-gate-wording-20261002/` + README 索引 |
| CODEX-06 | codex | minor | 接受 | 属实：真实会话走已安装副本，夹具里的构建证明不了用户会话里会出现新文案。但重装由用户在终端执行、放在提交推送之后是本仓惯例（坑清单「重装」条），本轮不在 verify 前重装；取舍写明，安装副本层面的自证放到复核那一步 | r2 §3.5「真实会话自证的取舍」：复核时在安装副本上跑 §3.4 两格、读数补进报告 |
| CODEX-07 | codex | minor | 接受 | 属实：`cli.ts:1119～1126` 不带 `--run-id` 时走 `latestRunMeta`，闸门那一轮读不出时会退回更旧一轮；直读则出原文案。这一格本身是留痕坏了（EV-148 状态），改去扫更旧的会重新引入 stderr 告警并把上一轮的失守说成这一轮的，所以不改、登记并用例锁住 | r2 §2.1 末段、§4 R4、§3.1 U14（原文案 + 进程级 stderr 零输出）；EV-98 结案说明记一句 |
| CODEX-08 | codex | minor | 接受 | 属实：Hook 已把那份 run.json 读进内存，`snapshot.drift`（`types.ts:1347`）就在里面；直接写出实际取值能少一次人工开文件、减少因判据模糊而误重跑 | r2 §2.3 逐项段「快照漂移」一行（三种形态：未检出 / 检出 K 个文件 / 比对未完成）；§3.1 U12 扩；§3.3 M14 |
| AGY-01 | gemini | minor | 接受 | 属实：r1 样例只有单项，`breachGuidance` 多项时作废命令怎么给没写；pending 是数组，多阶段同时失守合法 | r2 §2.3 逐项段：每个失守项各给自己的 `--topic … --stage …` 作废命令；§3.1 U13 |
| AGY-02 | gemini | minor | 接受 | 属实：混合时 `stderr` 只取首句就只剩「未逐条裁决」，失守真因在 stderr 面隐形；与 GLM-04 同一处 | r2 §2.2 收工拦截混合：`stderr` = 原首句（列 N）+ 换行 + 失守首句；§3.1 U6 断言 `stderr`；§3.3 M12 |
| AGY-03 | gemini | minor | 接受 | 属实：提交 Hook 混合排版有专门规则却无用例；与 GLM-03 同一处 | r2 §3.1 U10b（提交·混合：行序与关闭方式恰一次且最后） |
| AGY-04 | gemini | nit | 接受 | 属实：提交 Hook 原文案除首句外缩进两格，共用函数不带缩进会参差 | r2 §2.3「`breachLines(items, indent)` 带缩进参数」、§2.2 提交 Hook「统一缩进两格（首句除外）」 |
| GLM-01 | glm | major | 接受 | 属实：`latestRunMeta` 的告警经 `util/log.ts` 直写 `process.stderr`，不进 Hook 返回体；只比返回体的「无额外 stderr」是空断言，M2 会无牙 | r2 §3.1 U3 / U11 / U14：用例内临时替换 `process.stderr.write` 收集、`finally` 还原，断言零输出；§3.3 M2 期望改写 |
| GLM-02 | glm | minor | 接受 | 属实：r1 的 U5 让更新的 R2 未失守，`latestRunMeta` 同样读到 R2，对 M2 天然免疫 | r2 §3.1 U5 夹具倒转：字典序更新的 R2 失守、闸门指向更旧且未失守的 R1（手工 setGate）；§3.3 M2 期望 U5 与 U3 都红 |
| GLM-03 | glm | minor | 接受 | 属实：r1「原三行在前、关闭行放最后」自相矛盾——原第三行就是关闭行 | r2 §2.2 提交 Hook：关闭方式恒为最后一行、只出一次；N 非空时只出原前两行；§3.1 U10 / U10b |
| GLM-04 | glm | nit | 接受 | 属实：混合时 `stderr` 取哪句未定义、U6 无 `stderr` 断言；与 AGY-02 同一处，按两真因都出处理（不只取原首句，那会让失守在 stderr 面隐形） | r2 §2.2 收工拦截混合 `stderr`；§3.1 U6 |

## 2. 说明

- **D2（会话开始 Hook 的同类句）**：三侧均未列为意见，gemini 在总判断里提了一句可以登记。按决策四不新登条目，改为在 EV-98 部分结案说明里记一句「会话开始 Hook 的待办句同族、未改」（r2 §1.5、§2.4）。
- **集成用 `write_breach` 不另走 MCP 那一路**：三侧都核了 `write_breach` 桩的先例且未要求补 MCP 那一格，二者走同一 `readonly_breach` 判定面（r2 §3.2）。
- **glm 盲区说明「任务目标被截断」**：本轮任务目标较长，glm 侧任务书里截断，它没见到决策原文，只核了计划转述的自洽性。另两侧见到了全文；决策忠实度以 codex 与 gemini 的核对为准，r2 未因此改动。
