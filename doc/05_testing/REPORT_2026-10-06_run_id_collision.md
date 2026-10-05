# run_id 同秒避让 · 实施报告（EV-147）

> - **日期**：2026-10-06
> - **主题**：`run_id 同秒避让`（M11 前待办批次第 2 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`bb661c6`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/run-id-collision-20261006/`
> - **配额**：零配额

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/meta.ts` :37 `newRunId` 取 `toISOString()` 去分隔符与毫秒，形如 `20260910T142310Z`，只到秒。
2. 两个分配点直接用它：`review.ts` `prepareRun` :881（审查运行，在主题锁内——同步路径 `runReview` :2129 先取锁，`--start` 同样）；`cli.ts` `cmdVerify` :1769（verify，不取主题锁）。
3. 同名即覆盖：`archive.ts` `writeMeta` 对 `_meta/` 是原子覆盖写（:239 注释「同一 run_id 重写等价于修正，允许覆盖」）；`meta.ts` `registerRun` :862 按 `run_id` 找到即替换；`verify.ts` `registerVerifyRun` :336 按 `run_id` 找到即**不登记**（同秒的 verify 会丢登记）。task.json 的 `runs[]` 跨阶段共用一个 `run_id` 键空间。
4. 读者对格式的依赖：`latestRunMeta`（meta.ts「排序依据」）按文件名字典序取最新，依赖的是「定宽 UTC」；全仓没有把 run_id 解析回时间的读者（`started_at` 另记于 run.json 与 task.json）；`run.v2` schema 对 `run_id` 只要求非空字符串。
5. 测试 `gate-loop.test.ts` `precreateRunDirs` 预建「从现在起 60 秒」每一秒的运行目录做手脚，依赖「运行目录已存在不影响 run_id 分配」。

### 修法（不改格式的那一档）

1. `meta.ts` 新增 `allocateRunId(layout, now?)`：从 `newRunId(now)` 起，若该 id 已被占用就往后抬一秒，直到不撞（上限 120 次，用尽抛 69）。「占用」= task.json `runs[]` 已有这个 `run_id`，或 plan / code / bug / verify 任一阶段 `_meta/run-<id>.json` 已存在。task.json 读不出时只看文件。
2. 两个分配点改调它：`prepareRun`（主题锁内）、`cmdVerify`。
3. 抬出来的 id 仍是定宽 UTC 形态，且大于被占用的那个——字典序即时序这条仍成立（同一主题内单调）；run_id 不再保证等于开始时刻的秒，开始时刻以 `started_at` 为准。

### 不改的边界

- 格式、文件名、schema、排序读者都不动；不改 `writeMeta` 的覆盖语义、`registerRun` / `registerVerifyRun` 的幂等语义。
- 「占用」**不看运行目录**：一是 `precreateRunDirs` 依赖它；二是运行目录 `<runRoot>/<repoId>/<runId>` 跨主题共用，同秒的两个**不同主题**仍会共用一个运行目录——这一格另登新条，不在本题。
- verify 不取主题锁，与同主题的审查运行**并发**在同一秒分配时仍可能撞（检查与写入之间无锁）；本题只消除「先后」两次运行同秒撞名，并发那一格如实登记在 BACKLOG 结案记要里。

## 1. 改了什么

1. `src/trivium/meta.ts`：新增 `RUN_ID_MAX_BUMPS`（120）与 `allocateRunId(layout, now?, maxBumps?)`（见 §0 修法 1），文档块写明避让判据、不看运行目录、「字典序即时序」照旧、并发那一格不在承诺里；导入 `envError`。`newRunId` 本身不动。
2. `src/trivium/review.ts` `prepareRun`、`src/trivium/cli.ts` `cmdVerify`：`newRunId()` 改为 `await allocateRunId(ref.layout)`，导入随之调整。
3. 用例：
   - `test/unit/run-id-alloc.test.ts`（新）：A1 无占用即 `newRunId(now)`；A2 task.json 登记同秒抬一秒；A3 四个阶段 `_meta` 同名都算占用；A4 登记与文件混合、取第一个空档；A5 task.json 读不出不抛、只看文件；A6 上限用尽抛 69、文案点名主题与起点；A7 源码护栏（`stripNonCode` 后扫 `src/`，`meta.ts` 外不得出现 `newRunId(`）。临时目录走 `scratchDir`。
   - `test/integration/run-id-collision.test.ts`（新）：I1 经真实 CLI——在 bug 阶段 `_meta/` 占住「从现在起 60 秒」每一秒的 id（哨兵内容），同步 `review --stage plan` 的新 run_id 不在窗口内、格式不变、大于窗口最大值，占位文件逐字节不动，task.json 里该 id 只登记了 plan 一条。
4. 文档：主设计 6.7 的「至多一次终态写入」已知例外改为已关闭（并写明并发那一格），v1.3.96；LLD run_id 段与模块表；BACKLOG EV-147 结案、另登 EV-218；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 `tsc --noEmit` | 退 0 | 全量内含 |
| 新用例单跑（先 `build.mjs --with-tests`） | 8/8（单测 7、集成 1） | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`，集成格作 `also` 观察） | M1 红 5 / I1 红；M2 红 3 / I1 绿（集成格靠文件判据，拆登记判据不该红）；M3 红 3 / I1 红；M4 红 1（A7）/ I1 红；M5 红 1（A7） | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 `scripts/mutation-check.mjs` | 5/5 咬住，目标文件逐字节恢复 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量第 1 次 `npm run check` | 2841 / 2839 / 0 / 2，退 0（较起点 2833 多新增的 8 格） | `check-1.txt` |
| 全量第 2 次（串行） | 2841 / 2839 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 0、全量 2 期间 1（`trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

变异表：

| 编号 | 变异 | 结果 |
| :--- | :--- | :--- |
| M1 | `allocateRunId` 不看占用、第一个就返回（等价改前） | 红 5：A2～A6；I1 亦红 |
| M2 | 不看 task.json 登记 | 红 3：A2、A4、A6 |
| M3 | 不看 `_meta` 文件 | 红 3：A3、A4、A5；I1 亦红 |
| M4 | `prepareRun` 退回直接调 `newRunId` | 红 1：A7；I1 亦红 |
| M5 | `cmdVerify` 退回直接调 `newRunId` | 红 1：A7 |

## 3. 提交前自审

- 注释与文档：`allocateRunId` 文档块、LLD、设计 6.7 与 v1.3.96 都写明「先后两轮不撞、并发那一格仍可能撞、不看运行目录」，不把承诺说大；自审时发现 `meta.ts` 顶部新增一行导入后 `newRunId` 下移到第 38 行，LLD 的锚点由 `meta.ts:36` 改为 `meta.ts:37`（与改前同样指向它上方的文档行）。
- 断言范围：既有用例一条未改；`precreateRunDirs` 依赖的「运行目录存在不影响分配」保住（全量里那几格照常通过）。
- 护栏：新分配点由 A7 源码护栏管住；`driver-wiring` 一类护栏表不涉及 run_id 分配；新单测建临时目录走 `scratchDir`。
