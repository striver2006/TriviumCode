# 留痕字段与误报小修 · 实施报告（EV-127 / EV-128 / EV-137）

- **日期**：2026-09-26
- **主题**：`留痕字段与误报小修`；计划 `.reviews/留痕字段与误报小修/plan/`（r1 送审前用户定 D1～D5 全按建议 → 计划双审 run `20260926T135731Z` 14 条全接受 → r2 定稿，提交 `661be7b`；用户审批「修改后实施」）
- **起点**：`661be7b`；计划行号取自 `9cee216`（两者之间只有计划留痕）
- **状态**：代码双审 r1（run `20260926T151155Z`）5 条全接受、审批通过；已按应答件修订（§7）；**未提交**
- **evidence**：`doc/05_testing/evidence/trace-field-fixes-20260926/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 EV-127 | `parse.ts` `checkReviewIntegrity` 的 `pathRe` 改为 `(?<![A-Za-z0-9_./-])(?:\.\/)*((?:src\|…\|scripts)\/…)\b`，上方注释写明口径、实测与不核范围；`ReviewIntegrity.evidenceNotInConsulted` 文档注释同步。`guard.ts` / `review.ts` 未改 | `parse.test.ts` U1～U7 |
| §3.2 EV-128 | `meta.ts` 新增 `finalizeCancelledRunMeta`（两步：`cancelRunMetaStep` 四个前提、只改三格；`cancelTaskEntryStep` 以 run.json 已是 cancelled 为独立判据、按 run_id 精确匹配、找不到即跳过），两步各 `.catch` 转 skipped、函数不抛；`run-protocol.ts` `cancelRun` 在抹凭据副本之后、`patchStatus` 之前调用，layout 由 `identity` 直接构造，两步各一行播报（异常用 warn）；头注释与 CLI 帮助 `--cancel` 一行同步；`types.ts` `RunMeta.status` 注释、`RunMeta.gate` 注释里 EV-128 一句改写 | `run-meta-cancel.test.ts` R1～R7（含 R5a / b / c）；`run-protocol.test.ts` E1 / E3 / E6；`gate-loop.test.ts` E2（:1185 那条追加）/ E4 / E5 |
| §3.3 EV-137 | `report.ts` 去掉 `forged_role_file` 读取、留注释；`meta.ts` / `review.ts` 写侧旁注「保留字段」；`types.ts` 字段文档注释；run.v1 / run.v2 schema 给 `forged_role_file` 加 description，另给 `status` 加 description（§5 表的 schema 一行） | `report.test.ts` G1 |
| §5 文档 | 主设计 v1.3.47（§9 模块表 `guard`、§6.5、6.7 注记、7.1 `--cancel`、变更记录）；PRD v1.4.11（变更说明、FR-24）；PROTOCOL 命令表 `review` 一行；LLD v1.1.5（:452 一段改为已修、:563 表格行划掉、旧 `:680` 链接去掉）；MANUAL v1.0.5（场景 4 注记）；BACKLOG（EV-127 / 128 / 137 状态、EV-133 两处、EV-73 并入、新登 EV-142 / EV-143，以及用户定的 EV-144） | §5 反扫词表逐词 grep（含「回收主题锁」），剩余命中均为历史说明或本次新写的说明 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | **2102 / 2100 / 0 / 2**（起点 2080 → 新增 22 条：U 7、G1 1、R 9、E1 / E3 / E6 3、E4 / E5 2；E2 是既有用例追加断言，不计）。实施中跑了两次，两次读数相同（第 2 次含 §3.1 的桩改动与文档同步） |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14/14** |
| `npm run check`（代码双审修订后） | **2103 / 2101 / 0 / 2**（加 U8 一条；E6 是追加断言，不计） |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并逐条核对唯一） | 代码双审修订后加 M15（consulted 不归一 ⇒ U8）、M16（写失败告警去掉「没有第二次机会」⇒ E6），第 2 轮 **17/17**（`mutation-output.txt`）。第 1 轮 **15/15**（`mutation-output-run1.txt`）：M1～M3（`parse.test`）、M4a（`run-protocol.test`，E3）、M4b / M5～M11（`run-meta-cancel.test`）、M12 / M13（`run-protocol.test`，E1）、M14（`report.test`，G1）。每条只写一个期望套件（计划双审 r1 GLM-04） |
| 零配额验收（`acceptance.mjs`，mkdtemp 夹具、桩审查员 `hang` 模式） | 第 1 次 **12/13**（`acceptance-readout-run1.json`，C3 不过，见 §3.2）；C3 按事实改写后 **13/13**；代码双审修订后重跑 **13/13**（`acceptance-readout.json`） |
| `doctor --selftest`（代码双审修订后） | **14/14** |
| 环境 | git 2.54.0（Apple Git-157），Node v25.2.1 |

## 3. 偏离与如实登记

### 3.1 计划外补了一个桩模式 `hang`

写 E4 / E5 时核出：计划与既有用例都用桩的 `timeout` 模式拉起一轮运行，而这个模式**立刻返回**失败，worker 转眼就自己收尾。
E4 / E5 第一次能过，靠的是 `--cancel` 恰好赶在 worker 收尾之前——时序侥幸，会抖。
于是在 `adapters/stub.ts` 加 `hang` 模式（挂到进程被杀，兜底 10 分钟后按超时返回），E4 / E5 与验收脚本改用它。只动测试设施，生产路径不受影响。
既有的「`--cancel` 旧 run 不清掉新一轮的闸门」（`gate-loop.test.ts` :704）仍用 `timeout`：它断言的是闸门而不是 run.json 状态，与时序无关，本主题不动。

### 3.2 计划 §4.4 第 3 条与 C7 对 `report` 的预期不成立

计划写「`report` 时间线该轮状态列为 `cancelled`」，C7 也把 `report` 时间线列为 `status` 的读者。第 1 次验收证伪：`report` **按审查工件枚举轮次**，而取消轮被杀在 worker 收尾之前、没有审查文档，时间线根本不列它（「该主题下没有任何已产出审查工件的轮次」）。
所以 `report` 在实践中看不到 `cancelled`——只有既有审查文档、又停在 `running` 的轮次才会显出状态，而那种形态不会由 `--cancel` 产生。
这是 `report` 的既有行为，改它（按 run.json 也列无工件的轮次）属扩大范围，本主题不做；C3 改为如实钉住「report 照常退 0、不列这一轮」。
用户定（2026-09-26）：登 BACKLOG **EV-144**，现在不修，做 EV-142 时一并评估——没写出工件的运行不推高轮次号、随后的重跑沿用同一轮次号，列出它们要改时间线的组织方式，需单独设计。r2 计划原文保留为记录，不改。

### 3.3 M12（顺序）用写入时间钉，不加测试钩子

计划 r2 §4.3 M12 给了两个选项，取后者：不往 `cancelRun` 加中断注入点，E1 断言归档 run.json 与 task.json 的修改时间（纳秒）都早于 status.json。
把归档侧收尾挪回 `patchStatus` 之后，E1 当场变红（M12 fail=1）。它钉的是「先后」，不是「中断后可补齐」本身；后者由 R5c（两写之间中断后第二步补齐）与前提 4 的幂等共同承担。
前提是纳秒级时间戳（APFS / ext4 等）：粗粒度文件系统上两次写可能落进同一刻度，E1 会假红、不会假绿（代码双审 r1 CODEX-04 ≡ AGY-01）；不放宽成「小于等于」，那会让 M12 在粗粒度卷上假绿。

### 3.4 其它

- **M6 靠跳过原因咬住**：删掉「只写 v2」前提后，v1 形状随后仍过不了 v2 校验，照样不写文件；R3 因为断言了跳过原因「只回写 run.v2」而变红。这一格有两道（前提 3 与 v2 校验），规格描述里已写明。
- **普查口径**（计划双审 r1 CODEX-05）：`run-status-census.mjs` 现输出两个口径。实施时读数为 181 份（含 verify 阶段 6 份）、带 guard 段 175 份、`forged_role_file` 为 true 0 份、running 4 份——比计划写作时多出的 1 份是本主题自己的计划双审轮。
- **C4 排除本主题自己的审查件**：计划 §2 的读数不含本轮（晚于实测），验收重扫时同样排除，读数与计划逐格一致。
- **E3 的构造**按 r2：status.json 为 running、无 `worker_pid`、无 `worker.pid` 文件，`workerConfirmedGone` 返回 `gone: false`；夹具里那个假 worker 由用例 `finally` 收掉。
- **R7 / E6 用只读目录注入写失败**，root 下拦不住写入，两条在 `getuid() === 0` 时跳过。

## 4. 文档同步

见 §1 最后一行。QUICKSTART / PROTOCOL 文首「依据设计 v1.3.43 / PRD v1.4.8」的引用前两个主题就没跟进，本主题也不动，照旧登记在此。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `ev127-measure.mjs` / `ev127-detail.mjs` / `ev127-named.mjs` | 计划 §2 的只读实测（四种判据读数、56 条分类、点名轮次） |
| `consulted-dotslash.mjs` | 代码双审 r1 CODEX-02：历史审查件 consulted 里带 `./` 的条目数与归一前后读数 |
| `run-status-census.mjs` | 归档 run.json 状态与 `forged_role_file` 普查（两个口径） |
| `gen-mutation-spec.mjs` → `mutation-spec.json` | 变异规格生成与锚点唯一性核对 |
| `mutation-output-run1.txt`、`mutation-output.txt` | 源码变异第 1 轮 15/15、代码双审修订后第 2 轮 17/17 |
| `acceptance.mjs`、`acceptance-readout-run1.json`、`acceptance-readout.json` | 零配额验收第 1 次（12/13）与改写 C3 后（13/13） |

## 6. 待办

1. ~~用户决定是否登记 BACKLOG：`report` 不列无审查工件的轮次~~——已定，登 EV-144（§3.2）。
2. ~~代码双审~~——r1 已过（§7）。
3. 按用户指示提交、推送；从已提交状态重建，用户终端重装（`--targets claude,glm,codex,gemini`），复核安装副本一致。

## 7. 代码双审 r1（run `20260926T151155Z`）与修订

三侧：codex `approve-with-nits`（2 minor + 2 nit）、gemini `approve-with-nits`（1 nit）、glm `approve`（零意见）；5 条全接受，同指一组 CODEX-04 ≡ AGY-01。用户审批通过（无附言）。
应答件 `.reviews/留痕字段与误报小修/code/2026-09-26-留痕字段与误报小修-response-claude.md`。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 | 「可重入」限定为**进程中断**：单步写失败转成跳过后，status.json 照常落终态，再跑 `--cancel` 会早退，这一步没有第二次机会。`reportFinalizeStep` 的告警尾部写明这一点并要求人工核对；`meta.ts` 文档注释、主设计 6.7 注记、LLD、MANUAL 场景 4 同步。codex 给的 (a)（终态分支里补跑第二步）不取：会碰「不追溯改写」，r2 也把 :804 列为不动 | E6 追加断言；变异 M16 |
| CODEX-02 | `checkReviewIntegrity` 的 consulted 集合与抽取侧同口径去前导 `./`。只读核过本仓 383 份历史审查件：consulted 里带 `./` 的条目为 0，归一后读数仍为 64 / 96，C4 期望不变（`consulted-dotslash.mjs`） | U8；变异 M15；验收 C4 |
| CODEX-03 | task 登记同步的三种跳过情形（run.json 不是 cancelled、登记里找不到、登记已不是 running）写进主设计 6.7 注记、LLD 与 PROTOCOL | — |
| CODEX-04 ≡ AGY-01 | E1 注释写明依赖纳秒级时间戳，假红不假绿；§3.3 同步 | — |

文档：主设计 v1.3.47 变更记录补「代码双审 r1」一段。
