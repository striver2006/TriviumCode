# 留痕与文案小修 · 实施报告（EV-129 / EV-130 ① / EV-131 / EV-132 ① / EV-133 / EV-134）

- **日期**：2026-09-26
- **主题**：`留痕与文案小修`；计划 `.reviews/留痕与文案小修/plan/`（r1 → 计划双审 run `20260926T064238Z` 9 条全接受 → r2 定稿，提交 `0bf81e6`；用户审批「修改后开始实施，不再二审」）
- **起点**：`0bf81e6`；计划行号取自 `85864c6`
- **状态**：代码双审 r1（run `20260926T081442Z`）7 条全接受、审批通过，已按应答件修订（§6）；**未提交**
- **evidence**：`doc/05_testing/evidence/trace-copy-fixes-20260926/`

---

## 1. 逐条落地

| 条目 | 落点 | 验证 |
| :--- | :--- | :--- |
| EV-129 | `state.ts` `shouldLockWrites` 审查中那一支去掉尾句，函数文档写明「reason 只陈述状态，后果由调用方拼」 | `hooks.test.ts`：审查中 Write 拦截「不得修改业务文件」恰一次、Bash 拦截不混入它；`state.test.ts`：加锁两支 reason 不含「不得」 |
| EV-130 ① | `config.ts` `profiles.default.codex` 三阶段 `qwen3.8-flash`（缺省 `-p qwen -m qwen3.8-flash`），取值旁注释写依据、已 init 项目不受影响、新项目需 qwen 额度、两档同值；注册表 codex 注释 ② 补一句 | `config-schema.test.ts` 钉缺省值 |
| EV-131 | `review-plan.contract.md` 描述去实名，重渲染 4 份产物（每份 2 行） | `entry-render-parity`：七条契约的 description 与全部产物一级标题不含注册表 label 派生的产品名（含派生自检） |
| EV-132 ① | `hook-config.ts` `gateHoldNotice` 三档尾句按闸门期 / 审批后写实；`describeGuard` L1 降级与 l2-none 两档改用 `L2_AFTER_THE_FACT`；`cli.ts` `hooks --agent` 无 Hook 提示同源；`l2-notice.md` 按三格写；`run-enforce.l2-{hook,none}.md` 按档分写；`driver.snippet` 同步、`init.ts` 三档指纹追加、本仓根 AGENTS.md / GEMINI.md 原位升级；`gate.ts` 注释与只读失守文案、`base.ts` / `registry.ts` 注释更正；QUICKSTART §5.2 | `hook-config.test.ts` 改写停点四档断言、新增 describeGuard 格；`entry-render-parity` 两族否定断言（全部渲染产物、`driver.snippet`、停点四档、describeGuard 四档、QUICKSTART §5.2）；`gate.test.ts` 只读失守文案否定式锁；`init.test` 指纹 |
| EV-133 ② | run.v1 / run.v2 schema description、`types.ts` `RunMeta.gate` 注释；主设计 §7 第 6 步与 §6.7 示例 | `gate-loop.test.ts`：`--check` 通过前后 run.json 逐字节不变 |
| EV-134 (a) | `gate.ts` 新增 `expectedReviewDocs` / `checkAddresses`，`loadRoundReviews` 带出 `reviewDocs`，`GateCheckInput.reviewDocs` 必填（两个生产调用点照传、`gate.test.ts` 31 处补参）；新告警码 `addresses_unchecked`；`body.md`、两份模板、`templates/README.md`、`disposition.v1.json` 描述、PROTOCOL | `gate-addresses.test.ts` 10 格；集成夹具 3 处由编号形态改为文件名（`fault-injection` ×2、`stub-agent-kit` 从 run.json 自行筛取） |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 2047 / 2045 / 0 / 2（起点 2029 → 新增 18 条）；代码双审修订后 **2048 / 2046 / 0 / 2** |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | 14/14 |
| 源码侧变异（`mutation-spec.json`） | 第 1 轮 14/15——**M10 没咬住**（见 §3.1，`mutation-output-run1.txt`）；补用例后第 2 轮 15/15；代码双审修订后加 M16，**16/16**（`mutation-output.txt`） |
| 契约侧变异（`contract-mutations.mjs`：契约描述、`l2-notice` ×3、`run-enforce`、`driver.snippet`、`body.md`、QUICKSTART） | 实施时 7/7；代码双审修订后加 K8，**8/8**（`contract-mutations-output.txt`） |
| 零配额验收（`acceptance.mjs`，mkdtemp 临时项目放历史主题副本） | **10/10**（`acceptance-readout.json`）：A1 EV-125 plan 轮（编号形态）退 2、点名三份期望文件名、两档出口；A2 EV-122 code 轮（编号形态、glm 解析回退）退 2、期望集含回退侧文档；A3 EV-136 code 轮（文件名形态）退 0；三格 run.json 前后逐字节一致 |

## 3. 偏离与如实登记

### 3.1 变异 M10 第一轮没咬住

「期望集把失败 / 超时侧也算进有效侧」在第一轮存活：用例里失败侧本就没有登记文档，按状态过滤有无观测不到差别。
补一格构造情形（失败侧名下登记了一份文档 ⇒ 不计入），第二轮咬住。这一格钉住的是「以状态为准，不以 artifacts 里有没有为准」。

### 3.2 同族失实措辞比计划列的多四处

计划 r2 §4.2 列了 D1～D7。实施时 grep 同族措辞（src / test / skills-src / protocol / 手册），另核出四处一并改；**grep 面漏了 `doc/02_design` 全文**，主设计 :3075 的同一句由代码双审 r1 CODEX-01 核出、修订时改掉：

- `cli.ts` :989 `hooks --agent` 对无 Hook 载体的提示（用户可见，与 D7 同一句）——改为引用 `L2_AFTER_THE_FACT`；
- `adapters/base.ts` :1055 注释「`judgeDrift` 是 git 树比对，只看已跟踪文件」；
- `test/unit/gate.test.ts` :735 注释同句；
- `agents/registry.ts` :76 注释把 approve 前置复核列为 L2 写入补偿。

### 3.3 计划外补的两道锁

- `gate.test.ts` 只读失守用例追加「文案不含『已跟踪文件被改』」否定式断言——D6 的文案原本没有任何用例守着，变异 M6 靠它咬住；
- `entry-render-parity` 追加「命令 B / C / D 的写裁决件一步交代 addresses 填审查文档文件名、不是意见编号」——`body.md` 的说明原本无人守，契约变异 K6 靠它咬住。

### 3.4 其它

- 「只写自己后缀」违例的事后发现：核实后仍无判据（`guard.forged_role_file` 恒 false，已新登 BACKLOG EV-137），`l2-notice` 按计划**不写**这一格。
- 集成夹具实际只有 3 处需改（计划 §6.6 grep 初筛列了 11 处）：填文件名的夹具与桩运行实际落盘名一致，未红。
- `acceptance.mjs` 第一次读数把 JSON 输出里的裁决件路径也计成「点名的期望文件名」（显示 4 份）；已改为只数审查文档，重跑为 3 份。

## 4. 文档同步

主设计 v1.3.45（§6.6、§6.7 示例与注记、7.4 / 7.4.1、§7 第 3 / 6 步、M7b 注记、8.5 补偿覆盖面、11.5、15.3 AC-21、R18、变更记录）；PRD v1.4.9（FR-28、AC-21 边界）；PROTOCOL :29；QUICKSTART §5.2；MANUAL :645；M10a / M10b 轮次台账口径注更正；BACKLOG 六条状态翻转、EV-132 更正「approve 确能查出」、新登 EV-137。RUNBOOK :378 / :388 核对后不改（仍指 EV-132，② 未做）。

## 5. 代码双审 r1（run `20260926T081442Z`）

应答件 `.reviews/留痕与文案小修/code/2026-09-26-留痕与文案小修-response-claude.md`——**按 EV-134 新判据核对的第一份裁决件**，`addresses` 列三份审查文档文件名，`gate --check` 逐项比对通过（无 `addresses_unchecked`）。
三侧：codex `approve-with-nits`（2 minor + 2 nit）、gemini `approve`（零意见）、glm `approve-with-nits`（3 minor）；7 条全接受，用户审批通过（无附言）。

## 6. 按应答件的修订

| 意见 | 落点 |
| :--- | :--- |
| CODEX-01 | 主设计 :3075「judgeDrift……只看已跟踪文件」按 8.5 同口径改写；本报告 §3.2 补登 grep 面缺口 |
| CODEX-02 | 不改仓库根 `CLAUDE.md`（用户的项目指令文件，M10b 第 5 步定「核对、不改正文」）；新登 BACKLOG EV-138，两个候选由用户定 |
| CODEX-03 ≡ GLM-03 | `gate-loop.test.ts` EV-133 用例扩为 `--check` → `--await-approval` → `approve` 三步、每步 run.json 逐字节不变（走命令 B 的 entry）；源码变异加 M16（approve 路径回写） |
| CODEX-04 + GLM-02 | `l2-notice.md`：闸门期与审查工件两格加「命令 B / C / D」限定；「复核会拦下」改为「审批前复核会发现不符并拒绝审批」；补「命令 A 没有审批这一步：审查工件的事后防线只剩带 Hook 载体的提交锚」。重渲染 12 份 L2 产物；渲染断言补一格，契约变异加 K8 |
| GLM-01 | PRD 第 8 行「文档版本」同步为 v1.4.9 |

修订后读数：全量 2048 / 2046 / 0 / 2；`doctor --selftest` 14/14；源码变异 16/16；契约变异 8/8；零配额验收 10/10。

## 7. 待办

1. 用户在终端重装（`--targets claude,glm,codex,gemini`，本机 2026-09-26 起装了 gemini 入口）；我复核安装副本一致；
2. 按用户指示提交、推送；从已提交状态重建并重装。
