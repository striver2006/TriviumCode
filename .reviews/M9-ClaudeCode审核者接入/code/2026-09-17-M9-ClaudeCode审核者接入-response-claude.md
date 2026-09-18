---
schema: trivium.disposition.v1
topic: M9-ClaudeCode审核者接入
stage: code
role: claude
kind: response
run_id: 20260917T151624Z
addresses:
  - 2026-09-17-M9-ClaudeCode审核者接入-codex.md
  - 2026-09-17-M9-ClaudeCode审核者接入-gemini.md
  - 2026-09-17-M9-ClaudeCode审核者接入-glm.md
---

# 代码应答：我在一条**声称在防这个塌缩**的分支里，把塌缩又做了一遍

## 0. 总裁决：16 条中 15 条接受、1 条驳回、0 条暂缓

三侧齐备（gemini 4、glm 5、codex 7），**三侧独立收敛到同一个阻断**
（AGY-01 ≡ GLM-01 ≡ CODEX-01），codex 还用构建产物把它跑了出来。

**我自己复现过了**，用探针在「读探针没拿到 `system/init`」时真实会产出的那个组合：

```text
入参 { tool_surface_checked:false, readonly_flags:[], strict_mcp_config_applied:false,
       headless_read_ok:null, readonly_breach:false }
输出 [{ level:'blocker', message:'claude 落盘的只读组合里缺 MCP 硬前置旗标…请重跑 trivium doctor --only claude' }]

同一组合再加 trust_prompt_required:true
输出 仍是那条 blocker —— ③ 信任提示被整条截住
```

一台只是 claude 没登录、且**根本没把 claude 启用为审核者**的机器，会被 `doctor` 硬阻断，
拿到一条**失实的安全失守指控**，外加一句**必然复现**的「请重跑」。

**这条的形状要写下来，因为它比这个 bug 本身值钱：**

我给那个分支写的注释是——

> `null` 不走这条：那是「没测到」，归 ⑤/⑥ 的泛化 note——**把未测说成失守，
> 正是本函数其余分支反复在防的塌缩**。

注释是对的。**代码没兑现它**，因为塌缩发生在**上游**：探针在什么都没测到时产出的不是
`null` 而是 `false`（`[].includes(...)`），于是判定侧那道 `=== false` 的三态门形同虚设。
**我防住了自己那一行，没防住喂给它的那一行。**

**更难看的一层：掩盖它的夹具是我这次亲手加的。** 四条新用例全走 `healthy()`，
而我在同一个 diff 里给 `healthy()` 补了 `strict_mcp_config_applied: true`，
提交说明还写着「健康夹具要**如实**带上硬前置为真」——那句话本身没错，
错在我**只**加了这一行，没有同时构造生产侧真会产出的那个组合。
三侧各自独立指出了这一点（AGY-01 末段、GLM-01「测试缺口」、CODEX-01 末段）。

**驳回一条：CODEX-05。** 它说「安全不变量被展开在 prompt **之后**」——回原文核实，
`...READONLY_INVARIANTS` 在 `probes/claude.ts:113`，`opts.prompt` 在 `:119`，
**不变量在 prompt 之前**。前提不成立，其推论（argv 排版问题被读成厂商结论）也就不成立。
它的第二半（负对照绕过 `execProbe` 的 `completed` 判据）**是对的**，但那条由 CODEX-02 承接。

**两处引文有误但实质成立，按「留痕准确优先」记下来**（裁决不受影响）：

- **CODEX-04** 称 `types.ts` 把 `rule_syntax` 说成「目录 glob **或文件路径**」——
  原文（`types.ts:139`）是「可复用的规则写法，供适配层注入 `deny_paths`。不支持时为 null」，
  没有那个「或」。但它指出的实质问题成立：**契约说「供注入 `deny_paths`」，
  而实测过的只有目录 glob**，逐文件形态未验。
- **CODEX-06** 把落点表说成设计 **§3.5**——§3.5 是 M0 期的必测清单，只列 agy/zcode/node/git，
  **没有任何 claude 行**，我也没在那里加过行。我改的是 **§3.7** 的事实表（GLM-04 指对了）。
  它的两半实质都成立。

### 0.1 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 已复现（见 §0）。根因在探针侧：`probes/claude.ts:741` 无条件从 `readonly_flags` 反算，而 `:725` 的无 init 分支只置 `tool_surface_checked=false`、不动数组，首轮它就是 `[]`。判定侧 `doctor.ts` 的 ②' 又缺 ② 那道 `tool_surface_checked === true` 前置，且排在 ③⑤⑥ 之前 | 两侧一起改，见 §2.1 |
| AGY-02 | gemini | minor | 接受 | 我在设计 §3.7.1 的「来源」列写「绑定关系本身读 `probe.cli.claude.stream_json_requires_verbose`」，而 `types.ts:611` 写的是「消费方是漂移可见性，**不是参数构造**」——同一件事两个口径，会让人以为适配层要按它动态拼参数 | §3.7.1 该行改准，见 §2.5 |
| AGY-03 | gemini | minor | 接受 | 核实：文档头仍 v1.3.19、`line 21` 仍断言「M9～M11 尚未开工」、实测依据未收新报告、§16.1 M9 行仍 ⏳、§24.1 台账未登记。本次对设计正文做了实质修订却一处都没动 | 升版与四处回填，见 §2.6 |
| AGY-04 | gemini | nit | 接受 | `coverage_complete` 的三态映射内联在带 I/O 的 `probeClaudePathDeny` 里，而同一轮的 `judgeVerboseBinding` 抽了纯函数并配四格用例——同一个理由，我只做了一半 | 抽纯函数 + 用例，见 §2.4 |
| GLM-01 | glm | major | 接受 | 与 AGY-01 同一处，证据更细：点出 `config.ts:110` 的 `defaultProbe` 初值就是 `[]`，以及「这正是 `claude-severity.test.ts:103-132`（flags 空集双义）早已修掉的同形塌缩在新字段上的复发」 | 同 AGY-01，见 §2.1 |
| GLM-02 | glm | minor | 接受 | **回原文核实成立**：`strict_mcp_config_applied` 在 `:741` 算完，而 breach 分支在 `:771` 才清 `readonly_flags`。于是负对照真落了文件的机器上会落 `{readonly_flags: [], strict_mcp_config_applied: true}`——**违反我自己在 `types.ts` 写的「今天两者恰好同真同假」**。doctor 侥幸正确只因 ① 先 fire | 赋值挪到全部清空点之后，见 §2.2 |
| GLM-03 | glm | minor | 接受 | 与 CODEX-02 同一处，另补两格：`exitCode === null`（spawn 失败 / 信号致死）同样满足 `!== 0`，而用例只锁了 `timedOut: true`，`{exitCode: null, timedOut: false}` 这一格无断言 | 同 CODEX-02，见 §2.3 |
| GLM-04 | glm | minor | 接受 | 核实：设计 §3.7 的事实表是 claude 探针字段的清点处（本次 diff 还主动改了它的 `denied_tool_in_trace` 行，说明它被当活清单维护），但两个新标量字段没立行、`path_deny` 行的落盘列也没带 `.coverage_complete` | §3.7 表补行，见 §2.7 |
| GLM-05 | glm | nit | 接受 | 与 AGY-03 同向。它另指出：此前连续四版（v1.3.16~v1.3.19）每次落改动都带历史行，v1.3.16 甚至注明「非里程碑推进」也照记——所以「留待收口」若是刻意的，也缺留痕 | 同 AGY-03，见 §2.6 |
| CODEX-01 | codex | blocker | 接受 | 与 AGY-01 / GLM-01 同一处。它用构建产物直接复现，并点出同一塌缩还覆盖 `surface.empty` 那条路（那里 `readonly_flags` 被**显式**清成 `[]`）——那一格我原以为是「已核对、确认脏」，其实同样是「没核对成」 | 同 AGY-01，见 §2.1 |
| CODEX-02 | codex | major | 接受 | **核实成立**：`judgeVerboseBinding` 的 `true` 臂判据是「非零退出且零事件」，而 `exec.ts:194-195` 在 spawn 失败时 `finish(null, null)` ⇒ `exitCode === null`、`stdout === ''` ⇒ 落 `true`。未登录、断网、slug 失效同理。notes 还会说一句「负对照进程被**当场拒绝**」——把**没跑起来**说成**被拒绝**，是失实陈述。与同文件 `judgeToolSurface` 拒绝 vacuous pass 的口径不一致 | 收紧 true 臂 + 正对照前置 + 文案改准，见 §2.3 |
| CODEX-03 | codex | major | 接受 | 核实成立：`probeArgs` 送 prompt 仍是 argv 末位，**EV-40 那格是在 argv 形态下测的**，而设计 §3.7.1 已把适配层写成走 stdin。两个形态下「非零退 + 零事件」是否等价**没测过**，尤其形态 B 的位置参数 `-` 与 prompt 位置参数直接冲突 | 措辞改「待复验」+ 第 3 步复验，见 §2.8 |
| CODEX-04 | codex | major | 接受 | 实质成立（引文有误，见 §0）：落盘 `rule_syntax` 是**目录 glob**（`Read(./<dir>/**)`），而 M9 要注入的 `deny_paths` 是**逐文件清单**，等价性两份报告都登记为未验。按字面替换则第 ③ 道屏蔽可能不成立，而 `peer_deny_applied` 仍记 true——这是 `coverage_complete` **没有**表达的另一格缺口 | 注释写明形状不同 + 第 3 步前实测，见 §2.9 |
| CODEX-05 | codex | minor | 驳回 | **前提事实不成立**：它说不变量展开在 prompt 之后，而 `probes/claude.ts:113` 是 `...READONLY_INVARIANTS`、`:119` 才是 `opts.prompt`——**不变量在前**。据此推出的「argv 排版问题被静默读成厂商结论」也就不成立。**它的第二半是对的**（负对照绕过 `execProbe` 的 `completed` 判据），但那条已由 CODEX-02 覆盖并在 §2.3 落地，不靠本条 | 无（第二半随 §2.3 一并收） |
| CODEX-06 | codex | minor | 接受 | 两半实质都成立（章节号有误，见 §0）：①`coverage_complete` 在设计文档里没有落点行（应落 §3.7 而非它说的 §3.5）；②`defaultProbe` 的 claude `path_deny` 初值不带 `coverage_complete`，而两个标量字段的初值齐了——同一个动作做了一半 | §2.7 + `defaultProbe` 补初值 |
| CODEX-07 | codex | nit | 接受 | 成立：「什么算一条事件」在 `judgeVerboseBinding` 与 `parseClaudeEvents` 各存一份判据。**这正是本轮在 `path_deny` 上刚消掉的「两处各存一份事实」形态**，我在同一个 diff 里又造了一个 | 随 §2.3 一并收 |

**统计**：接受 15 ｜ 驳回 1 ｜ 暂缓 0。

---

## 1. 本轮的形状：**三次同形塌缩，这是第四次**

本仓的探针文件自己数过三次「一个字段承载多个互斥的意思」：
`readonly_flags` 空集双义、`path_deny` 落 false、`denied_tool_in_trace` 二态化。

**这是第四次，而且是我在修第二次留下的尾巴（EV-40）时新造的。**

共同结构永远是同一个：**「没测到」被一个求值表达式算成了「确认没有」。**
`[].includes(x)` 是 `false`——语言给的是布尔，但语义上它该是 `null`。

两条能带走的：

1. **三态字段的 `null` 必须在产出侧就产出，不能指望消费侧的 `=== false` 兜住。**
   消费侧那道门只能区分它**收到**的三个值，区分不了「上游把 null 算成了 false」。
2. **给健康夹具补字段时，同一次要构造对应的不健康组合。** 我这次补了
   `strict_mcp_config_applied: true` 并写了「要如实」，而真正不如实的是
   **夹具里没有任何一条代表「探针什么都没测到」的形态**。

---

## 2. 修法

> 闸门期不改业务文件。以下是经审批后要落的改动，不是已落的。

### 2.1 阻断：产出侧与判定侧一起改（AGY-01 ≡ GLM-01 ≡ CODEX-01）

**两侧都改，不只改一侧**（三侧的共同建议）：

- **产出侧**（`probes/claude.ts`）：只在**本轮真的决定了落盘组合**时才计算
  `strict_mcp_config_applied`，即 `tool_surface_checked === true` 才赋值，否则记 `null`。
  这覆盖三条路：无 `system/init`（`:725`）、`surface.empty`（`:690`，CODEX-01 点出的那格）、
  以及 `skipModelCalls` 早退。
- **判定侧**（`doctor.ts` ②'）：加与 ② 同口径的 `tool_surface_checked === true` 前置，
  并只判「**非空但不含硬前置**」这种真子集；`[]` 归 ⑥ 的「没核对成」。

**用例**（三侧共同要求，且必须是生产侧真会产出的形状）：

- `{tool_surface_checked:false, readonly_flags:[], strict_mcp_config_applied:null}` → **不得是 blocker**；
- 同上再加 `trust_prompt_required:true` → 必须走到 ③ 信任提示；
- `{tool_surface_checked:true, readonly_flags:[其它旗标但缺硬前置]}` → 仍是 blocker（真子集那格）；
- **`healthy()` 之外另起一个 `unmeasured()` 夹具**，让「什么都没测到」这个形态在本文件里有名字。

并在 ②' 注释里写明它与 ②/⑥ 的分工，说明为什么不再互相截住。

### 2.2 breach 路径的字段矛盾（GLM-02）

把 `strict_mcp_config_applied` 的赋值**挪到全部清空点之后**统一计算
（`:691` / `:697` / `:771` 三处之后），使 `types.ts` 那句「今天两者恰好同真同假」重新为真。
补一条用例锁 breach 组合。

### 2.3 EV-40 的 `true` 臂无归因（CODEX-02 ≡ GLM-03，含 CODEX-05 第二半与 CODEX-07）

四件一起收：

1. **`exitCode === null` 归 `null`**，理由与 `timedOut` 那格同族：拿不到退出码就既没被拒也没跑完。
   判据收紧为 `typeof exitCode === 'number' && exitCode !== 0`。
2. **正对照做前置**：`true` 的成立依赖同轮带 `--verbose` 的探测**确实产出过事件**
   （复用本文件既有 `execProbe` 的结果，不额外花钱）。不成立时记 `null`。
3. **负对照先过一次 `parseClaudeEvents`**（CODEX-05 第二半）：「stdout 里连 `system/init` 都没有」
   与「有 init 但中途失败」应当是两种观测，后者不记 `true`。这同时消掉 CODEX-07 那份
   独立的「事件行」判据——改为复用解析结果。
4. **文案改准**：判据注释与 notes 写「观测到的非零退出**未被归因**」，不写「被当场拒绝」。

补用例：`{exitCode:null, timedOut:false}` → `null`（GLM-03 点名的那个空格）。

### 2.4 `coverage_complete` 抽纯函数（AGY-04）

把 `grepVerdict → coverage_complete` 的三态映射提成导出纯函数并配无 I/O 用例，
与 `judgeVerboseBinding` 同形。理由是同一条：**内联在 I/O 流程里的判据没有防退化守卫。**

### 2.5 设计 §3.7.1 的「来源」列改准（AGY-02）

那一行改为：旗标本身按机制类**适配层硬编码**；
`stream_json_requires_verbose` 是**探针侧的漂移可见性落点**，不参与参数构造。
与 `types.ts:611` 和 §11.1 判据一第二类对齐。

### 2.6 文档头、里程碑与台账（AGY-03 ≡ GLM-05）

升 **v1.3.20**；文档头补实测依据索引与现状断言（`line 21` 的「M9～M11 尚未开工」已失实）；
§16.1 的 M9 行标为进行中（第 1、2 步完成）；§24.1 台账登记本次三字段；补版本历史行。

### 2.7 §3.7 事实表补行（GLM-04 ≡ CODEX-06①）

§3.7 表补 `stream_json_requires_verbose` 与 `strict_mcp_config_applied` 两行（含三态语义与消费方），
`path_deny` 行的落盘列补 `.coverage_complete`；
`config.ts` 的 `defaultProbe` claude `path_deny` 初值补 `coverage_complete: null`（CODEX-06②）。

### 2.8 EV-40 结论的形态依赖（CODEX-03）

设计 §3.7.1 stdin 行的「实测已定」加限定：**EV-40 的负对照是在 argv 形态下测的**，
第 3 步建 `adapters/claude.ts` 时必须在 stdin 形态下复验同一结论。
并把 prompt 的传递方式参数化进 `probeArgs`（默认 argv，留 stdin 分支），让复验不必复制一份配方。

### 2.9 `rule_syntax` 的形状与 `deny_paths` 不同（CODEX-04）

`PathDenyProbe.rule_syntax` 注释写明：**这是目录 glob；`deny_paths` 是逐文件清单，
两者形状不同、等价性未验**，并说明 `coverage_complete` **不覆盖**这个问题
（它管的是「规则对哪些读工具生效」，不是「规则对哪种路径形状生效」）。
第 3 步接适配器**之前**补一次逐文件形态的实测。

---

## 3. 认为正确、本次不动的部分

三侧共同确认：

- EV-40 换判据的**方向**成立：实测形态下「干净拒绝」比「数事件条数」更不歧义，
  负对照零成本；刻意不匹配 stderr 文案与消掉 `path_deny` 字面反解是同一条纪律。
- EV-41 的结论如实分层——形态 C 只证明送达、A/B 之间没有能区分机制的实验，
  没有抹平成「三种等价可随意选」。
- `STRICT_MCP_CONFIG_FLAG` 提具名常量并留在 `probes/` 下，与 `registry-parity`
  第 6 条防空转腿兼容（glm 逐条核过注释自述与测试实现吻合）。
- `coverage_complete` 严格三态、三个出口各归 `null` 而不与 `true` 合流，
  notes 按三态分三句话，M6 报告第 8 条的「那半仍未验」限定语保留得当。
- ②' 在 `claudeSeverity` 内的**排序**本身正确（确证先于推断、特化先于泛化），
  `null` 放行与 `skipModelCalls` 门控与 ② 同口径——**坏的是喂给它的值，不是它的位置**。
- BACKLOG 的结案叙述把**被实测否证的原拟判据**留在原条目里而不是改写成成功叙事。

---

## 4. 一条过程观察（不构成意见，但该留痕）

codex 侧在盲区一节**自曝**：它用过两条带 shell 通配的命令去列 plan 目录，
glob 覆盖到了禁读清单里的文件名，并声明「没有任何禁读文件的内容进入上下文」，
随后改为点名文件。编排器本轮的 `peer_leak` 判定未触发，与它的自述一致。

记在这里有两个用处：一是它主动说了，这正是措施 b 想要的那种可对账；
二是它提示**通配命令是措施 b 的一个已知形态**——`command_texts` 扫得到命令文本，
但「glob 展开后覆盖了哪些文件」不在文本里。这条不改本轮代码，
但值得在 M9 第 3 步接 claude 的结构化路径核验时对照看：
claude 侧有 `Read` 的结构化 `file_path`，不吃这个亏。
