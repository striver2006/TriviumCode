# K 格偶发红甄别 · 实施报告（EV-201，合并入 EV-217 结案）

> - **日期**：2026-10-06
> - **主题**：`K格偶发红甄别`（M11 前待办第二批第 4 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审）
> - **起点**：`eb41fdc`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/k-cell-flake-triage-20261006/`
> - **配额**：零配额
> - **题意**：用户定「先甄别：核是否已被 EV-217 收口；是则合并结案，不是则按读数定修法」

## 0. 动手前：现状、甄别依据与边界

### 现状（已核）

1. **EV-201 的两次红**（BACKLOG EV-201；读数 `doc/05_testing/evidence/zcode-probe-arm-cleanup-20261003/check-3.txt`、`check-4.txt`）：`EV-176 K-K4` 红在「SIGKILL 之后应拦到（桩自证）」为 false，耗时 **592 ms**；`EV-176 K-K3` 红在期望信号序列 `['SIGTERM', 'SIGKILL']` 实得 `['SIGTERM']`，耗时 **524 ms**。同一批读数里这两格通过时耗时稳定在 K-K3 约 **5.73～5.75 s**、K-K4 约 **10.19～10.22 s**（`check-1.txt`、`check-2.txt`、`check-5.txt`）——两格都要先熬满 5 s 宽限才发 SIGKILL。
2. **两格用的夹具程序**：`test/integration/cancel-grace-unverifiable.test.ts` 的 K-K3、K-K4 都是 `program: 'ignore'`（`PROGRAMS.ignore` 先执行 `process.on('SIGTERM', () => {})`），即依赖「SIGTERM 处理器已装上」。
3. **EV-217 的成因与修法**（BACKLOG EV-217、`REPORT_2026-10-05_cancel_grace_ready.md`）：`spawnMarked` 拉起夹具后只固定 `sleep(150)`，高负载下 SIGTERM 会落在处理器装上之前，夹具按缺省处置当场退出——于是不必升级 SIGKILL，格子约 0.5 s 就结束、`sent` 只有 `SIGTERM`。EV-217 当时的失败读数（500 ms、720 ms、只有 `SIGTERM`）与本条两次红**同一形态**；修法是夹具装好处理器后打就绪标记、`spawnMarked` 等到它再返回（提交 `bb661c60`）。
4. 两次红对上 EV-217 的形态：K-K3 实得 `['SIGTERM']`、约 0.5 s——工作进程收 SIGTERM 即退，正是处理器未装上；K-K4 的桩在 SIGKILL 时才布防（`onKill: () => stub.arm()`），没发 SIGKILL 就没布防、拦不到——「SIGKILL 之后应拦到」为 false 是同一事件的另一面，同样约 0.5 s。

### 甄别依据（补一份读数）

- EV-217 修复之后（`bb661c60..` 起）入库的全部全量读数逐份扫 K 格红（只读脚本 `scan-k-cells.mjs`）：见 §2。

### 结论与边界

- 判为**已被 EV-217 收口**，EV-201 合并入 EV-217 结案；不改代码与用例。
- 如实保留：EV-217 的成因本身是按读数推断（当时未在改前树上复现），本条沿用同一推断；修复后读数无复发只能说明「没再见到」，不是证明。若再红，按 EV-201 原触发条件重开。

## 1. 改了什么

只改文档：BACKLOG EV-201 改判「已关闭（合并入 EV-217）」并写甄别结论；主设计 v1.3.107 版本行（正文不改）；本报告登记索引。证据目录放只读扫描脚本 `scan-k-cells.mjs` 与它的输出。代码与用例零改动。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| EV-201 两次红的形态 | K-K4 592 ms、K-K3 524 ms（只见 SIGTERM）；同批通过时约 10.2 s / 5.7 s | `../zcode-probe-arm-cleanup-20261003/check-1～5.txt` |
| EV-217 修复（`bb661c60`）之后入库的全量读数 | 22 份，K 格红 0 次（另 1 份非全量读数不计） | `scan-k-cells-output.txt` |
| 全量第 1 次 `npm run check` | 2877 / 2875 / 0 / 2，退 0；K 格全绿 | `check-1.txt` |
| 全量第 2 次（串行） | 2877 / 2875 / 0 / 2，退 0；K 格全绿 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 2、全量 2 期间 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

变异：本题不改代码，无变异对象。

## 3. 提交前自审

- 结论只说「与 EV-217 同一形态、修复后未复发」，没有升级成「已证明」；EV-217 当时就注明成因是按读数推断。
- 本题未命中任何等触发条目的触发条件。
