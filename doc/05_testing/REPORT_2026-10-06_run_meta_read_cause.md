# 留痕读不出的成因 · 实施报告（EV-04）

> - **日期**：2026-10-06
> - **主题**：`留痕读不出的成因`（M11 前待办第二批第 1 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`8c5d404`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/run-meta-read-cause-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定取候选 B（BACKLOG EV-04 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/meta.ts` :657 `readRunMeta`：读文件或 `JSON.parse` 失败（`catch` 不分 `ENOENT` 与其它）、`schema` 既不是 `trivium.run.v2` 也不是 `trivium.run.v1`、对应契约校验不过，一律 `return null`。调用方拿到的只有一个 `null`，分不出「文件不存在」与「文件在但读不出」。
2. 两处**硬失败出口**把三档成因并列、不说是哪一档：
   - `src/trivium/gate.ts` :1541 `verifyRoundForApproval`（`--await-approval` 与 `approve` 的复核）：`${APPROVAL_CHECK_META_UNREADABLE}（文件缺失、内容损坏，或不合 run.v1/v2 契约）。` 后接调用方给的 `recovery.unreadableRunMeta`（`awaitApprovalRecovery` / `approveForkRecovery`，两者末尾都是 `unreadableRunMetaExitAt` 拼出的共用出口段），退 `EXIT.MISSING_ARTIFACT`。
   - `src/trivium/cli.ts` :1115 `cmdGate` 的 `--run-id` 钉住读不出：`--run-id … 的运行元数据读不出来（文件缺失、内容损坏，或 schema 不识）。` 加「请确认归属」一行，再接 `unreadableRunMetaExitAt`，退 `EXIT.MISSING_ARTIFACT`。
3. **宽松出口**在 `src/trivium/report.ts`：:237 `buildRoundReport` 的注记「`_meta/run-<id>.json` 读取失败」；:484 `collectUnlistedRuns` 的注记「`<stage>/_meta/<文件>` 读不出来（不可解析或不合契约），未列入报告」——两处都不带成因。（:155 `roundRunIds` 读不出即跳过、不出注记，不在本题。）
4. 约束：硬失败出口属 EV-148 定下的「七处语义同源」，由 `test/helpers/unreadable-exit.ts` 的 `assertUnreadableExit`（含共用出口段逐字子串、逐行列出绝对路径、不出现循环出口）与 `APPROVAL_CHECK_META_UNREADABLE` 判别文字一族用例约束（`test/unit/unreadable-run-exit.test.ts`、`test/unit/gate.test.ts`、`test/integration/gate-loop.test.ts`）。没有源码护栏按调用点数 `readRunMeta`（已 grep `test/`）。

### 修法（候选 B）

1. `meta.ts` 新增 `readRunMetaDetailed`：与 `readRunMeta` 同一条读取路径，失败时给出成因四档——`missing`（`ENOENT`）、`io`（文件在但读不了，如权限、是目录）、`unparsable`（不是合法 JSON）、`contract`（`schema` 不识，或不合 run.v1/v2 契约，带首条校验错误）。`readRunMeta` 改为调它、只取结果，**返回值与行为不变**。另导出 `describeRunMetaCause` 把成因写成一行。
2. 两处硬失败出口改调 `readRunMetaDetailed`，在**原有文字与共用出口段之间加一行**「本次判定：…」；原有文字、共用出口段、退出码一字不动。
3. `report.ts` 两处注记在原文之后补「（本次判定：…）」；注记仍是注记，报告照常出。

### 不改的边界

- 共用出口段 `UNREADABLE_RUN_META_EXIT_BODY` 与 `unreadableRunMetaExit` 不动；七处里另外五处（`review --start`、`topic claim`、`topic resolve`、`hook-pre-write`、`gate` 一份都读不出）不在候选 B 的范围内，不加成因行。
- 退出码不动；`readRunMeta` 的返回形状与所有既有调用点不动。
- `listRecordedRuns` 的 `unreadable` 标记、`latestRunMeta` 的扫描口径不动。

## 1. 改了什么

1. `src/trivium/meta.ts`：新增 `readRunMetaDetailed`、`describeRunMetaCause` 与类型 `RunMetaUnreadableCause` / `RunMetaReadResult`；`readRunMeta` 改为 `readRunMetaDetailed` 的薄包装（返回值与此前逐格相同，U4 第 1 格对四档读不出与一份读得出的 run.json 逐一核对）。成因细节只取首行、封顶 160 字（解析器消息会带一段原文）。
2. `src/trivium/gate.ts` `verifyRoundForApproval`：改调 `readRunMetaDetailed`，读不出时在原首行之后、调用方出口之前加 `  本次判定：…。` 一行。
3. `src/trivium/cli.ts` `cmdGate`：`--run-id` 钉住那一格改调 `readRunMetaDetailed`，在原有两行之后、`unreadableRunMetaExitAt` 之前加同一行。
4. `src/trivium/report.ts`：`buildRound` 与 `collectUnlistedRuns` 两处注记原文之后补「（本次判定：…）」。
5. 用例：`test/unit/unreadable-run-exit.test.ts` 新增 U4 共 6 格（四档判据与等价性、细节封顶、四档文案、审批复核三种成因 × 两种调用方出口）；`test/unit/report.test.ts` 新增 1 格（schema 不识 ⇒ 不合契约）、扩 V6（坏 JSON ⇒ 不是合法 JSON）；`test/integration/gate-loop.test.ts` 扩 T-12（经真实 bundle：钉住 schema 不识的那份 ⇒ 不合契约且位于原文之后、共用出口段之前；钉不存在的 run_id ⇒ 文件不存在、退出码不动）。
6. 文档：主设计 v1.3.104、LLD v1.1.41（模块表）；BACKLOG EV-04 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 单跑两份单测（先 `build.mjs --with-tests`） | 44/44（起点 37，新增 7 格） | `suite-unit.txt` |
| `gate-loop` 单跑 | 首跑 103/104：T-12 红在我新写的断言——误以为钉住的 `20260101` 那份是坏 JSON，实为 schema 不识（输出本身正确，见该文件末尾失败文案）；改断言后 `--test-name-pattern T-12` 单跑 1/1 | `suite-gate-loop-first-red.txt`、`suite-gate-loop-t12.txt` |
| 变异逐条预跑（带 `--test-timeout`） | 5/5 红（M4 经 gate-loop 299 s） | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 5/5 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 变异装置之后的一处改动 | `io` 档细节去掉重复的错误码前缀（Node 消息自带）；不触及任何变异锚点（重生成规格核对唯一），两份单测重跑 44/44 | `suite-unit.txt` |
| 全量第 1 次 `npm run check` | 2868 / 2866 / 0 / 2，退 0（起点 2861 + 7） | `check-1.txt` |
| 全量第 2 次（串行） | 2868 / 2866 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 0、全量 2 期间 3（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：新注释只陈述实现了的行为；`buildRound` 那条注记只在竞态下可达（`enumerateRounds` 先按同一判据把读不出的筛掉、`runId` 为空走另一条注记），已在规格生成脚本与 BACKLOG 写明无用例，没有声称被测。
- 断言范围：既有断言一条未放宽；`assertUnreadableExit` 的判据不变，新格在其之上**加**「原文首行逐字相等」「出口段原样接在后面」两条。
- 范围：七处同源出口里另外五处没加「本次判定」——候选 B 只点了两处硬失败出口与 report 注记；没有顺手扩大。
- 护栏：本题没有新增 `locateSubject` 一类登记调用点；新用例临时目录全走 `scratchDir`；全程零配额。
- 触发条件：本题未命中任何等触发条目的触发条件。
