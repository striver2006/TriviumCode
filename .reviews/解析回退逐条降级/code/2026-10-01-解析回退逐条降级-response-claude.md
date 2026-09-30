---
schema: trivium.disposition.v1
topic: 解析回退逐条降级
stage: code
role: claude
kind: response
run_id: 20260930T190327Z
addresses:
  - 2026-10-01-解析回退逐条降级-codex.md
  - 2026-10-01-解析回退逐条降级-gemini.md
  - 2026-10-01-解析回退逐条降级-glm.md
---

# 应答：解析回退逐条降级 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260930T190327Z.diff`（相对 `d418ce7` 的 68 个文件）
> ｜ 运行：`20260930T190327Z`（约 12 分 37 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 3、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 2）
> ｜ 共 9 条：接受 9、驳回 0、暂缓 0（CODEX-03、CODEX-05 部分采纳，理由见表）；三侧均为结构化结论，无降级、无回退

## 0. 核实记录

- **CODEX-01**：成立。`enumerateFallbackFindings` 只按空行 / 列表 / 标题切块，原文是一个 JSON 对象时（`root_invalid`、`finding_unaddressable`、`foreign_prefix` 三种成因都拿得到对象）整个对象落成一个 F 单元。这不是本补丁引入的回归，但「逐条」口径立起来之后，这一格就是同族里没被说出的残余；而这三种成因下对象与 `findings` 数组都已解析出来，按下标逐条出单元是现成的、无损的。`json_syntax` 与 `no_json_object` 拿不到对象，维持原切块。
- **CODEX-02**：成立。P9 的键集来自两条手写夹具，新加一个由新输入字段控制的条件键而夹具没跟时 P9 仍绿。核过 `renderFrontMatter` 的对象字面量：顶层键固定四格缩进（含一处简写 `vendor,`），条件展开 `...(cond ? { k: … } : {})` 与多行条件对象（`peer_leak`、`joint_check` 在十格缩进）形态固定，可以从源码静态枚举。
- **CODEX-03**：一半成立。`findings_degraded` 在 front-matter 是**条数**、在 run.json 是**编号数组**——同名异型，成立。`parse_repairs` 不成立：两处写的是**同一份完整记录**（front-matter 直接渲染 `input.parseRepairs`，含厂商字段），差别只在**出现条件**（文档只在有审查员造成的修复时出现）；「front-matter 只含审查员造成的那部分」与代码不符。
- **CODEX-04**：成立。`mutation-names.mjs` 的恢复只靠 `try/finally`，进程被信号终止时不执行；正式装置有哨兵而副本没有。
- **CODEX-05 ≡ GLM-02**：成立。「不合格意见」一节表格单元格没转义竖线、反引号包裹会被值里的反引号截断，列会错位。CODEX-05 另建议给段落（问题 / 依据 / 建议）也加长度上限——不采纳这一半：那是审查员的原话，裁决者要读全文才能判断成不成立，截断会丢信息；单元格截断则只影响本来就短的字段。
- **CODEX-06**：成立。「可选根字段是字符串数组」这半句按当前 schema 碰巧的形状写死，schema 加一个非数组的可选根字段时文案会失实而 B 组不红。
- **GLM-01**：成立。`checkReviewIntegrity` 的前缀与撞号已按「合格 ∪ 降级」判，evidence-consulted 交叉核对却只走合格意见；缺 `confidence` 而降级的意见 evidence 完好，照样该核。
- **GLM-03**：成立。`parse.ts` 注释写「`parse.test.ts` P9」，P9 实际在 `parse-degrade.test.ts`。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | 重要 | 接受 | 整份回退但对象拿得到时整个 JSON 塌成一个 F 单元，与「逐条」口径相悖；对象与 `findings` 数组已解析出来，按下标逐条出单元无损 | `parse.ts` `enumerateFallbackFindings`：先按现有候选机制（含还原非法转义）取第一个根为对象且 `findings` 为非空数组的候选，按下标每条意见一个 F 单元（正文是那一条的原文 JSON）；拿不到时维持原切块。新用例 P15（根不合 ⇒ N 条单元、各含对应编号）、P15′（`no_json_object` 仍按散文切）；集成 I2 的回退侧不变。设计 6.5.1 表格与 MANUAL 成因表写明「对象拿得到时按意见逐条出 F 单元，否则按原文段落切」。旧归档的 `.fallback-items.md` 是运行时落盘的，不受影响 |
| CODEX-02 | codex | 次要 | 接受 | 夹具枚举的守卫在新条件键上会假绿；键在源码里排布固定，可改成来源枚举 | 新用例 P9′：读 `src/trivium/render.ts`，截 `renderFrontMatter` 的对象字面量，按四格缩进顶层键 / 简写 / 条件展开 / 十格条件对象四种形态静态枚举键集，断言它 = P9 的全开渲染键集 = 清单 + `review.v1` 根属性；扫不出任何键或形态认不出时当场红（防扫描器自身失效）。`parse.ts` 注释改说「P9 渲染绑定 + P9′ 源码绑定」 |
| CODEX-03 | codex | 次要 | 接受 | `findings_degraded` 同名异型成立；`parse_repairs` 两处本是同一份完整记录、只是出现条件不同，这一半不改代码、改文档措辞 | `render.ts`：front-matter 的 `findings_degraded` 改为**编号数组**（与 run.json 同型；条数由数组长度得）；R1 断言随改。设计 6.5 front-matter 注释与 6.5.1、PROTOCOL 表格写明两处 `findings_degraded` 同型、`parse_repairs` 两处同为完整记录（文档只在有审查员造成的修复时出现）|
| CODEX-04 | codex | 次要 | 接受 | 被强制终止时 `finally` 不执行，工作树会带变异残留而无提示 | `mutation-names.mjs`：开跑落哨兵 `.mutation-names-running`（内容为各目标文件的 sha256），已存在即拒跑并提示按哨兵内哈希核对恢复；正常收尾删哨兵；输出 JSON 附目标文件 sha256。脚本头写明被强杀后的处置 |
| CODEX-05 | codex | 吹毛求疵 | 接受 | 单元格竖线与反引号会错列；段落不截断（审查员原话要读全，见核实记录） | `render.ts` `renderDegradedSection` 的 `cell()`：竖线转义、不再用反引号包裹、超过 200 字截断并注「全文见 `.degraded.json`」；段落不动。R4 补一格（值含竖线与反引号时表格仍是四行两列）|
| CODEX-06 | codex | 吹毛求疵 | 接受 | 可选根字段类型按当前 schema 写死 | `brief.ts` `renderOutputContract`：逐个可选根字段按 schema 的 `type` / `items.type` 生成类型描述（「字符串数组」等），认不出的类型不写类型只列名；B2 补断言：文案里每个可选根字段的类型描述与 schema 一致 |
| GLM-01 | glm | 次要 | 接受 | evidence 交叉核对与同函数前缀 / 撞号口径不一致 | `checkReviewIntegrity` 第三参由编号数组改为降级意见（`{ id, raw }`，仍必填），evidence 为字符串的降级意见并入 `pathRe` 扫描；`review.ts`、gate 重试、`guard.judgeSide` / `judgeRun`（字段改名 `degraded`，仍必填）同批改；P12 补一格（降级意见 evidence 引用未列入 consulted 的文件 ⇒ 报出） |
| GLM-02 | glm | 吹毛求疵 | 接受 | 与 CODEX-05 同一缺口（≡） | 同 CODEX-05 |
| GLM-03 | glm | 吹毛求疵 | 接受 | 注释指错文件 | `parse.ts` 该注释改为 `parse-degrade.test.ts` 的 P9 / P9′ |

gemini 侧零意见（`approve`），无条目需应答；本表覆盖 codex 6 条、glm 3 条，共 9 条。

## 2. 修订后的复验

按上表改完后：受影响用例与新格、移植验收（新格在改前构建上须红）、变异（新增 P15 / P9′ / GLM-01 对应变异，逐条预跑后正式跑）、普查改后重放（F 单元数的变化逐份列出，判定面不应变）、Node 18 / 22、全量检查两次、doctor 自检，读数补进报告 §9。
