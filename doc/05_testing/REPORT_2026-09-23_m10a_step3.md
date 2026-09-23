# M10a 第 3 步测试报告 · 翻开 `driverEnabled` 与 approve 前置复核

- **日期**：2026-09-23
- **依据**：`.reviews/M10a-第3步/plan/2026-09-23-M10a-第3步-r3-claude.md`（下称「r3」）。计划双审共两轮：r1 13 条、r2 8 条，全部接受并获批。第 2 轮审批附言为「形成 r3 计划后直接开工」，因此 r3 未再送计划双审。上位依据是 M10 计划 r7 §4 / §8。
- **基线**：HEAD `82773dc`，加上本步工作区改动。
- **本报告存在的理由**：r3 §6 要求的全量回归、变异结果、偏差与缺口都记在这里。代码双审前的改动说明也以本报告为准。

---

## 0. 全量回归

| 项 | 结果 |
| :--- | :--- |
| 改动前基线（开工第一件事复跑） | **1673 条：1671 通过 / 0 失败 / 2 跳过**，与第 2 步报告一致 |
| `npm run typecheck` | 通过 |
| `npm run build` + `node scripts/build.mjs --tests-only` | 通过 |
| `npm test` | **1691 条：1689 通过 / 0 失败 / 2 跳过**。比基线多 18 条，已逐条核对新用例名出现在输出里，排除跑的是旧 `dist/test` 的可能 |
| `npm test`（代码双审 r4 修订后） | **1694 条：1692 通过 / 0 失败 / 2 跳过**。比上一版多 3 条：kit ④、`driver-wiring` 两处入口的源码判据。改动后按规程再次先 `diff -rq`（只有打包件内容不同）再 `install:local`，装完逐字节一致；`doctor --selftest` 再跑一次 14/14 通过 |
| `npm run install:local` | 已执行。执行前逐个 `diff -rq skills/<d> ~/.claude/skills/<d>`（8 个 skill）以及 Antigravity agent 定义，结果是只有 `dual-critic/scripts/trivium.cjs` 内容不同，没有文件增删；装完复核，已装副本与仓库产物逐字节一致 |
| `trivium doctor --selftest` | **14/14 通过**：缺省 Driver 路径没有退化。**注意，自检流程里没有 approve 这一步**，审批链路靠下面的集成用例覆盖 |

---

## 1. 变异验证

**方法**：变异写成一份规格（最初 6 条，代码双审 r4 之后加 M6a～M6d 共 10 条），由 `scripts/mutation-check.mjs` 执行（r3 §6.2，计划双审 r1 CODEX-06）。
装置有五道闸：全路径备份、构建失败时非零退出、基线全绿、被测产物确实变了、恢复后逐字节比对。
它用 `build.mjs --with-tests` 重建，所以集成套件用的打包件也带上了变异。
套件：`gate.test` / `approval.test` / `critics.test` / `gate-loop.test`，r4 之后再加 `driver-wiring.test` / `stub-agent-kit.test`。每次运行的基线都是全绿。跑完后工作树已恢复，哨兵已删除，属于善终。

| id | 变异 | 期望变红 | 结果 |
| :--- | :--- | :--- | :--- |
| M1 | approve 跳过复核：删掉 `cmdApproval` 里的复核调用，`verifiedRunId` 直接取 `gate.run_id` | gate-loop 的 A1～A3 | ✓ 咬住（fail=5） |
| M2 | 跳过 sha256 抽核：`checkRecordedArtifacts` 那一步换成空结果 | A3、A3′ | ✓ 咬住（fail=2） |
| M3a | 只让第 1 步失效：去掉 `!runId` 的抛错，null 落到第 2 步 | gate.test 的 null 用例 | ✓ 咬住（fail=1） |
| M3b | `if (runId)` 跳过式写法：null 时整个校验体被跳过，直接返回 ok | 同上 | ✓ 咬住（fail=1） |
| M4 | `resolveDriver` 的 64 分支改回放行 | critics.test 的桩用例 | ✓ 咬住（fail=4） |
| M5 | 删掉 `verifiedRunId` 绑定 | approval.test 的绑定单测 | ✓ 咬住（fail=2） |
| M6a | `review --start` 继承之后不再过 `resolveDriver`（`cli.ts`） | kit ④（打包 CLI 端到端） | ✓ 咬住（fail=1） |
| M6b | 同上 | `driver-wiring` 源码判据 | ✓ 咬住（fail=1） |
| M6c | `topic resolve` 继承之后不再过 `resolveDriver`（`topic-args.ts`） | kit ④ | **第一次 ✖ 没红** → 修用例后 ✓ 咬住（fail=1） |
| M6d | 同上 | `driver-wiring` 源码判据 | ✓ 咬住（fail=1） |

**M1～M5 在两次整套运行里都被咬住。M6 是代码双审 r4 之后补的，M6c 第一次没红**，经过如下：

- 第一次整套跑 10 条：9 条咬住，**M6c 没红**。原因是用例被别的防线掩盖：kit 夹具的 `default_critics` 含桩，继承到的 driver 也是桩时，选侧会以「含当轮 Driver」同样退 64，于是删掉那次再解析，继承格照样退 64。M6a 之所以变红，只是因为 `review --start` 那一格另外断言了报错文案。
- 这正是计划里反复防的「靠别的防线变红」，**我写 kit ④ 时自己又踩了进去**。修法：继承的两格都显式传 `--critics gemini,glm` 以排除选侧那道防线，并对两格都断言「尚未启用为 Driver」的文案。修完之后 M6 四条单独重跑，全部咬住。

另有几点需要说清：

- **装置只报每个套件的失败数，不报用例名。** M1 的 5 条是推断，不是逐条核实：A1～A3 是目标用例，另两条应是 A4 与 A4′，两者变红的原因不同。
  - A4：闸门 run_id 为 null，复核被跳过后传下去的是空串，`verifiedRunId` 绑定以退 2 拦下，与期望的 65 对不上。
  - A4′：闸门 run_id 指向一个不存在的运行，变异下原样当作 `verifiedRunId` 传下去，绑定判定一致而**放行**，approve 退 0。
    这正是「跳过复核」要防的形态：一个根本不存在的运行被批准了。

  其余各条的失败数与期望用例数一致。
- **M3a 正是计划双审 r1 CODEX-04 指出的那种形态**：如果单测只断言「会抛错」，这条变异不会变红，因为第 2 步也会抛。
  现在单测断言的是错误身份（第 1 步的判别文字在、第 2 步的不在），它才被咬住。

---

## 2. 与 r3 的出入（如实登记）

| # | r3 怎么写 | 实际怎么做 | 为什么 |
| :--- | :--- | :--- | :--- |
| 1 | §2.4 把 `registry.ts:20/29` 列为「现状断言型注释，本步改」 | 两处原文不动，头注释**追加**「M10a 第 3 步的变化」一节 | 两处分别位于「M7a 的边界」「M8 第 3 步的变化」小节里，按文件结构属于**历史叙事**。回改历史小节，等于把当年的叙事改写成今天的口径；追加一节才与文件既有写法一致。r3 的归类在这两处错了 |
| 2 | §2.4 把 `types.ts:634` 列入本步改 | 不改 | 原文是「claude 是 Driver（`driverEnabled: true`）」，翻开关之后依然成立，不是失实陈述 |
| 3 | §4.3 要求 `driver-flag.test.ts:132-150` 补一格注入表用例 | `driver-flag.test.ts` 只改用例名与注释、补「可用作 Driver」断言；注入格放在 `critics.test.ts`；**集成层那一格放在 `stub-agent-kit.test.ts` ④**（代码双审 r4 后补） | **本行初稿的理由不成立，已更正（代码双审 r4 CODEX-01）**：初稿写「集成用例走打包 CLI，注入不了注册表，未启用的那一家在真实注册表下构造不出来」。实际上 `stub-agent-kit` 夹具会往真实注册表追加一家 `driverEnabled: false` 的第五家，再重打包、跑真实 CLI。这句没核实的判断直接导致 `cli.ts` 继承之后那次再解析没有任何判据（删掉它，全部用例照样绿）。r4 之后补了三样：kit ④ 覆盖显式与继承两条路；`driver-wiring` 两处入口加源码级判据；变异 M6a～M6d |
| 4 | §2.3 删除 `cli.ts:561` 的标注分支 | 分支删掉，但**保留 `resolveDriver(driver)` 这次调用** | 继承来的 driver（run 留痕或 claim 声明）只在这里经过判定，未启用的要在这里退 64。r3 没写到这一点，实施时补上 |
| 5 | §3.3「未传视同不一致」 | 判据写成 `!verifiedRunId \|\| verifiedRunId !== gate.run_id` | 实施时发现：如果照字面写成 `(verifiedRunId ?? null) !== gate.run_id`，在闸门 run_id 为 null 且调用方没传时，`null === null` 会放行，正好是「没传就不比」的漏洞。已加单测锁住三种形态：未传、null、空串 |
| 6 | 未提及 | `driver-wiring.test.ts` 的「闸门区」接线用例跟着改写 | 它原本钉住「cli.ts 有 2 处 `checkAdjudication`、driver 取 `gateDriver`」。`--await-approval` 那一处随抽取移进了复核函数，driver 改为取本轮留痕的 `runMeta.driver`。判据没变（直读留痕，不从后缀反推），变的是落点：现在分别钉 cli.ts 的 1 处、复核函数里的 1 处，以及 cli.ts 里 2 处复核调用 |
| 7 | 未提及 | 篡改清单的渲染文案，恢复措辞改为与 `hooks.ts` 同源的「启发式、不完备、绕过属违规」 | **我初稿写的是「会话内的恢复命令会被 Hook 拦下」，把启发式判据写成了确定性保证。** 这正是第 2 步 r2 那条阻断的同族错误，自审时发现并改掉。登记在这里，是因为它说明这类错误在第三次仍会顺手写出来 |
| 8 | 未提及 | `resolveDriver` 在没传旗标、且注入表里没有缺省 Driver 时，报错写「缺省 Driver「x」不是已登记的 Agent」 | 原文案写的是「--driver 的取值」，这个说法在该格不准确。这种情形只会在注入表里出现 |
| 9 | 未提及 | USAGE 的 approve 段补了一句「复核保的是裁决齐备、本轮工件未被改，不保审批来自人」 | 与 `approval.ts` 头注释口径一致。MANUAL §8.2 那半句仍归第 5 步（EV-106） |
| 10 | §3.1 的返回形状，以及 §2.2、§3.2 的文案 | **三处细小扩写**（代码双审 r4 GLM-01 补登）：① `ApprovalCheckResult` 多一个 `rerunIndex` 字段，供 approve 失败文案写「第 N 轮」；② 缺省情形下未启用分支追加后缀「（未传 --driver，取的是缺省 Driver）」；③ `--await-approval` 的 `unreadableRunMeta` 扩写为带「新运行会落一份可读的运行元数据」的整句 | 三处都不影响行为，只是登记漏了 |
| 11 | 无 | 篡改清单的恢复出口**分两档**（代码双审 r4 CODEX-02）：尚未提交或已丢失的工件，出口是 `/dual-abandon` 作废后重跑；已提交过的，在终端里用 `git restore` 恢复 | 审批停点上本轮工件通常还没提交，只给 `git restore` 的话照做必然失败。渲染函数拿不到 git 状态，所以两档并列写出。**与 `hooks.ts` 提交锚那份同义文案的措辞因此分叉**：那份面对的时点以「已提交」为主。这一分叉并入偏差 3（展示文案的第二份） |

另记一笔：实施中撞上一次**已登记的 Bash Hook 误拦**。向 `gate-loop.test.ts` 追加用例时用了 heredoc，正文提到了状态文件名与角色后缀，
被 Hook 拦下。按 CLAUDE.md 的出口改用 Read / Edit 精确落文件。当时我一度把两个文件名在测试里拆成字符串拼接，随即意识到这种写法像是在躲判定，
改回直写，与同一文件的既有写法一致。Edit 本来就不看字面，拆写没有必要。

---

## 3. 没补的缺口

- **64 收紧只作用于经过 `resolveDriver` 的入口，不是全称保证。** 不经过它、也不校验 `driverEnabled` 的面有：`prepareRun` 内查表（只用于留痕）、
  Hook 的当轮 Driver 解析、历史 run.json、手工改写的 claim 声明。worker 交接文件里的 driver 由 `handoffDriver` 读进 `opts.driver`，
  但 `opts.driver` 在 worker 进程里没有读者：消费点只在 `--start` 一侧的 `prepareRun` / `resolveTaskGoal`，所以它不构成通道
  （计划双审 r2 CODEX-01 核实并撤回了 r1 的过度声明；这里的措辞按代码双审 r4 GLM-02 改准：初稿写「没有消费方」，而字段其实有读者）。
- **审批前复核不保证「审批来自人」**：approve 不校验调用来源。MANUAL §8.2 那半句按 r7 §6.2 归第 5 步。
- **抽核只核本轮**：更早轮次的登记由提交锚②在每次提交时全量核对。这是取舍，不是完备核对。
- **复核不查「未登记件混入」**（代码双审 r4 GLM-03 补登）：抽核只正向核对已登记工件是否存在、是否被改。
  停点之后如果有人往阶段目录塞进一份带审核者后缀、却不在任何 `artifacts[]` 里的伪审查件，复核查不出来。
  伪件不影响裁决齐备的判定。这一面**事前**靠写侧拦截：Hook 对归档内角色后缀文件的写入，Write / Edit 精确判定，Bash 是启发式；
  **事后**只有 `gate --check-artifacts`（`checkStageArtifacts` 的反向检查）查得到。**提交锚不守这一面**：它只看已跟踪文件的改动，
  新增的未跟踪文件不触发（`archive.ts:378-381` 注释原话）。初稿这里写成「仍由 --check-artifacts 与提交锚守着」，说过头了，已改。
  「本轮工件未被改」不等于「本轮工件集可信」。没有并入复核，是因为并入会改变复核的语义边界，要同步契约面与用例，超出本步范围。
- **两句判别文字在全仓唯一，靠的是落笔时 grep 零命中，不是机制保证**：以后别处写出同一串，区分只在本函数范围内仍然成立。
- **设计文档与代码不一致**：LLD `:126-127`、主设计 `:1126` / `:1199` 仍停在 M9 口径，移交第 5 步，已登记 **EV-106**。
- **`doctor --selftest` 不含 approve 步骤**：审批链路靠 gate-loop 的 A1～A4′ 与 code-stage 的 A6 覆盖。自检是否补这一步不在本步范围。
- **M1 的逐条归因是推断**，见 §1。
- **bug 阶段的审批正例没有新写**：沿用既有的 `bug-stage.test.ts`（它原本就走 `--await-approval` 加 approve），本步回归中全绿。
