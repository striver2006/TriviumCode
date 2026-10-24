# 测试报告 · 预检失败自动校准（EV-251）

- 日期：2026-10-22
- 主题：`预检失败自动校准`（`/dual-run`，A 档；用户原始需求 2026-10-22 第 1 条）
- 计划：`.reviews/预检失败自动校准/plan/2026-10-22-预检失败自动校准-r2-claude.md`（计划三审 run `20261022T120111Z`，第 1/3 轮：codex `reject`、gemini `pass-after-changes`、glm `pass`，计票修改后通过；13 条接受 12、驳回 1）
- 代码三审：run `20261022T131835Z`，第 1/3 轮：codex `reject`、gemini `pass`、glm `pass-after-changes`，计票修改后通过；11 条全接受（应答件 `.reviews/预检失败自动校准/code/2026-10-22-预检失败自动校准-response-claude.md`），见第七节
- 主设计：v1.3.173（§7.3 退出码、§8.1 末段「自动校准」）；BACKLOG EV-251；LLD 3.2；用户手册 §3.4、§5.6、§9.1、§9.2、§10；RUNBOOK 退出码表与 §五；PROTOCOL 退出码与命令表
- 证据：[`evidence/preflight-recalibrate-20261022/`](./evidence/preflight-recalibrate-20261022/)

## 一、改了什么

| 面 | 改动 |
| :--- | :--- |
| `preflight.ts` | 失败项带 `recalibrate`（`{ fixable, targets? }`，没置位的末尾补成不能修）；`recalTargets` 按本轮组合（入选侧 × scope 各阶段的模型、思考等级、厂商 profile）给 doctor 目标；`buildRecalibration` 汇总 `recalibration`（`eligible` 当且仅当退 69、全部可修、清单非空）；头注释与「探针结论存在 / 未过期」报错正文改写 |
| 适配器 `availability()` | 返回值加可选 `fix: 'doctor'`：没探过、没找到入口、读取能力没跑完、路线没有探针结论标可修；实测否定与配置、凭据问题不标 |
| `util/exec.ts` | 段作用域 `withProbeSection`：段内 `run()` 一律自成进程组、记进段级记录（组长退出不删）、计派生次数；按次的中止令牌（置位后段内 `run()` 立即兑现合成结果）；`terminateProbeSectionGroups` 按「组长活着或非僵尸成员数大于 0」逐组结束（代码三审起另判组号复用）。实施中曾把 `bashTimeoutFor` 挪进来共用，终态已撤回 run-protocol 原处、不变（代码审第 2 轮 GLM-03） |
| `doctor-deadline.ts`（新） | 时限控制器（计时器、信号接管、等在写的 checkpoint、兜底出结果、收尾各步限时 `limitStep`）；临时目录台账与补删；doctor 的工具超时 `doctorToolTimeoutMs`（时限加 60 s、至多 960 s） |
| `doctor.ts` | `DoctorOptions.deadline`、各段包进段作用域、中止后作废、收尾抽成只执行一次的 `finalize`、外层与兜底竞速；`DoctorReport.deadline`；`doctorSectionConsumesOverrides`、`doctorRerunCommand` |
| `cli.ts` | `doctor --deadline-s`（30～900）；带时限时不装前台中断转发；到点退 76 并在 stdout 写完后主动结束进程；预检 JSON 输出两层校准字段 |
| `fsx.ts`、两处探针 | 临时目录观察者；codex 隔离探针与 zcode doctor 运行目录的裸 `mkdtemp` 改走 `makeTempDir` |
| 配置 | `preflight.recalibrate_deadline_s`（缺省 900，用户 2026-10-22 定 15 分钟；计划 r2 原定 480）；`config.v2.json` 加该键；doctor 的工具超时单独按 `doctorToolTimeoutMs`（时限加 60 s，封顶 960 s）算，`--wait` 的 `bashTimeoutFor` 不变 |
| skill | 公共片段 `partials/preflight/recalibrate.md`，四条命令的预检步骤引入；16 份入口产物随构建重渲染 |

## 二、用例

**单测 `test/unit/probe-section.test.ts`（新增 5 条，真实进程）**：U1a 组长服从 SIGTERM、后代忽略 ⇒ 升级 SIGKILL 至组内无成员；U1b 组长先退出、后代仍在 ⇒ 照样按组结束；U1b′ 组内无成员不发信号；U5 段内不带 `killTree` 的派生也自成一组；U1c 中止令牌只管同一令牌的段，段外与别的令牌照常。

**单测 `test/unit/preflight-recalibrate.test.ts`（新增 13 条）**：目标展开（不读覆盖的段只给 `--only`；读覆盖的段在 stage all 下两条路线各带自己的模型与思考等级、显式原生带 `--native-codex`；命令行模型覆盖进目标）；探针从未生成、全部过期（未入选的过期家不进清单）、入口不在、归档不可写、预检通过五个场景的逐项与汇总；汇总判据（排序去重、工具超时换算与封顶、混入不能修、退 64、目标为空）；配置键进 invocations；四个适配器十余个分支的 `fix` 标注；只读能力一格的聚合。

**单测 `test/unit/doctor-deadline.test.ts`（新增 7 条，假 agy）**：I2 模型调用挂住、后代忽略 TERM、吐半截 JSON ⇒ 到点结果、无遗留进程组、临时目录与台账已删、预置的旧 agy 结论一字未动、重跑预检仍退 69；I3 不给 `--only` ⇒ 后三段 `not_started`、不被说成「尚无探针实现」；I4 段卡在不经 `run()` 的 await ⇒ 兜底按时出结果（`stuck`）；I6 段内不带 `killTree` 的派生到点也按组结束、正常返回的段同样作废；I9 未到点、模型调用秒败 ⇒ 各段 `notes` 与 `rerun` 齐全；不给时限不带 `deadline` 段；I8 台账补删（形态相符删、临时目录外不删、活进程的台账不碰）。

**集成 `test/integration/doctor-deadline-cli.test.ts`（新增 3 条，真实打包 CLI）**：I1 `--deadline-s` 越界退 64；I7 运行中发 SIGTERM ⇒ 退 76、`reason: signal`、无遗留、临时目录已删；I5 预检 JSON 的 `invocations[*].args` 照抄执行能跑通，重跑预检不再报探针过期。

**对账**：`test/contract/skill-recalibrate.test.ts`（16 份入口产物各一条，加论域一条）；`doctor-unused-overrides` 新增 U3′（读覆盖的段集合与源码对账）。

**既有用例的调整**：`preflight.test` 一条改按新文案断言（旧句「刻意不自动拉起」随本主题改写）；`doctor-unused-overrides` U3 的源码锚点随收尾挪进 `finalize` 改缩进、把 `doctorRerunCommand` 列为例外；`entry-scan-isolation` 登记 I7 自己 spawn 打包产物的理由。

**计划与实现的偏差**：r2 D3 第 4 条写的是进程级「中止派生」标志；实现时第一遍就红在同一进程先后跑几次 doctor 上（前一次到点连累后一次），改为按次的中止令牌，语义不变、不再有进程级全局状态。r2 第三节 I9 写的是「探针内部超时」，用例用的是模型调用秒败——两者走同一条输出路径（段 `finished`、`hit: false`、各段 `notes` 与 `rerun`），没有为造探针内部超时再开注入口。

## 三、变异验证

逐条预跑脚本（`--with-tests` 变体，集成类变异重打 bundle），规格见证据目录。

| # | 变异 | 期望套件 | 失败数 | 变红的用例 |
| :-- | :-- | :-- | :-- | :-- |
| M1 | eligible 改成任一可修 | preflight-recalibrate | 1 | U3 混入不能修 |
| M2 | 中止后返回的段照常落盘 | doctor-deadline | 0 | —（见下） |
| M2r2 | 同上，I6 补断言后重跑 | doctor-deadline | 1 | I6 |
| M3 | 中止后段内仍派生 | probe-section | 1 | U1c |
| M4 | 段内不强制自成进程组 | probe-section | 3 | U1a、U1b、U5 |
| M5 | 组长已退出即判整组不在 | probe-section | 2 | U1a、U1b |
| M6 | 到点不退 76 | doctor-deadline-cli | 1 | I7 |
| M7 | 新鲜度改看全局 `generated_at` | doctor-deadline | 1 | I2 |
| M8 | 没标的失败项缺省补成可修 | preflight-recalibrate | 1 | U2 归档不可写 |
| M9 | 全部过期时目标不按入选侧过滤 | preflight-recalibrate | 1 | U2 全部过期 |
| M10 | 只读能力一格混有不能修仍判可修 | preflight-recalibrate | 1 | U4 聚合 |
| M11 | `--deadline-s` 下限不校验 | doctor-deadline-cli | 1 | I1 |

- M2 首轮没咬住：I2 里探针被打断后是抛出退出的，走 catch 分支；正常返回那一支没有断言。I6 的探针在中止后正常返回 null，补「段状态应为 `in_progress`、不落盘」两条断言后重跑（M2r2）变红。
- 第一次预跑在 M4 处中断：M4 让用例子进程不再自成一组，用例收尾的 `killGroup` 按标记找到的组号就是测试运行器、预跑脚本与外层 shell 所在的组，一发 SIGKILL 连预跑脚本一起结束，它的恢复步骤没跑到，M4 变异留在了 `src/trivium/util/exec.ts`。已手工恢复并逐个核对五个目标文件的锚点（各恰好一处）；`test/helpers/proc.ts` 的 `killGroup` 加了「不对本测试进程所在的组发信号」，另加 `killMarked` 逐个结束落在本组里的带标记进程，新用例的收尾都改用它。重跑时 M4 耗时 605 s（被打断前的挂起用例等满 `--test-timeout`），无遗留进程。
- 没有跑正式装置 `scripts/mutation-check.mjs`（十一条都已按用例名逐条确认变红）。

## 四、全量

第一遍 `npm run check`（前台、单条）：3878 条，3874 通过、2 失败、2 跳过。两条都是登记类护栏：`entry-scan-isolation` U8（I7 自己 spawn 打包产物未登记理由）与 `scratch-guard` G1（I8 两处裸 `mkdtemp`）。前者补登记，后者改为在夹具里按固定名 `mkdir`。其后读数见第六节。

## 五、残余（BACKLOG EV-251）

- 另三家载体的工具超时上限未实测，统一取值靠配置键兜底；实测要在各家载体里起真实会话、花配额。
- 宿主直接 SIGKILL doctor 时子进程组成为孤儿，本次临时目录留到下一次 doctor 启动时补删。
- `config.local.yaml` 的写入不是原子替换，硬杀落在写入中途可能截断，可重探恢复。
- 同步代码堵住事件循环时，时限控制器的计时器得不到执行。
- 不跨命令冷却。
- 真实配额下的端到端验收（会话里让一家探针过期、跑一次 `/dual-review-plan`）未做，需用户同意后再做。
- 组号复用分不出的一格（代码三审 CODEX-01 修后）：本组清空、组号被别人复用、复用者也已退出只剩它的后代——既没有 pid 等于组号的进程、成员数又大于 0，会被当成本组。与 `--cancel` 的 EV-165 同一残余。

## 六、收口读数

- 代码三审之前：`npm run check`（前台、单条）第二遍 3878 条，3876 通过、0 失败、2 跳过。
- 代码三审改码之后：`trivium verify` 通过（`.reviews/预检失败自动校准/verify/2026-10-22-预检失败自动校准-verify.md`）：typecheck、build、`npm test` 全部退 0；3885 条，3883 通过、0 失败、2 跳过。
- 用户定缺省时限 15 分钟之后（缺省 900、上限 900，doctor 工具超时改按 `doctorToolTimeoutMs` 加 60 s、至多 960 s，`--wait` 的 `bashTimeoutFor` 撤回 run-protocol 原处、不变）：`npm run check`（前台、单条）3885 条，3883 通过、0 失败、2 跳过。用户级 `~/.claude/settings.json` 已设 `BASH_MAX_TIMEOUT_MS=960000`。这一改动另送一轮代码三审。
- 真实配额下的端到端验收未做（见第五节）。

## 七、代码三审改码（run `20261022T131835Z`，11 条全接受）

| 意见 | 改动 | 用例 / 变异 |
| :--- | :--- | :--- |
| CODEX-01 组号复用误杀 | 组长已退出后一次 `ps -axo pid=,pgid=,stat=` 取「成员数」与「有没有 pid 等于组号的活进程」；后者为真判复用、不发信号、记进 `reused` 与 `residue`；核对并行 | U1d（注入快照）、U1e（快照解析）；M12 |
| CODEX-02 兜底要等环境段 | 收尾函数与控制器在第一个 await 之前交出；环境段包进段作用域，到点时撤回它的阻断项、不落盘、`residue` 记一句；`sectionPrelude` 也对环境段（传 `env`）生效 | I10 |
| CODEX-03 兜底与收尾不封顶 | 到点即起兜底计时器；等在写的 checkpoint 限时；收尾的等按组结束、末次落盘、台账收尾各按剩余预算限时（每步至少 5 s），控制器在收尾末尾才停 | U6；M13（I4、I10、U6 变红） |
| CODEX-04 ≡ GLM-03 补删只在带时限时做 | `DoctorOptions.ledgerDir` 单列，CLI 每次 doctor 都传；不带时限时残留进 `warnings` | I11；M14 |
| GLM-02 `rerun` 不可照抄 | 前缀改 `.trivium/bin/trivium`（`DOCTOR_RERUN_ENTRY`），预检人读提示行同改 | I2、I5、I9 断言改 |
| GLM-01 段次序常量无对账 | 新增 U3″：源码各段出现次序等于常量、集合等于 `ALL_CLI_NAMES` | U3″ |
| GLM-04 带旗标的调用没经 CLI 执行 | 新增 I12：codex 入选、探针过期，照抄预检给出的带 `--profile-codex` / `--model-codex` 的 args，不退 64，`rerun` 带上同一组旗标 | I12 |
| AGY-01 | `realTmpRoot` 回退分支 `path.resolve` | — |
| AGY-02 ≡ GLM-05 | 派生 0 次的段改说「还没有开始、没有花配额」 | I3 补断言 |

变异 M12～M14 读数见 `mutation-names-r3-output.json` / `mutation-names-r3-log.txt`，三条全部变红、源码逐字节恢复。

## 八、代码审第 2 轮（缺省时限改 15 分钟，run `20261022T140408Z`，4 条全接受）

`/dual-review-code` 由用户发起，第 1/3 轮：codex `reject`、gemini `pass`（零意见）、glm `pass-after-changes`，计票修改后通过（应答件 `.reviews/预检失败自动校准/code/2026-10-22-预检失败自动校准-r2-response-claude.md`），用户审批通过。

| 意见 | 改动 | 用例 / 变异 |
| :--- | :--- | :--- |
| CODEX-01 正常收尾途中收到信号仍按旧预算等 | 收尾各步改走 `DeadlineController.limitStep`：与兜底竞速，兜底一触发正在等的那一步当即放弃，之后各步只给下限；`deadline.stuck` 按兜底是否触发判 | U7；M15（U7 变红，`mutation-names-r4-*`） |
| GLM-01 | BACKLOG EV-251 的「（30～540）」改「（30～900）」 | — |
| GLM-02 取值范围两份字面量无对账 | 新增 U3‴：schema 的 minimum / maximum 等于 `DEADLINE_MIN_S` / `DEADLINE_MAX_S`，缺省值在范围内 | U3‴ |
| GLM-03 | 第一节 `util/exec.ts` 与 `doctor-deadline.ts` 两行改为终态表述 | — |

改码后 `npm run check`（前台、单条）：3887 条，3885 通过、0 失败、2 跳过。

## 九、真实配额验收（2026-10-23，提交 `62c5897d` 重装之后）

夹具 `~/Work/trivium-ev251-accept`：`init` 后照搬本仓本机层的 `probe.cli` / `probe.host` / `generated_at`（不拷 `auth` / `auth_routes`，零配额），把 zcode 的记录版本改成 `0.0.0-ev251-drift` 制造版本漂移；零配额干跑预检确认判退 69、只点名 zcode。随后用户在夹具里新开 Claude Code 会话（`BASH_MAX_TIMEOUT_MS=960000` 已生效）敲 `/dual-review-plan --topic 自动校准验收 '…'`。读数见 [`evidence/preflight-recalibrate-20261022/accept-20261023/`](./evidence/preflight-recalibrate-20261022/accept-20261023/)。

**编排器侧，全部符合预期：**

- 第一次预检退 69，两项可修的版本漂移：除造的 zcode 外，agy 在干跑与真实运行之间自升级（1.4.5 → 1.4.6），真实撞上了需求所指的那一类失败。两项都标 `fixable: true`，`recalibration.invocations` 按 `ALL_CLI_NAMES` 次序给出 agy、zcode 两条，`deadline_s: 900`、`bash_timeout_ms: 960000`。
- skill 照抄两条调用，前台执行，Bash 工具超时 960000、未用后台、未拆两步。`doctor --only agy` 57 s 退 0（17 次派生），`doctor --only zcode` 84 s 退 0（25 次派生）；两次 `deadline.hit: false`、各段 `finished`、`residue` 为空，`rerun` 是 `.trivium/bin/trivium doctor --only 〈家〉`。
- 用相同旗标重跑预检退 0，接着照常发起三家计划审查（run `20261023T045024Z`，第 1/3 轮：1 通过 / 2 修改后通过 → 修改后通过）；用户随后 `/dual-abandon` 放弃验收主题。
- 盘上：夹具的 agy / zcode 版本已刷回 1.4.6 / 0.17.0，`probed_at` 为本次时间；`run_root` 下台账 0 个；本次时段新建的 `trivium-*` 临时目录 0 个；没有残留的 doctor 或探针进程。
- zcode 的 doctor 带 1 条警告「旗标本轮未判定（3 个候选在参数解析前就退出，P-29）」，`readonly_flags` 沿用照搬来的上一次结论——是夹具的 ZCode 安装布局 / provider 配置定位问题（EV-196 / P-29 的既有形态），与本主题无关。

**skill 侧，有三处没有照规定做（会话里的模型没遵循，不是编排器的问题）：**

1. 跑 doctor 之前没有发「预检退 69，以下失败项可由 doctor 重新校准……会消耗少量配额」那一行（04:46:58 预检返回，04:47:01 直接拉起 doctor，其间无文本）；
2. 第二次预检通过后没有当即说「预检首次退 69，已自动校准后通过」，到收尾总结里才提；
3. 第二条 doctor 第一次调用时擅自加了输出重定向，被 Hook 拦下（两次）后改回照抄的原样。

每家 doctor 结束后的那一行播报都发了。三处都不影响结果，但第 1 条恰是「不向用户确认」时用户唯一的事前知情点。

已登记 BACKLOG EV-252 处理（主题 `自动校准播报与照抄`，报告 [`REPORT_2026-10-23_recalibrate_announce.md`](./REPORT_2026-10-23_recalibrate_announce.md)）。
