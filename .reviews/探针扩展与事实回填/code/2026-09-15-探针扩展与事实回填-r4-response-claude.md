---
schema: trivium.disposition.v1
topic: 探针扩展与事实回填
stage: code
role: claude
kind: response
run_id: 20260914T222706Z
addresses:
  - 2026-09-15-探针扩展与事实回填-r4-gemini.md
  - 2026-09-15-探针扩展与事实回填-r4-glm.md
---

# 代码应答（r4）：上一轮 14 条修复的复审

## 0. 裁决总览

**11 条全部接受，零驳回**（gemini 4 条 + glm 7 条）。两侧均判 `request-changes`。

### 0.0 两件流程上的事，先说清

**① glm 侧 `parse_fallback`，其 7 条意见不在机读面上。**

> **本段初稿的根因判断是错的，已更正。** 初稿写的是「它把结论包在 markdown
> 代码块里，解析器没抠出来」——事后把原文喂回 `parseReview` 实测，
> **代码块解析器处理得了**，失败的是 ajv 校验。写错的那次我没有验证就下了判断，
> 而这份文件是留痕，留着错的根因会误导下一个查这件事的人。

实测的真实原因有两类（`reason: 'JSON 不符合 trivium.review.v1'`）：

**② 多给了 6 个根字段**：`topic`、`stage`、`role`、`run_id`、`rerun_index`、`evidence_ok`。
schema 是 `additionalProperties: false`，多一个就整份拒。
**它们的值都填对了**——那是**编排器自己会填进 front-matter 的元数据**，
审查员大概从落盘文档的形态反推，以为结论 JSON 也该带。

`parse.ts` 的 `stripVendorNoise` 已经在处理同类问题，但白名单只有
`toolAction` / `toolSummary` 两项（当初为 Antigravity 加的）。两者性质还不同：
那两个是**厂商运行时注入**、审查员控制不了；这 6 个是**审查员自己填**的。

**③ 发明了 schema 没有的枚举值**：`findings[3].layer = "docs"`、
`findings[5].layer = "design"`、`findings[5].kind = "architecture"`。

**这两条的表达需求是合理的**：GLM-04 说的确实是报告文档里的问题（枚举里没有 `docs` 层），
GLM-06 说的确实是架构边界问题（没有 `design` 层、没有 `architecture` 类）。
**是枚举不够用，不是它乱填。**

**代价很具体**：7 条意见——其中一条与 gemini 独立收敛且分析更准——
因为 6 个多余字段和 3 个枚举值整份掉进兜底，而内容没有任何问题。
> **本段初稿的第三处错误，已更正。** 初稿写的是「`fallback_ids` 也为空，
> 于是 `gate --check` 只要求 AGY-01..04」。**两半都错**：
> `fallback_ids` 是 `gate --check` 的**输出**（我裁决表里被识别为 F 形编号的行），
> 期望集则来自 `_meta/review-glm-<run_id>.fallback-items.md`
> （`gate.ts:472` 的 `readFallbackIds`）。那份文件有 4 个单元，
> 所以 `gate --check` 要求的是 **8 个编号**：`AGY-01..04` + `GLM-F01..F04`。
> 这已经是同一份留痕里第三处「凭形态猜、不打开看」的断言了——
> 前两处是 §0.0 的 `parse_fallback` 根因与 §0.2 的「拿不到切分边界」。
> 三处同因，说明这不是偶发笔误，而是**我在写归档件时默认自己记得**。

机读面上的实际代价因此更精确：**不是「glm 侧掉出闸门」，而是「7 条意见塌缩成
1 个不可分的编号」**（`GLM-F02`）。闸门齐备性仍然守得住，
丢掉的是**逐条粒度**——`gate` 没法再校验「GLM-03 有没有被单独裁决」。

**所以我照常逐条裁决它的 7 条**（下面第 2 节）。FR-14 禁止静默忽略的是**意见**，
不是「进了机读面的意见」；何况 GLM-01 与 AGY-01 独立收敛，而且**比它更准**。
按字面只填 4 个兜底编号是合规的，但那会把本轮最有价值的分析丢掉。

**② 连续两轮 glm 侧没能给出合格结论**：r3 证据不足（工具调用 4 次 < 下限 5）、
r4 解析回退。两轮的**内容质量都很高**。

这说明「合格性判定」与「意见价值」是两个维度，而现有机制只度量前者。

由 ①② 引出的两个改进点都属**编排器自身**、**不在 M6 范围**，登记待办：

- **`VENDOR_NOISE_KEYS` 该扩**：编排器自己填的 front-matter 字段
  （`topic` / `stage` / `role` / `run_id` / `rerun_index` / `evidence_ok`）
  审查员填了就剥掉，而不是判死整份。与 `toolAction` 同理——
  **已知的、无害的、可安全剥离的多余字段**。放宽 schema 则不行，
  那会同时失去「字段名写错能被发现」的保护（该函数的注释已写明这条取舍）。
- **`layer` / `kind` 枚举可能不够**：至少 `docs` 层与 `architecture` 类有真实需求。
  但扩枚举要先看是不是普遍现象，不能因一次样本就动契约。

### 0.1 本轮的形状：**我修一个洞时开了新洞，而且是同一族**

上一轮 AGY-02≡GLM-01 指出「没测到被判成安全失守」。我的修法有两步：

1. 加 `tool_surface_checked` 前置条件 —— **这一步是对的**；
2. 把 `headless_read_ok === null` 的 note 提到失守判据之前并直接 return
   —— **这一步是多余的，而且开了反方向的洞**。

GLM-01 的分析比我自己的更准：**第 1 步本身已经足以修掉原假阳性**
（init 缺失时 `checked === false`，失守判据根本不触发），第 2 步纯属过度矫正。

后果是反方向的遮蔽：**已核实的失守**会被「请重跑」note 压掉。两条具体路径：

| 路径 | 场景 | 现在的行为 |
| :--- | :--- | :--- |
| ① | 拿到了 init、工具面**脏**，但没跑到 result（超时/中断） | `headless_read_ok` 落 null → note 先 return → **blocker 永远走不到** |
| ② | 连 init 都没拿到，而负对照**真落了 breach.txt** | 同样被遮蔽；且**换回顺序也救不了** |

路径②是 gemini 没说到的，它揭示了更深的问题：**breach 发生时探针只清空
`readonly_flags`、不设任何独立信号**，于是「负对照失守」这个已核实事实
又一次塌缩进了 flags 空集——**同一个塌缩模式的第三次**。

---

## 0.2 裁决表

**一张表，两类编号**：`AGY-01..04` 是 gemini 侧的结构化意见；
`GLM-F01..F04` 是 `gate` 对 glm 侧 `parse_fallback` 原文的兜底切分。

> **本段初稿的说法是错的，已更正。** 初稿写的是「兜底件里只有 `parse_fallback`
> 与 `raw` 两个键、没有切好的条目，我拿不到切分边界」。
> `_meta/review-glm-20260914T222706Z.fallback-items.md` **存在**，
> 四个单元的边界写得清清楚楚。我没有打开它就断言它不存在——
> **这是同一份留痕里的第二处未经核实的断言**（第一处是 §0.0 的 `parse_fallback` 根因）。
> 两次都是「凭形态猜，不打开看」，而这份文件是给下一个查这件事的人看的。

实际切分边界如下（照抄兜底件）：

| 兜底编号 | 对应原文 |
| :--- | :--- |
| `GLM-F01` | 引言一行：「核查完毕，证据链闭合。以下为本轮（r4）审查结论…」 |
| `GLM-F02` | **整个 ```json 块——7 条 findings 全在这一个单元里** |
| `GLM-F03` | 结论行：「本轮结论：`request-changes`（重要 1 ｜ 次要 5 ｜ 吹毛求疵 1）」 |
| `GLM-F04` | 收尾的中文总结段 |

所以**这 7 条意见全部落在 `GLM-F02` 一个编号下**：兜底切分是按 markdown 的
行/块形态切的，不理解 JSON 内部结构，7 条 findings 对它就是一个不可分的代码块。
F01/F03/F04 是引言、结论行与总结段，本身不含独立意见。

实质裁决因此走 glm 的**自报编号** `GLM-01..07`（§2），7 条全部接受；
下表的 4 个兜底编号只承担「机读面上的编号齐备」这一层职责。

> **为什么不把 7 条重新挂到 4 个兜底编号下**：切分单元与意见不是一一对应的
> ——7 条全在 F02 里，F01/F03/F04 根本不含意见。硬塞会造出「F01 对应 GLM-01」
> 这种看起来齐整、实际错配的映射。按自报编号逐条处置才是真的逐条。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | 重要 | 接受 | 我上一轮的 null note 前移引入反方向遮蔽：已核实的失守被降级为 note，且 `trust_prompt_required === true` 再度不可达 | 撤回前移；失守判据回到首位；信任分支优先于泛化 null |
| AGY-02 | gemini | 次要 | 接受 | `judgeToolSurface` 实为子集检查却宣称「全等」，缺 `Read` 时仍报「全等」 | 话术改准；增 `missing` 校验 |
| AGY-03 | gemini | 次要 | 接受 | `claudeArgs` 为「被告知不要用它的消费方」持续增形，实际成了测试专用 API | 与 GLM-06 合并处置 |
| AGY-04 | gemini | 吹毛求疵 | 接受 | 既然 Grep 能绕过 deny，事后核验就必须覆盖 Grep 的 `path` 参数，否则是新盲区 | 报告第五节与 M9 建议补这一条 |
| GLM-F01 | glm | 重要 | 接受 | 兜底单元＝引言行，不含独立意见；接受其所属整份结论 | 无独立落点，随 §3 修复清单整体生效 |
| GLM-F02 | glm | 重要 | 接受 | 兜底单元＝整个 JSON 块，**7 条 findings 全在此**；实质裁决按自报编号 GLM-01..07 逐条落在 §2，全部接受 | 见 §3 修复清单 |
| GLM-F03 | glm | 重要 | 接受 | 兜底单元＝结论行（1 major ｜ 5 minor ｜ 1 nit），不含独立意见 | 无独立落点，随 §3 修复清单整体生效 |
| GLM-F04 | glm | 重要 | 接受 | 兜底单元＝中文总结段，是 F02 七条的复述，不含新意见 | 无独立落点，随 §3 修复清单整体生效 |

### glm 自报编号与严重度（实质裁决见 §2，7 条全部接受）

解析器只认**列名对得上的那一张**表及其后连续的表格行，所以这 7 条写成列表而非表格——
否则会另起一张表，把上面那张截断，机读面反而少掉一半编号。

- **GLM-01**（重要）与 AGY-01 独立收敛，且更准：前置条件本身已够，前移是多余的一步；另指出路径②
- **GLM-02**（次要）`tools` 字段漂移解析成 `[]` 时，空集全等 **vacuous 通过**
- **GLM-03**（次要）Grep 负对照只有一条腿：模型没发起 Grep 时「未泄漏」与「没去搜」不可区分
- **GLM-04**（次要）机制故事**与自己的第二轮实验矛盾**，且以事实口吻进了权威文档
- **GLM-05**（次要）`completed` 忽略 `is_error`/`subtype`，与 codex 不同口径——而注释写着「同口径」
- **GLM-06**（次要）「不要 import」只有注释没有机制，违背纪律 12
- **GLM-07**（吹毛求疵）配对在 id 全为 null 时塌缩成 false，与 r3 那条同族

---

## 1. 逐条裁决（gemini）

### AGY-01 · 重要 —— 接受

**裁决**：接受，**撤回上一轮那次前移**。

核实为真。两处遮蔽都成立：

1. **失守被降级**：`doctor.ts` 的 null note 先 `return`，后面的失守 blocker
   在 `headless_read_ok` 为 null 时永远走不到。而工具面核对与负对照落盘
   **都不依赖 result 事件**——`system/init` 在事件流前部就到，
   `breach.txt` 在不在是文件系统事实。
2. **信任分支再度不可达**：`trust_prompt_required === true` 的前提是 `!read.completed`，
   而那时 `headless_read_ok` 必为 null → 被前面的 note 截住。
   **我上一轮修的就是这个字段的不可达，修完它又因为另一个原因不可达了。**

测试之所以全绿，是因为用例都靠 `healthy()` 合成数据构造单一字段，
**没有一条覆盖真实探针会产出的组合形态**。

**落点**：

- 撤回 null note 前移；恢复顺序为：**确证失守 → 信任提示 → 泛化 null note**；
- 前置条件 `tool_surface_checked === true` 保留（它才是真正修掉 r3 假阳性的那一步）；
- 补用例：`headless_read_ok === null` + `tool_surface_checked === true` + flags 空 → 必须是 blocker。

### AGY-02 · 次要 —— 接受

**裁决**：接受。

`judgeToolSurface` 只算 `extra = tools.filter(t => !expected.includes(t))`，
即只断言 `tools ⊆ expected`。若 tools 是 `['Glob']` 甚至 `[]`，`clean` 仍为 true，
而探针照样输出**「工具面与白名单全等」**。

我自己的测试里还有一条「少于白名单不算失守」——那条**断言本身是对的**
（少了确实不危险，CLI 更严不是更松），但**文案说「全等」就是假的**。
这是「文案与实现两个口径」的又一次，只是这次错在**我给判据起的名字**上。

**落点**：话术从「全等」改为「无未授权工具」；另增 `missing` 校验——
缺了 `Read` 这种核心读工具时该侧其实**干不了活**，那是另一种不可用，不该报「干净」。

### AGY-03 · 次要 —— 接受

**裁决**：接受，与 GLM-06 合并处置。

审查员点破了一个我没意识到的状态：`claudeArgs` 声明了 `budgetUsd` / `sessionId`，
**探针自己一次都没传过**，唯一消费者是测试里的 `m9Scale` 用例；
而 JSDoc 又写着「M9 不要 import 本函数」。

于是它成了「**为一个被告知不要存在的消费方持续增形的 API**」——
上一轮我按 GLM-04 的建议做分层是对的，但分层之后应当**把 M9 那半留给 M9**，
而不是留在探针里当测试专用参数。

**落点**：见 GLM-06——机制性守卫 + 设计层面给调用形态旗标定归属。

### AGY-04 · 吹毛求疵 —— 接受

**裁决**：接受。这条是 D-3 结论修正后**必然跟着的那一步**，我漏了。

既然实测证实 Grep 能穿透 `permissions.deny`，那么 M9 的事后轨迹核验
就**必须同时覆盖 `Grep` 的 `path` 参数**，而不只是 `Read` 的 `file_path`。
否则模型经 Grep 检索禁读目录，**既不被 CLI 拦截、也不被事后发现**——
那是比原来更糟的状态：我们以为补上了兜底，而兜底恰好漏掉了唯一能穿透的那条路。

**落点**：报告第五节与 D-1 的后果段补这一条；M6 第 4 步回填设计时一并写入。

---

## 2. 逐条裁决（glm，`parse_fallback`）

> 这 7 条不在机读面上，`gate --check` 不会要求它们。**照常裁决**的理由见 §0.0①。

### GLM-01 · 重要 —— 接受

**裁决**：接受。与 AGY-01 独立收敛，**且分析更准**，本轮按它的版本修。

它指出的两点是 gemini 没说到的：

1. **前置条件本身已经够了**——`tool_surface_checked === true` 使 init 缺失时
   失守判据根本不触发，r3 的假阳性已被修掉。null note 前移是**多余的一步**，
   而多出来的这一步开了反方向的洞。**两条诉求本可同时满足**，我做成了取舍。
2. **路径②：负对照失守没有独立信号**。breach 发生时探针只清空 `readonly_flags`、
   不设 `tool_surface_checked`——于是「落了文件」这个已核实事实
   又塌缩进 flags 空集，**换回顺序也救不了**。

第 2 点是同一个塌缩模式的**第三次**（r3 的 `readonly_flags` 空集双义、
r3 的 `path_deny` 无从证实落 false、本轮的 breach）。
共同形状：**一个字段承载多个互斥的意思**。

**落点**：

- 按 §1 AGY-01 恢复判定顺序；
- **探针侧给 breach 一个独立字段**（`readonly_breach: boolean | null`），
  不再让它与「工具面脏」共用 flags 空集；
- 补用例锁住顺序与路径②。

### GLM-02 · 次要 —— 接受

**裁决**：接受。

`parseClaudeEvents` 在 `tools` 字段缺失或改名时落 `[]`（`Array.isArray` 判假），
而 `judgeToolSurface([])` 的 `extra` 为空 → `clean: true` → 探针记下完整配方、
`tool_surface_checked: true`。

**CLI 漂移改掉 `tools` 字段名的那天，探针会永远记「工具面干净且已核对」**，
而锁事实①只喂录制样本、守不住运行时漂移（fixtures README 自己写了这条缺口）。

审查员那句区分很准：**「少于白名单不算失守」与「空集」不是一回事**——
前者是有非空读回、只是更严；后者是**根本没有读回**。

**落点**：`init.tools` 为空数组时按「未核对」处理（`tool_surface_checked = false`），
不让空集 vacuous 通过。

### GLM-03 · 次要 —— 接受

**裁决**：接受。

`grepLeaked = grepProbe.completed && raw.includes(SENTINEL_PEER)`——
只有一条腿。模型完全可能压根没发起 Grep（拒绝或文字作答），
这时「未泄漏」与「没去搜」不可区分，而 method 会写下
**「Grep 负对照同样未泄漏（规则对 Read 与 Grep 都生效）」**这个肯定断语。

**这正是该函数自己 JSDoc 里警告的陷阱**（「只看哨兵会把『模型压根没去读』
误判成『挡住了』」）**在 Grep 通道上的复发**——主 Read 判据有两条腿，
我给 Grep 只写了一条。

而且 r3 实测有过先例：写探针两次里有一次模型不发起调用。
**Grep 提示词没拿到写探针那套「必须真的发起」的加固。**

**落点**：Grep 结论也走两条腿（轨迹里要有 Grep 真被发起的正向证据），
拿不到正向证据时记「Grep 通道无从证实」而**不是**「未泄漏」；提示词补加固指令。

### GLM-04 · 次要 —— 接受

**裁决**：接受。这条最该反省——**我把一个被自己实验否定的假说写成了结论**。

我在 method、doctor note 与报告里写的是：

> 「规则是**按工具生效**而非按路径生效」「`permissions.deny` 的能力本身就不完整」

而第二轮实验是：**显式写上 `Grep(./dir/**)` 规则，Grep 照样绕过**。
若规则真按工具生效，那条 Grep 规则就该管用——**实验恰恰证伪了我的说法**。

更可能的机制（Grep 的 deny 匹配单位是搜索 pattern 而非路径，
路径形规则对它根本不适用）**我没有测过**，却以事实口吻落进了
「凡与演进设计冲突一律以本报告为准」的权威文档。

这比上一轮的「超出证据」更重一档：那次是证据不够支撑结论，**这次是结论与证据矛盾**。

**落点**：

- 机制表述降回实测事实：「**路径形** deny 规则对 Read 生效、对 Grep 不生效
  （显式写 Grep 规则亦然）；按 pattern 绑定 Grep 的可能性**未验**」；
- pattern 假说明确标注为假设；
- 机读面上 `rule_syntax` 只留**被证实生效**的 Read 规则——
  现在把已被证伪的 Grep 规则也留在里面，M9 只读该字段会看不见洞。

### GLM-05 · 次要 —— 接受

**裁决**：接受。

`ClaudeTrace.completed` 只看「存在 `type === 'result'` 的事件」，
**忽略该事件自带的 `is_error` / `subtype`**；而 codex 的 `traceCompleted`
要求「有最终回复」。错误路径的 result（预算掐断、max_turns 一类）
会让 `completed = true` → `headless_read_ok` 落 **false**（确定否定「读不到文件」）
而不是 null → `--only claude` 时直接 blocker。

**用户拿到的又是一个失实指控**，而字段注释写着「与另两家同口径」——
**文案与实现不符，第七次**。

审查员诚实标了 medium 置信度并说明原因（没有错误 result 的实测样本）。
我接受这条，但**落点里要标明同样的边界**：修法按 `is_error`/`subtype` 判，
而这两个字段在错误路径下的真实取值**我也没有样本**——
所以判据要写成「**不是** success 就按未得出结论处理」的保守形态，
而不是枚举已知的错误 subtype。

### GLM-06 · 次要 —— 接受

**裁决**：接受，取其**机制性方案**。

「M9 读 `probe.readonly_flags` 自行构造」这条路走得通——审查员核实了
zcode 适配器就是这个模式（`readonlyArgsFromProbe` + 关键旗标前置校验），
这也回答了我的焦点问二。

但两个缺口都成立：

1. **「不要 import claudeArgs」只有注释没有机制**。仓库无 eslint，
   `registry-parity` 只扫 Agent 字面量。这直接违背 AGENTS.md 纪律 12 确立的原则：
   **「靠记性的纪律要换成不依赖记性的机制」**——而那条纪律正是本项目自己立的。
2. **调用形态旗标无机读落点**：`-p` / `--output-format` / `--verbose` /
   stdin 置空 / `--json-schema` 收内联，只活在文件头注释与报告散文里，
   `readonly_flags` 一个都不含。M9 只能在适配层硬编码它们，
   而 P7 的字面是「适配层绝不硬编码 CLI 旗标」。

**落点**：

- 补一条 grep 级契约测试：**`adapters/` 下禁止 import `probes/*`**，
  把 P7 的这一角从注释变成会红的断言；
- 调用形态旗标的归属**在 M6 第 4 步回填设计时写死**——要么承认机制类旗标属适配层
  （zcode 先例即如此），要么给探针加机读字段。**本步不擅自决定**，登记为第 4 步的待决项。

### GLM-07 · 吹毛求疵 —— 接受

**裁决**：接受。

`offLimit.some(u => u.id !== null && errored.has(u.id))` 在**所有 id 均为 null**
时返回 false（解析器容忍 id 缺失），于是 `denied_tool_in_trace` 落 false
（「试了但没留痕」）——而事实是「**无从配对**」。

与 r3 的 AGY-01≡GLM-02 同族，只是触发前提更远（要 id 字段漂移）。

**落点**：改三分——有可配对且命中 → true；有可配对但无一命中 → false；
**无可配对 → null**。

---

## 3. 修复清单

| 文件 | 改动 | 来源 |
| :--- | :--- | :--- |
| `doctor.ts` | 撤回 null note 前移；顺序恢复为 确证失守 → 信任提示 → 泛化 null | AGY-01 ≡ GLM-01 |
| `types.ts` | `ClaudeProbe` 增 `readonly_breach`，给负对照失守独立信号 | GLM-01 路径② |
| `probes/claude.ts` | breach 时设 `readonly_breach = true` | 同上 |
| 同上 | `judgeToolSurface` 话术改准 + 增 `missing` 校验 | AGY-02 |
| 同上 | `init.tools` 为空数组时按「未核对」处理 | GLM-02 |
| 同上 | Grep 负对照补正向证据判据；提示词加固 | GLM-03 |
| 同上 | 机制表述降回实测事实；`rule_syntax` 只留 Read 规则 | GLM-04 |
| 同上 | `completed` 判据加 `is_error`/`subtype`（保守形态） | GLM-05 |
| 同上 | 配对判据改三分 | GLM-07 |
| 同上 | `claudeArgs` 剥离 M9 尺度入参，定位为探针私有 | AGY-03 / GLM-06 |
| `registry-parity.test.ts` | 新增契约：`adapters/` 禁止 import `probes/*` | GLM-06 |
| `claude-severity.test.ts` | 补真实组合形态用例（null + checked=true + flags 空 → blocker） | AGY-01 / GLM-01 |
| `claude-events.test.ts` | 补空 tools、无 id 配对、错误 result 三条 | GLM-02 / GLM-07 / GLM-05 |
| 报告 | D-3 机制表述改写；第五节补「核验须覆盖 Grep 的 path」 | GLM-04 / AGY-04 |
| BACKLOG | 登记三项：①`VENDOR_NOISE_KEYS` 扩至编排器自填的 front-matter 字段；②`layer`/`kind` 枚举是否需补 `docs`/`architecture`；③调用形态旗标归属待 M6 第 4 步定 | §0.0①② / GLM-06 |

**变异验证**：AGY-01≡GLM-01、GLM-02、GLM-03、GLM-05 四条逐条做。
其中 AGY-01 的变异要**真的构造那个组合**（null + checked=true + flags 空），
不能只验「顺序换了」。

---

## 4. 两侧共同确认、本次不动的部分

上一轮 14 条修复里，**被两侧明确确认落对的**：

- `tool_surface_checked` 是 r3 那条 major 的**正确修法**（拆开空集双义、修的是根因）；
- `claudeArgs` 两层拆分与双层配方测试；
- `execProbe` 透传 `raw`、泄漏判据改查原始输出——与锁事实用例同口径；
- `path_deny` 三态改造（`!leaked && !recorded` 落 null、不写 `attempts`）；
- `judgeToolSurface` 抽纯函数 + 点名 `extra`/`mcpCount`，两个方向都有用例；
- `erroredToolUseIds` 按 `tool_use_id` 配对；
- `trust_prompt_required` 改文本特征识别、识别不了保持 null；
- **报告 D-3 的自我修正**——初版结论被自己的第二轮实测推翻后如实改写；
- `preflight.test.ts` 删除「已登记未实现」用例（该用例自我宣告的机器信号）；
- doctor 的 claude 段与 codex 段完全同构，没有引入第四种接线形态。

**焦点二的答案**（GLM-06 确认）：M9 读 `readonly_flags` 自行构造**走得通**，
zcode 适配器就是现成先例。要补的是机制守卫与旗标归属，不是推翻这条路。
