---
schema: trivium.disposition.v1
topic: M10-任意Driver
stage: code
role: claude
kind: response
run_id: 20260923T091257Z
addresses:
  - CODEX-01
  - CODEX-02
  - GLM-01
  - GLM-02
  - GLM-03
---

# 应答：M10a 第 3 步（翻 driverEnabled + approve 前置复核）代码双审 第 4 轮

> 被审对象：相对 `82773dc` 的 25 个文件变更，补丁 111.2 KB ｜ 运行 `20260923T091257Z`
> ｜ 三侧均结构化产出 ｜ 结论：gemini `approve`，codex 与 glm `approve-with-nits`
> ｜ 共 5 条：次要 3 ｜ 吹毛求疵 2 ｜ 无阻断、无重要

## 总述

三侧对两块都给出了正面结论：
- **块一**：收紧收得干净。缺省分支与继承后的再解析走同一个判定；两个分支的报错清单都按 Driver 口径派生；三处标注分支已删除，删除后没有调用方仍依赖旧语义；限定只作用于入口的表述如实。
- **块二**：复核判定只有一份，两处共用，任何分支都没有跳过路径。`verifiedRunId` 不会放行空值，注释没有夸大。出口文案经 A4 / A4′ 实测走通；rejected / abandoned 不受影响。

5 条全部接受，分三类：

1. **测试报告里一句不成立的理由挡住了一格该补的覆盖（CODEX-01）**。
   报告 §2 第 3 行说「集成用例走打包 CLI，注入不了注册表，未启用的那一家构造不出来」。
   核对后不成立：`test/fixtures/stub-agent-kit/overlay.ts` 会往**真实注册表**追加一家
   `driverEnabled: false` 的第五家并重打包，`stub-agent-kit.test.ts` 用它跑真实 CLI。
   后果是本步最该端到端守住的那一格没有任何判据，即 `cli.ts:565` 继承之后的那次再解析（偏差 4 特意保留的调用）。
   把它删掉，全部用例照样绿。这正是本仓点名过的「函数级全绿、真实调用点没接」。
   这又是一次**把没核实的判断写成事实**，r3 卷首第 4 条要防的就是它，只是这次出现在我自己的报告里。
2. **恢复指引在审批停点的常态下走不通（CODEX-02）**。
   篡改清单只给了 `git restore`，但停点上本轮工件通常**尚未提交**：`git restore` 对未跟踪路径会直接失败，
   `missing` 的那份也没有任何副本。真正的出口（放弃或重跑）只以次选口吻出现。
   这和我修过的「给出走不通的出口」是同一类问题。
3. **报告的完备性（GLM-01 / GLM-02 / GLM-03）**：
   - 三处与 r3 的细小出入漏登；
   - 「交接文件的 driver 没有消费方」字面上不对：`handoffDriver` 读了这个字段，只是 worker 侧再没有人读 `opts.driver`；
   - 复核不查「未登记件混入」这条边界漏列。

**闸门期不改代码。** 以下落点在 `/dual-approve` 之后实施。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核对属实：`overlay.ts` 用 `rec.edit` 往 `registry.ts` 追加一项 `driverEnabled: false` 的桩并重打包，`stub-agent-kit.test.ts` 用真实 CLI 跑三审。所以「集成层构造不出来」不成立。`driver-wiring.test.ts` 的 TARGETS 里没有 `resolveDriver` 锚点，`cli.ts:565` 那次再解析删掉后全绿。报告用一句不成立的可能性当作不补的理由 | ① `test/integration/stub-agent-kit.test.ts` 在同一夹具树里补一格：`topic resolve --driver <桩>` 退 64，报错里「可用作 Driver」的清单不含桩；若同一夹具能以较低成本构造继承来源（claim 声明被 64 拦住时，就按 `drivers[plan]` 的留痕形态直接写夹具），再补「不传 `--driver`、继承到桩 ⇒ `review --start` 退 64」一格，构造不了则照实写进报告。② 不论 ① 能否覆盖继承格，都在 `test/unit/driver-wiring.test.ts` 加一条源码级判据：`cmdReview` 与 `resolveTopicArgs` 在「显式值优先、缺席即继承」之后，必须对**最终的 driver** 调一次 `resolveDriver(`，锚在实参块上，删掉即红。③ 变异补一条「删掉 cli.ts 继承后的 `resolveDriver(driver)`」，用例必须变红。④ 测试报告 §2 第 3 行改写，并在 §0 记一笔这次误判 |
| CODEX-02 | codex | minor | 接受 | 属实：`git restore` 只作用于 git 认识的路径。停点上本轮审查工件通常尚未提交（本仓惯例是审批后才提交），照指引跑必然失败；`missing` 那一格更是没有副本可恢复。唯一走得通的出口是放弃或重跑，却被写成次选 | `src/trivium/gate.ts` 的 `renderTamperedArtifacts` 改为分档：「**若该工件已提交过**，可在终端用 `git restore <路径>` 恢复（常规写法在会话里会被 hook-pre-bash 拦下，判据是启发式、不完备，绕过属违规）；**尚未提交的（审批停点上的常态）或已丢失的没有副本可恢复**，出口是 `/dual-abandon` 作废这一轮后重跑（重跑按 `-r<N>` 抬升，既有工件不覆盖）」。渲染函数拿不到 git 状态，所以两档并列写清，不猜。A3 断言补上「出口含 dual-abandon」。不与 `hooks.ts` 那份合并：本轮不动安全关键文件的理由不变，两份展示文案的分叉登记在报告偏差 3 |
| GLM-01 | glm | nit | 接受 | 属实：`ApprovalCheckResult` 多了 `rerunIndex`；未启用分支在缺省情形下有追加后缀；`--await-approval` 的 `unreadableRunMeta` 文案有扩写。这三处都没登记，而报告自称以自身为双审对照基准 | 测试报告 §2 补一行「返回形状与两处文案的细小扩写」，三处逐一列出，并写明都不影响行为 |
| GLM-02 | glm | nit | 接受 | 属实：`handoffDriver` 会读交接文件的 `options.driver`，写进 `opts.driver`，所以「字段没有消费方」这句字面上不对。准确的说法是 worker 进程里没有代码读 `opts.driver`：它的消费点（`review.ts:273` / `:543`）只在 `--start` 侧执行。结论成立，但措辞把一个有读者的字段说成了没有读者 | 测试报告 §3 首条改为：「交接文件的 driver 由 `handoffDriver` 读进 `opts.driver`，而 `opts.driver` 在 worker 进程内没有读者（消费点只在 `--start` 侧的 `prepareRun` / `resolveTaskGoal`），不构成通道」 |
| GLM-03 | glm | minor | 接受 | 属实：复核只正向核对已登记工件是否存在、是否被改（`checkRecordedArtifacts`），不查反方向，即停点之后有人往阶段目录塞进一份带审核者后缀、却不在任何 `artifacts[]` 里的伪审查件。这一面只由 `gate --check-artifacts` 与提交锚守着。文档对复核范围的表述本身如实，但报告 §3 没列这条边界，「本轮工件未被改」容易被读成「本轮工件集可信」 | 只登记，不改代码：测试报告 §3 补一条「复核不含未登记件混入检查（`checkStageArtifacts` 的反向检查没有并入）；伪审查件不影响裁决齐备判定，这一面仍由 `--check-artifacts` 与提交锚守」。USAGE 与 PROTOCOL 的复核语义不扩写。不并入的理由：它会改变复核的语义边界，需要同步契约面与用例，超出本步范围；若要并入，另开条目 |

## 实施后的核对口径

- 执行 `npm run typecheck && npm run build && node scripts/build.mjs --tests-only && npm test`，要求全绿；
- 变异规格追加 M6（删掉继承后的 `resolveDriver(driver)`），与原来 6 条一起重跑装置，结果写进报告 §1；
- 按用户指令，下一轮代码双审是否再跑，由用户决定。
