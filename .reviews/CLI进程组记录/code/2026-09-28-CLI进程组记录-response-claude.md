---
schema: trivium.disposition.v1
topic: CLI进程组记录
stage: code
role: claude
kind: response
run_id: 20260928T030117Z
addresses:
  - 2026-09-28-CLI进程组记录-codex.md
  - 2026-09-28-CLI进程组记录-gemini.md
  - 2026-09-28-CLI进程组记录-glm.md
---

# 应答：CLI进程组记录 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260928T030117Z.diff`（相对 HEAD `b6a555b` 的 29 个文件，278.4 KB）
> ｜ 运行：`20260928T030117Z`（约 15 分 39 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm **解析回退**（原文自报 `approve-with-nits`，4 条：次要 2、吹毛求疵 2）
> ｜ 闸门按回退侧的两个待裁决单元校验（GLM-F01 总述句、GLM-F02 内含 4 条意见的 JSON 块）；那 4 条的逐条裁决放在表外 §2
> ｜ 结构化 4 条：接受 3、驳回 1（CODEX-02，前提被本轮变异读数推翻）；glm 原文 4 条全接受
> ｜ 命令 A 不设人工闸门：按接受项修订后重跑读数、写进报告 §7

## 0. 核实记录

- **CODEX-01**：成立。`admitScrub` 的 CLI 分支只 `out.deferred.push(dir)`，`cliGroupsConfirmedGone` 返回的 `why` 被丢弃；`hooks.ts` 会话启动待办的注释与文案写的是「三类（starting / 拿不到 pid / 进程仍活）……多为瞬态」，`cli.ts` 的 `trivium scrub` 人读文案同形。新增的「CLI 组仍活着 / 判不了 / 记录读不懂」一格不在枚举里，其中「读不懂」不自愈。设计 10.5 凭据行的分档枚举同样只有三格。
- **CODEX-02**：**前提不成立**。意见说「即使把 canonical 分支的 env 整个去掉，两次取值都按同一个当下缺省环境计算，照样相等」。实际上 `run()` 在**派生时**把 `process.env` 拷给子进程（`exec.ts` `childEnv = { ...process.env }`），U16 两次取值之间改了 `process.env.TZ` / `LANG` / `LC_ALL`，两个 `ps` 子进程的环境确实不同。本轮变异 M15 正是意见描述的形态（去掉 canonical 的 env），U16 红，文案「规范化的两次应相同（lun. 28 sept. 11:54:36 2026 / Sun Sep 27 22:54:36 2026）」（`mutation-names-output.json`）——两次取值随环境变了。同理，意见担心的「某版 macOS 的 ps 不再吃这组环境变量」一旦发生，U16 的两次规范化取值会不同，U16 自己就红，前提**有**测试构建里的守卫。建议里的「格式断言」只能挡住区域设置那一半，挡不住 TZ 被忽略（C 区域下的格式不随 TZ 变），不增加覆盖。
- **CODEX-03**：成立。`blockAfterMs` 是从派生时刻起算的固定延时，与「取到启动时刻再补写」赛跑；满载下 `ps`（上限 10 s）慢过 3 s 就落进 f′ 格，I4 以前提不成立而红，与 EV-149 / EV-153 同族。
- **CODEX-04**：成立（部分）。形状坏的记录确实没有出口，只能等 `run_dir_days` 整删；告警也不带运行目录与原始值。形状坏只会来自手改或未来版本改了形状——前者人自己知道改了什么，后者是新旧版本混跑的过渡期；为它加一个「放弃记录」的人工档位是新的对外面，超出本主题范围。
- **GLM-F02 内 GLM-01**：成立。`isGone` 写成 `judgeCliGroup(r) !== 'alive'`，入判 `alive` 之后宽限轮询中 `ps` 瞬时失败（组长仍活）会得 `unverifiable` ⇒ 提前判「已不在」、不升级 SIGKILL，随后告警里「组长已退出」与事实不符。入判 `alive` 时启动时刻已相符、身份已确认；轮询中组长仍活着（`kill(0)` 成功）就不可能被复用，此时 `unverifiable` 只意味着 `ps` 这一次没取到，继续按原链升级才是对的。收紧之后，原 M10（只放开第一道门）不再是等价变异——`unverifiable` 的记录进了第二道门也不会被判已不在，会被发信号——要重跑确认它咬住。
- **GLM-F02 内 GLM-02**：成立。环境错配时活 worker 被判「不是同一进程」⇒ `cancelRun` 走「已不存在」分支、按记录对还活着的 CLI 发信号；终态分支的 `workerConfirmedGone` 同理。EV-158 与 LLD 同名行的后果栏没写这条新消费方。
- **GLM-F02 内 GLM-03**：成立。「没有在跑的审查员 CLI 记录」告警的落款是「BACKLOG EV-154」，而 EV-154 本主题已结案。
- **GLM-F02 内 GLM-04**：成立。MANUAL 取消一节的「仍要手工核对」清单漏了「〈侧〉侧审查员 CLI 进程组 N 未能确认退出」。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：新增的一格不进任何枚举，成因说明被丢弃，「读不懂」那一格不自愈却被说成多为瞬态 | `retention.ts` `ScrubTally` 新增 `deferredCli: { dir, detail }[]`（`deferred` 保持 `string[]` 不改契约，CLI 这一格同时进两处，分档仍闭合），`detail` 取 `cliGroupsConfirmedGone` 的 `why`；`hooks.ts` 会话启动待办与 `cli.ts` `trivium scrub` 的人读文案补第四格（逐条带出成因），改掉「多为瞬态」对不自愈那格的误导；`scrub --json` 加 `deferred_cli`；设计 10.5 分档枚举、PROTOCOL `trivium scrub` 行、MANUAL 同步；补用例断言 `deferredCli` 的成因 |
| CODEX-02 | codex | minor | 驳回 | 前提被本轮读数推翻：`run()` 派生时拷贝 `process.env`，U16 两次取值的 `ps` 环境确实不同；M15（正是意见描述的去掉 canonical env）让 U16 红，两次取值为 `lun. 28 sept. …` 与 `Sun Sep 27 …`。ps 若不再吃这组变量，U16 自己就红。格式断言挡不住 TZ 被忽略，不增加覆盖 | 无代码改动。U16 注释补一句「`run()` 派生时拷贝 `process.env`，所以两次 `ps` 的环境不同；M15 读数为证」，免得下一位读者提同样的问题 |
| CODEX-03 | codex | nit | 接受 | 核实成立：固定延时与补写赛跑，满载下会成为同族偶发红 | `stub.ts` `hang_cli` 的 `blockAfterMs` 改为「先轮询本运行 status.json（`<out_dir>/../../status.json`），等全部侧的 `cli.started_at` 非空（至多 10 s），再过 `blockAfterMs` 毫秒堵住」；I4 的 `blockAfterMs` 改为 300、用例里的固定等待相应缩短；桩文档块写明同步点；等不到时仍按时堵住（此时 I4 以 f′ 前提失败、文案不变） |
| CODEX-04 | codex | nit | 接受 | 核实成立（部分）：形状坏的记录没有出口、告警不带定位。取「如实说明出口 + 告警带定位」，不新增人工放弃档位——那是新的对外面，形状坏只来自手改或新旧版本混跑，超出本主题 | `reportRecordedCliGroups` 的形状坏告警带上运行目录与读到的原始值（JSON，截断到 200 字）；`cliGroupsConfirmedGone` 的 `why` 同样带原始值（经 CODEX-01 进人读输出）；MANUAL 与设计「如实保留」写明出口：人工把该侧 `cli` 改回 null，或等 `run_dir_days` 整删 |
| GLM-F01 | glm | — | 接受 | 回退单元是 glm 的总述句：自报 `approve-with-nits`、4 条意见、无 blocker / major。如实收下作为该侧总判断；4 条意见的正文在 GLM-F02 的 JSON 块里，逐条裁决见 §2 | 无单独改动（见 GLM-F02） |
| GLM-F02 | glm | — | 接受 | 回退单元是完整的 `trivium.review.v1` JSON 结论件（解析回退是编排器没能从围栏嵌套里取出它），内含 GLM-01～04 四条意见，逐条核实均成立，全部接受（§2） | 见 §2 四条的落点 |

## 2. GLM-F02 内四条意见的逐条裁决（表外，闸门不按这些编号校验）

- **GLM-01（minor）接受**。理由见 §0。落点：`terminateRecordedCliGroups` 的 `isGone` 收紧为只认 `gone` 与 `reused`（`unverifiable` 继续轮询、宽限尽头按原链升级）；新增可注入的判定函数（仅单测用）与单测「入判 alive、轮询中 ps 失败（unverifiable）⇒ 仍升级 SIGKILL、不提前收手」；新增变异 M19（改回 `!== 'alive'`）；原 M10 重跑，预期由「没红」变「咬住」；报告 §3.1 关于 M10 等价变异的说明随之改写。
- **GLM-02（minor）接受**。纯文档：BACKLOG EV-158 与 LLD 同名行的后果栏补「v1.3.53 起 `--cancel` 的 c 格与终态分支也消费该判据，环境错配时会对活着的 worker 名下的 CLI 发信号（worker 随后看到 CLI 退出、可能重试或写 failed）；修 EV-158 时须一并复核这两处」。
- **GLM-03（nit）接受**。落点：该告警落款改为「设计 7.5『审查员 CLI 进程组记录』」，不再指向已结案的 EV-154。
- **GLM-04（nit）接受**。落点：MANUAL 取消一节的清单补「〈侧〉侧审查员 CLI 进程组 N 未能确认退出」。

## 3. 修改方案（命令 A：应答后直接执行）

1. **代码**：`retention.ts`（`deferredCli`）、`hooks.ts` 与 `cli.ts`（第四格文案、`deferred_cli`）、`status.ts`（`why` 带原始值）、`run-protocol.ts`（`isGone` 收紧、可注入判定、形状坏告警带定位、空记录告警落款）、`stub.ts`（`blockAfterMs` 同步点）。
2. **用例**：U17（GLM-01）；U14 补 `deferredCli` 成因断言（CODEX-01）；U16 注释（CODEX-02）；I4 参数（CODEX-03）。
3. **文档**：设计 10.5 分档枚举与 7.5 如实保留（CODEX-01、CODEX-04）；LLD 已知缺口 EV-158 行（GLM-02）；MANUAL（CODEX-01、CODEX-04、GLM-04）；PROTOCOL `trivium scrub` 行（CODEX-01）；BACKLOG EV-158（GLM-02）。
4. **读数**：修订后重跑全量（文档改前、改后各一次）、源码变异（按修订后代码重生成规格，新增 M19；原规格与读数留 `.r1`；原 M10 预期转为咬住）、失败用例名核对、零配额验收（B3 依赖 `blockAfterMs` 新语义，重跑确认）、`doctor --selftest`；写进报告 §7。
5. **不改**：CODEX-02 驳回（只补注释）；不新增「放弃记录」的人工档位（CODEX-04）。
