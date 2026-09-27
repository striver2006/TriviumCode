---
schema: trivium.disposition.v1
topic: 派生后失败的孤儿worker
stage: plan
role: claude
kind: revised
run_id: 20260927T092419Z
addresses:
  - 2026-09-27-派生后失败的孤儿worker-codex.md
  - 2026-09-27-派生后失败的孤儿worker-gemini.md
  - 2026-09-27-派生后失败的孤儿worker-glm.md
---

# 裁决：派生后失败的孤儿worker · 计划双审第 1 轮

> 被审对象：`plan/2026-09-27-派生后失败的孤儿worker-claude.md`（r1，起点 `e49279a`）
> ｜ 运行：`20260927T092419Z`（约 10 分 41 秒）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `request-changes` ｜ glm `approve-with-nits`
> ｜ 共 13 条（重要 3、次要 6、吹毛求疵 4）：接受 12、暂缓 1（AGY-04，与已定 D3 冲突，待用户定）
> ｜ 同指两组：CODEX-01 ≡ GLM-05（锁已改写那一格，第 6 步「收尾期间新 --start 退 70」不成立）；AGY-02 ≡ GLM-01（第 5 步无条件把 status.json 落成 failed，会盖掉 worker 已写的 success）

## 0. 核实记录

逐条对照 `e49279a` 源码核过：

- **CODEX-01 ≡ GLM-05**：`judgeStale` 先判 `processAlive(lock.pid)`，不在即 `pid_gone`（`lock.ts` :76-77），排在 `runTerminal` 之前。失败点在改写锁（`run-protocol.ts` :405）之后时，锁的 pid 是 worker；第 1 步终止它之后，并发的新 `--start` 可当场回收并起跑。原稿第 6 步那句只对「锁仍是 `--start` 自己的」成立。实际不串写：闸门回收 `expect` 本轮 run_id 且 `running`、收尾按 run_id 键、第 6 步 `inspectLock` 要求 `run_id` 与 `pid` 都相符、`reclaimStaleLock` rename 后复验——四道都在，但原稿没把这个写者列进 §3.5。
- **CODEX-02**：`processAlive(pid, null)` 直接判同一进程（`exec.ts` :377），D5 分支只补 pid 时 `--cancel` 没有复用防护。成立。
- **CODEX-03**：`run-meta-strict.test.ts` S3（:169-178）要求 schema 枚举与常量逐项相等；V9（`report.test.ts` :503）按常量遍历要求每个取值都有专门说明。只回退代码、保留 schema ⇒ S3 红；只保留常量不保留 `report` 那一支 ⇒ V9 红。原稿 §6.3 没算这笔。成立。
- **CODEX-04**：本机只有 `/opt/homebrew/bin/node`（v25.2.1），`package.json` `engines.node` 为 `>=18`；§2.1 读数只在一个版本、一个平台上量过。成立。
- **AGY-01**：D5 分支若失败点在改写锁之前，锁内容是 `--start` 的；`--start` 退出后按 `pid_gone` 可被回收，`prepareRun` 的闸门比较-交换允许从 `running` 迁移（`review.ts` :914），新一轮会与仍活着的孤儿并发。原稿 §6.2 已把它列为如实保留，但 AGY-01 指出有廉价的缓解（尽力把锁改写成 worker 的），成立。
- **AGY-02 ≡ GLM-01**：worker 在 `executeRun` 返回之后才写 status.json 终态（`run-protocol.ts` :553-569），而 `executeRun` 末尾先写 run.json 终态（`review.ts` :1687）。所以「worker 已跑完」有两种形态：status.json 已是 `success`，或 run.json 已终态而 status.json 仍是 `running`。原稿第 5 步无条件落 `failed`，前者会盖掉 `success`，后者会与 run.json 矛盾，两者都与第 4 步「用 `--wait` 取结果」的指路冲突。成立。
- **AGY-03**：U5 是进程内注入，`terminate` 是桩，可以在桩里读闸门并断言它仍是本轮 `running`。原稿说「先后不可观察」只对集成用例成立。成立。
- **AGY-04**：`cancelRun` 的宽限轮询只看 `.alive`（:954、:957），不看 `sameProcess`；宽限期内 PID 若被复用，`killProcessTree` 的 `kill(-pid)` 在复用者不是组长时 ESRCH，随后退回 `kill(pid)`（`exec.ts` :414-416），SIGKILL 会打到无关进程。缺陷成立。但改掉它就不再「逐项等价」，与用户已定的 D3 冲突，见第 2 节。
- **GLM-02**：`run.v2.json` :471 `status` description 里有「--start 在子进程诞生之后才失败而孤儿 worker 被杀」；原稿 §5 只列了 :480 / :487，反扫面不含 `skills/`。成立。
- **GLM-03**：U5② 断言清单确实不含「status.json 已补记 `worker_pid`」，变异表也没有对应条目。成立。
- **GLM-04**：`cancelRun` 的 `patchStatus` 无条件写 `phase: cancelled`（:1005-1009），与第 5 步交错时 phase 本身取决于先后，不只是 message。成立（下游无害）。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：锁已改写成 worker 内容的那一格，第 1 步终止 worker 后锁按 `pid_gone` 可被并发的新 `--start` 当场回收；原稿用一条只对另一格成立的不变量做安全论证，§3.5 也漏了这个写者。实际不串写靠四道既有守卫，要点名 | §3.4 第 6 步论证分两形态改写（锁仍是本进程的：新 `--start` 退 70；锁已改写：可按 `pid_gone` 被接管，四道守卫保证不串写）；§3.5 表新增一行「收尾窗口内接管主题锁的新一轮」；§4.1 U5 新增③（锁内容预置为另一轮的新持有者 ⇒ 第 6 步不删、闸门与 run.json 的另一轮条目不动）；§6.1 补一条；实施报告写明该并发窗口按守卫论证、不做时序用例 |
| CODEX-02 | codex | minor | 接受 | 核实成立：只补 pid 不补启动时刻，`--cancel` 在这一格没有 PID 复用防护；D5 触发时进程多半还活着，`processStartTime(born.pid)` 查得到 | §3.4 第 2 步：补记 pid 的同时取 `processStartTime(born.pid)` 写入 `worker_started_at`（取不到为 null，如实）；同一时刻值供 AGY-01 的改写锁用；§6.2 补「取不到启动时刻时 `--cancel` 退化为按 pid」 |
| CODEX-03 | codex | minor | 接受 | 核实成立：按原稿配方回滚，S3 必红；只保留常量而不保留 `report` 那一支，V9 也红——回滚的人会被自己的检查绊住 | §6.3 回滚配方改为保留「取值面」：`run.v2.json` 的枚举与描述、`types.ts` 的 `EXCEPTION_TERMINATION_BY` 与文档块、`report.ts` `unlistedLabel` 那一支、S1′ / V8 的新增格（都是数据或文案，没有行为），只回退 `run-protocol.ts` / `util/exec.ts` 的行为代码及其用例；§4.4 A7 改为在 `e49279a` 上叠这四处构建，跑 `run-meta-strict` 与 `report` 两个套件须绿，再读新取值 |
| CODEX-04 | codex | nit | 接受 | 核实成立：§2.1 与 K2 只在 Node v25.2.1 / darwin 上量过，`engines` 是 `>=18`。论证本身是稳定语义，但按「行为以实测为准」应如实写明范围 | §3.2 注明实测范围（Node v25.2.1、macOS），不宣称 Linux；实施报告：本机只有这一个 Node，若实施时能取得最低支持版本（18）就在它上面补跑 U3 并存读数，取不到就如实记为未测 |
| AGY-01 | gemini | major | 接受 | 核实成立：D5 分支里锁仍是 `--start` 的内容时，本进程一退出，锁即可被回收，孤儿若还活着会与新一轮并发。把锁改写成 worker 的内容正是 D5「锁留给它」的本意，属于把已定决策做实，不是改方向 | §3.4 第 2 步：`inspectLock` 见内容仍是本进程的（`pid` 与 `acquired_at` 相符）时，尽力改写为 `{ ...lock.content, run_id, pid: born.pid, pid_started_at }`（取 CODEX-02 那次的启动时刻），失败吞掉并 warn；§6.2 该条改为「改写也失败时」才保留；§4.1 U5② 追加断言「锁内容已改写为 worker 的」；§4.3 变异加一条（去掉改写 ⇒ U5② 红） |
| AGY-02 | gemini | major | 接受 | 核实成立（≡ GLM-01）：「worker 已跑完」有两种形态（status.json 已 `success`；或 run.json 已终态而 status.json 仍 `running`），第 5 步无条件落 `failed` 在两种形态下都与事实和第 4 步的指路冲突；终态不追溯改写同样适用于 status.json | §3.4 第 5 步改为三分：status.json 已终态 ⇒ 不动；run.json 是本进程在第 4 步收尾的（或已是 `post_spawn_exception`）⇒ 落 `failed`；run.json 是 worker 写下的终态而 status.json 非终态 ⇒ 只补 `worker_pid` / `worker_started_at`、不落 phase。第 4 步的指路按形态分：status.json 已终态 ⇒「用 `--wait` 取结果」；否则 ⇒「审查文档已落盘，以归档 run.json 为准；此时 `--wait` 会判失联（`pid_gone`）但不改写 run.json」；§3.5 status 行、§3.8 表补这两格；§6.2 补这一窗口；§4.1 U5 新增④（注入 run.json 与 status.json 都已 `success` ⇒ 第 5 步不改 status.json） |
| AGY-03 | gemini | minor | 接受 | 核实成立：U5 的 `terminate` 是桩，在桩里读闸门即可把「终止先于闸门回收」变成机械约束；原稿把它列成只能代码审，低估了注入用例 | §4.1 U5①：`terminate` 桩内断言闸门仍为本轮 `running`；§4.3 新增变异「闸门回收挪到终止之前」⇒ U5① 红；删去 §4.3 末段「先后不可观察、只在代码审核对」那一条 |
| AGY-04 | gemini | nit | 暂缓 | 缺陷核实成立：宽限期内 PID 被复用时，`kill(-pid)` ESRCH 后退回单进程，SIGKILL 会打到无关进程；按「不存活或不是同一进程」判更安全，也与全仓口径一致。但这是 `cancelRun` 的行为变更，而用户已定 D3「`cancelRun` 改用新函数、行为与时序不变」，我不能自行越过。倾向接受，交用户在审批时定 | 用户同意并入 ⇒ r2 §3.2 `cancelRun` 的 `isGone` 改为「不存活或不是同一进程」，§6.1 写明这是 `cancelRun` 唯一的行为变化，§4.1 U4 追加一格、§4.3 追加一条变异；不同意 ⇒ 维持逐项等价，缺陷登进 BACKLOG（EV-152 同批新登一条） |
| GLM-01 | glm | minor | 接受 | 核实成立（≡ AGY-02）：run.json 已被 worker 写成 `success` 而 status.json 未到终态的窗口里，第 5 步落 `failed` 与指路矛盾，也与 D4「保留 worker 写的那一对」不一致 | 同 AGY-02 |
| GLM-02 | glm | minor | 接受 | 核实成立：`run.v2.json` :471 的 `status` 描述列着 EV-150 那一格，本主题落地后成为不实说法；反扫面不含 `skills/`，机械兜不住 | §5 run.v2 schema 行补 `status` description（:471），按主设计 :1135 同一改法；§5 末段反扫面加入 `skills/`（至少 `skills/dual-critic/schema/`） |
| GLM-03 | glm | minor | 接受 | 核实成立：补记 `worker_pid` 是 `--cancel` 出路能找到进程的唯一依据，却没有断言与变异守 | §4.1 U5② 追加断言「status.json 的 `worker_pid` 已记为 `born.pid`、`worker_started_at` 为注入的时刻」；§4.3 新增变异「去掉补记」⇒ U5② 红 |
| GLM-04 | glm | nit | 接受 | 核实成立：`cancelRun` 无条件写 `phase: cancelled`，交错时 phase 本身取决于先后；原稿说「只影响 message」不准（下游无害：消费者按任一终态处理，复盘以 run.json 为准） | §3.5 status 行措辞改为「后写者胜出可能让 phase 在 cancelled / failed 间取其一、message 随之；『已终态』这一结论与 run.json 的内容不受影响」 |
| GLM-05 | glm | nit | 接受 | 核实成立（≡ CODEX-01） | 同 CODEX-01 |

## 2. 需要用户在审批时定的一项：AGY-04

- **现状**：`cancelRun` 宽限轮询只看 `.alive`。worker 在宽限期内退出、PID 又恰好被复用时，循环会把复用者当成 worker，升级为 SIGKILL；`kill(-pid)` 在复用者不是组长时 ESRCH，退回 `kill(pid)`，打到无关进程。
- **触发条件**：5 秒宽限内同一 PID 被复用。macOS 的 PID 递增分配，短时复用罕见，但本仓早先因为 macOS PID 复用专门加过启动时刻比对（`processAlive` 文档块，GLM-04）。
- **我的建议**：并入。改动只在 `isGone` 的一行判据，把 `cancelRun` 的这条链从「看存活」收紧为「看存活且是同一进程」，与 `workerConfirmedGone`、`judgeStale` 的口径一致；代价是 D3 的「逐项等价」要改写成「除这一处收紧外等价」。
- **不并入**：维持 D3 原样，这处缺陷登进 BACKLOG。

请在审批附言里写「AGY-04 并入」或「AGY-04 不并入」。没写的话，我按不并入处理（守 D3 原样）。

## 3. 修改方案（审批后执行，产出 r2）

1. **§3.4 `settleOrphanedStart`**：
   - 第 2 步（D5）：补记 `worker_pid` 与 `worker_started_at`（`processStartTime(born.pid)`）；锁仍是本进程的内容时，尽力改写为 worker 的（CODEX-02、AGY-01）。
   - 第 4、5 步：status.json 按三种形态分别处理；指路文案按 status.json 是否已终态选用（AGY-02 ≡ GLM-01）。
   - 第 6 步：论证分两形态改写（CODEX-01 ≡ GLM-05）。
2. **§3.5**：新增「收尾窗口内接管主题锁的新一轮」一行；status 行措辞改准（CODEX-01、GLM-04）。
3. **§3.2**：注明实测范围；AGY-04 按审批附言处理（CODEX-04、AGY-04）。
4. **§3.8 / §6.1 / §6.2**：补 status.json 两种形态、并发接管、D5 锁改写失败与取不到启动时刻的格。
5. **§4.1**：
   - U5① 在 `terminate` 桩内断言闸门仍为本轮 `running`；
   - U5② 追加断言：`worker_pid` / `worker_started_at` 已补记、锁内容已改写为 worker 的；
   - 新增 U5③（锁已被另一轮接管，第 6 步不删）与 U5④（worker 已写 `success`，第 5 步不改 status.json）。
6. **§4.3**：新增四条变异：
   - 闸门回收挪到终止之前 ⇒ U5①；
   - 去掉 D5 补记 ⇒ U5②；
   - 去掉 D5 改写锁 ⇒ U5②；
   - 第 5 步不判已终态 ⇒ U5④。

   若 AGY-04 并入，再加一条。删去「先后不可观察」那一条。
7. **§4.4 A7 与 §6.3**：回滚配方改为「保留取值面，只回退行为代码」，演练改为叠四处、跑两个套件（CODEX-03）。
8. **§5**：run.v2 schema 行补 :471 的 `status` 描述；反扫面加入 `skills/`（GLM-02）。
9. **附录**：逐条对应本件各意见的 r2 落点。
10. **不改**：D1～D8 的方向；是否用时序用例钉「收尾窗口内被接管」（按守卫论证，实施报告如实写明）。
