---
schema: trivium.disposition.v1
topic: M9-验收实跑
stage: code
role: claude
kind: response
run_id: 20260919T130240Z
addresses:
  - 2026-09-19-M9-验收实跑-codex.md
  - 2026-09-19-M9-验收实跑-gemini.md
  - 2026-09-19-M9-验收实跑-glm.md
---

# 代码审应答：M9-验收实跑（第 6 步第 1 轮改动）

## 0. 应答总览

三侧均 `request-changes`，共 15 条（重要 6 ｜ 次要 6 ｜ 吹毛求疵 3）：**接受 14 ｜ 驳回 1 ｜ 暂缓 0**。

三侧**独立收敛到同两条 major**，都是我这批修复留下的「半边」：

1. **CODEX-01 ≡ AGY-01 ≡ GLM-01**：`CLAUDE_OUTPUT_TOOLS` 只在适配器的写事件判据里承认 `StructuredOutput`，探针的 `judgeToolSurface` 不认它。
   EV-75 自己登记的修法（两臂合并）一落地就会把 claude 侧判不可用。同一事实两份实现——本仓反复出事的家族。
2. **CODEX-02 ≡ AGY-02 ≡ GLM-02**：`readonly_breach` 只有渲染面没有处置面，`gate --check` 一个字不看它。
   本轮留痕就是实证：旗标 true、闸门绿。EV-75 修的是假阳性，真阳性同样不拦。

两条都在本批修，理由见 §2。驳回的一条（AGY-03）是「把契约文件改成 draft-07」——我实跑 `Ajv2020`：draft-07 头当场 `no schema with key or ref`，改了 `parse.ts` 加载期就崩。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 已实核 `judgeToolSurface`：`extra = tools − READONLY_TOOLS`，非空即 `clean:false` → 探针清空 `readonly_flags` → `doctor` 判恒 blocker、`availability()` 拒、`buildClaudeResult` 空白名单抛错。带 `--json-schema` 的 `init.tools` 实测含 `StructuredOutput`，EV-75 的修法照字面执行会锁死该侧。豁免是硬编码名字、无对账，CLI 再注入一个工具时两侧都不会变红。 | `probes/claude.ts` 从 `adapters/claude-trace.ts` 引 `CLAUDE_OUTPUT_TOOLS`（方向同 `claude-trace` 搬家先例，不违反「adapters 不得 import probes」）；`judgeToolSurface` 把输出通道从 `extra` 里分出来、新增返回字段 `outputChannel: string[]`，`clean` 不因它为 false；`test/unit/claude-adapter.test.ts` 补两条：含 `StructuredOutput` 的 tools 判 clean 且 `outputChannel` 列出它；`Write` 仍进 `extra`（变异守卫）；BACKLOG EV-75「本条要做的」改写为「两臂合并 **且** 工具面判据认得输出通道，事实取单一来源」 |
| AGY-01 | gemini | major | 接受 | 与 CODEX-01 独立收敛到同一事实，核实一致。采纳「同源」的方向，不在两处各写一份清单。 | 同 CODEX-01 |
| GLM-01 | glm | major | 接受 | 与前两条同一事实。它多指出一点：A6b 的同源对账只覆盖读工具集、不覆盖输出通道——所以对账用例要补的是「探针期望集 = `--tools` 白名单 ∪ `CLAUDE_OUTPUT_TOOLS`」这一条，而不只是锁一个正例。 | 同 CODEX-01；对账用例落在 A6b 旁 |
| CODEX-02 | codex | major | 接受 | 已实核：`readonly_breach` 的消费点止于 `guard.renderGuardWarnings` 的 console、`meta.ts:500` 的 status 行、`report.ts:245` 的 guardFlags；`review.ts` 退出码只看 drift 与 `mode.abort`；`gate --check` 的 failures/warnings 无此项。设计 §1.2 guard 行写「中止决策（交给 gate）」、AD-06 写「主仓库被写入即中止并列出受影响文件」——落点不存在。历史留痕核过：本仓无 `readonly_breach: true` 的 run.json，接线无兼容负担。 | `gate.ts` `loadRoundReviews` 增返回 `readonlyBreach: { hit: boolean; files: string[] }`（读 `runMeta.guard.readonly_breach` / `breached_files`）；`checkAdjudication` 增 `GateCheckInput.readonlyBreach`，`hit` 为 true 即 failure `readonly_breach`（message 按 AD-06 列出文件）；`cli.ts` 两处 `--check` 调用点透传；`test/unit/gate.test.ts` 补正反例（true 即失败并列文件；false / 缺字段不失败）。BACKLOG EV-75 里「只进 `report.ts`」改准为「落盘 run.json guard 段并在 summarizeRun / report / console 三处渲染，无任何失败面消费」 |
| AGY-02 | gemini | major | 接受 | 与 CODEX-02 同一缺口。它的前提「以适配器层零误报为前提」成立：本批 `CLAUDE_OUTPUT_TOOLS` 修复与接线同批合入，已知的那个假阳性已消除。 | 同 CODEX-02 |
| GLM-02 | glm | major | 接受 | 同一缺口，且它把裁定要素列全了。两条前置我**只取一半**，如实写明：①「EV-75① 两臂合并先行」不取——假阳性的根在适配器判据，本批已修；探针两臂合并是探针侧的独立改进，不是闸门接线的前置。②「写失守改逐侧留痕」取，但作为后续：`guard` 已逐侧算 `readonlyBreach`，run.json 只落整跑布尔 + `breached_files`，本批先按整跑布尔接失败面（文件清单已带工具名），逐侧形状与「作废侧」语义登记进 EV-75。它同桶指出的 `consulted_unverified` 在闸门输出里不可见：run.json 无该字段、只在 front-matter 条件展开，本批不接，登记进 EV-76 作为 J5 可见性的一项。 | 同 CODEX-02；EV-75 补逐侧留痕与作废语义；EV-76 补「J5 结果在闸门输出里可见」 |
| CODEX-03 | codex | minor | 接受 | 已实核：全仓三处造 `--json-schema` 值——适配器（经 `readSchemaJson`，已剥）、`probes/claude.ts:1184`（自造迷你 schema）、`scripts/claude-admission-control.mjs:452`（第二份自造），后两处不经剥离。EV-74 若照「探针改喂真实文件」做而不走同一份变换，会撞未剥的 2020-12 头 → 零 result 事件 → `judgeJsonSchema` 落 **null** 而非 false，三态纪律里 null 不报警，且 `json_schema_ok` 无 doctor 消费方——静默回归。 | `buildClaudeArgs` 内对 `schemaJson` 做幂等归一（`stripMetaSchemaRef` 已幂等），使「送 CLI 的那一份」只有一个出口；`probes/claude.ts` 结构化输出臂经同一函数（今天是空操作，为 EV-74 铺路）；EV-74 落点栏补 `scripts/claude-admission-control.mjs`，修法改写为「探针改喂**经适配层同一份变换**的真实契约文件」 |
| CODEX-04 | codex | minor | 接受 | 已实跑复现：`Ajv2020` 对 draft-07 头 `no schema with key or ref`，对无头与 2020-12 均 compile。所以报告 §3.1 表里「改 draft-07 → 接受」只说了 CLI 那一半，对契约文件是加载期崩溃，需加注。剥壳后 CLI 按自己方言校验，`review.v1.json` 今天只用公共子集（我逐键核过与其一致），但同目录 run.v2 / config.v2 就是 `$defs`+`$ref` 写法，重构时会自然带进来，届时 CLI 静默忽略或直接拒、留痕分不出哪种。 | 新增契约用例 A31：递归扫描经 `stripMetaSchemaRef` 后的 `review.v1.json`，断言不含 2020-12 独有关键字（`$defs`、`prefixItems`、`unevaluatedProperties`、`unevaluatedItems`、`dependentSchemas`、`dependentRequired`、`$anchor`、`$dynamicRef`、`$dynamicAnchor`、`$recursiveRef`、`minContains`、`maxContains`、`$vocabulary`），失败信息指向设计 §3.7；变异（塞一个 `$defs`）即红。报告 §3.1 draft-07 行加注「对契约文件不可用：本仓 `parse.ts` / `schemas.ts` 的 Ajv2020 拒绝 draft-07 头（已实跑）」；适配器注释同步补这条理由 |
| GLM-03 | glm | minor | 接受 | 与 CODEX-04 同一残余风险，且把方向说准了：焦点一后半句「掩盖被拒」不成立（校验器不认的东西照样响亮报错），真正的残余是**忽略方向的静默分叉**。金丝雀用例正是它建议的形态。 | 同 CODEX-04 的 A31；`review.v1.json` 顶层 `description` 加一句「只用 draft-07 与 2020-12 的公共关键字子集，理由见 A31」 |
| AGY-03 | gemini | minor | 驳回 | 它的建议是把 `review.v1.json` 的 `$schema` 收敛为 draft-07「从源头消灭剥离逻辑」。实跑 `Ajv2020` 的结果是 draft-07 头当场抛 `no schema with key or ref "http://json-schema.org/draft-07/schema#"`——`parse.ts` 与 `schemas.ts` 都用 Ajv2020，改了是加载期崩溃，不是取舍。它引报告 §3.1「实测改 draft-07 被接受」作依据，那一行只测了 CLI 侧，本次已按 CODEX-04 加注。它描述的静默忽略风险本身成立，已由 CODEX-04 / GLM-03 的金丝雀用例承接，不需要改契约文件。 | 无修改；风险由 A31 承接 |
| CODEX-05 | codex | nit | 接受 | 已实核 `test/helpers/fixture.ts:31-33` 导出 `REPO_ROOT` / `ASSET_ROOT`（`fileURLToPath` + 向上找 package.json），其它 schema 用例都走它；`URL.pathname` 是百分号编码片段，仓库路径带中文或空格即 ENOENT。 | `claude-adapter.test.ts` 的 `REVIEW_SCHEMA_PATH` 改 `path.join(ASSET_ROOT, 'schema/review.v1.json')` |
| CODEX-06 | codex | minor | 接受 | 已实核 `git check-ignore -v` → `.gitignore:114:*.log` 命中两份 worker log，报告「留痕已收进仓库」对它们不成立；刻 A/B、J8、EV-66 四项零成本判据的原始输出只有报告转述；§1.3「干净树」与「第 2 跑 = 3617077 + 剥离」并读矛盾。 | 两份日志改名 `worker-*.log.txt`；新增 `evidence/…/hook-and-gate-outputs.md` 收刻 A / 刻 B 的直喂 JSON、退出码与拦截文案、J8 输出、EV-66 两次 `gate --check` 输出（本会话照录）；报告 §1.3 改为「第 1 跑 = 3617077 干净树；第 2 跑 = 3617077 + 未提交的 `$schema` 剥离（本改动提交后可由该 commit 重建，哈希 198fc87…）」 |
| GLM-05 | glm | nit | 接受 | 与 CODEX-06 同一缺口，且点出报告 §4 EV-66 行「两次输出均照录」承诺了不存在的东西——这是失实断言，按本仓「归档件里的失实断言先改再提交」处理。 | 同 CODEX-06；报告 §4 该行改指 `hook-and-gate-outputs.md`；EV-71 关闭记录补「原始输出见该文件」 |
| CODEX-07 | codex | minor | 接受 | 已实核 `guard.ts:346-360`：前缀切片 + 精确相等 + `./` 变体，无 realpath；`probes/claude.ts` 的 `judgeTracePathStructured` 确已登记过 macOS `/var` 与 `/private/var` 的假阴性。本轮 10/15 说明前缀对了，不改变本次结论，但 EV-76 三条出路都保留这个匹配器，裁定前要把假阴性方向算进去。 | 无代码改动；EV-76 增一段「裁定前置：匹配器改按归一化相对路径比对（realpath、`/tmp` 与 `/private/tmp`、绝对/相对/`./`），并补『同一文件不同写法必须匹配』用例，修完再谈阈值」 |
| GLM-04 | glm | nit | 接受 | 已实核 `meta.ts:500` 渲染「⚠️ 只读失守」、`review.ts:1289` 落盘、`report.ts:245` guardFlags——三处渲染，「只进 report.ts」说窄了，做 EV-75② 的人会从单点起查。 | 报告 §3.2 与 EV-75① 措辞改为「落盘于 run.json guard 段并在 summarizeRun / report / console 三处渲染，但无任何失败面或作废判定消费它」（与 CODEX-02 的接线同批，改完那句就成了历史陈述，加「本批已接进 `gate --check` 失败面」） |

**统计**：接受 14 ｜ 驳回 1 ｜ 暂缓 0。

## 2. 双方共同指出的问题

- **工具面判据分叉**（CODEX-01 / AGY-01 / GLM-01）：修法取「单一来源」——探针引适配器的 `CLAUDE_OUTPUT_TOOLS`，对账用例锁「期望集 = 白名单 ∪ 输出通道」。不在两处各写一份。
- **`readonly_breach` 无处置面**（CODEX-02 / AGY-02 / GLM-02）：接进 `gate --check` 失败面，按 AD-06 列文件。逐侧作废与 J5 可见性登记为后续。
- **剥壳后的方言守卫**（CODEX-04 / GLM-03 / AGY-03 的风险半句）：金丝雀用例 A31。
- **证据可复核性**（CODEX-06 / GLM-05）：日志改名入库、零成本判据原始输出补档、构建身份措辞改准。

## 3. 不予采纳的意见及其依据

**AGY-03**：见表。核心依据是本仓两处 `Ajv2020` 对 draft-07 头的实跑拒绝（复现脚本三臂：draft-07 拒、无头过、2020-12 过）。它把报告 §3.1 那张 CLI 侧的表读成了「契约文件可改」，这层误导本批已在报告里加注。

## 4. 本轮未覆盖

- 三侧均未实跑 `npm test` / 变异脚本，A26～A30 的鉴别力是静态推演；本批新增 A31 与工具面、闸门用例后会再跑全量。
- EV-76 三条出路的取舍、`readonly_breach` 逐侧作废语义、探针两臂合并——均登记，不在本批。
- 刻 B 未覆盖的三层（matcher 分发、`sh -c` 守卫、`CLAUDE_PROJECT_DIR` 解析）三侧均照录报告，未独立实测（EV-77）。
