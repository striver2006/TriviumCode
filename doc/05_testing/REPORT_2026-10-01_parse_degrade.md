# 测试报告：解析回退逐条降级（EV-10 / EV-56 / EV-105 / EV-113 / EV-124）

> - **日期**：2026-10-01
> - **起点**：`d418ce7`（`main`）
> - **计划**：`.reviews/解析回退逐条降级/plan/` r2（计划双审第 1 轮 run `20260930T180539Z`，11 条：接受 10、驳回 1）
> - **设计**：v1.3.68（新增 §6.5.1 解析与降级）；LLD v1.1.26；MANUAL v1.0.24
> - **证据目录**：[`evidence/parse-degrade-20261001/`](./evidence/parse-degrade-20261001/)

## 1. 做了什么

审查员的结构化结论过去只要有一条意见不合 `trivium.review.v1`、字符串里有一处非法转义、或根对象多带了编排器自己会写的元数据，就**整份**判 `parse_fallback`，全部意见塌成 `<前缀>-F<n>` 兜底单元、该侧失去阻断资格、共同阻断降级。本主题改为：

| 情形 | 改前 | 改后 |
| :-- | :-- | :-- |
| 根对象合法，个别意见缺字段 / 表外值 / 多字段 | 整份回退 | **逐条降级**：该侧 `ok`；不合格的那几条保留原编号、逐条裁决、不参与阻断与共同阻断，渲染里逐字段标出；合格意见照常 |
| 根对象带编排器 front-matter 键（`topic` 等） | 整份回退 | 校验前剥掉并留痕（`parse_repairs.stripped_fields`） |
| 字符串里的非法转义（反斜杠加竖线等） | 整份回退 | `JSON.parse` 失败时按字面还原并留痕（`parse_repairs.unescaped_backslashes`） |
| 没有 JSON / 语法修不好 / 根不合 / 编号不可用 / 前缀不属本侧 | 整份回退，无成因字段 | 仍整份回退，**标成因**（`parse_fallback_cause`） |

另：任务书第 6 节列出全部必填字段与四个枚举字段的合法取值（从 schema 读）、写明裸 JSON，zcode 侧固定「不要调用 ExitPlanMode」；gate 期望集并入降级编号（含空表守卫）、新告警 `degraded_findings`、旧留痕重试部分合格仍按 F 编号并补前缀归属核对；report 逐侧意见数带「另 N 条逐条降级」。codex 适配器 argv 不变（EV-124 实测结论，§3）。

改动文件：`src/trivium/{parse,review,gate,render,brief,guard,report,cli,types}.ts`、`src/trivium/adapters/{codex,stub}.ts`、`skills/dual-critic/schema/run.v2.json`（`critic` 定义加三格 `properties`，`additionalProperties` 本就为 true）。

## 2. 普查：改前实证与改后逐份对照

脚本 `census.mjs`（只读、零配额，不改 `src/`）。每份回退样本三组读数：不经 `src/` 的独立分析与**预测**、指定构建的 `parseReview` 实际结果、该构建 `loadRoundReviews` + `checkAdjudication` 的只读复核。改前构建 = `git archive d418ce7`（scratchpad，`node_modules` 软链工作树）。

| 读数 | 文件 |
| :-- | :-- |
| 起草期原始普查（上一会话 scratchpad，原样拷入） | `census-origin.mjs` / `census-origin.json` |
| 改前构建、脚本 r0 | `census-pre-d418ce7.json` |
| 改前构建、脚本 r2（清单 35 键、覆盖才替换、跨候选丢失编号栏） | `census-pre-d418ce7.r1.json`；与 r0 逐份对照 0 差异（`compare-pre-r0-r1.json`） |
| 改后构建 | `census-post.json`；与改前逐份对照 `compare-post.json` |

**改前**：全仓 564 份审查元数据，回退 48 份（codex 28、glm 16、gemini 4）；当前解析器重放：已能解析 2、整份回退 46。按新规则的独立预测：整份合格 9（5 份非法转义、2 份回显字段、2 份改前已能解析）、逐条降级 32、仍整份回退 7（没有 JSON 3、语法修不好 2、根字段不合 2）。根合格候选里 297 条意见、预测降级 137 条（缺 `confidence` 97、`kind` 表外 22、`layer` 表外 17、`severity` 表外 7、多余字段 1、缺 `location` 1），**降级意见编号全部可用**。48 份里没有一份有两个以上根合格候选（`multi-cand.mjs`）。引言与代码围栏不是成因：38 份散文 + 围栏、4 份纯散文、6 份裸 JSON。

**改后**（`compare-census.mjs --mode pre-post`）：

- 48 份**逐份**「独立预测 = 改后解析器实际结果」（形态、合格数、降级数、剥掉的键、还原处数、成因），不一致 0；
- 改前能解析的 2 份不退化；跨候选丢失编号 0；
- 历史轮次闸门翻转 **5 轮**，恰是计划 r2 §3.6 预测的那 5 轮：`CLI进程组记录` code、`M8-Codex审核者接入` plan `20260915T105915Z` 与 code `20260915T024740Z`、`M9-Hook当轮Driver保护集` code、`M9-裁决件角色契约放宽` plan。全部是「当时整份回退、按 F 编号裁决，现在重试全合格按结构化校验」——失败面是 `missing_findings`（原编号）+ `unknown_findings`（F 编号），口径差、不是漏裁。审批复核只对最新一轮跑、提交锚不跑裁决校验，日常流程碰不到；只在手工 `gate --check --run-id` 钉这些历史轮次时出现。其余 37 轮判定不变（改前就失败的 19 份样本所在轮，失败原因是与本主题无关的 EV-134 `addresses` 口径与被重跑取代的轮次，改后不变）。

## 3. EV-124：codex `--output-schema` 实测（计划阶段，两次最小调用）

读数 `ev124-probe/`。`codex 0.159.2`、`-p qwen -m qwen3.8-flash`、只读沙箱、空目录。

| 调用 | schema | 提示 | 结果 |
| :-- | :-- | :-- | :-- |
| 1 | `review.v1.json` | 要求输出一份故意违规的结论（根带 `topic`、`severity: medium`、`layer: docs`、`kind: risk`、缺 `confidence`） | 退 0；输出逐字照提示，五处违规全在 |
| 2 | 严格模式兼容的最小 schema | 要求输出 `{"answer":"no","extra":1}` | 退 0；照输出 |

结论：**本机 qwen provider 静默忽略 `--output-schema`**；第 2 次排除了「schema 不合严格模式被丢弃」。第 3 次不做。不接 argv，`buildCodexArgs` 文档块记下实测与适用范围；其它 provider 未测，另登 EV-179。

## 4. 用例与移植验收

新文件：`test/unit/parse-degrade.test.ts`（P1～P14，含 P5′ / P5″ / P5‴ / P6′ / P7′ / P10①～④）、`gate-degrade.test.ts`（G1～G11）、`render-degrade.test.ts`（R1～R5′）、`brief-output-contract.test.ts`（B1～B5）；`test/integration/fault-injection.test.ts` 加 I1、I2（桩新行为 `partial_schema` 走全链路）。既有 `parse.test.ts` 两格按新语义改写（单条意见缺字段 / 表外值 ⇒ 逐条降级，不再整份回退），一格改名（「走得最远那一格」）；既有单测调用点补新必填参数（`checkReviewIntegrity` 第三参、`checkAdjudication` 的 `expectedDegradedIds`、`judgeSide` / `judgeRun` 的 `degradedIds`）。

**移植验收**（`port-acceptance.mjs`，只叠加测试文件到改前构建、`src/` 与 `d418ce7` 逐字节核对；bundle sha256 新旧不同）：**81/81**——新行为格 42 格在改前构建上全红、〔回归〕格 39 格全绿（`port-acceptance.json`）。r0 为 80/81（`port-acceptance.r0.json`）：G3「降级意见接受也要写落点」在改前构建上是绿的——旧闸门对所有非 F 编号的行本就要求落点，这一格原样只锁住了回归面；已收紧为「只报缺落点、不报多余裁决」，于是只在新行为下成立。

## 5. 源码变异

`gen-mutation-spec.mjs` 从现行源码截锚点并核对唯一（18 条）；`mutation-names.mjs` 逐条带 `--test-timeout` 预跑（因有集成套件，重建用 `--with-tests`），18/18 咬住、无挂死（`mutation-names-output.json`、`mutation-names-log.txt`）；再用 `scripts/mutation-check.mjs` 正式跑 **18/18 咬住**（`mutation-output.txt`）。覆盖：`u` 加四位十六进制两种放宽、回显清单删键、根校验不要求数组、逐条降级退回整份判死、选取不看覆盖、修复跨候选沿用、成因取最后一格、完整性校验不看降级编号、`empty_review` 退回旧式、run.json 不记降级编号、gate 期望集与空表守卫漏并、重试把部分合格当成功、重试不核前缀、ExitPlanMode 条件取反、不渲染不合格一节、厂商剥离也挂横幅。

**等价变异（不列）**：计划 §5.4 的「还原条件去掉『只在解析失败时』」——合法 JSON 里不存在非法转义，还原对它是恒等变换，这条变异在任何输入上与原码行为相同，装置判不出。约束本身由实现结构保证（`evaluateCandidate` 只在 `catch` 里调用）。

## 6. 其余读数

| 项 | 读数 |
| :-- | :-- |
| Node 18.20.8 / 22.23.3（npx 缓存）跑 14 个相关文件 | 357 / 357、357 / 357（`node18.txt` / `node22.txt`） |
| 编码期摸底全量检查 | 2409 / 2407 / 0 / 2（`check-0-coding.txt`） |
| 全量检查两次、doctor 自检 | 见 §8 |

## 7. 相对计划 r2 的细化与新核出

- **横幅与 front-matter 只展示审查员造成的修复**：实测 agy 每轮都注入 `toolAction` / `toolSummary`，若厂商字段的剥离也挂横幅，每份 gemini 文档都会常驻一条修复警示。run.json 的 `parse_repairs` 仍恒写完整记录（含厂商字段），文档只在剥掉回显字段或还原过非法转义时渲染（`render.ts` `hasReviewerRepairs`，R2 与 M18 锁住）。
- **gate 重试补前缀归属核对**（新核出的同族缺口，已在本主题修）：改前 `loadRoundReviews` 重试成功即按结构化校验，不核前缀——一份因冒名前缀被判回退的原文，重试后会让冒名编号进结构化期望集，与 `review.ts` 那道后盾的论证相悖。现与 `review.ts` 同口径（G11、M15）。
- **`guard.judgeSide` 的完整性告警**同样按合格 ∪ 降级判（`degradedIds` 必填），否则全部降级的一侧会被误报「零意见未说明」。
- 任务书第 6 节文案里的「9 个字段」由 schema 的 `required` 长度生成。
- `skills/dual-critic/SKILL.md`（:19）与 `AGENTS.md` 的契约面描述只到 schema 文件级、未列逐侧字段，核后不改。PRD 核后不改（FR-19 / AD-08「不参与阻断判定」的语义未变）。
- 新登 BACKLOG EV-178（语法修不好的形态，2 份样本）、EV-179（codex `--output-schema` 按 provider 实测）；EV-11 补「统计面已有」注记。

## 8. 全量检查与 doctor

| 项 | 读数 |
| :-- | :-- |
| `npm run check` 第 1 次 | 2410 / 2408 / 0 / 2，退 0（`check-1.txt`） |
| `npm run check` 第 2 次 | 2410 / 2408 / 0 / 2，退 0（`check-2.txt`） |
| `doctor --selftest`（仓库构建） | 14 / 14，退 0（`doctor-selftest.txt`） |

以上为代码双审之前的编码期读数；按接受项修订后的读数见 §9。

## 9. 代码双审 r1 与修订后读数

代码双审第 1 轮 run `20260930T190327Z`：gemini `approve`（零意见）、codex `approve-with-nits`（6 条）、glm `approve-with-nits`（3 条），9 条全接受（CODEX-03、CODEX-05 部分采纳，理由见应答件 `.reviews/解析回退逐条降级/code/…-response-claude.md`）。修订：

| 意见 | 改了什么 | 锁它的用例 / 变异 |
| :-- | :-- | :-- |
| CODEX-01 | 整份回退而对象拿得到（根不合、编号不可用、前缀不属本侧）时，F 单元按意见逐条出、正文是那一条原文；拿不到对象照旧按段落切 | P15、P15′〔回归〕／M19 |
| CODEX-02 | 回显清单加源码静态枚举绑定：从 `render.ts` 的 `renderFrontMatter` 对象字面量按四种排布形态枚举键集，认不出的顶层行当场红 | P9′／M24（新增一个夹具没覆盖的条件键：**P9 仍绿、P9′ 红**，正是本条指出的盲区） |
| CODEX-03 | front-matter 的 `findings_degraded` 改为编号数组，与 run.json 同型；`parse_repairs` 两处本是同一份完整记录（只是出现条件不同），只改文档措辞 | R1／M23 |
| CODEX-04 | `mutation-names.mjs` 加哨兵 `.mutation-names-running`（内容 = 目标文件变异前 sha256，残留即拒跑），输出带目标哈希 | 修订后预跑实测：正常收尾哨兵已删 |
| CODEX-05 ≡ GLM-02 | 「不合格意见」表格单元格转义竖线、不再用反引号包裹、超 200 字截断；段落不截断 | R4′／M21 |
| CODEX-06 | 任务书可选根字段的类型从 schema 的 `type` / `items.type` 生成 | B2′／M22 |
| GLM-01 | `checkReviewIntegrity` 第三参改为降级意见本身（仍必填），evidence-consulted 核对并入；`judgeSide` / `judgeRun` 字段改名 `degraded` | P12′／M20 |
| GLM-03 | `parse.ts` 注释改指 `parse-degrade.test.ts` 的 P9 / P9′ | — |

修订后读数：

| 项 | 读数 |
| :-- | :-- |
| 变异（24 条：原 18 + 本轮 6） | 逐条预跑 24/24 咬住、无挂死（`mutation-names-log.txt`、`mutation-names-output.json`）；正式装置 **24/24 咬住**（`mutation-output.txt`）。r0 读数保留为 `*.r0.*` |
| 移植验收 | **87/87**：新行为 47 格在改前构建上全红、〔回归〕40 格全绿（`port-acceptance.json`；编码期 r1 为 81/81，`port-acceptance.r1.json`） |
| 普查改后重放 | 48/48 与独立预测一致，跨候选丢失编号 0，闸门翻转仍是那 5 轮（`census-post.r1.json`、`compare-post.r1.json`） |
| F 单元新旧对照（改后仍整份回退的 7 份） | 两份 `root_invalid` 改为按意见逐条出（EV-122 code glm：4 → 3，codex：3 → 3，单元正文由「散文段 + 整段 JSON 混块」变为每条意见一个），其余 5 份拿不到对象、单元不变（`fallback-units.json`）。CODEX-01 说的「一个巨型单元」在这两份真实样本上没有出现（它们的原文恰好被空行切开），但单元边界与意见并不对应；合成样本 P15 上改前确是 1 个单元 |
| Node 18.20.8 / 22.23.3 跑 17 个相关文件 | 437 / 437、437 / 437（`node18.r1.txt` / `node22.r1.txt`） |
| `npm run check` 两次 | 2416 / 2414 / 0 / 2、2416 / 2414 / 0 / 2，均退 0（`check-r1-1.txt`、`check-r1-2.txt`） |
| `doctor --selftest`（仓库构建） | 14 / 14（`doctor-selftest.r1.txt`） |
| **`trivium verify`**（S10 出口，run `20260930T194619Z`） | 通过：typecheck / build / test 三条命令，测试 2416 / 2414 / 0 / 2，262 s（留痕 `.reviews/解析回退逐条降级/verify/`） |
