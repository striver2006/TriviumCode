---
schema: trivium.disposition.v1
topic: 预检失败自动校准
stage: plan
role: claude
kind: revised
run_id: 20261022T120111Z
addresses:
  - 2026-10-22-预检失败自动校准-codex.md
  - 2026-10-22-预检失败自动校准-gemini.md
  - 2026-10-22-预检失败自动校准-glm.md
---

# 裁决：预检失败自动校准 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-22-预检失败自动校准-claude.md`（r1，基线 `18e6ca38`）。
> 评审循环第 1/3 轮：codex `reject`（5 major、1 minor），gemini `pass-after-changes`（3 major、2 minor），glm `pass`（2 minor）。计票 1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过。
> 13 条：接受 12、驳回 1。合入后的计划见 `plan/2026-10-22-预检失败自动校准-r2-claude.md`。
> 裁决前核过的依据：`src/trivium/util/exec.ts:292-300`（组长 exit 即从 `liveTrees` 删除）与 `:964-979`（只遍历组长未退出的组）；`src/trivium/util/git.ts:25-48`（缺省 120 s，只有显式传超时才 `killTree`）；`probes/agy.ts:241-245`、`probes/zcode.ts:335-339`（`probeScratchPaths` 不传预算）；`doctor.ts:836-838`、`:879`（codex / claude 段固定按 code 阶段解析）；`preflight.ts:174-183`（「全部过期」才失败，所以失败时入选家必在过期之列）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 成立：`liveTrees` 在组长 exit 时删条目，`shutdownTrackedTrees` 只对组长未退出的组发信号、按父进程句柄判结束。组长服从 SIGTERM 而后代忽略、或组长在到点前已退出而后代还在时，拆出来复用都会留下后代——正是「不留孤儿」要防的形态。`--cancel` 按记录结束 CLI 时已有「组长已退出但组号下还有非僵尸成员也发信号」的判据（EV-165，设计 7.x `--cancel` 行），可直接沿用：组内还有成员时组号不会被复用 | r2 D3 第 2 条改写：doctor 段内的每个派生都记进**段级进程组记录**（组长退出也不删）；到点按组结束时，组长活着、或组长已退出但非僵尸成员数大于 0 都发信号，SIGKILL 之后按成员数为 0 确认；成员计数的 `ps` 在段作用域之外跑，不受「中止派生」拦截。第三节 U1 拆成 U1a（组长服从、后代忽略）与 U1b（到点前组长已退出、后代仍在） |
| CODEX-02 | codex | major | 接受 | 成立：`probeScratchPaths` 调 `workTreeHash` / `diffTrees` / `statusPorcelain` 不传预算，走缺省 120 s、不进进程组，「到点后不再派生」管不住已经在跑的那一次，r1 「夹具建仓的 git 都有 30 s 超时」的说法把这类收尾调用漏了。逐个改调用点会再漏，改成按作用域兜：段作用域内派生的**一切**子进程都强制自成一组并登记 | r2 D3 第 3 条改写：废掉 r1「9 处补 `killTree`」的逐点修法，改为 `exec.ts` 的段作用域（`AsyncLocalStorage`）内 `run()` 一律按 `killTree` 派生、登记、计数；git 辅助调用随之进覆盖面。兜底退出用 `process.exit`（不只置 `exitCode`）。第三节新增 I6（到点恰撞上收尾 git，用 `test/helpers/fake-git.ts` 挂住）；U5 改为「段作用域内不带 `killTree` 的 `run()` 也进登记」 |
| CODEX-03 | codex | major | 接受 | 处置与清理部分成立：宿主先发 SIGTERM 时，现行 `installForegroundInterruptForwarding` 走冻结式 `shutdownTrackedTrees`、探针 `finally` 不跑，凭据副本目录留下——这一支不能只登记待办。实测四家载体工具时限这一部分**本主题不做**：要在四家载体里各起一次真实会话（花配额），且 `--wait` 现行同样依赖未实测的载体时限；改以可配置的时限（见 AGY-05）作逃生口，实测登记进 BACKLOG。宿主直接 SIGKILL 时进程内什么都做不了，由下面的落盘台账在下一次 doctor 启动时补删 | r2 D3 新增第 6 条：带时限的 doctor 不装前台中断转发，由时限控制器接 SIGINT / SIGTERM，首个信号即按「到点」处置（协作式中止、按组结束、等收尾、出结果），第二个信号立即退出；新增第 7 条：段内建的临时目录（只认 `makeTempDir` 的返回值）同步记进 `<run_root>/doctor-temp-ledger.json`，删成功即注销，下一次 doctor 启动时把台账里仍在盘上的条目删掉。D5 改写：统一缺省值 + 配置键可调；载体时限实测登记 BACKLOG。第三节新增 I7（SIGTERM 走协作路径）、I8（台账补删） |
| CODEX-04 | codex | major | 接受 | 成立：「探针结论存在 / 全部过期」两项会把后面的路线检查短路掉，r1 只给 `--only`，选了非缺省路线时 doctor 按缺省路线刷新，第二次预检才露出原路线仍缺，一轮上限下就停了 | r2 D1 / D2：凡可校准的失败项，目标一律从**本次预检已解析的组合**展开——入选侧 × 本次 scope 的各阶段，经 `resolveTier` 得到（模型、思考等级、厂商 profile），按侧去重；有路线概念的侧（适配器实现 `probeFor`）带 `--profile-<id>` 或显式 `--native-<id>`。第三节 U2 补「全部过期 + 非缺省 profile」「stage all 含两条路线」 |
| CODEX-05 | codex | major | 接受 | 成立：doctor 的 codex / claude 段固定按 code 阶段解析模型（`doctor.ts:838`、`:879`），只传路线旗标时，plan 阶段换了家族的路线会被发 code 阶段的模型，探的不是本轮要用的组合，还可能把错组合写成该路线的结论 | r2 D2：调用参数带全组合——路线旗标之外，消费覆盖的侧再带 `--model-<id>` 与 `--effort-<id>`（doctor 已接受这两个旗标）；不消费覆盖的侧（探测用固定口径）只带 `--only`，免得 doctor 末尾报「覆盖没用上」。终端重跑命令同样带全。第三节 U2 补「plan / code 不同家族模型」「命令行模型覆盖」两格，I5 照抄执行 |
| CODEX-06 | codex | minor | 接受 | 成立：D7 说两种超时形态都给终端重跑指引，D4 的转述清单却只有 `deadline.unfinished` 里的 `rerun`，单次探针超时（未撞总时限）那一支没有落点 | r2 D3 输出：给了 `--deadline-s` 时 doctor 的 JSON 带 `sections`，**每一段**（不只未探完的）都有 `state`、本段 `notes` 与 `rerun`；D4 第 3 条的转述改为：第二次预检仍失败时，对每次 doctor 调用转述其 blockers、warnings、各段 `notes` 与 `rerun`。第三节新增 I9（`deadline.hit: false`、探针内部超时） |
| AGY-01 | gemini | major | 接受 | 方向成立：`run()` 本身不抛（`exec.ts` 注释与实现），但被杀的调用让探针读到截断输出，解析路径上是否处处兜住没有逐一核过；任何一处抛出，`runDoctor` 就以退 1 收场、丢掉 `deadline` 输出 | r2 D3 第 4 条：段包装在中止标志已置位时**接住该段抛出的任何异常**，记为未探完（`state: in_progress`），不重抛；未置位时照旧（夹具失败归 `guardFixture`，其余原样重抛）。第三节 I2 的假 CLI 被杀时吐半截 JSON |
| AGY-02 | gemini | major | 接受 | 成立：r1 写的「至多等 20 s」若放在 `runDoctor` 的 await 链里，挂住的 Promise 永远轮不到它。须写明兜底由独立的计时器路径执行，不依赖段的 await 返回；同步代码堵住事件循环的情形任何计时器都打断不了，如实写进边界 | r2 D3 第 5 条：时限控制器是与 `runDoctor` 并行的独立路径，到点后的收尾（按组结束、等在写的 checkpoint、等段退出、出结果、退出进程）全在控制器里；`runDoctor` 先返回就由它出结果，否则控制器按自己记的段状态出结果并 `process.exit`。事件循环被同步代码堵住时不保证，写进第五节边界 |
| AGY-03 | gemini | major | 驳回 | 依据不成立：「探针结论未过期」只在**全部**登记 CLI 都过期时失败（`preflight.ts:174-183`，部分过期判通过），失败即意味着入选各家也在过期之列；r1 D1 表格该行的目标已写「入选且在 `staleCliProbes` 里的那几家」，未入选的过期家不会进调用清单。检查本身是否改成按入选侧判，是另一件事（会改变现行通过条件），不在本主题范围 | r2 D1 该行补一句判据说明（「失败即入选各家必在过期之列；目标只取入选侧」），并在第三节 U2 加一格断言：未入选的过期家不进 `invocations` |
| AGY-04 | gemini | minor | 接受 | 成立：「只读能力可用」把各侧问题合成一项，r1 没规定多侧混合时 `fixable` 怎么算 | r2 D1：不拆检查项（拆了会改检查名、波及既有输出与用例）；该项内部按侧收集，`fixable` 为真当且仅当每个不可用侧都标了 `fix: 'doctor'`，目标为这些侧；任一侧不可修整项即不可修。第三节 U4 补「一侧可修、一侧失守」格 |
| AGY-05 | gemini | minor | 接受 | 成立，且与 CODEX-03 的处置合流：没有实测登记时，统一缺省值之外须有逃生口 | r2 D5：新增配置键 `preflight.recalibrate_deadline_s`（缺省 480，取值 30～540），`bash_timeout_ms` 由它按 `min(600000, s×1000+60000)` 推出；schema、`config-consumers` 对账、手册 §5 同步。第三节 U3 补换算格 |
| GLM-01 | glm | minor | 接受 | 成立：硬杀残余的后果只写了孤儿进程，漏了凭据副本目录与 `config.local.yaml` 非原子写截断两件 | r2 D3 第 7 条的落盘台账补上凭据副本目录这一件（下一次 doctor 启动时补删；按前缀扫系统临时目录的做法不采纳，违反「只删 mkdtemp 返回值」的 R1）；`config.local.yaml` 非原子写（`config.ts:934`）登记进 BACKLOG EV-251 残余，与孤儿进程、载体时限并列，本主题不改写入方式。第五节边界列全 |
| GLM-02 | glm | minor | 接受 | 成立：「作废段不落盘、收尾仍刷新 `generated_at`」的安全性依赖 `cliProbeIsFresh` 按各家 `probed_at` 判定（`config.ts:995` 起；glm 原文引作 991-997），r1 没点名也没有用例咬住它的下游表现 | r2 D3 第 4 条点名这条不变量；第三节 I2 补断言：到点后用相同旗标重跑预检仍退 69、失败项点名被作废那一家；变异清单加「新鲜度改看全局 `generated_at`」一格 |
