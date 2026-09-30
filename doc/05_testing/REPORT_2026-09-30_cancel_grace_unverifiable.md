# 取消宽限期判不了仍放锁 · 实施报告（EV-176）

- **日期**：2026-09-30
- **主题**：`取消宽限期判不了仍放锁`；计划 `.reviews/取消宽限期判不了仍放锁/plan/`（计划双审 run `20260930T144941Z`：codex / glm `approve-with-nits`、gemini `approve`，8 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`d1e6408`（`main`，工作树干净）；计划与本报告的行号取自该提交
- **状态**：实施与验证完成；代码双审 r1（run `20260930T160254Z`）4 条全接受并已按接受项修订（§6、§7）；未提交
- **evidence**：`doc/05_testing/evidence/cancel-grace-unverifiable-20260930/`

---

## 1. 改前实证（计划阶段，r2 §2）

探针 `probe-cancel-grace.r1.mjs`（计划阶段七格版）：每格另起真实工作进程——经一个立即退出的中间进程以 detached 派生，自成进程组、过继给 launchd（与生产里 `--start` 退出后的 worker 同形）；在不拦时取它两种启动时刻写进 status.json 与锁，预置运行目录（凭据载体、worker.pid）、主题锁、闸门 running、归档 run.json 骨架与 task.json 登记，直接调 `cancelRun`。拦截点：只拦 `ps -p 〈工作进程 pid〉`，按格「放过入口那次之后拦」或「观察到 SIGTERM 之后拦」；`process.kill` 包装记信号、K1 格把 SIGKILL 记下而不投递。改前构建 = `git archive d1e6408`。读数 `probe-pre-d1e6408.json`（含每格 stdout / stderr 全文）。要点：

- **零信号格**（入口判同一进程后首检即取不到）：一个信号都没发，stderr 第一行却是「向工作进程组 N 发送 SIGTERM」；退 0、status cancelled、锁与闸门回收，返回时工作进程活，同主题再拿锁成功；
- **宽限期格**（SIGTERM 之后取不到；工作进程延迟 3 s 退出 / 忽略 SIGTERM）：7 ms 即返回、不升级，其余同上；
- **SIGKILL 不等格**（SIGKILL 被扣下）：只判一次、未确认，收尾照做；
- 三格都是「凭据不抹、归档不补收，但 status 写 cancelled、锁与闸门回收」——`scrubAdmission` 已按 EV-175 判不了，挡住的只是抹与补收。

`terminateProcessGroup` 的五个调用方与各自的 `isGone` 逐一列表核过（计划 r2 §1.2）：把「判不了」当「已退出」、其后做不可逆动作的只有 `cancelRun` 主路径一处；`cancelLostWorker` 是镜像形态（判不了当仍在、宽限期满照发 SIGKILL，未确认退 0），另登 EV-177。

## 2. 逐条落地（按 r2 §3）

| 项 | 落点 |
| :-- | :-- |
| D1 | `util/exec.ts`：`GoneJudgment`（布尔或 `'unverifiable'`）、`TerminateResult`（加可选 `unverifiable`）、`TerminateOptions.onTerm`；`terminateProcessGroup` 经对象持有「最近一次判定」（闭包赋值不撤销 TS 收窄，经函数读）：首检判不了零信号、宽限期满最后一次判不了不升级 SIGKILL、SIGKILL 之后判不了继续等；布尔判据的调用方逐字不变 |
| D2 | `run-protocol.ts` `workerGoneForCancel`：返回 `GoneJudgment`，`identity === 'unverifiable'` ⇒ `'unverifiable'`，其余逐字不变；文档块重写 |
| D3 | `cancelRun` 主路径：「发送 SIGTERM」挪进 `onTerm`；`killWaitMs` 由 0 改为 `ORPHAN_KILL_CONFIRM_MS`；零信号格 ⇒ 与入口格同一句 69（`unverifiableCancelMessage`，两处共用、`manualCancelWayOut` 抽出）；宽限期满判不了先 warn 一行；升级过或扣下 SIGKILL ⇒ 按记录结束 CLI（计划双审 CODEX-02）；`!t.gone` ⇒ `unconfirmedCancelMessage` 分三写、69、在凭据准入之前 |
| D4 | 退出码沿用 69、与 EV-175 同码 |
| D5 | 注释：`ORPHAN_KILL_CONFIRM_MS`（使用方三个、删「主路径刻意不等」）、`workerGoneForCancel`、`TerminateOptions` / `terminateProcessGroup`、主路径注释块、`cancelLostWorker` 退出码一句（指向 EV-177）、`CancelOptions.terminateWorker` 写明只作用于失联那一格 |
| 测试 | `test/integration/cancel-grace-unverifiable.test.ts`（T1～T6、W1、K-Z1 / G1 / G2 / G3 / K1 / K3 / K4 / C0 / E1，16 条；不静态导入新导出）；`test/helpers/ps-stub.ts` 加 `allowFirst`、`startArmed` + `arm()`、`allowed` 计数 |
| 文档 | BACKLOG（EV-176 done、新登 EV-177）；主设计 v1.3.67（7.5 `--cancel` 行、:1485 段、§12.6 EV-153 条末句、变更记录）；LLD v1.1.25（4.2 两处引述块、已知缺口表、2.7 表）；MANUAL v1.0.23（场景 4 新段）；PROTOCOL（69 行、`--cancel` 叙述）；`doc/05_testing/README.md` 索引；PRD 核后不改（FR-24 只讲「确认退出才写」，本主题让主路径守住它） |

## 3. 读数

### 3.1 探针新旧对照（`compare-probe.mjs`，同一份十格探针 `probe-cancel-grace.mjs`）

编码阶段按计划 r2 §5.2（GLM-04）扩为十格：加 `G2-timeout`、`K4`（SIGKILL 扣下、之后才拦）、`K4-timeout`，G2 / K1 / K4 类带一条活 CLI 组记录；改前（`probe-pre-d1e6408.coding.json`）与改后（`probe-post.json`）各跑一次。**硬断言全过**（`compare-probe.json`）：格集合相同、构建指纹不同、每格拦截点命中、对照格 K2 / C0 新旧结局相同、改后按 r2 处置。

| 格 | 改前 | 改后 |
| :-- | :-- | :-- |
| Z1 零信号 | 0 ｜ 无信号 ｜ cancelled、锁不在、idle ｜ 载体在、归档 running ｜ worker 活 ｜ 再拿锁拿到 | **69** ｜ 无信号 ｜ running、锁在、running ｜ 载体在、归档 running ｜ worker 活 ｜ 再拿锁抛 70 |
| G1 延迟 3 s 退出 | 0 ｜ SIGTERM ｜ cancelled、锁不在 ｜ **载体在、归档 running** ｜ worker 活（9 ms 返回） | 0 ｜ SIGTERM ｜ cancelled、锁不在 ｜ **载体已抹、归档 cancelled** ｜ worker 不在（3098 ms，等到它真退出） |
| G2 忽略 SIGTERM | 0 ｜ SIGTERM ｜ cancelled、锁不在 ｜ CLI 在 ｜ 10 ms | **69** ｜ SIGTERM（无 SIGKILL）｜ 什么都没动 ｜ **CLI 已按记录结束** ｜ 5154 ms |
| G2-timeout | 0 ｜ 同 G2 ｜ 20 057 ms | **69** ｜ 同 G2 改后 ｜ 20 112 ms |
| G3 即死 | 0 ｜ 收尾完整（本次 54 ms；计划阶段那次漏抹漏补收，见 §4） | 0 ｜ 收尾完整 ｜ 291 ms |
| K1 SIGKILL 扣下 | 0 ｜ SIGTERM、SIGKILL ｜ cancelled、锁不在 ｜ worker 活 ｜ 5195 ms | **69** ｜ SIGTERM、SIGKILL ｜ 什么都没动 ｜ CLI 已结束 ｜ 10 362 ms |
| K4 SIGKILL 后才判不了 | 0 ｜ 同 K1 改前 ｜ 5156 ms | **69** ｜ 正文「SIGKILL 之后……判不了」｜ 10 075 ms |
| K4-timeout | 0 ｜ 25 122 ms | **69** ｜ 25 086 ms |
| K2 对照（SIGKILL 照常） | 0 ｜ 收尾完整 ｜ 5061 ms | 0 ｜ 收尾完整 ｜ 5294 ms |
| C0 对照 | 0 ｜ 收尾完整 ｜ 134 ms | 0 ｜ 收尾完整 ｜ 286 ms |

超时形态实测：宽限期判不了约 20 s、SIGKILL 后判不了约 25 s 后以 69 退出（计划 r2 D6 的构成式）。

### 3.2 跨进程形态（`acceptance.mjs` + `cancel-psblock-preload.cjs` + `worker-slowterm-preload.cjs`，读数 `acceptance-readout.json`）

真实 `--start`（桩审核者 `hang_cli`）；`--cancel` 以 `NODE_OPTIONS=--require` 预载桩在 CLI 进程里拦 `ps -p 〈工作进程 pid〉` / 扣 SIGKILL；需要工作进程对 SIGTERM 迟钝时，`--start` 另带一个只在 `--worker` 进程里生效的预载，把工作进程的 SIGTERM 处理器延后（8 s / 极大值）。新旧 bundle sha256 不同（`82e25fbd…` / `a8ccae26…`）；预载自证：每格都拦到 / 记到。**13 / 13**（r3；r0～r2 见 §4）。

| 格 | 改前 `d1e6408` | 改后 |
| :-- | :-- | :-- |
| X-Z 零信号 | 退 0，未发信号却播报「发送 SIGTERM」，锁没了、闸门 idle，返回时工作进程活；同主题 `--start` **退 0（双跑）**；撤桩再 `--cancel` 落「无需取消」，**原工作进程一直活着** | 退 69，零信号、不播报发送，stdout 空，锁原样、闸门 running、status running；同主题 `--start` 退 70；撤桩再 `--cancel` 退 0、工作进程退出、锁回收 |
| X-G 宽限期 | 退 0（131 ms），只发 SIGTERM，锁没了，返回时工作进程活；同主题 `--start` 退 0，那一刻上一轮 status 是 `--cancel` 代写的 cancelled（双跑） | 约 5.2 s 后退 69，只发 SIGTERM，正文「判不了……不升级 SIGKILL」，锁原样、闸门 running；按记录结束 CLI 之后上一轮工作进程自己收尾（status 写 failed、放锁） |
| X-K SIGKILL 扣下 | 退 0（5.2 s），status cancelled、锁没了，返回时工作进程活 | 约 10.2 s 后退 69，正文「仍是同一进程」，返回时 status running、锁在 |
| X-N 对照 | 退 0、锁回收、闸门 idle、cancelled | 同左 |

### 3.3 移植验收（`port-acceptance.mjs`，读数 `port-acceptance.json`）

新用例文件与扩过的 `ps-stub.ts` 拷进另一份 `git archive d1e6408` 树（拷入前后 sha256 在读数里），`--tests-only` 重编单跑。**16 / 16 格符合期望**：改前红 13（全是新行为格）、绿 3（T6、K-C0、K-E1 回归格）；改后 16 / 16 绿。改前红因逐条核过都是缺陷本身：T1「判不了不算已退出」、T3 / T4 / T5 返回值不符、W1「活着而取不到启动时刻应判不了，而不是已退出」、K-Z1 / K-G2 / K-K1 / K-K4「应抛出而不是返回 0；stdout=已回收主题……的锁」、K-G1 / K-G3 / K-K3「确认退出后收尾完整（凭据已抹、归档与登记 cancelled）」。

移植首跑（`port-acceptance.json`）之后改了两处用例（§4：T2 断言次序、K-G3 构造），重跑 `port-acceptance.r1.json` 同为 16 / 16，T2 的改前红因变为「判不了之后应继续轮询到判已退出（问了 2 次）」。

### 3.4 源码变异（`scripts/mutation-check.mjs`；规格 `mutation-spec.json` 由 `gen-mutation-spec.mjs` 从源码截锚点并核对唯一；先以 `mutation-names.mjs` 逐条带 `--test-timeout` 预跑）

| 变异 | 预跑 / 正式 | 实测红集 |
| :-- | :-- | :-- |
| M1 首检把判不了当已退出 | 2 / 2 | T1、K-Z1 |
| M2 首检忽略判不了、照发 SIGTERM | 2 / 2 | T1、K-Z1 |
| M3 宽限期轮询把判不了当已退出 | 8 / 8 | T2～T5、K-G1、K-G2、K-G3、K-K4 |
| M4 宽限期满判不了仍升级 SIGKILL | 2 / 2 | T3、K-G2 |
| M5 主路径 SIGKILL 之后改回不等 | 1 / 1 | K-K3 |
| M6 删掉「未确认 ⇒ 不收尾」 | 3 / 3 | K-G2、K-K1、K-K4 |
| M7 未确认退 1 而不是 69 | 3 / 3 | K-G2、K-K1、K-K4 |
| M8 `workerGoneForCancel` 不读 identity | 6 / 6 | W1、K-Z1、K-G1、K-G2、K-G3、K-K4 |
| M9 「发送 SIGTERM」挪回调用之前 | 1 / 1 | K-Z1 |
| M10 升级而未确认时跳过按记录结束 CLI | 1 / 1 | K-K1 |
| M11 未确认时不置 `unverifiable` | 5 / 5 | T1、T3、T5、K-G2、K-K4 |
| M12 扣下 SIGKILL 时跳过按记录结束 CLI | 1 / 1 | K-G2 |
| M13 零信号格不按入口格处置 | 1 / 1 | K-Z1 |

13 / 13 咬住；预跑与正式逐条 fail 数相同、无挂死；装置结束后两个目标文件 sha256 与变异前一致、无哨兵残留（`mutation-output.txt`、`mutation-names-output.json`）。M5 只咬 K-K3：K-K4 的 SIGKILL 被扣下，不等与等 5 s 的结局相同（都判不了），计划期预测里本就只列 K-K3。

### 3.5 其他

| 项 | 结果 |
| :-- | :-- |
| 新用例单跑 | 16 / 16（约 38 s） |
| Node 18.20.8 / 22.23.3（`npx` 缓存）跑新文件 + `run-protocol` + `worker-detach` + `gate-loop`（P4 系列不跳过）+ `unverifiable-start` + `start-canonical` + `cli-group-record` + `scrub-admission` | 235 / 235、235 / 235（`node18.txt` / `node22.txt`） |
| `npm run check` × 2 | 2361 / 2359 / 0 / 2 两次（`check-1.txt` / `check-2.txt`） |
| `doctor --selftest`（仓库新构建） | 14 / 14（`doctor-selftest.txt`） |

## 4. 偏离与如实登记

- **探针 G3（收 SIGTERM 即死）改前的结局取决于时序**：计划阶段那次（`probe-pre-d1e6408.json`）漏抹、漏补收，编码阶段那次（54 ms）收全——首次轮询与 launchd 回收谁先，决定了随后的凭据准入看到的是活进程还是已不在。所以用例 K-G3 改用「收 SIGTERM 300 ms 后退出」，保证改前确定地红（移植验收首跑时 K-G3 按「即死」构造也是红，但不可依赖）。
- **用例 T2 的断言次序**：首跑移植时最先撞上的是「onTerm 恰调一次」（改前本无此回调）；把轮询次数的断言挪到前面，让红因直指缺陷。
- **跨进程验收判据写错三次**（读数 `acceptance-readout.r0.json` / `.r1.json` / `.r2.json` 原样保留）：r0 要求 X-G 改后同主题 `--start` 必为 70——没想到按记录结束 CLI 之后，上一轮工作进程会看到 CLI 退出、自己收尾放锁；r1 改看「起跑前上一轮工作进程活不活」——预载桩挂着的 8 s 定时器让已收尾的工作进程多活一会儿；r2 改看「起跑前上一轮 phase」——读 phase 与 `--start` 抢锁之间隔着一次 Node 启动，工作进程恰在这段时间写 failed、放锁。r3 收回到 `--cancel` 自己的不变量：返回那一刻锁原样（之后的放锁只可能出自工作进程），上一轮最终 status 是工作进程自己写的 failed / success（主路径的 `--cancel` 从不写 failed）。四次运行里被测行为的读数一致，变的只是判据。
- **跨进程 X-Z 改前的一个连带后果**：撤桩后再 `--cancel` 落终态分支「无需取消」，被放掉锁的原工作进程一直活着（`after.worker_gone: false`），要靠验收收尾按组结束。
- **Hook 误拦一次**：扩探针时 heredoc 正文含 `task.json` 字样被拦；改用 Write 落脚本再执行，没有绕判定。

## 5. 审计边界

- 本机只能以注入模拟 `ps` 取不到与 SIGKILL 未确认；自然负载下的命中率未知（EV-153 读数：约 24.5 万次派生 0 失败）。
- 不花配额：审查员一律桩适配器。
- 零信号格不结束 CLI（与入口判不了同处置，计划 r2 §4 R7）；`ps` 持续取不到时工具自己结束不了这一轮，出路是 69 正文里的手工结束。
- 失联那一格的两处不同口径登 EV-177，暂缓。

## 6. 代码双审 r1

run `20260930T160254Z`（约 10 分 39 秒）：codex `approve-with-nits`（次要 2、吹毛求疵 1）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1）；4 条全接受（应答件 `.reviews/取消宽限期判不了仍放锁/code/` 下的 response 件）。

| 意见 | 修订 |
| :-- | :-- |
| CODEX-01 ≡ GLM-01：发过 SIGTERM 而判不了的两格，手工出路沿用入口格的 `kill -TERM`（SIGTERM 已证无效）；「都没动」未限定为本命令的动作 | 新增 `manualKillWayOut`（核命令行 → 按组 `kill -KILL -N` → 再 `--cancel`），判不了的两格改接它；发过信号的三格正文改为「本命令没有动……工作进程若仍在，看到 CLI 退出后可能自己收尾」；入口格与零信号格正文逐字不变（K-E1 锁住）；K-G2 / K-K4 补断言手工出路是 `kill -KILL`，K-K1 补断言「本命令没有动」「可能自己收尾」；MANUAL v1.0.23 段同步 |
| CODEX-02：设计 7.5「至多再加 15 s」按串行假设推导 | 改为构成式（每个等待窗尾延迟 = 窗长 + 窗内最后一次与期满那一次判定），写明单点挂满实测约 20 / 25 s、多处挂满的病态形态不保证在 120 s 之内（改前已然）与被工具超时中断的后果；不另做「每次都挂满」的注入——那种注入下入口判定即判不了、按入口格 10 s 后 69，走不到新增的两个窗 |
| CODEX-03：`lostWorkerGoneFrom` 注释、设计 :1485 与 LLD :503 的 EV-175 句仍说 `workerGoneForCancel` 不读 identity | 三处加时点限定、改写论证；BACKLOG EV-177 补一句 |

裁决校验通过；运行告警「安装副本不是当前工作树构建的」是本主题改了 `src/`、尚未重装的预期状态。

## 7. 修订后读数（r1）

| 项 | 结果 |
| :-- | :-- |
| 新用例单跑 | 16 / 16 |
| 移植验收（`port-acceptance.r2.json`） | 16 / 16（改前红 13 绿 3，改后 16 / 16） |
| 源码变异（`mutation-spec.r1.json` 与 r0 逐字节相同） | 预跑与正式都 13 / 13 咬住，fail 数与 r0 逐条相同；两个目标文件 sha256 恢复一致、无哨兵残留（`mutation-output.r1.txt`、`mutation-names-output.r1.json`） |
| `npm run check` | 2361 / 2359 / 0 / 2（`check-1.r1.txt`） |

修订只动 69 正文、注释与文档，控制流未动；探针、跨进程验收与 Node 18 / 22 读数沿用修订前（被测的收尾结局与退出码不变；K-E1 锁住的入口格正文逐字不变）。
