# header探测计时器收尾 · 实施报告（EV-205）

> - **日期**：2026-10-05
> - **主题**：`header探测计时器收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`b5f52ca`（`main`，工作树干净）
> - **入选审核者**：codex、gemini、glm
> - **计划**：`.reviews/header探测计时器收尾/plan/` r2（计划双审第 1 轮 run `20261005T113659Z`：gemini `approve`，codex、glm `approve-with-nits`，6 条全接受，两家三对同指）
> - **代码双审**：run `20261005T120550Z`（11m45s，三侧到齐，本报告随被审 diff 一起送审）：gemini `approve`（零意见），codex `approve-with-nits`（吹毛求疵 1），glm `approve-with-nits`（次要 1），2 条同指、全接受——`stopEarly` 文档块「必然兑现」补上「给了 `timeoutMs`」的前提（CODEX-01 ≡ GLM-01），只改文档，实现与用例不动
> - **证据目录**：`doc/05_testing/evidence/codex-header-poll-20261005/`
> - **配额**：全程零配额：假 codex 是脚本文件、直接作为入口传入，不经 `PATH`，不跑任何真实 CLI

## 1. 问题

`probeCodexHeader`（`src/trivium/probes/codex.ts`）在 `run()` 的 `stopEarly` 回调里挂 50 ms 轮询，只在见到 header（五个标签齐或分隔线）时清掉，另有一个 `unref` 过的 31 s 兜底去清它，轮询本身没有 `unref`。`run()` 在子进程自然退出时不通知调用方，所以 codex 不打 header 就退出（版本变了、参数被拒、凭据坏了）时，探针已返回、轮询还要空转到 31 s 兜底，事件循环不空；CLI 收尾只设 `process.exitCode`、靠事件循环排空退出，doctor 就多挂这么久。`probeCodex` 五处调用里「不存在的档位」「伪造的思考档位」等设计上就可能走这条路；本机 codex 0.160 两项都不拒，眼下碰不到。

## 2. 改了什么

1. **修在调用方**（决策一）：`probeCodexHeader` 把 `run` 的调用包进 `try/finally`，`run` 返回或抛出后一律 `clearInterval`；句柄用对象 `poll.timer` 持有（回调里赋值的 `let` 在 `finally` 里会被收窄成初值）。31 s 兜底删去；轮询回调里见到 header 时那次 `clearInterval` 保留（不必等 `run` 兑现就停轮询）。函数体注释改写为「兜底是 `run` 自己的 30 s 超时」。返回值组装与判据逐字不变。
2. **契约只补文档**（决策二）：`run()` 一行不改；`RunOptions.stopEarly` 文档块补一段——`run` 不在子进程自然退出、超时或启动失败时通知回调方，回调里挂的计时器由调用方在 `run` 返回后清理；给了 `timeoutMs` 时，除终止中外 `run` 必然兑现、不会 reject（不给超时、子进程挂住时同样不兑现，所以挂计时器就必须给超时；代码双审 CODEX-01 ≡ GLM-01），终止中（`shutdownTrackedTrees` 置位后）永不兑现、`finally` 不跑（计划双审 CODEX-01 ≡ GLM-02）。
3. **EV-199 假 codex**：最小 header 的写出不动，只把注释改成它现在的作用（走与真实 codex 同形的早退路径），并注明 EV-205 起不打 header 也不再多等。
4. **新单测** `test/unit/codex-header-drain.test.ts`（H1～H5，见 §4）。
5. **文档**：设计 v1.3.93；BACKLOG EV-205 结案。

BACKLOG 登记时给的两条修法方向都没取：轮询 `unref` 只是不再拖住退出，轮询照旧空转（doctor 后续探针期间事件循环本就不空）；给 `stopEarly` 加收尾钩子是为全仓唯一调用方造契约层抽象。

## 3. 与计划的出入

1. **自检命令**：计划 r1 写的 `trivium selftest` 不存在，r2 已按计划双审 CODEX-03 ≡ GLM-03 改为仓库 bundle 上的 `doctor --selftest`；照 r2 执行，无出入。
2. **补了一份不设上限的排空实测**（计划外）：`drain-time.mjs` 在新旧构建上各跑一次「不打 header、退 2」，量调用返回到进程退出的实际时长，给 §1 的「至多 31 s」一个实测值（旧 30 647 ms、新 2 ms）。用例本身有 10 s 上限，量不出旧行为的实际值。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新单测 `codex-header-drain.test.ts` | 5/5：H1 不打 header 退 2、H2 不打 header 退 0、H3 入口不存在（启动失败）、H4 五标签齐早退、H5 只见分隔线早退；返回后排空 2～4 ms | 全量内含 |
| 改前对照（`b5f52ca` 源码树就地构建、叠加新测试文件） | H1～H3 红在「调用返回后 10 秒子进程仍未退出」，H4 / H5 绿（字段与改后逐字相同） | `before-fix.sh`、`before-fix-output.txt` |
| 不设上限的排空实测（不打 header、退 2） | 旧构建：调用 435 ms，返回后排空 30 647 ms；新构建：调用 858 ms，返回后排空 2 ms | `drain-time.mjs`、`drain-time-output.txt` |
| 变异逐条预跑（带 `--test-timeout`，记失败用例名） | 4/4 红在预期的格：M1 H1～H3、M2 H1～H3、M3 H4 / H5、M4 H5 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 `scripts/mutation-check.mjs` | 4/4 咬住（fail 3 / 3 / 2 / 1），基线全绿，`src/` 逐字节恢复 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| EV-199 `probe-fixture-cleanup` | 全绿 | 全量内含 |
| 代码双审前全量 `npm run check` | 2831 / 2829 / 0 / 2，退 0（较起点多出新增的 5 格） | `check-1-pre-s6.txt` |
| 代码双审前系统临时目录新建条目（自基线 11:36:53Z 起，含编码、改前对照、变异、全量） | 1（`trivium-index-`，产品代码进程被杀时的已知残留，EV-204 残余五）；除它外为 0 | `count-new-check-1-pre-s6.txt` |
| S9 后新单测单跑 | 5/5，返回后排空 1～7 ms | — |
| S9 后全量 `npm run check` 两次（串行） | 两次均 2831 / 2829 / 0 / 2，退 0 | `check-1.txt`、`check-2.txt` |
| S9 后 `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| S9 后系统临时目录新建条目 | 自基线至全量 1 结束累计 3、全量 2 期间 2（均为 `trivium-index-`）；自检期间 0。除 `trivium-index-` 外为 0 | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-selftest.txt` |
| S10 `trivium verify` | 通过（run `20261005T123048Z`：typecheck、build、test 三条，376s）；期间临时目录新建 2（均为 `trivium-index-`），除它外为 0 | `.reviews/header探测计时器收尾/verify/`、`count-new-verify.txt` |

变异表：

| 编号 | 变异 | 红的格 |
| :--- | :--- | :--- |
| M1 | 删掉 `finally` 里的清理，恢复 31 s 兜底（恢复只靠兜底） | H1、H2、H3 |
| M2 | 删掉 `finally` 里的清理、不恢复兜底 | H1、H2、H3 |
| M3 | 轮询见到 header 后不调 `stop()`（不早退） | H4、H5 |
| M4 | 早退判据去掉分隔线一支 | H5 |

回调内那次 `clearInterval` 删掉是等价变异（`finally` 照样清），不列入。

## 5. 边界

1. **终止冻结**：worker 收到 SIGTERM 后 `run` 永不兑现、`finally` 不跑；进程随即退出，doctor 与前台 CLI 不进入该状态，不处理。
2. **超时链路**：codex 挂住既不打 header 也不退出时，要到 `run` 的 30 s 超时（加至多 5 s 宽限）才兑现，这段时间轮询照常转——是探测本身还没结束，不是漏清。用例不覆盖（要等 30 s），由代码结构保证。
3. **生效时点**：`src/` 已改，要用户重装后才对全局安装副本生效（`.trivium/bin` 指向它）。
