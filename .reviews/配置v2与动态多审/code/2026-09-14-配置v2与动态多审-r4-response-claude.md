---
schema: trivium.disposition.v1
topic: 配置v2与动态多审
stage: code
role: claude
kind: response
run_id: 20260914T050404Z
addresses:
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
  - GLM-08
---

# 代码审查应答：配置v2与动态多审（M7b 第 4 步 · 第 4 轮）

> 两侧均判 `request-changes`，各一条 major——**AGY-01 与 GLM-01 是同一条**，两侧独立收敛。
> 共 13 条意见，**全部接受**。major 已实测复现，非推演。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 已实测复现：`config.local.yaml` 只覆盖一侧的 `agent` 名，合并后 `default_critics` 变成 `["gemini"]`，另一家被静默清除 | 迁移**不再补** `default_critics`，详见下方修改方案一 |
| GLM-01 | glm | major | 接受 | 与 AGY-01 同一缺陷，但根因挖得更深：v1 的 `critics` 键集**从来不是选侧机制**（运行时走 `CRITICS` 全集），所以「补实有键」本身就是凭空改变行为。**采纳 glm 的修法**，它比加 schema 限制更彻底 | 同上；并修正被锁错方向的那条用例 |
| AGY-02 | gemini | minor | 接受 | 属实：`critics` 与 `agents` 并存时不进搬运分支，但 `delete` 照常执行且不记 changes，用户的自定义值无声消失 | `migrateConfigV1` 并存时记一条 change |
| GLM-03 | glm | minor | 接受 | 与 AGY-02 同一处。glm 补上了触发形态（手工升级时抄入 agents 段却忘删 critics）与纪律依据 | 同 AGY-02 |
| AGY-03 | gemini | minor | 接受 | 属实，且讽刺：残留处正在「改语义时凡断言该语义的文案都要一并过一遍」这句注释的**正下方**。上一轮刚学的，这一轮又漏 | `review.ts:363`、`cli.ts:124` 改主名并注明别名 |
| AGY-04 | gemini | minor | 接受 | 属实。手册是用户唯一会照着改配置的文档，滞后的代价比设计文档高 | `MANUAL_user.md` §4.2/§5.3/§5.4 与 `QUICKSTART.md` 的 init 说明 |
| AGY-05 | gemini | nit | 接受 | 属实：上一轮刚为 `run.v2.json` 建的枚举对账，新 schema 没纳入 | 见 GLM-02 的落点（合并处理） |
| GLM-02 | glm | minor | 接受 | 与 AGY-05 同一处，但 glm 多给了一条**关键边界**：扫描要区分「身份枚举」（禁止）与 `oneOf` 里的 `vendor const`（形状判别式，必须允许），否则会误伤 | `registry-parity` 增 `config.v2.json` 盯防点，并在注释里写明两者边界 |
| GLM-04 | glm | minor | 接受 | 属实的体验断档：配 `agents.nobody` 得到人话错误并被引导改用 `claude`，改了却撞上 ajv 的机读错误——**第一个错误把用户引向第二个错误** | `checkConfigAgents` 对「已登记但无形状」补一条人话 |
| GLM-05 | glm | minor | 接受 | 属实的实现窄于条文：告警让用户跑 `init`，而 `init` 只改写 `config.yaml`，`config.local.yaml` 仍是 v1 的项目跑完照旧告警 | **按源区分文案**（不扩 init 作用域），并回补设计写明只改写 config.yaml |
| GLM-06 | glm | minor | 接受 | 属实，且我核实出**三处**而非 glm 报的一处（AGENTS.md 24 / 68 / 96 行）。它是 Driver 与审查员的首读文件，自己的契约面计数却是错的 | 三处改为不含数字的表述；并补进 §24 台账 18.2.1 的排查对象 |
| GLM-07 | glm | nit | 接受 | 属实的可观察差异：双源皆 v1 时打两条告警，设计写「最多一次」 | 合并为一条告警 |
| GLM-08 | glm | nit | 接受 | 属实：`--dry-run` 下不写备份却用完成时态描述它，且该陈述进 `--json` 机读输出 | dry-run 分支改将来时，并补一条不落盘断言 |

## 修改方案

### 一、AGY-01 ≡ GLM-01（major）：迁移不该补 `default_critics`

**实测复现**（两源皆 v1，local 只覆盖一侧的 `agent` 名）：

```text
实得 default_critics = ["gemini"]
期望                = ["gemini","glm"]
```

两侧都抓到了，但给的修法不同，我**采纳 glm 的**：

- **gemini 的建议**是给 `default_critics` 补上 `schema === v1` 限制（与紧邻的 `max_critics` 一致）。
  这能挡住 local 片段，但**挡不住主配置只写一侧**的场景——那时仍会产出单元素集合。
- **glm 的建议**是迁移**根本不补**这个键，让它自然继承 `defaultConfig()` 的 `[...CRITICS]`。

glm 的根因分析是这条意见真正的价值所在，也推翻了我当初的理由：

> 我写「取实有键而不是全集，是为了不扩大审查面」，**前提是 v1 的 `critics` 键集表达了「选哪几侧」**。
> 这个前提是错的。`review.ts:334` 写着 `opts.onlyCritic ? [opts.onlyCritic] : [...CRITICS]`——
> v1 运行时走的是注册表派生的全集，**与配置里写了几家无关**。
> 所以「v1 只配了一家」的项目实际上一直在跑两家；迁移后把它变成一家，
> 不是「不扩大」，而是**缩小**，直接违反「旧配置不改也能跑、行为不变」这条本步的核心承诺。

还有两条佐证这是疏漏而非设计：设计 13.1.1 的迁移段只列了三件事（`critics→agents`、
`allow_single_flag` 改名、profiles 包装），没有「补 default_critics」；我自己给 `max_critics`
加了整份配置限制却没给紧挨着的 `default_critics` 加——**同一个函数里两处相邻的补默认值逻辑，
我只想到了一处**。

落点：

1. `migrateConfigV1` 删掉补 `default_critics` 的整段；
2. 修正 `config-migrate.test.ts` 里「取实有键，不扩大审查面」那条用例——**它把错误行为锁成了期望值**，
   这比缺用例更糟；
3. 新增一条 `loadCtx` 用例，断言「local 只覆盖单侧时，合并结果的 `default_critics` 仍是两家」。

### 二、AGY-02 ≡ GLM-03：并存时静默丢弃

现状：

```ts
if (c['critics'] !== undefined && c['agents'] === undefined) { /* 搬运并记 change */ }
delete c['critics'];   // ← 并存时也执行，且不记任何 change
```

与紧邻的 `allow_single_flag` 冲突处理（显式记录「以后者为准」）不一致。按同一模式补一条 change。

### 三、AGY-03：文案残留

`review.ts:363` 与 `cli.ts:124` 仍写 `review.allow_single_flag`。改主名、注明别名。

这条值得记一笔：**上一轮的 AGY-01 ≡ GLM-01 就是同类问题**（改语义没改文案），
我当时在 `review.ts` 里写下「凡断言该语义的文案都要一并过一遍」的注释——
而这次漏掉的那一行，就在那句注释下面十几行处。**写下教训不等于执行教训**，
下次改键名应当先 grep 旧键名全仓，而不是靠记忆逐处回想。

### 四、AGY-04：手册滞后

`MANUAL_user.md` §5.4 的字段表仍是 `critics.gemini.*` / `critics.glm.*`，§4.2 与 §5.3 仍写
`allow_single_flag`，且缺 `default_critics` / `max_critics`；`QUICKSTART.md:132` 声称
「init 对已存在的 config.yaml 无条件跳过、绝不覆盖」，与本步新增的一次性改写相悖。

手册是**用户唯一会照着改配置的文档**，滞后的代价比设计文档高。一并更新，
并在新增 `default_critics` 的条目里写明它「本步只校验、不接线」。

### 五、AGY-05 ≡ GLM-02：schema 枚举对账的覆盖缺口

上一轮刚为 `run.v2.json` 建的机器对账，本步新增的 `config.v2.json` 没纳入——
**同一个洞在新文件上重开**，与「白名单过期条目」那次是同一种形态。

glm 补的边界是关键：扫描必须区分两类 `enum` / `const`——

- **身份枚举**（`default_critics.items` 的取值）→ 禁止，那是注册表的职责；
- **形状判别式**（`agents` 的 `oneOf` 分支里的 `vendor: {const: ...}`）→ **必须允许**，
  那正是可辨识联合赖以工作的东西。

不写清这条边界，扫描一上来就会误伤 `oneOf`。落点是把盯防点做成显式路径清单而非全文搜索。

### 六、GLM-04：已登记但无形状的报错断档

用户配 `agents.nobody` → 两段式校验给出人话错误，并列出「已登记：claude、codex、gemini、glm」
→ 用户照着改成 `claude` → 撞上 ajv `oneOf` 的机读错误，不知道真正原因是「该 Agent 的配置形状
要等 M9/M10 才定义」。

**第一个错误把用户引向第二个错误**，这是我列出已登记 id 时没想到的后果。
在 `checkConfigAgents` 里对这类键补一条人话说明。

### 七、GLM-05：告警承诺与 init 作用域不符

告警说「想一次性改写磁盘请运行 `trivium init`」，而 `init` 只改写 `config.yaml`。
`config.local.yaml` 仍是 v1 的项目跑完 init 后照旧每次告警——**用户会以为 init 没成功**。

glm 给了三个选项，我选**按源区分文案 + 回补设计**，不扩 init 作用域：

`config.local.yaml` 不进 Git、是本机私有文件，`init` 去改写它越界了——
`init` 的职责是布置**团队共享**的运行时。对该源的告警改为「本文件不进 Git，
请手工把 `critics:` 改名为 `agents:`，或忽略本提示」。同时回补设计 13.1.1 写明
`init` 只改写 `config.yaml`，消除实现窄于条文的偏离。

### 八、GLM-06：AGENTS.md 的契约面计数失真

glm 报了一处，我核实为**三处**（24 / 68 / 96 行均写「四份 JSON Schema」，实存六份）。
失真自第 3 步起，本步加深。

按 GLM-04 那次的同一教训（会随时间变的量别写成定值），三处一律改为不含数字的表述。
并把 AGENTS.md 补进 §24 台账 18.2.1 的受控同步清单——**两次增份都没触发它的更新，
说明它不在任何人的排查视野里**，这才是要修的。

### 九、GLM-07、GLM-08（nit）

- 双源皆 v1 时合并为一条告警，与设计「每次 CLI 调用最多一次」对齐。
- `rewriteConfigToV2` 的 dry-run 分支改用将来时，并补一条「dry-run 不落盘」的断言。

## 两条证据核验提示的处置

1. **`gemini` 侧 consulted 无法与工具轨迹交叉核对**（`consulted_unverified: true`）。
   该侧轨迹解析的已知限制，先于本轮存在，不影响采信。
2. **`glm` 侧 evidence 引用了未列入 consulted 的三个文件**（`PROTOCOL`、`schemas.ts`、
   `config-migrate.test.ts`）。核实：三者的改动**都在本轮补丁内**，而 glm 的 consulted 里
   有那份 `.diff`——它在盲区段也明说了「经被审 diff 的新增段全文核实，未另行直读仓库原文」。
   依据来源交代得清楚，且 major 已由我实测复现。**不打折采信，记此备查。**

## 不做的事

无驳回、无暂缓。13 条全部接受并在本轮落地。

**范围边界**：修复仍限于 M7b 第 4 步范围。`--critics` 入口与 `default_critics` 的消费端
仍留给第 5 步——本轮删掉迁移补键之后，该字段的取值一律来自 `defaultConfig()` 或用户显式配置，
这反而让第 5 步接线时的语义更干净。
