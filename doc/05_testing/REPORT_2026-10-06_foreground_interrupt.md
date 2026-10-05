# 前台中断结束审查员 CLI · 实施报告（EV-155）

> - **日期**：2026-10-06
> - **主题**：`前台中断结束审查员 CLI`（M11 前待办批次第 9 题；**本批未走双审**，用户以 `/goal` 授权直接开发、定「先零配额实测再定修法」，提交前由执笔方自审补丁）
> - **起点**：`352d46c`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/foreground-interrupt-20261006/`
> - **配额**：零配额（实测与用例的子进程替身是 `/bin/sleep` 与桩适配器 `hang_cli`）

## 0. 动手前：现状、实测、修法与边界

### 现状（已核）

1. 前台以 `run(…, { killTree: true })` 拉起子进程的路径：审查员适配器（`adapters/agy.ts` :113、`codex.ts` :121、`claude.ts` :412、`zcode.ts` :504）——同步 `review --stage` 在前台进程里直接跑它们；探针 / 探活（`probes/*.ts` 多处）——`doctor` 与 `preflight` 在前台跑。`killTree` 让子进程 `detached`（自成进程组），终端 Ctrl-C 的 SIGINT 只发给前台进程组，够不到它们。
2. 只有 worker 装了信号处理器（`run-protocol.ts` `installWorkerSigtermForwarding`，EV-152）；前台入口（`cli.ts` 的 `cmdReview` 非 worker 分支、`cmdDoctor`、`cmdPreflight`）一个都没装。
3. `shutdownTrackedTrees`（`util/exec.ts`）的契约：调用即本进程进入终止中、不可撤销，经 `run()` 的链路不再兑现，**调用方必须随后退出**（BACKLOG EV-155 引代码双审 r1 CODEX-02）。

### 零配额实测（动手前）

`probe-foreground-sigint.mjs`：脚本 detached 起一个「前台进程」，它用仓库构建的 `run()` 以 `killTree` 拉起 `/bin/sleep 30`；脚本向前台进程组发 SIGINT（终端 Ctrl-C 的形态），1.5 s 后看 sleep。

| 变体 | 前台进程 | sleep |
| :--- | :--- | :--- |
| `plain`（现状，不装处理器） | 被 SIGINT 结束 | **仍在，ppid 变 1**（过继给 init） |
| `handler`（装 SIGINT 处理器：`shutdownTrackedTrees` 后退出） | 退 130 | 已不在 |

形态与 BACKLOG 的推断一致：前台被 Ctrl-C 时遗弃以 `killTree` 拉起的 CLI，它的超时计时器随前台进程一起没了。

### 修法

1. `run-protocol.ts` 新增导出 `installForegroundInterruptForwarding()`：同时接 SIGINT 与 SIGTERM，只处理第一次——
   - 本进程没有登记中的进程树（`trackedTrees()` 为空）⇒ 立即移除监听、以同一信号重新自杀，退出形态与缺省处置相同；
   - 有 ⇒ stderr 播报一行，起看门狗（`WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 500` ms），`shutdownTrackedTrees` 按组结束它们（与 worker 处理器同一组参数），再以同一信号重新自杀；
   - 第二次信号 ⇒ 不再等，立即以该信号退出（用户坚持要走，CLI 可能留下，播报里写明）。
   重新自杀失败的病态兜底：1 s 后 `exit(130 / 143)`。
2. 接线：`cmdReview` 在 worker 分支**之后**（worker 有自己的 SIGTERM 处理器，不重复装）、`cmdDoctor`、`cmdPreflight` 开头各调一次。
3. 用例：子进程里直测处理器（有树 / 无树 / SIGTERM）；端到端经真实 bundle 跑同步 `review --stage plan`，两侧 `hang_cli` 桩各拉起一个带标记的进程组，向 CLI 进程组发 SIGINT ⇒ CLI 以 SIGINT 退出、两组都结束；源码护栏钉住 doctor / preflight 的接线。

### 不改的边界

- 不改中断后的留痕：同步路径被 Ctrl-C 后 run.json 仍停在 `running`、闸门 running（由会话启动清扫回收闸门），与今天相同——那一半归 EV-151（论证已写，待拍板）。
- 不改退出形态（仍是被信号结束，shell 显示 130 / 143）；不改 worker 的处理器；`verify` 不装（它不以 `killTree` 拉起子进程，子进程在前台进程组里，本就收得到 Ctrl-C）。

## 1. 改了什么

1. `src/trivium/run-protocol.ts`：新增导出 `installForegroundInterruptForwarding()`（见 §0 修法 1），放在 `installWorkerSigtermForwarding` 之后，复用 `WORKER_TREE_GRACE_MS` / `WORKER_TREE_KILL_WAIT_MS`、`trackedTrees`、`shutdownTrackedTrees`。
2. `src/trivium/cli.ts`：导入它；`cmdReview` 在 `return workerMain(…)` 之后、`cmdDoctor` 与 `cmdPreflight` 开头各调一次（不卸：处理器执行后本进程必定退出）。
3. `test/integration/foreground-interrupt.test.ts`（新）：F1～F3、E1、G1（见 §0 修法 3）。F 系列在 detached 子进程里装处理器（处理器执行即冻结 `run()`、不可撤销，不能在测试进程里跑），树的标记经环境变量传、不进场景子进程自己的 argv；E1 经仓库 bundle 跑同步 `review --stage plan`，两侧 `hang_cli` 桩以 `killTree` 拉起带 `trivium-stub-cli:<out_dir>` 标记的组，按夹具运行根认组。所有用例 `finally` 按组 SIGKILL 收尾。
4. 证据：`probe-foreground-sigint.mjs` 与两种变体的输出。
5. 文档：主设计 7.5「工作进程的信号语义」覆盖不到的格里 EV-155 改为已覆盖、新增「前台入口的中断语义」段，v1.3.102；LLD v1.1.40；用户手册 v1.0.33（取消一节末尾补「按 Ctrl-C」一条）；BACKLOG EV-155 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 零配额实测 | `plain`：前台被 SIGINT 结束，sleep 仍在、ppid 1；`handler`：前台退 130，sleep 已不在 | `probe-foreground-sigint.*.out.txt` |
| 类型检查 | 退 0 | 全量内含 |
| 新用例单跑（先 `build.mjs --with-tests`） | 5/5（全为新增）；首跑 3 格红在用例写法（场景子进程 argv 带了标记被自己数进去；E1 给 CLI 多传了位置参数被拒），改用例后全绿，产品代码未动 | `suite-1.txt` |
| 变异逐条预跑 | M1（review 不装）红 2：E1、G1——E1 红即改前形态会遗弃两侧的组；M2（doctor 不装）红 1：G1；M3（不看登记树、一律立即退出）红 3：F1、F3、E1；M4（不调 `shutdownTrackedTrees`）红 3：F1、F3、E1 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 4/4 咬住 | `mutation-output.txt`、`mutation-spec.json` |
| 全量第 1 次 `npm run check` | 2861 / 2859 / 0 / 2，退 0（较起点 2856 多新增的 5 格） | `check-1.txt` |
| 全量第 2 次（串行） | 2861 / 2859 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle，入口已装处理器） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1、全量 2 期间各 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：`cmdReview` 处的注释起草时写了「`--start` 的探活」，没核实 `--start` 前台是否以 `killTree` 拉起子进程，改为只说核实过的（同步审查）与「无登记树时等同缺省处置」。手册「至多约 4 秒」= 2 s 宽限 + 1 s 强杀确认 + 0.5 s 余量向上取整。
- 断言范围：既有用例一条未改。经 CLI 入口跑的用例（`doctor --selftest`、集成用例里起 bundle 的 `doctor` / `preflight` / `review`）都在装了处理器的入口上跑，它们不发信号，处理器不触发；直调 `runDoctor` / `runPreflight` 的单测不经入口、不受影响。（这一句起草时写成「全量里 doctor / preflight 的用例都在装了处理器的入口上跑」，说宽了，全量跑完后订正。）
- 契约：`shutdownTrackedTrees` 只在本处理器里调、调用后经 `exitOnce` 必定退出（看门狗兜底）；没有登记树时不调它，不冻结任何东西。
- 护栏：新用例不建临时目录（E1 的夹具走 `makeFixture`，随测试文件进程退出删除）；所有子进程按组收尾，单跑与预跑后核过无残留（`pgrep` 标记为空）。
