# 闸门拦截不留骨架 · 实施报告（EV-109 ≡ EV-145 ①）

- **日期**：2026-09-27
- **主题**：`闸门拦截不留骨架`；计划 `.reviews/闸门拦截不留骨架/plan/`（D1～D5 送审前已定、全取建议项 → 计划双审 run `20260927T015234Z` 三侧 `approve-with-nits`、10 条全接受 → r2 定稿，提交 `1ee28b0`；用户审批「修改后实施」）
- **起点**：`1ee28b0`（计划 r2 提交）；计划行号取自 `bcb454e`（两者之间只有计划留痕，源码未变）
- **状态**：代码双审 r1（run `20260927T035514Z`）8 条全接受，审批「按照应答件修改」；已按应答件修订（§7）
- **evidence**：`doc/05_testing/evidence/gate-block-no-skeleton-20260927/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 置闸门挪到第一次落盘之前 | `review.ts` `prepareRun`：闸门比较-交换（`expect` 集合与被拦文案一字不改）搬到 `primarySnap` 之后、建阶段目录之前；重置收工阻断计数挪进 `try` 首句；落盘段（建目录 → 补丁与便利副本 → brief → 运行目录 → 骨架 → 登记 → 任务目标）与 `return` 包进 `try`，`catch` 里 `holdsGate` 为真时回收闸门再抛。重排用一次性脚本按锚点切段（每个锚点核对唯一），落盘段原样整体缩进两格 | B1～B7 |
| §3.2 回收函数 | `state.ts` 新增 `releaseRunningGateEntry`（`running → idle`，`expect` 带 `runId`、`allowMissing: false`，自身吞错）；`run-protocol.ts` 的 `releaseRunningGate` 改为委托它，三处调用点不变；`runReviewLocked` 的内联回收不动（`hooks.ts` :298「`review.ts` 的四处 `setGateChecked`」计数不变） | U1 |
| §3.6 注释 | `review.ts` 模块头流程与 `prepareRun` 文档块补「置闸门 running」一步与零工件口径；`startRun` 的 prepare catch 注释写明闸门不归它管；`types.ts` `status` 注释与 run.v2 schema `status` description 同步（见 §3.1） | — |
| §4 验证 | U1（`state.test.ts`）；B1 / B4（`no-artifacts.test.ts`）；B2（`gate-loop.test.ts` :634 原用例追加）；B3（`code-stage.test.ts`）；B5 / B6 / B7（`gate-loop.test.ts` 末尾） | §2 |
| §5 文档 | 见 §4 | 反扫 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次 **2133 / 2130 / 1 / 2**（起点 2126 → 新增 7 条：U1、B1、B3、B4、B5、B6、B7；B2 追加在既有用例里）。红的 1 条是 `lock-cross-process.test.ts`「跨进程：多个进程同时回收同一把遗留锁，仍只有一个拿到」（5 个进程里 2 个拿到锁），见 §3.3；文档同步后第 2 次 **2133 / 2131 / 0 / 2** 全绿 |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14 / 14** |
| 受影响四个套件单跑（`state` / `no-artifacts` / `code-stage` / `gate-loop`） | **133 / 133** |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并逐条核对唯一） | **7 / 7**（`mutation-output.txt`）：M1（`no-artifacts.test`，B1）fail=2、M2（`code-stage.test`，B3）fail=1、M3 fail=3 与 M4 fail=2（`gate-loop.test`，B5）、M5 / M6（`state.test`，U1）各 fail=1、M7（`gate-loop.test`，B7）fail=1。每条只写一个期望套件 |
| 零配额验收（`acceptance.mjs`，mkdtemp 夹具、桩审查员） | **13 / 13**，第 1 次即过（`acceptance-readout.json`） |
| 改后探针（`probe-gate-block.mjs` 在改后构建上重跑，`probe-gate-block.after.json`；改前读数 `probe-gate-block.out.json`） | G1 被拦零新增文件、零新增运行目录、task.json 仍 1 条；补第 1 轮裁决件后不带 `--run-id` 的 `gate --check` 退 0（第 1 轮）；G2 便利副本不变；G3 闸门回收为 `idle`、骨架 `running`；G4a 同秒被拦不再覆盖第 1 轮（run.json 仍 `success`、登记 7 条） |
| 环境 | git 2.54.0（Apple Git-157），Node v25.2.1 |

## 3. 偏离与如实登记

### 3.1 与 r2 文字的小出入

- **B2 的闸门终态**：r2 §4.2 写「闸门进 `awaiting_approval`」。`gate-loop.test.ts` :634 那条既有用例的 `runPlan` 不带 `--entry`，`gate --check` 通过后按 entry 缺席回 `idle`（B/C/D 才立 `awaiting_approval`）。用例按实际语义断言 `idle` 且 `run_id` 为第 1 轮；「校验的是第 1 轮」这一主判据不变。零配额验收 A2 走 `--entry B`，读到的是 `awaiting_approval → approve` 这条路。
- **`types.ts` 与 schema 的 `status` 描述**：r2 §3.6 写把「或 prepare 阶段被拦」改为「或准备阶段写完骨架之后登记失败」。本仓归档里确有一份历史被拦骨架（EV-79 `20260922T134058Z`，A6 读到它仍在未进时间线表里），直接删掉这一格会让描述对历史留痕失实，所以写成「本版以前 prepare 阶段写完骨架后被闸门拦下，或准备阶段写完骨架之后登记失败」，并补「被闸门拦下的 `--start` 自 EV-109 起不写骨架」。主设计 6.7 注记同一口径。
- **B6 的构造**：r2 写「可选」，已写并纳入全量；两次运行之间隔 1.1 s（与 B3 / B4 同理，避开 run_id 同秒撞名）。

### 3.2 探针读数的来历

`probe-gate-block.out.json` 是计划期在 `bcb454e` 构建上跑的最后一次读数（计划 §2.1 / §2.2 引用的就是这一次）。`probe-runid-collision.mjs` 与 `probe-corrupt-rerun.mjs` 计划期的读数只记在计划 §2.3 / §2.4 正文里，没有另存文件；改后构建上 collision 探针已复现不出（被拦那次不再写文件），corrupt 探针与本主题改动正交（EV-148）。

### 3.3 全量里的一次偶发红（与本主题无关）

`lock-cross-process.test.ts` :216「跨进程：多个进程同时回收同一把遗留锁，仍只有一个拿到」在第 1 次全量里 5 个进程有 2 个拿到锁。本主题没动 `lock.ts`（主题锁的获取与遗留锁回收）；该套件单跑 6 次 6 次全绿（每次 4 / 4）。判断是全量满载并行下的时序偶发。本仓文档与以往报告里没有这条用例偶发的记录，**本报告首次记下**。用户定登记 BACKLOG，已登 **EV-149**：用例数的是「拿到过锁的进程数」而赢家只持锁 900 ms，满载时晚启动的 worker 可能在第一个赢家释放后合法拿到锁（先后两次获取、不是互斥失效）；但也不能排除回收与 `fs.link` 之间真有窗口——用例没记持锁区间，现有读数分不出，候选是先改用例记区间、断言区间不重叠。

## 4. 文档同步

| 文件 | 落点 |
| :--- | :--- |
| 主设计 → v1.3.49 | 当前版本行；6.7 注记末句改写并另起「被闸门拦下的 `--start` 不写任何留痕」一段；7.3 拒绝启动表加「上一轮审查意见尚未裁决」一行；7.5 `review --start` 一行补「置闸门 running」；验收表 AC-16 行「2/64/65/69/70」；变更记录 v1.3.49 行 |
| PRD → v1.4.13 | 当前版本与文档版本行；变更说明补 FR-24 的一句边界（被闸门拦下的 `--start` 不写运行元数据、不算一次运行），AC-16 原文不动 |
| LLD → v1.1.7 | 版本行与变更说明；`startRun` 时序图 `setGateChecked(running)` 挪进 `prepareRun`；`startRun` 第 2 条；零工件不变式补「置闸门是落盘之前的最后一步」；4.2 引述块 |
| MANUAL → v1.0.7 | 版本行；场景 7 补「被拒绝的那次不会留下任何文件，补齐裁决后直接跑 `gate --check`」 |
| PROTOCOL | :254 的 `review --start` 流程 |
| run.v2 schema | `status` description（见 §3.1） |
| BACKLOG | EV-109 done；EV-145 第 ① 格改写为余项（写完骨架之后登记失败）、行号更新；新登 EV-147（run_id 只到秒、同秒两次运行互相覆盖）、EV-148（留痕读不出时「重跑一次」的出口循环）、EV-149（`lock-cross-process` 那条全量下偶发红，用户定登记） |

反扫（`-c core.quotepath=off`，`doc/`、`skills-src/`、`src/`、`test/`）：「prepare 阶段」「64/65/69/70」「写 run.json 骨架」「setGateChecked(running)」剩余命中均为本次新写的说明或历史记录。`.reviews/README.md`、skills-src、CLI 帮助不改（r2 §5）。本仓根 `CLAUDE.md` 不改（EV-138）。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `probe-gate-block.mjs`、`probe-gate-block.out.json`、`probe-gate-block.after.json` | 计划 §2.1 / §2.2：G1～G4 夹具实测，改前（`bcb454e` 构建）与改后两份读数 |
| `probe-runid-collision.mjs` | 计划 §2.3：同秒被拦覆盖第 1 轮（EV-147） |
| `probe-corrupt-rerun.mjs` | 计划 §2.4：留痕读不出时「重跑一次」出口循环（EV-148） |
| `gen-mutation-spec.mjs` → `mutation-spec.json`、`mutation-output.txt` | 源码侧变异规格生成、锚点唯一性核对与结果（代码双审 r1 修订后重生成、重跑，§7）；r1 之前的规格与读数留在 `mutation-spec.r0.json`、`mutation-output.r0.txt` |
| `acceptance.mjs`、`acceptance-readout.json` | 零配额验收 A1～A6（13 / 13） |

## 6. 待办

1. ~~文档同步后重跑全量~~——已跑，2133 / 2131 / 0 / 2（§2）。
2. ~~用户终端重装 → `/dual-review-code`~~——r1 已过（§7）。
3. ~~§3.3 那条偶发红是否登记 BACKLOG~~——用户定登记，EV-149。
4. 提交、推送（待用户确认）；从已提交状态重建，用户重装（`--targets claude,glm,codex,gemini`），复核安装副本一致。

## 7. 代码双审 r1（run `20260927T035514Z`）与修订

三侧：codex `approve-with-nits`（2 minor、3 nit）、gemini `approve-with-nits`（1 minor）、glm `approve-with-nits`（2 nit）；8 条全接受，没有两侧同指的一组。用户审批「按照应答件修改」。
应答件 `.reviews/闸门拦截不留骨架/code/2026-09-27-闸门拦截不留骨架-response-claude.md`。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 | `review.ts` `prepareRun`：置闸门的比较-交换也并入 `try`（`holdsGate` 声明留在外面）。此前它在 `try` 之外，写盘之后 `withGlobalLock` 放锁若抛错，闸门停在本轮 running 而绕过回收；被拦的 `GATE_BLOCK` 进 `catch` 后，回收按 runId 比较对别的 run 的待裁决槽位什么都不改，报错原样抛出。段注释写明理由 | B1～B7 原样绿；这一格（写盘后放锁抛错）构造不出来，不进变异装置，只在代码审核对 |
| CODEX-02 | BACKLOG EV-145：残句「①最容易发生，正解多半是『先查闸门再写骨架』」改为历史注记 | — |
| CODEX-03 | EV-145 ②：catch 行号改为 `run-protocol.ts` :429（主 `try` 的 `catch`）；余项与 ③ 的行号按修订后代码更新（`review.ts` :1016 / :1028 / :1749） | 行号逐个 grep 核对 |
| CODEX-04 | EV-145 ② 补「纯文档跳过分支里 `executeRun` 抛错」一格（该分支只有 `finally`，骨架已写）；LLD 4.2 引述块的列举与 v1.1.7 变更说明同步 | — |
| CODEX-05 | `runReviewLocked` 的内联回收与 `state.ts` `releaseRunningGateEntry` 各加一句互指注释「改一处须改两处」；调用方式不改（`hooks.ts` 头注释按「`review.ts` 的四处 `setGateChecked`」计数引用它） | — |
| AGY-01 | `acceptance.mjs` 的 A6 旧构建基线改为 `ACCEPT_BASE_REF`（缺省 `1ee28b0`），读数里记下所用基线；脚本头注释写明 | 验收重跑 |
| GLM-01 | `prepareRun` 文档块与段注释：「一个文件都没写 / 不写」收窄为「不写任何审查工件与留痕（brief、补丁与便利副本、run.json、task.json 登记、运行目录）」，补「闸门状态文件在判负时也会刷新 `updated_at`，闸门项不变」 | — |
| GLM-02 | EV-149 落点列与本报告 §3.3 的用例行号 :152 改为 :216（:152 是我误用了编译产物 `.js` 的行号） | 已 grep 核对 |

变异规格按修订后代码重生成：比较-交换进 `try` 之后闸门块与落盘段同一缩进，M1 / M2 挪块不再改缩进；M3 的 `catch` 注释锚点随之更新；**M7 的形态变了**——比较-交换已在 `try` 里，「重置计数移到 `try` 之外」只能排在置闸门之前，B7 咬住的依据随之从「闸门停在 running」变为「计数删不掉时没走到置闸门、闸门项缺席」，规格的 desc 写明。

修订后读数：

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | **2133 / 2131 / 0 / 2**，一次全绿 |
| 源码侧变异（重生成的 `mutation-spec.json`） | **7 / 7**（`mutation-output.txt`）：M1 fail=2、M2 fail=1、M3 fail=3、M4 fail=3（r0 为 2：被拦路径现在也经过 `catch`，吞错变异多咬住一条）、M5 / M6 / M7 各 fail=1 |
| 零配额验收（A6 基线 `1ee28b0`） | **13 / 13**，第 1 次即过（`acceptance-readout.json`，A6 的 `baseRef` 记为 `1ee28b0`） |
| `doctor --selftest` | **14 / 14** |

