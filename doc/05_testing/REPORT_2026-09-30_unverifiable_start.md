# 取不到启动时刻当不在 · 实施报告（EV-175）

- **日期**：2026-09-30
- **主题**：`取不到启动时刻当不在`；计划 `.reviews/取不到启动时刻当不在/plan/`（计划双审 run `20260930T102656Z`：三侧 `approve-with-nits`，8 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`c4d082e`（`main`，工作树干净）；计划与本报告的行号取自该提交
- **状态**：实施与验证完成；代码双审 r1（run `20260930T120934Z`）4 条全接受并已按接受项修订（§6、§7）；未提交
- **evidence**：`doc/05_testing/evidence/unverifiable-start-20260930/`

---

## 1. 改前实证（计划阶段，r2 §2）

探针 `probe-unverifiable.mjs`：每格另起一个真实的工作进程，先在不拦时取它两种形态的启动时刻写进记录，再只拦 `/bin/ps -p 〈工作进程 pid〉`（别的 pid 与 `ps -axo` 照常，CLI 进程组判定不受影响）。改前构建 = `git archive c4d082e`。计划阶段读数 `probe-pre-c4d082e.json`（14 格 × 拦 / 不拦，自证 14 / 14）。要点：

- 情形 C、`workerConfirmedGone`、`workerStillAlive`、`cancelRun` 主路径都把「活着而取不到」当「不在」：`--wait` 把活 worker 写成 failed 并抹凭据、到期整删活 worker 的运行目录、跨仓清扫抹凭据、`--cancel` 只清不杀、同主题再拿锁成功；
- 另核出两处经 `workerConfirmedGone` 连带的结局：`--cancel` 终态分支按记录结束活 worker 名下的 CLI；`--wait` 判失联后的归档补收；
- **情形 A（status.ts :524）生产形状不命中**：`waitRun` 不传 `fallbackPidStartedAt`，期望值为 null 时只看存活；只在单测入口命中；
- 五处之外没有新的同形消费方（全部调用点表见计划 r2 §1.2）。

## 2. 逐条落地（按 r2 §3）

| 项 | 落点 |
| :-- | :-- |
| D1 | `util/exec.ts`：`RecordIdentity` 类型、`RecordMatch.identity?`、导出纯函数 `recordIdentityOf`、内部 `withIdentity`；`processMatchesRecord` 三个出口都经它（GLM-02）；原五个字段与 `sameProcess` 逐字不变 |
| D2 | `status.ts` `interpretStatus` 情形 A：改经 `processMatchesRecord(pid, { legacy })`（与 `processAlive(pid, legacy)` 同一判据），`identity === 'unverifiable'` 同活着 ⇒ `inconclusive`；`processAlive` 的导入随之删除 |
| D3 | 情形 C：`identity !== 'unverifiable'` 且（不在或不是同一进程）才判 `pid_gone`；判不了往下走心跳 |
| D4 | `workerConfirmedGone`：判不了 ⇒ `gone: false`，why「工作进程 N 仍在，但取不到它的启动时刻：判不了是不是 status.json 记录的那个进程」 |
| D5 | `retention.ts` `workerStillAlive`：显式正向判定：同一进程或 `identity === 'unverifiable'` 才算仍在（AGY-01）；`ScrubTally.deferred` 注释补一类 |
| D6 | `run-protocol.ts` `cancelRun` 主路径：判不了 ⇒ `throw envError(…)`（69），什么都不动；正文含稍后重试与手工出路（CODEX-01 ≡ GLM-03） |
| D7 | 注释：`workerStartOf`、`workerConfirmedGone`、`workerGoneForCancel`（有意不读 identity、指向 EV-176）、`lock.ts` `judgeStale`（不读 identity、两者对这一格等价）、`processMatchesRecord` |
| 测试 | `test/integration/unverifiable-start.test.ts`（U1a～U8，14 条；不静态导入新导出，GLM-01）；`test/helpers/ps-stub.ts` 加按 pid 过滤（`pids`）与 `psStubWorks(which, pid)` |
| 文档 | BACKLOG（EV-175 done、新登 EV-176）；主设计 v1.3.66（:1485 段、§12.6 EV-153 条末句、变更记录）；LLD v1.1.24（4.2 新引述块、已知缺口表两行、2.7 表）；MANUAL v1.0.22（场景 4 新段、:663 限定）；PROTOCOL（退出码表 69 行、`--cancel` 叙述）；`doc/05_testing/README.md` 报告索引补本报告一行（代码双审 CODEX-03，只并入自己）；PRD 核后不改（FR-24 只讲「确认退出才写」，本主题只让确认更严） |

## 3. 读数

### 3.1 探针新旧对照（`compare-probe.mjs`，15 格 = 14 + `K-main-timeout`）

硬断言全过：两份读数、两种模式各 15 格；派生失败形态每格自证通过、每格都拦到 `ps`；不拦时新旧逐格签名相同。

| 格 | 改前（拦） | 改后（拦） = 不拦时 |
| :-- | :-- | :-- |
| A-prod | `inconclusive` | `inconclusive`（生产形状本就不受影响） |
| A-test | **`worker_lost / pid_gone`** | `inconclusive` |
| C-canon-fresh / C-legacy-fresh | **`pid_gone`** | `running` |
| C-canon-stale | **`pid_gone`** | `heartbeat_stale` |
| C-wait | **抛 1、failed / pid_gone、凭据被抹、闸门 idle** | 73、running、凭据在、闸门 running |
| C-wait-stale | **抛 1、failed / pid_gone、凭据被抹** | 抛 1、failed / heartbeat_stale、**凭据在** |
| G-running / G-failed | **gone、准入放行** | 不 gone、不准入 |
| G-cancel-terminal | 退 0，**活 worker 名下的 CLI 被结束** | 退 0，CLI 不动 |
| S-prune | **运行目录被整删** | 保留 |
| S-prune-fresh / S-sweep | **凭据被抹**（sweep `alive: 0`） | 不抹（sweep `alive: 1`） |
| K-main | 退 0、**status cancelled、锁没了、闸门 idle、凭据被抹、CLI 被结束、worker 没收到信号；同主题再拿锁成功** | **抛 69、什么都不动；同主题再拿锁抛 70** |
| K-main-timeout（`ps` 睡过 10 s） | 同 K-main，`--cancel` 耗时 20 367 ms | 同 K-main 改后，耗时 10 005 ms |

K-main 改后与「不拦」的结局不同是设计如此：不拦时身份确认，按取消意图结束 worker；拦时判不了，按用户决策什么都不动。

### 3.2 跨进程形态（`acceptance.mjs` + `psblock-preload.cjs`，读数 `acceptance-readout.json`）

真实 `--start`（桩审核者 `hang_cli`），之后的 `--wait` / `--cancel` 以 `NODE_OPTIONS=--require` 预载桩只让 **CLI 进程**取不到工作进程的启动时刻。新旧 bundle sha256 不同（`c3de6c0f…` / `025c0ff7…`）；预载自证：两边每次都拦到（新 4 / 1，旧 3 / 2）。**10 / 10**。

| 格 | 改前 `c4d082e` | 改后 |
| :-- | :-- | :-- |
| X1 `--wait --timeout 5` | 退 1「工作进程失联（pid_gone）」，status failed，归档 run.json 收尾为 failed，闸门 idle | 退 73，status running，闸门 running |
| X2 `--cancel` | 退 0「工作进程 N 已不存在，仅做状态与锁的清理」→ 按记录结束两侧 CLI → 归档收尾 cancelled → 回收锁；**返回时工作进程仍活**；随后它看到 CLI 退出、自己把 status 改写成 failed 后退出 | 退 69，stdout 空，锁文件内容与身份原样，闸门 running，status running，工作进程仍活 |
| X3 同主题 `--start`（不拦） | **退 0：第二条流水线起跑**（跑完 `--wait` 退 0） | 退 70「主题已被占用」 |
| X4 撤桩 `--cancel` | 退 0（工作进程此前已自行退出，落终态分支「无需取消」） | 退 0，工作进程收 SIGTERM 退出、锁回收 |

### 3.3 移植验收（`port-acceptance.mjs`，读数 `port-acceptance.json`）

新用例文件与扩过的 `ps-stub.ts` 拷进另一份 `git archive c4d082e` 树（拷入前后 sha256 在读数里），`--tests-only` 重编；文件在改前树能加载。**14 / 14 格符合期望**：改前 14 条里红 9（全是新行为格）、绿 5（全是回归格）；改后 14 / 14 绿。改前红因逐条核过：U1a「应导出 recordIdentityOf」、U3「canon-fresh：worker_lost / pid_gone」、U4「工作进程 N 已不存在」、U5「到期也不整删：removed […]」、U6「应抛出而不是返回 0；stdout=已回收主题…的锁」、U7「按记录结束审查员 CLI」、U8「工作进程失联（pid_gone）」等——都是缺陷本身，不是桩或构造问题。

### 3.4 源码变异（`scripts/mutation-check.mjs`；规格 `mutation-spec.json` 由 `gen-mutation-spec.mjs` 从源码截锚点并核对唯一；先以 `mutation-names.mjs` 逐条带 `--test-timeout` 预跑）

| 变异 | 预跑 / 正式 | 实测红集 |
| :-- | :-- | :-- |
| M1 `recordIdentityOf` 判不了改回 different | fail=9 / 9 | U1a、U1b、U2～U8 |
| M2 情形 C 删判不了分支 | 2 / 2 | U3、U8 |
| M3 情形 C 判不了直接 running | 2 / 2 | U3、U8 |
| M4 情形 A 删判不了分支 | 1 / 1 | U2 |
| M5 `workerConfirmedGone` 删判不了分支 | 3 / 3 | U4、U7、U8 |
| M6 `workerStillAlive` 删判不了分支 | 1 / 1 | U5 |
| M7 `cancelRun` 删判不了分支 | 1 / 1 | U6 |
| M8 69 改 1 | 1 / 1 | U6 |
| M9 规范化且不在那个 return 不补 identity | 1 / 1 | U1b |
| M10 legacy 那个 return 不补 identity | 3 / 3 | U1b、U2、U3 |

10 / 10 咬住；预跑与正式逐条 fail 数相同、无挂死；装置结束后四个目标文件 sha256 与变异前一致、无哨兵残留。

### 3.5 其他

| 项 | 结果 |
| :-- | :-- |
| Node 18.20.8 / 22.23.3（`npx -p`）跑 `unverifiable-start` + `lock` + `state` + `start-canonical` + `scrub-admission` + `status` + `retention` | 168 / 168、168 / 168（`node18.txt` / `node22.txt`） |
| `npm run check` × 2 | 2345 / 2343 / 0 / 2 两次（`check-1.txt` / `check-2.txt`） |
| `doctor --selftest`（仓库新构建） | 14 / 14（`doctor-selftest.txt`） |

## 4. 偏离与如实登记

- **跨进程验收 r0 为 9 / 10**（`acceptance-readout.r0.json`）：X2 改前的判据写成「工作进程仍活（没收到信号）」，而实际是它名下的 CLI 被按记录结束后，工作进程自己收尾、把 status 改写成 failed 并退出——没收到信号是真的，但 300 ms 后它已不在。r1 改为在 `--cancel` 返回那一刻读存活与 phase，并断言 stderr 里「已不存在」与「按记录结束审查员 CLI」两句；这一连锁（取消后 status 被活 worker 改写成 failed、归档是 cancelled）本身也是改前缺陷的一个可见后果。
- **U6 的「撤桩后再取消」拆成独立用例 U6′**（计划 r2 §5.1 写在 U6 里）：拆开后 U6′ 是回归格，改前树上能绿，移植验收的逐格期望才成立。
- **K-main 改后的结局不等于「不拦」时的结局**：这是用户决策（判不了什么都不动），硬断言只要求不拦时新旧相同。
- **探针计划阶段 r1 版只有 14 格**，编码阶段加 `K-main-timeout` 后新旧都重跑（`probe-pre-c4d082e.coding.json` / `probe-post.json`）；计划阶段读数 `probe-pre-c4d082e.json` 原样保留。探针首跑时 `writeStatus` 会把 `heartbeat_at` 刷成当下，C-canon-stale 格没造出来，改为原样写 JSON 后重跑，计划读数取的是重跑后的。
- **超时形态不做桩自证**（要等两个 10 s）：它与派生失败形态走同一个拦截点，被拦次数照记（每格 > 0）。
- **Hook 误拦一次**：计划双审 `--wait` 时用 `node -e` 解析输出，箭头函数 `=>` 被当成重定向拦下；改为 `grep` 过滤原始 JSON，没有绕判定。

## 5. 审计边界

- 本机只能以注入模拟 `ps` 取不到；自然负载下的命中率未知（EV-153 读数：约 24.5 万次派生 0 失败）。
- 不花配额：审查员一律桩适配器；真实厂商 CLI 在判不了时的行为不受本主题影响（本主题不发信号）。
- `ps` 持续取不到时工具自己结束不了这一轮，出路是 69 正文里的手工结束（计划 r2 §4 R4）；SIGTERM 之后宽限期里 `ps` 转坏仍回收锁，登 EV-176。

## 6. 代码双审 r1

run `20260930T120934Z`（约 12 分 46 秒）：codex `approve-with-nits`（吹毛求疵 3）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1）；4 条全接受（应答件 `.reviews/取不到启动时刻当不在/code/…-response-claude.md`）。

| 意见 | 修订 |
| :-- | :-- |
| CODEX-01：夹具进程的启动时刻没断言取到，取不到时红因会被误读成被测缺陷 | 新增 `fixtureRecord(pid)`（最多取 3 次，两种形态都取到才返回，否则以「是测试环境问题，不是被测行为」判红），十处夹具取值改用它 |
| CODEX-02：`killAll` 收尾超时被静默吞掉 | 超时后补一次组 SIGKILL，仍活着就抛错列出 pid |
| CODEX-03：报告没进 `doc/05_testing/README.md` 索引 | 索引补本报告一行（只并入自己，其余缺口仍归 EV-172）；§2 文档行补一句 |
| GLM-01：`SweepResult.alive` / `PruneResult.kept` 的含义没写判不了 | `retention.ts` 两处注释与 `pruneRunDirs` 行内注释补「含判不了（EV-175）」；人读输出不另立一格（会改 `trivium scrub` 的输出格式，冻结面） |

裁决校验通过；运行告警「安装副本不是当前工作树构建的」是本主题改了 `src/`、尚未重装的预期状态。

## 7. 修订后读数（r1）

| 项 | 结果 |
| :-- | :-- |
| 新用例单跑 | 14 / 14 |
| 移植验收（`port-acceptance.r1.json`） | 14 / 14（改前红 9 绿 5，改后 14 / 14） |
| 源码变异（`mutation-spec.r1.json` 与 r0 逐字节相同） | 预跑与正式都 10 / 10 咬住，fail 数与 r0 逐条相同；四个目标文件 sha256 恢复一致、无哨兵残留 |
| `npm run check` | 2345 / 2343 / 0 / 2（`check-1.r1.txt`） |

**如实登记**：修订后变异那次后台命令整体退 1——是命令末尾用 `ls` 核哨兵不存在，`ls` 找不到文件退 1；装置本身预跑与正式都退 0。
