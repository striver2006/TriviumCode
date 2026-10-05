# cancel-grace 夹具等就绪 · 实施报告（EV-217）

> - **日期**：2026-10-05
> - **主题**：`cancel-grace 夹具等就绪`（M11 前待办批次第 1 题；**本批未走双审**，用户 2026-10-05 以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`a4f7c26`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不属本题、不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/cancel-grace-ready-20261005/`
> - **配额**：零配额（单测、变异、全量与自检，不跑任何真实 CLI）

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `test/integration/cancel-grace-unverifiable.test.ts` 改前第 214～223 行：`spawnMarked` 以 `stdio: 'ignore'` 拉起 `node -e PROGRAMS[program]`，之后只 `await sleep(150)` 就返回，不知道子进程有没有执行到 `process.on('SIGTERM', …)`。
2. 同文件改前第 203～212 行 `PROGRAMS`：`delay300ms` / `delay3s` / `ignore` 三种程序的行为都靠先装 SIGTERM 处理器；处理器没装上时 SIGTERM 按默认处置直接结束进程。
3. BACKLOG EV-217 登记的读数：2026-10-05 三次全量红两次，均是 K-K3，失败那格 500～720 ms 结束、`sent` 只有 `SIGTERM`（正常一格约 5.7 s、`SIGTERM` 与 `SIGKILL`）。成因是按读数推断，未实测复现。

### 修法

1. 夹具程序正文执行完（处理器已装好）后经 stdout 打一行就绪标记 `trivium-ev217-ready`；`spawnMarked` 改为 `stdio: ['ignore', 'pipe', 'ignore']`，等到标记再返回，读完关掉读端。
2. 等就绪带 20 s 上界（`READY_TIMEOUT_MS`），超时或子进程没报就绪先退出都抛错，文案注明是测试环境问题、不是被测行为。
3. 新增夹具自检 R1：`slowIgnore` 程序先忙等 500 ms 再装「忽略 SIGTERM」，断言 `spawnMarked` 至少等了 500 ms，且返回后立即发 SIGTERM 进程 500 ms 内不退出。它把「处理器装得慢」这一形态在任意负载下都确定地造出来，取代「靠高负载撞」。

### 不改的边界

- 产品代码零改动；`fixtureRecord`、`watchKills`、`killAll` 与各 K 格的断言、时限不动。
- 只改这一个测试文件；别的套件里同形的固定等待不在本题（未见同类偶发红登记）。

## 1. 改了什么

1. `test/integration/cancel-grace-unverifiable.test.ts`
   - `PROGRAMS` 增 `slowIgnore`（只给 R1 用）；
   - 增 `READY_MARK`、`READY_TIMEOUT_MS`，`spawnMarked` 改为等就绪标记（见 §0 修法 1、2），文档块写明原先固定等待的问题；
   - 增 `EV-217 R1（夹具）` 一格；文件头注释补一句夹具等就绪。
2. 文档：主设计 v1.3.95；BACKLOG EV-217 结案（本批未走双审）；本报告登记进 `doc/05_testing/README.md`。

## 2. 过程中的事

1. **停过一次**（停止条件 2）：变异逐条预跑期间（2026-10-05 15:48:58Z）工作树出现非执笔方产生的改动 `doc/01_requirements/原始需求.txt`（末尾追加「20261005需求」）。按批次规则停下报告；用户回复「接着做继续这批」后继续。该文件不随本批任何提交。
2. **成因没有复现**：本题没有在改前树上造出 K-K3 的偶发红（那要靠高负载撞）。R1 把同一形态（处理器装得慢）确定地造出来，证明的是新夹具不再依赖启动时长；对 K-K3 是否就此不再偶发红，以后续全量读数为准。

## 3. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 `tsc --noEmit` | 退 0 | 全量内含 |
| 套件单跑（先 `build.mjs --with-tests`） | 17/17（改前 16，新增 R1） | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`） | M1（退回固定等 150 ms）、M2（就绪标记挪到程序正文之前）各红 1 条，均为 R1 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 `scripts/mutation-check.mjs` | 2/2 咬住（fail 1 / 1），目标文件逐字节恢复 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 文档定稿前全量 `npm run check` | 2833 / 2831 / 0 / 2，退 0（较起点多新增的 1 格；K-K3 通过） | `check-1.txt`、`load-check-1.txt` |
| 文档定稿前全量期间临时目录新建 | 1，为 `trivium-index-`；除它外为 0 | `count-new-check-1.txt` |
| 文档定稿后全量第 1 次 | 2833 / 2831 / 0 / 2，退 0；K-K3 5.7 s、K-K4 10.2 s（负载约 12） | `check-2.txt` |
| 文档定稿后全量第 2 次 | 2833 / 2831 / 0 / 2，退 0；K-K3 5.6 s、K-K4 10.1 s（负载 1 分钟 8～9、5 分钟均值升到约 22） | `check-3.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 文档定稿后临时目录新建 | 全量 1 期间 0、全量 2 期间 2（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-check-2.txt`、`count-new-check-3.txt`、`count-new-selftest.txt` |

变异表：

| 编号 | 变异 | 结果 |
| :--- | :--- | :--- |
| M1 | `spawnMarked` 退回固定等 150 ms，不等就绪标记（改前形态） | 红 1：R1 |
| M2 | 就绪标记挪到程序正文之前打（处理器还没装就报就绪） | 红 1：R1 |

## 4. 提交前自审

- 注释与文档：自审时发现 `spawnMarked` 文档块写成了「K 格偶发红的成因」，改为「推断成因，按读数推断、未实测复现」（只改注释，改后重建并单跑该套件 17/17，见 `suite-2-after-comment.txt`；两次全量在此之前）。设计 v1.3.95、BACKLOG 落地记要同样只说推断。
- 断言范围：K 格与 T、W 格的断言、时限一字未改；R1 只断言夹具自身的契约（返回时处理器已装好）。
- 护栏表：不涉及 `locateSubject` 一类调用点，也没有新建临时目录（夹具进程不写盘，`scratch-guard` 无需登记）。
