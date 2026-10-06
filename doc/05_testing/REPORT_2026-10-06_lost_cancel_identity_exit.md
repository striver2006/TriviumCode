# 失联取消身份判不上 / 缺失也退 69 · 实施报告（EV-177 ② 补）

> - **日期**：2026-10-06
> - **主题**：`失联取消两格退69`（M11 前待办第三批第 2 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`5533252`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/lost-cancel-identity-exit-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定——失联取消的 `mismatch` / `no_identity` 两格也改退 69（「这次没做收尾、状态原样、可重试」同样成立），播报文字不变（BACKLOG EV-177 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/run-protocol.ts` `cancelRun` 终态分支（:1946 起）先 `classifyLostCancel(s)` 判格：`alive` 交给 `cancelLostWorker`（EV-177 ② 起未确认退出退 69）；`gone` 交给 `finalizeGoneWorker`；`mismatch`（:1981 起）stderr 告警按比对依据分写、stdout 结论句「……但工作进程的身份与记录不符，未对工作进程与它名下的审查员 CLI 发信号；归档 run.json 与主题锁未动。」后 `return EXIT.OK`（:1997）；`no_identity`（:1999 起）stderr「……判不了是不是同一进程，不发信号——请用 ps 核对」、stdout「……没记下可核对的工作进程身份，未对工作进程发信号；归档 run.json 与主题锁未动。」后 `return EXIT.OK`（:2002）；`none` 走「已处于终态，无需取消」退 0（:2006）。`cli.ts` 把 `cancelRun` 的返回值直接作退出码。
2. 用例：`test/integration/run-protocol.test.ts` 的 `notThisCell`（:947）对所有调用一律断言 `EXIT.OK`；它的调用里属于这两格的有 EV-146 K5 ④（mismatch，R-K5-4）与 ⑤（no_identity，R-K5-5a～5d）、K5′ 的 mismatch 段（R-K5P-M）、EV-158 U9 两次（R-C158-U9-C / -L，mismatch 的 canonical / legacy 两种依据）。`none` 的四次（R-K5-1/2/3/6）仍应退 0。`gate-loop` EV-158 I6 只断言「不判 mismatch」，不涉退出码。
3. 写着这两格退 0 的落点：PROTOCOL `review --start / --wait / --status / --cancel` 行「退出码仍为 0，唯一的例外：……」；LLD 4.2「`cancelRun` 结束失联后仍挂着的 worker」引述块「确认退出（含 `gone` 格）退 0，`alive` 格未确认退出以 69 退出」一句（没写两格，但「唯一例外」口径要同步）；用户手册场景 4 失联那一段「后两种情形 stdout 会说……」（没写退出码）；`run-protocol.ts` 两格处的注释与 `LostCancelCell` 文档块没写退出码。

### 修法

1. `mismatch`、`no_identity` 两格的 `return EXIT.OK` 改为 `return EXIT.ENV`（69），各加一行注释说明同码理由；stderr 告警与 stdout 结论句逐字不变。
2. `notThisCell` 加可选参数「期望退出码」（缺省 `EXIT.OK`），两格的调用点传 `EXIT.ENV`，用例名同步补「退 69」。
3. PROTOCOL、LLD（v1.1.44）、用户手册（v1.0.37）同步；设计版本行 v1.3.115。

### 不改的边界

- `none` 格（「无需取消」）、`gone` 格、`alive` 格确认退出仍退 0；`alive` 格未确认退出（EV-177 ②）已是 69，不动。
- 播报文字、信号处置（两格都不对工作进程发信号；mismatch 不结束 CLI、no_identity 照走终态分支自己的判断）、归档与锁一概不动。

## 1. 改了什么

1. `src/trivium/run-protocol.ts` `cancelRun` 终态分支：`mismatch` 与 `no_identity` 两格的 `return EXIT.OK` 改为 `return EXIT.ENV`（69），各加一行注释；stderr 告警、stdout 结论句、信号处置一字未动。
2. 用例：`test/integration/run-protocol.test.ts` 的 `notThisCell` 加第三个参数「期望退出码」（缺省 `EXIT.OK`），文档块写明哪几格是 0、哪几格是 69；EV-146 K5 ④（mismatch）与 ⑤（no_identity 四种形状）、K5′ 的 mismatch 段、EV-158 U9 的 canonical / legacy 两次传 `EXIT.ENV`；K5 与 U9 的用例名补「退 69（EV-177 ② 补）」。`none` 格的四次调用（R-K5-1/2/3/6）仍按缺省断言 0。
3. 文档：主设计 v1.3.115（7.5「失联后取消挂住的工作进程」段退出码一句）；LLD v1.1.44（4.2 引述块）；PROTOCOL（`--cancel` 行「退出码仍为 0，唯一的例外」改写为两种 69）；用户手册 v1.0.37（场景 4 失联那段「后两种情形」补退出码）；BACKLOG EV-177 ② 补结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑 run-protocol 套件 | 49/49（改的是既有格，数不变） | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`） | M1（mismatch 退回 0）红 3 格（K5、K5′、U9）；M2（no_identity 退回 0）红 K5；M3（无需取消也退 69，范围扩大）红 K5 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 3/3 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量第 1 次 `npm run check` | 2883 / 2881 / 0 / 2，退 0 | `check-1.txt` |
| 全量第 2 次（串行） | 2883 / 2881 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 两次全量期间分别 1、2（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：`grep` 复核写着失联取消退出码的落点——主设计 7.5、LLD 4.2、PROTOCOL、手册都已补两格；v1.3.101 / v1.3.105 版本行与报告是历史记录，未改。`run-protocol.ts` 里 `cancelLostWorker` 文档块的退出码一段只讲 `alive` 格，仍准确。
- 断言范围：只把两格的「退 0」改成 69；`none` 格仍由 K5 ①②③⑥ 守着 0（M3 证明），`gone` 与 `alive` 确认退出的断言未动。
- 范围：没有改播报文字、信号处置、归档与锁；没有动 `none` 格。本题无新增护栏登记调用点。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
