# M11 第 7 步 · 复盘报告按 Driver 与审核者两个维度聚合 · 测试报告

> - **日期**：2026-10-08
> - **起点**：`7fe81056`（`main`；主设计 v1.3.134、PRD v1.4.23、LLD v1.1.53）
> - **流程**：命令 A，主题 `M11-复盘报告双维度聚合`。计划三审 run `20261008T053559Z`：codex `approve-with-nits`（次要 4、吹毛求疵 1）、gemini `request-changes`（重要 1、次要 3、吹毛求疵 1）、glm `approve-with-nits`（次要 6），16 条全接受，r2 定稿；待拍板 D-1～D-6 用户全部按推荐项定。代码三审 run `20261008T070253Z`：三侧均 `approve-with-nits`（codex 次要 2、吹毛求疵 1；gemini 次要 1、吹毛求疵 2；glm 次要 2、吹毛求疵 2），10 条全接受并已改。
> - **证据目录**：[`evidence/m11-report-aggregate-20261008/`](./evidence/m11-report-aggregate-20261008/)
> - **配额**：运行期零配额（只用夹具、纯函数与本地构建只读跑本仓归档），只有三审本身花配额

## 1. 结论

复盘报告（`trivium report`）有了按 Driver 与按审核者两个维度的聚合（设计 13.2.1，v1.3.135），第四节加了思考等级请求值与生效值两列；规格与实现同一提交（纪律 6b）。

- **先修了串档根因**：轮次枚举与裁决件定位原先写死缺省 Driver——同一阶段换成 codex 当 Driver 后，codex 的裁决件找不到（那一轮显示「尚无裁决件」），codex 的新一轮计划会被当成审查文档、造出幽灵轮次。现在原稿与裁决件按该轮 run.json 的 `driver` 排除与定位（同号多份 run.json 时排除每一份的 driver），没有可读 run.json 的轮次号先按内容谓词判、再按后缀兜底。
- **按 Driver 聚合**：（Driver, 阶段）分行加合计；读不到 Driver 的轮次单独成组、逐轮写原因，不归给缺省 Driver；run.v1 迁移轮次归 claude 并注明。
- **按审核者聚合**：一条意见按提出它的审核者计，不跨侧去重；整份回退编号按前缀归属、照常进采纳率并另列；失败、整份回退、逐条降级、未进时间线运行中的失败分格计；生效模型与思考等级逐值计次，缺席与 null 分开计。
- **第四节两列**：缺席写「—」，null 按语义写「（未请求）」「**未回读到**」「（无此概念）」；生效列的渲染函数入参类型里没有请求值，拿请求值顶替在类型上写不出来；两值不等时的 ⚠️ 在行级拼装。
- **`report --json` 只增不改**：新增字段见设计 13.2.1 末段与 PROTOCOL `report` 行；逐侧思考等级字段缺席时不写键、null 写 null。

**本步未达成任何 AC**：FR-30 只差 AC-23 的真实验收（第 11 步）；演进设计 §13.3 第 4 条「换 Driver 重跑、report 不串档」的手工验收随第 10 步。

## 2. 用例

新增 `test/unit/report-aggregate.test.ts`，18 例（临时目录走 `scratchDir`）。主夹具一个主题、三阶段混排：

| 位置 | Driver | 审核者 | 留痕 | 裁决件 |
| :--- | :--- | :--- | :--- | :--- |
| plan r1 | claude | gemini、glm | 思考等级字段缺席，gemini 只带旧名 `effort: high` | `-revised-claude` |
| plan r2 | codex | gemini、glm、claude | gemini 请求 medium、生效 high（envelope）；claude 请求 max、生效 null（unverified）；glm 三格 null | `-r2-revised-codex` |
| plan r3 | codex | claude | codex 的新一轮计划送审后被取消（有 run.json、没有审查文档） | — |
| plan r4 | — | gemini | 审查文档无 front-matter，没有 run.json | — |
| plan r5 | — | claude | 审查文档 front-matter 完好，没有 run.json（claude 是唯一产出方） | — |
| plan r6 | — | — | 只有 codex 的原稿，没有 run.json | — |
| code r1 | claude | codex、glm | codex 整份回退，裁决表含 `CODEX-F01` | `-response-claude` |
| code（未进时间线） | glm | gemini、codex | 被取消，gemini 侧 failed | — |
| bug r1 | （run.v1 迁移） | — | 手写的最小 v1 记录 | `-revised-claude` |

| 用例 | 断言要点 |
| :--- | :--- |
| A1 | plan r2 读到 `-r2-revised-codex` 的裁决（1 / 1 / 1）；plan 时间线恰为 r1、r2、r4、r5，codex 的 r3、r6 原稿都不定义轮次；未进时间线两次运行的 driver 分别是 codex、glm |
| A1b | 无 run.json、claude 唯一产出、front-matter 完好的 r5 仍在时间线，进「读不到 Driver」组 |
| A2 | Driver 行集与顺序（claude 三阶段 + 合计、codex plan + 合计、glm code + 合计）；plan r2 不进 claude；glm 只有未进时间线运行的行轮次 0、未进时间线 1；「读不到 Driver」组 2 轮、各格「—」不是 0；v1 注记 |
| A3 | 各已知 Driver 合计的裁决之和 = 全主题采纳率分子分母（6 / 9） |
| A4 ×3 | 审核者行序与归属：claude 作审核者成行；codex 入选 1、产出结论 0、整份回退 1、`CODEX-F01` 归 codex 并照常计入；gemini 入选轮次不含取消运行、未进时间线失败 1；两侧对同一位置各提一条各计一条；审核者分摊之和 = 裁决行总数；来源判不出单列「来源不明」、非裁决格为 null；早期留痕「状态记整份回退却有可读结论」两格都计 |
| A5 | 第四节逐行：旧留痕「—（旧名 effort：high）/ —」、gemini「medium / high ⚠️」、claude「max / **未回读到**」且生效列不含 max、glm「（未请求）/（无此概念）」 |
| A6 ×2 | JSON 往返后旧留痕的侧没有 `effortEffective` 键、glm 的为 null；审核者表 B 缺席与 null 分开计次，claude 的请求 max 不进生效计次 |
| A7 | bug r1 归 claude，`driverSource: run.v1` |
| A8 ×3 | 请求列、生效列、对比标记三个纯函数按设计两张映射表逐行 |
| B1～B4（代码三审补） | B1 本阶段有读不出的 run.json ⇒ 原因写「没有可读的 run.json（本阶段另有 1 份读不出…）」；B2 同号作废后换 Driver 重跑，前一次运行的原稿不造幽灵轮次；B3 裁决件定位得到却读不出 ⇒ 计未裁决、单记「其中 1 轮裁决件读不出」、不再说「尚无裁决件」；B4 只在未进时间线运行里出现、未失败的审核者也成行 |

既有 `test/unit/report.test.ts` 的断言一条未改。首轮跑出一处冲突：EV-144 V7「没有未进时间线的运行时全文不得出现『未进时间线的运行』」——Driver 表末列原名就是这几个字。列名改为「未进时间线」，规格同步写明理由。

## 3. 变异

`scripts/mutation-check.mjs`，目标 `src/trivium/report.ts`，期望套件 `report-aggregate` 单测；规格由 `gen-mutation-spec.mjs` 从现行源码截锚点并核唯一。先用带超时的逐条预跑（`mutation-names.mjs`），再上正式装置。

| 编号 | 变异 | 咬住它的用例 |
| :--- | :--- | :--- |
| M1 | 裁决件回到按缺省 Driver 定位 | A1、A2、A3、A4 |
| M2 | 读不到元数据的轮次 driver 记成缺省 Driver | A1b、A2 等 |
| M3 / M3b | 生效列在 null 时回落请求值；审核者聚合的生效计次把请求值记进去 | A5、A8 / A6 |
| M4 / M4b | 请求列 null 与缺席同写「—」；旧留痕也写出 `effortEffective` 键 | A5、A8 / A5、A6 |
| M5 | 有 run.json 的轮次仍按缺省 Driver 排除原稿 | A1、A2、A4、A6 等 |
| M6 | 整份回退编号不按前缀归属 | A4 |
| M7 | 无 run.json 的轮次去掉内容谓词 | A1、A1b、A2 |
| M8 | 无 run.json 的轮次后缀兜底退回「≠ 缺省 Driver」 | A1、A2 |
| M9 | run.v1 迁移不标来源 | A2、A7 |
| M10 | 按 Driver 聚合不再单独成组 | A2、B1 |
| M11 | 同号多份 run.json 只看最后一份的 driver | B2 |
| M12 | 本阶段有读不出的 run.json 仍说「找不到」 | B1 |
| M13 | 裁决件读不出不单记 | B3 |
| M14 | 只在未进时间线运行里出现、未失败的审核者不成行 | B4 |

正式装置 **16/16 咬住**（`mutation-output.txt`）；逐条失败用例名见 `mutation-names-output.json`。代码三审之前的 12 条读数留作 `*.r0.*`。CODEX-03（码点序）没有对应变异：`localeCompare` 与码点序在本机 locale 下对夹具里的键同序，构造不出能区分两者的跨 locale 断言。

## 4. 本仓真实归档只读实跑

本地构建（`skills/dual-critic/scripts/trivium.cjs`）只读跑两份真实主题，输出存证据目录，归档无改动：

- **`M2-skills与闸门`**（run.v1 留痕）：Driver 合计行带「其中 1 轮为 run.v1 迁移」；gemini 侧状态是 `parse_fallback`、却落了可读的结构化结论（裁决表里是 AGY-01～06 正式编号），审核者表记产出结论 1 轮、合格意见 6 条、整份回退 1 次；第四节 gemini 请求列「—（旧名 effort：high）」、生效列「—」。
- **`M11-复盘报告双维度聚合`**（本主题，新留痕形状）：第四节 codex「（未请求）/ **未回读到**」、gemini「high / high」、glm「（未请求）/（无此概念）」，与本主题审查文档 front-matter 一致。

M2 那一格让规格改准了一句：原稿 13.2.1 写「产出结论轮次：整份回退不算」，与这份真实留痕冲突。判据改为**结论读不读得到**——两件事在留痕里都成立，两格都计。

## 5. 全量

代码三审修复与全部文档改完之后，`npm run check` 串行两次、一次只发一条（`check-1.txt` / `check-2.txt`）：两次都是 **3067 例、通过 3065、失败 0、跳过 2**（跳过数与上一主题 `m11-effort-continuation-20261008/check-1.txt` 的读数相同；本步新增用例无跳过），耗时 311 s / 323 s。随后 `trivium verify` 通过（3 条命令、314 s，verify run `20261008T073641Z`）。

## 6. 与计划 r2 的偏离（代码三审 GLM-03）

1. **plan r2 的 gemini 夹具**：计划写「请求 high、生效 high」，A5 写「claude『max / 未回读到』并带 ⚠️」。两处与计划自己的 §2.4（两值都为字符串且不等才加 ⚠️）矛盾：gemini 两值相等测不出 ⚠️，claude 生效为 null 不满足前件。实现按 §2.4：gemini 改为请求 medium、生效 high（带 ⚠️），claude 行不带 ⚠️。
2. **plan r3 与 r6**：计划的 r3 是「codex 的新一轮计划，没有 run.json」。为让变异 M5（有 run.json 的轮次仍按缺省 Driver 排除）有用例咬住，r3 改为送审后被取消（有 run.json），「没有 run.json 的 codex 原稿」挪到 r6，两种形态都保留。
3. **bug r1**：计划写审核者 gemini、glm，实现只摆了 gemini 的审查文档——v1 记录的 `critics` 为空，审核者不影响该轮的断言（只核 Driver 归属与 v1 标注）。
4. **「产出结论轮次」的口径**：见 §4，规格随之改准。
5. **代码三审修复**（CODEX-01 ≡ AGY-01、CODEX-02、GLM-02、GLM-04）在计划之外新增了 B1～B4 与 M11～M14；CODEX-01 的建议①（给读不出的 run.json 记候选 runId）落不了地——读不出就拿不到它的轮次号——改为按阶段事实如实分写两种说法。

## 7. 残余

- 无可读 run.json 的轮次号：front-matter 缺失或损坏、且后缀落在排除集的审查文档会被当原稿排除，若它是该轮唯一产出方，该轮不进时间线（run.json 读不出时主题告警有那份文件，从未存在时无声）；本阶段从未出现过的 Driver 的无 front-matter 原稿会被当审查文档，「读不到 Driver」组多计一轮。
- 有可读 run.json 的轮次号：某审核者恰在同号另一次运行里当过 Driver、又是该轮唯一产出方时，该轮不进时间线；那次运行会以「登记了审查文档却未进时间线，请核对」出现在未进时间线表里。
- 以上都只影响「读不到 Driver」组或时间线的完整性，不污染任何已知 Driver 的读数。第七节 token 键排序仍用 `localeCompare`（既有代码，不在本步范围）。
