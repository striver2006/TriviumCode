# 运行目录跨主题同秒避让 · 实施报告（EV-218）

> - **日期**：2026-10-06
> - **主题**：`运行目录同秒避让`（M11 前小批第四批第 2 题；**本批未走双审**，用户以会话指令授权按建议直接开发，提交前由执笔方自审补丁）
> - **起点**：`6ed8599`（`main`，工作树干净；复现与候选登记见该提交）
> - **证据目录**：`doc/05_testing/evidence/run-dir-collision-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定「分配时对运行目录做排他创建（非 recursive mkdir），撞了往后抬一秒，与 `allocateRunId` 的同秒避让共用上限与 69 出口，运行目录路径结构不改」；实施时核出与 5 格故障注入用例冲突后，用户定候选 **A**（测试注入开关，只给那 5 格用）

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. **复现**（`repro.mjs`、`repro-1.json`，起点之前那次提交已入库）：同一仓库两个主题对齐到一秒开头并发 `review --start`，第 1 次就撞上——两边都分到 `20261006T082237Z`、都退 0；运行目录只有一份，`request.json` / `status.json` 只剩甲的；乙的归档 run.json 停在 `running`、critics 为空，无任何提示。
2. 运行目录是 `<runRoot>/<repoId>/<runId>`（`src/trivium/review.ts` :967，`repoId` 在 :512），按仓库分、不按主题分；`meta.ts` :59 `allocateRunId` 只看本主题的 task.json 登记与各阶段 `_meta/run-<id>.json`，两个主题各持各的主题锁，所以同秒必撞。
3. `prepareRun`（`review.ts` :737）在 :891 分配 run_id，并用它给补丁与 brief 命名（:1245 起落盘），:1271 才 `ensureDir(runDirBase)`——建目录刻意推迟到落盘段（GLM-04「零工件」）；分配之后、落盘之前有 65 / 64 / 69 / 2 多个早退（如 :917 原稿缺失、:1075 必读与禁读相交、:1208 上一轮未裁决）。`no-artifacts.test.ts` :223 断言被拦时「不得在项目外建运行目录」（按文件列，空目录不计）。
4. `cli.ts` :1806 `verify` 也调 `allocateRunId`，但 verify 不建运行目录（`verify.ts` 不引用运行根），不在本题范围。
5. `test/integration/gate-loop.test.ts` 的 `precreateRunDirs`（:2473）预建「从现在起 60 秒」的运行目录并在里面做手脚，供 5 格故障注入用例（:2550 / :2570 / :2598 / :2629 / :2649，EV-145 / EV-150 落骨架之后写盘失败的收尾）使用；排他占用会把这些目录当成已占用而绕开。

### 修法

1. `meta.ts` `allocateRunId` 加可选第 4 参 `{ claimRunDirIn }`（运行根下本仓库的桶）：给了就先 `mkdir -p` 桶，再对每个候选 id（本主题未占用的）做**非 recursive** 的 `mkdir <桶>/<id>`——成功即占到；`EEXIST` 视为别的运行已占用、往后抬一秒；其他错误照抛。与原有避让共用上限（`RUN_ID_MAX_BUMPS`）与 69 出口，用尽时的报错补一句「或运行目录已存在」。返回值不变（run_id）。
2. **测试注入开关（候选 A）**：环境变量 `TRIVIUM_TEST_ADOPT_PRECREATED_RUN_DIR=1` 时，`EEXIST` 的目录按「可占用」接管（不抬秒），只给那 5 格故障注入用例用；接管的目录不由本进程删除。名字与注释写死用途；生产与其余用例都不设。
3. `prepareRun` 改为外包一层：内层在分配时记下「本进程新建的运行目录」，落盘段建目录那一步（原 :1271）之后标记「已落盘」；内层在此之前抛错时，外层 `rmdir`（非 recursive，只删空目录）这个目录，守住「被拒时不在项目外留运行目录」。
4. 用例：`allocateRunId` 单测（占用目录即抬秒、抬到的目录被建出、开关下接管、用尽 69 文案、不给桶时行为不变）；集成——预建「别的主题」的 60 秒运行目录后 `review --start` 落到窗口之外且预建目录不动、两个主题并发 `--start` 拿到不同 run_id 且各自收尾成功、分配之后早退（原稿缺失 65）不在运行根留目录；`gate-loop` 那 5 格改为带开关调用。

### 不改的边界

- 运行目录路径结构、`verify` 的分配、`allocateRunId` 不带桶时的行为不变。
- 落盘段之后的失败处理（回收闸门、骨架收尾为 failed）不变；进程被强杀在「已占到、未落盘」之间时，空目录会留下（与改前「建目录之后被杀」同类），会话启动清扫按既有口径报「状态读不到」。

## 1. 改了什么

1. `src/trivium/meta.ts`：
   - `allocateRunId` 加可选第 4 参 `{ claimRunDirIn, onRunDirClaimed }`。给了桶：先 `mkdir -p` 桶；每个候选 id 先过原有的归档避让（task.json 登记、各阶段 `_meta/run-<id>.json`），再做非 recursive 的 `mkdir <桶>/<id>`——建成即占到并回调「本次新建」；`EEXIST` 时不设开关就往后抬一秒，设了开关就接管并回调「接管」；其他错误照抛。上限与 69 出口共用，用尽时的文案在带桶时补「，或运行目录已存在」。不带桶时行为与 EV-147 完全相同（D4 守）。
   - 新增导出 `ADOPT_PRECREATED_RUN_DIR_ENV = 'TRIVIUM_TEST_ADOPT_PRECREATED_RUN_DIR'`，文档块写死「只给故障注入用例用、生产与其余用例不设、设了即失去跨主题同秒保护、接管的目录不删」。
   - 文档块删去「不看运行目录」一句，补运行目录一节；「检查与写入之间不加锁」限定为归档那一半（运行目录那一半靠原子 mkdir）。
2. `src/trivium/review.ts`：`prepareRun` 改为外层 + 内层 `prepareRunClaimed`。内层在分配时传 `claimRunDirIn: <运行根>/<repoId>`，只把本次新建的目录记进 `claim.dir`；落盘段原 `ensureDir(runDirBase)` 之后置 `claim.landed = true`。外层捕获内层抛错：本次新建且未落盘 ⇒ `fs.rmdir`（非 recursive），删不掉（非 ENOENT）告警一行，然后原样重抛。两处注释（「运行目录也推迟到落盘阶段才建」、「到这里为止不写……运行目录」）改准。
3. 用例：
   - `test/unit/run-id-alloc.test.ts` 新增 D1～D4：别的运行占着同秒目录 ⇒ 抬一秒、建出目录、回调「新建」、别人的目录不动；归档占用的 id 不去建目录、桶不存在先建；开关下接管且回调「接管」、撤开关后照常抬秒；上限内全占 ⇒ 69 且文案带「或运行目录已存在」、不带桶时不受影响。
   - 新文件 `test/integration/run-dir-collision.test.ts` I1～I3（真实 CLI、桩审查员、不设开关）：预建「从现在起 60 秒」的运行目录模拟别的运行 ⇒ `--start` 落到窗口之外、自己的目录里有 `status.json`、预建目录全空、归档 success；两主题对齐到一秒开头并发 `--start` ⇒ run_id 不同、各自 `request.json` 的主题对得上、两轮都收尾（success 或 failed，不再停在 running；不要求都 success 的原因见 §2 末段 EV-221）；被审原稿缺失（65）⇒ 运行根的桶里不留任何目录。
   - `test/integration/gate-loop.test.ts`：`startPlan`（只被预建运行目录的 5 格用）带上开关，`precreateRunDirs` 文档块补一句。
4. 文档：主设计 v1.3.124（6.7「每份 run.json 至多一次终态写入」那段补一句）；LLD v1.1.46（「`run_id` 生成」一段）；BACKLOG EV-218 结案；本报告登记索引。用户手册与 RUNBOOK 没有描述 run_id 分配，未改。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 复现（改前，登记提交 `6ed8599` 已入库） | 第 1 次即撞：同一 run_id、一个运行目录、乙的 run.json 停 `running`、两边退 0 | `repro.mjs`、`repro-1.json` |
| 登记那次的全量（代码未改） | 2901 / 2899 / 0 / 2 两次、自检 14/14 | `registration-6ed8599/` |
| 类型检查 | 退 0 | 全量内含 |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑 run-id-alloc、run-dir-collision、no-artifacts、run-id-collision | 28/28（含新增 D1～D4、I1～I3） | `suite-1.txt` |
| 单跑 gate-loop 故障注入那几格（P3 / P3b / P4 / P4b / P4c / P5） | 6/6 | `suite-gate-loop-p.txt` |
| 变异（首版用例） | 预跑 5/5、装置 5/5；I2 改写后重跑（下两行） | `first-mutation/` |
| 变异逐条预跑（I2 改写后） | M1（不排他）红 D1～D4，亦跑集成红 I1 / I2；M2（EEXIST 一律接管）红 D1 / D3 / D4；M3（开关失效）红 D3，亦跑 gate-loop 红 P3 / P3b / P4 / P4b / P4c 五格；M4（外层不删空目录）红 I3；M5（分配点不传桶）红 I1 / I2 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 5/5 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| I2 偶发红排查 | 单跑两份套件时 I2 红 1 次（甲那轮判失败）；单跑 6 次、两文件组合 6 次全绿；同时 4 份并发加压两轮共 16 份里红 2 份，保留夹具后查到成因（见本节末段） | `suite-index-check.txt`、`i2-loop-*`、`i2-pair-*`、`i2-load-*`、`i2-keep-*` |
| 首轮全量（I2 改写前，作废重跑） | 两次都 2908 / 2906 / 0 / 2、自检 14/14，全绿；但随后单跑撞出 I2 偶发红，改写 I2 后重跑 | `first-round/` |
| 全量第 1 次 `npm run check` | 2908 / 2906 / 0 / 2，退 0（比起点 2901 多 7 格：D1～D4、I1～I3） | `check-1.txt` |
| 全量第 2 次（串行） | 2908 / 2906 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 两次全量期间分别 1、2（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

**I2 的偶发红是另一个已有的并发竞态，另登 EV-221**：保留下来的失败夹具里，失败那轮 status.json 的 message 是「工作进程异常：git add to temp index failed: fatal: unable to stat '.reviews/EV218甲/plan/_meta/review-gemini-….json.tmp-…': No such file or directory」——乙的工作进程算工作树哈希时 `git add -A`（`util/git.ts` :117）撞上甲的工作进程正在原子写（`writeAtomic` 先写 `*.tmp-*` 再改名）的临时文件。它与运行目录无关、不限同一秒；改前两主题同秒直接共用一个运行目录，这一格被遮住了。本题不修，I2 改为只守 EV-218 本身的不变式（run_id 不同、交接文件各归各、两轮都收尾）。排查时以 `TRIVIUM_KEEP_FIXTURES=1` 保留的 4 个夹具与变异预跑期间留下的 1 个，按 R1 只列不删，清单 `kept-fixtures-leftover.txt`，留给用户处理。

## 3. 提交前自审

- 注释与文档：`allocateRunId` 文档块原有「不看运行目录」一句已删，改为如实描述；「检查与写入之间不加锁」限定为归档那一半。`review.ts` 两处「运行目录推迟到落盘段」的注释改准。测试开关的文档块写死了用途与风险。
- 断言范围：gate-loop 5 格的断言一字未改，只是调用带开关；M3 证明不带开关它们会红（即开关确实在起作用、不是摆设）。`no-artifacts` 的「不得在项目外建运行目录」断言未动且照常通过（I3 另以目录粒度守住同一件事）。
- 计划里写的「两个分配点（prepareRun、verify）都要覆盖」：核实后 verify 不建运行目录（`verify.ts` 不引用运行根），不存在跨主题共用目录的问题，只改了 prepareRun；如实写在这里，不算偏离结论。
- 边界：已占到、未落盘之间进程被强杀会留一个空目录（与改前「建目录之后被杀」同类），会话启动清扫按既有口径报「状态读不到」；分配时就建出了运行根下的仓库桶（被拒时也建；桶本身不是运行目录，改前第一次成功运行同样会建它）。
- 护栏：`newRunId` 源码护栏（EV-147 A7）不受影响；没有新增需要登记的调用点。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
