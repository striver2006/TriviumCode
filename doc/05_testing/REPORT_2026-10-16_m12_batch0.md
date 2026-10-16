# M12 批次 0：零配额收口（EV-193 / EV-230 / EV-231 / EV-236 流程规矩）

- **日期**：2026-10-16
- **执笔**：Claude Code
- **上位计划**：[`doc/08_project/M11后续-开发计划-草案.md`](../08_project/M11后续-开发计划-草案.md)，用户当日答复「按照你的建议做」，D-1～D-16 全按推荐
- **分档**：B 档（只改测试与文档），未走双审；提交前由执笔方自审补丁，全量串行两次
- **厂商配额**：0。只跑了零配额的 `--version`；未发起审查、预检或 doctor

## 1. 范围

| 项 | 处置 | 落点 |
| :--- | :--- | :--- |
| EV-193 gate-loop I6 偶发红 | 诊断出根因并修测试采样（§2） | `test/helpers/proc.ts`、`test/integration/gate-loop.test.ts`、`test/integration/foreground-interrupt.test.ts`、新增 `test/unit/proc-helpers.test.ts` |
| EV-230 | 已失效，关闭：`overrideReasonFor` 已在 `b04cc302` 删除 | BACKLOG |
| EV-231 | 用户选 B：不补实现，删承诺 | 主设计 16.2 纪律 5、18.1 #15、R24（v1.3.160） |
| EV-236 | 成因查清；流程规矩 P 落地；代码 A2 排批次 5 | BACKLOG、`RUNBOOK_pipeline_ops.md`「六、留痕相关」 |
| M12 立项 | 主设计 16.1 登记 M12 行与依赖链（名称为执笔方暂定） | 主设计 v1.3.160 |
| 其余决定 | EV-225 / 227 / 228 / 238 / 239 / 240 的拍板结论记入各自条目；五组合判据新登 EV-241 | BACKLOG |

## 2. EV-193：根因是测试采样竞态，产品记录无误

**现象**：`gate-loop.test.ts` 的 `EV-154 I6` 两次偶发红（2026-10-02、10-16），断言「status.json 两侧的记录应正是这两组」，10-16 读数为期望 `[13815, 13886]`、实得 `[13886, 13889]`。

**根因**：`startWithRecordedClis` 用 `groupsWithMark` 采样，凑满两组就停止，之后另行等待 status.json 记全。`ps` 的组号与命令行不是同一时刻取的：detached 子进程在 `setsid` 之前沿用父进程的组号，采样落在这个窗口、读命令行时它已 exec 成带标记的 `sh`，就出现一行「带标记、组号却是派生方的组」。派生方是 detached 的 worker（组号即 worker pid），所以误采到的是 worker 的组；多出来的 13815 早于两个 sh，与此吻合。status.json 由 worker 在派生当时按 `child.pid` 记下、不经 `ps`，记录是对的。

**实验**：[`evidence/ev193-pgid-race-20261016/`](./evidence/ev193-pgid-race-20261016/)。一个进程每 5 ms detached 派生带标记的 `sh`，另一个进程同时不停跑 `ps`；存档三轮共约 2.6 万次派生，错配行 2 次，带派生方组号记录的那一轮里错配行的 pgid 正是派生方所在的组（26493）。

**修法（只改测试）**：

- `test/helpers/proc.ts` 新增 `leaderGroupsWithMark`：只认 pid===pgid 的带标记进程。桩 CLI 由 `run()` 以 killTree（detached）拉起，带标记的 `sh` 必是组长，过滤不丢真组。
- 「凑满 N 组、再断言这几组」的采样判据换成它：`gate-loop.test.ts` 两处（`cancelReachesCli`、`startWithRecordedClis`）、`foreground-interrupt.test.ts` 一处。收尾清理仍用宽口径 `groupsWithMark`，只作前提的 `>= 2` 判断（gate-loop 锁等待处）不动。
- 新增 `test/unit/proc-helpers.test.ts` 两格：detached 组长两种口径都收；不 detached 派生的带标记 `sh`（沿用测试进程组号，形态同竞态窗口那一行）宽口径收、只认组长的不收。竞态本身窗口太窄，不能当确定性用例，所以用这个形态钉住过滤口径。

**升级条件没有触发**：诊断表明产品侧记录无误，维持 B 档。

**读数**：

- gate-loop 与 foreground-interrupt 两个文件单跑 114/114。
- I6 单跑循环 30 次：30 通过、0 失败。
- 手工变异：去掉 `leaderGroupsWithMark` 的组长过滤，新单测第二格变红（1 通过 / 1 失败）；源文件按 sha256 逐字节恢复后 2/2。

## 3. EV-236：成因

统计脚本只输出键名、字节数与路径，不输出内容。最大一份 `request.json`（run `20261011T212239Z`，148.8 MB）里 `snapshots` 占 145.4 MB：同一份 `frozenDiffText` 按侧存了三遍（各约 48.5 MB）。diff 本体 45.7 MB / 2140 个文件，前十个目录全是当时未提交的 `doc/05_testing/evidence/agent-access-20261011-closeout-r*`，最大的单文件是约 0.7 MB 的诊断 JSON 与约 0.57 MB 的历次送审任务书原件。原件里带着上一轮的 diff，又被下一轮送审，逐轮滚大。另有 `denyPaths` 4358 条（每侧约 0.5 MB）。

本批只落流程规矩：code 阶段送审前，大证据先提交或放仓库外，送审任务书原件不拷进仓库内证据目录（RUNBOOK「六、留痕相关」新增一节，清扫输出表「仍有文件未扫描」一行补成因指引）。`request.json` 去重（A2）排 M12 批次 5；7 个旧运行目录等 `retention.run_dir_days` 自动清理。

## 4. EV-231：文档改动面

主设计三处改为按现状描述：预检点名该补的文件与 `[model_providers.〈名〉]` 段，不输出配置样例。12.1 那一行已于 v1.3.139 改过。演进设计（`2026-09-13-通用Agent编排与动态多审设计.md`）里同义的三处（:123、:646、:732）**没有改**：它的文档头写明自 v1.0.0 冻结、正文不随条款并入而修改、冲突以主设计为准。执笔时曾误改，发现后已恢复原样。

## 5. 记下但本批不处理

- **五组合例外绑定的 CLI 版本已过期**：10-12 批准的受限准入例外绑定 Claude CLI 2.1.296，本机现为 2.1.301。按用户 D-3，判据定稿前 Qwen max 继续作 claude 侧 pro/high 路线，本报告在此如实标注「例外待重取」；重取在 M12 批次 2（BACKLOG EV-241）。
- **agy 版本漂移**：本机 agy 1.4.0，本仓探针记录 1.3.6。批次 1 发起真实审查前需要定向刷新（`doctor --only agy`）。
- **M11 遗留的 agy hub 文档**：按用户 D-14 维持现状（10-12、10-16 实测 hub 都带 `--add-dir=<项目根>`），不按 10-08 的旧决定改写。

## 6. 全量检查

`npm run check` 串行两次，均为 tests 3626 / pass 3624 / fail 0 / skipped 2，退出码 0。比 M11 收口时的 3624 多出的 2 格是新增的 `proc-helpers.test.ts`。两遍都没有出现 I6 或其他偶发红。
