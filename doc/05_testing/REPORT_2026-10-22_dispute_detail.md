# 测试报告 · 争议明细写入（EV-250 / 发版-02）

- 日期：2026-10-22
- 主题：`争议明细写入`（`/dual-run`，A 档）
- 计划：`.reviews/争议明细写入/plan/2026-10-22-争议明细写入-r2-claude.md`（计划三审 run `20261022T101659Z`，第 1/3 轮：codex、glm `pass`，gemini `pass-after-changes`，3 条全接受）
- 代码三审：run `20261022T105628Z`，第 1/3 轮：codex `pass`，gemini、glm `pass-after-changes`，6 条全接受（应答件 `.reviews/争议明细写入/code/2026-10-22-争议明细写入-response-claude.md`）
- 主设计：v1.3.172（§6.6 规则 7、§8.6 判据 g）；BACKLOG EV-250；LLD 第七节缺口表；用户手册第 687 行与已知限制表
- 证据：[`evidence/dispute-detail-20261022/`](./evidence/dispute-detail-20261022/)

## 一、改了什么

| 面 | 改动 |
| :--- | :--- |
| `gate.ts` | `GateCheckResult` 新增可选 `disputedJointBlockers`：只在 `warn` 策略放行共同驳回时给出，`hard` 阻断与无共同驳回时缺席；新增导出 `formatJointGroups`（`编号+编号@location`，组间「；」），告警文案与争议 `note` 共用 |
| `cli.ts`（`gate --check`） | 争议明细并进 `joint_checks` 那一次 `updateTask`：先删本轮 `run_id` 的旧条目，再按本次结论追加；追加时置 `disputed`；`warn` 提示带编号。原先单独置 `disputed` 的那次写删掉 |
| `report.ts` | 新增 `renderDisputes`：明细无条件列出（阶段、轮次、run_id；找不到对应轮次只写 run_id）；`disputed` 真而明细空时写「没有留下明细（旧记录，或该轮争议已撤回）」；空编号（含只有空串）、空说明兜底 |
| `meta.ts` | `disputes` 字段注释写明口径；类型与 schema 不变 |
| 文档 | 主设计、LLD、用户手册、现存 Bug 清单、BACKLOG |

## 二、用例

**集成 `test/integration/gate-loop.test.ts`（新增 3 条，真实打包 CLI + 桩）**：

- T1～T3（含 T7）：`warn` 下共同驳回写一条（`finding_ids` 为 `AGY-01`、`GLM-01`，`note` 为 `AGY-01+GLM-01@src/stub.ts:10`，stderr 提示带编号）；同轮重跑与 `--run-id` 显式重跑都不堆积；改成接受后本轮条目删掉、`disputed` 仍为真，`report` 出现「没有留下明细」。
- T4：`hard` 策略被拦、`disputes` 为空、`disputed` 为假、`joint_checks` 本轮为 `checked-found`。
- T5 / T6：预置一条他轮条目，`warn` 下本轮追加、他轮保留；改 `hard` 重跑同一轮，本轮条目删掉、他轮仍在。改策略的手段是在夹具 `config.yaml` 末尾替换一个 `gate` 段（用例文件内的小辅助，不动夹具公共接口）。

**单测**：`test/unit/report.test.ts` 原「降级与争议项」用例按新格式断言；新增 R1（有标记无明细）、R2（run_id 找不到轮次）、R3（`disputed` 假而明细非空）、R4（空编号、只有空串编号、空说明）。`test/unit/gate.test.ts` 新增 `formatJointGroups` 多组拼接、`warn` 下给出分组、无共同驳回时缺席，`hard` 用例补缺席断言。

**回归**：`task-unreadable-refusal`（14 条，含 I3「读不出时争议标记不写进新正本」）原样通过。

## 三、变异验证

逐条预跑脚本（`--with-tests` 变体，集成类变异重打 bundle），规格见证据目录。

| # | 变异 | 期望套件 | 失败数 | 变红的用例 |
| :-- | :-- | :-- | :-- | :-- |
| M1 | 去掉按 run_id 先删 | gate-loop | 2 | T1～T3、T5 / T6 |
| M2 | `hard` 也带出 `disputedJointBlockers` | gate-loop | 2 | T4、T5 / T6 |
| M3 | `note` 改存整段告警 | gate-loop | 2 | T1～T3、T5 / T6 |
| M4 | 去掉「没有留下明细」一行 | report 单测 | 1 | R1 |
| M5 | 恢复以 `disputed` 为前提才列明细 | report 单测 | 1 | R3 |
| M6 | 去掉「（无编号）」兜底 | report 单测 | 1 | R4 |
| M6r2 | 代码三审 AGY-03 改码后重做 M6 | report 单测 | 1 | R4 |
| M7 | 不滤空串编号（AGY-03） | report 单测 | 1 | R4 |

M1～M6 读数见 `mutation-names-output.json` / `mutation-names-log.txt`；M6 的锚点在 AGY-03 改码后失效，M6r2、M7 另跑，见 `mutation-names-r2-output.json` / `mutation-names-r2-log.txt`。每条跑完源码逐字节恢复。没有跑正式装置 `scripts/mutation-check.mjs`（八条都已按用例名逐条确认变红）。

## 四、全量

`npm run check`（前台、单条）：代码三审前一遍 3832 条，3830 通过、2 跳过、0 失败；收口读数见第六节。

## 五、残余

- `disputed` 只增不减：旧正本的标记归属不到哪一轮，明细删空即清零会抹掉旧主题的标记。代价是某轮争议撤回、主题再无别的争议时，`status` 仍显示「⚠️ 有争议项」，`report` 落到「没有留下明细」一行（文案已把撤回列为成因之一）。登记在 BACKLOG EV-250。
- 不做历史回填：旧主题的 `disputed: true` 没有可回溯的编号来源，由报告文案如实呈现。

## 六、收口读数

- `trivium verify` 第一遍**失败**（`.reviews/争议明细写入/verify/2026-10-22-争议明细写入-verify.md`）：`npm test` 3832 条，3828 通过、2 失败，失败的两条都是 `contract/doc-archive-index`——本报告在测试 README 里登记在 EV-248 那条之后，索引要求按（日期，文件名）升序。把登记行挪到它前面，没有改代码。
- `trivium verify` 第二遍通过（`…-r2-verify.md`）：typecheck、build、`npm test` 全部退 0；3832 条，3830 通过、0 失败、2 跳过。
- 另跑 `npm run check` 一遍（前台、单条）：3832 条，3830 通过、0 失败、2 跳过，退出码 0。
