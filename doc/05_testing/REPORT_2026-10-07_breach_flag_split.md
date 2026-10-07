# 复盘面失守旗标分档 · 实施报告（EV-224）

> - **日期**：2026-10-07
> - **起点**：`0fde1998`（`main`，工作树干净）
> - **来源**：EV-223 代码双审 run `20261006T165356Z` 的 GLM-01；用户 2026-10-07 定取候选 A，授权直接改、提交前由执笔方自审（**未走双审**）
> - **证据目录**：`doc/05_testing/evidence/breach-flag-split-20261007/`
> - **配额**：零配额

## 1. 问题

EV-223 起只读失守分两档：跑后复算确证改动的判 failure `readonly_breach`、挡在审批外；未确证（复算无变化或比不了）降为告警 `readonly_breach_unconfirmed` 放行。但复盘面——`trivium report` 的旗标（`report.ts`）与审查结束时的运行摘要（`meta.ts` `summarizeRun`）——只出「只读失守」四个字。复算无变化的放行轮连漂移行都没有，读复盘的人容易把它读成「该挡却放了」。

## 2. 改了什么

- `gate.ts`：新增 `readonlyBreachLabel(drift)`，按 `classifyReadonlyBreach`（EV-223 的单点判据）分三档给字，文字只此一份：
  - 确证：「只读失守（复算确证改动：裁决不得进入审批）」
  - 复算无变化：「只读失守（复算无变化：告警放行，复算有盲区）」
  - 比不了：「只读失守（复算比不了：告警放行）」
- `report.ts` 的失守旗标与 `meta.ts` `summarizeRun` 的失守一行改调它；前缀「只读失守」不变，按词检索的既有断言与用法不受影响。
- `meta.ts` 因此静态引用 `gate.ts`。编码时用只读脚本求过 `gate.ts` 的静态依赖闭包（16 个模块，不含 `meta.ts`），不成环。
- 判据、闸门、Hook、run.json 一概不动。

## 3. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 新单测 | `report.test`「EV-224：只读失守旗标按复算分三档，前缀不变」（三档 + 未失守对照）；`gate.test`「EV-224：readonlyBreachLabel 三档逐字，summarizeRun 按同轮 drift 分档、未失守不出」；`mcp-detect` I2 的报告断言收紧到「只读失守（复算无变化：告警放行」 | — |
| 相关套件单跑 | report / gate / drift-unknown / mcp-detect 共 82/82 | — |
| 变异装置 | 基线 2 套件全绿，**3/3 咬住**：N1 report 旗标退回不分档、N2 summarizeRun 退回不分档、N3 标签不看判据一律按确证说 | `gen-mutation-spec.mjs`、`mutation-spec.json`、`mutation-output.txt` |
| 全量检查（串行） | 见下 | `check-1.txt`、`check-2.txt` |
| doctor 自检 | 见下 | `doctor-selftest.txt` |

- `npm run check` **两次串行：2939 / 2937 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同、退出码均为 0（`check-1.txt`、`check-2.txt`）。EV-223 为 2937，本题净增 2 例（两条新单测），跳过数不变。
- `doctor --selftest`（工作树构建）：**14/14**（`doctor-selftest.txt`）。
- 本段文字是全量跑完后填入的，索引条目与文件集未动。

## 4. 自审

提交前由执笔方逐行过补丁（未走双审）：判据未复制、只经 `classifyReadonlyBreach`；`switch` 三分支穷尽（`ReadonlyBreachClass` 三值，`tsc` 无隐式返回告警）；两处调用点只在 `guard.readonly_breach` 为 true 时取标签；文案前缀保留；文档同步设计 v1.3.128（10.3 处理段与版本记录）、LLD v1.1.50（模块表两行）、BACKLOG EV-224 落地记要，EV-223 报告 §4 补指向本报告。
